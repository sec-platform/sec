import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  compareCodeUnits,
  rawSha256
} from '../../../system-architecture/foundation/runtime/canonical.ts';

type DirectoryIdentity = Readonly<{
  changeTime: string;
  dev: string;
  ino: string;
  mode: string;
}>;

export type WindowsHostDirectoryAclProof = Readonly<{
  aclDigest: string;
  ownerSid: string;
}>;

export type WindowsHostDirectoryAclProbe = (
  directoryPath: string,
  input?: Readonly<{ deadlineAtMs?: number }>
) => Promise<WindowsHostDirectoryAclProof>;

export type WindowsHostDirectoryAuthority = Readonly<{
  assertCurrent: (input?: Readonly<{ deadlineAtMs?: number }>) => Promise<void>;
  release: () => Promise<void>;
  rootPath: string;
}>;

export type WindowsReadOnlyTreeAuthority = Readonly<{
  readonly aclDigest: string;
  readonly rootPath: string;
  assertCurrent(): Promise<void>;
  release(): Promise<void>;
}>;

export type WindowsReadOnlyTreeGenerationBinding = Readonly<{
  readonly generationDigest: `sha256:${string}`;
  readonly treeDigest: `sha256:${string}`;
  readonly treeEntryCount: number;
}>;

export const WINDOWS_READ_ONLY_TREE_GENERATION_PROOF_SCHEMA =
  'sec-windows-read-only-tree-generation-proof-v1' as const;

type WindowsReadOnlyTreeGenerationEntryProof = Readonly<{
  readonly aclDigest: string;
  readonly identity: DirectoryIdentity;
  readonly predecessorDescriptor: string;
  readonly relativePath: string;
}>;

type WindowsReadOnlyTreeGenerationProof = Readonly<{
  readonly binding: WindowsReadOnlyTreeGenerationBinding;
  readonly entries: readonly WindowsReadOnlyTreeGenerationEntryProof[];
  readonly proofDigest: `sha256:${string}`;
  readonly rootAclDigest: string;
  readonly rootIdentity: DirectoryIdentity;
  readonly rootPredecessorDescriptor: string;
  readonly rootPath: string;
  readonly schema: typeof WINDOWS_READ_ONLY_TREE_GENERATION_PROOF_SCHEMA;
}>;

const WINDOWS_ACL_PROOF_TIMEOUT_MS = 10_000;
const WINDOWS_READ_ONLY_TREE_RECOVERY_CLEANUP_BUDGET_MS = 120_000;
export const WINDOWS_READ_ONLY_TREE_ADMISSION_POLICY = Object.freeze({
  maximumDurationMs: 300_000,
  operationLedger: 'shared-monotonic-v1',
  proofBinding: 'physical-object-change-time-acl-digest-v1'
});
const NAME_SAM_COMPATIBLE = 2;
const OWNER_SECURITY_INFORMATION = 0x0000_0001;
const DACL_SECURITY_INFORMATION = 0x0000_0004;
const UNPROTECTED_DACL_SECURITY_INFORMATION = 0x2000_0000;
const PROTECTED_DACL_SECURITY_INFORMATION = 0x8000_0000;
const SE_DACL_PRESENT = 0x0004;
const SE_DACL_PROTECTED = 0x1000;
const SE_SELF_RELATIVE = 0x8000;
const ACL_REVISION = 2;
const WINDOWS_ACE_INHERITANCE_FLAGS = Object.freeze({
  directoryDescendants: 0x02 | 0x01,
  none: 0
});
const FILE_ALL_ACCESS = 0x001f_01ff;
const ACCESS_ALLOWED_ACE_TYPES = new Set([0, 5, 9, 11]);
const ACCESS_DENIED_ACE_TYPE = 1;
const ACCESS_ALLOWED_COMPOUND_ACE_TYPE = 4;
const ACE_OBJECT_TYPE_PRESENT = 0x0000_0001;
const ACE_INHERITED_OBJECT_TYPE_PRESENT = 0x0000_0002;
const WINDOWS_WRITE_ACCESS_MASK = 0x500d_0156;
const WINDOWS_TREE_MUTATION_ACCESS_MASK = 0x0001_0156;
const WINDOWS_TREE_READ_EXECUTE_ACL_CONTROL_MASK = 0x001e_00a9;
const WINDOWS_EVERYONE_SID = Buffer.from([
  1, 1, 0, 0, 0, 0, 0, 1,
  0, 0, 0, 0
]);
const TRUSTED_WINDOWS_WRITER_SIDS = new Set(['S-1-5-18', 'S-1-5-32-544']);

export type WindowsHostDirectoryAuthorityFailure =
  | 'aborted'
  | 'acl-untrusted'
  | 'deadline-exhausted'
  | 'native-provider-unavailable'
  | 'physical-identity-changed'
  | 'proof-unavailable'
  | 'session-closed'
  | 'unsupported-platform';

export class WindowsHostDirectoryAuthorityError extends Error {
  readonly failure: WindowsHostDirectoryAuthorityFailure;

  constructor(failure: WindowsHostDirectoryAuthorityFailure, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'WindowsHostDirectoryAuthorityError';
    this.failure = failure;
  }
}

type WindowsAclOperation = Readonly<{
  deadlineAtMonotonicMs: number;
  progress?: {
    completedEntries: number;
    phase: string;
    totalEntries: number;
  };
  signal?: AbortSignal;
}>;

function authorityError(
  failure: WindowsHostDirectoryAuthorityFailure,
  message: string,
  cause?: unknown
): WindowsHostDirectoryAuthorityError {
  return new WindowsHostDirectoryAuthorityError(failure, message, cause);
}

function assertWindowsAclOperationCurrent(operation: WindowsAclOperation): void {
  if (operation.signal?.aborted === true) {
    throw authorityError('aborted', 'Windows host directory authority operation was aborted');
  }
  if (performance.now() >= operation.deadlineAtMonotonicMs) {
    const progress = operation.progress;
    throw authorityError(
      'deadline-exhausted',
      progress === undefined
        ? 'Windows host directory authority deadline was exhausted'
        : `Windows host directory authority deadline was exhausted during ${progress.phase} `
          + `after ${progress.completedEntries}/${progress.totalEntries} entries`
    );
  }
}

function advanceWindowsAclOperation(
  operation: WindowsAclOperation,
  phase: string,
  completedEntries: number
): void {
  if (operation.progress !== undefined) {
    operation.progress.phase = phase;
    operation.progress.completedEntries = completedEntries;
  }
  assertWindowsAclOperationCurrent(operation);
}

function windowsWide(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

function sidBytesToString(bytes: Buffer): string {
  if (bytes.length < 8) {
    throw authorityError('native-provider-unavailable', 'Windows SID bytes are invalid');
  }
  const revision = bytes.readUInt8(0);
  const subAuthorityCount = bytes.readUInt8(1);
  const requiredLength = 8 + subAuthorityCount * 4;
  if (revision !== 1 || requiredLength !== bytes.length) {
    throw authorityError('native-provider-unavailable', 'Windows SID bytes are invalid');
  }
  let identifierAuthority = 0n;
  for (let index = 0; index < 6; index += 1) {
    identifierAuthority = (identifierAuthority << 8n) | BigInt(bytes.readUInt8(2 + index));
  }
  const fields = [`S-${revision}-${identifierAuthority}`];
  for (let index = 0; index < subAuthorityCount; index += 1) {
    fields.push(String(bytes.readUInt32LE(8 + index * 4)));
  }
  return fields.join('-');
}

async function loadWindowsAclAdvapi32() {
  const { dlopen, FFIType } = await import('bun:ffi');
  return dlopen('advapi32.dll', {
    LookupAccountNameW: {
      args: [
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr,
        FFIType.ptr
      ],
      returns: FFIType.i32
    },
    GetFileSecurityW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32
    },
    SetFileSecurityW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr],
      returns: FFIType.i32
    }
  } as const);
}

async function loadWindowsAclKernel32() {
  const { dlopen, FFIType } = await import('bun:ffi');
  return dlopen('kernel32.dll', {
    GetLastError: {
      args: [],
      returns: FFIType.u32
    }
  } as const);
}

