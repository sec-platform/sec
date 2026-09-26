import { z } from 'zod';

import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  sha256,
  uniqueSorted
} from '../../../contracts/canonical.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import { FailureError } from '../../../contracts/failure.ts';
import { normalizeRepositoryModulePath } from '../architecture/contract.ts';
import type {
  SourceProgramEntrypointKind,
  SourceProgramModel,
  SourceProgramReference
} from './contract.ts';
import {
  assertRepositoryCompilationGenerationReceipt,
  type RepositoryCompilationGenerationReceipt
} from './repository-compilation-cache.ts';
import { isCompiledRepositoryModel } from './repository.ts';
import {
  snapshotIdentityForTestObservations,
  type TestObservations
} from './test-observations.ts';
import { workspaceSnapshotIdentityForTypeScriptModel } from './typescript.ts';
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
const SCHEMA = 'sec-source-program-test-impact-projection-v5' as const;

const digestSchema = z.string().regex(DIGEST);
const repositoryPathSchema = z.string().min(1).refine(
  (value) => normalizeRepositoryModulePath(value) === value,
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
    }).strict(),
    z.object({
      kind: z.literal('staged-index-observation'),
      identityDigest: digestSchema,
      indexDigest: digestSchema,
      indexTreeDigest: digestSchema,
      indexPhysicalIdentityDigest: digestSchema,
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
const moduleOwnerSchema = z.object({
  moduleId: z.string().min(1),
  root: repositoryPathSchema
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
const entrypointSchema = z.object({
  path: repositoryPathSchema,
  targetPaths: z.array(repositoryPathSchema),
  kind: z.enum([
    'package-script',
    'package-bin',
    'cli-command',
    'module-entrypoint',
    'git-hook',
    'workflow'
  ] satisfies readonly SourceProgramEntrypointKind[])
}).strict();
const observedTestConsumerSchema = z.object({
  targetPath: repositoryPathSchema,
  testPath: repositoryPathSchema
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
  repositoryModelDigest: digestSchema,
  testObservationDigest: digestSchema,
  files: z.array(fileSchema),
  moduleOwners: z.array(moduleOwnerSchema),
  entrypoints: z.array(entrypointSchema),
  observedTestConsumers: z.array(observedTestConsumerSchema),
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
    path: normalizeRepositoryModulePath(reference.path),
    moduleSpecifier: reference.moduleSpecifier,
    targetPath: reference.targetPath === null ? null : normalizeRepositoryModulePath(reference.targetPath),
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

function observedTestConsumerKey(
  consumer: z.infer<typeof observedTestConsumerSchema>
): string {
  return `${consumer.targetPath}\0${consumer.testPath}`;
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
  assertUniqueSorted(
    value.moduleOwners.map(({ root, moduleId }) => `${root}\0${moduleId}`),
    'Test impact projection module owners'
  );
  const moduleOwnerIds = value.moduleOwners.map(({ moduleId }) => moduleId);
  if (new Set(moduleOwnerIds).size !== moduleOwnerIds.length) {
    throw new Error('Test impact projection module owner ids must be unique');
  }
  const moduleOwnerIdSet = new Set(moduleOwnerIds);
  const unknownModuleOwner = value.files.find(({ moduleId }) => (
    moduleId !== null && !moduleOwnerIdSet.has(moduleId)
  ));
  if (unknownModuleOwner !== undefined) {
    throw new Error(`Test impact projection file has an unknown module owner: ${unknownModuleOwner.path}`);
  }
  assertUniqueSorted(
    value.entrypoints.map(({ path: entrypointPath, kind }) => `${entrypointPath}\0${kind}`),
    'Test impact projection entrypoints'
  );
  for (const entrypoint of value.entrypoints) {
    assertUniqueSorted(entrypoint.targetPaths, 'Test impact entrypoint targets');
  }
  assertUniqueSorted(
    value.observedTestConsumers.map(observedTestConsumerKey),
    'Test impact observed test consumers'
  );
  assertUniqueSorted(value.declarationPaths, 'Test impact declaration paths');
  assertUniqueSorted(value.moduleGraph.files, 'Test impact module graph files');
  assertUniqueSorted(value.moduleGraph.unresolvedFiles, 'Test impact unresolved module files');
  assertUniqueSorted(value.testFiles, 'Test impact test files');
  const projectedPaths = new Set(value.files.map(({ path: projectedPath }) => projectedPath));
  const projectedTestPaths = new Set(value.testFiles);
  for (const entrypoint of value.entrypoints) {
    const outsideTarget = entrypoint.targetPaths.find((targetPath) => !projectedPaths.has(targetPath));
    if (outsideTarget !== undefined) {
      throw new Error(`Test impact entrypoint target must stay within its snapshot: ${outsideTarget}`);
    }
  }
  for (const consumer of value.observedTestConsumers) {
    if (!projectedPaths.has(consumer.targetPath)
        || !projectedTestPaths.has(consumer.testPath)) {
      throw new Error('Test impact observed consumer must stay within its snapshot');
    }
  }
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
  repositoryModel: SourceProgramModel;
  typeScriptModel: SourceProgramModel;
  testObservations: TestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): void {
  const { workspaceSnapshot, repositoryModel, typeScriptModel, testObservations, projectGeneration } = input;
  assertWorkspaceSourceSnapshot(workspaceSnapshot);
  if (projectGeneration !== undefined) assertRepositoryCompilationGenerationReceipt(projectGeneration);
  if (workspaceSnapshot.moduleGraphCompilationCount !== 1
      || !isCompiledRepositoryModel(repositoryModel)
      || repositoryModel.sourceRevision !== workspaceSnapshot.sourceRevision
      || typeScriptModel.sourceRevision !== workspaceSnapshot.sourceRevision
      || testObservations.sourceRevision !== workspaceSnapshot.sourceRevision
      || testObservations.productionModelDigest !== typeScriptModel.modelDigest
      || workspaceSnapshotIdentityForTypeScriptModel(typeScriptModel) !== workspaceSnapshot.identityDigest
      || snapshotIdentityForTestObservations(testObservations) !== workspaceSnapshot.identityDigest
      || (projectGeneration !== undefined
        && (projectGeneration.workspaceSnapshotIdentityDigest !== workspaceSnapshot.identityDigest
          || projectGeneration.snapshotDigest !== workspaceSnapshot.snapshotDigest
          || projectGeneration.moduleMembershipDigest !== workspaceSnapshot.moduleMembershipDigest
          || projectGeneration.moduleGraphDigest !== workspaceSnapshot.moduleGraphDigest))) {
    throw new FailureError(
      'SOURCE-PROGRAM-TEST-IMPACT-001',
      'Test impact projection requires snapshot-issued TypeScript and test observations',
      { kind: 'projection-input-unissued' }
    );
  }
}

function compileTestImpactProjection(input: Readonly<{
  workspaceSnapshot: WorkspaceSourceSnapshot;
  repositoryModel: SourceProgramModel;
  typeScriptModel: SourceProgramModel;
  testObservations: TestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): TestImpactProjectionReceipt {
  assertProjectionInputsIssued(input);
  const { workspaceSnapshot, repositoryModel, typeScriptModel, testObservations } = input;
  const moduleGraph = workspaceSnapshot.moduleGraph;
  const repositoryFilePaths = new Set(repositoryModel.files.map(({ path: repositoryPath }) => repositoryPath));
  const semanticReferenceMap = new Map<string, z.infer<typeof semanticReferenceSchema>>();
  for (const reference of [
    ...repositoryModel.references,
    ...testObservations.references
  ].sort(referenceOrder)) {
    const compact = compactReference(reference);
    semanticReferenceMap.set(semanticReferenceKey(compact), compact);
  }
  const observedTestConsumerMap = new Map<
    string,
    z.infer<typeof observedTestConsumerSchema>
  >();
  for (const { path: testPath, target: targetPath } of [
    ...testObservations.productionSourceReads,
    ...testObservations.resourceReads
  ]) {
    const consumer = Object.freeze({
      targetPath: normalizeRepositoryModulePath(targetPath),
      testPath: normalizeRepositoryModulePath(testPath)
    });
    observedTestConsumerMap.set(observedTestConsumerKey(consumer), consumer);
  }
  for (const { path: testPath, target: targetPath } of testObservations.localProgramInvocations) {
    const consumer = Object.freeze({
      targetPath: normalizeRepositoryModulePath(targetPath),
      testPath: normalizeRepositoryModulePath(testPath)
    });
    observedTestConsumerMap.set(observedTestConsumerKey(consumer), consumer);
  }
  for (const registration of testObservations.registrations) {
    for (const targetPath of registration.observedProductionPaths) {
      const consumer = Object.freeze({
        targetPath: normalizeRepositoryModulePath(targetPath),
        testPath: normalizeRepositoryModulePath(registration.path)
      });
      observedTestConsumerMap.set(observedTestConsumerKey(consumer), consumer);
    }
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
    repositoryModelDigest: repositoryModel.modelDigest as `sha256:${string}`,
    testObservationDigest: testObservations.observationDigest as `sha256:${string}`,
    files: repositoryModel.files
      .map(({ path, moduleId, surface }) => ({ path, moduleId, surface }))
      .sort((left, right) => compareCodeUnits(left.path, right.path)),
    moduleOwners: workspaceSnapshot.moduleMembership.descriptors
      .map(({ moduleId, root }) => ({
        moduleId,
        root: normalizeRepositoryModulePath(root)
      }))
      .sort((left, right) => compareCodeUnits(
        `${left.root}\0${left.moduleId}`,
        `${right.root}\0${right.moduleId}`
      )),
    entrypoints: [...new Map(repositoryModel.entrypoints.map(({ path: entrypointPath, targetPaths, kind }) => [
      `${entrypointPath}\0${kind}`,
      Object.freeze({
        path: entrypointPath,
        targetPaths: uniqueSorted(targetPaths.filter((targetPath) => repositoryFilePaths.has(targetPath))),
        kind
      })
    ])).values()].sort((left, right) => compareCodeUnits(
      `${left.path}\0${left.kind}`,
      `${right.path}\0${right.kind}`
    )),
    observedTestConsumers: [...observedTestConsumerMap.values()]
      .sort((left, right) => compareCodeUnits(
        observedTestConsumerKey(left),
        observedTestConsumerKey(right)
      )),
    declarationPaths: uniqueSorted(repositoryModel.declarations.map(({ path }) => path)),
    moduleGraph: {
      files: uniqueSorted(moduleGraph.files.map(normalizeRepositoryModulePath)),
      references: moduleGraph.references.map((reference) => ({
        from: normalizeRepositoryModulePath(reference.from),
        kind: reference.kind,
        typeOnly: reference.typeOnly,
        specifier: reference.specifier,
        candidateTargets: uniqueSorted(reference.candidateTargets.map(normalizeRepositoryModulePath)),
        resolvedTarget: reference.resolvedTarget === null
          ? null
          : normalizeRepositoryModulePath(reference.resolvedTarget)
      })).sort((left, right) => compareCodeUnits(moduleReferenceKey(left), moduleReferenceKey(right))),
      unresolvedFiles: uniqueSorted(moduleGraph.unresolvedFiles.map(normalizeRepositoryModulePath))
    },
    testFiles: uniqueSorted(testObservations.testPaths.map(normalizeRepositoryModulePath)),
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
  repositoryModel: SourceProgramModel;
  typeScriptModel: SourceProgramModel;
  testObservations: TestObservations;
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
  repositoryModel: SourceProgramModel;
  typeScriptModel: SourceProgramModel;
  testObservations: TestObservations;
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
    throw new FailureError(
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
