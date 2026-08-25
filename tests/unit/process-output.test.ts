import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import { runCommand, runCommandBytes, runCommandSync } from '../../platform/shared/process.ts';

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

test('runCommandSync is the bounded byte transport and supports a replacement environment', () => {
  const result = runCommandSync(process.execPath, [
    '--no-env-file',
    '--eval',
    "process.stdout.write(process.env.SEC_SYNC_PROBE ?? 'missing')"
  ], {
    cwd: compilerRoot,
    env: { SEC_SYNC_PROBE: 'sync-output' },
    envMode: 'replace',
    maxBuffer: 1024
  });

  expect(result.status).toBe(0);
  expect(result.code).toBe(0);
  expect(result.error).toBeUndefined();
  expect(new TextDecoder().decode(result.stdout)).toBe('sync-output');
  expect(result.stderr).toEqual(new Uint8Array());
});

test('runCommand can observe bounded output without retaining a second copy', async () => {
  const observed: string[] = [];
  const result = await runCommand(process.execPath, [
    '--no-env-file',
    '--eval',
    "process.stdout.write('streamed')"
  ], {
    cwd: compilerRoot,
    maxStdoutBytes: 1024,
    retainOutput: false,
    onOutput: (chunk, stream) => observed.push(`${stream}:${chunk.toString('utf8')}`),
    timeoutMs: 5_000
  });

  expect(result).toEqual({ code: 0, stdout: '', stderr: '' });
  expect(observed).toEqual(['stdout:streamed']);
});
