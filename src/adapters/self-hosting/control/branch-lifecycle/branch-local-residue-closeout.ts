import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import { bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan, issueSemanticOperationAttemptContext, type OperationDigest } from '../../../../execution/operation/semantic.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../../filesystem/write-lease.ts';
import { inspectGitBundleBytes } from '../../../providers/git-bundle/runtime.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { executeGitHubApiOperation, withGitHubApiReadSession } from '../../../providers/github-api/operation-session.ts';
import { assertGitPhysicalProviderReceipt, closeGitPhysicalProvider, openGitPhysicalProvider } from '../../../providers/git/physical-provider.ts';
import { assertGitLocalRefDeleteBatchReceipt, deleteExactLocalGitRefs, MAXIMUM_LOCAL_REF_DELETE_INPUT_BYTES, MAXIMUM_LOCAL_REF_DELETE_OUTPUT_BYTES, measureExactLocalGitRefDeleteBatchInputBytes, measureExactLocalGitRefDeleteBatchOutputBytes } from '../../../providers/git/ref-effect.ts';
import { inspectNoFollowDirectoryChain, type PhysicalDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { GIT_READ_OPERATION_BUDGET, parseNulUtf8 } from '../../development/tooling/git/git-read.ts';
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
import { assertClosedSupersessionEvidence, summarizeClosedSupersessionPaths, type ClosedSupersessionEvidence } from './closed-supersession-review.ts';
import { observeProductionClosedSupersessionEvidence } from './closed-unmerged-closeout-production.ts';
import {
  gcCompletedWorktreePhysicalCloseoutEvidence,
  type WorktreePhysicalCloseoutEvidenceGcResult
} from './worktree-physical-closeout.ts';

const AUTHORIZATION_SCHEMA = 'sec-local-branch-residue-closeout-authorization-v1' as const;
const RECEIPT_SCHEMA = 'sec-local-branch-residue-closeout-receipt-v1' as const;
const RETAINED_AUTHORIZATION_SCHEMA = 'sec-local-branch-residue-closeout-authorization-v2' as const;
const RETAINED_RECEIPT_SCHEMA = 'sec-local-branch-residue-closeout-receipt-v2' as const;
const COMMAND_TIMEOUT_MS = 60_000;
const MERGED_PULL_REQUEST_LIMIT = 1_000;
const REF_EFFECT_REQUIREMENT = 'branch-lifecycle.merged-local.ref-delete';
const REF_EFFECT_CONTRACT = branchLifecycleDigest({ owner: 'control.branch-lifecycle', operation: 'merged-local-ref-delete', effect: 'exact-batch-native-git-ref-cas' }) as OperationDigest;
const REF_EFFECT_PROVIDER = branchLifecycleDigest({ provider: 'external-capabilities.git.physical-provider', operation: REF_EFFECT_REQUIREMENT }) as OperationDigest;

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

interface RetainedReviewBinding {
  readonly pullRequestNumber: number;
  readonly commentId: number;
  readonly reference: string;
  readonly receiptDigest: Digest;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly pathSet: Readonly<{ count: number; digest: Digest }>;
}

interface RetentionEvidence {
  readonly branch: string;
  readonly headSha: string;
  readonly sourceTreeSha: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly basis: 'native-ancestor' | 'identical-tree' | 'reviewed-supersession';
  readonly review: RetainedReviewBinding | null;
}

interface RetainedLocalBranchAuthorization {
  readonly schema: typeof RETAINED_AUTHORIZATION_SCHEMA;
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
  readonly entries: readonly RetentionEvidence[];
  readonly authorizedAt: string;
  readonly authorizationDigest: Digest;
}

interface RetainedLocalBranchReceipt {
  readonly schema: typeof RETAINED_RECEIPT_SCHEMA;
  readonly operationId: Digest;
  readonly authorizationDigest: Digest;
  readonly repository: string;
  readonly remoteMainSha: string;
  readonly entries: readonly RetentionEvidence[];
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
  return `sha256:${rawSha256Hex(bytes)}`;
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
  if (command !== 'git') {
    throw new Error('Production local branch residue transport only admits Git observations.');
  }
  return withAuthorityGitReadSession({
    cwd,
    budget: GIT_READ_OPERATION_BUDGET,
    environment: environment ?? createBranchLifecycleGitChildEnvironment(process.env),
    deadlineAtUnixMs: Date.now() + COMMAND_TIMEOUT_MS
  }, async (session) => {
    const observed = await session.run(args, input === undefined
      ? undefined
      : { input: Buffer.from(input, 'utf8') });
    if (observed.kind !== 'completed') {
      return Object.freeze({
        status: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(observed.detail, 'utf8')
      });
    }
    return Object.freeze({
      status: observed.result.code,
      stdout: Buffer.from(observed.result.stdout),
      stderr: Buffer.from(observed.result.stderr, 'utf8')
    });
  });
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

function parseGitHubRepositoryProviderObservation(
  value: unknown,
  expectedRepository: string
): RepositoryProviderObservation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GitHub repository provider observation must be an object.');
  }
  const record = value as Record<string, unknown>;
  const result = Object.freeze({
    repository: String(record.full_name),
    defaultBranch: String(record.default_branch)
  });
  if (result.repository !== expectedRepository) {
    throw new Error(`Repository provider identity differs: expected ${expectedRepository}, observed ${result.repository}.`);
  }
  assertGitBranchName(result.defaultBranch, 'provider default branch');
  return result;
}

async function observeProductionRepositoryProvider(
  repositoryRoot: string,
  repository: string
): Promise<RepositoryProviderObservation> {
  return await withGitHubApiReadSession({
    repositoryRoot,
    repository,
    operation: async (capability) => parseGitHubRepositoryProviderObservation(
      await executeGitHubApiOperation(capability, { kind: 'repository' }), repository
    )
  });
}

