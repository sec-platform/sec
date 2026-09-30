/** VerificationSession physical owner recovered from current-main semantics. */
import { createHostedWorkflowCommentProvenance, type HostedWorkflowCommentProvenance } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { assertHostedIntegrationPhaseOwnership, type HostedIntegrationPhase, type HostedIntegrationPhaseOwnership, selectCanonicalIntegrationRunOwner } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import { ciVerificationActionParentDispatchPlanFile, parseCiVerificationActionParentDispatchPlan } from '../../action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, matchesCiCompilerWorkflowRunIdentity } from '../../action/contract/provider.ts';
import type { VerificationSession } from '../../session/contract/session.ts';
import { assertHostedCompilerDispatchPayload, assertHostedCompilerInternalProvenance } from '../contract/hosted-dispatch.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { readJson } from './session-artifact-files.ts';
import { apiRecord } from './session-github-provider.ts';
import { hostedMergeWakeupLocator } from './session-hosted-artifacts.ts';
import { inspectTrustedRuntime } from './trusted-runtime-observation.ts';
import type { GitHubCandidateObservation, VerificationSessionGitHubClient } from './verification-session-github.ts';
import { assertTrustedExactRevisionRuntime, assertTrustedMergedRuntimeReachability, parseVerificationSessionHostedRequest } from './verification-session-runtime.ts';

export function githubEvent(environment: Readonly<Record<string, string | undefined>>): Record<string, any> {
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required for trusted hosted identity.');
  const value = readJson<unknown>(eventPath);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub event must be one object.');
  return value as Record<string, any>;
}

export function hostedActorHandle(event: Record<string, any>): string {
  const login = event.sender?.login;
  if (typeof login !== 'string' || login.length === 0) throw new Error('Trusted GitHub event actor login is unavailable.');
  return login;
}

type PositiveEnvironmentIntegerKey =
  | 'GITHUB_RUN_ATTEMPT'
  | 'MAIN_HEALTH_RUNNER_QUEUE_ALLOWANCE_MINUTES'
  | 'MAIN_HEALTH_PRODUCER_TIMEOUT_MINUTES'
  | 'MAIN_HEALTH_JOIN_POLL_INTERVAL_SECONDS';

