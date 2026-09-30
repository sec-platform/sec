/** VerificationSession physical owner recovered from current-main semantics. */
import type { GitHubWorkflowRunObservation } from '../../../../providers/github-api/contract.ts';
import { decodeBranchLifecycleChildError } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { createCiMainHealthRequestOperationId } from '../../../../self-hosting/control/main-health/provider-policy.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { matchesCiCompilerWorkflowRunIdentity } from '../../action/contract/provider.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { apiRecord } from './session-github-provider.ts';
import { positiveEnvironmentInteger } from './session-hosted-identity.ts';
import { runVerificationSessionCommand } from './session-local-repository.ts';
import type { VerificationSessionGitHubClient } from './verification-session-github.ts';
import { setTimeout as delay } from 'node:timers/promises';

export async function joinExactPostMergeMainHealth(input: Readonly<{
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  mainSha: string;
  environment: Readonly<Record<string, string | undefined>>;
}>): Promise<Readonly<{ requestOperationId: `sha256:${string}`; runId: string }>> {
  if (!/^[0-9a-f]{40}$/u.test(input.mainSha)) {
    throw new Error('Post-merge MainHealth main SHA is invalid.');
  }
  const requestOperationId = createCiMainHealthRequestOperationId(input.mainSha);
  const expectedTitle = `SEC main health ${input.mainSha} operation ${requestOperationId}`;
  const workflow = apiRecord(input.ctx,
    `/repos/${input.repository}/actions/workflows/compiler-pr-validation.yml`,
    'canonical MainHealth workflow readback');
  const workflowId = Number(workflow.id);
  if (!Number.isSafeInteger(workflowId) || workflowId < 1
    || workflow.path !== '.github/workflows/compiler-pr-validation.yml' || workflow.state !== 'active') {
    throw new Error('Canonical MainHealth workflow is not active.');
  }
  const matchingRuns = () => input.github.observeWorkflowRuns(input.repository, input.mainSha)
    .filter((run) => matchesCiCompilerWorkflowRunIdentity({
      workflowPath: run.workflowPath,
      eventName: run.event,
      displayTitle: run.displayTitle,
      headSha: run.headSha,
      expectedDisplayTitle: expectedTitle,
      expectedHeadSha: input.mainSha
    }));
  let matches = matchingRuns();
  if (matches.length > 1) throw new Error('MainHealth operation already has multiple exact workflow runs.');
  if (matches.length === 0) {
    const body = encodeVerificationActionData({ event_type: 'sec-produce-main-health-v1',
      client_payload: { payload: { mainSha: input.mainSha, requestOperationId } } });
    const dispatched = runVerificationSessionCommand(input.ctx, 'gh', [
      'api', '--method', 'POST', `/repos/${input.repository}/dispatches`, '--input', '-'
    ], input.ctx.repositoryRoot, body);
    if (dispatched.status !== 0) {
      throw new Error(`Canonical MainHealth dispatch failed: ${decodeBranchLifecycleChildError(dispatched)}`);
    }
  }
  const queueAllowance = positiveEnvironmentInteger('MAIN_HEALTH_RUNNER_QUEUE_ALLOWANCE_MINUTES', input.environment);
  const producerTimeout = positiveEnvironmentInteger('MAIN_HEALTH_PRODUCER_TIMEOUT_MINUTES', input.environment);
  const pollSeconds = positiveEnvironmentInteger('MAIN_HEALTH_JOIN_POLL_INTERVAL_SECONDS', input.environment);
  const queueAllowanceMilliseconds = queueAllowance * 60 * 1000;
  const producerTimeoutMilliseconds = producerTimeout * 60 * 1000;
  const pollMilliseconds = pollSeconds * 1000;
  const deadline = Date.now() + (2 * producerTimeoutMilliseconds)
    + queueAllowanceMilliseconds + pollMilliseconds;
  let joined: GitHubWorkflowRunObservation | null = null;
  while (Date.now() < deadline) {
    matches = matchingRuns();
    if (matches.length > 1) throw new Error('MainHealth dispatch resolved to multiple exact workflow runs.');
    if (matches.length === 1 && matches[0]!.status === 'completed') {
      if (matches[0]!.conclusion !== 'success') {
        throw new Error(`Exact MainHealth run concluded ${matches[0]!.conclusion ?? 'without conclusion'}.`);
      }
      joined = matches[0]!;
      break;
    }
    await delay(pollMilliseconds);
  }
  if (joined === null) throw new Error('Timed out joining the exact post-merge MainHealth run.');
  const run = apiRecord(input.ctx, `/repos/${input.repository}/actions/runs/${joined.id}`,
    'joined MainHealth workflow readback');
  if (String(run.id) !== joined.id || Number(run.workflow_id) !== workflowId
    || !matchesCiCompilerWorkflowRunIdentity({
      workflowPath: run.path,
      eventName: run.event,
      displayTitle: run.display_title,
      headSha: run.head_sha,
      expectedDisplayTitle: expectedTitle,
      expectedHeadSha: input.mainSha
    })
    || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error('Joined MainHealth workflow API readback is not canonical.');
  }
  const checks = input.github.observeChecks(input.repository, input.mainSha).filter((check) => (
    check.name === 'sec/main-health' && check.status === 'completed' && check.conclusion === 'success'
      && check.headSha === input.mainSha && check.workflowRunId === joined!.id
      && check.workflowRunDisplayTitle === expectedTitle && check.appSlug === 'github-actions'
  ));
  if (checks.length !== 1) throw new Error('Exact MainHealth run has no unique successful canonical sec/main-health check.');
  return Object.freeze({ requestOperationId, runId: joined.id });
}
