import { randomUUID } from 'node:crypto';
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

import { canonicalEquals, sha256 as canonicalSha256, digest } from './canonical-primitives.ts';
import {
  CodexDevelopmentAssertCiExecutionEnvironmentBindingV1,
  CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1
} from './ci-execution-environment.ts';

import type {
  CodexDevelopmentEvidenceCompositionPlanV1,
  CodexDevelopmentEvidenceCoverageLedgerEntryV1,
  CodexDevelopmentReusedEvidenceRecordV1
} from './ci-evidence-reuse-contract.ts';
import {
  CI_VERIFICATION_CONTRACT_REVISION,
  CodexDevelopmentBuildVerificationInputV3
} from './ci-verification-plan.ts';
import { CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION } from './ci-verification-revision.ts';

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

export function CodexDevelopmentVerificationDigest(value: unknown): string {
  return canonicalSha256(value);
}

export function CodexDevelopmentVerificationRawOutputDigest(value: string): string {
  return `sha256:${digest(value)}`;
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

export const CodexDevelopmentVerificationEvidenceSchemaV3 =
  'codex-development-verification-evidence-v3' as const;

export type CodexDevelopmentVerificationGateEvidenceV3 = CodexDevelopmentVerificationGateEvidenceV2 & {
  runtime: string;
  disposition: 'executed' | 'delta';
  coveredScopeIds: string[];
  envAllowlistRevision: string;
  envDigest: string;
};

export type CodexDevelopmentVerificationEvidenceV3 = {
  schema: typeof CodexDevelopmentVerificationEvidenceSchemaV3;
  contractRevision: typeof CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION;
  kind: 'verification';
  profile: 'quick' | 'full';
  policyId: string;
  workPackageId: string;
  headSha: string | null;
  treeSha: string | null;
  prBaseSha: string | null;
  affectedBaseSha: string | null;
  manifestPath: string;
  manifestDigest: string;
  inputDigest: string;
  argv: string[];
  status: CodexDevelopmentVerificationEvidenceStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  fullChangedFiles: string[];
  fullChangedInputDigest: string;
  fullSelectionDigest: string;
  refinedSelectionDigest: string;
  cleanState: { before: boolean | null; after: boolean | null };
  failure: { stage: string; tail: string } | null;
  gates: CodexDevelopmentVerificationGateEvidenceV3[];
  coverageLedger: CodexDevelopmentEvidenceCoverageLedgerEntryV1[];
  reusedEvidence: CodexDevelopmentReusedEvidenceRecordV1[];
  uncoveredScopes: string[];
  invalidation: { expiresAt: string; rules: string[] };
  evidenceDigest: string;
};

type CodexDevelopmentVerificationEvidenceDraftV3 = Omit<
  CodexDevelopmentVerificationEvidenceV3,
  'schema' | 'evidenceDigest'
>;

export function CodexDevelopmentFinalizeVerificationEvidenceV3(
  draft: CodexDevelopmentVerificationEvidenceDraftV3
): CodexDevelopmentVerificationEvidenceV3 {
  const withoutDigest = {
    schema: CodexDevelopmentVerificationEvidenceSchemaV3,
    ...draft
  };
  return {
    ...withoutDigest,
    evidenceDigest: CodexDevelopmentVerificationDigest(withoutDigest)
  };
}

function assertNullableString(value: unknown, label: string): asserts value is string | null {
  if (value !== null) assertString(value, label);
}

function assertCanonicalStringSet(value: unknown, label: string): asserts value is string[] {
  assertStringArray(value, label);
  const sorted = [...value].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (new Set(value).size !== value.length || !canonicalEquals(value, sorted)) {
    throw new Error(`${label} must be unique and canonically ordered.`);
  }
}

function assertGateV3(value: unknown, index: number): asserts value is CodexDevelopmentVerificationGateEvidenceV3 {
  const label = `verification V3 gates[${index}]`;
  assertObject(value, label);
  assertExactKeys(value, [
    'id', 'argv', 'status', 'exitCode', 'startedAt', 'finishedAt', 'durationMs', 'failureTail', 'rawOutputDigest',
    'notRunReason', 'runtime', 'disposition', 'coveredScopeIds', 'envAllowlistRevision', 'envDigest'
  ], label);
  const base = {
    id: value.id,
    argv: value.argv,
    status: value.status,
    exitCode: value.exitCode,
    startedAt: value.startedAt,
    finishedAt: value.finishedAt,
    durationMs: value.durationMs,
    failureTail: value.failureTail,
    rawOutputDigest: value.rawOutputDigest,
    notRunReason: value.notRunReason
  };
  assertGate(base, index);
  assertString(value.runtime, `${label}.runtime`);
  if (value.disposition !== 'executed' && value.disposition !== 'delta') {
    throw new Error(`${label}.disposition is invalid.`);
  }
  assertStringArray(value.coveredScopeIds, `${label}.coveredScopeIds`);
  if (value.coveredScopeIds.length === 0 || new Set(value.coveredScopeIds).size !== value.coveredScopeIds.length) {
    throw new Error(`${label}.coveredScopeIds must be non-empty and unique.`);
  }
  assertString(value.envAllowlistRevision, `${label}.envAllowlistRevision`);
  assertDigest(value.envDigest, `${label}.envDigest`);
  CodexDevelopmentAssertCiExecutionEnvironmentBindingV1({
    allowlistRevision: value.envAllowlistRevision as typeof CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1,
    digest: value.envDigest as string
  });
}

function assertCoverageEntry(
  value: unknown,
  index: number
): asserts value is CodexDevelopmentEvidenceCoverageLedgerEntryV1 {
  const label = `verification V3 coverageLedger[${index}]`;
  assertObject(value, label);
  assertExactKeys(value, ['scopeId', 'inventoryDigest', 'disposition', 'evidenceIdentity', 'gateId'], label);
  assertString(value.scopeId, `${label}.scopeId`);
  assertDigest(value.inventoryDigest, `${label}.inventoryDigest`);
  assertNullableString(value.evidenceIdentity, `${label}.evidenceIdentity`);
  assertNullableString(value.gateId, `${label}.gateId`);
  if (!['executed', 'reused', 'delta'].includes(String(value.disposition))) {
    throw new Error(`${label}.disposition is invalid.`);
  }
  if (value.disposition === 'executed' && (value.evidenceIdentity !== null || value.gateId === null)) {
    throw new Error(`${label} executed disposition must bind only gateId.`);
  }
  if (value.disposition === 'reused' && (value.evidenceIdentity === null || value.gateId !== null)) {
    throw new Error(`${label} reused disposition must bind only evidenceIdentity.`);
  }
  if (value.disposition === 'delta' && (value.evidenceIdentity === null || value.gateId === null)) {
    throw new Error(`${label} delta disposition must bind evidenceIdentity and gateId.`);
  }
}

function assertReuseRecord(value: unknown, index: number): asserts value is CodexDevelopmentReusedEvidenceRecordV1 {
  const label = `verification V3 reusedEvidence[${index}]`;
  assertObject(value, label);
  assertExactKeys(value, [
    'policyId', 'evidenceIdentity', 'evidencePath', 'evidenceDigest', 'evidenceBlobSha', 'evidenceMode',
    'evidenceType', 'environmentBinding', 'scopeBinding', 'expandable', 'assignmentDigest', 'inventoryDigest',
    'baselineArgvDigest', 'gitBlobClosureDigest', 'testedHead', 'testedTree'
  ], label);
  assertString(value.policyId, `${label}.policyId`);
  assertString(value.evidenceIdentity, `${label}.evidenceIdentity`);
  assertString(value.evidencePath, `${label}.evidencePath`);
  assertDigest(value.evidenceDigest, `${label}.evidenceDigest`);
  assertNullableSha(value.evidenceBlobSha, `${label}.evidenceBlobSha`);
  if (value.evidenceBlobSha === null) throw new Error(`${label}.evidenceBlobSha cannot be null.`);
  if (value.evidenceMode !== '100644' && value.evidenceMode !== '100755') {
    throw new Error(`${label}.evidenceMode is invalid.`);
  }
  if (value.evidenceType !== 'blob') throw new Error(`${label}.evidenceType is invalid.`);
  if (
    value.environmentBinding !== 'legacy-unbound-v1'
    || value.scopeBinding !== 'base-policy-exact-v1'
    || value.expandable !== false
  ) throw new Error(`${label} legacy reuse boundary is invalid.`);
  for (const key of [
    'assignmentDigest', 'inventoryDigest', 'baselineArgvDigest', 'gitBlobClosureDigest'
  ] as const) assertDigest(value[key], `${label}.${key}`);
  assertNullableSha(value.testedHead, `${label}.testedHead`);
  assertNullableSha(value.testedTree, `${label}.testedTree`);
  if (value.testedHead === null || value.testedTree === null) throw new Error(`${label} tested identity cannot be null.`);
}

export function CodexDevelopmentAssertVerificationEvidenceV3(
  value: unknown,
  expected: Partial<Pick<
    CodexDevelopmentVerificationEvidenceV3,
    'profile' | 'policyId' | 'workPackageId' | 'headSha' | 'treeSha' | 'prBaseSha' | 'affectedBaseSha'
    | 'manifestPath' | 'manifestDigest'
  >> & { plan?: CodexDevelopmentEvidenceCompositionPlanV1 } = {},
  now = new Date()
): asserts value is CodexDevelopmentVerificationEvidenceV3 {
  assertObject(value, 'verification V3 evidence');
  assertExactKeys(value, [
    'schema', 'contractRevision', 'kind', 'profile', 'policyId', 'workPackageId', 'headSha', 'treeSha', 'prBaseSha',
    'affectedBaseSha', 'manifestPath', 'manifestDigest', 'inputDigest', 'argv', 'status', 'startedAt', 'finishedAt',
    'durationMs', 'fullChangedFiles', 'fullChangedInputDigest', 'fullSelectionDigest', 'refinedSelectionDigest', 'cleanState', 'failure', 'gates', 'coverageLedger',
    'reusedEvidence', 'uncoveredScopes', 'invalidation', 'evidenceDigest'
  ], 'verification V3 evidence');
  if (value.schema !== CodexDevelopmentVerificationEvidenceSchemaV3) throw new Error('Verification V3 evidence schema mismatch.');
  if (value.contractRevision !== CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION) {
    throw new Error('Verification V3 evidence CI revision mismatch.');
  }
  if (value.kind !== 'verification') throw new Error('Verification V3 evidence kind is invalid.');
  if (value.profile !== 'quick' && value.profile !== 'full') throw new Error('Verification V3 evidence profile is invalid.');
  assertString(value.policyId, 'verification V3 evidence policyId');
  assertString(value.workPackageId, 'verification V3 evidence workPackageId');
  assertNullableSha(value.headSha, 'verification V3 evidence headSha');
  assertNullableSha(value.treeSha, 'verification V3 evidence treeSha');
  assertNullableSha(value.prBaseSha, 'verification V3 evidence prBaseSha');
  assertNullableSha(value.affectedBaseSha, 'verification V3 evidence affectedBaseSha');
  assertString(value.manifestPath, 'verification V3 evidence manifestPath');
  assertDigest(value.manifestDigest, 'verification V3 evidence manifestDigest');
  assertDigest(value.inputDigest, 'verification V3 evidence inputDigest');
  assertStringArray(value.argv, 'verification V3 evidence argv');
  if (!['passed', 'failed', 'not-run'].includes(String(value.status))) throw new Error('Verification V3 evidence status is invalid.');
  assertIsoDate(value.startedAt, 'verification V3 evidence startedAt');
  assertIsoDate(value.finishedAt, 'verification V3 evidence finishedAt');
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 0) {
    throw new Error('Verification V3 evidence durationMs is invalid.');
  }
  assertCanonicalStringSet(value.fullChangedFiles, 'verification V3 evidence fullChangedFiles');
  assertDigest(value.fullChangedInputDigest, 'verification V3 evidence fullChangedInputDigest');
  assertDigest(value.fullSelectionDigest, 'verification V3 evidence fullSelectionDigest');
  assertDigest(value.refinedSelectionDigest, 'verification V3 evidence refinedSelectionDigest');
  assertObject(value.cleanState, 'verification V3 evidence cleanState');
  assertExactKeys(value.cleanState, ['before', 'after'], 'verification V3 evidence cleanState');
  if (![true, false, null].includes(value.cleanState.before as boolean | null)) throw new Error('Verification V3 cleanState.before is invalid.');
  if (![true, false, null].includes(value.cleanState.after as boolean | null)) throw new Error('Verification V3 cleanState.after is invalid.');
  if (value.failure !== null) {
    assertObject(value.failure, 'verification V3 evidence failure');
    assertExactKeys(value.failure, ['stage', 'tail'], 'verification V3 evidence failure');
    assertString(value.failure.stage, 'verification V3 evidence failure.stage');
    assertText(value.failure.tail, 'verification V3 evidence failure.tail');
  }
  if (!Array.isArray(value.gates)) throw new Error('Verification V3 evidence gates must be an array.');
  value.gates.forEach(assertGateV3);
  if (!Array.isArray(value.coverageLedger)) throw new Error('Verification V3 coverageLedger must be an array.');
  value.coverageLedger.forEach(assertCoverageEntry);
  const ledger = value.coverageLedger as CodexDevelopmentEvidenceCoverageLedgerEntryV1[];
  if (new Set(ledger.map((entry) => entry.scopeId)).size !== ledger.length) {
    throw new Error('Verification V3 coverageLedger scope IDs must be unique.');
  }
  if (!Array.isArray(value.reusedEvidence)) throw new Error('Verification V3 reusedEvidence must be an array.');
  value.reusedEvidence.forEach(assertReuseRecord);
  const reusedEvidence = value.reusedEvidence as CodexDevelopmentReusedEvidenceRecordV1[];
  if (reusedEvidence.some((record) => record.policyId !== value.policyId)) {
    throw new Error('Verification V3 reusedEvidence policy ID mismatch.');
  }
  const reusedEvidenceIdentities = reusedEvidence.map((record) => record.evidenceIdentity);
  const canonicalReusedEvidenceIdentities = [...reusedEvidenceIdentities]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (
    new Set(reusedEvidenceIdentities).size !== reusedEvidenceIdentities.length
    || !canonicalEquals(reusedEvidenceIdentities, canonicalReusedEvidenceIdentities)
  ) throw new Error('Verification V3 reusedEvidence identities must be unique and canonically ordered.');
  const ledgerEvidenceIdentities = [...new Set(ledger.flatMap((entry) => (
    entry.evidenceIdentity === null ? [] : [entry.evidenceIdentity]
  )))].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (!canonicalEquals(reusedEvidenceIdentities, ledgerEvidenceIdentities)) {
    throw new Error('Verification V3 coverageLedger and reusedEvidence identities do not close the same set.');
  }
  assertCanonicalStringSet(value.uncoveredScopes, 'verification V3 uncoveredScopes');
  assertObject(value.invalidation, 'verification V3 evidence invalidation');
  assertExactKeys(value.invalidation, ['expiresAt', 'rules'], 'verification V3 evidence invalidation');
  assertIsoDate(value.invalidation.expiresAt, 'verification V3 evidence invalidation.expiresAt');
  assertStringArray(value.invalidation.rules, 'verification V3 evidence invalidation.rules');
  if (new Date(value.invalidation.expiresAt).getTime() <= now.getTime()) throw new Error('Verification V3 evidence has expired.');
  assertDigest(value.evidenceDigest, 'verification V3 evidence evidenceDigest');

  const gates = value.gates as CodexDevelopmentVerificationGateEvidenceV3[];
  const gateIds = gates.map((gate) => gate.id);
  if (new Set(gateIds).size !== gateIds.length) throw new Error('Verification V3 gate IDs must be unique.');
  const coveredGateIds = new Set(ledger.flatMap((entry) => entry.gateId === null ? [] : [entry.gateId]));
  if (gateIds.some((gateId) => !coveredGateIds.has(gateId)) || [...coveredGateIds].some((gateId) => !gateIds.includes(gateId))) {
    throw new Error('Verification V3 gates and coverageLedger do not close the same gate set.');
  }
  for (const gate of gates) {
    const expectedLedger = ledger.filter((entry) => entry.gateId === gate.id);
    const expectedScopes = expectedLedger.map((entry) => entry.scopeId);
    if (!canonicalEquals(gate.coveredScopeIds, expectedScopes)) {
      throw new Error(`Verification V3 gate ${gate.id} covered scopes mismatch.`);
    }
    if (expectedLedger.some((entry) => entry.disposition !== gate.disposition)) {
      throw new Error(`Verification V3 gate ${gate.id} disposition mismatch.`);
    }
  }
  if (value.status === 'passed') {
    if (
      value.failure !== null || value.cleanState.before !== true || value.cleanState.after !== true
      || value.uncoveredScopes.length !== 0 || ledger.length === 0 || gates.some((gate) => gate.status !== 'passed')
      || value.headSha === null || value.treeSha === null || value.prBaseSha === null || value.affectedBaseSha === null
    ) throw new Error('Passed verification V3 evidence has incomplete or inconsistent proof.');
  } else if (value.status === 'failed' && value.failure === null) {
    throw new Error('Failed verification V3 evidence requires failure details.');
  }
  const { plan: expectedPlan, ...expectedFields } = expected;
  for (const [key, expectedValue] of Object.entries(expectedFields)) {
    if (value[key] !== expectedValue) throw new Error(`Verification V3 evidence ${key} mismatch.`);
  }
  if (expectedPlan) {
    const expectedGates = expectedPlan.gates.map((gate) => ({
      id: gate.gateId,
      runtime: gate.runtime,
      argv: gate.argv,
      envAllowlistRevision: gate.envAllowlistRevision,
      envDigest: gate.envDigest,
      disposition: gate.disposition,
      coveredScopeIds: gate.coveredScopeIds
    }));
    const actualGates = gates.map((gate) => ({
      id: gate.id,
      runtime: gate.runtime,
      argv: gate.argv,
      envAllowlistRevision: gate.envAllowlistRevision,
      envDigest: gate.envDigest,
      disposition: gate.disposition,
      coveredScopeIds: gate.coveredScopeIds
    }));
    if (
      value.policyId !== expectedPlan.policyId
      || value.profile !== expectedPlan.requiredProfile
      || !canonicalEquals(value.fullChangedFiles, expectedPlan.fullChangedFiles)
      || value.fullChangedInputDigest !== expectedPlan.fullChangedInputDigest
      || value.fullSelectionDigest !== expectedPlan.fullSelectionDigest
      || value.refinedSelectionDigest !== expectedPlan.refinedSelectionDigest
      || !canonicalEquals(actualGates, expectedGates)
      || !canonicalEquals(ledger, expectedPlan.coverageLedger)
      || !canonicalEquals(reusedEvidence, expectedPlan.reusedEvidence)
      || !canonicalEquals(value.uncoveredScopes, expectedPlan.uncoveredScopes)
      || value.inputDigest !== CodexDevelopmentVerificationDigest(CodexDevelopmentBuildVerificationInputV3({
        headSha: value.headSha as string | null,
        treeSha: value.treeSha as string | null,
        prBaseSha: value.prBaseSha as string | null,
        affectedBaseSha: value.affectedBaseSha as string | null,
        manifestPath: value.manifestPath,
        manifestDigest: value.manifestDigest as string,
        workPackageId: value.workPackageId,
        plan: expectedPlan
      }))
    ) throw new Error('Verification V3 evidence does not match the base-recomputed composition plan.');
  }
  const { evidenceDigest, ...withoutDigest } = value;
  if (evidenceDigest !== CodexDevelopmentVerificationDigest(withoutDigest)) {
    throw new Error('Verification V3 evidence digest mismatch.');
  }
}

export function CodexDevelopmentWriteVerificationEvidenceV3Atomic(
  filePath: string,
  evidence: CodexDevelopmentVerificationEvidenceV3
): void {
  CodexDevelopmentAssertVerificationEvidenceV3(evidence, {}, new Date(evidence.startedAt));
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
    renameSync(temporaryPath, absolutePath);
    if (readFileSync(absolutePath, 'utf8') !== serialized) throw new Error('Verification V3 evidence readback bytes mismatch.');
  } catch (error) {
    rmSync(absolutePath, { force: true });
    throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}
