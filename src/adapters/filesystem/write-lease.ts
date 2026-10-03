import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { canonicalEquals, digest, sha256 } from '../../contracts/canonical.ts';
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { ResourceCompositeSettlementError, withAcquiredResource } from '../../execution/resource-settlement.ts';
import { issueWindowsAppContainerExecutionCapability as issuePhysicalWindowsAppContainerExecutionCapability, type WindowsAppContainerExecutionCapability } from '../runtime-state/physical/contract/windows-appcontainer-execution-capability.ts';
import { assertSameNoFollowDirectoryIdentity, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, relocateRetainedNoFollowDirectoryAcrossParents, scanNoFollowDirectoryTree, type PhysicalDirectoryIdentity } from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { ensureDir } from "./files.ts";
import { HEARTBEAT_FILE, HOLDERS_DIRECTORY, isExistsError, isMissingError, nonEmpty, OWNER_FILE, OWNER_GENERATION_PATTERN, PROTOCOL_FILE, safeInteger, sameToken, systemErrorCode, TERMINAL_GENERATION_PATTERN, tokenFromOwner, tokenLooksValid, WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION, WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION, WORKSPACE_WRITE_LEASE_TERMINAL_VERSION, WORKSPACE_WRITE_LEASE_TOKEN_VERSION, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseAcquireOptions, type WorkspaceWriteLeaseHandle, type WorkspaceWriteLeaseHeartbeat, type WorkspaceWriteLeaseInventory, type WorkspaceWriteLeaseManager, type WorkspaceWriteLeaseManagerOptions, type WorkspaceWriteLeaseOwner, type WorkspaceWriteLeasePaths, type WorkspaceWriteLeaseRetirementReceipt, type WorkspaceWriteLeaseTerminal, type WorkspaceWriteLeaseToken } from './write-lease-contract.ts';
import { assertLeaseParent, assertNoLegacyOwner, assertProtocolDirectory, assertProtocolMarker, generationOwnerPath, generationTerminalPath, holderDirectory, inspectProtocolMarkerAlias, ownerFileIdentity, physicalWorkspaceIdentityDigest, readBoundHeartbeat, readBoundHeartbeatUnlessTerminalized, readGenerationState, readInventory, readOptionalTerminal, readProtocolMarkerMetadata, sameFileIdentity, verifyProtocolRoot, workspaceIdentity, workspaceIdentityFailureReason, workspaceWriteLeasePathsFor } from './write-lease-observation.ts';
import { assertRetirementLedgerNamespace, assertWorkspaceWriteLeaseRetirement, createRetirementTransition, namespaceTombstoneName, readPreterminalRetirementReceipt, readRetirementTransitionProof, retirementFenceName, retirementFenceParent, retirementTerminalTokenDigest, retirementTransitionName, snapshotRetirementRecoveryInput, transitionEntries, validateRetirementReceipt, validateRetirementTransition, type WorkspaceWriteLeaseRetirementRecoveryInput, type WorkspaceWriteLeaseRetirementTransition } from './write-lease-retirement-proof.ts';
export { WORKSPACE_WRITE_LEASE_DIRECTORY_NAME, WORKSPACE_WRITE_LEASE_INSPECTION_VERSION, WORKSPACE_WRITE_LEASE_TOKEN_VERSION, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseAcquireOptions, type WorkspaceWriteLeaseErrorCode, type WorkspaceWriteLeaseHandle, type WorkspaceWriteLeaseInspection, type WorkspaceWriteLeaseManager, type WorkspaceWriteLeaseManagerOptions, type WorkspaceWriteLeaseRetirementReceipt, type WorkspaceWriteLeaseToken } from './write-lease-contract.ts';
export { inspectWorkspaceWriteLease } from './write-lease-observation.ts';
export { assertWorkspaceWriteLeaseRetirement, assertWorkspaceWriteLeaseRetirementProof } from './write-lease-retirement-proof.ts';

/** Workspace lease authority: the only live manager, recovery issuer and mutation owner.
 * Ledger/proof readers below return observations; they never acquire, publish, reclaim
 * or retire a generation. Keeping effects here preserves one admission/settlement chain. */

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

const DEFAULT_STALE_AFTER_MS = 30_000;

const MAX_LEASE_ID_LENGTH = 256;

const PROCESS_NONCE = randomUUID();

const RETIREMENT_RECOVERY_ACQUIRE = Symbol('workspace-write-lease-retirement-recovery-acquire-v1');

type InternalWorkspaceWriteLeaseAcquireOptions = WorkspaceWriteLeaseAcquireOptions & {
  readonly [RETIREMENT_RECOVERY_ACQUIRE]?: WorkspaceWriteLeaseRetirementReceipt;
};

const workspaceWriteCommitFenceBindings = new WeakMap<
  CommitFence,
  Readonly<{
    workspaceRoot: string;
    token: WorkspaceWriteLeaseToken;
  }>
>();

class WorkspaceWriteLeaseRetirementRecoveryReady extends WorkspaceWriteLeaseError {
  constructor(readonly receipt: WorkspaceWriteLeaseRetirementReceipt) {
    super('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement generation reached terminal recovery state');
  }
}

interface PreparedWorkspaceWriteLease {
  readonly holder: string;
  readonly ownerPath: string;
  readonly owner: WorkspaceWriteLeaseOwner;
  readonly token: WorkspaceWriteLeaseToken;
}

type ImmutablePublicationOutcome =
  | Readonly<{ state: 'published' }>
  | Readonly<{
      state: 'not-published';
      reason: 'target-exists' | 'link-failed';
      systemCode: string;
    }>
  | Readonly<{ state: 'durability-unknown'; systemCode: string }>;

/** Legacy V3 process metadata is diagnostic. Neither PID absence, namespace
 * mismatch nor heartbeat age can authorize predecessor recovery. */

function acquisitionSystemCode(error: unknown): string | undefined {
  if (error instanceof WorkspaceWriteLeaseError) {
    return systemErrorCode({ code: error.details.systemCode });
  }
  return systemErrorCode(error);
}

type WorkspaceWriteLeaseAcquisitionPhase =
  | 'retirement-fence-observation'
  | 'lease-root-initialization'
  | 'lease-inventory'
  | 'acquisition-clock'
  | 'owner-preparation'
  | 'owner-publication'
  | 'unclassified';

function acquisitionFailure(
  phase: WorkspaceWriteLeaseAcquisitionPhase,
  error: unknown,
  message: string
): WorkspaceWriteLeaseError {
  return new WorkspaceWriteLeaseError(
    'WORKSPACE-WRITE-LEASE-004',
    message,
    {
      operation: 'acquire',
      phase,
      systemCode: acquisitionSystemCode(error) ?? 'UNKNOWN'
    }
  );
}

function acquisitionPhaseFailure(
  phase: WorkspaceWriteLeaseAcquisitionPhase,
  error: unknown,
  message: string
): WorkspaceWriteLeaseError {
  // Manager callbacks are public capabilities.  A callback can construct this
  // exported error class, so `instanceof WorkspaceWriteLeaseError` is not an
  // issuer credential.  Every acquisition callback boundary is projected into
  // the same closed contract: fixed message, fixed keys, and a bounded native
  // code.  No callback-owned message or details survive the boundary.
  if (!(error instanceof WorkspaceWriteLeaseError)) {
    return acquisitionFailure(phase, error, message);
  }
  // Structural protocol and contention errors are created below the callback
  // boundary and retain their typed semantics.  Capability wrappers above
  // convert every caller-issued exception to code 004 before it reaches here.
  if (error.code !== 'WORKSPACE-WRITE-LEASE-004') return error;
  return acquisitionFailure(phase, error, message);
}

async function fsyncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    const code = systemErrorCode(error);
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'EBADF'].includes(code ?? '')) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

function jsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function candidateFileName(kind: string, id: string): string {
  const digestHex = digest(JSON.stringify({ kind, id }));
  return `.${kind}-${digestHex}.candidate`;
}

