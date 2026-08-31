import { expect, test } from 'bun:test';

import {
  SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
  SecDurableExecutionContractError,
  encodeDurableExecutionRecord,
  observeDurableExecutionJournal,
  parseDurableExecutionJournal,
  parseDurableExecutionRecord,
  sealDurableExecutionRecord,
  type SecDurableExecutionDigest,
  type SecDurableExecutionRecord
} from './contract.ts';

const digest = (value: string): SecDurableExecutionDigest =>
  `sha256:${value.padStart(64, '0')}` as SecDurableExecutionDigest;

function fixtureRecords(): readonly SecDurableExecutionRecord[] {
  const operationKeyDigest = digest('1');
  const runIdDigest = digest('2');
  const intent = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'intent',
    sequence: 0,
    operationKeyDigest,
    runIdDigest,
    intentReferenceDigest: digest('3'),
    previousRecordDigest: null
  });
  const start = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-start',
    sequence: 1,
    operationKeyDigest,
    runIdDigest,
    previousRecordDigest: intent.recordDigest,
    resumeEpochDigest: digest('4'),
    attemptNonceDigest: digest('5'),
    workerIdentityDigest: digest('6'),
    authorityGrantReferenceDigest: digest('7'),
    providerBindingSetReferenceDigest: digest('8'),
    executionPlanReferenceDigest: digest('9')
  });
  const readback = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'domain-readback-reference',
    sequence: 2,
    operationKeyDigest,
    runIdDigest,
    previousRecordDigest: start.recordDigest,
    attemptNonceDigest: start.attemptNonceDigest,
    readbackClass: 'succeeded',
    domainReadbackReferenceDigest: digest('a')
  });
  const terminal = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'terminal',
    sequence: 3,
    operationKeyDigest,
    runIdDigest,
    previousRecordDigest: readback.recordDigest,
    attemptNonceDigest: start.attemptNonceDigest,
    terminalClass: 'succeeded',
    terminalReferenceDigest: digest('b'),
    providerSettlementRecordDigest: null,
    domainReadbackRecordDigest: readback.recordDigest
  });
  return Object.freeze([intent, start, readback, terminal]);
}

test('lost provider handle can settle only through conclusive domain readback observation', () => {
  const records = fixtureRecords();
  const source = records.map((record) => `${encodeDurableExecutionRecord(record)}\n`).join('');
  const observation = parseDurableExecutionJournal(source);

  expect(observation.intent.operationKeyDigest).toBe(digest('1'));
  expect(observation.records[1]).toMatchObject({
    kind: 'attempt-start',
    runIdDigest: digest('2'),
    resumeEpochDigest: digest('4'),
    attemptNonceDigest: digest('5'),
    workerIdentityDigest: digest('6')
  });
  expect(observation.latestTerminal).toMatchObject({
    terminalClass: 'succeeded',
    providerSettlementRecordDigest: null,
    domainReadbackRecordDigest: records[2]!.recordDigest
  });
  expect(observation.activeAttempt).toBeNull();
});

test('recovery-required preserves an unresolved active attempt without claiming an outcome', () => {
  const [intent, start] = fixtureRecords();
  const terminal = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'terminal',
    sequence: 2,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: intent.runIdDigest,
    previousRecordDigest: start!.recordDigest,
    attemptNonceDigest: start!.kind === 'attempt-start' ? start.attemptNonceDigest : digest('0'),
    terminalClass: 'recovery-required',
    terminalReferenceDigest: digest('c'),
    providerSettlementRecordDigest: null,
    domainReadbackRecordDigest: null
  });
  const observation = observeDurableExecutionJournal([intent, start!, terminal]);

  expect(observation.latestTerminal?.terminalClass).toBe('recovery-required');
  expect(observation.latestTerminal?.domainReadbackRecordDigest).toBeNull();

  const retry = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-start',
    sequence: 3,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: intent.runIdDigest,
    previousRecordDigest: terminal.recordDigest,
    resumeEpochDigest: digest('11'),
    attemptNonceDigest: digest('12'),
    workerIdentityDigest: digest('13'),
    authorityGrantReferenceDigest: digest('14'),
    providerBindingSetReferenceDigest: digest('15'),
    executionPlanReferenceDigest: digest('16')
  });
  expect(() => observeDurableExecutionJournal([intent, start!, terminal, retry]))
    .toThrow('unresolved execution');
});

