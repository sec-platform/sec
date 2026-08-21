import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  createBranchLifecycleGitHubRemoteObservationV1,
  decodeBranchLifecycleChildErrorV1,
  decodeBranchLifecycleChildStdoutV1
} from './branch-lifecycle-command.ts';
import { parseRepositoryFullName } from './branch-lifecycle-inventory.ts';
import {
  acquireBranchRecoveryStoreV1,
  type BranchRecoveryStoreV1
} from './branch-recovery.ts';

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
  readonly worktreeRoots: readonly string[];
  readonly mergedPullRequests: readonly MergedPullRequestHeadV1[];
}

export interface RepositoryProviderObservationV1 {
  readonly repository: string;
  readonly defaultBranch: string;
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
  readonly remoteUrl: string;
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

export type CommandRunnerV1 = (
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  input?: string,
  environment?: Readonly<NodeJS.ProcessEnv>
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
  input?: string,
  environment?: Readonly<NodeJS.ProcessEnv>
): CommandResultV1 {
  if (args.some((argument) => argument.includes('\0'))) {
    throw new Error('Local branch residue closeout argument contains NUL.');
  }
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: null,
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    ...(input === undefined ? {} : { input: Buffer.from(input, 'utf8') }),
    env: {
      ...(environment ?? (command === 'git'
        ? createBranchLifecycleGitChildEnvironmentV1(process.env)
        : process.env)),
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
  input?: string,
  environment?: Readonly<NodeJS.ProcessEnv>
): string {
  const result = run(command, args, cwd, input, environment);
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
  const records = source.split(/\r?\n/u).filter(Boolean);
  for (let index = 0; index < records.length; index += 1) {
    const fields = records[index]!.split('\0');
    if (fields.at(-1) === '') fields.pop();
    if (fields.length !== 2) throw new Error(`Local branch record ${index} is malformed.`);
    const branch = fields[0]!;
    const sha = fields[1]!;
    try {
      assertGitBranchName(branch, 'local branch');
    } catch (error) {
      throw new Error(`Local branch record has an invalid name ${JSON.stringify(branch)}.`, { cause: error });
    }
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

function parseWorktreeRoots(source: string): readonly string[] {
  const roots = source.split('\0')
    .filter((field) => field.startsWith('worktree '))
    .map((field) => path.resolve(field.slice('worktree '.length)));
  if (roots.length === 0) throw new Error('Worktree observation contains no repository root.');
  return Object.freeze([...new Set(roots)].sort((left, right) => left.localeCompare(right)));
}

export function parseRepositoryProviderObservationV1(
  source: string,
  expectedRepository: string
): RepositoryProviderObservationV1 {
  const value: unknown = JSON.parse(source);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Repository provider observation must be an object.');
  }
  const record = value as Record<string, unknown>;
  const defaultBranchRef = record.defaultBranchRef;
  if (defaultBranchRef === null || typeof defaultBranchRef !== 'object'
      || Array.isArray(defaultBranchRef)) {
    throw new Error('Repository provider observation has no default branch.');
  }
  const result = Object.freeze({
    repository: String(record.nameWithOwner),
    defaultBranch: String((defaultBranchRef as Record<string, unknown>).name)
  });
  if (result.repository !== expectedRepository) {
    throw new Error(`Repository provider identity differs: expected ${expectedRepository}, observed ${result.repository}.`);
  }
  assertGitBranchName(result.defaultBranch, 'provider default branch');
  return result;
}

export function parseMergedPullRequestHeadsV1(
  source: string,
  expectedRepository: string
): readonly MergedPullRequestHeadV1[] {
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
    const expectedUrl = `https://github.com/${expectedRepository}/pull/${entry.number}`;
    if (entry.url !== expectedUrl) {
      throw new Error(`Merged pull request ${entry.number} URL differs from ${expectedUrl}.`);
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

function verifyBundleBytes(
  run: CommandRunnerV1,
  repositoryRoot: string,
  entry: LocalBranchResiduePlanEntryV1,
  bytes: Uint8Array,
  label: string
): void {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-local-branch-residue-verify-'));
  const temporaryBundle = path.join(temporaryRoot, 'recovery.bundle');
  try {
    writeFileSync(temporaryBundle, bytes, { flag: 'wx' });
    const verify = run('git', ['bundle', 'verify', temporaryBundle], repositoryRoot);
    if (verify.status !== 0) {
      throw new Error(`${label} verification failed for ${entry.branch}: ${decodeBranchLifecycleChildErrorV1(verify)}`);
    }
    const heads = requireText(run, 'git', ['bundle', 'list-heads', temporaryBundle], repositoryRoot,
      `${label} head readback for ${entry.branch}`);
    if (!heads.split(/\r?\n/u).some((line) => line.startsWith(`${entry.headSha} `))) {
      throw new Error(`${label} does not contain ${entry.branch}@${entry.headSha}.`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function createRecovery(
  run: CommandRunnerV1,
  repositoryRoot: string,
  store: BranchRecoveryStoreV1,
  entry: LocalBranchResiduePlanEntryV1
): RecoveryBindingV1 {
  const identity = digest({
    schema: 'sec-local-branch-residue-recovery-v1',
    branch: entry.branch,
    headSha: entry.headSha,
    pullRequestNumber: entry.pullRequestNumber
  });
  const safeBranch = entry.branch.replace(/[^A-Za-z0-9._-]+/gu, '-').slice(0, 80);
  const name = `sec-local-branch-residue-${safeBranch}-${identity.slice('sha256:'.length)}.bundle`;
  const existing = store.read(name);
  if (existing !== null) {
    const bundleDigest = sha256Bytes(existing);
    const checksum = store.read(`${name}.sha256`);
    const expectedChecksum = Buffer.from(
      `${bundleDigest.slice('sha256:'.length)}  ${name}\n`,
      'utf8'
    );
    if (checksum === null || !Buffer.from(checksum).equals(expectedChecksum)) {
      throw new Error(`Existing recovery checksum differs for ${entry.branch}.`);
    }
    verifyBundleBytes(run, repositoryRoot, entry, existing, 'Existing recovery bundle');
    return Object.freeze({ path: path.join(store.root.path, name), digest: bundleDigest });
  }
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-local-branch-residue-'));
  const temporaryBundle = path.join(temporaryRoot, 'recovery.bundle');
  try {
    requireText(run, 'git', ['bundle', 'create', temporaryBundle, `refs/heads/${entry.branch}`],
      repositoryRoot, `recovery bundle creation for ${entry.branch}`);
    const bytes = readFileSync(temporaryBundle);
    if (bytes.byteLength === 0) throw new Error(`Recovery bundle is empty for ${entry.branch}.`);
    verifyBundleBytes(run, repositoryRoot, entry, bytes, 'Recovery bundle');
    const bundleDigest = sha256Bytes(bytes);
    store.publishExclusive({
      name,
      bytes,
      validate: (candidate) => {
        if (candidate.byteLength === 0 || sha256Bytes(candidate) !== bundleDigest) {
          throw new Error(`Recovery bundle bytes differ for ${entry.branch}.`);
        }
      }
    });
    const checksum = Buffer.from(
      `${bundleDigest.slice('sha256:'.length)}  ${name}\n`,
      'utf8'
    );
    store.publishExclusive({
      name: `${name}.sha256`,
      bytes: checksum,
      validate: (candidate) => {
        if (!Buffer.from(candidate).equals(checksum)) {
          throw new Error(`Recovery checksum differs for ${entry.branch}.`);
        }
      }
    });
    return Object.freeze({ path: path.join(store.root.path, name), digest: bundleDigest });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function assertRecoveryBytes(
  store: BranchRecoveryStoreV1,
  entry: AuthorizationEntryV1
): Uint8Array {
  const name = path.basename(entry.recovery.path);
  if (entry.recovery.path !== path.join(store.root.path, name)
      || !name.startsWith('sec-local-branch-residue-') || !name.endsWith('.bundle')) {
    throw new Error(`Recovery path escaped the canonical recovery owner for ${entry.branch}.`);
  }
  const bytes = store.read(name);
  if (bytes === null || sha256Bytes(bytes) !== entry.recovery.digest) {
    throw new Error(`Recovery bytes changed for ${entry.branch}.`);
  }
  const expectedChecksum = Buffer.from(
    `${entry.recovery.digest.slice('sha256:'.length)}  ${name}\n`,
    'utf8'
  );
  const checksum = store.read(`${name}.sha256`);
  if (checksum === null || !Buffer.from(checksum).equals(expectedChecksum)) {
    throw new Error(`Recovery checksum changed for ${entry.branch}.`);
  }
  return bytes;
}

function verifyRecovery(
  run: CommandRunnerV1,
  repositoryRoot: string,
  store: BranchRecoveryStoreV1,
  entry: AuthorizationEntryV1
): void {
  const bytes = assertRecoveryBytes(store, entry);
  verifyBundleBytes(run, repositoryRoot, entry, bytes, 'Recovery bundle live');
}

function observe(
  run: CommandRunnerV1,
  repositoryRoot: string,
  repository: string,
  defaultBranch: string
): LocalBranchResidueObservationV1 {
  const remoteObservation = createBranchLifecycleGitHubRemoteObservationV1(
    repository,
    process.env
  );
  const worktrees = requireText(run, 'git', [
    'worktree', 'list', '--porcelain', '-z'
  ], repositoryRoot, 'worktree observation');
  return Object.freeze({
    defaultBranch,
    localRefs: parseLocalRefs(requireText(run, 'git', [
      'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)%00', 'refs/heads/'
    ], repositoryRoot, 'local branch observation')),
    remoteRefs: parseRemoteRefs(requireText(run, 'git', [
      ...remoteObservation.argumentsPrefix,
      'ls-remote', '--heads', remoteObservation.repositoryUrl
    ], repositoryRoot, 'remote branch observation', undefined, remoteObservation.environment)),
    worktreeBranches: parseWorktreeBranches(worktrees),
    worktreeRoots: parseWorktreeRoots(worktrees),
    mergedPullRequests: parseMergedPullRequestHeadsV1(requireText(run, 'gh', [
      'pr', 'list', '--repo', repository, '--state', 'merged', '--limit',
      String(MERGED_PULL_REQUEST_LIMIT), '--json',
      'number,headRefName,headRefOid,baseRefName,state,mergeCommit,url'
    ], repositoryRoot, 'merged pull request observation'), repository)
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
  remoteUrl: string;
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
    remoteUrl: input.remoteUrl,
    remoteMainSha: input.remoteMainSha,
    defaultBranch: input.defaultBranch,
    entries: input.entries
  });
  const operationId = digest(material);
  const withoutDigest = Object.freeze({ ...material, operationId, authorizedAt: input.now().toISOString() });
  return Object.freeze({ ...withoutDigest, authorizationDigest: digest(withoutDigest) });
}

function assertDigest(value: string, label: string): asserts value is Digest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
}

function parseAuthorizationEntries(value: unknown): readonly AuthorizationEntryV1[] {
  if (!Array.isArray(value)) throw new Error('Authorization entries must be an array.');
  return Object.freeze(value.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`Authorization entry ${index} is invalid.`);
    }
    const entry = candidate as Record<string, unknown>;
    const entryKeys = [
      'branch', 'headSha', 'pullRequestNumber', 'mergeCommitSha', 'pullRequestUrl', 'recovery'
    ].sort();
    const recovery = entry.recovery;
    if (Object.keys(entry).sort().join(',') !== entryKeys.join(',')
        || recovery === null || typeof recovery !== 'object' || Array.isArray(recovery)) {
      throw new Error(`Authorization entry ${index} shape is invalid.`);
    }
    const recoveryRecord = recovery as Record<string, unknown>;
    if (Object.keys(recoveryRecord).sort().join(',') !== ['digest', 'path'].join(',')) {
      throw new Error(`Authorization recovery ${index} shape is invalid.`);
    }
    const result: AuthorizationEntryV1 = {
      branch: String(entry.branch),
      headSha: String(entry.headSha),
      pullRequestNumber: Number(entry.pullRequestNumber),
      mergeCommitSha: String(entry.mergeCommitSha),
      pullRequestUrl: String(entry.pullRequestUrl),
      recovery: {
        path: String(recoveryRecord.path),
        digest: String(recoveryRecord.digest) as Digest
      }
    };
    assertGitBranchName(result.branch, `authorization entry ${index} branch`);
    assertGitSha(result.headSha, `authorization entry ${index} head`);
    assertGitSha(result.mergeCommitSha, `authorization entry ${index} merge commit`);
    if (!Number.isSafeInteger(result.pullRequestNumber) || result.pullRequestNumber < 1) {
      throw new Error(`Authorization entry ${index} pull request number is invalid.`);
    }
    assertDigest(result.recovery.digest, `authorization entry ${index} recovery digest`);
    return Object.freeze(result);
  }));
}

function parseAuthorization(source: Uint8Array): LocalBranchResidueAuthorizationV1 {
  const text = Buffer.from(source).toString('utf8');
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local branch residue authorization must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'schema', 'operationId', 'repository', 'repositoryRoot', 'commonDir', 'remote', 'remoteUrl',
    'remoteMainSha', 'defaultBranch', 'entries', 'authorizedAt', 'authorizationDigest'
  ].sort();
  if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')
      || record.schema !== AUTHORIZATION_SCHEMA || !Array.isArray(record.entries)) {
    throw new Error('Local branch residue authorization shape is invalid.');
  }
  const entries = parseAuthorizationEntries(record.entries);
  const parsed: LocalBranchResidueAuthorizationV1 = {
    schema: AUTHORIZATION_SCHEMA,
    repository: String(record.repository),
    repositoryRoot: String(record.repositoryRoot),
    commonDir: String(record.commonDir),
    remote: String(record.remote),
    remoteUrl: String(record.remoteUrl),
    remoteMainSha: String(record.remoteMainSha),
    defaultBranch: String(record.defaultBranch),
    entries,
    operationId: String(record.operationId) as Digest,
    authorizedAt: String(record.authorizedAt),
    authorizationDigest: String(record.authorizationDigest) as Digest
  };
  assertDigest(parsed.operationId, 'authorization operationId');
  assertDigest(parsed.authorizationDigest, 'authorization digest');
  assertGitSha(parsed.remoteMainSha, 'authorization remote main');
  assertGitBranchName(parsed.remote, 'authorization remote');
  assertGitBranchName(parsed.defaultBranch, 'authorization default branch');
  if (!path.isAbsolute(parsed.repositoryRoot) || !path.isAbsolute(parsed.commonDir)
      || Number.isNaN(Date.parse(parsed.authorizedAt))) {
    throw new Error('Authorization path or timestamp binding is invalid.');
  }
  if (parsed.entries.length === 0) throw new Error('Authorization must bind at least one ref.');
  for (const entry of parsed.entries) {
    if (entry.pullRequestUrl
        !== `https://github.com/${parsed.repository}/pull/${entry.pullRequestNumber}`) {
      throw new Error(`Authorization PR URL differs for #${entry.pullRequestNumber}.`);
    }
  }
  const material = Object.freeze({
    schema: parsed.schema,
    repository: parsed.repository,
    repositoryRoot: parsed.repositoryRoot,
    commonDir: parsed.commonDir,
    remote: parsed.remote,
    remoteUrl: parsed.remoteUrl,
    remoteMainSha: parsed.remoteMainSha,
    defaultBranch: parsed.defaultBranch,
    entries: parsed.entries
  });
  if (parsed.operationId !== digest(material)) throw new Error('Authorization operationId differs.');
  const withoutDigest = Object.freeze({ ...material, operationId: parsed.operationId, authorizedAt: parsed.authorizedAt });
  if (parsed.authorizationDigest !== digest(withoutDigest)) throw new Error('Authorization digest differs.');
  if (text !== canonicalSource(parsed)) throw new Error('Authorization bytes are not canonical.');
  return Object.freeze(parsed);
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

function parseReceipt(source: Uint8Array): LocalBranchResidueReceiptV1 {
  const text = Buffer.from(source).toString('utf8');
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local branch residue receipt must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'schema', 'operationId', 'authorizationDigest', 'repository', 'remoteMainSha',
    'entries', 'effect', 'completedAt', 'receiptDigest'
  ].sort();
  if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')
      || record.schema !== RECEIPT_SCHEMA || record.effect !== 'delete-exact-transaction'
      || !Array.isArray(record.entries)) {
    throw new Error('Local branch residue receipt shape is invalid.');
  }
  const entries = parseAuthorizationEntries(record.entries);
  const parsed: LocalBranchResidueReceiptV1 = {
    schema: RECEIPT_SCHEMA,
    operationId: String(record.operationId) as Digest,
    authorizationDigest: String(record.authorizationDigest) as Digest,
    repository: String(record.repository),
    remoteMainSha: String(record.remoteMainSha),
    entries,
    effect: 'delete-exact-transaction',
    completedAt: String(record.completedAt),
    receiptDigest: String(record.receiptDigest) as Digest
  };
  assertDigest(parsed.operationId, 'receipt operationId');
  assertDigest(parsed.authorizationDigest, 'receipt authorization digest');
  assertDigest(parsed.receiptDigest, 'receipt digest');
  assertGitSha(parsed.remoteMainSha, 'receipt remote main');
  if (Number.isNaN(Date.parse(parsed.completedAt))) throw new Error('Receipt timestamp is invalid.');
  const withoutDigest = Object.freeze({
    schema: parsed.schema,
    operationId: parsed.operationId,
    authorizationDigest: parsed.authorizationDigest,
    repository: parsed.repository,
    remoteMainSha: parsed.remoteMainSha,
    entries: parsed.entries,
    effect: parsed.effect,
    completedAt: parsed.completedAt
  });
  if (parsed.receiptDigest !== digest(withoutDigest)) throw new Error('Receipt digest differs.');
  if (text !== canonicalSource(parsed)) throw new Error('Receipt bytes are not canonical.');
  return Object.freeze(parsed);
}

function publishCanonical<T>(input: Readonly<{
  store: BranchRecoveryStoreV1;
  name: string;
  value: T;
  parse: (bytes: Uint8Array) => T;
}>): T {
  const bytes = Buffer.from(canonicalSource(input.value), 'utf8');
  input.store.publishExclusive({
    name: input.name,
    bytes,
    validate: (candidate) => {
      const parsed = input.parse(candidate);
      if (canonicalSource(parsed) !== canonicalSource(input.value)) {
        throw new Error(`Durable closeout object differs: ${input.name}`);
      }
    }
  });
  const readback = input.store.read(input.name);
  if (readback === null) throw new Error(`Durable closeout object disappeared: ${input.name}`);
  return input.parse(readback);
}

function operationNames(operationId: Digest): Readonly<{
  authorization: string;
  receipt: string;
}> {
  const suffix = operationId.slice('sha256:'.length);
  return Object.freeze({
    authorization: `sec-local-branch-residue-${suffix}.authorization.json`,
    receipt: `sec-local-branch-residue-${suffix}.receipt.json`
  });
}

function assertReceiptMatchesAuthorization(
  receipt: LocalBranchResidueReceiptV1,
  authorization: LocalBranchResidueAuthorizationV1
): void {
  if (receipt.operationId !== authorization.operationId
      || receipt.authorizationDigest !== authorization.authorizationDigest
      || receipt.repository !== authorization.repository
      || receipt.remoteMainSha !== authorization.remoteMainSha
      || canonicalSource(receipt.entries) !== canonicalSource(authorization.entries)) {
    throw new Error(`Receipt differs from authorization ${authorization.operationId}.`);
  }
}

function findPendingAuthorization(
  store: BranchRecoveryStoreV1
): LocalBranchResidueAuthorizationV1 | null {
  const names = store.listOwnedFiles('sec-local-branch-residue-')
    .filter((name) => name.endsWith('.authorization.json'));
  const pending: LocalBranchResidueAuthorizationV1[] = [];
  for (const name of names) {
    const bytes = store.read(name);
    if (bytes === null) throw new Error(`Authorization disappeared during recovery scan: ${name}`);
    const authorization = parseAuthorization(bytes);
    const expectedNames = operationNames(authorization.operationId);
    if (name !== expectedNames.authorization) {
      throw new Error(`Authorization filename differs from its operationId: ${name}`);
    }
    const receiptBytes = store.read(expectedNames.receipt);
    if (receiptBytes === null) {
      pending.push(authorization);
      continue;
    }
    assertReceiptMatchesAuthorization(parseReceipt(receiptBytes), authorization);
  }
  if (pending.length > 1) {
    throw new Error(`Multiple pending local branch residue operations require reconciliation: ${pending.length}.`);
  }
  return pending[0] ?? null;
}

function observeRepositoryProvider(
  run: CommandRunnerV1,
  repositoryRoot: string,
  repository: string
): RepositoryProviderObservationV1 {
  return parseRepositoryProviderObservationV1(requireText(run, 'gh', [
    'repo', 'view', '--repo', repository, '--json', 'nameWithOwner,defaultBranchRef'
  ], repositoryRoot, 'repository provider observation'), repository);
}

function pathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function assertRecoverySeparatedFromWorktrees(
  store: BranchRecoveryStoreV1,
  observation: LocalBranchResidueObservationV1
): void {
  for (const worktree of observation.worktreeRoots) {
    if (pathInside(store.root.path, worktree) || pathInside(worktree, store.root.path)) {
      throw new Error(`Worktree overlaps the canonical recovery root: ${worktree}`);
    }
  }
  store.assertCurrent();
}

function assertAuthorizationIdentity(input: Readonly<{
  authorization: LocalBranchResidueAuthorizationV1;
  repository: string;
  repositoryRoot: string;
  commonDir: string;
  remote: string;
  remoteUrl: string;
  provider: RepositoryProviderObservationV1;
}>): void {
  const { authorization } = input;
  if (authorization.repository !== input.repository
      || authorization.repositoryRoot !== input.repositoryRoot
      || authorization.commonDir !== input.commonDir
      || authorization.remote !== input.remote
      || authorization.remoteUrl !== input.remoteUrl
      || input.provider.repository !== input.repository
      || authorization.defaultBranch !== input.provider.defaultBranch) {
    throw new Error('Pending authorization differs from the exact repository provider identity.');
  }
  for (const entry of authorization.entries) {
    if (entry.pullRequestUrl
        !== `https://github.com/${authorization.repository}/pull/${entry.pullRequestNumber}`) {
      throw new Error(`Authorization PR URL differs for #${entry.pullRequestNumber}.`);
    }
  }
}

function authorizedLocalState(
  authorization: LocalBranchResidueAuthorizationV1,
  observation: LocalBranchResidueObservationV1
): 'present' | 'absent' {
  const states = authorization.entries.map((entry) => {
    const current = observation.localRefs[entry.branch];
    if (current === entry.headSha) return 'present' as const;
    if (current === undefined) return 'absent' as const;
    throw new Error(`Local branch changed after authorization: ${entry.branch}.`);
  });
  if (states.every((state) => state === 'present')) return 'present';
  if (states.every((state) => state === 'absent')) return 'absent';
  throw new Error('Authorized local refs are in a mixed state; atomic closeout cannot be inferred.');
}

function assertAuthorizedObservation(
  authorization: LocalBranchResidueAuthorizationV1,
  observation: LocalBranchResidueObservationV1
): 'present' | 'absent' {
  if (observation.defaultBranch !== authorization.defaultBranch
      || remoteMainSha(observation) !== authorization.remoteMainSha) {
    throw new Error('Remote default branch changed after local branch residue authorization.');
  }
  for (const entry of authorization.entries) {
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
      && pullRequest.baseBranch === authorization.defaultBranch
      && pullRequest.mergeCommitSha === entry.mergeCommitSha
      && pullRequest.url === entry.pullRequestUrl
    ));
    if (pullRequests.length !== 1) {
      throw new Error(`Merged PR identity changed before closeout: #${entry.pullRequestNumber}.`);
    }
  }
  return authorizedLocalState(authorization, observation);
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
  recoveryRoot?: string;
  now?: () => Date;
  run?: CommandRunnerV1;
  faults?: Readonly<{
    afterAuthorization?: () => void;
    afterDelete?: () => void;
    afterReadback?: () => void;
    beforeReceipt?: () => void;
  }>;
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
  const provider = observeRepositoryProvider(run, repositoryRoot, repository);
  const initialWorktrees = requireText(run, 'git', [
    'worktree', 'list', '--porcelain', '-z'
  ], repositoryRoot, 'initial worktree observation');
  const store = acquireBranchRecoveryStoreV1({
    repositoryRoot,
    commonDir,
    worktreeRoots: parseWorktreeRoots(initialWorktrees),
    ...(input.recoveryRoot === undefined ? {} : { recoveryRoot: input.recoveryRoot })
  });

  const settleAuthorization = async (
    authorization: LocalBranchResidueAuthorizationV1,
    publishAuthorization: boolean,
    protectedBranches: readonly string[],
    unresolvedBranches: readonly string[]
  ) => {
    const names = operationNames(authorization.operationId);
    await withWorkspaceWriteLease(repositoryRoot, undefined, async (lease) => {
      await assertWorkspaceWriteLease(repositoryRoot, lease);
      const currentProvider = observeRepositoryProvider(run, repositoryRoot, repository);
      assertAuthorizationIdentity({
        authorization,
        repository,
        repositoryRoot,
        commonDir,
        remote,
        remoteUrl,
        provider: currentProvider
      });
      const current = observe(
        run,
        repositoryRoot,
        repository,
        authorization.defaultBranch
      );
      assertRecoverySeparatedFromWorktrees(store, current);
      const state = assertAuthorizedObservation(authorization, current);
      assertMergeCommitsReachable(
        run,
        repositoryRoot,
        authorization.remoteMainSha,
        authorization.entries
      );
      for (const entry of authorization.entries) verifyRecovery(run, repositoryRoot, store, entry);
      if (publishAuthorization) {
        publishCanonical({
          store,
          name: names.authorization,
          value: authorization,
          parse: parseAuthorization
        });
        input.faults?.afterAuthorization?.();
      }
      await assertWorkspaceWriteLease(repositoryRoot, lease);
      for (const entry of authorization.entries) assertRecoveryBytes(store, entry);
      if (state === 'present') {
        deleteExactTransaction(run, repositoryRoot, authorization.entries);
        input.faults?.afterDelete?.();
      }
      await assertWorkspaceWriteLease(repositoryRoot, lease);
      const localReadback = parseLocalRefs(requireText(run, 'git', [
        'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)%00', 'refs/heads/'
      ], repositoryRoot, 'local branch closeout readback'));
      const residue = authorization.entries.filter((entry) => localReadback[entry.branch] !== undefined);
      if (residue.length > 0) {
        throw new Error(`Atomic local branch closeout left residue: ${residue.map(({ branch }) => branch).join(', ')}.`);
      }
      input.faults?.afterReadback?.();
      for (const entry of authorization.entries) assertRecoveryBytes(store, entry);
      input.faults?.beforeReceipt?.();
      const receipt = publishCanonical({
        store,
        name: names.receipt,
        value: createReceipt(authorization, now),
        parse: parseReceipt
      });
      assertReceiptMatchesAuthorization(receipt, authorization);
      store.assertCurrent();
    });
    return Object.freeze({
      schema: 'sec-local-branch-residue-closeout-result-v1' as const,
      settled: Object.freeze(authorization.entries.map(({ branch }) => branch)),
      protectedBranches,
      unresolvedBranches,
      authorizationPath: path.join(store.root.path, names.authorization),
      receiptPath: path.join(store.root.path, names.receipt)
    });
  };

  const pending = findPendingAuthorization(store);
  if (pending !== null) {
    assertAuthorizationIdentity({
      authorization: pending,
      repository,
      repositoryRoot,
      commonDir,
      remote,
      remoteUrl,
      provider
    });
    return await settleAuthorization(pending, false, Object.freeze([]), Object.freeze([]));
  }

  const first = observe(run, repositoryRoot, repository, provider.defaultBranch);
  assertRecoverySeparatedFromWorktrees(store, first);
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
  const entries = Object.freeze(plan.eligible.map((entry) => Object.freeze({
    ...entry,
    recovery: createRecovery(run, repositoryRoot, store, entry)
  })));
  const authorization = createAuthorization({
    repository,
    repositoryRoot,
    commonDir,
    remote,
    remoteUrl,
    remoteMainSha: exactRemoteMain,
    defaultBranch: provider.defaultBranch,
    entries,
    now
  });
  return await settleAuthorization(
    authorization,
    true,
    plan.protectedBranches,
    plan.unresolvedBranches
  );
}
