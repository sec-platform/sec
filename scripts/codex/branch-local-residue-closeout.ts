import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease
} from '../../platform/shared/workspace-write-lease.ts';
import {
  assertGitBranchName,
  assertGitSha,
  branchLifecycleDigest
} from './branch-lifecycle-audit.ts';
import {
  createBranchLifecycleGitChildEnvironmentV1,
  createBranchLifecycleGitHubCredentialArgsV1,
  decodeBranchLifecycleChildErrorV1,
  decodeBranchLifecycleChildStdoutV1
} from './branch-lifecycle-command.ts';
import { parseRepositoryFullName } from './branch-lifecycle-inventory.ts';
import { writeDurableFile } from './branch-recovery.ts';

const AUTHORIZATION_SCHEMA = 'sec-local-branch-residue-closeout-authorization-v1' as const;
const RECEIPT_SCHEMA = 'sec-local-branch-residue-closeout-receipt-v1' as const;
const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;
const MERGED_PULL_REQUEST_LIMIT = 1_000;

type Digest = `sha256:${string}`;

export interface MergedPullRequestHeadV1 {
  readonly number: number;
  readonly headBranch: string;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly mergeCommitSha: string;
  readonly state: 'MERGED';
  readonly url: string;
}

export interface LocalBranchResidueObservationV1 {
  readonly defaultBranch: string;
  readonly localRefs: Readonly<Record<string, string>>;
  readonly remoteRefs: Readonly<Record<string, string>>;
  readonly worktreeBranches: readonly string[];
  readonly mergedPullRequests: readonly MergedPullRequestHeadV1[];
}

export interface LocalBranchResiduePlanEntryV1 {
  readonly branch: string;
  readonly headSha: string;
  readonly pullRequestNumber: number;
  readonly mergeCommitSha: string;
  readonly pullRequestUrl: string;
}

export interface LocalBranchResiduePlanV1 {
  readonly eligible: readonly LocalBranchResiduePlanEntryV1[];
  readonly protectedBranches: readonly string[];
  readonly unresolvedBranches: readonly string[];
}

interface RecoveryBindingV1 {
  readonly path: string;
  readonly digest: Digest;
}

interface AuthorizationEntryV1 extends LocalBranchResiduePlanEntryV1 {
  readonly recovery: RecoveryBindingV1;
}

interface LocalBranchResidueAuthorizationV1 {
  readonly schema: typeof AUTHORIZATION_SCHEMA;
  readonly operationId: Digest;
  readonly repository: string;
  readonly repositoryRoot: string;
  readonly commonDir: string;
  readonly remote: string;
  readonly remoteMainSha: string;
  readonly defaultBranch: string;
  readonly entries: readonly AuthorizationEntryV1[];
  readonly authorizedAt: string;
  readonly authorizationDigest: Digest;
}

interface LocalBranchResidueReceiptV1 {
  readonly schema: typeof RECEIPT_SCHEMA;
  readonly operationId: Digest;
  readonly authorizationDigest: Digest;
  readonly repository: string;
  readonly remoteMainSha: string;
  readonly entries: readonly AuthorizationEntryV1[];
  readonly effect: 'delete-exact-transaction';
  readonly completedAt: string;
  readonly receiptDigest: Digest;
}

interface CommandResultV1 {
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

type CommandRunnerV1 = (
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  input?: string
) => CommandResultV1;

function digest(value: unknown): Digest {
  return branchLifecycleDigest(value);
}

function sha256Bytes(bytes: Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalSource(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultRunner(
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  input?: string
): CommandResultV1 {
  if (args.some((argument) => argument.includes('\0'))) {
    throw new Error('Local branch residue closeout argument contains NUL.');
  }
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    input,
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

function requireText(
  run: CommandRunnerV1,
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  label: string,
  input?: string
): string {
  const result = run(command, args, cwd, input);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
  }
  return decodeBranchLifecycleChildStdoutV1(result);
}

function parseRemoteRefs(source: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const line of source.split(/\r?\n/u).filter(Boolean)) {
    const fields = line.split('\t');
    if (fields.length !== 2 || !fields[1]!.startsWith('refs/heads/')) {
      throw new Error(`Remote ref observation is malformed: ${line}`);
    }
    const sha = fields[0]!;
    const branch = fields[1]!.slice('refs/heads/'.length);
    assertGitSha(sha, `remote branch ${branch}`);
    assertGitBranchName(branch, 'remote branch');
    if (result[branch] !== undefined) throw new Error(`Duplicate remote branch: ${branch}`);
    result[branch] = sha;
  }
  return Object.freeze(result);
}

function parseLocalRefs(source: string): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  const fields = source.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 2 !== 0) throw new Error('Local branch observation is malformed.');
  for (let index = 0; index < fields.length; index += 2) {
    const branch = fields[index]!;
    const sha = fields[index + 1]!;
    assertGitBranchName(branch, 'local branch');
    assertGitSha(sha, `local branch ${branch}`);
    if (result[branch] !== undefined) throw new Error(`Duplicate local branch: ${branch}`);
    result[branch] = sha;
  }
  return Object.freeze(result);
}