async function createImmutableCandidate(
  directory: string,
  kind: string,
  value: unknown,
  createId: () => string
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = path.join(directory, candidateFileName(kind, createId()));
    let handle;
    try {
      handle = await fs.open(candidate, 'wx');
      await handle.writeFile(jsonFile(value), 'utf8');
      await handle.sync();
      await handle.close();
      await fsyncDirectory(directory);
      return candidate;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (isExistsError(error)) continue;
      throw error;
    }
  }
  throw new WorkspaceWriteLeaseError(
    'WORKSPACE-WRITE-LEASE-004',
    'Workspace writer lease immutable candidate identity collided repeatedly'
  );
}

async function publicationTargetRelationship(
  candidate: string,
  target: string
): Promise<'absent' | 'same' | 'different' | 'unknown'> {
  let candidateMetadata;
  let targetMetadata;
  try {
    candidateMetadata = await fs.lstat(candidate, { bigint: true });
  } catch {
    return 'unknown';
  }
  try {
    targetMetadata = await fs.lstat(target, { bigint: true });
  } catch (error) {
    return isMissingError(error) ? 'absent' : 'unknown';
  }
  if (!candidateMetadata.isFile() || candidateMetadata.isSymbolicLink() ||
    !targetMetadata.isFile() || targetMetadata.isSymbolicLink()) {
    return 'different';
  }
  return sameFileIdentity(candidateMetadata, targetMetadata) ? 'same' : 'different';
}

async function linkImmutableCandidateNoReplace(
  candidate: string,
  targetDirectory: string,
  target: string,
  syncTargetDirectory: (directory: string) => Promise<void> = fsyncDirectory
): Promise<ImmutablePublicationOutcome> {
  try {
    await fs.link(candidate, target);
  } catch (error) {
    const systemCode = systemErrorCode(error) ?? 'UNKNOWN';
    const relationship = await publicationTargetRelationship(candidate, target);
    if (relationship === 'same') return Object.freeze({ state: 'durability-unknown', systemCode });
    if (relationship === 'unknown') return Object.freeze({ state: 'durability-unknown', systemCode });
    if (relationship === 'different' && isExistsError(error)) {
      return Object.freeze({ state: 'not-published', reason: 'target-exists', systemCode });
    }
    if (relationship === 'absent') {
      return Object.freeze({ state: 'not-published', reason: 'link-failed', systemCode });
    }
    return Object.freeze({ state: 'durability-unknown', systemCode });
  }
  try {
    await syncTargetDirectory(targetDirectory);
    return Object.freeze({ state: 'published' });
  } catch (error) {
    return Object.freeze({
      state: 'durability-unknown',
      systemCode: systemErrorCode(error) ?? 'UNKNOWN'
    });
  }
}

async function removeImmutableCandidate(
  candidateDirectory: string,
  candidate: string
): Promise<void> {
  await fs.unlink(candidate);
  await fsyncDirectory(candidateDirectory);
}

async function publishImmutableJsonNoReplace(
  candidateDirectory: string,
  targetDirectory: string,
  target: string,
  kind: string,
  value: unknown,
  createId: () => string
): Promise<boolean> {
  const candidate = await createImmutableCandidate(candidateDirectory, kind, value, createId);
  const outcome = await linkImmutableCandidateNoReplace(candidate, targetDirectory, target);
  if (outcome.state === 'durability-unknown') {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease immutable publication durability is unknown',
      {
        reason: 'publication-durability-unknown',
        retryable: true,
        systemCode: outcome.systemCode
      }
    );
  }
  try {
    await removeImmutableCandidate(candidateDirectory, candidate);
  } catch (error) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease immutable publication cleanup durability is unknown',
      {
        reason: 'publication-cleanup-durability-unknown',
        retryable: true,
        systemCode: systemErrorCode(error) ?? 'UNKNOWN'
      }
    );
  }
  if (outcome.state === 'not-published') {
    if (outcome.reason === 'target-exists') return false;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease immutable publication failed before target creation',
      { systemCode: outcome.systemCode }
    );
  }
  return true;
}

async function replaceHeartbeat(
  holder: string,
  heartbeat: WorkspaceWriteLeaseHeartbeat,
  createId: () => string,
  assertCurrentOwner: () => Promise<void>,
  retryBudgetMs: number
): Promise<void> {
  const temporary = path.join(holder, candidateFileName('heartbeat', createId()));
  const handle = await fs.open(temporary, 'wx');
  try {
    await handle.writeFile(jsonFile(heartbeat), 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const target = path.join(holder, HEARTBEAT_FILE);
    const retryDeadline = performance.now() + retryBudgetMs;
    for (;;) {
      try {
        await fs.rename(temporary, target);
        break;
      } catch (error) {
        const systemCode = systemErrorCode(error) ?? 'UNKNOWN';
        if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(systemCode)
            || performance.now() >= retryDeadline) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease heartbeat replacement failed',
            { operation: 'heartbeat', phase: 'heartbeat-rename', systemCode }
          );
        }
        // A Windows reader can briefly deny replacement. The candidate has
        // not been published; prove the same generation still belongs to this
        // writer before the next bounded attempt.
        await assertCurrentOwner();
        const remainingMs = retryDeadline - performance.now();
        if (remainingMs <= 0) continue;
        await new Promise<void>((resolve) => setTimeout(
          resolve,
          Math.min(remainingMs, Math.max(1, Math.floor(retryBudgetMs / 50)))
        ));
      }
    }
    await fsyncDirectory(holder);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * Reconstructs a retirement capability only from retained no-follow facts.
 * Callers supply just the live tombstone locator and the already-durable
 * closeout intent digest; no JSON receipt supplied by a caller is trusted.
 */
export function recoverWorkspaceWriteLeaseRetirement(input: WorkspaceWriteLeaseRetirementRecoveryInput): WorkspaceWriteLeaseRetirementReceipt {
  const stableInput = snapshotRetirementRecoveryInput(input);
  const workspace = inspectNoFollowDirectoryChain(stableInput.workspaceRoot, 'Workspace lease retirement recovery workspace').target;
  const parent = inspectNoFollowDirectoryChain(retirementFenceParent(stableInput.workspaceRoot), 'Workspace lease retirement recovery parent').target;
  const proofParent = stableInput.proofParent;
  const expectedFenceName = retirementFenceName(physicalWorkspaceIdentityDigest(workspace));
  const fenceEntry = inspectNoFollowOrdinaryFileEntry(parent, expectedFenceName);
  if (fenceEntry === null || fenceEntry.kind !== 'file' || fenceEntry.bytes === null) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery fence is absent for this tombstone identity');
  }
  let receipt: WorkspaceWriteLeaseRetirementReceipt;
  try {
    receipt = validateRetirementReceipt(JSON.parse(Buffer.from(fenceEntry.bytes).toString('utf8')) as unknown);
  } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery fence is malformed');
  }
  if (receipt.fenceName !== expectedFenceName || receipt.intentDigest !== stableInput.intentDigest ||
    receipt.workspaceDevice !== workspace.device || receipt.workspaceInode !== workspace.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery fence does not bind this tombstone identity and intent');
  }
  if (physicalWorkspaceIdentityDigest(workspace) !== receipt.workspaceIdentityDigest) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery identity digest differs from the live tombstone');
  }
  const transition = readRetirementTransitionProof(proofParent, receipt);
  if (transition.workspaceDevice !== workspace.device || transition.workspaceInode !== workspace.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition does not bind the fence identity');
  }
  const paths = workspaceWriteLeasePathsFor(stableInput.workspaceRoot);
  const namespacePresence = inspectExactNoFollowDirectoryPresence(paths.root, 'Workspace lease retirement recovery namespace');
  if (transition.namespaceTombstoneParentDevice !== proofParent.device || transition.namespaceTombstoneParentInode !== proofParent.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery proof parent differs from transition');
  }
  const externalNamespacePath = path.join(proofParent.path, receipt.namespaceTombstoneName);
  let convergenceNamespace: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity | null = null;
  const externalPresence = inspectExactNoFollowDirectoryPresence(externalNamespacePath, 'Workspace lease retirement recovery external namespace');
  if (namespacePresence.state === 'present' && externalPresence.state === 'present') {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement has both internal and external namespaces');
  }
  if (namespacePresence.state === 'present') {
    const namespace = namespacePresence.directory.target;
    assertRetirementLedgerNamespace(namespace, receipt, transition);
    convergenceNamespace = relocateRetainedNoFollowDirectoryAcrossParents({
      directory: namespace, destinationParent: proofParent, tombstoneName: receipt.namespaceTombstoneName
    });
  } else if (externalPresence.state === 'present') {
    convergenceNamespace = externalPresence.directory.target;
    assertRetirementLedgerNamespace(convergenceNamespace, receipt, transition);
  } else {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof namespace is absent');
  }
  if (convergenceNamespace !== null) {
    // The proof namespace remains until terminal lifecycle completion.  Its
    // inode and ledger are the only cross-process convergence authority.
  }
  return receipt;
}

