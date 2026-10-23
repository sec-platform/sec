import { expect, test } from 'bun:test';

import {
  buildReviewSummaryInTempWorkspace,
  buildRuntimeVerificationReport
} from '../../helpers/review-fixtures.ts';

test('review summary surfaces acceptance coverage summary', async () => {
  const summary = await buildReviewSummaryInTempWorkspace({
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
    }
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
});
