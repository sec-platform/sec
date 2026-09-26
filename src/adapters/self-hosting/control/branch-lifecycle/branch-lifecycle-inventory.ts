import { realpathSync } from 'node:fs';
import path from 'node:path';

import { parseGitHubRepositoryIdentityFromRemoteUrl } from '../../../../contracts/git-reference.ts';
import {
  executeGitHubApiOperation,
  withGitHubApiReadSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import type { GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import {
  GIT_READ_OPERATION_BUDGET,
  runGitRead
} from '../../development/tooling/git/git-read.ts';

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
  parseRestCloseoutReceiptCommentCandidates,
  parseWorktreePorcelain
} from './branch-lifecycle-parsers.ts';

const DEFAULT_REMOTE = 'origin';
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
type InventoryCommandResult = Readonly<{
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
}>;

async function runInventoryGit(
  session: GitReadSession,
  args: readonly string[]
): Promise<InventoryCommandResult> {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('Branch inventory argument contains NUL.');
  }
  const result = await runGitRead(session, args, { maxBuffer: GIT_READ_OPERATION_BUDGET.maxCommandStdoutBytes });
  return Object.freeze({
    status: result.status,
    stdout: result.stdout,
    stderr: result.error === undefined ? result.stderr : Buffer.from(result.error.message, 'utf8')
  });
}

async function requireInventoryGitText(
  session: GitReadSession,
  args: readonly string[],
  label: string
): Promise<string> {
  const result = await runInventoryGit(session, args);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return decodeBranchLifecycleChildStdout(result);
}

async function optionalInventoryGitText(
  session: GitReadSession,
  args: readonly string[]
): Promise<string | null> {
  const result = await runInventoryGit(session, args);
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

async function resolveRepositoryRoot(session: GitReadSession): Promise<string> {
  return resolveRealPath(await requireInventoryGitText(
    session,
    ['rev-parse', '--show-toplevel'],
    'repository root discovery'
  ));
}

async function resolveCommonDir(session: GitReadSession, repositoryRoot: string): Promise<string> {
  const raw = await requireInventoryGitText(
    session,
    ['rev-parse', '--git-common-dir'],
    'git common-dir discovery'
  );
  return resolveRealPath(path.isAbsolute(raw) ? raw : path.resolve(repositoryRoot, raw));
}

async function resolveRemoteUrl(
  session: GitReadSession,
  remote: string
): Promise<string> {
  return await requireInventoryGitText(
    session,
    ['remote', 'get-url', remote],
    `remote ${remote} URL discovery`
  );
}

function resolveRepositoryFullName(
  ctx: InventoryRuntime,
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
  if (ctx.repositoryFullName !== undefined
      && parseGitHubRepositoryIdentityFromRemoteUrl(`https://github.com/${ctx.repositoryFullName}.git`)
        === ctx.repositoryFullName) {
    return ctx.repositoryFullName;
  }
  unknowns.push('repository full name could not be resolved from remote URL or supplied identity');
  return '<unknown>/<unknown>';
}

async function resolveDefaultBranch(
  ctx: InventoryRuntime,
  git: GitReadSession,
  github: GitHubApiCapability | null,
  remote: string,
  unknowns: string[]
): Promise<string> {
  if (ctx.defaultBranch) {
    assertGitBranchName(ctx.defaultBranch, 'default branch');
    return ctx.defaultBranch;
  }
  const symbolic = await optionalInventoryGitText(
    git,
    ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`]
  );
  if (symbolic?.startsWith(`${remote}/`)) {
    const branch = symbolic.slice(remote.length + 1);
    assertGitBranchName(branch, 'default branch');
    return branch;
  }
  if (github !== null) {
    const repository = await executeGitHubApiOperation(github, { kind: 'repository' });
    if (repository && typeof repository === 'object' && !Array.isArray(repository)) {
      const fromProvider = (repository as Record<string, unknown>).default_branch;
      if (typeof fromProvider === 'string') {
        assertGitBranchName(fromProvider, 'default branch');
        return fromProvider;
      }
    }
  }
  unknowns.push('default branch could not be resolved; temporary fallback `main` is untrusted');
  return 'main';
}

async function listLocalBranches(
  git: GitReadSession
): Promise<BranchRefObservation[]> {
  const result = await runInventoryGit(git, [
    'for-each-ref',
    '--format=%(refname:short)%00%(objectname)%00',
    'refs/heads'
  ]);
  if (result.status !== 0) {
    throw new Error(`local branch inventory failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return parseLocalBranchRefs(result.stdout);
}

function parseRemoteBranchesFromGitHub(value: unknown): BranchRefObservation[] {
  if (!Array.isArray(value)) throw new Error('remote branch inventory must be an array');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`remote branch inventory entry ${index} is invalid`);
    }
    const record = entry as Record<string, unknown>;
    const ref = record.ref;
    const object = record.object;
    if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')
        || !object || typeof object !== 'object' || Array.isArray(object)) {
      throw new Error(`remote branch inventory entry ${index} has invalid identity`);
    }
    const branch = ref.slice('refs/heads/'.length);
    const sha = (object as Record<string, unknown>).sha;
    assertGitBranchName(branch, `remote branch[${index}]`);
    if (typeof sha !== 'string') throw new Error(`remote branch[${index}] SHA is invalid`);
    assertGitSha(sha, `remote branch[${index}] SHA`);
    return { branch, sha };
  }).sort((left, right) => left.branch.localeCompare(right.branch));
}

