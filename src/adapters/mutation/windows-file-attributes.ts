import path from 'node:path';

import type { SemanticMutationWindowsFileAttributes } from '../../semantics/mutation/types.ts';

import { canonicalEquals } from '../../compiler/semantic-mutation/canonical.ts';

const FILE_ATTRIBUTE_NORMAL = 0x0000_0080;
const FILE_ATTRIBUTE_READONLY = 0x0000_0001;
const FILE_ATTRIBUTE_HIDDEN = 0x0000_0002;
const FILE_ATTRIBUTE_SYSTEM = 0x0000_0004;
const FILE_ATTRIBUTE_ARCHIVE = 0x0000_0020;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x0000_0400;
const MUTATION_WINDOWS_ATTRIBUTE_MASK =
  FILE_ATTRIBUTE_READONLY |
  FILE_ATTRIBUTE_HIDDEN |
  FILE_ATTRIBUTE_SYSTEM |
  FILE_ATTRIBUTE_ARCHIVE;
const INVALID_FILE_ATTRIBUTES = 0xffff_ffff;

type WindowsFileAttributeReader = (filePath: string) => number;

let windowsFileAttributeReaderPromise: Promise<WindowsFileAttributeReader> | undefined;

function windowsFileOperationError(operation: string, errorCode: number): NodeJS.ErrnoException {
  const error = new Error(`${operation} failed (Win32 ${errorCode})`) as NodeJS.ErrnoException;
  error.code = `WIN32_${errorCode}`;
  return error;
}

function wideWindowsPath(filePath: string): Buffer {
  return Buffer.from(`${path.toNamespacedPath(path.resolve(filePath))}\0`, 'utf16le');
}

function attributesFromMask(mask: number): SemanticMutationWindowsFileAttributes {
  return Object.freeze({
    readOnly: (mask & FILE_ATTRIBUTE_READONLY) !== 0,
    hidden: (mask & FILE_ATTRIBUTE_HIDDEN) !== 0,
    system: (mask & FILE_ATTRIBUTE_SYSTEM) !== 0,
    archive: (mask & FILE_ATTRIBUTE_ARCHIVE) !== 0
  });
}

async function windowsFileAttributeReader(): Promise<WindowsFileAttributeReader> {
  windowsFileAttributeReaderPromise ??= (async () => {
    const { dlopen, FFIType } = await import('bun:ffi');
    const kernel32 = dlopen('kernel32.dll', {
      GetFileAttributesW: {
        args: [FFIType.ptr],
        returns: FFIType.u32
      },
      GetLastError: {
        args: [],
        returns: FFIType.u32
      }
    } as const);

    // Directory identity checks are deliberately repeated around every
    // security-sensitive filesystem operation. Reuse only the immutable
    // kernel32 binding; never cache an attribute result or a path verdict.
    return (filePath: string): number => {
      const attributes = kernel32.symbols.GetFileAttributesW(wideWindowsPath(filePath));
      if (attributes === INVALID_FILE_ATTRIBUTES) {
        throw windowsFileOperationError('Reading Windows file attributes', kernel32.symbols.GetLastError());
      }
      return attributes;
    };
  })();
  return windowsFileAttributeReaderPromise;
}

async function readWindowsFileAttributeMask(filePath: string): Promise<number> {
  return (await windowsFileAttributeReader())(filePath);
}

export async function readSemanticMutationWindowsFileAttributes(
  filePath: string
): Promise<SemanticMutationWindowsFileAttributes | null> {
  if (process.platform !== 'win32') return null;
  return attributesFromMask(await readWindowsFileAttributeMask(filePath));
}

export async function isSemanticMutationWindowsReparsePoint(filePath: string): Promise<boolean> {
  return process.platform === 'win32' &&
    ((await readWindowsFileAttributeMask(filePath)) & FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
}

export async function applySemanticMutationWindowsFileAttributes(
  filePath: string,
  attributes: SemanticMutationWindowsFileAttributes | null
): Promise<void> {
  if (process.platform !== 'win32') {
    if (attributes !== null) throw new Error('Windows attributes are invalid on a non-Windows workspace');
    return;
  }
  if (!attributes) throw new Error('Windows restoration attributes are missing');
  const current = await readWindowsFileAttributeMask(filePath);
  let updated = current & ~MUTATION_WINDOWS_ATTRIBUTE_MASK;
  if (attributes.readOnly) updated |= FILE_ATTRIBUTE_READONLY;
  if (attributes.hidden) updated |= FILE_ATTRIBUTE_HIDDEN;
  if (attributes.system) updated |= FILE_ATTRIBUTE_SYSTEM;
  if (attributes.archive) updated |= FILE_ATTRIBUTE_ARCHIVE;
  if ((updated & ~FILE_ATTRIBUTE_NORMAL) !== 0) updated &= ~FILE_ATTRIBUTE_NORMAL;
  if (updated === 0) updated = FILE_ATTRIBUTE_NORMAL;

  const { dlopen, FFIType } = await import('bun:ffi');
  const kernel32 = dlopen('kernel32.dll', {
    SetFileAttributesW: {
      args: [FFIType.ptr, FFIType.u32],
      returns: FFIType.i32
    },
    GetLastError: {
      args: [],
      returns: FFIType.u32
    }
  } as const);
  try {
    if (kernel32.symbols.SetFileAttributesW(wideWindowsPath(filePath), updated) === 0) {
      throw windowsFileOperationError('Applying Windows file attributes', kernel32.symbols.GetLastError());
    }
  } finally {
    kernel32.close();
  }
  const restored = await readSemanticMutationWindowsFileAttributes(filePath);
  if (!canonicalEquals(restored, attributes)) {
    throw new Error('Windows file attributes were not restored exactly');
  }
}
