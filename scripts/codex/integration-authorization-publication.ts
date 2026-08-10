/**
 * Canonical GitHub-remote receipt for one hosted IntegrationAuthorization.
 *
 * Provider workflow job/step history owns effect linearization. The issue
 * comment is an immutable App-authenticated receipt and merge-marker binding;
 * it is deliberately not represented as a compare-and-swap primitive.
 */

import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME_V1,
  assertHostedCommentProvenanceLive,
  hostedPublisherMatches,
  listIssueComments,
  parseHostedWorkflowCommentProvenanceV1,
  type HostedWorkflowCommentProvenanceV1
} from './branch-closeout-receipt.ts';
import {
  parsePreparedBranchCloseoutEnvelope,
  type PreparedBranchCloseoutEnvelope
} from './branch-closeout.ts';
import { branchLifecycleDigest } from './branch-lifecycle-audit.ts';
import {
  CodexDevelopmentParseMergeGateResultV2,
  type CodexDevelopmentMergeGateResultV2
} from './merge-gate.ts';
import type {
  GitHubWorkflowJobObservationV1,
  GitHubWorkflowJobStepObservationV1,
  GitHubWorkflowRunObservationV1
} from './verification-session-github.ts';

export const INTEGRATION_AUTHORIZATION_OPERATION_PUBLICATION_SCHEMA_V1 =
  'sec-integration-authorization-operation-publication-v1' as const;
export const INTEGRATION_AUTHORIZATION_OPERATION_COMMENT_MARKER =
  '<!-- sec-integration-authorization-operation-v1 -->' as const;

export interface IntegrationAuthorizationOperationPublicationV1 {
  schema: typeof INTEGRATION_AUTHORIZATION_OPERATION_PUBLICATION_SCHEMA_V1;
  repository: string;
  pullRequestNumber: number;
  sessionRevision: `sha256:${string}`;
  authorizationId: string;
  authorizationPublicationId: `sha256:${string}`;
  authorizationReceiptDigest: `sha256:${string}`;
  consumptionOperationId: `sha256:${string}`;
  result: CodexDevelopmentMergeGateResultV2;
  closeoutPreparation: PreparedBranchCloseoutEnvelope;
  recoveryArtifact: IntegrationCloseoutRecoveryArtifactObservationV1;
  provenance: HostedWorkflowCommentProvenanceV1;
  publicationDigest: `sha256:${string}`;
}

export interface IntegrationCloseoutRecoveryArtifactObservationV1 {
  artifactId: string;
  artifactName: string;
  artifactFileName: 'branch-closeout-recovery.json';
  artifactDigest: `sha256:${string}`;
  runId: string;
  runAttempt: number;
}

export interface CanonicalIntegrationRunOwnerV1 {
  runId: string;
  runAttempt: number;
  sourceRunId: string;
  sourceRunAttempt: number;
}

export const HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1 = Object.freeze({
  recoveryPreparation: 'Prepare exact integration recovery artifact',
  integration: 'Integrate exact hosted Session and publish live readback status',
  closeoutMutation: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME_V1,
  closeoutPublication: 'Publish exact branch closeout receipt'
} as const);

export type HostedIntegrationPhaseV1 = keyof typeof HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1;

export interface HostedIntegrationPhaseOwnershipV1 {
  runId: string;
  runAttempt: number;
  jobId: string;
  jobName: string;
  phase: HostedIntegrationPhaseV1;
  stepName: string;
  stepNumber: number;
  priorAttemptStarted: boolean;
  priorEffectStarted: boolean;
  priorEffectPhases: readonly HostedIntegrationPhaseV1[];
}

const COMMENT_JSON_PREFIX =
  `${INTEGRATION_AUTHORIZATION_OPERATION_COMMENT_MARKER}\n` + '```json\n';
const COMMENT_JSON_SUFFIX = '\n```';

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function repositoryValue(value: unknown): string {
  if (typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)) {
    throw new Error('Integration authorization repository must be one owner/name identity.');
  }
  return value;
}

function digestValue(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function boundedIdentity(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.trim() !== value) {
    throw new Error(`${label} must be bounded canonical text.`);
  }
  return value;
}

function comparePositiveDecimal(left: string, right: string): number {
  if (!/^[1-9][0-9]*$/u.test(left) || !/^[1-9][0-9]*$/u.test(right)) {
    throw new Error('Integration workflow run id must be canonical positive decimal text.');
  }
  return left.length - right.length || left.localeCompare(right);
}

/**
 * Duplicate workflow_run deliveries are ordered by immutable provider run id.
 * Only the smallest exact run may mint the remote start claim; reruns of that
 * same run use its current provider runAttempt.
 */
