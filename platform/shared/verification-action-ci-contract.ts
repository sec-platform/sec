import { createHash } from 'node:crypto';

import type { CiVerificationGatePhase, CiVerificationGateStep } from './ci-verification-plan.ts';
import {
  CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2,
  CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION_V2,
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX_V2,
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE_V2,
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA_V2,
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PROPOSAL_SET_SCHEMA_V2,
  CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2,
  CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2,
  CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA_V2,
  CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA_V2,
  CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2
} from './ci-verification-revision.ts';
import {
  createVerificationActionKeyV2,
  createVerificationActionPlanV2,
  encodeVerificationActionDataV2,
  parseVerificationActionPlanV2,
  type VerificationActionExecutionClassV2,
  type VerificationActionInputRefV2,
  type VerificationActionKeyDigest,
  type VerificationActionPlanV2
} from './verification-action-contract.ts';

export const CI_VERIFICATION_ACTION_PRODUCER_REVISION_V2 =
  'sec-ci-verification-action-producer-v2' as const;
/** Compatibility export name; both names resolve to the single active V2 producer authority. */
export const CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1 =
  CI_VERIFICATION_ACTION_PRODUCER_REVISION_V2;
export const CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V2 =
  'sec-ci-verification-action-plan-closure-v2' as const;
/** Compatibility export name; the active wire schema is V2 only. */
export const CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1 =
  CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V2;

export type CiVerificationActionDigestV1 = `sha256:${string}`;

export type CiVerificationActionSessionRequestV2 = Readonly<object>;

export type CiVerificationActionProposalV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA_V2;
  sessionRequest: CiVerificationActionSessionRequestV2;
  proposedActionKey: VerificationActionKeyDigest;
}>;

export type CiVerificationActionParentActorV2 = Readonly<{
  login: string;
  id: number;
  nodeId: string;
  type: 'User';
  permission: 'maintain' | 'admin';
}>;

export type CiVerificationActionParentDispatchPlanV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA_V2;
  repositoryId: string;
  repository: string;
  parentRunId: string;
  parentRunAttempt: number;
  parentJobId: string;
  parentJobName: typeof CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2;
  parentPlanStepName: typeof CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2;
  parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml';
  parentWorkflowRef: string;
  parentWorkflowSha: string;
  parentActor: CiVerificationActionParentActorV2;
  proposals: readonly CiVerificationActionProposalV2[];
  parentDispatchPlanDigest: CiVerificationActionDigestV1;
}>;

export type CiVerificationActionProviderEnvelopeV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA_V2;
  proposal: CiVerificationActionProposalV2;
  parentRunId: string;
  parentRunAttempt: number;
  parentJobId: string;
  parentJobName: typeof CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2;
  parentPlanStepName: typeof CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2;
  parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml';
  parentWorkflowRef: string;
  parentWorkflowSha: string;
  parentDispatchPlanDigest: CiVerificationActionDigestV1;
  parentDispatchPlanArtifactId: string;
  parentDispatchPlanArtifactName: string;
  parentDispatchPlanArchiveDigest: CiVerificationActionDigestV1;
  parentDispatchPlanPayloadDigest: CiVerificationActionDigestV1;
}>;

export type CiVerificationExecutionEnvironmentV2 = Readonly<{
  contractRevision: typeof CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION_V2;
  kind: 'hosted' | 'local';
  os: string;
  arch: string;
  runnerImage: string | null;
  toolchainRevision: string;
  executionEnvironmentRevision: string;
}>;

export const CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2: CiVerificationExecutionEnvironmentV2 =
  Object.freeze({
    contractRevision: CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION_V2,
    kind: 'hosted',
    os: 'linux',
    arch: 'x64',
    runnerImage: 'ubuntu-24.04',
    toolchainRevision: 'bun@1.3.14',
    executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2
  });

