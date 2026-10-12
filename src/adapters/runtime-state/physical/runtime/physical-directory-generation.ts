import { createHash } from 'node:crypto';
import { fchmodSync, fstatSync } from 'node:fs';
import path from 'node:path';

import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess
} from './physical-directory-chain.ts';
import { scanNoFollowDirectoryTreeInventory } from './physical-directory-tree-observation.ts';
import {
  issueRetainedNoFollowCapability,
  registerPhysicalGenerationRetirementReceipt,
  registerRetainedNoFollowProvenDirectoryGeneration,
  registerRetainedNoFollowSealedDirectoryGeneration
} from './physical-no-follow-authority.ts';
import type {
  NoFollowDirectoryTreeEntryKind,
  NoFollowDirectoryTreeInventoryEntry,
  PhysicalDirectoryIdentity,
  PhysicalGenerationRetirementReceipt,
  ProvenDirectoryGenerationBinding,
  RetainedNoFollowChildProcessDirectory,
  RetainedNoFollowProvenDirectoryGeneration,
  RetainedNoFollowSealedDirectoryGeneration
} from './physical-no-follow-contract.ts';
import {
  WINDOWS_FILE_OPEN,
  WINDOWS_GENERIC_READ,
  WINDOWS_SHARE_READ,
  closeLinuxDescriptorsBestEffort,
  closeWindowsHandlesBestEffort,
  digestWindowsRetainedFile,
  linuxOpenAt,
  linuxOpenLeafAt,
  linuxOpenReadableLeafAt,
  linuxOpenRetainedAbsoluteDirectory,
  windowsIdentity,
  windowsOpenRelativeDirectory,
  windowsOpenRelativeLeaf,
  windowsOpenRelativeNoFollowEntry,
  windowsOpenSealedReadDirectory,
  windowsRetainedLeafIdentity,
  windowsRetainedReparseObservation,
  windowsRewindRetainedFile
} from './physical-no-follow-native.ts';
import { physicalError, sameIdentity } from './physical-no-follow-shared.ts';
import {
  openWindowsReadOnlyTreeGeneration,
  retireWindowsReadOnlyTreeGeneration,
  sealExistingWindowsReadOnlyTreeAuthority,
  sealWindowsReadOnlyTreeGeneration,
  type WindowsReadOnlyTreeAuthority
} from './windows-host-filesystem-authority.ts';

/** Retained read-only directory generation lifecycle and provenance authority. */

type LinuxProvenGenerationIdentity = Readonly<{
  ctimeNs: string;
  device: string;
  inode: string;
  mode: string;
}>;

type LinuxProvenGenerationEntry = LinuxProvenGenerationIdentity & Readonly<{
  kind: NoFollowDirectoryTreeEntryKind;
  predecessorMode: string;
  relativePath: string;
}>;

type LinuxProvenGenerationProof = Readonly<{
  binding: ProvenDirectoryGenerationBinding;
  entries: readonly LinuxProvenGenerationEntry[];
  proofDigest: `sha256:${string}`;
  root: LinuxProvenGenerationIdentity;
  rootPredecessorMode: string;
  rootPath: string;
  schema: 'sec-linux-read-only-tree-generation-proof-v1';
}>;

function linuxProvenIdentity(metadata: Readonly<{
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mode: bigint;
}>): LinuxProvenGenerationIdentity {
  return Object.freeze({
    ctimeNs: String(metadata.ctimeNs),
    device: String(metadata.dev),
    inode: String(metadata.ino),
    mode: String(metadata.mode)
  });
}

function sameLinuxProvenIdentity(
  left: LinuxProvenGenerationIdentity,
  right: LinuxProvenGenerationIdentity
): boolean {
  return left.ctimeNs === right.ctimeNs && left.device === right.device
    && left.inode === right.inode && left.mode === right.mode;
}

function linuxProofUnsigned(input: Omit<LinuxProvenGenerationProof, 'proofDigest'>): object {
  return Object.freeze({
    binding: input.binding,
    entries: input.entries,
    root: input.root,
    rootPredecessorMode: input.rootPredecessorMode,
    rootPath: input.rootPath,
    schema: input.schema
  });
}

