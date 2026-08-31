import { z } from 'zod';

import { canonicalJson, sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { parseExactJson } from '../../../system-architecture/foundation/runtime/exact-json.ts';

export const SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA =
  'sec-durable-local-execution-record' as const;

export type SecDurableExecutionDigest = `sha256:${string}`;
export type SecDurableExecutionRecordKind =
  | 'intent'
  | 'attempt-start'
  | 'cancel-request'
  | 'provider-settlement-reference'
  | 'domain-readback-reference'
  | 'attempt-resolution';
export type SecDurableAttemptResolutionKind =
  | 'owner-terminal-reference'
  | 'retry-admission-reference'
  | 'reconciliation-required';

interface SecDurableExecutionRecordBase {
  readonly schema: typeof SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA;
  readonly kind: SecDurableExecutionRecordKind;
  readonly sequence: number;
  readonly operationKeyDigest: SecDurableExecutionDigest;
  readonly previousRecordDigest: SecDurableExecutionDigest | null;
  readonly recordDigest: SecDurableExecutionDigest;
}

export interface SecDurableExecutionIntentRecord extends SecDurableExecutionRecordBase {
  readonly kind: 'intent';
  readonly intentReferenceDigest: SecDurableExecutionDigest;
}

export interface SecDurableExecutionAttemptStartRecord extends SecDurableExecutionRecordBase {
  readonly kind: 'attempt-start';
  readonly runIdDigest: SecDurableExecutionDigest | null;
  readonly resumeEpochDigest: SecDurableExecutionDigest | null;
  readonly attemptNonceDigest: SecDurableExecutionDigest;
  readonly workerIdentityDigest: SecDurableExecutionDigest;
  readonly authorityGrantReferenceDigest: SecDurableExecutionDigest;
  readonly providerBindingSetReferenceDigest: SecDurableExecutionDigest;
  readonly executionPlanReferenceDigest: SecDurableExecutionDigest;
}

export interface SecDurableExecutionCancelRequestRecord extends SecDurableExecutionRecordBase {
  readonly kind: 'cancel-request';
  readonly attemptNonceDigest: SecDurableExecutionDigest;
  readonly cancelRequestReferenceDigest: SecDurableExecutionDigest;
}

export interface SecDurableExecutionProviderSettlementReferenceRecord
  extends SecDurableExecutionRecordBase {
  readonly kind: 'provider-settlement-reference';
  readonly attemptNonceDigest: SecDurableExecutionDigest;
  readonly requirementId: string;
  readonly providerBindingDigest: SecDurableExecutionDigest;
  readonly providerSettlementReferenceDigest: SecDurableExecutionDigest;
}

export interface SecDurableExecutionDomainReadbackReferenceRecord
  extends SecDurableExecutionRecordBase {
  readonly kind: 'domain-readback-reference';
  readonly attemptNonceDigest: SecDurableExecutionDigest;
  readonly readbackContractDigest: SecDurableExecutionDigest;
  readonly domainReadbackReferenceDigest: SecDurableExecutionDigest;
}

export interface SecDurableExecutionAttemptResolutionRecord extends SecDurableExecutionRecordBase {
  readonly kind: 'attempt-resolution';
  readonly attemptNonceDigest: SecDurableExecutionDigest;
  readonly resolutionKind: SecDurableAttemptResolutionKind;
  readonly resolutionReferenceDigest: SecDurableExecutionDigest;
  readonly providerSettlementRecordDigests: readonly SecDurableExecutionDigest[];
  readonly domainReadbackRecordDigest: SecDurableExecutionDigest | null;
}

export type SecDurableExecutionRecord =
  | SecDurableExecutionIntentRecord
  | SecDurableExecutionAttemptStartRecord
  | SecDurableExecutionCancelRequestRecord
  | SecDurableExecutionProviderSettlementReferenceRecord
  | SecDurableExecutionDomainReadbackReferenceRecord
  | SecDurableExecutionAttemptResolutionRecord;

export interface SecDurableExecutionAttemptObservation {
  readonly start: SecDurableExecutionAttemptStartRecord;
  readonly cancelRequest: SecDurableExecutionCancelRequestRecord | null;
  readonly providerSettlements: readonly SecDurableExecutionProviderSettlementReferenceRecord[];
  readonly domainReadback: SecDurableExecutionDomainReadbackReferenceRecord | null;
}

/** Durable bytes are observations only. They never authorize execution or replay. */
export interface SecDurableExecutionJournalObservation {
  readonly intent: SecDurableExecutionIntentRecord;
  readonly records: readonly SecDurableExecutionRecord[];
  readonly activeAttempt: SecDurableExecutionAttemptObservation | null;
  readonly latestResolution: SecDurableExecutionAttemptResolutionRecord | null;
  readonly journalDigest: SecDurableExecutionDigest;
}

export type SecDurableExecutionContractFailureKind =
  | 'invalid-record'
  | 'noncanonical-record'
  | 'digest-mismatch'
  | 'invalid-transition';

export class SecDurableExecutionContractError extends Error {
  readonly kind: SecDurableExecutionContractFailureKind;

  constructor(kind: SecDurableExecutionContractFailureKind, message: string) {
    super(`Durable local execution ${message}`);
    this.name = 'SecDurableExecutionContractError';
    this.kind = kind;
  }
}

type UnsignedRecord = SecDurableExecutionRecord extends infer RecordValue
  ? RecordValue extends SecDurableExecutionRecord
    ? Omit<RecordValue, 'recordDigest'>
    : never
  : never;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const digestSchema = z.string().regex(DIGEST_PATTERN);
const nullableDigestSchema = digestSchema.nullable();
const baseRecordShape = {
  schema: z.literal(SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA),
  sequence: z.number().int().nonnegative().safe(),
  operationKeyDigest: digestSchema,
  previousRecordDigest: nullableDigestSchema,
  recordDigest: digestSchema
} as const;
const durableExecutionRecordSchema = z.discriminatedUnion('kind', [
  z.object({
    ...baseRecordShape,
    kind: z.literal('intent'),
    intentReferenceDigest: digestSchema
  }).strict(),
  z.object({
    ...baseRecordShape,
    kind: z.literal('attempt-start'),
    runIdDigest: nullableDigestSchema,
    resumeEpochDigest: nullableDigestSchema,
    attemptNonceDigest: digestSchema,
    workerIdentityDigest: digestSchema,
    authorityGrantReferenceDigest: digestSchema,
    providerBindingSetReferenceDigest: digestSchema,
    executionPlanReferenceDigest: digestSchema
  }).strict(),
  z.object({
    ...baseRecordShape,
    kind: z.literal('cancel-request'),
    attemptNonceDigest: digestSchema,
    cancelRequestReferenceDigest: digestSchema
  }).strict(),
  z.object({
    ...baseRecordShape,
    kind: z.literal('provider-settlement-reference'),
    attemptNonceDigest: digestSchema,
    requirementId: z.string().regex(ID_PATTERN),
    providerBindingDigest: digestSchema,
    providerSettlementReferenceDigest: digestSchema
  }).strict(),
  z.object({
    ...baseRecordShape,
    kind: z.literal('domain-readback-reference'),
    attemptNonceDigest: digestSchema,
    readbackContractDigest: digestSchema,
    domainReadbackReferenceDigest: digestSchema
  }).strict(),
  z.object({
    ...baseRecordShape,
    kind: z.literal('attempt-resolution'),
    attemptNonceDigest: digestSchema,
    resolutionKind: z.enum([
      'owner-terminal-reference', 'retry-admission-reference', 'reconciliation-required'
    ]),
    resolutionReferenceDigest: digestSchema,
    providerSettlementRecordDigests: z.array(digestSchema),
    domainReadbackRecordDigest: nullableDigestSchema
  }).strict()
]);

function fail(kind: SecDurableExecutionContractFailureKind, message: string): never {
  throw new SecDurableExecutionContractError(kind, message);
}

function unsigned(record: SecDurableExecutionRecord): UnsignedRecord {
  const { recordDigest: _recordDigest, ...value } = record;
  return value as UnsignedRecord;
}

export function sealDurableExecutionRecord<Value extends UnsignedRecord>(
  value: Value
): Readonly<Value & { readonly recordDigest: SecDurableExecutionDigest }> {
  const record: Value & { readonly recordDigest: SecDurableExecutionDigest } = Object.assign(
    {}, value, { recordDigest: sha256(value) as SecDurableExecutionDigest }
  );
  Object.freeze(record);
  return record;
}

export function encodeDurableExecutionRecord(record: SecDurableExecutionRecord): string {
  return JSON.stringify(canonicalJson(record));
}

export function parseDurableExecutionRecord(source: string): SecDurableExecutionRecord {
  const parsed = parseExactJson(source, 'Durable local execution record');
  const result = durableExecutionRecordSchema.safeParse(parsed);
  if (!result.success) {
    fail('invalid-record', `record violates its strict schema: ${z.prettifyError(result.error)}`);
  }
  const record = result.data as SecDurableExecutionRecord;
  const expectedDigest = sha256(unsigned(record));
  if (record.recordDigest !== expectedDigest) fail('digest-mismatch', 'record digest does not match its exact content.');
  const canonical = encodeDurableExecutionRecord(record);
  if (canonical !== source) fail('noncanonical-record', 'record bytes are not canonical.');
  return Object.freeze(record);
}

function assertAttemptResolution(
  resolution: SecDurableExecutionAttemptResolutionRecord,
  attempt: SecDurableExecutionAttemptObservation
): void {
  const providerRecordDigests = attempt.providerSettlements
    .map(({ recordDigest }) => recordDigest)
    .sort();
  if (JSON.stringify(resolution.providerSettlementRecordDigests) !== JSON.stringify(providerRecordDigests)
      || resolution.domainReadbackRecordDigest !== (attempt.domainReadback?.recordDigest ?? null)) {
    fail('invalid-transition', 'attempt resolution references do not match the current observations.');
  }
  if ((resolution.resolutionKind === 'owner-terminal-reference'
      || resolution.resolutionKind === 'retry-admission-reference')
      && attempt.domainReadback === null) {
    fail('invalid-transition', `${resolution.resolutionKind} requires an owner-issued domain readback reference.`);
  }
}

export function observeDurableExecutionJournal(
  records: readonly SecDurableExecutionRecord[]
): SecDurableExecutionJournalObservation {
  if (records.length === 0 || records[0]?.kind !== 'intent') {
    fail('invalid-transition', 'journal must begin with exactly one intent record.');
  }
  const intent = records[0] as SecDurableExecutionIntentRecord;
  let previous: SecDurableExecutionRecord | null = null;
  let active: SecDurableExecutionAttemptObservation | null = null;
  let latestResolution: SecDurableExecutionAttemptResolutionRecord | null = null;
  const attemptNonces = new Set<SecDurableExecutionDigest>();
  for (const [index, record] of records.entries()) {
    if (record.sequence !== index
        || record.previousRecordDigest !== (previous?.recordDigest ?? null)) {
      fail('invalid-transition', 'record sequence or predecessor chain is noncanonical.');
    }
    if (record.operationKeyDigest !== intent.operationKeyDigest) {
      fail('invalid-transition', 'record OperationKey differs from the journal intent.');
    }
    if (index === 0) {
      previous = record;
      continue;
    }
    if (record.kind === 'intent') fail('invalid-transition', 'journal contains a second intent.');
    switch (record.kind) {
      case 'attempt-start':
        if (active !== null || latestResolution?.resolutionKind === 'owner-terminal-reference'
            || latestResolution?.resolutionKind === 'reconciliation-required') {
          fail('invalid-transition', 'attempt start conflicts with active, owner-terminal or unresolved execution.');
        }
        if (attemptNonces.has(record.attemptNonceDigest)) {
          fail('invalid-transition', 'attempt nonce was already consumed by this run.');
        }
        attemptNonces.add(record.attemptNonceDigest);
        active = Object.freeze({ start: record, cancelRequest: null,
          providerSettlements: Object.freeze([]), domainReadback: null });
        break;
      case 'cancel-request':
        if (active === null || record.attemptNonceDigest !== active.start.attemptNonceDigest
            || active.cancelRequest !== null) {
          fail('invalid-transition', 'cancel request does not target the one active uncancelled attempt.');
        }
        active = Object.freeze({
          start: active.start,
          cancelRequest: record,
          providerSettlements: active.providerSettlements,
          domainReadback: active.domainReadback
        });
        break;
      case 'provider-settlement-reference':
        if (active === null || record.attemptNonceDigest !== active.start.attemptNonceDigest
            || active.providerSettlements.some(({ requirementId }) => requirementId === record.requirementId)) {
          fail('invalid-transition', 'provider settlement does not target one unique active requirement.');
        }
        active = Object.freeze({
          start: active.start,
          cancelRequest: active.cancelRequest,
          providerSettlements: Object.freeze([...active.providerSettlements, record]),
          domainReadback: active.domainReadback
        });
        break;
      case 'domain-readback-reference':
        if (active === null || record.attemptNonceDigest !== active.start.attemptNonceDigest
            || active.domainReadback !== null) {
          fail('invalid-transition', 'domain readback does not target the one unread active attempt.');
        }
        active = Object.freeze({
          start: active.start,
          cancelRequest: active.cancelRequest,
          providerSettlements: active.providerSettlements,
          domainReadback: record
        });
        break;
      case 'attempt-resolution':
        if (active === null || record.attemptNonceDigest !== active.start.attemptNonceDigest) {
          fail('invalid-transition', 'attempt resolution does not target the one active attempt.');
        }
        assertAttemptResolution(record, active);
        latestResolution = record;
        active = null;
        break;
    }
    previous = record;
  }
  return Object.freeze({
    intent,
    records: Object.freeze([...records]),
    activeAttempt: active,
    latestResolution,
    journalDigest: sha256(records.map((record) => record.recordDigest)) as SecDurableExecutionDigest
  });
}

export function parseDurableExecutionJournal(source: string): SecDurableExecutionJournalObservation {
  if (source.length === 0 || !source.endsWith('\n')) {
    fail('noncanonical-record', 'journal must contain newline-terminated canonical records.');
  }
  const lines = source.slice(0, -1).split('\n');
  if (lines.some((line) => line.length === 0)) {
    fail('noncanonical-record', 'journal contains an empty record.');
  }
  return observeDurableExecutionJournal(lines.map(parseDurableExecutionRecord));
}
