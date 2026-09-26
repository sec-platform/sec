import { dlopen, FFIType, ptr, read } from 'bun:ffi';
import { randomUUID } from 'node:crypto';
import { closeSync, fchmodSync, fstatSync, fsyncSync, readSync, writeSync } from 'node:fs';
import path from 'node:path';

import { createSha256Hasher } from '../../../../contracts/digest.ts';
import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  PhysicalNoFollowError,
  retainNoFollowDirectoryForChildProcess,
  scanNoFollowDirectoryDirectMetadata,
  type PhysicalDirectoryIdentity
} from './physical-no-follow.ts';

export type SourceReplacementPhase =
  | 'temp-write' | 'attribute-apply' | 'atomic-replace' | 'directory-sync' | 'post-readback';

export interface SourceReplacementTestActor {
  readonly beforeReplace?: (event: Readonly<{ sourcePath: string; targetPath: string }>) => void | Promise<void>;
  readonly afterReplace?: (event: Readonly<{ sourcePath: string; targetPath: string }>) => void | Promise<void>;
  readonly beforeCleanup?: (event: Readonly<{ sourcePath: string }>) => void | Promise<void>;
}

const actors = new WeakSet<object>();
export function createSourceReplacementTestActorForTests(actor: SourceReplacementTestActor): SourceReplacementTestActor {
  const issued = Object.freeze({ ...actor });
  actors.add(issued);
  return issued;
}

/** A failed namespace transition is not permission to overwrite either slot again. */
export class SourceReplacementFailure extends Error {
  constructor(
    readonly phase: SourceReplacementPhase,
    readonly namespaceChanged: boolean,
    readonly temporaryName: string,
    cause: unknown
  ) {
    super('Retained source replacement did not settle', { cause });
    this.name = 'SourceReplacementFailure';
  }
}

/** Unexplained native slots survive restart and block byte-only success. */
export class SourceReplacementResidueError extends PhysicalNoFollowError {
  constructor() {
    super('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Source replacement has unsettled physical residue');
    this.name = 'SourceReplacementResidueError';
  }
}

export function assertNoSourceReplacementResidue(root: PhysicalDirectoryIdentity): void {
  const entries = scanNoFollowDirectoryDirectMetadata(root, {
    deadlineAtMs: performance.now() + 5_000,
    maximumEntries: 256
  });
  // Include malformed and legacy spellings. A matching name is a reason to
  // preserve and refuse, never authority to read a link target or delete it.
  if (entries.some(({ relativePath }) => {
    const name = process.platform === 'win32' ? relativePath.toLocaleLowerCase('en-US') : relativePath;
    return name.startsWith('.publish-') || name.startsWith('.restore-');
  })) throw new SourceReplacementResidueError();
}

interface SourceReplacementInput {
  readonly sourceParent: PhysicalDirectoryIdentity;
  readonly targetParent: PhysicalDirectoryIdentity;
  readonly targetName: string;
  readonly expectedBytes: Uint8Array;
  readonly bytes: Uint8Array;
  readonly expectedMode: number;
  readonly expectedWindowsAttributes: number | null;
  readonly direction: 'publish' | 'restore';
  readonly commitFence: () => void | Promise<void>;
  readonly testOnlyActor?: SourceReplacementTestActor;
}

const MAXIMUM_BYTES = 64 * 1024 * 1024;
const WINDOWS_ATTRIBUTES = 0x27;
const INVALID_WINDOWS_HANDLE = 0xffffffffffffffffn;

function fail(message: string, code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' |
  'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' | 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED' |
  'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE' = 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'): never {
  throw new PhysicalNoFollowError(code, message);
}

