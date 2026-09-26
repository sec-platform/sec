import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { expect, test } from 'bun:test';

import { createObservedNativeLifecycleFailureForTests, observedCommandNativeLifecycleDiagnosticForTests, registerObservedWindowsJobControllerForTests, runObservedCommand, type ObservedCommandDependencies, type ObservedCommandOutcome } from '../../src/adapters/runtime-state/physical/runtime/observed-process.ts';
import { decodeWindowsJobActiveProcessCount, windowsNaturalExitSettlementDisposition, windowsPipeFailureDisposition, windowsWaitDisposition } from '../../src/adapters/runtime-state/physical/runtime/windows-process-codec.ts';
import {
  arbitrateNativeExecutionDeadlinesForTests,
  bindNativeHelperSettlement,
  classifyObservedWindowsAppContainerNativeHelperForTests,
  completeWindowsAppContainerOwnedExecutionForTests,
  createNativeExecutionBudgetForTests,
  encodeWindowsAppContainerNativeFailure,
  normalizeWindowsAppContainerPreparationErrorForTests,
  projectWindowsAppContainerHostToolFailureForTests,
  remainingNativeExecutionBudgetForTests,
  remainingWindowsAppContainerNativeHelperTimeout,
  runWindowsAppContainerExecutionStepsForTests,
  settleObservedWindowsAppContainerNativeHelperForTests,
  settleWindowsAppContainerNativeHelperInvocationForTests,
  settleNativeJobAfterFailureForTests,
  superviseWindowsAppContainerNativeWorkerForHelper,
  waitForNativeProcessForTests,
  windowsAppContainerExecutionCleanupChainForTests,
  WindowsAppContainerExecutionError,
  nativeHelperSettlementForTests
} from '../../src/adapters/runtime-state/physical/test/windows-appcontainer.ts';

interface FakeChild extends EventEmitter {
  readonly stdin: null;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
}

function fakeChild(pid = 42_424): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.defineProperties(child, {
    stdin: { value: null, enumerable: true },
    stdout: { value: new PassThrough(), enumerable: true },
    stderr: { value: new PassThrough(), enumerable: true },
    pid: { value: pid, enumerable: true }
  });
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => true;
  return child;
}

function closeChild(child: FakeChild, code = 0): void {
  child.exitCode = code;
  child.stdout.emit('end');
  child.stderr.emit('end');
  child.emit('close', code, null);
}

test('Windows native Job accounting and wait-result ABI decoders use the canonical fields', () => {
  const accounting = Buffer.alloc(48);
  accounting.writeUInt32LE(3, 40);
  accounting.writeUInt32LE(777, 44);
  expect(decodeWindowsJobActiveProcessCount(accounting)).toBe(3);
  expect(windowsWaitDisposition(0)).toBe('signaled');
  expect(windowsWaitDisposition(0x102)).toBe('pending');
  expect(windowsWaitDisposition(0xffff_ffff)).toBe('failed');
  expect(windowsWaitDisposition(7)).toBe('failed');
  expect(windowsPipeFailureDisposition(109)).toBe('eof');
  expect(windowsPipeFailureDisposition(232)).toBe('eof');
  expect(windowsPipeFailureDisposition(233)).toBe('eof');
  expect(windowsPipeFailureDisposition(5)).toBe('failed');
  expect(windowsNaturalExitSettlementDisposition(0, 0)).toBe('settled');
  expect(windowsNaturalExitSettlementDisposition(1, 1)).toBe('pending');
  expect(windowsNaturalExitSettlementDisposition(1, 0)).toBe('unproven');
  expect(windowsNaturalExitSettlementDisposition(null, 1)).toBe('unproven');
});

const lifecycleTermination = (
  treeClosed: boolean
): Readonly<{
  requested: true;
  gracefulAttempted: false;
  forcedAttempted: true;
  childCloseObserved: boolean;
  streamsDrained: boolean;
  treeClosed: boolean;
}> => Object.freeze({
  requested: true,
  gracefulAttempted: false,
  forcedAttempted: true,
  childCloseObserved: treeClosed,
  streamsDrained: treeClosed,
  treeClosed
});

test('post-create native cleanup preserves proved started-child lifecycle evidence', async () => {
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    dependencies: {
      spawnChild: () => {
        throw createObservedNativeLifecycleFailureForTests({
          status: 'spawn-failed',
          started: true,
          termination: lifecycleTermination(true)
        });
      }
    }
  });

  expect(outcome).toMatchObject({
    status: 'spawn-failed',
    started: true,
    termination: lifecycleTermination(true)
  });
});

test('post-create native cleanup never hides an unproved started child as a clean spawn failure', async () => {
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    dependencies: {
      spawnChild: () => {
        throw createObservedNativeLifecycleFailureForTests({
          status: 'termination-unproven',
          started: true,
          termination: lifecycleTermination(false)
        });
      }
    }
  });

  expect(outcome).toMatchObject({
    status: 'termination-unproven',
    started: true,
    termination: lifecycleTermination(false)
  });
  expect(observedCommandNativeLifecycleDiagnosticForTests(outcome)).toBe('injected');
});

test('runtime native lifecycle failure preserves its trigger and forced cleanup evidence', async () => {
  const child = fakeChild();
  setTimeout(() => child.emit('error', createObservedNativeLifecycleFailureForTests({
    status: 'termination-unproven',
    trigger: 'lifecycle-failed',
    started: true,
    termination: lifecycleTermination(false)
  })), 0);

  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    dependencies: dependencies(child, async () => ({
      gracefulAttempted: false,
      forcedAttempted: false,
      treeClosed: false
    }))
  });

  expect(outcome).toMatchObject({
    status: 'termination-unproven',
    trigger: 'lifecycle-failed',
    started: true,
    termination: lifecycleTermination(false)
  });
});

