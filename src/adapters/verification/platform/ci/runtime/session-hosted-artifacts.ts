/** VerificationSession physical owner recovered from current-main semantics. */
import { BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME, type BranchCloseoutRecoveryArtifact, createBranchCloseoutRecoveryArtifact, parseBranchCloseoutRecoveryArtifact } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { parsePreparedBranchCloseoutEnvelope, rehydratePreparedBranchCloseoutRecoveryArtifact } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../action/contract/provider.ts';
import type { VerificationSession } from '../../session/contract/session.ts';
import { CodexDevelopmentParseVerificationSessionArtifact } from '../contract/evidence.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { writeCanonicalDurable } from './session-artifact-files.ts';
import type { GitHubActionsArtifactObservation, VerificationSessionGitHubClient } from './verification-session-github.ts';
import { createHostedArtifactObservation, parseVerificationSessionHostedRequest } from './verification-session-runtime.ts';
import path from 'node:path';

function comparePositiveDecimalDescending(left: string, right: string): number {
  if (!/^[1-9][0-9]*$/u.test(left) || !/^[1-9][0-9]*$/u.test(right)) {
    throw new Error('Actions run id must be canonical positive decimal text.');
  }
  return right.length - left.length || right.localeCompare(left);
}

function newestRun<T extends { runId: string; runAttempt: number }>(values: readonly T[]): T | null {
  return [...values].sort((left, right) => comparePositiveDecimalDescending(left.runId, right.runId)
    || right.runAttempt - left.runAttempt)[0] ?? null;
}

function branchCloseoutRecoveryArtifactName(input: {
  prNumber: number;
  sessionRevision: `sha256:${string}`;
  runId: string;
  runAttempt: number;
}): string {
  if (!Number.isSafeInteger(input.prNumber) || input.prNumber < 1
    || !/^sha256:[0-9a-f]{64}$/u.test(input.sessionRevision)
    || !/^[1-9][0-9]*$/u.test(input.runId)
    || !Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1) {
    throw new Error('Branch closeout recovery artifact identity is invalid.');
  }
  return `sec-branch-closeout-recovery-v1-pr-${input.prNumber}`
    + `-session-${input.sessionRevision.slice(7)}-run-${input.runId}-attempt-${input.runAttempt}`;
}

export function materializeBranchCloseoutRecoveryArtifact(input: {
  outputPath: string;
  repository: string;
  session: VerificationSession;
  prepared: ReturnType<typeof parsePreparedBranchCloseoutEnvelope>;
  runId: string;
  runAttempt: number;
  environment: Readonly<Record<string, string | undefined>>;
}): Readonly<{
  artifact: BranchCloseoutRecoveryArtifact;
  artifactName: string;
  artifactFilePath: string;
}> {
  const recoveryPath = path.resolve(input.prepared.preparation.recovery.path);
  const recoveryParent = inspectNoFollowDirectoryChain(
    path.dirname(recoveryPath),
    'Branch closeout recovery bundle parent'
  );
  const retainedBundle = retainNoFollowOrdinaryFile(
    recoveryParent,
    path.basename(recoveryPath),
    undefined,
    'Branch closeout recovery bundle'
  );
  let bundleBytes: Buffer;
  try {
    bundleBytes = Buffer.from(retainedBundle.readBytes());
    retainedBundle.assertCurrent();
  } finally {
    retainedBundle.dispose();
  }
  const preparedBytes = `${JSON.stringify(input.prepared, null, 2)}\n`;
  const artifact = createBranchCloseoutRecoveryArtifact({ repository: input.repository,
    pullRequestNumber: input.session.prNumber, sessionRevision: input.session.sessionRevision,
    headSha: input.session.headSha, headTreeSha: input.session.headTreeSha,
    preparedEnvelopeBytes: preparedBytes, recoveryBundleBytes: bundleBytes });
  if (artifact.recoveryBundleDigest !== input.prepared.preparation.recovery.sha256) {
    throw new Error('Materialized recovery artifact bundle differs from the prepared recovery authority.');
  }
  const artifactName = branchCloseoutRecoveryArtifactName({ prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision, runId: input.runId, runAttempt: input.runAttempt });
  const artifactFilePath = path.resolve(path.dirname(input.outputPath),
    BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME);
  writeCanonicalDurable(artifactFilePath, artifact);
  return Object.freeze({ artifact, artifactName, artifactFilePath });
}

