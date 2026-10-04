#!/usr/bin/env bun
import { cloneAndDeepFreeze } from '../../../../../contracts/canonical.ts';
import { parseDigest } from '../../../../../contracts/digest.ts';
import type { CiVerificationActionPlanClosure } from '../../../../../execution/verification/action.ts';
import type { BranchCloseoutEffectStartPublication, BranchCloseoutOperationPublication, BranchCloseoutOperationReceipt, HostedWorkflowCommentProvenance, PreparedBranchCloseoutEnvelope } from '../../../../../execution/verification/branch-closeout.ts';
import type { HostedCloseoutEffectStartReadback, HostedCloseoutTerminalReadback, HostedIntegrationAuthorizationPublicationReadback, HostedIntegrationIdentity, HostedRecoveryArtifactMaterialization, HostedRecoveryArtifactObservation, HostedSquashMergeResponse } from '../../../../../execution/verification/hosted.ts';
import type { HostedIntegrationPhase, HostedIntegrationPhaseOwnership, IntegrationAuthorizationOperationPublication, IssueDispositionDigest, IssueDispositionPlan } from '../../../../../execution/verification/integration.ts';
import type { GitHubActionsArtifactObservation, GitHubCandidateObservation, ReviewStabilityReceipt, TrustedRuntimeProof, VerificationSession } from '../../../../../execution/verification/session.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/budget.ts';
import { GITHUB_API_BASE_URL } from '../../../../providers/github-api/contract.ts';
import { createDelegatedHostedWorkflowCommentProvenance } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { hostedSessionArtifactName } from '../contract/revision.ts';
/**
 * SEC canonical VerificationSession V2 operator CLI.
 *
 * The public command/flag contract is the USAGE table below. Authority-bearing
 * artifact bytes are always discovered and downloaded by the GitHub adapter;
 * caller-local artifact paths are accepted only by trusted hosted construction
 * and read-only projection commands, never by resume or merge execution.
 */

import {
  parseOpenPullRequestList,
  projectWorkPackageRegistry
} from '../../session/runtime/work-package-registry.ts';

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  realpathSync
} from 'node:fs';
import path from 'node:path';
import { rawSha256 } from '../../../../../contracts/canonical.ts';

import { readJson, readSessionArtifactBytes, readSessionArtifactText, writeCanonicalDurable, writeDurable } from './session-artifact-files.ts';

import { CodedFailure } from '../../../../../contracts/failure.ts';

import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../../../../filesystem/write-lease.ts';
import { createIssueDispositionPlan, parseGitHubClosingKeywordOccurrences } from '../../../../self-hosting/control/issues/disposition.ts';

import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/session.ts';



import { createRuntimeStateJournalFileSystem } from '../../../../runtime-state/workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeJournalAuthority } from '../../../../runtime-state/workspace-state/physical-authority.ts';
import { BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME, createBranchCloseoutOperationBinding, createBranchCloseoutRecoveryArtifact, parseBranchCloseoutRecoveryArtifact } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME, assertBranchCloseoutEffectStartMatches, assertHostedCommentProvenanceLive, createBranchCloseoutEffectStartPublication, createBranchCloseoutOperationPublication, createHostedWorkflowCommentProvenance, hostedPublisherMatches, issueCommentRecord, observeBranchCloseoutEffectStartPublication, observeBranchCloseoutOperationPublication, parseBranchCloseoutEffectStartPublicationComment, parseBranchCloseoutOperationPublicationComment, renderBranchCloseoutEffectStartPublicationComment, renderBranchCloseoutOperationPublicationComment } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { parsePreparedBranchCloseoutEnvelope, rehydratePreparedBranchCloseoutRecoveryArtifact } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { assertGitBranchName } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { createBranchLifecycleGitHubCredentialArgs, decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { collectBranchLifecycleInventory } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';

import {
  createLocalMainCloseoutBindingFromHostedAuthority,
  executeLocalMainCloseout
} from '../../../../self-hosting/control/branch-lifecycle/local-main-closeout.ts';
import {
  assertTrustedCompletedWorktreePhysicalCloseout,
  executeWorktreePhysicalCloseout,
  prepareTrustedWorktreePhysicalCloseout,
  type WorktreePhysicalCloseoutConsumptionToken
} from '../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import {
  observeActiveWorkPackage
} from '../../../../self-hosting/control/documentation/document-control-plane.ts';
import { assertHostedIntegrationPhaseOwnership, observeIntegrationAuthorizationOperationPublications, parseIntegrationAuthorizationOperationPublication, parseIntegrationAuthorizationOperationPublicationComment, renderIntegrationAuthorizationOperationPublicationComment, selectCanonicalIntegrationRunOwner } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import {
  CodexDevelopmentParseMergeGateResult,
  assertCanonicalMergeMessage,
  createDelegatedHostedArtifactObservation
} from '../../../../self-hosting/control/integration/merge-gate.ts';
import { observeUnexpectedGitHubIssueClosures } from '../../../../self-hosting/control/issues/issue-disposition-github.ts';

import { getCiVerificationPerJobHostedJobPolicy } from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import { HOSTED_RESUME_DISPATCH_EVENT, parseHostedResumeDispatchSignal } from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, type AuthenticatedGitHubJobOrigin } from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  CodexDevelopmentAssertWorkPackageOwnership,
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageAcceptsObservedBase,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../../../self-hosting/control/task/contract/work-package.ts';
import { executeVerifiedCiActionPlan } from '../../../../self-hosting/development/runner/verification-action-executor.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationActionParentDispatchPlanFile, createCiVerificationLocalExecutionEnvironment, parseCiVerificationActionParentDispatchPlan, type CiVerificationExecutionEnvironment } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, matchesCiCompilerWorkflowRunIdentity } from '../../action/contract/provider.ts';
import {
  executeLocalVerificationActionDag,
  type LocalVerificationActionDagResult
} from '../../action/runner.ts';
import { renderIndependentReviewTrailer } from '../../review/contract/stability.ts';
import { VERIFICATION_SESSION_RUNTIME_ENTRYPOINT_PATH, parseVerificationSession } from '../../session/contract/session.ts';
import type { CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../trust/contract/root.ts';
import {
  CodexDevelopmentAssertVerificationSessionArtifact,
  CodexDevelopmentParseVerificationSessionArtifact,
  parseHostedSessionTerminalArtifact
} from '../contract/evidence.ts';
import {
  CodexDevelopmentDefaultChangedPaths,
  CodexDevelopmentExactGitWorkspaceSourceSnapshot,
  CodexDevelopmentTestImpactSourceProviderFromSnapshot
} from './ci-orchestration-core.ts';
import { assertHostedCompilerDispatchPayload, assertHostedCompilerInternalProvenance } from './hosted-compiler-provenance.ts';
import { acquireLocalCandidateWorktree } from './local-candidate-worktree.ts';
import { authenticateHistoricalHostedSessionTerminalSource } from './verification-action-github-provider.ts';

import { parseVerificationSessionHostedRequest } from "../contract/session-request.ts";
import { createReviewProviderRevalidationCommentBody, createVerificationSessionGitHubClient, shouldPublishMaintainerReviewWakeup, type VerificationSessionGitHubClient } from './verification-session-github.ts';
import {
  appendVerificationSessionJournalEvent,
  createVerificationSessionOperationId,
  readVerificationSessionJournal,
  type VerificationSessionJournalFileSystem
} from './verification-session-journal.ts';
import { assertTrustedExactRevisionRuntime, assertTrustedMainRuntime, assertTrustedMergedRequestRuntimeReachability, assertTrustedMergedRuntimeReachability, classifyVerificationSessionArtifactReuse, createHostedArtifactObservation, createTrustedHostedArtifactProvenance, integrationMergeMarkers, parseVerificationSessionLocalPreparationRequest, prepareLocalQuickVerificationActionPlan, prepareTrustedMainVerificationSession } from './verification-session-runtime.ts';
export { assertHostedCompilerDispatchPayload, assertHostedCompilerInternalProvenance } from './hosted-compiler-provenance.ts';

import { exactCommitMarker } from './merge-commit-marker.ts';
import {
  classifyDurableVerificationSessionProjection,
  selectMergedAuthorizationPublication
} from './verification-session-integration-routing.ts';

export { readExactCommitMarker } from './merge-commit-marker.ts';
export { deleteHostedLocalRefCas } from './session-branch-closeout-effects.ts';
export { HOSTED_INTEGRATION_ROUTE_SCHEMA, classifyDurableVerificationSessionProjection, planHostedIntegrationEffects, routeHostedIntegration } from './verification-session-integration-routing.ts';

import type { withAuthenticatedPostMergeMainHealth } from '../../../../self-hosting/control/composition/trusted-runtime-closeout.ts';
import { assertHostedCloseoutMainHealthCurrent, evaluateHostedCloseoutEffectPreconditionsUnderLease, finalizeHostedBranchCloseout } from './session-branch-closeout-effects.ts';
import {
  SESSION_COMMAND_MAX_BUFFER,
  assertBorrowedHostedSessionSourceCurrent, requireCommand, requireVerificationSessionCommandText,
  retainHistoricalHostedSessionSource,
  runVerificationSessionCommand,
  selectHistoricalHostedSessionSource,
  type VerificationSessionScope
} from './session-command.ts';

function createVerificationSessionScope(input: VerificationSessionScope): VerificationSessionScope {
  return Object.freeze({ ...input });
}

export async function createBranchLifecycleVerificationScope(
  repositoryRoot: string
): Promise<VerificationSessionScope> {
  return createVerificationSessionScope({
    repositoryRoot,
    activeWorkPackageObservation: await observeActiveWorkPackage(repositoryRoot)
  });
}

export async function observeVerificationSessionChangedSelection(input: {
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  candidate: GitHubCandidateObservation;
  github: VerificationSessionGitHubClient;
}): Promise<Readonly<{
  changedPaths: readonly string[];
  testImpactSourceProvider: ReturnType<typeof CodexDevelopmentTestImpactSourceProviderFromSnapshot>;
  testImpactTransition: CodexDevelopmentTestImpactTransitionObservation;
}>> {
  const provider = (await input.github.observeChangedPaths({
    repository: input.repository,
    prNumber: input.prNumber,
    state: 'OPEN',
    draft: false,
    baseSha: input.candidate.baseSha,
    headSha: input.candidate.headSha
  }));
  const exactObservation = await withAuthorityGitReadSession({
    cwd: input.repositoryRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, async (session) => Object.freeze({
    exact: await CodexDevelopmentDefaultChangedPaths(
      session,
      input.candidate.baseSha,
      input.candidate.headSha
    ),
    workspaceSnapshot: await CodexDevelopmentExactGitWorkspaceSourceSnapshot(
      session,
      input.candidate.headSha
    )
  }));
  const { exact } = exactObservation;
  if (JSON.stringify(exact.files) !== JSON.stringify(provider.paths)) {
    throw new Error('VerificationSession provider inventory differs from the exact Git base/head transition.');
  }
  return Object.freeze({
    changedPaths: Object.freeze([...provider.paths]),
    testImpactSourceProvider: CodexDevelopmentTestImpactSourceProviderFromSnapshot(
      exactObservation.workspaceSnapshot,
      input.repositoryRoot
    ),
    testImpactTransition: exact.transitionObservation
  });
}

type TrustedRemoteDefaultIdentity = Readonly<{
  remote: string;
  defaultBranch: string;
  remoteRef: string;
  localRef: string;
}>;

type TrustedRemoteExactRefObservation = Readonly<{
  state: 'present' | 'absent';
  sha: string | null;
}>;

function trustedRemoteDefaultIdentity(
  defaultBranch = 'main',
  remote = 'origin'
): TrustedRemoteDefaultIdentity {
  assertGitBranchName(defaultBranch, 'Trusted remote default branch');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(remote)) {
    throw new Error('Trusted remote default identity is invalid.');
  }
  return Object.freeze({
    remote,
    defaultBranch,
    remoteRef: `refs/heads/${defaultBranch}`,
    localRef: `refs/remotes/${remote}/${defaultBranch}`
  });
}

/**
 * Observe one exact hosted branch ref without depending on actions/checkout
 * credential persistence or ambient Git credential helpers. GH_TOKEN/gh
 * ownership stays with the caller environment; this helper fixes only the
 * finite Git command and exact single-ref response shape.
 */
function observeTrustedRemoteExactRef(input: {
  ctx: VerificationSessionScope;
  remote: string;
  remoteRef: string;
  label: string;
  cwd?: string;
}): TrustedRemoteExactRefObservation {
  const headPrefix = 'refs/heads/';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.remote)
      || !input.remoteRef.startsWith(headPrefix)) {
    throw new Error('Trusted remote exact-ref identity is invalid.');
  }
  assertGitBranchName(input.remoteRef.slice(headPrefix.length), 'Trusted remote exact-ref branch');
  const result = runVerificationSessionCommand(input.ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'ls-remote', '--exit-code', input.remote, input.remoteRef
  ], input.cwd);
  const source = decodeBranchLifecycleChildStdout(result);
  if (result.status === 2 && source.trim().length === 0) {
    return Object.freeze({ state: 'absent', sha: null });
  }
  if (result.status !== 0) {
    throw new Error(`${input.label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  const lines = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) {
    throw new Error('Trusted remote exact-ref readback is incomplete or ambiguous.');
  }
  const match = /^([0-9a-f]{40})\t(.+)$/u.exec(lines[0]!);
  const observedRef = match?.[2] ?? '';
  if (!observedRef.startsWith(headPrefix)) {
    throw new Error('Trusted remote exact-ref readback is malformed.');
  }
  assertGitBranchName(observedRef.slice(headPrefix.length), 'Trusted remote exact-ref readback branch');
  if (match === null || observedRef !== input.remoteRef) {
    throw new Error('Trusted remote exact-ref readback is malformed.');
  }
  return Object.freeze({ state: 'present', sha: match[1]! });
}

function readTrustedRemoteDefaultRef(input: {
  ctx: VerificationSessionScope;
  identity: TrustedRemoteDefaultIdentity;
  label: string;
}): string {
  const observed = observeTrustedRemoteExactRef({
    ctx: input.ctx,
    remote: input.identity.remote,
    remoteRef: input.identity.remoteRef,
    label: input.label
  });
  if (observed.state !== 'present' || observed.sha === null) {
    throw new Error('Trusted remote default readback is absent.');
  }
  return observed.sha;
}

/** Live production proof. The command runner is fixed inside the opaque context. */
export function inspectTrustedRuntime(input: {
  repositoryRoot: string;
  defaultBranch?: string;
  remote?: string;
  candidateHeadSha?: string;
}): TrustedRuntimeProof {
  const identity = trustedRemoteDefaultIdentity(input.defaultBranch, input.remote);
  const ctx = createVerificationSessionScope({ repositoryRoot: input.repositoryRoot });
  const currentHeadSha = requireCommand(ctx, 'git', ['rev-parse', 'HEAD'], 'HEAD readback');
  const currentBranch = requireCommand(ctx, 'git', ['branch', '--show-current'], 'branch readback');
  const localDefaultSha = requireCommand(ctx, 'git', ['rev-parse', identity.localRef], 'local default readback');
  const remoteDefaultSha = readTrustedRemoteDefaultRef({
    ctx, identity, label: 'remote default readback'
  });
  const workingTreeClean = requireCommand(ctx, 'git', [
    'status', '--porcelain=v1', '--untracked-files=all'
  ], 'worktree readback').length === 0;
  // Exact clean Git identity proves every tracked byte, including the TCB.
  // Candidate TCB compilation is an Impact-selected Verification Action and
  // must not run before changed-path selection on unrelated operations.
  const entrypointPath = VERIFICATION_SESSION_RUNTIME_ENTRYPOINT_PATH;
  const runtimeEntrypointBlobMatched = requireCommand(
    ctx, 'git', ['rev-parse', `${currentHeadSha}:${entrypointPath}`], 'runtime entrypoint trusted blob'
  ) === requireCommand(ctx, 'git', ['hash-object', '--', entrypointPath], 'runtime entrypoint working blob');
  let boundaryTargetsMatched = true;
  for (const edge of SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedBoundaryEdges) {
    const target = edge.split(' -> ')[1];
    if (target === undefined || !SEC_TRUSTED_BOOTSTRAP_REGISTRY.staticExactPaths.includes(target)) {
      boundaryTargetsMatched = false;
      break;
    }
    const trustedBlob = requireCommand(ctx, 'git', ['rev-parse', `${currentHeadSha}:${target}`], `boundary target ${target}`);
    const workingBlob = requireCommand(ctx, 'git', ['hash-object', '--', target], `working boundary target ${target}`);
    const candidateBlob = input.candidateHeadSha === undefined ? trustedBlob
      : requireCommand(ctx, 'git', ['rev-parse', `${input.candidateHeadSha}:${target}`], `candidate boundary target ${target}`);
    if (trustedBlob !== workingBlob || trustedBlob !== candidateBlob) {
      boundaryTargetsMatched = false;
      break;
    }
  }
  return Object.freeze({ currentHeadSha, currentBranch, localDefaultSha, remoteDefaultSha,
    workingTreeClean, runtimeEntrypointBlobMatched, boundaryTargetsMatched });
}

export function synchronizeTrustedRemoteDefaultRef(input: {
  ctx: VerificationSessionScope;
  defaultBranch?: string;
  remote?: string;
}): Readonly<{ defaultSha: string; headSha: string }> {
  const identity = trustedRemoteDefaultIdentity(input.defaultBranch, input.remote);
  const readLive = (label: string): string => {
    return readTrustedRemoteDefaultRef({ ctx: input.ctx, identity, label });
  };

  const headBefore = requireVerificationSessionCommandText(
    input.ctx, 'git', ['rev-parse', 'HEAD'], 'pre-synchronization HEAD readback'
  );
  const liveBefore = readLive('pre-synchronization live default readback');
  const fetched = runVerificationSessionCommand(input.ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'fetch', '--no-tags', '--no-recurse-submodules', identity.remote,
    `+${identity.remoteRef}:${identity.localRef}`
  ]);
  if (fetched.status !== 0) {
    throw new Error(
      `Trusted remote default ref-only fetch failed: ${decodeBranchLifecycleChildError(fetched)}`
    );
  }
  const localAfter = requireVerificationSessionCommandText(
    input.ctx, 'git', ['rev-parse', identity.localRef], 'post-synchronization local default readback'
  );
  const liveAfter = readLive('post-synchronization live default readback');
  const headAfter = requireVerificationSessionCommandText(
    input.ctx, 'git', ['rev-parse', 'HEAD'], 'post-synchronization HEAD readback'
  );
  if (headAfter !== headBefore) {
    throw new Error('Trusted remote default ref-only fetch changed HEAD.');
  }
  if (liveBefore !== liveAfter || localAfter !== liveAfter) {
    throw new Error('Trusted remote default changed during synchronized ref-only fetch.');
  }
  return Object.freeze({ defaultSha: liveAfter, headSha: headAfter });
}

export async function observeVerificationSessionActionDependencyBlobs(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  baseSha: string;
  headSha: string;
}) {
  const blobs = [];
  for (const dependencyPath of CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS) {
    blobs.push(Object.freeze({ path: dependencyPath,
      baseSource: await input.github.readBlobText(input.repository, input.baseSha, dependencyPath),
      candidateSource: await input.github.readBlobText(input.repository, input.headSha, dependencyPath)
    }));
  }
  return Object.freeze(blobs);
}

function comparableFileSystemPath(filePath: string): string {
  const absolute = path.resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function exactRealPath(filePath: string, label: string): string {
  const resolved = path.resolve(filePath);
  const metadata = lstatSync(resolved);
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symlink or reparse point.`);
  const real = realpathSync.native(resolved);
  if (comparableFileSystemPath(real) !== comparableFileSystemPath(resolved)) {
    throw new Error(`${label} must resolve without filesystem indirection.`);
  }
  return real;
}

