import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../../platform/shared/benchmark-contract.ts';
import {
  buildCiContract,
  formatCiContract
} from '../../platform/shared/ci-contract.ts';
import {
  buildContractFreezeContract,
  formatContractFreezeContract
} from '../../platform/shared/contract-freeze-contract.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../../platform/shared/error-protocol-contract.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../../platform/shared/test-budget-contract.ts';
import {
  ACCEPTANCE_USAGE,
  LOCK_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  REPAIR_USAGE,
  RUNTIME_USAGE,
  USAGE
} from '../../platform/cli/usage.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../../platform/shared/reference-check.ts';
import type {
  ExplainGraph,
  RepairPlan,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../../platform/shared/types.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { withTempWorkspace, runCliInProcess as runCli, usageErrorStderr, expectRepairUsageError, expectLockUsageError, expectPolicyUsageError, expectAcceptanceUsageError, expectPostgresUsageError, installPrivateBannerBlock } from '../helpers/test-utils.ts';

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

    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });

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
