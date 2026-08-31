import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import { rawSha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';

type DirectoryIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
}>;

export type WindowsHostDirectoryAclProof = Readonly<{
  aclDigest: string;
  ownerSid: string;
}>;

export type WindowsHostDirectoryAclProbe = (
  directoryPath: string
) => Promise<WindowsHostDirectoryAclProof>;

export type WindowsHostDirectoryAuthority = Readonly<{
  assertCurrent: () => Promise<void>;
  release: () => Promise<void>;
  rootPath: string;
}>;

const WINDOWS_ACL_PROOF_TIMEOUT_MS = 10_000;
const WINDOWS_POINTER_BYTES = 8;
const NAME_SAM_COMPATIBLE = 2;
const OWNER_SECURITY_INFORMATION = 0x0000_0001;
const DACL_SECURITY_INFORMATION = 0x0000_0004;
const SE_DACL_PRESENT = 0x0004;
const SE_DACL_PROTECTED = 0x1000;
const SE_SELF_RELATIVE = 0x8000;
const ACL_REVISION = 2;
const CONTAINER_INHERIT_ACE = 0x02;
const OBJECT_INHERIT_ACE = 0x01;
const FILE_ALL_ACCESS = 0x001f_01ff;
const ACCESS_ALLOWED_ACE_TYPES = new Set([0, 5, 9, 11]);
const ACCESS_ALLOWED_COMPOUND_ACE_TYPE = 4;
const ACE_OBJECT_TYPE_PRESENT = 0x0000_0001;
const ACE_INHERITED_OBJECT_TYPE_PRESENT = 0x0000_0002;
const WINDOWS_WRITE_ACCESS_MASK = 0x500d_0156;
const TRUSTED_WINDOWS_WRITER_SIDS = new Set(['S-1-5-18', 'S-1-5-32-544']);

export type WindowsHostDirectoryAuthorityFailure =
  | 'aborted'
  | 'acl-untrusted'
  | 'deadline-exhausted'
  | 'native-provider-unavailable'
  | 'physical-identity-changed'
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
  deadlineAtMs: number;
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
  if (Date.now() >= operation.deadlineAtMs) {
    throw authorityError(
      'deadline-exhausted',
      'Windows host directory authority deadline was exhausted'
    );
  }
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
      CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE,
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
  readonly dev: bigint | number;
  readonly ino: bigint | number;
  readonly mode: bigint | number;
}): DirectoryIdentity {
  return Object.freeze({
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode)
  });
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
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
    assertCurrent: async () => {
      if (released) {
        throw authorityError(
          'session-closed',
          'Windows host directory authority generation is released'
        );
      }
      try {
        const currentPhysical = await physicalWindowsDirectory(physical.rootPath);
        const currentAcl = await aclProbe(physical.rootPath);
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
        await releaseOnce();
        if (error instanceof WindowsHostDirectoryAuthorityError) throw error;
        throw authorityError('physical-identity-changed',
          'Windows host directory authority changed', error);
      }
    }
  });
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
  const operationForCall = (): WindowsAclOperation => Object.freeze({
    deadlineAtMs: Math.min(
      options.deadlineAtMs ?? Number.MAX_SAFE_INTEGER,
      Date.now() + WINDOWS_ACL_PROOF_TIMEOUT_MS
    ),
    signal: options.signal
  });
  const operation = operationForCall();
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
    if (!sameDirectoryIdentity(hardened.identity, created.identity)) {
      throw authorityError(
        'physical-identity-changed',
        'Windows existing host directory changed during ACL hardening'
      );
    }
    return await proveWindowsHostDirectoryAuthority(
      hardened.rootPath,
      async (targetPath) => session.prove(targetPath, operationForCall()),
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
  opened: number;
}> {
  return Object.freeze({
    closed: nativeWindowsAclSessionCloseCount,
    opened: nativeWindowsAclSessionOpenCount
  });
}
