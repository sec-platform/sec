import type { SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';

interface FakeChild extends EventEmitter {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
}

type SpawnCall = {
  readonly command: string;
  readonly args: string[];
  readonly options: SpawnOptions;
};

const spawnCalls: SpawnCall[] = [];
const spawnResults: Array<FakeChild | Error> = [];

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  Object.defineProperties(child, {
    stdout: { value: new PassThrough(), enumerable: true },
    stderr: { value: new PassThrough(), enumerable: true }
  });
  return child;
}

mock.module('node:child_process', () => ({
  spawn: (command: string, args: string[], options: SpawnOptions) => {
    spawnCalls.push({ command, args, options });
    const result = spawnResults.shift();
    if (!result) throw new Error('Missing fake child process');
    if (result instanceof Error) throw result;
    return result;
  }
}));

const {
  DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES,
  boundedUtf8TextTail,
  devCommandObservationExitCode,
  runDevCommand
} = await import('../../platform/dev-runner/command-runner.ts');

let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  spawnCalls.length = 0;
  spawnResults.length = 0;
  originalStdoutWrite = process.stdout.write;
  originalStderrWrite = process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

afterAll(() => {
  mock.restore();
});

test.serial('canonical UTF-8 text tails retain only complete code points within the byte cap', () => {
  expect(boundedUtf8TextTail('prefix🙂界', 7)).toBe('🙂界');
  expect(boundedUtf8TextTail('prefix🙂界', 6)).toBe('界');
  expect(boundedUtf8TextTail('🙂', 3)).toBe('');

  for (const loneSurrogate of ['\ud800', '\udc00']) {
    for (const maximumBytes of [0, 1, 2]) {
      expect(boundedUtf8TextTail(loneSurrogate, maximumBytes)).toBe('');
    }
    for (const maximumBytes of [3, 4]) {
      expect(boundedUtf8TextTail(loneSurrogate, maximumBytes)).toBe('�');
    }
  }

  const invalidRawTail = boundedUtf8TextTail(Buffer.from([0xff, 0xff, 0xff]), 5);
  expect([...invalidRawTail]).toEqual(['�']);
  expect(Buffer.byteLength(invalidRawTail, 'utf8')).toBeLessThanOrEqual(5);
  expect(boundedUtf8TextTail('anything', 0)).toBe('');
  expect(() => boundedUtf8TextTail('anything', -1)).toThrow(
    'non-negative safe integer'
  );
});

test.serial('legacy three-argument API retains numeric exit behavior through one no-shell spawn', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  const result = runDevCommand('bun', [
    'test',
    '--concurrent',
    'tests/unit/example.test.ts'
  ], {});

  expect(spawnCalls).toHaveLength(1);
  expect(spawnCalls[0]).toMatchObject({
    command: 'bun',
    options: {
      shell: false,
      stdio: 'inherit'
    }
  });
  expect(spawnCalls[0].args.slice(0, 4)).toEqual([
    'test',
    '--concurrent',
    '--max-concurrency',
    expect.any(String)
  ]);
  child.emit('close', 7, null);

  expect(await result).toBe(7);
});