async function loadWindowsAclSecur32() {
  const { dlopen, FFIType } = await import('bun:ffi');
  return dlopen('secur32.dll', {
    GetUserNameExW: {
      args: [FFIType.i32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32
    }
  } as const);
}

type WindowsAclAdvapi32 = Awaited<ReturnType<typeof loadWindowsAclAdvapi32>>;
type WindowsAclKernel32 = Awaited<ReturnType<typeof loadWindowsAclKernel32>>;
type WindowsAclSecur32 = Awaited<ReturnType<typeof loadWindowsAclSecur32>>;
type WindowsAclLibraries = Readonly<{
  advapi32: WindowsAclAdvapi32;
  kernel32: WindowsAclKernel32;
  secur32: WindowsAclSecur32;
}>;

let windowsAclLibrariesPromise: Promise<WindowsAclLibraries> | undefined;
let nativeWindowsAclDescriptorReadCount = 0;
let nativeWindowsAclSessionOpenCount = 0;
let nativeWindowsAclSessionCloseCount = 0;

function openWindowsAclLibraries(): Promise<WindowsAclLibraries> {
  windowsAclLibrariesPromise ??= Promise.all([
    loadWindowsAclAdvapi32(),
    loadWindowsAclKernel32(),
    loadWindowsAclSecur32()
  ]).then(([advapi32, kernel32, secur32]) => Object.freeze({
    advapi32,
    kernel32,
    secur32
  }));
  return windowsAclLibrariesPromise;
}

function nativeFailure(
  kernel32: WindowsAclKernel32,
  operation: string,
  result?: number
): WindowsHostDirectoryAuthorityError {
  const code = result ?? kernel32.symbols.GetLastError();
  return authorityError(
    'native-provider-unavailable',
    `Windows host directory ${operation} failed with Win32 status ${code}`
  );
}

function sidBytesAt(bytes: Buffer, offset: number, limit = bytes.length): Buffer {
  if (offset < 0 || offset + 8 > limit) {
    throw authorityError('native-provider-unavailable', 'Windows host directory SID is invalid');
  }
  const length = 8 + bytes.readUInt8(offset + 1) * 4;
  if (length < 8 || length > 68 || offset + length > limit) {
    throw authorityError('native-provider-unavailable', 'Windows host directory SID is invalid');
  }
  return bytes.subarray(offset, offset + length);
}

function aceSidOffset(aceType: number, aceBytes: Buffer): number | null {
  if (aceType === 0 || aceType === 9) return 8;
  if (aceType === 5 || aceType === 11) {
    if (aceBytes.length < 12) return null;
    const objectFlags = aceBytes.readUInt32LE(8);
    return 12
      + ((objectFlags & ACE_OBJECT_TYPE_PRESENT) === 0 ? 0 : 16)
      + ((objectFlags & ACE_INHERITED_OBJECT_TYPE_PRESENT) === 0 ? 0 : 16);
  }
  return null;
}

function ownerDaclSemanticDigest(descriptor: Buffer): string {
  if (descriptor.length < 20) {
    throw authorityError('native-provider-unavailable', 'Windows security descriptor is truncated');
  }
  const controlFlags = descriptor.readUInt16LE(2);
  const ownerOffset = descriptor.readUInt32LE(4);
  const daclOffset = descriptor.readUInt32LE(16);
  if (daclOffset === 0 || daclOffset + 8 > descriptor.length) {
    throw authorityError('native-provider-unavailable', 'Windows security descriptor DACL is invalid');
  }
  const aclSize = descriptor.readUInt16LE(daclOffset + 2);
  if (aclSize < 8 || daclOffset + aclSize > descriptor.length) {
    throw authorityError('native-provider-unavailable', 'Windows security descriptor ACL size is invalid');
  }
  return rawSha256(JSON.stringify({
    controlFlags: controlFlags & (SE_DACL_PRESENT | SE_DACL_PROTECTED),
    ownerSid: sidBytesToString(sidBytesAt(descriptor, ownerOffset)),
    dacl: descriptor.subarray(daclOffset, daclOffset + aclSize).toString('base64')
  }));
}

class NativeWindowsAclSession {
  readonly #advapi32: WindowsAclAdvapi32;
  readonly #kernel32: WindowsAclKernel32;
  readonly #currentSidBytes: Buffer;
  readonly #currentSid: string;
  #closed = false;

  private constructor(
    advapi32: WindowsAclAdvapi32,
    kernel32: WindowsAclKernel32,
    currentSidBytes: Buffer,
    currentSid: string
  ) {
    this.#advapi32 = advapi32;
    this.#kernel32 = kernel32;
    this.#currentSidBytes = currentSidBytes;
    this.#currentSid = currentSid;
  }

  static async open(operation: WindowsAclOperation): Promise<NativeWindowsAclSession> {
    assertWindowsAclOperationCurrent(operation);
    if (process.platform !== 'win32') {
      throw authorityError(
        'unsupported-platform',
        'Windows host directory authority is Windows-only'
      );
    }
    try {
      const { advapi32, kernel32, secur32 } = await openWindowsAclLibraries();
      assertWindowsAclOperationCurrent(operation);
      const accountLength = Buffer.alloc(4);
      const firstAccountRead = secur32.symbols.GetUserNameExW(
        NAME_SAM_COMPATIBLE,
        null,
        accountLength
      );
      const accountCharacters = accountLength.readUInt32LE();
      // Bun FFI does not promise to preserve the calling thread's Win32 last
      // error across the JavaScript return boundary. The Windows sizing
      // contract already gives us the authoritative result in the caller-owned
      // length buffer, so never make GetLastError part of successful admission.
      if (firstAccountRead !== 0 || accountCharacters < 2 || accountCharacters > 1024) {
        throw authorityError(
          'native-provider-unavailable',
          'Windows host directory principal name is invalid'
        );
      }
      const accountName = Buffer.alloc(accountCharacters * 2);
      if (secur32.symbols.GetUserNameExW(
        NAME_SAM_COMPATIBLE,
        accountName,
        accountLength
      ) === 0) {
        throw nativeFailure(kernel32, 'principal-name readback');
      }
      const sidLength = Buffer.alloc(4);
      const domainLength = Buffer.alloc(4);
      const sidUse = Buffer.alloc(4);
      const firstSidRead = advapi32.symbols.LookupAccountNameW(
        null,
        accountName,
        null,
        sidLength,
        null,
        domainLength,
        sidUse
      );
      const sidByteLength = sidLength.readUInt32LE();
      const domainCharacters = domainLength.readUInt32LE();
      if (firstSidRead !== 0 || sidByteLength < 8 || sidByteLength > 68 ||
        domainCharacters > 1024) {
        throw authorityError(
          'native-provider-unavailable',
          'Windows host directory principal SID is invalid'
        );
      }
      const sid = Buffer.alloc(sidByteLength);
      const domain = Buffer.alloc(Math.max(1, domainCharacters) * 2);
      if (advapi32.symbols.LookupAccountNameW(
        null,
        accountName,
        sid,
        sidLength,
        domain,
        domainLength,
        sidUse
      ) === 0) {
        throw nativeFailure(kernel32, 'principal-SID readback');
      }
      const currentSid = sidBytesToString(sid);
      assertWindowsAclOperationCurrent(operation);
      nativeWindowsAclSessionOpenCount += 1;
      return new NativeWindowsAclSession(advapi32, kernel32, sid, currentSid);
    } catch (error) {
      if (error instanceof WindowsHostDirectoryAuthorityError) throw error;
      throw authorityError(
        'native-provider-unavailable',
        'Windows host directory native ACL provider is unavailable',
        error
      );
    }
  }

  #assertOpen(operation: WindowsAclOperation): void {
    assertWindowsAclOperationCurrent(operation);
    if (this.#closed) {
      throw authorityError('session-closed', 'Windows host directory ACL session is closed');
    }
  }

  #readDescriptor(targetPath: string, operation: WindowsAclOperation): Buffer {
    this.#assertOpen(operation);
    nativeWindowsAclDescriptorReadCount += 1;
    const requiredLength = Buffer.alloc(4);
    const first = this.#advapi32.symbols.GetFileSecurityW(
      windowsWide(targetPath),
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      null,
      0,
      requiredLength
    );
    const descriptorLength = requiredLength.readUInt32LE();
    if (first !== 0 || descriptorLength < 20 || descriptorLength > 65_535) {
      throw authorityError('native-provider-unavailable', 'Windows tree security descriptor is invalid');
    }
    const descriptor = Buffer.alloc(descriptorLength);
    if (this.#advapi32.symbols.GetFileSecurityW(
      windowsWide(targetPath),
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      descriptor,
      descriptor.length,
      requiredLength
    ) === 0) {
      throw nativeFailure(this.#kernel32, 'tree ACL readback');
    }
    this.#assertOpen(operation);
    return descriptor;
  }

  #writeDescriptor(targetPath: string, descriptor: Buffer, operation: WindowsAclOperation): void {
    this.#assertOpen(operation);
    if (descriptor.length < 20) {
      throw authorityError('native-provider-unavailable', 'Windows security descriptor is truncated');
    }
    const protectionInformation = (descriptor.readUInt16LE(2) & SE_DACL_PROTECTED) === 0
      ? UNPROTECTED_DACL_SECURITY_INFORMATION
      : PROTECTED_DACL_SECURITY_INFORMATION;
    if (this.#advapi32.symbols.SetFileSecurityW(
      windowsWide(targetPath),
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | protectionInformation,
      descriptor
    ) === 0) {
      throw nativeFailure(this.#kernel32, 'tree ACL publication');
    }
    this.#assertOpen(operation);
  }

  #readOnlyDescriptor(allowMask = WINDOWS_TREE_READ_EXECUTE_ACL_CONTROL_MASK): Buffer {
    const ownerOffset = 20;
    const daclOffset = ownerOffset + this.#currentSidBytes.length;
    const denyAceSize = 8 + WINDOWS_EVERYONE_SID.length;
    const allowAceSize = 8 + this.#currentSidBytes.length;
    const aclSize = 8 + denyAceSize + allowAceSize;
    const descriptor = Buffer.alloc(daclOffset + aclSize);
    descriptor.writeUInt8(1, 0);
    descriptor.writeUInt16LE(SE_SELF_RELATIVE | SE_DACL_PRESENT | SE_DACL_PROTECTED, 2);
    descriptor.writeUInt32LE(ownerOffset, 4);
    descriptor.writeUInt32LE(daclOffset, 16);
    this.#currentSidBytes.copy(descriptor, ownerOffset);
    descriptor.writeUInt8(ACL_REVISION, daclOffset);
    descriptor.writeUInt16LE(aclSize, daclOffset + 2);
    descriptor.writeUInt16LE(2, daclOffset + 4);
    const denyOffset = daclOffset + 8;
    descriptor.writeUInt8(ACCESS_DENIED_ACE_TYPE, denyOffset);
    descriptor.writeUInt8(WINDOWS_ACE_INHERITANCE_FLAGS.none, denyOffset + 1);
    descriptor.writeUInt16LE(denyAceSize, denyOffset + 2);
    descriptor.writeUInt32LE(WINDOWS_TREE_MUTATION_ACCESS_MASK, denyOffset + 4);
    WINDOWS_EVERYONE_SID.copy(descriptor, denyOffset + 8);
    const allowOffset = denyOffset + denyAceSize;
    descriptor.writeUInt8(0, allowOffset);
    descriptor.writeUInt8(WINDOWS_ACE_INHERITANCE_FLAGS.none, allowOffset + 1);
    descriptor.writeUInt16LE(allowAceSize, allowOffset + 2);
    descriptor.writeUInt32LE(allowMask, allowOffset + 4);
    this.#currentSidBytes.copy(descriptor, allowOffset + 8);
    return descriptor;
  }

  sealReadOnly(targetPath: string, operation: WindowsAclOperation): string {
    this.#assertOpen(operation);
    const descriptor = this.#readOnlyDescriptor();
    this.#writeDescriptor(targetPath, descriptor, operation);
    const readback = this.#readDescriptor(targetPath, operation);
    if (!readback.equals(descriptor)) {
      throw authorityError('acl-untrusted', 'Windows read-only tree ACL readback differs');
    }
    return rawSha256(readback);
  }

  sealGenerationReadOnly(targetPath: string, operation: WindowsAclOperation): string {
    this.#assertOpen(operation);
    // The exact predecessor descriptor is the only retirement authority. The
    // owner must retain ACL-control rights so that a later compiler-root lease
    // can restore that descriptor; mutation data/delete rights remain denied.
    const descriptor = this.#readOnlyDescriptor(WINDOWS_TREE_READ_EXECUTE_ACL_CONTROL_MASK);
    this.#writeDescriptor(targetPath, descriptor, operation);
    const readback = this.#readDescriptor(targetPath, operation);
    if (!readback.equals(descriptor)) {
      throw authorityError('acl-untrusted', 'Windows generation ACL readback differs');
    }
    return rawSha256(readback);
  }

  captureDescriptor(targetPath: string, operation: WindowsAclOperation): Buffer {
    return Buffer.from(this.#readDescriptor(targetPath, operation));
  }

  restoreDescriptor(
    targetPath: string,
    descriptor: Buffer,
    operation: WindowsAclOperation
  ): void {
    const expectedDigest = ownerDaclSemanticDigest(descriptor);
    this.#writeDescriptor(targetPath, descriptor, operation);
    if (ownerDaclSemanticDigest(this.#readDescriptor(targetPath, operation)) !== expectedDigest) {
      throw authorityError('acl-untrusted', 'Windows read-only tree ACL restoration readback differs');
    }
  }

  async harden(directoryPath: string, operation: WindowsAclOperation): Promise<void> {
    this.#assertOpen(operation);
    const ownerOffset = 20;
    const daclOffset = ownerOffset + this.#currentSidBytes.length;
    const aceSize = 8 + this.#currentSidBytes.length;
    const aclSize = 8 + aceSize;
    const descriptor = Buffer.alloc(daclOffset + aclSize);
    descriptor.writeUInt8(1, 0);
    descriptor.writeUInt16LE(
      SE_SELF_RELATIVE | SE_DACL_PRESENT | SE_DACL_PROTECTED,
      2
    );
    descriptor.writeUInt32LE(ownerOffset, 4);
    descriptor.writeUInt32LE(daclOffset, 16);
    this.#currentSidBytes.copy(descriptor, ownerOffset);
    descriptor.writeUInt8(ACL_REVISION, daclOffset);
    descriptor.writeUInt16LE(aclSize, daclOffset + 2);
    descriptor.writeUInt16LE(1, daclOffset + 4);
    const aceOffset = daclOffset + 8;
    descriptor.writeUInt8(0, aceOffset);
    descriptor.writeUInt8(
      WINDOWS_ACE_INHERITANCE_FLAGS.directoryDescendants,
      aceOffset + 1
    );
    descriptor.writeUInt16LE(aceSize, aceOffset + 2);
    descriptor.writeUInt32LE(FILE_ALL_ACCESS, aceOffset + 4);
    this.#currentSidBytes.copy(descriptor, aceOffset + 8);
    this.#assertOpen(operation);
    if (this.#advapi32.symbols.SetFileSecurityW(
      windowsWide(directoryPath),
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      descriptor
    ) === 0) {
      throw nativeFailure(this.#kernel32, 'ACL hardening');
    }
    this.#assertOpen(operation);
  }

  async prove(
    directoryPath: string,
    operation: WindowsAclOperation
  ): Promise<WindowsHostDirectoryAclProof> {
    this.#assertOpen(operation);
    const requiredLength = Buffer.alloc(4);
    const first = this.#advapi32.symbols.GetFileSecurityW(
      windowsWide(directoryPath),
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      null,
      0,
      requiredLength
    );
    const descriptorLength = requiredLength.readUInt32LE();
    if (first !== 0 || descriptorLength < 20 || descriptorLength > 65_535) {
      throw authorityError(
        'native-provider-unavailable',
        'Windows host directory security descriptor is invalid'
      );
    }
    const descriptor = Buffer.alloc(descriptorLength);
    if (this.#advapi32.symbols.GetFileSecurityW(
      windowsWide(directoryPath),
      OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      descriptor,
      descriptor.length,
      requiredLength
    ) === 0) {
      throw nativeFailure(this.#kernel32, 'ACL readback');
    }
    this.#assertOpen(operation);
    const controlFlags = descriptor.readUInt16LE(2);
    const ownerOffset = descriptor.readUInt32LE(4);
    const daclOffset = descriptor.readUInt32LE(16);
    const ownerSid = sidBytesToString(sidBytesAt(descriptor, ownerOffset));
    if (ownerSid !== this.#currentSid) {
      throw authorityError('acl-untrusted', 'Windows host directory owner mismatch');
    }
    if (daclOffset === 0) {
      throw authorityError('acl-untrusted', 'Windows host directory has an untrusted null DACL');
    }
    if ((controlFlags & SE_DACL_PRESENT) === 0 ||
      (controlFlags & SE_DACL_PROTECTED) === 0 ||
      (controlFlags & SE_SELF_RELATIVE) === 0) {
      throw authorityError(
        'acl-untrusted',
        'Windows host directory DACL inheritance is not protected'
      );
    }

    if (daclOffset + 8 > descriptor.length) {
      throw authorityError('native-provider-unavailable', 'Windows host directory ACL is invalid');
    }
    const aclSize = descriptor.readUInt16LE(daclOffset + 2);
    const aceCount = descriptor.readUInt16LE(daclOffset + 4);
    if (aclSize < 8 || daclOffset + aclSize > descriptor.length || aceCount > 4096) {
      throw authorityError('native-provider-unavailable', 'Windows host directory ACL is invalid');
    }
    const trustedWriters = new Set(TRUSTED_WINDOWS_WRITER_SIDS);
    trustedWriters.add(this.#currentSid);
    let aceOffset = daclOffset + 8;
    for (let index = 0; index < aceCount; index += 1) {
      if (aceOffset + 8 > daclOffset + aclSize) {
        throw authorityError('native-provider-unavailable', 'Windows host directory ACL is invalid');
      }
      const aceType = descriptor.readUInt8(aceOffset);
      const aceSize = descriptor.readUInt16LE(aceOffset + 2);
      const accessMask = descriptor.readUInt32LE(aceOffset + 4);
      if (aceSize < 8 || aceOffset + aceSize > daclOffset + aclSize) {
        throw authorityError('native-provider-unavailable', 'Windows host directory ACL is invalid');
      }
      if ((accessMask & WINDOWS_WRITE_ACCESS_MASK) === 0) {
        aceOffset += aceSize;
        continue;
      }
      if (!ACCESS_ALLOWED_ACE_TYPES.has(aceType)) {
        if (aceType === ACCESS_ALLOWED_COMPOUND_ACE_TYPE) {
          throw authorityError(
            'acl-untrusted',
            'Windows host directory contains an unsupported writer ACE'
          );
        }
        aceOffset += aceSize;
        continue;
      }
      const aceBytes = descriptor.subarray(aceOffset, aceOffset + aceSize);
      const sidOffset = aceSidOffset(aceType, aceBytes);
      if (sidOffset === null || sidOffset >= aceSize) {
        throw authorityError('native-provider-unavailable', 'Windows host directory ACL is invalid');
      }
      const writerSid = sidBytesToString(sidBytesAt(
        aceBytes,
        sidOffset,
        aceBytes.length
      ));
      if (!trustedWriters.has(writerSid)) {
        throw authorityError(
          'acl-untrusted',
          `Windows host directory contains an untrusted writer: ${writerSid}`
        );
      }
      aceOffset += aceSize;
    }
    const aclDigest = rawSha256(descriptor);
    this.#assertOpen(operation);
    return Object.freeze({ aclDigest, ownerSid });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    nativeWindowsAclSessionCloseCount += 1;
  }
}

function directoryIdentity(metadata: {
  readonly ctimeNs: bigint;
  readonly dev: bigint | number;
  readonly ino: bigint | number;
  readonly mode: bigint | number;
}): DirectoryIdentity {
  return Object.freeze({
    changeTime: String(metadata.ctimeNs),
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode)
  });
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.changeTime === right.changeTime
    && left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function samePhysicalObject(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function assertReusableAclProofIdentity(identity: DirectoryIdentity): void {
  if (!/^[1-9][0-9]*$/.test(identity.changeTime)) {
    throw authorityError(
      'proof-unavailable',
      'Windows read-only tree ChangeTime proof identity is unavailable'
    );
  }
}

function ordinaryWindowsPath(value: string): string {
  const normalized = path.win32.normalize(value);
  if (normalized.startsWith('\\\\?\\UNC\\')) return `\\\\${normalized.slice(8)}`;
  return normalized.startsWith('\\\\?\\') ? normalized.slice(4) : normalized;
}

function sameWindowsPath(left: string, right: string): boolean {
  return ordinaryWindowsPath(path.win32.resolve(left)).toLocaleLowerCase('en-US') ===
    ordinaryWindowsPath(path.win32.resolve(right)).toLocaleLowerCase('en-US');
}

async function physicalWindowsDirectory(directoryPath: string): Promise<Readonly<{
  identity: DirectoryIdentity;
  rootPath: string;
}>> {
  if (!path.win32.isAbsolute(directoryPath)) {
    throw authorityError(
      'native-provider-unavailable',
      'Windows host directory authority must be absolute'
    );
  }
  const rootPath = path.win32.resolve(directoryPath);
  let metadata: import('node:fs').BigIntStats;
  try {
    metadata = await lstat(rootPath, { bigint: true });
  } catch (error) {
    throw authorityError(
      'native-provider-unavailable',
      'Windows host directory physical identity is unavailable',
      error
    );
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw authorityError(
      'native-provider-unavailable',
      'Windows host directory authority must be a physical directory'
    );
  }
  let canonical: string;
  try {
    canonical = await realpath(rootPath);
  } catch (error) {
    throw authorityError(
      'native-provider-unavailable',
      'Windows host directory canonical identity is unavailable',
      error
    );
  }
  if (!sameWindowsPath(canonical, rootPath)) {
    throw authorityError(
      'native-provider-unavailable',
      'Windows host directory authority must not traverse an alias'
    );
  }
  return Object.freeze({
    identity: directoryIdentity(metadata),
    rootPath
  });
}

async function physicalWindowsTreeEntry(entryPath: string): Promise<Readonly<{
  identity: DirectoryIdentity;
  path: string;
}>> {
  if (!path.win32.isAbsolute(entryPath)) {
    throw authorityError('native-provider-unavailable', 'Windows tree entry must be absolute');
  }
  const exactPath = path.win32.resolve(entryPath);
  const metadata = await lstat(exactPath, { bigint: true });
  if ((!metadata.isDirectory() && !metadata.isFile()) || metadata.isSymbolicLink()) {
    throw authorityError('native-provider-unavailable', 'Windows tree entry must be ordinary');
  }
  const canonical = await realpath(exactPath);
  if (!sameWindowsPath(canonical, exactPath)) {
    throw authorityError('native-provider-unavailable', 'Windows tree entry must not traverse an alias');
  }
  return Object.freeze({ identity: directoryIdentity(metadata), path: exactPath });
}

const WINDOWS_READ_ONLY_TREE_GENERATION_PROOF_KEYS = Object.freeze([
  'binding', 'entries', 'proofDigest', 'rootAclDigest', 'rootIdentity', 'rootPath',
  'rootPredecessorDescriptor', 'schema'
]);
const WINDOWS_READ_ONLY_TREE_GENERATION_BINDING_KEYS = Object.freeze([
  'generationDigest', 'treeDigest', 'treeEntryCount'
]);
const WINDOWS_READ_ONLY_TREE_GENERATION_ENTRY_KEYS = Object.freeze([
  'aclDigest', 'identity', 'predecessorDescriptor', 'relativePath'
]);
const WINDOWS_DIRECTORY_IDENTITY_KEYS = Object.freeze(['changeTime', 'dev', 'ino', 'mode']);

function exactKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort(compareCodeUnits))
    === JSON.stringify([...expected].sort(compareCodeUnits));
}

function isDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isDirectoryIdentity(value: unknown): value is DirectoryIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || !exactKeys(value, WINDOWS_DIRECTORY_IDENTITY_KEYS)) return false;
  const candidate = value as Partial<DirectoryIdentity>;
  return typeof candidate.changeTime === 'string' && /^[1-9][0-9]*$/u.test(candidate.changeTime)
    && typeof candidate.dev === 'string' && candidate.dev.length > 0
    && typeof candidate.ino === 'string' && candidate.ino.length > 0
    && typeof candidate.mode === 'string' && candidate.mode.length > 0;
}

function generationProofUnsigned(input: Omit<WindowsReadOnlyTreeGenerationProof, 'proofDigest'>): object {
  return Object.freeze({
    binding: input.binding,
    entries: input.entries,
    rootAclDigest: input.rootAclDigest,
    rootIdentity: input.rootIdentity,
    rootPath: input.rootPath,
    rootPredecessorDescriptor: input.rootPredecessorDescriptor,
    schema: input.schema
  });
}

function generationProofDigest(
  input: Omit<WindowsReadOnlyTreeGenerationProof, 'proofDigest'>
): `sha256:${string}` {
  return rawSha256(JSON.stringify(generationProofUnsigned(input)));
}

function canonicalGenerationProofText(proof: WindowsReadOnlyTreeGenerationProof): string {
  return `${JSON.stringify(proof)}\n`;
}

