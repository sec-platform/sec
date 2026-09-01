import path from 'node:path';

import {
  createExclusiveNoFollowRandomDirectory,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileDigest,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  replaceDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeRetirementReceipt,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { rawSha256 } from '../../system-architecture/foundation/runtime/canonical.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BUILD_INFO_FILE_NAME = 'tsconfig.tsbuildinfo' as const;
const BUILD_INFO_MAXIMUM_BYTES = 64 * 1024 * 1024;

type StableSeedEnvelope = Readonly<{
  bindingDigest: `sha256:${string}`;
  payloadBase64: string;
  payloadDigest: `sha256:${string}`;
  schema: 'sec-typescript-incremental-seed-v1';
}>;

export type TypeScriptIncrementalPublication = Readonly<{
  status: 'published' | 'cache-unavailable';
}>;

export type TypeScriptIncrementalCleanupReceipt = Readonly<{
  tree: NoFollowDirectoryTreeRetirementReceipt;
}>;

export type TypeScriptIncrementalStateSession = Readonly<{
  auxiliaryDirectory: RetainedNoFollowChildProcessDirectory;
  buildInfoFileName: typeof BUILD_INFO_FILE_NAME;
  executionBuildInfoFile: string;
  publish: () => Promise<TypeScriptIncrementalPublication>;
  dispose: () => Promise<TypeScriptIncrementalCleanupReceipt>;
}>;

export type PrepareTypeScriptIncrementalStateInput = Readonly<{
  actionPrivateParent: PhysicalDirectoryIdentity;
  deadlineAtUnixMs: number;
  seedBindingDigest: `sha256:${string}`;
  signal?: AbortSignal;
  stableSeedFile: string;
  stableSeedParent: PhysicalDirectoryIdentity;
}>;

function canonicalSeedBytes(envelope: StableSeedEnvelope): Buffer {
  return Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
}

function parseStableSeed(
  bytes: Uint8Array,
  expectedBindingDigest: `sha256:${string}`
): Buffer | null {
  if (bytes.byteLength > Math.ceil(BUILD_INFO_MAXIMUM_BYTES * 4 / 3) + 1024) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'bindingDigest,payloadBase64,payloadDigest,schema'
      || value.schema !== 'sec-typescript-incremental-seed-v1'
      || value.bindingDigest !== expectedBindingDigest
      || typeof value.payloadBase64 !== 'string'
      || typeof value.payloadDigest !== 'string'
      || !DIGEST.test(value.payloadDigest)) {
    return null;
  }
  const payload = Buffer.from(value.payloadBase64, 'base64');
  if (payload.byteLength > BUILD_INFO_MAXIMUM_BYTES
      || payload.toString('base64') !== value.payloadBase64
      || rawSha256(payload) !== value.payloadDigest) {
    return null;
  }
  const envelope = Object.freeze({
    schema: 'sec-typescript-incremental-seed-v1' as const,
    bindingDigest: expectedBindingDigest,
    payloadDigest: value.payloadDigest as `sha256:${string}`,
    payloadBase64: value.payloadBase64
  });
  return Buffer.from(bytes).equals(canonicalSeedBytes(envelope)) ? payload : null;
}

function seedEnvelope(
  payload: Uint8Array,
  bindingDigest: `sha256:${string}`
): StableSeedEnvelope {
  return Object.freeze({
    schema: 'sec-typescript-incremental-seed-v1' as const,
    bindingDigest,
    payloadDigest: rawSha256(payload),
    payloadBase64: Buffer.from(payload).toString('base64')
  });
}

function retireActionPrivateTree(
  actionRoot: PhysicalDirectoryIdentity,
  actionPrivateParent: PhysicalDirectoryIdentity,
  deadlineAtMonotonicMs: number,
  assertActive: (label: string) => void
): NoFollowDirectoryTreeRetirementReceipt {
  assertActive('private tree retirement census');
  const inventory = scanNoFollowDirectoryTreeInventory(actionRoot, {
    deadlineAtMs: deadlineAtMonotonicMs,
    maximumEntries: 1,
    maximumBytes: BUILD_INFO_MAXIMUM_BYTES
  });
  assertActive('private tree retirement');
  return retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs,
    inventory,
    parent: actionPrivateParent,
    root: actionRoot
  });
}

/**
 * Materializes one fixed-layout, action-private auxiliary directory. The
 * stable cache is only a validated owner envelope; the child never receives
 * its shared parent. Invalid/contended cache state selects a cold execution
 * and cannot change the checker terminal, while private-tree residue remains
 * a typed cleanup failure for the Action owner.
 */
