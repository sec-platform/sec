/** VerificationSession physical owner recovered from current-main semantics. */
import { compileIssueDisposition, createIssueAcceptanceId, createIssueDispositionPlan, type IssueDisposition, type IssueDispositionDigest, type IssueDispositionPlan } from '../../../../self-hosting/control/issues/disposition.ts';
import { observeGitHubIssue, observeUnexpectedGitHubIssueClosures } from '../../../../self-hosting/control/issues/issue-disposition-github.ts';
import { CodexDevelopmentParseCurrentWorkPackageManifest, CodexDevelopmentParseWorkPackageManifest, CodexDevelopmentWorkPackageManifestDigest } from '../../../../self-hosting/control/task/contract/work-package.ts';
import { exactCommitMarker } from './merge-commit-marker.ts';
import { loadMergedHostedCloseoutContext } from './session-integration-observation.ts';
import type { GitHubCandidateObservation, VerificationSessionGitHubClient } from './verification-session-github.ts';
import { compilePostMainIssueDispositionHealthReadback } from './verification-session-runtime.ts';

export function observeExactIssueDispositionPlan(input: Readonly<{
  github: VerificationSessionGitHubClient;
  repository: string;
  candidate: GitHubCandidateObservation;
  manifestPath: string;
  manifestDigest: IssueDispositionDigest;
  tracking: ReturnType<typeof CodexDevelopmentParseWorkPackageManifest>['tracking'];
}>): IssueDispositionPlan {
  const closingFacts = input.github.observePullRequestClosingFacts(
    input.repository,
    input.candidate.number
  );
  if (closingFacts.state !== input.candidate.state
      || closingFacts.title !== input.candidate.title
      || closingFacts.body !== input.candidate.body
      || closingFacts.mergeCommitSha !== input.candidate.mergeCommitSha) {
    throw new Error('IssueDisposition PR prose or provider closing references drifted across observation owners.');
  }
  return createIssueDispositionPlan({
    repository: input.repository,
    prNumber: input.candidate.number,
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    tracking: input.tracking,
    title: input.candidate.title,
    body: input.candidate.body,
    linkedClosingIssues: closingFacts.closingIssues
  });
}

const ISSUE_DISPOSITION_COMMIT_MARKERS = Object.freeze([
  'Issue-Disposition-Plan',
  'Issue-Disposition-Mode',
  'Issue-Disposition-Tracking',
  'Issue-Disposition-Prose'
] as const);

function issueDispositionCommitMarkerState(message: string): 'complete' | 'absent' {
  const lines = message.split(/\r?\n/u);
  const counts = ISSUE_DISPOSITION_COMMIT_MARKERS.map((name) => {
    const prefix = `${name}:`;
    return lines.filter((line) => line.startsWith(prefix)).length;
  });
  if (counts.every((count) => count === 0)) return 'absent';
  if (counts.every((count) => count === 1)) return 'complete';
  throw new Error('Merged commit contains a partial or duplicate IssueDisposition marker set.');
}

/**
 * An exact merged commit with the current IssueDisposition marker set must
 * reconcile every provider-reported closing Issue before any post-merge
 * effect.  This remains read-only: a non-no-op result is deliberately a
 * maintainer boundary, never an optimistic closeout permit.
 */

export function observePostMergeIssueReconciliation(input: Readonly<{
  repository: string;
  prNumber: number;
  candidate: GitHubCandidateObservation;
}>): Readonly<Record<string, unknown>> {
  const { candidate } = input;
  if (candidate.state !== 'MERGED' || candidate.mergeCommitSha === null
    || candidate.mergeCommitMessage === null
    || issueDispositionCommitMarkerState(candidate.mergeCommitMessage) === 'absent') {
    return Object.freeze({ status: 'no-disposition-markers', results: Object.freeze([]) });
  }
  const results = observeUnexpectedGitHubIssueClosures({ repository: input.repository,
    prNumber: input.prNumber, mergeCommitSha: candidate.mergeCommitSha });
  const nonNoOp = results.filter(({ status }) => status !== 'no-op');
  return Object.freeze({
    status: nonNoOp.length === 0 ? 'no-op'
      : nonNoOp.some(({ status }) => status === 'blocked') ? 'blocked'
      : 'manual-action-required',
    results
  });
}

type HostedTrackingIssueDispositionObservation =
  | Readonly<{ status: 'no-disposition-markers'; reason: 'issue-disposition-markers-absent' }>
  | Readonly<{ status: 'no-tracking-issue'; planDigest: `sha256:${string}` }>
  | Readonly<{ status: 'progressed'; receipt: IssueDisposition }>;

