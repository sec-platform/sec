import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ciVerificationHostedJobTransportSlot } from '../../../adapters/providers/github-api/contract/hosted-job-policy.ts';
import { HOSTED_RESUME_SIGNAL_SCHEMA } from '../../../adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, type AuthenticatedGitHubJobOrigin } from '../../../adapters/providers/github-api/hosted-job-origin.ts';
import { dispatchAuthenticatedHostedJobResume, observeAuthenticatedHostedResumeEmitter } from '../../../adapters/providers/github-api/operation-session.ts';
import { assertBranchCloseoutOperationBinding, BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME, createBranchCloseoutOperationBinding, parseBranchCloseoutOperationReceipt, parseBranchCloseoutRecoveryArtifact } from '../../../adapters/self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { assertBranchCloseoutEffectStartMatches, observeBranchCloseoutEffectStartPublication, observeBranchCloseoutOperationPublication } from '../../../adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { operationReceiptFilePath, prepareMergedPullRequestCloseout } from '../../../adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { withAuthenticatedPostMergeMainHealth } from '../../../adapters/self-hosting/control/composition/trusted-runtime-closeout.ts';
import { assertIntegrationAuthorizationUsable } from '../../../adapters/self-hosting/control/integration/authorization.ts';
import { createIntegrationAuthorizationOperationPublication, observeIntegrationAuthorizationOperationPublications } from '../../../adapters/self-hosting/control/integration/integration-authorization-publication.ts';
import { assertCanonicalMergeMessage, CodexDevelopmentEvaluateMergeGate, CodexDevelopmentParseMergeGateResult } from '../../../adapters/self-hosting/control/integration/merge-gate.ts';
import { SEC_INTEGRATION_PLATFORM_POLICY_DIGEST } from '../../../adapters/self-hosting/control/integration/platform-policy.ts';
import { compileIssueDisposition, createIssueAcceptanceId } from '../../../adapters/self-hosting/control/issues/disposition.ts';
import { observeGitHubIssue, observeUnexpectedGitHubIssueClosures } from '../../../adapters/self-hosting/control/issues/issue-disposition-github.ts';
import { createMainHealthLedger, resolveOrdinaryMainHealthLane } from '../../../adapters/self-hosting/control/main-health/contract.ts';
import { createObservedMainHealthInput } from '../../../adapters/self-hosting/control/main-health/main-health-observation.ts';
import { prepareTrustedRuntimeRecoveryMainHealthPlan } from '../../../adapters/self-hosting/control/main-health/post-merge-plan.ts';
import { CI_MAIN_HEALTH_POLICY } from '../../../adapters/self-hosting/control/main-health/provider-policy.ts';
import { assertScopeAuthorizationCurrent, parseScopeAuthorization } from '../../../adapters/self-hosting/control/scope/authorization.ts';
import { CodexDevelopmentAssertWorkPackageOwnership, CodexDevelopmentParseCurrentWorkPackageManifest, CodexDevelopmentParseWorkPackageLocator, CodexDevelopmentWorkPackageManifestDigest } from '../../../adapters/self-hosting/control/task/contract/work-package.ts';
import { encodeVerificationActionData } from '../../../adapters/verification/platform/action/contract/action.ts';
import { createCiVerificationActionProviderEnvelope, parseCiVerificationActionProviderEnvelope } from '../../../adapters/verification/platform/action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../../adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentParseVerificationSessionArtifact } from '../../../adapters/verification/platform/ci/contract/evidence.ts';
import { HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE, hostedSessionArtifactName } from '../../../adapters/verification/platform/ci/contract/revision.ts';
import { exactCommitMarker } from '../../../adapters/verification/platform/ci/runtime/merge-commit-marker.ts';
import {
  ensureHostedResumeActionProviderTransaction,
  observeHostedResumeAction,
  observeHostedResumeActionSnapshot,
  observeHostedResumeDispatchOutcomeHistory,
  readHostedCompletedActionWakeup,
  readHostedResumeResolutionTransport
} from '../../../adapters/verification/platform/ci/runtime/verification-action-github-provider.ts';
import { createQualifiedHostedArtifactProvenance } from '../../../adapters/verification/platform/ci/runtime/verification-session.ts';
import { CodexDevelopmentComposeHostedEvidence } from '../../../adapters/verification/platform/ci/verification-coordination.ts';
import {
  CodexDevelopmentParseHostedActionRequest, CodexDevelopmentParseHostedActionResolution,
  CodexDevelopmentResolveHostedAction, hostedActionProviderIndexFromSnapshot, parseHostedEnvelope
} from '../../../adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import type { HostedCloseoutMutationPorts, HostedCloseoutPorts, HostedIntegrationEffectPorts, HostedIntegrationPreflightPorts, HostedIntegrationResumeObservationPorts, HostedIssueDispositionPorts, HostedRecoveryPreparationPorts, HostedRecoveryVerificationPorts, HostedSessionPorts } from '../../../application/verification-session-hosted.ts';
import { assertHostedSessionFinalizationSelection, authenticateHostedSessionResume, executeHostedSessionResumeReceiver, executeHostedVerificationSessionCommand, finalizeHostedSessionCommand, observeHostedSessionCommand, prepareHostedSessionFromFacts, sendHostedSessionResume } from '../../../application/verification-session-hosted.ts';
import { resumeVerificationSession, type VerificationSessionResumePorts } from '../../../application/verification-session-resume.ts';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { parseHostedVerificationCommand } from '../../../entry/verification-session-hosted-cli.ts';
import type { HostedResumeDispatchOutcomeCollection, HostedResumeSignal, VerificationSessionHostedRequest } from "../../../execution/verification/hosted.ts";

