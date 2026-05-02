import { expect, test } from 'bun:test';

import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { PolicyReport } from '../../platform/shared/types.ts';
import {
  buildPassingReviewReport,
  buildReviewSummaryInTempWorkspace
} from '../helpers/review-fixtures.ts';

test('review summary surfaces policy governance summary', async () => {
  const violation: PolicyReport['violations'][number] = {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: 'tenant_context_must_flow_to_query',
    files: ['src/installed/entity/customer-service.ts'],
    message: 'Entity customer queries must derive tenant context.',
    sourceScope: 'official',
    sourcePath: 'platform/policies/official/policy.spec.yaml'
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
          path: 'platform/policies/official/policy.spec.yaml',
          policyIds: ['tenant-scope-required']
        }
      ],
      violations: []
    },
    project: {
      policies: ['project-only'],
      sources: [
        {
          path: 'project/policies/custom.spec.yaml',
          policyIds: ['project-only', 'tenant-scope-required']
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
          sourcePath: 'platform/policies/official/policy.spec.yaml',
          targets: ['src/installed/entity/customer-service.ts']
        }
      ]
    },
    violations: [violation]
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
    officialPolicyCount: 1,
    projectPolicyCount: 1,
    mergedPolicyCount: 2,
    sourceCount: 2,
    violationCount: 1,
    severityCounts: {
      error: 1
    }
  });
  expect(summary.policySummary?.sourceSummaries).toHaveLength(0);
  expect(summary.policySummary?.mergedSummaries).toHaveLength(0);
  expect(summary.policySummary?.violationSummaries).toHaveLength(0);
});
