import { uniqueSorted } from '../../../../../contracts/canonical.ts';
import { FailureError } from '../../../../../contracts/failure.ts';
import { isRepositoryTestModulePath } from '../../../../../contracts/repository-test-path.ts';
import {
  normalizeRepositoryModulePath,
  type RepositoryModuleGraph as ArchitectureModuleGraph
} from '../../../../repository/architecture/contract.ts';
import {
  assertIssuedTestImpactProjection,
  type IssuedTestImpactProjection
} from '../../../../repository/source-program-model/test-impact-projection.ts';
import {
  assertIssuedTestInventoryProjection,
  isFastTestFile,
  isSlowTestFile,
  type IssuedTestInventoryProjection
} from '../contract/budget.ts';
import {
  classifyTestImpactSource,
  isTypecheckOnlyTestPath,
  testImpactModuleIdsForSourceKind,
  type ResolvedTestOwnership,
  type TestImpactRiskPolicy
} from '../contract/ownership.ts';
import {
  readIssuedAffectedTestImpactBinding,
  type IssuedAffectedTestImpactSource
} from './affected-source.ts';
import type { TestImpactTransitionObservation } from './transition.ts';

export type TestImpactSelection = {
  fast: string[];
  slow: string[];
  owners: string[];
};

export type TestImpactSourceProvider = Readonly<{
  projection: IssuedTestImpactProjection;
  testInventory: IssuedTestInventoryProjection;
  activeDocumentationPaths: readonly string[];
}>;
export type RepositoryModuleGraph = ArchitectureModuleGraph;

type ReverseImportMap = Readonly<{
  map: ReadonlyMap<string, readonly string[]>;
  structuralMap: ReadonlyMap<string, readonly string[]>;
  declarationPaths: ReadonlySet<string>;
  unresolvedModuleFiles: readonly string[];
  graph: RepositoryModuleGraph;
  selectionCache: Map<string, TestImpactSelection>;
}>;

let providerReverseImportMapCache = new WeakMap<object, ReverseImportMap>();
const issuedTestImpactProviders = new WeakSet<object>();
const providerTransitions = new WeakMap<object, TestImpactTransitionObservation>();
const providerAffectedBindings = new WeakMap<object, NonNullable<ReturnType<typeof readIssuedAffectedTestImpactBinding>>>();
type ProviderIndex = Readonly<{
  activeDocumentationPaths: ReadonlySet<string>;
  gitHookEntrypointPaths: ReadonlySet<string>;
  moduleIds: ReadonlyMap<string, string | null>;
  candidateOwners: ReadonlyMap<string, string | null>;
  moduleGraphInputs: ReadonlySet<string>;
  removedModuleOwners: ReadonlyMap<string, string>;
}>;
let providerIndexCache = new WeakMap<object, ProviderIndex>();

function normalizeRepoPath(value: string): string {
  return normalizeRepositoryModulePath(value);
}

function assertIssuedProvider(provider: TestImpactSourceProvider): void {
  if (!issuedTestImpactProviders.has(provider)) {
    throw new FailureError(
      'TEST-IMPACT-001',
      'Test impact requires an owner-issued provider composition',
      { kind: 'provider-unissued' }
    );
  }
  assertIssuedTestImpactProjection(provider.projection);
}

function providerIndex(provider: TestImpactSourceProvider): ProviderIndex {
  assertIssuedProvider(provider);
  const cached = providerIndexCache.get(provider);
  if (cached !== undefined) return cached;
  const moduleIds = new Map(provider.projection.files.map((file) => [file.path, file.moduleId] as const));
  const ownersByCandidate = new Map<string, Set<string>>();
  const moduleGraphInputs = new Set(provider.projection.moduleGraph.files);
  for (const reference of provider.projection.moduleGraph.references) {
    const owner = moduleIds.get(reference.from) ?? null;
    for (const candidate of reference.candidateTargets) {
      moduleGraphInputs.add(candidate);
      if (owner === null) continue;
      const owners = ownersByCandidate.get(candidate) ?? new Set<string>();
      owners.add(owner);
      ownersByCandidate.set(candidate, owners);
    }
  }
  const candidateOwners = new Map<string, string | null>();
  for (const [candidate, owners] of ownersByCandidate) {
    candidateOwners.set(candidate, owners.size === 1 ? [...owners][0]! : null);
  }
  const transition = providerTransitions.get(provider);
  const descriptorRootsChanged = providerAffectedBindings.get(provider)?.descriptorChangeRoots ?? [];
  const removedPathSet = new Set(transition?.removedPathBlobs.map(({ path }) => path) ?? []);
  const removedModuleOwners = new Map<string, string>();
  for (const removedPath of removedPathSet) {
    if (descriptorRootsChanged.some((root) => (
      root === '' || removedPath === root || removedPath.startsWith(`${root}/`)
    ))) continue;
    const candidates = provider.projection.moduleOwners
      .filter(({ root }) => removedPath === root || removedPath.startsWith(`${root}/`))
      .sort((left, right) => right.root.length - left.root.length);
    if (candidates.length > 0
        && (candidates.length === 1 || candidates[0]!.root.length > candidates[1]!.root.length)) {
      removedModuleOwners.set(removedPath, candidates[0]!.moduleId);
    }
  }
  const built: ProviderIndex = Object.freeze({
    activeDocumentationPaths: new Set(provider.activeDocumentationPaths),
    gitHookEntrypointPaths: new Set(provider.projection.entrypoints
      .filter(({ kind }) => kind === 'git-hook')
      .map(({ path }) => path)),
    moduleIds,
    candidateOwners,
    moduleGraphInputs,
    removedModuleOwners
  });
  providerIndexCache.set(provider, built);
  return built;
}

