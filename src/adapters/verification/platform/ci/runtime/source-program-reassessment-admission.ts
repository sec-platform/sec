import path from 'node:path';
import { readVerificationDataRecord } from '../../../../../assurance/verification/contract/data.ts';
import type { CI_VERIFICATION_CONTRACT_REVISION } from '../../../../../assurance/verification/contract/revision.ts';
import type { VerificationGateResult, VerificationResultStatus } from '../../../../../assurance/verification/result/contract/result.ts';
import { canonicalEquals, deepFreeze, sha256 } from '../../../../../contracts/canonical.ts';
import { createOperationEffectGrantAuthority, type OperationEffectGrant } from '../../../../../execution/operation/effect-grant.ts';
import {
  assertSemanticOperationPlan, compileSemanticOperationIntent, compileSemanticOperationPlan, issueSemanticOperationAttemptContext,
  type SemanticOperationPlan
} from '../../../../../execution/operation/semantic.ts';
import type { HostedResumeSignal, VerificationSessionHostedEnvelope } from '../../../../../execution/verification/hosted.ts';
import type { VerificationEvidence } from '../../../../../execution/verification/session.ts';
import { HOSTED_RESUME_SIGNAL_SCHEMA } from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent, getAuthenticatedGitHubJobOriginSignal,
  type AuthenticatedGitHubJobOrigin
} from '../../../../providers/github-api/hosted-job-origin.ts';
import { observeSecLinuxVerificationNativeRuntimeInput, requireSecLinuxVerificationNativeRuntimeInput } from '../../../../providers/linux-verification/materialization.ts';
import { createMainHealthLedger, resolveOrdinaryMainHealthLane } from '../../../../self-hosting/control/main-health/contract.ts';
import { createObservedMainHealthInput } from '../../../../self-hosting/control/main-health/main-health-observation.ts';
import { assertScopeAuthorizationCurrent } from '../../../../self-hosting/control/scope/authorization.ts';
import {
  CodexDevelopmentAssertWorkPackageOwnership, CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentParseWorkPackageLocator, CodexDevelopmentWorkPackageManifestDigest
} from '../../../../self-hosting/control/task/contract/work-package.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import {
  ciVerificationGateStep, ciVerificationNormalizedOperationArgv, parseCiSourceProgramTransitionBinding,
  SOURCE_PROGRAM_TRANSITION_GATE_ID, sourceProgramTransitionGate, type CiSourceProgramTransitionBinding
} from '../../action/contract/ci.ts';
import { assertReviewStabilityReceiptCurrent } from '../../review/contract/stability.ts';
import {
  TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET, TRUSTED_RUNTIME_NATIVE_BUDGETS,
  TRUSTED_RUNTIME_NATIVE_REQUIREMENT
} from '../../trusted-runtime/trusted-runtime-native-operation.ts';
import type { VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA } from '../contract/session-request.ts';
import { projectHostedTerminalGate } from '../verification-coordination.ts';
import {
  CodexDevelopmentParseHostedActionRequest, CodexDevelopmentReduceHostedActionProviderIndex,
  CodexDevelopmentResolveHostedAction, hostedActionProviderIndexFromSnapshot, parseHostedEnvelope
} from '../verification-hosted-action-contract.ts';
import { observeHostedResumeReassessmentParent, type VerificationActionGitHubProviderAuthority } from './verification-action-github-provider.ts';
import { assertGitHubReviewAuthorityObservation, createVerificationSessionGitHubClient } from './verification-session-github.ts';

const semanticOperation = 'verification.source-program-reassessment';
const authority = createOperationEffectGrantAuthority({ semanticOperation,
  issuerIdentityDigest: sha256({ semanticOperation, requirement: TRUSTED_RUNTIME_NATIVE_REQUIREMENT,
    budgets: TRUSTED_RUNTIME_NATIVE_BUDGETS }) });

type ReassessmentSource = Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  signal: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  authority: VerificationActionGitHubProviderAuthority;
  envelope: VerificationSessionHostedEnvelope<typeof VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA>;
  evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
  sourceProgramTransition: CiSourceProgramTransitionBinding;
  repositoryRoot: string;
  deadlineAtUnixMs: number;
}>;

export type HostedSourceProgramReassessmentAdmission = Readonly<{
  grant: OperationEffectGrant;
  plan: SemanticOperationPlan;
  source: ReassessmentSource;
}>;

function fail(message: string): never {
  throw new Error(`Source Program reassessment admission: ${message}`);
}