function gitText(ctx: VerificationSessionScope, cwd: string, args: readonly string[], label: string): string {
  return requireVerificationSessionCommandText(ctx, 'git', args, label, cwd).trim();
}

function commonGitDirectory(ctx: VerificationSessionScope, repositoryRoot: string): string {
  const source = gitText(ctx, repositoryRoot,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'Git common directory readback');
  return exactRealPath(source, 'Git common directory');
}

async function executePreparedLocalQuickDag(input: {
  authorityRoot: string;
  candidate: GitHubCandidateObservation;
  sessionRevision: `sha256:${string}`;
  actionPlanClosure: CiVerificationActionPlanClosure;
  executionEnvironment: CiVerificationExecutionEnvironment;
  environment: NodeJS.ProcessEnv;
}, closeoutOperations: import('../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts').WorktreePhysicalCloseoutOperations): Promise<Readonly<{
  result: LocalVerificationActionDagResult;
  worktreeDisposition: 'created-and-removed' | 'reused-and-removed' | 'retained-blocked'
    | 'retained-physical-closeout-blocked' | 'physical-closeout-unsettled' | 'worktree-closed-marker-unsettled';
}>> {
  const lease = await acquireLocalCandidateWorktree({
    authorityRoot: input.authorityRoot, candidate: input.candidate,
    sessionRevision: input.sessionRevision,
    actionPlanDigest: input.actionPlanClosure.actionPlanDigest as `sha256:${string}`,
    maximumRepositoryObservations: input.actionPlanClosure.actions.length + 2
  }, closeoutOperations);
  try {
    const result = await executeLocalVerificationActionDag({
      authorityRoot: lease.owner.authorityRoot,
      candidateRoot: lease.owner.candidateRoot,
      actionPlanClosure: input.actionPlanClosure,
      executionEnvironment: input.executionEnvironment,
      environment: input.environment,
      executeActionPlan: (providerInput) => executeVerifiedCiActionPlan(providerInput),
      inspectRepository: lease.inspectRepository
    });
    if (result.status === 'blocked') {
      return Object.freeze({ result, worktreeDisposition: 'retained-blocked' });
    }
    const scratchCloseout = await lease.closeout();
    if (scratchCloseout !== 'removed') {
      return Object.freeze({ result, worktreeDisposition: scratchCloseout });
    }
    return Object.freeze({ result,
      worktreeDisposition: lease.reused ? 'reused-and-removed' : 'created-and-removed' });
  } finally {
    await lease.release();
  }
}

function required(args: ReadonlyMap<string, string>, name: string): string {
  const value = args.get(name);
  if (value === undefined) throw new Error(`${name} is required.\n${USAGE}`);
  return value;
}

export function comparePositiveDecimalDescending(left: string, right: string): number {
  if (!/^[1-9][0-9]*$/u.test(left) || !/^[1-9][0-9]*$/u.test(right)) {
    throw new Error('Actions run id must be canonical positive decimal text.');
  }
  return right.length - left.length || right.localeCompare(left);
}

function newestRun<T extends { runId: string; runAttempt: number }>(values: readonly T[]): T | null {
  return [...values].sort((left, right) => comparePositiveDecimalDescending(left.runId, right.runId)
    || right.runAttempt - left.runAttempt)[0] ?? null;
}

export function branchCloseoutRecoveryArtifactName(input: {
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

const HOSTED_INTEGRATION_PREFLIGHT_RESULT_FILE =
  'integration-preflight-result-v2.json' as const;

export function hostedIntegrationPreflightResultPath(repositoryRoot: string): string {
  return path.join(repositoryRoot, '.tmp', 'codex', HOSTED_INTEGRATION_PREFLIGHT_RESULT_FILE);
}

/** Fixed original member transported from its producer to its consumer. */
export function hostedIntegrationPreflightTransportPath(repositoryRoot: string, lane: 'producer' | 'consumer'): string {
  return path.join(repositoryRoot, '.tmp', 'codex', 'hosted-job',
    lane === 'producer' ? 'authorize' : 'integrate', lane === 'producer' ? 'out' : 'in',
    'recovery', HOSTED_INTEGRATION_PREFLIGHT_RESULT_FILE);
}

export function materializeBranchCloseoutRecoveryArtifact(input: {
  outputPath: string;
  repository: string;
  session: VerificationSession;
  prepared: ReturnType<typeof parsePreparedBranchCloseoutEnvelope>;
  runId: string;
  runAttempt: number;
}): HostedRecoveryArtifactMaterialization {
  const bundleBytes = readSessionArtifactBytes(input.prepared.preparation.recovery.path);
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

/** Validate the artifact against its exact producing workflow attempt, not the comment App identity. */
export function assertHostedRecoveryArtifactProvenance(input: Readonly<{
  metadata: GitHubActionsArtifactObservation;
  producingRun: Readonly<Record<string, any>>;
  baseSha: string;
  runId: string;
  runAttempt: number;
}>): void {
  const { metadata, producingRun, baseSha, runId, runAttempt } = input;
  if (metadata.expired || metadata.runId !== runId || metadata.runAttempt !== runAttempt
    || metadata.workflowPath !== '.github/workflows/merge-gate.yml'
    || metadata.workflowRef !== `.github/workflows/merge-gate.yml@${baseSha}`
    || metadata.workflowSha !== baseSha || metadata.eventName !== 'workflow_run'
    || String(producingRun.id ?? '') !== runId || producingRun.run_attempt !== runAttempt
    || producingRun.event !== 'workflow_run' || producingRun.path !== metadata.workflowPath
    || producingRun.head_sha !== baseSha || typeof producingRun.actor?.login !== 'string'
    || typeof producingRun.actor?.node_id !== 'string'
    || producingRun.actor.login.length === 0 || producingRun.actor.node_id.length === 0
    || metadata.actorNodeId !== producingRun.actor.node_id
    || (metadata.actorPermission !== 'maintain' && metadata.actorPermission !== 'admin')) {
    throw new Error('Closeout recovery provider artifact provenance drifted.');
  }
}

export async function loadProviderBranchCloseoutRecoveryArtifact(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  session: VerificationSession;
  runId: string;
  runAttempt: number;
}): Promise<HostedRecoveryArtifactObservation> {
  const expectedName = branchCloseoutRecoveryArtifactName({ prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision, runId: input.runId, runAttempt: input.runAttempt });
  const matches = (await input.github.observeActionsArtifactsForRun(input.repository, input.runId))
    .filter(({ artifactName }) => artifactName === expectedName);
  if (matches.length !== 1) {
    throw new Error('Closeout recovery requires exactly one provider artifact for the authorization run/attempt.');
  }
  const metadata = matches[0]!;
  const producingRun = apiRecord(input.ctx,
    `/repos/${input.repository}/actions/runs/${input.runId}/attempts/${input.runAttempt}`,
    'closeout recovery producing run attempt readback');
  assertHostedRecoveryArtifactProvenance({ metadata, producingRun, baseSha: input.session.baseSha,
    runId: input.runId, runAttempt: input.runAttempt });
  const source = (await input.github.downloadArtifactText(input.repository, metadata,
    BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME));
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

/** Provider readback of the two closed control steps whose produced and
 * uploaded bytes the verify phase re-reads. The authenticated job is still
 * in_progress, so only step facts are admissible here; a job conclusion that
 * does not exist yet is never observed or invented. */
export function readAuthenticatedHostedControlStepFacts(input: Readonly<{
  ctx: VerificationSessionScope; origin: AuthenticatedGitHubJobOrigin;
}>): Readonly<{ preparation: Readonly<{ name: string; number: number; status: string; conclusion: string | null }>;
  upload: Readonly<{ name: string; number: number; status: string; conclusion: string | null }> }> {
  const job = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  const policy = getCiVerificationPerJobHostedJobPolicy(job.workflowPath, job.policyJobId);
  let preparationStepName: string | null = null;
  let uploadStepName: string | null = null;
  for (const stage of policy === null ? [] : policy.stages) {
    if (stage.kind === 'phase' && stage.phase === 'prepare-integration-hosted') {
      if (preparationStepName !== null) throw new Error('Hosted recovery verification policy has duplicate producer phases.');
      preparationStepName = stage.stepName;
    }
    if (stage.kind === 'upload' && stage.slot === 'recovery') {
      if (uploadStepName !== null) throw new Error('Hosted recovery verification policy has duplicate upload stages.');
      uploadStepName = stage.stepName;
    }
  }
  if (preparationStepName === null || uploadStepName === null) {
    throw new Error('Hosted recovery verification has no unique policy producer/upload steps.');
  }
  const observed = apiRecord(input.ctx, `/repos/${job.repository}/actions/jobs/${job.jobId}`,
    'hosted recovery verification job readback');
  if (String(observed.id) !== job.jobId || String(observed.run_id) !== job.runId
      || observed.run_attempt !== job.runAttempt || observed.name !== job.jobName
      || observed.head_sha !== job.workflowSha
      || observed.check_run_url !== `${GITHUB_API_BASE_URL}/repos/${job.repository}/check-runs/${job.checkRunId}`
      || !Array.isArray(observed.steps)) {
    throw new Error('Hosted recovery verification job readback differs from its authenticated origin.');
  }
  const fact = (stepName: string) => {
    const matches = observed.steps.map((entry: unknown) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('Hosted recovery verification step is not one object.');
      }
      return entry as Record<string, unknown>;
    }).filter((step: Record<string, unknown>) => step.name === stepName);
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0]!.number) || Number(matches[0]!.number) < 1
        || typeof matches[0]!.status !== 'string'
        || (matches[0]!.conclusion !== null && typeof matches[0]!.conclusion !== 'string')) {
      throw new Error('Hosted recovery verification has no unique exact provider step.');
    }
    return Object.freeze({ name: stepName, number: Number(matches[0]!.number),
      status: matches[0]!.status as string, conclusion: matches[0]!.conclusion as string | null });
  };
  assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  return Object.freeze({ preparation: fact(preparationStepName), upload: fact(uploadStepName) });
}

const HOSTED_RECOVERY_ARTIFACT_ATTEMPT_NAME =
  /^sec-branch-closeout-recovery-v1-pr-([1-9][0-9]*)-session-([0-9a-f]{64})-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u;

/** Live provider names that claim this exact attempt's recovery identity.
 * Earlier attempts of the same run and same-named artifacts of other runs are
 * excluded by the immutable run/attempt suffix, never by recency. */
export async function readHostedAttemptRecoveryArtifactNames(input: Readonly<{
  github: VerificationSessionGitHubClient; repository: string; runId: string; runAttempt: number;
}>): Promise<readonly string[]> {
  if (!/^[1-9][0-9]*$/u.test(input.runId) || !Number.isSafeInteger(input.runAttempt) || input.runAttempt < 1) {
    throw new Error('Hosted recovery attempt identity is invalid.');
  }
  return Object.freeze((await input.github.observeActionsArtifactsForRun(input.repository, input.runId))
    .map(({ artifactName }) => artifactName)
    .filter(name => {
      const match = HOSTED_RECOVERY_ARTIFACT_ATTEMPT_NAME.exec(name);
      return match !== null && match[3] === input.runId && match[4] === String(input.runAttempt);
    }));
}

/** The verify phase's whole provider function: the provider must expose exactly
 * the artifact name this job's own preparation derived, its immutable
 * provenance must bind this exact run and attempt, and both members must
 * re-derive the same Session identity. Returned member digests let the
 * application compare provider bytes with the original local writer. */
export async function readVerifiedHostedRecoveryTransport(input: Readonly<{
  ctx: VerificationSessionScope; github: VerificationSessionGitHubClient; repository: string;
  expectedArtifactName: string; runId: string; runAttempt: number;
}>): Promise<Readonly<{ artifactName: string; recoveryDigest: `sha256:${string}`; preflightDigest: `sha256:${string}` }>> {
  const matches = (await input.github.observeActionsArtifactsForRun(input.repository, input.runId))
    .filter(({ artifactName }) => artifactName === input.expectedArtifactName);
  if (matches.length !== 1) {
    throw new Error('Closeout recovery verification requires exactly one provider artifact for the prepared name.');
  }
  const metadata = matches[0]!;
  const source = (await input.github.downloadArtifactText(input.repository, metadata,
    BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME));
  const artifact = parseBranchCloseoutRecoveryArtifact(source);
  if (`${encodeVerificationActionData(artifact)}\n` !== source || artifact.repository !== input.repository
      || branchCloseoutRecoveryArtifactName({ prNumber: artifact.pullRequestNumber,
        sessionRevision: artifact.sessionRevision, runId: input.runId, runAttempt: input.runAttempt }) !== input.expectedArtifactName) {
    throw new Error('Closeout recovery verification artifact bytes differ from their prepared name and identity.');
  }
  const preflightSource = (await input.github.downloadArtifactText(input.repository, metadata,
    HOSTED_INTEGRATION_PREFLIGHT_RESULT_FILE));
  const preflight = CodexDevelopmentParseMergeGateResult(preflightSource);
  if (preflight.authorization.repository !== input.repository
      || preflight.authorization.prNumber !== artifact.pullRequestNumber
      || preflight.authorization.sessionRevision !== artifact.sessionRevision
      || preflight.authorization.headSha !== artifact.headSha
      || preflight.authorization.headTreeSha !== artifact.headTreeSha) {
    throw new Error('Closeout recovery verification preflight and recovery members disagree.');
  }
  const producingRun = apiRecord(input.ctx,
    `/repos/${input.repository}/actions/runs/${input.runId}/attempts/${input.runAttempt}`,
    'closeout recovery verification producing run attempt readback');
  assertHostedRecoveryArtifactProvenance({ metadata, producingRun, baseSha: preflight.authorization.baseSha,
    runId: input.runId, runAttempt: input.runAttempt });
  return Object.freeze({ artifactName: input.expectedArtifactName, recoveryDigest: rawSha256(source),
    preflightDigest: rawSha256(preflightSource) });
}

