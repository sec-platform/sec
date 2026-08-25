/**
 * Durable local append/readback journal for VerificationAction V2 lifecycle facts.
 *
 * Runtime bytes live in the canonical SEC workspace-state root, never in the
 * repository tree. The journal is disposable. V1 records live in a different
 * namespace and cannot be projected into V2; a stale V1 file in the V2
 * namespace is reported as stale and removed only when the next V2 append
 * starts a clean sequence.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import {
  parseDevelopmentCriticalPathStaticClosureV1,
  parseDevelopmentCriticalPathStaticGenerationV1,
  type DevelopmentCriticalPathStaticClosureV1,
  type DevelopmentCriticalPathStaticGenerationV1
} from '../../platform/shared/development-critical-path-contract.ts';
import {
  createVerificationActionEvidenceV1,
  createVerificationActionStartReceiptV1,
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  parseVerificationActionEvidenceV1,
  parseVerificationActionKeyV2,
  parseVerificationActionStartReceiptV1,
  type VerificationActionEvidenceV1,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV2,
  type VerificationActionStartReceiptV1,
  type VerificationActionTerminalV2
} from '../../platform/shared/verification-action-contract.ts';
import {
  VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE_V2,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE_V2,
  parseVerificationActionProviderStartMarkerV2,
  parseVerificationActionProviderTerminalAnchorV2,
  type VerificationActionProviderStartMarkerV2,
  type VerificationActionProviderTerminalAnchorV2
} from '../../platform/shared/verification-action-provider-contract.ts';
import type { RuntimeStateJournalFileSystemV1 } from './runtime-state-journal-filesystem.ts';

export const VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V2 =
  'sec-verification-action-journal-event-v2' as const;
const LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1 =
  'sec-verification-action-journal-event-v1' as const;
export const VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2 =
  'verification-actions/v2' as const;
export const VERIFICATION_ACTION_CLAIM_SCHEMA_V1 =
  'sec-verification-action-claim-v1' as const;
export const VERIFICATION_ACTION_STATIC_CLOSURE_POINTER_SCHEMA_V1 =
  'sec-verification-action-static-closure-pointer-v1' as const;
export const VERIFICATION_ACTION_START_RECEIPT_FILE_V1 =
  'start-receipt.json' as const;
export const VERIFICATION_ACTION_EVIDENCE_FILE_V1 =
  'terminal-evidence.json' as const;
/**
 * Terminal reuse is a disposable projection.  Keep the immutable lifecycle
 * prefix and one current terminal projection, but never let repeated reuse or
 * terminal cancellation/invalidations grow the JSONL without a bound.
 */
export const VERIFICATION_ACTION_JOURNAL_TERMINAL_HISTORY_LIMIT_V2 = 4 as const;
export const VERIFICATION_ACTION_STATIC_CLOSURE_RETENTION_SCHEMA_V1 =
  'sec-verification-action-static-closure-retention-v1' as const;
export const VERIFICATION_ACTION_SETTLEMENT_SCHEMA_V1 =
  'sec-verification-action-settlement-v1' as const;

export type VerificationActionSettlementReceiptV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_SETTLEMENT_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  executionBindingDigest: VerificationActionKeyDigest;
  evidenceDigest: VerificationActionKeyDigest;
  providerRevision: string;
  phase: 'observe' | 'release' | 'complete';
  state: 'pending' | 'settled';
  reasonCode:
    | 'provider-observation-pending'
    | 'provider-observation-failed'
    | 'provider-release-pending'
    | 'provider-release-failed'
    | 'settled';
  detailDigest: VerificationActionKeyDigest;
  observedAt: string;
  receiptDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionStaticClosureRetirementBlockerCodeV1 =
  'production-consumer-unwired';

export type VerificationActionStaticClosureRetirementOutcomeV1 = Readonly<{
  disposition: 'blocked';
  actionKey: VerificationActionKeyDigest;
  phase: 'pointer-pending';
  blockers: readonly ['production-consumer-unwired'];
  intent: null;
  sharedObjectReferences: 0;
}>;

export type VerificationActionStaticClosureRetentionReceiptV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_STATIC_CLOSURE_RETENTION_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  closureDigest: VerificationActionKeyDigest;
  actionPlanDigest: VerificationActionKeyDigest;
  actionPlanClosureDigest: VerificationActionKeyDigest;
  headTreeSha: string;
  terminalEvidenceDigest: VerificationActionKeyDigest;
  terminalEventDigest: VerificationActionKeyDigest;
  sessionRevision: VerificationActionKeyDigest;
  artifactDigest: VerificationActionKeyDigest;
  settlementDigest: VerificationActionKeyDigest;
  providerSettlementDigest: VerificationActionKeyDigest;
  retentionPolicy: 'retain-immutable-closure-and-terminal-evidence-v1';
  receiptDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionStaticClosureRetirementCompletedV1 = Readonly<{
  disposition: 'retired';
  actionKey: VerificationActionKeyDigest;
  phase: 'pointer-retired-object-retained';
  blockers: readonly [];
  receipt: VerificationActionStaticClosureRetentionReceiptV1;
  sharedObjectReferences: number;
}>;

export type VerificationActionStaticClosurePointerV1 = Readonly<{
  schema: typeof VERIFICATION_ACTION_STATIC_CLOSURE_POINTER_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  closureDigest: VerificationActionKeyDigest;
  actionPlanDigest: VerificationActionKeyDigest;
  actionPlanClosureDigest: VerificationActionKeyDigest;
  staticGenerationDigest: VerificationActionKeyDigest;
  headTreeSha: string;
  readbackDigest: VerificationActionKeyDigest;
  pointerDigest: VerificationActionKeyDigest;
}>;

export function writeVerificationActionStartMarkerV2Atomic(
  filePath: string,
  marker: VerificationActionProviderStartMarkerV2
): void {
  const canonical = parseVerificationActionProviderStartMarkerV2(marker);
  if (path.basename(filePath) !== VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE_V2) {
    fail(`start marker file must be ${VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE_V2}.`);
  }
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  const bytes = `${encodeVerificationActionDataV2(canonical)}\n`;
  let handle: number | null = null;
  try {
    handle = openSync(temporaryPath, 'wx');
    writeFileSync(handle, bytes);
    fsyncSync(handle);
    closeSync(handle);
    handle = null;
    renameSync(temporaryPath, absolutePath);
    if (readFileSync(absolutePath, 'utf8') !== bytes) fail('start marker readback bytes mismatch.');
  } finally {
    if (handle !== null) closeSync(handle);
    rmSync(temporaryPath, { force: true });
  }
}

export function writeVerificationActionTerminalStatusAnchorV2Atomic(
  filePath: string,
  anchor: VerificationActionProviderTerminalAnchorV2
): void {
  const canonical = parseVerificationActionProviderTerminalAnchorV2(anchor);
  if (path.basename(filePath) !== VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE_V2) {
    fail(`terminal status anchor file must be ${VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE_V2}.`);
  }
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  const bytes = `${encodeVerificationActionDataV2(canonical)}\n`;
  let handle: number | null = null;
  try {
    handle = openSync(temporaryPath, 'wx');
    writeFileSync(handle, bytes);
    fsyncSync(handle);
    closeSync(handle);
    handle = null;
    renameSync(temporaryPath, absolutePath);
    if (readFileSync(absolutePath, 'utf8') !== bytes) fail('terminal status anchor readback bytes mismatch.');
  } finally {
    if (handle !== null) closeSync(handle);
    rmSync(temporaryPath, { force: true });
  }
}

