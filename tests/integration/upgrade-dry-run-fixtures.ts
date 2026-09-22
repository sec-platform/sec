import { expect } from 'bun:test';

import type { UpgradePreview } from '../../src/semantics/upgrade/upgrade-artifact.ts';
import { upgradeWorkspace } from '../../src/bootstrap/upgrade/orchestration.ts';
import { expectFileUnchanged } from '../helpers/assertion-helpers.ts';
import { prepareBlockUpgradeDryRunFixture } from '../helpers/block-upgrade-fixtures.ts';

type BlockUpgradeDryRunOptions = Parameters<typeof prepareBlockUpgradeDryRunFixture>[0];

export async function runPlannedBlockUpgradeDryRun(options: BlockUpgradeDryRunOptions): Promise<UpgradePreview> {
  const { beforePlan, paths, workspaceRoot } = await prepareBlockUpgradeDryRunFixture(options);
  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true });

  expect(upgradePlan.artifactKind).toBe('unbound-upgrade-preview');
  await expectFileUnchanged(paths.workspaceConfigPath, beforePlan);
  return upgradePlan;
}
