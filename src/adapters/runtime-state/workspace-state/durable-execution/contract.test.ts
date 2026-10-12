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

function attemptPrefix(run = '2', nonce = '5'): readonly DurableExecutionRecord[] {
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
    runIdDigest: digest(run),
    previousRecordDigest: intent.recordDigest,
    resumeEpochDigest: digest('4'),
    attemptNonceDigest: digest(nonce),
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
  reference = 'a'
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

test('one OperationKey serializes every run and only an owner terminal closes the operation', () => {
  const prefix = attemptPrefix();
  const observedReadback = readback(prefix);
  const resolution = sealDurableExecutionRecordForInternalWriter({
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-resolution',
    sequence: 3,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: observedReadback.recordDigest,
    attemptNonceDigest: prefix[1]!.kind === 'attempt-start'
      ? prefix[1].attemptNonceDigest : digest('0'),
    resolutionKind: 'owner-terminal-reference',
    resolutionReferenceDigest: digest('11'),
    providerSettlementRecordDigests: [],
    domainReadbackRecordDigest: observedReadback.recordDigest
  });
  const nextRun = attemptPrefix('12', '13')[1]!;
  const { recordDigest: _nextRunRecordDigest, ...nextRunUnsigned } = nextRun;
  const retry = sealDurableExecutionRecordForInternalWriter({
    ...nextRunUnsigned,
    sequence: 4,
    previousRecordDigest: resolution.recordDigest
  });

  const observation = observeDurableExecutionJournal([...prefix, observedReadback, resolution]);
  expect(observation.latestResolution?.resolutionKind).toBe('owner-terminal-reference');
  expect(observation.activeAttempt).toBeNull();
  expect(observation.state).toBe('settled');
  expect(() => observeDurableExecutionJournal([
    ...prefix, observedReadback, resolution, retry
  ])).toThrow('owner-terminal');
});

test('a lost handle requires readback and exact owner retry admission before a new run', () => {
  const prefix = attemptPrefix();
  const lostHandle = sealDurableExecutionRecordForInternalWriter({
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'lost-handle-reference',
    sequence: 2,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: prefix[1]!.recordDigest,
    attemptNonceDigest: prefix[1]!.kind === 'attempt-start'
      ? prefix[1].attemptNonceDigest : digest('0'),
    lostHandleReferenceDigest: digest('14')
  });
  const { recordDigest: _retryRecordDigest, ...retryUnsigned } = attemptPrefix('15', '16')[1]!;
  const retryStart = sealDurableExecutionRecordForInternalWriter({
    ...retryUnsigned,
    sequence: 3,
    previousRecordDigest: lostHandle.recordDigest
  });
  expect(() => observeDurableExecutionJournal([...prefix, lostHandle, retryStart]))
    .toThrow('active');
  expect(observeDurableExecutionJournal([...prefix, lostHandle]).state).toBe('lost-handle');

  const observedReadback = readback([...prefix, lostHandle], '17');
  const sealedAdmission = sealDurableExecutionRecordForInternalWriter({
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-resolution',
    sequence: 4,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: observedReadback.recordDigest,
    attemptNonceDigest: prefix[1]!.kind === 'attempt-start'
      ? prefix[1].attemptNonceDigest : digest('0'),
    resolutionKind: 'retry-admission-reference',
    resolutionReferenceDigest: digest('18'),
    providerSettlementRecordDigests: [],
    domainReadbackRecordDigest: observedReadback.recordDigest
  });
  const nextAttempt = sealDurableExecutionRecordForInternalWriter({
    ...((({ recordDigest: _recordDigest, ...value }) => value)(attemptPrefix('19', '20')[1]!)),
    sequence: 5,
    previousRecordDigest: sealedAdmission.recordDigest,
    retryAdmissionReferenceDigest: sealedAdmission.resolutionReferenceDigest
  });
  const retried = observeDurableExecutionJournal([
    ...prefix, lostHandle, observedReadback, sealedAdmission, nextAttempt
  ]);
  expect(retried.activeAttempt?.start.runIdDigest).toBe(digest('19'));
  expect(retried.state).toBe('running');
});

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
  const { recordDigest: _recordDigest, ...unsignedIntent } = intent;
  expect(() => sealDurableExecutionRecordForInternalWriter({
    ...unsignedIntent,
    unknown: true
  } as never)).toThrow('unsigned record violates its strict schema');
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
  )).toThrow('digest does not match');
  expect(() => parseDurableExecutionRecord(JSON.stringify({ ...attemptPrefix()[0] })))
    .toThrow('bytes are not canonical');
});
