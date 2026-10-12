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
import { readVerificationDataRecord, snapshotVerificationData } from '../../../../../assurance/verification/contract/data.ts';
import { failureMessage } from '../../../../../contracts/failure-inspection.ts';
import type { HostedResumeDispatchOutcome, HostedResumeDispatchOutcomeCollection, HostedResumeDispatchRecording, HostedResumeSignal } from '../../../../../execution/verification/hosted.ts';
import { VERIFICATION_SESSION_STAGES, type VerificationSessionJournalEvent, type VerificationSessionJournalEventKind, type VerificationSessionJournalReadback, type VerificationSessionOperationClaim, type VerificationSessionStage } from '../../../../../execution/verification/hosted.ts';
import { HOSTED_RESUME_SIGNAL_SCHEMA, parseHostedResumeDispatchSignal } from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';

const VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA =
  'sec-verification-session-journal-event-v1' as const;
const VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA =
  'sec-verification-session-operation-claim-v1' as const;
const VERIFICATION_SESSION_JOURNAL_DIRECTORY =
  'verification-sessions/v2' as const;


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
  previous: VerificationSessionJournalEvent<typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA> | null,
  completedStageIndex: number
): VerificationSessionJournalEvent<typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`Session journal event ${sequence} must be an object.`);
  }
  const value = candidate as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'sequence', 'sessionRevision', 'targetStage', 'kind', 'operationId',
    'receiptDigest', 'recordedAt', 'note', 'previousDigest', 'eventDigest'
  ], `Session journal event ${sequence}`);
  if (value.schema !== VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA) {
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
    schema: VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA,
    sequence,
    sessionRevision,
    targetStage,
    kind,
    operationId: assertDigest(value.operationId, `event ${sequence} operationId`),
    receiptDigest: assertDigest(value.receiptDigest, `event ${sequence} receiptDigest`),
    recordedAt: assertIso(value.recordedAt, `event ${sequence} recordedAt`),
    note: assertNote(value.note),
    previousDigest
  } satisfies Omit<VerificationSessionJournalEvent<typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA>, 'eventDigest'>;
  const expectedDigest = digest(withoutDigest);
  if (value.eventDigest !== expectedDigest) throw new Error(`Session journal event ${sequence} digest mismatch.`);
  return Object.freeze({ ...withoutDigest, eventDigest: expectedDigest });
}

