import { fchmodSync, fstatSync, fsyncSync, readSync } from 'node:fs';
import path from 'node:path';

import { createSha256Hasher } from '../../../../contracts/digest.ts';
import {
  assertDurableCanonicalFileIdentityReceipt,
  assertRetainedNoFollowCapability,
  assertSameNoFollowDirectoryIdentity,
  PhysicalNoFollowError,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type DurableCanonicalFileIdentityReceipt,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowOrdinaryFile
} from './physical-no-follow.ts';

const WINDOWS_MUTATION_ATTRIBUTES = 0x27;
const MAXIMUM_PERMISSION_FILE_BYTES = 64 * 1024 * 1024;

function failure(message: string): never {
  throw new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', message);
}

/**
 * Copies metadata from a retained source to an owner-published replacement.
 * Permission and byte authority are separate: the replacement may contain an
 * authorized edit, but must still match its publisher-issued content/FileId
 * receipt. No DTO can manufacture either source or replacement authority.
 * The caller owns the mutation's authorization and commit fence.
 */
export async function copyRetainedNoFollowFilePermissions(input: Readonly<{
  source: RetainedNoFollowOrdinaryFile;
  target: DurableCanonicalFileIdentityReceipt;
  parent: PhysicalDirectoryIdentity;
  expectedSourceMode: number;
  expectedWindowsAttributes: number | null;
}>): Promise<void> {
  assertRetainedNoFollowCapability(input.source, 'ordinary-file', 'Permission source');
  assertDurableCanonicalFileIdentityReceipt(input.target);
  const { source, target, expectedSourceMode, expectedWindowsAttributes } = input;
  if (!Number.isSafeInteger(expectedSourceMode) || expectedSourceMode < 0 || expectedSourceMode > 0o7777 ||
      (expectedWindowsAttributes !== null && (!Number.isSafeInteger(expectedWindowsAttributes) ||
        expectedWindowsAttributes < 0 || (expectedWindowsAttributes & ~WINDOWS_MUTATION_ATTRIBUTES) !== 0))) {
    failure('Permission expectations are invalid.');
  }
  source.assertCurrent();
  const chain = assertSameNoFollowDirectoryIdentity(input.parent, 'Permission target parent');
  if (path.dirname(target.path) !== chain.target.path ||
      (source.physical.device === target.physical.device && source.physical.inode === target.physical.inode)) {
    failure('Permission copy requires a distinct replacement under its retained parent.');
  }
  const boundary = retainNoFollowDirectoryForChildProcess(chain, 5, 'Permission target parent');
  const errors: unknown[] = [];
  let retained: RetainedNoFollowOrdinaryFile | undefined;
  let successor: RetainedNoFollowOrdinaryFile | undefined;
  try {
    if (process.platform === 'linux') {
      if (expectedWindowsAttributes !== null) failure('Windows attributes are invalid on Linux.');
      retained = retainNoFollowOrdinaryFile(chain, path.basename(target.path), target.physical, 'Permission target');
      const sourceFd = source.stdioSourceDescriptor;
      const targetFd = retained.stdioSourceDescriptor;
      if (sourceFd === null || targetFd === null) failure('Permission handles are unavailable.');
      const before = fstatSync(sourceFd, { bigint: true });
      const replacement = fstatSync(targetFd, { bigint: true });
      const mode = Number(before.mode & 0o7777n);
      if (!before.isFile() || !replacement.isFile() || replacement.nlink !== 1n || mode !== expectedSourceMode ||
          replacement.size > BigInt(MAXIMUM_PERMISSION_FILE_BYTES) ||
          String(before.dev) !== source.physical.device || String(before.ino) !== source.physical.inode ||
          retained.digest().byteDigest !== target.digest) {
        failure('Permission source or replacement preimage changed.');
      }
      if ((mode & 0o7000) !== 0 && (
        typeof process.geteuid !== 'function' || before.uid !== BigInt(process.geteuid()) ||
        replacement.uid !== before.uid || replacement.gid !== before.gid
      )) {
        throw new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
          'Special permission bits require the same effective owner and group on both retained objects.');
      }
      fchmodSync(targetFd, mode);
      fsyncSync(targetFd);
      const hash = createSha256Hasher();
      const chunk = Buffer.alloc(64 * 1024);
      let offset = 0;
      while (offset < Number(replacement.size)) {
        const count = readSync(targetFd, chunk, 0, Math.min(chunk.length, Number(replacement.size) - offset), offset);
        if (count === 0) failure('Permission target bytes ended early.');
        hash.update(chunk.subarray(0, count));
        offset += count;
      }
      const after = fstatSync(targetFd, { bigint: true });
      if (!after.isFile() || after.dev !== replacement.dev || after.ino !== replacement.ino ||
          after.nlink !== 1n || after.uid !== replacement.uid || after.gid !== replacement.gid ||
          after.size !== replacement.size || after.mtimeNs !== replacement.mtimeNs ||
          Number(after.mode & 0o7777n) !== mode || hash.finish() !== target.digest) {
        failure('Retained permission or byte readback differs.');
      }
    } else if (process.platform === 'win32' && (process.arch === 'x64' || process.arch === 'arm64')) {
      if (expectedWindowsAttributes === null) failure('Windows permission expectations are missing.');
      await copyWindowsPermissions(source, target, expectedWindowsAttributes);
    } else {
      throw new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
        'Retained file permission backend is unavailable.');
    }
    source.assertCurrent();
    boundary.assertCurrent();
    const readbackChain = assertSameNoFollowDirectoryIdentity(chain.target, 'Permission target parent readback');
    successor = retainNoFollowOrdinaryFile(readbackChain, path.basename(target.path), target.physical, 'Permission target readback');
    if (successor.size > MAXIMUM_PERMISSION_FILE_BYTES || successor.linkCount !== 1 || successor.digest().byteDigest !== target.digest) {
      failure('Permission target namespace or content readback differs.');
    }
  } catch (error) {
    errors.push(error);
  } finally {
    // A successful mode update intentionally invalidates retained's earlier
    // metadata snapshot. Dispose it; never pretend that snapshot is current.
    try { successor?.dispose(); } catch (error) { errors.push(error); }
    try { retained?.dispose(); } catch (error) { errors.push(error); }
    try { boundary.dispose(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Retained permission operation and settlement failed.');
}

async function copyWindowsPermissions(
  source: RetainedNoFollowOrdinaryFile,
  target: DurableCanonicalFileIdentityReceipt,
  expectedAttributes: number
): Promise<void> {
  const { dlopen, FFIType } = await import('bun:ffi');
  source.assertCurrent();
  const library = dlopen('kernel32.dll', {
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.u64 },
    GetFileInformationByHandleEx: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    SetFileInformationByHandle: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    ReadFile: { args: [FFIType.u64, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    FlushFileBuffers: { args: [FFIType.u64], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
  } as const);
  const handles: bigint[] = [];
  const errors: unknown[] = [];
  try {
    const open = (filePath: string, writable: boolean): bigint => {
      const handle = library.symbols.CreateFileW(
        Buffer.from(`${path.toNamespacedPath(filePath)}\0`, 'utf16le'),
        // Obtain data write before setting READONLY so the same retained
        // handle can flush metadata afterwards. The source is read-only.
        writable ? 0xc0000180 : 0x80, writable ? 1 : 7, null, 3, 0x00200000, null
      );
      if (handle === 0xffffffffffffffffn) failure('Retained permission handle could not be opened.');
      handles.push(handle);
      return handle;
    };
    const metadata = (handle: bigint, expected: Readonly<{ device: string; inode: string }>) => {
      const id = Buffer.alloc(24);
      const basic = Buffer.alloc(40);
      const standard = Buffer.alloc(24);
      if (library.symbols.GetFileInformationByHandleEx(handle, 18, id, 24) === 0 ||
          library.symbols.GetFileInformationByHandleEx(handle, 0, basic, 40) === 0 ||
          library.symbols.GetFileInformationByHandleEx(handle, 1, standard, 24) === 0 ||
          id.subarray(0, 8).toString('hex') !== expected.device ||
          id.subarray(8).toString('hex') !== expected.inode ||
          (basic.readUInt32LE(32) & 0x410) !== 0 || standard.readUInt32LE(16) !== 1) {
        failure('Retained permission identity, kind or link count changed.');
      }
      return { attributes: basic.readUInt32LE(32), size: standard.readBigInt64LE(8) };
    };
    const sourceHandle = open(source.path, false);
    const targetHandle = open(target.path, true);
    const wanted = metadata(sourceHandle, source.physical).attributes & WINDOWS_MUTATION_ATTRIBUTES;
    const before = metadata(targetHandle, target.physical);
    if (wanted !== expectedAttributes || before.size < 0n || before.size > BigInt(MAXIMUM_PERMISSION_FILE_BYTES)) {
      failure('Retained permission expectations changed.');
    }
    const hash = createSha256Hasher();
    const chunk = Buffer.alloc(64 * 1024);
    const received = Buffer.alloc(4);
    let offset = 0;
    while (offset < Number(before.size)) {
      const wantedBytes = Math.min(chunk.length, Number(before.size) - offset);
      if (library.symbols.ReadFile(targetHandle, chunk, wantedBytes, received, null) === 0) {
        failure('Retained permission target could not be read.');
      }
      const count = received.readUInt32LE(0);
      if (count === 0 || count > wantedBytes) failure('Retained permission read made invalid progress.');
      hash.update(chunk.subarray(0, count));
      offset += count;
    }
    if (hash.finish() !== target.digest) failure('Permission target receipt bytes changed.');
    let attributes = (before.attributes & ~WINDOWS_MUTATION_ATTRIBUTES) | wanted;
    if ((attributes & ~0x80) !== 0) attributes &= ~0x80;
    if (attributes === 0) attributes = 0x80;
    // Zero timestamps leave time metadata unchanged. Compression, encryption
    // and offline state are outside the four declared mutation attributes.
    const update = Buffer.alloc(40);
    update.writeUInt32LE(attributes >>> 0, 32);
    if (library.symbols.SetFileInformationByHandle(targetHandle, 0, update, 40) === 0 ||
        library.symbols.FlushFileBuffers(targetHandle) === 0) {
      throw new PhysicalNoFollowError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained permission update or flush failed.');
    }
    const after = metadata(targetHandle, target.physical);
    if (after.attributes !== (attributes >>> 0) || after.size !== before.size) failure('Retained permission readback differs.');
    source.assertCurrent();
  } catch (error) {
    errors.push(error);
  } finally {
    for (const handle of handles.reverse()) {
      if (library.symbols.CloseHandle(handle) === 0) errors.push(new PhysicalNoFollowError(
        'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', 'Retained permission handle close failed.'
      ));
    }
    try { library.close(); } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Retained Windows permission operation and settlement failed.');
}
