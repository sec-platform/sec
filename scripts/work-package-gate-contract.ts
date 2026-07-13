import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { CodexDevelopmentVerificationDigest } from '../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentParseWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest
} from './codex/work-package-contract.ts';

export const WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V1 = 'codex-work-package-gate-evidence-v1' as const;
export const WORK_PACKAGE_GATE_EVENT_SCHEMA_V1 = 'codex-work-package-gate-event-v1' as const;
export const WORK_PACKAGE_GATE_STATE_SCHEMA_V1 = 'codex-work-package-gate-state-v1' as const;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID = 'sm3-r2-bounded-runtime-gate-v1' as const;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH =
  'docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md' as const;
export const WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST =
  'sha256:158e813f64b958510357d86240d85ee3bb084b81e9f95033806ee48360815951' as const;
export const WORK_PACKAGE_GATE_SELECTION_MANIFEST_ID = 'sm3-r1-focused-blocker-repair-v1' as const;
export const WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH =
  'docs/work-packages/sm3-r1-focused-blocker-repair-v1.md' as const;
export const WORK_PACKAGE_GATE_SELECTION_MANIFEST_DIGEST =
  'sha256:a19487b18cdcb23c2c85c189253a0aa8bfd1229e5f9fd4a6a62c919687367af6' as const;
export const WORK_PACKAGE_GATE_ARGV_DIGEST =
  'sha256:edf2c83f4b2a57e6d218f058fccba3f754eaf9fde834f96b57b2cc296403518d' as const;

export type WorkPackageGateStatus = 'passed' | 'failed' | 'timed-out' | 'unknown';
export type WorkPackageGateEventKind =
  | 'started'
  | 'heartbeat'
  | 'deadline'
  | 'termination'
  | 'recovery'
  | 'residue'
  | 'completed';

export interface WorkPackageGateSelectionV1 {
  readonly executionManifestId: string;
  readonly executionManifestPath: string;
  readonly executionManifestDigest: string;
  readonly selectionManifestId: string;
  readonly selectionManifestPath: string;
  readonly selectionManifestDigest: string;
  readonly selectionIndex: number;
  readonly argv: readonly string[];
  readonly argvDigest: string;
  readonly testFiles: readonly string[];
  readonly testFileCount: 39;
  readonly perTestTimeoutMs: 600_000;
}

export interface WorkPackageGateStreamEvidenceV1 {
  readonly bytes: number;
  readonly digest: string;
  readonly observerTruncated: boolean;
}

export interface WorkPackageGateTerminationEvidenceV1 {
  readonly requested: boolean;
  readonly gracefulAttempted: boolean;
  readonly forcedAttempted: boolean;
  readonly childCloseObserved: boolean;
  readonly streamsDrained: boolean;
  readonly treeClosed: boolean;
}

export interface WorkPackageGateChildEvidenceV1 {
  readonly status: string;
  readonly trigger: string | null;
  readonly started: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly stdout: WorkPackageGateStreamEvidenceV1;
  readonly stderr: WorkPackageGateStreamEvidenceV1;
  readonly termination: WorkPackageGateTerminationEvidenceV1;
}

export interface WorkPackageGateIdentitySetEvidenceV1 {
  readonly count: number;
  readonly digest: string;
}

export interface WorkPackageGateResidueCensusV1 {
  readonly workspaceRoots: number;
  readonly recoveryOwners: number;
  readonly pendingOwners: number;
  readonly nativeResults: number;
  readonly writerLeases: number;
  readonly appContainerProfiles: WorkPackageGateIdentitySetEvidenceV1 | null;
  readonly aclPresentOwners: WorkPackageGateIdentitySetEvidenceV1 | null;
}

export interface WorkPackageGateEventV1 {
  readonly schema: typeof WORK_PACKAGE_GATE_EVENT_SCHEMA_V1;
  readonly sequence: number;
  readonly kind: WorkPackageGateEventKind;
  readonly elapsedMs: number;
  readonly phase: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly subjectDigest: string | null;
  readonly previousDigest: string | null;
  readonly eventDigest: string;
}

