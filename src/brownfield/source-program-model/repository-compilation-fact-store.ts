import path from 'node:path';

import {
  PhysicalNoFollowError,
  publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile,
  scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryIdentity
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryLeaf } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { currentSecRuntimePlatform, resolveSecRuntimeCacheRoot, secRuntimeStateEnvironment } from '../../runtime-state/workspace-state/layout.ts';
import {
  acquireSecRuntimeCachePhysicalAuthority,
  type SecRuntimeCachePhysicalAuthority
} from '../../runtime-state/workspace-state/physical-authority.ts';
import { SecError } from '../../system-architecture/foundation/contract/failure.ts';
import { canonicalJson, compareCodeUnits, isPlainObject, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { parseExactJson } from '../../system-architecture/foundation/runtime/exact-json.ts';
import {
  encodeTypeScriptSourceProgramFactShard,
  parseTypeScriptSourceProgramFactShard,
  type TypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import {
  assertSourceProgramTypeScriptCompilerIdentity,
  type SourceProgramTypeScriptCompilerIdentity
} from './typescript.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const IO_BUDGET_MS = 5_000;
const STORE_SCHEMA = Object.freeze({
  identity: 'repository-source-program-compilation-generation-store',
  keyDimensions: Object.freeze([
    'exact-source-snapshot', 'module-membership', 'module-graph',
    'compiler-provider-environment', 'compiler-implementation-closure'
  ]),
  publication: 'immutable-canonical-fact-pack-and-manifest-last',
  semanticAuthority: 'none-cache-is-disposable-acceleration',
  scope: 'disposable-runtime-cache'
});
const STORE_SCHEMA_DIGEST = sha256(STORE_SCHEMA) as `sha256:${string}`;
const MANIFEST_KEYS = Object.freeze([
  'compilerConfigDigest', 'compilerImplementationDigest', 'compilerRevision',
  'dependencyGenerationDigest', 'environmentDigest', 'keyDigest', 'manifestDigest',
  'moduleGraphDigest', 'moduleMembershipDigest', 'packByteLength', 'packDigest',
  'packFileName', 'providerRevision', 'schemaDigest', 'shards', 'snapshotDigest'
]);
const SHARD_KEYS = Object.freeze(['length', 'moduleDigest', 'offset', 'path', 'rawFileDigest', 'shardDigest']);
const PREDECESSOR_POINTER_NAME = 'predecessor.json';
const PREDECESSOR_POINTER_SCHEMA_DIGEST = sha256(Object.freeze({
  identity: 'repository-source-program-compilation-predecessor-hint',
  authority: 'none-advisory-validated-before-use',
  cardinality: 'at-most-one',
  target: 'one-immutable-generation'
})) as `sha256:${string}`;
const PREDECESSOR_POINTER_KEYS = Object.freeze([
  'compilerGenerationDigest', 'compilerImplementationDigest', 'keyDigest',
  'moduleGraphDigest', 'moduleMembershipDigest', 'pointerDigest',
  'schemaDigest', 'snapshotDigest'
]);

export type RepositoryCompilationFactStoreFailureKind =
  | 'corrupt-cache'
  | 'foreign-residue'
  | 'identity-mismatch'
  | 'physical-replacement';

export class RepositoryCompilationFactStoreError extends SecError {
  readonly kind: RepositoryCompilationFactStoreFailureKind;

  constructor(kind: RepositoryCompilationFactStoreFailureKind, message: string, cause?: unknown) {
    super('SOURCE-PROGRAM-CACHE-001', message, { kind }, cause === undefined ? undefined : { cause });
    this.name = 'RepositoryCompilationFactStoreError';
    this.kind = kind;
  }
}

/** Caller provenance is deliberately absent from reusable semantic facts. */
export interface RepositoryCompilationFactStoreIdentity {
  readonly snapshotDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly compilerImplementationDigest: `sha256:${string}`;
  readonly compiler: SourceProgramTypeScriptCompilerIdentity;
}

type ManifestShard = Readonly<{
  path: string;
  offset: number;
  length: number;
  shardDigest: `sha256:${string}`;
  rawFileDigest: `sha256:${string}`;
  moduleDigest: `sha256:${string}`;
}>;

type Manifest = Readonly<{
  schemaDigest: `sha256:${string}`;
  keyDigest: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  moduleMembershipDigest: `sha256:${string}`;
  moduleGraphDigest: `sha256:${string}`;
  compilerRevision: `sha256:${string}`;
  providerRevision: `sha256:${string}`;
  compilerConfigDigest: `sha256:${string}`;
  compilerImplementationDigest: `sha256:${string}`;
  dependencyGenerationDigest: `sha256:${string}`;
  environmentDigest: `sha256:${string}`;
  packFileName: string;
  packDigest: `sha256:${string}`;
  packByteLength: number;
  shards: readonly ManifestShard[];
  manifestDigest: `sha256:${string}`;
}>;

type FactPack = Readonly<{
  bytes: Uint8Array;
  digest: `sha256:${string}`;
  fileName: string;
  shards: readonly ManifestShard[];
}>;

type PredecessorPointer = Readonly<{
  schemaDigest: `sha256:${string}`;
  keyDigest: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  moduleMembershipDigest: `sha256:${string}`;
  moduleGraphDigest: `sha256:${string}`;
  compilerImplementationDigest: `sha256:${string}`;
  compilerGenerationDigest: `sha256:${string}`;
  pointerDigest: `sha256:${string}`;
}>;

export interface RepositoryCompilationFactStoreDiagnostics {
  readonly physicalAdmissionMs: number;
  readonly manifestReadMs: number;
  readonly manifestParseMs: number;
  readonly packReadMs: number;
  readonly packBytes: number;
  readonly shardParseMs: number;
}

export type RepositoryCompilationFactStoreLoad = Readonly<{
  status: 'hit';
  keyDigest: `sha256:${string}`;
  generation: Readonly<{
    snapshotDigest: `sha256:${string}`;
    moduleMembershipDigest: `sha256:${string}`;
    moduleGraphDigest: `sha256:${string}`;
  }>;
  shards: readonly TypeScriptSourceProgramFactShard[];
  diagnostics: RepositoryCompilationFactStoreDiagnostics;
}> | Readonly<{
  status: 'miss';
  keyDigest: `sha256:${string}`;
}>;

export interface RepositoryCompilationFactStore {
  readonly cacheRoot: string;
  readonly keyDigest: `sha256:${string}`;
  load(): RepositoryCompilationFactStoreLoad;
  loadPredecessor(): RepositoryCompilationFactStoreLoad;
  publish(shards: readonly TypeScriptSourceProgramFactShard[]): RepositoryCompilationFactStoreLoad;
}

function exactObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} must be one exact object`);
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has noncanonical keys`);
  }
}