import type { SourceProgramTransitionAcceptanceRecord } from '../../../adapters/verification/platform/ci/contract/evidence.ts';
import { readSessionArtifactText, writeCanonicalDurable, writeDurable } from '../../../adapters/verification/platform/ci/runtime/session-artifact-files.ts';
import { closeHistoricalHostedSessionSources, type VerificationSessionScope } from '../../../adapters/verification/platform/ci/runtime/session-command.ts';
import type { VerificationSessionGitHubClient } from '../../../adapters/verification/platform/ci/runtime/verification-session-github.ts';
import { planHostedIntegrationEffects, routeHostedIntegration, selectMergedAuthorizationPublication } from '../../../adapters/verification/platform/ci/runtime/verification-session-integration-routing.ts';
import {
  appendVerificationSessionJournalEvent, claimVerificationSessionOperation, createEphemeralVerificationSessionJournalFs,
  createHostedResumeDispatchOutcome,
  createHostedResumeDispatchOutcomeCollection,
  createVerificationSessionOperationId,
  parseHostedResumeDispatchOutcomeCollection,
  readVerificationSessionJournal,
  recordHostedResumeDispatchOutcome,
  type VerificationSessionJournalFileSystem
} from '../../../adapters/verification/platform/ci/runtime/verification-session-journal.ts';
import {
  assertArtifactProvenance, assertCandidateCurrent, assertTrustedExactRevisionRuntime, assertTrustedMergedRuntimeReachability,
  assertTrustedRuntime, bindVerificationSessionTestImpactTransition,
  classifyVerificationSessionArtifactReuse,
  compilePostMainIssueDispositionHealthReadback,
  createTrustedIntegrationAuthorizationPublicationSource,
  createVerificationSessionHostedRequest,
  createVerificationSessionMergeOperationId,
  createVerificationSessionReviewReceipt,
  finalizeHostedSessionResumeArtifact,
  finalizeVerificationSessionHostedArtifact,
  integrationMergeMarkers,
  prepareVerificationSessionHosted,
  prepareVerificationSessionMergeInput,
  reconstructVerificationSessionHostedFacts,
  refreshVerificationSessionHostedArtifact,
  verificationSessionDataDigest, verifyIntegrationArtifact,
  type VerificationSessionRuntimeExternal
} from '../../../adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import {
  addSeconds,
  assertAuthorizationPublicationMatchesSession,
  assertBoundPostMergeMain,
  assertHostedCompilerIdentity,
  assertHostedIntegrationIdentity,
  assertHostedSquashMergeCompletion,
  branchCloseoutRecoveryArtifactName,
  captureHostedSessionCompilerCommand,
  closeoutPublicationCompositeDigest,
  comparePositiveDecimalDescending,
  consumeSameHostWorktreeCloseout,
  ensureHostedReviewLocator,
  executeHostedCloseoutEffect,
  executeHostedSquashMerge,
  hostedActorHandle,
  hostedIntegrationPreflightTransportPath,
  hostedMergeWakeupLocator,
  inspectTrustedRuntime,
  issueDispositionCommitMarkerState,
  loadOriginalHostPreparedCloseout,
  loadProviderBranchCloseoutRecoveryArtifact,
  loadQualifiedHostedSessionTransport,
  materializeBranchCloseoutRecoveryArtifact,
  observeExactIssueDispositionPlan,
  observeHostedResumeReceiverSignal,
  observeVerificationSessionActionDependencyBlobs,
  observeVerificationSessionChangedSelection,
  positiveEnvironmentInteger,
  publishHostedCloseoutTerminal,
  publishHostedIntegrationAuthorizationOperation,
  readAuthenticatedHostedControlStepFacts,
  readHostedAttemptRecoveryArtifactNames,
  readVerifiedHostedRecoveryTransport,
  synchronizeTrustedRemoteDefaultRef
} from '../../../adapters/verification/platform/ci/runtime/verification-session.ts';
import { assertReviewStabilityReceiptCurrent } from '../../../adapters/verification/platform/review/contract/stability.ts';
import { parseVerificationSession } from '../../../adapters/verification/platform/session/contract/session.ts';
import type { CodexDevelopmentTestImpactTransitionObservation } from '../../../adapters/verification/platform/test-impact/runtime/transition.ts';
import type { TrustedRuntimeSourceProgramAttemptEvidence } from '../../../adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
import type { CI_VERIFICATION_CONTRACT_REVISION } from '../../../assurance/verification/contract/revision.ts';
import type { VerificationGateResult, VerificationResultStatus } from '../../../assurance/verification/result/contract/result.ts';
import type { ScopeAuthorization, VerificationSession } from '../../../execution/verification/session.ts';