export function addSeconds(instant: string, seconds: number): string {
  return new Date(new Date(instant).getTime() + seconds * 1000).toISOString();
}

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

export async function openRuntimeJournalFileSystem(
  repositoryRoot: string,
  environment: Readonly<Record<string, string | undefined>>
): Promise<VerificationSessionJournalFileSystem> {
  const authority = await acquireSecRuntimeJournalAuthority({ repositoryRoot, environment });
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment });
  return createRuntimeStateJournalFileSystem(authority.directory(roots.workspaceStateRoot));
}

export function positiveEnvironmentInteger(name: string, environment: Readonly<Record<string, string | undefined>>): number {
  const value = Number(environment[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

const HOSTED_SESSION_ARTIFACT_NAME_PATTERN =
  /^sec-verification-session-v2-pr-([1-9][0-9]*)-session-([0-9a-f]{64})-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$/u;
function assertHostedArtifactMatchesRequest(
  artifact: ReturnType<typeof parseHostedSessionTerminalArtifact>,
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

async function captureHostedSessionTransport(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  metadata: GitHubActionsArtifactObservation;
  request?: ReturnType<typeof parseVerificationSessionHostedRequest>;
}) {
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
  const artifactText = (await github.downloadArtifactText(repository, metadata,
    'verification-session-artifact.json'));
  const artifact = parseHostedSessionTerminalArtifact(artifactText);
  const expectedName = hostedSessionArtifactName({ prNumber: artifact.session.prNumber,
    sessionRevision: artifact.session.sessionRevision, runId: metadata.runId,
    runAttempt: metadata.runAttempt });
  if (artifact.session.repository !== repository || artifact.session.prNumber !== prNumber
    || artifact.session.sessionRevision !== sessionRevision || metadata.artifactName !== expectedName
    || metadata.workflowPath !== '.github/workflows/compiler-pr-validation.yml'
    || metadata.workflowSha !== artifact.session.baseSha
    || metadata.workflowRef !== `${metadata.workflowPath}@${artifact.session.baseSha}`
    || metadata.eventName !== 'repository_dispatch') {
    throw new Error('Hosted Session artifact transport does not bind its canonical Session identity.');
  }
  if (request !== undefined) assertHostedArtifactMatchesRequest(artifact, request, repository);
  return Object.freeze({ artifact, artifactText, metadata });
}

export async function loadHostedSessionTransport(input: Parameters<typeof captureHostedSessionTransport>[0]) {
  const captured = await captureHostedSessionTransport(input);
  const artifact = captured.artifact;
  CodexDevelopmentAssertVerificationSessionArtifact(artifact);
  if (captured.metadata.actorPermission !== 'maintain' && captured.metadata.actorPermission !== 'admin') {
    throw new Error('Direct hosted Session transport requires its original human producer permission.');
  }
  return Object.freeze({ ...captured, artifact,
    observation: createHostedArtifactObservation({ ...captured, artifact, observation: captured.metadata }) });
}

export async function loadQualifiedHostedSessionTransport(input: Parameters<typeof captureHostedSessionTransport>[0] & Readonly<{
  origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope;
}>) {
  assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  const captured = await captureHostedSessionTransport(input);
  if (captured.artifact.schema !== 'verification-session-delegated-terminal') {
    const artifact = captured.artifact;
    if (captured.metadata.actorPermission !== 'maintain' && captured.metadata.actorPermission !== 'admin') {
      throw new Error('Direct hosted Session transport requires its original human producer permission.');
    }
    return Object.freeze({ ...captured, artifact,
      observation: createHostedArtifactObservation({ ...captured, artifact, observation: captured.metadata }) });
  }
  await authenticateHistoricalHostedSessionTerminalSource({ origin: input.origin,
    artifact: captured.artifact, artifactText: captured.artifactText, artifactId: captured.metadata.artifactId });
  const facts = await retainHistoricalHostedSessionSource({ ctx: input.ctx, origin: input.origin, selector: captured.artifact });
  const artifact = facts.authenticatedArtifact;
  if (artifact.schema !== 'verification-session-delegated-terminal' || captured.metadata.actorPermission !== 'none') {
    throw new Error('Delegated hosted Session transport does not preserve its actual bot permission.');
  }
  const metadata = captured.metadata;
  const observation = createDelegatedHostedArtifactObservation({
    kind: 'delegated-session-terminal', delegatedArtifactDigest: parseDigest(artifact.artifactDigest, 'sha256'),
    artifactId: metadata.artifactId, artifactName: metadata.artifactName, artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: rawSha256(captured.artifactText), artifactByteLength: Buffer.byteLength(captured.artifactText, 'utf8'),
    artifactExpired: false, workflowPath: '.github/workflows/compiler-pr-validation.yml', workflowRef: metadata.workflowRef,
    workflowSha: metadata.workflowSha, runId: metadata.runId, runAttempt: metadata.runAttempt,
    eventName: 'repository_dispatch', actorNodeId: metadata.actorNodeId, actorPermission: 'none',
    downloadTransport: 'github-actions-artifact-api'
  }, artifact);
  return Object.freeze({ ...captured, artifact, observation });
}

async function selectTrustedHostedSessionArtifact(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  transports: readonly GitHubActionsArtifactObservation[];
  request?: ReturnType<typeof parseVerificationSessionHostedRequest>;
  requireSingleTransport?: boolean;
}): Promise<Readonly<{
  artifact: ReturnType<typeof CodexDevelopmentParseVerificationSessionArtifact>;
  origin: ReturnType<typeof createHostedArtifactObservation>;
  transport: ReturnType<typeof createHostedArtifactObservation>;
  originMetadata: GitHubActionsArtifactObservation;
  transportMetadata: GitHubActionsArtifactObservation;
  originText: string;
  transportText: string;
}> | null> {
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
  const loaded: Awaited<ReturnType<typeof loadHostedSessionTransport>>[] = [];
  for (const metadata of candidates) {
    const identity = `${metadata.runId}:${metadata.runAttempt}`;
    if (identities.has(identity)) throw new Error('Duplicate hosted Session artifact transport identity.');
    identities.add(identity);
    loaded.push(await loadHostedSessionTransport({ github, repository, metadata,
      ...(request === undefined ? {} : { request }) }));
  }
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
  const originCandidates = (await github.observeActionsArtifactsForRun(repository, producer.runId))
    .filter((entry) => !entry.expired && entry.artifactName === originName);
  if (originCandidates.length !== 1) {
    throw new Error('Expected exactly one immutable origin Session artifact.');
  }
  const origin = (await loadHostedSessionTransport({ github, repository, metadata: originCandidates[0]!,
    ...(request === undefined ? {} : { request }) }));
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

/**
 * Canonical provider observation for an IssueDisposition plan.  The PR
 * candidate and the provider's closing-reference projection are deliberately
 * two observations; neither may be used alone at the merge fence.
 */
export async function observeExactIssueDispositionPlan(input: Readonly<{
  github: VerificationSessionGitHubClient;
  repository: string;
  candidate: GitHubCandidateObservation;
  manifestPath: string;
  manifestDigest: IssueDispositionDigest;
  tracking: ReturnType<typeof CodexDevelopmentParseWorkPackageManifest>['tracking'];
}>): Promise<IssueDispositionPlan> {
  const closingFacts = (await input.github.observePullRequestClosingFacts(
    input.repository,
    input.candidate.number
  ));
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

export function issueDispositionCommitMarkerState(message: string): 'complete' | 'absent' {
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

async function observeDurableVerificationSessionProjection(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  candidate: GitHubCandidateObservation;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
}): Promise<Readonly<Record<string, unknown>> | null> {
  if (input.candidate.state === 'MERGED') {
    (await assertTrustedMergedRequestRuntimeReachability({
      proof: inspectTrustedRuntime({ repositoryRoot: input.ctx.repositoryRoot }),
      repository: input.repository,
      prNumber: input.request.prNumber,
      baseSha: input.request.expectedBaseSha,
      headSha: input.request.expectedHeadSha,
      headTreeSha: input.request.expectedHeadTreeSha,
      candidate: input.candidate,
      github: input.github
    }));
  }
  const initial = classifyDurableVerificationSessionProjection(input);
  if (initial === null || input.candidate.state !== 'MERGED') return initial;
  const closeoutOperationId = initial.closeoutOperationId;
  if (typeof closeoutOperationId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(closeoutOperationId)) {
    throw new Error('Durable merged projection did not produce one closeout operation identity.');
  }
  const closeout = await observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
    repository: input.repository,
    pullRequestNumber: input.request.prNumber,
    closeoutOperationId: closeoutOperationId as `sha256:${string}`
  });
  return classifyDurableVerificationSessionProjection({ ...input,
    closeout: closeout === null ? null : Object.freeze({
      closeoutOperationId: closeoutOperationId as `sha256:${string}`,
      commentId: closeout.commentId,
      status: closeout.publication.receipt.closeoutStatus
    }) });
}

/** Authenticate the receiver's current bot separately from the original human
 * cause. A parsed signal is only a locator; every referenced emitter field is
 * independently read from the original provider before Action intake. */
export function observeHostedResumeReceiverSignal(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; ctx: VerificationSessionScope; event: Readonly<Record<string, unknown>>;
}>) {
  const current = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  if (current.role !== 'control' || current.workflowPath !== '.github/workflows/compiler-pr-validation.yml'
      || current.policyJobId !== 'receive-verification-session-resume' || current.phase !== 'receive-verification-session-resume'
      || current.runAttempt !== 1 || current.trustedDriverRoot !== input.ctx.repositoryRoot) {
    throw new Error('Hosted resume requires its own authenticated first-attempt receiver invocation.');
  }
  const record = (value: unknown, label: string): Record<string, unknown> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is not one native JSON object.`);
    return value as Record<string, unknown>;
  };
  const bot = (value: unknown, label: string) => {
    const user = record(value, label);
    const expected = CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot;
    if (user.login !== expected.login || user.id !== expected.id || user.node_id !== expected.nodeId || user.type !== 'Bot') {
      throw new Error(`${label} differs from the canonical Actions bot.`);
    }
  };
  const repository = record(input.event.repository, 'resume event repository');
  if (input.event.action !== HOSTED_RESUME_DISPATCH_EVENT || String(repository.id) !== current.repositoryId
      || repository.full_name !== current.repository) throw new Error('Hosted resume receiver event differs from its native repository and trigger.');
  bot(input.event.sender, 'resume event sender');
  const signal = parseHostedResumeDispatchSignal(encodeVerificationActionData(record(input.event.client_payload, 'resume payload').payload));
  const run = apiRecord(input.ctx, `/repos/${current.repository}/actions/runs/${current.runId}/attempts/${current.runAttempt}`, 'resume receiver run');
  bot(run.actor, 'resume receiver actor');
  bot(run.triggering_actor, 'resume receiver triggering actor');
  if (String(run.id) !== current.runId || run.run_attempt !== current.runAttempt
      || run.path !== current.workflowPath || run.head_sha !== current.workflowSha || run.event !== 'repository_dispatch') {
    throw new Error('Hosted resume receiver run readback differs from its native origin.');
  }
  const emitter = signal.emitter;
  if (emitter.repository !== current.repository || emitter.repositoryId !== current.repositoryId) throw new Error('Hosted resume emitter belongs to another repository.');
  const emitterRun = apiRecord(input.ctx, `/repos/${current.repository}/actions/runs/${emitter.runId}/attempts/${emitter.runAttempt}`, 'resume emitter run');
  if (String(emitterRun.id) !== emitter.runId || emitterRun.run_attempt !== emitter.runAttempt
      || emitterRun.path !== emitter.workflowPath || emitterRun.head_sha !== emitter.workflowSha || emitterRun.event !== 'workflow_run'
      || String(record(emitterRun.repository, 'emitter repository').id) !== current.repositoryId) {
    throw new Error('Hosted resume emitter run does not bind its historical workflow subject.');
  }
  const emitterJob = apiRecord(input.ctx, `/repos/${current.repository}/actions/jobs/${emitter.jobId}`, 'resume emitter job');
  if (String(emitterJob.id) !== emitter.jobId || String(emitterJob.run_id) !== emitter.runId
      || emitterJob.run_attempt !== emitter.runAttempt || emitterJob.name !== 'integrate'
      || emitterJob.head_sha !== emitter.workflowSha
      || emitterJob.check_run_url !== `${GITHUB_API_BASE_URL}/repos/${current.repository}/check-runs/${emitter.checkRunId}`
      || !Array.isArray(emitterJob.steps)) throw new Error('Hosted resume emitter job readback differs.');
  const matchingSteps = emitterJob.steps.map((entry: unknown) => record(entry, 'emitter step'))
    .filter((step: Record<string, unknown>) => step.number === emitter.stepNumber && step.name === emitter.stepName);
  if (matchingSteps.length !== 1 || !['in_progress', 'completed'].includes(String(matchingSteps[0]!.status))
      || (matchingSteps[0]!.status === 'completed' && matchingSteps[0]!.conclusion !== 'success')) {
    throw new Error('Hosted resume signal has no exact original emitter phase observation.');
  }
  const checkSuiteId = String(emitterRun.check_suite_id);
  if (!/^[1-9][0-9]*$/u.test(checkSuiteId)) throw new Error('Hosted resume emitter lacks its original check suite.');
  const suite = apiRecord(input.ctx, `/repos/${current.repository}/check-suites/${checkSuiteId}`, 'resume emitter check suite');
  const app = record(suite.app, 'emitter check suite App');
  const expectedApp = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  if (String(suite.id) !== checkSuiteId || suite.head_sha !== emitter.workflowSha
      || app.id !== expectedApp.id || app.node_id !== expectedApp.nodeId || app.slug !== expectedApp.slug
      || String(record(suite.repository, 'emitter suite repository').id) !== current.repositoryId) {
    throw new Error('Hosted resume emitter check suite lacks the original Actions App binding.');
  }
  assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  return signal;
}

function apiRecord(ctx: VerificationSessionScope, endpoint: string, label: string): Record<string, any> {
  const source = requireVerificationSessionCommandText(
    ctx,
    'gh',
    ['api', endpoint],
    label,
    ctx.repositoryRoot
  );
  const value: unknown = JSON.parse(source);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must return one object.`);
  }
  return value as Record<string, any>;
}

