import { expect } from 'bun:test';

import type { UpgradePlan } from '../../src/change-management/upgrade/contract/types.ts';
import { upgradeWorkspace } from '../../src/change-management/upgrade/orchestration.ts';
import { expectFileUnchanged } from '../helpers/assertion-helpers.ts';
import { prepareSlotUpgradeDryRunFixture } from '../helpers/slot-upgrade-fixtures.ts';

type SlotUpgradeDryRunOptions = Parameters<typeof prepareSlotUpgradeDryRunFixture>[0];

export async function runPlannedSlotUpgradeDryRun(options: SlotUpgradeDryRunOptions): Promise<UpgradePlan> {
  const { beforePlan, paths, workspaceRoot } = await prepareSlotUpgradeDryRunFixture(options);
  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  await expectFileUnchanged(paths.planPath, beforePlan);
  return upgradePlan;
}
