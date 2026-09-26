/** Exact, protected-root local-main closeout bound to a terminal integration projection. */

import { realpathSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../../filesystem/write-lease.ts';
import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

const LOCAL_MAIN_CLOSEOUT_BINDING_SCHEMA = 'sec-local-main-closeout-binding-v3' as const;

export interface LocalMainCloseoutBinding {
  readonly schema: typeof LOCAL_MAIN_CLOSEOUT_BINDING_SCHEMA;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly protectedRootRealPath: string;
  readonly expectedLocalPreimageSha: string;
  readonly expectedLocalPreimageTreeSha: string;
  readonly expectedCandidateHeadSha: string;
  readonly expectedRemoteMainSha: string;
  readonly expectedRemoteMainTreeSha: string;
  readonly expectedCandidateTreeSha: string;
  readonly sessionRevision: `sha256:${string}`;
  readonly authorizationId: `sha256:${string}`;
  readonly authorizationReceiptDigest: `sha256:${string}`;
  readonly consumptionOperationId: `sha256:${string}`;
  readonly authorizationPublicationId: `sha256:${string}`;
  readonly authorizationPublicationDigest: `sha256:${string}`;
  readonly authorizationCommentId: number;
  readonly reviewReceiptDigest: `sha256:${string}`;
  readonly reviewRevision: `sha256:${string}`;
  readonly integrationWorkflowSha: string;
  readonly integrationRunId: string;
  readonly integrationRunAttempt: number;
  readonly bindingDigest: `sha256:${string}`;
}

export type LocalMainCloseoutStatus =
  | Readonly<{
    status: 'LOCAL_MAIN_READY';
    action: 'already-current' | 'ff-only-synced';
    localHeadSha: string;
    localTreeSha: string;
    remoteMainSha: string;
    remoteMainTreeSha: string;
    bindingDigest: `sha256:${string}`;
  }>
  | Readonly<{
    status: 'LOCAL_MAIN_FF_ELIGIBLE';
    action: 'ff-only-eligible';
    localHeadSha: string;
    localTreeSha: string;
    remoteMainSha: string;
    remoteMainTreeSha: string;
    bindingDigest: `sha256:${string}`;
  }>
  | Readonly<{
    status: 'LOCAL_MAIN_SYNC_BLOCKED';
    reason: 'binding-invalid' | 'dirty' | 'local-only-commits' | 'not-fast-forwardable' | 'unresolved';
    detail: string;
    localHeadSha: string | null;
    localTreeSha: string | null;
    remoteMainSha: string | null;
    remoteMainTreeSha: string | null;
    bindingDigest: `sha256:${string}` | null;
  }>;

interface LocalMainGitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Narrow facts consumed by the local-main mutation owner.
 *
 * Integration publication parsing, hosted marker construction, and GitHub
 * transport remain in their owners.  This boundary accepts only the facts
 * already validated by those owners, so the closeout operation does not form
 * a reverse dependency on verification or integration implementations.
 */
export interface LocalMainCloseoutCandidateObservation {
  readonly repository: string;
  readonly number: number;
  readonly state: 'OPEN' | 'MERGED' | 'CLOSED';
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly mergeCommitSha: string | null;
  readonly mergeCommitTreeSha: string | null;
  readonly mergeCommitMessage: string | null;
}

export interface LocalMainHostedAuthorityFacts {
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly sessionRevision: string;
  readonly authorizationId: string;
  readonly authorizationReceiptDigest: string;
  readonly consumptionOperationId: string;
  readonly authorizationPublicationId: string;
  readonly authorizationPublicationDigest: string;
  readonly authorizationHeadSha: string;
  readonly authorizationHeadTreeSha: string;
  readonly reviewReceiptDigest: string;
  readonly reviewRevision: string;
  readonly integrationWorkflowSha: string;
  readonly integrationRunId: string;
  readonly integrationRunAttempt: number;
}

export type LocalMainGitRunner = (
  repoRoot: string,
  args: readonly string[]
) => LocalMainGitResult;

function coordinatedCommonDir(repoRoot: string, git: LocalMainGitRunner): Readonly<{
  path: string;
  device: string;
  inode: string;
}> {
  const result = git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const value = result.stdout.trim();
  if (result.status !== 0 || !path.isAbsolute(value) || value.includes('\0')
      || value.includes('\n') || value.includes('\r')) {
    throw new Error('Native Git common-dir observation is unavailable or noncanonical.');
  }
  const physical = inspectNoFollowDirectoryChain(value, 'Local main Git common-dir').target;
  return Object.freeze({ path: physical.path, device: physical.device, inode: physical.inode });
}

function exactSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} must be an exact SHA.`);
  return value;
}

function exactDigest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be an exact digest.`);
  return value as `sha256:${string}`;
}

