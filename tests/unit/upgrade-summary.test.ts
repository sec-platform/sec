import { expect, test } from 'bun:test';

import { removeDir, writeJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildOfficialResolvedBlock } from '../helpers/lock-fixtures.ts';
import { buildRepairPlanArtifact, buildRepairTask } from '../helpers/repair-fixtures.ts';
import type { ReviewInputsOptions } from '../helpers/review-fixtures.ts';
import { buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import {
  buildUpgradeDiagnostics,
  buildUpgradeExecutionDiagnostics,
  buildUpgradeExecutionTerminalArtifact,
  buildUpgradePlanArtifact
} from '../helpers/upgrade-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

type ReviewSummary = Awaited<ReturnType<typeof buildReviewSummaryFromInputs>>;
type UpgradeDiagnosticsOptions = NonNullable<Parameters<typeof buildUpgradeDiagnostics>[0]>;
type UpgradeFailureAttributionCase = {
  name: string;
  diagnostics: UpgradeDiagnosticsOptions;
  failureMessage: string;
};

const FILE_TARGET_ZETA = 'src/installed/generated/zeta.ts';
const FILE_TARGET_ALPHA = 'src/installed/generated/alpha.ts';
const MIGRATION_TARGET_CUSTOMER_NORMALIZER = 'src/installed/private/customer-normalizer.ts';

async function buildReviewSummaryWithUpgradeDiagnostics(
  diagnosticsOptions: UpgradeDiagnosticsOptions
): Promise<ReviewSummary> {
  return withTempWorkspace(async (workspaceRoot) => {
    const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.upgradeDiagnostics
    );
    if (diagnosticsOptions.phase === 'apply' || diagnosticsOptions.phase === 'recovery') {
      const plan = buildUpgradePlanArtifact();
      const terminal = buildUpgradeExecutionTerminalArtifact(plan, {
        settlement: diagnosticsOptions.phase === 'recovery' ? 'recovery-required' : 'rolled-back'
      });
      await writeJson(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan),
        plan
      );
      await writeJson(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
        terminal
      );
      await writeJson(
        upgradeDiagnosticsPath,
        buildUpgradeExecutionDiagnostics(plan, terminal, diagnosticsOptions)
      );
    } else {
      await writeJson(upgradeDiagnosticsPath, buildUpgradeDiagnostics(diagnosticsOptions));
    }

    return buildReviewSummaryFromInputs(workspaceRoot, {
      lock: {
        passStatus: {
          lock: 'succeeded',
          emit: 'succeeded'
        }
      }
    });
  });
}

function expectUpgradeFailurePoint(summary: ReviewSummary, message: string): void {
  expect(summary.failurePoints).toContainEqual({
    lane: 'all',
    kind: 'upgrade',
    artifactPath: CI_ARTIFACT_FILES.upgradeDiagnostics,
    message
  });
}