export function selectCanonicalIntegrationRunOwnerV1(input: {
  runs: readonly GitHubWorkflowRunObservationV1[];
  currentRunId: string;
  currentRunAttempt: number;
  sourceRunId: string;
  sourceRunAttempt: number;
  baseSha: string;
}): CanonicalIntegrationRunOwnerV1 {
  if (!/^[1-9][0-9]*$/u.test(input.currentRunId)
    || !/^[1-9][0-9]*$/u.test(input.sourceRunId)
    || !Number.isSafeInteger(input.currentRunAttempt) || input.currentRunAttempt < 1
    || !Number.isSafeInteger(input.sourceRunAttempt) || input.sourceRunAttempt < 1
    || !/^[0-9a-f]{40}$/u.test(input.baseSha)) {
    throw new Error('Integration workflow owner identity is invalid.');
  }
  const expectedTitle = `integrate compiler session run ${input.sourceRunId} attempt ${input.sourceRunAttempt}`;
  const prefix = `integrate compiler session run ${input.sourceRunId} attempt `;
  const exact: GitHubWorkflowRunObservationV1[] = [];
  for (const run of input.runs) {
    if (!run.displayTitle.startsWith(prefix)) continue;
    if (run.displayTitle !== expectedTitle || run.name !== 'sec-merge-gate'
      || run.workflowPath !== '.github/workflows/sec-merge-gate.yml'
      || run.event !== 'workflow_run' || run.headSha !== input.baseSha) {
      throw new Error('Integration workflow inventory contains a conflicting source identity.');
    }
    exact.push(run);
  }
  exact.sort((left, right) => comparePositiveDecimal(left.id, right.id));
  const owner = exact[0];
  if (owner === undefined || owner.id !== input.currentRunId
    || owner.runAttempt !== input.currentRunAttempt) {
    throw new Error('Current integration invocation is not the canonical smallest exact workflow run owner.');
  }
  return Object.freeze({ runId: owner.id, runAttempt: owner.runAttempt,
    sourceRunId: input.sourceRunId, sourceRunAttempt: input.sourceRunAttempt });
}

function stepStarted(step: GitHubWorkflowJobStepObservationV1): boolean {
  if (step.status === 'queued') {
    if (step.startedAt !== null || step.completedAt !== null || step.conclusion !== null) {
      throw new Error('Queued integration phase step carries impossible terminal/start facts.');
    }
    return false;
  }
  if (step.status === 'in_progress') {
    if (step.startedAt === null || step.completedAt !== null || step.conclusion !== null) {
      throw new Error('In-progress integration phase step facts are malformed.');
    }
    return true;
  }
  if (step.conclusion === 'skipped' && step.startedAt === null) {
    if (step.completedAt === null) throw new Error('Skipped integration phase step lacks completion time.');
    return false;
  }
  if (step.startedAt === null || step.completedAt === null || step.conclusion === null) {
    throw new Error('Completed integration phase step facts are incomplete.');
  }
  return true;
}

/**
 * Provider-backed phase linearization. The workflow job/step record is only an
 * effect-start tombstone; it never grants merge or closeout authorization.
 */