function linuxProofDigest(
  input: Omit<LinuxProvenGenerationProof, 'proofDigest'>
): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(linuxProofUnsigned(input))).digest('hex')}`;
}

function parseLinuxProvenGenerationProof(text: string): LinuxProvenGenerationProof {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Linux generation proof JSON is invalid.',
      error
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Linux generation proof is invalid.');
  }
  const proof = value as Partial<LinuxProvenGenerationProof>;
  const exact = (candidate: object, keys: readonly string[]): boolean => (
    JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify([...keys].sort())
  );
  const validIdentity = (candidate: unknown): candidate is LinuxProvenGenerationIdentity => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)
        || !exact(candidate, ['ctimeNs', 'device', 'inode', 'mode'])) return false;
    const identity = candidate as Partial<LinuxProvenGenerationIdentity>;
    return typeof identity.ctimeNs === 'string' && /^[1-9][0-9]*$/u.test(identity.ctimeNs)
      && typeof identity.device === 'string' && identity.device.length > 0
      && typeof identity.inode === 'string' && identity.inode.length > 0
      && typeof identity.mode === 'string' && identity.mode.length > 0;
  };
  if (!exact(value, [
    'binding', 'entries', 'proofDigest', 'root', 'rootPath', 'rootPredecessorMode', 'schema'
  ])
      || proof.schema !== 'sec-linux-read-only-tree-generation-proof-v1'
      || proof.binding === null || typeof proof.binding !== 'object' || Array.isArray(proof.binding)
      || !exact(proof.binding, ['generationDigest', 'treeDigest', 'treeEntryCount'])
      || typeof proof.binding.generationDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(proof.binding.generationDigest)
      || typeof proof.binding.treeDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(proof.binding.treeDigest)
      || !Number.isSafeInteger(proof.binding.treeEntryCount)
      || proof.binding.treeEntryCount! < 0
      || !Array.isArray(proof.entries) || !validIdentity(proof.root)
      || typeof proof.rootPredecessorMode !== 'string'
      || !/^[1-9][0-9]*$/u.test(proof.rootPredecessorMode)
      || typeof proof.rootPath !== 'string' || !path.posix.isAbsolute(proof.rootPath)
      || typeof proof.proofDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(proof.proofDigest)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Linux generation proof shape is invalid.');
  }
  const entries: LinuxProvenGenerationEntry[] = [];
  let predecessor = '';
  for (const valueEntry of proof.entries) {
    if (valueEntry === null || typeof valueEntry !== 'object' || Array.isArray(valueEntry)
        || !exact(valueEntry, [
          'ctimeNs', 'device', 'inode', 'kind', 'mode', 'predecessorMode', 'relativePath'
        ])
        || !validIdentity({
          ctimeNs: (valueEntry as LinuxProvenGenerationEntry).ctimeNs,
          device: (valueEntry as LinuxProvenGenerationEntry).device,
          inode: (valueEntry as LinuxProvenGenerationEntry).inode,
          mode: (valueEntry as LinuxProvenGenerationEntry).mode
        })) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Linux generation proof entry is invalid.');
    }
    const entry = valueEntry as LinuxProvenGenerationEntry;
    if (!['directory', 'file', 'link'].includes(entry.kind)
        || !/^[1-9][0-9]*$/u.test(entry.predecessorMode)
        || entry.relativePath.length === 0 || path.posix.isAbsolute(entry.relativePath)
        || entry.relativePath.split('/').some((segment) => (
          segment.length === 0 || segment === '.' || segment === '..'
        ))
        || (predecessor !== '' && predecessor >= entry.relativePath)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Linux generation proof path is invalid.');
    }
    predecessor = entry.relativePath;
    entries.push(Object.freeze({ ...entry }));
  }
  const parsed = Object.freeze({
    binding: Object.freeze({ ...proof.binding }),
    entries: Object.freeze(entries),
    proofDigest: proof.proofDigest,
    root: proof.root,
    rootPath: path.posix.resolve(proof.rootPath),
    rootPredecessorMode: proof.rootPredecessorMode,
    schema: proof.schema
  }) as LinuxProvenGenerationProof;
  if (linuxProofDigest(parsed) !== parsed.proofDigest
      || `${JSON.stringify(parsed)}\n` !== text) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Linux generation proof bytes or digest are noncanonical.'
    );
  }
  return parsed;
}

function sameProvenGenerationBinding(
  left: ProvenDirectoryGenerationBinding,
  right: ProvenDirectoryGenerationBinding
): boolean {
  return left.generationDigest === right.generationDigest
    && left.treeDigest === right.treeDigest
    && left.treeEntryCount === right.treeEntryCount;
}

function projectProvenDirectoryGenerationBinding(
  proofText: string
): ProvenDirectoryGenerationBinding {
  let value: unknown;
  try {
    value = JSON.parse(proofText);
  } catch (error) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Proven generation proof JSON is invalid.',
      error
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Proven generation proof has no binding projection.'
    );
  }
  const binding = (value as { binding?: unknown }).binding;
  if (binding === null || typeof binding !== 'object' || Array.isArray(binding)
      || JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify([
        'generationDigest', 'treeDigest', 'treeEntryCount'
      ])) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Proven generation proof binding is noncanonical.'
    );
  }
  const projected = binding as Partial<ProvenDirectoryGenerationBinding>;
  if (typeof projected.generationDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(projected.generationDigest)
      || typeof projected.treeDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(projected.treeDigest)
      || !Number.isSafeInteger(projected.treeEntryCount)
      || projected.treeEntryCount! < 0) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      'Proven generation proof binding is invalid.'
    );
  }
  return Object.freeze({
    generationDigest: projected.generationDigest,
    treeDigest: projected.treeDigest,
    treeEntryCount: projected.treeEntryCount
  }) as ProvenDirectoryGenerationBinding;
}

function linuxGenerationEntries(
  rootPath: string,
  inventory: readonly Readonly<{
    readonly relativePath: string;
    readonly kind: NoFollowDirectoryTreeEntryKind;
    readonly device: string;
    readonly inode: string;
    readonly predecessorMode?: string;
  }>[],
  seal: boolean,
  label: string,
  retainedRootPredecessorMode?: string
): Readonly<{
  root: LinuxProvenGenerationIdentity;
  rootPredecessorMode: string;
  entries: readonly LinuxProvenGenerationEntry[];
}> {
  const retainedRoot = linuxOpenRetainedAbsoluteDirectory(rootPath, `${label} root`);
  const rootBefore = fstatSync(retainedRoot.directoryFd, { bigint: true });
  const rootPredecessorMode = retainedRootPredecessorMode ?? String(rootBefore.mode);
  const directoryFds = new Map<string, number>([['', retainedRoot.directoryFd]]);
  const opened: number[] = [];
  try {
    const ordered = [...inventory].sort((left, right) => {
      const depth = left.relativePath.split('/').length - right.relativePath.split('/').length;
      if (depth !== 0) return depth;
      return left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0;
    });
    const entries: LinuxProvenGenerationEntry[] = [];
    for (const entry of ordered) {
      const parts = entry.relativePath.split('/');
      const name = parts.pop()!;
      const parentFd = directoryFds.get(parts.join('/'));
      if (parentFd === undefined) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} has no retained parent.`);
      }
      const fd = entry.kind === 'directory'
        ? linuxOpenAt(parentFd, name, `${label} ${entry.relativePath}`)
        : entry.kind === 'file'
          ? linuxOpenReadableLeafAt(parentFd, name, `${label} ${entry.relativePath}`)
          : linuxOpenLeafAt(parentFd, name, `${label} ${entry.relativePath}`);
      opened.push(fd);
      if (entry.kind === 'directory') directoryFds.set(entry.relativePath, fd);
      const before = fstatSync(fd, { bigint: true });
      if (String(before.dev) !== entry.device || String(before.ino) !== entry.inode) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
          `${label} entry identity changed: ${entry.relativePath}`
        );
      }
      const predecessorMode = entry.predecessorMode ?? String(before.mode);
      const sealedMode = entry.kind === 'directory'
        ? 0o555 : 0o444 | Number(BigInt(predecessorMode) & 0o111n);
      if (seal && entry.kind !== 'link') fchmodSync(fd, sealedMode);
      const after = fstatSync(fd, { bigint: true });
      const identity = linuxProvenIdentity(after);
      if ((entry.kind === 'directory' && (after.mode & 0o777n) !== 0o555n)
          || (entry.kind === 'file' && (after.mode & 0o777n) !== BigInt(sealedMode))) {
        throw physicalError(
          'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
          `${label} entry is not read-only: ${entry.relativePath}`
        );
      }
      entries.push(Object.freeze({
        ...identity,
        kind: entry.kind,
        predecessorMode: entry.predecessorMode ?? String(before.mode),
        relativePath: entry.relativePath
      }));
    }
    if (seal) fchmodSync(retainedRoot.directoryFd, 0o555);
    const root = linuxProvenIdentity(fstatSync(retainedRoot.directoryFd, { bigint: true }));
    if ((BigInt(root.mode) & 0o777n) !== 0o555n) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `${label} root is not read-only.`);
    }
    entries.sort((left, right) => (
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
    ));
    return Object.freeze({ root, rootPredecessorMode, entries: Object.freeze(entries) });
  } finally {
    closeLinuxDescriptorsBestEffort(
      [...new Set(opened)].reverse().concat(
        retainedRoot.directoryFd === retainedRoot.filesystemRootFd
          ? [retainedRoot.filesystemRootFd]
          : [retainedRoot.directoryFd, retainedRoot.filesystemRootFd]
      ),
      label
    );
  }
}

