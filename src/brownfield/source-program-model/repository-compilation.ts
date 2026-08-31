import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type { SourceProgramModel, SourceProgramUnknown } from './contract.ts';
import type {
  RepositoryCompilationCacheDiagnostics,
  RepositoryCompilationCacheHint,
  RepositoryCompilationCacheLoad,
  RepositoryCompilationCacheProvider,
  RepositoryCompilationCacheReceipt,
  RepositoryCompilationGenerationReceipt
} from './repository-compilation-cache.ts';
import {
  assertExactRepositoryCompilationCacheLoad,
  assertRepositoryCompilationGenerationReceipt,
  issueRepositoryCompilationGenerationReceipt
} from './repository-compilation-cache.ts';
import {
  compileRepositorySourceProgramModelFromWorkspaceSnapshot
} from './repository.ts';
import {
  compileSourceProgramTestObservationsFromWorkspaceSnapshot,
  type SourceProgramTestObservations
} from './test-observations.ts';
import {
  adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot,
  compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot,
  sourceProgramTypeScriptCompilerIdentity,
  type CompileTypeScriptSourceProgramModelInput,
  type TypeScriptSourceProgramIncrementalResult,
  type TypeScriptSourceProgramIncrementalState
} from './typescript.ts';
import {
  assertPhysicalWorkspaceSourceSnapshot,
  assertWorkspaceSourceSnapshot,
  assertWorkspaceTypeScriptProjectInputMatchesSnapshot,
  type PhysicalWorkspaceSourceSnapshot,
  type VirtualWorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshot,
  type WorkspaceTypeScriptProjectInput
} from './workspace-source-snapshot.ts';

export type CompileRepositorySourceProgramCompilationInput = Readonly<{
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot;
  cacheProvider?: RepositoryCompilationCacheProvider;
  projectInput?: WorkspaceTypeScriptProjectInput;
  repositoryRoot?: string;
  reviewedProcessDispatchers?: readonly string[];
  unknowns?: readonly SourceProgramUnknown[];
}>;

export type CompileVirtualRepositorySourceProgramCompilationInput = Omit<
  CompileRepositorySourceProgramCompilationInput,
  'workspaceSnapshot'
> & Readonly<{ workspaceSnapshot: VirtualWorkspaceSourceSnapshot }>;

export interface RepositorySourceProgramCompilationReceipt {
  readonly subject: WorkspaceSourceSnapshot['subject'];
  readonly subjectDigest: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly snapshotDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly workspaceSnapshotIdentityDigest: `sha256:${string}`;
  readonly projectGeneration: RepositoryCompilationGenerationReceipt;
  readonly cacheReceipt: RepositoryCompilationCacheReceipt | null;
  readonly moduleGraphCompilationCount: 1;
  readonly typeScriptCompilation: TypeScriptSourceProgramIncrementalResult;
  readonly testObservations: SourceProgramTestObservations;
  readonly model: SourceProgramModel;
  readonly receiptDigest: `sha256:${string}`;
  readonly workspaceSnapshot: WorkspaceSourceSnapshot;
}

export interface RepositoryCompilationDiagnostics {
  readonly cache: RepositoryCompilationCacheDiagnostics;
  readonly modelAssemblyMs: number;
  readonly incrementalExactMs: number;
  readonly testObservationsMs: number;
  readonly repositoryProjectionMs: number;
}

const diagnosticsByContext = new WeakMap<object, RepositoryCompilationDiagnostics>();

/** Process-local diagnostic only; never serialized into a receipt or authority object. */
export function repositoryCompilationDiagnosticsForTests(
  snapshot: WorkspaceSourceSnapshot
): RepositoryCompilationDiagnostics | null {
  return diagnosticsByContext.get(snapshot) ?? null;
}

function loadedTypeScriptState(
  workspaceSnapshot: WorkspaceSourceSnapshot,
  input: CompileTypeScriptSourceProgramModelInput,
  loaded: Extract<
    RepositoryCompilationCacheLoad,
    { status: 'hit' }
  >
): TypeScriptSourceProgramIncrementalState {
  return adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot(
    input,
    loaded.shards,
    workspaceSnapshot,
    Object.freeze({ moduleGraphDigest: loaded.generation.moduleGraphDigest })
  );
}

