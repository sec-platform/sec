import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { VERIFICATION_GATE_RESULT_SCHEMA } from '../../../../../assurance/verification/result/contract/schema.ts';
import { assertCanonicalPortableLogicalPath } from '../../../../../contracts/logical-path.ts';
import { isRepositoryTestModulePath } from '../../../../../contracts/repository-test-path.ts';
import {
  createVerificationActionKey,
  createVerificationActionPlan,
  encodeVerificationActionData,
  parseVerificationActionPlan,
  type VerificationActionExecutionClass,
  type VerificationActionInputRef,
  type VerificationActionKeyDigest,
  type VerificationActionPlan
} from './action.ts';
import {
  CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS,
  CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION,
  CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
  CI_VERIFICATION_HOSTED_TOOLCHAIN_REVISION
} from './environment.ts';

export const CI_VERIFICATION_ACTION_DISPATCH_TYPE =
  'sec-produce-verification-action-v2' as const;
const CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA =
  'sec-verification-action-proposal-v2' as const;
const CI_VERIFICATION_ACTION_PARENT_DISPATCH_PROPOSAL_SET_SCHEMA =
  'sec-verification-action-parent-dispatch-proposal-set-v2' as const;
const CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA =
  'sec-verification-action-parent-dispatch-plan-v2' as const;
const CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA =
  'sec-verification-action-provider-envelope-v2' as const;
export const CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE =
  'verification-action-parent-dispatch-plan.json' as const;
const CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX =
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA;
const CI_VERIFICATION_ACTION_PARENT_JOB_NAME =
  'coordinate-verification-session' as const;
const CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME =
  'Prepare canonical parent Action dispatch plan' as const;

export type CiVerificationGatePhase = 'quick' | 'risk' | 'full' | 'workspace';

export type CiVerificationGateStep = Readonly<{
  id: string;
  phase: CiVerificationGatePhase;
  args: string[];
}>;

const CI_VERIFICATION_ACTION_PRODUCER_REVISION =
  'sec-ci-verification-action-producer-v2' as const;
const CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA =
  'sec-ci-verification-action-plan-closure-v2' as const;

export type CiVerificationActionDigest = `sha256:${string}`;

export type CiVerificationActionSessionRequest = Readonly<object>;

export type CiVerificationActionProposal = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA;
  sessionRequest: CiVerificationActionSessionRequest;
  proposedActionKey: VerificationActionKeyDigest;
}>;

export type CiVerificationActionParentActor = Readonly<{
  login: string;
  id: number;
  nodeId: string;
  type: 'User';
  permission: 'maintain' | 'admin';
}>;

export type CiVerificationActionParentDispatchPlan = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA;
  repositoryId: string;
  repository: string;
  parentRunId: string;
  parentRunAttempt: number;
  parentJobId: string;
  parentJobName: typeof CI_VERIFICATION_ACTION_PARENT_JOB_NAME;
  parentPlanStepName: typeof CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME;
  parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml';
  parentWorkflowRef: string;
  parentWorkflowSha: string;
  parentActor: CiVerificationActionParentActor;
  proposals: readonly CiVerificationActionProposal[];
  parentDispatchPlanDigest: CiVerificationActionDigest;
}>;

export type CiVerificationActionProviderEnvelope = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA;
  proposal: CiVerificationActionProposal;
  parentRunId: string;
  parentRunAttempt: number;
  parentJobId: string;
  parentJobName: typeof CI_VERIFICATION_ACTION_PARENT_JOB_NAME;
  parentPlanStepName: typeof CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME;
  parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml';
  parentWorkflowRef: string;
  parentWorkflowSha: string;
  parentDispatchPlanDigest: CiVerificationActionDigest;
  parentDispatchPlanArtifactId: string;
  parentDispatchPlanArtifactName: string;
  parentDispatchPlanArchiveDigest: CiVerificationActionDigest;
  parentDispatchPlanPayloadDigest: CiVerificationActionDigest;
}>;

export type CiVerificationExecutionEnvironment = Readonly<{
  contractRevision: typeof CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION;
  kind: 'hosted' | 'local';
  os: string;
  arch: string;
  runnerImage: string | null;
  toolchainRevision: string;
  executionEnvironmentRevision: string;
}>;

export const CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT: CiVerificationExecutionEnvironment =
  Object.freeze({
    contractRevision: CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION,
    kind: 'hosted',
    os: 'linux',
    arch: 'x64',
    runnerImage: 'ubuntu-24.04',
    toolchainRevision: CI_VERIFICATION_HOSTED_TOOLCHAIN_REVISION,
    executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION
  });

export function createCiVerificationLocalExecutionEnvironment(input: {
  readonly os: string;
  readonly arch: string;
  readonly bunVersion: string;
}): CiVerificationExecutionEnvironment {
  const os = text(input.os, 'local execution environment os').toLowerCase();
  const arch = text(input.arch, 'local execution environment arch').toLowerCase();
  const bunVersion = text(input.bunVersion, 'local execution environment Bun version');
  if (!/^[a-z0-9._-]+$/u.test(os) || !/^[a-z0-9._-]+$/u.test(arch) ||
      !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/u.test(bunVersion)) {
    fail('local execution environment contains a non-canonical platform or Bun revision.');
  }
  const toolchainRevision = `bun@${bunVersion}`;
  return Object.freeze({
    contractRevision: CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION,
    kind: 'local',
    os,
    arch,
    runnerImage: null,
    toolchainRevision,
    executionEnvironmentRevision: `local-dev-runner:${os}:${arch}:bun-${bunVersion}:action-producer-v2`
  });
}

function canonicalExecutionEnvironmentRevision(providerRevision: string): string {
  const revision = text(providerRevision, 'candidate.providerRevision');
  // The Session runtime still supplies the former hosted provider label. It is
  // an input spelling only: the Action producer always compiles it to the one
  // active environment revision before hashing or serializing an Action.
  return revision === 'github-actions@trusted-default'
    ? CI_VERIFICATION_HOSTED_PROVIDER_REVISION
    : revision;
}