export interface WorkPackageGateStateV1 {
  readonly schema: typeof WORK_PACKAGE_GATE_STATE_SCHEMA_V1;
  readonly runId: string;
  readonly status: 'running' | WorkPackageGateStatus;
  readonly phase: string;
  readonly elapsedMs: number;
  readonly sequence: number;
  readonly journalDigest: string | null;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

export interface WorkPackageGateEvidenceDraftV1 {
  readonly runId: string;
  readonly status: WorkPackageGateStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly selection: WorkPackageGateSelectionV1;
  readonly repository: {
    readonly headSha: string;
    readonly treeSha: string;
    readonly headShaAfter: string | null;
    readonly treeShaAfter: string | null;
    readonly worktreeBeforeDigest: string;
    readonly worktreeAfterDigest: string | null;
    readonly executionSnapshotDigest: string;
    readonly executionSnapshotAfterDigest: string | null;
    readonly executionSnapshotRemoved: boolean;
  };
  readonly timeouts: {
    readonly watchdogMs: number;
    readonly cleanupMs: number;
  };
  readonly child: WorkPackageGateChildEvidenceV1;
  readonly recovery: {
    readonly attempted: boolean;
    readonly complete: boolean;
    readonly reason: 'not-needed' | 'authority-preserved' | 'completed' | 'failed';
  };
  readonly residue: {
    readonly before: WorkPackageGateResidueCensusV1 | null;
    readonly after: WorkPackageGateResidueCensusV1 | null;
    readonly namespaceRemoved: boolean;
  };
  readonly journal: {
    readonly lastSequence: number;
    readonly digest: string;
  };
}

export type WorkPackageGateEvidenceV1 = WorkPackageGateEvidenceDraftV1 & {
  readonly schema: typeof WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V1;
  readonly evidenceDigest: string;
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} keys are invalid`);
  }
}

function plainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function digest(value: unknown): string {
  return CodexDevelopmentVerificationDigest(value);
}

function normalizedManifestPath(value: string, label: string): string {
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(value)) {
    throw new Error(`${label} must be a canonical Work Package path`);
  }
  return value;
}

function parseOwnerBatch(command: string): {
  readonly argv: readonly string[];
  readonly testFiles: readonly string[];
} {
  if (command.trim() !== command || /\s{2,}|[\t\r\n'"`|&;<>$()]/u.test(command)) {
    throw new Error('Gate selection command contains shell or non-canonical whitespace syntax');
  }
  const argv = command.split(' ');
  if (argv[0] !== 'bun' || argv[1] !== 'test' || argv.at(-2) !== '--timeout' || argv.at(-1) !== '600000') {
    throw new Error('Gate selection must be one bun test command with the frozen 600000 ms timeout');
  }
  const testFiles = argv.slice(2, -2);
  if (testFiles.length !== 39 || new Set(testFiles).size !== 39) {
    throw new Error('Gate selection must contain exactly 39 unique test files');
  }
  for (const file of testFiles) {
    if (!/^tests\/(?:unit|contract|integration)\/[a-z0-9][a-z0-9./-]*\.test\.ts$/u.test(file) ||
      file.includes('//') || file.split('/').some((segment) => segment === '.' || segment === '..')) {
      throw new Error('Gate selection contains a non-canonical test path');
    }
  }
  return { argv: Object.freeze(argv), testFiles: Object.freeze(testFiles) };
}