function classifyProviderSource(
  file: string,
  provider: TestImpactSourceProvider
) {
  const index = providerIndex(provider);
  return classifyTestImpactSource(
    file,
    (candidate) => index.activeDocumentationPaths.has(candidate),
    (candidate) => index.gitHookEntrypointPaths.has(candidate)
  );
}

function moduleIdForPath(
  file: string,
  provider: TestImpactSourceProvider
): string | null {
  const repositoryPath = normalizeRepoPath(file);
  const index = providerIndex(provider);
  const direct = index.moduleIds.get(repositoryPath) ?? null;
  if (direct !== null) return direct;
  const projectedCandidate = index.candidateOwners.get(repositoryPath)
    ?? index.removedModuleOwners.get(repositoryPath)
    ?? null;
  if (projectedCandidate !== null) return projectedCandidate;
  // A containing module root is not proof that an arbitrary, absent path is
  // owned. Only paths present in the exact source projection and the module
  // descriptor itself may use the structural owner fallback.
  if (!index.moduleIds.has(repositoryPath) && !repositoryPath.endsWith('/module.json')) {
    return null;
  }
  const containingOwners = provider.projection.moduleOwners
    .filter(({ root }) => (
      root === '' || repositoryPath === root || repositoryPath.startsWith(`${root}/`)
    ))
    .sort((left, right) => right.root.length - left.root.length);
  if (containingOwners.length === 0) return null;
  const longestRootLength = containingOwners[0]!.root.length;
  const longestOwners = uniqueSorted(containingOwners
    .filter(({ root }) => root.length === longestRootLength)
    .map(({ moduleId }) => moduleId));
  return longestOwners.length === 1 ? longestOwners[0]! : null;
}

function semanticModuleIdsForSource(
  file: string,
  provider: TestImpactSourceProvider
): readonly string[] {
  const physicalOwner = moduleIdForPath(file, provider);
  return uniqueSorted([
    ...(physicalOwner === null ? [] : [physicalOwner]),
    ...testImpactModuleIdsForSourceKind(classifyProviderSource(file, provider))
  ]);
}

export function isTestImpactModuleGraphInputFile(
  file: string,
  provider: TestImpactSourceProvider
): boolean {
  const normalized = normalizeRepoPath(file);
  if (isRepositoryTestModulePath(normalized)) return false;
  return providerIndex(provider).moduleGraphInputs.has(normalized);
}

export function isTestImpactSourceFile(
  file: string,
  provider: TestImpactSourceProvider
): boolean {
  const normalized = normalizeRepoPath(file);
  if (isRepositoryTestModulePath(normalized)) return false;
  return isTestImpactModuleGraphInputFile(normalized, provider)
    || buildReverseImportMap(provider).map.has(normalized)
    || moduleIdForPath(normalized, provider) !== null
    || classifyProviderSource(normalized, provider) !== null;
}

/**
 * D4 admission consumes only the compact Source Program projection. It never
 * receives the repository compilation receipt, source bytes, or full models.
 */