test('conclusive not-applied readback retires a lost-handle attempt and permits a new attempt', () => {
  const [intent, start] = fixtureRecords();
  const readback = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'domain-readback-reference',
    sequence: 2,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: intent.runIdDigest,
    previousRecordDigest: start!.recordDigest,
    attemptNonceDigest: start!.kind === 'attempt-start' ? start.attemptNonceDigest : digest('0'),
    readbackClass: 'not-applied',
    domainReadbackReferenceDigest: digest('17')
  });
  const terminal = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'terminal',
    sequence: 3,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: intent.runIdDigest,
    previousRecordDigest: readback.recordDigest,
    attemptNonceDigest: readback.attemptNonceDigest,
    terminalClass: 'not-applied',
    terminalReferenceDigest: digest('18'),
    providerSettlementRecordDigest: null,
    domainReadbackRecordDigest: readback.recordDigest
  });
  const retry = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-start',
    sequence: 4,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: intent.runIdDigest,
    previousRecordDigest: terminal.recordDigest,
    resumeEpochDigest: digest('19'),
    attemptNonceDigest: digest('20'),
    workerIdentityDigest: digest('21'),
    authorityGrantReferenceDigest: digest('22'),
    providerBindingSetReferenceDigest: digest('23'),
    executionPlanReferenceDigest: digest('24')
  });

  const observation = observeDurableExecutionJournal([intent, start!, readback, terminal, retry]);
  expect(observation.latestTerminal?.terminalClass).toBe('not-applied');
  expect(observation.activeAttempt?.start.attemptNonceDigest).toBe(retry.attemptNonceDigest);
});

test('exact parser rejects structural aliases, unknown keys, digest drift and noncanonical bytes', () => {
  const encoded = encodeDurableExecutionRecord(fixtureRecords()[0]!);

  expect(() => parseDurableExecutionRecord(
    encoded.replace('"kind":"intent"', '"kind":"intent","\\u006bind":"intent"')
  )).toThrow('duplicate key');
  try {
    parseDurableExecutionRecord(encoded.replace('{', '{"unknown":true,'));
    throw new Error('expected strict record parsing to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(SecDurableExecutionContractError);
    expect((error as SecDurableExecutionContractError).kind).toBe('invalid-record');
  }
  expect(() => parseDurableExecutionRecord(
    encoded.replace(digest('3'), digest('d'))
  )).toThrow('digest does not match');
  expect(() => parseDurableExecutionRecord(JSON.stringify({
    ...fixtureRecords()[0]
  }))).toThrow('bytes are not canonical');
});

test('provider settlement alone cannot claim success and conclusive readback cannot be discarded', () => {
  const [intent, start] = fixtureRecords();
  const settlement = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'provider-settlement-reference',
    sequence: 2,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: intent.runIdDigest,
    previousRecordDigest: start!.recordDigest,
    attemptNonceDigest: start!.kind === 'attempt-start' ? start.attemptNonceDigest : digest('0'),
    settlementClass: 'succeeded',
    providerSettlementReferenceDigest: digest('e')
  });
  const succeeded = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'terminal',
    sequence: 3,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: intent.runIdDigest,
    previousRecordDigest: settlement.recordDigest,
    attemptNonceDigest: settlement.attemptNonceDigest,
    terminalClass: 'succeeded',
    terminalReferenceDigest: digest('f'),
    providerSettlementRecordDigest: settlement.recordDigest,
    domainReadbackRecordDigest: null
  });
  const retroactiveCancel = sealDurableExecutionRecord({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'cancel-request',
    sequence: 3,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: intent.runIdDigest,
    previousRecordDigest: settlement.recordDigest,
    attemptNonceDigest: settlement.attemptNonceDigest,
    cancelRequestReferenceDigest: digest('54')
  });

  expect(() => observeDurableExecutionJournal([intent, start!, settlement, succeeded]))
    .toThrow('requires conclusive succeeded domain readback');
  expect(() => observeDurableExecutionJournal([intent, start!, settlement, retroactiveCancel]))
    .toThrow('active uncancelled attempt');
  const conclusive = fixtureRecords();
  const { recordDigest: _recordDigest, ...terminalWithoutDigest } = conclusive[3]!;
  const recovery = sealDurableExecutionRecord({
    ...terminalWithoutDigest,
    terminalClass: 'recovery-required',
    terminalReferenceDigest: digest('10')
  });
  expect(() => observeDurableExecutionJournal([...conclusive.slice(0, 3), recovery]))
    .toThrow('cannot discard conclusive domain readback');
});