export interface CiVerificationActionCandidate {
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: CiVerificationActionDigest;
  readonly scopeAuthorizationRevision: CiVerificationActionDigest;
  readonly profile: 'quick' | 'full';
  readonly toolchainRevision: string;
  /** Canonical executionEnvironmentRevision compiled into Action.environment.providerRevision. */
  readonly providerRevision: string;
  readonly contractRevision: string;
  readonly requiredBlobs: readonly VerificationActionInputRef[];
}

export interface CiVerificationProducerGate {
  readonly id: string;
  readonly phase: CiVerificationGatePhase;
  readonly argv: readonly string[];
  readonly runtime: string;
  readonly environment: Readonly<Record<string, CiVerificationActionDigest>>;
  readonly coveredScopeIds: readonly string[];
}

export interface CiVerificationActionPlanClosure {
  readonly schema: typeof CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA;
  readonly producerRevision: typeof CI_VERIFICATION_ACTION_PRODUCER_REVISION;
  readonly actions: readonly VerificationActionPlan[];
  readonly normalizedOperations: readonly CiVerificationNormalizedOperation[];
  readonly actionPlanDigest: CiVerificationActionDigest;
}

type CiVerificationNormalizedTarget =
  | Readonly<{
      kind: 'bun-package-script';
      identity: string;
      readonly args: readonly string[];
    }>
  | Readonly<{
      kind: 'bun-test';
      identity: 'test';
      readonly args: readonly string[];
    }>
  | Readonly<{
      kind: 'bun-typescript-entrypoint';
      identity: string;
      readonly args: readonly string[];
    }>;

export type CiVerificationNormalizedOperation = Readonly<{
  schema: 'sec-ci-verification-normalized-operation-v2';
  gateId: string;
  phase: CiVerificationGatePhase;
  runtime: 'bun';
  workingDirectory: '.';
  target: CiVerificationNormalizedTarget;
  environmentBindings: readonly Readonly<{ name: string; digest: CiVerificationActionDigest }>[];
  coveredScopeIds: readonly string[];
  candidate: Readonly<{
    baseSha: string;
    baseTreeSha: string;
    headSha: string;
    headTreeSha: string;
    manifestDigest: CiVerificationActionDigest;
    scopeAuthorizationRevision: CiVerificationActionDigest;
    profile: 'quick' | 'full';
    executionEnvironmentRevision: string;
  }>;
  semanticDigest: CiVerificationActionDigest;
}>;

export function ciVerificationNormalizedOperationArgv(
  operation: CiVerificationNormalizedOperation
): readonly string[] {
  const parsed = parseCiVerificationNormalizedOperation(operation);
  if (parsed.target.kind === 'bun-package-script') {
    return Object.freeze(['bun', 'run', parsed.target.identity, ...parsed.target.args]);
  }
  if (parsed.target.kind === 'bun-test') {
    return Object.freeze(['bun', 'test', ...parsed.target.args]);
  }
  return Object.freeze(['bun', parsed.target.identity, ...parsed.target.args]);
}

function fail(message: string): never {
  throw new Error(`CI VerificationAction ${message}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) {
    fail(`${label} must be bounded text.`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a lowercase Git SHA.`);
  return result;
}

