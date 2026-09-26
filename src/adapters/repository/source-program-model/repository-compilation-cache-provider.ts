import { canonicalJson, compareCodeUnits, isPlainObject, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { isDigest } from '../../../contracts/digest.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import { FailureError } from '../../../contracts/failure.ts';
import {
  ContentAddressedWorkspaceCacheError,
  type ContentAddressedWorkspaceCacheEntry,
  type ContentAddressedWorkspaceCacheLoad,
  type ContentAddressedWorkspaceCachePredecessorLoad,
  type ContentAddressedWorkspaceCacheSession
} from '../../runtime-state/workspace-state/content-addressed-workspace-cache.ts';
import {
  assertRepositoryCompilationGenerationReceipt,
  repositoryCompilationCacheSchemaDigest,
  type RepositoryCompilationCacheHint,
  type RepositoryCompilationCacheLoad,
  type RepositoryCompilationCacheProvider,
  type RepositoryCompilationGenerationReceipt
} from './repository-compilation-cache.ts';
import {
  encodeTypeScriptSourceProgramFactShard,
  parseTypeScriptSourceProgramFactShard,
  type TypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';

const CACHE_NAMESPACE = 'repository-compilation';
const CACHE_MAXIMUM_ENTRIES = 2;
const MANIFEST_NAME = 'manifest.json';
const MANIFEST_KEYS = Object.freeze([
  'compilerConfigDigest', 'compilerRevision',
  'dependencyGenerationDigest', 'environmentDigest', 'generationReceiptDigest', 'keyDigest', 'manifestDigest',
  'moduleGraphDigest', 'moduleMembershipDigest', 'packByteLength', 'packDigest',
  'orderedSourceFactsDigest', 'packFileName', 'projectConfigDigest', 'projectInputDigest',
  'providerRevision', 'schemaDigest', 'shards', 'snapshotDigest', 'workspaceSnapshotIdentityDigest'
]);
const SHARD_KEYS = Object.freeze(['length', 'moduleDigest', 'offset', 'path', 'rawFileDigest', 'shardDigest']);
const PREDECESSOR_TOKEN_SCHEMA_DIGEST = sha256(Object.freeze({
  identity: 'repository-source-program-compilation-predecessor-token',
  authority: 'source-program-model',
  use: 'validated-incremental-compilation-hint'
})) as `sha256:${string}`;
const PREDECESSOR_TOKEN_KEYS = Object.freeze([
  'compilerGenerationDigest', 'generationReceiptDigest', 'keyDigest',
  'moduleGraphDigest', 'moduleMembershipDigest', 'orderedSourceFactsDigest',
  'projectConfigDigest', 'projectInputDigest', 'schemaDigest', 'snapshotDigest',
  'tokenDigest', 'workspaceSnapshotIdentityDigest'
]);

type CompilationCacheIdentity = Readonly<{
  generationDigest: `sha256:${string}`;
  generationReceiptDigest: `sha256:${string}`;
  projectInputDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  orderedSourceFactsDigest: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  moduleMembershipDigest: `sha256:${string}`;
  moduleGraphDigest: `sha256:${string}`;
  compiler: Readonly<{
    compilerRevision: `sha256:${string}`;
    providerRevision: `sha256:${string}`;
    compilerConfigDigest: `sha256:${string}`;
    dependencyGenerationDigest: `sha256:${string}`;
    environmentDigest: `sha256:${string}`;
  }>;
}>;

export type RepositoryCompilationCacheProviderFailureKind =
  | 'corrupt-cache'
  | 'foreign-residue'
  | 'identity-mismatch'
  | 'physical-replacement';

export class RepositoryCompilationCacheProviderError extends FailureError {
  readonly kind: RepositoryCompilationCacheProviderFailureKind;

  constructor(kind: RepositoryCompilationCacheProviderFailureKind, message: string, cause?: unknown) {
    super('SOURCE-PROGRAM-CACHE-001', message, { kind }, cause === undefined ? undefined : { cause });
    this.name = 'RepositoryCompilationCacheProviderError';
    this.kind = kind;
  }
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
  generationReceiptDigest: `sha256:${string}`;
  projectInputDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  orderedSourceFactsDigest: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  moduleMembershipDigest: `sha256:${string}`;
  moduleGraphDigest: `sha256:${string}`;
  compilerRevision: `sha256:${string}`;
  providerRevision: `sha256:${string}`;
  compilerConfigDigest: `sha256:${string}`;
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

type PredecessorToken = Readonly<{
  schemaDigest: `sha256:${string}`;
  keyDigest: `sha256:${string}`;
  generationReceiptDigest: `sha256:${string}`;
  projectInputDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  orderedSourceFactsDigest: `sha256:${string}`;
  snapshotDigest: `sha256:${string}`;
  moduleMembershipDigest: `sha256:${string}`;
  moduleGraphDigest: `sha256:${string}`;
  compilerGenerationDigest: `sha256:${string}`;
  tokenDigest: `sha256:${string}`;
}>;

function exactObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} must be one exact object`);
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has noncanonical keys`);
  }
}

