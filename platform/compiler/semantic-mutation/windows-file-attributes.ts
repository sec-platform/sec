import { rename } from 'node:fs/promises';
import path from 'node:path';

import type { SemanticMutationWindowsFileAttributesV1 } from '../../shared/semantic-mutation-types.ts';

import { canonicalEquals } from './canonical.ts';

const DELETE_ACCESS = 0x0001_0000;
const FILE_SHARE_READ_WRITE_DELETE = 0x0000_0007;
const OPEN_EXISTING = 3;
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
const FILE_RENAME_INFO_EX = 22;
const FILE_RENAME_INFO_EX_SIZE_64_BIT = 24;
const FILE_RENAME_FLAG_REPLACE_IF_EXISTS = 0x0000_0001;
const FILE_RENAME_FLAG_POSIX_SEMANTICS = 0x0000_0002;
const FILE_RENAME_FLAG_IGNORE_READONLY_ATTRIBUTE = 0x0000_0040;
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;

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

/**
 * Atomically replace an existing Windows file even when its readonly attribute
 * is set. Clearing the live attribute before rename would create a crash window,
 * so use FileRenameInfoEx with POSIX replacement visibility and the kernel's
 * ignore-readonly flag instead.
 */
export async function replaceSemanticMutationFileAtomically(
  replacementPath: string,
  targetPath: string
): Promise<void> {
  if (process.platform !== 'win32') {
    await rename(replacementPath, targetPath);
    return;
  }
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    throw new Error(`Atomic readonly replacement is unsupported on Windows ${process.arch}`);
  }

  const { dlopen, FFIType } = await import('bun:ffi');
  const kernel32 = dlopen('kernel32.dll', {
    CreateFileW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
      returns: FFIType.u64
    },
    SetFileInformationByHandle: {
      args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32
    },
    CloseHandle: {
      args: [FFIType.u64],
      returns: FFIType.i32
    },
    GetLastError: {
      args: [],
      returns: FFIType.u32
    }
  } as const);

  const replacementWide = wideWindowsPath(replacementPath);
  const targetName = Buffer.from(path.resolve(targetPath), 'utf16le');
  // FILE_RENAME_INFO_EX on x64 and arm64 Windows: Flags@0, RootDirectory@8,
  // FileNameLength@16, FileName@20, and sizeof(struct)=24 after alignment.
  // Windows requires the information buffer to include the full base struct
  // in addition to the counted UTF-16 filename.
  const renameInfo = Buffer.alloc(FILE_RENAME_INFO_EX_SIZE_64_BIT + targetName.byteLength);
  const view = new DataView(renameInfo.buffer, renameInfo.byteOffset, renameInfo.byteLength);
  view.setUint32(
    0,
    FILE_RENAME_FLAG_REPLACE_IF_EXISTS |
      FILE_RENAME_FLAG_POSIX_SEMANTICS |
      FILE_RENAME_FLAG_IGNORE_READONLY_ATTRIBUTE,
    true
  );
  view.setUint32(16, targetName.byteLength, true);
  renameInfo.set(targetName, 20);

  let handle = INVALID_HANDLE_VALUE;
  try {
    handle = kernel32.symbols.CreateFileW(
      replacementWide,
      DELETE_ACCESS,
      FILE_SHARE_READ_WRITE_DELETE,
      null,
      OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL,
      null
    );
    if (handle === INVALID_HANDLE_VALUE) {
      throw windowsFileOperationError('Opening atomic replacement file', kernel32.symbols.GetLastError());
    }
    if (kernel32.symbols.SetFileInformationByHandle(
      handle,
      FILE_RENAME_INFO_EX,
      renameInfo,
      renameInfo.byteLength
    ) === 0) {
      throw windowsFileOperationError('Atomic readonly file replacement', kernel32.symbols.GetLastError());
    }
  } finally {
    if (handle !== INVALID_HANDLE_VALUE) kernel32.symbols.CloseHandle(handle);
    kernel32.close();
  }
}

function attributesFromMask(mask: number): SemanticMutationWindowsFileAttributesV1 {
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
): Promise<SemanticMutationWindowsFileAttributesV1 | null> {
  if (process.platform !== 'win32') return null;
  return attributesFromMask(await readWindowsFileAttributeMask(filePath));
}

export async function isSemanticMutationWindowsReparsePoint(filePath: string): Promise<boolean> {
  return process.platform === 'win32' &&
    ((await readWindowsFileAttributeMask(filePath)) & FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
}

export async function applySemanticMutationWindowsFileAttributes(
  filePath: string,
  attributes: SemanticMutationWindowsFileAttributesV1 | null
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