function digest(value: unknown, label: string): CiVerificationActionDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be a SHA-256 digest.`);
  }
  return value as CiVerificationActionDigest;
}

function hash(value: unknown): CiVerificationActionDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

function hashCanonicalLine(value: unknown): CiVerificationActionDigest {
  return `sha256:${rawSha256Hex(`${encodeVerificationActionData(value)}\n`)}`;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length || actual.some((entry, index) => entry !== canonical[index])) {
    fail(`${label} fields are not exact.`);
  }
}

function positiveDecimal(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[1-9][0-9]*$/u.test(result)) fail(`${label} must be a positive decimal string.`);
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function canonicalJsonObject(value: unknown, label: string): CiVerificationActionSessionRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one JSON object.`);
  }
  const encoded = encodeVerificationActionData(value);
  if (Buffer.byteLength(encoded, 'utf8') > 65_536) fail(`${label} exceeds the canonical size bound.`);
  const parsed = JSON.parse(encoded) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} canonical bytes must decode to one JSON object.`);
  }
  return Object.freeze(parsed as Record<string, unknown>);
}

function repositoryName(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) {
    fail(`${label} must be an exact owner/repository name.`);
  }
  return result;
}

function parentWorkflowRef(value: unknown, repository: string): string {
  const result = text(value, 'parentWorkflowRef');
  const expected = `${repository}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`;
  if (result !== expected) fail('parentWorkflowRef must identify the exact trusted main workflow ref.');
  return result;
}

function parseParentActor(value: unknown): CiVerificationActionParentActor {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('parentActor must be one object.');
  const record = value as Record<string, unknown>;
  exactKeys(record, ['id', 'login', 'nodeId', 'permission', 'type'], 'parentActor');
  const login = text(record.login, 'parentActor.login');
  const id = positiveInteger(record.id, 'parentActor.id');
  const nodeId = text(record.nodeId, 'parentActor.nodeId');
  if (record.type !== 'User') fail('parentActor.type must be User.');
  if (record.permission !== 'maintain' && record.permission !== 'admin') {
    fail('parentActor.permission must be maintain or admin.');
  }
  return Object.freeze({ login, id, nodeId, type: 'User' as const, permission: record.permission });
}

export function createCiVerificationActionProposal(input: Readonly<{
  sessionRequest: CiVerificationActionSessionRequest;
  proposedActionKey: VerificationActionKeyDigest;
}>): CiVerificationActionProposal {
  return parseCiVerificationActionProposal({
    schema: CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA,
    sessionRequest: input.sessionRequest,
    proposedActionKey: input.proposedActionKey
  });
}

export function parseCiVerificationActionProposal(value: unknown): CiVerificationActionProposal {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('proposal must be one object.');
  const record = value as Record<string, unknown>;
  exactKeys(record, ['proposedActionKey', 'schema', 'sessionRequest'], 'proposal');
  if (record.schema !== CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA) fail('proposal schema mismatch.');
  const proposedActionKey = digest(record.proposedActionKey, 'proposal.proposedActionKey') as VerificationActionKeyDigest;
  return Object.freeze({
    schema: CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA,
    sessionRequest: canonicalJsonObject(record.sessionRequest, 'proposal.sessionRequest'),
    proposedActionKey
  });
}

function proposalSetDigest(proposals: readonly CiVerificationActionProposal[]): CiVerificationActionDigest {
  return hash({
    schema: CI_VERIFICATION_ACTION_PARENT_DISPATCH_PROPOSAL_SET_SCHEMA,
    proposals
  });
}

function canonicalProposals(value: unknown): readonly CiVerificationActionProposal[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    fail('parent dispatch proposals must be a non-empty bounded array.');
  }
  const proposals = value.map((entry) => parseCiVerificationActionProposal(entry));
  const sorted = [...proposals].sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey));
  if (new Set(sorted.map((entry) => entry.proposedActionKey)).size !== sorted.length) {
    fail('parent dispatch proposals contain duplicate ActionKeys.');
  }
  if (encodeVerificationActionData(proposals) !== encodeVerificationActionData(sorted)) {
    fail('parent dispatch proposals are not in canonical ActionKey order.');
  }
  return Object.freeze(sorted);
}

export function ciVerificationActionParentDispatchPlanArtifactName(
  parentRunId: string,
  parentRunAttempt: number
): string {
  return `${CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX}-run-${positiveDecimal(
    parentRunId,
    'parentRunId'
  )}-attempt-${positiveInteger(parentRunAttempt, 'parentRunAttempt')}`;
}

export function ciVerificationActionParentDispatchPlanFile():
  typeof CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE {
  return CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE;
}

export function createCiVerificationActionParentDispatchPlan(input: Readonly<{
  repositoryId: string;
  repository: string;
  parentRunId: string;
  parentRunAttempt: number;
  parentJobId: string;
  parentWorkflowRef: string;
  parentWorkflowSha: string;
  parentActor: CiVerificationActionParentActor;
  proposals: readonly CiVerificationActionProposal[];
}>): CiVerificationActionParentDispatchPlan {
  const proposals = [...input.proposals]
    .map((entry) => parseCiVerificationActionProposal(entry))
    .sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey));
  return parseCiVerificationActionParentDispatchPlan({
    schema: CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA,
    repositoryId: input.repositoryId,
    repository: input.repository,
    parentRunId: input.parentRunId,
    parentRunAttempt: input.parentRunAttempt,
    parentJobId: input.parentJobId,
    parentJobName: CI_VERIFICATION_ACTION_PARENT_JOB_NAME,
    parentPlanStepName: CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME,
    parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml',
    parentWorkflowRef: input.parentWorkflowRef,
    parentWorkflowSha: input.parentWorkflowSha,
    parentActor: input.parentActor,
    proposals,
    parentDispatchPlanDigest: proposalSetDigest(proposals)
  });
}

export function parseCiVerificationActionParentDispatchPlan(
  value: unknown
): CiVerificationActionParentDispatchPlan {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('parent dispatch plan must be one object.');
  }
  const record = value as Record<string, unknown>;
  exactKeys(record, [
    'parentActor', 'parentDispatchPlanDigest', 'parentJobId', 'parentJobName',
    'parentPlanStepName', 'parentRunAttempt', 'parentRunId', 'parentWorkflowPath',
    'parentWorkflowRef', 'parentWorkflowSha', 'proposals', 'repository', 'repositoryId', 'schema'
  ], 'parent dispatch plan');
  if (record.schema !== CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA) {
    fail('parent dispatch plan schema mismatch.');
  }
  const repository = repositoryName(record.repository, 'parent dispatch plan repository');
  const repositoryId = positiveDecimal(record.repositoryId, 'parent dispatch plan repositoryId');
  const parentRunId = positiveDecimal(record.parentRunId, 'parent dispatch plan parentRunId');
  const parentRunAttempt = positiveInteger(record.parentRunAttempt, 'parent dispatch plan parentRunAttempt');
  const parentJobId = positiveDecimal(record.parentJobId, 'parent dispatch plan parentJobId');
  if (record.parentJobName !== CI_VERIFICATION_ACTION_PARENT_JOB_NAME
    || record.parentPlanStepName !== CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME) {
    fail('parent dispatch plan job or producer step is not canonical.');
  }
  if (record.parentWorkflowPath !== '.github/workflows/compiler-pr-validation.yml') {
    fail('parent dispatch plan workflow path is not canonical.');
  }
  const parentWorkflowSha = sha(record.parentWorkflowSha, 'parent dispatch plan parentWorkflowSha');
  const proposals = canonicalProposals(record.proposals);
  const parentDispatchPlanDigest = digest(
    record.parentDispatchPlanDigest,
    'parent dispatch plan parentDispatchPlanDigest'
  );
  if (parentDispatchPlanDigest !== proposalSetDigest(proposals)) {
    fail('parent dispatch plan digest does not bind the exact sorted proposals.');
  }
  return Object.freeze({
    schema: CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA,
    repositoryId,
    repository,
    parentRunId,
    parentRunAttempt,
    parentJobId,
    parentJobName: CI_VERIFICATION_ACTION_PARENT_JOB_NAME,
    parentPlanStepName: CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME,
    parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    parentWorkflowRef: parentWorkflowRef(record.parentWorkflowRef, repository),
    parentWorkflowSha,
    parentActor: parseParentActor(record.parentActor),
    proposals,
    parentDispatchPlanDigest
  });
}

export function ciVerificationActionParentDispatchPlanPayloadDigest(
  plan: CiVerificationActionParentDispatchPlan
): CiVerificationActionDigest {
  return hashCanonicalLine(parseCiVerificationActionParentDispatchPlan(plan));
}

export function createCiVerificationActionProviderEnvelope(input: Readonly<{
  proposal: CiVerificationActionProposal;
  parentPlan: CiVerificationActionParentDispatchPlan;
  parentDispatchPlanArtifactId: string;
  parentDispatchPlanArchiveDigest: CiVerificationActionDigest;
}>): CiVerificationActionProviderEnvelope {
  const parentPlan = parseCiVerificationActionParentDispatchPlan(input.parentPlan);
  const proposal = parseCiVerificationActionProposal(input.proposal);
  assertCiVerificationActionProposalMember(proposal, parentPlan);
  return parseCiVerificationActionProviderEnvelope({
    schema: CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA,
    proposal,
    parentRunId: parentPlan.parentRunId,
    parentRunAttempt: parentPlan.parentRunAttempt,
    parentJobId: parentPlan.parentJobId,
    parentJobName: parentPlan.parentJobName,
    parentPlanStepName: parentPlan.parentPlanStepName,
    parentWorkflowPath: parentPlan.parentWorkflowPath,
    parentWorkflowRef: parentPlan.parentWorkflowRef,
    parentWorkflowSha: parentPlan.parentWorkflowSha,
    parentDispatchPlanDigest: parentPlan.parentDispatchPlanDigest,
    parentDispatchPlanArtifactId: input.parentDispatchPlanArtifactId,
    parentDispatchPlanArtifactName: ciVerificationActionParentDispatchPlanArtifactName(
      parentPlan.parentRunId,
      parentPlan.parentRunAttempt
    ),
    parentDispatchPlanArchiveDigest: input.parentDispatchPlanArchiveDigest,
    parentDispatchPlanPayloadDigest: ciVerificationActionParentDispatchPlanPayloadDigest(parentPlan)
  });
}

export function parseCiVerificationActionProviderEnvelope(
  value: unknown
): CiVerificationActionProviderEnvelope {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('provider envelope must be one object.');
  }
  const record = value as Record<string, unknown>;
  exactKeys(record, [
    'parentDispatchPlanArchiveDigest', 'parentDispatchPlanArtifactId',
    'parentDispatchPlanArtifactName', 'parentDispatchPlanDigest',
    'parentDispatchPlanPayloadDigest', 'parentJobId', 'parentJobName', 'parentPlanStepName',
    'parentRunAttempt', 'parentRunId', 'parentWorkflowPath', 'parentWorkflowRef',
    'parentWorkflowSha', 'proposal', 'schema'
  ], 'provider envelope');
  if (record.schema !== CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA) {
    fail('provider envelope schema mismatch.');
  }
  const parentRunId = positiveDecimal(record.parentRunId, 'provider envelope parentRunId');
  const parentRunAttempt = positiveInteger(record.parentRunAttempt, 'provider envelope parentRunAttempt');
  const parentJobId = positiveDecimal(record.parentJobId, 'provider envelope parentJobId');
  if (record.parentJobName !== CI_VERIFICATION_ACTION_PARENT_JOB_NAME
    || record.parentPlanStepName !== CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME) {
    fail('provider envelope parent job or producer step is not canonical.');
  }
  if (record.parentWorkflowPath !== '.github/workflows/compiler-pr-validation.yml') {
    fail('provider envelope workflow path is not canonical.');
  }
  const parentDispatchPlanArtifactName = text(
    record.parentDispatchPlanArtifactName,
    'provider envelope parentDispatchPlanArtifactName'
  );
  if (parentDispatchPlanArtifactName !== ciVerificationActionParentDispatchPlanArtifactName(
    parentRunId,
    parentRunAttempt
  )) {
    fail('provider envelope artifact name does not bind the parent run and attempt.');
  }
  return Object.freeze({
    schema: CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA,
    proposal: parseCiVerificationActionProposal(record.proposal),
    parentRunId,
    parentRunAttempt,
    parentJobId,
    parentJobName: CI_VERIFICATION_ACTION_PARENT_JOB_NAME,
    parentPlanStepName: CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME,
    parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    parentWorkflowRef: text(record.parentWorkflowRef, 'provider envelope parentWorkflowRef'),
    parentWorkflowSha: sha(record.parentWorkflowSha, 'provider envelope parentWorkflowSha'),
    parentDispatchPlanDigest: digest(record.parentDispatchPlanDigest, 'provider envelope parentDispatchPlanDigest'),
    parentDispatchPlanArtifactId: positiveDecimal(
      record.parentDispatchPlanArtifactId,
      'provider envelope parentDispatchPlanArtifactId'
    ),
    parentDispatchPlanArtifactName,
    parentDispatchPlanArchiveDigest: digest(
      record.parentDispatchPlanArchiveDigest,
      'provider envelope parentDispatchPlanArchiveDigest'
    ),
    parentDispatchPlanPayloadDigest: digest(
      record.parentDispatchPlanPayloadDigest,
      'provider envelope parentDispatchPlanPayloadDigest'
    )
  });
}

function assertCiVerificationActionProposalMember(
  proposal: CiVerificationActionProposal,
  parentPlan: CiVerificationActionParentDispatchPlan
): void {
  const parsedProposal = parseCiVerificationActionProposal(proposal);
  const parsedPlan = parseCiVerificationActionParentDispatchPlan(parentPlan);
  const matches = parsedPlan.proposals.filter((entry) =>
    encodeVerificationActionData(entry) === encodeVerificationActionData(parsedProposal));
  if (matches.length !== 1) fail('provider proposal is not one exact member of the parent dispatch plan.');
}

export function assertCiVerificationActionProviderEnvelopeMember(
  envelope: CiVerificationActionProviderEnvelope,
  parentPlan: CiVerificationActionParentDispatchPlan
): void {
  const parsedEnvelope = parseCiVerificationActionProviderEnvelope(envelope);
  const parsedPlan = parseCiVerificationActionParentDispatchPlan(parentPlan);
  if (parsedEnvelope.parentRunId !== parsedPlan.parentRunId
    || parsedEnvelope.parentRunAttempt !== parsedPlan.parentRunAttempt
    || parsedEnvelope.parentJobId !== parsedPlan.parentJobId
    || parsedEnvelope.parentJobName !== parsedPlan.parentJobName
    || parsedEnvelope.parentPlanStepName !== parsedPlan.parentPlanStepName
    || parsedEnvelope.parentWorkflowPath !== parsedPlan.parentWorkflowPath
    || parsedEnvelope.parentWorkflowRef !== parsedPlan.parentWorkflowRef
    || parsedEnvelope.parentWorkflowSha !== parsedPlan.parentWorkflowSha
    || parsedEnvelope.parentDispatchPlanDigest !== parsedPlan.parentDispatchPlanDigest
    || parsedEnvelope.parentDispatchPlanArtifactName !== ciVerificationActionParentDispatchPlanArtifactName(
      parsedPlan.parentRunId,
      parsedPlan.parentRunAttempt
    )
    || parsedEnvelope.parentDispatchPlanPayloadDigest !==
      ciVerificationActionParentDispatchPlanPayloadDigest(parsedPlan)) {
    fail('provider envelope does not bind the exact parent plan provenance and bytes.');
  }
  assertCiVerificationActionProposalMember(parsedEnvelope.proposal, parsedPlan);
}

function canonicalStrings(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) fail(`${label} must be an array.`);
  const result = values.map((value, index) => text(value, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates.`);
  return Object.freeze(result);
}

