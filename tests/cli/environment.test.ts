import { expect, test } from 'vitest';

import { expectCliSuccess, runCliInProcess as runCli, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes dependency environment maintenance entrypoints', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const depsStatus = await runCli(workspaceRoot, ['deps', 'status']);
    expect(depsStatus.code).toBe(0);
    expect(depsStatus.stderr).toBe('');
    expect(depsStatus.stdout).toContain('Runtime dependency status');
    expect(depsStatus.stdout).toContain('top-level entries');
    expect(depsStatus.stdout).toContain('Recommended action:');

    const depsStatusJson = await runCli(workspaceRoot, ['deps', 'status', '--json']);
    expect(depsStatusJson.code).toBe(0);
    expect(depsStatusJson.stderr).toBe('');
    expect(JSON.parse(depsStatusJson.stdout)).toMatchObject({
      mode: expect.any(String),
      manifestHash: expect.any(String),
      recommendedAction: expect.any(String),
      sharedNodeModules: expect.objectContaining({ kind: expect.any(String) })
    });

    const depsStatusCompact = await runCli(workspaceRoot, ['deps', 'status', '--json', '--compact']);
    expect(depsStatusCompact.code).toBe(0);
    expect(depsStatusCompact.stderr).toBe('');
    expect(depsStatusCompact.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(depsStatusCompact.stdout)).toMatchObject({
      mode: expect.any(String),
      recommendedAction: expect.any(String)
    });

    const depsWarmupJson = await runCli(workspaceRoot, ['deps', 'warmup', '--json']);
    expect(depsWarmupJson.code).toBe(0);
    expect(depsWarmupJson.stderr).toBe('');
    expect(JSON.parse(depsWarmupJson.stdout)).toMatchObject({
      mode: expect.any(String),
      sharedNodeModules: expect.objectContaining({ exists: true }),
      recommendedAction: expect.any(String)
    });

    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');

    const depsRelinkJson = await runCli(workspaceRoot, ['deps', 'relink', 'project', '--json']);
    expect(depsRelinkJson.code).toBe(0);
    expect(depsRelinkJson.stderr).toBe('');
    expect(JSON.parse(depsRelinkJson.stdout)).toMatchObject({
      mode: expect.any(String),
      projectNodeModules: expect.objectContaining({ kind: expect.any(String) }),
      recommendedAction: expect.any(String)
    });

    const cleanProject = await runCli(workspaceRoot, ['deps', 'clean', '--project']);
    expect(cleanProject.code).toBe(0);
    expect(cleanProject.stderr).toBe('');
    expect(cleanProject.stdout).toBe('Cleaned 2 dependency paths\n');

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
