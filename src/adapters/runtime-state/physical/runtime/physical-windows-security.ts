import { createHash } from 'node:crypto';
import {
  WINDOWS_ACCESS_ALLOWED_ACE_TYPE, WINDOWS_ACCESS_DENIED_ACE_TYPE,
  WINDOWS_DACL_SECURITY_INFORMATION, WINDOWS_DELETE, WINDOWS_EVERYONE_SID,
  WINDOWS_FILE_DELETE_CHILD, WINDOWS_OWNER_SECURITY_INFORMATION,
  WINDOWS_PROTECTED_DACL_SECURITY_INFORMATION, WINDOWS_SE_DACL_PROTECTED,
  WINDOWS_UNPROTECTED_DACL_SECURITY_INFORMATION,
  requireWindowsAdvapi32, requireWindowsKernel32, windowsWide
} from './physical-no-follow-native.ts';
import { physicalError } from './physical-no-follow-shared.ts';

/** Windows security-descriptor projection shared by relocation and retirement. */

export function windowsSecurityDescriptorBytes(targetPath: string): Buffer {
  const advapi = requireWindowsAdvapi32();
  const required = Buffer.alloc(4);
  const information = WINDOWS_OWNER_SECURITY_INFORMATION | WINDOWS_DACL_SECURITY_INFORMATION;
  const first = advapi.symbols.GetFileSecurityW(windowsWide(targetPath), information, null, 0, required);
  const length = required.readUInt32LE(0);
  if (first !== 0 || length < 20 || length > 65_535) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation security descriptor length is invalid.');
  }
  const descriptor = Buffer.alloc(length);
  if (advapi.symbols.GetFileSecurityW(windowsWide(targetPath), information, descriptor, descriptor.length, required) === 0) {
    const win32 = requireWindowsKernel32().symbols.GetLastError();
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', `Windows legacy relocation security descriptor cannot be read (Win32 ${win32}).`);
  }
  return descriptor;
}

export function windowsWriteSecurityDescriptorBytes(targetPath: string, descriptor: Buffer): void {
  if (descriptor.length < 20) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation security descriptor is truncated.');
  }
  const protection = (descriptor.readUInt16LE(2) & WINDOWS_SE_DACL_PROTECTED) === 0
    ? WINDOWS_UNPROTECTED_DACL_SECURITY_INFORMATION
    : WINDOWS_PROTECTED_DACL_SECURITY_INFORMATION;
  if (requireWindowsAdvapi32().symbols.SetFileSecurityW(
    windowsWide(targetPath),
    WINDOWS_DACL_SECURITY_INFORMATION | protection,
    descriptor
  ) === 0) {
    const win32 = requireWindowsKernel32().symbols.GetLastError();
    throw physicalError('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED', `Windows legacy relocation security descriptor cannot be published (Win32 ${win32}).`);
  }
}

export function windowsHandleSecurityDescriptorBytes(handle: bigint, label: string): Buffer {
  const advapi = requireWindowsAdvapi32();
  const required = Buffer.alloc(4);
  const information = WINDOWS_OWNER_SECURITY_INFORMATION | WINDOWS_DACL_SECURITY_INFORMATION;
  const first = advapi.symbols.GetKernelObjectSecurity(handle, information, null, 0, required);
  const length = required.readUInt32LE(0);
  if (first !== 0 || length < 20 || length > 65_535) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} retained security descriptor length is invalid.`
    );
  }
  const descriptor = Buffer.alloc(length);
  if (advapi.symbols.GetKernelObjectSecurity(
    handle,
    information,
    descriptor,
    descriptor.length,
    required
  ) === 0) {
    const win32 = requireWindowsKernel32().symbols.GetLastError();
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} retained security descriptor cannot be read (Win32 ${win32}).`
    );
  }
  return descriptor;
}

export function windowsWriteHandleSecurityDescriptorBytes(
  handle: bigint,
  descriptor: Buffer,
  label: string
): void {
  if (descriptor.length < 20) {
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE',
      `${label} retained security descriptor is truncated.`
    );
  }
  const protection = (descriptor.readUInt16LE(2) & WINDOWS_SE_DACL_PROTECTED) === 0
    ? WINDOWS_UNPROTECTED_DACL_SECURITY_INFORMATION
    : WINDOWS_PROTECTED_DACL_SECURITY_INFORMATION;
  if (requireWindowsAdvapi32().symbols.SetKernelObjectSecurity(
    handle,
    WINDOWS_DACL_SECURITY_INFORMATION | protection,
    descriptor
  ) === 0) {
    const win32 = requireWindowsKernel32().symbols.GetLastError();
    throw physicalError(
      'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED',
      `${label} retained security descriptor cannot be published (Win32 ${win32}).`
    );
  }
}

export function windowsSidAt(descriptor: Buffer, offset: number): Buffer {
  if (offset < 0 || offset + 8 > descriptor.length) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation SID is truncated.');
  }
  const length = 8 + descriptor.readUInt8(offset + 1) * 4;
  if (offset + length > descriptor.length) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation SID exceeds its descriptor.');
  }
  return descriptor.subarray(offset, offset + length);
}

export function windowsTemporaryRelocationDescriptor(predecessor: Buffer): Buffer {
  const temporary = Buffer.from(predecessor);
  const ownerOffset = temporary.readUInt32LE(4);
  const daclOffset = temporary.readUInt32LE(16);
  if (ownerOffset === 0 || daclOffset === 0 || daclOffset + 8 > temporary.length) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation descriptor has no exact owner/DACL.');
  }
  const ownerSid = windowsSidAt(temporary, ownerOffset);
  const aceCount = temporary.readUInt16LE(daclOffset + 4);
  let aceOffset = daclOffset + 8;
  let narrowedEveryoneDeny = false;
  let ownerDelete = false;
  for (let index = 0; index < aceCount; index += 1) {
    if (aceOffset + 8 > temporary.length) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation ACE is truncated.');
    }
    const aceType = temporary.readUInt8(aceOffset);
    const aceSize = temporary.readUInt16LE(aceOffset + 2);
    if (aceSize < 20 || aceOffset + aceSize > temporary.length) {
      throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation ACE size is invalid.');
    }
    const aceSid = windowsSidAt(temporary, aceOffset + 8);
    const mask = temporary.readUInt32LE(aceOffset + 4);
    if (aceType === WINDOWS_ACCESS_DENIED_ACE_TYPE && aceSid.equals(WINDOWS_EVERYONE_SID)) {
      const narrowed = mask & ~(WINDOWS_DELETE | WINDOWS_FILE_DELETE_CHILD);
      if (narrowed === mask) {
        throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation descriptor has no delete deny to narrow.');
      }
      temporary.writeUInt32LE(narrowed >>> 0, aceOffset + 4);
      narrowedEveryoneDeny = true;
    } else if (aceType === WINDOWS_ACCESS_ALLOWED_ACE_TYPE && aceSid.equals(ownerSid)) {
      temporary.writeUInt32LE((mask | WINDOWS_DELETE) >>> 0, aceOffset + 4);
      ownerDelete = true;
    }
    aceOffset += aceSize;
  }
  if (!narrowedEveryoneDeny || !ownerDelete || temporary.equals(predecessor)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE', 'Windows legacy relocation descriptor cannot be projected without changing unrelated authority.');
  }
  return temporary;
}

export function windowsRelocationDescriptorDigest(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