function linuxGenerationAuthority(input: Readonly<{
  proof: LinuxProvenGenerationProof;
  restoreOwnerWrite: boolean;
}>): WindowsReadOnlyTreeAuthority {
  let released = false;
  const assertCurrent = async (): Promise<void> => {
    if (released) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation proof is released.');
    }
    const current = linuxGenerationEntries(
      input.proof.rootPath,
      input.proof.entries,
      false,
      'Linux proven generation readback',
      input.proof.rootPredecessorMode
    );
    if (!sameLinuxProvenIdentity(current.root, input.proof.root)
        || JSON.stringify(current.entries) !== JSON.stringify(input.proof.entries)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation proof changed.');
    }
  };
  return Object.freeze({
    aclDigest: input.proof.proofDigest,
    rootPath: input.proof.rootPath,
    assertCurrent,
    release: async () => {
      if (released) return;
      if (input.restoreOwnerWrite) retireLinuxProvenGeneration(input.proof);
      released = true;
    }
  });
}

function sameLinuxProvenObject(
  metadata: Readonly<{ dev: bigint; ino: bigint }>,
  expected: LinuxProvenGenerationIdentity
): boolean {
  return String(metadata.dev) === expected.device && String(metadata.ino) === expected.inode;
}

function retireLinuxProvenGeneration(proof: LinuxProvenGenerationProof): void {
  const root = linuxOpenRetainedAbsoluteDirectory(proof.rootPath, 'Linux generation retirement root');
  const directories = new Map<string, number>([['', root.directoryFd]]);
  const opened: number[] = [];
  try {
    const ordered = [...proof.entries].sort((left, right) => {
      const depth = left.relativePath.split('/').length - right.relativePath.split('/').length;
      if (depth !== 0) return depth;
      return left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0;
    });
    for (const entry of ordered) {
      const parts = entry.relativePath.split('/');
      const name = parts.pop()!;
      const parent = directories.get(parts.join('/'));
      if (parent === undefined) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Linux generation retirement parent disappeared.');
      }
      const fd = entry.kind === 'directory'
        ? linuxOpenAt(parent, name, 'Linux generation retirement directory')
        : entry.kind === 'file'
          ? linuxOpenReadableLeafAt(parent, name, 'Linux generation retirement file')
          : linuxOpenLeafAt(parent, name, 'Linux generation retirement link');
      opened.push(fd);
      if (entry.kind === 'directory') directories.set(entry.relativePath, fd);
      const current = fstatSync(fd, { bigint: true });
      if (!sameLinuxProvenObject(current, entry)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation entry changed before retirement.');
      }
      if (entry.kind !== 'link') {
        const predecessorMode = BigInt(entry.predecessorMode) & 0o7777n;
        const currentMode = current.mode & 0o7777n;
        const sealedMode = BigInt(entry.mode) & 0o7777n;
        if (currentMode === sealedMode) {
          fchmodSync(fd, Number(predecessorMode));
        } else if (currentMode !== predecessorMode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation entry has nonterminal mode residue.');
        }
        const readback = fstatSync(fd, { bigint: true });
        if (!sameLinuxProvenObject(readback, entry) || (readback.mode & 0o7777n) !== predecessorMode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation entry retirement readback changed.');
        }
      } else if (!sameLinuxProvenIdentity(linuxProvenIdentity(current), entry)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation link changed before retirement.');
      }
    }
    const currentRoot = fstatSync(root.directoryFd, { bigint: true });
    if (!sameLinuxProvenObject(currentRoot, proof.root)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation root changed before retirement.');
    }
    const predecessorMode = BigInt(proof.rootPredecessorMode) & 0o7777n;
    const currentMode = currentRoot.mode & 0o7777n;
    const sealedMode = BigInt(proof.root.mode) & 0o7777n;
    if (currentMode === sealedMode) {
      fchmodSync(root.directoryFd, Number(predecessorMode));
    } else if (currentMode !== predecessorMode) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation root has nonterminal mode residue.');
    }
    const rootReadback = fstatSync(root.directoryFd, { bigint: true });
    if (!sameLinuxProvenObject(rootReadback, proof.root)
        || (rootReadback.mode & 0o7777n) !== predecessorMode) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation root retirement readback changed.');
    }
  } finally {
    closeLinuxDescriptorsBestEffort(
      [...new Set(opened)].reverse().concat(
        root.directoryFd === root.filesystemRootFd
          ? [root.filesystemRootFd]
          : [root.directoryFd, root.filesystemRootFd]
      ),
      'Linux generation retirement'
    );
  }
}

