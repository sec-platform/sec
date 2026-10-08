import path from 'node:path';
import { setTimeout as waitForTimeout } from 'node:timers/promises';
import { hostedSessionCoordinationBudget } from '../../adapters/providers/github-api/contract/hosted-job-policy.ts';
import type { AuthenticatedGitHubJobOrigin } from '../../adapters/providers/github-api/hosted-job-origin.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, getAuthenticatedGitHubJobOriginSignal } from '../../adapters/providers/github-api/hosted-job-origin.ts';
import { parseCiVerificationActionProviderEnvelope } from '../../adapters/verification/platform/action/contract/ci.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentParseVerificationSessionArtifact } from '../../adapters/verification/platform/ci/contract/evidence.ts';
import { parseVerificationSessionHostedRequest } from '../../adapters/verification/platform/ci/contract/session-request.ts';
import { readSessionArtifactText, writeCanonicalDurable, writeDurable } from '../../adapters/verification/platform/ci/runtime/session-artifact-files.ts';
import type { VerificationSessionScope } from '../../adapters/verification/platform/ci/runtime/session-command.ts';
import type { VerificationSessionGitHubClient } from '../../adapters/verification/platform/ci/runtime/verification-session-github.ts';
import { createVerificationSessionOperationId } from '../../adapters/verification/platform/ci/runtime/verification-session-journal.ts';
import { finalizeVerificationSessionHostedArtifact, prepareVerificationSessionHosted, refreshVerificationSessionHostedArtifact } from '../../adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { assertHostedCompilerIdentity, ensureHostedReviewLocator, hostedActorHandle, positiveEnvironmentInteger } from '../../adapters/verification/platform/ci/runtime/verification-session.ts';
import { createHostedActionCoordinationStagePorts } from '../../adapters/verification/platform/ci/verification-cli.ts';
import { parseHostedEnvelope } from '../../adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import {
  claimHostedActionStart as claimStart,
  completeHostedActionCoordinationSession as completeSession,
  composeHostedActionEvidence as composeEvidence,
  coordinateHostedActionSession as coordinateSession,
  observeHostedAction as observeAction,
  prepareHostedActionClaim as prepareClaim,
  prepareHostedActionParentPlan as prepareParentPlan,
  prepareHostedActionCoordinationSession as prepareSession,
  prepareHostedActionStartMarker as prepareStartMarker,
  resolveHostedAction as resolveAction,
  resolveHostedActionCoordinationSession as resolveSession,
  verifyHostedActionParentPlan as verifyParentPlan,
  type HostedActionArchiveInput,
  type HostedActionChildInput,
  type HostedActionCoordinationPorts,
  type HostedActionParentInput
} from '../../application/hosted-action-coordination.ts';
import { createHostedSessionPreparationPorts } from './closeout/verification-session-hosted.ts';

type NativePorts = ReturnType<typeof createHostedActionCoordinationStagePorts>;
type NativeTransaction = Awaited<ReturnType<NativePorts['transaction']>>;
type NativeIndex = ReturnType<NativePorts['providerIndex']>;
type CoordinationValues = {
  source: ReturnType<NativePorts['readTransport']>;
  request: ReturnType<NativePorts['parseSessionRequest']>;
  envelope: ReturnType<NativePorts['parseEnvelope']>;
  proposal: ReturnType<NativePorts['createProposal']>;
  parentPlan: ReturnType<NativePorts['createParentPlan']>;
  providerEnvelope: ReturnType<NativePorts['parseProviderEnvelope']>;
  actionRequest: ReturnType<NativePorts['parseActionRequest']>;
  resolution: ReturnType<NativePorts['resolveAction']>;
  repositoryIdentity: ReturnType<NativePorts['repositoryIdentity']>;
  parentActor: ReturnType<NativePorts['parentActor']>;
  producer: ReturnType<NativePorts['producer']>;
  marker: ReturnType<NativePorts['createStartMarker']>;
  start: NativeIndex['startObservations'][number];
  terminal: NativeIndex['terminalObservations'][number];
  anchor: NativeIndex['terminalAnchorObservations'][number];
  statusReadback: NativeIndex['providerStatusReadbacks'][number];
  status: NonNullable<NativeTransaction['status']>;
  snapshot: NativeTransaction['snapshot'];
  decision: ReturnType<NativePorts['reduceProvider']>;
  coordination: ReturnType<NativePorts['coordinate']>;
  inventory: ReturnType<NativePorts['inspectArchive']>;
  sandbox: Awaited<ReturnType<NativePorts['captureSandboxCapability']>>;
  sandboxSelection: Parameters<NativePorts['captureSandboxCapability']>[0]['selection'];
  ticket: ReturnType<NativePorts['createTicket']>;
  artifactIndexSchema: NativePorts['artifactIndexSchema'];
  evidenceIndex: ReturnType<NativePorts['readEvidenceIndex']>;
  evidenceProducer: ReturnType<NativePorts['evidenceProducer']>;
  evidence: NonNullable<ReturnType<NativePorts['composeEvidence']>['evidence']>;
};

