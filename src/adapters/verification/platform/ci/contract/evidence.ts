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

import { canonicalEquals, sha256 as canonicalSha256 } from '../../../../../contracts/canonical.ts';
import {
  ReduceHostedSutObservation,
  type HostedSutExecutionProof
} from './hosted-sut-observation.ts';

import { CI_VERIFICATION_CONTRACT_REVISION } from '../../../../../assurance/verification/contract/revision.ts';
import { AssertVerificationGateResult, type VerificationGateResult, type VerificationResultStatus } from '../../../../../assurance/verification/result/contract/result.ts';
import {
  parseMainHealthLedger,
  resolveOrdinaryMainHealthLane,
  type MainHealthLedger
} from '../../../../self-hosting/control/main-health/contract.ts';
import {
  assertScopeAuthorizationCurrent,
  parseScopeAuthorization,
  type ScopeAuthorization
} from '../../../../self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData, parseVerificationActionKey, parseVerificationActionPlan, type VerificationActionKey, type VerificationActionPlan } from '../../action/contract/action.ts';
import { assertCiVerificationActionPlanClosureEqual, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, parseCiVerificationActionPlanClosure, parseCiVerificationNormalizedOperation, type CiVerificationActionPlanClosure, type CiVerificationExecutionEnvironment, type CiVerificationNormalizedOperation } from '../../action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE, type VerificationActionProviderOrigin } from '../../action/contract/provider.ts';
import { assertReviewStabilityReceiptCurrent, parseReviewStabilityReceipt, REVIEW_OBSERVER_PRODUCER_IDENTITY, type ReviewStabilityReceipt } from '../../review/contract/stability.ts';
import { parseVerificationSession, type VerificationSession } from '../../session/contract/session.ts';

export function verificationDigest(value: unknown): string {
  return canonicalSha256(value);
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

function assertDigest(value: unknown, label: string): void {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 digest.`);
  }
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp.`);
}

export function prepareVerificationEvidenceTarget(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  rmSync(absolutePath, { force: true });
  return absolutePath;
}

const VerificationEvidenceSchema =
  'codex-development-verification-evidence-v4' as const;

type VerificationCleanup = Readonly<{
  status: 'passed' | 'failed' | 'not-required';
  evidenceRefs: readonly string[];
  diagnostic: string | null;
}>;

export type VerificationGateEvidence = Readonly<{
  action: VerificationActionKey;
  result: VerificationGateResult;
  cleanup: VerificationCleanup;
}>;

export type VerificationEvidenceProducer = Readonly<{
  sourceTransport: 'github-actions' | 'local-dev-runner';
  workflowPath: string;
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  actorNodeId: string;
  sourceDigest: string;
}>;

export type VerificationEvidence = Readonly<{
  schema: typeof VerificationEvidenceSchema;
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
  producer: VerificationEvidenceProducer;
  actionPlan: CiVerificationActionPlanClosure;
  status: VerificationResultStatus;
  startedAt: string;
  finishedAt: string;
  gates: readonly VerificationGateEvidence[];
  evidenceRefs: readonly string[];
  invalidationRules: readonly string[];
  evidenceDigest: string;
}>;

type VerificationEvidenceDraft = Omit<
  VerificationEvidence,
  'schema' | 'evidenceDigest'
>;

const VERIFICATION_STATUS_PRIORITY: Readonly<Record<VerificationResultStatus, number>> = Object.freeze({
  passed: 0,
  'not-run': 1,
  unsupported: 2,
  invalidated: 3,
  failed: 4
});