/**
 * A process can die after publishing its immutable transition but before the
 * same-token fence exists.  That transition is explicitly non-authoritative:
 * while the live namespace is still the exact inode named by it, remove only
 * this verified pre-fence artifact so the canonical stale-takeover path can
 * retire afresh.  Any fence, relocated namespace, changed namespace, or
 * foreign proof-root entry fails closed rather than being swept as "stale".
 */
function discardExactPreFenceTransition(input: {
  readonly workspaceRoot: string;
  readonly intentDigest: string;
  readonly proofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity;
}): void {
  const workspace = inspectNoFollowDirectoryChain(input.workspaceRoot, 'Pre-fence transition workspace').target;
  const parent = assertSameNoFollowDirectoryIdentity(input.proofParent, 'Pre-fence transition proof parent').target;
  const entries = scanNoFollowDirectoryTree(parent);
  if (entries.length === 0) return;
  const transitionNamePattern = /^\.workspace-write-lease-transition-[0-9a-f]{64}\.json$/u;
  const candidateNamePattern = /^\.(\.workspace-write-lease-transition-[0-9a-f]{64}\.json)\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.candidate$/u;
  if (entries.length > 2 || entries.some((entry) => entry.kind !== 'file')) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence proof root contains unknown content');
  }
  const artifacts = entries.map((entry) => {
    const candidateMatch = entry.relativePath.match(candidateNamePattern);
    const finalName = transitionNamePattern.test(entry.relativePath) ? entry.relativePath : candidateMatch?.[1];
    if (finalName === undefined) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence proof root contains unknown content');
    }
    const bytes = readNoFollowOrdinaryFile(parent, entry.relativePath);
    if (bytes === null) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence transition disappeared');
    let transition: WorkspaceWriteLeaseRetirementTransition;
    try { transition = validateRetirementTransition(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown); } catch {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence transition is malformed');
    }
    if (finalName !== retirementTransitionName(transition.transitionDigest)) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence candidate name differs from its transition');
    }
    return Object.freeze({ entry, transition, candidate: candidateMatch !== null });
  });
  const transition = artifacts[0]!.transition;
  if (artifacts.some((artifact) => !canonicalEquals(artifact.transition, transition)) ||
    (artifacts.length === 2 && (
      artifacts.filter((artifact) => artifact.candidate).length !== 1 ||
      artifacts[0]!.entry.device !== artifacts[1]!.entry.device || artifacts[0]!.entry.inode !== artifacts[1]!.entry.inode
    ))) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence publication aliases are inconsistent');
  }
  if (transition.intentDigest !== input.intentDigest || transition.workspaceDevice !== workspace.device || transition.workspaceInode !== workspace.inode ||
    physicalWorkspaceIdentityDigest(workspace) !== transition.workspaceIdentityDigest ||
    transition.namespaceTombstoneParentDevice !== parent.device || transition.namespaceTombstoneParentInode !== parent.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence transition does not bind this live workspace');
  }
  const namespace = inspectNoFollowDirectoryChain(workspaceWriteLeasePathsFor(input.workspaceRoot).root, 'Pre-fence transition namespace').target;
  if (namespace.device !== transition.namespaceDevice || namespace.inode !== transition.namespaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence namespace identity changed');
  }
  const expected = new Map(transition.namespaceEntries.map((entry) => [entry.relativePath, entry]));
  const terminalPath = generationTerminalPath('', transition.token.generation);
  if (scanNoFollowDirectoryTree(namespace).some((entry) => {
    const prior = expected.get(entry.relativePath);
    return (entry.relativePath !== terminalPath && prior === undefined) ||
      (prior !== undefined && (prior.kind !== entry.kind || prior.device !== entry.device || prior.inode !== entry.inode || prior.size !== entry.size || prior.bytes !== (entry.bytes === null ? null : Buffer.from(entry.bytes).toString('hex'))));
  })) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease pre-fence namespace is not an expected transition subset');
  }
  for (const artifact of [...artifacts].sort((left, right) => Number(right.candidate) - Number(left.candidate))) {
    deleteRetainedNoFollowEntry({
      root: parent, relativePath: artifact.entry.relativePath, kind: 'file',
      device: artifact.entry.device, inode: artifact.entry.inode, ancestorDirectories: []
    });
  }
}

/**
 * Continues the single lease-owner retirement transition across its two
 * publication crash windows.  This is deliberately the only durable resume
 * entrypoint: it accepts a locator and intent digest, rederives all remaining
 * authority from the canonical lease ledger/fence, and never accepts a caller
 * supplied receipt or namespace list.
 */
export async function resumeWorkspaceWriteLeaseRetirement(input: WorkspaceWriteLeaseRetirementRecoveryInput): Promise<WorkspaceWriteLeaseRetirementReceipt> {
  const stableInput = snapshotRetirementRecoveryInput(input);
  try {
    const recovered = recoverWorkspaceWriteLeaseRetirement(stableInput);
    return recovered;
  } catch (error) {
    if (!(error instanceof WorkspaceWriteLeaseError) || error.code !== 'WORKSPACE-WRITE-LEASE-003') throw error;
  }
  const preterminal = readPreterminalRetirementReceipt(stableInput);
  if (preterminal !== null) {
    try {
      const unexpected = await acquireWorkspaceWriteLease(stableInput.workspaceRoot, {
        [RETIREMENT_RECOVERY_ACQUIRE]: preterminal
      } as InternalWorkspaceWriteLeaseAcquireOptions);
      await unexpected.release().catch(() => undefined);
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Preterminal retirement recovery unexpectedly acquired a successor generation');
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseRetirementRecoveryReady &&
        error.receipt.retirementDigest === preterminal.retirementDigest) {
        return recoverWorkspaceWriteLeaseRetirement(stableInput);
      }
      throw error;
    }
  }
  discardExactPreFenceTransition(stableInput);
  // No valid completed fence: only an intact canonical active lease can
  // continue the transition.  `acquire` verifies the ledger and refuses live,
  // foreign, malformed, or unknown owner states; it is not a JSON authority.
  const lease = await acquireWorkspaceWriteLease(stableInput.workspaceRoot);
  try {
    await lease.assertOwned();
    return await lease.retireOwnedNamespace(stableInput.intentDigest, stableInput.proofParent);
  } finally {
    await lease.release().catch(() => undefined);
  }
}

export function completeWorkspaceWriteLeaseRetirement(input: {
  readonly workspaceRoot: string;
  readonly receipt: WorkspaceWriteLeaseRetirementReceipt;
}): void {
  // Normal callers complete before deleting their root; closeout deliberately
  // completes the external fence after durable absence readback.  In that
  // terminal shape the root cannot be reopened, so validate the receipt and
  // retained same-parent fence directly, while requiring literal ENOENT for
  // the former root.  Any reappearance remains a hard failure.
  let validated: Readonly<{ parent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity; entry: import('../runtime-state/physical/runtime/physical-no-follow.ts').NoFollowDirectoryTreeEntry }>;
  const presence = inspectExactNoFollowDirectoryPresence(input.workspaceRoot, 'Workspace lease retirement completion workspace');
  if (presence.state === 'present') {
    validated = assertWorkspaceWriteLeaseRetirement(input);
  } else {
    const receipt = validateRetirementReceipt(input.receipt);
    const parent = inspectNoFollowDirectoryChain(retirementFenceParent(input.workspaceRoot), 'Workspace lease retirement completion parent').target;
    const entry = inspectNoFollowOrdinaryFileEntry(parent, receipt.fenceName);
    if (entry === null) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement completion fence is absent');
    if (entry.kind !== 'file' || entry.bytes === null) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement completion fence changed');
    }
    const bytes = entry.bytes;
    let current: unknown;
    try { current = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown; } catch {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement completion fence is malformed');
    }
    const currentReceipt = validateRetirementReceipt(current);
    if (!canonicalEquals(currentReceipt, receipt)) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement completion fence differs from receipt');
    validated = Object.freeze({ parent, entry });
  }
  deleteRetainedNoFollowEntry({
    root: validated.parent, relativePath: validated.entry.relativePath, kind: 'file',
    device: validated.entry.device, inode: validated.entry.inode, ancestorDirectories: []
  });
}

