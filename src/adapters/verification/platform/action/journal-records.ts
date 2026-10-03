/**
 * Pure VerificationAction journal records, encoding and validation.
 * File-system effects and current ownership stay with the journal lifecycle;
 * historical generation admission consumes this same current record grammar.
 */

import {
  createHash
} from 'node:crypto';
import path from 'node:path';
import {
  parseExactJson
} from '../../../../contracts/exact-json.ts';
import {
  type RuntimeStateJournalFileSystem
} from '../../../runtime-state/workspace-state/journal-filesystem.ts';
import {
  createVerificationActionTerminal,
  encodeVerificationActionData,
  parseVerificationActionKey,
  type VerificationActionKey,
  type VerificationActionKeyDigest,
  type VerificationActionTerminal
} from './contract/action.ts';

export const VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA =
  'sec-verification-action-terminal-bound-journal-event' as const;

export const VERIFICATION_ACTION_JOURNAL_DIRECTORY =
  'verification-actions/terminal-bound' as const;

export const VERIFICATION_ACTION_CLAIM_SCHEMA =
  'sec-verification-action-terminal-bound-claim' as const;

export const VERIFICATION_ACTION_LEGACY_QUARANTINE_SCHEMA =
  'sec-verification-action-legacy-terminal-quarantine' as const;

export const JOURNAL_READ_BOUNDS = Object.freeze({
  maximumBytes: 16 * 1024 * 1024,
  maximumEvents: 4096,
  durationMs: 30_000
});

export const JOURNAL_EVENT_KEYS = Object.freeze([
  'schema', 'sequence', 'actionKey', 'action', 'state', 'recordedAt', 'terminal', 'note',
  'previousDigest', 'eventDigest'
]);

export const CLAIM_KEYS = Object.freeze([
  'schema', 'actionKey', 'ownerToken', 'acquiredAt', 'expiresAt'
]);

export interface VerificationActionLegacyQuarantineEvidence {
  readonly path: string;
  readonly physical: Readonly<{ device: string; inode: string }>;
  readonly ledgerDigest: VerificationActionKeyDigest;
  readonly byteLength: number;
}

export interface VerificationActionLegacyQuarantineReceipt {
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

export interface VerificationActionClaim {
  readonly schema: typeof VERIFICATION_ACTION_CLAIM_SCHEMA;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
  readonly acquiredAt: string;
  readonly expiresAt: string;
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

export function fail(
  message: string,
  kind: VerificationActionJournalFailureKind = 'corrupt-journal'
): never {
  throw new VerificationActionJournalError(kind, message);
}

export function assertIsoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    fail('recordedAt must be an ISO-8601 UTC timestamp.');
  }
  return value;
}

export function assertNote(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 1024
      || Buffer.byteLength(value, 'utf8') > 1024
      || /[\u0000-\u001f]/u.test(value)) {
    fail('note must be null or bounded text.');
  }
  return value;
}

export function assertState(value: unknown): VerificationActionJournalState {
  if (![
    'queued', 'running', 'terminal', 'reused', 'invalidated', 'cancelled'
  ].includes(String(value))) {
    fail('state is invalid.');
  }
  return value as VerificationActionJournalState;
}

export function assertDigest(value: unknown, label: string): VerificationActionKeyDigest | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be null or a SHA-256 digest.`);
  }
  return value as VerificationActionKeyDigest;
}

export function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`event must contain exactly: ${wanted.join(', ')}.`);
  }
}

function eventWithoutDigest(event: Omit<VerificationActionJournalEvent, 'eventDigest'>): string {
  return encodeVerificationActionData(event);
}

export function eventDigest(
  event: Omit<VerificationActionJournalEvent, 'eventDigest'>
): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(eventWithoutDigest(event)).digest('hex')}`;
}

export function actionPath(
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

export function sha256(source: string | Buffer): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

export function samePhysical(
  left: Readonly<{ device: string; inode: string }>,
  right: Readonly<{ device: string; inode: string }>
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export function ownerToken(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\u0000-\u001f]/u.test(value)) {
    fail('claim ownerToken must be bounded text.');
  }
  return value;
}

export function parseClaim(source: string, expectedActionKey: VerificationActionKeyDigest): VerificationActionClaim {
  const value = parseCanonicalJournalDocument(source, 'VerificationAction claim', CLAIM_KEYS);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('claim must be an object.');
  const claim = value as Record<string, unknown>;
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

export function parseCanonicalJournalDocument(
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

export function newClaim(
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

export function assertTransition(
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

export function assertTerminalBindsAction(
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

export function emptyReadback(filePath: string): VerificationActionJournalReadback {
  return Object.freeze({
    filePath,
    action: null,
    events: Object.freeze([]),
    latestState: null,
    terminal: null,
    recoveryDisposition: null
  });
}

export function parseJournalSource(
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

export function assertNonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${label} is invalid.`);
  return Number(value);
}

export function normalizeInventoryPath(value: string): string {
  return value.replaceAll('\\', '/');
}
