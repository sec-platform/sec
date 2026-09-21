import { writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';

import { canonicalEquals } from '../../../../../contracts/canonical.ts';

import {
  createWindowsAppContainerProfileForNativeHelper,
  deriveWindowsAppContainerSidForNativeHelper,
  encodeWindowsAppContainerNativeDerivedSid,
  encodeWindowsAppContainerNativeFailure,
  encodeWindowsAppContainerNativeOk,
  remainingWindowsAppContainerNativeHelperTimeout,
  runWindowsAppContainerNativeChild,
  runWindowsAppContainerNativeSuspendedCreateForHelper,
  superviseWindowsAppContainerNativeWorkerForHelper,
  WINDOWS_APPCONTAINER_RECOVERY_CONTRACT,
  type WindowsAppContainerNativeExecutionRequest,
  type WindowsAppContainerNativeHelperWirePayload,
  type WindowsAppContainerNativeWorkerProgressStage
} from './executor.ts';

type NativeHelperEnvelope =
  | Readonly<{ mode: 'derive'; request: Readonly<{ appContainerName: string }> }>
  | Readonly<{ mode: 'create-profile'; request: WindowsAppContainerNativeExecutionRequest }>
  | Readonly<{ mode: 'suspended-create'; request: WindowsAppContainerNativeExecutionRequest }>
  | Readonly<{ mode: 'execute'; request: WindowsAppContainerNativeExecutionRequest }>;

interface NativeExecutionWorkerGlobal {
  onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
  postMessage(value: unknown): void;
}

const nativeExecutionWorkerGlobal = globalThis as unknown as NativeExecutionWorkerGlobal;

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
  return canonicalEquals(Object.keys(value).sort(), [...expected].sort());
}

function writeNativeHelperOutput(payload: WindowsAppContainerNativeHelperWirePayload): void {
  writeSync(1, payload);
}

function terminateNativeHelperWithOutput(
  payload: WindowsAppContainerNativeHelperWirePayload,
  exitCode: number,
  exitNativeHelper: (exitCode: number) => never
): never {
  try {
    writeNativeHelperOutput(payload);
  } catch {}
  try {
    return exitNativeHelper(exitCode);
  } catch {
    return process.exit(exitCode);
  }
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
  if ((envelope.mode === 'create-profile' || envelope.mode === 'suspended-create' ||
    envelope.mode === 'execute') &&
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
    path.basename(resultPath) !== WINDOWS_APPCONTAINER_RECOVERY_CONTRACT.resultFileName) {
    throw new Error('invalid helper result boundary');
  }
}

async function runNativeExecutionWorker(encodedRequest: unknown): Promise<void> {
  let terminal: Readonly<Record<string, unknown>>;
  try {
    if (typeof encodedRequest !== 'string') throw new Error('invalid worker request');
    const envelope = decodeRequest(encodedRequest);
    if (envelope.mode !== 'execute' && envelope.mode !== 'suspended-create') {
      throw new Error('invalid worker mode');
    }
    assertNativeResultBoundary(envelope.request);
    if (envelope.mode === 'suspended-create') {
      await runWindowsAppContainerNativeSuspendedCreateForHelper(
        envelope.request,
        (stage: Exclude<WindowsAppContainerNativeWorkerProgressStage, 'not-observed'>) =>
          nativeExecutionWorkerGlobal.postMessage(Object.freeze({ kind: 'progress', stage }))
      );
      terminal = Object.freeze({ kind: 'suspended-created' });
    } else {
      const result = await runWindowsAppContainerNativeChild(envelope.request);
      terminal = Object.freeze({ kind: 'completed', exitCode: result.exitCode });
    }
  } catch (error) {
    terminal = Object.freeze({
      kind: 'failed',
      payload: encodeWindowsAppContainerNativeFailure(error)
    });
  }
  nativeExecutionWorkerGlobal.postMessage(terminal);
  nativeExecutionWorkerGlobal.onmessage = () => undefined;
}

function installNativeExecutionWorker(): void {
  // Bun Worker IPC is process-local and has no browser origin to authenticate.
  // codeql[js/missing-origin-check]
  nativeExecutionWorkerGlobal.onmessage = (event): void => {
    nativeExecutionWorkerGlobal.onmessage = null;
    void runNativeExecutionWorker(event.data);
  };
}

function superviseNativeExecution(
  mode: 'execute' | 'suspended-create',
  encodedRequest: string,
  timeoutMs: number
) {
  return superviseWindowsAppContainerNativeWorkerForHelper(
    mode,
    timeoutMs,
    (onTerminal, onFailure) => {
      const worker = new Worker(import.meta.url, { ref: true });
      worker.onmessage = (event) => onTerminal(event.data);
      worker.onmessageerror = () => onFailure();
      worker.onerror = (event) => {
        event.preventDefault();
        onFailure();
      };
      worker.addEventListener('close', () => onFailure(), { once: true });
      worker.postMessage(encodedRequest);
    }
  );
}

async function runNativeHelperMain(): Promise<void> {
  const helperStartedAtMs = Date.now();
  // Load the termination binding before any profile creation. If Bun's userenv
  // FFI corrupts process memory, the profile helper performs no later dlopen.
  const exitNativeHelper = await loadNativeHelperExit();
  const encodedRequest = process.argv[2];
  const envelope = decodeRequest(encodedRequest);
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
      const settlement = await superviseNativeExecution(
        envelope.mode,
        encodedRequest!,
        remainingWindowsAppContainerNativeHelperTimeout(
          envelope.request.execution.timeoutMs,
          helperStartedAtMs,
          Date.now()
        )
      );
      if (envelope.mode === 'execute' && settlement.kind === 'completed') {
        writeFileSync(
          envelope.request.nativeResultPath,
          `${JSON.stringify({ exitCode: settlement.exitCode })}\n`,
          { flag: 'wx' }
        );
        return terminateNativeHelperWithOutput(
          encodeWindowsAppContainerNativeOk(),
          0,
          exitNativeHelper
        );
      }
      if (envelope.mode === 'suspended-create' && settlement.kind === 'suspended-created') {
        return terminateNativeHelperWithOutput(
          encodeWindowsAppContainerNativeOk(),
          0,
          exitNativeHelper
        );
      }
      if (settlement.kind === 'failed') {
        if (envelope.mode === 'execute') {
          writeFileSync(
            envelope.request.nativeResultPath,
            `${settlement.payload}\n`,
            { flag: 'wx' }
          );
        }
        return terminateNativeHelperWithOutput(settlement.payload, 1, exitNativeHelper);
      }
      throw new Error('invalid worker settlement');
    } catch (error) {
      const failure = encodeWindowsAppContainerNativeFailure(error);
      if (envelope.mode === 'execute') {
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
      }
      return terminateNativeHelperWithOutput(failure, 1, exitNativeHelper);
    }
  }
}

if (Bun.isMainThread) await runNativeHelperMain();
else installNativeExecutionWorker();