type ResumePorts = VerificationSessionResumePorts<
  SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence,
  typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult,
  ReturnType<typeof readVerificationSessionJournal>['events'][number]['schema'],
  ReturnType<typeof claimVerificationSessionOperation>['claim']['schema'],
  VerificationSessionHostedRequest<typeof import("../../../adapters/verification/platform/ci/contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>, CodexDevelopmentTestImpactTransitionObservation,
  ReturnType<typeof resolveOrdinaryMainHealthLane>, typeof HOSTED_RESUME_SIGNAL_SCHEMA
>;

type SessionPorts = HostedSessionPorts<
  SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence,
  typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult,
  typeof import("../../../adapters/verification/platform/ci/contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA, typeof HOSTED_RESUME_SIGNAL_SCHEMA
>;

/** Bind original native archive capture and original canonical parsers.
 * Application owns capture/parse/authenticated-reread ordering. */
export async function authenticateHostedResumeInput(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  completedAction: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>['completedAction'];
}>) {
  return await authenticateHostedSessionResume(input.completedAction, createHostedResumeIntakePorts(input.origin));
}

function createHostedResumeIntakePorts(origin: AuthenticatedGitHubJobOrigin) {
  return {
    captureResolutionTransport: (completedAction: HostedResumeSignal<typeof HOSTED_RESUME_SIGNAL_SCHEMA>['completedAction']) => readHostedResumeResolutionTransport({ origin, completedAction }),
    parseProviderEnvelope: (source: string) => parseCiVerificationActionProviderEnvelope(JSON.parse(source) as unknown),
    parseEnvelope: (source: string) => parseHostedEnvelope(JSON.parse(source) as unknown),
    parseResolution: CodexDevelopmentParseHostedActionResolution,
    resolveAction: ({ envelope, providerEnvelope }: Readonly<{ envelope: ReturnType<typeof parseHostedEnvelope>;
      providerEnvelope: ReturnType<typeof parseCiVerificationActionProviderEnvelope> }>) => CodexDevelopmentResolveHostedAction({ envelope,
      request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(providerEnvelope.proposal)) }),
    observeAuthenticatedAction: (authority: Parameters<typeof observeHostedResumeAction>[0]['authority']) => observeHostedResumeAction({ origin, authority }),
    encodeData: encodeVerificationActionData
  };
}

export async function executeHostedSessionResumeSender(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; sourceRunId: string; sourceRunAttempt: number;
}>) {
  return await sendHostedSessionResume(input, {
    ...createHostedResumeIntakePorts(input.origin), signalSchema: HOSTED_RESUME_SIGNAL_SCHEMA,
    discoverCompletedAction: source => readHostedCompletedActionWakeup({ origin: input.origin, ...source }),
    observeEmitter: () => observeAuthenticatedHostedResumeEmitter(input.origin),
    digest: sha256,
    dispatchSignal: signalSource => dispatchAuthenticatedHostedJobResume({ origin: input.origin, signalSource })
  });
}

/** Native bindings for a fresh preparation. The application receives the
 * original human only after authenticated Action intake; these ports do not
 * authenticate a caller-supplied principal or turn history into a new Scope. */
export function createHostedSessionPreparationPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope; github: VerificationSessionGitHubClient;
}>) {
  const assertCurrent = (request: Parameters<typeof prepareVerificationSessionHosted>[0]['request']) => {
    const job = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
    if (job.trustedDriverRoot !== input.ctx.repositoryRoot || job.repository !== input.ctx.repositoryFullName
        || job.workflowSha !== request.expectedBaseSha) throw new Error('Fresh hosted preparation differs from its genuine loaded origin.');
    assertTrustedExactRevisionRuntime(inspectTrustedRuntime({ repositoryRoot: input.ctx.repositoryRoot }), request.expectedBaseSha);
  };
  return bindHostedSessionPreparationPorts(input, assertCurrent);
}

function bindHostedSessionPreparationPorts(input: Readonly<{ ctx: VerificationSessionScope; github: VerificationSessionGitHubClient }>,
  assertCurrent: (request: Parameters<typeof prepareVerificationSessionHosted>[0]['request']) => void) {
  return {
    observeCandidate: (repository: string, pullRequestNumber: number) => input.github.observeCandidate(repository, pullRequestNumber),
    assertTrustedRequestCurrent: assertCurrent,
    manifestLocator: CodexDevelopmentParseWorkPackageLocator,
    readBlobText: (repository: string, commit: string, file: string) => input.github.readBlobText(repository, commit, file),
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest,
    parseManifest: CodexDevelopmentParseCurrentWorkPackageManifest,
    assertManifestOwnership: (manifest: ReturnType<typeof CodexDevelopmentParseCurrentWorkPackageManifest>, changedPaths: readonly string[]) =>
      CodexDevelopmentAssertWorkPackageOwnership(manifest, [...changedPaths]),
    observeChangedSelection: (selection: Readonly<{ repository: string; pullRequestNumber: number;
      candidate: Parameters<typeof observeVerificationSessionChangedSelection>[0]['candidate'] }>) =>
      observeVerificationSessionChangedSelection({ repositoryRoot: input.ctx.repositoryRoot, repository: selection.repository,
        prNumber: selection.pullRequestNumber, candidate: selection.candidate, github: input.github }),
    observeDependencyBlobs: (subject: Readonly<{ repository: string; baseSha: string; headSha: string }>) =>
      observeVerificationSessionActionDependencyBlobs({ ...subject, github: input.github }),
    observeReviewBarrier: (subject: Parameters<VerificationSessionGitHubClient['observeReviewBarrier']>[0]) => input.github.observeReviewBarrier(subject),
    observeChecks: (repository: string, commit: string) => input.github.observeChecks(repository, commit),
    reconstructFacts: reconstructVerificationSessionHostedFacts,
    prepareEnvelope: prepareVerificationSessionHosted,
    now: () => new Date().toISOString()
  };
}

/** Original public transport command, assembled from the same native readers,
 * private identity observation and canonical issuers used by the receiver. */
