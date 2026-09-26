/**
 * Durable local append/readback journal for diagnostic-bound VerificationAction facts.
 *
 * Runtime bytes live in the canonical SEC workspace-state root, never in the
 * repository tree. The old V2 grammar is retained only as migration/recovery
 * evidence. Normal reads and writes accept exactly the diagnostic-bound grammar.
 */

import { randomUUID } from 'node:crypto';
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
import { hostname } from 'node:os';
import path from 'node:path';

import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { parseExactJson } from '../../../../contracts/exact-json.ts';
import { PHYSICAL_MUTATION_LEASE_SCHEMA } from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import {
  inspectExactNoFollowDirectoryPresence,
  scanNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeSelectedForest,
  type NoFollowDirectoryTreeEntry
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  runtimeStateJournalMutationLeaseName,
  type RuntimeStateJournalFileSystem,
  type RuntimeStateJournalRetainedText
} from '../../../runtime-state/workspace-state/journal-filesystem.ts';
import {
  createVerificationActionTerminal,
  encodeVerificationActionData,
  parseVerificationActionKey,
  type VerificationActionKey,
  type VerificationActionKeyDigest,
  type VerificationActionTerminal
} from './contract/action.ts';
import {
  VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE,
  parseVerificationActionProviderStartMarker,
  parseVerificationActionProviderTerminalAnchor,
  type VerificationActionProviderStartMarker,
  type VerificationActionProviderTerminalAnchor
} from './contract/provider.ts';

export const VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA =
  'sec-verification-action-terminal-bound-journal-event' as const;
export const VERIFICATION_ACTION_JOURNAL_DIRECTORY =
  'verification-actions/terminal-bound' as const;
const VERIFICATION_ACTION_CLAIM_SCHEMA =
  'sec-verification-action-terminal-bound-claim' as const;

const LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA =
  'sec-verification-action-journal-event-v2' as const;
const LEGACY_VERIFICATION_ACTION_CLAIM_SCHEMA =
  'sec-verification-action-claim-v1' as const;
const LEGACY_VERIFICATION_ACTION_JOURNAL_DIRECTORY =
  'verification-actions/v2' as const;
const VERIFICATION_ACTION_JOURNAL_CUTOVER_INTENT_SCHEMA =
  'sec-verification-action-journal-cutover-intent' as const;
const VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA =
  'sec-verification-action-machine-cutover' as const;
const VERIFICATION_ACTION_LEGACY_QUARANTINE_SCHEMA =
  'sec-verification-action-legacy-terminal-quarantine' as const;
export const VERIFICATION_ACTION_MACHINE_CUTOVER_FILE =
  'machine-cutover.json' as const;
export const VERIFICATION_ACTION_LEGACY_QUARANTINE_SUFFIX =
  '.legacy-quarantine.json' as const;
const JOURNAL_READ_BOUNDS = Object.freeze({
  maximumBytes: 16 * 1024 * 1024,
  maximumEvents: 4096,
  durationMs: 30_000
});
const JOURNAL_EVENT_KEYS = Object.freeze([
  'schema', 'sequence', 'actionKey', 'action', 'state', 'recordedAt', 'terminal', 'note',
  'previousDigest', 'eventDigest'
]);
const RETIRED_LEGACY_JOURNAL_EVENT_KEYS = Object.freeze([
  ...JOURNAL_EVENT_KEYS,
  'executionBindingDigest'
]);
const CLAIM_KEYS = Object.freeze([
  'schema', 'actionKey', 'ownerToken', 'acquiredAt', 'expiresAt'
]);
const CUTOVER_INTENT_KEYS = Object.freeze([
  'schema', 'phase', 'actionKey', 'sourcePhysical', 'sourceLedgerDigest', 'sourceByteLength',
  'targetPhysical', 'targetLedgerDigest', 'targetByteLength', 'eventCount', 'intentDigest'
]);
const MACHINE_CUTOVER_KEYS = Object.freeze([
  'schema', 'sourceInventoryDigest', 'sourceRecordCount', 'sourceByteLength',
  'targetIndexDigest', 'targetActionCount', 'legacyEvidenceDisposition', 'receiptDigest'
]);
const LEGACY_QUARANTINE_KEYS = Object.freeze([
  'schema', 'actionKey', 'action', 'classification', 'sourceEvidence',
  'reuseDisposition', 'executionDisposition', 'legacyEvidenceDisposition', 'receiptDigest'
]);
const LEGACY_QUARANTINE_EVIDENCE_KEYS = Object.freeze([
  'path', 'physical', 'ledgerDigest', 'byteLength'
]);

interface VerificationActionMachineCutoverReceipt {
  readonly schema: typeof VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA;
  readonly sourceInventoryDigest: VerificationActionKeyDigest;
  readonly sourceRecordCount: number;
  readonly sourceByteLength: number;
  readonly targetIndexDigest: VerificationActionKeyDigest;
  readonly targetActionCount: number;
  readonly legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement';
  readonly receiptDigest: VerificationActionKeyDigest;
}

interface VerificationActionLegacyQuarantineEvidence {
  readonly path: string;
  readonly physical: Readonly<{ device: string; inode: string }>;
  readonly ledgerDigest: VerificationActionKeyDigest;
  readonly byteLength: number;
}

interface VerificationActionLegacyQuarantineReceipt {
  readonly schema: typeof VERIFICATION_ACTION_LEGACY_QUARANTINE_SCHEMA;
  readonly actionKey: VerificationActionKeyDigest;
  readonly action: VerificationActionKey | null;
  readonly classification:
    | 'legacy-terminal-missing-bound-attempt-and-owner-terminal-receipt'
    | 'legacy-action-contract-retired-unusable';
  readonly sourceEvidence: readonly VerificationActionLegacyQuarantineEvidence[];
  readonly reuseDisposition: 'forbidden';
  readonly executionDisposition: 'same-action-key-forbidden';
  readonly legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement';
  readonly receiptDigest: VerificationActionKeyDigest;
}

type JournalCutoverPhase = 'prepared' | 'complete';

interface VerificationActionJournalCutoverIntent {
  readonly schema: typeof VERIFICATION_ACTION_JOURNAL_CUTOVER_INTENT_SCHEMA;
  readonly phase: JournalCutoverPhase;
  readonly actionKey: VerificationActionKeyDigest;
  readonly sourcePhysical: Readonly<{ device: string; inode: string }>;
  readonly sourceLedgerDigest: VerificationActionKeyDigest;
  readonly sourceByteLength: number;
  readonly targetPhysical: Readonly<{ device: string; inode: string }> | null;
  readonly targetLedgerDigest: VerificationActionKeyDigest;
  readonly targetByteLength: number;
  readonly eventCount: number;
  readonly intentDigest: VerificationActionKeyDigest;
}

type VerificationActionLegacyRecoveryDisposition =
  | 'absent'
  | 'migratable'
  | 'preserved-unmigratable';

export interface VerificationActionLegacyRecoveryObservation {
  readonly disposition: VerificationActionLegacyRecoveryDisposition;
  readonly actionKey: VerificationActionKeyDigest;
  readonly sourceLedgerDigest: VerificationActionKeyDigest | null;
  readonly eventCount: number;
  readonly reason: string | null;
}

export function writeVerificationActionStartMarkerAtomic(
  filePath: string,
  marker: VerificationActionProviderStartMarker
): void {
  const canonical = parseVerificationActionProviderStartMarker(marker);
  if (path.basename(filePath) !== VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE) {
    fail(`start marker file must be ${VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE}.`);
  }
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  const bytes = `${encodeVerificationActionData(canonical)}\n`;
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

export function writeVerificationActionTerminalStatusAnchorAtomic(
  filePath: string,
  anchor: VerificationActionProviderTerminalAnchor
): void {
  const canonical = parseVerificationActionProviderTerminalAnchor(anchor);
  if (path.basename(filePath) !== VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE) {
    fail(`terminal status anchor file must be ${VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE}.`);
  }
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  const bytes = `${encodeVerificationActionData(canonical)}\n`;
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

export interface VerificationActionClaim {
  readonly schema: typeof VERIFICATION_ACTION_CLAIM_SCHEMA;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

type VerificationActionClaimDisposition =
  | 'acquired'
  | 'joined'
  | 'terminal'
  | 'contended'
  | 'blocked';

export interface VerificationActionClaimOutcome {
  readonly disposition: VerificationActionClaimDisposition;
  readonly claim: VerificationActionClaim | null;
  readonly terminal: VerificationActionTerminal | null;
  readonly reason: string | null;
}

export type VerificationActionJournalState =
  | 'queued'
  | 'running'
  | 'terminal'
  | 'reused'
  | 'invalidated'
  | 'cancelled';

export interface VerificationActionJournalEvent {
  schema: typeof VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA;
  sequence: number;
  actionKey: VerificationActionKeyDigest;
  action: VerificationActionKey;
  state: VerificationActionJournalState;
  recordedAt: string;
  terminal: VerificationActionTerminal | null;
  note: string | null;
  previousDigest: VerificationActionKeyDigest | null;
  eventDigest: VerificationActionKeyDigest;
}

export interface VerificationActionJournalReadback {
  readonly filePath: string;
  readonly action: VerificationActionKey | null;
  readonly events: readonly VerificationActionJournalEvent[];
  readonly latestState: VerificationActionJournalState | null;
  readonly terminal: VerificationActionTerminal | null;
  readonly recoveryDisposition: VerificationActionLegacyQuarantineReceipt | null;
}

export type VerificationActionJournalFailureKind =
  | 'corrupt-journal'
  | 'recovery-required';

export class VerificationActionJournalError extends Error {
  readonly kind: VerificationActionJournalFailureKind;

  constructor(kind: VerificationActionJournalFailureKind, message: string, options?: ErrorOptions) {
    super(`VerificationAction journal ${message}`, options);
    this.name = 'VerificationActionJournalError';
    this.kind = kind;
  }
}

function fail(
  message: string,
  kind: VerificationActionJournalFailureKind = 'corrupt-journal'
): never {
  throw new VerificationActionJournalError(kind, message);
}

function assertIsoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    fail('recordedAt must be an ISO-8601 UTC timestamp.');
  }
  return value;
}

function assertNote(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 1024
      || Buffer.byteLength(value, 'utf8') > 1024
      || /[\u0000-\u001f]/u.test(value)) {
    fail('note must be null or bounded text.');
  }
  return value;
}

function assertState(value: unknown): VerificationActionJournalState {
  if (![
    'queued', 'running', 'terminal', 'reused', 'invalidated', 'cancelled'
  ].includes(String(value))) {
    fail('state is invalid.');
  }
  return value as VerificationActionJournalState;
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

function eventWithoutDigest(event: Omit<VerificationActionJournalEvent, 'eventDigest'>): string {
  return encodeVerificationActionData(event);
}

function eventDigest(
  event: Omit<VerificationActionJournalEvent, 'eventDigest'>
): VerificationActionKeyDigest {
  return `sha256:${rawSha256Hex(eventWithoutDigest(event))}`;
}

function actionPath(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('action key is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY,
    `${actionKey.slice(7)}.jsonl`
  );
}

function legacyActionPath(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('action key is invalid.');
  return path.join(
    fs.rootPath,
    LEGACY_VERIFICATION_ACTION_JOURNAL_DIRECTORY,
    `${actionKey.slice(7)}.jsonl`
  );
}

function cutoverIntentPath(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): string {
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY,
    `${actionKey.slice(7)}.cutover.json`
  );
}

function legacyQuarantinePath(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('action key is invalid.');
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY,
    `${actionKey.slice(7)}${VERIFICATION_ACTION_LEGACY_QUARANTINE_SUFFIX}`
  );
}

function sha256(source: string | Buffer): VerificationActionKeyDigest {
  return `sha256:${rawSha256Hex(source)}`;
}

function observeJournalSource(
  fs: RuntimeStateJournalFileSystem,
  filePath: string,
  deadlineAtMonotonicMs: number
): RuntimeStateJournalRetainedText | null {
  return fs.observeTextRetained(filePath, {
    deadlineAtMonotonicMs,
    maximumBytes: JOURNAL_READ_BOUNDS.maximumBytes
  });
}

function samePhysical(
  left: Readonly<{ device: string; inode: string }>,
  right: Readonly<{ device: string; inode: string }>
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function quarantineReceiptDigest(
  input: Omit<VerificationActionLegacyQuarantineReceipt, 'receiptDigest'>
): VerificationActionKeyDigest {
  return sha256(encodeVerificationActionData(input));
}

function canonicalQuarantineEvidence(
  evidence: readonly VerificationActionLegacyQuarantineEvidence[]
): readonly VerificationActionLegacyQuarantineEvidence[] {
  const sorted = [...evidence].sort((left, right) => left.path.localeCompare(right.path));
  if (sorted.length === 0) fail('legacy quarantine requires source evidence.');
  for (const [index, entry] of sorted.entries()) {
    const normalized = entry.path.replaceAll('\\', '/');
    if (entry.path !== normalized || path.posix.isAbsolute(normalized)
        || normalized.length === 0 || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      fail('legacy quarantine evidence path is noncanonical.');
    }
    if (index > 0 && sorted[index - 1]!.path === entry.path) {
      fail('legacy quarantine evidence paths are not unique.');
    }
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) {
      fail('legacy quarantine evidence byteLength is invalid.');
    }
    assertDigest(entry.ledgerDigest, 'legacy quarantine evidence ledgerDigest');
    if (entry.physical.device.length === 0 || entry.physical.inode.length === 0) {
      fail('legacy quarantine evidence physical identity is invalid.');
    }
  }
  return Object.freeze(sorted.map((entry) => Object.freeze({
    path: entry.path,
    physical: Object.freeze({ ...entry.physical }),
    ledgerDigest: entry.ledgerDigest,
    byteLength: entry.byteLength
  })));
}

function canonicalLegacyQuarantineReceipt(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  action: VerificationActionKey | null;
  sourceEvidence: readonly VerificationActionLegacyQuarantineEvidence[];
}>): VerificationActionLegacyQuarantineReceipt {
  const action = input.action === null
    ? null
    : parseVerificationActionKey(encodeVerificationActionData(input.action));
  if (action !== null && action.actionKey !== input.actionKey) {
    fail('legacy quarantine action identity mismatch.');
  }
  const unsigned = {
    schema: VERIFICATION_ACTION_LEGACY_QUARANTINE_SCHEMA,
    actionKey: input.actionKey,
    action,
    classification: action === null
      ? 'legacy-action-contract-retired-unusable' as const
      : 'legacy-terminal-missing-bound-attempt-and-owner-terminal-receipt' as const,
    sourceEvidence: canonicalQuarantineEvidence(input.sourceEvidence),
    reuseDisposition: 'forbidden' as const,
    executionDisposition: 'same-action-key-forbidden' as const,
    legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement' as const
  };
  return Object.freeze({ ...unsigned, receiptDigest: quarantineReceiptDigest(unsigned) });
}