function captureSource(input: ReassessmentSource): ReassessmentSource {
  const fields = readVerificationDataRecord(input, 'Reassessment source');
  const origin = fields.origin as AuthenticatedGitHubJobOrigin;
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const { origin: ignored, ...data } = fields;
  void ignored;
  const captured = JSON.parse(encodeVerificationActionData(data)) as Omit<ReassessmentSource, 'origin'>;
  return deepFreeze({ ...captured, origin });
}

/** This function always performs the original native reads itself. Scope JSON,
 * observation DTOs and caller callbacks are never its decision authority. */
async function observeCurrentDecision(source: ReassessmentSource) {
  const job = assertAuthenticatedGitHubJobOriginCurrent(source.origin);
  const envelope = parseHostedEnvelope(source.envelope);
  const { session, scopeAuthorization: scope, preGateReview: review } = envelope;
  const binding = parseCiSourceProgramTransitionBinding(source.sourceProgramTransition);
  if (job.phase !== 'receive-verification-session-resume' || job.repository !== session.repository ||
      job.trustedDriverRoot !== source.repositoryRoot || path.resolve(source.repositoryRoot) !== source.repositoryRoot ||
      job.workflowSha !== session.baseSha || source.evidence.sessionRevision !== session.sessionRevision ||
      source.evidence.producer.runId !== job.runId || source.evidence.producer.runAttempt !== job.runAttempt ||
      source.evidence.producer.workflowSha !== job.workflowSha ||
      !Number.isSafeInteger(source.deadlineAtUnixMs) || source.deadlineAtUnixMs <= Date.now() ||
      source.deadlineAtUnixMs > job.originalDeadlineAtUnixMs) fail('original receiver, Session or deadline differs');
  const parent = await observeHostedResumeReassessmentParent({ origin: source.origin,
    signal: source.signal, authority: source.authority });
  const request = parent.originalRequest;
  const resolution = CodexDevelopmentResolveHostedAction({ envelope,
    request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(source.authority.envelope.proposal)) });
  if (request.expectedSessionRevision !== session.sessionRevision || request.expectedBaseSha !== session.baseSha ||
      request.expectedBaseTreeSha !== session.baseTreeSha || request.expectedHeadSha !== session.headSha ||
      request.expectedHeadTreeSha !== session.headTreeSha || request.manifestPath !== session.manifestPath ||
      request.manifestDigest !== session.manifestDigest || request.expectedActionPlanDigest !== envelope.actionPlanClosure.actionPlanDigest ||
      request.expectedScopeProposalDigest !== scope.proposalDigest || request.reviewPolicyDigest !== session.reviewPolicyDigest ||
      request.profile !== session.profile || scope.issuer.principalId !== parent.parentActor.nodeId ||
      scope.issuer.trustRevision !== job.workflowSha || scope.issuer.sourceTransport !== 'github-actions' ||
      scope.issuer.sourceRunId !== job.runId || scope.issuer.sourceRef !== 'refs/heads/main') fail('original human Scope/request binding differs');
  const selected = envelope.actionPlanClosure.actions.filter(({ action }) => action.operation.identity === SOURCE_PROGRAM_TRANSITION_GATE_ID);
  if (selected.length !== 1 || selected[0]!.action.actionKey !== resolution.actionPlan.action.actionKey ||
      binding.baseSha !== session.baseSha || binding.headSha !== session.headSha) fail('exact Source Program member or binding is missing');
  const action = selected[0]!.action;
  const expected = ciVerificationGateStep(sourceProgramTransitionGate(binding));
  const normalized = envelope.actionPlanClosure.normalizedOperations.filter(({ gateId }) => gateId === SOURCE_PROGRAM_TRANSITION_GATE_ID);
  if (normalized.length !== 1 || !canonicalEquals(ciVerificationNormalizedOperationArgv(normalized[0]!), expected.argv) ||
      !action.operation.declaredEnvironment.some(({ name, digest }) =>
        name === 'SEC_SOURCE_PROGRAM_TRANSITION_BINDING' && digest === expected.environment[name])) fail('source analysis command/binding differs');
  const index = hostedActionProviderIndexFromSnapshot(parent.snapshot);
  const terminalDecision = CodexDevelopmentReduceHostedActionProviderIndex({ resolution, index,
    repositoryId: Number(parent.parentPlan.repositoryId), repository: session.repository });
  if (terminalDecision.disposition !== 'terminal-anchored') fail('original completed member is not anchored');
  const originals = index.terminalObservations.filter(({ artifact }) => artifact?.artifactDigest === terminalDecision.terminalPayloadDigest);
  const terminal = originals.length === 1 ? originals[0]!.artifact : null;
  if (terminal === null || terminal.actionPlan.action.actionKey !== action.actionKey ||
      terminal.result.status !== 'passed' || terminal.result.evidenceRefs.length !== 1) fail('exact original output/terminal is missing');
  const completion = projectHostedTerminalGate(action, terminal);
  const supplied = source.evidence.gates.filter(({ action: member }) => member.actionKey === action.actionKey);
  if (supplied.length !== 1 || !canonicalEquals(completion, supplied[0]) ||
      source.evidence.actionPlan.actionPlanDigest !== envelope.actionPlanClosure.actionPlanDigest) fail('complete original gate differs');
  const github = createVerificationSessionGitHubClient(source.repositoryRoot, session.repository,
    { deadlineAtUnixMs: source.deadlineAtUnixMs, signal: getAuthenticatedGitHubJobOriginSignal(source.origin) });
  const candidate = await github.observeCandidate(session.repository, session.prNumber);
  if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository ||
      candidate.baseSha !== session.baseSha || candidate.baseTreeSha !== session.baseTreeSha ||
      candidate.headSha !== session.headSha || candidate.headTreeSha !== session.headTreeSha ||
      CodexDevelopmentParseWorkPackageLocator(candidate.body) !== session.manifestPath) fail('current exact candidate or manifest locator differs');
  const inventory = await github.observeChangedPaths({ repository: session.repository, prNumber: session.prNumber,
    state: 'OPEN', draft: false, baseSha: session.baseSha, headSha: session.headSha });
  if (!canonicalEquals([...inventory.paths].sort(), [...scope.authorizedPaths].sort())) fail('current changed paths exceed original Scope');
  const manifestSource = await github.readBlobText(session.repository, session.headSha, session.manifestPath);
  if (CodexDevelopmentWorkPackageManifestDigest(manifestSource) !== session.manifestDigest) fail('current manifest bytes differ');
  CodexDevelopmentAssertWorkPackageOwnership(CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource), [...inventory.paths]);
  const currentReview = await github.observeReviewBarrier({ repository: session.repository, prNumber: session.prNumber,
    headSha: session.headSha, excludedPrincipalNodeIds: new Set([candidate.authorNodeId, parent.parentActor.nodeId]) });
  if (currentReview.status !== 'clear') fail(`current original Review is unavailable: ${currentReview.status}`);
  assertGitHubReviewAuthorityObservation(currentReview);
  const now = new Date().toISOString();
  assertScopeAuthorizationCurrent(scope, { baseSha: session.baseSha, baseTreeSha: session.baseTreeSha,
    headSha: session.headSha, headTreeSha: session.headTreeSha, manifestDigest: session.manifestDigest,
    changedPaths: inventory.paths, sessionProposalDigest: session.sessionProposalDigest,
    actionPlanClosureDigest: session.actionPlanClosureDigest, environmentDigest: session.environmentDigest,
    expectedAuthorizationRevision: session.scopeAuthorizationRevision, now });
  if (scope.authorizationDigest !== session.scopeAuthorizationReceiptDigest) fail('original Scope receipt differs');
  assertReviewStabilityReceiptCurrent(review, { stage: 'pre-expensive', sessionRevision: session.sessionRevision,
    scopeAuthorizationRevision: session.scopeAuthorizationRevision, scopeAuthorizationReceiptDigest: session.scopeAuthorizationReceiptDigest,
    headSha: session.headSha, headTreeSha: session.headTreeSha, expectedPolicyDigest: session.reviewPolicyDigest,
    snapshotDigest: currentReview.snapshot.snapshotDigest, expectedReviewRevision: review.reviewRevision, now });
  const checks = await github.observeChecks(session.repository, session.baseSha);
  const ledger = createMainHealthLedger(createObservedMainHealthInput({ repository: session.repository,
    mainSha: session.baseSha, mainTreeSha: session.baseTreeSha, trustRevision: session.baseSha,
    checks, observedAt: now, expiresAt: new Date(Date.parse(now) + 300_000).toISOString() }));
  const lane = resolveOrdinaryMainHealthLane({ ledger, now, expectedRepository: session.repository,
    expectedDefaultBranch: 'main', expectedMainSha: session.baseSha, expectedMainTreeSha: session.baseTreeSha,
    expectedTrustRevision: session.baseSha });
  if (!lane.allowed || lane.status !== 'healthy' || lane.observationValidity !== 'valid' ||
      ledger.allowedLanes.length !== 1 || ledger.allowedLanes[0] !== 'ordinary' ||
      ledger.healthRevision !== session.mainHealthRef.healthRevision) fail('fresh exact ordinary MainHealth is missing or changed');
  const runtime = requireSecLinuxVerificationNativeRuntimeInput(observeSecLinuxVerificationNativeRuntimeInput({ repositoryRoot: source.repositoryRoot }));
  assertAuthenticatedGitHubJobOriginCurrent(source.origin);
  const workspace = deepFreeze({ repositoryRoot: source.repositoryRoot, repository: session.repository,
    baseSha: session.baseSha, baseTreeSha: session.baseTreeSha, headSha: session.headSha, headTreeSha: session.headTreeSha,
    operationKey: `transition-${session.sessionRevision.slice(7, 27)}`,
    nativeRuntimeRoot: runtime.rootPath, nativeRuntimeManifestDigest: runtime.manifestDigest });
  const logicalSubject = deepFreeze({ workspace, action, normalizedOperation: normalized[0]!, sourceProgramTransition: binding,
    parentPlan: parent.parentPlan, signal: source.signal, completeGate: completion,
    scopeAuthorizationRevision: scope.authorizationRevision, scopeAuthorizationReceiptDigest: scope.authorizationDigest,
    manifestDigest: session.manifestDigest, authorizedPaths: scope.authorizedPaths });
  const currentEpochDigest = sha256({ logicalSubject, receiver: { runId: job.runId, runAttempt: job.runAttempt,
    workflowSha: job.workflowSha }, human: parent.parentActor, reviewSnapshotDigest: currentReview.snapshot.snapshotDigest,
    reviewRevision: review.reviewRevision, mainHealthRevision: ledger.healthRevision });
  const intent = compileSemanticOperationIntent({ operation: semanticOperation,
    intentDigest: sha256(logicalSubject), decisionDigest: currentEpochDigest,
    aggregateBudgets: TRUSTED_RUNTIME_NATIVE_BUDGETS, requirements: [TRUSTED_RUNTIME_NATIVE_REQUIREMENT] });
  const deadlineAtUnixMs = Math.min(source.deadlineAtUnixMs, Date.parse(scope.expiresAt), Date.parse(review.expiresAt),
    Date.now() + TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs);
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now()) fail('current approval lifetime is exhausted');
  return { intent, currentEpochDigest, workspace, deadlineAtUnixMs };
}