export function createVerificationEvidenceProducer(input: Omit<
  VerificationEvidenceProducer,
  'sourceDigest'
>): VerificationEvidenceProducer {
  if (input.sourceTransport !== 'github-actions' && input.sourceTransport !== 'local-dev-runner') {
    throw new Error('Verification evidence producer transport is invalid.');
  }
  for (const [key, value] of Object.entries({
    workflowPath: input.workflowPath, workflowRef: input.workflowRef, workflowSha: input.workflowSha,
    runId: input.runId, actorNodeId: input.actorNodeId
  })) assertString(value, `Verification evidence producer ${key}`);
  if (!/^[0-9a-f]{40}$/u.test(input.workflowSha)) throw new Error('Verification evidence producer workflowSha is invalid.');
  if (!Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1) throw new Error('Verification evidence producer runAttempt is invalid.');
  if (input.sourceTransport === 'github-actions' && (
    input.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
    input.workflowRef !== `${input.workflowPath}@${input.workflowSha}`
  )) throw new Error('Verification GitHub evidence producer does not bind the canonical trusted workflow ref.');
  const withoutDigest = Object.freeze({ ...input });
  return Object.freeze({ ...withoutDigest, sourceDigest: verificationDigest(withoutDigest) });
}

export function aggregateVerificationStatus(
  gates: readonly VerificationGateEvidence[]
): VerificationResultStatus {
  if (gates.some((gate) => gate.cleanup.status === 'failed')) return 'failed';
  return gates.reduce<VerificationResultStatus>((current, gate) => (
    VERIFICATION_STATUS_PRIORITY[gate.result.status] > VERIFICATION_STATUS_PRIORITY[current]
      ? gate.result.status
      : current
  ), 'passed');
}

export function finalizeVerificationEvidence(
  draft: VerificationEvidenceDraft
): VerificationEvidence {
  const withoutDigest = {
    schema: VerificationEvidenceSchema,
    ...draft
  };
  const evidence = Object.freeze({
    ...withoutDigest,
    evidenceDigest: verificationDigest(withoutDigest)
  });
  assertVerificationEvidence(evidence, {
    actionPlan: draft.actionPlan
  }, new Date(draft.startedAt));
  return evidence;
}

