import { expect, test } from 'bun:test';

import {
  initWorkspace,
  startWorkbenchServer
} from '../../platform/orchestrator.ts';
import { readLockFile } from '../../platform/shared/lock-utils.ts';
import { readPipelineJournal } from '../../platform/shared/pipeline-journal.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Exact current-head validation for the Workbench compile stream.
test('workbench compile SSE uses one all-lane canonical pipeline transaction', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });
    const server = await startWorkbenchServer(workspaceRoot, 0);
    const port = server.port ?? 0;

    try {
      const response = await fetch(`http://localhost:${port}/api/compile`, {
        method: 'POST'
      });
      expect(response.status).toBe(200);
      const stream = await response.text();
      expect(stream).toContain('event: success');
      expect(stream).toContain('[transaction-start]');
      expect(stream).toContain('[pass-success] Pass verify succeeded');

      const journal = await readPipelineJournal(workspaceRoot);
      const transaction = journal.transactions.at(-1);
      expect(transaction).toMatchObject({
        source: 'workbench',
        requestedStages: ['resolve', 'compose', 'adapt', 'verify', 'lock', 'emit'],
        status: 'succeeded'
      });
      expect(transaction?.passRecords.map((entry) => [entry.passId, entry.status])).toEqual([
        ['resolve', 'succeeded'],
        ['compose', 'succeeded'],
        ['adapt', 'succeeded'],
        ['verify', 'succeeded'],
        ['lock', 'succeeded'],
        ['emit', 'succeeded']
      ]);

      const lock = await readLockFile(workspaceRoot);
      expect(lock.passStatus.verify).toBe('succeeded');
      expect(lock.passStatus.lock).toBe('succeeded');
      expect(lock.passStatus.emit).toBe('succeeded');
    } finally {
      server.stop();
    }
  }, 'engineering-compiler-workbench-pipeline-');
}, 120000);
