import { readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';

export const SEC_MODULE_SCHEMA_V1 = 'sec-module-v1' as const;

/**
 * The repository graph frontier is owned here. Consumers must derive their
 * source/test closure from this projection instead of keeping another list of
 * platform/scripts/tooling roots. Descriptor coverage can become more precise
 * over time without changing the graph owner or its import resolver.
 */
const SEC_MODULE_IMPORT_GRAPHS_V1 = Object.freeze([
  'runtime',
  'content'
] as const);

export type SecModuleDescriptorV1 = Readonly<{
  readonly schema: typeof SEC_MODULE_SCHEMA_V1;
  readonly moduleId: string;
  readonly root: string;
  readonly importGraph: typeof SEC_MODULE_IMPORT_GRAPHS_V1[number];
  readonly externalEntrypoints: readonly string[];
  /** Every external entrypoint must load before repository dependencies exist. */
  readonly preDependencyBootstrap: boolean;
}>;

export type SecModuleImportKindV1 =
  | 'static'
  | 'dynamic'
  | 'require';

export type SecRepositoryModuleGraphImportV1 = Readonly<{
  readonly kind: SecModuleImportKindV1;
  readonly specifier: string;
}>;

export type SecRepositoryModuleGraphReferenceV1 = Readonly<{
  readonly from: string;
  readonly kind: SecModuleImportKindV1;
  readonly specifier: string;
  readonly candidateTargets: readonly string[];
  readonly resolvedTarget: string | null;
}>;

export type SecRepositoryModuleGraphV1 = Readonly<{
  readonly files: readonly string[];
  readonly references: readonly SecRepositoryModuleGraphReferenceV1[];
  readonly unresolvedFiles: readonly string[];
  readonly directConsumers: (modulePath: string) => readonly string[];
  readonly directDependencies: (modulePath: string) => readonly string[];
}>;

export type SecRepositoryModuleGraphCompileInputV1 = Readonly<{
  readonly files: readonly string[];
  /** Return null for an unavailable source. Empty source is a valid source. */
  readonly readSource: (moduleFile: string) => string | null;
  /**
   * Optional cache seam. The parser remains owned by this module; callers may
   * cache its returned records without implementing another parser.
   */
  readonly readImports?: (
    moduleFile: string,
    source: string
  ) => readonly SecRepositoryModuleGraphImportV1[];
  readonly unresolvedFiles?: readonly string[];
}>;

export type SecRepositoryModuleMembershipV1 = Readonly<{
  readonly descriptors: readonly SecModuleDescriptorV1[];
  readonly graphRoots: readonly string[];
  readonly moduleRoots: readonly string[];
  readonly moduleForPath: (path: string) => SecModuleDescriptorV1 | null;
}>;

const SEC_PACKAGE_PRIVATE_SEGMENTS_V1 = new Set([
  'application',
  'internal',
  'runtime',
  'state'
]);

const SEC_MODULE_DESCRIPTOR_KEYS_V1 = Object.freeze([
  'schema',
  'moduleId',
  'importGraph',
  'externalEntrypoints',
  'preDependencyBootstrap'
] as const);

const SEC_MODULE_ID_PATTERN_V1 = /^[a-z][a-z0-9.-]{1,127}$/u;
const SEC_MODULE_PATH_PATTERN_V1 = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;

function descriptorError(field: string, detail: string): never {
  throw new Error(`invalid sec.module.json ${field}: ${detail}`);
}

function descriptorRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return descriptorError('descriptor', 'expected an object');
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set<string>(SEC_MODULE_DESCRIPTOR_KEYS_V1);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) descriptorError(key, 'unknown field');
  }
  for (const key of SEC_MODULE_DESCRIPTOR_KEYS_V1.filter(
    (key) => key !== 'preDependencyBootstrap'
  )) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      descriptorError(key, 'required field is missing');
    }
  }
  return record;
}

function descriptorString(
  value: unknown,
  field: string,
  pattern?: RegExp
): string {
  if (typeof value !== 'string' || value.length === 0) {
    return descriptorError(field, 'expected a non-empty string');
  }
  if (pattern !== undefined && !pattern.test(value)) {
    return descriptorError(field, 'has an invalid format');
  }
  return value;
}