export function assertHostedIntegrationPhaseOwnershipV1(input: {
  attempts: readonly Readonly<{
    runAttempt: number;
    jobs: readonly GitHubWorkflowJobObservationV1[];
  }>[];
  runId: string;
  currentRunAttempt: number;
  currentJobName: string;
  workflowSha: string;
  phase: HostedIntegrationPhaseV1;
}): HostedIntegrationPhaseOwnershipV1 {
  if (!/^[1-9][0-9]*$/u.test(input.runId)
    || !Number.isSafeInteger(input.currentRunAttempt) || input.currentRunAttempt < 1
    || input.currentRunAttempt > 1000 || input.currentJobName !== 'integrate'
    || !/^[0-9a-f]{40}$/u.test(input.workflowSha)) {
    throw new Error('Hosted integration phase identity is invalid.');
  }
  const stepName = HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1[input.phase];
  const attemptIds = new Set<number>();
  let currentJob: GitHubWorkflowJobObservationV1 | null = null;
  let currentStep: GitHubWorkflowJobStepObservationV1 | null = null;
  const priorEffectPhases = new Set<HostedIntegrationPhaseV1>();
  const hostedIntegrationPhases: readonly HostedIntegrationPhaseV1[] =
    Object.keys(HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1) as HostedIntegrationPhaseV1[];
  for (const attempt of input.attempts) {
    if (!Number.isSafeInteger(attempt.runAttempt) || attempt.runAttempt < 1
      || attempt.runAttempt > input.currentRunAttempt || attemptIds.has(attempt.runAttempt)) {
      throw new Error('Hosted integration phase attempt inventory is incomplete or duplicated.');
    }
    attemptIds.add(attempt.runAttempt);
    const jobs = attempt.jobs.filter((job) => job.name === input.currentJobName);
    if (jobs.length > 1) throw new Error('Hosted integration attempt has duplicate canonical jobs.');
    const job = jobs[0];
    if (job === undefined) continue;
    if (job.runId !== input.runId || job.runAttempt !== attempt.runAttempt
      || job.headSha !== input.workflowSha || !/^[1-9][0-9]*$/u.test(job.id)) {
      throw new Error('Hosted integration job provider identity drifted.');
    }
    const steps = job.steps.filter((step) => step.name === stepName);
    if (steps.length > 1) throw new Error('Hosted integration job has duplicate canonical phase steps.');
    const phaseStep = steps[0];
    if (attempt.runAttempt === input.currentRunAttempt) {
      if (job.status !== 'in_progress' || job.conclusion !== null || phaseStep === undefined
        || phaseStep.status !== 'in_progress' || !stepStarted(phaseStep)) {
        throw new Error('Current hosted integration phase is not provider-confirmed in progress.');
      }
      currentJob = job;
      currentStep = phaseStep;
    } else {
      for (const priorPhase of hostedIntegrationPhases) {
        const priorPhaseSteps = job.steps.filter((step) => (
          step.name === HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1[priorPhase]
        ));
        if (priorPhaseSteps.length > 1) {
          throw new Error('Hosted integration attempt has duplicate canonical phase steps.');
        }
        if (priorPhaseSteps[0] !== undefined && stepStarted(priorPhaseSteps[0])) {
          priorEffectPhases.add(priorPhase);
        }
      }
    }
  }
  for (let attempt = 1; attempt <= input.currentRunAttempt; attempt += 1) {
    if (!attemptIds.has(attempt)) {
      throw new Error('Hosted integration phase attempt inventory has a pagination/attempt gap.');
    }
  }
  if (currentJob === null || currentStep === null) {
    throw new Error('Current hosted integration phase provider record is absent.');
  }
  const orderedPriorEffectPhases = Object.freeze(
    hostedIntegrationPhases.filter((phase) => priorEffectPhases.has(phase)));
  return Object.freeze({ runId: input.runId, runAttempt: input.currentRunAttempt,
    jobId: currentJob.id, jobName: currentJob.name, phase: input.phase,
    stepName, stepNumber: currentStep.number,
    priorAttemptStarted: priorEffectPhases.has(input.phase),
    priorEffectStarted: orderedPriorEffectPhases.length > 0,
    priorEffectPhases: orderedPriorEffectPhases });
}

function authorizationPublicationPayload(input: Omit<
  IntegrationAuthorizationOperationPublicationV1,
  'schema' | 'publicationDigest'
>): Omit<IntegrationAuthorizationOperationPublicationV1, 'publicationDigest'> {
  return { schema: INTEGRATION_AUTHORIZATION_OPERATION_PUBLICATION_SCHEMA_V1, ...input };
}

