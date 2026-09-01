import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  resolveSourceProgramCompilationOperation,
  sourceProgramCompilationCheckpoint,
  SourceProgramCompilationInterruptedError,
  sourceProgramCompilationPhaseEvents,
  type SourceProgramCompilationOperation,
  type SourceProgramCompilationPhaseEvent
} from './compilation-operation.ts';
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
  sourceProgramTypeScriptRequiredApiClosure,
  type CompileTypeScriptSourceProgramModelInput,
  type SourceProgramTypeScriptRequiredApiClosure,
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
  operation?: SourceProgramCompilationOperation;
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
  readonly semanticSourceDigests: Readonly<Record<string, `sha256:${string}`>>;
  readonly projectGeneration: RepositoryCompilationGenerationReceipt;
  readonly cacheReceipt: RepositoryCompilationCacheReceipt | null;
  readonly moduleGraphCompilationCount: 1;
  readonly typeScriptCompilation: TypeScriptSourceProgramIncrementalResult;
  readonly typeScriptRequiredApiClosure: SourceProgramTypeScriptRequiredApiClosure;
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
  readonly phaseEvents: readonly SourceProgramCompilationPhaseEvent[];
}

const diagnosticsByContext = new WeakMap<object, RepositoryCompilationDiagnostics>();
const issuedRepositorySourceProgramCompilationReceipts = new WeakSet<object>();

