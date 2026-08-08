/**
 * Local append/readback journal for VerificationAction V2 lifecycle facts.
 *
 * The journal is disposable. V1 records live in a different namespace and
 * cannot be projected into V2; a stale V1 file in the V2 namespace is reported
 * as stale and removed only when the next V2 append starts a clean sequence.
 */

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync
} from 'node:fs';
import path from 'node:path';

import {
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  parseVerificationActionKeyV2,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV2,
  type VerificationActionTerminalV2
} from './verification-action-contract.ts';

export const VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V2 =
  'sec-verification-action-journal-event-v2' as const;
const LEGACY_VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1 =
  'sec-verification-action-journal-event-v1' as const;
export const VERIFICATION_ACTION_JOURNAL_DIRECTORY_V2 =
  '.tmp/codex/verification-actions/v2' as const;

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

function assertTransition(
  previous: VerificationActionJournalStateV2 | null,
  next: VerificationActionJournalStateV2
): void {
  if (previous === null && next !== 'queued') fail('must begin with queued.');
  if (previous === null) return;
  const allowed: Readonly<Record<VerificationActionJournalStateV2, readonly VerificationActionJournalStateV2[]>> = {
    queued: ['running', 'invalidated', 'cancelled'],
    running: ['terminal', 'invalidated', 'cancelled'],
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