function requiredEnvironmentGitSha(
  environment: Readonly<Record<string, string | undefined>>,
  name: string
): string {
  const value = environment[name] ?? '';
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

/** Keep compiler initiators, current rerun principals and the Actions publisher distinct. */
export async function observeHostedIntegrationPrincipals(input: Readonly<{
  github: Pick<VerificationSessionGitHubClient, 'observePrincipal'>;
  repository: string;
  sourceRun: Readonly<Record<string, any>>;
  currentRun: Readonly<Record<string, any>>;
  environment: Readonly<Record<string, string | undefined>>;
}>) {
  type TrustedPrincipal = Readonly<{ login: string; nodeId: string; permission: 'maintain' | 'admin' }>;
  const observations = new Map<string, Promise<TrustedPrincipal>>();
  const observe = async (record: unknown, label: string, fresh = false): Promise<TrustedPrincipal> => {
    if (record === null || typeof record !== 'object') throw new Error(`${label} identity is incomplete.`);
    const { login, node_id: nodeId } = record as Record<string, unknown>;
    if (typeof login !== 'string' || typeof nodeId !== 'string' || login.length === 0 || nodeId.length === 0) {
      throw new Error(`${label} identity is incomplete.`);
    }
    const key = JSON.stringify([login, nodeId]);
    let pending = fresh ? undefined : observations.get(key);
    if (pending === undefined) {
      pending = (async () => {
        const observed = await input.github.observePrincipal(input.repository, login);
        if (observed.login !== login || observed.nodeId !== nodeId
            || (observed.permission !== 'maintain' && observed.permission !== 'admin')) {
          throw new Error(`${label} stable identity/live permission mismatch.`);
        }
        return Object.freeze({ login: observed.login, nodeId: observed.nodeId, permission: observed.permission });
      })();
      if (!fresh) observations.set(key, pending);
    }
    return await pending;
  };
  await observe(input.sourceRun.actor, 'integrate-hosted source actor');
  const sourceTriggeringActor = await observe(input.sourceRun.triggering_actor, 'integrate-hosted source triggering actor');
  if (input.currentRun.actor?.login !== input.environment.GITHUB_ACTOR
      || input.currentRun.triggering_actor?.login !== input.environment.GITHUB_TRIGGERING_ACTOR
      || typeof input.environment.GITHUB_ACTOR !== 'string'
      || typeof input.environment.GITHUB_TRIGGERING_ACTOR !== 'string') {
    throw new Error('integrate-hosted current actor environment/API identity mismatch.');
  }
  await observe(input.currentRun.actor, 'integrate-hosted actor');
  // A rerun is a separate initiation even when the username is unchanged.
  await observe(input.currentRun.triggering_actor, 'integrate-hosted triggering actor', true);
  return Object.freeze({ sourceTriggeringActor });
}

async function assertDelegatedIntegrationRunPrincipals(input: Readonly<{
  github: VerificationSessionGitHubClient; repository: string;
  sourceRun: Readonly<Record<string, unknown>>; currentRun: Readonly<Record<string, unknown>>;
  environment: Readonly<Record<string, string | undefined>>;
}>): Promise<void> {
  const bot = CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot;
  const actor = (value: unknown, label: string) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)
        || !('login' in value) || typeof value.login !== 'string'
        || !('node_id' in value) || typeof value.node_id !== 'string'
        || !('type' in value) || typeof value.type !== 'string') {
      throw new Error(`${label} lacks its actual native identity.`);
    }
    return Object.freeze({ login: value.login, node_id: value.node_id, type: value.type,
      id: 'id' in value ? value.id : undefined });
  };
  const assertBot = (value: unknown, label: string) => {
    const principal = actor(value, label);
    if (principal.login !== bot.login || principal.node_id !== bot.nodeId || principal.type !== bot.type
        || !('id' in principal) || String(principal.id) !== String(bot.id)) {
      throw new Error(`${label} differs from the canonical Actions bot.`);
    }
    return principal;
  };
  const assertInitiator = async (value: unknown, label: string) => {
    const principal = actor(value, label);
    if (principal.login === bot.login || principal.node_id === bot.nodeId) {
      return assertBot(value, label);
    }
    if (principal.type !== 'User') throw new Error(`${label} is neither the canonical bot nor an independently authorized human.`);
    const current = await input.github.observePrincipal(input.repository, principal.login);
    if (current.login !== principal.login || current.nodeId !== principal.node_id
        || (current.permission !== 'maintain' && current.permission !== 'admin')) {
      throw new Error(`${label} fresh human identity or permission drifted.`);
    }
    return principal;
  };
  assertBot(input.sourceRun.actor, 'Delegated Session actual producer');
  const currentActor = assertBot(input.currentRun.actor, 'Delegated integration actual actor');
  const currentInitiator = await assertInitiator(input.currentRun.triggering_actor, 'Delegated integration triggering actor');
  await assertInitiator(input.sourceRun.triggering_actor, 'Delegated Session triggering actor');
  if (currentActor.login !== input.environment.GITHUB_ACTOR
      || currentInitiator.login !== input.environment.GITHUB_TRIGGERING_ACTOR) {
    throw new Error('Delegated integration current environment differs from actual native principals.');
  }
}

export async function createQualifiedHostedArtifactProvenance(input: Readonly<
  Parameters<typeof createTrustedHostedArtifactProvenance>[0] & { ctx: VerificationSessionScope }
>) {
  input = Object.freeze({ ctx: input.ctx, ...cloneAndDeepFreeze({
    artifact: input.artifact, artifactText: input.artifactText, observation: input.observation,
    actorPermission: input.actorPermission }) });
  if (input.artifact.schema !== 'verification-session-delegated-terminal') {
    return createTrustedHostedArtifactProvenance(input);
  }
  const facts = await assertBorrowedHostedSessionSourceCurrent(input.ctx, {
    repository: input.artifact.session.repository, pullRequestNumber: input.artifact.session.prNumber,
    headSha: input.artifact.session.headSha, candidateTreeSha: input.artifact.session.headTreeSha,
    sessionRevision: input.artifact.session.sessionRevision });
  if (facts === null || facts.artifactId !== input.observation.artifactId
      || facts.artifactName !== input.observation.artifactName
      || encodeVerificationActionData(facts.authenticatedArtifact) !== encodeVerificationActionData(input.artifact)
      || input.actorPermission !== input.observation.actorPermission) {
    throw new Error('Delegated artifact provenance lacks its selected current native source and exact transport.');
  }
  return createTrustedHostedArtifactProvenance({ ...input, artifact: facts.authenticatedArtifact });
}

export async function assertHostedIntegrationIdentity(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  event: Record<string, any>;
  session: VerificationSession;
  artifact?: ReturnType<typeof parseHostedSessionTerminalArtifact>;
  candidate: GitHubCandidateObservation;
  phase: HostedIntegrationPhase;
  environment: Readonly<Record<string, string | undefined>>;
  repositoryRoot: string;
}): Promise<HostedIntegrationIdentity> {
  const { ctx, github, repository, event, session, candidate, phase: requestedPhase,
    environment, repositoryRoot } = input;
  if (input.artifact !== undefined) {
    const selected = await selectHistoricalHostedSessionSource({ ctx, artifact: input.artifact });
    if (encodeVerificationActionData(selected.session) !== encodeVerificationActionData(session)) {
      throw new Error('Hosted identity Session differs from its selected native artifact.');
    }
  }
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
  const delegatedSource = await assertBorrowedHostedSessionSourceCurrent(ctx, {
    repository, pullRequestNumber: session.prNumber, headSha: session.headSha,
    candidateTreeSha: session.headTreeSha, sessionRevision: session.sessionRevision });
  const sourceTriggeringActor = delegatedSource === null
    ? (await observeHostedIntegrationPrincipals({ github, repository, sourceRun, currentRun, environment })).sourceTriggeringActor
    : (await assertDelegatedIntegrationRunPrincipals({ github, repository, sourceRun, currentRun, environment }), delegatedSource.parentActor);
  selectCanonicalIntegrationRunOwner({
    runs: (await github.observeWorkflowRuns(repository, workflowSha)), currentRunId: runId,
    currentRunAttempt: runAttempt, sourceRunId, sourceRunAttempt, baseSha: workflowSha
  });
  const currentJobName = environment.GITHUB_JOB ?? '';
  const attempts = [];
  for (let attempt = 1; attempt <= runAttempt; attempt += 1) {
    attempts.push(Object.freeze({ runAttempt: attempt,
      jobs: await github.observeWorkflowJobsForAttempt(repository, runId, attempt) }));
  }
  const phase = assertHostedIntegrationPhaseOwnership({ attempts, runId,
    currentRunAttempt: runAttempt, currentJobName, workflowSha, phase: requestedPhase });
  const proof = inspectTrustedRuntime({ repositoryRoot, candidateHeadSha: session.headSha });
  if (mergedRecovery) {
    (await assertTrustedMergedRuntimeReachability({ proof, session, candidate, github }));
  } else {
    assertTrustedExactRevisionRuntime(proof, baseSha);
  }
  const provenanceInput = { repositoryId,
    workflowPath: '.github/workflows/merge-gate.yml',
    workflowRef: `.github/workflows/merge-gate.yml@${workflowSha}`, workflowSha,
    runId, runAttempt, eventName: 'workflow_run', sourceRunId, sourceRunAttempt,
    actorLogin: sourceTriggeringActor.login, actorNodeId: sourceTriggeringActor.nodeId,
    actorPermission: sourceTriggeringActor.permission,
    app: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app };
  let provenance: HostedWorkflowCommentProvenance;
  let integrationPrincipal = sourceTriggeringActor;
  if (delegatedSource === null) {
    provenance = createHostedWorkflowCommentProvenance({ ...provenanceInput,
      workflowPath: '.github/workflows/merge-gate.yml', eventName: 'workflow_run' });
  } else {
    const currentSource = await assertBorrowedHostedSessionSourceCurrent(ctx, {
      repository, pullRequestNumber: session.prNumber, headSha: session.headSha,
      candidateTreeSha: session.headTreeSha, sessionRevision: session.sessionRevision });
    if (currentSource === null || currentSource.artifactDigest !== delegatedSource.artifactDigest
        || String(currentSource.receiverOrigin.runId) !== sourceRunId
        || currentSource.receiverOrigin.runAttempt !== sourceRunAttempt) {
      throw new Error('Delegated integration source changed during current native qualification.');
    }
    provenance = createDelegatedHostedWorkflowCommentProvenance({ ...provenanceInput,
      workflowPath: '.github/workflows/merge-gate.yml', eventName: 'workflow_run',
      actorLogin: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.login,
      actorNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot.nodeId, actorPermission: 'none',
      sourceArtifact: { artifactId: currentSource.artifactId, artifactName: currentSource.artifactName,
        artifactDigest: parseDigest(currentSource.authenticatedArtifact.artifactDigest, 'sha256'),
        archiveDigest: parseDigest(currentSource.archiveDigest, 'sha256') } });
    integrationPrincipal = currentSource.parentActor;
  }
  return Object.freeze({ provenance, phase, integrationPrincipal: {
    nodeId: integrationPrincipal.nodeId, permission: integrationPrincipal.permission } });
}

export function assertAuthorizationPublicationMatchesSession(input: {
  publication: IntegrationAuthorizationOperationPublication;
  repository: string;
  session: VerificationSession;
}): void {
  const authorization = input.publication.result.authorization;
  const checks: readonly [unknown, unknown, string][] = [
    [input.publication.repository, input.repository, 'publication repository'],
    [input.publication.pullRequestNumber, input.session.prNumber, 'publication pull request'],
    [input.publication.sessionRevision, input.session.sessionRevision, 'publication Session revision'],
    [authorization.repository, input.repository, 'repository'],
    [authorization.prNumber, input.session.prNumber, 'pull request'],
    [authorization.sessionRevision, input.session.sessionRevision, 'Session revision'],
    [authorization.baseSha, input.session.baseSha, 'base'],
    [authorization.baseTreeSha, input.session.baseTreeSha, 'base tree'],
    [authorization.headSha, input.session.headSha, 'head'],
    [authorization.headTreeSha, input.session.headTreeSha, 'head tree'],
    [authorization.manifestDigest, input.session.manifestDigest, 'manifest'],
    [authorization.scopeAuthorizationRevision, input.session.scopeAuthorizationRevision,
      'ScopeAuthorization revision'],
    [authorization.actionClosureDigest, input.session.actionPlanClosureDigest, 'Action closure'],
    [authorization.trustRevision, input.session.trustRevision, 'trust revision']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`Durable IntegrationAuthorization ${label} drifted.`);
  }
}

function observeExactRemoteCloseoutBranch(
  ctx: VerificationSessionScope,
  prepared: ReturnType<typeof parsePreparedBranchCloseoutEnvelope>
): Readonly<{ state: 'present' | 'absent'; sha: string | null }> {
  const { preparation } = prepared;
  const ref = `refs/heads/${preparation.branch}`;
  return observeTrustedRemoteExactRef({
    ctx,
    remote: preparation.repository.remote,
    remoteRef: ref,
    label: 'hosted closeout remote branch readback',
    cwd: preparation.repository.root
  });
}

async function publishHostedCloseoutEffectStart(
  ctx: VerificationSessionScope,
  publication: BranchCloseoutEffectStartPublication,
  health: Parameters<Parameters<typeof withAuthenticatedPostMergeMainHealth>[1]>[0]
): Promise<HostedCloseoutEffectStartReadback> {
  await assertHostedCloseoutMainHealthCurrent({ ctx, binding: publication.binding, health });
  const existing = await observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, {
    repository: publication.binding.repository,
    pullRequestNumber: publication.binding.pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (existing !== null) {
    assertBranchCloseoutEffectStartMatches({
      publication: existing.publication,
      binding: publication.binding,
      authorizationPublication: publication.authorizationPublication,
      recoveryArtifact: publication.recoveryArtifact
    });
    return Object.freeze({ disposition: 'existing', ...existing });
  }

  const endpoint = `/repos/${publication.binding.repository}`
    + `/issues/${publication.binding.pullRequestNumber}/comments`;
  const body = renderBranchCloseoutEffectStartPublicationComment(publication);
  await assertHostedCloseoutMainHealthCurrent({ ctx, binding: publication.binding, health });
  const posted = runVerificationSessionCommand(ctx, 'gh', [
    'api', '-X', 'POST', endpoint, '-f', `body=${body}`
  ]);
  if (posted.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: closeout effect-start POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`
    );
  }

  let created;
  try {
    created = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(posted)),
      'created hosted closeout effect-start comment'
    );
    if (created.body !== body || !hostedPublisherMatches(created)) {
      throw new Error('created effect-start bytes or App identity differ');
    }
    await assertHostedCommentProvenanceLive(
      ctx.repositoryRoot,
      publication.binding.repository,
      created,
      publication.provenance
    );
  } catch (error) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: closeout effect-start POST response is not authoritative: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const exact = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    `/repos/${publication.binding.repository}/issues/comments/${created.id}`
  ]);
  if (exact.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: closeout effect-start exact readback failed: ${decodeBranchLifecycleChildError(exact)}`
    );
  }
  try {
    const comment = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(exact)),
      'hosted closeout effect-start exact readback'
    );
    const parsed = parseBranchCloseoutEffectStartPublicationComment(comment.body);
    if (comment.id !== created.id || !hostedPublisherMatches(comment)
      || parsed === null || parsed.publicationDigest !== publication.publicationDigest
      || comment.body !== body) {
      throw new Error('effect-start exact readback differs from the canonical publication');
    }
    await assertHostedCommentProvenanceLive(
      ctx.repositoryRoot,
      publication.binding.repository,
      comment,
      parsed.provenance
    );
  } catch (error) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: closeout effect-start exact readback is not authoritative: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const complete = await observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, {
    repository: publication.binding.repository,
    pullRequestNumber: publication.binding.pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (complete === null || complete.commentId !== created.id
    || complete.publication.publicationDigest !== publication.publicationDigest) {
    throw new Error(
      'AMBIGUOUS_SIDE_EFFECT: closeout effect-start is not unique in complete provider inventory.'
    );
  }
  return Object.freeze({ disposition: 'published', ...complete });
}

/**
 * Reads the pre-merge, same-job artifact only after its full canonical bytes
 * match the provider-authenticated artifact selected for the authorization.
 * The local file is a host observation, never a replacement authority.
 */
export function loadOriginalHostPreparedCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  outputPath: string;
  providerRecovery: Awaited<ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>>;
}>): PreparedBranchCloseoutEnvelope {
  const artifactPath = path.join(path.dirname(path.resolve(input.outputPath)),
    BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME);
  if (!existsSync(artifactPath)) {
    throw new Error('external-maintainer-disposition-required: original-host recovery artifact is unavailable.');
  }
  const source = readSessionArtifactText(artifactPath);
  const localArtifact = parseBranchCloseoutRecoveryArtifact(source);
  if (`${encodeVerificationActionData(localArtifact)}\n` !== source
    || encodeVerificationActionData(localArtifact) !== encodeVerificationActionData(input.providerRecovery.artifact)) {
    throw new Error('external-maintainer-disposition-required: local/provider recovery artifact mismatch.');
  }
  const prepared = parsePreparedBranchCloseoutEnvelope(
    Buffer.from(localArtifact.preparedEnvelopeBase64, 'base64').toString('utf8')
  );
  if (encodeVerificationActionData(prepared) !== encodeVerificationActionData(input.providerRecovery.remotePrepared)
    || prepared.foreignWorktreeObservations.length !== 0) {
    throw new Error('external-maintainer-disposition-required: original local preparation is not exact.');
  }
  const live = collectBranchLifecycleInventory(input.ctx);
  if (live.repository.root !== prepared.preparation.repository.root
    || live.repository.commonDir !== prepared.preparation.repository.commonDir) {
    throw new Error('external-maintainer-disposition-required: original host repository binding drifted.');
  }
  const expectedTargets = [...new Set(prepared.preparation.worktreePathsAtPreparation)].sort();
  const liveTargets = live.worktrees.filter(({ branch }) => branch === prepared.preparation.branch)
    .map(({ path: targetPath }) => targetPath).sort();
  if (expectedTargets.length !== liveTargets.length
    || expectedTargets.some((targetPath, index) => targetPath !== liveTargets[index])) {
    throw new Error('external-maintainer-disposition-required: original host worktree inventory drifted.');
  }
  return prepared;
}

/**
 * This is the sole production bridge from Issue 186 to Issue 313.  It is
 * deliberately private and only callable in the original host process: each
 * opaque token remains live from physical completion through branch CAS.
 * A fresh hosted recovery may not substitute an artifact, receipt locator, or
 * empty post-cleanup preparation for this sequence.
 */
export async function consumeSameHostWorktreeCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  health: Parameters<Parameters<typeof withAuthenticatedPostMergeMainHealth>[1]>[0];
}>, closeoutOperations: import('../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts').WorktreePhysicalCloseoutOperations): Promise<readonly WorktreePhysicalCloseoutConsumptionToken[]> {
  const preparation = input.prepared.preparation;
  const targets = [...new Set(preparation.worktreePathsAtPreparation)]
    .sort((left, right) => left.localeCompare(right));
  if (targets.length === 0) {
    throw new Error('same-host-worktree-closeout-required: no immutable locally registered target is available.');
  }
  const expectedTreeSha = requireCommand(
    input.ctx,
    'git',
    ['rev-parse', `${preparation.expectedHeadSha}^{tree}`],
    'same-host worktree closeout prepared head tree'
  );
  const tokens: WorktreePhysicalCloseoutConsumptionToken[] = [];
  for (const targetPath of targets) {
    await assertHostedCloseoutMainHealthCurrent(input);
    const trusted = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: preparation.repository.root,
      targetPath,
      expectedBranch: preparation.branch,
      expectedHeadSha: preparation.expectedHeadSha,
      expectedTreeSha,
      expectedRecoveryAuthorityDigest: preparation.recovery.sha256
    }, closeoutOperations);
    await assertHostedCloseoutMainHealthCurrent(input);
    await executeWorktreePhysicalCloseout({
      repositoryRoot: preparation.repository.root,
      targetPath,
      expectedBranch: preparation.branch,
      expectedHeadSha: preparation.expectedHeadSha,
      expectedTreeSha,
      expectedRecoveryAuthorityDigest: preparation.recovery.sha256,
      authorizationPath: trusted.authorization.authorizationPath
    });
    assertTrustedCompletedWorktreePhysicalCloseout({
      token: trusted.token,
      repositoryRoot: preparation.repository.root,
      targetPath,
      branch: preparation.branch,
      headSha: preparation.expectedHeadSha,
      treeSha: expectedTreeSha,
      recoveryAuthorityDigest: preparation.recovery.sha256
    });
    tokens.push(trusted.token);
  }
  if (tokens.length !== targets.length || tokens.length === 0) {
    throw new Error('same-host-worktree-closeout-required: exact physical completion token set is unavailable.');
  }
  return Object.freeze(tokens);
}

export async function publishHostedCloseoutTerminal(input: Readonly<{
  ctx: VerificationSessionScope;
  health: Parameters<Parameters<typeof withAuthenticatedPostMergeMainHealth>[1]>[0];
  operationReceipt: BranchCloseoutOperationReceipt;
  provenance: HostedWorkflowCommentProvenance;
  effectStart: HostedCloseoutEffectStartReadback;
}>): Promise<HostedCloseoutTerminalReadback> {
  await assertHostedCloseoutMainHealthCurrent({ ctx: input.ctx,
    binding: input.operationReceipt.binding, health: input.health });
  const publication = createBranchCloseoutOperationPublication(
    input.operationReceipt,
    input.provenance,
    input.effectStart
  );
  const repository = publication.binding.repository;
  const pullRequestNumber = publication.binding.pullRequestNumber;
  const existing = await observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
    repository,
    pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (existing !== null) {
    if (existing.publication.publicationDigest !== publication.publicationDigest) {
      throw new Error('Existing closeout terminal differs from the canonical operation bytes.');
    }
    return Object.freeze({ disposition: 'reused', ...existing });
  }
  const start = await observeBranchCloseoutEffectStartPublication(input.ctx.repositoryRoot, {
    repository,
    pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (start === null || start.commentId !== publication.effectStart.commentId
    || start.publication.effectStartId !== publication.effectStart.effectStartId
    || start.publication.publicationDigest !== publication.effectStart.publicationDigest) {
    throw new Error(
      'Hosted closeout terminal requires exactly one matching App-authenticated effect-start marker.'
    );
  }

  const endpoint = `/repos/${repository}/issues/${pullRequestNumber}/comments`;
  const body = renderBranchCloseoutOperationPublicationComment(publication);
  const recover = async (reason: string): Promise<Readonly<{
    disposition: 'recovered';
    publication: BranchCloseoutOperationPublication;
    commentId: number;
  }>> => {
    const observed = await observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
      repository,
      pullRequestNumber,
      closeoutOperationId: publication.closeoutOperationId
    });
    if (observed === null
      || observed.publication.publicationDigest !== publication.publicationDigest) {
      throw new Error(`AMBIGUOUS_SIDE_EFFECT: ${reason}; terminal inventory has no exact recovery.`);
    }
    return Object.freeze({ disposition: 'recovered', ...observed });
  };
  await assertHostedCloseoutMainHealthCurrent({ ctx: input.ctx,
    binding: publication.binding, health: input.health });
  const posted = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', '-X', 'POST', endpoint, '-f', `body=${body}`
  ]);
  if (posted.status !== 0) {
    return recover(
      `closeout terminal POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`
    );
  }
  let created;
  try {
    created = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(posted)),
      'created closeout terminal comment'
    );
    const parsed = parseBranchCloseoutOperationPublicationComment(created.body);
    if (created.body !== body || !hostedPublisherMatches(created)
      || parsed === null || parsed.publicationDigest !== publication.publicationDigest) {
      throw new Error('created terminal bytes or App identity differ');
    }
    await assertHostedCommentProvenanceLive(
      input.ctx.repositoryRoot,
      repository,
      created,
      parsed.provenance
    );
  } catch (error) {
    return recover(
      `closeout terminal POST response is not authoritative: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const exact = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', `/repos/${repository}/issues/comments/${created.id}`
  ]);
  if (exact.status !== 0) {
    return recover(
      `closeout terminal exact readback failed: ${decodeBranchLifecycleChildError(exact)}`
    );
  }
  try {
    const comment = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(exact)),
      'closeout terminal exact readback'
    );
    const parsed = parseBranchCloseoutOperationPublicationComment(comment.body);
    if (comment.id !== created.id || comment.body !== body || !hostedPublisherMatches(comment)
      || parsed === null || parsed.publicationDigest !== publication.publicationDigest) {
      throw new Error('terminal exact readback differs from canonical bytes');
    }
    await assertHostedCommentProvenanceLive(
      input.ctx.repositoryRoot,
      repository,
      comment,
      parsed.provenance
    );
  } catch (error) {
    return recover(
      `closeout terminal exact readback is not authoritative: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const complete = await observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
    repository,
    pullRequestNumber,
    closeoutOperationId: publication.closeoutOperationId
  });
  if (complete === null || complete.commentId !== created.id
    || complete.publication.publicationDigest !== publication.publicationDigest) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: closeout terminal is not unique in complete provider inventory.');
  }
  return Object.freeze({ disposition: 'published', ...complete });
}

/** One native capsule retains both leases from marker observation/POST readback
 * through the original finalizer. No application callback enters this span. */
export async function executeHostedCloseoutEffect(input: Readonly<{
  ctx: VerificationSessionScope;
  repository: string;
  pullRequestNumber: number;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  authorizationPublication: BranchCloseoutEffectStartPublication['authorizationPublication'];
  recoveryArtifact: BranchCloseoutEffectStartPublication['recoveryArtifact'];
  provenance: HostedWorkflowCommentProvenance;
  phase: HostedIntegrationPhaseOwnership;
  health: Parameters<Parameters<typeof withAuthenticatedPostMergeMainHealth>[1]>[0];
  worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[];
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
  now: () => string;
}>): Promise<Readonly<{ effectStart: HostedCloseoutEffectStartReadback; terminal: BranchCloseoutOperationReceipt }>> {
  await assertHostedCloseoutMainHealthCurrent(input);
  if (input.repository !== input.binding.repository || input.pullRequestNumber !== input.binding.pullRequestNumber) {
    throw new Error('Hosted closeout capsule belongs to another merged operation.');
  }
  const commonDir = commonGitDirectory(input.ctx, input.ctx.repositoryRoot);
  if (comparableFileSystemPath(commonDir)
      !== comparableFileSystemPath(input.prepared.preparation.repository.commonDir)) {
    throw new Error('Hosted closeout Git common directory changed before effect-start.');
  }
  return await withWorkspaceWriteLease(commonDir, undefined, coordinatedLease => (
    withWorkspaceWriteLease(input.ctx.repositoryRoot, undefined, async lease => {
      await assertWorkspaceWriteLease(commonDir, coordinatedLease);
      await assertHostedCloseoutMainHealthCurrent(input);
      let effectStart: HostedCloseoutEffectStartReadback;
      const observedStart = await observeBranchCloseoutEffectStartPublication(input.ctx.repositoryRoot, {
        repository: input.repository, pullRequestNumber: input.pullRequestNumber,
        closeoutOperationId: input.binding.closeoutOperationId });
      if (observedStart !== null) {
        assertBranchCloseoutEffectStartMatches({ publication: observedStart.publication, binding: input.binding,
          authorizationPublication: input.authorizationPublication, recoveryArtifact: input.recoveryArtifact });
        const remoteBranch = observeExactRemoteCloseoutBranch(input.ctx, input.prepared);
        if (remoteBranch.state !== 'absent') {
          throw new Error('AMBIGUOUS_SIDE_EFFECT: an existing closeout effect start marker forbids another remote deletion.');
        }
        effectStart = Object.freeze({ disposition: 'existing', ...observedStart });
      } else {
        if (input.phase.priorAttemptStarted) {
          throw new Error('AMBIGUOUS_SIDE_EFFECT: a prior closeout mutation phase started without an exact effect start marker.');
        }
        const remoteBranch = observeExactRemoteCloseoutBranch(input.ctx, input.prepared);
        if (remoteBranch.state !== 'present' || remoteBranch.sha !== input.prepared.preparation.expectedHeadSha) {
          throw new Error('AMBIGUOUS_SIDE_EFFECT: a new closeout effect start requires the exact prepared remote branch.');
        }
        const phase = input.phase;
        if (phase.phase !== 'closeoutMutation' || phase.jobName !== 'integrate'
            || phase.stepName !== BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME) {
          throw new Error('Hosted closeout mutation phase is not the canonical provider step.');
        }
        const guard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({ ...input, lease });
        if (guard.authorization.blockers.length > 0 || guard.authorization.remoteAction !== 'delete-cas') {
          throw new Error('Branch closeout is not authorized before effect-start publication: '
            + encodeVerificationActionData(guard.authorization));
        }
        const publication = createBranchCloseoutEffectStartPublication({ binding: input.binding,
          authorizationPublication: input.authorizationPublication, recoveryArtifact: input.recoveryArtifact,
          phase: { runId: phase.runId, runAttempt: phase.runAttempt, jobId: phase.jobId, jobName: 'integrate',
            phase: 'closeoutMutation', stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
            stepNumber: phase.stepNumber, workflowSha: input.provenance.workflowSha }, provenance: input.provenance });
        await assertWorkspaceWriteLease(input.ctx.repositoryRoot, lease);
        const published = await publishHostedCloseoutEffectStart(input.ctx, publication, input.health);
        if (published.disposition !== 'published') {
          throw new Error('AMBIGUOUS_SIDE_EFFECT: hosted closeout effect start was not newly App-authenticated.');
        }
        effectStart = published;
      }
      const terminal = await finalizeHostedBranchCloseout({ ...input,
        writerId: input.binding.closeoutOperationId, markerDisposition: effectStart.disposition,
        lease, coordinatedLease });
      return Object.freeze({ effectStart, terminal });
    })
  ));
}

