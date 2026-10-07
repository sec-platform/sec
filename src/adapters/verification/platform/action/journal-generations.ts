/**
 * One Action's retained journal generation and legacy recovery.
 * Source, intent, target and quarantine observations stay together so current
 * admission and the append CAS preimage are derived from one observation.
 */

import path from 'node:path';
import {
  parseExactJson
} from '../../../../contracts/exact-json.ts';
import type { VerificationActionKey, VerificationActionKeyDigest } from '../../../../execution/verification/action.ts';
import {
  type RuntimeStateJournalFileSystem,
  type RuntimeStateJournalRetainedText
} from '../../../runtime-state/workspace-state/journal-filesystem.ts';
import { createVerificationActionTerminal, encodeVerificationActionData, parseVerificationActionKey, type VerificationActionTerminal } from './contract/action.ts';
import {
  actionPath,
  assertDigest,
  assertIsoDate,
  assertNonnegativeSafeInteger,
  assertNote,
  assertState,
  assertTerminalBindsAction,
  assertTransition,
  emptyReadback,
  eventDigest,
  exactKeys,
  fail,
  JOURNAL_EVENT_KEYS,
  JOURNAL_READ_BOUNDS,
  normalizeInventoryPath,
  parseCanonicalJournalDocument,
  parseJournalSource,
  samePhysical,
  sha256,
  VERIFICATION_ACTION_JOURNAL_DIRECTORY,
  VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA,
  VERIFICATION_ACTION_LEGACY_QUARANTINE_SCHEMA,
  type VerificationActionJournalEvent,
  type VerificationActionJournalReadback,
  type VerificationActionJournalState,
  type VerificationActionLegacyQuarantineEvidence,
  type VerificationActionLegacyQuarantineReceipt
} from './journal-records.ts';

const LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA =
  'sec-verification-action-journal-event-v2' as const;

const LEGACY_VERIFICATION_ACTION_JOURNAL_DIRECTORY =
  'verification-actions/v2' as const;

const VERIFICATION_ACTION_JOURNAL_CUTOVER_INTENT_SCHEMA =
  'sec-verification-action-journal-cutover-intent' as const;

export const VERIFICATION_ACTION_LEGACY_QUARANTINE_SUFFIX =
  '.legacy-quarantine.json' as const;

const RETIRED_LEGACY_JOURNAL_EVENT_KEYS = Object.freeze([
  ...JOURNAL_EVENT_KEYS,
  'executionBindingDigest'
]);

const CUTOVER_INTENT_KEYS = Object.freeze([
  'schema', 'phase', 'actionKey', 'sourcePhysical', 'sourceLedgerDigest', 'sourceByteLength',
  'targetPhysical', 'targetLedgerDigest', 'targetByteLength', 'eventCount', 'intentDigest'
]);

const LEGACY_QUARANTINE_KEYS = Object.freeze([
  'schema', 'actionKey', 'action', 'classification', 'sourceEvidence',
  'reuseDisposition', 'executionDisposition', 'legacyEvidenceDisposition', 'receiptDigest'
]);

const LEGACY_QUARANTINE_EVIDENCE_KEYS = Object.freeze([
  'path', 'physical', 'ledgerDigest', 'byteLength'
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

export function legacyQuarantinePath(
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

export function observeJournalSource(
  fs: RuntimeStateJournalFileSystem,
  filePath: string,
  deadlineAtMonotonicMs: number
): RuntimeStateJournalRetainedText | null {
  return fs.observeTextRetained(filePath, {
    deadlineAtMonotonicMs,
    maximumBytes: JOURNAL_READ_BOUNDS.maximumBytes
  });
}

function quarantineReceiptDigest(
  input: Omit<VerificationActionLegacyQuarantineReceipt, 'receiptDigest'>
): VerificationActionKeyDigest {
  return sha256(encodeVerificationActionData(input));
}

export function canonicalQuarantineEvidence(
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

export function canonicalLegacyQuarantineReceipt(input: Readonly<{
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

export function parseLegacyQuarantineReceipt(
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

export function assertQuarantineDominatesRetainedJournal(
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

export function parseLegacyJournalSource(
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

export function parseCutoverIntent(source: string): VerificationActionJournalCutoverIntent {
  const candidate = parseCanonicalJournalDocument(
    source,
    'VerificationAction journal cutover intent',
    CUTOVER_INTENT_KEYS
  );
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('cutover intent must be an object.');
  }
  const value = candidate as Record<string, unknown>;
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

export function migratedJournalSource(
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

export function exactLegacyObservation(
  input: RuntimeStateJournalRetainedText,
  intent: VerificationActionJournalCutoverIntent
): void {
  if (!samePhysical(input.physical, intent.sourcePhysical)
      || input.byteLength !== intent.sourceByteLength
      || sha256(input.text) !== intent.sourceLedgerDigest) {
    fail('legacy source changed after cutover admission.');
  }
}

export function exactTargetObservation(
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

export function parseRetiredCanonicalJournalForQuarantine(
  actionKey: VerificationActionKeyDigest,
  source: string
): VerificationActionKey {
  if (!source.endsWith('\n')) fail('retired canonical evidence has a partial final line.');
  let previous: VerificationActionKeyDigest | null = null;
  let action: VerificationActionKey | null = null;
  let retired = false;
  for (const [index, line] of source.slice(0, -1).split('\n').entries()) {
    const value = parseExactJson(line, `retired canonical event ${index + 1}`, { rootObjectKeys: JOURNAL_EVENT_KEYS }) as Record<string, unknown>;
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

export function readVerificationActionJournalGeneration(
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
