import { expect, test } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  openObservedNativeProcessResourceLedger,
  runObservedCommand
} from '../../src/adapters/runtime-state/physical/runtime/observed-process-stdin.ts';

function fixture(streams: 'null' | 'undefined' | 'pipes', started = false) {
  const empty = streams === 'null' ? null : undefined;
  const child = Object.assign(new EventEmitter(), {
    pid: started ? 42_424 : undefined,
    stdin: empty,
    stdout: streams === 'pipes' ? new PassThrough() : empty,
    stderr: streams === 'pipes' ? new PassThrough() : empty
  });
  const ledger = openObservedNativeProcessResourceLedger({
    maximumResources: 1, deadlineAtMonotonicMs: performance.now() + 5_000
  });
  let terminations = 0;
  const close = (drain = true) => {
    if (drain) { child.stdout?.emit('end'); child.stderr?.emit('end'); }
    child.emit('close', started ? 0 : -2, null);
  };
  const execute = (afterSettlement?: () => Promise<void>) => runObservedCommand('fixture-not-an-executable', [], {
    cwd: process.cwd(), maxObservedOutputBytes: 0,
    timeoutMs: 1_000, terminationGraceMs: 5, terminationDeadlineMs: 30,
    nativeResourceLedger: ledger, afterSettlement,
    dependencies: {
      spawnChild: () => child as unknown as ChildProcess,
      inspectProcessTreeClosed: async () => false,
      terminateProcessTree: async () => {
        terminations++; close();
        return { treeClosed: started, gracefulAttempted: started, forcedAttempted: false };
      }
    }
  });
  return { child, ledger, close, execute, terminations: () => terminations };
}

for (const streams of ['null', 'undefined', 'pipes'] as const) {
  test(`asynchronous spawn failure waits for ${streams} stream closure without inventing a started root`, async () => {
    const f = fixture(streams);
    setTimeout(() => { f.child.emit('error', new Error('spawn failed')); f.close(); }, 0);
    const outcome = await f.execute();
    expect(outcome).toMatchObject({
      status: 'spawn-failed', started: false, exitCode: null, signal: null,
      termination: { requested: false, childCloseObserved: true, streamsDrained: true, treeClosed: true }
    });
    expect(f.terminations()).toBe(0);
    expect(f.ledger.close()).toMatchObject({
      admittedResourceCount: 1, startedResourceCount: 0, settledResourceCount: 1, failedAdmissionCount: 1
    });
  });
}

for (const missing of ['close', 'drain'] as const) {
  test(`spawn error alone does not prove settlement when ${missing} evidence is missing`, async () => {
    const f = fixture('pipes');
    setTimeout(() => {
      f.child.emit('error', new Error('spawn failed'));
      if (missing === 'drain') f.close(false);
    }, 0);
    const outcome = await f.execute();
    expect(outcome).toMatchObject({ status: 'termination-unproven', started: false, termination: { treeClosed: false } });
    expect(f.terminations()).toBe(0);
    expect(f.ledger.close().failedAdmissionCount).toBe(1);
    f.child.stdout?.destroy(); f.child.stderr?.destroy();
  });
}

test('errors from an actually started root retain process-tree termination and started accounting', async () => {
  const f = fixture('pipes', true);
  setTimeout(() => { f.child.emit('spawn'); f.child.emit('error', new Error('running process error')); }, 0);
  expect(await f.execute()).toMatchObject({ status: 'lifecycle-failed', started: true, termination: { treeClosed: true } });
  expect(f.terminations()).toBe(1);
  expect(f.ledger.close()).toMatchObject({ startedResourceCount: 1, failedAdmissionCount: 0, settledResourceCount: 1 });
});

test('a failed post-settlement fence cannot be replaced by the spawn-failed classification', async () => {
  const f = fixture('undefined');
  setTimeout(() => { f.child.emit('error', new Error('spawn failed')); f.close(); }, 0);
  expect(await f.execute(async () => { throw new Error('lost fence'); })).toMatchObject({ status: 'fence-lost' });
  expect(f.ledger.close().failedAdmissionCount).toBe(1);
});