function parseGenerationProof(text: string): WindowsReadOnlyTreeGenerationProof {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw authorityError('proof-unavailable', 'Windows generation proof JSON is invalid', error);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || !exactKeys(value, WINDOWS_READ_ONLY_TREE_GENERATION_PROOF_KEYS)) {
    throw authorityError('proof-unavailable', 'Windows generation proof keys are noncanonical');
  }
  const candidate = value as Partial<WindowsReadOnlyTreeGenerationProof>;
  if (candidate.schema !== WINDOWS_READ_ONLY_TREE_GENERATION_PROOF_SCHEMA
      || candidate.binding === null || typeof candidate.binding !== 'object'
      || Array.isArray(candidate.binding)
      || !exactKeys(candidate.binding, WINDOWS_READ_ONLY_TREE_GENERATION_BINDING_KEYS)
      || !isDigest(candidate.binding.generationDigest)
      || !isDigest(candidate.binding.treeDigest)
      || !Number.isSafeInteger(candidate.binding.treeEntryCount)
      || candidate.binding.treeEntryCount! < 0
      || typeof candidate.rootPath !== 'string' || !path.win32.isAbsolute(candidate.rootPath)
      || !isDirectoryIdentity(candidate.rootIdentity)
      || !isDigest(candidate.proofDigest)
      || typeof candidate.rootAclDigest !== 'string' || candidate.rootAclDigest.length === 0
      || typeof candidate.rootPredecessorDescriptor !== 'string'
      || Buffer.from(candidate.rootPredecessorDescriptor, 'base64').toString('base64')
        !== candidate.rootPredecessorDescriptor
      || !Array.isArray(candidate.entries)) {
    throw authorityError('proof-unavailable', 'Windows generation proof shape is invalid');
  }
  const entries: WindowsReadOnlyTreeGenerationEntryProof[] = [];
  let predecessor = '';
  for (const entry of candidate.entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
        || !exactKeys(entry, WINDOWS_READ_ONLY_TREE_GENERATION_ENTRY_KEYS)) {
      throw authorityError('proof-unavailable', 'Windows generation proof entry keys are invalid');
    }
    const parsed = entry as Partial<WindowsReadOnlyTreeGenerationEntryProof>;
    if (typeof parsed.relativePath !== 'string' || parsed.relativePath.length === 0
        || path.win32.isAbsolute(parsed.relativePath)
        || parsed.relativePath.split(/[\\/]+/u).some((segment) => (
          segment.length === 0 || segment === '.' || segment === '..'
        ))
        || parsed.relativePath.replaceAll('\\', '/') !== parsed.relativePath
        || (predecessor !== '' && compareCodeUnits(predecessor, parsed.relativePath) >= 0)
        || typeof parsed.aclDigest !== 'string' || parsed.aclDigest.length === 0
        || typeof parsed.predecessorDescriptor !== 'string'
        || Buffer.from(parsed.predecessorDescriptor, 'base64').toString('base64')
          !== parsed.predecessorDescriptor
        || !isDirectoryIdentity(parsed.identity)) {
      throw authorityError('proof-unavailable', 'Windows generation proof entry is invalid');
    }
    predecessor = parsed.relativePath;
    entries.push(Object.freeze({
      aclDigest: parsed.aclDigest,
      identity: parsed.identity,
      predecessorDescriptor: parsed.predecessorDescriptor,
      relativePath: parsed.relativePath
    }));
  }
  const proof = Object.freeze({
    binding: Object.freeze({ ...candidate.binding }),
    entries: Object.freeze(entries),
    proofDigest: candidate.proofDigest,
    rootAclDigest: candidate.rootAclDigest,
    rootIdentity: candidate.rootIdentity,
    rootPath: path.win32.resolve(candidate.rootPath),
    rootPredecessorDescriptor: candidate.rootPredecessorDescriptor,
    schema: candidate.schema
  }) as WindowsReadOnlyTreeGenerationProof;
  if (proof.proofDigest !== generationProofDigest(proof)) {
    throw authorityError('proof-unavailable', 'Windows generation proof digest differs');
  }
  if (canonicalGenerationProofText(proof) !== text) {
    throw authorityError('proof-unavailable', 'Windows generation proof bytes are noncanonical');
  }
  return proof;
}

