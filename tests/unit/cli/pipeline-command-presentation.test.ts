import { test } from 'bun:test';
import assert from 'node:assert/strict';

import type { PipelineJournal } from '../../../src/adapters/compilation-protocol/journal-types.ts';
import { projectPipelineCompilation, projectPipelineJournal } from '../../../src/application/pipeline-view.ts';
import type { PassStatus } from '../../../src/compiler/contract/pass-status.ts';
import { formatPipelineCompilation, formatPipelineJournal } from '../../../src/entry/cli/pipeline-command-presentation.ts';

function passStatus(): PassStatus {
  return {
    parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', compose: 'succeeded',
    verify: 'succeeded', repair: 'skipped', lock: 'succeeded', emit: 'succeeded'
  };
}

test('compilation display preserves transaction identity, stage order and pass states from immutable minimal input', () => {
  const states: PassStatus = { ...passStatus(), 'build-ir': 'blocked' };
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
  assert.deepEqual(value.completedStages, ['compose', 'verify']);
  assert.equal(value.lock.passStatus.verify, 'succeeded');
});

test('empty journal preserves absent transaction markers', () => {
  const text = formatPipelineJournal(projectPipelineJournal({ formatVersion: '2', transactions: [] }));
  assert.match(text, /Pipeline journal\s+2(?=$|[\s;,])/u);
  assert.match(text, /Active transaction\W+none(?=$|[\s;,])/u);
  assert.match(text, /Last committed transaction\W+none(?=$|[\s;,])/u);
  assert.match(text, /\bTransactions[\s:]+0(?=$|[\s;,])/u);
});

test('journal shows the latest transaction and preserves its observed failure state', () => {
  const journal: PipelineJournal = {
    formatVersion: '2', activeTransactionId: 'active', lastCommittedTransactionId: 'committed',
    transactions: [
      { id: 'old', source: 'api', requestedStages: [], status: 'succeeded', startedAt: 'old', passRecords: [] },
      { id: 'latest', source: 'cli', requestedStages: ['verify'], status: 'failed', startedAt: 'now', passRecords: [
        { passId: 'compose', status: 'succeeded', startedAt: 'then' },
        { passId: 'verify', status: 'failed', startedAt: 'now' }
      ] }
    ]
  };
  const before = JSON.stringify(journal);
  const text = formatPipelineJournal(projectPipelineJournal(journal));
  assert.match(text, /Active transaction\W+active(?=$|[\s;,])/u);
  assert.match(text, /Last committed transaction\W+committed(?=$|[\s;,])/u);
  assert.match(text, /\bTransactions[\s:]+2(?=$|[\s;,])/u);
  assert.match(text, /Latest\W+latest\s+failed(?=$|[\s;,])/u);
  assert.match(text, /Latest[^\n]*source=cli(?=$|[\s;,])/u);
  assert.match(text, /Passes[^\n]*compose=succeeded(?=$|[\s;,])/u);
  assert.match(text, /Passes[^\n]*verify=failed(?=$|[\s;,])/u);
  assert.equal(JSON.stringify(journal), before);
});

test('empty pass records use the existing none marker, not a success inference', () => {
  const journal: PipelineJournal = { formatVersion: '2', transactions: [
    { id: 'pending', source: 'repair', requestedStages: [], status: 'running', startedAt: 'now', passRecords: [] }
  ] };
  const text = formatPipelineJournal(projectPipelineJournal(journal));
  assert.match(text, /Latest\W+pending\s+running(?=$|[\s;,])/u);
  assert.match(text, /Latest[^\n]*source=repair(?=$|[\s;,])/u);
  assert.match(text, /Passes\W+none(?=$|[\s;,])/u);
});