export function parseFrozenWorkPackageGateSelection(input: {
  readonly executionManifestSource: string;
  readonly executionManifestPath: string;
  readonly selectionManifestSource: string;
  readonly selectionManifestPath: string;
  readonly selectionIndex: number;
}): WorkPackageGateSelectionV1 {
  const executionManifestPath = normalizedManifestPath(
    input.executionManifestPath,
    'Execution manifest path'
  );
  const selectionManifestPath = normalizedManifestPath(
    input.selectionManifestPath,
    'Selection manifest path'
  );
  if (!Number.isSafeInteger(input.selectionIndex) || input.selectionIndex < 0) {
    throw new Error('Selection index must be a non-negative safe integer');
  }
  const execution = CodexDevelopmentParseWorkPackageManifestV1(
    input.executionManifestSource,
    executionManifestPath
  );
  const selection = CodexDevelopmentParseWorkPackageManifestV1(
    input.selectionManifestSource,
    selectionManifestPath
  );
  if (execution.base !== selection.base) throw new Error('Execution and selection manifests must share a base');
  const selectionManifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    input.selectionManifestSource
  );
  const executionManifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    input.executionManifestSource
  );
  if (executionManifestPath !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH ||
    execution.id !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID ||
    executionManifestDigest !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST ||
    selectionManifestPath !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH ||
    selection.id !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_ID ||
    input.selectionIndex !== 0 ||
    selectionManifestDigest !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_DIGEST) {
    throw new Error('Gate selection does not match the exact frozen R1/R2 binding');
  }
  const command = selection.tests[input.selectionIndex];
  if (command === undefined) throw new Error('Selection index is outside the frozen manifest');
  const parsed = parseOwnerBatch(command);
  const argvDigest = digest(parsed.argv);
  if (argvDigest !== WORK_PACKAGE_GATE_ARGV_DIGEST) {
    throw new Error('Gate selection argv does not match the frozen owner batch');
  }
  return Object.freeze({
    executionManifestId: execution.id,
    executionManifestPath,
    executionManifestDigest,
    selectionManifestId: selection.id,
    selectionManifestPath,
    selectionManifestDigest,
    selectionIndex: input.selectionIndex,
    argv: parsed.argv,
    argvDigest,
    testFiles: parsed.testFiles,
    testFileCount: 39,
    perTestTimeoutMs: 600_000
  });
}

export function finalizeWorkPackageGateEvent(input: {
  readonly sequence: number;
  readonly kind: WorkPackageGateEventKind;
  readonly elapsedMs: number;
  readonly phase: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly subject?: unknown;
  readonly previousDigest: string | null;
}): WorkPackageGateEventV1 {
  const { subject, ...event } = input;
  const withoutDigest = {
    schema: WORK_PACKAGE_GATE_EVENT_SCHEMA_V1,
    ...event,
    subjectDigest: subject === undefined ? null : digest(subject)
  };
  return Object.freeze({ ...withoutDigest, eventDigest: digest(withoutDigest) });
}

export function assertWorkPackageGateEvent(
  value: unknown,
  expectedPreviousDigest?: string | null
): asserts value is WorkPackageGateEventV1 {
  plainObject(value, 'Work Package gate event');
  exactKeys(value, [
    'schema', 'sequence', 'kind', 'elapsedMs', 'phase', 'stdoutBytes', 'stderrBytes',
    'subjectDigest', 'previousDigest', 'eventDigest'
  ], 'Work Package gate event');
  if (value.schema !== WORK_PACKAGE_GATE_EVENT_SCHEMA_V1 ||
    !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1 ||
    !['started', 'heartbeat', 'deadline', 'termination', 'recovery', 'residue', 'completed'].includes(String(value.kind)) ||
    !Number.isFinite(value.elapsedMs) || Number(value.elapsedMs) < 0 ||
    typeof value.phase !== 'string' || value.phase.length < 1 || value.phase.length > 64 ||
    !Number.isSafeInteger(value.stdoutBytes) || Number(value.stdoutBytes) < 0 ||
    !Number.isSafeInteger(value.stderrBytes) || Number(value.stderrBytes) < 0 ||
    (value.subjectDigest !== null && !/^sha256:[0-9a-f]{64}$/u.test(String(value.subjectDigest))) ||
    (value.previousDigest !== null && !/^sha256:[0-9a-f]{64}$/u.test(String(value.previousDigest))) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(value.eventDigest))) {
    throw new Error('Work Package gate event is invalid');
  }
  if (expectedPreviousDigest !== undefined && value.previousDigest !== expectedPreviousDigest) {
    throw new Error('Work Package gate event hash chain is invalid');
  }
  const { eventDigest, ...withoutDigest } = value;
  if (eventDigest !== digest(withoutDigest)) throw new Error('Work Package gate event digest mismatch');
}