function parseGitHubMergedPullRequestPage(
  value: unknown,
  expectedRepository: string
): readonly MergedPullRequestHead[] {
  if (!Array.isArray(value)) throw new Error('GitHub merged pull request page must be an array.');
  if (value.length > 100) throw new Error('GitHub merged pull request page exceeds its 100-item bound.');
  const result: MergedPullRequestHead[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`GitHub merged pull request ${index} must be an object.`);
    }
    const record = candidate as Record<string, unknown>;
    if (record.merged_at === null) continue;
    const head = record.head;
    const base = record.base;
    if (head === null || typeof head !== 'object' || Array.isArray(head)
        || base === null || typeof base !== 'object' || Array.isArray(base)) {
      throw new Error(`GitHub merged pull request ${index} has invalid head/base identity.`);
    }
    const headRecord = head as Record<string, unknown>;
    const baseRecord = base as Record<string, unknown>;
    const baseRepo = baseRecord.repo;
    if (baseRepo === null || typeof baseRepo !== 'object' || Array.isArray(baseRepo)
        || (baseRepo as Record<string, unknown>).full_name !== expectedRepository) {
      throw new Error(`GitHub merged pull request ${index} base repository differs from ${expectedRepository}.`);
    }
    const entry: MergedPullRequestHead = {
      number: Number(record.number),
      headBranch: String(headRecord.ref),
      headSha: String(headRecord.sha),
      baseBranch: String(baseRecord.ref),
      mergeCommitSha: String(record.merge_commit_sha),
      state: 'MERGED',
      url: String(record.html_url)
    };
    if (!Number.isSafeInteger(entry.number) || entry.number < 1) {
      throw new Error(`GitHub merged pull request ${index} identity is invalid.`);
    }
    assertGitBranchName(entry.headBranch, `merged pull request ${entry.number} head`);
    assertGitBranchName(entry.baseBranch, `merged pull request ${entry.number} base`);
    assertGitSha(entry.headSha, `merged pull request ${entry.number} head SHA`);
    assertGitSha(entry.mergeCommitSha, `merged pull request ${entry.number} merge SHA`);
    const expectedUrl = `https://github.com/${expectedRepository}/pull/${entry.number}`;
    if (entry.url !== expectedUrl) {
      throw new Error(`Merged pull request ${entry.number} URL differs from ${expectedUrl}.`);
    }
    result.push(Object.freeze(entry));
  }
  return Object.freeze(result);
}

