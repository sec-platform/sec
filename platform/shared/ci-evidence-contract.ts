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
import {
  CodexDevelopmentReduceHostedSutObservationV1,
  type CodexDevelopmentHostedSutExecutionProofV1
} from './ci-hosted-sut-observation-contract.ts';

import type {
  CodexDevelopmentEvidenceCompositionPlanV1,
  CodexDevelopmentEvidenceCoverageLedgerEntryV1,
  CodexDevelopmentReusedEvidenceRecordV1
} from './ci-evidence-reuse-contract.ts';
import {
  CI_VERIFICATION_CONTRACT_REVISION,
  CodexDevelopmentBuildVerificationInputV3
} from './ci-verification-plan.ts';
import {
  CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1,
  CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA_V2,
  CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION
} from './ci-verification-revision.ts';
import {
  parseMainHealthLedgerV1,
  resolveMainHealthLaneV1,
  type MainHealthLedgerV1
} from './main-health-contract.ts';
import {
  assertReviewStabilityReceiptCurrentV1,
  parseReviewStabilityReceiptV1,
  type ReviewStabilityReceiptV1
} from './review-stability-contract.ts';
import {
  assertScopeAuthorizationCurrentV1,
  parseScopeAuthorizationV1,
  type ScopeAuthorizationV1
} from './scope-authorization-contract.ts';
import {
  assertCiVerificationActionPlanClosureEqualV1,
  CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
  parseCiVerificationActionPlanClosureV1,
  parseCiVerificationNormalizedOperationV2,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationExecutionEnvironmentV2,
  type CiVerificationNormalizedOperationV2
} from './verification-action-ci-contract.ts';
import {
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  parseVerificationActionKeyV2,
  parseVerificationActionPlanV2,
  type VerificationActionKeyV2,
  type VerificationActionPlanV2,
  type VerificationActionTerminalV2
} from './verification-action-contract.ts';
import {
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE_V2,
  verificationActionProviderTerminalArtifactNameV2,
  type VerificationActionProviderOriginV2
} from './verification-action-provider-contract.ts';
import {
  CodexDevelopmentAssertVerificationGateResultV1,
  type VerificationGateResultV1,
  type VerificationResultStatus
} from './verification-result-contract.ts';
import { parseVerificationSessionV2, type VerificationSessionV2 } from './verification-session-contract.ts';

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

export const CodexDevelopmentVerificationEvidenceSchemaV4 =
  'codex-development-verification-evidence-v4' as const;

export type CodexDevelopmentVerificationCleanupV4 = Readonly<{
  status: 'passed' | 'failed' | 'not-required';
  evidenceRefs: readonly string[];
  diagnostic: string | null;
}>;

export type CodexDevelopmentVerificationGateEvidenceV4 = Readonly<{
  action: VerificationActionKeyV2;
  result: VerificationGateResultV1;
  cleanup: CodexDevelopmentVerificationCleanupV4;
}>;

export type CodexDevelopmentVerificationEvidenceProducerV4 = Readonly<{
  sourceTransport: 'github-actions' | 'local-dev-runner';
  workflowPath: string;
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  actorNodeId: string;
  sourceDigest: string;
}>;

export type CodexDevelopmentVerificationEvidenceV4 = Readonly<{
  schema: typeof CodexDevelopmentVerificationEvidenceSchemaV4;
  contractRevision: typeof CI_VERIFICATION_CONTRACT_REVISION;
  sessionRevision: string;
  sessionProposalDigest: string;
  scopeAuthorizationRevision: string;
  scopeAuthorizationDigest: string;
  reviewReceiptDigest: string;
  mainHealthRevision: string;
  mainHealthDigest: string;
  trustRevision: string;
  profile: 'quick' | 'full';
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  producer: CodexDevelopmentVerificationEvidenceProducerV4;
  actionPlan: CiVerificationActionPlanClosureV1;
  status: VerificationResultStatus;
  startedAt: string;
  finishedAt: string;
  gates: readonly CodexDevelopmentVerificationGateEvidenceV4[];
  evidenceRefs: readonly string[];
  invalidationRules: readonly string[];
  evidenceDigest: string;
}>;

type CodexDevelopmentVerificationEvidenceDraftV4 = Omit<
  CodexDevelopmentVerificationEvidenceV4,
  'schema' | 'evidenceDigest'
>;

const V4_STATUS_PRIORITY: Readonly<Record<VerificationResultStatus, number>> = Object.freeze({
  passed: 0,
  'not-run': 1,
  unsupported: 2,
  invalidated: 3,
  failed: 4
});

