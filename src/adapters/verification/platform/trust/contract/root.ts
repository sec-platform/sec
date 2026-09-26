import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPOSITORY_AUDIT_ENTRYPOINT_PATH } from '../../../../repository/source-program-model/contract.ts';

const TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA = 'sec-trusted-bootstrap-registry-v3' as const;
export const TRUSTED_BOOTSTRAP_REGISTRY_PATH =
  'src/adapters/verification/platform/trust/contract/ci-trust-root-registry.json' as const;
export const TCB_CLOSURE_RUNTIME_PATH =
  'src/adapters/verification/platform/trust/runtime/closure-lock.ts' as const;
export const TRUSTED_BOOTSTRAP_DISPATCHER_OWNER =
  'src/adapters/verification/platform/trust/contract/root.ts' as const;

const REQUIRED_TRUSTED_BOOTSTRAP_STATIC_EXACT_PATHS = Object.freeze([
  '.bun-version',
  TRUSTED_BOOTSTRAP_REGISTRY_PATH,
  TCB_CLOSURE_RUNTIME_PATH
]);

export type TrustedBootstrapRegistry = Readonly<{
  schema: typeof TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA;
  staticExactPaths: readonly string[];
  staticDirectoryPaths: readonly string[];
  staticPrefixes: readonly string[];
  runtimeEntrypoints: readonly string[];
  reviewedSutEdges: readonly string[];
  reviewedBoundaryEdges: readonly string[];
  reviewedExternalImports: readonly string[];
}>;

export type TrustedBootstrapTrustRoot = Readonly<{
  schema: 'sec-trusted-bootstrap-trust-root-v3';
  registry: TrustedBootstrapRegistry;
  causalRuntimePaths: readonly string[];
  paths: readonly string[];
  prefixes: readonly string[];
}>;

export type TrustedBootstrapPathMatch = Readonly<{
  kind: 'static-exact' | 'static-directory' | 'static-prefix' | 'causal-runtime';
  rule: string;
}>;

const REGISTRY_KEYS = [
  'schema',
  'staticExactPaths',
  'staticDirectoryPaths',
  'staticPrefixes',
  'runtimeEntrypoints',
  'reviewedSutEdges',
  'reviewedBoundaryEdges',
  'reviewedExternalImports'
] as const;

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>): void {
  const actual = Object.keys(value).sort();
  const expected = [...REGISTRY_KEYS].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error('Trusted bootstrap registry has unknown or missing fields.');
  }
}

function assertBoundedNfc(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0') || value.normalize('NFC') !== value) {
    throw new Error(`${label} must be bounded NFC text without NUL characters.`);
  }
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new Error(`${label} must be strictly code-unit sorted and unique.`);
    }
  }
}

function assertRepositoryPath(value: string, label: string, directory: boolean): void {
  assertBoundedNfc(value, label);
  if (
    value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/u.test(value)
    || value.includes('//')
    || value.includes('*')
    || value.includes('?')
    || value.includes('#')
  )
    throw new Error(`${label} must be a canonical repository-relative POSIX path.`);
  if (directory !== value.endsWith('/')) {
    throw new Error(`${label} ${directory ? 'must' : 'must not'} end with '/'.`);
  }
  const comparable = directory ? value.slice(0, -1) : value;
  if (
    comparable.length === 0 ||
    comparable === '.' ||
    comparable === '..' ||
    comparable.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    path.posix.normalize(comparable) !== comparable
  )
    throw new Error(`${label} is not canonical after POSIX normalization.`);
}

function assertPrefix(value: string, label: string): void {
  assertBoundedNfc(value, label);
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes('..')
  )
    throw new Error(`${label} is not a canonical repository prefix.`);
}

