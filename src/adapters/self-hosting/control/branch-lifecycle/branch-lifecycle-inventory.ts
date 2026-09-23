import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

import { parseGitHubRepositoryIdentityFromRemoteUrl } from '../../../../contracts/git-reference.ts';

import {
  requireActiveWorkPackageOwnerObservation,
  type ActiveWorkPackageOwnerObservation
} from '../task/contract/active-work-observation.ts';
import {
  BRANCH_CLOSEOUT_ENFORCEMENT_MARKER_PATH,
  parsePublishedBranchCloseoutReceiptComments,
  resolveBranchCloseoutReceiptObservation
} from './branch-closeout-receipt.ts';
import { selectBranchLifecyclePullRequests } from './branch-lifecycle-audit.ts';
import {
  createBranchLifecycleGitChildEnvironment,
  createBranchLifecycleGitHubCredentialArgs,
  decodeBranchLifecycleChildError,
  decodeBranchLifecycleChildStdout
} from './branch-lifecycle-command.ts';
import {
  BRANCH_LIFECYCLE_INVENTORY_SCHEMA,
  assertGitBranchName,
  assertGitSha,
  type BranchActiveWorkPackageObservation,
  type BranchCloseoutReceiptObservation,
  type BranchLifecycleInventory,
  type BranchPruneConfigurationObservation,
  type BranchPullRequestObservation,
  type BranchRefObservation,
  type BranchRepositorySettingObservation,
  type BranchWorktreeObservation
} from './branch-lifecycle-contract.ts';
import {
  countPorcelainStatus,
  parseLocalBranchRefs,
  parsePullRequestObservations,
  parseRemoteHeadRefs,
  parseRestCloseoutReceiptCommentCandidates,
  parseWorktreePorcelain
} from './branch-lifecycle-parsers.ts';

const DEFAULT_REMOTE = 'origin';
const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;
type CollaboratorPermission = 'trusted' | 'untrusted' | 'unknown';

export interface BranchLifecycleInventoryScope {
  readonly repositoryRoot: string;
  readonly remote?: string;
  readonly repositoryFullName?: string;
  readonly defaultBranch?: string;
  readonly activeWorkPackageObservation?: ActiveWorkPackageOwnerObservation;
}

export interface BranchLifecycleCloseoutTargetScope
  extends Omit<BranchLifecycleInventoryScope, 'defaultBranch'> {
  readonly targetBranch: string;
  readonly pullRequestNumber: number;
  /** Authenticated exact PR observation from the production provider owner. */
  readonly exactPullRequest: BranchPullRequestObservation;
  /** Preparation inventory supplies only non-effect policy facts. */
  readonly preparedInventory: BranchLifecycleInventory;
}

type InventoryRuntime = BranchLifecycleInventoryScope;

function runInventoryCommand(
  ctx: InventoryRuntime,
  command: 'gh' | 'git',
  args: readonly string[],
  cwd = ctx.repositoryRoot
) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('Branch inventory argument contains NUL.');
  }
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    env: {
      ...(command === 'git'
        ? createBranchLifecycleGitChildEnvironment(process.env)
        : process.env),
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : Buffer.from(String(result.stderr ?? result.error?.message ?? ''))
  };
}

