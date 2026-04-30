import { expect, test } from 'vitest';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { buildOfficialResolvedBlock } from '../helpers/lock-fixtures.ts';
import { buildRepairPlanArtifact, buildRepairTask } from '../helpers/repair-fixtures.ts';
import type { ReviewInputsOptions } from '../helpers/review-fixtures.ts';
import { buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import { buildUpgradeDiagnostics, buildUpgradePlanArtifact } from '../helpers/upgrade-fixtures.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

test('review summary surfaces pending upgrade plans without running upgrade e2e', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { repairPlanPath, upgradeDiagnosticsPath, upgradePlanPath } = getWorkspacePaths(workspaceRoot);
    const reviewOptions: ReviewInputsOptions = {
      lock: {
        resolvedBlocks: [
          buildOfficialResolvedBlock({
            id: 'auth/basic-session',
            installOrder: 1,
            manifestPath: 'block.manifest.yaml'
          })
        ],
        resolvedCapabilities: ['auth/session'],
        passStatus: {
          lock: 'succeeded',
          emit: 'succeeded'
        }
      }
    };
    const upgradePlan = buildUpgradePlanArtifact();
    const upgradeDiagnostics = buildUpgradeDiagnostics({
      blockId: 'auth/basic-session',
      targetVersion: '0.1.1',
      failedCheck: 'override-conflicts',
      errorCode: 'UPGRADE-CONFLICT-001',
      message: 'Override "manual <hotfix>" conflicts with upgrade of "auth/basic-session"',
      details: {
        failedCheck: 'override-conflicts',
        overrideId: 'manual-auth-session-hotfix'
      }
    });
    const repairPlan = buildRepairPlanArtifact({
      tasks: [
        buildRepairTask({
          taskId: 'repair_zeta',
          sourceSlotId: 'zeta',
          targetFile: 'custom/zeta.ts',
          requiredSymbols: [],
          failureSummary: 'unit=failed',
          failurePoints: []
        }),
        buildRepairTask({
          taskId: 'repair_alpha',
          sourceSlotId: 'alpha',
          targetFile: 'custom/alpha.ts',
          requiredSymbols: [],
          failureSummary: 'unit=failed',
          failurePoints: []
        })
      ]
    });
    await writeJson(upgradePlanPath, upgradePlan);
    await writeJson(upgradeDiagnosticsPath, upgradeDiagnostics);
    await writeJson(repairPlanPath, repairPlan);

    const summary = await buildReviewSummaryFromInputs(workspaceRoot, reviewOptions);

    expect(summary.ciSummary.status).toBe('failed');
    expect(summary.ciSummary.failureCount).toBe(1);
    expect(summary.ciSummary.regressionRiskCount).toBeGreaterThanOrEqual(2);
    expect(summary.ciSummary.conflictHintCount).toBe(4);
    expect(summary.upgradeSummary).toMatchObject({
      status: 'blocked',
      blockId: 'auth/basic-session',
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      preflightCheckCount: 10,
      preflightEvidenceCount: 5,
      migrationCount: 1,
      migrationKindCounts: {
        'file-replace': 1
      },
      requiresVerification: true,
      requiresVerificationCount: 1,
      impactCount: 1,
      impacts: ['src/installed/auth/session.ts'],
      sourceMigrationCount: 1,
      slotMigrationCount: 0,
      migrationOperationCount: 1,
      diagnostics: {
        status: 'blocked',
        phase: 'planning',
        failedCheck: 'override-conflicts',
        errorCode: 'UPGRADE-CONFLICT-001',
        message: 'Override "manual <hotfix>" conflicts with upgrade of "auth/basic-session"',
        details: {
          failedCheck: 'override-conflicts',
          overrideId: 'manual-auth-session-hotfix'
        }
      }
    });
    expect(summary.upgradeSummary?.preflightSummaries).toEqual([
      {
        group: 'impact',
        checkCount: 1,
        evidenceCount: 1
      },
      {
        group: 'migration',
        checkCount: 7,
        evidenceCount: 3
      },
      {
        group: 'override',
        checkCount: 1,
        evidenceCount: 0
      },
      {
        group: 'version',
        checkCount: 1,
        evidenceCount: 1
      }
    ]);
    expect(summary.upgradeSummary?.migrationSummaries).toEqual([
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        source: 'files/src/installed/auth/session.ts',
        target: 'src/installed/auth/session.ts',
        reason: 'Refresh auth session implementation to 0.1.1 and expose version metadata.',
        requiresVerification: true
      }
    ]);
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
      },
      {
        kind: 'upgrade-preflight-passed',
        relatedId: 'auth/basic-session',
        message: 'Upgrade preflight passed: version-range, migration-entries, migration-targets, migration-file-operations, migration-json-shapes, migration-json-structure, migration-text-patterns, migration-slot-contracts, impact-scan, override-conflicts'
      }
    ]);
    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'upgrade',
      artifactPath: CI_ARTIFACT_FILES.upgradeDiagnostics,
      message: 'Upgrade blocked at override-conflicts: UPGRADE-CONFLICT-001 Override "manual <hotfix>" conflicts with upgrade of "auth/basic-session"'
    });
    expect(summary.regressionRisks).toContainEqual({
      kind: 'upgrade-impact',
      blockId: 'auth/basic-session',
      message: 'Upgrade auth/basic-session impacts src/installed/auth/session.ts'
    });
    expect(summary.regressionRisks).toContainEqual({
      kind: 'upgrade-verification',
      blockId: 'auth/basic-session',
      message: 'Upgrade migration mig-auth-session-refresh requires verification for src/installed/auth/session.ts'
    });

    upgradePlan.status = 'applied';
    await writeJson(upgradePlanPath, upgradePlan);

    const appliedSummary = await buildReviewSummaryFromInputs(workspaceRoot, reviewOptions);

    expect(appliedSummary.upgradeSummary).toMatchObject({
      status: 'blocked',
      blockId: 'auth/basic-session',
      requiresVerification: true,
      requiresVerificationCount: 1,
      diagnostics: {
        phase: 'planning',
        failedCheck: 'override-conflicts',
        errorCode: 'UPGRADE-CONFLICT-001'
      }
    });
    expect(appliedSummary.conflictHints).toEqual(
      expect.arrayContaining([
        {
          kind: 'upgrade-plan-present',
          relatedId: 'auth/basic-session',
          message: 'Upgrade plan applied, verify pending: auth/basic-session 0.1.0 -> 0.1.1'
        }
      ])
    );
  });
});

