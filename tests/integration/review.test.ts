import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import type { ReviewSummary } from '../../src/verification/review/contract/types.ts';
import { writeJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { expectCliVariants } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

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
          path: 'src/installed/entity/customer-service.ts',
          kind: 'service',
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
          runtimeEntries: ['src/installed/entity/customer-service.ts']
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
        runtimeEntries: ['src/installed/entity/customer-service.ts'],
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
    await writeJson(reviewSummaryPath, reviewSummary);

    await expectCliVariants(workspaceRoot, ['review', 'summary'], {
      text: [
        'Review summary attention; format=2; stages=2/4; attention=1; failed=1',
        'CI attention; failures=1; risks=2; conflicts=1',
        'Impact blocks=1; slots=1; runtime=1; changeSources=1; installImpacts=1',
        'Coverage failed; blocks=1/2; slots=1/1',
        'Provenance artifacts=5; registry=2; generated=2; unverified=3',
        'Artifacts attention; total=4; missing=1; missingReasonTypes=1; contracts=1; uploadGroups=2',
        'Stages: verification=passed, coverage=failed, artifacts=attention, review=passed',
        'Upgrade blocked; auth/basic-session 0.1.0 -> 0.1.1; migrations=1; impacts=1; requiresVerification=true',
        'Upgrade diagnostics apply; migration-file-operations; UPGRADE-MIGRATION-016; file-replace target "src/installed/auth/session.ts" is missing; attribution=migration=mig-auth-session-refresh, kind=file-replace, entry=migrations/auth-session-refresh.json, entryId=mig-auth-session-refresh-entry, entryKind=copy-file, target=src/installed/auth/session.ts, source=files/src/installed/auth/session.ts, rollback=restored'
      ],
      json: {
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
      },
      compactJson: {
        formatVersion: '2',
        chainSummary: { status: 'attention' }
      }
    });

    await expectCliVariants(workspaceRoot, ['review', 'diagnostics'], {
      text: [
        'Review diagnostics attention; diagnostics=4; failures=1; risks=2; conflicts=1',
        `Artifacts: ${CI_ARTIFACT_FILES.policyReport}`,
        'Blocks: tenant/basic-workspace',
        'Slots: customer_normalizer',
        `Diagnostic failure:0; kind=policy; lane=fast; artifact=${CI_ARTIFACT_FILES.policyReport}; Policy tenant-scope-required: missing tenant guard`,
        'Diagnostic regression-risk:0; kind=coverage-gap; block=tenant/basic-workspace; slot=none; Block tenant/basic-workspace has uncovered acceptance',
        'Diagnostic conflict:0; kind=upgrade-plan-present; related=auth/basic-session; Upgrade plan needs review before merge'
      ],
      json: {
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
      },
      compactJson: {
        formatVersion: '1',
        diagnosticCount: 4,
        artifactPathCount: 1
      }
    });
  });
});
