import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { expect, test } from 'bun:test';

import {
  createObservedNativeLifecycleFailureForTests,
  decodeWindowsJobActiveProcessCountForTests,
  registerObservedWindowsJobControllerForTests,
  runObservedCommand,
  windowsPipeFailureDispositionForTests,
  windowsWaitDispositionForTests,
  type ObservedCommandDependencies,
  type ObservedCommandOutcome
} from '../../platform/shared/observed-process.ts';
import {
  arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests,
  classifyObservedWindowsAppContainerNativeHelperForTests,
  completeWindowsAppContainerOwnedExecutionForTests,
  createWindowsAppContainerNativeExecutionBudgetForTests,
  projectWindowsAppContainerHostToolFailureForTests,
  remainingWindowsAppContainerNativeExecutionBudgetForTests,
  runWindowsAppContainerExecutionStepsForTests,
  settleObservedWindowsAppContainerNativeHelperForTests,
  windowsAppContainerExecutionCleanupChainForTests,
  WindowsAppContainerExecutionError
} from '../../platform/shared/windows-appcontainer-executor.ts';

interface FakeChild extends EventEmitter {
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
  expect(decodeWindowsJobActiveProcessCountForTests(accounting)).toBe(3);
  expect(windowsWaitDispositionForTests(0)).toBe('signaled');
  expect(windowsWaitDispositionForTests(0x102)).toBe('pending');
  expect(windowsWaitDispositionForTests(0xffff_ffff)).toBe('failed');
  expect(windowsWaitDispositionForTests(7)).toBe('failed');
  expect(windowsPipeFailureDispositionForTests(109)).toBe('eof');
  expect(windowsPipeFailureDispositionForTests(232)).toBe('eof');
  expect(windowsPipeFailureDispositionForTests(5)).toBe('failed');
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

test('natural child close is not process-tree closure without an independent census proof', async () => {
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

  expect(outcome.status).toBe('tree-unproven');
  expect(outcome.exitCode).toBe(0);
  expect(outcome.termination).toMatchObject({
    requested: false,
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
        const killer = fakeChild(50_001 + taskkillArgs.length);
        setTimeout(() => {
          closeChild(killer);
          closeChild(root);
        }, 0);
        return killer as unknown as ChildProcess;
      }
    }
  });

  expect(taskkillArgs).toEqual([['/PID', '42424', '/T']]);
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
  const explicit = arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(60_000);
  expect(explicit).toEqual({ childTimeoutMs: 60_000, hostWatchdogMs: 70_000 });
  expect(Object.isFrozen(explicit)).toBe(true);

  const implicit = arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(undefined);
  expect(implicit).toEqual({ childTimeoutMs: 120_000, hostWatchdogMs: 130_000 });
  expect(Object.isFrozen(implicit)).toBe(true);

  const helperEntryBudget = createWindowsAppContainerNativeExecutionBudgetForTests(
    60_000,
    1_000
  );
  expect(helperEntryBudget).toEqual({ startedAtMs: 1_000, timeoutMs: 60_000 });
  expect(Object.isFrozen(helperEntryBudget)).toBe(true);
});

test('native helper deadline arbitration rejects invalid and overflowing budgets', () => {
  for (const timeoutMs of [0, -1, 1.5]) {
    expect(() => arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(timeoutMs))
      .toThrow(WindowsAppContainerExecutionError);
  }

  const maximumChildTimeoutMs = Number.MAX_SAFE_INTEGER - 10_000;
  expect(arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(
    maximumChildTimeoutMs
  )).toEqual({
    childTimeoutMs: maximumChildTimeoutMs,
    hostWatchdogMs: Number.MAX_SAFE_INTEGER
  });
  expect(() => arbitrateWindowsAppContainerNativeExecutionDeadlinesForTests(
    maximumChildTimeoutMs + 1
  )).toThrow(WindowsAppContainerExecutionError);
});

test('native helper elapsed budget is bounded and fails closed on clock rollback', () => {
  const budget = createWindowsAppContainerNativeExecutionBudgetForTests(60_000, 1_000);
  expect(remainingWindowsAppContainerNativeExecutionBudgetForTests(budget, 1_000)).toBe(60_000);
  expect(remainingWindowsAppContainerNativeExecutionBudgetForTests(budget, 60_999)).toBe(1);

  for (const observedAtMs of [999, 61_000, Number.NaN]) {
    try {
      remainingWindowsAppContainerNativeExecutionBudgetForTests(budget, observedAtMs);
      throw new Error('expected elapsed budget rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(WindowsAppContainerExecutionError);
      expect(error).toMatchObject({ phase: 'timeout' });
    }
  }
});

test('observed native helper settlement classifier separates finite lifecycle dimensions', () => {
  const stdout = Buffer.from('{"status":"ok"}', 'utf8');
  const exact = exactNativeHelperOutcome(stdout, new Uint8Array());
  const cases: readonly Readonly<{
    outcome: ObservedCommandOutcome;
    expected: Readonly<Record<string, string>>;
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
    reason: string;
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
  }
});

function captureObservedNativeHelperFailure(
  outcome: ObservedCommandOutcome,
  stdout = new Uint8Array()
): WindowsAppContainerExecutionError {
  try {
    settleObservedWindowsAppContainerNativeHelperForTests(outcome, stdout, new Uint8Array());
  } catch (error) {
    expect(error).toBeInstanceOf(WindowsAppContainerExecutionError);
    return error as WindowsAppContainerExecutionError;
  }
  throw new Error('expected observed native helper settlement to fail');
}

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
    captureObservedNativeHelperFailure(truncated, wire),
    captureObservedNativeHelperFailure(exact, Buffer.from('{"status":"failed"}', 'utf8')),
    captureObservedNativeHelperFailure(Object.freeze({
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
    }))
  ];
  for (const primary of failures) {
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