export async function executeHostedSessionCompilerCommand(argv: readonly string[]): Promise<string> {
  const input = captureHostedSessionCompilerCommand(argv);
  const ports = bindHostedSessionPreparationPorts(input, request => {
    assertTrustedExactRevisionRuntime(inspectTrustedRuntime({ repositoryRoot: input.repositoryRoot }), request.expectedBaseSha);
  });
  const output = input.required('--output');
  if (input.command === 'observe-hosted') {
    if (input.request === null) throw new Error('observe-hosted request is required.');
    const identity = await assertHostedCompilerIdentity({ ...input, event: input.event(), request: input.request });
    const result = await observeHostedSessionCommand({ request: input.request, repository: input.repository,
      originalHumanNodeId: identity.actorNodeId, sourceRunId: identity.runId, sourceRunAttempt: identity.runAttempt,
      sourceRef: `.github/workflows/compiler-pr-validation.yml@${input.request.expectedBaseSha}`, output }, {
      ...ports, createReviewOperationId: createVerificationSessionOperationId,
      ensureReviewLocator: subject => ensureHostedReviewLocator(input.ctx, input.github, subject),
      writeFacts: writeDurable, resolveOutput: value => path.resolve(value)
    });
    return JSON.stringify(result, null, 2);
  }
  if (input.command === 'prepare-hosted') {
    if (input.request === null) throw new Error('prepare-hosted request is required.');
    const facts: Parameters<typeof prepareVerificationSessionHosted>[0]['facts'] = JSON.parse(readSessionArtifactText(input.required('--facts')));
    const prepared = await prepareHostedSessionFromFacts({ request: input.request, facts }, ports);
    if (prepared.status !== 'prepared') throw new Error(`prepare-hosted fresh Review barrier is ${prepared.status}.`);
    writeDurable(output, prepared.envelope);
    return JSON.stringify({ status: 'prepared', envelopeDigest: prepared.envelope.envelopeDigest, output: path.resolve(output) }, null, 2);
  }
  assertHostedSessionFinalizationSelection({ evidencePath: input.args.get('--evidence'), previousArtifactPath: input.args.get('--previous-artifact') });
  const envelope = parseHostedEnvelope(JSON.parse(readSessionArtifactText(input.required('--envelope'))));
  const result = await finalizeHostedSessionCommand({ envelope, evidencePath: input.args.get('--evidence'),
    previousArtifactPath: input.args.get('--previous-artifact'), output }, {
    readEvidence: file => {
      const evidence: Parameters<typeof finalizeVerificationSessionHostedArtifact>[0]['evidence'] = JSON.parse(readSessionArtifactText(file));
      return evidence;
    }, readPreviousArtifact: file => CodexDevelopmentParseVerificationSessionArtifact(readSessionArtifactText(file)),
    finalize: finalizeVerificationSessionHostedArtifact,
    observeRefreshActor: selected => {
      return input.github.observePrincipal(selected.session.repository, hostedActorHandle(input.event()));
    },
    refreshProducer: (selected, actorNodeId) => {
      const runId = input.environment.GITHUB_RUN_ID ?? '';
      if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('GITHUB_RUN_ID is required for trusted artifact refresh.');
      const runAttempt = positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT', input.environment);
      return CodexDevelopmentCreateVerificationEvidenceProducer({ sourceTransport: 'github-actions',
        workflowPath: '.github/workflows/compiler-pr-validation.yml',
        workflowRef: `.github/workflows/compiler-pr-validation.yml@${selected.session.baseSha}`,
        workflowSha: selected.session.baseSha, runId, runAttempt, actorNodeId });
    }, refresh: refreshVerificationSessionHostedArtifact, now: ports.now,
    writeArtifact: writeCanonicalDurable, resolveOutput: value => path.resolve(value)
  });
  return JSON.stringify(result, null, 2);
}

export async function executeHostedSessionResumeReceiverCommand(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope; github: VerificationSessionGitHubClient;
  journalFs: VerificationSessionJournalFileSystem;
  event: Readonly<Record<string, unknown>>; environment: Readonly<Record<string, string | undefined>>; output: string;
  dispatchOutcomesOutput: string;
}>) {
  const job = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  const signal = observeHostedResumeReceiverSignal({ origin: input.origin, ctx: input.ctx, event: input.event });
  type Collection = HostedResumeDispatchOutcomeCollection<typeof HOSTED_RESUME_SIGNAL_SCHEMA>;
  const receiver: Collection['receiver'] = Object.freeze({ repository: job.repository, workflowPath: job.workflowPath,
    workflowSha: job.workflowSha, runId: job.runId, runAttempt: job.runAttempt, jobId: job.jobId });
  return await executeHostedSessionResumeReceiver({ signal, repository: job.repository, sourceRunId: job.runId,
    sourceRef: `${job.workflowPath}@${job.workflowSha}` }, {
    ...createHostedResumeIntakePorts(input.origin),
    preparation: createHostedSessionPreparationPorts(input),
    makeProviderEnvelope: (proposal: Parameters<typeof createCiVerificationActionProviderEnvelope>[0]['proposal'],
      cause: Awaited<ReturnType<typeof observeHostedResumeAction>>) => {
      const original = parseCiVerificationActionProviderEnvelope(cause.completedAction.providerEnvelope);
      return createCiVerificationActionProviderEnvelope({ proposal, parentPlan: cause.parentPlan,
        parentDispatchPlanArtifactId: original.parentDispatchPlanArtifactId,
        parentDispatchPlanArchiveDigest: original.parentDispatchPlanArchiveDigest });
    },
    observeMember: async (authority, currentSignal) => (await observeHostedResumeActionSnapshot({
      origin: input.origin, signal: currentSignal, authority })).snapshot,
    providerIndex: hostedActionProviderIndexFromSnapshot,
    createProducer: () => CodexDevelopmentCreateVerificationEvidenceProducer({
      sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRef: `${job.workflowPath}@${job.workflowSha}`, workflowSha: job.workflowSha,
      runId: job.runId, runAttempt: job.runAttempt, actorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId
    }),
    compose: CodexDevelopmentComposeHostedEvidence,
    observeDispatchHistory: request => observeHostedResumeDispatchOutcomeHistory({ origin: input.origin, signal,
      authority: request.authority, sessionRevision: request.sessionRevision, actionKeys: request.actionKeys }),
    dispatchMissing: request => ensureHostedResumeActionProviderTransaction({ origin: input.origin, signal: request.signal, journalFileSystem: input.journalFs,
      authority: { envelope: request.envelope, actionPlanClosure: request.actionPlanClosure }, hostedEnvelope: request.hostedEnvelope }),
    projectDispatchOutcome: request => {
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
      return createHostedResumeDispatchOutcome({ signal, sessionRevision: request.envelope.session.sessionRevision,
        actionKey: request.dispatch.actionKey, receiver, outcome: request.dispatch });
    },
    recordDispatchOutcome: async outcome => {
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
      return recordHostedResumeDispatchOutcome({ fs: input.journalFs, outcome });
    },
    exportDispatchOutcomes: async request => {
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
      const expected = path.resolve(job.trustedDriverRoot,
        ciVerificationHostedJobTransportSlot(job.policyJobId, 'out', 'resume-outcomes'), HOSTED_RESUME_DISPATCH_OUTCOMES_ARTIFACT_FILE);
      if (path.resolve(input.dispatchOutcomesOutput) !== expected) {
        throw new Error('Resume outcomes must use their sole canonical transport member.');
      }
      const collection = createHostedResumeDispatchOutcomeCollection({ signal, sessionRevision: request.envelope.session.sessionRevision,
        receiver, expectedActionKeys: request.expectedActionKeys, entries: request.entries });
      writeCanonicalDurable(input.dispatchOutcomesOutput, collection);
      const readback = parseHostedResumeDispatchOutcomeCollection(readSessionArtifactText(input.dispatchOutcomesOutput), request.expectedActionKeys);
      if (readback.collectionDigest !== collection.collectionDigest) throw new Error('Resume outcome transport readback changed.');
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
    },
    finalize: finalizeHostedSessionResumeArtifact,
    writeTerminal: async artifact => {
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
      writeCanonicalDurable(input.output, artifact);
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
    }
  });
}