function canonicalGateArgv(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values)) fail(`${label} must be an array.`);
  if (values[0] === 'bun' && values[1] === 'test') {
    if (values.some((value) => typeof value !== 'string')) {
      fail(`${label} direct Bun test values must be strings.`);
    }
    return Object.freeze([...values]);
  }
  return canonicalStrings(values, label);
}

function canonicalInputs(
  candidate: CiVerificationActionCandidate
): readonly VerificationActionInputRef[] {
  const inputs = [
    ...candidate.requiredBlobs,
    { path: candidate.manifestPath, digest: candidate.manifestDigest }
  ].map((entry, index) => ({
    path: text(entry.path, `requiredBlobs[${index}].path`),
    digest: digest(entry.digest, `requiredBlobs[${index}].digest`)
  }));
  const byPath = new Map<string, CiVerificationActionDigest>();
  for (const input of inputs) {
    const previous = byPath.get(input.path);
    if (previous !== undefined && previous !== input.digest) {
      fail(`input closure contains conflicting digests for ${input.path}.`);
    }
    byPath.set(input.path, input.digest);
  }
  for (const requiredPath of CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS) {
    if (!byPath.has(requiredPath)) {
      fail(`input closure omits canonical dependency input ${requiredPath}.`);
    }
  }
  return Object.freeze([...byPath].sort(([left], [right]) => left.localeCompare(right)).map(
    ([inputPath, inputDigest]) => Object.freeze({ path: inputPath, digest: inputDigest })
  ));
}