export function finalizeWorkPackageGateEvidence(
  draft: WorkPackageGateEvidenceDraftV1
): WorkPackageGateEvidenceV1 {
  const withoutDigest = { schema: WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V1, ...draft };
  return Object.freeze({ ...withoutDigest, evidenceDigest: digest(withoutDigest) });
}

function assertDigest(value: unknown, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(String(value))) throw new Error(`${label} must be a SHA-256 digest`);
}

function assertCensus(value: unknown, label: string): asserts value is WorkPackageGateResidueCensusV1 {
  plainObject(value, label);
  exactKeys(value, [
    'workspaceRoots', 'recoveryOwners', 'pendingOwners', 'nativeResults', 'writerLeases',
    'appContainerProfiles', 'aclPresentOwners'
  ], label);
  for (const key of ['workspaceRoots', 'recoveryOwners', 'pendingOwners', 'nativeResults', 'writerLeases'] as const) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) throw new Error(`${label}.${key} is invalid`);
  }
  for (const key of ['appContainerProfiles', 'aclPresentOwners'] as const) {
    const identitySet = value[key];
    if (identitySet === null) continue;
    plainObject(identitySet, `${label}.${key}`);
    exactKeys(identitySet, ['count', 'digest'], `${label}.${key}`);
    if (!Number.isSafeInteger(identitySet.count) || Number(identitySet.count) < 0) {
      throw new Error(`${label}.${key}.count is invalid`);
    }
    assertDigest(identitySet.digest, `${label}.${key}.digest`);
  }
}

function assertStream(
  value: unknown,
  label: string
): asserts value is WorkPackageGateStreamEvidenceV1 {
  plainObject(value, label);
  exactKeys(value, ['bytes', 'digest', 'observerTruncated'], label);
  if (!Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0 ||
    typeof value.observerTruncated !== 'boolean') throw new Error(`${label} is invalid`);
  assertDigest(value.digest, `${label}.digest`);
}

