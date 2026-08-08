/**
 * Local append/readback journal for VerificationAction lifecycle facts.
 *
 * The journal is deliberately disposable. It can accelerate resume/reuse, but
 * it is never a verification-result authority and every read validates the
 * complete sequence and digest chain before exposing a projection.
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
  createVerificationActionTerminalV1,
  parseVerificationActionKeyV1,
  type VerificationActionKeyDigest,
  type VerificationActionKeyV1,
  type VerificationActionTerminalV1
} from './verification-action-contract.ts';

export const VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1 =
  'sec-verification-action-journal-event-v1' as const;
export const VERIFICATION_ACTION_JOURNAL_DIRECTORY =
  '.tmp/codex/verification-actions' as const;

export type VerificationActionJournalStateV1 =
  | 'queued'
  | 'running'
  | 'terminal'
  | 'reused'
  | 'invalidated'
  | 'cancelled';

export interface VerificationActionJournalEventV1 {
  schema: typeof VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1;
  sequence: number;
  actionKey: VerificationActionKeyDigest;
  action: VerificationActionKeyV1;
  state: VerificationActionJournalStateV1;
  recordedAt: string;
  terminal: VerificationActionTerminalV1 | null;
  note: string | null;
  previousDigest: VerificationActionKeyDigest | null;
  eventDigest: VerificationActionKeyDigest;
}

export interface VerificationActionJournalReadbackV1 {
  readonly filePath: string;
  readonly action: VerificationActionKeyV1 | null;
  readonly events: readonly VerificationActionJournalEventV1[];
  readonly latestState: VerificationActionJournalStateV1 | null;
  readonly terminal: VerificationActionTerminalV1 | null;
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

function assertState(value: unknown): VerificationActionJournalStateV1 {
  if (![
    'queued', 'running', 'terminal', 'reused', 'invalidated', 'cancelled'
  ].includes(String(value))) {
    fail('state is invalid.');
  }
  return value as VerificationActionJournalStateV1;
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

function eventWithoutDigest(event: Omit<VerificationActionJournalEventV1, 'eventDigest'>): string {
  return JSON.stringify(event);
}

function eventDigest(event: Omit<VerificationActionJournalEventV1, 'eventDigest'>): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(eventWithoutDigest(event)).digest('hex')}`;
}

function actionPath(repositoryRoot: string, actionKey: VerificationActionKeyDigest): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(actionKey)) fail('action key is invalid.');
  return path.join(repositoryRoot, VERIFICATION_ACTION_JOURNAL_DIRECTORY, `${actionKey.slice(7)}.jsonl`);
}

function assertTransition(
  previous: VerificationActionJournalStateV1 | null,
  next: VerificationActionJournalStateV1
): void {
  if (previous === null && next !== 'queued') fail('must begin with queued.');
  if (previous === null) return;
  const allowed: Readonly<Record<VerificationActionJournalStateV1, readonly VerificationActionJournalStateV1[]>> = {
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
  previous: VerificationActionJournalEventV1 | null,
  sequence: number
): VerificationActionJournalEventV1 {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail(`event ${sequence} must be an object.`);
  }
  const value = candidate as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'sequence', 'actionKey', 'action', 'state', 'recordedAt', 'terminal', 'note',
    'previousDigest', 'eventDigest'
  ]);
  if (value.schema !== VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1) {
    fail(`event ${sequence} schema mismatch.`);
  }
  if (value.sequence !== sequence) fail(`event ${sequence} has a non-contiguous sequence.`);
  if (value.actionKey !== expectedActionKey) fail(`event ${sequence} action key mismatch.`);
  const action = parseVerificationActionKeyV1(JSON.stringify(value.action));
  if (action.actionKey !== expectedActionKey) fail(`event ${sequence} embedded action mismatch.`);
  const state = assertState(value.state);
  assertTransition(previous?.state ?? null, state);
  const previousDigest = assertDigest(value.previousDigest, `event ${sequence} previousDigest`);
  if ((previous?.eventDigest ?? null) !== previousDigest) {
    fail(`event ${sequence} previousDigest does not match the chain.`);
  }
  const terminal = value.terminal === null
    ? null
    : createVerificationActionTerminalV1(value.terminal as VerificationActionTerminalV1);
  if ((state === 'terminal' || state === 'reused') && terminal === null) {
    fail(`event ${sequence} ${state} state requires a terminal result.`);
  }
  if (state !== 'terminal' && state !== 'reused' && terminal !== null) {
    fail(`event ${sequence} ${state} state cannot carry a terminal result.`);
  }
  const withoutDigest = {
    schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1,
    sequence,
    actionKey: expectedActionKey,
    action,
    state,
    recordedAt: assertIsoDate(value.recordedAt),
    terminal,
    note: assertNote(value.note),
    previousDigest
  } satisfies Omit<VerificationActionJournalEventV1, 'eventDigest'>;
  if (value.eventDigest !== eventDigest(withoutDigest)) {
    fail(`event ${sequence} digest mismatch.`);
  }
  return Object.freeze({ ...withoutDigest, eventDigest: value.eventDigest as VerificationActionKeyDigest });
}

export function readVerificationActionJournalV1(
  repositoryRoot: string,
  actionKey: VerificationActionKeyDigest
): VerificationActionJournalReadbackV1 {
  const filePath = actionPath(repositoryRoot, actionKey);
  if (!existsSync(filePath)) {
    return Object.freeze({ filePath, action: null, events: [], latestState: null, terminal: null });
  }
  const source = readFileSync(filePath, 'utf8');
  if (source.length === 0 || !source.endsWith('\n')) fail('has a missing or partial final line.');
  const lines = source.slice(0, -1).split('\n');
  const events: VerificationActionJournalEventV1[] = [];
  let previous: VerificationActionJournalEventV1 | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index]!);
    } catch (error) {
      throw new Error(`VerificationAction journal event ${index + 1} is invalid JSON.`, { cause: error });
    }
    const event = validateEvent(parsed, actionKey, previous, index + 1);
    events.push(event);
    previous = event;
  }
  const latest = events.at(-1) ?? null;
  // A terminal fact remains in the append-only history for auditability, but
  // invalidation/cancellation removes it from the current projection. This
  // prevents stale PASS/FAIL observations from being mistaken for reusable
  // terminal state after the declared closure changed.
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

export function appendVerificationActionJournalEventV1(input: {
  repositoryRoot: string;
  action: VerificationActionKeyV1;
  state: VerificationActionJournalStateV1;
  recordedAt?: string;
  terminal?: VerificationActionTerminalV1 | null;
  note?: string | null;
}): VerificationActionJournalEventV1 {
  const action = parseVerificationActionKeyV1(JSON.stringify(input.action));
  const current = readVerificationActionJournalV1(input.repositoryRoot, action.actionKey);
  if (current.action !== null && current.action.actionKey !== action.actionKey) {
    fail('embedded action identity changed.');
  }
  const previous = current.events.at(-1) ?? null;
  const state = assertState(input.state);
  assertTransition(previous?.state ?? null, state);
  const terminal = input.terminal === undefined || input.terminal === null
    ? null
    : createVerificationActionTerminalV1(input.terminal);
  if ((state === 'terminal' || state === 'reused') && terminal === null) {
    fail(`${state} state requires a terminal result.`);
  }
  if (state !== 'terminal' && state !== 'reused' && terminal !== null) {
    fail(`${state} state cannot carry a terminal result.`);
  }
  const withoutDigest = {
    schema: VERIFICATION_ACTION_JOURNAL_EVENT_SCHEMA_V1,
    sequence: current.events.length + 1,
    actionKey: action.actionKey,
    action,
    state,
    recordedAt: assertIsoDate(input.recordedAt ?? new Date().toISOString()),
    terminal,
    note: assertNote(input.note ?? null),
    previousDigest: previous?.eventDigest ?? null
  } satisfies Omit<VerificationActionJournalEventV1, 'eventDigest'>;
  const event = Object.freeze({ ...withoutDigest, eventDigest: eventDigest(withoutDigest) });
  const filePath = actionPath(input.repositoryRoot, action.actionKey);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = openSync(filePath, 'a');
  try {
    appendFileSync(handle, `${JSON.stringify(event)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  return event;
}

export function deleteVerificationActionJournalV1(
  repositoryRoot: string,
  actionKey: VerificationActionKeyDigest
): void {
  const filePath = actionPath(repositoryRoot, actionKey);
  if (existsSync(filePath)) unlinkSync(filePath);
}