function canonicalGitPathInventory(result: LocalMainGitResult, label: string): readonly string[] {
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
  if (result.stdout.length === 0) return Object.freeze([]);
  if (!result.stdout.endsWith('\0')) throw new Error(`${label} is not one NUL-terminated path inventory.`);
  const paths = result.stdout.slice(0, -1).split('\0');
  if (paths.some((value) => value.length === 0 || value.includes('\\') || path.posix.isAbsolute(value)
    || value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..'))
    || new Set(paths).size !== paths.length) {
    throw new Error(`${label} contains a noncanonical or duplicate repository path.`);
  }
  return Object.freeze(paths.sort());
}

function repositoryPathsOverlap(left: string, right: string): boolean {
  const comparable = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const a = comparable(left);
  const b = comparable(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function shaOf(result: LocalMainGitResult): string | null {
  const value = result.stdout.trim();
  return result.status === 0 && /^[0-9a-f]{40}$/u.test(value) ? value : null;
}

export function createLocalMainCloseoutBinding(input: Omit<LocalMainCloseoutBinding,
  'schema' | 'bindingDigest'>): LocalMainCloseoutBinding {
  const withoutDigest = Object.freeze({ schema: LOCAL_MAIN_CLOSEOUT_BINDING_SCHEMA,
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    protectedRootRealPath: path.resolve(realpathSync(input.protectedRootRealPath)),
    expectedLocalPreimageSha: exactSha(input.expectedLocalPreimageSha, 'expectedLocalPreimageSha'),
    expectedLocalPreimageTreeSha: exactSha(input.expectedLocalPreimageTreeSha,
      'expectedLocalPreimageTreeSha'),
    expectedCandidateHeadSha: exactSha(input.expectedCandidateHeadSha, 'expectedCandidateHeadSha'),
    expectedRemoteMainSha: exactSha(input.expectedRemoteMainSha, 'expectedRemoteMainSha'),
    expectedRemoteMainTreeSha: exactSha(input.expectedRemoteMainTreeSha, 'expectedRemoteMainTreeSha'),
    expectedCandidateTreeSha: exactSha(input.expectedCandidateTreeSha, 'expectedCandidateTreeSha'),
    sessionRevision: exactDigest(input.sessionRevision, 'sessionRevision'),
    authorizationId: exactDigest(input.authorizationId, 'authorizationId'),
    authorizationReceiptDigest: exactDigest(input.authorizationReceiptDigest, 'authorizationReceiptDigest'),
    consumptionOperationId: exactDigest(input.consumptionOperationId, 'consumptionOperationId'),
    authorizationPublicationId: exactDigest(input.authorizationPublicationId, 'authorizationPublicationId'),
    authorizationPublicationDigest: exactDigest(input.authorizationPublicationDigest,
      'authorizationPublicationDigest'),
    authorizationCommentId: input.authorizationCommentId,
    reviewReceiptDigest: exactDigest(input.reviewReceiptDigest, 'reviewReceiptDigest'),
    reviewRevision: exactDigest(input.reviewRevision, 'reviewRevision'),
    integrationWorkflowSha: exactSha(input.integrationWorkflowSha, 'integrationWorkflowSha'),
    integrationRunId: input.integrationRunId,
    integrationRunAttempt: input.integrationRunAttempt });
  if (typeof withoutDigest.repository !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(withoutDigest.repository)
    || !Number.isSafeInteger(withoutDigest.pullRequestNumber) || withoutDigest.pullRequestNumber < 1
    || !Number.isSafeInteger(withoutDigest.authorizationCommentId) || withoutDigest.authorizationCommentId < 1
    || !/^[1-9][0-9]*$/u.test(withoutDigest.integrationRunId)
    || !Number.isSafeInteger(withoutDigest.integrationRunAttempt) || withoutDigest.integrationRunAttempt < 1) {
    throw new Error('local-main closeout authority identity is invalid.');
  }
  if (withoutDigest.expectedRemoteMainTreeSha !== withoutDigest.expectedCandidateTreeSha) {
    throw new Error('merged main tree must equal the exact candidate tree.');
  }
  return Object.freeze({ ...withoutDigest, bindingDigest: sha256(withoutDigest) as `sha256:${string}` });
}

function blocked(binding: LocalMainCloseoutBinding | null,
  reason: Extract<LocalMainCloseoutStatus, { status: 'LOCAL_MAIN_SYNC_BLOCKED' }>['reason'],
  detail: string, localHeadSha: string | null = null, localTreeSha: string | null = null,
  remoteMainSha: string | null = null, remoteMainTreeSha: string | null = null): LocalMainCloseoutStatus {
  return Object.freeze({ status: 'LOCAL_MAIN_SYNC_BLOCKED', reason, detail, localHeadSha, localTreeSha,
    remoteMainSha, remoteMainTreeSha, bindingDigest: binding?.bindingDigest ?? null });
}

function assertBinding(binding: LocalMainCloseoutBinding): LocalMainCloseoutBinding {
  const current = createLocalMainCloseoutBinding(binding);
  if (binding.schema !== LOCAL_MAIN_CLOSEOUT_BINDING_SCHEMA || current.bindingDigest !== binding.bindingDigest) {
    throw new Error('local-main closeout binding digest mismatch.');
  }
  return current;
}

function inspectLocalMutationPreconditions(
  repoRoot: string,
  binding: LocalMainCloseoutBinding,
  git: LocalMainGitRunner
): LocalMainCloseoutStatus | null {
  if (path.resolve(realpathSync(repoRoot)) !== binding.protectedRootRealPath) {
    return blocked(binding, 'binding-invalid', 'protected root identity differs from the bound real path.');
  }
  const worktree = git(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  const topLevel = git(repoRoot, ['rev-parse', '--show-toplevel']);
  try {
    if (worktree.status !== 0 || worktree.stdout.trim() !== 'true' || topLevel.status !== 0
      || path.resolve(realpathSync(topLevel.stdout.trim())) !== binding.protectedRootRealPath) {
      return blocked(binding, 'binding-invalid', 'protected root is not the exact ordinary Git worktree root.');
    }
  } catch (error) {
    return blocked(binding, 'binding-invalid', error instanceof Error ? error.message : String(error));
  }
  const localHeadSha = shaOf(git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']));
  const localTreeSha = shaOf(git(repoRoot, ['rev-parse', '--verify', 'HEAD^{tree}']));
  const branch = git(repoRoot, ['symbolic-ref', '--short', 'HEAD']);
  if (branch.status !== 0 || branch.stdout.trim() !== 'main') {
    return blocked(binding, 'binding-invalid', 'protected root is not on main.', localHeadSha, localTreeSha);
  }
  const status = git(repoRoot, [
    '--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all']);
  if (status.status !== 0) {
    return blocked(binding, 'unresolved', status.stderr.trim(), localHeadSha, localTreeSha);
  }
  if (status.stdout.length > 0) {
    return blocked(binding, 'dirty', 'protected local main is dirty; no stash/reset/checkout.',
      localHeadSha, localTreeSha);
  }
  if (localHeadSha === binding.expectedRemoteMainSha
    && localTreeSha === binding.expectedRemoteMainTreeSha) return null;
  if (localHeadSha !== binding.expectedLocalPreimageSha) {
    return blocked(binding, 'binding-invalid', 'local HEAD differs from the authorized preimage.',
      localHeadSha, localTreeSha);
  }
  if (localTreeSha !== binding.expectedLocalPreimageTreeSha) {
    return blocked(binding, 'binding-invalid', 'local HEAD tree differs from the authorized preimage tree.',
      localHeadSha, localTreeSha);
  }
  return null;
}

/** Pure inspection: reads repository state only; never fetches, merges, checks out, stashes, or writes. */
export function inspectLocalMainCloseout(
  repoRoot: string,
  sourceBinding: LocalMainCloseoutBinding,
  git: LocalMainGitRunner
): LocalMainCloseoutStatus {
  let binding: LocalMainCloseoutBinding;
  try {
    binding = assertBinding(sourceBinding);
    if (path.resolve(realpathSync(repoRoot)) !== binding.protectedRootRealPath) {
      return blocked(binding, 'binding-invalid', 'protected root identity differs from the bound real path.');
    }
  } catch (error) {
    return blocked(null, 'binding-invalid', error instanceof Error ? error.message : String(error));
  }
  const remoteMainSha = shaOf(git(repoRoot, ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']));
  const remoteMainTreeSha = shaOf(git(repoRoot, ['rev-parse', '--verify', 'refs/remotes/origin/main^{tree}']));
  const localHeadSha = shaOf(git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']));
  const localTreeSha = shaOf(git(repoRoot, ['rev-parse', '--verify', 'HEAD^{tree}']));
  if (remoteMainSha === null || remoteMainTreeSha === null || localHeadSha === null || localTreeSha === null) {
    return blocked(binding, 'unresolved', 'local or remote-tracking identity is unavailable.', localHeadSha,
      localTreeSha, remoteMainSha, remoteMainTreeSha);
  }
  if (remoteMainSha !== binding.expectedRemoteMainSha
    || remoteMainTreeSha !== binding.expectedRemoteMainTreeSha) {
    return blocked(binding, 'binding-invalid', 'remote-tracking main differs from the exact merged commit/tree binding.',
      localHeadSha, localTreeSha, remoteMainSha, remoteMainTreeSha);
  }
  const branch = git(repoRoot, ['symbolic-ref', '--short', 'HEAD']);
  if (branch.status !== 0 || branch.stdout.trim() !== 'main') {
    return blocked(binding, 'binding-invalid', 'protected root is not on main.', localHeadSha, localTreeSha,
      remoteMainSha, remoteMainTreeSha);
  }
  const status = git(repoRoot, [
    '--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all']);
  if (status.status !== 0) return blocked(binding, 'unresolved', status.stderr.trim(), localHeadSha,
    localTreeSha, remoteMainSha, remoteMainTreeSha);
  if (status.stdout.length > 0) return blocked(binding, 'dirty', 'protected local main is dirty; no stash/reset/checkout.',
    localHeadSha, localTreeSha, remoteMainSha, remoteMainTreeSha);
  if (localHeadSha === remoteMainSha) {
    if (localTreeSha !== remoteMainTreeSha) return blocked(binding, 'binding-invalid', 'equal commit has unequal tree.',
      localHeadSha, localTreeSha, remoteMainSha, remoteMainTreeSha);
    return Object.freeze({ status: 'LOCAL_MAIN_READY', action: 'already-current', localHeadSha, localTreeSha,
      remoteMainSha, remoteMainTreeSha, bindingDigest: binding.bindingDigest });
  }
  if (localHeadSha !== binding.expectedLocalPreimageSha) {
    return blocked(binding, 'binding-invalid', 'local HEAD differs from the authorized preimage.', localHeadSha,
      localTreeSha, remoteMainSha, remoteMainTreeSha);
  }
  if (localTreeSha !== binding.expectedLocalPreimageTreeSha) {
    return blocked(binding, 'binding-invalid', 'local HEAD tree differs from the authorized preimage tree.',
      localHeadSha, localTreeSha, remoteMainSha, remoteMainTreeSha);
  }
  const localOnly = git(repoRoot, ['rev-list', '--count', localHeadSha, '--not', remoteMainSha]);
  if (localOnly.status !== 0 || localOnly.stdout.trim() !== '0') return blocked(binding, 'local-only-commits',
    `protected local main has ${localOnly.stdout.trim() || '?'} local-only commit(s).`, localHeadSha, localTreeSha,
    remoteMainSha, remoteMainTreeSha);
  if (git(repoRoot, ['merge-base', '--is-ancestor', localHeadSha, remoteMainSha]).status !== 0) {
    return blocked(binding, 'not-fast-forwardable', 'bound local preimage is not an ancestor of exact remote main.',
      localHeadSha, localTreeSha, remoteMainSha, remoteMainTreeSha);
  }
  return Object.freeze({ status: 'LOCAL_MAIN_FF_ELIGIBLE', action: 'ff-only-eligible', localHeadSha,
    localTreeSha, remoteMainSha, remoteMainTreeSha, bindingDigest: binding.bindingDigest });
}

export async function executeLocalMainCloseout(
  repoRoot: string,
  sourceBinding: LocalMainCloseoutBinding,
  git: LocalMainGitRunner,
  workspaceWriteLease: WorkspaceWriteLeaseToken,
  commonWriteLease: WorkspaceWriteLeaseToken
): Promise<LocalMainCloseoutStatus> {
  let binding: LocalMainCloseoutBinding;
  try { binding = assertBinding(sourceBinding); } catch (error) {
    return blocked(null, 'binding-invalid', error instanceof Error ? error.message : String(error));
  }
  let commonDir: ReturnType<typeof coordinatedCommonDir>;
  try { commonDir = coordinatedCommonDir(repoRoot, git); } catch (error) {
    return blocked(binding, 'binding-invalid', error instanceof Error ? error.message : String(error));
  }
  const assertCoordinatedLeases = async (): Promise<boolean> => {
    await assertWorkspaceWriteLease(commonDir.path, commonWriteLease);
    await assertWorkspaceWriteLease(repoRoot, workspaceWriteLease);
    const current = coordinatedCommonDir(repoRoot, git);
    return current.path === commonDir.path
      && current.device === commonDir.device
      && current.inode === commonDir.inode;
  };
  if (!(await assertCoordinatedLeases())) {
    return blocked(binding, 'binding-invalid', 'Git common-dir physical identity drifted before local-main closeout.');
  }
  const preflight = inspectLocalMutationPreconditions(repoRoot, binding, git);
  if (preflight !== null) return preflight;
  const advertised = git(repoRoot, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  const advertisedSha = advertised.stdout.trim().split(/\s+/u)[0] ?? '';
  if (advertised.status !== 0 || advertisedSha !== binding.expectedRemoteMainSha) {
    return blocked(binding, 'binding-invalid', 'live remote main differs from the authorized exact merged commit.');
  }
  if (!(await assertCoordinatedLeases())) {
    return blocked(binding, 'binding-invalid', 'Git common-dir physical identity drifted before fetch.');
  }
  const fetch = git(repoRoot, ['fetch', '--no-tags', 'origin',
    '+refs/heads/main:refs/remotes/origin/main']);
  if (fetch.status !== 0) return blocked(binding, 'unresolved', `exact remote fetch failed: ${fetch.stderr.trim()}`);
  const inspected = inspectLocalMainCloseout(repoRoot, binding, git);
  if (inspected.status === 'LOCAL_MAIN_READY') return inspected;
  if (inspected.status !== 'LOCAL_MAIN_FF_ELIGIBLE') return inspected;
  if (!(await assertCoordinatedLeases())) {
    return blocked(binding, 'binding-invalid', 'Git common-dir physical identity drifted before local-main publication.');
  }
  const commitFence = inspectLocalMutationPreconditions(repoRoot, binding, git);
  if (commitFence !== null) return commitFence;
  const remoteFence = git(repoRoot, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  if (remoteFence.status !== 0
    || (remoteFence.stdout.trim().split(/\s+/u)[0] ?? '') !== binding.expectedRemoteMainSha) {
    return blocked(binding, 'binding-invalid', 'live remote main drifted before local-main publication.',
      inspected.localHeadSha, inspected.localTreeSha, inspected.remoteMainSha, inspected.remoteMainTreeSha);
  }
  let ignoredPaths: readonly string[];
  let incomingPaths: readonly string[];
  try {
    ignoredPaths = canonicalGitPathInventory(git(repoRoot,
      ['--no-optional-locks', 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--']),
    'ignored local path inventory');
    incomingPaths = canonicalGitPathInventory(git(repoRoot,
      ['--no-optional-locks', 'diff', '--name-only', '--no-renames', '-z',
        binding.expectedLocalPreimageSha, binding.expectedRemoteMainSha, '--']),
    'incoming tracked path inventory');
  } catch (error) {
    return blocked(binding, 'unresolved', error instanceof Error ? error.message : String(error),
      inspected.localHeadSha, inspected.localTreeSha, inspected.remoteMainSha, inspected.remoteMainTreeSha);
  }
  if (ignoredPaths.some((ignored) => incomingPaths.some((incoming) => repositoryPathsOverlap(ignored, incoming)))) {
    return blocked(binding, 'dirty', 'an ignored untracked path collides with the exact incoming tracked write set.',
      inspected.localHeadSha, inspected.localTreeSha, inspected.remoteMainSha, inspected.remoteMainTreeSha);
  }
  if (!(await assertCoordinatedLeases())) {
    return blocked(binding, 'binding-invalid', 'Git common-dir physical identity drifted at ff-only effect boundary.');
  }
  const merge = git(repoRoot, ['-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', binding.expectedRemoteMainSha]);
  if (merge.status !== 0) return blocked(binding, 'unresolved', `ff-only merge failed: ${merge.stderr.trim()}`,
    inspected.localHeadSha, inspected.localTreeSha, inspected.remoteMainSha, inspected.remoteMainTreeSha);
  if (!(await assertCoordinatedLeases())) {
    return blocked(binding, 'unresolved', 'Git common-dir physical identity drifted after ff-only.');
  }
  const readback = inspectLocalMainCloseout(repoRoot, binding, git);
  if (readback.status !== 'LOCAL_MAIN_READY' || readback.localHeadSha !== binding.expectedRemoteMainSha
    || readback.localTreeSha !== binding.expectedRemoteMainTreeSha) {
    return blocked(binding, 'unresolved', 'local-main exact commit/tree readback failed after ff-only.');
  }
  const remoteReadback = git(repoRoot, ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  if (remoteReadback.status !== 0
    || (remoteReadback.stdout.trim().split(/\s+/u)[0] ?? '') !== binding.expectedRemoteMainSha) {
    return blocked(binding, 'unresolved', 'live remote main drifted during local-main publication.');
  }
  return Object.freeze({ ...readback, action: 'ff-only-synced' as const });
}

export function createLocalMainCloseoutBindingFromHostedAuthority(input: {
  readonly protectedRoot: string;
  readonly expectedLocalPreimageSha: string;
  readonly expectedLocalPreimageTreeSha: string;
  readonly hostedAuthority: LocalMainHostedAuthorityFacts;
  readonly authorizationMarkers: readonly string[];
  readonly liveCommentId: number;
  readonly liveCandidate: LocalMainCloseoutCandidateObservation;
}): LocalMainCloseoutBinding {
  const authority = input.hostedAuthority;
  const candidate = input.liveCandidate;
  if (candidate.repository !== authority.repository
    || candidate.number !== authority.pullRequestNumber
    || candidate.state !== 'MERGED' || candidate.mergeCommitSha === null
    || candidate.mergeCommitTreeSha === null || candidate.mergeCommitMessage === null
    || candidate.headSha !== authority.authorizationHeadSha
    || candidate.headTreeSha !== authority.authorizationHeadTreeSha
    || candidate.mergeCommitTreeSha !== candidate.headTreeSha) {
    throw new Error('live hosted authorization differs from the exact merged candidate closure.');
  }
  if (input.authorizationMarkers.length === 0
    || input.authorizationMarkers.some((marker) => typeof marker !== 'string' || marker.length === 0)
    || new Set(input.authorizationMarkers).size !== input.authorizationMarkers.length
    || !input.authorizationMarkers.every((marker) => candidate.mergeCommitMessage!.split(/\r?\n/u).includes(marker))) {
    throw new Error('live merged commit lacks the exact hosted authorization consumption closure.');
  }
  return createLocalMainCloseoutBinding({
    repository: authority.repository,
    pullRequestNumber: authority.pullRequestNumber,
    protectedRootRealPath: input.protectedRoot,
    expectedLocalPreimageSha: input.expectedLocalPreimageSha,
    expectedLocalPreimageTreeSha: input.expectedLocalPreimageTreeSha,
    expectedCandidateHeadSha: authority.authorizationHeadSha,
    expectedRemoteMainSha: exactSha(candidate.mergeCommitSha, 'liveCandidate.mergeCommitSha'),
    expectedRemoteMainTreeSha: exactSha(candidate.mergeCommitTreeSha, 'liveCandidate.mergeCommitTreeSha'),
    expectedCandidateTreeSha: exactSha(candidate.headTreeSha, 'liveCandidate.headTreeSha'),
    sessionRevision: exactDigest(authority.sessionRevision, 'hostedAuthority.sessionRevision'),
    authorizationId: exactDigest(authority.authorizationId, 'hostedAuthority.authorizationId'),
    authorizationReceiptDigest: exactDigest(authority.authorizationReceiptDigest,
      'hostedAuthority.authorizationReceiptDigest'),
    consumptionOperationId: exactDigest(authority.consumptionOperationId,
      'hostedAuthority.consumptionOperationId'),
    authorizationPublicationId: exactDigest(authority.authorizationPublicationId,
      'hostedAuthority.authorizationPublicationId'),
    authorizationPublicationDigest: exactDigest(authority.authorizationPublicationDigest,
      'hostedAuthority.authorizationPublicationDigest'),
    authorizationCommentId: input.liveCommentId,
    reviewReceiptDigest: exactDigest(authority.reviewReceiptDigest, 'hostedAuthority.reviewReceiptDigest'),
    reviewRevision: exactDigest(authority.reviewRevision, 'hostedAuthority.reviewRevision'),
    integrationWorkflowSha: authority.integrationWorkflowSha,
    integrationRunId: authority.integrationRunId,
    integrationRunAttempt: authority.integrationRunAttempt
  });
}