function exactDigest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} is invalid`);
}

function exactNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`);
}

function generationKey(identity: RepositoryCompilationFactStoreIdentity): `sha256:${string}` {
  return sha256({
    schemaDigest: STORE_SCHEMA_DIGEST,
    snapshotDigest: identity.snapshotDigest,
    moduleMembershipDigest: identity.moduleMembershipDigest,
    moduleGraphDigest: identity.moduleGraphDigest,
    compilerRevision: identity.compiler.compilerRevision,
    providerRevision: identity.compiler.providerRevision,
    compilerConfigDigest: identity.compiler.compilerConfigDigest,
    compilerImplementationDigest: identity.compilerImplementationDigest,
    dependencyGenerationDigest: identity.compiler.dependencyGenerationDigest,
    environmentDigest: identity.compiler.environmentDigest
  }) as `sha256:${string}`;
}

function compilerGenerationDigest(
  identity: RepositoryCompilationFactStoreIdentity
): `sha256:${string}` {
  return sha256({
    compilerRevision: identity.compiler.compilerRevision,
    providerRevision: identity.compiler.providerRevision,
    compilerConfigDigest: identity.compiler.compilerConfigDigest,
    compilerImplementationDigest: identity.compilerImplementationDigest,
    dependencyGenerationDigest: identity.compiler.dependencyGenerationDigest,
    environmentDigest: identity.compiler.environmentDigest
  }) as `sha256:${string}`;
}

