import { writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';

import {
  createWindowsAppContainerProfileForNativeHelper,
  deriveWindowsAppContainerSidForNativeHelper,
  encodeWindowsAppContainerNativeDerivedSid,
  encodeWindowsAppContainerNativeFailure,
  encodeWindowsAppContainerNativeOk,
  runWindowsAppContainerNativeChild,
  WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1,
  type WindowsAppContainerNativeExecutionRequest,
  type WindowsAppContainerNativeHelperWirePayload
} from './windows-appcontainer-executor.ts';

type NativeHelperEnvelope =
  | Readonly<{ mode: 'derive'; request: Readonly<{ appContainerName: string }> }>
  | Readonly<{ mode: 'create-profile'; request: WindowsAppContainerNativeExecutionRequest }>
  | Readonly<{ mode: 'execute'; request: WindowsAppContainerNativeExecutionRequest }>;

async function loadNativeHelperExit(): Promise<(exitCode: number) => never> {
  const { dlopen, FFIType } = await import('bun:ffi');
  const kernel32 = dlopen('kernel32.dll', {
    GetCurrentProcess: {
      args: [],
      returns: FFIType.u64
    },
    TerminateProcess: {
      args: [FFIType.u64, FFIType.u32],
      returns: FFIType.i32
    },
    ExitProcess: {
      args: [FFIType.u32],
      returns: FFIType.void
    }
  } as const);
  return (exitCode: number): never => {
    // The helper has already flushed its finite protocol synchronously. Prefer
    // hard self-termination so AppContainer Job/DLL teardown cannot keep the
    // host watchdog waiting after the child-owned deadline has settled.
    const currentProcess = kernel32.symbols.GetCurrentProcess();
    if (kernel32.symbols.TerminateProcess(currentProcess, exitCode) !== 0) {
      return process.exit(exitCode);
    }
    kernel32.symbols.ExitProcess(exitCode);
    return process.exit(exitCode);
  };
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function writeNativeHelperOutput(payload: WindowsAppContainerNativeHelperWirePayload): void {
  writeSync(1, payload);
}

function decodeRequest(encoded: string | undefined): NativeHelperEnvelope {
  if (!encoded || !/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error('invalid helper request');
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !exactKeys(value, ['mode', 'request'])) {
    throw new Error('invalid helper request');
  }
  const envelope = value as Record<string, unknown>;
  if (!envelope.request || typeof envelope.request !== 'object' || Array.isArray(envelope.request)) {
    throw new Error('invalid helper request');
  }
  if (envelope.mode === 'derive' && exactKeys(envelope.request, ['appContainerName']) &&
    typeof (envelope.request as Record<string, unknown>).appContainerName === 'string' &&
    /^sec\.sm3\.[0-9a-f]{12}\.[0-9a-f]{24}$/u.test(
      String((envelope.request as Record<string, unknown>).appContainerName)
    )) {
    return envelope as unknown as NativeHelperEnvelope;
  }
  if ((envelope.mode === 'create-profile' || envelope.mode === 'execute') &&
    exactKeys(envelope.request, [
      'execution',
      'nativeResultPath',
      'owner'
    ])) {
    return envelope as unknown as NativeHelperEnvelope;
  }
  throw new Error('invalid helper request');
}

function assertNativeResultBoundary(request: WindowsAppContainerNativeExecutionRequest): void {
  const execution = request.execution;
  if (!execution || typeof execution !== 'object' || typeof execution.stagingRoot !== 'string' ||
    typeof request.nativeResultPath !== 'string') {
    throw new Error('invalid helper result boundary');
  }
  const stagingRoot = path.resolve(execution.stagingRoot);
  const resultPath = path.resolve(request.nativeResultPath);
  if (path.dirname(resultPath) !== path.dirname(stagingRoot) ||
    path.basename(resultPath) !== WINDOWS_APPCONTAINER_RECOVERY_CONTRACT_V1.resultFileName) {
    throw new Error('invalid helper result boundary');
  }
}

// Load the termination binding before any profile creation. If Bun's userenv
// FFI corrupts process memory, the profile helper performs no later dlopen.
const exitNativeHelper = await loadNativeHelperExit();
const envelope = decodeRequest(process.argv[2]);
if (envelope.mode === 'derive') {
  try {
    const appContainerSid = await deriveWindowsAppContainerSidForNativeHelper(
      envelope.request.appContainerName
    );
    writeNativeHelperOutput(encodeWindowsAppContainerNativeDerivedSid(appContainerSid));
    exitNativeHelper(0);
  } catch (error) {
    try {
      writeNativeHelperOutput(encodeWindowsAppContainerNativeFailure(error));
    } catch {}
    exitNativeHelper(1);
  }
} else if (envelope.mode === 'create-profile') {
  try {
    assertNativeResultBoundary(envelope.request);
    await createWindowsAppContainerProfileForNativeHelper(envelope.request);
    writeNativeHelperOutput(encodeWindowsAppContainerNativeOk());
    exitNativeHelper(0);
  } catch (error) {
    try {
      writeNativeHelperOutput(encodeWindowsAppContainerNativeFailure(error));
    } catch {}
    exitNativeHelper(1);
  }
} else {
  try {
    assertNativeResultBoundary(envelope.request);
    await runWindowsAppContainerNativeChild(envelope.request);
    writeNativeHelperOutput(encodeWindowsAppContainerNativeOk());
    exitNativeHelper(0);
  } catch (error) {
    const failure = encodeWindowsAppContainerNativeFailure(error);
    try {
      assertNativeResultBoundary(envelope.request);
      writeFileSync(
        envelope.request.nativeResultPath,
        `${failure}\n`,
        { flag: 'wx' }
      );
    } catch {
      // Lease loss or an invalid result boundary leaves the exact result absent.
      // The outer durable owner remains the sole recovery authority.
    }
    try {
      writeNativeHelperOutput(failure);
    } catch {}
    exitNativeHelper(1);
  }
}
