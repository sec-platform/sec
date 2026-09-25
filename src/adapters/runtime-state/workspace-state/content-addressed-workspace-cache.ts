import path from 'node:path';

import { canonicalJson, compareCodeUnits, isPlainObject, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { isDigest } from '../../../contracts/digest.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import { FailureError } from '../../../contracts/failure.ts';
import {
  assertSemanticOperationProjection,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import {
  PhysicalNoFollowError,
  assertSameNoFollowDirectoryIdentity,
  publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile,
  scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryIdentity
} from '../physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryLeaf } from '../physical/runtime/retained-file-read.ts';
import { currentRuntimePlatform, resolveRuntimeCacheRoot, runtimeStateEnvironment } from './layout.ts';
import { acquireRuntimeCachePhysicalAuthority, type RuntimeCachePhysicalAuthority } from './physical-authority.ts';

const CACHE_SESSION_MAX_DURATION_MS = 300_000;
const CACHE_SESSION_MAX_BYTES = 1024 * 1024 * 1024;
const CACHE_SESSION_MAX_RECORDS = 500_000;
const POINTER_NAME = 'predecessor.json';
const POINTER_SCHEMA_DIGEST = sha256(Object.freeze({
  identity: 'content-addressed-workspace-cache-predecessor-hint',
  authority: 'none-advisory-validated-before-use',
  cardinality: 'at-most-one',
  target: 'one-immutable-generation'
})) as `sha256:${string}`;
const POINTER_KEYS = Object.freeze([
  'keyDigest', 'namespaceDigest', 'pointerDigest', 'schemaDigest',
  'tokenBase64', 'tokenDigest'
]);

export type ContentAddressedWorkspaceCacheFailureKind =
  | 'corrupt-cache'
  | 'foreign-residue'
  | 'physical-replacement';

export class ContentAddressedWorkspaceCacheError extends FailureError {
  readonly kind: ContentAddressedWorkspaceCacheFailureKind;

  constructor(kind: ContentAddressedWorkspaceCacheFailureKind, message: string, cause?: unknown) {
    super('RUNTIME-CACHE-001', message, { kind }, cause === undefined ? undefined : { cause });
    this.name = 'ContentAddressedWorkspaceCacheError';
    this.kind = kind;
  }
}

export type ContentAddressedWorkspaceCacheEntry = Readonly<{
  name: string;
  bytes: Uint8Array;
  digest: `sha256:${string}`;
}>;

export type ContentAddressedWorkspaceCacheLoad = Readonly<{
  status: 'hit';
  keyDigest: `sha256:${string}`;
  entries: readonly ContentAddressedWorkspaceCacheEntry[];
}> | Readonly<{
  status: 'miss';
  keyDigest: `sha256:${string}`;
}>;

export type ContentAddressedWorkspaceCachePredecessorLoad = Readonly<{
  status: 'hit';
  keyDigest: `sha256:${string}`;
  predecessorToken: Uint8Array;
  entries: readonly ContentAddressedWorkspaceCacheEntry[];
}> | Readonly<{
  status: 'miss';
  keyDigest: `sha256:${string}`;
}>;

interface ContentAddressedWorkspaceCacheHint {
  readonly keyDigest: `sha256:${string}`;
  loadExact(): ContentAddressedWorkspaceCacheLoad;
  loadPredecessor(): ContentAddressedWorkspaceCachePredecessorLoad;
  publish(input: ContentAddressedWorkspaceCachePublication): ContentAddressedWorkspaceCacheLoad;
}

type ContentAddressedWorkspaceCachePublication = Readonly<{
  entries: readonly ContentAddressedWorkspaceCacheEntry[];
  predecessorToken: Uint8Array;
}>;

interface ContentAddressedWorkspaceCacheNamespace {
  open(keyDigest: `sha256:${string}`): ContentAddressedWorkspaceCacheHint;
}

type ContentAddressedWorkspaceCacheSessionReceipt = Readonly<{
  operationIdentityDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  deadlineAtUnixMs: number;
  records: number;
  readBytes: number;
  writeBytes: number;
  writes: number;
  failedOperations: number;
  receiptDigest: OperationDigest;
}>;

export interface ContentAddressedWorkspaceCacheSession {
  readonly operationIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly deadlineAtMonotonicMs: number;
  readonly signal: AbortSignal;
  openNamespace(input: Readonly<{
    namespace: string;
    schemaDigest: `sha256:${string}`;
    maximumEntries: number;
  }>): ContentAddressedWorkspaceCacheNamespace;
  close(): ContentAddressedWorkspaceCacheSessionReceipt;
}

type CacheOperationControl = Readonly<{
  deadlineAtMonotonicMs: number;
  signal: AbortSignal;
  remainingRecords(): number;
  remainingReadBytes(): number;
  remainingWriteBytes(): number;
  assertLive(): void;
  consumeRead(bytes: number, records: number): void;
  consumeWrite(bytes: number, records: number): void;
  recordFailure(): void;
}>;

type CachePointer = Readonly<{
  schemaDigest: `sha256:${string}`;
  namespaceDigest: `sha256:${string}`;
  keyDigest: `sha256:${string}`;
  tokenDigest: `sha256:${string}`;
  tokenBase64: string;
  pointerDigest: `sha256:${string}`;
}>;

function exactDigest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (!isDigest(value, 'sha256')) throw new Error(`${label} is invalid`);
}

function exactLeafName(value: string, label: string): string {
  if (value.length === 0 || value === '.' || value === '..' || path.basename(value) !== value
      || value.includes('/') || value.includes('\\')) {
    throw new Error(`${label} is not one ordinary leaf name`);
  }
  return value;
}

function exactNamespace(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new Error('Content-addressed cache namespace is invalid');
  }
  return value;
}

