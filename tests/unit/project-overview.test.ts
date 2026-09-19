import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import type { PolicyReport } from '../../src/semantics/policies/types.ts';
import {
  buildProjectOverview,
  buildProjectOverviewFromWorkspace
} from '../../src/bootstrap/cli/project-overview.ts';
import { formatProjectOverview } from '../../src/entry/cli/project-overview.ts';
import { platformCommand } from '../../src/adapters/verification/platform/sec-command.ts';
import type { AcceptanceCoverageReport } from '../../src/assurance/acceptance/coverage.ts';
import type { ExplainGraph } from '../../src/semantics/projection/explain.ts';
import type { ProvenanceFile } from '../../src/semantics/provenance/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactManifest } from '../../src/assurance/verification/ci-artifacts/contract/types.ts';
import type { VerificationReport } from '../../src/assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../../src/assurance/verification/review/contract/types.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('buildProjectOverviewFromWorkspace reports missing required artifacts with recovery command', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    expect(() => buildProjectOverviewFromWorkspace(workspaceRoot)).toThrow(
      'run the refresh chain, then bun run sec -- explain'
    );
  });
});

test('buildProjectOverview summarizes shared project status and review priorities', () => {
  const lock: LockFile = {
    formatVersion: '1',
    app: {
      id: 'customer-admin',
      name: 'Customer Admin',
      stack: 'typescript-library',
      mode: 'local'
    },
    resolvedBlocks: [
      {
        id: 'auth/basic-session',
        version: '1.0.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'model/blocks/auth/basic-session/block.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'catalog/registry/official/auth.basic-session'
      },
      {
        id: 'entity/customer-basic',
        version: '1.0.0',
        kind: 'capability',
        installOrder: 2,
        manifestPath: 'model/blocks/entity/customer-basic/block.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'catalog/registry/official/entity.customer-basic'
      }
    ],
    resolvedCapabilities: [],
    installPlan: [],
    generatedPaths: [
      'src/installed/auth/session.ts',
      'src/installed/entity/customer.ts'
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
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'succeeded',
      emit: 'succeeded'
    }
  };

  const graph: ExplainGraph = {
    semanticViews: buildSemanticViewFixture(),
    nodes: [
      { id: 'app:customer-admin', type: 'app', label: 'Customer Admin' },
      { id: 'block:auth/basic-session', type: 'block', label: 'auth/basic-session' },
      { id: 'block:entity/customer-basic', type: 'block', label: 'entity/customer-basic' }
    ],
    edges: [
      { from: 'app:customer-admin', to: 'block:auth/basic-session', type: 'depends_on' },
      { from: 'app:customer-admin', to: 'block:entity/customer-basic', type: 'depends_on' }
    ],
    overlays: {
      provenance: [],
      coverage: {
        blocks: [
          { id: 'auth/basic-session', coveredBy: ['user_can_login'] },
          { id: 'entity/customer-basic', coveredBy: ['user_can_create_customer'] }
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
        registryPath: 'catalog/registry/official/auth.basic-session',
        generatedByPass: 'compose',
        verifiedBy: ['user_can_login'],
        overrideStatus: 'none'
      },
      {
        path: 'src/installed/entity/customer.ts',
        originType: 'block',
        originId: 'entity/customer-basic',
        sourceBlock: 'entity/customer-basic',
        generatedByPass: 'compose',
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
    uncoveredBlocks: []
  };

  const policy: PolicyReport = {
    status: 'passed',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: [],
    evaluation: {
      providerId: 'semantic-policy-test-provider',
      providerRevision: 'semantic-policy-test-provider-v1',
      assurance: 'semantic',
      requiredSemanticPredicates: ['FLOWS_TO'],
      unsupportedSemanticPredicates: []
    }
  };

  const reviewSummary: ReviewSummary = {
    formatVersion: '2',
    ciSummary: {
      status: 'attention',
      failureCount: 0,
      regressionRiskCount: 1,
      conflictHintCount: 0,
      impactedBlockCount: 1,
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
      coveredBlockCount: 2,
      uncoveredBlockCount: 0,
      acceptancePassed: ['user_can_login', 'user_can_create_customer'],
      uncoveredBlocks: [],
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
      originSummaryCount: 1,
      originSummaries: [
        { originType: 'block', count: 2, paths: ['src/installed/auth/session.ts', 'src/installed/entity/customer.ts'] }
      ],
      overrideSummaryCount: 1,
      overrideSummaries: [
        {
          overrideStatus: 'none',
          count: 2,
          paths: ['src/installed/auth/session.ts', 'src/installed/entity/customer.ts']
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
        { pass: 'compose', count: 1, paths: ['src/installed/entity/customer.ts'] },
        { pass: 'compose', count: 1, paths: ['src/installed/auth/session.ts'] }
      ],
      unverifiedArtifacts: ['src/installed/entity/customer.ts']
    },
    policySummary: {
      status: 'passed',
      sourceReportStatus: 'passed',
      assurance: 'semantic',
      evaluatorProviderId: 'semantic-policy-test-provider',
      evaluatorProviderRevision: 'semantic-policy-test-provider-v1',
      unsupportedSemanticPredicates: [],
      diagnosticCount: 0,
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
      artifactCount: 4,
      governanceCount: 4,
      missingCount: 1,
      testCount: 0,
      contractCount: 0,
      contractPaths: [],
      uploadGroupCount: 1,
      missingReasonTypeCount: 1,
      missingReasonCounts: {
        'declared-generated-missing': 0,
        'fixed-governance-missing': 1,
        'stale-semantic-projection': 0
      },
      uploadGroups: [],
      missing: [
        {
          path: CI_ARTIFACT_FILES.policyReport,
          reason: 'fixed-governance-missing',
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
    impactedBlocks: ['entity/customer-basic'],
    failurePoints: [],
    regressionRisks: [
      {
        kind: 'coverage-gap',
        blockId: 'entity/customer-basic',
        message: 'Block entity/customer-basic requires more acceptance coverage'
      }
    ],
    conflictHints: []
  };

  const artifactManifest: CiArtifactManifest = {
    formatVersion: '2',
    root: 'workspace',
    summary: {
      artifactStatus: 'attention',
      artifactCount: 4,
      governanceCount: 4,
      testCount: 0,
      contractCount: 0,
      contractPaths: [],
      uploadGroupCount: 1,
      missingCount: 1,
      missingReasonTypeCount: 1,
      missingReasonCounts: {
        'declared-generated-missing': 0,
        'fixed-governance-missing': 1,
        'stale-semantic-projection': 0
      }
    },
    artifacts: [],
    uploadGroups: [],
    missing: [
      {
        path: CI_ARTIFACT_FILES.policyReport,
        reason: 'fixed-governance-missing',
        declaredBy: 'artifact-manifest'
      }
    ]
  };

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
    generatedAt: '2026-05-02T00:00:00.000Z'
  });

  expect(overview).toMatchObject({
    workspace: {
      root: '.',
      modelRoot: 'model',
      srcRoot: 'src',
      testsRoot: 'tests',
      prismaRoot: 'prisma',
      secRoot: '.sec',
      artifactsRoot: '.sec/artifacts'
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
      machineArtifacts: expect.arrayContaining([
        { id: 'graph', path: CI_ARTIFACT_FILES.explainGraph },
        { id: 'graph-mermaid', path: CI_ARTIFACT_FILES.explainGraphMermaid },
        { id: 'review', path: CI_ARTIFACT_FILES.reviewSummary },
        { id: 'verification', path: CI_ARTIFACT_FILES.verificationReport }
      ])
    },
    aiContext: {
      appName: 'Customer Admin',
      blockCount: 2,
      graphNodeCount: 3,
      graphEdgeCount: 2,
      generatedPathCount: 2,
      unverifiedArtifactCount: 1,
      priorityReviewFileCount: 2
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
      path: CI_ARTIFACT_FILES.policyReport,
      reasons: ['missing artifact: fixed-governance-missing']
    },
    {
      path: 'block:entity/customer-basic',
      reasons: ['regression risk: coverage-gap']
    },
    {
      path: 'src/installed/entity/customer.ts',
      reasons: ['unverified provenance']
    }
  ]);
  const presentation = {
    explainCommand: platformCommand('explain'),
    verifyCompactCommand: platformCommand('verify', '--json', '--compact'),
    graphArtifactPath: CI_ARTIFACT_FILES.explainGraph,
    reviewArtifactPath: CI_ARTIFACT_FILES.reviewSummary
  };
  expect(formatProjectOverview(overview, presentation)).toContain('Project overview attention');
  expect(formatProjectOverview(overview, presentation)).toContain('Graph: 3 nodes / 2 edges; blocks=2');
  expect(formatProjectOverview(overview, presentation)).toContain(
    'Risks: failures=0; regressions=1; conflicts=0; missingArtifacts=1'
  );
});
