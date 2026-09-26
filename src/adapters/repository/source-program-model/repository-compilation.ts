import { deepFreeze, sha256 } from '../../../contracts/canonical.ts';
import {
  resolveSourceProgramCompilationOperation,
  sourceProgramCompilationCheckpoint,
  SourceProgramCompilationInterruptedError,
  sourceProgramCompilationPhaseEvents,
  type SourceProgramCompilationOperation,
  type SourceProgramCompilationPhaseEvent
} from './compilation-operation.ts';
import type { SourceProgramModel, SourceProgramUnknown } from './contract.ts';
import {
  captureRepositoryAnalysisPolicy,
  repositoryAnalysisPolicyDigest,
  type RepositoryAnalysisPolicy
} from './repository-analysis-policy.ts';
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
  compileRepositoryModelFromSnapshot
} from './repository.ts';
import {
  compileTestObservationsFromSnapshot,
  type TestObservations
} from './test-observations.ts';
import {
  adoptTypeScriptFactShards,
  compileTypeScriptModelIncrementalWithCompilation,
  typeScriptCompilerIdentity,
  currentTypeScriptRequiredApiClosure,
  type TypeScriptModelInput,
  type TypeScriptRequiredApiClosure,
  type TypeScriptIncrementalResult,
  type TypeScriptIncrementalState
} from './typescript.ts';
import {
  assertPhysicalWorkspaceSourceSnapshot,
  assertWorkspaceSourceSnapshot,
  assertTypeScriptProjectMatchesSnapshot,
  type PhysicalWorkspaceSourceSnapshot,
  type VirtualWorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshot,
  type TypeScriptProjectInput
} from './workspace-source-snapshot.ts';

