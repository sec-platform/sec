import { expect, test } from 'bun:test';
import { expectRecord, recordFields } from '../../helpers/assertion-helpers.ts';
import { projectReviewDiagnostics } from '../../../src/application/review-diagnostics-inspect.ts';
import { formatReviewDiagnostics } from '../../../src/entry/cli/review-diagnostics-inspect.ts';

import { writeJson } from "../../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { ReviewSummaryInspectView } from '../../../src/application/review-summary-inspect.ts';
import { formatReviewSummary } from '../../../src/entry/cli/review-summary-inspect.ts';
import type { ReviewSummary } from '../../../src/assurance/verification/review/contract/types.ts';
import { expectCliJson, expectCliSuccess, expectCliText } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

const baseView: ReviewSummaryInspectView = {
  formatVersion: '2',
  chain: {
    status: 'failed',
    stageCount: 4,
    passedStageCount: 2,
    attentionStageCount: 1,
    failedStageCount: 1,
    stages: [
      { id: 'verification', status: 'passed' },
      { id: 'coverage', status: 'attention' },
      { id: 'artifacts', status: 'failed' },
      { id: 'review', status: 'passed' }
    ]
  },
  ci: { status: 'failed', failureCount: 2, regressionRiskCount: 1, conflictHintCount: 0 },
  impact: { blockCount: 2, runtimeEntryCount: 3, changeSourceCount: 4, installImpactCount: 1 },
  coverage: null,
  provenance: {
    artifactCount: 3,
    registryArtifactCount: 1,
    generatedArtifactCount: 2,
    unverifiedArtifactCount: 1
  },
  artifacts: {
    artifactStatus: 'missing',
    artifactCount: 0,
    missingCount: 0,
    missingReasonTypeCount: 0,
    contractCount: 0,
    uploadGroupCount: 0
  }
};