export function createCiVerificationLocalExecutionEnvironmentV2(input: {
  readonly os: string;
  readonly arch: string;
  readonly bunVersion: string;
}): CiVerificationExecutionEnvironmentV2 {
  const os = text(input.os, 'local execution environment os').toLowerCase();
  const arch = text(input.arch, 'local execution environment arch').toLowerCase();
  const bunVersion = text(input.bunVersion, 'local execution environment Bun version');
  if (!/^[a-z0-9._-]+$/u.test(os) || !/^[a-z0-9._-]+$/u.test(arch) ||
      !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/u.test(bunVersion)) {
    fail('local execution environment contains a non-canonical platform or Bun revision.');
  }
  const toolchainRevision = `bun@${bunVersion}`;
  return Object.freeze({
    contractRevision: CI_VERIFICATION_ACTION_ENVIRONMENT_CONTRACT_REVISION_V2,
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
    ? CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2
    : revision;
}

export interface CiVerificationActionCandidateV1 {
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: CiVerificationActionDigestV1;
  readonly scopeAuthorizationRevision: CiVerificationActionDigestV1;
  readonly profile: 'quick' | 'full';
  readonly toolchainRevision: string;
  /** Canonical executionEnvironmentRevision compiled into Action.environment.providerRevision. */
  readonly providerRevision: string;
  readonly contractRevision: string;
  readonly requiredBlobs: readonly VerificationActionInputRefV2[];
}

export interface CiVerificationProducerGateV1 {
  readonly id: string;
  readonly phase: CiVerificationGatePhase;
  readonly argv: readonly string[];
  readonly runtime: string;
  readonly environment: Readonly<Record<string, CiVerificationActionDigestV1>>;
  readonly coveredScopeIds: readonly string[];
}

export interface CiVerificationActionPlanClosureV1 {
  readonly schema: typeof CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1;
  readonly producerRevision: typeof CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1;
  readonly actions: readonly VerificationActionPlanV2[];
  readonly normalizedOperations: readonly CiVerificationNormalizedOperationV2[];
  readonly actionPlanDigest: CiVerificationActionDigestV1;
}

export type CiVerificationNormalizedTargetV2 =
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

export type CiVerificationNormalizedOperationV2 = Readonly<{
  schema: 'sec-ci-verification-normalized-operation-v2';
  gateId: string;
  phase: CiVerificationGatePhase;
  runtime: 'bun';
  workingDirectory: '.';
  target: CiVerificationNormalizedTargetV2;
  environmentBindings: readonly Readonly<{ name: string; digest: CiVerificationActionDigestV1 }>[];
  coveredScopeIds: readonly string[];
  candidate: Readonly<{
    baseSha: string;
    baseTreeSha: string;
    headSha: string;
    headTreeSha: string;
    manifestDigest: CiVerificationActionDigestV1;
    scopeAuthorizationRevision: CiVerificationActionDigestV1;
    profile: 'quick' | 'full';
    executionEnvironmentRevision: string;
  }>;
  semanticDigest: CiVerificationActionDigestV1;
}>;

export function ciVerificationNormalizedOperationArgvV2(
  operation: CiVerificationNormalizedOperationV2
): readonly string[] {
  const parsed = parseCiVerificationNormalizedOperationV2(operation);
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

function digest(value: unknown, label: string): CiVerificationActionDigestV1 {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be a SHA-256 digest.`);
  }
  return value as CiVerificationActionDigestV1;
}

function hash(value: unknown): CiVerificationActionDigestV1 {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function hashCanonicalLine(value: unknown): CiVerificationActionDigestV1 {
  return `sha256:${createHash('sha256')
    .update(`${encodeVerificationActionDataV2(value)}\n`, 'utf8')
    .digest('hex')}`;
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

function canonicalJsonObject(value: unknown, label: string): CiVerificationActionSessionRequestV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one JSON object.`);
  }
  const encoded = encodeVerificationActionDataV2(value);
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

function parentActorV2(value: unknown): CiVerificationActionParentActorV2 {
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

export function createCiVerificationActionProposalV2(input: Readonly<{
  sessionRequest: CiVerificationActionSessionRequestV2;
  proposedActionKey: VerificationActionKeyDigest;
}>): CiVerificationActionProposalV2 {
  return parseCiVerificationActionProposalV2({
    schema: CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA_V2,
    sessionRequest: input.sessionRequest,
    proposedActionKey: input.proposedActionKey
  });
}

export function parseCiVerificationActionProposalV2(value: unknown): CiVerificationActionProposalV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('proposal must be one object.');
  const record = value as Record<string, unknown>;
  exactKeys(record, ['proposedActionKey', 'schema', 'sessionRequest'], 'proposal');
  if (record.schema !== CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA_V2) fail('proposal schema mismatch.');
  const proposedActionKey = digest(record.proposedActionKey, 'proposal.proposedActionKey') as VerificationActionKeyDigest;
  return Object.freeze({
    schema: CI_VERIFICATION_ACTION_PROPOSAL_SCHEMA_V2,
    sessionRequest: canonicalJsonObject(record.sessionRequest, 'proposal.sessionRequest'),
    proposedActionKey
  });
}

function proposalSetDigestV2(proposals: readonly CiVerificationActionProposalV2[]): CiVerificationActionDigestV1 {
  return hash({
    schema: CI_VERIFICATION_ACTION_PARENT_DISPATCH_PROPOSAL_SET_SCHEMA_V2,
    proposals
  });
}

function canonicalProposalsV2(value: unknown): readonly CiVerificationActionProposalV2[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    fail('parent dispatch proposals must be a non-empty bounded array.');
  }
  const proposals = value.map((entry) => parseCiVerificationActionProposalV2(entry));
  const sorted = [...proposals].sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey));
  if (new Set(sorted.map((entry) => entry.proposedActionKey)).size !== sorted.length) {
    fail('parent dispatch proposals contain duplicate ActionKeys.');
  }
  if (encodeVerificationActionDataV2(proposals) !== encodeVerificationActionDataV2(sorted)) {
    fail('parent dispatch proposals are not in canonical ActionKey order.');
  }
  return Object.freeze(sorted);
}

