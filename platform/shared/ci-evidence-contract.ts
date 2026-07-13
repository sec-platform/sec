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

import { CI_VERIFICATION_CONTRACT_REVISION } from './ci-verification-plan.ts';

export const CodexDevelopmentVerificationEvidenceSchemaV2 = 'codex-development-verification-evidence-v2' as const;
export const CodexDevelopmentVerificationArtifactRetentionDays = 90 as const;

export type CodexDevelopmentVerificationEvidenceStatus = 'passed' | 'failed' | 'not-run';
export type CodexDevelopmentVerificationProfile = 'quick' | 'risk' | 'full';

export type CodexDevelopmentVerificationGateEvidenceV2 = {
  id: string;
  argv: string[];
  status: CodexDevelopmentVerificationEvidenceStatus;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  failureTail: string | null;
  rawOutputDigest: string | null;
  notRunReason: string | null;
};

export type CodexDevelopmentVerificationEvidenceV2 = {
  schema: typeof CodexDevelopmentVerificationEvidenceSchemaV2;
  contractRevision: typeof CI_VERIFICATION_CONTRACT_REVISION;
  kind: 'verification' | 'risk';
  profile: CodexDevelopmentVerificationProfile;
  headSha: string | null;
  treeSha: string | null;
  prBaseSha: string | null;
  affectedBaseSha: string | null;
  manifestPath: string | null;
  manifestDigest: string | null;
  inputDigest: string;
  argv: string[];
  status: CodexDevelopmentVerificationEvidenceStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  changedFiles: string[] | null;
  selectionResolved: boolean;
  cleanState: {
    before: boolean | null;
    after: boolean | null;
  };
  failure: {
    stage: string;
    tail: string;
  } | null;
  gates: CodexDevelopmentVerificationGateEvidenceV2[];
  invalidation: {
    expiresAt: string;
    rules: string[];
  };
  evidenceDigest: string;
};

type CodexDevelopmentVerificationEvidenceDraftV2 = Omit<
  CodexDevelopmentVerificationEvidenceV2,
  'schema' | 'evidenceDigest'
>;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalJson(value: unknown): string {
  function normalize(input: unknown): JsonValue {
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('Verification evidence cannot contain a non-finite number.');
      return input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    if (typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
          .map(([key, nested]) => [key, normalize(nested)])
      );
    }
    throw new Error(`Verification evidence cannot canonicalize ${typeof input}.`);
  }

  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function CodexDevelopmentVerificationDigest(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function CodexDevelopmentVerificationRawOutputDigest(value: string): string {
  return sha256(value);
}

export function CodexDevelopmentFinalizeVerificationEvidenceV2(
  draft: CodexDevelopmentVerificationEvidenceDraftV2
): CodexDevelopmentVerificationEvidenceV2 {
  const withoutDigest = {
    schema: CodexDevelopmentVerificationEvidenceSchemaV2,
    ...draft
  };
  return {
    ...withoutDigest,
    evidenceDigest: CodexDevelopmentVerificationDigest(withoutDigest)
  };
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`${label} has unknown or missing fields: ${actual.join(', ')}.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${label} must be a non-empty control-character-free string.`);
  }
}

function assertText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`${label} must be non-empty text without NUL characters.`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  value.forEach((entry, index) => assertString(entry, `${label}[${index}]`));
}

function assertNullableSha(value: unknown, label: string): void {
  if (value !== null && (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value))) {
    throw new Error(`${label} must be null or a lowercase 40-character Git SHA.`);
  }
}

function assertDigest(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 digest.`);
  }
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp.`);
}