async function observeProductionMergedPullRequests(
  repositoryRoot: string,
  repository: string
): Promise<readonly MergedPullRequestHead[]> {
  return await withGitHubApiReadSession({
    repositoryRoot,
    repository,
    operation: async (capability) => {
      const merged: MergedPullRequestHead[] = [];
      for (let page = 1; page <= MERGED_PULL_REQUEST_LIMIT / 100; page += 1) {
        const value = await executeGitHubApiOperation(capability, { kind: 'merged-pulls', page });
        const entries = parseGitHubMergedPullRequestPage(value, repository);
        merged.push(...entries);
        if (!Array.isArray(value) || value.length < 100) break;
      }
      if (merged.length >= MERGED_PULL_REQUEST_LIMIT) {
        throw new Error(`Merged pull request observation reached its bounded ${MERGED_PULL_REQUEST_LIMIT}-item limit.`);
      }
      return Object.freeze(merged.sort((left, right) => left.number - right.number));
    }
  });
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
  if (run === defaultRunner) {
    const inspection = await inspectGitBundleBytes({ repositoryRoot, bytes });
    if (!inspection.heads.some((head) => head.objectId === entry.headSha)) {
      throw new Error(`${label} does not contain ${entry.branch}@${entry.headSha}.`);
    }
    return;
  }
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
    mergedPullRequests: run === defaultRunner
      ? await observeProductionMergedPullRequests(repositoryRoot, repository)
      : parseMergedPullRequestHeads(await requireText(run, 'gh', [
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

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error(`${label} exact shape is invalid.`);
  }
  return value as Record<string, unknown>;
}

function parseRetentionEntries(value: unknown): readonly RetentionEvidence[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Retained authorization entries are absent.');
  const entries = value.map((candidate, index) => {
    const entry = exactRecord(candidate, [
      'branch', 'headSha', 'sourceTreeSha', 'mainSha', 'mainTreeSha', 'basis', 'review'
    ], `Retention entry ${index}`);
    const branch = String(entry.branch);
    const headSha = String(entry.headSha);
    const sourceTreeSha = String(entry.sourceTreeSha);
    const mainSha = String(entry.mainSha);
    const mainTreeSha = String(entry.mainTreeSha);
    assertGitBranchName(branch, 'retained branch');
    for (const [label, sha] of [
      ['source', headSha], ['source tree', sourceTreeSha], ['main', mainSha], ['main tree', mainTreeSha]
    ] as const) assertGitSha(sha, `Retention ${label}`);
    const basis = entry.basis;
    if (basis !== 'native-ancestor' && basis !== 'identical-tree'
        && basis !== 'reviewed-supersession') throw new Error('Retention basis is invalid.');
    let review: RetainedReviewBinding | null = null;
    if (basis === 'reviewed-supersession') {
      const binding = exactRecord(entry.review, [
        'pullRequestNumber', 'commentId', 'reference', 'receiptDigest',
        'headSha', 'headTreeSha', 'pathSet'
      ], 'Retention review');
      const pathSet = exactRecord(binding.pathSet, ['count', 'digest'], 'Retention review path-set');
      const pullRequestNumber = Number(binding.pullRequestNumber);
      const commentId = Number(binding.commentId);
      const reference = String(binding.reference);
      const receiptDigest = String(binding.receiptDigest) as Digest;
      const reviewHeadSha = String(binding.headSha);
      const reviewHeadTreeSha = String(binding.headTreeSha);
      const count = Number(pathSet.count);
      const pathSetDigest = String(pathSet.digest) as Digest;
      if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0
          || !Number.isSafeInteger(commentId) || commentId <= 0
          || !Number.isSafeInteger(count) || count < 0
          || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*#issuecomment-[1-9][0-9]*$/u.test(reference)) {
        throw new Error('Retention review identity is invalid.');
      }
      assertDigest(receiptDigest, 'retention review receipt');
      assertDigest(pathSetDigest, 'retention review path-set');
      assertGitSha(reviewHeadSha, 'retention review head');
      assertGitSha(reviewHeadTreeSha, 'retention review head tree');
      review = Object.freeze({
        pullRequestNumber, commentId, reference, receiptDigest,
        headSha: reviewHeadSha, headTreeSha: reviewHeadTreeSha,
        pathSet: Object.freeze({ count, digest: pathSetDigest })
      });
    } else if (entry.review !== null) {
      throw new Error('Native retention must not carry a review binding.');
    }
    return Object.freeze({ branch, headSha, sourceTreeSha, mainSha, mainTreeSha, basis, review });
  });
  if (new Set(entries.map(({ branch }) => branch)).size !== entries.length) {
    throw new Error('Retention authorization has duplicate branches.');
  }
  return Object.freeze(entries);
}

function parseRetainedAuthorization(source: Uint8Array): RetainedLocalBranchAuthorization {
  const text = Buffer.from(source).toString('utf8');
  const record = exactRecord(JSON.parse(text) as unknown, [
    'schema', 'operationId', 'repository', 'repositoryRoot', 'commonDir', 'remote', 'remoteUrl',
    'repositoryPhysical', 'commonDirPhysical', 'recoveryRootPhysical',
    'remoteMainSha', 'defaultBranch', 'entries', 'authorizedAt', 'authorizationDigest'
  ], 'Retained local authorization');
  if (record.schema !== RETAINED_AUTHORIZATION_SCHEMA) throw new Error('Retained authorization schema differs.');
  const parsed: RetainedLocalBranchAuthorization = {
    schema: RETAINED_AUTHORIZATION_SCHEMA,
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
    entries: parseRetentionEntries(record.entries),
    operationId: String(record.operationId) as Digest,
    authorizedAt: String(record.authorizedAt),
    authorizationDigest: String(record.authorizationDigest) as Digest
  };
  assertDigest(parsed.operationId, 'retained operationId');
  assertDigest(parsed.authorizationDigest, 'retained authorization digest');
  assertGitSha(parsed.remoteMainSha, 'retained remote main');
  assertGitBranchName(parsed.remote, 'retained remote');
  assertGitBranchName(parsed.defaultBranch, 'retained default branch');
  if (!path.isAbsolute(parsed.repositoryRoot) || !path.isAbsolute(parsed.commonDir)
      || Number.isNaN(Date.parse(parsed.authorizedAt))) {
    throw new Error('Retained authorization identity is invalid.');
  }
  const { operationId, authorizedAt, authorizationDigest, ...material } = parsed;
  if (operationId !== digest(material)
      || authorizationDigest !== digest({ ...material, operationId, authorizedAt })
      || text !== canonicalSource(parsed)) {
    throw new Error('Retained authorization digest or canonical bytes differ.');
  }
  return Object.freeze(parsed);
}

function createRetainedReceipt(
  authorization: RetainedLocalBranchAuthorization,
  now: () => Date
): RetainedLocalBranchReceipt {
  const material = {
    schema: RETAINED_RECEIPT_SCHEMA,
    operationId: authorization.operationId,
    authorizationDigest: authorization.authorizationDigest,
    repository: authorization.repository,
    remoteMainSha: authorization.remoteMainSha,
    entries: authorization.entries,
    effect: 'delete-exact-transaction' as const,
    completedAt: now().toISOString()
  };
  return Object.freeze({ ...material, receiptDigest: digest(material) });
}

function parseRetainedReceipt(source: Uint8Array): RetainedLocalBranchReceipt {
  const text = Buffer.from(source).toString('utf8');
  const record = exactRecord(JSON.parse(text) as unknown, [
    'schema', 'operationId', 'authorizationDigest', 'repository', 'remoteMainSha',
    'entries', 'effect', 'completedAt', 'receiptDigest'
  ], 'Retained local receipt');
  if (record.schema !== RETAINED_RECEIPT_SCHEMA || record.effect !== 'delete-exact-transaction') {
    throw new Error('Retained receipt schema or effect differs.');
  }
  const parsed: RetainedLocalBranchReceipt = {
    schema: RETAINED_RECEIPT_SCHEMA,
    operationId: String(record.operationId) as Digest,
    authorizationDigest: String(record.authorizationDigest) as Digest,
    repository: String(record.repository),
    remoteMainSha: String(record.remoteMainSha),
    entries: parseRetentionEntries(record.entries),
    effect: 'delete-exact-transaction',
    completedAt: String(record.completedAt),
    receiptDigest: String(record.receiptDigest) as Digest
  };
  assertDigest(parsed.operationId, 'retained receipt operationId');
  assertDigest(parsed.authorizationDigest, 'retained receipt authorization digest');
  assertDigest(parsed.receiptDigest, 'retained receipt digest');
  assertGitSha(parsed.remoteMainSha, 'retained receipt main');
  if (Number.isNaN(Date.parse(parsed.completedAt))) throw new Error('Retained receipt timestamp is invalid.');
  const { receiptDigest, ...material } = parsed;
  if (receiptDigest !== digest(material) || text !== canonicalSource(parsed)) {
    throw new Error('Retained receipt digest or canonical bytes differ.');
  }
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
    if ((JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>).schema
        === RETAINED_AUTHORIZATION_SCHEMA) continue;
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

interface ScannedRetainedLocalBranchOperations {
  readonly pending: RetainedLocalBranchAuthorization | null;
  readonly completed: readonly Readonly<{
    authorization: RetainedLocalBranchAuthorization;
    receipt: RetainedLocalBranchReceipt;
    names: Readonly<{ authorization: string; receipt: string }>;
  }>[];
}

function scanRetainedLocalBranchOperations(
  store: BranchRecoveryStore
): ScannedRetainedLocalBranchOperations {
  const pending: RetainedLocalBranchAuthorization[] = [];
  const completed: ScannedRetainedLocalBranchOperations['completed'][number][] = [];
  for (const name of store.listOwnedFiles('sec-local-branch-residue-')
    .filter((candidate) => candidate.endsWith('.authorization.json'))) {
    const bytes = store.read(name);
    if (bytes === null) throw new Error(`Retained authorization disappeared: ${name}`);
    if ((JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>).schema
        !== RETAINED_AUTHORIZATION_SCHEMA) continue;
    const authorization = parseRetainedAuthorization(bytes);
    const names = operationNames(authorization.operationId);
    if (name !== names.authorization) throw new Error('Retained authorization filename differs.');
    const receiptBytes = store.read(names.receipt);
    if (receiptBytes === null) {
      pending.push(authorization);
      continue;
    }
    const receipt = parseRetainedReceipt(receiptBytes);
    if (receipt.operationId !== authorization.operationId
        || receipt.authorizationDigest !== authorization.authorizationDigest
        || receipt.repository !== authorization.repository
        || receipt.remoteMainSha !== authorization.remoteMainSha
        || canonicalSource(receipt.entries) !== canonicalSource(authorization.entries)) {
      throw new Error('Retained receipt differs from authorization.');
    }
    completed.push(Object.freeze({ authorization, receipt, names }));
  }
  if (pending.length > 1) throw new Error('Multiple pending retained local branch operations require reconciliation.');
  for (const name of store.listOwnedFiles('sec-local-branch-residue-')
    .filter((candidate) => candidate.endsWith('.receipt.json'))) {
    const bytes = store.read(name);
    if (bytes === null) throw new Error(`Retained receipt disappeared: ${name}`);
    if ((JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>).schema
        !== RETAINED_RECEIPT_SCHEMA) continue;
    const receipt = parseRetainedReceipt(bytes);
    const expected = operationNames(receipt.operationId);
    if (name !== expected.receipt || store.read(expected.authorization) === null) {
      throw new Error(`Retained receipt has no exact authorization: ${name}`);
    }
  }
  return Object.freeze({ pending: pending[0] ?? null, completed: Object.freeze(completed) });
}

function assertRetainedAuthorizationBytes(
  store: BranchRecoveryStore,
  authorization: RetainedLocalBranchAuthorization
): void {
  const name = operationNames(authorization.operationId).authorization;
  const bytes = store.read(name);
  if (bytes === null || !Buffer.from(bytes).equals(Buffer.from(canonicalSource(authorization)))) {
    throw new Error('Retained authorization bytes changed at effect boundary.');
  }
  parseRetainedAuthorization(bytes);
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
  if (bundle.bytes === null || `sha256:${rawSha256Hex(bundle.bytes)}`
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
    const digest = `sha256:${rawSha256Hex(bundle.bytes)}` as Digest;
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
    .filter((candidate) => {
      const bytes = input.store.read(candidate);
      if (bytes === null) throw new Error(`Receipt disappeared during recovery scan: ${candidate}`);
      return (JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>).schema
        !== RETAINED_RECEIPT_SCHEMA;
    })
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
  if (run === defaultRunner) {
    return await observeProductionRepositoryProvider(repositoryRoot, repository);
  }
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
  authorization: LocalBranchResidueAuthorization | RetainedLocalBranchAuthorization;
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
  if (authorization.schema === AUTHORIZATION_SCHEMA) {
    for (const entry of authorization.entries) {
      if (entry.pullRequestUrl
          !== `https://github.com/${authorization.repository}/pull/${entry.pullRequestNumber}`) {
        throw new Error(`Authorization PR URL differs for #${entry.pullRequestNumber}.`);
      }
    }
  }
}

function authorizedLocalState(
  authorization: LocalBranchResidueAuthorization | RetainedLocalBranchAuthorization,
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
  repositoryRoot: string,
  entries: readonly Readonly<{ branch: string; headSha: string }>[],
  coordinatedLease: WorkspaceWriteLeaseToken,
  operationId: Digest
): Promise<void> {
  const durationMs = 120_000;
  const refEntries = entries.map(({ branch, headSha }) => ({
    ref: `refs/heads/${branch}`, expectedOldSha: headSha
  }));
  const inputBytes = measureExactLocalGitRefDeleteBatchInputBytes(refEntries);
  const outputBytes = measureExactLocalGitRefDeleteBatchOutputBytes(refEntries);
  if (inputBytes > MAXIMUM_LOCAL_REF_DELETE_INPUT_BYTES) {
    throw new Error('Atomic local ref delete exceeds the bounded product input budget.');
  }
  if (outputBytes > MAXIMUM_LOCAL_REF_DELETE_OUTPUT_BYTES) {
    throw new Error('Atomic local ref delete exceeds the bounded product output budget.');
  }
  const plan = compileSemanticOperationPlan({
    operation: 'control.branch-lifecycle.merged-local-ref-delete',
    intentDigest: operationId as OperationDigest,
    decisionDigest: REF_EFFECT_CONTRACT,
    deadlineAtUnixMs: Date.now() + durationMs,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: operationId as OperationDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: inputBytes },
      { resource: 'output-bytes', maximum: outputBytes },
      { resource: 'processes', maximum: 7 }
    ],
    requirements: [{ id: REF_EFFECT_REQUIREMENT, contractDigest: REF_EFFECT_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: ['filesystem.identity-drift', 'filesystem.write-failed', 'process.cancelled',
        'process.deadline-exhausted', 'process.output-budget-exhausted', 'process.settlement-unproven', 'process.unavailable'] }]
  });
  const operation = bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: REF_EFFECT_REQUIREMENT, contractDigest: REF_EFFECT_CONTRACT,
    providerIdentityDigest: REF_EFFECT_PROVIDER
  })]);
  const processSession = openProcessResourceSession({ operation,
    requirementBindingContext: issueOperationRequirementBindingContext({ operation,
      requirementId: REF_EFFECT_REQUIREMENT, resourceCeilings: operation.plan.execution.aggregateBudgets }) });
  let primaryError: unknown;
  try {
    await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
      const executablePath = session.gitExecutableIdentity?.realPath;
      if (executablePath === undefined) throw new Error('Git read owner did not retain an executable identity.');
      const resolution = openGitPhysicalProvider({ cwd: repositoryRoot, executablePath, operation, processSession,
        environmentSource: process.env, maximumExecutableBytes: 128 * 1024 * 1024 });
      if (resolution.status !== 'ready') throw new Error(`Git physical provider unavailable: ${resolution.reason}`);
      let effectError: unknown;
      try {
        const receipt = await deleteExactLocalGitRefs({ provider: resolution.capability, coordinatedLease,
          entries: refEntries });
        assertGitLocalRefDeleteBatchReceipt(receipt);
      } catch (error) { effectError = error; }
      try { assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(resolution.capability), resolution.capability); }
      catch (error) { effectError ??= error; }
      if (effectError !== undefined) throw effectError;
    });
  } catch (error) { primaryError = error; }
  try {
    assertProcessResourceSessionReceipt(processSession.close(), { operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest, requirementId: REF_EFFECT_REQUIREMENT });
  } catch (error) { primaryError ??= error; }
  if (primaryError !== undefined) throw primaryError;
}

