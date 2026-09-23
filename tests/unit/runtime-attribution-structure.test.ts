import { expect, test } from 'bun:test';

import { buildRuntimeAttributions } from '../../src/adapters/compilation/emit/runtime-attribution.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import {
  buildOfficialCopyInstallStep,
  buildOfficialResolvedBlock
} from '../helpers/lock-fixtures.ts';

function attributionLock(): LockFile {
  return {
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
      })
    ]
  } as unknown as LockFile;
}

test('runtime attribution uses exact install owner and manifest capability dependency closure', async () => {
  const entries = await buildRuntimeAttributions(attributionLock(), [
    'src/installed/ticket/ticket-service.ts',
    'src/installed/export/customer-csv.ts',
    'src/installed/reporting/ticket-summary.ts',
    'src/installed/composed/ticket-export.ts'
  ]);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  expect(byPath.get('src/installed/ticket/ticket-service.ts')).toEqual({
    path: 'src/installed/ticket/ticket-service.ts',
    kind: 'service',
    vertical: 'ticket',
    relatedBlocks: ['ticket/basic']
  });
  expect(byPath.get('src/installed/reporting/ticket-summary.ts')).toEqual({
    path: 'src/installed/reporting/ticket-summary.ts',
    kind: 'service',
    vertical: 'ticket',
    relatedBlocks: ['reporting/ticket-summary', 'ticket/basic']
  });
  expect(byPath.get('src/installed/export/customer-csv.ts')).toEqual({
    path: 'src/installed/export/customer-csv.ts',
    kind: 'service',
    vertical: 'customer',
    relatedBlocks: ['export/csv-basic']
  });
  expect(byPath.get('src/installed/composed/ticket-export.ts')).toEqual({
    path: 'src/installed/composed/ticket-export.ts',
    kind: 'service',
    relatedBlocks: []
  });
});