function parseLegacyQuarantineReceipt(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): VerificationActionLegacyQuarantineReceipt {
  const parsed = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy quarantine receipt',
    LEGACY_QUARANTINE_KEYS
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('legacy quarantine receipt must be an object.');
  }
  const value = parsed as Record<string, unknown>;
  const classification: VerificationActionLegacyQuarantineReceipt['classification'] =
    value.classification === 'legacy-terminal-missing-bound-attempt-and-owner-terminal-receipt'
      ? value.classification
      : value.classification === 'legacy-action-contract-retired-unusable'
        ? value.classification
        : fail('legacy quarantine receipt classification is invalid.');
  if (value.schema !== VERIFICATION_ACTION_LEGACY_QUARANTINE_SCHEMA
      || value.actionKey !== expectedActionKey
      || value.reuseDisposition !== 'forbidden'
      || value.executionDisposition !== 'same-action-key-forbidden'
      || value.legacyEvidenceDisposition !== 'retained-until-owner-authorized-retirement') {
    fail('legacy quarantine receipt identity is invalid.');
  }
  const action = value.action === null
    ? null
    : parseVerificationActionKey(encodeVerificationActionData(value.action));
  if ((classification === 'legacy-action-contract-retired-unusable') !== (action === null)) {
    fail('legacy quarantine classification does not match its action projection.');
  }
  if (action !== null && action.actionKey !== expectedActionKey) fail('legacy quarantine action identity mismatch.');
  if (!Array.isArray(value.sourceEvidence)) fail('legacy quarantine sourceEvidence is invalid.');
  const parsedEvidence = value.sourceEvidence.map((candidate) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      fail('legacy quarantine evidence must be an object.');
    }
    const record = candidate as Record<string, unknown>;
    exactKeys(record, LEGACY_QUARANTINE_EVIDENCE_KEYS);
    if (typeof record.path !== 'string') fail('legacy quarantine evidence path is invalid.');
    if (record.physical === null || typeof record.physical !== 'object' || Array.isArray(record.physical)) {
      fail('legacy quarantine evidence physical identity is invalid.');
    }
    const physical = record.physical as Record<string, unknown>;
    exactKeys(physical, ['device', 'inode']);
    if (typeof physical.device !== 'string' || typeof physical.inode !== 'string') {
      fail('legacy quarantine evidence physical identity is invalid.');
    }
    return {
      path: record.path,
      physical: { device: physical.device, inode: physical.inode },
      ledgerDigest: assertDigest(record.ledgerDigest, 'legacy quarantine evidence ledgerDigest')!,
      byteLength: assertNonnegativeSafeInteger(record.byteLength, 'legacy quarantine evidence byteLength')
    };
  });
  const sourceEvidence = canonicalQuarantineEvidence(parsedEvidence);
  if (sourceEvidence.some((entry, index) => entry.path !== parsedEvidence[index]!.path)) {
    fail('legacy quarantine evidence order is noncanonical.');
  }
  const unsigned = {
    schema: VERIFICATION_ACTION_LEGACY_QUARANTINE_SCHEMA,
    actionKey: expectedActionKey,
    action,
    classification,
    sourceEvidence,
    reuseDisposition: 'forbidden' as const,
    executionDisposition: 'same-action-key-forbidden' as const,
    legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement' as const
  };
  const receiptDigest = assertDigest(value.receiptDigest, 'legacy quarantine receiptDigest')!;
  if (receiptDigest !== quarantineReceiptDigest(unsigned)) {
    fail('legacy quarantine receipt digest mismatch.');
  }
  return Object.freeze({ ...unsigned, receiptDigest });
}

function verifyLegacyQuarantineEvidence(
  fs: RuntimeStateJournalFileSystem,
  receipt: VerificationActionLegacyQuarantineReceipt,
  deadline: number
): void {
  for (const evidence of receipt.sourceEvidence) {
    const observed = observeJournalSource(fs, path.join(fs.rootPath, ...evidence.path.split('/')), deadline);
    if (observed === null
        || !samePhysical(observed.physical, evidence.physical)
        || observed.byteLength !== evidence.byteLength
        || sha256(observed.text) !== evidence.ledgerDigest) {
      fail('legacy quarantine source evidence changed before owner-authorized retirement.', 'recovery-required');
    }
  }
}

function verifyLegacyQuarantineEvidenceFromCensus(
  receipt: VerificationActionLegacyQuarantineReceipt,
  observedByPath: ReadonlyMap<string, MachineCutoverObservedFile>
): void {
  for (const evidence of receipt.sourceEvidence) {
    const observed = observedByPath.get(evidence.path);
    if (observed === undefined
        || !samePhysical(observed.physical, evidence.physical)
        || observed.byteLength !== evidence.byteLength
        || sha256(observed.text) !== evidence.ledgerDigest) {
      fail('legacy quarantine source evidence changed before owner-authorized retirement.', 'recovery-required');
    }
  }
}

function assertQuarantineDominatesRetainedJournal(
  fs: RuntimeStateJournalFileSystem,
  receipt: VerificationActionLegacyQuarantineReceipt,
  retained: RuntimeStateJournalRetainedText,
  actionKey: VerificationActionKeyDigest
): void {
  const machinePath = normalizeInventoryPath(path.relative(fs.rootPath, actionPath(fs, actionKey)));
  if (machinePath.startsWith('../') || path.posix.isAbsolute(machinePath)) {
    fail('retained machine journal path escapes Runtime State.', 'recovery-required');
  }
  const machineEvidence = receipt.sourceEvidence.find((entry) => entry.path === machinePath);
  if (machineEvidence === undefined
      || !samePhysical(machineEvidence.physical, retained.physical)
      || machineEvidence.byteLength !== retained.byteLength
      || machineEvidence.ledgerDigest !== sha256(retained.text)) {
    fail('legacy quarantine does not bind the retained machine journal.', 'recovery-required');
  }
  const readback = parseJournalSource(actionPath(fs, actionKey), actionKey, retained.text);
  if (readback.action === null
      || receipt.action === null
      || readback.action.actionKey !== receipt.action.actionKey) {
    fail('retained machine journal is not exact Action evidence for the quarantine.', 'recovery-required');
  }
}

function claimPath(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): string {
  return `${actionPath(fs, actionKey)}.claim.json`;
}

function recoveryLockPath(
  fs: RuntimeStateJournalFileSystem,
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

function parseClaim(source: string, expectedActionKey: VerificationActionKeyDigest): VerificationActionClaim {
  const value = parseCanonicalJournalDocument(source, 'VerificationAction claim', CLAIM_KEYS);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('claim must be an object.');
  const claim = value as Record<string, unknown>;
  const actual = Object.keys(claim).sort();
  const expected = [...CLAIM_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`claim must contain exactly: ${expected.join(', ')}.`);
  }
  if (claim.schema !== VERIFICATION_ACTION_CLAIM_SCHEMA || claim.actionKey !== expectedActionKey) {
    fail('claim identity mismatch.');
  }
  const acquiredAt = assertIsoDate(claim.acquiredAt);
  const expiresAt = assertIsoDate(claim.expiresAt);
  if (expiresAt <= acquiredAt) fail('claim expiry must be after acquisition.');
  return Object.freeze({
    schema: VERIFICATION_ACTION_CLAIM_SCHEMA,
    actionKey: expectedActionKey,
    ownerToken: ownerToken(claim.ownerToken),
    acquiredAt,
    expiresAt
  });
}

function parseMachineCutoverClaim(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): VerificationActionClaim {
  const value = parseCanonicalJournalDocument(
    source,
    'VerificationAction machine cutover claim',
    CLAIM_KEYS
  );
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('machine cutover claim must be an object.');
  }
  const claim = value as Record<string, unknown>;
  if (claim.schema === VERIFICATION_ACTION_CLAIM_SCHEMA) {
    return parseClaim(source, expectedActionKey);
  }
  if (claim.schema !== LEGACY_VERIFICATION_ACTION_CLAIM_SCHEMA
      || claim.actionKey !== expectedActionKey) {
    fail('machine cutover claim identity mismatch.');
  }
  const acquiredAt = assertIsoDate(claim.acquiredAt);
  const expiresAt = assertIsoDate(claim.expiresAt);
  if (expiresAt <= acquiredAt) fail('machine cutover claim expiry must be after acquisition.');
  return Object.freeze({
    schema: VERIFICATION_ACTION_CLAIM_SCHEMA,
    actionKey: expectedActionKey,
    ownerToken: ownerToken(claim.ownerToken),
    acquiredAt,
    expiresAt
  });
}

function parseCanonicalJournalDocument(
  source: string,
  label: string,
  rootObjectKeys: readonly string[]
): unknown {
  if (!source.endsWith('\n') || source.endsWith('\n\n')) {
    fail(`${label} bytes must contain one newline-terminated JSON document.`);
  }
  const document = source.slice(0, -1);
  const value = parseExactJson(document, label, { rootObjectKeys });
  if (`${encodeVerificationActionData(value)}\n` !== source) {
    fail(`${label} bytes are not canonical.`);
  }
  return value;
}

function writeExclusiveClaim(
  filePath: string,
  claim: VerificationActionClaim,
  fs: RuntimeStateJournalFileSystem
): boolean {
  return fs.createExclusiveFsync(filePath, `${encodeVerificationActionData(claim)}\n`);
}

function newClaim(
  actionKey: VerificationActionKeyDigest,
  token: string,
  now: string,
  leaseDurationMs: number
): VerificationActionClaim {
  const acquiredAt = assertIsoDate(now);
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 86_400_000) {
    fail('leaseDurationMs must be between one second and one day.');
  }
  return Object.freeze({
    schema: VERIFICATION_ACTION_CLAIM_SCHEMA,
    actionKey,
    ownerToken: ownerToken(token),
    acquiredAt,
    expiresAt: new Date(Date.parse(acquiredAt) + leaseDurationMs).toISOString()
  });
}

function withRecoveryLock<T>(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest,
  operation: () => T
): T | null {
  const filePath = recoveryLockPath(fs, actionKey);
  if (!fs.createExclusiveFsync(filePath, `${process.pid}:${randomUUID()}\n`)) return null;
  try { return operation(); } finally {
    if (!fs.deleteIfPresent(filePath)) fail('claim recovery lock disappeared.');
  }
}

export function readVerificationActionClaim(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): VerificationActionClaim | null {
  const filePath = claimPath(fs, actionKey);
  if (!fs.exists(filePath)) return null;
  return parseClaim(fs.readText(filePath), actionKey);
}

export function acquireVerificationActionClaim(input: {
  readonly fs: RuntimeStateJournalFileSystem;
  readonly action: VerificationActionKey;
  readonly ownerToken: string;
  readonly now: string;
  readonly leaseDurationMs?: number;
}): VerificationActionClaimOutcome {
  const action = parseVerificationActionKey(encodeVerificationActionData(input.action));
  const journal = readVerificationActionJournal(input.fs, action.actionKey);
  if (journal.recoveryDisposition !== null) {
    return Object.freeze({
      disposition: 'blocked',
      claim: null,
      terminal: null,
      reason: 'legacy Action is quarantined; same-ActionKey execution and reuse are forbidden'
    });
  }
  if ((journal.latestState === 'terminal' || journal.latestState === 'reused') && journal.terminal !== null) {
    return Object.freeze({ disposition: 'terminal', claim: null, terminal: journal.terminal, reason: null });
  }
  const lease = newClaim(action.actionKey, input.ownerToken, input.now, input.leaseDurationMs ?? 300_000);
  const fs = input.fs;
  fs.ensureDirectory(path.dirname(claimPath(fs, action.actionKey)));
  if (journal.latestState === 'queued' || journal.latestState === 'running') {
    let existing: VerificationActionClaim | null;
    try {
      existing = readVerificationActionClaim(fs, action.actionKey);
    } catch {
      return Object.freeze({
        disposition: 'blocked',
        claim: null,
        terminal: null,
        reason: 'persisted Action claim is unreadable; fail closed'
      });
    }
    if (existing !== null && existing.expiresAt > lease.acquiredAt) {
      return Object.freeze({
        disposition: 'joined',
        claim: existing,
        terminal: null,
        reason: 'another process owns the live persisted Action claim'
      });
    }
    const recovered = withRecoveryLock<VerificationActionClaimOutcome>(fs, action.actionKey, () => {
      // The outer journal/claim reads are only an optimistic fast path. A
      // terminal commit can delete the claim between those observations, so
      // recovery must decide from one lock-owned current generation.
      const currentJournal = readVerificationActionJournal(fs, action.actionKey);
      if ((currentJournal.latestState === 'terminal' || currentJournal.latestState === 'reused')
          && currentJournal.terminal !== null) {
        return Object.freeze({
          disposition: 'terminal',
          claim: null,
          terminal: currentJournal.terminal,
          reason: null
        });
      }
      let current: VerificationActionClaim | null;
      try {
        current = readVerificationActionClaim(fs, action.actionKey);
      } catch {
        return Object.freeze({
          disposition: 'blocked',
          claim: null,
          terminal: null,
          reason: 'persisted Action claim is unreadable; fail closed'
        });
      }
      if (currentJournal.latestState !== 'queued' && currentJournal.latestState !== 'running') {
        return Object.freeze({
          disposition: 'blocked',
          claim: current,
          terminal: null,
          reason: `persisted Action recovery observed ${currentJournal.latestState ?? 'no journal'}; fail closed`
        });
      }
      if (current !== null && current.expiresAt > lease.acquiredAt) {
        return Object.freeze({
          disposition: 'joined',
          claim: current,
          terminal: null,
          reason: 'another process owns the live persisted Action claim'
        });
      }
      appendVerificationActionJournalEvent({
        fs,
        action,
        state: 'cancelled',
        recordedAt: lease.acquiredAt,
        note: `abandoned ${currentJournal.latestState} Action has no live physical owner or terminal readback`
      });
      if (current !== null) fs.deleteIfPresent(claimPath(fs, action.actionKey));
      return Object.freeze({
        disposition: 'blocked',
        claim: current,
        terminal: null,
        reason: `abandoned ${currentJournal.latestState} Action was durably cancelled; a new Action identity is required`
      });
    });
    return recovered ?? Object.freeze({
      disposition: 'contended',
      claim: existing,
      terminal: null,
      reason: 'another recovery owner is settling the abandoned Action'
    });
  }
  if (writeExclusiveClaim(claimPath(fs, action.actionKey), lease, fs)) {
    return Object.freeze({ disposition: 'acquired', claim: lease, terminal: null, reason: null });
  }
  let existing: VerificationActionClaim;
  try {
    existing = readVerificationActionClaim(fs, action.actionKey)!;
  } catch {
    return Object.freeze({ disposition: 'blocked', claim: null, terminal: null, reason: 'claim is unreadable; fail closed' });
  }
  if (existing.ownerToken === lease.ownerToken && existing.expiresAt > lease.acquiredAt) {
    return Object.freeze({ disposition: 'acquired', claim: existing, terminal: null, reason: null });
  }
  if (existing.expiresAt > lease.acquiredAt) {
    return Object.freeze({ disposition: 'joined', claim: existing, terminal: null, reason: 'another process owns the live ActionKey claim' });
  }
  return Object.freeze({
    disposition: 'blocked',
    claim: existing,
    terminal: null,
    reason: 'expired physical owner has no provable terminal; blind re-execution is forbidden'
  });
}

export function releaseVerificationActionClaim(input: {
  readonly fs: RuntimeStateJournalFileSystem;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
}): boolean {
  const released = withRecoveryLock(input.fs, input.actionKey, () => {
    const existing = readVerificationActionClaim(input.fs, input.actionKey);
    if (existing === null) return false;
    if (existing.ownerToken !== ownerToken(input.ownerToken)) fail('claim release owner mismatch.');
    input.fs.deleteIfPresent(claimPath(input.fs, input.actionKey));
    return true;
  });
  return released ?? false;
}

export type VerificationActionClaimSettlementDisposition =
  | 'released'
  | 'absent'
  | 'lost';

/**
 * Close one acquired claim without deleting a successor generation. Unlike the
 * strict public release operation, lifecycle settlement treats an absent claim
 * as already consumed and a different owner as ownership already transferred.
 * Recovery-lock contention remains an unresolved cleanup failure.
 */
export function settleVerificationActionClaimIfOwned(input: {
  readonly fs: RuntimeStateJournalFileSystem;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
}): VerificationActionClaimSettlementDisposition {
  const expectedOwner = ownerToken(input.ownerToken);
  const settled = withRecoveryLock<VerificationActionClaimSettlementDisposition>(
    input.fs,
    input.actionKey,
    () => {
      const existing = readVerificationActionClaim(input.fs, input.actionKey);
      if (existing === null) return 'absent';
      if (existing.ownerToken !== expectedOwner) return 'lost';
      input.fs.deleteIfPresent(claimPath(input.fs, input.actionKey));
      return 'released';
    }
  );
  if (settled === null) fail('claim settlement is contended; fail closed.');
  return settled;
}

