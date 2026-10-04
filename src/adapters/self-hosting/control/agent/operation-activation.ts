import { canonicalJson, compareCodeUnits, deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';
import { type AgentContentDigest } from './task-capsule.ts';

const AGENT_OPERATION_ACTIVATION_REQUEST_SCHEMA =
  'sec-agent-operation-activation-request-v1' as const;
const AGENT_OPERATION_ACTIVATION_PREPARATION_SCHEMA =
  'sec-agent-operation-activation-preparation-v2' as const;
const AGENT_OPERATION_ACTIVATION_RECEIPT_SCHEMA =
  'sec-agent-operation-activation-receipt-v2' as const;
const AGENT_OPERATION_ACTIVATION_PROVIDER_SCHEMA =
  'sec-agent-operation-activation-provider-v1' as const;
const AGENT_OPERATION_ACTIVATION_PUBLICATION_SCHEMA =
  'sec-agent-operation-activation-publication-v2' as const;
export const AGENT_OPERATION_ACTIVATION_EVENT =
  'sec-produce-agent-operation-activation-v1' as const;
export const AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH =
  '.github/workflows/compiler-pr-validation.yml' as const;
export const AGENT_OPERATION_ACTIVATION_JOB_NAME =
  'agent-operation-activation' as const;
export const AGENT_OPERATION_ACTIVATION_UPLOAD_STEP_NAME =
  'Upload exact Agent operation activation receipt' as const;
export const AGENT_OPERATION_ACTIVATION_STEP_NAME =
  'Publish exact Agent operation activation receipt' as const;
export const AGENT_OPERATION_ACTIVATION_COMMENT_MARKER =
  '<!-- sec-agent-operation-activation-v1 -->' as const;
export const AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE =
  'agent-operation-activation.json' as const;

export interface AgentOperationActivationRequest {
  readonly schema: typeof AGENT_OPERATION_ACTIVATION_REQUEST_SCHEMA;
  readonly phase: 'prepare' | 'finalize';
  readonly pullRequestNumber: number;
  readonly expectedBaseSha: string;
  readonly expectedHeadSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: AgentContentDigest;
  readonly preparationCommentId: number | null;
  readonly requestOperationId: AgentContentDigest;
}

interface AgentOperationActivationControlDigests {
  readonly currentState: AgentContentDigest;
  readonly pointer: AgentContentDigest;
  readonly rollingPlan: AgentContentDigest;
}

export interface AgentOperationActivationProvider {
  readonly schema: typeof AGENT_OPERATION_ACTIVATION_PROVIDER_SCHEMA;
  readonly repositoryId: string;
  readonly workflowPath: typeof AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH;
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly eventName: 'repository_dispatch';
  readonly jobName: typeof AGENT_OPERATION_ACTIVATION_JOB_NAME;
  readonly uploadStepName: typeof AGENT_OPERATION_ACTIVATION_UPLOAD_STEP_NAME;
  readonly publicationStepName: typeof AGENT_OPERATION_ACTIVATION_STEP_NAME;
  readonly actorLogin: string;
  readonly actorNodeId: string;
  readonly actorPermission: 'admin' | 'maintain';
  readonly providerDigest: AgentContentDigest;
}

interface AgentOperationActivationPullRequest {
  readonly number: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly headRef: string;
  readonly manifestPath: string;
  readonly manifestDigest: AgentContentDigest;
}

export interface AgentOperationActivationPreparation {
  readonly schema: typeof AGENT_OPERATION_ACTIVATION_PREPARATION_SCHEMA;
  readonly request: AgentOperationActivationRequest;
  readonly repository: string;
  readonly workId: string;
  readonly currentSpecRef: string;
  readonly currentSpecRevision: AgentContentDigest;
  readonly trustedBaseSha: string;
  readonly trustedBaseTreeSha: string;
  readonly proposal: AgentOperationActivationPullRequest;
  readonly controlDigests: AgentOperationActivationControlDigests;
  readonly authorizedPaths: readonly string[];
  readonly forbiddenPaths: readonly string[];
  readonly proposalChangedPaths: readonly string[];
  readonly operationId: string;
  readonly role: 'worker';
  readonly operationKind: 'implement';
  readonly workDecisionReceiptDigest: AgentContentDigest;
  readonly workDecisionDecisionDigest: AgentContentDigest;
  readonly provider: AgentOperationActivationProvider;
  readonly preparationDigest: AgentContentDigest;
}

export interface AgentOperationActivationReceipt {
  readonly schema: typeof AGENT_OPERATION_ACTIVATION_RECEIPT_SCHEMA;
  readonly request: AgentOperationActivationRequest;
  readonly preparation: AgentOperationActivationPreparation;
  readonly pullRequest: AgentOperationActivationPullRequest;
  readonly controlDigests: AgentOperationActivationControlDigests;
  readonly changedPaths: readonly string[];
  readonly workDecisionReceiptDigest: AgentContentDigest;
  readonly workDecisionDecisionDigest: AgentContentDigest;
  readonly provider: AgentOperationActivationProvider;
  readonly activationDigest: AgentContentDigest;
}

export interface AgentOperationActivationPublication {
  readonly schema: typeof AGENT_OPERATION_ACTIVATION_PUBLICATION_SCHEMA;
  readonly request: AgentOperationActivationRequest;
  readonly payloadDigest: AgentContentDigest;
  readonly artifactId: string;
  readonly artifactName: string;
  readonly artifactFileName: typeof AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE;
  readonly artifactDigest: AgentContentDigest;
  readonly provider: AgentOperationActivationProvider;
  readonly publicationDigest: AgentContentDigest;
}

export type AgentOperationActivationRequestInput = Omit<
  AgentOperationActivationRequest,
  'schema' | 'requestOperationId'
>;
export type AgentOperationActivationProviderInput = Omit<
  AgentOperationActivationProvider,
  'schema' | 'providerDigest'
>;
export type AgentOperationActivationPreparationInput = Omit<
  AgentOperationActivationPreparation,
  'schema' | 'preparationDigest'
>;
export type AgentOperationActivationReceiptInput = Omit<
  AgentOperationActivationReceipt,
  'schema' | 'activationDigest'
>;
export type AgentOperationActivationPublicationInput = Omit<
  AgentOperationActivationPublication,
  'schema' | 'publicationDigest'
>;

const REQUEST_KEYS = [
  'schema', 'phase', 'pullRequestNumber', 'expectedBaseSha', 'expectedHeadSha',
  'manifestPath', 'manifestDigest', 'preparationCommentId', 'requestOperationId'
] as const;
const REQUEST_INPUT_KEYS = REQUEST_KEYS.filter((key) => key !== 'schema' && key !== 'requestOperationId');
const PROVIDER_KEYS = [
  'schema', 'repositoryId', 'workflowPath', 'workflowRef', 'workflowSha', 'runId',
  'runAttempt', 'eventName', 'jobName', 'uploadStepName', 'publicationStepName',
  'actorLogin', 'actorNodeId', 'actorPermission', 'providerDigest'
] as const;
const PROVIDER_INPUT_KEYS = PROVIDER_KEYS.filter((key) => key !== 'schema' && key !== 'providerDigest');
const PREPARATION_KEYS = [
  'schema', 'request', 'repository', 'workId', 'currentSpecRef', 'currentSpecRevision',
  'trustedBaseSha', 'trustedBaseTreeSha', 'proposal', 'controlDigests', 'authorizedPaths',
  'forbiddenPaths', 'proposalChangedPaths', 'operationId', 'role', 'operationKind',
  'workDecisionReceiptDigest', 'workDecisionDecisionDigest',
  'provider', 'preparationDigest'
] as const;
const PREPARATION_INPUT_KEYS = PREPARATION_KEYS.filter((key) => (
  key !== 'schema' && key !== 'preparationDigest'
));
const RECEIPT_KEYS = [
  'schema', 'request', 'preparation', 'pullRequest', 'controlDigests', 'changedPaths',
  'workDecisionReceiptDigest', 'workDecisionDecisionDigest', 'provider', 'activationDigest'
] as const;
const RECEIPT_INPUT_KEYS = RECEIPT_KEYS.filter((key) => key !== 'schema' && key !== 'activationDigest');
const PUBLICATION_KEYS = [
  'schema', 'request', 'payloadDigest', 'artifactId', 'artifactName',
  'artifactFileName', 'artifactDigest', 'provider', 'publicationDigest'
] as const;
const PUBLICATION_INPUT_KEYS = PUBLICATION_KEYS.filter((key) => key !== 'schema' && key !== 'publicationDigest');
const CONTROL_KEYS = ['currentState', 'pointer', 'rollingPlan'] as const;
const PULL_REQUEST_KEYS = [
  'number', 'baseSha', 'headSha', 'headTreeSha', 'headRef', 'manifestPath', 'manifestDigest'
] as const;

function fail(message: string): never {
  throw new Error(`Agent Operation Activation: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be one plain object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const wanted = [...expected].sort(compareCodeUnits);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys must be exact; received ${actual.join(',')}.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || value.trim() !== value || value.normalize('NFC') !== value
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be one bounded canonical string.`);
  }
  return value;
}