function descriptorEnum<Value extends string>(
  value: unknown,
  field: string,
  choices: readonly Value[]
): Value {
  if (typeof value !== 'string' || !choices.includes(value as Value)) {
    return descriptorError(field, `expected one of ${choices.join(', ')}`);
  }
  return value as Value;
}

function descriptorStringArray(
  value: unknown,
  field: string,
  itemPattern?: RegExp,
  minimumLength = 0
): readonly string[] {
  if (!Array.isArray(value) || value.length > 128 || value.length < minimumLength) {
    return descriptorError(field, `expected ${minimumLength === 0 ? 'at most' : 'between'} ${minimumLength === 0 ? '128' : `${minimumLength} and 128`} entries`);
  }
  const items = value.map((item, index) => descriptorString(item, `${field}[${index}]`, itemPattern));
  if (new Set(items).size !== items.length) descriptorError(field, 'entries must be unique');
  return Object.freeze(items);
}

export function parseSecModuleDescriptorV1(
  input: unknown,
  descriptorPath: string
): SecModuleDescriptorV1 {
  const record = descriptorRecord(input);
  const schema = record.schema;
  if (schema !== SEC_MODULE_SCHEMA_V1) descriptorError('schema', `expected ${SEC_MODULE_SCHEMA_V1}`);
  const normalizedDescriptorPath = normalizeSecRepositoryPathV1(descriptorPath);
  if (!isCanonicalSecRepositoryModulePath(normalizedDescriptorPath)
      || nodePath.posix.basename(normalizedDescriptorPath) !== 'sec.module.json') {
    descriptorError('descriptorPath', 'must be a canonical repository sec.module.json path');
  }
  const root = nodePath.posix.dirname(normalizedDescriptorPath);
  if (root === '.') descriptorError('descriptorPath', 'repository-root descriptors are not supported');
  const externalEntrypoints = descriptorStringArray(
    record.externalEntrypoints,
    'externalEntrypoints',
    SEC_MODULE_PATH_PATTERN_V1
  );
  const preDependencyBootstrap = record.preDependencyBootstrap ?? false;
  if (typeof preDependencyBootstrap !== 'boolean') {
    descriptorError('preDependencyBootstrap', 'expected a boolean');
  }
  if (preDependencyBootstrap && externalEntrypoints.length === 0) {
    descriptorError('preDependencyBootstrap', 'requires at least one external entrypoint');
  }
  return Object.freeze({
    schema: SEC_MODULE_SCHEMA_V1,
    moduleId: descriptorString(record.moduleId, 'moduleId', SEC_MODULE_ID_PATTERN_V1),
    root,
    importGraph: descriptorEnum(record.importGraph, 'importGraph', SEC_MODULE_IMPORT_GRAPHS_V1),
    externalEntrypoints,
    preDependencyBootstrap
  });
}

function pathWithinRoot(path: string, root: string): boolean {
  const normalizedPath = path.toLocaleLowerCase('en-US');
  const normalizedRoot = root.toLocaleLowerCase('en-US');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function normalizeSecRepositoryPathV1(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function normalizeRepositoryPath(value: string): string {
  return normalizeSecRepositoryPathV1(value);
}

function isTestOnlyRepositoryModulePathV1(value: string): boolean {
  const normalized = normalizeSecRepositoryPathV1(value);
  return normalized.startsWith('tests/') || normalized.includes('/test/');
}

function absolutePathWithinRepository(repositoryRoot: string, relativePath: string): string {
  const absolute = nodePath.resolve(repositoryRoot, ...relativePath.split('/'));
  const relative = nodePath.relative(repositoryRoot, absolute);
  if (relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
    throw new Error(`repository module path escapes repository root: ${relativePath}`);
  }
  return absolute;
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/u.test(source[index] ?? '')) {
      index += 1;
      continue;
    }
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline === -1 ? source.length : newline + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return index;
}

function readQuotedString(
  source: string,
  start: number
): { readonly value: string; readonly next: number } | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\') {
      const escaped = source[index + 1];
      if (escaped === undefined) return null;
      value += escaped;
      index += 2;
      continue;
    }
    if (character === quote) return { value, next: index + 1 };
    value += character;
    index += 1;
  }
  return null;
}

function skipQuotedOrTemplate(source: string, start: number): number {
  const quote = source[start];
  if (quote === '`') {
    let index = start + 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === '`') return index + 1;
      index += 1;
    }
    return source.length;
  }
  const parsed = readQuotedString(source, start);
  return parsed?.next ?? source.length;
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_$]/u.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/u.test(character);
}

