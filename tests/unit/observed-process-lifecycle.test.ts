import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { expect, test } from 'bun:test';

import {
  runObservedCommand,
  type ObservedCommandDependencies
} from '../../platform/shared/observed-process.ts';

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

test('observed command completes before its deadline without requesting termination', async () => {
  const child = fakeChild();
  let terminations = 0;
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from('ok'));
    closeChild(child);
  }, 0);

  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    maxObservedOutputBytes: 16,
    timeoutMs: 100,
    dependencies: dependencies(child, async () => {
      terminations += 1;
      return { gracefulAttempted: true, forcedAttempted: false, treeClosed: true };
    })
  });

  expect(outcome).toMatchObject({
    status: 'exited',
    exitCode: 0,
    stdout: {
      bytes: 2,
      digest: `sha256:${createHash('sha256').update('ok').digest('hex')}`,
      observerTruncated: false
    },
    termination: { requested: false, treeClosed: true }
  });
  expect(terminations).toBe(0);
});

test('observed command closes the tree when its output budget observer rejects a chunk', async () => {
  const child = fakeChild();
  setTimeout(() => child.stdout.emit('data', Buffer.alloc(17)), 0);

  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    maxObservedOutputBytes: 16,
    onChunk: (_stream, byteLength) => {
      if (byteLength > 16) throw new Error('output budget exceeded');
    },
    timeoutMs: 100,
    dependencies: dependencies(child, async () => {
      closeChild(child);
      return { gracefulAttempted: true, forcedAttempted: false, treeClosed: true };
    })
  });

  expect(outcome).toMatchObject({
    status: 'observer-failed',
    trigger: 'observer-failed',
    termination: {
      requested: true,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    }
  });
});

test('observed command keeps its lease fence active through post-close tree settlement', async () => {
  const child = fakeChild();
  let releaseInspection!: (closed: boolean) => void;
  let inspectionStarted!: () => void;
  const inspection = new Promise<void>((resolve) => { inspectionStarted = resolve; });
  const treeClosed = new Promise<boolean>((resolve) => { releaseInspection = resolve; });
  let fenceCalls = 0;
  const outcomePromise = runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    fenceIntervalMs: 1,
    timeoutMs: 1_000,
    whileRunning: async () => { fenceCalls += 1; },
    dependencies: {
      ...dependencies(child, async () => ({
        gracefulAttempted: false,
        forcedAttempted: false,
        treeClosed: true
      })),
      inspectProcessTreeClosed: async () => {
        inspectionStarted();
        return treeClosed;
      }
    }
  });
  setTimeout(() => closeChild(child), 0);

  await inspection;
  const callsAtRootClose = fenceCalls;
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fenceCalls).toBeGreaterThan(callsAtRootClose);
  releaseInspection(true);
  const outcome = await outcomePromise;
  expect(outcome.status).toBe('exited');
  expect(outcome.termination.treeClosed).toBe(true);
});

test('observed command reports lease loss while post-close tree settlement is pending', async () => {
  const child = fakeChild();
  let releaseInspection!: (closed: boolean) => void;
  let inspectionStarted!: () => void;
  let fenceRejected!: () => void;
  const inspection = new Promise<void>((resolve) => { inspectionStarted = resolve; });
  const treeClosed = new Promise<boolean>((resolve) => { releaseInspection = resolve; });
  const rejectionObserved = new Promise<void>((resolve) => { fenceRejected = resolve; });
  let leaseValid = true;
  let terminations = 0;
  const outcomePromise = runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    fenceIntervalMs: 1,
    timeoutMs: 1_000,
    whileRunning: async () => {
      if (!leaseValid) {
        fenceRejected();
        throw new Error('lease lost after root close');
      }
    },
    dependencies: {
      ...dependencies(child, async () => {
        terminations += 1;
        return {
          gracefulAttempted: true,
          forcedAttempted: false,
          treeClosed: true
        };
      }),
      inspectProcessTreeClosed: async () => {
        inspectionStarted();
        return treeClosed;
      }
    }
  });
  setTimeout(() => closeChild(child), 0);

  await inspection;
  leaseValid = false;
  await rejectionObserved;
  releaseInspection(true);
  const outcome = await outcomePromise;
  expect(outcome.status).toBe('fence-lost');
  expect(outcome.trigger).toBe('fence-lost');
  expect(terminations).toBe(1);
  expect(outcome.termination.requested).toBe(true);
  expect(outcome.termination.treeClosed).toBe(true);
});

test('natural child close triggers bounded cleanup when census cannot prove tree closure', async () => {
  const child = fakeChild();
  let terminations = 0;
  setTimeout(() => closeChild(child), 0);

  const outcome = await runObservedCommand('host-tool.exe', [], {
    cwd: String.raw`C:\Windows\System32`,
    timeoutMs: 100,
    dependencies: {
      ...dependencies(child, async () => {
        terminations += 1;
        return {
          gracefulAttempted: true,
          forcedAttempted: false,
          treeClosed: true
        };
      }),
      inspectProcessTreeClosed: async () => false
    }
  });

  expect(outcome).toMatchObject({
    status: 'lifecycle-failed',
    trigger: 'lifecycle-failed',
    exitCode: 0,
    termination: {
      requested: true,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    }
  });
  expect(terminations).toBe(1);
});