export function createEphemeralVerificationSessionJournalFs(
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

export function readVerificationSessionJournal(input: {
  sessionRevision: `sha256:${string}`;
  fs: VerificationSessionJournalFileSystem;
}): VerificationSessionJournalReadback<typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA> {
  const fs = input.fs;
  const filePath = sessionPath(fs, input.sessionRevision);
  if (!fs.exists(filePath)) {
    return { filePath, events: Object.freeze([]), completedStage: null, completedStageIndex: -1, latestEvent: null };
  }
  const source = fs.readText(filePath);
  if (source.length === 0 || !source.endsWith('\n')) {
    throw new Error('VerificationSession journal has a missing or partial final line.');
  }
  const events: VerificationSessionJournalEvent<typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA>[] = [];
  let previous: VerificationSessionJournalEvent<typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA> | null = null;
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

export function appendVerificationSessionJournalEvent(input: {
  sessionRevision: `sha256:${string}`;
  targetStage: VerificationSessionStage;
  kind: VerificationSessionJournalEventKind;
  operationId?: `sha256:${string}` | null;
  receiptDigest?: `sha256:${string}` | null;
  recordedAt?: string;
  note?: string | null;
  fs: VerificationSessionJournalFileSystem;
}): VerificationSessionJournalEvent<typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA> {
  const fs = input.fs;
  const current = readVerificationSessionJournal(input);
  const previous = current.latestEvent;
  const withoutDigest = {
    schema: VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA,
    sequence: current.events.length + 1,
    sessionRevision: input.sessionRevision,
    targetStage: input.targetStage,
    kind: input.kind,
    operationId: assertDigest(input.operationId ?? null, 'operationId'),
    receiptDigest: assertDigest(input.receiptDigest ?? null, 'receiptDigest'),
    recordedAt: assertIso(input.recordedAt ?? new Date().toISOString(), 'recordedAt'),
    note: assertNote(input.note ?? null),
    previousDigest: previous?.eventDigest ?? null
  } satisfies Omit<VerificationSessionJournalEvent<typeof VERIFICATION_SESSION_JOURNAL_EVENT_SCHEMA>, 'eventDigest'>;
  const event = Object.freeze({ ...withoutDigest, eventDigest: digest(withoutDigest) });
  parseEvent(event, input.sessionRevision, event.sequence, previous, current.completedStageIndex);
  fs.ensureDirectory(path.dirname(current.filePath));
  const existing = fs.exists(current.filePath) ? fs.readText(current.filePath) : '';
  const appended = fs.appendFsyncCas(current.filePath, existing, `${JSON.stringify(event)}\n`);
  if (!appended) throw new Error('VerificationSession journal changed concurrently; resume from fresh readback.');
  const readback = readVerificationSessionJournal(input);
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

export function claimVerificationSessionOperation(input: {
  sessionRevision: `sha256:${string}`;
  operationId: `sha256:${string}`;
  operationKind: string;
  claimedAt?: string;
  fs: VerificationSessionJournalFileSystem;
}): { claimed: boolean; claim: VerificationSessionOperationClaim<typeof VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA> } {
  const fs = input.fs;
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(input.operationKind)) {
    throw new Error('operationKind must be a bounded lowercase identifier.');
  }
  const withoutDigest = {
    schema: VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA,
    sessionRevision: input.sessionRevision,
    operationId: input.operationId,
    operationKind: input.operationKind,
    claimedAt: assertIso(input.claimedAt ?? new Date().toISOString(), 'claimedAt')
  } satisfies Omit<VerificationSessionOperationClaim<typeof VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA>, 'claimDigest'>;
  assertDigest(input.sessionRevision, 'sessionRevision');
  assertDigest(input.operationId, 'operationId');
  const claim = Object.freeze({ ...withoutDigest, claimDigest: digest(withoutDigest) });
  const filePath = claimPath(fs, input.sessionRevision, input.operationId);
  fs.ensureDirectory(path.dirname(filePath));
  if (fs.createExclusiveFsync(filePath, `${JSON.stringify(claim)}\n`)) return { claimed: true, claim };
  const existing = parseVerificationSessionOperationClaim(fs.readText(filePath));
  if (existing.sessionRevision !== input.sessionRevision
      || existing.operationId !== input.operationId
      || existing.operationKind !== input.operationKind) {
    throw new Error('VerificationSession operation claim identity conflict.');
  }
  return { claimed: false, claim: existing };
}

function parseVerificationSessionOperationClaim(source: string): VerificationSessionOperationClaim<typeof VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA> {
  if (!source.endsWith('\n')) throw new Error('VerificationSession operation claim is partial.');
  const candidate: unknown = JSON.parse(source.slice(0, -1));
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('VerificationSession operation claim must be an object.');
  }
  const value = candidate as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'sessionRevision', 'operationId', 'operationKind', 'claimedAt', 'claimDigest'
  ], 'VerificationSession operation claim');
  if (value.schema !== VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA) {
    throw new Error('VerificationSession operation claim schema mismatch.');
  }
  if (typeof value.operationKind !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/u.test(value.operationKind)) {
    throw new Error('VerificationSession operation claim kind is invalid.');
  }
  const withoutDigest = {
    schema: VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA,
    sessionRevision: assertDigest(value.sessionRevision, 'sessionRevision')!,
    operationId: assertDigest(value.operationId, 'operationId')!,
    operationKind: value.operationKind,
    claimedAt: assertIso(value.claimedAt, 'claimedAt')
  } satisfies Omit<VerificationSessionOperationClaim<typeof VERIFICATION_SESSION_OPERATION_CLAIM_SCHEMA>, 'claimDigest'>;
  const expected = digest(withoutDigest);
  if (value.claimDigest !== expected) throw new Error('VerificationSession operation claim digest mismatch.');
  return Object.freeze({ ...withoutDigest, claimDigest: expected });
}

const HOSTED_RESUME_DISPATCH_OUTCOME_SCHEMA = 'verification-session-resume-dispatch-outcome' as const;
const HOSTED_RESUME_DISPATCH_OPERATION_KIND = 'hosted-resume-dispatch' as const;
type ResumeSignal = HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
type ResumeOutcome = HostedResumeDispatchOutcome<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
type ResumeDispatchBinding = Readonly<{ fs: VerificationSessionJournalFileSystem;
  signal: ResumeSignal; sessionRevision: `sha256:${string}`; actionKey: `sha256:${string}` }>;