async function exactTree(run: CommandRunner, root: string, sha: string): Promise<string> {
  assertGitSha(sha, 'retention commit');
  const commit = await requireText(run, 'git', [
    'rev-parse', '--verify', '--end-of-options', `${sha}^{commit}`
  ], root, 'retention commit');
  if (commit !== sha) throw new Error('Retention commit identity differs.');
  const tree = await requireText(run, 'git', [
    'rev-parse', '--verify', '--end-of-options', `${sha}^{tree}`
  ], root, 'retention tree');
  assertGitSha(tree, 'retention tree');
  return tree;
}

async function gitAncestor(
  run: CommandRunner, root: string, sourceSha: string, mainSha: string
): Promise<boolean> {
  const result = await run('git', ['merge-base', '--is-ancestor', sourceSha, mainSha], root);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Retention ancestry observation failed: ${decodeBranchLifecycleChildError(result)}`);
}

async function changedPathSet(
  run: CommandRunner, root: string, sourceSha: string, mainSha: string
): Promise<Readonly<{ count: number; digest: Digest }>> {
  const result = await run('git', [
    'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z',
    sourceSha, mainSha, '--'
  ], root);
  if (result.status !== 0 || result.stderr.length !== 0) {
    throw new Error(`Retention changed-path observation failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return summarizeClosedSupersessionPaths(parseNulUtf8(result.stdout, 'retention changed paths'));
}

