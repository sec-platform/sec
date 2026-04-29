import { expect, test } from 'vitest';

import { expectCliJson, expectCliSuccess, expectCliText, runCliInProcess as runCli, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes dependency environment maintenance entrypoints', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['deps', 'status'], [
      'Runtime dependency status',
      'top-level entries',
      'Recommended action:'
    ]);

    await expectCliJson(workspaceRoot, ['deps', 'status', '--json'], {
      mode: expect.any(String),
      manifestHash: expect.any(String),
      recommendedAction: expect.any(String),
      sharedNodeModules: expect.objectContaining({ kind: expect.any(String) })
    });

    await expectCliJson(
      workspaceRoot,
      ['deps', 'status', '--json', '--compact'],
      {
        mode: expect.any(String),
        recommendedAction: expect.any(String)
      },
      { compact: true }
    );

    await expectCliJson(workspaceRoot, ['deps', 'warmup', '--json'], {
      mode: expect.any(String),
      sharedNodeModules: expect.objectContaining({ exists: true }),
      recommendedAction: expect.any(String)
    });

    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');

    await expectCliJson(workspaceRoot, ['deps', 'relink', 'project', '--json'], {
      mode: expect.any(String),
      projectNodeModules: expect.objectContaining({ kind: expect.any(String) }),
      recommendedAction: expect.any(String)
    });

    await expectCliSuccess(workspaceRoot, ['deps', 'clean', '--project'], 'Cleaned 2 dependency paths\n');

    const invalidRelink = await runCli(workspaceRoot, ['deps', 'relink']);
    expect(invalidRelink.code).toBe(1);
    expect(invalidRelink.stderr).toContain('platform deps relink project');

    const invalidDepsStatusJson = await runCli(workspaceRoot, ['deps', 'status', '--compact']);
    expect(invalidDepsStatusJson.code).toBe(1);
    expect(invalidDepsStatusJson.stderr).toContain('platform deps status [--json [--compact]]');

    const invalidRelinkJson = await runCli(workspaceRoot, ['deps', 'relink', 'project', '--compact']);
    expect(invalidRelinkJson.code).toBe(1);
    expect(invalidRelinkJson.stderr).toContain('platform deps relink project [--json [--compact]]');

    const invalidCleanAll = await runCli(workspaceRoot, ['deps', 'clean', '--all']);
    expect(invalidCleanAll.code).toBe(1);
    expect(invalidCleanAll.stderr).toContain('platform deps clean --all --force');

    const invalidForce = await runCli(workspaceRoot, ['deps', 'clean', '--force']);
    expect(invalidForce.code).toBe(1);
    expect(invalidForce.stderr).toContain('platform deps clean --all --force');
  });
});
