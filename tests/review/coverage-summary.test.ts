import { expect, test } from 'vitest';

import { buildReviewSummaryFromInputs, buildRuntimeVerificationReport } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../helpers/test-utils.ts';

test('review summary surfaces acceptance coverage summary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot, {
      lock: {
        passStatus: {
          verify: 'failed'
        }
      },
      report: {
        acceptance: { status: 'failed', passed: ['customer_crud'], failed: ['tenant_scope'] },
        fast: {
          acceptance: { status: 'passed', passed: ['customer_crud'], failed: [] }
        },
        runtime: buildRuntimeVerificationReport({
          status: 'failed',
          acceptance: {
            status: 'failed',
            passed: ['customer_crud'],
            failed: ['tenant_scope']
          }
        }),
        summary: {
          status: 'failed',
          requestedLane: 'all',
          failedLanes: ['runtime']
        }
      },
      coverage: {
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
      }
    });

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
  });
});