export function loadProviderBranchCloseoutRecoveryArtifact(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  session: VerificationSession;
  runId: string;
  runAttempt: number;
}): Readonly<{
  artifact: BranchCloseoutRecoveryArtifact;
  metadata: GitHubActionsArtifactObservation;
  remotePrepared: ReturnType<typeof parsePreparedBranchCloseoutEnvelope>;
  prepared: ReturnType<typeof parsePreparedBranchCloseoutEnvelope>;
}> {
  const expectedName = branchCloseoutRecoveryArtifactName({ prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision, runId: input.runId, runAttempt: input.runAttempt });
  const matches = input.github.observeActionsArtifactsForRun(input.repository, input.runId)
    .filter(({ artifactName }) => artifactName === expectedName);
  if (matches.length !== 1) {
    throw new Error('Closeout recovery requires exactly one provider artifact for the authorization run/attempt.');
  }
  const metadata = matches[0]!;
  if (metadata.expired || metadata.runId !== input.runId || metadata.runAttempt !== input.runAttempt
    || metadata.workflowPath !== '.github/workflows/merge-gate.yml'
    || metadata.workflowRef !== `.github/workflows/merge-gate.yml@${input.session.baseSha}`
    || metadata.workflowSha !== input.session.baseSha || metadata.eventName !== 'repository_dispatch'
    || metadata.actorNodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId
    || metadata.actorPermission !== 'none') {
    throw new Error('Closeout recovery provider artifact provenance drifted.');
  }
  const source = input.github.downloadArtifactText(input.repository, metadata,
    BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME);
  const artifact = parseBranchCloseoutRecoveryArtifact(source);
  if (`${encodeVerificationActionData(artifact)}\n` !== source) {
    throw new Error('Closeout recovery provider artifact bytes are not canonical.');
  }
  if (artifact.repository !== input.repository || artifact.pullRequestNumber !== input.session.prNumber
    || artifact.sessionRevision !== input.session.sessionRevision
    || artifact.headSha !== input.session.headSha || artifact.headTreeSha !== input.session.headTreeSha) {
    throw new Error('Closeout recovery provider artifact Session identity drifted.');
  }
  const preparedSource = Buffer.from(artifact.preparedEnvelopeBase64, 'base64').toString('utf8');
  const remotePrepared = parsePreparedBranchCloseoutEnvelope(preparedSource);
  if (remotePrepared.preparation.repository.fullName !== input.repository
    || remotePrepared.preparation.pullRequestNumber !== input.session.prNumber
    || remotePrepared.preparation.expectedHeadSha !== input.session.headSha
    || remotePrepared.preparation.recovery.sha256 !== artifact.recoveryBundleDigest) {
    throw new Error('Closeout recovery artifact preparation/bundle closure mismatch.');
  }
  const prepared = rehydratePreparedBranchCloseoutRecoveryArtifact({ scope: input.ctx,
    remote: remotePrepared, recoveryBundleBytes: Buffer.from(artifact.recoveryBundleBase64, 'base64') });
  return Object.freeze({ artifact, metadata, remotePrepared, prepared });
}

const HOSTED_SESSION_ARTIFACT_NAME_PATTERN =
  /^sec-verification-session-v2-pr-([1-9][0-9]*)-session-([0-9a-f]{64})-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u;

function hostedSessionArtifactName(input: {
  prNumber: number;
  sessionRevision: `sha256:${string}`;
  runId: string;
  runAttempt: number;
}): string {
  return `sec-verification-session-v2-pr-${input.prNumber}-session-${input.sessionRevision.slice(7)}-run-${input.runId}-attempt-${input.runAttempt}`;
}