function token(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(normalized)) fail(`${label} must be one canonical token.`);
  return normalized;
}

function digest(value: unknown, label: string): AgentContentDigest {
  const normalized = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) fail(`${label} must be one SHA-256 digest.`);
  return normalized as AgentContentDigest;
}

function gitSha(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(normalized)) fail(`${label} must be one lowercase Git SHA-1.`);
  return normalized;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(`${label} must be positive.`);
  return value as number;
}

function decimalIdentity(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[1-9][0-9]*$/u.test(normalized)) fail(`${label} must be positive decimal text.`);
  return normalized;
}

function repositoryPath(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!CodexDevelopmentIsCanonicalRepositoryPath(normalized)) fail(`${label} is not canonical.`);
  return normalized;
}

function ownershipPath(value: unknown, label: string): string {
  const normalized = text(value, label);
  const candidate = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  if (!CodexDevelopmentIsCanonicalRepositoryPath(candidate)) fail(`${label} is not a canonical ownership path.`);
  return normalized;
}

function scopeCovers(scope: string, repositoryPathValue: string): boolean {
  return scope.endsWith('/') ? repositoryPathValue.startsWith(scope) : repositoryPathValue === scope;
}

function repository(value: unknown): string {
  const normalized = text(value, 'repository');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(normalized)) {
    fail('repository must be one owner/name identity.');
  }
  return normalized;
}

