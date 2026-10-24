import { expect } from 'bun:test';
import fs from 'node:fs/promises';

import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import type { UpgradePreview } from '../../../src/semantics/upgrade/upgrade-artifact.ts';
import { expectFileUnchanged } from '../../helpers/assertion-helpers.ts';
import { prepareBlockUpgradeDryRunFixture } from '../../helpers/block-upgrade-fixtures.ts';

type BlockUpgradeDryRunOptions = Parameters<typeof prepareBlockUpgradeDryRunFixture>[0];

export async function runPlannedBlockUpgradeDryRun(options: BlockUpgradeDryRunOptions): Promise<UpgradePreview> {
  const { beforePlan, paths, workspaceRoot } = await prepareBlockUpgradeDryRunFixture(options);
  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true });

  expect(upgradePlan.artifactKind).toBe('unbound-upgrade-preview');
  await expectFileUnchanged(paths.workspaceConfigPath, beforePlan);
  return upgradePlan;
}

type UpgradeFailureOptions = {
  blockId?: string;
  targetVersion?: string;
};

export async function expectUpgradeDryRunFailure(
  workspaceRoot: string,
  expectedError: object,
  options: UpgradeFailureOptions = {}
): Promise<void> {
  await expect(
    upgradeWorkspace(workspaceRoot, options.blockId ?? 'private/block-upgrade', options.targetVersion ?? '0.2.0', {
      dryRun: true
    })
  ).rejects.toMatchObject(expectedError);
}

/** A preview reports its error without publishing durable diagnostics. */
export async function expectUpgradeDryRunFailureWithoutDiagnostics(
  workspaceRoot: string,
  upgradeDiagnosticsPath: string,
  expectedError: object,
  options: UpgradeFailureOptions = {}
): Promise<void> {
  await expectUpgradeDryRunFailure(workspaceRoot, expectedError, options);
  await expect(fs.lstat(upgradeDiagnosticsPath)).rejects.toMatchObject({ code: 'ENOENT' });
}