function assertGate(value: unknown, index: number): asserts value is CodexDevelopmentVerificationGateEvidenceV2 {
  const label = `verification evidence gates[${index}]`;
  assertObject(value, label);
  assertExactKeys(value, [
    'id', 'argv', 'status', 'exitCode', 'startedAt', 'finishedAt', 'durationMs', 'failureTail', 'rawOutputDigest',
    'notRunReason'
  ], label);
  assertString(value.id, `${label}.id`);
  assertStringArray(value.argv, `${label}.argv`);
  if (!['passed', 'failed', 'not-run'].includes(String(value.status))) throw new Error(`${label}.status is invalid.`);
  if (value.status === 'not-run') {
    for (const key of ['exitCode', 'startedAt', 'finishedAt', 'durationMs', 'failureTail', 'rawOutputDigest'] as const) {
      if (value[key] !== null) throw new Error(`${label}.${key} must be null when the gate was not run.`);
    }
    assertText(value.notRunReason, `${label}.notRunReason`);
    return;
  }
  if (value.notRunReason !== null) throw new Error(`${label}.notRunReason must be null after execution.`);
  if (!Number.isInteger(value.exitCode) || (value.exitCode as number) < 0) throw new Error(`${label}.exitCode is invalid.`);
  assertIsoDate(value.startedAt, `${label}.startedAt`);
  assertIsoDate(value.finishedAt, `${label}.finishedAt`);
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0) throw new Error(`${label}.durationMs is invalid.`);
  assertDigest(value.rawOutputDigest, `${label}.rawOutputDigest`);
  if (value.status === 'passed') {
    if (value.exitCode !== 0 || value.failureTail !== null) throw new Error(`${label} passed state is inconsistent.`);
  } else {
    if (value.exitCode === 0) throw new Error(`${label} failed state requires a non-zero exit code.`);
    assertText(value.failureTail, `${label}.failureTail`);
  }
}

