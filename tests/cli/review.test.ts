import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../../platform/shared/benchmark-contract.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildCiContract,
  formatCiContract
} from '../../platform/shared/ci-contract.ts';
import {
  buildContractFreezeContract,
  formatContractFreezeContract
} from '../../platform/shared/contract-freeze-contract.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../../platform/shared/error-protocol-contract.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../../platform/shared/test-budget-contract.ts';
import {
  ACCEPTANCE_USAGE,
  LOCK_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  REPAIR_USAGE,
  RUNTIME_USAGE,
  USAGE
} from '../../platform/cli/usage.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../../platform/shared/reference-check.ts';
import type {
  ExplainGraph,
  RepairPlan,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../../platform/shared/types.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { withTempWorkspace, runCliInProcess as runCli, usageErrorStderr, expectRepairUsageError, expectLockUsageError, expectPolicyUsageError, expectAcceptanceUsageError, expectPostgresUsageError, installPrivateBannerBlock } from '../helpers/test-utils.ts';

test('CLI exposes review summary as text and JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { reviewSummaryPath } = getWorkspacePaths(workspaceRoot);
    await fs.mkdir(path.dirname(reviewSummaryPath), { recursive: true });
    const reviewSummary: ReviewSummary = {
      formatVersion: '2',
      ciSummary: {
        status: 'attention',
        failureCount: 1,
        regressionRiskCount: 2,
        conflictHintCount: 1,
        impactedBlockCount: 1,
        impactedSlotCount: 1,
        runtimeEntryCount: 1
      },
      chainSummary: {
        status: 'attention',
        stageCount: 4,
        passedStageCount: 2,
        attentionStageCount: 1,
        failedStageCount: 1,
        stageSummaries: [
          { id: 'verification', status: 'passed', detail: 'lane=all; failed=none' },
          { id: 'coverage', status: 'failed', detail: 'blocks=1/2; slots=1/1' },
          { id: 'artifacts', status: 'attention', detail: 'total=4; missing=1' },
          { id: 'review', status: 'passed', detail: 'review-summary=generated' }
        ]
      },
      artifactSummary: {
        artifactStatus: 'attention',
        artifactCount: 4,
        governanceCount: 3,
        viewCount: 1,
        contractCount: 1,
        uploadGroupCount: 2,
        missingCount: 1,
        missingReasonTypeCount: 1
      },
      coverageSummary: {
        status: 'failed',
        acceptancePassedCount: 1,
        blockCount: 2,
        slotCount: 1,
        coveredBlockCount: 1,
        coveredSlotCount: 1,
        uncoveredBlockCount: 1,
        uncoveredSlotCount: 0,
        acceptancePassed: ['smoke'],
        uncoveredBlocks: ['tenant/basic-workspace'],
        uncoveredSlots: [],
        blockSummaries: [],
        slotSummaries: []
      },
      provenanceSummary: {
        artifactCount: 5,
        verifiedArtifactCount: 2,
        unverifiedArtifactCount: 3,
        overrideArtifactCount: 1,
        registryArtifactCount: 2,
        generatedArtifactCount: 2,
        generatedPassCount: 2,
        originSummaryCount: 0,
        originSummaries: [],
        overrideSummaryCount: 0,
        overrideSummaries: [],
        registrySummaryCount: 0,
        registrySummaries: [],
        generatedPassSummaries: [],
        unverifiedArtifacts: ['custom/customer_normalizer.ts']
      },
      changeSourceCount: 1,
      runtimeEntryCount: 1,
      installImpactCount: 1,
      changeSources: [
        {
          path: 'custom/customer_normalizer.ts',
          originType: 'slot',
          originId: 'customer_normalizer'
        }
      ],
      runtimeEntries: [
        {
          path: 'app/customers/page.tsx',
          kind: 'page',
          vertical: 'customer',
          relatedBlocks: ['entity/customer-basic']
        }
      ],
      verticalSlices: [],
      installImpacts: [
        {
          blockId: 'entity/customer-basic',
          actionKinds: ['copy'],
          sourceRoots: ['files'],
          targetPaths: ['src/installed/entity/customer-service.ts'],
          verticals: ['customer'],
          runtimeEntries: ['app/customers/page.tsx']
        }
      ],
      installImpactSummary: {
        impactCount: 1,
        blockCount: 1,
        actionKindCount: 1,
        sourceRootCount: 1,
        targetPathCount: 1,
        verticalCount: 1,
        runtimeEntryCount: 1,
        groupCount: 1,
        blocks: ['entity/customer-basic'],
        actionKinds: ['copy'],
        sourceRoots: ['files'],
        targetPaths: ['src/installed/entity/customer-service.ts'],
        verticals: ['customer'],
        runtimeEntries: ['app/customers/page.tsx'],
        groupSummaries: []
      },
      upgradeSummary: {
        status: 'blocked',
        blockId: 'auth/basic-session',
        fromVersion: '0.1.0',
        toVersion: '0.1.1',
        preflightCheckCount: 1,
        preflightEvidenceCount: 1,
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
        verificationSummaries: [{ id: 'required', count: 1 }],
        preflightSummaries: [{ group: 'migration', checkCount: 1, evidenceCount: 1 }],
        migrationSummaries: [
          {
            id: 'mig-auth-session-refresh',
            kind: 'file-replace',
            target: 'src/installed/auth/session.ts',
            reason: 'Refresh auth session implementation.',
            requiresVerification: true,
            source: 'files/src/installed/auth/session.ts'
          }
        ],
        migrationOperationCount: 1,
        migrationOperationSummaries: [
          {
            id: 'mig-auth-session-refresh',
            kind: 'file-replace',
            target: 'src/installed/auth/session.ts',
            role: 'file',
            source: 'files/src/installed/auth/session.ts'
          }
        ],
        diagnostics: {
          status: 'blocked',
          phase: 'apply',
          failedCheck: 'migration-file-operations',
          errorCode: 'UPGRADE-MIGRATION-016',
          message: 'file-replace target "src/installed/auth/session.ts" is missing',
          details: {
            migrationId: 'mig-auth-session-refresh',
            migrationKind: 'file-replace',
            entry: 'migrations/auth-session-refresh.json',
            entryId: 'mig-auth-session-refresh-entry',
            entryKind: 'copy-file',
            target: 'src/installed/auth/session.ts',
            source: 'files/src/installed/auth/session.ts',
            rollbackStatus: 'restored'
          }
        }
      },
      impactedBlocks: ['entity/customer-basic'],
      impactedSlots: ['customer_normalizer'],
      failurePoints: [
        {
          lane: 'fast',
          kind: 'policy',
          message: 'Policy tenant-scope-required: missing tenant guard',
          artifactPath: CI_ARTIFACT_FILES.policyReport
        }
      ],
      regressionRisks: [
        {
          kind: 'coverage-gap',
          message: 'Block tenant/basic-workspace has uncovered acceptance',
          blockId: 'tenant/basic-workspace'
        },
        {
          kind: 'override-active',
          message: 'Slot customer_normalizer has active override',
          slotId: 'customer_normalizer'
        }
      ],
      conflictHints: [
        {
          kind: 'upgrade-plan-present',
          message: 'Upgrade plan needs review before merge',
          relatedId: 'auth/basic-session'
        }
      ]
    };
    await fs.writeFile(reviewSummaryPath, `${JSON.stringify(reviewSummary, null, 2)}\n`, 'utf8');

    const textResult = await runCli(workspaceRoot, ['review', 'summary']);
    expect(textResult.code).toBe(0);
    expect(textResult.stderr).toBe('');
    expect(textResult.stdout).toContain('Review summary attention; format=2; stages=2/4; attention=1; failed=1');
    expect(textResult.stdout).toContain('CI attention; failures=1; risks=2; conflicts=1');
    expect(textResult.stdout).toContain('Impact blocks=1; slots=1; runtime=1; changeSources=1; installImpacts=1');
    expect(textResult.stdout).toContain('Coverage failed; blocks=1/2; slots=1/1');
    expect(textResult.stdout).toContain('Provenance artifacts=5; registry=2; generated=2; unverified=3');
    expect(textResult.stdout).toContain(
      'Artifacts attention; total=4; missing=1; missingReasonTypes=1; contracts=1; uploadGroups=2'
    );
    expect(textResult.stdout).toContain('Stages: verification=passed, coverage=failed, artifacts=attention, review=passed');
    expect(textResult.stdout).toContain(
      'Upgrade blocked; auth/basic-session 0.1.0 -> 0.1.1; migrations=1; impacts=1; requiresVerification=true'
    );
    expect(textResult.stdout).toContain(
      'Upgrade diagnostics apply; migration-file-operations; UPGRADE-MIGRATION-016; file-replace target "src/installed/auth/session.ts" is missing; attribution=migration=mig-auth-session-refresh, kind=file-replace, entry=migrations/auth-session-refresh.json, entryId=mig-auth-session-refresh-entry, entryKind=copy-file, target=src/installed/auth/session.ts, source=files/src/installed/auth/session.ts, rollback=restored'
    );

    const jsonResult = await runCli(workspaceRoot, ['review', 'summary', '--json']);
    expect(jsonResult.code).toBe(0);
    expect(jsonResult.stderr).toBe('');
    expect(JSON.parse(jsonResult.stdout)).toMatchObject({
      formatVersion: '2',
      changeSourceCount: 1,
      runtimeEntryCount: 1,
      installImpactCount: 1,
      chainSummary: { status: 'attention', stageCount: 4 },
      coverageSummary: { status: 'failed', uncoveredBlocks: ['tenant/basic-workspace'] },
      provenanceSummary: { artifactCount: 5, generatedArtifactCount: 2 },
      upgradeSummary: {
        status: 'blocked',
        diagnostics: {
          phase: 'apply',
          details: {
            migrationId: 'mig-auth-session-refresh'
          }
        }
      }
    });

    const diagnosticsResult = await runCli(workspaceRoot, ['review', 'diagnostics']);
    expect(diagnosticsResult.code).toBe(0);
    expect(diagnosticsResult.stderr).toBe('');
    expect(diagnosticsResult.stdout).toContain('Review diagnostics attention; diagnostics=4; failures=1; risks=2; conflicts=1');
    expect(diagnosticsResult.stdout).toContain(`Artifacts: ${CI_ARTIFACT_FILES.policyReport}`);
    expect(diagnosticsResult.stdout).toContain('Blocks: tenant/basic-workspace');
    expect(diagnosticsResult.stdout).toContain('Slots: customer_normalizer');
    expect(diagnosticsResult.stdout).toContain(
      `Diagnostic failure:0; kind=policy; lane=fast; artifact=${CI_ARTIFACT_FILES.policyReport}; Policy tenant-scope-required: missing tenant guard`
    );
    expect(diagnosticsResult.stdout).toContain(
      'Diagnostic regression-risk:0; kind=coverage-gap; block=tenant/basic-workspace; slot=none; Block tenant/basic-workspace has uncovered acceptance'
    );
    expect(diagnosticsResult.stdout).toContain(
      'Diagnostic conflict:0; kind=upgrade-plan-present; related=auth/basic-session; Upgrade plan needs review before merge'
    );

    const diagnosticsJsonResult = await runCli(workspaceRoot, ['review', 'diagnostics', '--json']);
    expect(diagnosticsJsonResult.code).toBe(0);
    expect(diagnosticsJsonResult.stderr).toBe('');
    expect(JSON.parse(diagnosticsJsonResult.stdout)).toMatchObject({
      formatVersion: '1',
      status: 'attention',
      diagnosticCount: 4,
      failureCount: 1,
      regressionRiskCount: 2,
      conflictHintCount: 1,
      artifactPathCount: 1,
      artifactPaths: [CI_ARTIFACT_FILES.policyReport],
      blockCount: 1,
      blocks: ['tenant/basic-workspace'],
      slotCount: 1,
      slots: ['customer_normalizer'],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ category: 'failure', kind: 'policy', lane: 'fast' }),
        expect.objectContaining({ category: 'regression-risk', kind: 'coverage-gap', blockId: 'tenant/basic-workspace' }),
        expect.objectContaining({ category: 'conflict', kind: 'upgrade-plan-present', relatedId: 'auth/basic-session' })
      ])
    });

    const diagnosticsCompactResult = await runCli(workspaceRoot, ['review', 'diagnostics', '--json', '--compact']);
    expect(diagnosticsCompactResult.code).toBe(0);
    expect(diagnosticsCompactResult.stderr).toBe('');
    expect(diagnosticsCompactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(diagnosticsCompactResult.stdout)).toMatchObject({
      formatVersion: '1',
      diagnosticCount: 4,
      artifactPathCount: 1
    });

    const compactResult = await runCli(workspaceRoot, ['review', 'summary', '--json', '--compact']);
    expect(compactResult.code).toBe(0);
    expect(compactResult.stderr).toBe('');
    expect(compactResult.stdout.trim()).not.toContain('\n');
    expect(JSON.parse(compactResult.stdout)).toMatchObject({
      formatVersion: '2',
      chainSummary: { status: 'attention' }
    });
  });
});