function buildPredecessorPointer(
  identity: RepositoryCompilationFactStoreIdentity,
  keyDigest: `sha256:${string}`
): PredecessorPointer {
  const canonical = Object.freeze({
    schemaDigest: PREDECESSOR_POINTER_SCHEMA_DIGEST,
    keyDigest,
    snapshotDigest: identity.snapshotDigest,
    moduleMembershipDigest: identity.moduleMembershipDigest,
    moduleGraphDigest: identity.moduleGraphDigest,
    compilerImplementationDigest: identity.compilerImplementationDigest,
    compilerGenerationDigest: compilerGenerationDigest(identity)
  });
  return Object.freeze({
    ...canonical,
    pointerDigest: sha256(canonical) as `sha256:${string}`
  });
}

function encodePredecessorPointer(pointer: PredecessorPointer): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalJson(pointer)));
}

function parsePredecessorPointer(
  bytes: Uint8Array,
  currentIdentity: RepositoryCompilationFactStoreIdentity
): PredecessorPointer {
  const source = decodeExactUtf8(bytes, 'Repository compilation predecessor hint');
  const value = parseExactJson(source, 'Repository compilation predecessor hint', {
    rootObjectKeys: PREDECESSOR_POINTER_KEYS
  });
  exactObject(value, PREDECESSOR_POINTER_KEYS, 'Repository compilation predecessor hint');
  for (const key of PREDECESSOR_POINTER_KEYS) exactDigest(
    value[key],
    `Repository compilation predecessor ${key}`
  );
  const parsed = Object.freeze({
    schemaDigest: value.schemaDigest as `sha256:${string}`,
    keyDigest: value.keyDigest as `sha256:${string}`,
    snapshotDigest: value.snapshotDigest as `sha256:${string}`,
    moduleMembershipDigest: value.moduleMembershipDigest as `sha256:${string}`,
    moduleGraphDigest: value.moduleGraphDigest as `sha256:${string}`,
    compilerImplementationDigest: value.compilerImplementationDigest as `sha256:${string}`,
    compilerGenerationDigest: value.compilerGenerationDigest as `sha256:${string}`,
    pointerDigest: value.pointerDigest as `sha256:${string}`
  }) satisfies PredecessorPointer;
  const unsigned = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'pointerDigest'));
  if (parsed.schemaDigest !== PREDECESSOR_POINTER_SCHEMA_DIGEST
      || parsed.compilerGenerationDigest !== compilerGenerationDigest(currentIdentity)
      || parsed.keyDigest !== generationKey({
        snapshotDigest: parsed.snapshotDigest,
        moduleMembershipDigest: parsed.moduleMembershipDigest,
        moduleGraphDigest: parsed.moduleGraphDigest,
        compilerImplementationDigest: parsed.compilerImplementationDigest,
        compiler: currentIdentity.compiler
      })
      || parsed.pointerDigest !== sha256(unsigned)
      || source !== JSON.stringify(canonicalJson(parsed))) {
    throw new Error('Repository compilation predecessor hint is stale, foreign, or noncanonical');
  }
  return parsed;
}

function packName(digest: string): string {
  exactDigest(digest, 'Repository compilation fact-pack digest');
  return `${digest.slice('sha256:'.length)}.pack`;
}

function buildPack(shards: readonly TypeScriptSourceProgramFactShard[]): FactPack {
  const ordered = [...shards].sort((left, right) => compareCodeUnits(left.path, right.path));
  if (new Set(ordered.map((shard) => shard.path)).size !== ordered.length) {
    throw new RepositoryCompilationFactStoreError('corrupt-cache', 'Fact shards are not uniquely addressable');
  }
  const chunks: Uint8Array[] = [];
  const entries: ManifestShard[] = [];
  let offset = 0;
  for (const shard of ordered) {
    const bytes = encodeTypeScriptSourceProgramFactShard(shard);
    chunks.push(bytes);
    entries.push(Object.freeze({
      path: shard.path,
      offset,
      length: bytes.byteLength,
      shardDigest: shard.shardDigest as `sha256:${string}`,
      rawFileDigest: shard.rawFileDigest as `sha256:${string}`,
      moduleDigest: shard.moduleDigest as `sha256:${string}`
    }));
    offset += bytes.byteLength;
  }
  const bytes = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  const digest = rawSha256(bytes);
  return Object.freeze({ bytes, digest, fileName: packName(digest), shards: Object.freeze(entries) });
}

