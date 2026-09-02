import {
  assertIssuedTestImpactProjection,
  type IssuedTestImpactProjection
} from '../../../brownfield/source-program-model/test-impact-projection.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import { uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  normalizeSecRepositoryPath,
  type SecRepositoryModuleGraph
} from '../../../system-architecture/repository-modules/contract.ts';
import { isSecRepositoryTestModulePath } from '../../../system-architecture/repository-modules/test-module-path.ts';
import {
  isFastTestFile,
  isSlowTestFile
} from '../contract/budget.ts';
import {
  classifyTestImpactSource,
  testImpactModuleIdsForSourceKind,
  type ResolvedTestOwnership,
  type TestImpactRiskPolicy
} from '../contract/ownership.ts';

export type TestImpactSelection = {
  fast: string[];
  slow: string[];
  owners: string[];
};

export type CodexDevelopmentTestImpactSourceProvider = Readonly<{
  projection: IssuedTestImpactProjection;
  activeDocumentationPaths: readonly string[];
}>;
export type RepositoryModuleGraph = SecRepositoryModuleGraph;

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
type ProviderIndex = Readonly<{
  activeDocumentationPaths: ReadonlySet<string>;
  moduleIds: ReadonlyMap<string, string | null>;
  candidateOwners: ReadonlyMap<string, string | null>;
  moduleGraphInputs: ReadonlySet<string>;
}>;
let providerIndexCache = new WeakMap<object, ProviderIndex>();

function normalizeRepoPath(value: string): string {
  return normalizeSecRepositoryPath(value);
}

function assertIssuedProvider(provider: CodexDevelopmentTestImpactSourceProvider): void {
  if (!issuedTestImpactProviders.has(provider)) {
    throw new SecError(
      'TEST-IMPACT-001',
      'Test impact requires an owner-issued provider composition',
      { kind: 'provider-unissued' }
    );
  }
  assertIssuedTestImpactProjection(provider.projection);
}

function providerIndex(provider: CodexDevelopmentTestImpactSourceProvider): ProviderIndex {
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
  const built: ProviderIndex = Object.freeze({
    activeDocumentationPaths: new Set(provider.activeDocumentationPaths),
    moduleIds,
    candidateOwners,
    moduleGraphInputs
  });
  providerIndexCache.set(provider, built);
  return built;
}

function classifyProviderSource(
  file: string,
  provider: CodexDevelopmentTestImpactSourceProvider
) {
  const index = providerIndex(provider);
  return classifyTestImpactSource(file, (candidate) => index.activeDocumentationPaths.has(candidate));
}

function moduleIdForPath(
  file: string,
  provider: CodexDevelopmentTestImpactSourceProvider
): string | null {
  const repositoryPath = normalizeRepoPath(file);
  const index = providerIndex(provider);
  const direct = index.moduleIds.get(repositoryPath) ?? null;
  if (direct !== null) return direct;
  return index.candidateOwners.get(repositoryPath) ?? null;
}

function semanticModuleIdsForSource(
  file: string,
  provider: CodexDevelopmentTestImpactSourceProvider
): readonly string[] {
  const physicalOwner = moduleIdForPath(file, provider);
  return uniqueSorted([
    ...(physicalOwner === null ? [] : [physicalOwner]),
    ...testImpactModuleIdsForSourceKind(classifyProviderSource(file, provider))
  ]);
}

export function isTestImpactModuleGraphInputFile(
  file: string,
  provider: CodexDevelopmentTestImpactSourceProvider
): boolean {
  const normalized = normalizeRepoPath(file);
  if (isSecRepositoryTestModulePath(normalized)) return false;
  return providerIndex(provider).moduleGraphInputs.has(normalized);
}

export function isTestImpactSourceFile(
  file: string,
  provider: CodexDevelopmentTestImpactSourceProvider
): boolean {
  const normalized = normalizeRepoPath(file);
  if (isSecRepositoryTestModulePath(normalized)) return false;
  return isTestImpactModuleGraphInputFile(normalized, provider)
    || classifyProviderSource(normalized, provider) !== null;
}

/**
 * D4 admission consumes only the compact Source Program projection. It never
 * receives the repository compilation receipt, source bytes, or full models.
 */
