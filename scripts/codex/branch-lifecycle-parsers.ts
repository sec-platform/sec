import {
  assertGitBranchName,
  assertGitSha,
  type BranchActiveWorkPackageObservation,
  type BranchPullRequestObservation,
  type BranchRefObservation
} from './branch-lifecycle-contract.ts';

function stableSortRefs(entries: BranchRefObservation[]): BranchRefObservation[] {
  return entries.sort((left, right) => left.branch.localeCompare(right.branch));
}

function stableSortPullRequests(
  entries: BranchPullRequestObservation[]
): BranchPullRequestObservation[] {
  return entries.sort((left, right) => left.number - right.number);
}

export function parseLocalBranchRefs(source: Buffer | string): BranchRefObservation[] {
  const value = Buffer.isBuffer(source) ? source.toString('utf8') : source;
  const entries: BranchRefObservation[] = [];
  for (const line of value.split(/\r?\n/u).filter(Boolean)) {
    const [branch, sha, ...rest] = line.split('\0');
    if (!branch || !sha || rest.some((entry) => entry.length > 0)) {
      throw new Error(`Malformed local branch record: ${line}`);
    }
    assertGitBranchName(branch, 'local branch');
    assertGitSha(sha, `local branch ${branch} SHA`);
    entries.push({ branch, sha });
  }
  return stableSortRefs(entries);
}

export function parseRemoteHeadRefs(source: string): BranchRefObservation[] {
  const entries: BranchRefObservation[] = [];
  for (const line of source.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const match = /^([0-9a-f]{40})\s+refs\/heads\/(.+)$/u.exec(line.trim());
    if (!match) throw new Error(`Malformed ls-remote head record: ${line}`);
    assertGitBranchName(match[2]!, 'remote branch');
    entries.push({ branch: match[2]!, sha: match[1]! });
  }
  return stableSortRefs(entries);
}

export interface RawWorktreeRecord {
  path: string | null;
  headSha: string | null;
  branch: string | null;
  locked: boolean;
  prunable: boolean;
}

export function parseWorktreePorcelain(source: Buffer | string): RawWorktreeRecord[] {
  const value = Buffer.isBuffer(source) ? source.toString('utf8') : source;
  const records: RawWorktreeRecord[] = [];
  let current: RawWorktreeRecord = {
    path: null,
    headSha: null,
    branch: null,
    locked: false,
    prunable: false
  };

  const flush = (): void => {
    if (current.path !== null) records.push(current);
    current = {
      path: null,
      headSha: null,
      branch: null,
      locked: false,
      prunable: false
    };
  };

  for (const field of value.split('\0')) {
    if (field.length === 0) {
      flush();
      continue;
    }
    if (field.startsWith('worktree ')) {
      if (current.path !== null) flush();
      current.path = field.slice('worktree '.length);
    } else if (field.startsWith('HEAD ')) {
      const sha = field.slice('HEAD '.length);
      assertGitSha(sha, 'worktree HEAD');
      current.headSha = sha;
    } else if (field.startsWith('branch refs/heads/')) {
      const branch = field.slice('branch refs/heads/'.length);
      assertGitBranchName(branch, 'worktree branch');
      current.branch = branch;
    } else if (field === 'detached' || field === 'bare') {
      current.branch = null;
    } else if (field === 'locked' || field.startsWith('locked ')) {
      current.locked = true;
    } else if (field === 'prunable' || field.startsWith('prunable ')) {
      current.prunable = true;
    }
  }
  flush();
  return records;
}

export function countPorcelainStatus(
  source: Buffer
): { dirtyCount: number; untrackedCount: number } {
  let dirtyCount = 0;
  let untrackedCount = 0;
  for (const entry of source.toString('utf8').split('\0').filter(Boolean)) {
    if (entry.startsWith('?? ')) untrackedCount += 1;
    else if (entry.length >= 3 && entry[2] === ' ') dirtyCount += 1;
  }
  return { dirtyCount, untrackedCount };
}

export function parsePullRequestObservations(source: string): BranchPullRequestObservation[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) throw new Error('gh pr list must return an array.');
  return stableSortPullRequests(parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`PR observation ${index} must be an object.`);
    }
    const record = value as Record<string, unknown>;
    const number = record.number;
    const headBranch = record.headRefName;
    const headSha = record.headRefOid;
    const baseBranch = record.baseRefName;
    const stateValue = record.state;
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
      throw new Error(`PR observation ${index} has invalid number.`);
    }
    if (typeof headBranch !== 'string') throw new Error(`PR #${number} head branch is invalid.`);
    if (headSha !== null && typeof headSha !== 'string') {
      throw new Error(`PR #${number} head SHA is invalid.`);
    }
    if (typeof baseBranch !== 'string') throw new Error(`PR #${number} base branch is invalid.`);
    assertGitBranchName(headBranch, `PR #${number} head branch`);
    assertGitBranchName(baseBranch, `PR #${number} base branch`);
    if (typeof headSha === 'string') assertGitSha(headSha, `PR #${number} head SHA`);
    const state = typeof stateValue === 'string' ? stateValue.toLowerCase() : '';
    if (state !== 'open' && state !== 'closed' && state !== 'merged') {
      throw new Error(`PR #${number} state is invalid.`);
    }
    return {
      number,
      headBranch,
      headSha: headSha as string | null,
      baseBranch,
      state,
      isDraft: record.isDraft === true,
      url: typeof record.url === 'string' ? record.url : null
    };
  }));
}

export function parseControlPlane(
  source: string,
  defaultBranch: string
): BranchActiveWorkPackageObservation {
  const parsed: unknown = JSON.parse(source);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('control-plane output must be an object');
  }
  const record = parsed as Record<string, unknown>;
  const active = record.activeWorkPackage;
  const workspace = record.workspace;
  if (!active || typeof active !== 'object' || Array.isArray(active)) {
    throw new Error('control-plane activeWorkPackage is missing');
  }
  const activeRecord = active as Record<string, unknown>;
  const state = activeRecord.state;
  if (state !== 'active' && state !== 'none' && state !== 'invalid' && state !== 'unresolved') {
    throw new Error('control-plane active state is invalid');
  }
  let branch: string | null = null;
  if (state === 'active') {
    if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) {
      throw new Error('control-plane workspace is missing');
    }
    const workspaceBranch = (workspace as Record<string, unknown>).branch;
    if (
      typeof workspaceBranch !== 'string'
      || workspaceBranch === '(detached)'
      || workspaceBranch === defaultBranch
    ) {
      throw new Error('active Work Package candidate branch is unresolved');
    }
    assertGitBranchName(workspaceBranch, 'active Work Package branch');
    branch = workspaceBranch;
  }
  return {
    state,
    branch,
    manifest: typeof activeRecord.manifest === 'string' ? activeRecord.manifest : null,
    reason: typeof activeRecord.reason === 'string' ? activeRecord.reason : null
  };
}
