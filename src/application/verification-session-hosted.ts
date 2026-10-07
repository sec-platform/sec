import { failureMessage } from '../contracts/failure-inspection.ts';
import { ResourceCompositeSettlementError, settleResourcesAsync } from '../execution/resource-settlement.ts';
import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest } from '../execution/verification/action.ts';
import type { BranchCloseoutEffectStartPublication, BranchCloseoutOperationBinding, BranchCloseoutOperationPublication, BranchCloseoutOperationReceipt, HostedWorkflowCommentProvenance, PreparedBranchCloseoutEnvelope } from '../execution/verification/branch-closeout.ts';
import type {
  HostedCloseoutEffectStartReadback, HostedCloseoutTerminalReadback, HostedIntegrationAuthorizationPublicationReadback, HostedIntegrationIdentity, HostedRecoveryArtifactMaterialization, HostedRecoveryArtifactObservation, HostedResumeDispatchOutcome, HostedResumeDispatchOutcomeCollection, HostedResumeDispatchRecording, HostedResumeEmitter, HostedResumeSignal, HostedSessionArtifactCapture,
  HostedSessionArtifactTransport, HostedSessionTerminalArtifact, HostedSquashMergeResponse, HostedVerificationCommand, VerificationSessionHostedEnvelope, VerificationSessionHostedFacts, VerificationSessionHostedRequest
} from "../execution/verification/hosted.ts";
import { HOSTED_SESSION_WAKE_KEY_SCHEMA } from '../execution/verification/hosted.ts';
import type { HostedIntegrationEffectPlan, HostedIntegrationPhase, HostedIntegrationRoute, IntegrationAuthorizationOperationPublication, IssueDisposition, IssueDispositionPlan, MergeGateProvenance, MergeGateResult } from '../execution/verification/integration.ts';
import type { GitHubActionsArtifactObservation, GitHubCandidateObservation, GitHubCheckObservation, GitHubComparisonObservation, GitHubReviewBarrierObservation, MainHealthLedger, PlatformEnforcementObservation, ReviewStabilityReceipt, TrustedArtifactProvenance, TrustedIntegrationAuthorizationSource, TrustedRuntimeProof, VerificationSession, VerificationSessionRuntimeOutcome } from '../execution/verification/session.ts';
import { resumeVerificationSession, type VerificationSessionResumeExternal, type VerificationSessionResumeGitHub, type VerificationSessionResumePorts } from './verification-session-resume.ts';

export { HOSTED_VERIFICATION_COMMANDS, type HostedVerificationCommand } from '../execution/verification/hosted.ts';

export interface HostedSessionPreparationPorts<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs> {
  observeCandidate(repository: string, pullRequestNumber: number): Promise<GitHubCandidateObservation>;
  assertTrustedRequestCurrent(request: VerificationSessionHostedRequest<RequestSchema>): void;
  manifestLocator(candidateBody: string): string;
  readBlobText(repository: string, commit: string, file: string): Promise<string>;
  manifestDigest(source: string): string;
  parseManifest(source: string): Manifest;
  assertManifestOwnership(manifest: Manifest, changedPaths: readonly string[]): void;
  observeChangedSelection(input: Readonly<{ repository: string; pullRequestNumber: number;
    candidate: GitHubCandidateObservation }>): Promise<Readonly<{
    changedPaths: readonly string[]; testImpactTransition: Transition; testImpactSourceProvider: SourceProvider;
  }>>;
  observeDependencyBlobs(input: Readonly<{ repository: string; baseSha: string; headSha: string }>): Promise<DependencyBlobs>;
  observeReviewBarrier(input: Readonly<{ repository: string; prNumber: number; headSha: string;
    excludedPrincipalNodeIds: ReadonlySet<string> }>): Promise<GitHubReviewBarrierObservation>;
  observeChecks(repository: string, commit: string): Promise<readonly GitHubCheckObservation[]>;
  reconstructFacts(input: Readonly<{
    request: VerificationSessionHostedRequest<RequestSchema>; repository: string; candidate: GitHubCandidateObservation;
    changedPaths: readonly string[]; testImpactTransition: Transition; testImpactSourceProvider: SourceProvider;
    integrationPrincipalNodeId: string; producerPrincipalNodeId: string; sourceRunId: string; sourceRef: string;
    observedAt: string; reviewBarrier: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>;
    mainHealthChecks: readonly GitHubCheckObservation[]; dependencyBlobs: DependencyBlobs;
  }>): VerificationSessionHostedFacts;
  prepareEnvelope(input: Readonly<{ request: VerificationSessionHostedRequest<RequestSchema>;
    facts: VerificationSessionHostedFacts; now: string }>): VerificationSessionHostedEnvelope<EnvelopeSchema>;
  now(): string;
}

/** Reconstruct current facts from the authenticated original human/request.
 * A historical envelope is a join input; it never renews Review or Scope.
 * Native validators still prove the loaded trusted revision and live cause. */
export async function observeHostedSessionFacts<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs>(input: Readonly<{
    request: VerificationSessionHostedRequest<RequestSchema>; repository: string;
    originalHumanNodeId: string; sourceRunId: string; sourceRef: string;
  }>, ports: HostedSessionPreparationPorts<RequestSchema, EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs>) {
  const request = input.request;
  ports.assertTrustedRequestCurrent(request);
  const candidate = await ports.observeCandidate(input.repository, request.prNumber);
  const exactCandidate: readonly [unknown, unknown, string][] = [
    [candidate.baseSha, request.expectedBaseSha, 'base'], [candidate.baseTreeSha, request.expectedBaseTreeSha, 'base tree'],
    [candidate.headSha, request.expectedHeadSha, 'head'], [candidate.headTreeSha, request.expectedHeadTreeSha, 'head tree']
  ];
  for (const [actual, expected, label] of exactCandidate) if (actual !== expected) throw new Error(`observe-hosted ${label} drifted.`);
  if (ports.manifestLocator(candidate.body) !== request.manifestPath) throw new Error('observe-hosted manifest locator drifted.');
  const manifestSource = await ports.readBlobText(input.repository, request.expectedHeadSha, request.manifestPath);
  if (ports.manifestDigest(manifestSource) !== request.manifestDigest) throw new Error('observe-hosted manifest digest drifted.');
  const manifest = ports.parseManifest(manifestSource);
  const selection = await ports.observeChangedSelection({ repository: input.repository,
    pullRequestNumber: request.prNumber, candidate });
  ports.assertManifestOwnership(manifest, selection.changedPaths);
  const dependencyBlobs = await ports.observeDependencyBlobs({ repository: input.repository,
    baseSha: request.expectedBaseSha, headSha: request.expectedHeadSha });
  const excludedPrincipalNodeIds = new Set([candidate.authorNodeId, input.originalHumanNodeId]);
  const reviewBarrier = await ports.observeReviewBarrier({ repository: input.repository, prNumber: request.prNumber,
    headSha: request.expectedHeadSha, excludedPrincipalNodeIds });
  if (reviewBarrier.status !== 'clear') return Object.freeze({ status: reviewBarrier.status, reviewBarrier, envelope: null });
  ports.assertTrustedRequestCurrent(request);
  const facts = ports.reconstructFacts({ request, repository: input.repository, candidate,
    changedPaths: selection.changedPaths, testImpactTransition: selection.testImpactTransition,
    testImpactSourceProvider: selection.testImpactSourceProvider, integrationPrincipalNodeId: input.originalHumanNodeId,
    producerPrincipalNodeId: input.originalHumanNodeId, sourceRunId: input.sourceRunId, sourceRef: input.sourceRef,
    observedAt: ports.now(), reviewBarrier,
    mainHealthChecks: await ports.observeChecks(input.repository, request.expectedBaseSha), dependencyBlobs });
  return Object.freeze({ status: 'observed' as const, facts });
}

/** The persisted facts remain reconstruction input. This stage obtains its
 * own candidate and private Review observation before the original issuer. */
export async function prepareHostedSessionFromFacts<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs>(input: Readonly<{
    request: VerificationSessionHostedRequest<RequestSchema>; facts: VerificationSessionHostedFacts;
  }>, ports: HostedSessionPreparationPorts<RequestSchema, EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs>) {
  const request = input.request;
  ports.assertTrustedRequestCurrent(request);
  const currentCandidate = await ports.observeCandidate(input.facts.repository, request.prNumber);
  const currentReview = await ports.observeReviewBarrier({ repository: input.facts.repository, prNumber: request.prNumber,
    headSha: request.expectedHeadSha, excludedPrincipalNodeIds: new Set([currentCandidate.authorNodeId, input.facts.integrationPrincipalNodeId]) });
  if (currentReview.status !== 'clear') return Object.freeze({ status: currentReview.status, reviewBarrier: currentReview, envelope: null });
  ports.assertTrustedRequestCurrent(request);
  const envelope = ports.prepareEnvelope({ request, facts: { ...input.facts, candidate: currentCandidate, reviewBarrier: currentReview }, now: ports.now() });
  return Object.freeze({ status: 'prepared' as const, envelope });
}

export async function prepareHostedSessionEnvelope<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs>(input: Readonly<{
    request: VerificationSessionHostedRequest<RequestSchema>; repository: string;
    originalHumanNodeId: string; sourceRunId: string; sourceRef: string;
  }>, ports: HostedSessionPreparationPorts<RequestSchema, EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs>) {
  const observed = await observeHostedSessionFacts(input, ports);
  if (observed.status !== 'observed') return Object.freeze({ ...observed, envelope: null });
  return prepareHostedSessionFromFacts({ request: input.request, facts: observed.facts }, ports);
}

/** A waiting Review publishes only the original non-triggering audit locator.
 * Neither diagnostic facts nor this locator renew Review authority. */
export async function observeHostedSessionCommand<RequestSchema extends string, EnvelopeSchema extends string,
  Manifest, Transition, SourceProvider, DependencyBlobs>(input: Readonly<{
    request: VerificationSessionHostedRequest<RequestSchema>; repository: string;
    originalHumanNodeId: string; sourceRunId: string; sourceRunAttempt: number; sourceRef: string; output: string;
  }>, ports: HostedSessionPreparationPorts<RequestSchema, EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs>
    & Readonly<{
      createReviewOperationId(input: Readonly<{ sessionRevision: VerificationActionKeyDigest; operationKind: 'request-review'; semanticInputDigest: VerificationActionKeyDigest }>): VerificationActionKeyDigest;
      ensureReviewLocator(input: Readonly<{ repository: string; prNumber: number; sessionRevision: VerificationActionKeyDigest; operationId: VerificationActionKeyDigest;
        headSha: string; headTreeSha: string; sourceRunId: string; sourceRunAttempt: number; workflowRef: string }>): Promise<Readonly<{
          status: string; commentId: string; publicationDigest: string;
        }>>;
      writeFacts(output: string, facts: VerificationSessionHostedFacts): void;
      resolveOutput(output: string): string;
    }>) {
  const observed = await observeHostedSessionFacts(input, ports);
  if (observed.status === 'observed') {
    ports.writeFacts(input.output, observed.facts);
    return Object.freeze({ status: 'observed' as const, output: ports.resolveOutput(input.output) });
  }
  const request = input.request;
  if (observed.status === 'provider-schema-unsupported') return Object.freeze({ status: 'BLOCKED' as const,
    sessionRevision: request.expectedSessionRevision, reviewProvider: observed.reviewBarrier, output: null });
  if (observed.reviewBarrier.status === 'blocked') throw new Error(`observe-hosted Review barrier blocked: ${observed.reviewBarrier.reason}`);
  if (observed.status !== 'waiting') throw new Error('observe-hosted Review barrier did not narrow to clear.');
  const operationId = ports.createReviewOperationId({ sessionRevision: request.expectedSessionRevision,
    operationKind: 'request-review', semanticInputDigest: request.requestOperationId });
  const locator = await ports.ensureReviewLocator({ repository: input.repository, prNumber: request.prNumber,
    sessionRevision: request.expectedSessionRevision, operationId, headSha: request.expectedHeadSha,
    headTreeSha: request.expectedHeadTreeSha, sourceRunId: input.sourceRunId, sourceRunAttempt: input.sourceRunAttempt,
    workflowRef: input.sourceRef });
  return Object.freeze({ status: 'WAITING_REVIEW' as const, sessionRevision: request.expectedSessionRevision,
    reviewLocator: locator.status, reviewLocatorCommentId: locator.commentId,
    reviewLocatorPublicationDigest: locator.publicationDigest, output: null });
}

export function assertHostedSessionFinalizationSelection(input: Readonly<{ evidencePath: string | undefined; previousArtifactPath: string | undefined }>): void {
  if ((input.evidencePath === undefined) === (input.previousArtifactPath === undefined)) {
    throw new Error('finalize-hosted requires exactly one of --evidence or --previous-artifact.');
  }
}