function exactDigest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (!isDigest(value, 'sha256')) throw new Error(`${label} is invalid`);
}

function exactNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`);
}

function cacheIdentity(generation: RepositoryCompilationGenerationReceipt): CompilationCacheIdentity {
  assertRepositoryCompilationGenerationReceipt(generation);
  if (generation.projectInputDigest === null || generation.projectConfigDigest === null) {
    throw new Error('Repository compilation cache requires an explicit project generation');
  }
  return Object.freeze({
    generationDigest: generation.generationDigest,
    generationReceiptDigest: generation.receiptDigest,
    projectInputDigest: generation.projectInputDigest,
    projectConfigDigest: generation.projectConfigDigest,
    workspaceSnapshotIdentityDigest: generation.workspaceSnapshotIdentityDigest,
    orderedSourceFactsDigest: generation.orderedSourceFactsDigest,
    snapshotDigest: generation.snapshotDigest,
    moduleMembershipDigest: generation.moduleMembershipDigest,
    moduleGraphDigest: generation.moduleGraphDigest,
    compiler: Object.freeze({
      compilerRevision: generation.compilerRevision,
      providerRevision: generation.providerRevision,
      compilerConfigDigest: generation.compilerConfigDigest,
      dependencyGenerationDigest: generation.dependencyGenerationDigest,
      environmentDigest: generation.environmentDigest
    })
  });
}

function compilerGenerationDigest(identity: CompilationCacheIdentity): `sha256:${string}` {
  return sha256(identity.compiler) as `sha256:${string}`;
}

function buildPredecessorToken(identity: CompilationCacheIdentity): PredecessorToken {
  const unsigned = Object.freeze({
    schemaDigest: PREDECESSOR_TOKEN_SCHEMA_DIGEST,
    keyDigest: identity.generationDigest,
    generationReceiptDigest: identity.generationReceiptDigest,
    projectInputDigest: identity.projectInputDigest,
    projectConfigDigest: identity.projectConfigDigest,
    workspaceSnapshotIdentityDigest: identity.workspaceSnapshotIdentityDigest,
    orderedSourceFactsDigest: identity.orderedSourceFactsDigest,
    snapshotDigest: identity.snapshotDigest,
    moduleMembershipDigest: identity.moduleMembershipDigest,
    moduleGraphDigest: identity.moduleGraphDigest,
    compilerGenerationDigest: compilerGenerationDigest(identity)
  });
  return Object.freeze({ ...unsigned, tokenDigest: sha256(unsigned) as `sha256:${string}` });
}

function encodePredecessorToken(token: PredecessorToken): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalJson(token)));
}

function parsePredecessorToken(bytes: Uint8Array, current: CompilationCacheIdentity): PredecessorToken {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = parseExactJson(source, 'Repository compilation predecessor token', {
    rootObjectKeys: PREDECESSOR_TOKEN_KEYS
  });
  exactObject(value, PREDECESSOR_TOKEN_KEYS, 'Repository compilation predecessor token');
  for (const key of PREDECESSOR_TOKEN_KEYS) exactDigest(value[key], `Repository compilation predecessor ${key}`);
  const parsed = Object.freeze({
    schemaDigest: value.schemaDigest as `sha256:${string}`,
    keyDigest: value.keyDigest as `sha256:${string}`,
    generationReceiptDigest: value.generationReceiptDigest as `sha256:${string}`,
    projectInputDigest: value.projectInputDigest as `sha256:${string}`,
    projectConfigDigest: value.projectConfigDigest as `sha256:${string}`,
    workspaceSnapshotIdentityDigest: value.workspaceSnapshotIdentityDigest as `sha256:${string}`,
    orderedSourceFactsDigest: value.orderedSourceFactsDigest as `sha256:${string}`,
    snapshotDigest: value.snapshotDigest as `sha256:${string}`,
    moduleMembershipDigest: value.moduleMembershipDigest as `sha256:${string}`,
    moduleGraphDigest: value.moduleGraphDigest as `sha256:${string}`,
    compilerGenerationDigest: value.compilerGenerationDigest as `sha256:${string}`,
    tokenDigest: value.tokenDigest as `sha256:${string}`
  }) satisfies PredecessorToken;
  const { tokenDigest, ...unsigned } = parsed;
  if (parsed.schemaDigest !== PREDECESSOR_TOKEN_SCHEMA_DIGEST
      || parsed.compilerGenerationDigest !== compilerGenerationDigest(current)
      || tokenDigest !== sha256(unsigned)
      || source !== JSON.stringify(canonicalJson(parsed))) {
    throw new Error('Repository compilation predecessor token is stale, foreign, or noncanonical');
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
    throw new RepositoryCompilationCacheProviderError('corrupt-cache', 'Fact shards are not uniquely addressable');
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

function unsignedManifest(identity: CompilationCacheIdentity, pack: FactPack): Omit<Manifest, 'manifestDigest'> {
  return Object.freeze({
    schemaDigest: repositoryCompilationCacheSchemaDigest(),
    keyDigest: identity.generationDigest,
    generationReceiptDigest: identity.generationReceiptDigest,
    projectInputDigest: identity.projectInputDigest,
    projectConfigDigest: identity.projectConfigDigest,
    workspaceSnapshotIdentityDigest: identity.workspaceSnapshotIdentityDigest,
    orderedSourceFactsDigest: identity.orderedSourceFactsDigest,
    snapshotDigest: identity.snapshotDigest,
    moduleMembershipDigest: identity.moduleMembershipDigest,
    moduleGraphDigest: identity.moduleGraphDigest,
    compilerRevision: identity.compiler.compilerRevision,
    providerRevision: identity.compiler.providerRevision,
    compilerConfigDigest: identity.compiler.compilerConfigDigest,
    dependencyGenerationDigest: identity.compiler.dependencyGenerationDigest,
    environmentDigest: identity.compiler.environmentDigest,
    packFileName: pack.fileName,
    packDigest: pack.digest,
    packByteLength: pack.bytes.byteLength,
    shards: pack.shards
  });
}

function buildManifest(identity: CompilationCacheIdentity, pack: FactPack): Manifest {
  const unsigned = unsignedManifest(identity, pack);
  return Object.freeze({ ...unsigned, manifestDigest: sha256(unsigned) as `sha256:${string}` });
}

function parseManifest(bytes: Uint8Array, identity: CompilationCacheIdentity): Manifest {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = parseExactJson(source, 'Repository compilation cache manifest', { rootObjectKeys: MANIFEST_KEYS });
  exactObject(value, MANIFEST_KEYS, 'Repository compilation cache manifest');
  for (const key of [
    'schemaDigest', 'keyDigest', 'generationReceiptDigest', 'projectInputDigest', 'projectConfigDigest',
    'workspaceSnapshotIdentityDigest', 'orderedSourceFactsDigest', 'snapshotDigest',
    'moduleMembershipDigest', 'moduleGraphDigest', 'compilerRevision', 'providerRevision',
    'compilerConfigDigest', 'dependencyGenerationDigest', 'environmentDigest', 'packDigest', 'manifestDigest'
  ]) exactDigest(value[key], `Repository compilation manifest ${key}`);
  if (typeof value.packFileName !== 'string' || !Array.isArray(value.shards)) {
    throw new Error('Repository compilation cache manifest shape is invalid');
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
    generationReceiptDigest: value.generationReceiptDigest as `sha256:${string}`,
    projectInputDigest: value.projectInputDigest as `sha256:${string}`,
    projectConfigDigest: value.projectConfigDigest as `sha256:${string}`,
    workspaceSnapshotIdentityDigest: value.workspaceSnapshotIdentityDigest as `sha256:${string}`,
    orderedSourceFactsDigest: value.orderedSourceFactsDigest as `sha256:${string}`,
    snapshotDigest: value.snapshotDigest as `sha256:${string}`,
    moduleMembershipDigest: value.moduleMembershipDigest as `sha256:${string}`,
    moduleGraphDigest: value.moduleGraphDigest as `sha256:${string}`,
    compilerRevision: value.compilerRevision as `sha256:${string}`,
    providerRevision: value.providerRevision as `sha256:${string}`,
    compilerConfigDigest: value.compilerConfigDigest as `sha256:${string}`,
    dependencyGenerationDigest: value.dependencyGenerationDigest as `sha256:${string}`,
    environmentDigest: value.environmentDigest as `sha256:${string}`,
    packFileName: value.packFileName,
    packDigest: value.packDigest as `sha256:${string}`,
    packByteLength: value.packByteLength as number,
    shards: Object.freeze(shards),
    manifestDigest: value.manifestDigest as `sha256:${string}`
  }) satisfies Manifest;
  const { manifestDigest, ...unsigned } = parsed;
  if (parsed.schemaDigest !== repositoryCompilationCacheSchemaDigest()
      || parsed.keyDigest !== identity.generationDigest
      || parsed.generationReceiptDigest !== identity.generationReceiptDigest
      || parsed.projectInputDigest !== identity.projectInputDigest
      || parsed.projectConfigDigest !== identity.projectConfigDigest
      || parsed.workspaceSnapshotIdentityDigest !== identity.workspaceSnapshotIdentityDigest
      || parsed.orderedSourceFactsDigest !== identity.orderedSourceFactsDigest
      || parsed.snapshotDigest !== identity.snapshotDigest
      || parsed.moduleMembershipDigest !== identity.moduleMembershipDigest
      || parsed.moduleGraphDigest !== identity.moduleGraphDigest
      || parsed.compilerRevision !== identity.compiler.compilerRevision
      || parsed.providerRevision !== identity.compiler.providerRevision
      || parsed.compilerConfigDigest !== identity.compiler.compilerConfigDigest
      || parsed.dependencyGenerationDigest !== identity.compiler.dependencyGenerationDigest
      || parsed.environmentDigest !== identity.compiler.environmentDigest
      || manifestDigest !== sha256(unsigned)
      || source !== JSON.stringify(canonicalJson(parsed))) {
    throw new Error('Repository compilation cache manifest is foreign or noncanonical');
  }
  return parsed;
}

function generationFromManifest(manifest: Manifest): RepositoryCompilationGenerationReceipt {
  const generation = Object.freeze({
    generationDigest: manifest.keyDigest,
    projectInputDigest: manifest.projectInputDigest,
    projectConfigDigest: manifest.projectConfigDigest,
    workspaceSnapshotIdentityDigest: manifest.workspaceSnapshotIdentityDigest,
    orderedSourceFactsDigest: manifest.orderedSourceFactsDigest,
    snapshotDigest: manifest.snapshotDigest,
    moduleMembershipDigest: manifest.moduleMembershipDigest,
    moduleGraphDigest: manifest.moduleGraphDigest,
    compilerRevision: manifest.compilerRevision,
    providerRevision: manifest.providerRevision,
    compilerConfigDigest: manifest.compilerConfigDigest,
    dependencyGenerationDigest: manifest.dependencyGenerationDigest,
    environmentDigest: manifest.environmentDigest,
    receiptDigest: manifest.generationReceiptDigest
  });
  assertRepositoryCompilationGenerationReceipt(generation);
  return generation;
}

function parsePhysicalLoad(
  load: ContentAddressedWorkspaceCacheLoad | ContentAddressedWorkspaceCachePredecessorLoad,
  identity: CompilationCacheIdentity
): RepositoryCompilationCacheLoad {
  if (load.status === 'miss') return Object.freeze({ status: 'miss', keyDigest: identity.generationDigest });
  const started = performance.now();
  if (load.entries.length !== 2) throw new Error('Repository compilation cache generation has noncanonical entry count');
  const manifestEntry = load.entries.find(({ name }) => name === MANIFEST_NAME);
  if (manifestEntry === undefined) throw new Error('Repository compilation cache manifest is absent');
  const manifest = parseManifest(manifestEntry.bytes, identity);
  const packEntry = load.entries.find(({ name }) => name === manifest.packFileName);
  if (packEntry === undefined || packEntry.digest !== manifest.packDigest
      || packEntry.bytes.byteLength !== manifest.packByteLength) {
    throw new Error('Repository compilation fact pack is absent or foreign');
  }
  const shards = manifest.shards.map((entry) => {
    const bytes = packEntry.bytes.slice(entry.offset, entry.offset + entry.length);
    const shard = parseTypeScriptSourceProgramFactShard(bytes);
    if (shard.path !== entry.path || shard.shardDigest !== entry.shardDigest
        || shard.rawFileDigest !== entry.rawFileDigest || shard.moduleDigest !== entry.moduleDigest) {
      throw new Error(`Repository compilation fact shard is foreign: ${entry.path}`);
    }
    return shard;
  });
  const generation = generationFromManifest(manifest);
  const cacheReceiptUnsigned = Object.freeze({
    generationDigest: generation.generationDigest,
    packDigest: manifest.packDigest,
    manifestDigest: manifest.manifestDigest
  });
  return Object.freeze({
    status: 'hit',
    keyDigest: load.keyDigest,
    generation,
    cacheReceipt: Object.freeze({
      ...cacheReceiptUnsigned,
      cacheReceiptDigest: sha256(cacheReceiptUnsigned) as `sha256:${string}`
    }),
    shards: Object.freeze(shards),
    diagnostics: Object.freeze({
      physicalBytes: load.entries.reduce((total, entry) => total + entry.bytes.byteLength, 0),
      semanticParseMs: performance.now() - started
    })
  });
}

function atProviderBoundary<Value>(label: string, operation: () => Value): Value {
  try {
    return operation();
  } catch (error) {
    if (error instanceof RepositoryCompilationCacheProviderError) throw error;
    const kind: RepositoryCompilationCacheProviderFailureKind = error instanceof ContentAddressedWorkspaceCacheError
      ? error.kind
      : 'corrupt-cache';
    throw new RepositoryCompilationCacheProviderError(kind, `${label} failed`, error);
  }
}

/** Brownfield adapts semantic generation receipts and TypeScript fact shards to Runtime State bytes. */
export function createRepositoryCompilationCacheProvider(input: Readonly<{
  session: ContentAddressedWorkspaceCacheSession;
}>): RepositoryCompilationCacheProvider {
  const namespace = input.session.openNamespace({
    namespace: CACHE_NAMESPACE,
    schemaDigest: repositoryCompilationCacheSchemaDigest(),
    maximumEntries: CACHE_MAXIMUM_ENTRIES
  });
  return Object.freeze({
    openContentAddressedHint(generation: RepositoryCompilationGenerationReceipt): RepositoryCompilationCacheHint {
      const identity = cacheIdentity(generation);
      const physical = namespace.open(identity.generationDigest);
      return Object.freeze({
        keyDigest: identity.generationDigest,
        loadExact: () => atProviderBoundary(
          'Repository compilation cache read',
          () => parsePhysicalLoad(physical.loadExact(), identity)
        ),
        loadPredecessor: () => {
          try {
            const loaded = physical.loadPredecessor();
            if (loaded.status === 'miss') return Object.freeze({ status: 'miss' as const, keyDigest: identity.generationDigest });
            const token = parsePredecessorToken(loaded.predecessorToken, identity);
            if (token.keyDigest !== loaded.keyDigest || token.keyDigest === identity.generationDigest) {
              return Object.freeze({ status: 'miss' as const, keyDigest: identity.generationDigest });
            }
            const predecessorIdentity = Object.freeze({
              generationDigest: token.keyDigest,
              generationReceiptDigest: token.generationReceiptDigest,
              projectInputDigest: token.projectInputDigest,
              projectConfigDigest: token.projectConfigDigest,
              workspaceSnapshotIdentityDigest: token.workspaceSnapshotIdentityDigest,
              orderedSourceFactsDigest: token.orderedSourceFactsDigest,
              snapshotDigest: token.snapshotDigest,
              moduleMembershipDigest: token.moduleMembershipDigest,
              moduleGraphDigest: token.moduleGraphDigest,
              compiler: identity.compiler
            }) satisfies CompilationCacheIdentity;
            return parsePhysicalLoad(loaded, predecessorIdentity);
          } catch {
            return Object.freeze({ status: 'miss' as const, keyDigest: identity.generationDigest });
          }
        },
        publish: (shards: readonly TypeScriptSourceProgramFactShard[]) => atProviderBoundary(
            'Repository compilation cache publication',
            () => {
            const pack = buildPack(shards);
            const manifest = buildManifest(identity, pack);
            const manifestBytes = new TextEncoder().encode(JSON.stringify(canonicalJson(manifest)));
            const entries: readonly ContentAddressedWorkspaceCacheEntry[] = Object.freeze([
              Object.freeze({ name: MANIFEST_NAME, bytes: manifestBytes, digest: rawSha256(manifestBytes) }),
              Object.freeze({ name: pack.fileName, bytes: pack.bytes, digest: pack.digest })
            ]);
            return parsePhysicalLoad(physical.publish({
              entries,
              predecessorToken: encodePredecessorToken(buildPredecessorToken(identity))
            }), identity);
            }
          )
      });
    }
  });
}