export function assertWorkPackageGateEvidence(
  value: unknown
): asserts value is WorkPackageGateEvidenceV1 {
  plainObject(value, 'Work Package gate evidence');
  exactKeys(value, [
    'schema', 'runId', 'status', 'startedAt', 'completedAt', 'durationMs', 'selection',
    'repository', 'timeouts', 'child', 'recovery', 'residue', 'journal', 'evidenceDigest'
  ], 'Work Package gate evidence');
  if (value.schema !== WORK_PACKAGE_GATE_EVIDENCE_SCHEMA_V1 ||
    typeof value.runId !== 'string' || value.runId.length > 128 || !/^[a-z0-9-]+$/u.test(value.runId) ||
    !['passed', 'failed', 'timed-out', 'unknown'].includes(String(value.status)) ||
    !Number.isFinite(Date.parse(String(value.startedAt))) ||
    !Number.isFinite(Date.parse(String(value.completedAt))) ||
    !Number.isFinite(value.durationMs) || Number(value.durationMs) < 0) {
    throw new Error('Work Package gate evidence header is invalid');
  }
  plainObject(value.selection, 'Work Package gate selection');
  exactKeys(value.selection, [
    'executionManifestId', 'executionManifestPath', 'executionManifestDigest',
    'selectionManifestId', 'selectionManifestPath', 'selectionManifestDigest',
    'selectionIndex', 'argv', 'argvDigest', 'testFiles', 'testFileCount', 'perTestTimeoutMs'
  ], 'Work Package gate selection');
  assertDigest(value.selection.executionManifestDigest, 'executionManifestDigest');
  assertDigest(value.selection.selectionManifestDigest, 'selectionManifestDigest');
  assertDigest(value.selection.argvDigest, 'argvDigest');
  if (!Array.isArray(value.selection.argv) || digest(value.selection.argv) !== value.selection.argvDigest ||
    !Array.isArray(value.selection.testFiles) || value.selection.testFiles.length !== 39 ||
    value.selection.testFileCount !== 39 || value.selection.perTestTimeoutMs !== 600_000) {
    throw new Error('Work Package gate selection proof is invalid');
  }
  const reparsed = parseOwnerBatch(value.selection.argv.join(' '));
  if (JSON.stringify(reparsed.testFiles) !== JSON.stringify(value.selection.testFiles) ||
    value.selection.selectionIndex !== 0 ||
    value.selection.executionManifestId !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_ID ||
    value.selection.executionManifestPath !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_PATH ||
    value.selection.executionManifestDigest !== WORK_PACKAGE_GATE_EXECUTION_MANIFEST_DIGEST ||
    value.selection.selectionManifestId !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_ID ||
    value.selection.selectionManifestPath !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_PATH ||
    value.selection.selectionManifestDigest !== WORK_PACKAGE_GATE_SELECTION_MANIFEST_DIGEST ||
    value.selection.argvDigest !== WORK_PACKAGE_GATE_ARGV_DIGEST) {
    throw new Error('Work Package gate selection binding is invalid');
  }
  plainObject(value.repository, 'Work Package gate repository');
  exactKeys(value.repository, [
    'headSha', 'treeSha', 'headShaAfter', 'treeShaAfter',
    'worktreeBeforeDigest', 'worktreeAfterDigest', 'executionSnapshotDigest',
    'executionSnapshotAfterDigest', 'executionSnapshotRemoved'
  ], 'Work Package gate repository');
  for (const key of ['headSha', 'treeSha'] as const) {
    if (!/^[0-9a-f]{40}$/u.test(String(value.repository[key]))) throw new Error(`repository.${key} is invalid`);
  }
  for (const key of ['headShaAfter', 'treeShaAfter'] as const) {
    if (value.repository[key] !== null && !/^[0-9a-f]{40}$/u.test(String(value.repository[key]))) {
      throw new Error(`repository.${key} is invalid`);
    }
  }
  assertDigest(value.repository.worktreeBeforeDigest, 'worktreeBeforeDigest');
  assertDigest(value.repository.executionSnapshotDigest, 'executionSnapshotDigest');
  if (value.repository.worktreeAfterDigest !== null) {
    assertDigest(value.repository.worktreeAfterDigest, 'worktreeAfterDigest');
  }
  if (value.repository.executionSnapshotAfterDigest !== null) {
    assertDigest(value.repository.executionSnapshotAfterDigest, 'executionSnapshotAfterDigest');
  }
  if (typeof value.repository.executionSnapshotRemoved !== 'boolean') {
    throw new Error('repository.executionSnapshotRemoved is invalid');
  }
  plainObject(value.timeouts, 'Work Package gate timeouts');
  exactKeys(value.timeouts, ['watchdogMs', 'cleanupMs'], 'Work Package gate timeouts');
  if (value.timeouts.watchdogMs !== 1_800_000 || value.timeouts.cleanupMs !== 120_000) {
    throw new Error('Work Package gate timeout contract is invalid');
  }
  plainObject(value.child, 'Work Package gate child');
  exactKeys(value.child, [
    'status', 'trigger', 'started', 'exitCode', 'signal', 'durationMs',
    'stdout', 'stderr', 'termination'
  ], 'Work Package gate child');
  if (!['exited', 'spawn-failed', 'aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed', 'timed-out',
    'tree-unproven', 'termination-unproven'].includes(String(value.child.status)) ||
    (value.child.trigger !== null && !['aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed', 'timed-out']
      .includes(String(value.child.trigger))) ||
    typeof value.child.started !== 'boolean' ||
    (value.child.exitCode !== null && !Number.isSafeInteger(value.child.exitCode)) ||
    (value.child.signal !== null && !/^SIG[A-Z0-9]+$/u.test(String(value.child.signal))) ||
    !Number.isFinite(value.child.durationMs) || Number(value.child.durationMs) < 0) {
    throw new Error('Work Package gate child outcome is invalid');
  }
  assertStream(value.child.stdout, 'Work Package gate stdout');
  assertStream(value.child.stderr, 'Work Package gate stderr');
  plainObject(value.child.termination, 'Work Package gate termination');
  exactKeys(value.child.termination, [
    'requested', 'gracefulAttempted', 'forcedAttempted', 'childCloseObserved',
    'streamsDrained', 'treeClosed'
  ], 'Work Package gate termination');
  for (const key of Object.keys(value.child.termination)) {
    if (typeof value.child.termination[key] !== 'boolean') {
      throw new Error('Work Package gate termination evidence is invalid');
    }
  }
  if ((!value.child.termination.requested &&
      (value.child.termination.gracefulAttempted || value.child.termination.forcedAttempted)) ||
    (value.child.started && value.child.termination.treeClosed &&
      (!value.child.termination.childCloseObserved || !value.child.termination.streamsDrained))) {
    throw new Error('Work Package gate termination state is contradictory');
  }
  plainObject(value.recovery, 'Work Package gate recovery');
  exactKeys(value.recovery, ['attempted', 'complete', 'reason'], 'Work Package gate recovery');
  if (typeof value.recovery.attempted !== 'boolean' || typeof value.recovery.complete !== 'boolean' ||
    !['not-needed', 'authority-preserved', 'completed', 'failed'].includes(String(value.recovery.reason))) {
    throw new Error('Work Package gate recovery evidence is invalid');
  }
  const recoveryAlgebraValid =
    (value.recovery.reason === 'not-needed' && !value.recovery.attempted && value.recovery.complete) ||
    (value.recovery.reason === 'authority-preserved' && !value.recovery.attempted && !value.recovery.complete) ||
    (value.recovery.reason === 'completed' && value.recovery.attempted && value.recovery.complete) ||
    (value.recovery.reason === 'failed' && value.recovery.attempted && !value.recovery.complete);
  if (!recoveryAlgebraValid) throw new Error('Work Package gate recovery state is contradictory');
  plainObject(value.residue, 'Work Package gate residue');
  exactKeys(value.residue, ['before', 'after', 'namespaceRemoved'], 'Work Package gate residue');
  if (typeof value.residue.namespaceRemoved !== 'boolean') {
    throw new Error('Work Package gate namespace cleanup evidence is invalid');
  }
  if (value.residue.before !== null) {
    assertCensus(value.residue.before, 'Work Package gate residue before');
  }
  if (value.residue.after !== null) assertCensus(value.residue.after, 'Work Package gate residue after');
  plainObject(value.journal, 'Work Package gate journal');
  exactKeys(value.journal, ['lastSequence', 'digest'], 'Work Package gate journal');
  if (!Number.isSafeInteger(value.journal.lastSequence) || Number(value.journal.lastSequence) < 1) {
    throw new Error('Work Package gate journal sequence is invalid');
  }
  assertDigest(value.journal.digest, 'journal digest');
  const before = value.residue.before as WorkPackageGateResidueCensusV1 | null;
  const after = value.residue.after as WorkPackageGateResidueCensusV1 | null;
  const cleanCompletion = before !== null && after !== null &&
    value.child.started === true &&
    !value.child.stdout.observerTruncated && !value.child.stderr.observerTruncated &&
    value.child.termination.childCloseObserved === true &&
    value.child.termination.streamsDrained === true &&
    value.child.termination.treeClosed === true && value.recovery.complete === true &&
    before.workspaceRoots === 0 && before.recoveryOwners === 0 && before.pendingOwners === 0 &&
    before.nativeResults === 0 && before.writerLeases === 0 &&
    before.appContainerProfiles !== null && before.aclPresentOwners !== null &&
    before.aclPresentOwners.count === 0 &&
    after.workspaceRoots === 0 && after.recoveryOwners === 0 && after.pendingOwners === 0 &&
    after.nativeResults === 0 && after.writerLeases === 0 &&
    after.appContainerProfiles !== null && after.aclPresentOwners !== null &&
    after.aclPresentOwners.count === 0 &&
    after.appContainerProfiles.count === before.appContainerProfiles.count &&
    after.appContainerProfiles.digest === before.appContainerProfiles.digest &&
    value.residue.namespaceRemoved === true &&
    value.repository.headSha === value.repository.headShaAfter &&
    value.repository.treeSha === value.repository.treeShaAfter &&
    value.repository.worktreeBeforeDigest === value.repository.worktreeAfterDigest &&
    value.repository.executionSnapshotDigest === value.repository.executionSnapshotAfterDigest &&
    value.repository.executionSnapshotRemoved === true;
  if (value.status === 'passed') {
    if (!cleanCompletion || value.child.status !== 'exited' || value.child.trigger !== null ||
      value.child.termination.requested !== false || value.child.exitCode !== 0) {
      throw new Error('Passed Work Package gate evidence is incomplete');
    }
  } else if (value.status === 'failed') {
    if (!cleanCompletion || value.child.status !== 'exited' || value.child.trigger !== null ||
      value.child.termination.requested !== false || value.child.exitCode === null ||
      value.child.exitCode === 0) {
      throw new Error('Failed Work Package gate evidence is inconsistent');
    }
  } else if (value.status === 'timed-out') {
    if (!cleanCompletion || value.child.status !== 'timed-out' ||
      value.child.trigger !== 'timed-out' || value.child.termination.requested !== true ||
      value.child.exitCode !== null) {
      throw new Error('Timed-out Work Package gate evidence is inconsistent');
    }
  }
  const { evidenceDigest, ...withoutDigest } = value;
  assertDigest(evidenceDigest, 'evidence digest');
  if (evidenceDigest !== digest(withoutDigest)) throw new Error('Work Package gate evidence digest mismatch');
}