function parseWorktreeBranches(source: string): readonly string[] {
  const branches = source.split('\0')
    .filter((field) => field.startsWith('branch refs/heads/'))
    .map((field) => field.slice('branch refs/heads/'.length));
  for (const branch of branches) assertGitBranchName(branch, 'worktree branch');
  return Object.freeze([...new Set(branches)].sort((left, right) => left.localeCompare(right)));
}

export function parseMergedPullRequestHeadsV1(source: string): readonly MergedPullRequestHeadV1[] {
  const value: unknown = JSON.parse(source);
  if (!Array.isArray(value)) throw new Error('Merged pull request observation must be an array.');
  if (value.length >= MERGED_PULL_REQUEST_LIMIT) {
    throw new Error(`Merged pull request observation reached its bounded ${MERGED_PULL_REQUEST_LIMIT}-item limit.`);
  }
  const result = value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`Merged pull request ${index} must be an object.`);
    }
    const record = candidate as Record<string, unknown>;
    const mergeCommit = record.mergeCommit;
    if (mergeCommit === null || typeof mergeCommit !== 'object' || Array.isArray(mergeCommit)) {
      throw new Error(`Merged pull request ${index} has no merge commit.`);
    }
    const entry: MergedPullRequestHeadV1 = {
      number: Number(record.number),
      headBranch: String(record.headRefName),
      headSha: String(record.headRefOid),
      baseBranch: String(record.baseRefName),
      mergeCommitSha: String((mergeCommit as Record<string, unknown>).oid),
      state: record.state as 'MERGED',
      url: String(record.url)
    };
    if (!Number.isSafeInteger(entry.number) || entry.number < 1 || entry.state !== 'MERGED') {
      throw new Error(`Merged pull request ${index} identity is invalid.`);
    }
    assertGitBranchName(entry.headBranch, `merged pull request ${entry.number} head`);
    assertGitBranchName(entry.baseBranch, `merged pull request ${entry.number} base`);
    assertGitSha(entry.headSha, `merged pull request ${entry.number} head SHA`);
    assertGitSha(entry.mergeCommitSha, `merged pull request ${entry.number} merge SHA`);
    if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/[1-9][0-9]*$/u.test(entry.url)) {
      throw new Error(`Merged pull request ${entry.number} URL is invalid.`);
    }
    return Object.freeze(entry);
  });
  return Object.freeze(result.sort((left, right) => left.number - right.number));
}

export function planMergedLocalBranchResidueCloseoutV1(
  input: LocalBranchResidueObservationV1
): LocalBranchResiduePlanV1 {
  assertGitBranchName(input.defaultBranch, 'default branch');
  const worktreeBranches = new Set(input.worktreeBranches);
  const eligible: LocalBranchResiduePlanEntryV1[] = [];
  const protectedBranches: string[] = [];
  const unresolvedBranches: string[] = [];
  for (const [branch, headSha] of Object.entries(input.localRefs)
    .sort(([left], [right]) => left.localeCompare(right))) {
    assertGitBranchName(branch, 'local branch');
    assertGitSha(headSha, `local branch ${branch}`);
    if (branch === input.defaultBranch) continue;
    if (worktreeBranches.has(branch)) {
      protectedBranches.push(branch);
      continue;
    }
    if (input.remoteRefs[branch] !== undefined) {
      unresolvedBranches.push(branch);
      continue;
    }
    const matches = input.mergedPullRequests.filter((pullRequest) => (
      pullRequest.headBranch === branch
      && pullRequest.headSha === headSha
      && pullRequest.baseBranch === input.defaultBranch
    ));
    if (matches.length !== 1) {
      unresolvedBranches.push(branch);
      continue;
    }
    const pullRequest = matches[0]!;
    eligible.push(Object.freeze({
      branch,
      headSha,
      pullRequestNumber: pullRequest.number,
      mergeCommitSha: pullRequest.mergeCommitSha,
      pullRequestUrl: pullRequest.url
    }));
  }
  return Object.freeze({
    eligible: Object.freeze(eligible),
    protectedBranches: Object.freeze(protectedBranches.sort((left, right) => left.localeCompare(right))),
    unresolvedBranches: Object.freeze(unresolvedBranches.sort((left, right) => left.localeCompare(right)))
  });
}

