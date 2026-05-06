import { expect, test } from 'bun:test';

import {
  expectCliJson,
  expectCliSuccess,
  expectCliVariants,
  runCliInProcess as runCli
} from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CLI exposes dependency environment maintenance entrypoints', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['deps', 'status'], {
      text: [
        'Runtime dependency status',
        'top-level entries',
        'Recommended action:'
      ],
      json: {
        mode: expect.any(String),
        manifestHash: expect.any(String),
        recommendedAction: expect.any(String),
        sharedNodeModules: expect.objectContaining({ kind: expect.any(String) })
      },
      compactJson: {
        mode: expect.any(String),
        recommendedAction: expect.any(String)
      }
    });

    await expectCliJson(workspaceRoot, ['deps', 'warmup', '--json'], {
      mode: expect.any(String),
      sharedNodeModules: expect.objectContaining({ exists: true }),
      recommendedAction: expect.any(String)
    });

    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');

    await expectCliJson(workspaceRoot, ['deps', 'relink', '--json'], {
      mode: expect.any(String),
      projectNodeModules: expect.objectContaining({ kind: expect.any(String) }),
      recommendedAction: expect.any(String)
    });

    await expectCliSuccess(workspaceRoot, ['deps', 'clean', '--project'], 'Cleaned 2 dependency paths\n');

    const invalidDepsStatusJson = await runCli(workspaceRoot, ['deps', 'status', '--compact']);
    expect(invalidDepsStatusJson.code).toBe(1);
    expect(invalidDepsStatusJson.stderr).toContain('platform deps status [--json [--compact]]');

    const invalidRelinkJson = await runCli(workspaceRoot, ['deps', 'relink', '--compact']);
    expect(invalidRelinkJson.code).toBe(1);
    expect(invalidRelinkJson.stderr).toContain('platform deps relink [--json [--compact]]');

    const invalidCleanAll = await runCli(workspaceRoot, ['deps', 'clean', '--all']);
    expect(invalidCleanAll.code).toBe(1);
    expect(invalidCleanAll.stderr).toContain('platform deps clean --all --force');

    const invalidForce = await runCli(workspaceRoot, ['deps', 'clean', '--force']);
    expect(invalidForce.code).toBe(1);
    expect(invalidForce.stderr).toContain('platform deps clean --all --force');
  });
});
