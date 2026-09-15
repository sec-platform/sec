import path from 'node:path';

export type WindowsKnownFolder =
  | 'local-app-data'
  | 'profile'
  | 'program-files'
  | 'program-data'
  | 'roaming-app-data'
  | 'windows';

export type WindowsKnownFolderFailureReason =
  | 'hresult-failed'
  | 'invalid-result'
  | 'unsupported-platform';

export class WindowsKnownFolderError extends Error {
  constructor(
    readonly folder: WindowsKnownFolder,
    readonly reason: WindowsKnownFolderFailureReason,
    detail: string
  ) {
    super(`Windows known folder ${folder} is unavailable: ${detail}`);
    this.name = 'WindowsKnownFolderError';
  }
}

// Windows KNOWNFOLDERID values are an external ABI, encoded in the in-memory
// GUID byte order expected by SHGetKnownFolderPath.
const WINDOWS_KNOWN_FOLDER_GUID_BYTES = Object.freeze({
  'local-app-data': Object.freeze([
    0x85, 0x27, 0xb3, 0xf1, 0xba, 0x6f, 0xcf, 0x4f,
    0x9d, 0x55, 0x7b, 0x8e, 0x7f, 0x15, 0x70, 0x91
  ]),
  'profile': Object.freeze([
    0x8f, 0x85, 0x6c, 0x5e, 0x22, 0x0e, 0x60, 0x47,
    0x9a, 0xfe, 0xea, 0x33, 0x17, 0xb6, 0x71, 0x73
  ]),
  'program-files': Object.freeze([
    0xb6, 0x63, 0x5e, 0x90, 0xbf, 0xc1, 0x4e, 0x49,
    0xb2, 0x9c, 0x65, 0xb7, 0x32, 0xd3, 0xd2, 0x1a
  ]),
  'program-data': Object.freeze([
    0x82, 0x5d, 0xab, 0x62, 0xc1, 0xfd, 0xc3, 0x4d,
    0xa9, 0xdd, 0x07, 0x0d, 0x1d, 0x49, 0x5d, 0x97
  ]),
  'roaming-app-data': Object.freeze([
    0xdb, 0x85, 0xb6, 0x3e, 0xf9, 0x65, 0xf6, 0x4c,
    0xa0, 0x3a, 0xe3, 0xef, 0x65, 0x72, 0x9f, 0x3d
  ]),
  'windows': Object.freeze([
    0x04, 0xf4, 0x8b, 0xf3, 0x43, 0x1d, 0xf2, 0x42,
    0x93, 0x05, 0x67, 0xde, 0x0b, 0x28, 0xfc, 0x23
  ])
} satisfies Readonly<Record<WindowsKnownFolder, readonly number[]>>);

function windowsKnownFolderError(
  folder: WindowsKnownFolder,
  reason: WindowsKnownFolderFailureReason,
  detail: string
): WindowsKnownFolderError {
  return new WindowsKnownFolderError(folder, reason, detail);
}

/**
 * Resolve a Windows filesystem root from the operating-system
 * Known Folder owner. Caller-supplied path strings are deliberately not
 * accepted as authority. SHGetKnownFolderPath may itself consult or expand
 * the coherent current-user process environment according to Windows folder
 * registration; this boundary does not claim that the OS result is
 * independent of those native inputs.
 */
export async function resolveWindowsKnownFolderPath(
  folder: WindowsKnownFolder
): Promise<string> {
  if (process.platform !== 'win32') {
    throw windowsKnownFolderError(folder, 'unsupported-platform', 'unsupported platform');
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
      throw windowsKnownFolderError(
        folder,
        'hresult-failed',
        `HRESULT 0x${(hresult >>> 0).toString(16)}`
      );
    }
    const valuePointer = read.ptr(ptr(resultPointer)) as Pointer;
    if (!valuePointer) {
      throw windowsKnownFolderError(folder, 'invalid-result', 'null result');
    }
    try {
      const characterLength = kernel32.symbols.lstrlenW(valuePointer);
      if (!Number.isSafeInteger(characterLength) || characterLength < 1 || characterLength > 32_767) {
        throw windowsKnownFolderError(folder, 'invalid-result', 'invalid UTF-16 length');
      }
      const value = Buffer.from(toBuffer(valuePointer, 0, characterLength * 2))
        .toString('utf16le');
      const canonical = path.win32.resolve(value);
      if (!path.win32.isAbsolute(value) || canonical !== value || value.includes('\0')) {
        throw windowsKnownFolderError(folder, 'invalid-result', 'noncanonical path');
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