function publishExact(filePath: string, source: string | Buffer): void {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8');
  if (existsSync(filePath)) {
    if (!readFileSync(filePath).equals(bytes)) {
      throw new Error(`Existing durable closeout object differs: ${filePath}`);
    }
    return;
  }
  writeDurableFile(filePath, bytes);
}

function createRecovery(
  run: CommandRunnerV1,
  repositoryRoot: string,
  recoveryDirectory: string,
  entry: LocalBranchResiduePlanEntryV1
): RecoveryBindingV1 {
  const identity = digest({
    schema: 'sec-local-branch-residue-recovery-v1',
    branch: entry.branch,
    headSha: entry.headSha,
    pullRequestNumber: entry.pullRequestNumber
  });
  const safeBranch = entry.branch.replace(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 80);
  const target = path.join(recoveryDirectory,
    `sec-local-branch-residue-${safeBranch}-${identity.slice('sha256:'.length)}.bundle`);
  if (!existsSync(target)) {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-local-branch-residue-'));
    const temporaryBundle = path.join(temporaryRoot, 'recovery.bundle');
    try {
      requireText(run, 'git', ['bundle', 'create', temporaryBundle, `refs/heads/${entry.branch}`],
        repositoryRoot, `recovery bundle creation for ${entry.branch}`);
      publishExact(target, readFileSync(temporaryBundle));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
  const bytes = readFileSync(target);
  const bundleDigest = sha256Bytes(bytes);
  const verify = run('git', ['bundle', 'verify', target], repositoryRoot);
  if (verify.status !== 0) {
    throw new Error(`Recovery bundle verification failed for ${entry.branch}: ${decodeBranchLifecycleChildErrorV1(verify)}`);
  }
  const heads = requireText(run, 'git', ['bundle', 'list-heads', target], repositoryRoot,
    `recovery bundle head readback for ${entry.branch}`);
  if (!heads.split(/\r?\n/u).some((line) => line.startsWith(`${entry.headSha} `))) {
    throw new Error(`Recovery bundle does not contain ${entry.branch}@${entry.headSha}.`);
  }
  publishExact(`${target}.sha256`, `${bundleDigest.slice('sha256:'.length)}  ${path.basename(target)}\n`);
  return Object.freeze({ path: target, digest: bundleDigest });
}

function observe(
  run: CommandRunnerV1,
  repositoryRoot: string,
  remote: string,
  defaultBranch: string
): LocalBranchResidueObservationV1 {
  return Object.freeze({
    defaultBranch,
    localRefs: parseLocalRefs(requireText(run, 'git', [
      'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)%00', 'refs/heads/'
    ], repositoryRoot, 'local branch observation')),
    remoteRefs: parseRemoteRefs(requireText(run, 'git', [
      ...createBranchLifecycleGitHubCredentialArgsV1(), 'ls-remote', '--heads', remote
    ], repositoryRoot, 'remote branch observation')),
    worktreeBranches: parseWorktreeBranches(requireText(run, 'git', [
      'worktree', 'list', '--porcelain', '-z'
    ], repositoryRoot, 'worktree observation')),
    mergedPullRequests: parseMergedPullRequestHeadsV1(requireText(run, 'gh', [
      'pr', 'list', '--state', 'merged', '--limit', String(MERGED_PULL_REQUEST_LIMIT), '--json',
      'number,headRefName,headRefOid,baseRefName,state,mergeCommit,url'
    ], repositoryRoot, 'merged pull request observation'))
  });
}

function remoteMainSha(observation: LocalBranchResidueObservationV1): string {
  const value = observation.remoteRefs[observation.defaultBranch];
  if (value === undefined) throw new Error('Remote default branch is absent.');
  return value;
}

function assertMergeCommitsReachable(
  run: CommandRunnerV1,
  repositoryRoot: string,
  remoteMain: string,
  entries: readonly LocalBranchResiduePlanEntryV1[]
): void {
  for (const entry of entries) {
    const result = run('git', ['merge-base', '--is-ancestor', entry.mergeCommitSha, remoteMain], repositoryRoot);
    if (result.status !== 0) {
      throw new Error(`PR #${entry.pullRequestNumber} merge commit is not reachable from exact remote main.`);
    }
  }
}

function createAuthorization(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  commonDir: string;
  remote: string;
  remoteMainSha: string;
  defaultBranch: string;
  entries: readonly AuthorizationEntryV1[];
  now: () => Date;
}>): LocalBranchResidueAuthorizationV1 {
  const material = Object.freeze({
    schema: AUTHORIZATION_SCHEMA,
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    commonDir: input.commonDir,
    remote: input.remote,
    remoteMainSha: input.remoteMainSha,
    defaultBranch: input.defaultBranch,
    entries: input.entries
  });
  const operationId = digest(material);
  const withoutDigest = Object.freeze({ ...material, operationId, authorizedAt: input.now().toISOString() });
  return Object.freeze({ ...withoutDigest, authorizationDigest: digest(withoutDigest) });
}

function createReceipt(
  authorization: LocalBranchResidueAuthorizationV1,
  now: () => Date
): LocalBranchResidueReceiptV1 {
  const withoutDigest = Object.freeze({
    schema: RECEIPT_SCHEMA,
    operationId: authorization.operationId,
    authorizationDigest: authorization.authorizationDigest,
    repository: authorization.repository,
    remoteMainSha: authorization.remoteMainSha,
    entries: authorization.entries,
    effect: 'delete-exact-transaction' as const,
    completedAt: now().toISOString()
  });
  return Object.freeze({ ...withoutDigest, receiptDigest: digest(withoutDigest) });
}

function assertPlanStable(
  expected: readonly AuthorizationEntryV1[],
  observation: LocalBranchResidueObservationV1
): void {
  for (const entry of expected) {
    if (observation.localRefs[entry.branch] !== entry.headSha) {
      throw new Error(`Local branch changed before closeout: ${entry.branch}.`);
    }
    if (observation.remoteRefs[entry.branch] !== undefined) {
      throw new Error(`Remote branch reappeared before closeout: ${entry.branch}.`);
    }
    if (observation.worktreeBranches.includes(entry.branch)) {
      throw new Error(`Worktree acquired branch before closeout: ${entry.branch}.`);
    }
    const pullRequests = observation.mergedPullRequests.filter((pullRequest) => (
      pullRequest.number === entry.pullRequestNumber
      && pullRequest.headBranch === entry.branch
      && pullRequest.headSha === entry.headSha
      && pullRequest.mergeCommitSha === entry.mergeCommitSha
    ));
    if (pullRequests.length !== 1) {
      throw new Error(`Merged PR identity changed before closeout: #${entry.pullRequestNumber}.`);
    }
  }
}

function deleteExactTransaction(
  run: CommandRunnerV1,
  repositoryRoot: string,
  entries: readonly AuthorizationEntryV1[]
): void {
  const source = ['start', ...entries.map((entry) => (
    `delete refs/heads/${entry.branch} ${entry.headSha}`
  )), 'prepare', 'commit', ''].join('\n');
  requireText(run, 'git', ['update-ref', '--stdin'], repositoryRoot,
    'atomic local branch residue closeout', source);
}

export async function executeMergedLocalBranchResidueCloseoutV1(input: Readonly<{
  repositoryRoot: string;
  remote?: string;
  now?: () => Date;
  run?: CommandRunnerV1;
}>): Promise<Readonly<{
  schema: 'sec-local-branch-residue-closeout-result-v1';
  settled: readonly string[];
  protectedBranches: readonly string[];
  unresolvedBranches: readonly string[];
  authorizationPath: string | null;
  receiptPath: string | null;
}>> {
  const run = input.run ?? defaultRunner;
  const now = input.now ?? (() => new Date());
  const requestedRoot = path.resolve(input.repositoryRoot);
  const repositoryRoot = realpathSync(requireText(run, 'git', ['rev-parse', '--show-toplevel'],
    requestedRoot, 'repository root'));
  const commonRaw = requireText(run, 'git', ['rev-parse', '--git-common-dir'],
    repositoryRoot, 'Git common directory');
  const commonDir = realpathSync(path.isAbsolute(commonRaw)
    ? commonRaw
    : path.resolve(repositoryRoot, commonRaw));
  const remote = input.remote ?? 'origin';
  assertGitBranchName(remote, 'remote');
  const remoteUrl = requireText(run, 'git', ['remote', 'get-url', remote],
    repositoryRoot, 'remote URL');
  const repository = parseRepositoryFullName(remoteUrl);
  if (repository === null) throw new Error('Repository identity cannot be resolved from the canonical remote URL.');
  const symbolic = requireText(run, 'git', ['symbolic-ref', '--quiet', '--short',
    `refs/remotes/${remote}/HEAD`], repositoryRoot, 'default branch');
  if (!symbolic.startsWith(`${remote}/`)) throw new Error('Default branch symbolic ref is malformed.');
  const defaultBranch = symbolic.slice(remote.length + 1);
  assertGitBranchName(defaultBranch, 'default branch');

  const first = observe(run, repositoryRoot, remote, defaultBranch);
  const plan = planMergedLocalBranchResidueCloseoutV1(first);
  if (plan.eligible.length === 0) {
    return Object.freeze({
      schema: 'sec-local-branch-residue-closeout-result-v1',
      settled: Object.freeze([]),
      protectedBranches: plan.protectedBranches,
      unresolvedBranches: plan.unresolvedBranches,
      authorizationPath: null,
      receiptPath: null
    });
  }
  const exactRemoteMain = remoteMainSha(first);
  assertMergeCommitsReachable(run, repositoryRoot, exactRemoteMain, plan.eligible);
  const durableRoot = path.resolve(path.dirname(repositoryRoot), `${path.basename(repositoryRoot)}-recovery`);
  const entries = Object.freeze(plan.eligible.map((entry) => Object.freeze({
    ...entry,
    recovery: createRecovery(run, repositoryRoot, durableRoot, entry)
  })));
  const authorization = createAuthorization({
    repository,
    repositoryRoot,
    commonDir,
    remote,
    remoteMainSha: exactRemoteMain,
    defaultBranch,
    entries,
    now
  });
  const suffix = authorization.operationId.slice('sha256:'.length);
  const durableAuthorizationPath = path.join(durableRoot,
    `sec-local-branch-residue-${suffix}.authorization.json`);
  const durableReceiptPath = path.join(durableRoot,
    `sec-local-branch-residue-${suffix}.receipt.json`);

  await withWorkspaceWriteLease(repositoryRoot, undefined, async (lease) => {
    await assertWorkspaceWriteLease(repositoryRoot, lease);
    const current = observe(run, repositoryRoot, remote, defaultBranch);
    if (remoteMainSha(current) !== exactRemoteMain) {
      throw new Error('Remote main changed before local branch residue closeout.');
    }
    assertPlanStable(entries, current);
    assertMergeCommitsReachable(run, repositoryRoot, exactRemoteMain, entries);
    publishExact(durableAuthorizationPath, canonicalSource(authorization));
    await assertWorkspaceWriteLease(repositoryRoot, lease);
    deleteExactTransaction(run, repositoryRoot, entries);
    await assertWorkspaceWriteLease(repositoryRoot, lease);
    const localReadback = parseLocalRefs(requireText(run, 'git', [
      'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)%00', 'refs/heads/'
    ], repositoryRoot, 'local branch closeout readback'));
    const residue = entries.filter((entry) => localReadback[entry.branch] !== undefined);
    if (residue.length > 0) {
      throw new Error(`Atomic local branch closeout left residue: ${residue.map(({ branch }) => branch).join(', ')}.`);
    }
    publishExact(durableReceiptPath, canonicalSource(createReceipt(authorization, now)));
  });

  return Object.freeze({
    schema: 'sec-local-branch-residue-closeout-result-v1',
    settled: Object.freeze(entries.map(({ branch }) => branch)),
    protectedBranches: plan.protectedBranches,
    unresolvedBranches: plan.unresolvedBranches,
    authorizationPath: durableAuthorizationPath,
    receiptPath: durableReceiptPath
  });
}