function executionClass(phase: CiVerificationGatePhase): VerificationActionExecutionClass {
  return phase === 'quick' ? 'cheap-preflight' : 'expensive';
}

function canonicalBunTestArguments(args: readonly string[]): readonly string[] {
  let index = 0;
  const paths = new Set<string>();
  while (index < args.length && !args[index]!.startsWith('-')) {
    const testPath = text(args[index], `gate Bun test path[${index}]`);
    try {
      assertCanonicalPortableLogicalPath(testPath, 'gate Bun test path');
    } catch {
      fail('gate Bun test path is not canonical and repository-relative.');
    }
    if (!isRepositoryTestModulePath(testPath)) {
      fail('gate Bun test path is not canonical and repository-relative.');
    }
    if (paths.has(testPath)) fail('gate Bun test paths must be unique.');
    paths.add(testPath);
    index += 1;
  }
  if (index === 0) fail('gate Bun test requires at least one canonical test path.');

  if (args[index] === '--test-name-pattern') {
    const pattern = args[index + 1];
    if (typeof pattern !== 'string' || pattern.length === 0 ||
        /[\u0000-\u001f]/u.test(pattern) || Buffer.byteLength(pattern, 'utf8') > 8_192) {
      fail('gate Bun test-name pattern must be nonempty bounded text.');
    }
    try {
      new RegExp(pattern);
    } catch {
      fail('gate Bun test-name pattern must be a valid regular expression.');
    }
    index += 2;
  }
  if (args[index] === '--timeout') {
    const timeout = Number(positiveDecimal(args[index + 1], 'gate Bun test timeout'));
    if (!Number.isSafeInteger(timeout) || timeout > 300_000) {
      fail('gate Bun test timeout exceeds the canonical bound.');
    }
    index += 2;
  }
  if (index !== args.length) {
    fail('gate Bun test arguments are outside the canonical producer-owned grammar.');
  }
  return Object.freeze([...args]);
}

function assertCandidate(candidate: CiVerificationActionCandidate): void {
  sha(candidate.baseSha, 'candidate.baseSha');
  sha(candidate.baseTreeSha, 'candidate.baseTreeSha');
  sha(candidate.headSha, 'candidate.headSha');
  sha(candidate.headTreeSha, 'candidate.headTreeSha');
  text(candidate.manifestPath, 'candidate.manifestPath');
  digest(candidate.manifestDigest, 'candidate.manifestDigest');
  digest(candidate.scopeAuthorizationRevision, 'candidate.scopeAuthorizationRevision');
  if (candidate.profile !== 'quick' && candidate.profile !== 'full') fail('candidate.profile is invalid.');
  text(candidate.toolchainRevision, 'candidate.toolchainRevision');
  text(candidate.providerRevision, 'candidate.providerRevision');
  text(candidate.contractRevision, 'candidate.contractRevision');
}

export function ciVerificationGateStep(step: CiVerificationGateStep): CiVerificationProducerGate {
  return Object.freeze({
    id: text(step.id, 'gate.id'),
    phase: step.phase,
    argv: Object.freeze(['bun', ...canonicalStrings(step.args, 'gate.args')]),
    runtime: 'bun',
    environment: Object.freeze({}),
    coveredScopeIds: Object.freeze([])
  });
}

function normalizedTarget(argv: readonly string[]): CiVerificationNormalizedTarget {
  if (argv.length < 2 || argv[0] !== 'bun') fail('gate.argv must be a producer-owned Bun invocation.');
  if (argv[1] === 'run') {
    const identity = text(argv[2], 'gate package script');
    if (!/^[a-z0-9][a-z0-9:_-]*$/u.test(identity)) fail('gate package script identity is invalid.');
    return Object.freeze({
      kind: 'bun-package-script',
      identity,
      args: Object.freeze(argv.slice(3))
    });
  }
  if (argv[1] === 'test') {
    return Object.freeze({
      kind: 'bun-test',
      identity: 'test',
      args: canonicalBunTestArguments(argv.slice(2))
    });
  }
  const identity = text(argv[1], 'gate TypeScript entrypoint');
  if (!/^scripts\/[a-z0-9][a-z0-9._/-]*\.[cm]?ts$/u.test(identity) || identity.includes('..')) {
    fail('gate TypeScript entrypoint is not a canonical producer-owned script path.');
  }
  return Object.freeze({
    kind: 'bun-typescript-entrypoint',
    identity,
    args: Object.freeze(argv.slice(2))
  });
}

