import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { assertReferenceCheckClean, buildReferenceCheckReport, formatReferenceCheck } from '../../src/reference/application/check.ts';
import { parseReferenceGitPathRecords } from '../../src/reference/runtime/drift-scan.ts';
import { runCommand } from '../../src/runtime-state/physical/runtime/process.ts';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function withReferenceGitFixture<T>(
  callback: (root: string, referenceRoot: string) => Promise<T>
): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-reference-drift-'));
  const referenceRoot = path.join(root, 'examples', 'reference-workspace');
  try {
    expect((await runCommand('git', ['init', '--quiet'], { cwd: root })).code).toBe(0);
    await fs.mkdir(referenceRoot, { recursive: true });
    await fs.writeFile(path.join(referenceRoot, 'sec.yaml'), 'name: baseline\n', 'utf8');
    expect((await runCommand('git', ['add', '--', 'examples/reference-workspace/sec.yaml'], { cwd: root })).code).toBe(0);
    return await callback(root, referenceRoot);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('reference check blocks tracked and untracked workspace drift', async () => {
  await withReferenceGitFixture(async (root, referenceRoot) => {
    await fs.writeFile(path.join(referenceRoot, 'sec.yaml'), 'name: changed\n', 'utf8');
    await fs.mkdir(path.join(referenceRoot, 'model'), { recursive: true });
    await fs.writeFile(path.join(referenceRoot, 'model', 'new-policy.yaml'), 'policy: new\n', 'utf8');
    const report = await buildReferenceCheckReport({
      root,
      commandRunner: async () => ({ code: 0, stdout: '', stderr: '' })
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
});

test('reference check never reports clean when refresh or Git observation fails', async () => {
  const refreshFailed = await buildReferenceCheckReport({
    // A nonexistent root proves the Git provider is not admitted after the
    // refresh failure without exposing a second injected Git transport.
    root: path.join(os.tmpdir(), 'sec-reference-root-must-not-be-read'),
    commandRunner: async () => ({ code: 2, stdout: '', stderr: 'refresh failed' })
  });
  expect(() => assertReferenceCheckClean(refreshFailed)).toThrow('reference refresh failed');

  const nonRepositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-reference-nonrepo-'));
  try {
    const gitFailed = await buildReferenceCheckReport({
      root: nonRepositoryRoot,
      commandRunner: async () => ({ code: 0, stdout: '', stderr: '' })
    });
    expect(() => assertReferenceCheckClean(gitFailed)).toThrow('reference diff command failed');
  } finally {
    await fs.rm(nonRepositoryRoot, { recursive: true, force: true });
  }
});

test('reference drift preserves NUL-delimited path identity and rejects invalid UTF-8', async () => {
  const changedPath = 'examples/reference-workspace/src/line\nbreak.ts';
  expect(parseReferenceGitPathRecords(bytes(`${changedPath}\0`), 'git diff')).toEqual([changedPath]);

  expect(() => parseReferenceGitPathRecords(
    new Uint8Array([0xff, 0]),
    'git diff'
  )).toThrow('non-UTF-8 path record');
});
