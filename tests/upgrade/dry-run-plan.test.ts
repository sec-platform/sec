import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { createWorkspace, writeSlotUpgradeFixture } from '../helpers/test-utils.ts';

test('upgrade dry-run writes a planned upgrade without changing project files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-dry-run-');

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

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
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-auth-session-refresh',
      kind: 'file-replace',
      target: 'src/installed/auth/session.ts',
      reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.',
      requiresVerification: true,
      source: 'files/src/installed/auth/session.ts'
    },
    {
      id: 'mig-auth-session-upgrade-metadata',
      kind: 'json-array-append',
      target: 'upgrade.metadata.json',
      reason: 'Record auth session upgrade metadata in package configuration.',
      requiresVerification: false
    }
  ]);
  expect(upgradePlan.migrationOperations).toEqual([
    {
      id: 'mig-auth-session-refresh',
      kind: 'file-replace',
      target: 'src/installed/auth/session.ts',
      role: 'file',
      source: 'files/src/installed/auth/session.ts'
    },
    {
      id: 'mig-auth-session-upgrade-metadata',
      kind: 'json-array-append',
      target: 'upgrade.metadata.json',
      role: 'json',
      path: ['upgradedBlocks'],
      itemCount: 1
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
  await expect(fs.readFile(sessionPath, 'utf8')).resolves.toBe(beforeSession);

  const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { generatedPaths: string[] };
  expect(lock.generatedPaths).toContain(CI_ARTIFACT_FILES.upgradePlan);
  const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
    artifacts: Array<{ path: string; generatedByPass?: string }>;
  };
  expect(provenance.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: CI_ARTIFACT_FILES.upgradePlan, generatedByPass: 'upgrade' })
    ])
  );
}, 120000);

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
  expect(upgradePlan.impacts).toEqual(['custom/customer_normalizer.ts', 'src/installed/private/slot-contract.ts']);
  expect(upgradePlan.migrationSummaries).toEqual([
    {
      id: 'mig-customer-normalizer-contract',
      kind: 'slot-contract-update',
      target: 'custom/customer_normalizer.ts',
      reason: 'Update customer normalizer input contract to v2.',
      requiresVerification: true,
      slotId: 'customer_normalizer'
    }
  ]);
  expect(upgradePlan.migrationOperations).toEqual([
    {
      id: 'mig-customer-normalizer-contract',
      kind: 'slot-contract-update',
      target: 'custom/customer_normalizer.ts',
      role: 'slot',
      slotId: 'customer_normalizer',
      inputType: 'CustomerInputV2',
      outputType: 'CustomerRecordInput',
      writableZones: ['custom/customer_normalizer.ts']
    }
  ]);
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);
  await expect(fs.readFile(upgradePlanPath, 'utf8')).resolves.toContain('mig-customer-normalizer-contract');
});