async function observedReviewBinding(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  commentId: number;
}>): Promise<ClosedSupersessionEvidence> {
  const evidence = await observeProductionClosedSupersessionEvidence(input);
  assertClosedSupersessionEvidence(evidence);
  return evidence;
}

async function assertRetentionLive(input: Readonly<{
  run: CommandRunner;
  repositoryRoot: string;
  repository: string;
  entry: RetentionEvidence;
}>): Promise<void> {
  const { run, repositoryRoot, repository, entry } = input;
  if (await exactTree(run, repositoryRoot, entry.headSha) !== entry.sourceTreeSha
      || await exactTree(run, repositoryRoot, entry.mainSha) !== entry.mainTreeSha) {
    throw new Error(`Retention exact Git tree changed for ${entry.branch}.`);
  }
  if (entry.basis === 'native-ancestor') {
    if (!await gitAncestor(run, repositoryRoot, entry.headSha, entry.mainSha)) {
      throw new Error(`Retained source is not an ancestor of main: ${entry.branch}.`);
    }
  } else if (entry.basis === 'identical-tree') {
    if (entry.sourceTreeSha !== entry.mainTreeSha) {
      throw new Error(`Retained source tree differs from main: ${entry.branch}.`);
    }
  } else {
    const binding = entry.review;
    if (binding === null) throw new Error(`Reviewed retention lacks a review binding: ${entry.branch}.`);
    const evidence = await observedReviewBinding({
      repositoryRoot, repository,
      pullRequestNumber: binding.pullRequestNumber,
      commentId: binding.commentId
    });
    const review = evidence.review;
    const pathSet = await changedPathSet(run, repositoryRoot, entry.headSha, entry.mainSha);
    const reviewedSet = 'pathSet' in review
      ? review.pathSet
      : summarizeClosedSupersessionPaths(review.paths.map(({ path: changedPath }) => changedPath));
    if (review.repository !== repository
        || review.headSha !== binding.headSha
        || review.headTreeSha !== binding.headTreeSha
        || review.currentMainSha !== entry.mainSha
        || review.currentMainTreeSha !== entry.mainTreeSha
        || binding.headTreeSha !== entry.sourceTreeSha
        || evidence.reference !== binding.reference
        || evidence.receiptDigest !== binding.receiptDigest
        || pathSet.count !== binding.pathSet.count
        || pathSet.digest !== binding.pathSet.digest
        || reviewedSet.count !== pathSet.count
        || reviewedSet.digest !== pathSet.digest
        || await exactTree(run, repositoryRoot, binding.headSha) !== binding.headTreeSha) {
      throw new Error(`Authenticated review differs from exact local retention: ${entry.branch}.`);
    }
  }
}

async function assertCompletedRetentionSettlement(input: Readonly<{
  run: CommandRunner;
  repositoryRoot: string;
  authorization: RetainedLocalBranchAuthorization;
  observation: LocalBranchResidueObservation;
}>): Promise<void> {
  const currentMainSha = remoteMainSha(input.observation);
  if (authorizedLocalState(input.authorization, input.observation) !== 'absent'
      || !await gitAncestor(input.run, input.repositoryRoot,
        input.authorization.remoteMainSha, currentMainSha)) {
    throw new Error(
      `Completed retained local refs reappeared or main lost absorption: ${input.authorization.operationId}`
    );
  }
  for (const entry of input.authorization.entries) {
    if (!await gitAncestor(input.run, input.repositoryRoot, entry.mainSha, currentMainSha)) {
      throw new Error(`Retained main anchor disappeared: ${entry.branch}.`);
    }
  }
}

