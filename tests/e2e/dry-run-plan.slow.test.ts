import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { upgradeWorkspace } from '../../platform/orchestrator.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';
import { expectFileUnchanged } from '../helpers/assertion-helpers.ts';
import { writeSlotUpgradeFixture } from '../helpers/slot-upgrade-fixtures.ts';
import { createWorkspace, prepareLockedWorkspace } from '../helpers/workspace-fixtures.ts';

type MigrationKindCounts = Record<string, number>;
type MigrationSummary = { id: string; kind: string; target: string; slotId?: string };
type MigrationOperation = { id: string; kind: string; target: string; slotId?: string };

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
  expect(countByKind(plan.migrationOperations)).toEqual(plan.migrationKindCounts);

  const summariesById = new Map(plan.migrationSummaries.map((summary) => [summary.id, summary]));
  expect([...summariesById.keys()].sort()).toEqual(plan.migrationOperations.map((operation) => operation.id).sort());
  for (const operation of plan.migrationOperations) {
    const summary = summariesById.get(operation.id);
    expect(summary).toBeDefined();
    expect(operation.kind).toBe(summary?.kind);
    expect(operation.target).toBe(summary?.target);
    if (summary?.slotId !== undefined || operation.slotId !== undefined) {
      expect(operation.slotId).toBe(summary?.slotId);
    }
  }
}

test('upgrade dry-run writes a planned upgrade without changing project files', async () => {
  const workspaceRoot = await prepareLockedWorkspace({ prefix: 'engineering-compiler-upgrade-dry-run-' });

  const { lockPath, planPath, provenancePath } = getWorkspacePaths(workspaceRoot);
  const sessionPath = path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts');
  const beforePlan = await fs.readFile(planPath, 'utf8');
  const beforeSession = await fs.readFile(sessionPath, 'utf8');

  const { upgradePlan } = await upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1', { dryRun: true });

  expect(upgradePlan.status).toBe('planned');
  expect(upgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1,
    'json-array-append': 1
  });
  expect(upgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'version-range', status: 'passed' }),
      expect.objectContaining({ id: 'migration-entries', status: 'passed' }),
      expect.objectContaining({
        id: 'migration-targets',
        status: 'passed',
        evidence: [
          'mig-auth-session-refresh:target:src/installed/auth/session.ts:exists',
          'mig-auth-session-upgrade-metadata:target:upgrade.metadata.json:missing'
        ]
      }),
      expect.objectContaining({
        id: 'migration-file-operations',
        status: 'passed',
        evidence: ['mig-auth-session-refresh:manifest-source:exists']
      }),
      expect.objectContaining({
        id: 'migration-json-shapes',
        status: 'passed',
        evidence: ['mig-auth-session-upgrade-metadata:path:upgradedBlocks:array:1']
      }),
      expect.objectContaining({
        id: 'migration-json-structure',
        status: 'passed',
        evidence: ['mig-auth-session-upgrade-metadata:target:missing']
      }),
      expect.objectContaining({ id: 'impact-scan', status: 'passed' }),
      expect.objectContaining({ id: 'override-conflicts', status: 'passed' })
    ])
  );
  expectMigrationArtifactsToMatchPlan(upgradePlan);
  await expectFileUnchanged(planPath, beforePlan);
  await expectFileUnchanged(sessionPath, beforeSession);

  const lock = await readJson<{ generatedPaths: string[] }>(lockPath);
  expect(lock.generatedPaths).toContain(CI_ARTIFACT_FILES.upgradePlan);
  const provenance = await readJson<{
    artifacts: Array<{ path: string; generatedByPass?: string }>;
  }>(provenancePath);
  expect(provenance.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: CI_ARTIFACT_FILES.upgradePlan, generatedByPass: 'upgrade' })
    ])
  );
}, 120000);

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
          'mig-customer-normalizer-contract:writableZones:custom/customer_normalizer.ts'
        ]
      }),
      expect.objectContaining({ id: 'impact-scan', evidence: ['custom/customer_normalizer.ts', 'src/installed/private/slot-contract.ts'] }),
      expect.objectContaining({ id: 'override-conflicts', evidence: [] })
    ])
  );
  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expectMigrationArtifactsToMatchPlan(upgradePlan);
  await expectFileUnchanged(planPath, beforePlan);
  await expect(fs.readFile(upgradePlanPath, 'utf8')).resolves.toContain('mig-customer-normalizer-contract');
}, 180000);