export function CodexDevelopmentCreateVerificationEvidenceProducerV4(input: Omit<
  CodexDevelopmentVerificationEvidenceProducerV4,
  'sourceDigest'
>): CodexDevelopmentVerificationEvidenceProducerV4 {
  if (input.sourceTransport !== 'github-actions' && input.sourceTransport !== 'local-dev-runner') {
    throw new Error('Verification V4 producer transport is invalid.');
  }
  for (const [key, value] of Object.entries({
    workflowPath: input.workflowPath, workflowRef: input.workflowRef, workflowSha: input.workflowSha,
    runId: input.runId, actorNodeId: input.actorNodeId
  })) assertString(value, `Verification V4 producer ${key}`);
  if (!/^[0-9a-f]{40}$/u.test(input.workflowSha)) throw new Error('Verification V4 producer workflowSha is invalid.');
  if (!Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1) throw new Error('Verification V4 producer runAttempt is invalid.');
  if (input.sourceTransport === 'github-actions' && (
    input.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
    input.workflowRef !== `${input.workflowPath}@${input.workflowSha}`
  )) throw new Error('Verification V4 GitHub producer does not bind the canonical trusted workflow ref.');
  const withoutDigest = Object.freeze({ ...input });
  return Object.freeze({ ...withoutDigest, sourceDigest: CodexDevelopmentVerificationDigest(withoutDigest) });
}

export function aggregateV4Status(
  gates: readonly CodexDevelopmentVerificationGateEvidenceV4[]
): VerificationResultStatus {
  if (gates.some((gate) => gate.cleanup.status === 'failed')) return 'failed';
  return gates.reduce<VerificationResultStatus>((current, gate) => (
    V4_STATUS_PRIORITY[gate.result.status] > V4_STATUS_PRIORITY[current]
      ? gate.result.status
      : current
  ), 'passed');
}

export function CodexDevelopmentFinalizeVerificationEvidenceV4(
  draft: CodexDevelopmentVerificationEvidenceDraftV4
): CodexDevelopmentVerificationEvidenceV4 {
  const withoutDigest = {
    schema: CodexDevelopmentVerificationEvidenceSchemaV4,
    ...draft
  };
  const evidence = Object.freeze({
    ...withoutDigest,
    evidenceDigest: CodexDevelopmentVerificationDigest(withoutDigest)
  });
  CodexDevelopmentAssertVerificationEvidenceV4(evidence, {
    actionPlan: draft.actionPlan
  }, new Date(draft.startedAt));
  return evidence;
}

function assertV4Cleanup(value: unknown, label: string): asserts value is CodexDevelopmentVerificationCleanupV4 {
  assertObject(value, label);
  assertExactKeys(value, ['status', 'evidenceRefs', 'diagnostic'], label);
  if (value.status !== 'passed' && value.status !== 'failed' && value.status !== 'not-required') {
    throw new Error(`${label}.status is invalid.`);
  }
  assertStringArray(value.evidenceRefs, `${label}.evidenceRefs`);
  if (value.diagnostic !== null) assertText(value.diagnostic, `${label}.diagnostic`);
  if (value.status === 'failed' && value.diagnostic === null) {
    throw new Error(`${label} failed cleanup requires a diagnostic.`);
  }
}

