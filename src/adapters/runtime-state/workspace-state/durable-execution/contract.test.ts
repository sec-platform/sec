import { expect, test } from 'bun:test';

import {
  DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
  DurableExecutionContractError,
  encodeDurableExecutionRecord,
  observeDurableExecutionJournal,
  parseDurableExecutionRecord,
  sealDurableExecutionRecordForInternalWriter,
  type DurableExecutionDigest,
  type DurableExecutionRecord
} from './contract.ts';

const digest = (value: string): DurableExecutionDigest =>
  `sha256:${value.padStart(64, '0')}` as DurableExecutionDigest;

function attemptPrefix(): readonly DurableExecutionRecord[] {
  const deadlineAtUnixMs = 4_102_444_800_000;
  const intent = sealDurableExecutionRecordForInternalWriter({
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'intent',
    sequence: 0,
    operationKeyDigest: digest('1'),
    intentReferenceDigest: digest('3'),
    executionPlanReferenceDigest: digest('9'),
    deadlineAtUnixMs,
    maximumRecords: 64,
    maximumStateBytes: 512 * 1024,
    maximumAttempts: 4,
    maximumProviderSettlementsPerAttempt: 4,
    previousRecordDigest: null
  });
  const start = sealDurableExecutionRecordForInternalWriter({
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-start',
    sequence: 1,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: digest('2'),
    previousRecordDigest: intent.recordDigest,
    resumeEpochDigest: digest('4'),
    attemptNonceDigest: digest('5'),
    boundAttemptDigest: digest('5'),
    workerIdentityDigest: digest('6'),
    authorityGrantReferenceDigest: digest('7'),
    providerBindingSetReferenceDigest: digest('8'),
    executionPlanReferenceDigest: digest('9'),
    deadlineAtUnixMs,
    retryAdmissionReferenceDigest: null
  });
  return Object.freeze([intent, start]);
}

function readback(
  prefix: readonly DurableExecutionRecord[],
  reference: string
): DurableExecutionRecord {
  const start = prefix[1]!;
  return sealDurableExecutionRecordForInternalWriter({
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'domain-readback-reference',
    sequence: prefix.length,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: prefix.at(-1)!.recordDigest,
    attemptNonceDigest: start.kind === 'attempt-start' ? start.attemptNonceDigest : digest('0'),
    readbackContractDigest: digest('10'),
    domainReadbackReceiptDigest: digest(reference)
  });
}

test('provider references are unique per requirement and resolution binds their exact record set', () => {
  const prefix = attemptPrefix();
  const provider = sealDurableExecutionRecordForInternalWriter({
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'provider-settlement-reference',
    sequence: 2,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: prefix[1]!.recordDigest,
    attemptNonceDigest: prefix[1]!.kind === 'attempt-start'
      ? prefix[1].attemptNonceDigest : digest('0'),
    requirementId: 'process.compiler',
    providerBindingDigest: digest('21'),
    providerReceiptDigest: digest('22')
  });
  const duplicate = sealDurableExecutionRecordForInternalWriter({
    ...((({ recordDigest: _ignored, ...value }) => value)(provider)),
    sequence: 3,
    previousRecordDigest: provider.recordDigest,
    providerReceiptDigest: digest('23')
  });
  expect(() => observeDurableExecutionJournal([...prefix, provider, duplicate]))
    .toThrow('unique active requirement');

  const observedReadback = readback([...prefix, provider], '24');
  const resolution = sealDurableExecutionRecordForInternalWriter({
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-resolution',
    sequence: 4,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: observedReadback.recordDigest,
    attemptNonceDigest: provider.attemptNonceDigest,
    resolutionKind: 'owner-terminal-reference',
    resolutionReferenceDigest: digest('25'),
    providerSettlementRecordDigests: [provider.recordDigest],
    domainReadbackRecordDigest: observedReadback.recordDigest
  });
  expect(observeDurableExecutionJournal([
    ...prefix, provider, observedReadback, resolution
  ]).latestResolution?.providerSettlementRecordDigests).toEqual([provider.recordDigest]);
});

test('exact parser rejects duplicate keys, unknown fields, digest drift and noncanonical bytes', () => {
  const intent = attemptPrefix()[0]!;
  const encoded = encodeDurableExecutionRecord(intent);
  expect(() => parseDurableExecutionRecord(
    encoded.replace('"kind":"intent"', '"kind":"intent","\\u006bind":"intent"')
  )).toThrow('duplicate key');
  try {
    parseDurableExecutionRecord(encoded.replace('{', '{"unknown":true,'));
    throw new Error('expected strict record parsing to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(DurableExecutionContractError);
    expect((error as DurableExecutionContractError).kind).toBe('invalid-record');
  }
  expect(() => parseDurableExecutionRecord(
    encoded.replace(digest('3'), digest('26'))
  )).toThrow(expect.objectContaining({ kind: 'digest-mismatch' }));
  expect(() => parseDurableExecutionRecord(JSON.stringify({ ...intent })))
    .toThrow(expect.objectContaining({ kind: 'noncanonical-record' }));
});
