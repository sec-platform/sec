import { expect, test } from 'bun:test';

import { writeJson } from "../../../src/adapters/filesystem/files.ts";
import { policiesRelativePath, resolveWorkspaceArtifactPath, srcRelativePath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildReviewPolicySummary } from '../../../src/assurance/verification/review/contract/policy.ts';
import { posixPath } from '../../../src/contracts/relative-path.ts';
import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE, policySemanticRule } from '../../../src/semantics/policies/rules.ts';
import type { PolicyReport } from '../../../src/semantics/policies/types.ts';
import {
  buildPassingReviewReport,
  buildReviewSummaryInTempWorkspace,
  buildRuntimeVerificationReport
} from '../../helpers/review-fixtures.ts';

const PROJECT_POLICY_SOURCE = `${posixPath(policiesRelativePath)}/custom.spec.yaml`;
const CUSTOMER_SERVICE_TARGET = `${srcRelativePath}/installed/entity/customer-service.ts`;
const TENANT_FLOW_RULE = TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE;
const TENANT_FLOW_PREDICATE = policySemanticRule(TENANT_FLOW_RULE).requiredPredicate;

test('review summary preserves coverage, provenance and semantically assured policy failure', async () => {
  const violation: PolicyReport['violations'][number] = {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: TENANT_FLOW_RULE,
    files: [CUSTOMER_SERVICE_TARGET],
    message: 'Entity customer queries violate the canonical tenant data-flow policy.',
    sourceScope: 'official',
    sourcePath: 'catalog/policies/official/policy.spec.yaml'
  };
  const report = buildPassingReviewReport({
    policy: { status: 'failed', violations: [violation] },
    acceptance: { status: 'failed', passed: ['customer_crud'], failed: ['tenant_scope'] },
    fast: {
      status: 'failed',
      acceptance: { status: 'failed', passed: ['customer_crud'],
        failed: ['tests/acceptance/customer-normalizer.test.ts', 'tests/acceptance/customer-normalizer.test.ts'] },
      policy: { status: 'failed', violations: [violation] }
    },
    runtime: buildRuntimeVerificationReport({
      status: 'failed',
      unit: { status: 'failed', failed: ['tests/runtime/unit/customer-runtime.test.ts', 'tests/runtime/unit/customer-runtime.test.ts'] },
      acceptance: { status: 'failed', passed: ['customer_crud'], failed: ['tests/acceptance/customer-flow.test.ts'] }
    }),
    summary: {
      status: 'failed',
      requestedLane: 'all',
      failedLanes: ['fast', 'runtime']
    }
  });
  const policyReport: PolicyReport = {
    status: 'failed',
    official: {
      policies: ['tenant-scope-required'],
      sources: [
        {
          path: 'catalog/policies/official/policy.spec.yaml',
          policyIds: ['tenant-scope-required']
        }
      ],
      violations: [violation]
    },
    project: {
      policies: ['project-only'],
      sources: [
        {
          path: PROJECT_POLICY_SOURCE,
          policyIds: ['project-only']
        }
      ],
      violations: []
    },
    merged: {
      policies: [
        {
          id: 'project-only',
          sourceScope: 'project',
          sourcePath: PROJECT_POLICY_SOURCE,
          targets: [CUSTOMER_SERVICE_TARGET]
        },
        {
          id: 'tenant-scope-required',
          sourceScope: 'official',
          sourcePath: 'catalog/policies/official/policy.spec.yaml',
          targets: [CUSTOMER_SERVICE_TARGET]
        }
      ]
    },
    violations: [violation],
    diagnostics: [],
    evaluation: {
      providerId: 'semantic-policy-test-provider',
      providerRevision: 'semantic-policy-test-provider-v1',
      assurance: 'semantic',
      requiredSemanticPredicates: [TENANT_FLOW_PREDICATE],
      unsupportedSemanticPredicates: []
    }
  };

  const summary = await buildReviewSummaryInTempWorkspace(
    {
      lock: {
        passStatus: {
          verify: 'failed'
        }
      },
      report,
      coverage: {
        formatVersion: '2',
        status: 'failed',
        acceptancePassed: ['customer_crud'],
        blocks: [
          {
            id: 'entity/customer-basic',
            declaredAcceptance: ['customer_crud'],
            coveredBy: ['customer_crud'],
            uncovered: false
          },
          {
            id: 'tenant/basic-workspace',
            declaredAcceptance: ['tenant_scope'],
            coveredBy: [],
            uncovered: true
          }
        ],
        uncoveredBlocks: ['tenant/basic-workspace']
      },
      provenance: [
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
          path: 'src/installed/entity/customer-service.ts',
          originType: 'block',
          originId: 'entity/customer-basic',
          sourceBlock: 'entity/customer-basic',
          generatedByPass: 'compose',
          verifiedBy: [],
          overrideStatus: 'none'
        },
        {
          path: 'app/tickets/page.tsx',
          originType: 'override',
          originId: 'ticket-page-runtime-manual',
          generatedByPass: 'compose',
          verifiedBy: [],
          overrideStatus: 'manual'
        },
        {
          path: CI_ARTIFACT_FILES.reviewSummary,
          originType: 'generated',
          originId: 'review-summary',
          generatedByPass: 'review',
          verifiedBy: [],
          overrideStatus: 'none'
        }
      ]
    },
    async (workspaceRoot) => {
      await writeJson(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
        policyReport
      );
    }
  );

  expect(
    summary.failurePoints.filter(
      (point) => point.message === 'Fast-lane acceptance test failed: tests/acceptance/customer-normalizer.test.ts'
    )
  ).toHaveLength(1);
  expect(
    summary.failurePoints.filter((point) => point.message === 'Runtime unit test failed: tests/runtime/unit/customer-runtime.test.ts')
  ).toHaveLength(1);
  expect(summary.failurePoints).toEqual(
    expect.arrayContaining([
      {
        lane: 'fast',
        kind: 'acceptance',
        artifactPath: CI_ARTIFACT_FILES.verificationReport,
        message: 'Fast-lane acceptance test failed: tests/acceptance/customer-normalizer.test.ts'
      },
      {
        lane: 'runtime',
        kind: 'unit',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime unit tests failed'
      },
      {
        lane: 'runtime',
        kind: 'unit',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime unit test failed: tests/runtime/unit/customer-runtime.test.ts'
      },
      {
        lane: 'runtime',
        kind: 'acceptance',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        message: 'Runtime acceptance test failed: tests/acceptance/customer-flow.test.ts'
      }
    ])
  );
  expect(summary.regressionRisks).toContainEqual({
    kind: 'coverage-gap',
    blockId: 'tenant/basic-workspace',
    message: 'Block tenant/basic-workspace has no runtime acceptance coverage'
  });

  expect(summary.coverageSummary).toMatchObject({
    status: 'failed',
    acceptancePassedCount: 1,
    blockCount: 2,
    coveredBlockCount: 1,
    uncoveredBlockCount: 1,
    acceptancePassed: ['customer_crud'],
    uncoveredBlocks: ['tenant/basic-workspace']
  });
  expect(summary.coverageSummary?.blockSummaries).toEqual([
    {
      id: 'entity/customer-basic',
      declaredAcceptanceCount: 1,
      coveredByCount: 1,
      declaredAcceptance: ['customer_crud'],
      coveredBy: ['customer_crud']
    },
    {
      id: 'tenant/basic-workspace',
      declaredAcceptanceCount: 1,
      coveredByCount: 0,
      declaredAcceptance: ['tenant_scope'],
      coveredBy: []
    }
  ]);

  expect(summary.provenanceSummary).toMatchObject({
    artifactCount: 4,
    verifiedArtifactCount: 1,
    unverifiedArtifactCount: 3,
    overrideArtifactCount: 1,
    registryArtifactCount: 1,
    generatedArtifactCount: 4,
    generatedPassCount: 2,
    originSummaryCount: 3,
    overrideSummaryCount: 2,
    registrySummaryCount: 1,
    unverifiedArtifacts: [
      CI_ARTIFACT_FILES.reviewSummary,
      'app/tickets/page.tsx',
      'src/installed/entity/customer-service.ts'
    ]
  });
  expect(summary.provenanceSummary?.originSummaries).toHaveLength(3);
  expect(summary.provenanceSummary?.overrideSummaries).toHaveLength(2);
  expect(summary.provenanceSummary?.registrySummaries).toHaveLength(1);
  expect(summary.provenanceSummary?.generatedPassSummaries).toHaveLength(2);

  expect(summary.policySummary).toMatchObject({
    status: 'failed',
    sourceReportStatus: 'failed',
    assurance: 'semantic',
    diagnosticCount: 0,
    officialPolicyCount: 1,
    projectPolicyCount: 1,
    mergedPolicyCount: 2,
    sourceCount: 2,
    violationCount: 1,
    severityCounts: {
      error: 1
    }
  });
  expect(summary.policySummary?.sourceSummaries).toEqual([
    { scope: 'official', path: 'catalog/policies/official/policy.spec.yaml', policyIds: ['tenant-scope-required'] },
    { scope: 'project', path: PROJECT_POLICY_SOURCE, policyIds: ['project-only'] }
  ]);
  expect(summary.policySummary?.mergedSummaries.map(({ id, sourceScope, sourcePath, targets }) =>
    ({ id, sourceScope, sourcePath, targets }))).toEqual([
    { id: 'project-only', sourceScope: 'project', sourcePath: PROJECT_POLICY_SOURCE, targets: [CUSTOMER_SERVICE_TARGET] },
    { id: 'tenant-scope-required', sourceScope: 'official', sourcePath: 'catalog/policies/official/policy.spec.yaml', targets: [CUSTOMER_SERVICE_TARGET] }
  ]);
  expect(summary.policySummary?.violationSummaries.map(({ id, severity, sourceScope, sourcePath, files }) =>
    ({ id, severity, sourceScope, sourcePath, files }))).toEqual([
    { id: 'tenant-scope-required', severity: 'error', sourceScope: 'official', sourcePath: 'catalog/policies/official/policy.spec.yaml', files: [CUSTOMER_SERVICE_TARGET] }
  ]);
});