export function ciVerificationActionParentDispatchPlanArtifactNameV2(
  parentRunId: string,
  parentRunAttempt: number
): string {
  return `${CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX_V2}-run-${positiveDecimal(
    parentRunId,
    'parentRunId'
  )}-attempt-${positiveInteger(parentRunAttempt, 'parentRunAttempt')}`;
}

export function ciVerificationActionParentDispatchPlanFileV2():
  typeof CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE_V2 {
  return CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE_V2;
}

export function createCiVerificationActionParentDispatchPlanV2(input: Readonly<{
  repositoryId: string;
  repository: string;
  parentRunId: string;
  parentRunAttempt: number;
  parentJobId: string;
  parentWorkflowRef: string;
  parentWorkflowSha: string;
  parentActor: CiVerificationActionParentActorV2;
  proposals: readonly CiVerificationActionProposalV2[];
}>): CiVerificationActionParentDispatchPlanV2 {
  const proposals = [...input.proposals]
    .map((entry) => parseCiVerificationActionProposalV2(entry))
    .sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey));
  return parseCiVerificationActionParentDispatchPlanV2({
    schema: CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA_V2,
    repositoryId: input.repositoryId,
    repository: input.repository,
    parentRunId: input.parentRunId,
    parentRunAttempt: input.parentRunAttempt,
    parentJobId: input.parentJobId,
    parentJobName: CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2,
    parentPlanStepName: CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2,
    parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml',
    parentWorkflowRef: input.parentWorkflowRef,
    parentWorkflowSha: input.parentWorkflowSha,
    parentActor: input.parentActor,
    proposals,
    parentDispatchPlanDigest: proposalSetDigestV2(proposals)
  });
}

export function parseCiVerificationActionParentDispatchPlanV2(
  value: unknown
): CiVerificationActionParentDispatchPlanV2 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('parent dispatch plan must be one object.');
  }
  const record = value as Record<string, unknown>;
  exactKeys(record, [
    'parentActor', 'parentDispatchPlanDigest', 'parentJobId', 'parentJobName',
    'parentPlanStepName', 'parentRunAttempt', 'parentRunId', 'parentWorkflowPath',
    'parentWorkflowRef', 'parentWorkflowSha', 'proposals', 'repository', 'repositoryId', 'schema'
  ], 'parent dispatch plan');
  if (record.schema !== CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA_V2) {
    fail('parent dispatch plan schema mismatch.');
  }
  const repository = repositoryName(record.repository, 'parent dispatch plan repository');
  const repositoryId = positiveDecimal(record.repositoryId, 'parent dispatch plan repositoryId');
  const parentRunId = positiveDecimal(record.parentRunId, 'parent dispatch plan parentRunId');
  const parentRunAttempt = positiveInteger(record.parentRunAttempt, 'parent dispatch plan parentRunAttempt');
  const parentJobId = positiveDecimal(record.parentJobId, 'parent dispatch plan parentJobId');
  if (record.parentJobName !== CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2
    || record.parentPlanStepName !== CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2) {
    fail('parent dispatch plan job or producer step is not canonical.');
  }
  if (record.parentWorkflowPath !== '.github/workflows/compiler-pr-validation.yml') {
    fail('parent dispatch plan workflow path is not canonical.');
  }
  const parentWorkflowSha = sha(record.parentWorkflowSha, 'parent dispatch plan parentWorkflowSha');
  const proposals = canonicalProposalsV2(record.proposals);
  const parentDispatchPlanDigest = digest(
    record.parentDispatchPlanDigest,
    'parent dispatch plan parentDispatchPlanDigest'
  );
  if (parentDispatchPlanDigest !== proposalSetDigestV2(proposals)) {
    fail('parent dispatch plan digest does not bind the exact sorted proposals.');
  }
  return Object.freeze({
    schema: CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_SCHEMA_V2,
    repositoryId,
    repository,
    parentRunId,
    parentRunAttempt,
    parentJobId,
    parentJobName: CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2,
    parentPlanStepName: CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2,
    parentWorkflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    parentWorkflowRef: parentWorkflowRef(record.parentWorkflowRef, repository),
    parentWorkflowSha,
    parentActor: parentActorV2(record.parentActor),
    proposals,
    parentDispatchPlanDigest
  });
}