function resumeDispatchBinding(input: ResumeDispatchBinding) {
  const data = readVerificationDataRecord(input, 'Resume dispatch binding');
  return ownedResumeDispatchBinding(snapshotVerificationData(data.signal, 'Resume signal'), data.sessionRevision, data.actionKey);
}

function ownedResumeDispatchBinding(signalData: unknown, sessionData: unknown, actionData: unknown) {
  const signal = parseHostedResumeDispatchSignal(JSON.stringify(signalData));
  const sessionRevision = assertDigest(sessionData, 'resume sessionRevision');
  const actionKey = assertDigest(actionData, 'resume actionKey');
  if (sessionRevision === null || actionKey === null) throw new Error('Resume dispatch binding requires exact digests.');
  const operationId = createVerificationSessionOperationId({ sessionRevision,
    operationKind: HOSTED_RESUME_DISPATCH_OPERATION_KIND, semanticInputDigest: actionKey });
  return { signal, sessionRevision, actionKey, operationId };
}

/** Permanent same-machine restriction; absence is not cross-runner retry permission. */
export function claimHostedResumeDispatch(input: ResumeDispatchBinding & Readonly<{ recordedAt?: string }>) {
  const binding = resumeDispatchBinding(input);
  return claimVerificationSessionOperation({ fs: input.fs, sessionRevision: binding.sessionRevision,
    operationId: binding.operationId, operationKind: HOSTED_RESUME_DISPATCH_OPERATION_KIND,
    claimedAt: input.recordedAt });
}

function resumeOutcomePath(fs: VerificationSessionJournalFileSystem, sessionRevision: `sha256:${string}`,
  receiptDigest: `sha256:${string}`) {
  return path.join(path.dirname(sessionPath(fs, sessionRevision)), 'receipts', `${receiptDigest.slice(7)}.json`);
}

function parseResumeReceiver(value: unknown): ResumeOutcome['receiver'] {
  const receiver = readVerificationDataRecord(value, 'Resume receiver');
  exactKeys(receiver, ['repository', 'workflowPath', 'workflowSha', 'runId', 'runAttempt', 'jobId'], 'Resume receiver');
  if (typeof receiver.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(receiver.repository) ||
      receiver.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
      typeof receiver.workflowSha !== 'string' || !/^[0-9a-f]{40}$/u.test(receiver.workflowSha) ||
      typeof receiver.runId !== 'string' || !/^[1-9][0-9]*$/u.test(receiver.runId) ||
      typeof receiver.jobId !== 'string' || !/^[1-9][0-9]*$/u.test(receiver.jobId) ||
      !Number.isSafeInteger(receiver.runAttempt) || Number(receiver.runAttempt) < 1) throw new Error('Resume receiver identity is invalid.');
  return Object.freeze({ repository: receiver.repository, workflowPath: receiver.workflowPath,
    workflowSha: receiver.workflowSha, runId: receiver.runId, runAttempt: Number(receiver.runAttempt), jobId: receiver.jobId });
}

