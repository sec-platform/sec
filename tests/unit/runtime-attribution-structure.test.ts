import { expect, test } from 'bun:test';

import {
  buildRuntimeAttributions,
  detectVerticalFromPath
} from '../../platform/compiler/emit/runtime-attribution.ts';
import type { LockFile } from '../../platform/shared/types.ts';
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
        from: 'files/app/tickets/page.tsx',
        to: 'app/tickets/page.tsx'
      }),
      buildOfficialCopyInstallStep({
        stepId: 'export/csv-basic:2',
        blockId: 'export/csv-basic',
        sourceRoot: 'export.csv-basic',
        from: 'files/app/api/tickets/export/route.ts',
        to: 'app/api/tickets/export/route.ts'
      }),
      buildOfficialCopyInstallStep({
        stepId: 'reporting/ticket-summary:3',
        blockId: 'reporting/ticket-summary',
        sourceRoot: 'reporting.ticket-summary',
        from: 'files/app/api/tickets/summary/route.ts',
        to: 'app/api/tickets/summary/route.ts'
      })
    ]
  } as unknown as LockFile;
}

test('runtime attribution uses exact install owner and manifest capability dependency closure', async () => {
  const entries = await buildRuntimeAttributions(attributionLock(), [
    'app/tickets/page.tsx',
    'app/api/tickets/export/route.ts',
    'app/api/tickets/summary/route.ts',
    'app/api/tickets/summary/export/route.ts'
  ]);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  expect(byPath.get('app/tickets/page.tsx')).toEqual({
    path: 'app/tickets/page.tsx',
    kind: 'page',
    vertical: 'ticket',
    relatedBlocks: ['ticket/basic']
  });
  expect(byPath.get('app/api/tickets/summary/route.ts')).toEqual({
    path: 'app/api/tickets/summary/route.ts',
    kind: 'api',
    vertical: 'ticket',
    relatedBlocks: ['reporting/ticket-summary', 'ticket/basic']
  });
  expect(byPath.get('app/api/tickets/export/route.ts')).toEqual({
    path: 'app/api/tickets/export/route.ts',
    kind: 'api',
    vertical: 'customer',
    relatedBlocks: ['export/csv-basic']
  });
  expect(byPath.get('app/api/tickets/summary/export/route.ts')).toEqual({
    path: 'app/api/tickets/summary/export/route.ts',
    kind: 'api',
    relatedBlocks: []
  });
});

test('path text alone cannot mint a runtime vertical', () => {
  expect(detectVerticalFromPath('app/api/tickets/summary/export/route.ts')).toBeNull();
  expect(detectVerticalFromPath('ticket/basic')).toBeNull();
  expect(detectVerticalFromPath('customer worklog ticket')).toBeNull();
});
