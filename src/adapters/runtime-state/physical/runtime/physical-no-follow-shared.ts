import path from 'node:path';

import { PhysicalNoFollowError, type PhysicalDirectoryIdentity, type PhysicalNoFollowFailureCode } from './physical-no-follow-contract.ts';



/** Shared platform-neutral invariants for the physical no-follow provider. No filesystem effect or native FFI lives here. */

export const NO_FOLLOW_FILE_READ_LIMIT_BYTES = 64 * 1024 * 1024;

export function codeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code.toUpperCase() : null;
}

export function absent(error: unknown): boolean {
  return codeOf(error) === 'ENOENT';
}

export function physicalError(
  code: PhysicalNoFollowFailureCode,
  message: string,
  cause?: unknown
): PhysicalNoFollowError {
  return new PhysicalNoFollowError(code, message, cause === undefined ? undefined : { cause });
}

export function physicalWin32Error(
  code: PhysicalNoFollowFailureCode,
  message: string,
  win32Code: number
): PhysicalNoFollowError {
  return new PhysicalNoFollowError(code, message, {
    nativeFailure: Object.freeze({
      namespace: 'win32' as const,
      code: win32Code,
      failureClass: win32Code === 5
        ? 'access-denied' as const
        : win32Code === 1_920
          ? 'access-unavailable' as const
          : 'other' as const
    })
  });
}

export function requireAbsoluteDirectoryPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || !path.isAbsolute(value)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', `${label} must be an absolute path.`);
  }
  return path.resolve(value);
}

export function identityFromStats(input: {
  readonly absolutePath: string;
  readonly finalPath: string;
  readonly device: bigint | number | string;
  readonly inode: bigint | number | string;
  readonly objectId: string;
}): PhysicalDirectoryIdentity {
  return Object.freeze({
    path: input.absolutePath,
    finalPath: input.finalPath,
    device: String(input.device),
    inode: String(input.inode),
    objectId: input.objectId
  });
}

export function sameIdentity(left: PhysicalDirectoryIdentity, right: PhysicalDirectoryIdentity): boolean {
  return left.path === right.path && left.finalPath === right.finalPath &&
    left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

export function ensureOrdinaryDirectorySegment(segment: string): void {
  if (typeof segment !== 'string' || segment.length === 0 || segment.length > 255
    || segment === '.' || segment === '..' || /[\\/\0]/u.test(segment)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Ordinary no-follow directory segment is invalid.');
  }
  if (process.platform === 'win32') {
    const base = segment.split('.')[0]!.toLocaleUpperCase('en-US');
    if (/[:<>"|?*]/u.test(segment) || /[ .]$/u.test(segment)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)) {
      throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Ordinary no-follow directory segment is invalid on Windows.');
    }
  }
}

export function ensureLeafName(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value === '.' || value === '..' ||
    value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw physicalError('PHYSICAL_NO_FOLLOW_UNSAFE_PATH', 'Durable publication file name must be one ordinary leaf name.');
  }
  if (process.platform === 'win32') ensureOrdinaryDirectorySegment(value);
}

export function normalizePhysicalLinkTarget(value: string, parentPath: string): string {
  const candidate = path.isAbsolute(value) ? value : path.resolve(parentPath, value);
  const resolved = path.resolve(candidate);
  if (process.platform !== 'win32') return resolved;
  const withoutDevicePrefix = resolved.startsWith('\\\\?\\UNC\\')
    ? `\\\\${resolved.slice('\\\\?\\UNC\\'.length)}`
    : resolved.startsWith('\\\\?\\')
      ? resolved.slice('\\\\?\\'.length)
      : resolved;
  return withoutDevicePrefix.toLocaleLowerCase('en-US');
}

export function assertPhysicalLinkTarget(
  actual: string,
  expected: string,
  parentPath: string,
  label: string
): void {
  if (normalizePhysicalLinkTarget(actual, parentPath) !== normalizePhysicalLinkTarget(expected, parentPath)) {
    throw physicalError('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED', `${label} target changed.`);
  }
}
