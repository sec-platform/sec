import { sha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJson } from '../../../../../contracts/exact-json.ts';
import { parseHostedResumeDispatchSignal, type HostedResumeSignal } from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';
import type { ScopeAuthorization } from '../../../../self-hosting/control/scope/authorization.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT, parseCiVerificationActionProviderEnvelope, type CiVerificationActionParentActor, type CiVerificationActionPlanClosure } from '../../action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../action/contract/provider.ts';
import type { VerificationSession } from '../../session/contract/session.ts';
import { CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA } from './revision.ts';
import { parseVerificationSessionHostedRequest } from './session-request.ts';

export const RESUMED_SESSION_PRODUCER_SCHEMA = 'sec-verification-session-resumed-producer-v1' as const;

/** Historical data only. The App execution and the human authority that caused
 * it remain separate; neither this parser nor its digest issues live authority. */
export type ResumedSessionProducer = Readonly<{
  schema: typeof RESUMED_SESSION_PRODUCER_SCHEMA;
  sourceTransport: 'github-actions';
  workflowPath: '.github/workflows/compiler-pr-validation.yml';
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  actorNodeId: typeof CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId;
  originalParentActor: CiVerificationActionParentActor;
  resumeSignal: HostedResumeSignal;
  sourceDigest: string;
}>;

function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`Resumed Session ${label} fields differ.`);
  }
  return value as Record<string, unknown>;
}

export function parseResumedSessionProducer(value: unknown): ResumedSessionProducer {
  // Detach ordinary data before inspecting fields; no caller accessors/hooks.
  const record = exact(parseExactJson(encodeVerificationActionData(value), 'resumed Session producer'),
    ['schema', 'sourceTransport', 'workflowPath', 'workflowRef', 'workflowSha', 'runId',
      'runAttempt', 'actorNodeId', 'originalParentActor', 'resumeSignal', 'sourceDigest'], 'producer');
  const actor = exact(record.originalParentActor,
    ['login', 'id', 'nodeId', 'type', 'permission'], 'original parent actor');
  const signal = parseHostedResumeDispatchSignal(encodeVerificationActionData(record.resumeSignal));
  const envelope = parseCiVerificationActionProviderEnvelope(signal.completedAction.providerEnvelope);
  const request = parseVerificationSessionHostedRequest(encodeVerificationActionData(envelope.proposal.sessionRequest));
  if (request.schema !== CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA
      || request.placement !== 'github-hosted-per-job-v1'
      || request.expectedBaseSha !== record.workflowSha
      || record.schema !== RESUMED_SESSION_PRODUCER_SCHEMA || record.sourceTransport !== 'github-actions'
      || record.workflowPath !== '.github/workflows/compiler-pr-validation.yml'
      || typeof record.workflowSha !== 'string' || !/^[0-9a-f]{40}$/u.test(record.workflowSha)
      || record.workflowRef !== `${record.workflowPath}@${record.workflowSha}`
      || record.workflowSha !== envelope.parentWorkflowSha || record.workflowSha !== signal.emitter.workflowSha
      || typeof record.runId !== 'string' || !/^[1-9][0-9]*$/u.test(record.runId)
      || !Number.isSafeInteger(record.runAttempt) || Number(record.runAttempt) < 1
      || record.actorNodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId
      || actor.type !== 'User' || typeof actor.login !== 'string' || actor.login.length === 0
      || typeof actor.nodeId !== 'string' || actor.nodeId.length === 0
      || actor.nodeId === record.actorNodeId || !Number.isSafeInteger(actor.id) || Number(actor.id) < 1
      || actor.permission !== 'maintain' && actor.permission !== 'admin') {
    throw new Error('Resumed Session producer or original human identity differs.');
  }
  const { sourceDigest, ...fields } = record;
  if (sourceDigest !== sha256(fields)) throw new Error('Resumed Session producer digest differs.');
  return Object.freeze({ ...record, originalParentActor: Object.freeze({ ...actor }),
    resumeSignal: signal }) as ResumedSessionProducer;
}

export function createResumedSessionProducer(input: Omit<ResumedSessionProducer,
  'schema' | 'sourceTransport' | 'workflowPath' | 'actorNodeId' | 'sourceDigest'>): ResumedSessionProducer {
  const data = exact(parseExactJson(encodeVerificationActionData(input), 'resumed Session producer input'),
    ['workflowRef', 'workflowSha', 'runId', 'runAttempt', 'originalParentActor', 'resumeSignal'], 'producer input');
  const fields = { ...data, schema: RESUMED_SESSION_PRODUCER_SCHEMA,
    sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
    actorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId };
  return parseResumedSessionProducer({ ...fields, sourceDigest: sha256(fields) });
}

export function isResumedSessionProducer(value: unknown): value is ResumedSessionProducer {
  return value !== null && typeof value === 'object' && 'schema' in value
    && value.schema === RESUMED_SESSION_PRODUCER_SCHEMA;
}

export function assertResumedSessionProducerBinding(input: Readonly<{
  producer: ResumedSessionProducer;
  session: VerificationSession;
  scope: ScopeAuthorization;
  actionPlan: CiVerificationActionPlanClosure;
}>): void {
  const producer = parseResumedSessionProducer(input.producer);
  const envelope = parseCiVerificationActionProviderEnvelope(producer.resumeSignal.completedAction.providerEnvelope);
  const request = parseVerificationSessionHostedRequest(encodeVerificationActionData(envelope.proposal.sessionRequest));
  const session = input.session;
  const pairs: readonly (readonly [unknown, unknown])[] = [
    [producer.resumeSignal.emitter.repository, session.repository],
    [producer.originalParentActor.nodeId, input.scope.issuer.principalId],
    [request.schema, CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA],
    ['placement' in request ? request.placement : null, 'github-hosted-per-job-v1'],
    [request.prNumber, session.prNumber], [request.expectedBaseSha, session.baseSha],
    [request.expectedBaseTreeSha, session.baseTreeSha], [request.expectedHeadSha, session.headSha],
    [request.expectedHeadTreeSha, session.headTreeSha], [request.manifestPath, session.manifestPath],
    [request.manifestDigest, session.manifestDigest], [request.profile, session.profile],
    [request.reviewPolicyDigest, session.reviewPolicyDigest],
    [request.expectedSessionRevision, session.sessionRevision],
    [request.expectedScopeProposalDigest, input.scope.proposalDigest],
    [request.expectedActionPlanDigest, input.actionPlan.actionPlanDigest],
    [session.actionPlanClosureDigest, input.actionPlan.actionPlanDigest],
    [producer.workflowSha, session.baseSha]
  ];
  if (pairs.some(([actual, expected]) => actual !== expected)
      || !input.actionPlan.actions.some(({ action }) => action.actionKey === envelope.proposal.proposedActionKey)
      || input.actionPlan.actions.some(({ action }) => action.environment.providerRevision
        !== CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision)) {
    throw new Error('Resumed Session producer differs from its original request, human or completed Action.');
  }
}

export function resumedSessionProducerRequest(producer: ResumedSessionProducer) {
  const current = parseResumedSessionProducer(producer);
  const envelope = parseCiVerificationActionProviderEnvelope(current.resumeSignal.completedAction.providerEnvelope);
  return parseVerificationSessionHostedRequest(encodeVerificationActionData(envelope.proposal.sessionRequest));
}
