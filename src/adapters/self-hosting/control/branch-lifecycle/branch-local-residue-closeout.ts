import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../../../filesystem/write-lease.ts';
import { inspectNoFollowDirectoryChain, type PhysicalDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { runCommandBytes } from '../../../runtime-state/physical/runtime/process.ts';
import {
  parseBranchCloseoutOperationJournal,
  parseBranchCloseoutOperationReceipt,
  parseBranchCloseoutReceipt
} from './branch-closeout-contract.ts';
import { parsePreparedBranchCloseoutEnvelope } from './branch-closeout.ts';
import {
  assertGitBranchName,
  assertGitSha,
  branchLifecycleDigest
} from './branch-lifecycle-audit.ts';
import {
  createBranchLifecycleGitChildEnvironment,
  createBranchLifecycleGitHubRemoteObservation,
  decodeBranchLifecycleChildError,
  decodeBranchLifecycleChildStdout
} from './branch-lifecycle-command.ts';
import { parseRepositoryFullName } from './branch-lifecycle-inventory.ts';
import {
  acquireBranchRecoveryStore,
  type BranchRecoveryStore
} from './branch-recovery.ts';
import {
  gcCompletedWorktreePhysicalCloseoutEvidence,
  type WorktreePhysicalCloseoutEvidenceGcResult
} from './worktree-physical-closeout.ts';

const AUTHORIZATION_SCHEMA = 'sec-local-branch-residue-closeout-authorization-v1' as const;
const RECEIPT_SCHEMA = 'sec-local-branch-residue-closeout-receipt-v1' as const;
const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;
const MERGED_PULL_REQUEST_LIMIT = 1_000;

type Digest = `sha256:${string}`;

export interface MergedPullRequestHead {
  readonly number: number;
  readonly headBranch: string;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly mergeCommitSha: string;
  readonly state: 'MERGED';
  readonly url: string;
}

export interface LocalBranchResidueObservation {
  readonly defaultBranch: string;
  readonly localRefs: Readonly<Record<string, string>>;
  readonly remoteRefs: Readonly<Record<string, string>>;
  readonly worktreeBranches: readonly string[];
  readonly worktreeRoots: readonly string[];
  readonly mergedPullRequests: readonly MergedPullRequestHead[];
}

export interface RepositoryProviderObservation {
  readonly repository: string;
  readonly defaultBranch: string;
}

interface LocalBranchResiduePlanEntry {
  readonly branch: string;
  readonly headSha: string;
  readonly pullRequestNumber: number;
  readonly mergeCommitSha: string;
  readonly pullRequestUrl: string;
}

export interface LocalBranchResiduePlan {
  readonly eligible: readonly LocalBranchResiduePlanEntry[];
  readonly protectedBranches: readonly string[];
  readonly unresolvedBranches: readonly string[];
}

interface RecoveryBinding {
  readonly path: string;
  readonly digest: Digest;
  readonly device: string;
  readonly inode: string;
  readonly checksumDevice: string;
  readonly checksumInode: string;
}

interface PhysicalDirectoryBinding {
  readonly path: string;
  readonly finalPath: string;
  readonly device: string;
  readonly inode: string;
  readonly objectId: string;
  readonly ancestorChainDigest: Digest;
}

interface AuthorizationEntry extends LocalBranchResiduePlanEntry {
  readonly recovery: RecoveryBinding;
}

interface LocalBranchResidueAuthorization {
  readonly schema: typeof AUTHORIZATION_SCHEMA;
  readonly operationId: Digest;
  readonly repository: string;
  readonly repositoryRoot: string;
  readonly commonDir: string;
  readonly remote: string;
  readonly remoteUrl: string;
  readonly repositoryPhysical: PhysicalDirectoryBinding;
  readonly commonDirPhysical: PhysicalDirectoryBinding;
  readonly recoveryRootPhysical: PhysicalDirectoryBinding;
  readonly remoteMainSha: string;
  readonly defaultBranch: string;
  readonly entries: readonly AuthorizationEntry[];
  readonly authorizedAt: string;
  readonly authorizationDigest: Digest;
}

interface LocalBranchResidueReceipt {
  readonly schema: typeof RECEIPT_SCHEMA;
  readonly operationId: Digest;
  readonly authorizationDigest: Digest;
  readonly repository: string;
  readonly remoteMainSha: string;
  readonly entries: readonly AuthorizationEntry[];
  readonly effect: 'delete-exact-transaction';
  readonly completedAt: string;
  readonly receiptDigest: Digest;
}

interface CommandResult {
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export type CommandRunner = (
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  input?: string,
  environment?: Readonly<NodeJS.ProcessEnv>
) => CommandResult | Promise<CommandResult>;

function digest(value: unknown): Digest {
  return branchLifecycleDigest(value);
}

function sha256Bytes(bytes: Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalSource(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function bindPhysicalDirectory(chain: PhysicalDirectoryChain): PhysicalDirectoryBinding {
  return Object.freeze({
    path: chain.target.path,
    finalPath: chain.target.finalPath,
    device: chain.target.device,
    inode: chain.target.inode,
    objectId: chain.target.objectId,
    ancestorChainDigest: digest(chain.ancestors)
  });
}

function assertPhysicalDirectoryBinding(
  expected: PhysicalDirectoryBinding,
  current: PhysicalDirectoryChain,
  label: string
): void {
  const actual = bindPhysicalDirectory(current);
  if (canonicalSource(actual) !== canonicalSource(expected)) {
    throw new Error(`${label} physical identity changed after authorization.`);
  }
}

async function defaultRunner(
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  input?: string,
  environment?: Readonly<NodeJS.ProcessEnv>
): Promise<CommandResult> {
  if (args.some((argument) => argument.includes('\0'))) {
    throw new Error('Local branch residue closeout argument contains NUL.');
  }
  const result = await runCommandBytes(command, [...args], {
    cwd,
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxStdoutBytes: COMMAND_MAX_BUFFER,
    maxStderrBytes: COMMAND_MAX_BUFFER,
    ...(input === undefined ? {} : {
      input: Buffer.from(input, 'utf8'),
      maxStdinBytes: Buffer.byteLength(input, 'utf8')
    }),
    envMode: 'replace',
    env: {
      ...(environment ?? (command === 'git'
        ? createBranchLifecycleGitChildEnvironment(process.env)
        : process.env)),
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  return {
    status: result.code,
    stdout: Buffer.from(result.stdout),
    stderr: Buffer.from(result.stderr, 'utf8')
  };
}

async function requireText(
  run: CommandRunner,
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  label: string,
  input?: string,
  environment?: Readonly<NodeJS.ProcessEnv>
): Promise<string> {
  const result = await run(command, args, cwd, input, environment);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return decodeBranchLifecycleChildStdout(result);
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

export function parseRepositoryProviderObservation(
  source: string,
  expectedRepository: string
): RepositoryProviderObservation {
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

export function parseMergedPullRequestHeads(
  source: string,
  expectedRepository: string
): readonly MergedPullRequestHead[] {
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
    const entry: MergedPullRequestHead = {
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

export function planMergedLocalBranchResidueCloseout(
  input: LocalBranchResidueObservation
): LocalBranchResiduePlan {
  assertGitBranchName(input.defaultBranch, 'default branch');
  const worktreeBranches = new Set(input.worktreeBranches);
  const eligible: LocalBranchResiduePlanEntry[] = [];
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

async function verifyBundleBytes(
  run: CommandRunner,
  repositoryRoot: string,
  entry: LocalBranchResiduePlanEntry,
  bytes: Uint8Array,
  label: string
): Promise<void> {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-local-branch-residue-verify-'));
  const temporaryBundle = path.join(temporaryRoot, 'recovery.bundle');
  try {
    writeFileSync(temporaryBundle, bytes, { flag: 'wx' });
    const verify = await run('git', ['bundle', 'verify', temporaryBundle], repositoryRoot);
    if (verify.status !== 0) {
      throw new Error(`${label} verification failed for ${entry.branch}: ${decodeBranchLifecycleChildError(verify)}`);
    }
    const heads = await requireText(run, 'git', ['bundle', 'list-heads', temporaryBundle], repositoryRoot,
      `${label} head readback for ${entry.branch}`);
    if (!heads.split(/\r?\n/u).some((line) => line.startsWith(`${entry.headSha} `))) {
      throw new Error(`${label} does not contain ${entry.branch}@${entry.headSha}.`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function bindRecoveryFiles(
  store: BranchRecoveryStore,
  name: string,
  bundleDigest: Digest
): RecoveryBinding {
  const bundle = store.inspectFile(name);
  const checksum = store.inspectFile(`${name}.sha256`);
  if (bundle === null || checksum === null) {
    throw new Error(`Recovery publication disappeared before physical binding: ${name}`);
  }
  return Object.freeze({
    path: path.join(store.root.path, name),
    digest: bundleDigest,
    device: bundle.device,
    inode: bundle.inode,
    checksumDevice: checksum.device,
    checksumInode: checksum.inode
  });
}

async function createRecovery(
  run: CommandRunner,
  repositoryRoot: string,
  store: BranchRecoveryStore,
  entry: LocalBranchResiduePlanEntry
): Promise<RecoveryBinding> {
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
    await verifyBundleBytes(run, repositoryRoot, entry, existing, 'Existing recovery bundle');
    return bindRecoveryFiles(store, name, bundleDigest);
  }
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-local-branch-residue-'));
  const temporaryBundle = path.join(temporaryRoot, 'recovery.bundle');
  try {
    await requireText(run, 'git', ['bundle', 'create', temporaryBundle, `refs/heads/${entry.branch}`],
      repositoryRoot, `recovery bundle creation for ${entry.branch}`);
    const bytes = readFileSync(temporaryBundle);
    if (bytes.byteLength === 0) throw new Error(`Recovery bundle is empty for ${entry.branch}.`);
    await verifyBundleBytes(run, repositoryRoot, entry, bytes, 'Recovery bundle');
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
    return bindRecoveryFiles(store, name, bundleDigest);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function assertRecoveryBytes(
  store: BranchRecoveryStore,
  entry: AuthorizationEntry
): Uint8Array {
  const name = path.basename(entry.recovery.path);
  if (entry.recovery.path !== path.join(store.root.path, name)
      || !name.startsWith('sec-local-branch-residue-') || !name.endsWith('.bundle')) {
    throw new Error(`Recovery path escaped the canonical recovery owner for ${entry.branch}.`);
  }
  const bundle = store.inspectFile(name);
  if (bundle === null || bundle.bytes === null
      || bundle.device !== entry.recovery.device
      || bundle.inode !== entry.recovery.inode
      || sha256Bytes(bundle.bytes) !== entry.recovery.digest) {
    throw new Error(`Recovery bytes changed for ${entry.branch}.`);
  }
  const expectedChecksum = Buffer.from(
    `${entry.recovery.digest.slice('sha256:'.length)}  ${name}\n`,
    'utf8'
  );
  const checksum = store.inspectFile(`${name}.sha256`);
  if (checksum === null || checksum.bytes === null
      || checksum.device !== entry.recovery.checksumDevice
      || checksum.inode !== entry.recovery.checksumInode
      || !Buffer.from(checksum.bytes).equals(expectedChecksum)) {
    throw new Error(`Recovery checksum changed for ${entry.branch}.`);
  }
  return bundle.bytes;
}

async function verifyRecovery(
  run: CommandRunner,
  repositoryRoot: string,
  store: BranchRecoveryStore,
  entry: AuthorizationEntry
): Promise<void> {
  const bytes = assertRecoveryBytes(store, entry);
  await verifyBundleBytes(run, repositoryRoot, entry, bytes, 'Recovery bundle live');
}

async function observe(
  run: CommandRunner,
  repositoryRoot: string,
  repository: string,
  defaultBranch: string
): Promise<LocalBranchResidueObservation> {
  const remoteObservation = createBranchLifecycleGitHubRemoteObservation(
    repository,
    process.env
  );
  const worktrees = await requireText(run, 'git', [
    'worktree', 'list', '--porcelain', '-z'
  ], repositoryRoot, 'worktree observation');
  return Object.freeze({
    defaultBranch,
    localRefs: parseLocalRefs(await requireText(run, 'git', [
      'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)%00', 'refs/heads/'
    ], repositoryRoot, 'local branch observation')),
    remoteRefs: parseRemoteRefs(await requireText(run, 'git', [
      ...remoteObservation.argumentsPrefix,
      'ls-remote', '--heads', remoteObservation.repositoryUrl
    ], repositoryRoot, 'remote branch observation', undefined, remoteObservation.environment)),
    worktreeBranches: parseWorktreeBranches(worktrees),
    worktreeRoots: parseWorktreeRoots(worktrees),
    mergedPullRequests: parseMergedPullRequestHeads(await requireText(run, 'gh', [
      'pr', 'list', '--repo', repository, '--state', 'merged', '--limit',
      String(MERGED_PULL_REQUEST_LIMIT), '--json',
      'number,headRefName,headRefOid,baseRefName,state,mergeCommit,url'
    ], repositoryRoot, 'merged pull request observation'), repository)
  });
}

function remoteMainSha(observation: LocalBranchResidueObservation): string {
  const value = observation.remoteRefs[observation.defaultBranch];
  if (value === undefined) throw new Error('Remote default branch is absent.');
  return value;
}

async function assertMergeCommitsReachable(
  run: CommandRunner,
  repositoryRoot: string,
  remoteMain: string,
  entries: readonly LocalBranchResiduePlanEntry[]
): Promise<void> {
  for (const entry of entries) {
    const result = await run('git', ['merge-base', '--is-ancestor', entry.mergeCommitSha, remoteMain], repositoryRoot);
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
  repositoryPhysical: PhysicalDirectoryBinding;
  commonDirPhysical: PhysicalDirectoryBinding;
  recoveryRootPhysical: PhysicalDirectoryBinding;
  remoteMainSha: string;
  defaultBranch: string;
  entries: readonly AuthorizationEntry[];
  now: () => Date;
}>): LocalBranchResidueAuthorization {
  const material = Object.freeze({
    schema: AUTHORIZATION_SCHEMA,
    repository: input.repository,
    repositoryRoot: input.repositoryRoot,
    commonDir: input.commonDir,
    remote: input.remote,
    remoteUrl: input.remoteUrl,
    repositoryPhysical: input.repositoryPhysical,
    commonDirPhysical: input.commonDirPhysical,
    recoveryRootPhysical: input.recoveryRootPhysical,
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

function parseAuthorizationEntries(value: unknown): readonly AuthorizationEntry[] {
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
    const recoveryKeys = [
      'path', 'digest', 'device', 'inode', 'checksumDevice', 'checksumInode'
    ].sort();
    if (Object.keys(recoveryRecord).sort().join(',') !== recoveryKeys.join(',')) {
      throw new Error(`Authorization recovery ${index} shape is invalid.`);
    }
    const result: AuthorizationEntry = {
      branch: String(entry.branch),
      headSha: String(entry.headSha),
      pullRequestNumber: Number(entry.pullRequestNumber),
      mergeCommitSha: String(entry.mergeCommitSha),
      pullRequestUrl: String(entry.pullRequestUrl),
      recovery: {
        path: String(recoveryRecord.path),
        digest: String(recoveryRecord.digest) as Digest,
        device: String(recoveryRecord.device),
        inode: String(recoveryRecord.inode),
        checksumDevice: String(recoveryRecord.checksumDevice),
        checksumInode: String(recoveryRecord.checksumInode)
      }
    };
    assertGitBranchName(result.branch, `authorization entry ${index} branch`);
    assertGitSha(result.headSha, `authorization entry ${index} head`);
    assertGitSha(result.mergeCommitSha, `authorization entry ${index} merge commit`);
    if (!Number.isSafeInteger(result.pullRequestNumber) || result.pullRequestNumber < 1) {
      throw new Error(`Authorization entry ${index} pull request number is invalid.`);
    }
    assertDigest(result.recovery.digest, `authorization entry ${index} recovery digest`);
    if ([
      result.recovery.device,
      result.recovery.inode,
      result.recovery.checksumDevice,
      result.recovery.checksumInode
    ].some((identity) => identity.length === 0 || identity.length > 256)) {
      throw new Error(`Authorization recovery ${index} physical identity is invalid.`);
    }
    return Object.freeze(result);
  }));
}

function parsePhysicalDirectoryBinding(
  value: unknown,
  label: string
): PhysicalDirectoryBinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} physical binding must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'path', 'finalPath', 'device', 'inode', 'objectId', 'ancestorChainDigest'
  ].sort();
  if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')) {
    throw new Error(`${label} physical binding shape is invalid.`);
  }
  const result: PhysicalDirectoryBinding = {
    path: String(record.path),
    finalPath: String(record.finalPath),
    device: String(record.device),
    inode: String(record.inode),
    objectId: String(record.objectId),
    ancestorChainDigest: String(record.ancestorChainDigest) as Digest
  };
  assertDigest(result.ancestorChainDigest, `${label} ancestor chain digest`);
  if (!path.isAbsolute(result.path) || result.finalPath.length === 0
      || [result.device, result.inode, result.objectId].some((entry) => (
        entry.length === 0 || entry.length > 512
      ))) {
    throw new Error(`${label} physical binding identity is invalid.`);
  }
  return Object.freeze(result);
}

function parseAuthorization(source: Uint8Array): LocalBranchResidueAuthorization {
  const text = Buffer.from(source).toString('utf8');
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local branch residue authorization must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'schema', 'operationId', 'repository', 'repositoryRoot', 'commonDir', 'remote', 'remoteUrl',
    'repositoryPhysical', 'commonDirPhysical', 'recoveryRootPhysical',
    'remoteMainSha', 'defaultBranch', 'entries', 'authorizedAt', 'authorizationDigest'
  ].sort();
  if (Object.keys(record).sort().join(',') !== expectedKeys.join(',')
      || record.schema !== AUTHORIZATION_SCHEMA || !Array.isArray(record.entries)) {
    throw new Error('Local branch residue authorization shape is invalid.');
  }
  const entries = parseAuthorizationEntries(record.entries);
  const parsed: LocalBranchResidueAuthorization = {
    schema: AUTHORIZATION_SCHEMA,
    repository: String(record.repository),
    repositoryRoot: String(record.repositoryRoot),
    commonDir: String(record.commonDir),
    remote: String(record.remote),
    remoteUrl: String(record.remoteUrl),
    repositoryPhysical: parsePhysicalDirectoryBinding(record.repositoryPhysical, 'repository'),
    commonDirPhysical: parsePhysicalDirectoryBinding(record.commonDirPhysical, 'common directory'),
    recoveryRootPhysical: parsePhysicalDirectoryBinding(record.recoveryRootPhysical, 'recovery root'),
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
    repositoryPhysical: parsed.repositoryPhysical,
    commonDirPhysical: parsed.commonDirPhysical,
    recoveryRootPhysical: parsed.recoveryRootPhysical,
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
  authorization: LocalBranchResidueAuthorization,
  now: () => Date
): LocalBranchResidueReceipt {
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

function parseReceipt(source: Uint8Array): LocalBranchResidueReceipt {
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
  const parsed: LocalBranchResidueReceipt = {
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
  store: BranchRecoveryStore;
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
  receipt: LocalBranchResidueReceipt,
  authorization: LocalBranchResidueAuthorization
): void {
  if (receipt.operationId !== authorization.operationId
      || receipt.authorizationDigest !== authorization.authorizationDigest
      || receipt.repository !== authorization.repository
      || receipt.remoteMainSha !== authorization.remoteMainSha
      || canonicalSource(receipt.entries) !== canonicalSource(authorization.entries)) {
    throw new Error(`Receipt differs from authorization ${authorization.operationId}.`);
  }
}

interface ScannedLocalBranchResidueOperations {
  readonly pending: LocalBranchResidueAuthorization | null;
  readonly completed: readonly Readonly<{
    authorization: LocalBranchResidueAuthorization;
    receipt: LocalBranchResidueReceipt;
    names: Readonly<{ authorization: string; receipt: string }>;
  }>[];
}

function scanLocalBranchResidueOperations(
  store: BranchRecoveryStore
): ScannedLocalBranchResidueOperations {
  const names = store.listOwnedFiles('sec-local-branch-residue-')
    .filter((name) => name.endsWith('.authorization.json'));
  const pending: LocalBranchResidueAuthorization[] = [];
  const completed: Array<ScannedLocalBranchResidueOperations['completed'][number]> = [];
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
    const receipt = parseReceipt(receiptBytes);
    assertReceiptMatchesAuthorization(receipt, authorization);
    completed.push(Object.freeze({ authorization, receipt, names: expectedNames }));
  }
  if (pending.length > 1) {
    throw new Error(`Multiple pending local branch residue operations require reconciliation: ${pending.length}.`);
  }
  return Object.freeze({ pending: pending[0] ?? null, completed: Object.freeze(completed) });
}

function safeRecoverySegment(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
}

function removeOwnedRecoveryFile(
  store: BranchRecoveryStore,
  name: string,
  retired: string[]
): void {
  const observed = store.inspectFile(name);
  if (observed === null) return;
  store.removeExact(name, observed);
  retired.push(path.join(store.root.path, name));
}

function retireRecoveryBundleFamily(input: Readonly<{
  store: BranchRecoveryStore;
  bundleName: string;
  expectedDigest: Digest;
  validatedSidecars: readonly string[];
  retired: string[];
}>): void {
  const checksumName = `${input.bundleName}.sha256`;
  const allowedSidecars = new Set([checksumName, ...input.validatedSidecars]);
  const family = input.store.listOwnedFiles(`${input.bundleName}.`);
  const unknown = family.find((name) => !allowedSidecars.has(name));
  if (unknown !== undefined) {
    throw new Error(`Recovery bundle family contains unvalidated evidence: ${unknown}`);
  }
  const checksum = input.store.inspectFile(checksumName);
  const expectedChecksum = Buffer.from(
    `${input.expectedDigest.slice('sha256:'.length)}  ${input.bundleName}\n`,
    'utf8'
  );
  if (checksum !== null && (checksum.bytes === null
      || !Buffer.from(checksum.bytes).equals(expectedChecksum))) {
    throw new Error(`Recovery checksum differs before terminal retirement: ${checksumName}`);
  }
  const bundle = input.store.inspectFile(input.bundleName);
  if (bundle === null) {
    for (const name of [...family]
      .sort((left, right) => right.localeCompare(left))) {
      removeOwnedRecoveryFile(input.store, name, input.retired);
    }
    return;
  }
  if (bundle.bytes === null || `sha256:${createHash('sha256').update(bundle.bytes).digest('hex')}`
      !== input.expectedDigest) {
    throw new Error(`Recovery bundle differs before terminal retirement: ${input.bundleName}`);
  }
  if (checksum === null) {
    throw new Error(`Recovery checksum differs before terminal retirement: ${checksumName}`);
  }
  for (const name of [...family]
    .filter((candidate) => candidate !== checksumName)
    .sort((left, right) => right.localeCompare(left))) {
    removeOwnedRecoveryFile(input.store, name, input.retired);
  }
  removeOwnedRecoveryFile(input.store, checksumName, input.retired);
  removeOwnedRecoveryFile(input.store, input.bundleName, input.retired);
}

function retireSupersededBranchCloseoutBundles(input: Readonly<{
  store: BranchRecoveryStore;
  repository: string;
  entry: AuthorizationEntry;
  retired: string[];
}>): void {
  const prefix = `sec-branch-closeout-${safeRecoverySegment(input.entry.branch)}-`;
  for (const name of [...input.store.listOwnedFiles(prefix)]
    .filter((candidate) => candidate.endsWith('.bundle'))) {
    const bundle = input.store.inspectFile(name);
    if (bundle === null || bundle.bytes === null) continue;
    const digest = `sha256:${createHash('sha256').update(bundle.bytes).digest('hex')}` as Digest;
    if (digest !== input.entry.recovery.digest) continue;
    const family = input.store.listOwnedFiles(`${name}.`);
    const assertPreparationBinding = (preparation: Readonly<{
      repository: Readonly<{ fullName: string }>;
      pullRequestNumber: number | null;
      branch: string;
      expectedHeadSha: string;
      recovery: Readonly<{ sha256: string }>;
    }>, label: string): void => {
      if (preparation.repository.fullName !== input.repository
          || preparation.pullRequestNumber !== input.entry.pullRequestNumber
          || preparation.branch !== input.entry.branch
          || preparation.expectedHeadSha !== input.entry.headSha
          || preparation.recovery.sha256 !== input.entry.recovery.digest) {
        throw new Error(`Duplicate branch-closeout ${label} differs from its recovery family: ${name}`);
      }
    };
    const assertOperationBinding = (binding: Readonly<{
      closeoutOperationId: string;
      repository: string;
      pullRequestNumber: number;
      headSha: string;
      newMainSha: string;
      recoveryDigest: string;
    }>, candidate: string): void => {
      if (binding.repository !== input.repository
          || binding.pullRequestNumber !== input.entry.pullRequestNumber
          || binding.headSha !== input.entry.headSha
          || binding.newMainSha !== input.entry.mergeCommitSha
          || binding.recoveryDigest !== input.entry.recovery.digest) {
        throw new Error(`Duplicate branch-closeout operation differs from its recovery family: ${candidate}`);
      }
    };
    const validatedSidecars: string[] = [];
    const preparationName = `${name}.preparation.json`;
    const preparationBytes = input.store.read(preparationName);
    const preparation = preparationBytes === null
      ? null
      : parsePreparedBranchCloseoutEnvelope(Buffer.from(preparationBytes).toString('utf8'));
    if (preparation !== null) {
      assertPreparationBinding(preparation.preparation, 'preparation');
      validatedSidecars.push(preparationName);
    }
    const receiptName = `${name}.receipt.json`;
    const receiptBytes = input.store.read(receiptName);
    const branchReceipt = receiptBytes === null
      ? null
      : parseBranchCloseoutReceipt(Buffer.from(receiptBytes).toString('utf8'));
    if (branchReceipt !== null) {
      assertPreparationBinding(branchReceipt.preparation, 'receipt');
      validatedSidecars.push(receiptName);
    }
    const operationJournals = family.filter((candidate) => (
      candidate.startsWith(`${name}.closeout-`) && candidate.endsWith('.journal.json')
    )).map((candidate) => {
      const bytes = input.store.read(candidate);
      if (bytes === null) throw new Error(`Duplicate branch-closeout journal disappeared: ${candidate}`);
      const journal = parseBranchCloseoutOperationJournal(Buffer.from(bytes).toString('utf8'));
      const expectedName = `${name}.closeout-${journal.binding.closeoutOperationId.slice('sha256:'.length)}.journal.json`;
      if (candidate !== expectedName) {
        throw new Error(`Duplicate branch-closeout journal filename differs from its operation: ${candidate}`);
      }
      assertOperationBinding(journal.binding, candidate);
      validatedSidecars.push(candidate);
      return journal;
    });
    const terminalReceipts = family.filter((candidate) => (
      candidate.startsWith(`${name}.closeout-`) && candidate.endsWith('.receipt.json')
    )).map((candidate) => {
      const bytes = input.store.read(candidate);
      if (bytes === null) throw new Error(`Duplicate branch-closeout receipt disappeared: ${candidate}`);
      const receipt = parseBranchCloseoutOperationReceipt(Buffer.from(bytes).toString('utf8'));
      const expectedName = `${name}.closeout-${receipt.binding.closeoutOperationId.slice('sha256:'.length)}.receipt.json`;
      if (candidate !== expectedName) {
        throw new Error(`Duplicate branch-closeout receipt differs from its recovery family: ${candidate}`);
      }
      assertOperationBinding(receipt.binding, candidate);
      assertPreparationBinding(receipt.receipt.preparation, 'operation receipt');
      validatedSidecars.push(candidate);
      return receipt;
    });
    const terminalReceiptsByOperation = new Map(terminalReceipts.map((receipt) => (
      [receipt.binding.closeoutOperationId, receipt] as const
    )));
    const operationReceiptsCompleted = terminalReceipts.length > 0 && terminalReceipts.every(
      ({ receipt }) => receipt.status === 'completed'
    );
    const operationJournalsCompleted = operationJournals.every((journal) => {
      const terminal = terminalReceiptsByOperation.get(journal.binding.closeoutOperationId);
      return terminal !== undefined
        && terminal.receipt.status === 'completed'
        && journal.terminalReceiptDigest === terminal.receipt.receiptDigest;
    });
    const hasTerminal = operationJournals.length > 0
      ? operationReceiptsCompleted && operationJournalsCompleted
      : terminalReceipts.length > 0
        ? operationReceiptsCompleted
        : branchReceipt?.status === 'completed';
    const hasLifecycleEvidence = preparation !== null
      || branchReceipt !== null
      || operationJournals.length > 0
      || terminalReceipts.length > 0;
    if (hasLifecycleEvidence && !hasTerminal) continue;
    retireRecoveryBundleFamily({
      store: input.store,
      bundleName: name,
      expectedDigest: input.entry.recovery.digest,
      validatedSidecars,
      retired: input.retired
    });
  }
}

function retireCompletedLocalBranchResidueOperation(input: Readonly<{
  store: BranchRecoveryStore;
  completed: ScannedLocalBranchResidueOperations['completed'][number];
}>): readonly string[] {
  const { authorization, receipt, names } = input.completed;
  assertReceiptMatchesAuthorization(receipt, authorization);
  const retired: string[] = [];
  for (const entry of authorization.entries) {
    const localBundleName = path.basename(entry.recovery.path);
    if (entry.recovery.path !== path.join(input.store.root.path, localBundleName)) {
      throw new Error(`Completed recovery path escaped its canonical owner: ${entry.branch}`);
    }
    retireSupersededBranchCloseoutBundles({
      store: input.store,
      repository: authorization.repository,
      entry,
      retired
    });
    retireRecoveryBundleFamily({
      store: input.store,
      bundleName: localBundleName,
      expectedDigest: entry.recovery.digest,
      validatedSidecars: Object.freeze([]),
      retired
    });
  }
  removeOwnedRecoveryFile(input.store, names.authorization, retired);
  removeOwnedRecoveryFile(input.store, names.receipt, retired);
  return Object.freeze(retired);
}

async function retireOrphanCompletedReceipts(input: Readonly<{
  run: CommandRunner;
  repositoryRoot: string;
  repository: string;
  store: BranchRecoveryStore;
}>): Promise<readonly string[]> {
  const receiptNames = [...input.store.listOwnedFiles('sec-local-branch-residue-')]
    .filter((candidate) => candidate.endsWith('.receipt.json'))
    .filter((candidate) => input.store.read(
      candidate.replace(/\.receipt\.json$/u, '.authorization.json')
    ) === null);
  if (receiptNames.length === 0) return Object.freeze([]);
  return withWorkspaceWriteLease(input.repositoryRoot, undefined, async (lease) => {
    await assertWorkspaceWriteLease(input.repositoryRoot, lease);
    const orphanReceipts = receiptNames.map((name) => {
      const bytes = input.store.read(name);
      if (bytes === null) throw new Error(`Orphan local branch residue receipt disappeared: ${name}`);
      const receipt = parseReceipt(bytes);
      const expected = operationNames(receipt.operationId);
      if (name !== expected.receipt) {
        throw new Error(`Receipt filename differs from its operationId: ${name}`);
      }
      if (input.store.read(expected.authorization) !== null) {
        throw new Error(`Orphan local branch residue authorization reappeared: ${expected.authorization}`);
      }
      if (receipt.repository !== input.repository) {
        throw new Error(`Orphan local branch residue receipt repository differs: ${name}`);
      }
      for (const entry of receipt.entries) {
        if (entry.pullRequestUrl
            !== `https://github.com/${input.repository}/pull/${entry.pullRequestNumber}`) {
          throw new Error(`Orphan local branch residue receipt PR URL differs: ${name}`);
        }
      }
      return Object.freeze({ name, receipt });
    });
    const readLocalRefs = async (label: string): Promise<Readonly<Record<string, string>>> =>
      parseLocalRefs(await requireText(input.run, 'git', [
        'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)%00', 'refs/heads/'
      ], input.repositoryRoot, label));
    const assertRefsAbsent = (
      localRefs: Readonly<Record<string, string>>,
      label: string
    ): void => {
      for (const { receipt } of orphanReceipts) {
        for (const entry of receipt.entries) {
          if (localRefs[entry.branch] !== undefined) {
            throw new Error(`Orphan local branch residue receipt was followed by ref recreation at ${label}: ${entry.branch}`);
          }
        }
      }
    };
    assertRefsAbsent(await readLocalRefs('orphan receipt initial local-ref readback'), 'initial readback');
    for (const { receipt } of orphanReceipts) {
      await assertMergeCommitsReachable(
        input.run,
        input.repositoryRoot,
        receipt.remoteMainSha,
        receipt.entries
      );
    }
    await assertWorkspaceWriteLease(input.repositoryRoot, lease);
    assertRefsAbsent(await readLocalRefs('orphan receipt effect-boundary local-ref readback'), 'effect boundary');
    await assertWorkspaceWriteLease(input.repositoryRoot, lease);
    const retired: string[] = [];
    for (const { name, receipt } of orphanReceipts) {
      const expected = operationNames(receipt.operationId);
      if (input.store.read(expected.authorization) !== null) {
        throw new Error(`Orphan local branch residue authorization reappeared at effect boundary: ${expected.authorization}`);
      }
      removeOwnedRecoveryFile(input.store, name, retired);
    }
    return Object.freeze(retired);
  });
}

async function observeRepositoryProvider(
  run: CommandRunner,
  repositoryRoot: string,
  repository: string
): Promise<RepositoryProviderObservation> {
  return parseRepositoryProviderObservation(await requireText(run, 'gh', [
    'repo', 'view', repository, '--json', 'nameWithOwner,defaultBranchRef'
  ], repositoryRoot, 'repository provider observation'), repository);
}

function pathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function assertRecoverySeparatedFromWorktrees(
  store: BranchRecoveryStore,
  observation: LocalBranchResidueObservation
): void {
  for (const worktree of observation.worktreeRoots) {
    if (pathInside(store.root.path, worktree) || pathInside(worktree, store.root.path)) {
      throw new Error(`Worktree overlaps the canonical recovery root: ${worktree}`);
    }
  }
  store.assertPhysicallyDisjointFrom(observation.worktreeRoots);
}

async function observeWorktreeState(
  run: CommandRunner,
  repositoryRoot: string
): Promise<Readonly<{ branches: readonly string[]; roots: readonly string[] }>> {
  const source = await requireText(run, 'git', [
    'worktree', 'list', '--porcelain', '-z'
  ], repositoryRoot, 'effect-boundary worktree observation');
  return Object.freeze({
    branches: parseWorktreeBranches(source),
    roots: parseWorktreeRoots(source)
  });
}

function assertAuthorizationIdentity(input: Readonly<{
  authorization: LocalBranchResidueAuthorization;
  repository: string;
  repositoryRoot: string;
  commonDir: string;
  remote: string;
  remoteUrl: string;
  provider: RepositoryProviderObservation;
  store: BranchRecoveryStore;
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
  if (authorization.repositoryPhysical.path !== input.repositoryRoot
      || authorization.commonDirPhysical.path !== input.commonDir
      || authorization.recoveryRootPhysical.path !== input.store.root.path) {
    throw new Error('Authorization physical path binding differs from its lexical identity.');
  }
  assertPhysicalDirectoryBinding(
    authorization.repositoryPhysical,
    inspectNoFollowDirectoryChain(input.repositoryRoot, 'Authorized repository root'),
    'Repository root'
  );
  assertPhysicalDirectoryBinding(
    authorization.commonDirPhysical,
    inspectNoFollowDirectoryChain(input.commonDir, 'Authorized Git common directory'),
    'Git common directory'
  );
  assertPhysicalDirectoryBinding(
    authorization.recoveryRootPhysical,
    input.store.rootChain,
    'Recovery root'
  );
  input.store.assertCurrent();
  for (const entry of authorization.entries) {
    if (entry.pullRequestUrl
        !== `https://github.com/${authorization.repository}/pull/${entry.pullRequestNumber}`) {
      throw new Error(`Authorization PR URL differs for #${entry.pullRequestNumber}.`);
    }
  }
}

function authorizedLocalState(
  authorization: LocalBranchResidueAuthorization,
  observation: LocalBranchResidueObservation
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

async function retireCompletedLocalBranchResidueOperations(input: Readonly<{
  run: CommandRunner;
  repositoryRoot: string;
  repository: string;
  commonDir: string;
  remote: string;
  remoteUrl: string;
  provider: RepositoryProviderObservation;
  store: BranchRecoveryStore;
  observation: LocalBranchResidueObservation;
  completed: ScannedLocalBranchResidueOperations['completed'];
}>): Promise<Readonly<{ branches: readonly string[]; files: readonly string[] }>> {
  const branches: string[] = [];
  const files: string[] = [];
  for (const completed of input.completed) {
    assertAuthorizationIdentity({
      authorization: completed.authorization,
      repository: input.repository,
      repositoryRoot: input.repositoryRoot,
      commonDir: input.commonDir,
      remote: input.remote,
      remoteUrl: input.remoteUrl,
      provider: input.provider,
      store: input.store
    });
    if (authorizedLocalState(completed.authorization, input.observation) !== 'absent') {
      throw new Error(
        `Completed local branch residue operation was followed by ref recreation: ${completed.authorization.operationId}`
      );
    }
    await assertMergeCommitsReachable(
      input.run,
      input.repositoryRoot,
      completed.authorization.remoteMainSha,
      completed.authorization.entries
    );
    files.push(...retireCompletedLocalBranchResidueOperation({
      store: input.store,
      completed
    }));
    branches.push(...completed.authorization.entries.map(({ branch }) => branch));
  }
  return Object.freeze({
    branches: Object.freeze([...new Set(branches)].sort((left, right) => left.localeCompare(right))),
    files: Object.freeze(files)
  });
}

function assertAuthorizedObservation(
  authorization: LocalBranchResidueAuthorization,
  observation: LocalBranchResidueObservation
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

async function deleteExactTransaction(
  run: CommandRunner,
  repositoryRoot: string,
  entries: readonly AuthorizationEntry[]
): Promise<void> {
  const source = ['start', ...entries.map((entry) => (
    `delete refs/heads/${entry.branch} ${entry.headSha}`
  )), 'prepare', 'commit', ''].join('\n');
  await requireText(run, 'git', ['update-ref', '--stdin'], repositoryRoot,
    'atomic local branch residue closeout', source);
}

export async function executeMergedLocalBranchResidueCloseout(input: Readonly<{
  repositoryRoot: string;
  remote?: string;
  recoveryRoot?: string;
  now?: () => Date;
  run?: CommandRunner;
  faults?: Readonly<{
    afterAuthorization?: () => void;
    afterDelete?: () => void;
    afterReadback?: () => void;
    beforeReceipt?: () => void;
    afterReceipt?: () => void;
  }>;
}>): Promise<Readonly<{
  schema: 'sec-local-branch-residue-closeout-result-v2';
  settled: readonly string[];
  protectedBranches: readonly string[];
  unresolvedBranches: readonly string[];
  authorizationPath: string | null;
  receiptPath: string | null;
  retiredRecoveryFiles: readonly string[];
  recoveryRootRetired: boolean;
  worktreeEvidenceGc: WorktreePhysicalCloseoutEvidenceGcResult;
}>> {
  const run = input.run ?? defaultRunner;
  const now = input.now ?? (() => new Date());
  const requestedRoot = path.resolve(input.repositoryRoot);
  const repositoryRoot = realpathSync(await requireText(run, 'git', ['rev-parse', '--show-toplevel'],
    requestedRoot, 'repository root'));
  const commonRaw = await requireText(run, 'git', ['rev-parse', '--git-common-dir'],
    repositoryRoot, 'Git common directory');
  const commonDir = realpathSync(path.isAbsolute(commonRaw)
    ? commonRaw
    : path.resolve(repositoryRoot, commonRaw));
  const repositoryPhysical = inspectNoFollowDirectoryChain(
    repositoryRoot,
    'Local branch residue repository root'
  );
  const commonDirPhysical = inspectNoFollowDirectoryChain(
    commonDir,
    'Local branch residue Git common directory'
  );
  const remote = input.remote ?? 'origin';
  assertGitBranchName(remote, 'remote');
  const remoteUrl = await requireText(run, 'git', ['remote', 'get-url', remote],
    repositoryRoot, 'remote URL');
  const repository = parseRepositoryFullName(remoteUrl);
  if (repository === null) throw new Error('Repository identity cannot be resolved from the canonical remote URL.');
  const provider = await observeRepositoryProvider(run, repositoryRoot, repository);
  const initialWorktrees = await requireText(run, 'git', [
    'worktree', 'list', '--porcelain', '-z'
  ], repositoryRoot, 'initial worktree observation');
  const initialWorktreeEvidenceGc = await gcCompletedWorktreePhysicalCloseoutEvidence(repositoryRoot);
  const store = acquireBranchRecoveryStore({
    repositoryRoot,
    commonDir,
    worktreeRoots: parseWorktreeRoots(initialWorktrees),
    ...(input.recoveryRoot === undefined ? {} : { recoveryRoot: input.recoveryRoot })
  });
  const retireRecoveryRoot = input.recoveryRoot === undefined
    || store.createdByAcquisition;
  const mergeWorktreeEvidenceGc = (
    initial: WorktreePhysicalCloseoutEvidenceGcResult,
    final: WorktreePhysicalCloseoutEvidenceGcResult
  ): WorktreePhysicalCloseoutEvidenceGcResult => Object.freeze({
    schema: 'sec-worktree-physical-closeout-evidence-gc-v1' as const,
    retiredOperationIds: Object.freeze([...new Set([
      ...initial.retiredOperationIds,
      ...final.retiredOperationIds
    ])].sort((left, right) => left.localeCompare(right))),
    ownerRetired: initial.ownerRetired || final.ownerRetired,
    retained: final.retained
  });

  const settleAuthorization = async (
    authorization: LocalBranchResidueAuthorization,
    publishAuthorization: boolean,
    protectedBranches: readonly string[],
    unresolvedBranches: readonly string[]
  ) => {
    const names = operationNames(authorization.operationId);
    await withWorkspaceWriteLease(repositoryRoot, undefined, async (lease) => {
      await assertWorkspaceWriteLease(repositoryRoot, lease);
      const currentProvider = await observeRepositoryProvider(run, repositoryRoot, repository);
      assertAuthorizationIdentity({
        authorization,
        repository,
        repositoryRoot,
        commonDir,
        remote,
        remoteUrl,
        provider: currentProvider,
        store
      });
      const current = await observe(
        run,
        repositoryRoot,
        repository,
        authorization.defaultBranch
      );
      assertRecoverySeparatedFromWorktrees(store, current);
      const state = assertAuthorizedObservation(authorization, current);
      await assertMergeCommitsReachable(
        run,
        repositoryRoot,
        authorization.remoteMainSha,
        authorization.entries
      );
      for (const entry of authorization.entries) {
        await verifyRecovery(run, repositoryRoot, store, entry);
      }
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
      const effectWorktrees = await observeWorktreeState(run, repositoryRoot);
      for (const entry of authorization.entries) {
        if (effectWorktrees.branches.includes(entry.branch)) {
          throw new Error(`Worktree acquired branch at the ref effect boundary: ${entry.branch}.`);
        }
      }
      store.assertPhysicallyDisjointFrom(effectWorktrees.roots);
      assertPhysicalDirectoryBinding(
        authorization.repositoryPhysical,
        inspectNoFollowDirectoryChain(repositoryRoot, 'Ref effect repository root'),
        'Repository root'
      );
      assertPhysicalDirectoryBinding(
        authorization.commonDirPhysical,
        inspectNoFollowDirectoryChain(commonDir, 'Ref effect Git common directory'),
        'Git common directory'
      );
      for (const entry of authorization.entries) assertRecoveryBytes(store, entry);
      if (state === 'present') {
        await deleteExactTransaction(run, repositoryRoot, authorization.entries);
        input.faults?.afterDelete?.();
      }
      await assertWorkspaceWriteLease(repositoryRoot, lease);
      const localReadback = parseLocalRefs(await requireText(run, 'git', [
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
      input.faults?.afterReceipt?.();
      store.assertCurrent();
    });
    const completed = scanLocalBranchResidueOperations(store).completed
      .find((candidate) => candidate.authorization.operationId === authorization.operationId);
    if (completed === undefined) {
      throw new Error(`Completed local branch residue receipt disappeared: ${authorization.operationId}`);
    }
    const current = await observe(run, repositoryRoot, repository, authorization.defaultBranch);
    const retirement = await retireCompletedLocalBranchResidueOperations({
      run,
      repositoryRoot,
      repository,
      commonDir,
      remote,
      remoteUrl,
      provider,
      store,
      observation: current,
      completed: [completed]
    });
    const recoveryRootRetired = retireRecoveryRoot && store.retireIfEmpty();
    const finalWorktreeEvidenceGc = initialWorktreeEvidenceGc.retained.some(
      ({ reason }) => reason === 'branch-live'
    )
      ? await gcCompletedWorktreePhysicalCloseoutEvidence(repositoryRoot)
      : initialWorktreeEvidenceGc;
    return Object.freeze({
      schema: 'sec-local-branch-residue-closeout-result-v2' as const,
      settled: Object.freeze(authorization.entries.map(({ branch }) => branch)),
      protectedBranches,
      unresolvedBranches,
      authorizationPath: null,
      receiptPath: null,
      retiredRecoveryFiles: retirement.files,
      recoveryRootRetired,
      worktreeEvidenceGc: mergeWorktreeEvidenceGc(
        initialWorktreeEvidenceGc,
        finalWorktreeEvidenceGc
      )
    });
  };

  const orphanReceiptFiles = await retireOrphanCompletedReceipts({
    run,
    repositoryRoot,
    repository,
    store
  });
  const scanned = scanLocalBranchResidueOperations(store);
  let retiredBefore = Object.freeze({
    branches: Object.freeze([]) as readonly string[],
    files: orphanReceiptFiles
  });
  if (scanned.completed.length > 0) {
    const current = await observe(run, repositoryRoot, repository, provider.defaultBranch);
    const completedRetirement = await retireCompletedLocalBranchResidueOperations({
      run,
      repositoryRoot,
      repository,
      commonDir,
      remote,
      remoteUrl,
      provider,
      store,
      observation: current,
      completed: scanned.completed
    });
    retiredBefore = Object.freeze({
      branches: completedRetirement.branches,
      files: Object.freeze([...orphanReceiptFiles, ...completedRetirement.files])
    });
  }
  const pending = scanned.pending;
  if (pending !== null) {
    assertAuthorizationIdentity({
      authorization: pending,
      repository,
      repositoryRoot,
      commonDir,
      remote,
      remoteUrl,
      provider,
      store
    });
    const settled = await settleAuthorization(pending, false, Object.freeze([]), Object.freeze([]));
    return Object.freeze({
      ...settled,
      settled: Object.freeze([...new Set([...retiredBefore.branches, ...settled.settled])]
        .sort((left, right) => left.localeCompare(right))),
      retiredRecoveryFiles: Object.freeze([...retiredBefore.files, ...settled.retiredRecoveryFiles])
    });
  }

  const first = await observe(run, repositoryRoot, repository, provider.defaultBranch);
  assertRecoverySeparatedFromWorktrees(store, first);
  const plan = planMergedLocalBranchResidueCloseout(first);
  if (plan.eligible.length === 0) {
    return Object.freeze({
      schema: 'sec-local-branch-residue-closeout-result-v2',
      settled: retiredBefore.branches,
      protectedBranches: plan.protectedBranches,
      unresolvedBranches: plan.unresolvedBranches,
      authorizationPath: null,
      receiptPath: null,
      retiredRecoveryFiles: retiredBefore.files,
      recoveryRootRetired: retireRecoveryRoot && store.retireIfEmpty(),
      worktreeEvidenceGc: initialWorktreeEvidenceGc
    });
  }
  const exactRemoteMain = remoteMainSha(first);
  await assertMergeCommitsReachable(run, repositoryRoot, exactRemoteMain, plan.eligible);
  const entries = Object.freeze(await Promise.all(plan.eligible.map(async (entry) => Object.freeze({
    ...entry,
    recovery: await createRecovery(run, repositoryRoot, store, entry)
  }))));
  const authorization = createAuthorization({
    repository,
    repositoryRoot,
    commonDir,
    remote,
    remoteUrl,
    repositoryPhysical: bindPhysicalDirectory(repositoryPhysical),
    commonDirPhysical: bindPhysicalDirectory(commonDirPhysical),
    recoveryRootPhysical: bindPhysicalDirectory(store.rootChain),
    remoteMainSha: exactRemoteMain,
    defaultBranch: provider.defaultBranch,
    entries,
    now
  });
  const settled = await settleAuthorization(
    authorization,
    true,
    plan.protectedBranches,
    plan.unresolvedBranches
  );
  return Object.freeze({
    ...settled,
    settled: Object.freeze([...new Set([...retiredBefore.branches, ...settled.settled])]
      .sort((left, right) => left.localeCompare(right))),
    retiredRecoveryFiles: Object.freeze([...retiredBefore.files, ...settled.retiredRecoveryFiles])
  });
}