async function planRetainedEntries(input: Readonly<{
  run: CommandRunner;
  repositoryRoot: string;
  repository: string;
  observation: LocalBranchResidueObservation;
  reviews: readonly Readonly<{ branch: string; pullRequestNumber: number; commentId: number }>[];
}>): Promise<Readonly<{
  eligible: readonly RetentionEvidence[];
  protectedBranches: readonly string[];
  unresolvedBranches: readonly string[];
}>> {
  const { run, repositoryRoot, repository, observation } = input;
  const mainSha = remoteMainSha(observation);
  const mainTreeSha = await exactTree(run, repositoryRoot, mainSha);
  const reviews = new Map(input.reviews.map((review) => [review.branch, review]));
  if (reviews.size !== input.reviews.length) throw new Error('Duplicate local retention review branch.');
  const eligible: RetentionEvidence[] = [];
  const protectedBranches: string[] = [];
  const unresolvedBranches: string[] = [];
  for (const [branch, headSha] of Object.entries(observation.localRefs)
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (branch === observation.defaultBranch) continue;
    assertGitBranchName(branch, 'local retained branch');
    assertGitSha(headSha, 'local retained head');
    if (observation.worktreeBranches.includes(branch)) {
      protectedBranches.push(branch);
      continue;
    }
    if (observation.remoteRefs[branch] !== undefined) {
      unresolvedBranches.push(branch);
      continue;
    }
    const sourceTreeSha = await exactTree(run, repositoryRoot, headSha);
    const reviewed = reviews.get(branch);
    let basis: RetentionEvidence['basis'];
    let review: RetainedReviewBinding | null = null;
    let anchorSha = mainSha;
    let anchorTreeSha = mainTreeSha;
    const mergedAnchors = observation.mergedPullRequests.filter((pullRequest) => (
      pullRequest.headBranch === branch && pullRequest.headSha === headSha
      && pullRequest.baseBranch === observation.defaultBranch
    ));
    if (await gitAncestor(run, repositoryRoot, headSha, mainSha)) basis = 'native-ancestor';
    else if (mergedAnchors.length === 1
        && await gitAncestor(run, repositoryRoot, mergedAnchors[0]!.mergeCommitSha, mainSha)
        && sourceTreeSha === await exactTree(run, repositoryRoot, mergedAnchors[0]!.mergeCommitSha)) {
      basis = 'identical-tree';
      anchorSha = mergedAnchors[0]!.mergeCommitSha;
      anchorTreeSha = sourceTreeSha;
    } else if (sourceTreeSha === mainTreeSha) basis = 'identical-tree';
    else if (reviewed !== undefined) {
      const evidence = await observedReviewBinding({
        repositoryRoot, repository,
        pullRequestNumber: reviewed.pullRequestNumber,
        commentId: reviewed.commentId
      });
      anchorSha = evidence.review.currentMainSha;
      anchorTreeSha = await exactTree(run, repositoryRoot, anchorSha);
      if (!await gitAncestor(run, repositoryRoot, anchorSha, mainSha)) {
        throw new Error(`Reviewed absorption anchor is absent from current main: ${branch}.`);
      }
      const pathSet = await changedPathSet(run, repositoryRoot, headSha, anchorSha);
      const reviewedSet = 'pathSet' in evidence.review
        ? evidence.review.pathSet
        : summarizeClosedSupersessionPaths(evidence.review.paths.map(({ path: changedPath }) => changedPath));
      if (evidence.review.repository !== repository
          || evidence.review.headTreeSha !== sourceTreeSha
          || evidence.review.currentMainTreeSha !== anchorTreeSha
          || await exactTree(run, repositoryRoot, evidence.review.headSha) !== sourceTreeSha
          || reviewedSet.count !== pathSet.count || reviewedSet.digest !== pathSet.digest) {
        throw new Error(`Review does not cover exact local branch retention: ${branch}.`);
      }
      basis = 'reviewed-supersession';
      review = Object.freeze({
        pullRequestNumber: reviewed.pullRequestNumber,
        commentId: reviewed.commentId,
        reference: evidence.reference,
        receiptDigest: evidence.receiptDigest,
        headSha: evidence.review.headSha,
        headTreeSha: evidence.review.headTreeSha,
        pathSet
      });
    } else {
      unresolvedBranches.push(branch);
      continue;
    }
    eligible.push(Object.freeze({ branch, headSha, sourceTreeSha,
      mainSha: anchorSha, mainTreeSha: anchorTreeSha, basis, review }));
  }
  for (const review of input.reviews) {
    if (!eligible.some(({ branch }) => branch === review.branch)) {
      throw new Error(`Local retention review did not bind an eligible exact branch: ${review.branch}.`);
    }
  }
  return Object.freeze({ eligible: Object.freeze(eligible),
    protectedBranches: Object.freeze(protectedBranches),
    unresolvedBranches: Object.freeze(unresolvedBranches) });
}