export function createHostedSessionPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  event: Parameters<typeof assertHostedIntegrationIdentity>[0]['event'];
  environment: Parameters<typeof assertHostedIntegrationIdentity>[0]['environment'];
}>): SessionPorts {
  const assertScope = (repository: string): void => {
    const observed = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
    if (observed.repository !== repository || observed.trustedDriverRoot !== input.ctx.repositoryRoot) {
      throw new Error('Hosted Session native capture belongs to another authenticated invocation.');
    }
  };
  return {
    encodeData: encodeVerificationActionData,
    artifactName: hostedSessionArtifactName,
    compareRunIdsDescending: comparePositiveDecimalDescending,
    observeArtifactsForRun: async (repository, runId) => {
      assertScope(repository);
      const captured = await input.github.observeActionsArtifactsForRun(repository, runId);
      assertScope(repository);
      return captured;
    },
    captureSessionArtifact: async request => {
      assertScope(request.repository);
      const captured = await loadQualifiedHostedSessionTransport({ ...request, github: input.github, origin: input.origin, ctx: input.ctx });
      assertScope(request.repository);
      return captured;
    },
    observeCandidate: async (repository, prNumber) => {
      assertScope(repository);
      const candidate = await input.github.observeCandidate(repository, prNumber);
      assertScope(repository);
      return candidate;
    },
    assertIntegrationIdentity: async request => {
      assertScope(request.repository);
      const identity = await assertHostedIntegrationIdentity({ ...request, ctx: input.ctx,
        github: input.github, event: input.event, environment: input.environment,
        repositoryRoot: input.ctx.repositoryRoot });
      assertScope(request.repository);
      return identity;
    },
    observeAuthorizationPublications: request => {
      assertScope(request.repository);
      return observeIntegrationAuthorizationOperationPublications(input.ctx.repositoryRoot, request);
    },
    selectMergedAuthorization: selectMergedAuthorizationPublication,
    assertAuthorizationMatchesSession: assertAuthorizationPublicationMatchesSession,
    captureRecoveryArtifact: async request => {
      assertScope(request.repository);
      const recovery = await loadProviderBranchCloseoutRecoveryArtifact({ ...request,
        ctx: input.ctx, github: input.github });
      assertScope(request.repository);
      return recovery;
    },
    createCloseoutBinding: createBranchCloseoutOperationBinding
  };
}

export function createHostedCloseoutPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  ctx: VerificationSessionScope;
}>): HostedCloseoutPorts<Parameters<Parameters<typeof withAuthenticatedPostMergeMainHealth>[1]>[0]> {
  return {
    withPostMergeHealth: async (binding, operation) => {
      const plan = await prepareTrustedRuntimeRecoveryMainHealthPlan({ origin: input.origin,
        repositoryRoot: input.ctx.repositoryRoot, repository: binding.repository,
        mergedSha: binding.newMainSha, mergedTreeSha: binding.newMainTreeSha });
      return await withAuthenticatedPostMergeMainHealth({ origin: input.origin,
        plan, repositoryRoot: input.ctx.repositoryRoot,
        repository: binding.repository, mainSha: binding.newMainSha, mainTreeSha: binding.newMainTreeSha }, operation);
    },
    observeTerminal: request => observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, request),
    observeEffectStart: request => observeBranchCloseoutEffectStartPublication(input.ctx.repositoryRoot, request),
    assertEffectStartMatches: assertBranchCloseoutEffectStartMatches,
    captureOperationReceipt: (preparation, operationId) => {
      const receiptPath = operationReceiptFilePath(preparation, operationId);
      return existsSync(receiptPath) ? parseBranchCloseoutOperationReceipt(readFileSync(receiptPath, 'utf8')) : null;
    },
    publishTerminal: request => publishHostedCloseoutTerminal({ ...request, ctx: input.ctx }),
    publicationDigest: closeoutPublicationCompositeDigest,
    writeProjection: writeDurable,
    resolveOutputPath: value => path.resolve(value),
    now: () => new Date().toISOString()
  };
}

