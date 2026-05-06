import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildProjectOverview,
  buildProjectOverviewFromWorkspace,
  formatProjectOverview
} from '../../platform/shared/project-overview.ts';
import { buildToolEvidenceReport } from '../../platform/shared/tool-evidence-contract.ts';
import type {
  AcceptanceCoverageReport,
  CiArtifactManifest,
  ExplainGraph,
  LockFile,
  PolicyReport,
  ProvenanceFile,
  ReviewSummary,
  VerificationReport
} from '../../platform/shared/types.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

test('buildProjectOverviewFromWorkspace reports missing required artifacts with recovery command', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(buildProjectOverviewFromWorkspace(workspaceRoot)).rejects.toThrow(
      'run the refresh chain, then bun run platform -- explain'
    );
  });
});

test('buildProjectOverview summarizes shared project status and review priorities', () => {
  expect(CI_ARTIFACT_FILES.overviewView).toBeDefined();

  const lock: LockFile = {
    formatVersion: '1',
    app: {
      name: 'Customer Admin',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'local'
    },
    resolvedBlocks: [
      {
        id: 'auth/basic-session',
        version: '1.0.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'source/blocks/auth/basic-session/block.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official/auth.basic-session'
      },
      {
        id: 'entity/customer-basic',
        version: '1.0.0',
        kind: 'capability',
        installOrder: 2,
        manifestPath: 'source/blocks/entity/customer-basic/block.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official/entity.customer-basic'
      }
    ],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [
      {
        id: 'customer_normalizer',
        block: 'entity/customer-basic',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomerInput',
        kind: 'adapter',
        status: 'verified',
        writableZones: ['custom'],
        provenanceHints: {
          generator: 'adapt',
          verifiedBy: ['user_can_create_customer']
        }
      }
    ],
    generatedPaths: [
      'src/installed/auth/session.ts',
      'custom/customer_normalizer.ts'
    ],
    acceptancePlan: [
      'user_can_login',
      'user_can_create_customer'
    ],
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

  const graph: ExplainGraph = {
    nodes: [
      { id: 'app:customer-admin', type: 'app', label: 'Customer Admin' },
      { id: 'block:auth/basic-session', type: 'block', label: 'auth/basic-session' },
      { id: 'slot:customer_normalizer', type: 'slot', label: 'customer_normalizer' }
    ],
    edges: [
      { from: 'app:customer-admin', to: 'block:auth/basic-session', type: 'depends_on' },
      { from: 'block:auth/basic-session', to: 'slot:customer_normalizer', type: 'connects_to' }
    ],
    overlays: {
      provenance: [],
      coverage: {
        blocks: [
          { id: 'auth/basic-session', coveredBy: ['user_can_login'] },
          { id: 'entity/customer-basic', coveredBy: ['user_can_create_customer'] }
        ],
        slots: [
          { id: 'customer_normalizer', coveredBy: ['user_can_create_customer'] }
        ]
      }
    }
  };

  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: [
      {
        path: 'src/installed/auth/session.ts',
        originType: 'block',
        originId: 'auth/basic-session',
        sourceBlock: 'auth/basic-session',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official/auth.basic-session',
        generatedByPass: 'compose',
        verifiedBy: ['user_can_login'],
        overrideStatus: 'none'
      },
      {
        path: 'custom/customer_normalizer.ts',
        originType: 'slot',
        originId: 'customer_normalizer',
        generatedByPass: 'adapt',
        verifiedBy: [],
        overrideStatus: 'none'
      }
    ]
  };

  const verification: VerificationReport = {
    build: { status: 'passed' },
    unit: { status: 'passed', passed: ['tests/unit/auth.test.ts'] },
    acceptance: {
      status: 'passed',
      passed: ['user_can_login', 'user_can_create_customer'],
      failed: []
    },
    policy: { status: 'passed', violations: [] },
    fast: {
      status: 'passed',
      build: { status: 'passed' },
      unit: { status: 'passed', passed: ['tests/unit/auth.test.ts'] },
      acceptance: {
        status: 'passed',
        passed: ['user_can_login', 'user_can_create_customer'],
        failed: []
      },
      policy: { status: 'passed', violations: [] },
      logs: { stdout: '', stderr: '' }
    },
    runtime: {
      status: 'skipped',
      build: { status: 'skipped', passed: [], failed: [], command: null },
      unit: { status: 'skipped', passed: [], failed: [], command: null },
      acceptance: { status: 'skipped', passed: [], failed: [], command: null },
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
    acceptancePassed: ['user_can_login', 'user_can_create_customer'],
    blocks: [
      {
        id: 'auth/basic-session',
        declaredAcceptance: ['user_can_login'],
        coveredBy: ['user_can_login'],
        uncovered: false
      },
      {
        id: 'entity/customer-basic',
        declaredAcceptance: ['user_can_create_customer'],
        coveredBy: ['user_can_create_customer'],
        uncovered: false
      }
    ],
    slots: [
      {
        id: 'customer_normalizer',
        declaredAcceptance: ['user_can_create_customer'],
        coveredBy: ['user_can_create_customer'],
        uncovered: false
      }
    ],
    uncoveredBlocks: [],
    uncoveredSlots: []
  };

  const policy: PolicyReport = {
    status: 'passed',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };

  const reviewSummary: ReviewSummary = {
    formatVersion: '2',
    ciSummary: {
      status: 'attention',
      failureCount: 0,
      regressionRiskCount: 1,
      conflictHintCount: 0,
      impactedBlockCount: 0,
      impactedSlotCount: 1,
      runtimeEntryCount: 0
    },
    chainSummary: {
      status: 'attention',
      stageCount: 4,
      passedStageCount: 2,
      attentionStageCount: 2,
      failedStageCount: 0,
      stageSummaries: [
        { id: 'verification', status: 'passed', detail: 'verification passed' },
        { id: 'coverage', status: 'passed', detail: 'coverage passed' },
        { id: 'artifacts', status: 'attention', detail: 'overview view missing' },
        { id: 'review', status: 'attention', detail: 'regression risk present' }
      ]
    },
    coverageSummary: {
      status: 'passed',
      acceptancePassedCount: 2,
      blockCount: 2,
      slotCount: 1,
      coveredBlockCount: 2,
      coveredSlotCount: 1,
      uncoveredBlockCount: 0,
      uncoveredSlotCount: 0,
      acceptancePassed: ['user_can_login', 'user_can_create_customer'],
      uncoveredBlocks: [],
      uncoveredSlots: [],
      blockSummaries: [
        {
          id: 'auth/basic-session',
          declaredAcceptanceCount: 1,
          coveredByCount: 1,
          declaredAcceptance: ['user_can_login'],
          coveredBy: ['user_can_login']
        },
        {
          id: 'entity/customer-basic',
          declaredAcceptanceCount: 1,
          coveredByCount: 1,
          declaredAcceptance: ['user_can_create_customer'],
          coveredBy: ['user_can_create_customer']
        }
      ],
      slotSummaries: [
        {
          id: 'customer_normalizer',
          declaredAcceptanceCount: 1,
          coveredByCount: 1,
          declaredAcceptance: ['user_can_create_customer'],
          coveredBy: ['user_can_create_customer']
        }
      ]
    },
    provenanceSummary: {
      artifactCount: 2,
      verifiedArtifactCount: 1,
      unverifiedArtifactCount: 1,
      overrideArtifactCount: 0,
      registryArtifactCount: 1,
      generatedArtifactCount: 2,
      generatedPassCount: 2,
      originSummaryCount: 2,
      originSummaries: [
        { originType: 'block', count: 1, paths: ['src/installed/auth/session.ts'] },
        { originType: 'slot', count: 1, paths: ['custom/customer_normalizer.ts'] }
      ],
      overrideSummaryCount: 1,
      overrideSummaries: [
        {
          overrideStatus: 'none',
          count: 2,
          paths: ['custom/customer_normalizer.ts', 'src/installed/auth/session.ts']
        }
      ],
      registrySummaryCount: 1,
      registrySummaries: [
        {
          registrySourceId: 'official',
          registryKind: 'official',
          registryLocation: 'compiler',
          count: 1,
          paths: ['src/installed/auth/session.ts']
        }
      ],
      generatedPassSummaries: [
        { pass: 'adapt', count: 1, paths: ['custom/customer_normalizer.ts'] },
        { pass: 'compose', count: 1, paths: ['src/installed/auth/session.ts'] }
      ],
      unverifiedArtifacts: ['custom/customer_normalizer.ts']
    },
    policySummary: {
      status: 'passed',
      officialPolicyCount: 0,
      projectPolicyCount: 0,
      mergedPolicyCount: 0,
      sourceCount: 0,
      violationCount: 0,
      severityCounts: {},
      sourceSummaries: [],
      mergedSummaries: [],
      violationSummaries: []
    },
    artifactSummary: {
      artifactStatus: 'attention',
      artifactCount: 6,
      governanceCount: 4,
      viewCount: 2,
      missingCount: 1,
      testCount: 0,
      contractCount: 0,
      contractPaths: [],
      uploadGroupCount: 2,
      missingReasonTypeCount: 1,
      missingReasonCounts: {
        'declared-generated-missing': 0,
        'fixed-governance-missing': 0,
        'fixed-view-missing': 1
      },
      uploadGroups: [],
      missing: [
        {
          path: CI_ARTIFACT_FILES.overviewView,
          reason: 'fixed-view-missing',
          declaredBy: 'artifact-manifest'
        }
      ]
    },
    changeSourceCount: 0,
    runtimeEntryCount: 0,
    installImpactCount: 0,
    changeSources: [],
    runtimeEntries: [],
    verticalSlices: [],
    installImpacts: [],
    installImpactSummary: {
      impactCount: 0,
      blockCount: 0,
      actionKindCount: 0,
      sourceRootCount: 0,
      targetPathCount: 0,
      verticalCount: 0,
      runtimeEntryCount: 0,
      groupCount: 0,
      blocks: [],
      actionKinds: [],
      sourceRoots: [],
      targetPaths: [],
      verticals: [],
      runtimeEntries: [],
      groupSummaries: []
    },
    impactedBlocks: [],
    impactedSlots: ['customer_normalizer'],
    failurePoints: [],
    regressionRisks: [
      {
        kind: 'coverage-gap',
        slotId: 'customer_normalizer',
        message: 'Slot customer_normalizer requires more acceptance coverage'
      }
    ],
    conflictHints: []
  };

  const artifactManifest: CiArtifactManifest = {
    formatVersion: '1',
    root: 'workspace',
    summary: {
      artifactStatus: 'attention',
      artifactCount: 6,
      governanceCount: 4,
      viewCount: 2,
      testCount: 0,
      contractCount: 0,
      contractPaths: [],
      uploadGroupCount: 2,
      missingCount: 1,
      missingReasonTypeCount: 1,
      missingReasonCounts: {
        'declared-generated-missing': 0,
        'fixed-governance-missing': 0,
        'fixed-view-missing': 1
      }
    },
    artifacts: [],
    uploadGroups: [],
    missing: [
      {
        path: CI_ARTIFACT_FILES.overviewView,
        reason: 'fixed-view-missing',
        declaredBy: 'artifact-manifest'
      }
    ]
  };

  const codeQuality = buildToolEvidenceReport({
    kind: 'code-quality',
    toolId: 'eslint',
    rawReportPaths: ['control/evidence/code-quality-report.json'],
    diagnostics: [
      {
        id: 'cq-1',
        severity: 'warning',
        title: 'Writable view emitter needs review',
        message: 'write-local-views should be checked after overview changes',
        filePaths: ['platform/compiler/emit/write-local-views.ts'],
        evidence: ['overview builder consumes emitted view artifacts']
      }
    ]
  });

  const overview = buildProjectOverview({
    workspaceRoot: 'D:/workspace',
    lock,
    explainGraph: graph,
    provenance,
    verification,
    acceptanceCoverage: coverage,
    policy,
    reviewSummary,
    artifactManifest,
    toolEvidenceReports: [codeQuality],
    generatedAt: '2026-05-02T00:00:00.000Z'
  });

  expect(overview).toMatchObject({
    formatVersion: '1',
    workspace: {
      root: '.',
      sourceRoot: 'source',
      projectRoot: 'project',
      controlRoot: 'control',
      localStateRoot: '.pjc'
    },
    status: {
      overall: 'attention',
      verification: 'passed',
      policy: 'passed',
      coverage: 'passed',
      artifacts: 'attention',
      reviewChain: 'attention'
    },
    navigation: {
      workbenchViews: expect.arrayContaining([
        { id: 'overview', path: CI_ARTIFACT_FILES.overviewView },
        { id: 'graph', path: CI_ARTIFACT_FILES.graphView },
        { id: 'review', path: CI_ARTIFACT_FILES.reviewView }
      ])
    },
    aiContext: {
      appName: 'Customer Admin',
      blockCount: 2,
      slotCount: 1,
      graphNodeCount: 3,
      graphEdgeCount: 2,
      generatedPathCount: 2,
      unverifiedArtifactCount: 1,
      priorityReviewFileCount: 2
    },
    quality: {
      reports: expect.arrayContaining([
        expect.objectContaining({ kind: 'code-quality', available: true, status: 'attention' }),
        expect.objectContaining({ kind: 'architecture-boundary', available: false }),
        expect.objectContaining({ kind: 'semantic-pattern', available: false })
      ])
    },
    risks: {
      failureCount: 0,
      regressionRiskCount: 1,
      conflictHintCount: 0,
      missingArtifactCount: 1,
      policyErrorCount: 0
    }
  });

  expect(overview.aiContext.priorityReviewFiles).toEqual([
    {
      path: CI_ARTIFACT_FILES.overviewView,
      reasons: ['missing artifact: fixed-view-missing']
    },
    {
      path: 'custom/customer_normalizer.ts',
      reasons: ['unverified provenance']
    },
    {
      path: 'slot:customer_normalizer',
      reasons: ['regression risk: coverage-gap']
    }
  ]);
  expect(formatProjectOverview(overview)).toContain('Project overview attention');
  expect(formatProjectOverview(overview)).toContain('Graph: 3 nodes / 2 edges; blocks=2; slots=1');
  expect(formatProjectOverview(overview)).toContain(
    'Risks: failures=0; regressions=1; conflicts=0; missingArtifacts=1'
  );
});