function compileRepositorySourceProgramCompilationCore(
  input: CompileRepositorySourceProgramCompilationInput | CompileVirtualRepositorySourceProgramCompilationInput
): RepositorySourceProgramCompilationReceipt {
  const workspaceSnapshot = input.workspaceSnapshot;
  assertWorkspaceSourceSnapshot(workspaceSnapshot);
  if (input.projectInput !== undefined) {
    assertWorkspaceTypeScriptProjectInputMatchesSnapshot(input.projectInput, workspaceSnapshot);
  }
  const compiler = sourceProgramTypeScriptCompilerIdentity();
  const projectGeneration = issueRepositoryCompilationGenerationReceipt({
    projectInputDigest: input.projectInput?.projectInputDigest ?? null,
    projectConfigDigest: input.projectInput?.projectConfigDigest ?? null,
    workspaceSnapshotIdentityDigest: workspaceSnapshot.identityDigest,
    orderedSourceFactsDigest: input.projectInput?.orderedSourceFactsDigest
      ?? (sha256(workspaceSnapshot.files.map(({ path, contentDigest }) => ({ path, contentDigest }))) as `sha256:${string}`),
    snapshotDigest: workspaceSnapshot.snapshotDigest,
    moduleMembershipDigest: workspaceSnapshot.moduleMembershipDigest,
    moduleGraphDigest: workspaceSnapshot.moduleGraphDigest,
    compiler
  });
  let cacheHint: RepositoryCompilationCacheHint | null = null;
  let exactLoaded: RepositoryCompilationCacheLoad | null = null;
  let loaded: RepositoryCompilationCacheLoad | null = null;
  let cacheReceipt: RepositoryCompilationCacheReceipt | null = null;
  if (input.cacheProvider !== undefined && input.projectInput !== undefined) {
    try {
      cacheHint = input.cacheProvider.openContentAddressedHint(projectGeneration);
      if (cacheHint.keyDigest !== projectGeneration.generationDigest) {
        throw new Error('Runtime Cache returned a foreign content-addressed hint');
      }
      exactLoaded = cacheHint.loadExact();
      assertExactRepositoryCompilationCacheLoad(exactLoaded, projectGeneration);
      loaded = exactLoaded.status === 'hit' ? exactLoaded : cacheHint.loadPredecessor();
      if (loaded.status === 'hit') assertRepositoryCompilationGenerationReceipt(loaded.generation);
      cacheReceipt = exactLoaded.status === 'hit' ? exactLoaded.cacheReceipt : null;
    } catch {
      // Runtime Cache is disposable acceleration. Invalid, foreign or
      // physically unavailable cache state must never become compilation
      // availability authority while the current exact inputs are present.
      cacheHint = null;
      exactLoaded = null;
      loaded = null;
      cacheReceipt = null;
    }
  }
  const modelAssemblyStarted = performance.now();
  const typeScriptInput = Object.freeze({
    sourceRevision: workspaceSnapshot.sourceRevision,
    files: workspaceSnapshot.files,
    moduleMembership: workspaceSnapshot.moduleMembership
  });
  let cachedState: TypeScriptSourceProgramIncrementalState | null = null;
  if (loaded?.status === 'hit') {
    try {
      cachedState = loadedTypeScriptState(workspaceSnapshot, typeScriptInput, loaded);
    } catch {
      // Runtime Cache may return bytes that passed its physical grammar but do
      // not belong to this semantic input. Source Program rejects the hint and
      // compiles the exact current snapshot cold.
      cacheHint = null;
      exactLoaded = null;
      loaded = null;
      cacheReceipt = null;
    }
  }
  const modelAssemblyMs = performance.now() - modelAssemblyStarted;
  const incrementalExactStarted = performance.now();
  const typeScriptCompilation = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(
    typeScriptInput,
    cachedState,
    workspaceSnapshot
  );
  const incrementalExactMs = performance.now() - incrementalExactStarted;
  const testObservationInput = Object.freeze({
    productionModel: typeScriptCompilation.model,
    files: workspaceSnapshot.files,
    moduleMembership: workspaceSnapshot.moduleMembership,
    ...(input.repositoryRoot === undefined ? {} : { repositoryRoot: input.repositoryRoot })
  });
  const testObservationsStarted = performance.now();
  const testObservations = compileSourceProgramTestObservationsFromWorkspaceSnapshot(
    testObservationInput,
    workspaceSnapshot
  );
  const testObservationsMs = performance.now() - testObservationsStarted;
  const repositoryInput = Object.freeze({
    sourceRevision: workspaceSnapshot.sourceRevision,
    files: workspaceSnapshot.files,
    moduleMembership: workspaceSnapshot.moduleMembership,
    typescriptModel: typeScriptCompilation.model,
    testObservations,
    ...(input.reviewedProcessDispatchers === undefined
      ? {}
      : { reviewedProcessDispatchers: input.reviewedProcessDispatchers }),
    ...(input.unknowns === undefined ? {} : { unknowns: input.unknowns })
  });
  const repositoryProjectionStarted = performance.now();
  const model = compileRepositorySourceProgramModelFromWorkspaceSnapshot(repositoryInput, workspaceSnapshot);
  const repositoryProjectionMs = performance.now() - repositoryProjectionStarted;
  if (cacheHint !== null && exactLoaded?.status !== 'hit') {
    try {
      const published = cacheHint.publish(typeScriptCompilation.state.factShards);
      if (published.status === 'hit') {
        assertExactRepositoryCompilationCacheLoad(published, projectGeneration);
        cacheReceipt = published.cacheReceipt;
      }
    } catch {
      // A failed cache publication cannot change the canonical compilation
      // result. The next operation may rebuild or retire the disposable bytes.
    }
  }
  if (loaded?.status === 'hit') {
    diagnosticsByContext.set(workspaceSnapshot, Object.freeze({
      cache: loaded.diagnostics,
      modelAssemblyMs,
      incrementalExactMs,
      testObservationsMs,
      repositoryProjectionMs
    }));
  }
  const canonical = Object.freeze({
    schema: 'sec-repository-source-program-compilation-receipt-v1',
    subjectDigest: workspaceSnapshot.subjectDigest,
    sourceRevision: workspaceSnapshot.sourceRevision,
    snapshotDigest: workspaceSnapshot.snapshotDigest,
    moduleMembershipDigest: workspaceSnapshot.moduleMembershipDigest,
    moduleGraphDigest: workspaceSnapshot.moduleGraphDigest,
    workspaceSnapshotIdentityDigest: workspaceSnapshot.identityDigest,
    projectGenerationReceiptDigest: projectGeneration.receiptDigest,
    typeScriptModelDigest: typeScriptCompilation.model.modelDigest,
    testObservationDigest: testObservations.observationDigest,
    repositoryModelDigest: model.modelDigest
  });
  return Object.freeze({
    subject: workspaceSnapshot.subject,
    subjectDigest: workspaceSnapshot.subjectDigest,
    sourceRevision: workspaceSnapshot.sourceRevision,
    snapshotDigest: workspaceSnapshot.snapshotDigest,
    moduleMembershipDigest: workspaceSnapshot.moduleMembershipDigest,
    moduleGraphDigest: workspaceSnapshot.moduleGraphDigest,
    workspaceSnapshotIdentityDigest: workspaceSnapshot.identityDigest,
    projectGeneration,
    cacheReceipt,
    moduleGraphCompilationCount: workspaceSnapshot.moduleGraphCompilationCount,
    typeScriptCompilation,
    testObservations,
    model,
    receiptDigest: sha256(canonical) as `sha256:${string}`,
    workspaceSnapshot
  });
}

export function compileRepositorySourceProgramCompilation(
  input: CompileRepositorySourceProgramCompilationInput
): RepositorySourceProgramCompilationReceipt {
  assertPhysicalWorkspaceSourceSnapshot(input.workspaceSnapshot);
  return compileRepositorySourceProgramCompilationCore(input);
}

/** Pure/unbound compiler for virtual reductions and synthetic algorithm tests. */
export function compileVirtualRepositorySourceProgramCompilation(
  input: CompileVirtualRepositorySourceProgramCompilationInput
): RepositorySourceProgramCompilationReceipt {
  assertWorkspaceSourceSnapshot(input.workspaceSnapshot);
  if (input.workspaceSnapshot.subject.kind !== 'virtual-mutation') {
    throw new Error('Virtual Source Program compilation requires a virtual workspace snapshot');
  }
  return compileRepositorySourceProgramCompilationCore(input);
}