export function createRepositoryTestImpactSourceProvider(
  input: Readonly<{
    projection: IssuedTestImpactProjection;
    activeDocumentationPaths: readonly string[];
  }>
): CodexDevelopmentTestImpactSourceProvider {
  const { projection } = input;
  assertIssuedTestImpactProjection(projection);
  const moduleFileSet = new Set(projection.moduleGraph.files);
  const missingTestPath = projection.testFiles.find((testFile) => !moduleFileSet.has(testFile));
  if (missingTestPath !== undefined) {
    throw new SecError(
      'TEST-IMPACT-001',
      `Test impact projection omitted a test module from its graph: ${missingTestPath}.`,
      { kind: 'projection-test-module-missing', testPath: missingTestPath }
    );
  }
  const provider = Object.freeze({
    projection,
    activeDocumentationPaths: Object.freeze(uniqueSorted(
      input.activeDocumentationPaths.map(normalizeRepoPath)
    ))
  });
  issuedTestImpactProviders.add(provider);
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

function buildReverseImportMap(provider: CodexDevelopmentTestImpactSourceProvider): ReverseImportMap {
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
  provider: CodexDevelopmentTestImpactSourceProvider
): TestImpactSelectionResolution {
  const { unresolvedModuleFiles } = buildReverseImportMap(provider);
  return {
    selectionResolved: unresolvedModuleFiles.length === 0,
    unresolvedModuleFiles: uniqueSorted(unresolvedModuleFiles)
  };
}

export function readRepositoryModuleGraphV1(
  provider: CodexDevelopmentTestImpactSourceProvider
): RepositoryModuleGraph {
  return buildReverseImportMap(provider).graph;
}

export function deriveTestsForSources(
  files: readonly string[],
  provider: CodexDevelopmentTestImpactSourceProvider
): string[] {
  const { declarationPaths, map, structuralMap } = buildReverseImportMap(provider);
  const testFiles = new Set(provider.projection.testFiles.map(normalizeRepoPath));
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
      if (testFiles.has(consumer)) matchedTests.add(consumer);
      else if (!visited.has(consumer)) queue.push(Object.freeze({ path: consumer, structural: false }));
    }
  }
  return uniqueSorted([...matchedTests]);
}

function deriveTestsForModuleIds(
  moduleIds: readonly string[],
  provider: CodexDevelopmentTestImpactSourceProvider
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
  provider: CodexDevelopmentTestImpactSourceProvider
): TestImpactSelection {
  const normalizedFile = normalizeRepoPath(file);
  const semanticModuleIds = semanticModuleIdsForSource(normalizedFile, provider);
  const reverseGraph = buildReverseImportMap(provider);
  const cached = reverseGraph.selectionCache.get(normalizedFile);
  if (cached !== undefined) return cached;
  const graphTests = isTestImpactModuleGraphInputFile(normalizedFile, provider)
    ? deriveTestsForSources([normalizedFile], provider)
    : [];
  const sourceKind = classifyProviderSource(normalizedFile, provider);
  const semanticTests = sourceKind === 'active-documentation'
    ? []
    : deriveTestsForModuleIds(testImpactModuleIdsForSourceKind(sourceKind), provider);
  const selected = uniqueSorted([...graphTests, ...semanticTests]);
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
  provider: CodexDevelopmentTestImpactSourceProvider
): boolean {
  const selection = selectionForSource(file, provider);
  return selection.fast.length > 0 || selection.slow.length > 0;
}

export function resolveTestImpactForFiles(
  files: readonly string[],
  provider: CodexDevelopmentTestImpactSourceProvider
): ReadonlySet<string> {
  return new Set(files.filter((file) => (
    hasTestImpactForFile(file, provider)
    || resolveTestImpactRiskPolicies([file]).length > 0
  )));
}

export function resolveTestOwnership(
  files: readonly string[],
  provider: CodexDevelopmentTestImpactSourceProvider
): ResolvedTestOwnership[] {
  return files.flatMap((source) => semanticModuleIdsForSource(source, provider).map((moduleId) => ({
    source,
    owner: moduleId,
    identity: { kind: 'module' as const, id: moduleId }
  })));
}

export function resolveTestImpactRiskPolicies(files: readonly string[]): TestImpactRiskPolicy[] {
  return files.some((file) => file.startsWith('tests/setup/'))
    ? ['slow-risk-baseline']
    : [];
}

export function selectTestsForSources(
  files: readonly string[],
  provider: CodexDevelopmentTestImpactSourceProvider
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
    'Run bun run test:slow or bun run test:full before release.'
  ].join('\n');
}