function unsignedManifest(
  identity: RepositoryCompilationFactStoreIdentity,
  keyDigest: `sha256:${string}`,
  pack: FactPack
): Omit<Manifest, 'manifestDigest'> {
  return Object.freeze({
    schemaDigest: STORE_SCHEMA_DIGEST,
    keyDigest,
    snapshotDigest: identity.snapshotDigest,
    moduleMembershipDigest: identity.moduleMembershipDigest,
    moduleGraphDigest: identity.moduleGraphDigest,
    compilerRevision: identity.compiler.compilerRevision,
    providerRevision: identity.compiler.providerRevision,
    compilerConfigDigest: identity.compiler.compilerConfigDigest,
    compilerImplementationDigest: identity.compilerImplementationDigest,
    dependencyGenerationDigest: identity.compiler.dependencyGenerationDigest,
    environmentDigest: identity.compiler.environmentDigest,
    packFileName: pack.fileName,
    packDigest: pack.digest,
    packByteLength: pack.bytes.byteLength,
    shards: pack.shards
  });
}

function buildManifest(identity: RepositoryCompilationFactStoreIdentity, keyDigest: `sha256:${string}`, pack: FactPack): Manifest {
  const canonical = unsignedManifest(identity, keyDigest, pack);
  return Object.freeze({ ...canonical, manifestDigest: sha256(canonical) as `sha256:${string}` });
}

function encodeManifest(manifest: Manifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalJson(manifest)));
}

function parseManifest(bytes: Uint8Array, identity: RepositoryCompilationFactStoreIdentity): Manifest {
  const source = decodeExactUtf8(bytes, 'Repository compilation fact-store manifest');
  const value = parseExactJson(source, 'Repository compilation fact-store manifest', { rootObjectKeys: MANIFEST_KEYS });
  exactObject(value, MANIFEST_KEYS, 'Repository compilation fact-store manifest');
  for (const key of [
    'schemaDigest', 'keyDigest', 'snapshotDigest', 'moduleMembershipDigest', 'moduleGraphDigest',
    'compilerRevision', 'providerRevision', 'compilerConfigDigest', 'compilerImplementationDigest',
    'dependencyGenerationDigest', 'environmentDigest', 'packDigest', 'manifestDigest'
  ]) exactDigest(value[key], `Repository compilation manifest ${key}`);
  if (typeof value.packFileName !== 'string' || !Array.isArray(value.shards)) {
    throw new Error('Repository compilation manifest shape is invalid');
  }
  exactNonNegativeInteger(value.packByteLength, 'Repository compilation pack length');
  if (value.packFileName !== packName(value.packDigest as string)) throw new Error('Fact-pack name is not content-addressed');
  let expectedOffset = 0;
  const shards = value.shards.map((entry, index): ManifestShard => {
    exactObject(entry, SHARD_KEYS, `Manifest shard ${index}`);
    if (typeof entry.path !== 'string' || entry.path.length === 0) throw new Error(`Manifest shard ${index} path is invalid`);
    exactNonNegativeInteger(entry.offset, `Manifest shard ${index} offset`);
    exactNonNegativeInteger(entry.length, `Manifest shard ${index} length`);
    if (entry.length === 0 || entry.offset !== expectedOffset) throw new Error(`Manifest shard ${index} range is not contiguous`);
    expectedOffset += entry.length;
    if (expectedOffset > (value.packByteLength as number)) throw new Error(`Manifest shard ${index} exceeds the fact pack`);
    exactDigest(entry.shardDigest, `Manifest shard ${index} digest`);
    exactDigest(entry.rawFileDigest, `Manifest shard ${index} raw digest`);
    exactDigest(entry.moduleDigest, `Manifest shard ${index} module digest`);
    return Object.freeze({
      path: entry.path,
      offset: entry.offset,
      length: entry.length,
      shardDigest: entry.shardDigest,
      rawFileDigest: entry.rawFileDigest,
      moduleDigest: entry.moduleDigest
    });
  });
  if (expectedOffset !== (value.packByteLength as number)) throw new Error('Manifest ranges do not cover the fact pack');
  const parsed = Object.freeze({
    schemaDigest: value.schemaDigest as `sha256:${string}`,
    keyDigest: value.keyDigest as `sha256:${string}`,
    snapshotDigest: value.snapshotDigest as `sha256:${string}`,
    moduleMembershipDigest: value.moduleMembershipDigest as `sha256:${string}`,
    moduleGraphDigest: value.moduleGraphDigest as `sha256:${string}`,
    compilerRevision: value.compilerRevision as `sha256:${string}`,
    providerRevision: value.providerRevision as `sha256:${string}`,
    compilerConfigDigest: value.compilerConfigDigest as `sha256:${string}`,
    compilerImplementationDigest: value.compilerImplementationDigest as `sha256:${string}`,
    dependencyGenerationDigest: value.dependencyGenerationDigest as `sha256:${string}`,
    environmentDigest: value.environmentDigest as `sha256:${string}`,
    packFileName: value.packFileName,
    packDigest: value.packDigest as `sha256:${string}`,
    packByteLength: value.packByteLength as number,
    shards: Object.freeze(shards),
    manifestDigest: value.manifestDigest as `sha256:${string}`
  }) satisfies Manifest;
  if (parsed.schemaDigest !== STORE_SCHEMA_DIGEST
      || parsed.keyDigest !== generationKey(identity)
      || parsed.snapshotDigest !== identity.snapshotDigest
      || parsed.moduleMembershipDigest !== identity.moduleMembershipDigest
      || parsed.moduleGraphDigest !== identity.moduleGraphDigest
      || parsed.compilerRevision !== identity.compiler.compilerRevision
      || parsed.providerRevision !== identity.compiler.providerRevision
      || parsed.compilerConfigDigest !== identity.compiler.compilerConfigDigest
      || parsed.compilerImplementationDigest !== identity.compilerImplementationDigest
      || parsed.dependencyGenerationDigest !== identity.compiler.dependencyGenerationDigest
      || parsed.environmentDigest !== identity.compiler.environmentDigest) {
    throw new RepositoryCompilationFactStoreError('identity-mismatch', 'Fact-store manifest identity is stale or foreign');
  }
  const unsigned = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== 'manifestDigest'));
  if (parsed.manifestDigest !== sha256(unsigned)
      || source !== JSON.stringify(canonicalJson(parsed))
      || new Set(shards.map((shard) => shard.path)).size !== shards.length
      || shards.some((entry, index) => index > 0 && compareCodeUnits(shards[index - 1]!.path, entry.path) >= 0)) {
    throw new RepositoryCompilationFactStoreError('corrupt-cache', 'Fact-store manifest is not canonical or digest-bound');
  }
  return parsed;
}