export function renewVerificationActionClaim(input: {
  readonly fs: RuntimeStateJournalFileSystem;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
  readonly now: string;
  readonly leaseDurationMs: number;
}): boolean {
  const renewed = withRecoveryLock(input.fs, input.actionKey, () => {
    const existing = readVerificationActionClaim(input.fs, input.actionKey);
    const now = assertIsoDate(input.now);
    if (existing === null || existing.ownerToken !== ownerToken(input.ownerToken) || existing.expiresAt <= now) return false;
    const extension = newClaim(input.actionKey, input.ownerToken, now, input.leaseDurationMs);
    const replacement = Object.freeze({ ...extension, acquiredAt: existing.acquiredAt });
    const filePath = claimPath(input.fs, input.actionKey);
    input.fs.replaceFsync(filePath, `${encodeVerificationActionData(replacement)}\n`);
    return true;
  });
  return renewed ?? false;
}

export function commitVerificationActionTerminalUnderClaim(input: {
  readonly fs: RuntimeStateJournalFileSystem;
  readonly action: VerificationActionKey;
  readonly ownerToken: string;
  readonly now: string;
  readonly recordedAt?: string;
  readonly terminal: VerificationActionTerminal;
  readonly note?: string | null;
}): VerificationActionJournalEvent | null {
  const action = parseVerificationActionKey(encodeVerificationActionData(input.action));
  return withRecoveryLock(input.fs, action.actionKey, () => {
    const existing = readVerificationActionClaim(input.fs, action.actionKey);
    const now = assertIsoDate(input.now);
    if (existing === null || existing.ownerToken !== ownerToken(input.ownerToken) || existing.expiresAt <= now) return null;
    const event = appendVerificationActionJournalEvent({
      fs: input.fs,
      action,
      state: 'terminal',
      recordedAt: input.recordedAt,
      terminal: input.terminal,
      note: input.note
    });
    input.fs.deleteIfPresent(claimPath(input.fs, action.actionKey));
    return event;
  });
}

/**
 * Settle a nonterminal physical attempt only while the caller still owns the
 * exact durable claim. This is the sole executor-side cancellation and
 * invalidation writer; a lost handle must remain unresolved instead of
 * deleting or overwriting another owner's claim.
 */
export function commitVerificationActionRevocationUnderClaim(input: {
  readonly fs: RuntimeStateJournalFileSystem;
  readonly action: VerificationActionKey;
  readonly ownerToken: string;
  readonly now: string;
  readonly state: 'invalidated' | 'cancelled';
  readonly recordedAt?: string;
  readonly note: string;
}): VerificationActionJournalEvent | null {
  const action = parseVerificationActionKey(encodeVerificationActionData(input.action));
  return withRecoveryLock(input.fs, action.actionKey, () => {
    const existing = readVerificationActionClaim(input.fs, action.actionKey);
    const now = assertIsoDate(input.now);
    if (existing === null || existing.ownerToken !== ownerToken(input.ownerToken)
        || existing.expiresAt <= now) return null;
    const event = appendVerificationActionJournalEvent({
      fs: input.fs,
      action,
      state: input.state,
      recordedAt: input.recordedAt,
      terminal: null,
      note: input.note
    });
    input.fs.deleteIfPresent(claimPath(input.fs, action.actionKey));
    return event;
  });
}

export function revokeVerificationActionClaim(input: {
  readonly fs: RuntimeStateJournalFileSystem;
  readonly action: VerificationActionKey;
  readonly state: 'invalidated' | 'cancelled';
  readonly recordedAt?: string;
  readonly note: string;
}): VerificationActionJournalReadback {
  const action = parseVerificationActionKey(encodeVerificationActionData(input.action));
  const revoked = withRecoveryLock(input.fs, action.actionKey, () => {
    const current = readVerificationActionJournal(input.fs, action.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' || current.latestState === 'cancelled') return current;
    appendVerificationActionJournalEvent({
      fs: input.fs,
      action,
      state: input.state,
      recordedAt: input.recordedAt,
      terminal: null,
      note: input.note
    });
    const activeClaimPath = claimPath(input.fs, action.actionKey);
    input.fs.deleteIfPresent(activeClaimPath);
    return readVerificationActionJournal(input.fs, action.actionKey);
  });
  if (revoked === null) fail('claim revocation is contended; fail closed.');
  return revoked;
}

function assertTransition(
  previous: VerificationActionJournalState | null,
  next: VerificationActionJournalState
): void {
  if (previous === null && next !== 'queued') fail('must begin with queued.');
  if (previous === null) return;
  const allowed: Readonly<Record<VerificationActionJournalState, readonly VerificationActionJournalState[]>> = {
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
  previous: VerificationActionJournalEvent | null,
  sequence: number
): VerificationActionJournalEvent {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail(`event ${sequence} must be an object.`);
  }
  const value = candidate as Record<string, unknown>;
  const hasExecutionBinding = Object.hasOwn(value, 'executionBindingDigest');
  exactKeys(value, hasExecutionBinding ? RETIRED_LEGACY_JOURNAL_EVENT_KEYS : JOURNAL_EVENT_KEYS);
  if (value.schema !== VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA) {
    fail(`event ${sequence} schema mismatch; non-current records are not reusable.`);
  }
  if (value.sequence !== sequence) fail(`event ${sequence} has a non-contiguous sequence.`);
  if (value.actionKey !== expectedActionKey) fail(`event ${sequence} action key mismatch.`);
  const action = parseVerificationActionKey(encodeVerificationActionData(value.action));
  if (action.actionKey !== expectedActionKey) fail(`event ${sequence} embedded action mismatch.`);
  const state = assertState(value.state);
  assertTransition(previous?.state ?? null, state);
  const previousDigest = assertDigest(value.previousDigest, `event ${sequence} previousDigest`);
  if ((previous?.eventDigest ?? null) !== previousDigest) {
    fail(`event ${sequence} previousDigest does not match the chain.`);
  }
  const terminal = value.terminal === null
    ? null
    : createVerificationActionTerminal(value.terminal);
  assertTerminalBindsAction(terminal, expectedActionKey, `event ${sequence}`);
  if ((state === 'terminal' || state === 'reused') && terminal === null) {
    fail(`event ${sequence} ${state} state requires a terminal result.`);
  }
  if (state !== 'terminal' && state !== 'reused' && terminal !== null) {
    fail(`event ${sequence} ${state} state cannot carry a terminal result.`);
  }
  const withoutDigest = {
    schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
    sequence,
    actionKey: expectedActionKey,
    action,
    state,
    recordedAt: assertIsoDate(value.recordedAt),
    terminal,
    note: assertNote(value.note),
    previousDigest
  } satisfies Omit<VerificationActionJournalEvent, 'eventDigest'>;
  if (value.eventDigest !== eventDigest(withoutDigest)) {
    fail(`event ${sequence} digest mismatch.`);
  }
  return Object.freeze({ ...withoutDigest, eventDigest: value.eventDigest as VerificationActionKeyDigest });
}

function assertTerminalBindsAction(
  terminal: VerificationActionTerminal | null,
  actionKey: VerificationActionKeyDigest,
  label: string
): void {
  if (terminal !== null && terminal.actionKey !== actionKey) {
    fail(`${label} terminal does not bind its ActionKey.`);
  }
  if (terminal?.diagnosticObjects.some(({ receipt }) => (
    receipt.subjectDigest !== actionKey
    || receipt.boundAttemptDigest !== terminal.boundAttemptDigest
  ))) {
    fail(`${label} terminal diagnostics do not bind its ActionKey and attempt.`);
  }
}

interface LegacyVerificationActionJournalEvent {
  readonly sequence: number;
  readonly actionKey: VerificationActionKeyDigest;
  readonly action: VerificationActionKey | null;
  readonly actionSource: string;
  readonly state: VerificationActionJournalState;
  readonly recordedAt: string;
  readonly terminal: VerificationActionTerminal | null;
  readonly terminalMigratable: boolean;
  readonly note: string | null;
  readonly previousDigest: VerificationActionKeyDigest | null;
  readonly eventDigest: VerificationActionKeyDigest;
}

const RETIRED_LEGACY_ACTION_KEYS = Object.freeze([
  'actionKey', 'actionKind', 'environment', 'inputClosure', 'operation', 'producer',
  'requiredCheapPreflightActionKeys', 'resultSchemaRevision', 'schema', 'upstreamActionKeys'
]);
const RETIRED_LEGACY_ACTION_WITH_STATIC_PROOF_KEYS = Object.freeze([
  ...RETIRED_LEGACY_ACTION_KEYS,
  'staticProofRequirement'
]);

function legacyActionProjection(
  input: unknown,
  expectedActionKey: VerificationActionKeyDigest
): Readonly<{ action: VerificationActionKey | null; canonicalForDigest: unknown; source: string }> {
  try {
    const action = parseVerificationActionKey(encodeVerificationActionData(input));
    if (action.actionKey !== expectedActionKey) fail('legacy embedded action mismatch.');
    return Object.freeze({ action, canonicalForDigest: action, source: encodeVerificationActionData(action) });
  } catch (error) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw error;
    const value = input as Record<string, unknown>;
    const keys = Object.hasOwn(value, 'staticProofRequirement')
      ? RETIRED_LEGACY_ACTION_WITH_STATIC_PROOF_KEYS
      : RETIRED_LEGACY_ACTION_KEYS;
    exactKeys(value, keys);
    if (value.schema !== 'sec-verification-action-key-v2' || value.actionKey !== expectedActionKey) throw error;
    if (Object.hasOwn(value, 'staticProofRequirement')
        && value.staticProofRequirement !== 'bounded-action-admission') throw error;
    const source = encodeVerificationActionData(value);
    return Object.freeze({ action: null, canonicalForDigest: value, source });
  }
}

function legacyTerminal(input: unknown): Readonly<{
  terminal: VerificationActionTerminal | null;
  canonicalForDigest: unknown;
  migratable: boolean;
}> {
  if (input === null) {
    return Object.freeze({ terminal: null, canonicalForDigest: null, migratable: true });
  }
  try {
    const terminal = createVerificationActionTerminal(input);
    return Object.freeze({ terminal, canonicalForDigest: terminal, migratable: true });
  } catch {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      fail('legacy terminal is not an object.');
    }
    const value = input as Record<string, unknown>;
    const hasRetiredOwnerJoin = Object.hasOwn(value, 'ownerTerminalJoinReceiptDigest');
    const hasRetiredExecutionKind = Object.hasOwn(value, 'executionKind');
    if (hasRetiredExecutionKind && !hasRetiredOwnerJoin) {
      fail('legacy terminal executionKind is not bound to retired owner join evidence.');
    }
    exactKeys(value, hasRetiredOwnerJoin
      ? hasRetiredExecutionKind
        ? ['boundAttemptDigest', 'diagnosticObjects', 'executionKind', 'ownerTerminalJoinReceiptDigest', 'reasonCode', 'resultDigest', 'status']
        : ['boundAttemptDigest', 'diagnosticObjects', 'ownerTerminalJoinReceiptDigest', 'reasonCode', 'resultDigest', 'status']
      : ['status', 'reasonCode', 'resultDigest']);
    const isRetiredInvalidation = value.status === 'invalidated'
      && value.reasonCode === 'input-invalidated';
    if (!['passed', 'failed', 'not-run'].includes(String(value.status))
        && !isRetiredInvalidation) {
      fail('legacy terminal status is invalid.');
    }
    const reasonCode = String(value.reasonCode);
    if (reasonCode.length === 0 || reasonCode.length > 128 || /[\u0000-\u001f]/u.test(reasonCode)) {
      fail('legacy terminal reasonCode is invalid.');
    }
    const resultDigest = assertDigest(value.resultDigest, 'legacy terminal resultDigest');
    if (isRetiredInvalidation && resultDigest === null) {
      fail('retired legacy invalidation resultDigest is missing.');
    }
    if (hasRetiredOwnerJoin) {
      if (assertDigest(value.boundAttemptDigest, 'legacy terminal boundAttemptDigest') === null
          || assertDigest(value.ownerTerminalJoinReceiptDigest, 'legacy terminal ownerTerminalJoinReceiptDigest') === null
          || !Array.isArray(value.diagnosticObjects)) {
        fail('retired legacy terminal owner join evidence is invalid.');
      }
      if (hasRetiredExecutionKind
          && (value.executionKind !== 'process'
            || value.status !== 'passed'
            || reasonCode !== 'executed-success')) {
        fail('retired legacy terminal execution binding is invalid.');
      }
    }
    return Object.freeze({
      terminal: null,
      canonicalForDigest: hasRetiredOwnerJoin
        ? Object.freeze(hasRetiredExecutionKind ? {
          boundAttemptDigest: value.boundAttemptDigest,
          diagnosticObjects: value.diagnosticObjects,
          executionKind: value.executionKind,
          ownerTerminalJoinReceiptDigest: value.ownerTerminalJoinReceiptDigest,
          reasonCode,
          resultDigest,
          status: value.status
        } : {
          boundAttemptDigest: value.boundAttemptDigest,
          diagnosticObjects: value.diagnosticObjects,
          ownerTerminalJoinReceiptDigest: value.ownerTerminalJoinReceiptDigest,
          reasonCode,
          resultDigest,
          status: value.status
        })
        : Object.freeze({ status: value.status, reasonCode, resultDigest }),
      migratable: false
    });
  }
}

function validateLegacyEvent(
  candidate: unknown,
  expectedActionKey: VerificationActionKeyDigest,
  previous: LegacyVerificationActionJournalEvent | null,
  sequence: number
): LegacyVerificationActionJournalEvent {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail(`legacy event ${sequence} must be an object.`);
  }
  const value = candidate as Record<string, unknown>;
  const hasExecutionBinding = Object.hasOwn(value, 'executionBindingDigest');
  exactKeys(value, hasExecutionBinding ? RETIRED_LEGACY_JOURNAL_EVENT_KEYS : JOURNAL_EVENT_KEYS);
  if (value.schema !== LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA) {
    fail(`legacy event ${sequence} schema mismatch.`);
  }
  if (value.sequence !== sequence || value.actionKey !== expectedActionKey) {
    fail(`legacy event ${sequence} identity mismatch.`);
  }
  const actionProjection = legacyActionProjection(value.action, expectedActionKey);
  if (previous !== null && previous.actionSource !== actionProjection.source) {
    fail(`legacy event ${sequence} embedded action changed within the chain.`);
  }
  const state = assertState(value.state);
  assertTransition(previous?.state ?? null, state);
  const previousDigest = assertDigest(value.previousDigest, `legacy event ${sequence} previousDigest`);
  if ((previous?.eventDigest ?? null) !== previousDigest) {
    fail(`legacy event ${sequence} previousDigest does not match the chain.`);
  }
  const parsedTerminal = legacyTerminal(value.terminal);
  assertTerminalBindsAction(parsedTerminal.terminal, expectedActionKey, `legacy event ${sequence}`);
  if ((state === 'terminal' || state === 'reused') && value.terminal === null) {
    fail(`legacy event ${sequence} ${state} state requires a terminal result.`);
  }
  if (state !== 'terminal' && state !== 'reused' && value.terminal !== null) {
    fail(`legacy event ${sequence} ${state} state cannot carry a terminal result.`);
  }
  const recordedAt = assertIsoDate(value.recordedAt);
  const note = assertNote(value.note);
  const executionBindingDigest = hasExecutionBinding
    ? assertDigest(value.executionBindingDigest, `legacy event ${sequence} executionBindingDigest`)
    : null;
  if (hasExecutionBinding && executionBindingDigest === null) {
    fail(`legacy event ${sequence} executionBindingDigest is required.`);
  }
  const canonicalForDigest = {
    schema: LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
    sequence,
    actionKey: expectedActionKey,
    action: actionProjection.canonicalForDigest,
    state,
    recordedAt,
    terminal: parsedTerminal.canonicalForDigest,
    note,
    previousDigest,
    ...(hasExecutionBinding ? { executionBindingDigest } : {})
  };
  if (value.eventDigest !== sha256(encodeVerificationActionData(canonicalForDigest))) {
    fail(`legacy event ${sequence} digest mismatch.`);
  }
  return Object.freeze({
    sequence,
    actionKey: expectedActionKey,
    action: actionProjection.action,
    actionSource: actionProjection.source,
    state,
    recordedAt,
    terminal: parsedTerminal.terminal,
    terminalMigratable: parsedTerminal.migratable,
    note,
    previousDigest,
    eventDigest: value.eventDigest as VerificationActionKeyDigest
  });
}