function assertExternalModuleSpecifier(value: string, label: string): void {
  assertBoundedNfc(value, label);
  if (
    value.startsWith('.') ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.includes('*') ||
    value.includes('?') ||
    value.includes('#') ||
    /\s/u.test(value)
  ) {
    throw new Error(`${label} must be one exact external module specifier.`);
  }
  const protocolSpecifier = /^(?:bun|node):[a-z0-9][a-z0-9._/-]*$/u;
  const packageSpecifier = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u;
  if (!protocolSpecifier.test(value) && !packageSpecifier.test(value)) {
    throw new Error(`${label} must be one canonical external module specifier.`);
  }
}

function stringArray(
  value: unknown,
  label: string,
  maximum = 4_096,
  allowEmpty = false
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new Error(`${label} must be a ${allowEmpty ? '' : 'non-empty '}bounded array.`);
  }
  const result = value.map((entry, index) => {
    assertBoundedNfc(entry, `${label}[${index}]`);
    return entry;
  });
  assertSortedUnique(result, label);
  return result;
}

function assertNoStaticOverlap(registry: TrustedBootstrapRegistry): void {
  for (let index = 0; index < registry.staticPrefixes.length; index += 1) {
    const prefix = registry.staticPrefixes[index]!;
    for (const other of registry.staticPrefixes.slice(index + 1)) {
      if (prefix.startsWith(other) || other.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap prefixes overlap: ${prefix} / ${other}.`);
      }
    }
  }
  for (const exact of registry.staticExactPaths) {
    for (const directory of registry.staticDirectoryPaths) {
      if (exact.startsWith(directory)) {
        throw new Error(`Trusted bootstrap static path overlap: ${exact} is covered by ${directory}.`);
      }
    }
    for (const prefix of registry.staticPrefixes) {
      if (exact.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap static path overlap: ${exact} is covered by prefix ${prefix}.`);
      }
    }
  }
  for (let index = 0; index < registry.staticDirectoryPaths.length; index += 1) {
    const directory = registry.staticDirectoryPaths[index]!;
    for (const other of registry.staticDirectoryPaths.slice(index + 1)) {
      if (directory.startsWith(other) || other.startsWith(directory)) {
        throw new Error(`Trusted bootstrap directory paths overlap: ${directory} / ${other}.`);
      }
    }
    for (const prefix of registry.staticPrefixes) {
      if (directory.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap static path overlap: ${directory} is covered by prefix ${prefix}.`);
      }
    }
  }
}

function assertRegistrySourceEnvelope(source: string): void {
  if (
    source.length === 0 ||
    source.length > 131_072 ||
    source[0] !== '{' ||
    !source.endsWith('\n') ||
    source.endsWith('\n\n') ||
    source.includes('\r') ||
    source.includes('\0')
  ) {
    throw new Error('Trusted bootstrap registry must be bounded LF JSON with exactly one trailing newline.');
  }
}

function topLevelJsonObjectKeys(source: string): string[] {
  const keys: string[] = [];
  let objectDepth = 0;
  let arrayDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      for (; index < source.length; index += 1) {
        const current = source[index]!;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === '\\') {
          escaped = true;
          continue;
        }
        if (current === '"') break;
      }
      if (index >= source.length) {
        throw new Error('Trusted bootstrap registry contains an unterminated JSON string.');
      }
      if (objectDepth === 1 && arrayDepth === 0) {
        let cursor = index + 1;
        while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1;
        if (source[cursor] === ':') {
          keys.push(JSON.parse(source.slice(start, index + 1)) as string);
        }
      }
      continue;
    }
    if (character === '{') objectDepth += 1;
    else if (character === '}') objectDepth -= 1;
    else if (character === '[') arrayDepth += 1;
    else if (character === ']') arrayDepth -= 1;
  }
  return keys;
}

function validateTrustedBootstrapRegistryValue(value: unknown): TrustedBootstrapRegistry {
  assertPlainObject(value, 'trusted bootstrap registry');
  assertExactKeys(value);
  if (value.schema !== TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA) {
    throw new Error('Trusted bootstrap registry schema mismatch.');
  }

  const staticExactPaths = stringArray(value.staticExactPaths, 'staticExactPaths');
  const staticDirectoryPaths = stringArray(value.staticDirectoryPaths, 'staticDirectoryPaths');
  const staticPrefixes = stringArray(value.staticPrefixes, 'staticPrefixes', 128);
  const runtimeEntrypoints = stringArray(value.runtimeEntrypoints, 'runtimeEntrypoints');
  const reviewedSutEdges = stringArray(value.reviewedSutEdges, 'reviewedSutEdges', 4_096, true);
  const reviewedBoundaryEdges = stringArray(
    value.reviewedBoundaryEdges,
    'reviewedBoundaryEdges',
    4_096,
    true
  );
  const reviewedExternalImports = stringArray(value.reviewedExternalImports, 'reviewedExternalImports');

  staticExactPaths.forEach((entry, index) => assertRepositoryPath(entry, `staticExactPaths[${index}]`, false));
  staticDirectoryPaths.forEach((entry, index) => assertRepositoryPath(entry, `staticDirectoryPaths[${index}]`, true));
  staticPrefixes.forEach((entry, index) => assertPrefix(entry, `staticPrefixes[${index}]`));
  runtimeEntrypoints.forEach((entry, index) => assertRepositoryPath(entry, `runtimeEntrypoints[${index}]`, false));

  const registry: TrustedBootstrapRegistry = Object.freeze({
    schema: TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA,
    staticExactPaths: Object.freeze(staticExactPaths),
    staticDirectoryPaths: Object.freeze(staticDirectoryPaths),
    staticPrefixes: Object.freeze(staticPrefixes),
    runtimeEntrypoints: Object.freeze(runtimeEntrypoints),
    reviewedSutEdges: Object.freeze(reviewedSutEdges),
    reviewedBoundaryEdges: Object.freeze(reviewedBoundaryEdges),
    reviewedExternalImports: Object.freeze(reviewedExternalImports)
  });

  assertNoStaticOverlap(registry);
  for (const requiredPath of REQUIRED_TRUSTED_BOOTSTRAP_STATIC_EXACT_PATHS) {
    if (!registry.staticExactPaths.includes(requiredPath)) {
      throw new Error(`Trusted bootstrap registry cannot demote required static path: ${requiredPath}.`);
    }
  }
  if (registry.staticDirectoryPaths.includes('scripts/codex/')) {
    throw new Error('scripts/codex/ cannot be a directory-level verifier trust root.');
  }
  for (const [index, edge] of registry.reviewedSutEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedSutEdges[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedSutEdges[${index}].from`, false);
    assertRepositoryPath(match[2]!, `reviewedSutEdges[${index}].to`, false);
  }
  for (const [index, edge] of registry.reviewedBoundaryEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedBoundaryEdges[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedBoundaryEdges[${index}].from`, false);
    assertRepositoryPath(match[2]!, `reviewedBoundaryEdges[${index}].to`, false);
    if (!registry.staticExactPaths.includes(match[2]!)) {
      throw new Error(`Reviewed boundary target is not a staticExactPath: ${match[2]}.`);
    }
  }
  for (const [index, edge] of registry.reviewedExternalImports.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedExternalImports[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedExternalImports[${index}].from`, false);
    assertExternalModuleSpecifier(match[2]!, `reviewedExternalImports[${index}].specifier`);
  }
  return registry;
}

