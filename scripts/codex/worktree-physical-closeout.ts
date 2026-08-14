#!/usr/bin/env bun

import path from 'node:path';

import { canonicalJson, sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  createNoFollowDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  relocateRetainedNoFollowDirectoryAcrossParentsV1,
  relocateRetainedNoFollowDirectoryV1,
  replaceDurableCanonicalFileV1,
  scanNoFollowDirectoryTreeV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import { runCommandBytes } from '../../platform/shared/process.ts';
import {
  acquireWorkspaceWriteLease,
  assertWorkspaceWriteLease,
  assertWorkspaceWriteLeaseRetirementProofV1,
  assertWorkspaceWriteLeaseRetirementV1,
  completeWorkspaceWriteLeaseRetirementV1,
  recoverWorkspaceWriteLeaseRetirementV1,
  resumeWorkspaceWriteLeaseRetirementV1,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseRetirementReceipt
} from '../../platform/shared/workspace-write-lease.ts';
import { createBranchLifecycleGitChildEnvironmentV1 } from './branch-lifecycle-command.ts';
import {
  assertWorktreePhysicalCloseoutAuthorizationV1,
  assertWorktreePhysicalCloseoutReceiptV1,
  classifyAuthorizedWorktreeResidueV1,
  createWorktreePhysicalCloseoutAuthorizationV1,
  createWorktreePhysicalCloseoutReceiptV1,
  createWorktreePhysicalInventoryV1,
  detailDigestV1,
  parseWorktreePorcelainZV1,
  type Digest,
  type WorktreePhysicalCloseoutAttemptV1,
  type WorktreePhysicalCloseoutAuthorizationV1,
  type WorktreePhysicalCloseoutReceiptV1,
  type WorktreePhysicalEntryV1,
  type WorktreePhysicalInventoryV1,
  type WorktreePorcelainRecordV1
} from './worktree-physical-closeout-contract.ts';

const MAX_BUFFER = 64 * 1024 * 1024;
const MAX_CLEANUP_ATTEMPTS = 4;
const BACKOFF_MILLISECONDS = [0, 15, 40, 100] as const;

interface CommandResult {
  readonly status: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export interface PrepareWorktreePhysicalCloseoutInputV1 {
  readonly repositoryRoot: string;
  readonly targetPath: string;
  readonly expectedBranch: string;
  readonly expectedHeadSha: string;
  readonly expectedTreeSha: string;
  readonly expectedRecoveryAuthorityDigest: Digest;
}

export interface ExecuteWorktreePhysicalCloseoutInputV1 extends PrepareWorktreePhysicalCloseoutInputV1 {
  readonly authorizationPath: string;
}

/** A detached scratch worktree has no branch/ref authority and never mints a branch token. */
export interface PrepareDetachedScratchWorktreePhysicalCloseoutInputV1 {
  readonly repositoryRoot: string;
  readonly targetPath: string;
  readonly expectedHeadSha: string;
  readonly expectedTreeSha: string;
  readonly expectedRecoveryAuthorityDigest: Digest;
}
export interface ExecuteDetachedScratchWorktreePhysicalCloseoutInputV1 extends PrepareDetachedScratchWorktreePhysicalCloseoutInputV1 {
  readonly authorizationPath: string;
}
const DETACHED_BRANCH_PREFIX = 'detached-scratch-';
function detachedMarker(headSha: string): string { return `${DETACHED_BRANCH_PREFIX}${headSha}`; }

/** Opaque same-process capability; raw JSON can never mint this token. */
export class WorktreePhysicalCloseoutConsumptionTokenV1 {
  readonly #brand = 'sec-worktree-physical-closeout-consumption-token-v1';
}

interface TrustedConsumptionIssuanceV1 {
  readonly authorization: WorktreePhysicalCloseoutAuthorizationV1;
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
  WorktreePhysicalCloseoutConsumptionTokenV1,
  TrustedConsumptionIssuanceV1
>();
const trustedTokensByAuthorization = new Map<string, Set<WorktreePhysicalCloseoutConsumptionTokenV1>>();

function issueTrustedRetirementV1(
  authorization: WorktreePhysicalCloseoutAuthorizationV1,
  receipt: WorkspaceWriteLeaseRetirementReceipt,
  phase: RetiredWorktreePhaseV1
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

function issueTrustedAdminEffectV1(
  authorization: WorktreePhysicalCloseoutAuthorizationV1,
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

function issueTrustedCompletionV1(
  authorization: WorktreePhysicalCloseoutAuthorizationV1,
  receipt: WorktreePhysicalCloseoutReceiptV1
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

export interface PreparedWorktreePhysicalCloseoutV1 {
  readonly authorization: WorktreePhysicalCloseoutAuthorizationV1;
  readonly token: WorktreePhysicalCloseoutConsumptionTokenV1;
}

async function runRepositoryGit(repositoryRoot: string, args: readonly string[]): Promise<CommandResult> {
  const result = await runCommandBytes('git', ['-C', repositoryRoot, ...args], {
    cwd: repositoryRoot,
    env: createBranchLifecycleGitChildEnvironmentV1(process.env),
    envMode: 'replace',
    maxStderrBytes: MAX_BUFFER,
    maxStdoutBytes: MAX_BUFFER
  });
  return {
    status: result.code,
    stdout: Buffer.from(result.stdout),
    stderr: Buffer.from(result.stderr, 'utf8')
  };
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

function physicalDirectory(pathInput: string, label: string): PhysicalDirectoryIdentityV1 {
  return inspectNoFollowDirectoryChainV1(normalizedAbsolute(pathInput), label).target;
}

function physicalPresence(pathInput: string, label: string): PhysicalDirectoryIdentityV1 | null {
  const presence = inspectExactNoFollowDirectoryPresenceV1(normalizedAbsolute(pathInput), label);
  return presence.state === 'present' ? presence.directory.target : null;
}

function assertAuthorizedLeaseNamespaceBinding(
  authorization: WorktreePhysicalCloseoutAuthorizationV1,
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

async function observeRegistry(repositoryRoot: string): Promise<{
  bytes: Buffer;
  records: WorktreePorcelainRecordV1[];
  digest: Digest;
}> {
  const bytes = await requireRepositoryGit(repositoryRoot, ['worktree', 'list', '--porcelain', '-z'], 'Observe Git worktree registry');
  const records = parseWorktreePorcelainZV1(bytes);
  return { bytes, records, digest: sha256(records) as Digest };
}

function findTargetRecord(records: readonly WorktreePorcelainRecordV1[], targetPath: string): WorktreePorcelainRecordV1 | null {
  const matches = records.filter((record) => pathKey(record.path) === pathKey(targetPath));
  if (matches.length > 1) throw new Error('Target appears more than once in the Git worktree registry.');
  return matches[0] ?? null;
}

export function observeWorktreePhysicalInventoryV1(targetPathInput: string): WorktreePhysicalInventoryV1 {
  const target = physicalDirectory(targetPathInput, 'Target worktree root');
  return observeDirectoryPhysicalInventoryV1(target);
}

function observeDirectoryPhysicalInventoryV1(target: PhysicalDirectoryIdentityV1): WorktreePhysicalInventoryV1 {
  const entries: WorktreePhysicalEntryV1[] = scanNoFollowDirectoryTreeV1(target).map((entry) => ({
    relativePath: entry.relativePath,
    kind: entry.kind === 'link' ? 'symlink' : entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    contentDigest: entry.bytes === null ? null : detailDigestV1({ bytes: Buffer.from(entry.bytes).toString('hex') }),
    linkTarget: entry.linkTarget
  }));
  return createWorktreePhysicalInventoryV1(entries);
}

function registryAdminForTargetV1(
  target: PhysicalDirectoryIdentityV1,
  commonDir: string
): Readonly<{ relativePath: string; tombstoneName: string; device: string; inode: string; inventory: WorktreePhysicalInventoryV1 }> {
  const gitFile = readNoFollowOrdinaryFileV1(target, '.git');
  if (gitFile === null) throw new Error('Registered target .git locator is absent.');
  const text = decodeUtf8(gitFile);
  const match = /^gitdir: ([^\r\n]+)\r?\n?$/u.exec(text);
  if (!match) throw new Error('Registered target .git locator is malformed.');
  const adminPath = normalizedAbsolute(path.resolve(target.path, match[1]!));
  const relativePath = path.relative(commonDir, adminPath).replaceAll('\\', '/');
  if (!/^worktrees\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(relativePath)) {
    throw new Error('Registered target Git admin directory is outside canonical common-dir worktrees.');
  }
  const admin = physicalDirectory(adminPath, 'Registered target Git admin directory');
  return Object.freeze({ relativePath, tombstoneName: 'worktree-admin-closeout-0000000000000000000000000000000000000000000000000000000000000000', device: admin.device, inode: admin.inode, inventory: observeDirectoryPhysicalInventoryV1(admin) });
}

async function observeWorkingState(
  repositoryRoot: string,
  targetPath: string,
  leaseOwnedRelativePath: string | null = null
): Promise<{ digest: Digest; blocker: string | null }> {
  const status = await runRepositoryGit(
    repositoryRoot,
    ['-C', targetPath, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'],
  );
  if (status.status !== 0) {
    return {
      digest: detailDigestV1({ status: status.status, stderr: status.stderr.toString('utf8') }),
      blocker: 'working-state-unresolved'
    };
  }
  const records = status.stdout.toString('utf8').split('\0').filter(Boolean);
  // A held target lease creates exactly this untracked control subtree.  Do
  // not observe it before acquisition (that has a write-race); instead remove
  // only this exact own namespace from the lease-held cleanliness snapshot.
  // Every other status record, including `.sec` siblings, remains a blocker.
  const retained = records.filter((entry) => {
    if (leaseOwnedRelativePath === null) return true;
    const candidate = entry.startsWith('?? ') || entry.startsWith('!! ')
      ? entry.slice(3).replaceAll('\\', '/').replace(/\/+$/u, '')
      : null;
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
      const ancestor = inspectNoFollowDirectoryChainV1(
        path.join(targetPath, ...candidate.split('/')),
        'Lease-owned collapsed ignored ancestor'
      ).target;
      const ownedSuffix = leaseOwnedRelativePath.slice(candidate.length + 1);
      const entries = scanNoFollowDirectoryTreeV1(ancestor);
      return !entries.some((observed) => (
        observed.relativePath === ownedSuffix
        || observed.relativePath.startsWith(`${ownedSuffix}/`)
      )) || entries.some((observed) => (
        observed.relativePath !== ownedSuffix
        && !observed.relativePath.startsWith(`${ownedSuffix}/`)
      ));
    } catch {
      return true;
    }
  });
  const digest = detailDigestV1({ records: retained });
  if (retained.length === 0) return { digest, blocker: null };
  let tracked = 0;
  let untracked = 0;
  let ignored = 0;
  let unknown = 0;
  for (const entry of retained) {
    if (entry.startsWith('?? ')) untracked += 1;
    else if (entry.startsWith('!! ')) ignored += 1;
    else if (entry.length >= 3 && entry[2] === ' ') tracked += 1;
    else unknown += 1;
  }
  return {
    digest,
    blocker: `working-state-not-clean:tracked=${tracked},untracked=${untracked},ignored=${ignored},unknown=${unknown}`
  };
}

function withoutLeaseOwnedNamespace(inventory: WorktreePhysicalInventoryV1): WorktreePhysicalInventoryV1 {
  const namespace = '.sec/workspace-write-lease';
  return createWorktreePhysicalInventoryV1(inventory.entries.filter((entry) =>
    entry.relativePath !== namespace && !entry.relativePath.startsWith(`${namespace}/`)
  ));
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(canonicalJson(value), null, 2)}\n`, 'utf8');
}

function persistCanonical(parent: PhysicalDirectoryIdentityV1, name: string, value: unknown): void {
  const bytes = canonicalBytes(value);
  publishExclusiveDurableCanonicalFileV1({
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

interface ReceiptLatestPointerV1 {
  readonly schema: 'sec-worktree-cleanup-receipt-latest-v1';
  readonly generation: string;
  readonly receiptDigest: Digest;
}

interface RetiredWorktreePhaseV1 {
  readonly schema: 'sec-worktree-closeout-retired-phase-v1';
  readonly authorizationDigest: Digest;
  readonly tombstoneName: string;
  readonly retirementReceipt: WorkspaceWriteLeaseRetirementReceipt;
  readonly phaseDigest: Digest;
}

interface RetiredWorktreeIntentV1 {
  readonly schema: 'sec-worktree-closeout-retirement-intent-v1';
  readonly authorizationDigest: Digest;
  readonly tombstoneName: string;
  readonly targetDevice: string;
  readonly targetInode: string;
  readonly intentDigest: Digest;
}

function hasExactObjectKeysV1(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const normalized = [...expected].sort();
  return actual.length === normalized.length && actual.every((key, index) => key === normalized[index]);
}

function createRetiredWorktreeIntentV1(input: Omit<RetiredWorktreeIntentV1, 'schema' | 'intentDigest'>): RetiredWorktreeIntentV1 {
  const material = { schema: 'sec-worktree-closeout-retirement-intent-v1' as const, ...input };
  return Object.freeze({ ...material, intentDigest: sha256(material) as Digest });
}

function retirementIntentName(intent: RetiredWorktreeIntentV1): string {
  return `retirement-intent-${intent.intentDigest.slice('sha256:'.length)}.json`;
}

function persistRetiredWorktreeIntentV1(root: PhysicalDirectoryIdentityV1, intent: RetiredWorktreeIntentV1): void {
  persistCanonical(root, retirementIntentName(intent), intent);
}

function loadRetiredWorktreeIntentV1(root: PhysicalDirectoryIdentityV1, authorization: WorktreePhysicalCloseoutAuthorizationV1): RetiredWorktreeIntentV1 | null {
  const candidates = scanNoFollowDirectoryTreeV1(root).filter((entry) => /^retirement-intent-[0-9a-f]{64}\.json$/u.test(entry.relativePath));
  if (candidates.length === 0) return null;
  if (candidates.length !== 1 || candidates[0]!.kind !== 'file') throw new Error('Retirement intent generation is ambiguous or unsafe.');
  const candidate = candidates[0]!;
  const intent = loadCanonicalFile(root, candidate.relativePath, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !hasExactObjectKeysV1(value, [
      'schema', 'authorizationDigest', 'tombstoneName', 'targetDevice', 'targetInode', 'intentDigest'
    ])) throw new Error('Retirement intent is malformed.');
    const parsed = value as RetiredWorktreeIntentV1;
    const { schema: _schema, intentDigest: _intentDigest, ...material } = parsed;
    const rebuilt = createRetiredWorktreeIntentV1(material);
    if (parsed.schema !== rebuilt.schema || parsed.intentDigest !== rebuilt.intentDigest || retirementIntentName(rebuilt) !== candidate.relativePath) throw new Error('Retirement intent digest is invalid.');
    return rebuilt;
  });
  if (!intent || intent.authorizationDigest !== authorization.authorizationDigest || intent.tombstoneName !== authorization.tombstoneName ||
    intent.targetDevice !== authorization.target.device || intent.targetInode !== authorization.target.inode) {
    throw new Error('Retirement intent does not bind this authorization.');
  }
  return intent;
}

function createRetiredWorktreePhaseV1(input: Omit<RetiredWorktreePhaseV1, 'schema' | 'phaseDigest'>): RetiredWorktreePhaseV1 {
  const material = { schema: 'sec-worktree-closeout-retired-phase-v1' as const, ...input };
  return Object.freeze({ ...material, phaseDigest: sha256(material) as Digest });
}

function retiredPhaseName(phase: RetiredWorktreePhaseV1): string {
  return `retired-phase-${phase.phaseDigest.slice('sha256:'.length)}.json`;
}

function persistRetiredWorktreePhaseV1(root: PhysicalDirectoryIdentityV1, phase: RetiredWorktreePhaseV1): void {
  persistCanonical(root, retiredPhaseName(phase), phase);
}

function loadRetiredWorktreePhaseV1(root: PhysicalDirectoryIdentityV1, authorization: WorktreePhysicalCloseoutAuthorizationV1): RetiredWorktreePhaseV1 | null {
  const candidates = scanNoFollowDirectoryTreeV1(root).filter((entry) => /^retired-phase-[0-9a-f]{64}\.json$/u.test(entry.relativePath));
  if (candidates.length === 0) return null;
  if (candidates.length !== 1 || candidates[0]!.kind !== 'file') throw new Error('Retired closeout phase generation is ambiguous or unsafe.');
  const candidate = candidates[0]!;
  const phase = loadCanonicalFile(root, candidate.relativePath, (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !hasExactObjectKeysV1(value, [
      'schema', 'authorizationDigest', 'tombstoneName', 'retirementReceipt', 'phaseDigest'
    ])) throw new Error('Retired closeout phase is malformed.');
    const parsed = value as RetiredWorktreePhaseV1;
    const { schema: _schema, phaseDigest: _phaseDigest, ...material } = parsed;
    const rebuilt = createRetiredWorktreePhaseV1(material);
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

function receiptGenerationName(receipt: WorktreePhysicalCloseoutReceiptV1): string {
  return `receipt-${receipt.receiptDigest.slice('sha256:'.length)}.json`;
}

function parseReceiptLatestPointerV1(value: unknown): ReceiptLatestPointerV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Receipt latest pointer is invalid.');
  const candidate = value as Partial<ReceiptLatestPointerV1>;
  if (candidate.schema !== 'sec-worktree-cleanup-receipt-latest-v1' ||
      typeof candidate.generation !== 'string' || !/^receipt-[0-9a-f]{64}\.json$/u.test(candidate.generation) ||
      typeof candidate.receiptDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(candidate.receiptDigest)) {
    throw new Error('Receipt latest pointer is malformed.');
  }
  return Object.freeze({ schema: candidate.schema, generation: candidate.generation, receiptDigest: candidate.receiptDigest as Digest });
}

/** Immutable receipt evidence followed by one durable latest-generation pointer. */
function persistReceiptGenerationV1(root: PhysicalDirectoryIdentityV1, receipt: WorktreePhysicalCloseoutReceiptV1): WorktreePhysicalCloseoutReceiptV1 {
  const predecessor = loadLatestReceiptGenerationV1(root);
  const chained = receipt.previousReceiptDigest === null && predecessor !== null
    ? (() => {
      const { schema: _schema, receiptDigest: _receiptDigest, ...material } = receipt;
      return createWorktreePhysicalCloseoutReceiptV1({ ...material, previousReceiptDigest: predecessor.receiptDigest });
    })()
    : receipt;
  const generation = receiptGenerationName(chained);
  persistCanonical(root, generation, chained);
  const pointer: ReceiptLatestPointerV1 = {
    schema: 'sec-worktree-cleanup-receipt-latest-v1', generation, receiptDigest: chained.receiptDigest
  };
  const bytes = canonicalBytes(pointer);
  replaceDurableCanonicalFileV1({
    parent: root,
    name: 'receipt-latest.json',
    bytes,
    validate: (current) => {
      const parsed = parseReceiptLatestPointerV1(JSON.parse(Buffer.from(current).toString('utf8')));
      if (JSON.stringify(canonicalJson(parsed)) !== JSON.stringify(canonicalJson(pointer))) {
        throw new Error('Receipt latest pointer differs from canonical generation.');
      }
    }
  });
  return chained;
}

function loadLatestReceiptGenerationV1(root: PhysicalDirectoryIdentityV1): WorktreePhysicalCloseoutReceiptV1 | null {
  const pointer = loadCanonicalFile(root, 'receipt-latest.json', parseReceiptLatestPointerV1);
  if (pointer === null) return null;
  const receipt = loadCanonicalFile(root, pointer.generation, (value) =>
    assertWorktreePhysicalCloseoutReceiptV1(value as WorktreePhysicalCloseoutReceiptV1));
  if (receipt === null || receipt.receiptDigest !== pointer.receiptDigest || receiptGenerationName(receipt) !== pointer.generation) {
    throw new Error('Receipt latest pointer does not reference its immutable canonical generation.');
  }
  return receipt;
}

function loadReceiptChainV1(
  root: PhysicalDirectoryIdentityV1,
  latest: WorktreePhysicalCloseoutReceiptV1
): readonly WorktreePhysicalCloseoutReceiptV1[] {
  const chain: WorktreePhysicalCloseoutReceiptV1[] = [];
  const seen = new Set<Digest>();
  let current: WorktreePhysicalCloseoutReceiptV1 | null = latest;
  while (current !== null) {
    if (seen.has(current.receiptDigest)) throw new Error('Receipt generation chain contains a cycle.');
    seen.add(current.receiptDigest);
    chain.push(current);
    if (current.previousReceiptDigest === null) break;
    current = loadCanonicalFile(root, `receipt-${current.previousReceiptDigest.slice('sha256:'.length)}.json`, (value) =>
      assertWorktreePhysicalCloseoutReceiptV1(value as WorktreePhysicalCloseoutReceiptV1));
    if (current === null || current.receiptDigest !== chain[chain.length - 1]!.previousReceiptDigest) {
      throw new Error('Receipt generation chain predecessor is absent or differs from its digest binding.');
    }
  }
  return Object.freeze(chain);
}

function loadCanonicalFile<T>(parent: PhysicalDirectoryIdentityV1, name: string, parse: (value: unknown) => T): T | null {
  const bytes = readNoFollowOrdinaryFileV1(parent, name);
  return bytes === null ? null : parse(JSON.parse(Buffer.from(bytes).toString('utf8')));
}

function loadAuthorizedForExecutionV1(authorizationPath: string): WorktreePhysicalCloseoutAuthorizationV1 {
  const locator = normalizedAbsolute(authorizationPath);
  const parent = physicalDirectory(path.dirname(locator), 'Execution authorization locator parent');
  const authorization = loadCanonicalFile(parent, path.basename(locator), (value) =>
    assertWorktreePhysicalCloseoutAuthorizationV1(value as WorktreePhysicalCloseoutAuthorizationV1));
  if (authorization === null) throw new Error('Execution authorization is absent.');
  return authorization;
}

function validateExpectedRecord(
  record: WorktreePorcelainRecordV1,
  input: PrepareWorktreePhysicalCloseoutInputV1,
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

export async function prepareWorktreePhysicalCloseoutV1(input: PrepareWorktreePhysicalCloseoutInputV1): Promise<WorktreePhysicalCloseoutAuthorizationV1> {
  const repository = await repositoryFacts(input.repositoryRoot);
  const repositoryLease = await acquireWorkspaceWriteLease(repository.root);
  try {
    const targetLease = await acquireWorkspaceWriteLease(input.targetPath);
    try {
      await repositoryLease.assertOwned();
      await targetLease.assertOwned();
      const ownedNamespace = await targetLease.ownedNamespace();
      const leaseHeldWorking = await observeWorkingState(repository.root, input.targetPath, ownedNamespace.relativePath);
      return await prepareWorktreePhysicalCloseoutUnderLeaseV1(input, repository, targetLease, leaseHeldWorking);
    } finally {
      await targetLease.release();
    }
  } finally {
    await repositoryLease.release();
  }
}

async function prepareWorktreePhysicalCloseoutUnderLeaseV1(
  input: PrepareWorktreePhysicalCloseoutInputV1,
  repository: Awaited<ReturnType<typeof repositoryFacts>>,
  targetLease: Awaited<ReturnType<typeof acquireWorkspaceWriteLease>>,
  working: Awaited<ReturnType<typeof observeWorkingState>>
): Promise<WorktreePhysicalCloseoutAuthorizationV1> {
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
  const rawInventory = observeWorktreePhysicalInventoryV1(targetPath);
  const inventory = withoutLeaseOwnedNamespace(rawInventory);
  const workingReadback = await observeWorkingState(
    repository.root,
    targetPath,
    ownedNamespace.relativePath
  );
  if (workingReadback.blocker !== null || workingReadback.digest !== working.digest) {
    blockers.push(workingReadback.blocker ?? 'working-state-changed-during-authorization');
  }
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
  const registryAdminPreliminary = registryAdminForTargetV1(targetIdentity, repository.commonDir);
  const provisional = createWorktreePhysicalCloseoutAuthorizationV1({
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
    inventory,
    tombstoneName: 'worktree-closeout-tombstone-0000000000000000000000000000000000000000000000000000000000000000',
    authorizationPath: '<pending>',
    receiptPath: '<pending>'
  });
  const commonDir = physicalDirectory(repository.commonDir, 'Git common-dir');
  const recoveryRoot = createNoFollowDirectoryChainV1(commonDir, [
    'sec-worktree-closeout',
    provisional.operationId.slice('sha256:'.length)
  ]);
  const targetParent = physicalDirectory(path.dirname(targetPath), 'Target worktree parent for retained proof');
  const proofRoot = createNoFollowDirectoryChainV1(targetParent, [
    `sec-worktree-closeout-proof-${provisional.operationId.slice('sha256:'.length)}`
  ]);
  if (proofRoot.device !== targetLeaseNamespace.device) {
    throw new Error('Target-external retained proof root is not on the target lease namespace volume.');
  }
  if (scanNoFollowDirectoryTreeV1(proofRoot).length !== 0) {
    throw new Error('Target-external retained proof root already contains unknown operation content.');
  }
  const registryAdmin = Object.freeze({ ...registryAdminPreliminary, tombstoneName: `worktree-admin-closeout-${provisional.operationId.slice('sha256:'.length)}` });
  const authorization = createWorktreePhysicalCloseoutAuthorizationV1({
    repository: repositoryBinding,
    target,
    registryAdmin,
    targetLeaseNamespace: { device: targetLeaseNamespace.device, inode: targetLeaseNamespace.inode },
    proofRoot: { path: proofRoot.path, device: proofRoot.device, inode: proofRoot.inode },
    registryBeforeDigest: registry.digest,
    workingStateDigest: working.digest,
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
    observeDirectoryPhysicalInventoryV1(rereadAdmin).inventoryDigest !== registryAdmin.inventory.inventoryDigest
  ) {
    throw new Error('Live repository, common-dir, registry, or target identity changed during authorization publication.');
  }
  await targetLease.assertOwned();
  return authorization;
}

/**
 * The only token issuer.  It binds an authorization observed/published by the
 * live engine in this process; callers cannot construct it from a digest or
 * raw receipt JSON.
 */
export async function prepareTrustedWorktreePhysicalCloseoutV1(
  input: PrepareWorktreePhysicalCloseoutInputV1
): Promise<PreparedWorktreePhysicalCloseoutV1> {
  if (input.expectedBranch.startsWith(DETACHED_BRANCH_PREFIX)) {
    throw new Error('Detached scratch closeout cannot mint a branch/ref consumption token.');
  }
  const authorization = await prepareWorktreePhysicalCloseoutV1(input);
  const token = new WorktreePhysicalCloseoutConsumptionTokenV1();
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

export async function prepareDetachedScratchWorktreePhysicalCloseoutV1(
  input: PrepareDetachedScratchWorktreePhysicalCloseoutInputV1
): Promise<WorktreePhysicalCloseoutAuthorizationV1> {
  return prepareWorktreePhysicalCloseoutV1({ ...input, expectedBranch: detachedMarker(input.expectedHeadSha) });
}

export async function executeDetachedScratchWorktreePhysicalCloseoutV1(
  input: ExecuteDetachedScratchWorktreePhysicalCloseoutInputV1
): Promise<WorktreePhysicalCloseoutReceiptV1> {
  return executeWorktreePhysicalCloseoutV1({ ...input, expectedBranch: detachedMarker(input.expectedHeadSha) });
}

function boundedWait(milliseconds: number): void {
  if (milliseconds <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, milliseconds);
}

function removeAuthorizedResidue(
  targetPath: string,
  inventory: WorktreePhysicalInventoryV1,
  attempts: WorktreePhysicalCloseoutAttemptV1[]
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
        deleteRetainedNoFollowEntryV1({
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
          detailDigest: detailDigestV1({ attempt: index + 1, kind: entry.kind })
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
        detailDigest: detailDigestV1({ code: lastError, attempts: MAX_CLEANUP_ATTEMPTS })
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
      deleteRetainedNoFollowEntryV1({
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
  authorization: WorktreePhysicalCloseoutAuthorizationV1,
  registryAfterDigest: Digest,
  attempts: readonly WorktreePhysicalCloseoutAttemptV1[],
  registryPresent: boolean,
  physicalPresent: boolean,
  inventoryAfter: WorktreePhysicalInventoryV1 | null,
  blockers: readonly string[],
  previousReceiptDigest: Digest | null = null
): WorktreePhysicalCloseoutReceiptV1 {
  const terminal =
    !registryPresent && !physicalPresent && blockers.length === 0
      ? 'completed'
      : !registryPresent && physicalPresent
        ? 'residue'
        : 'blocked';
  return createWorktreePhysicalCloseoutReceiptV1({
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
  authorization: WorktreePhysicalCloseoutAuthorizationV1,
  recoveryRoot: PhysicalDirectoryIdentityV1,
  lastKnownRegistryDigest: Digest,
  attempts: WorktreePhysicalCloseoutAttemptV1[],
  stage: string,
  error: unknown
): WorktreePhysicalCloseoutReceiptV1 {
  const fingerprint = detailDigestV1({
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
  return persistReceiptGenerationV1(recoveryRoot, receipt);
}

async function executeWorktreePhysicalCloseoutUnderLeaseV1(
  input: ExecuteWorktreePhysicalCloseoutInputV1,
  assertLeases: () => Promise<void>
): Promise<WorktreePhysicalCloseoutReceiptV1> {
  const authorization = loadAuthorizedForExecutionV1(input.authorizationPath);
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
  const expectedRecoveryRoot = createNoFollowDirectoryChainV1(physicalDirectory(repository.commonDir, 'Git common-dir'), [
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
  const expectedProofRoot = physicalDirectory(authorization.proofRoot.path, 'Authorized target-external retained proof root');
  if (expectedProofRoot.device !== authorization.proofRoot.device || expectedProofRoot.inode !== authorization.proofRoot.inode ||
    expectedProofRoot.device !== authorization.targetLeaseNamespace.device) {
    throw new Error('Authorization proof root physical identity or target-volume binding changed.');
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
  const prior = loadLatestReceiptGenerationV1(expectedRecoveryRoot);
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
      const phase = loadRetiredWorktreePhaseV1(expectedRecoveryRoot, authorization);
      if (phase === null) throw new Error('Completed receipt lacks its required durable retirement phase.');
      assertAuthorizedLeaseNamespaceBinding(authorization, phase.retirementReceipt);
      assertWorkspaceWriteLeaseRetirementProofV1({
        workspaceRoot: path.join(path.dirname(authorization.target.path), authorization.tombstoneName),
        receipt: phase.retirementReceipt,
        proofParent: expectedProofRoot
      });
      const fenceParent = physicalDirectory(path.dirname(authorization.target.path), 'Completed retirement fence parent');
      if (readNoFollowOrdinaryFileV1(fenceParent, phase.retirementReceipt.fenceName) === null) return prior;
      // A completed receipt is only terminal after its external fence is
      // removed and read back.  Fall through to the monotonic completion
      // tail instead of stranding a live writer fence behind a fast-path.
    }
  }

  const attempts: WorktreePhysicalCloseoutAttemptV1[] = [];
  let retirementReceipt: Awaited<ReturnType<Awaited<ReturnType<typeof acquireWorkspaceWriteLease>>['retireOwnedNamespace']>> | null = null;
  const retirementIntent = loadRetiredWorktreeIntentV1(expectedRecoveryRoot, authorization);
  let retiredPhase = loadRetiredWorktreePhaseV1(expectedRecoveryRoot, authorization);
  // A crash after retiring the lease namespace but before publishing its
  // phase cannot be recovered from caller JSON.  The durable intent is the
  // locator; the lease owner reconstructs the receipt solely from the live
  // no-follow tombstone and its external identity-bound fence.
  if (retiredPhase === null && retirementIntent !== null) {
    const tombstonePath = path.join(path.dirname(authorization.target.path), authorization.tombstoneName);
    try {
      const retirementReceipt = await resumeWorkspaceWriteLeaseRetirementV1({
        workspaceRoot: tombstonePath,
        intentDigest: retirementIntent.intentDigest,
        proofParent: expectedProofRoot
      });
      retiredPhase = createRetiredWorktreePhaseV1({
        authorizationDigest: authorization.authorizationDigest,
        tombstoneName: authorization.tombstoneName,
        retirementReceipt
      });
      persistRetiredWorktreePhaseV1(expectedRecoveryRoot, retiredPhase);
    } catch (error) {
      return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, (await observeRegistry(repository.root)).digest, [], true, true, null,
        [`retirement-intent-recovery-blocked:${detailDigestV1(error instanceof Error ? error.message : String(error))}`]
      ));
    }
  }
  if (retiredPhase !== null) retirementReceipt = retiredPhase.retirementReceipt;
  if (retirementReceipt !== null) assertAuthorizedLeaseNamespaceBinding(authorization, retirementReceipt);
  let recoveredFenceAbsence = false;
  if (retiredPhase !== null) {
    const fenceParent = physicalDirectory(path.dirname(authorization.target.path), 'Retirement fence recovery parent');
    const fencePresent = readNoFollowOrdinaryFileV1(fenceParent, retiredPhase.retirementReceipt.fenceName) !== null;
    if (!fencePresent) {
      const latest = loadLatestReceiptGenerationV1(expectedRecoveryRoot);
      const intent = latest !== null && loadReceiptChainV1(expectedRecoveryRoot, latest).some((generation) =>
        generation.blockers.includes('retirement-fence-completion-pending')
      );
      if (!intent) {
        return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
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
  if (record !== null) {
    const tombstonePath = path.join(path.dirname(authorization.target.path), authorization.tombstoneName);
    if (retiredPhase !== null) {
      cleanupPath = tombstonePath;
      const tombstone = physicalPresence(tombstonePath, 'Retired target tombstone presence');
      if (tombstone === null || tombstone.device !== authorization.target.device || tombstone.inode !== authorization.target.inode) {
        return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, true, true, null, ['retired-phase-exact-tombstone-unavailable']
        ));
      }
      try {
        assertAuthorizedLeaseNamespaceBinding(authorization, retiredPhase.retirementReceipt);
        assertWorkspaceWriteLeaseRetirementV1({ workspaceRoot: tombstonePath, receipt: retiredPhase.retirementReceipt });
        recoverWorkspaceWriteLeaseRetirementV1({ workspaceRoot: tombstonePath, intentDigest: retiredPhase.retirementReceipt.intentDigest, proofParent: expectedProofRoot });
      } catch (error) {
        return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, true, true, null,
          [`retired-phase-fence-invalid:${detailDigestV1(error instanceof Error ? error.message : String(error))}`]
        ));
      }
      // A recreated lexical path is a different writer object.  Registry
      // deletion below is identity-bound to common-dir metadata, not this
      // path, so leave it untouched and let final readback report it as
      // residue instead of ever sending it through a Git path effect.
    } else {
    let originalPresent: PhysicalDirectoryIdentityV1 | null;
    try {
      originalPresent = physicalPresence(authorization.target.path, 'Target original presence');
    } catch (error) {
      const receipt = createReceipt(authorization, registry.digest, attempts, true, true, null, [
        `target-identity-observation:${detailDigestV1(error instanceof Error ? error.message : String(error))}`
      ]);
      return persistReceiptGenerationV1(expectedRecoveryRoot, receipt);
    }
    if (originalPresent === null) {
      const tombstone = physicalPresence(tombstonePath, 'Target tombstone presence');
      if (tombstone === null || tombstone.device !== authorization.target.device || tombstone.inode !== authorization.target.inode) {
        const receipt = createReceipt(authorization, registry.digest, attempts, true, true, null, ['target-and-exact-tombstone-unavailable']);
        return persistReceiptGenerationV1(expectedRecoveryRoot, receipt);
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
        `target-identity-observation:${detailDigestV1(error instanceof Error ? error.message : String(error))}`
      ]);
      return persistReceiptGenerationV1(expectedRecoveryRoot, receipt);
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
    const inventory = withoutLeaseOwnedNamespace(observeWorktreePhysicalInventoryV1(cleanupPath));
    if (inventory.inventoryDigest !== authorization.inventory.inventoryDigest) {
      blockers.push('inventory-changed-after-authorization');
    }
    if (blockers.length > 0) {
      const receipt = createReceipt(authorization, registry.digest, attempts, true, true, inventory, blockers);
      return persistReceiptGenerationV1(expectedRecoveryRoot, receipt);
    }
    cleanupInventory = inventory;
    // Retire the exact target lease protocol before physical cleanup.  Its
    // identity-keyed sibling fence prevents a new writer from recreating the
    // namespace while the authorized tree is being removed.
    const targetLease = await acquireWorkspaceWriteLease(cleanupPath);
    try {
      await targetLease.assertOwned();
      if (cleanupPath === authorization.target.path) {
        cleanupPath = relocateRetainedNoFollowDirectoryV1({
          directory: physicalDirectory(authorization.target.path, 'Target retained tombstone source'),
          tombstoneName: authorization.tombstoneName
        }).path;
        await targetLease.relocate(cleanupPath);
      }
      const liveLeaseNamespace = physicalDirectory(path.join(cleanupPath, '.sec', 'workspace-write-lease'), 'Authorized target writer lease namespace');
      if (liveLeaseNamespace.device !== authorization.targetLeaseNamespace.device || liveLeaseNamespace.inode !== authorization.targetLeaseNamespace.inode) {
        throw new Error('Target writer lease namespace identity changed after authorization.');
      }
      const intent = createRetiredWorktreeIntentV1({
        authorizationDigest: authorization.authorizationDigest, tombstoneName: authorization.tombstoneName,
        targetDevice: authorization.target.device, targetInode: authorization.target.inode
      });
      persistRetiredWorktreeIntentV1(expectedRecoveryRoot, intent);
      retirementReceipt = await targetLease.retireOwnedNamespace(intent.intentDigest, expectedProofRoot);
      assertAuthorizedLeaseNamespaceBinding(authorization, retirementReceipt);
      const actualRetirementPhase = createRetiredWorktreePhaseV1({
        authorizationDigest: authorization.authorizationDigest,
        tombstoneName: authorization.tombstoneName,
        retirementReceipt
      });
      persistRetiredWorktreePhaseV1(expectedRecoveryRoot, actualRetirementPhase);
      // Only this branch holds the live target lease and received its actual
      // retirement return value.  Durable resume branches intentionally never
      // call this issuer, even when they later converge to physical complete.
      issueTrustedRetirementV1(authorization, retirementReceipt, actualRetirementPhase);
      recoverWorkspaceWriteLeaseRetirementV1({ workspaceRoot: cleanupPath, intentDigest: intent.intentDigest, proofParent: expectedProofRoot });
    } finally {
      try { await targetLease.release(); } catch { /* retirement invalidates its handle */ }
    }
    }
    // The retained tombstone makes the original target literal ENOENT while
    // preserving its identity and lease fence.  Persisted authorization is
    // therefore followed by the narrow registry-only Git effect first;
    // physical cleanup cannot run until registry readback is durable evidence.
    attempts.push({
      operation: 'unregister', status: 'skipped', relativePath: null,
      detailDigest: detailDigestV1('durable-unregister-intent-before-registry-effect')
    });
    persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
      authorization, registry.digest, attempts, true, true, cleanupInventory, ['unregister-intent-durable']
    ));
    // Registry removal is never delegated to `git worktree remove <path>`:
    // that command re-resolves a hostile lexical target after our ENOENT
    // fence.  Authorization binds the exact common-dir worktrees/<id> object
    // and its no-follow inventory instead.
    const registryAdmin = physicalPresence(registryAdminPath, 'Authorized Git worktree admin directory');
    if (registryAdmin === null || registryAdmin.device !== authorization.registryAdmin.device || registryAdmin.inode !== authorization.registryAdmin.inode) {
      return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, true, true, cleanupInventory, ['registry-admin-identity-unavailable']
      ));
    }
    const registryAdminInventory = observeDirectoryPhysicalInventoryV1(registryAdmin);
    if (registryAdminInventory.inventoryDigest !== authorization.registryAdmin.inventory.inventoryDigest) {
      return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, true, true, cleanupInventory, ['registry-admin-inventory-changed']
      ));
    }
    await assertLeases();
    const movedAdmin = relocateRetainedNoFollowDirectoryAcrossParentsV1({
      directory: registryAdmin,
      destinationParent: expectedRecoveryRoot,
      tombstoneName: authorization.registryAdmin.tombstoneName
    });
    const adminEffectDigest = detailDigestV1({
      method: 'retained-common-dir-admin-cross-parent-rename',
      relativePath: authorization.registryAdmin.relativePath,
      tombstoneName: authorization.registryAdmin.tombstoneName,
      device: movedAdmin.device,
      inode: movedAdmin.inode
    });
    // Only the executor that received the retained rename result may elevate
    // a prepared opaque token. Durable receipts can converge later processes,
    // but their public self-digests are never an issuer credential.
    issueTrustedAdminEffectV1(authorization, adminEffectDigest);
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
        const inventoryAfter = physical === null ? null : observeWorktreePhysicalInventoryV1(authorization.target.path);
        const receipt = createReceipt(authorization, registry.digest, attempts, true, physical !== null, inventoryAfter, [
          'registry-still-present-after-unregister-attempt'
        ]);
        return persistReceiptGenerationV1(expectedRecoveryRoot, receipt);
      }
      // Registry disappearance is itself an effect.  Persist it before any
      // retained physical cleanup, so every later completed generation has a
      // durable predecessor proving unregister/readback closure.
      attempts.push({
        operation: 'readback', status: 'success', relativePath: null,
        detailDigest: detailDigestV1('registry-absent-effect-proof-before-cleanup')
      });
      persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
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
        return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(authorization, registry.digest, attempts, false, true, null, ['registry-admin-tombstone-identity-changed']));
      }
      const subset = observeDirectoryPhysicalInventoryV1(adminTombstone);
      const adminBlockers = classifyAuthorizedWorktreeResidueV1(subset, authorization.registryAdmin.inventory);
      if (adminBlockers.length > 0) return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(authorization, registry.digest, attempts, false, true, null, adminBlockers.map((blocker) => `registry-admin-${blocker}`)));
      attempts.push({ operation: 'unregister', status: 'success', relativePath: null, detailDigest: detailDigestV1('registry-absent-admin-tombstone-effect-witness') });
      persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(authorization, registry.digest, attempts, false, true, null, ['registry-admin-cleanup-pending-after-crash']));
      removeAuthorizedResidue(registryAdminTombstonePath, subset, attempts);
    }
    if (retiredPhase !== null) {
      cleanupPath = path.join(path.dirname(authorization.target.path), authorization.tombstoneName);
      const tombstone = physicalPresence(cleanupPath, 'Registry-absent retired tombstone presence');
      if (tombstone === null) {
        const latest = loadLatestReceiptGenerationV1(expectedRecoveryRoot);
        const cleanupReadbackDurable = latest !== null && loadReceiptChainV1(expectedRecoveryRoot, latest).some((candidate) =>
          candidate.readback.registryPresent === false && candidate.readback.physicalPresent === false &&
          candidate.blockers.includes('cleanup-readback-durable-before-fence-completion')
        );
        if (!cleanupReadbackDurable) {
          return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
            authorization, registry.digest, attempts, false, true, null, ['registry-absent-exact-tombstone-unavailable']
          ));
        }
      } else if (tombstone.device !== authorization.target.device || tombstone.inode !== authorization.target.inode) {
        return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, false, true, null, ['registry-absent-exact-tombstone-unavailable']
        ));
      } else {
        try {
          assertAuthorizedLeaseNamespaceBinding(authorization, retiredPhase.retirementReceipt);
          assertWorkspaceWriteLeaseRetirementV1({ workspaceRoot: cleanupPath, receipt: retiredPhase.retirementReceipt });
          recoverWorkspaceWriteLeaseRetirementV1({ workspaceRoot: cleanupPath, intentDigest: retiredPhase.retirementReceipt.intentDigest, proofParent: expectedProofRoot });
        } catch (error) {
          return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
            authorization, registry.digest, attempts, false, true, null,
            [`registry-absent-retired-fence-invalid:${detailDigestV1(error instanceof Error ? error.message : String(error))}`]
          ));
        }
      }
    }
    attempts.push({
      operation: 'unregister',
      status: 'skipped',
      relativePath: null,
      detailDigest: detailDigestV1('registry-already-absent-authorized-resume')
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
      return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, true, null,
        ['registry-admin-tombstone-residue-after-cleanup']
      ));
    }
    const latest = loadLatestReceiptGenerationV1(expectedRecoveryRoot);
    const chain = latest === null ? [] : loadReceiptChainV1(expectedRecoveryRoot, latest);
    const exactAdminEffectWitnessed = chain.some((generation) => generation.attempts.some((attempt) =>
      attempt.operation === 'unregister' && attempt.status === 'success'
    ));
    if (!exactAdminEffectWitnessed) {
      return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, true, null,
        ['registry-admin-disappeared-without-authorized-effect-witness']
      ));
    }
    const alreadyWitnessed = chain.some((generation) =>
      generation.blockers.includes('registry-admin-cleanup-readback-durable')
    );
    if (!alreadyWitnessed) {
      persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, true, null,
        ['registry-admin-cleanup-readback-durable']
      ));
    }
  }

  try {
    let blockers: string[] = [];
    const remainingTarget = physicalPresence(cleanupPath, 'Residue target');
    if (remainingTarget !== null) {
      const targetIdentity = remainingTarget;
      if (targetIdentity.device !== authorization.target.device || targetIdentity.inode !== authorization.target.inode) {
        blockers.push('target-physical-identity-changed');
      } else {
        const current = observeWorktreePhysicalInventoryV1(cleanupPath);
        blockers = classifyAuthorizedWorktreeResidueV1(current, authorization.inventory);
        if (blockers.length === 0) {
          await assertLeases();
          removeAuthorizedResidue(cleanupPath, current, attempts);
          if (physicalPresence(cleanupPath, 'Target cleanup crash boundary') === null) {
            // This durable nonterminal generation distinguishes a root-delete
            // crash from an unproven missing tombstone on the next process.
            persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
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
      ? observeWorktreePhysicalInventoryV1(cleanupPath) : null;
    if (registryPresent) blockers.push('registry-reappeared-during-cleanup');
    if (physicalPresent && blockers.length === 0) blockers.push('physical-residue-remains');
    attempts.push({
      operation: 'readback',
      status: !registryPresent && !physicalPresent ? 'success' : 'failed',
      relativePath: null,
      detailDigest: detailDigestV1({ registryPresent, physicalPresent, inventoryAfter: inventoryAfter?.inventoryDigest ?? null })
    });
    if (!registryPresent && !physicalPresent && retirementReceipt !== null) {
      // This final proof fence applies equally to the normal path and to the
      // crash-resume shape where the tombstone has already gone away.  Public
      // phase/receipt bytes cannot bypass the retained V3 ledger; leave the
      // writer fence untouched and record a nonterminal result on any drift.
      try {
        assertAuthorizedLeaseNamespaceBinding(authorization, retirementReceipt);
        assertWorkspaceWriteLeaseRetirementProofV1({
          workspaceRoot: cleanupPath,
          receipt: retirementReceipt,
          proofParent: expectedProofRoot
        });
      } catch (error) {
        return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
          authorization, registry.digest, attempts, false, false, null,
          [`retirement-proof-final-readback-invalid:${detailDigestV1(error instanceof Error ? error.message : String(error))}`]
        ));
      }
    }
    if (!registryPresent && !physicalPresent && retirementReceipt !== null) {
      // This immutable nonterminal generation closes cleanup itself.  If the
      // process dies before the next completed/fence-completion generations,
      // resume accepts only this exact evidence shape and never reacquires the
      // fenced (now absent) tombstone.
      persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, false, null,
        ['cleanup-readback-durable-before-fence-completion']
      ));
    }
    if (!registryPresent && !physicalPresent && retirementReceipt !== null) {
      // The physical readback is real, but the retirement fence still denies
      // ordinary writers.  This must remain an explicit nonterminal stage;
      // only fence deletion *and a subsequent durable generation* produces
      // `completed`, so neither the fast path nor a token consumer can accept
      // a crash-before-fence-completion state.
      persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, false, null,
        ['retirement-fence-completion-pending']
      ));
      if (!recoveredFenceAbsence) {
        completeWorkspaceWriteLeaseRetirementV1({
          workspaceRoot: cleanupPath, receipt: retirementReceipt
        });
      }
      attempts.push({
        operation: 'readback', status: 'success', relativePath: null,
        detailDigest: detailDigestV1(recoveredFenceAbsence
          ? 'retirement-fence-absence-recovered-readback'
          : 'retirement-fence-completion-readback')
      });
      const completed = persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
        authorization, registry.digest, attempts, false, false, null, []
      ));
      // This is deliberately after durable final receipt publication.  A
      // crash before it leaves only public evidence and cannot manufacture an
      // opaque branch capability in a later process.
      issueTrustedCompletionV1(authorization, completed);
      return completed;
    }
    return persistReceiptGenerationV1(expectedRecoveryRoot, createReceipt(
      authorization, registry.digest, attempts, registryPresent, physicalPresent, inventoryAfter, blockers
    ));
  } catch (error) {
    return postUnregisterObservationFailureReceipt(
      authorization, expectedRecoveryRoot, registry.digest, attempts, 'final-residue-readback', error
    );
  }
}

export async function executeWorktreePhysicalCloseoutV1(
  input: ExecuteWorktreePhysicalCloseoutInputV1
): Promise<WorktreePhysicalCloseoutReceiptV1> {
  return withWorkspaceWriteLease(input.repositoryRoot, undefined, async (lease) => {
    const assertLease = () => assertWorkspaceWriteLease(input.repositoryRoot, lease);
    await assertLease();
    const receipt = await executeWorktreePhysicalCloseoutUnderLeaseV1(input, assertLease);
    await assertLease();
    return receipt;
  });
}

/**
 * Rehydrates both files only from the live canonical common-dir operation
 * directory, proves the target is still absent, and accepts only a receipt
 * that contains real unregister and final-readback closure.  This is the
 * branch-owner-facing boundary; it deliberately does not accept raw receipts.
 */
export function assertTrustedCompletedWorktreePhysicalCloseoutV1(input: {
  readonly token: WorktreePhysicalCloseoutConsumptionTokenV1;
  readonly repositoryRoot: string;
  readonly targetPath: string;
  readonly branch: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly recoveryAuthorityDigest: Digest;
}): WorktreePhysicalCloseoutReceiptV1 {
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
  const operationRoot = createNoFollowDirectoryChainV1(liveCommonDir, [
    'sec-worktree-closeout', issued.authorization.operationId.slice('sha256:'.length)
  ]);
  const authorization = loadCanonicalFile(operationRoot, 'authorization.json', (value) =>
    assertWorktreePhysicalCloseoutAuthorizationV1(value as WorktreePhysicalCloseoutAuthorizationV1));
  const receipt = loadLatestReceiptGenerationV1(operationRoot);
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
  const chain = loadReceiptChainV1(operationRoot, receipt);
  if (chain.some((generation) => generation.authorizationDigest !== authorization.authorizationDigest ||
    generation.operationId !== authorization.operationId)) {
    throw new Error('Trusted completed worktree receipt chain crosses an authorization boundary.');
  }
  const unregister = chain.some((generation) => generation.attempts.some((attempt) =>
    attempt.operation === 'unregister' && attempt.status === 'success' &&
    attempt.detailDigest === issued.adminEffectDigest
  ));
  const readback = chain.some((generation) => generation.attempts.some((attempt) => attempt.operation === 'readback' && attempt.status === 'success'));
  const phase = loadRetiredWorktreePhaseV1(operationRoot, authorization);
  if (phase === null || readNoFollowOrdinaryFileV1(
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
  assertWorkspaceWriteLeaseRetirementProofV1({
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
    '  bun scripts/codex/worktree-physical-closeout.ts prepare --repository-root <path> --target <path> --expected-branch <name> --expected-head <sha> --expected-tree <sha> --expected-recovery-authority <digest>\n' +
    '  bun scripts/codex/worktree-physical-closeout.ts execute --repository-root <path> --target <path> --expected-branch <name> --expected-head <sha> --expected-tree <sha> --expected-recovery-authority <digest> --authorization <path>';
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
  const input: PrepareWorktreePhysicalCloseoutInputV1 = {
    repositoryRoot: option(args, '--repository-root'),
    targetPath: option(args, '--target'),
    expectedBranch: option(args, '--expected-branch'),
    expectedHeadSha: option(args, '--expected-head'),
    expectedTreeSha: option(args, '--expected-tree'),
    expectedRecoveryAuthorityDigest: option(args, '--expected-recovery-authority') as Digest
  };
  const result =
    command === 'prepare'
      ? await prepareWorktreePhysicalCloseoutV1(input)
      : await executeWorktreePhysicalCloseoutV1({ ...input, authorizationPath: option(args, '--authorization') });
  process.stdout.write(`${JSON.stringify(canonicalJson(result), null, 2)}\n`);
  if ('terminal' in result && result.terminal !== 'completed') process.exitCode = 2;
}

if (import.meta.main) await main();
