/**
 * Durable local append/readback journal for diagnostic-bound VerificationAction facts.
 *
 * Runtime bytes live in the canonical SEC workspace-state root, never in the
 * repository tree. The old V2 grammar is retained only as migration/recovery
 * evidence. Normal reads and writes accept exactly the diagnostic-bound grammar.
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

import type {
  RuntimeStateJournalFileSystem,
  RuntimeStateJournalRetainedText
} from '../../runtime-state/workspace-state/journal-filesystem.ts';
import { parseExactJson } from '../../system-architecture/foundation/runtime/exact-json.ts';
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
export const VERIFICATION_ACTION_CLAIM_SCHEMA =
  'sec-verification-action-terminal-bound-claim' as const;

const LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA =
  'sec-verification-action-journal-event-v2' as const;
const LEGACY_VERIFICATION_ACTION_JOURNAL_DIRECTORY =
  'verification-actions/v2' as const;
const VERIFICATION_ACTION_JOURNAL_CUTOVER_INTENT_SCHEMA =
  'sec-verification-action-journal-cutover-intent' as const;
const JOURNAL_READ_BOUNDS = Object.freeze({
  maximumBytes: 16 * 1024 * 1024,
  maximumEvents: 4096,
  durationMs: 30_000
});
const JOURNAL_EVENT_KEYS = Object.freeze([
  'schema', 'sequence', 'actionKey', 'action', 'state', 'recordedAt', 'terminal', 'note',
  'previousDigest', 'eventDigest'
]);
const CLAIM_KEYS = Object.freeze([
  'schema', 'actionKey', 'ownerToken', 'acquiredAt', 'expiresAt'
]);
const CUTOVER_INTENT_KEYS = Object.freeze([
  'schema', 'phase', 'actionKey', 'sourcePhysical', 'sourceLedgerDigest', 'sourceByteLength',
  'targetPhysical', 'targetLedgerDigest', 'targetByteLength', 'eventCount', 'intentDigest'
]);

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

export type VerificationActionLegacyRecoveryDisposition =
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

export function writeVerificationActionStartMarkerV2Atomic(
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

export function writeVerificationActionTerminalStatusAnchorV2Atomic(
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

export type VerificationActionClaimDisposition =
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
  return `sha256:${createHash('sha256').update(eventWithoutDigest(event)).digest('hex')}`;
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

function sha256(source: string | Buffer): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
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
  exactKeys(value, JOURNAL_EVENT_KEYS);
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
  readonly action: VerificationActionKey;
  readonly state: VerificationActionJournalState;
  readonly recordedAt: string;
  readonly terminal: VerificationActionTerminal | null;
  readonly terminalMigratable: boolean;
  readonly note: string | null;
  readonly previousDigest: VerificationActionKeyDigest | null;
  readonly eventDigest: VerificationActionKeyDigest;
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
    exactKeys(value, ['status', 'reasonCode', 'resultDigest']);
    if (!['passed', 'failed', 'not-run'].includes(String(value.status))) {
      fail('legacy terminal status is invalid.');
    }
    const reasonCode = String(value.reasonCode);
    if (reasonCode.length === 0 || reasonCode.length > 128 || /[\u0000-\u001f]/u.test(reasonCode)) {
      fail('legacy terminal reasonCode is invalid.');
    }
    const resultDigest = assertDigest(value.resultDigest, 'legacy terminal resultDigest');
    if (resultDigest === null) fail('legacy terminal resultDigest is required.');
    return Object.freeze({
      terminal: null,
      canonicalForDigest: Object.freeze({
        status: value.status,
        reasonCode,
        resultDigest
      }),
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
  exactKeys(value, JOURNAL_EVENT_KEYS);
  if (value.schema !== LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA) {
    fail(`legacy event ${sequence} schema mismatch.`);
  }
  if (value.sequence !== sequence || value.actionKey !== expectedActionKey) {
    fail(`legacy event ${sequence} identity mismatch.`);
  }
  const action = parseVerificationActionKey(encodeVerificationActionData(value.action));
  if (action.actionKey !== expectedActionKey) fail(`legacy event ${sequence} embedded action mismatch.`);
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
  const canonicalForDigest = {
    schema: LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
    sequence,
    actionKey: expectedActionKey,
    action,
    state,
    recordedAt,
    terminal: parsedTerminal.canonicalForDigest,
    note,
    previousDigest
  };
  if (value.eventDigest !== sha256(encodeVerificationActionData(canonicalForDigest))) {
    fail(`legacy event ${sequence} digest mismatch.`);
  }
  return Object.freeze({
    sequence,
    actionKey: expectedActionKey,
    action,
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
      `VerificationAction legacy journal event ${index + 1}`,
      { rootObjectKeys: JOURNAL_EVENT_KEYS }
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
    terminal: null
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
    terminal
  });
}

function readVerificationActionJournalGeneration(
  fs: RuntimeStateJournalFileSystem,
  actionKey: VerificationActionKeyDigest,
  deadline: number
): Readonly<{ readback: VerificationActionJournalReadback; source: string | null }> {
  const filePath = actionPath(fs, actionKey);
  const source = observeJournalSource(fs, filePath, deadline);
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