export async function finalizeHostedSessionCommand<Envelope, Evidence, Artifact extends Readonly<{ artifactDigest: string }>, Producer>(
  input: Readonly<{ envelope: Envelope; evidencePath: string | undefined; previousArtifactPath: string | undefined; output: string }>,
  ports: Readonly<{
    readEvidence(path: string): Evidence;
    readPreviousArtifact(path: string): Artifact;
    finalize(input: Readonly<{ envelope: Envelope; evidence: Evidence }>): Artifact;
    observeRefreshActor(envelope: Envelope): Promise<Readonly<{ nodeId: string; permission: string }>>;
    refreshProducer(envelope: Envelope, actorNodeId: string): Producer;
    refresh(input: Readonly<{ envelope: Envelope; previousArtifact: Artifact; producer: Producer; refreshedAt: string }>): Artifact;
    now(): string; writeArtifact(output: string, artifact: Artifact): void; resolveOutput(output: string): string;
  }>) {
  assertHostedSessionFinalizationSelection(input);
  let artifact: Artifact;
  if (input.evidencePath !== undefined) artifact = ports.finalize({ envelope: input.envelope, evidence: ports.readEvidence(input.evidencePath) });
  else {
    if (input.previousArtifactPath === undefined) throw new Error('finalize-hosted previous artifact is required.');
    const previousArtifact = ports.readPreviousArtifact(input.previousArtifactPath);
    const actor = await ports.observeRefreshActor(input.envelope);
    if (actor.permission !== 'admin' && actor.permission !== 'maintain') throw new Error('trusted artifact refresh actor lacks maintain/admin permission.');
    const producer = ports.refreshProducer(input.envelope, actor.nodeId);
    artifact = ports.refresh({ envelope: input.envelope, previousArtifact, producer, refreshedAt: ports.now() });
  }
  ports.writeArtifact(input.output, artifact);
  return Object.freeze({ status: 'finalized' as const, artifactDigest: artifact.artifactDigest, output: ports.resolveOutput(input.output) });
}

/** Resume consumes the original cause, then reconstructs today's envelope and
 * observes every original parent member. Native effects reauthenticate this
 * same cause; data returned by the observation ports grants no write right. */
export async function executeHostedSessionResumeReceiver<RequestSchema extends string, EnvelopeSchema extends string,
  SignalSchema extends string, ProviderEnvelope extends Readonly<{ proposal: Readonly<{ proposedActionKey: string }> }>, Resolution,
  Transport extends Readonly<{ artifactId: string; artifactName: string; archiveDigest: `sha256:${string}`;
    files: Readonly<{ 'verification-action-provider-envelope.json': string;
      'hosted-action-resolution.json': string; 'hosted-envelope.json': string }> }>,
  Proposal, Action extends Readonly<{ originalRequest: VerificationSessionHostedRequest<RequestSchema>;
    completedAction: HostedResumeSignal<SignalSchema>['completedAction']; resolutionTransport: Transport;
    parentActor: Readonly<{ nodeId: string }>; parentPlan: Readonly<{ proposals: readonly Proposal[] }> }>,
  Manifest, Transition, SourceProvider, DependencyBlobs, Snapshot, Terminal, Start, Anchor, Status, Producer,
  Coordination extends Readonly<{ disposition: string; dispatchActionKeys: readonly VerificationActionKeyDigest[] }>, Evidence, Artifact,
  Qualification,
  Dispatch extends Readonly<{ disposition: 'dispatched' | 'joined' | 'blocked' | 'unknown'; reason: string | null;
    actionKey: VerificationActionKeyDigest; publicationState: 'not-entered' | 'entered-unknown' | 'submitted'; primaryFailure?: unknown }>>(
  input: Readonly<{ signal: HostedResumeSignal<SignalSchema>; repository: string; sourceRunId: string; sourceRef: string }>,
  ports: HostedResumeIntakePorts<RequestSchema, EnvelopeSchema, SignalSchema, ProviderEnvelope, Resolution, Transport, Action>
    & Readonly<{
      preparation: HostedSessionPreparationPorts<RequestSchema, EnvelopeSchema, Manifest, Transition, SourceProvider, DependencyBlobs>;
      makeProviderEnvelope(proposal: Proposal, cause: Action): ProviderEnvelope;
      observeMember(authority: Readonly<{ envelope: ProviderEnvelope; actionPlanClosure: CiVerificationActionPlanClosure }>,
        signal: HostedResumeSignal<SignalSchema>): Promise<Snapshot>;
      providerIndex(snapshot: Snapshot): Readonly<{ terminalObservations: readonly Terminal[];
        startObservations: readonly Start[]; terminalAnchorObservations: readonly Anchor[]; providerStatusReadbacks: readonly Status[] }>;
      createProducer(envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>): Producer;
      compose(input: Readonly<{ envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>; observations: readonly Terminal[];
        startObservations: readonly Start[]; terminalAnchorObservations: readonly Anchor[];
        providerStatusReadbacks: readonly Status[]; producer: Producer }>): Readonly<{ coordination: Coordination; evidence: Evidence | null }>;
      observeDispatchHistory(input: Readonly<{ authority: Readonly<{ envelope: ProviderEnvelope; actionPlanClosure: CiVerificationActionPlanClosure }>;
        sessionRevision: VerificationActionKeyDigest; actionKeys: readonly VerificationActionKeyDigest[] }>): Promise<Readonly<{
          disposition: 'observed' | 'unavailable'; use: 'observer-only'; reason: string | null;
        }>>;
      dispatchMissing(input: Readonly<{ signal: HostedResumeSignal<SignalSchema>; envelope: ProviderEnvelope;
        actionPlanClosure: CiVerificationActionPlanClosure; hostedEnvelope: VerificationSessionHostedEnvelope<EnvelopeSchema> }>): Promise<Dispatch>;
      projectDispatchOutcome(input: Readonly<{ envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>; dispatch: Dispatch }>): HostedResumeDispatchOutcome<SignalSchema>;
      recordDispatchOutcome(outcome: HostedResumeDispatchOutcome<SignalSchema>): Promise<HostedResumeDispatchRecording<SignalSchema>>;
      exportDispatchOutcomes(input: Readonly<{ envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>;
        expectedActionKeys: readonly VerificationActionKeyDigest[]; entries: HostedResumeDispatchOutcomeCollection<SignalSchema>['entries'] }>): Promise<void>;
      qualifyCompletion(input: Readonly<{ envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>; evidence: Evidence;
        signal: HostedResumeSignal<SignalSchema>; members: readonly ProviderEnvelope[] }>): Promise<
        Readonly<{ kind: 'qualified'; qualification: Qualification | undefined }>
        | Readonly<{ kind: 'blocked'; reason: string; needs: readonly string[] }>>;
      finalize(input: Readonly<{ envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>; evidence: Evidence;
        signal: HostedResumeSignal<SignalSchema>; sourceProgramTransitionQualification?: Qualification }>): Artifact;
      writeTerminal(artifact: Artifact): Promise<void>;
    }>
) {
  let dispatchObservation: Readonly<{ envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>;
    expectedActionKeys: readonly VerificationActionKeyDigest[] }> | undefined;
  const dispatchEntries: HostedResumeDispatchOutcomeCollection<SignalSchema>['entries'][number][] = [];
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  let dispatchPrimary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
  const intake = await authenticateHostedSessionResume(input.signal.completedAction, ports);
  const prepared = await prepareHostedSessionEnvelope({ request: intake.action.originalRequest, repository: input.repository,
    originalHumanNodeId: intake.action.parentActor.nodeId, sourceRunId: input.sourceRunId, sourceRef: input.sourceRef }, ports.preparation);
  if (prepared.envelope === null) return Object.freeze({ status: prepared.status, artifact: null });
  const envelope = prepared.envelope;
  const terminalObservations: Terminal[] = [], startObservations: Start[] = [], anchorObservations: Anchor[] = [], statusReadbacks: Status[] = [];
  const members = intake.action.parentPlan.proposals.map(proposal => ports.makeProviderEnvelope(proposal, intake.action));
  for (const member of members) {
    const snapshot = await ports.observeMember({ envelope: member, actionPlanClosure: envelope.actionPlanClosure }, input.signal);
    const index = ports.providerIndex(snapshot);
    terminalObservations.push(...index.terminalObservations);
    startObservations.push(...index.startObservations);
    anchorObservations.push(...index.terminalAnchorObservations);
    statusReadbacks.push(...index.providerStatusReadbacks);
  }
  const composed = ports.compose({ envelope, observations: terminalObservations, startObservations,
    terminalAnchorObservations: anchorObservations, providerStatusReadbacks: statusReadbacks,
    producer: ports.createProducer(envelope) });
  if (composed.evidence === null) {
    if (composed.coordination.disposition === 'dispatch') {
      const history = await ports.observeDispatchHistory({ authority: { envelope: ports.parseProviderEnvelope(ports.encodeData(intake.action.completedAction.providerEnvelope)),
        actionPlanClosure: envelope.actionPlanClosure }, sessionRevision: envelope.session.sessionRevision,
        actionKeys: composed.coordination.dispatchActionKeys });
      if (history.use === 'observer-only') {
        return Object.freeze({ status: 'unknown' as const, reason: history.reason
          ?? 'Historical observations cannot establish that an earlier receiver never entered dispatch.',
          coordination: composed.coordination, history, artifact: null });
      }
      dispatchObservation = Object.freeze({ envelope, expectedActionKeys: Object.freeze([...composed.coordination.dispatchActionKeys]) });
      for (const actionKey of composed.coordination.dispatchActionKeys) {
        const member = members.find(candidate => candidate.proposal.proposedActionKey === actionKey);
        if (member === undefined) throw new Error('Receiver selected an Action outside its original authenticated parent plan.');
        const wakeup = await ports.dispatchMissing({ signal: input.signal, envelope: member, actionPlanClosure: envelope.actionPlanClosure, hostedEnvelope: envelope });
        const nativeFailure = Object.getOwnPropertyDescriptor(wakeup, 'primaryFailure');
        if (wakeup.publicationState === 'entered-unknown' && nativeFailure !== undefined && 'value' in nativeFailure) {
          dispatchPrimary = Object.freeze({ label: 'native resume dispatch', error: nativeFailure.value });
        }
        const outcome = ports.projectDispatchOutcome({ envelope, dispatch: wakeup });
        const position = dispatchEntries.length;
        dispatchEntries.push(Object.freeze({ actionKey: outcome.actionKey, recording: 'unrecorded', outcome }));
        try {
          const recording = await ports.recordDispatchOutcome(outcome);
          dispatchEntries[position] = Object.freeze({ actionKey: outcome.actionKey, ...recording });
        } catch (error) {
          await settleResourcesAsync({
            ...(wakeup.publicationState === 'entered-unknown' && nativeFailure !== undefined && 'value' in nativeFailure
              ? { primary: { label: 'native resume dispatch', error: nativeFailure.value } } : {}),
            cleanup: [{ label: 'resume outcome durable journal', settle: () => { throw error; } }]
          });
        }
        if (wakeup.disposition !== 'dispatched') {
          return Object.freeze({ status: wakeup.disposition, reason: wakeup.reason, coordination: composed.coordination, wakeup, artifact: null });
        }
      }
    }
    return Object.freeze({ status: composed.coordination.disposition, coordination: composed.coordination, artifact: null });
  }
  const qualified = await ports.qualifyCompletion({ envelope, evidence: composed.evidence, signal: input.signal, members });
  if (qualified.kind === 'blocked') return Object.freeze({ status: 'blocked' as const,
    reason: qualified.reason, needs: qualified.needs, coordination: composed.coordination, artifact: null });
  const artifact = ports.finalize({ envelope, evidence: composed.evidence, signal: input.signal,
    ...(qualified.qualification === undefined ? {} : { sourceProgramTransitionQualification: qualified.qualification }) });
  await ports.writeTerminal(artifact);
  return Object.freeze({ status: 'finalized' as const, coordination: composed.coordination, artifact });
  } catch (error) {
    primary = Object.freeze({ label: 'hosted resume receiver', error });
    throw error;
  } finally {
    await settleResourcesAsync({ ...(primary === undefined ? {} : { primary }), cleanup: [{
      label: 'complete resume dispatch outcome transport', settle: async () => {
        if (dispatchObservation === undefined) return;
        const byKey = new Map(dispatchEntries.map(entry => [entry.actionKey, entry]));
        try {
          await ports.exportDispatchOutcomes({ ...dispatchObservation,
            entries: dispatchObservation.expectedActionKeys.map(actionKey => byKey.get(actionKey)
              ?? Object.freeze({ actionKey, recording: 'not-attempted' as const, outcome: null })) });
        } catch (error) {
          if (primary === undefined && dispatchPrimary !== undefined) await settleResourcesAsync({ primary: dispatchPrimary,
            cleanup: [{ label: 'resume outcome transport export', settle: () => { throw error; } }] });
          throw error;
        }
      }
    }] });
  }
}

export interface HostedResumeSignalPorts<SignalSchema extends string> {
  readonly signalSchema: SignalSchema;
  observeEmitter(): HostedResumeEmitter;
  digest(value: object): `sha256:${string}`;
  encodeData(value: object): string;
  dispatchSignal(signalSource: string): Promise<Readonly<{ status: 'submitted'; signalDigest: `sha256:${string}` }>>;
}

export interface HostedResumeDispatchPorts<Authority, SignalSchema extends string> extends HostedResumeSignalPorts<SignalSchema> {
  observeCompletedAction(authority: Authority): Promise<Readonly<{
    completedAction: HostedResumeSignal<SignalSchema>['completedAction'];
  }>>;
}

