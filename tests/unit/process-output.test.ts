import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import { runCommand, runCommandBytes } from '../../platform/shared/process.ts';

test('runCommandBytes preserves a UTF-8 code point split across child stdout writes', async () => {
  const script = [
    "const chunks = [Buffer.from('docs/'), Buffer.from([0xe4]), Buffer.from([0xb8]), Buffer.from([0xad]), Buffer.from('.md\\0')];",
    'let index = 0;',
    'const writeNext = () => {',
    '  process.stdout.write(chunks[index++]);',
    '  if (index < chunks.length) setTimeout(writeNext, 20);',
    '};',
    'writeNext();'
  ].join('\n');

  const result = await runCommandBytes(process.execPath, ['--no-env-file', '--eval', script], {
    cwd: compilerRoot,
    timeoutMs: 5_000
  });

  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toEqual(new TextEncoder().encode('docs/中.md\0'));
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