test.skipIf(process.platform !== 'win32')(
  'native natural exit drains the final anonymous-pipe tail and proves Job closure',
  async () => {
    const outcome = await runObservedCommand(process.execPath, [
      '-e',
      "process.stdout.write('tail')"
    ], {
      cwd: process.cwd(),
      terminationDeadlineMs: 1_000,
      terminationGraceMs: 100,
      timeoutMs: 2_000
    });

    expect(outcome.status).toBe('exited');
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toEqual({
      bytes: 4,
      digest: `sha256:${createHash('sha256').update('tail').digest('hex')}`,
      observerTruncated: false
    });
    expect(outcome.termination).toMatchObject({
      requested: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'native controlled failure drains stderr and proves Job closure',
  async () => {
    const marker = 'Semantic Mutation isolated verification failed\n';
    const exitCode = 70;
    const outcome = await runObservedCommand(process.execPath, [
      '--no-env-file',
      '--no-install',
      '-e',
      `process.stderr.write(${JSON.stringify(marker)}); process.exitCode = ${exitCode};`
    ], {
      cwd: process.cwd(),
      maxObservedOutputBytes: 512,
      terminationDeadlineMs: 1_000,
      terminationGraceMs: 100,
      timeoutMs: 2_000
    });

    expect(outcome.status).toBe('exited');
    expect(outcome.exitCode).toBe(exitCode);
    expect(outcome.stdout.bytes).toBe(0);
    expect(outcome.stderr).toEqual({
      bytes: Buffer.byteLength(marker),
      digest: `sha256:${createHash('sha256').update(marker).digest('hex')}`,
      observerTruncated: false
    });
    expect(outcome.termination).toMatchObject({
      requested: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'native controlled failure waits for a short-lived inherited Bun worker',
  async () => {
    const marker = 'Semantic Mutation isolated verification failed\n';
    const exitCode = 70;
    const workerSource = 'Bun.sleepSync(250);';
    const parentSource = [
      `const worker = Bun.spawn([process.execPath, '-e', ${JSON.stringify(workerSource)}], {`,
      "  stdout: 'inherit',",
      "  stderr: 'inherit'",
      '});',
      'worker.unref();',
      `process.stderr.write(${JSON.stringify(marker)});`,
      `process.exitCode = ${exitCode};`
    ].join('\n');
    const outcome = await runObservedCommand(process.execPath, ['-e', parentSource], {
      cwd: process.cwd(),
      maxObservedOutputBytes: 512,
      terminationDeadlineMs: 1_000,
      terminationGraceMs: 100,
      timeoutMs: 3_000
    });

    expect(outcome.status).toBe('exited');
    expect(outcome.exitCode).toBe(exitCode);
    expect(outcome.stderr).toEqual({
      bytes: Buffer.byteLength(marker),
      digest: `sha256:${createHash('sha256').update(marker).digest('hex')}`,
      observerTruncated: false
    });
    expect(outcome.termination).toMatchObject({
      requested: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'continuous native stdout yields to the command deadline and bounded termination',
  async () => {
    const startedAt = performance.now();
    const outcome = await runObservedCommand(process.execPath, [
      '-e',
      "const block = 'x'.repeat(65536); for (;;) process.stdout.write(block);"
    ], {
      cwd: process.cwd(),
      terminationDeadlineMs: 250,
      terminationGraceMs: 25,
      timeoutMs: 25
    });

    expect(outcome.trigger).toBe('timed-out');
    expect(outcome.termination.requested).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  }
);

test.skipIf(process.platform !== 'win32')(
  'native Job observes hard process exit while a Worker is blocked in finite synchronous FFI',
  async () => {
    const hardExitCode = 0x534d_3302;
    const marker = 'main-responsive-before-hard-exit\n';
    const tempRoot = await mkdtemp(join(tmpdir(), 'sec-observed-hard-exit-'));
    const scriptPath = join(tempRoot, 'worker-ffi-hard-exit.mjs');

    try {
      await writeFile(scriptPath, `
import { writeSync } from 'node:fs';
import { dlopen, FFIType } from 'bun:ffi';

if (Bun.isMainThread) {
  const kernel32 = dlopen('kernel32.dll', {
    CreateEventW: {
      args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr],
      returns: FFIType.u64
    },
    WaitForSingleObject: {
      args: [FFIType.u64, FFIType.u32],
      returns: FFIType.u32
    },
    SetEvent: { args: [FFIType.u64], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    GetCurrentProcess: { args: [], returns: FFIType.ptr },
    TerminateProcess: {
      args: [FFIType.ptr, FFIType.u32],
      returns: FFIType.bool
    },
    ExitProcess: { args: [FFIType.u32], returns: FFIType.void }
  });
  let readyEvent = 0n;
  let releaseEvent = 0n;
  let worker;
  const closeHandles = () => {
    if (readyEvent !== 0n) kernel32.symbols.CloseHandle(readyEvent);
    if (releaseEvent !== 0n) kernel32.symbols.CloseHandle(releaseEvent);
    readyEvent = 0n;
    releaseEvent = 0n;
  };
  const failSetup = () => {
    worker?.terminate();
    closeHandles();
    process.exit(70);
  };

  try {
    readyEvent = kernel32.symbols.CreateEventW(null, 1, 0, null);
    releaseEvent = kernel32.symbols.CreateEventW(null, 1, 0, null);
    if (readyEvent === 0n || releaseEvent === 0n) failSetup();

    worker = new Worker(import.meta.url);
    worker.onerror = failSetup;
    worker.onmessage = ({ data }) => {
      if (data !== 'finite-wait-returned') return;
      closeHandles();
      process.exit(71);
    };
    worker.postMessage({ readyEvent, releaseEvent });

    const waitUntilEntered = () => {
      const ready = kernel32.symbols.WaitForSingleObject(readyEvent, 0);
      if (ready === 0x102) {
        setTimeout(waitUntilEntered, 1);
        return;
      }
      if (ready !== 0) {
        kernel32.symbols.SetEvent(releaseEvent);
        setTimeout(failSetup, 25);
        return;
      }
      setTimeout(() => {
        writeSync(1, ${JSON.stringify(marker)});
        const self = kernel32.symbols.GetCurrentProcess();
        kernel32.symbols.TerminateProcess(self, ${hardExitCode});
        kernel32.symbols.ExitProcess(${hardExitCode});
        process.exit(${hardExitCode});
      }, 150);
    };
    waitUntilEntered();
  } catch {
    failSetup();
  }
} else {
  const kernel32 = dlopen('kernel32.dll', {
    SignalObjectAndWait: {
      args: [FFIType.u64, FFIType.u64, FFIType.u32, FFIType.i32],
      returns: FFIType.u32
    }
  });
  self.onmessage = ({ data: { readyEvent, releaseEvent } }) => {
    kernel32.symbols.SignalObjectAndWait(readyEvent, releaseEvent, 5_000, 0);
    self.postMessage('finite-wait-returned');
  };
}
`, 'utf8');

      const startedAt = performance.now();
      const outcome = await runObservedCommand(process.execPath, [
        '--no-env-file',
        '--no-install',
        scriptPath
      ], {
        cwd: tempRoot,
        maxObservedOutputBytes: 1_024,
        terminationDeadlineMs: 250,
        terminationGraceMs: 25,
        timeoutMs: 1_500
      });
      const durationMs = performance.now() - startedAt;

      expect(outcome.status).toBe('exited');
      expect(outcome.exitCode).toBe(hardExitCode);
      expect(outcome.signal).toBeNull();
      expect(durationMs).toBeLessThan(1_500);
      expect(outcome.stdout).toEqual({
        bytes: Buffer.byteLength(marker),
        digest: `sha256:${createHash('sha256').update(marker).digest('hex')}`,
        observerTruncated: false
      });
      expect(outcome.stderr).toEqual({
        bytes: 0,
        digest: `sha256:${createHash('sha256').digest('hex')}`,
        observerTruncated: false
      });
      expect(outcome.termination).toMatchObject({
        requested: false,
        gracefulAttempted: false,
        forcedAttempted: false,
        childCloseObserved: true,
        streamsDrained: true,
        treeClosed: true
      });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Worker CreateProcessW ABI returns with handle-list and nested Job-list attributes',
  async () => {
    const marker = 'create-returned;inner-job-terminated;inner-job-closed\n';
    const tempRoot = await mkdtemp(join(tmpdir(), 'sec-worker-create-process-'));
    const scriptPath = join(tempRoot, 'worker-create-process-abi.mjs');

    try {
      await writeFile(scriptPath, String.raw`
import { writeSync } from 'node:fs';
import { dlopen, FFIType, ptr } from 'bun:ffi';

const FAIL = Object.freeze({
  setup: 81,
  returned: 82,
  create: 83,
  wait: 85,
  closure: 86
});
const wide = (value) => Buffer.from(value + '\0', 'utf16le');
if (Bun.isMainThread) {
  const kernel32 = dlopen('kernel32.dll', {
    GetCurrentProcess: { args: [], returns: FFIType.u64 },
    TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
    ExitProcess: { args: [FFIType.u32], returns: FFIType.void }
  });
  const hardExit = (code) => {
    const self = kernel32.symbols.GetCurrentProcess();
    kernel32.symbols.TerminateProcess(self, code);
    kernel32.symbols.ExitProcess(code);
    process.exit(code);
  };
  let createReturned = false;
  const watchdog = setTimeout(
    () => hardExit(createReturned ? FAIL.wait : FAIL.returned),
    1_200
  );
  try {
    const worker = new Worker(import.meta.url, { ref: true });
    worker.onerror = () => hardExit(FAIL.setup);
    worker.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object') hardExit(FAIL.returned);
      if (data.stage === 'create-returned') {
        createReturned = true;
        return;
      }
      if (data.stage === 'failed' && Object.values(FAIL).includes(data.code)) {
        hardExit(data.code);
      }
      if (data.stage !== 'completed' || !createReturned) hardExit(FAIL.returned);
      clearTimeout(watchdog);
      writeSync(1, ${JSON.stringify(marker)});
      hardExit(0);
    };
    worker.postMessage('start');
  } catch {
    hardExit(FAIL.setup);
  }
} else {
  self.onmessage = () => {
    let phase = 'setup';
    let kernel32;
    let attributeList;
    let attributeListInitialized = false;
    let attributePayloads = [];
    const handles = new Set();
    const closeHandle = (handle) => {
      if (!kernel32 || handle === 0n || !handles.delete(handle)) return;
      kernel32.symbols.CloseHandle(handle);
    };
    const cleanup = () => {
      if (attributeListInitialized && attributeList && kernel32) {
        kernel32.symbols.DeleteProcThreadAttributeList(attributeList);
        attributeListInitialized = false;
        attributeList = undefined;
      }
      for (const handle of [...handles]) closeHandle(handle);
      void attributePayloads.length;
      attributePayloads = [];
    };
    const fail = (code) => self.postMessage({ stage: 'failed', code });
    try {
      kernel32 = dlopen('kernel32.dll', {
        CreateFileW: {
          args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr,
            FFIType.u32, FFIType.u32, FFIType.u64],
          returns: FFIType.u64
        },
        CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
        SetInformationJobObject: {
          args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32],
          returns: FFIType.i32
        },
        QueryInformationJobObject: {
          args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr],
          returns: FFIType.i32
        },
        InitializeProcThreadAttributeList: {
          args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
          returns: FFIType.i32
        },
        UpdateProcThreadAttribute: {
          args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr,
            FFIType.u64, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32
        },
        DeleteProcThreadAttributeList: { args: [FFIType.ptr], returns: FFIType.void },
        CreateProcessW: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32,
            FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32
        },
        TerminateJobObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
        WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
        GetLastError: { args: [], returns: FFIType.u32 },
        Sleep: { args: [FFIType.u32], returns: FFIType.void },
        CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
      });
      const security = Buffer.alloc(24);
      security.writeUInt32LE(24, 0);
      security.writeUInt32LE(1, 16);
      const openNull = (access) => {
        const handle = kernel32.symbols.CreateFileW(
          wide('NUL'), access, 3, security, 3, 0x80, 0n
        );
        if (handle === 0n || handle === 0xffff_ffff_ffff_ffffn) throw new Error('setup');
        handles.add(handle);
        return handle;
      };
      const stdinHandle = openNull(0x8000_0000);
      const stdoutHandle = openNull(0x4000_0000);
      const stderrHandle = openNull(0x4000_0000);
      const jobInformation = Buffer.alloc(144);
      jobInformation.writeUInt32LE(0x2000, 16);
      const jobHandle = kernel32.symbols.CreateJobObjectW(null, null);
      if (jobHandle === 0n || kernel32.symbols.SetInformationJobObject(
        jobHandle, 9, jobInformation, jobInformation.byteLength
      ) === 0) throw new Error('setup');
      handles.add(jobHandle);

      const handleList = Buffer.alloc(24);
      handleList.writeBigUInt64LE(stdinHandle, 0);
      handleList.writeBigUInt64LE(stdoutHandle, 8);
      handleList.writeBigUInt64LE(stderrHandle, 16);
      const jobList = Buffer.alloc(8);
      jobList.writeBigUInt64LE(jobHandle, 0);
      attributePayloads = [handleList, jobList];
      const attributeListSize = Buffer.alloc(8);
      kernel32.symbols.InitializeProcThreadAttributeList(null, 2, 0, attributeListSize);
      attributeList = Buffer.alloc(Number(attributeListSize.readBigUInt64LE(0)));
      if (kernel32.symbols.InitializeProcThreadAttributeList(
        attributeList, 2, 0, attributeListSize
      ) === 0) throw new Error('setup');
      attributeListInitialized = true;
      if (kernel32.symbols.UpdateProcThreadAttribute(
        attributeList, 0, 0x0002_0002n, handleList,
        BigInt(handleList.byteLength), null, null
      ) === 0 || kernel32.symbols.UpdateProcThreadAttribute(
        attributeList, 0, 0x0002_000dn, jobList,
        BigInt(jobList.byteLength), null, null
      ) === 0) throw new Error('setup');

      const startup = Buffer.alloc(112);
      startup.writeUInt32LE(112, 0);
      startup.writeUInt32LE(0x100, 60);
      startup.writeBigUInt64LE(stdinHandle, 80);
      startup.writeBigUInt64LE(stdoutHandle, 88);
      startup.writeBigUInt64LE(stderrHandle, 96);
      startup.writeBigUInt64LE(BigInt(ptr(attributeList)), 104);
      const processInformation = Buffer.alloc(24);
      const environment = Buffer.from(
        Object.entries(process.env)
          .filter((entry) => entry[1] !== undefined)
          .sort((left, right) => left[0].toLowerCase().localeCompare(right[0].toLowerCase()))
          .map((entry) => entry[0] + '=' + entry[1]).join('\0') + '\0\0',
        'utf16le'
      );
      const commandLine = wide(
        '"' + process.execPath + '" --no-env-file --no-install -e "process.exit(0)"'
      );
      phase = 'create';
      const created = kernel32.symbols.CreateProcessW(
        wide(process.execPath), commandLine, null, null, 1,
        0x0808_0404, environment, wide(process.cwd()), startup, processInformation
      );
      if (created === 0) {
        const nativeCode = kernel32.symbols.GetLastError();
        self.postMessage({ stage: 'failed', code: FAIL.create, nativeCode });
        return;
      }
      const processHandle = processInformation.readBigUInt64LE(0);
      let threadHandle = processInformation.readBigUInt64LE(8);
      const processId = processInformation.readUInt32LE(16);
      if (processHandle === 0n || threadHandle === 0n || processId === 0) {
        fail(FAIL.returned);
        return;
      }
      handles.add(processHandle);
      handles.add(threadHandle);
      self.postMessage({ stage: 'create-returned' });

      closeHandle(threadHandle);
      threadHandle = 0n;
      phase = 'wait';
      if (kernel32.symbols.TerminateJobObject(jobHandle, 0x534d_3304) === 0) {
        fail(FAIL.wait);
        return;
      }
      if (kernel32.symbols.WaitForSingleObject(processHandle, 600) !== 0) {
        fail(FAIL.wait);
        return;
      }
      phase = 'closure';
      const accounting = Buffer.alloc(48);
      let innerClosed = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (kernel32.symbols.QueryInformationJobObject(
          jobHandle, 1, accounting, accounting.byteLength, null
        ) !== 0 && accounting.readUInt32LE(40) === 0) {
          innerClosed = true;
          break;
        }
        kernel32.symbols.Sleep(5);
      }
      if (!innerClosed) {
        fail(FAIL.closure);
        return;
      }
      cleanup();
      self.postMessage({ stage: 'completed' });
    } catch {
      fail(FAIL[phase] ?? FAIL.setup);
    } finally {
      cleanup();
    }
  };
}
`, 'utf8');

      const startedAt = performance.now();
      const outcome = await runObservedCommand(process.execPath, [
        '--no-env-file',
        '--no-install',
        scriptPath
      ], {
        cwd: tempRoot,
        maxObservedOutputBytes: 1_024,
        terminationDeadlineMs: 250,
        terminationGraceMs: 25,
        timeoutMs: 1_500
      });

      expect(outcome.status).toBe('exited');
      expect(outcome.exitCode).toBe(0);
      expect(outcome.signal).toBeNull();
      expect(performance.now() - startedAt).toBeLessThan(2_000);
      expect(outcome.stdout).toEqual({
        bytes: Buffer.byteLength(marker),
        digest: `sha256:${createHash('sha256').update(marker).digest('hex')}`,
        observerTruncated: false
      });
      expect(outcome.stderr.bytes).toBe(0);
      expect(outcome.termination).toMatchObject({
        requested: false,
        forcedAttempted: false,
        childCloseObserved: true,
        streamsDrained: true,
        treeClosed: true
      });
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Worker CreateProcessW returns with SECURITY_CAPABILITIES and nested Job-list attributes',
  async () => {
    const profileName = `sec.sm3.sentinel.${process.pid}.${Date.now().toString(36)}`;
    const tempRoot = await mkdtemp(join(tmpdir(), 'sec-security-capabilities-create-'));
    const scriptPath = join(tempRoot, 'worker-security-capabilities-create.mjs');
    const profileManagerPath = join(tempRoot, 'profile-manager.mjs');
    let profileManagerWritten = false;
    let profileCreated = false;

    try {
      await writeFile(profileManagerPath, String.raw`
import { dlopen, FFIType } from 'bun:ffi';
const wide = (value) => Buffer.from(value + '\0', 'utf16le');
const kernel32 = dlopen('kernel32.dll', {
  GetCurrentProcess: { args: [], returns: FFIType.u64 },
  TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
  ExitProcess: { args: [FFIType.u32], returns: FFIType.void }
});
const hardExit = (code) => {
  kernel32.symbols.TerminateProcess(kernel32.symbols.GetCurrentProcess(), code);
  kernel32.symbols.ExitProcess(code);
  process.exit(code);
};
const userenv = dlopen('userenv.dll', {
  CreateAppContainerProfile: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32
  },
  DeleteAppContainerProfile: { args: [FFIType.ptr], returns: FFIType.i32 }
});
const [operation, profileName] = process.argv.slice(2);
if (operation === 'create') {
  const sidHolder = Buffer.alloc(8);
  const result = userenv.symbols.CreateAppContainerProfile(
    wide(profileName), wide('SEC sentinel'), wide('Ephemeral SECURITY_CAPABILITIES sentinel'),
    null, 0, sidHolder
  );
  hardExit(result < 0 ? 91 : 0);
}
if (operation === 'delete') {
  hardExit(userenv.symbols.DeleteAppContainerProfile(wide(profileName)) < 0 ? 92 : 0);
}
hardExit(90);
`, 'utf8');
      profileManagerWritten = true;
      await writeFile(scriptPath, String.raw`
import { writeSync } from 'node:fs';
import { dlopen, FFIType, ptr, read } from 'bun:ffi';

const FAIL = Object.freeze({
  setup: 81,
  returned: 82,
  create: 83,
  wait: 85,
  closure: 86
});
const wide = (value) => Buffer.from(value + '\0', 'utf16le');
const mode = process.argv[2];
const profileName = process.argv[3];
const secure = mode === 'secure';

if (Bun.isMainThread) {
  const kernel32 = dlopen('kernel32.dll', {
    GetCurrentProcess: { args: [], returns: FFIType.u64 },
    TerminateProcess: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
    ExitProcess: { args: [FFIType.u32], returns: FFIType.void }
  });
  const userenv = dlopen('userenv.dll', {
    DeriveAppContainerSidFromAppContainerName: {
      args: [FFIType.ptr, FFIType.ptr],
      returns: FFIType.i32
    }
  });
  const hardExit = (code) => {
    const self = kernel32.symbols.GetCurrentProcess();
    kernel32.symbols.TerminateProcess(self, code);
    kernel32.symbols.ExitProcess(code);
    process.exit(code);
  };
  if (mode !== 'control' && mode !== 'secure') hardExit(FAIL.setup);
  const sidHolder = Buffer.alloc(8);
  if (userenv.symbols.DeriveAppContainerSidFromAppContainerName(
    wide(profileName), sidHolder
  ) < 0) hardExit(FAIL.setup);
  const sidPointerValue = read.ptr(ptr(sidHolder));
  if (!sidPointerValue) hardExit(FAIL.setup);
  const sidPointer = BigInt(sidPointerValue);
  let createReturned = false;
  const watchdog = setTimeout(
    () => hardExit(createReturned ? FAIL.wait : FAIL.returned),
    1_200
  );
  try {
    const worker = new Worker(import.meta.url, { ref: true });
    worker.onerror = () => hardExit(FAIL.setup);
    worker.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object') hardExit(FAIL.returned);
      if (data.stage === 'create-returned') {
        createReturned = true;
        return;
      }
      if (data.stage === 'failed' && Object.values(FAIL).includes(data.code)) {
        hardExit(data.code);
      }
      if (data.stage !== 'completed' || !createReturned) hardExit(FAIL.returned);
      clearTimeout(watchdog);
      writeSync(1, mode + '-create-returned;inner-job-closed\n');
      hardExit(0);
    };
    worker.postMessage({ secure, sidPointer });
  } catch {
    hardExit(FAIL.setup);
  }
} else {
  self.onmessage = ({ data: { secure, sidPointer } }) => {
    let phase = 'setup';
    let kernel32;
    let attributeList;
    let attributeListInitialized = false;
    let attributePayloads = [];
    const handles = new Set();
    const closeHandle = (handle) => {
      if (!kernel32 || handle === 0n || !handles.delete(handle)) return;
      kernel32.symbols.CloseHandle(handle);
    };
    const cleanup = () => {
      if (attributeListInitialized && attributeList && kernel32) {
        kernel32.symbols.DeleteProcThreadAttributeList(attributeList);
        attributeListInitialized = false;
        attributeList = undefined;
      }
      for (const handle of [...handles]) closeHandle(handle);
      void attributePayloads.length;
      attributePayloads = [];
    };
    const fail = (code) => self.postMessage({ stage: 'failed', code });
    try {
      kernel32 = dlopen('kernel32.dll', {
        CreateFileW: {
          args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr,
            FFIType.u32, FFIType.u32, FFIType.u64],
          returns: FFIType.u64
        },
        CreateJobObjectW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
        SetInformationJobObject: {
          args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32],
          returns: FFIType.i32
        },
        QueryInformationJobObject: {
          args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr],
          returns: FFIType.i32
        },
        InitializeProcThreadAttributeList: {
          args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
          returns: FFIType.i32
        },
        UpdateProcThreadAttribute: {
          args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr,
            FFIType.u64, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32
        },
        DeleteProcThreadAttributeList: { args: [FFIType.ptr], returns: FFIType.void },
        CreateProcessW: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32,
            FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32
        },
        TerminateJobObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.i32 },
        WaitForSingleObject: { args: [FFIType.u64, FFIType.u32], returns: FFIType.u32 },
        GetLastError: { args: [], returns: FFIType.u32 },
        Sleep: { args: [FFIType.u32], returns: FFIType.void },
        CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 }
      });
      const security = Buffer.alloc(24);
      security.writeUInt32LE(24, 0);
      security.writeUInt32LE(1, 16);
      const openNull = (access) => {
        const handle = kernel32.symbols.CreateFileW(
          wide('NUL'), access, 3, security, 3, 0x80, 0n
        );
        if (handle === 0n || handle === 0xffff_ffff_ffff_ffffn) throw new Error('setup');
        handles.add(handle);
        return handle;
      };
      const stdinHandle = openNull(0x8000_0000);
      const stdoutHandle = openNull(0x4000_0000);
      const stderrHandle = openNull(0x4000_0000);
      const jobInformation = Buffer.alloc(144);
      jobInformation.writeUInt32LE(0x2000, 16);
      const jobHandle = kernel32.symbols.CreateJobObjectW(null, null);
      if (jobHandle === 0n || kernel32.symbols.SetInformationJobObject(
        jobHandle, 9, jobInformation, jobInformation.byteLength
      ) === 0) throw new Error('setup');
      handles.add(jobHandle);

      const securityCapabilities = Buffer.alloc(24);
      securityCapabilities.writeBigUInt64LE(BigInt(sidPointer), 0);
      securityCapabilities.writeBigUInt64LE(0n, 8);
      securityCapabilities.writeUInt32LE(0, 16);
      securityCapabilities.writeUInt32LE(0, 20);
      const handleList = Buffer.alloc(24);
      handleList.writeBigUInt64LE(stdinHandle, 0);
      handleList.writeBigUInt64LE(stdoutHandle, 8);
      handleList.writeBigUInt64LE(stderrHandle, 16);
      const jobList = Buffer.alloc(8);
      jobList.writeBigUInt64LE(jobHandle, 0);
      attributePayloads = secure
        ? [securityCapabilities, handleList, jobList]
        : [handleList, jobList];
      const attributeCount = secure ? 3 : 2;
      const attributeListSize = Buffer.alloc(8);
      kernel32.symbols.InitializeProcThreadAttributeList(
        null, attributeCount, 0, attributeListSize
      );
      attributeList = Buffer.alloc(Number(attributeListSize.readBigUInt64LE(0)));
      if (kernel32.symbols.InitializeProcThreadAttributeList(
        attributeList, attributeCount, 0, attributeListSize
      ) === 0) throw new Error('setup');
      attributeListInitialized = true;
      if ((secure && kernel32.symbols.UpdateProcThreadAttribute(
        attributeList, 0, 0x0002_0009n, securityCapabilities,
        BigInt(securityCapabilities.byteLength), null, null
      ) === 0) || kernel32.symbols.UpdateProcThreadAttribute(
        attributeList, 0, 0x0002_0002n, handleList,
        BigInt(handleList.byteLength), null, null
      ) === 0 || kernel32.symbols.UpdateProcThreadAttribute(
        attributeList, 0, 0x0002_000dn, jobList,
        BigInt(jobList.byteLength), null, null
      ) === 0) throw new Error('setup');

      const startup = Buffer.alloc(112);
      startup.writeUInt32LE(112, 0);
      startup.writeUInt32LE(0x100, 60);
      startup.writeBigUInt64LE(stdinHandle, 80);
      startup.writeBigUInt64LE(stdoutHandle, 88);
      startup.writeBigUInt64LE(stderrHandle, 96);
      startup.writeBigUInt64LE(BigInt(ptr(attributeList)), 104);
      const processInformation = Buffer.alloc(24);
      const environment = Buffer.from(
        Object.entries(process.env)
          .filter((entry) => entry[1] !== undefined)
          .sort((left, right) => left[0].toLowerCase().localeCompare(right[0].toLowerCase()))
          .map((entry) => entry[0] + '=' + entry[1]).join('\0') + '\0\0',
        'utf16le'
      );
      const commandLine = wide(
        '"' + process.execPath + '" --no-env-file --no-install -e "process.exit(0)"'
      );
      phase = 'create';
      const created = kernel32.symbols.CreateProcessW(
        wide(process.execPath), commandLine, null, null, 1,
        0x0808_0404, environment, wide(process.cwd()), startup, processInformation
      );
      if (created === 0) {
        const nativeCode = kernel32.symbols.GetLastError();
        self.postMessage({ stage: 'failed', code: FAIL.create, nativeCode });
        return;
      }
      const processHandle = processInformation.readBigUInt64LE(0);
      let threadHandle = processInformation.readBigUInt64LE(8);
      const processId = processInformation.readUInt32LE(16);
      if (processHandle === 0n || threadHandle === 0n || processId === 0) {
        fail(FAIL.returned);
        return;
      }
      handles.add(processHandle);
      handles.add(threadHandle);
      self.postMessage({ stage: 'create-returned' });

      closeHandle(threadHandle);
      threadHandle = 0n;
      phase = 'wait';
      if (kernel32.symbols.TerminateJobObject(jobHandle, 0x534d_3304) === 0) {
        fail(FAIL.wait);
        return;
      }
      if (kernel32.symbols.WaitForSingleObject(processHandle, 600) !== 0) {
        fail(FAIL.wait);
        return;
      }
      phase = 'closure';
      const accounting = Buffer.alloc(48);
      let innerClosed = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (kernel32.symbols.QueryInformationJobObject(
          jobHandle, 1, accounting, accounting.byteLength, null
        ) !== 0 && accounting.readUInt32LE(40) === 0) {
          innerClosed = true;
          break;
        }
        kernel32.symbols.Sleep(5);
      }
      if (!innerClosed) {
        fail(FAIL.closure);
        return;
      }
      cleanup();
      self.postMessage({ stage: 'completed' });
    } catch {
      fail(FAIL[phase] ?? FAIL.setup);
    } finally {
      cleanup();
    }
  };
}
`, 'utf8');

      const observedOptions = {
        cwd: tempRoot,
        maxObservedOutputBytes: 1_024,
        terminationDeadlineMs: 250,
        terminationGraceMs: 25,
        timeoutMs: 1_500
      } as const;
      const startedAt = performance.now();
      const profileSetup = await runObservedCommand(process.execPath, [
        '--no-env-file', '--no-install', profileManagerPath, 'create', profileName
      ], observedOptions);
      profileCreated = profileSetup.status === 'exited' && profileSetup.exitCode === 0;
      expect(profileSetup).toMatchObject({ status: 'exited', exitCode: 0 });

      const runArm = (mode: 'control' | 'secure') => runObservedCommand(process.execPath, [
        '--no-env-file', '--no-install', scriptPath, mode, profileName
      ], observedOptions);
      const control = await runArm('control');
      const secure = await runArm('secure');
      expect(performance.now() - startedAt).toBeLessThan(3_000);

      for (const [mode, outcome] of [
        ['control', control],
        ['secure', secure]
      ] as const) {
        const marker = `${mode}-create-returned;inner-job-closed\n`;
        expect(outcome.status).toBe('exited');
        expect(outcome.exitCode).toBe(0);
        expect(outcome.signal).toBeNull();
        expect(outcome.stdout).toEqual({
          bytes: Buffer.byteLength(marker),
          digest: `sha256:${createHash('sha256').update(marker).digest('hex')}`,
          observerTruncated: false
        });
        expect(outcome.stderr.bytes).toBe(0);
        expect(outcome.termination).toMatchObject({
          requested: false,
          forcedAttempted: false,
          childCloseObserved: true,
          streamsDrained: true,
          treeClosed: true
        });
      }
    } finally {
      try {
        if (profileManagerWritten && profileCreated) {
          const profileCleanup = await runObservedCommand(process.execPath, [
            '--no-env-file', '--no-install', profileManagerPath, 'delete', profileName
          ], {
            cwd: tempRoot,
            terminationDeadlineMs: 250,
            terminationGraceMs: 25,
            timeoutMs: 1_000
          });
          expect(profileCleanup).toMatchObject({
            status: 'exited',
            exitCode: 0,
            termination: {
              childCloseObserved: true,
              streamsDrained: true,
              treeClosed: true
            }
          });
        }
      } finally {
        await rm(tempRoot, { force: true, recursive: true });
      }
    }
  }
);

function dependencies(
  child: FakeChild,
  terminateProcessTree: ObservedCommandDependencies['terminateProcessTree']
): Partial<ObservedCommandDependencies> {
  return {
    spawnChild: () => child as unknown as ChildProcess,
    terminateProcessTree,
    inspectProcessTreeClosed: async () => true
  };
}

test('observed host tool completes before its deadline without requesting termination', async () => {
  const child = fakeChild();
  let terminations = 0;
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from('ok'));
    closeChild(child);
  }, 0);

  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    maxObservedOutputBytes: 16,
    onOutput: () => undefined,
    timeoutMs: 100,
    dependencies: dependencies(child, async () => {
      terminations += 1;
      return { gracefulAttempted: true, forcedAttempted: false, treeClosed: true };
    })
  });

  expect(outcome.status).toBe('exited');
  expect(outcome.exitCode).toBe(0);
  expect(outcome.stdout).toEqual({
    bytes: 2,
    digest: `sha256:${createHash('sha256').update('ok').digest('hex')}`,
    observerTruncated: false
  });
  expect(outcome.termination.requested).toBe(false);
  expect(terminations).toBe(0);
});

test('natural child close requests bounded termination when the independent census rejects closure', async () => {
  const child = fakeChild();
  setTimeout(() => closeChild(child), 0);
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    timeoutMs: 100,
    dependencies: {
      ...dependencies(child, async () => ({
        gracefulAttempted: false,
        forcedAttempted: false,
        treeClosed: false
      })),
      inspectProcessTreeClosed: async () => false
    }
  });

  expect(outcome.status).toBe('termination-unproven');
  expect(outcome.exitCode).toBe(0);
  expect(outcome.termination).toMatchObject({
    requested: true,
    childCloseObserved: true,
    streamsDrained: true,
    treeClosed: false
  });
});

test('stable Windows Job identity proves closure even after intermediate parent rows disappear', async () => {
  const child = fakeChild();
  let activeReads = 0;
  let closeCalls = 0;
  registerObservedWindowsJobControllerForTests(child as unknown as ChildProcess, {
    activeProcessCount: () => activeReads++ === 0 ? 1 : 0,
    terminate: () => true,
    close: () => {
      closeCalls += 1;
    }
  });
  setTimeout(() => closeChild(child), 0);
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 50,
    timeoutMs: 100,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      spawnChild: () => child as unknown as ChildProcess
    }
  });

  expect(outcome.status).toBe('exited');
  expect(outcome.termination.treeClosed).toBe(true);
  expect(activeReads).toBeGreaterThanOrEqual(2);
  expect(closeCalls).toBe(1);
});

test('stable Job proof retains descendant output until the Job and streams are both drained', async () => {
  const child = fakeChild();
  let active = 1;
  registerObservedWindowsJobControllerForTests(child as unknown as ChildProcess, {
    activeProcessCount: () => active,
    terminate: () => true,
    close: () => undefined
  });
  setTimeout(() => {
    child.exitCode = 0;
    child.emit('close', 0, null);
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('descendant-tail'));
      child.stdout.emit('end');
      child.stderr.emit('end');
      active = 0;
    }, 5);
  }, 0);
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 100,
    timeoutMs: 200,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      spawnChild: () => child as unknown as ChildProcess
    }
  });
  expect(outcome.status).toBe('exited');
  expect(outcome.stdout).toMatchObject({
    bytes: Buffer.byteLength('descendant-tail'),
    digest: `sha256:${createHash('sha256').update('descendant-tail').digest('hex')}`
  });
  expect(outcome.termination).toMatchObject({ streamsDrained: true, treeClosed: true });
});

