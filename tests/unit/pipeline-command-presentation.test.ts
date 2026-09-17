import { test } from 'bun:test';
import assert from 'node:assert/strict';

import type { PassStatus } from '../../src/compiler/contract/pass-status.ts';
import type { PipelineJournal } from '../../src/adapters/compilation-protocol/journal-types.ts';
import { formatPipelineCompilation, formatPipelineJournal } from '../../src/bootstrap/cli/pipeline-command-presentation.ts';

function passStatus(): PassStatus {
  return {
    parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', compose: 'succeeded',
    verify: 'succeeded', repair: 'skipped', lock: 'succeeded', emit: 'succeeded'
  };
}

test('compilation display preserves result order and legacy text byte-for-byte', () => {
  const value = { transactionId: 'tx-123', completedStages: ['compose', 'verify'] as ['compose', 'verify'], lock: { passStatus: passStatus() } };
  assert.equal(formatPipelineCompilation(value), [
    'Compilation transaction tx-123 succeeded', 'Stages: compose -> verify',
    'Lock: parse=succeeded, align=succeeded, resolve=succeeded, compose=succeeded, verify=succeeded, repair=skipped, lock=succeeded, emit=succeeded'
  ].join('\n'));
  assert.deepEqual(value.completedStages, ['compose', 'verify']);
});

test('empty journal preserves absent transaction markers', () => {
  assert.equal(formatPipelineJournal({ formatVersion: '2', transactions: [] }), [
    'Pipeline journal 2', 'Active transaction: none', 'Last committed transaction: none', 'Transactions: 0'
  ].join('\n'));
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
  assert.equal(formatPipelineJournal(journal), [
    'Pipeline journal 2', 'Active transaction: active', 'Last committed transaction: committed', 'Transactions: 2',
    'Latest: latest failed source=cli', 'Passes: compose=succeeded, verify=failed'
  ].join('\n'));
  assert.equal(JSON.stringify(journal), before);
});

test('empty pass records use the existing none marker, not a success inference', () => {
  const journal: PipelineJournal = { formatVersion: '2', transactions: [
    { id: 'pending', source: 'repair', requestedStages: [], status: 'running', startedAt: 'now', passRecords: [] }
  ] };
  assert.match(formatPipelineJournal(journal), /Latest: pending running source=repair\nPasses: none$/);
});

test('presentation accepts an immutable minimal result without compiler-internal fields', () => {
  const value = Object.freeze({
    transactionId: 'minimal',
    completedStages: Object.freeze(['verify'] as const),
    lock: Object.freeze({ passStatus: Object.freeze(passStatus()) })
  });
  assert.match(formatPipelineCompilation(value), /^Compilation transaction minimal succeeded\nStages: verify\nLock: /);
  assert.equal(value.lock.passStatus.verify, 'succeeded');
});

test('optional build-ir pass state is displayed rather than silently dropped', () => {
  const states: PassStatus = { ...passStatus(), 'build-ir': 'blocked' };
  const rendered = formatPipelineCompilation({ transactionId: 'partial', completedStages: [], lock: { passStatus: states } });
  assert.match(rendered, /, build-ir=blocked$/);
});

test('journal rendering preserves present empty identities rather than treating them as absent', () => {
  const journal: PipelineJournal = {
    formatVersion: '2', activeTransactionId: '', lastCommittedTransactionId: '', transactions: []
  };
  assert.equal(formatPipelineJournal(journal), [
    'Pipeline journal 2', 'Active transaction: ', 'Last committed transaction: ', 'Transactions: 0'
  ].join('\n'));
});