export interface HostedResumeIntakePorts<RequestSchema extends string, EnvelopeSchema extends string,
  SignalSchema extends string, ProviderEnvelope, Resolution,
  Transport extends Readonly<{ artifactId: string; artifactName: string; archiveDigest: `sha256:${string}`;
    files: Readonly<{ 'verification-action-provider-envelope.json': string;
      'hosted-action-resolution.json': string; 'hosted-envelope.json': string }> }>,
  Action extends Readonly<{ originalRequest: VerificationSessionHostedRequest<RequestSchema>;
    completedAction: HostedResumeSignal<SignalSchema>['completedAction']; resolutionTransport: Transport }>> {
  captureResolutionTransport(completedAction: HostedResumeSignal<SignalSchema>['completedAction']): Promise<Transport>;
  parseProviderEnvelope(source: string): ProviderEnvelope;
  parseEnvelope(source: string): VerificationSessionHostedEnvelope<EnvelopeSchema>;
  parseResolution(source: string): Resolution;
  resolveAction(input: Readonly<{ envelope: VerificationSessionHostedEnvelope<EnvelopeSchema>;
    providerEnvelope: ProviderEnvelope }>): Resolution;
  observeAuthenticatedAction(authority: Readonly<{ envelope: ProviderEnvelope; actionPlanClosure: CiVerificationActionPlanClosure }>): Promise<Action>;
  encodeData(value: unknown): string;
}

/** The wake signal selects native transport, not authority. Read the exact
 * original three-member archive, consume its canonical parsers, authenticate
 * the original parent and completed Action, then join the independent reread. */
export async function authenticateHostedSessionResume<RequestSchema extends string, EnvelopeSchema extends string,
  SignalSchema extends string, ProviderEnvelope, Resolution,
  Transport extends Readonly<{ artifactId: string; artifactName: string; archiveDigest: `sha256:${string}`;
    files: Readonly<{ 'verification-action-provider-envelope.json': string;
      'hosted-action-resolution.json': string; 'hosted-envelope.json': string }> }>,
  Action extends Readonly<{ originalRequest: VerificationSessionHostedRequest<RequestSchema>;
    completedAction: HostedResumeSignal<SignalSchema>['completedAction']; resolutionTransport: Transport }>>(
  completedAction: HostedResumeSignal<SignalSchema>['completedAction'],
  ports: HostedResumeIntakePorts<RequestSchema, EnvelopeSchema, SignalSchema, ProviderEnvelope, Resolution, Transport, Action>
) {
  const transport = await ports.captureResolutionTransport(completedAction);
  const providerEnvelope = ports.parseProviderEnvelope(transport.files['verification-action-provider-envelope.json']);
  const historicalEnvelope = ports.parseEnvelope(transport.files['hosted-envelope.json']);
  const resolution = ports.parseResolution(transport.files['hosted-action-resolution.json']);
  if (ports.encodeData(providerEnvelope) !== ports.encodeData(completedAction.providerEnvelope)
      || ports.encodeData(resolution) !== ports.encodeData(ports.resolveAction({ envelope: historicalEnvelope, providerEnvelope }))) {
    throw new Error('Hosted resume original resolution archive does not bind the exact wakeup and canonical Action member.');
  }
  const action = await ports.observeAuthenticatedAction({ envelope: providerEnvelope, actionPlanClosure: historicalEnvelope.actionPlanClosure });
  const reread = action.resolutionTransport;
  if (reread.artifactId !== transport.artifactId || reread.artifactName !== transport.artifactName
      || reread.archiveDigest !== transport.archiveDigest || ports.encodeData(reread.files) !== ports.encodeData(transport.files)
      || ports.encodeData(action.completedAction) !== ports.encodeData(completedAction)) {
    throw new Error('Hosted resume independent authenticated readback differs from the original complete archive and wakeup.');
  }
  if (historicalEnvelope.requestOperationId !== action.originalRequest.requestOperationId
      || historicalEnvelope.session.sessionRevision !== action.originalRequest.expectedSessionRevision
      || historicalEnvelope.actionPlanClosure.actionPlanDigest !== action.originalRequest.expectedActionPlanDigest) {
    throw new Error('Hosted resume original envelope differs from the authenticated full Session request.');
  }
  return Object.freeze({ action, transport: reread, historicalEnvelope, resolution });
}

/** Completed Action facts come from the original authenticated provider.
 * The signal only wakes a consumer; the native dispatch retains its one-shot
 * credential, current-origin and phase checks. The SUT never calls this flow. */
export async function dispatchHostedSessionResume<Authority, SignalSchema extends string>(
  authority: Authority, ports: HostedResumeDispatchPorts<Authority, SignalSchema>
) {
  const facts = await ports.observeCompletedAction(authority);
  return await submitHostedResumeSignal(facts.completedAction, ports);
}

async function submitHostedResumeSignal<SignalSchema extends string>(
  completedAction: HostedResumeSignal<SignalSchema>['completedAction'], ports: HostedResumeSignalPorts<SignalSchema>
) {
  const emitter = ports.observeEmitter();
  const wakeKey = ports.digest({ schema: HOSTED_SESSION_WAKE_KEY_SCHEMA, completedAction });
  const payload = { schema: ports.signalSchema, wakeKey, completedAction, emitter };
  const signal: HostedResumeSignal<SignalSchema> = Object.freeze({ ...payload, signalDigest: ports.digest(payload) });
  const submitted = await ports.dispatchSignal(ports.encodeData(signal));
  if (submitted.signalDigest !== signal.signalDigest) throw new Error('Hosted resume dispatch readback names another signal.');
  return Object.freeze({ ...submitted, wakeKey });
}

export async function sendHostedSessionResume<RequestSchema extends string, EnvelopeSchema extends string,
  SignalSchema extends string, ProviderEnvelope, Resolution,
  Transport extends Readonly<{ artifactId: string; artifactName: string; archiveDigest: `sha256:${string}`;
    files: Readonly<{ 'verification-action-provider-envelope.json': string;
      'hosted-action-resolution.json': string; 'hosted-envelope.json': string }> }>,
  Action extends Readonly<{ originalRequest: VerificationSessionHostedRequest<RequestSchema>;
    completedAction: HostedResumeSignal<SignalSchema>['completedAction']; resolutionTransport: Transport }>>(
  source: Readonly<{ sourceRunId: string; sourceRunAttempt: number }>,
  ports: HostedResumeIntakePorts<RequestSchema, EnvelopeSchema, SignalSchema, ProviderEnvelope, Resolution, Transport, Action>
    & HostedResumeSignalPorts<SignalSchema> & Readonly<{
      discoverCompletedAction(source: Readonly<{ sourceRunId: string; sourceRunAttempt: number }>): Promise<Readonly<{
        completedAction: HostedResumeSignal<SignalSchema>['completedAction']; resolutionTransport: Transport }>>;
    }>
) {
  const discovered = await ports.discoverCompletedAction(source);
  const intake = await authenticateHostedSessionResume(discovered.completedAction, ports);
  if (ports.encodeData(discovered.resolutionTransport.files) !== ports.encodeData(intake.transport.files)
      || discovered.resolutionTransport.archiveDigest !== intake.transport.archiveDigest
      || discovered.resolutionTransport.artifactId !== intake.transport.artifactId) {
    throw new Error('Hosted resume discovery and original authenticated intake differ.');
  }
  return await submitHostedResumeSignal(intake.action.completedAction, ports);
}

/** Select the original Session transport once, then consume the command's
 * stages. Journals are native instances supplied by bootstrap; their
 * observation, effect-guard and durable roles are chosen here. */
export async function executeHostedVerificationSessionCommand<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus },
  RequestSchema extends string, Tracking, MergeInput, Reconciliation extends Readonly<{ status: string }>,
  EventSchema extends string, ClaimSchema extends string, Transition,
  Health extends Readonly<{ allowed: boolean; status: string; reason: string }>,
  Qualification extends Readonly<{ ledger: MainHealthLedger; observedAt: string; assertCurrent(): Promise<void> }>, WorktreeToken, SignalSchema extends string>(
  input: Readonly<{
    command: HostedVerificationCommand; repository: string; outputPath: string; repositoryRoot: string;
    sourceRunId: string; sourceRunAttempt: number;
    resumeGitHub: VerificationSessionResumeGitHub<VerificationSessionHostedRequest<RequestSchema>>;
    observationResumePorts: VerificationSessionResumePorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult,
      EventSchema, ClaimSchema, VerificationSessionHostedRequest<RequestSchema>, Transition, Health, SignalSchema>;
    effectGuardResumePorts: VerificationSessionResumePorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult,
      EventSchema, ClaimSchema, VerificationSessionHostedRequest<RequestSchema>, Transition, Health, SignalSchema>;
    durableResumePorts: VerificationSessionResumePorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult,
      EventSchema, ClaimSchema, VerificationSessionHostedRequest<RequestSchema>, Transition, Health, SignalSchema>;
  }>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>
    & HostedIntegrationPreflightPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, MergeInput, SignalSchema>
    & HostedIssueDispositionPorts<Tracking, readonly GitHubCheckObservation[]> & HostedRecoveryPreparationPorts
    & HostedIntegrationResumeObservationPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>
    & HostedIntegrationEffectPorts<Reconciliation> & HostedCloseoutMutationPorts<Qualification, WorktreeToken>
    & HostedRecoveryVerificationPorts
): Promise<string> {
  if (input.command === 'verify-integration-recovery') {
    return await verifyHostedIntegrationRecovery({ repository: input.repository, outputPath: input.outputPath }, ports);
  }
  const hosted = await selectHostedArtifactForMergeWakeup(input, ports);
  const selected = { repository: input.repository, outputPath: input.outputPath, hosted };
  if (input.command === 'closeout-publish-hosted') return await publishHostedCloseout(selected, ports);
  if (input.command === 'closeout-mutate-hosted') return await mutateHostedCloseout(selected, ports);
  if (input.command === 'prepare-integration-hosted') return await prepareHostedIntegrationRecovery(selected, ports);
  return await integrateHostedSession({ ...selected, repositoryRoot: input.repositoryRoot,
    resumeGitHub: input.resumeGitHub, observationResumePorts: input.observationResumePorts,
    effectGuardResumePorts: input.effectGuardResumePorts, durableResumePorts: input.durableResumePorts }, ports);
}

/** This routing decision issues no token or effect authority. */
export async function routePreparedWorktreeCleanupAttempt<T>(input: Readonly<{
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
  targetCount: number;
  consumeLocalPreparedTargets: () => Promise<readonly T[]>;
}>): Promise<readonly T[]> {
  if (input.foreignWorktreeObservationDigests.length !== 0 || input.targetCount === 0) return Object.freeze([]);
  const consumed = await input.consumeLocalPreparedTargets();
  if (consumed.length !== input.targetCount || consumed.length === 0) {
    throw new Error('same-host-worktree-closeout-required: exact physical completion token set is unavailable.');
  }
  return Object.freeze([...consumed]);
}

export interface HostedCloseoutPorts<Qualification extends Readonly<{
  ledger: MainHealthLedger; observedAt: string; assertCurrent(): Promise<void>;
}>> {
  withPostMergeHealth<T>(binding: BranchCloseoutOperationBinding,
    operation: (health: Qualification) => Promise<T>): Promise<T>;
  observeTerminal(input: Readonly<{ repository: string; pullRequestNumber: number;
    closeoutOperationId: `sha256:${string}` }>): Promise<Readonly<{
      publication: BranchCloseoutOperationPublication; commentId: number;
    }> | null>;
  observeEffectStart(input: Readonly<{ repository: string; pullRequestNumber: number;
    closeoutOperationId: `sha256:${string}` }>): Promise<Readonly<{
      publication: BranchCloseoutEffectStartPublication; commentId: number;
    }> | null>;
  assertEffectStartMatches(input: Readonly<{ publication: BranchCloseoutEffectStartPublication;
    binding: BranchCloseoutOperationBinding;
    authorizationPublication: BranchCloseoutEffectStartPublication['authorizationPublication'];
    recoveryArtifact: BranchCloseoutEffectStartPublication['recoveryArtifact'];
  }>): void;
  captureOperationReceipt(preparation: PreparedBranchCloseoutEnvelope['preparation'],
    operationId: `sha256:${string}`): BranchCloseoutOperationReceipt | null;
  publishTerminal(input: Readonly<{ operationReceipt: BranchCloseoutOperationReceipt;
    provenance: HostedWorkflowCommentProvenance; effectStart: HostedCloseoutEffectStartReadback;
    health: Qualification }>): Promise<HostedCloseoutTerminalReadback>;
  publicationDigest(input: Readonly<{ closeoutOperationId: `sha256:${string}`;
    publicationDigest: `sha256:${string}`; commentId: number }>): `sha256:${string}`;
  writeProjection(path: string, value: unknown): void;
  resolveOutputPath(path: string): string;
  now(): string;
}