export async function materializeRetainedNoFollowProvenDirectoryGeneration(input: Readonly<{
  binding: ProvenDirectoryGenerationBinding;
  deadlineAtUnixMs: number;
  inventory?: readonly NoFollowDirectoryTreeInventoryEntry[];
  linuxChildDescriptor?: number;
  proofText: string | null;
  root: PhysicalDirectoryIdentity;
  releaseMode?: 'preserve' | 'restore-owner-write';
  signal?: AbortSignal;
}>): Promise<Readonly<{
  generation: RetainedNoFollowProvenDirectoryGeneration;
  proofText: string;
  proofStatus: 'created' | 'reused';
}>> {
  if (input.signal?.aborted === true || !Number.isSafeInteger(input.deadlineAtUnixMs)
      || Date.now() >= input.deadlineAtUnixMs) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Proven generation admission expired.');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.binding.generationDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.binding.treeDigest)
      || !Number.isSafeInteger(input.binding.treeEntryCount)
      || (input.inventory !== undefined && input.binding.treeEntryCount !== input.inventory.length)
      || (input.proofText === null && input.inventory === undefined)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Proven generation binding is invalid.');
  }
  // Reject stale/foreign roots before any mode or ACL effect. The content
  // inventory alone need not contain an entry for the root itself.
  assertSameNoFollowDirectoryIdentity(input.root, 'Proven generation admission root');
  let authority: WindowsReadOnlyTreeAuthority;
  let proofText: string;
  let proofStatus: 'created' | 'reused';
  if (process.platform === 'win32') {
    if (input.proofText === null) {
      const entryPaths = input.inventory!.filter(({ kind }) => kind !== 'link').map(({ relativePath }) => (
        path.join(input.root.path, ...relativePath.split('/'))
      ));
      if (input.releaseMode === 'restore-owner-write') {
        authority = await sealExistingWindowsReadOnlyTreeAuthority(
          input.root.path,
          entryPaths,
          {
            deadlineAtMs: input.deadlineAtUnixMs,
            ownership: 'repository-dependency-generation',
            ownerRootPath: input.root.path,
            repositoryRootPath: path.dirname(input.root.path),
            signal: input.signal
          }
        );
        proofText = `${JSON.stringify(Object.freeze({
          binding: input.binding,
          schema: 'sec-action-private-read-only-tree-generation-v1'
        }))}\n`;
      } else {
        const sealed = await sealWindowsReadOnlyTreeGeneration(
          input.root.path,
          entryPaths,
          input.binding,
          { deadlineAtMs: input.deadlineAtUnixMs, signal: input.signal }
        );
        authority = sealed.authority;
        proofText = sealed.proofText;
      }
      proofStatus = 'created';
    } else {
      authority = await openWindowsReadOnlyTreeGeneration(
        input.root.path,
        input.proofText,
        input.binding,
        { deadlineAtMs: input.deadlineAtUnixMs, signal: input.signal }
      );
      proofText = input.proofText;
      proofStatus = 'reused';
    }
  } else if (process.platform === 'linux') {
    let proof: LinuxProvenGenerationProof;
    if (input.proofText === null) {
      const observed = linuxGenerationEntries(
        input.root.path,
        input.inventory!,
        true,
        'Linux proven generation publication'
      );
      const unsigned = Object.freeze({
        binding: Object.freeze({ ...input.binding }),
        entries: observed.entries,
        root: observed.root,
        rootPath: input.root.path,
        rootPredecessorMode: observed.rootPredecessorMode,
        schema: 'sec-linux-read-only-tree-generation-proof-v1' as const
      });
      proof = Object.freeze({
        binding: unsigned.binding,
        entries: unsigned.entries,
        proofDigest: linuxProofDigest(unsigned),
        root: unsigned.root,
        rootPath: unsigned.rootPath,
        rootPredecessorMode: unsigned.rootPredecessorMode,
        schema: unsigned.schema
      });
      proofText = `${JSON.stringify(proof)}\n`;
      proofStatus = 'created';
    } else {
      proof = parseLinuxProvenGenerationProof(input.proofText);
      if (!sameProvenGenerationBinding(proof.binding, input.binding)
          || path.resolve(proof.rootPath) !== path.resolve(input.root.path)) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation binding changed.');
      }
      proofText = input.proofText;
      proofStatus = 'reused';
    }
    authority = linuxGenerationAuthority({
      proof,
      restoreOwnerWrite: input.releaseMode === 'restore-owner-write'
    });
    await authority.assertCurrent();
  } else {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `Proven generation backend is unavailable on ${process.platform}.`
    );
  }
  try {
    const generation = await retainNoFollowProvenDirectoryGeneration(
      input.root,
      authority,
      'Dependency proven generation',
      input.linuxChildDescriptor ?? 15
    );
    return Object.freeze({ generation, proofText, proofStatus });
  } catch (error) {
    try { await authority.release(); } catch { /* retain the primary proof failure */ }
    throw error;
  }
}