export type CompileRepositorySourceProgramCompilationInput = Readonly<{
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot;
  cacheProvider?: RepositoryCompilationCacheProvider;
  cacheAccess?: 'read-only' | 'read-write';
  projectInput?: TypeScriptProjectInput;
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
  /** Exact captured analysis input, separate from reusable TypeScript syntax facts. */
  readonly analysisPolicy: RepositoryAnalysisPolicy;
  readonly projectGeneration: RepositoryCompilationGenerationReceipt;
  readonly cacheReceipt: RepositoryCompilationCacheReceipt | null;
  readonly moduleGraphCompilationCount: 1;
  readonly typeScriptCompilation: TypeScriptIncrementalResult;
  readonly typeScriptRequiredApiClosure: TypeScriptRequiredApiClosure;
  readonly testObservations: TestObservations;
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
  if (repositoryAnalysisPolicyDigest(receipt.analysisPolicy) === null
      || receipt.model.sourceRevision !== receipt.sourceRevision
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

/** Process-local observation for the runner that owns user-visible progress. */
export function repositoryCompilationDiagnostics(
  snapshot: WorkspaceSourceSnapshot
): RepositoryCompilationDiagnostics | null {
  return diagnosticsByContext.get(snapshot) ?? null;
}

function loadedTypeScriptState(
  workspaceSnapshot: WorkspaceSourceSnapshot,
  input: TypeScriptModelInput,
  loaded: Extract<
    RepositoryCompilationCacheLoad,
    { status: 'hit' }
  >
): TypeScriptIncrementalState {
  return adoptTypeScriptFactShards(
    input,
    loaded.shards,
    workspaceSnapshot,
    Object.freeze({ moduleGraphDigest: loaded.generation.moduleGraphDigest })
  );
}

function compileRepositorySourceProgramCompilationCore(
  input: CompileRepositorySourceProgramCompilationInput | CompileVirtualRepositorySourceProgramCompilationInput,
  snapshotKind: 'physical' | 'virtual'
): RepositorySourceProgramCompilationReceipt {
  // Capture request data before checkpoints, cache callbacks or compiler
  // observers can change it. Opaque snapshot/provider/operation identities are
  // retained, not cloned; additional unknown observations are plain owned data.
  const workspaceSnapshot = input.workspaceSnapshot;
  if (snapshotKind === 'physical') {
    assertPhysicalWorkspaceSourceSnapshot(workspaceSnapshot);
  } else {
    assertWorkspaceSourceSnapshot(workspaceSnapshot);
    if (workspaceSnapshot.subject.kind !== 'virtual-mutation') {
      throw new Error('Virtual Source Program compilation requires a virtual workspace snapshot');
    }
  }
  const { projectInput, cacheProvider, repositoryRoot, reviewedProcessDispatchers,
    unknowns: requestedUnknowns, operation: requestedOperation, cacheAccess = 'read-write' } = input;
  // Bind the effect mode before compiler telemetry or cache providers execute.
  // The direct physical and virtual entrypoints must not treat malformed input
  // as write permission, even when the physical cache wrapper is not used.
  if (cacheAccess !== 'read-only' && cacheAccess !== 'read-write') {
    throw new Error('Repository compilation cache access must be read-only or read-write.');
  }
  const analysisPolicy = captureRepositoryAnalysisPolicy(reviewedProcessDispatchers);
  const unknowns = requestedUnknowns === undefined ? undefined : deepFreeze(structuredClone(requestedUnknowns));
  const operation = resolveSourceProgramCompilationOperation(requestedOperation);
  sourceProgramCompilationCheckpoint(operation, 'admission', 'start');
  if (projectInput !== undefined) {
    assertTypeScriptProjectMatchesSnapshot(projectInput, workspaceSnapshot);
  }
  sourceProgramCompilationCheckpoint(operation, 'admission', 'complete');
  const compiler = typeScriptCompilerIdentity();
  const projectGeneration = issueRepositoryCompilationGenerationReceipt({
    projectInputDigest: projectInput?.projectInputDigest ?? null,
    projectConfigDigest: projectInput?.projectConfigDigest ?? null,
    workspaceSnapshotIdentityDigest: workspaceSnapshot.identityDigest,
    orderedSourceFactsDigest: projectInput?.orderedSourceFactsDigest
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
  if (cacheProvider !== undefined && projectInput !== undefined) {
    try {
      cacheHint = cacheProvider.openContentAddressedHint(projectGeneration);
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
  let cachedState: TypeScriptIncrementalState | null = null;
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
  let typeScriptCompilation: TypeScriptIncrementalResult;
  try {
    typeScriptCompilation = compileTypeScriptModelIncrementalWithCompilation(
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
    typeScriptCompilation = compileTypeScriptModelIncrementalWithCompilation(
      typeScriptInput,
      null,
      workspaceSnapshot
    );
  }
  const typeScriptRequiredApiClosure = currentTypeScriptRequiredApiClosure(
    typeScriptCompilation.model
  );
  if (typeScriptRequiredApiClosure === null) {
    throw new Error('Repository compilation lacks one exact TypeScript API requirement closure');
  }
  const incrementalExactMs = performance.now() - incrementalExactStarted;
  // TypeScript fact shards are already complete, generation-bound and
  // validated here. A read-write consumer may persist this acceleration hint
  // before later projections; a read-only consumer preserves the same semantic
  // result without admitting the optional cache Effect.
  if (cacheHint !== null
      && exactLoaded?.status !== 'hit'
      && cacheAccess === 'read-write') {
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
  const testObservationInput = Object.freeze({
    productionModel: typeScriptCompilation.model,
    files: workspaceSnapshot.files,
    moduleMembership: workspaceSnapshot.moduleMembership,
    operation,
    ...(repositoryRoot === undefined ? {} : { repositoryRoot: repositoryRoot })
  });
  sourceProgramCompilationCheckpoint(operation, 'test-observations', 'start');
  const testObservationsStarted = performance.now();
  const testObservations = compileTestObservationsFromSnapshot(
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
    reviewedProcessDispatchers: analysisPolicy.reviewedProcessDispatchers,
    ...(unknowns === undefined ? {} : { unknowns })
  });
  sourceProgramCompilationCheckpoint(operation, 'repository-projection', 'start');
  const repositoryProjectionStarted = performance.now();
  const model = compileRepositoryModelFromSnapshot(repositoryInput, workspaceSnapshot);
  const repositoryProjectionMs = performance.now() - repositoryProjectionStarted;
  sourceProgramCompilationCheckpoint(operation, 'repository-projection', 'complete');
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
    repositoryModelDigest: model.modelDigest,
    analysisPolicyDigest: analysisPolicy.policyDigest
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
    analysisPolicy,
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
  return compileRepositorySourceProgramCompilationCore(input, 'physical');
}

/** Pure/unbound compiler for virtual reductions and synthetic algorithm tests. */
export function compileVirtualRepositorySourceProgramCompilation(
  input: CompileVirtualRepositorySourceProgramCompilationInput
): RepositorySourceProgramCompilationReceipt {
  return compileRepositorySourceProgramCompilationCore(input, 'virtual');
}