test('observed host tool deadline requests one bounded tree termination', async () => {
  const child = fakeChild();
  let terminations = 0;
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 50,
    terminationGraceMs: 5,
    timeoutMs: 5,
    dependencies: dependencies(child, async () => {
      terminations += 1;
      closeChild(child);
      return { gracefulAttempted: true, forcedAttempted: false, treeClosed: true };
    })
  });

  expect(outcome.status).toBe('timed-out');
  expect(outcome.trigger).toBe('timed-out');
  expect(outcome.termination.treeClosed).toBe(true);
  expect(terminations).toBe(1);
});

test('observed host tool returns termination-unproven when its terminator never settles', async () => {
  const child = fakeChild();
  const startedAt = performance.now();
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 10,
    terminationGraceMs: 2,
    timeoutMs: 5,
    dependencies: dependencies(child, () => new Promise(() => undefined))
  });

  expect(outcome.status).toBe('termination-unproven');
  expect(outcome.trigger).toBe('timed-out');
  expect(outcome.termination.treeClosed).toBe(false);
  expect(performance.now() - startedAt).toBeLessThan(500);
});

test('synchronous terminator failure is absorbed into bounded unproven evidence', async () => {
  const child = fakeChild();
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 10,
    terminationGraceMs: 2,
    timeoutMs: 5,
    dependencies: dependencies(child, () => {
      throw new Error('synchronous terminator failure');
    })
  });

  expect(outcome.status).toBe('termination-unproven');
  expect(outcome.trigger).toBe('timed-out');
  expect(outcome.termination.treeClosed).toBe(false);
});

