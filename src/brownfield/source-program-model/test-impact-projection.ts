import { z } from 'zod';

import { SecError } from '../../system-architecture/foundation/contract/failure.ts';
import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  sha256,
  uniqueSorted
} from '../../system-architecture/foundation/runtime/canonical.ts';
import { parseExactJson } from '../../system-architecture/foundation/runtime/exact-json.ts';
import { normalizeSecRepositoryPath } from '../../system-architecture/repository-modules/contract.ts';
import type { SourceProgramModel, SourceProgramReference } from './contract.ts';
import {
  assertRepositoryCompilationGenerationReceipt,
  type RepositoryCompilationGenerationReceipt
} from './repository-compilation-cache.ts';
import {
  workspaceSourceSnapshotIdentityForTestObservations,
  type SourceProgramTestObservations
} from './test-observations.ts';
import { workspaceSourceSnapshotIdentityForTypeScriptModel } from './typescript.ts';
import {
  assertPhysicalWorkspaceSourceSnapshot,
  assertWorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot,
  type VirtualWorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshot
} from './workspace-source-snapshot.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40,64}$/u;
const PURPOSE = 'test-impact-selection' as const;
const SCHEMA = 'sec-source-program-test-impact-projection-v2' as const;

const digestSchema = z.string().regex(DIGEST);
const repositoryPathSchema = z.string().min(1).refine(
  (value) => normalizeSecRepositoryPath(value) === value,
  'repository path must be canonical'
);
const physicalSubjectSchema = z.object({
  kind: z.literal('physical-repository'),
  provenance: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('git-tree'),
      commitSha: z.string().regex(COMMIT_SHA),
      identityDigest: digestSchema,
      objectCensusDigest: digestSchema
    }).strict(),
    z.object({
      kind: z.literal('working-tree-observation'),
      identityDigest: digestSchema,
      providerIdentityDigest: digestSchema,
      repositoryRootIdentityDigest: digestSchema
    }).strict()
  ])
}).strict();
const virtualSubjectSchema = z.object({
  kind: z.literal('virtual-mutation'),
  provenance: z.object({
    kind: z.literal('source-program-virtual-mutation'),
    baseSnapshotDigest: digestSchema,
    mutationDigest: digestSchema
  }).strict()
}).strict();
const fileSchema = z.object({
  path: repositoryPathSchema,
  moduleId: z.string().min(1).nullable(),
  surface: z.enum(['production', 'test', 'fixture', 'workflow', 'resource'])
}).strict();
const moduleReferenceSchema = z.object({
  from: repositoryPathSchema,
  kind: z.enum(['static', 'dynamic', 'require']),
  typeOnly: z.boolean(),
  specifier: z.string(),
  candidateTargets: z.array(repositoryPathSchema),
  resolvedTarget: repositoryPathSchema.nullable()
}).strict();
const semanticReferenceSchema = z.object({
  path: repositoryPathSchema,
  moduleSpecifier: z.string().nullable(),
  targetPath: repositoryPathSchema.nullable(),
  precise: z.boolean()
}).strict();

const projectionUnsignedSchema = z.object({
  schema: z.literal(SCHEMA),
  purpose: z.literal(PURPOSE),
  subject: z.discriminatedUnion('kind', [physicalSubjectSchema, virtualSubjectSchema]),
  subjectDigest: digestSchema,
  sourceRevision: z.string().min(1),
  snapshotDigest: digestSchema,
  moduleMembershipDigest: digestSchema,
  moduleGraphDigest: digestSchema,
  workspaceSnapshotIdentityDigest: digestSchema,
  projectGenerationDigest: digestSchema.nullable(),
  projectGenerationReceiptDigest: digestSchema.nullable(),
  productionModelDigest: digestSchema,
  testObservationDigest: digestSchema,
  files: z.array(fileSchema),
  declarationPaths: z.array(repositoryPathSchema),
  moduleGraph: z.object({
    files: z.array(repositoryPathSchema),
    references: z.array(moduleReferenceSchema),
    unresolvedFiles: z.array(repositoryPathSchema)
  }).strict(),
  testFiles: z.array(repositoryPathSchema),
  semanticReferences: z.array(semanticReferenceSchema)
}).strict();
const projectionSchema = projectionUnsignedSchema.extend({
  projectionDigest: digestSchema
}).strict();

type TestImpactProjectionUnsigned = z.infer<typeof projectionUnsignedSchema>;
export type TestImpactProjectionReceipt = Readonly<z.infer<typeof projectionSchema>>;

declare const issuedProjectionBrand: unique symbol;
export interface IssuedTestImpactProjection extends TestImpactProjectionReceipt {
  readonly [issuedProjectionBrand]: true;
}

const issuedProjections = new WeakSet<object>();