/**
 * Reopens one publisher-issued proven generation without repeating its full
 * content inventory. The binding projection only selects the strict platform
 * parser; the Windows/Linux proof parser still authenticates the complete
 * canonical bytes, physical identities and writer-excluding state before a
 * retained capability is returned.
 */
export async function reopenRetainedNoFollowProvenDirectoryGeneration(input: Readonly<{
  deadlineAtUnixMs: number;
  linuxChildDescriptor?: number;
  proofText: string;
  root: PhysicalDirectoryIdentity;
  signal?: AbortSignal;
}>): Promise<Readonly<{
  binding: ProvenDirectoryGenerationBinding;
  generation: RetainedNoFollowProvenDirectoryGeneration;
}>> {
  const binding = projectProvenDirectoryGenerationBinding(input.proofText);
  const materialized = await materializeRetainedNoFollowProvenDirectoryGeneration({
    binding,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    ...(input.linuxChildDescriptor === undefined
      ? {}
      : { linuxChildDescriptor: input.linuxChildDescriptor }),
    proofText: input.proofText,
    root: input.root,
    signal: input.signal
  });
  return Object.freeze({ binding, generation: materialized.generation });
}

/**
 * Retires one publisher-sealed generation before its domain owner relocates
 * or deletes the exact root. The persisted proof is the authority: callers
 * cannot supply replacement modes, ACLs, entry paths or a structural session.
 */