test('observed host tool distinguishes continuous fence loss from deadline', async () => {
  const child = fakeChild();
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    fenceIntervalMs: 1,
    terminationDeadlineMs: 50,
    terminationGraceMs: 5,
    timeoutMs: 100,
    whileRunning: async () => {
      throw new Error('injected lease loss');
    },
    dependencies: dependencies(child, async () => {
      closeChild(child);
      return { gracefulAttempted: true, forcedAttempted: false, treeClosed: true };
    })
  });

  expect(outcome.status).toBe('fence-lost');
  expect(outcome.trigger).toBe('fence-lost');
  expect(outcome.termination.treeClosed).toBe(true);
});

test('synchronous continuous-fence failure is absorbed and keeps fence-lost as first trigger', async () => {
  const child = fakeChild();
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    fenceIntervalMs: 1,
    terminationDeadlineMs: 50,
    terminationGraceMs: 5,
    timeoutMs: 100,
    whileRunning: () => {
      throw new Error('synchronous lease loss');
    },
    dependencies: dependencies(child, async () => {
      closeChild(child);
      return { gracefulAttempted: true, forcedAttempted: false, treeClosed: true };
    })
  });

  expect(outcome.status).toBe('fence-lost');
  expect(outcome.trigger).toBe('fence-lost');
  expect(outcome.termination.treeClosed).toBe(true);
});

