import { afterEach, beforeEach, expect, mock, test } from 'bun:test';

import type { ObservedCommandOptions, ObservedCommandOutcome } from '../../src/runtime-state/physical/runtime/observed-process.ts';
import { compilerRoot } from '../../src/workspace/runtime/paths.ts';

type ObservedCommandCall = Readonly<{
  command: string;
  args: readonly string[];
  options: ObservedCommandOptions;
}>;

type ObservedCommandRunner = (
  command: string,
  args: readonly string[],
  options: ObservedCommandOptions
) => Promise<ObservedCommandOutcome> | ObservedCommandOutcome;

const observedCommandCalls: ObservedCommandCall[] = [];
let observedCommandRunner: ObservedCommandRunner | undefined;

mock.module('../../src/runtime-state/physical/runtime/observed-process.ts', () => ({
  runObservedCommand: async (
    command: string,
    args: readonly string[],
    options: ObservedCommandOptions
  ): Promise<ObservedCommandOutcome> => {
    observedCommandCalls.push({ command, args: [...args], options });
    if (observedCommandRunner === undefined) {
      throw new Error('Missing canonical observed-command test response');
    }
    return observedCommandRunner(command, args, options);
  }
}));

const {
  DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES,
  boundedUtf8TextTail,
  devCommandObservationExitCode,
  runDevCommand
} = await import('../../src/development/runner/command-runner.ts');

const digest = `sha256:${'0'.repeat(64)}` as const;

function physicalOutcome(
  overrides: Partial<ObservedCommandOutcome> = {}
): ObservedCommandOutcome {
  return Object.freeze({
    status: 'exited' as const,
    started: true,
    exitCode: 0,
    signal: null,
    durationMs: 7,
    stdout: Object.freeze({ bytes: 0, digest, observerTruncated: false }),
    stderr: Object.freeze({ bytes: 0, digest, observerTruncated: false }),
    termination: Object.freeze({
      requested: false,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    }),
    ...overrides
  });
}

let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  observedCommandCalls.length = 0;
  observedCommandRunner = undefined;
  originalStdoutWrite = process.stdout.write;
  originalStderrWrite = process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

test('canonical UTF-8 text tails retain only complete code points within the byte cap', () => {
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
  expect(() => boundedUtf8TextTail('anything', -1)).toThrow('non-negative safe integer');
});

test('legacy mode delegates argv and returns the canonical physical exit code', async () => {
  observedCommandRunner = () => physicalOutcome({ exitCode: 7 });
  const result = runDevCommand(
    'bun',
    ['test', '--concurrent', 'tests/unit/example.test.ts'],
    { CUSTOM_TEST_ENV: 'present' }
  );

  expect(await result).toBe(7);
  expect(observedCommandCalls).toHaveLength(1);
  expect(observedCommandCalls[0]).toMatchObject({
    command: 'bun',
    options: {
      cwd: compilerRoot,
      env: { CUSTOM_TEST_ENV: 'present' },
      stdio: 'inherit'
    }
  });
  expect(observedCommandCalls[0]!.args.slice(0, 4)).toEqual([
    'test',
    '--concurrent',
    '--max-concurrency',
    expect.any(String)
  ]);
});

