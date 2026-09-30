/** VerificationSession physical owner recovered from current-main semantics. */
import type { GitHubWorkflowJobObservation } from '../../../../providers/github-api/contract.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { assertCiVerificationActionProviderEnvelopeMember, CI_VERIFICATION_ACTION_DISPATCH_TYPE, type CiVerificationActionParentDispatchPlan, ciVerificationActionParentDispatchPlanPayloadDigest, type CiVerificationActionProviderEnvelope, parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionProviderEnvelope } from '../../action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, matchesCiCompilerWorkflowRunIdentity } from '../../action/contract/provider.ts';
import type { GitHubActionsArtifactObservation } from '../runtime/verification-session-github.ts';
import { parseVerificationSessionHostedRequest } from '../runtime/verification-session-runtime.ts';
import { CI_VERIFICATION_SESSION_DISPATCH_TYPE } from './revision.ts';
import { createHash } from 'node:crypto';

type HostedCompilerDispatchPayload = Readonly<{ payload: unknown }>;

function unwrapHostedCompilerDispatchPayload(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('observe-hosted repository_dispatch payload must be one object.');
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'payload') {
    throw new Error('observe-hosted repository_dispatch payload must be the exact one-key wrapper.');
  }
  return (input as HostedCompilerDispatchPayload).payload;
}

export function assertHostedCompilerDispatchPayload(input: {
  action: unknown;
  clientPayload: unknown;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
}): Readonly<{ kind: 'external-session' } | {
  kind: 'internal-action';
  envelope: CiVerificationActionProviderEnvelope;
}> {
  const { action, clientPayload, request } = input;
  const payload = unwrapHostedCompilerDispatchPayload(clientPayload);
  if (action === CI_VERIFICATION_SESSION_DISPATCH_TYPE) {
    if (encodeVerificationActionData(payload) !== encodeVerificationActionData(request)) {
      throw new Error('observe-hosted external Session payload differs from the canonical request.');
    }
    return Object.freeze({ kind: 'external-session' as const });
  }
  if (action !== CI_VERIFICATION_ACTION_DISPATCH_TYPE) {
    throw new Error('observe-hosted repository_dispatch action is not canonical.');
  }
  const envelope = parseCiVerificationActionProviderEnvelope(payload);
  const embeddedRequest = parseVerificationSessionHostedRequest(
    encodeVerificationActionData(envelope.proposal.sessionRequest)
  );
  if (encodeVerificationActionData(embeddedRequest)
    !== encodeVerificationActionData(request)) {
    throw new Error('observe-hosted internal Action Session request differs from the canonical request.');
  }
  return Object.freeze({ kind: 'internal-action' as const, envelope });
}

