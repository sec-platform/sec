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
import { settlePhysicalResources, type PhysicalResourceSettlementFailure } from '../../runtime-state/physical/runtime/resource-settlement.ts';
import { isNativeAborted } from '../../contracts/native-abort.ts';
import {
  BUILD_INFO_FILE_NAME, BUILD_INFO_MAXIMUM_BYTES, STABLE_SEED_MAXIMUM_BYTES,
  assertSeedBindingDigest, encodeStableSeed, parseStableSeed
} from './incremental-seed.ts';

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

// Parent values are identity observations, not retained capabilities. Capture
// their declared data only; the physical owner still verifies every actual use.
function captureParent(parent: PhysicalDirectoryIdentity): PhysicalDirectoryIdentity {
  const { path, finalPath, device, inode, objectId } = parent;
  if ([path, finalPath, device, inode, objectId].some(value => typeof value !== 'string')) {
    throw new TypeError('TypeScript incremental parent identity must contain string fields.');
  }
  return Object.freeze({ path, finalPath, device, inode, objectId });
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
  // These decisions belong to one attempt. Later edits of the caller object
  // cannot replace its parent, seed binding, cancellation source or deadline.
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('TypeScript incremental input must be a record.');
  }
  const { actionPrivateParent, deadlineAtUnixMs, seedBindingDigest, signal,
    stableSeedFile: requestedSeedFile, stableSeedParent } = input;
  input = Object.freeze({ actionPrivateParent: captureParent(actionPrivateParent), deadlineAtUnixMs,
    seedBindingDigest, signal, stableSeedFile: requestedSeedFile, stableSeedParent: captureParent(stableSeedParent) });
  if (!Number.isSafeInteger(input.deadlineAtUnixMs)) {
    throw new Error('TypeScript incremental state deadline must be an absolute safe integer.');
  }
  const startedAtUnixMs = Date.now();
  const deadlineAtMonotonicMs = performance.now() + Math.max(
    0,
    input.deadlineAtUnixMs - startedAtUnixMs
  );
  const assertActive = (label: string): void => {
    if (isNativeAborted(input.signal)) {
      throw new Error(`TypeScript incremental state ${label} was cancelled.`);
    }
    if (input.deadlineAtUnixMs - Date.now() < 1
        || deadlineAtMonotonicMs - performance.now() < 1) {
      throw new Error(`TypeScript incremental state ${label} exhausted its deadline.`);
    }
  };
  assertActive('admission');
  assertSeedBindingDigest(input.seedBindingDigest);
  if (typeof input.stableSeedFile !== 'string' || /[\0\p{Surrogate}]/u.test(input.stableSeedFile)) {
    throw new TypeError('TypeScript incremental seed path must be well-formed text without NUL.');
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
    } else if (digest.size > STABLE_SEED_MAXIMUM_BYTES) {
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
    seed = null;
  }

  assertActive('private tree creation');
  const actionRoot = createExclusiveNoFollowRandomDirectory(
    input.actionPrivateParent,
    'typecheck-aux-'
  );
  let auxiliaryDirectory: RetainedNoFollowChildProcessDirectory | undefined;
  let releaseAuxiliary: (() => void) | undefined;
  const settleActionPrivateTree = (
    primary?: PhysicalResourceSettlementFailure
  ): TypeScriptIncrementalCleanupReceipt => {
    let released = releaseAuxiliary === undefined;
    let tree: NoFollowDirectoryTreeRetirementReceipt | undefined;
    settlePhysicalResources({ primary, cleanup: [
      ...(releaseAuxiliary === undefined ? [] : [{ label: 'typescript-auxiliary-release', settle() {
        // Closing an already-owned handle grants no new IO budget. Cancellation
        // must not strand it. Destructive tree retirement still uses the old
        // deadline/cancellation policy and cannot occur under an unreleased handle.
        releaseAuxiliary!();
        released = true;
      } }]),
      { label: 'typescript-private-tree-retirement', settle() {
        if (released) tree = retireActionPrivateTree(actionRoot, input.actionPrivateParent,
          deadlineAtMonotonicMs, assertActive);
      } }
    ] });
    return Object.freeze({ tree: tree! });
  };
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
    const retainedDirectory = auxiliaryDirectory;
    // Adoption precedes method selection: an unreadable provider method must
    // not make the tree appear unretained and therefore safe to delete.
    releaseAuxiliary = () => { throw new Error('TypeScript auxiliary release was not bound.'); };
    const disposeAuxiliary = retainedDirectory.dispose;
    if (typeof disposeAuxiliary !== 'function') throw new TypeError('TypeScript auxiliary release must be callable.');
    releaseAuxiliary = () => { Reflect.apply(disposeAuxiliary, retainedDirectory, []); };
    assertActive('private directory readback');
  } catch (error) {
    settleActionPrivateTree({ label: 'typescript-incremental-setup', error });
    throw error; // The settlement owner propagates every present primary value.
  }
  const executionBuildInfoFile = path.join(actionRoot.path, BUILD_INFO_FILE_NAME);
  let disposed = false;
  let disposal: Promise<TypeScriptIncrementalCleanupReceipt> | null = null;

  const publish = async (): Promise<TypeScriptIncrementalPublication> => {
    if (disposed || expectedExisting === undefined) return Object.freeze({ status: 'cache-unavailable' as const });
    try {
      assertActive('stable seed publication admission');
      const output = inspectNoFollowOrdinaryFileEntry(actionRoot, BUILD_INFO_FILE_NAME);
      if (output === null || output.bytes === null || output.size > BUILD_INFO_MAXIMUM_BYTES) {
        return Object.freeze({ status: 'cache-unavailable' as const });
      }
      const envelope = encodeStableSeed(output.bytes, input.seedBindingDigest);
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
    disposal = Promise.resolve().then(() => settleActionPrivateTree());
    return disposal;
  };

  return Object.freeze({
    auxiliaryDirectory: auxiliaryDirectory!,
    buildInfoFileName: BUILD_INFO_FILE_NAME,
    executionBuildInfoFile,
    publish,
    dispose
  });
}