/** Test-only byte-grammar assertion. This validates no live path and grants no authority. */
export function assertWindowsReadOnlyTreeGenerationProofForTests(text: string): void {
  void parseGenerationProof(text);
}

function sameGenerationBinding(
  left: WindowsReadOnlyTreeGenerationBinding,
  right: WindowsReadOnlyTreeGenerationBinding
): boolean {
  return left.generationDigest === right.generationDigest
    && left.treeDigest === right.treeDigest
    && left.treeEntryCount === right.treeEntryCount;
}

function canonicalGenerationEntries(
  rootPath: string,
  entryPaths: readonly string[]
): readonly string[] {
  const canonical = [...new Set(entryPaths.map((entry) => path.win32.resolve(entry)))]
    .sort(compareCodeUnits);
  if (canonical.length !== entryPaths.length) {
    throw authorityError('proof-unavailable', 'Windows generation entries are not unique');
  }
  for (const entry of canonical) {
    const relative = path.win32.relative(rootPath, entry);
    if (relative.length === 0 || path.win32.isAbsolute(relative)
        || relative === '..' || relative.startsWith(`..${path.win32.sep}`)) {
      throw authorityError('proof-unavailable', 'Windows generation entry escapes its root');
    }
  }
  return Object.freeze(canonical);
}

function generationRelativePath(rootPath: string, entryPath: string): string {
  return path.win32.relative(rootPath, entryPath).replaceAll('\\', '/');
}

function assertGenerationBinding(binding: WindowsReadOnlyTreeGenerationBinding): void {
  if (!isDigest(binding.generationDigest) || !isDigest(binding.treeDigest)
      || !Number.isSafeInteger(binding.treeEntryCount) || binding.treeEntryCount < 0) {
    throw authorityError('proof-unavailable', 'Windows generation binding is invalid');
  }
}

function generationOperation(input: Readonly<{
  deadlineAtMs?: number;
  signal?: AbortSignal;
}>, totalEntries: number): WindowsAclOperation {
  const deadlineAtUnixMs = input.deadlineAtMs ?? (Date.now()
    + WINDOWS_READ_ONLY_TREE_ADMISSION_POLICY.maximumDurationMs);
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now()) {
    throw authorityError('deadline-exhausted', 'Windows generation proof deadline is exhausted');
  }
  return Object.freeze({
    deadlineAtMonotonicMs: performance.now() + Math.min(
      WINDOWS_READ_ONLY_TREE_ADMISSION_POLICY.maximumDurationMs,
      deadlineAtUnixMs - Date.now()
    ),
    progress: {
      completedEntries: 0,
      phase: 'generation-proof',
      totalEntries
    },
    signal: input.signal
  });
}

function issueGenerationAuthority(input: Readonly<{
  entries: readonly WindowsReadOnlyTreeGenerationEntryProof[];
  rootIdentity: DirectoryIdentity;
  rootPath: string;
  session: NativeWindowsAclSession;
}>): WindowsReadOnlyTreeAuthority {
  let released = false;
  const assertCurrent = async (): Promise<void> => {
    if (released) {
      throw authorityError('session-closed', 'Windows generation proof is released');
    }
    const root = await physicalWindowsDirectory(input.rootPath);
    if (!sameDirectoryIdentity(root.identity, input.rootIdentity)) {
      throw authorityError('physical-identity-changed', 'Windows generation root changed');
    }
  };
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    input.session.close();
  };
  return Object.freeze({
    aclDigest: rawSha256(JSON.stringify({
      root: input.rootIdentity,
      entries: input.entries.map(({ relativePath, aclDigest }) => ({ relativePath, aclDigest }))
    })),
    assertCurrent,
    release,
    rootPath: input.rootPath
  });
}

/**
 * Publishes one generation-owned ACL exactly once. Retirement closes the
 * process-local native session but deliberately leaves the immutable ACL in
 * place; the dependency publisher retires the whole directory generation,
 * never its individual entries.
 */