function cachePointer(
  namespaceDigest: `sha256:${string}`,
  keyDigest: `sha256:${string}`,
  token: Uint8Array
): CachePointer {
  const unsigned = Object.freeze({
    schemaDigest: POINTER_SCHEMA_DIGEST,
    namespaceDigest,
    keyDigest,
    tokenDigest: rawSha256(token),
    tokenBase64: Buffer.from(token).toString('base64')
  });
  return Object.freeze({
    ...unsigned,
    pointerDigest: sha256(unsigned) as `sha256:${string}`
  });
}

function encodePointer(pointer: CachePointer): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(canonicalJson(pointer)));
}

function parsePointer(
  bytes: Uint8Array,
  namespaceDigest: `sha256:${string}`
): Readonly<{ keyDigest: `sha256:${string}`; token: Uint8Array }> {
  const source = decodeExactUtf8(bytes, 'Content-addressed cache predecessor hint');
  const value = parseExactJson(source, 'Content-addressed cache predecessor hint', {
    rootObjectKeys: POINTER_KEYS
  });
  if (!isPlainObject(value)) throw new Error('Content-addressed cache predecessor hint must be one object');
  const keys = Object.keys(value).sort(compareCodeUnits);
  const expected = [...POINTER_KEYS].sort(compareCodeUnits);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('Content-addressed cache predecessor hint has noncanonical keys');
  }
  exactDigest(value.schemaDigest, 'Content-addressed cache pointer schema');
  exactDigest(value.namespaceDigest, 'Content-addressed cache pointer namespace');
  exactDigest(value.keyDigest, 'Content-addressed cache pointer key');
  exactDigest(value.tokenDigest, 'Content-addressed cache pointer token');
  exactDigest(value.pointerDigest, 'Content-addressed cache pointer digest');
  if (typeof value.tokenBase64 !== 'string') throw new Error('Content-addressed cache pointer token is invalid');
  const token = new Uint8Array(Buffer.from(value.tokenBase64, 'base64'));
  const parsed = Object.freeze({
    schemaDigest: value.schemaDigest,
    namespaceDigest: value.namespaceDigest,
    keyDigest: value.keyDigest,
    tokenDigest: value.tokenDigest,
    tokenBase64: value.tokenBase64,
    pointerDigest: value.pointerDigest
  }) satisfies CachePointer;
  const { pointerDigest, ...unsigned } = parsed;
  if (parsed.schemaDigest !== POINTER_SCHEMA_DIGEST
      || parsed.namespaceDigest !== namespaceDigest
      || parsed.tokenDigest !== rawSha256(token)
      || pointerDigest !== sha256(unsigned)
      || source !== JSON.stringify(canonicalJson(parsed))) {
    throw new Error('Content-addressed cache predecessor hint is stale, foreign, or noncanonical');
  }
  return Object.freeze({ keyDigest: parsed.keyDigest, token });
}

