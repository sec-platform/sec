import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';

import {
  BRANCH_CLOSEOUT_ENFORCEMENT_MARKER_PATH,
  parsePublishedBranchCloseoutReceiptComments,
  resolveBranchCloseoutReceiptObservation
} from './branch-closeout-receipt.ts';
import {
  createBranchLifecycleGitChildEnvironmentV1,
  createBranchLifecycleGitHubCredentialArgsV1,
  decodeBranchLifecycleChildErrorV1,
  decodeBranchLifecycleChildStdoutV1
} from './branch-lifecycle-command.ts';
import {
  BRANCH_LIFECYCLE_INVENTORY_SCHEMA_V1,
  assertGitBranchName,
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
  parseControlPlane,
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

interface InventoryRuntime {
  readonly repositoryRoot: string;
  readonly remote?: string;
  readonly repositoryFullName?: string;
  readonly defaultBranch?: string;
}

function runInventoryCommand(
  ctx: InventoryRuntime,
  command: 'bun' | 'gh' | 'git',
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
        ? createBranchLifecycleGitChildEnvironmentV1(process.env)
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
  command: 'bun' | 'gh' | 'git',
  args: readonly string[],
  label: string,
  cwd = ctx.repositoryRoot
): string {
  const result = runInventoryCommand(ctx, command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
  }
  return decodeBranchLifecycleChildStdoutV1(result);
}

function optionalInventoryCommandText(
  ctx: InventoryRuntime,
  command: 'bun' | 'gh' | 'git',
  args: readonly string[],
  cwd = ctx.repositoryRoot
): string | null {
  const result = runInventoryCommand(ctx, command, args, cwd);
  return result.status === 0 ? decodeBranchLifecycleChildStdoutV1(result) : null;
}

function stableSortWorktrees(entries: BranchWorktreeObservation[]): BranchWorktreeObservation[] {
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function parseRepositoryFullName(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim().replace(/\.git$/u, '');
  const match = /(?:github\.com[/:])([^/\s:]+)\/([^/\s]+)$/iu.exec(normalized);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function resolveRealPath(value: string): string {
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
  if (ctx.repositoryFullName) return ctx.repositoryFullName;
  const fromRemote = parseRepositoryFullName(remoteUrl);
  if (fromRemote !== null) return fromRemote;
  const fromGh = optionalInventoryCommandText(
    ctx,
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    repositoryRoot
  );
  if (fromGh !== null && /^[^/\s]+\/[^/\s]+$/u.test(fromGh)) return fromGh;
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
    throw new Error(`local branch inventory failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
  }
  return parseLocalBranchRefs(result.stdout);
}

function listRemoteBranches(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  remote: string
): BranchRefObservation[] {
  const result = runInventoryCommand(ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgsV1(),
    'ls-remote', '--heads', remote
  ], repositoryRoot);
  if (result.status !== 0) {
    throw new Error(`remote branch inventory failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
  }
  return parseRemoteHeadRefs(decodeBranchLifecycleChildStdoutV1(result));
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
    unknowns.push(`worktree inventory failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
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
        reason: decodeBranchLifecycleChildErrorV1(status)
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
  const error = decodeBranchLifecycleChildErrorV1(result);
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
      reason: `collaborator permission for ${author} failed: ${decodeBranchLifecycleChildErrorV1(result)}`
    };
    cache.set(author, observation);
    return observation;
  }
  const role = decodeBranchLifecycleChildStdoutV1(result).toLowerCase();
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
      reason: `comment inventory failed: ${decodeBranchLifecycleChildErrorV1(result)}`
    };
  }
  try {
    return {
      candidates: parseRestCloseoutReceiptCommentCandidates(
        decodeBranchLifecycleChildStdoutV1(result),
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

export function bindCloseoutReceiptObservations(
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
    unknowns.push(`PR inventory failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
    return [];
  }
  try {
    const observations = parsePullRequestObservations(decodeBranchLifecycleChildStdoutV1(result));
    if (observations.length >= 1000) {
      unknowns.push('PR inventory reached its bounded 1000-item limit');
    }
    return bindCloseoutReceiptObservations(
      ctx,
      repositoryRoot,
      repositoryFullName,
      observations
    );
  } catch (error) {
    unknowns.push(
      `PR inventory parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function resolveActiveWorkPackage(
  ctx: InventoryRuntime,
  repositoryRoot: string,
  defaultBranch: string,
  unknowns: string[]
): BranchActiveWorkPackageObservation {
  const result = runInventoryCommand(ctx, 'bun', [
    'scripts/codex/document-control-plane.ts',
    'status',
    '--json'
  ], repositoryRoot);
  if (result.stdout.length > 0) {
    try {
      const observation = parseControlPlane(decodeBranchLifecycleChildStdoutV1(result), defaultBranch);
      if (result.status !== 0) {
        unknowns.push(`control-plane resolver exited non-zero: ${decodeBranchLifecycleChildErrorV1(result)}`);
      }
      return observation;
    } catch (error) {
      unknowns.push(
        `control-plane parse failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    unknowns.push(`control-plane resolver failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
  }
  return {
    state: 'unresolved',
    branch: null,
    manifest: null,
    reason: 'live control-plane resolver unavailable'
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
      reason: decodeBranchLifecycleChildErrorV1(result)
    };
  }
  const value = decodeBranchLifecycleChildStdoutV1(result);
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
  const value = decodeBranchLifecycleChildStdoutV1(result).toLowerCase();
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

export function collectBranchLifecycleInventory(
  input: Readonly<{
    repositoryRoot: string;
    remote?: string;
    repositoryFullName?: string;
    defaultBranch?: string;
  }>
): BranchLifecycleInventory {
  const ctx: InventoryRuntime = input;
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
  const pullRequests = fullName.startsWith('<unknown>')
    ? []
    : listPullRequests(ctx, repositoryRoot, fullName, unknowns);
  const activeWorkPackage = resolveActiveWorkPackage(
    ctx,
    repositoryRoot,
    defaultBranch,
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
    schema: BRANCH_LIFECYCLE_INVENTORY_SCHEMA_V1,
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