async function listRemoteBranches(
  github: GitHubApiCapability
): Promise<BranchRefObservation[]> {
  const branches: BranchRefObservation[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = parseRemoteBranchesFromGitHub(
      await executeGitHubApiOperation(github, { kind: 'matching-head-refs', page })
    );
    branches.push(...batch);
    if (batch.length < 100) break;
  }
  return branches.sort((left, right) => left.branch.localeCompare(right.branch));
}

async function listWorktrees(
  git: GitReadSession,
  unknowns: string[]
): Promise<BranchWorktreeObservation[]> {
  const result = await runInventoryGit(git, ['worktree', 'list', '--porcelain', '-z']);
  if (result.status !== 0) {
    unknowns.push(`worktree inventory failed: ${decodeBranchLifecycleChildError(result)}`);
    return [];
  }

  const worktrees: BranchWorktreeObservation[] = [];
  for (const record of parseWorktreePorcelain(result.stdout)) {
    const worktreePath = resolveRealPath(record.path!);
    let status: InventoryCommandResult;
    try {
      status = await withAuthorityGitReadSession({
        cwd: worktreePath,
        budget: GIT_READ_OPERATION_BUDGET
      }, async (worktreeGit) => await runInventoryGit(worktreeGit, [
        'status', '--porcelain=v1', '-z', '--untracked-files=all'
      ]));
    } catch (error) {
      worktrees.push({
        path: worktreePath,
        headSha: record.headSha,
        branch: record.branch,
        dirtyCount: null,
        untrackedCount: null,
        locked: record.locked,
        prunable: record.prunable,
        observation: 'unknown',
        reason: error instanceof Error ? error.message : String(error)
      });
      continue;
    }
    if (status.status !== 0) {
      worktrees.push({
        path: worktreePath,
        headSha: record.headSha,
        branch: record.branch,
        dirtyCount: null,
        untrackedCount: null,
        locked: record.locked,
        prunable: record.prunable,
        observation: 'unknown',
        reason: decodeBranchLifecycleChildError(status)
      });
      continue;
    }
    const counts = countPorcelainStatus(status.stdout);
    worktrees.push({
      path: worktreePath,
      headSha: record.headSha,
      branch: record.branch,
      dirtyCount: counts.dirtyCount,
      untrackedCount: counts.untrackedCount,
      locked: record.locked,
      prunable: record.prunable,
      observation: 'resolved',
      reason: null
    });
  }
  return stableSortWorktrees(worktrees);
}

async function listTargetLocalBranches(
  git: GitReadSession,
  branches: readonly string[]
): Promise<BranchRefObservation[]> {
  const observations: BranchRefObservation[] = [];
  for (const branch of branches) {
    const result = await runInventoryGit(git, [
      'for-each-ref', '--format=%(refname:short)%00%(objectname)%00', `refs/heads/${branch}`
    ]);
    if (result.status !== 0) {
      throw new Error(`target local branch inventory failed: ${decodeBranchLifecycleChildError(result)}`);
    }
    observations.push(...parseLocalBranchRefs(result.stdout));
  }
  return observations.sort((left, right) => left.branch.localeCompare(right.branch));
}

