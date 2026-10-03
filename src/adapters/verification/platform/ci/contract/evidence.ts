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

import { canonicalEquals, sha256 as canonicalSha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJson } from '../../../../../contracts/exact-json.ts';
import { assertHostedActionRuntimeExecutionBinding, parseHostedActionRuntimeExecution, type HostedActionRuntimeExecution } from './hosted-runtime-execution.ts';
import {
  CodexDevelopmentReduceHostedSutObservation,
  type CodexDevelopmentHostedSutExecutionProof
} from './hosted-sut-observation.ts';

import { CI_VERIFICATION_CONTRACT_REVISION, CI_VERIFICATION_WORKFLOW_PATH } from '../../../../../assurance/verification/contract/revision.ts';
import { CodexDevelopmentAssertVerificationGateResult, type VerificationGateResult, type VerificationResultStatus } from '../../../../../assurance/verification/result/contract/result.ts';
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
import { assertCiVerificationActionPlanClosureEqual, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT, parseCiVerificationActionPlanClosure, parseCiVerificationHostedExecutionEnvironment, parseCiVerificationNormalizedOperation, SOURCE_PROGRAM_TRANSITION_GATE_ID, type CiVerificationActionPlanClosure, type CiVerificationExecutionEnvironment, type CiVerificationNormalizedOperation } from '../../action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA, CI_VERIFICATION_PER_JOB_ACTION_ARTIFACT_SCHEMA, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE, type VerificationActionProviderOrigin } from '../../action/contract/provider.ts';
import { assertReviewStabilityReceiptCurrent, parseReviewStabilityReceipt, REVIEW_OBSERVER_PRODUCER_IDENTITY, type ReviewStabilityReceipt } from '../../review/contract/stability.ts';
import { parseVerificationSession, type VerificationSession } from '../../session/contract/session.ts';
import type { SourceProgramTransitionQualification, TrustedRuntimeSourceProgramAttemptEvidence } from '../../trusted-runtime/trusted-runtime-container.ts';

