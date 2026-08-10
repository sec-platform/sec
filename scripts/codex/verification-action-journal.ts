/**
 * Local append/readback journal for VerificationAction V2 lifecycle facts.
 *
 * The journal is disposable. V1 records live in a different namespace and
 * cannot be projected into V2; a stale V1 file in the V2 namespace is reported
 * as stale and removed only when the next V2 append starts a clean sequence.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import {
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  parseVerificationActionKeyV2,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV2,
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

export const VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V2 =
  'sec-verification-action-journal-event-v2' as const;
const LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1 =
  'sec-verification-action-journal-event-v1' as const;
export const VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2 =
  '.tmp/codex/verification-actions/v2' as const;
export const VERIFICATION_ACTION_CLAIM_SCHEMA_V1 =
  'sec-verification-action-claim-v1' as const;

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

function actionPath(repositoryRoot: string, actionKey: VerificationActionKeyDigest): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('action key is invalid.');
  return path.join(
    repositoryRoot,
    VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2,
    `${actionKey.slice(7)}.jsonl`
  );
}

function claimPath(repositoryRoot: string, actionKey: VerificationActionKeyDigest): string {
  return `${actionPath(repositoryRoot, actionKey)}.claim.json`;
}

function recoveryLockPath(repositoryRoot: string, actionKey: VerificationActionKeyDigest): string {
  return `${actionPath(repositoryRoot, actionKey)}.claim-recovery.lock`;
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

function writeExclusiveClaim(filePath: string, claim: VerificationActionClaimV1): boolean {
  let handle: number;
  try {
    handle = openSync(filePath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeFileSync(handle, `${encodeVerificationActionDataV2(claim)}\n`);
    fsyncSync(handle);
  } finally { closeSync(handle); }
  return true;
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
  repositoryRoot: string,
  actionKey: VerificationActionKeyDigest,
  operation: () => T
): T | null {
  const filePath = recoveryLockPath(repositoryRoot, actionKey);
  let handle: number;
  try { handle = openSync(filePath, 'wx'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw error;
  }
  closeSync(handle);
  try { return operation(); } finally { rmSync(filePath, { force: true }); }
}

export function readVerificationActionClaimV1(
  repositoryRoot: string,
  actionKey: VerificationActionKeyDigest
): VerificationActionClaimV1 | null {
  const filePath = claimPath(repositoryRoot, actionKey);
  if (!existsSync(filePath)) return null;
  return parseClaim(readFileSync(filePath, 'utf8'), actionKey);
}

export function acquireVerificationActionClaimV1(input: {
  readonly repositoryRoot: string;
  readonly action: VerificationActionKeyV2;
  readonly ownerToken: string;
  readonly now: string;
  readonly leaseDurationMs?: number;
}): VerificationActionClaimOutcomeV1 {
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(input.action));
  const journal = readVerificationActionJournalV2(input.repositoryRoot, action.actionKey);
  if ((journal.latestState === 'terminal' || journal.latestState === 'reused') && journal.terminal !== null) {
    return Object.freeze({ disposition: 'terminal', claim: null, terminal: journal.terminal, reason: null });
  }
  const lease = newClaim(action.actionKey, input.ownerToken, input.now, input.leaseDurationMs ?? 300_000);
  mkdirSync(path.dirname(claimPath(input.repositoryRoot, action.actionKey)), { recursive: true });
  if (journal.latestState === 'queued' || journal.latestState === 'running') {
    return Object.freeze({
      disposition: 'blocked',
      claim: null,
      terminal: null,
      reason: `persisted ${journal.latestState} Action has no provable terminal; a new Action identity is required`
    });
  }
  if (writeExclusiveClaim(claimPath(input.repositoryRoot, action.actionKey), lease)) {
    return Object.freeze({ disposition: 'acquired', claim: lease, terminal: null, reason: null });
  }
  let existing: VerificationActionClaimV1;
  try { existing = readVerificationActionClaimV1(input.repositoryRoot, action.actionKey)!; } catch {
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

export function releaseVerificationActionClaimV1(input: {
  readonly repositoryRoot: string;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
}): boolean {
  const released = withRecoveryLock(input.repositoryRoot, input.actionKey, () => {
    const existing = readVerificationActionClaimV1(input.repositoryRoot, input.actionKey);
    if (existing === null) return false;
    if (existing.ownerToken !== ownerToken(input.ownerToken)) fail('claim release owner mismatch.');
    unlinkSync(claimPath(input.repositoryRoot, input.actionKey));
    return true;
  });
  return released ?? false;
}

export function renewVerificationActionClaimV1(input: {
  readonly repositoryRoot: string;
  readonly actionKey: VerificationActionKeyDigest;
  readonly ownerToken: string;
  readonly now: string;
  readonly leaseDurationMs: number;
}): boolean {
  const renewed = withRecoveryLock(input.repositoryRoot, input.actionKey, () => {
    const existing = readVerificationActionClaimV1(input.repositoryRoot, input.actionKey);
    const now = assertIsoDate(input.now);
    if (existing === null || existing.ownerToken !== ownerToken(input.ownerToken) || existing.expiresAt <= now) return false;
    const extension = newClaim(input.actionKey, input.ownerToken, now, input.leaseDurationMs);
    const replacement = Object.freeze({ ...extension, acquiredAt: existing.acquiredAt });
    const filePath = claimPath(input.repositoryRoot, input.actionKey);
    const handle = openSync(filePath, 'w');
    try {
      writeFileSync(handle, `${encodeVerificationActionDataV2(replacement)}\n`);
      fsyncSync(handle);
    } finally { closeSync(handle); }
    return true;
  });
  return renewed ?? false;
}

export function commitVerificationActionTerminalUnderClaimV1(input: {
  readonly repositoryRoot: string;
  readonly action: VerificationActionKeyV2;
  readonly ownerToken: string;
  readonly now: string;
  readonly recordedAt?: string;
  readonly terminal: VerificationActionTerminalV2;
  readonly note?: string | null;
}): VerificationActionJournalEventV2 | null {
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(input.action));
  return withRecoveryLock(input.repositoryRoot, action.actionKey, () => {
    const existing = readVerificationActionClaimV1(input.repositoryRoot, action.actionKey);
    const now = assertIsoDate(input.now);
    if (existing === null || existing.ownerToken !== ownerToken(input.ownerToken) || existing.expiresAt <= now) return null;
    const event = appendVerificationActionJournalEventV2({
      repositoryRoot: input.repositoryRoot,
      action,
      state: 'terminal',
      recordedAt: input.recordedAt,
      terminal: input.terminal,
      note: input.note
    });
    unlinkSync(claimPath(input.repositoryRoot, action.actionKey));
    return event;
  });
}

export function revokeVerificationActionClaimV1(input: {
  readonly repositoryRoot: string;
  readonly action: VerificationActionKeyV2;
  readonly state: 'invalidated' | 'cancelled';
  readonly recordedAt?: string;
  readonly note: string;
}): VerificationActionJournalReadbackV2 {
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(input.action));
  const revoked = withRecoveryLock(input.repositoryRoot, action.actionKey, () => {
    const current = readVerificationActionJournalV2(input.repositoryRoot, action.actionKey);
    if (current.latestState === null || current.latestState === 'invalidated' || current.latestState === 'cancelled') return current;
    appendVerificationActionJournalEventV2({
      repositoryRoot: input.repositoryRoot,
      action,
      state: input.state,
      recordedAt: input.recordedAt,
      terminal: null,
      note: input.note
    });
    const activeClaimPath = claimPath(input.repositoryRoot, action.actionKey);
    if (existsSync(activeClaimPath)) unlinkSync(activeClaimPath);
    return readVerificationActionJournalV2(input.repositoryRoot, action.actionKey);
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
    terminal: null
  });
}

export function readVerificationActionJournalV2(
  repositoryRoot: string,
  actionKey: VerificationActionKeyDigest
): VerificationActionJournalReadbackV2 {
  const filePath = actionPath(repositoryRoot, actionKey);
  if (!existsSync(filePath)) return emptyReadback(filePath);
  const source = readFileSync(filePath, 'utf8');
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

export function appendVerificationActionJournalEventV2(input: {
  repositoryRoot: string;
  action: VerificationActionKeyV2;
  state: VerificationActionJournalStateV2;
  recordedAt?: string;
  terminal?: VerificationActionTerminalV2 | null;
  note?: string | null;
}): VerificationActionJournalEventV2 {
  const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(input.action));
  const current = readVerificationActionJournalV2(input.repositoryRoot, action.actionKey);
  if (current.schemaState === 'stale' && existsSync(current.filePath)) unlinkSync(current.filePath);
  if (current.action !== null && current.action.actionKey !== action.actionKey) {
    fail('embedded action identity changed.');
  }
  const previous = current.schemaState === 'stale' ? null : current.events.at(-1) ?? null;
  const state = assertState(input.state);
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
  const withoutDigest = {
    schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V2,
    sequence: (previous?.sequence ?? 0) + 1,
    actionKey: action.actionKey,
    action,
    state,
    recordedAt: assertIsoDate(input.recordedAt ?? new Date().toISOString()),
    terminal,
    note: assertNote(input.note ?? null),
    previousDigest: previous?.eventDigest ?? null
  } satisfies Omit<VerificationActionJournalEventV2, 'eventDigest'>;
  const event = Object.freeze({ ...withoutDigest, eventDigest: eventDigest(withoutDigest) });
  const filePath = actionPath(input.repositoryRoot, action.actionKey);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = openSync(filePath, 'a');
  try {
    appendFileSync(handle, `${encodeVerificationActionDataV2(event)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  return event;
}

export function deleteVerificationActionJournalV2(
  repositoryRoot: string,
  actionKey: VerificationActionKeyDigest
): void {
  const filePath = actionPath(repositoryRoot, actionKey);
  if (existsSync(filePath)) unlinkSync(filePath);
}