export async function prepareTypeScriptIncrementalState(
  input: PrepareTypeScriptIncrementalStateInput
): Promise<TypeScriptIncrementalStateSession> {
  if (!Number.isSafeInteger(input.deadlineAtUnixMs)) {
    throw new Error('TypeScript incremental state deadline must be an absolute safe integer.');
  }
  const startedAtUnixMs = Date.now();
  const deadlineAtMonotonicMs = performance.now() + Math.max(
    0,
    input.deadlineAtUnixMs - startedAtUnixMs
  );
  const assertActive = (label: string): void => {
    if (input.signal?.aborted === true) {
      throw new Error(`TypeScript incremental state ${label} was cancelled.`);
    }
    if (input.deadlineAtUnixMs - Date.now() < 1
        || deadlineAtMonotonicMs - performance.now() < 1) {
      throw new Error(`TypeScript incremental state ${label} exhausted its deadline.`);
    }
  };
  assertActive('admission');
  if (!DIGEST.test(input.seedBindingDigest)) {
    throw new Error('TypeScript incremental seed binding must be one canonical digest.');
  }
  const stableSeedFile = path.resolve(input.stableSeedFile);
  if (stableSeedFile !== input.stableSeedFile
      || path.dirname(stableSeedFile) !== input.stableSeedParent.path) {
    throw new Error('TypeScript incremental seed path must be a canonical child of its retained parent.');
  }
  const stableSeedName = path.basename(stableSeedFile);
  let expectedExisting: Readonly<{ device: string; inode: string }> | null | undefined;
  let seed: Buffer | null = null;
  try {
    assertActive('seed observation');
    const digest = inspectNoFollowOrdinaryFileDigest(input.stableSeedParent, stableSeedName);
    if (digest === null) {
      expectedExisting = null;
    } else if (digest.size > Math.ceil(BUILD_INFO_MAXIMUM_BYTES * 4 / 3) + 1024) {
      expectedExisting = undefined;
    } else {
      const observed = inspectNoFollowOrdinaryFileEntry(input.stableSeedParent, stableSeedName);
      expectedExisting = observed === null
        ? undefined
        : Object.freeze({ device: observed.device, inode: observed.inode });
      seed = observed?.bytes === null || observed?.bytes === undefined
        ? null
        : parseStableSeed(observed.bytes, input.seedBindingDigest);
    }
    assertActive('seed observation readback');
  } catch {
    // Cache observation is not semantic authority. An unsafe or unreadable
    // seed selects the cold path and disables publication for this attempt.
    expectedExisting = undefined;
  }

  assertActive('private tree creation');
  const actionRoot = createExclusiveNoFollowRandomDirectory(
    input.actionPrivateParent,
    'typecheck-aux-'
  );
  let auxiliaryDirectory: RetainedNoFollowChildProcessDirectory;
  try {
    if (seed !== null) {
      assertActive('private seed publication');
      publishExclusiveDurableCanonicalFile({
        parent: actionRoot,
        name: BUILD_INFO_FILE_NAME,
        bytes: seed,
        validate: (readback) => {
          if (!Buffer.from(readback).equals(seed)) {
            throw new Error('TypeScript incremental private seed readback differs.');
          }
        }
      });
    }
    assertActive('private directory retention');
    auxiliaryDirectory = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(actionRoot.path, 'TypeScript action-private auxiliary directory'),
      16,
      'TypeScript action-private auxiliary directory'
    );
    assertActive('private directory readback');
  } catch (error) {
    try {
      retireActionPrivateTree(
        actionRoot,
        input.actionPrivateParent,
        deadlineAtMonotonicMs,
        assertActive
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'TypeScript action-private auxiliary setup left physical residue'
      );
    }
    throw error;
  }
  const executionBuildInfoFile = path.join(actionRoot.path, BUILD_INFO_FILE_NAME);
  let disposed = false;
  let disposal: Promise<TypeScriptIncrementalCleanupReceipt> | null = null;

  const publish = async (): Promise<TypeScriptIncrementalPublication> => {
    if (disposed) return Object.freeze({ status: 'cache-unavailable' as const });
    try {
      assertActive('stable seed publication admission');
      const output = inspectNoFollowOrdinaryFileEntry(actionRoot, BUILD_INFO_FILE_NAME);
      if (output === null || output.bytes === null || output.size > BUILD_INFO_MAXIMUM_BYTES
          || expectedExisting === undefined) {
        return Object.freeze({ status: 'cache-unavailable' as const });
      }
      const envelope = canonicalSeedBytes(seedEnvelope(output.bytes, input.seedBindingDigest));
      assertActive('stable seed publication');
      replaceDurableCanonicalFile({
        parent: input.stableSeedParent,
        name: stableSeedName,
        bytes: envelope,
        expectedExisting,
        validate: (readback) => {
          if (parseStableSeed(readback, input.seedBindingDigest) === null) {
            throw new Error('TypeScript incremental stable seed envelope is invalid.');
          }
        }
      });
      assertActive('stable seed publication readback');
      return Object.freeze({ status: 'published' as const });
    } catch {
      return Object.freeze({ status: 'cache-unavailable' as const });
    }
  };

  const dispose = (): Promise<TypeScriptIncrementalCleanupReceipt> => {
    if (disposal !== null) return disposal;
    disposed = true;
    disposal = Promise.resolve().then(() => {
      assertActive('auxiliary capability disposal');
      auxiliaryDirectory.dispose();
      return Object.freeze({
        tree: retireActionPrivateTree(
          actionRoot,
          input.actionPrivateParent,
          deadlineAtMonotonicMs,
          assertActive
        )
      });
    });
    return disposal;
  };

  return Object.freeze({
    auxiliaryDirectory,
    buildInfoFileName: BUILD_INFO_FILE_NAME,
    executionBuildInfoFile,
    publish,
    dispose
  });
}
