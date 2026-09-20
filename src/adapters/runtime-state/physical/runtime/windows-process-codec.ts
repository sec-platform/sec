const WINDOWS_WAIT_OBJECT_0 = 0x0000_0000;
const WINDOWS_WAIT_TIMEOUT = 0x0000_0102;
const WINDOWS_ERROR_BROKEN_PIPE = 109;
const WINDOWS_ERROR_NO_DATA = 232;
const WINDOWS_ERROR_PIPE_NOT_CONNECTED = 233;

/** Decode the documented ActiveProcesses field from JOBOBJECT_BASIC_ACCOUNTING_INFORMATION. */
export function decodeWindowsJobActiveProcessCount(information: Uint8Array): number {
  if (information.byteLength < 48) {
    throw new Error('Windows Job accounting information is truncated');
  }
  return Buffer.from(information.buffer, information.byteOffset, information.byteLength)
    .readUInt32LE(40);
}

export function windowsWaitDisposition(result: number): 'signaled' | 'pending' | 'failed' {
  if (result === WINDOWS_WAIT_OBJECT_0) return 'signaled';
  if (result === WINDOWS_WAIT_TIMEOUT) return 'pending';
  return 'failed';
}

export function windowsNaturalExitSettlementDisposition(
  activeProcessCount: number | null,
  remainingMs: number
): 'settled' | 'pending' | 'unproven' {
  if (activeProcessCount === 0) return 'settled';
  if (activeProcessCount !== null && remainingMs > 0) return 'pending';
  return 'unproven';
}

export function windowsPipeFailureDisposition(errorCode: number): 'eof' | 'failed' {
  return errorCode === WINDOWS_ERROR_BROKEN_PIPE || errorCode === WINDOWS_ERROR_NO_DATA
    || errorCode === WINDOWS_ERROR_PIPE_NOT_CONNECTED
    ? 'eof'
    : 'failed';
}