export function createHostedIssueDispositionPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; github: VerificationSessionGitHubClient;
}>): HostedIssueDispositionPorts<
  ReturnType<typeof CodexDevelopmentParseCurrentWorkPackageManifest>['tracking'],
  Awaited<ReturnType<VerificationSessionGitHubClient['observeChecks']>>
> {
  const assertCurrent = (): void => { assertAuthenticatedGitHubJobOriginCurrent(input.origin); };
  return {
    markerState: issueDispositionCommitMarkerState, exactMarker: exactCommitMarker,
    readManifest: async (repository, revision, manifestPath) => {
      assertCurrent();
      const source = await input.github.readBlobText(repository, revision, manifestPath);
      assertCurrent();
      return source;
    },
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest,
    parseManifest: CodexDevelopmentParseCurrentWorkPackageManifest,
    observeIssuePlan: async request => {
      assertCurrent();
      const plan = await observeExactIssueDispositionPlan({ ...request, github: input.github });
      assertCurrent();
      return plan;
    },
    observeIssue: (repository, issueNumber) => { assertCurrent(); return observeGitHubIssue(repository, issueNumber); },
    acceptanceId: createIssueAcceptanceId,
    observeChecks: async (repository, revision) => {
      assertCurrent();
      const checks = await input.github.observeChecks(repository, revision);
      assertCurrent();
      return checks;
    },
    compileHealth: compilePostMainIssueDispositionHealthReadback, compileDisposition: compileIssueDisposition
  };
}

export function createHostedCloseoutMutationPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  ctx: VerificationSessionScope;
  closeoutOperations: Parameters<typeof consumeSameHostWorktreeCloseout>[1];
}>): HostedCloseoutMutationPorts<
  Parameters<Parameters<typeof withAuthenticatedPostMergeMainHealth>[1]>[0],
  Awaited<ReturnType<typeof consumeSameHostWorktreeCloseout>>[number]
> {
  return {
    ...createHostedCloseoutPorts(input),
    consumePreparedWorktrees: request => consumeSameHostWorktreeCloseout({ ...request, ctx: input.ctx }, input.closeoutOperations),
    executeCloseoutEffect: request => executeHostedCloseoutEffect({ ...request, ctx: input.ctx }),
    operationReceiptPath: operationReceiptFilePath
  };
}

export function createHostedIntegrationPreflightPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; github: VerificationSessionGitHubClient;
}>): HostedIntegrationPreflightPorts<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence,
  typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult,
  ReturnType<typeof prepareVerificationSessionMergeInput>, typeof HOSTED_RESUME_SIGNAL_SCHEMA> {
  const assertCurrent = (): void => { assertAuthenticatedGitHubJobOriginCurrent(input.origin); };
  return {
    classifyArtifactReuse: classifyVerificationSessionArtifactReuse,
    observeReviewBarrier: async request => {
      assertCurrent();
      const barrier = await input.github.observeReviewBarrier(request);
      assertCurrent();
      return barrier;
    },
    rawDigest: rawSha256, addSeconds, createReviewReceipt: createVerificationSessionReviewReceipt,
    observeChangedPaths: async request => {
      assertCurrent();
      const paths = await input.github.observeChangedPaths(request);
      assertCurrent();
      return paths;
    },
    observeComparison: async (repository, baseSha, headSha) => {
      assertCurrent();
      const comparison = await input.github.observeComparison(repository, baseSha, headSha);
      assertCurrent();
      return comparison;
    },
    observeOpenPullRequestCountForHead: async (repository, headSha) => {
      assertCurrent();
      const count = await input.github.observeOpenPullRequestCountForHead(repository, headSha);
      assertCurrent();
      return count;
    },
    compileMainHealth: request => createMainHealthLedger(createObservedMainHealthInput(request)),
    mergeOperationId: createVerificationSessionMergeOperationId,
    observePlatformEnforcement: async repository => {
      assertCurrent();
      const platform = await input.github.observePlatformEnforcement(repository);
      assertCurrent();
      return platform;
    },
    createMergeInput: prepareVerificationSessionMergeInput, evaluateMergeGate: CodexDevelopmentEvaluateMergeGate
  };
}

export function createHostedRecoveryPreparationPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope;
}>): HostedRecoveryPreparationPorts {
  const assertCurrent = (): void => { assertAuthenticatedGitHubJobOriginCurrent(input.origin); };
  return {
    routeIntegration: routeHostedIntegration, planEffects: planHostedIntegrationEffects,
    prepareCloseout: request => { assertCurrent(); return prepareMergedPullRequestCloseout(input.ctx, request); },
    materializeRecovery: request => { assertCurrent(); return materializeBranchCloseoutRecoveryArtifact(request); },
    recoveryArtifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
    writePreflight: result => {
      assertCurrent();
      writeDurable(hostedIntegrationPreflightTransportPath(input.ctx.repositoryRoot, 'producer'), result);
      assertCurrent();
    },
    writeProjection: writeDurable, resolveOutputPath: value => path.resolve(value), now: () => new Date().toISOString()
  };
}

export function createHostedRecoveryVerificationPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope; github: VerificationSessionGitHubClient;
}>): HostedRecoveryVerificationPorts {
  const assertCurrent = (): ReturnType<typeof assertAuthenticatedGitHubJobOriginCurrent> =>
    assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  return {
    readControlStepFacts: () => {
      assertCurrent();
      const facts = readAuthenticatedHostedControlStepFacts({ ctx: input.ctx, origin: input.origin });
      assertCurrent();
      return Object.freeze({ preparation: facts.preparation, upload: facts.upload });
    },
    readProducedRecoveryTransport: () => {
      const job = assertCurrent();
      const memberDirectory = path.resolve(input.ctx.repositoryRoot,
        ciVerificationHostedJobTransportSlot(job.policyJobId, 'out', 'recovery'));
      const recoveryPath = path.join(memberDirectory, BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME);
      const preflightPath = hostedIntegrationPreflightTransportPath(input.ctx.repositoryRoot, 'producer');
      const recoveryPresent = existsSync(recoveryPath);
      const preflightPresent = existsSync(preflightPath);
      if (!recoveryPresent && !preflightPresent) return null;
      if (recoveryPresent !== preflightPresent) {
        throw new Error('Prepared recovery transport members are incomplete.');
      }
      const recoverySource = readSessionArtifactText(recoveryPath);
      const preflightSource = readSessionArtifactText(preflightPath);
      const recovery = parseBranchCloseoutRecoveryArtifact(recoverySource);
      const preflight = CodexDevelopmentParseMergeGateResult(preflightSource);
      if (recovery.repository !== job.repository || preflight.authorization.repository !== job.repository
          || preflight.authorization.prNumber !== recovery.pullRequestNumber
          || preflight.authorization.sessionRevision !== recovery.sessionRevision
          || preflight.authorization.headSha !== recovery.headSha
          || preflight.authorization.headTreeSha !== recovery.headTreeSha) {
        throw new Error('Prepared recovery transport members disagree on their Session identity.');
      }
      const artifactName = branchCloseoutRecoveryArtifactName({ prNumber: recovery.pullRequestNumber,
        sessionRevision: recovery.sessionRevision, runId: job.runId, runAttempt: job.runAttempt });
      assertCurrent();
      return Object.freeze({ artifactName, recoveryDigest: rawSha256(recoverySource),
        preflightDigest: rawSha256(preflightSource) });
    },
    readRunAttemptRecoveryArtifactNames: async () => {
      const job = assertCurrent();
      const names = await readHostedAttemptRecoveryArtifactNames({ github: input.github,
        repository: job.repository, runId: job.runId, runAttempt: job.runAttempt });
      // The absence lane must still belong to this exact active verifier after
      // the asynchronous inventory read, just as the uploaded lane is re-read.
      const steps = readAuthenticatedHostedControlStepFacts({ ctx: input.ctx, origin: input.origin });
      if (steps.upload.conclusion !== 'skipped') {
        throw new Error('Recovery absence readback no longer has its skipped upload.');
      }
      assertCurrent();
      return names;
    },
    readVerifiedHostedRecoveryTransport: async request => {
      const job = assertCurrent();
      const transport = await readVerifiedHostedRecoveryTransport({ ctx: input.ctx, github: input.github,
        origin: input.origin, repository: job.repository, expectedArtifactName: request.expectedArtifactName,
        runId: job.runId, runAttempt: job.runAttempt });
      assertCurrent();
      return transport;
    },
    writeProjection: writeDurable, resolveOutputPath: value => path.resolve(value), now: () => new Date().toISOString()
  };
}

export function createHostedIntegrationEffectPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope;
  environment: Parameters<typeof assertBoundPostMergeMain>[0]['environment'];
}>): HostedIntegrationEffectPorts<ReturnType<typeof observeUnexpectedGitHubIssueClosures>[number]> {
  const assertCurrent = (): void => { assertAuthenticatedGitHubJobOriginCurrent(input.origin); };
  return {
    capturePreflight: () => {
      assertCurrent();
      return CodexDevelopmentParseMergeGateResult(readSessionArtifactText(hostedIntegrationPreflightTransportPath(input.ctx.repositoryRoot, 'consumer')));
    },
    expectedPreflightDigest: input.environment.EXPECTED_PREFLIGHT_RESULT_DIGEST,
    captureOriginalPrepared: request => { assertCurrent(); return loadOriginalHostPreparedCloseout({ ...request, ctx: input.ctx }); },
    createAuthorizationPublication: createIntegrationAuthorizationOperationPublication,
    publishAuthorization: publication => { assertCurrent(); return publishHostedIntegrationAuthorizationOperation(input.ctx, publication); },
    executeSquashMerge: request => { assertCurrent(); return executeHostedSquashMerge({ ...request, ctx: input.ctx }); },
    assertMergeCompletion: assertHostedSquashMergeCompletion,
    synchronizeDefault: () => { assertCurrent(); return synchronizeTrustedRemoteDefaultRef({ ctx: input.ctx }); },
    assertBoundMain: request => { assertCurrent(); return assertBoundPostMergeMain({ ...request, ctx: input.ctx, environment: input.environment }); },
    observeUnexpectedIssueClosures: request => { assertCurrent(); return observeUnexpectedGitHubIssueClosures(request); }
  };
}

