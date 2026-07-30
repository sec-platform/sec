import { expect, test } from 'bun:test';

import { upgradeWorkspace } from '../../platform/orchestrator.ts';
import { readPipelineJournal } from '../../platform/shared/pipeline-journal.ts';
import { withWorkspaceScenario } from '../testkit/workspace.ts';

test('upgrade apply recompiles through one canonical upgrade transaction', async () => {
  await withWorkspaceScenario('locked-all-default', async (workspaceRoot) => {
    const result = await upgradeWorkspace(
      workspaceRoot,
      'auth/basic-session',
      '0.1.1'
    );

    expect(result.upgradePlan.status).toBe('applied');
    expect(result.lock.resolvedBlocks.find((block) => block.id === 'auth/basic-session')?.version).toBe('0.1.1');
    expect(result.lock.passStatus).toMatchObject({
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      'build-ir': 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'succeeded',
      lock: 'succeeded',
      emit: 'pending'
    });

    const journal = await readPipelineJournal(workspaceRoot);
    const upgradeTransaction = [...journal.transactions]
      .reverse()
      .find((transaction) => transaction.source === 'upgrade');
    expect(upgradeTransaction).toMatchObject({
      requestedStages: ['resolve', 'semantic', 'compose', 'adapt', 'verify', 'lock'],
      status: 'succeeded'
    });
    expect(upgradeTransaction?.passRecords.map((entry) => [entry.passId, entry.status])).toEqual([
      ['resolve', 'succeeded'],
      ['build-ir', 'succeeded'],
      ['compose', 'succeeded'],
      ['adapt', 'succeeded'],
      ['verify', 'succeeded'],
      ['lock', 'succeeded']
    ]);
  });
}, 180000);