function leafName(value: string): string {
  if (!value || value.length > 255 || value === '.' || value === '..' || /[\\/\0]/u.test(value) ||
      (process.platform === 'win32' && (/[:<>"|?*]/u.test(value) || /[ .]$/u.test(value) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value)))) {
    fail('Source replacement requires one ordinary canonical leaf', 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
  }
  return value;
}

function digest(bytes: Uint8Array): string {
  return rawSha256Hex(bytes);
}

type Snapshot = Readonly<{
  device: string;
  inode: string;
  size: number;
  mode: number | null;
  attributes: number | null;
  fingerprint: string;
  digest: string;
}>;

type NativeFile = number | bigint;
interface Backend {
  openTarget(): NativeFile;
  openTemporary(): NativeFile;
  createCandidate(): NativeFile;
  inspect(file: NativeFile): Snapshot;
  assertName(file: NativeFile, atTarget: boolean): void;
  write(file: NativeFile, bytes: Uint8Array): void;
  applyPermissions(file: NativeFile, source: NativeFile): void;
  flushFile(file: NativeFile): void;
  replace(candidate: NativeFile): void;
  flushParents(): void;
  removeTemporary(file: NativeFile): void;
  closeAll(): readonly unknown[];
}

/**
 * One existing-source replacement, under the caller's serialized write lease.
 * Native effects address retained parent/leaf objects, never caller paths.
 * Linux exchange keeps the displaced preimage until it is checked; a foreign
 * preimage is preserved rather than unlinked or blindly exchanged back. This
 * is not a kernel compare-and-swap against arbitrary non-cooperating writers.
 * The mutation journal owns crash recovery; this owner never invents a second
 * recovery protocol or removes unexplained post-transition residue.
 */
export async function replaceRetainedNoFollowSourceFile(input: SourceReplacementInput): Promise<void> {
  const targetName = leafName(input.targetName);
  const mode = input.expectedMode;
  const attributes = input.expectedWindowsAttributes;
  const direction = input.direction;
  const commitFence = input.commitFence;
  const actor = input.testOnlyActor;
  if ((direction !== 'publish' && direction !== 'restore') || typeof commitFence !== 'function' ||
      !Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777 ||
      (attributes !== null && (!Number.isSafeInteger(attributes) || attributes < 0 || (attributes & ~WINDOWS_ATTRIBUTES) !== 0)) ||
      (actor !== undefined && !actors.has(actor))) {
    fail('Source replacement input or test actor is invalid', 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
  }
  if (input.expectedBytes.byteLength > MAXIMUM_BYTES || input.bytes.byteLength > MAXIMUM_BYTES) {
    fail('Source replacement byte bound exceeded', 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
  }
  const beforeBytes = Buffer.from(input.expectedBytes);
  const bytes = Buffer.from(input.bytes);
  const expectedDigest = digest(beforeBytes);
  const nextDigest = digest(bytes);
  const sourceChain = assertSameNoFollowDirectoryIdentity(input.sourceParent, 'Source replacement transaction');
  const targetChain = assertSameNoFollowDirectoryIdentity(input.targetParent, 'Source replacement target parent');
  if (sourceChain.target.device !== targetChain.target.device) {
    fail('Source replacement requires one filesystem device', 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
  }
  const temporaryName = `.${direction}-${randomUUID()}.tmp`;
  const event = Object.freeze({
    sourcePath: path.join(sourceChain.target.path, temporaryName),
    targetPath: path.join(targetChain.target.path, targetName)
  });
  const deadline = performance.now() + 30_000;
  let recoveryDeadline: number | undefined;
  const budget = (): void => {
    if (performance.now() >= (recoveryDeadline ?? deadline)) fail('Source replacement deadline exceeded', 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
  };
  let phase: SourceReplacementPhase = 'temp-write';
  let changed = false;
  let candidate: NativeFile | undefined;
  let backend: Backend | undefined;
  let sourceBoundary: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let targetBoundary: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  const failures: unknown[] = [];
  const fence = async (): Promise<void> => {
    budget();
    await commitFence();
    budget();
    sourceBoundary?.assertCurrent();
    targetBoundary?.assertCurrent();
    assertSameNoFollowDirectoryIdentity(sourceChain.target, 'Source replacement transaction');
    assertSameNoFollowDirectoryIdentity(targetChain.target, 'Source replacement target parent');
  };
  try {
    await fence();
    sourceBoundary = retainNoFollowDirectoryForChildProcess(sourceChain, 4, 'Source replacement transaction');
    targetBoundary = retainNoFollowDirectoryForChildProcess(targetChain, 5, 'Source replacement target parent');
    backend = process.platform === 'linux'
      ? linuxBackend(sourceBoundary.stdioSourceDescriptor!, targetBoundary.stdioSourceDescriptor!, temporaryName, targetName, budget)
      : process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64')
        ? windowsBackend(sourceChain.target, targetChain.target, temporaryName, targetName, budget)
        : fail('Source replacement native backend is unavailable', 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
    assertNoSourceReplacementResidue(sourceChain.target);
    const preimage = backend.openTarget();
    const original = backend.inspect(preimage);
    const matches = (value: Snapshot, expected: string, size: number): boolean =>
      value.digest === expected && value.size === size &&
      (process.platform === 'linux' ? value.mode === mode && attributes === null : value.attributes === attributes);
    if (!matches(original, expectedDigest, beforeBytes.length)) fail('Source replacement CAS preimage differs');
    candidate = backend.createCandidate();
    backend.write(candidate, bytes);
    phase = 'attribute-apply';
    backend.applyPermissions(candidate, preimage);
    backend.flushFile(candidate);
    const prepared = backend.inspect(candidate);
    if (!matches(prepared, nextDigest, bytes.length)) fail('Source replacement prepared bytes or permissions differ');
    backend.flushParents();
    phase = 'atomic-replace';
    await fence();
    await actor?.beforeReplace?.(event);
    await fence();
    const lastOriginal = backend.inspect(preimage);
    const lastCandidate = backend.inspect(candidate);
    if (lastOriginal.fingerprint !== original.fingerprint || !matches(lastOriginal, expectedDigest, beforeBytes.length) ||
        lastCandidate.fingerprint !== prepared.fingerprint || !matches(lastCandidate, nextDigest, bytes.length)) {
      fail('Source replacement retained preimage changed before effect');
    }
    backend.assertName(preimage, true);
    backend.assertName(candidate, false);
    budget();
    backend.replace(candidate);
    changed = true;
    await actor?.afterReplace?.(event);
    await fence();
    phase = 'post-readback';
    backend.assertName(candidate, true);
    if (!matches(backend.inspect(candidate), nextDigest, bytes.length)) fail('Source replacement final bytes or permissions differ');
    if (process.platform === 'linux') {
      backend.assertName(preimage, false);
      if (!matches(backend.inspect(preimage), expectedDigest, beforeBytes.length)) fail('Source replacement displaced preimage differs');
    }
    phase = 'directory-sync';
    backend.flushFile(candidate);
    backend.flushParents();
    if (process.platform === 'linux') {
      await actor?.beforeCleanup?.(event);
      await fence();
      backend.assertName(preimage, false);
      backend.assertName(candidate, true);
      if (!matches(backend.inspect(preimage), expectedDigest, beforeBytes.length) ||
          !matches(backend.inspect(candidate), nextDigest, bytes.length)) fail('Source replacement changed before displaced-preimage cleanup');
      backend.removeTemporary(preimage);
      backend.flushParents();
    }
    phase = 'post-readback';
    await fence();
    backend.assertName(candidate, true);
    if (!matches(backend.inspect(candidate), nextDigest, bytes.length)) fail('Source replacement settled readback differs');
  } catch (error) {
    failures.push(error);
    // After a namespace transition, recovery belongs to the journal. Before
    // it, retire only the exact created object, never a replacement at its name.
    if (!changed && candidate !== undefined && backend !== undefined) {
      recoveryDeadline = performance.now() + 30_000;
      try {
        await actor?.beforeCleanup?.(event);
        await fence();
        backend.assertName(candidate, false);
        backend.removeTemporary(candidate);
        backend.flushParents();
      } catch (cleanupError) { failures.push(cleanupError); }
    }
  } finally {
    if (backend !== undefined) failures.push(...backend.closeAll());
    for (const boundary of [targetBoundary, sourceBoundary]) {
      try { boundary?.dispose(); } catch (error) { failures.push(error); }
    }
  }
  if (failures.length > 0) throw new SourceReplacementFailure(
    phase, changed, temporaryName,
    failures.length === 1 ? failures[0] : new AggregateError(failures, 'Source replacement and settlement failed')
  );
}


const SOURCE_REPLACEMENT_RESIDUE_NAME =
  /^\.(?:publish|restore)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/u;

export type SourceReplacementResidueSettlement =
  | Readonly<{ status: 'clean' }>
  | Readonly<{ status: 'settled'; liveGeneration: 'original' | 'staged' }>;

export async function settleRetainedNoFollowSourceReplacementResidue(input: Readonly<{
  sourceParent: PhysicalDirectoryIdentity;
  targetParent: PhysicalDirectoryIdentity;
  targetName: string;
  originalBytes: Uint8Array;
  stagedBytes: Uint8Array;
  expectedMode: number;
  expectedWindowsAttributes: number | null;
  commitFence: () => void | Promise<void>;
}>): Promise<SourceReplacementResidueSettlement> {
  const targetName = leafName(input.targetName);
  const mode = input.expectedMode;
  const attributes = input.expectedWindowsAttributes;
  if (typeof input.commitFence !== 'function' ||
      !Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777 ||
      (attributes !== null && (!Number.isSafeInteger(attributes) || attributes < 0 ||
        (attributes & ~WINDOWS_ATTRIBUTES) !== 0)) ||
      input.originalBytes.byteLength > MAXIMUM_BYTES ||
      input.stagedBytes.byteLength > MAXIMUM_BYTES) {
    fail('Source replacement residue settlement input is invalid',
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
  }
  const originalBytes = Buffer.from(input.originalBytes);
  const stagedBytes = Buffer.from(input.stagedBytes);
  const originalDigest = digest(originalBytes);
  const stagedDigest = digest(stagedBytes);
  const sourceChain = assertSameNoFollowDirectoryIdentity(
    input.sourceParent, 'Source replacement recovery transaction'
  );
  const targetChain = assertSameNoFollowDirectoryIdentity(
    input.targetParent, 'Source replacement recovery target parent'
  );
  if (sourceChain.target.device !== targetChain.target.device) {
    fail('Source replacement residue settlement requires one filesystem device',
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
  }
  const candidates = scanNoFollowDirectoryDirectMetadata(sourceChain.target, {
    deadlineAtMs: performance.now() + 5_000,
    maximumEntries: 256
  }).filter(({ relativePath }) => {
    const normalized = process.platform === 'win32'
      ? relativePath.toLocaleLowerCase('en-US')
      : relativePath;
    return normalized.startsWith('.publish-') || normalized.startsWith('.restore-');
  });
  if (candidates.length === 0) return Object.freeze({ status: 'clean' as const });
  if (candidates.length !== 1 || !SOURCE_REPLACEMENT_RESIDUE_NAME.test(candidates[0]!.relativePath)) {
    throw new SourceReplacementResidueError();
  }

  const sourceName = candidates[0]!.relativePath;
  const deadline = performance.now() + 30_000;
  const budget = (): void => {
    if (performance.now() >= deadline) {
      fail('Source replacement residue settlement deadline exceeded',
        'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
    }
  };
  let backend: Backend | undefined;
  let sourceBoundary: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let targetBoundary: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let target: NativeFile | undefined;
  let residue: NativeFile | undefined;
  const failures: unknown[] = [];
  const fence = async (): Promise<void> => {
    budget();
    await input.commitFence();
    budget();
    sourceBoundary?.assertCurrent();
    targetBoundary?.assertCurrent();
    assertSameNoFollowDirectoryIdentity(
      sourceChain.target, 'Source replacement recovery transaction'
    );
    assertSameNoFollowDirectoryIdentity(
      targetChain.target, 'Source replacement recovery target parent'
    );
  };
  const matches = (value: Snapshot, expectedDigest: string, size: number): boolean =>
    value.digest === expectedDigest && value.size === size &&
    (process.platform === 'linux'
      ? value.mode === mode && attributes === null
      : value.attributes === attributes);

  let liveGeneration: 'original' | 'staged' | undefined;
  try {
    await fence();
    sourceBoundary = retainNoFollowDirectoryForChildProcess(
      sourceChain, 4, 'Source replacement recovery transaction'
    );
    targetBoundary = retainNoFollowDirectoryForChildProcess(
      targetChain, 5, 'Source replacement recovery target parent'
    );
    backend = process.platform === 'linux'
      ? linuxBackend(
          sourceBoundary.stdioSourceDescriptor!,
          targetBoundary.stdioSourceDescriptor!,
          sourceName,
          targetName,
          budget
        )
      : process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64')
        ? windowsBackend(sourceChain.target, targetChain.target, sourceName, targetName, budget)
        : fail('Source replacement residue native backend is unavailable',
            'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
    target = backend.openTarget();
    residue = backend.openTemporary();
    const targetSnapshot = backend.inspect(target);
    const residueSnapshot = backend.inspect(residue);
    const targetOriginal = matches(targetSnapshot, originalDigest, originalBytes.length);
    const targetStaged = matches(targetSnapshot, stagedDigest, stagedBytes.length);
    const residueOriginal = matches(residueSnapshot, originalDigest, originalBytes.length);
    const residueStaged = matches(residueSnapshot, stagedDigest, stagedBytes.length);
    if (targetOriginal === targetStaged ||
        !((targetOriginal && residueStaged) || (targetStaged && residueOriginal))) {
      throw new SourceReplacementResidueError();
    }
    liveGeneration = targetOriginal ? 'original' : 'staged';
    await fence();
    backend.assertName(target, true);
    backend.assertName(residue, false);
    const targetBeforeCleanup = backend.inspect(target);
    const residueBeforeCleanup = backend.inspect(residue);
    if (liveGeneration === 'original'
      ? !matches(targetBeforeCleanup, originalDigest, originalBytes.length) ||
        !matches(residueBeforeCleanup, stagedDigest, stagedBytes.length)
      : !matches(targetBeforeCleanup, stagedDigest, stagedBytes.length) ||
        !matches(residueBeforeCleanup, originalDigest, originalBytes.length)) {
      throw new SourceReplacementResidueError();
    }
    backend.removeTemporary(residue);
    backend.flushParents();
    await fence();
    backend.assertName(target, true);
    const targetAfterCleanup = backend.inspect(target);
    if (liveGeneration === 'original'
      ? !matches(targetAfterCleanup, originalDigest, originalBytes.length)
      : !matches(targetAfterCleanup, stagedDigest, stagedBytes.length)) {
      throw new SourceReplacementResidueError();
    }
  } catch (error) {
    failures.push(error);
  } finally {
    if (backend !== undefined) failures.push(...backend.closeAll());
    for (const boundary of [targetBoundary, sourceBoundary]) {
      try { boundary?.dispose(); } catch (error) { failures.push(error); }
    }
  }
  if (failures.length > 0) {
    throw failures.length === 1
      ? failures[0]
      : new AggregateError(failures, 'Source replacement residue settlement failed');
  }
  return Object.freeze({ status: 'settled' as const, liveGeneration: liveGeneration! });
}

function linuxBackend(sourceParent: number, targetParent: number, sourceName: string, targetName: string, budget: () => void): Backend {
  const libc = dlopen('libc.so.6', {
    openat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.u32], returns: FFIType.i32 },
    renameat2: { args: [FFIType.i32, FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    unlinkat: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    __errno_location: { args: [], returns: FFIType.ptr }
  } as const);
  const files = new Set<number>();
  const c = (name: string): Buffer => Buffer.from(`${name}\0`, 'utf8');
  const open = (parent: number, name: string, create = false): number => {
    budget();
    const fd = libc.symbols.openat(parent, c(name), 0x20000 | 0x80000 | 0x800 | (create ? 2 | 0x40 | 0x80 : 0), 0o600);
    if (fd < 0) fail(`Source replacement relative open failed (errno ${read.i32(libc.symbols.__errno_location() as never)})`, 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
    files.add(fd);
    return fd;
  };
  const close = (fd: number): void => { files.delete(fd); closeSync(fd); };
  const physical = (file: NativeFile) => {
    const stat = fstatSync(file as number, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size < 0n || stat.size > BigInt(MAXIMUM_BYTES)) {
      fail('Source replacement leaf must be a bounded unaliased ordinary file');
    }
    return stat;
  };
  const fingerprint = (s: ReturnType<typeof physical>): string =>
    [s.dev, s.ino, s.size, s.mode, s.nlink, s.uid, s.gid, s.mtimeNs, s.ctimeNs].join(':');
  const assertName = (file: NativeFile, atTarget: boolean): void => {
    const observed = open(atTarget ? targetParent : sourceParent, atTarget ? targetName : sourceName);
    try {
      const expected = physical(file);
      const actual = physical(observed);
      if (expected.dev !== actual.dev || expected.ino !== actual.ino) fail('Source replacement namespace identity changed');
    } finally { close(observed); }
  };
  return {
    openTarget: () => open(targetParent, targetName),
    openTemporary: () => open(sourceParent, sourceName),
    createCandidate: () => open(sourceParent, sourceName, true),
    inspect(file) {
      const before = physical(file);
      const hash = createSha256Hasher();
      const chunk = Buffer.alloc(64 * 1024);
      let offset = 0;
      while (offset < Number(before.size)) {
        budget();
        const count = readSync(file as number, chunk, 0, Math.min(chunk.length, Number(before.size) - offset), offset);
        if (count <= 0) fail('Source replacement retained read ended early');
        hash.update(chunk.subarray(0, count)); offset += count;
      }
      const after = physical(file);
      if (fingerprint(before) !== fingerprint(after)) fail('Source replacement retained read changed');
      return { device: String(before.dev), inode: String(before.ino), size: Number(before.size), mode: Number(before.mode & 0o7777n), attributes: null, fingerprint: fingerprint(after), digest: hash.finish().slice('sha256:'.length) };
    },
    assertName,
    write(file, bytes) {
      let offset = 0;
      while (offset < bytes.length) {
        budget();
        const count = writeSync(file as number, bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
        if (count <= 0) fail('Source replacement retained write made no progress', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
        offset += count;
      }
    },
    applyPermissions(file, source) {
      const original = physical(source);
      const candidate = physical(file);
      const mode = Number(original.mode & 0o7777n);
      if ((mode & 0o7000) !== 0 && (typeof process.geteuid !== 'function' || original.uid !== BigInt(process.geteuid()) ||
          candidate.uid !== original.uid || candidate.gid !== original.gid)) {
        fail('Source replacement special mode requires matching effective owner and group', 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
      }
      fchmodSync(file as number, mode);
    },
    flushFile: (file) => fsyncSync(file as number),
    replace() {
      if (libc.symbols.renameat2(sourceParent, c(sourceName), targetParent, c(targetName), 2) !== 0) {
        fail('Source replacement atomic exchange failed', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
      }
    },
    flushParents() { fsyncSync(targetParent); if (sourceParent !== targetParent) fsyncSync(sourceParent); },
    removeTemporary(file) {
      assertName(file, false);
      if (libc.symbols.unlinkat(sourceParent, c(sourceName), 0) !== 0) fail('Source replacement temporary unlink failed', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
      const current = libc.symbols.openat(sourceParent, c(sourceName), 0x200000 | 0x20000 | 0x80000, 0);
      if (current >= 0) { files.add(current); fail('Source replacement temporary name remains'); }
      if (read.i32(libc.symbols.__errno_location() as never) !== 2) fail('Source replacement absence could not be established', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
    },
    closeAll() {
      const errors: unknown[] = [];
      for (const fd of files) { try { closeSync(fd); } catch (error) { errors.push(error); } }
      files.clear();
      try { libc.close(); } catch (error) { errors.push(error); }
      return errors;
    }
  };
}

function windowsBackend(sourceParent: PhysicalDirectoryIdentity, targetParent: PhysicalDirectoryIdentity, sourceName: string, targetName: string, budget: () => void): Backend {
  const kernel = dlopen('kernel32.dll', {
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.u64 },
    GetFileInformationByHandleEx: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    SetFileInformationByHandle: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    ReadFile: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    WriteFile: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    SetFilePointerEx: { args: [FFIType.u64, FFIType.i64, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    FlushFileBuffers: { args: [FFIType.u64], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
  } as const);
  let native: ReturnType<typeof openNative>;
  function openNative() {
    return dlopen('ntdll.dll', {
      NtCreateFile: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      NtSetInformationFile: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32], returns: FFIType.i32 }
    } as const);
  }
  try { native = openNative(); } catch (error) { kernel.close(); throw error; }
  const handles = new Set<bigint>();
  const close = (handle: bigint): void => {
    handles.delete(handle);
    if (kernel.symbols.CloseHandle(handle) === 0) fail('Source replacement CloseHandle failed', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
  };
  const closeAll = (): readonly unknown[] => {
    const errors: unknown[] = [];
    for (const handle of [...handles].reverse()) { try { close(handle); } catch (error) { errors.push(error); } }
    try { native.close(); } catch (error) { errors.push(error); }
    try { kernel.close(); } catch (error) { errors.push(error); }
    return errors;
  };
  const metadata = (file: NativeFile, directory = false) => {
    const handle = file as bigint;
    const id = Buffer.alloc(24), basic = Buffer.alloc(40), standard = Buffer.alloc(24);
    if (kernel.symbols.GetFileInformationByHandleEx(handle, 18, id, 24) === 0 ||
        kernel.symbols.GetFileInformationByHandleEx(handle, 0, basic, 40) === 0 ||
        kernel.symbols.GetFileInformationByHandleEx(handle, 1, standard, 24) === 0) fail('Source replacement retained metadata unavailable');
    const attributes = basic.readUInt32LE(32), size = standard.readBigInt64LE(8);
    if ((attributes & 0x400) !== 0 || ((attributes & 0x10) !== 0) !== directory ||
        (!directory && (standard.readUInt32LE(16) !== 1 || size < 0n || size > BigInt(MAXIMUM_BYTES)))) {
      fail('Source replacement requires an unaliased ordinary retained object');
    }
    return { device: id.subarray(0, 8).toString('hex'), inode: id.subarray(8).toString('hex'), size: Number(size), attributes,
      fingerprint: Buffer.concat([id, basic.subarray(0, 8), basic.subarray(16), standard]).toString('hex') };
  };
  const openParent = (parent: PhysicalDirectoryIdentity): bigint => {
    const handle = kernel.symbols.CreateFileW(Buffer.from(`${path.toNamespacedPath(parent.path)}\0`, 'utf16le'),
      0x00100080, 7, null, 3, 0x02200000, null);
    if (handle === INVALID_WINDOWS_HANDLE) fail('Source replacement parent could not be retained');
    handles.add(handle);
    const observed = metadata(handle, true);
    if (observed.device !== parent.device || observed.inode !== parent.inode) fail('Source replacement parent identity differs');
    return handle;
  };
  let from: bigint, to: bigint;
  try { from = openParent(sourceParent); to = openParent(targetParent); }
  catch (error) {
    const errors = closeAll();
    if (errors.length > 0) throw new AggregateError([error, ...errors], 'Source replacement admission and close failed');
    throw error;
  }
  const openLeaf = (
    parent: bigint,
    name: string,
    create = false,
    probe = false,
    deleteAccess = false
  ): bigint | null => {
    budget();
    const text = Buffer.from(`${name}\0`, 'utf16le');
    const unicode = Buffer.alloc(16), object = Buffer.alloc(48), output = Buffer.alloc(8), io = Buffer.alloc(16);
    unicode.writeUInt16LE(text.length - 2, 0); unicode.writeUInt16LE(text.length, 2); unicode.writeBigUInt64LE(BigInt(ptr(text)), 8);
    object.writeUInt32LE(48, 0); object.writeBigUInt64LE(parent, 8); object.writeBigUInt64LE(BigInt(ptr(unicode)), 16);
    const status = native.symbols.NtCreateFile(output,
      create ? 0x00110183 : deleteAccess ? 0x00110081 : 0x00100081,
      object, io, null, 0x80,
      create || deleteAccess ? 1 : probe ? 7 : 5,
      create ? 2 : 1, 0x00200060, null, 0);
    if (status < 0) {
      if (probe && (status === -1073741772 || status === -1073741766 || status === -1073741738)) return null;
      fail(`Source replacement relative NtCreateFile failed (NTSTATUS ${status})`, 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
    }
    const handle = output.readBigUInt64LE(0);
    if (handle === 0n || handle === INVALID_WINDOWS_HANDLE) fail('Source replacement relative open returned no handle');
    handles.add(handle);
    return handle;
  };
  const rewind = (handle: bigint): void => {
    if (kernel.symbols.SetFilePointerEx(handle, 0n, null, 0) === 0) fail('Source replacement retained rewind failed');
  };
  const assertName = (file: NativeFile, atTarget: boolean): void => {
    const current = openLeaf(atTarget ? to : from, atTarget ? targetName : sourceName, false, true);
    if (current === null) fail('Source replacement current name is absent');
    try {
      const expected = metadata(file), observed = metadata(current);
      if (expected.device !== observed.device || expected.inode !== observed.inode) fail('Source replacement namespace identity changed');
    } finally { close(current); }
  };
  return {
    openTarget: () => openLeaf(to, targetName)!,
    openTemporary: () => openLeaf(from, sourceName, false, false, true)!,
    createCandidate: () => openLeaf(from, sourceName, true)!,
    inspect(file) {
      const before = metadata(file), hash = createSha256Hasher(), chunk = Buffer.alloc(64 * 1024), count = Buffer.alloc(4);
      rewind(file as bigint);
      let offset = 0;
      while (offset < before.size) {
        budget();
        const wanted = Math.min(chunk.length, before.size - offset);
        if (kernel.symbols.ReadFile(file as bigint, chunk, wanted, count, null) === 0) fail('Source replacement retained read failed');
        const observed = count.readUInt32LE(0);
        if (observed === 0 || observed > wanted) fail('Source replacement retained read made invalid progress');
        hash.update(chunk.subarray(0, observed)); offset += observed;
      }
      const after = metadata(file);
      if (before.fingerprint !== after.fingerprint) fail('Source replacement retained bytes changed');
      return { ...after, mode: null, attributes: after.attributes & WINDOWS_ATTRIBUTES, digest: hash.finish().slice('sha256:'.length) };
    },
    assertName,
    write(file, bytes) {
      rewind(file as bigint);
      let offset = 0;
      const written = Buffer.alloc(4);
      while (offset < bytes.length) {
        budget();
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + 64 * 1024));
        if (kernel.symbols.WriteFile(file as bigint, chunk, chunk.length, written, null) === 0 ||
            written.readUInt32LE(0) !== chunk.length) fail('Source replacement retained write failed', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
        offset += chunk.length;
      }
    },
    applyPermissions(file, source) {
      let attributes = (metadata(file).attributes & ~WINDOWS_ATTRIBUTES) | (metadata(source).attributes & WINDOWS_ATTRIBUTES);
      if ((attributes & ~0x80) !== 0) attributes &= ~0x80;
      if (attributes === 0) attributes = 0x80;
      const basic = Buffer.alloc(40); basic.writeUInt32LE(attributes >>> 0, 32);
      if (kernel.symbols.SetFileInformationByHandle(file as bigint, 0, basic, 40) === 0) fail('Source replacement retained attribute update failed', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
    },
    flushFile(file) {
      if (kernel.symbols.FlushFileBuffers(file as bigint) === 0) fail('Source replacement retained file flush failed', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
    },
    replace(file) {
      const text = Buffer.from(`${targetName}\0`, 'utf16le'), info = Buffer.alloc(24 + text.length), io = Buffer.alloc(16);
      // Native FileRenameInformationEx: replacement + POSIX visibility +
      // IGNORE_READONLY_ATTRIBUTE, without clearing the live source attribute.
      info.writeUInt32LE(0x43, 0); info.writeBigUInt64LE(to, 8); info.writeUInt32LE(text.length - 2, 16); text.copy(info, 20);
      if (native.symbols.NtSetInformationFile(file as bigint, io, info, info.length, 65) < 0) {
        fail('Source replacement native handle rename failed', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
      }
    },
    flushParents() {
      // No portable Windows directory-fsync claim. The same writable candidate
      // handle is flushed before and after rename, even after READONLY is set.
      for (const [handle, expected] of [[from, sourceParent], [to, targetParent]] as const) {
        const actual = metadata(handle, true);
        if (actual.device !== expected.device || actual.inode !== expected.inode) fail('Source replacement parent changed');
      }
    },
    removeTemporary(file) {
      assertName(file, false);
      const flags = Buffer.alloc(4); flags.writeUInt32LE(0x13, 0);
      if (kernel.symbols.SetFileInformationByHandle(file as bigint, 21, flags, 4) === 0) fail('Source replacement retained temporary disposition failed', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
      close(file as bigint);
      const current = openLeaf(from, sourceName, false, true);
      if (current !== null) { close(current); fail('Source replacement temporary name remains'); }
    },
    closeAll
  };
}