export function createHostedIntegrationResumeObservationPorts(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope;
}>): HostedIntegrationResumeObservationPorts<SourceProgramTransitionAcceptanceRecord, TrustedRuntimeSourceProgramAttemptEvidence,
  typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult, typeof HOSTED_RESUME_SIGNAL_SCHEMA> {
  return {
    inspectRuntime: session => {
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
      return inspectTrustedRuntime({ repositoryRoot: input.ctx.repositoryRoot, candidateHeadSha: session.headSha });
    },
    artifactProvenance: async request => {
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
      const provenance = await createQualifiedHostedArtifactProvenance({ ...request, ctx: input.ctx });
      assertAuthenticatedGitHubJobOriginCurrent(input.origin);
      return provenance;
    },
    authorizationSource: createTrustedIntegrationAuthorizationPublicationSource,
    authorizationMarkers: integrationMergeMarkers
  };
}

/** All four production commands consume the same authenticated invocation.
 * The entry parser chooses spelling; application stages own business order. */
export async function executeHostedVerificationCommand(input: Readonly<{
  command: ReturnType<typeof parseHostedVerificationCommand>; origin: AuthenticatedGitHubJobOrigin;
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  event: Parameters<typeof assertHostedIntegrationIdentity>[0]['event'];
  environment: Parameters<typeof assertHostedIntegrationIdentity>[0]['environment'];
  journalFs: VerificationSessionJournalFileSystem;
  closeoutOperations: Parameters<typeof consumeSameHostWorktreeCloseout>[1];
}>): Promise<string> {
  const command = input.command;
  const origin = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  if (origin.phase !== command.command || origin.repository !== command.repository
      || origin.trustedDriverRoot !== input.ctx.repositoryRoot) {
    throw new Error('Hosted command selection differs from the original authenticated job phase or subject.');
  }
  const sessionPorts = createHostedSessionPorts(input);
  const wakeup = hostedMergeWakeupLocator(input.event);
  const issuePorts = createHostedIssueDispositionPorts(input);
  const closeoutPorts = createHostedCloseoutPorts(input);
  const preflightPorts = createHostedIntegrationPreflightPorts(input);
  const preparationPorts = createHostedRecoveryPreparationPorts(input);
  const observationResumePorts = createVerificationSessionResumePorts({ github: input.github,
    journalFs: createEphemeralVerificationSessionJournalFs(input.journalFs.rootPath) });
  const effectGuardResumePorts = createVerificationSessionResumePorts({ github: input.github,
    journalFs: createEphemeralVerificationSessionJournalFs(input.journalFs.rootPath) });
  const durableResumePorts = createVerificationSessionResumePorts(input);
  try {
    return await executeHostedVerificationSessionCommand({ ...command, ...wakeup, repositoryRoot: input.ctx.repositoryRoot,
    resumeGitHub: input.github, observationResumePorts, effectGuardResumePorts, durableResumePorts }, {
    ...sessionPorts, ...issuePorts, ...preflightPorts, ...preparationPorts, ...closeoutPorts,
    ...createHostedIntegrationResumeObservationPorts(input), ...createHostedIntegrationEffectPorts(input),
    ...createHostedCloseoutMutationPorts(input), ...createHostedRecoveryVerificationPorts(input)
    });
  } finally {
    closeHistoricalHostedSessionSources(input.ctx);
  }
}

/** Captures one actual journal and one native client. No workflow body is
 * delegated: the application consumes only these original owner primitives. */
export function createVerificationSessionResumePorts(input: Readonly<{
  github: VerificationSessionGitHubClient;
  journalFs: VerificationSessionJournalFileSystem;
}>): ResumePorts {
  const github = input.github;
  const fs = input.journalFs;
  return {
    parseSession: session => parseVerificationSession(encodeVerificationActionData(session)),
    parseScope: scope => parseScopeAuthorization(encodeVerificationActionData(scope)),
    digest: verificationSessionDataDigest,
    readJournal: sessionRevision => readVerificationSessionJournal({ sessionRevision, fs }),
    appendJournal: event => { appendVerificationSessionJournalEvent({ ...event, fs }); },
    claimOperation: claim => claimVerificationSessionOperation({ ...claim, fs }),
    createOperationId: createVerificationSessionOperationId,
    assertTrustedRuntime,
    assertTrustedMergedRuntimeReachability: observation => assertTrustedMergedRuntimeReachability({ ...observation, github }),
    assertCandidateCurrent,
    assertScopeCurrent: assertScopeAuthorizationCurrent,
    createReviewReceipt: createVerificationSessionReviewReceipt,
    bindTestImpactTransition: bindVerificationSessionTestImpactTransition,
    createHostedRequest: createVerificationSessionHostedRequest,
    assertArtifactProvenance,
    integrationPlatformPolicyDigest: SEC_INTEGRATION_PLATFORM_POLICY_DIGEST,
    mainHealthDefaultBranch: CI_MAIN_HEALTH_POLICY.producer.branch,
    parseMergeGateResult: CodexDevelopmentParseMergeGateResult,
    verifyIntegrationArtifact,
    integrationMergeMarkers,
    assertReviewReceiptCurrent: assertReviewStabilityReceiptCurrent,
    resolveOrdinaryMainHealth: resolveOrdinaryMainHealthLane,
    assertIntegrationAuthorizationUsable,
    assertCanonicalMergeMessage,
    assertCloseoutBinding: assertBranchCloseoutOperationBinding
  };
}

export function resumeHostedVerificationSession(input: Readonly<{
  repositoryRoot: string;
  session: VerificationSession;
  scopeAuthorization: ScopeAuthorization;
  changedPaths: readonly string[];
  testImpactTransition?: CodexDevelopmentTestImpactTransitionObservation;
  integrationPrincipalNodeId: string;
  github: VerificationSessionGitHubClient;
  external: VerificationSessionRuntimeExternal;
  journalFs: VerificationSessionJournalFileSystem;
}>) {
  return resumeVerificationSession(input, createVerificationSessionResumePorts(input));
}