test('default Windows terminator proves graceful taskkill tree closure through injected primitives', async () => {
  const root = fakeChild();
  const taskkillArgs: string[][] = [];
  const taskkillCommands: string[] = [];
  const taskkillCwds: Array<string | undefined> = [];
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`D:\WinRoot\System32`,
    terminationDeadlineMs: 50,
    terminationGraceMs: 10,
    timeoutMs: 5,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`D:\WinRoot`,
      spawnChild: (command, args, options) => {
        if (command === 'host-tool.exe') return root as unknown as ChildProcess;
        taskkillCommands.push(command);
        taskkillArgs.push([...args]);
        taskkillCwds.push(options.cwd === undefined ? undefined : String(options.cwd));
        const killer = fakeChild(50_001 + taskkillArgs.length);
        setTimeout(() => {
          closeChild(killer);
          closeChild(root);
        }, 0);
        return killer as unknown as ChildProcess;
      }
    }
  });

  expect(taskkillCommands).toEqual([String.raw`D:\WinRoot\System32\taskkill.exe`]);
  expect(taskkillArgs).toEqual([['/PID', '42424', '/T']]);
  expect(taskkillCwds).toEqual([String.raw`D:\WinRoot\System32`]);
  expect(outcome.status).toBe('timed-out');
  expect(outcome.termination).toMatchObject({
    gracefulAttempted: true,
    forcedAttempted: false,
    treeClosed: true
  });
});

test('production Job-controller termination still attempts graceful taskkill before stable force', async () => {
  const root = fakeChild();
  const taskkillArgs: string[][] = [];
  const taskkillCommands: string[] = [];
  const taskkillCwds: Array<string | undefined> = [];
  let taskkillJobCloseCalls = 0;
  let active = 1;
  let forcedCalls = 0;
  registerObservedWindowsJobControllerForTests(root as unknown as ChildProcess, {
    activeProcessCount: () => active,
    terminate: () => {
      forcedCalls += 1;
      active = 0;
      closeChild(root);
      return true;
    },
    close: () => undefined
  });
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 80,
    terminationGraceMs: 10,
    timeoutMs: 5,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      spawnChild: (command, args, options) => {
        if (command === 'host-tool.exe') return root as unknown as ChildProcess;
        taskkillCommands.push(command);
        taskkillArgs.push([...args]);
        taskkillCwds.push(options.cwd === undefined ? undefined : String(options.cwd));
        const killer = fakeChild(50_500);
        registerObservedWindowsJobControllerForTests(killer as unknown as ChildProcess, {
          activeProcessCount: () => 0,
          terminate: () => true,
          close: () => {
            taskkillJobCloseCalls += 1;
          }
        });
        setTimeout(() => closeChild(killer, 1), 0);
        return killer as unknown as ChildProcess;
      }
    }
  });
  expect(taskkillCommands).toEqual([String.raw`C:\Windows\System32\taskkill.exe`]);
  expect(taskkillArgs).toEqual([['/PID', '42424', '/T']]);
  expect(taskkillCwds).toEqual([String.raw`C:\Windows\System32`]);
  expect(taskkillJobCloseCalls).toBe(1);
  expect(forcedCalls).toBe(1);
  expect(outcome.status).toBe('timed-out');
  expect(outcome.termination).toMatchObject({
    gracefulAttempted: true,
    forcedAttempted: true,
    treeClosed: true
  });
});

test('unproved taskkill helper Job prevents a proved target Job from claiming tree closure', async () => {
  const root = fakeChild();
  let rootActive = 1;
  let killerTerminateCalls = 0;
  let killerCloseCalls = 0;
  registerObservedWindowsJobControllerForTests(root as unknown as ChildProcess, {
    activeProcessCount: () => rootActive,
    terminate: () => {
      rootActive = 0;
      closeChild(root);
      return true;
    },
    close: () => undefined
  });

  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 80,
    terminationGraceMs: 10,
    timeoutMs: 5,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      spawnChild: (command) => {
        if (command === 'host-tool.exe') return root as unknown as ChildProcess;
        const killer = fakeChild(50_750);
        registerObservedWindowsJobControllerForTests(killer as unknown as ChildProcess, {
          activeProcessCount: () => null,
          terminate: () => {
            killerTerminateCalls += 1;
            closeChild(killer, 1);
            return true;
          },
          close: () => {
            killerCloseCalls += 1;
          }
        });
        return killer as unknown as ChildProcess;
      }
    }
  });

  expect(outcome.status).toBe('termination-unproven');
  expect(outcome.trigger).toBe('timed-out');
  expect(outcome.termination).toMatchObject({
    requested: true,
    forcedAttempted: true,
    treeClosed: false
  });
  expect(killerTerminateCalls).toBe(1);
  expect(killerCloseCalls).toBe(1);
});