function parseLegacyJournalSource(
  actionKey: VerificationActionKeyDigest,
  source: string
): readonly LegacyVerificationActionJournalEvent[] {
  if (source.length === 0 || !source.endsWith('\n')) {
    fail('legacy evidence has a missing or partial final line.');
  }
  const lines = source.slice(0, -1).split('\n');
  if (lines.length > JOURNAL_READ_BOUNDS.maximumEvents) fail('legacy evidence exceeds the event ceiling.');
  const events: LegacyVerificationActionJournalEvent[] = [];
  for (const [index, line] of lines.entries()) {
    const candidate = parseExactJson(
      line,
      `VerificationAction legacy journal event ${index + 1}`
    );
    const event = validateLegacyEvent(
      candidate,
      actionKey,
      events.at(-1) ?? null,
      index + 1
    );
    if (line !== encodeVerificationActionData(candidate)) {
      fail(`legacy event ${index + 1} bytes are not canonical.`);
    }
    events.push(event);
  }
  return Object.freeze(events);
}

function cutoverIntentDigest(
  input: Omit<VerificationActionJournalCutoverIntent, 'intentDigest'>
): VerificationActionKeyDigest {
  return sha256(encodeVerificationActionData(input));
}

function canonicalCutoverIntent(
  input: Omit<VerificationActionJournalCutoverIntent, 'intentDigest'>
): VerificationActionJournalCutoverIntent {
  return Object.freeze({ ...input, intentDigest: cutoverIntentDigest(input) });
}

function parseCutoverIntent(source: string): VerificationActionJournalCutoverIntent {
  const candidate = parseCanonicalJournalDocument(
    source,
    'VerificationAction journal cutover intent',
    CUTOVER_INTENT_KEYS
  );
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('cutover intent must be an object.');
  }
  const value = candidate as Record<string, unknown>;
  exactKeys(value, CUTOVER_INTENT_KEYS);
  if (value.schema !== VERIFICATION_ACTION_JOURNAL_CUTOVER_INTENT_SCHEMA
      || !['prepared', 'complete'].includes(String(value.phase))) {
    fail('cutover intent identity is invalid.');
  }
  const physical = (input: unknown, label: string): Readonly<{ device: string; inode: string }> => {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) fail(`${label} is invalid.`);
    const record = input as Record<string, unknown>;
    exactKeys(record, ['device', 'inode']);
    if (typeof record.device !== 'string' || typeof record.inode !== 'string'
        || record.device.length === 0 || record.inode.length === 0) fail(`${label} is invalid.`);
    return Object.freeze({ device: record.device, inode: record.inode });
  };
  const unsigned = {
    schema: VERIFICATION_ACTION_JOURNAL_CUTOVER_INTENT_SCHEMA,
    phase: value.phase as JournalCutoverPhase,
    actionKey: assertDigest(value.actionKey, 'cutover actionKey')!,
    sourcePhysical: physical(value.sourcePhysical, 'cutover sourcePhysical'),
    sourceLedgerDigest: assertDigest(value.sourceLedgerDigest, 'cutover sourceLedgerDigest')!,
    sourceByteLength: value.sourceByteLength,
    targetPhysical: value.targetPhysical === null
      ? null
      : physical(value.targetPhysical, 'cutover targetPhysical'),
    targetLedgerDigest: assertDigest(value.targetLedgerDigest, 'cutover targetLedgerDigest')!,
    targetByteLength: value.targetByteLength,
    eventCount: value.eventCount
  } as const;
  for (const [label, count] of [
    ['sourceByteLength', unsigned.sourceByteLength],
    ['targetByteLength', unsigned.targetByteLength],
    ['eventCount', unsigned.eventCount]
  ] as const) {
    if (!Number.isSafeInteger(count) || Number(count) < 0) fail(`cutover ${label} is invalid.`);
  }
  if ((unsigned.phase === 'prepared') !== (unsigned.targetPhysical === null)) {
    fail('cutover phase and target physical identity disagree.');
  }
  const intentDigest = assertDigest(value.intentDigest, 'cutover intentDigest');
  const expectedIntentDigest = cutoverIntentDigest(
    unsigned as Omit<VerificationActionJournalCutoverIntent, 'intentDigest'>
  );
  if (intentDigest !== expectedIntentDigest) {
    fail(`cutover intent digest mismatch (${String(intentDigest)} != ${expectedIntentDigest}).`);
  }
  return Object.freeze({ ...unsigned, intentDigest }) as VerificationActionJournalCutoverIntent;
}

function migratedJournalSource(
  events: readonly LegacyVerificationActionJournalEvent[]
): string {
  let previousDigest: VerificationActionKeyDigest | null = null;
  const lines: string[] = [];
  for (const legacy of events) {
    if (!legacy.terminalMigratable) fail('legacy terminal has no bound attempt and diagnostics.');
    if (legacy.action === null) fail('retired legacy Action contract cannot migrate into the current journal.');
    const withoutDigest = {
      schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
      sequence: legacy.sequence,
      actionKey: legacy.actionKey,
      action: legacy.action,
      state: legacy.state,
      recordedAt: legacy.recordedAt,
      terminal: legacy.terminal,
      note: legacy.note,
      previousDigest
    } satisfies Omit<VerificationActionJournalEvent, 'eventDigest'>;
    const digest = eventDigest(withoutDigest);
    lines.push(encodeVerificationActionData({ ...withoutDigest, eventDigest: digest }));
    previousDigest = digest;
  }
  return `${lines.join('\n')}\n`;
}

function exactLegacyObservation(
  input: RuntimeStateJournalRetainedText,
  intent: VerificationActionJournalCutoverIntent
): void {
  if (!samePhysical(input.physical, intent.sourcePhysical)
      || input.byteLength !== intent.sourceByteLength
      || sha256(input.text) !== intent.sourceLedgerDigest) {
    fail('legacy source changed after cutover admission.');
  }
}

function exactTargetObservation(
  input: RuntimeStateJournalRetainedText,
  intent: VerificationActionJournalCutoverIntent
): void {
  if (intent.targetPhysical === null
      || !samePhysical(input.physical, intent.targetPhysical)
      || input.byteLength !== intent.targetByteLength
      || sha256(input.text) !== intent.targetLedgerDigest) {
    fail('cutover target changed after publication.');
  }
}

export function inspectLegacyVerificationActionJournalForRecovery(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): VerificationActionLegacyRecoveryObservation {
  const deadline = performance.now() + JOURNAL_READ_BOUNDS.durationMs;
  const observed = observeJournalSource(fs, legacyActionPath(fs, actionKey), deadline);
  if (observed === null) {
    return Object.freeze({
      disposition: 'absent',
      actionKey,
      sourceLedgerDigest: null,
      eventCount: 0,
      reason: null
    });
  }
  const events = parseLegacyJournalSource(actionKey, observed.text);
  const latest = events.at(-1) ?? null;
  const migratable = latest !== null
    && (latest.state === 'terminal' || latest.state === 'reused')
    && latest.terminal !== null
    && events.every(({ terminalMigratable }) => terminalMigratable);
  return Object.freeze({
    disposition: migratable ? 'migratable' : 'preserved-unmigratable',
    actionKey,
    sourceLedgerDigest: sha256(observed.text),
    eventCount: events.length,
    reason: migratable
      ? null
      : 'legacy Action lacks one diagnostic-bound terminal; evidence is preserved and cannot authorize reuse'
  });
}

export function migrateLegacyVerificationActionJournalForRecovery(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): VerificationActionJournalReadback {
  const deadline = performance.now() + JOURNAL_READ_BOUNDS.durationMs;
  const sourcePath = legacyActionPath(fs, actionKey);
  const targetPath = actionPath(fs, actionKey);
  const intentPath = cutoverIntentPath(fs, actionKey);
  const source = observeJournalSource(fs, sourcePath, deadline);
  if (source === null) fail('legacy migration source is absent.');
  const events = parseLegacyJournalSource(actionKey, source.text);
  const latest = events.at(-1) ?? null;
  if (latest === null || !['terminal', 'reused'].includes(latest.state)
      || latest.terminal === null || events.some(({ terminalMigratable }) => !terminalMigratable)) {
    fail('legacy evidence is preserved but cannot migrate without a diagnostic-bound terminal.');
  }
  const targetSource = migratedJournalSource(events);
  const prepared = canonicalCutoverIntent({
    schema: VERIFICATION_ACTION_JOURNAL_CUTOVER_INTENT_SCHEMA,
    phase: 'prepared',
    actionKey,
    sourcePhysical: source.physical,
    sourceLedgerDigest: sha256(source.text),
    sourceByteLength: source.byteLength,
    targetPhysical: null,
    targetLedgerDigest: sha256(targetSource),
    targetByteLength: Buffer.byteLength(targetSource, 'utf8'),
    eventCount: events.length
  });
  const existingIntentObservation = observeJournalSource(fs, intentPath, deadline);
  const existingIntentSource = existingIntentObservation?.text ?? null;
  const preexistingTarget = observeJournalSource(fs, targetPath, deadline);
  if (existingIntentObservation === null && preexistingTarget !== null) {
    fail('canonical target exists without a cutover intent; foreign bytes are preserved.');
  }
  let intent = existingIntentSource === null ? prepared : parseCutoverIntent(existingIntentSource);
  if (intent.actionKey !== actionKey
      || intent.sourceLedgerDigest !== prepared.sourceLedgerDigest
      || intent.targetLedgerDigest !== prepared.targetLedgerDigest
      || intent.eventCount !== prepared.eventCount) {
    fail('cutover intent belongs to different source or target evidence.');
  }
  if (existingIntentSource === null
      && !fs.createExclusiveFsync(intentPath, `${encodeVerificationActionData(prepared)}\n`)) {
    fail('cutover intent changed concurrently; resume from fresh readback.');
  }
  const sourceReadback = observeJournalSource(fs, sourcePath, deadline);
  if (sourceReadback === null) fail('legacy source disappeared during cutover.');
  exactLegacyObservation(sourceReadback, intent);
  if (intent.phase === 'complete') {
    const target = observeJournalSource(fs, targetPath, deadline);
    if (target === null) fail('completed cutover target is absent.');
    exactTargetObservation(target, intent);
    return parseJournalSource(targetPath, actionKey, target.text);
  }
  const existingTarget = observeJournalSource(fs, targetPath, deadline);
  if (existingTarget !== null) {
    if (existingTarget.text !== targetSource) fail('prepared cutover has foreign target bytes.');
  } else if (!fs.createExclusiveFsync(targetPath, targetSource)) {
    fail('cutover target changed concurrently; resume from fresh readback.');
  }
  const targetReadback = observeJournalSource(fs, targetPath, deadline);
  if (targetReadback === null || targetReadback.text !== targetSource) {
    fail('cutover target readback mismatch.');
  }
  const complete = canonicalCutoverIntent({
    schema: VERIFICATION_ACTION_JOURNAL_CUTOVER_INTENT_SCHEMA,
    phase: 'complete',
    actionKey: prepared.actionKey,
    sourcePhysical: prepared.sourcePhysical,
    sourceLedgerDigest: prepared.sourceLedgerDigest,
    sourceByteLength: prepared.sourceByteLength,
    targetPhysical: targetReadback.physical,
    targetLedgerDigest: prepared.targetLedgerDigest,
    targetByteLength: prepared.targetByteLength,
    eventCount: prepared.eventCount
  });
  const preparedSource = `${encodeVerificationActionData(prepared)}\n`;
  const completeSource = `${encodeVerificationActionData(complete)}\n`;
  if (!fs.replaceFsyncCas(intentPath, preparedSource, completeSource)) {
    fail('cutover intent changed concurrently; resume from fresh readback.');
  }
  const completeReadback = observeJournalSource(fs, intentPath, deadline);
  if (completeReadback === null) fail('completed cutover intent is absent.');
  intent = parseCutoverIntent(completeReadback.text);
  exactTargetObservation(targetReadback, intent);
  const finalSource = observeJournalSource(fs, sourcePath, deadline);
  if (finalSource === null) fail('legacy source disappeared after cutover.');
  exactLegacyObservation(finalSource, intent);
  return parseJournalSource(targetPath, actionKey, targetReadback.text);
}

function emptyReadback(filePath: string): VerificationActionJournalReadback {
  return Object.freeze({
    filePath,
    action: null,
    events: Object.freeze([]),
    latestState: null,
    terminal: null,
    recoveryDisposition: null
  });
}

function parseJournalSource(
  filePath: string,
  actionKey: VerificationActionKeyDigest,
  source: string | null
): VerificationActionJournalReadback {
  if (source === null) return emptyReadback(filePath);
  if (source.length === 0 || !source.endsWith('\n')) fail('has a missing or partial final line.');
  const lines = source.slice(0, -1).split('\n');
  if (lines.length > JOURNAL_READ_BOUNDS.maximumEvents) fail('exceeds the event ceiling.');
  const events: VerificationActionJournalEvent[] = [];
  let previous: VerificationActionJournalEvent | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const parsed = parseExactJson(
      line,
      `VerificationAction journal event ${index + 1}`,
      { rootObjectKeys: JOURNAL_EVENT_KEYS }
    );
    const event = validateEvent(parsed, actionKey, previous, index + 1);
    if (line !== encodeVerificationActionData(event)) {
      fail(`event ${index + 1} bytes are not canonical.`);
    }
    events.push(event);
    previous = event;
  }
  const latest = events.at(-1) ?? null;
  const terminal = latest !== null && (latest.state === 'terminal' || latest.state === 'reused')
    ? latest.terminal
    : null;
  return Object.freeze({
    filePath,
    action: events[0]?.action ?? null,
    events: Object.freeze(events),
    latestState: latest?.state ?? null,
    terminal,
    recoveryDisposition: null
  });
}

function parseRetiredCanonicalJournalForQuarantine(
  actionKey: VerificationActionKeyDigest,
  source: string
): VerificationActionKey {
  if (!source.endsWith('\n')) fail('retired canonical evidence has a partial final line.');
  let previous: VerificationActionKeyDigest | null = null;
  let action: VerificationActionKey | null = null;
  let retired = false;
  for (const [index, line] of source.slice(0, -1).split('\n').entries()) {
    const value = parseExactJson(line, `retired canonical event ${index + 1}`, { rootObjectKeys: JOURNAL_EVENT_KEYS }) as Record<string, unknown>;
    exactKeys(value, JOURNAL_EVENT_KEYS);
    if (value.schema !== VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA || value.sequence !== index + 1 || value.actionKey !== actionKey) fail('retired canonical event identity mismatch.');
    const parsedAction = parseVerificationActionKey(encodeVerificationActionData(value.action));
    if (parsedAction.actionKey !== actionKey || (action !== null && encodeVerificationActionData(action) !== encodeVerificationActionData(parsedAction))) fail('retired canonical action mismatch.');
    action = parsedAction;
    const state = assertState(value.state);
    const terminal = legacyTerminal(value.terminal);
    retired ||= !terminal.migratable;
    const recordedAt = assertIsoDate(value.recordedAt);
    const note = assertNote(value.note);
    const expectedPrevious = assertDigest(value.previousDigest, 'retired canonical previousDigest');
    if (expectedPrevious !== previous) fail('retired canonical chain mismatch.');
    const unsigned = { schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA, sequence: index + 1, actionKey, action: parsedAction, state, recordedAt, terminal: terminal.canonicalForDigest, note, previousDigest: previous };
    previous = sha256(encodeVerificationActionData(unsigned));
    if (value.eventDigest !== previous) fail('retired canonical event digest mismatch.');
  }
  if (!retired || action === null) fail('canonical journal is not one recognized retired terminal grammar.');
  return action;
}

