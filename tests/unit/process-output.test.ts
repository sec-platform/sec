import { expect, test } from 'bun:test';
import path from 'node:path';

import { inspectNoFollowDirectoryChain, PhysicalNoFollowError, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { issueRetainedCommandBoundary, RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, RetainedCommandTransportError, runCommand, runCommandBytes, runRetainedCommand, runRetainedCommandBytes } from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import { compilerRoot } from "../../src/adapters/workspace-context.ts";

const splitUtf8Script = [
  "const chunks = [Buffer.from('docs/'), Buffer.from([0xe4]), Buffer.from([0xb8]), Buffer.from([0xad]), Buffer.from('.md\\0')];",
  'let index = 0;',
  'const writeNext = () => {',
  '  process.stdout.write(chunks[index++]);',
  '  if (index < chunks.length) setTimeout(writeNext, 20);',
  '};',
  'writeNext();'
].join('\n');

test('runCommandBytes preserves a UTF-8 code point split across child stdout writes', async () => {
  const result = await runCommandBytes(process.execPath, ['--no-env-file', '--eval', splitUtf8Script], {
    cwd: compilerRoot,
    timeoutMs: 5_000
  });

  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toEqual(new TextEncoder().encode('docs/中.md\0'));
});

test('runCommand streams split UTF-8 stdout and stderr through stateful decoders', async () => {
  const script = [
    "const stdoutChunks = [Buffer.from('out:'), Buffer.from([0xe4]), Buffer.from([0xb8]), Buffer.from([0xad])];",
    "const stderrChunks = [Buffer.from('err:'), Buffer.from([0xe6]), Buffer.from([0x96]), Buffer.from([0x87])];",
    'let index = 0;',
    'const writeNext = () => {',
    '  process.stdout.write(stdoutChunks[index]);',
    '  process.stderr.write(stderrChunks[index]);',
    '  index += 1;',
    '  if (index < stdoutChunks.length) setTimeout(writeNext, 20);',
    '};',
    'writeNext();'
  ].join('\n');

  const result = await runCommand(process.execPath, ['--no-env-file', '--eval', script], {
    cwd: compilerRoot,
    timeoutMs: 5_000
  });

  expect(result).toEqual({ code: 0, stdout: 'out:中', stderr: 'err:文' });
});

test('runCommand keeps the default stdout contract textual', async () => {
  const result = await runCommand(process.execPath, [
    '--no-env-file',
    '--eval',
    "process.stdout.write('text-output')"
  ], { cwd: compilerRoot, timeoutMs: 5_000 });

  expect(result).toEqual({ code: 0, stdout: 'text-output', stderr: '' });
});

test('command stdin is exact and rejected before spawn when it exceeds its bound', async () => {
  const input = new Uint8Array([0, 1, 2, 10, 255]);
  const result = await runCommandBytes(process.execPath, [
    '--no-env-file',
    '--eval',
    'process.stdin.pipe(process.stdout)'
  ], {
    cwd: compilerRoot,
    input,
    maxStdinBytes: input.byteLength,
    timeoutMs: 5_000
  });
  expect(result).toEqual({ code: 0, stdout: input, stderr: '' });

  await expect(runCommandBytes('command-must-not-start', [], {
    cwd: compilerRoot,
    input,
    maxStdinBytes: input.byteLength - 1,
    timeoutMs: 5_000
  })).rejects.toThrow(`stdin exceeds ${input.byteLength - 1} bytes`);
});

test('runCommandBytes enforces stdout and stderr byte limits before accumulation', async () => {
  const stdout = runCommandBytes(process.execPath, [
    '--no-env-file',
    '--eval',
    "process.stdout.write('12345')"
  ], { cwd: compilerRoot, maxStdoutBytes: 4, timeoutMs: 5_000 });
  await expect(stdout).rejects.toThrow('stdout exceeded 4 bytes');

  const stderr = runCommandBytes(process.execPath, [
    '--no-env-file',
    '--eval',
    "process.stderr.write('12345')"
  ], { cwd: compilerRoot, maxStderrBytes: 4, timeoutMs: 5_000 });
  await expect(stderr).rejects.toThrow('stderr exceeded 4 bytes');

  const exact = await runCommandBytes(process.execPath, [
    '--no-env-file',
    '--eval',
    "process.stdout.write('1234'); process.stderr.write('5678')"
  ], { cwd: compilerRoot, maxStdoutBytes: 4, maxStderrBytes: 4, timeoutMs: 5_000 });
  expect(exact).toEqual({ code: 0, stdout: new TextEncoder().encode('1234'), stderr: '5678' });
});

test('runCommand stall deadline advances only on admitted semantic progress', async () => {
  const chatter = runCommand(process.execPath, [
    '--no-env-file',
    '--eval',
    "setInterval(() => process.stdout.write('chatter\\n'), 15)"
  ], {
    cwd: compilerRoot,
    timeoutMs: 2_000,
    stallTimeoutMs: 500,
    admitProgress: () => false
  });
  await expect(chatter).rejects.toThrow('made no admitted progress for 500ms');

  const progress = await runCommand(process.execPath, [
    '--no-env-file',
    '--eval',
    "let n=0; const t=setInterval(() => { process.stdout.write(String(++n)); if(n===4){clearInterval(t)} }, 100)"
  ], {
    cwd: compilerRoot,
    timeoutMs: 2_000,
    stallTimeoutMs: 500,
    admitProgress: (chunk) => chunk.length > 0
  });
  expect(progress.stdout).toBe('1234');
});

test('runCommand rejects a stall deadline without a stricter absolute deadline and admission rule', async () => {
  await expect(runCommand(process.execPath, ['--version'], {
    cwd: compilerRoot,
    stallTimeoutMs: 100
  })).rejects.toThrow('stallTimeoutMs requires');
});

const RETAINED_TEST_COMMAND_BUDGET = Object.freeze({
  maxStderrBytes: 1024 * 1024,
  maxStdoutBytes: 1024 * 1024,
  timeoutMs: 5_000
});

test.skipIf(process.platform !== 'win32' && process.platform !== 'linux')(
  'retained byte transport executes and revalidates one immutable executable image',
  async () => {
  const executablePath = path.resolve(process.execPath);
  const parent = inspectNoFollowDirectoryChain(path.dirname(executablePath), 'test executable parent');
  const retained = retainNoFollowOrdinaryFile(
    parent,
    path.basename(executablePath),
    undefined,
    'test executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const retainedWorkingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(compilerRoot, 'test command cwd'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'test command cwd'
  );
  const boundary = issueRetainedCommandBoundary({
    executable: retained,
    workingDirectory: retainedWorkingDirectory
  });
  try {
    const bytes = await runRetainedCommandBytes(boundary, [
      '--no-env-file',
      '--eval',
      "const chunks=[];process.stdin.on('data',(chunk)=>chunks.push(chunk));process.stdin.on('end',()=>process.stdout.write(Buffer.concat(chunks)))"
    ], {
      ...RETAINED_TEST_COMMAND_BUDGET,
      input: new Uint8Array([0, 1, 255]),
      maxStdinBytes: 3
    });
    expect(bytes).toEqual({ code: 0, stdout: new Uint8Array([0, 1, 255]), stderr: '' });
    retained.assertCurrent();
    retainedWorkingDirectory.assertCurrent();
  } finally {
    retainedWorkingDirectory.dispose();
    retained.dispose();
  }
  }
);

test.skipIf(process.platform === 'win32' || process.platform === 'linux')(
  'retained executable admission stays typed unavailable on unsupported platforms',
  () => {
    const executablePath = path.resolve(process.execPath);
    let failure: unknown;
    try {
      retainNoFollowOrdinaryFile(
        inspectNoFollowDirectoryChain(path.dirname(executablePath), 'unsealed executable parent'),
        path.basename(executablePath),
        undefined,
        'unsealed executable admission',
        RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
        'executable'
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PhysicalNoFollowError);
    expect((failure as PhysicalNoFollowError).code).toBe(
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
    );
    expect((failure as Error).message).toMatch(/backend is available|backend is unavailable/u);
  }
);

test.skipIf(process.platform !== 'win32')(
  'retained command timeout returns only after process-tree and stream settlement',
  async () => {
  const executablePath = path.resolve(process.execPath);
  const retained = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(executablePath), 'timeout executable parent'),
    path.basename(executablePath),
    undefined,
    'timeout executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const retainedWorkingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(compilerRoot, 'timeout command cwd'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'timeout command cwd'
  );
  const boundary = issueRetainedCommandBoundary({
    executable: retained,
    workingDirectory: retainedWorkingDirectory
  });
  let failure: unknown;
  try {
    await runRetainedCommand(boundary, [
      '--no-env-file',
      '--eval',
      [
        "const { spawn } = require('node:child_process');",
        "spawn(process.execPath, ['--no-env-file', '--eval', 'setInterval(() => {}, 1_000)'], { stdio: 'ignore' });",
        'setInterval(() => {}, 1_000);'
      ].join('\n')
    ], {
      maxStderrBytes: 1024,
      maxStdoutBytes: 1024,
      terminationDeadlineMs: 2_000,
      terminationGraceMs: 250,
      timeoutMs: 100
    });
  } catch (error) {
    failure = error;
  } finally {
    retainedWorkingDirectory.dispose();
    retained.dispose();
  }

  expect(failure).toBeInstanceOf(RetainedCommandTransportError);
  const typed = failure as RetainedCommandTransportError;
  expect(typed.outcome).toMatchObject({
    status: 'timed-out',
    trigger: 'timed-out',
    termination: {
      requested: true,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    }
  });
  }
);