export function closeoutPublicationCompositeDigest(input: {
  closeoutOperationId: `sha256:${string}`;
  publicationDigest: `sha256:${string}`;
  commentId: number;
}): `sha256:${string}` {
  if (!Number.isSafeInteger(input.commentId) || input.commentId < 1) {
    throw new Error('Closeout publication comment id must be a positive safe integer.');
  }
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(input)).digest('hex')}`;
}

export async function assertHostedCompilerIdentity(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  event: Record<string, any>;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  environment: Readonly<Record<string, string | undefined>>;
  repositoryRoot: string;
}): Promise<{ actorNodeId: string; runId: string; runAttempt: number }> {
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
    const actor = (await github.observePrincipal(repository, run.actor.login));
    if (actor.nodeId !== run.actor.node_id
      || (actor.permission !== 'admin' && actor.permission !== 'maintain')) {
      throw new Error('observe-hosted actor stable identity/live permission mismatch.');
    }
    return { actorNodeId: actor.nodeId, runId, runAttempt };
  }

  const envelope = dispatch.envelope;
  const parentArtifact = (await github.observeActionsArtifact(repository,
    envelope.parentDispatchPlanArtifactId));
  if (parentArtifact.artifactName !== envelope.parentDispatchPlanArtifactName
    || parentArtifact.archiveDigest !== envelope.parentDispatchPlanArchiveDigest
    || parentArtifact.runId !== envelope.parentRunId
    || parentArtifact.runAttempt !== envelope.parentRunAttempt || parentArtifact.expired) {
    throw new Error('observe-hosted internal parent artifact metadata differs from its provider envelope.');
  }
  const parentArtifactInventory = (await github.observeActionsArtifactsForRun(repository,
    envelope.parentRunId));
  const parentJobs = (await github.observeWorkflowJobsForAttempt(repository,
    envelope.parentRunId, envelope.parentRunAttempt));
  const parentPlanSource = (await github.downloadArtifactText(repository, parentArtifact,
    ciVerificationActionParentDispatchPlanFile()));
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
  const parentPrincipal = (await github.observePrincipal(repository, parentPlan.parentActor.login));
  const internal = assertHostedCompilerInternalProvenance({ repository, repositoryId, request,
    envelope, parentPlanSource, parentArtifact, parentArtifactInventory, parentJobs, currentRun: run,
    currentWorkflow, currentCheckSuite, eventSender: event.sender, parentRun, parentPrincipal });
  return { actorNodeId: internal.parentActorNodeId, runId, runAttempt };
}

async function readBackHostedIntegrationAuthorizationComment(
  ctx: VerificationSessionScope,
  publication: IntegrationAuthorizationOperationPublication,
  commentId: number
): Promise<IntegrationAuthorizationOperationPublication> {
  const result = runVerificationSessionCommand(ctx, 'gh', [
    'api', `/repos/${publication.repository}/issues/comments/${commentId}`
  ]);
  if (result.status !== 0) {
    throw new Error(
      `integration authorization comment readback failed: ${decodeBranchLifecycleChildError(result)}`
    );
  }
  const comment = issueCommentRecord(
    JSON.parse(decodeBranchLifecycleChildStdout(result)),
    'integration authorization comment readback'
  );
  if (comment.id !== commentId || !hostedPublisherMatches(comment)) {
    throw new Error('Integration authorization comment readback identity/app mismatch.');
  }
  const parsed = parseIntegrationAuthorizationOperationPublicationComment(comment.body);
  if (parsed === null || parsed.authorizationPublicationId !== publication.authorizationPublicationId
    || parsed.publicationDigest !== publication.publicationDigest) {
    throw new Error('Integration authorization comment readback canonical bytes differ.');
  }
  await assertHostedCommentProvenanceLive(
    ctx.repositoryRoot,
    publication.repository,
    comment,
    parsed.provenance
  );
  return parsed;
}

export async function publishHostedIntegrationAuthorizationOperation(
  ctx: VerificationSessionScope,
  publicationInput: IntegrationAuthorizationOperationPublication
): Promise<HostedIntegrationAuthorizationPublicationReadback> {
  const publication = parseIntegrationAuthorizationOperationPublication(publicationInput);
  let inventory: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
  try {
    inventory = await observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
      repository: publication.repository,
      pullRequestNumber: publication.pullRequestNumber,
      sessionRevision: publication.sessionRevision
    });
  } catch (error) {
    return Object.freeze({ publication: null, commentId: null, status: 'failed',
      createdByThisInvocation: false,
      detail: error instanceof Error ? error.message : String(error) });
  }
  const same = inventory.filter(({ publication: observed }) => (
    observed.authorizationPublicationId === publication.authorizationPublicationId
  ));
  if (same.length > 1) {
    return Object.freeze({ publication: null, commentId: null, status: 'failed',
      createdByThisInvocation: false,
      detail: 'Duplicate comments exist for one authorization publication.' });
  }
  if (same.length === 1) {
    if (same[0]!.publication.publicationDigest !== publication.publicationDigest) {
      return Object.freeze({ publication: null, commentId: same[0]!.commentId, status: 'failed',
        createdByThisInvocation: false,
        detail: 'Authorization publication id exists with different canonical bytes.' });
    }
    try {
      const readback = await readBackHostedIntegrationAuthorizationComment(
        ctx,
        publication,
        same[0]!.commentId
      );
      return Object.freeze({ publication: readback, commentId: same[0]!.commentId,
        status: 'reused', createdByThisInvocation: false,
        detail: `reused authorization publication ${publication.authorizationPublicationId}` });
    } catch (error) {
      return Object.freeze({ publication: null, commentId: same[0]!.commentId, status: 'failed',
        createdByThisInvocation: false,
        detail: error instanceof Error ? error.message : String(error) });
    }
  }

  const endpoint = `/repos/${publication.repository}/issues/${publication.pullRequestNumber}/comments`;
  const body = renderIntegrationAuthorizationOperationPublicationComment(publication);
  await assertBorrowedHostedSessionSourceCurrent(ctx, { repository: publication.repository,
    pullRequestNumber: publication.pullRequestNumber, headSha: publication.result.authorization.headSha,
    sessionRevision: publication.sessionRevision, authorization: publication.result.authorization });
  const posted = runVerificationSessionCommand(ctx, 'gh', [
    'api', '-X', 'POST', endpoint, '-f', `body=${body}`
  ]);
  if (posted.status !== 0) {
    return Object.freeze({ publication: null, commentId: null, status: 'failed',
      createdByThisInvocation: false,
      detail: `authorization publication failed without retry: ${decodeBranchLifecycleChildError(posted)}` });
  }
  try {
    const created = issueCommentRecord(
      JSON.parse(decodeBranchLifecycleChildStdout(posted)),
      'created authorization comment'
    );
    if (created.body !== body || !hostedPublisherMatches(created)) {
      throw new Error('created authorization comment bytes/app differ');
    }
    const readback = await readBackHostedIntegrationAuthorizationComment(ctx, publication, created.id);
    const complete = (await observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
      repository: publication.repository,
      pullRequestNumber: publication.pullRequestNumber,
      sessionRevision: publication.sessionRevision
    })).filter(({ publication: observed }) => (
      observed.authorizationPublicationId === publication.authorizationPublicationId
    ));
    if (complete.length !== 1 || complete[0]!.commentId !== created.id) {
      throw new Error('authorization publication is not unique in complete remote readback');
    }
    return Object.freeze({ publication: readback, commentId: created.id, status: 'published',
      createdByThisInvocation: true,
      detail: `published authorization operation ${publication.authorizationPublicationId}` });
  } catch (error) {
    return Object.freeze({ publication: null, commentId: null, status: 'failed',
      createdByThisInvocation: false,
      detail: error instanceof Error ? error.message : String(error) });
  }
}

export async function ensureHostedReviewLocator(
  ctx: VerificationSessionScope,
  github: VerificationSessionGitHubClient,
  input: Readonly<{
    repository: string;
    prNumber: number;
    sessionRevision: `sha256:${string}`;
    operationId: `sha256:${string}`;
    headSha: string;
    headTreeSha: string;
    sourceRunId: string;
    sourceRunAttempt: number;
    workflowRef: string;
  }>
): Promise<Readonly<{
  status: 'published' | 'reused';
  commentId: string;
  publicationDigest: `sha256:${string}`;
}>> {
  const observed = (await github.observeHostedReviewLocator(input));
  if (observed.status === 'reused') {
    if (observed.commentId === null) {
      throw new Error('Hosted Review locator reuse has no comment identity.');
    }
    return Object.freeze({
      status: 'reused' as const,
      commentId: observed.commentId,
      publicationDigest: observed.publicationDigest
    });
  }
  const posted = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    '-X',
    'POST',
    `/repos/${input.repository}/issues/${input.prNumber}/comments`,
    '-f',
    `body=${observed.body}`
  ]);
  if (posted.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: hosted Review locator POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`
    );
  }
  let commentId: string;
  try {
    const response: unknown = JSON.parse(decodeBranchLifecycleChildStdout(posted));
    if (!response || typeof response !== 'object' || Array.isArray(response)
      || !Number.isSafeInteger((response as Record<string, unknown>).id)
      || Number((response as Record<string, unknown>).id) <= 0) {
      throw new Error('created comment has no positive id');
    }
    commentId = String((response as Record<string, unknown>).id);
  } catch (error) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: hosted Review locator POST response is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const exact = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    `/repos/${input.repository}/issues/comments/${commentId}`
  ]);
  if (exact.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: hosted Review locator exact readback failed: ${decodeBranchLifecycleChildError(exact)}`
    );
  }
  const complete = (await github.observeHostedReviewLocator(input));
  if (complete.status !== 'reused' || complete.commentId !== commentId
    || complete.publicationDigest !== observed.publicationDigest) {
    throw new Error(
      'AMBIGUOUS_SIDE_EFFECT: hosted Review locator is not unique after complete readback.'
    );
  }
  return Object.freeze({
    status: 'published' as const,
    commentId,
    publicationDigest: complete.publicationDigest
  });
}

async function ensureMaintainerReviewWakeup(
  ctx: VerificationSessionScope,
  github: VerificationSessionGitHubClient,
  input: Readonly<{
    repository: string;
    prNumber: number;
    sessionRevision: `sha256:${string}`;
    operationId: `sha256:${string}`;
    requestOperationId: `sha256:${string}`;
    headSha: string;
    headTreeSha: string;
    publisherLogin: string;
    publisherNodeId: string;
  }>
): Promise<Readonly<{
  status: 'published' | 'reused';
  commentId: string;
  wakeupDigest: `sha256:${string}`;
}>> {
  const observed = (await github.observeMaintainerReviewWakeup(input));
  if (observed.status === 'reused') {
    if (observed.commentId === null) throw new Error('Maintainer Review wake-up reuse has no comment identity.');
    return Object.freeze({ status: 'reused' as const, commentId: observed.commentId,
      wakeupDigest: observed.wakeupDigest });
  }
  const providerNow = new Date().toISOString();
  const providerAvailability = (await github.observeReviewProviderAvailability({
    repository: input.repository,
    prNumber: input.prNumber,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    observedAt: providerNow
  }));
  if (providerAvailability.status === 'unavailable') {
    throw new CodedFailure(
      'PROVIDER-UNAVAILABLE-NOT-RETRIED',
      'Provider codex-review is unavailable and must not be retried without an exact target-bound revalidation receipt.',
      {
        capability: 'codex-review',
        reasonCode: providerAvailability.reasonCode,
        receiptRef: providerAvailability.receiptRef,
        sourceCommentId: providerAvailability.sourceCommentId,
        sourceObservedAt: providerAvailability.sourceObservedAt,
        censusDigest: providerAvailability.censusDigest
      }
    );
  }
  if (providerAvailability.status === 'unresolved') {
    throw new CodedFailure(
      'PROVIDER-AVAILABILITY-UNRESOLVED',
      `Provider codex-review availability census is unresolved: ${providerAvailability.reason}.`,
      {
        capability: 'codex-review',
        reason: providerAvailability.reason,
        censusDigest: providerAvailability.censusDigest
      }
    );
  }
  const effectBoundaryNow = new Date().toISOString();
  const effectBoundaryAvailability = (await github.observeReviewProviderAvailability({
    repository: input.repository,
    prNumber: input.prNumber,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    observedAt: effectBoundaryNow
  }));
  if (effectBoundaryAvailability.status === 'unavailable') {
    throw new CodedFailure(
      'PROVIDER-UNAVAILABLE-NOT-RETRIED',
      'Provider codex-review became unavailable before wake-up publication; a new target-bound revalidation receipt is required.',
      {
        capability: 'codex-review',
        reasonCode: effectBoundaryAvailability.reasonCode,
        receiptRef: effectBoundaryAvailability.receiptRef,
        sourceCommentId: effectBoundaryAvailability.sourceCommentId,
        sourceObservedAt: effectBoundaryAvailability.sourceObservedAt,
        censusDigest: effectBoundaryAvailability.censusDigest
      }
    );
  }
  if (effectBoundaryAvailability.status === 'unresolved'
      || effectBoundaryAvailability.censusDigest !== providerAvailability.censusDigest) {
    throw new CodedFailure(
      'PROVIDER-AVAILABILITY-UNRESOLVED',
      'Provider codex-review availability changed before wake-up publication.',
      {
        capability: 'codex-review',
        initialCensusDigest: providerAvailability.censusDigest,
        effectBoundaryCensusDigest: effectBoundaryAvailability.censusDigest,
        effectBoundaryStatus: effectBoundaryAvailability.status,
        ...(effectBoundaryAvailability.status === 'unresolved'
          ? { reason: effectBoundaryAvailability.reason }
          : {})
      }
    );
  }
  const posted = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    '-X',
    'POST',
    `/repos/${input.repository}/issues/${input.prNumber}/comments`,
    '-f',
    `body=${observed.body}`
  ]);
  if (posted.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: maintainer Review wake-up POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`
    );
  }
  let commentId: string;
  try {
    const response: unknown = JSON.parse(decodeBranchLifecycleChildStdout(posted));
    if (!response || typeof response !== 'object' || Array.isArray(response)
      || !Number.isSafeInteger((response as Record<string, unknown>).id)
      || Number((response as Record<string, unknown>).id) <= 0) {
      throw new Error('created comment has no positive id');
    }
    commentId = String((response as Record<string, unknown>).id);
  } catch (error) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: maintainer Review wake-up POST response is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const exact = runVerificationSessionCommand(ctx, 'gh', [
    'api',
    `/repos/${input.repository}/issues/comments/${commentId}`
  ]);
  if (exact.status !== 0) {
    throw new Error(
      `AMBIGUOUS_SIDE_EFFECT: maintainer Review wake-up exact readback failed: ${decodeBranchLifecycleChildError(exact)}`
    );
  }
  const complete = (await github.observeMaintainerReviewWakeup(input));
  if (complete.status !== 'reused' || complete.commentId !== commentId
    || complete.wakeupDigest !== observed.wakeupDigest) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: maintainer Review wake-up is not unique after complete readback.');
  }
  return Object.freeze({ status: 'published' as const, commentId,
    wakeupDigest: complete.wakeupDigest });
}

export function assertHostedSquashMergeCompletion(input: {
  candidate: GitHubCandidateObservation;
  expectedBaseSha: string;
  expectedHeadSha: string;
  expectedHeadTreeSha: string;
  markers: readonly string[];
  reviewReceipt: ReviewStabilityReceipt;
  expectedTitle: string;
  providerMergeCommitSha?: string | null;
}): void {
  const { candidate } = input;
  if (candidate.state !== 'MERGED') {
    throw new Error(
      `hosted exact-head squash merge is not physically complete: candidate state is ${candidate.state}; `
      + 'merge-queue enqueue is not integration success.'
    );
  }
  if (candidate.headSha !== input.expectedHeadSha
    || candidate.headTreeSha !== input.expectedHeadTreeSha
    || candidate.mergeCommitSha === null
    || candidate.mergeCommitTreeSha !== input.expectedHeadTreeSha
    || candidate.mergeCommitMessage === null) {
    throw new Error('hosted exact-head squash merge completed with a mismatched head or merge tree.');
  }
  if (candidate.baseSha !== input.expectedBaseSha
    || candidate.mergeCommitParentShas?.length !== 1
    || candidate.mergeCommitParentShas[0] !== input.expectedBaseSha) {
    throw new Error('exact-head squash merge parent does not equal the verified base.');
  }
  const messageLines = candidate.mergeCommitMessage.split(/\r?\n/u);
  if (!input.markers.every((marker) => messageLines.includes(marker))) {
    throw new Error('hosted exact-head squash merge completed without the exact authorization markers.');
  }
  assertCanonicalMergeMessage({ authorizationMarkers: input.markers,
    reviewReceipt: input.reviewReceipt, expectedTitle: input.expectedTitle,
    message: candidate.mergeCommitMessage });
  if (input.providerMergeCommitSha !== undefined && input.providerMergeCommitSha !== null
    && candidate.mergeCommitSha !== input.providerMergeCommitSha) {
    throw new Error('hosted exact-head squash merge provider response does not match the merge commit readback.');
  }
}

export function parseHostedSynchronousSquashMergeResponse(
  source: string
): HostedSquashMergeResponse {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('hosted synchronous squash merge response is not valid JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hosted synchronous squash merge response must be one object.');
  }
  const record = value as Record<string, unknown>;
  if (record.merged !== true || typeof record.sha !== 'string'
    || !/^[0-9a-f]{40}$/u.test(record.sha) || typeof record.message !== 'string') {
    throw new Error('hosted synchronous squash merge response does not prove one physical merge commit.');
  }
  return Object.freeze({ merged: true, sha: record.sha, message: record.message });
}

export async function executeHostedSquashMerge(input: {
  ctx: VerificationSessionScope;
  repository: string;
  prNumber: number;
  headSha: string;
  sessionRevision: `sha256:${string}`;
  publication: IntegrationAuthorizationOperationPublication;
  commentId: number;
  issueDispositionPlan: IssueDispositionPlan;
}): Promise<HostedSquashMergeResponse> {
  const authorization = input.publication.result.authorization;
  const authorizationMarkers = integrationMergeMarkers({
    sessionRevision: input.sessionRevision,
    authorizationId: authorization.authorizationId,
    authorizationReceiptDigest: authorization.receiptDigest,
    consumptionOperationId: authorization.consumptionOperationId as `sha256:${string}`,
    authorizationPublicationId: input.publication.authorizationPublicationId,
    authorizationPublicationDigest: input.publication.publicationDigest,
    commentId: input.commentId
  });
  const reviewTrailer = renderIndependentReviewTrailer(input.publication.result.reviewReceipt);
  const issueMarkers = [
    `Issue-Disposition-Plan: ${input.issueDispositionPlan.planDigest}`,
    `Issue-Disposition-Mode: ${input.issueDispositionPlan.mode}`,
    `Issue-Disposition-Tracking: ${input.issueDispositionPlan.trackingIssueNumber ?? 'none'}`,
    `Issue-Disposition-Prose: ${input.issueDispositionPlan.titleBodyDigest}`
  ];
  const markers = [...authorizationMarkers, ...issueMarkers, reviewTrailer];
  const commitTitle = `Verified integration ${input.sessionRevision.slice(7, 19)}`;
  if (parseGitHubClosingKeywordOccurrences(
    `${commitTitle}\n${markers.join('\n')}`,
    input.repository
  ).length > 0) {
    throw new Error('Canonical merge renderer produced a forbidden GitHub closing-keyword pattern.');
  }
  const request = JSON.stringify({
    sha: input.headSha,
    merge_method: 'squash',
    commit_title: commitTitle,
    commit_message: markers.join('\n')
  });
  await assertBorrowedHostedSessionSourceCurrent(input.ctx, { repository: input.repository,
    pullRequestNumber: input.prNumber, headSha: input.headSha, sessionRevision: input.sessionRevision, authorization });
  const result = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', '--method', 'PUT',
    `/repos/${input.repository}/pulls/${input.prNumber}/merge`,
    '--input', '-'
  ], input.ctx.repositoryRoot, request);
  if (result.status !== 0) {
    throw new Error(
      `hosted synchronous exact-head squash merge failed: ${decodeBranchLifecycleChildError(result)}`
    );
  }
  return parseHostedSynchronousSquashMergeResponse(decodeBranchLifecycleChildStdout(result));
}

/**
 * Authority-bearing Review-provider revalidation operation.
 *
 * CLI command selection is deliberately outside this function. The operation
 * re-derives live PR identity, viewer authority, provider negative state,
 * exact comment publication/readback, candidate stability, and the selected
 * provider epoch before it returns a revalidation receipt.
 */