export function parseHostedResumeDispatchOutcome(source: string): ResumeOutcome {
  if (Buffer.byteLength(source, 'utf8') > 262144 || !source.endsWith('\n')) {
    throw new Error('Resume dispatch outcome is partial or exceeds its bound.');
  }
  const candidate: unknown = JSON.parse(source.slice(0, -1));
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Resume outcome must be an object.');
  const value = candidate as Record<string, unknown>;
  exactKeys(value, ['schema', 'sessionRevision', 'operationId', 'actionKey', 'signal', 'receiver', 'outcome', 'recordedAt', 'outcomeDigest'], 'Resume dispatch outcome');
  if (value.schema !== HOSTED_RESUME_DISPATCH_OUTCOME_SCHEMA) throw new Error('Resume outcome schema mismatch.');
  const receiver = parseResumeReceiver(value.receiver);
  const outcome = value.outcome as Record<string, unknown>;
  if (!receiver || typeof receiver !== 'object' || Array.isArray(receiver) ||
      !outcome || typeof outcome !== 'object' || Array.isArray(outcome)) throw new Error('Resume outcome fields must be objects.');
  exactKeys(outcome, ['disposition', 'publicationState', 'reason', 'failureDiagnostic'], 'Resume outcome state');
  if (!['dispatched', 'joined', 'blocked', 'unknown'].includes(String(outcome.disposition)) ||
      !['not-entered', 'entered-unknown', 'submitted'].includes(String(outcome.publicationState))) throw new Error('Resume outcome state is invalid.');
  if ((outcome.disposition === 'dispatched' && outcome.publicationState !== 'submitted') ||
      (outcome.disposition === 'blocked' && outcome.publicationState !== 'not-entered')) {
    throw new Error('Resume outcome disposition contradicts its publication state.');
  }
  const signal = parseHostedResumeDispatchSignal(JSON.stringify(value.signal));
  if (receiver.repository !== signal.emitter.repository) throw new Error('Resume outcome repository cause mismatch.');
  const sessionRevision = assertDigest(value.sessionRevision, 'resume sessionRevision');
  const actionKey = assertDigest(value.actionKey, 'resume actionKey');
  const operationId = assertDigest(value.operationId, 'resume operationId');
  if (sessionRevision === null || actionKey === null || operationId === null ||
      operationId !== createVerificationSessionOperationId({ sessionRevision,
        operationKind: HOSTED_RESUME_DISPATCH_OPERATION_KIND, semanticInputDigest: actionKey })) throw new Error('Resume outcome operation binding mismatch.');
  const withoutDigest = { schema: HOSTED_RESUME_DISPATCH_OUTCOME_SCHEMA, sessionRevision, operationId, actionKey, signal,
    receiver,
    outcome: Object.freeze({ disposition: outcome.disposition, publicationState: outcome.publicationState,
      reason: assertNote(outcome.reason), failureDiagnostic: assertNote(outcome.failureDiagnostic) }),
    recordedAt: assertIso(value.recordedAt, 'resume recordedAt') };
  const expected = digest(withoutDigest);
  if (value.outcomeDigest !== expected || source !== `${JSON.stringify({ ...withoutDigest, outcomeDigest: expected })}\n`) {
    throw new Error('Resume outcome digest or canonical bytes mismatch.');
  }
  return Object.freeze({ ...withoutDigest, outcomeDigest: expected }) as ResumeOutcome;
}

/** Pure actual-result capture precedes any durable recording attempt. */
export function createHostedResumeDispatchOutcome(input: Omit<ResumeDispatchBinding, 'fs'> & Readonly<{
  receiver: ResumeOutcome['receiver'];
  outcome: Readonly<{ disposition: ResumeOutcome['outcome']['disposition'];
    publicationState: ResumeOutcome['outcome']['publicationState']; reason: string | null; primaryFailure?: unknown }>;
  recordedAt?: string;
}>): ResumeOutcome {
  const data = readVerificationDataRecord(input, 'Resume outcome input');
  const nativeOutcome = readVerificationDataRecord(data.outcome, 'Resume native outcome');
  const failureDiagnostic = Object.hasOwn(nativeOutcome, 'primaryFailure')
    ? failureMessage(nativeOutcome.primaryFailure).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, ' ').slice(0, 2048) : null;
  // One owned snapshot supplies both digest and durable bytes. Unknown primary
  // never enters this JSON-compatible projection.
  const owned = readVerificationDataRecord(snapshotVerificationData({ signal: data.signal, receiver: data.receiver,
    sessionRevision: data.sessionRevision, actionKey: data.actionKey,
    outcome: { disposition: nativeOutcome.disposition, publicationState: nativeOutcome.publicationState,
      reason: nativeOutcome.reason, failureDiagnostic },
    recordedAt: data.recordedAt ?? new Date().toISOString() }, 'Resume outcome snapshot'));
  const binding = ownedResumeDispatchBinding(owned.signal, owned.sessionRevision, owned.actionKey);
  const withoutDigest = { schema: HOSTED_RESUME_DISPATCH_OUTCOME_SCHEMA,
    sessionRevision: binding.sessionRevision, operationId: binding.operationId, actionKey: binding.actionKey,
    signal: binding.signal, receiver: parseResumeReceiver(owned.receiver), outcome: owned.outcome, recordedAt: owned.recordedAt };
  const receipt = parseHostedResumeDispatchOutcome(`${JSON.stringify({ ...withoutDigest, outcomeDigest: digest(withoutDigest) })}\n`);
  return receipt;
}