export function createRepositoryTestImpactSourceProvider(
  input: Readonly<{
    projection: IssuedTestImpactProjection;
    testInventory: IssuedTestInventoryProjection;
    activeDocumentationPaths: readonly string[];
    affectedSource?: IssuedAffectedTestImpactSource;
  }>
): TestImpactSourceProvider {
  const {
    projection,
    testInventory,
    affectedSource,
    activeDocumentationPaths
  } = input;
  assertIssuedTestImpactProjection(projection);
  assertIssuedTestInventoryProjection(testInventory);
  const inventoryTestFiles = new Set(testInventory.testFiles);
  if (testInventory.workspaceSnapshotIdentityDigest !== projection.workspaceSnapshotIdentityDigest
      || testInventory.snapshotDigest !== projection.snapshotDigest
      || projection.testFiles.some((path) => (
        isRepositoryTestModulePath(path) && !inventoryTestFiles.has(path)
      ))) {
    throw new FailureError('TEST-IMPACT-001', 'Test inventory differs from its Source Program projection.', {
      kind: 'test-inventory-mismatch'
    });
  }
  if (Object.prototype.hasOwnProperty.call(input, 'transition')) {
    throw new FailureError(
      'TEST-IMPACT-001',
      'Test impact transition must come from an owner-issued Git/source composition',
      { kind: 'transition-unissued' }
    );
  }
  const affectedBinding = affectedSource === undefined
    ? null
    : readIssuedAffectedTestImpactBinding(affectedSource);
  if (affectedSource !== undefined && affectedSource.projection !== projection) {
    throw new FailureError(
      'TEST-IMPACT-001',
      'Test impact transition differs from the Source Program projection source',
      { kind: 'transition-source-mismatch' }
    );
  }
  const moduleFileSet = new Set(projection.moduleGraph.files);
  const missingTestPath = projection.testFiles.find((testFile) => !moduleFileSet.has(testFile));
  if (missingTestPath !== undefined) {
    throw new FailureError(
      'TEST-IMPACT-001',
      `Test impact projection omitted a test module from its graph: ${missingTestPath}.`,
      { kind: 'projection-test-module-missing', testPath: missingTestPath }
    );
  }
  const provider = Object.freeze({
    projection,
    testInventory,
    activeDocumentationPaths: Object.freeze(uniqueSorted(
      activeDocumentationPaths.map(normalizeRepoPath)
    ))
  });
  issuedTestImpactProviders.add(provider);
  if (affectedBinding !== null) {
    providerTransitions.set(provider, affectedBinding.transition);
    providerAffectedBindings.set(provider, affectedBinding);
  }
  return provider;
}

function addConsumer(map: Map<string, string[]>, target: string, consumer: string): void {
  const consumers = map.get(target) ?? [];
  if (!consumers.includes(consumer)) consumers.push(consumer);
  map.set(target, consumers);
}

function freezeAdjacency(map: Map<string, string[]>): ReadonlyMap<string, readonly string[]> {
  for (const [target, consumers] of map) map.set(target, uniqueSorted(consumers));
  return map;
}

