import { realpathSync } from 'node:fs';
import path from 'node:path';

import {
  BRANCH_LIFECYCLE_INVENTORY_SCHEMA_V1,
  assertGitBranchName,
  type BranchActiveWorkPackageObservation,
  type BranchLifecycleInventory,
  type BranchPruneConfigurationObservation,
  type BranchPullRequestObservation,
  type BranchRefObservation,
  type BranchRepositorySettingObservation,
  type BranchWorktreeObservation
} from './branch-lifecycle-contract.ts';
import {
  commandErrorText,
  commandText,
  optionalBranchCommandText,
  requireBranchCommandText,
  runBranchCommand,
  type BranchLifecycleContext
} from './branch-lifecycle-command.ts';
import {
  countPorcelainStatus,
  parseControlPlane,
  parseLocalBranchRefs,
  parsePullRequestObservations,
  parseRemoteHeadRefs,
  parseWorktreePorcelain
} from './branch-lifecycle-parsers.ts';

const DEFAULT_REMOTE = 'origin';

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

function resolveRepositoryRoot(ctx: BranchLifecycleContext): string {
  return resolveRealPath(requireBranchCommandText(
    ctx,
    'git',
    ['rev-parse', '--show-toplevel'],
    'repository root discovery'
  ));
}

function resolveCommonDir(ctx: BranchLifecycleContext, repositoryRoot: string): string {
  const raw = requireBranchCommandText(
    ctx,
    'git',
    ['rev-parse', '--git-common-dir'],
    'git common-dir discovery',
    repositoryRoot
  );
  return resolveRealPath(path.isAbsolute(raw) ? raw : path.resolve(repositoryRoot, raw));
}

function resolveRemoteUrl(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  remote: string
): string {
  return requireBranchCommandText(
    ctx,
    'git',
    ['remote', 'get-url', remote],
    `remote ${remote} URL discovery`,
    repositoryRoot
  );
}

function resolveRepositoryFullName(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  remoteUrl: string,
  unknowns: string[]
): string {
  if (ctx.repositoryFullName) return ctx.repositoryFullName;
  const fromRemote = parseRepositoryFullName(remoteUrl);
  if (fromRemote !== null) return fromRemote;
  const fromGh = optionalBranchCommandText(
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
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  remote: string,
  unknowns: string[]
): string {
  if (ctx.defaultBranch) {
    assertGitBranchName(ctx.defaultBranch, 'default branch');
    return ctx.defaultBranch;
  }
  const symbolic = optionalBranchCommandText(
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
  const fromGh = optionalBranchCommandText(
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
  ctx: BranchLifecycleContext,
  repositoryRoot: string
): BranchRefObservation[] {
  const result = runBranchCommand(ctx, 'git', [
    'for-each-ref',
    '--format=%(refname:short)%00%(objectname)%00',
    'refs/heads'
  ], repositoryRoot);
  if (result.status !== 0) {
    throw new Error(`local branch inventory failed: ${commandErrorText(result)}`);
  }
  return parseLocalBranchRefs(result.stdout);
}

function listRemoteBranches(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  remote: string
): BranchRefObservation[] {
  const result = runBranchCommand(ctx, 'git', ['ls-remote', '--heads', remote], repositoryRoot);
  if (result.status !== 0) {
    throw new Error(`remote branch inventory failed: ${commandErrorText(result)}`);
  }
  return parseRemoteHeadRefs(commandText(result));
}

function listWorktrees(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  unknowns: string[]
): BranchWorktreeObservation[] {
  const result = runBranchCommand(
    ctx,
    'git',
    ['worktree', 'list', '--porcelain', '-z'],
    repositoryRoot
  );
  if (result.status !== 0) {
    unknowns.push(`worktree inventory failed: ${commandErrorText(result)}`);
    return [];
  }

  return stableSortWorktrees(parseWorktreePorcelain(result.stdout).map((record) => {
    const worktreePath = resolveRealPath(record.path!);
    const status = runBranchCommand(ctx, 'git', [
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
        reason: commandErrorText(status)
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

function listPullRequests(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  repositoryFullName: string,
  unknowns: string[]
): BranchPullRequestObservation[] {
  const result = runBranchCommand(ctx, 'gh', [
    'pr',
    'list',
    '--repo',
    repositoryFullName,
    '--state',
    'all',
    '--limit',
    '1000',
    '--json',
    'number,headRefName,headRefOid,baseRefName,state,isDraft,url'
  ], repositoryRoot);
  if (result.status !== 0) {
    unknowns.push(`PR inventory failed: ${commandErrorText(result)}`);
    return [];
  }
  try {
    const observations = parsePullRequestObservations(commandText(result));
    if (observations.length >= 1000) {
      unknowns.push('PR inventory reached its bounded 1000-item limit');
    }
    return observations;
  } catch (error) {
    unknowns.push(
      `PR inventory parse failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function resolveActiveWorkPackage(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  defaultBranch: string,
  unknowns: string[]
): BranchActiveWorkPackageObservation {
  const result = runBranchCommand(ctx, 'bun', [
    'scripts/codex/document-control-plane.ts',
    'status',
    '--json'
  ], repositoryRoot);
  if (result.stdout.length > 0) {
    try {
      const observation = parseControlPlane(commandText(result), defaultBranch);
      if (result.status !== 0) {
        unknowns.push(`control-plane resolver exited non-zero: ${commandErrorText(result)}`);
      }
      return observation;
    } catch (error) {
      unknowns.push(
        `control-plane parse failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    unknowns.push(`control-plane resolver failed: ${commandErrorText(result)}`);
  }
  return {
    state: 'unresolved',
    branch: null,
    manifest: null,
    reason: 'live control-plane resolver unavailable'
  };
}

function resolveRepositorySetting(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  repositoryFullName: string
): BranchRepositorySettingObservation {
  const result = runBranchCommand(ctx, 'gh', [
    'api',
    `/repos/${repositoryFullName}`,
    '--jq',
    '.delete_branch_on_merge'
  ], repositoryRoot);
  if (result.status !== 0) {
    return {
      observation: 'unknown',
      deleteBranchOnMerge: null,
      reason: commandErrorText(result)
    };
  }
  const value = commandText(result);
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
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  key: string
): boolean | null {
  const result = runBranchCommand(ctx, 'git', ['config', '--bool', '--get', key], repositoryRoot);
  if (result.status !== 0) return null;
  const value = commandText(result).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function resolvePruneConfiguration(
  ctx: BranchLifecycleContext,
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
  ctx: BranchLifecycleContext
): BranchLifecycleInventory {
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