export async function sealWindowsReadOnlyTreeGeneration(
  rootPath: string,
  entryPaths: readonly string[],
  binding: WindowsReadOnlyTreeGenerationBinding,
  options: Readonly<{ deadlineAtMs?: number; signal?: AbortSignal }> = {}
): Promise<Readonly<{
  authority: WindowsReadOnlyTreeAuthority;
  proofText: string;
}>> {
  if (process.platform !== 'win32') {
    throw authorityError('unsupported-platform', 'Windows generation proof is Windows-only');
  }
  assertGenerationBinding(binding);
  const root = await physicalWindowsDirectory(rootPath);
  const canonicalEntries = canonicalGenerationEntries(root.rootPath, entryPaths);
  const operation = generationOperation(options, canonicalEntries.length + 1);
  const session = await NativeWindowsAclSession.open(operation);
  try {
    advanceWindowsAclOperation(operation, 'generation-root-seal', 0);
    const rootPredecessorDescriptor = session.captureDescriptor(root.rootPath, operation).toString('base64');
    const rootAclDigest = session.sealGenerationReadOnly(root.rootPath, operation);
    const sealedRoot = await physicalWindowsDirectory(root.rootPath);
    assertReusableAclProofIdentity(sealedRoot.identity);
    const entries: WindowsReadOnlyTreeGenerationEntryProof[] = [];
    for (const [index, entryPath] of canonicalEntries.entries()) {
      advanceWindowsAclOperation(operation, 'generation-entry-seal', index + 1);
      const predecessorDescriptor = session.captureDescriptor(entryPath, operation).toString('base64');
      const aclDigest = session.sealGenerationReadOnly(entryPath, operation);
      const sealed = await physicalWindowsTreeEntry(entryPath);
      assertReusableAclProofIdentity(sealed.identity);
      entries.push(Object.freeze({
        aclDigest,
        identity: sealed.identity,
        predecessorDescriptor,
        relativePath: generationRelativePath(root.rootPath, entryPath)
      }));
    }
    entries.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
    const unsigned = Object.freeze({
      binding: Object.freeze({ ...binding }),
      entries: Object.freeze(entries),
      rootAclDigest,
      rootIdentity: sealedRoot.identity,
      rootPath: sealedRoot.rootPath,
      rootPredecessorDescriptor,
      schema: WINDOWS_READ_ONLY_TREE_GENERATION_PROOF_SCHEMA
    });
    const proof = Object.freeze({
      binding: unsigned.binding,
      entries: unsigned.entries,
      proofDigest: generationProofDigest(unsigned),
      rootAclDigest: unsigned.rootAclDigest,
      rootIdentity: unsigned.rootIdentity,
      rootPath: unsigned.rootPath,
      rootPredecessorDescriptor: unsigned.rootPredecessorDescriptor,
      schema: unsigned.schema
    });
    const authority = issueGenerationAuthority({
      entries: proof.entries,
      rootIdentity: proof.rootIdentity,
      rootPath: proof.rootPath,
      session
    });
    await authority.assertCurrent();
    return Object.freeze({ authority, proofText: canonicalGenerationProofText(proof) });
  } catch (error) {
    session.close();
    throw error;
  }
}

/**
 * Reopens a persisted generation proof. The proof bytes are only a binding;
 * authority is issued after live root identity, ChangeTime and exact root ACL
 * readback. Publication already removed ACL mutation, byte mutation and
 * delete rights from every descendant. Reopening every descendant here would
 * repeat the publisher's proof without adding a new mutation path; the exact
 * entry proof remains content-addressed by the dependency owner's tree digest.
 */
export async function openWindowsReadOnlyTreeGeneration(
  rootPath: string,
  proofText: string,
  binding: WindowsReadOnlyTreeGenerationBinding,
  options: Readonly<{ deadlineAtMs?: number; signal?: AbortSignal }> = {}
): Promise<WindowsReadOnlyTreeAuthority> {
  if (process.platform !== 'win32') {
    throw authorityError('unsupported-platform', 'Windows generation proof is Windows-only');
  }
  assertGenerationBinding(binding);
  const proof = parseGenerationProof(proofText);
  const root = await physicalWindowsDirectory(rootPath);
  if (!sameGenerationBinding(proof.binding, binding)
      || !sameWindowsPath(proof.rootPath, root.rootPath)
      || !sameDirectoryIdentity(proof.rootIdentity, root.identity)) {
    throw authorityError('physical-identity-changed', 'Windows generation proof binding changed');
  }
  const operation = generationOperation(options, 1);
  const session = await NativeWindowsAclSession.open(operation);
  try {
    advanceWindowsAclOperation(operation, 'generation-root-readback', 0);
    if (rawSha256(session.captureDescriptor(root.rootPath, operation)) !== proof.rootAclDigest) {
      throw authorityError('acl-untrusted', 'Windows generation root ACL differs');
    }
    const authority = issueGenerationAuthority({
      entries: proof.entries,
      rootIdentity: proof.rootIdentity,
      rootPath: proof.rootPath,
      session
    });
    await authority.assertCurrent();
    return authority;
  } catch (error) {
    session.close();
    throw error;
  }
}

export async function retireWindowsReadOnlyTreeGeneration(
  rootPath: string,
  proofText: string,
  binding: WindowsReadOnlyTreeGenerationBinding,
  options: Readonly<{ deadlineAtMs?: number; signal?: AbortSignal }> = {}
): Promise<void> {
  if (process.platform !== 'win32') {
    throw authorityError('unsupported-platform', 'Windows generation retirement is Windows-only');
  }
  assertGenerationBinding(binding);
  const proof = parseGenerationProof(proofText);
  const root = await physicalWindowsDirectory(rootPath);
  if (!sameGenerationBinding(proof.binding, binding)
      || !sameWindowsPath(proof.rootPath, root.rootPath)
      || !samePhysicalObject(proof.rootIdentity, root.identity)) {
    throw authorityError('physical-identity-changed', 'Windows generation retirement binding changed');
  }
  const operation = generationOperation(options, proof.entries.length + 1);
  const session = await NativeWindowsAclSession.open(operation);
  try {
    for (const [index, expected] of [...proof.entries].reverse().entries()) {
      advanceWindowsAclOperation(operation, 'generation-entry-retire', index);
      const entryPath = path.join(root.rootPath, ...expected.relativePath.split('/'));
      const current = await physicalWindowsTreeEntry(entryPath);
      if (!samePhysicalObject(current.identity, expected.identity)) {
        throw authorityError('physical-identity-changed', 'Windows generation entry changed before retirement');
      }
      const predecessor = Buffer.from(expected.predecessorDescriptor, 'base64');
      const currentDescriptor = session.captureDescriptor(entryPath, operation);
      if (sameDirectoryIdentity(current.identity, expected.identity)) {
        session.restoreDescriptor(entryPath, predecessor, operation);
      } else if (ownerDaclSemanticDigest(currentDescriptor) !== ownerDaclSemanticDigest(predecessor)) {
        throw authorityError('acl-untrusted', 'Windows generation entry has nonterminal ACL residue');
      }
    }
    advanceWindowsAclOperation(operation, 'generation-root-retire', proof.entries.length);
    const rootPredecessor = Buffer.from(proof.rootPredecessorDescriptor, 'base64');
    const currentRootDescriptor = session.captureDescriptor(root.rootPath, operation);
    if (sameDirectoryIdentity(root.identity, proof.rootIdentity)) {
      session.restoreDescriptor(root.rootPath, rootPredecessor, operation);
    } else if (ownerDaclSemanticDigest(currentRootDescriptor) !== ownerDaclSemanticDigest(rootPredecessor)) {
      throw authorityError('acl-untrusted', 'Windows generation root has nonterminal ACL residue');
    }
  } finally {
    session.close();
  }
}