export function createIntegrationAuthorizationOperationPublicationV1(input: {
  result: CodexDevelopmentMergeGateResultV2;
  closeoutPreparation: PreparedBranchCloseoutEnvelope;
  recoveryArtifact: IntegrationCloseoutRecoveryArtifactObservationV1;
  provenance: HostedWorkflowCommentProvenanceV1;
}): IntegrationAuthorizationOperationPublicationV1 {
  const result = CodexDevelopmentParseMergeGateResultV2(encodeVerificationActionDataV2(input.result));
  const closeoutPreparation = parsePreparedBranchCloseoutEnvelope(
    `${JSON.stringify(input.closeoutPreparation, null, 2)}\n`
  );
  const provenance = parseHostedWorkflowCommentProvenanceV1(input.provenance);
  const recoveryArtifact = input.recoveryArtifact;
  assertRecord(recoveryArtifact, 'Integration authorization recovery artifact observation');
  assertExactKeys(recoveryArtifact as unknown as Record<string, unknown>, [
    'artifactId', 'artifactName', 'artifactFileName', 'artifactDigest', 'runId', 'runAttempt'
  ], 'Integration authorization recovery artifact observation');
  if (!/^[1-9][0-9]*$/u.test(recoveryArtifact.artifactId)
    || !/^sec-branch-closeout-recovery-v1-pr-[1-9][0-9]*-session-[0-9a-f]{64}-run-[1-9][0-9]*-attempt-[1-9][0-9]*$/u.test(recoveryArtifact.artifactName)
    || recoveryArtifact.artifactFileName !== 'branch-closeout-recovery.json'
    || !/^sha256:[0-9a-f]{64}$/u.test(recoveryArtifact.artifactDigest)
    || !/^[1-9][0-9]*$/u.test(recoveryArtifact.runId)
    || !Number.isSafeInteger(recoveryArtifact.runAttempt) || recoveryArtifact.runAttempt < 1) {
    throw new Error('Integration authorization recovery artifact observation is invalid.');
  }
  const authorization = result.authorization;
  const expectedRecoveryArtifactName = `sec-branch-closeout-recovery-v1-pr-${authorization.prNumber}`
    + `-session-${authorization.sessionRevision.slice(7)}-run-${provenance.runId}-attempt-${provenance.runAttempt}`;
  if (closeoutPreparation.preparation.repository.fullName !== authorization.repository
    || closeoutPreparation.preparation.pullRequestNumber !== authorization.prNumber
    || closeoutPreparation.preparation.expectedHeadSha !== authorization.headSha
    || result.provenance.workflowSha !== provenance.workflowSha
    || result.provenance.sourceRunId !== provenance.runId
    || result.provenance.sourceRunAttempt !== provenance.runAttempt
    || result.provenance.actorNodeId !== provenance.actorNodeId
    || recoveryArtifact.runId !== provenance.runId
    || recoveryArtifact.runAttempt !== provenance.runAttempt
    || recoveryArtifact.artifactName !== expectedRecoveryArtifactName) {
    throw new Error('Integration authorization publication preparation/provenance closure mismatch.');
  }
  const authorizationPublicationId = branchLifecycleDigest({
    consumptionOperationId: digestValue(authorization.consumptionOperationId,
      'authorization publication consumptionOperationId'),
    authorizationReceiptDigest: authorization.receiptDigest
  });
  const payload = authorizationPublicationPayload({
    repository: authorization.repository,
    pullRequestNumber: authorization.prNumber,
    sessionRevision: authorization.sessionRevision,
    authorizationId: authorization.authorizationId,
    authorizationPublicationId,
    authorizationReceiptDigest: authorization.receiptDigest,
    consumptionOperationId: digestValue(authorization.consumptionOperationId,
      'authorization publication consumptionOperationId'),
    result,
    closeoutPreparation,
    recoveryArtifact: Object.freeze({ artifactId: recoveryArtifact.artifactId,
      artifactName: recoveryArtifact.artifactName,
      artifactFileName: recoveryArtifact.artifactFileName,
      artifactDigest: recoveryArtifact.artifactDigest,
      runId: recoveryArtifact.runId,
      runAttempt: recoveryArtifact.runAttempt }),
    provenance
  });
  return Object.freeze({ ...payload, publicationDigest: branchLifecycleDigest(payload) });
}

export function parseIntegrationAuthorizationOperationPublicationV1(
  value: unknown
): IntegrationAuthorizationOperationPublicationV1 {
  assertRecord(value, 'Integration authorization operation publication');
  assertExactKeys(value, [
    'schema', 'repository', 'pullRequestNumber', 'sessionRevision', 'authorizationId',
    'authorizationPublicationId', 'authorizationReceiptDigest', 'consumptionOperationId',
    'result', 'closeoutPreparation', 'recoveryArtifact', 'provenance', 'publicationDigest'
  ], 'Integration authorization operation publication');
  if (value.schema !== INTEGRATION_AUTHORIZATION_OPERATION_PUBLICATION_SCHEMA_V1) {
    throw new Error('Integration authorization operation publication schema mismatch.');
  }
  const rebuilt = createIntegrationAuthorizationOperationPublicationV1({
    result: CodexDevelopmentParseMergeGateResultV2(encodeVerificationActionDataV2(value.result)),
    closeoutPreparation: parsePreparedBranchCloseoutEnvelope(
      `${JSON.stringify(value.closeoutPreparation, null, 2)}\n`),
    recoveryArtifact: value.recoveryArtifact as IntegrationCloseoutRecoveryArtifactObservationV1,
    provenance: parseHostedWorkflowCommentProvenanceV1(value.provenance)
  });
  const exact = {
    repository: repositoryValue(value.repository),
    pullRequestNumber: positiveInteger(value.pullRequestNumber, 'authorization publication PR'),
    sessionRevision: digestValue(value.sessionRevision, 'authorization publication sessionRevision'),
    authorizationId: boundedIdentity(value.authorizationId, 'authorization publication authorizationId'),
    authorizationPublicationId: digestValue(value.authorizationPublicationId,
      'authorization publication identity'),
    authorizationReceiptDigest: digestValue(value.authorizationReceiptDigest,
      'authorization publication receipt'),
    consumptionOperationId: digestValue(value.consumptionOperationId,
      'authorization publication operation'),
    publicationDigest: digestValue(value.publicationDigest, 'authorization publication digest')
  };
  for (const [key, actual] of Object.entries(exact)) {
    if ((rebuilt as unknown as Record<string, unknown>)[key] !== actual) {
      throw new Error(`Integration authorization operation publication ${key} mismatch.`);
    }
  }
  return rebuilt;
}