export interface VerificationActionClaimV1 {
  readonly schema: typeof VERIFICATION_ACTION_CLAIM_SCHEMA_V1;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export type VerificationActionClaimDispositionV1 =
  | 'acquired'
  | 'joined'
  | 'terminal'
  | 'contended'
  | 'blocked';

export interface VerificationActionClaimOutcomeV1 {
  readonly disposition: VerificationActionClaimDispositionV1;
  readonly claim: VerificationActionClaimV1 | null;
  readonly terminal: VerificationActionTerminalV2 | null;
  readonly reason: string | null;
}

export type VerificationActionJournalStateV2 =
  | 'queued'
  | 'running'
  | 'terminal'
  | 'reused'
  | 'invalidated'
  | 'cancelled';

export interface VerificationActionJournalEventV2 {
  schema: typeof VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V2;
  sequence: number;
  actionKey: VerificationActionKeyDigest;
  action: VerificationActionKeyV2;
  state: VerificationActionJournalStateV2;
  recordedAt: string;
  terminal: VerificationActionTerminalV2 | null;
  note: string | null;
  previousDigest: VerificationActionKeyDigest | null;
  eventDigest: VerificationActionKeyDigest;
}

export interface VerificationActionJournalReadbackV2 {
  readonly filePath: string;
  readonly schemaState: 'current' | 'stale';
  readonly action: VerificationActionKeyV2 | null;
  readonly events: readonly VerificationActionJournalEventV2[];
  readonly latestState: VerificationActionJournalStateV2 | null;
  readonly terminal: VerificationActionTerminalV2 | null;
  readonly startReceipt?: VerificationActionStartReceiptV1 | null;
  readonly evidence?: VerificationActionEvidenceV1 | null;
}

function fail(message: string): never {
  throw new Error(`VerificationAction journal ${message}`);
}

function assertIsoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    fail('recordedAt must be an ISO-8601 UTC timestamp.');
  }
  return value;
}

function assertNote(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f]/u.test(value)) {
    fail('note must be null or bounded text.');
  }
  return value;
}

function assertState(value: unknown): VerificationActionJournalStateV2 {
  if (![
    'queued', 'running', 'terminal', 'reused', 'invalidated', 'cancelled'
  ].includes(String(value))) {
    fail('state is invalid.');
  }
  return value as VerificationActionJournalStateV2;
}

function assertDigest(value: unknown, label: string): VerificationActionKeyDigest | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be null or a SHA-256 digest.`);
  }
  return value as VerificationActionKeyDigest;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`event must contain exactly: ${wanted.join(', ')}.`);
  }
}

function eventWithoutDigest(event: Omit<VerificationActionJournalEventV2, 'eventDigest'>): string {
  return encodeVerificationActionDataV2(event);
}

function eventDigest(
  event: Omit<VerificationActionJournalEventV2, 'eventDigest'>
): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(eventWithoutDigest(event)).digest('hex')}`;
}

function actionPath(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('action key is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    `${actionKey.slice(7)}.jsonl`
  );
}

function actionStartReceiptPath(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('start receipt action key is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    `${actionKey.slice(7)}.${VERIFICATION_ACTION_START_RECEIPT_FILE_V1}`
  );
}

function actionEvidencePath(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('Evidence action key is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    `${actionKey.slice(7)}.${VERIFICATION_ACTION_EVIDENCE_FILE_V1}`
  );
}

function staticClosureObjectPath(
  fs: RuntimeStateJournalFileSystemV1,
  closureDigest: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(closureDigest)) fail('static closure digest is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    'static-closures',
    `${closureDigest.slice(7)}.json`
  );
}

function staticGenerationObjectPath(
  fs: RuntimeStateJournalFileSystemV1,
  generationDigest: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(generationDigest)) fail('static generation digest is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    'static-generations',
    `${generationDigest.slice(7)}.json`
  );
}

function staticClosurePointerPath(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('static closure action key is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    'static-current',
    `${actionKey.slice(7)}.json`
  );
}

function staticClosureRetentionPath(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('static closure retention action key is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    'static-retention',
    `${actionKey.slice(7)}.json`
  );
}

function actionSettlementPath(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): string {
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    'settlement-current',
    `${actionKey.slice(7)}.json`
  );
}

function settlementDigest(
  value: Omit<VerificationActionSettlementReceiptV1, 'receiptDigest'>
): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function parseVerificationActionSettlementReceiptV1(
  value: unknown
): VerificationActionSettlementReceiptV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('settlement receipt must be an object.');
  }
  const input = value as Record<string, unknown>;
  const expected = [
    'schema', 'actionKey', 'executionBindingDigest', 'evidenceDigest', 'providerRevision',
    'phase', 'state', 'reasonCode', 'detailDigest', 'observedAt', 'receiptDigest'
  ].sort();
  const actual = Object.keys(input).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`settlement receipt must contain exactly: ${expected.join(', ')}.`);
  }
  const phase = input.phase;
  const state = input.state;
  const reasonCode = input.reasonCode;
  if (input.schema !== VERIFICATION_ACTION_SETTLEMENT_SCHEMA_V1
      || (phase !== 'observe' && phase !== 'release' && phase !== 'complete')
      || (state !== 'pending' && state !== 'settled')
      || (reasonCode !== 'provider-observation-pending'
        && reasonCode !== 'provider-observation-failed'
        && reasonCode !== 'provider-release-pending'
        && reasonCode !== 'provider-release-failed'
        && reasonCode !== 'settled')
      || typeof input.providerRevision !== 'string' || input.providerRevision.length === 0
      || typeof input.actionKey !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.actionKey)
      || typeof input.executionBindingDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(input.executionBindingDigest)
      || typeof input.evidenceDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.evidenceDigest)
      || typeof input.detailDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.detailDigest)
      || typeof input.receiptDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.receiptDigest)) {
    fail('settlement receipt identity is invalid.');
  }
  if ((state === 'settled') !== (phase === 'complete' && reasonCode === 'settled')) {
    fail('settlement receipt terminal state is inconsistent.');
  }
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_SETTLEMENT_SCHEMA_V1,
    actionKey: input.actionKey as VerificationActionKeyDigest,
    executionBindingDigest: input.executionBindingDigest as VerificationActionKeyDigest,
    evidenceDigest: input.evidenceDigest as VerificationActionKeyDigest,
    providerRevision: input.providerRevision,
    phase,
    state,
    reasonCode,
    detailDigest: input.detailDigest as VerificationActionKeyDigest,
    observedAt: assertIsoDate(input.observedAt)
  });
  if (settlementDigest(material) !== input.receiptDigest) fail('settlement receipt digest mismatch.');
  return Object.freeze({ ...material, receiptDigest: input.receiptDigest as VerificationActionKeyDigest });
}

export function readVerificationActionSettlementV1(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): VerificationActionSettlementReceiptV1 | null {
  const filePath = actionSettlementPath(fs, actionKey);
  if (!fs.exists(filePath)) return null;
  let value: unknown;
  try { value = JSON.parse(fs.readText(filePath)) as unknown; } catch (error) {
    throw new Error('VerificationAction settlement receipt is invalid JSON.', { cause: error });
  }
  const receipt = parseVerificationActionSettlementReceiptV1(value);
  if (receipt.actionKey !== actionKey) fail('settlement receipt action identity differs from its path.');
  return receipt;
}