function buildReverseImportMap(provider: TestImpactSourceProvider): ReverseImportMap {
  assertIssuedProvider(provider);
  const cached = providerReverseImportMapCache.get(provider);
  if (cached !== undefined) return cached;

  const projectionGraph = provider.projection.moduleGraph;
  const map = new Map<string, string[]>();
  const structuralMap = new Map<string, string[]>();
  const declarationPaths = new Set<string>();
  const preciseModuleReferences = new Set<string>();
  for (const declarationPath of provider.projection.declarationPaths) declarationPaths.add(declarationPath);
  const semanticReferences = provider.projection.semanticReferences;
  const referencesByImport = new Map<string, typeof semanticReferences>();
  for (const reference of semanticReferences) {
    if (reference.moduleSpecifier !== null && reference.moduleSpecifier.startsWith('.')) {
      const key = `${reference.path}\0${reference.moduleSpecifier}`;
      const references = referencesByImport.get(key) ?? [];
      references.push(reference);
      referencesByImport.set(key, references);
    }
    if (reference.targetPath === null
        || reference.targetPath === reference.path) continue;
    addConsumer(map, reference.targetPath, reference.path);
  }
  for (const consumer of provider.projection.observedTestConsumers) {
    if (consumer.targetPath !== consumer.testPath) {
      addConsumer(map, consumer.targetPath, consumer.testPath);
      addConsumer(structuralMap, consumer.targetPath, consumer.testPath);
    }
  }
  for (const [key, references] of referencesByImport) {
    if (references.length > 0 && references.every((reference) => (
      reference.precise
    ))) preciseModuleReferences.add(key);
  }
  for (const reference of projectionGraph.references) {
    for (const candidate of reference.candidateTargets) {
      addConsumer(structuralMap, candidate, reference.from);
      if (!preciseModuleReferences.has(`${reference.from}\0${reference.specifier}`)) {
        addConsumer(map, candidate, reference.from);
      }
    }
  }
  const directConsumers = new Map<string, string[]>();
  const directDependencies = new Map<string, string[]>();
  const directRuntimeDependencies = new Map<string, string[]>();
  for (const reference of projectionGraph.references) {
    for (const candidate of reference.candidateTargets) addConsumer(directConsumers, candidate, reference.from);
    if (reference.resolvedTarget !== null) {
      addConsumer(directDependencies, reference.from, reference.resolvedTarget);
      if (!reference.typeOnly) {
        addConsumer(directRuntimeDependencies, reference.from, reference.resolvedTarget);
      }
    }
  }
  freezeAdjacency(directConsumers);
  freezeAdjacency(directDependencies);
  freezeAdjacency(directRuntimeDependencies);
  const graph: RepositoryModuleGraph = Object.freeze({
    files: projectionGraph.files,
    references: projectionGraph.references,
    unresolvedFiles: projectionGraph.unresolvedFiles,
    directConsumers: (modulePath: string) => Object.freeze([
      ...(directConsumers.get(normalizeRepoPath(modulePath)) ?? [])
    ]),
    directDependencies: (modulePath: string) => Object.freeze([
      ...(directDependencies.get(normalizeRepoPath(modulePath)) ?? [])
    ]),
    directRuntimeDependencies: (modulePath: string) => Object.freeze([
      ...(directRuntimeDependencies.get(normalizeRepoPath(modulePath)) ?? [])
    ])
  });
  const built: ReverseImportMap = Object.freeze({
    map: freezeAdjacency(map),
    structuralMap: freezeAdjacency(structuralMap),
    declarationPaths,
    unresolvedModuleFiles: projectionGraph.unresolvedFiles,
    graph,
    selectionCache: new Map<string, TestImpactSelection>()
  });
  providerReverseImportMapCache.set(provider, built);
  return built;
}

export type TestImpactSelectionResolution = {
  selectionResolved: boolean;
  unresolvedModuleFiles: string[];
};

export function resolveTestImpactSelectionTrustBoundary(
  provider: TestImpactSourceProvider
): TestImpactSelectionResolution {
  const { unresolvedModuleFiles } = buildReverseImportMap(provider);
  return {
    selectionResolved: unresolvedModuleFiles.length === 0,
    unresolvedModuleFiles: uniqueSorted(unresolvedModuleFiles)
  };
}

export function readRepositoryModuleGraph(
  provider: TestImpactSourceProvider
): RepositoryModuleGraph {
  return buildReverseImportMap(provider).graph;
}

function deriveTestsForSources(
  files: readonly string[],
  provider: TestImpactSourceProvider
): string[] {
  const { declarationPaths, map, structuralMap } = buildReverseImportMap(provider);
  const runnableTestFiles = new Set(provider.projection.testFiles
    .map(normalizeRepoPath)
    .filter((testPath) => isFastTestFile(testPath) || isSlowTestFile(testPath)));
  const matchedTests = new Set<string>();
  const visited = new Set<string>();
  const queue = files.map((file) => {
    const repositoryPath = normalizeRepoPath(file);
    return Object.freeze({
      path: repositoryPath,
      structural: !declarationPaths.has(repositoryPath)
    });
  });
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (visited.has(current.path)) continue;
    visited.add(current.path);
    const consumers = current.structural
      ? structuralMap.get(current.path) ?? []
      : map.get(current.path) ?? [];
    for (const consumer of consumers) {
      if (runnableTestFiles.has(consumer)) matchedTests.add(consumer);
      else if (!visited.has(consumer)) queue.push(Object.freeze({ path: consumer, structural: false }));
    }
  }
  return uniqueSorted([...matchedTests]);
}

function deriveTestsForModuleIds(
  moduleIds: readonly string[],
  provider: TestImpactSourceProvider
): readonly string[] {
  if (moduleIds.length === 0) return [];
  const wanted = new Set(moduleIds);
  const moduleSources = provider.projection.files
    .filter((file) => (
      file.surface === 'production'
      && file.moduleId !== null
      && wanted.has(file.moduleId)
    ))
    .map((file) => file.path);
  return deriveTestsForSources(moduleSources, provider);
}

