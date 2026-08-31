import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type { SecRepositoryModuleMembership } from '../../system-architecture/repository-modules/contract.ts';
import type { SourceProgramFileInput, SourceProgramModel, SourceProgramUnknown } from './contract.ts';
import {
  issueRepositoryCompilationContext,
  type IssuedRepositoryCompilationContext,
  type RepositoryCompilationGraphConsumer,
  type RepositoryCompilationSubject
} from './repository-compilation-context.ts';
import {
  createRepositoryCompilationFactStore,
  type RepositoryCompilationFactStoreIdentity
} from './repository-compilation-fact-store.ts';
import {
  compileRepositorySourceProgramModelFromRepositoryCompilation
} from './repository.ts';
import {
  compileSourceProgramTestObservationsFromRepositoryCompilation,
  type SourceProgramTestObservations
} from './test-observations.ts';
import {
  adoptTypeScriptSourceProgramFactShardsFromRepositoryCompilation,
  compileTypeScriptSourceProgramModelIncrementalFromRepositoryCompilation,
  sourceProgramTypeScriptCompilerIdentity,
  typeScriptSourceProgramCompilerImplementationDigest,
  type CompileTypeScriptSourceProgramModelInput,
  type TypeScriptSourceProgramIncrementalResult,
  type TypeScriptSourceProgramIncrementalState
} from './typescript.ts';

export type CompileRepositorySourceProgramCompilationInput = Readonly<{
  subject: RepositoryCompilationSubject;
  sourceRevision: string;
  files: readonly SourceProgramFileInput[];
  moduleMembership: SecRepositoryModuleMembership;
  repositoryRoot?: string;
  reviewedProcessDispatchers?: readonly string[];
  unknowns?: readonly SourceProgramUnknown[];
}>;

export interface RepositorySourceProgramCompilationReceipt {
  readonly subject: RepositoryCompilationSubject;
  readonly subjectDigest: `sha256:${string}`;
  readonly sourceRevision: string;
  readonly snapshotDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly contextDigest: `sha256:${string}`;
  readonly moduleGraphCompilationCount: 1;
  readonly moduleGraphConsumersAtCompilation: readonly RepositoryCompilationGraphConsumer[];
  readonly typeScriptCompilation: TypeScriptSourceProgramIncrementalResult;
  readonly testObservations: SourceProgramTestObservations;
  readonly model: SourceProgramModel;
  readonly receiptDigest: `sha256:${string}`;
  readonly context: IssuedRepositoryCompilationContext;
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
  context: IssuedRepositoryCompilationContext
): RepositoryCompilationDiagnostics | null {
  return diagnosticsByContext.get(context) ?? null;
}

function loadedTypeScriptState(
  context: IssuedRepositoryCompilationContext,
  input: CompileTypeScriptSourceProgramModelInput,
  loaded: Extract<
    ReturnType<ReturnType<typeof createRepositoryCompilationFactStore>['load']>,
    { status: 'hit' }
  >
): TypeScriptSourceProgramIncrementalState {
  return adoptTypeScriptSourceProgramFactShardsFromRepositoryCompilation(
    input,
    loaded.shards,
    context,
    Object.freeze({ moduleGraphDigest: loaded.generation.moduleGraphDigest })
  );
}