export function renderIntegrationAuthorizationOperationPublicationComment(
  publication: IntegrationAuthorizationOperationPublicationV1
): string {
  const validated = parseIntegrationAuthorizationOperationPublicationV1(publication);
  return `${COMMENT_JSON_PREFIX}${encodeVerificationActionDataV2(validated)}${COMMENT_JSON_SUFFIX}`;
}

export function parseIntegrationAuthorizationOperationPublicationComment(
  source: string
): IntegrationAuthorizationOperationPublicationV1 | null {
  if (!source.includes(INTEGRATION_AUTHORIZATION_OPERATION_COMMENT_MARKER)) return null;
  if (!source.startsWith(COMMENT_JSON_PREFIX) || !source.endsWith(COMMENT_JSON_SUFFIX)) {
    throw new Error('Integration authorization operation comment shape is invalid.');
  }
  const json = source.slice(COMMENT_JSON_PREFIX.length, -COMMENT_JSON_SUFFIX.length);
  if (json.length === 0 || json.trim() !== json) {
    throw new Error('Integration authorization operation comment JSON is not byte-exact.');
  }
  const publication = parseIntegrationAuthorizationOperationPublicationV1(JSON.parse(json));
  if (source !== renderIntegrationAuthorizationOperationPublicationComment(publication)) {
    throw new Error('Integration authorization operation comment bytes are not canonical.');
  }
  return publication;
}

export function observeIntegrationAuthorizationOperationPublicationsV1(
  repositoryRoot: string,
  input: { repository: string; pullRequestNumber: number; sessionRevision: `sha256:${string}` }
): readonly Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublicationV1 }>[] {
  const endpoint = `/repos/${input.repository}/issues/${input.pullRequestNumber}/comments`;
  const inventory = listIssueComments(repositoryRoot, endpoint);
  if (inventory.comments === null) {
    throw new Error(`Integration authorization comment inventory failed: ${inventory.detail}`);
  }
  const publications: Array<{ commentId: number; publication: IntegrationAuthorizationOperationPublicationV1 }> = [];
  for (const comment of inventory.comments) {
    if (!comment.body.includes(INTEGRATION_AUTHORIZATION_OPERATION_COMMENT_MARKER)) continue;
    if (!hostedPublisherMatches(comment)) {
      throw new Error(`Integration authorization comment ${comment.id} has the wrong app provenance.`);
    }
    let publication: IntegrationAuthorizationOperationPublicationV1;
    try {
      const parsed = parseIntegrationAuthorizationOperationPublicationComment(comment.body);
      if (parsed === null) throw new Error('authorization marker did not parse');
      publication = parsed;
    } catch (error) {
      throw new Error(`Integration authorization comment ${comment.id} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    assertHostedCommentProvenanceLive(
      repositoryRoot,
      input.repository,
      comment,
      publication.provenance
    );
    if (publication.repository !== input.repository
      || publication.pullRequestNumber !== input.pullRequestNumber) {
      throw new Error(`Integration authorization comment ${comment.id} targets a different PR.`);
    }
    if (publication.sessionRevision === input.sessionRevision) {
      publications.push({ commentId: comment.id, publication });
    }
  }
  const ids = new Set<number>();
  const publicationsById = new Map<string, string>();
  for (const entry of publications) {
    if (ids.has(entry.commentId)) {
      throw new Error('Integration authorization comment inventory contains a duplicate comment id.');
    }
    ids.add(entry.commentId);
    const previous = publicationsById.get(entry.publication.authorizationPublicationId);
    if (previous !== undefined) {
      throw new Error(previous === entry.publication.publicationDigest
        ? 'Duplicate comments exist for one authorization publication.'
        : 'One authorization publication id has conflicting canonical bytes.');
    }
    publicationsById.set(entry.publication.authorizationPublicationId,
      entry.publication.publicationDigest);
  }
  return Object.freeze(publications.map((entry) => Object.freeze(entry)));
}