async function proveWindowsHostDirectoryAuthority(
  directoryPath: string,
  aclProbe: WindowsHostDirectoryAclProbe,
  initialAcl?: WindowsHostDirectoryAclProof,
  release: () => Promise<void> = async () => undefined,
  expectedIdentity?: DirectoryIdentity
): Promise<WindowsHostDirectoryAuthority> {
  const physical = await physicalWindowsDirectory(directoryPath);
  if (expectedIdentity && !sameDirectoryIdentity(physical.identity, expectedIdentity)) {
    throw new Error('Windows host directory authority changed before issuance');
  }
  const acl = initialAcl ?? await aclProbe(physical.rootPath);
  const physicalAfterAcl = await physicalWindowsDirectory(physical.rootPath);
  if (!sameDirectoryIdentity(physicalAfterAcl.identity, physical.identity)) {
    throw authorityError(
      'physical-identity-changed',
      'Windows host directory authority changed during ACL admission'
    );
  }
  if (!acl.ownerSid.startsWith('S-1-') || !acl.aclDigest.startsWith('sha256:')) {
    throw new Error('Windows host directory owner and ACL proof is invalid');
  }
  let released = false;
  const releaseOnce = async (): Promise<void> => {
    if (released) return;
    released = true;
    await release();
  };
  return Object.freeze({
    rootPath: physical.rootPath,
    release: releaseOnce,
    assertCurrent: async (input?: Readonly<{ deadlineAtMs?: number }>) => {
      if (released) {
        throw authorityError(
          'session-closed',
          'Windows host directory authority generation is released'
        );
      }
      try {
        const currentPhysical = await physicalWindowsDirectory(physical.rootPath);
        const currentAcl = await aclProbe(physical.rootPath, input);
        const currentPhysicalAfterAcl = await physicalWindowsDirectory(physical.rootPath);
        if (!sameDirectoryIdentity(currentPhysical.identity, physical.identity) ||
          !sameDirectoryIdentity(currentPhysicalAfterAcl.identity, physical.identity) ||
          !sameDirectoryIdentity(currentPhysicalAfterAcl.identity, currentPhysical.identity) ||
          currentAcl.ownerSid !== acl.ownerSid ||
          currentAcl.aclDigest !== acl.aclDigest) {
          throw authorityError(
            'physical-identity-changed',
            'Windows host directory authority changed'
          );
        }
      } catch (error) {
        if (error instanceof WindowsHostDirectoryAuthorityError
            && (error.failure === 'deadline-exhausted' || error.failure === 'aborted')) {
          throw error;
        }
        await releaseOnce();
        if (error instanceof WindowsHostDirectoryAuthorityError) throw error;
        throw authorityError('physical-identity-changed',
          'Windows host directory authority changed', error);
      }
    }
  });
}

/**
 * Seals one newly-published, repository-external tree for a bounded read-only
 * child lifecycle. The current principal keeps only read/execute and ACL
 * restoration rights; an explicit Everyone deny removes file, directory and
 * membership mutation rights from every ordinary entry. Links are retained by
 * the physical no-follow owner and must not be passed as ACL targets here.
 */
export async function sealExistingWindowsReadOnlyTreeAuthority(
  rootPath: string,
  entryPaths: readonly string[],
  options: Readonly<{
    deadlineAtMs?: number;
    ownership?: 'repository-external-owner' | 'repository-dependency-generation';
    ownerRootPath: string;
    recoveryCleanupBudgetMs?: number;
    repositoryRootPath: string;
    signal?: AbortSignal;
  }>
): Promise<WindowsReadOnlyTreeAuthority> {
  if (process.platform !== 'win32') {
    throw authorityError('unsupported-platform', 'Windows read-only tree authority is Windows-only');
  }
  const ownerRoot = await physicalWindowsDirectory(options.ownerRootPath);
  const repositoryRoot = await physicalWindowsDirectory(options.repositoryRootPath);
  const root = await physicalWindowsDirectory(rootPath);
  const ownership = options.ownership ?? 'repository-external-owner';
  if (ownership === 'repository-dependency-generation') {
    const rootRelativeToRepository = path.win32.relative(repositoryRoot.rootPath, root.rootPath);
    if (!sameWindowsPath(ownerRoot.rootPath, root.rootPath)
        || rootRelativeToRepository.length === 0
        || path.win32.isAbsolute(rootRelativeToRepository)
        || rootRelativeToRepository === '..'
        || rootRelativeToRepository.startsWith(`..${path.win32.sep}`)) {
      throw authorityError(
        'native-provider-unavailable',
        'Windows dependency generation must own one repository-contained root'
      );
    }
  } else {
    const rootRelativeToOwner = path.win32.relative(ownerRoot.rootPath, root.rootPath);
    if (rootRelativeToOwner.length === 0 || path.win32.isAbsolute(rootRelativeToOwner)
        || rootRelativeToOwner === '..' || rootRelativeToOwner.startsWith(`..${path.win32.sep}`)) {
      throw authorityError('native-provider-unavailable', 'Windows read-only tree escapes its owner root');
    }
    const ownerRelativeToRepository = path.win32.relative(repositoryRoot.rootPath, ownerRoot.rootPath);
    const repositoryRelativeToOwner = path.win32.relative(ownerRoot.rootPath, repositoryRoot.rootPath);
    if (ownerRelativeToRepository === '' || repositoryRelativeToOwner === ''
        || (!path.win32.isAbsolute(ownerRelativeToRepository)
          && ownerRelativeToRepository !== '..'
          && !ownerRelativeToRepository.startsWith(`..${path.win32.sep}`))
        || (!path.win32.isAbsolute(repositoryRelativeToOwner)
          && repositoryRelativeToOwner !== '..'
          && !repositoryRelativeToOwner.startsWith(`..${path.win32.sep}`))) {
      throw authorityError('native-provider-unavailable', 'Windows read-only tree owner overlaps the repository');
    }
  }
  const canonicalEntryPaths = [...new Set(entryPaths.map((entry) => path.win32.resolve(entry)))]
    .sort(compareCodeUnits);
  if (canonicalEntryPaths.length !== entryPaths.length) {
    throw authorityError('native-provider-unavailable', 'Windows read-only tree entries are not unique');
  }
  const entries = [] as Array<Awaited<ReturnType<typeof physicalWindowsTreeEntry>>>;
  for (const entryPath of canonicalEntryPaths) {
    const relative = path.win32.relative(root.rootPath, entryPath);
    if (relative.length === 0 || path.win32.isAbsolute(relative)
        || relative === '..' || relative.startsWith(`..${path.win32.sep}`)) {
      throw authorityError('native-provider-unavailable', 'Windows read-only tree entry escapes its root');
    }
    entries.push(await physicalWindowsTreeEntry(entryPath));
  }
  const admissionNotAfterMs = options.deadlineAtMs ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(admissionNotAfterMs)) {
    throw authorityError('deadline-exhausted', 'Windows read-only tree deadline is invalid');
  }
  if (Date.now() >= admissionNotAfterMs) {
    throw authorityError('deadline-exhausted', 'Windows read-only tree admission deadline is exhausted');
  }
  // The caller controls whether a new admission may start. Once admitted, the
  // physical owner derives a separate bounded phase budget from the exact ACL
  // workload; a child execution deadline cannot expire halfway through host
  // authority construction and then be reused as cleanup authority.
  const operation: WindowsAclOperation = Object.freeze({
    deadlineAtMonotonicMs: performance.now()
      + WINDOWS_READ_ONLY_TREE_ADMISSION_POLICY.maximumDurationMs,
    progress: {
      completedEntries: 0,
      phase: 'native-session-open',
      totalEntries: canonicalEntryPaths.length + 1
    },
    signal: options.signal
  });
  const recoveryCleanupBudgetMs = options.recoveryCleanupBudgetMs
    ?? WINDOWS_READ_ONLY_TREE_RECOVERY_CLEANUP_BUDGET_MS;
  if (!Number.isSafeInteger(recoveryCleanupBudgetMs)
      || recoveryCleanupBudgetMs < 1
      || recoveryCleanupBudgetMs > WINDOWS_READ_ONLY_TREE_RECOVERY_CLEANUP_BUDGET_MS) {
    throw authorityError('deadline-exhausted', 'Windows read-only tree recovery cleanup budget is invalid');
  }
  const startRecoveryOperation = (totalEntries: number): WindowsAclOperation => Object.freeze({
    deadlineAtMonotonicMs: performance.now() + recoveryCleanupBudgetMs,
    progress: {
      completedEntries: 0,
      phase: 'restore',
      totalEntries
    }
  });
  const session = await NativeWindowsAclSession.open(operation);
  const sealed = [] as Array<Readonly<{
    aclDigest: string;
    identity: DirectoryIdentity;
    originalDescriptor: Buffer | null;
    path: string;
  }>>;
  let pendingRestore: Readonly<{
    identity: DirectoryIdentity;
    originalDescriptor: Buffer | null;
    path: string;
  }> | undefined;
  let released = false;
  try {
    const sealEntry = async (
      entry: Readonly<{ identity: DirectoryIdentity; path: string }>,
      index: number
    ): Promise<void> => {
      advanceWindowsAclOperation(operation, 'descriptor-capture', index);
      const originalDescriptor = ownership === 'repository-dependency-generation'
        ? session.captureDescriptor(entry.path, operation)
        : null;
      pendingRestore = Object.freeze({
        identity: entry.identity,
        originalDescriptor,
        path: entry.path
      });
      advanceWindowsAclOperation(operation, 'acl-seal', index);
      const aclDigest = session.sealReadOnly(entry.path, operation);
      const current = entry.path === root.rootPath
        ? await physicalWindowsDirectory(entry.path)
        : await physicalWindowsTreeEntry(entry.path);
      if (!samePhysicalObject(current.identity, entry.identity)) {
        throw authorityError(
          'physical-identity-changed',
          'Windows read-only tree entry changed during ACL admission'
        );
      }
      assertReusableAclProofIdentity(current.identity);
      sealed.push(Object.freeze({
        aclDigest,
        identity: current.identity,
        originalDescriptor,
        path: entry.path
      }));
      pendingRestore = undefined;
      advanceWindowsAclOperation(operation, 'acl-seal', index + 1);
    };
    await sealEntry(Object.freeze({ identity: root.identity, path: root.rootPath }), 0);
    for (let index = 0; index < entries.length; index += 1) {
      await sealEntry(entries[index]!, index + 1);
    }
    const aclDigest = rawSha256(JSON.stringify(sealed.map(({ path: targetPath, aclDigest: digest }) => ({
      path: path.win32.relative(root.rootPath, targetPath).replaceAll('\\', '/'),
      aclDigest: digest
    }))));
    const assertCurrent = async (): Promise<void> => {
      if (released) {
        throw authorityError('session-closed', 'Windows read-only tree authority is released');
      }
      for (const expected of sealed) {
        const current = expected.path === root.rootPath
          ? await physicalWindowsDirectory(expected.path)
          : await physicalWindowsTreeEntry(expected.path);
        if (!sameDirectoryIdentity(current.identity, expected.identity)) {
          throw authorityError('physical-identity-changed', 'Windows read-only tree entry changed');
        }
        // The ACL descriptor was proven at publication. Windows ChangeTime is
        // a metadata identity and changes on security-descriptor mutation, so
        // an unchanged physical identity reuses that content-addressed proof
        // without another full GetFileSecurity traversal.
      }
    };
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      let failure: unknown;
      const cleanup = startRecoveryOperation(sealed.length);
      for (let index = sealed.length - 1; index >= 0; index -= 1) {
        const expected = sealed[index]!;
        try {
          advanceWindowsAclOperation(
            cleanup,
            'restore',
            sealed.length - 1 - index
          );
          const current = expected.path === root.rootPath
            ? await physicalWindowsDirectory(expected.path)
            : await physicalWindowsTreeEntry(expected.path);
          if (!samePhysicalObject(current.identity, expected.identity)) {
            throw authorityError(
              'physical-identity-changed',
              'Windows read-only tree entry changed before retirement'
            );
          }
          if (expected.originalDescriptor === null) {
            await session.harden(expected.path, cleanup);
          } else {
            session.restoreDescriptor(expected.path, expected.originalDescriptor, cleanup);
          }
        } catch (error) {
          failure ??= error;
        }
      }
      session.close();
      if (failure !== undefined) {
        throw authorityError('acl-untrusted', 'Windows read-only tree retirement left ACL residue', failure);
      }
    };
    await assertCurrent();
    return Object.freeze({ aclDigest, rootPath: root.rootPath, assertCurrent, release });
  } catch (error) {
    const recoveryTargets = pendingRestore === undefined
      ? sealed
      : [...sealed, pendingRestore];
    const cleanup = startRecoveryOperation(recoveryTargets.length);
    let recoveryFailure: unknown;
    for (let index = recoveryTargets.length - 1; index >= 0; index -= 1) {
      const expected = recoveryTargets[index]!;
      try {
        advanceWindowsAclOperation(
          cleanup,
          'recovery-restore',
          recoveryTargets.length - 1 - index
        );
        const current = expected.path === root.rootPath
          ? await physicalWindowsDirectory(expected.path)
          : await physicalWindowsTreeEntry(expected.path);
        if (!samePhysicalObject(current.identity, expected.identity)) {
          throw authorityError(
            'physical-identity-changed',
            'Windows read-only tree entry changed before recovery'
          );
        }
        if (expected.originalDescriptor === null) {
          await session.harden(expected.path, cleanup);
        } else {
          session.restoreDescriptor(expected.path, expected.originalDescriptor, cleanup);
        }
      } catch (cleanupError) {
        recoveryFailure ??= cleanupError;
      }
    }
    session.close();
    if (recoveryFailure !== undefined) {
      throw authorityError(
        'acl-untrusted',
        'Windows read-only tree admission recovery left ACL residue',
        new AggregateError([error, recoveryFailure])
      );
    }
    throw error;
  }
}

