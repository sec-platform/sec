import { test } from 'bun:test';
import assert from 'node:assert/strict';

import type { PipelineJournal } from '../../../src/adapters/compilation-protocol/journal-types.ts';
import { projectPipelineCompilation, projectPipelineJournal } from '../../../src/application/pipeline-view.ts';
import type { PassStatus } from '../../../src/compiler/contract/pass-status.ts';
import { formatPipelineCompilation, formatPipelineJournal } from '../../../src/entry/cli/pipeline-command-presentation.ts';

test('compilation display preserves transaction identity, stage order and pass states from immutable minimal input', () => {
  const states: PassStatus = {
    parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', compose: 'succeeded',
    verify: 'succeeded', repair: 'skipped', lock: 'succeeded', emit: 'succeeded', 'build-ir': 'blocked'
  };
  const value = Object.freeze({
    transactionId: 'tx-123',
    completedStages: Object.freeze(['compose', 'verify'] as const),
    lock: Object.freeze({ passStatus: Object.freeze(states) })
  });
  const text = formatPipelineCompilation(projectPipelineCompilation(value));
  assert.match(text, /Compilation transaction\s+tx-123\s+succeeded(?=$|[\s;,])/u);
  assert.match(text, /Stages\W+compose(?=$|[\s;,])[^\n]*verify(?=$|[\s;,])/u);
  for (const field of ['parse=succeeded', 'align=succeeded', 'resolve=succeeded', 'compose=succeeded',
    'verify=succeeded', 'repair=skipped', 'lock=succeeded', 'emit=succeeded', 'build-ir=blocked']) {
    assert.match(text, new RegExp(`Lock[^\\n]*\\b${field}(?=$|[\\s;,])`, 'u'));
  }
});

test('journal preserves empty markers, latest failure and pending pass records', () => {
  {
    const text = formatPipelineJournal(projectPipelineJournal({ formatVersion: '2', transactions: [] }));
    assert.match(text, /Pipeline journal\s+2(?=$|[\s;,])/u);
    assert.match(text, /Active transaction\W+none(?=$|[\s;,])/u);
    assert.match(text, /Last committed transaction\W+none(?=$|[\s;,])/u);
    assert.match(text, /\bTransactions[\s:]+0(?=$|[\s;,])/u);
  }
  const startedAt = '2026-08-30T12:11:08.064Z';
  const completedAt = '2026-08-30T12:12:41.953Z';
  const journal: PipelineJournal = {
    formatVersion: '2', lastCommittedTransactionId: 'committed',
    transactions: [
      { id: 'committed', source: 'api', requestedStages: ['resolve'], status: 'succeeded', startedAt, completedAt, passRecords: [] },
      { id: 'latest', source: 'cli', requestedStages: ['compose', 'verify'], status: 'failed', startedAt, completedAt, passRecords: [
        { passId: 'compose', status: 'succeeded', startedAt, completedAt },
        { passId: 'verify', status: 'failed', startedAt, completedAt }
      ] }
    ]
  };
  const before = JSON.stringify(journal);
  const text = formatPipelineJournal(projectPipelineJournal(journal));
  assert.match(text, /Last committed transaction\W+committed(?=$|[\s;,])/u);
  assert.match(text, /\bTransactions[\s:]+2(?=$|[\s;,])/u);
  assert.match(text, /Latest\W+latest\s+failed(?=$|[\s;,])/u);
  assert.match(text, /Latest[^\n]*source=cli(?=$|[\s;,])/u);
  assert.match(text, /Passes[^\n]*compose=succeeded(?=$|[\s;,])/u);
  assert.match(text, /Passes[^\n]*verify=failed(?=$|[\s;,])/u);
  assert.equal(JSON.stringify(journal), before);

  const pending: PipelineJournal = { formatVersion: '2', activeTransactionId: 'pending', transactions: [
    { id: 'pending', source: 'repair', requestedStages: ['verify'], status: 'running', startedAt, passRecords: [] }
  ] };
  const pendingText = formatPipelineJournal(projectPipelineJournal(pending));
  assert.match(pendingText, /Active transaction\W+pending(?=$|[\s;,])/u);
  assert.match(pendingText, /Latest\W+pending\s+running(?=$|[\s;,])/u);
  assert.match(pendingText, /Latest[^\n]*source=repair(?=$|[\s;,])/u);
  assert.match(pendingText, /Passes\W+none(?=$|[\s;,])/u);
});
