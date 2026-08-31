import fs from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { parseUpgradeDiagnosticsJson, parseUpgradePlanJson, UpgradeContractError, type UpgradePlan } from '../../src/change-management/upgrade/contract/types.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import { readReviewGovernanceReports } from '../../src/compiler/emit/read-review-governance-reports.ts';
import { failPipelineTransaction, startPipelineTransaction } from '../../src/compiler/pipeline/journal.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { writeJson, writeText } from '../../src/workspace/files.ts';
import {
  createWorkspaceWriteCommitFence,
  withWorkspaceWriteLease
} from '../../src/workspace/lease.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../src/workspace/paths.ts';
import { checkProjectWriteBoundary, writeProjectBaseline } from '../../src/workspace/project.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function lockFor(paths: string[]): LockFile {
  return {
    formatVersion: '1',
    app: { id: 'upgrade-boundary-test', name: 'upgrade-boundary-test', stack: 'typescript-library', mode: 'single-tenant' },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: paths,
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'pending',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending'
    }
  };
}

function plannedUpgrade(impacts: string[]): UpgradePlan {
  return {
    formatVersion: '1',
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    status: 'planned',
    preflightChecks: [],
    impacts,
    migrations: [],
    migrationKindCounts: {},
    migrationSummaries: [],
    migrationOperations: []
  };
}

test('active upgrade transaction authorizes only declared project impacts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
    const upgradePlanPath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.upgradePlan);
    const allowedPath = 'src/ui/page.ts';
    const deniedPath = 'src/ui/other.ts';
    const allowedAbsolute = path.join(root, allowedPath);
    const deniedAbsolute = path.join(root, deniedPath);

    await writeText(allowedAbsolute, 'export const allowed = 1;\n');
    await writeText(deniedAbsolute, 'export const denied = 1;\n');
    await writeProjectBaseline(workspaceRoot, lockFor([allowedPath, deniedPath]));
    await writeJson(upgradePlanPath, plannedUpgrade([allowedPath]));

    await withWorkspaceWriteLease(workspaceRoot, undefined, async (token) => {
      const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, token);
      const transactionId = await startPipelineTransaction(
        workspaceRoot,
        'upgrade',
        ['resolve', 'compose'],
        commitFence
      );
      try {
        await writeText(allowedAbsolute, 'export const allowed = 2;\n');
        await checkProjectWriteBoundary(workspaceRoot);

        await writeText(deniedAbsolute, 'export const denied = 2;\n');
        await expect(checkProjectWriteBoundary(workspaceRoot)).rejects.toMatchObject({
          code: 'ERROR-DRIFT-001',
          details: { path: deniedPath }
        });
      } finally {
        await failPipelineTransaction(
          workspaceRoot,
          transactionId,
          'TEST-END',
          'test transaction closed',
          commitFence
        );
      }
    });
  }, 'engineering-compiler-upgrade-write-boundary-');
});

test('upgrade durable contracts reject ambiguous JSON and unbound authority', () => {
  const plan = plannedUpgrade(['src/ui/page.ts']);
  expect(parseUpgradePlanJson(JSON.stringify(plan))).toMatchObject({
    formatVersion: '1',
    blockId: 'auth/basic-session',
    status: 'planned',
    impacts: ['src/ui/page.ts']
  });

  const expectFailure = (
    operation: () => unknown,
    kind: UpgradeContractError['kind']
  ): void => {
    try {
      operation();
      throw new Error('expected upgrade contract rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(UpgradeContractError);
      expect(error).toMatchObject({ kind });
    }
  };

  expectFailure(
    () => parseUpgradePlanJson('{"formatVersion":"1","formatVersion":"1"}'),
    'duplicate-key'
  );
  expectFailure(
    () => parseUpgradePlanJson(JSON.stringify({ ...plan, formatVersion: 'future' })),
    'schema'
  );
  expectFailure(
    () => parseUpgradePlanJson(JSON.stringify({ ...plan, unsupportedField: true })),
    'schema'
  );
  expectFailure(
    () => parseUpgradePlanJson(JSON.stringify({ ...plan, impacts: ['../outside'] })),
    'status-impact'
  );
  expectFailure(
    () => parseUpgradePlanJson(JSON.stringify({ ...plan, blockId: '../foreign' })),
    'provenance'
  );

  const diagnostics = {
    formatVersion: '1',
    status: 'blocked',
    phase: 'planning',
    blockId: 'auth/basic-session',
    targetVersion: '0.1.1',
    failedCheck: 'migration-targets',
    errorCode: 'UPGRADE-MIGRATION-004',
    message: 'target is missing'
  };
  expect(parseUpgradeDiagnosticsJson(JSON.stringify(diagnostics))).toMatchObject(diagnostics);
  expectFailure(
    () => parseUpgradeDiagnosticsJson('{"formatVersion":"1","formatVersion":"1"}'),
    'duplicate-key'
  );
  expectFailure(
    () => parseUpgradeDiagnosticsJson(JSON.stringify({ ...diagnostics, unsupportedField: true })),
    'schema'
  );
  expectFailure(
    () => parseUpgradeDiagnosticsJson(JSON.stringify({ ...diagnostics, blockId: '../foreign' })),
    'provenance'
  );
});

test('review governance rejects ambiguous persisted upgrade artifacts before object parsing', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const upgradePlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
    await fs.mkdir(path.dirname(upgradePlanPath), { recursive: true });
    await fs.writeFile(
      upgradePlanPath,
      '{"formatVersion":"1","formatVersion":"1"}',
      'utf8'
    );

    expect(() => readReviewGovernanceReports(workspaceRoot)).toThrow(/duplicate.*key/iu);
  }, 'engineering-compiler-upgrade-review-reader-');
});