export function publishVerificationActionSettlementV1(input: Readonly<{
  fs: RuntimeStateJournalFileSystemV1;
  evidence: VerificationActionEvidenceV1;
  phase: VerificationActionSettlementReceiptV1['phase'];
  state: VerificationActionSettlementReceiptV1['state'];
  reasonCode: VerificationActionSettlementReceiptV1['reasonCode'];
  detail: string;
  observedAt: string;
}>): VerificationActionSettlementReceiptV1 {
  const durableEvidence = readVerificationActionEvidenceV1(input.fs, input.evidence.actionKey);
  if (durableEvidence === null || durableEvidence.evidenceDigest !== input.evidence.evidenceDigest
      || encodeVerificationActionDataV2(durableEvidence) !== encodeVerificationActionDataV2(input.evidence)) {
    fail('settlement publication requires exact durable provider Evidence.');
  }
  const detail = input.detail.replace(/[\u0000-\u001f]/gu, ' ').slice(0, 1024);
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_SETTLEMENT_SCHEMA_V1,
    actionKey: input.evidence.actionKey,
    executionBindingDigest: input.evidence.executionBindingDigest,
    evidenceDigest: input.evidence.evidenceDigest,
    providerRevision: input.evidence.providerRevision,
    phase: input.phase,
    state: input.state,
    reasonCode: input.reasonCode,
    detailDigest: `sha256:${createHash('sha256').update(detail).digest('hex')}` as VerificationActionKeyDigest,
    observedAt: assertIsoDate(input.observedAt)
  });
  const receipt = Object.freeze({ ...material, receiptDigest: settlementDigest(material) });
  const bytes = `${encodeVerificationActionDataV2(receipt)}\n`;
  const filePath = actionSettlementPath(input.fs, input.evidence.actionKey);
  const currentText = input.fs.exists(filePath) ? input.fs.readText(filePath) : null;
  const current = currentText === null ? null : parseVerificationActionSettlementReceiptV1(JSON.parse(currentText));
  if (current?.state === 'settled') {
    if (input.state !== 'settled' || current.executionBindingDigest !== receipt.executionBindingDigest
        || current.evidenceDigest !== receipt.evidenceDigest) {
      fail('settled provider resources cannot return to a pending or different binding.');
    }
    return current;
  }
  if (!input.fs.replaceFsyncCas(filePath, currentText, bytes)) {
    fail('settlement current receipt changed concurrently.');
  }
  const readback = readVerificationActionSettlementV1(input.fs, input.evidence.actionKey);
  if (readback === null || readback.receiptDigest !== receipt.receiptDigest) {
    fail('settlement durable readback differs.');
  }
  return readback;
}

function staticRetentionDigest(
  value: Omit<VerificationActionStaticClosureRetentionReceiptV1, 'receiptDigest'>
): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function parseStaticClosureRetentionReceiptV1(
  value: unknown
): VerificationActionStaticClosureRetentionReceiptV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('static closure retention receipt must be an object.');
  }
  const input = value as Record<string, unknown>;
  const expected = [
    'schema', 'actionKey', 'closureDigest', 'actionPlanDigest', 'actionPlanClosureDigest', 'headTreeSha',
    'terminalEvidenceDigest', 'terminalEventDigest', 'sessionRevision', 'artifactDigest',
    'settlementDigest', 'providerSettlementDigest', 'retentionPolicy', 'receiptDigest'
  ].sort();
  const actual = Object.keys(input).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`static closure retention receipt must contain exactly: ${expected.join(', ')}.`);
  }
  const digestFields = [
    'actionKey', 'closureDigest', 'actionPlanDigest', 'actionPlanClosureDigest', 'terminalEvidenceDigest',
    'terminalEventDigest', 'sessionRevision', 'artifactDigest', 'settlementDigest',
    'providerSettlementDigest', 'receiptDigest'
  ] as const;
  if (input.schema !== VERIFICATION_ACTION_STATIC_CLOSURE_RETENTION_SCHEMA_V1
      || input.retentionPolicy !== 'retain-immutable-closure-and-terminal-evidence-v1'
      || typeof input.headTreeSha !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.headTreeSha)
      || digestFields.some((field) => typeof input[field] !== 'string'
        || !/^sha256:[0-9a-f]{64}$/u.test(input[field] as string))) {
    fail('static closure retention receipt identity is invalid.');
  }
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_STATIC_CLOSURE_RETENTION_SCHEMA_V1,
    actionKey: input.actionKey as VerificationActionKeyDigest,
    closureDigest: input.closureDigest as VerificationActionKeyDigest,
    actionPlanDigest: input.actionPlanDigest as VerificationActionKeyDigest,
    actionPlanClosureDigest: input.actionPlanClosureDigest as VerificationActionKeyDigest,
    headTreeSha: input.headTreeSha,
    terminalEvidenceDigest: input.terminalEvidenceDigest as VerificationActionKeyDigest,
    terminalEventDigest: input.terminalEventDigest as VerificationActionKeyDigest,
    sessionRevision: input.sessionRevision as VerificationActionKeyDigest,
    artifactDigest: input.artifactDigest as VerificationActionKeyDigest,
    settlementDigest: input.settlementDigest as VerificationActionKeyDigest,
    providerSettlementDigest: input.providerSettlementDigest as VerificationActionKeyDigest,
    retentionPolicy: 'retain-immutable-closure-and-terminal-evidence-v1' as const
  });
  if (staticRetentionDigest(material) !== input.receiptDigest) {
    fail('static closure retention receipt digest mismatch.');
  }
  return Object.freeze({ ...material, receiptDigest: input.receiptDigest as VerificationActionKeyDigest });
}

function staticPointerDigest(value: Omit<VerificationActionStaticClosurePointerV1, 'pointerDigest'>): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function parseStaticClosurePointerV1(value: unknown): VerificationActionStaticClosurePointerV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('static closure pointer must be an object.');
  }
  const input = value as Record<string, unknown>;
  const expected = [
    'schema', 'actionKey', 'closureDigest', 'actionPlanDigest', 'actionPlanClosureDigest',
    'staticGenerationDigest', 'headTreeSha', 'readbackDigest', 'pointerDigest'
  ].sort();
  const actual = Object.keys(input).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`static closure pointer must contain exactly: ${expected.join(', ')}.`);
  }
  if (input.schema !== VERIFICATION_ACTION_STATIC_CLOSURE_POINTER_SCHEMA_V1
      || typeof input.actionKey !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.actionKey)
      || typeof input.closureDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.closureDigest)
      || typeof input.actionPlanDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.actionPlanDigest)
      || typeof input.actionPlanClosureDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(input.actionPlanClosureDigest)
      || typeof input.staticGenerationDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(input.staticGenerationDigest)
      || typeof input.readbackDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.readbackDigest)
      || typeof input.headTreeSha !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.headTreeSha)
      || typeof input.pointerDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.pointerDigest)) {
    fail('static closure pointer identity is invalid.');
  }
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_STATIC_CLOSURE_POINTER_SCHEMA_V1,
    actionKey: input.actionKey as VerificationActionKeyDigest,
    closureDigest: input.closureDigest as VerificationActionKeyDigest,
    actionPlanDigest: input.actionPlanDigest as VerificationActionKeyDigest,
    actionPlanClosureDigest: input.actionPlanClosureDigest as VerificationActionKeyDigest,
    staticGenerationDigest: input.staticGenerationDigest as VerificationActionKeyDigest,
    headTreeSha: input.headTreeSha,
    readbackDigest: input.readbackDigest as VerificationActionKeyDigest
  });
  if (staticPointerDigest(material) !== input.pointerDigest) fail('static closure pointer digest mismatch.');
  return Object.freeze({ ...material, pointerDigest: input.pointerDigest as VerificationActionKeyDigest });
}

/**
 * Publish one repository-level generation object exactly once. This object is
 * immutable and shared by every Action admission derived from the same exact
 * tree/producer/owner generation; process-local analyzer caches are only an
 * acceleration and never substitute for this durable readback.
 */
export function publishDevelopmentCriticalPathStaticGenerationV1(input: Readonly<{
  fs: RuntimeStateJournalFileSystemV1;
  generation: DevelopmentCriticalPathStaticGenerationV1;
}>): DevelopmentCriticalPathStaticGenerationV1 {
  const generation = parseDevelopmentCriticalPathStaticGenerationV1(input.generation);
  const bytes = `${encodeVerificationActionDataV2(generation)}\n`;
  const objectPath = staticGenerationObjectPath(input.fs, generation.generationDigest);
  if (!input.fs.createExclusiveFsync(objectPath, bytes)
      && input.fs.readText(objectPath) !== bytes) {
    fail('immutable static generation object conflicts with its digest path.');
  }
  if (input.fs.readText(objectPath) !== bytes) fail('static generation durable readback mismatch.');
  return readDevelopmentCriticalPathStaticGenerationV1(input.fs, generation.generationDigest);
}

