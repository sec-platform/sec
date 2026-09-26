#!/usr/bin/env bun
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/budget.ts';
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

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { CompilerError } from '../../../../../compiler/errors.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../../../filesystem/write-lease.ts';
import {
  compileIssueDisposition,
  createIssueAcceptanceId,
  createIssueDispositionPlan,
  parseGitHubClosingKeywordOccurrences,
  type IssueDisposition,
  type IssueDispositionDigest,
  type IssueDispositionPlan
} from '../../../../self-hosting/control/issues/disposition.ts';

import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/session.ts';
import type { GitHubWorkflowJobObservation, GitHubWorkflowRunObservation } from '../../../../providers/github-api/contract.ts';
import { createRuntimeStateJournalFileSystem } from '../../../../runtime-state/workspace-state/journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeJournalAuthority } from '../../../../runtime-state/workspace-state/physical-authority.ts';
import {
  BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
  authorizeBranchCloseout,
  createBranchCloseoutOperationBinding,
  createBranchCloseoutOperationJournal,
  createBranchCloseoutOperationReceipt,
  createBranchCloseoutReceipt,
  createBranchCloseoutRecoveryArtifact,
  parseBranchCloseoutOperationJournal,
  parseBranchCloseoutOperationReceipt,
  parseBranchCloseoutRecoveryArtifact,
  type BranchCloseoutEffect,
  type BranchCloseoutOperationJournal,
  type BranchCloseoutOperationReceipt,
  type BranchCloseoutOperationStore,
  type BranchCloseoutRecoveryArtifact
} from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import {
  BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
  assertBranchCloseoutEffectStartMatches,
  assertHostedCommentProvenanceLive,
  createBranchCloseoutEffectStartPublication,
  createBranchCloseoutOperationPublication,
  createHostedWorkflowCommentProvenance,
  hostedPublisherMatches,
  issueCommentRecord,
  observeBranchCloseoutEffectStartPublication,
  observeBranchCloseoutOperationPublication,
  parseBranchCloseoutEffectStartPublicationComment,
  parseBranchCloseoutOperationPublicationComment,
  renderBranchCloseoutEffectStartPublicationComment,
  renderBranchCloseoutOperationPublicationComment,
  type BranchCloseoutEffectStartPublication,
  type BranchCloseoutOperationPublication,
  type HostedWorkflowCommentProvenance
} from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import {
  operationJournalFilePath,
  operationReceiptFilePath,
  parsePreparedBranchCloseoutEnvelope,
  prepareMergedPullRequestCloseout,
  rehydratePreparedBranchCloseoutRecoveryArtifact,
  type PreparedBranchCloseoutEnvelope
} from '../../../../self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { assertGitBranchName, branchLifecycleDigest } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import {
  createBranchLifecycleGitChildEnvironment,
  createBranchLifecycleGitHubCredentialArgs,
  decodeBranchLifecycleChildError,
  decodeBranchLifecycleChildStdout
} from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { collectBranchLifecycleInventory } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import {
  BRANCH_REF_CLOSEOUT_CAPABILITY,
  type BranchCloseoutAttempt,
  type BranchCloseoutPreparation,
  type BranchLifecycleInventory
} from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import { verifyRecoveryAuthorityLive } from '../../../../self-hosting/control/branch-lifecycle/branch-recovery.ts';
import {
  createLocalMainCloseoutBindingFromHostedAuthority,
  executeLocalMainCloseout
} from '../../../../self-hosting/control/branch-lifecycle/local-main-closeout.ts';
import {
  assertTrustedCompletedWorktreePhysicalCloseout,
  executeDetachedScratchWorktreePhysicalCloseout,
  executeWorktreePhysicalCloseout,
  prepareDetachedScratchWorktreePhysicalCloseout,
  prepareTrustedWorktreePhysicalCloseout,
  type WorktreePhysicalCloseoutConsumptionToken
} from '../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import {
  observeActiveWorkPackage
} from '../../../../self-hosting/control/documentation/document-control-plane.ts';
import {
  assertHostedIntegrationPhaseOwnership,
  createIntegrationAuthorizationOperationPublication,
  observeIntegrationAuthorizationOperationPublications,
  parseIntegrationAuthorizationOperationPublication,
  parseIntegrationAuthorizationOperationPublicationComment,
  renderIntegrationAuthorizationOperationPublicationComment,
  selectCanonicalIntegrationRunOwner,
  type HostedIntegrationPhase,
  type HostedIntegrationPhaseOwnership,
  type IntegrationAuthorizationOperationPublication
} from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import {
  CodexDevelopmentEvaluateMergeGate,
  CodexDevelopmentParseMergeGateResult,
  assertCanonicalMergeMessage
} from '../../../../self-hosting/control/integration/merge-gate.ts';
import {
  observeGitHubIssue,
  observeUnexpectedGitHubIssueClosures
} from '../../../../self-hosting/control/issues/issue-disposition-github.ts';
import { createMainHealthLedger } from '../../../../self-hosting/control/main-health/contract.ts';
import { createObservedMainHealthInput } from '../../../../self-hosting/control/main-health/main-health-observation.ts';
import {
  createCiMainHealthRequestOperationId
} from '../../../../self-hosting/control/main-health/provider-policy.ts';
import type {
  ActiveWorkPackageOwnerObservation
} from '../../../../self-hosting/control/task/contract/active-work-observation.ts';
import {
  CodexDevelopmentAssertWorkPackageOwnership,
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../../../self-hosting/control/task/contract/work-package.ts';
import { executeVerifiedCiActionPlan } from '../../../../self-hosting/development/runner/verification-action-executor.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { CI_VERIFICATION_ACTION_DISPATCH_TYPE, assertCiVerificationActionProviderEnvelopeMember, ciVerificationActionParentDispatchPlanFile, ciVerificationActionParentDispatchPlanPayloadDigest, createCiVerificationLocalExecutionEnvironment, parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionProviderEnvelope, type CiVerificationActionParentDispatchPlan, type CiVerificationActionPlanClosure, type CiVerificationActionProviderEnvelope, type CiVerificationExecutionEnvironment } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, matchesCiCompilerWorkflowRunIdentity } from '../../action/contract/provider.ts';
import {
  executeLocalVerificationActionDag,
  type LocalVerificationActionDagResult
} from '../../action/runner.ts';
import { loadVerificationProviderCapabilityLedger } from '../../provider/capability-ledger.ts';
import { assertProviderRetryGuard, resolveProviderAvailability } from '../../provider/contract/capability.ts';
import { renderIndependentReviewTrailer, type ReviewStabilityReceipt } from '../../review/contract/stability.ts';
import { VERIFICATION_SESSION_RUNTIME_ENTRYPOINT_PATH, parseVerificationSession, type VerificationSession } from '../../session/contract/session.ts';
import type { CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../trust/contract/root.ts';
import {
  CodexDevelopmentCreateVerificationEvidenceProducer,
  CodexDevelopmentParseVerificationSessionArtifact
} from '../contract/evidence.ts';
import {
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from '../contract/revision.ts';
import {
  CodexDevelopmentDefaultChangedPaths,
  CodexDevelopmentExactGitWorkspaceSourceSnapshot,
  CodexDevelopmentTestImpactSourceProviderFromSnapshot
} from './ci-orchestration-core.ts';
import {
  createVerificationSessionGitHubClient,
  shouldPublishMaintainerReviewWakeup,
  type GitHubActionsArtifactObservation,
  type GitHubCandidateObservation,
  type VerificationSessionGitHubClient
} from './verification-session-github.ts';
import {
  appendVerificationSessionJournalEvent,
  createEphemeralVerificationSessionJournalFs,
  createVerificationSessionOperationId,
  readVerificationSessionJournal,
  type VerificationSessionJournalFileSystem
} from './verification-session-journal.ts';
import {
  assertTrustedExactRevisionRuntime,
  assertTrustedMainRuntime,
  assertTrustedMergedRequestRuntimeReachability,
  assertTrustedMergedRuntimeReachability,
  classifyVerificationSessionArtifactReuse,
  compilePostMainIssueDispositionHealthReadback,
  createHostedArtifactObservation,
  createTrustedHostedArtifactProvenance,
  createTrustedIntegrationAuthorizationPublicationSource,
  createVerificationSessionMergeOperationId,
  createVerificationSessionReviewReceipt,
  finalizeVerificationSessionHostedArtifact,
  integrationMergeMarkers,
  parseVerificationSessionHostedRequest,
  prepareLocalQuickVerificationActionPlan,
  prepareTrustedMainVerificationSession,
  prepareVerificationSessionHosted,
  prepareVerificationSessionMergeInput,
  reconstructVerificationSessionHostedFacts,
  refreshVerificationSessionHostedArtifact,
  resumeVerificationSession,
  type TrustedRuntimeProof,
  type VerificationSessionHostedEnvelope,
  type VerificationSessionHostedFacts
} from './verification-session-runtime.ts';

const SESSION_COMMAND_TIMEOUT_MS = 60_000;
const SESSION_COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

interface VerificationSessionScope {
  readonly repositoryRoot: string;
  readonly remote?: string;
  readonly repositoryFullName?: string;
  readonly defaultBranch?: string;
  readonly recoveryRoot?: string;
  readonly activeWorkPackageObservation?: ActiveWorkPackageOwnerObservation;
}

function createVerificationSessionScope(input: VerificationSessionScope): VerificationSessionScope {
  return Object.freeze({ ...input });
}

async function createBranchLifecycleVerificationScope(
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
  const provider = input.github.observeChangedPaths({
    repository: input.repository,
    prNumber: input.prNumber,
    state: 'OPEN',
    draft: false,
    baseSha: input.candidate.baseSha,
    headSha: input.candidate.headSha
  });
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

function runVerificationSessionCommand(
  ctx: VerificationSessionScope,
  command: 'bun' | 'gh' | 'git',
  args: readonly string[],
  cwd = ctx.repositoryRoot,
  stdin?: string | Uint8Array
) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('VerificationSession command argument contains NUL.');
  }
  const spawned = spawnSync(command, [...args], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: SESSION_COMMAND_TIMEOUT_MS,
    maxBuffer: SESSION_COMMAND_MAX_BUFFER,
    input: stdin === undefined ? undefined : typeof stdin === 'string' ? Buffer.from(stdin, 'utf8') : Buffer.from(stdin),
    env: {
      ...(command === 'git'
        ? createBranchLifecycleGitChildEnvironment(process.env)
        : process.env),
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  return {
    status: spawned.status,
    stdout: Buffer.isBuffer(spawned.stdout)
      ? spawned.stdout
      : Buffer.from(String(spawned.stdout ?? '')),
    stderr: Buffer.isBuffer(spawned.stderr)
      ? spawned.stderr
      : Buffer.from(String(spawned.stderr ?? spawned.error?.message ?? ''))
  };
}

function requireVerificationSessionCommandText(
  ctx: VerificationSessionScope,
  command: 'bun' | 'gh' | 'git',
  args: readonly string[],
  label: string,
  cwd = ctx.repositoryRoot
): string {
  const result = runVerificationSessionCommand(ctx, command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return decodeBranchLifecycleChildStdout(result);
}

function requireCommand(
  ctx: VerificationSessionScope,
  command: 'git' | 'gh',
  args: readonly string[],
  label: string
): string {
  const result = runVerificationSessionCommand(ctx, command, args);
  if (result.status !== 0) throw new Error(`Trusted runtime ${label} failed.`);
  return decodeBranchLifecycleChildStdout(result);
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
function inspectTrustedRuntime(input: {
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

function synchronizeTrustedRemoteDefaultRef(input: {
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

export function observeVerificationSessionActionDependencyBlobs(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  baseSha: string;
  headSha: string;
}) {
  return Object.freeze(CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map((dependencyPath) =>
    Object.freeze({
      path: dependencyPath,
      baseSource: input.github.readBlobText(input.repository, input.baseSha, dependencyPath),
      candidateSource: input.github.readBlobText(input.repository, input.headSha, dependencyPath)
    })));
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(path.resolve(filePath), 'utf8')) as T;
}

function writeDurable(filePath: string, value: unknown): void {
  const target = path.resolve(filePath);
  const temporary = `${target}.tmp-${process.pid}`;
  const handle = openSync(temporary, 'w');
  try {
    writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, target);
  let directory: number | undefined;
  try {
    directory = openSync(path.dirname(target), 'r');
    fsyncSync(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Bun and Node do not expose directory fsync on Windows. This narrowly
    // preserves protected closeout there; file fsync and rename failures stay
    // fail-closed, as do all other directory-sync failures.
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    if (directory !== undefined) closeSync(directory);
  }
}

function writeCanonicalDurable(filePath: string, value: unknown): void {
  const target = path.resolve(filePath);
  const temporary = `${target}.tmp-${process.pid}`;
  const handle = openSync(temporary, 'w');
  try {
    writeFileSync(handle, `${encodeVerificationActionData(value)}\n`, 'utf8');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temporary, target);
}

const LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA =
  'sec-verification-session-local-candidate-worktree-owner-v1' as const;
const LOCAL_CANDIDATE_WORKTREE_DIRECTORY = path.join(
  '.tmp', 'codex', 'verification-session-candidates'
);

type LocalCandidateWorktreeOwner = Readonly<{
  schema: typeof LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA;
  authorityRoot: string;
  commonGitDirectory: string;
  candidateRoot: string;
  headSha: string;
  headTreeSha: string;
  sessionRevision: `sha256:${string}`;
  actionPlanDigest: `sha256:${string}`;
  ownerDigest: `sha256:${string}`;
}>;

type LocalCandidateWorktreeLease = Readonly<{
  owner: LocalCandidateWorktreeOwner;
  markerPath: string;
  reused: boolean;
}>;

function verificationSessionDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
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

function assertContainedPath(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a strict descendant of the trusted authority root.`);
  }
}

function ensureOrdinaryDirectoryChain(authorityRoot: string): string {
  let current = authorityRoot;
  for (const segment of LOCAL_CANDIDATE_WORKTREE_DIRECTORY.split(/[\\/]+/u)) {
    const next = path.join(current, segment);
    assertContainedPath(authorityRoot, next, 'local candidate worktree directory');
    if (!existsSync(next)) mkdirSync(next);
    const metadata = lstatSync(next);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('local candidate worktree directory must be an ordinary directory.');
    }
    const real = realpathSync.native(next);
    if (comparableFileSystemPath(real) !== comparableFileSystemPath(next)) {
      throw new Error('local candidate worktree directory crossed a symlink or reparse boundary.');
    }
    current = real;
  }
  return current;
}

function createLocalCandidateWorktreeOwner(input: {
  authorityRoot: string;
  commonGitDirectory: string;
  candidateRoot: string;
  headSha: string;
  headTreeSha: string;
  sessionRevision: `sha256:${string}`;
  actionPlanDigest: `sha256:${string}`;
}): LocalCandidateWorktreeOwner {
  const withoutDigest = Object.freeze({
    schema: LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA,
    authorityRoot: input.authorityRoot,
    commonGitDirectory: input.commonGitDirectory,
    candidateRoot: input.candidateRoot,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    sessionRevision: input.sessionRevision,
    actionPlanDigest: input.actionPlanDigest
  });
  return Object.freeze({ ...withoutDigest, ownerDigest: verificationSessionDigest(withoutDigest) });
}

function parseLocalCandidateWorktreeOwner(source: unknown): LocalCandidateWorktreeOwner {
  const value: unknown = typeof source === 'string' ? JSON.parse(source) : source;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('local candidate worktree owner marker must be an object.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  const expectedKeys = [
    'actionPlanDigest', 'authorityRoot', 'candidateRoot', 'commonGitDirectory',
    'headSha', 'headTreeSha', 'ownerDigest', 'schema', 'sessionRevision'
  ].sort().join(',');
  if (keys !== expectedKeys || record.schema !== LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA
    || typeof record.authorityRoot !== 'string' || !path.isAbsolute(record.authorityRoot)
    || typeof record.commonGitDirectory !== 'string' || !path.isAbsolute(record.commonGitDirectory)
    || typeof record.candidateRoot !== 'string' || !path.isAbsolute(record.candidateRoot)
    || typeof record.headSha !== 'string' || !/^[0-9a-f]{40}$/u.test(record.headSha)
    || typeof record.headTreeSha !== 'string' || !/^[0-9a-f]{40}$/u.test(record.headTreeSha)
    || typeof record.sessionRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.sessionRevision)
    || typeof record.actionPlanDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.actionPlanDigest)
    || typeof record.ownerDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.ownerDigest)) {
    throw new Error('local candidate worktree owner marker identity is invalid.');
  }
  const parsed = createLocalCandidateWorktreeOwner({
    authorityRoot: record.authorityRoot,
    commonGitDirectory: record.commonGitDirectory,
    candidateRoot: record.candidateRoot,
    headSha: record.headSha,
    headTreeSha: record.headTreeSha,
    sessionRevision: record.sessionRevision as `sha256:${string}`,
    actionPlanDigest: record.actionPlanDigest as `sha256:${string}`
  });
  if (parsed.ownerDigest !== record.ownerDigest) {
    throw new Error('local candidate worktree owner marker digest mismatch.');
  }
  return parsed;
}

function createExclusiveCanonicalFile(filePath: string, value: unknown): boolean {
  let handle: number;
  try {
    handle = openSync(filePath, 'wx');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeFileSync(handle, `${encodeVerificationActionData(value)}\n`, 'utf8');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  return true;
}

function gitText(ctx: VerificationSessionScope, cwd: string, args: readonly string[], label: string): string {
  return requireVerificationSessionCommandText(ctx, 'git', args, label, cwd).trim();
}

function commonGitDirectory(ctx: VerificationSessionScope, repositoryRoot: string): string {
  const source = gitText(ctx, repositoryRoot,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'Git common directory readback');
  return exactRealPath(source, 'Git common directory');
}

function inspectLocalVerificationActionRepositoryWithScope(
  ctx: VerificationSessionScope,
  repositoryRoot: string
) {
  const read = (args: readonly string[], label: string): string => (
    gitText(ctx, repositoryRoot, args, label)
  );
  return Object.freeze({
    headSha: read(['rev-parse', 'HEAD'], 'local VerificationAction HEAD readback'),
    headTreeSha: read(['rev-parse', 'HEAD^{tree}'], 'local VerificationAction tree readback'),
    trackedClean:
      read(
        ['diff', '--name-only', '--ignore-cr-at-eol'],
        'local VerificationAction unstaged tracked-state readback'
      ) === ''
      && read(
        ['diff', '--cached', '--name-only', '--ignore-cr-at-eol'],
        'local VerificationAction staged tracked-state readback'
      ) === ''
      && read(
        ['ls-files', '--others', '--exclude-standard'],
        'local VerificationAction untracked-state readback'
      ) === '',
    gitCommonDirectory: commonGitDirectory(ctx, repositoryRoot)
  });
}

function worktreeRegistration(ctx: VerificationSessionScope, authorityRoot: string, candidateRoot: string):
Readonly<{ headSha: string; detached: boolean }> | null {
  const result = runVerificationSessionCommand(ctx, 'git', ['worktree', 'list', '--porcelain', '-z'], authorityRoot);
  if (result.status !== 0) {
    throw new Error(`Cannot read Git worktree registration: ${decodeBranchLifecycleChildError(result)}`);
  }
  const records: Array<{ root: string; headSha: string | null; detached: boolean }> = [];
  let current: { root: string; headSha: string | null; detached: boolean } | null = null;
  const stdout = typeof result.stdout === 'string' ? result.stdout : result.stdout.toString('utf8');
  for (const field of stdout.split('\0')) {
    if (field.startsWith('worktree ')) {
      if (current !== null) records.push(current);
      current = { root: field.slice('worktree '.length), headSha: null, detached: false };
    } else if (current !== null && field.startsWith('HEAD ')) {
      current.headSha = field.slice('HEAD '.length);
    } else if (current !== null && field === 'detached') {
      current.detached = true;
    }
  }
  if (current !== null) records.push(current);
  const matching = records.filter((record) =>
    comparableFileSystemPath(record.root) === comparableFileSystemPath(candidateRoot));
  if (matching.length > 1) throw new Error('local candidate worktree has duplicate Git registrations.');
  const selected = matching[0];
  if (selected === undefined) return null;
  if (selected.headSha === null || !/^[0-9a-f]{40}$/u.test(selected.headSha)) {
    throw new Error('local candidate worktree Git registration has an invalid HEAD.');
  }
  return Object.freeze({ headSha: selected.headSha, detached: selected.detached });
}

function assertLocalCandidateWorktreeExact(input: {
  ctx: VerificationSessionScope;
  owner: LocalCandidateWorktreeOwner;
  allowTrackedChanges?: boolean;
}): void {
  const { ctx, owner } = input;
  const candidateMetadata = lstatSync(owner.candidateRoot);
  if (!candidateMetadata.isDirectory() || candidateMetadata.isSymbolicLink()) {
    throw new Error('local candidate worktree root must be an ordinary directory.');
  }
  if (comparableFileSystemPath(realpathSync.native(owner.candidateRoot))
      !== comparableFileSystemPath(owner.candidateRoot)) {
    throw new Error('local candidate worktree root crossed a symlink or reparse boundary.');
  }
  const gitFile = path.join(owner.candidateRoot, '.git');
  const gitMetadata = lstatSync(gitFile);
  if (!gitMetadata.isFile() || gitMetadata.isSymbolicLink()) {
    throw new Error('local candidate worktree .git marker must be an ordinary file.');
  }
  if (commonGitDirectory(ctx, owner.candidateRoot) !== owner.commonGitDirectory) {
    throw new Error('local candidate worktree belongs to another Git common directory.');
  }
  const root = gitText(ctx, owner.candidateRoot,
    ['rev-parse', '--path-format=absolute', '--show-toplevel'], 'candidate worktree root readback');
  if (comparableFileSystemPath(root) !== comparableFileSystemPath(owner.candidateRoot)) {
    throw new Error('local candidate worktree root readback differs from its owner marker.');
  }
  const headSha = gitText(ctx, owner.candidateRoot, ['rev-parse', 'HEAD'], 'candidate worktree HEAD readback');
  const headTreeSha = gitText(ctx, owner.candidateRoot,
    ['rev-parse', 'HEAD^{tree}'], 'candidate worktree tree readback');
  const trackedStatus = gitText(ctx, owner.candidateRoot,
    ['status', '--porcelain=v1', '--untracked-files=no'], 'candidate worktree tracked status');
  const registration = worktreeRegistration(ctx, owner.authorityRoot, owner.candidateRoot);
  if (headSha !== owner.headSha || headTreeSha !== owner.headTreeSha
    || (!input.allowTrackedChanges && trackedStatus !== '')
    || registration === null || registration.headSha !== owner.headSha || !registration.detached) {
    throw new Error('local candidate worktree is not the exact clean detached candidate.');
  }
}

function acquireLocalCandidateWorktree(input: {
  ctx: VerificationSessionScope;
  authorityRoot: string;
  candidate: GitHubCandidateObservation;
  sessionRevision: `sha256:${string}`;
  actionPlanClosure: CiVerificationActionPlanClosure;
}): LocalCandidateWorktreeLease {
  const authorityRoot = exactRealPath(input.authorityRoot, 'trusted authority root');
  const authorityMetadata = lstatSync(authorityRoot);
  if (!authorityMetadata.isDirectory()) throw new Error('trusted authority root must be a directory.');
  const commonDirectory = commonGitDirectory(input.ctx, authorityRoot);
  const trackedStatus = gitText(input.ctx, authorityRoot,
    ['status', '--porcelain=v1', '--untracked-files=no'], 'trusted authority tracked status');
  if (trackedStatus !== '') throw new Error('trusted authority root must remain tracked-clean.');
  const resolvedHead = gitText(input.ctx, authorityRoot,
    ['rev-parse', `${input.candidate.headSha}^{commit}`], 'candidate commit readback');
  const resolvedTree = gitText(input.ctx, authorityRoot,
    ['rev-parse', `${input.candidate.headSha}^{tree}`], 'candidate tree readback');
  if (resolvedHead !== input.candidate.headSha || resolvedTree !== input.candidate.headTreeSha) {
    throw new Error('trusted authority object database does not contain the exact candidate head and tree.');
  }
  const parent = ensureOrdinaryDirectoryChain(authorityRoot);
  const candidateRoot = path.join(parent, input.candidate.headSha);
  const markerPath = `${candidateRoot}.owner.json`;
  assertContainedPath(authorityRoot, candidateRoot, 'local candidate worktree');
  const owner = createLocalCandidateWorktreeOwner({ authorityRoot, commonGitDirectory: commonDirectory,
    candidateRoot, headSha: input.candidate.headSha, headTreeSha: input.candidate.headTreeSha,
    sessionRevision: input.sessionRevision,
    actionPlanDigest: input.actionPlanClosure.actionPlanDigest as `sha256:${string}` });
  const createdMarker = createExclusiveCanonicalFile(markerPath, owner);
  if (!createdMarker) {
    const markerMetadata = lstatSync(markerPath);
    if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) {
      throw new Error('local candidate worktree owner marker must be an ordinary file.');
    }
    const observed = parseLocalCandidateWorktreeOwner(readFileSync(markerPath, 'utf8'));
    if (encodeVerificationActionData(observed) !== encodeVerificationActionData(owner)) {
      throw new Error('local candidate worktree is owned by a different Session or Action plan.');
    }
  }
  const registration = worktreeRegistration(input.ctx, authorityRoot, candidateRoot);
  const candidateExists = existsSync(candidateRoot);
  if (registration !== null || candidateExists) {
    if (registration === null || !candidateExists) {
      throw new Error('local candidate worktree filesystem and Git registration disagree.');
    }
    assertLocalCandidateWorktreeExact({ ctx: input.ctx, owner });
    return Object.freeze({ owner, markerPath, reused: true });
  }
  const add = runVerificationSessionCommand(input.ctx, 'git',
    ['worktree', 'add', '--detach', candidateRoot, input.candidate.headSha], authorityRoot);
  if (add.status !== 0) {
    const afterFailure = worktreeRegistration(input.ctx, authorityRoot, candidateRoot);
    if (afterFailure === null || !existsSync(candidateRoot)) {
      throw new Error(`Cannot materialize exact local candidate worktree: ${decodeBranchLifecycleChildError(add)}`);
    }
  }
  assertLocalCandidateWorktreeExact({ ctx: input.ctx, owner });
  return Object.freeze({ owner, markerPath, reused: false });
}

async function removeLocalCandidateWorktree(input: {
  ctx: VerificationSessionScope;
  lease: LocalCandidateWorktreeLease;
}): Promise<'removed' | 'retained-physical-closeout-blocked'> {
  const observed = parseLocalCandidateWorktreeOwner(readFileSync(input.lease.markerPath, 'utf8'));
  if (encodeVerificationActionData(observed) !== encodeVerificationActionData(input.lease.owner)) {
    throw new Error('local candidate worktree cleanup owner marker drifted.');
  }
  // Local quick verification uses a detached scratch worktree.  It belongs to
  // Issue #186's physical owner but cannot mint a branch/ref-closeout token:
  // the opaque branch-consumption path explicitly rejects detached-scratch
  // authorizations.  Dirty or identity-drifted scratch state is retained for
  // inspection; never fall back to a path-based Git worktree effect.
  try {
    const authorization = await prepareDetachedScratchWorktreePhysicalCloseout({
      repositoryRoot: observed.authorityRoot,
      targetPath: observed.candidateRoot,
      expectedHeadSha: observed.headSha,
      expectedTreeSha: observed.headTreeSha,
      expectedRecoveryAuthorityDigest: observed.ownerDigest
    });
    const receipt = await executeDetachedScratchWorktreePhysicalCloseout({
      repositoryRoot: observed.authorityRoot,
      targetPath: observed.candidateRoot,
      expectedHeadSha: observed.headSha,
      expectedTreeSha: observed.headTreeSha,
      expectedRecoveryAuthorityDigest: observed.ownerDigest,
      authorizationPath: authorization.authorizationPath
    });
    if (receipt.terminal !== 'completed'
      || receipt.readback.registryPresent || receipt.readback.physicalPresent
      || !receipt.readback.authorizationValid
      || comparableFileSystemPath(receipt.repository.root) !== comparableFileSystemPath(observed.authorityRoot)
      || comparableFileSystemPath(receipt.target.path) !== comparableFileSystemPath(observed.candidateRoot)
      || receipt.target.headSha !== observed.headSha
      || receipt.target.treeSha !== observed.headTreeSha
      || receipt.target.recoveryAuthorityDigest !== observed.ownerDigest) {
      return 'retained-physical-closeout-blocked';
    }
    unlinkSync(input.lease.markerPath);
    return 'removed';
  } catch {
    return 'retained-physical-closeout-blocked';
  }
}

async function executePreparedLocalQuickDag(input: {
  ctx: VerificationSessionScope;
  authorityRoot: string;
  candidate: GitHubCandidateObservation;
  sessionRevision: `sha256:${string}`;
  actionPlanClosure: CiVerificationActionPlanClosure;
  executionEnvironment: CiVerificationExecutionEnvironment;
  environment: NodeJS.ProcessEnv;
}): Promise<Readonly<{
  result: LocalVerificationActionDagResult;
  worktreeDisposition: 'created-and-removed' | 'reused-and-removed' | 'retained-blocked' | 'retained-physical-closeout-blocked';
}>> {
  const lease = acquireLocalCandidateWorktree(input);
  const result = await executeLocalVerificationActionDag({
    authorityRoot: lease.owner.authorityRoot,
    candidateRoot: lease.owner.candidateRoot,
    actionPlanClosure: input.actionPlanClosure,
    executionEnvironment: input.executionEnvironment,
    environment: input.environment,
    executeActionPlan: (providerInput) => executeVerifiedCiActionPlan(providerInput),
    inspectRepository: (repositoryRoot) => (
      inspectLocalVerificationActionRepositoryWithScope(input.ctx, repositoryRoot)
    )
  });
  if (result.status === 'blocked') {
    return Object.freeze({ result, worktreeDisposition: 'retained-blocked' });
  }
  const scratchCloseout = await removeLocalCandidateWorktree({ ctx: input.ctx, lease });
  if (scratchCloseout === 'retained-physical-closeout-blocked') {
    return Object.freeze({ result, worktreeDisposition: scratchCloseout });
  }
  return Object.freeze({ result,
    worktreeDisposition: lease.reused ? 'reused-and-removed' : 'created-and-removed' });
}

function branchCloseoutStore(): BranchCloseoutOperationStore {
  return {
    read: (filePath) => existsSync(filePath) ? readFileSync(filePath, 'utf8') : null,
    createExclusive: (filePath, bytes) => {
      try {
        const handle = openSync(filePath, 'wx');
        try { writeFileSync(handle, bytes, 'utf8'); fsyncSync(handle); } finally { closeSync(handle); }
        return true;
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return false;
        throw error;
      }
    },
    replace: (filePath, expectedBytes, nextBytes) => {
      if (readFileSync(filePath, 'utf8') !== expectedBytes) throw new Error('closeout store CAS mismatch.');
      writeDurable(filePath, JSON.parse(nextBytes));
    }
  };
}

function required(args: ReadonlyMap<string, string>, name: string): string {
  const value = args.get(name);
  if (value === undefined) throw new Error(`${name} is required.\n${USAGE}`);
  return value;
}

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

const HOSTED_INTEGRATION_PREFLIGHT_RESULT_FILE =
  'integration-preflight-result-v2.json' as const;

function hostedIntegrationPreflightResultPath(repositoryRoot: string): string {
  return path.join(repositoryRoot, '.tmp', 'codex', HOSTED_INTEGRATION_PREFLIGHT_RESULT_FILE);
}

function assertHostedIntegrationPreflightStillControls(input: Readonly<{
  frozen: ReturnType<typeof CodexDevelopmentParseMergeGateResult>;
  fresh: ReturnType<typeof CodexDevelopmentEvaluateMergeGate>;
}>): void {
  const stableFields = [
    'consumptionOperationId', 'repository', 'prNumber', 'sessionRevision',
    'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'manifestDigest',
    'scopeAuthorizationRevision', 'scopeAuthorizationReceiptDigest',
    'actionClosureDigest', 'evidenceDigest', 'trustRevision', 'rulesetDigest'
  ] as const;
  for (const field of stableFields) {
    if (input.frozen.authorization[field] !== input.fresh.authorization[field]) {
      throw new Error(`integrate-hosted frozen preflight ${field} drifted before effect.`);
    }
  }
  if (input.frozen.authorization.expiresAt <= new Date().toISOString()) {
    throw new Error('integrate-hosted frozen preflight expired before effect.');
  }
}

function appendTrustedGitHubOutput(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  value: string
): void {
  const outputPath = environment.GITHUB_OUTPUT;
  if (outputPath === undefined || outputPath.length === 0) {
    throw new Error('Trusted hosted recovery preparation requires GITHUB_OUTPUT.');
  }
  if (!/^[a-z][a-z0-9-]*$/u.test(name) || value.length === 0 || /[\r\n]/u.test(value)) {
    throw new Error('Trusted GitHub step output name/value is invalid.');
  }
  const handle = openSync(outputPath, 'a');
  try {
    writeFileSync(handle, `${name}=${value}\n`, 'utf8');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

function materializeBranchCloseoutRecoveryArtifact(input: {
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
  const bundleBytes = readFileSync(input.prepared.preparation.recovery.path);
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
  appendTrustedGitHubOutput(input.environment, 'recovery-artifact-name', artifactName);
  appendTrustedGitHubOutput(input.environment, 'recovery-artifact-file', artifactFilePath);
  return Object.freeze({ artifact, artifactName, artifactFilePath });
}

function loadProviderBranchCloseoutRecoveryArtifact(input: {
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
    || metadata.workflowPath !== '.github/workflows/sec-merge-gate.yml'
    || metadata.workflowRef !== `.github/workflows/sec-merge-gate.yml@${input.session.baseSha}`
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

function addSeconds(instant: string, seconds: number): string {
  return new Date(new Date(instant).getTime() + seconds * 1000).toISOString();
}

/**
 * Deny-only routing guard: ledger observations never permit an effect. They
 * only suppress a same-epoch retry when the provider is explicitly unavailable.
 */
function assertUnavailableProviderCircuitBreakerInvariant(input: {
  ctx: VerificationSessionScope;
  capability: 'codex-review' | 'github-writer' | 'github-actions-hosted-verification';
  now: string;
}): void {
  const epoch = loadVerificationProviderCapabilityLedger(input.ctx.repositoryRoot);
  if (input.now < epoch.observedAt || input.now >= epoch.expiresAt) return;
  const capability = resolveProviderAvailability(epoch, input.capability);
  if (capability.availability !== 'unavailable') return;
  assertProviderRetryGuard({ previous: { availability: capability.availability, epochId: epoch.epochId },
    requested: { capability: input.capability, epochId: epoch.epochId } });
}

function githubEvent(environment: Readonly<Record<string, string | undefined>>): Record<string, any> {
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required for trusted hosted identity.');
  const value = readJson<unknown>(eventPath);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('GitHub event must be one object.');
  return value as Record<string, any>;
}

function hostedActorHandle(event: Record<string, any>): string {
  const login = event.sender?.login;
  if (typeof login !== 'string' || login.length === 0) throw new Error('Trusted GitHub event actor login is unavailable.');
  return login;
}

async function openRuntimeJournalFileSystem(
  repositoryRoot: string,
  environment: Readonly<Record<string, string | undefined>>
): Promise<VerificationSessionJournalFileSystem> {
  const authority = await acquireSecRuntimeJournalAuthority({ repositoryRoot, environment });
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment });
  return createRuntimeStateJournalFileSystem(authority.directory(roots.workspaceStateRoot));
}

function positiveEnvironmentInteger(name: string, environment: Readonly<Record<string, string | undefined>>): number {
  const value = Number(environment[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
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

function selectTrustedHostedSessionArtifact(input: {
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

function loadHostedArtifactForMergeWorkflow(
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

function hostedMergeWakeupLocator(event: Record<string, any>): Readonly<{
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

function exactCommitMarker(message: string, name: string): string {
  const prefix = `${name}: `;
  const matches = message.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
  if (matches.length !== 1 || matches[0]!.slice(prefix.length).length === 0) {
    throw new Error(`Merged commit must contain exactly one ${name} marker.`);
  }
  return matches[0]!.slice(prefix.length);
}

/**
 * Reads one exact merge marker without giving callers a second parser or
 * substring-based fallback.  Recovery paths use the committed marker only as
 * a locator and must still revalidate the referenced canonical artifacts.
 */
export function readExactCommitMarker(message: string, name: string): string {
  return exactCommitMarker(message, name);
}

/**
 * Canonical provider observation for an IssueDisposition plan.  The PR
 * candidate and the provider's closing-reference projection are deliberately
 * two observations; neither may be used alone at the merge fence.
 */
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

function selectMergedAuthorizationPublication(input: {
  candidate: GitHubCandidateObservation;
  sessionRevision: `sha256:${string}`;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
}): Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublication }> {
  const message = input.candidate.mergeCommitMessage;
  if (input.candidate.state !== 'MERGED' || message === null) {
    throw new Error('Merged PR has no exact merge commit message readback.');
  }
  const commentText = exactCommitMarker(message, 'Integration-Authorization-Comment');
  if (!/^[1-9][0-9]*$/u.test(commentText)) {
    throw new Error('Merged commit authorization comment marker is not a positive decimal id.');
  }
  const markerCommentId = Number(commentText);
  if (!Number.isSafeInteger(markerCommentId)) {
    throw new Error('Merged commit authorization comment marker exceeds safe integer range.');
  }
  const markerPublicationId = exactCommitMarker(message, 'Integration-Authorization-Publication');
  const markerPublicationDigest = exactCommitMarker(message,
    'Integration-Authorization-Publication-Digest');
  const markerAuthorizationId = exactCommitMarker(message, 'Integration-Authorization');
  const markerReceiptDigest = exactCommitMarker(message, 'Integration-Authorization-Receipt');
  const markerOperationId = exactCommitMarker(message, 'Integration-Authorization-Operation');
  const markerSession = exactCommitMarker(message, 'Verification-Session');
  const matches = input.publications.filter(({ commentId, publication }) => (
    commentId === markerCommentId
    && publication.authorizationPublicationId === markerPublicationId
    && publication.publicationDigest === markerPublicationDigest
    && publication.authorizationId === markerAuthorizationId
    && publication.authorizationReceiptDigest === markerReceiptDigest
    && publication.consumptionOperationId === markerOperationId
    && publication.sessionRevision === markerSession
    && publication.sessionRevision === input.sessionRevision
  ));
  if (matches.length !== 1) {
    throw new Error('Merged commit marker does not select exactly one trusted remote authorization publication.');
  }
  return matches[0]!;
}

function assertAuthorizationPublicationMatchesRequest(input: {
  publication: IntegrationAuthorizationOperationPublication;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  repository: string;
}): void {
  const authorization = input.publication.result.authorization;
  const checks: readonly [unknown, unknown, string][] = [
    [input.publication.repository, input.repository, 'publication repository'],
    [input.publication.pullRequestNumber, input.request.prNumber, 'publication pull request'],
    [input.publication.sessionRevision, input.request.expectedSessionRevision, 'publication Session'],
    [authorization.repository, input.repository, 'authorization repository'],
    [authorization.prNumber, input.request.prNumber, 'authorization pull request'],
    [authorization.sessionRevision, input.request.expectedSessionRevision, 'authorization Session'],
    [authorization.baseSha, input.request.expectedBaseSha, 'authorization base'],
    [authorization.baseTreeSha, input.request.expectedBaseTreeSha, 'authorization base tree'],
    [authorization.headSha, input.request.expectedHeadSha, 'authorization head'],
    [authorization.headTreeSha, input.request.expectedHeadTreeSha, 'authorization head tree'],
    [authorization.manifestDigest, input.request.manifestDigest, 'authorization manifest'],
    [authorization.actionClosureDigest, input.request.expectedActionPlanDigest, 'authorization Action closure'],
    [authorization.trustRevision, input.request.expectedBaseSha, 'authorization trust revision']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) throw new Error(`Durable ${label} differs from the trusted Session request.`);
  }
}

export const HOSTED_INTEGRATION_ROUTE_SCHEMA =
  'sec-verification-session-hosted-integration-route-v1' as const;

type HostedIntegrationRouteCommon = Readonly<{
  schema: typeof HOSTED_INTEGRATION_ROUTE_SCHEMA;
  repository: string;
  prNumber: number;
  sessionRevision: `sha256:${string}`;
  candidateState: GitHubCandidateObservation['state'];
}>;

export type HostedIntegrationRoute =
  | (HostedIntegrationRouteCommon & Readonly<{
      lane: 'open-first-effect';
      reason: 'exact-open-candidate-without-prior-effect';
    }>)
  | (HostedIntegrationRouteCommon & Readonly<{
      lane: 'merged-recovery';
      reason: 'exact-marker-bound-merged-candidate';
      mergeCommitSha: string;
      mergeCommitTreeSha: string;
    }>)
  | (HostedIntegrationRouteCommon & Readonly<{
      lane: 'blocked';
      reason:
        | 'candidate-session-identity-drift'
        | 'open-candidate-identity-drift'
        | 'open-prior-effect-started'
        | 'merged-readback-incomplete-or-tree-mismatch'
        | 'pull-request-closed-without-exact-merge';
    }>);

export interface HostedIntegrationEffectPlan {
  prepareRecoveryArtifact: boolean;
  createAuthorizationPublication: boolean;
  executePhysicalMerge: boolean;
  consumeOriginalAuthorizationPublication: boolean;
  consumeOriginalRecoveryArtifact: boolean;
}

/**
 * Pure state router. Provider identity, TCB, artifact and publication proofs are
 * verified by the hosted transaction before this route can authorize an
 * effect. This function only prevents OPEN and MERGED semantics from sharing
 * one mutation path.
 */
export function routeHostedIntegration(input: {
  repository: string;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  priorEffectStarted: boolean;
  authorizationPublicationCount: number;
}): HostedIntegrationRoute {
  if (!Number.isSafeInteger(input.authorizationPublicationCount)
    || input.authorizationPublicationCount < 0) {
    throw new Error('Hosted integration authorization publication count must be a non-negative safe integer.');
  }
  const common = Object.freeze({ schema: HOSTED_INTEGRATION_ROUTE_SCHEMA,
    repository: input.repository, prNumber: input.session.prNumber,
    sessionRevision: input.session.sessionRevision, candidateState: input.candidate.state });
  const blocked = (reason: Extract<HostedIntegrationRoute, { lane: 'blocked' }>['reason']) => (
    Object.freeze({ ...common, lane: 'blocked' as const, reason })
  );
  if (input.candidate.repository !== input.repository
    || input.candidate.number !== input.session.prNumber
    || input.candidate.headSha !== input.session.headSha
    || input.candidate.headTreeSha !== input.session.headTreeSha) {
    return blocked('candidate-session-identity-drift');
  }
  if (input.candidate.state === 'OPEN') {
    if (input.candidate.baseSha !== input.session.baseSha
      || input.candidate.baseTreeSha !== input.session.baseTreeSha
      || input.candidate.isDraft || input.candidate.isCrossRepository) {
      return blocked('open-candidate-identity-drift');
    }
    if (input.priorEffectStarted || input.authorizationPublicationCount > 0) {
      return blocked('open-prior-effect-started');
    }
    return Object.freeze({ ...common, lane: 'open-first-effect' as const,
      reason: 'exact-open-candidate-without-prior-effect' as const });
  }
  if (input.candidate.state === 'MERGED') {
    if (input.candidate.mergeCommitSha === null || input.candidate.mergeCommitTreeSha === null
      || input.candidate.mergeCommitMessage === null
      || input.candidate.mergeCommitTreeSha !== input.session.headTreeSha) {
      return blocked('merged-readback-incomplete-or-tree-mismatch');
    }
    return Object.freeze({ ...common, lane: 'merged-recovery' as const,
      reason: 'exact-marker-bound-merged-candidate' as const,
      mergeCommitSha: input.candidate.mergeCommitSha,
      mergeCommitTreeSha: input.candidate.mergeCommitTreeSha });
  }
  return blocked('pull-request-closed-without-exact-merge');
}

/** Pure mutation-intent projection consumed by both hosted handlers and tests. */
export function planHostedIntegrationEffects(
  route: HostedIntegrationRoute
): Readonly<HostedIntegrationEffectPlan> {
  if (route.lane === 'open-first-effect') {
    return Object.freeze({ prepareRecoveryArtifact: true,
      createAuthorizationPublication: true, executePhysicalMerge: true,
      consumeOriginalAuthorizationPublication: false,
      consumeOriginalRecoveryArtifact: false });
  }
  if (route.lane === 'merged-recovery') {
    return Object.freeze({ prepareRecoveryArtifact: false,
      createAuthorizationPublication: false, executePhysicalMerge: false,
      consumeOriginalAuthorizationPublication: true,
      consumeOriginalRecoveryArtifact: true });
  }
  return Object.freeze({ prepareRecoveryArtifact: false,
    createAuthorizationPublication: false, executePhysicalMerge: false,
    consumeOriginalAuthorizationPublication: false,
    consumeOriginalRecoveryArtifact: false });
}

export function classifyDurableVerificationSessionProjection(input: {
  repository: string;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  candidate: GitHubCandidateObservation;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
  closeout?: Readonly<{
    closeoutOperationId: `sha256:${string}`;
    commentId: number;
    status: 'completed' | 'protected-pending' | 'blocked' | 'residue';
  }> | null;
}): Readonly<Record<string, unknown>> | null {
  const { candidate, repository, request, publications } = input;
  if (candidate.repository !== repository || candidate.number !== request.prNumber) {
    throw new Error('Durable Session PR identity differs from the trusted request.');
  }
  if (candidate.state === 'OPEN') {
    if (publications.length > 0) {
      return Object.freeze({ mode: 'remote', status: 'BLOCKED_AMBIGUOUS_SIDE_EFFECT',
        reason: 'an authorization effect-start receipt already exists while the PR is OPEN',
        repository, prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        candidateState: candidate.state,
        authorizationPublications: publications.map(({ publication, commentId }) => Object.freeze({
          authorizationPublicationId: publication.authorizationPublicationId,
          authorizationReceiptDigest: publication.authorizationReceiptDigest,
          commentId
        })) });
    }
    const exact = candidate.baseSha === request.expectedBaseSha
      && candidate.baseTreeSha === request.expectedBaseTreeSha
      && candidate.headSha === request.expectedHeadSha
      && candidate.headTreeSha === request.expectedHeadTreeSha
      && !candidate.isDraft && !candidate.isCrossRepository;
    if (!exact) {
      return Object.freeze({ mode: 'remote', status: 'BLOCKED',
        reason: 'OPEN candidate repository/base/head/tree identity drifted', repository,
        prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        candidateState: candidate.state });
    }
    return null;
  }
  if (candidate.state !== 'MERGED') {
    return Object.freeze({ mode: 'remote', status: 'BLOCKED',
      reason: 'pull request is closed without one marker-bound verified merge', repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      candidateState: candidate.state });
  }
  if (candidate.headSha !== request.expectedHeadSha
    || candidate.headTreeSha !== request.expectedHeadTreeSha
    || candidate.mergeCommitSha === null || candidate.mergeCommitTreeSha === null
    || candidate.mergeCommitMessage === null) {
    throw new Error('Durable MERGED Session readback is partial or differs from the trusted candidate.');
  }
  const selected = selectMergedAuthorizationPublication({ candidate,
    sessionRevision: request.expectedSessionRevision, publications });
  assertAuthorizationPublicationMatchesRequest({ publication: selected.publication, request, repository });
  if (candidate.mergeCommitTreeSha !== request.expectedHeadTreeSha) {
    return Object.freeze({ mode: 'remote', status: 'BLOCKED',
      reason: 'merged tree differs from verified candidate tree', repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      candidateState: candidate.state, mergeCommitSha: candidate.mergeCommitSha,
      mergeCommitTreeSha: candidate.mergeCommitTreeSha });
  }
  const binding = createBranchCloseoutOperationBinding({
    integrationAuthorization: selected.publication.result.authorization,
    preparation: selected.publication.closeoutPreparation.preparation,
    newMainSha: candidate.mergeCommitSha,
    newMainTreeSha: candidate.mergeCommitTreeSha,
    candidateTreeSha: request.expectedHeadTreeSha
  });
  if (input.closeout !== undefined && input.closeout !== null
    && input.closeout.closeoutOperationId !== binding.closeoutOperationId) {
    throw new Error('Durable closeout publication belongs to a different operation binding.');
  }
  const closeoutStatus = input.closeout?.status ?? null;
  return Object.freeze({ mode: 'remote', status: closeoutStatus === 'completed'
    || closeoutStatus === 'protected-pending' ? 'COMPLETED'
    : closeoutStatus === 'blocked' || closeoutStatus === 'residue' ? 'BLOCKED' : 'READY_TO_CLOSEOUT',
    reason: closeoutStatus === null ? 'marker-bound merge awaits canonical closeout publication' : null,
    durableSource: 'github-app-comments-and-merge-marker', repository,
    prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
    candidateState: candidate.state, mergeCommitSha: candidate.mergeCommitSha,
    mergeCommitTreeSha: candidate.mergeCommitTreeSha,
    authorizationPublicationId: selected.publication.authorizationPublicationId,
    authorizationCommentId: selected.commentId, closeoutOperationId: binding.closeoutOperationId,
    closeoutCommentId: input.closeout?.commentId ?? null, closeoutStatus });
}

function observeDurableVerificationSessionProjection(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  candidate: GitHubCandidateObservation;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
}): Readonly<Record<string, unknown>> | null {
  if (input.candidate.state === 'MERGED') {
    assertTrustedMergedRequestRuntimeReachability({
      proof: inspectTrustedRuntime({ repositoryRoot: input.ctx.repositoryRoot }),
      repository: input.repository,
      prNumber: input.request.prNumber,
      baseSha: input.request.expectedBaseSha,
      headSha: input.request.expectedHeadSha,
      headTreeSha: input.request.expectedHeadTreeSha,
      candidate: input.candidate,
      github: input.github
    });
  }
  const initial = classifyDurableVerificationSessionProjection(input);
  if (initial === null || input.candidate.state !== 'MERGED') return initial;
  const closeoutOperationId = initial.closeoutOperationId;
  if (typeof closeoutOperationId !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(closeoutOperationId)) {
    throw new Error('Durable merged projection did not produce one closeout operation identity.');
  }
  const closeout = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
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

function assertBoundPostMergeMain(input: Readonly<{
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

function assertHostedIntegrationIdentity(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  event: Record<string, any>;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  phase: HostedIntegrationPhase;
  environment: Readonly<Record<string, string | undefined>>;
  repositoryRoot: string;
}): Readonly<{
  provenance: HostedWorkflowCommentProvenance;
  phase: HostedIntegrationPhaseOwnership;
}> {
  const { ctx, github, repository, event, session, candidate, phase: requestedPhase,
    environment, repositoryRoot } = input;
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
  const expectedWorkflowRef = `${repository}/.github/workflows/sec-merge-gate.yml@refs/heads/main`;
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
    || currentRun.path !== '.github/workflows/sec-merge-gate.yml'
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
  const sourceActorLogin = sourceRun.actor?.login;
  const sourceActorNodeId = sourceRun.actor?.node_id;
  const sourceTriggeringActorLogin = sourceRun.triggering_actor?.login;
  const sourceTriggeringActorNodeId = sourceRun.triggering_actor?.node_id;
  if (typeof sourceActorLogin !== 'string' || typeof sourceActorNodeId !== 'string'
    || typeof sourceTriggeringActorLogin !== 'string' || typeof sourceTriggeringActorNodeId !== 'string') {
    throw new Error('integrate-hosted source actor/triggering principal identity is incomplete.');
  }
  const sourceActor = github.observePrincipal(repository, sourceActorLogin);
  const sourceTriggeringActor = github.observePrincipal(repository, sourceTriggeringActorLogin);
  if (sourceActor.nodeId !== sourceActorNodeId
    || (sourceActor.permission !== 'maintain' && sourceActor.permission !== 'admin')
    || sourceTriggeringActor.nodeId !== sourceTriggeringActorNodeId
    || (sourceTriggeringActor.permission !== 'maintain' && sourceTriggeringActor.permission !== 'admin')) {
    throw new Error('integrate-hosted source actor/triggering principal live identity is not trusted.');
  }
  selectCanonicalIntegrationRunOwner({
    runs: github.observeWorkflowRuns(repository, workflowSha), currentRunId: runId,
    currentRunAttempt: runAttempt, sourceRunId, sourceRunAttempt, baseSha: workflowSha
  });
  const currentJobName = environment.GITHUB_JOB ?? '';
  const attempts = Array.from({ length: runAttempt }, (_, index) => {
    const attempt = index + 1;
    return Object.freeze({ runAttempt: attempt,
      jobs: github.observeWorkflowJobsForAttempt(repository, runId, attempt) });
  });
  const phase = assertHostedIntegrationPhaseOwnership({ attempts, runId,
    currentRunAttempt: runAttempt, currentJobName, workflowSha, phase: requestedPhase });
  const proof = inspectTrustedRuntime({ repositoryRoot, candidateHeadSha: session.headSha });
  if (mergedRecovery) {
    assertTrustedMergedRuntimeReachability({ proof, session, candidate, github });
  } else {
    assertTrustedExactRevisionRuntime(proof, baseSha);
  }
  const provenance = createHostedWorkflowCommentProvenance({ repositoryId,
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    workflowRef: `.github/workflows/sec-merge-gate.yml@${workflowSha}`, workflowSha,
    runId, runAttempt, eventName: 'workflow_run', sourceRunId, sourceRunAttempt,
    actorLogin: sourceTriggeringActorLogin, actorNodeId: sourceTriggeringActorNodeId,
    actorPermission: sourceTriggeringActor.permission,
    app: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app });
  return Object.freeze({ provenance, phase });
}

function assertAuthorizationPublicationMatchesSession(input: {
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

function loadMarkerBoundMergedAuthorizationRecovery(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  session: VerificationSession;
  candidate: GitHubCandidateObservation;
  publications: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
}): Readonly<{
  selected: Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublication }>;
  recovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
}> {
  const selected = selectMergedAuthorizationPublication({ candidate: input.candidate,
    sessionRevision: input.session.sessionRevision, publications: input.publications });
  assertAuthorizationPublicationMatchesSession({ publication: selected.publication,
    repository: input.repository, session: input.session });
  const recovery = loadProviderBranchCloseoutRecoveryArtifact({ ctx: input.ctx,
    github: input.github, repository: input.repository, session: input.session,
    runId: selected.publication.recoveryArtifact.runId,
    runAttempt: selected.publication.recoveryArtifact.runAttempt });
  const remotePreparationDigest = recovery.remotePrepared.preparation.preparationDigest;
  const localPreparationDigest = recovery.prepared.preparation.preparationDigest;
  const publishedPreparationDigest =
    selected.publication.closeoutPreparation.preparation.preparationDigest;
  if (recovery.metadata.artifactId !== selected.publication.recoveryArtifact.artifactId
    || recovery.metadata.artifactName !== selected.publication.recoveryArtifact.artifactName
    || recovery.artifact.artifactDigest !== selected.publication.recoveryArtifact.artifactDigest
    || recovery.remotePrepared.envelopeDigest
      !== selected.publication.closeoutPreparation.envelopeDigest
    || encodeVerificationActionData(recovery.remotePrepared)
      !== encodeVerificationActionData(selected.publication.closeoutPreparation)
    || remotePreparationDigest !== localPreparationDigest
    || remotePreparationDigest !== publishedPreparationDigest) {
    throw new Error('Marker-bound recovery artifact differs from the original authorization publication.');
  }
  return Object.freeze({ selected, recovery });
}

function loadMergedHostedCloseoutContext(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  event: Record<string, any>;
  environment: Readonly<Record<string, string | undefined>>;
  repositoryRoot: string;
  phase: 'closeoutMutation' | 'closeoutPublication';
}): Readonly<{
  hosted: ReturnType<typeof loadHostedArtifactForMergeWorkflow>;
  candidate: GitHubCandidateObservation;
  identity: ReturnType<typeof assertHostedIntegrationIdentity>;
  selected: Readonly<{ commentId: number; publication: IntegrationAuthorizationOperationPublication }>;
  recovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
}> {
  const hosted = loadHostedArtifactForMergeWorkflow(input.github, input.repository, input.event);
  const artifact = hosted.artifact;
  if (artifact.session.repository !== input.repository) {
    throw new Error('Hosted closeout repository differs from the authenticated Session artifact.');
  }
  const candidate = input.github.observeCandidate(input.repository, artifact.session.prNumber);
  if (candidate.state !== 'MERGED' || candidate.mergeCommitSha === null
    || candidate.mergeCommitTreeSha === null || candidate.mergeCommitMessage === null
    || candidate.mergeCommitTreeSha !== artifact.session.headTreeSha) {
    throw new Error('Hosted closeout requires exact marker-bound merged tree parity.');
  }
  const identity = assertHostedIntegrationIdentity({ ctx: input.ctx, github: input.github,
    repository: input.repository, event: input.event, session: artifact.session, candidate,
    phase: input.phase, environment: input.environment, repositoryRoot: input.repositoryRoot });
  const publications = observeIntegrationAuthorizationOperationPublications(input.ctx.repositoryRoot, {
    repository: input.repository, pullRequestNumber: artifact.session.prNumber,
    sessionRevision: artifact.session.sessionRevision });
  const merged = loadMarkerBoundMergedAuthorizationRecovery({ ctx: input.ctx,
    github: input.github, repository: input.repository, session: artifact.session,
    candidate, publications });
  const { selected, recovery } = merged;
  const authorization = selected.publication.result.authorization;
  const binding = createBranchCloseoutOperationBinding({ integrationAuthorization: authorization,
    preparation: recovery.prepared.preparation, newMainSha: candidate.mergeCommitSha,
    newMainTreeSha: candidate.mergeCommitTreeSha, candidateTreeSha: artifact.session.headTreeSha });
  return Object.freeze({ hosted, candidate, identity, selected, recovery, binding });
}

type HostedTrackingIssueDispositionObservation =
  | Readonly<{ status: 'no-disposition-markers'; reason: 'issue-disposition-markers-absent' }>
  | Readonly<{ status: 'no-tracking-issue'; planDigest: `sha256:${string}` }>
  | Readonly<{ status: 'progressed'; receipt: IssueDisposition }>;

function observeHostedTrackingIssueDisposition(input: Readonly<{
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

/**
 * The post-merge MainHealth dispatch/join belongs to the invocation that will
 * consume physical closeout tokens.  A later Workflow step is a new process
 * and therefore cannot retain those capabilities.
 */
async function joinExactPostMergeMainHealth(input: Readonly<{
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

type HostedCloseoutEffectStartReadback = Readonly<{
  disposition: 'published' | 'existing';
  publication: BranchCloseoutEffectStartPublication;
  commentId: number;
}>;

function publishHostedCloseoutEffectStart(
  ctx: VerificationSessionScope,
  publication: BranchCloseoutEffectStartPublication
): HostedCloseoutEffectStartReadback {
  const existing = observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, {
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
  assertUnavailableProviderCircuitBreakerInvariant({
    ctx,
    capability: 'github-writer',
    now: new Date().toISOString()
  });
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
    assertHostedCommentProvenanceLive(
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
    assertHostedCommentProvenanceLive(
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

  const complete = observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, {
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

function closeoutAttempt(
  attempts: BranchCloseoutAttempt[],
  operation: BranchCloseoutAttempt['operation'],
  status: BranchCloseoutAttempt['status'],
  detail: string
): BranchCloseoutAttempt {
  const value = { operation, status, detail };
  attempts.push(value);
  return value;
}

function closeoutEffect(attempt: BranchCloseoutAttempt): BranchCloseoutEffect {
  return Object.freeze({
    state: attempt.status === 'success' ? 'applied' : 'failed',
    detailDigest: branchLifecycleDigest({ detail: attempt.detail })
  });
}

function deleteHostedRemoteRefCas(
  ctx: VerificationSessionScope,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): BranchCloseoutAttempt {
  const result = runVerificationSessionCommand(ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'push',
    '--porcelain',
    `--force-with-lease=refs/heads/${preparation.branch}:${preparation.expectedRemoteSha}`,
    preparation.repository.remote,
    `:refs/heads/${preparation.branch}`
  ], preparation.repository.root);
  return closeoutAttempt(
    attempts,
    'remote-delete',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `deleted refs/heads/${preparation.branch} at expected ${preparation.expectedRemoteSha}`
      : decodeBranchLifecycleChildError(result)
  );
}

function deleteHostedLocalRefCas(
  ctx: VerificationSessionScope,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): BranchCloseoutAttempt {
  const expected = preparation.expectedLocalSha ?? preparation.expectedHeadSha;
  const result = runVerificationSessionCommand(ctx, 'git', [
    'update-ref', '-d', `refs/heads/${preparation.branch}`, expected
  ], preparation.repository.root);
  return closeoutAttempt(
    attempts,
    'local-delete',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `deleted refs/heads/${preparation.branch} at expected ${expected}`
      : decodeBranchLifecycleChildError(result)
  );
}

function pruneHostedRemote(
  ctx: VerificationSessionScope,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): BranchCloseoutAttempt {
  const result = runVerificationSessionCommand(ctx, 'git', [
    'remote', 'prune', preparation.repository.remote
  ], preparation.repository.root);
  return closeoutAttempt(
    attempts,
    'prune',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `pruned ${preparation.repository.remote}`
      : decodeBranchLifecycleChildError(result)
  );
}

/**
 * A closeout authorization is a point-in-time deny gate, never a lease for a
 * later ref effect.  Every marker/ref/prune boundary therefore obtains this
 * under the canonical repository lease immediately before its effect.
 */
async function evaluateHostedCloseoutEffectPreconditionsUnderLease(input: Readonly<{
  ctx: VerificationSessionScope;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  lease: WorkspaceWriteLeaseToken;
  worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[];
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
}>): Promise<Readonly<{
  current: BranchLifecycleInventory;
  authorization: ReturnType<typeof authorizeBranchCloseout>;
}>> {
  const preparation = input.prepared.preparation;
  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  const observedCurrent = collectBranchLifecycleInventory(input.ctx);
  const recoveryReadback = verifyRecoveryAuthorityLive({
    inventory: observedCurrent,
    recovery: preparation.recovery
  });
  const current: BranchLifecycleInventory = {
    ...observedCurrent,
    unknowns: [...new Set([
      ...observedCurrent.unknowns,
      ...(recoveryReadback.status === 'success' ? [] : [recoveryReadback.detail])
    ])].sort((left, right) => left.localeCompare(right))
  };
  const expectedHeadTreeSha = requireCommand(
    input.ctx,
    'git',
    ['rev-parse', `${preparation.expectedHeadSha}^{tree}`],
    'branch closeout immediate effect prepared head tree'
  );
  const authorization = authorizeBranchCloseout({
    preparation,
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${input.binding.newMainSha}` }
    },
    before: input.prepared.before,
    current,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    expectedHeadTreeSha,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  return Object.freeze({ current, authorization });
}

/**
 * Pure routing only: neither a caller-supplied value nor this function is a
 * cleanup authority.  The sole production callback is the private opaque
 * token bridge below.  Keeping the foreign decision here makes it testable
 * without manufacturing a physical token or widening an effect API.
 */
export async function routePreparedWorktreeCleanupAttempt<T>(input: Readonly<{
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
  targetCount: number;
  consumeLocalPreparedTargets: () => Promise<readonly T[]>;
}>): Promise<readonly T[]> {
  if (input.foreignWorktreeObservationDigests.length !== 0 || input.targetCount === 0) {
    return Object.freeze([]);
  }
  const consumed = await input.consumeLocalPreparedTargets();
  if (consumed.length !== input.targetCount || consumed.length === 0) {
    throw new Error('same-host-worktree-closeout-required: exact physical completion token set is unavailable.');
  }
  return Object.freeze([...consumed]);
}

/**
 * Reads the pre-merge, same-job artifact only after its full canonical bytes
 * match the provider-authenticated artifact selected for the authorization.
 * The local file is a host observation, never a replacement authority.
 */
function loadOriginalHostPreparedCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  outputPath: string;
  providerRecovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
}>): PreparedBranchCloseoutEnvelope {
  const artifactPath = path.join(path.dirname(path.resolve(input.outputPath)),
    BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME);
  if (!existsSync(artifactPath)) {
    throw new Error('external-maintainer-disposition-required: original-host recovery artifact is unavailable.');
  }
  const source = readFileSync(artifactPath, 'utf8');
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
async function consumeSameHostWorktreeCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  prepared: PreparedBranchCloseoutEnvelope;
}>): Promise<readonly WorktreePhysicalCloseoutConsumptionToken[]> {
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
    const trusted = await prepareTrustedWorktreePhysicalCloseout({
      repositoryRoot: preparation.repository.root,
      targetPath,
      expectedBranch: preparation.branch,
      expectedHeadSha: preparation.expectedHeadSha,
      expectedTreeSha,
      expectedRecoveryAuthorityDigest: preparation.recovery.sha256
    });
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

async function finalizeHostedBranchCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  markerDisposition: 'published' | 'existing';
  writerId: string;
  now: () => string;
  lease: WorkspaceWriteLeaseToken;
  worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[];
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
}>): Promise<BranchCloseoutOperationReceipt> {
  const preparation = input.prepared.preparation;
  const attempts = [...input.prepared.attempts];
  const request = {
    capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
    disposition: 'merged',
    durableGoal: { kind: 'main', reference: `main@${input.binding.newMainSha}` }
  } as const;
  const remoteGuard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({
    ctx: input.ctx,
    prepared: input.prepared,
    binding: input.binding,
    lease: input.lease,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  const { current, authorization } = remoteGuard;
  let terminalAuthorization = authorization;
  const currentRemote = current.remoteBranches.find(({ branch }) => (
    branch === preparation.branch
  ));
  const currentPullRequest = preparation.pullRequestNumber === null
    ? undefined
    : current.pullRequests.find(({ number }) => number === preparation.pullRequestNumber);
  let remoteEffect: BranchCloseoutEffect;
  if (input.markerDisposition === 'published') {
    if (currentRemote === undefined || authorization.blockers.length > 0
      || authorization.remoteAction !== 'delete-cas') {
      const evidence = Object.freeze({
        currentRemote: currentRemote === undefined
          ? { present: false as const, sha: null }
          : { present: true as const, sha: currentRemote.sha },
        authorization: {
          remoteAction: authorization.remoteAction,
          blockers: [...authorization.blockers].sort((left, right) => left.localeCompare(right))
        },
        currentPullRequest: currentPullRequest === undefined
          ? null
          : { state: currentPullRequest.state, headSha: currentPullRequest.headSha },
        activeWorkPackage: {
          state: current.activeWorkPackage.state,
          branch: current.activeWorkPackage.branch
        },
        unknowns: [...current.unknowns].sort((left, right) => left.localeCompare(right))
      });
      throw new Error(
        'New App-authenticated closeout marker did not retain one exact authorized remote delete: '
        + encodeVerificationActionData(evidence)
      );
    }
    assertUnavailableProviderCircuitBreakerInvariant({
      ctx: input.ctx,
      capability: 'github-writer',
      now: input.now()
    });
    await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
    const remoteAttempt = deleteHostedRemoteRefCas(input.ctx, preparation, attempts);
    remoteEffect = closeoutEffect(remoteAttempt);
    if (remoteAttempt.status !== 'success') {
      throw new Error(
        'Provider-owned closeout remote deletion failed; the durable start marker forbids retry.'
      );
    }
  } else {
    if (currentRemote !== undefined || authorization.remoteAction !== 'already-absent') {
      throw new Error(
        'An existing closeout marker can recover only an exactly absent remote branch.'
      );
    }
    closeoutAttempt(
      attempts,
      'remote-delete',
      'skipped',
      'observed-absent under exact App-authenticated effect-start marker'
    );
    remoteEffect = Object.freeze({
      state: 'observed-absent',
      detailDigest: branchLifecycleDigest({
        detail: 'remote ref absent under exact App-authenticated effect-start marker'
      })
    });
  }

  // The host-local journal is deliberately opened only after the remote effect
  // has either completed under a newly-created marker or been provider-read back
  // as already absent under the exact existing marker.
  const store = branchCloseoutStore();
  const terminalPath = operationReceiptFilePath(
    preparation,
    input.binding.closeoutOperationId
  );
  const existingTerminal = store.read(terminalPath);
  if (existingTerminal !== null) {
    const terminal = parseBranchCloseoutOperationReceipt(existingTerminal);
    if (terminal.binding.closeoutOperationId !== input.binding.closeoutOperationId) {
      throw new Error('Persisted terminal receipt belongs to a different closeout operation.');
    }
    return terminal;
  }
  const journalPath = operationJournalFilePath(
    preparation,
    input.binding.closeoutOperationId
  );
  const initial = createBranchCloseoutOperationJournal({
    binding: input.binding,
    writerId: input.writerId,
    remote: remoteEffect,
    local: { state: 'not-started', detailDigest: null },
    prune: { state: 'not-started', detailDigest: null },
    terminalReceiptDigest: null
  });
  const canonicalBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  let journalBytes = store.read(journalPath);
  if (journalBytes === null) {
    const initialBytes = canonicalBytes(initial);
    if (!store.createExclusive(journalPath, initialBytes)) {
      journalBytes = store.read(journalPath);
      if (journalBytes === null) {
        throw new Error('Branch closeout operation journal raced without durable readback.');
      }
    } else {
      journalBytes = initialBytes;
    }
  }
  let journal = parseBranchCloseoutOperationJournal(journalBytes);
  if (journal.binding.closeoutOperationId !== input.binding.closeoutOperationId
    || journal.writerId !== input.writerId) {
    throw new Error('Branch closeout operation journal identity or owner conflicts.');
  }
  const updateJournal = (updates: Partial<Pick<
    BranchCloseoutOperationJournal,
    'remote' | 'local' | 'prune' | 'terminalReceiptDigest'
  >>): void => {
    const next = createBranchCloseoutOperationJournal({
      binding: journal.binding,
      writerId: journal.writerId,
      remote: updates.remote ?? journal.remote,
      local: updates.local ?? journal.local,
      prune: updates.prune ?? journal.prune,
      terminalReceiptDigest: updates.terminalReceiptDigest ?? journal.terminalReceiptDigest
    });
    const nextBytes = canonicalBytes(next);
    store.replace(journalPath, journalBytes!, nextBytes);
    journal = next;
    journalBytes = nextBytes;
  };
  if (journal.remote.state === 'not-started') {
    updateJournal({ remote: remoteEffect });
  } else if (journal.remote.state !== remoteEffect.state
    && !(journal.remote.state === 'applied' && remoteEffect.state === 'observed-absent')) {
    throw new Error('Host-local journal conflicts with the provider-observed remote effect.');
  }

  // The host-local journal is recovery memory, not effect authority. Recompute
  // the live owner authorization even when a prior state would otherwise be reused.
  const localGuard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({
    ctx: input.ctx,
    prepared: input.prepared,
    binding: input.binding,
    lease: input.lease,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  terminalAuthorization = localGuard.authorization;
  const currentLocal = localGuard.current.localBranches.find(({ branch }) => branch === preparation.branch);
  // A forged/stale journal can only suppress/reuse an idempotent effect; it
  // cannot skip the live authorization above, and final completion is derived
  // from a fresh inventory readback.
  // codeql[js/user-controlled-bypass]
  if (journal.local.state === 'not-started') {
    // Remote CAS is irreversible.  Re-registration or lease drift after it
    // must stop the remaining local effects rather than reusing remote proof.
    if (currentLocal === undefined) {
      closeoutAttempt(attempts, 'local-delete', 'skipped', 'observed-absent');
      updateJournal({ local: {
        state: 'observed-absent',
        detailDigest: branchLifecycleDigest({ detail: 'local ref absent at pre-effect readback' })
      } });
    } else if (localGuard.authorization.blockers.length === 0
      && localGuard.authorization.localAction === 'delete-exact') {
      await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
      const localAttempt = deleteHostedLocalRefCas(input.ctx, preparation, attempts);
      updateJournal({ local: closeoutEffect(localAttempt) });
    } else {
      closeoutAttempt(
        attempts,
        'local-delete',
        'skipped',
        localGuard.authorization.blockers.length > 0
          ? `blocked: ${localGuard.authorization.blockers.join(' | ')}`
          : localGuard.authorization.localAction
      );
    }
  } else {
    closeoutAttempt(attempts, 'local-delete', 'skipped', `reused ${journal.local.state}`);
  }

  const pruneGuard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({
    ctx: input.ctx,
    prepared: input.prepared,
    binding: input.binding,
    lease: input.lease,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  terminalAuthorization = pruneGuard.authorization;
  // Journal state is advisory recovery memory only; live authorization above
  // and final inventory readback remain mandatory.
  // codeql[js/user-controlled-bypass]
  if (journal.prune.state === 'not-started') {
    if (pruneGuard.authorization.blockers.length === 0) {
      await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
      const pruneAttempt = pruneHostedRemote(input.ctx, preparation, attempts);
      updateJournal({ prune: closeoutEffect(pruneAttempt) });
    } else {
      closeoutAttempt(attempts, 'prune', 'skipped', 'closeout authorization blocked');
    }
  } else {
    closeoutAttempt(attempts, 'prune', 'skipped', `reused ${journal.prune.state}`);
  }

  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  const after = collectBranchLifecycleInventory(input.ctx);
  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  closeoutAttempt(
    attempts,
    'readback',
    after.unknowns.length === 0 ? 'success' : 'failed',
    after.unknowns.length === 0
      ? `remote/local/PR/worktree readback completed at ${after.observedAt}`
      : after.unknowns.join(' | ')
  );
  const receipt = createBranchCloseoutReceipt({
    generatedAt: input.now(),
    preparation,
    request,
    authorization: terminalAuthorization,
    attempts,
    before: input.prepared.before,
    after
  });
  const terminal = createBranchCloseoutOperationReceipt({
    binding: input.binding,
    writerId: input.writerId,
    generatedAt: receipt.generatedAt,
    remote: journal.remote,
    local: journal.local,
    prune: journal.prune,
    receipt
  });
  const terminalBytes = canonicalBytes(terminal);
  if (!store.createExclusive(terminalPath, terminalBytes)) {
    const raced = store.read(terminalPath);
    if (raced === null || raced !== terminalBytes) {
      throw new Error('Same closeout operation produced different terminal receipt bytes.');
    }
    return parseBranchCloseoutOperationReceipt(raced);
  }
  updateJournal({ terminalReceiptDigest: terminal.operationReceiptDigest });
  return terminal;
}

async function finalizeSameInvocationCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  repository: string;
  pullRequestNumber: number;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  authorizationPublication: IntegrationAuthorizationOperationPublication;
  authorizationCommentId: number;
  recovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
  provenance: HostedWorkflowCommentProvenance;
  phase: HostedIntegrationPhaseOwnership;
  worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[];
  now: () => string;
}>): Promise<void> {
  if (input.phase.phase !== 'closeoutMutation'
    || input.phase.stepName !== BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME) {
    throw new Error('Same-invocation closeout does not own the canonical mutation phase.');
  }
  const expectedAuthorizationPublication = Object.freeze({
    authorizationPublicationId: input.authorizationPublication.authorizationPublicationId,
    publicationDigest: input.authorizationPublication.publicationDigest,
    commentId: input.authorizationCommentId
  });
  const expectedRecoveryArtifact = Object.freeze({
    artifactId: input.recovery.metadata.artifactId,
    artifactName: input.recovery.metadata.artifactName,
    artifactDigest: input.recovery.artifact.artifactDigest,
    runId: input.recovery.metadata.runId,
    runAttempt: input.recovery.metadata.runAttempt
  });
  const existing = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
    repository: input.repository, pullRequestNumber: input.pullRequestNumber,
    closeoutOperationId: input.binding.closeoutOperationId
  });
  if (existing !== null) return;
  await withWorkspaceWriteLease(input.ctx.repositoryRoot, undefined, async (lease) => {
    const guard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({ ctx: input.ctx,
      prepared: input.prepared, binding: input.binding, lease,
      worktreeCleanupTokens: input.worktreeCleanupTokens,
      foreignWorktreeObservationDigests: [] });
    if (guard.authorization.blockers.length !== 0 || guard.authorization.remoteAction !== 'delete-cas') {
      throw new Error('Branch closeout is not authorized before effect-start publication: '
        + encodeVerificationActionData(guard.authorization));
    }
    const effectStart = createBranchCloseoutEffectStartPublication({ binding: input.binding,
      authorizationPublication: expectedAuthorizationPublication,
      recoveryArtifact: expectedRecoveryArtifact,
      phase: { runId: input.phase.runId, runAttempt: input.phase.runAttempt, jobId: input.phase.jobId,
        jobName: 'integrate', phase: 'closeoutMutation',
        stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
        stepNumber: input.phase.stepNumber, workflowSha: input.provenance.workflowSha },
      provenance: input.provenance });
    await assertWorkspaceWriteLease(input.ctx.repositoryRoot, lease);
    const published = publishHostedCloseoutEffectStart(input.ctx, effectStart);
    if (published.disposition !== 'published') {
      throw new Error('AMBIGUOUS_SIDE_EFFECT: hosted closeout effect start was not newly App-authenticated.');
    }
    await finalizeHostedBranchCloseout({ ctx: input.ctx, prepared: input.prepared,
      binding: input.binding, markerDisposition: 'published', writerId: input.binding.closeoutOperationId,
      now: input.now, lease, worktreeCleanupTokens: input.worktreeCleanupTokens,
      foreignWorktreeObservationDigests: [] });
  });
}

function publishHostedCloseoutTerminal(input: Readonly<{
  ctx: VerificationSessionScope;
  operationReceipt: BranchCloseoutOperationReceipt;
  provenance: HostedWorkflowCommentProvenance;
  effectStart: HostedCloseoutEffectStartReadback;
}>): Readonly<{
  disposition: 'published' | 'reused' | 'recovered';
  publication: BranchCloseoutOperationPublication;
  commentId: number;
}> {
  const publication = createBranchCloseoutOperationPublication(
    input.operationReceipt,
    input.provenance,
    input.effectStart
  );
  const repository = publication.binding.repository;
  const pullRequestNumber = publication.binding.pullRequestNumber;
  const existing = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
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
  const start = observeBranchCloseoutEffectStartPublication(input.ctx.repositoryRoot, {
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
  const recover = (reason: string): Readonly<{
    disposition: 'recovered';
    publication: BranchCloseoutOperationPublication;
    commentId: number;
  }> => {
    const observed = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
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
  assertUnavailableProviderCircuitBreakerInvariant({
    ctx: input.ctx,
    capability: 'github-writer',
    now: new Date().toISOString()
  });
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
    assertHostedCommentProvenanceLive(
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
    assertHostedCommentProvenanceLive(
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
  const complete = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
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

function closeoutPublicationCompositeDigest(input: {
  closeoutOperationId: `sha256:${string}`;
  publicationDigest: `sha256:${string}`;
  commentId: number;
}): `sha256:${string}` {
  if (!Number.isSafeInteger(input.commentId) || input.commentId < 1) {
    throw new Error('Closeout publication comment id must be a positive safe integer.');
  }
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(input)).digest('hex')}`;
}

type HostedCompilerDispatchPayload = Readonly<{ payload: unknown }>;

function unwrapHostedCompilerDispatchPayload(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('observe-hosted repository_dispatch payload must be one object.');
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'payload') {
    throw new Error('observe-hosted repository_dispatch payload must be the exact one-key wrapper.');
  }
  return (input as HostedCompilerDispatchPayload).payload;
}

export function assertHostedCompilerDispatchPayload(input: {
  action: unknown;
  clientPayload: unknown;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
}): Readonly<{ kind: 'external-session' } | {
  kind: 'internal-action';
  envelope: CiVerificationActionProviderEnvelope;
}> {
  const { action, clientPayload, request } = input;
  const payload = unwrapHostedCompilerDispatchPayload(clientPayload);
  if (action === CI_VERIFICATION_SESSION_DISPATCH_TYPE) {
    if (encodeVerificationActionData(payload) !== encodeVerificationActionData(request)) {
      throw new Error('observe-hosted external Session payload differs from the canonical request.');
    }
    return Object.freeze({ kind: 'external-session' as const });
  }
  if (action !== CI_VERIFICATION_ACTION_DISPATCH_TYPE) {
    throw new Error('observe-hosted repository_dispatch action is not canonical.');
  }
  const envelope = parseCiVerificationActionProviderEnvelope(payload);
  const embeddedRequest = parseVerificationSessionHostedRequest(
    encodeVerificationActionData(envelope.proposal.sessionRequest)
  );
  if (encodeVerificationActionData(embeddedRequest)
    !== encodeVerificationActionData(request)) {
    throw new Error('observe-hosted internal Action Session request differs from the canonical request.');
  }
  return Object.freeze({ kind: 'internal-action' as const, envelope });
}

function assertGitHubIdentityRecord(input: unknown, expected: Readonly<{
  login: string;
  id: number;
  nodeId: string;
  type: string;
}>, label: string): void {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} identity is unavailable.`);
  }
  const record = input as Record<string, unknown>;
  if (record.login !== expected.login || record.id !== expected.id
    || record.node_id !== expected.nodeId || record.type !== expected.type) {
    throw new Error(`${label} does not match the canonical GitHub identity.`);
  }
}

export function assertHostedCompilerInternalProvenance(input: {
  repository: string;
  repositoryId: string;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  envelope: CiVerificationActionProviderEnvelope;
  parentPlanSource: string;
  parentArtifact: GitHubActionsArtifactObservation;
  parentArtifactInventory: readonly GitHubActionsArtifactObservation[];
  parentJobs: readonly GitHubWorkflowJobObservation[];
  currentRun: Readonly<Record<string, any>>;
  currentWorkflow: Readonly<Record<string, any>>;
  currentCheckSuite: Readonly<Record<string, any>>;
  eventSender: unknown;
  parentRun: Readonly<Record<string, any>>;
  parentPrincipal: Readonly<{ login: string; nodeId: string;
    permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none' }>;
}): Readonly<{
  parentPlan: CiVerificationActionParentDispatchPlan;
  parentActorNodeId: string;
}> {
  const { repository, repositoryId, request } = input;
  const envelope = parseCiVerificationActionProviderEnvelope(input.envelope);
  let planValue: unknown;
  try {
    planValue = JSON.parse(input.parentPlanSource) as unknown;
  } catch (error) {
    throw new Error('Internal Action parent dispatch plan artifact is not JSON.', { cause: error });
  }
  const parentPlan = parseCiVerificationActionParentDispatchPlan(planValue);
  const canonicalPlanSource = `${encodeVerificationActionData(parentPlan)}\n`;
  if (input.parentPlanSource !== canonicalPlanSource
    || ciVerificationActionParentDispatchPlanPayloadDigest(parentPlan)
      !== envelope.parentDispatchPlanPayloadDigest
    || `sha256:${createHash('sha256').update(Buffer.from(input.parentPlanSource, 'utf8')).digest('hex')}`
      !== envelope.parentDispatchPlanPayloadDigest) {
    throw new Error('Internal Action parent dispatch plan artifact bytes/digest are not canonical.');
  }
  assertCiVerificationActionProviderEnvelopeMember(envelope, parentPlan);
  if (parentPlan.repository !== repository || parentPlan.repositoryId !== repositoryId
    || parentPlan.parentWorkflowSha !== request.expectedBaseSha
    || envelope.parentWorkflowSha !== request.expectedBaseSha) {
    throw new Error('Internal Action parent plan repository/base identity differs from the Session request.');
  }
  for (const proposal of parentPlan.proposals) {
    const proposalRequest = parseVerificationSessionHostedRequest(
      encodeVerificationActionData(proposal.sessionRequest)
    );
    if (encodeVerificationActionData(proposalRequest) !== encodeVerificationActionData(request)) {
      throw new Error('Internal Action parent plan contains a proposal for another Session request.');
    }
  }

  const parentJobIds = new Set<string>();
  for (const job of input.parentJobs) {
    if (parentJobIds.has(job.id)) {
      throw new Error('Internal Action parent job inventory contains a duplicate job id.');
    }
    parentJobIds.add(job.id);
  }
  const parentJobs = input.parentJobs.filter((job) => job.id === parentPlan.parentJobId);
  if (parentJobs.length !== 1) {
    throw new Error('Internal Action parent plan-producing job is not unique in the provider inventory.');
  }
  const parentJob = parentJobs[0]!;
  const planSteps = parentJob.steps.filter((step) => step.name === parentPlan.parentPlanStepName);
  if (parentJob.runId !== parentPlan.parentRunId
    || parentJob.runAttempt !== parentPlan.parentRunAttempt
    || parentJob.name !== parentPlan.parentJobName
    || parentJob.headSha !== parentPlan.parentWorkflowSha
    || planSteps.length !== 1
    || planSteps[0]!.status !== 'completed'
    || planSteps[0]!.conclusion !== 'success') {
    throw new Error('Internal Action parent job/plan-producing step provenance mismatch.');
  }

  const bot = CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot;
  assertGitHubIdentityRecord(input.eventSender, bot, 'Internal Action event sender');
  assertGitHubIdentityRecord(input.currentRun.actor, bot, 'Internal Action current run actor');
  const currentRunId = String(input.currentRun.id ?? '');
  const currentRunAttempt = Number(input.currentRun.run_attempt);
  const checkSuiteId = Number(input.currentRun.check_suite_id);
  const workflowId = Number(input.currentRun.workflow_id);
  if (!/^[1-9][0-9]*$/u.test(currentRunId)
    || currentRunAttempt !== 1
    || !Number.isSafeInteger(checkSuiteId) || checkSuiteId < 1
    || !Number.isSafeInteger(workflowId) || workflowId < 1
    || !matchesCiCompilerWorkflowRunIdentity({
      workflowPath: input.currentRun.path,
      eventName: input.currentRun.event,
      displayTitle: input.currentRun.display_title,
      headSha: input.currentRun.head_sha,
      expectedDisplayTitle: `produce Action ${envelope.proposal.proposedActionKey}`,
      expectedHeadSha: request.expectedBaseSha
    })
    || input.currentRun.head_branch !== 'main'
    || String(input.currentRun.repository?.id ?? '') !== repositoryId
    || input.currentRun.repository?.full_name !== repository) {
    throw new Error('Internal Action current workflow run provenance mismatch.');
  }
  if (String(input.currentWorkflow.id ?? '') !== String(workflowId)
    || input.currentWorkflow.path !== '.github/workflows/compiler-pr-validation.yml'
    || input.currentWorkflow.state !== 'active') {
    throw new Error('Internal Action current workflow id/path readback mismatch.');
  }
  const suite = input.currentCheckSuite;
  const app = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  if (String(suite.id ?? '') !== String(checkSuiteId)
    || suite.head_sha !== request.expectedBaseSha
    || String(suite.repository?.id ?? '') !== repositoryId
    || suite.repository?.full_name !== repository
    || suite.app?.id !== app.id || suite.app?.node_id !== app.nodeId || suite.app?.slug !== app.slug) {
    throw new Error('Internal Action check-suite App/repository/head provenance mismatch.');
  }

  const artifact = input.parentArtifact;
  const exactArtifacts = input.parentArtifactInventory.filter((entry) => (
    entry.artifactName === envelope.parentDispatchPlanArtifactName
  ));
  if (exactArtifacts.length !== 1 || exactArtifacts[0]!.artifactId !== artifact.artifactId
    || artifact.artifactId !== envelope.parentDispatchPlanArtifactId
    || artifact.artifactName !== envelope.parentDispatchPlanArtifactName
    || artifact.archiveDigest === null
    || artifact.archiveDigest !== envelope.parentDispatchPlanArchiveDigest
    || artifact.runId !== envelope.parentRunId || artifact.runAttempt !== envelope.parentRunAttempt
    || artifact.workflowPath !== envelope.parentWorkflowPath
    || artifact.workflowRef !== `${envelope.parentWorkflowPath}@${envelope.parentWorkflowSha}`
    || artifact.workflowSha !== envelope.parentWorkflowSha || artifact.eventName !== 'repository_dispatch'
    || artifact.actorNodeId !== parentPlan.parentActor.nodeId
    || artifact.actorPermission !== parentPlan.parentActor.permission || artifact.expired) {
    throw new Error('Internal Action parent dispatch plan artifact provenance mismatch.');
  }
  const parentRun = input.parentRun;
  assertGitHubIdentityRecord(parentRun.actor, {
    login: parentPlan.parentActor.login,
    id: parentPlan.parentActor.id,
    nodeId: parentPlan.parentActor.nodeId,
    type: parentPlan.parentActor.type
  }, 'Internal Action parent run actor');
  const parentRequestTitle = `verify session PR #${request.prNumber} session ${request.expectedSessionRevision}`;
  if (String(parentRun.id ?? '') !== parentPlan.parentRunId
    || parentRun.run_attempt !== parentPlan.parentRunAttempt
    || !matchesCiCompilerWorkflowRunIdentity({
      workflowPath: parentRun.path,
      eventName: parentRun.event,
      displayTitle: parentRun.display_title,
      headSha: parentRun.head_sha,
      expectedDisplayTitle: parentRequestTitle,
      expectedHeadSha: parentPlan.parentWorkflowSha
    })
    || parentRun.path !== parentPlan.parentWorkflowPath
    || parentRun.head_branch !== 'main'
    || String(parentRun.repository?.id ?? '') !== repositoryId
    || parentRun.repository?.full_name !== repository) {
    throw new Error('Internal Action parent external Session run provenance mismatch.');
  }
  if (input.parentPrincipal.login !== parentPlan.parentActor.login
    || input.parentPrincipal.nodeId !== parentPlan.parentActor.nodeId
    || input.parentPrincipal.permission !== parentPlan.parentActor.permission) {
    throw new Error('Internal Action parent actor live membership differs from its dispatch plan.');
  }
  return Object.freeze({ parentPlan, parentActorNodeId: parentPlan.parentActor.nodeId });
}

function assertHostedCompilerIdentity(input: {
  ctx: VerificationSessionScope;
  github: VerificationSessionGitHubClient;
  repository: string;
  event: Record<string, any>;
  request: ReturnType<typeof parseVerificationSessionHostedRequest>;
  environment: Readonly<Record<string, string | undefined>>;
  repositoryRoot: string;
}): { actorNodeId: string; runId: string; runAttempt: number } {
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
    const actor = github.observePrincipal(repository, run.actor.login);
    if (actor.nodeId !== run.actor.node_id
      || (actor.permission !== 'admin' && actor.permission !== 'maintain')) {
      throw new Error('observe-hosted actor stable identity/live permission mismatch.');
    }
    return { actorNodeId: actor.nodeId, runId, runAttempt };
  }

  const envelope = dispatch.envelope;
  const parentArtifact = github.observeActionsArtifact(repository,
    envelope.parentDispatchPlanArtifactId);
  if (parentArtifact.artifactName !== envelope.parentDispatchPlanArtifactName
    || parentArtifact.archiveDigest !== envelope.parentDispatchPlanArchiveDigest
    || parentArtifact.runId !== envelope.parentRunId
    || parentArtifact.runAttempt !== envelope.parentRunAttempt || parentArtifact.expired) {
    throw new Error('observe-hosted internal parent artifact metadata differs from its provider envelope.');
  }
  const parentArtifactInventory = github.observeActionsArtifactsForRun(repository,
    envelope.parentRunId);
  const parentJobs = github.observeWorkflowJobsForAttempt(repository,
    envelope.parentRunId, envelope.parentRunAttempt);
  const parentPlanSource = github.downloadArtifactText(repository, parentArtifact,
    ciVerificationActionParentDispatchPlanFile());
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
  const parentPrincipal = github.observePrincipal(repository, parentPlan.parentActor.login);
  const internal = assertHostedCompilerInternalProvenance({ repository, repositoryId, request,
    envelope, parentPlanSource, parentArtifact, parentArtifactInventory, parentJobs, currentRun: run,
    currentWorkflow, currentCheckSuite, eventSender: event.sender, parentRun, parentPrincipal });
  return { actorNodeId: internal.parentActorNodeId, runId, runAttempt };
}

function evaluateFreshHostedIntegration(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  hosted: ReturnType<typeof loadHostedArtifactForMergeWorkflow>;
  candidate: GitHubCandidateObservation;
  provenance: HostedWorkflowCommentProvenance;
  observedAt: string;
}): Readonly<{
  result: ReturnType<typeof CodexDevelopmentEvaluateMergeGate>;
  changedPaths: readonly string[];
  issueDispositionPlan: IssueDispositionPlan;
}> {
  const { github, repository, hosted, candidate, provenance, observedAt } = input;
  const artifact = hosted.artifact;
  const artifactReuse = classifyVerificationSessionArtifactReuse(artifact, observedAt);
  if (!artifactReuse.actionEvidenceCandidate || artifact.evidence.status !== 'passed') {
    throw new Error(`Hosted integration requires reusable passed Action Evidence: ${artifactReuse.reason}`);
  }
  if (candidate.state !== 'OPEN' || candidate.baseSha !== artifact.session.baseSha
    || candidate.baseTreeSha !== artifact.session.baseTreeSha
    || candidate.headSha !== artifact.session.headSha
    || candidate.headTreeSha !== artifact.session.headTreeSha
    || candidate.isDraft || candidate.isCrossRepository) {
    throw new Error('Hosted integration OPEN candidate identity drifted.');
  }
  const manifestSource = github.readBlobText(repository, candidate.headSha, artifact.session.manifestPath);
  if (CodexDevelopmentWorkPackageManifestDigest(manifestSource) !== artifact.session.manifestDigest) {
    throw new Error('Hosted integration Issue disposition manifest bytes drifted.');
  }
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(
    manifestSource,
    artifact.session.manifestPath
  );
  const issueDispositionPlan = observeExactIssueDispositionPlan({
    github,
    repository,
    candidate,
    manifestPath: artifact.session.manifestPath,
    manifestDigest: artifact.session.manifestDigest,
    tracking: manifest.tracking
  });
  const integrationPrincipalNodeId = provenance.actorNodeId;
  const barrier = github.observeReviewBarrier({ repository, prNumber: artifact.session.prNumber,
    headSha: artifact.session.headSha,
    excludedPrincipalNodeIds: new Set([candidate.authorNodeId, integrationPrincipalNodeId]) });
  if (barrier.status !== 'clear') {
    throw new Error(`Hosted integration Review barrier ${barrier.status}: ${
      barrier.status === 'provider-schema-unsupported' ? barrier.reasonCode : barrier.reason}`);
  }
  const operationId = `sha256:${createHash('sha256').update(
    `${artifact.session.sessionRevision}:pre-merge-review`
  ).digest('hex')}` as const;
  const preMergeReview = createVerificationSessionReviewReceipt({ stage: 'pre-merge',
    session: artifact.session, scope: artifact.scopeAuthorization, barrier,
    candidateAuthorNodeId: candidate.authorNodeId, integrationPrincipalNodeId,
    expiresAt: addSeconds(barrier.observedAt, 300), operationId });
  const changedPaths = github.observeChangedPaths({ repository,
    prNumber: artifact.session.prNumber, state: 'OPEN', draft: false,
    baseSha: artifact.session.baseSha, headSha: artifact.session.headSha }).paths;
  const comparison = github.observeComparison(repository, candidate.baseSha, candidate.headSha);
  const headOpenPullRequestCount = github.observeOpenPullRequestCountForHead(repository, candidate.headSha);
  if (headOpenPullRequestCount !== 1 || comparison.behindBy !== 0
    || (comparison.status !== 'ahead' && comparison.status !== 'identical')) {
    throw new Error('Hosted integration candidate ancestry or same-head PR identity is not mergeable.');
  }
  const issuedAt = barrier.observedAt;
  const workflowRef = `.github/workflows/sec-merge-gate.yml@${artifact.session.baseSha}`;
  const freshMainHealth = createMainHealthLedger(createObservedMainHealthInput({
    repository, mainSha: candidate.baseSha, mainTreeSha: candidate.baseTreeSha,
    trustRevision: artifact.session.trustRevision, observedAt: issuedAt,
    expiresAt: addSeconds(issuedAt, 300), sourceRunId: provenance.runId,
    sourceRef: workflowRef, checks: github.observeChecks(repository, candidate.baseSha) }));
  const consumptionOperationId = createVerificationSessionMergeOperationId({
    sessionRevision: artifact.session.sessionRevision, headSha: artifact.session.headSha,
    actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest });
  const mergeInput = prepareVerificationSessionMergeInput({ artifact, preMergeReview,
    hostedArtifactOrigin: hosted.origin, hostedArtifactTransport: hosted.transport,
    candidate: { repository, prNumber: artifact.session.prNumber, draft: false,
      headOpenPullRequestCount: 1, currentBaseSha: candidate.baseSha,
      currentBaseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha,
      headTreeSha: candidate.headTreeSha, baseIsAncestor: true, behindBy: 0,
      manifestPath: artifact.session.manifestPath, manifestDigest: artifact.session.manifestDigest,
      changedPaths },
    provenance: { workflowPath: '.github/workflows/sec-merge-gate.yml', workflowRef,
      workflowSha: artifact.session.baseSha, eventName: 'workflow_run',
      sourceRunId: provenance.runId, sourceRunAttempt: provenance.runAttempt,
      actorNodeId: integrationPrincipalNodeId, actorPermission: provenance.actorPermission },
    mainHealth: freshMainHealth, platform: github.observePlatformEnforcement(repository),
    consumptionOperationId, issuedAt, expiresAt: addSeconds(issuedAt, 300) });
  return Object.freeze({ result: CodexDevelopmentEvaluateMergeGate(mergeInput),
    changedPaths: Object.freeze([...changedPaths]), issueDispositionPlan });
}

type HostedIntegrationAuthorizationPublicationResult = Readonly<{
  publication: IntegrationAuthorizationOperationPublication | null;
  commentId: number | null;
  status: 'published' | 'reused' | 'failed';
  /** True only after this invocation receives created bytes and exact provider readback. */
  createdByThisInvocation: boolean;
  detail: string;
}>;

function readBackHostedIntegrationAuthorizationComment(
  ctx: VerificationSessionScope,
  publication: IntegrationAuthorizationOperationPublication,
  commentId: number
): IntegrationAuthorizationOperationPublication {
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
  assertHostedCommentProvenanceLive(
    ctx.repositoryRoot,
    publication.repository,
    comment,
    parsed.provenance
  );
  return parsed;
}

function publishHostedIntegrationAuthorizationOperation(
  ctx: VerificationSessionScope,
  publicationInput: IntegrationAuthorizationOperationPublication
): HostedIntegrationAuthorizationPublicationResult {
  const publication = parseIntegrationAuthorizationOperationPublication(publicationInput);
  let inventory: readonly Readonly<{
    commentId: number;
    publication: IntegrationAuthorizationOperationPublication;
  }>[];
  try {
    inventory = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
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
      const readback = readBackHostedIntegrationAuthorizationComment(
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
  assertUnavailableProviderCircuitBreakerInvariant({
    ctx,
    capability: 'github-writer',
    now: new Date().toISOString()
  });
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
    const readback = readBackHostedIntegrationAuthorizationComment(ctx, publication, created.id);
    const complete = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
      repository: publication.repository,
      pullRequestNumber: publication.pullRequestNumber,
      sessionRevision: publication.sessionRevision
    }).filter(({ publication: observed }) => (
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

function ensureHostedReviewLocator(
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
): Readonly<{
  status: 'published' | 'reused';
  commentId: string;
  publicationDigest: `sha256:${string}`;
}> {
  const observed = github.observeHostedReviewLocator(input);
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
  assertUnavailableProviderCircuitBreakerInvariant({
    ctx,
    capability: 'github-writer',
    now: new Date().toISOString()
  });
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
  const complete = github.observeHostedReviewLocator(input);
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

function ensureMaintainerReviewWakeup(
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
): Readonly<{
  status: 'published' | 'reused';
  commentId: string;
  wakeupDigest: `sha256:${string}`;
}> {
  const observed = github.observeMaintainerReviewWakeup(input);
  if (observed.status === 'reused') {
    if (observed.commentId === null) throw new Error('Maintainer Review wake-up reuse has no comment identity.');
    return Object.freeze({ status: 'reused' as const, commentId: observed.commentId,
      wakeupDigest: observed.wakeupDigest });
  }
  assertUnavailableProviderCircuitBreakerInvariant({
    ctx,
    capability: 'codex-review',
    now: new Date().toISOString()
  });
  assertUnavailableProviderCircuitBreakerInvariant({
    ctx,
    capability: 'github-writer',
    now: new Date().toISOString()
  });
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
  const complete = github.observeMaintainerReviewWakeup(input);
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

export interface HostedSynchronousSquashMergeResponse {
  readonly merged: true;
  readonly sha: string;
  readonly message: string;
}

export function parseHostedSynchronousSquashMergeResponse(
  source: string
): HostedSynchronousSquashMergeResponse {
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

function executeHostedSquashMerge(input: {
  ctx: VerificationSessionScope;
  repository: string;
  prNumber: number;
  headSha: string;
  sessionRevision: `sha256:${string}`;
  publication: IntegrationAuthorizationOperationPublication;
  commentId: number;
  issueDispositionPlan: IssueDispositionPlan;
}): HostedSynchronousSquashMergeResponse {
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

const USAGE = `Usage:
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts project --default-ref <ref> [--open-prs true] [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts prepare --pr <n> --request-output <request.json> [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts observe-hosted --request <request.json> --output <facts.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts prepare-hosted --request <request.json> --facts <facts.json> --output <envelope.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts artifact-status --artifact <artifact.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts finalize-hosted --envelope <envelope.json> (--evidence <evidence.json> | --previous-artifact <artifact.json>) --output <artifact.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts prepare-integration-hosted --repository <owner/name> --output <projection.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts integrate-hosted --repository <owner/name> --output <projection.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts local-main-closeout --repository <owner/name> --pr <n> --protected-root <path> --expected-local-head <sha> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts closeout-mutate-hosted --repository <owner/name> --output <projection.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts closeout-publish-hosted --repository <owner/name> --output <projection.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts resume --request <request.json> [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts freeze --artifact <artifact.json> --session-output <session.json> --scope-output <scope.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts status --request <request.json> [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts status-offline --session-file <session.json> [--json]
`;

const COMMAND_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  project: new Set(['--default-ref', '--open-prs', '--repository']),
  prepare: new Set(['--pr', '--request-output', '--repository']),
  'observe-hosted': new Set(['--request', '--output', '--repository']),
  'prepare-hosted': new Set(['--request', '--facts', '--output']),
  'artifact-status': new Set(['--artifact']),
  'finalize-hosted': new Set(['--envelope', '--evidence', '--previous-artifact', '--output']),
  'prepare-integration-hosted': new Set(['--output', '--repository']),
  'integrate-hosted': new Set(['--output', '--repository']),
  'local-main-closeout': new Set(['--repository', '--pr', '--protected-root', '--expected-local-head']),
  'closeout-mutate-hosted': new Set(['--output', '--repository']),
  'closeout-publish-hosted': new Set(['--output', '--repository']),
  resume: new Set(['--request', '--repository']),
  freeze: new Set(['--artifact', '--session-output', '--scope-output']),
  status: new Set(['--request', '--repository']),
  'status-offline': new Set(['--session-file'])
});

export async function verificationSessionCli(argv: string[]): Promise<string> {
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
  const repository = args.get('--repository') ?? 'sec-platform/sec';
  const repositoryRoot = process.cwd();
  const environment = process.env;
  const now = () => new Date().toISOString();
  let ctx = createVerificationSessionScope({ repositoryRoot });
  if (new Set([
    'prepare-integration-hosted',
    'integrate-hosted',
    'closeout-mutate-hosted',
    'closeout-publish-hosted'
  ]).has(command)) {
    ctx = await createBranchLifecycleVerificationScope(repositoryRoot);
  }
  let runtimeJournalFs: VerificationSessionJournalFileSystem | null = null;
  if (new Set(['prepare', 'resume', 'status', 'status-offline', 'integrate-hosted']).has(command)) {
    runtimeJournalFs = await openRuntimeJournalFileSystem(repositoryRoot, environment);
  }
  const durableJournalFs = (): VerificationSessionJournalFileSystem => {
    if (runtimeJournalFs === null) {
      throw new Error(`${command} did not acquire the canonical Runtime State journal authority.`);
    }
    return runtimeJournalFs;
  };
  const githubAdapter = () => createVerificationSessionGitHubClient(repositoryRoot);
  const event = () => githubEvent(environment);
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'local-main-closeout') {
    const prNumber = Number(required(args, '--pr'));
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr must be a positive integer.');
    const liveCandidate = githubAdapter().observeCandidate(repository, prNumber);
    if (liveCandidate.state !== 'MERGED' || liveCandidate.mergeCommitMessage === null) {
      throw new Error('local-main closeout requires one live merged PR readback.');
    }
    const sessionRevision = exactCommitMarker(liveCandidate.mergeCommitMessage, 'Verification-Session');
    if (!/^sha256:[0-9a-f]{64}$/u.test(sessionRevision)) {
      throw new Error('merged commit Verification-Session marker is not an exact digest.');
    }
    const publications = observeIntegrationAuthorizationOperationPublications(repositoryRoot, {
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
    const result = await withWorkspaceWriteLease(protectedRoot, undefined, async (lease) => (
      executeLocalMainCloseout(
        protectedRoot,
        binding,
        gitRunner,
        lease
      )
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
    const candidate = github.observeCandidate(repository, prNumber);
    if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
      throw new Error('prepare requires one open same-repository non-draft PR.');
    }
    const proof = inspectTrustedRuntime({ repositoryRoot });
    assertTrustedMainRuntime(proof, candidate.baseSha);
    const manifestPath = CodexDevelopmentParseWorkPackageLocator(candidate.body);
    const manifestSource = github.readBlobText(repository, candidate.headSha, manifestPath);
    const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestSource) as `sha256:${string}`;
    const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource);
    if (manifest.schema !== 'codex-development-work-package-v1') {
      throw new Error('prepare currently requires the canonical V1 Work Package requiredProfile field.');
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
    const dependencyBlobs = observeVerificationSessionActionDependencyBlobs({ github, repository,
      baseSha: candidate.baseSha, headSha: candidate.headSha });
    const principal = github.observeViewerPrincipal(repository);
    if (principal.permission !== 'admin' && principal.permission !== 'maintain') {
      throw new Error('prepare viewer lacks maintain/admin permission.');
    }
    const barrier = github.observeReviewBarrier({ repository, prNumber, headSha: candidate.headSha,
      excludedPrincipalNodeIds: new Set([candidate.authorNodeId, principal.nodeId]) });
    const observedAt = now();
    const prepared = prepareTrustedMainVerificationSession({ repository, candidate, manifestPath, manifestDigest,
      changedPaths, testImpactTransition: changedSelection.testImpactTransition,
      testImpactSourceProvider: changedSelection.testImpactSourceProvider,
      profile: manifest.requiredProfile, integrationPrincipalNodeId: principal.nodeId,
      producerPrincipalNodeId: principal.nodeId, sourceRunId: environment.GITHUB_RUN_ID ?? `local-${process.pid}`,
      sourceRef: `refs/heads/main@${candidate.baseSha}`, observedAt, reviewBarrier: barrier,
      mainHealthChecks: github.observeChecks(repository, candidate.baseSha), dependencyBlobs });
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
    let hosted = selectTrustedHostedSessionArtifact({ github, repository,
      transports: github.observeActionsArtifacts(repository), request: prepared.request });
    const localExecutionEnvironment = createCiVerificationLocalExecutionEnvironment({
      os: process.platform,
      arch: process.arch,
      bunVersion: Bun.version
    });
    const localVerification = hosted === null && reviewBarrierAllowsExecution
      ? await executePreparedLocalQuickDag({
          ctx,
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
        })
      : null;
    if (hosted === null && localVerification?.result.status === 'passed') {
      // The local DAG may run long enough for another coordinator to publish.
      // Re-read provider state before deciding whether a wake-up is necessary.
      hosted = selectTrustedHostedSessionArtifact({ github, repository,
        transports: github.observeActionsArtifacts(repository), request: prepared.request });
    }
    let effectReviewBarrier: ReturnType<VerificationSessionGitHubClient['observeReviewBarrier']> =
      prepared.reviewBarrier;
    if (localVerification?.result.status === 'passed') {
      const effectCandidate = github.observeCandidate(repository, prNumber);
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
      effectReviewBarrier = github.observeReviewBarrier({
        repository,
        prNumber,
        headSha: effectCandidate.headSha,
        excludedPrincipalNodeIds: new Set([effectCandidate.authorNodeId, principal.nodeId])
      });
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
      ? ensureMaintainerReviewWakeup(ctx, github, {
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
        })
      : null;
    const runJoin = github.observeVerificationSessionWorkflowJoin({ repository, prNumber,
      sessionRevision: prepared.sessionRevision,
      actionPlanDigest: prepared.request.expectedActionPlanDigest,
      baseSha: prepared.request.expectedBaseSha,
      now: now() });
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
      assertUnavailableProviderCircuitBreakerInvariant({
        ctx,
        capability: 'github-actions-hosted-verification',
        now: now()
      });
      github.ensureVerificationSessionWakeup(repository, prepared.request);
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
      readFileSync(path.resolve(required(args, '--artifact')), 'utf8')
    );
    writeDurable(required(args, '--session-output'), artifact.session);
    writeDurable(required(args, '--scope-output'), artifact.scopeAuthorization);
    return JSON.stringify({ status: 'frozen', sessionRevision: artifact.session.sessionRevision,
      sessionOutput: path.resolve(required(args, '--session-output')),
      scopeOutput: path.resolve(required(args, '--scope-output')) }, null, 2);
  }
  if (command === 'status-offline') {
    const session = parseVerificationSession(readFileSync(path.resolve(required(args, '--session-file')), 'utf8'));
    const journal = readVerificationSessionJournal({
      sessionRevision: session.sessionRevision,
      fs: durableJournalFs()
    });
    return JSON.stringify({ mode: 'offline-projection', session, journal }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'status') {
    const request = parseVerificationSessionHostedRequest(
      readFileSync(path.resolve(required(args, '--request')), 'utf8')
    );
    const github = githubAdapter();
    const candidate = github.observeCandidate(repository, request.prNumber);
    const publications = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, { repository,
      pullRequestNumber: request.prNumber, sessionRevision: request.expectedSessionRevision });
    const durable = observeDurableVerificationSessionProjection({ ctx, github, repository, request,
      candidate, publications });
    if (durable !== null) return JSON.stringify(durable, null, 2);
    const hosted = selectTrustedHostedSessionArtifact({ github, repository,
      transports: github.observeActionsArtifacts(repository), request });
    if (hosted === null) {
      const workflowJoin = github.observeVerificationSessionWorkflowJoin({ repository,
        prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        actionPlanDigest: request.expectedActionPlanDigest, baseSha: request.expectedBaseSha });
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
  if (command === 'observe-hosted') {
    const request = parseVerificationSessionHostedRequest(readFileSync(path.resolve(required(args, '--request')), 'utf8'));
    const github = githubAdapter();
    const eventPayload = event();
    const compilerIdentity = assertHostedCompilerIdentity({ ctx, github, repository,
      event: eventPayload, request, environment, repositoryRoot });
    const candidate = github.observeCandidate(repository, request.prNumber);
    const candidateChecks: readonly [unknown, unknown, string][] = [
      [candidate.baseSha, request.expectedBaseSha, 'base'], [candidate.baseTreeSha, request.expectedBaseTreeSha, 'base tree'],
      [candidate.headSha, request.expectedHeadSha, 'head'], [candidate.headTreeSha, request.expectedHeadTreeSha, 'head tree']
    ];
    for (const [actual, expected, label] of candidateChecks) if (actual !== expected) throw new Error(`observe-hosted ${label} drifted.`);
    if (CodexDevelopmentParseWorkPackageLocator(candidate.body) !== request.manifestPath) throw new Error('observe-hosted manifest locator drifted.');
    const manifestSource = github.readBlobText(repository, request.expectedHeadSha, request.manifestPath);
    if (CodexDevelopmentWorkPackageManifestDigest(manifestSource) !== request.manifestDigest) throw new Error('observe-hosted manifest digest drifted.');
    const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource);
    const changedSelection = await observeVerificationSessionChangedSelection({
      repositoryRoot,
      repository,
      prNumber: request.prNumber,
      candidate,
      github
    });
    const changedPaths = changedSelection.changedPaths;
    CodexDevelopmentAssertWorkPackageOwnership(manifest, [...changedPaths]);
    const dependencyBlobs = observeVerificationSessionActionDependencyBlobs({ github, repository,
      baseSha: request.expectedBaseSha, headSha: request.expectedHeadSha });
    const reviewBarrier = github.observeReviewBarrier({ repository, prNumber: request.prNumber,
      headSha: request.expectedHeadSha,
      excludedPrincipalNodeIds: new Set([candidate.authorNodeId, compilerIdentity.actorNodeId]) });
    if (reviewBarrier.status === 'provider-schema-unsupported') {
      return JSON.stringify({ status: 'BLOCKED', sessionRevision: request.expectedSessionRevision,
        reviewProvider: reviewBarrier, output: null }, null, 2);
    }
    if (reviewBarrier.status === 'blocked') {
      throw new Error(`observe-hosted Review barrier blocked: ${reviewBarrier.reason}`);
    }
    if (reviewBarrier.status === 'waiting') {
      const operationId = createVerificationSessionOperationId({
        sessionRevision: request.expectedSessionRevision,
        operationKind: 'request-review', semanticInputDigest: request.requestOperationId
      });
      // The hosted writer publishes only a non-triggering locator. It is an
      // audit projection, not a Codex activation or Review authority.
      const reviewLocator = ensureHostedReviewLocator(ctx, github, { repository,
        prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        operationId, headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
        sourceRunId: compilerIdentity.runId, sourceRunAttempt: compilerIdentity.runAttempt,
        workflowRef: `.github/workflows/compiler-pr-validation.yml@${request.expectedBaseSha}` });
      const providerEpoch = loadVerificationProviderCapabilityLedger(ctx.repositoryRoot);
      const providerEpochNow = now();
      const reviewer = resolveProviderAvailability(providerEpoch, 'codex-review');
      const reviewProviderUnavailable = providerEpochNow >= providerEpoch.observedAt
        && providerEpochNow < providerEpoch.expiresAt
        && reviewer.availability === 'unavailable';
      if (reviewProviderUnavailable) {
        try {
          assertProviderRetryGuard({ previous: { availability: reviewer.availability,
            epochId: providerEpoch.epochId }, requested: { capability: 'codex-review',
            epochId: providerEpoch.epochId } });
        } catch (error) {
          if (!(error instanceof CompilerError) || error.code !== 'PROVIDER-UNAVAILABLE-NOT-RETRIED') {
            throw error;
          }
          // Expected fail-closed guard: the projection below records the typed
          // unavailable state without invoking or re-requesting the provider.
        }
        // A negative circuit breaker blocks a same-epoch retry. The hosted
        // principal never emits @codex; only authenticated local prepare may
        // have published the maintainer wake-up after local quick PASS.
        return JSON.stringify({ status: 'WAITING_REVIEW', sessionRevision: request.expectedSessionRevision,
          reviewProvider: { status: 'review-provider-unavailable', capability: 'codex-review',
            reasonCode: reviewer.reasonCode, availabilityEpochId: providerEpoch.epochId,
            availabilityEpochDigest: providerEpoch.epochDigest,
            receiptRef: reviewer.receiptRef },
          reviewLocator: reviewLocator.status, reviewLocatorCommentId: reviewLocator.commentId,
          reviewLocatorPublicationDigest: reviewLocator.publicationDigest, output: null }, null, 2);
      }
      return JSON.stringify({ status: 'WAITING_REVIEW', sessionRevision: request.expectedSessionRevision,
        reviewLocator: reviewLocator.status, reviewLocatorCommentId: reviewLocator.commentId,
        reviewLocatorPublicationDigest: reviewLocator.publicationDigest, output: null }, null, 2);
    }
    if (reviewBarrier.status !== 'clear') throw new Error('observe-hosted Review barrier did not narrow to clear.');
    const observedAt = now();
    const observedFacts = reconstructVerificationSessionHostedFacts({
      request, repository, candidate, changedPaths,
      testImpactTransition: changedSelection.testImpactTransition,
      testImpactSourceProvider: changedSelection.testImpactSourceProvider,
      integrationPrincipalNodeId: compilerIdentity.actorNodeId,
      producerPrincipalNodeId: compilerIdentity.actorNodeId, sourceRunId: compilerIdentity.runId,
      sourceRef: `.github/workflows/compiler-pr-validation.yml@${request.expectedBaseSha}`, observedAt, reviewBarrier,
      mainHealthChecks: github.observeChecks(repository, request.expectedBaseSha), dependencyBlobs });
    // Facts are diagnostic/reconstruction input only. A Review receipt is
    // minted later by prepare-hosted from its own fresh private observation.
    writeDurable(required(args, '--output'), observedFacts);
    return JSON.stringify({ status: 'observed', output: path.resolve(required(args, '--output')) }, null, 2);
  }
  if (command === 'prepare-hosted') {
    const request = parseVerificationSessionHostedRequest(readFileSync(path.resolve(required(args, '--request')), 'utf8'));
    const facts = readJson<VerificationSessionHostedFacts>(required(args, '--facts'));
    const github = githubAdapter();
    const candidate = github.observeCandidate(facts.repository, request.prNumber);
    const reviewBarrier = github.observeReviewBarrier({ repository: facts.repository, prNumber: request.prNumber,
      headSha: request.expectedHeadSha,
      excludedPrincipalNodeIds: new Set([candidate.authorNodeId, facts.integrationPrincipalNodeId]) });
    if (reviewBarrier.status !== 'clear') {
      throw new Error(`prepare-hosted fresh Review barrier is ${reviewBarrier.status}.`);
    }
    const envelope = prepareVerificationSessionHosted({ request,
      facts: Object.freeze({ ...facts, candidate, reviewBarrier }), now: now() });
    writeDurable(required(args, '--output'), envelope);
    return JSON.stringify({ status: 'prepared', envelopeDigest: envelope.envelopeDigest, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  if (command === 'artifact-status') {
    const artifact = CodexDevelopmentParseVerificationSessionArtifact(
      readFileSync(path.resolve(required(args, '--artifact')), 'utf8')
    );
    return JSON.stringify(classifyVerificationSessionArtifactReuse(artifact, now()), null, 2);
  }
  if (command === 'finalize-hosted') {
    const evidencePath = args.get('--evidence');
    const previousArtifactPath = args.get('--previous-artifact');
    if ((evidencePath === undefined) === (previousArtifactPath === undefined)) {
      throw new Error('finalize-hosted requires exactly one of --evidence or --previous-artifact.');
    }
    const envelope = readJson<VerificationSessionHostedEnvelope>(required(args, '--envelope'));
    const artifact = evidencePath !== undefined
      ? finalizeVerificationSessionHostedArtifact({ envelope,
          evidence: readJson<Parameters<typeof finalizeVerificationSessionHostedArtifact>[0]['evidence']>(evidencePath) })
      : (() => {
          const previousArtifact = CodexDevelopmentParseVerificationSessionArtifact(
            readFileSync(path.resolve(previousArtifactPath!), 'utf8')
          );
          const eventPayload = event();
          const github = githubAdapter();
          const actor = github.observePrincipal(envelope.session.repository, hostedActorHandle(eventPayload));
          if (actor.permission !== 'admin' && actor.permission !== 'maintain') {
            throw new Error('trusted artifact refresh actor lacks maintain/admin permission.');
          }
          const runId = environment.GITHUB_RUN_ID ?? '';
          if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('GITHUB_RUN_ID is required for trusted artifact refresh.');
          const producer = CodexDevelopmentCreateVerificationEvidenceProducer({
            sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
            workflowRef: `.github/workflows/compiler-pr-validation.yml@${envelope.session.baseSha}`,
            workflowSha: envelope.session.baseSha, runId,
            runAttempt: positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT', environment), actorNodeId: actor.nodeId
          });
          return refreshVerificationSessionHostedArtifact({ envelope, previousArtifact, producer,
            refreshedAt: now() });
        })();
    writeCanonicalDurable(required(args, '--output'), artifact);
    return JSON.stringify({ status: 'finalized', artifactDigest: artifact.artifactDigest, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'resume') {
    const request = parseVerificationSessionHostedRequest(
      readFileSync(path.resolve(required(args, '--request')), 'utf8')
    );
    const github = githubAdapter();
    const candidate = github.observeCandidate(repository, request.prNumber);
    const authorizationPublications = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
      repository, pullRequestNumber: request.prNumber,
      sessionRevision: request.expectedSessionRevision
    });
    const durable = observeDurableVerificationSessionProjection({ ctx, github, repository, request,
      candidate, publications: authorizationPublications });
    if (durable !== null) return JSON.stringify(durable, null, 2);
    const allArtifacts = github.observeActionsArtifacts(repository);
    const hosted = selectTrustedHostedSessionArtifact({ github, repository,
      transports: allArtifacts, request });
    const runJoin = github.observeVerificationSessionWorkflowJoin({ repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      actionPlanDigest: request.expectedActionPlanDigest, baseSha: request.expectedBaseSha });
    if (hosted === null) {
      const redispatched = runJoin.status === 'redispatch-eligible';
      if (redispatched) {
        assertUnavailableProviderCircuitBreakerInvariant({
          ctx,
          capability: 'github-actions-hosted-verification',
          now: now()
        });
        github.ensureVerificationSessionWakeup(repository, request);
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
        assertUnavailableProviderCircuitBreakerInvariant({
          ctx,
          capability: 'github-actions-hosted-verification',
          now: now()
        });
        github.ensureVerificationSessionWakeup(repository, request);
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
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'prepare-integration-hosted') {
    const github = githubAdapter();
    const eventPayload = event();
    const hosted = loadHostedArtifactForMergeWorkflow(github, repository, eventPayload);
    const artifact = hosted.artifact;
    if (artifact.session.repository !== repository) {
      throw new Error('prepare-integration-hosted repository differs from the authenticated Session artifact.');
    }
    const candidate = github.observeCandidate(repository, artifact.session.prNumber);
    const outputPath = required(args, '--output');
    const candidateRoute = routeHostedIntegration({ repository, session: artifact.session,
      candidate, priorEffectStarted: false, authorizationPublicationCount: 0 });
    if (candidateRoute.lane === 'blocked') {
      const projection = Object.freeze({ ...candidateRoute,
        effects: planHostedIntegrationEffects(candidateRoute), observedAt: now() });
      appendTrustedGitHubOutput(environment, 'integration-lane', candidateRoute.lane);
      writeDurable(outputPath, projection);
      return JSON.stringify({ ...projection, output: path.resolve(outputPath) }, null, 2);
    }
    const identity = assertHostedIntegrationIdentity({ ctx, github, repository, event: eventPayload,
      session: artifact.session, candidate, phase: 'recoveryPreparation', environment, repositoryRoot });
    const publications = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, { repository,
      pullRequestNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision });
    const route = routeHostedIntegration({ repository, session: artifact.session, candidate,
      priorEffectStarted: identity.phase.priorEffectStarted,
      authorizationPublicationCount: publications.length });
    const effects = planHostedIntegrationEffects(route);
    appendTrustedGitHubOutput(environment, 'integration-lane', route.lane);
    if (route.lane === 'blocked') {
      const projection = Object.freeze({ ...route, effects, observedAt: now() });
      writeDurable(outputPath, projection);
      return JSON.stringify({ ...projection, output: path.resolve(outputPath) }, null, 2);
    }
    if (route.lane === 'merged-recovery') {
      const original = loadMarkerBoundMergedAuthorizationRecovery({ ctx, github, repository,
        session: artifact.session, candidate, publications });
      const projection = Object.freeze({ ...route, effects,
        authorizationPublicationId: original.selected.publication.authorizationPublicationId,
        authorizationCommentId: original.selected.commentId,
        authorizationReceiptDigest: original.selected.publication.authorizationReceiptDigest,
        recoveryArtifact: Object.freeze({ artifactId: original.recovery.metadata.artifactId,
          artifactName: original.recovery.metadata.artifactName,
          artifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
          artifactDigest: original.recovery.artifact.artifactDigest,
          runId: original.recovery.metadata.runId,
          runAttempt: original.recovery.metadata.runAttempt }),
        observedAt: now() });
      writeDurable(outputPath, projection);
      return JSON.stringify({ ...projection, output: path.resolve(outputPath) }, null, 2);
    }
    if (!effects.prepareRecoveryArtifact) {
      throw new Error('OPEN hosted integration route did not authorize recovery preparation.');
    }
    const preflight = evaluateFreshHostedIntegration({ github, repository, hosted, candidate,
      provenance: identity.provenance, observedAt: now() });
    writeDurable(
      hostedIntegrationPreflightResultPath(ctx.repositoryRoot),
      preflight.result
    );
    const prepared = prepareMergedPullRequestCloseout(ctx, { number: artifact.session.prNumber,
      headBranch: candidate.headBranch, headSha: artifact.session.headSha });
    const recovery = materializeBranchCloseoutRecoveryArtifact({ outputPath, repository,
      session: artifact.session, prepared, runId: identity.provenance.runId,
      runAttempt: identity.provenance.runAttempt, environment });
    const projection = Object.freeze({ ...route, effects,
      preflightResultDigest: preflight.result.resultDigest,
      recoveryArtifact: Object.freeze({ artifactName: recovery.artifactName,
        artifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
        artifactFilePath: recovery.artifactFilePath,
        artifactDigest: recovery.artifact.artifactDigest }), observedAt: now() });
    writeDurable(outputPath, projection);
    return JSON.stringify({ ...projection, output: path.resolve(outputPath) }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'integrate-hosted') {
    const github = githubAdapter();
    const eventPayload = event();
    const hosted = loadHostedArtifactForMergeWorkflow(github, repository, eventPayload);
    const artifact = hosted.artifact;
    if (artifact.session.repository !== repository) {
      throw new Error('integrate-hosted repository differs from the authenticated Session artifact.');
    }
    let candidate = github.observeCandidate(repository, artifact.session.prNumber);
    let boundPostMergeMainSha: string | null = null;
    if (candidate.state === 'MERGED') {
      const synchronized = synchronizeTrustedRemoteDefaultRef({ ctx });
      boundPostMergeMainSha = assertBoundPostMergeMain({ ctx, repository,
        session: artifact.session, candidate, lane: 'merged-recovery',
        liveMainSha: synchronized.defaultSha, environment });
    }
    const hostedIdentity = assertHostedIntegrationIdentity({ ctx, github, repository,
      event: eventPayload, session: artifact.session, candidate, phase: 'closeoutMutation',
      environment, repositoryRoot });
    const hostedProvenance = hostedIdentity.provenance;
    const integrationNow = now();
    const expectedConsumptionOperationId = createVerificationSessionMergeOperationId({
      sessionRevision: artifact.session.sessionRevision, headSha: artifact.session.headSha,
      actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest });
    const remoteAttempts = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, { repository,
      pullRequestNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision });
    const route = routeHostedIntegration({ repository, session: artifact.session, candidate,
      priorEffectStarted: hostedIdentity.phase.priorEffectStarted,
      authorizationPublicationCount: remoteAttempts.length });
    const effects = planHostedIntegrationEffects(route);
    if (route.lane === 'blocked') {
      throw new Error(`AMBIGUOUS_SIDE_EFFECT: hosted integration route is blocked: ${route.reason}`);
    }

    let selected: Readonly<{ commentId: number;
      publication: IntegrationAuthorizationOperationPublication }>;
    let selectedRecovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
    let originalHostPrepared: PreparedBranchCloseoutEnvelope | null = null;
    let ownsUnambiguousMergeStart = false;
    let issueDispositionPlan: IssueDispositionPlan | null = null;

    if (route.lane === 'merged-recovery') {
      const original = loadMarkerBoundMergedAuthorizationRecovery({ ctx, github, repository,
        session: artifact.session, candidate, publications: remoteAttempts });
      selected = original.selected;
      selectedRecovery = original.recovery;
    } else {
      if (!effects.createAuthorizationPublication || !effects.executePhysicalMerge) {
        throw new Error('OPEN hosted integration route did not authorize first-effect execution.');
      }
      if (candidate.state !== 'OPEN' || candidate.baseSha !== artifact.session.baseSha
        || candidate.baseTreeSha !== artifact.session.baseTreeSha
        || candidate.headSha !== artifact.session.headSha
        || candidate.headTreeSha !== artifact.session.headTreeSha
        || candidate.isDraft || candidate.isCrossRepository) {
        throw new Error('integrate-hosted OPEN candidate identity drifted before authorization.');
      }
      const existingOperationAttempts = remoteAttempts.filter(({ publication }) => (
        publication.consumptionOperationId === expectedConsumptionOperationId
        || publication.result.authorization.headSha === artifact.session.headSha
      ));
      if (existingOperationAttempts.length > 0) {
        throw new Error('AMBIGUOUS_SIDE_EFFECT: OPEN candidate already has a remote authorization start publication.');
      }
      const evaluation = evaluateFreshHostedIntegration({ github, repository, hosted, candidate,
        provenance: hostedProvenance, observedAt: integrationNow });
      issueDispositionPlan = evaluation.issueDispositionPlan;
      const frozenPreflight = CodexDevelopmentParseMergeGateResult(readFileSync(
        hostedIntegrationPreflightResultPath(ctx.repositoryRoot),
        'utf8'
      ));
      const expectedPreflightDigest = environment.EXPECTED_PREFLIGHT_RESULT_DIGEST;
      if (expectedPreflightDigest === undefined
        || frozenPreflight.resultDigest !== expectedPreflightDigest) {
        throw new Error('integrate-hosted downloaded preflight digest differs from the terminal status binding.');
      }
      assertHostedIntegrationPreflightStillControls({
        frozen: frozenPreflight,
        fresh: evaluation.result
      });
      if (frozenPreflight.authorization.consumptionOperationId !== expectedConsumptionOperationId) {
        throw new Error('Frozen merge-gate preflight changed the stable consumption operation identity.');
      }
      const recovery = loadProviderBranchCloseoutRecoveryArtifact({ ctx, github, repository,
        session: artifact.session, runId: hostedProvenance.runId,
        runAttempt: hostedProvenance.runAttempt });
      selectedRecovery = recovery;
      originalHostPrepared = loadOriginalHostPreparedCloseout({ ctx,
        outputPath: required(args, '--output'), providerRecovery: recovery });
      const publication = createIntegrationAuthorizationOperationPublication({
        result: frozenPreflight, closeoutPreparation: recovery.remotePrepared,
        recoveryArtifact: { artifactId: recovery.metadata.artifactId,
          artifactName: recovery.metadata.artifactName,
          artifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
          artifactDigest: recovery.artifact.artifactDigest,
          runId: recovery.metadata.runId, runAttempt: recovery.metadata.runAttempt },
        provenance: hostedProvenance });
      const published = publishHostedIntegrationAuthorizationOperation(ctx, publication);
      if (published.status !== 'published' || !published.createdByThisInvocation
        || published.publication === null || published.commentId === null) {
        throw new Error(`AMBIGUOUS_SIDE_EFFECT: Integration authorization start publication was not newly and exactly created: ${published.detail}`);
      }
      if (published.publication.provenance.runId !== hostedProvenance.runId
        || published.publication.provenance.runAttempt !== hostedProvenance.runAttempt
        || published.publication.provenance.workflowRef !== hostedProvenance.workflowRef
        || published.publication.provenance.actorNodeId !== hostedProvenance.actorNodeId) {
        throw new Error('AMBIGUOUS_SIDE_EFFECT: authorization start publication owner differs from this hosted invocation.');
      }
      selected = Object.freeze({ publication: published.publication, commentId: published.commentId });
      ownsUnambiguousMergeStart = true;
    }

    const authorizationResult = selected.publication.result;
    const authorizationSource = createTrustedIntegrationAuthorizationPublicationSource({
      publication: selected.publication, commentId: selected.commentId });
    const trustedHosted = createTrustedHostedArtifactProvenance({ artifact,
      artifactText: hosted.originText, observation: hosted.originMetadata,
      actorPermission: hosted.originMetadata.actorPermission });
    const localPrepared = selectedRecovery.prepared;
    const changedPaths = route.lane === 'merged-recovery'
      ? artifact.scopeAuthorization.authorizedPaths
      : github.observeChangedPaths({ repository, prNumber: artifact.session.prNumber,
          state: 'OPEN', draft: false,
          baseSha: artifact.session.baseSha, headSha: artifact.session.headSha }).paths;
    const external = {
      now,
      expiresAt: addSeconds,
      trustedRuntimeProof: (session: typeof artifact.session) => inspectTrustedRuntime({
        repositoryRoot, candidateHeadSha: session.headSha }),
      runLocalActions: () => artifact.evidence.status === 'passed'
        ? { status: 'passed' as const, resultDigest: artifact.evidence.evidenceDigest as `sha256:${string}` }
        : { status: 'failed' as const, reason: `hosted Action evidence is ${artifact.evidence.status}` },
      hostedArtifact: () => ({ artifact, provenance: trustedHosted }),
      saveReviewReceipt: () => undefined,
      integrationAuthorizationArtifact: () => authorizationSource,
      integrationAuthorizationPublication: () => ({
        authorizationId: selected.publication.authorizationId,
        authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        consumptionOperationId: selected.publication.consumptionOperationId,
        authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationPublicationDigest: selected.publication.publicationDigest,
        commentId: selected.commentId,
        preparationDigest: localPrepared.preparation.preparationDigest
      }),
      consumedAuthorizationIds: () => {
        const observed = github.observeCandidate(repository, artifact.session.prNumber);
        if (observed.state !== 'MERGED' || observed.mergeCommitMessage === null) return new Set<string>();
        const markers = integrationMergeMarkers({
          sessionRevision: artifact.session.sessionRevision,
          authorizationId: selected.publication.authorizationId,
          authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
          consumptionOperationId: selected.publication.consumptionOperationId,
          authorizationPublicationId: selected.publication.authorizationPublicationId,
          authorizationPublicationDigest: selected.publication.publicationDigest,
          commentId: selected.commentId
        });
        return markers.every((marker) => observed.mergeCommitMessage!.split(/\r?\n/u).includes(marker))
          ? new Set([selected.publication.authorizationId]) : new Set<string>();
      },
      observeCloseoutPreparation: () => ({ status: 'prepared' as const,
        preparationDigest: localPrepared.preparation.preparationDigest }),
      observeCloseoutBinding: (_authorization: typeof authorizationResult.authorization,
        session: typeof artifact.session, merged: GitHubCandidateObservation) => {
        if (merged.mergeCommitSha === null || merged.mergeCommitTreeSha === null) {
          return { status: 'waiting' as const, reason: 'exact merge readback is unavailable' };
        }
        return { status: 'available' as const, binding: createBranchCloseoutOperationBinding({
          integrationAuthorization: authorizationResult.authorization,
          preparation: localPrepared.preparation, newMainSha: merged.mergeCommitSha,
          newMainTreeSha: merged.mergeCommitTreeSha, candidateTreeSha: session.headTreeSha }) };
      },
      observeCloseout: (binding: ReturnType<typeof createBranchCloseoutOperationBinding>) => {
        const observed = observeBranchCloseoutOperationPublication(ctx.repositoryRoot, { repository,
          pullRequestNumber: artifact.session.prNumber, closeoutOperationId: binding.closeoutOperationId });
        if (observed === null) return { status: 'waiting' as const,
          reason: 'terminal remote closeout publication is unavailable' };
        const status = observed.publication.receipt.closeoutStatus;
        if (status === 'blocked' || status === 'residue') return { status: 'blocked' as const,
          reason: `branch closeout terminal ${status}` };
        return { status, receiptDigest: `sha256:${createHash('sha256').update(
          encodeVerificationActionData({ closeoutOperationId: binding.closeoutOperationId,
            publicationDigest: observed.publication.publicationDigest, commentId: observed.commentId })
        ).digest('hex')}` as const };
      }
    };
    const reduce = (journalFs: VerificationSessionJournalFileSystem) => resumeVerificationSession({ repositoryRoot,
      session: artifact.session, scopeAuthorization: artifact.scopeAuthorization, changedPaths,
      integrationPrincipalNodeId: authorizationResult.provenance.actorNodeId, github, external, journalFs });
    let result = reduce(createEphemeralVerificationSessionJournalFs(durableJournalFs().rootPath));
    let issueReconciliation: Readonly<Record<string, unknown>> = Object.freeze({
      status: 'not-observed', results: Object.freeze([])
    });
    const stopCloseoutForIssueReconciliation = (mergedCandidate: GitHubCandidateObservation): never => {
      const projection = Object.freeze({ schema: 'sec-verification-session-integration-projection-v1',
        repository, prNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision,
        lane: route.lane, effects,
        authorizationId: selected.publication.authorizationId,
        authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationCommentId: selected.commentId, status: 'BLOCKED',
        issueDispositionPlan,
        issueReconciliation,
        boundPostMergeMainSha,
        mergedCommitSha: mergedCandidate.mergeCommitSha,
        mergedCommitTreeSha: mergedCandidate.mergeCommitTreeSha,
        candidateTreeSha: artifact.session.headTreeSha,
        completedStage: result.completedStage, receiptDigest: result.receiptDigest,
        reason: 'external-maintainer-action-required: unexpected GitHub Issue closure requires reconciliation before closeout.',
        observedAt: now() });
      writeDurable(required(args, '--output'), projection);
      throw new Error('external-maintainer-action-required: unexpected GitHub Issue closure blocks MainHealth and branch closeout.');
    };
    if (candidate.state === 'MERGED') {
      issueReconciliation = observePostMergeIssueReconciliation({ repository,
        prNumber: artifact.session.prNumber, candidate });
      if (issueReconciliation.status === 'manual-action-required' || issueReconciliation.status === 'blocked') {
        stopCloseoutForIssueReconciliation(candidate);
      }
    }
    if (result.status === 'READY_TO_INTEGRATE') {
      if (!effects.executePhysicalMerge || !ownsUnambiguousMergeStart) {
        throw new Error('AMBIGUOUS_SIDE_EFFECT: this hosted invocation does not own a newly published merge start claim.');
      }
      candidate = github.observeCandidate(repository, artifact.session.prNumber);
      if (candidate.state !== 'OPEN' || candidate.baseSha !== artifact.session.baseSha
        || candidate.baseTreeSha !== artifact.session.baseTreeSha
        || candidate.headSha !== artifact.session.headSha || candidate.headTreeSha !== artifact.session.headTreeSha) {
        throw new Error('integrate-hosted candidate drifted immediately before physical merge.');
      }
      const fresh = reduce(createEphemeralVerificationSessionJournalFs(durableJournalFs().rootPath));
      if (fresh.status !== 'READY_TO_INTEGRATE'
        || fresh.operationId !== authorizationResult.authorization.consumptionOperationId) {
        throw new Error(`integrate-hosted effect guard changed before merge: ${fresh.status} ${fresh.reason}`);
      }
      const immediatePlan = observeExactIssueDispositionPlan({
        github,
        repository,
        candidate,
        manifestPath: artifact.session.manifestPath,
        manifestDigest: artifact.session.manifestDigest,
        tracking: CodexDevelopmentParseCurrentWorkPackageManifest(
          github.readBlobText(repository, artifact.session.headSha, artifact.session.manifestPath),
          artifact.session.manifestPath
        ).tracking
      });
      if (issueDispositionPlan === null
        || immediatePlan.planDigest !== issueDispositionPlan.planDigest) {
        throw new Error('integrate-hosted Issue disposition plan drifted immediately before merge.');
      }
      const markers = integrationMergeMarkers({
        sessionRevision: artifact.session.sessionRevision,
        authorizationId: selected.publication.authorizationId,
        authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        consumptionOperationId: selected.publication.consumptionOperationId,
        authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationPublicationDigest: selected.publication.publicationDigest,
        commentId: selected.commentId });
      const issueMarkers = [
        `Issue-Disposition-Plan: ${issueDispositionPlan.planDigest}`,
        `Issue-Disposition-Mode: ${issueDispositionPlan.mode}`,
        `Issue-Disposition-Tracking: ${issueDispositionPlan.trackingIssueNumber ?? 'none'}`,
        `Issue-Disposition-Prose: ${issueDispositionPlan.titleBodyDigest}`
      ];
      let providerResponse: HostedSynchronousSquashMergeResponse | null = null;
      let mergeCommandFailure: unknown = null;
      try {
        assertUnavailableProviderCircuitBreakerInvariant({
          ctx,
          capability: 'github-writer',
          now: now()
        });
        providerResponse = executeHostedSquashMerge({ ctx, repository, prNumber: artifact.session.prNumber,
          headSha: artifact.session.headSha, sessionRevision: artifact.session.sessionRevision,
          publication: selected.publication, commentId: selected.commentId, issueDispositionPlan });
      } catch (error) {
        mergeCommandFailure = error;
      }
      let merged: GitHubCandidateObservation;
      try {
        merged = github.observeCandidate(repository, artifact.session.prNumber);
      } catch (error) {
        const providerReason = mergeCommandFailure instanceof Error
          ? mergeCommandFailure.message
          : mergeCommandFailure === null ? 'provider reported success' : String(mergeCommandFailure);
        const readbackReason = error instanceof Error ? error.message : String(error);
        throw new Error('AMBIGUOUS_SIDE_EFFECT: synchronous hosted merge attempt requires recovery; '
          + `provider=${providerReason}; exact-readback=${readbackReason}`);
      }
      try {
        assertHostedSquashMergeCompletion({ candidate: merged,
          expectedBaseSha: artifact.session.baseSha,
          expectedHeadSha: artifact.session.headSha, expectedHeadTreeSha: artifact.session.headTreeSha,
          markers: [...markers, ...issueMarkers], reviewReceipt: selected.publication.result.reviewReceipt,
          expectedTitle: `Verified integration ${artifact.session.sessionRevision.slice(7, 19)}`,
          providerMergeCommitSha: providerResponse?.sha ?? null });
      } catch (readbackError) {
        const providerReason = mergeCommandFailure instanceof Error
          ? mergeCommandFailure.message
          : mergeCommandFailure === null ? 'provider reported success' : String(mergeCommandFailure);
        const readbackReason = readbackError instanceof Error ? readbackError.message : String(readbackError);
        throw new Error('AMBIGUOUS_SIDE_EFFECT: synchronous hosted merge attempt requires recovery; '
          + `provider=${providerReason}; exact-readback=${readbackReason}`);
      }
      issueReconciliation = observePostMergeIssueReconciliation({ repository,
        prNumber: artifact.session.prNumber, candidate: merged });
      if (issueReconciliation.status !== 'no-op') {
        stopCloseoutForIssueReconciliation(merged);
      }
      const synchronized = synchronizeTrustedRemoteDefaultRef({ ctx });
      if (route.lane !== 'open-first-effect' || originalHostPrepared === null) {
        throw new Error('external-maintainer-disposition-required: merged recovery has no same-process original-host closeout authority.');
      }
      boundPostMergeMainSha = assertBoundPostMergeMain({ ctx, repository,
        session: artifact.session, candidate: merged, lane: 'open-first-effect',
        liveMainSha: synchronized.defaultSha, environment });
      await joinExactPostMergeMainHealth({ ctx, github, repository,
        mainSha: boundPostMergeMainSha, environment });
      // The physical merge changed the default SHA and retired the active
      // package. Re-observe at the new stable phase instead of allowing the
      // pre-merge capability to authorize post-merge branch effects.
      ctx = await createBranchLifecycleVerificationScope(repositoryRoot);
      const worktreeCleanupTokens = await routePreparedWorktreeCleanupAttempt({
        foreignWorktreeObservationDigests: originalHostPrepared.foreignWorktreeObservations
          .map(({ observationDigest }) => observationDigest),
        targetCount: new Set(originalHostPrepared.preparation.worktreePathsAtPreparation).size,
        consumeLocalPreparedTargets: () => consumeSameHostWorktreeCloseout({ ctx,
          prepared: originalHostPrepared! })
      });
      const binding = createBranchCloseoutOperationBinding({
        integrationAuthorization: authorizationResult.authorization,
        preparation: originalHostPrepared.preparation,
        newMainSha: boundPostMergeMainSha, newMainTreeSha: merged.mergeCommitTreeSha!,
        candidateTreeSha: artifact.session.headTreeSha
      });
      await finalizeSameInvocationCloseout({ ctx, repository,
        pullRequestNumber: artifact.session.prNumber, prepared: originalHostPrepared,
        binding, authorizationPublication: selected.publication,
        authorizationCommentId: selected.commentId, recovery: selectedRecovery,
        provenance: hostedProvenance, phase: hostedIdentity.phase,
        worktreeCleanupTokens, now });
      result = reduce(durableJournalFs());
    }
    const mergedProjectionCandidate = github.observeCandidate(repository, artifact.session.prNumber);
    if (issueReconciliation.status === 'not-observed') {
      issueReconciliation = observePostMergeIssueReconciliation({ repository,
        prNumber: artifact.session.prNumber, candidate: mergedProjectionCandidate });
      if (issueReconciliation.status === 'manual-action-required' || issueReconciliation.status === 'blocked') {
        stopCloseoutForIssueReconciliation(mergedProjectionCandidate);
      }
    }
    const projection = Object.freeze({ schema: 'sec-verification-session-integration-projection-v1',
      repository, prNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision,
      lane: route.lane, effects,
      authorizationId: selected.publication.authorizationId,
      authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
      authorizationPublicationId: selected.publication.authorizationPublicationId,
      authorizationCommentId: selected.commentId, status: result.status,
      issueDispositionPlan,
      issueReconciliation,
      boundPostMergeMainSha,
      mergedCommitSha: mergedProjectionCandidate.state === 'MERGED'
        ? mergedProjectionCandidate.mergeCommitSha : null,
      mergedCommitTreeSha: mergedProjectionCandidate.state === 'MERGED'
        ? mergedProjectionCandidate.mergeCommitTreeSha : null,
      candidateTreeSha: artifact.session.headTreeSha,
      completedStage: result.completedStage, receiptDigest: result.receiptDigest,
      reason: result.reason, observedAt: now() });
    writeDurable(required(args, '--output'), projection);
    return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  if (command === 'closeout-mutate-hosted') {
    const github = githubAdapter();
    const eventPayload = event();
    const closeout = loadMergedHostedCloseoutContext({ ctx, github, repository,
      event: eventPayload, environment, repositoryRoot, phase: 'closeoutMutation' });
    const session = closeout.hosted.artifact.session;
    // A fresh process cannot rehydrate an opaque physical token.  The
    // immutable prepared target set may be consumed only in this process,
    // after the recovered envelope proves that it has no foreign target.
    // A foreign observation remains a typed blocker all the way through the
    // marker and finalizer; it is never cleared by command selection.
    let worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[] = [];
    const foreignWorktreeObservationDigests = closeout.recovery.prepared.foreignWorktreeObservations
      .map(({ observationDigest }) => observationDigest);
    const issueDisposition = observeHostedTrackingIssueDisposition({
      github, repository, closeout, observedAt: now()
    });
    const existing = observeBranchCloseoutOperationPublication(ctx.repositoryRoot, { repository,
      pullRequestNumber: session.prNumber, closeoutOperationId: closeout.binding.closeoutOperationId });
    if (existing !== null) {
      const terminalStatus = existing.publication.receipt.closeoutStatus;
      if (terminalStatus === 'blocked' || terminalStatus === 'residue') {
        throw new Error(`Hosted closeout terminal is ${terminalStatus}; it cannot be promoted to success.`);
      }
      const projection = Object.freeze({ schema: 'sec-verification-session-closeout-mutation-v1',
        repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
        closeoutOperationId: closeout.binding.closeoutOperationId,
        issueDisposition,
        disposition: 'reused-terminal', closeoutStatus: terminalStatus,
        publicationDigest: existing.publication.publicationDigest,
        closeoutCommentId: existing.commentId, observedAt: now() });
      writeDurable(required(args, '--output'), projection);
      return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
    }
    // An empty target list is ordinary no-worktree closeout.  It cannot erase
    // an original obligation: rehydrating a preparation with a target creates
    // a foreign observation above, which blocks before the private consumer
    // can run.
    worktreeCleanupTokens = await routePreparedWorktreeCleanupAttempt({
      foreignWorktreeObservationDigests,
      targetCount: new Set(closeout.recovery.prepared.preparation.worktreePathsAtPreparation).size,
      consumeLocalPreparedTargets: () => consumeSameHostWorktreeCloseout({
        ctx,
        prepared: closeout.recovery.prepared
      })
    });
    const expectedAuthorizationPublication = Object.freeze({
      authorizationPublicationId: closeout.selected.publication.authorizationPublicationId,
      publicationDigest: closeout.selected.publication.publicationDigest,
      commentId: closeout.selected.commentId
    });
    const expectedRecoveryArtifact = Object.freeze({
      artifactId: closeout.recovery.metadata.artifactId,
      artifactName: closeout.recovery.metadata.artifactName,
      artifactDigest: closeout.recovery.artifact.artifactDigest,
      runId: closeout.recovery.metadata.runId,
      runAttempt: closeout.recovery.metadata.runAttempt
    });
    const { effectStart, terminal } = await withWorkspaceWriteLease(
      ctx.repositoryRoot,
      undefined,
      async (lease) => {
    let effectStart: HostedCloseoutEffectStartReadback;
    const observedStart = observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, { repository,
      pullRequestNumber: session.prNumber, closeoutOperationId: closeout.binding.closeoutOperationId });
    if (observedStart !== null) {
      assertBranchCloseoutEffectStartMatches({ publication: observedStart.publication,
        binding: closeout.binding, authorizationPublication: expectedAuthorizationPublication,
        recoveryArtifact: expectedRecoveryArtifact });
      const remoteBranch = observeExactRemoteCloseoutBranch(ctx, closeout.recovery.prepared);
      if (remoteBranch.state !== 'absent') {
        throw new Error(
          'AMBIGUOUS_SIDE_EFFECT: an existing closeout effect start marker forbids another remote deletion.'
        );
      }
      effectStart = Object.freeze({ disposition: 'existing', ...observedStart });
    } else {
      if (closeout.identity.phase.priorAttemptStarted) {
        throw new Error(
          'AMBIGUOUS_SIDE_EFFECT: a prior closeout mutation phase started without an exact effect start marker.'
        );
      }
      const remoteBranch = observeExactRemoteCloseoutBranch(ctx, closeout.recovery.prepared);
      if (remoteBranch.state !== 'present'
        || remoteBranch.sha !== closeout.recovery.prepared.preparation.expectedHeadSha) {
        throw new Error(
          'AMBIGUOUS_SIDE_EFFECT: a new closeout effect start requires the exact prepared remote branch.'
        );
      }
      const phase = closeout.identity.phase;
      if (phase.phase !== 'closeoutMutation' || phase.jobName !== 'integrate'
        || phase.stepName !== BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME) {
        throw new Error('Hosted closeout mutation phase is not the canonical provider step.');
      }
      const preMarkerGuard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({
        ctx,
        prepared: closeout.recovery.prepared,
        binding: closeout.binding,
        lease,
        worktreeCleanupTokens,
        foreignWorktreeObservationDigests
      });
      const preMarkerAuthorization = preMarkerGuard.authorization;
      if (preMarkerAuthorization.blockers.length > 0 || preMarkerAuthorization.remoteAction !== 'delete-cas') {
        throw new Error(
          'Branch closeout is not authorized before effect-start publication: ' + encodeVerificationActionData(preMarkerAuthorization)
        );
      }
      const publication = createBranchCloseoutEffectStartPublication({
        binding: closeout.binding,
        authorizationPublication: expectedAuthorizationPublication,
        recoveryArtifact: expectedRecoveryArtifact,
        phase: { runId: phase.runId, runAttempt: phase.runAttempt, jobId: phase.jobId,
          jobName: 'integrate', phase: 'closeoutMutation',
          stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
          stepNumber: phase.stepNumber, workflowSha: closeout.identity.provenance.workflowSha },
        provenance: closeout.identity.provenance
      });
      await assertWorkspaceWriteLease(ctx.repositoryRoot, lease);
      const publishedStart = publishHostedCloseoutEffectStart(ctx, publication);
      if (publishedStart.disposition !== 'published') {
        throw new Error(
          'AMBIGUOUS_SIDE_EFFECT: hosted closeout effect start was not newly App-authenticated.'
        );
      }
      effectStart = publishedStart;
    }
    // Intentionally no host-local journal, cache, or projection write may occur
    // between the exact remote start readback above and this high-level effect.
    const terminal = await finalizeHostedBranchCloseout({
      ctx,
      prepared: closeout.recovery.prepared,
      binding: closeout.binding,
      writerId: closeout.binding.closeoutOperationId,
      markerDisposition: effectStart.disposition,
      now,
      lease,
      worktreeCleanupTokens,
      foreignWorktreeObservationDigests
    });
    return Object.freeze({ effectStart, terminal });
      }
    );
    if (encodeVerificationActionData(terminal.binding)
      !== encodeVerificationActionData(closeout.binding)) {
      throw new Error('Hosted closeout terminal receipt binding differs from the exact merged operation.');
    }
    if (terminal.receipt.status === 'blocked' || terminal.receipt.status === 'residue') {
      throw new Error(`Hosted closeout terminal is ${terminal.receipt.status}; publication is forbidden.`);
    }
    const receiptPath = operationReceiptFilePath(closeout.recovery.prepared.preparation,
      closeout.binding.closeoutOperationId);
    const projection = Object.freeze({ schema: 'sec-verification-session-closeout-mutation-v1',
      repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
      closeoutOperationId: closeout.binding.closeoutOperationId,
      issueDisposition,
      disposition: effectStart.disposition === 'existing'
        ? 'recovered-after-effect-start' : 'executed',
      effectStartId: effectStart.publication.effectStartId,
      effectStartPublicationDigest: effectStart.publication.publicationDigest,
      effectStartCommentId: effectStart.commentId,
      closeoutStatus: terminal.receipt.status,
      operationReceiptDigest: terminal.operationReceiptDigest,
      operationReceiptPath: path.resolve(receiptPath), observedAt: now() });
    writeDurable(required(args, '--output'), projection);
    return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  if (command === 'closeout-publish-hosted') {
    const github = githubAdapter();
    const eventPayload = event();
    const closeout = loadMergedHostedCloseoutContext({ ctx, github, repository,
      event: eventPayload, environment, repositoryRoot, phase: 'closeoutPublication' });
    const session = closeout.hosted.artifact.session;
    const existing = observeBranchCloseoutOperationPublication(ctx.repositoryRoot, { repository,
      pullRequestNumber: session.prNumber, closeoutOperationId: closeout.binding.closeoutOperationId });
    if (existing !== null) {
      const terminalStatus = existing.publication.receipt.closeoutStatus;
      if (terminalStatus === 'blocked' || terminalStatus === 'residue') {
        throw new Error(`Hosted closeout terminal is ${terminalStatus}; it cannot be promoted to success.`);
      }
      const projection = Object.freeze({ schema: 'sec-verification-session-closeout-publication-v1',
        repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
        closeoutOperationId: closeout.binding.closeoutOperationId, disposition: 'reused',
        closeoutStatus: terminalStatus,
        publicationDigest: existing.publication.publicationDigest,
        commentId: existing.commentId,
        receiptDigest: closeoutPublicationCompositeDigest({
          closeoutOperationId: closeout.binding.closeoutOperationId,
          publicationDigest: existing.publication.publicationDigest,
          commentId: existing.commentId
        }), observedAt: now() });
      writeDurable(required(args, '--output'), projection);
      return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
    }
    if (closeout.identity.phase.priorAttemptStarted) {
      throw new Error('AMBIGUOUS_SIDE_EFFECT: a prior closeout publication phase started without an exact terminal comment.');
    }
    const effectStart = observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, { repository,
      pullRequestNumber: session.prNumber, closeoutOperationId: closeout.binding.closeoutOperationId });
    if (effectStart === null) {
      throw new Error('Hosted closeout publication requires one exact App-authenticated effect start marker.');
    }
    assertBranchCloseoutEffectStartMatches({ publication: effectStart.publication,
      binding: closeout.binding,
      authorizationPublication: {
        authorizationPublicationId: closeout.selected.publication.authorizationPublicationId,
        publicationDigest: closeout.selected.publication.publicationDigest,
        commentId: closeout.selected.commentId
      },
      recoveryArtifact: {
        artifactId: closeout.recovery.metadata.artifactId,
        artifactName: closeout.recovery.metadata.artifactName,
        artifactDigest: closeout.recovery.artifact.artifactDigest,
        runId: closeout.recovery.metadata.runId,
        runAttempt: closeout.recovery.metadata.runAttempt
      } });
    const receiptPath = operationReceiptFilePath(closeout.recovery.prepared.preparation,
      closeout.binding.closeoutOperationId);
    if (!existsSync(receiptPath)) {
      throw new Error('Hosted closeout publication requires the exact local operation receipt from the mutation phase.');
    }
    const terminal = parseBranchCloseoutOperationReceipt(readFileSync(receiptPath, 'utf8'));
    if (encodeVerificationActionData(terminal.binding)
      !== encodeVerificationActionData(closeout.binding)) {
      throw new Error('Hosted closeout operation receipt belongs to a different merged operation.');
    }
    if (terminal.receipt.status === 'blocked' || terminal.receipt.status === 'residue') {
      throw new Error(`Hosted closeout terminal is ${terminal.receipt.status}; publication is forbidden.`);
    }
    const publication = publishHostedCloseoutTerminal({
      ctx,
      operationReceipt: terminal,
      provenance: closeout.identity.provenance,
      effectStart: Object.freeze({ disposition: 'existing', ...effectStart })
    });
    if (publication.publication.closeoutOperationId !== closeout.binding.closeoutOperationId
      || encodeVerificationActionData(publication.publication.binding)
        !== encodeVerificationActionData(terminal.binding)) {
      throw new Error('Hosted closeout publication readback differs from the exact operation receipt.');
    }
    const projection = Object.freeze({ schema: 'sec-verification-session-closeout-publication-v1',
      repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
      closeoutOperationId: closeout.binding.closeoutOperationId, disposition: 'published',
      closeoutStatus: terminal.receipt.status,
      operationReceiptDigest: terminal.operationReceiptDigest,
      publicationDigest: publication.publication.publicationDigest,
      commentId: publication.commentId,
      receiptDigest: closeoutPublicationCompositeDigest({
        closeoutOperationId: closeout.binding.closeoutOperationId,
        publicationDigest: publication.publication.publicationDigest,
        commentId: publication.commentId
      }), observedAt: now() });
    writeDurable(required(args, '--output'), projection);
    return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  throw new Error(USAGE);
}

if (import.meta.main) {
  process.stdout.write(`${await verificationSessionCli(process.argv.slice(2))}\n`);
}
