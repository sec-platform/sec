import path from 'node:path';
import { sha256 } from '../../../contracts/canonical.ts';
import { CodedFailure } from '../../../contracts/failure.ts';
import { isCanonicalPortableLogicalPath } from '../../../contracts/logical-path.ts';
import { throwIfNativeAborted } from '../../../contracts/native-abort.ts';
import { settleResourcesAsync } from '../../../execution/resource-settlement.ts';
import {
  assertPhysicalGenerationRetirementReceipt, assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain, materializeRetainedNoFollowProvenDirectoryGeneration,
  retainNoFollowOrdinaryFile, scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry, type RetainedNoFollowOrdinaryFile,
  type RetainedNoFollowProvenDirectoryGeneration
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES, RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
  runtimeDependencyTreeIdentity
} from '../dependencies/runtime/source-generation.ts';
import { assertRetainedCargoRegistryInputs, type RetainedCargoRegistryInputs } from './cargo-registry-inputs.ts';

const extractedBrand: unique symbol = Symbol('retained-cargo-extracted-sources');
export interface RetainedCargoExtractedSources {
  readonly [extractedBrand]: never;
  readonly identityDigest: `sha256:${string}`;
  assertCurrent(): Promise<void>;
  retire(): Promise<void>;
}

type Lifecycle = { retiring: Promise<void> | undefined; retired: boolean };
const issued = new WeakMap<object, Lifecycle>();

export function assertRetainedCargoExtractedSources(value: unknown): asserts value is RetainedCargoExtractedSources {
  const state = value !== null && typeof value === 'object' ? issued.get(value) : undefined;
  if (state === undefined || state.retired || state.retiring !== undefined) {
    throw new CodedFailure('CARGO-EXTRACTED-INVALID', 'Live original-issued Cargo extracted sources are required.');
  }
}

function validateLayout(inventory: readonly NoFollowDirectoryTreeInventoryEntry[]): void {
  for (const entry of inventory) {
    const parts = entry.relativePath.split('/');
    if (!isCanonicalPortableLogicalPath(entry.relativePath) || entry.kind === 'link'
        || (parts.length < 3 && entry.kind !== 'directory')
        || (entry.kind === 'file' && entry.byteDigest === undefined)) {
      throw new CodedFailure('CARGO-EXTRACTED-LAYOUT', 'Cargo extracted sources require ordinary source/package directories and fully observed ordinary leaves.');
    }
  }
}