export function ciVerificationActionParentDispatchPlanPayloadDigestV2(
  plan: CiVerificationActionParentDispatchPlanV2
): CiVerificationActionDigestV1 {
  return hashCanonicalLine(parseCiVerificationActionParentDispatchPlanV2(plan));
}

export function createCiVerificationActionProviderEnvelopeV2(input: Readonly<{
  proposal: CiVerificationActionProposalV2;
  parentPlan: CiVerificationActionParentDispatchPlanV2;
  parentDispatchPlanArtifactId: string;
  parentDispatchPlanArchiveDigest: CiVerificationActionDigestV1;
}>): CiVerificationActionProviderEnvelopeV2 {
  const parentPlan = parseCiVerificationActionParentDispatchPlanV2(input.parentPlan);
  const proposal = parseCiVerificationActionProposalV2(input.proposal);
  assertCiVerificationActionProposalMemberV2(proposal, parentPlan);
  return parseCiVerificationActionProviderEnvelopeV2({
    schema: CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA_V2,
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
    parentDispatchPlanArtifactName: ciVerificationActionParentDispatchPlanArtifactNameV2(
      parentPlan.parentRunId,
      parentPlan.parentRunAttempt
    ),
    parentDispatchPlanArchiveDigest: input.parentDispatchPlanArchiveDigest,
    parentDispatchPlanPayloadDigest: ciVerificationActionParentDispatchPlanPayloadDigestV2(parentPlan)
  });
}