function referenceOrder(left: SourceProgramReference, right: SourceProgramReference): number {
  return compareCodeUnits(
    `${left.path}\0${left.moduleSpecifier ?? ''}\0${left.name}\0${left.targetPath ?? ''}`,
    `${right.path}\0${right.moduleSpecifier ?? ''}\0${right.name}\0${right.targetPath ?? ''}`
  );
}

function compactReference(reference: SourceProgramReference): z.infer<typeof semanticReferenceSchema> {
  return {
    path: normalizeSecRepositoryPath(reference.path),
    moduleSpecifier: reference.moduleSpecifier,
    targetPath: reference.targetPath === null ? null : normalizeSecRepositoryPath(reference.targetPath),
    precise: reference.name !== '*'
      && reference.targetObservationId !== null
      && reference.targetPath !== null
  };
}

function moduleReferenceKey(reference: z.infer<typeof moduleReferenceSchema>): string {
  return `${reference.from}\0${reference.kind}\0${reference.typeOnly}\0${reference.specifier}\0${reference.resolvedTarget ?? ''}`;
}

function semanticReferenceKey(reference: z.infer<typeof semanticReferenceSchema>): string {
  return `${reference.path}\0${reference.moduleSpecifier ?? ''}\0${reference.targetPath ?? ''}\0${reference.precise}`;
}

function assertUniqueSorted(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodeUnits(values[index - 1]!, values[index]!) >= 0) {
      throw new Error(`${label} must be unique and sorted`);
    }
  }
}

function validateCanonicalProjection(value: TestImpactProjectionReceipt): void {
  assertUniqueSorted(value.files.map((file) => file.path), 'Test impact projection files');
  assertUniqueSorted(value.declarationPaths, 'Test impact declaration paths');
  assertUniqueSorted(value.moduleGraph.files, 'Test impact module graph files');
  assertUniqueSorted(value.moduleGraph.unresolvedFiles, 'Test impact unresolved module files');
  assertUniqueSorted(value.testFiles, 'Test impact test files');
  for (const reference of value.moduleGraph.references) {
    assertUniqueSorted(reference.candidateTargets, 'Test impact reference candidate targets');
  }
  assertUniqueSorted(value.moduleGraph.references.map(moduleReferenceKey), 'Test impact module references');
  assertUniqueSorted(value.semanticReferences.map(semanticReferenceKey), 'Test impact semantic references');
  const { projectionDigest, ...unsigned } = value;
  if (sha256(unsigned) !== projectionDigest) {
    throw new Error('Test impact projection digest is inconsistent');
  }
}

