import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { upgradeWorkspace } from '../../src/change-management/upgrade/orchestration.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';
import { readYaml, writeYaml } from '../../src/workspace/yaml.ts';
import { expectFileUnchanged } from '../helpers/assertion-helpers.ts';
import { writeBlockUpgradeFixture } from '../helpers/block-upgrade-fixtures.ts';
import { createWorkspace } from '../testkit/workspace.ts';

type MigrationKindCounts = Record<string, number>;
type MigrationSummary = { id: string; kind: string; target: string };
type MigrationOperation = { id: string; target: string };

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
  }
}

test('upgrade dry-run rejects unsupported shorthand semver ranges', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-range-contract-');
  await writeBlockUpgradeFixture(workspaceRoot);

  const manifestPath = path.join(getWorkspacePaths(workspaceRoot).privateRegistryRoot, 'private.block-upgrade', 'versions', '0.2.0', 'block.manifest.yaml');
  const manifest = await readYaml<Record<string, unknown>>(manifestPath);
  await writeYaml(manifestPath, {
    ...manifest,
    upgrade: {
      ...(manifest.upgrade as Record<string, unknown>),
      from: ['0.1']
    }
  });

  await expect(upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true }))
    .rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-002' });
}, 180000);

test('upgrade dry-run records block-owned file migration impacts', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-block-file-plan-');

  await writeBlockUpgradeFixture(workspaceRoot);

  const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
  const beforePlan = await fs.readFile(workspaceConfigPath, 'utf8');

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'private/block-upgrade', '0.2.0', { dryRun: true });

  expect(upgradePlan.artifactKind).toBe('unbound-upgrade-preview');
  expect(upgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'version-range', evidence: ['0.1.x'] }),
      expect.objectContaining({ id: 'migration-entries', evidence: ['mig-customer-normalizer-file:migrations/customer-normalizer-file.json'] }),
      expect.objectContaining({ id: 'migration-file-operations', status: 'passed' }),
      expect.objectContaining({
        id: 'impact-scan',
        evidence: ['src/installed/private/block-upgrade.ts', 'src/installed/private/customer-normalizer.ts']
      }),
      expect.objectContaining({ id: 'override-conflicts', evidence: [] })
    ])
  );
  expect(upgradePlan.migrationOperations).toContainEqual(expect.objectContaining({
    id: 'mig-customer-normalizer-file',
    kind: 'file-replace',
    role: 'file',
    source: 'files/src/installed/private/customer-normalizer.ts',
    target: 'src/installed/private/customer-normalizer.ts'
  }));
  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expectMigrationArtifactsToMatchPlan(upgradePlan);
  await expectFileUnchanged(workspaceConfigPath, beforePlan);
  await expect(fs.readFile(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
}, 180000);