/** Called only after the parent's managed fetch has reached proven tree closure. */
export async function retainCargoExtractedSources(input: Readonly<{
  registryInputs: RetainedCargoRegistryInputs;
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<RetainedCargoExtractedSources> {
  if (process.platform !== 'win32') throw new CodedFailure('CARGO-EXTRACTED-UNAVAILABLE', 'Cargo extracted-source protection requires the qualified Windows physical generation provider.');
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now()) {
    throw new CodedFailure('CARGO-EXTRACTED-DEADLINE', 'Cargo extracted-source admission requires a live absolute deadline.');
  }
  assertRetainedCargoRegistryInputs(input.registryInputs);
  const deadlineAtMs = performance.now() + input.deadlineAtUnixMs - Date.now();
  const checkpoint = (): void => {
    throwIfNativeAborted(input.signal);
    if (performance.now() >= deadlineAtMs || Date.now() >= input.deadlineAtUnixMs) {
      throw new CodedFailure('CARGO-EXTRACTED-DEADLINE', 'Cargo extracted-source admission deadline exhausted.');
    }
  };
  const boundary = (): void => {
    checkpoint();
    assertRetainedCargoRegistryInputs(input.registryInputs);
    input.registryInputs.assertCurrent();
  };
  boundary();
  const src = inspectNoFollowDirectoryChain(path.join(input.registryInputs.cargoHome.path, 'registry', 'src'), 'Private Cargo extracted-source root').target;
  let entriesRemaining = RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES;
  let bytesRemaining = RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES;
  const inventory = (): readonly NoFollowDirectoryTreeInventoryEntry[] => {
    checkpoint();
    if (entriesRemaining < 1) throw new CodedFailure('CARGO-EXTRACTED-LIMIT', 'Cargo extracted-source entry budget exhausted.');
    const tree = scanNoFollowDirectoryTreeInventory(src, { maximumEntries: entriesRemaining,
      maximumBytes: bytesRemaining, deadlineAtMs, signal: input.signal, includeByteDigest: true });
    entriesRemaining -= tree.length;
    for (const entry of tree) if (entry.kind === 'file') bytesRemaining -= entry.size;
    validateLayout(tree);
    return tree;
  };
  // These private leases only keep read sharing in force. Sealing changes
  // ChangeTime, so subsequent metadata is proved by the complete authority
  // census rather than by the pre-seal file observations. No lease escapes.
  const pins: Pick<RetainedNoFollowOrdinaryFile, 'dispose'>[] = [];
  let physical: RetainedNoFollowProvenDirectoryGeneration | undefined;
  const retainLeaves = (tree: readonly NoFollowDirectoryTreeInventoryEntry[]): void => {
    for (const entry of tree) {
      checkpoint();
      if (entry.kind !== 'file') continue;
      if (entriesRemaining < 1) throw new CodedFailure('CARGO-EXTRACTED-LIMIT', 'Cargo extracted-source retained-handle budget exhausted.');
      entriesRemaining -= 1;
      const absolute = path.join(src.path, ...entry.relativePath.split('/'));
      const pin = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(absolute)), path.basename(absolute),
        { device: entry.device, inode: entry.inode }, 'Cargo extracted-source leaf');
      pins.push(pin);
      // Cargo unpacking does not require aliases. Reject internal aliases too,
      // so sealing can never change an external hardlink object's authority.
      if (pin.linkCount !== 1 || pin.size !== entry.size) {
        throw new CodedFailure('CARGO-EXTRACTED-LINK', 'Cargo extracted-source leaves must have one link and unchanged size.');
      }
    }
  };
  let identityDigest: `sha256:${string}`;
  try {
    const before = inventory();
    const treeIdentity = runtimeDependencyTreeIdentity(before);
    retainLeaves(before);
    boundary();
    identityDigest = sha256({ domain: 'cargo-extracted-sources', registry: input.registryInputs.identityDigest,
      root: src, ...treeIdentity, rawDigests: before.map(entry => entry.byteDigest ?? null) }) as `sha256:${string}`;
    const materialized = await materializeRetainedNoFollowProvenDirectoryGeneration({
      root: src, binding: { generationDigest: identityDigest, ...treeIdentity }, inventory: before,
      proofText: null, releaseMode: 'restore-owner-write', deadlineAtUnixMs: input.deadlineAtUnixMs,
      signal: input.signal
    });
    physical = materialized.generation;
    boundary();
    assertSameNoFollowDirectoryIdentity(src, 'Sealed Cargo extracted-source root');
    await physical.assertAuthorityCurrent();
    const after = inventory();
    const observed = runtimeDependencyTreeIdentity(after);
    if (observed.treeDigest !== treeIdentity.treeDigest || observed.treeEntryCount !== treeIdentity.treeEntryCount) {
      throw new CodedFailure('CARGO-EXTRACTED-DRIFT', 'Cargo extracted-source content or membership changed across sealing.');
    }
    await physical.assertAuthorityCurrent();
    boundary();
  } catch (error) {
    await settleResourcesAsync({ primary: { label: 'Cargo extracted-source preparation', error }, cleanup: [
      { label: 'partial Cargo source generation', settle: async () => {
        if (physical !== undefined) assertPhysicalGenerationRetirementReceipt(await physical.retire());
      } },
      ...[...pins].reverse().map(pin => ({ label: 'partial Cargo source leaf', settle: () => pin.dispose() }))
    ] });
    throw error;
  }
  const authority = physical;
  const state: Lifecycle = { retired: false, retiring: undefined };
  const generation: RetainedCargoExtractedSources = Object.freeze({ [extractedBrand]: undefined as never,
    identityDigest,
    assertCurrent: async () => {
      assertRetainedCargoExtractedSources(generation);
      assertRetainedCargoRegistryInputs(input.registryInputs);
      input.registryInputs.assertCurrent();
      assertSameNoFollowDirectoryIdentity(src, 'Retained Cargo extracted-source root');
      await authority.assertAuthorityCurrent();
      assertRetainedCargoExtractedSources(generation);
    },
    retire: () => {
      if (state.retiring !== undefined) return state.retiring;
      state.retiring = settleResourcesAsync({ cleanup: [
        { label: 'Cargo extracted-source generation', settle: async () => {
          assertPhysicalGenerationRetirementReceipt(await authority.retire());
        } },
        ...[...pins].reverse().map(pin => ({ label: 'Cargo extracted-source leaf', settle: () => pin.dispose() }))
      ] }).then(() => { state.retired = true; });
      return state.retiring;
    }
  });
  issued.set(generation, state);
  return generation;
}
