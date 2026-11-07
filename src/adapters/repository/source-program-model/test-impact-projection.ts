import { z } from 'zod';
import { AUTHOR_KERNEL_GRAMMAR_MANIFEST, authorKernelDeclaredInputPaths } from '../../../contracts/author-kernel-verification.ts';
import { AUTHOR_NATIVE_METHOD_IDS, authorNativeMethodTypeScriptClosure, compileAuthorNativeMethodUnits, isAuthorNativeMethodCatalogPresent, type AuthorNativeMethodUnit } from '../../../contracts/author-native-methods.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../contracts/repository-path.ts';

import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  sha256,
  uniqueSorted
} from '../../../contracts/canonical.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import { CodedFailure } from '../../../contracts/failure.ts';
import type { GitReadSession } from '../../providers/git-read/runtime/session.ts';
import { normalizeRepositoryPath } from '../architecture/contract.ts';
import type {
  SourceProgramEntrypointKind,
  SourceProgramModel,
  SourceProgramReference
} from './contract.ts';
import {
  assertRepositoryCompilationGenerationReceipt,
  type RepositoryCompilationGenerationReceipt
} from './repository-compilation-cache.ts';
import { isCompiledRepositorySourceProgramModel } from './repository.ts';
import {
  workspaceSourceSnapshotIdentityForTestObservations,
  type SourceProgramTestObservations
} from './test-observations.ts';
import { workspaceSourceSnapshotIdentityForTypeScriptModel } from './typescript.ts';
import { retainWorkingSourceInputGeneration, type RetainedWorkingSourceInputGeneration } from './workspace-source-authority.ts';
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
const SCHEMA = 'sec-source-program-test-impact-projection-v6' as const;

const digestSchema = z.string().regex(DIGEST);
const repositoryPathSchema = z.string().min(1).refine(
  (value) => normalizeRepositoryPath(value) === value,
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
  contentDigest: digestSchema,
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
  resolutionLookupPaths: z.array(repositoryPathSchema),
  resolvedTarget: repositoryPathSchema.nullable(),
  runtime: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('module'), target: repositoryPathSchema }).strict(),
    z.object({ kind: z.literal('asset'), target: repositoryPathSchema }).strict(),
    z.object({ kind: z.literal('external') }).strict(),
    z.object({ kind: z.literal('unresolved') }).strict(),
    z.object({ kind: z.literal('none') }).strict()
  ])
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
const nativePathSchema = z.string().refine(CodexDevelopmentIsCanonicalRepositoryPath, 'Native method path must be canonical');
const nativeMethodSchema = z.object({
  id: z.enum(AUTHOR_NATIVE_METHOD_IDS),
  owner: z.literal('adapters.compilation'),
  phase: z.enum(['quick', 'risk']),
  inputs: z.array(z.object({ path: nativePathSchema, contentDigest: digestSchema.nullable() }).strict()),
  selectionPaths: z.array(nativePathSchema),
  absentLookupPaths: z.array(nativePathSchema),
  unresolvedInputs: z.array(nativePathSchema),
  inputClosureDigest: digestSchema
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
  semanticReferences: z.array(semanticReferenceSchema),
  nativeMethods: z.array(nativeMethodSchema),
  nativeDeclarationPaths: z.array(nativePathSchema)
}).strict();
const projectionSchema = projectionUnsignedSchema.extend({
  projectionDigest: digestSchema
}).strict();

type TestImpactProjectionUnsigned = Omit<z.infer<typeof projectionUnsignedSchema>, 'nativeMethods'> & Readonly<{
  nativeMethods: readonly AuthorNativeMethodUnit[];
}>;
export type TestImpactProjectionReceipt = Readonly<z.infer<typeof projectionSchema>>;

declare const issuedProjectionBrand: unique symbol;
export interface IssuedTestImpactProjection extends TestImpactProjectionReceipt {
  readonly [issuedProjectionBrand]: true;
}

const issuedProjections = new WeakSet<object>();
const projectionSourceSnapshots = new WeakMap<object, PhysicalWorkspaceSourceSnapshot>();