export function readDevelopmentCriticalPathStaticGenerationV1(
  fs: RuntimeStateJournalFileSystemV1,
  generationDigest: VerificationActionKeyDigest
): DevelopmentCriticalPathStaticGenerationV1 {
  const objectPath = staticGenerationObjectPath(fs, generationDigest);
  if (!fs.exists(objectPath)) fail('static generation object is absent.');
  let value: unknown;
  try { value = JSON.parse(fs.readText(objectPath)) as unknown; } catch (error) {
    throw new Error('VerificationAction static generation object is invalid JSON.', { cause: error });
  }
  const generation = parseDevelopmentCriticalPathStaticGenerationV1(value);
  if (generation.generationDigest !== generationDigest) {
    fail('static generation object differs from its digest locator.');
  }
  return generation;
}

/**
 * Publish the analyzer result as one immutable content object plus one action
 * pointer. The pointer is only replaced after exact object-byte readback.
 */
export function publishVerificationActionStaticClosureV1(input: Readonly<{
  fs: RuntimeStateJournalFileSystemV1;
  closure: DevelopmentCriticalPathStaticClosureV1;
}>): DevelopmentCriticalPathStaticClosureV1 {
  const closure = parseDevelopmentCriticalPathStaticClosureV1(input.closure);
  const generation = publishDevelopmentCriticalPathStaticGenerationV1({
    fs: input.fs,
    generation: closure.analysisReadback.staticGeneration
  });
  if (generation.generationDigest !== closure.analysisReadback.staticGeneration.generationDigest) {
    fail('static closure generation durable readback mismatch.');
  }
  const bytes = `${encodeVerificationActionDataV2(closure)}\n`;
  const objectPath = staticClosureObjectPath(input.fs, closure.closureDigest);
  if (!input.fs.createExclusiveFsync(objectPath, bytes)
      && input.fs.readText(objectPath) !== bytes) {
    fail('immutable static closure object conflicts with its digest path.');
  }
  if (input.fs.readText(objectPath) !== bytes) fail('static closure object durable readback mismatch.');
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_STATIC_CLOSURE_POINTER_SCHEMA_V1,
    actionKey: closure.actionKey,
    closureDigest: closure.closureDigest,
    actionPlanDigest: closure.actionPlanDigest,
    actionPlanClosureDigest: closure.actionPlanClosureDigest,
    staticGenerationDigest: generation.generationDigest,
    headTreeSha: closure.analysisReadback.repository.headTreeSha,
    readbackDigest: closure.analysisReadback.readbackDigest
  });
  const pointer = Object.freeze({ ...material, pointerDigest: staticPointerDigest(material) });
  const pointerBytes = `${encodeVerificationActionDataV2(pointer)}\n`;
  const pointerPath = staticClosurePointerPath(input.fs, closure.actionKey);
  if (!input.fs.createExclusiveFsync(pointerPath, pointerBytes)) {
    const current = readVerificationActionStaticClosureV1(input.fs, closure.actionKey);
    if (current?.closureDigest !== closure.closureDigest) {
      fail('static closure pointer already binds a different plan, tree, dependency closure, or analyzer readback.');
    }
  }
  if (input.fs.readText(pointerPath) !== pointerBytes) fail('static closure pointer durable readback mismatch.');
  return readVerificationActionStaticClosureV1(input.fs, closure.actionKey) ?? fail('static closure publication disappeared.');
}

export function readVerificationActionStaticClosureV1(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): DevelopmentCriticalPathStaticClosureV1 | null {
  const pointerPath = staticClosurePointerPath(fs, actionKey);
  if (!fs.exists(pointerPath)) return null;
  let pointerValue: unknown;
  try { pointerValue = JSON.parse(fs.readText(pointerPath)) as unknown; } catch (error) {
    throw new Error('VerificationAction static closure pointer is invalid JSON.', { cause: error });
  }
  const pointer = parseStaticClosurePointerV1(pointerValue);
  if (pointer.actionKey !== actionKey) fail('static closure pointer action identity mismatch.');
  const objectPath = staticClosureObjectPath(fs, pointer.closureDigest);
  if (!fs.exists(objectPath)) fail('static closure pointer object is absent.');
  let closureValue: unknown;
  try { closureValue = JSON.parse(fs.readText(objectPath)) as unknown; } catch (error) {
    throw new Error('VerificationAction static closure object is invalid JSON.', { cause: error });
  }
  const closure = parseDevelopmentCriticalPathStaticClosureV1(closureValue);
  if (closure.actionKey !== pointer.actionKey || closure.closureDigest !== pointer.closureDigest
      || closure.actionPlanDigest !== pointer.actionPlanDigest
      || closure.actionPlanClosureDigest !== pointer.actionPlanClosureDigest
      || closure.analysisReadback.staticGeneration.generationDigest !== pointer.staticGenerationDigest
      || closure.analysisReadback.repository.headTreeSha !== pointer.headTreeSha
      || closure.analysisReadback.readbackDigest !== pointer.readbackDigest) {
    fail('static closure object differs from its current pointer binding.');
  }
  return closure;
}

/**
 * Closeout-only read surface. A retired current pointer is recoverable from
 * the durable retention receipt, while ordinary execution continues to see
 * no active static closure and therefore cannot accidentally reuse it.
 */
export function readVerificationActionRetainedStaticClosureV1(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): DevelopmentCriticalPathStaticClosureV1 | null {
  const current = readVerificationActionStaticClosureV1(fs, actionKey);
  if (current !== null) return current;
  const receiptPath = staticClosureRetentionPath(fs, actionKey);
  if (!fs.exists(receiptPath)) return null;
  const receipt = parseStaticClosureRetentionReceiptV1(JSON.parse(fs.readText(receiptPath)) as unknown);
  const objectPath = staticClosureObjectPath(fs, receipt.closureDigest);
  if (!fs.exists(objectPath)) fail('retained static closure object is absent.');
  const closure = parseDevelopmentCriticalPathStaticClosureV1(
    JSON.parse(fs.readText(objectPath)) as unknown
  );
  if (closure.actionKey !== receipt.actionKey || closure.closureDigest !== receipt.closureDigest
      || closure.actionPlanDigest !== receipt.actionPlanDigest
      || closure.actionPlanClosureDigest !== receipt.actionPlanClosureDigest
      || closure.analysisReadback.repository.headTreeSha !== receipt.headTreeSha) {
    fail('retained static closure differs from its retention receipt.');
  }
  return closure;
}

/**
 * Canonical production retirement: the trusted closeout consumer has already
 * consumed the exact closure and terminal Evidence into one settlement. The
 * mutable current pointer is retired, while the immutable closure, terminal
 * Evidence and a durable retention receipt remain available for audit and
 * crash recovery. This operation never deletes the content object.
 */
