import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES,
  boundedUtf8TextTail,
  devCommandObservationExitCode,
  runDevCommand
} from '../../../src/adapters/self-hosting/development/runner/command-runner.ts';
import { DEV_COMMAND_MAX_DURATION_MS, DEV_COMMAND_MAX_STDIN_BYTES } from '../../../src/adapters/self-hosting/development/runner/contract.ts';
import { compilerRoot } from "../../../src/adapters/workspace-context.ts";
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
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

test('canonical Bun execution retains an owner-admitted cwd and script input', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-dev-command-cwd-'));
  return settleWorkspaceCallback(async () => {
    const scriptPath = path.join(root, 'cwd.ts');
    await writeFile(
      scriptPath,
      "process.stdout.write(JSON.stringify({cwd: process.cwd(), marker: 'retained-script'}));\n",
      'utf8'
    );
    const stdoutWrites: Uint8Array[] = [];
    process.stdout.write = ((chunk: Uint8Array) => {
      stdoutWrites.push(Buffer.from(chunk));
      return true;
    }) as typeof process.stdout.write;

    const code = await runDevCommand('bun', [scriptPath], {}, {
      auxiliaryOrdinaryFilePaths: [scriptPath],
      workingDirectory: root
    });
    expect(code).toBe(0);
    expect(JSON.parse(Buffer.concat(stdoutWrites).toString('utf8'))).toEqual({
      cwd: root,
      marker: 'retained-script'
    });
  }, () => rm(root, { recursive: true, force: true }));
});

test('canonical Bun execution binds cwd and environment, delivers stdin, and rejects invalid admission', async () => {
  const input = Buffer.from('fresh-process-standard-input', 'utf8');
  const stdoutWrites: Uint8Array[] = [];
  const stderrWrites: Uint8Array[] = [];
  process.stdout.write = ((chunk: Uint8Array) => {
    stdoutWrites.push(Buffer.from(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: Uint8Array) => {
    stderrWrites.push(Buffer.from(chunk));
    return true;
  }) as typeof process.stderr.write;

  const observation = await runDevCommand('bun', [
    '--no-env-file',
    '--eval',
    'process.stdout.write(await Bun.stdin.text());'
      + 'process.stderr.write(JSON.stringify({cwd: process.cwd(), marker: process.env.SEC_DEV_COMMAND_MARKER}));'
  ], { SEC_DEV_COMMAND_MARKER: 'owner-bound' }, { input, observe: true });

  expect(observation).toMatchObject({
    schema: 'sec-dev-command-observation-v1',
    terminal: { kind: 'exited', exitCode: 0 },
    observationIntegrity: { kind: 'complete' }
  });
  expect(devCommandObservationExitCode(observation)).toBe(0);
  expect(JSON.parse(Buffer.concat(stderrWrites).toString('utf8'))).toEqual({
    cwd: compilerRoot,
    marker: 'owner-bound'
  });
  expect(Buffer.concat(stdoutWrites)).toEqual(input);

  expect(() => runDevCommand('bun', ['--version'], {}, {
    input: new Uint8Array(DEV_COMMAND_MAX_STDIN_BYTES + 1)
  })).toThrow('byte snapshot limit');
  expect(() => runDevCommand('bun', ['--version'], {}, {
    deadlineAtUnixMs: Date.now() - 1
  })).toThrow('parent deadline is exhausted');
});

test('observed execution forwards bounded UTF-8 tails and preserves a nonzero exit', async () => {
  const stdoutWrites: Uint8Array[] = [];
  const stderrWrites: Uint8Array[] = [];
  process.stdout.write = ((chunk: Uint8Array) => {
    stdoutWrites.push(Buffer.from(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: Uint8Array) => {
    stderrWrites.push(Buffer.from(chunk));
    return true;
  }) as typeof process.stderr.write;

  const observation = await runDevCommand('bun', [
    '--no-env-file',
    '--eval',
    `process.stdout.write('a'.repeat(${DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 5}));`
      + `process.stderr.write('b'.repeat(${DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 7}));`
      + 'process.exitCode = 9;'
  ], {}, { observe: true });

  expect(observation.schema).toBe('sec-dev-command-observation-v1');
  expect(observation.terminal).toEqual({ kind: 'exited', exitCode: 9 });
  expect(observation.observationIntegrity).toEqual({ kind: 'complete' });
  expect(Buffer.byteLength(observation.stdoutTail)).toBe(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect(Buffer.byteLength(observation.stderrTail)).toBe(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES);
  expect(Buffer.concat(stdoutWrites).byteLength).toBe(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 5);
  expect(Buffer.concat(stderrWrites).byteLength).toBe(DEV_COMMAND_OUTPUT_TAIL_MAX_BYTES + 7);
  expect(devCommandObservationExitCode(observation)).toBe(9);
  // Reuse this real completed command observation to retain the existing
  // exact integer-exit input classes. No further
  // native process is needed for synthetic terminal variations.
  for (const exitCode of [0, 255, -1]) {
    expect(devCommandObservationExitCode({
      ...observation, terminal: { kind: 'exited', exitCode }
    })).toBe(exitCode);
  }
});

test('unsupported executables and caller budget widening are rejected before execution', async () => {
  await expect(runDevCommand('node', ['--version'], {})).rejects.toThrow(
    'only the canonical Bun runtime'
  );
  expect(() => runDevCommand('bun', ['--version'], {}, {
    observe: true,
    timeoutMs: DEV_COMMAND_MAX_DURATION_MS + 1
  })).toThrow('within the owner duration ceiling');
});

test('caller cancellation and deadline exhaustion fail closed', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancel-before-admission'));
  await expect(runDevCommand('bun', ['--version'], {}, {
    observe: true,
    signal: controller.signal
  })).rejects.toThrow('cancelled');

  await expect(runDevCommand('bun', ['--version'], {}, {
    observe: true,
    timeoutMs: 2
  })).rejects.toThrow('absolute deadline is not narrowed from its attempt');
});

test('output-forwarding failure invalidates an otherwise completed observation', async () => {
  process.stdout.write = (() => {
    throw new Error('stdout observer sentinel');
  }) as typeof process.stdout.write;
  const observation = await runDevCommand('bun', [
    '--no-env-file',
    '--eval',
    "process.stdout.write('visible before observer failure')"
  ], {}, { observe: true });

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