export function positiveEnvironmentInteger(
  name: PositiveEnvironmentIntegerKey,
  environment: Readonly<Record<string, string | undefined>>
): number {
  const raw = (() => {
    switch (name) {
      case 'GITHUB_RUN_ATTEMPT':
        return environment.GITHUB_RUN_ATTEMPT;
      case 'MAIN_HEALTH_RUNNER_QUEUE_ALLOWANCE_MINUTES':
        return environment.MAIN_HEALTH_RUNNER_QUEUE_ALLOWANCE_MINUTES;
      case 'MAIN_HEALTH_PRODUCER_TIMEOUT_MINUTES':
        return environment.MAIN_HEALTH_PRODUCER_TIMEOUT_MINUTES;
      case 'MAIN_HEALTH_JOIN_POLL_INTERVAL_SECONDS':
        return environment.MAIN_HEALTH_JOIN_POLL_INTERVAL_SECONDS;
    }
  })();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function requiredEnvironmentGitSha(
  environment: Readonly<Record<string, string | undefined>>,
  name: 'PRE_MERGE_MAIN_SHA' | 'PLANNED_CURRENT_MAIN_SHA'
): string {
  const value = name === 'PRE_MERGE_MAIN_SHA'
    ? environment.PRE_MERGE_MAIN_SHA ?? ''
    : environment.PLANNED_CURRENT_MAIN_SHA ?? '';
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${name} must be one lowercase Git SHA.`);
  return value;
}

export function assertBoundPostMergeMain(input: Readonly<{
  ctx: VerificationSessionScope;
  repository: string;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  lane: 'open-first-effect' | 'merged-recovery';
  liveMainSha: string;
  environment: Readonly<Record<string, string | undefined>>;
}>): string {
  const preMergeMainSha = requiredEnvironmentGitSha(input.environment, 'PRE_MERGE_MAIN_SHA');
  const plannedCurrentMainSha = requiredEnvironmentGitSha(input.environment, 'PLANNED_CURRENT_MAIN_SHA');
  if (preMergeMainSha !== input.session.baseSha || input.candidate.mergeCommitSha === null
    || input.candidate.mergeCommitTreeSha === null) {
    throw new Error('Post-merge main binding lacks exact Session base or merge identity.');
  }
  const mergeCommitSha = input.candidate.mergeCommitSha;
  if (input.lane === 'open-first-effect') {
    if (plannedCurrentMainSha !== preMergeMainSha || input.liveMainSha !== mergeCommitSha
      || input.liveMainSha === preMergeMainSha) {
      throw new Error('First-effect integration did not advance main exactly once from the planned base.');
    }
    const commit = apiRecord(input.ctx, `/repos/${input.repository}/git/commits/${mergeCommitSha}`,
      'first-effect merge commit ancestry readback');
    const parents = Array.isArray(commit.parents) ? commit.parents : [];
    if (commit.sha !== mergeCommitSha || commit.tree?.sha !== input.candidate.mergeCommitTreeSha
      || parents.length !== 1 || parents[0]?.sha !== preMergeMainSha) {
      throw new Error('First-effect merge commit ancestry or tree readback drifted.');
    }
  } else {
    if (input.liveMainSha !== plannedCurrentMainSha) {
      throw new Error('Main advanced after the merged-recovery lane was planned.');
    }
    const relation = apiRecord(input.ctx,
      `/repos/${input.repository}/compare/${mergeCommitSha}...${input.liveMainSha}`,
      'merged-recovery main ancestry readback');
    if ((relation.status !== 'identical' && relation.status !== 'ahead')
      || relation.base_commit?.sha !== mergeCommitSha
      || relation.merge_base_commit?.sha !== mergeCommitSha
      || relation.behind_by !== 0) {
      throw new Error('Recovered PR merge commit is not an ancestor of the planned live main.');
    }
  }
  return input.liveMainSha;
}

export function assertHostedIntegrationIdentity(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  event: Record<string, any>;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  phase: HostedIntegrationPhase;
  environment: Readonly<Record<string, string | undefined>>;
  repositoryRoot: string;
}): Readonly<{
  provenance: HostedWorkflowCommentProvenance;
  phase: HostedIntegrationPhaseOwnership;
}> {
  const { ctx, github, repository, event, session, candidate, phase: requestedPhase,
    environment, repositoryRoot } = input;
  const baseSha = session.baseSha;
  const mergedRecovery = candidate.state === 'MERGED';
  if (candidate.state !== 'OPEN' && !mergedRecovery) {
    throw new Error('integrate-hosted requires an OPEN or exact MERGED pull request.');
  }
  if (candidate.repository !== repository || candidate.number !== session.prNumber
    || candidate.headSha !== session.headSha || candidate.headTreeSha !== session.headTreeSha) {
    throw new Error('integrate-hosted candidate identity differs from the authenticated Session.');
  }
  if (mergedRecovery && (candidate.mergeCommitSha === null || candidate.mergeCommitTreeSha === null
    || candidate.mergeCommitTreeSha !== session.headTreeSha)) {
    throw new Error('integrate-hosted MERGED recovery lacks exact verified tree parity.');
  }
  // GitHub reruns retain the original workflow run/head identity. Post-merge
  // recovery therefore executes the exact old-base trusted TCB while remote
  // default is allowed to have advanced only to the marker-bound merge commit.
  const workflowSha = baseSha;
  const runId = environment.GITHUB_RUN_ID ?? '';
  const runAttempt = positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT', environment);
  if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('GITHUB_RUN_ID is required for integrate-hosted.');
  if (environment.GITHUB_REPOSITORY !== repository || environment.GITHUB_SHA !== workflowSha
    || environment.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('integrate-hosted environment is not the exact provider main revision.');
  }
  const workflowRef = environment.GITHUB_WORKFLOW_REF ?? '';
  const expectedWorkflowRef = `${repository}/.github/workflows/merge-gate.yml@refs/heads/main`;
  if (workflowRef !== expectedWorkflowRef || environment.GITHUB_WORKFLOW_SHA !== workflowSha) {
    throw new Error('integrate-hosted is not running from the canonical merge workflow.');
  }
  const repositoryFact = apiRecord(ctx, `/repos/${repository}`, 'integrate-hosted repository readback');
  const repositoryId = String(repositoryFact.id ?? '');
  if (!/^[1-9][0-9]*$/u.test(repositoryId) || repositoryFact.full_name !== repository
    || repositoryFact.default_branch !== 'main'
    || environment.GITHUB_REPOSITORY_ID !== repositoryId
    || String(event.repository?.id ?? '') !== repositoryId
    || event.repository?.full_name !== repository) {
    throw new Error('integrate-hosted repository id/default identity mismatch.');
  }
  const currentRun = apiRecord(ctx, `/repos/${repository}/actions/runs/${runId}`,
    'integrate-hosted current run readback');
  const wakeup = hostedMergeWakeupLocator(event);
  if (String(currentRun.id ?? '') !== runId || currentRun.run_attempt !== runAttempt
    || currentRun.event !== wakeup.eventName
    || currentRun.path !== '.github/workflows/merge-gate.yml'
    || currentRun.head_sha !== workflowSha
    || String(currentRun.repository?.id ?? '') !== repositoryId) {
    throw new Error('integrate-hosted current workflow run provenance mismatch.');
  }
  const sourceRunId = wakeup.sourceRunId;
  const sourceRunAttempt = wakeup.sourceRunAttempt;
  const sourceRun = apiRecord(ctx,
    `/repos/${repository}/actions/runs/${sourceRunId}/attempts/${sourceRunAttempt}`,
    'integrate-hosted source run readback');
  if (!/^[1-9][0-9]*$/u.test(sourceRunId) || !Number.isSafeInteger(sourceRunAttempt)
    || sourceRunAttempt < 1 || String(sourceRun.id ?? '') !== sourceRunId
    || sourceRun.run_attempt !== sourceRunAttempt || sourceRun.status !== 'completed'
    || sourceRun.conclusion !== 'success' || sourceRun.event !== 'repository_dispatch'
    || sourceRun.path !== '.github/workflows/compiler-pr-validation.yml'
    || sourceRun.head_sha !== baseSha) {
    throw new Error('integrate-hosted terminal Session source provenance mismatch.');
  }
  const sourceActorLogin = sourceRun.actor?.login;
  const sourceActorNodeId = sourceRun.actor?.node_id;
  const sourceTriggeringActorLogin = sourceRun.triggering_actor?.login;
  const sourceTriggeringActorNodeId = sourceRun.triggering_actor?.node_id;
  if (typeof sourceActorLogin !== 'string' || typeof sourceActorNodeId !== 'string'
    || typeof sourceTriggeringActorLogin !== 'string' || typeof sourceTriggeringActorNodeId !== 'string') {
    throw new Error('integrate-hosted source actor/triggering principal identity is incomplete.');
  }
  const sourceActor = github.observePrincipal(repository, sourceActorLogin);
  const sourceTriggeringActor = github.observePrincipal(repository, sourceTriggeringActorLogin);
  if (sourceActor.nodeId !== sourceActorNodeId
    || (sourceActor.permission !== 'maintain' && sourceActor.permission !== 'admin')
    || sourceTriggeringActor.nodeId !== sourceTriggeringActorNodeId
    || (sourceTriggeringActor.permission !== 'maintain' && sourceTriggeringActor.permission !== 'admin')) {
    throw new Error('integrate-hosted source actor/triggering principal live identity is not trusted.');
  }
  selectCanonicalIntegrationRunOwner({
    runs: github.observeWorkflowRuns(repository, workflowSha), currentRunId: runId,
    currentRunAttempt: runAttempt, sourceRunId, sourceRunAttempt, baseSha: workflowSha
  });
  const currentJobName = environment.GITHUB_JOB ?? '';
  const attempts = Array.from({ length: runAttempt }, (_, index) => {
    const attempt = index + 1;
    return Object.freeze({ runAttempt: attempt,
      jobs: github.observeWorkflowJobsForAttempt(repository, runId, attempt) });
  });
  const phase = assertHostedIntegrationPhaseOwnership({ attempts, runId,
    currentRunAttempt: runAttempt, currentJobName, workflowSha, phase: requestedPhase });
  const proof = inspectTrustedRuntime({ repositoryRoot, candidateHeadSha: session.headSha });
  if (mergedRecovery) {
    assertTrustedMergedRuntimeReachability({ proof, session, candidate, github });
  } else {
    assertTrustedExactRevisionRuntime(proof, baseSha);
  }
  const provenance = createHostedWorkflowCommentProvenance({ repositoryId,
    workflowPath: '.github/workflows/merge-gate.yml',
    workflowRef: `.github/workflows/merge-gate.yml@${workflowSha}`, workflowSha,
    runId, runAttempt, eventName: 'workflow_run', sourceRunId, sourceRunAttempt,
    actorLogin: sourceTriggeringActorLogin, actorNodeId: sourceTriggeringActorNodeId,
    actorPermission: sourceTriggeringActor.permission,
    app: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app });
  return Object.freeze({ provenance, phase });
}

export function assertHostedCompilerIdentity(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  event: Record<string, any>;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  environment: Readonly<Record<string, string | undefined>>;
  repositoryRoot: string;
}): { actorNodeId: string; runId: string; runAttempt: number } {
  const { ctx, github, repository, event, request, environment, repositoryRoot } = input;
  const runId = environment.GITHUB_RUN_ID ?? '';
  const runAttempt = positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT', environment);
  if (!/^[1-9][0-9]*$/u.test(runId)
    || environment.GITHUB_EVENT_NAME !== 'repository_dispatch'
    || environment.GITHUB_REPOSITORY !== repository
    || environment.GITHUB_SHA !== request.expectedBaseSha
    || environment.GITHUB_REF !== 'refs/heads/main'
    || environment.GITHUB_WORKFLOW_REF
      !== `${repository}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`
    || environment.GITHUB_WORKFLOW_SHA !== request.expectedBaseSha) {
    throw new Error('observe-hosted is not running from the canonical trusted compiler workflow.');
  }
  const dispatch = assertHostedCompilerDispatchPayload({ action: event.action,
    clientPayload: event.client_payload, request });
  const repo = apiRecord(ctx, `/repos/${repository}`, 'observe-hosted repository readback');
  const repositoryId = String(repo.id ?? '');
  if (repo.full_name !== repository || repo.default_branch !== 'main'
    || environment.GITHUB_REPOSITORY_ID !== repositoryId
    || String(event.repository?.id ?? '') !== repositoryId) {
    throw new Error('observe-hosted repository id/default identity mismatch.');
  }
  const run = apiRecord(ctx, `/repos/${repository}/actions/runs/${runId}`,
    'observe-hosted current run readback');
  const expectedRunDisplayTitle = dispatch.kind === 'external-session'
    ? `verify session PR #${request.prNumber} session ${request.expectedSessionRevision}`
    : `produce Action ${dispatch.envelope.proposal.proposedActionKey}`;
  if (String(run.id ?? '') !== runId || run.run_attempt !== runAttempt
    || !matchesCiCompilerWorkflowRunIdentity({
      workflowPath: run.path,
      eventName: run.event,
      displayTitle: run.display_title,
      headSha: run.head_sha,
      expectedDisplayTitle: expectedRunDisplayTitle,
      expectedHeadSha: request.expectedBaseSha
    })
    || String(run.repository?.id ?? '') !== repositoryId
    || typeof run.actor?.login !== 'string' || typeof run.actor?.node_id !== 'string') {
    throw new Error('observe-hosted current workflow provenance mismatch.');
  }
  assertTrustedExactRevisionRuntime(inspectTrustedRuntime({ repositoryRoot }),
    request.expectedBaseSha);
  if (dispatch.kind === 'external-session') {
    const actor = github.observePrincipal(repository, run.actor.login);
    if (actor.nodeId !== run.actor.node_id
      || (actor.permission !== 'admin' && actor.permission !== 'maintain')) {
      throw new Error('observe-hosted actor stable identity/live permission mismatch.');
    }
    return { actorNodeId: actor.nodeId, runId, runAttempt };
  }

  const envelope = dispatch.envelope;
  const parentArtifact = github.observeActionsArtifact(repository,
    envelope.parentDispatchPlanArtifactId);
  if (parentArtifact.artifactName !== envelope.parentDispatchPlanArtifactName
    || parentArtifact.archiveDigest !== envelope.parentDispatchPlanArchiveDigest
    || parentArtifact.runId !== envelope.parentRunId
    || parentArtifact.runAttempt !== envelope.parentRunAttempt || parentArtifact.expired) {
    throw new Error('observe-hosted internal parent artifact metadata differs from its provider envelope.');
  }
  const parentArtifactInventory = github.observeActionsArtifactsForRun(repository,
    envelope.parentRunId);
  const parentJobs = github.observeWorkflowJobsForAttempt(repository,
    envelope.parentRunId, envelope.parentRunAttempt);
  const parentPlanSource = github.downloadArtifactText(repository, parentArtifact,
    ciVerificationActionParentDispatchPlanFile());
  let parentPlanValue: unknown;
  try {
    parentPlanValue = JSON.parse(parentPlanSource) as unknown;
  } catch (error) {
    throw new Error('observe-hosted internal parent artifact is not JSON.', { cause: error });
  }
  const parentPlan = parseCiVerificationActionParentDispatchPlan(parentPlanValue);
  const parentRun = apiRecord(ctx, `/repos/${repository}/actions/runs/${envelope.parentRunId}`,
    'observe-hosted internal parent run readback');
  const checkSuiteId = Number(run.check_suite_id);
  if (!Number.isSafeInteger(checkSuiteId) || checkSuiteId < 1) {
    throw new Error('observe-hosted internal child run lacks one provider check-suite id.');
  }
  const currentCheckSuite = apiRecord(ctx, `/repos/${repository}/check-suites/${checkSuiteId}`,
    'observe-hosted internal child check-suite readback');
  const currentWorkflow = apiRecord(ctx,
    `/repos/${repository}/actions/workflows/compiler-pr-validation.yml`,
    'observe-hosted internal child workflow readback');
  const parentPrincipal = github.observePrincipal(repository, parentPlan.parentActor.login);
  const internal = assertHostedCompilerInternalProvenance({ repository, repositoryId, request,
    envelope, parentPlanSource, parentArtifact, parentArtifactInventory, parentJobs, currentRun: run,
    currentWorkflow, currentCheckSuite, eventSender: event.sender, parentRun, parentPrincipal });
  return { actorNodeId: internal.parentActorNodeId, runId, runAttempt };
}