test('typed unproved taskkill lifecycle failure remains fail-closed after its Job controller is gone', async () => {
  const root = fakeChild();
  let rootActive = 1;
  registerObservedWindowsJobControllerForTests(root as unknown as ChildProcess, {
    activeProcessCount: () => rootActive,
    terminate: () => {
      rootActive = 0;
      closeChild(root);
      return true;
    },
    close: () => undefined
  });

  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 80,
    terminationGraceMs: 10,
    timeoutMs: 5,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      spawnChild: (command) => {
        if (command === 'host-tool.exe') return root as unknown as ChildProcess;
        const killer = fakeChild(50_800);
        setTimeout(() => {
          killer.emit('error', createObservedNativeLifecycleFailureForTests({
            status: 'termination-unproven',
            trigger: 'lifecycle-failed',
            started: true,
            termination: lifecycleTermination(false)
          }));
          setTimeout(() => killer.emit('close', null, null), 0);
        }, 0);
        return killer as unknown as ChildProcess;
      }
    }
  });

  expect(outcome.status).toBe('termination-unproven');
  expect(outcome.trigger).toBe('timed-out');
  expect(outcome.termination).toMatchObject({
    requested: true,
    forcedAttempted: true,
    treeClosed: false
  });
});

test('default Windows terminator escalates to forced taskkill when graceful proof is incomplete', async () => {
  const root = fakeChild();
  const taskkillArgs: string[][] = [];
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 80,
    terminationGraceMs: 10,
    timeoutMs: 5,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      spawnChild: (command, args) => {
        if (command === 'host-tool.exe') return root as unknown as ChildProcess;
        taskkillArgs.push([...args]);
        const killer = fakeChild(51_000 + taskkillArgs.length);
        setTimeout(() => {
          const forced = args.includes('/F');
          closeChild(killer, forced ? 0 : 1);
          if (forced) closeChild(root);
        }, 0);
        return killer as unknown as ChildProcess;
      }
    }
  });

  expect(taskkillArgs).toEqual([
    ['/PID', '42424', '/T'],
    ['/PID', '42424', '/T', '/F']
  ]);
  expect(outcome.status).toBe('timed-out');
  expect(outcome.termination).toMatchObject({
    gracefulAttempted: true,
    forcedAttempted: true,
    treeClosed: true
  });
});

test('default Windows terminator never forces a stale PID after direct child close', async () => {
  const root = fakeChild();
  const taskkillArgs: string[][] = [];
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 50,
    terminationGraceMs: 10,
    timeoutMs: 5,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      spawnChild: (command, args) => {
        if (command === 'host-tool.exe') return root as unknown as ChildProcess;
        taskkillArgs.push([...args]);
        const killer = fakeChild(51_500);
        setTimeout(() => {
          closeChild(killer, 1);
          closeChild(root);
        }, 0);
        return killer as unknown as ChildProcess;
      }
    }
  });

  expect(taskkillArgs).toEqual([['/PID', '42424', '/T']]);
  expect(outcome.status).toBe('termination-unproven');
  expect(outcome.termination.forcedAttempted).toBe(false);
});

test('default Windows terminator shares one absolute deadline across hanging taskkill phases', async () => {
  const root = fakeChild();
  const startedAt = performance.now();
  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    terminationDeadlineMs: 25,
    terminationGraceMs: 10,
    timeoutMs: 5,
    dependencies: {
      platform: 'win32',
      systemRoot: String.raw`C:\Windows`,
      spawnChild: (command) => command === 'host-tool.exe'
        ? root as unknown as ChildProcess
        : fakeChild(52_000) as unknown as ChildProcess
    }
  });

  expect(outcome.status).toBe('termination-unproven');
  expect(outcome.trigger).toBe('timed-out');
  expect(outcome.termination.treeClosed).toBe(false);
  expect(performance.now() - startedAt).toBeLessThan(250);
});

test('ACL grant failure cannot start profile creation or execution', async () => {
  let profileCalls = 0;
  let executionCalls = 0;
  await expect(runWindowsAppContainerExecutionStepsForTests({
    grantAcl: async () => {
      throw new WindowsAppContainerExecutionError('acl', undefined, {
        stage: 'acl-grant',
        reason: 'timeout',
        termination: 'confirmed'
      });
    },
    createProfile: async () => {
      profileCalls += 1;
    },
    execute: async () => {
      executionCalls += 1;
    }
  })).rejects.toMatchObject({
    phase: 'acl',
    hostToolFailure: {
      stage: 'acl-grant',
      reason: 'timeout',
      termination: 'confirmed'
    }
  });
  expect(profileCalls).toBe(0);
  expect(executionCalls).toBe(0);
});

test('timeout trigger remains primary when process-tree termination is unconfirmed', () => {
  expect(projectWindowsAppContainerHostToolFailureForTests('acl-grant', Object.freeze({
    status: 'termination-unproven',
    trigger: 'timed-out',
    started: true,
    exitCode: null,
    signal: null,
    durationMs: 120_000,
    stdout: Object.freeze({ bytes: 0, digest: `sha256:${'0'.repeat(64)}`, observerTruncated: false }),
    stderr: Object.freeze({ bytes: 0, digest: `sha256:${'0'.repeat(64)}`, observerTruncated: false }),
    termination: Object.freeze({
      requested: true,
      gracefulAttempted: true,
      forcedAttempted: true,
      childCloseObserved: false,
      streamsDrained: false,
      treeClosed: false
    })
  }))).toEqual({
    stage: 'acl-grant',
    reason: 'timeout',
    termination: 'unconfirmed'
  });
});

test('native lifecycle trigger projects to a truthful host-tool failure reason', () => {
  expect(projectWindowsAppContainerHostToolFailureForTests('profile-query', Object.freeze({
    status: 'lifecycle-failed',
    trigger: 'lifecycle-failed',
    started: true,
    exitCode: null,
    signal: null,
    durationMs: 25,
    stdout: Object.freeze({ bytes: 0, digest: `sha256:${'0'.repeat(64)}`, observerTruncated: false }),
    stderr: Object.freeze({ bytes: 0, digest: `sha256:${'0'.repeat(64)}`, observerTruncated: false }),
    termination: lifecycleTermination(true)
  }))).toEqual({
    stage: 'profile-query',
    reason: 'lifecycle-failure',
    termination: 'confirmed'
  });
});

test('unconfirmed host-tool termination behaviorally suppresses cleanup and preserves primary', async () => {
  let cleanupCalls = 0;
  const primary = new WindowsAppContainerExecutionError('acl', undefined, {
    stage: 'acl-grant',
    reason: 'timeout',
    termination: 'unconfirmed'
  });
  await expect(completeWindowsAppContainerOwnedExecutionForTests(
    undefined,
    primary,
    async () => {
      cleanupCalls += 1;
      throw new WindowsAppContainerExecutionError('cleanup');
    }
  )).rejects.toBe(primary);
  expect(cleanupCalls).toBe(0);
  expect(windowsAppContainerExecutionCleanupChainForTests(primary)).toEqual([]);
});

test('confirmed primary failure runs cleanup and retains ordered primary-plus-cleanup evidence', async () => {
  let cleanupCalls = 0;
  const primary = new WindowsAppContainerExecutionError('launch');
  const cleanup = new WindowsAppContainerExecutionError('cleanup', 21);
  await expect(completeWindowsAppContainerOwnedExecutionForTests(
    undefined,
    primary,
    async () => {
      cleanupCalls += 1;
      throw cleanup;
    }
  )).rejects.toBe(primary);
  expect(cleanupCalls).toBe(1);
  expect(windowsAppContainerExecutionCleanupChainForTests(primary)).toEqual([cleanup]);
});

function observedStream(contents: Uint8Array, observerTruncated = false) {
  return Object.freeze({
    bytes: contents.byteLength,
    digest: `sha256:${createHash('sha256').update(contents).digest('hex')}` as const,
    observerTruncated
  });
}

function exactNativeHelperOutcome(stdout: Uint8Array, stderr: Uint8Array): ObservedCommandOutcome {
  return Object.freeze({
    status: 'exited',
    started: true,
    exitCode: 0,
    signal: null,
    durationMs: 12,
    stdout: observedStream(stdout),
    stderr: observedStream(stderr),
    termination: Object.freeze({
      requested: false,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    })
  });
}

test('native helper deadline arbitration gives the child a finite preparation-to-exit budget', () => {
  const explicit = arbitrateNativeExecutionDeadlinesForTests(60_000);
  expect(explicit).toEqual({ childTimeoutMs: 60_000, hostWatchdogMs: 70_000 });
  expect(Object.isFrozen(explicit)).toBe(true);

  const implicit = arbitrateNativeExecutionDeadlinesForTests(undefined);
  expect(implicit).toEqual({ childTimeoutMs: 120_000, hostWatchdogMs: 130_000 });
  expect(Object.isFrozen(implicit)).toBe(true);

  const helperEntryBudget = createNativeExecutionBudgetForTests(
    60_000,
    1_000
  );
  expect(helperEntryBudget).toEqual({ startedAtMs: 1_000, timeoutMs: 60_000 });
  expect(Object.isFrozen(helperEntryBudget)).toBe(true);
});