function selectionForSource(
  file: string,
  provider: TestImpactSourceProvider
): TestImpactSelection {
  const normalizedFile = normalizeRepoPath(file);
  const semanticModuleIds = semanticModuleIdsForSource(normalizedFile, provider);
  const reverseGraph = buildReverseImportMap(provider);
  const cached = reverseGraph.selectionCache.get(normalizedFile);
  if (cached !== undefined) return cached;
  const graphTests = isTestImpactModuleGraphInputFile(normalizedFile, provider)
      || reverseGraph.map.has(normalizedFile)
    ? deriveTestsForSources([normalizedFile], provider)
    : [];
  const sourceKind = classifyProviderSource(normalizedFile, provider);
  const semanticTests = sourceKind === 'active-documentation'
    ? []
    : deriveTestsForModuleIds(testImpactModuleIdsForSourceKind(sourceKind), provider);
  const removedOwner = providerIndex(provider).removedModuleOwners.get(normalizedFile) ?? null;
  const removedOwnerTests = removedOwner === null
    ? []
    : deriveTestsForModuleIds([removedOwner], provider);
  const selected = uniqueSorted([...graphTests, ...semanticTests, ...removedOwnerTests]);
  const selection = {
    fast: selected.filter(isFastTestFile),
    slow: selected.filter(isSlowTestFile),
    owners: [...semanticModuleIds]
  };
  reverseGraph.selectionCache.set(normalizedFile, selection);
  return selection;
}

export function hasTestImpactForFile(
  file: string,
  provider: TestImpactSourceProvider
): boolean {
  const selection = selectionForSource(file, provider);
  return selection.fast.length > 0 || selection.slow.length > 0;
}

export function resolveTestImpactForFiles(
  files: readonly string[],
  provider: TestImpactSourceProvider
): ReadonlySet<string> {
  const removedModuleOwners = providerIndex(provider).removedModuleOwners;
  return new Set(files.filter((file) => (
    hasTestImpactForFile(file, provider)
    || (!removedModuleOwners.has(normalizeRepoPath(file))
      && selectionForSource(file, provider).owners.length > 0)
    || resolveTestImpactRiskPolicies([file], provider).length > 0
  )));
}

export function resolveTestOwnership(
  files: readonly string[],
  provider: TestImpactSourceProvider
): ResolvedTestOwnership[] {
  return files.flatMap((source) => semanticModuleIdsForSource(source, provider).map((moduleId) => ({
    source,
    owner: moduleId,
    identity: { kind: 'module' as const, id: moduleId }
  })));
}

export function resolveTestImpactRiskPolicies(
  files: readonly string[],
  provider: TestImpactSourceProvider
): TestImpactRiskPolicy[] {
  const index = providerIndex(provider);
  const graph = readRepositoryModuleGraph(provider);
  const reverseConsumers = buildReverseImportMap(provider).map;
  const compilerTestInputs = new Set(provider.projection.testFiles);
  return uniqueSorted([
    ...(files.some((file) => file.startsWith('tests/setup/'))
      ? ['slow-risk-baseline' as const]
      : []),
    ...(files.some((file) => {
      const normalized = normalizeRepoPath(file);
      const projected = provider.projection.files.find(({ path }) => path === normalized);
      return isTypecheckOnlyTestPath(normalized)
        && projected?.surface === 'test'
        && compilerTestInputs.has(normalized)
        && index.moduleGraphInputs.has(normalized)
        && graph.directConsumers(normalized).length === 0
        && (reverseConsumers.get(normalized)?.length ?? 0) === 0
        && !provider.projection.entrypoints.some(({ path, targetPaths }) => (
          path === normalized || targetPaths.includes(normalized)
        ));
    }) ? ['typecheck-only' as const] : [])
  ]);
}

export function selectTestsForSources(
  files: readonly string[],
  provider: TestImpactSourceProvider
): TestImpactSelection {
  const fast = new Set<string>();
  const slow = new Set<string>();
  const owners = new Set<string>();
  for (const file of files) {
    const selection = selectionForSource(file, provider);
    for (const value of selection.fast) fast.add(value);
    for (const value of selection.slow) slow.add(value);
    for (const value of selection.owners) owners.add(value);
  }
  return {
    fast: uniqueSorted([...fast]),
    slow: uniqueSorted([...slow]),
    owners: uniqueSorted([...owners])
  };
}

export function formatSlowImpactNotice(selection: TestImpactSelection): string {
  if (selection.slow.length === 0) return '';
  return [
    'Changed sources also affect slow e2e coverage:',
    ...selection.slow.map((file) => `- ${file}`),
    'Run bun run test -- --scope slow or bun run test -- --scope full before release.'
  ].join('\n');
}