function assertHostedArtifactMatchesRequest(
  artifact: ReturnType<typeof CodexDevelopmentParseVerificationSessionArtifact>,
  request: ReturnType<typeof parseVerificationSessionHostedRequest>,
  repository: string
): void {
  const checks: readonly [unknown, unknown, string][] = [
    [artifact.session.repository, repository, 'repository'],
    [artifact.session.prNumber, request.prNumber, 'pull request'],
    [artifact.session.baseSha, request.expectedBaseSha, 'base'],
    [artifact.session.baseTreeSha, request.expectedBaseTreeSha, 'base tree'],
    [artifact.session.headSha, request.expectedHeadSha, 'head'],
    [artifact.session.headTreeSha, request.expectedHeadTreeSha, 'head tree'],
    [artifact.session.manifestPath, request.manifestPath, 'manifest path'],
    [artifact.session.manifestDigest, request.manifestDigest, 'manifest digest'],
    [artifact.session.profile, request.profile, 'profile'],
    [artifact.scopeAuthorization.proposalDigest, request.expectedScopeProposalDigest, 'scope proposal'],
    [artifact.session.actionPlanClosureDigest, request.expectedActionPlanDigest, 'Action plan'],
    [artifact.session.reviewPolicyDigest, request.reviewPolicyDigest, 'Review policy'],
    [artifact.session.sessionRevision, request.expectedSessionRevision, 'Session revision']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`Hosted Session artifact ${label} differs from the trusted request.`);
  }
}

function loadHostedSessionTransport(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  metadata: GitHubActionsArtifactObservation;
  request?: ReturnType<typeof parseVerificationSessionHostedRequest>;
}): Readonly<{
  artifact: ReturnType<typeof CodexDevelopmentParseVerificationSessionArtifact>;
  artifactText: string;
  metadata: GitHubActionsArtifactObservation;
  observation: ReturnType<typeof createHostedArtifactObservation>;
}> {
  const { github, repository, metadata, request } = input;
  if (metadata.expired) throw new Error('Hosted Session artifact transport is expired.');
  const name = HOSTED_SESSION_ARTIFACT_NAME_PATTERN.exec(metadata.artifactName);
  if (name === null) throw new Error('Hosted Session artifact name is not canonical.');
  const prNumber = Number(name[1]);
  const sessionRevision = `sha256:${name[2]}` as const;
  const runAttempt = Number(name[4]);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 || name[3] !== metadata.runId
    || !Number.isSafeInteger(runAttempt) || runAttempt !== metadata.runAttempt) {
    throw new Error('Hosted Session artifact name differs from immutable run metadata.');
  }
  const artifactText = github.downloadArtifactText(repository, metadata,
    'verification-session-artifact.json');
  const artifact = CodexDevelopmentParseVerificationSessionArtifact(artifactText);
  const expectedName = hostedSessionArtifactName({ prNumber: artifact.session.prNumber,
    sessionRevision: artifact.session.sessionRevision, runId: metadata.runId,
    runAttempt: metadata.runAttempt });
  if (artifact.session.repository !== repository || artifact.session.prNumber !== prNumber
    || artifact.session.sessionRevision !== sessionRevision || metadata.artifactName !== expectedName
    || metadata.workflowPath !== '.github/workflows/compiler-pr-validation.yml'
    || metadata.workflowSha !== artifact.session.baseSha
    || metadata.workflowRef !== `${metadata.workflowPath}@${artifact.session.baseSha}`
    || metadata.eventName !== 'repository_dispatch'
    || metadata.actorPermission !== 'maintain' && metadata.actorPermission !== 'admin') {
    throw new Error('Hosted Session artifact transport does not bind its canonical Session identity.');
  }
  if (request !== undefined) assertHostedArtifactMatchesRequest(artifact, request, repository);
  const observation = createHostedArtifactObservation({ artifact, artifactText, observation: metadata });
  return Object.freeze({ artifact, artifactText, metadata, observation });
}