interface MachineCutoverObservedFile {
  readonly filePath: string;
  readonly inventoryPath: string;
  readonly text: string;
  readonly byteLength: number;
  readonly physical: Readonly<{ device: string; inode: string }>;
}

interface MachineCutoverActionGroup {
  readonly groupId: string;
  readonly actionKey: VerificationActionKeyDigest;
  canonical: MachineCutoverObservedFile | null;
  legacy: MachineCutoverObservedFile | null;
  intent: MachineCutoverObservedFile | null;
  claim: MachineCutoverObservedFile | null;
  readonly auxiliary: MachineCutoverObservedFile[];
}

interface MachineCutoverCensus {
  readonly groups: readonly MachineCutoverActionGroup[];
  readonly existingTargets: ReadonlyMap<VerificationActionKeyDigest, Readonly<{
    journal: MachineCutoverObservedFile | null;
    quarantine: MachineCutoverObservedFile | null;
  }>>;
  readonly sourceInventoryDigest: VerificationActionKeyDigest;
  readonly sourceRecordCount: number;
  readonly sourceByteLength: number;
}

interface MachineCutoverObservedQuarantine {
  readonly actionKey: VerificationActionKeyDigest;
  readonly observed: MachineCutoverObservedFile;
  readonly receipt: VerificationActionLegacyQuarantineReceipt;
}

const MACHINE_CUTOVER_MAXIMUM_ENTRIES = 100_000;
const MACHINE_CUTOVER_MAXIMUM_SOURCE_BYTES = 256 * 1024 * 1024;
const MACHINE_CUTOVER_RECEIPT_MAXIMUM_BYTES = 64 * 1024;
const WORKSPACE_LOCATOR_PATTERN = /^[0-9a-f]{64}$/u;
const ACTION_FILE_PATTERN = /^([0-9a-f]{64})\.jsonl$/u;
const ACTION_CLAIM_PATTERN = /^([0-9a-f]{64})\.jsonl\.claim\.json$/u;
const ACTION_RECOVERY_LOCK_PATTERN = /^([0-9a-f]{64})\.jsonl\.claim-recovery\.lock$/u;
const ACTION_CUTOVER_PATTERN = /^([0-9a-f]{64})\.cutover\.json$/u;
const ACTION_QUARANTINE_PATTERN = /^([0-9a-f]{64})\.legacy-quarantine\.json$/u;
const MUTATION_LEASE_NAME_PATTERN = /^\.journal-mutation-([0-9a-f]{64})\.lock$/u;
const MUTATION_LEASE_CANDIDATE_PATTERN = /^(\.\.journal-mutation-[0-9a-f]{64}\.lock)\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.candidate$/u;
const MUTATION_LEASE_OWNER_KEYS = Object.freeze([
  'createdAtMs', 'expiresAtMs', 'host', 'pid', 'processNonce', 'schema', 'token'
]);
const LEGACY_START_RECEIPT_PATTERN = /^([0-9a-f]{64})\.start-receipt\.json$/u;
const LEGACY_TERMINAL_EVIDENCE_PATTERN = /^([0-9a-f]{64})\.terminal-evidence\.json$/u;
const LEGACY_PROCESS_SETTLEMENT_PATTERN = /^([0-9a-f]{64})\.process-settlement\.json$/u;
const LEGACY_STATIC_RECORD_PATTERN = /^([0-9a-f]{64})\.json$/u;
const LEGACY_ACTION_EVIDENCE_DIRECTORIES = new Set([
  'settlement-current',
  'static-closures',
  'static-current',
  'static-generations'
]);
const LEGACY_PROCESS_SETTLEMENT_KEYS = Object.freeze([
  'actionKey', 'executionBindingDigest', 'observation', 'observedAt',
  'providerRevision', 'receiptDigest', 'schema', 'state'
]);
const LEGACY_SETTLEMENT_RECEIPT_KEYS = Object.freeze([
  'actionKey', 'detailDigest', 'evidenceDigest', 'executionBindingDigest',
  'observedAt', 'phase', 'providerRevision', 'reasonCode', 'receiptDigest',
  'schema', 'state'
]);
const LEGACY_STATIC_CLOSURE_BASE_KEYS = Object.freeze([
  'actionKey', 'actionPlan', 'actionPlanDigest', 'analysisReadback',
  'analysisStage', 'closureDigest', 'dependencyEvidence', 'dimensions',
  'environmentDigest', 'invalidationDigest', 'openDefectClasses',
  'operationSemanticDigest', 'producer', 'retirement', 'schema', 'status',
  'subjectDigest', 'trackedInputDigest', 'unknowns'
]);
const LEGACY_STATIC_CLOSURE_PROOF_SCOPE_KEYS = Object.freeze([
  ...LEGACY_STATIC_CLOSURE_BASE_KEYS,
  'proofScope'
]);
const LEGACY_STATIC_CLOSURE_BOUND_KEYS = Object.freeze([
  ...LEGACY_STATIC_CLOSURE_PROOF_SCOPE_KEYS,
  'actionPlanClosureDigest'
]);
const LEGACY_STATIC_POINTER_KEYS = Object.freeze([
  'actionKey', 'actionPlanDigest', 'closureDigest', 'headTreeSha',
  'pointerDigest', 'readbackDigest', 'schema'
]);
const LEGACY_STATIC_POINTER_BOUND_KEYS = Object.freeze([
  ...LEGACY_STATIC_POINTER_KEYS,
  'actionPlanClosureDigest', 'staticGenerationDigest'
]);

interface LegacyStaticClosureProjection {
  readonly actionKey: VerificationActionKeyDigest;
  readonly actionPlanDigest: VerificationActionKeyDigest;
  readonly closureDigest: VerificationActionKeyDigest;
  readonly readbackDigest: VerificationActionKeyDigest;
}

interface LegacyStaticPointerProjection extends LegacyStaticClosureProjection {
  readonly headTreeSha: string;
}

function parseLegacyStaticClosure(
  source: string,
  expectedClosureDigest: VerificationActionKeyDigest
): LegacyStaticClosureProjection {
  const preliminary = parseExactJson(source.slice(0, -1), 'VerificationAction legacy static closure');
  if (preliminary === null || typeof preliminary !== 'object' || Array.isArray(preliminary)) {
    fail('legacy static closure must be an object.');
  }
  const candidate = preliminary as Record<string, unknown>;
  const keys = candidate.schema === 'sec-development-critical-path-static-closure-v1'
    ? LEGACY_STATIC_CLOSURE_BASE_KEYS
    : candidate.schema === 'sec-development-critical-path-static-closure-v2'
      ? Object.hasOwn(candidate, 'actionPlanClosureDigest')
        ? LEGACY_STATIC_CLOSURE_BOUND_KEYS
        : LEGACY_STATIC_CLOSURE_PROOF_SCOPE_KEYS
      : fail('legacy static closure schema is unknown.');
  const value = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy static closure',
    keys
  ) as Record<string, unknown>;
  const closureDigest = assertDigest(value.closureDigest, 'legacy static closure closureDigest');
  if (closureDigest !== expectedClosureDigest) fail('legacy static closure filename digest mismatch.');
  const { closureDigest: _closureDigest, ...unsigned } = value;
  if (sha256(encodeVerificationActionData(unsigned)) !== closureDigest) {
    fail('legacy static closure digest mismatch.');
  }
  const actionKey = assertDigest(value.actionKey, 'legacy static closure actionKey');
  const actionPlanDigest = assertDigest(value.actionPlanDigest, 'legacy static closure actionPlanDigest');
  if (actionKey === null || actionPlanDigest === null) fail('legacy static closure identity is incomplete.');
  if (Object.hasOwn(value, 'actionPlanClosureDigest')) {
    assertDigest(value.actionPlanClosureDigest, 'legacy static closure actionPlanClosureDigest');
  }
  if (value.analysisReadback === null || typeof value.analysisReadback !== 'object'
      || Array.isArray(value.analysisReadback)) {
    fail('legacy static closure analysis readback is invalid.');
  }
  const readbackDigest = assertDigest(
    (value.analysisReadback as Record<string, unknown>).readbackDigest,
    'legacy static closure readbackDigest'
  );
  if (readbackDigest === null) fail('legacy static closure readbackDigest is missing.');
  return Object.freeze({ actionKey, actionPlanDigest, closureDigest, readbackDigest });
}

function parseLegacyStaticPointer(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): LegacyStaticPointerProjection {
  const preliminary = parseExactJson(source.slice(0, -1), 'VerificationAction legacy static pointer');
  if (preliminary === null || typeof preliminary !== 'object' || Array.isArray(preliminary)) {
    fail('legacy static pointer must be an object.');
  }
  const candidate = preliminary as Record<string, unknown>;
  const keys = Object.hasOwn(candidate, 'actionPlanClosureDigest')
    ? LEGACY_STATIC_POINTER_BOUND_KEYS
    : LEGACY_STATIC_POINTER_KEYS;
  const value = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy static pointer',
    keys
  ) as Record<string, unknown>;
  if (value.schema !== 'sec-verification-action-static-closure-pointer-v1'
      || value.actionKey !== expectedActionKey) {
    fail('legacy static pointer identity is invalid.');
  }
  const actionPlanDigest = assertDigest(value.actionPlanDigest, 'legacy static pointer actionPlanDigest');
  const closureDigest = assertDigest(value.closureDigest, 'legacy static pointer closureDigest');
  const readbackDigest = assertDigest(value.readbackDigest, 'legacy static pointer readbackDigest');
  const pointerDigest = assertDigest(value.pointerDigest, 'legacy static pointer pointerDigest');
  if (actionPlanDigest === null || closureDigest === null || readbackDigest === null
      || pointerDigest === null || typeof value.headTreeSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(value.headTreeSha)) {
    fail('legacy static pointer fields are invalid.');
  }
  if (Object.hasOwn(value, 'actionPlanClosureDigest')) {
    if (assertDigest(value.actionPlanClosureDigest, 'legacy static pointer actionPlanClosureDigest') === null
        || assertDigest(value.staticGenerationDigest, 'legacy static pointer staticGenerationDigest') === null) {
      fail('legacy static pointer generation binding is invalid.');
    }
  }
  const { pointerDigest: _pointerDigest, ...unsigned } = value;
  if (sha256(encodeVerificationActionData(unsigned)) !== pointerDigest) {
    fail('legacy static pointer digest mismatch.');
  }
  return Object.freeze({
    actionKey: expectedActionKey,
    actionPlanDigest,
    closureDigest,
    readbackDigest,
    headTreeSha: value.headTreeSha
  });
}

function parseLegacyProcessSettlement(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): void {
  const parsed = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy process settlement',
    LEGACY_PROCESS_SETTLEMENT_KEYS
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('legacy process settlement must be an object.');
  }
  const value = parsed as Record<string, unknown>;
  if (value.schema !== 'sec-verification-action-process-settlement-v1'
      || value.actionKey !== expectedActionKey
      || value.state !== 'settled') {
    fail('legacy process settlement identity is invalid.');
  }
  assertDigest(value.executionBindingDigest, 'legacy process settlement executionBindingDigest');
  assertIsoDate(value.observedAt);
  if (typeof value.providerRevision !== 'string' || value.providerRevision.length === 0
      || value.providerRevision.length > 512 || /[\u0000-\u001f]/u.test(value.providerRevision)) {
    fail('legacy process settlement providerRevision must be bounded text.');
  }
  if (value.observation === null || typeof value.observation !== 'object'
      || Array.isArray(value.observation)) {
    fail('legacy process settlement observation is invalid.');
  }
  const receiptDigest = assertDigest(
    value.receiptDigest,
    'legacy process settlement receiptDigest'
  );
  const { receiptDigest: _receiptDigest, ...unsigned } = value;
  if (receiptDigest !== sha256(encodeVerificationActionData(unsigned))) {
    fail('legacy process settlement receipt digest mismatch.');
  }
}

function parseLegacySettlementReceipt(
  source: string,
  expectedActionKey: VerificationActionKeyDigest
): void {
  const parsed = parseCanonicalJournalDocument(
    source,
    'VerificationAction legacy settlement receipt',
    LEGACY_SETTLEMENT_RECEIPT_KEYS
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('legacy settlement receipt must be an object.');
  }
  const value = parsed as Record<string, unknown>;
  const isKnownTerminalState = (value.state === 'confirmed'
      && value.reasonCode === 'settlement-confirmed')
    || (value.state === 'settled' && value.reasonCode === 'settled');
  if (value.schema !== 'sec-verification-action-settlement-v1'
      || value.actionKey !== expectedActionKey
      || value.phase !== 'complete'
      || !isKnownTerminalState) {
    fail('legacy settlement receipt identity is invalid.');
  }
  assertDigest(value.detailDigest, 'legacy settlement detailDigest');
  assertDigest(value.evidenceDigest, 'legacy settlement evidenceDigest');
  assertDigest(value.executionBindingDigest, 'legacy settlement executionBindingDigest');
  assertIsoDate(value.observedAt);
  if (typeof value.providerRevision !== 'string' || value.providerRevision.length === 0
      || value.providerRevision.length > 512 || /[\u0000-\u001f]/u.test(value.providerRevision)) {
    fail('legacy settlement providerRevision must be bounded text.');
  }
  const receiptDigest = assertDigest(value.receiptDigest, 'legacy settlement receiptDigest');
  const { receiptDigest: _receiptDigest, ...unsigned } = value;
  if (receiptDigest !== sha256(encodeVerificationActionData(unsigned))) {
    fail('legacy settlement receipt digest mismatch.');
  }
}

function machineCutoverReceiptPath(fs: RuntimeStateJournalFileSystem): string {
  return path.join(
    fs.rootPath,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY,
    VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
  );
}

function machineCutoverDigest(
  input: Omit<VerificationActionMachineCutoverReceipt, 'receiptDigest'>
): VerificationActionKeyDigest {
  return sha256(encodeVerificationActionData(input));
}

function canonicalMachineCutoverReceipt(
  input: Omit<VerificationActionMachineCutoverReceipt, 'receiptDigest'>
): VerificationActionMachineCutoverReceipt {
  return Object.freeze({ ...input, receiptDigest: machineCutoverDigest(input) });
}

function assertNonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label} is invalid.`);
  return Number(value);
}

function parseMachineCutoverReceipt(source: string): VerificationActionMachineCutoverReceipt {
  const parsed = parseCanonicalJournalDocument(
    source,
    'VerificationAction machine cutover receipt',
    MACHINE_CUTOVER_KEYS
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('machine cutover receipt must be an object.');
  }
  const value = parsed as Record<string, unknown>;
  if (value.schema !== VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA
      || value.legacyEvidenceDisposition !== 'retained-until-owner-authorized-retirement') {
    fail('machine cutover receipt identity is invalid.');
  }
  const receipt = {
    schema: VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA,
    sourceInventoryDigest: assertDigest(
      value.sourceInventoryDigest,
      'machine cutover sourceInventoryDigest'
    )!,
    sourceRecordCount: assertNonnegativeSafeInteger(
      value.sourceRecordCount,
      'machine cutover sourceRecordCount'
    ),
    sourceByteLength: assertNonnegativeSafeInteger(
      value.sourceByteLength,
      'machine cutover sourceByteLength'
    ),
    targetIndexDigest: assertDigest(
      value.targetIndexDigest,
      'machine cutover targetIndexDigest'
    )!,
    targetActionCount: assertNonnegativeSafeInteger(
      value.targetActionCount,
      'machine cutover targetActionCount'
    ),
    legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement' as const
  };
  const receiptDigest = assertDigest(value.receiptDigest, 'machine cutover receiptDigest')!;
  const expected = machineCutoverDigest(receipt);
  if (receiptDigest !== expected) {
    fail(`machine cutover receipt digest mismatch (${String(receiptDigest)} != ${expected}).`);
  }
  return Object.freeze({ ...receipt, receiptDigest });
}

function normalizeInventoryPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function observedInventoryFile(
  absolutePath: string,
  inventoryPath: string,
  entry: NoFollowDirectoryTreeEntry
): MachineCutoverObservedFile {
  if (entry.kind !== 'file') fail(`machine cutover source ${inventoryPath} is not an ordinary file.`);
  if (entry.bytes === null || entry.bytes.byteLength !== entry.size) {
    fail(`machine cutover source ${inventoryPath} has no exact retained bytes.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(entry.bytes);
  } catch {
    fail(`machine cutover source ${inventoryPath} is not exact UTF-8.`);
  }
  return Object.freeze({
    filePath: absolutePath,
    inventoryPath,
    text,
    byteLength: entry.size,
    physical: Object.freeze({ device: entry.device, inode: entry.inode })
  });
}