export function assertWorkPackageGateJournal(
  source: string,
  expected: { readonly lastSequence: number; readonly digest: string }
): void {
  if (Buffer.byteLength(source, 'utf8') > 8 * 1024 * 1024 || !source.endsWith('\n')) {
    throw new Error('Work Package gate journal bytes are invalid');
  }
  const lines = source.slice(0, -1).split('\n');
  if (lines.length < 1 || lines.length > 2048 || lines.some((line) => line.length === 0)) {
    throw new Error('Work Package gate journal record count is invalid');
  }
  let previous: string | null = null;
  const events: WorkPackageGateEventV1[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index]!) as unknown;
    } catch {
      throw new Error('Work Package gate journal JSON is invalid');
    }
    assertWorkPackageGateEvent(parsed, previous);
    if (parsed.sequence !== index + 1) throw new Error('Work Package gate journal sequence is invalid');
    const prior = events.at(-1);
    if (prior && (parsed.elapsedMs < prior.elapsedMs ||
      parsed.stdoutBytes < prior.stdoutBytes || parsed.stderrBytes < prior.stderrBytes)) {
      throw new Error('Work Package gate journal progress is not monotonic');
    }
    events.push(parsed);
    previous = parsed.eventDigest;
  }
  if (lines.length !== expected.lastSequence || previous !== expected.digest) {
    throw new Error('Work Package gate journal final binding is invalid');
  }
  const kinds = events.map((event) => event.kind);
  const tail = kinds.slice(-3);
  if (kinds[0] !== 'started' || JSON.stringify(tail) !== JSON.stringify([
    'recovery', 'residue', 'completed'
  ]) ||
    kinds.filter((kind) => kind === 'started').length !== 1 ||
    kinds.filter((kind) => kind === 'recovery').length !== 1 ||
    kinds.filter((kind) => kind === 'residue').length !== 1 ||
    kinds.filter((kind) => kind === 'completed').length !== 1 ||
    kinds.filter((kind) => kind === 'deadline').length > 1 ||
    kinds.filter((kind) => kind === 'termination').length > 1 ||
    events.some((event) => ['started', 'heartbeat'].includes(event.kind)
      ? event.subjectDigest !== null
      : event.subjectDigest === null)) {
    throw new Error('Work Package gate journal event protocol is invalid');
  }
}

