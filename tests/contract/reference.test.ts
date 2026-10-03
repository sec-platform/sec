import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCommand } from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import {
  buildReferenceDriftCommands,
  parseReferenceGitPathRecords,
  scanReferenceDrift
} from '../../src/adapters/workspace/reference-drift.ts';
import {
  assertReferenceCheckClean,
  executeReferenceCheck,
  projectReferenceCheckReport,
  type ReferenceCheckOperations
} from '../../src/application/reference-check.ts';
import { formatReferenceCheck } from '../../src/entry/reference-check.ts';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

const referenceDriftCommands = buildReferenceDriftCommands([
  'examples/reference-workspace'
]);

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
    const drift = await scanReferenceDrift(root, referenceDriftCommands);
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
    const drift = await scanReferenceDrift(nonRepositoryRoot, referenceDriftCommands);
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

const referenceCheckContext = {
  root: '/reference',
  runnerCommand: 'bun run reference:check',
  refreshCommand: 'bun run reference:refresh',
  diffCommand: 'git diff',
  untrackedScanCommand: 'git ls-files'
};

const cleanDrift = {
  exitCode: 0,
  trackedExitCode: 0,
  untrackedExitCode: 0,
  changedPaths: [] as string[]
};

test('reference use case awaits refresh and retains captured operation receivers', async () => {
  const events: string[] = [];
  let finishRefresh!: (code: number) => void;
  const refreshing = new Promise<number>(resolve => { finishRefresh = resolve; });
  const operations: ReferenceCheckOperations = {
    async refresh() {
      expect(this).toBe(operations);
      events.push('refresh');
      return refreshing;
    },
    async scanDrift() {
      expect(this).toBe(operations);
      events.push('scan');
      return cleanDrift;
    }
  };
  const checking = executeReferenceCheck(referenceCheckContext, operations);
  await Promise.resolve();
  expect(events).toEqual(['refresh']);
  operations.scanDrift = async () => { throw new Error('replacement must not run'); };
  finishRefresh(0);
  const report = await checking;
  expect(events).toEqual(['refresh', 'scan']);
  expect(report.status).toBe('clean');
  expect(report.failedStage).toBe('none');
  expect(report.root).toBe('/reference');
});

test('reference use case suppresses drift observation after nonzero refresh', async () => {
  const events: string[] = [];
  const report = await executeReferenceCheck(referenceCheckContext, {
    refresh: async () => { events.push('refresh'); return 2; },
    scanDrift: async () => { events.push('scan'); return cleanDrift; }
  });
  expect(events).toEqual(['refresh']);
  expect(report).toMatchObject({
    status: 'refresh-failed', failedStage: 'refresh', refreshExitCode: 2,
    diffExitCode: -1, trackedDiffExitCode: -1, untrackedScanExitCode: -1,
    changedPathCount: 0, changedPaths: [],
    recommendedAction: 'fix-reference-refresh-before-reference-check'
  });
});

test('reference use case preserves drift and failed observation results', async () => {
  for (const [exitCode, status] of [[1, 'drifted'], [128, 'diff-failed']] as const) {
    const paths = ['examples/reference-workspace/model/new.yaml'];
    const report = await executeReferenceCheck(referenceCheckContext, {
      refresh: async () => 0,
      scanDrift: async () => ({
        exitCode, trackedExitCode: 1, untrackedExitCode: exitCode === 1 ? 0 : 128,
        changedPaths: paths
      })
    });
    expect(report.status).toBe(status);
    expect(report.failedStage).toBe('diff');
    expect(report.diffExitCode).toBe(exitCode);
    expect(report.trackedDiffExitCode).toBe(1);
    expect(report.untrackedScanExitCode).toBe(exitCode === 1 ? 0 : 128);
    expect(report.changedPathCount).toBe(1);
    expect(report.changedPaths).toEqual(paths);
    expect(report.changedPaths).not.toBe(paths);
  }
});

test('reference use case propagates operation rejection without retry or later work', async () => {
  for (const phase of ['refresh', 'scan'] as const) {
    const failure = new Error(`${phase} failed`);
    const events: string[] = [];
    const checking = executeReferenceCheck(referenceCheckContext, {
      refresh: async () => {
        events.push('refresh');
        if (phase === 'refresh') throw failure;
        return 0;
      },
      scanDrift: async () => { events.push('scan'); throw failure; }
    });
    await expect(checking).rejects.toBe(failure);
    expect(events).toEqual(phase === 'refresh' ? ['refresh'] : ['refresh', 'scan']);
  }
});

test('reference use case validates both operations before starting refresh', async () => {
  for (const invalid of ['refresh', 'scanDrift'] as const) {
    let started = false;
    const operations = {
      refresh: async () => { started = true; return 0; },
      scanDrift: async () => cleanDrift,
      [invalid]: null
    } as unknown as ReferenceCheckOperations;
    await expect(executeReferenceCheck(referenceCheckContext, operations))
      .rejects.toThrow('Reference check operations must be callable');
    expect(started).toBe(false);
  }
});