test('native helper deadline arbitration rejects invalid and overflowing budgets', () => {
  for (const timeoutMs of [0, -1, 1.5]) {
    expect(() => arbitrateNativeExecutionDeadlinesForTests(timeoutMs))
      .toThrow(WindowsAppContainerExecutionError);
  }

  const maximumChildTimeoutMs = Number.MAX_SAFE_INTEGER - 10_000;
  expect(arbitrateNativeExecutionDeadlinesForTests(
    maximumChildTimeoutMs
  )).toEqual({
    childTimeoutMs: maximumChildTimeoutMs,
    hostWatchdogMs: Number.MAX_SAFE_INTEGER
  });
  expect(() => arbitrateNativeExecutionDeadlinesForTests(
    maximumChildTimeoutMs + 1
  )).toThrow(WindowsAppContainerExecutionError);
});

test('native helper elapsed budget is bounded and fails closed on clock rollback', () => {
  const budget = createNativeExecutionBudgetForTests(60_000, 1_000);
  expect(remainingNativeExecutionBudgetForTests(budget, 1_000)).toBe(60_000);
  expect(remainingNativeExecutionBudgetForTests(budget, 60_999)).toBe(1);

  for (const observedAtMs of [999, 61_000, Number.NaN]) {
    try {
      remainingNativeExecutionBudgetForTests(budget, observedAtMs);
      throw new Error('expected elapsed budget rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(WindowsAppContainerExecutionError);
      expect(error).toMatchObject({ phase: 'timeout' });
    }
  }
});

test('native worker supervisor settles exactly once across completion failure and timeout', async () => {
  let terminal: ((value: unknown) => void) | undefined;
  let fail: (() => void) | undefined;
  let timer: (() => void) | undefined;
  let clearCalls = 0;
  const timers = {
    setTimer: (callback: () => void) => {
      timer = callback;
      return 1;
    },
    clearTimer: () => {
      clearCalls += 1;
    }
  };
  const completed = superviseWindowsAppContainerNativeWorkerForHelper(
    'execute',
    60_000,
    (onTerminal, onFailure) => {
      terminal = onTerminal;
      fail = onFailure;
    },
    timers
  );
  terminal!({ kind: 'completed', exitCode: 44 });
  fail!();
  timer!();
  expect(await completed).toEqual({ kind: 'completed', exitCode: 44 });
  expect(clearCalls).toBe(1);

  const suspendedCreated = superviseWindowsAppContainerNativeWorkerForHelper(
    'suspended-create',
    60_000,
    (onMessage) => {
      onMessage({ kind: 'progress', stage: 'create-entered' });
      onMessage({ kind: 'progress', stage: 'create-returned' });
      onMessage({ kind: 'progress', stage: 'job-settled' });
      onMessage({ kind: 'suspended-created' });
    },
    timers
  );
  expect(await suspendedCreated).toEqual({ kind: 'suspended-created' });

  const failureWire = encodeWindowsAppContainerNativeFailure(
    new WindowsAppContainerExecutionError('timeout')
  );
  const failed = superviseWindowsAppContainerNativeWorkerForHelper(
    'execute',
    60_000,
    (onTerminal) => onTerminal({ kind: 'failed', payload: failureWire }),
    timers
  );
  expect(await failed).toEqual({ kind: 'failed', payload: failureWire });

  let closeTerminal: ((value: unknown) => void) | undefined;
  let close: (() => void) | undefined;
  const closed = superviseWindowsAppContainerNativeWorkerForHelper(
    'execute',
    60_000,
    (onTerminal, onFailure) => {
      closeTerminal = onTerminal;
      close = onFailure;
    },
    timers
  );
  close!();
  closeTerminal!({ kind: 'completed', exitCode: 0 });
  const closeError = await closed.then(() => undefined, (error: unknown) => error);
  expect(closeError).toMatchObject({ code: 'VERIFY-APPCONTAINER-UNAVAILABLE' });
  expect(clearCalls).toBe(4);

  let progressMessage: ((value: unknown) => void) | undefined;
  const timedOut = superviseWindowsAppContainerNativeWorkerForHelper(
    'suspended-create',
    60_000,
    (onMessage) => {
      progressMessage = onMessage;
    },
    timers
  );
  progressMessage!({ kind: 'progress', stage: 'create-entered' });
  timer!();
  const timeoutError = await timedOut.then(() => undefined, (error: unknown) => error);
  expect(timeoutError).toBeInstanceOf(WindowsAppContainerExecutionError);
  expect(timeoutError).toMatchObject({ phase: 'timeout' });
  expect((timeoutError as WindowsAppContainerExecutionError).nativeWorkerProgressStage)
    .toBe('create-entered');
  expect(remainingWindowsAppContainerNativeHelperTimeout(60_000, 1_000, 1_100))
    .toBe(59_900);
});

test('execute helper settles the child deadline before the host watchdog', () => {
  const observedAtMs = [1_000, 61_000];
  const waitSlices: number[] = [];
  let innerFailure: unknown;
  try {
    waitForNativeProcessForTests(60_000, 1_000, {
      nowMs: () => observedAtMs.shift()!,
      waitForProcess: (timeoutMs) => {
        waitSlices.push(timeoutMs);
        return 0x0000_0102;
      }
    });
  } catch (error) {
    innerFailure = error;
  }

  expect(innerFailure).toBeInstanceOf(WindowsAppContainerExecutionError);
  expect(innerFailure).toMatchObject({ phase: 'timeout' });
  expect(waitSlices).toEqual([20]);
  const failureWire = String(encodeWindowsAppContainerNativeFailure(innerFailure));
  expect(failureWire).toBe('{"status":"failed","phase":"timeout"}');

  let receiptBackedFailure: unknown;
  try {
    settleWindowsAppContainerNativeHelperInvocationForTests(
      'execute',
      1,
      failureWire,
      false,
      { value: JSON.parse(failureWire) }
    );
  } catch (error) {
    receiptBackedFailure = error;
  }
  expect(receiptBackedFailure).toBeInstanceOf(WindowsAppContainerExecutionError);
  expect(receiptBackedFailure).toMatchObject({
    phase: 'timeout',
    nativeHelperObservation: {
      mode: 'execute',
      exitClass: 'nonzero',
      diagnosticStream: 'empty',
      protocol: 'declared-failure',
      nativeReceipt: 'declared-failure'
    }
  });
  expect(nativeHelperSettlementForTests(
    receiptBackedFailure as Error
  )).toBeUndefined();
});

test('execute helper explicitly settles the inner AppContainer Job within one finite budget', () => {
  let nowMs = 1_000;
  let terminateCalls = 0;
  let waitCalls = 0;
  let sleepCalls = 0;
  const activeProcesses = [2, 1, 0];
  expect(settleNativeJobAfterFailureForTests({
    nowMs: () => nowMs,
    terminateJob: () => {
      terminateCalls += 1;
      return true;
    },
    waitForRoot: () => {
      waitCalls += 1;
      return 0;
    },
    queryActiveProcesses: () => activeProcesses.shift() ?? 0,
    sleep: (timeoutMs) => {
      sleepCalls += 1;
      nowMs += timeoutMs;
    }
  }, 100)).toBe(true);
  expect({ terminateCalls, waitCalls, sleepCalls }).toEqual({
    terminateCalls: 1,
    waitCalls: 1,
    sleepCalls: 2
  });

  expect(settleNativeJobAfterFailureForTests({
    nowMs: () => 1_000,
    terminateJob: () => true,
    waitForRoot: () => 0,
    queryActiveProcesses: () => null,
    sleep: () => undefined
  }, 100)).toBe(false);

  let deadlineNowMs = 2_000;
  let deadlineSleepCalls = 0;
  expect(settleNativeJobAfterFailureForTests({
    nowMs: () => deadlineNowMs,
    terminateJob: () => true,
    waitForRoot: (timeoutMs) => {
      deadlineNowMs += timeoutMs;
      return 0;
    },
    queryActiveProcesses: () => 1,
    sleep: () => {
      deadlineSleepCalls += 1;
    }
  }, 20)).toBe(false);
  expect(deadlineSleepCalls).toBe(0);
});

function captureObservedNativeHelperFailure(
  outcome: ObservedCommandOutcome,
  stdout: Uint8Array = new Uint8Array(),
  stderr: Uint8Array = new Uint8Array(),
  mode: 'derive' | 'create-profile' | 'execute' = 'execute'
): WindowsAppContainerExecutionError {
  try {
    settleObservedWindowsAppContainerNativeHelperForTests(outcome, stdout, stderr, mode);
  } catch (error) {
    expect(error).toBeInstanceOf(WindowsAppContainerExecutionError);
    return error as WindowsAppContainerExecutionError;
  }
  throw new Error('expected observed native helper settlement to fail');
}

test('native helper settlement sidecar survives finite preparation normalization', () => {
  const primary = new WindowsAppContainerExecutionError('preparation');
  bindNativeHelperSettlement(
    primary,
    'derive',
    Object.freeze({ status: 'rejected', reason: 'not-exited' })
  );

  const normalized = normalizeWindowsAppContainerPreparationErrorForTests(
    primary,
    'native-helper-invocation'
  ) as WindowsAppContainerExecutionError;
  const settlement = nativeHelperSettlementForTests(normalized);

  expect(normalized).not.toBe(primary);
  expect(normalized.preparationSubstage).toBe('native-helper-invocation');
  expect(settlement).toBe(nativeHelperSettlementForTests(primary));
  expect(settlement).toEqual({ mode: 'derive', reason: 'not-exited' });
  expect(Object.keys(settlement ?? {})).toEqual(['mode', 'reason']);
  expect(normalized.nativeHelperObservation).toBeUndefined();
});

test('observed native helper settlement classifier separates finite lifecycle dimensions', () => {
  const stdout = Buffer.from('{"status":"ok"}', 'utf8');
  const exact = exactNativeHelperOutcome(stdout, new Uint8Array());
  const cases: readonly Readonly<{
    outcome: ObservedCommandOutcome;
    expected: ReturnType<typeof classifyObservedWindowsAppContainerNativeHelperForTests>;
  }>[] = [
    { outcome: exact, expected: { status: 'success' } },
    {
      outcome: Object.freeze({
        ...exact,
        status: 'lifecycle-failed',
        trigger: 'lifecycle-failed'
      }),
      expected: { status: 'rejected', reason: 'not-exited' }
    },
    {
      outcome: Object.freeze({
        ...exact,
        status: 'termination-unproven',
        trigger: 'timed-out',
        termination: Object.freeze({
          ...exact.termination,
          requested: true,
          childCloseObserved: false,
          streamsDrained: false,
          treeClosed: false
        })
      }),
      expected: { status: 'rejected', reason: 'timed-out' }
    },
    {
      outcome: Object.freeze({ ...exact, status: 'spawn-failed', started: false }),
      expected: { status: 'rejected', reason: 'not-started' }
    },
    {
      outcome: Object.freeze({
        ...exact,
        termination: Object.freeze({ ...exact.termination, requested: true })
      }),
      expected: { status: 'rejected', reason: 'requested-termination' }
    },
    {
      outcome: Object.freeze({
        ...exact,
        status: 'tree-unproven',
        termination: Object.freeze({ ...exact.termination, treeClosed: false })
      }),
      expected: { status: 'rejected', reason: 'closure-unproven' }
    },
    {
      outcome: Object.freeze({ ...exact, exitCode: null }),
      expected: { status: 'rejected', reason: 'exit-status-unproven' }
    }
  ];
  for (const { outcome, expected } of cases) {
    const classification = classifyObservedWindowsAppContainerNativeHelperForTests(
      outcome,
      stdout,
      new Uint8Array()
    );
    expect(classification).toEqual(expected);
    expect(Object.isFrozen(classification)).toBe(true);
    if (classification.status === 'rejected') {
      const primary = captureObservedNativeHelperFailure(outcome, stdout);
      const settlement = nativeHelperSettlementForTests(primary);
      expect(settlement).toEqual({ mode: 'execute', reason: classification.reason });
      expect(Object.isFrozen(settlement)).toBe(true);
      expect(Object.keys(settlement ?? {})).toEqual(['mode', 'reason']);
      expect(primary.nativeHelperObservation).toBeUndefined();
    }
  }
});

test('observed native helper settlement classifier separates stream truncation and evidence mismatch', () => {
  const stdout = Buffer.from('{"status":"ok"}', 'utf8');
  const diagnostic = Buffer.from('diagnostic', 'utf8');
  const emptyDiagnostic = new Uint8Array();
  const exact = exactNativeHelperOutcome(stdout, emptyDiagnostic);
  const exactWithDiagnostic = exactNativeHelperOutcome(stdout, diagnostic);
  const cases: readonly Readonly<{
    outcome: ObservedCommandOutcome;
    observedStdout: Uint8Array;
    observedDiagnostic: Uint8Array;
    reason: Extract<
      ReturnType<typeof classifyObservedWindowsAppContainerNativeHelperForTests>,
      { readonly status: 'rejected' }
    >['reason'];
  }>[] = [
    {
      outcome: Object.freeze({
        ...exact,
        stdout: Object.freeze({ ...exact.stdout, observerTruncated: true })
      }),
      observedStdout: stdout,
      observedDiagnostic: emptyDiagnostic,
      reason: 'stdout-truncated'
    },
    {
      outcome: Object.freeze({
        ...exactWithDiagnostic,
        stderr: Object.freeze({ ...exactWithDiagnostic.stderr, observerTruncated: true })
      }),
      observedStdout: stdout,
      observedDiagnostic: diagnostic,
      reason: 'stderr-truncated'
    },
    {
      outcome: exact,
      observedStdout: Buffer.from('{"status":"no"}', 'utf8'),
      observedDiagnostic: emptyDiagnostic,
      reason: 'stdout-evidence-mismatch'
    },
    {
      outcome: exactWithDiagnostic,
      observedStdout: stdout,
      observedDiagnostic: Buffer.from('mismatch', 'utf8'),
      reason: 'stderr-evidence-mismatch'
    }
  ];
  for (const { outcome, observedStdout, observedDiagnostic, reason } of cases) {
    const classification = classifyObservedWindowsAppContainerNativeHelperForTests(
      outcome,
      observedStdout,
      observedDiagnostic
    );
    expect(classification).toEqual({ status: 'rejected', reason });
    expect(Object.isFrozen(classification)).toBe(true);
    const primary = captureObservedNativeHelperFailure(
      outcome,
      observedStdout,
      observedDiagnostic,
      'create-profile'
    );
    const settlement = nativeHelperSettlementForTests(primary);
    expect(settlement).toEqual({ mode: 'create-profile', reason });
    expect(Object.isFrozen(settlement)).toBe(true);
    expect(Object.keys(settlement ?? {})).toEqual(['mode', 'reason']);
    expect(primary.nativeHelperObservation).toBeUndefined();
  }
});

test('native helper classification stays explanatory while closed-tree evidence governs cleanup', async () => {
  const wire = Buffer.from('{"status":"ok"}', 'utf8');
  const exact = exactNativeHelperOutcome(wire, new Uint8Array());
  const closedTimedOut = Object.freeze({
    ...exact,
    status: 'timed-out' as const,
    trigger: 'timed-out' as const,
    termination: Object.freeze({ ...exact.termination, requested: true })
  });
  expect(classifyObservedWindowsAppContainerNativeHelperForTests(
    closedTimedOut,
    wire,
    new Uint8Array()
  )).toEqual({ status: 'rejected', reason: 'timed-out' });

  const primary = captureObservedNativeHelperFailure(closedTimedOut, wire);
  expect(nativeHelperSettlementForTests(primary)).toEqual({
    mode: 'execute',
    reason: 'timed-out'
  });
  let cleanupCalls = 0;
  await expect(completeWindowsAppContainerOwnedExecutionForTests(
    undefined,
    primary,
    async () => {
      cleanupCalls += 1;
    }
  )).rejects.toBe(primary);
  expect(cleanupCalls).toBe(1);
});

test('observed native helper accepts only an exact closed-tree untruncated wire', () => {
  const stdout = Buffer.from('{"status":"ok"}', 'utf8');
  const result = settleObservedWindowsAppContainerNativeHelperForTests(
    exactNativeHelperOutcome(stdout, new Uint8Array()),
    stdout,
    new Uint8Array()
  );
  expect(result).toEqual({
    code: 0,
    payload: '{"status":"ok"}',
    diagnosticPresent: false
  });
  const diagnostic = Buffer.from('redacted', 'utf8');
  expect(settleObservedWindowsAppContainerNativeHelperForTests(
    exactNativeHelperOutcome(stdout, diagnostic),
    stdout,
    diagnostic
  )).toEqual({
    code: 0,
    payload: '{"status":"ok"}',
    diagnosticPresent: true
  });
});

test('unproved native helper trees retain all owned resources without public diagnostic growth', async () => {
  for (const trigger of ['timed-out', 'observer-failed', 'aborted'] as const) {
    const primary = captureObservedNativeHelperFailure(Object.freeze({
      status: 'termination-unproven',
      trigger,
      started: true,
      exitCode: null,
      signal: null,
      durationMs: 20_000,
      stdout: observedStream(new Uint8Array()),
      stderr: observedStream(new Uint8Array()),
      termination: Object.freeze({
        requested: true,
        gracefulAttempted: true,
        forcedAttempted: true,
        childCloseObserved: false,
        streamsDrained: false,
        treeClosed: false
      })
    }));
    let cleanupCalls = 0;
    for (let layer = 0; layer < 2; layer++) {
      await expect(completeWindowsAppContainerOwnedExecutionForTests(
        undefined,
        primary,
        async () => {
          cleanupCalls += 1;
        }
      )).rejects.toBe(primary);
    }
    expect(cleanupCalls).toBe(0);
    expect(primary).toMatchObject({
      phase: 'preparation',
      preparationSubstage: 'native-helper-invocation'
    });
    expect(primary.hostToolFailure).toBeUndefined();
    expect(nativeHelperSettlementForTests(primary)).toEqual({
      mode: 'execute',
      reason: trigger === 'timed-out' ? 'timed-out' : 'closure-unproven'
    });
    expect(windowsAppContainerExecutionCleanupChainForTests(primary)).toEqual([]);
  }
});

test('closed-tree native helper protocol failures permit cleanup while preserving the primary', async () => {
  const wire = Buffer.from('{"status":"ok"}', 'utf8');
  const exact = exactNativeHelperOutcome(wire, new Uint8Array());
  const truncated = Object.freeze({
    ...exact,
    stdout: Object.freeze({ ...exact.stdout, observerTruncated: true })
  });
  const failures = [
    {
      primary: captureObservedNativeHelperFailure(truncated, wire),
      reason: 'stdout-truncated'
    },
    {
      primary: captureObservedNativeHelperFailure(
        exact,
        Buffer.from('{"status":"failed"}', 'utf8')
      ),
      reason: 'stdout-evidence-mismatch'
    },
    {
      primary: captureObservedNativeHelperFailure(Object.freeze({
        status: 'spawn-failed',
        started: false,
        exitCode: null,
        signal: null,
        durationMs: 1,
        stdout: observedStream(new Uint8Array()),
        stderr: observedStream(new Uint8Array()),
        termination: Object.freeze({
          requested: false,
          gracefulAttempted: false,
          forcedAttempted: false,
          childCloseObserved: false,
          streamsDrained: true,
          treeClosed: true
        })
      })),
      reason: 'not-started'
    }
  ] as const;
  for (const { primary, reason } of failures) {
    expect(nativeHelperSettlementForTests(primary)).toEqual({
      mode: 'execute',
      reason
    });
    let cleanupCalls = 0;
    await expect(completeWindowsAppContainerOwnedExecutionForTests(
      undefined,
      primary,
      async () => {
        cleanupCalls += 1;
      }
    )).rejects.toBe(primary);
    expect(cleanupCalls).toBe(1);
  }
});
