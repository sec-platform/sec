import ts from 'typescript';
import {
  compareCodeUnits,
  rawSha256,
  sha256
} from '../../../contracts/canonical.ts';
import type { RepositoryModuleGraph } from '../architecture/contract.ts';
import { sourceProgramCompilationCheckpoint } from './compilation-operation.ts';
import type {
  SourceProgramCompilation,
  SourceProgramModel
} from './contract.ts';
import {
  compileSourceProgramRepositoryModuleGraph
} from './source-program-module-graph.ts';
import {
  bindCurrentExactReturnProvenances
} from './typescript-exact-facts.ts';
import type {
  TypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import type {
  PreparedTypeScriptModelInput,
  TypeScriptModelInput,
  TypeScriptModelInternalInput
} from './typescript-input.ts';
import {
  issuePreparedTypeScriptSourceProgramInput,
  prepareTypeScriptSourceProgramInput
} from './typescript-input.ts';
import {
  compileTypeScriptModelInternal
} from './typescript-lowering.ts';
import {
  assembleCanonicalTypeScriptModel,
  bindTypeScriptModelToRepositoryCompilation,
  readTypeScriptFactShards,
  workspaceSnapshotIdentityForTypeScriptModel
} from './typescript-model-assembly.ts';
import {
  recordTypeScriptPerformance
} from './typescript-performance.ts';
import {
  TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION
} from './typescript-profile.ts';
import {
  semanticSourceText,
  typeScriptSemanticDependencyScope
} from './typescript-syntax.ts';

/** Incremental invalidation and state issuance; full compilation is an explicitly selected dependency. */
export interface TypeScriptIncrementalState {
  readonly [typeScriptIncrementalStateBrand]: true;
  readonly providerRevision: string;
  readonly sourceRevision: string;
  readonly fileDigests: Readonly<Record<string, string>>;
  readonly semanticSourceDigests: Readonly<Record<string, `sha256:${string}`>>;
  readonly moduleDigests: Readonly<Record<string, string>>;
  readonly semanticDependencyScopes: Readonly<Record<
    string,
    TypeScriptSourceProgramFactShard['semanticDependencyScope']
  >>;
  readonly moduleGraphDigest: `sha256:${string}`;
  /** Candidate-path reverse edges preserve additions, removals and resolver fallback changes. */
  readonly reverseConsumers: Readonly<Record<string, readonly string[]>>;
  readonly factShards: readonly TypeScriptSourceProgramFactShard[];
  readonly model: SourceProgramModel;
}

export interface TypeScriptIncrementalResult {
  readonly mode: 'exact' | 'incremental' | 'full';
  readonly invalidatedPaths: readonly string[];
  readonly model: SourceProgramModel;
  readonly state: TypeScriptIncrementalState;
}

const typeScriptIncrementalStateBrand: unique symbol = Symbol('typescript-source-program-incremental-state');

const issuedTypeScriptIncrementalStates = new WeakSet<object>();
const structuralReuseContexts = new WeakMap<object, Readonly<{
  graph: RepositoryModuleGraph;
  hasGlobalInputs: boolean;
}>>();

function hasTypeScriptReferenceDirectives(source: string): boolean {
  // References can change the entire Program even inside an external module.
  const references = ts.preProcessFile(source, false, true);
  return references.referencedFiles.length > 0 || references.typeReferenceDirectives.length > 0
    || references.libReferenceDirectives.length > 0;
}

function rememberStructuralReuseContext(
  state: TypeScriptIncrementalState,
  input: PreparedTypeScriptModelInput,
  graph: RepositoryModuleGraph
): TypeScriptIncrementalState {
  let hasGlobalInputs = state.factShards.some(({ semanticDependencyScope }) =>
    semanticDependencyScope !== 'module-scoped');
  if (!hasGlobalInputs) {
    for (const { file } of input.sourceFileIdentities.values()) {
      sourceProgramCompilationCheckpoint(input.operation, 'file-semantics');
      if (hasTypeScriptReferenceDirectives(file.source)) {
        hasGlobalInputs = true;
        break;
      }
    }
  }
  structuralReuseContexts.set(state, Object.freeze({ graph, hasGlobalInputs }));
  return state;
}

function canReuseAddedModules(
  state: TypeScriptIncrementalState,
  input: PreparedTypeScriptModelInput,
  graph: RepositoryModuleGraph,
  currentPaths: readonly string[]
): boolean {
  const previous = structuralReuseContexts.get(state);
  if (previous === undefined || previous.hasGlobalInputs
      || previous.graph.unresolvedFiles.length > 0 || graph.unresolvedFiles.length > 0) return false;
  const previousPaths = new Set(Object.keys(state.fileDigests));
  const current = new Set(currentPaths);
  if ([...previousPaths].some(path => !current.has(path))
      || !currentPaths.some(path => !previousPaths.has(path))) return false;
  // Compare all retained resolution observations, including negative candidates,
  // type-only edges and star exports; adjacency alone loses resolver changes.
  if (sha256(previous.graph.references) !== sha256(graph.references.filter(({ from }) =>
    !current.has(from) || previousPaths.has(from)))) return false;
  for (const { file } of input.sourceFileIdentities.values()) {
    sourceProgramCompilationCheckpoint(input.operation, 'file-semantics');
    if (typeScriptSemanticDependencyScope(file) !== 'module-scoped') return false;
    if (hasTypeScriptReferenceDirectives(file.source)) return false;
  }
  return true;
}

function assertReusableTypeScriptState(
  state: TypeScriptIncrementalState,
  compilerRevision: string
): boolean {
  if (!issuedTypeScriptIncrementalStates.has(state)
      || state.providerRevision !== compilerRevision
      || state.model.sourceRevision !== state.sourceRevision
      || !Array.isArray(state.factShards)
      || !/^sha256:[0-9a-f]{64}$/u.test(state.moduleGraphDigest)) return false;
  return /^sha256:[0-9a-f]{64}$/u.test(state.model.modelDigest);
}

function buildIncrementalState(
  input: PreparedTypeScriptModelInput,
  model: SourceProgramModel,
  reverseConsumers: Readonly<Record<string, readonly string[]>>,
  compilerRevision: string,
  moduleGraphDigest: `sha256:${string}` = sha256(reverseConsumers) as `sha256:${string}`,
  previousGeneration?: Readonly<{
    fileDigests: Readonly<Record<string, string>>;
    moduleDigests: Readonly<Record<string, string>>;
  }>
): TypeScriptIncrementalState {
  const factShards = readTypeScriptFactShards(model);
  if (factShards === undefined) {
    throw new Error('TypeScript Source Program incremental state requires canonical fact shards');
  }
  const orderedIdentities = [...input.sourceFileIdentities.values()]
    .sort((left, right) => compareCodeUnits(left.file.path, right.file.path));
  const fileDigests = previousGeneration?.fileDigests ?? Object.freeze(Object.fromEntries(
    orderedIdentities.map(({ file, rawFileDigest }) => [file.path, rawFileDigest])
  ));
  const semanticSourceDigests = Object.freeze(Object.fromEntries(
    orderedIdentities.map(({ file }) => [
      file.path,
      rawSha256(semanticSourceText(file.source)) as `sha256:${string}`
    ])
  ));
  const moduleDigests = previousGeneration?.moduleDigests ?? Object.freeze(Object.fromEntries(
    orderedIdentities.map(({ file, moduleDigest }) => [file.path, moduleDigest])
  ));
  const semanticDependencyScopes = Object.freeze(Object.fromEntries(
    factShards.map((shard) => [shard.path, shard.semanticDependencyScope])
  ));
  const state = Object.freeze({
    [typeScriptIncrementalStateBrand]: true as const,
    providerRevision: compilerRevision,
    sourceRevision: input.sourceRevision,
    fileDigests,
    semanticSourceDigests,
    moduleDigests,
    semanticDependencyScopes,
    moduleGraphDigest,
    reverseConsumers,
    factShards,
    model
  });
  issuedTypeScriptIncrementalStates.add(state);
  return state;
}

/**
 * Reconstitute a reusable state from one validated immutable fact pack. The
 * physical store supplies bytes only; this TypeScript owner rebinds the facts
 * to the current compilation and signs the process-local incremental state.
 */
export function adoptTypeScriptFactShards(
  input: TypeScriptModelInput,
  shards: readonly TypeScriptSourceProgramFactShard[],
  repositoryCompilation: SourceProgramCompilation,
  generation?: Readonly<{ moduleGraphDigest: `sha256:${string}` }>
): TypeScriptIncrementalState {
  const preparedInput = prepareTypeScriptSourceProgramInput({
    ...input,
    repositoryCompilation
  });
  const graph = repositoryCompilation.moduleGraph;
  // A predecessor generation intentionally has a different file census. Its
  // immutable shards seed the incremental compiler, which compares their
  // content/module digests with the current snapshot and recompiles the exact
  // added, removed, or changed reverse-consumer closure. Requiring equal path
  // sets here would turn the valid predecessor fast path into a hard failure.
  const consumersByPath = new Map<string, Set<string>>();
  const addConsumer = (target: string, consumer: string): void => {
    const consumers = consumersByPath.get(target) ?? new Set<string>();
    consumers.add(consumer);
    consumersByPath.set(target, consumers);
  };
  for (const repositoryPathValue of graph.files) {
    recordTypeScriptPerformance('dependencyAdjacencyLookups', 1);
    for (const consumer of graph.directConsumers(repositoryPathValue)) {
      addConsumer(repositoryPathValue, consumer);
    }
  }
  for (const shard of shards) {
    for (const reference of shard.references) {
      if (reference.targetPath !== null) addConsumer(reference.targetPath, reference.path);
    }
  }
  const reverseConsumers = Object.freeze(Object.fromEntries(
    [...consumersByPath]
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([repositoryPathValue, consumers]) => [
        repositoryPathValue,
        Object.freeze([...consumers].sort(compareCodeUnits))
      ])
  ));
  const model = bindTypeScriptModelToRepositoryCompilation(
    assembleCanonicalTypeScriptModel(input.sourceRevision, shards),
    repositoryCompilation
  );
  return buildIncrementalState(
    preparedInput,
    model,
    reverseConsumers,
    TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION,
    generation?.moduleGraphDigest ?? sha256(reverseConsumers) as `sha256:${string}`,
    generation === undefined
      ? undefined
      : Object.freeze({
          fileDigests: Object.freeze(Object.fromEntries(
            shards.map((shard) => [shard.path, shard.rawFileDigest])
          )),
          moduleDigests: Object.freeze(Object.fromEntries(
            shards.map((shard) => [shard.path, shard.moduleDigest])
          ))
        })
  );
}

