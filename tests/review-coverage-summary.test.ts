import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildReviewSummary } from '../platform/compiler/emit/write-review-summary.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  VerificationReport
} from '../platform/shared/types.ts';

test('review summary surfaces acceptance coverage summary', async () => {
  const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, 'engineering-compiler-review-coverage-'));

  try {
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs-ts-prisma-sqlite',
        mode: 'single-tenant'
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'failed',
        repair: 'skipped',
        lock: 'pending',
        emit: 'pending'
      }
    };
    const provenance: ProvenanceFile = {
      formatVersion: '1',
      artifacts: []
    };
    const report: VerificationReport = {
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'failed', passed: ['customer_crud'], failed: ['tenant_scope'] },
      policy: { status: 'passed', violations: [] },
      fast: {
        status: 'passed',
        build: { status: 'passed' },
        unit: { status: 'passed', passed: [] },
        acceptance: { status: 'passed', passed: ['customer_crud'], failed: [] },
        policy: { status: 'passed', violations: [] },
        logs: { stdout: '', stderr: '' }
      },
      runtime: {
        status: 'failed',
        build: { status: 'passed', passed: [], failed: [], command: 'npm run build' },
        unit: { status: 'passed', passed: [], failed: [], command: 'npm run test:unit' },
        acceptance: {
          status: 'failed',
          passed: ['customer_crud'],
          failed: ['tenant_scope'],
          command: 'npm run test:acceptance'
        },
        logs: { stdout: '', stderr: '' }
      },
      summary: {
        status: 'failed',
        requestedLane: 'all',
        failedLanes: ['runtime']
      },
      logs: { stdout: '', stderr: '' }
    };
    const coverage: AcceptanceCoverageReport = {
      formatVersion: '1',
      status: 'failed',
      acceptancePassed: ['customer_crud'],
      blocks: [
        {
          id: 'entity/customer-basic',
          declaredAcceptance: ['customer_crud', 'tenant_scope'],
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
      slots: [
        {
          id: 'customer_normalizer',
          declaredAcceptance: ['customer_crud'],
          coveredBy: ['customer_crud'],
          uncovered: false
        },
        {
          id: 'tenant_context_provider',
          declaredAcceptance: ['tenant_scope'],
          coveredBy: [],
          uncovered: true
        }
      ],
      uncoveredBlocks: ['tenant/basic-workspace'],
      uncoveredSlots: ['tenant_context_provider']
    };

    const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(summary.coverageSummary).toMatchObject({
      status: 'failed',
      acceptancePassedCount: 1,
      blockCount: 2,
      slotCount: 2,
      coveredBlockCount: 1,
      coveredSlotCount: 1,
      uncoveredBlockCount: 1,
      uncoveredSlotCount: 1,
      acceptancePassed: ['customer_crud'],
      uncoveredBlocks: ['tenant/basic-workspace'],
      uncoveredSlots: ['tenant_context_provider']
    });
    expect(summary.coverageSummary?.blockSummaries).toEqual([
      {
        id: 'entity/customer-basic',
        declaredAcceptanceCount: 2,
        coveredByCount: 1,
        declaredAcceptance: ['customer_crud', 'tenant_scope'],
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
    expect(summary.coverageSummary?.slotSummaries).toEqual([
      {
        id: 'customer_normalizer',
        declaredAcceptanceCount: 1,
        coveredByCount: 1,
        declaredAcceptance: ['customer_crud'],
        coveredBy: ['customer_crud']
      },
      {
        id: 'tenant_context_provider',
        declaredAcceptanceCount: 1,
        coveredByCount: 0,
        declaredAcceptance: ['tenant_scope'],
        coveredBy: []
      }
    ]);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