function requireInventoryCommandText(
  ctx: InventoryRuntime,
  command: 'gh' | 'git',
  args: readonly string[],
  label: string,
  cwd = ctx.repositoryRoot
): string {
  const result = runInventoryCommand(ctx, command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return decodeBranchLifecycleChildStdout(result);
}

function optionalInventoryCommandText(
  ctx: InventoryRuntime,
  command: 'gh' | 'git',
  args: readonly string[],
  cwd = ctx.repositoryRoot
): string | null {
  const result = runInventoryCommand(ctx, command, args, cwd);
  return result.status === 0 ? decodeBranchLifecycleChildStdout(result) : null;
}

function stableSortWorktrees(entries: BranchWorktreeObservation[]): BranchWorktreeObservation[] {
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function parseRepositoryFullName(remoteUrl: string): string | null {
  return parseGitHubRepositoryIdentityFromRemoteUrl(remoteUrl);
}

function resolveRealPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function resolveRepositoryRoot(ctx: InventoryRuntime): string {
  return resolveRealPath(requireInventoryCommandText(
    ctx,
    'git',
    ['rev-parse', '--show-toplevel'],
    'repository root discovery'
  ));
}

function resolveCommonDir(ctx: InventoryRuntime, repositoryRoot: string): string {
  const raw = requireInventoryCommandText(
    ctx,
    'git',
    ['rev-parse', '--git-common-dir'],
    'git common-dir discovery',
    repositoryRoot
  );
  return resolveRealPath(path.isAbsolute(raw) ? raw : path.resolve(repositoryRoot, raw));
}

function resolveRemoteUrl(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  remote: string
): string {
  return requireInventoryCommandText(
    ctx,
    'git',
    ['remote', 'get-url', remote],
    `remote ${remote} URL discovery`,
    repositoryRoot
  );
}

function resolveRepositoryFullName(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  remoteUrl: string,
  unknowns: string[]
): string {
  const fromRemote = parseRepositoryFullName(remoteUrl);
  if (fromRemote !== null) {
    if (ctx.repositoryFullName !== undefined && ctx.repositoryFullName !== fromRemote) {
      throw new Error('repositoryFullName differs from the observed origin remote identity');
    }
    return fromRemote;
  }
  const fromGh = optionalInventoryCommandText(
    ctx,
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    repositoryRoot
  );
  if (fromGh !== null
      && parseGitHubRepositoryIdentityFromRemoteUrl(`https://github.com/${fromGh}.git`) === fromGh) {
    if (ctx.repositoryFullName !== undefined && ctx.repositoryFullName !== fromGh) {
      throw new Error('repositoryFullName differs from the provider-observed repository identity');
    }
    return fromGh;
  }
  unknowns.push('repository full name could not be resolved from remote URL or gh');
  return '<unknown>/<unknown>';
}

function resolveDefaultBranch(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  remote: string,
  unknowns: string[]
): string {
  if (ctx.defaultBranch) {
    assertGitBranchName(ctx.defaultBranch, 'default branch');
    return ctx.defaultBranch;
  }
  const symbolic = optionalInventoryCommandText(
    ctx,
    'git',
    ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
    repositoryRoot
  );
  if (symbolic?.startsWith(`${remote}/`)) {
    const branch = symbolic.slice(remote.length + 1);
    assertGitBranchName(branch, 'default branch');
    return branch;
  }
  const fromGh = optionalInventoryCommandText(
    ctx,
    'gh',
    ['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'],
    repositoryRoot
  );
  if (fromGh !== null) {
    assertGitBranchName(fromGh, 'default branch');
    return fromGh;
  }
  unknowns.push('default branch could not be resolved; temporary fallback `main` is untrusted');
  return 'main';
}

function listLocalBranches(
  ctx: InventoryRuntime,
  repositoryRoot: string
): BranchRefObservation[] {
  const result = runInventoryCommand(ctx, 'git', [
    'for-each-ref',
    '--format=%(refname:short)%00%(objectname)%00',
    'refs/heads'
  ], repositoryRoot);
  if (result.status !== 0) {
    throw new Error(`local branch inventory failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return parseLocalBranchRefs(result.stdout);
}

function listRemoteBranches(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  remote: string
): BranchRefObservation[] {
  const result = runInventoryCommand(ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'ls-remote', '--heads', remote
  ], repositoryRoot);
  if (result.status !== 0) {
    throw new Error(`remote branch inventory failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return parseRemoteHeadRefs(decodeBranchLifecycleChildStdout(result));
}

function listWorktrees(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  unknowns: string[]
): BranchWorktreeObservation[] {
  const result = runInventoryCommand(
    ctx,
    'git',
    ['worktree', 'list', '--porcelain', '-z'],
    repositoryRoot
  );
  if (result.status !== 0) {
    unknowns.push(`worktree inventory failed: ${decodeBranchLifecycleChildError(result)}`);
    return [];
  }

  return stableSortWorktrees(parseWorktreePorcelain(result.stdout).map((record) => {
    const worktreePath = resolveRealPath(record.path!);
    const status = runInventoryCommand(ctx, 'git', [
      '-C',
      worktreePath,
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all'
    ], repositoryRoot);
    if (status.status !== 0) {
      return {
        path: worktreePath,
        headSha: record.headSha,
        branch: record.branch,
        dirtyCount: null,
        untrackedCount: null,
        locked: record.locked,
        prunable: record.prunable,
        observation: 'unknown',
        reason: decodeBranchLifecycleChildError(status)
      };
    }
    const counts = countPorcelainStatus(status.stdout);
    return {
      path: worktreePath,
      headSha: record.headSha,
      branch: record.branch,
      dirtyCount: counts.dirtyCount,
      untrackedCount: counts.untrackedCount,
      locked: record.locked,
      prunable: record.prunable,
      observation: 'resolved',
      reason: null
    };
  }));
}

function listTargetLocalBranches(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  branches: readonly string[]
): BranchRefObservation[] {
  const result = runInventoryCommand(ctx, 'git', [
    'for-each-ref', '--format=%(refname:short)%00%(objectname)%00',
    ...branches.map((branch) => `refs/heads/${branch}`)
  ], repositoryRoot);
  if (result.status !== 0) {
    throw new Error(`target local branch inventory failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return parseLocalBranchRefs(result.stdout);
}

function listTargetRemoteBranches(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  remote: string,
  branches: readonly string[]
): BranchRefObservation[] {
  const result = runInventoryCommand(ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'ls-remote', '--heads', remote,
    ...branches.map((branch) => `refs/heads/${branch}`)
  ], repositoryRoot);
  if (result.status !== 0) {
    throw new Error(`target remote branch inventory failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return parseRemoteHeadRefs(decodeBranchLifecycleChildStdout(result));
}

function listCloseoutTargetWorktrees(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  targetBranch: string,
  unknowns: string[]
): BranchWorktreeObservation[] {
  const result = runInventoryCommand(ctx, 'git', ['worktree', 'list', '--porcelain', '-z'], repositoryRoot);
  if (result.status !== 0) {
    unknowns.push(`worktree registry inventory failed: ${decodeBranchLifecycleChildError(result)}`);
    return [];
  }
  return stableSortWorktrees(parseWorktreePorcelain(result.stdout).map((record) => ({
    path: resolveRealPath(record.path!),
    headSha: record.headSha,
    branch: record.branch,
    dirtyCount: null,
    untrackedCount: null,
    locked: record.locked,
    prunable: record.prunable,
    observation: 'unknown' as const,
    reason: record.branch === targetBranch
      ? 'target worktree registry binding blocks closeout without status inspection'
      : 'unrelated worktree status is outside the exact closeout target'
  })));
}

function remoteMarkerRequirement(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  repositoryFullName: string,
  baseSha: string
): BranchCloseoutReceiptObservation['requirement'] {
  const result = runInventoryCommand(ctx, 'gh', [
    'api',
    `/repos/${repositoryFullName}/contents/${BRANCH_CLOSEOUT_ENFORCEMENT_MARKER_PATH}?ref=${baseSha}`,
    '--silent'
  ], repositoryRoot);
  if (result.status === 0) return 'required';
  const error = decodeBranchLifecycleChildError(result);
  return /(?:HTTP\s+404|status\s+404|Not Found)/iu.test(error) ? 'not-required' : 'unknown';
}

function closeoutReceiptRequirement(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  repositoryFullName: string,
  pullRequest: BranchPullRequestObservation
): BranchCloseoutReceiptObservation['requirement'] {
  if (pullRequest.isCrossRepository) return 'not-required';
  if (pullRequest.baseSha === null || pullRequest.baseSha === undefined) return 'unknown';
  const commit = runInventoryCommand(
    ctx,
    'git',
    ['cat-file', '-e', `${pullRequest.baseSha}^{commit}`],
    repositoryRoot
  );
  if (commit.status !== 0) {
    return remoteMarkerRequirement(
      ctx,
      repositoryRoot,
      repositoryFullName,
      pullRequest.baseSha
    );
  }
  const marker = runInventoryCommand(
    ctx,
    'git',
    ['cat-file', '-e', `${pullRequest.baseSha}:${BRANCH_CLOSEOUT_ENFORCEMENT_MARKER_PATH}`],
    repositoryRoot
  );
  return marker.status === 0 ? 'required' : 'not-required';
}

function collaboratorPermission(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  repositoryFullName: string,
  author: string,
  cache: Map<string, { permission: CollaboratorPermission; reason: string | null }>
): { permission: CollaboratorPermission; reason: string | null } {
  const cached = cache.get(author);
  if (cached) return cached;
  const result = runInventoryCommand(ctx, 'gh', [
    'api',
    `/repos/${repositoryFullName}/collaborators/${author}/permission`,
    '--jq',
    '.role_name // .permission'
  ], repositoryRoot);
  if (result.status !== 0) {
    const observation = {
      permission: 'unknown' as const,
      reason: `collaborator permission for ${author} failed: ${decodeBranchLifecycleChildError(result)}`
    };
    cache.set(author, observation);
    return observation;
  }
  const role = decodeBranchLifecycleChildStdout(result).toLowerCase();
  const observation = {
    permission: role === 'admin' || role === 'maintain'
      ? 'trusted' as const
      : 'untrusted' as const,
    reason: null
  };
  cache.set(author, observation);
  return observation;
}

function loadCloseoutReceiptCommentCandidates(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  repositoryFullName: string,
  pullRequest: BranchPullRequestObservation
): { candidates: NonNullable<BranchPullRequestObservation['closeoutReceiptCommentCandidates']> | null; reason: string | null } {
  const existing = pullRequest.closeoutReceiptCommentCandidates ?? [];
  if (existing.length > 0) return { candidates: existing, reason: null };

  const result = runInventoryCommand(ctx, 'gh', [
    'api',
    '--paginate',
    '--slurp',
    `/repos/${repositoryFullName}/issues/${pullRequest.number}/comments?per_page=100`
  ], repositoryRoot);
  if (result.status !== 0) {
    return {
      candidates: null,
      reason: `comment inventory failed: ${decodeBranchLifecycleChildError(result)}`
    };
  }
  try {
    return {
      candidates: parseRestCloseoutReceiptCommentCandidates(
        decodeBranchLifecycleChildStdout(result),
        pullRequest.number
      ),
      reason: null
    };
  } catch (error) {
    return {
      candidates: null,
      reason: `comment inventory parse failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function bindCloseoutReceiptObservations(
  scope: Readonly<{ repositoryRoot: string }>,
  repositoryRoot: string,
  repositoryFullName: string,
  pullRequests: BranchPullRequestObservation[]
): BranchPullRequestObservation[] {
  const ctx: InventoryRuntime = scope;
  const permissionCache = new Map<
    string,
    { permission: CollaboratorPermission; reason: string | null }
  >();
  return pullRequests.map((pullRequest) => {
    const requirement = closeoutReceiptRequirement(
      ctx,
      repositoryRoot,
      repositoryFullName,
      pullRequest
    );
    if (requirement !== 'required') {
      return {
        ...pullRequest,
        publishedCloseoutReceipts: [],
        invalidCloseoutReceiptComments: [],
        closeoutReceipt: resolveBranchCloseoutReceiptObservation({
          repository: repositoryFullName,
          pullRequest,
          requirement
        })
      };
    }

    const commentInventory = loadCloseoutReceiptCommentCandidates(
      ctx,
      repositoryRoot,
      repositoryFullName,
      pullRequest
    );
    if (commentInventory.candidates === null) {
      return {
        ...pullRequest,
        publishedCloseoutReceipts: [],
        invalidCloseoutReceiptComments: [],
        closeoutReceipt: {
          requirement: 'required',
          status: 'unknown',
          receipt: null,
          reason: commentInventory.reason
        }
      };
    }

    const trustedBodies: string[] = [];
    const permissionFailures: string[] = [];
    for (const candidate of commentInventory.candidates) {
      const permission = collaboratorPermission(
        ctx,
        repositoryRoot,
        repositoryFullName,
        candidate.author,
        permissionCache
      );
      if (permission.permission === 'trusted') trustedBodies.push(candidate.body);
      else if (permission.permission === 'unknown') {
        permissionFailures.push(permission.reason ?? `permission for ${candidate.author} is unknown`);
      }
    }
    if (permissionFailures.length > 0) {
      return {
        ...pullRequest,
        publishedCloseoutReceipts: [],
        invalidCloseoutReceiptComments: [],
        closeoutReceipt: {
          requirement: 'required',
          status: 'unknown',
          receipt: null,
          reason: [...new Set(permissionFailures)].sort().join(' | ')
        }
      };
    }

    const parsed = parsePublishedBranchCloseoutReceiptComments(trustedBodies);
    const enriched: BranchPullRequestObservation = {
      ...pullRequest,
      closeoutReceiptCommentCandidates: commentInventory.candidates,
      publishedCloseoutReceipts: parsed.receipts,
      invalidCloseoutReceiptComments: parsed.invalid
    };
    return {
      ...enriched,
      closeoutReceipt: resolveBranchCloseoutReceiptObservation({
        repository: repositoryFullName,
        pullRequest: enriched,
        requirement
      })
    };
  });
}

function listPullRequests(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  repositoryFullName: string,
  physicalBranchIdentities: readonly Readonly<{ branch: string; headSha: string }>[],
  unknowns: string[]
): BranchPullRequestObservation[] {
  const result = runInventoryCommand(ctx, 'gh', [
    'pr',
    'list',
    '--repo',
    repositoryFullName,
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'number,headRefName,headRefOid,baseRefName,baseRefOid,state,isDraft,isCrossRepository,url'
  ], repositoryRoot);
  if (result.status !== 0) {
    unknowns.push(`PR inventory failed: ${decodeBranchLifecycleChildError(result)}`);
    return [];
  }
  try {
    const observations = parsePullRequestObservations(decodeBranchLifecycleChildStdout(result));
    if (observations.length >= 1000) {
      unknowns.push('PR inventory reached its bounded 1000-item limit');
    }
    const relevant = selectBranchLifecyclePullRequests(
      observations,
      physicalBranchIdentities
    );
    return bindCloseoutReceiptObservations(
      ctx,
      repositoryRoot,
      repositoryFullName,
      relevant
    );
  } catch (error) {
    unknowns.push(
      `PR inventory parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function bindActiveWorkPackageObservation(
  observation: ActiveWorkPackageOwnerObservation | undefined,
  repositoryFullName: string,
  defaultBranch: string,
  remoteDefaultSha: string | null,
  unknowns: string[]
): BranchActiveWorkPackageObservation {
  const unresolved = (reason: string): BranchActiveWorkPackageObservation => ({
    state: 'unresolved',
    branch: null,
    manifest: null,
    reason
  });
  if (observation === undefined) {
    const reason = 'active-work-owner-observation-unavailable';
    unknowns.push(reason);
    return unresolved(reason);
  }
  if (observation.repository !== repositoryFullName) {
    const reason = 'active-work-owner-observation-repository-mismatch';
    unknowns.push(reason);
    return unresolved(reason);
  }
  if (observation.defaultBranch !== defaultBranch) {
    const reason = 'active-work-owner-observation-default-branch-mismatch';
    unknowns.push(reason);
    return unresolved(reason);
  }
  if (observation.defaultSha !== null && observation.defaultSha !== remoteDefaultSha) {
    const reason = 'active-work-owner-observation-default-sha-mismatch';
    unknowns.push(reason);
    return unresolved(reason);
  }
  if (observation.state === 'active') {
    if (observation.branch === null || observation.manifest === null || observation.reason !== null) {
      const reason = 'active-work-owner-observation-invalid-active-shape';
      unknowns.push(reason);
      return unresolved(reason);
    }
    try {
      assertGitBranchName(observation.branch, 'active Work Package branch');
    } catch {
      const reason = 'active-work-owner-observation-invalid-branch';
      unknowns.push(reason);
      return unresolved(reason);
    }
  } else if (observation.branch !== null || observation.manifest !== null || observation.reason === null) {
    const reason = 'active-work-owner-observation-invalid-terminal-shape';
    unknowns.push(reason);
    return unresolved(reason);
  }
  return {
    state: observation.state,
    branch: observation.branch,
    manifest: observation.manifest,
    reason: observation.reason
  };
}

function resolveRepositorySetting(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  repositoryFullName: string
): BranchRepositorySettingObservation {
  const result = runInventoryCommand(ctx, 'gh', [
    'api',
    `/repos/${repositoryFullName}`,
    '--jq',
    '.delete_branch_on_merge'
  ], repositoryRoot);
  if (result.status !== 0) {
    return {
      observation: 'unknown',
      deleteBranchOnMerge: null,
      reason: decodeBranchLifecycleChildError(result)
    };
  }
  const value = decodeBranchLifecycleChildStdout(result);
  if (value !== 'true' && value !== 'false') {
    return {
      observation: 'unknown',
      deleteBranchOnMerge: null,
      reason: `unexpected setting value: ${value}`
    };
  }
  return {
    observation: 'resolved',
    deleteBranchOnMerge: value === 'true',
    reason: null
  };
}

function readBooleanConfig(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  key: string
): boolean | null {
  const result = runInventoryCommand(ctx, 'git', ['config', '--local', '--bool', '--get', key], repositoryRoot);
  if (result.status !== 0) return null;
  const value = decodeBranchLifecycleChildStdout(result).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function resolvePruneConfiguration(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  remote: string
): BranchPruneConfigurationObservation {
  return {
    observation: 'resolved',
    fetchPrune: readBooleanConfig(ctx, repositoryRoot, 'fetch.prune'),
    remotePrune: readBooleanConfig(ctx, repositoryRoot, `remote.${remote}.prune`),
    fetchPruneTags: readBooleanConfig(ctx, repositoryRoot, 'fetch.pruneTags'),
    reason: null
  };
}

/**
 * Fresh execution fence for one closed-unmerged target. The provider supplies
 * the authenticated exact PR; this owner independently re-observes mutable
 * local and remote Git facts without scanning unrelated PRs or worktree files.
 */
export function collectBranchLifecycleCloseoutTargetInventory(
  input: Readonly<BranchLifecycleCloseoutTargetScope>
): BranchLifecycleInventory {
  assertGitBranchName(input.targetBranch, 'closeout target branch');
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber < 1) {
    throw new Error('closeout target pull request number must be a positive safe integer');
  }
  const activeWorkPackageObservation = input.activeWorkPackageObservation === undefined
    ? undefined
    : requireActiveWorkPackageOwnerObservation(input.activeWorkPackageObservation);
  const ctx: InventoryRuntime = { ...input, activeWorkPackageObservation };
  const unknowns: string[] = [];
  const repositoryRoot = resolveRepositoryRoot(ctx);
  const commonDir = resolveCommonDir(ctx, repositoryRoot);
  const remote = ctx.remote ?? DEFAULT_REMOTE;
  assertGitBranchName(remote, 'remote name');
  const remoteUrl = resolveRemoteUrl(ctx, repositoryRoot, remote);
  const fullName = resolveRepositoryFullName(ctx, repositoryRoot, remoteUrl, unknowns);
  const defaultBranch = resolveDefaultBranch(ctx, repositoryRoot, remote, unknowns);
  const preparedRepository = input.preparedInventory.repository;
  if (preparedRepository.root !== repositoryRoot
    || preparedRepository.commonDir !== commonDir
    || preparedRepository.fullName !== fullName
    || preparedRepository.remote !== remote
    || preparedRepository.remoteUrl !== remoteUrl
    || preparedRepository.defaultBranch !== defaultBranch) {
    throw new Error('target-scoped closeout repository identity differs from preparation');
  }

  const exactPullRequest = structuredClone(input.exactPullRequest);
  if (exactPullRequest.number !== input.pullRequestNumber
    || exactPullRequest.headBranch !== input.targetBranch
    || exactPullRequest.state !== 'closed'
    || exactPullRequest.headSha === null
    || exactPullRequest.baseBranch !== defaultBranch
    || exactPullRequest.baseSha === null
    || exactPullRequest.baseSha === undefined
    || exactPullRequest.isCrossRepository
    || exactPullRequest.url !== `https://github.com/${fullName}/pull/${input.pullRequestNumber}`) {
    throw new Error('authenticated exact PR observation differs from the closeout target');
  }
  assertGitSha(exactPullRequest.headSha, 'authenticated exact PR head');
  assertGitSha(exactPullRequest.baseSha, 'authenticated exact PR base');
  const branches = [...new Set([defaultBranch, input.targetBranch])];
  let localBranches: BranchRefObservation[] = [];
  let remoteBranches: BranchRefObservation[] = [];
  try {
    localBranches = listTargetLocalBranches(ctx, repositoryRoot, branches);
  } catch (error) {
    unknowns.push(error instanceof Error ? error.message : String(error));
  }
  try {
    remoteBranches = listTargetRemoteBranches(ctx, repositoryRoot, remote, branches);
  } catch (error) {
    unknowns.push(error instanceof Error ? error.message : String(error));
  }
  const worktrees = listCloseoutTargetWorktrees(ctx, repositoryRoot, input.targetBranch, unknowns);
  const remoteDefaultSha = remoteBranches.find(({ branch }) => branch === defaultBranch)?.sha ?? null;
  const activeWorkPackage = bindActiveWorkPackageObservation(
    ctx.activeWorkPackageObservation, fullName, defaultBranch, remoteDefaultSha, unknowns
  );
  return {
    schema: BRANCH_LIFECYCLE_INVENTORY_SCHEMA,
    observedAt: new Date().toISOString(),
    repository: { root: repositoryRoot, commonDir, fullName, remote, remoteUrl, defaultBranch },
    main: {
      localSha: localBranches.find(({ branch }) => branch === defaultBranch)?.sha ?? null,
      remoteSha: remoteDefaultSha
    },
    localBranches,
    remoteBranches,
    worktrees,
    pullRequests: [exactPullRequest],
    activeWorkPackage,
    repositorySetting: structuredClone(input.preparedInventory.repositorySetting),
    pruneConfiguration: structuredClone(input.preparedInventory.pruneConfiguration),
    unknowns: [...new Set(unknowns)].sort((left, right) => left.localeCompare(right))
  };
}

export function collectBranchLifecycleInventory(
  input: Readonly<BranchLifecycleInventoryScope>
): BranchLifecycleInventory {
  const activeWorkPackageObservation = input.activeWorkPackageObservation === undefined
    ? undefined
    : requireActiveWorkPackageOwnerObservation(input.activeWorkPackageObservation);
  const ctx: InventoryRuntime = { ...input, activeWorkPackageObservation };
  const unknowns: string[] = [];
  const repositoryRoot = resolveRepositoryRoot(ctx);
  const commonDir = resolveCommonDir(ctx, repositoryRoot);
  const remote = ctx.remote ?? DEFAULT_REMOTE;
  assertGitBranchName(remote, 'remote name');
  const remoteUrl = resolveRemoteUrl(ctx, repositoryRoot, remote);
  const fullName = resolveRepositoryFullName(ctx, repositoryRoot, remoteUrl, unknowns);
  const defaultBranch = resolveDefaultBranch(ctx, repositoryRoot, remote, unknowns);

  let localBranches: BranchRefObservation[] = [];
  let remoteBranches: BranchRefObservation[] = [];
  try {
    localBranches = listLocalBranches(ctx, repositoryRoot);
  } catch (error) {
    unknowns.push(error instanceof Error ? error.message : String(error));
  }
  try {
    remoteBranches = listRemoteBranches(ctx, repositoryRoot, remote);
  } catch (error) {
    unknowns.push(error instanceof Error ? error.message : String(error));
  }

  const worktrees = listWorktrees(ctx, repositoryRoot, unknowns);
  const physicalBranchIdentities = [
    ...localBranches.map(({ branch, sha }) => ({ branch, headSha: sha })),
    ...remoteBranches.map(({ branch, sha }) => ({ branch, headSha: sha })),
    ...worktrees.flatMap(({ branch, headSha }) => (
      branch === null || headSha === null ? [] : [{ branch, headSha }]
    ))
  ];
  const pullRequests = fullName.startsWith('<unknown>')
    ? []
    : listPullRequests(ctx, repositoryRoot, fullName, physicalBranchIdentities, unknowns);
  const activeWorkPackage = bindActiveWorkPackageObservation(
    ctx.activeWorkPackageObservation,
    fullName,
    defaultBranch,
    remoteBranches.find(({ branch }) => branch === defaultBranch)?.sha ?? null,
    unknowns
  );
  const repositorySetting: BranchRepositorySettingObservation = fullName.startsWith('<unknown>')
    ? {
        observation: 'unknown',
        deleteBranchOnMerge: null,
        reason: 'repository full name unresolved'
      }
    : resolveRepositorySetting(ctx, repositoryRoot, fullName);
  const pruneConfiguration = resolvePruneConfiguration(ctx, repositoryRoot, remote);

  return {
    schema: BRANCH_LIFECYCLE_INVENTORY_SCHEMA,
    observedAt: new Date().toISOString(),
    repository: {
      root: repositoryRoot,
      commonDir,
      fullName,
      remote,
      remoteUrl,
      defaultBranch
    },
    main: {
      localSha: localBranches.find(({ branch }) => branch === defaultBranch)?.sha ?? null,
      remoteSha: remoteBranches.find(({ branch }) => branch === defaultBranch)?.sha ?? null
    },
    localBranches,
    remoteBranches,
    worktrees,
    pullRequests,
    activeWorkPackage,
    repositorySetting,
    pruneConfiguration,
    unknowns: [...new Set(unknowns)].sort((left, right) => left.localeCompare(right))
  };
}
