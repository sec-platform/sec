import { expect, test } from 'bun:test';

import {
  SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
  SecDurableExecutionContractError,
  encodeDurableExecutionRecord,
  observeDurableExecutionJournal,
  parseDurableExecutionRecord,
  sealDurableExecutionRecordForInternalWriter,
  type SecDurableExecutionDigest,
  type SecDurableExecutionRecord
} from './contract.ts';

const digest = (value: string): SecDurableExecutionDigest =>
  `sha256:${value.padStart(64, '0')}` as SecDurableExecutionDigest;

function attemptPrefix(run = '2', nonce = '5'): readonly SecDurableExecutionRecord[] {
  const intent = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'intent',
    sequence: 0,
    operationKeyDigest: digest('1'),
    intentReferenceDigest: digest('3'),
    maximumRecords: 64,
    maximumStateBytes: 512 * 1024,
    maximumAttempts: 4,
    maximumProviderSettlementsPerAttempt: 4,
    previousRecordDigest: null
  });
  const start = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-start',
    sequence: 1,
    operationKeyDigest: intent.operationKeyDigest,
    runIdDigest: digest(run),
    previousRecordDigest: intent.recordDigest,
    resumeEpochDigest: digest('4'),
    attemptNonceDigest: digest(nonce),
    workerIdentityDigest: digest('6'),
    authorityGrantReferenceDigest: digest('7'),
    providerBindingSetReferenceDigest: digest('8'),
    executionPlanReferenceDigest: digest('9')
  });
  return Object.freeze([intent, start]);
}

function readback(
  prefix: readonly SecDurableExecutionRecord[],
  reference = 'a'
): SecDurableExecutionRecord {
  const start = prefix[1]!;
  return sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'domain-readback-reference',
    sequence: prefix.length,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: prefix.at(-1)!.recordDigest,
    attemptNonceDigest: start.kind === 'attempt-start' ? start.attemptNonceDigest : digest('0'),
    readbackContractDigest: digest('10'),
    domainReadbackReferenceDigest: digest(reference)
  });
}

test('one OperationKey serializes every run and only an owner terminal closes the operation', () => {
  const prefix = attemptPrefix();
  const observedReadback = readback(prefix);
  const resolution = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
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
  expect(() => observeDurableExecutionJournal([
    ...prefix, observedReadback, resolution, retry
  ])).toThrow('owner-terminal');
});

test('reconciliation blocks replay while owner retry admission permits a new run', () => {
  const prefix = attemptPrefix();
  const unresolved = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-resolution',
    sequence: 2,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: prefix[1]!.recordDigest,
    attemptNonceDigest: prefix[1]!.kind === 'attempt-start'
      ? prefix[1].attemptNonceDigest : digest('0'),
    resolutionKind: 'reconciliation-required',
    resolutionReferenceDigest: digest('14'),
    providerSettlementRecordDigests: [],
    domainReadbackRecordDigest: null
  });
  const { recordDigest: _retryRecordDigest, ...retryUnsigned } = attemptPrefix('15', '16')[1]!;
  const retryStart = sealDurableExecutionRecordForInternalWriter({
    ...retryUnsigned,
    sequence: 3,
    previousRecordDigest: unresolved.recordDigest
  });
  expect(() => observeDurableExecutionJournal([...prefix, unresolved, retryStart]))
    .toThrow('unresolved execution');

  const observedReadback = readback(prefix, '17');
  const sealedAdmission = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'attempt-resolution',
    sequence: 3,
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
    sequence: 4,
    previousRecordDigest: sealedAdmission.recordDigest
  });
  expect(observeDurableExecutionJournal([
    ...prefix, observedReadback, sealedAdmission, nextAttempt
  ]).activeAttempt?.start.runIdDigest).toBe(digest('19'));
});

test('provider references are unique per requirement and resolution binds their exact record set', () => {
  const prefix = attemptPrefix();
  const provider = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'provider-settlement-reference',
    sequence: 2,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: prefix[1]!.recordDigest,
    attemptNonceDigest: prefix[1]!.kind === 'attempt-start'
      ? prefix[1].attemptNonceDigest : digest('0'),
    requirementId: 'process.compiler',
    providerBindingDigest: digest('21'),
    providerSettlementReferenceDigest: digest('22')
  });
  const duplicate = sealDurableExecutionRecordForInternalWriter({
    ...((({ recordDigest: _ignored, ...value }) => value)(provider)),
    sequence: 3,
    previousRecordDigest: provider.recordDigest,
    providerSettlementReferenceDigest: digest('23')
  });
  expect(() => observeDurableExecutionJournal([...prefix, provider, duplicate]))
    .toThrow('unique active requirement');

  const observedReadback = readback([...prefix, provider], '24');
  const resolution = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
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

test('cancel preserves already settled requirements while stopping the active attempt', () => {
  const prefix = attemptPrefix();
  const provider = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'provider-settlement-reference',
    sequence: 2,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: prefix[1]!.recordDigest,
    attemptNonceDigest: prefix[1]!.kind === 'attempt-start'
      ? prefix[1].attemptNonceDigest : digest('0'),
    requirementId: 'process.compiler',
    providerBindingDigest: digest('27'),
    providerSettlementReferenceDigest: digest('28')
  });
  const cancel = sealDurableExecutionRecordForInternalWriter({
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind: 'cancel-request',
    sequence: 3,
    operationKeyDigest: prefix[0]!.operationKeyDigest,
    previousRecordDigest: provider.recordDigest,
    attemptNonceDigest: provider.attemptNonceDigest,
    cancelRequestReferenceDigest: digest('29')
  });

  const observation = observeDurableExecutionJournal([...prefix, provider, cancel]);
  expect(observation.activeAttempt?.cancelRequest?.recordDigest).toBe(cancel.recordDigest);
  expect(observation.activeAttempt?.providerSettlements.map(({ requirementId }) => requirementId))
    .toEqual(['process.compiler']);
  const providerAfterCancel = sealDurableExecutionRecordForInternalWriter({
    ...((({ recordDigest: _recordDigest, ...value }) => value)(provider)),
    sequence: 4,
    previousRecordDigest: cancel.recordDigest,
    requirementId: 'process.linker',
    providerSettlementReferenceDigest: digest('30')
  });
  expect(() => observeDurableExecutionJournal([...prefix, provider, cancel, providerAfterCancel]))
    .toThrow('unique active requirement');
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
    expect(error).toBeInstanceOf(SecDurableExecutionContractError);
    expect((error as SecDurableExecutionContractError).kind).toBe('invalid-record');
  }
  expect(() => parseDurableExecutionRecord(
    encoded.replace(digest('3'), digest('26'))
  )).toThrow('digest does not match');
  expect(() => parseDurableExecutionRecord(JSON.stringify({ ...attemptPrefix()[0] })))
    .toThrow('bytes are not canonical');
});