export function compileRepositorySourceProgramCompilation(
  input: CompileRepositorySourceProgramCompilationInput
): RepositorySourceProgramCompilationReceipt {
  const context = issueRepositoryCompilationContext(input);
  const compiler = sourceProgramTypeScriptCompilerIdentity();
  const compilerImplementationDigest = typeScriptSourceProgramCompilerImplementationDigest({
    sourceRevision: input.sourceRevision,
    files: input.files,
    moduleMembership: input.moduleMembership
  }, context);
  const factStoreIdentity: RepositoryCompilationFactStoreIdentity | null =
    compilerImplementationDigest === null
      ? null
      : Object.freeze({
          snapshotDigest: context.snapshotDigest,
          moduleMembershipDigest: context.moduleMembershipDigest,
          moduleGraphDigest: context.moduleGraphDigest,
          compilerImplementationDigest,
          compiler
        });
  let factStore: ReturnType<typeof createRepositoryCompilationFactStore> | null = null;
  let exactLoaded: ReturnType<ReturnType<typeof createRepositoryCompilationFactStore>['load']> | null = null;
  let loaded: ReturnType<ReturnType<typeof createRepositoryCompilationFactStore>['load']> | null = null;
  if (input.repositoryRoot !== undefined && factStoreIdentity !== null) {
    try {
      factStore = createRepositoryCompilationFactStore({
        repositoryRoot: input.repositoryRoot,
        identity: factStoreIdentity
      });
      exactLoaded = factStore.load();
      loaded = exactLoaded.status === 'hit' ? exactLoaded : factStore.loadPredecessor();
    } catch {
      // Runtime Cache is disposable acceleration. Invalid, foreign or
      // physically unavailable cache state must never become compilation
      // availability authority while the current exact inputs are present.
      factStore = null;
      exactLoaded = null;
      loaded = null;
    }
  }
  const modelAssemblyStarted = performance.now();
  const typeScriptInput = Object.freeze({
    sourceRevision: input.sourceRevision,
    files: input.files,
    moduleMembership: input.moduleMembership
  });
  const cachedState = loaded?.status === 'hit'
    ? loadedTypeScriptState(context, typeScriptInput, loaded)
    : null;
  const modelAssemblyMs = performance.now() - modelAssemblyStarted;
  const incrementalExactStarted = performance.now();
  const typeScriptCompilation = compileTypeScriptSourceProgramModelIncrementalFromRepositoryCompilation(
    typeScriptInput,
    cachedState,
    context
  );
  const incrementalExactMs = performance.now() - incrementalExactStarted;
  const testObservationInput = Object.freeze({
    productionModel: typeScriptCompilation.model,
    files: input.files,
    moduleMembership: input.moduleMembership,
    ...(input.repositoryRoot === undefined ? {} : { repositoryRoot: input.repositoryRoot })
  });
  const testObservationsStarted = performance.now();
  const testObservations = compileSourceProgramTestObservationsFromRepositoryCompilation(
    testObservationInput,
    context
  );
  const testObservationsMs = performance.now() - testObservationsStarted;
  const repositoryInput = Object.freeze({
    sourceRevision: input.sourceRevision,
    files: input.files,
    moduleMembership: input.moduleMembership,
    typescriptModel: typeScriptCompilation.model,
    testObservations,
    ...(input.reviewedProcessDispatchers === undefined
      ? {}
      : { reviewedProcessDispatchers: input.reviewedProcessDispatchers }),
    ...(input.unknowns === undefined ? {} : { unknowns: input.unknowns })
  });
  const repositoryProjectionStarted = performance.now();
  const model = compileRepositorySourceProgramModelFromRepositoryCompilation(repositoryInput, context);
  const repositoryProjectionMs = performance.now() - repositoryProjectionStarted;
  if (factStore !== null && exactLoaded?.status !== 'hit') {
    try {
      factStore.publish(typeScriptCompilation.state.factShards);
    } catch {
      // A failed cache publication cannot change the canonical compilation
      // result. The next operation may rebuild or retire the disposable bytes.
    }
  }
  if (loaded?.status === 'hit') {
    diagnosticsByContext.set(context, Object.freeze({
      cache: loaded.diagnostics,
      modelAssemblyMs,
      incrementalExactMs,
      testObservationsMs,
      repositoryProjectionMs
    }));
  }
  const moduleGraphConsumersAtCompilation = context.observedModuleGraphConsumers();
  const expectedModuleGraphConsumers: readonly RepositoryCompilationGraphConsumer[] = Object.freeze([
    'repository-model',
    'test-observations',
    'typescript'
  ]);
  if (JSON.stringify(moduleGraphConsumersAtCompilation) !== JSON.stringify(expectedModuleGraphConsumers)) {
    throw new Error('Repository compilation projections did not consume the one issued module graph');
  }
  const canonical = Object.freeze({
    schema: 'sec-repository-source-program-compilation-receipt-v1',
    subjectDigest: context.subjectDigest,
    sourceRevision: context.sourceRevision,
    snapshotDigest: context.snapshotDigest,
    moduleMembershipDigest: context.moduleMembershipDigest,
    moduleGraphDigest: context.moduleGraphDigest,
    contextDigest: context.contextDigest,
    typeScriptModelDigest: typeScriptCompilation.model.modelDigest,
    testObservationDigest: testObservations.observationDigest,
    repositoryModelDigest: model.modelDigest
  });
  return Object.freeze({
    subject: context.subject,
    subjectDigest: context.subjectDigest,
    sourceRevision: context.sourceRevision,
    snapshotDigest: context.snapshotDigest,
    moduleMembershipDigest: context.moduleMembershipDigest,
    moduleGraphDigest: context.moduleGraphDigest,
    contextDigest: context.contextDigest,
    moduleGraphCompilationCount: context.moduleGraphCompilationCount,
    moduleGraphConsumersAtCompilation,
    typeScriptCompilation,
    testObservations,
    model,
    receiptDigest: sha256(canonical) as `sha256:${string}`,
    context
  });
}
