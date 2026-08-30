import path from 'node:path';

export type WindowsKnownFolder = 'local-app-data' | 'program-data' | 'roaming-app-data';

// Windows KNOWNFOLDERID values are an external ABI, encoded in the in-memory
// GUID byte order expected by SHGetKnownFolderPath.
const WINDOWS_KNOWN_FOLDER_GUID_BYTES = Object.freeze({
  'local-app-data': Object.freeze([
    0x85, 0x27, 0xb3, 0xf1, 0xba, 0x6f, 0xcf, 0x4f,
    0x9d, 0x55, 0x7b, 0x8e, 0x7f, 0x15, 0x70, 0x91
  ]),
  'program-data': Object.freeze([
    0x82, 0x5d, 0xab, 0x62, 0xc1, 0xfd, 0xc3, 0x4d,
    0xa9, 0xdd, 0x07, 0x0d, 0x1d, 0x49, 0x5d, 0x97
  ]),
  'roaming-app-data': Object.freeze([
    0xdb, 0x85, 0xb6, 0x3e, 0xf9, 0x65, 0xf6, 0x4c,
    0xa0, 0x3a, 0xe3, 0xef, 0x65, 0x72, 0x9f, 0x3d
  ])
} satisfies Readonly<Record<WindowsKnownFolder, readonly number[]>>);

function windowsKnownFolderError(folder: WindowsKnownFolder, detail: string): Error {
  return new Error(`Windows known folder ${folder} is unavailable: ${detail}`);
}

/**
 * Resolve a user-scoped Windows filesystem root from the operating-system
 * Known Folder owner. Environment variables are deliberately not accepted as
 * authority: service, login and isolated process environments may omit or
 * redirect them while the user token still has one canonical folder binding.
 */
export async function resolveWindowsKnownFolderPath(
  folder: WindowsKnownFolder
): Promise<string> {
  if (process.platform !== 'win32') {
    throw windowsKnownFolderError(folder, 'unsupported platform');
  }
  const { dlopen, FFIType, ptr, read, toBuffer } = await import('bun:ffi');
  type Pointer = import('bun:ffi').Pointer;
  const shell32 = dlopen('shell32.dll', {
    SHGetKnownFolderPath: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32
    }
  } as const);
  const ole32 = dlopen('ole32.dll', {
    CoTaskMemFree: { args: [FFIType.ptr], returns: FFIType.void }
  } as const);
  const kernel32 = dlopen('kernel32.dll', {
    lstrlenW: { args: [FFIType.ptr], returns: FFIType.i32 }
  } as const);
  const guid = Buffer.from(WINDOWS_KNOWN_FOLDER_GUID_BYTES[folder]);
  const resultPointer = Buffer.alloc(8);
  try {
    const hresult = shell32.symbols.SHGetKnownFolderPath(
      ptr(guid),
      0,
      null,
      ptr(resultPointer)
    );
    if (hresult !== 0) {
      throw windowsKnownFolderError(folder, `HRESULT 0x${(hresult >>> 0).toString(16)}`);
    }
    const valuePointer = read.ptr(ptr(resultPointer)) as Pointer;
    if (!valuePointer) {
      throw windowsKnownFolderError(folder, 'null result');
    }
    try {
      const characterLength = kernel32.symbols.lstrlenW(valuePointer);
      if (!Number.isSafeInteger(characterLength) || characterLength < 1 || characterLength > 32_767) {
        throw windowsKnownFolderError(folder, 'invalid UTF-16 length');
      }
      const value = Buffer.from(toBuffer(valuePointer, 0, characterLength * 2))
        .toString('utf16le');
      const canonical = path.win32.resolve(value);
      if (!path.win32.isAbsolute(value) || canonical !== value || value.includes('\0')) {
        throw windowsKnownFolderError(folder, 'noncanonical path');
      }
      return canonical;
    } finally {
      ole32.symbols.CoTaskMemFree(valuePointer);
    }
  } finally {
    shell32.close();
    ole32.close();
    kernel32.close();
  }
}
