import { expect, test } from 'bun:test';

import { writeJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { buildReviewPolicySummary } from '../../src/verification/review/contract/policy.ts';
import type { PolicyReport } from '../../src/compiler/policies/contract/types.ts';
import {
  buildPassingReviewReport,
  buildReviewSummaryInTempWorkspace
} from '../helpers/review-fixtures.ts';

test('review summary surfaces semantically assured policy governance failure', async () => {
  const violation: PolicyReport['violations'][number] = {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: 'tenant_context_must_flow_to_query',
    files: ['src/installed/entity/customer-service.ts'],
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
          path: 'project/policies/custom.spec.yaml',
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
          sourcePath: 'project/policies/custom.spec.yaml',
          targets: ['custom/customer_normalizer.ts']
        },
        {
          id: 'tenant-scope-required',
          sourceScope: 'official',
          sourcePath: 'catalog/policies/official/policy.spec.yaml',
          targets: ['src/installed/entity/customer-service.ts']
        }
      ]
    },
    violations: [violation],
    diagnostics: [],
    evaluation: {
      providerId: 'semantic-policy-test-provider',
      providerRevision: 'semantic-policy-test-provider-v1',
      assurance: 'semantic',
      requiredSemanticPredicates: ['FLOWS_TO'],
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
      const { policyReportPath } = getWorkspacePaths(workspaceRoot);
      await writeJson(policyReportPath, policyReport);
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
        targets: ['src/installed/entity/customer-service.ts']
      }]
    },
    violations: [],
    diagnostics: [{
      id: 'tenant-scope-required',
      severity: 'error',
      appliesTo: ['entity/customer-basic'],
      rule: 'tenant_context_must_flow_to_query',
      files: ['src/installed/entity/customer-service.ts'],
      message: 'Source structure is advisory only.',
      sourceScope: 'official',
      sourcePath: 'catalog/policies/official/policy.spec.yaml',
      evidenceClass: 'source-structure'
    }],
    evaluation: {
      providerId: 'sec-policy-source-structure',
      providerRevision: 'tenant-context-structure-v1',
      assurance: 'source-structure',
      requiredSemanticPredicates: ['FLOWS_TO'],
      unsupportedSemanticPredicates: ['FLOWS_TO']
    }
  };

  expect(buildReviewPolicySummary(report)).toMatchObject({
    status: 'attention',
    sourceReportStatus: 'passed',
    assurance: 'source-structure',
    evaluatorProviderId: 'sec-policy-source-structure',
    evaluatorProviderRevision: 'tenant-context-structure-v1',
    unsupportedSemanticPredicates: ['FLOWS_TO'],
    diagnosticCount: 1,
    violationCount: 0
  });
});