export interface HostedIssueDispositionPorts<Tracking, Checks> {
  markerState(message: string): 'complete' | 'absent';
  exactMarker(message: string, name: string): string;
  readManifest(repository: string, revision: string, manifestPath: string): Promise<string>;
  manifestDigest(source: string): string;
  parseManifest(source: string, manifestPath: string): Readonly<{ tracking: Tracking; acceptance: readonly string[] }>;
  observeIssuePlan(input: Readonly<{ repository: string; candidate: GitHubCandidateObservation;
    manifestPath: string; manifestDigest: `sha256:${string}`; tracking: Tracking }>): Promise<IssueDispositionPlan>;
  observeIssue(repository: string, issueNumber: number): Readonly<{ specRevision: `sha256:${string}`; state: 'OPEN' | 'CLOSED' }>;
  acceptanceId(input: Readonly<{ manifestDigest: `sha256:${string}`; index: number; text: string }>): `sha256:${string}`;
  observeChecks(repository: string, revision: string): Promise<Checks>;
  compileHealth(input: Readonly<{ repository: string; newMainSha: string; newMainTreeSha: string;
    observedAt: string; checks: Checks }>): Readonly<{ ledgerDigest: `sha256:${string}` }>;
  compileDisposition(input: Readonly<{ plan: IssueDispositionPlan; currentSpecRevision: `sha256:${string}`;
    acceptanceIds: readonly `sha256:${string}`[]; newMainSha: string; newMainTreeSha: string;
    evidenceRefs: readonly `sha256:${string}`[]; expectedProviderState: 'OPEN' | 'CLOSED' }>): IssueDisposition;
}

export async function observeHostedIssueDisposition<Tracking, Checks>(input: Readonly<{
  repository: string; session: VerificationSession; candidate: GitHubCandidateObservation;
  evidenceDigest: string; authorization: IntegrationAuthorizationOperationPublication; observedAt: string;
}>, ports: HostedIssueDispositionPorts<Tracking, Checks>) {
  const { candidate, session } = input;
  if (candidate.mergeCommitSha === null || candidate.mergeCommitTreeSha === null || candidate.mergeCommitMessage === null) {
    throw new Error('IssueDisposition hosted closeout requires exact merge readback.');
  }
  if (ports.markerState(candidate.mergeCommitMessage) === 'absent') {
    return Object.freeze({ status: 'no-disposition-markers', reason: 'issue-disposition-markers-absent' });
  }
  const mode = ports.exactMarker(candidate.mergeCommitMessage, 'Issue-Disposition-Mode');
  if (mode !== 'progress-only' && mode !== 'close-tracking-after-readback') throw new Error('Merged IssueDisposition mode marker is invalid.');
  const trackingMarker = ports.exactMarker(candidate.mergeCommitMessage, 'Issue-Disposition-Tracking');
  if (trackingMarker !== 'none' && !/^[1-9][0-9]*$/u.test(trackingMarker)) throw new Error('Merged IssueDisposition tracking marker is invalid.');
  const trackingIssueNumber = trackingMarker === 'none' ? null : Number(trackingMarker);
  if (trackingIssueNumber !== null && !Number.isSafeInteger(trackingIssueNumber)) throw new Error('Merged IssueDisposition tracking marker exceeds safe integer range.');
  const manifestSource = await ports.readManifest(input.repository, session.headSha, session.manifestPath);
  if (ports.manifestDigest(manifestSource) !== session.manifestDigest) throw new Error('IssueDisposition exact merged manifest bytes differ from the Session.');
  const manifest = ports.parseManifest(manifestSource, session.manifestPath);
  const plan = await ports.observeIssuePlan({ repository: input.repository, candidate,
    manifestPath: session.manifestPath, manifestDigest: session.manifestDigest, tracking: manifest.tracking });
  if (plan.mode !== mode || plan.trackingIssueNumber !== trackingIssueNumber
      || plan.titleBodyDigest !== ports.exactMarker(candidate.mergeCommitMessage, 'Issue-Disposition-Prose')
      || plan.planDigest !== ports.exactMarker(candidate.mergeCommitMessage, 'Issue-Disposition-Plan')) {
    throw new Error('IssueDisposition merge markers differ from the exact live plan.');
  }
  if (trackingIssueNumber === null) return Object.freeze({ status: 'no-tracking-issue', planDigest: plan.planDigest });
  const issue = ports.observeIssue(input.repository, trackingIssueNumber);
  const acceptanceIds = manifest.acceptance.map((text, index) => ports.acceptanceId({ manifestDigest: session.manifestDigest, index, text }));
  const evidence = [input.evidenceDigest, input.authorization.result.reviewReceipt.receiptDigest,
    input.authorization.result.authorization.receiptDigest];
  if (evidence.some(value => !/^sha256:[0-9a-f]{64}$/u.test(value))) throw new Error('IssueDisposition evidence reference is not one SHA-256 digest.');
  const evidenceRefs = evidence as `sha256:${string}`[];
  const health = mode === 'close-tracking-after-readback'
    ? ports.compileHealth({ repository: input.repository, newMainSha: candidate.mergeCommitSha,
      newMainTreeSha: candidate.mergeCommitTreeSha, observedAt: input.observedAt,
      checks: await ports.observeChecks(input.repository, candidate.mergeCommitSha) }) : null;
  const disposition = ports.compileDisposition({ plan, currentSpecRevision: issue.specRevision, acceptanceIds,
    newMainSha: candidate.mergeCommitSha, newMainTreeSha: candidate.mergeCommitTreeSha,
    evidenceRefs: health === null ? evidenceRefs : [...evidenceRefs, health.ledgerDigest], expectedProviderState: issue.state });
  return Object.freeze({ status: disposition.kind, receipt: disposition });
}

export interface HostedIntegrationPreflightPorts<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, MergeInput, SignalSchema extends string> {
  classifyArtifactReuse(artifact: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>, now: string): Readonly<{ actionEvidenceCandidate: boolean; reason: string }>;
  observeReviewBarrier(input: Readonly<{ repository: string; prNumber: number; headSha: string;
    excludedPrincipalNodeIds: ReadonlySet<string> }>): Promise<GitHubReviewBarrierObservation>;
  rawDigest(source: string): `sha256:${string}`;
  addSeconds(instant: string, seconds: number): string;
  createReviewReceipt(input: Readonly<{ stage: 'pre-merge'; session: VerificationSession;
    scope: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>['scopeAuthorization'];
    barrier: Extract<GitHubReviewBarrierObservation, { status: 'clear' }>;
    candidateAuthorNodeId: string; integrationPrincipalNodeId: string;
    expiresAt: string; operationId: `sha256:${string}` }>): ReviewStabilityReceipt;
  observeChangedPaths(input: Readonly<{ repository: string; prNumber: number; state: 'OPEN'; draft: false;
    baseSha: string; headSha: string }>): Promise<Readonly<{ paths: readonly string[] }>>;
  observeComparison(repository: string, baseSha: string, headSha: string): Promise<GitHubComparisonObservation>;
  observeOpenPullRequestCountForHead(repository: string, headSha: string): Promise<number>;
  compileMainHealth(input: Readonly<{ repository: string; mainSha: string; mainTreeSha: string;
    trustRevision: string; observedAt: string; expiresAt: string; checks: readonly GitHubCheckObservation[] }>): MainHealthLedger;
  mergeOperationId(input: Readonly<{ sessionRevision: `sha256:${string}`; headSha: string; actionPlanDigest: `sha256:${string}` }>): `sha256:${string}`;
  observePlatformEnforcement(repository: string): Promise<PlatformEnforcementObservation>;
  createMergeInput(input: Readonly<{
    artifact: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
    preMergeReview: ReviewStabilityReceipt;
    hostedArtifactOrigin: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>['origin'];
    hostedArtifactTransport: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>['transport'];
    candidate: Readonly<{ repository: string; prNumber: number; draft: false; headOpenPullRequestCount: 1;
      currentBaseSha: string; currentBaseTreeSha: string; headSha: string; headTreeSha: string;
      baseIsAncestor: true; behindBy: 0; manifestPath: string; manifestDigest: `sha256:${string}`; changedPaths: readonly string[] }>;
    provenance: Omit<MergeGateProvenance, 'sourceDigest'>; mainHealth: MainHealthLedger;
    platform: PlatformEnforcementObservation; consumptionOperationId: `sha256:${string}`;
    issuedAt: string; expiresAt: string;
  }>): MergeInput;
  evaluateMergeGate(input: MergeInput): MergeGateResult;
}

export async function evaluateHostedIntegrationPreflight<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, Tracking, MergeInput, SignalSchema extends string>(input: Readonly<{
    repository: string; hosted: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
    candidate: GitHubCandidateObservation; provenance: HostedWorkflowCommentProvenance;
    integrationPrincipal: HostedIntegrationIdentity['integrationPrincipal']; observedAt: string;
  }>, ports: HostedIntegrationPreflightPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, MergeInput, SignalSchema>
    & HostedIssueDispositionPorts<Tracking, readonly GitHubCheckObservation[]>) {
  const { repository, hosted, candidate, provenance, observedAt } = input;
  const artifact = hosted.artifact;
  const reuse = ports.classifyArtifactReuse(artifact, observedAt);
  if (!reuse.actionEvidenceCandidate || artifact.evidence.status !== 'passed') throw new Error(`Hosted integration requires reusable passed Action Evidence: ${reuse.reason}`);
  if (candidate.state !== 'OPEN' || candidate.baseSha !== artifact.session.baseSha || candidate.baseTreeSha !== artifact.session.baseTreeSha
      || candidate.headSha !== artifact.session.headSha || candidate.headTreeSha !== artifact.session.headTreeSha || candidate.isDraft || candidate.isCrossRepository) {
    throw new Error('Hosted integration OPEN candidate identity drifted.');
  }
  const manifestSource = await ports.readManifest(repository, candidate.headSha, artifact.session.manifestPath);
  if (ports.manifestDigest(manifestSource) !== artifact.session.manifestDigest) throw new Error('Hosted integration Issue disposition manifest bytes drifted.');
  const manifest = ports.parseManifest(manifestSource, artifact.session.manifestPath);
  const issueDispositionPlan = await ports.observeIssuePlan({ repository, candidate,
    manifestPath: artifact.session.manifestPath, manifestDigest: artifact.session.manifestDigest, tracking: manifest.tracking });
  const integrationPrincipalNodeId = input.integrationPrincipal.nodeId;
  const barrier = await ports.observeReviewBarrier({ repository, prNumber: artifact.session.prNumber,
    headSha: artifact.session.headSha, excludedPrincipalNodeIds: new Set([candidate.authorNodeId, integrationPrincipalNodeId]) });
  if (barrier.status !== 'clear') throw new Error(`Hosted integration Review barrier ${barrier.status}: ${barrier.status === 'provider-schema-unsupported' ? barrier.reasonCode : barrier.reason}`);
  const preMergeReview = ports.createReviewReceipt({ stage: 'pre-merge', session: artifact.session,
    scope: artifact.scopeAuthorization, barrier, candidateAuthorNodeId: candidate.authorNodeId, integrationPrincipalNodeId,
    expiresAt: ports.addSeconds(barrier.observedAt, 300), operationId: ports.rawDigest(`${artifact.session.sessionRevision}:pre-merge-review`) });
  const changedPaths = (await ports.observeChangedPaths({ repository, prNumber: artifact.session.prNumber,
    state: 'OPEN', draft: false, baseSha: artifact.session.baseSha, headSha: artifact.session.headSha })).paths;
  const comparison = await ports.observeComparison(repository, candidate.baseSha, candidate.headSha);
  const count = await ports.observeOpenPullRequestCountForHead(repository, candidate.headSha);
  if (count !== 1 || comparison.behindBy !== 0 || (comparison.status !== 'ahead' && comparison.status !== 'identical')) throw new Error('Hosted integration candidate ancestry or same-head PR identity is not mergeable.');
  const issuedAt = barrier.observedAt;
  const expiresAt = ports.addSeconds(issuedAt, 300);
  const mainHealth = ports.compileMainHealth({ repository, mainSha: candidate.baseSha, mainTreeSha: candidate.baseTreeSha,
    trustRevision: artifact.session.trustRevision, observedAt: issuedAt, expiresAt,
    checks: await ports.observeChecks(repository, candidate.baseSha) });
  const consumptionOperationId = ports.mergeOperationId({ sessionRevision: artifact.session.sessionRevision,
    headSha: artifact.session.headSha, actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest });
  const mergeInput = ports.createMergeInput({ artifact, preMergeReview, hostedArtifactOrigin: hosted.origin,
    hostedArtifactTransport: hosted.transport, candidate: { repository, prNumber: artifact.session.prNumber, draft: false,
      headOpenPullRequestCount: 1, currentBaseSha: candidate.baseSha, currentBaseTreeSha: candidate.baseTreeSha,
      headSha: candidate.headSha, headTreeSha: candidate.headTreeSha, baseIsAncestor: true, behindBy: 0,
      manifestPath: artifact.session.manifestPath, manifestDigest: artifact.session.manifestDigest, changedPaths },
    provenance: { workflowPath: '.github/workflows/merge-gate.yml', workflowRef: `.github/workflows/merge-gate.yml@${artifact.session.baseSha}`,
      workflowSha: artifact.session.baseSha, eventName: 'workflow_run', sourceRunId: provenance.runId,
      sourceRunAttempt: provenance.runAttempt, actorNodeId: integrationPrincipalNodeId, actorPermission: input.integrationPrincipal.permission },
    mainHealth, platform: await ports.observePlatformEnforcement(repository), consumptionOperationId, issuedAt, expiresAt });
  return Object.freeze({ result: ports.evaluateMergeGate(mergeInput), changedPaths: Object.freeze([...changedPaths]), issueDispositionPlan });
}

