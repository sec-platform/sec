import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA_V1 = 'sec-trusted-bootstrap-registry-v1' as const;
export const SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V1 = 'platform/shared/ci-trust-root-registry.json' as const;

export type SecTrustedBootstrapRegistryV1 = Readonly<{
  schema: typeof SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA_V1;
  staticExactPaths: readonly string[];
  staticDirectoryPaths: readonly string[];
  staticPrefixes: readonly string[];
  runtimeEntrypoints: readonly string[];
  reviewedSutEdges: readonly string[];
  causalRuntimePaths: readonly string[];
}>;

export type SecTrustedBootstrapPathMatchV1 = Readonly<{
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
  'causalRuntimePaths'
] as const;

const REQUIRED_STATIC_EXACT_PATHS = [
  '.bun-version',
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V1,
  'platform/shared/tcb-closure-lock.ts'
] as const;

const REQUIRED_CAUSAL_RUNTIME_PATHS = ['platform/shared/tcb-trust-root-contract.ts', 'scripts/codex/merge-gate.ts'] as const;

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
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/u.test(value) || value.includes('//'))
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

function stringArray(value: unknown, label: string, maximum = 4_096): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty bounded array.`);
  }
  const result = value.map((entry, index) => {
    assertBoundedNfc(entry, `${label}[${index}]`);
    return entry;
  });
  assertSortedUnique(result, label);
  return result;
}

function assertNoStaticOverlap(registry: SecTrustedBootstrapRegistryV1): void {
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

export function parseSecTrustedBootstrapRegistryV1(source: string): SecTrustedBootstrapRegistryV1 {
  assertRegistrySourceEnvelope(source);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Trusted bootstrap registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertPlainObject(value, 'trusted bootstrap registry');
  assertExactKeys(value);
  const rawKeys = topLevelJsonObjectKeys(source);
  if (rawKeys.length !== REGISTRY_KEYS.length || new Set(rawKeys).size !== rawKeys.length) {
    throw new Error('Trusted bootstrap registry top-level keys must appear exactly once.');
  }
  if (value.schema !== SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA_V1) {
    throw new Error('Trusted bootstrap registry schema mismatch.');
  }

  const staticExactPaths = stringArray(value.staticExactPaths, 'staticExactPaths');
  const staticDirectoryPaths = stringArray(value.staticDirectoryPaths, 'staticDirectoryPaths');
  const staticPrefixes = stringArray(value.staticPrefixes, 'staticPrefixes', 128);
  const runtimeEntrypoints = stringArray(value.runtimeEntrypoints, 'runtimeEntrypoints');
  const reviewedSutEdges = stringArray(value.reviewedSutEdges, 'reviewedSutEdges');
  const causalRuntimePaths = stringArray(value.causalRuntimePaths, 'causalRuntimePaths');

  staticExactPaths.forEach((entry, index) => assertRepositoryPath(entry, `staticExactPaths[${index}]`, false));
  staticDirectoryPaths.forEach((entry, index) => assertRepositoryPath(entry, `staticDirectoryPaths[${index}]`, true));
  staticPrefixes.forEach((entry, index) => assertPrefix(entry, `staticPrefixes[${index}]`));
  runtimeEntrypoints.forEach((entry, index) => assertRepositoryPath(entry, `runtimeEntrypoints[${index}]`, false));
  causalRuntimePaths.forEach((entry, index) => assertRepositoryPath(entry, `causalRuntimePaths[${index}]`, false));

  const registry: SecTrustedBootstrapRegistryV1 = Object.freeze({
    schema: SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA_V1,
    staticExactPaths: Object.freeze(staticExactPaths),
    staticDirectoryPaths: Object.freeze(staticDirectoryPaths),
    staticPrefixes: Object.freeze(staticPrefixes),
    runtimeEntrypoints: Object.freeze(runtimeEntrypoints),
    reviewedSutEdges: Object.freeze(reviewedSutEdges),
    causalRuntimePaths: Object.freeze(causalRuntimePaths)
  });

  assertNoStaticOverlap(registry);
  if (registry.staticDirectoryPaths.includes('scripts/codex/')) {
    throw new Error('scripts/codex/ cannot be a directory-level verifier trust root.');
  }
  for (const required of REQUIRED_STATIC_EXACT_PATHS) {
    if (!registry.staticExactPaths.includes(required)) {
      throw new Error(`Trusted bootstrap registry omits required privileged surface ${required}.`);
    }
  }
  for (const required of REQUIRED_CAUSAL_RUNTIME_PATHS) {
    if (!registry.causalRuntimePaths.includes(required)) {
      throw new Error(`Trusted bootstrap registry causal closure omits required runtime surface ${required}.`);
    }
  }
  if (registry.causalRuntimePaths.includes('scripts/codex/repository-audit.ts')) {
    throw new Error('repository-audit.ts cannot enter the causal verifier closure without new physical closure evidence.');
  }
  const causal = new Set(registry.causalRuntimePaths);
  for (const entrypoint of registry.runtimeEntrypoints) {
    if (!causal.has(entrypoint)) {
      throw new Error(`Runtime entrypoint is absent from causalRuntimePaths: ${entrypoint}.`);
    }
  }
  for (const [index, edge] of registry.reviewedSutEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedSutEdges[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedSutEdges[${index}].from`, false);
    assertRepositoryPath(match[2]!, `reviewedSutEdges[${index}].to`, false);
    if (!causal.has(match[1]!)) {
      throw new Error(`Reviewed SUT edge source is outside causalRuntimePaths: ${match[1]}.`);
    }
  }
  return registry;
}

export function loadSecTrustedBootstrapRegistryV1(): SecTrustedBootstrapRegistryV1 {
  const absolutePath = path.join(import.meta.dir, 'ci-trust-root-registry.json');
  return parseSecTrustedBootstrapRegistryV1(readFileSync(absolutePath, 'utf8'));
}

export const SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1 = loadSecTrustedBootstrapRegistryV1();

export const SEC_TRUST_ROOT_PATHS_V1 = Object.freeze(
  [
    ...new Set([
      ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1.staticExactPaths,
      ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1.staticDirectoryPaths,
      ...SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1.causalRuntimePaths
    ])
  ].sort()
);

export const SEC_TRUST_ROOT_PREFIXES_V1 = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1.staticPrefixes;

export function matchSecTrustedBootstrapPathV1(
  repositoryPath: string,
  registry: SecTrustedBootstrapRegistryV1 = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1
): SecTrustedBootstrapPathMatchV1 | null {
  assertRepositoryPath(repositoryPath, 'repositoryPath', false);
  if (registry.staticExactPaths.includes(repositoryPath)) {
    return { kind: 'static-exact', rule: repositoryPath };
  }
  const staticDirectory = registry.staticDirectoryPaths.find((entry) => repositoryPath.startsWith(entry));
  if (staticDirectory) return { kind: 'static-directory', rule: staticDirectory };
  const staticPrefix = registry.staticPrefixes.find((entry) => repositoryPath.startsWith(entry));
  if (staticPrefix) return { kind: 'static-prefix', rule: staticPrefix };
  if (registry.causalRuntimePaths.includes(repositoryPath)) {
    return { kind: 'causal-runtime', rule: repositoryPath };
  }
  return null;
}