function machineCutoverGroup(
  groups: Map<string, MachineCutoverActionGroup>,
  groupId: string,
  actionKey: VerificationActionKeyDigest
): MachineCutoverActionGroup {
  const composite = `${groupId}\0${actionKey}`;
  let group = groups.get(composite);
  if (group === undefined) {
    group = {
      groupId,
      actionKey,
      canonical: null,
      legacy: null,
      intent: null,
      claim: null,
      auxiliary: []
    };
    groups.set(composite, group);
  }
  return group;
}

function assignMachineCutoverFile(
  group: MachineCutoverActionGroup,
  field: 'canonical' | 'legacy' | 'intent' | 'claim',
  observed: MachineCutoverObservedFile
): void {
  if (group[field] !== null) fail(`machine cutover found duplicate ${field} evidence for ${group.actionKey}.`);
  group[field] = observed;
}

interface MutationPublicationOwnerObservation {
  readonly host: string;
  readonly pid: number;
  readonly processNonce: string;
  readonly token: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
}

function mutationPublicationOwner(source: string): MutationPublicationOwnerObservation {
  if (!source.endsWith('\n') || source.endsWith('\n\n')) {
    fail('mutation publication candidate bytes are not one newline-terminated document.', 'recovery-required');
  }
  const parsed = parseExactJson(
    source.slice(0, -1),
    'Runtime State mutation publication candidate',
    { rootObjectKeys: MUTATION_LEASE_OWNER_KEYS }
  );
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('mutation publication candidate owner is invalid.', 'recovery-required');
  }
  const value = parsed as Record<string, unknown>;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  if (value.schema !== PHYSICAL_MUTATION_LEASE_SCHEMA
      || typeof value.host !== 'string' || value.host.length === 0 || value.host.length > 255
      || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0
      || typeof value.processNonce !== 'string' || !uuid.test(value.processNonce)
      || typeof value.token !== 'string' || !uuid.test(value.token)
      || !Number.isSafeInteger(value.createdAtMs) || Number(value.createdAtMs) < 0
      || !Number.isSafeInteger(value.expiresAtMs)
      || Number(value.expiresAtMs) < Number(value.createdAtMs)) {
    fail('mutation publication candidate owner is malformed.', 'recovery-required');
  }
  const owner = Object.freeze({
    host: value.host,
    pid: Number(value.pid),
    processNonce: value.processNonce,
    token: value.token,
    createdAtMs: Number(value.createdAtMs),
    expiresAtMs: Number(value.expiresAtMs)
  });
  const exactWriterBytes = `${JSON.stringify({
    schema: PHYSICAL_MUTATION_LEASE_SCHEMA,
    host: owner.host,
    pid: owner.pid,
    processNonce: owner.processNonce,
    token: owner.token,
    createdAtMs: owner.createdAtMs,
    expiresAtMs: owner.expiresAtMs
  })}\n`;
  if (source !== exactWriterBytes) {
    fail('mutation publication candidate bytes do not match the physical owner grammar.', 'recovery-required');
  }
  return owner;
}

function localProcessLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    return error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH'
      ? 'dead'
      : 'unknown';
  }
}

function classifyMutationPublicationCandidate(input: Readonly<{
  fs: RuntimeStateJournalFileSystem;
  fileName: string;
  absolutePath: string;
  inventoryPath: string;
  entry: NoFollowDirectoryTreeEntry;
  deadline: number;
  machineReceiptLockName: string;
  allowIncompleteReceiptPublication: boolean;
}>): never {
  const match = MUTATION_LEASE_CANDIDATE_PATTERN.exec(input.fileName);
  if (match === null) {
    fail(`machine cutover found malformed mutation publication residue at ${input.inventoryPath}.`, 'recovery-required');
  }
  const isReceiptPublication = match[1]!.slice(1) === input.machineReceiptLockName;
  const candidate = observedInventoryFile(
    input.absolutePath,
    input.inventoryPath,
    input.entry
  );
  let owner: MutationPublicationOwnerObservation;
  try {
    owner = mutationPublicationOwner(candidate.text);
  } catch {
    if (isReceiptPublication && input.allowIncompleteReceiptPublication) {
      fail('machine cutover mutation publication is incomplete.', 'recovery-required');
    }
    fail(`machine cutover found malformed mutation publication candidate at ${input.inventoryPath}.`, 'recovery-required');
  }
  if (owner.host !== hostname()) {
    fail(`machine cutover found foreign-host mutation publication candidate at ${input.inventoryPath}.`, 'recovery-required');
  }
  const liveness = localProcessLiveness(owner.pid);
  if (liveness === 'alive') {
    if (isReceiptPublication) {
      fail('machine cutover mutation is contended.', 'recovery-required');
    }
    fail(`machine cutover observed an active physical mutation publication at ${input.inventoryPath}.`, 'recovery-required');
  }
  if (liveness === 'dead') {
    fail(`machine cutover found a stale mutation publication candidate at ${input.inventoryPath}; physical owner recovery is required.`, 'recovery-required');
  }
  fail(`machine cutover cannot prove mutation publication owner liveness at ${input.inventoryPath}.`, 'recovery-required');
}

function classifyMachineCutoverFile(input: Readonly<{
  fs: RuntimeStateJournalFileSystem;
  groups: Map<string, MachineCutoverActionGroup>;
  evidence: MachineCutoverObservedFile[];
  quarantines: MachineCutoverObservedQuarantine[];
  groupId: string;
  domain: 'terminal-bound' | 'v2';
  fileName: string;
  absolutePath: string;
  inventoryPath: string;
  entry: NoFollowDirectoryTreeEntry;
  deadline: number;
  machineReceiptLockName: string;
  allowIncompleteReceiptPublication: boolean;
  global: boolean;
}>): void {
  if (input.global && input.domain === 'terminal-bound') {
    if (input.fileName === VERIFICATION_ACTION_MACHINE_CUTOVER_FILE) return;
    if (input.fileName === input.machineReceiptLockName) return;
    const quarantine = ACTION_QUARANTINE_PATTERN.exec(input.fileName);
    if (quarantine !== null) {
      const observed = observedInventoryFile(
        input.absolutePath,
        input.inventoryPath,
        input.entry
      );
      const receipt = parseLegacyQuarantineReceipt(
        observed.text,
        `sha256:${quarantine[1]}` as VerificationActionKeyDigest
      );
      input.quarantines.push(Object.freeze({
        actionKey: receipt.actionKey,
        observed,
        receipt
      }));
      return;
    }
  }
  if (input.fileName.startsWith('.journal-mutation-')
      || input.fileName.startsWith('..journal-mutation-')) {
    if (input.fileName.endsWith('.candidate')) {
      classifyMutationPublicationCandidate(input);
    }
    if (MUTATION_LEASE_NAME_PATTERN.exec(input.fileName) === null) {
      fail(`machine cutover found malformed mutation lease residue at ${input.inventoryPath}.`, 'recovery-required');
    }
    if (input.global) return;
    fail(`machine cutover found an active journal mutation at ${input.inventoryPath}.`, 'recovery-required');
  }
  const claim = ACTION_CLAIM_PATTERN.exec(input.fileName);
  const recoveryLock = ACTION_RECOVERY_LOCK_PATTERN.exec(input.fileName);
  if (recoveryLock !== null) {
    if (input.global) return;
    fail(`machine cutover found an unresolved physical claim at ${input.inventoryPath}.`, 'recovery-required');
  }
  if (claim !== null) {
    if (input.global) return;
    const actionKey = `sha256:${claim[1]}` as VerificationActionKeyDigest;
    const observed = observedInventoryFile(
      input.absolutePath,
      input.inventoryPath,
      input.entry
    );
    parseMachineCutoverClaim(observed.text, actionKey);
    assignMachineCutoverFile(
      machineCutoverGroup(input.groups, input.groupId, actionKey),
      'claim',
      observed
    );
    input.evidence.push(observed);
    return;
  }
  const actionMatch = ACTION_FILE_PATTERN.exec(input.fileName);
  const cutoverMatch = ACTION_CUTOVER_PATTERN.exec(input.fileName);
  const legacyAuxiliary = input.domain === 'v2'
    ? (LEGACY_START_RECEIPT_PATTERN.exec(input.fileName)
      ?? LEGACY_TERMINAL_EVIDENCE_PATTERN.exec(input.fileName)
      ?? LEGACY_PROCESS_SETTLEMENT_PATTERN.exec(input.fileName))
    : null;
  if (legacyAuxiliary !== null) {
    const observed = observedInventoryFile(
      input.absolutePath,
      input.inventoryPath,
      input.entry
    );
    const group = machineCutoverGroup(
      input.groups,
      input.groupId,
      `sha256:${legacyAuxiliary[1]}` as VerificationActionKeyDigest
    );
    if (LEGACY_PROCESS_SETTLEMENT_PATTERN.test(input.fileName)) {
      parseLegacyProcessSettlement(observed.text, group.actionKey);
    }
    group.auxiliary.push(observed);
    input.evidence.push(observed);
    return;
  }
  const match = actionMatch ?? cutoverMatch;
  if (match === null) fail(`machine cutover found unknown journal residue at ${input.inventoryPath}.`);
  const actionKey = `sha256:${match[1]}` as VerificationActionKeyDigest;
  const observed = observedInventoryFile(
    input.absolutePath,
    input.inventoryPath,
    input.entry
  );
  const group = machineCutoverGroup(input.groups, input.groupId, actionKey);
  if (cutoverMatch !== null) {
    if (input.domain !== 'terminal-bound') fail(`machine cutover intent is in the wrong domain at ${input.inventoryPath}.`);
    assignMachineCutoverFile(group, 'intent', observed);
  } else if (input.domain === 'terminal-bound') {
    assignMachineCutoverFile(group, 'canonical', observed);
  } else {
    assignMachineCutoverFile(group, 'legacy', observed);
  }
  if (!input.global || input.domain === 'v2' || cutoverMatch !== null) input.evidence.push(observed);
}

function scanMachineCutoverTree(input: Readonly<{
  fs: RuntimeStateJournalFileSystem;
  rootPath: string;
  mode: 'workspaces' | 'global';
  groups: Map<string, MachineCutoverActionGroup>;
  evidence: MachineCutoverObservedFile[];
  quarantines: MachineCutoverObservedQuarantine[];
  deadline: number;
  machineReceiptLockName: string;
  allowIncompleteReceiptPublication: boolean;
}>): void {
  const presence = inspectExactNoFollowDirectoryPresence(
    input.rootPath,
    `VerificationAction ${input.mode} cutover root`
  );
  if (presence.state === 'absent') return;
  const inventory = input.mode === 'workspaces'
    ? scanNoFollowDirectoryTreeSelectedForest(presence.directory.target, {
      deadlineAtMs: input.deadline,
      maximumEntries: MACHINE_CUTOVER_MAXIMUM_ENTRIES,
      maximumBytes: MACHINE_CUTOVER_MAXIMUM_SOURCE_BYTES,
      includeRelativePaths: ['*/verification-actions'],
      omitNavigationPrefixes: true
    })
    : scanNoFollowDirectoryTree(presence.directory.target, {
    deadlineAtMs: input.deadline,
    maximumEntries: MACHINE_CUTOVER_MAXIMUM_ENTRIES,
    maximumBytes: MACHINE_CUTOVER_MAXIMUM_SOURCE_BYTES
  });
  const staticClosures = new Map<string, LegacyStaticClosureProjection>();
  const staticPointers: Array<Readonly<{
    groupId: string;
    inventoryPath: string;
    projection: LegacyStaticPointerProjection;
  }>> = [];
  const staticClosureKey = (groupId: string, closureDigest: VerificationActionKeyDigest): string =>
    `${groupId}:${closureDigest}`;
  for (const entry of inventory) {
    const relativePath = normalizeInventoryPath(entry.relativePath);
    if (relativePath.length === 0) continue;
    const segments = relativePath.split('/');
    let groupId: string;
    let domain: 'terminal-bound' | 'v2';
    let fileName: string;
    if (input.mode === 'workspaces') {
      if (!WORKSPACE_LOCATOR_PATTERN.test(segments[0]!)) {
        fail(`machine cutover found a noncanonical workspace locator at ${relativePath}.`);
      }
      if (segments.length === 1) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments[1] !== 'verification-actions') {
        fail(`machine cutover selected an unexpected workspace path at ${relativePath}.`);
      }
      if (segments.length === 2) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if ((segments[2] !== 'terminal-bound' && segments[2] !== 'v2') || segments.length > 5) {
        fail(`machine cutover found unknown workspace journal residue at ${relativePath}.`);
      }
      if (segments.length === 3) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments.length === 4 && segments[2] === 'v2'
          && LEGACY_ACTION_EVIDENCE_DIRECTORIES.has(segments[3]!)) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments.length === 5) {
        if (segments[2] !== 'v2'
            || !LEGACY_ACTION_EVIDENCE_DIRECTORIES.has(segments[3]!)) {
          fail(`machine cutover found unknown workspace journal residue at ${relativePath}.`);
        }
        const staticRecord = LEGACY_STATIC_RECORD_PATTERN.exec(segments[4]!);
        if (staticRecord === null) fail(`machine cutover found unknown static evidence at ${relativePath}.`);
        const observed = observedInventoryFile(
          path.join(input.rootPath, ...segments),
          normalizeInventoryPath(path.relative(input.fs.rootPath, path.join(input.rootPath, ...segments))),
          entry
        );
        const actionKey = `sha256:${staticRecord[1]}` as VerificationActionKeyDigest;
        if (segments[3] === 'static-closures') {
          const closure = parseLegacyStaticClosure(observed.text, actionKey);
          const key = staticClosureKey(segments[0]!, closure.closureDigest);
          if (staticClosures.has(key)) {
            fail(`machine cutover found duplicate static closure evidence at ${relativePath}.`);
          }
          staticClosures.set(key, closure);
        } else if (segments[3] === 'static-current') {
          staticPointers.push(Object.freeze({
            groupId: segments[0]!,
            inventoryPath: observed.inventoryPath,
            projection: parseLegacyStaticPointer(observed.text, actionKey)
          }));
        } else if (segments[3] === 'settlement-current') {
          parseLegacySettlementReceipt(observed.text, actionKey);
        }
        input.evidence.push(observed);
        if (segments[3] === 'settlement-current') {
          const group = machineCutoverGroup(
            input.groups,
            segments[0]!,
            actionKey
          );
          group.auxiliary.push(observed);
        }
        continue;
      }
      groupId = segments[0]!;
      domain = segments[2] as 'terminal-bound' | 'v2';
      fileName = segments[3]!;
    } else {
      if ((segments[0] !== 'terminal-bound' && segments[0] !== 'v2') || segments.length > 3) {
        fail(`machine cutover found unknown global journal residue at ${relativePath}.`);
      }
      if (segments.length === 1) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments.length === 2 && segments[0] === 'v2'
          && (segments[1] === 'static-closures' || segments[1] === 'static-current')) {
        if (entry.kind !== 'directory') fail(`machine cutover path ${relativePath} is not a directory.`);
        continue;
      }
      if (segments.length === 3) {
        if (segments[0] !== 'v2'
            || (segments[1] !== 'static-closures' && segments[1] !== 'static-current')) {
          fail(`machine cutover found unknown global journal residue at ${relativePath}.`);
        }
        const staticRecord = LEGACY_STATIC_RECORD_PATTERN.exec(segments[2]!);
        if (staticRecord === null) fail(`machine cutover found unknown static evidence at ${relativePath}.`);
        const observed = observedInventoryFile(
          path.join(input.rootPath, ...segments),
          normalizeInventoryPath(path.relative(input.fs.rootPath, path.join(input.rootPath, ...segments))),
          entry
        );
        input.evidence.push(observed);
        const identity = `sha256:${staticRecord[1]}` as VerificationActionKeyDigest;
        if (segments[1] === 'static-closures') {
          const closure = parseLegacyStaticClosure(observed.text, identity);
          const key = staticClosureKey('@machine', closure.closureDigest);
          if (staticClosures.has(key)) {
            fail(`machine cutover found duplicate static closure evidence at ${relativePath}.`);
          }
          staticClosures.set(key, closure);
        } else {
          staticPointers.push(Object.freeze({
            groupId: '@machine',
            inventoryPath: observed.inventoryPath,
            projection: parseLegacyStaticPointer(observed.text, identity)
          }));
        }
        continue;
      }
      groupId = '@machine';
      domain = segments[0] as 'terminal-bound' | 'v2';
      fileName = segments[1]!;
    }
    classifyMachineCutoverFile({
      fs: input.fs,
      groups: input.groups,
      evidence: input.evidence,
      quarantines: input.quarantines,
      groupId,
      domain,
      fileName,
      absolutePath: path.join(input.rootPath, ...segments),
      inventoryPath: normalizeInventoryPath(path.relative(input.fs.rootPath, path.join(input.rootPath, ...segments))),
      entry,
      deadline: input.deadline,
      machineReceiptLockName: input.machineReceiptLockName,
      allowIncompleteReceiptPublication: input.allowIncompleteReceiptPublication,
      global: input.mode === 'global'
    });
  }
  for (const pointer of staticPointers) {
    const closure = staticClosures.get(staticClosureKey(
      pointer.groupId,
      pointer.projection.closureDigest
    ));
    if (closure === undefined) {
      fail(`machine cutover static pointer has no retained closure at ${pointer.inventoryPath}.`);
    }
    if (closure.actionKey !== pointer.projection.actionKey
        || closure.actionPlanDigest !== pointer.projection.actionPlanDigest
        || closure.readbackDigest !== pointer.projection.readbackDigest) {
      fail(`machine cutover static pointer binding mismatch at ${pointer.inventoryPath}.`);
    }
  }
}