test('observed mode forwards live output and retains bounded UTF-8 tails', async () => {
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

  const stdout = Buffer.alloc(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 5, 0x61);
  const stderr = Buffer.alloc(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 7, 0x62);
  observedCommandRunner = (_command, _args, options) => {
    options.onOutput?.('stdout', stdout);
    options.onOutput?.('stderr', stderr);
    return physicalOutcome();
  };

  const args = [
    'test',
    '--concurrent',
    '--max-concurrency',
    '2',
    'tests/unit/example.test.ts'
  ];
  const observation = await runDevCommand('bun', args, {}, { observe: true });

  expect(observedCommandCalls[0]!.args).toEqual(args);
  expect(observedCommandCalls[0]!.options).toMatchObject({
    cwd: compilerRoot,
    stdio: ['inherit', 'pipe', 'pipe'],
    maxObservedOutputBytes: Number.MAX_SAFE_INTEGER
  });
  expect(observation).toMatchObject({
    schema: 'sec-dev-command-observation-v1',
    effectiveArgv: ['bun', ...args],
    terminal: { kind: 'exited', exitCode: 0 },
    observationIntegrity: { kind: 'complete' }
  });
  expect(Buffer.byteLength(observation.stdoutTail)).toBe(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect(Buffer.byteLength(observation.stderrTail)).toBe(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect(observation.durationMs).toBe(7);
  expect(stdoutWrites).toEqual([stdout]);
  expect(stderrWrites).toEqual([stderr]);
  expect(devCommandObservationExitCode(observation)).toBe(0);
});

test('invalid and lone-surrogate output remain bounded replacement scalars', async () => {
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  observedCommandRunner = (_command, _args, options) => {
    options.onOutput?.('stdout', Buffer.alloc(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 11, 0xff));
    options.onOutput?.('stderr', Buffer.from('\ud800'.repeat(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES)));
    return physicalOutcome();
  };

  const observation = await runDevCommand('bun', ['--version'], {}, { observe: true });
  const serialized = JSON.parse(JSON.stringify(observation)) as {
    stdoutTail: string;
    stderrTail: string;
  };
  expect(Buffer.byteLength(serialized.stdoutTail, 'utf8'))
    .toBeLessThanOrEqual(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect(Buffer.byteLength(serialized.stderrTail, 'utf8'))
    .toBeLessThanOrEqual(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect([...serialized.stdoutTail].every((character) => character === '�')).toBe(true);
  expect([...serialized.stderrTail].every((character) => character === '�')).toBe(true);
});

test('observed nonzero exit remains a structured nonzero outcome', async () => {
  observedCommandRunner = () => physicalOutcome({ exitCode: 9 });
  const observation = await runDevCommand('bun', ['--version'], {}, { observe: true });

  expect(observation.terminal).toEqual({ kind: 'exited', exitCode: 9 });
  expect(devCommandObservationExitCode(observation)).toBe(9);
});

test('signal and unresolved physical outcomes remain fail-closed', async () => {
  observedCommandRunner = () => physicalOutcome({
    status: 'lifecycle-failed',
    signal: 'SIGTERM',
    exitCode: null
  });
  const signaled = await runDevCommand('bun', ['--version'], {}, { observe: true });
  expect(signaled.terminal).toEqual({ kind: 'signaled', signal: 'SIGTERM' });
  expect(devCommandObservationExitCode(signaled)).toBe(1);

  observedCommandRunner = () => physicalOutcome({
    status: 'termination-unproven',
    signal: null,
    exitCode: null
  });
  const unresolved = await runDevCommand('bun', ['--version'], {}, { observe: true });
  expect(unresolved.terminal).toEqual({ kind: 'unresolved', reason: 'close-without-status' });
  expect(devCommandObservationExitCode(unresolved)).toBe(1);
});

test('contradictory physical exit and signal remain unresolved', async () => {
  observedCommandRunner = () => physicalOutcome({
    status: 'lifecycle-failed',
    signal: 'SIGTERM',
    exitCode: 5
  });
  const observation = await runDevCommand('bun', ['--version'], {}, { observe: true });

  expect(observation.terminal).toEqual({
    kind: 'unresolved',
    reason: 'contradictory-close-status'
  });
  expect(devCommandObservationExitCode(observation)).toBe(1);
});

test('canonical spawn failure is structured for observation and rejected for legacy callers', async () => {
  observedCommandRunner = () => physicalOutcome({
    status: 'spawn-failed',
    started: false,
    exitCode: null,
    signal: null
  });
  const observed = await runDevCommand('missing-command', [], {}, { observe: true });
  expect(observed.terminal).toEqual({
    kind: 'spawn-failed',
    error: 'canonical observed command transport failed to spawn'
  });
  expect(devCommandObservationExitCode(observed)).toBe(1);
  await expect(runDevCommand('missing-command', [], {})).rejects.toThrow('failed to spawn');
});

test('live-output forwarding failure invalidates the observation', async () => {
  process.stdout.write = (() => {
    throw new Error('stdout observer sentinel');
  }) as typeof process.stdout.write;
  observedCommandRunner = (_command, _args, options) => {
    options.onOutput?.('stdout', Buffer.from('visible before observer failure'));
    return physicalOutcome();
  };

  const observation = await runDevCommand('bun', ['--version'], {}, { observe: true });
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

afterEach(() => {
  mock.restore();
});