export function parseCiVerificationActionProviderEnvelopeV2(
  value: unknown
): CiVerificationActionProviderEnvelopeV2 {
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
  if (record.schema !== CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA_V2) {
    fail('provider envelope schema mismatch.');
  }
  const parentRunId = positiveDecimal(record.parentRunId, 'provider envelope parentRunId');
  const parentRunAttempt = positiveInteger(record.parentRunAttempt, 'provider envelope parentRunAttempt');
  const parentJobId = positiveDecimal(record.parentJobId, 'provider envelope parentJobId');
  if (record.parentJobName !== CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2
    || record.parentPlanStepName !== CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2) {
    fail('provider envelope parent job or producer step is not canonical.');
  }
  if (record.parentWorkflowPath !== '.github/workflows/compiler-pr-validation.yml') {
    fail('provider envelope workflow path is not canonical.');
  }
  const parentDispatchPlanArtifactName = text(
    record.parentDispatchPlanArtifactName,
    'provider envelope parentDispatchPlanArtifactName'
  );
  if (parentDispatchPlanArtifactName !== ciVerificationActionParentDispatchPlanArtifactNameV2(
    parentRunId,
    parentRunAttempt
  )) {
    fail('provider envelope artifact name does not bind the parent run and attempt.');
  }
  return Object.freeze({
    schema: CI_VERIFICATION_ACTION_PROVIDER_ENVELOPE_SCHEMA_V2,
    proposal: parseCiVerificationActionProposalV2(record.proposal),
    parentRunId,
    parentRunAttempt,
    parentJobId,
    parentJobName: CI_VERIFICATION_ACTION_PARENT_JOB_NAME_V2,
    parentPlanStepName: CI_VERIFICATION_ACTION_PARENT_PLAN_STEP_NAME_V2,
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

export function assertCiVerificationActionProposalMemberV2(
  proposal: CiVerificationActionProposalV2,
  parentPlan: CiVerificationActionParentDispatchPlanV2
): void {
  const parsedProposal = parseCiVerificationActionProposalV2(proposal);
  const parsedPlan = parseCiVerificationActionParentDispatchPlanV2(parentPlan);
  const matches = parsedPlan.proposals.filter((entry) =>
    encodeVerificationActionDataV2(entry) === encodeVerificationActionDataV2(parsedProposal));
  if (matches.length !== 1) fail('provider proposal is not one exact member of the parent dispatch plan.');
}

export function assertCiVerificationActionProviderEnvelopeMemberV2(
  envelope: CiVerificationActionProviderEnvelopeV2,
  parentPlan: CiVerificationActionParentDispatchPlanV2
): void {
  const parsedEnvelope = parseCiVerificationActionProviderEnvelopeV2(envelope);
  const parsedPlan = parseCiVerificationActionParentDispatchPlanV2(parentPlan);
  if (parsedEnvelope.parentRunId !== parsedPlan.parentRunId
    || parsedEnvelope.parentRunAttempt !== parsedPlan.parentRunAttempt
    || parsedEnvelope.parentJobId !== parsedPlan.parentJobId
    || parsedEnvelope.parentJobName !== parsedPlan.parentJobName
    || parsedEnvelope.parentPlanStepName !== parsedPlan.parentPlanStepName
    || parsedEnvelope.parentWorkflowPath !== parsedPlan.parentWorkflowPath
    || parsedEnvelope.parentWorkflowRef !== parsedPlan.parentWorkflowRef
    || parsedEnvelope.parentWorkflowSha !== parsedPlan.parentWorkflowSha
    || parsedEnvelope.parentDispatchPlanDigest !== parsedPlan.parentDispatchPlanDigest
    || parsedEnvelope.parentDispatchPlanArtifactName !== ciVerificationActionParentDispatchPlanArtifactNameV2(
      parsedPlan.parentRunId,
      parsedPlan.parentRunAttempt
    )
    || parsedEnvelope.parentDispatchPlanPayloadDigest !==
      ciVerificationActionParentDispatchPlanPayloadDigestV2(parsedPlan)) {
    fail('provider envelope does not bind the exact parent plan provenance and bytes.');
  }
  assertCiVerificationActionProposalMemberV2(parsedEnvelope.proposal, parsedPlan);
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
  candidate: CiVerificationActionCandidateV1
): readonly VerificationActionInputRefV2[] {
  const inputs = [
    ...candidate.requiredBlobs,
    { path: candidate.manifestPath, digest: candidate.manifestDigest }
  ].map((entry, index) => ({
    path: text(entry.path, `requiredBlobs[${index}].path`),
    digest: digest(entry.digest, `requiredBlobs[${index}].digest`)
  }));
  const byPath = new Map<string, CiVerificationActionDigestV1>();
  for (const input of inputs) {
    const previous = byPath.get(input.path);
    if (previous !== undefined && previous !== input.digest) {
      fail(`input closure contains conflicting digests for ${input.path}.`);
    }
    byPath.set(input.path, input.digest);
  }
  for (const requiredPath of CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2) {
    if (!byPath.has(requiredPath)) {
      fail(`input closure omits canonical dependency input ${requiredPath}.`);
    }
  }
  return Object.freeze([...byPath].sort(([left], [right]) => left.localeCompare(right)).map(
    ([inputPath, inputDigest]) => Object.freeze({ path: inputPath, digest: inputDigest })
  ));
}

function executionClass(phase: CiVerificationGatePhase): VerificationActionExecutionClassV2 {
  return phase === 'quick' ? 'cheap-preflight' : 'expensive';
}

function canonicalBunTestArguments(args: readonly string[]): readonly string[] {
  let index = 0;
  const paths = new Set<string>();
  while (index < args.length && !args[index]!.startsWith('-')) {
    const testPath = text(args[index], `gate Bun test path[${index}]`);
    const segments = testPath.split('/');
    if (
      !/^tests\/[a-z0-9][a-z0-9._/-]*\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/u.test(testPath) ||
      testPath.includes('\\') ||
      testPath.includes('//') ||
      segments.includes('.') ||
      segments.includes('..')
    ) {
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

function assertCandidate(candidate: CiVerificationActionCandidateV1): void {
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

export function ciVerificationGateStepV1(step: CiVerificationGateStep): CiVerificationProducerGateV1 {
  return Object.freeze({
    id: text(step.id, 'gate.id'),
    phase: step.phase,
    argv: Object.freeze(['bun', ...canonicalStrings(step.args, 'gate.args')]),
    runtime: 'bun',
    environment: Object.freeze({}),
    coveredScopeIds: Object.freeze([])
  });
}

function normalizedTarget(argv: readonly string[]): CiVerificationNormalizedTargetV2 {
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

function operationWithoutDigest(input: Omit<CiVerificationNormalizedOperationV2, 'semanticDigest'>): Omit<
  CiVerificationNormalizedOperationV2,
  'semanticDigest'
> {
  return Object.freeze(input);
}

function normalizeCiVerificationOperationV2(options: {
  readonly candidate: CiVerificationActionCandidateV1;
  readonly gate: CiVerificationProducerGateV1;
}): CiVerificationNormalizedOperationV2 {
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

export function parseCiVerificationNormalizedOperationV2(value: unknown): CiVerificationNormalizedOperationV2 {
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
  return Object.freeze({ ...withoutDigest, semanticDigest: candidate.semanticDigest as CiVerificationActionDigestV1 });
}

export function buildCiVerificationActionPlanV1(options: {
  readonly candidate: CiVerificationActionCandidateV1;
  readonly gate: CiVerificationProducerGateV1;
  readonly requiredCheapPreflightActionKeys?: readonly VerificationActionKeyDigest[];
  readonly upstreamActionKeys?: readonly VerificationActionKeyDigest[];
}): VerificationActionPlanV2 {
  const normalizedOperation = normalizeCiVerificationOperationV2(options);
  const action = createVerificationActionKeyV2({
    actionKind: 'ci-verification-gate',
    producer: {
      identity: 'platform/shared/verification-action-ci-contract.ts',
      revision: CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1
    },
    operation: {
      identity: normalizedOperation.gateId,
      revision: CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1,
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
    resultSchemaRevision: 'sec-verification-gate-result-v1'
  });
  return createVerificationActionPlanV2({
    action,
    executionClass: executionClass(normalizedOperation.phase),
    dependencies: [
      ...(options.requiredCheapPreflightActionKeys ?? []).map((actionKey) => ({ actionKey, kind: 'cheap-preflight' as const })),
      ...(options.upstreamActionKeys ?? []).map((actionKey) => ({ actionKey, kind: 'upstream' as const }))
    ]
  });
}

type CiVerificationActionClosureGraphNodeV1 = Readonly<{
  actionKey: VerificationActionKeyDigest;
  dependencyActionKeys: readonly VerificationActionKeyDigest[];
}>;

function ciVerificationActionClosureGraphNodesV1(
  actions: readonly unknown[]
): readonly CiVerificationActionClosureGraphNodeV1[] {
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

function assertCiVerificationActionClosureGraphV1(
  nodes: readonly CiVerificationActionClosureGraphNodeV1[]
): void {
  const byKey = new Map<VerificationActionKeyDigest, CiVerificationActionClosureGraphNodeV1>();
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

export function buildCiVerificationActionPlanClosureV1(options: {
  readonly candidate: CiVerificationActionCandidateV1;
  readonly gates: readonly CiVerificationProducerGateV1[];
}): CiVerificationActionPlanClosureV1 {
  const actions: VerificationActionPlanV2[] = [];
  const normalizedOperations: CiVerificationNormalizedOperationV2[] = [];
  const cheapKeys: VerificationActionKeyDigest[] = [];
  let previousQuickKey: VerificationActionKeyDigest | null = null;
  let previousExpensiveKey: VerificationActionKeyDigest | null = null;
  for (const gate of options.gates) {
    const isCheap = gate.phase === 'quick';
    const plan = buildCiVerificationActionPlanV1({
      candidate: options.candidate,
      gate,
      requiredCheapPreflightActionKeys: isCheap ? [] : cheapKeys,
      upstreamActionKeys: isCheap
        ? (previousQuickKey === null ? [] : [previousQuickKey])
        : (previousExpensiveKey === null ? [] : [previousExpensiveKey])
    });
    actions.push(plan);
    const normalizedOperation = normalizeCiVerificationOperationV2({
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
  assertCiVerificationActionClosureGraphV1(ciVerificationActionClosureGraphNodesV1(actions));
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1,
    producerRevision: CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1,
    actions: Object.freeze(actions),
    normalizedOperations: Object.freeze(normalizedOperations)
  });
  return Object.freeze({ ...withoutDigest, actionPlanDigest: hash(withoutDigest) });
}

export function parseCiVerificationActionPlanClosureV1(source: string): CiVerificationActionPlanClosureV1 {
  const value = JSON.parse(source) as Record<string, unknown>;
  const actual = Object.keys(value).sort();
  const expected = ['actionPlanDigest', 'actions', 'normalizedOperations', 'producerRevision', 'schema'].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('plan closure fields are invalid.');
  }
  if (value.schema !== CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1 ||
      value.producerRevision !== CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1 ||
      !Array.isArray(value.actions) || !Array.isArray(value.normalizedOperations)) {
    fail('plan closure identity is invalid.');
  }
  assertCiVerificationActionClosureGraphV1(ciVerificationActionClosureGraphNodesV1(value.actions));
  const actions = Object.freeze(value.actions.map((plan) => parseVerificationActionPlanV2(
    encodeVerificationActionDataV2(plan)
  )));
  const normalizedOperations = Object.freeze(value.normalizedOperations.map(
    parseCiVerificationNormalizedOperationV2
  ));
  if (actions.length !== normalizedOperations.length || actions.some((plan, index) => {
    const operation = normalizedOperations[index];
    return operation === undefined || plan.action.operation.identity !== operation.gateId ||
      plan.action.operation.semanticDigest !== operation.semanticDigest ||
      plan.action.operation.workingDirectory !== operation.workingDirectory ||
      encodeVerificationActionDataV2(plan.action.operation.declaredEnvironment) !==
        encodeVerificationActionDataV2(operation.environmentBindings);
  })) fail('plan closure Action/normalized operation membership mismatch.');
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_PLAN_CLOSURE_SCHEMA_V1,
    producerRevision: CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1,
    actions,
    normalizedOperations
  });
  if (digest(value.actionPlanDigest, 'actionPlanDigest') !== hash(withoutDigest)) fail('plan closure digest mismatch.');
  return Object.freeze({ ...withoutDigest, actionPlanDigest: value.actionPlanDigest as CiVerificationActionDigestV1 });
}

export function assertCiVerificationActionPlanClosureEqualV1(
  actual: CiVerificationActionPlanClosureV1,
  expected: CiVerificationActionPlanClosureV1
): void {
  const parsed = parseCiVerificationActionPlanClosureV1(encodeVerificationActionDataV2(actual));
  if (parsed.actionPlanDigest !== expected.actionPlanDigest ||
      encodeVerificationActionDataV2(parsed.actions) !== encodeVerificationActionDataV2(expected.actions) ||
      encodeVerificationActionDataV2(parsed.normalizedOperations) !==
        encodeVerificationActionDataV2(expected.normalizedOperations)) {
    fail('plan closure does not match the trusted producer reconstruction.');
  }
}

export function resolveCiVerificationDevRunnerTargetV1(options: {
  readonly plan: VerificationActionPlanV2;
  readonly authorizedClosure: CiVerificationActionPlanClosureV1;
}): CiVerificationNormalizedOperationV2 {
  const authorized = parseCiVerificationActionPlanClosureV1(
    encodeVerificationActionDataV2(options.authorizedClosure)
  );
  const plan = parseVerificationActionPlanV2(encodeVerificationActionDataV2(options.plan));
  const memberIndex = authorized.actions.findIndex((entry) => entry.action.actionKey === plan.action.actionKey);
  const member = authorized.actions[memberIndex];
  if (member === undefined || encodeVerificationActionDataV2(member) !== encodeVerificationActionDataV2(plan)) {
    fail('dev-runner rejected a forged or non-member Action plan.');
  }
  if (plan.action.producer.identity !== 'platform/shared/verification-action-ci-contract.ts' ||
      plan.action.producer.revision !== CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1 ||
      plan.action.operation.revision !== CI_VERIFICATION_ACTION_PRODUCER_REVISION_V1) {
    fail('dev-runner Action producer identity is not trusted.');
  }
  const operation = authorized.normalizedOperations[memberIndex];
  if (operation === undefined || operation.gateId !== plan.action.operation.identity ||
      operation.semanticDigest !== plan.action.operation.semanticDigest) {
    fail('dev-runner rejected a missing or competing normalized operation.');
  }
  return operation;
}