function operationWithoutDigest(input: Omit<CiVerificationNormalizedOperation, 'semanticDigest'>): Omit<
  CiVerificationNormalizedOperation,
  'semanticDigest'
> {
  return Object.freeze(input);
}

function normalizeCiVerificationOperation(options: {
  readonly candidate: CiVerificationActionCandidate;
  readonly gate: CiVerificationProducerGate;
}): CiVerificationNormalizedOperation {
  assertCandidate(options.candidate);
  const gate = options.gate;
  const gateId = text(gate.id, 'gate.id');
  if (!['quick', 'risk', 'full', 'workspace'].includes(gate.phase)) fail('gate.phase is invalid.');
  const argv = canonicalGateArgv(gate.argv, 'gate.argv');
  const runtime = text(gate.runtime, 'gate.runtime');
  if (runtime !== 'bun') fail('gate.runtime must be the canonical Bun runtime.');
  const executionEnvironmentRevision = canonicalExecutionEnvironmentRevision(
    options.candidate.providerRevision
  );
  const environmentBindings = Object.freeze(Object.entries({
    ...gate.environment,
    SEC_EXECUTION_ENVIRONMENT_REVISION: hash(executionEnvironmentRevision)
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(
    ([name, value]) => Object.freeze({
      name: text(name, 'gate.environment name'),
      digest: digest(value, `gate.environment.${name}`)
    })
  ));
  const coveredScopeIds = canonicalStrings(gate.coveredScopeIds, 'gate.coveredScopeIds');
  const withoutDigest = operationWithoutDigest({
    schema: 'sec-ci-verification-normalized-operation-v2',
    gateId,
    phase: gate.phase,
    runtime: 'bun',
    workingDirectory: '.',
    target: normalizedTarget(argv),
    environmentBindings,
    coveredScopeIds,
    candidate: Object.freeze({
      baseSha: sha(options.candidate.baseSha, 'candidate.baseSha'),
      baseTreeSha: sha(options.candidate.baseTreeSha, 'candidate.baseTreeSha'),
      headSha: sha(options.candidate.headSha, 'candidate.headSha'),
      headTreeSha: sha(options.candidate.headTreeSha, 'candidate.headTreeSha'),
      manifestDigest: options.candidate.manifestDigest,
      scopeAuthorizationRevision: options.candidate.scopeAuthorizationRevision,
      profile: options.candidate.profile,
      executionEnvironmentRevision
    })
  });
  return Object.freeze({ ...withoutDigest, semanticDigest: hash(withoutDigest) });
}

export function parseCiVerificationNormalizedOperation(value: unknown): CiVerificationNormalizedOperation {
  const candidate = value as Record<string, unknown>;
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('normalized operation must be an object.');
  }
  const actual = Object.keys(candidate).sort();
  const expected = [
    'schema', 'gateId', 'phase', 'runtime', 'workingDirectory', 'target', 'environmentBindings',
    'coveredScopeIds', 'candidate', 'semanticDigest'
  ].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('normalized operation fields are invalid.');
  }
  if (candidate.schema !== 'sec-ci-verification-normalized-operation-v2' || candidate.runtime !== 'bun' ||
      candidate.workingDirectory !== '.' || !['quick', 'risk', 'full', 'workspace'].includes(String(candidate.phase))) {
    fail('normalized operation identity is invalid.');
  }
  const targetRecord = candidate.target as Record<string, unknown>;
  if (targetRecord === null || typeof targetRecord !== 'object' || Array.isArray(targetRecord) ||
      Object.keys(targetRecord).sort().join(',') !== 'args,identity,kind' || !Array.isArray(targetRecord.args)) {
    fail('normalized operation target is invalid.');
  }
  const targetIdentity = text(targetRecord.identity, 'normalized target identity');
  const targetArgv = targetRecord.kind === 'bun-package-script'
    ? ['bun', 'run', targetIdentity, ...targetRecord.args as string[]]
    : targetRecord.kind === 'bun-test'
      ? targetIdentity === 'test'
        ? ['bun', targetIdentity, ...targetRecord.args as string[]]
        : fail('normalized Bun test target identity must be test.')
    : targetRecord.kind === 'bun-typescript-entrypoint'
      ? ['bun', targetIdentity, ...targetRecord.args as string[]]
      : fail('normalized operation target kind is invalid.');
  const target = normalizedTarget(canonicalGateArgv(targetArgv, 'normalized target argv'));
  if (!Array.isArray(candidate.environmentBindings) || !Array.isArray(candidate.coveredScopeIds)) {
    fail('normalized operation bindings or scopes are invalid.');
  }
  const environmentBindings = Object.freeze((candidate.environmentBindings as unknown[]).map((entry, index) => {
    const binding = entry as Record<string, unknown>;
    if (binding === null || typeof binding !== 'object' || Array.isArray(binding) ||
        Object.keys(binding).sort().join(',') !== 'digest,name') fail(`normalized environment[${index}] is invalid.`);
    return Object.freeze({
      name: text(binding.name, `normalized environment[${index}].name`),
      digest: digest(binding.digest, `normalized environment[${index}].digest`)
    });
  }));
  const candidateBinding = candidate.candidate as Record<string, unknown>;
  if (candidateBinding === null || typeof candidateBinding !== 'object' || Array.isArray(candidateBinding) ||
      Object.keys(candidateBinding).sort().join(',') !== [
        'baseSha', 'baseTreeSha', 'executionEnvironmentRevision', 'headSha', 'headTreeSha',
        'manifestDigest', 'profile', 'scopeAuthorizationRevision'
      ].sort().join(',')) fail('normalized operation candidate is invalid.');
  const withoutDigest = operationWithoutDigest({
    schema: 'sec-ci-verification-normalized-operation-v2',
    gateId: text(candidate.gateId, 'normalized gateId'),
    phase: candidate.phase as CiVerificationGatePhase,
    runtime: 'bun',
    workingDirectory: '.',
    target,
    environmentBindings,
    coveredScopeIds: canonicalStrings(candidate.coveredScopeIds as string[], 'normalized coveredScopeIds'),
    candidate: Object.freeze({
      baseSha: sha(candidateBinding.baseSha, 'normalized candidate baseSha'),
      baseTreeSha: sha(candidateBinding.baseTreeSha, 'normalized candidate baseTreeSha'),
      headSha: sha(candidateBinding.headSha, 'normalized candidate headSha'),
      headTreeSha: sha(candidateBinding.headTreeSha, 'normalized candidate headTreeSha'),
      manifestDigest: digest(candidateBinding.manifestDigest, 'normalized candidate manifestDigest'),
      scopeAuthorizationRevision: digest(
        candidateBinding.scopeAuthorizationRevision,
        'normalized candidate scopeAuthorizationRevision'
      ),
      profile: candidateBinding.profile === 'quick' || candidateBinding.profile === 'full'
        ? candidateBinding.profile
        : fail('normalized candidate profile is invalid.'),
      executionEnvironmentRevision: text(
        candidateBinding.executionEnvironmentRevision,
        'normalized candidate executionEnvironmentRevision'
      )
    })
  });
  if (digest(candidate.semanticDigest, 'normalized semanticDigest') !== hash(withoutDigest)) {
    fail('normalized operation semantic digest mismatch.');
  }
  return Object.freeze({ ...withoutDigest, semanticDigest: candidate.semanticDigest as CiVerificationActionDigest });
}

