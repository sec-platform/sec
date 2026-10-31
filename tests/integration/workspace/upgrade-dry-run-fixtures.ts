import { expect } from 'bun:test';
import fs from 'node:fs/promises';

import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import type { UpgradePreview } from '../../../src/semantics/upgrade/upgrade-artifact.ts';
import { expectFileUnchanged } from '../../helpers/assertion-helpers.ts';
import { withBlockUpgradeDryRunFixture } from '../../helpers/block-upgrade-fixtures.ts';

typtype BlockUpgradeDryRunOptions = Parameters<typeof withBlockUpgradeDryRunFixture>[0];

export async function runPlannedBlockUpgradeDryRun(options: BlockUpgradeDryRunOptions): Promise<UpgradePreview> {
  // A preview is detached from the physical fixture. Retire its workspace
  // before returning, and reject accidental durable diagnostics publication.
  return withBlockUpgradeDryRunFixture(options, async ({ beforePlan, paths, workspaceRoot }) => {
    const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true });

    expect(upgradePlan.artifactKind).toBe('unbound-upgrade-preview');
    await expectFileUnchanged(paths.workspaceConfigPath, beforePlan);
    return upgradePlan;
  });
}

e UpgradeFailureOptions = {
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
