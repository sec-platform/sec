import { expect, test } from 'bun:test';

import type { TestBudgetContract } from '../../src/verification/test-impact/contract/budget.ts';
import { expectCliJson } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('test-budget CLI emits one internally complete executable inventory', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
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
    expect(contract.slowTestFiles).toEqual([...contract.slowTestFiles].sort());
    expect(new Set(contract.slowTestFiles).size).toBe(contract.slowTestFiles.length);
    expect(contract.slowTestFileCount).toBe(contract.slowTestFiles.length);
    expect(contract.slowSuiteCount).toBe(contract.slowSuites.length);
    expect(contract.slowSuites.flatMap(({ files }) => files).sort()).toEqual([
      ...contract.slowTestFiles
    ]);
    expect(contract.slowSuites.every(({ owner, logicalRunTimeoutMs, files }) =>
      owner.length > 0 && logicalRunTimeoutMs > 0 && files.length > 0)).toBe(true);
  });
}, { timeout: 15_000 });