/**
 * Hardens one caller-owned, already-existing physical directory and returns a
 * revalidatable owner/DACL authority. This function never owns or removes the
 * directory.
 */
export async function hardenExistingWindowsHostDirectoryAuthority(
  directoryPath: string,
  options: Readonly<{
    deadlineAtMs?: number;
    knownNew?: boolean;
    signal?: AbortSignal;
  }> = {}
): Promise<WindowsHostDirectoryAuthority> {
  if (options.deadlineAtMs !== undefined && !Number.isSafeInteger(options.deadlineAtMs)) {
    throw authorityError(
      'deadline-exhausted',
      'Windows host directory authority deadline is invalid'
    );
  }
  const remainingMs = Math.max(0, Math.min(
    options.deadlineAtMs === undefined
      ? WINDOWS_ACL_PROOF_TIMEOUT_MS
      : options.deadlineAtMs - Date.now(),
    WINDOWS_ACL_PROOF_TIMEOUT_MS
  ));
  const operation: WindowsAclOperation = Object.freeze({
    deadlineAtMonotonicMs: performance.now() + remainingMs,
    signal: options.signal
  });
  assertWindowsAclOperationCurrent(operation);
  const session = await NativeWindowsAclSession.open(operation);
  try {
    const created = await physicalWindowsDirectory(directoryPath);
    assertWindowsAclOperationCurrent(operation);
    let initialAcl: WindowsHostDirectoryAclProof;
    if (options.knownNew === true) {
      await session.harden(created.rootPath, operation);
      initialAcl = await session.prove(created.rootPath, operation);
    } else {
      try {
        initialAcl = await session.prove(created.rootPath, operation);
      } catch (error) {
        if (!(error instanceof WindowsHostDirectoryAuthorityError) ||
          error.failure !== 'acl-untrusted') {
          throw error;
        }
        await session.harden(created.rootPath, operation);
        initialAcl = await session.prove(created.rootPath, operation);
      }
    }
    const hardened = await physicalWindowsDirectory(created.rootPath);
    assertWindowsAclOperationCurrent(operation);
    if (!samePhysicalObject(hardened.identity, created.identity)) {
      throw authorityError(
        'physical-identity-changed',
        'Windows existing host directory changed during ACL hardening'
      );
    }
    return await proveWindowsHostDirectoryAuthority(
      hardened.rootPath,
      async (targetPath, probeInput) => session.prove(targetPath, Object.freeze({
        deadlineAtMonotonicMs: performance.now() + Math.max(0, Math.min(
          WINDOWS_ACL_PROOF_TIMEOUT_MS,
          probeInput?.deadlineAtMs === undefined
            ? WINDOWS_ACL_PROOF_TIMEOUT_MS
            : probeInput.deadlineAtMs - Date.now()
        )),
        signal: options.signal
      })),
      initialAcl,
      async () => session.close(),
      hardened.identity
    );
  } catch (error) {
    session.close();
    throw error;
  }
}

/** Test-only deterministic owner/DACL proof seam. */
export function proveWindowsHostDirectoryAuthorityForTests(
  directoryPath: string,
  aclProbe: WindowsHostDirectoryAclProbe
): Promise<WindowsHostDirectoryAuthority> {
  return proveWindowsHostDirectoryAuthority(directoryPath, aclProbe);
}

/** Test-only lifecycle observation; never grants or validates authority. */
export function observeWindowsAclSessionLifecycleForTests(): Readonly<{
  closed: number;
  descriptorReads: number;
  opened: number;
}> {
  return Object.freeze({
    closed: nativeWindowsAclSessionCloseCount,
    descriptorReads: nativeWindowsAclDescriptorReadCount,
    opened: nativeWindowsAclSessionOpenCount
  });
}
