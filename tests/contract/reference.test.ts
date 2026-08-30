import { expect, test } from 'bun:test';

import { assertReferenceCheckClean, buildReferenceCheckReport, formatReferenceCheck } from '../../src/reference/application/check.ts';
import { scanReferenceDrift } from '../../src/reference/runtime/drift-scan.ts';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

test('reference check blocks tracked and untracked workspace drift', async () => {
  const report = await buildReferenceCheckReport({
    root: '/repo',
    commandRunner: async () => ({ code: 0, stdout: '', stderr: '' }),
    gitCommandRunner: async (_command, args) => args[0] === 'diff'
      ? { code: 1, stdout: bytes('examples/reference-workspace/sec.yaml\0'), stderr: '' }
      : { code: 0, stdout: bytes('examples/reference-workspace/model/new-policy.yaml\0'), stderr: '' }
  });

  expect(report.status).toBe('drifted');
  expect(report.changedPaths).toEqual([
    'examples/reference-workspace/model/new-policy.yaml',
    'examples/reference-workspace/sec.yaml'
  ]);
  const formatted = formatReferenceCheck(report, 'sec reference check');
  expect(formatted).toContain('Reference workspace drifted');
  expect(formatted).toContain('Command: sec reference check');
  expect(() => assertReferenceCheckClean(report)).toThrow('reference workspace drift detected');
});

test('reference check never reports clean when refresh or Git observation fails', async () => {
  let gitCalled = false;
  const refreshFailed = await buildReferenceCheckReport({
    root: '/repo',
    commandRunner: async () => ({ code: 2, stdout: '', stderr: 'refresh failed' }),
    gitCommandRunner: async () => {
      gitCalled = true;
      throw new Error('Git must not run after refresh failure');
    }
  });
  expect(gitCalled).toBeFalse();
  expect(() => assertReferenceCheckClean(refreshFailed)).toThrow('reference refresh failed');

  const gitFailed = await buildReferenceCheckReport({
    root: '/repo',
    commandRunner: async () => ({ code: 0, stdout: '', stderr: '' }),
    gitCommandRunner: async () => ({ code: 128, stdout: new Uint8Array(), stderr: 'failed' })
  });
  expect(() => assertReferenceCheckClean(gitFailed)).toThrow('reference diff command failed');
});

test('reference drift preserves NUL-delimited path identity and rejects invalid UTF-8', async () => {
  const changedPath = 'examples/reference-workspace/src/line\nbreak.ts';
  const scan = await scanReferenceDrift('/unused', async (_command, args) => args[0] === 'diff'
    ? { code: 1, stdout: bytes(`${changedPath}\0`), stderr: '' }
    : { code: 0, stdout: new Uint8Array(), stderr: '' });
  expect(scan.changedPaths).toEqual([changedPath]);

  await expect(scanReferenceDrift('/unused', async () => ({
    code: 1,
    stdout: new Uint8Array([0xff, 0]),
    stderr: ''
  }))).rejects.toThrow('non-UTF-8 path record');
});
