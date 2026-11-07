import { expect, test } from 'bun:test';

import { buildReviewSummary } from '../../../src/adapters/compilation/emit/write-review-summary.ts';
import { buildOfficialCopyInstallStep, buildOfficialResolvedBlock } from '../../helpers/lock-fixtures.ts';
import { buildReviewInputs, buildRuntimeVerificationReport } from '../../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('runtime attribution uses exact install owner and manifest capability dependency closure', async () => withTempWorkspace(async workspaceRoot => {
  const { lock, provenance, coverage, report } = buildReviewInputs({
    lock: {
      app: { stack: 'typescript-library' },
      resolvedBlocks: [
        buildOfficialResolvedBlock({ id: 'ticket/basic', installOrder: 1 }),
        buildOfficialResolvedBlock({ id: 'export/csv-basic', installOrder: 2 }),
        buildOfficialResolvedBlock({ id: 'reporting/ticket-summary', installOrder: 3 })
      ],
      installPlan: [
        buildOfficialCopyInstallStep({
          stepId: 'ticket/basic:1',
          blockId: 'ticket/basic',
          sourceRoot: 'ticket.basic',
          from: 'files/src/installed/ticket/ticket-service.ts',
          to: 'src/installed/ticket/ticket-service.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'export/csv-basic:2',
          blockId: 'export/csv-basic',
          sourceRoot: 'export.csv-basic',
          from: 'files/src/installed/export/customer-csv.ts',
          to: 'src/installed/export/customer-csv.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'reporting/ticket-summary:3',
          blockId: 'reporting/ticket-summary',
          sourceRoot: 'reporting.ticket-summary',
          from: 'files/src/installed/reporting/ticket-summary.ts',
          to: 'src/installed/reporting/ticket-summary.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'reporting/ticket-summary:4',
          blockId: 'reporting/ticket-summary',
          sourceRoot: 'reporting.ticket-summary',
          from: 'files/src/installed/reporting/ticket-summary.ts',
          to: 'src/installed/reporting/ticket-summary.ts'
        })
      ],
      generatedPaths: [
        'src/installed/ticket/ticket-service.ts',
        'src/installed/ticket/ticket-command.ts',
        'src/installed/export/customer-csv.ts',
        'src/installed/reporting/ticket-summary.ts',
        'src/installed/composed/ticket-export.ts'
      ],
      passStatus: { lock: 'succeeded' }
    },
    provenance: [
      {
        path: 'src/installed/export/customer-csv.ts',
        originType: 'generated',
        originId: 'src/installed/export/customer-csv.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      },
      {
        path: 'src/installed/ticket/ticket-service.ts',
        originType: 'generated',
        originId: 'src/installed/ticket/ticket-service.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      },
      {
        path: 'src/installed/reporting/ticket-summary.ts',
        originType: 'generated',
        originId: 'src/installed/reporting/ticket-summary.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      },
      {
        path: 'src/installed/composed/ticket-export.ts',
        originType: 'generated',
        originId: 'src/installed/composed/ticket-export.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      }
    ],
    report: {
      runtime: buildRuntimeVerificationReport(),
      summary: {
        requestedLane: 'all'
      }
    }
  });

  const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

  expect(summary).toMatchObject({
    changeSourceCount: 4,
    runtimeEntryCount: 4,
    installImpactCount: 3
  });
  expect(summary.runtimeEntries).toEqual([
    {
      path: 'src/installed/composed/ticket-export.ts',
      kind: 'service',
      relatedBlocks: []
    },
    {
      path: 'src/installed/export/customer-csv.ts',
      kind: 'service',
      vertical: 'customer',
      relatedBlocks: ['export/csv-basic']
    },
    {
      path: 'src/installed/reporting/ticket-summary.ts',
      kind: 'service',
      vertical: 'ticket',
      relatedBlocks: ['reporting/ticket-summary', 'ticket/basic']
    },
    {
      path: 'src/installed/ticket/ticket-service.ts',
      kind: 'service',
      vertical: 'ticket',
      relatedBlocks: ['ticket/basic']
    }
  ]);
  expect(summary.verticalSlices).toEqual([
    {
      id: 'customer',
      runtimeEntries: ['src/installed/export/customer-csv.ts'],
      relatedBlocks: ['export/csv-basic']
    },
    {
      id: 'ticket',
      runtimeEntries: ['src/installed/reporting/ticket-summary.ts', 'src/installed/ticket/ticket-service.ts'],
      relatedBlocks: ['reporting/ticket-summary', 'ticket/basic']
    }
  ]);
  expect(summary.installImpacts).toEqual([
    {
      blockId: 'export/csv-basic',
      actionKinds: ['copy'],
      sourceRoots: ['export.csv-basic'],
      targetPaths: ['src/installed/export/customer-csv.ts'],
      verticals: [],
      runtimeEntries: ['src/installed/export/customer-csv.ts']
    },
    {
      blockId: 'reporting/ticket-summary',
      actionKinds: ['copy'],
      sourceRoots: ['reporting.ticket-summary'],
      targetPaths: ['src/installed/reporting/ticket-summary.ts'],
      verticals: [],
      runtimeEntries: ['src/installed/reporting/ticket-summary.ts']
    },
    {
      blockId: 'ticket/basic',
      actionKinds: ['copy'],
      sourceRoots: ['ticket.basic'],
      targetPaths: ['src/installed/ticket/ticket-service.ts'],
      verticals: [],
      runtimeEntries: ['src/installed/ticket/ticket-service.ts']
    }
  ]);
  expect(summary.installImpactSummary).toEqual({
    impactCount: 3,
    blockCount: 3,
    actionKindCount: 1,
    sourceRootCount: 3,
    targetPathCount: 3,
    verticalCount: 0,
    runtimeEntryCount: 3,
    groupCount: 1,
    blocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic'],
    actionKinds: ['copy'],
    sourceRoots: ['export.csv-basic', 'reporting.ticket-summary', 'ticket.basic'],
    targetPaths: [
      'src/installed/export/customer-csv.ts',
      'src/installed/reporting/ticket-summary.ts',
      'src/installed/ticket/ticket-service.ts'
    ],
    verticals: [],
    runtimeEntries: [
      'src/installed/export/customer-csv.ts',
      'src/installed/reporting/ticket-summary.ts',
      'src/installed/ticket/ticket-service.ts'
    ],
    groupSummaries: [
      {
        vertical: 'none',
        blockCount: 3,
        actionKindCount: 1,
        runtimeEntryCount: 3,
        targetPathCount: 3,
        blocks: ['export/csv-basic', 'reporting/ticket-summary', 'ticket/basic'],
        actionKinds: ['copy'],
        runtimeEntries: [
          'src/installed/export/customer-csv.ts',
          'src/installed/reporting/ticket-summary.ts',
          'src/installed/ticket/ticket-service.ts'
        ],
        targetPaths: [
          'src/installed/export/customer-csv.ts',
          'src/installed/reporting/ticket-summary.ts',
          'src/installed/ticket/ticket-service.ts'
        ]
      }
    ]
  });
  expect(summary.changeSources.find((source) => source.path === 'src/installed/composed/ticket-export.ts')).toEqual({
    path: 'src/installed/composed/ticket-export.ts',
    originType: 'generated',
    originId: 'src/installed/composed/ticket-export.ts',
    runtimeKind: 'service',
    relatedBlocks: []
  });
}, 'engineering-compiler-review-ticket-attribution-'), 180000);