async function executeReviewProviderRevalidation(input: Readonly<{
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  prNumber: number;
  now: () => string;
}>): Promise<string> {
  const prNumber = Number(String(input.prNumber));
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr must be a positive integer.');
  const github = input.github;
  const candidate = (await github.observeCandidate(input.repository, prNumber));
  if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
    throw new Error('Review provider revalidation requires one open same-repository non-draft PR.');
  }
  const viewer = (await github.observeViewerPrincipal(input.repository));
  if (viewer.permission !== 'admin' && viewer.permission !== 'maintain') {
    throw new Error('Review provider revalidation requires current maintain/admin authority.');
  }
  const target = {
    repository: input.repository,
    prNumber,
    headSha: candidate.headSha,
    headTreeSha: candidate.headTreeSha
  } as const;
  const before = (await github.observeReviewProviderAvailability({ ...target, observedAt: input.now() }));
  if (before.status === 'unresolved') {
    throw new CodedFailure('PROVIDER-AVAILABILITY-UNRESOLVED',
      `Provider codex-review availability census is unresolved: ${before.reason}.`,
      { capability: 'codex-review', reason: before.reason, censusDigest: before.censusDigest });
  }
  if (before.status === 'no-current-negative') {
    return JSON.stringify({ status: 'revalidation-not-required', ...target,
      availabilityCensusDigest: before.censusDigest }, null, 2);
  }
  const rendered = createReviewProviderRevalidationCommentBody({
    ...target,
    publisherNodeId: viewer.nodeId
  });
  const posted = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', '-X', 'POST',
    `/repos/${input.repository}/issues/${prNumber}/comments`,
    '-f', `body=${rendered.body}`
  ]);
  if (posted.status !== 0) {
    throw new Error(`AMBIGUOUS_SIDE_EFFECT: Review provider revalidation POST outcome is unknown: ${decodeBranchLifecycleChildError(posted)}`);
  }
  const response: unknown = JSON.parse(decodeBranchLifecycleChildStdout(posted));
  if (!response || typeof response !== 'object' || Array.isArray(response)
      || !Number.isSafeInteger((response as Record<string, unknown>).id)
      || Number((response as Record<string, unknown>).id) < 1) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: Review provider revalidation POST returned no exact comment identity.');
  }
  const commentId = String((response as Record<string, unknown>).id);
  const exact = runVerificationSessionCommand(input.ctx, 'gh', [
    'api', `/repos/${input.repository}/issues/comments/${commentId}`
  ]);
  if (exact.status !== 0) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: Review provider revalidation exact readback failed.');
  }
  const readback: unknown = JSON.parse(decodeBranchLifecycleChildStdout(exact));
  if (!readback || typeof readback !== 'object' || Array.isArray(readback)
      || String((readback as Record<string, unknown>).id) !== commentId
      || (readback as Record<string, unknown>).body !== rendered.body) {
    throw new Error('AMBIGUOUS_SIDE_EFFECT: Review provider revalidation exact readback differs.');
  }
  const candidateAfter = (await github.observeCandidate(input.repository, prNumber));
  if (candidateAfter.state !== 'OPEN' || candidateAfter.headSha !== target.headSha
      || candidateAfter.headTreeSha !== target.headTreeSha) {
    throw new Error('Review provider revalidation target drifted during publication.');
  }
  const after = (await github.observeReviewProviderAvailability({ ...target, observedAt: input.now() }));
  if (after.status !== 'no-current-negative'
      || after.revalidationCommentId !== commentId
      || after.revalidationDigest !== rendered.revalidationDigest) {
    throw new Error('Review provider revalidation was not durably selected as the current target epoch.');
  }
  return JSON.stringify({ status: 'revalidated-for-single-probe', ...target,
    commentId, revalidationDigest: rendered.revalidationDigest,
    availabilityCensusDigest: after.censusDigest }, null, 2);
  
}

const USAGE = "Usage:\n  bun src/bootstrap/development/closeout/verification-session-cli.ts project --default-ref <ref> [--open-prs true] [--repository <owner/name>] [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts prepare --pr <n> --request-output <request.json> [--execution <local|hosted>] [--test-author-comment <id>] [--repository <owner/name>] [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts revalidate-review-provider --pr <n> [--repository <owner/name>] [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts observe-hosted --request <request.json> --output <facts.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts prepare-hosted --request <request.json> --facts <facts.json> --output <envelope.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts artifact-status --artifact <artifact.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts finalize-hosted --envelope <envelope.json> (--evidence <evidence.json> | --previous-artifact <artifact.json>) --output <artifact.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts prepare-integration-hosted --repository <owner/name> --output <projection.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts integrate-hosted --repository <owner/name> --output <projection.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts local-main-closeout --repository <owner/name> --pr <n> --protected-root <path> --expected-local-head <sha> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts closeout-mutate-hosted --repository <owner/name> --output <projection.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts closeout-publish-hosted --repository <owner/name> --output <projection.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts resume --request <request.json> [--execution <local|hosted>] [--repository <owner/name>] [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts freeze --artifact <artifact.json> --session-output <session.json> --scope-output <scope.json> [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts status --request <request.json> [--execution <local|hosted>] [--repository <owner/name>] [--json]\n  bun src/bootstrap/development/closeout/verification-session-cli.ts status-offline --session-file <session.json> [--json]\n  Local status/resume are read-only projections. To execute only local verification:\n  bun run sec:closeout --verification-only --request <request.json> [--test-author-comment <id>] [--repository <owner/name>]\n";

const COMMAND_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  project: new Set(['--default-ref', '--open-prs', '--repository']),
  prepare: new Set(['--pr', '--request-output', '--repository', '--execution', '--test-author-comment']),
  'revalidate-review-provider': new Set(['--pr', '--repository']),
  'observe-hosted': new Set(['--request', '--output', '--repository']),
  'prepare-hosted': new Set(['--request', '--facts', '--output']),
  'artifact-status': new Set(['--artifact']),
  'finalize-hosted': new Set(['--envelope', '--evidence', '--previous-artifact', '--output']),
  'local-main-closeout': new Set(['--repository', '--pr', '--protected-root', '--expected-local-head']),
  resume: new Set(['--request', '--repository', '--execution']),
  freeze: new Set(['--artifact', '--session-output', '--scope-output']),
  status: new Set(['--request', '--repository', '--execution']),
  'status-offline': new Set(['--session-file'])
});

/** Placement selects an existing owner; it grants no execution or integration authority. */
export function verificationSessionExecutionPlacement(value: string | undefined): 'local' | 'hosted' {
  if (value === undefined || value === 'local') return 'local';
  if (value === 'hosted') return 'hosted';
  throw new Error('--execution must be local or hosted.');
}