test('review summary surfaces pending upgrade plans without running upgrade e2e', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    const upgradeDiagnosticsPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.upgradeDiagnostics
    );
    const upgradePlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradePlan);
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
    const upgradeTerminal = buildUpgradeExecutionTerminalArtifact(upgradePlan, { settlement: 'rolled-back' });
    const upgradeDiagnostics = buildUpgradeExecutionDiagnostics(upgradePlan, upgradeTerminal, {
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
          targetFile: FILE_TARGET_ZETA,
          requiredSymbols: [],
          failureSummary: 'unit=failed',
          failurePoints: []
        }),
        buildRepairTask({
          taskId: 'repair_alpha',
          targetFile: FILE_TARGET_ALPHA,
          requiredSymbols: [],
          failureSummary: 'unit=failed',
          failurePoints: []
        })
      ]
    });
    await writeJson(upgradePlanPath, upgradePlan);
    await writeJson(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
      upgradeTerminal
    );
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
      preflightCheckCount: 9,
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
      migrationOperationCount: 1,
      diagnostics: {
        status: 'blocked',
        phase: 'apply',
        failedCheck: 'override-conflicts',
        errorCode: 'UPGRADE-CONFLICT-001',
        message: 'Override "manual <hotfix>" conflicts with upgrade of "auth/basic-session"',
        details: {
          failedCheck: 'override-conflicts',
          overrideId: 'manual-auth-session-hotfix'
        }
      }
    });
    expect(summary.upgradeSummary?.preflightSummaries).toHaveLength(4);
    expect(summary.upgradeSummary?.migrationSummaries).toHaveLength(1);
    expect(summary.conflictHints).toHaveLength(4);
    expectUpgradeFailurePoint(
      summary,
      'Upgrade blocked at override-conflicts: UPGRADE-CONFLICT-001 Override "manual <hotfix>" conflicts with upgrade of "auth/basic-session"'
    );
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

    await removeDir(upgradeDiagnosticsPath);
    await writeJson(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.upgradeExecutionTerminal),
      buildUpgradeExecutionTerminalArtifact(upgradePlan)
    );

    const appliedSummary = await buildReviewSummaryFromInputs(workspaceRoot, reviewOptions);

    expect(appliedSummary.upgradeSummary).toMatchObject({
      status: 'applied',
      blockId: 'auth/basic-session',
      requiresVerification: true,
      requiresVerificationCount: 1
    });
    expect(appliedSummary.conflictHints).toEqual(
      expect.arrayContaining([
        {
          kind: 'upgrade-plan-present',
          relatedId: 'auth/basic-session',
          message: 'Upgrade applied, verify pending: auth/basic-session 0.1.0 -> 0.1.1'
        }
      ])
    );

    await writeJson(upgradePlanPath, {
      ...upgradePlan,
      formatVersion: 'future'
    });
    await expect(buildReviewSummaryFromInputs(workspaceRoot, reviewOptions)).rejects.toThrow();
  });
});

test('review summary preserves upgrade diagnostics details without an upgrade plan', async () => {
  const summary = await buildReviewSummaryWithUpgradeDiagnostics({
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

  expect(summary.upgradeSummary).toMatchObject({
    status: 'blocked',
    blockId: 'private/block-upgrade',
    toVersion: '0.2.0',
    sourceMigrationCount: 0,
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
  expectUpgradeFailurePoint(
    summary,
    'Upgrade blocked at migration-targets: UPGRADE-MIGRATION-004 Migration path "../outside-project.md" escapes project root; migration=mig-target-escape; target=../outside-project.md'
  );
});

test.each<UpgradeFailureAttributionCase>([
  {
    name: 'entry',
    diagnostics: {
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
    },
    failureMessage:
      'Upgrade blocked at migration-entries: UPGRADE-MIGRATION-003 Migration entry "migrations/mismatched-entry.json" does not match manifest metadata; migration=mig-expected-entry; kind=text-append; entry=migrations/mismatched-entry.json; entryId=mig-actual-entry; entryKind=text-replace'
  },
  {
    name: 'apply',
    diagnostics: {
      phase: 'apply',
      failedCheck: 'migration-file-operations',
      errorCode: 'UPGRADE-MIGRATION-016',
      message: `file-replace target "${MIGRATION_TARGET_CUSTOMER_NORMALIZER}" is missing`,
      details: {
        migrationId: 'mig-customer-normalizer-file',
        migrationKind: 'file-replace',
        target: MIGRATION_TARGET_CUSTOMER_NORMALIZER,
        rollbackStatus: 'restored'
      }
    },
    failureMessage:
      `Upgrade blocked at migration-file-operations: UPGRADE-MIGRATION-016 file-replace target "${MIGRATION_TARGET_CUSTOMER_NORMALIZER}" is missing; migration=mig-customer-normalizer-file; kind=file-replace; target=${MIGRATION_TARGET_CUSTOMER_NORMALIZER}; rollback=restored`
  }
])('review summary includes $name migration attribution in upgrade failure points', async ({ diagnostics, failureMessage }) => {
  const summary = await buildReviewSummaryWithUpgradeDiagnostics(diagnostics);

  expectUpgradeFailurePoint(summary, failureMessage);
});