export function parseTrustedBootstrapRegistry(source: string): TrustedBootstrapRegistry {
  assertRegistrySourceEnvelope(source);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Trusted bootstrap registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rawKeys = topLevelJsonObjectKeys(source);
  if (rawKeys.length !== REGISTRY_KEYS.length || new Set(rawKeys).size !== rawKeys.length) {
    throw new Error('Trusted bootstrap registry top-level keys must appear exactly once.');
  }
  return validateTrustedBootstrapRegistryValue(value);
}

function loadTrustedBootstrapRegistry(): TrustedBootstrapRegistry {
  const absolutePath = path.join(import.meta.dir, 'ci-trust-root-registry.json');
  return parseTrustedBootstrapRegistry(readFileSync(absolutePath, 'utf8'));
}

export const TRUSTED_BOOTSTRAP_REGISTRY = loadTrustedBootstrapRegistry();

export function createTrustedBootstrapTrustRoot(
  input: Readonly<{
    registry: TrustedBootstrapRegistry;
    causalRuntimePaths: readonly string[];
  }>
): TrustedBootstrapTrustRoot {
  const registry = validateTrustedBootstrapRegistryValue(input.registry);
  const causalRuntimePaths = stringArray(input.causalRuntimePaths, 'causalRuntimePaths');
  causalRuntimePaths.forEach((entry, index) => assertRepositoryPath(entry, `causalRuntimePaths[${index}]`, false));
  const causal = new Set(causalRuntimePaths);
  for (const staticExactPath of registry.staticExactPaths) {
    if (causal.has(staticExactPath)) {
      throw new Error(`Trusted bootstrap path cannot be both staticExact and causalRuntime: ${staticExactPath}.`);
    }
  }
  if (causal.has(REPOSITORY_AUDIT_ENTRYPOINT_PATH)) {
    throw new Error('repository-audit.ts cannot enter the causal verifier closure without new physical closure evidence.');
  }
  for (const entrypoint of registry.runtimeEntrypoints) {
    if (!causal.has(entrypoint)) {
      throw new Error(`Runtime entrypoint is absent from causalRuntimePaths: ${entrypoint}.`);
    }
  }
  for (const [index, edge] of registry.reviewedSutEdges.entries()) {
    const source = /^([^ ]+) -> ([^ ]+)$/u.exec(edge)?.[1];
    if (source === undefined || !causal.has(source)) {
      throw new Error(`Reviewed SUT edge source is outside causalRuntimePaths: ${source ?? index}.`);
    }
  }
  for (const [index, edge] of registry.reviewedBoundaryEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    const source = match?.[1];
    const target = match?.[2];
    if (source === undefined || !causal.has(source)) {
      throw new Error(`Reviewed boundary source is outside causalRuntimePaths: ${source ?? index}.`);
    }
    if (target !== undefined && causal.has(target)) {
      throw new Error(`Reviewed boundary target cannot also be a causalRuntimePath: ${target}.`);
    }
  }
  return Object.freeze({
    schema: 'sec-trusted-bootstrap-trust-root-v3' as const,
    registry,
    causalRuntimePaths: Object.freeze(causalRuntimePaths),
    paths: Object.freeze([...new Set([...registry.staticExactPaths, ...registry.staticDirectoryPaths, ...causalRuntimePaths])].sort()),
    prefixes: registry.staticPrefixes
  });
}

export function matchTrustedBootstrapPath(
  repositoryPath: string,
  trustRoot: TrustedBootstrapTrustRoot
): TrustedBootstrapPathMatch | null {
  assertRepositoryPath(repositoryPath, 'repositoryPath', false);
  const registry = trustRoot.registry;
  if (registry.staticExactPaths.includes(repositoryPath)) {
    return { kind: 'static-exact', rule: repositoryPath };
  }
  const staticDirectory = registry.staticDirectoryPaths.find((entry) => repositoryPath.startsWith(entry));
  if (staticDirectory) return { kind: 'static-directory', rule: staticDirectory };
  const staticPrefix = registry.staticPrefixes.find((entry) => repositoryPath.startsWith(entry));
  if (staticPrefix) return { kind: 'static-prefix', rule: staticPrefix };
  if (trustRoot.causalRuntimePaths.includes(repositoryPath)) {
    return { kind: 'causal-runtime', rule: repositoryPath };
  }
  return null;
}
