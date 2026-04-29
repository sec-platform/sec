import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../../platform/shared/benchmark-contract.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
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
import { compilerRoot, getWorkspacePaths } from '../../platform/shared/paths.ts';
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

test('CLI exposes reference drift check as text and JSON contracts', async () => {
  const report = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async (command, args) => {
      if (command === 'git') {
        expect(args).toEqual(['diff', '--name-only', '--exit-code', '--', 'source', 'project', 'control']);
        return { code: 1, stdout: `source/app.yaml\n${CI_ARTIFACT_FILES.reviewSummary}\n`, stderr: '' };
      }

      expect(args.slice(-2)).toEqual(['run', 'reference:refresh']);
      return { code: 0, stdout: '', stderr: '' };
    }
  });

  expect(formatReferenceCheck(report)).toContain('Reference workspace drifted');
  expect(formatReferenceCheck(report)).toContain('Failed stage: diff');
  expect(formatReferenceCheck(report)).toContain('Command: npm run platform -- reference check --json');
  expect(formatReferenceCheck(report)).toContain('Runner command: npm run reference:check');
  expect(formatReferenceCheck(report)).toContain(
    'Commands: refresh=npm run reference:refresh; diff=git diff --name-only --exit-code -- source project control'
  );
  expect(formatReferenceCheck(report)).toContain(
    `Changed paths: ${CI_ARTIFACT_FILES.reviewSummary}, source/app.yaml`
  );
  expect(JSON.stringify(report)).not.toContain('\n');
  expect(report).toMatchObject({
    formatVersion: '1',
    status: 'drifted',
    failedStage: 'diff',
    root: compilerRoot,
    command: 'npm run platform -- reference check --json',
    runnerCommand: 'npm run reference:check',
    refreshCommand: 'npm run reference:refresh',
    refreshExitCode: 0,
    diffCommand: 'git diff --name-only --exit-code -- source project control',
    diffExitCode: 1,
    changedPathCount: 2,
    changedPaths: [CI_ARTIFACT_FILES.reviewSummary, 'source/app.yaml'],
    recommendedAction: 'inspect-workspace-drift-and-refresh-reference'
  });
  expect(() => assertReferenceCheckClean(report)).toThrow('reference workspace drift detected');

  const refreshFailedReport = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async () => ({ code: 2, stdout: '', stderr: 'refresh failed' })
  });
  expect(refreshFailedReport).toMatchObject({
    status: 'refresh-failed',
    failedStage: 'refresh',
    refreshExitCode: 2,
    diffExitCode: -1,
    changedPathCount: 0,
    recommendedAction: 'fix-reference-refresh-before-reference-check'
  });
  expect(() => assertReferenceCheckClean(refreshFailedReport)).toThrow('reference refresh failed');

  const diffFailedReport = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async (command) =>
      command === 'git'
        ? { code: 128, stdout: '', stderr: 'diff failed' }
        : { code: 0, stdout: '', stderr: '' }
  });
  expect(diffFailedReport).toMatchObject({
    status: 'diff-failed',
    failedStage: 'diff',
    refreshExitCode: 0,
    diffExitCode: 128,
    changedPathCount: 0,
    recommendedAction: 'inspect-git-diff-command'
  });
  expect(() => assertReferenceCheckClean(diffFailedReport)).toThrow('reference diff command failed');
});