type MachineCutoverTarget = Readonly<
  | {
    kind: 'journal';
    actionKey: VerificationActionKeyDigest;
    source: string;
    action: VerificationActionKey;
    sourceEvidence: readonly VerificationActionLegacyQuarantineEvidence[];
  }
  | {
    kind: 'quarantine';
    actionKey: VerificationActionKeyDigest;
    action: VerificationActionKey | null;
    sourceEvidence: readonly VerificationActionLegacyQuarantineEvidence[];
    retainedJournalSource: string | null;
  }
>;

function quarantineEvidence(
  observed: readonly MachineCutoverObservedFile[]
): readonly VerificationActionLegacyQuarantineEvidence[] {
  return Object.freeze(observed.map((entry) => Object.freeze({
    path: entry.inventoryPath,
    physical: entry.physical,
    ledgerDigest: sha256(entry.text),
    byteLength: entry.byteLength
  })));
}

function machineCutoverCandidate(group: MachineCutoverActionGroup): MachineCutoverTarget {
  if (group.canonical !== null) {
    let canonical: VerificationActionJournalReadback;
    try {
      canonical = parseJournalSource(group.canonical.filePath, group.actionKey, group.canonical.text);
    } catch {
      if (group.claim !== null) {
        fail(`machine cutover found a claim bound to unreadable canonical evidence for ${group.actionKey}.`, 'recovery-required');
      }
      const retiredAction = parseRetiredCanonicalJournalForQuarantine(group.actionKey, group.canonical.text);
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: retiredAction,
        sourceEvidence: quarantineEvidence([group.canonical, ...group.auxiliary]),
        retainedJournalSource: null
      });
    }
    if (group.claim !== null) {
      const claim = parseMachineCutoverClaim(group.claim.text, group.actionKey);
      if (Date.parse(claim.expiresAt) >= Date.now()) {
        fail(`machine cutover found an active physical claim for ${group.actionKey}.`, 'recovery-required');
      }
      if (group.groupId === '@machine'
          || (canonical.latestState !== 'queued' && canonical.latestState !== 'running')) {
        fail(`machine cutover found an unresolved physical claim for ${group.actionKey}.`, 'recovery-required');
      }
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: canonical.action,
        sourceEvidence: quarantineEvidence([
          group.canonical,
          group.claim,
          ...(group.legacy === null ? [] : [group.legacy]),
          ...(group.intent === null ? [] : [group.intent]),
          ...group.auxiliary
        ]),
        retainedJournalSource: group.canonical.text
      });
    }
    if (group.groupId !== '@machine'
        && (canonical.latestState === 'queued' || canonical.latestState === 'running')) {
      if (canonical.action === null) fail(`machine cutover canonical Action ${group.actionKey} is empty.`);
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: canonical.action,
        sourceEvidence: quarantineEvidence([
          group.canonical,
          ...(group.legacy === null ? [] : [group.legacy]),
          ...(group.intent === null ? [] : [group.intent]),
          ...group.auxiliary
        ]),
        retainedJournalSource: null
      });
    }
    if (group.legacy === null && group.intent === null) {
      if (canonical.action === null) fail(`machine cutover canonical Action ${group.actionKey} is empty.`);
      return Object.freeze({
        kind: 'journal',
        actionKey: group.actionKey,
        source: group.canonical.text,
        action: canonical.action,
        sourceEvidence: quarantineEvidence([group.canonical, ...group.auxiliary])
      });
    }
    if (group.legacy === null || group.intent === null) {
      fail(`machine cutover found a partial per-workspace cutover for ${group.actionKey}.`, 'recovery-required');
    }
    const intent = parseCutoverIntent(group.intent.text);
    if (intent.phase !== 'complete' || intent.actionKey !== group.actionKey) {
      fail(`machine cutover found an incomplete per-workspace cutover for ${group.actionKey}.`, 'recovery-required');
    }
    exactLegacyObservation(group.legacy, intent);
    exactTargetObservation(group.canonical, intent);
    if (canonical.action === null) fail(`machine cutover canonical Action ${group.actionKey} is empty.`);
    return Object.freeze({
      kind: 'journal',
      actionKey: group.actionKey,
      source: group.canonical.text,
      action: canonical.action,
      sourceEvidence: quarantineEvidence([
        group.canonical, group.legacy, group.intent, ...group.auxiliary
      ])
    });
  }
  if (group.intent !== null) {
    fail(`machine cutover intent for ${group.actionKey} has no canonical target.`, 'recovery-required');
  }
  if (group.legacy === null) {
    if (group.claim !== null) {
      fail(`machine cutover found an unresolved physical claim for ${group.actionKey}.`, 'recovery-required');
    }
    fail(`machine cutover group ${group.groupId} has no journal evidence.`);
  }
  const legacy = parseLegacyJournalSource(group.actionKey, group.legacy.text);
  const latest = legacy.at(-1) ?? null;
  if (latest === null || (latest.state !== 'terminal' && latest.state !== 'reused')) {
    if (group.claim !== null) {
      const claim = parseMachineCutoverClaim(group.claim.text, group.actionKey);
      if (Date.parse(claim.expiresAt) >= Date.now()) {
        fail(`machine cutover found an active physical claim for ${group.actionKey}.`, 'recovery-required');
      }
      if (latest === null) {
        fail(`machine cutover found an expired claim without journal evidence for ${group.actionKey}.`, 'recovery-required');
      }
      // The retired claim grammar has no retained process handle, attempt
      // receipt or terminal authority.  Expiry therefore cannot authorize a
      // retry or promote sibling evidence to PASS.  The current recovery
      // contract would durably cancel an abandoned queued/running Action and
      // require a new Action identity; cutover preserves the old bytes and
      // establishes the stronger machine-global equivalent by quarantining
      // this ActionKey against both reuse and execution.
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: latest.action,
        sourceEvidence: quarantineEvidence([group.legacy, group.claim, ...group.auxiliary]),
        retainedJournalSource: null
      });
    }
    if (latest === null) fail(`machine cutover found empty legacy Action ${group.actionKey}.`);
    return Object.freeze({
      kind: 'quarantine',
      actionKey: group.actionKey,
      action: latest.action,
      sourceEvidence: quarantineEvidence([group.legacy, ...group.auxiliary]),
      retainedJournalSource: null
    });
  }
  if (group.claim !== null) {
    const claim = parseMachineCutoverClaim(group.claim.text, group.actionKey);
    const expiresAtMs = Date.parse(claim.expiresAt);
    const acquiredAtMs = Date.parse(claim.acquiredAt);
    const terminalAtMs = Date.parse(latest.recordedAt);
    if (expiresAtMs >= Date.now()) {
      fail(`machine cutover found an active physical claim for ${group.actionKey}.`, 'recovery-required');
    }
    if (terminalAtMs < acquiredAtMs) {
      fail(`machine cutover claim is not dominated by its legacy terminal for ${group.actionKey}.`, 'recovery-required');
    }
    if (latest.terminal !== null || latest.terminalMigratable
        || !legacy.slice(0, -1).every(({ terminalMigratable }) => terminalMigratable)) {
      fail(`machine cutover found an unclassified terminal claim residue for ${group.actionKey}.`, 'recovery-required');
    }
    return Object.freeze({
      kind: 'quarantine',
      actionKey: group.actionKey,
      action: latest.action,
      sourceEvidence: quarantineEvidence([group.legacy, group.claim, ...group.auxiliary]),
      retainedJournalSource: null
    });
  }
  if (latest.terminal !== null && legacy.every(({ terminalMigratable }) => terminalMigratable)) {
    if (latest.action === null) {
      return Object.freeze({
        kind: 'quarantine',
        actionKey: group.actionKey,
        action: null,
        sourceEvidence: quarantineEvidence([group.legacy, ...group.auxiliary]),
        retainedJournalSource: null
      });
    }
    return Object.freeze({
      kind: 'journal',
      actionKey: group.actionKey,
      source: migratedJournalSource(legacy),
      action: latest.action,
      sourceEvidence: quarantineEvidence([group.legacy, ...group.auxiliary])
    });
  }
  if (latest.terminal === null && !latest.terminalMigratable
      && legacy.slice(0, -1).every(({ terminalMigratable }) => terminalMigratable)) {
    return Object.freeze({
      kind: 'quarantine',
      actionKey: group.actionKey,
      action: latest.action,
      sourceEvidence: quarantineEvidence([group.legacy, ...group.auxiliary]),
      retainedJournalSource: null
    });
  }
  fail(`machine cutover found an unclassified legacy Action ${group.actionKey}.`, 'recovery-required');
}

function mergeMachineCutoverCandidate(
  current: MachineCutoverTarget | undefined,
  candidate: MachineCutoverTarget,
  actionKey: VerificationActionKeyDigest
): MachineCutoverTarget {
  if (current === undefined) return candidate;
  if (current.kind !== candidate.kind) {
    const trusted = current.kind === 'journal' ? current : candidate;
    const quarantined = current.kind === 'quarantine' ? current : candidate;
    if (trusted.kind !== 'journal' || quarantined.kind !== 'quarantine') {
      fail(`machine cutover lost its journal/quarantine discriminant for ${actionKey}.`);
    }
    if (trusted.actionKey !== quarantined.actionKey) {
      fail(`machine cutover found divergent quarantine identities for ${actionKey}.`, 'recovery-required');
    }
    return Object.freeze({
      kind: 'quarantine',
      actionKey,
      action: quarantined.action ?? trusted.action,
      sourceEvidence: canonicalQuarantineEvidence([
        ...trusted.sourceEvidence,
        ...quarantined.sourceEvidence
      ]),
      retainedJournalSource: quarantined.retainedJournalSource === trusted.source
        ? trusted.source
        : null
    });
  }
  if (current.kind === 'journal' && candidate.kind === 'journal') {
    if (candidate.source === current.source || candidate.source.startsWith(current.source)) return candidate;
    if (current.source.startsWith(candidate.source)) return current;
    return Object.freeze({
      kind: 'quarantine',
      actionKey,
      action: current.action,
      sourceEvidence: canonicalQuarantineEvidence([
        ...current.sourceEvidence,
        ...candidate.sourceEvidence
      ]),
      retainedJournalSource: null
    });
  }
  if (current.kind === 'quarantine' && candidate.kind === 'quarantine') {
    if (current.actionKey !== candidate.actionKey) {
      fail(`machine cutover found divergent quarantine identities for ${actionKey}.`, 'recovery-required');
    }
    if (current.retainedJournalSource !== null
        && candidate.retainedJournalSource !== null
        && current.retainedJournalSource !== candidate.retainedJournalSource) {
      fail(`machine cutover found divergent retained journal evidence for ${actionKey}.`, 'recovery-required');
    }
    return Object.freeze({
      kind: 'quarantine',
      actionKey,
      action: current.action ?? candidate.action,
      sourceEvidence: canonicalQuarantineEvidence([
        ...current.sourceEvidence,
        ...candidate.sourceEvidence
      ]),
      retainedJournalSource: current.retainedJournalSource ?? candidate.retainedJournalSource
    });
  }
  fail(`machine cutover found divergent journal chains for ${actionKey}.`, 'recovery-required');
}