async function ensureProtocolRoot(
  paths: WorkspaceWriteLeasePaths,
  executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary'],
  createId: () => string
): Promise<void> {
  try {
    await fs.mkdir(paths.root);
  } catch (error) {
    if (!isExistsError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease protocol root could not be created'
      );
    }
  }

  let rootMetadata;
  try {
    rootMetadata = await fs.lstat(paths.root);
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol root could not be inspected'
    );
  }
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol root is incompatible'
    );
  }
  await assertNoLegacyOwner(paths.root);

  try {
    await fs.mkdir(paths.holders);
  } catch (error) {
    if (!isExistsError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease holder root could not be created'
      );
    }
  }
  await assertProtocolDirectory(paths.parent, paths.root, paths.holders, executionBoundary);

  const protocolPath = path.join(paths.root, PROTOCOL_FILE);
  const protocol = Object.freeze({ formatVersion: WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION });
  await publishImmutableJsonNoReplace(
    paths.holders,
    paths.root,
    protocolPath,
    'protocol',
    protocol,
    createId
  );
  await convergeProtocolMarkerAlias(paths, protocolPath);
  await verifyProtocolRoot(paths, executionBoundary);
}

async function convergeProtocolMarkerAlias(
  paths: WorkspaceWriteLeasePaths,
  protocolPath: string
): Promise<void> {
  const inspected = await inspectProtocolMarkerAlias(paths, protocolPath);
  if (inspected.alias === null) return;
  const initialMarker = inspected.marker;
  const initialAlias = inspected.alias;
  await assertProtocolMarker(protocolPath);
  let markerBeforeUnlink;
  let aliasBeforeUnlink;
  try {
    [markerBeforeUnlink, aliasBeforeUnlink] = await Promise.all([
      fs.lstat(protocolPath, { bigint: true }),
      fs.lstat(initialAlias.path, { bigint: true })
    ]);
  } catch (error) {
    if (isMissingError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease protocol alias topology changed before recovery'
      );
    }
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol alias could not be re-inspected'
    );
  }
  if (!markerBeforeUnlink.isFile() || markerBeforeUnlink.isSymbolicLink() ||
    !aliasBeforeUnlink.isFile() || aliasBeforeUnlink.isSymbolicLink() ||
    markerBeforeUnlink.nlink !== 2n || aliasBeforeUnlink.nlink !== 2n ||
    !sameFileIdentity(markerBeforeUnlink, initialMarker) ||
    !sameFileIdentity(aliasBeforeUnlink, initialMarker)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol alias identity changed before recovery'
    );
  }

  try {
    await fs.unlink(initialAlias.path);
  } catch (error) {
    if (isMissingError(error)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease protocol alias changed during recovery'
      );
    }
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol alias could not be removed'
    );
  }
  try {
    await fsyncDirectory(paths.holders);
    await fsyncDirectory(paths.root);
  } catch {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-004',
      'Workspace writer lease protocol alias recovery could not be persisted'
    );
  }

  const finalMarker = await readProtocolMarkerMetadata(protocolPath);
  if (finalMarker.nlink !== 1n || !sameFileIdentity(finalMarker, initialMarker)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease protocol marker did not converge'
    );
  }
}

