/**
 * Current VerificationAction claim, append and settlement lifecycle.
 * Retained-generation recovery and machine cutover keep their original public
 * entry here while their implementations depend only on shared record values.
 */

import {
  randomUUID
} from 'node:crypto';
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
import type { VerificationActionKey, VerificationActionKeyDigest } from '../../../../execution/verification/action.ts';
import {
  type RuntimeStateJournalFileSystem
} from '../../../runtime-state/workspace-state/journal-filesystem.ts';
import { createVerificationActionTerminal, encodeVerificationActionData, parseVerificationActionKey, type VerificationActionTerminal } from './contract/action.ts';
import {
  parseVerificationActionProviderStartMarker,
  parseVerificationActionProviderTerminalAnchor,
  VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE,
  type VerificationActionProviderStartMarker,
  type VerificationActionProviderTerminalAnchor
} from './contract/provider.ts';
import {
  readVerificationActionJournalGeneration
} from './journal-generations.ts';
import {
  actionPath,
  assertIsoDate,
  assertNote,
  assertState,
  assertTerminalBindsAction,
  assertTransition,
  eventDigest,
  fail,
  JOURNAL_READ_BOUNDS,
  newClaim,
  ownerToken,
  parseClaim,
  VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
  type VerificationActionClaim,
  type VerificationActionJournalEvent,
  type VerificationActionJournalReadback,
  type VerificationActionJournalState
} from './journal-records.ts';

export {
  VERIFICATION_ACTION_JOURNAL_DIRECTORY, VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA, VerificationActionJournalError
} from './journal-records.ts';

export type {
  VerificationActionClaim, VerificationActionJournalEvent, VerificationActionJournalFailureKind, VerificationActionJournalReadback, VerificationActionJournalState
} from './journal-records.ts';

export {
  inspectLegacyVerificationActionJournalForRecovery,
  migrateLegacyVerificationActionJournalForRecovery, VERIFICATION_ACTION_LEGACY_QUARANTINE_SUFFIX
} from './journal-generations.ts';

export type {
  VerificationActionLegacyRecoveryObservation
} from './journal-generations.ts';

export {
  ensureVerificationActionMachineGlobalCutover, VERIFICATION_ACTION_MACHINE_CUTOVER_FILE
} from './journal-machine-cutover.ts';

export function writeVerificationActionProviderStartMarkerAtomic(
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

export function writeVerificationActionProviderTerminalAnchorAtomic(
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

function writeExclusiveClaim(
  filePath: string,
  claim: VerificationActionClaim,
  fs: RuntimeStateJournalFileSystem
): boolean {
  return fs.createExclusiveFsync(filePath, `${encodeVerificationActionData(claim)}\n`);
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