async function listTargetRemoteBranches(
  github: GitHubApiCapability,
  branches: readonly string[]
): Promise<BranchRefObservation[]> {
  const wanted = new Set(branches);
  return (await listRemoteBranches(github)).filter(({ branch }) => wanted.has(branch));
}

async function listCloseoutTargetWorktrees(
  git: GitReadSession,
  targetBranch: string,
  unknowns: string[]
): Promise<BranchWorktreeObservation[]> {
  const result = await runInventoryGit(git, ['worktree', 'list', '--porcelain', '-z']);
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

async function remoteMarkerRequirement(
  github: GitHubApiCapability,
  baseSha: string
): Promise<BranchCloseoutReceiptObservation['requirement']> {
  try {
    await executeGitHubApiOperation(github, {
      kind: 'repository-content', path: BRANCH_CLOSEOUT_ENFORCEMENT_MARKER_PATH, ref: baseSha
    });
    return 'required';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return /(?:HTTP\s+404|status\s+404|Not Found)/iu.test(message) ? 'not-required' : 'unknown';
  }
}

async function closeoutReceiptRequirement(
  git: GitReadSession,
  github: GitHubApiCapability,
  pullRequest: BranchPullRequestObservation
): Promise<BranchCloseoutReceiptObservation['requirement']> {
  if (pullRequest.isCrossRepository) return 'not-required';
  if (pullRequest.baseSha === null || pullRequest.baseSha === undefined) return 'unknown';
  const commit = await runInventoryGit(git, ['cat-file', '-e', `${pullRequest.baseSha}^{commit}`]);
  if (commit.status !== 0) {
    return await remoteMarkerRequirement(github, pullRequest.baseSha);
  }
  const marker = await runInventoryGit(git, [
    'cat-file', '-e', `${pullRequest.baseSha}:${BRANCH_CLOSEOUT_ENFORCEMENT_MARKER_PATH}`
  ]);
  return marker.status === 0 ? 'required' : 'not-required';
}

async function collaboratorPermission(
  github: GitHubApiCapability,
  author: string,
  cache: Map<string, { permission: CollaboratorPermission; reason: string | null }>
): Promise<{ permission: CollaboratorPermission; reason: string | null }> {
  const cached = cache.get(author);
  if (cached) return cached;
  let response: unknown;
  try {
    response = await executeGitHubApiOperation(github, { kind: 'collaborator-permission', login: author });
  } catch (error) {
    const observation = {
      permission: 'unknown' as const,
      reason: `collaborator permission for ${author} failed: ${error instanceof Error ? error.message : String(error)}`
    };
    cache.set(author, observation);
    return observation;
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    const observation = { permission: 'unknown' as const, reason: `collaborator permission for ${author} is invalid` };
    cache.set(author, observation);
    return observation;
  }
  const record = response as Record<string, unknown>;
  const rawRole = record.role_name ?? record.permission;
  const role = typeof rawRole === 'string' ? rawRole.toLowerCase() : '';
  const observation = {
    permission: role === 'admin' || role === 'maintain'
      ? 'trusted' as const
      : 'untrusted' as const,
    reason: null
  };
  cache.set(author, observation);
  return observation;
}

async function loadCloseoutReceiptCommentCandidates(
  github: GitHubApiCapability,
  pullRequest: BranchPullRequestObservation
): Promise<{ candidates: NonNullable<BranchPullRequestObservation['closeoutReceiptCommentCandidates']> | null; reason: string | null }> {
  const existing = pullRequest.closeoutReceiptCommentCandidates ?? [];
  if (existing.length > 0) return { candidates: existing, reason: null };
  try {
    const pages: unknown[] = [];
    for (let page = 1; page <= 100; page += 1) {
      const value = await executeGitHubApiOperation(github, { kind: 'issue-comments', issueNumber: pullRequest.number, page });
      if (!Array.isArray(value)) throw new Error('GitHub issue comments response must be an array');
      pages.push(value);
      if (value.length < 100) break;
    }
    return {
      candidates: parseRestCloseoutReceiptCommentCandidates(
        JSON.stringify(pages),
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

async function bindCloseoutReceiptObservations(
  git: GitReadSession,
  github: GitHubApiCapability,
  repositoryFullName: string,
  pullRequests: BranchPullRequestObservation[]
): Promise<BranchPullRequestObservation[]> {
  const permissionCache = new Map<
    string,
    { permission: CollaboratorPermission; reason: string | null }
  >();
  const observations: BranchPullRequestObservation[] = [];
  for (const pullRequest of pullRequests) {
    const requirement = await closeoutReceiptRequirement(git, github, pullRequest);
    if (requirement !== 'required') {
      observations.push({
        ...pullRequest,
        publishedCloseoutReceipts: [],
        invalidCloseoutReceiptComments: [],
        closeoutReceipt: resolveBranchCloseoutReceiptObservation({
          repository: repositoryFullName,
          pullRequest,
          requirement
        })
      });
      continue;
    }

    const commentInventory = await loadCloseoutReceiptCommentCandidates(github, pullRequest);
    if (commentInventory.candidates === null) {
      observations.push({
        ...pullRequest,
        publishedCloseoutReceipts: [],
        invalidCloseoutReceiptComments: [],
        closeoutReceipt: {
          requirement: 'required',
          status: 'unknown',
          receipt: null,
          reason: commentInventory.reason
        }
      });
      continue;
    }

    const trustedBodies: string[] = [];
    const permissionFailures: string[] = [];
    for (const candidate of commentInventory.candidates) {
      const permission = await collaboratorPermission(github, candidate.author, permissionCache);
      if (permission.permission === 'trusted') trustedBodies.push(candidate.body);
      else if (permission.permission === 'unknown') {
        permissionFailures.push(permission.reason ?? `permission for ${candidate.author} is unknown`);
      }
    }
    if (permissionFailures.length > 0) {
      observations.push({
        ...pullRequest,
        publishedCloseoutReceipts: [],
        invalidCloseoutReceiptComments: [],
        closeoutReceipt: {
          requirement: 'required',
          status: 'unknown',
          receipt: null,
          reason: [...new Set(permissionFailures)].sort().join(' | ')
        }
      });
      continue;
    }

    const parsed = parsePublishedBranchCloseoutReceiptComments(trustedBodies);
    const enriched: BranchPullRequestObservation = {
      ...pullRequest,
      closeoutReceiptCommentCandidates: commentInventory.candidates,
      publishedCloseoutReceipts: parsed.receipts,
      invalidCloseoutReceiptComments: parsed.invalid
    };
    observations.push({
      ...enriched,
      closeoutReceipt: resolveBranchCloseoutReceiptObservation({
        repository: repositoryFullName,
        pullRequest: enriched,
        requirement
      })
    });
  }
  return observations;
}

function parseRestPullRequestObservation(
  value: unknown,
  repositoryFullName: string,
  index: number
): BranchPullRequestObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`PR observation ${index} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const number = record.number;
  const head = record.head;
  const base = record.base;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0
      || !head || typeof head !== 'object' || Array.isArray(head)
      || !base || typeof base !== 'object' || Array.isArray(base)) {
    throw new Error(`PR observation ${index} has invalid identity.`);
  }
  const headRecord = head as Record<string, unknown>;
  const baseRecord = base as Record<string, unknown>;
  const headBranch = headRecord.ref;
  const headSha = headRecord.sha;
  const baseBranch = baseRecord.ref;
  const baseSha = baseRecord.sha;
  if (typeof headBranch !== 'string' || typeof headSha !== 'string'
      || typeof baseBranch !== 'string' || typeof baseSha !== 'string') {
    throw new Error(`PR #${number} branch/commit identity is invalid.`);
  }
  assertGitBranchName(headBranch, `PR #${number} head branch`);
  assertGitBranchName(baseBranch, `PR #${number} base branch`);
  assertGitSha(headSha, `PR #${number} head SHA`);
  assertGitSha(baseSha, `PR #${number} base SHA`);
  const headRepository = headRecord.repo;
  const headFullName = headRepository && typeof headRepository === 'object' && !Array.isArray(headRepository)
    ? (headRepository as Record<string, unknown>).full_name
    : null;
  const state = record.merged_at !== null && record.merged_at !== undefined
    ? 'merged' as const
    : record.state === 'open' ? 'open' as const : 'closed' as const;
  return {
    number,
    headBranch,
    headSha,
    baseBranch,
    baseSha,
    state,
    isDraft: record.draft === true,
    isCrossRepository: typeof headFullName === 'string' ? headFullName !== repositoryFullName : true,
    url: typeof record.html_url === 'string' ? record.html_url : null,
    closeoutReceiptCommentCandidates: [],
    publishedCloseoutReceipts: [],
    invalidCloseoutReceiptComments: []
  };
}

async function listPullRequests(
  git: GitReadSession,
  github: GitHubApiCapability,
  repositoryFullName: string,
  physicalBranchIdentities: readonly Readonly<{ branch: string; headSha: string }>[],
  unknowns: string[]
): Promise<BranchPullRequestObservation[]> {
  try {
    const raw: unknown[] = [];
    for (const kind of ['open-pulls-page', 'merged-pulls'] as const) {
      for (let page = 1; page <= 10; page += 1) {
        const value = await executeGitHubApiOperation(github, { kind, page });
        if (!Array.isArray(value)) throw new Error(`${kind} response must be an array`);
        raw.push(...value);
        if (value.length < 100) break;
      }
    }
    const observations = raw.map((value, index) =>
      parseRestPullRequestObservation(value, repositoryFullName, index)
    );
    if (observations.length >= 1000) {
      unknowns.push('PR inventory reached its bounded 1000-item limit');
    }
    const relevant = selectBranchLifecyclePullRequests(
      observations,
      physicalBranchIdentities
    );
    return await bindCloseoutReceiptObservations(
      git,
      github,
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

async function resolveRepositorySetting(
  github: GitHubApiCapability
): Promise<BranchRepositorySettingObservation> {
  let value: unknown;
  try {
    value = await executeGitHubApiOperation(github, { kind: 'repository' });
  } catch (error) {
    return {
      observation: 'unknown',
      deleteBranchOnMerge: null,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  const setting = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>).delete_branch_on_merge
    : null;
  if (typeof setting !== 'boolean') {
    return {
      observation: 'unknown',
      deleteBranchOnMerge: null,
      reason: 'repository delete_branch_on_merge setting is invalid'
    };
  }
  return {
    observation: 'resolved',
    deleteBranchOnMerge: setting,
    reason: null
  };
}

async function readBooleanConfig(
  git: GitReadSession,
  key: string
): Promise<boolean | null> {
  const result = await runInventoryGit(git, ['config', '--local', '--bool', '--get', key]);
  if (result.status !== 0) return null;
  const value = decodeBranchLifecycleChildStdout(result).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

async function resolvePruneConfiguration(
  git: GitReadSession,
  remote: string
): Promise<BranchPruneConfigurationObservation> {
  return {
    observation: 'resolved',
    fetchPrune: await readBooleanConfig(git, 'fetch.prune'),
    remotePrune: await readBooleanConfig(git, `remote.${remote}.prune`),
    fetchPruneTags: await readBooleanConfig(git, 'fetch.pruneTags'),
    reason: null
  };
}

/**
 * Fresh execution fence for one closed-unmerged target. The provider supplies
 * the authenticated exact PR; this owner independently re-observes mutable
 * local and remote Git facts without scanning unrelated PRs or worktree files.
 */
export async function collectBranchLifecycleCloseoutTargetInventory(
  input: Readonly<BranchLifecycleCloseoutTargetScope>
): Promise<BranchLifecycleInventory> {
  assertGitBranchName(input.targetBranch, 'closeout target branch');
  if (!Number.isSafeInteger(input.pullRequestNumber) || input.pullRequestNumber < 1) {
    throw new Error('closeout target pull request number must be a positive safe integer');
  }
  const activeWorkPackageObservation = input.activeWorkPackageObservation === undefined
    ? undefined
    : requireActiveWorkPackageOwnerObservation(input.activeWorkPackageObservation);
  const ctx: InventoryRuntime = { ...input, activeWorkPackageObservation };
  return await withAuthorityGitReadSession({
    cwd: path.resolve(input.repositoryRoot),
    budget: GIT_READ_OPERATION_BUDGET
  }, async (git) => {
    const unknowns: string[] = [];
    const repositoryRoot = await resolveRepositoryRoot(git);
    const commonDir = await resolveCommonDir(git, repositoryRoot);
    const remote = ctx.remote ?? DEFAULT_REMOTE;
    assertGitBranchName(remote, 'remote name');
    const remoteUrl = await resolveRemoteUrl(git, remote);
    const fullName = resolveRepositoryFullName(ctx, remoteUrl, unknowns);
    if (fullName.startsWith('<unknown>')) {
      throw new Error('target-scoped closeout requires one resolved GitHub repository identity');
    }
    return await withGitHubApiReadSession({ repositoryRoot, repository: fullName, operation: async (github) => {
      const defaultBranch = await resolveDefaultBranch(ctx, git, github, remote, unknowns);
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
        localBranches = await listTargetLocalBranches(git, branches);
      } catch (error) {
        unknowns.push(error instanceof Error ? error.message : String(error));
      }
      try {
        remoteBranches = await listTargetRemoteBranches(github, branches);
      } catch (error) {
        unknowns.push(error instanceof Error ? error.message : String(error));
      }
      const worktrees = await listCloseoutTargetWorktrees(git, input.targetBranch, unknowns);
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
    }});
  });
}

export async function collectBranchLifecycleInventory(
  input: Readonly<BranchLifecycleInventoryScope>
): Promise<BranchLifecycleInventory> {
  const activeWorkPackageObservation = input.activeWorkPackageObservation === undefined
    ? undefined
    : requireActiveWorkPackageOwnerObservation(input.activeWorkPackageObservation);
  const ctx: InventoryRuntime = { ...input, activeWorkPackageObservation };
  return await withAuthorityGitReadSession({
    cwd: path.resolve(input.repositoryRoot),
    budget: GIT_READ_OPERATION_BUDGET
  }, async (git) => {
    const unknowns: string[] = [];
    const repositoryRoot = await resolveRepositoryRoot(git);
    const commonDir = await resolveCommonDir(git, repositoryRoot);
    const remote = ctx.remote ?? DEFAULT_REMOTE;
    assertGitBranchName(remote, 'remote name');
    const remoteUrl = await resolveRemoteUrl(git, remote);
    const fullName = resolveRepositoryFullName(ctx, remoteUrl, unknowns);
    const collect = async (github: GitHubApiCapability | null): Promise<BranchLifecycleInventory> => {
      const defaultBranch = await resolveDefaultBranch(ctx, git, github, remote, unknowns);

  let localBranches: BranchRefObservation[] = [];
  let remoteBranches: BranchRefObservation[] = [];
  try {
    localBranches = await listLocalBranches(git);
  } catch (error) {
    unknowns.push(error instanceof Error ? error.message : String(error));
  }
  try {
    remoteBranches = github === null ? [] : await listRemoteBranches(github);
  } catch (error) {
    unknowns.push(error instanceof Error ? error.message : String(error));
  }

  const worktrees = await listWorktrees(git, unknowns);
  const physicalBranchIdentities = [
    ...localBranches.map(({ branch, sha }) => ({ branch, headSha: sha })),
    ...remoteBranches.map(({ branch, sha }) => ({ branch, headSha: sha })),
    ...worktrees.flatMap(({ branch, headSha }) => (
      branch === null || headSha === null ? [] : [{ branch, headSha }]
    ))
  ];
  const pullRequests = fullName.startsWith('<unknown>')
    ? []
    : await listPullRequests(git, github!, fullName, physicalBranchIdentities, unknowns);
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
    : await resolveRepositorySetting(github!);
  const pruneConfiguration = await resolvePruneConfiguration(git, remote);

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
    };
    return fullName.startsWith('<unknown>')
      ? await collect(null)
      : await withGitHubApiReadSession({ repositoryRoot, repository: fullName, operation: collect });
  });
}
