import { canonicalEquals, sha256 } from '../../../../../contracts/canonical.ts';
import {
  HOSTED_RESUME_SIGNAL_SCHEMA,
  parseHostedResumeDispatchSignal,
  type HostedResumeEmitter,
  type HostedResumeSignal
} from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';
import { encodeVerificationActionData, parseVerificationActionPlan, type VerificationActionPlan } from '../../action/contract/action.ts';
import {
  assertCiVerificationActionProviderEnvelopeMember,
  CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT,
  parseCiVerificationActionParentDispatchPlan,
  parseCiVerificationActionProviderEnvelope,
  type CiVerificationActionParentDispatchPlan
} from '../../action/contract/ci.ts';
import { verificationActionProviderTerminalArtifactName, type VerificationActionProviderTerminalObservation } from '../../action/contract/provider.ts';
import { CodexDevelopmentParseVerificationActionTerminalArtifact, type CodexDevelopmentVerificationActionTerminalArtifact } from '../contract/evidence.ts';
import { CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA } from '../contract/revision.ts';
import { parseVerificationSessionHostedRequest } from '../contract/session-request.ts';

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`Session resume ${label} fields differ.`);
  }
  return value as Record<string, unknown>;
}

function parseCompletedAction(input: HostedResumeSignal['completedAction']) {
  const source = encodeVerificationActionData(input);
  if (Buffer.byteLength(source, 'utf8') > 32 * 1024) throw new Error('Session resume completed Action exceeds the provider wire limit.');
  const completed = exactObject(JSON.parse(source) as unknown,
    ['providerEnvelope', 'runId', 'runAttempt', 'terminalArtifactId', 'terminalArtifactName',
      'terminalArchiveDigest', 'terminalPayloadDigest'], 'completed Action');
  const id = (value: unknown) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value);
  const digest = (value: unknown) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
  if (!id(completed.runId) || !id(completed.terminalArtifactId)
      || !Number.isSafeInteger(completed.runAttempt) || Number(completed.runAttempt) < 1 || Number(completed.runAttempt) > 1000
      || !digest(completed.terminalArchiveDigest) || !digest(completed.terminalPayloadDigest)) {
    throw new Error('Session resume completed Action identity is invalid.');
  }
  const envelope = parseCiVerificationActionProviderEnvelope(completed.providerEnvelope);
  const request = parseVerificationSessionHostedRequest(encodeVerificationActionData(envelope.proposal.sessionRequest));
  if (request.schema !== CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA
      || request.placement !== 'github-hosted-per-job-v1') {
    throw new Error('Session resume requires the exact per-job hosted request.');
  }
  if (envelope.parentWorkflowSha !== request.expectedBaseSha
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/compiler-pr-validation\.yml@refs\/heads\/main$/u.test(envelope.parentWorkflowRef)) {
    throw new Error('Session resume workflow source differs from the original request.');
  }
  if (completed.terminalArtifactName !== verificationActionProviderTerminalArtifactName(envelope.proposal.proposedActionKey)) {
    throw new Error('Session resume terminal name differs from its Action.');
  }
  return { completed, envelope, request };
}

/** The provider's existing cause preimage, without inventing an emitter for a
 * read-only recovery census. The returned identity is data, never authority. */
export function ciVerificationSessionWakeKey(completedAction: HostedResumeSignal['completedAction']): HostedResumeSignal['wakeKey'] {
  const { completed } = parseCompletedAction(completedAction);
  return sha256({ schema: 'sec-verification-session-wake-key-v1', completedAction: completed });
}

/** Decode the provider's one wire, then close its CI-owned request and locator
 * semantics. This data is neither a live origin nor a permission grant. */
export function parseCiVerificationSessionResumeSignal(source: string): HostedResumeSignal {
  const signal = parseHostedResumeDispatchSignal(source);
  const { envelope, request } = parseCompletedAction(signal.completedAction);
  if (signal.emitter.workflowSha !== request.expectedBaseSha
      || envelope.parentWorkflowRef !== `${signal.emitter.repository}/${envelope.parentWorkflowPath}@refs/heads/main`) {
    throw new Error('Session resume workflow source differs from the original request.');
  }
  return signal;
}

/** Produce ordinary bounded transport data only. Dispatch remains with its
 * authenticated provider owner; constructing a digest cannot authorize it. */
export function createCiVerificationSessionResumeSignal(input: Readonly<{
  completedAction: HostedResumeSignal['completedAction'];
  emitter: HostedResumeEmitter;
}>): HostedResumeSignal {
  // Reject accessors, hooks and non-data before reading caller-owned fields.
  const data = exactObject(JSON.parse(encodeVerificationActionData(input)) as unknown,
    ['completedAction', 'emitter'], 'constructor');
  const content = {
    schema: HOSTED_RESUME_SIGNAL_SCHEMA,
    wakeKey: ciVerificationSessionWakeKey(data.completedAction as HostedResumeSignal['completedAction']),
    completedAction: data.completedAction,
    emitter: data.emitter
  };
  return parseCiVerificationSessionResumeSignal(encodeVerificationActionData({ ...content, signalDigest: sha256(content) }));
}