export interface HostedRecoveryPreparationPorts {
  routeIntegration(input: Readonly<{ repository: string; session: VerificationSession; candidate: GitHubCandidateObservation;
    priorEffectStarted: boolean; authorizationPublicationCount: number }>): HostedIntegrationRoute;
  planEffects(route: HostedIntegrationRoute): HostedIntegrationEffectPlan;
  prepareCloseout(input: Readonly<{ number: number; headBranch: string; headSha: string }>): PreparedBranchCloseoutEnvelope;
  materializeRecovery(input: Readonly<{ outputPath: string; repository: string; session: VerificationSession;
    prepared: PreparedBranchCloseoutEnvelope; runId: string; runAttempt: number }>): HostedRecoveryArtifactMaterialization;
  recoveryArtifactFileName: string;
  writePreflight(result: MergeGateResult): void;
  writeProjection(path: string, value: unknown): void;
  resolveOutputPath(path: string): string;
  now(): string;
}

export async function prepareHostedIntegrationRecovery<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, RequestSchema extends string, Tracking, MergeInput, SignalSchema extends string>(input: Readonly<{
    repository: string; outputPath: string;
    hosted: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
  }>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>
    & HostedIntegrationPreflightPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, MergeInput, SignalSchema>
    & HostedIssueDispositionPorts<Tracking, readonly GitHubCheckObservation[]> & HostedRecoveryPreparationPorts): Promise<string> {
  const artifact = input.hosted.artifact;
  if (artifact.session.repository !== input.repository) throw new Error('prepare-integration-hosted repository differs from the authenticated Session artifact.');
  const candidate = await ports.observeCandidate(input.repository, artifact.session.prNumber);
  const candidateRoute = ports.routeIntegration({ repository: input.repository, session: artifact.session, candidate,
    priorEffectStarted: false, authorizationPublicationCount: 0 });
  const output = <Projection extends object>(projection: Projection): string => {
    ports.writeProjection(input.outputPath, projection);
    return JSON.stringify({ ...projection, output: ports.resolveOutputPath(input.outputPath) }, null, 2);
  };
  if (candidateRoute.lane === 'blocked') return output(Object.freeze({ ...candidateRoute, effects: ports.planEffects(candidateRoute), observedAt: ports.now() }));
  const identity = await ports.assertIntegrationIdentity({ repository: input.repository, artifact, session: artifact.session,
    candidate, phase: 'recoveryPreparation' });
  const publications = await ports.observeAuthorizationPublications({ repository: input.repository,
    pullRequestNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision });
  const route = ports.routeIntegration({ repository: input.repository, session: artifact.session, candidate,
    priorEffectStarted: identity.phase.priorEffectStarted, authorizationPublicationCount: publications.length });
  const effects = ports.planEffects(route);
  if (route.lane === 'blocked') return output(Object.freeze({ ...route, effects, observedAt: ports.now() }));
  if (route.lane === 'merged-recovery') {
    const original = await loadMarkerBoundRecovery({ repository: input.repository, session: artifact.session, candidate, publications }, ports);
    return output(Object.freeze({ ...route, effects,
      authorizationPublicationId: original.selected.publication.authorizationPublicationId,
      authorizationCommentId: original.selected.commentId, authorizationReceiptDigest: original.selected.publication.authorizationReceiptDigest,
      recoveryArtifact: Object.freeze({ artifactId: original.recovery.metadata.artifactId, artifactName: original.recovery.metadata.artifactName,
        artifactFileName: ports.recoveryArtifactFileName, artifactDigest: original.recovery.artifact.artifactDigest,
        runId: original.recovery.metadata.runId, runAttempt: original.recovery.metadata.runAttempt }), observedAt: ports.now() }));
  }
  if (!effects.prepareRecoveryArtifact) throw new Error('OPEN hosted integration route did not authorize recovery preparation.');
  const preflight = await evaluateHostedIntegrationPreflight({ repository: input.repository, hosted: input.hosted,
    candidate, provenance: identity.provenance, integrationPrincipal: identity.integrationPrincipal, observedAt: ports.now() }, ports);
  ports.writePreflight(preflight.result);
  const prepared = ports.prepareCloseout({ number: artifact.session.prNumber, headBranch: candidate.headBranch, headSha: artifact.session.headSha });
  const recovery = ports.materializeRecovery({ outputPath: input.outputPath, repository: input.repository,
    session: artifact.session, prepared, runId: identity.provenance.runId, runAttempt: identity.provenance.runAttempt });
  return output(Object.freeze({ ...route, effects, preflightResultDigest: preflight.result.resultDigest,
    recoveryArtifact: Object.freeze({ artifactName: recovery.artifactName, artifactFileName: ports.recoveryArtifactFileName,
      artifactFilePath: recovery.artifactFilePath, artifactDigest: recovery.artifact.artifactDigest }), observedAt: ports.now() }));
}

/** One provider-owned step fact from the authenticated control job readback.
 * The job is still in_progress while this phase runs, so only completed steps
 * are admissible; a job conclusion that does not exist yet is never invented. */
export interface HostedControlStepFact {
  readonly name: string;
  readonly number: number;
  readonly status: string;
  readonly conclusion: string | null;
}

/** The verify phase re-reads what the provider actually recorded for the two
 * closed control steps and, when this attempt produced a recovery artifact,
 * re-downloads the exact provider bytes. Local facts come from this job's own
 * fixed transport slot; provider facts come from the original authenticated
 * job and run attempt. */
export interface HostedRecoveryVerificationPorts {
  readControlStepFacts(): Readonly<{ preparation: HostedControlStepFact; upload: HostedControlStepFact }>;
  readProducedRecoveryTransport(): Readonly<{ artifactName: string;
    recoveryDigest: `sha256:${string}`; preflightDigest: `sha256:${string}` }> | null;
  readRunAttemptRecoveryArtifactNames(): Promise<readonly string[]>;
  readVerifiedHostedRecoveryTransport(input: Readonly<{ expectedArtifactName: string }>): Promise<Readonly<{
    artifactName: string; recoveryDigest: `sha256:${string}`; preflightDigest: `sha256:${string}` }>>;
  writeProjection(path: string, value: unknown): void;
  resolveOutputPath(path: string): string;
  now(): string;
}

/** Read back the exact uploaded branch closeout recovery artifact. The upload
 * step either succeeded over this job's own produced bytes or was skipped
 * because no recovery was produced; both provider facts are asserted, and the
 * provider bytes must equal the original local writer exactly. */
export async function verifyHostedIntegrationRecovery(input: Readonly<{ repository: string; outputPath: string }>,
  ports: HostedRecoveryVerificationPorts): Promise<string> {
  const steps = ports.readControlStepFacts();
  if (steps.preparation.status !== 'completed' || steps.preparation.conclusion !== 'success') {
    throw new Error('verify-integration-recovery requires its completed successful preparation step.');
  }
  const output = <Projection extends object>(projection: Projection): string => {
    ports.writeProjection(input.outputPath, projection);
    return JSON.stringify({ ...projection, output: ports.resolveOutputPath(input.outputPath) }, null, 2);
  };
  const local = ports.readProducedRecoveryTransport();
  if (local === null) {
    if (steps.upload.status !== 'completed' || steps.upload.conclusion !== 'skipped') {
      throw new Error('verify-integration-recovery has no produced recovery while its upload step is not skipped.');
    }
    const names = await ports.readRunAttemptRecoveryArtifactNames();
    if (names.length !== 0) throw new Error('A skipped recovery upload still has a provider artifact for this attempt.');
    return output(Object.freeze({ status: 'verified', lane: 'recovery-absent', repository: input.repository,
      reason: 'upload-skipped-without-provider-artifact', steps, observedAt: ports.now() }));
  }
  if (steps.upload.status !== 'completed' || steps.upload.conclusion !== 'success') {
    throw new Error('verify-integration-recovery produced local recovery without its successful upload step.');
  }
  const verified = await ports.readVerifiedHostedRecoveryTransport({ expectedArtifactName: local.artifactName });
  if (verified.artifactName !== local.artifactName || verified.recoveryDigest !== local.recoveryDigest
      || verified.preflightDigest !== local.preflightDigest) {
    throw new Error('Provider recovery artifact members differ from their original local writer.');
  }
  return output(Object.freeze({ status: 'verified', lane: 'recovery-uploaded', repository: input.repository,
    artifactName: local.artifactName, recoveryDigest: local.recoveryDigest, preflightDigest: local.preflightDigest,
    steps, observedAt: ports.now() }));
}

export interface HostedIntegrationResumeObservationPorts<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus }, SignalSchema extends string> {
  inspectRuntime(session: VerificationSession): TrustedRuntimeProof;
  artifactProvenance(input: Readonly<{
    artifact: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
    artifactText: string; observation: GitHubActionsArtifactObservation;
    actorPermission: TrustedArtifactProvenance['transport']['actorPermission'];
  }>): Promise<TrustedArtifactProvenance>;
  authorizationSource(input: Readonly<{ publication: IntegrationAuthorizationOperationPublication; commentId: number }>): TrustedIntegrationAuthorizationSource;
  authorizationMarkers(input: Readonly<{ sessionRevision: `sha256:${string}`; authorizationId: string;
    authorizationReceiptDigest: `sha256:${string}`; consumptionOperationId: `sha256:${string}`;
    authorizationPublicationId: `sha256:${string}`; authorizationPublicationDigest: `sha256:${string}`; commentId: number }>): readonly string[];
}

/** The application constructs the reducer's business observations. Native
 * ports capture facts; they never hide this state projection in a callback. */
export async function createHostedIntegrationResumeExternal<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus }, RequestSchema extends string, SignalSchema extends string>(input: Readonly<{
    repository: string; hosted: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
    selected: Readonly<{ publication: IntegrationAuthorizationOperationPublication; commentId: number }>;
    recovery: HostedRecoveryArtifactObservation;
  }>, ports: HostedIntegrationResumeObservationPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>
    & HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>
    & Pick<HostedCloseoutPorts<Readonly<{ ledger: MainHealthLedger; observedAt: string; assertCurrent(): Promise<void> }>>, 'observeTerminal' | 'publicationDigest' | 'now'>
    & { addSeconds(instant: string, seconds: number): string }
): Promise<VerificationSessionResumeExternal<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>> {
  const { hosted, selected, recovery } = input;
  const artifact = hosted.artifact;
  const result = selected.publication.result;
  const provenance = await ports.artifactProvenance({ artifact, artifactText: hosted.originText,
    observation: hosted.originMetadata, actorPermission: hosted.originMetadata.actorPermission });
  const source = ports.authorizationSource(selected);
  return {
    now: ports.now, expiresAt: ports.addSeconds, trustedRuntimeProof: ports.inspectRuntime,
    runLocalActions: () => artifact.evidence.status === 'passed'
      ? { status: 'passed', resultDigest: artifact.evidence.evidenceDigest as `sha256:${string}` }
      : { status: 'failed', reason: `hosted Action evidence is ${artifact.evidence.status}` },
    hostedArtifact: () => ({ artifact, provenance }), saveReviewReceipt: () => undefined,
    integrationAuthorizationArtifact: () => source,
    integrationAuthorizationPublication: () => ({ authorizationId: selected.publication.authorizationId,
      authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
      consumptionOperationId: selected.publication.consumptionOperationId,
      authorizationPublicationId: selected.publication.authorizationPublicationId,
      authorizationPublicationDigest: selected.publication.publicationDigest, commentId: selected.commentId,
      preparationDigest: recovery.prepared.preparation.preparationDigest }),
    consumedAuthorizationIds: async () => {
      const candidate = await ports.observeCandidate(input.repository, artifact.session.prNumber);
      if (candidate.state !== 'MERGED' || candidate.mergeCommitMessage === null) return new Set<string>();
      const markers = ports.authorizationMarkers({ sessionRevision: artifact.session.sessionRevision,
        authorizationId: selected.publication.authorizationId, authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        consumptionOperationId: selected.publication.consumptionOperationId, authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationPublicationDigest: selected.publication.publicationDigest, commentId: selected.commentId });
      const lines = candidate.mergeCommitMessage.split(/\r?\n/u);
      return markers.every(marker => lines.includes(marker)) ? new Set([selected.publication.authorizationId]) : new Set<string>();
    },
    observeCloseoutPreparation: () => ({ status: 'prepared', preparationDigest: recovery.prepared.preparation.preparationDigest }),
    observeCloseoutBinding: (_authorization, session, merged) => {
      if (merged.mergeCommitSha === null || merged.mergeCommitTreeSha === null) return { status: 'waiting', reason: 'exact merge readback is unavailable' };
      return { status: 'available', binding: ports.createCloseoutBinding({ integrationAuthorization: result.authorization,
        preparation: recovery.prepared.preparation, newMainSha: merged.mergeCommitSha,
        newMainTreeSha: merged.mergeCommitTreeSha, candidateTreeSha: session.headTreeSha }) };
    },
    observeCloseout: async binding => {
      const terminal = await ports.observeTerminal({ repository: input.repository, pullRequestNumber: artifact.session.prNumber,
        closeoutOperationId: binding.closeoutOperationId });
      if (terminal === null) return { status: 'waiting', reason: 'terminal remote closeout publication is unavailable' };
      const status = terminal.publication.receipt.closeoutStatus;
      if (status === 'blocked' || status === 'residue') return { status: 'blocked', reason: `branch closeout terminal ${status}` };
      return { status, receiptDigest: ports.publicationDigest({ closeoutOperationId: binding.closeoutOperationId,
        publicationDigest: terminal.publication.publicationDigest, commentId: terminal.commentId }) };
    }
  };
}

