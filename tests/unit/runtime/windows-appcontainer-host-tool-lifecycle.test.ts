import { settleResourcesAsync, type ResourceSettlementFailure } from '../../../src/execution/resource-settlement.ts';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { expect, test } from 'bun:test';

import { createObservedNativeLifecycleFailureForTests, observedCommandNativeLifecycleDiagnosticForTests, registerObservedWindowsJobControllerForTests, runObservedCommand, type ObservedCommandDependencies } from '../../../src/adapters/runtime-state/physical/runtime/observed-process.ts';
import { decodeWindowsJobActiveProcessCount, windowsNaturalExitSettlementDisposition, windowsPipeFailureDisposition, windowsWaitDisposition } from '../../../src/adapters/runtime-state/physical/runtime/windows-process-codec.ts';

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
    let rootMayBeRetired = true;
    let primary: ResourceSettlementFailure | undefined;

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
      rootMayBeRetired = false;
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
      rootMayBeRetired = outcome.termination.treeClosed
        && outcome.termination.streamsDrained
        && (!outcome.started || outcome.termination.childCloseObserved);

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
    } catch (error) {
      primary = { label: 'native hard-exit fixture', error };
      throw error;
    } finally {
      await settleResourcesAsync({ primary, cleanup: [{
        label: 'native hard-exit fixture root',
        settle: async () => {
          if (!rootMayBeRetired) {
            throw new Error(`Native child settlement is unproven; fixture root is preserved: ${tempRoot}`);
          }
          await rm(tempRoot, { force: true, recursive: true });
        }
      }] });
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