export function assertWorkPackageGateEvidenceBundle(input: {
  readonly evidence: unknown;
  readonly journalSource: string;
}): asserts input is {
  readonly evidence: WorkPackageGateEvidenceV1;
  readonly journalSource: string;
} {
  assertWorkPackageGateEvidence(input.evidence);
  assertWorkPackageGateJournal(input.journalSource, input.evidence.journal);
  const events = input.journalSource.trimEnd().split('\n')
    .map((line) => JSON.parse(line) as WorkPackageGateEventV1);
  const completed = events.at(-1)!;
  assertWorkPackageGateEvent(completed);
  const deadline = events.find((event) => event.kind === 'deadline');
  const termination = events.find((event) => event.kind === 'termination');
  const recovery = events.find((event) => event.kind === 'recovery')!;
  const residue = events.find((event) => event.kind === 'residue')!;
  const expectsDeadline = input.evidence.child.trigger === 'timed-out';
  const expectsTermination = input.evidence.child.termination.requested;
  const recoveryPhase = input.evidence.recovery.complete
    ? 'recovery-complete'
    : 'authority-preserved';
  const residuePhase = input.evidence.residue.after === null
    ? 'residue-unknown'
    : 'residue-census';
  if (completed.kind !== 'completed' || completed.phase !== input.evidence.status ||
    Boolean(deadline) !== expectsDeadline || deadline?.phase !== (expectsDeadline ? 'watchdog' : undefined) ||
    Boolean(termination) !== expectsTermination ||
    termination?.phase !== (expectsTermination ? 'tree-close' : undefined) ||
    recovery.phase !== recoveryPhase || residue.phase !== residuePhase ||
    deadline?.subjectDigest !== (expectsDeadline
      ? digest({
        status: input.evidence.child.status,
        trigger: input.evidence.child.trigger,
        watchdogMs: input.evidence.timeouts.watchdogMs
      })
      : undefined) ||
    termination?.subjectDigest !== (expectsTermination
      ? digest(input.evidence.child.termination)
      : undefined) ||
    recovery.subjectDigest !== digest(input.evidence.recovery) ||
    residue.subjectDigest !== digest(input.evidence.residue) ||
    completed.subjectDigest !== digest({
      status: input.evidence.status,
      child: input.evidence.child,
      repository: input.evidence.repository
    }) ||
    recovery.stdoutBytes !== input.evidence.child.stdout.bytes ||
    recovery.stderrBytes !== input.evidence.child.stderr.bytes ||
    residue.stdoutBytes !== input.evidence.child.stdout.bytes ||
    residue.stderrBytes !== input.evidence.child.stderr.bytes ||
    completed.stdoutBytes !== input.evidence.child.stdout.bytes ||
    completed.stderrBytes !== input.evidence.child.stderr.bytes) {
    throw new Error('Work Package gate evidence and journal bundle do not agree');
  }
}

/** Flushes a directory where supported; Windows Bun exposes only best-effort directory fsync. */
export async function syncWorkPackageGateDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

export async function writeWorkPackageGateJsonAtomic(
  filePath: string,
  value: unknown,
  validator?: (readback: unknown) => void
): Promise<void> {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`;
  const serialized = JSON.stringify(value);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx');
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    validator?.(JSON.parse(serialized) as unknown);
    await rename(temporaryPath, absolutePath);
    await syncWorkPackageGateDirectory(path.dirname(absolutePath));
    const readback = await readFile(absolutePath, 'utf8');
    if (readback !== serialized) throw new Error('Work Package gate atomic write readback mismatch');
    validator?.(JSON.parse(readback) as unknown);
  } catch (error) {
    throw error;
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}