export async function executeMergedLocalBranchResidueCloseout(input: Readonly<{
  repositoryRoot: string;
  remote?: string;
  recoveryRoot?: string;
  reviews?: readonly Readonly<{ branch: string; pullRequestNumber: number; commentId: number }>[];
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
  const retireRecoveryRoot = (input.recoveryRoot === undefined
    && process.env.SEC_BRANCH_RECOVERY_ROOT === undefined)
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
    await withWorkspaceWriteLease(commonDir, undefined, (coordinatedLease) => (
      withWorkspaceWriteLease(repositoryRoot, undefined, async (lease) => {
      await assertWorkspaceWriteLease(commonDir, coordinatedLease);
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
        await assertWorkspaceWriteLease(commonDir, coordinatedLease);
        await deleteExactTransaction(repositoryRoot, authorization.entries, coordinatedLease, authorization.operationId);
        input.faults?.afterDelete?.();
      }
      await assertWorkspaceWriteLease(commonDir, coordinatedLease);
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
      })
    ));
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

  const scanned = scanLocalBranchResidueOperations(store);
  const retained = scanRetainedLocalBranchOperations(store);
  if (retained.pending !== null && scanned.pending !== null) {
    throw new Error('Legacy and retained local branch operations cannot both be pending.');
  }
  const orphanReceiptFiles = await retireOrphanCompletedReceipts({
    run,
    repositoryRoot,
    repository,
    store
  });
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
  const retiredRetained: string[] = [];
  const retiredRetainedBranches: string[] = [];
  for (const completed of retained.completed) {
    assertAuthorizationIdentity({ authorization: completed.authorization, repository,
      repositoryRoot, commonDir, remote, remoteUrl, provider, store });
    const current = await observe(run, repositoryRoot, repository, provider.defaultBranch);
    await assertCompletedRetentionSettlement({ run, repositoryRoot,
      authorization: completed.authorization, observation: current });
    removeOwnedRecoveryFile(store, completed.names.receipt, retiredRetained);
    removeOwnedRecoveryFile(store, completed.names.authorization, retiredRetained);
    retiredRetainedBranches.push(...completed.authorization.entries.map(({ branch }) => branch));
  }

  if (pending !== null) {
    assertAuthorizationIdentity({ authorization: pending, repository, repositoryRoot,
      commonDir, remote, remoteUrl, provider, store });
    const settled = await settleAuthorization(pending, false, Object.freeze([]), Object.freeze([]));
    return Object.freeze({ ...settled,
      settled: Object.freeze([...new Set([
        ...retiredBefore.branches, ...retiredRetainedBranches, ...settled.settled
      ])].sort((left, right) => left.localeCompare(right))),
      retiredRecoveryFiles: Object.freeze([
        ...retiredBefore.files, ...retiredRetained, ...settled.retiredRecoveryFiles
      ]) });
  }

  const settleRetained = async (
    authorization: RetainedLocalBranchAuthorization,
    publishAuthorization: boolean,
    protectedBranches: readonly string[],
    unresolvedBranches: readonly string[]
  ) => {
    const names = operationNames(authorization.operationId);
    await withWorkspaceWriteLease(commonDir, undefined, (coordinatedLease) => (
      withWorkspaceWriteLease(repositoryRoot, undefined, async (lease) => {
        await assertWorkspaceWriteLease(commonDir, coordinatedLease);
        await assertWorkspaceWriteLease(repositoryRoot, lease);
        const currentProvider = await observeRepositoryProvider(run, repositoryRoot, repository);
        assertAuthorizationIdentity({ authorization, repository, repositoryRoot,
          commonDir, remote, remoteUrl, provider: currentProvider, store });
        const current = await observe(run, repositoryRoot, repository, authorization.defaultBranch);
        assertRecoverySeparatedFromWorktrees(store, current);
        if (remoteMainSha(current) !== authorization.remoteMainSha) {
          throw new Error('Remote main changed after retained authorization.');
        }
        for (const entry of authorization.entries) {
          if (current.remoteRefs[entry.branch] !== undefined
              || current.worktreeBranches.includes(entry.branch)) {
            throw new Error(`Retained local branch acquired remote ref or worktree: ${entry.branch}.`);
          }
          if (!await gitAncestor(run, repositoryRoot, entry.mainSha, authorization.remoteMainSha)) {
            throw new Error(`Retained main anchor is absent: ${entry.branch}.`);
          }
          await assertRetentionLive({ run, repositoryRoot, repository, entry });
        }
        const state = authorizedLocalState(authorization, current);
        if (publishAuthorization) {
          publishCanonical({ store, name: names.authorization, value: authorization,
            parse: parseRetainedAuthorization });
          input.faults?.afterAuthorization?.();
        }
        assertRetainedAuthorizationBytes(store, authorization);
        await assertWorkspaceWriteLease(commonDir, coordinatedLease);
        await assertWorkspaceWriteLease(repositoryRoot, lease);
        const boundary = await observe(run, repositoryRoot, repository, authorization.defaultBranch);
        if (remoteMainSha(boundary) !== authorization.remoteMainSha
            || authorizedLocalState(authorization, boundary) !== state) {
          throw new Error('Retained branch or main changed at ref effect boundary.');
        }
        assertRecoverySeparatedFromWorktrees(store, boundary);
        for (const entry of authorization.entries) {
          if (boundary.remoteRefs[entry.branch] !== undefined
              || boundary.worktreeBranches.includes(entry.branch)) {
            throw new Error(`Retained local branch acquired a ref or worktree at effect boundary: ${entry.branch}.`);
          }
          if (!await gitAncestor(run, repositoryRoot, entry.mainSha, authorization.remoteMainSha)) {
            throw new Error(`Retained main anchor changed at effect boundary: ${entry.branch}.`);
          }
          await assertRetentionLive({ run, repositoryRoot, repository, entry });
        }
        assertPhysicalDirectoryBinding(authorization.repositoryPhysical,
          inspectNoFollowDirectoryChain(repositoryRoot, 'Retained ref effect repository'), 'Repository root');
        assertPhysicalDirectoryBinding(authorization.commonDirPhysical,
          inspectNoFollowDirectoryChain(commonDir, 'Retained ref effect common directory'), 'Git common directory');
        assertRetainedAuthorizationBytes(store, authorization);
        if (state === 'present') {
          await deleteExactTransaction(repositoryRoot, authorization.entries,
            coordinatedLease, authorization.operationId);
          input.faults?.afterDelete?.();
        }
        await assertWorkspaceWriteLease(commonDir, coordinatedLease);
        await assertWorkspaceWriteLease(repositoryRoot, lease);
        const refs = parseLocalRefs(await requireText(run, 'git', [
          'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)%00', 'refs/heads/'
        ], repositoryRoot, 'retained local ref readback'));
        if (authorization.entries.some(({ branch }) => refs[branch] !== undefined)) {
          throw new Error('Retained local branch remains after exact CAS.');
        }
        assertRetainedAuthorizationBytes(store, authorization);
        input.faults?.afterReadback?.();
        input.faults?.beforeReceipt?.();
        const receipt = publishCanonical({ store, name: names.receipt,
          value: createRetainedReceipt(authorization, now), parse: parseRetainedReceipt });
        if (receipt.authorizationDigest !== authorization.authorizationDigest) {
          throw new Error('Retained receipt differs from authorization.');
        }
        input.faults?.afterReceipt?.();
        store.assertCurrent();
      })
    ));
    const completed = scanRetainedLocalBranchOperations(store).completed
      .find(({ authorization: candidate }) => candidate.operationId === authorization.operationId);
    if (completed === undefined) throw new Error('Retained local receipt disappeared.');
    const after = await observe(run, repositoryRoot, repository, authorization.defaultBranch);
    await assertCompletedRetentionSettlement({ run, repositoryRoot,
      authorization: completed.authorization, observation: after });
    const files: string[] = [];
    removeOwnedRecoveryFile(store, names.receipt, files);
    removeOwnedRecoveryFile(store, names.authorization, files);
    const recoveryRootRetired = retireRecoveryRoot && store.retireIfEmpty();
    const finalWorktreeEvidenceGc = initialWorktreeEvidenceGc.retained.some(
      ({ reason }) => reason === 'branch-live'
    ) ? await gcCompletedWorktreePhysicalCloseoutEvidence(repositoryRoot) : initialWorktreeEvidenceGc;
    return Object.freeze({ schema: 'sec-local-branch-residue-closeout-result-v2' as const,
      settled: Object.freeze(authorization.entries.map(({ branch }) => branch)),
      protectedBranches, unresolvedBranches,
      authorizationPath: null, receiptPath: null,
      retiredRecoveryFiles: Object.freeze(files), recoveryRootRetired,
      worktreeEvidenceGc: mergeWorktreeEvidenceGc(initialWorktreeEvidenceGc, finalWorktreeEvidenceGc) });
  };

  const retiredBranches = Object.freeze([...new Set([
    ...retiredBefore.branches, ...retiredRetainedBranches
  ])].sort((left, right) => left.localeCompare(right)));
  const retiredFiles = Object.freeze([...retiredBefore.files, ...retiredRetained]);
  if (retained.pending !== null) {
    const settled = await settleRetained(retained.pending, false, Object.freeze([]), Object.freeze([]));
    return Object.freeze({ ...settled,
      settled: Object.freeze([...new Set([...retiredBranches, ...settled.settled])]
        .sort((left, right) => left.localeCompare(right))),
      retiredRecoveryFiles: Object.freeze([...retiredFiles, ...settled.retiredRecoveryFiles]) });
  }

  const first = await observe(run, repositoryRoot, repository, provider.defaultBranch);
  assertRecoverySeparatedFromWorktrees(store, first);
  const plan = await planRetainedEntries({ run, repositoryRoot, repository, observation: first,
    reviews: input.reviews ?? [] });
  if (plan.eligible.length === 0) {
    return Object.freeze({ schema: 'sec-local-branch-residue-closeout-result-v2' as const,
      settled: retiredBranches, protectedBranches: plan.protectedBranches,
      unresolvedBranches: plan.unresolvedBranches, authorizationPath: null,
      receiptPath: null, retiredRecoveryFiles: retiredFiles,
      recoveryRootRetired: retireRecoveryRoot && store.retireIfEmpty(),
      worktreeEvidenceGc: initialWorktreeEvidenceGc });
  }
  const plannedInputBytes = measureExactLocalGitRefDeleteBatchInputBytes(
    plan.eligible.map(({ branch, headSha }) => ({
      ref: `refs/heads/${branch}`, expectedOldSha: headSha
    }))
  );
  const plannedOutputBytes = measureExactLocalGitRefDeleteBatchOutputBytes(
    plan.eligible.map(({ branch, headSha }) => ({
      ref: `refs/heads/${branch}`, expectedOldSha: headSha
    }))
  );
  if (plannedInputBytes > MAXIMUM_LOCAL_REF_DELETE_INPUT_BYTES) {
    throw new Error('Retained local ref operation exceeds the bounded product input budget before authorization.');
  }
  if (plannedOutputBytes > MAXIMUM_LOCAL_REF_DELETE_OUTPUT_BYTES) {
    throw new Error('Retained local ref operation exceeds the bounded product output budget before authorization.');
  }
  const material = Object.freeze({
    schema: RETAINED_AUTHORIZATION_SCHEMA,
    repository, repositoryRoot, commonDir, remote, remoteUrl,
    repositoryPhysical: bindPhysicalDirectory(repositoryPhysical),
    commonDirPhysical: bindPhysicalDirectory(commonDirPhysical),
    recoveryRootPhysical: bindPhysicalDirectory(store.rootChain),
    remoteMainSha: remoteMainSha(first), defaultBranch: provider.defaultBranch,
    entries: plan.eligible
  });
  const operationId = digest(material);
  const unsigned = Object.freeze({ ...material, operationId, authorizedAt: now().toISOString() });
  const authorization: RetainedLocalBranchAuthorization = Object.freeze({
    ...unsigned, authorizationDigest: digest(unsigned)
  });
  const settled = await settleRetained(authorization, true,
    plan.protectedBranches, plan.unresolvedBranches);
  return Object.freeze({ ...settled,
    settled: Object.freeze([...new Set([...retiredBranches, ...settled.settled])]
      .sort((left, right) => left.localeCompare(right))),
    retiredRecoveryFiles: Object.freeze([...retiredFiles, ...settled.retiredRecoveryFiles]) });
}
