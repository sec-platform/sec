#!/usr/bin/env bun

import path from 'node:path';

import { canonicalJson, sha256 } from '../../../../contracts/canonical.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { acquireWorkspaceWriteLease, assertWorkspaceWriteLease, assertWorkspaceWriteLeaseRetirement, assertWorkspaceWriteLeaseRetirementProof, completeWorkspaceWriteLeaseRetirement, recoverWorkspaceWriteLeaseRetirement, resumeWorkspaceWriteLeaseRetirement, withWorkspaceWriteLease, type WorkspaceWriteLeaseRetirementReceipt, type WorkspaceWriteLeaseToken } from '../../../filesystem/write-lease.ts';
import { assertGeneratedStateWorktreeRetirementEffectStart, isGeneratedStateWorktreeRetirementBlocked, settleGeneratedStateForWorktreeRetirement } from '../../../runtime-state/generated-state/lifecycle.ts';
import { createNoFollowDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, relocateRetainedNoFollowDirectory, relocateRetainedNoFollowDirectoryAcrossParents, replaceDurableCanonicalFile, retireNoFollowDirectoryTree, scanNoFollowDirectoryDirectMetadata, scanNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA,
  assertStableWorktreePhysicalWorkingState,
  assertWorktreePhysicalCloseoutAuthorization,
  assertWorktreePhysicalCloseoutReceipt,
  classifyAuthorizedWorktreeResidue,
  createWorktreePhysicalCloseoutAuthorization,
  createWorktreePhysicalCloseoutReceipt,
  createWorktreePhysicalInventory,
  detailDigest,
  isFieldlessLegacyWorktreePhysicalCloseoutAuthorization,
  parseGitWorktreeAdminLocator,
  parseWorktreePorcelainZ,
  parseWorktreeStatusPorcelainZ,
  type Digest,
  type WorktreePhysicalCloseoutAttempt,
  type WorktreePhysicalCloseoutAuthorization,
  type WorktreePhysicalCloseoutReceipt,
  type WorktreePhysicalEntry,
  type WorktreePhysicalInventory,
  type WorktreePorcelainRecord
} from '../../../runtime-state/worktree-closeout-contract.ts';
import { compilerDependencyLocatorWorktreeRetirementProvider } from '../../../toolchain/dependencies/runtime.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../development/tooling/git/git-read.ts';
import { createBranchLifecycleGitChildEnvironment } from './branch-lifecycle-command.ts';

const MAX_CLEANUP_ATTEMPTS = 4;
const BACKOFF_MILLISECONDS = [0, 15, 40, 100] as const;