export function recordHostedResumeDispatchOutcome(input: Readonly<{
  fs: VerificationSessionJournalFileSystem; outcome: ResumeOutcome;
}>): HostedResumeDispatchRecording<typeof HOSTED_RESUME_SIGNAL_SCHEMA> {
  const data = readVerificationDataRecord(input, 'Prepared resume outcome recording');
  const receipt = parseHostedResumeDispatchOutcome(`${JSON.stringify(snapshotVerificationData(data.outcome, 'Prepared resume outcome'))}\n`);
  const binding = ownedResumeDispatchBinding(receipt.signal, receipt.sessionRevision, receipt.actionKey);
  const fs = data.fs as VerificationSessionJournalFileSystem;
  const responsibilityPath = claimPath(fs, binding.sessionRevision, binding.operationId);
  if (!fs.exists(responsibilityPath)) return Object.freeze({ recording: 'unrecorded', outcome: receipt });
  const claim = parseVerificationSessionOperationClaim(fs.readText(responsibilityPath));
  if (claim.operationKind !== HOSTED_RESUME_DISPATCH_OPERATION_KIND || claim.sessionRevision !== binding.sessionRevision ||
      claim.operationId !== binding.operationId) throw new Error('Resume outcome permanent claim differs.');
  const text = `${JSON.stringify(receipt)}\n`;
  const filePath = resumeOutcomePath(fs, binding.sessionRevision, receipt.outcomeDigest);
  fs.ensureDirectory(path.dirname(filePath));
  if (!fs.createExclusiveFsync(filePath, text) && fs.readText(filePath) !== text) {
    throw new Error('Resume outcome immutable bytes conflict.');
  }
  if (fs.readText(filePath) !== text) throw new Error('Resume outcome durable readback mismatch.');
  const current = readVerificationSessionJournal({ fs, sessionRevision: binding.sessionRevision });
  appendVerificationSessionJournalEvent({ fs, sessionRevision: binding.sessionRevision,
    operationId: binding.operationId, receiptDigest: receipt.outcomeDigest,
    targetStage: VERIFICATION_SESSION_STAGES[Math.max(0, current.completedStageIndex)]!, kind: 'observation',
    recordedAt: receipt.recordedAt, note: HOSTED_RESUME_DISPATCH_OUTCOME_SCHEMA });
  return Object.freeze({ recording: 'recorded', outcome: receipt });
}

export function readHostedResumeDispatchOutcome(input: ResumeDispatchBinding): ResumeOutcome | null {
  const binding = resumeDispatchBinding(input);
  const journal = readVerificationSessionJournal({ fs: input.fs, sessionRevision: binding.sessionRevision });
  const event = journal.events.filter(event => event.operationId === binding.operationId &&
    event.note === HOSTED_RESUME_DISPATCH_OUTCOME_SCHEMA).at(-1);
  if (event === undefined) return null;
  if (event.kind !== 'observation' || event.receiptDigest === null) throw new Error('Resume outcome journal binding is invalid.');
  const receipt = parseHostedResumeDispatchOutcome(input.fs.readText(resumeOutcomePath(input.fs, binding.sessionRevision, event.receiptDigest)));
  if (receipt.outcomeDigest !== event.receiptDigest || receipt.operationId !== binding.operationId ||
      receipt.sessionRevision !== binding.sessionRevision || receipt.actionKey !== binding.actionKey ||
      JSON.stringify(receipt.signal) !== JSON.stringify(binding.signal)) throw new Error('Resume outcome cause differs from journal readback.');
  return receipt;
}

type ResumeOutcomeCollection = HostedResumeDispatchOutcomeCollection<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
const HOSTED_RESUME_DISPATCH_OUTCOMES_SCHEMA = 'verification-session-resume-dispatch-outcomes' as const;

function resumeExpectedActionKeys(value: unknown): readonly `sha256:${string}`[] {
  if (!Array.isArray(value) || value.length > 256) throw new Error('Resume outcome planned membership is invalid.');
  const keys = value.map(key => {
    const checked = assertDigest(key, 'planned resume actionKey');
    if (checked === null) throw new Error('Planned resume actionKey must not be null.');
    return checked;
  });
  if (new Set(keys).size !== keys.length) throw new Error('Resume outcome planned membership repeats an Action.');
  return Object.freeze(keys);
}