export function CodexDevelopmentAssertVerificationEvidenceV4(
  value: unknown,
  expected: Partial<Pick<
    CodexDevelopmentVerificationEvidenceV4,
    'contractRevision' | 'sessionRevision' | 'sessionProposalDigest' | 'scopeAuthorizationRevision' | 'scopeAuthorizationDigest'
    | 'reviewReceiptDigest' | 'mainHealthRevision' | 'mainHealthDigest' | 'trustRevision' | 'profile'
    | 'baseSha' | 'baseTreeSha' | 'headSha' | 'headTreeSha' | 'manifestPath' | 'manifestDigest'
  >> & { readonly actionPlan?: CiVerificationActionPlanClosureV1 } = {},
  now = new Date()
): asserts value is CodexDevelopmentVerificationEvidenceV4 {
  assertObject(value, 'Verification V4 evidence');
  if (value.schema !== CodexDevelopmentVerificationEvidenceSchemaV4) {
    throw new Error('Verification V4 evidence schema mismatch; V2/V3 are legacy readers and cannot be promoted.');
  }
  assertExactKeys(value, [
    'schema', 'contractRevision', 'sessionRevision', 'sessionProposalDigest', 'scopeAuthorizationRevision', 'scopeAuthorizationDigest',
    'reviewReceiptDigest', 'mainHealthRevision', 'mainHealthDigest', 'trustRevision', 'profile', 'baseSha', 'baseTreeSha',
    'headSha', 'headTreeSha', 'manifestPath', 'manifestDigest', 'producer', 'actionPlan', 'status', 'startedAt',
    'finishedAt', 'gates', 'evidenceRefs', 'invalidationRules', 'evidenceDigest'
  ], 'Verification V4 evidence');
  if (value.contractRevision !== CI_VERIFICATION_CONTRACT_REVISION) {
    throw new Error('Verification V4 evidence CI revision mismatch.');
  }
  for (const key of ['sessionRevision', 'manifestPath'] as const) assertString(value[key], `Verification V4 evidence ${key}`);
  for (const key of [
    'sessionProposalDigest', 'scopeAuthorizationRevision', 'scopeAuthorizationDigest', 'reviewReceiptDigest',
    'mainHealthRevision', 'mainHealthDigest', 'manifestDigest',
    'evidenceDigest'
  ] as const) assertDigest(value[key], `Verification V4 evidence ${key}`);
  for (const key of ['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'trustRevision'] as const) {
    if (typeof value[key] !== 'string' || !/^[0-9a-f]{40}$/u.test(value[key])) {
      throw new Error(`Verification V4 evidence ${key} must be a lowercase Git SHA.`);
    }
  }
  if (value.profile !== 'quick' && value.profile !== 'full') throw new Error('Verification V4 evidence profile is invalid.');
  assertObject(value.producer, 'Verification V4 evidence producer');
  const producer = value.producer;
  assertExactKeys(producer, [
    'sourceTransport', 'workflowPath', 'workflowRef', 'workflowSha', 'runId', 'runAttempt', 'actorNodeId', 'sourceDigest'
  ], 'Verification V4 evidence producer');
  const { sourceDigest: observedSourceDigest, ...producerInput } =
    producer as unknown as CodexDevelopmentVerificationEvidenceProducerV4;
  const rebuiltProducer = CodexDevelopmentCreateVerificationEvidenceProducerV4(producerInput);
  if (rebuiltProducer.sourceDigest !== observedSourceDigest) throw new Error('Verification V4 producer digest mismatch.');
  if (!['passed', 'failed', 'not-run', 'unsupported', 'invalidated'].includes(String(value.status))) {
    throw new Error('Verification V4 evidence status is invalid.');
  }
  assertIsoDate(value.startedAt, 'Verification V4 evidence startedAt');
  assertIsoDate(value.finishedAt, 'Verification V4 evidence finishedAt');
  if (value.finishedAt < value.startedAt) throw new Error('Verification V4 evidence timestamps are inverted.');
  const actionPlan = parseCiVerificationActionPlanClosureV1(encodeVerificationActionDataV2(value.actionPlan));
  if (!Array.isArray(value.gates)) throw new Error('Verification V4 evidence gates must be an array.');
  const gates = value.gates.map((entry, index) => {
    const label = `Verification V4 evidence gates[${index}]`;
    assertObject(entry, label);
    assertExactKeys(entry, ['action', 'result', 'cleanup'], label);
    const action = parseVerificationActionKeyV2(encodeVerificationActionDataV2(entry.action));
    CodexDevelopmentAssertVerificationGateResultV1(entry.result);
    assertV4Cleanup(entry.cleanup, `${label}.cleanup`);
    const result = entry.result as VerificationGateResultV1;
    if (result.gateId !== action.operation.identity || result.inputDigest !== action.actionKey ||
        result.subjectRevision !== value.headSha) {
      throw new Error(`${label} result does not bind its canonical Action and candidate.`);
    }
    if (result.disposition === 'reused' && result.evidenceRefs.length === 0) {
      throw new Error(`${label} reused result requires an Evidence reference.`);
    }
    return { action, result, cleanup: entry.cleanup as CodexDevelopmentVerificationCleanupV4 };
  });
  if (gates.length !== actionPlan.actions.length || gates.some((gate, index) => (
    gate.action.actionKey !== actionPlan.actions[index]?.action.actionKey ||
    encodeVerificationActionDataV2(gate.action) !== encodeVerificationActionDataV2(actionPlan.actions[index]?.action)
  ))) throw new Error('Verification V4 evidence gate order/action closure mismatch.');
  if (value.status !== aggregateV4Status(gates)) {
    throw new Error('Verification V4 evidence aggregate status is inconsistent with five-state gates/cleanup.');
  }
  assertStringArray(value.evidenceRefs, 'Verification V4 evidence evidenceRefs');
  assertStringArray(value.invalidationRules, 'Verification V4 evidence invalidationRules');
  if ((value.invalidationRules as string[]).length === 0) throw new Error('Verification V4 evidence requires invalidation rules.');
  const { actionPlan: expectedActionPlan, ...expectedFields } = expected;
  for (const [key, expectedValue] of Object.entries(expectedFields)) {
    if (value[key] !== expectedValue) throw new Error(`Verification V4 evidence ${key} mismatch.`);
  }
  if (expectedActionPlan !== undefined) {
    assertCiVerificationActionPlanClosureEqualV1(actionPlan, expectedActionPlan);
  }
  const { evidenceDigest, ...withoutDigest } = value;
  if (evidenceDigest !== CodexDevelopmentVerificationDigest(withoutDigest)) {
    throw new Error('Verification V4 evidence digest mismatch.');
  }
  if (new Date(value.finishedAt).getTime() > now.getTime() + 5 * 60_000) {
    throw new Error('Verification V4 evidence timestamp is in the future.');
  }
}

export function CodexDevelopmentWriteVerificationEvidenceV4Atomic(
  filePath: string,
  evidence: CodexDevelopmentVerificationEvidenceV4
): void {
  CodexDevelopmentAssertVerificationEvidenceV4(evidence, { actionPlan: evidence.actionPlan }, new Date(evidence.finishedAt));
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  rmSync(absolutePath, { force: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    const serialized = encodeVerificationActionDataV2(evidence);
    descriptor = openSync(temporaryPath, 'wx');
    writeFileSync(descriptor, serialized, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, absolutePath);
    const readback = readFileSync(absolutePath, 'utf8');
    if (readback !== serialized) throw new Error('Verification V4 evidence readback bytes mismatch.');
    CodexDevelopmentAssertVerificationEvidenceV4(JSON.parse(readback), { actionPlan: evidence.actionPlan }, new Date(evidence.finishedAt));
  } catch (error) {
    rmSync(absolutePath, { force: true });
    throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

export type CodexDevelopmentVerificationActionArtifactInputV2 = Readonly<{
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  inputClosureDigest: string;
  candidateBytesDigest: string;
}>;

export type CodexDevelopmentVerificationActionArtifactProducerV2 = VerificationActionProviderOriginV2;

export type CodexDevelopmentVerificationActionTerminalArtifactV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA_V2;
  actionPlan: VerificationActionPlanV2;
  normalizedOperation: CiVerificationNormalizedOperationV2;
  result: VerificationGateResultV1;
  cleanup: CodexDevelopmentVerificationCleanupV4;
  executionEnvironment: CiVerificationExecutionEnvironmentV2;
  input: CodexDevelopmentVerificationActionArtifactInputV2;
  producer: CodexDevelopmentVerificationActionArtifactProducerV2;
  executionProof: CodexDevelopmentHostedSutExecutionProofV1;
  artifactDigest: string;
}>;

export function CodexDevelopmentVerificationActionArtifactNameV2(actionKey: string): string {
  assertDigest(actionKey, 'VerificationAction artifact ActionKey');
  return verificationActionProviderTerminalArtifactNameV2(actionKey as `sha256:${string}`);
}

export function CodexDevelopmentVerificationActionCandidateBytesDigestV2(input: Readonly<{
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  action: VerificationActionKeyV2;
}>): string {
  return CodexDevelopmentVerificationDigest({
    baseSha: input.baseSha,
    baseTreeSha: input.baseTreeSha,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    inputClosure: input.action.inputClosure
  });
}

export function CodexDevelopmentFinalizeVerificationActionTerminalArtifactV2(input: Omit<
  CodexDevelopmentVerificationActionTerminalArtifactV2,
  'schema' | 'artifactDigest'
>): CodexDevelopmentVerificationActionTerminalArtifactV2 {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA_V2,
    ...input
  });
  const artifact = Object.freeze({
    ...withoutDigest,
    artifactDigest: CodexDevelopmentVerificationDigest(withoutDigest)
  });
  CodexDevelopmentAssertVerificationActionTerminalArtifactV2(artifact);
  return artifact;
}

export function CodexDevelopmentAssertVerificationActionTerminalArtifactV2(
  value: unknown,
  expected: Readonly<{
    actionPlan?: VerificationActionPlanV2;
    executionEnvironmentRevision?: string;
  }> = {}
): asserts value is CodexDevelopmentVerificationActionTerminalArtifactV2 {
  assertObject(value, 'VerificationAction terminal artifact V2');
  if (value.schema !== CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA_V2) {
    throw new Error('VerificationAction terminal artifact V2 schema mismatch.');
  }
  assertExactKeys(value, [
    'schema', 'actionPlan', 'normalizedOperation', 'result', 'cleanup', 'executionEnvironment',
    'input', 'producer', 'executionProof', 'artifactDigest'
  ], 'VerificationAction terminal artifact V2');
  const plan = parseVerificationActionPlanV2(encodeVerificationActionDataV2(value.actionPlan));
  const normalizedOperation = parseCiVerificationNormalizedOperationV2(value.normalizedOperation);
  if (normalizedOperation.gateId !== plan.action.operation.identity ||
      normalizedOperation.semanticDigest !== plan.action.operation.semanticDigest ||
      encodeVerificationActionDataV2(normalizedOperation.environmentBindings) !==
        encodeVerificationActionDataV2(plan.action.operation.declaredEnvironment)) {
    throw new Error('VerificationAction artifact normalized operation does not bind its Action member.');
  }
  CodexDevelopmentAssertVerificationGateResultV1(value.result);
  assertV4Cleanup(value.cleanup, 'VerificationAction artifact cleanup');
  const result = value.result as VerificationGateResultV1;
  if (result.gateId !== plan.action.operation.identity ||
      result.inputDigest !== plan.action.actionKey ||
      result.subjectRevision !== (value.input as Record<string, unknown>)?.headSha) {
    throw new Error('VerificationAction artifact result does not bind its Action and candidate.');
  }
  assertObject(value.executionEnvironment, 'VerificationAction artifact execution environment');
  assertExactKeys(value.executionEnvironment, [
    'contractRevision', 'kind', 'os', 'arch', 'runnerImage', 'toolchainRevision',
    'executionEnvironmentRevision'
  ], 'VerificationAction artifact execution environment');
  if (!canonicalEquals(value.executionEnvironment, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2)) {
    throw new Error('VerificationAction terminal artifact must use the canonical hosted execution environment.');
  }
  if (plan.action.environment.providerRevision !==
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2.executionEnvironmentRevision) {
    throw new Error('VerificationAction artifact ActionKey does not bind the hosted execution environment.');
  }
  const environmentBinding = plan.action.operation.declaredEnvironment.find(
    (binding) => binding.name === 'SEC_EXECUTION_ENVIRONMENT_REVISION'
  );
  if (environmentBinding?.digest !== CodexDevelopmentVerificationDigest(
    CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2.executionEnvironmentRevision
  )) {
    throw new Error('VerificationAction artifact declared environment revision is missing or forged.');
  }
  assertObject(value.input, 'VerificationAction artifact input');
  assertExactKeys(value.input, [
    'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'manifestPath', 'manifestDigest',
    'inputClosureDigest', 'candidateBytesDigest'
  ], 'VerificationAction artifact input');
  const artifactInput = value.input as unknown as CodexDevelopmentVerificationActionArtifactInputV2;
  for (const key of ['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha'] as const) {
    if (!/^[0-9a-f]{40}$/u.test(artifactInput[key])) {
      throw new Error(`VerificationAction artifact input ${key} is invalid.`);
    }
  }
  assertString(artifactInput.manifestPath, 'VerificationAction artifact manifest path');
  assertDigest(artifactInput.manifestDigest, 'VerificationAction artifact manifest digest');
  assertDigest(artifactInput.inputClosureDigest, 'VerificationAction artifact input closure digest');
  assertDigest(artifactInput.candidateBytesDigest, 'VerificationAction artifact candidate bytes digest');
  if (artifactInput.inputClosureDigest !== CodexDevelopmentVerificationDigest(plan.action.inputClosure)) {
    throw new Error('VerificationAction artifact input closure digest mismatch.');
  }
  const manifestInput = plan.action.inputClosure.find((entry) => entry.path === artifactInput.manifestPath);
  if (manifestInput?.digest !== artifactInput.manifestDigest) {
    throw new Error('VerificationAction artifact manifest is outside the canonical Action input closure.');
  }
  if (artifactInput.candidateBytesDigest !== CodexDevelopmentVerificationActionCandidateBytesDigestV2({
    ...artifactInput,
    action: plan.action
  })) throw new Error('VerificationAction artifact candidate bytes digest mismatch.');
  assertObject(value.producer, 'VerificationAction artifact producer');
  assertExactKeys(value.producer, [
    'repositoryId', 'repository', 'workflowPath', 'workflowRef', 'workflowSha', 'runId', 'runAttempt',
    'appId', 'appNodeId', 'sourceEvent'
  ], 'VerificationAction artifact producer');
  const producer = value.producer as unknown as CodexDevelopmentVerificationActionArtifactProducerV2;
  if (!Number.isSafeInteger(producer.repositoryId) || producer.repositoryId < 1 ||
      producer.appId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.id ||
      producer.appNodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app.nodeId ||
      !Number.isSafeInteger(producer.runAttempt) || producer.runAttempt < 1) {
    throw new Error('VerificationAction artifact producer numeric provenance is invalid.');
  }
  for (const [key, candidate] of Object.entries({
    repository: producer.repository,
    runId: producer.runId,
    appNodeId: producer.appNodeId
  })) assertString(candidate, `VerificationAction artifact producer ${key}`);
  if (!/^\d+$/u.test(producer.runId) || !/^[0-9a-f]{40}$/u.test(producer.workflowSha) ||
      producer.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
      producer.workflowRef !== `${producer.workflowPath}@${producer.workflowSha}` ||
      producer.workflowSha !== artifactInput.baseSha ||
      producer.sourceEvent !== 'repository_dispatch') {
    throw new Error('VerificationAction artifact producer provenance mismatch.');
  }
  assertObject(value.executionProof, 'VerificationAction artifact execution proof');
  assertExactKeys(value.executionProof, [
    'schema', 'authorization', 'observation', 'externalRawResultDigest', 'proofDigest'
  ], 'VerificationAction artifact execution proof');
  const proof = value.executionProof as unknown as CodexDevelopmentHostedSutExecutionProofV1;
  const replay = CodexDevelopmentReduceHostedSutObservationV1({
    actionPlan: plan,
    normalizedOperation,
    candidateSha: artifactInput.headSha,
    candidateBytesDigest: artifactInput.candidateBytesDigest,
    manifestPath: artifactInput.manifestPath,
    producer,
    authorization: proof.authorization,
    observation: proof.observation,
    expectedRawResultDigest: proof.externalRawResultDigest
  });
  if (!canonicalEquals(replay.proof, proof) || !canonicalEquals(replay.result, result) ||
      !canonicalEquals(replay.cleanup, value.cleanup)) {
    throw new Error('VerificationAction terminal artifact execution proof does not replay its Result and cleanup.');
  }
  if (expected.actionPlan !== undefined &&
      encodeVerificationActionDataV2(plan) !== encodeVerificationActionDataV2(expected.actionPlan)) {
    throw new Error('VerificationAction artifact plan differs from trusted reconstruction.');
  }
  if (expected.executionEnvironmentRevision !== undefined &&
      plan.action.environment.providerRevision !== expected.executionEnvironmentRevision) {
    throw new Error('VerificationAction artifact environment differs from trusted reconstruction.');
  }
  assertDigest(value.artifactDigest, 'VerificationAction artifact digest');
  const { artifactDigest, ...withoutDigest } = value;
  if (artifactDigest !== CodexDevelopmentVerificationDigest(withoutDigest)) {
    throw new Error('VerificationAction artifact digest mismatch.');
  }
}

export function CodexDevelopmentVerificationActionArtifactTerminalV2(
  artifact: CodexDevelopmentVerificationActionTerminalArtifactV2
): VerificationActionTerminalV2 {
  CodexDevelopmentAssertVerificationActionTerminalArtifactV2(artifact);
  return createVerificationActionTerminalV2({
    status: artifact.result.status,
    reasonCode: artifact.result.reasonCode,
    resultDigest: artifact.result.execution?.outputDigest ?? null
  });
}

export function CodexDevelopmentParseVerificationActionTerminalArtifactV2(
  source: string
): CodexDevelopmentVerificationActionTerminalArtifactV2 {
  const value = JSON.parse(source) as unknown;
  CodexDevelopmentAssertVerificationActionTerminalArtifactV2(value);
  return value;
}

export function CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic(
  filePath: string,
  artifact: CodexDevelopmentVerificationActionTerminalArtifactV2
): void {
  CodexDevelopmentAssertVerificationActionTerminalArtifactV2(artifact);
  if (path.basename(filePath) !== VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE_V2) {
    throw new Error(
      `VerificationAction artifact file must be ${VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE_V2}.`
    );
  }
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  rmSync(absolutePath, { force: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    const serialized = `${encodeVerificationActionDataV2(artifact)}\n`;
    descriptor = openSync(temporaryPath, 'wx');
    writeFileSync(descriptor, serialized, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, absolutePath);
    if (readFileSync(absolutePath, 'utf8') !== serialized) {
      throw new Error('VerificationAction artifact readback bytes mismatch.');
    }
  } catch (error) {
    rmSync(absolutePath, { force: true });
    throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

export const CodexDevelopmentVerificationSessionArtifactSchemaV2 =
  'sec-verification-session-artifact-v2' as const;

export type CodexDevelopmentVerificationSessionArtifactV2 = Readonly<{
  schema: typeof CodexDevelopmentVerificationSessionArtifactSchemaV2;
  scopeAuthorization: ScopeAuthorizationV1;
  session: VerificationSessionV2;
  preGateReview: ReviewStabilityReceiptV1;
  mainHealth: MainHealthLedgerV1;
  evidence: CodexDevelopmentVerificationEvidenceV4;
  producer: CodexDevelopmentVerificationEvidenceProducerV4;
  artifactDigest: string;
}>;

export function CodexDevelopmentFinalizeVerificationSessionArtifactV2(input: Omit<
  CodexDevelopmentVerificationSessionArtifactV2,
  'schema' | 'artifactDigest'
>): CodexDevelopmentVerificationSessionArtifactV2 {
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentVerificationSessionArtifactSchemaV2,
    ...input
  });
  const artifact = Object.freeze({
    ...withoutDigest,
    artifactDigest: CodexDevelopmentVerificationDigest(withoutDigest)
  });
  CodexDevelopmentAssertVerificationSessionArtifactV2(artifact);
  return artifact;
}

export function CodexDevelopmentAssertVerificationSessionArtifactV2(
  value: unknown
): asserts value is CodexDevelopmentVerificationSessionArtifactV2 {
  assertObject(value, 'VerificationSession artifact V2');
  if (value.schema !== CodexDevelopmentVerificationSessionArtifactSchemaV2) {
    throw new Error('VerificationSession artifact V2 schema mismatch.');
  }
  assertExactKeys(value, [
    'schema', 'scopeAuthorization', 'session', 'preGateReview', 'mainHealth', 'evidence', 'producer', 'artifactDigest'
  ], 'VerificationSession artifact V2');
  const scope = parseScopeAuthorizationV1(encodeVerificationActionDataV2(value.scopeAuthorization));
  const session = parseVerificationSessionV2(encodeVerificationActionDataV2(value.session));
  const review = parseReviewStabilityReceiptV1(encodeVerificationActionDataV2(value.preGateReview));
  const mainHealth = parseMainHealthLedgerV1(encodeVerificationActionDataV2(value.mainHealth));
  CodexDevelopmentAssertVerificationEvidenceV4(value.evidence, {
    sessionRevision: session.sessionRevision,
    sessionProposalDigest: scope.sessionProposalDigest,
    scopeAuthorizationRevision: scope.authorizationRevision,
    scopeAuthorizationDigest: scope.authorizationDigest,
    reviewReceiptDigest: review.receiptDigest,
    mainHealthRevision: mainHealth.healthRevision,
    mainHealthDigest: mainHealth.ledgerDigest,
    trustRevision: session.trustRevision,
    profile: session.profile as 'quick' | 'full',
    baseSha: session.baseSha,
    baseTreeSha: session.baseTreeSha,
    headSha: session.headSha,
    headTreeSha: session.headTreeSha,
    manifestPath: session.manifestPath,
    manifestDigest: session.manifestDigest
  }, new Date((value.evidence as CodexDevelopmentVerificationEvidenceV4).finishedAt));
  const evidenceProducer = (value.evidence as CodexDevelopmentVerificationEvidenceV4).producer;
  const reviewSourceDigestIsCurrent = review.producer.sourceTransport === 'github-graphql'
    ? review.producer.sourceDigest === review.snapshot.snapshotDigest
    : review.producer.sourceTransport === 'github-rest'
      ? review.snapshot.reviewPageDigests.includes(review.producer.sourceDigest)
      : false;
  if (review.stage !== 'pre-expensive' || review.sessionRevision !== session.sessionRevision ||
      review.scopeAuthorizationRevision !== scope.authorizationRevision ||
      review.scopeAuthorizationReceiptDigest !== scope.authorizationDigest || review.headSha !== session.headSha ||
      review.headTreeSha !== session.headTreeSha ||
      review.producer.identity !== 'scripts/codex/verification-session-github.ts' ||
      review.producer.sourceRef !== `github://${session.repository}/pull/${session.prNumber}@${session.headSha}` ||
      !reviewSourceDigestIsCurrent) {
    throw new Error('VerificationSession artifact pre-gate Review closure mismatch.');
  }
  if (session.sessionProposalDigest !== scope.sessionProposalDigest ||
      session.scopeAuthorizationRevision !== scope.authorizationRevision ||
      session.scopeAuthorizationReceiptDigest !== scope.authorizationDigest ||
      session.actionPlanClosureDigest !== (value.evidence as CodexDevelopmentVerificationEvidenceV4).actionPlan.actionPlanDigest ||
      session.mainHealthRef.healthRevision !== mainHealth.healthRevision ||
      session.mainHealthRef.ledgerReceiptDigest !== mainHealth.ledgerDigest ||
      session.mainHealthRef.mainSha !== mainHealth.mainSha || session.mainHealthRef.mainTreeSha !== mainHealth.mainTreeSha) {
    throw new Error('VerificationSession artifact authority closure mismatch.');
  }
  const { sourceDigest: observedProducerDigest, ...producerInput } =
    value.producer as CodexDevelopmentVerificationEvidenceProducerV4;
  const producer = CodexDevelopmentCreateVerificationEvidenceProducerV4(producerInput);
  if (producer.sourceDigest !== observedProducerDigest ||
      !canonicalEquals(producer, evidenceProducer)) {
    throw new Error('VerificationSession artifact producer provenance mismatch.');
  }
  assertDigest(value.artifactDigest, 'VerificationSession artifact digest');
  const { artifactDigest, ...withoutDigest } = value;
  if (artifactDigest !== CodexDevelopmentVerificationDigest(withoutDigest)) {
    throw new Error('VerificationSession artifact digest mismatch.');
  }
}

export function CodexDevelopmentAssertVerificationSessionArtifactCurrentV2(
  artifact: CodexDevelopmentVerificationSessionArtifactV2,
  now: string
): void {
  CodexDevelopmentAssertVerificationSessionArtifactV2(artifact);
  const scope = artifact.scopeAuthorization;
  const session = artifact.session;
  const review = artifact.preGateReview;
  const mainHealth = artifact.mainHealth;
  assertScopeAuthorizationCurrentV1(scope, {
    baseSha: session.baseSha,
    baseTreeSha: session.baseTreeSha,
    headSha: session.headSha,
    headTreeSha: session.headTreeSha,
    manifestDigest: session.manifestDigest,
    changedPaths: scope.authorizedPaths,
    sessionProposalDigest: session.sessionProposalDigest,
    actionPlanClosureDigest: session.actionPlanClosureDigest,
    environmentDigest: session.environmentDigest,
    expectedAuthorizationRevision: session.scopeAuthorizationRevision,
    now
  });
  assertReviewStabilityReceiptCurrentV1(review, {
    stage: 'pre-expensive',
    sessionRevision: session.sessionRevision,
    scopeAuthorizationRevision: scope.authorizationRevision,
    scopeAuthorizationReceiptDigest: scope.authorizationDigest,
    headSha: session.headSha,
    headTreeSha: session.headTreeSha,
    expectedPolicyDigest: session.reviewPolicyDigest,
    snapshotDigest: review.snapshot.snapshotDigest,
    expectedReviewRevision: review.reviewRevision,
    now
  });
  const health = resolveMainHealthLaneV1({
    ledger: mainHealth,
    lane: 'ordinary',
    now,
    expectedRepository: session.repository,
    expectedDefaultBranch: 'main',
    expectedMainSha: session.baseSha,
    expectedMainTreeSha: session.baseTreeSha,
    expectedTrustRevision: session.trustRevision
  });
  if (!health.allowed || health.status !== 'healthy') {
    throw new Error(`VerificationSession artifact MainHealth is not current: ${health.reason}`);
  }
}

export type CodexDevelopmentRefreshVerificationSessionArtifactInputV2 = Readonly<{
  previousArtifact: CodexDevelopmentVerificationSessionArtifactV2;
  scopeAuthorization: ScopeAuthorizationV1;
  session: VerificationSessionV2;
  preGateReview: ReviewStabilityReceiptV1;
  mainHealth: MainHealthLedgerV1;
  producer: CodexDevelopmentVerificationEvidenceProducerV4;
  refreshedAt: string;
}>;

/**
 * Re-finalize authority-expired Session Evidence without executing candidate
 * code again. The canonical Action snapshots, Results, cleanup, and aggregate
 * five-state outcome are preserved. Only freshly observed authority receipts,
 * the trusted finalizer provenance, and the enclosing Evidence/artifact
 * digests change. A known failure therefore remains a failure.
 */
export function CodexDevelopmentRefreshVerificationSessionArtifactV2(
  input: CodexDevelopmentRefreshVerificationSessionArtifactInputV2
): CodexDevelopmentVerificationSessionArtifactV2 {
  CodexDevelopmentAssertVerificationSessionArtifactV2(input.previousArtifact);
  const scope = parseScopeAuthorizationV1(encodeVerificationActionDataV2(input.scopeAuthorization));
  const session = parseVerificationSessionV2(encodeVerificationActionDataV2(input.session));
  const review = parseReviewStabilityReceiptV1(encodeVerificationActionDataV2(input.preGateReview));
  const mainHealth = parseMainHealthLedgerV1(encodeVerificationActionDataV2(input.mainHealth));
  const producer = CodexDevelopmentCreateVerificationEvidenceProducerV4((() => {
    const { sourceDigest: _sourceDigest, ...producerInput } = input.producer;
    return producerInput;
  })());
  if (!canonicalEquals(producer, input.producer)) {
    throw new Error('VerificationSession refresh producer provenance is forged.');
  }
  if (producer.sourceTransport !== 'github-actions' ||
      producer.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
      producer.workflowSha !== session.baseSha ||
      producer.workflowRef !== `.github/workflows/compiler-pr-validation.yml@${session.baseSha}`) {
    throw new Error('VerificationSession refresh producer is not the trusted current-base compiler workflow.');
  }
  const previous = input.previousArtifact;
  if (scope.authorizationRevision !== previous.scopeAuthorization.authorizationRevision ||
      scope.sessionProposalDigest !== previous.scopeAuthorization.sessionProposalDigest ||
      scope.actionPlanClosureDigest !== previous.scopeAuthorization.actionPlanClosureDigest ||
      session.sessionRevision !== previous.session.sessionRevision ||
      session.scopeAuthorizationRevision !== scope.authorizationRevision ||
      session.actionPlanClosureDigest !== previous.session.actionPlanClosureDigest ||
      session.mainHealthRef.healthRevision !== previous.session.mainHealthRef.healthRevision ||
      mainHealth.healthRevision !== previous.mainHealth.healthRevision) {
    throw new Error('VerificationSession refresh changed stable Session, Scope, Action, or MainHealth semantics.');
  }
  if (session.scopeAuthorizationReceiptDigest !== scope.authorizationDigest ||
      session.mainHealthRef.ledgerReceiptDigest !== mainHealth.ledgerDigest ||
      review.scopeAuthorizationReceiptDigest !== scope.authorizationDigest ||
      review.sessionRevision !== session.sessionRevision) {
    throw new Error('VerificationSession refresh authority receipt closure is incomplete.');
  }
  if (scope.authorizationDigest === previous.scopeAuthorization.authorizationDigest &&
      review.receiptDigest === previous.preGateReview.receiptDigest &&
      mainHealth.ledgerDigest === previous.mainHealth.ledgerDigest) {
    throw new Error('VerificationSession refresh requires at least one newly observed authority receipt.');
  }
  const refreshedEvidence = CodexDevelopmentFinalizeVerificationEvidenceV4({
    contractRevision: previous.evidence.contractRevision,
    sessionRevision: session.sessionRevision,
    sessionProposalDigest: session.sessionProposalDigest,
    scopeAuthorizationRevision: scope.authorizationRevision,
    scopeAuthorizationDigest: scope.authorizationDigest,
    reviewReceiptDigest: review.receiptDigest,
    mainHealthRevision: mainHealth.healthRevision,
    mainHealthDigest: mainHealth.ledgerDigest,
    trustRevision: session.trustRevision,
    profile: session.profile as 'quick' | 'full',
    baseSha: session.baseSha,
    baseTreeSha: session.baseTreeSha,
    headSha: session.headSha,
    headTreeSha: session.headTreeSha,
    manifestPath: session.manifestPath,
    manifestDigest: session.manifestDigest,
    producer,
    actionPlan: previous.evidence.actionPlan,
    status: previous.evidence.status,
    startedAt: input.refreshedAt,
    finishedAt: input.refreshedAt,
    gates: previous.evidence.gates,
    evidenceRefs: Object.freeze([
      ...new Set([
        ...previous.evidence.evidenceRefs,
        `verification-session-artifact:${previous.artifactDigest}`
      ])
    ]),
    invalidationRules: previous.evidence.invalidationRules
  });
  const refreshed = CodexDevelopmentFinalizeVerificationSessionArtifactV2({
    scopeAuthorization: scope,
    session,
    preGateReview: review,
    mainHealth,
    evidence: refreshedEvidence,
    producer
  });
  CodexDevelopmentAssertVerificationSessionArtifactCurrentV2(refreshed, input.refreshedAt);
  return refreshed;
}

export function CodexDevelopmentParseVerificationSessionArtifactV2(
  source: string
): CodexDevelopmentVerificationSessionArtifactV2 {
  const parsed = JSON.parse(source) as unknown;
  CodexDevelopmentAssertVerificationSessionArtifactV2(parsed);
  return parsed;
}