interface CommandResult {
  readonly status: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export interface PrepareWorktreePhysicalCloseoutInput {
  readonly repositoryRoot: string;
  readonly targetPath: string;
  readonly expectedBranch: string;
  readonly expectedHeadSha: string;
  readonly expectedTreeSha: string;
  readonly expectedRecoveryAuthorityDigest: Digest;
}

export interface ExecuteWorktreePhysicalCloseoutInput extends PrepareWorktreePhysicalCloseoutInput {
  readonly authorizationPath: string;
}

/** A detached scratch worktree has no branch/ref authority and never mints a branch token. */
export interface PrepareDetachedScratchWorktreePhysicalCloseoutInput {
  readonly repositoryRoot: string;
  readonly targetPath: string;
  readonly expectedHeadSha: string;
  readonly expectedTreeSha: string;
  /** Optional existing caller correlation; omission is derived by the physical owner. */
  readonly expectedRecoveryAuthorityDigest?: Digest;
}
export interface ExecuteDetachedScratchWorktreePhysicalCloseoutInput extends PrepareDetachedScratchWorktreePhysicalCloseoutInput {
  readonly authorizationPath: string;
}
const DETACHED_BRANCH_PREFIX = 'detached-scratch-';
function detachedMarker(headSha: string): string { return `${DETACHED_BRANCH_PREFIX}${headSha}`; }

function detachedRecoveryCorrelationDigest(
  input: PrepareDetachedScratchWorktreePhysicalCloseoutInput
): Digest {
  return input.expectedRecoveryAuthorityDigest ?? detailDigest({
    domain: 'sec-detached-worktree-recovery-correlation-v1',
    repositoryRoot: pathKey(input.repositoryRoot),
    targetPath: pathKey(input.targetPath),
    headSha: input.expectedHeadSha,
    treeSha: input.expectedTreeSha
  });
}

/** Opaque same-process capability; raw JSON can never mint this token. */
export class WorktreePhysicalCloseoutConsumptionToken {
  declare private readonly brand: 'sec-worktree-physical-closeout-consumption-token-v1';
}

interface TrustedConsumptionIssuance {
  readonly authorization: WorktreePhysicalCloseoutAuthorization;
  readonly retirementReceiptDigest: Digest | null;
  readonly phaseDigest: Digest | null;
  readonly adminEffectDigest: Digest | null;
  readonly completedReceiptDigest: Digest | null;
}

/**
 * Durable files describe effects but are never a capability issuer.  These
 * two private indexes only exist in the process that prepared the opaque
 * object; a later executor may converge the filesystem but cannot upgrade a
 * token from authorization/phase/receipt JSON.
 */
const trustedConsumptionTokens = new WeakMap<
  WorktreePhysicalCloseoutConsumptionToken,
  TrustedConsumptionIssuance
>();
const trustedTokensByAuthorization = new Map<string, Set<WorktreePhysicalCloseoutConsumptionToken>>();

function issueTrustedRetirement(
  authorization: WorktreePhysicalCloseoutAuthorization,
  receipt: WorkspaceWriteLeaseRetirementReceipt,
  phase: RetiredWorktreePhase
): void {
  const candidates = trustedTokensByAuthorization.get(authorization.authorizationDigest);
  if (candidates === undefined) return;
  for (const token of candidates) {
    const current = trustedConsumptionTokens.get(token);
    if (current === undefined || current.authorization.authorizationDigest !== authorization.authorizationDigest) continue;
    trustedConsumptionTokens.set(token, Object.freeze({
      authorization: current.authorization,
      retirementReceiptDigest: receipt.retirementDigest as Digest,
      phaseDigest: phase.phaseDigest,
      adminEffectDigest: current.adminEffectDigest,
      completedReceiptDigest: null
    }));
  }
}

function issueTrustedAdminEffect(
  authorization: WorktreePhysicalCloseoutAuthorization,
  adminEffectDigest: Digest
): void {
  const candidates = trustedTokensByAuthorization.get(authorization.authorizationDigest);
  if (candidates === undefined) return;
  for (const token of candidates) {
    const current = trustedConsumptionTokens.get(token);
    if (current === undefined || current.authorization.authorizationDigest !== authorization.authorizationDigest ||
      current.retirementReceiptDigest === null || current.phaseDigest === null) continue;
    trustedConsumptionTokens.set(token, Object.freeze({ ...current, adminEffectDigest }));
  }
}

function issueTrustedCompletion(
  authorization: WorktreePhysicalCloseoutAuthorization,
  receipt: WorktreePhysicalCloseoutReceipt
): void {
  const candidates = trustedTokensByAuthorization.get(authorization.authorizationDigest);
  if (candidates === undefined || receipt.terminal !== 'completed') return;
  for (const token of candidates) {
    const current = trustedConsumptionTokens.get(token);
    if (current === undefined || current.authorization.authorizationDigest !== authorization.authorizationDigest ||
      current.retirementReceiptDigest === null || current.phaseDigest === null || current.adminEffectDigest === null) continue;
    trustedConsumptionTokens.set(token, Object.freeze({
      ...current,
      completedReceiptDigest: receipt.receiptDigest
    }));
  }
}

export interface PreparedWorktreePhysicalCloseout {
  readonly authorization: WorktreePhysicalCloseoutAuthorization;
  readonly token: WorktreePhysicalCloseoutConsumptionToken;
}

async function runRepositoryGit(
  repositoryRoot: string,
  args: readonly string[]
): Promise<CommandResult> {
  const hasNestedCwd = args[0] === '-C' && typeof args[1] === 'string';
  const nestedCwd = hasNestedCwd ? path.resolve(repositoryRoot, args[1]!) : repositoryRoot;
  const commandArgs = hasNestedCwd ? args.slice(2) : args;
  return withAuthorityGitReadSession({
    cwd: nestedCwd,
    budget: GIT_READ_OPERATION_BUDGET,
    environment: createBranchLifecycleGitChildEnvironment(process.env)
  }, async (session) => {
    const command = await session.run(commandArgs);
    if (command.kind !== 'completed') throw new Error(command.detail);
    return Object.freeze({
      status: command.result.code,
      stdout: Buffer.from(command.result.stdout),
      stderr: Buffer.from(command.result.stderr, 'utf8')
    });
  });
}

async function requireRepositoryGit(repositoryRoot: string, args: readonly string[], label: string): Promise<Buffer> {
  const result = await runRepositoryGit(repositoryRoot, args);
  if (result.status !== 0) {
    throw new Error(`${label}: ${result.stderr.toString('utf8').trim() || `exit ${String(result.status)}`}`);
  }
  return result.stdout;
}

function normalizedAbsolute(value: string): string {
  return path.resolve(value);
}

function pathKey(value: string): string {
  const normalized = normalizedAbsolute(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function shaValue(value: Buffer | string, label: string): string {
  const normalized = (Buffer.isBuffer(value) ? value.toString('utf8') : value).trim();
  if (!/^[0-9a-f]{40}$/u.test(normalized)) throw new Error(`${label} is not a lowercase Git SHA-1.`);
  return normalized;
}

function physicalDirectory(pathInput: string, label: string): PhysicalDirectoryIdentity {
  return inspectNoFollowDirectoryChain(normalizedAbsolute(pathInput), label).target;
}

function physicalPresence(pathInput: string, label: string): PhysicalDirectoryIdentity | null {
  const presence = inspectExactNoFollowDirectoryPresence(normalizedAbsolute(pathInput), label);
  return presence.state === 'present' ? presence.directory.target : null;
}

function assertAuthorizedLeaseNamespaceBinding(
  authorization: WorktreePhysicalCloseoutAuthorization,
  receipt: WorkspaceWriteLeaseRetirementReceipt
): void {
  if (receipt.namespaceDevice !== authorization.targetLeaseNamespace.device || receipt.namespaceInode !== authorization.targetLeaseNamespace.inode) {
    throw new Error('Retirement receipt namespace identity differs from authorization pre-effect binding.');
  }
}

function decodeUtf8(value: Buffer | Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(value);
}

async function repositoryFacts(repositoryRootInput: string): Promise<{
  root: string;
  rootDevice: string;
  rootInode: string;
  commonDir: string;
  commonDirDevice: string;
  commonDirInode: string;
  defaultBranch: string;
}> {
  const requested = normalizedAbsolute(repositoryRootInput);
  const root = normalizedAbsolute(
    decodeUtf8(await requireRepositoryGit(requested, ['rev-parse', '--show-toplevel'], 'Resolve repository root')).trim()
  );
  if (pathKey(root) !== pathKey(requested)) {
    throw new Error('repositoryRoot must be the exact repository worktree root.');
  }
  const commonDirRaw = decodeUtf8(
    await requireRepositoryGit(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'Resolve Git common-dir')
  ).trim();
  const commonDir = normalizedAbsolute(commonDirRaw);
  const rootIdentity = physicalDirectory(root, 'Repository root');
  const commonIdentity = physicalDirectory(commonDir, 'Git common-dir');
  const symbolic = decodeUtf8(await requireRepositoryGit(root, ['symbolic-ref', 'refs/remotes/origin/HEAD'], 'Resolve default branch')).trim();
  const prefix = 'refs/remotes/origin/';
  if (!symbolic.startsWith(prefix) || symbolic.length === prefix.length) {
    throw new Error('Default branch symbolic ref is malformed.');
  }
  return {
    root,
    rootDevice: rootIdentity.device,
    rootInode: rootIdentity.inode,
    commonDir,
    commonDirDevice: commonIdentity.device,
    commonDirInode: commonIdentity.inode,
    defaultBranch: symbolic.slice(prefix.length)
  };
}

async function assertCoordinatedRepository(
  expected: Awaited<ReturnType<typeof repositoryFacts>>,
  commonLease: WorkspaceWriteLeaseToken
): Promise<void> {
  await assertWorkspaceWriteLease(expected.commonDir, commonLease);
  const observed = await repositoryFacts(expected.root);
  if (pathKey(observed.root) !== pathKey(expected.root)
      || observed.rootDevice !== expected.rootDevice
      || observed.rootInode !== expected.rootInode
      || pathKey(observed.commonDir) !== pathKey(expected.commonDir)
      || observed.commonDirDevice !== expected.commonDirDevice
      || observed.commonDirInode !== expected.commonDirInode
      || observed.defaultBranch !== expected.defaultBranch) {
    throw new Error('Coordinated repository or Git common-dir identity changed under the workspace lease.');
  }
}

async function assertDetachedScratchRecoveryReachable(
  repository: Awaited<ReturnType<typeof repositoryFacts>>,
  headSha: string,
  treeSha: string
): Promise<void> {
  const head = shaValue(await requireRepositoryGit(repository.root, [
    'rev-parse', '--verify', '--end-of-options', `${headSha}^{commit}`
  ], 'Resolve detached scratch commit'), 'Detached scratch commit');
  const tree = shaValue(await requireRepositoryGit(repository.root, [
    'rev-parse', '--verify', '--end-of-options', `${headSha}^{tree}`
  ], 'Resolve detached scratch tree'), 'Detached scratch tree');
  if (head !== headSha || tree !== treeSha) {
    throw new Error('Detached scratch exact commit/tree is not available for recovery.');
  }
  const output = decodeUtf8(await requireRepositoryGit(repository.root, [
    'for-each-ref', `--contains=${headSha}`, '--format=%(refname)', 'refs/heads/'
  ], 'Resolve retained local branch recovery source'));
  const refs = output.length === 0 ? [] : output.trimEnd().split('\n');
  if (refs.length === 0 || refs.some((ref) => !ref.startsWith('refs/heads/') || ref.length <= 'refs/heads/'.length)) {
    throw new Error('Detached scratch commit has no retained local branch recovery source.');
  }
}

async function observeRegistry(repositoryRoot: string): Promise<{
  bytes: Buffer;
  records: WorktreePorcelainRecord[];
  digest: Digest;
}> {
  const bytes = await requireRepositoryGit(repositoryRoot, ['worktree', 'list', '--porcelain', '-z'], 'Observe Git worktree registry');
  const records = parseWorktreePorcelainZ(bytes);
  return { bytes, records, digest: sha256(records) as Digest };
}

function findTargetRecord(records: readonly WorktreePorcelainRecord[], targetPath: string): WorktreePorcelainRecord | null {
  const matches = records.filter((record) => pathKey(record.path) === pathKey(targetPath));
  if (matches.length > 1) throw new Error('Target appears more than once in the Git worktree registry.');
  return matches[0] ?? null;
}

function observeWorktreePhysicalInventory(targetPathInput: string): WorktreePhysicalInventory {
  const target = physicalDirectory(targetPathInput, 'Target worktree root');
  return observeDirectoryPhysicalInventory(target);
}

function observeDirectoryPhysicalInventory(target: PhysicalDirectoryIdentity): WorktreePhysicalInventory {
  const entries: WorktreePhysicalEntry[] = scanNoFollowDirectoryTreeInventory(target).map((entry) => ({
    relativePath: entry.relativePath,
    kind: entry.kind === 'link' ? 'symlink' : entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    contentDigest: entry.contentDigest,
    linkTarget: entry.linkTarget
  }));
  return createWorktreePhysicalInventory(entries);
}

function registryAdminForTarget(
  target: PhysicalDirectoryIdentity,
  commonDir: string
): Readonly<{ relativePath: string; tombstoneName: string; device: string; inode: string; inventory: WorktreePhysicalInventory }> {
  const gitFile = readNoFollowOrdinaryFile(target, '.git');
  if (gitFile === null) throw new Error('Registered target .git locator is absent.');
  const adminPath = normalizedAbsolute(path.resolve(
    target.path,
    parseGitWorktreeAdminLocator(gitFile)
  ));
  const relativePath = path.relative(commonDir, adminPath).replaceAll('\\', '/');
  if (!/^worktrees\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(relativePath)) {
    throw new Error('Registered target Git admin directory is outside canonical common-dir worktrees.');
  }
  const admin = physicalDirectory(adminPath, 'Registered target Git admin directory');
  return Object.freeze({ relativePath, tombstoneName: 'worktree-admin-closeout-0000000000000000000000000000000000000000000000000000000000000000', device: admin.device, inode: admin.inode, inventory: observeDirectoryPhysicalInventory(admin) });
}

async function observeWorkingState(
  repositoryRoot: string,
  targetPath: string,
  leaseOwnedRelativePath: string | null = null
): Promise<{ digest: Digest; blocker: string | null }> {
  const status = await runRepositoryGit(repositoryRoot, [
    '-C',
    targetPath,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignored=matching'
  ]);
  if (status.status !== 0) {
    return {
      digest: detailDigest({ status: status.status, stderr: status.stderr.toString('utf8') }),
      blocker: 'working-state-unresolved'
    };
  }
  let records: ReturnType<typeof parseWorktreeStatusPorcelainZ>;
  try {
    records = parseWorktreeStatusPorcelainZ(status.stdout);
  } catch (error) {
    return {
      digest: detailDigest(error instanceof Error ? error.message : String(error)),
      blocker: 'working-state-unresolved'
    };
  }
  // A held target lease creates exactly this untracked control subtree.  Do
  // not observe it before acquisition (that has a write-race); instead remove
  // only this exact own namespace from the lease-held cleanliness snapshot.
  // Every other status record, including `.sec` siblings, remains a blocker.
  const retained = records.filter((entry) => {
    if (leaseOwnedRelativePath === null) return true;
    const candidate =
      (entry.index === '?' && entry.worktree === '?') || (entry.index === '!' && entry.worktree === '!') ? entry.path : null;
    if (candidate === null) return true;
    if (candidate === leaseOwnedRelativePath || candidate.startsWith(`${leaseOwnedRelativePath}/`)) {
      return false;
    }
    if (!leaseOwnedRelativePath.startsWith(`${candidate}/`)) return true;

    // Git collapses a fully ignored directory to its nearest ignored ancestor.
    // Accept that projection only when a retained no-follow census proves the
    // ancestor contains exactly this held lease namespace and no sibling.
    // A reparse node, unsupported entry, oversized leaf, missing namespace, or
    // any foreign sibling keeps the ignored record as a blocker.
    try {
      const ancestor = inspectNoFollowDirectoryChain(
        path.join(targetPath, ...candidate.split('/')),
        'Lease-owned collapsed ignored ancestor'
      ).target;
      const ownedSuffix = leaseOwnedRelativePath.slice(candidate.length + 1);
      const entries = scanNoFollowDirectoryTree(ancestor);
      return (
        !entries.some((observed) => observed.relativePath === ownedSuffix || observed.relativePath.startsWith(`${ownedSuffix}/`)) ||
        entries.some((observed) => observed.relativePath !== ownedSuffix && !observed.relativePath.startsWith(`${ownedSuffix}/`))
      );
    } catch {
      return true;
    }
  });
  const digest = detailDigest({ records: retained });
  if (retained.length === 0) return { digest, blocker: null };
  let tracked = 0;
  let untracked = 0;
  let ignored = 0;
  let unknown = 0;
  for (const entry of retained) {
    if (entry.index === '?' && entry.worktree === '?') untracked += 1;
    else if (entry.index === '!' && entry.worktree === '!') ignored += 1;
    else if (entry.index !== '!' && entry.worktree !== '!') tracked += 1;
    else unknown += 1;
  }
  return {
    digest,
    blocker: `working-state-not-clean:tracked=${tracked},untracked=${untracked},ignored=${ignored},unknown=${unknown}`
  };
}

function withoutLeaseOwnedNamespace(inventory: WorktreePhysicalInventory): WorktreePhysicalInventory {
  const namespace = '.sec/workspace-write-lease';
  return createWorktreePhysicalInventory(inventory.entries.filter((entry) =>
    entry.relativePath !== namespace && !entry.relativePath.startsWith(`${namespace}/`)
  ));
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalJson(value), null, 2)}\n`, 'utf8');
}

function persistCanonical(parent: PhysicalDirectoryIdentity, name: string, value: unknown): void {
  const bytes = canonicalBytes(value);
  publishExclusiveDurableCanonicalFile({
    parent,
    name,
    bytes,
    validate: (current) => {
      const parsed = JSON.parse(Buffer.from(current).toString('utf8')) as unknown;
      if (JSON.stringify(canonicalJson(parsed)) !== JSON.stringify(canonicalJson(value))) {
        throw new Error('Durable canonical publication content differs.');
      }
    }
  });
}

interface ReceiptLatestPointer {
  readonly schema: 'sec-worktree-cleanup-receipt-latest-v1';
  readonly generation: string;
  readonly receiptDigest: Digest;
}

interface RetiredWorktreePhase {
  readonly schema: 'sec-worktree-closeout-retired-phase-v1';
  readonly authorizationDigest: Digest;
  readonly tombstoneName: string;
  readonly retirementReceipt: WorkspaceWriteLeaseRetirementReceipt;
  readonly phaseDigest: Digest;
}

interface RetiredWorktreeIntent {
  readonly schema: 'sec-worktree-closeout-retirement-intent-v1';
  readonly authorizationDigest: Digest;
  readonly tombstoneName: string;
  readonly targetDevice: string;
  readonly targetInode: string;
  readonly intentDigest: Digest;
}

function hasExactObjectKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const normalized = [...expected].sort();
  return actual.length === normalized.length && actual.every((key, index) => key === normalized[index]);
}

function createRetiredWorktreeIntent(input: Omit<RetiredWorktreeIntent, 'schema' | 'intentDigest'>): RetiredWorktreeIntent {
  const material = { schema: 'sec-worktree-closeout-retirement-intent-v1' as const, ...input };
  return Object.freeze({ ...material, intentDigest: sha256(material) as Digest });
}

function retirementIntentName(intent: RetiredWorktreeIntent): string {
  return `retirement-intent-${intent.intentDigest.slice('sha256:'.length)}.json`;
}

function persistRetiredWorktreeIntent(root: PhysicalDirectoryIdentity, intent: RetiredWorktreeIntent): void {
  persistCanonical(root, retirementIntentName(intent), intent);
}

function loadRetiredWorktreeIntent(root: PhysicalDirectoryIdentity, authorization: WorktreePhysicalCloseoutAuthorization): RetiredWorktreeIntent | null {
  const candidates = scanNoFollowDirectoryTree(root).filter((entry) => /^retirement-intent-[0-9a-f]{64}\.json$/u.test(entry.relativePath));
  if (candidates.length === 0) return null;
  if (candidates.length !== 1 || candidates[0]!.kind !== 'file') throw new Error('Retirement intent generation is ambiguous or unsafe.');
  const candidate = candidates[0]!;
  const intent = loadCanonicalFile(root, candidate.relativePath, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !hasExactObjectKeys(value, [
      'schema', 'authorizationDigest', 'tombstoneName', 'targetDevice', 'targetInode', 'intentDigest'
    ])) throw new Error('Retirement intent is malformed.');
    const parsed = value as RetiredWorktreeIntent;
    const { schema: _schema, intentDigest: _intentDigest, ...material } = parsed;
    const rebuilt = createRetiredWorktreeIntent(material);
    if (parsed.schema !== rebuilt.schema || parsed.intentDigest !== rebuilt.intentDigest || retirementIntentName(rebuilt) !== candidate.relativePath) throw new Error('Retirement intent digest is invalid.');
    return rebuilt;
  });
  if (!intent || intent.authorizationDigest !== authorization.authorizationDigest || intent.tombstoneName !== authorization.tombstoneName ||
    intent.targetDevice !== authorization.target.device || intent.targetInode !== authorization.target.inode) {
    throw new Error('Retirement intent does not bind this authorization.');
  }
  return intent;
}

function createRetiredWorktreePhase(input: Omit<RetiredWorktreePhase, 'schema' | 'phaseDigest'>): RetiredWorktreePhase {
  const material = { schema: 'sec-worktree-closeout-retired-phase-v1' as const, ...input };
  return Object.freeze({ ...material, phaseDigest: sha256(material) as Digest });
}

function retiredPhaseName(phase: RetiredWorktreePhase): string {
  return `retired-phase-${phase.phaseDigest.slice('sha256:'.length)}.json`;
}

function persistRetiredWorktreePhase(root: PhysicalDirectoryIdentity, phase: RetiredWorktreePhase): void {
  persistCanonical(root, retiredPhaseName(phase), phase);
}

function loadRetiredWorktreePhase(root: PhysicalDirectoryIdentity, authorization: WorktreePhysicalCloseoutAuthorization): RetiredWorktreePhase | null {
  const candidates = scanNoFollowDirectoryTree(root).filter((entry) => /^retired-phase-[0-9a-f]{64}\.json$/u.test(entry.relativePath));
  if (candidates.length === 0) return null;
  if (candidates.length !== 1 || candidates[0]!.kind !== 'file') throw new Error('Retired closeout phase generation is ambiguous or unsafe.');
  const candidate = candidates[0]!;
  const phase = loadCanonicalFile(root, candidate.relativePath, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !hasExactObjectKeys(value, [
      'schema', 'authorizationDigest', 'tombstoneName', 'retirementReceipt', 'phaseDigest'
    ])) throw new Error('Retired closeout phase is malformed.');
    const parsed = value as RetiredWorktreePhase;
    const { schema: _schema, phaseDigest: _phaseDigest, ...material } = parsed;
    const rebuilt = createRetiredWorktreePhase(material);
    if (parsed.schema !== rebuilt.schema || parsed.phaseDigest !== rebuilt.phaseDigest || retiredPhaseName(rebuilt) !== candidate.relativePath) {
      throw new Error('Retired closeout phase digest is invalid.');
    }
    return rebuilt;
  });
  if (!phase || phase.authorizationDigest !== authorization.authorizationDigest || phase.tombstoneName !== authorization.tombstoneName) {
    throw new Error('Retired closeout phase does not bind this authorization.');
  }
  return phase;
}

async function observeProoflessWorktreeCloseoutConvergence(input: Readonly<{
  repositoryRoot: string;
  commonDir: string;
  authorization: WorktreePhysicalCloseoutAuthorization;
  retiredPhase: RetiredWorktreePhase;
  stage: string;
}>): Promise<Awaited<ReturnType<typeof observeRegistry>>> {
  const registry = await observeRegistry(input.repositoryRoot);
  const targetParent = path.dirname(input.authorization.target.path);
  const fenceParentPresence = inspectExactNoFollowDirectoryPresence(
    targetParent,
    `Proofless worktree closeout ${input.stage} fence parent`
  );
  const blockers = [
    ...(findTargetRecord(registry.records, input.authorization.target.path) !== null ? ['registry-present'] : []),
    ...(physicalPresence(input.authorization.target.path, `Proofless worktree closeout ${input.stage} target`) !== null
      ? ['target-present'] : []),
    ...(physicalPresence(
      path.join(input.commonDir, ...input.authorization.registryAdmin.relativePath.split('/')),
      `Proofless worktree closeout ${input.stage} admin`
    ) !== null ? ['registry-admin-present'] : []),
    ...(physicalPresence(
      path.join(targetParent, input.authorization.tombstoneName),
      `Proofless worktree closeout ${input.stage} tombstone`
    ) !== null ? ['tombstone-present'] : []),
    ...(inspectExactNoFollowDirectoryPresence(
      input.authorization.proofRoot.path,
      `Proofless worktree closeout ${input.stage} proof`
    ).state !== 'absent' ? ['proof-present'] : []),
    ...(fenceParentPresence.state === 'present' && readNoFollowOrdinaryFile(
      fenceParentPresence.directory.target,
      input.retiredPhase.retirementReceipt.fenceName
    ) !== null ? ['retirement-fence-present'] : [])
  ];
  if (blockers.length > 0) {
    throw new Error(
      `Proofless worktree closeout has not converged at ${input.stage}: ${blockers.join(',')}`
    );
  }
  return registry;
}

function receiptGenerationName(receipt: WorktreePhysicalCloseoutReceipt): string {
  return `receipt-${receipt.receiptDigest.slice('sha256:'.length)}.json`;
}

function parseReceiptLatestPointer(value: unknown): ReceiptLatestPointer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Receipt latest pointer is invalid.');
  const candidate = value as Partial<ReceiptLatestPointer>;
  if (candidate.schema !== 'sec-worktree-cleanup-receipt-latest-v1' ||
      typeof candidate.generation !== 'string' || !/^receipt-[0-9a-f]{64}\.json$/u.test(candidate.generation) ||
      typeof candidate.receiptDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(candidate.receiptDigest)) {
    throw new Error('Receipt latest pointer is malformed.');
  }
  return Object.freeze({ schema: candidate.schema, generation: candidate.generation, receiptDigest: candidate.receiptDigest as Digest });
}

/** Immutable receipt evidence followed by one durable latest-generation pointer. */
function persistReceiptGeneration(root: PhysicalDirectoryIdentity, receipt: WorktreePhysicalCloseoutReceipt): WorktreePhysicalCloseoutReceipt {
  const predecessor = loadLatestReceiptGeneration(root);
  const chained = receipt.previousReceiptDigest === null && predecessor !== null
    ? (() => {
      const { schema: _schema, receiptDigest: _receiptDigest, ...material } = receipt;
      return createWorktreePhysicalCloseoutReceipt({ ...material, previousReceiptDigest: predecessor.receiptDigest });
    })()
    : receipt;
  const generation = receiptGenerationName(chained);
  persistCanonical(root, generation, chained);
  const pointer: ReceiptLatestPointer = {
    schema: 'sec-worktree-cleanup-receipt-latest-v1', generation, receiptDigest: chained.receiptDigest
  };
  const bytes = canonicalBytes(pointer);
  replaceDurableCanonicalFile({
    parent: root,
    name: 'receipt-latest.json',
    bytes,
    validate: (current) => {
      const parsed = parseReceiptLatestPointer(JSON.parse(Buffer.from(current).toString('utf8')));
      if (JSON.stringify(canonicalJson(parsed)) !== JSON.stringify(canonicalJson(pointer))) {
        throw new Error('Receipt latest pointer differs from canonical generation.');
      }
    }
  });
  return chained;
}

function loadLatestReceiptGeneration(root: PhysicalDirectoryIdentity): WorktreePhysicalCloseoutReceipt | null {
  const pointer = loadCanonicalFile(root, 'receipt-latest.json', parseReceiptLatestPointer);
  if (pointer === null) return null;
  const receipt = loadCanonicalFile(root, pointer.generation, (value) =>
    assertWorktreePhysicalCloseoutReceipt(value as WorktreePhysicalCloseoutReceipt));
  if (receipt === null || receipt.receiptDigest !== pointer.receiptDigest || receiptGenerationName(receipt) !== pointer.generation) {
    throw new Error('Receipt latest pointer does not reference its immutable canonical generation.');
  }
  return receipt;
}

function loadReceiptChain(
  root: PhysicalDirectoryIdentity,
  latest: WorktreePhysicalCloseoutReceipt
): readonly WorktreePhysicalCloseoutReceipt[] {
  const chain: WorktreePhysicalCloseoutReceipt[] = [];
  const seen = new Set<Digest>();
  let current: WorktreePhysicalCloseoutReceipt | null = latest;
  while (current !== null) {
    if (seen.has(current.receiptDigest)) throw new Error('Receipt generation chain contains a cycle.');
    seen.add(current.receiptDigest);
    chain.push(current);
    if (current.previousReceiptDigest === null) break;
    current = loadCanonicalFile(root, `receipt-${current.previousReceiptDigest.slice('sha256:'.length)}.json`, (value) =>
      assertWorktreePhysicalCloseoutReceipt(value as WorktreePhysicalCloseoutReceipt));
    if (current === null || current.receiptDigest !== chain[chain.length - 1]!.previousReceiptDigest) {
      throw new Error('Receipt generation chain predecessor is absent or differs from its digest binding.');
    }
  }
  return Object.freeze(chain);
}

function loadCanonicalFile<T>(parent: PhysicalDirectoryIdentity, name: string, parse: (value: unknown) => T): T | null {
  const bytes = readNoFollowOrdinaryFile(parent, name);
  return bytes === null ? null : parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
}

function loadAuthorizedForExecution(authorizationPath: string): WorktreePhysicalCloseoutAuthorization {
  const locator = normalizedAbsolute(authorizationPath);
  const parent = physicalDirectory(path.dirname(locator), 'Execution authorization locator parent');
  const authorization = loadCanonicalFile(parent, path.basename(locator), (value) =>
    assertWorktreePhysicalCloseoutAuthorization(value as WorktreePhysicalCloseoutAuthorization));
  if (authorization === null) throw new Error('Execution authorization is absent.');
  return authorization;
}

function validateExpectedRecord(
  record: WorktreePorcelainRecord,
  input: PrepareWorktreePhysicalCloseoutInput,
  defaultBranch: string,
  repositoryRoot: string
): string[] {
  const blockers: string[] = [];
  if (pathKey(input.targetPath) === pathKey(repositoryRoot)) blockers.push('target-is-repository-root');
  if (physicalPresence(process.cwd(), 'Current execution directory') !== null) {
    const executionPath = pathKey(process.cwd());
    const targetKey = pathKey(input.targetPath);
    const executionRelative = path.relative(targetKey, executionPath);
    if (executionRelative === '' || (!executionRelative.startsWith('..') && !path.isAbsolute(executionRelative))) {
      blockers.push('target-is-current-execution-worktree');
    }
  }
  if (record.bare) blockers.push('target-is-bare');
  const detachedScratch = input.expectedBranch.startsWith(DETACHED_BRANCH_PREFIX);
  if ((!detachedScratch && (record.detached || record.branch === null)) || (detachedScratch && !record.detached)) blockers.push('target-branch-mode-mismatch');
  if (record.locked) blockers.push('target-is-locked');
  if (record.prunable) blockers.push('target-is-prunable');
  if (record.branch === defaultBranch) blockers.push('target-is-default-branch-worktree');
  if (!detachedScratch && record.branch !== input.expectedBranch) blockers.push('expected-branch-mismatch');
  if (record.headSha !== input.expectedHeadSha) blockers.push('expected-head-mismatch');
  return blockers;
}

async function assertWorktreeCloseoutAdmissionBeforeGeneratedState(input: PrepareWorktreePhysicalCloseoutInput): Promise<void> {
  const repository = await repositoryFacts(input.repositoryRoot);
  const targetPath = normalizedAbsolute(input.targetPath);
  physicalDirectory(targetPath, 'Registered target worktree');
  const registry = await observeRegistry(repository.root);
  const record = findTargetRecord(registry.records, targetPath);
  if (record === null) {
    throw new Error('Target is not registered; unknown historical orphans cannot be adopted.');
  }
  const blockers = validateExpectedRecord(record, { ...input, targetPath }, repository.defaultBranch, repository.root);
  const actualTree = shaValue(
    await requireRepositoryGit(repository.root, ['-C', targetPath, 'rev-parse', 'HEAD^{tree}'], 'Resolve target tree'),
    'Target tree'
  );
  if (actualTree !== input.expectedTreeSha) blockers.push('expected-tree-mismatch');
  if (blockers.length > 0) {
    throw new Error(`Worktree closeout preparation blocked: ${[...new Set(blockers)].sort().join(',')}`);
  }
}

export async function prepareWorktreePhysicalCloseout(
  input: PrepareWorktreePhysicalCloseoutInput
): Promise<WorktreePhysicalCloseoutAuthorization> {
  const repository = await repositoryFacts(input.repositoryRoot);
  return withWorkspaceWriteLease(repository.commonDir, undefined, async (commonLease) => {
    await assertCoordinatedRepository(repository, commonLease);
    await assertWorktreeCloseoutAdmissionBeforeGeneratedState(input);
    let generatedStateRetirement: Awaited<ReturnType<typeof settleGeneratedStateForWorktreeRetirement>> = null;
    if (!input.expectedBranch.startsWith(DETACHED_BRANCH_PREFIX)) {
      try {
        generatedStateRetirement = await settleGeneratedStateForWorktreeRetirement({
          repositoryRoot: input.repositoryRoot,
          workspaceRoot: input.targetPath,
          expectedBranch: input.expectedBranch,
          expectedHeadSha: input.expectedHeadSha,
          expectedTreeSha: input.expectedTreeSha
        }, {
          worktreeRetirementProviders: Object.freeze([
            compilerDependencyLocatorWorktreeRetirementProvider
          ])
        });
      } catch (error) {
        if (!isGeneratedStateWorktreeRetirementBlocked(error)) throw error;
        // The generated-state owner made no Effect. Preserve its fail-closed
        // classification and let #186 emit the canonical working-state blocker.
      }
    }
    await assertCoordinatedRepository(repository, commonLease);
    return withAcquiredResource({
    operationLabel: 'worktree-closeout-repository-lease-operation',
    resourceLabel: 'worktree-closeout-repository-write-lease',
    acquire: () => acquireWorkspaceWriteLease(repository.root),
    use: (repositoryLease) => withAcquiredResource({
      operationLabel: 'worktree-closeout-target-lease-operation',
      resourceLabel: 'worktree-closeout-target-write-lease',
      acquire: () => acquireWorkspaceWriteLease(input.targetPath),
      use: async (targetLease) => {
        await assertCoordinatedRepository(repository, commonLease);
        await repositoryLease.assertOwned();
        await targetLease.assertOwned();
        const ownedNamespace = await targetLease.ownedNamespace();
        const leaseHeldWorking = await observeWorkingState(
          repository.root,
          input.targetPath,
          ownedNamespace.relativePath
        );
        return prepareWorktreePhysicalCloseoutUnderLease(
          input,
          repository,
          targetLease,
          leaseHeldWorking,
          generatedStateRetirement,
          async () => {
            await assertCoordinatedRepository(repository, commonLease);
            await repositoryLease.assertOwned();
          }
        );
      },
      release: (targetLease) => targetLease.release()
    }),
    release: (repositoryLease) => repositoryLease.release()
    });
  });
}

async function prepareWorktreePhysicalCloseoutUnderLease(
  input: PrepareWorktreePhysicalCloseoutInput,
  repository: Awaited<ReturnType<typeof repositoryFacts>>,
  targetLease: Awaited<ReturnType<typeof acquireWorkspaceWriteLease>>,
  working: Awaited<ReturnType<typeof observeWorkingState>>,
  generatedStateRetirement: Awaited<ReturnType<typeof settleGeneratedStateForWorktreeRetirement>>,
  assertRepositoryLeases: () => Promise<void>
): Promise<WorktreePhysicalCloseoutAuthorization> {
  const targetPath = normalizedAbsolute(input.targetPath);
  const targetIdentity = physicalPresence(targetPath, 'Registered target worktree');
  if (targetIdentity === null) throw new Error('Registered target path is physically absent.');
  const registry = await observeRegistry(repository.root);
  const record = findTargetRecord(registry.records, targetPath);
  if (record === null) throw new Error('Target is not registered; unknown historical orphans cannot be adopted.');
  const blockers = validateExpectedRecord(record, { ...input, targetPath }, repository.defaultBranch, repository.root);
  const actualTree = shaValue(
    await requireRepositoryGit(repository.root, ['-C', targetPath, 'rev-parse', 'HEAD^{tree}'], 'Resolve target tree'),
    'Target tree'
  );
  if (actualTree !== input.expectedTreeSha) blockers.push('expected-tree-mismatch');
  if (working.blocker !== null) blockers.push(working.blocker);
  if (blockers.length > 0) {
    throw new Error(`Worktree closeout preparation blocked: ${[...new Set(blockers)].sort().join(',')}`);
  }
  await targetLease.assertOwned();
  const ownedNamespace = await targetLease.ownedNamespace();
  const targetLeaseNamespace = physicalDirectory(path.join(ownedNamespace.workspaceRoot, ownedNamespace.relativePath), 'Target writer lease namespace');
  const rawInventory = observeWorktreePhysicalInventory(targetPath);
  const inventory = withoutLeaseOwnedNamespace(rawInventory);
  const workingReadback = await observeWorkingState(
    repository.root,
    targetPath,
    ownedNamespace.relativePath
  );
  assertStableWorktreePhysicalWorkingState(working.digest, workingReadback);
  const repositoryBinding = {
    root: repository.root,
    rootDevice: repository.rootDevice,
    rootInode: repository.rootInode,
    commonDir: repository.commonDir,
    commonDirDevice: repository.commonDirDevice,
    commonDirInode: repository.commonDirInode
  };
  const target = {
    path: targetPath,
    device: targetIdentity.device,
    inode: targetIdentity.inode,
    branch: input.expectedBranch,
    headSha: input.expectedHeadSha,
    treeSha: input.expectedTreeSha,
    recoveryAuthorityDigest: input.expectedRecoveryAuthorityDigest
  };
  const registryAdminPreliminary = registryAdminForTarget(targetIdentity, repository.commonDir);
  const provisional = createWorktreePhysicalCloseoutAuthorization({
    repository: repositoryBinding,
    target,
    registryAdmin: registryAdminPreliminary,
    targetLeaseNamespace: { device: targetLeaseNamespace.device, inode: targetLeaseNamespace.inode },
    proofRoot: {
      path: path.join(path.dirname(targetPath), 'sec-worktree-closeout-proof-0000000000000000000000000000000000000000000000000000000000000000'),
      device: targetLeaseNamespace.device,
      inode: targetLeaseNamespace.inode
    },
    registryBeforeDigest: registry.digest,
    workingStateDigest: working.digest,
    generatedStateRetirement,
    inventory,
    tombstoneName: 'worktree-closeout-tombstone-0000000000000000000000000000000000000000000000000000000000000000',
    authorizationPath: '<pending>',
    receiptPath: '<pending>'
  });
  await assertRepositoryLeases();
  await targetLease.assertOwned();
  if (input.expectedBranch.startsWith(DETACHED_BRANCH_PREFIX)) {
    await assertDetachedScratchRecoveryReachable(repository, input.expectedHeadSha, input.expectedTreeSha);
  }
  const commonDir = physicalDirectory(repository.commonDir, 'Git common-dir');
  const recoveryRoot = createNoFollowDirectoryChain(commonDir, [
    'sec-worktree-closeout',
    provisional.operationId.slice('sha256:'.length)
  ]);
  const targetParent = physicalDirectory(path.dirname(targetPath), 'Target worktree parent for retained proof');
  const proofRoot = createNoFollowDirectoryChain(targetParent, [
    `sec-worktree-closeout-proof-${provisional.operationId.slice('sha256:'.length)}`
  ]);
  if (proofRoot.device !== targetLeaseNamespace.device) {
    throw new Error('Target-external retained proof root is not on the target lease namespace volume.');
  }
  if (scanNoFollowDirectoryTree(proofRoot).length !== 0) {
    throw new Error('Target-external retained proof root already contains unknown operation content.');
  }
  const registryAdmin = Object.freeze({ ...registryAdminPreliminary, tombstoneName: `worktree-admin-closeout-${provisional.operationId.slice('sha256:'.length)}` });
  const authorization = createWorktreePhysicalCloseoutAuthorization({
    repository: repositoryBinding,
    target,
    registryAdmin,
    targetLeaseNamespace: { device: targetLeaseNamespace.device, inode: targetLeaseNamespace.inode },
    proofRoot: { path: proofRoot.path, device: proofRoot.device, inode: proofRoot.inode },
    registryBeforeDigest: registry.digest,
    workingStateDigest: working.digest,
    generatedStateRetirement,
    inventory,
    tombstoneName: `worktree-closeout-tombstone-${provisional.operationId.slice('sha256:'.length)}`,
    authorizationPath: path.join(recoveryRoot.path, 'authorization.json'),
    receiptPath: path.join(recoveryRoot.path, 'receipt-latest.json')
  });
  if (authorization.operationId !== provisional.operationId) {
    throw new Error('Recovery path unexpectedly changed semantic operation identity.');
  }
  // This is the only authorization publication, and it happens before any
  // Git unregister command.  If Windows parent durability is unavailable,
  // the shared primitive fails here without touching the registry.
  await assertRepositoryLeases();
  await targetLease.assertOwned();
  persistCanonical(recoveryRoot, 'authorization.json', authorization);
  const rereadRepository = await repositoryFacts(input.repositoryRoot);
  const rereadRegistry = await observeRegistry(rereadRepository.root);
  const rereadTarget = physicalDirectory(targetPath, 'Registered target worktree');
  const rereadAdmin = physicalDirectory(
    path.join(repository.commonDir, ...registryAdmin.relativePath.split('/')),
    'Registered target Git admin directory'
  );
  if (
    rereadRepository.rootDevice !== repository.rootDevice ||
    rereadRepository.rootInode !== repository.rootInode ||
    rereadRepository.commonDirDevice !== repository.commonDirDevice ||
    rereadRepository.commonDirInode !== repository.commonDirInode ||
    rereadRegistry.digest !== registry.digest ||
    rereadTarget.device !== targetIdentity.device ||
    rereadTarget.inode !== targetIdentity.inode ||
    rereadAdmin.device !== registryAdmin.device ||
    rereadAdmin.inode !== registryAdmin.inode ||
    observeDirectoryPhysicalInventory(rereadAdmin).inventoryDigest !== registryAdmin.inventory.inventoryDigest
  ) {
    throw new Error('Live repository, common-dir, registry, or target identity changed during authorization publication.');
  }
  await assertRepositoryLeases();
  await targetLease.assertOwned();
  return authorization;
}

/**
 * The only token issuer.  It binds an authorization observed/published by the
 * live engine in this process; callers cannot construct it from a digest or
 * raw receipt JSON.
 */
export async function prepareTrustedWorktreePhysicalCloseout(
  input: PrepareWorktreePhysicalCloseoutInput
): Promise<PreparedWorktreePhysicalCloseout> {
  if (input.expectedBranch.startsWith(DETACHED_BRANCH_PREFIX)) {
    throw new Error('Detached scratch closeout cannot mint a branch/ref consumption token.');
  }
  const authorization = await prepareWorktreePhysicalCloseout(input);
  const token = new WorktreePhysicalCloseoutConsumptionToken();
  trustedConsumptionTokens.set(token, Object.freeze({
    authorization,
    retirementReceiptDigest: null,
    phaseDigest: null,
    adminEffectDigest: null,
    completedReceiptDigest: null
  }));
  let tokens = trustedTokensByAuthorization.get(authorization.authorizationDigest);
  if (tokens === undefined) {
    tokens = new Set();
    trustedTokensByAuthorization.set(authorization.authorizationDigest, tokens);
  }
  tokens.add(token);
  return Object.freeze({ authorization, token });
}

export async function prepareDetachedScratchWorktreePhysicalCloseout(
  input: PrepareDetachedScratchWorktreePhysicalCloseoutInput
): Promise<WorktreePhysicalCloseoutAuthorization> {
  return prepareWorktreePhysicalCloseout({
    ...input,
    expectedBranch: detachedMarker(input.expectedHeadSha),
    expectedRecoveryAuthorityDigest: detachedRecoveryCorrelationDigest(input)
  });
}

export async function executeDetachedScratchWorktreePhysicalCloseout(
  input: ExecuteDetachedScratchWorktreePhysicalCloseoutInput
): Promise<WorktreePhysicalCloseoutReceipt> {
  return executeWorktreePhysicalCloseout({
    ...input,
    expectedBranch: detachedMarker(input.expectedHeadSha),
    expectedRecoveryAuthorityDigest: detachedRecoveryCorrelationDigest(input)
  });
}

function boundedWait(milliseconds: number): void {
  if (milliseconds <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
}

function removeAuthorizedResidue(
  targetPath: string,
  inventory: WorktreePhysicalInventory,
  attempts: WorktreePhysicalCloseoutAttempt[]
): void {
  const ordered = [...inventory.entries].sort((left, right) => {
    const depth = (value: string) => value.split('/').length;
    return depth(right.relativePath) - depth(left.relativePath) || right.relativePath.localeCompare(left.relativePath);
  });
  const inventoriedDirectories = new Map(
    inventory.entries.filter((entry) => entry.kind === 'directory')
      .map((entry) => [entry.relativePath, entry] as const)
  );
  // The caller has already compared one complete no-follow inventory to the
  // authorization.  Do not rescan the whole tree for every leaf: that turns
  // a bounded retained cleanup into O(n²).  Each delete still reopens its
  // retained root/parent/leaf and fences the exact device/inode; newly added
  // or changed siblings are never selected and are caught by final readback.
  for (const entry of ordered) {
    let removed = false;
    let lastError = 'unknown';
    for (let index = 0; index < MAX_CLEANUP_ATTEMPTS; index += 1) {
      boundedWait(BACKOFF_MILLISECONDS[index]!);
      try {
        const target = physicalDirectory(targetPath, 'Residue cleanup root');
        const components = entry.relativePath.split('/');
        components.pop();
        const ancestorDirectories = components.map((_, index) => {
          const relativePath = components.slice(0, index + 1).join('/');
          const ancestor = inventoriedDirectories.get(relativePath);
          if (ancestor === undefined) throw new Error(`Authorized cleanup ancestor is absent from inventory: ${relativePath}`);
          return Object.freeze({ relativePath, device: ancestor.device, inode: ancestor.inode });
        });
        deleteRetainedNoFollowEntry({
          root: target,
          relativePath: entry.relativePath,
          kind: entry.kind === 'symlink' ? 'link' : entry.kind,
          device: entry.device,
          inode: entry.inode,
          ancestorDirectories
        });
        attempts.push({
          operation: 'physical-cleanup',
          status: 'success',
          relativePath: entry.relativePath,
          detailDigest: detailDigest({ attempt: index + 1, kind: entry.kind })
        });
        removed = true;
        break;
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
        lastError = code;
        if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'].includes(code)) break;
      }
    }
    if (!removed) {
      attempts.push({
        operation: 'physical-cleanup',
        status: 'failed',
        relativePath: entry.relativePath,
        detailDigest: detailDigest({ code: lastError, attempts: MAX_CLEANUP_ATTEMPTS })
      });
      return;
    }
  }
  for (let index = 0; index < MAX_CLEANUP_ATTEMPTS && physicalPresence(targetPath, 'Residue cleanup root') !== null; index += 1) {
    boundedWait(BACKOFF_MILLISECONDS[index]!);
    try {
      const parent = physicalDirectory(path.dirname(targetPath), 'Residue cleanup target parent');
      const target = physicalPresence(targetPath, 'Residue cleanup target');
      if (target === null) return;
      deleteRetainedNoFollowEntry({
        root: parent,
        relativePath: path.basename(targetPath),
        kind: 'directory',
        device: target.device,
        inode: target.inode,
        ancestorDirectories: []
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
      if (!['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'].includes(code)) break;
    }
  }
}

function createReceipt(
  authorization: WorktreePhysicalCloseoutAuthorization,
  registryAfterDigest: Digest,
  attempts: readonly WorktreePhysicalCloseoutAttempt[],
  registryPresent: boolean,
  physicalPresent: boolean,
  inventoryAfter: WorktreePhysicalInventory | null,
  blockers: readonly string[],
  previousReceiptDigest: Digest | null = null
): WorktreePhysicalCloseoutReceipt {
  const terminal =
    !registryPresent && !physicalPresent && blockers.length === 0
      ? 'completed'
      : !registryPresent && physicalPresent
        ? 'residue'
        : 'blocked';
  return createWorktreePhysicalCloseoutReceipt({
    operationId: authorization.operationId,
    authorizationDigest: authorization.authorizationDigest,
    repository: authorization.repository,
    target: authorization.target,
    registryBeforeDigest: authorization.registryBeforeDigest,
    registryAfterDigest,
    workingStateDigest: authorization.workingStateDigest,
    inventoryBeforeDigest: authorization.inventory.inventoryDigest,
    inventoryAfterDigest: inventoryAfter?.inventoryDigest ?? null,
    previousReceiptDigest,
    attempts,
    readback: { registryPresent, physicalPresent, authorizationValid: true },
    terminal,
    blockers
  });
}

/**
 * Once unregister has been attempted, an inability to observe either the
 * registry or target is itself residue.  The conservative booleans deliberately
 * make this receipt non-completable; a later execution must re-open the live
 * operation root and perform a fresh readback instead of treating an exception
 * as absence.
 */
function postUnregisterObservationFailureReceipt(
  authorization: WorktreePhysicalCloseoutAuthorization,
  recoveryRoot: PhysicalDirectoryIdentity,
  lastKnownRegistryDigest: Digest,
  attempts: WorktreePhysicalCloseoutAttempt[],
  stage: string,
  error: unknown
): WorktreePhysicalCloseoutReceipt {
  const fingerprint = detailDigest({
    stage,
    error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    retryCondition: 'reopen-live-common-dir-and-rerun-registry-and-no-follow-readback'
  });
  attempts.push({
    operation: 'readback',
    status: 'failed',
    relativePath: null,
    detailDigest: fingerprint
  });
  const receipt = createReceipt(authorization, lastKnownRegistryDigest, attempts, true, true, null, [
    `post-unregister-observation-failed:${stage}:${fingerprint}`
  ]);
  return persistReceiptGeneration(recoveryRoot, receipt);
}

async function retireAuthorizedTargetForCleanup(input: Readonly<{
  authorization: WorktreePhysicalCloseoutAuthorization;
  cleanupPath: string;
  expectedProofRoot: PhysicalDirectoryIdentity;
  expectedRecoveryRoot: PhysicalDirectoryIdentity;
  allowAuthorizedSubset: boolean;
}>): Promise<
  | Readonly<{ status: 'blocked'; blockers: readonly string[]; inventory: WorktreePhysicalInventory | null }>
  | Readonly<{
      status: 'retired';
      cleanupPath: string;
      inventory: WorktreePhysicalInventory;
      retirementReceipt: WorkspaceWriteLeaseRetirementReceipt;
    }>
> {
  let cleanupPath = input.cleanupPath;
  const targetLease = await acquireWorkspaceWriteLease(cleanupPath);
  try {
    await targetLease.assertOwned();
    const retainedTarget = physicalDirectory(cleanupPath, 'Authorized target cleanup root');
    if (retainedTarget.device !== input.authorization.target.device ||
        retainedTarget.inode !== input.authorization.target.inode) {
      return Object.freeze({
        status: 'blocked',
        blockers: ['target-physical-identity-changed'],
        inventory: null
      });
    }
    const inventory = withoutLeaseOwnedNamespace(observeWorktreePhysicalInventory(cleanupPath));
    const blockers = input.allowAuthorizedSubset
      ? classifyAuthorizedWorktreeResidue(inventory, input.authorization.inventory)
      : inventory.inventoryDigest === input.authorization.inventory.inventoryDigest
        ? []
        : ['inventory-changed-after-authorization'];
    if (blockers.length > 0) return Object.freeze({ status: 'blocked', blockers, inventory });
    if (cleanupPath === input.authorization.target.path) {
      cleanupPath = relocateRetainedNoFollowDirectory({
        directory: physicalDirectory(input.authorization.target.path, 'Target retained tombstone source'),
        tombstoneName: input.authorization.tombstoneName
      }).path;
      await targetLease.relocate(cleanupPath);
    }
    const liveLeaseNamespace = physicalDirectory(
      path.join(cleanupPath, '.sec', 'workspace-write-lease'),
      'Authorized target writer lease namespace'
    );
    if (liveLeaseNamespace.device !== input.authorization.targetLeaseNamespace.device ||
        liveLeaseNamespace.inode !== input.authorization.targetLeaseNamespace.inode) {
      throw new Error('Target writer lease namespace identity changed after authorization.');
    }
    const intent = createRetiredWorktreeIntent({
      authorizationDigest: input.authorization.authorizationDigest,
      tombstoneName: input.authorization.tombstoneName,
      targetDevice: input.authorization.target.device,
      targetInode: input.authorization.target.inode
    });
    persistRetiredWorktreeIntent(input.expectedRecoveryRoot, intent);
    const retirementReceipt = await targetLease.retireOwnedNamespace(intent.intentDigest, input.expectedProofRoot);
    assertAuthorizedLeaseNamespaceBinding(input.authorization, retirementReceipt);
    const phase = createRetiredWorktreePhase({
      authorizationDigest: input.authorization.authorizationDigest,
      tombstoneName: input.authorization.tombstoneName,
      retirementReceipt
    });
    persistRetiredWorktreePhase(input.expectedRecoveryRoot, phase);
    issueTrustedRetirement(input.authorization, retirementReceipt, phase);
    recoverWorkspaceWriteLeaseRetirement({
      workspaceRoot: cleanupPath,
      intentDigest: intent.intentDigest,
      proofParent: input.expectedProofRoot
    });
    return Object.freeze({ status: 'retired', cleanupPath, inventory, retirementReceipt });
  } finally {
    try { await targetLease.release(); } catch { /* retirement invalidates its handle */ }
  }
}

async function executeWorktreePhysicalCloseoutUnderLease(
  input: ExecuteWorktreePhysicalCloseoutInput,
  assertLeases: () => Promise<void>
): Promise<WorktreePhysicalCloseoutReceipt> {
  const authorization = loadAuthorizedForExecution(input.authorizationPath);
  if (
    pathKey(authorization.repository.root) !== pathKey(input.repositoryRoot) ||
    pathKey(authorization.target.path) !== pathKey(input.targetPath) ||
    authorization.target.branch !== input.expectedBranch ||
    authorization.target.headSha !== input.expectedHeadSha ||
    authorization.target.treeSha !== input.expectedTreeSha ||
    authorization.target.recoveryAuthorityDigest !== input.expectedRecoveryAuthorityDigest
  ) {
    throw new Error('Execution request does not match the durable authorization identity.');
  }
  const repository = await repositoryFacts(input.repositoryRoot);
  const expectedRecoveryRoot = createNoFollowDirectoryChain(physicalDirectory(repository.commonDir, 'Git common-dir'), [
    'sec-worktree-closeout',
    authorization.operationId.slice('sha256:'.length)
  ]);
  const expectedProofPath = path.join(
    path.dirname(authorization.target.path),
    `sec-worktree-closeout-proof-${authorization.operationId.slice('sha256:'.length)}`
  );
  if (pathKey(authorization.proofRoot.path) !== pathKey(expectedProofPath)) {
    throw new Error('Authorization proof root is not the canonical target-external operation leaf.');
  }
  if (
    pathKey(authorization.authorizationPath) !== pathKey(path.join(expectedRecoveryRoot.path, 'authorization.json')) ||
    pathKey(authorization.receiptPath) !== pathKey(path.join(expectedRecoveryRoot.path, 'receipt-latest.json')) ||
    pathKey(input.authorizationPath) !== pathKey(authorization.authorizationPath)
  ) {
    throw new Error('Durable authorization paths do not match the canonical Git common-dir operation root.');
  }
  if (
    repository.rootDevice !== authorization.repository.rootDevice ||
    repository.rootInode !== authorization.repository.rootInode ||
    repository.commonDirDevice !== authorization.repository.commonDirDevice ||
    repository.commonDirInode !== authorization.repository.commonDirInode
  ) {
    throw new Error('Repository or Git common-dir physical identity changed after authorization.');
  }
  await assertLeases();
  if (authorization.target.branch.startsWith(DETACHED_BRANCH_PREFIX)) {
    await assertDetachedScratchRecoveryReachable(
      repository, authorization.target.headSha, authorization.target.treeSha
    );
  }
  const prior = loadLatestReceiptGeneration(expectedRecoveryRoot);
  const proofPresence = inspectExactNoFollowDirectoryPresence(
    authorization.proofRoot.path,
    'Authorized target-external retained proof root'
  );
  if (proofPresence.state === 'absent') {
    if (
      !isFieldlessLegacyWorktreePhysicalCloseoutAuthorization(authorization) ||
      authorization.generatedStateRetirement !== null ||
      prior === null
    ) {
      throw new Error('Worktree closeout proof root is absent without a legacy resumable receipt.');
    }
    if (prior.authorizationDigest !== authorization.authorizationDigest) {
      throw new Error('Existing legacy receipt belongs to another authorization.');
    }
    const chain = loadReceiptChain(expectedRecoveryRoot, prior);
    if (chain.some((generation) => generation.authorizationDigest !== authorization.authorizationDigest
        || generation.operationId !== authorization.operationId)) {
      throw new Error('Legacy receipt chain crosses authorization.');
    }
    if (!chain.some((generation) => generation.attempts.some((attempt) => (
      attempt.operation === 'unregister' && attempt.status === 'success'
    )))) {
      throw new Error('Legacy proofless closeout lacks durable unregister success.');
    }
    const retiredPhase = loadRetiredWorktreePhase(expectedRecoveryRoot, authorization);
    if (retiredPhase === null) {
      throw new Error('Legacy proofless closeout lacks its durable retirement phase.');
    }
    await observeProoflessWorktreeCloseoutConvergence({
      repositoryRoot: repository.root,
      commonDir: repository.commonDir,
      authorization,
      retiredPhase,
      stage: 'initial'
    });
    await assertLeases();
    const registry = await observeProoflessWorktreeCloseoutConvergence({
      repositoryRoot: repository.root,
      commonDir: repository.commonDir,
      authorization,
      retiredPhase,
      stage: 'effect-boundary'
    });
    await assertLeases();
    return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
      authorization,
      registry.digest,
      [{
        operation: 'readback',
        status: 'success',
        relativePath: null,
        detailDigest: detailDigest('legacy-proofless-terminal-absence-readback')
      }],
      false,
      false,
      null,
      []
    ));
  }
  const expectedProofRoot = proofPresence.directory.target;
  if (expectedProofRoot.device !== authorization.proofRoot.device || expectedProofRoot.inode !== authorization.proofRoot.inode ||
    expectedProofRoot.device !== authorization.targetLeaseNamespace.device) {
    throw new Error('Authorization proof root physical identity or target-volume binding changed.');
  }
  if (authorization.generatedStateRetirement !== null) {
    assertGeneratedStateWorktreeRetirementEffectStart({
      receipt: authorization.generatedStateRetirement,
      repositoryRoot: authorization.repository.root,
      workspaceRoot: authorization.target.path,
      expectedBranch: authorization.target.branch,
      expectedHeadSha: authorization.target.headSha,
      expectedTreeSha: authorization.target.treeSha
    });
  }
  if (prior !== null) {
    if (prior.authorizationDigest !== authorization.authorizationDigest) {
      throw new Error('Existing receipt belongs to another authorization.');
    }
    if (prior.terminal === 'completed') {
      const currentRegistry = await observeRegistry(repository.root);
      if (findTargetRecord(currentRegistry.records, authorization.target.path) !== null ||
          physicalPresence(authorization.target.path, 'Completed target readback') !== null) {
        throw new Error('Completed receipt readback is stale because registry or physical target reappeared.');
      }
      const phase = loadRetiredWorktreePhase(expectedRecoveryRoot, authorization);
      if (phase === null) throw new Error('Completed receipt lacks its required durable retirement phase.');
      assertAuthorizedLeaseNamespaceBinding(authorization, phase.retirementReceipt);
      assertWorkspaceWriteLeaseRetirementProof({
        workspaceRoot: path.join(path.dirname(authorization.target.path), authorization.tombstoneName),
        receipt: phase.retirementReceipt,
        proofParent: expectedProofRoot
      });
      const fenceParent = physicalDirectory(path.dirname(authorization.target.path), 'Completed retirement fence parent');
      if (readNoFollowOrdinaryFile(fenceParent, phase.retirementReceipt.fenceName) === null) return prior;
      // A completed receipt is only terminal after its external fence is
      // removed and read back.  Fall through to the monotonic completion
      // tail instead of stranding a live writer fence behind a fast-path.
    }
  }

  const attempts: WorktreePhysicalCloseoutAttempt[] = [];
  let retirementReceipt: Awaited<ReturnType<Awaited<ReturnType<typeof acquireWorkspaceWriteLease>>['retireOwnedNamespace']>> | null = null;
  const retirementIntent = loadRetiredWorktreeIntent(expectedRecoveryRoot, authorization);
  let retiredPhase = loadRetiredWorktreePhase(expectedRecoveryRoot, authorization);
  // A crash after retiring the lease namespace but before publishing its
  // phase cannot be recovered from caller JSON.  The durable intent is the
  // locator; the lease owner reconstructs the receipt solely from the live
  // no-follow tombstone and its external identity-bound fence.
  if (retiredPhase === null && retirementIntent !== null) {
    const tombstonePath = path.join(path.dirname(authorization.target.path), authorization.tombstoneName);
    try {
      const retirementReceipt = await resumeWorkspaceWriteLeaseRetirement({
        workspaceRoot: tombstonePath,
        intentDigest: retirementIntent.intentDigest,
        proofParent: expectedProofRoot
      });
      retiredPhase = createRetiredWorktreePhase({
        authorizationDigest: authorization.authorizationDigest,
        tombstoneName: authorization.tombstoneName,
        retirementReceipt
      });
      persistRetiredWorktreePhase(expectedRecoveryRoot, retiredPhase);
    } catch (error) {
      return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, (await observeRegistry(repository.root)).digest, [], true, true, null,
        [`retirement-intent-recovery-blocked:${detailDigest(error instanceof Error ? error.message : String(error))}`]
      ));
    }
  }
  if (retiredPhase !== null) retirementReceipt = retiredPhase.retirementReceipt;
  if (retirementReceipt !== null) assertAuthorizedLeaseNamespaceBinding(authorization, retirementReceipt);
  let recoveredFenceAbsence = false;
  if (retiredPhase !== null) {
    const fenceParent = physicalDirectory(path.dirname(authorization.target.path), 'Retirement fence recovery parent');
    const fencePresent = readNoFollowOrdinaryFile(fenceParent, retiredPhase.retirementReceipt.fenceName) !== null;
    if (!fencePresent) {
      const latest = loadLatestReceiptGeneration(expectedRecoveryRoot);
      const intent = latest !== null && loadReceiptChain(expectedRecoveryRoot, latest).some((generation) =>
        generation.blockers.includes('retirement-fence-completion-pending')
      );
      if (!intent) {
        return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
          authorization, (await observeRegistry(repository.root)).digest, [], true, true, null,
          ['retirement-fence-absent-without-durable-completion-intent']
        ));
      }
      recoveredFenceAbsence = true;
    }
  }
  let registry = await observeRegistry(repository.root);
  let record = findTargetRecord(registry.records, authorization.target.path);
  const registryAdminPath = path.join(repository.commonDir, ...authorization.registryAdmin.relativePath.split('/'));
  const registryAdminTombstonePath = path.join(expectedRecoveryRoot.path, authorization.registryAdmin.tombstoneName);
  let cleanupPath = authorization.target.path;
  let cleanupInventory = authorization.inventory;
  let externalRegistryRemovalBlocker: string | null = prior !== null &&
    loadReceiptChain(expectedRecoveryRoot, prior).some((generation) =>
      generation.blockers.includes('external-registry-removal-without-retained-admin-effect')
    )
    ? 'external-registry-removal-without-retained-admin-effect'
    : null;
  if (record !== null) {
    const tombstonePath = path.join(path.dirname(authorization.target.path), authorization.tombstoneName);
    if (retiredPhase !== null) {
      cleanupPath = tombstonePath;
      const tombstone = physicalPresence(tombstonePath, 'Retired target tombstone presence');
      if (tombstone === null || tombstone.device !== authorization.target.device || tombstone.inode !== authorization.target.inode) {
        return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, true, true, null, ['retired-phase-exact-tombstone-unavailable']
        ));
      }
      try {
        assertAuthorizedLeaseNamespaceBinding(authorization, retiredPhase.retirementReceipt);
        assertWorkspaceWriteLeaseRetirement({ workspaceRoot: tombstonePath, receipt: retiredPhase.retirementReceipt });
        recoverWorkspaceWriteLeaseRetirement({ workspaceRoot: tombstonePath, intentDigest: retiredPhase.retirementReceipt.intentDigest, proofParent: expectedProofRoot });
      } catch (error) {
        return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, true, true, null,
          [`retired-phase-fence-invalid:${detailDigest(error instanceof Error ? error.message : String(error))}`]
        ));
      }
      // A recreated lexical path is a different writer object.  Registry
      // deletion below is identity-bound to common-dir metadata, not this
      // path, so leave it untouched and let final readback report it as
      // residue instead of ever sending it through a Git path effect.
    } else {
    let originalPresent: PhysicalDirectoryIdentity | null;
    try {
      originalPresent = physicalPresence(authorization.target.path, 'Target original presence');
    } catch (error) {
      const receipt = createReceipt(authorization, registry.digest, attempts, true, true, null, [
        `target-identity-observation:${detailDigest(error instanceof Error ? error.message : String(error))}`
      ]);
      return persistReceiptGeneration(expectedRecoveryRoot, receipt);
    }
    if (originalPresent === null) {
      const tombstone = physicalPresence(tombstonePath, 'Target tombstone presence');
      if (tombstone === null || tombstone.device !== authorization.target.device || tombstone.inode !== authorization.target.inode) {
        const receipt = createReceipt(authorization, registry.digest, attempts, true, true, null, ['target-and-exact-tombstone-unavailable']);
        return persistReceiptGeneration(expectedRecoveryRoot, receipt);
      }
      cleanupPath = tombstonePath;
    }
    try {
      const targetIdentity = physicalDirectory(cleanupPath, 'Target worktree root');
      if (targetIdentity.device !== authorization.target.device || targetIdentity.inode !== authorization.target.inode) {
        throw new Error('Target worktree root physical identity changed after authorization.');
      }
    } catch (error) {
      const receipt = createReceipt(authorization, registry.digest, attempts, true,
        // A reparse/dangling/replaced target is present-but-unsafe, never an
        // absence inference.  Keep the receipt blocked without reopening a
        // path-controlled object solely to populate a boolean.
        true, null, [
        `target-identity-observation:${detailDigest(error instanceof Error ? error.message : String(error))}`
      ]);
      return persistReceiptGeneration(expectedRecoveryRoot, receipt);
    }
    const blockers = validateExpectedRecord(record, input, repository.defaultBranch, repository.root)
      .filter((blocker) => cleanupPath === authorization.target.path || blocker !== 'target-is-prunable');
    // The target writer lease contributes its own untracked `.sec` protocol.
    // The lease-held, namespace-filtered physical inventory below is the
    // authoritative post-authorization mutation fence.
    const tree = shaValue(
      await requireRepositoryGit(repository.root, ['-C', cleanupPath, 'rev-parse', 'HEAD^{tree}'], 'Resolve target tree'),
      'Target tree'
    );
    if (tree !== authorization.target.treeSha) blockers.push('tree-changed-after-authorization');
    const inventory = withoutLeaseOwnedNamespace(observeWorktreePhysicalInventory(cleanupPath));
    if (inventory.inventoryDigest !== authorization.inventory.inventoryDigest) {
      blockers.push('inventory-changed-after-authorization');
    }
    if (blockers.length > 0) {
      const receipt = createReceipt(authorization, registry.digest, attempts, true, true, inventory, blockers);
      return persistReceiptGeneration(expectedRecoveryRoot, receipt);
    }
    const retiredTarget = await retireAuthorizedTargetForCleanup({
      authorization,
      cleanupPath,
      expectedProofRoot,
      expectedRecoveryRoot,
      allowAuthorizedSubset: false
    });
    if (retiredTarget.status === 'blocked') {
      return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, true, true,
        retiredTarget.inventory, retiredTarget.blockers
      ));
    }
    cleanupPath = retiredTarget.cleanupPath;
    cleanupInventory = retiredTarget.inventory;
    retirementReceipt = retiredTarget.retirementReceipt;
    }
    // The retained tombstone makes the original target literal ENOENT while
    // preserving its identity and lease fence.  Persisted authorization is
    // therefore followed by the narrow registry-only Git effect first;
    // physical cleanup cannot run until registry readback is durable evidence.
    attempts.push({
      operation: 'unregister', status: 'skipped', relativePath: null,
      detailDigest: detailDigest('durable-unregister-intent-before-registry-effect')
    });
    persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
      authorization, registry.digest, attempts, true, true, cleanupInventory, ['unregister-intent-durable']
    ));
    // Registry removal is never delegated to `git worktree remove <path>`:
    // that command re-resolves a hostile lexical target after our ENOENT
    // fence.  Authorization binds the exact common-dir worktrees/<id> object
    // and its no-follow inventory instead.
    const registryAdmin = physicalPresence(registryAdminPath, 'Authorized Git worktree admin directory');
    if (registryAdmin === null || registryAdmin.device !== authorization.registryAdmin.device || registryAdmin.inode !== authorization.registryAdmin.inode) {
      return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, true, true, cleanupInventory, ['registry-admin-identity-unavailable']
      ));
    }
    const registryAdminInventory = observeDirectoryPhysicalInventory(registryAdmin);
    if (registryAdminInventory.inventoryDigest !== authorization.registryAdmin.inventory.inventoryDigest) {
      return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, true, true, cleanupInventory, ['registry-admin-inventory-changed']
      ));
    }
    await assertLeases();
    if (authorization.target.branch.startsWith(DETACHED_BRANCH_PREFIX)) {
      await assertDetachedScratchRecoveryReachable(
        repository, authorization.target.headSha, authorization.target.treeSha
      );
    }
    const movedAdmin = relocateRetainedNoFollowDirectoryAcrossParents({
      directory: registryAdmin,
      destinationParent: expectedRecoveryRoot,
      tombstoneName: authorization.registryAdmin.tombstoneName
    });
    const adminEffectDigest = detailDigest({
      method: 'retained-common-dir-admin-cross-parent-rename',
      relativePath: authorization.registryAdmin.relativePath,
      tombstoneName: authorization.registryAdmin.tombstoneName,
      device: movedAdmin.device,
      inode: movedAdmin.inode
    });
    // Only the executor that received the retained rename result may elevate
    // a prepared opaque token. Durable receipts can converge later processes,
    // but their public self-digests are never an issuer credential.
    issueTrustedAdminEffect(authorization, adminEffectDigest);
    attempts.push({
      operation: 'unregister',
      status: 'success',
      relativePath: null,
      detailDigest: adminEffectDigest
    });
    await assertLeases();
    try {
      registry = await observeRegistry(repository.root);
      record = findTargetRecord(registry.records, authorization.target.path);
      if (record !== null) {
        const physical = physicalPresence(authorization.target.path, 'Unregister target readback');
        const inventoryAfter = physical === null ? null : observeWorktreePhysicalInventory(authorization.target.path);
        const receipt = createReceipt(authorization, registry.digest, attempts, true, physical !== null, inventoryAfter, [
          'registry-still-present-after-unregister-attempt'
        ]);
        return persistReceiptGeneration(expectedRecoveryRoot, receipt);
      }
      // Registry disappearance is itself an effect.  Persist it before any
      // retained physical cleanup, so every later completed generation has a
      // durable predecessor proving unregister/readback closure.
      attempts.push({
        operation: 'readback', status: 'success', relativePath: null,
        detailDigest: detailDigest('registry-absent-effect-proof-before-cleanup')
      });
      persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, true, cleanupInventory, ['physical-cleanup-pending-after-registry-absence']
      ));
      removeAuthorizedResidue(registryAdminTombstonePath, authorization.registryAdmin.inventory, attempts);
    } catch (error) {
      return postUnregisterObservationFailureReceipt(
        authorization, expectedRecoveryRoot, registry.digest, attempts, 'registry-after-unregister', error
      );
    }
  } else {
    const adminTombstone = physicalPresence(registryAdminTombstonePath, 'Registry-absent admin tombstone witness');
    if (adminTombstone !== null) {
      if (adminTombstone.device !== authorization.registryAdmin.device || adminTombstone.inode !== authorization.registryAdmin.inode) {
        return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(authorization, registry.digest, attempts, false, true, null, ['registry-admin-tombstone-identity-changed']));
      }
      const subset = observeDirectoryPhysicalInventory(adminTombstone);
      const adminBlockers = classifyAuthorizedWorktreeResidue(subset, authorization.registryAdmin.inventory);
      if (adminBlockers.length > 0) return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(authorization, registry.digest, attempts, false, true, null, adminBlockers.map((blocker) => `registry-admin-${blocker}`)));
      attempts.push({ operation: 'unregister', status: 'success', relativePath: null, detailDigest: detailDigest('registry-absent-admin-tombstone-effect-witness') });
      persistReceiptGeneration(expectedRecoveryRoot, createReceipt(authorization, registry.digest, attempts, false, true, null, ['registry-admin-cleanup-pending-after-crash']));
      removeAuthorizedResidue(registryAdminTombstonePath, subset, attempts);
    }
    if (retiredPhase === null && adminTombstone === null) {
      const target = physicalPresence(authorization.target.path, 'Externally unregistered target residue');
      if (target !== null && target.device === authorization.target.device && target.inode === authorization.target.inode) {
        try {
          const retiredTarget = await retireAuthorizedTargetForCleanup({
            authorization,
            cleanupPath: authorization.target.path,
            expectedProofRoot,
            expectedRecoveryRoot,
            allowAuthorizedSubset: true
          });
          if (retiredTarget.status === 'blocked') {
            return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
              authorization, registry.digest, attempts, false, true,
              retiredTarget.inventory,
              retiredTarget.blockers.map((blocker) => `external-half-settled-${blocker}`)
            ));
          }
          cleanupPath = retiredTarget.cleanupPath;
          cleanupInventory = retiredTarget.inventory;
          retirementReceipt = retiredTarget.retirementReceipt;
          externalRegistryRemovalBlocker = 'external-registry-removal-without-retained-admin-effect';
        } catch (error) {
          return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
            authorization, registry.digest, attempts, false, true, null,
            [`external-half-settled-retirement-blocked:${detailDigest(error instanceof Error ? error.message : String(error))}`]
          ));
        }
      }
    }
    if (retiredPhase !== null) {
      cleanupPath = path.join(path.dirname(authorization.target.path), authorization.tombstoneName);
      const tombstone = physicalPresence(cleanupPath, 'Registry-absent retired tombstone presence');
      if (tombstone === null) {
        const latest = loadLatestReceiptGeneration(expectedRecoveryRoot);
        const cleanupReadbackDurable = latest !== null && loadReceiptChain(expectedRecoveryRoot, latest).some((candidate) =>
          candidate.readback.registryPresent === false && candidate.readback.physicalPresent === false &&
          candidate.blockers.includes('cleanup-readback-durable-before-fence-completion')
        );
        if (!cleanupReadbackDurable) {
          return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
            authorization, registry.digest, attempts, false, true, null, ['registry-absent-exact-tombstone-unavailable']
          ));
        }
      } else if (tombstone.device !== authorization.target.device || tombstone.inode !== authorization.target.inode) {
        return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, false, true, null, ['registry-absent-exact-tombstone-unavailable']
        ));
      } else {
        try {
          assertAuthorizedLeaseNamespaceBinding(authorization, retiredPhase.retirementReceipt);
          assertWorkspaceWriteLeaseRetirement({ workspaceRoot: cleanupPath, receipt: retiredPhase.retirementReceipt });
          recoverWorkspaceWriteLeaseRetirement({ workspaceRoot: cleanupPath, intentDigest: retiredPhase.retirementReceipt.intentDigest, proofParent: expectedProofRoot });
        } catch (error) {
          return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
            authorization, registry.digest, attempts, false, true, null,
            [`registry-absent-retired-fence-invalid:${detailDigest(error instanceof Error ? error.message : String(error))}`]
          ));
        }
      }
    }
    attempts.push({
      operation: 'unregister',
      status: 'skipped',
      relativePath: null,
      detailDigest: detailDigest('registry-already-absent-authorized-resume')
    });
  }

  // Git no longer enumerating the registration is not enough: the retained
  // admin tombstone is the only witness that the exact authorized admin tree
  // was removed.  A failed/partial cleanup must remain residue, and a crash
  // after successful removal gets a durable cleanup readback generation before
  // any target/fence terminal tail can claim completion.
  if (findTargetRecord((await observeRegistry(repository.root)).records, authorization.target.path) === null) {
    const remainingAdmin = physicalPresence(registryAdminTombstonePath, 'Registry admin cleanup final readback');
    if (remainingAdmin !== null) {
      return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, true, null,
        ['registry-admin-tombstone-residue-after-cleanup']
      ));
    }
    const latest = loadLatestReceiptGeneration(expectedRecoveryRoot);
    const chain = latest === null ? [] : loadReceiptChain(expectedRecoveryRoot, latest);
    const exactAdminEffectWitnessed = chain.some((generation) => generation.attempts.some((attempt) =>
      attempt.operation === 'unregister' && attempt.status === 'success'
    ));
    if (!exactAdminEffectWitnessed) {
      if (externalRegistryRemovalBlocker !== null) {
        persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, false, true, cleanupInventory,
          [externalRegistryRemovalBlocker]
        ));
      } else {
        return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, false, true, null,
          ['registry-admin-disappeared-without-authorized-effect-witness']
        ));
      }
    }
    const alreadyWitnessed = chain.some((generation) =>
      generation.blockers.includes('registry-admin-cleanup-readback-durable')
    );
    if (!alreadyWitnessed) {
      persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, true, null,
        ['registry-admin-cleanup-readback-durable']
      ));
    }
  }

  try {
    let blockers: string[] = externalRegistryRemovalBlocker === null ? [] : [externalRegistryRemovalBlocker];
    const remainingTarget = physicalPresence(cleanupPath, 'Residue target');
    if (remainingTarget !== null) {
      const targetIdentity = remainingTarget;
      if (targetIdentity.device !== authorization.target.device || targetIdentity.inode !== authorization.target.inode) {
        blockers.push('target-physical-identity-changed');
      } else {
        const current = observeWorktreePhysicalInventory(cleanupPath);
        const residueBlockers = classifyAuthorizedWorktreeResidue(current, authorization.inventory);
        blockers.push(...residueBlockers);
        if (residueBlockers.length === 0) {
          await assertLeases();
          removeAuthorizedResidue(cleanupPath, current, attempts);
          if (physicalPresence(cleanupPath, 'Target cleanup crash boundary') === null) {
            // This durable nonterminal generation distinguishes a root-delete
            // crash from an unproven missing tombstone on the next process.
            persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
              authorization, registry.digest, attempts, false, false, null,
              ['cleanup-readback-durable-before-fence-completion']
            ));
          }
          await assertLeases();
        }
      }
    }
    registry = await observeRegistry(repository.root);
    const registryPresent = findTargetRecord(registry.records, authorization.target.path) !== null;
    const physicalPresent = physicalPresence(cleanupPath, 'Final target readback') !== null ||
      (cleanupPath !== authorization.target.path && physicalPresence(authorization.target.path, 'Final original target readback') !== null);
    const inventoryAfter = physicalPresence(cleanupPath, 'Final cleanup inventory readback') !== null
      ? observeWorktreePhysicalInventory(cleanupPath) : null;
    if (registryPresent) blockers.push('registry-reappeared-during-cleanup');
    if (physicalPresent && blockers.length === 0) blockers.push('physical-residue-remains');
    attempts.push({
      operation: 'readback',
      status: !registryPresent && !physicalPresent ? 'success' : 'failed',
      relativePath: null,
      detailDigest: detailDigest({ registryPresent, physicalPresent, inventoryAfter: inventoryAfter?.inventoryDigest ?? null })
    });
    const retirementFenceCanConverge = blockers.length === 0 ||
      (blockers.length === 1 && blockers[0] === 'external-registry-removal-without-retained-admin-effect');
    if (!registryPresent && !physicalPresent && retirementReceipt !== null && retirementFenceCanConverge) {
      // This final proof fence applies equally to the normal path and to the
      // crash-resume shape where the tombstone has already gone away.  Public
      // phase/receipt bytes cannot bypass the retained V3 ledger; leave the
      // writer fence untouched and record a nonterminal result on any drift.
      try {
        assertAuthorizedLeaseNamespaceBinding(authorization, retirementReceipt);
        assertWorkspaceWriteLeaseRetirementProof({
          workspaceRoot: cleanupPath,
          receipt: retirementReceipt,
          proofParent: expectedProofRoot
        });
      } catch (error) {
        return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, false, false, null,
          [`retirement-proof-final-readback-invalid:${detailDigest(error instanceof Error ? error.message : String(error))}`]
        ));
      }
    }
    if (!registryPresent && !physicalPresent && retirementReceipt !== null && retirementFenceCanConverge) {
      // This immutable nonterminal generation closes cleanup itself.  If the
      // process dies before the next completed/fence-completion generations,
      // resume accepts only this exact evidence shape and never reacquires the
      // fenced (now absent) tombstone.
      persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, false, null,
        ['cleanup-readback-durable-before-fence-completion']
      ));
    }
    if (!registryPresent && !physicalPresent && retirementReceipt !== null && retirementFenceCanConverge) {
      // The physical readback is real, but the retirement fence still denies
      // ordinary writers.  This must remain an explicit nonterminal stage;
      // only fence deletion *and a subsequent durable generation* produces
      // `completed`, so neither the fast path nor a token consumer can accept
      // a crash-before-fence-completion state.
      persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, false, null,
        ['retirement-fence-completion-pending']
      ));
      if (!recoveredFenceAbsence) {
        completeWorkspaceWriteLeaseRetirement({
          workspaceRoot: cleanupPath, receipt: retirementReceipt
        });
      }
      attempts.push({
        operation: 'readback', status: 'success', relativePath: null,
        detailDigest: detailDigest(recoveredFenceAbsence
          ? 'retirement-fence-absence-recovered-readback'
          : 'retirement-fence-completion-readback')
      });
      if (blockers.length === 0) {
        const completed = persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, false, false, null, []
        ));
        // This is deliberately after durable final receipt publication.  A
        // crash before it leaves only public evidence and cannot manufacture an
        // opaque branch capability in a later process.
        issueTrustedCompletion(authorization, completed);
        return completed;
      }
    }
    return persistReceiptGeneration(expectedRecoveryRoot, createReceipt(
      authorization, registry.digest, attempts, registryPresent, physicalPresent, inventoryAfter, blockers
    ));
  } catch (error) {
    return postUnregisterObservationFailureReceipt(
      authorization, expectedRecoveryRoot, registry.digest, attempts, 'final-residue-readback', error
    );
  }
}

export async function executeWorktreePhysicalCloseout(
  input: ExecuteWorktreePhysicalCloseoutInput
): Promise<WorktreePhysicalCloseoutReceipt> {
  const repository = await repositoryFacts(input.repositoryRoot);
  return withWorkspaceWriteLease(repository.commonDir, undefined, async (commonLease) => {
    await assertCoordinatedRepository(repository, commonLease);
    return withWorkspaceWriteLease(input.repositoryRoot, undefined, async (rootLease) => {
      const assertLeases = async () => {
        await assertCoordinatedRepository(repository, commonLease);
        await assertWorkspaceWriteLease(input.repositoryRoot, rootLease);
      };
      await assertLeases();
      const receipt = await executeWorktreePhysicalCloseoutUnderLease(input, assertLeases);
      await assertLeases();
      return receipt;
    });
  });
}

/**
 * Rehydrates both files only from the live canonical common-dir operation
 * directory, proves the target is still absent, and accepts only a receipt
 * that contains real unregister and final-readback closure.  This is the
 * branch-owner-facing boundary; it deliberately does not accept raw receipts.
 */
export function assertTrustedCompletedWorktreePhysicalCloseout(input: {
  readonly token: WorktreePhysicalCloseoutConsumptionToken;
  readonly repositoryRoot: string;
  readonly targetPath: string;
  readonly branch: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly recoveryAuthorityDigest: Digest;
}): WorktreePhysicalCloseoutReceipt {
  const issued = trustedConsumptionTokens.get(input.token);
  if (!issued) throw new Error('Worktree closeout consumption token was not issued by this process.');
  if (issued.retirementReceiptDigest === null || issued.phaseDigest === null || issued.adminEffectDigest === null ||
      issued.completedReceiptDigest === null) {
    throw new Error('Worktree closeout consumption token did not witness this process-held retirement, admin effect, and completed receipt issuance.');
  }
  const issuedRepository = issued.authorization.repository;
  if (pathKey(input.repositoryRoot) !== pathKey(issuedRepository.root)) {
    throw new Error('Trusted worktree closeout repository root differs from the issued token.');
  }
  const liveRepositoryRoot = physicalDirectory(input.repositoryRoot, 'Trusted repository root');
  const liveCommonDir = physicalDirectory(issuedRepository.commonDir, 'Trusted Git common-dir');
  const operationRoot = createNoFollowDirectoryChain(liveCommonDir, [
    'sec-worktree-closeout', issued.authorization.operationId.slice('sha256:'.length)
  ]);
  const authorization = loadCanonicalFile(operationRoot, 'authorization.json', (value) =>
    assertWorktreePhysicalCloseoutAuthorization(value as WorktreePhysicalCloseoutAuthorization));
  const receipt = loadLatestReceiptGeneration(operationRoot);
  if (!authorization || !receipt || authorization.authorizationDigest !== issued.authorization.authorizationDigest ||
      JSON.stringify(canonicalJson(authorization)) !== JSON.stringify(canonicalJson(issued.authorization))) {
    throw new Error('Live canonical worktree closeout authorization differs from the issued token.');
  }
  if (
    liveRepositoryRoot.device !== authorization.repository.rootDevice ||
    liveRepositoryRoot.inode !== authorization.repository.rootInode ||
    liveCommonDir.device !== authorization.repository.commonDirDevice ||
    liveCommonDir.inode !== authorization.repository.commonDirInode ||
    pathKey(input.targetPath) !== pathKey(authorization.target.path) ||
    input.branch !== authorization.target.branch || input.headSha !== authorization.target.headSha ||
    input.treeSha !== authorization.target.treeSha ||
    input.recoveryAuthorityDigest !== authorization.target.recoveryAuthorityDigest
  ) throw new Error('Trusted worktree closeout consumer identity differs from live authorization.');
  const registryAdminPath = path.join(
    liveCommonDir.path,
    ...authorization.registryAdmin.relativePath.split('/')
  );
  if (physicalPresence(registryAdminPath, 'Trusted completed registry admin readback') !== null ||
      physicalPresence(authorization.target.path, 'Trusted completed target readback') !== null) {
    throw new Error('Trusted worktree closeout readback is no longer absent.');
  }
  const chain = loadReceiptChain(operationRoot, receipt);
  if (chain.some((generation) => generation.authorizationDigest !== authorization.authorizationDigest ||
    generation.operationId !== authorization.operationId)) {
    throw new Error('Trusted completed worktree receipt chain crosses an authorization boundary.');
  }
  const unregister = chain.some((generation) => generation.attempts.some((attempt) =>
    attempt.operation === 'unregister' && attempt.status === 'success' &&
    attempt.detailDigest === issued.adminEffectDigest
  ));
  const readback = chain.some((generation) => generation.attempts.some((attempt) => attempt.operation === 'readback' && attempt.status === 'success'));
  const phase = loadRetiredWorktreePhase(operationRoot, authorization);
  if (phase === null || readNoFollowOrdinaryFile(
    physicalDirectory(path.dirname(authorization.target.path), 'Trusted retirement fence parent'), phase.retirementReceipt.fenceName
  ) !== null) {
    throw new Error('Trusted completed worktree receipt has not completed retirement fence deletion.');
  }
  if (phase.retirementReceipt.retirementDigest !== issued.retirementReceiptDigest ||
    phase.phaseDigest !== issued.phaseDigest || receipt.receiptDigest !== issued.completedReceiptDigest) {
    throw new Error('Trusted worktree closeout durable evidence differs from this process-issued completion capability.');
  }
  const proofPath = path.join(
    path.dirname(authorization.target.path),
    `sec-worktree-closeout-proof-${authorization.operationId.slice('sha256:'.length)}`
  );
  if (pathKey(proofPath) !== pathKey(authorization.proofRoot.path)) {
    throw new Error('Trusted completed worktree proof root is not canonical.');
  }
  const proofRoot = physicalDirectory(proofPath, 'Trusted completed retained proof root');
  if (proofRoot.device !== authorization.proofRoot.device || proofRoot.inode !== authorization.proofRoot.inode ||
    proofRoot.device !== authorization.targetLeaseNamespace.device) {
    throw new Error('Trusted completed worktree proof root identity changed.');
  }
  assertAuthorizedLeaseNamespaceBinding(authorization, phase.retirementReceipt);
  assertWorkspaceWriteLeaseRetirementProof({
    workspaceRoot: path.join(path.dirname(authorization.target.path), authorization.tombstoneName),
    receipt: phase.retirementReceipt,
    proofParent: proofRoot
  });
  if (receipt.terminal !== 'completed' || receipt.authorizationDigest !== authorization.authorizationDigest ||
      !unregister || !readback) {
    throw new Error('Trusted completed worktree receipt lacks actual unregister/readback closure.');
  }
  return receipt;
}

export interface WorktreePhysicalCloseoutEvidenceGcResult {
  readonly schema: 'sec-worktree-physical-closeout-evidence-gc-v1';
  readonly retiredOperationIds: readonly Digest[];
  readonly ownerRetired: boolean;
  readonly retained: readonly Readonly<{
    operationId: Digest;
    reason: 'branch-live' | 'not-completed' | 'incompatible-active-proof';
    terminal: WorktreePhysicalCloseoutReceipt['terminal'] | 'prepared';
  }>[];
}

interface WorktreePhysicalCloseoutGcAuthorizationBinding {
  readonly operationId: Digest;
  readonly authorizationDigest: Digest;
  readonly target: Readonly<{ path: string; branch: string }>;
  readonly registryAdmin: Readonly<{ relativePath: string }>;
  readonly proofRoot: Readonly<{ path: string }>;
  readonly retentionRootPath: string | null;
  readonly current: WorktreePhysicalCloseoutAuthorization | null;
}

function loadWorktreePhysicalCloseoutGcAuthorization(
  operationRoot: PhysicalDirectoryIdentity
): WorktreePhysicalCloseoutGcAuthorizationBinding {
  const bytes = readNoFollowOrdinaryFile(operationRoot, 'authorization.json');
  if (bytes === null) throw new Error('Worktree closeout GC authorization is absent.');
  const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Worktree closeout GC authorization is not an object.');
  }
  const record = value as Record<string, unknown>;
  const operationId = record.operationId as Digest;
  const authorizationDigest = record.authorizationDigest as Digest;
  if (record.schema !== WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA
      || !/^sha256:[0-9a-f]{64}$/u.test(operationId)
      || !/^sha256:[0-9a-f]{64}$/u.test(authorizationDigest)) {
    throw new Error('Worktree closeout GC authorization identity is invalid.');
  }
  const { authorizationDigest: ignoredAuthorizationDigest, ...withoutDigest } = record;
  void ignoredAuthorizationDigest;
  if (sha256(withoutDigest) !== authorizationDigest) {
    throw new Error('Worktree closeout GC authorization self-digest differs.');
  }
  const target = record.target as Record<string, unknown> | undefined;
  const registryAdmin = record.registryAdmin as Record<string, unknown> | undefined;
  const targetPath = String(target?.path ?? '');
  const targetBranch = String(target?.branch ?? '');
  const registryAdminRelativePath = String(registryAdmin?.relativePath ?? '');
  const proofRoot = record.proofRoot as Record<string, unknown> | undefined;
  const proofPath = String(proofRoot?.path ?? '');
  const generatedStateRetirement = record.generatedStateRetirement as Record<string, unknown> | null | undefined;
  const generatedStateRetentionRoot = generatedStateRetirement?.retentionRoot as Record<string, unknown> | null | undefined;
  const retentionRootPath = generatedStateRetentionRoot === null || generatedStateRetentionRoot === undefined
    ? null
    : String(generatedStateRetentionRoot.path ?? '');
  if (!path.isAbsolute(targetPath) || targetBranch.length === 0
      || !/^worktrees\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(registryAdminRelativePath)
      || !path.isAbsolute(proofPath)
      || (retentionRootPath !== null && !path.isAbsolute(retentionRootPath))
      || path.basename(proofPath) !== `sec-worktree-closeout-proof-${operationId.slice('sha256:'.length)}`) {
    throw new Error('Worktree closeout GC authorization paths are invalid.');
  }
  let current: WorktreePhysicalCloseoutAuthorization | null = null;
  try {
    current = assertWorktreePhysicalCloseoutAuthorization(value as WorktreePhysicalCloseoutAuthorization);
  } catch {
    // Historical completed generations keep their original self-authenticated
    // bytes; GC does not grant them current execution authority.
  }
  return Object.freeze({
    operationId,
    authorizationDigest,
    target: Object.freeze({ path: targetPath, branch: targetBranch }),
    registryAdmin: Object.freeze({ relativePath: registryAdminRelativePath }),
    proofRoot: Object.freeze({ path: proofPath }),
    retentionRootPath,
    current
  });
}

/**
 * Reclaims only terminal worktree-closeout evidence whose target and Git admin
 * objects are absent and whose local branch authority has already disappeared.
 * Residue remains a durable recovery root; unknown or malformed generations
 * fail closed instead of being classified by age or path name.
 */
export async function gcCompletedWorktreePhysicalCloseoutEvidence(
  repositoryRoot: string
): Promise<WorktreePhysicalCloseoutEvidenceGcResult> {
  const preflightRepository = await repositoryFacts(repositoryRoot);
  const preflightOwner = inspectExactNoFollowDirectoryPresence(
    path.join(preflightRepository.commonDir, 'sec-worktree-closeout'),
    'Worktree closeout GC owner preflight'
  );
  if (preflightOwner.state === 'absent') {
    return Object.freeze({
      schema: 'sec-worktree-physical-closeout-evidence-gc-v1' as const,
      retiredOperationIds: Object.freeze([]),
      ownerRetired: false,
      retained: Object.freeze([])
    });
  }
  return withWorkspaceWriteLease(preflightRepository.commonDir, undefined, async (commonLease) => {
    await assertCoordinatedRepository(preflightRepository, commonLease);
    return withWorkspaceWriteLease(repositoryRoot, undefined, async (lease) => {
    const assertGcLeases = async () => {
      await assertCoordinatedRepository(preflightRepository, commonLease);
      await assertWorkspaceWriteLease(repositoryRoot, lease);
    };
    await assertGcLeases();
    const repository = preflightRepository;
    const commonDir = physicalDirectory(repository.commonDir, 'Worktree closeout GC common-dir');
    const ownerPath = path.join(commonDir.path, 'sec-worktree-closeout');
    const ownerPresence = inspectExactNoFollowDirectoryPresence(
      ownerPath,
      'Worktree closeout GC owner'
    );
    if (ownerPresence.state === 'absent') {
      return Object.freeze({
        schema: 'sec-worktree-physical-closeout-evidence-gc-v1' as const,
        retiredOperationIds: Object.freeze([]),
        ownerRetired: true,
        retained: Object.freeze([])
      });
    }
    const owner = ownerPresence.directory.target;
    const children = scanNoFollowDirectoryDirectMetadata(owner, {
      deadlineAtMs: performance.now() + 10_000,
      maximumEntries: 20_000
    });
    const unsafe = children.find(({ kind }) => kind !== 'directory');
    if (unsafe !== undefined) {
      throw new Error(`Worktree closeout GC owner contains a non-directory entry: ${unsafe.relativePath}`);
    }
    const retired: Digest[] = [];
    const retained: Array<WorktreePhysicalCloseoutEvidenceGcResult['retained'][number]> = [];
    for (const child of [...children].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
      await assertGcLeases();
      const operationRoot = physicalDirectory(
        path.join(owner.path, child.relativePath),
        'Worktree closeout GC operation root'
      );
      const authorization = loadWorktreePhysicalCloseoutGcAuthorization(operationRoot);
      if (child.relativePath !== authorization.operationId.slice('sha256:'.length)) {
        throw new Error(`Worktree closeout GC operation is incomplete or misbound: ${child.relativePath}`);
      }
      const receipt = loadLatestReceiptGeneration(operationRoot);
      if (receipt === null) {
        retained.push(Object.freeze({
          operationId: authorization.operationId,
          reason: 'not-completed' as const,
          terminal: 'prepared' as const
        }));
        continue;
      }
      if (receipt.authorizationDigest !== authorization.authorizationDigest) {
        throw new Error(`Worktree closeout GC receipt is misbound: ${child.relativePath}`);
      }
      const chain = loadReceiptChain(operationRoot, receipt);
      if (chain.some((generation) => generation.authorizationDigest !== authorization.authorizationDigest
          || generation.operationId !== authorization.operationId)) {
        throw new Error(`Worktree closeout GC receipt chain crosses authorization: ${authorization.operationId}`);
      }
      if (receipt.terminal !== 'completed') {
        retained.push(Object.freeze({
          operationId: authorization.operationId,
          reason: 'not-completed' as const,
          terminal: receipt.terminal
        }));
        continue;
      }
      const branchObservation = authorization.target.branch.startsWith(DETACHED_BRANCH_PREFIX)
        ? null
        : await runRepositoryGit(repository.root, [
            'show-ref', '--verify', '--quiet', `refs/heads/${authorization.target.branch}`
          ]);
      if (branchObservation !== null
          && branchObservation.status !== 0 && branchObservation.status !== 1) {
        throw new Error(
          `Worktree closeout GC local branch observation failed: ${branchObservation.stderr.toString('utf8').trim()}`
        );
      }
      const branchLive = branchObservation?.status === 0;
      if (branchLive) {
        retained.push(Object.freeze({
          operationId: authorization.operationId,
          reason: 'branch-live' as const,
          terminal: receipt.terminal
        }));
        continue;
      }
      const registryAdminPath = path.join(
        commonDir.path,
        ...authorization.registryAdmin.relativePath.split('/')
      );
      if (physicalPresence(authorization.target.path, 'Worktree closeout GC target readback') !== null
          || physicalPresence(registryAdminPath, 'Worktree closeout GC admin readback') !== null) {
        throw new Error(`Completed worktree closeout regained physical state: ${authorization.operationId}`);
      }
      const unregister = chain.some((generation) => generation.attempts.some((attempt) => (
        attempt.operation === 'unregister' && attempt.status === 'success'
      )));
      const readback = chain.some((generation) => generation.attempts.some((attempt) => (
        attempt.operation === 'readback' && attempt.status === 'success'
      )));
      if (!unregister || !readback) {
        throw new Error(`Completed worktree closeout lacks unregister/readback evidence: ${authorization.operationId}`);
      }
      const retiredIntent = authorization.current === null
        ? null
        : loadRetiredWorktreeIntent(operationRoot, authorization.current);
      const retiredPhase = authorization.current === null
        ? null
        : loadRetiredWorktreePhase(operationRoot, authorization.current);
      const allowedOperationFiles = new Set<string>([
        'authorization.json',
        'receipt-latest.json',
        ...chain.map(receiptGenerationName),
        ...(retiredIntent === null ? [] : [retirementIntentName(retiredIntent)]),
        ...(retiredPhase === null ? [] : [retiredPhaseName(retiredPhase)])
      ]);
      const operationInventory = scanNoFollowDirectoryTreeMetadata(operationRoot, {
        deadlineAtMs: performance.now() + 10_000,
        maximumEntries: 20_000
      });
      const unknownOperationEvidence = operationInventory.find((entry) => (
        entry.kind !== 'file' || !allowedOperationFiles.has(entry.relativePath)
      ));
      if (unknownOperationEvidence !== undefined) {
        throw new Error(
          `Worktree closeout GC found unvalidated operation evidence: ${unknownOperationEvidence.relativePath}`
        );
      }
      const retentionPresence = authorization.retentionRootPath === null
        ? null
        : inspectExactNoFollowDirectoryPresence(
            authorization.retentionRootPath,
            'Worktree closeout GC generated-state retention root'
          );
      if (retentionPresence?.state === 'present' && authorization.current === null) {
        retained.push(Object.freeze({
          operationId: authorization.operationId,
          reason: 'incompatible-active-proof' as const,
          terminal: receipt.terminal
        }));
        continue;
      }
      const proofPresence = inspectExactNoFollowDirectoryPresence(
        authorization.proofRoot.path,
        'Worktree closeout GC proof root'
      );
      let prooflessAuthorization: WorktreePhysicalCloseoutAuthorization | null = null;
      if (proofPresence.state === 'present') {
        if (authorization.current === null) {
          retained.push(Object.freeze({
            operationId: authorization.operationId,
            reason: 'incompatible-active-proof' as const,
            terminal: receipt.terminal
          }));
          continue;
        }
        const currentAuthorization = authorization.current;
        const proofRoot = proofPresence.directory.target;
        if (proofRoot.device !== currentAuthorization.proofRoot.device
            || proofRoot.inode !== currentAuthorization.proofRoot.inode) {
          throw new Error(`Worktree closeout GC proof identity changed: ${authorization.operationId}`);
        }
        if (retiredPhase === null || readNoFollowOrdinaryFile(
          physicalDirectory(path.dirname(currentAuthorization.target.path), 'Worktree closeout GC fence parent'),
          retiredPhase.retirementReceipt.fenceName
        ) !== null) {
          throw new Error(`Worktree closeout GC retirement phase is incomplete: ${authorization.operationId}`);
        }
        assertAuthorizedLeaseNamespaceBinding(currentAuthorization, retiredPhase.retirementReceipt);
        assertWorkspaceWriteLeaseRetirementProof({
          workspaceRoot: path.join(path.dirname(currentAuthorization.target.path), currentAuthorization.tombstoneName),
          receipt: retiredPhase.retirementReceipt,
          proofParent: proofRoot
        });
        await assertGcLeases();
        retireNoFollowDirectoryTree({
          deadlineAtMonotonicMs: performance.now() + 10_000,
          inventory: scanNoFollowDirectoryTreeMetadata(proofRoot, {
            deadlineAtMs: performance.now() + 10_000,
            maximumEntries: 20_000
          }),
          parent: physicalDirectory(path.dirname(proofRoot.path), 'Worktree closeout GC proof parent'),
          root: proofRoot
        });
      } else {
        if (authorization.current === null || retiredPhase === null) {
          throw new Error(`Proofless worktree closeout lacks current authorization or retirement phase: ${authorization.operationId}`);
        }
        const currentAuthorization = authorization.current;
        assertAuthorizedLeaseNamespaceBinding(currentAuthorization, retiredPhase.retirementReceipt);
        prooflessAuthorization = currentAuthorization;
        await observeProoflessWorktreeCloseoutConvergence({
          repositoryRoot: repository.root,
          commonDir: repository.commonDir,
          authorization: currentAuthorization,
          retiredPhase,
          stage: 'gc-initial'
        });
      }
      const generatedStateRetirement = authorization.current?.generatedStateRetirement ?? null;
      if (generatedStateRetirement?.retentionRoot !== null && generatedStateRetirement !== null) {
        if (retentionPresence?.state === 'present') {
          assertGeneratedStateWorktreeRetirementEffectStart({
            receipt: generatedStateRetirement,
            repositoryRoot: authorization.current!.repository.root,
            workspaceRoot: authorization.current!.target.path,
            expectedBranch: authorization.current!.target.branch,
            expectedHeadSha: authorization.current!.target.headSha,
            expectedTreeSha: authorization.current!.target.treeSha
          });
          const retentionRoot = retentionPresence.directory.target;
          await assertGcLeases();
          retireNoFollowDirectoryTree({
            deadlineAtMonotonicMs: performance.now() + 10_000,
            inventory: scanNoFollowDirectoryTreeMetadata(retentionRoot, {
              deadlineAtMs: performance.now() + 10_000,
              maximumEntries: 20_000
            }),
            parent: physicalDirectory(path.dirname(retentionRoot.path), 'Worktree closeout GC retention parent'),
            root: retentionRoot
          });
        }
      } else if (generatedStateRetirement !== null) {
        assertGeneratedStateWorktreeRetirementEffectStart({
          receipt: generatedStateRetirement,
          repositoryRoot: authorization.current!.repository.root,
          workspaceRoot: authorization.current!.target.path,
          expectedBranch: authorization.current!.target.branch,
          expectedHeadSha: authorization.current!.target.headSha,
          expectedTreeSha: authorization.current!.target.treeSha
        });
      }
      if (prooflessAuthorization !== null) {
        await assertGcLeases();
        const branchObservation = prooflessAuthorization.target.branch.startsWith(DETACHED_BRANCH_PREFIX)
          ? null
          : await runRepositoryGit(repository.root, [
              'show-ref', '--verify', '--quiet', `refs/heads/${prooflessAuthorization.target.branch}`
            ]);
        if (branchObservation !== null
            && branchObservation.status !== 0 && branchObservation.status !== 1) {
          throw new Error(
            `Proofless worktree closeout branch observation failed at gc-effect-boundary: ${branchObservation.stderr.toString('utf8').trim()}`
          );
        }
        if (branchObservation?.status === 0) {
          throw new Error(`Proofless worktree closeout has not converged at gc-effect-boundary: branch-present`);
        }
        await observeProoflessWorktreeCloseoutConvergence({
          repositoryRoot: repository.root,
          commonDir: repository.commonDir,
          authorization: prooflessAuthorization,
          retiredPhase: retiredPhase!,
          stage: 'gc-effect-boundary'
        });
        await assertGcLeases();
      }
      await assertGcLeases();
      retireNoFollowDirectoryTree({
        deadlineAtMonotonicMs: performance.now() + 10_000,
        inventory: operationInventory,
        parent: owner,
        root: operationRoot
      });
      trustedTokensByAuthorization.delete(authorization.authorizationDigest);
      retired.push(authorization.operationId);
    }
    await assertGcLeases();
    const ownerRetired = scanNoFollowDirectoryDirectMetadata(owner, {
      deadlineAtMs: performance.now() + 10_000,
      maximumEntries: 20_000
    }).length === 0;
    if (ownerRetired) {
      await assertGcLeases();
      deleteRetainedNoFollowEntry({
        root: commonDir,
        relativePath: 'sec-worktree-closeout',
        kind: 'directory',
        device: owner.device,
        inode: owner.inode,
        ancestorDirectories: []
      });
      if (inspectExactNoFollowDirectoryPresence(
        owner.path,
        'Worktree closeout GC empty owner readback'
      ).state !== 'absent') {
        throw new Error('Worktree closeout GC empty owner remains after retirement.');
      }
    }
    return Object.freeze({
      schema: 'sec-worktree-physical-closeout-evidence-gc-v1' as const,
      retiredOperationIds: Object.freeze(retired),
      ownerRetired,
      retained: Object.freeze(retained)
    });
    });
  });
}

function option(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined || args[index + 1]!.startsWith('--')) {
    throw new Error(`${name} is required.`);
  }
  if (args.indexOf(name, index + 1) >= 0) throw new Error(`${name} must appear once.`);
  return args[index + 1]!;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const usage =
    'Usage:\n' +
    '  bun src/adapters/self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts prepare --repository-root <path> --target <path> --expected-branch <name> --expected-head <sha> --expected-tree <sha> --expected-recovery-authority <digest>\n' +
    '  bun src/adapters/self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts execute --repository-root <path> --target <path> --expected-branch <name> --expected-head <sha> --expected-tree <sha> --expected-recovery-authority <digest> --authorization <path>';
  if (command !== 'prepare' && command !== 'execute') throw new Error(usage);
  const allowed = new Set([
    '--repository-root',
    '--target',
    '--expected-branch',
    '--expected-head',
    '--expected-tree',
    '--expected-recovery-authority',
    ...(command === 'execute' ? ['--authorization'] : [])
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || !allowed.has(name) || value === undefined || value.startsWith('--')) {
      throw new Error(usage);
    }
  }
  const input: PrepareWorktreePhysicalCloseoutInput = {
    repositoryRoot: option(args, '--repository-root'),
    targetPath: option(args, '--target'),
    expectedBranch: option(args, '--expected-branch'),
    expectedHeadSha: option(args, '--expected-head'),
    expectedTreeSha: option(args, '--expected-tree'),
    expectedRecoveryAuthorityDigest: option(args, '--expected-recovery-authority') as Digest
  };
  const result =
    command === 'prepare'
      ? await prepareWorktreePhysicalCloseout(input)
      : await executeWorktreePhysicalCloseout({ ...input, authorizationPath: option(args, '--authorization') });
  process.stdout.write(`${JSON.stringify(canonicalJson(result), null, 2)}\n`);
  if ('terminal' in result && result.terminal !== 'completed') process.exitCode = 2;
}

if (import.meta.main) await main();