test('review summary preserves upgrade diagnostics details without an upgrade plan', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
    const diagnostics = buildUpgradeDiagnostics({
      failedCheck: 'migration-targets',
      errorCode: 'UPGRADE-MIGRATION-004',
      message: 'Migration path "../outside-project.md" escapes project root',
      details: {
        failedCheck: 'migration-targets',
        migrationId: 'mig-target-escape',
        path: '../outside-project.md',
        role: 'target',
        root: 'project'
      }
    });

    await writeJson(upgradeDiagnosticsPath, diagnostics);

    const summary = await buildReviewSummaryFromInputs(workspaceRoot, {
      lock: {
        passStatus: {
          lock: 'succeeded',
          emit: 'succeeded'
        }
      }
    });

    expect(summary.upgradeSummary).toMatchObject({
      status: 'blocked',
      blockId: 'private/slot-contract',
      toVersion: '0.2.0',
      sourceMigrationCount: 0,
      slotMigrationCount: 0,
      migrationOperationCount: 0,
      diagnostics: {
        phase: 'planning',
        failedCheck: 'migration-targets',
        errorCode: 'UPGRADE-MIGRATION-004',
        details: {
          migrationId: 'mig-target-escape',
          path: '../outside-project.md',
          role: 'target',
          root: 'project'
        }
      }
    });
    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'upgrade',
      artifactPath: CI_ARTIFACT_FILES.upgradeDiagnostics,
      message: 'Upgrade blocked at migration-targets: UPGRADE-MIGRATION-004 Migration path "../outside-project.md" escapes project root; migration=mig-target-escape; target=../outside-project.md'
    });
  });
});

test('review summary includes entry migration attribution in upgrade failure points', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
    const diagnostics = buildUpgradeDiagnostics({
      failedCheck: 'migration-entries',
      errorCode: 'UPGRADE-MIGRATION-003',
      message: 'Migration entry "migrations/mismatched-entry.json" does not match manifest metadata',
      details: {
        migrationId: 'mig-expected-entry',
        migrationKind: 'text-append',
        entry: 'migrations/mismatched-entry.json',
        entryId: 'mig-actual-entry',
        entryKind: 'text-replace'
      }
    });

    await writeJson(upgradeDiagnosticsPath, diagnostics);

    const summary = await buildReviewSummaryFromInputs(workspaceRoot, {
      lock: {
        passStatus: {
          lock: 'succeeded',
          emit: 'succeeded'
        }
      }
    });

    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'upgrade',
      artifactPath: CI_ARTIFACT_FILES.upgradeDiagnostics,
      message: 'Upgrade blocked at migration-entries: UPGRADE-MIGRATION-003 Migration entry "migrations/mismatched-entry.json" does not match manifest metadata; migration=mig-expected-entry; kind=text-append; entry=migrations/mismatched-entry.json; entryId=mig-actual-entry; entryKind=text-replace'
    });
  });
});

test('review summary includes apply migration attribution in upgrade failure points', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
    const diagnostics = buildUpgradeDiagnostics({
      phase: 'apply',
      failedCheck: 'migration-file-operations',
      errorCode: 'UPGRADE-MIGRATION-016',
      message: 'slot-contract-update target "custom/customer_normalizer.ts" is missing',
      details: {
        migrationId: 'mig-customer-normalizer-contract',
        migrationKind: 'slot-contract-update',
        slotId: 'customer_normalizer',
        target: 'custom/customer_normalizer.ts',
        rollbackStatus: 'restored'
      }
    });

    await writeJson(upgradeDiagnosticsPath, diagnostics);

    const summary = await buildReviewSummaryFromInputs(workspaceRoot, {
      lock: {
        passStatus: {
          lock: 'succeeded',
          emit: 'succeeded'
        }
      }
    });

    expect(summary.failurePoints).toContainEqual({
      lane: 'all',
      kind: 'upgrade',
      artifactPath: CI_ARTIFACT_FILES.upgradeDiagnostics,
      message: 'Upgrade blocked at migration-file-operations: UPGRADE-MIGRATION-016 slot-contract-update target "custom/customer_normalizer.ts" is missing; migration=mig-customer-normalizer-contract; kind=slot-contract-update; target=custom/customer_normalizer.ts; slot=customer_normalizer; rollback=restored'
    });
  });
});