export async function retireNoFollowProvenDirectoryGeneration(input: Readonly<{
  binding: ProvenDirectoryGenerationBinding;
  deadlineAtUnixMs: number;
  proofText: string;
  root: PhysicalDirectoryIdentity;
  signal?: AbortSignal;
}>): Promise<void> {
  if (input.signal?.aborted === true || !Number.isSafeInteger(input.deadlineAtUnixMs)
      || Date.now() >= input.deadlineAtUnixMs) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Proven generation retirement expired.');
  }
  const currentRoot = assertSameNoFollowDirectoryIdentity(
    input.root,
    'Proven generation retirement root'
  ).target;
  if (process.platform === 'win32') {
    await retireWindowsReadOnlyTreeGeneration(
      currentRoot.path,
      input.proofText,
      input.binding,
      { deadlineAtMs: input.deadlineAtUnixMs, signal: input.signal }
    );
  } else if (process.platform === 'linux') {
    const proof = parseLinuxProvenGenerationProof(input.proofText);
    if (!sameProvenGenerationBinding(proof.binding, input.binding)
        || path.resolve(proof.rootPath) !== path.resolve(currentRoot.path)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Linux generation retirement binding changed.');
    }
    retireLinuxProvenGeneration(proof);
  } else {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `Proven generation retirement backend is unavailable on ${process.platform}.`
    );
  }
  const readback = assertSameNoFollowDirectoryIdentity(
    input.root,
    'Proven generation retirement readback'
  ).target;
  if (!sameIdentity(currentRoot, readback)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', 'Proven generation root changed during retirement.');
  }
}

/**
 * Retains only the exact lexical/root object for a directory generation whose
 * complete content and mutation-excluding ACL/mode closure were already
 * verified by its canonical publisher. Descendant proof remains owned by the
 * supplied authority and is revalidated before and after child execution.
 */