test.serial('observed mode preserves explicit argv, forwards live output, and bounds both tails', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  const stdoutWrites: Uint8Array[] = [];
  const stderrWrites: Uint8Array[] = [];
  process.stdout.write = ((chunk: Uint8Array) => {
    stdoutWrites.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: Uint8Array) => {
    stderrWrites.push(chunk);
    return true;
  }) as typeof process.stderr.write;
  const args = [
    'test',
    '--concurrent',
    '--max-concurrency',
    '2',
    'tests/unit/example.test.ts'
  ];
  const result = runDevCommand('bun', args, {}, { observe: true });
  const stdout = Buffer.alloc(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 5, 0x61);
  const stderr = Buffer.alloc(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 7, 0x62);
  child.stdout.emit('data', stdout);
  child.stderr.emit('data', stderr);
  child.emit('close', 0, null);

  const observation = await result;
  expect(spawnCalls[0].args).toEqual(args);
  expect(spawnCalls[0].options).toMatchObject({
    shell: false,
    stdio: ['inherit', 'pipe', 'pipe']
  });
  expect(observation).toMatchObject({
    schema: 'sec-dev-command-observation-v1',
    effectiveArgv: ['bun', ...args],
    terminal: { kind: 'exited', exitCode: 0 },
    observationIntegrity: { kind: 'complete' }
  });
  expect(Buffer.byteLength(observation.stdoutTail)).toBe(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect(Buffer.byteLength(observation.stderrTail)).toBe(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect(observation.durationMs).toBeGreaterThanOrEqual(0);
  expect(stdoutWrites).toEqual([stdout]);
  expect(stderrWrites).toEqual([stderr]);
  expect(devCommandObservationExitCode(observation)).toBe(0);
});

test.serial('invalid raw output cannot expand the serialized observation beyond its byte cap', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  const result = runDevCommand('bun', ['--version'], {}, { observe: true });
  child.stdout.emit('data', Buffer.alloc(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 11, 0xff));
  child.stderr.emit('data', Buffer.from('界'.repeat(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)));
  child.emit('close', 0, null);

  const serialized = JSON.parse(JSON.stringify(await result)) as {
    stdoutTail: string;
    stderrTail: string;
  };
  expect(Buffer.byteLength(serialized.stdoutTail, 'utf8'))
    .toBeLessThanOrEqual(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect(Buffer.byteLength(serialized.stderrTail, 'utf8'))
    .toBeLessThanOrEqual(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect([...serialized.stdoutTail].every((character) => character === '�')).toBe(true);
  expect(serialized.stderrTail).not.toContain('�');
  expect([...serialized.stderrTail].every((character) => character === '界')).toBe(true);
});

test.serial('lone surrogate output remains a complete replacement scalar within public observation caps', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  const result = runDevCommand('bun', ['--version'], {}, { observe: true });
  child.stdout.emit('data', '\ud800'.repeat(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES));
  child.stderr.emit('data', '\udc00'.repeat(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES));
  child.emit('close', 0, null);

  const serialized = JSON.parse(JSON.stringify(await result)) as {
    stdoutTail: string;
    stderrTail: string;
  };
  for (const field of [serialized.stdoutTail, serialized.stderrTail]) {
    expect(Buffer.byteLength(field, 'utf8')).toBeLessThanOrEqual(
      DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES
    );
    expect(field.length).toBeGreaterThan(0);
    expect([...field].every((character) => character === '�')).toBe(true);
  }
});

test.serial('observed nonzero exit remains a structured nonzero outcome', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  const result = runDevCommand('bun', ['--version'], {}, { observe: true });
  child.emit('close', 9, null);

  const observation = await result;
  expect(observation.terminal).toEqual({ kind: 'exited', exitCode: 9 });
  expect(devCommandObservationExitCode(observation)).toBe(9);
});

test.serial('signal termination is distinct from a normal exit and remains nonzero', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  const result = runDevCommand('bun', ['--version'], {}, { observe: true });
  child.emit('close', null, 'SIGTERM');

  const observation = await result;
  expect(observation.terminal).toEqual({ kind: 'signaled', signal: 'SIGTERM' });
  expect(devCommandObservationExitCode(observation)).toBe(1);
});

test.serial('async error-only spawn failure settles observed and legacy callers immediately', async () => {
  const observedChild = fakeChild();
  spawnResults.push(observedChild);
  const observedResult = runDevCommand('missing-command', [], {}, { observe: true });
  observedChild.emit('error', new Error('spawn sentinel'));

  const observation = await observedResult;
  expect(observation.terminal).toEqual({ kind: 'spawn-failed', error: 'spawn sentinel' });
  expect(devCommandObservationExitCode(observation)).toBe(1);

  const legacyChild = fakeChild();
  spawnResults.push(legacyChild);
  const legacyResult = runDevCommand('missing-command', [], {});
  legacyChild.emit('error', new Error('legacy spawn sentinel'));
  await expect(legacyResult).rejects.toThrow('legacy spawn sentinel');
});

