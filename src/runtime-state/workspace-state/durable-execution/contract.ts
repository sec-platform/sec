import { z } from 'zod';

import { canonicalJson, sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { parseExactJson } from '../../../system-architecture/foundation/runtime/exact-json.ts';

export const SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA =
  'sec-durable-local-execution-record' as const;
export const SEC_DURABLE_EXECUTION_MAXIMUM_RECORD_BYTES = 4_096 as const;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const digestSchema = z.custom<`sha256:${string}`>(
  (value) => typeof value === 'string' && DIGEST_PATTERN.test(value)
);
const nullableDigestSchema = digestSchema.nullable();
const unsignedBaseRecordShape = {
  schema: z.literal(SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA),
  sequence: z.number().int().nonnegative().safe(),
  operationKeyDigest: digestSchema,
  previousRecordDigest: nullableDigestSchema
} as const;
const intentUnsignedRecordSchema = z.object({
  ...unsignedBaseRecordShape,
  kind: z.literal('intent'),
  intentReferenceDigest: digestSchema,
  maximumRecords: z.number().int().positive().safe(),
  maximumStateBytes: z.number().int().positive().safe(),
  maximumAttempts: z.number().int().positive().safe(),
  maximumProviderSettlementsPerAttempt: z.number().int().nonnegative().safe()
}).strict();
const attemptStartUnsignedRecordSchema = z.object({
  ...unsignedBaseRecordShape,
  kind: z.literal('attempt-start'),
  runIdDigest: nullableDigestSchema,
  resumeEpochDigest: nullableDigestSchema,
  attemptNonceDigest: digestSchema,
  workerIdentityDigest: digestSchema,
  authorityGrantReferenceDigest: digestSchema,
  providerBindingSetReferenceDigest: digestSchema,
  executionPlanReferenceDigest: digestSchema,
  retryAdmissionReferenceDigest: nullableDigestSchema
}).strict();
const providerSettlementUnsignedRecordSchema = z.object({
  ...unsignedBaseRecordShape,
  kind: z.literal('provider-settlement-reference'),
  attemptNonceDigest: digestSchema,
  requirementId: z.string().regex(ID_PATTERN).max(128),
  providerBindingDigest: digestSchema,
  providerReceiptDigest: digestSchema
}).strict();
const domainReadbackUnsignedRecordSchema = z.object({
  ...unsignedBaseRecordShape,
  kind: z.literal('domain-readback-reference'),
  attemptNonceDigest: digestSchema,
  readbackContractDigest: digestSchema,
  domainReadbackReceiptDigest: digestSchema
}).strict();
const lostHandleUnsignedRecordSchema = z.object({
  ...unsignedBaseRecordShape,
  kind: z.literal('lost-handle-reference'),
  attemptNonceDigest: digestSchema,
  lostHandleReferenceDigest: digestSchema
}).strict();
const attemptResolutionUnsignedRecordSchema = z.object({
  ...unsignedBaseRecordShape,
  kind: z.literal('attempt-resolution'),
  attemptNonceDigest: digestSchema,
  resolutionKind: z.enum(['owner-terminal-reference', 'retry-admission-reference']),
  resolutionReferenceDigest: digestSchema,
  providerSettlementRecordDigests: z.array(digestSchema).readonly(),
  domainReadbackRecordDigest: nullableDigestSchema
}).strict();
const durableExecutionUnsignedRecordSchema = z.discriminatedUnion('kind', [
  intentUnsignedRecordSchema,
  attemptStartUnsignedRecordSchema,
  providerSettlementUnsignedRecordSchema,
  domainReadbackUnsignedRecordSchema,
  lostHandleUnsignedRecordSchema,
  attemptResolutionUnsignedRecordSchema
]);
const durableExecutionRecordSchema = z.discriminatedUnion('kind', [
  intentUnsignedRecordSchema.extend({ recordDigest: digestSchema }).strict(),
  attemptStartUnsignedRecordSchema.extend({ recordDigest: digestSchema }).strict(),
  providerSettlementUnsignedRecordSchema.extend({ recordDigest: digestSchema }).strict(),
  domainReadbackUnsignedRecordSchema.extend({ recordDigest: digestSchema }).strict(),
  lostHandleUnsignedRecordSchema.extend({ recordDigest: digestSchema }).strict(),
  attemptResolutionUnsignedRecordSchema.extend({ recordDigest: digestSchema }).strict()
]);

export type SecDurableExecutionDigest = z.infer<typeof digestSchema>;
export type SecDurableExecutionRecord = z.infer<typeof durableExecutionRecordSchema>;
export type SecDurableExecutionUnsignedRecord = z.infer<typeof durableExecutionUnsignedRecordSchema>;
export type SecDurableExecutionRecordKind = SecDurableExecutionRecord['kind'];
export type SecDurableAttemptResolutionKind = Extract<
  SecDurableExecutionRecord,
  { readonly kind: 'attempt-resolution' }
>['resolutionKind'];
export type SecDurableExecutionIntentRecord = Extract<
  SecDurableExecutionRecord,
  { readonly kind: 'intent' }
>;
export type SecDurableExecutionAttemptStartRecord = Extract<
  SecDurableExecutionRecord,
  { readonly kind: 'attempt-start' }
>;
export type SecDurableExecutionProviderSettlementReferenceRecord = Extract<
  SecDurableExecutionRecord,
  { readonly kind: 'provider-settlement-reference' }
>;
export type SecDurableExecutionDomainReadbackReferenceRecord = Extract<
  SecDurableExecutionRecord,
  { readonly kind: 'domain-readback-reference' }
>;
export type SecDurableExecutionLostHandleReferenceRecord = Extract<
  SecDurableExecutionRecord,
  { readonly kind: 'lost-handle-reference' }
>;
export type SecDurableExecutionAttemptResolutionRecord = Extract<
  SecDurableExecutionRecord,
  { readonly kind: 'attempt-resolution' }
>;

export interface SecDurableExecutionAttemptObservation {
  readonly start: SecDurableExecutionAttemptStartRecord;
  readonly providerSettlements: readonly SecDurableExecutionProviderSettlementReferenceRecord[];
  readonly domainReadback: SecDurableExecutionDomainReadbackReferenceRecord | null;
  readonly lostHandle: SecDurableExecutionLostHandleReferenceRecord | null;
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

function fail(kind: SecDurableExecutionContractFailureKind, message: string): never {
  throw new SecDurableExecutionContractError(kind, message);
}

function unsigned(record: SecDurableExecutionRecord): SecDurableExecutionUnsignedRecord {
  const { recordDigest: _recordDigest, ...value } = record;
  return durableExecutionUnsignedRecordSchema.parse(value);
}

/** @internal Raw record construction is private to the Runtime State journal writer. */
export function sealDurableExecutionRecordForInternalWriter<
  Value extends SecDurableExecutionUnsignedRecord
>(
  value: Value
): Readonly<Value & { readonly recordDigest: SecDurableExecutionDigest }> {
  const parsed = durableExecutionUnsignedRecordSchema.safeParse(value);
  if (!parsed.success) {
    fail('invalid-record', `unsigned record violates its strict schema: ${z.prettifyError(parsed.error)}`);
  }
  const canonical = parsed.data;
  const record = Object.assign(
    {}, canonical, { recordDigest: sha256(canonical) as SecDurableExecutionDigest }
  );
  if (Buffer.byteLength(JSON.stringify(canonicalJson(record)), 'utf8')
      > SEC_DURABLE_EXECUTION_MAXIMUM_RECORD_BYTES) {
    fail('invalid-record', 'record exceeds its canonical byte ceiling.');
  }
  Object.freeze(record);
  return record as Readonly<Value & { readonly recordDigest: SecDurableExecutionDigest }>;
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
  const record = result.data;
  if (Buffer.byteLength(source, 'utf8') > SEC_DURABLE_EXECUTION_MAXIMUM_RECORD_BYTES) {
    fail('invalid-record', 'record exceeds its canonical byte ceiling.');
  }
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
  if (attempt.domainReadback === null) {
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
        if (active !== null || latestResolution?.resolutionKind === 'owner-terminal-reference') {
          fail('invalid-transition', 'attempt start conflicts with active or owner-terminal execution.');
        }
        if (latestResolution === null && record.retryAdmissionReferenceDigest !== null) {
          fail('invalid-transition', 'initial attempt cannot claim retry admission.');
        }
        if (latestResolution?.resolutionKind === 'retry-admission-reference'
            && record.retryAdmissionReferenceDigest !== latestResolution.resolutionReferenceDigest) {
          fail('invalid-transition', 'successor attempt does not bind the exact retry admission reference.');
        }
        if (attemptNonces.has(record.attemptNonceDigest)) {
          fail('invalid-transition', 'attempt nonce was already consumed by this run.');
        }
        attemptNonces.add(record.attemptNonceDigest);
        active = Object.freeze({ start: record,
          providerSettlements: Object.freeze([]), domainReadback: null, lostHandle: null });
        break;
      case 'provider-settlement-reference':
        if (active === null || record.attemptNonceDigest !== active.start.attemptNonceDigest
            || active.lostHandle !== null || active.domainReadback !== null
            || active.providerSettlements.some(({ requirementId }) => requirementId === record.requirementId)) {
          fail('invalid-transition', 'provider settlement does not target one unique active requirement.');
        }
        active = Object.freeze({
          start: active.start,
          providerSettlements: Object.freeze([...active.providerSettlements, record]),
          domainReadback: active.domainReadback,
          lostHandle: active.lostHandle
        });
        break;
      case 'domain-readback-reference':
        if (active === null || record.attemptNonceDigest !== active.start.attemptNonceDigest
            || active.domainReadback !== null) {
          fail('invalid-transition', 'domain readback does not target the one unread active attempt.');
        }
        active = Object.freeze({
          start: active.start,
          providerSettlements: active.providerSettlements,
          domainReadback: record,
          lostHandle: active.lostHandle
        });
        break;
      case 'lost-handle-reference':
        if (active === null || record.attemptNonceDigest !== active.start.attemptNonceDigest
            || active.lostHandle !== null || active.domainReadback !== null) {
          fail('invalid-transition', 'lost handle does not target one unresolved active attempt.');
        }
        active = Object.freeze({
          start: active.start,
          providerSettlements: active.providerSettlements,
          domainReadback: active.domainReadback,
          lostHandle: record
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