function assertContents(directory: PhysicalDirectoryIdentity, allowedFiles: ReadonlySet<string>): void {
  const inventory = scanNoFollowDirectoryTreeMetadata(directory, {
    deadlineAtMs: performance.now() + IO_BUDGET_MS,
    maximumEntries: allowedFiles.size + 1
  });
  const residue = inventory.find(({ relativePath, kind }) => relativePath.length === 0 || kind !== 'file' || !allowedFiles.has(relativePath));
  if (residue !== undefined || inventory.length !== allowedFiles.size) {
    throw new RepositoryCompilationFactStoreError(
      'foreign-residue',
      `Fact-store generation has unknown or incomplete residue${residue === undefined ? '' : `: ${residue.relativePath}`}`
    );
  }
}

function atStoreBoundary<Value>(label: string, operation: () => Value): Value {
  try {
    return operation();
  } catch (error) {
    if (error instanceof RepositoryCompilationFactStoreError) throw error;
    const kind: RepositoryCompilationFactStoreFailureKind =
      error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
        ? 'physical-replacement'
        : 'corrupt-cache';
    throw new RepositoryCompilationFactStoreError(kind, `${label} failed closed`, error);
  }
}

function loadGeneration(input: Readonly<{
  authority: SecRuntimeCachePhysicalAuthority;
  directory: PhysicalDirectoryIdentity;
  identity: RepositoryCompilationFactStoreIdentity;
  keyDigest: `sha256:${string}`;
  physicalAdmissionMs: number;
}>): RepositoryCompilationFactStoreLoad {
  const manifestReadStarted = performance.now();
  input.authority.assertCurrent();
  const manifestBytes = readOptionalRetainedOrdinaryLeaf(input.directory, 'manifest.json');
  if (manifestBytes === null) return Object.freeze({ status: 'miss', keyDigest: input.keyDigest });
  const manifestReadMs = performance.now() - manifestReadStarted;
  const manifestParseStarted = performance.now();
  let manifest: Manifest;
  try {
    manifest = parseManifest(manifestBytes, input.identity);
  } catch (error) {
    if (error instanceof RepositoryCompilationFactStoreError) throw error;
    throw new RepositoryCompilationFactStoreError('corrupt-cache', 'Fact-store manifest is invalid', error);
  }
  const manifestParseMs = performance.now() - manifestParseStarted;
  assertContents(input.directory, new Set(['manifest.json', manifest.packFileName]));
  const packReadStarted = performance.now();
  const packBytes = readOptionalRetainedOrdinaryLeaf(input.directory, manifest.packFileName);
  if (packBytes === null) throw new RepositoryCompilationFactStoreError('corrupt-cache', 'Fact pack is absent');
  const packReadMs = performance.now() - packReadStarted;
  if (packBytes.byteLength !== manifest.packByteLength || rawSha256(packBytes) !== manifest.packDigest) {
    throw new RepositoryCompilationFactStoreError('corrupt-cache', 'Fact pack bytes do not match the manifest');
  }
  const shardParseStarted = performance.now();
  const shards = manifest.shards.map((entry) => {
    let shard: TypeScriptSourceProgramFactShard;
    try {
      shard = parseTypeScriptSourceProgramFactShard(packBytes.subarray(entry.offset, entry.offset + entry.length));
    } catch (error) {
      throw new RepositoryCompilationFactStoreError('corrupt-cache', `Fact-pack shard ${entry.path} is invalid`, error);
    }
    if (shard.path !== entry.path
        || shard.shardDigest !== entry.shardDigest
        || shard.rawFileDigest !== entry.rawFileDigest
        || shard.moduleDigest !== entry.moduleDigest
        || shard.compilerRevision !== input.identity.compiler.compilerRevision
        || shard.providerRevision !== input.identity.compiler.providerRevision) {
      throw new RepositoryCompilationFactStoreError('identity-mismatch', `Fact-pack shard ${entry.path} is stale or foreign`);
    }
    return shard;
  });
  const shardParseMs = performance.now() - shardParseStarted;
  input.authority.assertCurrent();
  return Object.freeze({
    status: 'hit',
    keyDigest: input.keyDigest,
    generation: Object.freeze({
      snapshotDigest: input.identity.snapshotDigest,
      moduleMembershipDigest: input.identity.moduleMembershipDigest,
      moduleGraphDigest: input.identity.moduleGraphDigest
    }),
    shards: Object.freeze(shards),
    diagnostics: Object.freeze({
      physicalAdmissionMs: input.physicalAdmissionMs,
      manifestReadMs,
      manifestParseMs,
      packReadMs,
      packBytes: packBytes.byteLength,
      shardParseMs
    })
  });
}