async function prepareLease(
  paths: WorkspaceWriteLeasePaths,
  workspaceIdentityDigest: string,
  generation: number,
  leaseId: string,
  hostname: string,
  pid: number,
  processNonce: string,
  timestamp: number
): Promise<PreparedWorkspaceWriteLease> {
  const provisional = { generation, leaseId };
  const holder = holderDirectory(paths.holders, provisional);
  await fs.mkdir(holder);
  const ownerPath = path.join(holder, OWNER_FILE);
  let ownerHandle;
  try {
    ownerHandle = await fs.open(ownerPath, 'wx');
    const ownerMetadata = await ownerHandle.stat({ bigint: true });
    const token: WorkspaceWriteLeaseToken = Object.freeze({
      formatVersion: WORKSPACE_WRITE_LEASE_TOKEN_VERSION,
      workspaceIdentityDigest,
      generation,
      ownerFileIdentityDigest: ownerFileIdentity(ownerMetadata),
      hostname,
      pid,
      processNonce,
      leaseId
    });
    const owner: WorkspaceWriteLeaseOwner = Object.freeze({ ...token, createdAtMs: timestamp });
    const heartbeat: WorkspaceWriteLeaseHeartbeat = Object.freeze({
      formatVersion: WORKSPACE_WRITE_LEASE_HEARTBEAT_VERSION,
      token,
      heartbeatAtMs: timestamp
    });
    await ownerHandle.writeFile(jsonFile(owner), 'utf8');
    await ownerHandle.sync();
    await ownerHandle.close();
    ownerHandle = undefined;
    const heartbeatHandle = await fs.open(path.join(holder, HEARTBEAT_FILE), 'wx');
    try {
      await heartbeatHandle.writeFile(jsonFile(heartbeat), 'utf8');
      await heartbeatHandle.sync();
    } finally {
      await heartbeatHandle.close();
    }
    await fsyncDirectory(holder);
    await fsyncDirectory(paths.holders);
    return Object.freeze({ holder, ownerPath, owner, token });
  } catch (error) {
    await ownerHandle?.close().catch(() => undefined);
    await fs.rm(holder, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function createWorkspaceWriteLeaseManager(
  options: WorkspaceWriteLeaseManagerOptions = {}
): WorkspaceWriteLeaseManager {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const hostname = options.hostname ?? os.hostname();
  const pid = options.pid ?? process.pid;
  const processNonce = options.processNonce ?? PROCESS_NONCE;
  const nowCapability = options.now ?? Date.now;
  const createIdCapability = options.createId ?? randomUUID;
  const createId = (): string => {
    let value: unknown;
    try {
      value = createIdCapability();
    } catch (error) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease identity generation failed',
        { systemCode: acquisitionSystemCode(error) ?? 'UNKNOWN' }
      );
    }
    if (!nonEmpty(value) || value.length > MAX_LEASE_ID_LENGTH) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease identity generation returned an invalid value'
      );
    }
    return value;
  };
  const ownerPublicationDirectorySync =
    options.ownerPublicationDirectorySync ?? fsyncDirectory;
  const controlPlaneTails = new Map<string, Promise<void>>();
  const activeLeaseKeys = new Set<string>();
  const activeLeaseBoundaries = new Map<
    string,
    WorkspaceWriteLeaseAcquireOptions['executionBoundary']
  >();
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1 ||
    !Number.isSafeInteger(staleAfterMs) || staleAfterMs <= heartbeatIntervalMs ||
    !nonEmpty(hostname) || !safeInteger(pid) || !nonEmpty(processNonce)) {
    throw new Error('Workspace write lease manager options are invalid');
  }
  const currentTime = (): number => {
    let value: number;
    try {
      value = nowCapability();
    } catch (error) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease clock observation failed',
        { systemCode: acquisitionSystemCode(error) ?? 'UNKNOWN' }
      );
    }
    if (!safeInteger(value)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        'Workspace writer lease clock is invalid'
      );
    }
    return value;
  };

  const pathsFor = workspaceWriteLeasePathsFor;

  const assertManagerHolder = (token: WorkspaceWriteLeaseToken): void => {
    if (token.hostname !== hostname || token.pid !== pid || token.processNonce !== processNonce) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token belongs to a different process holder'
      );
    }
  };

  const tokenKey = (token: WorkspaceWriteLeaseToken): string => JSON.stringify(token);

  const assertActiveLease = (token: WorkspaceWriteLeaseToken): void => {
    assertManagerHolder(token);
    if (!activeLeaseKeys.has(tokenKey(token))) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token is not active in this manager'
      );
    }
  };

  const withControlPlaneLock = async <Value>(
    token: WorkspaceWriteLeaseToken,
    execute: () => Promise<Value>
  ): Promise<Value> => {
    const key = tokenKey(token);
    const previous = controlPlaneTails.get(key) ?? Promise.resolve();
    let releaseGate: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const current = previous.then(() => gate);
    controlPlaneTails.set(key, current);
    await previous;
    try {
      return await execute();
    } finally {
      releaseGate?.();
      if (controlPlaneTails.get(key) === current) controlPlaneTails.delete(key);
    }
  };

  const ensureRoot = async (
    workspaceRoot: string,
    executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary']
  ): Promise<WorkspaceWriteLeasePaths> => {
    const paths = pathsFor(workspaceRoot);
    await ensureDir(paths.parent);
    await assertLeaseParent(workspaceRoot, paths.parent, executionBoundary);
    await ensureProtocolRoot(paths, executionBoundary, createId);
    return paths;
  };

  const assertOwnedNative = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken,
    executionBoundary: WorkspaceWriteLeaseAcquireOptions['executionBoundary'] =
      activeLeaseBoundaries.get(tokenKey(token))
  ): Promise<void> => {
    if (!tokenLooksValid(token)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token is invalid'
      );
    }
    const expectedWorkspace = await workspaceIdentity(workspaceRoot, executionBoundary).catch(() => '');
    if (expectedWorkspace !== token.workspaceIdentityDigest) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token targets a different workspace'
      );
    }
    const paths = pathsFor(workspaceRoot);
    await assertLeaseParent(workspaceRoot, paths.parent, executionBoundary);
    await verifyProtocolRoot(paths, executionBoundary);
    const firstInventory = await readInventory(paths.root);
    if (firstInventory.highestGeneration !== token.generation ||
      firstInventory.terminalGenerations.has(token.generation)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token is not the active generation'
      );
    }
    const state = await readGenerationState(paths.root, token.generation);
    if (!sameToken(tokenFromOwner(state.owner), token) ||
      state.ownerFileIdentityDigest !== token.ownerFileIdentityDigest ||
      state.ownerLinkCount !== 2 || state.terminal) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease token no longer owns the active generation'
      );
    }
    await readBoundHeartbeat(paths, state);
    const finalInventory = await readInventory(paths.root);
    if (finalInventory.highestGeneration !== token.generation ||
      finalInventory.terminalGenerations.has(token.generation)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease generation changed during ownership proof'
      );
    }
  };

  const assertOwned = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    try {
      await assertOwnedNative(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease ownership could not be proven'
      );
    }
  };

  const heartbeatNative = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    let phase = 'ownership-before';
    try {
      await assertOwned(workspaceRoot, token);
      const paths = pathsFor(workspaceRoot);
      phase = 'generation-state';
      const state = await readGenerationState(paths.root, token.generation);
      phase = 'heartbeat-read';
      const previous = await readBoundHeartbeat(paths, state);
      const updated: WorkspaceWriteLeaseHeartbeat = Object.freeze({
        ...previous,
        heartbeatAtMs: Math.max(previous.heartbeatAtMs, currentTime())
      });
      phase = 'heartbeat-publish';
      await replaceHeartbeat(
        holderDirectory(paths.holders, token),
        updated,
        createId,
        () => assertOwned(workspaceRoot, token),
        Math.min(heartbeatIntervalMs, staleAfterMs - heartbeatIntervalMs) / 2
      );
      phase = 'ownership-after';
      await assertOwned(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease heartbeat failed',
        { operation: 'heartbeat', phase, systemCode: systemErrorCode(error) ?? 'UNKNOWN' }
      );
    }
  };

  const heartbeat = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    try {
      assertActiveLease(token);
      await withControlPlaneLock(token, () => heartbeatNative(workspaceRoot, token));
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease heartbeat failed'
      );
    }
  };

  const assertCanonicalControlPlane = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    try {
      await assertOwned(workspaceRoot, token);
      const paths = pathsFor(workspaceRoot);
      const holder = holderDirectory(paths.holders, token);
      const [protocolMetadata, ownerMetadata, heartbeatMetadata, children] = await Promise.all([
        fs.lstat(path.join(paths.root, PROTOCOL_FILE), { bigint: true }),
        fs.lstat(path.join(holder, OWNER_FILE), { bigint: true }),
        fs.lstat(path.join(holder, HEARTBEAT_FILE), { bigint: true }),
        fs.readdir(holder)
      ]);
      if (!protocolMetadata.isFile() || protocolMetadata.isSymbolicLink() ||
        Number(protocolMetadata.nlink) !== 1 ||
        !ownerMetadata.isFile() || ownerMetadata.isSymbolicLink() ||
        Number(ownerMetadata.nlink) !== 2 ||
        !heartbeatMetadata.isFile() || heartbeatMetadata.isSymbolicLink() ||
        Number(heartbeatMetadata.nlink) !== 1 ||
        !canonicalEquals(children.sort(), [HEARTBEAT_FILE, OWNER_FILE].sort())) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-002',
          'Workspace writer lease control plane is not canonical'
        );
      }
      await assertOwned(workspaceRoot, token);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease control plane could not be proven'
      );
    }
  };

  const withControlPlaneQuiesced = async <Value>(
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken,
    execute: () => Promise<Value>
  ): Promise<Value> => {
    assertActiveLease(token);
    return withControlPlaneLock(token, async () => {
      await assertCanonicalControlPlane(workspaceRoot, token);
      try {
        const result = await execute();
        await assertCanonicalControlPlane(workspaceRoot, token);
        return result;
      } catch (error) {
        try { await assertCanonicalControlPlane(workspaceRoot, token); }
        catch (settlement) {
          throw new ResourceCompositeSettlementError([
            { label: 'workspace-write-lease-quiesced-operation', error },
            { label: 'workspace-write-lease-control-plane-readback', error: settlement }
          ]);
        }
        throw error;
      }
    });
  };

  const publishTerminal = async (
    paths: WorkspaceWriteLeasePaths,
    token: WorkspaceWriteLeaseToken,
    outcome: WorkspaceWriteLeaseTerminal['outcome']
  ): Promise<void> => {
    const terminal: WorkspaceWriteLeaseTerminal = Object.freeze({
      formatVersion: WORKSPACE_WRITE_LEASE_TERMINAL_VERSION,
      token,
      outcome,
      terminalAtMs: currentTime()
    });
    const target = generationTerminalPath(paths.root, token.generation);
    const published = await publishImmutableJsonNoReplace(
      paths.holders,
      paths.root,
      target,
      'terminal',
      terminal,
      createId
    );
    if (!published) {
      const existing = await readOptionalTerminal(target);
      if (!existing || !sameToken(existing.token, token)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-003',
          'Workspace writer lease terminal identity conflicts with its generation'
        );
      }
    }
    await fs.rm(holderDirectory(paths.holders, token), { recursive: true, force: true })
      .catch(() => undefined);
    await fsyncDirectory(paths.holders).catch(() => undefined);
  };

  const terminalizeStaleGeneration = async (
    paths: WorkspaceWriteLeasePaths,
    generation: number
  ): Promise<boolean> => {
    const initialInventory = await readInventory(paths.root);
    if (initialInventory.highestGeneration !== generation) return true;
    if (initialInventory.terminalGenerations.has(generation)) return true;
    const initialState = await readGenerationState(paths.root, generation);
    if (initialState.terminal) return true;
    const initialHeartbeat = await readBoundHeartbeatUnlessTerminalized(paths, initialState);
    if (!initialHeartbeat) return true;
    if (initialState.owner.hostname !== hostname) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Foreign workspace writer lease cannot be reclaimed automatically'
      );
    }
    const age = currentTime() - initialHeartbeat.heartbeatAtMs;
    if (age <= staleAfterMs) return false;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease predecessor process/effect settlement is unproven; legacy state is preserved',
      { phase: 'legacy-recovery', reason: 'effect-quiescence-unproven' }
    );
  };

  const reclaimTerminalHolderResidue = async (
    paths: WorkspaceWriteLeasePaths,
    generation: number,
    receipt?: WorkspaceWriteLeaseRetirementReceipt
  ): Promise<boolean> => {
    const initialInventory = await readInventory(paths.root);
    if (initialInventory.highestGeneration !== generation ||
      !initialInventory.terminalGenerations.has(generation)) return false;
    const initialState = await readGenerationState(paths.root, generation);
    const token = tokenFromOwner(initialState.owner);
    if (initialState.terminal === null || (receipt !== undefined && (
      receipt.tokenGeneration !== generation ||
      initialState.ownerFileIdentityDigest !== receipt.ownerFileIdentityDigest ||
      retirementTerminalTokenDigest(token) !== receipt.terminalDigest
    ))) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Workspace writer lease retirement terminal holder does not bind its recovery receipt'
      );
    }
    const holder = holderDirectory(paths.holders, token);
    let initialHeartbeat: WorkspaceWriteLeaseHeartbeat;
    try {
      initialHeartbeat = await readBoundHeartbeat(paths, initialState);
    } catch (error) {
      try { await fs.lstat(holder); } catch (presenceError) {
        if (isMissingError(presenceError)) return true;
        throw presenceError;
      }
      throw error;
    }
    if (initialState.owner.hostname !== hostname) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-003',
        'Foreign workspace writer lease terminal holder cannot be reclaimed automatically'
      );
    }
    if (currentTime() - initialHeartbeat.heartbeatAtMs <= staleAfterMs) return false;
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-003',
      'Workspace writer lease terminal holder has no qualified process/effect settlement; residue is preserved',
      { phase: 'terminal-holder-recovery', reason: 'effect-quiescence-unproven' }
    );
  };

  const acquireNative = async (
    workspaceRoot: string,
    acquireOptions: WorkspaceWriteLeaseAcquireOptions
  ): Promise<WorkspaceWriteLeaseHandle> => {
    const executionBoundary = acquireOptions.executionBoundary;
    const workspaceIdentityDigest = await workspaceIdentity(workspaceRoot, executionBoundary).catch(
      (error: unknown) => {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace identity could not be proven',
          {
            operation: 'acquire',
            phase: 'workspace-identity',
            reason: workspaceIdentityFailureReason(error),
            systemCode: acquisitionSystemCode(error) ?? 'UNKNOWN'
          }
        );
      }
    );
    let fenceParent: PhysicalDirectoryIdentity;
    let retirementFenceBytes: Uint8Array | null;
    try {
      fenceParent = inspectNoFollowDirectoryChain(retirementFenceParent(workspaceRoot), 'Workspace writer lease fence parent').target;
      retirementFenceBytes = readNoFollowOrdinaryFile(fenceParent, retirementFenceName(workspaceIdentityDigest));
    } catch (error) {
      throw acquisitionPhaseFailure(
        'retirement-fence-observation',
        error,
        'Workspace writer lease retirement fence could not be observed'
      );
    }
    const recoveryReceipt = (acquireOptions as InternalWorkspaceWriteLeaseAcquireOptions)[RETIREMENT_RECOVERY_ACQUIRE];
    if (retirementFenceBytes !== null) {
      let observed: WorkspaceWriteLeaseRetirementReceipt | null = null;
      try { observed = validateRetirementReceipt(JSON.parse(Buffer.from(retirementFenceBytes).toString('utf8')) as unknown); } catch { /* ordinary acquisition fails below */ }
      if (recoveryReceipt === undefined || observed === null ||
        observed.retirementDigest !== recoveryReceipt.retirementDigest ||
        observed.workspaceIdentityDigest !== workspaceIdentityDigest || !canonicalEquals(observed, recoveryReceipt)) {
        throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease identity is terminally retired');
      }
    }
    let paths: WorkspaceWriteLeasePaths;
    try {
      paths = await ensureRoot(workspaceRoot, executionBoundary);
    } catch (error) {
      throw acquisitionPhaseFailure(
        'lease-root-initialization',
        error,
        'Workspace writer lease root could not be initialized'
      );
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      let inventory: WorkspaceWriteLeaseInventory;
      try {
        inventory = await readInventory(paths.root);
      } catch (error) {
        throw acquisitionPhaseFailure(
          'lease-inventory',
          error,
          'Workspace writer lease inventory could not be observed'
        );
      }
      if (recoveryReceipt !== undefined && inventory.highestGeneration !== recoveryReceipt.tokenGeneration) {
        throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement recovery generation changed');
      }
      if (inventory.highestGeneration !== undefined) {
        if (inventory.terminalGenerations.has(inventory.highestGeneration)) {
          const reclaimed = await reclaimTerminalHolderResidue(
            paths,
            inventory.highestGeneration,
            recoveryReceipt
          );
          if (reclaimed && recoveryReceipt !== undefined) {
            throw new WorkspaceWriteLeaseRetirementRecoveryReady(recoveryReceipt);
          }
          if (!reclaimed) {
            throw new WorkspaceWriteLeaseError(
              'WORKSPACE-WRITE-LEASE-001',
              'Workspace writer lease terminal holder is still live',
              { retryable: true }
            );
          }
        }
        if (recoveryReceipt !== undefined && inventory.terminalGenerations.has(recoveryReceipt.tokenGeneration)) {
          // The branch above either converged this exact highest generation or
          // failed closed.  Reaching here means the inventory changed and must
          // be re-read on the next bounded attempt.
          continue;
        }
        const highestState = await readGenerationState(paths.root, inventory.highestGeneration);
        if (!highestState.terminal) {
          const reclaimed = await terminalizeStaleGeneration(paths, inventory.highestGeneration);
          if (reclaimed) {
            if (recoveryReceipt !== undefined && inventory.highestGeneration === recoveryReceipt.tokenGeneration) {
              throw new WorkspaceWriteLeaseRetirementRecoveryReady(recoveryReceipt);
            }
            continue;
          }
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-001',
            'Workspace writer lease is already held',
            { retryable: true }
          );
        }
      }

      const generation = (inventory.highestGeneration ?? 0) + 1;
      if (!Number.isSafeInteger(generation)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease generation space is exhausted'
        );
      }
      let leaseId: string;
      try {
        leaseId = createId();
      } catch (error) {
        throw acquisitionPhaseFailure(
          'owner-preparation',
          error,
          'Workspace writer lease owner preparation failed'
        );
      }
      let timestamp: number;
      try {
        timestamp = currentTime();
      } catch (error) {
        throw acquisitionPhaseFailure(
          'acquisition-clock',
          error,
          'Workspace writer lease acquisition clock failed'
        );
      }
      if (!nonEmpty(leaseId)) {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease id is invalid'
        );
      }
      let prepared: PreparedWorkspaceWriteLease;
      try {
        prepared = await prepareLease(
          paths,
          workspaceIdentityDigest,
          generation,
          leaseId,
          hostname,
          pid,
          processNonce,
          timestamp
        );
      } catch (error) {
        if (isExistsError(error)) continue;
        throw acquisitionPhaseFailure(
          'owner-preparation',
          error,
          'Workspace writer lease owner preparation failed'
        );
      }

      let ownerPublication: ImmutablePublicationOutcome;
      try {
        ownerPublication = await linkImmutableCandidateNoReplace(
          prepared.ownerPath,
          paths.root,
          generationOwnerPath(paths.root, generation),
          ownerPublicationDirectorySync
        );
      } catch (error) {
        throw acquisitionPhaseFailure(
          'owner-publication',
          error,
          'Workspace writer lease owner publication failed'
        );
      }
      if (ownerPublication.state === 'not-published') {
        await fs.rm(prepared.holder, { recursive: true, force: true }).catch(() => undefined);
        await fsyncDirectory(paths.holders).catch(() => undefined);
        if (ownerPublication.reason === 'target-exists') continue;
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease owner publication failed before target creation',
          {
            operation: 'acquire',
            phase: 'owner-publication',
            systemCode: ownerPublication.systemCode,
            reason: 'publication-not-created',
            retryable: false
          }
        );
      }
      if (ownerPublication.state === 'durability-unknown') {
        throw new WorkspaceWriteLeaseError(
          'WORKSPACE-WRITE-LEASE-004',
          'Workspace writer lease owner publication durability is unknown',
          {
            operation: 'acquire',
            phase: 'owner-publication',
            systemCode: ownerPublication.systemCode,
            reason: 'publication-durability-unknown',
            retryable: true
          }
        );
      }

      const token = prepared.token;
      try {
        await assertOwnedNative(workspaceRoot, token, executionBoundary);
      } catch (error) {
        await publishTerminal(paths, token, 'released').catch(() => undefined);
        throw error;
      }

      let released = false;
      let closing = false;
      let heartbeatFailure: Readonly<{ error: unknown }> | undefined;
      let heartbeatPending: Promise<void> | undefined;
      let currentWorkspaceRoot = workspaceRoot;
      const requestHeartbeat = (): Promise<void> => {
        if (closing || released) {
          return Promise.reject(new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            released
              ? 'Workspace writer lease handle is released'
              : 'Workspace writer lease handle is closing'
          ));
        }
        if (heartbeatPending) return heartbeatPending;
        const pending = heartbeat(currentWorkspaceRoot, token);
        heartbeatPending = pending;
        const clearPending = (): void => {
          if (heartbeatPending === pending) heartbeatPending = undefined;
        };
        void pending.then(clearPending, clearPending);
        return pending;
      };
      activeLeaseKeys.add(tokenKey(token));
      activeLeaseBoundaries.set(tokenKey(token), executionBoundary);
      const timer = setInterval(() => {
        void requestHeartbeat().catch((error) => {
          if (heartbeatFailure === undefined) heartbeatFailure = Object.freeze({ error });
        });
      }, heartbeatIntervalMs);
      timer.unref?.();

      const assertHandleOpen = (): void => {
        if (released) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease handle is released'
          );
        }
        if (closing) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease handle is closing'
          );
        }
      };
      const closeHeartbeatAdmission = (): void => {
        closing = true;
        clearInterval(timer);
      };
      const drainHeartbeat = async (): Promise<void> => {
        const pending = heartbeatPending;
        if (pending !== undefined) {
          try {
            await pending;
          } catch (error) {
            if (heartbeatFailure === undefined) heartbeatFailure = Object.freeze({ error });
          }
        }
        if (heartbeatFailure !== undefined) throw heartbeatFailure.error;
      };

      const assertHandle = async (): Promise<void> => {
        assertHandleOpen();
        if (heartbeatFailure !== undefined) throw heartbeatFailure.error;
        await assertOwned(currentWorkspaceRoot, token);
      };
      const relocateHandle = async (nextWorkspaceRoot: string): Promise<void> => {
        assertHandleOpen();
        if (heartbeatFailure !== undefined) throw heartbeatFailure.error;
        const next = path.resolve(nextWorkspaceRoot);
        // Physical v2 identity deliberately excludes lexical spelling, but
        // this equality check proves the new root is the exact token resource.
        const nextIdentity = await workspaceIdentity(next, executionBoundary).catch(() => '');
        if (nextIdentity !== token.workspaceIdentityDigest) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002', 'Workspace writer lease relocation targets a different physical directory'
          );
        }
        await assertOwned(next, token);
        currentWorkspaceRoot = next;
        await assertOwned(currentWorkspaceRoot, token);
      };
      const ownedNamespace = async (): Promise<Readonly<{ workspaceRoot: string; relativePath: '.sec/workspace-write-lease' }>> => {
        await assertHandle();
        return Object.freeze({ workspaceRoot: currentWorkspaceRoot, relativePath: '.sec/workspace-write-lease' as const });
      };
      const retireOwnedNamespace = async (intentDigest: string, suppliedProofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity): Promise<WorkspaceWriteLeaseRetirementReceipt> => {
        await assertHandle();
        if (!/^sha256:[0-9a-f]{64}$/u.test(intentDigest)) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement intent digest is invalid');
        closeHeartbeatAdmission();
        await drainHeartbeat();
        return withControlPlaneLock(token, async () => {
          await assertOwned(currentWorkspaceRoot, token);
          const paths = pathsFor(currentWorkspaceRoot);
          const namespace = inspectNoFollowDirectoryChain(paths.root, 'Workspace lease retirement namespace').target;
          // Heartbeat admission was closed and every admitted heartbeat was
          // drained before entering the retirement control-plane mutation.
          // No later heartbeat can mutate this generation while the namespace
          // census, fence, terminal publication and relocation are performed.
          let entries = scanNoFollowDirectoryTree(namespace);
          const known = (relativePath: string): boolean => relativePath === PROTOCOL_FILE ||
            relativePath === HOLDERS_DIRECTORY || relativePath.startsWith(`${HOLDERS_DIRECTORY}/`) ||
            OWNER_GENERATION_PATTERN.test(relativePath) || TERMINAL_GENERATION_PATTERN.test(relativePath);
          if (entries.some((entry) => !known(entry.relativePath))) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement found non-owned namespace content');
          }
          const workspace = inspectNoFollowDirectoryChain(currentWorkspaceRoot, 'Workspace lease retirement workspace').target;
          const fenceParent = inspectNoFollowDirectoryChain(
            retirementFenceParent(currentWorkspaceRoot), 'Workspace lease retirement fence parent'
          ).target;
          const proofParent = assertSameNoFollowDirectoryIdentity(suppliedProofParent, 'Workspace lease retirement proof parent').target;
          const transition = createRetirementTransition({
            workspaceIdentityDigest: token.workspaceIdentityDigest,
            workspaceDevice: workspace.device,
            workspaceInode: workspace.inode,
            intentDigest,
            token,
            namespaceDevice: namespace.device,
            namespaceInode: namespace.inode,
            namespaceTombstoneParentDevice: proofParent.device,
            namespaceTombstoneParentInode: proofParent.inode,
            namespaceEntries: transitionEntries(entries)
          });
          publishExclusiveDurableCanonicalFile({
            // The transition belongs beside the retained relocated namespace
            // in the target-external operation root.  The target parent only
            // holds the physical fence; deleting the target may never delete
            // the owner/terminal proof required for a later convergence.
            parent: proofParent, name: retirementTransitionName(transition.transitionDigest),
            bytes: Buffer.from(`${JSON.stringify(transition)}\n`, 'utf8'),
            validate: (bytes) => {
              const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as WorkspaceWriteLeaseRetirementTransition;
              if (parsed.transitionDigest !== transition.transitionDigest || !canonicalEquals(parsed, transition)) throw new Error('invalid retirement transition');
            }
          });
          const material = {
            formatVersion: 'workspace-write-lease-retirement-receipt-v1' as const,
            workspaceIdentityDigest: token.workspaceIdentityDigest,
            workspaceDevice: workspace.device,
            workspaceInode: workspace.inode,
            intentDigest,
            tokenGeneration: token.generation,
            ownerFileIdentityDigest: token.ownerFileIdentityDigest,
            // The fence must exist before terminal publication opens the next
            // generation.  Bind the immutable token identity here; recovery
            // later requires the exact retained owner/terminal pair and does
            // not treat this public digest as an issuer credential.
            terminalDigest: retirementTerminalTokenDigest(token),
            transitionDigest: transition.transitionDigest,
            namespaceDevice: namespace.device,
            namespaceInode: namespace.inode,
            namespaceTombstoneName: namespaceTombstoneName(transition.transitionDigest),
            fenceName: retirementFenceName(token.workspaceIdentityDigest)
          };
          const receipt: WorkspaceWriteLeaseRetirementReceipt = Object.freeze({ ...material, retirementDigest: sha256(material) });
          publishExclusiveDurableCanonicalFile({
            parent: fenceParent, name: receipt.fenceName, bytes: Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'),
            validate: (bytes) => {
              const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as WorkspaceWriteLeaseRetirementReceipt;
              if (parsed.retirementDigest !== receipt.retirementDigest) throw new Error('invalid retirement fence');
            }
          });
          // The acquisition-visible fence is durable before this checkpoint.
          // A real process death can therefore never expose a terminalized
          // generation without also preventing a successor acquisition.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await publishTerminal(paths, token, 'released');
          const terminal = await readOptionalTerminal(generationTerminalPath(paths.root, token.generation));
          if (terminal === null || !sameToken(terminal.token, token)) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement terminal publication is unavailable');
          }
          // Terminal publication removes the active holder directory. Refresh
          // the retained inventory before deleting the remaining canonical
          // ledger, otherwise stale child entries would be used as authority.
          entries = scanNoFollowDirectoryTree(namespace);
          if (entries.some((entry) => entry.relativePath.startsWith(`${HOLDERS_DIRECTORY}/`))) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement holder namespace remains after terminal publication');
          }
          const movedNamespace = relocateRetainedNoFollowDirectoryAcrossParents({
            directory: namespace, destinationParent: proofParent,
            tombstoneName: receipt.namespaceTombstoneName
          });
          if (movedNamespace.device !== receipt.namespaceDevice || movedNamespace.inode !== receipt.namespaceInode) {
            throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement namespace relocation changed identity');
          }
          // Keep the atomically relocated namespace as the retained canonical
          // owner/terminal witness until closeout terminal lifecycle cleanup.
          // It is not a durable-file issuer: recovery may only converge the
          // exact inode moved here by this held token transition.
          clearInterval(timer);
          activeLeaseKeys.delete(tokenKey(token));
          activeLeaseBoundaries.delete(tokenKey(token));
          released = true;
          return receipt;
        });
      };
      const releaseHandle = async (): Promise<void> => {
        if (released) {
          throw new WorkspaceWriteLeaseError(
            'WORKSPACE-WRITE-LEASE-002',
            'Workspace writer lease handle is already released'
          );
        }
        closeHeartbeatAdmission();
        let heartbeatCloseout:
          | Readonly<{ status: 'succeeded' }>
          | Readonly<{ status: 'failed'; error: unknown }> = Object.freeze({ status: 'succeeded' });
        let releaseCloseout:
          | Readonly<{ status: 'succeeded' }>
          | Readonly<{ status: 'failed'; error: unknown }> = Object.freeze({ status: 'succeeded' });
        try {
          await drainHeartbeat();
        } catch (error) {
          heartbeatCloseout = Object.freeze({ status: 'failed', error });
        }
        try {
          await release(currentWorkspaceRoot, token);
          released = true;
        } catch (error) {
          releaseCloseout = Object.freeze({ status: 'failed', error });
        }
        if (heartbeatCloseout.status === 'failed' && releaseCloseout.status === 'failed') {
          throw new ResourceCompositeSettlementError([
            { label: 'workspace-write-lease-heartbeat', error: heartbeatCloseout.error },
            { label: 'workspace-write-lease-release', error: releaseCloseout.error }
          ]);
        }
        if (heartbeatCloseout.status === 'failed') throw heartbeatCloseout.error;
        if (releaseCloseout.status === 'failed') throw releaseCloseout.error;
      };
      return Object.freeze({
        token,
        heartbeat: async () => {
          assertHandleOpen();
          if (heartbeatFailure !== undefined) throw heartbeatFailure.error;
          await requestHeartbeat();
        },
        assertOwned: assertHandle,
        relocate: relocateHandle,
        ownedNamespace,
        retireOwnedNamespace,
        release: releaseHandle
      });
    }
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-001',
      'Workspace writer lease acquisition did not converge',
      { retryable: true }
    );
  };

  const releaseNative = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    assertManagerHolder(token);
    await assertOwned(workspaceRoot, token);
    const paths = pathsFor(workspaceRoot);
    await publishTerminal(paths, token, 'released');
    const terminal = await readOptionalTerminal(generationTerminalPath(paths.root, token.generation));
    if (!terminal || !sameToken(terminal.token, token)) {
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease release terminal could not be proven'
      );
    }
  };

  const release = async (
    workspaceRoot: string,
    token: WorkspaceWriteLeaseToken
  ): Promise<void> => {
    try {
      assertActiveLease(token);
      await withControlPlaneLock(token, () => releaseNative(workspaceRoot, token));
      activeLeaseKeys.delete(tokenKey(token));
      activeLeaseBoundaries.delete(tokenKey(token));
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-002',
        'Workspace writer lease release failed'
      );
    }
  };

  const acquire = async (
    workspaceRoot: string,
    acquireOptions: WorkspaceWriteLeaseAcquireOptions = {}
  ): Promise<WorkspaceWriteLeaseHandle> => {
    try {
      return await acquireNative(workspaceRoot, acquireOptions);
    } catch (error) {
      if (error instanceof WorkspaceWriteLeaseError) throw error;
      throw acquisitionFailure(
        'unclassified',
        error,
        'Workspace writer lease acquisition failed'
      );
    }
  };

  const withLease = async <Value>(
    workspaceRoot: string,
    reentrantToken: WorkspaceWriteLeaseToken | undefined,
    execute: (token: WorkspaceWriteLeaseToken) => Promise<Value>,
    acquireOptions: WorkspaceWriteLeaseAcquireOptions = {}
  ): Promise<Value> => {
    if (reentrantToken) {
      assertActiveLease(reentrantToken);
      await assertOwned(workspaceRoot, reentrantToken);
      return execute(reentrantToken);
    }
    return withAcquiredResource({
      operationLabel: 'workspace-write-lease-operation',
      resourceLabel: 'workspace-write-lease',
      acquire: () => acquire(workspaceRoot, acquireOptions),
      use: (handle) => execute(handle.token),
      release: (handle) => handle.release()
    });
  };

  return Object.freeze({ acquire, assertOwned, release, withControlPlaneQuiesced, withLease });
}