test('review projects source-structure policy evidence as attention rather than passed', () => {
  const report: PolicyReport = {
    status: 'passed',
    official: {
      policies: ['tenant-scope-required'],
      sources: [{
        path: 'catalog/policies/official/policy.spec.yaml',
        policyIds: ['tenant-scope-required']
      }],
      violations: []
    },
    project: { policies: [], sources: [], violations: [] },
    merged: {
      policies: [{
        id: 'tenant-scope-required',
        sourceScope: 'official',
        sourcePath: 'catalog/policies/official/policy.spec.yaml',
        targets: [CUSTOMER_SERVICE_TARGET]
      }]
    },
    violations: [],
    diagnostics: [{
      id: 'tenant-scope-required',
      severity: 'error',
      appliesTo: ['entity/customer-basic'],
      rule: TENANT_FLOW_RULE,
      files: [CUSTOMER_SERVICE_TARGET],
      message: 'Source structure is advisory only.',
      sourceScope: 'official',
      sourcePath: 'catalog/policies/official/policy.spec.yaml',
      evidenceClass: 'source-structure'
    }],
    evaluation: {
      providerId: 'sec-policy-source-structure',
      providerRevision: 'tenant-context-structure-v1',
      assurance: 'source-structure',
      requiredSemanticPredicates: [TENANT_FLOW_PREDICATE],
      unsupportedSemanticPredicates: [TENANT_FLOW_PREDICATE]
    }
  };

  expect(buildReviewPolicySummary(report)).toMatchObject({
    status: 'attention',
    sourceReportStatus: 'passed',
    assurance: 'source-structure',
    evaluatorProviderId: 'sec-policy-source-structure',
    evaluatorProviderRevision: 'tenant-context-structure-v1',
    unsupportedSemanticPredicates: [TENANT_FLOW_PREDICATE],
    diagnosticCount: 1,
    violationCount: 0
  });
});