function collectMachineCutoverCensus(
  fs: RuntimeStateJournalFileSystem,
  deadline: number,
  machineReceiptLockName: string,
  allowIncompleteReceiptPublication: boolean
): MachineCutoverCensus {
  const groups = new Map<string, MachineCutoverActionGroup>();
  const evidence: MachineCutoverObservedFile[] = [];
  const quarantines: MachineCutoverObservedQuarantine[] = [];
  scanMachineCutoverTree({
    fs,
    rootPath: path.join(fs.rootPath, 'workspaces', 'records'),
    mode: 'workspaces',
    groups,
    evidence,
    quarantines,
    deadline,
    machineReceiptLockName,
    allowIncompleteReceiptPublication
  });
  scanMachineCutoverTree({
    fs,
    rootPath: path.join(fs.rootPath, 'verification-actions'),
    mode: 'global',
    groups,
    evidence,
    quarantines,
    deadline,
    machineReceiptLockName,
    allowIncompleteReceiptPublication
  });
  const inventory = evidence
    .map((entry) => Object.freeze({
      path: entry.inventoryPath,
      device: entry.physical.device,
      inode: entry.physical.inode,
      byteLength: entry.byteLength,
      contentDigest: sha256(entry.text)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const sourceByteLength = inventory.reduce((total, entry) => total + entry.byteLength, 0);
  if (!Number.isSafeInteger(sourceByteLength) || sourceByteLength > MACHINE_CUTOVER_MAXIMUM_SOURCE_BYTES) {
    fail('machine cutover source bytes exceed the aggregate ceiling.', 'recovery-required');
  }
  const observedByPath = new Map<string, MachineCutoverObservedFile>();
  const addObserved = (observed: MachineCutoverObservedFile | null): void => {
    if (observed === null) return;
    const prior = observedByPath.get(observed.inventoryPath);
    if (prior !== undefined && prior !== observed) {
      fail(`machine cutover observed duplicate physical evidence at ${observed.inventoryPath}.`, 'recovery-required');
    }
    observedByPath.set(observed.inventoryPath, observed);
  };
  for (const observed of evidence) addObserved(observed);
  for (const group of groups.values()) {
    addObserved(group.canonical);
    addObserved(group.legacy);
    addObserved(group.intent);
    addObserved(group.claim);
    for (const auxiliary of group.auxiliary) addObserved(auxiliary);
  }
  for (const quarantine of quarantines) addObserved(quarantine.observed);
  const existingTargets = new Map<VerificationActionKeyDigest, {
    journal: MachineCutoverObservedFile | null;
    quarantine: MachineCutoverObservedFile | null;
  }>();
  const existingTarget = (actionKey: VerificationActionKeyDigest) => {
    let target = existingTargets.get(actionKey);
    if (target === undefined) {
      target = { journal: null, quarantine: null };
      existingTargets.set(actionKey, target);
    }
    return target;
  };
  for (const group of groups.values()) {
    if (group.groupId === '@machine' && group.canonical !== null) {
      const target = existingTarget(group.actionKey);
      if (target.journal !== null) fail(`machine cutover found duplicate machine journal for ${group.actionKey}.`);
      target.journal = group.canonical;
    }
  }
  for (const quarantine of quarantines) {
    verifyLegacyQuarantineEvidenceFromCensus(quarantine.receipt, observedByPath);
    const target = existingTarget(quarantine.actionKey);
    if (target.quarantine !== null) fail(`machine cutover found duplicate machine quarantine for ${quarantine.actionKey}.`);
    target.quarantine = quarantine.observed;
  }
  for (const [actionKey, target] of existingTargets) {
    if (target.journal !== null && target.quarantine !== null) {
      const quarantine = quarantines.find((entry) => entry.actionKey === actionKey);
      if (quarantine === undefined) fail(`machine cutover lost quarantine projection for ${actionKey}.`);
      assertQuarantineDominatesRetainedJournal(fs, quarantine.receipt, target.journal, actionKey);
    }
  }
  return Object.freeze({
    groups: Object.freeze([...groups.values()]),
    existingTargets,
    sourceInventoryDigest: sha256(encodeVerificationActionData(inventory)),
    sourceRecordCount: inventory.length,
    sourceByteLength
  });
}

interface MachineCutoverPlannedTarget {
  readonly actionKey: VerificationActionKeyDigest;
  readonly target: MachineCutoverTarget;
  readonly source: string;
}

function planMachineCutoverTargets(
  census: MachineCutoverCensus
): readonly MachineCutoverPlannedTarget[] {
  const merged = new Map<VerificationActionKeyDigest, MachineCutoverTarget>();
  for (const group of census.groups) {
    const candidate = machineCutoverCandidate(group);
    merged.set(
      group.actionKey,
      mergeMachineCutoverCandidate(merged.get(group.actionKey), candidate, group.actionKey)
    );
  }
  return Object.freeze([...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionKey, target]) => {
      let plannedTarget = target;
      const retained = census.existingTargets.get(actionKey)?.journal ?? null;
      if (target.kind === 'quarantine' && retained !== null
          && target.sourceEvidence.some((entry) =>
            entry.path === retained.inventoryPath
              && samePhysical(entry.physical, retained.physical)
              && entry.byteLength === retained.byteLength
              && entry.ledgerDigest === sha256(retained.text))) {
        plannedTarget = Object.freeze({
          ...target,
          retainedJournalSource: retained.text
        });
      }
      return Object.freeze({
        actionKey,
        target: plannedTarget,
        source: plannedTarget.kind === 'journal'
          ? plannedTarget.source
          : `${encodeVerificationActionData(canonicalLegacyQuarantineReceipt(plannedTarget))}\n`
      });
    }));
}

function publishMachineCutoverTargets(
  fs: RuntimeStateJournalFileSystem,
  census: MachineCutoverCensus,
  planned: readonly MachineCutoverPlannedTarget[]
): void {
  for (const { actionKey, target, source } of planned) {
    const filePath = target.kind === 'journal'
      ? actionPath(fs, actionKey)
      : legacyQuarantinePath(fs, actionKey);
    const existingTargets = census.existingTargets.get(actionKey);
    const existing = target.kind === 'journal'
      ? existingTargets?.journal ?? null
      : existingTargets?.quarantine ?? null;
    const conflicting = target.kind === 'journal'
      ? existingTargets?.quarantine ?? null
      : existingTargets?.journal ?? null;
    if (conflicting !== null) {
      if (target.kind !== 'quarantine' || target.retainedJournalSource !== conflicting.text) {
        fail(`machine cutover target kind conflicts for ${actionKey}.`, 'recovery-required');
      }
      assertQuarantineDominatesRetainedJournal(
        fs,
        canonicalLegacyQuarantineReceipt(target),
        conflicting,
        actionKey
      );
    }
    if (existing === null) {
      if (!fs.createExclusiveFsync(filePath, source)) {
        fail(`machine cutover target changed concurrently for ${actionKey}.`, 'recovery-required');
      }
    } else if (existing.text !== source) {
      if (!source.startsWith(existing.text)
          || !fs.replaceFsyncCas(filePath, existing.text, source)) {
        fail(`machine cutover target conflicts for ${actionKey}.`, 'recovery-required');
      }
    }
  }
}

function readbackMachineCutoverTargets(
  fs: RuntimeStateJournalFileSystem,
  census: MachineCutoverCensus,
  planned: readonly MachineCutoverPlannedTarget[]
): Readonly<{ targetIndexDigest: VerificationActionKeyDigest; targetActionCount: number }> {
  if (census.existingTargets.size !== planned.length) {
    fail('machine cutover target set changed before completion.', 'recovery-required');
  }
  const targetIndex = planned.map(({ actionKey, target, source }) => {
    const existing = census.existingTargets.get(actionKey);
    const readback = target.kind === 'journal' ? existing?.journal ?? null : existing?.quarantine ?? null;
    const conflicting = target.kind === 'journal' ? existing?.quarantine ?? null : existing?.journal ?? null;
    if (readback === null || readback.text !== source) {
      fail(`machine cutover target readback mismatch for ${actionKey}.`, 'recovery-required');
    }
    if (conflicting !== null) {
      if (target.kind !== 'quarantine' || target.retainedJournalSource !== conflicting.text) {
        fail(`machine cutover target kind conflicts for ${actionKey}.`, 'recovery-required');
      }
      assertQuarantineDominatesRetainedJournal(
        fs,
        parseLegacyQuarantineReceipt(readback.text, actionKey),
        conflicting,
        actionKey
      );
    }
    if (target.kind === 'journal') parseJournalSource(readback.filePath, actionKey, readback.text);
    else parseLegacyQuarantineReceipt(readback.text, actionKey);
    return Object.freeze({
      actionKey,
      kind: target.kind,
      ledgerDigest: sha256(readback.text),
      byteLength: readback.byteLength,
      physical: readback.physical
    });
  });
  return Object.freeze({
    targetIndexDigest: sha256(encodeVerificationActionData(targetIndex)),
    targetActionCount: targetIndex.length
  });
}

function machineCutoverPlanDigest(
  planned: readonly MachineCutoverPlannedTarget[]
): VerificationActionKeyDigest {
  return sha256(encodeVerificationActionData(planned.map(({ actionKey, target, source }) => ({
    actionKey,
    kind: target.kind,
    sourceDigest: sha256(source),
    byteLength: Buffer.byteLength(source, 'utf8')
  }))));
}

/**
 * Completes the one machine-generation cutover before any global ActionKey
 * admission. Old workspace journals remain read-only migration evidence; the
 * completed receipt is the retirement fence, so normal Action reads never
 * rescan workspace history or retain a dual-read compatibility path.
 */
export function ensureVerificationActionMachineGlobalCutover(
  fs: RuntimeStateJournalFileSystem,
  // Runner-only observation seam: an empty same-lock candidate is allowed one
  // bounded filesystem-settlement window, then the strict classifier decides.
  // It never grants owner identity, liveness, or mutation authority.
  options: Readonly<{ allowIncompleteReceiptPublication?: boolean }> = {}
): VerificationActionMachineCutoverReceipt {
  const receiptPath = machineCutoverReceiptPath(fs);
  const existing = observeJournalSource(
    fs,
    receiptPath,
    performance.now() + JOURNAL_READ_BOUNDS.durationMs
  );
  if (existing !== null) {
    if (existing.byteLength === 0) fail('machine cutover receipt is empty.');
    return parseMachineCutoverReceipt(existing.text);
  }
  const receiptLockName = runtimeStateJournalMutationLeaseName(fs.rootPath, receiptPath);
  let result: string;
  try {
    result = fs.mutateTextFsync(
      receiptPath,
      '',
      MACHINE_CUTOVER_RECEIPT_MAXIMUM_BYTES,
      (current) => {
      if (current.length > 0) return `${encodeVerificationActionData(parseMachineCutoverReceipt(current))}\n`;
      const deadline = performance.now() + JOURNAL_READ_BOUNDS.durationMs;
      const initial = collectMachineCutoverCensus(
        fs,
        deadline,
        receiptLockName,
        options.allowIncompleteReceiptPublication === true
      );
      const initialPlan = planMachineCutoverTargets(initial);
      publishMachineCutoverTargets(fs, initial, initialPlan);
      const final = collectMachineCutoverCensus(
        fs,
        deadline,
        receiptLockName,
        options.allowIncompleteReceiptPublication === true
      );
      if (final.sourceInventoryDigest !== initial.sourceInventoryDigest
          || final.sourceRecordCount !== initial.sourceRecordCount
          || final.sourceByteLength !== initial.sourceByteLength) {
        fail('machine cutover source inventory changed before completion.', 'recovery-required');
      }
      const finalPlan = planMachineCutoverTargets(final);
      if (machineCutoverPlanDigest(finalPlan) !== machineCutoverPlanDigest(initialPlan)) {
        fail('machine cutover target plan changed before completion.', 'recovery-required');
      }
      const finalTargets = readbackMachineCutoverTargets(fs, final, finalPlan);
      const receipt = canonicalMachineCutoverReceipt({
        schema: VERIFICATION_ACTION_MACHINE_CUTOVER_SCHEMA,
        sourceInventoryDigest: final.sourceInventoryDigest,
        sourceRecordCount: final.sourceRecordCount,
        sourceByteLength: final.sourceByteLength,
        targetIndexDigest: finalTargets.targetIndexDigest,
        targetActionCount: finalTargets.targetActionCount,
        legacyEvidenceDisposition: 'retained-until-owner-authorized-retirement'
      });
        return `${encodeVerificationActionData(receipt)}\n`;
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Runtime State journal mutation is contended.') {
      fail('machine cutover mutation is contended.', 'recovery-required');
    }
    throw error;
  }
  return parseMachineCutoverReceipt(result);
}

function readVerificationActionJournalGeneration(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest,
  deadline: number
): Readonly<{ readback: VerificationActionJournalReadback; source: string | null }> {
  const filePath = actionPath(fs, actionKey);
  const quarantineSource = observeJournalSource(
    fs,
    legacyQuarantinePath(fs, actionKey),
    deadline
  );
  const source = observeJournalSource(fs, filePath, deadline);
  if (quarantineSource !== null) {
    const receipt = parseLegacyQuarantineReceipt(quarantineSource.text, actionKey);
    verifyLegacyQuarantineEvidence(fs, receipt, deadline);
    if (source !== null) {
      assertQuarantineDominatesRetainedJournal(fs, receipt, source, actionKey);
    }
    return Object.freeze({
      readback: Object.freeze({
        filePath,
        action: receipt.action,
        events: Object.freeze([]),
        latestState: null,
        terminal: null,
        recoveryDisposition: receipt
      }),
      source: null
    });
  }
  const intentSource = observeJournalSource(fs, cutoverIntentPath(fs, actionKey), deadline);
  if (source === null) {
    if (intentSource !== null) fail('cutover intent exists without a canonical target.');
    const legacySource = observeJournalSource(fs, legacyActionPath(fs, actionKey), deadline);
    if (legacySource !== null) {
      fail(
        'legacy Action evidence requires explicit recovery before admission.',
        'recovery-required'
      );
    }
    return Object.freeze({ readback: emptyReadback(filePath), source: null });
  }
  if (intentSource !== null) {
    const intent = parseCutoverIntent(intentSource.text);
    if (intent.phase !== 'complete' || intent.actionKey !== actionKey) {
      fail('cutover is incomplete.');
    }
    const legacySource = observeJournalSource(fs, legacyActionPath(fs, actionKey), deadline);
    if (legacySource === null) {
      fail('cutover source evidence is absent; canonical target is preserved but not authoritative.');
    }
    exactLegacyObservation(legacySource, intent);
    exactTargetObservation(source, intent);
  } else if (observeJournalSource(fs, legacyActionPath(fs, actionKey), deadline) !== null) {
    fail(
      'canonical target conflicts with unmigrated legacy Action evidence.',
      'recovery-required'
    );
  }
  return Object.freeze({
    readback: parseJournalSource(filePath, actionKey, source.text),
    source: source.text
  });
}

export function readVerificationActionJournal(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): VerificationActionJournalReadback {
  return readVerificationActionJournalGeneration(
    fs,
    actionKey,
    performance.now() + JOURNAL_READ_BOUNDS.durationMs
  ).readback;
}

export function appendVerificationActionJournalEvent(input: {
  fs: RuntimeStateJournalFileSystem;
  action: VerificationActionKey;
  state: VerificationActionJournalState;
  recordedAt?: string;
  terminal?: VerificationActionTerminal | null;
  note?: string | null;
}): VerificationActionJournalEvent {
  const action = parseVerificationActionKey(encodeVerificationActionData(input.action));
  const fs = input.fs;
  const filePath = actionPath(fs, action.actionKey);
  // One generation observation owns both admission and the exact CAS preimage.
  const generation = readVerificationActionJournalGeneration(
    fs,
    action.actionKey,
    performance.now() + JOURNAL_READ_BOUNDS.durationMs
  );
  const source = generation.source;
  const current = generation.readback;
  if (current.recoveryDisposition !== null) {
    fail('legacy Action is quarantined; same-ActionKey execution and reuse are forbidden.', 'recovery-required');
  }
  if (current.action !== null && current.action.actionKey !== action.actionKey) {
    fail('embedded action identity changed.');
  }
  const previous = current.events.at(-1) ?? null;
  const state = assertState(input.state);
  assertTransition(previous?.state ?? null, state);
  const terminal = input.terminal === undefined || input.terminal === null
    ? null
    : createVerificationActionTerminal(input.terminal);
  assertTerminalBindsAction(terminal, action.actionKey, 'new event');
  if ((state === 'terminal' || state === 'reused') && terminal === null) {
    fail(`${state} state requires a terminal result.`);
  }
  if (state !== 'terminal' && state !== 'reused' && terminal !== null) {
    fail(`${state} state cannot carry a terminal result.`);
  }
  const withoutDigest = {
    schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
    sequence: (previous?.sequence ?? 0) + 1,
    actionKey: action.actionKey,
    action,
    state,
    recordedAt: assertIsoDate(input.recordedAt ?? new Date().toISOString()),
    terminal,
    note: assertNote(input.note ?? null),
    previousDigest: previous?.eventDigest ?? null
  } satisfies Omit<VerificationActionJournalEvent, 'eventDigest'>;
  const event = Object.freeze({ ...withoutDigest, eventDigest: eventDigest(withoutDigest) });
  fs.ensureDirectory(path.dirname(filePath));
  const expected = source ?? '';
  if (!fs.appendFsyncCas(filePath, expected, `${encodeVerificationActionData(event)}\n`)) {
    fail('changed concurrently; resume from fresh readback.');
  }
  return event;
}

export function deleteVerificationActionJournal(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest
): void {
  const filePath = actionPath(fs, actionKey);
  fs.deleteIfPresent(filePath);
}
