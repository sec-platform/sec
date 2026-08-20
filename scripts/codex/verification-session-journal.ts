/**
 * Durable, disposable run journal for VerificationSession V2.
 *
 * Journal entries are operational recovery facts, never verification Evidence.
 * Durable bytes live in the canonical SEC runtime-state root, never in the
 * repository tree. A side-effect claim is permanent: after an ambiguous crash
 * the operator must reconcile the external observation instead of repeating the mutation.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

export const VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA_V1 =
  'sec-verification-session-journal-event-v1' as const;
export const VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA_V1 =
  'sec-verification-session-operation-claim-v1' as const;
export const VERIFICATION_SESSION_JOURNAL_DIRECTORY =
  'verification-sessions/v2' as const;

export const VERIFICATION_SESSION_STAGES = [
  'frozen',
  'actions-terminal',
  'pre-gate-review-clear',
  'hosted-verification-terminal',
  'pre-merge-review-clear',
  'authorized',
  'merge-attempted',
  'merge-readback',
  'tree-parity',
  'closeout-terminal'
] as const;

export type VerificationSessionStage = typeof VERIFICATION_SESSION_STAGES[number];
export type VerificationSessionJournalEventKind =
  | 'completed'
  | 'waiting'
  | 'failed'
  | 'observation';

export interface VerificationSessionJournalEventV1 {
  schema: typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA_V1;
  sequence: number;
  sessionRevision: `sha256:${string}`;
  targetStage: VerificationSessionStage;
  kind: VerificationSessionJournalEventKind;
  operationId: `sha256:${string}` | null;
  receiptDigest: `sha256:${string}` | null;
  recordedAt: string;
  note: string | null;
  previousDigest: `sha256:${string}` | null;
  eventDigest: `sha256:${string}`;
}

export interface VerificationSessionOperationClaimV1 {
  schema: typeof VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA_V1;
  sessionRevision: `sha256:${string}`;
  operationId: `sha256:${string}`;
  operationKind: string;
  claimedAt: string;
  claimDigest: `sha256:${string}`;
}

export interface VerificationSessionJournalReadbackV1 {
  filePath: string;
  events: readonly VerificationSessionJournalEventV1[];
  completedStage: VerificationSessionStage | null;
  completedStageIndex: number;
  latestEvent: VerificationSessionJournalEventV1 | null;
}

export interface VerificationSessionJournalFileSystem {
  readonly rootPath: string;
  exists(filePath: string): boolean;
  readText(filePath: string): string;
  ensureDirectory(directoryPath: string): void;
  appendFsyncCas(filePath: string, expectedText: string, text: string): boolean;
  createExclusiveFsync(filePath: string, text: string): boolean;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function assertDigest(value: unknown, label: string): `sha256:${string}` | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be null or a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function assertIso(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  return value;
}

function assertNote(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new Error('Session journal note must be null or bounded text.');
  }
  return value;
}

function assertStage(value: unknown): VerificationSessionStage {
  if (typeof value !== 'string' || !VERIFICATION_SESSION_STAGES.includes(value as VerificationSessionStage)) {
    throw new Error('Session journal targetStage is invalid.');
  }
  return value as VerificationSessionStage;
}

function assertKind(value: unknown): VerificationSessionJournalEventKind {
  if (value !== 'completed' && value !== 'waiting' && value !== 'failed' && value !== 'observation') {
    throw new Error('Session journal event kind is invalid.');
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function sessionPath(
  fs: VerificationSessionJournalFileSystem,
  sessionRevision: `sha256:${string}`
): string {
  assertDigest(sessionRevision, 'sessionRevision');
  return path.join(
    fs.rootPath,
    VERIFICATION_SESSION_JOURNAL_DIRECTORY,
    sessionRevision.slice(7),
    'journal.jsonl'
  );
}

function claimPath(
  fs: VerificationSessionJournalFileSystem,
  sessionRevision: `sha256:${string}`,
  operationId: `sha256:${string}`
): string {
  assertDigest(operationId, 'operationId');
  return path.join(
    path.dirname(sessionPath(fs, sessionRevision)),
    'claims',
    `${operationId.slice(7)}.json`
  );
}

function parseEvent(
  candidate: unknown,
  sessionRevision: `sha256:${string}`,
  sequence: number,
  previous: VerificationSessionJournalEventV1 | null,
  completedStageIndex: number
): VerificationSessionJournalEventV1 {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`Session journal event ${sequence} must be an object.`);
  }
  const value = candidate as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'sequence', 'sessionRevision', 'targetStage', 'kind', 'operationId',
    'receiptDigest', 'recordedAt', 'note', 'previousDigest', 'eventDigest'
  ], `Session journal event ${sequence}`);
  if (value.schema !== VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA_V1) {
    throw new Error(`Session journal event ${sequence} schema mismatch.`);
  }
  if (value.sequence !== sequence) throw new Error(`Session journal event ${sequence} sequence mismatch.`);
  if (value.sessionRevision !== sessionRevision) throw new Error(`Session journal event ${sequence} session mismatch.`);
  const targetStage = assertStage(value.targetStage);
  const targetIndex = VERIFICATION_SESSION_STAGES.indexOf(targetStage);
  const kind = assertKind(value.kind);
  if (targetIndex > completedStageIndex + 1) throw new Error(`Session journal event ${sequence} skips a required stage.`);
  if (kind === 'completed' && targetIndex !== completedStageIndex + 1) {
    throw new Error(`Session journal event ${sequence} cannot complete an old or non-adjacent stage.`);
  }
  if (kind !== 'completed' && targetIndex < Math.max(0, completedStageIndex)) {
    throw new Error(`Session journal event ${sequence} targets a superseded stage.`);
  }
  const previousDigest = assertDigest(value.previousDigest, `event ${sequence} previousDigest`);
  if (previousDigest !== (previous?.eventDigest ?? null)) {
    throw new Error(`Session journal event ${sequence} previousDigest mismatch.`);
  }
  const withoutDigest = {
    schema: VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA_V1,
    sequence,
    sessionRevision,
    targetStage,
    kind,
    operationId: assertDigest(value.operationId, `event ${sequence} operationId`),
    receiptDigest: assertDigest(value.receiptDigest, `event ${sequence} receiptDigest`),
    recordedAt: assertIso(value.recordedAt, `event ${sequence} recordedAt`),
    note: assertNote(value.note),
    previousDigest
  } satisfies Omit<VerificationSessionJournalEventV1, 'eventDigest'>;
  const expectedDigest = digest(withoutDigest);
  if (value.eventDigest !== expectedDigest) throw new Error(`Session journal event ${sequence} digest mismatch.`);
  return Object.freeze({ ...withoutDigest, eventDigest: expectedDigest });
}

export function createEphemeralVerificationSessionJournalFsV1(
  rootPath: string
): VerificationSessionJournalFileSystem {
  const files = new Map<string, string>();
  return Object.freeze({
    rootPath: path.resolve(rootPath),
    exists: (filePath: string) => files.has(filePath),
    readText(filePath: string): string {
      const text = files.get(filePath);
      if (text === undefined) throw new Error(`ephemeral Session journal is absent: ${filePath}`);
      return text;
    },
    ensureDirectory: () => undefined,
    appendFsyncCas(filePath: string, expectedText: string, text: string): boolean {
      const current = files.get(filePath) ?? '';
      if (current !== expectedText) return false;
      files.set(filePath, `${current}${text}`);
      return true;
    },
    createExclusiveFsync(filePath: string, text: string): boolean {
      if (files.has(filePath)) return false;
      files.set(filePath, text);
      return true;
    }
  });
}

export function readVerificationSessionJournalV1(input: {
  sessionRevision: `sha256:${string}`;
  fs: VerificationSessionJournalFileSystem;
}): VerificationSessionJournalReadbackV1 {
  const fs = input.fs;
  const filePath = sessionPath(fs, input.sessionRevision);
  if (!fs.exists(filePath)) {
    return { filePath, events: Object.freeze([]), completedStage: null, completedStageIndex: -1, latestEvent: null };
  }
  const source = fs.readText(filePath);
  if (source.length === 0 || !source.endsWith('\n')) {
    throw new Error('VerificationSession journal has a missing or partial final line.');
  }
  const events: VerificationSessionJournalEventV1[] = [];
  let previous: VerificationSessionJournalEventV1 | null = null;
  let completedStageIndex = -1;
  const lines = source.slice(0, -1).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    let candidate: unknown;
    try { candidate = JSON.parse(lines[index]!); } catch (error) {
      throw new Error(`VerificationSession journal event ${index + 1} is invalid JSON.`, { cause: error });
    }
    const event = parseEvent(candidate, input.sessionRevision, index + 1, previous, completedStageIndex);
    events.push(event);
    previous = event;
    if (event.kind === 'completed') completedStageIndex += 1;
  }
  return Object.freeze({
    filePath,
    events: Object.freeze(events),
    completedStage: completedStageIndex < 0 ? null : VERIFICATION_SESSION_STAGES[completedStageIndex]!,
    completedStageIndex,
    latestEvent: previous
  });
}

export function appendVerificationSessionJournalEventV1(input: {
  sessionRevision: `sha256:${string}`;
  targetStage: VerificationSessionStage;
  kind: VerificationSessionJournalEventKind;
  operationId?: `sha256:${string}` | null;
  receiptDigest?: `sha256:${string}` | null;
  recordedAt?: string;
  note?: string | null;
  fs: VerificationSessionJournalFileSystem;
}): VerificationSessionJournalEventV1 {
  const fs = input.fs;
  const current = readVerificationSessionJournalV1(input);
  const previous = current.latestEvent;
  const withoutDigest = {
    schema: VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA_V1,
    sequence: current.events.length + 1,
    sessionRevision: input.sessionRevision,
    targetStage: input.targetStage,
    kind: input.kind,
    operationId: assertDigest(input.operationId ?? null, 'operationId'),
    receiptDigest: assertDigest(input.receiptDigest ?? null, 'receiptDigest'),
    recordedAt: assertIso(input.recordedAt ?? new Date().toISOString(), 'recordedAt'),
    note: assertNote(input.note ?? null),
    previousDigest: previous?.eventDigest ?? null
  } satisfies Omit<VerificationSessionJournalEventV1, 'eventDigest'>;
  const event = Object.freeze({ ...withoutDigest, eventDigest: digest(withoutDigest) });
  parseEvent(event, input.sessionRevision, event.sequence, previous, current.completedStageIndex);
  fs.ensureDirectory(path.dirname(current.filePath));
  const existing = fs.exists(current.filePath) ? fs.readText(current.filePath) : '';
  const appended = fs.appendFsyncCas(current.filePath, existing, `${JSON.stringify(event)}\n`);
  if (!appended) throw new Error('VerificationSession journal changed concurrently; resume from fresh readback.');
  const readback = readVerificationSessionJournalV1(input);
  const persisted = readback.events.at(-1);
  if (persisted?.eventDigest !== event.eventDigest) throw new Error('VerificationSession journal append readback mismatch.');
  return persisted;
}

export function createVerificationSessionOperationId(input: {
  sessionRevision: `sha256:${string}`;
  operationKind: string;
  semanticInputDigest: `sha256:${string}`;
}): `sha256:${string}` {
  assertDigest(input.sessionRevision, 'sessionRevision');
  assertDigest(input.semanticInputDigest, 'semanticInputDigest');
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(input.operationKind)) {
    throw new Error('operationKind must be a bounded lowercase identifier.');
  }
  return digest(input);
}

export function claimVerificationSessionOperationV1(input: {
  sessionRevision: `sha256:${string}`;
  operationId: `sha256:${string}`;
  operationKind: string;
  claimedAt?: string;
  fs: VerificationSessionJournalFileSystem;
}): { claimed: boolean; claim: VerificationSessionOperationClaimV1 } {
  const fs = input.fs;
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(input.operationKind)) {
    throw new Error('operationKind must be a bounded lowercase identifier.');
  }
  const withoutDigest = {
    schema: VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA_V1,
    sessionRevision: input.sessionRevision,
    operationId: input.operationId,
    operationKind: input.operationKind,
    claimedAt: assertIso(input.claimedAt ?? new Date().toISOString(), 'claimedAt')
  } satisfies Omit<VerificationSessionOperationClaimV1, 'claimDigest'>;
  assertDigest(input.sessionRevision, 'sessionRevision');
  assertDigest(input.operationId, 'operationId');
  const claim = Object.freeze({ ...withoutDigest, claimDigest: digest(withoutDigest) });
  const filePath = claimPath(fs, input.sessionRevision, input.operationId);
  fs.ensureDirectory(path.dirname(filePath));
  if (fs.createExclusiveFsync(filePath, `${JSON.stringify(claim)}\n`)) return { claimed: true, claim };
  const existing = parseVerificationSessionOperationClaimV1(fs.readText(filePath));
  if (existing.sessionRevision !== input.sessionRevision
      || existing.operationId !== input.operationId
      || existing.operationKind !== input.operationKind) {
    throw new Error('VerificationSession operation claim identity conflict.');
  }
  return { claimed: false, claim: existing };
}

export function parseVerificationSessionOperationClaimV1(source: string): VerificationSessionOperationClaimV1 {
  if (!source.endsWith('\n')) throw new Error('VerificationSession operation claim is partial.');
  const candidate: unknown = JSON.parse(source.slice(0, -1));
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('VerificationSession operation claim must be an object.');
  }
  const value = candidate as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'sessionRevision', 'operationId', 'operationKind', 'claimedAt', 'claimDigest'
  ], 'VerificationSession operation claim');
  if (value.schema !== VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA_V1) {
    throw new Error('VerificationSession operation claim schema mismatch.');
  }
  if (typeof value.operationKind !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/u.test(value.operationKind)) {
    throw new Error('VerificationSession operation claim kind is invalid.');
  }
  const withoutDigest = {
    schema: VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA_V1,
    sessionRevision: assertDigest(value.sessionRevision, 'sessionRevision')!,
    operationId: assertDigest(value.operationId, 'operationId')!,
    operationKind: value.operationKind,
    claimedAt: assertIso(value.claimedAt, 'claimedAt')
  } satisfies Omit<VerificationSessionOperationClaimV1, 'claimDigest'>;
  const expected = digest(withoutDigest);
  if (value.claimDigest !== expected) throw new Error('VerificationSession operation claim digest mismatch.');
  return Object.freeze({ ...withoutDigest, claimDigest: expected });
}
