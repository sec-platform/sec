import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildReviewSummary } from '../platform/compiler/emit/write-review-summary.ts';
import { writeJson } from '../platform/shared/fs.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  RepairPlan,
  UpgradePlan,
  VerificationReport
} from '../platform/shared/types.ts';

test('review summary surfaces pending upgrade plans without running upgrade e2e', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-review-upgrade-'));
  try {
    const { repairPlanPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs-ts-prisma-sqlite',
        mode: 'single-tenant'
      },
      resolvedBlocks: [{
        id: 'auth/basic-session',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      }],
      resolvedCapabilities: ['auth/session'],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'succeeded',
        repair: 'skipped',
        lock: 'succeeded',
        emit: 'succeeded'
      }
    };
    const provenance: ProvenanceFile = {
      formatVersion: '1',
      artifacts: []
    };
    const report: VerificationReport = {
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      fast: {
        status: 'passed',
        build: { status: 'passed' },
        unit: { status: 'passed', passed: [] },
        acceptance: { status: 'passed', passed: [], failed: [] },
        policy: { status: 'passed', violations: [] },
        logs: { stdout: '', stderr: '' }
      },
      runtime: {
        status: 'skipped',
        build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
        unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
        acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
        logs: { stdout: '', stderr: '' }
      },
      summary: {
        status: 'passed',
        requestedLane: 'fast',
        failedLanes: []
      },
      logs: { stdout: '', stderr: '' }
    };
    const coverage: AcceptanceCoverageReport = {
      formatVersion: '1',
      status: 'passed',
      acceptancePassed: [],
      blocks: [],
      slots: [],
      uncoveredBlocks: [],
      uncoveredSlots: []
    };
    const upgradePlan: UpgradePlan = {
      formatVersion: '1',
      blockId: 'auth/basic-session',
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      status: 'planned',
      impacts: ['src/installed/auth/session.ts'],
      migrations: [],
      migrationSummaries: []
    };
    const repairPlan: RepairPlan = {
      formatVersion: '1',
      status: 'pending',
      sourceVerificationStatus: 'failed',
      tasks: [
        {
          taskId: 'repair_zeta',
          taskKind: 'repair-slot',
          phase: 'repair',
          sourceSlotId: 'zeta',
          targetBlock: 'entity/customer-basic',
          targetFile: 'custom/zeta.ts',
          allowedPaths: ['custom/zeta.ts'],
          requiredSymbols: [],
          forbiddenOperations: [],
          testsToPass: [],
          failureSummary: 'unit=failed',
          failurePoints: []
        },
        {
          taskId: 'repair_alpha',
          taskKind: 'repair-slot',
          phase: 'repair',
          sourceSlotId: 'alpha',
          targetBlock: 'entity/customer-basic',
          targetFile: 'custom/alpha.ts',
          allowedPaths: ['custom/alpha.ts'],
          requiredSymbols: [],
          forbiddenOperations: [],
          testsToPass: [],
          failureSummary: 'unit=failed',
          failurePoints: []
        }
      ]
    };
    await writeJson(upgradePlanPath, upgradePlan);
    await writeJson(repairPlanPath, repairPlan);

    const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(summary.conflictHints).toEqual([
      {
        kind: 'repair-plan-present',
        relatedId: 'repair_alpha',
        message: 'Repair task pending: repair_alpha -> custom/alpha.ts'
      },
      {
        kind: 'repair-plan-present',
        relatedId: 'repair_zeta',
        message: 'Repair task pending: repair_zeta -> custom/zeta.ts'
      },
      {
        kind: 'upgrade-plan-present',
        relatedId: 'auth/basic-session',
        message: 'Upgrade plan present: auth/basic-session 0.1.0 -> 0.1.1'
      }
    ]);
    expect(summary.regressionRisks).toContainEqual({
      kind: 'upgrade-impact',
      blockId: 'auth/basic-session',
      message: 'Upgrade auth/basic-session impacts src/installed/auth/session.ts'
    });

    upgradePlan.status = 'applied';
    await writeJson(upgradePlanPath, upgradePlan);

    const appliedSummary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(appliedSummary.conflictHints).toEqual(
      expect.arrayContaining([
        {
          kind: 'upgrade-plan-present',
          relatedId: 'auth/basic-session',
          message: 'Upgrade plan applied, verify pending: auth/basic-session 0.1.0 -> 0.1.1'
        }
      ])
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