type SecModuleImportReferenceV1 = Readonly<{
  readonly kind: SecModuleImportKindV1;
  readonly specifier: string | null;
}>;

function extractImportReferences(source: string): readonly SecModuleImportReferenceV1[] {
  const references: SecModuleImportReferenceV1[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === '/' && source[index + 1] === '/') {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      index = skipWhitespaceAndComments(source, index);
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      index = skipQuotedOrTemplate(source, index);
      continue;
    }
    if (!isIdentifierStart(character)) {
      index += 1;
      continue;
    }
    const tokenStart = index;
    index += 1;
    while (isIdentifierPart(source[index])) index += 1;
    const token = source.slice(tokenStart, index);
    if (token !== 'import' && token !== 'export' && token !== 'require' && token !== 'from') {
      continue;
    }
    let next = skipWhitespaceAndComments(source, index);
    if (token === 'from') {
      const parsed = readQuotedString(source, next);
      if (parsed) references.push({ kind: 'static', specifier: parsed.value });
      continue;
    }
    if (token === 'export') continue;
    if (token === 'import' && source[next] !== '(') {
      const parsed = readQuotedString(source, next);
      if (parsed) references.push({ kind: 'static', specifier: parsed.value });
      continue;
    }
    if (token === 'import' || token === 'require') {
      if (source[next] === '(') {
        next = skipWhitespaceAndComments(source, next + 1);
        const parsed = readQuotedString(source, next);
        if (parsed) {
          references.push({
            kind: token === 'import' ? 'dynamic' : 'require',
            specifier: parsed.value
          });
        } else if (token === 'import') {
          references.push({ kind: 'dynamic', specifier: null });
        }
      }
    }
  }
  return Object.freeze(references);
}

/**
 * The only import scanner exposed to downstream graph consumers.  It keeps
 * the cache seam typed while preventing test-impact or another projection from
 * growing a second source parser.
 */
export function scanSecRepositoryModuleImportsV1(
  source: string
): readonly SecRepositoryModuleGraphImportV1[] {
  return Object.freeze(extractImportReferences(source)
    .filter((reference): reference is SecModuleImportReferenceV1 & { readonly specifier: string } => (
      reference.specifier !== null
    ))
    .map(({ kind, specifier }) => Object.freeze({ kind, specifier })));
}

/**
 * Resolve import candidates without touching the filesystem.  Existing-file
 * selection belongs to the graph compiler's supplied `files` snapshot; all
 * candidate paths are retained so a removed target still affects consumers.
 */