export function retireVerificationActionStaticClosureAfterTrustedSettlementV1(input: Readonly<{
  fs: RuntimeStateJournalFileSystemV1;
  actionKey: VerificationActionKeyDigest;
  sessionRevision: VerificationActionKeyDigest;
  artifactDigest: VerificationActionKeyDigest;
  settlementDigest: VerificationActionKeyDigest;
}>): VerificationActionStaticClosureRetirementCompletedV1 {
  for (const [label, value] of [
    ['session revision', input.sessionRevision],
    ['artifact digest', input.artifactDigest],
    ['settlement digest', input.settlementDigest]
  ] as const) {
    if (!/^sha256:[0-9a-f]{64}$/u.test(value)) fail(`static closure ${label} is invalid.`);
  }
  const closure = readVerificationActionRetainedStaticClosureV1(input.fs, input.actionKey);
  if (closure === null) fail('trusted settlement retirement has no current or retained static closure.');
  const journal = readVerificationActionJournalV2(input.fs, input.actionKey);
  if ((journal.latestState !== 'terminal' && journal.latestState !== 'reused')
      || journal.terminal === null || journal.evidence === null || journal.evidence === undefined) {
    fail('trusted settlement retirement requires durable terminal journal and provider Evidence.');
  }
  const terminalEvent = [...journal.events].reverse().find((event) => event.state === 'terminal');
  if (terminalEvent === undefined) fail('trusted settlement retirement has no terminal event.');
  const providerSettlement = readVerificationActionSettlementV1(input.fs, input.actionKey);
  if (providerSettlement === null || providerSettlement.state !== 'settled'
      || providerSettlement.evidenceDigest !== journal.evidence.evidenceDigest
      || providerSettlement.executionBindingDigest !== journal.evidence.executionBindingDigest) {
    fail('trusted settlement retirement requires exact durable provider settlement.');
  }
  const material = Object.freeze({
    schema: VERIFICATION_ACTION_STATIC_CLOSURE_RETENTION_SCHEMA_V1,
    actionKey: closure.actionKey,
    closureDigest: closure.closureDigest,
    actionPlanDigest: closure.actionPlanDigest,
    actionPlanClosureDigest: closure.actionPlanClosureDigest,
    headTreeSha: closure.analysisReadback.repository.headTreeSha,
    terminalEvidenceDigest: journal.evidence.evidenceDigest,
    terminalEventDigest: terminalEvent.eventDigest,
    sessionRevision: input.sessionRevision,
    artifactDigest: input.artifactDigest,
    settlementDigest: input.settlementDigest,
    providerSettlementDigest: providerSettlement.receiptDigest,
    retentionPolicy: 'retain-immutable-closure-and-terminal-evidence-v1' as const
  });
  const receipt = Object.freeze({ ...material, receiptDigest: staticRetentionDigest(material) });
  const receiptPath = staticClosureRetentionPath(input.fs, input.actionKey);
  const receiptBytes = `${encodeVerificationActionDataV2(receipt)}\n`;
  if (!input.fs.createExclusiveFsync(receiptPath, receiptBytes)
      && input.fs.readText(receiptPath) !== receiptBytes) {
    fail('static closure retention receipt conflicts with an earlier settlement.');
  }
  const readback = parseStaticClosureRetentionReceiptV1(
    JSON.parse(input.fs.readText(receiptPath)) as unknown
  );
  const pointerPath = staticClosurePointerPath(input.fs, input.actionKey);
  if (input.fs.exists(pointerPath)) {
    const expectedPointer = input.fs.readText(pointerPath);
    if (!input.fs.deleteFsyncCas(pointerPath, expectedPointer) && input.fs.exists(pointerPath)) {
      fail('static closure pointer changed during trusted settlement retirement.');
    }
  }
  if (input.fs.exists(pointerPath)) fail('static closure pointer remains after trusted settlement retirement.');
  const pointerDirectory = path.dirname(pointerPath);
  const sharedObjectReferences = input.fs.listOrdinaryFiles(pointerDirectory, 100_000)
    .map((filePath) => parseStaticClosurePointerV1(JSON.parse(input.fs.readText(filePath)) as unknown))
    .filter((pointer) => pointer.closureDigest === closure.closureDigest).length;
  return Object.freeze({
    disposition: 'retired' as const,
    actionKey: input.actionKey,
    phase: 'pointer-retired-object-retained' as const,
    blockers: Object.freeze([] as const),
    receipt: readback,
    sharedObjectReferences
  });
}

/**
 * Fail-closed retirement surface. No production owner currently publishes an
 * authenticated consumer-zero plus retention receipt, so this operation has
 * no filesystem capability and cannot accept a caller-authored proof. The
 * destructive implementation was removed rather than retained behind an
 * unreachable branch.
 */
export function retireVerificationActionStaticClosureV1(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
}>): VerificationActionStaticClosureRetirementOutcomeV1 {
  const actionKey = input.actionKey;
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) {
    fail('static closure retirement action key is invalid.');
  }
  return Object.freeze({
    disposition: 'blocked' as const,
    actionKey,
    phase: 'pointer-pending' as const,
    blockers: Object.freeze(['production-consumer-unwired'] as const),
    intent: null,
    sharedObjectReferences: 0 as const
  });
}

export function recoverVerificationActionStaticClosureRetirementV1(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
}>): VerificationActionStaticClosureRetirementOutcomeV1 {
  return retireVerificationActionStaticClosureV1(input);
}

function claimPath(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): string {
  return `${actionPath(fs, actionKey)}.claim.json`;
}

function recoveryLockPath(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): string {
  return `${actionPath(fs, actionKey)}.claim-recovery.lock`;
}

function ownerToken(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    fail('claim ownerToken must be bounded text.');
  }
  return value;
}

function parseClaim(source: string, expectedActionKey: VerificationActionKeyDigest): VerificationActionClaimV1 {
  let value: unknown;
  try { value = JSON.parse(source) as unknown; } catch (error) {
    throw new Error('VerificationAction claim is invalid JSON.', { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('claim must be an object.');
  const claim = value as Record<string, unknown>;
  const actual = Object.keys(claim).sort();
  const expected = ['schema', 'actionKey', 'ownerToken', 'acquiredAt', 'expiresAt'].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`claim must contain exactly: ${expected.join(', ')}.`);
  }
  if (claim.schema !== VERIFICATION_ACTION_CLAIM_SCHEMA_V1 || claim.actionKey !== expectedActionKey) {
    fail('claim identity mismatch.');
  }
  const acquiredAt = assertIsoDate(claim.acquiredAt);
  const expiresAt = assertIsoDate(claim.expiresAt);
  if (expiresAt <= acquiredAt) fail('claim expiry must be after acquisition.');
  return Object.freeze({
    schema: VERIFICATION_ACTION_CLAIM_SCHEMA_V1,
    actionKey: expectedActionKey,
    ownerToken: ownerToken(claim.ownerToken),
    acquiredAt,
    expiresAt
  });
}

function writeExclusiveClaim(
  filePath: string,
  claim: VerificationActionClaimV1,
  fs: RuntimeStateJournalFileSystemV1
): boolean {
  return fs.createExclusiveFsync(filePath, `${encodeVerificationActionDataV2(claim)}\n`);
}

function newClaim(
  actionKey: VerificationActionKeyDigest,
  token: string,
  now: string,
  leaseDurationMs: number
): VerificationActionClaimV1 {
  const acquiredAt = assertIsoDate(now);
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 86_400_000) {
    fail('leaseDurationMs must be between one second and one day.');
  }
  return Object.freeze({
    schema: VERIFICATION_ACTION_CLAIM_SCHEMA_V1,
    actionKey,
    ownerToken: ownerToken(token),
    acquiredAt,
    expiresAt: new Date(Date.parse(acquiredAt) + leaseDurationMs).toISOString()
  });
}

function withRecoveryLock<T>(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest,
  operation: () => T
): T | null {
  const filePath = recoveryLockPath(fs, actionKey);
  if (!fs.createExclusiveFsync(filePath, `${process.pid}:${randomUUID()}\n`)) return null;
  try { return operation(); } finally {
    if (!fs.deleteIfPresent(filePath)) fail('claim recovery lock disappeared.');
  }
}

export function readVerificationActionClaimV1(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): VerificationActionClaimV1 | null {
  const filePath = claimPath(fs, actionKey);
  if (!fs.exists(filePath)) return null;
  return parseClaim(fs.readText(filePath), actionKey);
}