export function CodexDevelopmentAssertVerificationEvidenceV2(
  value: unknown,
  expected: Partial<Pick<
    CodexDevelopmentVerificationEvidenceV2,
    'kind' | 'profile' | 'headSha' | 'treeSha' | 'prBaseSha' | 'affectedBaseSha'
    | 'manifestPath' | 'manifestDigest' | 'contractRevision'
  >> = {},
  now = new Date()
): asserts value is CodexDevelopmentVerificationEvidenceV2 {
  assertObject(value, 'verification evidence');
  assertExactKeys(value, [
    'schema', 'contractRevision', 'kind', 'profile', 'headSha', 'treeSha', 'prBaseSha', 'affectedBaseSha',
    'manifestPath', 'manifestDigest',
    'inputDigest', 'argv', 'status', 'startedAt', 'finishedAt', 'durationMs', 'changedFiles', 'selectionResolved',
    'cleanState', 'failure', 'gates', 'invalidation', 'evidenceDigest'
  ], 'verification evidence');
  if (value.schema !== CodexDevelopmentVerificationEvidenceSchemaV2) throw new Error('Verification evidence schema mismatch.');
  if (value.contractRevision !== CI_VERIFICATION_CONTRACT_REVISION) throw new Error('Verification evidence CI revision mismatch.');
  if (!['verification', 'risk'].includes(String(value.kind))) throw new Error('Verification evidence kind is invalid.');
  if (!['quick', 'risk', 'full'].includes(String(value.profile))) throw new Error('Verification evidence profile is invalid.');
  assertNullableSha(value.headSha, 'verification evidence headSha');
  assertNullableSha(value.treeSha, 'verification evidence treeSha');
  assertNullableSha(value.prBaseSha, 'verification evidence prBaseSha');
  assertNullableSha(value.affectedBaseSha, 'verification evidence affectedBaseSha');
  if (value.manifestPath !== null) assertString(value.manifestPath, 'verification evidence manifestPath');
  if (value.manifestDigest !== null) assertDigest(value.manifestDigest, 'verification evidence manifestDigest');
  if ((value.manifestPath === null) !== (value.manifestDigest === null)) {
    throw new Error('Verification evidence manifest path and digest must both be present or both be null.');
  }
  assertDigest(value.inputDigest, 'verification evidence inputDigest');
  assertStringArray(value.argv, 'verification evidence argv');
  if (!['passed', 'failed', 'not-run'].includes(String(value.status))) throw new Error('Verification evidence status is invalid.');
  assertIsoDate(value.startedAt, 'verification evidence startedAt');
  assertIsoDate(value.finishedAt, 'verification evidence finishedAt');
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0) throw new Error('Verification evidence durationMs is invalid.');
  if (value.changedFiles !== null) assertStringArray(value.changedFiles, 'verification evidence changedFiles');
  if (typeof value.selectionResolved !== 'boolean') throw new Error('Verification evidence selectionResolved must be boolean.');
  assertObject(value.cleanState, 'verification evidence cleanState');
  assertExactKeys(value.cleanState, ['before', 'after'], 'verification evidence cleanState');
  if (![true, false, null].includes(value.cleanState.before as boolean | null)) throw new Error('Verification evidence cleanState.before is invalid.');
  if (![true, false, null].includes(value.cleanState.after as boolean | null)) throw new Error('Verification evidence cleanState.after is invalid.');
  if (value.failure !== null) {
    assertObject(value.failure, 'verification evidence failure');
    assertExactKeys(value.failure, ['stage', 'tail'], 'verification evidence failure');
    assertString(value.failure.stage, 'verification evidence failure.stage');
    assertText(value.failure.tail, 'verification evidence failure.tail');
  }
  if (!Array.isArray(value.gates)) throw new Error('Verification evidence gates must be an array.');
  value.gates.forEach(assertGate);
  const gateIds = (value.gates as CodexDevelopmentVerificationGateEvidenceV2[]).map((gate) => gate.id);
  if (new Set(gateIds).size !== gateIds.length) throw new Error('Verification evidence gate IDs must be unique.');
  assertObject(value.invalidation, 'verification evidence invalidation');
  assertExactKeys(value.invalidation, ['expiresAt', 'rules'], 'verification evidence invalidation');
  assertIsoDate(value.invalidation.expiresAt, 'verification evidence invalidation.expiresAt');
  assertStringArray(value.invalidation.rules, 'verification evidence invalidation.rules');
  if (new Date(value.invalidation.expiresAt).getTime() <= now.getTime()) throw new Error('Verification evidence has expired.');
  assertDigest(value.evidenceDigest, 'verification evidence evidenceDigest');

  if (value.status === 'passed') {
    if (
      value.failure !== null
      || value.selectionResolved !== true
      || value.cleanState.before !== true
      || value.cleanState.after !== true
      || (value.gates as CodexDevelopmentVerificationGateEvidenceV2[]).some((gate) => gate.status !== 'passed')
    ) {
      throw new Error('Passed verification evidence has incomplete or inconsistent proof.');
    }
  } else if (value.status === 'failed' && value.failure === null) {
    throw new Error('Failed verification evidence requires failure details.');
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) throw new Error(`Verification evidence ${key} mismatch.`);
  }
  const { evidenceDigest, ...withoutDigest } = value;
  if (evidenceDigest !== CodexDevelopmentVerificationDigest(withoutDigest)) {
    throw new Error('Verification evidence digest mismatch.');
  }
}

export function CodexDevelopmentWriteVerificationEvidenceAtomic(
  filePath: string,
  evidence: CodexDevelopmentVerificationEvidenceV2
): void {
  CodexDevelopmentAssertVerificationEvidenceV2(evidence, {}, new Date(evidence.startedAt));
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  rmSync(absolutePath, { force: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    const serialized = JSON.stringify(evidence);
    descriptor = openSync(temporaryPath, 'wx');
    writeFileSync(descriptor, serialized, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    rmSync(absolutePath, { force: true });
    renameSync(temporaryPath, absolutePath);
    const readback = readFileSync(absolutePath, 'utf8');
    if (readback !== serialized) throw new Error('Verification evidence atomic write readback bytes mismatch.');
    const parsed = JSON.parse(readback) as unknown;
    CodexDevelopmentAssertVerificationEvidenceV2(parsed, {}, new Date(evidence.startedAt));
    if ((parsed as CodexDevelopmentVerificationEvidenceV2).evidenceDigest !== evidence.evidenceDigest) {
      throw new Error('Verification evidence atomic write readback digest mismatch.');
    }
  } catch (error) {
    rmSync(absolutePath, { force: true });
    throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

export function CodexDevelopmentPrepareVerificationEvidenceTarget(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  rmSync(absolutePath, { force: true });
  return absolutePath;
}
