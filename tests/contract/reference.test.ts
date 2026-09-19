import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  assertReferenceCheckClean,
  projectReferenceCheckReport
} from '../../src/application/reference-check.ts';
import { formatReferenceCheck } from '../../src/entry/reference-check.ts';
import {
  parseReferenceGitPathRecords,
  scanReferenceDrift
} from '../../src/bootstrap/reference/runtime/drift-scan.ts';
import { runCommand } from '../../src/adapters/runtime-state/physical/runtime/process.ts';

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
    const drift = await scanReferenceDrift(root);
    const report = projectReferenceCheckReport({
      root,
      runnerCommand: 'bun run reference:check',
      refreshCommand: 'bun run reference:refresh',
      diffCommand: 'git diff --name-only --exit-code -z -- examples/reference-workspace',
      untrackedScanCommand: 'git ls-files -z --others --exclude-standard -- examples/reference-workspace',
      refreshExitCode: 0,
      drift
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
  const refreshFailed = projectReferenceCheckReport({
    root: path.join(os.tmpdir(), 'sec-reference-root-must-not-be-read'),
    runnerCommand: 'bun run reference:check',
    refreshCommand: 'bun run reference:refresh',
    diffCommand: 'git diff --name-only --exit-code -z -- examples/reference-workspace',
    untrackedScanCommand: 'git ls-files -z --others --exclude-standard -- examples/reference-workspace',
    refreshExitCode: 2,
    drift: {
      exitCode: -1,
      trackedExitCode: -1,
      untrackedExitCode: -1,
      changedPaths: []
    }
  });
  expect(() => assertReferenceCheckClean(refreshFailed)).toThrow('reference refresh failed');

  const nonRepositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-reference-nonrepo-'));
  try {
    const drift = await scanReferenceDrift(nonRepositoryRoot);
    const gitFailed = projectReferenceCheckReport({
      root: nonRepositoryRoot,
      runnerCommand: 'bun run reference:check',
      refreshCommand: 'bun run reference:refresh',
      diffCommand: 'git diff --name-only --exit-code -z -- examples/reference-workspace',
      untrackedScanCommand: 'git ls-files -z --others --exclude-standard -- examples/reference-workspace',
      refreshExitCode: 0,
      drift
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