function assertProjectionInputsIssued(input: Readonly<{
  workspaceSnapshot: WorkspaceSourceSnapshot;
  typeScriptModel: SourceProgramModel;
  testObservations: SourceProgramTestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): void {
  const { workspaceSnapshot, typeScriptModel, testObservations, projectGeneration } = input;
  assertWorkspaceSourceSnapshot(workspaceSnapshot);
  if (projectGeneration !== undefined) assertRepositoryCompilationGenerationReceipt(projectGeneration);
  if (workspaceSnapshot.moduleGraphCompilationCount !== 1
      || typeScriptModel.sourceRevision !== workspaceSnapshot.sourceRevision
      || testObservations.sourceRevision !== workspaceSnapshot.sourceRevision
      || testObservations.productionModelDigest !== typeScriptModel.modelDigest
      || workspaceSourceSnapshotIdentityForTypeScriptModel(typeScriptModel) !== workspaceSnapshot.identityDigest
      || workspaceSourceSnapshotIdentityForTestObservations(testObservations) !== workspaceSnapshot.identityDigest
      || (projectGeneration !== undefined
        && (projectGeneration.workspaceSnapshotIdentityDigest !== workspaceSnapshot.identityDigest
          || projectGeneration.snapshotDigest !== workspaceSnapshot.snapshotDigest
          || projectGeneration.moduleMembershipDigest !== workspaceSnapshot.moduleMembershipDigest
          || projectGeneration.moduleGraphDigest !== workspaceSnapshot.moduleGraphDigest))) {
    throw new SecError(
      'SOURCE-PROGRAM-TEST-IMPACT-001',
      'Test impact projection requires snapshot-issued TypeScript and test observations',
      { kind: 'projection-input-unissued' }
    );
  }
}

function compileTestImpactProjection(input: Readonly<{
  workspaceSnapshot: WorkspaceSourceSnapshot;
  typeScriptModel: SourceProgramModel;
  testObservations: SourceProgramTestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): TestImpactProjectionReceipt {
  assertProjectionInputsIssued(input);
  const { workspaceSnapshot, typeScriptModel, testObservations } = input;
  const moduleGraph = workspaceSnapshot.moduleGraph;
  const semanticReferenceMap = new Map<string, z.infer<typeof semanticReferenceSchema>>();
  for (const reference of [
    ...typeScriptModel.references,
    ...testObservations.references
  ].sort(referenceOrder)) {
    const compact = compactReference(reference);
    semanticReferenceMap.set(semanticReferenceKey(compact), compact);
  }
  const unsigned: TestImpactProjectionUnsigned = {
    schema: SCHEMA,
    purpose: PURPOSE,
    subject: workspaceSnapshot.subject,
    subjectDigest: workspaceSnapshot.subjectDigest,
    sourceRevision: workspaceSnapshot.sourceRevision,
    snapshotDigest: workspaceSnapshot.snapshotDigest,
    moduleMembershipDigest: workspaceSnapshot.moduleMembershipDigest,
    moduleGraphDigest: workspaceSnapshot.moduleGraphDigest,
    workspaceSnapshotIdentityDigest: workspaceSnapshot.identityDigest,
    projectGenerationDigest: input.projectGeneration?.generationDigest ?? null,
    projectGenerationReceiptDigest: input.projectGeneration?.receiptDigest ?? null,
    productionModelDigest: typeScriptModel.modelDigest as `sha256:${string}`,
    testObservationDigest: testObservations.observationDigest as `sha256:${string}`,
    files: typeScriptModel.files
      .map(({ path, moduleId, surface }) => ({ path, moduleId, surface }))
      .sort((left, right) => compareCodeUnits(left.path, right.path)),
    declarationPaths: uniqueSorted(typeScriptModel.declarations.map(({ path }) => path)),
    moduleGraph: {
      files: uniqueSorted(moduleGraph.files.map(normalizeSecRepositoryPath)),
      references: moduleGraph.references.map((reference) => ({
        from: normalizeSecRepositoryPath(reference.from),
        kind: reference.kind,
        typeOnly: reference.typeOnly,
        specifier: reference.specifier,
        candidateTargets: uniqueSorted(reference.candidateTargets.map(normalizeSecRepositoryPath)),
        resolvedTarget: reference.resolvedTarget === null
          ? null
          : normalizeSecRepositoryPath(reference.resolvedTarget)
      })).sort((left, right) => compareCodeUnits(moduleReferenceKey(left), moduleReferenceKey(right))),
      unresolvedFiles: uniqueSorted(moduleGraph.unresolvedFiles.map(normalizeSecRepositoryPath))
    },
    testFiles: uniqueSorted(testObservations.testPaths.map(normalizeSecRepositoryPath)),
    semanticReferences: [...semanticReferenceMap.values()]
      .sort((left, right) => compareCodeUnits(semanticReferenceKey(left), semanticReferenceKey(right)))
  };
  const parsedUnsigned = projectionUnsignedSchema.parse(canonicalJson(unsigned));
  const projection = deepFreeze(projectionSchema.parse({
    ...parsedUnsigned,
    projectionDigest: sha256(parsedUnsigned)
  })) as TestImpactProjectionReceipt;
  validateCanonicalProjection(projection);
  return projection;
}

export function issueTestImpactProjection(input: Readonly<{
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot;
  typeScriptModel: SourceProgramModel;
  testObservations: SourceProgramTestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): IssuedTestImpactProjection {
  assertPhysicalWorkspaceSourceSnapshot(input.workspaceSnapshot);
  const projection = compileTestImpactProjection(input) as IssuedTestImpactProjection;
  issuedProjections.add(projection);
  return projection;
}

/** Unbound projection for codec and algorithm tests; never accepted by production providers. */
export function compileVirtualTestImpactProjection(input: Readonly<{
  workspaceSnapshot: VirtualWorkspaceSourceSnapshot;
  typeScriptModel: SourceProgramModel;
  testObservations: SourceProgramTestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): TestImpactProjectionReceipt {
  if (input.workspaceSnapshot.subject.kind !== 'virtual-mutation') {
    throw new Error('Virtual TestImpact projection requires a virtual workspace snapshot');
  }
  return compileTestImpactProjection(input);
}

export function assertIssuedTestImpactProjection(
  projection: TestImpactProjectionReceipt | undefined
): asserts projection is IssuedTestImpactProjection {
  if (projection === undefined || !issuedProjections.has(projection)) {
    throw new SecError(
      'SOURCE-PROGRAM-TEST-IMPACT-001',
      'Test impact requires an owner-issued compact Source Program projection',
      { kind: 'projection-unissued' }
    );
  }
}

export function encodeTestImpactProjectionReceipt(projection: TestImpactProjectionReceipt): string {
  const parsed = projectionSchema.parse(projection);
  validateCanonicalProjection(parsed);
  return JSON.stringify(canonicalJson(parsed));
}

/** Strict data codec only. Parsed bytes are not an issued TestImpact capability. */
export function parseTestImpactProjectionReceipt(source: string): TestImpactProjectionReceipt {
  const parsed = deepFreeze(projectionSchema.parse(parseExactJson(
    source,
    'Test impact projection receipt JSON'
  )));
  validateCanonicalProjection(parsed);
  return parsed;
}