export function acquireVerificationActionClaimV1(input: {
  readonly fs: RuntimeStateJournalFileSystemV1;
  readonly action: VerificationActionKeyV2;
  readonly ownerToken: string;
  readonly now: string;
  readonly leaseDurationMs?: number;
}): VerificationActionClaimOutcomeV1 {
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(input.action));
  const journal = readVerificationActionJournalV2(input.fs, action.actionKey);
  if ((journal.latestState === 'terminal' || journal.latestState === 'reused') && journal.terminal !== null) {
    return Object.freeze({ disposition: 'terminal', claim: null, terminal: journal.terminal, reason: null });
  }
  const lease = newClaim(action.actionKey, input.ownerToken, input.now, input.leaseDurationMs ?? 300_000);
  const fs = input.fs;
  fs.ensureDirectory(path.dirname(claimPath(fs, action.actionKey)));
  const recoveryObservationOnly = journal.latestState === 'queued' || journal.latestState === 'running';
  if (writeExclusiveClaim(claimPath(fs, action.actionKey), lease, fs)) {
    return Object.freeze({
      disposition: 'acquired',
      claim: lease,
      terminal: null,
      reason: recoveryObservationOnly
        ? `persisted ${journal.latestState} Action acquired for provider Evidence observation only`
        : null
    });
  }
  let existing: VerificationActionClaimV1;
  try {
    existing = readVerificationActionClaimV1(fs, action.actionKey)!;
  } catch {
    return Object.freeze({ disposition: 'blocked', claim: null, terminal: null, reason: 'claim is unreadable; fail closed' });
  }
  if (!recoveryObservationOnly && existing.ownerToken === lease.ownerToken && existing.expiresAt > lease.acquiredAt) {
    return Object.freeze({ disposition: 'acquired', claim: existing, terminal: null, reason: null });
  }
  if (existing.expiresAt > lease.acquiredAt) {
    return Object.freeze({ disposition: 'joined', claim: existing, terminal: null, reason: 'another process owns the live ActionKey claim' });
  }
  if (!recoveryObservationOnly) {
    return Object.freeze({
      disposition: 'blocked',
      claim: existing,
      terminal: null,
      reason: 'expired physical owner has no provable terminal; blind re-execution is forbidden'
    });
  }
  const recovered = withRecoveryLock(fs, action.actionKey, () => {
    const current = readVerificationActionClaimV1(fs, action.actionKey);
    if (current === null || current.actionKey !== existing.actionKey ||
        current.ownerToken !== existing.ownerToken || current.acquiredAt !== existing.acquiredAt ||
        current.expiresAt !== existing.expiresAt ||
        current.expiresAt > lease.acquiredAt) return null;
    if (!fs.deleteIfPresent(claimPath(fs, action.actionKey))) return null;
    if (!writeExclusiveClaim(claimPath(fs, action.actionKey), lease, fs)) return null;
    return lease;
  });
  if (recovered === null) {
    return Object.freeze({
      disposition: 'contended',
      claim: existing,
      terminal: null,
      reason: 'provider Evidence recovery claim changed during expected-old replacement'
    });
  }
  return Object.freeze({
    disposition: 'acquired',
    claim: recovered,
    terminal: null,
    reason: `expired ${journal.latestState} owner replaced for provider Evidence observation only`
  });
}

export function releaseVerificationActionClaimV1(input: {
  readonly fs: RuntimeStateJournalFileSystemV1;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
}): boolean {
  const released = withRecoveryLock(input.fs, input.actionKey, () => {
    const existing = readVerificationActionClaimV1(input.fs, input.actionKey);
    if (existing === null) return false;
    if (existing.ownerToken !== ownerToken(input.ownerToken)) fail('claim release owner mismatch.');
    input.fs.deleteIfPresent(claimPath(input.fs, input.actionKey));
    return true;
  });
  return released ?? false;
}

export function renewVerificationActionClaimV1(input: {
  readonly fs: RuntimeStateJournalFileSystemV1;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
  readonly now: string;
  readonly leaseDurationMs: number;
}): boolean {
  const renewed = withRecoveryLock(input.fs, input.actionKey, () => {
    const existing = readVerificationActionClaimV1(input.fs, input.actionKey);
    const now = assertIsoDate(input.now);
    if (existing === null || existing.ownerToken !== ownerToken(input.ownerToken) || existing.expiresAt <= now) return false;
    const extension = newClaim(input.actionKey, input.ownerToken, now, input.leaseDurationMs);
    const replacement = Object.freeze({ ...extension, acquiredAt: existing.acquiredAt });
    const filePath = claimPath(input.fs, input.actionKey);
    input.fs.replaceFsync(filePath, `${encodeVerificationActionDataV2(replacement)}\n`);
    return true;
  });
  return renewed ?? false;
}

/**
 * The sole terminal commit path.  Evidence is durably published before this
 * function is called, and the claim remains held until the provider releases
 * its one-shot resource and the runner invokes releaseVerificationActionClaimV1.
 */
export function commitVerificationActionEvidenceTerminalUnderClaimV1(input: Readonly<{
  fs: RuntimeStateJournalFileSystemV1;
  action: VerificationActionKeyV2;
  ownerToken: string;
  now: string;
  recordedAt?: string;
  actionPlanDigest: VerificationActionKeyDigest;
  executionBindingDigest: VerificationActionKeyDigest;
  staticClosureDigest: VerificationActionKeyDigest;
  evidence: VerificationActionEvidenceV1;
  note?: string | null;
}>): VerificationActionJournalEventV2 | null {
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(input.action));
  if (input.evidence.actionKey !== action.actionKey ||
      input.evidence.actionPlanDigest !== input.actionPlanDigest ||
      input.evidence.executionBindingDigest !== input.executionBindingDigest ||
      input.evidence.staticClosureDigest !== input.staticClosureDigest ||
      encodeVerificationActionDataV2(input.evidence.terminal) !==
        encodeVerificationActionDataV2(createVerificationActionTerminalV2(input.evidence.terminal))) {
    fail('terminal Evidence binding does not match the Action commit.');
  }
  return withRecoveryLock(input.fs, action.actionKey, () => {
    const existing = readVerificationActionClaimV1(input.fs, action.actionKey);
    const now = assertIsoDate(input.now);
    if (existing === null || existing.ownerToken !== ownerToken(input.ownerToken) || existing.expiresAt <= now) return null;
    const journal = readVerificationActionJournalV2(input.fs, action.actionKey);
    const start = readVerificationActionStartReceiptV1(input.fs, action.actionKey);
    if (start === null ||
        start.actionKey !== action.actionKey ||
        start.actionPlanDigest !== input.actionPlanDigest ||
        start.executionBindingDigest !== input.executionBindingDigest ||
        start.staticClosureDigest !== input.staticClosureDigest ||
        start.providerRevision !== input.evidence.providerRevision) {
      fail('terminal Evidence commit requires the exact durable start receipt binding.');
    }
    if (journal.evidence === null || journal.evidence === undefined ||
        journal.evidence.evidenceDigest !== input.evidence.evidenceDigest) {
      fail('provider Evidence was not durably published before terminal commit.');
    }
    if (encodeVerificationActionDataV2(journal.evidence) !==
        encodeVerificationActionDataV2(input.evidence)) {
      fail('durable provider Evidence differs from the claimed terminal input.');
    }
    if (journal.latestState === 'terminal' || journal.latestState === 'reused') {
      if (journal.terminal === null ||
          encodeVerificationActionDataV2(journal.terminal) !== encodeVerificationActionDataV2(input.evidence.terminal)) {
        fail('existing terminal differs from provider Evidence.');
      }
      return journal.events.at(-1) ?? null;
    }
    if (journal.latestState !== 'running') {
      fail('terminal Evidence commit requires the claimed Action to be running.');
    }
    const event = appendVerificationActionJournalEventInternalV2({
      fs: input.fs,
      action,
      state: 'terminal',
      recordedAt: input.recordedAt,
      terminal: input.evidence.terminal,
      note: input.note
    }, true);
    const readback = readVerificationActionJournalV2(input.fs, action.actionKey);
    assertVerificationActionEvidenceJournalBindingV1({
      journal: readback,
      actionKey: action.actionKey,
      actionPlanDigest: input.actionPlanDigest,
      executionBindingDigest: input.executionBindingDigest,
      staticClosureDigest: input.staticClosureDigest
    });
    return event;
  });
}

