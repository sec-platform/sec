import { expect, test } from 'vitest';

import { buildReviewSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type {
  PolicyReport,
  VerificationReport
} from '../../platform/shared/types.ts';
import { buildReviewInputs, withTempWorkspace } from '../helpers/test-utils.ts';

test('review summary surfaces policy governance summary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { policyReportPath } = getWorkspacePaths(workspaceRoot);
    const { lock, provenance, coverage } = buildReviewInputs({
      lock: {
        passStatus: {
          verify: 'failed'
        }
      }
    });
    const report: VerificationReport = {
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: {
        status: 'failed',
        violations: [
          {
            id: 'tenant-scope-required',
            severity: 'error',
            appliesTo: ['entity/customer-basic'],
            rule: 'tenant_context_must_flow_to_query',
            files: ['src/installed/entity/customer-service.ts'],
            message: 'Entity customer queries must derive tenant context.',
            sourceScope: 'official',
            sourcePath: 'platform/policies/official/policy.spec.yaml'
          }
        ]
      },
      fast: {
        status: 'failed',
        build: { status: 'passed' },
        unit: { status: 'passed', passed: [] },
        acceptance: { status: 'passed', passed: [], failed: [] },
        policy: {
          status: 'failed',
          violations: [
            {
              id: 'tenant-scope-required',
              severity: 'error',
              appliesTo: ['entity/customer-basic'],
              rule: 'tenant_context_must_flow_to_query',
              files: ['src/installed/entity/customer-service.ts'],
              message: 'Entity customer queries must derive tenant context.',
              sourceScope: 'official',
              sourcePath: 'platform/policies/official/policy.spec.yaml'
            }
          ]
        },
        logs: { stdout: '', stderr: '' }
      },
      runtime: {
        status: 'skipped',
        build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
        unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
        acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
        logs: { stdout: '', stderr: '' }
      },
      summary: {
        status: 'failed',
        requestedLane: 'fast',
        failedLanes: ['fast']
      },
      logs: { stdout: '', stderr: '' }
    };
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
      violations: [
        {
          id: 'tenant-scope-required',
          severity: 'error',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query',
          files: ['src/installed/entity/customer-service.ts'],
          message: 'Entity customer queries must derive tenant context.',
          sourceScope: 'official',
          sourcePath: 'platform/policies/official/policy.spec.yaml'
        }
      ]
    };
    await writeJson(policyReportPath, policyReport);

    const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

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
    expect(summary.policySummary?.sourceSummaries).toEqual([
      {
        scope: 'official',
        path: 'platform/policies/official/policy.spec.yaml',
        policyIds: ['tenant-scope-required']
      },
      {
        scope: 'project',
        path: 'project/policies/custom.spec.yaml',
        policyIds: ['project-only', 'tenant-scope-required']
      }
    ]);
    expect(summary.policySummary?.mergedSummaries).toEqual([
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
    ]);
    expect(summary.policySummary?.violationSummaries).toEqual([
      {
        id: 'tenant-scope-required',
        severity: 'error',
        rule: 'tenant_context_must_flow_to_query',
        fileCount: 1,
        files: ['src/installed/entity/customer-service.ts'],
        appliesTo: ['entity/customer-basic'],
        message: 'Entity customer queries must derive tenant context.',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml'
      }
    ]);
  });
});