test.serial('synchronous spawn failure resolves observed mode and rejects legacy mode', async () => {
  spawnResults.push(
    new Error('sync spawn sentinel'),
    new Error('legacy sync spawn sentinel')
  );

  const observation = await runDevCommand('missing-command', [], {}, { observe: true });

  expect(observation.terminal).toEqual({ kind: 'spawn-failed', error: 'sync spawn sentinel' });
  expect(devCommandObservationExitCode(observation)).toBe(1);
  await expect(runDevCommand('missing-command', [], {}))
    .rejects.toThrow('legacy sync spawn sentinel');
});

test.serial('error before close wins exactly once', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  const result = runDevCommand('missing-command', [], {}, { observe: true });

  child.emit('error', new Error('first error wins'));
  child.emit('close', 23, null);

  expect((await result).terminal).toEqual({
    kind: 'spawn-failed',
    error: 'first error wins'
  });
});

test.serial('close before a late error preserves the first terminal outcome', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  const result = runDevCommand('bun', ['--version'], {}, { observe: true });

  child.emit('close', 0, null);
  child.emit('error', new Error('late error must be ignored'));

  expect((await result).terminal).toEqual({ kind: 'exited', exitCode: 0 });
});

test.serial('duplicate close preserves the first terminal outcome', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  const result = runDevCommand('bun', ['--version'], {}, { observe: true });

  child.emit('close', 5, null);
  child.emit('close', null, 'SIGTERM');

  expect((await result).terminal).toEqual({ kind: 'exited', exitCode: 5 });
});

test.serial('close without code or signal is a distinct fail-closed terminal outcome', async () => {
  const observedChild = fakeChild();
  spawnResults.push(observedChild);
  const observedResult = runDevCommand('bun', ['--version'], {}, { observe: true });
  observedChild.emit('close', null, null);

  const observation = await observedResult;
  expect(observation.terminal).toEqual({
    kind: 'unresolved',
    reason: 'close-without-status'
  });
  expect(devCommandObservationExitCode(observation)).toBe(1);

  const legacyChild = fakeChild();
  spawnResults.push(legacyChild);
  const legacyResult = runDevCommand('bun', ['--version'], {});
  legacyChild.emit('close', null, null);
  expect(await legacyResult).toBe(1);
});

test.serial('close with both code and signal is a distinct contradictory unresolved outcome', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  const result = runDevCommand('bun', ['--version'], {}, { observe: true });
  child.emit('close', 5, 'SIGTERM');

  const observation = await result;
  expect(observation.terminal).toEqual({
    kind: 'unresolved',
    reason: 'contradictory-close-status'
  });
  expect(devCommandObservationExitCode(observation)).toBe(1);
});

test.serial('live-output forwarding failure is observed and forces a nonzero outcome', async () => {
  const child = fakeChild();
  spawnResults.push(child);
  process.stdout.write = (() => {
    throw new Error('stdout observer sentinel');
  }) as typeof process.stdout.write;
  const result = runDevCommand('bun', ['--version'], {}, { observe: true });
  child.stdout.emit('data', Buffer.from('visible before observer failure'));
  child.emit('close', 0, null);

  const observation = await result;
  expect(observation).toMatchObject({
    terminal: { kind: 'exited', exitCode: 0 },
    observationIntegrity: {
      kind: 'failed',
      error: 'stdout forwarding failed: stdout observer sentinel'
    },
    stdoutTail: 'visible before observer failure'
  });
  expect(devCommandObservationExitCode(observation)).toBe(1);
});