function assertGitHubIdentityRecord(input: unknown, expected: Readonly<{
  login: string;
  id: number;
  nodeId: string;
  type: string;
}>, label: string): void {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} identity is unavailable.`);
  }
  const record = input as Record<string, unknown>;
  if (record.login !== expected.login || record.id !== expected.id
    || record.node_id !== expected.nodeId || record.type !== expected.type) {
    throw new Error(`${label} does not match the canonical GitHub identity.`);
  }
}

export function assertHostedCompilerInternalProvenance(input: {
  repository: string;
  repositoryId: string;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  envelope: CiVerificationActionProviderEnvelope;
  parentPlanSource: string;
  parentArtifact: GitHubActionsArtifactObservation;
  parentArtifactInventory: readonly GitHubActionsArtifactObservation[];
  parentJobs: readonly GitHubWorkflowJobObservation[];
  currentRun: Readonly<Record<string, any>>;
  currentWorkflow: Readonly<Record<string, any>>;
  currentCheckSuite: Readonly<Record<string, any>>;
  eventSender: unknown;
  parentRun: Readonly<Record<string, any>>;
  parentPrincipal: Readonly<{ login: string; nodeId: string;
    permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none' }>;
}): Readonly<{
  parentPlan: CiVerificationActionParentDispatchPlan;
  parentActorNodeId: string;
}> {
  const { repository, repositoryId, request } = input;
  const envelope = parseCiVerificationActionProviderEnvelope(input.envelope);
  let planValue: unknown;
  try {
    planValue = JSON.parse(input.parentPlanSource) as unknown;
  } catch (error) {
    throw new Error('Internal Action parent dispatch plan artifact is not JSON.', { cause: error });
  }
  const parentPlan = parseCiVerificationActionParentDispatchPlan(planValue);
  const canonicalPlanSource = `${encodeVerificationActionData(parentPlan)}\n`;
  if (input.parentPlanSource !== canonicalPlanSource
    || ciVerificationActionParentDispatchPlanPayloadDigest(parentPlan)
      !== envelope.parentDispatchPlanPayloadDigest
    || `sha256:${createHash('sha256').update(Buffer.from(input.parentPlanSource, 'utf8')).digest('hex')}`
      !== envelope.parentDispatchPlanPayloadDigest) {
    throw new Error('Internal Action parent dispatch plan artifact bytes/digest are not canonical.');
  }
  assertCiVerificationActionProviderEnvelopeMember(envelope, parentPlan);
  if (parentPlan.repository !== repository || parentPlan.repositoryId !== repositoryId
    || parentPlan.parentWorkflowSha !== request.expectedBaseSha
    || envelope.parentWorkflowSha !== request.expectedBaseSha) {
    throw new Error('Internal Action parent plan repository/base identity differs from the Session request.');
  }
  for (const proposal of parentPlan.proposals) {
    const proposalRequest = parseVerificationSessionHostedRequest(
      encodeVerificationActionData(proposal.sessionRequest)
    );
    if (encodeVerificationActionData(proposalRequest) !== encodeVerificationActionData(request)) {
      throw new Error('Internal Action parent plan contains a proposal for another Session request.');
    }
  }

  const parentJobIds = new Set<string>();
  for (const job of input.parentJobs) {
    if (parentJobIds.has(job.id)) {
      throw new Error('Internal Action parent job inventory contains a duplicate job id.');
    }
    parentJobIds.add(job.id);
  }
  const parentJobs = input.parentJobs.filter((job) => job.id === parentPlan.parentJobId);
  if (parentJobs.length !== 1) {
    throw new Error('Internal Action parent plan-producing job is not unique in the provider inventory.');
  }
  const parentJob = parentJobs[0]!;
  const planSteps = parentJob.steps.filter((step) => step.name === parentPlan.parentPlanStepName);
  if (parentJob.runId !== parentPlan.parentRunId
    || parentJob.runAttempt !== parentPlan.parentRunAttempt
    || parentJob.name !== parentPlan.parentJobName
    || parentJob.headSha !== parentPlan.parentWorkflowSha
    || planSteps.length !== 1
    || planSteps[0]!.status !== 'completed'
    || planSteps[0]!.conclusion !== 'success') {
    throw new Error('Internal Action parent job/plan-producing step provenance mismatch.');
  }

  const bot = CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot;
  assertGitHubIdentityRecord(input.eventSender, bot, 'Internal Action event sender');
  assertGitHubIdentityRecord(input.currentRun.actor, bot, 'Internal Action current run actor');
  const currentRunId = String(input.currentRun.id ?? '');
  const currentRunAttempt = Number(input.currentRun.run_attempt);
  const checkSuiteId = Number(input.currentRun.check_suite_id);
  const workflowId = Number(input.currentRun.workflow_id);
  if (!/^[1-9][0-9]*$/u.test(currentRunId)
    || currentRunAttempt !== 1
    || !Number.isSafeInteger(checkSuiteId) || checkSuiteId < 1
    || !Number.isSafeInteger(workflowId) || workflowId < 1
    || !matchesCiCompilerWorkflowRunIdentity({
      workflowPath: input.currentRun.path,
      eventName: input.currentRun.event,
      displayTitle: input.currentRun.display_title,
      headSha: input.currentRun.head_sha,
      expectedDisplayTitle: `produce Action ${envelope.proposal.proposedActionKey}`,
      expectedHeadSha: request.expectedBaseSha
    })
    || input.currentRun.head_branch !== 'main'
    || String(input.currentRun.repository?.id ?? '') !== repositoryId
    || input.currentRun.repository?.full_name !== repository) {
    throw new Error('Internal Action current workflow run provenance mismatch.');
  }
  if (String(input.currentWorkflow.id ?? '') !== String(workflowId)
    || input.currentWorkflow.path !== '.github/workflows/compiler-pr-validation.yml'
    || input.currentWorkflow.state !== 'active') {
    throw new Error('Internal Action current workflow id/path readback mismatch.');
  }
  const suite = input.currentCheckSuite;
  const app = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  if (String(suite.id ?? '') !== String(checkSuiteId)
    || suite.head_sha !== request.expectedBaseSha
    || String(suite.repository?.id ?? '') !== repositoryId
    || suite.repository?.full_name !== repository
    || suite.app?.id !== app.id || suite.app?.node_id !== app.nodeId || suite.app?.slug !== app.slug) {
    throw new Error('Internal Action check-suite App/repository/head provenance mismatch.');
  }

  const artifact = input.parentArtifact;
  const exactArtifacts = input.parentArtifactInventory.filter((entry) => (
    entry.artifactName === envelope.parentDispatchPlanArtifactName
  ));
  if (exactArtifacts.length !== 1 || exactArtifacts[0]!.artifactId !== artifact.artifactId
    || artifact.artifactId !== envelope.parentDispatchPlanArtifactId
    || artifact.artifactName !== envelope.parentDispatchPlanArtifactName
    || artifact.archiveDigest === null
    || artifact.archiveDigest !== envelope.parentDispatchPlanArchiveDigest
    || artifact.runId !== envelope.parentRunId || artifact.runAttempt !== envelope.parentRunAttempt
    || artifact.workflowPath !== envelope.parentWorkflowPath
    || artifact.workflowRef !== `${envelope.parentWorkflowPath}@${envelope.parentWorkflowSha}`
    || artifact.workflowSha !== envelope.parentWorkflowSha || artifact.eventName !== 'repository_dispatch'
    || artifact.actorNodeId !== parentPlan.parentActor.nodeId
    || artifact.actorPermission !== parentPlan.parentActor.permission || artifact.expired) {
    throw new Error('Internal Action parent dispatch plan artifact provenance mismatch.');
  }
  const parentRun = input.parentRun;
  assertGitHubIdentityRecord(parentRun.actor, {
    login: parentPlan.parentActor.login,
    id: parentPlan.parentActor.id,
    nodeId: parentPlan.parentActor.nodeId,
    type: parentPlan.parentActor.type
  }, 'Internal Action parent run actor');
  const parentRequestTitle = `verify session PR #${request.prNumber} session ${request.expectedSessionRevision}`;
  if (String(parentRun.id ?? '') !== parentPlan.parentRunId
    || parentRun.run_attempt !== parentPlan.parentRunAttempt
    || !matchesCiCompilerWorkflowRunIdentity({
      workflowPath: parentRun.path,
      eventName: parentRun.event,
      displayTitle: parentRun.display_title,
      headSha: parentRun.head_sha,
      expectedDisplayTitle: parentRequestTitle,
      expectedHeadSha: parentPlan.parentWorkflowSha
    })
    || parentRun.path !== parentPlan.parentWorkflowPath
    || parentRun.head_branch !== 'main'
    || String(parentRun.repository?.id ?? '') !== repositoryId
    || parentRun.repository?.full_name !== repository) {
    throw new Error('Internal Action parent external Session run provenance mismatch.');
  }
  if (input.parentPrincipal.login !== parentPlan.parentActor.login
    || input.parentPrincipal.nodeId !== parentPlan.parentActor.nodeId
    || input.parentPrincipal.permission !== parentPlan.parentActor.permission) {
    throw new Error('Internal Action parent actor live membership differs from its dispatch plan.');
  }
  return Object.freeze({ parentPlan, parentActorNodeId: parentPlan.parentActor.nodeId });
}