export function buildCiVerificationActionPlan(options: {
  readonly candidate: CiVerificationActionCandidate;
  readonly gate: CiVerificationProducerGate;
  readonly requiredCheapPreflightActionKeys?: readonly VerificationActionKeyDigest[];
  readonly upstreamActionKeys?: readonly VerificationActionKeyDigest[];
}): VerificationActionPlan {
  const normalizedOperation = normalizeCiVerificationOperation(options);
  const action = createVerificationActionKey({
    actionKind: 'ci-verification-gate',
    producer: {
      identity: 'src/adapters/verification/platform/action/contract/ci.ts',
      revision: CI_VERIFICATION_ACTION_PRODUCER_REVISION
    },
    operation: {
      identity: normalizedOperation.gateId,
      revision: CI_VERIFICATION_ACTION_PRODUCER_REVISION,
      semanticDigest: normalizedOperation.semanticDigest,
      workingDirectory: normalizedOperation.workingDirectory,
      declaredEnvironment: normalizedOperation.environmentBindings
    },
    inputClosure: canonicalInputs(options.candidate),
    environment: {
      toolchainRevision: options.candidate.toolchainRevision,
      providerRevision: normalizedOperation.candidate.executionEnvironmentRevision,
      contractRevision: options.candidate.contractRevision
    },
    requiredCheapPreflightActionKeys: options.requiredCheapPreflightActionKeys ?? [],
    upstreamActionKeys: options.upstreamActionKeys ?? [],
    resultSchemaRevision: VERIFICATION_GATE_RESULT_SCHEMA
  });
  return createVerificationActionPlan({
    action,
    executionClass: executionClass(normalizedOperation.phase),
    dependencies: [
      ...(options.requiredCheapPreflightActionKeys ?? []).map((actionKey) => ({ actionKey, kind: 'cheap-preflight' as const })),
      ...(options.upstreamActionKeys ?? []).map((actionKey) => ({ actionKey, kind: 'upstream' as const }))
    ]
  });
}

type CiVerificationActionClosureGraphNode = Readonly<{
  actionKey: VerificationActionKeyDigest;
  dependencyActionKeys: readonly VerificationActionKeyDigest[];
}>;

function ciVerificationActionClosureGraphNodes(
  actions: readonly unknown[]
): readonly CiVerificationActionClosureGraphNode[] {
  return Object.freeze(actions.map((candidate, actionIndex) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      fail(`plan closure actions[${actionIndex}] must be one Action plan object.`);
    }
    const plan = candidate as Record<string, unknown>;
    if (plan.action === null || typeof plan.action !== 'object' || Array.isArray(plan.action) ||
        !Array.isArray(plan.dependencies)) {
      fail(`plan closure actions[${actionIndex}] graph fields are invalid.`);
    }
    const action = plan.action as Record<string, unknown>;
    const actionKey = digest(action.actionKey, `plan closure actions[${actionIndex}].actionKey`);
    const dependencyActionKeys = Object.freeze(plan.dependencies.map((candidateDependency, dependencyIndex) => {
      if (candidateDependency === null || typeof candidateDependency !== 'object' ||
          Array.isArray(candidateDependency)) {
        fail(`plan closure actions[${actionIndex}].dependencies[${dependencyIndex}] is invalid.`);
      }
      return digest(
        (candidateDependency as Record<string, unknown>).actionKey,
        `plan closure actions[${actionIndex}].dependencies[${dependencyIndex}].actionKey`
      );
    }));
    return Object.freeze({ actionKey, dependencyActionKeys });
  }));
}

function assertCiVerificationActionClosureGraph(
  nodes: readonly CiVerificationActionClosureGraphNode[]
): void {
  const byKey = new Map<VerificationActionKeyDigest, CiVerificationActionClosureGraphNode>();
  for (const node of nodes) {
    if (byKey.has(node.actionKey)) {
      fail(`plan closure ActionKeys must be unique: ${node.actionKey}.`);
    }
    byKey.set(node.actionKey, node);
  }
  for (const node of nodes) {
    for (const dependencyActionKey of node.dependencyActionKeys) {
      if (dependencyActionKey === node.actionKey) {
        fail(`plan closure Action cannot depend on itself: ${node.actionKey}.`);
      }
      if (!byKey.has(dependencyActionKey)) {
        fail(
          `plan closure dependency ${dependencyActionKey} for ${node.actionKey} ` +
          'does not resolve to exactly one Action member.'
        );
      }
    }
  }
  const visiting = new Set<VerificationActionKeyDigest>();
  const visited = new Set<VerificationActionKeyDigest>();
  const visit = (actionKey: VerificationActionKeyDigest): void => {
    if (visited.has(actionKey)) return;
    if (visiting.has(actionKey)) fail('plan closure dependency graph contains a cycle.');
    visiting.add(actionKey);
    for (const dependencyActionKey of byKey.get(actionKey)!.dependencyActionKeys) {
      visit(dependencyActionKey);
    }
    visiting.delete(actionKey);
    visited.add(actionKey);
  };
  for (const actionKey of byKey.keys()) visit(actionKey);
}