/** Locator only. The emitter is deliberately absent from this stable title. */
export function ciVerificationSessionResumeDisplayTitle(signal: HostedResumeSignal): string {
  return `resume Session ${parseCiVerificationSessionResumeSignal(encodeVerificationActionData(signal)).wakeKey}`;
}

/** Compare independently read data to the closed cause and original human plan.
 * Callers must separately authenticate API/artifact origins and current human
 * permission. No successful comparison issues authority or performs an effect. */
export function assertCiVerificationSessionResumeBinding(input: Readonly<{
  signal: HostedResumeSignal;
  parentPlan: CiVerificationActionParentDispatchPlan;
  actionPlan: VerificationActionPlan;
  terminalArtifact: CodexDevelopmentVerificationActionTerminalArtifact;
  terminalObservation: VerificationActionProviderTerminalObservation;
}>): void {
  // Detach all inputs as ordinary data; neither validators nor comparison may
  // execute caller hooks or observe different values from a mutable accessor.
  const data = JSON.parse(encodeVerificationActionData(input)) as typeof input;
  exactObject(data, ['signal', 'parentPlan', 'actionPlan', 'terminalArtifact', 'terminalObservation'], 'binding');
  const signal = parseCiVerificationSessionResumeSignal(encodeVerificationActionData(data.signal));
  const completed = signal.completedAction;
  const envelope = parseCiVerificationActionProviderEnvelope(completed.providerEnvelope);
  const parentPlan = parseCiVerificationActionParentDispatchPlan(data.parentPlan);
  assertCiVerificationActionProviderEnvelopeMember(envelope, parentPlan);
  if (parentPlan.repository !== signal.emitter.repository || parentPlan.repositoryId !== signal.emitter.repositoryId) {
    throw new Error('Session resume emitter repository differs from the original parent plan.');
  }
  const request = parseVerificationSessionHostedRequest(encodeVerificationActionData(envelope.proposal.sessionRequest));
  const actionPlan = parseVerificationActionPlan(encodeVerificationActionData(data.actionPlan));
  if (actionPlan.action.actionKey !== envelope.proposal.proposedActionKey
      || actionPlan.action.environment.providerRevision !== CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision
      || actionPlan.action.environment.toolchainRevision !== CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT.toolchainRevision) {
    throw new Error('Session resume Action differs from the closed per-job Action.');
  }
  const observation = exactObject(data.terminalObservation,
    ['originId', 'artifactName', 'archiveDigest', 'expired', 'payload', 'referencedOrigin'], 'terminal observation');
  const fact = exactObject(observation.payload, ['actionKey', 'candidateSha', 'payloadDigest', 'producer'], 'terminal fact');
  if (observation.expired !== false || observation.originId !== completed.terminalArtifactId
      || observation.artifactName !== completed.terminalArtifactName
      || observation.archiveDigest !== completed.terminalArchiveDigest
      || fact.actionKey !== actionPlan.action.actionKey || fact.candidateSha !== request.expectedHeadSha
      || fact.payloadDigest !== completed.terminalPayloadDigest) {
    throw new Error('Session resume terminal observation differs from its closed cause.');
  }
  const observedProducer = exactObject(fact.producer, ['repositoryId', 'repository', 'workflowPath',
    'workflowRef', 'workflowSha', 'runId', 'runAttempt', 'appId', 'appNodeId', 'sourceEvent'], 'terminal producer');
  if (observedProducer.repository !== parentPlan.repository || String(observedProducer.repositoryId) !== parentPlan.repositoryId
      || observedProducer.runId !== completed.runId || observedProducer.runAttempt !== completed.runAttempt
      || observedProducer.workflowPath !== envelope.parentWorkflowPath || observedProducer.sourceEvent !== 'repository_dispatch'
      || observedProducer.workflowSha !== request.expectedBaseSha
      || observedProducer.workflowRef !== `${envelope.parentWorkflowPath}@${request.expectedBaseSha}`
      || !canonicalEquals(observation.referencedOrigin, observedProducer)) {
    throw new Error('Session resume terminal producer differs from its run, attempt or source.');
  }
  const artifact = CodexDevelopmentParseVerificationActionTerminalArtifact(encodeVerificationActionData(data.terminalArtifact));
  if (!canonicalEquals(artifact.actionPlan, actionPlan)
      || !canonicalEquals(artifact.executionEnvironment, CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT)
      || artifact.artifactDigest !== completed.terminalPayloadDigest
      || !canonicalEquals(fact.producer, artifact.producer)
      || !canonicalEquals(observation.referencedOrigin, artifact.producer)) {
    throw new Error('Session resume terminal payload differs from its closed Action.');
  }
  if (artifact.input.baseSha !== request.expectedBaseSha || artifact.input.baseTreeSha !== request.expectedBaseTreeSha
      || artifact.input.headSha !== request.expectedHeadSha || artifact.input.headTreeSha !== request.expectedHeadTreeSha
      || artifact.input.manifestPath !== request.manifestPath || artifact.input.manifestDigest !== request.manifestDigest) {
    throw new Error('Session resume terminal candidate differs from the original request.');
  }
}