function stagePorts(origin: AuthenticatedGitHubJobOrigin): HostedActionCoordinationPorts<CoordinationValues> {
  return createHostedActionCoordinationStagePorts(origin);
}

function sessionPorts(input: Readonly<{ origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient; event: Parameters<typeof assertHostedCompilerIdentity>[0]['event'];
  environment: Parameters<typeof assertHostedCompilerIdentity>[0]['environment'] }>) {
  const current = () => {
    const job = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
    const admitted = job.policyJobId === 'coordinate-verification-session' && job.role === 'control'
      && ['prepare-parent-plan', 'coordinate-session'].includes(job.phase)
      || job.policyJobId === 'resolve-verification-action' && job.role === 'trusted' && job.phase === 'resolve-hosted-action';
    if (!admitted || job.repository !== input.ctx.repositoryFullName || job.trustedDriverRoot !== input.ctx.repositoryRoot) {
      throw new Error('Coordinator Session stages require their original authenticated invocation.');
    }
    return job;
  };
  const job = current();
  const preparation = createHostedSessionPreparationPorts(input);
  return {
    repository: job.repository, budget: hostedSessionCoordinationBudget(),
    materializeRequest: (encoded: string, file: string) => {
      current();
      const request = parseVerificationSessionHostedRequest(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64')));
      writeDurable(file, request);
      const readback = parseVerificationSessionHostedRequest(readSessionArtifactText(file));
      if (JSON.stringify(readback) !== JSON.stringify(request)) throw new Error('Coordinator request readback changed its original parsed request.');
      current(); return request;
    },
    materializeActionRequest: (encoded: string, providerFile: string, requestFile: string) => {
      const original = current();
      if (original.policyJobId !== 'resolve-verification-action') throw new Error('Internal Action transport belongs to its original resolver.');
      const provider = parseCiVerificationActionProviderEnvelope(JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64'))));
      const request = parseVerificationSessionHostedRequest(JSON.stringify(provider.proposal.sessionRequest));
      writeCanonicalDurable(providerFile, provider); writeDurable(requestFile, request);
      const readback = parseCiVerificationActionProviderEnvelope(JSON.parse(readSessionArtifactText(providerFile)));
      const requestReadback = parseVerificationSessionHostedRequest(readSessionArtifactText(requestFile));
      if (JSON.stringify(readback) !== JSON.stringify(provider) || JSON.stringify(requestReadback) !== JSON.stringify(request)) {
        throw new Error('Original Action request transport changed during materialization.');
      }
      current(); return request;
    },
    readSessionRequest: (file: string) => { current(); return parseVerificationSessionHostedRequest(readSessionArtifactText(file)); },
    compilerIdentity: (request: Parameters<typeof assertHostedCompilerIdentity>[0]['request']) => {
      current(); return assertHostedCompilerIdentity({ ...input, repository: job.repository, repositoryRoot: input.ctx.repositoryRoot, request });
    },
    observation: { ...preparation, createReviewOperationId: createVerificationSessionOperationId,
      ensureReviewLocator: (subject: Parameters<typeof ensureHostedReviewLocator>[2]) => { current(); return ensureHostedReviewLocator(input.ctx, input.github, subject); },
      writeFacts: (file: string, facts: Parameters<typeof prepareVerificationSessionHosted>[0]['facts']) => { current(); writeDurable(file, facts); },
      resolveOutput: (file: string) => path.resolve(file) },
    readFacts: (file: string) => { current(); const facts: Parameters<typeof prepareVerificationSessionHosted>[0]['facts'] = JSON.parse(readSessionArtifactText(file)); return facts; },
    writeEnvelope: (file: string, envelope: ReturnType<typeof prepareVerificationSessionHosted>) => { current(); writeDurable(file, envelope); current(); },
    readEnvelope: (file: string) => { current(); return parseHostedEnvelope(JSON.parse(readSessionArtifactText(file))); },
    finalization: {
      readEvidence: (file: string) => { current(); const evidence: Parameters<typeof finalizeVerificationSessionHostedArtifact>[0]['evidence'] = JSON.parse(readSessionArtifactText(file)); return evidence; },
      readPreviousArtifact: (file: string) => { current(); return CodexDevelopmentParseVerificationSessionArtifact(readSessionArtifactText(file)); },
      finalize: finalizeVerificationSessionHostedArtifact,
      observeRefreshActor: (envelope: ReturnType<typeof prepareVerificationSessionHosted>) => { current(); return input.github.observePrincipal(envelope.session.repository, hostedActorHandle(input.event)); },
      refreshProducer: (envelope: ReturnType<typeof prepareVerificationSessionHosted>, actorNodeId: string) => {
        const original = current(); return CodexDevelopmentCreateVerificationEvidenceProducer({ sourceTransport: 'github-actions',
          workflowPath: '.github/workflows/compiler-pr-validation.yml', workflowRef: `${original.workflowPath}@${envelope.session.baseSha}`,
          workflowSha: envelope.session.baseSha, runId: original.runId,
          runAttempt: positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT', input.environment), actorNodeId });
      }, refresh: refreshVerificationSessionHostedArtifact, now: preparation.now,
      writeArtifact: (file: string, artifact: ReturnType<typeof finalizeVerificationSessionHostedArtifact>) => { current(); writeCanonicalDurable(file, artifact); current(); },
      resolveOutput: (file: string) => path.resolve(file)
    },
    wait: async (ms: number) => {
      const original = current();
      if (!Number.isSafeInteger(ms) || ms < 0 || Date.now() + ms > original.deadlineAtUnixMs) throw new Error('Coordinator wait exceeds the original authenticated job deadline.');
      await waitForTimeout(ms, undefined, { signal: getAuthenticatedGitHubJobOriginSignal(input.origin) }); current();
    }
  };
}

export async function prepareHostedActionCoordinationSession(input: Parameters<typeof sessionPorts>[0],
  command: Parameters<typeof prepareSession>[0]) {
  return await prepareSession(command, stagePorts(input.origin), sessionPorts(input));
}

export async function completeHostedActionCoordinationSession(input: Parameters<typeof sessionPorts>[0],
  command: Parameters<typeof completeSession>[0]) {
  return await completeSession(command, stagePorts(input.origin), sessionPorts(input));
}

export async function resolveHostedActionCoordinationSession(input: Parameters<typeof sessionPorts>[0],
  command: Parameters<typeof resolveSession>[0]) {
  return await resolveSession(command, stagePorts(input.origin), sessionPorts(input));
}

export async function prepareHostedActionClaim(origin: AuthenticatedGitHubJobOrigin,
  command: HostedActionChildInput & Readonly<{ capabilitySelection: CoordinationValues['sandboxSelection'];
    archiveOutputDirectory: string; markerOutputPath: string }>) {
  return await prepareClaim<CoordinationValues>(command, createHostedActionCoordinationStagePorts(origin));
}

export async function prepareHostedActionParentPlan(origin: AuthenticatedGitHubJobOrigin,
  input: Readonly<{ requestPath: string; envelopePath: string; outputPath: string }>) {
  return await prepareParentPlan<CoordinationValues>({ ...input, outputPath: path.resolve(input.outputPath) }, stagePorts(origin));
}

export async function verifyHostedActionParentPlan(origin: AuthenticatedGitHubJobOrigin, input: HostedActionParentInput) {
  return await verifyParentPlan<CoordinationValues>(input, stagePorts(origin));
}

export async function coordinateHostedActionSession(origin: AuthenticatedGitHubJobOrigin,
  input: HostedActionParentInput & Readonly<{ artifactIndexPath: string; dispatch: boolean }>) {
  return await coordinateSession<CoordinationValues>({ ...input, artifactIndexPath: path.resolve(input.artifactIndexPath) }, stagePorts(origin));
}

export async function observeHostedAction(origin: AuthenticatedGitHubJobOrigin,
  input: HostedActionChildInput & Readonly<{ artifactIndexPath: string }>) {
  return await observeAction<CoordinationValues>({ ...input, artifactIndexPath: path.resolve(input.artifactIndexPath) }, stagePorts(origin));
}

export async function prepareHostedActionStartMarker(origin: AuthenticatedGitHubJobOrigin,
  input: HostedActionChildInput & HostedActionArchiveInput & Readonly<{
    outputPath: string; capabilitySelection: CoordinationValues['sandboxSelection'];
  }>) {
  return await prepareStartMarker<CoordinationValues>({ ...input, outputPath: path.resolve(input.outputPath) }, stagePorts(origin));
}

export async function claimHostedActionStart(origin: AuthenticatedGitHubJobOrigin,
  input: HostedActionChildInput & HostedActionArchiveInput & Readonly<{ outputPath: string }>) {
  return await claimStart<CoordinationValues>({ ...input, outputPath: path.resolve(input.outputPath) }, stagePorts(origin));
}

export async function resolveHostedAction(origin: AuthenticatedGitHubJobOrigin,
  input: Readonly<{ providerEnvelopePath: string; envelopePath: string; outputPath: string }>) {
  return await resolveAction<CoordinationValues>({ ...input, outputPath: path.resolve(input.outputPath) }, stagePorts(origin));
}

export async function composeHostedActionEvidence(origin: AuthenticatedGitHubJobOrigin,
  input: HostedActionParentInput & Readonly<{ artifactIndexPath: string; outputPath: string }>) {
  return await composeEvidence<CoordinationValues>({ ...input, outputPath: path.resolve(input.outputPath) }, stagePorts(origin));
}