export interface HostedIntegrationEffectPorts<Reconciliation extends Readonly<{ status: string }>> {
  capturePreflight(): MergeGateResult;
  expectedPreflightDigest: string | undefined;
  captureOriginalPrepared(input: Readonly<{ outputPath: string; providerRecovery: HostedRecoveryArtifactObservation }>): PreparedBranchCloseoutEnvelope;
  createAuthorizationPublication(input: Readonly<{ result: MergeGateResult; closeoutPreparation: PreparedBranchCloseoutEnvelope;
    recoveryArtifact: IntegrationAuthorizationOperationPublication['recoveryArtifact']; provenance: HostedWorkflowCommentProvenance }>): IntegrationAuthorizationOperationPublication;
  publishAuthorization(publication: IntegrationAuthorizationOperationPublication): Promise<HostedIntegrationAuthorizationPublicationReadback>;
  executeSquashMerge(input: Readonly<{ repository: string; prNumber: number; headSha: string; sessionRevision: `sha256:${string}`;
    publication: IntegrationAuthorizationOperationPublication; commentId: number; issueDispositionPlan: IssueDispositionPlan }>): Promise<HostedSquashMergeResponse>;
  assertMergeCompletion(input: Readonly<{ candidate: GitHubCandidateObservation; expectedBaseSha: string;
    expectedHeadSha: string; expectedHeadTreeSha: string; markers: readonly string[]; reviewReceipt: ReviewStabilityReceipt;
    expectedTitle: string; providerMergeCommitSha: string | null }>): void;
  synchronizeDefault(): Readonly<{ defaultSha: string }>;
  assertBoundMain(input: Readonly<{ repository: string; session: VerificationSession; candidate: GitHubCandidateObservation;
    lane: 'open-first-effect' | 'merged-recovery'; liveMainSha: string }>): string;
  observeUnexpectedIssueClosures(input: Readonly<{ repository: string; prNumber: number; mergeCommitSha: string }>): readonly Reconciliation[];
}

function assertIntegrationPreflightControls(input: Readonly<{ frozen: MergeGateResult; fresh: MergeGateResult; now: string }>): void {
  const stableFields = [
    'consumptionOperationId', 'repository', 'prNumber', 'sessionRevision', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha',
    'manifestDigest', 'scopeAuthorizationRevision', 'scopeAuthorizationReceiptDigest', 'actionClosureDigest', 'evidenceDigest', 'trustRevision', 'rulesetDigest'
  ] as const;
  for (const field of stableFields) {
    if (input.frozen.authorization[field] !== input.fresh.authorization[field]) throw new Error(`integrate-hosted frozen preflight ${field} drifted before effect.`);
  }
  if (input.frozen.authorization.expiresAt <= input.now) throw new Error('integrate-hosted frozen preflight expired before effect.');
}

export async function integrateHostedSession<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus },
  RequestSchema extends string, Tracking, MergeInput, Reconciliation extends Readonly<{ status: string }>,
  EventSchema extends string, ClaimSchema extends string, Transition,
  Health extends Readonly<{ allowed: boolean; status: string; reason: string }>, SignalSchema extends string>(input: Readonly<{
    repositoryRoot: string; repository: string; outputPath: string;
    hosted: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
    resumeGitHub: VerificationSessionResumeGitHub<VerificationSessionHostedRequest<RequestSchema>>;
    observationResumePorts: VerificationSessionResumePorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult,
      EventSchema, ClaimSchema, VerificationSessionHostedRequest<RequestSchema>, Transition, Health, SignalSchema>;
    effectGuardResumePorts: VerificationSessionResumePorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult,
      EventSchema, ClaimSchema, VerificationSessionHostedRequest<RequestSchema>, Transition, Health, SignalSchema>;
    durableResumePorts: VerificationSessionResumePorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult,
      EventSchema, ClaimSchema, VerificationSessionHostedRequest<RequestSchema>, Transition, Health, SignalSchema>;
  }>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>
    & HostedIntegrationPreflightPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, MergeInput, SignalSchema>
    & HostedIssueDispositionPorts<Tracking, readonly GitHubCheckObservation[]> & HostedRecoveryPreparationPorts
    & HostedIntegrationResumeObservationPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>
    & HostedIntegrationEffectPorts<Reconciliation>
    & Pick<HostedCloseoutPorts<Readonly<{ ledger: MainHealthLedger; observedAt: string; assertCurrent(): Promise<void> }>>, 'observeTerminal' | 'publicationDigest'>): Promise<string> {
  const artifact = input.hosted.artifact;
  const session = artifact.session;
  if (session.repository !== input.repository) throw new Error('integrate-hosted repository differs from the authenticated Session artifact.');
  let candidate = await ports.observeCandidate(input.repository, session.prNumber);
  let boundPostMergeMainSha: string | null = null;
  if (candidate.state === 'MERGED') boundPostMergeMainSha = ports.assertBoundMain({ repository: input.repository,
    session, candidate, lane: 'merged-recovery', liveMainSha: ports.synchronizeDefault().defaultSha });
  const identity = await ports.assertIntegrationIdentity({ repository: input.repository, artifact, session, candidate, phase: 'integration' });
  const attempts = await ports.observeAuthorizationPublications({ repository: input.repository, pullRequestNumber: session.prNumber,
    sessionRevision: session.sessionRevision });
  const route = ports.routeIntegration({ repository: input.repository, session, candidate,
    priorEffectStarted: identity.phase.priorEffectStarted, authorizationPublicationCount: attempts.length });
  const effects = ports.planEffects(route);
  if (route.lane === 'blocked') throw new Error(`AMBIGUOUS_SIDE_EFFECT: hosted integration route is blocked: ${route.reason}`);
  const operationId = ports.mergeOperationId({ sessionRevision: session.sessionRevision, headSha: session.headSha,
    actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest });
  let selected: Readonly<{ publication: IntegrationAuthorizationOperationPublication; commentId: number }>;
  let recovery: HostedRecoveryArtifactObservation;
  let ownsMergeStart = false;
  let issueDispositionPlan: IssueDispositionPlan | null = null;
  if (route.lane === 'merged-recovery') {
    const original = await loadMarkerBoundRecovery({ repository: input.repository, session, candidate, publications: attempts }, ports);
    selected = original.selected;
    recovery = original.recovery;
  } else {
    if (!effects.createAuthorizationPublication || !effects.executePhysicalMerge) throw new Error('OPEN hosted integration route did not authorize first-effect execution.');
    if (attempts.some(({ publication }) => publication.consumptionOperationId === operationId || publication.result.authorization.headSha === session.headSha)) {
      throw new Error('AMBIGUOUS_SIDE_EFFECT: OPEN candidate already has a remote authorization start publication.');
    }
    const evaluation = await evaluateHostedIntegrationPreflight({ repository: input.repository, hosted: input.hosted,
      candidate, provenance: identity.provenance, integrationPrincipal: identity.integrationPrincipal, observedAt: ports.now() }, ports);
    issueDispositionPlan = evaluation.issueDispositionPlan;
    const frozen = ports.capturePreflight();
    if (ports.expectedPreflightDigest === undefined || frozen.resultDigest !== ports.expectedPreflightDigest) throw new Error('integrate-hosted downloaded preflight digest differs from the terminal status binding.');
    assertIntegrationPreflightControls({ frozen, fresh: evaluation.result, now: ports.now() });
    if (frozen.authorization.consumptionOperationId !== operationId) throw new Error('Frozen merge-gate preflight changed the stable consumption operation identity.');
    recovery = await ports.captureRecoveryArtifact({ repository: input.repository, session,
      runId: identity.provenance.runId, runAttempt: identity.provenance.runAttempt });
    ports.captureOriginalPrepared({ outputPath: input.outputPath, providerRecovery: recovery });
    const publication = ports.createAuthorizationPublication({ result: frozen, closeoutPreparation: recovery.remotePrepared,
      recoveryArtifact: { artifactId: recovery.metadata.artifactId, artifactName: recovery.metadata.artifactName,
        artifactFileName: ports.recoveryArtifactFileName as IntegrationAuthorizationOperationPublication['recoveryArtifact']['artifactFileName'],
        artifactDigest: recovery.artifact.artifactDigest, runId: recovery.metadata.runId, runAttempt: recovery.metadata.runAttempt }, provenance: identity.provenance });
    const published = await ports.publishAuthorization(publication);
    if (published.status !== 'published' || !published.createdByThisInvocation || published.publication === null || published.commentId === null) {
      throw new Error(`AMBIGUOUS_SIDE_EFFECT: Integration authorization start publication was not newly and exactly created: ${published.detail}`);
    }
    const owner = published.publication.provenance;
    if (owner.runId !== identity.provenance.runId || owner.runAttempt !== identity.provenance.runAttempt
        || owner.workflowRef !== identity.provenance.workflowRef || owner.actorNodeId !== identity.provenance.actorNodeId) throw new Error('AMBIGUOUS_SIDE_EFFECT: authorization start publication owner differs from this hosted invocation.');
    selected = Object.freeze({ publication: published.publication, commentId: published.commentId });
    ownsMergeStart = true;
  }
  const external = await createHostedIntegrationResumeExternal({ repository: input.repository, hosted: input.hosted, selected, recovery }, ports);
  const changedPaths = route.lane === 'merged-recovery' ? artifact.scopeAuthorization.authorizedPaths
    : (await ports.observeChangedPaths({ repository: input.repository, prNumber: session.prNumber, state: 'OPEN', draft: false,
      baseSha: session.baseSha, headSha: session.headSha })).paths;
  const resumeInput = { repositoryRoot: input.repositoryRoot, session, scopeAuthorization: artifact.scopeAuthorization,
    changedPaths, integrationPrincipalNodeId: selected.publication.result.provenance.actorNodeId, github: input.resumeGitHub, external };
  let result: VerificationSessionRuntimeOutcome = await resumeVerificationSession(resumeInput, input.observationResumePorts);
  const reconcile = (merged: GitHubCandidateObservation) => {
    if (merged.state !== 'MERGED' || merged.mergeCommitSha === null || merged.mergeCommitMessage === null
        || ports.markerState(merged.mergeCommitMessage) === 'absent') return Object.freeze({ status: 'no-disposition-markers', results: Object.freeze([]) });
    const results = ports.observeUnexpectedIssueClosures({ repository: input.repository, prNumber: session.prNumber, mergeCommitSha: merged.mergeCommitSha });
    const nonNoOp = results.filter(value => value.status !== 'no-op');
    return Object.freeze({ status: nonNoOp.length === 0 ? 'no-op' : nonNoOp.some(value => value.status === 'blocked') ? 'blocked' : 'manual-action-required', results });
  };
  let issueReconciliation = candidate.state === 'MERGED' ? reconcile(candidate) : null;
  const publishProjection = (status: string, reason: string, merged: GitHubCandidateObservation): string => {
    const projection = Object.freeze({ schema: 'sec-verification-session-integration-projection-v1',
      repository: input.repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision, lane: route.lane, effects,
      authorizationId: selected.publication.authorizationId, authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
      authorizationPublicationId: selected.publication.authorizationPublicationId, authorizationCommentId: selected.commentId,
      status, issueDispositionPlan, issueReconciliation, boundPostMergeMainSha,
      mergedCommitSha: merged.state === 'MERGED' ? merged.mergeCommitSha : null,
      mergedCommitTreeSha: merged.state === 'MERGED' ? merged.mergeCommitTreeSha : null, candidateTreeSha: session.headTreeSha,
      completedStage: result.completedStage, receiptDigest: result.receiptDigest, reason,
      closeoutResponsibility: merged.state === 'MERGED' && status === 'READY_TO_CLOSEOUT'
        ? Object.freeze({ mutation: 'pending', publication: 'pending' }) : null, observedAt: ports.now() });
    ports.writeProjection(input.outputPath, projection);
    return JSON.stringify({ ...projection, output: ports.resolveOutputPath(input.outputPath) }, null, 2);
  };
  const assertReconciled = (merged: GitHubCandidateObservation): void => {
    if (issueReconciliation?.status === 'manual-action-required' || issueReconciliation?.status === 'blocked') {
      publishProjection('BLOCKED', 'external-maintainer-action-required: unexpected GitHub Issue closure requires reconciliation before closeout.', merged);
      throw new Error('external-maintainer-action-required: unexpected GitHub Issue closure blocks MainHealth and branch closeout.');
    }
  };
  assertReconciled(candidate);
  if (result.status === 'READY_TO_INTEGRATE') {
    if (!effects.executePhysicalMerge || !ownsMergeStart) throw new Error('AMBIGUOUS_SIDE_EFFECT: this hosted invocation does not own a newly published merge start claim.');
    candidate = await ports.observeCandidate(input.repository, session.prNumber);
    if (candidate.state !== 'OPEN' || candidate.baseSha !== session.baseSha || candidate.baseTreeSha !== session.baseTreeSha
        || candidate.headSha !== session.headSha || candidate.headTreeSha !== session.headTreeSha) throw new Error('integrate-hosted candidate drifted immediately before physical merge.');
    const fresh = await resumeVerificationSession(resumeInput, input.effectGuardResumePorts);
    if (fresh.status !== 'READY_TO_INTEGRATE' || fresh.operationId !== selected.publication.result.authorization.consumptionOperationId) throw new Error(`integrate-hosted effect guard changed before merge: ${fresh.status} ${fresh.reason}`);
    const manifest = ports.parseManifest(await ports.readManifest(input.repository, session.headSha, session.manifestPath), session.manifestPath);
    const immediatePlan = await ports.observeIssuePlan({ repository: input.repository, candidate, manifestPath: session.manifestPath,
      manifestDigest: session.manifestDigest, tracking: manifest.tracking });
    if (issueDispositionPlan === null || immediatePlan.planDigest !== issueDispositionPlan.planDigest) throw new Error('integrate-hosted Issue disposition plan drifted immediately before merge.');
    const markers = ports.authorizationMarkers({ sessionRevision: session.sessionRevision, authorizationId: selected.publication.authorizationId,
      authorizationReceiptDigest: selected.publication.authorizationReceiptDigest, consumptionOperationId: selected.publication.consumptionOperationId,
      authorizationPublicationId: selected.publication.authorizationPublicationId, authorizationPublicationDigest: selected.publication.publicationDigest,
      commentId: selected.commentId });
    const issueMarkers = [`Issue-Disposition-Plan: ${issueDispositionPlan.planDigest}`, `Issue-Disposition-Mode: ${issueDispositionPlan.mode}`,
      `Issue-Disposition-Tracking: ${issueDispositionPlan.trackingIssueNumber ?? 'none'}`, `Issue-Disposition-Prose: ${issueDispositionPlan.titleBodyDigest}`];
    let response: HostedSquashMergeResponse | null = null;
    let failure: Readonly<{ error: unknown }> | undefined;
    try { response = await ports.executeSquashMerge({ repository: input.repository, prNumber: session.prNumber, headSha: session.headSha,
      sessionRevision: session.sessionRevision, publication: selected.publication, commentId: selected.commentId, issueDispositionPlan }); }
    catch (error) { failure = Object.freeze({ error }); }
    let merged: GitHubCandidateObservation;
    try {
      merged = await ports.observeCandidate(input.repository, session.prNumber);
      ports.assertMergeCompletion({ candidate: merged, expectedBaseSha: session.baseSha, expectedHeadSha: session.headSha,
        expectedHeadTreeSha: session.headTreeSha, markers: [...markers, ...issueMarkers], reviewReceipt: selected.publication.result.reviewReceipt,
        expectedTitle: `Verified integration ${session.sessionRevision.slice(7, 19)}`, providerMergeCommitSha: response?.sha ?? null });
    } catch (error) {
      const providerReason = failure === undefined ? 'provider reported success' : failureMessage(failure.error);
      const readbackReason = failureMessage(error);
      const cause = failure === undefined ? error : new ResourceCompositeSettlementError([
        { label: 'hosted-merge-provider', error: failure.error },
        { label: 'hosted-merge-exact-readback', error }
      ]);
      throw new Error('AMBIGUOUS_SIDE_EFFECT: synchronous hosted merge attempt requires recovery; ' + `provider=${providerReason}; exact-readback=${readbackReason}`, { cause });
    }
    candidate = merged;
    issueReconciliation = reconcile(merged);
    assertReconciled(merged);
    boundPostMergeMainSha = ports.assertBoundMain({ repository: input.repository, session, candidate: merged,
      lane: 'open-first-effect', liveMainSha: ports.synchronizeDefault().defaultSha });
    result = await resumeVerificationSession(resumeInput, input.durableResumePorts);
  }
  candidate = await ports.observeCandidate(input.repository, session.prNumber);
  if (issueReconciliation === null) issueReconciliation = reconcile(candidate);
  assertReconciled(candidate);
  if (candidate.state === 'MERGED') {
    // This invocation has no mutation phase capability. Later closed phases
    // obtain their own current native qualification and complete the debt.
    if (result.status === 'READY_TO_CLOSEOUT' || result.status === 'WAITING_CLOSEOUT') {
      return publishProjection('READY_TO_CLOSEOUT', 'Exact merge is observed; mutation and authenticated terminal publication remain pending.', candidate);
    }
    return publishProjection(result.status, result.reason, candidate);
  }
  return publishProjection(result.status, result.reason, candidate);
}