test('retained command issuer rejects a physical file not issued for executable use', () => {
  const executablePath = path.resolve(process.execPath);
  const ordinaryFile = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(executablePath), 'ordinary file parent'),
    path.basename(executablePath),
    undefined,
    'ordinary file role confusion',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR
  );
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(compilerRoot, 'role confusion cwd'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'role confusion cwd'
  );
  try {
    expect(() => issueRetainedCommandBoundary({
      executable: ordinaryFile,
      workingDirectory
    })).toThrow('role executable');
  } finally {
    workingDirectory.dispose();
    ordinaryFile.dispose();
  }
});

test.skipIf(process.platform !== 'win32')(
  'retained command transport rejects a disposed capability before spawn',
  async () => {
  const executablePath = path.resolve(process.execPath);
  const parent = inspectNoFollowDirectoryChain(path.dirname(executablePath), 'disposed executable parent');
  const retained = retainNoFollowOrdinaryFile(
    parent,
    path.basename(executablePath),
    undefined,
    'disposed executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const retainedWorkingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(compilerRoot, 'disposed command cwd'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'disposed command cwd'
  );
  const boundary = issueRetainedCommandBoundary({
    executable: retained,
    workingDirectory: retainedWorkingDirectory
  });
  retained.dispose();
  try {
    await expect(runRetainedCommand(
      boundary,
      ['--version'],
      RETAINED_TEST_COMMAND_BUDGET
    )).rejects.toThrow('capability is disposed');
  } finally {
    retainedWorkingDirectory.dispose();
  }
  }
);