export function CodexDevelopmentVerificationDigest(value: unknown): string {
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

export function CodexDevelopmentPrepareVerificationEvidenceTarget(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  rmSync(absolutePath, { force: true });
  return absolutePath;
}

const CodexDevelopmentVerificationEvidenceSchemaV4 =
  'codex-development-verification-evidence-v4' as const;

type CodexDevelopmentVerificationCleanup = Readonly<{
  status: 'passed' | 'failed' | 'not-required';
  evidenceRefs: readonly string[];
  diagnostic: string | null;
}>;

export type CodexDevelopmentVerificationGateEvidenceV4 = Readonly<{
  action: VerificationActionKey;
  result: VerificationGateResult;
  cleanup: CodexDevelopmentVerificationCleanup;
}>;

/** Exact first-qualified Action transport. Decoding is historical data only;
 * only the retained host issuer can authorize its use at Session finalization. */
export interface TrustedRuntimeSourceProgramActionRecord {
  readonly schema: 'source-program-qualified-action-v1';
  readonly authority: 'historical-evidence-only';
  readonly sessionRevision: string;
  readonly observationDigest: string;
  readonly attemptEvidenceDigest: string;
  readonly outputByteDigest: string;
  readonly gate: CodexDevelopmentVerificationGateEvidenceV4;
  readonly sourceActionDigest: string;
}

export function parseTrustedRuntimeSourceProgramActionRecord(value: unknown): TrustedRuntimeSourceProgramActionRecord {
  assertObject(value, 'Source Program Action handoff');
  assertExactKeys(value, ['schema', 'authority', 'sessionRevision', 'observationDigest',
    'attemptEvidenceDigest', 'outputByteDigest', 'gate', 'sourceActionDigest'], 'Source Program Action handoff');
  if (value.schema !== 'source-program-qualified-action-v1' || value.authority !== 'historical-evidence-only') {
    throw new Error('Source Program Action handoff is not versioned historical evidence.');
  }
  for (const key of ['sessionRevision', 'observationDigest', 'attemptEvidenceDigest', 'outputByteDigest', 'sourceActionDigest']) {
    assertDigest(value[key], key);
  }
  assertObject(value.gate, 'Source Program Action gate');
  assertExactKeys(value.gate, ['action', 'result', 'cleanup'], 'Source Program Action gate');
  const action = parseVerificationActionKey(encodeVerificationActionData(value.gate.action));
  CodexDevelopmentAssertVerificationGateResult(value.gate.result);
  assertV4Cleanup(value.gate.cleanup, 'Source Program Action cleanup');
  const result = value.gate.result as VerificationGateResult;
  if (action.operation.identity !== SOURCE_PROGRAM_TRANSITION_GATE_ID
      || result.gateId !== action.operation.identity || result.inputDigest !== action.actionKey
      || result.status !== 'passed' || result.disposition !== 'executed'
      || result.execution === null || result.execution.exitCode !== 0
      || result.execution.outputDigest !== value.outputByteDigest
      || result.evidenceRefs.length !== 1 || result.evidenceRefs[0] !== value.outputByteDigest
      || (value.gate.cleanup as CodexDevelopmentVerificationCleanup).status !== 'passed'
      || !canonicalEquals((value.gate.cleanup as CodexDevelopmentVerificationCleanup).evidenceRefs, [value.attemptEvidenceDigest])) {
    throw new Error('Source Program Action handoff lost its complete physical result.');
  }
  const { sourceActionDigest, ...canonical } = value;
  if (sourceActionDigest !== CodexDevelopmentVerificationDigest(canonical)) {
    throw new Error('Source Program Action handoff digest mismatch.');
  }
  return Object.freeze(value) as unknown as TrustedRuntimeSourceProgramActionRecord;
}

export type CodexDevelopmentVerificationEvidenceProducer = Readonly<{
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
  producer: CodexDevelopmentVerificationEvidenceProducer;
  actionPlan: CiVerificationActionPlanClosure;
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

export function CodexDevelopmentCreateVerificationEvidenceProducer(input: Omit<
  CodexDevelopmentVerificationEvidenceProducer,
  'sourceDigest'
>): CodexDevelopmentVerificationEvidenceProducer {
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

function assertV4Cleanup(value: unknown, label: string): asserts value is CodexDevelopmentVerificationCleanup {
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
  >> & { readonly actionPlan?: CiVerificationActionPlanClosure } = {},
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
    producer as unknown as CodexDevelopmentVerificationEvidenceProducer;
  const rebuiltProducer = CodexDevelopmentCreateVerificationEvidenceProducer(producerInput);
  if (rebuiltProducer.sourceDigest !== observedSourceDigest) throw new Error('Verification V4 producer digest mismatch.');
  if (!['passed', 'failed', 'not-run', 'unsupported', 'invalidated'].includes(String(value.status))) {
    throw new Error('Verification V4 evidence status is invalid.');
  }
  assertIsoDate(value.startedAt, 'Verification V4 evidence startedAt');
  assertIsoDate(value.finishedAt, 'Verification V4 evidence finishedAt');
  if (value.finishedAt < value.startedAt) throw new Error('Verification V4 evidence timestamps are inverted.');
  const actionPlan = parseCiVerificationActionPlanClosure(encodeVerificationActionData(value.actionPlan));
  if (!Array.isArray(value.gates)) throw new Error('Verification V4 evidence gates must be an array.');
  const gates = value.gates.map((entry, index) => {
    const label = `Verification V4 evidence gates[${index}]`;
    assertObject(entry, label);
    assertExactKeys(entry, ['action', 'result', 'cleanup'], label);
    const action = parseVerificationActionKey(encodeVerificationActionData(entry.action));
    CodexDevelopmentAssertVerificationGateResult(entry.result);
    assertV4Cleanup(entry.cleanup, `${label}.cleanup`);
    const result = entry.result as VerificationGateResult;
    if (result.gateId !== action.operation.identity || result.inputDigest !== action.actionKey ||
        result.subjectRevision !== value.headSha) {
      throw new Error(`${label} result does not bind its canonical Action and candidate.`);
    }
    if (result.disposition === 'reused' && result.evidenceRefs.length === 0) {
      throw new Error(`${label} reused result requires an Evidence reference.`);
    }
    return { action, result, cleanup: entry.cleanup as CodexDevelopmentVerificationCleanup };
  });
  if (gates.length !== actionPlan.actions.length || gates.some((gate, index) => (
    gate.action.actionKey !== actionPlan.actions[index]?.action.actionKey ||
    encodeVerificationActionData(gate.action) !== encodeVerificationActionData(actionPlan.actions[index]?.action)
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
    assertCiVerificationActionPlanClosureEqual(actionPlan, expectedActionPlan);
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
    const serialized = encodeVerificationActionData(evidence);
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

export type CodexDevelopmentVerificationActionArtifactInput = Readonly<{
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  inputClosureDigest: string;
  candidateBytesDigest: string;
}>;

export type CodexDevelopmentVerificationActionArtifactProducer = VerificationActionProviderOrigin;

type HostedActionTerminalFields = Readonly<{
  actionPlan: VerificationActionPlan;
  normalizedOperation: CiVerificationNormalizedOperation;
  result: VerificationGateResult;
  cleanup: CodexDevelopmentVerificationCleanup;
  executionEnvironment: CiVerificationExecutionEnvironment;
  input: CodexDevelopmentVerificationActionArtifactInput;
  producer: CodexDevelopmentVerificationActionArtifactProducer;
  executionProof: CodexDevelopmentHostedSutExecutionProof;
  artifactDigest: string;
}>;

export type CodexDevelopmentVerificationActionTerminalArtifact = HostedActionTerminalFields & (
  | Readonly<{ schema: typeof CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA }>
  | Readonly<{ schema: typeof CI_VERIFICATION_PER_JOB_ACTION_ARTIFACT_SCHEMA; runtimeExecution: HostedActionRuntimeExecution }>
);

export function CodexDevelopmentVerificationActionCandidateBytesDigest(input: Readonly<{
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: string;
  action: VerificationActionKey;
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

/** Construct historical data only. Production assembly additionally requires
 * the private authenticated executing-job proof before producing the new wire. */
export function CodexDevelopmentFinalizeVerificationActionTerminalArtifact(input: Omit<
  HostedActionTerminalFields, 'artifactDigest'
> & Readonly<{ runtimeExecution?: HostedActionRuntimeExecution }>): CodexDevelopmentVerificationActionTerminalArtifact {
  const environment = parseCiVerificationHostedExecutionEnvironment(input.executionEnvironment);
  const perJob = environment === CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT;
  if (perJob !== Object.hasOwn(input, 'runtimeExecution')) {
    throw new Error('Hosted terminal runtime execution data does not match its versioned profile.');
  }
  const withoutDigest = Object.freeze({
    schema: perJob ? CI_VERIFICATION_PER_JOB_ACTION_ARTIFACT_SCHEMA : CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA,
    ...input
  });
  const artifact = Object.freeze({
    ...withoutDigest,
    artifactDigest: CodexDevelopmentVerificationDigest(withoutDigest)
  });
  CodexDevelopmentAssertVerificationActionTerminalArtifact(artifact);
  return artifact;
}

export function CodexDevelopmentAssertVerificationActionTerminalArtifact(
  value: unknown,
  expected: Readonly<{
    actionPlan?: VerificationActionPlan;
    executionEnvironmentRevision?: string;
  }> = {}
): asserts value is CodexDevelopmentVerificationActionTerminalArtifact {
  assertObject(value, 'VerificationAction terminal artifact V2');
  if (value.schema !== CI_VERIFICATION_ACTION_ARTIFACT_SCHEMA
    && value.schema !== CI_VERIFICATION_PER_JOB_ACTION_ARTIFACT_SCHEMA) {
    throw new Error('VerificationAction terminal artifact schema mismatch.');
  }
  const perJob = value.schema === CI_VERIFICATION_PER_JOB_ACTION_ARTIFACT_SCHEMA;
  assertExactKeys(value, [
    ...(perJob ? ['runtimeExecution'] : []),
    'schema', 'actionPlan', 'normalizedOperation', 'result', 'cleanup', 'executionEnvironment',
    'input', 'producer', 'executionProof', 'artifactDigest'
  ], 'VerificationAction terminal artifact V2');
  const plan = parseVerificationActionPlan(encodeVerificationActionData(value.actionPlan));
  const normalizedOperation = parseCiVerificationNormalizedOperation(value.normalizedOperation);
  if (normalizedOperation.gateId !== plan.action.operation.identity ||
      normalizedOperation.semanticDigest !== plan.action.operation.semanticDigest ||
      encodeVerificationActionData(normalizedOperation.environmentBindings) !==
        encodeVerificationActionData(plan.action.operation.declaredEnvironment)) {
    throw new Error('VerificationAction artifact normalized operation does not bind its Action member.');
  }
  CodexDevelopmentAssertVerificationGateResult(value.result);
  assertV4Cleanup(value.cleanup, 'VerificationAction artifact cleanup');
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
  const executionEnvironment = parseCiVerificationHostedExecutionEnvironment(value.executionEnvironment);
  if (executionEnvironment !== (perJob ? CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT
      : CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT)) {
    throw new Error('VerificationAction terminal schema cannot relabel another hosted profile.');
  }
  if (plan.action.environment.providerRevision !== executionEnvironment.executionEnvironmentRevision
    || (perJob && plan.action.environment.toolchainRevision !== executionEnvironment.toolchainRevision)) {
    throw new Error('VerificationAction artifact ActionKey does not bind the hosted execution environment.');
  }
  const environmentBinding = plan.action.operation.declaredEnvironment.find(
    (binding) => binding.name === 'SEC_EXECUTION_ENVIRONMENT_REVISION'
  );
  if (environmentBinding?.digest !== CodexDevelopmentVerificationDigest(
    executionEnvironment.executionEnvironmentRevision
  )) {
    throw new Error('VerificationAction artifact declared environment revision is missing or forged.');
  }
  assertObject(value.input, 'VerificationAction artifact input');
  assertExactKeys(value.input, [
    'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'manifestPath', 'manifestDigest',
    'inputClosureDigest', 'candidateBytesDigest'
  ], 'VerificationAction artifact input');
  const artifactInput = value.input as unknown as CodexDevelopmentVerificationActionArtifactInput;
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
  if (artifactInput.candidateBytesDigest !== CodexDevelopmentVerificationActionCandidateBytesDigest({
    ...artifactInput,
    action: plan.action
  })) throw new Error('VerificationAction artifact candidate bytes digest mismatch.');
  assertObject(value.producer, 'VerificationAction artifact producer');
  assertExactKeys(value.producer, [
    'repositoryId', 'repository', 'workflowPath', 'workflowRef', 'workflowSha', 'runId', 'runAttempt',
    'appId', 'appNodeId', 'sourceEvent'
  ], 'VerificationAction artifact producer');
  const producer = value.producer as unknown as CodexDevelopmentVerificationActionArtifactProducer;
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
  const proof = value.executionProof as unknown as CodexDevelopmentHostedSutExecutionProof;
  const replay = CodexDevelopmentReduceHostedSutObservation({
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
  if (perJob) {
    const runtimeExecution = parseHostedActionRuntimeExecution(value.runtimeExecution);
    assertHostedActionRuntimeExecutionBinding(runtimeExecution, {
      actionKey: plan.action.actionKey, repository: producer.repository, repositoryId: producer.repositoryId,
      baseSha: artifactInput.baseSha, baseTreeSha: artifactInput.baseTreeSha,
      runId: producer.runId, runAttempt: producer.runAttempt,
      sandboxReceiptDigest: proof.observation.sandboxReceipt.receiptDigest
    });
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
  if (artifactDigest !== CodexDevelopmentVerificationDigest(withoutDigest)) {
    throw new Error('VerificationAction artifact digest mismatch.');
  }
}

export function CodexDevelopmentParseVerificationActionTerminalArtifact(
  source: string
): CodexDevelopmentVerificationActionTerminalArtifact {
  const decoded = JSON.parse(source) as unknown;
  const value = (decoded as { schema?: unknown } | null)?.schema === CI_VERIFICATION_PER_JOB_ACTION_ARTIFACT_SCHEMA
    ? parseExactJson(source, 'Per-job Action terminal') : decoded;
  CodexDevelopmentAssertVerificationActionTerminalArtifact(value);
  return value;
}

export function CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic(
  filePath: string,
  artifact: CodexDevelopmentVerificationActionTerminalArtifact
): void {
  CodexDevelopmentAssertVerificationActionTerminalArtifact(artifact);
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

const CodexDevelopmentVerificationSessionArtifactSchema =
  'sec-verification-session-artifact-v2' as const;

/** Historical accepted-attempt projection. Parsing never issues a live qualification. */
export type SourceProgramTransitionAcceptanceRecord = Readonly<SourceProgramTransitionQualification>;

export function parseSourceProgramTransitionAcceptanceRecord(value: unknown): SourceProgramTransitionAcceptanceRecord {
  assertObject(value, 'Source Program transition acceptance record');
  const first = value.schema === 'source-program-transition-qualification-v2';
  const originKeys = first ? ['schema', 'origin', 'sourceActionOutputDigest', 'sourceActionDigest']
    : ['predecessorActionOutputDigest', 'predecessorDisposition'];
  assertExactKeys(value, ['status', 'assessmentDigest', ...originKeys,
    'attemptId', 'actionKey', 'sessionRevision', 'observationDigest',
    'approvalDigest', 'auditResultDigest', 'adoptionDigest', 'attemptEvidenceDigest', 'qualificationDigest'], 'Source Program transition acceptance record');
  if (value.status !== 'accepted' || (first ? value.origin !== 'first-qualified'
    : value.predecessorDisposition !== 'superseded-nonterminal')) {
    throw new Error('Source Program transition record has an invalid qualified origin.');
  }
  for (const key of ['assessmentDigest', 'actionKey', 'sessionRevision',
    'observationDigest', 'auditResultDigest', 'adoptionDigest', 'attemptEvidenceDigest', 'qualificationDigest',
    ...(first ? ['sourceActionOutputDigest', 'sourceActionDigest'] : ['predecessorActionOutputDigest'])]) assertDigest(value[key], key);
  if (value.approvalDigest !== null) assertDigest(value.approvalDigest, 'approvalDigest');
  assertText(value.attemptId, 'Source Program transition attemptId');
  const { qualificationDigest, ...canonical } = value;
  if (qualificationDigest !== CodexDevelopmentVerificationDigest(canonical)) {
    throw new Error('Source Program transition acceptance record digest mismatch.');
  }
  return Object.freeze({ ...value }) as unknown as SourceProgramTransitionAcceptanceRecord;
}

export type CodexDevelopmentVerificationSessionArtifact = Readonly<{
  schema: typeof CodexDevelopmentVerificationSessionArtifactSchema;
  scopeAuthorization: ScopeAuthorization;
  session: VerificationSession;
  preGateReview: ReviewStabilityReceipt;
  mainHealth: MainHealthLedger;
  evidence: CodexDevelopmentVerificationEvidenceV4;
  producer: CodexDevelopmentVerificationEvidenceProducer;
  sourceProgramTransitionAcceptance?: SourceProgramTransitionAcceptanceRecord;
  sourceProgramTransitionEvidence?: TrustedRuntimeSourceProgramAttemptEvidence;
  artifactDigest: string;
}>;

export function CodexDevelopmentFinalizeVerificationSessionArtifact(input: Omit<
  CodexDevelopmentVerificationSessionArtifact,
  'schema' | 'artifactDigest'
>): CodexDevelopmentVerificationSessionArtifact {
  const withoutDigest = Object.freeze({
    schema: CodexDevelopmentVerificationSessionArtifactSchema,
    ...input
  });
  const artifact = Object.freeze({
    ...withoutDigest,
    artifactDigest: CodexDevelopmentVerificationDigest(withoutDigest)
  });
  CodexDevelopmentAssertVerificationSessionArtifact(artifact);
  return artifact;
}

export function CodexDevelopmentAssertVerificationSessionArtifact(
  value: unknown
): asserts value is CodexDevelopmentVerificationSessionArtifact {
  assertObject(value, 'VerificationSession artifact V2');
  if (value.schema !== CodexDevelopmentVerificationSessionArtifactSchema) {
    throw new Error('VerificationSession artifact V2 schema mismatch.');
  }
  assertExactKeys(value, [
    'schema', 'scopeAuthorization', 'session', 'preGateReview', 'mainHealth', 'evidence', 'producer', 'artifactDigest',
    ...(value.sourceProgramTransitionAcceptance === undefined ? [] : ['sourceProgramTransitionAcceptance']),
    ...(value.sourceProgramTransitionEvidence === undefined ? [] : ['sourceProgramTransitionEvidence'])
  ], 'VerificationSession artifact V2');
  const scope = parseScopeAuthorization(encodeVerificationActionData(value.scopeAuthorization));
  const session = parseVerificationSession(encodeVerificationActionData(value.session));
  const review = parseReviewStabilityReceipt(encodeVerificationActionData(value.preGateReview));
  const mainHealth = parseMainHealthLedger(encodeVerificationActionData(value.mainHealth));
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
  const evidence = value.evidence as CodexDevelopmentVerificationEvidenceV4;
  const transitions = evidence.gates.filter(({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID);
  if (transitions.length === 0) {
    if (value.sourceProgramTransitionAcceptance !== undefined || value.sourceProgramTransitionEvidence !== undefined) {
      throw new Error('Unselected Source Program acceptance record.');
    }
  } else {
    const acceptance = parseSourceProgramTransitionAcceptanceRecord(value.sourceProgramTransitionAcceptance);
    assertObject(value.sourceProgramTransitionEvidence, 'Source Program fresh attempt evidence');
    const attempt = value.sourceProgramTransitionEvidence as unknown as TrustedRuntimeSourceProgramAttemptEvidence;
    const { evidenceDigest: attemptEvidenceDigest, ...attemptFields } = attempt;
    if (attempt.schema !== (acceptance.origin === 'first-qualified' ? 'source-program-isolated-attempt-evidence-v2' : 'source-program-isolated-attempt-evidence-v1') || attempt.authority !== 'historical-evidence-only'
        || attemptEvidenceDigest !== CodexDevelopmentVerificationDigest(attemptFields)
        || attemptEvidenceDigest !== acceptance.attemptEvidenceDigest
        || attempt.observation.assessmentDigest !== acceptance.assessmentDigest
        || attempt.observation.observationDigest !== acceptance.observationDigest
        || attempt.observation.executionId !== acceptance.attemptId
        || attempt.observation.actionKey !== acceptance.actionKey
        || attempt.observation.sessionRevision !== acceptance.sessionRevision) {
      throw new Error('Source Program accepted terminal lost its exact fresh producer/physical evidence');
    }
    if (acceptance.origin === 'first-qualified') {
      const sourceAction = parseTrustedRuntimeSourceProgramActionRecord({
        schema: 'source-program-qualified-action-v1', authority: 'historical-evidence-only',
        sessionRevision: acceptance.sessionRevision, observationDigest: acceptance.observationDigest,
        attemptEvidenceDigest: acceptance.attemptEvidenceDigest, outputByteDigest: acceptance.sourceActionOutputDigest,
        gate: transitions[0], sourceActionDigest: acceptance.sourceActionDigest
      });
      const { observationDigest, ...observed } = attempt.observation;
      if (attempt.observation.origin !== 'first-qualified'
          || attempt.observation.schema !== 'source-program-transition-observation-v2'
          || 'predecessorActionOutputDigest' in attempt.observation
          || observationDigest !== CodexDevelopmentVerificationDigest(observed)
          || attempt.observation.settlementDigest !== CodexDevelopmentVerificationDigest(attempt.physicalEvidence.settlements)
          || attempt.physicalEvidence.dependencyCache !== 'private-ephemeral'
          || attempt.physicalEvidence.workspaceTerminal !== 'retired'
          || attempt.physicalEvidence.settlements.length !== 3
          || attempt.physicalEvidence.settlements.map(({ ownerTerminalReference }) => ownerTerminalReference.phase).join(',')
            !== 'setup,owner-operation,cleanup'
          || attempt.observation.baseSha !== session.baseSha || attempt.observation.headSha !== session.headSha
          || attempt.observation.headTreeSha !== session.headTreeSha
          || attempt.assessment.baseSha !== session.baseSha || attempt.assessment.baseTreeSha !== session.baseTreeSha
          || attempt.assessment.headSha !== session.headSha || attempt.assessment.headTreeSha !== session.headTreeSha
          || attempt.assessment.runtimeSha !== session.baseSha
          || attempt.observation.sourceActionOutputDigest !== acceptance.sourceActionOutputDigest
          || acceptance.sourceActionOutputDigest !== `sha256:${createHash('sha256').update(`${encodeVerificationActionData(attempt.assessment)}\n`).digest('hex')}`
          || sourceAction.sourceActionDigest !== acceptance.sourceActionDigest
          || sourceAction.observationDigest !== acceptance.observationDigest
          || sourceAction.sessionRevision !== acceptance.sessionRevision
          || sourceAction.outputByteDigest !== acceptance.sourceActionOutputDigest
          || !canonicalEquals(sourceAction.gate, transitions[0])) {
        throw new Error('Source Program first-qualified Action lost its exact origin/output join.');
      }
    } else if (attempt.observation.origin !== undefined) {
      throw new Error('Legacy Source Program acceptance cannot adopt a first-qualified attempt.');
    }
    const transition = transitions[0]!;
    if (transitions.length !== 1 || acceptance.sessionRevision !== session.sessionRevision
        || acceptance.actionKey !== transition.action.actionKey || transition.result.status !== 'passed'
        || transition.result.evidenceRefs.length !== 1
        || transition.result.evidenceRefs[0] !== (acceptance.origin === 'first-qualified'
          ? acceptance.sourceActionOutputDigest : acceptance.predecessorActionOutputDigest)) {
      throw new Error('Source Program acceptance record does not bind the exact superseded computation.');
    }
  }
  const evidenceProducer = evidence.producer;
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
      session.actionPlanClosureDigest !== (value.evidence as CodexDevelopmentVerificationEvidenceV4).actionPlan.actionPlanDigest ||
      session.mainHealthRef.healthRevision !== mainHealth.healthRevision ||
      session.mainHealthRef.ledgerReceiptDigest !== mainHealth.ledgerDigest ||
      session.mainHealthRef.mainSha !== mainHealth.mainSha || session.mainHealthRef.mainTreeSha !== mainHealth.mainTreeSha) {
    throw new Error('VerificationSession artifact authority closure mismatch.');
  }
  const { sourceDigest: observedProducerDigest, ...producerInput } =
    value.producer as CodexDevelopmentVerificationEvidenceProducer;
  const producer = CodexDevelopmentCreateVerificationEvidenceProducer(producerInput);
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

export function CodexDevelopmentAssertVerificationSessionArtifactCurrent(
  artifact: CodexDevelopmentVerificationSessionArtifact,
  now: string
): void {
  CodexDevelopmentAssertVerificationSessionArtifact(artifact);
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

export type CodexDevelopmentRefreshVerificationSessionArtifactInput = Readonly<{
  previousArtifact: CodexDevelopmentVerificationSessionArtifact;
  scopeAuthorization: ScopeAuthorization;
  session: VerificationSession;
  preGateReview: ReviewStabilityReceipt;
  mainHealth: MainHealthLedger;
  producer: CodexDevelopmentVerificationEvidenceProducer;
  refreshedAt: string;
  sourceProgramTransitionAcceptance?: SourceProgramTransitionAcceptanceRecord;
  sourceProgramTransitionEvidence?: TrustedRuntimeSourceProgramAttemptEvidence;
}>;

/**
 * Re-finalize authority-expired Session Evidence without executing candidate
 * code again. The canonical Action snapshots, Results, cleanup, and aggregate
 * five-state outcome are preserved. Only freshly observed authority receipts,
 * the trusted finalizer provenance, and the enclosing Evidence/artifact
 * digests change. A known failure therefore remains a failure.
 */
export function CodexDevelopmentRefreshVerificationSessionArtifact(
  input: CodexDevelopmentRefreshVerificationSessionArtifactInput
): CodexDevelopmentVerificationSessionArtifact {
  CodexDevelopmentAssertVerificationSessionArtifact(input.previousArtifact);
  const scope = parseScopeAuthorization(encodeVerificationActionData(input.scopeAuthorization));
  const session = parseVerificationSession(encodeVerificationActionData(input.session));
  const review = parseReviewStabilityReceipt(encodeVerificationActionData(input.preGateReview));
  const mainHealth = parseMainHealthLedger(encodeVerificationActionData(input.mainHealth));
  const producer = CodexDevelopmentCreateVerificationEvidenceProducer((() => {
    const { sourceDigest: _sourceDigest, ...producerInput } = input.producer;
    return producerInput;
  })());
  if (!canonicalEquals(producer, input.producer)) {
    throw new Error('VerificationSession refresh producer provenance is forged.');
  }
  const hostedProducer = producer.sourceTransport === 'github-actions'
    && producer.workflowPath === '.github/workflows/compiler-pr-validation.yml'
    && producer.workflowRef === `.github/workflows/compiler-pr-validation.yml@${session.baseSha}`;
  const isolatedProducer = producer.sourceTransport === 'local-dev-runner'
    && producer.workflowPath === CI_VERIFICATION_WORKFLOW_PATH
    && producer.workflowRef === `${CI_VERIFICATION_WORKFLOW_PATH}@${session.baseSha}`;
  if ((!hostedProducer && !isolatedProducer) || producer.workflowSha !== session.baseSha) {
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
      mainHealth.ledgerDigest === previous.mainHealth.ledgerDigest
      && input.sourceProgramTransitionAcceptance?.qualificationDigest
        === previous.sourceProgramTransitionAcceptance?.qualificationDigest) {
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
  const refreshed = CodexDevelopmentFinalizeVerificationSessionArtifact({
    scopeAuthorization: scope,
    session,
    preGateReview: review,
    mainHealth,
    evidence: refreshedEvidence,
    producer,
    ...(input.sourceProgramTransitionAcceptance === undefined ? {} : {
      sourceProgramTransitionAcceptance: parseSourceProgramTransitionAcceptanceRecord(input.sourceProgramTransitionAcceptance),
      sourceProgramTransitionEvidence: input.sourceProgramTransitionEvidence!
    })
  });
  CodexDevelopmentAssertVerificationSessionArtifactCurrent(refreshed, input.refreshedAt);
  return refreshed;
}

export function CodexDevelopmentParseVerificationSessionArtifact(
  source: string
): CodexDevelopmentVerificationSessionArtifact {
  const parsed = JSON.parse(source) as unknown;
  CodexDevelopmentAssertVerificationSessionArtifact(parsed);
  return parsed;
}