export function selectTrustedHostedSessionArtifact(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  transports: readonly GitHubActionsArtifactObservation[];
  request?: ReturnType<typeof parseVerificationSessionHostedRequest>;
  requireSingleTransport?: boolean;
}): Readonly<{
  artifact: ReturnType<typeof CodexDevelopmentParseVerificationSessionArtifact>;
  origin: ReturnType<typeof createHostedArtifactObservation>;
  transport: ReturnType<typeof createHostedArtifactObservation>;
  originMetadata: GitHubActionsArtifactObservation;
  transportMetadata: GitHubActionsArtifactObservation;
  originText: string;
  transportText: string;
}> | null {
  const { github, repository, request } = input;
  const exactPrefix = request === undefined ? 'sec-verification-session-v2-pr-'
    : `sec-verification-session-v2-pr-${request.prNumber}-session-${request.expectedSessionRevision.slice(7)}-run-`;
  const candidates = input.transports.filter((entry) =>
    !entry.expired && entry.artifactName.startsWith(exactPrefix));
  if (candidates.length === 0) return null;
  if (input.requireSingleTransport === true && candidates.length !== 1) {
    throw new Error('Expected exactly one trusted Session artifact on the triggering compiler run.');
  }
  const identities = new Set<string>();
  const loaded = candidates.map((metadata) => {
    const identity = `${metadata.runId}:${metadata.runAttempt}`;
    if (identities.has(identity)) throw new Error('Duplicate hosted Session artifact transport identity.');
    identities.add(identity);
    return loadHostedSessionTransport({ github, repository, metadata,
      ...(request === undefined ? {} : { request }) });
  });
  const canonicalText = loaded[0]!.artifactText;
  if (loaded.some((entry) => entry.artifactText !== canonicalText)) {
    throw new Error('Hosted Session artifact transports for one Session are not byte-identical.');
  }
  const selected = newestRun(loaded.map((entry) => ({ ...entry,
    runId: entry.metadata.runId, runAttempt: entry.metadata.runAttempt })))!;
  const producer = selected.artifact.producer;
  const originName = hostedSessionArtifactName({ prNumber: selected.artifact.session.prNumber,
    sessionRevision: selected.artifact.session.sessionRevision, runId: producer.runId,
    runAttempt: producer.runAttempt });
  const originCandidates = github.observeActionsArtifactsForRun(repository, producer.runId)
    .filter((entry) => !entry.expired && entry.artifactName === originName);
  if (originCandidates.length !== 1) {
    throw new Error('Expected exactly one immutable origin Session artifact.');
  }
  const origin = loadHostedSessionTransport({ github, repository, metadata: originCandidates[0]!,
    ...(request === undefined ? {} : { request }) });
  if (origin.artifactText !== canonicalText || origin.artifact.artifactDigest !== selected.artifact.artifactDigest
    || origin.metadata.runId !== producer.runId || origin.metadata.runAttempt !== producer.runAttempt
    || origin.metadata.workflowPath !== producer.workflowPath
    || origin.metadata.workflowRef !== producer.workflowRef
    || origin.metadata.workflowSha !== producer.workflowSha
    || origin.metadata.actorNodeId !== producer.actorNodeId) {
    throw new Error('Hosted artifact origin and trusted transport provenance are not byte-identical.');
  }
  const sameRun = origin.metadata.runId === selected.metadata.runId
    && origin.metadata.runAttempt === selected.metadata.runAttempt;
  if (sameRun !== (origin.metadata.artifactId === selected.metadata.artifactId)) {
    throw new Error('Hosted artifact direct versus reuploaded identity is inconsistent.');
  }
  return Object.freeze({ artifact: selected.artifact, origin: origin.observation,
    transport: selected.observation, originMetadata: origin.metadata,
    transportMetadata: selected.metadata, originText: origin.artifactText,
    transportText: selected.artifactText });
}

export function loadHostedArtifactForMergeWorkflow(
  github: VerificationSessionGitHubClient,
  repository: string,
  event: Record<string, any>
) {
  const wakeup = hostedMergeWakeupLocator(event);
  const transportRunId = wakeup.sourceRunId;
  const sourceRunAttempt = wakeup.sourceRunAttempt;
  const selected = selectTrustedHostedSessionArtifact({ github, repository,
    transports: github.observeActionsArtifactsForRun(repository, transportRunId),
    requireSingleTransport: true });
  if (selected === null || selected.transportMetadata.runId !== transportRunId
    || selected.transportMetadata.runAttempt !== sourceRunAttempt) {
    throw new Error('Triggering compiler run does not contain the exact trusted Session transport.');
  }
  return selected;
}

export function hostedMergeWakeupLocator(event: Record<string, any>): Readonly<{
  eventName: 'workflow_run';
  sourceRunId: string;
  sourceRunAttempt: number;
}> {
  const run = event.workflow_run;
  if (event.action !== 'completed' || run === null || typeof run !== 'object'
    || !Number.isSafeInteger(run.id) || run.id < 1
    || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error('Merge workflow event is not a bounded compiler completion wakeup.');
  }
  return Object.freeze({ eventName: 'workflow_run' as const, sourceRunId: String(run.id),
    sourceRunAttempt: run.run_attempt });
}
