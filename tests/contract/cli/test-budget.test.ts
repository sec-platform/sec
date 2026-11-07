import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';

import { canonicalGitChildEnvironment } from '../../../src/adapters/providers/git/environment.ts';
import { isSlowTestFile, type TestBudgetContract } from '../../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { expectCliJson } from '../../testkit/cli.ts';

function currentSlowTestFiles(): string[] {
  const repositoryRoot = path.resolve(import.meta.dir, '../../..');
  // Git supplies tracked plus nonignored untracked membership independently of
  // the production snapshot/inventory. Lane classification remains policy input.
  const listed = spawnSync('git', [
    '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'tests'
  ], {
    cwd: repositoryRoot,
    env: canonicalGitChildEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (listed.error) throw listed.error;
  expect(listed.status).toBe(0);
  expect(listed.stdout.endsWith('\0')).toBe(true);
  return listed.stdout.slice(0, -1).split('\0').filter((file) => {
    if (!isSlowTestFile(file) || /(?:^|\/)(?:fixtures?|snapshots?)(?:\/|$)/iu.test(file)) return false;
    // Cached entries can have been deleted from the working tree. Symlinks and
    // other nonordinary source entries must not silently become an empty match.
    const entry = lstatSync(path.join(repositoryRoot, file), { throwIfNoEntry: false });
    if (entry === undefined) return false;
    expect(entry.isFile()).toBe(true);
    return true;
  }).sort();
}

test('test-budget CLI preserves current repository membership and consistent suite ownership', async () => {
  // This in-process cwd is request data only; no selected reader opens it.
  const workspaceRoot = path.resolve('/cli-input-only');
  const contract = await expectCliJson<TestBudgetContract>(
    workspaceRoot,
    ['test', 'budget', '--json', '--compact'],
    {
      command: 'bun run sec -- test budget --json',
      runnerCommand: 'bun run test:budget',
      defaultLane: 'fast',
      laneCount: 3,
      slowLaneCount: 2,
      slowLaneIds: ['runtime', 'all']
    },
    { compact: true }
  );

  expect(contract.lanes.map(({ id }) => id)).toEqual(['fast', 'runtime', 'all']);
  expect(contract.fastTestHostRequirements).toEqual([
    { file: 'tests/unit/verification/verification-action-github-provider.test.ts', os: 'linux', arch: 'x64' }
  ]);

  // The compiler repository has slow suites; empty output is not a complete inventory.
  expect(contract.slowTestFiles.length).toBeGreaterThan(0);
  expect(contract.slowTestFiles).toEqual(currentSlowTestFiles());
  expect(contract.slowTestFiles).toEqual([...contract.slowTestFiles].sort());
  expect(new Set(contract.slowTestFiles).size).toBe(contract.slowTestFiles.length);
  expect(contract.slowTestFileCount).toBe(contract.slowTestFiles.length);
  expect(contract.slowSuiteCount).toBe(contract.slowSuites.length);
  expect(contract.slowSuites.flatMap(({ files }) => files).sort()).toEqual([
    ...contract.slowTestFiles
  ]);
  expect(contract.slowSuites.every(({ owner, logicalRunTimeoutMs, files }) =>
    owner.length > 0 && logicalRunTimeoutMs > 0 && files.length > 0)).toBe(true);
  // Cover the actual issued CLI budget rather than re-evaluating this
  // resource-class membership through an independent slow graph fixture.
  const runtimeHeavy = contract.slowSuites.filter(suite => suite.resourceClass === 'runtime-heavy');
  expect(runtimeHeavy.length).toBeGreaterThan(0);
  expect(runtimeHeavy.every(suite => suite.files.length > 0)).toBe(true);
  expect(runtimeHeavy.some(suite => suite.parallelSafe)).toBe(true);
  expect(runtimeHeavy.some(suite => !suite.parallelSafe)).toBe(true);
}, { timeout: 15_000 });