/** Application owns transport selection and cross-owner recovery joins. Each
 * capture/validator below retains its original native parser and issuer. */
export interface HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, RequestSchema extends string, SignalSchema extends string> {
  encodeData(value: unknown): string;
  observeArtifactsForRun(repository: string, runId: string): Promise<readonly GitHubActionsArtifactObservation[]>;
  captureSessionArtifact(input: Readonly<{
    repository: string; metadata: GitHubActionsArtifactObservation;
    request?: VerificationSessionHostedRequest<RequestSchema>;
  }>): Promise<HostedSessionArtifactCapture<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>>;
  artifactName(input: Readonly<{ prNumber: number; sessionRevision: `sha256:${string}`;
    runId: string; runAttempt: number }>): string;
  compareRunIdsDescending(left: string, right: string): number;
  observeCandidate(repository: string, prNumber: number): Promise<GitHubCandidateObservation>;
  assertIntegrationIdentity(input: Readonly<{ repository: string; artifact: HostedSessionTerminalArtifact<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>; session: VerificationSession;
    candidate: GitHubCandidateObservation; phase: HostedIntegrationPhase }>): Promise<HostedIntegrationIdentity>;
  observeAuthorizationPublications(input: Readonly<{ repository: string; pullRequestNumber: number;
    sessionRevision: `sha256:${string}` }>): Promise<readonly Readonly<{
      commentId: number; publication: IntegrationAuthorizationOperationPublication;
    }>[] >;
  selectMergedAuthorization(input: Readonly<{ candidate: GitHubCandidateObservation;
    sessionRevision: `sha256:${string}`; publications: readonly Readonly<{
      commentId: number; publication: IntegrationAuthorizationOperationPublication;
    }>[] }>): Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublication }>;
  assertAuthorizationMatchesSession(input: Readonly<{ publication: IntegrationAuthorizationOperationPublication;
    repository: string; session: VerificationSession }>): void;
  captureRecoveryArtifact(input: Readonly<{ repository: string; session: VerificationSession;
    runId: string; runAttempt: number }>): Promise<HostedRecoveryArtifactObservation>;
  createCloseoutBinding(input: Readonly<{
    integrationAuthorization: IntegrationAuthorizationOperationPublication['result']['authorization'];
    preparation: HostedRecoveryArtifactObservation['prepared']['preparation'];
    newMainSha: string; newMainTreeSha: string; candidateTreeSha: string;
  }>): BranchCloseoutOperationBinding;
}

export async function selectHostedSessionArtifact<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, RequestSchema extends string, SignalSchema extends string>(input: Readonly<{
    repository: string; transports: readonly GitHubActionsArtifactObservation[];
    request?: VerificationSessionHostedRequest<RequestSchema>; requireSingleTransport?: boolean;
  }>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>
): Promise<HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema> | null> {
  const { repository, request } = input;
  const exactPrefix = request === undefined ? 'sec-verification-session-v2-pr-'
    : `sec-verification-session-v2-pr-${request.prNumber}-session-${request.expectedSessionRevision.slice(7)}-run-`;
  const candidates = input.transports.filter(entry => !entry.expired && entry.artifactName.startsWith(exactPrefix));
  if (candidates.length === 0) return null;
  if (input.requireSingleTransport === true && candidates.length !== 1) {
    throw new Error('Expected exactly one trusted Session artifact on the triggering compiler run.');
  }
  const identities = new Set<string>();
  const loaded: HostedSessionArtifactCapture<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>[] = [];
  for (const metadata of candidates) {
    const identity = `${metadata.runId}:${metadata.runAttempt}`;
    if (identities.has(identity)) throw new Error('Duplicate hosted Session artifact transport identity.');
    identities.add(identity);
    loaded.push(await ports.captureSessionArtifact({ repository, metadata,
      ...(request === undefined ? {} : { request }) }));
  }
  const canonicalText = loaded[0]!.artifactText;
  if (loaded.some(entry => entry.artifactText !== canonicalText)) {
    throw new Error('Hosted Session artifact transports for one Session are not byte-identical.');
  }
  const selected = [...loaded].sort((left, right) =>
    ports.compareRunIdsDescending(left.metadata.runId, right.metadata.runId)
      || right.metadata.runAttempt - left.metadata.runAttempt)[0]!;
  const producer = selected.artifact.producer;
  const originName = ports.artifactName({ prNumber: selected.artifact.session.prNumber,
    sessionRevision: selected.artifact.session.sessionRevision, runId: producer.runId, runAttempt: producer.runAttempt });
  const originCandidates = (await ports.observeArtifactsForRun(repository, producer.runId))
    .filter(entry => !entry.expired && entry.artifactName === originName);
  if (originCandidates.length !== 1) throw new Error('Expected exactly one immutable origin Session artifact.');
  const origin = await ports.captureSessionArtifact({ repository, metadata: originCandidates[0]!,
    ...(request === undefined ? {} : { request }) });
  if (origin.artifactText !== canonicalText || origin.artifact.artifactDigest !== selected.artifact.artifactDigest
      || origin.metadata.runId !== producer.runId || origin.metadata.runAttempt !== producer.runAttempt
      || origin.metadata.workflowPath !== producer.workflowPath || origin.metadata.workflowRef !== producer.workflowRef
      || origin.metadata.workflowSha !== producer.workflowSha || origin.metadata.actorNodeId !== producer.actorNodeId) {
    throw new Error('Hosted artifact origin and trusted transport provenance are not byte-identical.');
  }
  const sameRun = origin.metadata.runId === selected.metadata.runId && origin.metadata.runAttempt === selected.metadata.runAttempt;
  if (sameRun !== (origin.metadata.artifactId === selected.metadata.artifactId)) {
    throw new Error('Hosted artifact direct versus reuploaded identity is inconsistent.');
  }
  return Object.freeze({ artifact: selected.artifact, origin: origin.observation, transport: selected.observation,
    originMetadata: origin.metadata, transportMetadata: selected.metadata,
    originText: origin.artifactText, transportText: selected.artifactText });
}

export async function selectHostedArtifactForMergeWakeup<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string, GateResult extends { readonly status: ResultStatus }, RequestSchema extends string, SignalSchema extends string>(input: Readonly<{
    repository: string; sourceRunId: string; sourceRunAttempt: number;
  }>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>) {
  const selected = await selectHostedSessionArtifact({ repository: input.repository,
    transports: await ports.observeArtifactsForRun(input.repository, input.sourceRunId), requireSingleTransport: true }, ports);
  if (selected === null || selected.transportMetadata.runId !== input.sourceRunId
      || selected.transportMetadata.runAttempt !== input.sourceRunAttempt) {
    throw new Error('Triggering compiler run does not contain the exact trusted Session transport.');
  }
  return selected;
}

export async function loadMarkerBoundRecovery<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, RequestSchema extends string, SignalSchema extends string>(input: Readonly<{
    repository: string; session: VerificationSession; candidate: GitHubCandidateObservation;
    publications: readonly Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublication }>[];
  }>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>) {
  const selected = ports.selectMergedAuthorization({ candidate: input.candidate,
    sessionRevision: input.session.sessionRevision, publications: input.publications });
  ports.assertAuthorizationMatchesSession({ publication: selected.publication,
    repository: input.repository, session: input.session });
  const recovery = await ports.captureRecoveryArtifact({ repository: input.repository, session: input.session,
    runId: selected.publication.recoveryArtifact.runId, runAttempt: selected.publication.recoveryArtifact.runAttempt });
  const remotePreparationDigest = recovery.remotePrepared.preparation.preparationDigest;
  if (recovery.metadata.artifactId !== selected.publication.recoveryArtifact.artifactId
      || recovery.metadata.artifactName !== selected.publication.recoveryArtifact.artifactName
      || recovery.artifact.artifactDigest !== selected.publication.recoveryArtifact.artifactDigest
      || recovery.remotePrepared.envelopeDigest !== selected.publication.closeoutPreparation.envelopeDigest
      || ports.encodeData(recovery.remotePrepared) !== ports.encodeData(selected.publication.closeoutPreparation)
      || remotePreparationDigest !== recovery.prepared.preparation.preparationDigest
      || remotePreparationDigest !== selected.publication.closeoutPreparation.preparation.preparationDigest) {
    throw new Error('Marker-bound recovery artifact differs from the original authorization publication.');
  }
  return Object.freeze({ selected, recovery });
}