export function createRepositoryCompilationFactStore(input: Readonly<{
  repositoryRoot: string;
  identity: RepositoryCompilationFactStoreIdentity;
}>): RepositoryCompilationFactStore {
  assertSourceProgramTypeScriptCompilerIdentity(input.identity.compiler);
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const cacheRoot = resolveSecRuntimeCacheRoot({
    platform: currentSecRuntimePlatform(),
    environment: secRuntimeStateEnvironment(),
    repositoryRoot
  });
  const keyDigest = generationKey(input.identity);
  const namespaceRoot = path.join(cacheRoot, 'source-program', 'repository-compilations', STORE_SCHEMA_DIGEST.slice(7));
  const generationRoot = path.join(namespaceRoot, keyDigest.slice(7));
  const admissionStarted = performance.now();
  const authority = acquireSecRuntimeCachePhysicalAuthority({
    repositoryRoot,
    cacheRoot,
    requiredDirectories: [namespaceRoot, generationRoot]
  });
  const directory = authority.directory(generationRoot);
  const namespaceDirectory = authority.directory(namespaceRoot);
  const physicalAdmissionMs = performance.now() - admissionStarted;

  const loadInternal = (): RepositoryCompilationFactStoreLoad => loadGeneration({
    authority,
    directory,
    identity: input.identity,
    keyDigest,
    physicalAdmissionMs
  });

  const loadPredecessorInternal = (): RepositoryCompilationFactStoreLoad => {
    try {
      authority.assertCurrent();
      const pointerBytes = readOptionalRetainedOrdinaryLeaf(
        namespaceDirectory,
        PREDECESSOR_POINTER_NAME
      );
      if (pointerBytes === null) return Object.freeze({ status: 'miss', keyDigest });
      const pointer = parsePredecessorPointer(pointerBytes, input.identity);
      if (pointer.keyDigest === keyDigest) return Object.freeze({ status: 'miss', keyDigest });
      const predecessorIdentity = Object.freeze({
        snapshotDigest: pointer.snapshotDigest,
        moduleMembershipDigest: pointer.moduleMembershipDigest,
        moduleGraphDigest: pointer.moduleGraphDigest,
        compilerImplementationDigest: pointer.compilerImplementationDigest,
        compiler: input.identity.compiler
      }) satisfies RepositoryCompilationFactStoreIdentity;
      const predecessorRoot = path.join(namespaceRoot, pointer.keyDigest.slice(7));
      const predecessorAdmissionStarted = performance.now();
      const predecessorAuthority = acquireSecRuntimeCachePhysicalAuthority({
        repositoryRoot,
        cacheRoot,
        requiredDirectories: [namespaceRoot, predecessorRoot]
      });
      const predecessorDirectory = predecessorAuthority.directory(predecessorRoot);
      const predecessorAdmissionMs = performance.now() - predecessorAdmissionStarted;
      authority.assertCurrent();
      const pointerReadback = readOptionalRetainedOrdinaryLeaf(
        namespaceDirectory,
        PREDECESSOR_POINTER_NAME
      );
      if (pointerReadback === null || !Buffer.from(pointerReadback).equals(Buffer.from(pointerBytes))) {
        return Object.freeze({ status: 'miss', keyDigest });
      }
      return loadGeneration({
        authority: predecessorAuthority,
        directory: predecessorDirectory,
        identity: predecessorIdentity,
        keyDigest: pointer.keyDigest,
        physicalAdmissionMs: predecessorAdmissionMs
      });
    } catch {
      // The pointer is a disposable acceleration hint. Any malformed, stale,
      // missing, foreign, or physically replaced predecessor is a cache miss.
      return Object.freeze({ status: 'miss', keyDigest });
    }
  };

  const publishInternal = (shards: readonly TypeScriptSourceProgramFactShard[]): RepositoryCompilationFactStoreLoad => {
    authority.assertCurrent();
    const pack = buildPack(shards);
    const manifest = buildManifest(input.identity, keyDigest, pack);
    const allowed = new Set(['manifest.json', pack.fileName]);
    const existing = scanNoFollowDirectoryTreeMetadata(directory, {
      deadlineAtMs: performance.now() + IO_BUDGET_MS,
      maximumEntries: allowed.size + 1
    });
    const foreign = existing.find(({ relativePath, kind }) => relativePath.length === 0 || kind !== 'file' || !allowed.has(relativePath));
    if (foreign !== undefined) {
      throw new RepositoryCompilationFactStoreError('foreign-residue', `Fact-store generation has foreign residue: ${foreign.relativePath}`);
    }
    publishExclusiveDurableCanonicalFile({
      parent: directory,
      name: pack.fileName,
      bytes: pack.bytes,
      validate: (candidate) => {
        if (candidate.byteLength !== pack.bytes.byteLength || rawSha256(candidate) !== pack.digest) {
          throw new Error('Fact-pack publication bytes are not canonical');
        }
      }
    });
    authority.assertCurrent();
    const manifestBytes = encodeManifest(manifest);
    publishExclusiveDurableCanonicalFile({
      parent: directory,
      name: 'manifest.json',
      bytes: manifestBytes,
      validate: (candidate) => { parseManifest(candidate, input.identity); }
    });
    const loaded = loadInternal();
    try {
      const pointer = buildPredecessorPointer(input.identity, keyDigest);
      replaceDurableCanonicalFile({
        parent: namespaceDirectory,
        name: PREDECESSOR_POINTER_NAME,
        bytes: encodePredecessorPointer(pointer),
        validate: (candidate) => { parsePredecessorPointer(candidate, input.identity); }
      });
    } catch {
      // Pointer publication cannot change the immutable generation or its
      // semantic result; it only removes the next operation's acceleration.
    }
    return loaded;
  };

  return Object.freeze({
    cacheRoot,
    keyDigest,
    load: () => atStoreBoundary('Repository compilation generation read', loadInternal),
    loadPredecessor: loadPredecessorInternal,
    publish: (shards: readonly TypeScriptSourceProgramFactShard[]) => atStoreBoundary(
      'Repository compilation generation publication',
      () => publishInternal(shards)
    )
  });
}