export function resolveSecRepositoryModuleImportCandidatesV1(
  sourcePath: string,
  specifier: string
): readonly string[] {
  if (!specifier.startsWith('.')) return Object.freeze([]);
  const base = normalizeSecRepositoryPathV1(nodePath.posix.join(
    nodePath.posix.dirname(normalizeSecRepositoryPathV1(sourcePath)),
    specifier
  ));
  const extension = nodePath.posix.extname(base);
  if (/^\.(?:[cm]?tsx?)$/u.test(extension)) return Object.freeze([base]);
  if (/^\.(?:[cm]?jsx?)$/u.test(extension)) {
    const stem = base.slice(0, -extension.length);
    return Object.freeze([...new Set([
      base,
      `${stem}.ts`,
      `${stem}.tsx`,
      `${stem}.mts`,
      `${stem}.cts`
    ])].sort((left, right) => left.localeCompare(right, 'en-US')));
  }
  if (extension) return Object.freeze([base]);
  return Object.freeze([
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mts`,
    `${base}/index.cts`
  ]);
}

function requiresLocalModuleResolutionV1(specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  const extension = nodePath.posix.extname(specifier);
  return extension === '' || /^\.(?:[cm]?[jt]sx?)$/u.test(extension);
}

function isCanonicalSecRepositoryModulePath(value: string): boolean {
  return value.length > 0
    && !value.includes('\0')
    && !value.startsWith('../')
    && !value.includes('/../')
    && !value.includes('/./')
    && !nodePath.isAbsolute(value)
    && !/^[A-Za-z]:/u.test(value)
    && normalizeSecRepositoryPathV1(value) === value;
}

/**
 * Compile one deterministic import graph from an already observed source
 * snapshot.  This is the graph owner consumed by test-impact and any future
 * reverse projection.  The optional import reader is cache-only: it must
 * return records produced by `scanSecRepositoryModuleImportsV1`.
 */
export function compileSecRepositoryModuleGraphV1(
  input: SecRepositoryModuleGraphCompileInputV1
): SecRepositoryModuleGraphV1 {
  const files = Object.freeze([...new Set(input.files.map((file) => {
    const normalized = normalizeSecRepositoryPathV1(file);
    if (!isCanonicalSecRepositoryModulePath(normalized)) {
      throw new Error(`repository module graph path is not canonical: ${file}`);
    }
    return normalized;
  }))].sort((left, right) => left.localeCompare(right, 'en-US')));
  const fileSet = new Set(files);
  const unresolvedFiles = new Set<string>(
    (input.unresolvedFiles ?? []).map(normalizeSecRepositoryPathV1)
  );
  const references: SecRepositoryModuleGraphReferenceV1[] = [];
  const reverseConsumers = new Map<string, string[]>();
  for (const moduleFile of files) {
    const source = input.readSource(moduleFile);
    if (source === null) {
      unresolvedFiles.add(moduleFile);
      continue;
    }
    let imports: readonly SecRepositoryModuleGraphImportV1[];
    try {
      imports = input.readImports === undefined
        ? scanSecRepositoryModuleImportsV1(source)
        : input.readImports(moduleFile, source);
    } catch {
      unresolvedFiles.add(moduleFile);
      continue;
    }
    const uniqueImports = new Map<string, SecRepositoryModuleGraphImportV1>();
    for (const reference of imports) {
      uniqueImports.set(`${reference.kind}\0${reference.specifier}`, reference);
    }
    for (const reference of uniqueImports.values()) {
      const candidates = resolveSecRepositoryModuleImportCandidatesV1(
        moduleFile,
        reference.specifier
      );
      const local = reference.specifier.startsWith('.');
      if (local && candidates.some((candidate) => !isCanonicalSecRepositoryModulePath(candidate))) {
        unresolvedFiles.add(moduleFile);
      }
      const resolvedTarget = candidates.find((candidate) => fileSet.has(candidate)) ?? null;
      if (resolvedTarget !== null
          && isTestOnlyRepositoryModulePathV1(resolvedTarget)
          && !isTestOnlyRepositoryModulePathV1(moduleFile)) {
        throw new Error(
          `production repository module imports test-only module: ${moduleFile} -> ${resolvedTarget}`
        );
      }
      if (local
          && resolvedTarget === null
          && requiresLocalModuleResolutionV1(reference.specifier)) {
        unresolvedFiles.add(moduleFile);
      }
      const graphReference = Object.freeze({
        from: moduleFile,
        kind: reference.kind,
        specifier: reference.specifier,
        candidateTargets: Object.freeze([...new Set(candidates)].sort((left, right) => left.localeCompare(right, 'en-US'))),
        resolvedTarget
      });
      references.push(graphReference);
      for (const candidate of graphReference.candidateTargets) {
        const consumers = reverseConsumers.get(candidate) ?? [];
        if (!consumers.includes(moduleFile)) consumers.push(moduleFile);
        reverseConsumers.set(candidate, consumers);
      }
    }
  }
  for (const consumers of reverseConsumers.values()) consumers.sort((left, right) => left.localeCompare(right, 'en-US'));
  references.sort((left, right) => (
    left.from.localeCompare(right.from, 'en-US')
    || left.specifier.localeCompare(right.specifier, 'en-US')
    || left.kind.localeCompare(right.kind, 'en-US')
  ));
  const frozenReferences = Object.freeze(references);
  return Object.freeze({
    files,
    references: frozenReferences,
    unresolvedFiles: Object.freeze([...unresolvedFiles].sort((left, right) => left.localeCompare(right, 'en-US'))),
    directConsumers: (modulePath) => Object.freeze([
      ...(reverseConsumers.get(normalizeSecRepositoryPathV1(modulePath)) ?? [])
    ]),
    directDependencies: (modulePath) => Object.freeze([...new Set(
      frozenReferences
        .filter((reference) => reference.from === normalizeSecRepositoryPathV1(modulePath))
        .flatMap((reference) => reference.resolvedTarget === null ? [] : [reference.resolvedTarget])
    )].sort((left, right) => left.localeCompare(right, 'en-US')))
  });
}

/**
 * Enforce the physical package contract on a graph compiled from one source
 * snapshot. Cross-package consumers use public facades; test-only packages are
 * the sole route to fault providers. The package that owns an implementation
 * may still compose its own application/runtime/state layers internally.
 */
export function assertSecRepositoryModuleImportBoundariesV1(
  graph: SecRepositoryModuleGraphV1,
  membership: SecRepositoryModuleMembershipV1
): void {
  for (const reference of graph.references) {
    if (reference.resolvedTarget === null) continue;
    const sourceOwner = membership.moduleForPath(reference.from);
    const targetOwner = membership.moduleForPath(reference.resolvedTarget);
    if (sourceOwner === null || targetOwner === null || sourceOwner.moduleId === targetOwner.moduleId) continue;
    const targetSegments = reference.resolvedTarget.split('/');
    const privateSegment = targetSegments.find((segment) => SEC_PACKAGE_PRIVATE_SEGMENTS_V1.has(segment));
    if (privateSegment !== undefined) {
      throw new Error(
        `cross-package import bypasses public facade through ${privateSegment}: ` +
        `${reference.from} -> ${reference.resolvedTarget}`
      );
    }
  }
  for (const descriptor of membership.descriptors) {
    if (!descriptor.preDependencyBootstrap) continue;
    const pending = [...descriptor.externalEntrypoints];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const source = pending.pop()!;
      if (visited.has(source)) continue;
      visited.add(source);
      for (const reference of graph.references) {
        if (reference.from !== source) continue;
        // Dynamic import is the explicit post-bootstrap loading boundary. The
        // pre-dependency closure contains only modules evaluated by static
        // import/require before dependency admission completes.
        if (reference.kind === 'dynamic') continue;
        if (reference.resolvedTarget !== null) {
          pending.push(reference.resolvedTarget);
          continue;
        }
        if (reference.specifier.startsWith('node:')
            || reference.specifier.startsWith('bun:')
            || reference.specifier === 'bun'
            || (reference.specifier.startsWith('.') && reference.specifier.endsWith('.json'))) {
          continue;
        }
        throw new Error(
          `pre-dependency bootstrap imports unavailable package: `
          + `${source} -> ${reference.specifier}`
        );
      }
    }
  }
}

function descriptorExternalEntrypointPaths(
  descriptor: SecModuleDescriptorV1
): readonly string[] {
  return Object.freeze(descriptor.externalEntrypoints.map(normalizeRepositoryPath));
}

function descriptorGraphRoots(
  descriptors: readonly SecModuleDescriptorV1[]
): readonly string[] {
  const candidates = [...new Set(descriptors.flatMap((descriptor) => [
    descriptor.root,
    ...descriptorExternalEntrypointPaths(descriptor)
      .map((entrypoint) => normalizeRepositoryPath(nodePath.posix.dirname(entrypoint)))
  ]))].sort((left, right) => (
    left.split('/').length - right.split('/').length
    || left.localeCompare(right, 'en-US')
  ));
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (!roots.some((root) => pathWithinRoot(candidate, root))) roots.push(candidate);
  }
  return Object.freeze(roots.sort((left, right) => left.localeCompare(right, 'en-US')));
}

const DESCRIPTOR_DISCOVERY_IGNORED_DIRECTORIES_V1 = new Set([
  '.git',
  '.tmp',
  'dist',
  'node_modules',
  'report'
]);

function discoverDescriptorPathsSync(
  repositoryRoot: string
): readonly string[] {
  const paths: string[] = [];
  const visit = (absoluteDirectory: string): void => {
    const entries = readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en-US'));
    for (const entry of entries) {
      if (entry.isDirectory() && DESCRIPTOR_DISCOVERY_IGNORED_DIRECTORIES_V1.has(entry.name)) continue;
      const absolutePath = nodePath.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && entry.name === 'sec.module.json') {
        paths.push(normalizeRepositoryPath(nodePath.relative(repositoryRoot, absolutePath)));
      }
    }
  };
  visit(repositoryRoot);
  return Object.freeze(paths.sort((left, right) => left.localeCompare(right, 'en-US')));
}

/**
 * Discover module descriptors once at the architecture owner.  Consumers may
 * cache the returned membership projection, but may not rediscover descriptor
 * roots or duplicate the path matcher.
 */
export function discoverSecModuleDescriptorsV1(
  repositoryRoot: string
): readonly SecModuleDescriptorV1[] {
  const absoluteRepositoryRoot = nodePath.resolve(repositoryRoot);
  const descriptorPaths = discoverDescriptorPathsSync(absoluteRepositoryRoot);
  return Object.freeze(descriptorPaths.map((descriptorPath) => {
    const descriptorFile = nodePath.join(absoluteRepositoryRoot, ...descriptorPath.split('/'));
    return parseSecModuleDescriptorV1(
      JSON.parse(readFileSync(descriptorFile, 'utf8')),
      descriptorPath
    );
  }).sort((left, right) => left.root.localeCompare(right.root, 'en-US')));
}

/**
 * Compile only the descriptor/path facts consumed by the affected-test
 * selector. Import edges are compiled separately from the selector's exact
 * source snapshot; descriptors never rediscover or certify repository files.
 */
export function compileSecRepositoryModuleMembershipV1(
  repositoryRoot: string
): SecRepositoryModuleMembershipV1 {
  const descriptors = discoverSecModuleDescriptorsV1(repositoryRoot);
  const moduleIds = new Set<string>();
  const rootKeys = new Set<string>();
  const bySpecificity = [...descriptors].sort((left, right) => right.root.length - left.root.length);
  const entrypointOwners = new Map<string, SecModuleDescriptorV1>();
  for (const descriptor of descriptors) {
    if (moduleIds.has(descriptor.moduleId)) {
      throw new Error(`duplicate repository moduleId: ${descriptor.moduleId}`);
    }
    moduleIds.add(descriptor.moduleId);
    const rootKey = descriptor.root.toLocaleLowerCase('en-US');
    if (rootKeys.has(rootKey)) throw new Error(`duplicate repository module root: ${descriptor.root}`);
    rootKeys.add(rootKey);
    const absoluteRoot = absolutePathWithinRepository(
      nodePath.resolve(repositoryRoot),
      descriptor.root
    );
    if (!statSync(absoluteRoot).isDirectory()) {
      throw new Error(`repository module root is not a directory: ${descriptor.root}`);
    }
    if (descriptor.importGraph === 'content') {
      const directExecutableSources = readdirSync(absoluteRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]sx?)$/u.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, 'en-US'));
      if (directExecutableSources.length > 0) {
        throw new Error(
          `${descriptor.moduleId} content root mixes executable source: `
          + directExecutableSources.join(', ')
        );
      }
    }
    for (const entrypoint of descriptorExternalEntrypointPaths(descriptor)) {
      if (pathWithinRoot(entrypoint, descriptor.root)) {
        throw new Error(`${descriptor.moduleId} external entrypoint is already inside its module root: ${entrypoint}`);
      }
      const physicalOwner = bySpecificity.find((candidate) => pathWithinRoot(entrypoint, candidate.root));
      if (physicalOwner !== undefined && physicalOwner.moduleId !== descriptor.moduleId) {
        throw new Error(
          `${descriptor.moduleId} external entrypoint is inside ${physicalOwner.moduleId}: ${entrypoint}`
        );
      }
      const absoluteEntrypoint = absolutePathWithinRepository(
        nodePath.resolve(repositoryRoot),
        entrypoint
      );
      if (!statSync(absoluteEntrypoint).isFile()) {
        throw new Error(`${descriptor.moduleId} entrypoint does not exist: ${entrypoint}`);
      }
      const entrypointKey = entrypoint.toLocaleLowerCase('en-US');
      const previous = entrypointOwners.get(entrypointKey);
      if (previous && previous.moduleId !== descriptor.moduleId) {
        throw new Error(`repository module entrypoint is claimed by multiple modules: ${entrypoint}`);
      }
      entrypointOwners.set(entrypointKey, descriptor);
    }
  }
  const moduleForPath = (inputPath: string): SecModuleDescriptorV1 | null => {
    const normalized = normalizeSecRepositoryPathV1(inputPath);
    return entrypointOwners.get(normalized.toLocaleLowerCase('en-US'))
      ?? bySpecificity.find((descriptor) => pathWithinRoot(normalized, descriptor.root))
      ?? null;
  };
  return Object.freeze({
    descriptors,
    graphRoots: descriptorGraphRoots(descriptors),
    moduleRoots: Object.freeze(descriptors.map(({ root }) => root)),
    moduleForPath
  });
}