export function revokeVerificationActionClaimV1(input: {
  readonly fs: RuntimeStateJournalFileSystemV1;
  readonly action: VerificationActionKeyV2;
  readonly state: 'invalidated' | 'cancelled';
  readonly recordedAt?: string;
  readonly note: string;
}): VerificationActionJournalReadbackV2 {
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(input.action));
  const revoked = withRecoveryLock(input.fs, action.actionKey, () => {
    const current = readVerificationActionJournalV2(input.fs, action.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' || current.latestState === 'cancelled') return current;
    appendVerificationActionJournalEventV2({
      fs: input.fs,
      action,
      state: input.state,
      recordedAt: input.recordedAt,
      terminal: null,
      note: input.note
    });
    const activeClaimPath = claimPath(input.fs, action.actionKey);
    input.fs.deleteIfPresent(activeClaimPath);
    return readVerificationActionJournalV2(input.fs, action.actionKey);
  });
  if (revoked === null) fail('claim revocation is contended; fail closed.');
  return revoked;
}

function assertTransition(
  previous: VerificationActionJournalStateV2 | null,
  next: VerificationActionJournalStateV2
): void {
  if (previous === null && next !== 'queued') fail('must begin with queued.');
  if (previous === null) return;
  const allowed: Readonly<Record<VerificationActionJournalStateV2, readonly VerificationActionJournalStateV2[]>> = {
    queued: ['running', 'invalidated', 'cancelled'],
    running: ['running', 'terminal', 'invalidated', 'cancelled'],
    terminal: ['reused', 'invalidated', 'cancelled'],
    reused: ['reused', 'invalidated', 'cancelled'],
    invalidated: [],
    cancelled: []
  };
  if (!allowed[previous].includes(next)) {
    fail(`contains illegal transition ${previous} -> ${next}.`);
  }
}

function validateEvent(
  candidate: unknown,
  expectedActionKey: VerificationActionKeyDigest,
  previous: VerificationActionJournalEventV2 | null,
  sequence: number
): VerificationActionJournalEventV2 {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail(`event ${sequence} must be an object.`);
  }
  const value = candidate as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'sequence', 'actionKey', 'action', 'state', 'recordedAt', 'terminal', 'note',
    'previousDigest', 'eventDigest'
  ]);
  if (value.schema !== VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V2) {
    fail(`event ${sequence} schema mismatch; V1 journal records are not reusable.`);
  }
  if (value.sequence !== sequence) fail(`event ${sequence} has a non-contiguous sequence.`);
  if (value.actionKey !== expectedActionKey) fail(`event ${sequence} action key mismatch.`);
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(value.action));
  if (action.actionKey !== expectedActionKey) fail(`event ${sequence} embedded action mismatch.`);
  const state = assertState(value.state);
  assertTransition(previous?.state ?? null, state);
  const previousDigest = assertDigest(value.previousDigest, `event ${sequence} previousDigest`);
  if ((previous?.eventDigest ?? null) !== previousDigest) {
    fail(`event ${sequence} previousDigest does not match the chain.`);
  }
  const terminal = value.terminal === null
    ? null
    : createVerificationActionTerminalV2(value.terminal);
  if ((state === 'terminal' || state === 'reused') && terminal === null) {
    fail(`event ${sequence} ${state} state requires a terminal result.`);
  }
  if (state !== 'terminal' && state !== 'reused' && terminal !== null) {
    fail(`event ${sequence} ${state} state cannot carry a terminal result.`);
  }
  const withoutDigest = {
    schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V2,
    sequence,
    actionKey: expectedActionKey,
    action,
    state,
    recordedAt: assertIsoDate(value.recordedAt),
    terminal,
    note: assertNote(value.note),
    previousDigest
  } satisfies Omit<VerificationActionJournalEventV2, 'eventDigest'>;
  if (value.eventDigest !== eventDigest(withoutDigest)) {
    fail(`event ${sequence} digest mismatch.`);
  }
  return Object.freeze({ ...withoutDigest, eventDigest: value.eventDigest as VerificationActionKeyDigest });
}

function emptyReadback(
  filePath: string,
  schemaState: 'current' | 'stale' = 'current'
): VerificationActionJournalReadbackV2 {
  return Object.freeze({
    filePath,
    schemaState,
    action: null,
    events: Object.freeze([]),
    latestState: null,
    terminal: null,
    startReceipt: null,
    evidence: null
  });
}

function parseJournalSource(
  filePath: string,
  actionKey: VerificationActionKeyDigest,
  source: string | null
): VerificationActionJournalReadbackV2 {
  if (source === null) return emptyReadback(filePath);
  if (source.length === 0 || !source.endsWith('\n')) fail('has a missing or partial final line.');
  const lines = source.slice(0, -1).split('\n');
  const parsedLines = lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`VerificationAction journal event ${index + 1} is invalid JSON.`, { cause: error });
    }
  });
  const isWhollyLegacy = parsedLines.length > 0 && parsedLines.every((candidate) => (
    candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) &&
    (candidate as Record<string, unknown>).schema === LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1
  ));
  if (isWhollyLegacy) return emptyReadback(filePath, 'stale');
  const events: VerificationActionJournalEventV2[] = [];
  let previous: VerificationActionJournalEventV2 | null = null;
  for (let index = 0; index < parsedLines.length; index += 1) {
    const event = validateEvent(parsedLines[index], actionKey, previous, index + 1);
    events.push(event);
    previous = event;
  }
  const latest = events.at(-1) ?? null;
  const terminal = latest !== null && (latest.state === 'terminal' || latest.state === 'reused')
    ? latest.terminal
    : null;
  return Object.freeze({
    filePath,
    schemaState: 'current',
    action: events[0]?.action ?? null,
    events: Object.freeze(events),
    latestState: latest?.state ?? null,
    terminal
  });
}

function terminalHistoryCompactionBaseV2(
  events: readonly VerificationActionJournalEventV2[]
): readonly VerificationActionJournalEventV2[] | null {
  if (events.length < VERIFICATION_ACTION_JOURNAL_TERMINAL_HISTORY_LIMIT_V2
      || events.at(-1)?.state !== 'reused') return null;
  const prefix = events.filter((event) => event.state !== 'reused');
  const terminal = prefix.at(-1);
  if (prefix.length < 3 || terminal?.state !== 'terminal' || terminal.terminal === null) {
    fail('terminal history exceeded its bounded compaction shape; a new ActionKey is required.');
  }
  if (prefix.some((event, index) => event.sequence !== index + 1)) {
    fail('terminal history compaction requires a contiguous lifecycle prefix.');
  }
  return Object.freeze(prefix);
}

export function readVerificationActionJournalV2(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): VerificationActionJournalReadbackV2 {
  const filePath = actionPath(fs, actionKey);
  const source = fs.exists(filePath) ? fs.readText(filePath) : null;
  const journal = parseJournalSource(filePath, actionKey, source);
  const startPath = actionStartReceiptPath(fs, actionKey);
  const evidencePath = actionEvidencePath(fs, actionKey);
  const startReceipt = fs.exists(startPath)
    ? parseVerificationActionStartReceiptV1(fs.readText(startPath))
    : null;
  const evidence = fs.exists(evidencePath)
    ? parseVerificationActionEvidenceV1(fs.readText(evidencePath))
    : null;
  if (startReceipt !== null && startReceipt.actionKey !== actionKey) {
    fail('start receipt action identity differs from its path.');
  }
  if (evidence !== null && evidence.actionKey !== actionKey) {
    fail('Evidence action identity differs from its path.');
  }
  return Object.freeze({ ...journal, startReceipt, evidence });
}