export const workspaceWriteLeaseManager = createWorkspaceWriteLeaseManager();

export const acquireWorkspaceWriteLease = workspaceWriteLeaseManager.acquire;

export const assertWorkspaceWriteLease = workspaceWriteLeaseManager.assertOwned;

export const releaseWorkspaceWriteLease = workspaceWriteLeaseManager.release;

export const withWorkspaceWriteLeaseControlPlaneQuiesced =
  workspaceWriteLeaseManager.withControlPlaneQuiesced;

export const withWorkspaceWriteLease = workspaceWriteLeaseManager.withLease;

export function createWorkspaceWriteCommitFence(
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken
): CommitFence {
  const canonicalWorkspaceRoot = path.resolve(workspaceRoot);
  const commitFence = () => assertWorkspaceWriteLease(canonicalWorkspaceRoot, token);
  workspaceWriteCommitFenceBindings.set(commitFence, Object.freeze({
    workspaceRoot: canonicalWorkspaceRoot,
    token
  }));
  return commitFence;
}

export function isCanonicalWorkspaceWriteCommitFence(
  commitFence: CommitFence,
  workspaceRoot: string,
  token: WorkspaceWriteLeaseToken
): boolean {
  const binding = workspaceWriteCommitFenceBindings.get(commitFence);
  return binding !== undefined &&
    binding.workspaceRoot === path.resolve(workspaceRoot) &&
    binding.token === token;
}