export async function issueHostedSourceProgramReassessment(input: ReassessmentSource): Promise<HostedSourceProgramReassessmentAdmission> {
  const source = captureSource(input);
  const decision = await observeCurrentDecision(source);
  const issued = authority.issuer.issue({ operation: decision.intent, currentEpochDigest: decision.currentEpochDigest,
    deadlineAtUnixMs: decision.deadlineAtUnixMs });
  const plan = compileSemanticOperationPlan({ operation: decision.intent.identity.operation,
    intentDigest: decision.intent.identity.intentDigest, decisionDigest: decision.intent.identity.decisionDigest,
    aggregateBudgets: decision.intent.execution.aggregateBudgets, requirements: decision.intent.execution.requirements,
    deadlineAtUnixMs: issued.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: issued.authorityGrantDigest }) });
  return Object.freeze({ grant: issued.grant, plan, source });
}

export async function consumeHostedSourceProgramReassessment(input: Readonly<{
  admission: HostedSourceProgramReassessmentAdmission;
  repositoryRoot: string; repository: string; baseSha: string; baseTreeSha: string; headSha: string; headTreeSha: string;
  operationKey: string; deadlineAtUnixMs: number; nativeRuntimeRoot: string; nativeRuntimeManifestDigest: `sha256:${string}`;
}>): Promise<SemanticOperationPlan> {
  const fields = readVerificationDataRecord(input, 'Reassessment consume');
  const admitted = readVerificationDataRecord(fields.admission, 'Reassessment admission');
  const plan = admitted.plan as SemanticOperationPlan;
  assertSemanticOperationPlan(plan);
  const source = captureSource(admitted.source as ReassessmentSource);
  const grant = admitted.grant as OperationEffectGrant;
  const { admission: ignored, ...actual } = fields;
  void ignored;
  const workspace = JSON.parse(encodeVerificationActionData(actual));
  const decision = await observeCurrentDecision(source);
  const { deadlineAtUnixMs, ...actualWorkspace } = workspace;
  if (!canonicalEquals(actualWorkspace, decision.workspace) || deadlineAtUnixMs !== plan.attempt.deadlineAtUnixMs ||
      plan.attempt.deadlineAtUnixMs > decision.deadlineAtUnixMs ||
      !canonicalEquals(plan.identity, decision.intent.identity) ||
      !canonicalEquals(plan.execution, decision.intent.execution)) fail('current logical intent, physical workspace or budget differs');
  authority.consumer.consume({ grant, operation: plan, currentEpochDigest: decision.currentEpochDigest });
  return plan;
}
