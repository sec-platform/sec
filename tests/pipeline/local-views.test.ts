import fs from 'node:fs/promises';
import { test } from 'vitest';

import { writeLocalViews } from '../../platform/compiler/emit/write-local-views.ts';
import { explainWorkspace } from '../../platform/orchestrator.ts';
import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_ARTIFACT_MISSING_REASON
} from '../../platform/shared/ci-artifact-contract.ts';
import { readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { buildArtifactMissingReasonCounts, buildArtifactUploadGroup } from '../helpers/ci-artifact-fixtures.ts';
import { buildOfficialRegistrySummary } from '../helpers/review-fixtures.ts';
import { prepareLockedWorkspace } from '../helpers/test-utils.ts';

test('write-local-views consumes generated artifacts from disk', async () => {
  const workspaceRoot = await prepareLockedWorkspace({ prefix: 'engineering-compiler-local-views-' });
  const {
    acceptanceCoveragePath,
    repairPlanPath,
    reviewSummaryPath,
    sourceViewPath,
    slotRuleViewPath,
    upgradeDiagnosticsPath,
    upgradePlanPath
  } = getWorkspacePaths(workspaceRoot);

  await explainWorkspace(workspaceRoot);

  const reviewSummary = await readJson<{
    formatVersion: '2';
    ciSummary: {
      status: 'passed' | 'attention' | 'failed';
      failureCount: number;
      regressionRiskCount: number;
      conflictHintCount: number;
      impactedBlockCount: number;
      impactedSlotCount: number;
      runtimeEntryCount: number;
    };
    chainSummary: {
      status: 'passed' | 'attention' | 'failed';
      stageCount: number;
      passedStageCount: number;
      attentionStageCount: number;
      failedStageCount: number;
      stageSummaries: Array<{ id: string; status: string; detail: string }>;
    };
    artifactSummary?: {
      artifactStatus?: 'passed' | 'attention';
      artifactCount: number;
      governanceCount: number;
      viewCount: number;
      contractCount?: number;
      contractPaths?: string[];
      missingCount: number;
      missingReasonCounts?: Record<string, number>;
      uploadGroups?: Array<{ kind: string; count: number; paths: string[] }>;
      missing?: Array<{ path: string; reason: string; declaredBy: string }>;
    };
    coverageSummary?: {
      status: 'passed' | 'failed' | 'skipped';
      acceptancePassedCount: number;
      blockCount: number;
      slotCount: number;
      coveredBlockCount: number;
      coveredSlotCount: number;
      uncoveredBlockCount: number;
      uncoveredSlotCount: number;
      acceptancePassed: string[];
      uncoveredBlocks: string[];
      uncoveredSlots: string[];
      blockSummaries: Array<{
        id: string;
        declaredAcceptanceCount: number;
        coveredByCount: number;
        declaredAcceptance: string[];
        coveredBy: string[];
      }>;
      slotSummaries: Array<{
        id: string;
        declaredAcceptanceCount: number;
        coveredByCount: number;
        declaredAcceptance: string[];
        coveredBy: string[];
      }>;
    };
    provenanceSummary?: {
      artifactCount: number;
      verifiedArtifactCount: number;
      unverifiedArtifactCount: number;
      overrideArtifactCount: number;
      registryArtifactCount: number;
      generatedArtifactCount: number;
      generatedPassCount: number;
      originSummaryCount: number;
      originSummaries: Array<{ originType: string; count: number; paths: string[] }>;
      overrideSummaryCount: number;
      overrideSummaries: Array<{ overrideStatus: string; count: number; paths: string[] }>;
      registrySummaryCount: number;
      registrySummaries: Array<{
        registrySourceId: string;
        registryKind?: string;
        registryLocation?: string;
        count: number;
        paths: string[];
      }>;
      generatedPassSummaries: Array<{ pass: string; count: number; paths: string[] }>;
      unverifiedArtifacts: string[];
    };
    repairSummary?: {
      status: 'pending' | 'applied' | 'skipped' | 'blocked';
      sourceVerificationStatus: 'passed' | 'failed';
      requiresVerification: boolean;
      taskCount: number;
      blockerCount: number;
      previewCount: number;
      changedPreviewCount: number;
      failurePointCount: number;
      verificationTrace: {
        pendingReason: 'repair-not-applied' | 'verify-required' | 'blocked' | 'none';
        nextAction: 'apply-repair' | 'rerun-verify' | 'resolve-blocker' | 'none';
      };
      failureTaxonomy: {
        laneSummaries: Array<{ id: string; count: number }>;
        kindSummaries: Array<{ id: string; count: number }>;
        issueTypeSummaries: Array<{ id: string; count: number }>;
        repairabilitySummaries: Array<{ id: string; count: number }>;
      };
      targetSummaries: Array<{ id: string; targetType: string; count: number }>;
      taskCategorySummaries: Array<{ id: string; count: number }>;
      targetFileCount: number;
      targetFiles: string[];
      taskSummaries: Array<{
        taskId: string;
        sourceSlotId: string;
        targetBlock: string;
        targetFile: string;
        category: string;
        previewStatus: 'changed' | 'unchanged' | 'missing';
        addedLines: number;
        removedLines: number;
        failurePointCount: number;
        targetIds: string[];
        allowedPathCount: number;
        requiredSymbolCount: number;
        forbiddenOperationCount: number;
        testCount: number;
        failureTargetCount: number;
        writeBounds: string[];
        requiredSymbols: string[];
        forbiddenOperations: string[];
        testsToPass: string[];
        failureTargets: string[];
      }>;
      blockerSummaries: Array<{
        blockerId: string;
        boundary: string;
        reason: string;
        decisionRequired: string;
        failurePointCount: number;
      }>;
    };
    upgradeSummary?: {
      status: 'planned' | 'applied' | 'blocked';
      blockId: string;
      fromVersion?: string;
      toVersion: string;
      preflightCheckCount: number;
      preflightEvidenceCount: number;
      migrationCount: number;
      migrationKindCounts: Record<string, number>;
      requiresVerification: boolean;
      requiresVerificationCount: number;
      impactCount: number;
      impacts: string[];
      sourceMigrationCount: number;
      slotMigrationCount: number;
      verificationSummaries: Array<{ id: string; count: number }>;
      preflightSummaries: Array<{ group: string; checkCount: number; evidenceCount: number }>;
      migrationSummaries: Array<{
        id: string;
        kind: string;
        source?: string;
        target: string;
        reason: string;
        requiresVerification: boolean;
      }>;
      migrationOperationCount: number;
      migrationOperationSummaries: Array<{
        id: string;
        kind: string;
        target: string;
        role: 'file' | 'directory' | 'json' | 'text' | 'slot';
        source?: string;
        slotId?: string;
        inputType?: string;
        outputType?: string;
        writableZones?: string[];
        path?: string[];
        updateCount?: number;
        itemCount?: number;
        valueKeyCount?: number;
        contentLength?: number;
        searchLength?: number;
        replacementLength?: number;
        pattern?: string;
        flags?: string;
      }>;
      diagnostics?: { status: 'blocked'; phase: 'planning' | 'apply'; failedCheck: string; errorCode: string; message: string; details?: unknown };
    };
    policySummary?: {
      status: 'passed' | 'failed' | 'skipped';
      officialPolicyCount: number;
      projectPolicyCount: number;
      mergedPolicyCount: number;
      sourceCount: number;
      violationCount: number;
      severityCounts: Record<string, number>;
      sourceSummaries: Array<{ scope: 'official' | 'project'; path: string; policyIds: string[] }>;
      mergedSummaries: Array<{ id: string; sourceScope: 'official' | 'project'; sourcePath: string; targetCount: number; targets: string[] }>;
      violationSummaries: Array<{
        id: string;
        severity: string;
        rule: string;
        fileCount: number;
        files: string[];
        appliesTo: string[];
        message: string;
        sourceScope: 'official' | 'project';
        sourcePath: string;
      }>;
    };
    changeSourceCount: number;
    runtimeEntryCount: number;
    installImpactCount: number;
    runtimeEntries: Array<{ path: string; kind: 'page' | 'api'; vertical?: string; relatedBlocks: string[] }>;
    verticalSlices: Array<{ id: string; runtimeEntries: string[]; relatedBlocks: string[] }>;
    installImpacts: Array<{ blockId: string; actionKinds: string[]; sourceRoots: string[]; verticals: string[]; runtimeEntries: string[]; targetPaths: string[] }>;
    installImpactSummary: {
      impactCount: number;
      blockCount: number;
      actionKindCount: number;
      sourceRootCount: number;
      targetPathCount: number;
      verticalCount: number;
      runtimeEntryCount: number;
      groupCount: number;
      blocks: string[];
      actionKinds: string[];
      sourceRoots: string[];
      targetPaths: string[];
      verticals: string[];
      runtimeEntries: string[];
      groupSummaries: Array<{
        vertical: string;
        blockCount: number;
        actionKindCount: number;
        runtimeEntryCount: number;
        targetPathCount: number;
        blocks: string[];
        actionKinds: string[];
        runtimeEntries: string[];
        targetPaths: string[];
      }>;
    };
    failurePoints: Array<{ lane: 'fast' | 'runtime' | 'all'; kind: string; artifactPath: string; message: string }>;
    regressionRisks: unknown[];
    conflictHints: unknown[];
  }>(reviewSummaryPath);
  reviewSummary.failurePoints = [
    {
      lane: 'fast',
      kind: 'policy',
      artifactPath: CI_ARTIFACT_FILES.policyReport,
      message: 'disk-only <failure> & "point"'
    }
  ];
  reviewSummary.ciSummary = {
    ...reviewSummary.ciSummary,
    status: 'failed',
    failureCount: reviewSummary.failurePoints.length
  };
  reviewSummary.chainSummary = {
    status: 'failed',
    stageCount: 4,
    passedStageCount: 2,
    attentionStageCount: 1,
    failedStageCount: 1,
    stageSummaries: [
      { id: 'verification', status: 'failed', detail: 'lane=fast; failed=fast' },
      { id: 'coverage', status: 'failed', detail: 'blocks=1/2; slots=1/1' },
      { id: 'artifacts', status: 'attention', detail: 'total=7; missing=1' },
      { id: 'review', status: 'passed', detail: 'review-summary=generated' }
    ]
  };
  reviewSummary.provenanceSummary = {
    artifactCount: 4,
    verifiedArtifactCount: 1,
    unverifiedArtifactCount: 3,
    overrideArtifactCount: 1,
    registryArtifactCount: 1,
    generatedArtifactCount: 3,
    generatedPassCount: 3,
    originSummaryCount: 2,
    originSummaries: [
      {
        originType: 'block',
        count: 1,
        paths: ['src/installed/auth/session.ts']
      },
      {
        originType: 'override',
        count: 1,
        paths: ['app/tickets/page.tsx']
      }
    ],
    overrideSummaryCount: 2,
    overrideSummaries: [
      {
        overrideStatus: 'manual',
        count: 1,
        paths: ['app/tickets/page.tsx']
      },
      {
        overrideStatus: 'none',
        count: 3,
        paths: ['custom/customer_normalizer.ts', CI_ARTIFACT_FILES.reviewSummary, 'src/installed/auth/session.ts']
      }
    ],
    registrySummaryCount: 1,
    registrySummaries: [buildOfficialRegistrySummary(['src/installed/auth/session.ts'])],
    generatedPassSummaries: [
      {
        pass: 'compose',
        count: 2,
        paths: ['app/tickets/page.tsx', 'src/installed/auth/session.ts']
      },
      {
        pass: 'review',
        count: 1,
        paths: [CI_ARTIFACT_FILES.reviewSummary]
      }
    ],
    unverifiedArtifacts: ['app/tickets/page.tsx', 'custom/customer_normalizer.ts', CI_ARTIFACT_FILES.reviewSummary]
  };
  reviewSummary.coverageSummary = {
    status: 'failed',
    acceptancePassedCount: 2,
    blockCount: 2,
    slotCount: 1,
    coveredBlockCount: 1,
    coveredSlotCount: 1,
    uncoveredBlockCount: 1,
    uncoveredSlotCount: 0,
    acceptancePassed: ['disk-driven-acceptance', 'slot <coverage> & smoke'],
    uncoveredBlocks: ['entity/customer-basic'],
    uncoveredSlots: [],
    blockSummaries: [
      {
        id: 'entity/customer-basic',
        declaredAcceptanceCount: 2,
        coveredByCount: 1,
        declaredAcceptance: ['disk-driven-acceptance', 'missing-block-coverage'],
        coveredBy: ['disk-driven-acceptance']
      },
      {
        id: 'tenant/basic-workspace',
        declaredAcceptanceCount: 1,
        coveredByCount: 0,
        declaredAcceptance: ['missing-block-coverage'],
        coveredBy: []
      }
    ],
    slotSummaries: [
      {
        id: 'customer_normalizer',
        declaredAcceptanceCount: 1,
        coveredByCount: 1,
        declaredAcceptance: ['slot <coverage> & smoke'],
        coveredBy: ['slot <coverage> & smoke']
      }
    ]
  };
  reviewSummary.artifactSummary = {
    artifactStatus: 'attention',
    artifactCount: 7,
    governanceCount: 5,
    viewCount: 2,
    contractCount: 1,
    contractPaths: ['generated/postgres-contract.json'],
    missingCount: 1,
    missingReasonCounts: buildArtifactMissingReasonCounts({
      [CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing]: 1
    }),
    uploadGroups: [
      buildArtifactUploadGroup('governance', 5, [CI_ARTIFACT_FILES.reviewSummary, CI_ARTIFACT_MANIFEST_PATH]),
      buildArtifactUploadGroup('view', 2, [CI_ARTIFACT_FILES.sourceView, CI_ARTIFACT_FILES.slotRuleView])
    ],
    missing: [
      {
        path: 'generated/missing-<artifact>.json',
        reason: CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing,
        declaredBy: 'graph.lock.json'
      }
    ]
  };
  reviewSummary.repairSummary = {
    status: 'pending',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    taskCount: 1,
    blockerCount: 1,
    previewCount: 1,
    changedPreviewCount: 1,
    failurePointCount: 2,
    verificationTrace: {
      pendingReason: 'repair-not-applied',
      nextAction: 'apply-repair'
    },
    failureTaxonomy: {
      laneSummaries: [{ id: 'fast', count: 2 }],
      kindSummaries: [
        { id: 'policy', count: 1 },
        { id: 'unit', count: 1 }
      ],
      issueTypeSummaries: [
        { id: 'slot', count: 1 },
        { id: 'spec', count: 1 }
      ],
      repairabilitySummaries: [
        { id: 'blocked', count: 1 },
        { id: 'repairable', count: 1 }
      ]
    },
    targetSummaries: [
      { id: 'customer-normalizer.test.ts', targetType: 'slot-target', count: 1 }
    ],
    taskCategorySummaries: [{ id: 'slot-rewrite', count: 1 }],
    targetFileCount: 1,
    targetFiles: ['custom/customer_normalizer.ts'],
    taskSummaries: [
      {
        taskId: 'repair_customer_normalizer',
        sourceSlotId: 'customer_normalizer',
        targetBlock: 'entity/customer-basic',
        targetFile: 'custom/customer_normalizer.ts',
        category: 'slot-rewrite',
        previewStatus: 'changed',
        addedLines: 4,
        removedLines: 1,
        failurePointCount: 1,
        targetIds: ['customer-normalizer.test.ts'],
        allowedPathCount: 1,
        requiredSymbolCount: 1,
        forbiddenOperationCount: 1,
        testCount: 0,
        failureTargetCount: 1,
        writeBounds: ['custom/customer_normalizer.ts'],
        requiredSymbols: ['normalizeCustomerInput'],
        forbiddenOperations: ['write outside custom/customer_normalizer.ts'],
        testsToPass: [],
        failureTargets: ['customer-normalizer.test.ts']
      }
    ],
    blockerSummaries: [
      {
        blockerId: 'repair_blocker_policy',
        boundary: 'spec',
        reason: 'policy <boundary> & manual decision',
        decisionRequired: 'Decide whether policy/spec or project code changes first',
        failurePointCount: 1
      }
    ]
  };
  reviewSummary.policySummary = {
    status: 'failed',
    officialPolicyCount: 1,
    projectPolicyCount: 1,
    mergedPolicyCount: 2,
    sourceCount: 2,
    violationCount: 1,
    severityCounts: {
      error: 1
    },
    sourceSummaries: [
      {
        scope: 'official',
        path: 'platform/policies/official/policy.spec.yaml',
        policyIds: ['tenant-scope-required']
      },
      {
        scope: 'project',
        path: 'project/policies/custom.spec.yaml',
        policyIds: ['project-only']
      }
    ],
    mergedSummaries: [
      {
        id: 'project-only',
        sourceScope: 'project',
        sourcePath: 'project/policies/custom.spec.yaml',
        targetCount: 1,
        targets: ['custom/customer_normalizer.ts']
      },
      {
        id: 'tenant-scope-required',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml',
        targetCount: 1,
        targets: ['src/installed/entity/customer-service.ts']
      }
    ],
    violationSummaries: [
      {
        id: 'tenant-scope-required',
        severity: 'error',
        rule: 'tenant_context_must_flow_to_query',
        fileCount: 1,
        files: ['src/installed/entity/customer-service.ts'],
        appliesTo: ['entity/customer-basic'],
        message: 'disk-only <policy> & violation',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml'
      }
    ]
  };
  reviewSummary.upgradeSummary = {
    status: 'blocked',
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    preflightCheckCount: 5,
    preflightEvidenceCount: 3,
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
    verificationSummaries: [
      { id: 'required', count: 1 },
      { id: 'skipped', count: 0 }
    ],
    preflightSummaries: [
      {
        group: 'migration',
        checkCount: 2,
        evidenceCount: 1
      },
      {
        group: 'override',
        checkCount: 1,
        evidenceCount: 0
      }
    ],
    migrationSummaries: [
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        reason: 'Refresh <session> & expose version metadata.',
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
        source: 'files/src/installed/auth/session.ts',
        contentLength: 128
      }
    ],
    diagnostics: {
      status: 'blocked',
      phase: 'planning',
      failedCheck: 'override-conflicts',
      errorCode: 'UPGRADE-CONFLICT-001',
      message: 'Override <hotfix> & blocks upgrade',
      details: {
        failedCheck: 'override-conflicts',
        overrideId: 'manual-auth-session-hotfix'
      }
    }
  };
  await writeJson(reviewSummaryPath, reviewSummary);

  const coverage = await readJson<{
    blocks: Array<{ id: string; coveredBy: string[] }>;
    slots: Array<{ id: string; coveredBy: string[] }>;
  }>(acceptanceCoveragePath);
  coverage.slots[0].coveredBy = ['disk-driven-acceptance'];
  await writeJson(acceptanceCoveragePath, coverage);
  await writeJson(repairPlanPath, {
    formatVersion: '1',
    status: 'pending',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks: [
      {
        taskId: 'repair_customer_normalizer',
        taskKind: 'repair-slot',
        phase: 'repair',
        sourceSlotId: 'customer_normalizer',
        targetBlock: 'entity/customer-basic',
        targetFile: 'custom/customer_normalizer.ts',
        allowedPaths: ['custom/customer_normalizer.ts'],
        requiredSymbols: ['normalizeCustomerInput'],
        forbiddenOperations: ['write outside custom/customer_normalizer.ts'],
        testsToPass: [],
        failureSummary: 'unit <failed> & needs repair',
        failurePoints: [
          {
            lane: 'fast',
            kind: 'unit',
            issueType: 'slot',
            repairable: true,
            artifactPath: 'tests/unit',
            message: 'unit <failed> & needs repair',
            targetIds: ['customer-normalizer.test.ts']
          }
        ],
        preview: {
          beforeLines: 1,
          afterLines: 4,
          addedLines: 4,
          removedLines: 1,
          changed: true
        }
      }
    ],
    blockers: [
      {
        blockerId: 'repair_blocker_policy',
        boundary: 'spec',
        reason: 'policy <boundary> & manual decision',
        decisionRequired: 'Decide whether policy/spec or project code changes first',
        failurePoints: [
          {
            lane: 'fast',
            kind: 'policy',
            issueType: 'spec',
            repairable: false,
            artifactPath: CI_ARTIFACT_FILES.policyReport,
            message: 'policy <boundary> & manual decision',
            targetIds: ['tenant-scope-required']
          }
        ]
      }
    ]
  });
  await writeJson(upgradeDiagnosticsPath, {
    formatVersion: '1',
    status: 'blocked',
    blockId: 'auth/basic-session',
    targetVersion: '0.1.1',
    failedCheck: 'override-conflicts',
    errorCode: 'UPGRADE-CONFLICT-001',
    message: 'Override <hotfix> & blocks upgrade',
    details: {
      failedCheck: 'override-conflicts',
      overrideId: 'manual-auth-session-hotfix'
    }
  });
  await writeJson(upgradePlanPath, {
    formatVersion: '1',
    blockId: 'auth/basic-session',
    fromVersion: '0.1.0',
    toVersion: '0.1.1',
    status: 'planned',
    preflightChecks: [
      {
        id: 'version-range',
        status: 'passed',
        message: 'Upgrade path 0.1.0 -> 0.1.1 is allowed',
        evidence: ['0.1.x']
      },
      {
        id: 'migration-entries',
        status: 'passed',
        message: '0 migration entries loaded and validated',
        evidence: []
      },
      {
        id: 'migration-targets',
        status: 'passed',
        message: '1 migration paths checked',
        evidence: ['mig-auth-session-refresh:target:src/installed/auth/session.ts:exists']
      },
      {
        id: 'impact-scan',
        status: 'passed',
        message: '1 upgrade impacts calculated',
        evidence: ['src/installed/auth/session.ts']
      },
      {
        id: 'override-conflicts',
        status: 'passed',
        message: '0 overrides scanned with no conflicts',
        evidence: []
      }
    ],
    impacts: ['src/installed/auth/session.ts'],
    migrations: [],
    migrationKindCounts: {
      'file-replace': 1
    },
    migrationSummaries: [
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        reason: 'Refresh <session> & expose version metadata.',
        requiresVerification: true
      }
    ],
    migrationOperations: [
      {
        id: 'mig-auth-session-refresh',
        kind: 'file-replace',
        target: 'src/installed/auth/session.ts',
        role: 'file',
        source: 'files/src/installed/auth/session.ts',
        contentLength: 128
      }
    ]
  });

  await writeLocalViews(workspaceRoot);

  const sourceView = await fs.readFile(sourceViewPath, 'utf8');
  const slotRuleView = await fs.readFile(slotRuleViewPath, 'utf8');
  expectContainsAll(sourceView, [
    'href="slot-rule-view.html"',
    'href="source-view.html" aria-current="page"',
    'CI Summary',
    '<td>Status</td><td>failed</td>',
    '<td>Chain Status</td><td>failed</td>',
    '<td>Chain Stages</td><td>2/4</td>',
    'E2E Chain Summary',
    '<th>Evidence</th>',
    '<td>verification</td>',
    '<td>lane=fast; failed=fast</td>',
    '<td>ci=failed, failures=1</td>',
    '<td>blocks=1/2, slots=1/1</td>',
    '<td>total=7, missing=1, uploadGroups=2, missingReasonTypes=1</td>',
    '<td>review-summary=generated</td>',
    '<td>Artifact Status</td><td>attention</td>',
    '<td>Artifacts</td><td>7</td>',
    '<td>Upload Groups</td><td>2</td>',
    '<td>Missing Artifacts</td><td>1</td>',
    '<td>Missing Reason Types</td><td>1</td>',
    'Provenance Summary',
    '<td>Artifacts</td><td>4</td>',
    '<td>Override Artifacts</td><td>1</td>',
    '<td>Generated Artifacts</td><td>3</td>',
    'Provenance Origin Summary',
    'Provenance Override Summary',
    'Provenance Registry Summary',
    'app/tickets/page.tsx',
    'Acceptance Coverage Summary',
    '<td>Acceptance Passed</td><td>2</td>',
    '<td>Covered Blocks</td><td>1</td>',
    '<td>Uncovered Blocks</td><td>1</td>',
    'Block Coverage Summary',
    'Slot Coverage Summary',
    'slot &lt;coverage&gt; &amp; smoke',
    'Missing Reason Summary',
    CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing,
    '<td>Contract Artifacts</td><td>1</td>',
    '<td>Contract Paths</td><td>generated/postgres-contract.json</td>',
    'Artifact Upload Groups',
    `${CI_ARTIFACT_FILES.reviewSummary}, ${CI_ARTIFACT_MANIFEST_PATH}`,
    `${CI_ARTIFACT_FILES.sourceView}, ${CI_ARTIFACT_FILES.slotRuleView}`,
    'Missing Artifact Diagnostics',
    'generated/missing-&lt;artifact&gt;.json',
    'graph.lock.json',
    'Vertical Summary',
    'Block Combination Summary',
    '<th>Verticals</th><th>Runtime Entries</th>',
    '<td>entity/customer-basic</td>',
    '<td>customer</td>',
    '<td>app/customers/page.tsx</td>',
    'Failure Focus',
    'Failure Groups',
    'Failure Details',
    '<th>Lane</th><th>Kind</th><th>Count</th><th>Artifacts</th>',
    `<td>fast</td>\n          <td>policy</td>\n          <td>1</td>\n          <td>${CI_ARTIFACT_FILES.policyReport}</td>`,
    'Review Runtime Attribution',
    'Runtime Groups',
    'Runtime Entries',
    '<th>Vertical</th><th>Kind</th><th>Count</th><th>Related Blocks</th>',
    '<td>customer</td>\n          <td>api</td>',
    'entity/customer-basic',
    'Install Impact Summary',
    '<td>Impacts</td><td>3</td>',
    '<td>Target Paths</td><td>7</td>',
    'Impact Groups',
    'Impact Details',
    'Workbench Mutations',
    'source/views/mutations/*.json -&gt; source/app.yaml',
    'Policy Summary',
    '<td>Official Policies</td><td>1</td>',
    '<td>Project Policies</td><td>1</td>',
    '<td>Merged Policies</td><td>2</td>',
    '<td>Violations</td><td>1</td>',
    'Policy Severity Summary',
    '<td>error</td><td>1</td>',
    'Policy Source Summary',
    'project/policies/custom.spec.yaml',
    'Policy Merge Summary',
    'custom/customer_normalizer.ts',
    'Policy Violation Summary',
    'disk-only &lt;policy&gt; &amp; violation',
    '<th>Vertical</th><th>Blocks</th><th>Actions</th><th>Runtime Entries</th><th>Targets</th>',
    '<td>customer</td>\n          <td>1</td>',
    'src/installed/entity/customer-service.ts',
    'customers',
    'disk-only &lt;failure&gt; &amp; &quot;point&quot;',
    'Upgrade Summary',
    '<td>Status</td><td>blocked</td>',
    '<td>Preflight Checks</td><td>5</td>',
    '<td>Preflight Evidence</td><td>3</td>',
    '<td>Verification Migrations</td><td>1</td>',
    '<td>Source Migrations</td><td>1</td>',
    '<td>Slot Migrations</td><td>0</td>',
    '<td>Operations</td><td>1</td>',
    'Upgrade Preflight Summary',
    '<td>override</td>',
    'Upgrade Migration Kind Summary',
    'Upgrade Operation Role Summary',
    '<th>Role</th><th>Count</th>',
    '<td>file</td><td>1</td>',
    'Upgrade Verification Summary',
    '<th>Verification</th><th>Count</th>',
    '<td>required</td><td>1</td>',
    '<td>skipped</td><td>0</td>',
    'Upgrade Migration Summary',
    '<th>ID</th><th>Kind</th><th>Source</th><th>Target</th><th>Slot</th><th>Requires Verification</th><th>Reason</th>',
    'files/src/installed/auth/session.ts',
    'Upgrade Migration Operation Summary',
    '<th>ID</th><th>Kind</th><th>Role</th><th>Target</th><th>Details</th>',
    'source=files/src/installed/auth/session.ts; contentLength=128',
    'Upgrade Blocker Summary',
    '<th>Phase</th><th>Failed Check</th><th>Error</th><th>Message</th><th>Details</th>',
    '<td>planning</td>',
    'Upgrade Plan',
    'Preflight Summary',
    '<td>migration</td><td>2</td><td>1</td>',
    'Migration Kind Summary',
    '<td>file-replace</td><td>1</td>',
    'Operation Role Summary',
    'Migration Operations',
    'Preflight Checks',
    'version-range',
    'impact-scan',
    'auth/basic-session 0.1.0 -&gt; 0.1.1 (planned)',
    'Refresh &lt;session&gt; &amp; expose version metadata.',
    'Upgrade Diagnostics',
    '<th>Status</th><th>Phase</th><th>Block</th><th>Target Version</th><th>Failed Check</th><th>Error</th><th>Message</th><th>Details</th>',
    'UPGRADE-CONFLICT-001',
    'Override &lt;hotfix&gt; &amp; blocks upgrade',
    'manual-auth-session-hotfix',
    '&quot;failedCheck&quot;: &quot;override-conflicts&quot;',
    'Repair Summary',
    '<td>Status</td><td>pending</td>',
    '<td>Changed Previews</td><td>1</td>',
    '<td>Failure Points</td><td>2</td>',
    '<td>Trace Pending Reason</td><td>repair-not-applied</td>',
    '<td>Trace Next Action</td><td>apply-repair</td>',
    'Repair Failure Taxonomy',
    '<th>Issue Type</th><th>Count</th>',
    '<td>spec</td><td>1</td>',
    '<td>repairable</td><td>1</td>',
    'Repair Task Category Summary',
    '<th>Category</th><th>Count</th>',
    '<td>slot-rewrite</td><td>1</td>',
    'Repair Target Attribution Summary',
    '<th>Type</th><th>Target</th><th>Count</th>',
    '<td>slot-target</td>',
    '<td>customer-normalizer.test.ts</td>',
    'Repair Task Summary',
    '<th>Write Bounds</th>',
    '<th>Symbols</th>',
    '<th>Tests</th>',
    'Repair Blocker Summary',
    'Repair Plan',
    'requires verification: false',
    'Blockers',
    'repair_blocker_policy',
    'policy &lt;boundary&gt; &amp; manual decision',
    'Decide whether policy/spec or project code changes first',
    'Allowed Paths',
    'Required Symbols',
    'Forbidden Operations',
    'custom/customer_normalizer.ts',
    'normalizeCustomerInput',
    'write outside custom/customer_normalizer.ts',
    'Failure Targets',
    'Category',
    'changed; +4/-1; 1 -&gt; 4 lines',
    'repair_customer_normalizer',
    'unit &lt;failed&gt; &amp; needs repair'
  ]);
  expectContainsNone(sourceView, ['disk-only <failure>', 'Refresh <session>', 'unit <failed>']);
  expectContainsAll(slotRuleView, [
    'href="source-view.html"',
    'href="slot-rule-view.html" aria-current="page"',
    'E2E Chain Summary',
    '<th>Evidence</th>',
    '<td>verification</td>',
    '<td>ci=failed, failures=1</td>',
    '<td>blocks=1/2, slots=1/1</td>',
    '<td>total=7, missing=1, uploadGroups=2, missingReasonTypes=1</td>',
    '<td>review-summary=generated</td>',
    'disk-driven-acceptance'
  ]);
}, 120000);
