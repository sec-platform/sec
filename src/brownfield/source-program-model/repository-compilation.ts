import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type { SourceProgramModel, SourceProgramUnknown } from './contract.ts';
import {
  createRepositoryCompilationFactStore,
  type RepositoryCompilationFactStoreIdentity,
  type RepositoryCompilationGenerationReceipt
} from './repository-compilation-fact-store.ts';
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
  readonly projectGeneration: RepositoryCompilationGenerationReceipt | null;
  readonly moduleGraphCompilationCount: 1;
  readonly typeScriptCompilation: TypeScriptSourceProgramIncrementalResult;
  readonly testObservations: SourceProgramTestObservations;
  readonly model: SourceProgramModel;
  readonly receiptDigest: `sha256:${string}`;
  readonly workspaceSnapshot: WorkspaceSourceSnapshot;
}

export interface RepositoryCompilationDiagnostics {
  readonly cache: import('./repository-compilation-fact-store.ts').RepositoryCompilationFactStoreDiagnostics;
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
    ReturnType<ReturnType<typeof createRepositoryCompilationFactStore>['load']>,
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
  const factStoreIdentity: RepositoryCompilationFactStoreIdentity | null =
    input.projectInput === undefined
      ? null
      : Object.freeze({
          projectInputDigest: input.projectInput.projectInputDigest,
          projectConfigDigest: input.projectInput.projectConfigDigest,
          workspaceSnapshotIdentityDigest: input.projectInput.workspaceSnapshotIdentityDigest,
          orderedSourceFactsDigest: input.projectInput.orderedSourceFactsDigest,
          snapshotDigest: workspaceSnapshot.snapshotDigest,
          moduleMembershipDigest: workspaceSnapshot.moduleMembershipDigest,
          moduleGraphDigest: workspaceSnapshot.moduleGraphDigest,
          compiler
        });
  let factStore: ReturnType<typeof createRepositoryCompilationFactStore> | null = null;
  let exactLoaded: ReturnType<ReturnType<typeof createRepositoryCompilationFactStore>['load']> | null = null;
  let loaded: ReturnType<ReturnType<typeof createRepositoryCompilationFactStore>['load']> | null = null;
  let projectGeneration: RepositoryCompilationGenerationReceipt | null = null;
  if (input.repositoryRoot !== undefined && factStoreIdentity !== null) {
    try {
      factStore = createRepositoryCompilationFactStore({
        repositoryRoot: input.repositoryRoot,
        identity: factStoreIdentity
      });
      exactLoaded = factStore.load();
      loaded = exactLoaded.status === 'hit' ? exactLoaded : factStore.loadPredecessor();
      projectGeneration = exactLoaded.status === 'hit' ? exactLoaded.generation : null;
    } catch {
      // Runtime Cache is disposable acceleration. Invalid, foreign or
      // physically unavailable cache state must never become compilation
      // availability authority while the current exact inputs are present.
      factStore = null;
      exactLoaded = null;
      loaded = null;
      projectGeneration = null;
    }
  }
  const modelAssemblyStarted = performance.now();
  const typeScriptInput = Object.freeze({
    sourceRevision: workspaceSnapshot.sourceRevision,
    files: workspaceSnapshot.files,
    moduleMembership: workspaceSnapshot.moduleMembership
  });
  const cachedState = loaded?.status === 'hit'
    ? loadedTypeScriptState(workspaceSnapshot, typeScriptInput, loaded)
    : null;
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
  if (factStore !== null && exactLoaded?.status !== 'hit') {
    try {
      const published = factStore.publish(typeScriptCompilation.state.factShards);
      projectGeneration = published.status === 'hit' ? published.generation : null;
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
    projectGenerationReceiptDigest: projectGeneration?.receiptDigest ?? null,
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