function atCacheBoundary<Value>(label: string, operation: () => Value): Value {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ContentAddressedWorkspaceCacheError) throw error;
    const kind: ContentAddressedWorkspaceCacheFailureKind = error instanceof PhysicalNoFollowError
      ? 'physical-replacement'
      : 'corrupt-cache';
    throw new ContentAddressedWorkspaceCacheError(kind, `${label} failed`, error);
  }
}

function loadGeneration(input: Readonly<{
  authority: RuntimeCachePhysicalAuthority;
  directory: PhysicalDirectoryIdentity;
  keyDigest: `sha256:${string}`;
  maximumEntries: number;
  operation: CacheOperationControl;
}>): ContentAddressedWorkspaceCacheLoad {
  input.operation.assertLive();
  input.authority.assertCurrent();
  const inventory = scanNoFollowDirectoryTreeMetadata(input.directory, {
    deadlineAtMs: input.operation.deadlineAtMonotonicMs,
    maximumEntries: Math.min(input.maximumEntries, input.operation.remainingRecords()),
    signal: input.operation.signal
  });
  if (inventory.length === 0) return Object.freeze({ status: 'miss', keyDigest: input.keyDigest });
  let totalBytes = 0;
  const entries: ContentAddressedWorkspaceCacheEntry[] = [];
  for (const item of inventory) {
    if (item.relativePath.length === 0 || item.kind !== 'file') {
      throw new ContentAddressedWorkspaceCacheError(
        'foreign-residue',
        `Content-addressed cache generation has foreign residue: ${item.relativePath}`
      );
    }
    exactLeafName(item.relativePath, 'Content-addressed cache entry');
    totalBytes += item.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > input.operation.remainingReadBytes()) {
      throw new ContentAddressedWorkspaceCacheError('corrupt-cache', 'Content-addressed cache byte budget was exceeded');
    }
    const bytes = readOptionalRetainedOrdinaryLeaf(input.directory, item.relativePath, {
      maximumBytes: item.size
    });
    if (bytes === null) throw new Error(`Content-addressed cache entry disappeared: ${item.relativePath}`);
    entries.push(Object.freeze({
      name: item.relativePath,
      bytes,
      digest: rawSha256(bytes)
    }));
  }
  input.operation.consumeRead(totalBytes, inventory.length);
  input.operation.assertLive();
  input.authority.assertCurrent();
  entries.sort((left, right) => compareCodeUnits(left.name, right.name));
  return Object.freeze({
    status: 'hit',
    keyDigest: input.keyDigest,
    entries: Object.freeze(entries)
  });
}

/**
 * Runtime State owns only physical, content-addressed cache bytes. Domain
 * owners choose the namespace, key, entry grammar and predecessor token, then
 * revalidate those bytes before using them as an acceleration hint.
 */
