import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { upgradeWorkspace } from '../../src/change-management/upgrade/orchestration.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { readYaml, writeYaml } from '../../src/workspace/yaml.ts';
import { expectFileUnchanged } from '../helpers/assertion-helpers.ts';
import { writeSlotUpgradeFixture } from '../helpers/slot-upgrade-fixtures.ts';
import { createWorkspace, prepareAdaptedWorkspace } from '../testkit/workspace.ts';

type MigrationKindCounts = Record<string, number>;
type MigrationSummary = { id: string; kind: string; target: string; slotId?: string };
type MigrationOperation = { id: string; target: string; slotId?: string };

type UpgradeMigrationArtifacts = {
  migrationKindCounts: MigrationKindCounts;
  migrationSummaries: MigrationSummary[];
  migrationOperations: MigrationOperation[];
};

function countByKind(items: Array<{ kind: string }>): MigrationKindCounts {
  return items.reduce<MigrationKindCounts>((counts, item) => {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    return counts;
  }, {});
}

function totalMigrationKinds(counts: MigrationKindCounts): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function expectMigrationArtifactsToMatchPlan(plan: UpgradeMigrationArtifacts): void {
  const expectedCount = totalMigrationKinds(plan.migrationKindCounts);
  expect(plan.migrationSummaries).toHaveLength(expectedCount);
  expect(plan.migrationOperations).toHaveLength(expectedCount);
  expect(countByKind(plan.migrationSummaries)).toEqual(plan.migrationKindCounts);

  const summariesById = new Map(plan.migrationSummaries.map((summary) => [summary.id, summary]));
  expect([...summariesById.keys()].sort()).toEqual(plan.migrationOperations.map((operation) => operation.id).sort());
  for (const operation of plan.migrationOperations) {
    const summary = summariesById.get(operation.id);
    if (!summary) {
      throw new Error(`Missing migration summary for ${operation.id}`);
    }
    expect(operation.target).toBe(summary.target);
    if (summary.slotId !== undefined || operation.slotId !== undefined) {
      expect(operation.slotId).toBe(summary.slotId);
    }
  }
}

test('upgrade dry-run rejects unsupported shorthand semver ranges', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-range-contract-');
  await writeSlotUpgradeFixture(workspaceRoot);

  const manifestPath = path.join(getWorkspacePaths(workspaceRoot).privateRegistryRoot, 'private.slot-contract', 'versions', '0.2.0', 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      ...(manifest.upgrade as Record<string, unknown>),
      from: ['0.1']
    }
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true }))
    .rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-002' });
}, 180000);

test('upgrade dry-run records slot contract migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-slot-contract-plan-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  const beforePlan = await fs.readFile(planPath, 'utf8');

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.migrationKindCounts).toEqual({
    'slot-contract-update': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'version-range', evidence: ['0.1.x'] }),
      expect.objectContaining({ id: 'migration-entries', evidence: ['mig-customer-normalizer-contract:migrations/customer-normalizer-contract.json'] }),
      expect.objectContaining({
        id: 'migration-slot-contracts',
        evidence: [
          'mig-customer-normalizer-contract:inputType:CustomerInputV2',
          'mig-customer-normalizer-contract:outputType:CustomerRecordInput',
          'mig-customer-normalizer-contract:slot:customer_normalizer',
          'mig-customer-normalizer-contract:target:custom/customer_normalizer.ts',
          'mig-customer-normalizer-contract:writableZones:custom/'
        ]
      }),
      expect.objectContaining({ id: 'impact-scan', evidence: ['custom/customer_normalizer.ts', 'src/installed/private/slot-contract.ts'] }),
      expect.objectContaining({ id: 'override-conflicts', evidence: [] })
    ])
  );
  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expectMigrationArtifactsToMatchPlan(upgradePlan);
  await expectFileUnchanged(planPath, beforePlan);
  await expect(fs.readFile(upgradePlanPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
}, 180000);