async function retainNoFollowProvenDirectoryGeneration(
  expectedRoot: PhysicalDirectoryIdentity,
  readOnlyAuthority: WindowsReadOnlyTreeAuthority,
  label = 'proven directory generation',
  linuxChildDescriptor = 15
): Promise<RetainedNoFollowProvenDirectoryGeneration> {
  const root = assertSameNoFollowDirectoryIdentity(expectedRoot, `${label} root`).target;
  if (path.resolve(readOnlyAuthority.rootPath) !== path.resolve(root.path)) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH',
      `${label} read-only authority belongs to another root.`
    );
  }
  await readOnlyAuthority.assertCurrent();
  let boundary: RetainedNoFollowChildProcessDirectory | null = null;
  try {
    boundary = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(root.path, `${label} lexical boundary`),
      linuxChildDescriptor,
      `${label} lexical boundary`
    );
    boundary.assertCurrent();
    let disposed = false;
    let retirement: Promise<PhysicalGenerationRetirementReceipt> | null = null;
    const capability: RetainedNoFollowProvenDirectoryGeneration = Object.freeze({
      childPath: boundary.childPath,
      stdioSourceDescriptor: boundary.stdioSourceDescriptor,
      root,
      assertCurrent: () => {
        if (disposed) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} is disposed.`);
        }
        boundary!.assertCurrent();
      },
      assertAuthorityCurrent: () => readOnlyAuthority.assertCurrent(),
      dispose: () => {
        if (disposed) return;
        disposed = true;
        boundary!.dispose();
      },
      retire: () => {
        if (retirement !== null) return retirement;
        retirement = (async () => {
          const failures: unknown[] = [];
          try { if (!disposed) capability.dispose(); } catch (error) { failures.push(error); }
          try { await readOnlyAuthority.release(); } catch (error) { failures.push(error); }
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1) {
            throw new AggregateError(failures, `${label} retirement cleanup failed.`);
          }
          const readback = assertSameNoFollowDirectoryIdentity(
            root,
            `${label} retirement readback`
          ).target;
          const receipt: PhysicalGenerationRetirementReceipt = Object.freeze({
            schema: 'sec-physical-generation-retirement-v1' as const,
            root: Object.freeze({
              path: readback.path,
              finalPath: readback.finalPath,
              device: readback.device,
              inode: readback.inode,
              objectId: readback.objectId
            }),
            terminal: 'released' as const
          });
          registerPhysicalGenerationRetirementReceipt(receipt);
          return receipt;
        })();
        return retirement;
      }
    });
    const issued = issueRetainedNoFollowCapability(capability, 'working-directory');
    registerRetainedNoFollowProvenDirectoryGeneration(issued);
    await issued.assertAuthorityCurrent();
    return issued;
  } catch (error) {
    try { boundary?.dispose(); } catch { /* retain the primary proof failure */ }
    try { await readOnlyAuthority.release(); } catch { /* typed residue remains */ }
    throw error;
  }
}

/**
 * Retains one exact, already-published directory generation for an external
 * reader. Windows opens the root and every inventoried descendant without
 * write/delete sharing. Any pre-existing writer therefore blocks admission;
 * after admission those retained handles exclude byte, rename and delete
 * mutation until disposal. The companion authority seals only the root and
 * inventoried directories, because Windows sharing does not exclude child
 * creation. The final inventory readback happens after the complete handle set
 * is retained, so ordinary files and links need no per-entry ACL mutation.
 */
export async function retainNoFollowSealedDirectoryGeneration(
  expectedRoot: PhysicalDirectoryIdentity,
  expectedInventory: readonly NoFollowDirectoryTreeInventoryEntry[],
  readOnlyAuthority: WindowsReadOnlyTreeAuthority,
  label = 'sealed directory generation'
): Promise<RetainedNoFollowSealedDirectoryGeneration> {
  const root = assertSameNoFollowDirectoryIdentity(expectedRoot, `${label} root`).target;
  if (path.resolve(readOnlyAuthority.rootPath) !== path.resolve(root.path)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} ACL authority belongs to another root.`);
  }
  await readOnlyAuthority.assertCurrent();
  const canonicalInventory = Object.freeze([...expectedInventory].map((entry) => Object.freeze({ ...entry })));
  if (process.platform !== 'win32') {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} complete membership exclusion is unavailable on ${process.platform}.`
    );
  }

  type RetainedEntry = Readonly<{
    absolutePath: string;
    entry: NoFollowDirectoryTreeInventoryEntry;
    handle: bigint;
  }>;
  const rootHandle = windowsOpenSealedReadDirectory(root.path, `${label} root`);
  let lexicalBoundary: RetainedNoFollowChildProcessDirectory | null = null;
  const directoryHandles = new Map<string, Readonly<{
    handle: bigint;
    identity: PhysicalDirectoryIdentity;
  }>>();
  const retainedEntries: RetainedEntry[] = [];
  let disposed = false;
  let pendingEntryHandle: bigint | null = null;
  try {
    // CreateProcess receives an absolute Windows spelling.  Pin its complete
    // lexical ancestor chain for the same lifetime as the descendant tree;
    // retaining only the generation root leaves an ancestor rename/replacement
    // able to redirect the child before it reaches that root handle.
    lexicalBoundary = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(root.path, `${label} lexical boundary`),
      14,
      `${label} lexical boundary`
    );
    lexicalBoundary.assertCurrent();
    const lexicalRoot = inspectNoFollowDirectoryChain(
      root.path,
      `${label} lexical boundary readback`
    ).target;
    if (!sameIdentity(root, lexicalRoot)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} lexical root changed before retention.`);
    }
    const rootIdentity = windowsIdentity(rootHandle, root.path, `${label} root`);
    if (!sameIdentity(root, rootIdentity)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} root identity changed.`);
    }
    directoryHandles.set('', Object.freeze({ handle: rootHandle, identity: root }));
    const ordered = [...canonicalInventory].sort((left, right) => {
      const depth = left.relativePath.split('/').length - right.relativePath.split('/').length;
      if (depth !== 0) return depth;
      if (left.kind === 'directory' && right.kind !== 'directory') return -1;
      if (right.kind === 'directory' && left.kind !== 'directory') return 1;
      return left.relativePath.localeCompare(right.relativePath);
    });
    for (const entry of ordered) {
      const parts = entry.relativePath.split('/');
      const name = parts.pop()!;
      const parentRelativePath = parts.join('/');
      const parent = directoryHandles.get(parentRelativePath);
      if (parent === undefined) {
        throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} inventory has no retained parent.`);
      }
      const absolutePath = path.join(root.path, ...entry.relativePath.split('/'));
      let handle: bigint;
      if (entry.kind === 'directory') {
        const opened = windowsOpenRelativeDirectory(
          parent.handle,
          parent.identity,
          name,
          absolutePath,
          WINDOWS_FILE_OPEN,
          `${label} directory ${entry.relativePath}`,
          WINDOWS_SHARE_READ,
          true
        );
        if (opened === null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} directory disappeared.`);
        }
        handle = opened;
        pendingEntryHandle = handle;
        const identity = windowsIdentity(handle, absolutePath, `${label} directory ${entry.relativePath}`);
        if (identity.device !== entry.device || identity.inode !== entry.inode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} directory identity changed.`);
        }
        directoryHandles.set(entry.relativePath, Object.freeze({ handle, identity }));
      } else if (entry.kind === 'file') {
        const opened = windowsOpenRelativeLeaf(
          parent.handle,
          parent.identity,
          name,
          absolutePath,
          WINDOWS_GENERIC_READ,
          WINDOWS_FILE_OPEN,
          `${label} file ${entry.relativePath}`,
          false,
          WINDOWS_SHARE_READ,
          false,
          true
        );
        if (opened === null) {
          throw physicalError('PHYSICAL_NO_FOLLOW_ABSENT', `${label} file disappeared.`);
        }
        handle = opened;
        pendingEntryHandle = handle;
        const identity = windowsRetainedLeafIdentity(handle, absolutePath, 'file', `${label} file ${entry.relativePath}`);
        windowsRewindRetainedFile(handle, `${label} file ${entry.relativePath}`);
        const digest = digestWindowsRetainedFile(handle, absolutePath, identity, `${label} file ${entry.relativePath}`);
        if (identity.device !== entry.device || identity.inode !== entry.inode || digest.size !== entry.size
            || digest.contentDigest !== entry.contentDigest) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} file generation changed.`);
        }
      } else {
        handle = windowsOpenRelativeNoFollowEntry(
          parent.handle,
          parent.identity,
          name,
          absolutePath,
          'link',
          `${label} link ${entry.relativePath}`,
          WINDOWS_SHARE_READ,
          true
        );
        pendingEntryHandle = handle;
        const identity = windowsRetainedLeafIdentity(handle, absolutePath, 'link', `${label} link ${entry.relativePath}`);
        const observed = windowsRetainedReparseObservation(handle, `${label} link ${entry.relativePath}`);
        if (identity.device !== entry.device || identity.inode !== entry.inode || observed.size !== entry.size
            || observed.linkTarget !== entry.linkTarget) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} link generation changed.`);
        }
      }
      retainedEntries.push(Object.freeze({ absolutePath, entry, handle }));
      pendingEntryHandle = null;
    }
    const sealedReadback = scanNoFollowDirectoryTreeInventory(root, {
      deadlineAtMs: performance.now() + 30_000,
      maximumEntries: Math.max(1, canonicalInventory.length + 1),
      maximumBytes: canonicalInventory.reduce((total, entry) => total + (entry.kind === 'file' ? entry.size : 0), 0)
    });
    if (JSON.stringify(sealedReadback) !== JSON.stringify(canonicalInventory)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} inventory changed during retention.`);
    }
    const assertCurrent = (): void => {
      if (disposed) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} capability is disposed.`);
      }
      if (!sameIdentity(root, windowsIdentity(rootHandle, root.path, `${label} root`))) {
        throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} root identity changed.`);
      }
      lexicalBoundary?.assertCurrent();
      for (const retained of retainedEntries) {
        const identity = windowsRetainedLeafIdentity(
          retained.handle,
          retained.absolutePath,
          retained.entry.kind,
          `${label} ${retained.entry.relativePath}`
        );
        if (identity.device !== retained.entry.device || identity.inode !== retained.entry.inode) {
          throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained entry identity changed.`);
        }
        if (retained.entry.kind === 'link') {
          const observed = windowsRetainedReparseObservation(
            retained.handle,
            `${label} ${retained.entry.relativePath}`
          );
          if (observed.size !== retained.entry.size || observed.linkTarget !== retained.entry.linkTarget) {
            throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} retained link changed.`);
          }
        }
      }
    };
    assertCurrent();
    const capability = Object.freeze({
      childPath: lexicalBoundary.childPath,
      stdioSourceDescriptor: null,
      root,
      inventory: canonicalInventory,
      assertCurrent,
      assertAuthorityCurrent: async () => {
        await readOnlyAuthority.assertCurrent();
        assertCurrent();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const failures: unknown[] = [];
        const handleCloseError = closeWindowsHandlesBestEffort([
          ...retainedEntries.reverse().map(({ handle }) => handle),
          rootHandle
        ], label);
        if (handleCloseError !== null) failures.push(handleCloseError);
        try { lexicalBoundary?.dispose(); } catch (error) { failures.push(error); }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, `${label} disposal failed.`);
        }
      },
      retire: async () => {
        const failures: unknown[] = [];
        try { if (!disposed) capability.dispose(); } catch (error) { failures.push(error); }
        try { await readOnlyAuthority.release(); } catch (error) { failures.push(error); }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
          throw new AggregateError(failures, `${label} retirement cleanup failed.`);
        }
      }
    });
    await readOnlyAuthority.assertCurrent();
    const issued = issueRetainedNoFollowCapability(capability, 'working-directory');
    registerRetainedNoFollowSealedDirectoryGeneration(issued);
    return issued;
  } catch (error) {
    closeWindowsHandlesBestEffort([
      ...(pendingEntryHandle === null ? [] : [pendingEntryHandle]),
      ...retainedEntries.reverse().map(({ handle }) => handle),
      rootHandle
    ], label);
    try { lexicalBoundary?.dispose(); } catch { /* retain the primary admission failure */ }
    try { await readOnlyAuthority.release(); } catch { /* typed ACL residue remains */ }
    throw error;
  }
}