export function observeHostedTrackingIssueDisposition(input: Readonly<{
  github: VerificationSessionGitHubClient;
  repository: string;
  closeout: ReturnType<typeof loadMergedHostedCloseoutContext>;
  observedAt: string;
}>): HostedTrackingIssueDispositionObservation {
  const { closeout, github, repository } = input;
  const artifact = closeout.hosted.artifact;
  const session = artifact.session;
  const candidate = closeout.candidate;
  if (candidate.mergeCommitSha === null || candidate.mergeCommitTreeSha === null
    || candidate.mergeCommitMessage === null) {
    throw new Error('IssueDisposition hosted closeout requires exact merge readback.');
  }
  if (issueDispositionCommitMarkerState(candidate.mergeCommitMessage) === 'absent') {
    return Object.freeze({ status: 'no-disposition-markers', reason: 'issue-disposition-markers-absent' });
  }
  const mode = exactCommitMarker(candidate.mergeCommitMessage, 'Issue-Disposition-Mode');
  if (mode !== 'progress-only' && mode !== 'close-tracking-after-readback') {
    throw new Error('Merged IssueDisposition mode marker is invalid.');
  }
  const trackingMarker = exactCommitMarker(candidate.mergeCommitMessage,
    'Issue-Disposition-Tracking');
  if (trackingMarker !== 'none' && !/^[1-9][0-9]*$/u.test(trackingMarker)) {
    throw new Error('Merged IssueDisposition tracking marker is invalid.');
  }
  const trackingIssueNumber = trackingMarker === 'none' ? null : Number(trackingMarker);
  if (trackingIssueNumber !== null && !Number.isSafeInteger(trackingIssueNumber)) {
    throw new Error('Merged IssueDisposition tracking marker exceeds safe integer range.');
  }
  const manifestSource = github.readBlobText(repository, session.headSha, session.manifestPath);
  if (CodexDevelopmentWorkPackageManifestDigest(manifestSource) !== session.manifestDigest) {
    throw new Error('IssueDisposition exact merged manifest bytes differ from the Session.');
  }
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource, session.manifestPath);
  const plan = observeExactIssueDispositionPlan({
    github,
    repository,
    candidate,
    manifestPath: session.manifestPath,
    manifestDigest: session.manifestDigest,
    tracking: manifest.tracking
  });
  if (plan.mode !== mode || plan.trackingIssueNumber !== trackingIssueNumber
    || plan.titleBodyDigest !== exactCommitMarker(candidate.mergeCommitMessage,
      'Issue-Disposition-Prose')
    || plan.planDigest !== exactCommitMarker(candidate.mergeCommitMessage,
      'Issue-Disposition-Plan')) {
    throw new Error('IssueDisposition merge markers differ from the exact live plan.');
  }
  if (trackingIssueNumber === null) {
    return Object.freeze({ status: 'no-tracking-issue', planDigest: plan.planDigest });
  }
  const issue = observeGitHubIssue(repository, trackingIssueNumber);
  const acceptanceIds = manifest.acceptance.map((text, index) =>
    createIssueAcceptanceId({ manifestDigest: session.manifestDigest, index, text }));
  const reviewReceipt = closeout.selected.publication.result.reviewReceipt;
  const authorization = closeout.selected.publication.result.authorization;
  const untypedEvidenceRefs = [artifact.evidence.evidenceDigest, reviewReceipt.receiptDigest,
    authorization.receiptDigest];
  if (untypedEvidenceRefs.some((value) => !/^sha256:[0-9a-f]{64}$/u.test(value))) {
    throw new Error('IssueDisposition evidence reference is not one SHA-256 digest.');
  }
  const evidenceRefs = untypedEvidenceRefs as `sha256:${string}`[];
  const mainHealth = mode === 'close-tracking-after-readback'
    ? compilePostMainIssueDispositionHealthReadback({
        repository,
        newMainSha: candidate.mergeCommitSha,
        newMainTreeSha: candidate.mergeCommitTreeSha,
        observedAt: input.observedAt,
        sourceRunId: closeout.identity.provenance.runId,
        sourceRef: closeout.identity.provenance.workflowRef,
        checks: github.observeChecks(repository, candidate.mergeCommitSha)
      })
    : null;
  const postMainEvidenceRefs = mainHealth !== null
    ? [...evidenceRefs, mainHealth.ledgerDigest]
    : evidenceRefs;
  const disposition = compileIssueDisposition({ plan,
    currentSpecRevision: issue.specRevision, acceptanceIds,
    newMainSha: candidate.mergeCommitSha, newMainTreeSha: candidate.mergeCommitTreeSha,
    evidenceRefs: postMainEvidenceRefs, expectedProviderState: issue.state });
  return Object.freeze({ status: disposition.kind, receipt: disposition });
}