function createContentAddressedWorkspaceCacheNamespace(input: Readonly<{
  repositoryRoot: string;
  namespace: string;
  schemaDigest: `sha256:${string}`;
  maximumEntries: number;
  operation: CacheOperationControl;
}>): ContentAddressedWorkspaceCacheNamespace {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const namespace = exactNamespace(input.namespace);
  exactDigest(input.schemaDigest, 'Content-addressed cache schema digest');
  if (!Number.isSafeInteger(input.maximumEntries) || input.maximumEntries < 1) {
    throw new Error('Content-addressed cache entry limit must be one positive safe integer');
  }
  const namespaceDigest = sha256(Object.freeze({ namespace, schemaDigest: input.schemaDigest })) as `sha256:${string}`;
  const cacheRoot = resolveRuntimeCacheRoot({
    platform: currentRuntimePlatform(),
    environment: runtimeStateEnvironment(),
    repositoryRoot
  });
  const namespaceRoot = path.join(
    cacheRoot,
    'content-addressed-workspace-cache',
    namespaceDigest.slice('sha256:'.length),
    input.schemaDigest.slice('sha256:'.length)
  );

  return Object.freeze({
    open(keyDigest: `sha256:${string}`): ContentAddressedWorkspaceCacheHint {
      input.operation.assertLive();
      exactDigest(keyDigest, 'Content-addressed cache key');
      const generationRoot = path.join(namespaceRoot, keyDigest.slice('sha256:'.length));
      input.operation.consumeWrite(0, 1);
      const authority = acquireRuntimeCachePhysicalAuthority({
        repositoryRoot,
        cacheRoot,
        requiredDirectories: [namespaceRoot, generationRoot]
      });
      const directory = authority.directory(generationRoot);
      const namespaceDirectory = authority.directory(namespaceRoot);
      const loadExact = (): ContentAddressedWorkspaceCacheLoad => loadGeneration({
        authority,
        directory,
        keyDigest,
        maximumEntries: input.maximumEntries,
        operation: input.operation
      });
      return Object.freeze({
        keyDigest,
        loadExact: () => atCacheBoundary('Content-addressed cache read', loadExact),
        loadPredecessor: () => {
          try {
            input.operation.assertLive();
            authority.assertCurrent();
            const pointerBytes = readOptionalRetainedOrdinaryLeaf(namespaceDirectory, POINTER_NAME, {
              maximumBytes: input.operation.remainingReadBytes()
            });
            if (pointerBytes === null) return Object.freeze({ status: 'miss' as const, keyDigest });
            input.operation.consumeRead(pointerBytes.byteLength, 1);
            const pointer = parsePointer(pointerBytes, namespaceDigest);
            if (pointer.keyDigest === keyDigest) return Object.freeze({ status: 'miss' as const, keyDigest });
            const predecessorRoot = path.join(namespaceRoot, pointer.keyDigest.slice('sha256:'.length));
            const predecessorAuthority = acquireRuntimeCachePhysicalAuthority({
              repositoryRoot,
              cacheRoot,
              requiredDirectories: [namespaceRoot, predecessorRoot]
            });
            const loaded = loadGeneration({
              authority: predecessorAuthority,
              directory: predecessorAuthority.directory(predecessorRoot),
              keyDigest: pointer.keyDigest,
              maximumEntries: input.maximumEntries,
              operation: input.operation
            });
            if (loaded.status === 'miss') return Object.freeze({ status: 'miss' as const, keyDigest });
            authority.assertCurrent();
            const readback = readOptionalRetainedOrdinaryLeaf(namespaceDirectory, POINTER_NAME, {
              maximumBytes: pointerBytes.byteLength
            });
            if (readback === null || rawSha256(readback) !== rawSha256(pointerBytes)) {
              return Object.freeze({ status: 'miss' as const, keyDigest });
            }
            input.operation.consumeRead(readback.byteLength, 1);
            return Object.freeze({
              status: 'hit' as const,
              keyDigest: loaded.keyDigest,
              predecessorToken: pointer.token,
              entries: loaded.entries
            });
          } catch {
            input.operation.assertLive();
            input.operation.recordFailure();
            return Object.freeze({ status: 'miss' as const, keyDigest });
          }
        },
        publish: (publication: ContentAddressedWorkspaceCachePublication) => atCacheBoundary('Content-addressed cache publication', () => {
          input.operation.assertLive();
          authority.assertCurrent();
          if (publication.entries.length < 1 || publication.entries.length > input.maximumEntries) {
            throw new ContentAddressedWorkspaceCacheError('corrupt-cache', 'Content-addressed cache entry count is invalid');
          }
          let totalBytes = 0;
          const names = new Set<string>();
          for (const entry of publication.entries) {
            exactLeafName(entry.name, 'Content-addressed cache publication entry');
            exactDigest(entry.digest, 'Content-addressed cache publication digest');
            if (names.has(entry.name) || entry.digest !== rawSha256(entry.bytes)) {
              throw new ContentAddressedWorkspaceCacheError('corrupt-cache', 'Content-addressed cache publication is not canonical');
            }
            names.add(entry.name);
            totalBytes += entry.bytes.byteLength;
          }
          if (totalBytes > input.operation.remainingWriteBytes()) {
            throw new ContentAddressedWorkspaceCacheError('corrupt-cache', 'Content-addressed cache publication exceeds its byte budget');
          }
          input.operation.consumeWrite(totalBytes, publication.entries.length);
          input.operation.assertLive();
          const existing = scanNoFollowDirectoryTreeMetadata(directory, {
            deadlineAtMs: input.operation.deadlineAtMonotonicMs,
            maximumEntries: Math.min(input.maximumEntries, input.operation.remainingRecords()),
            signal: input.operation.signal
          });
          const foreign = existing.find(({ relativePath, kind }) => (
            relativePath.length === 0 || kind !== 'file' || !names.has(relativePath)
          ));
          if (foreign !== undefined) {
            throw new ContentAddressedWorkspaceCacheError(
              'foreign-residue',
              `Content-addressed cache generation has foreign residue: ${foreign.relativePath}`
            );
          }
          for (const entry of [...publication.entries].sort((left, right) => compareCodeUnits(left.name, right.name))) {
            publishExclusiveDurableCanonicalFile({
              parent: directory,
              name: entry.name,
              bytes: entry.bytes,
              validate: (candidate) => {
                if (candidate.byteLength !== entry.bytes.byteLength || rawSha256(candidate) !== entry.digest) {
                  throw new Error('Content-addressed cache publication bytes are not canonical');
                }
              }
            });
            authority.assertCurrent();
          }
          const loaded = loadExact();
          try {
            const pointer = cachePointer(namespaceDigest, keyDigest, publication.predecessorToken);
            const pointerBytes = encodePointer(pointer);
            input.operation.consumeWrite(pointerBytes.byteLength, 1);
            input.operation.assertLive();
            replaceDurableCanonicalFile({
              parent: namespaceDirectory,
              name: POINTER_NAME,
              bytes: pointerBytes,
              validate: (candidate) => { parsePointer(candidate, namespaceDigest); }
            });
          } catch {
            input.operation.assertLive();
            input.operation.recordFailure();
            // The predecessor locator is disposable acceleration only.
          }
          return loaded;
        })
      });
    }
  });
}