function assertVerificationCleanup(value: unknown, label: string): asserts value is VerificationCleanup {
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

export function assertVerificationEvidence(
  value: unknown,
  expected: Partial<Pick<
    VerificationEvidence,
    'contractRevision' | 'sessionRevision' | 'sessionProposalDigest' | 'scopeAuthorizationRevision' | 'scopeAuthorizationDigest'
    | 'reviewReceiptDigest' | 'mainHealthRevision' | 'mainHealthDigest' | 'trustRevision' | 'profile'
    | 'baseSha' | 'baseTreeSha' | 'headSha' | 'headTreeSha' | 'manifestPath' | 'manifestDigest'
  >> & { readonly actionPlan?: CiVerificationActionPlanClosure } = {},
  now = new Date()
): asserts value is VerificationEvidence {
  assertObject(value, 'Verification evidence');
  if (value.schema !== VerificationEvidenceSchema) {
    throw new Error('Verification evidence schema mismatch; legacy evidence schemas cannot be promoted.');
  }
  assertExactKeys(value, [
    'schema', 'contractRevision', 'sessionRevision', 'sessionProposalDigest', 'scopeAuthorizationRevision', 'scopeAuthorizationDigest',
    'reviewReceiptDigest', 'mainHealthRevision', 'mainHealthDigest', 'trustRevision', 'profile', 'baseSha', 'baseTreeSha',
    'headSha', 'headTreeSha', 'manifestPath', 'manifestDigest', 'producer', 'actionPlan', 'status', 'startedAt',
    'finishedAt', 'gates', 'evidenceRefs', 'invalidationRules', 'evidenceDigest'
  ], 'Verification evidence');
  if (value.contractRevision !== CI_VERIFICATION_CONTRACT_REVISION) {
    throw new Error('Verification evidence CI revision mismatch.');
  }
  for (const key of ['sessionRevision', 'manifestPath'] as const) assertString(value[key], `Verification evidence ${key}`);
  for (const key of [
    'sessionProposalDigest', 'scopeAuthorizationRevision', 'scopeAuthorizationDigest', 'reviewReceiptDigest',
    'mainHealthRevision', 'mainHealthDigest', 'manifestDigest',
    'evidenceDigest'
  ] as const) assertDigest(value[key], `Verification evidence ${key}`);
  for (const key of ['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'trustRevision'] as const) {
    if (typeof value[key] !== 'string' || !/^[0-9a-f]{40}$/u.test(value[key])) {
      throw new Error(`Verification evidence ${key} must be a lowercase Git SHA.`);
    }
  }
  if (value.profile !== 'quick' && value.profile !== 'full') throw new Error('Verification evidence profile is invalid.');
  assertObject(value.producer, 'Verification evidence producer');
  const producer = value.producer;
  assertExactKeys(producer, [
    'sourceTransport', 'workflowPath', 'workflowRef', 'workflowSha', 'runId', 'runAttempt', 'actorNodeId', 'sourceDigest'
  ], 'Verification evidence producer');
  const { sourceDigest: observedSourceDigest, ...producerInput } =
    producer as unknown as VerificationEvidenceProducer;
  const rebuiltProducer = createVerificationEvidenceProducer(producerInput);
  if (rebuiltProducer.sourceDigest !== observedSourceDigest) throw new Error('Verification evidence producer digest mismatch.');
  if (!['passed', 'failed', 'not-run', 'unsupported', 'invalidated'].includes(String(value.status))) {
    throw new Error('Verification evidence status is invalid.');
  }
  assertIsoDate(value.startedAt, 'Verification evidence startedAt');
  assertIsoDate(value.finishedAt, 'Verification evidence finishedAt');
  if (value.finishedAt < value.startedAt) throw new Error('Verification evidence timestamps are inverted.');
  const actionPlan = parseCiVerificationActionPlanClosure(encodeVerificationActionData(value.actionPlan));
  if (!Array.isArray(value.gates)) throw new Error('Verification evidence gates must be an array.');
  const gates = value.gates.map((entry, index) => {
    const label = `Verification evidence gates[${index}]`;
    assertObject(entry, label);
    assertExactKeys(entry, ['action', 'result', 'cleanup'], label);
    const action = parseVerificationActionKey(encodeVerificationActionData(entry.action));
    AssertVerificationGateResult(entry.result);
    assertVerificationCleanup(entry.cleanup, `${label}.cleanup`);
    const result = entry.result as VerificationGateResult;
    if (result.gateId !== action.operation.identity || result.inputDigest !== action.actionKey ||
        result.subjectRevision !== value.headSha) {
      throw new Error(`${label} result does not bind its canonical Action and candidate.`);
    }
    if (result.disposition === 'reused' && result.evidenceRefs.length === 0) {
      throw new Error(`${label} reused result requires an Evidence reference.`);
    }
    return { action, result, cleanup: entry.cleanup as VerificationCleanup };
  });
  if (gates.length !== actionPlan.actions.length || gates.some((gate, index) => (
    gate.action.actionKey !== actionPlan.actions[index]?.action.actionKey ||
    encodeVerificationActionData(gate.action) !== encodeVerificationActionData(actionPlan.actions[index]?.action)
  ))) throw new Error('Verification evidence gate order/action closure mismatch.');
  if (value.status !== aggregateVerificationStatus(gates)) {
    throw new Error('Verification evidence aggregate status is inconsistent with five-state gates/cleanup.');
  }
  assertStringArray(value.evidenceRefs, 'Verification evidence evidenceRefs');
  assertStringArray(value.invalidationRules, 'Verification evidence invalidationRules');
  if ((value.invalidationRules as string[]).length === 0) throw new Error('Verification evidence requires invalidation rules.');
  const { actionPlan: expectedActionPlan, ...expectedFields } = expected;
  for (const [key, expectedValue] of Object.entries(expectedFields)) {
    if (value[key] !== expectedValue) throw new Error(`Verification evidence ${key} mismatch.`);
  }
  if (expectedActionPlan !== undefined) {
    assertCiVerificationActionPlanClosureEqual(actionPlan, expectedActionPlan);
  }
  const { evidenceDigest, ...withoutDigest } = value;
  if (evidenceDigest !== verificationDigest(withoutDigest)) {
    throw new Error('Verification evidence digest mismatch.');
  }
  if (new Date(value.finishedAt).getTime() > now.getTime() + 5 * 60_000) {
    throw new Error('Verification evidence timestamp is in the future.');
  }
}

export function writeVerificationEvidenceAtomic(
  filePath: string,
  evidence: VerificationEvidence
): void {
  assertVerificationEvidence(evidence, { actionPlan: evidence.actionPlan }, new Date(evidence.finishedAt));
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  rmSync(absolutePath, { force: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    const serialized = encodeVerificationActionData(evidence);
    descriptor = openSync(temporaryPath, 'wx');
    writeFileSync(descriptor, serialized, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, absolutePath);
    const readback = readFileSync(absolutePath, 'utf8');
    if (readback !== serialized) throw new Error('Verification evidence readback bytes mismatch.');
    assertVerificationEvidence(JSON.parse(readback), { actionPlan: evidence.actionPlan }, new Date(evidence.finishedAt));
  } catch (error) {
    rmSync(absolutePath, { force: true });
    throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
}

export type VerificationActionArtifactInput = Readonly<{
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  inputClosureDigest: string;
  candidateBytesDigest: string;
}>;

export type VerificationActionArtifactProducer = VerificationActionProviderOrigin;

export type VerificationActionTerminalArtifact = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA;
  actionPlan: VerificationActionPlan;
  normalizedOperation: CiVerificationNormalizedOperation;
  result: VerificationGateResult;
  cleanup: VerificationCleanup;
  executionEnvironment: CiVerificationExecutionEnvironment;
  input: VerificationActionArtifactInput;
  producer: VerificationActionArtifactProducer;
  executionProof: HostedSutExecutionProof;
  artifactDigest: string;
}>;

export function verificationActionCandidateBytesDigest(input: Readonly<{
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  action: VerificationActionKey;
}>): string {
  return verificationDigest({
    baseSha: input.baseSha,
    baseTreeSha: input.baseTreeSha,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    inputClosure: input.action.inputClosure
  });
}

export function finalizeVerificationActionTerminalArtifact(input: Omit<
  VerificationActionTerminalArtifact,
  'schema' | 'artifactDigest'
>): VerificationActionTerminalArtifact {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA,
    ...input
  });
  const artifact = Object.freeze({
    ...withoutDigest,
    artifactDigest: verificationDigest(withoutDigest)
  });
  assertVerificationActionTerminalArtifact(artifact);
  return artifact;
}

export function assertVerificationActionTerminalArtifact(
  value: unknown,
  expected: Readonly<{
    actionPlan?: VerificationActionPlan;
    executionEnvironmentRevision?: string;
  }> = {}
): asserts value is VerificationActionTerminalArtifact {
  assertObject(value, 'VerificationAction terminal artifact');
  if (value.schema !== CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA) {
    throw new Error('VerificationAction terminal artifact schema mismatch.');
  }
  assertExactKeys(value, [
    'schema', 'actionPlan', 'normalizedOperation', 'result', 'cleanup', 'executionEnvironment',
    'input', 'producer', 'executionProof', 'artifactDigest'
  ], 'VerificationAction terminal artifact');
  const plan = parseVerificationActionPlan(encodeVerificationActionData(value.actionPlan));
  const normalizedOperation = parseCiVerificationNormalizedOperation(value.normalizedOperation);
  if (normalizedOperation.gateId !== plan.action.operation.identity ||
      normalizedOperation.semanticDigest !== plan.action.operation.semanticDigest ||
      encodeVerificationActionData(normalizedOperation.environmentBindings) !==
        encodeVerificationActionData(plan.action.operation.declaredEnvironment)) {
    throw new Error('VerificationAction artifact normalized operation does not bind its Action member.');
  }
  AssertVerificationGateResult(value.result);
  assertVerificationCleanup(value.cleanup, 'VerificationAction artifact cleanup');
  const result = value.result as VerificationGateResult;
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
  if (!canonicalEquals(value.executionEnvironment, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT)) {
    throw new Error('VerificationAction terminal artifact must use the canonical hosted execution environment.');
  }
  if (plan.action.environment.providerRevision !==
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision) {
    throw new Error('VerificationAction artifact ActionKey does not bind the hosted execution environment.');
  }
  const environmentBinding = plan.action.operation.declaredEnvironment.find(
    (binding) => binding.name === 'SEC_EXECUTION_ENVIRONMENT_REVISION'
  );
  if (environmentBinding?.digest !== verificationDigest(
    CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision
  )) {
    throw new Error('VerificationAction artifact declared environment revision is missing or forged.');
  }
  assertObject(value.input, 'VerificationAction artifact input');
  assertExactKeys(value.input, [
    'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'manifestPath', 'manifestDigest',
    'inputClosureDigest', 'candidateBytesDigest'
  ], 'VerificationAction artifact input');
  const artifactInput = value.input as unknown as VerificationActionArtifactInput;
  for (const key of ['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha'] as const) {
    if (!/^[0-9a-f]{40}$/u.test(artifactInput[key])) {
      throw new Error(`VerificationAction artifact input ${key} is invalid.`);
    }
  }
  assertString(artifactInput.manifestPath, 'VerificationAction artifact manifest path');
  assertDigest(artifactInput.manifestDigest, 'VerificationAction artifact manifest digest');
  assertDigest(artifactInput.inputClosureDigest, 'VerificationAction artifact input closure digest');
  assertDigest(artifactInput.candidateBytesDigest, 'VerificationAction artifact candidate bytes digest');
  if (artifactInput.inputClosureDigest !== verificationDigest(plan.action.inputClosure)) {
    throw new Error('VerificationAction artifact input closure digest mismatch.');
  }
  const manifestInput = plan.action.inputClosure.find((entry) => entry.path === artifactInput.manifestPath);
  if (manifestInput?.digest !== artifactInput.manifestDigest) {
    throw new Error('VerificationAction artifact manifest is outside the canonical Action input closure.');
  }
  if (artifactInput.candidateBytesDigest !== verificationActionCandidateBytesDigest({
    ...artifactInput,
    action: plan.action
  })) throw new Error('VerificationAction artifact candidate bytes digest mismatch.');
  assertObject(value.producer, 'VerificationAction artifact producer');
  assertExactKeys(value.producer, [
    'repositoryId', 'repository', 'workflowPath', 'workflowRef', 'workflowSha', 'runId', 'runAttempt',
    'appId', 'appNodeId', 'sourceEvent'
  ], 'VerificationAction artifact producer');
  const producer = value.producer as unknown as VerificationActionArtifactProducer;
  if (!Number.isSafeInteger(producer.repositoryId) || producer.repositoryId < 1 ||
      producer.appId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id ||
      producer.appNodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.nodeId ||
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
  const proof = value.executionProof as unknown as HostedSutExecutionProof;
  const replay = ReduceHostedSutObservation({
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
      encodeVerificationActionData(plan) !== encodeVerificationActionData(expected.actionPlan)) {
    throw new Error('VerificationAction artifact plan differs from trusted reconstruction.');
  }
  if (expected.executionEnvironmentRevision !== undefined &&
      plan.action.environment.providerRevision !== expected.executionEnvironmentRevision) {
    throw new Error('VerificationAction artifact environment differs from trusted reconstruction.');
  }
  assertDigest(value.artifactDigest, 'VerificationAction artifact digest');
  const { artifactDigest, ...withoutDigest } = value;
  if (artifactDigest !== verificationDigest(withoutDigest)) {
    throw new Error('VerificationAction artifact digest mismatch.');
  }
}

export function parseVerificationActionTerminalArtifact(
  source: string
): VerificationActionTerminalArtifact {
  const value = JSON.parse(source) as unknown;
  assertVerificationActionTerminalArtifact(value);
  return value;
}

export function writeVerificationActionTerminalArtifactAtomic(
  filePath: string,
  artifact: VerificationActionTerminalArtifact
): void {
  assertVerificationActionTerminalArtifact(artifact);
  if (path.basename(filePath) !== VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE) {
    throw new Error(
      `VerificationAction artifact file must be ${VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE}.`
    );
  }
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  rmSync(absolutePath, { force: true });
  const temporaryPath = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    const serialized = `${encodeVerificationActionData(artifact)}\n`;
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

const VerificationSessionArtifactSchema =
  'sec-verification-session-artifact-v2' as const;

export type VerificationSessionArtifact = Readonly<{
  schema: typeof VerificationSessionArtifactSchema;
  scopeAuthorization: ScopeAuthorization;
  session: VerificationSession;
  preGateReview: ReviewStabilityReceipt;
  mainHealth: MainHealthLedger;
  evidence: VerificationEvidence;
  producer: VerificationEvidenceProducer;
  artifactDigest: string;
}>;

export function finalizeVerificationSessionArtifact(input: Omit<
  VerificationSessionArtifact,
  'schema' | 'artifactDigest'
>): VerificationSessionArtifact {
  const withoutDigest = Object.freeze({
    schema: VerificationSessionArtifactSchema,
    ...input
  });
  const artifact = Object.freeze({
    ...withoutDigest,
    artifactDigest: verificationDigest(withoutDigest)
  });
  assertVerificationSessionArtifact(artifact);
  return artifact;
}

export function assertVerificationSessionArtifact(
  value: unknown
): asserts value is VerificationSessionArtifact {
  assertObject(value, 'VerificationSession artifact');
  if (value.schema !== VerificationSessionArtifactSchema) {
    throw new Error('VerificationSession artifact schema mismatch.');
  }
  assertExactKeys(value, [
    'schema', 'scopeAuthorization', 'session', 'preGateReview', 'mainHealth', 'evidence', 'producer', 'artifactDigest'
  ], 'VerificationSession artifact');
  const scope = parseScopeAuthorization(encodeVerificationActionData(value.scopeAuthorization));
  const session = parseVerificationSession(encodeVerificationActionData(value.session));
  const review = parseReviewStabilityReceipt(encodeVerificationActionData(value.preGateReview));
  const mainHealth = parseMainHealthLedger(encodeVerificationActionData(value.mainHealth));
  assertVerificationEvidence(value.evidence, {
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
  }, new Date((value.evidence as VerificationEvidence).finishedAt));
  const evidenceProducer = (value.evidence as VerificationEvidence).producer;
  const reviewSourceDigestIsCurrent = review.producer.sourceTransport === 'github-graphql'
    ? review.producer.sourceDigest === review.snapshot.snapshotDigest
    : review.producer.sourceTransport === 'github-rest'
      ? review.snapshot.reviewPageDigests.includes(review.producer.sourceDigest)
      : false;
  if (review.stage !== 'pre-expensive' || review.sessionRevision !== session.sessionRevision ||
      review.scopeAuthorizationRevision !== scope.authorizationRevision ||
      review.scopeAuthorizationReceiptDigest !== scope.authorizationDigest || review.headSha !== session.headSha ||
      review.headTreeSha !== session.headTreeSha ||
      review.producer.identity !== REVIEW_OBSERVER_PRODUCER_IDENTITY ||
      review.producer.sourceRef !== `github://${session.repository}/pull/${session.prNumber}@${session.headSha}` ||
      !reviewSourceDigestIsCurrent) {
    throw new Error('VerificationSession artifact pre-gate Review closure mismatch.');
  }
  if (session.sessionProposalDigest !== scope.sessionProposalDigest ||
      session.scopeAuthorizationRevision !== scope.authorizationRevision ||
      session.scopeAuthorizationReceiptDigest !== scope.authorizationDigest ||
      session.actionPlanClosureDigest !== (value.evidence as VerificationEvidence).actionPlan.actionPlanDigest ||
      session.mainHealthRef.healthRevision !== mainHealth.healthRevision ||
      session.mainHealthRef.ledgerReceiptDigest !== mainHealth.ledgerDigest ||
      session.mainHealthRef.mainSha !== mainHealth.mainSha || session.mainHealthRef.mainTreeSha !== mainHealth.mainTreeSha) {
    throw new Error('VerificationSession artifact authority closure mismatch.');
  }
  const { sourceDigest: observedProducerDigest, ...producerInput } =
    value.producer as VerificationEvidenceProducer;
  const producer = createVerificationEvidenceProducer(producerInput);
  if (producer.sourceDigest !== observedProducerDigest ||
      !canonicalEquals(producer, evidenceProducer)) {
    throw new Error('VerificationSession artifact producer provenance mismatch.');
  }
  assertDigest(value.artifactDigest, 'VerificationSession artifact digest');
  const { artifactDigest, ...withoutDigest } = value;
  if (artifactDigest !== verificationDigest(withoutDigest)) {
    throw new Error('VerificationSession artifact digest mismatch.');
  }
}

export function assertVerificationSessionArtifactCurrent(
  artifact: VerificationSessionArtifact,
  now: string
): void {
  assertVerificationSessionArtifact(artifact);
  const scope = artifact.scopeAuthorization;
  const session = artifact.session;
  const review = artifact.preGateReview;
  const mainHealth = artifact.mainHealth;
  assertScopeAuthorizationCurrent(scope, {
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
  assertReviewStabilityReceiptCurrent(review, {
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
  const health = resolveOrdinaryMainHealthLane({
    ledger: mainHealth,
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

export type RefreshVerificationSessionArtifactInput = Readonly<{
  previousArtifact: VerificationSessionArtifact;
  scopeAuthorization: ScopeAuthorization;
  session: VerificationSession;
  preGateReview: ReviewStabilityReceipt;
  mainHealth: MainHealthLedger;
  producer: VerificationEvidenceProducer;
  refreshedAt: string;
}>;

/**
 * Re-finalize authority-expired Session Evidence without executing candidate
 * code again. The canonical Action snapshots, Results, cleanup, and aggregate
 * five-state outcome are preserved. Only freshly observed authority receipts,
 * the trusted finalizer provenance, and the enclosing Evidence/artifact
 * digests change. A known failure therefore remains a failure.
 */
export function refreshVerificationSessionArtifact(
  input: RefreshVerificationSessionArtifactInput
): VerificationSessionArtifact {
  assertVerificationSessionArtifact(input.previousArtifact);
  const scope = parseScopeAuthorization(encodeVerificationActionData(input.scopeAuthorization));
  const session = parseVerificationSession(encodeVerificationActionData(input.session));
  const review = parseReviewStabilityReceipt(encodeVerificationActionData(input.preGateReview));
  const mainHealth = parseMainHealthLedger(encodeVerificationActionData(input.mainHealth));
  const producer = createVerificationEvidenceProducer((() => {
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
  const refreshedEvidence = finalizeVerificationEvidence({
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
  const refreshed = finalizeVerificationSessionArtifact({
    scopeAuthorization: scope,
    session,
    preGateReview: review,
    mainHealth,
    evidence: refreshedEvidence,
    producer
  });
  assertVerificationSessionArtifactCurrent(refreshed, input.refreshedAt);
  return refreshed;
}

export function parseVerificationSessionArtifact(
  source: string
): VerificationSessionArtifact {
  const parsed = JSON.parse(source) as unknown;
  assertVerificationSessionArtifact(parsed);
  return parsed;
}
