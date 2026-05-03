import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  adaptWorkspace,
  explainWorkspace,
  lockWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  expectGraphEdge,
  expectReviewConflictHint,
  expectReviewRegressionRisk
} from '../helpers/graph-assertions.ts';
import { prepareComposedWorkspace, prepareLockedWorkspace } from '../helpers/workspace-fixtures.ts';

test('upgrade advances an official block version and preserves a passing pipeline', async () => {
  const workspaceRoot = await prepareComposedWorkspace({ prefix: 'engineering-compiler-upgrade-' });
  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);

  const beforeUpgrade = await fs.readFile(
    path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts'),
    'utf8'
  );
  expect(beforeUpgrade).toMatch(/SESSION_BLOCK_VERSION = '0\.1\.0'/);

  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

  const { plan, lock, upgradePlan } = await upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1');
  expect(plan.blocks.find((block) => block.id === 'auth/basic-session')?.version).toBe('0.1.1');
  expect(lock.resolvedBlocks.find((block) => block.id === 'auth/basic-session')?.version).toBe('0.1.1');
  expect(lock.passStatus.lock).toBe('succeeded');
  expect(upgradePlan.status).toBe('applied');
  expect(lock.generatedPaths).toContain(CI_ARTIFACT_FILES.upgradePlan);

  const afterUpgrade = await fs.readFile(
    path.join(workspaceRoot, 'project', 'src', 'installed', 'auth', 'session.ts'),
    'utf8'
  );
  expect(afterUpgrade).toMatch(/SESSION_BLOCK_VERSION = '0\.1\.1'/);
  expect(afterUpgrade).toMatch(/SUPPORTED_USERNAMES/);
  await expect(fs.readFile(path.join(workspaceRoot, 'project', 'upgrade.metadata.json'), 'utf8')).resolves.toContain('"auth/basic-session@0.1.1"');

  const persistedUpgradePlan = await readJson<{
    toVersion: string;
    status: string;
    preflightChecks: Array<{ id: string; status: string; message: string; evidence: string[] }>;
    impacts: string[];
    migrationKindCounts: Record<string, number>;
    migrationSummaries: Array<{
      id: string;
      kind: string;
      source?: string;
      target: string;
      reason: string;
      requiresVerification: boolean;
    }>;
    migrationOperations: Array<{
      id: string;
      kind: string;
      target: string;
      role: string;
      source?: string;
      path?: string[];
      itemCount?: number;
    }>;
  }>(upgradePlanPath);
  expect(persistedUpgradePlan.toVersion).toBe('0.1.1');
  expect(persistedUpgradePlan.status).toBe('applied');
  expect(persistedUpgradePlan.preflightChecks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'version-range', status: 'passed', evidence: ['0.1.x'] }),
      expect.objectContaining({
        id: 'migration-entries',
        status: 'passed',
        evidence: [
          'mig-auth-session-refresh:migrations/auth-session-refresh.json',
          'mig-auth-session-upgrade-metadata:migrations/auth-session-upgrade-metadata.json'
        ]
      }),
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
      expect.objectContaining({ id: 'impact-scan', status: 'passed', evidence: ['src/installed/auth/session.ts', 'upgrade.metadata.json'] }),
      expect.objectContaining({ id: 'override-conflicts', status: 'passed', evidence: [] })
    ])
  );
  expect(persistedUpgradePlan.impacts).toHaveLength(0);
  expect(persistedUpgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1,
    'json-array-append': 1
  });
  expect(persistedUpgradePlan.migrationSummaries).toHaveLength(0);
  expect(persistedUpgradePlan.migrationOperations).toHaveLength(0);

  const { reviewSummary } = await explainWorkspace(workspaceRoot);
  expectReviewConflictHint(reviewSummary, {
    kind: 'upgrade-plan-present',
    relatedId: 'auth/basic-session',
    message: 'Upgrade plan applied, verify pending: auth/basic-session 0.1.0 -> 0.1.1'
  });
}, 180000);

test('upgrade advances ticket block version and surfaces runtime upgrade impact', async () => {
  const workspaceRoot = await prepareLockedWorkspace({
    prefix: 'engineering-compiler-ticket-upgrade-',
    blockIds: ['ticket/basic']
  });

  const ticketServicePath = path.join(workspaceRoot, 'project', 'src', 'installed', 'ticket', 'ticket-service.ts');
  const beforeUpgrade = await fs.readFile(ticketServicePath, 'utf8');
  expect(beforeUpgrade).not.toMatch(/TICKET_BLOCK_VERSION/);

  const { plan, lock, upgradePlan } = await upgradeWorkspace(workspaceRoot, 'ticket/basic', '0.1.1');

  const plannedTicketBlock = plan.blocks.find((block) => block.id === 'ticket/basic');
  const resolvedTicketBlock = lock.resolvedBlocks.find((block) => block.id === 'ticket/basic');
  expect(plannedTicketBlock?.version).toBe('0.1.1');
  expect(resolvedTicketBlock?.version).toBe('0.1.1');
  expect(lock.passStatus.lock).toBe('succeeded');
  expect(upgradePlan.status).toBe('applied');
  expect(upgradePlan.impacts.length).toBeGreaterThan(0);
  expect(upgradePlan.migrationKindCounts).toEqual({
    'file-replace': 1,
    'json-array-append': 1
  });

  const afterUpgrade = await fs.readFile(ticketServicePath, 'utf8');
  expect(afterUpgrade).toMatch(/TICKET_BLOCK_VERSION = '0\.1\.1'/);
  const upgradeMetadataPath = path.join(workspaceRoot, 'project', 'upgrade.metadata.json');
  const upgradeMetadata = await fs.readFile(upgradeMetadataPath, 'utf8');
  expect(upgradeMetadata).toContain('"ticket/basic@0.1.1"');

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expectReviewConflictHint(reviewSummary, {
    kind: 'upgrade-plan-present',
    relatedId: 'ticket/basic',
    message: 'Upgrade plan applied, verify pending: ticket/basic 0.1.0 -> 0.1.1'
  });
  expectReviewRegressionRisk(reviewSummary, {
    kind: 'upgrade-impact',
    blockId: 'ticket/basic',
    message: 'Upgrade ticket/basic impacts src/installed/ticket/ticket-service.ts'
  });
  expectGraphEdge(graph, {
    from: 'block:ticket/basic',
    to: 'file:app/tickets/page.tsx',
    type: 'writes_to'
  });
}, 180000);