function operationBudget(
  operation: BoundSemanticOperation,
  resource: 'duration-ms' | 'input-bytes' | 'output-bytes' | 'records',
  ceiling: number
): number {
  const value = operation.plan.execution.aggregateBudgets
    .find((candidate) => candidate.resource === resource)?.maximum;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > ceiling) {
    throw new Error(`Content-addressed cache session requires one canonical ${resource} budget`);
  }
  return value as number;
}

/**
 * Opens one opaque, owner-bound filesystem Effect session. The retained
 * repository identity is the sole root authority; namespace consumers never
 * pass paths or create independent deadlines and ledgers.
 */
export function openContentAddressedWorkspaceCacheSession(input: Readonly<{
  operation: BoundSemanticOperation;
  requirementId: string;
  repository: PhysicalDirectoryIdentity;
  signal?: AbortSignal;
}>): ContentAddressedWorkspaceCacheSession {
  assertSemanticOperationProjection(input.operation);
  const requirement = input.operation.plan.execution.requirements
    .find(({ id }) => id === input.requirementId);
  if (requirement === undefined || !requirement.effectKinds.includes('filesystem')) {
    throw new Error('Content-addressed cache session requires one bound filesystem Effect');
  }
  const binding = input.operation.bindings.find(({ requirementId, contractDigest }) => (
    requirementId === requirement.id && contractDigest === requirement.contractDigest
  ));
  if (binding === undefined) throw new Error('Content-addressed cache filesystem Effect is unbound');
  const repository = assertSameNoFollowDirectoryIdentity(
    input.repository,
    'content-addressed cache retained repository root'
  ).target;
  const maximumDurationMs = operationBudget(
    input.operation, 'duration-ms', CACHE_SESSION_MAX_DURATION_MS
  );
  const maximumReadBytes = operationBudget(
    input.operation, 'output-bytes', CACHE_SESSION_MAX_BYTES
  );
  const maximumWriteBytes = operationBudget(
    input.operation, 'input-bytes', CACHE_SESSION_MAX_BYTES
  );
  const maximumRecords = operationBudget(
    input.operation, 'records', CACHE_SESSION_MAX_RECORDS
  );
  const startedAtUnixMs = Date.now();
  const startedAtMonotonicMs = performance.now();
  const admittedDurationMs = Math.min(
    maximumDurationMs,
    input.operation.plan.attempt.deadlineAtUnixMs - startedAtUnixMs,
    2_147_483_647
  );
  if (input.signal?.aborted === true || !Number.isSafeInteger(admittedDurationMs) || admittedDurationMs < 1) {
    throw new Error('Content-addressed cache session admission is cancelled or expired');
  }
  const deadlineAtUnixMs = startedAtUnixMs + admittedDurationMs;
  const deadlineAtMonotonicMs = startedAtMonotonicMs + admittedDurationMs;
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Content-addressed cache deadline expired')), admittedDurationMs);
  timer.unref();
  let records = 0;
  let readBytes = 0;
  let writeBytes = 0;
  let writes = 0;
  let failedOperations = 0;
  let receipt: ContentAddressedWorkspaceCacheSessionReceipt | null = null;
  const assertLive = (): void => {
    if (receipt !== null) throw new Error('Content-addressed cache session is closed');
    if (controller.signal.aborted || Date.now() >= deadlineAtUnixMs || performance.now() >= deadlineAtMonotonicMs) {
      throw new Error('Content-addressed cache session is cancelled or expired');
    }
    assertSameNoFollowDirectoryIdentity(repository, 'content-addressed cache repository readback');
  };
  const requireCounter = (value: number, label: string): void => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
  };
  const control: CacheOperationControl = Object.freeze({
    deadlineAtMonotonicMs,
    signal: controller.signal,
    remainingRecords: () => Math.max(0, maximumRecords - records),
    remainingReadBytes: () => Math.max(0, maximumReadBytes - readBytes),
    remainingWriteBytes: () => Math.max(0, maximumWriteBytes - writeBytes),
    assertLive,
    consumeRead: (bytes: number, consumedRecords: number): void => {
      assertLive();
      requireCounter(bytes, 'Content-addressed cache read bytes');
      requireCounter(consumedRecords, 'Content-addressed cache read records');
      if (readBytes + bytes > maximumReadBytes || records + consumedRecords > maximumRecords) {
        throw new Error('Content-addressed cache read aggregate budget is exhausted');
      }
      readBytes += bytes;
      records += consumedRecords;
    },
    consumeWrite: (bytes: number, consumedRecords: number): void => {
      assertLive();
      requireCounter(bytes, 'Content-addressed cache write bytes');
      requireCounter(consumedRecords, 'Content-addressed cache write records');
      if (writeBytes + bytes > maximumWriteBytes || records + consumedRecords > maximumRecords) {
        throw new Error('Content-addressed cache write aggregate budget is exhausted');
      }
      writeBytes += bytes;
      records += consumedRecords;
      writes += consumedRecords;
    },
    recordFailure: (): void => { failedOperations += 1; }
  });
  const session: ContentAddressedWorkspaceCacheSession = Object.freeze({
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    deadlineAtUnixMs,
    deadlineAtMonotonicMs,
    signal: controller.signal,
    openNamespace: ({ namespace, schemaDigest, maximumEntries }: Readonly<{
      namespace: string;
      schemaDigest: `sha256:${string}`;
      maximumEntries: number;
    }>) => {
      assertLive();
      if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > maximumRecords) {
        throw new Error('Content-addressed cache namespace entry limit exceeds the session');
      }
      return createContentAddressedWorkspaceCacheNamespace({
        repositoryRoot: repository.path,
        namespace,
        schemaDigest,
        maximumEntries,
        operation: control
      });
    },
    close: (): ContentAddressedWorkspaceCacheSessionReceipt => {
      if (receipt !== null) return receipt;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abortFromCaller);
      try {
        assertSameNoFollowDirectoryIdentity(repository, 'content-addressed cache repository settlement');
      } catch {
        failedOperations += 1;
      }
      const unsigned = Object.freeze({
        operationIdentityDigest: input.operation.plan.identity.identityDigest,
        boundAttemptDigest: input.operation.boundAttemptDigest,
        deadlineAtUnixMs,
        records,
        readBytes,
        writeBytes,
        writes,
        failedOperations
      });
      receipt = Object.freeze({
        ...unsigned,
        receiptDigest: sha256(unsigned) as OperationDigest
      });
      controller.abort(new Error('Content-addressed cache session closed'));
      return receipt;
    }
  });
  return session;
}