export function buildCiVerificationActionPlanClosure(options: {
  readonly candidate: CiVerificationActionCandidate;
  readonly gates: readonly CiVerificationProducerGate[];
}): CiVerificationActionPlanClosure {
  const actions: VerificationActionPlan[] = [];
  const normalizedOperations: CiVerificationNormalizedOperation[] = [];
  const cheapKeys: VerificationActionKeyDigest[] = [];
  let previousQuickKey: VerificationActionKeyDigest | null = null;
  let previousExpensiveKey: VerificationActionKeyDigest | null = null;
  for (const gate of options.gates) {
    const isCheap = gate.phase === 'quick';
    const plan = buildCiVerificationActionPlan({
      candidate: options.candidate,
      gate,
      requiredCheapPreflightActionKeys: isCheap ? [] : cheapKeys,
      upstreamActionKeys: isCheap
        ? (previousQuickKey === null ? [] : [previousQuickKey])
        : (previousExpensiveKey === null ? [] : [previousExpensiveKey])
    });
    actions.push(plan);
    const normalizedOperation = normalizeCiVerificationOperation({
      candidate: options.candidate,
      gate
    });
    if (normalizedOperation.semanticDigest !== plan.action.operation.semanticDigest) {
      fail('normalized operation differs from its Action semantic digest.');
    }
    normalizedOperations.push(normalizedOperation);
    if (isCheap) {
      cheapKeys.push(plan.action.actionKey);
      previousQuickKey = plan.action.actionKey;
    } else {
      previousExpensiveKey = plan.action.actionKey;
    }
  }
  assertCiVerificationActionClosureGraph(ciVerificationActionClosureGraphNodes(actions));
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA,
    producerRevision: CI_VERIFICATION_ACTION_PRODUCER_REVISION,
    actions: Object.freeze(actions),
    normalizedOperations: Object.freeze(normalizedOperations)
  });
  return Object.freeze({ ...withoutDigest, actionPlanDigest: hash(withoutDigest) });
}

export function parseCiVerificationActionPlanClosure(source: string): CiVerificationActionPlanClosure {
  const value = JSON.parse(source) as Record<string, unknown>;
  const actual = Object.keys(value).sort();
  const expected = ['actionPlanDigest', 'actions', 'normalizedOperations', 'producerRevision', 'schema'].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('plan closure fields are invalid.');
  }
  if (value.schema !== CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA ||
      value.producerRevision !== CI_VERIFICATION_ACTION_PRODUCER_REVISION ||
      !Array.isArray(value.actions) || !Array.isArray(value.normalizedOperations)) {
    fail('plan closure identity is invalid.');
  }
  assertCiVerificationActionClosureGraph(ciVerificationActionClosureGraphNodes(value.actions));
  const actions = Object.freeze(value.actions.map((plan) => parseVerificationActionPlan(
    encodeVerificationActionData(plan)
  )));
  const normalizedOperations = Object.freeze(value.normalizedOperations.map(
    parseCiVerificationNormalizedOperation
  ));
  if (actions.length !== normalizedOperations.length || actions.some((plan, index) => {
    const operation = normalizedOperations[index];
    return operation === undefined || plan.action.operation.identity !== operation.gateId ||
      plan.action.operation.semanticDigest !== operation.semanticDigest ||
      plan.action.operation.workingDirectory !== operation.workingDirectory ||
      encodeVerificationActionData(plan.action.operation.declaredEnvironment) !==
        encodeVerificationActionData(operation.environmentBindings);
  })) fail('plan closure Action/normalized operation membership mismatch.');
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA,
    producerRevision: CI_VERIFICATION_ACTION_PRODUCER_REVISION,
    actions,
    normalizedOperations
  });
  if (digest(value.actionPlanDigest, 'actionPlanDigest') !== hash(withoutDigest)) fail('plan closure digest mismatch.');
  return Object.freeze({ ...withoutDigest, actionPlanDigest: value.actionPlanDigest as CiVerificationActionDigest });
}

export function assertCiVerificationActionPlanClosureEqual(
  actual: CiVerificationActionPlanClosure,
  expected: CiVerificationActionPlanClosure
): void {
  const parsed = parseCiVerificationActionPlanClosure(encodeVerificationActionData(actual));
  if (parsed.actionPlanDigest !== expected.actionPlanDigest ||
      encodeVerificationActionData(parsed.actions) !== encodeVerificationActionData(expected.actions) ||
      encodeVerificationActionData(parsed.normalizedOperations) !==
        encodeVerificationActionData(expected.normalizedOperations)) {
    fail('plan closure does not match the trusted producer reconstruction.');
  }
}

export function resolveCiVerificationDevRunnerTarget(options: {
  readonly plan: VerificationActionPlan;
  readonly authorizedClosure: CiVerificationActionPlanClosure;
}): CiVerificationNormalizedOperation {
  const authorized = parseCiVerificationActionPlanClosure(
    encodeVerificationActionData(options.authorizedClosure)
  );
  const plan = parseVerificationActionPlan(encodeVerificationActionData(options.plan));
  const memberIndex = authorized.actions.findIndex((entry) => entry.action.actionKey === plan.action.actionKey);
  const member = authorized.actions[memberIndex];
  if (member === undefined || encodeVerificationActionData(member) !== encodeVerificationActionData(plan)) {
    fail('dev-runner rejected a forged or non-member Action plan.');
  }
  if (plan.action.producer.identity !== 'src/adapters/verification/platform/action/contract/ci.ts' ||
      plan.action.producer.revision !== CI_VERIFICATION_ACTION_PRODUCER_REVISION ||
      plan.action.operation.revision !== CI_VERIFICATION_ACTION_PRODUCER_REVISION) {
    fail('dev-runner Action producer identity is not trusted.');
  }
  const operation = authorized.normalizedOperations[memberIndex];
  if (operation === undefined || operation.gateId !== plan.action.operation.identity ||
      operation.semanticDigest !== plan.action.operation.semanticDigest) {
    fail('dev-runner rejected a missing or competing normalized operation.');
  }
  return operation;
}