export function publishVerificationActionStartReceiptV1(input: Readonly<{
  fs: RuntimeStateJournalFileSystemV1;
  receipt: Omit<VerificationActionStartReceiptV1, 'schema' | 'startDigest'>;
}>): VerificationActionStartReceiptV1 {
  const receipt = createVerificationActionStartReceiptV1(input.receipt);
  const filePath = actionStartReceiptPath(input.fs, receipt.actionKey);
  const bytes = `${encodeVerificationActionDataV2(receipt)}\n`;
  input.fs.ensureDirectory(path.dirname(filePath));
  if (!input.fs.createExclusiveFsync(filePath, bytes) && input.fs.readText(filePath) !== bytes) {
    fail('start receipt already exists with a different binding.');
  }
  if (input.fs.readText(filePath) !== bytes) fail('start receipt durable readback differs.');
  return parseVerificationActionStartReceiptV1(input.fs.readText(filePath));
}

export function readVerificationActionStartReceiptV1(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): VerificationActionStartReceiptV1 | null {
  const filePath = actionStartReceiptPath(fs, actionKey);
  return fs.exists(filePath) ? parseVerificationActionStartReceiptV1(fs.readText(filePath)) : null;
}

export function publishVerificationActionEvidenceV1(input: Readonly<{
  fs: RuntimeStateJournalFileSystemV1;
  evidence: Omit<VerificationActionEvidenceV1, 'schema' | 'evidenceDigest'>;
}>): VerificationActionEvidenceV1 {
  const evidence = createVerificationActionEvidenceV1(input.evidence);
  const filePath = actionEvidencePath(input.fs, evidence.actionKey);
  const bytes = `${encodeVerificationActionDataV2(evidence)}\n`;
  input.fs.ensureDirectory(path.dirname(filePath));
  if (!input.fs.createExclusiveFsync(filePath, bytes) && input.fs.readText(filePath) !== bytes) {
    fail('terminal Evidence already exists with a different binding.');
  }
  if (input.fs.readText(filePath) !== bytes) fail('terminal Evidence durable readback differs.');
  return parseVerificationActionEvidenceV1(input.fs.readText(filePath));
}

export function readVerificationActionEvidenceV1(
  fs: RuntimeStateJournalFileSystemV1,
  actionKey: VerificationActionKeyDigest
): VerificationActionEvidenceV1 | null {
  const filePath = actionEvidencePath(fs, actionKey);
  return fs.exists(filePath) ? parseVerificationActionEvidenceV1(fs.readText(filePath)) : null;
}

export function assertVerificationActionEvidenceJournalBindingV1(input: Readonly<{
  journal: VerificationActionJournalReadbackV2;
  actionKey: VerificationActionKeyDigest;
  actionPlanDigest: VerificationActionKeyDigest;
  executionBindingDigest: VerificationActionKeyDigest;
  staticClosureDigest: VerificationActionKeyDigest;
}>): VerificationActionEvidenceV1 {
  const evidence = input.journal.evidence;
  const terminal = input.journal.terminal;
  if (input.journal.latestState !== 'terminal' && input.journal.latestState !== 'reused') {
    fail('Evidence/journal binding requires a terminal journal state.');
  }
  if (evidence === null || evidence === undefined || terminal === null) fail('terminal Evidence is missing.');
  if (evidence.actionKey !== input.actionKey || evidence.actionPlanDigest !== input.actionPlanDigest ||
      evidence.executionBindingDigest !== input.executionBindingDigest ||
      evidence.staticClosureDigest !== input.staticClosureDigest ||
      encodeVerificationActionDataV2(evidence.terminal) !== encodeVerificationActionDataV2(terminal)) {
    fail('terminal Evidence does not match the journal terminal projection.');
  }
  return evidence;
}

type AppendVerificationActionJournalEventInputV2 = {
  fs: RuntimeStateJournalFileSystemV1;
  action: VerificationActionKeyV2;
  state: VerificationActionJournalStateV2;
  recordedAt?: string;
  terminal?: VerificationActionTerminalV2 | null;
  note?: string | null;
};

function appendVerificationActionJournalEventInternalV2(
  input: AppendVerificationActionJournalEventInputV2,
  terminalAuthority: boolean
): VerificationActionJournalEventV2 {
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(input.action));
  const fs = input.fs;
  const filePath = actionPath(fs, action.actionKey);
  const source = fs.exists(filePath) ? fs.readText(filePath) : null;
  const current = parseJournalSource(filePath, action.actionKey, source);
  if (current.schemaState === 'stale') fs.deleteIfPresent(current.filePath);
  if (current.action !== null && current.action.actionKey !== action.actionKey) {
    fail('embedded action identity changed.');
  }
  const compactionBase = current.schemaState === 'stale'
    ? null
    : terminalHistoryCompactionBaseV2(current.events);
  const previous = compactionBase !== null
    ? compactionBase.at(-1) ?? null
    : current.schemaState === 'stale' ? null : current.events.at(-1) ?? null;
  const state = assertState(input.state);
  if (state === 'terminal' && !terminalAuthority) {
    fail('terminal state is owned exclusively by the durable start plus provider Evidence commit path.');
  }
  assertTransition(previous?.state ?? null, state);
  const terminal = input.terminal === undefined || input.terminal === null
    ? null
    : createVerificationActionTerminalV2(input.terminal);
  if ((state === 'terminal' || state === 'reused') && terminal === null) {
    fail(`${state} state requires a terminal result.`);
  }
  if (state !== 'terminal' && state !== 'reused' && terminal !== null) {
    fail(`${state} state cannot carry a terminal result.`);
  }
  const compactionNote = compactionBase === null ? null : (
    `terminal reuse history compacted; omitted=${current.events.length - compactionBase.length}`
  );
  const withoutDigest = {
    schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V2,
    sequence: (previous?.sequence ?? 0) + 1,
    actionKey: action.actionKey,
    action,
    state,
    recordedAt: assertIsoDate(input.recordedAt ?? new Date().toISOString()),
    terminal,
    note: assertNote(compactionNote ?? input.note ?? null),
    previousDigest: previous?.eventDigest ?? null
  } satisfies Omit<VerificationActionJournalEventV2, 'eventDigest'>;
  const event = Object.freeze({ ...withoutDigest, eventDigest: eventDigest(withoutDigest) });
  fs.ensureDirectory(path.dirname(filePath));
  if (compactionBase !== null) {
    const compactedSource = `${[
      ...compactionBase,
      event
    ].map((entry) => encodeVerificationActionDataV2(entry)).join('\n')}\n`;
    fs.replaceFsync(filePath, compactedSource);
    if (fs.readText(filePath) !== compactedSource) {
      fail('terminal history compaction readback differs from the requested bounded bytes.');
    }
  } else {
    const expected = current.schemaState === 'stale' ? '' : source ?? '';
    if (!fs.appendFsyncCas(filePath, expected, `${encodeVerificationActionDataV2(event)}\n`)) {
      fail('changed concurrently; resume from fresh readback.');
    }
  }
  return event;
}

/**
 * Public lifecycle append surface.  It cannot publish terminal; the sole
 * terminal writer is commitVerificationActionEvidenceTerminalUnderClaimV1.
 */
export function appendVerificationActionJournalEventV2(
  input: AppendVerificationActionJournalEventInputV2
): VerificationActionJournalEventV2 {
  return appendVerificationActionJournalEventInternalV2(input, false);
}