/**
 * Recompile only the exact reverse-consumer closure affected by changed file,
 * import-resolution or module-provider facts. The dependency closure is still
 * supplied to the compiler so named/star re-exports retain full semantics.
 */
function compileTypeScriptModelIncrementalInternal(
  rawInput: TypeScriptModelInternalInput,
  previous: TypeScriptIncrementalState | null
): TypeScriptIncrementalResult {
  const input = prepareTypeScriptSourceProgramInput(rawInput);
  const currentFiles = [...input.sourceFileIdentities.values()]
    .map(({ file }) => file)
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  const currentFileByPath = new Map(currentFiles.map((file) => [file.path, file] as const));
  const currentPaths = Object.freeze(currentFiles.map(({ path: repositoryPathValue }) => repositoryPathValue));
  const compilerRevision = TYPESCRIPT_SOURCE_PROGRAM_COMPILER_REVISION;
  const reusableState = previous !== null
    && assertReusableTypeScriptState(previous, compilerRevision)
    ? previous
    : null;
  let changed: readonly string[] | null = null;
  if (reusableState !== null) {
    const allPaths = new Set([...Object.keys(reusableState.fileDigests), ...currentPaths]);
    changed = Object.freeze([...allPaths].filter((repositoryPathValue) => (
      reusableState.fileDigests[repositoryPathValue]
        !== input.sourceFileIdentities.get(repositoryPathValue)?.rawFileDigest
      || reusableState.moduleDigests[repositoryPathValue]
        !== input.sourceFileIdentities.get(repositoryPathValue)?.moduleDigest
    )));
    if (changed.length === 0) {
      if (input.sourceRevision === reusableState.sourceRevision
          && (input.repositoryCompilation === undefined
            || workspaceSnapshotIdentityForTypeScriptModel(reusableState.model)
              === input.repositoryCompilation.identityDigest)) {
        bindCurrentExactReturnProvenances(reusableState.model, input);
        return Object.freeze({
          mode: 'exact',
          invalidatedPaths: Object.freeze([]),
          model: reusableState.model,
          state: reusableState
        });
      }
      const model = bindCurrentExactReturnProvenances(
        bindTypeScriptModelToRepositoryCompilation(
          assembleCanonicalTypeScriptModel(input.sourceRevision, reusableState.factShards),
          input.repositoryCompilation
        ),
        input,
        reusableState.model
      );
      const state = buildIncrementalState(
        input, model, reusableState.reverseConsumers, compilerRevision,
        input.repositoryCompilation?.moduleGraphDigest
          ?? sha256(reusableState.reverseConsumers) as `sha256:${string}`
      );
      const previousContext = structuralReuseContexts.get(reusableState);
      if (previousContext !== undefined) {
        rememberStructuralReuseContext(state, input,
          input.repositoryCompilation?.moduleGraph ?? previousContext.graph);
      }
      return Object.freeze({
        mode: 'exact', invalidatedPaths: Object.freeze([]), model, state
      });
    }
  }
  const currentSources = new Map(currentFiles.map(({ path: repositoryPathValue, source }) =>
    [repositoryPathValue, source] as const));
  const graph = input.repositoryCompilation?.moduleGraph ?? compileSourceProgramRepositoryModuleGraph({
    files: currentPaths,
    readSource: (repositoryPathValue) => currentSources.get(repositoryPathValue) ?? null
  });
  const reverseConsumers = Object.freeze(Object.fromEntries(
    [...graph.files]
      .sort(compareCodeUnits)
      .map((repositoryPathValue) => {
        recordTypeScriptPerformance('dependencyAdjacencyLookups', 1);
        return [
        repositoryPathValue,
        Object.freeze([...graph.directConsumers(repositoryPathValue)].sort(compareCodeUnits))
        ] as const;
      })
      .filter(([, consumers]) => consumers.length > 0)
  ));
  const compileFull = (): TypeScriptIncrementalResult => {
    const model = compileTypeScriptModelInternal(input);
    return Object.freeze({
      mode: 'full',
      invalidatedPaths: currentPaths,
      model,
      state: rememberStructuralReuseContext(buildIncrementalState(
        input,
        model,
        reverseConsumers,
        compilerRevision,
        input.repositoryCompilation?.moduleGraphDigest
          ?? sha256(reverseConsumers) as `sha256:${string}`
      ), input, graph)
    });
  };
  if (reusableState === null || changed === null) return compileFull();
  const previousContext = structuralReuseContexts.get(reusableState);
  if (previousContext?.hasGlobalInputs === true
      || reusableState.factShards.some(({ semanticDependencyScope }) => semanticDependencyScope !== 'module-scoped')
      || (previousContext?.graph.unresolvedFiles.length ?? 0) > 0
      || graph.unresolvedFiles.length > 0
      || (previousContext === undefined ? currentPaths : changed).some(path => {
        sourceProgramCompilationCheckpoint(input.operation, 'file-semantics');
        const file = currentFileByPath.get(path);
        return file !== undefined && hasTypeScriptReferenceDirectives(file.source);
      })) return compileFull();
  const fileSetChanged = Object.keys(reusableState.fileDigests).length !== currentPaths.length
    || currentPaths.some((repositoryPathValue) => reusableState.fileDigests[repositoryPathValue] === undefined);
  const currentModuleGraphDigest = input.repositoryCompilation?.moduleGraphDigest
    ?? sha256(reverseConsumers) as `sha256:${string}`;
  const graphChanged = reusableState.moduleGraphDigest !== currentModuleGraphDigest;
  if ((fileSetChanged || graphChanged)
      && !canReuseAddedModules(reusableState, input, graph, currentPaths)) return compileFull();
  const currentSemanticDependencyScopes = new Map(changed.map((repositoryPathValue) => {
    const file = currentFileByPath.get(repositoryPathValue);
    return [
      repositoryPathValue,
      file === undefined ? undefined : typeScriptSemanticDependencyScope(file)
    ] as const;
  }));
  const globallyCoupledChange = changed.some((repositoryPathValue) => (
    (reusableState.fileDigests[repositoryPathValue] !== undefined
      && reusableState.semanticDependencyScopes[repositoryPathValue] !== 'module-scoped')
    || currentSemanticDependencyScopes.get(repositoryPathValue) !== 'module-scoped'
  ));
  if (globallyCoupledChange) return compileFull();

  const invalidated = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const changedPath = queue.shift()!;
    const consumers = new Set([
      ...(reusableState.reverseConsumers[changedPath] ?? []),
      ...(reverseConsumers[changedPath] ?? [])
    ]);
    for (const consumer of consumers) {
      if (invalidated.has(consumer)) continue;
      invalidated.add(consumer);
      queue.push(consumer);
    }
  }
  const invalidatedCurrent = new Set([...invalidated].filter((repositoryPathValue) =>
    currentFileByPath.has(repositoryPathValue)));
  if (invalidatedCurrent.size > Math.max(64, Math.floor(currentPaths.length * 0.6))) return compileFull();

  const compilePaths = new Set(invalidatedCurrent);
  const dependencyQueue = [...invalidatedCurrent];
  while (dependencyQueue.length > 0) {
    const consumer = dependencyQueue.shift()!;
    recordTypeScriptPerformance('dependencyAdjacencyLookups', 1);
    for (const dependency of graph.directDependencies(consumer)) {
      if (!currentFileByPath.has(dependency) || compilePaths.has(dependency)) continue;
      compilePaths.add(dependency);
      dependencyQueue.push(dependency);
    }
  }
  const regeneratedSourceFileIdentities = new Map(
    [...input.sourceFileIdentities].filter(([repositoryPathValue]) => (
      compilePaths.has(repositoryPathValue)
    ))
  );
  const regenerated = compileTypeScriptModelInternal(
    issuePreparedTypeScriptSourceProgramInput({
      sourceRevision: input.sourceRevision,
      files: currentFiles.filter(({ path: repositoryPathValue }) => compilePaths.has(repositoryPathValue)),
      moduleMembership: input.moduleMembership,
      operation: input.operation
    }, regeneratedSourceFileIdentities)
  );
  const reusablePath = (repositoryPathValue: string): boolean =>
    currentFileByPath.has(repositoryPathValue) && !invalidated.has(repositoryPathValue);
  const regeneratedPath = (repositoryPathValue: string): boolean => invalidatedCurrent.has(repositoryPathValue);
  const regeneratedShards = readTypeScriptFactShards(regenerated);
  if (regeneratedShards === undefined) {
    throw new Error('TypeScript Source Program regeneration did not produce fact shards');
  }
  const model = bindCurrentExactReturnProvenances(
    bindTypeScriptModelToRepositoryCompilation(
      assembleCanonicalTypeScriptModel(
        input.sourceRevision,
        [
          ...reusableState.factShards.filter(({ path: repositoryPathValue }) => reusablePath(repositoryPathValue)),
          ...regeneratedShards.filter(({ path: repositoryPathValue }) => regeneratedPath(repositoryPathValue))
        ]
      ),
      input.repositoryCompilation
    ),
    input
  );
  const state = buildIncrementalState(
    input, model, reverseConsumers, compilerRevision,
    input.repositoryCompilation?.moduleGraphDigest
      ?? sha256(reverseConsumers) as `sha256:${string}`
  );
  if (previousContext !== undefined) rememberStructuralReuseContext(state, input, graph);
  return Object.freeze({
    mode: 'incremental',
    invalidatedPaths: Object.freeze([...invalidatedCurrent].sort(compareCodeUnits)),
    model,
    state
  });
}

export function compileTypeScriptModelIncremental(
  input: TypeScriptModelInput,
  previous: TypeScriptIncrementalState | null
): TypeScriptIncrementalResult {
  return compileTypeScriptModelIncrementalInternal(input, previous);
}

export function compileTypeScriptModelIncrementalWithCompilation(
  input: TypeScriptModelInput,
  previous: TypeScriptIncrementalState | null,
  repositoryCompilation: SourceProgramCompilation
): TypeScriptIncrementalResult {
  return compileTypeScriptModelIncrementalInternal({
    ...input,
    repositoryCompilation
  }, previous);
}