/** Exact transport interpretation only; expected keys must also join the native parent plan. */
export function parseHostedResumeDispatchOutcomeCollection(source: string,
  expectedActionKeys: readonly `sha256:${string}`[]): ResumeOutcomeCollection {
  if (Buffer.byteLength(source, 'utf8') > 10 * 1024 * 1024 || !source.endsWith('\n')) {
    throw new Error('Resume outcome collection is partial or exceeds the original archive member bound.');
  }
  const value = readVerificationDataRecord(JSON.parse(source.slice(0, -1)) as unknown, 'Resume outcome collection');
  exactKeys(value, ['schema', 'signal', 'sessionRevision', 'receiver', 'expectedActionKeys', 'entries', 'collectionDigest'], 'Resume outcome collection');
  if (value.schema !== HOSTED_RESUME_DISPATCH_OUTCOMES_SCHEMA) throw new Error('Resume outcome collection schema mismatch.');
  const expected = resumeExpectedActionKeys(snapshotVerificationData(expectedActionKeys, 'Expected resume actions'));
  const actual = resumeExpectedActionKeys(value.expectedActionKeys);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Resume outcome collection differs from its actual planned membership.');
  const signal = parseHostedResumeDispatchSignal(JSON.stringify(value.signal));
  const sessionRevision = assertDigest(value.sessionRevision, 'collection sessionRevision');
  if (sessionRevision === null) throw new Error('Resume collection Session identity is absent.');
  const receiver = parseResumeReceiver(value.receiver);
  if (receiver.repository !== signal.emitter.repository) throw new Error('Resume collection repository cause mismatch.');
  if (!Array.isArray(value.entries) || value.entries.length !== expected.length) throw new Error('Resume collection member census is incomplete.');
  const entries = value.entries.map((entry, index) => {
    const member = readVerificationDataRecord(entry, 'Resume outcome member');
    exactKeys(member, ['actionKey', 'recording', 'outcome'], 'Resume outcome member');
    const actionKey = assertDigest(member.actionKey, 'collection actionKey');
    if (actionKey === null || actionKey !== expected[index]) throw new Error('Resume collection Action membership differs.');
    if (member.recording === 'not-attempted') {
      if (member.outcome !== null) throw new Error('Not-attempted resume member must not manufacture an outcome.');
      return Object.freeze({ actionKey, recording: 'not-attempted' as const, outcome: null });
    }
    if (member.recording !== 'recorded' && member.recording !== 'unrecorded') throw new Error('Resume member recording state is invalid.');
    const outcome = parseHostedResumeDispatchOutcome(`${JSON.stringify(member.outcome)}\n`);
    if (outcome.actionKey !== actionKey || outcome.sessionRevision !== sessionRevision ||
        JSON.stringify(outcome.signal) !== JSON.stringify(signal) ||
        JSON.stringify(outcome.receiver) !== JSON.stringify(receiver)) throw new Error('Resume member differs from the collection cause or producer.');
    return Object.freeze({ actionKey, recording: member.recording, outcome });
  });
  const withoutDigest = { schema: HOSTED_RESUME_DISPATCH_OUTCOMES_SCHEMA, signal, sessionRevision, receiver,
    expectedActionKeys: actual, entries: Object.freeze(entries) };
  const expectedDigest = digest(withoutDigest);
  if (value.collectionDigest !== expectedDigest || source !== `${JSON.stringify({ ...withoutDigest, collectionDigest: expectedDigest })}\n`) {
    throw new Error('Resume collection digest or canonical bytes mismatch.');
  }
  return Object.freeze({ ...withoutDigest, collectionDigest: expectedDigest });
}

export function createHostedResumeDispatchOutcomeCollection(input: Readonly<{
  signal: ResumeSignal; sessionRevision: `sha256:${string}`; receiver: ResumeOutcome['receiver'];
  expectedActionKeys: readonly `sha256:${string}`[]; entries: ResumeOutcomeCollection['entries'];
}>): ResumeOutcomeCollection {
  const owned = readVerificationDataRecord(snapshotVerificationData(input, 'Resume outcome collection snapshot'));
  const expected = resumeExpectedActionKeys(owned.expectedActionKeys);
  if (!Array.isArray(owned.entries)) throw new Error('Resume collection entries must be an array.');
  const entries = owned.entries.map(entry => {
    const member = readVerificationDataRecord(entry, 'Resume collection member snapshot');
    exactKeys(member, ['actionKey', 'recording', 'outcome'], 'Resume collection member snapshot');
    return { actionKey: member.actionKey, recording: member.recording,
      outcome: member.outcome === null ? null : parseHostedResumeDispatchOutcome(`${JSON.stringify(member.outcome)}\n`) };
  });
  const withoutDigest = { schema: HOSTED_RESUME_DISPATCH_OUTCOMES_SCHEMA,
    signal: parseHostedResumeDispatchSignal(JSON.stringify(owned.signal)), sessionRevision: owned.sessionRevision,
    receiver: parseResumeReceiver(owned.receiver), expectedActionKeys: expected, entries };
  return parseHostedResumeDispatchOutcomeCollection(`${JSON.stringify({ ...withoutDigest, collectionDigest: digest(withoutDigest) })}\n`, expected);
}
