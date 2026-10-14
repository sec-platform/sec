import { dlopen, FFIType, ptr, read } from 'bun:ffi';

export type WindowsKernelBootFailureReason = 'unsupported-platform' | 'invalid-result' | 'native-failure' | 'not-full-boot';

export class WindowsKernelBootError extends Error {
  constructor(readonly reason: WindowsKernelBootFailureReason, detail: string) {
    super(`Windows kernel boot sequence is unavailable: ${detail}`);
    this.name = 'WindowsKernelBootError';
  }
}

// Windows AMD64 shared-user-data ABI (ntddk.h): the read-only user mapping is
// 0x7ffe0000; KUSER_SHARED_DATA.BootId is the ULONG at offset 0x2c4.
// https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntddk/ns-ntddk-kuser_shared_data
// BootId is the OS-loader boot-attempt sequence, not a process identity or a
// release receipt. Callers must reject missing, equal, decreasing or wrapped
// observations when using it to constrain recovery.
const WINDOWS_AMD64_SHARED_USER_DATA = 0x7ffe_0000;
const WINDOWS_AMD64_BOOT_ID_OFFSET = 0x2c4;

/** Observe the native sequence only; this function does not authorize cleanup. */
function observeWindowsKernelBootSequence(): number {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new WindowsKernelBootError('unsupported-platform', `${process.platform}/${process.arch}`);
  }
  const sequence = read.u32(WINDOWS_AMD64_SHARED_USER_DATA, WINDOWS_AMD64_BOOT_ID_OFFSET);
  if (!Number.isInteger(sequence) || sequence <= 0 || sequence > 0xffff_ffff) {
    throw new WindowsKernelBootError('invalid-result', 'BootId is not a nonzero ULONG');
  }
  return sequence;
}

export interface WindowsKernelBootBoundary {
  readonly sequence: number;
  readonly fullBootEventRecordId: string;
}

/**
 * Observe the latest Kernel-Boot event and reject hibernation/fast startup.
 * Recovery additionally requires both native observations to advance beyond
 * its retained checkpoint; this observation alone does not release resources.
 */
export function observeWindowsKernelBootBoundary(): WindowsKernelBootBoundary {
  const sequence = observeWindowsKernelBootSequence();
  const kernel = (() => {
    try {
      return dlopen('kernel32.dll', { GetLastError: { args: [], returns: FFIType.u32 } } as const);
    } catch (error) {
      throw new WindowsKernelBootError('native-failure', `kernel32 unavailable: ${String(error)}`);
    }
  })();
  const events = (() => {
    try {
      return dlopen('wevtapi.dll', {
    EvtQuery: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.u64 },
    EvtNext: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
    EvtCreateRenderContext: { args: [FFIType.u32, FFIType.ptr, FFIType.u32], returns: FFIType.u64 },
    EvtRender: { args: [FFIType.u64, FFIType.u64, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    EvtClose: { args: [FFIType.u64], returns: FFIType.i32 }
      } as const);
    } catch (error) {
      kernel.close();
      throw new WindowsKernelBootError('native-failure', `wevtapi unavailable: ${String(error)}`);
    }
  })();
  const handles: bigint[] = [];
  let failure: unknown;
  let result: WindowsKernelBootBoundary | undefined;
  const nativeFailure = (operation: string): WindowsKernelBootError =>
    new WindowsKernelBootError('native-failure', `${operation}: Win32 ${kernel.symbols.GetLastError()}`);
  try {
    const channel = Buffer.from('System\0', 'utf16le');
    const selector = Buffer.from("*[System[Provider[@Guid='{15ca44ff-4d7a-4baa-bba5-0998955e531e}'] and EventID=27]]\0", 'utf16le');
    // EvtQueryChannelPath | EvtQueryReverseDirection: inspect the latest event,
    // including unsupported versions, rather than skipping to an older match.
    const query = BigInt(events.symbols.EvtQuery(0n, ptr(channel), ptr(selector), 0x201));
    if (query === 0n) throw nativeFailure('EvtQuery');
    handles.push(query);
    const eventBuffer = Buffer.alloc(8);
    const returned = Buffer.alloc(4);
    if (events.symbols.EvtNext(query, 1, ptr(eventBuffer), 0, 0, ptr(returned)) === 0) {
      throw nativeFailure('EvtNext');
    }
    const event = eventBuffer.readBigUInt64LE();
    if (event !== 0n) handles.push(event);
    if (returned.readUInt32LE() !== 1 || event === 0n) {
      throw new WindowsKernelBootError('invalid-result', 'latest boot event is missing');
    }
    const paths = [
      'Event/System/EventRecordID',
      "Event/EventData/Data[@Name='BootType']",
      'Event/System/Version'
    ].map(value => Buffer.from(`${value}\0`, 'utf16le'));
    const pathPointers = Buffer.alloc(paths.length * 8);
    paths.forEach((value, index) => pathPointers.writeBigUInt64LE(BigInt(ptr(value)), index * 8));
    const context = BigInt(events.symbols.EvtCreateRenderContext(paths.length, ptr(pathPointers), 0));
    if (context === 0n) throw nativeFailure('EvtCreateRenderContext');
    handles.push(context);
    // AMD64 EVT_VARIANT: 8-byte union, DWORD Count, DWORD Type.
    // All three admitted properties are scalar integers, so 48 bytes suffice.
    const values = Buffer.alloc(48);
    const used = Buffer.alloc(4);
    const count = Buffer.alloc(4);
    if (events.symbols.EvtRender(context, event, 0, values.length, ptr(values), ptr(used), ptr(count)) === 0) {
      throw nativeFailure('EvtRender');
    }
    if (used.readUInt32LE() !== values.length || count.readUInt32LE() !== 3
        || values.readUInt32LE(12) !== 10 // EvtVarTypeUInt64
        || values.readUInt32LE(28) !== 8 // EvtVarTypeUInt32
        || values.readUInt32LE(44) !== 4 // EvtVarTypeByte
        || values.readUInt32LE(8) !== 0 || values.readUInt32LE(24) !== 0 || values.readUInt32LE(40) !== 0
        || values.readBigUInt64LE(0) === 0n || values.readUInt8(32) !== 1) {
      throw new WindowsKernelBootError('invalid-result', 'unsupported Kernel-Boot event 27 v1 scalar layout');
    }
    if (values.readUInt32LE(16) !== 0) {
      throw new WindowsKernelBootError('not-full-boot', 'latest Kernel-Boot event is not a full boot');
    }
    if (observeWindowsKernelBootSequence() !== sequence) {
      throw new WindowsKernelBootError('invalid-result', 'boot sequence changed during native observation');
    }
    result = { sequence, fullBootEventRecordId: values.readBigUInt64LE(0).toString() };
  } catch (error) {
    failure = error;
  } finally {
    const closeFailures: unknown[] = [];
    for (const handle of handles.reverse()) {
      if (events.symbols.EvtClose(handle) === 0) closeFailures.push(nativeFailure('EvtClose'));
    }
    try { events.close(); } catch (error) { closeFailures.push(error); }
    try { kernel.close(); } catch (error) { closeFailures.push(error); }
    if (closeFailures.length > 0) {
      failure = new AggregateError(failure === undefined ? closeFailures : [failure, ...closeFailures], 'Windows boot observation cleanup failed');
    }
  }
  if (failure !== undefined) throw failure;
  if (result === undefined) throw new WindowsKernelBootError('invalid-result', 'native observation returned no boundary');
  return result;
}