export async function loadMergedHostedCloseout<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, RequestSchema extends string, SignalSchema extends string>(input: Readonly<{
    repository: string; hosted: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
    phase: 'closeoutMutation' | 'closeoutPublication';
  }>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>) {
  const { hosted } = input;
  const artifact = hosted.artifact;
  if (artifact.session.repository !== input.repository) {
    throw new Error('Hosted closeout repository differs from the authenticated Session artifact.');
  }
  const candidate = await ports.observeCandidate(input.repository, artifact.session.prNumber);
  if (candidate.state !== 'MERGED' || candidate.mergeCommitSha === null || candidate.mergeCommitTreeSha === null
      || candidate.mergeCommitMessage === null || candidate.mergeCommitTreeSha !== artifact.session.headTreeSha) {
    throw new Error('Hosted closeout requires exact marker-bound merged tree parity.');
  }
  const identity = await ports.assertIntegrationIdentity({ repository: input.repository,
    artifact, session: artifact.session, candidate, phase: input.phase });
  const publications = await ports.observeAuthorizationPublications({ repository: input.repository,
    pullRequestNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision });
  const { selected, recovery } = await loadMarkerBoundRecovery({ repository: input.repository,
    session: artifact.session, candidate, publications }, ports);
  const binding = ports.createCloseoutBinding({ integrationAuthorization: selected.publication.result.authorization,
    preparation: recovery.prepared.preparation, newMainSha: candidate.mergeCommitSha,
    newMainTreeSha: candidate.mergeCommitTreeSha, candidateTreeSha: artifact.session.headTreeSha });
  return Object.freeze({ hosted, candidate, identity, selected, recovery, binding });
}

export async function publishHostedCloseout<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, RequestSchema extends string,
  Qualification extends Readonly<{ ledger: MainHealthLedger; observedAt: string; assertCurrent(): Promise<void> }>, SignalSchema extends string
>(input: Readonly<{ repository: string; outputPath: string;
  hosted: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
}>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>
  & HostedCloseoutPorts<Qualification>): Promise<string> {
  const closeout = await loadMergedHostedCloseout({ repository: input.repository,
    hosted: input.hosted, phase: 'closeoutPublication' }, ports);
  const session = closeout.hosted.artifact.session;
  return await ports.withPostMergeHealth(closeout.binding, async health => {
    await health.assertCurrent();
    const existing = await ports.observeTerminal({ repository: input.repository, pullRequestNumber: session.prNumber,
      closeoutOperationId: closeout.binding.closeoutOperationId });
    if (existing !== null) {
      const terminalStatus = existing.publication.receipt.closeoutStatus;
      if (terminalStatus === 'blocked' || terminalStatus === 'residue') {
        throw new Error(`Hosted closeout terminal is ${terminalStatus}; it cannot be promoted to success.`);
      }
      const projection = Object.freeze({ schema: 'sec-verification-session-closeout-publication-v1',
        repository: input.repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
        closeoutOperationId: closeout.binding.closeoutOperationId, disposition: 'reused', closeoutStatus: terminalStatus,
        publicationDigest: existing.publication.publicationDigest, commentId: existing.commentId,
        receiptDigest: ports.publicationDigest({ closeoutOperationId: closeout.binding.closeoutOperationId,
          publicationDigest: existing.publication.publicationDigest, commentId: existing.commentId }), observedAt: ports.now() });
      ports.writeProjection(input.outputPath, projection);
      return JSON.stringify({ ...projection, output: ports.resolveOutputPath(input.outputPath) }, null, 2);
    }
    if (closeout.identity.phase.priorAttemptStarted) {
      throw new Error('AMBIGUOUS_SIDE_EFFECT: a prior closeout publication phase started without an exact terminal comment.');
    }
    const effectStart = await ports.observeEffectStart({ repository: input.repository, pullRequestNumber: session.prNumber,
      closeoutOperationId: closeout.binding.closeoutOperationId });
    if (effectStart === null) {
      throw new Error('Hosted closeout publication requires one exact App-authenticated effect start marker.');
    }
    ports.assertEffectStartMatches({ publication: effectStart.publication, binding: closeout.binding,
      authorizationPublication: { authorizationPublicationId: closeout.selected.publication.authorizationPublicationId,
        publicationDigest: closeout.selected.publication.publicationDigest, commentId: closeout.selected.commentId },
      recoveryArtifact: { artifactId: closeout.recovery.metadata.artifactId,
        artifactName: closeout.recovery.metadata.artifactName, artifactDigest: closeout.recovery.artifact.artifactDigest,
        runId: closeout.recovery.metadata.runId, runAttempt: closeout.recovery.metadata.runAttempt } });
    const terminal = ports.captureOperationReceipt(closeout.recovery.prepared.preparation, closeout.binding.closeoutOperationId);
    if (terminal === null) {
      throw new Error('Hosted closeout publication requires the exact local operation receipt from the mutation phase.');
    }
    if (ports.encodeData(terminal.binding) !== ports.encodeData(closeout.binding)) {
      throw new Error('Hosted closeout operation receipt belongs to a different merged operation.');
    }
    if (terminal.receipt.status === 'blocked' || terminal.receipt.status === 'residue') {
      throw new Error(`Hosted closeout terminal is ${terminal.receipt.status}; publication is forbidden.`);
    }
    await health.assertCurrent();
    const published = await ports.publishTerminal({ operationReceipt: terminal,
      provenance: closeout.identity.provenance, effectStart: Object.freeze({ disposition: 'existing', ...effectStart }), health });
    if (published.publication.closeoutOperationId !== closeout.binding.closeoutOperationId
        || ports.encodeData(published.publication.binding) !== ports.encodeData(terminal.binding)) {
      throw new Error('Hosted closeout publication readback differs from the exact operation receipt.');
    }
    const projection = Object.freeze({ schema: 'sec-verification-session-closeout-publication-v1',
      repository: input.repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
      closeoutOperationId: closeout.binding.closeoutOperationId, disposition: 'published', closeoutStatus: terminal.receipt.status,
      operationReceiptDigest: terminal.operationReceiptDigest, publicationDigest: published.publication.publicationDigest,
      commentId: published.commentId, receiptDigest: ports.publicationDigest({ closeoutOperationId: closeout.binding.closeoutOperationId,
        publicationDigest: published.publication.publicationDigest, commentId: published.commentId }), observedAt: ports.now() });
    ports.writeProjection(input.outputPath, projection);
    return JSON.stringify({ ...projection, output: ports.resolveOutputPath(input.outputPath) }, null, 2);
  });
}

export interface HostedCloseoutMutationPorts<Qualification extends Readonly<{
  ledger: MainHealthLedger; observedAt: string; assertCurrent(): Promise<void>;
}>, WorktreeToken> extends HostedCloseoutPorts<Qualification> {
  consumePreparedWorktrees(input: Readonly<{ prepared: PreparedBranchCloseoutEnvelope;
    binding: BranchCloseoutOperationBinding; health: Qualification }>): Promise<readonly WorktreeToken[]>;
  executeCloseoutEffect(input: Readonly<{ repository: string; pullRequestNumber: number;
    prepared: PreparedBranchCloseoutEnvelope; binding: BranchCloseoutOperationBinding;
    authorizationPublication: BranchCloseoutEffectStartPublication['authorizationPublication'];
    recoveryArtifact: BranchCloseoutEffectStartPublication['recoveryArtifact'];
    provenance: HostedWorkflowCommentProvenance; phase: HostedIntegrationIdentity['phase'];
    health: Qualification; worktreeCleanupTokens: readonly WorktreeToken[];
    foreignWorktreeObservationDigests: readonly `sha256:${string}`[]; now: () => string;
  }>): Promise<Readonly<{ effectStart: HostedCloseoutEffectStartReadback; terminal: BranchCloseoutOperationReceipt }>>;
  operationReceiptPath(preparation: PreparedBranchCloseoutEnvelope['preparation'], operationId: `sha256:${string}`): string;
}

export async function mutateHostedCloseout<SourceAcceptance, SourceAttemptEvidence,
  ContractRevision extends string, ResultStatus extends string,
  GateResult extends { readonly status: ResultStatus }, RequestSchema extends string,
  Qualification extends Readonly<{ ledger: MainHealthLedger; observedAt: string; assertCurrent(): Promise<void> }>,
  WorktreeToken, Tracking, Checks, SignalSchema extends string>(input: Readonly<{ repository: string; outputPath: string;
    hosted: HostedSessionArtifactTransport<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, SignalSchema>;
  }>, ports: HostedSessionPorts<SourceAcceptance, SourceAttemptEvidence, ContractRevision, ResultStatus, GateResult, RequestSchema, SignalSchema>
    & HostedCloseoutMutationPorts<Qualification, WorktreeToken> & HostedIssueDispositionPorts<Tracking, Checks>): Promise<string> {
  const closeout = await loadMergedHostedCloseout({ repository: input.repository, hosted: input.hosted, phase: 'closeoutMutation' }, ports);
  const session = closeout.hosted.artifact.session;
  const issueDisposition = await observeHostedIssueDisposition({ repository: input.repository, session,
    candidate: closeout.candidate, evidenceDigest: closeout.hosted.artifact.evidence.evidenceDigest,
    authorization: closeout.selected.publication, observedAt: ports.now() }, ports);
  return await ports.withPostMergeHealth(closeout.binding, async health => {
    await health.assertCurrent();
    const existing = await ports.observeTerminal({ repository: input.repository, pullRequestNumber: session.prNumber,
      closeoutOperationId: closeout.binding.closeoutOperationId });
    if (existing !== null) {
      const status = existing.publication.receipt.closeoutStatus;
      if (status === 'blocked' || status === 'residue') throw new Error(`Hosted closeout terminal is ${status}; it cannot be promoted to success.`);
      const projection = Object.freeze({ schema: 'sec-verification-session-closeout-mutation-v1',
        repository: input.repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
        closeoutOperationId: closeout.binding.closeoutOperationId, issueDisposition, disposition: 'reused-terminal',
        closeoutStatus: status, publicationDigest: existing.publication.publicationDigest,
        closeoutCommentId: existing.commentId, observedAt: ports.now() });
      ports.writeProjection(input.outputPath, projection);
      return JSON.stringify({ ...projection, output: ports.resolveOutputPath(input.outputPath) }, null, 2);
    }
    const prepared = closeout.recovery.prepared;
    const foreignWorktreeObservationDigests = prepared.foreignWorktreeObservations.map(({ observationDigest }) => observationDigest);
    const targetCount = new Set(prepared.preparation.worktreePathsAtPreparation).size;
    const worktreeCleanupTokens = await routePreparedWorktreeCleanupAttempt({ foreignWorktreeObservationDigests, targetCount,
      consumeLocalPreparedTargets: () => ports.consumePreparedWorktrees({ prepared, binding: closeout.binding, health }) });
    await health.assertCurrent();
    const { effectStart, terminal } = await ports.executeCloseoutEffect({ repository: input.repository,
      pullRequestNumber: session.prNumber, prepared, binding: closeout.binding,
      authorizationPublication: { authorizationPublicationId: closeout.selected.publication.authorizationPublicationId,
        publicationDigest: closeout.selected.publication.publicationDigest, commentId: closeout.selected.commentId },
      recoveryArtifact: { artifactId: closeout.recovery.metadata.artifactId, artifactName: closeout.recovery.metadata.artifactName,
        artifactDigest: closeout.recovery.artifact.artifactDigest, runId: closeout.recovery.metadata.runId,
        runAttempt: closeout.recovery.metadata.runAttempt }, provenance: closeout.identity.provenance,
      phase: closeout.identity.phase, health, worktreeCleanupTokens, foreignWorktreeObservationDigests, now: ports.now });
    if (ports.encodeData(terminal.binding) !== ports.encodeData(closeout.binding)) throw new Error('Hosted closeout terminal receipt binding differs from the exact merged operation.');
    if (terminal.receipt.status === 'blocked' || terminal.receipt.status === 'residue') throw new Error(`Hosted closeout terminal is ${terminal.receipt.status}; publication is forbidden.`);
    const projection = Object.freeze({ schema: 'sec-verification-session-closeout-mutation-v1',
      repository: input.repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
      closeoutOperationId: closeout.binding.closeoutOperationId, issueDisposition,
      disposition: effectStart.disposition === 'existing' ? 'recovered-after-effect-start' : 'executed',
      effectStartId: effectStart.publication.effectStartId, effectStartPublicationDigest: effectStart.publication.publicationDigest,
      effectStartCommentId: effectStart.commentId, closeoutStatus: terminal.receipt.status,
      operationReceiptDigest: terminal.operationReceiptDigest,
      operationReceiptPath: ports.resolveOutputPath(ports.operationReceiptPath(prepared.preparation, closeout.binding.closeoutOperationId)),
      observedAt: ports.now() });
    ports.writeProjection(input.outputPath, projection);
    return JSON.stringify({ ...projection, output: ports.resolveOutputPath(input.outputPath) }, null, 2);
  });
}