function branch(value: unknown): string {
  const normalized = text(value, 'headRef');
  if (!normalized.startsWith('codex/') || normalized.includes('..') || normalized.includes('@{')
      || /[~^:?*\[\]\\]/u.test(normalized) || normalized.endsWith('.')
      || normalized.endsWith('/') || normalized.includes('//')) {
    fail('headRef must be one option-safe codex branch.');
  }
  return normalized;
}

function sortedUniquePaths(value: unknown, label: string, allowEmpty = false): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${label} must be one path array.`);
  const normalized = value.map((entry, index) => repositoryPath(entry, `${label}[${index}]`))
    .sort(compareCodeUnits);
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains a duplicate.`);
  return Object.freeze(normalized);
}

function sortedUniqueOwnershipPaths(value: unknown, label: string, allowEmpty = false): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${label} must be one ownership array.`);
  const normalized = value.map((entry, index) => ownershipPath(entry, `${label}[${index}]`))
    .sort(compareCodeUnits);
  if (new Set(normalized).size !== normalized.length) fail(`${label} contains a duplicate.`);
  return Object.freeze(normalized);
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function parseControls(value: unknown): AgentOperationActivationControlDigests {
  const controls = record(value, 'controlDigests');
  exactKeys(controls, CONTROL_KEYS, 'controlDigests');
  return Object.freeze({
    currentState: digest(controls.currentState, 'controlDigests.currentState'),
    pointer: digest(controls.pointer, 'controlDigests.pointer'),
    rollingPlan: digest(controls.rollingPlan, 'controlDigests.rollingPlan')
  });
}

function parsePullRequest(value: unknown): AgentOperationActivationPullRequest {
  const pullRequest = record(value, 'pullRequest');
  exactKeys(pullRequest, PULL_REQUEST_KEYS, 'pullRequest');
  return Object.freeze({
    number: positiveInteger(pullRequest.number, 'pullRequest.number'),
    baseSha: gitSha(pullRequest.baseSha, 'pullRequest.baseSha'),
    headSha: gitSha(pullRequest.headSha, 'pullRequest.headSha'),
    headTreeSha: gitSha(pullRequest.headTreeSha, 'pullRequest.headTreeSha'),
    headRef: branch(pullRequest.headRef),
    manifestPath: repositoryPath(pullRequest.manifestPath, 'pullRequest.manifestPath'),
    manifestDigest: digest(pullRequest.manifestDigest, 'pullRequest.manifestDigest')
  });
}

export function agentOperationActivationArtifactName(
  phase: 'prepare' | 'finalize',
  requestOperationId: AgentContentDigest
): string {
  return `sec-agent-operation-activation-${phase}-${digest(requestOperationId, 'requestOperationId').slice(7)}`;
}

export function agentOperationActivationOperationId(requestOperationId: AgentContentDigest): string {
  return `worker-implement-${digest(requestOperationId, 'requestOperationId').slice(7)}`;
}

export function createAgentOperationActivationRequest(
  value: AgentOperationActivationRequestInput
): AgentOperationActivationRequest {
  const input = record(value, 'request input');
  exactKeys(input, REQUEST_INPUT_KEYS, 'request input');
  if (input.phase !== 'prepare' && input.phase !== 'finalize') fail('request phase is unsupported.');
  const phase: AgentOperationActivationRequest['phase'] = input.phase;
  const preparationCommentId = input.preparationCommentId === null
    ? null
    : positiveInteger(input.preparationCommentId, 'preparationCommentId');
  if ((phase === 'prepare') !== (preparationCommentId === null)) {
    fail('prepare requires null and finalize requires one preparationCommentId.');
  }
  const normalized = deepFreeze({
    schema: AGENT_OPERATION_ACTIVATION_REQUEST_SCHEMA,
    phase,
    pullRequestNumber: positiveInteger(input.pullRequestNumber, 'pullRequestNumber'),
    expectedBaseSha: gitSha(input.expectedBaseSha, 'expectedBaseSha'),
    expectedHeadSha: gitSha(input.expectedHeadSha, 'expectedHeadSha'),
    manifestPath: repositoryPath(input.manifestPath, 'manifestPath'),
    manifestDigest: digest(input.manifestDigest, 'manifestDigest'),
    preparationCommentId
  });
  return deepFreeze({ ...normalized, requestOperationId: sha256(normalized) as AgentContentDigest });
}

export function parseAgentOperationActivationRequest(value: unknown): AgentOperationActivationRequest {
  const request = record(value, 'request');
  exactKeys(request, REQUEST_KEYS, 'request');
  if (request.schema !== AGENT_OPERATION_ACTIVATION_REQUEST_SCHEMA) fail('request schema is unsupported.');
  const compiled = createAgentOperationActivationRequest(
    Object.fromEntries(REQUEST_INPUT_KEYS.map((key) => [key, request[key]])) as unknown as AgentOperationActivationRequestInput
  );
  if (compiled.requestOperationId !== digest(request.requestOperationId, 'requestOperationId')
      || !canonicalEqual(compiled, request)) {
    fail('request is not canonical and digest-bound.');
  }
  return compiled;
}

export function createAgentOperationActivationProvider(
  value: AgentOperationActivationProviderInput
): AgentOperationActivationProvider {
  const input = record(value, 'provider input');
  exactKeys(input, PROVIDER_INPUT_KEYS, 'provider input');
  const workflowSha = gitSha(input.workflowSha, 'provider.workflowSha');
  if (input.actorPermission !== 'admin' && input.actorPermission !== 'maintain') {
    fail('provider workflow, event, job, steps, or actor permission is unsupported.');
  }
  const actorPermission: AgentOperationActivationProvider['actorPermission'] = input.actorPermission;
  if (input.workflowPath !== AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH
      || input.workflowRef !== `${AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH}@${workflowSha}`
      || input.eventName !== 'repository_dispatch'
      || input.jobName !== AGENT_OPERATION_ACTIVATION_JOB_NAME
      || input.uploadStepName !== AGENT_OPERATION_ACTIVATION_UPLOAD_STEP_NAME
      || input.publicationStepName !== AGENT_OPERATION_ACTIVATION_STEP_NAME) {
    fail('provider workflow, event, job, steps, or actor permission is unsupported.');
  }
  const actorLogin = text(input.actorLogin, 'provider.actorLogin').toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/u.test(actorLogin)) fail('provider.actorLogin is invalid.');
  const normalized = deepFreeze({
    schema: AGENT_OPERATION_ACTIVATION_PROVIDER_SCHEMA,
    repositoryId: decimalIdentity(input.repositoryId, 'provider.repositoryId'),
    workflowPath: AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH,
    workflowRef: `${AGENT_OPERATION_ACTIVATION_WORKFLOW_PATH}@${workflowSha}`,
    workflowSha,
    runId: decimalIdentity(input.runId, 'provider.runId'),
    runAttempt: positiveInteger(input.runAttempt, 'provider.runAttempt'),
    eventName: 'repository_dispatch' as const,
    jobName: AGENT_OPERATION_ACTIVATION_JOB_NAME,
    uploadStepName: AGENT_OPERATION_ACTIVATION_UPLOAD_STEP_NAME,
    publicationStepName: AGENT_OPERATION_ACTIVATION_STEP_NAME,
    actorLogin,
    actorNodeId: text(input.actorNodeId, 'provider.actorNodeId'),
    actorPermission
  });
  return deepFreeze({ ...normalized, providerDigest: sha256(normalized) as AgentContentDigest });
}

function parseAgentOperationActivationProvider(value: unknown): AgentOperationActivationProvider {
  const provider = record(value, 'provider');
  exactKeys(provider, PROVIDER_KEYS, 'provider');
  if (provider.schema !== AGENT_OPERATION_ACTIVATION_PROVIDER_SCHEMA) fail('provider schema is unsupported.');
  const compiled = createAgentOperationActivationProvider(
    Object.fromEntries(PROVIDER_INPUT_KEYS.map((key) => [key, provider[key]])) as unknown as AgentOperationActivationProviderInput
  );
  if (compiled.providerDigest !== digest(provider.providerDigest, 'providerDigest')
      || !canonicalEqual(compiled, provider)) {
    fail('provider is not canonical and digest-bound.');
  }
  return compiled;
}

export function createAgentOperationActivationPreparation(
  value: AgentOperationActivationPreparationInput
): AgentOperationActivationPreparation {
  const input = record(value, 'preparation input');
  exactKeys(input, PREPARATION_INPUT_KEYS, 'preparation input');
  if (input.role !== 'worker' || input.operationKind !== 'implement') fail('V1 is limited to worker/implement.');
  const request = parseAgentOperationActivationRequest(input.request);
  if (request.phase !== 'prepare') fail('preparation requires one PRE request.');
  const proposal = parsePullRequest(input.proposal);
  const trustedBaseSha = gitSha(input.trustedBaseSha, 'trustedBaseSha');
  const provider = parseAgentOperationActivationProvider(input.provider);
  const authorizedPaths = sortedUniqueOwnershipPaths(input.authorizedPaths, 'authorizedPaths');
  const forbiddenPaths = sortedUniqueOwnershipPaths(input.forbiddenPaths, 'forbiddenPaths', true);
  const proposalChangedPaths = sortedUniquePaths(input.proposalChangedPaths, 'proposalChangedPaths');
  if (proposal.baseSha !== trustedBaseSha || provider.workflowSha !== trustedBaseSha
      || request.pullRequestNumber !== proposal.number || request.expectedBaseSha !== proposal.baseSha
      || request.expectedHeadSha !== proposal.headSha || request.manifestPath !== proposal.manifestPath
      || request.manifestDigest !== proposal.manifestDigest
      || proposalChangedPaths.some((entry) => !authorizedPaths.some((scope) => scopeCovers(scope, entry)))
      || proposalChangedPaths.some((entry) => forbiddenPaths.some((scope) => scopeCovers(scope, entry)))) {
    fail('PRE request, provider, PR, base, manifest, or proposed scope is inconsistent.');
  }
  const operationId = token(input.operationId, 'operationId');
  if (operationId !== agentOperationActivationOperationId(request.requestOperationId)) {
    fail('operationId is not derived from the PRE request.');
  }
  const normalized = deepFreeze({
    schema: AGENT_OPERATION_ACTIVATION_PREPARATION_SCHEMA,
    request,
    repository: repository(input.repository),
    workId: token(input.workId, 'workId'),
    currentSpecRef: text(input.currentSpecRef, 'currentSpecRef'),
    currentSpecRevision: digest(input.currentSpecRevision, 'currentSpecRevision'),
    trustedBaseSha,
    trustedBaseTreeSha: gitSha(input.trustedBaseTreeSha, 'trustedBaseTreeSha'),
    proposal,
    controlDigests: parseControls(input.controlDigests),
    authorizedPaths,
    forbiddenPaths,
    proposalChangedPaths,
    operationId,
    role: 'worker' as const,
    operationKind: 'implement' as const,
    workDecisionReceiptDigest: digest(input.workDecisionReceiptDigest, 'workDecisionReceiptDigest'),
    workDecisionDecisionDigest: digest(input.workDecisionDecisionDigest, 'workDecisionDecisionDigest'),
    provider
  });
  return deepFreeze({ ...normalized, preparationDigest: sha256(normalized) as AgentContentDigest });
}

export function parseAgentOperationActivationPreparation(
  value: unknown
): AgentOperationActivationPreparation {
  const preparation = record(value, 'preparation');
  exactKeys(preparation, PREPARATION_KEYS, 'preparation');
  if (preparation.schema !== AGENT_OPERATION_ACTIVATION_PREPARATION_SCHEMA) fail('preparation schema is unsupported.');
  const compiled = createAgentOperationActivationPreparation(
    Object.fromEntries(PREPARATION_INPUT_KEYS.map((key) => [key, preparation[key]])) as unknown as AgentOperationActivationPreparationInput
  );
  if (compiled.preparationDigest !== digest(preparation.preparationDigest, 'preparationDigest')
      || !canonicalEqual(compiled, preparation)) {
    fail('preparation is not canonical and digest-bound.');
  }
  return compiled;
}

export function createAgentOperationActivationReceipt(
  value: AgentOperationActivationReceiptInput
): AgentOperationActivationReceipt {
  const input = record(value, 'receipt input');
  exactKeys(input, RECEIPT_INPUT_KEYS, 'receipt input');
  const request = parseAgentOperationActivationRequest(input.request);
  const preparation = parseAgentOperationActivationPreparation(input.preparation);
  const pullRequest = parsePullRequest(input.pullRequest);
  const controlDigests = parseControls(input.controlDigests);
  const changedPaths = sortedUniquePaths(input.changedPaths, 'changedPaths');
  const provider = parseAgentOperationActivationProvider(input.provider);
  if (request.phase !== 'finalize' || request.preparationCommentId === null
      || request.requestOperationId === preparation.request.requestOperationId
      || provider.workflowSha !== preparation.trustedBaseSha
      || request.pullRequestNumber !== pullRequest.number
      || request.expectedBaseSha !== pullRequest.baseSha || request.expectedHeadSha !== pullRequest.headSha
      || request.manifestPath !== pullRequest.manifestPath || request.manifestDigest !== pullRequest.manifestDigest
      || pullRequest.number !== preparation.proposal.number
      || pullRequest.baseSha !== preparation.trustedBaseSha
      || pullRequest.headSha === preparation.proposal.headSha
      || pullRequest.headRef !== preparation.proposal.headRef
      || pullRequest.manifestPath !== preparation.proposal.manifestPath
      || pullRequest.manifestDigest !== preparation.proposal.manifestDigest
      || !canonicalEqual(controlDigests, preparation.controlDigests)
      || changedPaths.some((entry) => !preparation.authorizedPaths.some((scope) => scopeCovers(scope, entry)))
      || changedPaths.some((entry) => preparation.forbiddenPaths.some((scope) => scopeCovers(scope, entry)))
      || changedPaths.every((entry) => preparation.proposalChangedPaths.includes(entry))) {
    fail('FINAL must bind a distinct request and the exact PRE authority, PR, manifest, and scope.');
  }
  const normalized = deepFreeze({
    schema: AGENT_OPERATION_ACTIVATION_RECEIPT_SCHEMA,
    request,
    preparation,
    pullRequest,
    controlDigests,
    changedPaths,
    workDecisionReceiptDigest: digest(input.workDecisionReceiptDigest, 'workDecisionReceiptDigest'),
    workDecisionDecisionDigest: digest(input.workDecisionDecisionDigest, 'workDecisionDecisionDigest'),
    provider
  });
  return deepFreeze({ ...normalized, activationDigest: sha256(normalized) as AgentContentDigest });
}

export function parseAgentOperationActivationReceipt(value: unknown): AgentOperationActivationReceipt {
  const receipt = record(value, 'receipt');
  exactKeys(receipt, RECEIPT_KEYS, 'receipt');
  if (receipt.schema !== AGENT_OPERATION_ACTIVATION_RECEIPT_SCHEMA) fail('receipt schema is unsupported.');
  const compiled = createAgentOperationActivationReceipt(
    Object.fromEntries(RECEIPT_INPUT_KEYS.map((key) => [key, receipt[key]])) as unknown as AgentOperationActivationReceiptInput
  );
  if (compiled.activationDigest !== digest(receipt.activationDigest, 'activationDigest')
      || !canonicalEqual(compiled, receipt)) {
    fail('receipt is not canonical and digest-bound.');
  }
  return compiled;
}

export function createAgentOperationActivationPublication(
  value: AgentOperationActivationPublicationInput
): AgentOperationActivationPublication {
  const input = record(value, 'publication input');
  exactKeys(input, PUBLICATION_INPUT_KEYS, 'publication input');
  const request = parseAgentOperationActivationRequest(input.request);
  const artifactName = text(input.artifactName, 'artifactName');
  if (artifactName !== agentOperationActivationArtifactName(request.phase, request.requestOperationId)
      || input.artifactFileName !== AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE) {
    fail('publication artifact name or file is not canonical.');
  }
  const normalized = deepFreeze({
    schema: AGENT_OPERATION_ACTIVATION_PUBLICATION_SCHEMA,
    request,
    payloadDigest: digest(input.payloadDigest, 'payloadDigest'),
    artifactId: decimalIdentity(input.artifactId, 'artifactId'),
    artifactName,
    artifactFileName: AGENT_OPERATION_ACTIVATION_ARTIFACT_FILE,
    artifactDigest: digest(input.artifactDigest, 'artifactDigest'),
    provider: parseAgentOperationActivationProvider(input.provider)
  });
  return deepFreeze({ ...normalized, publicationDigest: sha256(normalized) as AgentContentDigest });
}

function parseAgentOperationActivationPublication(
  value: unknown
): AgentOperationActivationPublication {
  const publication = record(value, 'publication');
  exactKeys(publication, PUBLICATION_KEYS, 'publication');
  if (publication.schema !== AGENT_OPERATION_ACTIVATION_PUBLICATION_SCHEMA) fail('publication schema is unsupported.');
  const compiled = createAgentOperationActivationPublication(
    Object.fromEntries(PUBLICATION_INPUT_KEYS.map((key) => [key, publication[key]])) as unknown as AgentOperationActivationPublicationInput
  );
  if (compiled.publicationDigest !== digest(publication.publicationDigest, 'publicationDigest')
      || !canonicalEqual(compiled, publication)) {
    fail('publication is not canonical and digest-bound.');
  }
  return compiled;
}

export function renderAgentOperationActivationPublicationComment(
  value: AgentOperationActivationPublication
): string {
  const publication = parseAgentOperationActivationPublication(value);
  return `${AGENT_OPERATION_ACTIVATION_COMMENT_MARKER}\n\`\`\`json\n${JSON.stringify(canonicalJson(publication), null, 2)}\n\`\`\``;
}

export function parseAgentOperationActivationPublicationComment(
  source: string
): AgentOperationActivationPublication | null {
  if (!source.includes(AGENT_OPERATION_ACTIVATION_COMMENT_MARKER)) return null;
  const prefix = `${AGENT_OPERATION_ACTIVATION_COMMENT_MARKER}\n\`\`\`json\n`;
  const suffix = '\n```';
  if (!source.startsWith(prefix) || !source.endsWith(suffix)) fail('publication comment shape is invalid.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.slice(prefix.length, -suffix.length)) as unknown;
  } catch {
    fail('publication comment JSON is invalid.');
  }
  const publication = parseAgentOperationActivationPublication(parsed);
  if (source !== renderAgentOperationActivationPublicationComment(publication)) {
    fail('publication comment bytes are not canonical.');
  }
  return publication;
}
