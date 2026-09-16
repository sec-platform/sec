import { expect, test } from 'bun:test';

import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE, policySemanticRule } from '../../src/compiler/policies/contract/rules.ts';
import type { PolicyReport } from '../../src/compiler/policies/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { buildReviewPolicySummary } from '../../src/verification/review/contract/policy.ts';
import { writeJson } from '../../src/workspace/files.ts';
import {
  policiesRelativePath,
  posixPath,
  resolveWorkspaceArtifactPath,
  srcRelativePath
} from '../../src/workspace/runtime/paths.ts';
import {
  buildPassingReviewReport,
  buildReviewSummaryInTempWorkspace
} from '../helpers/review-fixtures.ts';

const PROJECT_POLICY_SOURCE = `${posixPath(policiesRelativePath)}/custom.spec.yaml`;
const CUSTOMER_SERVICE_TARGET = `${srcRelativePath}/installed/entity/customer-service.ts`;
const TENANT_FLOW_RULE = TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE;
const TENANT_FLOW_PREDICATE = policySemanticRule(TENANT_FLOW_RULE).requiredPredicate;

test('review summary surfaces semantically assured policy governance failure', async () => {
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
    fast: {
      status: 'failed',
      policy: { status: 'failed', violations: [violation] }
    },
    summary: {
      status: 'failed',
      failedLanes: ['fast']
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
      report
    },
    async (workspaceRoot) => {
      await writeJson(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
        policyReport
      );
    }
  );

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
  expect(summary.policySummary?.sourceSummaries).toHaveLength(2);
  expect(summary.policySummary?.mergedSummaries).toHaveLength(2);
  expect(summary.policySummary?.violationSummaries).toHaveLength(1);
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