test('CLI exposes review summary as text and JSON contracts', async () => {
  // One finite view carries both independent fallback oracles; the
  // populated real CLI text/JSON contract below remains separate.
  const targetOnlyUpgrade = {
    status: 'blocked',
    blockId: 'ticket.basic',
    toVersion: '0.3.0',
    migrationCount: 1,
    impactCount: 2,
    requiresVerification: true
  };
  const fallbackLines = formatReviewSummary({ ...baseView, upgrade: targetOnlyUpgrade }).split('\n');
  expect(fallbackLines).toContain('Coverage missing; blocks=missing');
  expect(fallbackLines).toContain(
    'Upgrade blocked; ticket.basic target 0.3.0; migrations=1; impacts=2; requiresVerification=true'
  );

  const noDiagnostics = projectReviewDiagnostics({
    ciSummary: { status: 'passed' }, failurePoints: [], regressionRisks: [], conflictHints: []
  });
  expect(noDiagnostics).toEqual({
    status: 'passed', diagnosticCount: 0, failureCount: 0,
    regressionRiskCount: 0, conflictHintCount: 0, artifactPathCount: 0,
    artifactPaths: [], blockCount: 0, blocks: [], diagnostics: []
  });
  const emptyLines = formatReviewDiagnostics(noDiagnostics).split('\n');
  expect(emptyLines).toHaveLength(3);
  expectRecord(emptyLines.find(line => /^Review diagnostics\b/u.test(line)),
    ['Review diagnostics passed', 'diagnostics=0', 'failures=0', 'risks=0', 'conflicts=0']);
  expectRecord(emptyLines.find(line => /^Artifacts\b/u.test(line)), ['Artifacts: none']);
  expectRecord(emptyLines.find(line => /^Blocks\b/u.test(line)), ['Blocks: none']);
  expect(emptyLines.some(line => /^Diagnostic\b/u.test(line))).toBe(false);

  await withTempWorkspace(async (workspaceRoot) => {
    const reviewSummaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
    const reviewSummary: ReviewSummary = {
      formatVersion: '2',
      ciSummary: {
        status: 'attention',
        failureCount: 2,
        regressionRiskCount: 5,
        conflictHintCount: 1,
        impactedBlockCount: 1,
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
          { id: 'coverage', status: 'failed', detail: 'blocks=1/2' },
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
        coveredBlockCount: 1,
        uncoveredBlockCount: 1,
        acceptancePassed: ['smoke'],
        uncoveredBlocks: ['tenant/basic-workspace'],
        blockSummaries: []
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
        unverifiedArtifacts: ['src/installed/entity/customer-service.ts']
      },
      changeSourceCount: 1,
      runtimeEntryCount: 1,
      installImpactCount: 1,
      changeSources: [
        {
          path: 'src/installed/entity/customer-service.ts',
          originType: 'block',
          originId: 'entity/customer-basic'
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
      failurePoints: [
        { lane: 'runtime', kind: 'unit', message: 'Second failure', artifactPath: 'a/report.json' },
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
          message: 'Block entity/customer-basic has active override',
          blockId: 'entity/customer-basic'
        },
        { kind: 'coverage-gap', message: 'Unbound risk' },
        { kind: 'coverage-gap', message: 'Empty block', blockId: '' },
        { kind: 'coverage-gap', message: 'Duplicate block', blockId: 'entity/customer-basic' }
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

    await expectCliText(workspaceRoot, ['review'], [
      'Review summary attention; format=2; stages=2/4; attention=1; failed=1',
      'CI attention; failures=2; risks=5; conflicts=1',
      'Impact blocks=1; runtime=1; changeSources=1; installImpacts=1',
      'Coverage failed; blocks=1/2',
      'Provenance artifacts=5; registry=2; generated=2; unverified=3',
      'Artifacts attention; total=4; missing=1; missingReasonTypes=1; contracts=1; uploadGroups=2',
      'Stages: verification=passed, coverage=failed, artifacts=attention, review=passed',
      'Upgrade blocked; auth/basic-session 0.1.0 -> 0.1.1; migrations=1; impacts=1; requiresVerification=true',
      'Upgrade diagnostics apply; migration-file-operations; UPGRADE-MIGRATION-016; file-replace target "src/installed/auth/session.ts" is missing; attribution=migration=mig-auth-session-refresh, kind=file-replace, entry=migrations/auth-session-refresh.json, entryId=mig-auth-session-refresh-entry, entryKind=copy-file, target=src/installed/auth/session.ts, source=files/src/installed/auth/session.ts, rollback=restored'
    ]);
    const reviewJson = await expectCliJson(
      workspaceRoot, ['review', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    // Protect the complete persisted JSON contract, not only representative fields.
    expect(reviewJson).toEqual(reviewSummary);

    const expectedDiagnosticLines = [
      'Review diagnostics attention; diagnostics=8; failures=2; risks=5; conflicts=1',
      `Artifacts: ${CI_ARTIFACT_FILES.policyReport}, a/report.json`,
      'Blocks: entity/customer-basic, tenant/basic-workspace',
      'Diagnostic failure:0; kind=unit; lane=runtime; artifact=a/report.json; Second failure',
      `Diagnostic failure:1; kind=policy; lane=fast; artifact=${CI_ARTIFACT_FILES.policyReport}; Policy tenant-scope-required: missing tenant guard`,
      'Diagnostic regression-risk:0; kind=coverage-gap; block=tenant/basic-workspace; Block tenant/basic-workspace has uncovered acceptance',
      'Diagnostic regression-risk:1; kind=override-active; block=entity/customer-basic; Block entity/customer-basic has active override',
      'Diagnostic regression-risk:2; kind=coverage-gap; block=none; Unbound risk',
      'Diagnostic regression-risk:3; kind=coverage-gap; block=none; Empty block',
      'Diagnostic regression-risk:4; kind=coverage-gap; block=entity/customer-basic; Duplicate block',
      'Diagnostic conflict:0; kind=upgrade-plan-present; related=auth/basic-session; Upgrade plan needs review before merge'
    ];
    const diagnosticsText = await expectCliSuccess(workspaceRoot, ['review', 'diagnostics']);
    const diagnosticLines = diagnosticsText.stdout.trimEnd().split(/\r?\n/u);
    expect(diagnosticLines).toHaveLength(expectedDiagnosticLines.length);
    for (const expectedLine of expectedDiagnosticLines) {
      const fields = recordFields(expectedLine);
      const matching = diagnosticLines.filter(line => recordFields(line).includes(fields[0]!));
      expect(matching).toHaveLength(1);
      expectRecord(matching[0], fields);
    }
    const diagnosticsJson = await expectCliJson(
      workspaceRoot, ['review', 'diagnostics', '--json', '--compact'],
      undefined,
      { compact: true }
    );
    const expectedDiagnostics = {
      status: 'attention',
      diagnosticCount: 8,
      failureCount: 2,
      regressionRiskCount: 5,
      conflictHintCount: 1,
      artifactPathCount: 2,
      artifactPaths: [CI_ARTIFACT_FILES.policyReport, 'a/report.json'],
      blockCount: 2,
      blocks: ['entity/customer-basic', 'tenant/basic-workspace'],
      diagnostics: [
        {
          id: 'failure:0', category: 'failure', kind: 'unit', lane: 'runtime',
          message: 'Second failure', artifactPath: 'a/report.json'
        },
        {
          id: 'failure:1', category: 'failure', kind: 'policy', lane: 'fast',
          message: 'Policy tenant-scope-required: missing tenant guard',
          artifactPath: CI_ARTIFACT_FILES.policyReport
        },
        {
          id: 'regression-risk:0', category: 'regression-risk', kind: 'coverage-gap',
          message: 'Block tenant/basic-workspace has uncovered acceptance',
          blockId: 'tenant/basic-workspace'
        },
        {
          id: 'regression-risk:1', category: 'regression-risk', kind: 'override-active',
          message: 'Block entity/customer-basic has active override',
          blockId: 'entity/customer-basic'
        },
        { id: 'regression-risk:2', category: 'regression-risk', kind: 'coverage-gap', message: 'Unbound risk' },
        { id: 'regression-risk:3', category: 'regression-risk', kind: 'coverage-gap', message: 'Empty block' },
        { id: 'regression-risk:4', category: 'regression-risk', kind: 'coverage-gap',
          message: 'Duplicate block', blockId: 'entity/customer-basic' },
        {
          id: 'conflict:0', category: 'conflict', kind: 'upgrade-plan-present',
          message: 'Upgrade plan needs review before merge', relatedId: 'auth/basic-session'
        }
      ]
    };
    expect(diagnosticsJson).toEqual(expectedDiagnostics);
  });
});