export function assertRepositorySourceProgramCompilationReceipt(
  receipt: RepositorySourceProgramCompilationReceipt
): void {
  if (!issuedRepositorySourceProgramCompilationReceipts.has(receipt)) {
    throw new Error('Source Program placement requires one compiler-issued compilation receipt');
  }
  assertWorkspaceSourceSnapshot(receipt.workspaceSnapshot);
  if (receipt.model.sourceRevision !== receipt.sourceRevision
      || receipt.workspaceSnapshot.identityDigest !== receipt.workspaceSnapshotIdentityDigest
      || receipt.workspaceSnapshot.snapshotDigest !== receipt.snapshotDigest
      || receipt.workspaceSnapshot.moduleGraphDigest !== receipt.moduleGraphDigest
      || receipt.workspaceSnapshot.moduleMembershipDigest !== receipt.moduleMembershipDigest
      || sha256(receipt.semanticSourceDigests)
        !== sha256(receipt.typeScriptCompilation.state.semanticSourceDigests)) {
    throw new Error('Source Program compilation receipt identity is not current');
  }
}

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
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  sourceProgramCompilationCheckpoint(operation, 'admission', 'start');
  const workspaceSnapshot = input.workspaceSnapshot;
  assertWorkspaceSourceSnapshot(workspaceSnapshot);
  if (input.projectInput !== undefined) {
    assertWorkspaceTypeScriptProjectInputMatchesSnapshot(input.projectInput, workspaceSnapshot);
  }
  sourceProgramCompilationCheckpoint(operation, 'admission', 'complete');
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
  sourceProgramCompilationCheckpoint(operation, 'cache-read', 'start');
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
  sourceProgramCompilationCheckpoint(operation, 'cache-read', 'complete');
  const modelAssemblyStarted = performance.now();
  const typeScriptInput = Object.freeze({
    sourceRevision: workspaceSnapshot.sourceRevision,
    files: workspaceSnapshot.files,
    moduleMembership: workspaceSnapshot.moduleMembership,
    operation
  });
  let cachedState: TypeScriptSourceProgramIncrementalState | null = null;
  if (loaded?.status === 'hit') {
    sourceProgramCompilationCheckpoint(operation, 'fact-shard-assembly', 'start');
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
    sourceProgramCompilationCheckpoint(operation, 'fact-shard-assembly', 'complete');
  }
  const modelAssemblyMs = performance.now() - modelAssemblyStarted;
  const incrementalExactStarted = performance.now();
  let typeScriptCompilation: TypeScriptSourceProgramIncrementalResult;
  try {
    typeScriptCompilation = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(
      typeScriptInput,
      cachedState,
      workspaceSnapshot
    );
  } catch (error) {
    if (cachedState === null || error instanceof SourceProgramCompilationInterruptedError) throw error;
    cacheHint = null;
    exactLoaded = null;
    loaded = null;
    cacheReceipt = null;
    typeScriptCompilation = compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot(
      typeScriptInput,
      null,
      workspaceSnapshot
    );
  }
  const typeScriptRequiredApiClosure = sourceProgramTypeScriptRequiredApiClosure(
    typeScriptCompilation.model
  );
  if (typeScriptRequiredApiClosure === null) {
    throw new Error('Repository compilation lacks one exact TypeScript API requirement closure');
  }
  const incrementalExactMs = performance.now() - incrementalExactStarted;
  const testObservationInput = Object.freeze({
    productionModel: typeScriptCompilation.model,
    files: workspaceSnapshot.files,
    moduleMembership: workspaceSnapshot.moduleMembership,
    operation,
    ...(input.repositoryRoot === undefined ? {} : { repositoryRoot: input.repositoryRoot })
  });
  sourceProgramCompilationCheckpoint(operation, 'test-observations', 'start');
  const testObservationsStarted = performance.now();
  const testObservations = compileSourceProgramTestObservationsFromWorkspaceSnapshot(
    testObservationInput,
    workspaceSnapshot
  );
  const testObservationsMs = performance.now() - testObservationsStarted;
  sourceProgramCompilationCheckpoint(operation, 'test-observations', 'complete');
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
  sourceProgramCompilationCheckpoint(operation, 'repository-projection', 'start');
  const repositoryProjectionStarted = performance.now();
  const model = compileRepositorySourceProgramModelFromWorkspaceSnapshot(repositoryInput, workspaceSnapshot);
  const repositoryProjectionMs = performance.now() - repositoryProjectionStarted;
  sourceProgramCompilationCheckpoint(operation, 'repository-projection', 'complete');
  if (cacheHint !== null && exactLoaded?.status !== 'hit') {
    sourceProgramCompilationCheckpoint(operation, 'cache-publish', 'start');
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
    sourceProgramCompilationCheckpoint(operation, 'cache-publish', 'complete');
  }
  sourceProgramCompilationCheckpoint(operation, 'settlement', 'start');
  const canonical = Object.freeze({
    schema: 'sec-repository-source-program-compilation-receipt-v1',
    subjectDigest: workspaceSnapshot.subjectDigest,
    sourceRevision: workspaceSnapshot.sourceRevision,
    snapshotDigest: workspaceSnapshot.snapshotDigest,
    moduleMembershipDigest: workspaceSnapshot.moduleMembershipDigest,
    moduleGraphDigest: workspaceSnapshot.moduleGraphDigest,
    workspaceSnapshotIdentityDigest: workspaceSnapshot.identityDigest,
    semanticSourceDigests: typeScriptCompilation.state.semanticSourceDigests,
    projectGenerationReceiptDigest: projectGeneration.receiptDigest,
    typeScriptModelDigest: typeScriptCompilation.model.modelDigest,
    typeScriptRequiredApiClosureDigest: typeScriptRequiredApiClosure.closureDigest,
    testObservationDigest: testObservations.observationDigest,
    repositoryModelDigest: model.modelDigest
  });
  const receipt: RepositorySourceProgramCompilationReceipt = Object.freeze({
    subject: workspaceSnapshot.subject,
    subjectDigest: workspaceSnapshot.subjectDigest,
    sourceRevision: workspaceSnapshot.sourceRevision,
    snapshotDigest: workspaceSnapshot.snapshotDigest,
    moduleMembershipDigest: workspaceSnapshot.moduleMembershipDigest,
    moduleGraphDigest: workspaceSnapshot.moduleGraphDigest,
    workspaceSnapshotIdentityDigest: workspaceSnapshot.identityDigest,
    semanticSourceDigests: typeScriptCompilation.state.semanticSourceDigests,
    projectGeneration,
    cacheReceipt,
    moduleGraphCompilationCount: workspaceSnapshot.moduleGraphCompilationCount,
    typeScriptCompilation,
    typeScriptRequiredApiClosure,
    testObservations,
    model,
    receiptDigest: sha256(canonical) as `sha256:${string}`,
    workspaceSnapshot
  });
  issuedRepositorySourceProgramCompilationReceipts.add(receipt);
  sourceProgramCompilationCheckpoint(operation, 'settlement', 'complete');
  diagnosticsByContext.set(workspaceSnapshot, Object.freeze({
    cache: loaded?.status === 'hit'
      ? loaded.diagnostics
      : Object.freeze({ physicalBytes: 0, semanticParseMs: 0 }),
    modelAssemblyMs,
    incrementalExactMs,
    testObservationsMs,
    repositoryProjectionMs,
    phaseEvents: sourceProgramCompilationPhaseEvents(operation)
  }));
  return receipt;
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