function referenceOrder(left: SourceProgramReference, right: SourceProgramReference): number {
  return compareCodeUnits(
    `${left.path}\0${left.moduleSpecifier ?? ''}\0${left.name}\0${left.targetPath ?? ''}`,
    `${right.path}\0${right.moduleSpecifier ?? ''}\0${right.name}\0${right.targetPath ?? ''}`
  );
}

function compactReference(reference: SourceProgramReference): z.infer<typeof semanticReferenceSchema> {
  return {
    path: normalizeRepositoryPath(reference.path),
    moduleSpecifier: reference.moduleSpecifier,
    targetPath: reference.targetPath === null ? null : normalizeRepositoryPath(reference.targetPath),
    precise: reference.name !== '*'
      && reference.targetObservationId !== null
      && reference.targetPath !== null
  };
}

function moduleReferenceKey(reference: z.infer<typeof moduleReferenceSchema>): string {
  return `${reference.from}\0${reference.kind}\0${reference.typeOnly}\0${reference.specifier}\0${reference.resolvedTarget ?? ''}\0${JSON.stringify(reference.runtime)}`;
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

function validateNativeMethods(value: TestImpactProjectionReceipt): void {
  const files = new Map(value.files.map(file => [file.path, file.contentDigest] as const));
  const expected = isAuthorNativeMethodCatalogPresent([...files.keys()]) ? AUTHOR_NATIVE_METHOD_IDS : [];
  const identities = value.nativeMethods.map(method => method.id);
  assertUniqueSorted(identities, 'Test impact native method identities');
  if (JSON.stringify(identities) !== JSON.stringify(expected)) {
    throw new Error('Test impact native inventory does not match its source presence');
  }
  assertUniqueSorted(value.nativeDeclarationPaths, 'Test impact native declaration paths');
  const cargoInputs = new Set(value.nativeMethods.find(method => method.id === 'cargo-tests')?.inputs.map(input => input.path) ?? []);
  if (value.nativeDeclarationPaths.some(path => !cargoInputs.has(path))) {
    throw new Error('Test impact native declarations have no corresponding Cargo input');
  }
  for (const method of value.nativeMethods) {
    if (method.phase !== (method.id === 'target-check' ? 'risk' : 'quick')) {
      throw new Error('Test impact native method phase is inconsistent');
    }
    assertUniqueSorted(method.inputs.map(input => input.path), 'Test impact native inputs');
    assertUniqueSorted(method.selectionPaths, 'Test impact native selection paths');
    assertUniqueSorted(method.absentLookupPaths, 'Test impact native negative lookups');
    assertUniqueSorted(method.unresolvedInputs, 'Test impact native unresolved inputs');
    const required = new Set(method.inputs.map(input => input.path));
    const absent = new Set(method.absentLookupPaths);
    const unresolved = new Set(method.unresolvedInputs);
    const selection = new Set(method.selectionPaths);
    const closure = authorNativeMethodTypeScriptClosure(method.id, {
      filePaths: [...files.keys()], moduleGraph: value.moduleGraph
    });
    for (const input of method.inputs) {
      const digest = files.get(input.path) ?? null;
      if (input.contentDigest !== digest || (digest === null && !unresolved.has(input.path))) {
        throw new Error('Test impact native input differs from its snapshot or unresolved frontier');
      }
    }
    if (method.unresolvedInputs.some(path => !required.has(path))
        || method.selectionPaths.some(path => !required.has(path) && !absent.has(path))) {
      throw new Error('Test impact native frontier selects an unrelated source');
    }
    if (closure.requiredPaths.some(path => !required.has(path))
        || closure.selectionPaths.some(path => !selection.has(path))) {
      throw new Error('Test impact native closure omitted a compiler-observed input');
    }
    const expectedUnresolved = uniqueSorted([
      ...closure.unresolvedPaths, ...method.inputs.filter(input => !files.has(input.path)).map(input => input.path)
    ]);
    if (JSON.stringify(method.unresolvedInputs) !== JSON.stringify(expectedUnresolved)) {
      throw new Error('Test impact native closure differs from its unresolved module frontier');
    }
    if (JSON.stringify(method.absentLookupPaths) !== JSON.stringify(closure.absentLookupPaths)
        || method.absentLookupPaths.some(path => files.has(path) || !selection.has(path))) {
      throw new Error('Test impact native negative lookup has no matching absent source observation');
    }
    const { inputClosureDigest, ...fields } = method;
    if (sha256(fields) !== inputClosureDigest) throw new Error('Test impact native input digest is inconsistent');
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
    assertUniqueSorted(reference.resolutionLookupPaths, 'Test impact reference resolution lookups');
    if (reference.resolutionLookupPaths.some((path) => !reference.candidateTargets.includes(path))) {
      throw new Error('Test impact resolution lookup is absent from its input candidates');
    }
    if (reference.typeOnly !== (reference.runtime.kind === 'none')) {
      throw new Error('Test impact erased imports cannot carry a runtime relation');
    }
    if ('target' in reference.runtime && (!projectedPaths.has(reference.runtime.target)
        || !reference.candidateTargets.includes(reference.runtime.target))) {
      throw new Error('Test impact runtime target is outside its captured inputs');
    }
    if (reference.runtime.kind === 'module' && (reference.runtime.target !== reference.resolvedTarget
        || /\.d\.[cm]?ts$/u.test(reference.runtime.target))) {
      throw new Error('Test impact module evaluation differs from its compiler source address');
    }
    if (reference.runtime.kind === 'unresolved'
        && !value.moduleGraph.unresolvedFiles.includes(reference.from)) {
      throw new Error('Test impact omitted an unresolved runtime import');
    }
  }
  assertUniqueSorted(value.moduleGraph.references.map(moduleReferenceKey), 'Test impact module references');
  assertUniqueSorted(value.semanticReferences.map(semanticReferenceKey), 'Test impact semantic references');
  validateNativeMethods(value);
  const { projectionDigest, ...unsigned } = value;
  if (sha256(unsigned) !== projectionDigest) {
    throw new Error('Test impact projection digest is inconsistent');
  }
}

function assertProjectionInputsIssued(input: Readonly<{
  workspaceSnapshot: WorkspaceSourceSnapshot;
  repositoryModel: SourceProgramModel;
  typeScriptModel: SourceProgramModel;
  testObservations: SourceProgramTestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): void {
  const { workspaceSnapshot, repositoryModel, typeScriptModel, testObservations, projectGeneration } = input;
  assertWorkspaceSourceSnapshot(workspaceSnapshot);
  if (projectGeneration !== undefined) assertRepositoryCompilationGenerationReceipt(projectGeneration);
  if (workspaceSnapshot.moduleGraphCompilationCount !== 1
      || !isCompiledRepositorySourceProgramModel(repositoryModel)
      || repositoryModel.sourceRevision !== workspaceSnapshot.sourceRevision
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
    throw new CodedFailure(
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
  testObservations: SourceProgramTestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): TestImpactProjectionReceipt {
  assertProjectionInputsIssued(input);
  const { workspaceSnapshot, repositoryModel, typeScriptModel, testObservations } = input;
  const moduleGraph = workspaceSnapshot.moduleGraph;
  const nativeMethods = compileAuthorNativeMethodUnits({ files: workspaceSnapshot.files, moduleGraph });
  const nativeManifest = workspaceSnapshot.file(AUTHOR_KERNEL_GRAMMAR_MANIFEST);
  const nativeDeclarationPaths = nativeMethods.length === 0 || nativeManifest === null ? []
    : [...authorKernelDeclaredInputPaths(nativeManifest.source)];
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
      targetPath: normalizeRepositoryPath(targetPath),
      testPath: normalizeRepositoryPath(testPath)
    });
    observedTestConsumerMap.set(observedTestConsumerKey(consumer), consumer);
  }
  for (const { path: testPath, target: targetPath } of testObservations.localProgramInvocations) {
    const consumer = Object.freeze({
      targetPath: normalizeRepositoryPath(targetPath),
      testPath: normalizeRepositoryPath(testPath)
    });
    observedTestConsumerMap.set(observedTestConsumerKey(consumer), consumer);
  }
  for (const registration of testObservations.registrations) {
    for (const targetPath of registration.observedProductionPaths) {
      const consumer = Object.freeze({
        targetPath: normalizeRepositoryPath(targetPath),
        testPath: normalizeRepositoryPath(registration.path)
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
      .map(({ path, moduleId, surface }) => {
        const source = workspaceSnapshot.file(path);
        if (source === null) throw new Error('Test impact source row has no corresponding snapshot bytes');
        return { path, moduleId, surface, contentDigest: source.contentDigest };
      })
      .sort((left, right) => compareCodeUnits(left.path, right.path)),
    moduleOwners: workspaceSnapshot.moduleMembership.descriptors
      .map(({ moduleId, root }) => ({
        moduleId,
        root: normalizeRepositoryPath(root)
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
      files: uniqueSorted(moduleGraph.files.map(normalizeRepositoryPath)),
      references: moduleGraph.references.map((reference) => ({
        from: normalizeRepositoryPath(reference.from),
        kind: reference.kind,
        typeOnly: reference.typeOnly,
        specifier: reference.specifier,
        candidateTargets: uniqueSorted(reference.candidateTargets.map(normalizeRepositoryPath)),
        resolutionLookupPaths: uniqueSorted(reference.resolutionLookupPaths.map(normalizeRepositoryPath)),
        resolvedTarget: reference.resolvedTarget === null
          ? null
          : normalizeRepositoryPath(reference.resolvedTarget),
        runtime: 'target' in reference.runtime
          ? { kind: reference.runtime.kind, target: normalizeRepositoryPath(reference.runtime.target) }
          : { kind: reference.runtime.kind }
      })).sort((left, right) => compareCodeUnits(moduleReferenceKey(left), moduleReferenceKey(right))),
      unresolvedFiles: uniqueSorted(moduleGraph.unresolvedFiles.map(normalizeRepositoryPath))
    },
    testFiles: uniqueSorted(testObservations.testPaths.map(normalizeRepositoryPath)),
    semanticReferences: [...semanticReferenceMap.values()]
      .sort((left, right) => compareCodeUnits(semanticReferenceKey(left), semanticReferenceKey(right))),
    nativeMethods,
    nativeDeclarationPaths
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
  testObservations: SourceProgramTestObservations;
  projectGeneration?: RepositoryCompilationGenerationReceipt;
}>): IssuedTestImpactProjection {
  assertPhysicalWorkspaceSourceSnapshot(input.workspaceSnapshot);
  const projection = compileTestImpactProjection(input) as IssuedTestImpactProjection;
  issuedProjections.add(projection);
  projectionSourceSnapshots.set(projection, input.workspaceSnapshot);
  return projection;
}

export async function retainTestImpactExecutionInputs(input: Readonly<{
  projection: TestImpactProjectionReceipt;
  session: GitReadSession;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<RetainedWorkingSourceInputGeneration> {
  assertIssuedTestImpactProjection(input.projection);
  const snapshot = projectionSourceSnapshots.get(input.projection);
  if (snapshot === undefined || snapshot.identityDigest !== input.projection.workspaceSnapshotIdentityDigest) {
    throw new CodedFailure('TEST-IMPACT-SOURCE-INPUTS-UNAVAILABLE', 'Issued projection has no matching original physical source input snapshot.');
  }
  return retainWorkingSourceInputGeneration({ snapshot, session: input.session,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    ...(input.signal === undefined ? {} : { signal: input.signal }) });
}

/** Unbound projection for codec and algorithm tests; never accepted by production providers. */
export function compileVirtualTestImpactProjection(input: Readonly<{
  workspaceSnapshot: VirtualWorkspaceSourceSnapshot;
  repositoryModel: SourceProgramModel;
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
    throw new CodedFailure(
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