/**
 * Converts one currently-owned workspace lease into the physical executor's
 * single-purpose, process-local AppContainer capability. Workspace admission
 * remains here; the physical substrate never imports or interprets a lease.
 */
export async function issueWindowsAppContainerExecutionCapability(input: {
  readonly workspaceRoot: string;
  readonly stagingRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  readonly deadlineAtUnixMs: number;
  readonly deadlineAtMonotonicMs: number;
}): Promise<WindowsAppContainerExecutionCapability> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const stagingRoot = path.resolve(input.stagingRoot);
  const relativeStagingRoot = path.relative(workspaceRoot, stagingRoot);
  if (
    relativeStagingRoot === ''
    || path.isAbsolute(relativeStagingRoot)
    || relativeStagingRoot === '..'
    || relativeStagingRoot.startsWith(`..${path.sep}`)
  ) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-002',
      'Workspace AppContainer execution root is outside the admitted workspace'
    );
  }
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, input.workspaceWriteLease);
  if (!isCanonicalWorkspaceWriteCommitFence(commitFence, workspaceRoot, input.workspaceWriteLease)) {
    throw new WorkspaceWriteLeaseError(
      'WORKSPACE-WRITE-LEASE-002',
      'Workspace AppContainer execution capability admission is noncanonical'
    );
  }
  await commitFence();
  return issuePhysicalWindowsAppContainerExecutionCapability({
    stagingRoot,
    authorityBindingDigest: input.workspaceWriteLease.workspaceIdentityDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    assertCurrent: commitFence
  });
}