export function parseVerificationSessionCommand(argv: readonly string[]) {
  const command = argv[0];
  const allowedFlags = command === undefined ? undefined : COMMAND_FLAGS[command];
  if (allowedFlags === undefined) throw new Error(`Unknown command: ${command ?? '<missing>'}\n${USAGE}`);
  const args = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json') continue;
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    if (!allowedFlags.has(arg)) throw new Error(`Unknown argument for ${command}: ${arg}\n${USAGE}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
    args.set(arg, value);
    index += 1;
  }
  return { command, args, repository: args.get('--repository') ?? 'sec-platform/sec' };
}

export function captureHostedSessionCompilerCommand(argv: readonly string[]) {
  const { command, args, repository } = parseVerificationSessionCommand(argv);
  if (command !== 'observe-hosted' && command !== 'prepare-hosted' && command !== 'finalize-hosted') throw new Error('Hosted compiler command is unsupported.');
  const repositoryRoot = process.cwd();
  const environment = process.env;
  const ctx = createVerificationSessionScope({ repositoryRoot });
  const github = createVerificationSessionGitHubClient(repositoryRoot, repository);
  const request = command === 'finalize-hosted' ? null : parseVerificationSessionHostedRequest(readSessionArtifactText(required(args, '--request')));
  return { command, args, repository, repositoryRoot, environment, ctx, github, request,
    event: () => githubEvent(environment), required: (flag: string) => required(args, flag) };
}

export async function verificationSessionCli(argv: string[], closeoutOperations: import('../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts').WorktreePhysicalCloseoutOperations): Promise<string> {
  const { command, args, repository } = parseVerificationSessionCommand(argv);
  const repositoryRoot = process.cwd();
  const environment = process.env;
  const now = () => new Date().toISOString();
  const execution = new Set(['prepare', 'status', 'resume']).has(command)
    ? verificationSessionExecutionPlacement(args.get('--execution')) : null;
  if ((command === 'status' || command === 'resume') && execution === 'local') {
    // Parse exactly once before any Runtime State, Git, credentials or provider.
    const requestPath = path.resolve(required(args, '--request'));
    const request = parseVerificationSessionLocalPreparationRequest(readSessionArtifactText(requestPath));
    const { readLocalVerificationStatusWithTrustedRuntime } =
      await import('../../../../self-hosting/control/composition/trusted-runtime-closeout.ts');
    const projection = readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot, repository, request });
    return JSON.stringify({ ...projection,
      operation: command === 'resume' ? 'resume-projection' : 'status',
      nextVerification: { entrypoint: 'sec:closeout', arguments: [
        '--verification-only', '--request', requestPath, '--repository', repository
      ], requiresSeparateExecutionAdmission: true }
    }, null, 2);
  }
  if (command === 'prepare') {
    const prNumber = Number(required(args, '--pr'));
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr must be a positive integer.');
    const output = required(args, '--request-output');
    const rawAuthorComment = args.get('--test-author-comment');
    if (rawAuthorComment !== undefined && (execution !== 'local' || !/^[1-9][0-9]*$/u.test(rawAuthorComment)
        || !Number.isSafeInteger(Number(rawAuthorComment)))) {
      throw new Error('--test-author-comment requires local preparation and one exact positive comment id.');
    }
    if (execution === 'local') {
      const { prepareWithTrustedRuntime } = await import('../../../../self-hosting/control/composition/trusted-runtime-closeout.ts');
      const prepared = await prepareWithTrustedRuntime({ repositoryRoot, repository, prNumber,
        ...(rawAuthorComment === undefined ? {} : { testAuthorCommentId: Number(rawAuthorComment) }) });
      writeDurable(output, prepared.request);
      return JSON.stringify({ ...prepared, requestOutput: path.resolve(output) }, null, 2);
    }
  }
  // Decode placement before opening runtime state, Git, credentials or providers.
  // Retain this one decoded value so replacing the file cannot change admission.
  const selectedHostedRequest = new Set(['status', 'resume', 'observe-hosted', 'prepare-hosted']).has(command)
    ? parseVerificationSessionHostedRequest(readSessionArtifactText(required(args, '--request'))) : null;
  const hostedRequest = () => {
    if (selectedHostedRequest === null) throw new Error(`${command} did not select a hosted request.`);
    return selectedHostedRequest;
  };
  const ctx = createVerificationSessionScope({ repositoryRoot });
  let runtimeJournalFs: VerificationSessionJournalFileSystem | null = null;
  if (new Set(['prepare', 'resume', 'status', 'status-offline']).has(command)) {
    runtimeJournalFs = await openRuntimeJournalFileSystem(repositoryRoot, environment);
  }
  const durableJournalFs = (): VerificationSessionJournalFileSystem => {
    if (runtimeJournalFs === null) {
      throw new Error(`${command} did not acquire the canonical Runtime State journal authority.`);
    }
    return runtimeJournalFs;
  };
  const githubAdapter = () => createVerificationSessionGitHubClient(repositoryRoot, repository);
  // CLI command routing selects one closed operation only. The selected
  // operation revalidates every authority/target/effect precondition internally.
  // codeql[js/user-controlled-bypass]
  if (command === 'revalidate-review-provider') {
    const prNumber = Number(required(args, '--pr'));
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) {
      throw new Error('--pr must be a positive integer.');
    }
    return (await executeReviewProviderRevalidation({
      ctx,
      github: githubAdapter(),
      repository,
      prNumber,
      now
    }));
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'local-main-closeout') {
    const prNumber = Number(required(args, '--pr'));
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr must be a positive integer.');
    const liveCandidate = (await githubAdapter().observeCandidate(repository, prNumber));
    if (liveCandidate.state !== 'MERGED' || liveCandidate.mergeCommitMessage === null) {
      throw new Error('local-main closeout requires one live merged PR readback.');
    }
    const sessionRevision = exactCommitMarker(liveCandidate.mergeCommitMessage, 'Verification-Session');
    if (!/^sha256:[0-9a-f]{64}$/u.test(sessionRevision)) {
      throw new Error('merged commit Verification-Session marker is not an exact digest.');
    }
    const publications = await observeIntegrationAuthorizationOperationPublications(repositoryRoot, {
      repository,
      pullRequestNumber: prNumber,
      sessionRevision: sessionRevision as `sha256:${string}`
    });
    const selected = selectMergedAuthorizationPublication({
      candidate: liveCandidate,
      sessionRevision: sessionRevision as `sha256:${string}`,
      publications
    });
    const authorization = selected.publication.result.authorization;
    if (authorization.repository !== repository || authorization.prNumber !== prNumber
      || authorization.headSha !== liveCandidate.headSha
      || authorization.headTreeSha !== liveCandidate.headTreeSha
      || liveCandidate.mergeCommitTreeSha !== liveCandidate.headTreeSha) {
      throw new Error('live merged candidate differs from the hosted IntegrationAuthorization closure.');
    }
    const markers = integrationMergeMarkers({
      sessionRevision: selected.publication.sessionRevision,
      authorizationId: selected.publication.authorizationId,
      authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
      consumptionOperationId: selected.publication.consumptionOperationId,
      authorizationPublicationId: selected.publication.authorizationPublicationId,
      authorizationPublicationDigest: selected.publication.publicationDigest,
      commentId: selected.commentId
    });
    assertCanonicalMergeMessage({
      authorizationMarkers: markers,
      reviewReceipt: selected.publication.result.reviewReceipt,
      expectedTitle: `Verified integration ${sessionRevision.slice(7, 19)}`,
      message: liveCandidate.mergeCommitMessage
    });
    const protectedRoot = required(args, '--protected-root');
    const expectedLocalPreimageSha = required(args, '--expected-local-head');
    if (!/^[0-9a-f]{40}$/u.test(expectedLocalPreimageSha)) {
      throw new Error('--expected-local-head must be an exact commit SHA.');
    }
    const gitRunner = (repoRoot: string, gitArgs: readonly string[]) => {
      const observed = runVerificationSessionCommand(ctx, 'git', gitArgs, repoRoot);
      return Object.freeze({
        status: observed.status ?? 1,
        stdout: observed.stdout.toString('utf8'),
        stderr: observed.stderr.toString('utf8')
      });
    };
    const expectedLocalTree = gitRunner(protectedRoot, [
      'rev-parse', '--verify', `${expectedLocalPreimageSha}^{tree}`
    ]);
    if (expectedLocalTree.status !== 0 || !/^[0-9a-f]{40}$/u.test(expectedLocalTree.stdout.trim())) {
      throw new Error('expected local main preimage tree is unavailable.');
    }
    const binding = createLocalMainCloseoutBindingFromHostedAuthority({
      protectedRoot,
      expectedLocalPreimageSha,
      expectedLocalPreimageTreeSha: expectedLocalTree.stdout.trim(),
      hostedAuthority: {
        repository: selected.publication.repository,
        pullRequestNumber: selected.publication.pullRequestNumber,
        sessionRevision: selected.publication.sessionRevision,
        authorizationId: selected.publication.authorizationId,
        authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        consumptionOperationId: selected.publication.consumptionOperationId,
        authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationPublicationDigest: selected.publication.publicationDigest,
        authorizationHeadSha: authorization.headSha,
        authorizationHeadTreeSha: authorization.headTreeSha,
        reviewReceiptDigest: selected.publication.result.reviewReceipt.receiptDigest,
        reviewRevision: selected.publication.result.reviewReceipt.reviewRevision,
        integrationWorkflowSha: selected.publication.provenance.workflowSha,
        integrationRunId: selected.publication.provenance.runId,
        integrationRunAttempt: selected.publication.provenance.runAttempt
      },
      authorizationMarkers: markers,
      liveCommentId: selected.commentId,
      liveCandidate
    });
    const commonDir = commonGitDirectory(ctx, protectedRoot);
    const result = await withWorkspaceWriteLease(commonDir, undefined, (coordinatedLease) => (
      withWorkspaceWriteLease(protectedRoot, undefined, (lease) => (
        executeLocalMainCloseout(protectedRoot, binding, gitRunner, lease, coordinatedLease)
      ))
    ));
    const receipt = Object.freeze({
      schema: 'sec-local-main-closeout-receipt-v3', binding, result, observedAt: now()
    });
    return JSON.stringify(receipt, null, 2);
  }
  if (command === 'project') {
    const defaultRef = required(args, '--default-ref');
    const openPullRequests = args.get('--open-prs') === 'true'
      ? parseOpenPullRequestList(requireVerificationSessionCommandText(ctx, 'gh', [
          'pr', 'list', '--repo', repository, '--state', 'open', '--json',
          'number,headRefName,headRefOid,baseRefName,baseRefOid,body'
        ], 'open pull request inventory', ctx.repositoryRoot))
      : undefined;
    let registryRecords = 0;
    return projectWorkPackageRegistry({ observedAt: now(), repository,
      defaultBranch: 'main', defaultRef, ...(openPullRequests === undefined ? {} : { openPullRequests })
    }, (args, bytes) => runVerificationSessionCommand(ctx, 'git', args, ctx.repositoryRoot, bytes), {
      maxCommandStdoutBytes: SESSION_COMMAND_MAX_BUFFER,
      consumeRecords: count => {
        registryRecords += count;
        if (registryRecords > GIT_READ_DEFAULT_OPERATION_BUDGET.maxRecords) {
          throw new Error('Registry projection exceeds the Git read record budget.');
        }
      }
    });
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'prepare') {
    const prNumber = Number(required(args, '--pr'));
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr must be a positive integer.');
    const github = githubAdapter();
    const candidate = (await github.observeCandidate(repository, prNumber));
    if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
      throw new Error('prepare requires one open same-repository non-draft PR.');
    }
    const proof = inspectTrustedRuntime({ repositoryRoot });
    assertTrustedMainRuntime(proof, candidate.baseSha);
    const manifestPath = CodexDevelopmentParseWorkPackageLocator(candidate.body);
    const manifestSource = (await github.readBlobText(repository, candidate.headSha, manifestPath));
    const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestSource) as `sha256:${string}`;
    const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource);
    if (!CodexDevelopmentWorkPackageAcceptsObservedBase(manifest, candidate.baseSha)) {
      throw new Error('Work Package manifest base does not match the exact PR base.');
    }
    const changedSelection = await observeVerificationSessionChangedSelection({
      repositoryRoot,
      repository,
      prNumber,
      candidate,
      github
    });
    const changedPaths = changedSelection.changedPaths;
    CodexDevelopmentAssertWorkPackageOwnership(manifest, [...changedPaths]);
    const dependencyBlobs = (await observeVerificationSessionActionDependencyBlobs({ github, repository,
      baseSha: candidate.baseSha, headSha: candidate.headSha }));
    const principal = (await github.observeViewerPrincipal(repository));
    if (principal.permission !== 'admin' && principal.permission !== 'maintain') {
      throw new Error('prepare viewer lacks maintain/admin permission.');
    }
    const barrier = (await github.observeReviewBarrier({ repository, prNumber, headSha: candidate.headSha,
      excludedPrincipalNodeIds: new Set([candidate.authorNodeId, principal.nodeId]) }));
    const observedAt = now();
    const prepared = prepareTrustedMainVerificationSession({ repository, candidate, manifestPath, manifestDigest,
      executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
      changedPaths, testImpactTransition: changedSelection.testImpactTransition,
      testImpactSourceProvider: changedSelection.testImpactSourceProvider,
      profile: manifest.requiredProfile, integrationPrincipalNodeId: principal.nodeId,
      producerPrincipalNodeId: principal.nodeId, sourceRunId: environment.GITHUB_RUN_ID ?? `local-${process.pid}`,
      sourceRef: `refs/heads/main@${candidate.baseSha}`, observedAt, reviewBarrier: barrier,
      mainHealthChecks: (await github.observeChecks(repository, candidate.baseSha)), dependencyBlobs });
    writeDurable(required(args, '--request-output'), prepared.request);
    if (prepared.reviewBarrier.status === 'provider-schema-unsupported') {
      return JSON.stringify({ status: 'BLOCKED', sessionRevision: prepared.sessionRevision,
        reviewProvider: Object.freeze({ status: prepared.reviewBarrier.status,
          reasonCode: prepared.reviewBarrier.reasonCode,
          responseDigest: prepared.reviewBarrier.responseDigest,
          observedAt: prepared.reviewBarrier.observedAt }),
        reviewWakeup: null, dispatchSignalSent: false, workflowJoin: null,
        localVerification: null }, null, 2);
    }
    const reviewBarrierAllowsExecution = prepared.reviewBarrier.status === 'clear'
      || prepared.reviewBarrier.status === 'waiting';
    const journalFs = durableJournalFs();
    const journal = readVerificationSessionJournal({
      sessionRevision: prepared.sessionRevision,
      fs: journalFs
    });
    if (journal.completedStageIndex < 0) appendVerificationSessionJournalEvent({
      sessionRevision: prepared.sessionRevision, targetStage: 'frozen', kind: 'completed',
      receiptDigest: prepared.sessionRevision, operationId: null, fs: journalFs });
    let hosted = (await selectTrustedHostedSessionArtifact({ github, repository,
      transports: (await github.observeActionsArtifacts(repository)), request: prepared.request }));
    const localExecutionEnvironment = createCiVerificationLocalExecutionEnvironment({
      os: process.platform,
      arch: process.arch,
      bunVersion: Bun.version
    });
    const localVerification = hosted === null && reviewBarrierAllowsExecution
      ? await executePreparedLocalQuickDag({
          authorityRoot: repositoryRoot,
          candidate,
          sessionRevision: prepared.sessionRevision,
          actionPlanClosure: prepareLocalQuickVerificationActionPlan({
            candidate,
            manifestPath,
            manifestDigest,
            changedPaths,
            testImpactTransition: changedSelection.testImpactTransition,
            testImpactSourceProvider: changedSelection.testImpactSourceProvider,
            expectedTestImpactTransitionDigest: prepared.testImpactTransitionDigest,
            scopeAuthorizationRevision: prepared.scopeAuthorizationRevision,
            executionEnvironment: localExecutionEnvironment,
            dependencyBlobs
          }),
          executionEnvironment: localExecutionEnvironment,
          environment
        }, closeoutOperations)
      : null;
    if (hosted === null && localVerification?.result.status === 'passed') {
      // The local DAG may run long enough for another coordinator to publish.
      // Re-read provider state before deciding whether a wake-up is necessary.
      hosted = (await selectTrustedHostedSessionArtifact({ github, repository,
        transports: (await github.observeActionsArtifacts(repository)), request: prepared.request }));
    }
    let effectReviewBarrier: Awaited<ReturnType<VerificationSessionGitHubClient['observeReviewBarrier']>> =
      prepared.reviewBarrier;
    if (localVerification?.result.status === 'passed') {
      const effectCandidate = (await github.observeCandidate(repository, prNumber));
      const unchangedCandidate = effectCandidate.repository === candidate.repository
        && effectCandidate.number === candidate.number
        && effectCandidate.state === 'OPEN'
        && !effectCandidate.isDraft
        && !effectCandidate.isCrossRepository
        && effectCandidate.authorNodeId === candidate.authorNodeId
        && effectCandidate.baseBranch === candidate.baseBranch
        && effectCandidate.baseSha === prepared.request.expectedBaseSha
        && effectCandidate.baseTreeSha === prepared.request.expectedBaseTreeSha
        && effectCandidate.headBranch === candidate.headBranch
        && effectCandidate.headSha === prepared.request.expectedHeadSha
        && effectCandidate.headTreeSha === prepared.request.expectedHeadTreeSha
        && CodexDevelopmentParseWorkPackageLocator(effectCandidate.body) === prepared.request.manifestPath;
      if (!unchangedCandidate) {
        throw new Error('prepare candidate drifted after local quick verification and before Review wake-up.');
      }
      effectReviewBarrier = (await github.observeReviewBarrier({
        repository,
        prNumber,
        headSha: effectCandidate.headSha,
        excludedPrincipalNodeIds: new Set([effectCandidate.authorNodeId, principal.nodeId])
      }));
    }
    if (effectReviewBarrier.status === 'provider-schema-unsupported') {
      return JSON.stringify({
        status: 'BLOCKED',
        sessionRevision: prepared.sessionRevision,
        reviewProvider: effectReviewBarrier,
        reviewWakeup: null,
        dispatchSignalSent: false,
        workflowJoin: null,
        localVerification
      }, null, 2);
    }
    const reviewWakeup = shouldPublishMaintainerReviewWakeup({
      reviewBarrierStatus: effectReviewBarrier.status,
      localVerificationStatus: localVerification?.result.status ?? null,
      hostedArtifactPresent: hosted !== null
    })
      ? (await ensureMaintainerReviewWakeup(ctx, github, {
          repository,
          prNumber,
          sessionRevision: prepared.sessionRevision,
          operationId: createVerificationSessionOperationId({
            sessionRevision: prepared.sessionRevision,
            operationKind: 'request-review',
            semanticInputDigest: prepared.request.requestOperationId
          }),
          requestOperationId: prepared.request.requestOperationId,
          headSha: prepared.request.expectedHeadSha,
          headTreeSha: prepared.request.expectedHeadTreeSha,
          publisherLogin: principal.login,
          publisherNodeId: principal.nodeId
        }))
      : null;
    const runJoin = (await github.observeVerificationSessionWorkflowJoin({ repository, prNumber,
      sessionRevision: prepared.sessionRevision,
      actionPlanDigest: prepared.request.expectedActionPlanDigest,
      baseSha: prepared.request.expectedBaseSha,
      now: now() }));
    const effectReviewBarrierAllowsExecution = effectReviewBarrier.status === 'clear'
      || effectReviewBarrier.status === 'waiting';
    const localAllowsHostedSignal = localVerification === null
      ? hosted !== null
      : localVerification.result.status === 'passed';
    const dispatchSignalSent = effectReviewBarrierAllowsExecution
      && localAllowsHostedSignal && hosted === null && runJoin.status === 'redispatch-eligible';
    if (dispatchSignalSent) {
      // repository_dispatch is deliberately only an at-least-once wake-up
      // signal. The serialized hosted coordinator owns Review-request and
      // candidate execution dedup; the local journal is cache, not authority.
      (await github.ensureVerificationSessionWakeup(repository, prepared.request));
    }
    if (effectReviewBarrier.status === 'blocked') return JSON.stringify({ status: 'BLOCKED',
      sessionRevision: prepared.sessionRevision, reason: effectReviewBarrier.reason,
      reviewWakeup, dispatchSignalSent, workflowJoin: runJoin, localVerification: null }, null, 2);
    if (localVerification !== null && localVerification.result.status !== 'passed') {
      return JSON.stringify({
        status: localVerification.result.status === 'failed'
          ? 'LOCAL_VERIFICATION_FAILED' : 'LOCAL_VERIFICATION_BLOCKED',
        sessionRevision: prepared.sessionRevision,
        reason: localVerification.result.status === 'failed'
          ? 'local quick Action DAG failed; hosted dispatch is forbidden'
          : 'local quick Action DAG did not acquire a terminal journal result; hosted dispatch is forbidden',
        requestOperationId: prepared.request.requestOperationId,
        reviewWakeup,
        dispatchSignalSent,
        workflowJoin: runJoin,
        localVerification
      }, null, 2);
    }
    return JSON.stringify({
      status: effectReviewBarrier.status === 'clear'
        ? hosted !== null ? 'HOSTED_VERIFICATION_AVAILABLE' : 'WAITING_HOSTED_VERIFICATION'
        : 'WAITING_REVIEW',
      sessionRevision: prepared.sessionRevision, reason: effectReviewBarrier.status === 'clear'
        ? hosted !== null ? 'joined exact remote Session artifact'
          : runJoin.status === 'joined' ? `joined hosted coordinator ${runJoin.reason}` : 'hosted coordinator signaled'
        : `${effectReviewBarrier.reason}; hosted coordinator owns the canonical Review request`,
      requestOperationId: prepared.request.requestOperationId,
      reviewWakeup,
      dispatchSignalSent,
      workflowJoin: runJoin,
      localVerification,
      dispatchSemantics: 'at-least-once-signal-not-authority'
    }, null, 2);
  }
  if (command === 'freeze') {
    const artifact = CodexDevelopmentParseVerificationSessionArtifact(
      readSessionArtifactText(required(args, '--artifact'))
    );
    writeDurable(required(args, '--session-output'), artifact.session);
    writeDurable(required(args, '--scope-output'), artifact.scopeAuthorization);
    return JSON.stringify({ status: 'frozen', sessionRevision: artifact.session.sessionRevision,
      sessionOutput: path.resolve(required(args, '--session-output')),
      scopeOutput: path.resolve(required(args, '--scope-output')) }, null, 2);
  }
  if (command === 'status-offline') {
    const session = parseVerificationSession(readSessionArtifactText(required(args, '--session-file')));
    const journal = readVerificationSessionJournal({
      sessionRevision: session.sessionRevision,
      fs: durableJournalFs()
    });
    return JSON.stringify({ mode: 'offline-projection', session, journal }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'status') {
    const request = hostedRequest();
    const github = githubAdapter();
    const candidate = (await github.observeCandidate(repository, request.prNumber));
    const publications = await observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, { repository,
      pullRequestNumber: request.prNumber, sessionRevision: request.expectedSessionRevision });
    const durable = (await observeDurableVerificationSessionProjection({ ctx, github, repository, request,
      candidate, publications }));
    if (durable !== null) return JSON.stringify(durable, null, 2);
    const hosted = (await selectTrustedHostedSessionArtifact({ github, repository,
      transports: (await github.observeActionsArtifacts(repository)), request }));
    if (hosted === null) {
      const workflowJoin = (await github.observeVerificationSessionWorkflowJoin({ repository,
        prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        actionPlanDigest: request.expectedActionPlanDigest, baseSha: request.expectedBaseSha }));
      return JSON.stringify({ mode: 'remote', status: workflowJoin.status === 'joined'
        ? 'WAITING_HOSTED_VERIFICATION' : 'HOSTED_REDISPATCH_ELIGIBLE', repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision, workflowJoin }, null, 2);
    }
    const artifact = hosted.artifact;
    const reuse = classifyVerificationSessionArtifactReuse(artifact, now());
    return JSON.stringify({ mode: 'remote', status: artifact.evidence.status !== 'passed' ? 'BLOCKED'
      : reuse.status === 'whole-artifact-current'
        ? 'WAITING_INTEGRATION_AUTHORIZATION' : 'WAITING_HOSTED_AUTHORITY_REFRESH',
      reason: reuse.status === 'whole-artifact-current' ? null : reuse.reason,
      repository, prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      candidateState: candidate.state, evidenceStatus: artifact.evidence.status,
      artifactReuse: reuse.status }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'artifact-status') {
    const artifact = CodexDevelopmentParseVerificationSessionArtifact(
      readSessionArtifactText(required(args, '--artifact'))
    );
    return JSON.stringify(classifyVerificationSessionArtifactReuse(artifact, now()), null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'resume') {
    const request = hostedRequest();
    const github = githubAdapter();
    const candidate = (await github.observeCandidate(repository, request.prNumber));
    const authorizationPublications = await observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
      repository, pullRequestNumber: request.prNumber,
      sessionRevision: request.expectedSessionRevision
    });
    const durable = (await observeDurableVerificationSessionProjection({ ctx, github, repository, request,
      candidate, publications: authorizationPublications }));
    if (durable !== null) return JSON.stringify(durable, null, 2);
    const allArtifacts = (await github.observeActionsArtifacts(repository));
    const hosted = (await selectTrustedHostedSessionArtifact({ github, repository,
      transports: allArtifacts, request }));
    const runJoin = (await github.observeVerificationSessionWorkflowJoin({ repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      actionPlanDigest: request.expectedActionPlanDigest, baseSha: request.expectedBaseSha }));
    if (hosted === null) {
      const redispatched = runJoin.status === 'redispatch-eligible';
      if (redispatched) {
        (await github.ensureVerificationSessionWakeup(repository, request));
      }
      return JSON.stringify({ status: 'WAITING_HOSTED_VERIFICATION',
        sessionRevision: request.expectedSessionRevision,
        reason: redispatched
          ? 'trusted hosted artifact is not available; hosted coordinator was re-signaled'
          : `joined hosted coordinator ${runJoin.reason}`,
        redispatched, workflowJoin: runJoin,
        dispatchSemantics: 'at-least-once-signal-not-authority' }, null, 2);
    }
    const reuse = classifyVerificationSessionArtifactReuse(hosted.artifact, now());
    if (hosted.artifact.evidence.status !== 'passed') {
      return JSON.stringify({ status: 'BLOCKED', sessionRevision: request.expectedSessionRevision,
        reason: `hosted Action evidence is ${hosted.artifact.evidence.status}`,
        candidateState: candidate.state, workflowJoin: runJoin }, null, 2);
    }
    if (reuse.status !== 'whole-artifact-current') {
      const redispatched = runJoin.status === 'redispatch-eligible';
      if (redispatched) {
        (await github.ensureVerificationSessionWakeup(repository, request));
      }
      return JSON.stringify({ status: 'WAITING_HOSTED_AUTHORITY_REFRESH',
        sessionRevision: request.expectedSessionRevision, reason: reuse.reason,
        candidateState: candidate.state, redispatched, workflowJoin: runJoin,
        dispatchSemantics: 'at-least-once-signal-not-authority' }, null, 2);
    }
    return JSON.stringify({ status: 'WAITING_INTEGRATION_AUTHORIZATION',
      sessionRevision: request.expectedSessionRevision,
      reason: 'fresh exact hosted Session artifact is available; no durable App authorization receipt exists',
      candidateState: candidate.state, workflowJoin: runJoin }, null, 2);
  }
  throw new Error(USAGE);
}
