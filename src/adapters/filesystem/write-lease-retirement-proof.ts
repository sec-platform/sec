import path from 'node:path';
import { canonicalEquals, digest, sha256 } from '../../contracts/canonical.ts';
import { assertSameNoFollowDirectoryIdentity, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, readNoFollowOrdinaryFile, scanNoFollowDirectoryTree, type PhysicalDirectoryIdentity } from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { HOLDERS_DIRECTORY, ownerLooksValid, PROTOCOL_FILE, sameToken, terminalLooksValid, tokenFromOwner, tokenLooksValid, WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION, WorkspaceWriteLeaseError, type WorkspaceWriteLeaseRetirementReceipt, type WorkspaceWriteLeaseToken } from './write-lease-contract.ts';
import { generationOwnerPath, generationTerminalPath, physicalWorkspaceIdentityDigest, workspaceWriteLeasePathsFor } from './write-lease-observation.ts';

/** Retained retirement-proof validation only. Public receipts remain locators:
 * the original lease owner alone performs publication, relocation and cleanup. */

export function retirementFenceName(workspaceIdentityDigest: string): string {
  return `.workspace-write-lease-retired-${digest(workspaceIdentityDigest)}.json`;
}

export interface WorkspaceWriteLeaseRetirementTransition {
  readonly formatVersion: 'workspace-write-lease-retirement-transition-v1';
  readonly workspaceIdentityDigest: string;
  readonly workspaceDevice: string;
  readonly workspaceInode: string;
  readonly intentDigest: string;
  readonly token: WorkspaceWriteLeaseToken;
  readonly namespaceDevice: string;
  readonly namespaceInode: string;
  readonly namespaceTombstoneParentDevice: string;
  readonly namespaceTombstoneParentInode: string;
  readonly namespaceEntries: readonly Readonly<{ relativePath: string; kind: string; device: string; inode: string; size: number; bytes: string | null }>[];
  readonly transitionDigest: string;
}

export function retirementTransitionName(transitionDigest: string): string {
  return `.workspace-write-lease-transition-${transitionDigest.slice('sha256:'.length)}.json`;
}

export function namespaceTombstoneName(transitionDigest: string): string {
  return `workspace-write-lease-retired-namespace-${transitionDigest.slice('sha256:'.length)}`;
}

export function transitionEntries(entries: readonly import('../runtime-state/physical/runtime/physical-no-follow.ts').NoFollowDirectoryTreeEntry[]) {
  return entries.map((entry) => Object.freeze({ relativePath: entry.relativePath, kind: entry.kind, device: entry.device, inode: entry.inode, size: entry.size, bytes: entry.bytes === null ? null : Buffer.from(entry.bytes).toString('hex') }));
}

export function createRetirementTransition(input: Omit<WorkspaceWriteLeaseRetirementTransition, 'formatVersion' | 'transitionDigest'>): WorkspaceWriteLeaseRetirementTransition {
  const material = { formatVersion: 'workspace-write-lease-retirement-transition-v1' as const, ...input };
  return Object.freeze({ ...material, transitionDigest: sha256(material) });
}

const RETIREMENT_TRANSITION_KEYS = [
  'formatVersion', 'workspaceIdentityDigest', 'workspaceDevice', 'workspaceInode',
  'intentDigest', 'token', 'namespaceDevice', 'namespaceInode',
  'namespaceTombstoneParentDevice', 'namespaceTombstoneParentInode',
  'namespaceEntries', 'transitionDigest'
] as const;

const RETIREMENT_TRANSITION_ENTRY_KEYS = [
  'relativePath', 'kind', 'device', 'inode', 'size', 'bytes'
] as const;

export function validateRetirementTransition(value: unknown): WorkspaceWriteLeaseRetirementTransition {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !hasExactKeys(value, RETIREMENT_TRANSITION_KEYS)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition has an invalid schema');
  }
  const candidate = value as WorkspaceWriteLeaseRetirementTransition;
  if (candidate.formatVersion !== 'workspace-write-lease-retirement-transition-v1' ||
    !tokenLooksValid(candidate.token) || !/^sha256:[0-9a-f]{64}$/u.test(candidate.intentDigest) ||
    !/^sha256:[0-9a-f]{64}$/u.test(candidate.transitionDigest) ||
    !Array.isArray(candidate.namespaceEntries) || candidate.namespaceEntries.some((entry) =>
      !entry || typeof entry !== 'object' || Array.isArray(entry) ||
      !hasExactKeys(entry, RETIREMENT_TRANSITION_ENTRY_KEYS) ||
      typeof entry.relativePath !== 'string' || typeof entry.kind !== 'string' ||
      typeof entry.device !== 'string' || typeof entry.inode !== 'string' ||
      !Number.isSafeInteger(entry.size) || entry.size < 0 ||
      (entry.bytes !== null && (typeof entry.bytes !== 'string' || !/^(?:[0-9a-f]{2})*$/u.test(entry.bytes)))) ||
    typeof candidate.workspaceIdentityDigest !== 'string' ||
    typeof candidate.workspaceDevice !== 'string' || typeof candidate.workspaceInode !== 'string' ||
    typeof candidate.namespaceDevice !== 'string' || typeof candidate.namespaceInode !== 'string' ||
    typeof candidate.namespaceTombstoneParentDevice !== 'string' || typeof candidate.namespaceTombstoneParentInode !== 'string') {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition is invalid');
  }
  const { formatVersion: _format, transitionDigest: _digest, ...material } = candidate;
  const rebuilt = createRetirementTransition(material);
  if (!canonicalEquals(candidate, rebuilt)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition digest is invalid');
  }
  return rebuilt;
}

export function retirementFenceParent(workspaceRoot: string): string {
  return path.dirname(path.resolve(workspaceRoot));
}

export type WorkspaceWriteLeaseRetirementRecoveryInput = Readonly<{
  workspaceRoot: string;
  intentDigest: string;
  proofParent: PhysicalDirectoryIdentity;
}>;

export function snapshotRetirementRecoveryInput(input: WorkspaceWriteLeaseRetirementRecoveryInput): WorkspaceWriteLeaseRetirementRecoveryInput {
  let workspaceRoot: unknown;
  let intentDigest: unknown;
  let suppliedProofParent: unknown;
  try {
    workspaceRoot = input.workspaceRoot;
    intentDigest = input.intentDigest;
    suppliedProofParent = input.proofParent;
  } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery input cannot be observed');
  }
  if (typeof workspaceRoot !== 'string' || typeof intentDigest !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(intentDigest) || suppliedProofParent === null ||
    typeof suppliedProofParent !== 'object' || Array.isArray(suppliedProofParent)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery input is invalid');
  }
  let proofParent: PhysicalDirectoryIdentity;
  try {
    const candidate = suppliedProofParent as Partial<PhysicalDirectoryIdentity>;
    const snapshot = Object.freeze({
      path: candidate.path,
      finalPath: candidate.finalPath,
      device: candidate.device,
      inode: candidate.inode,
      objectId: candidate.objectId
    });
    if (typeof snapshot.path !== 'string' ||
      typeof snapshot.finalPath !== 'string' || typeof snapshot.device !== 'string' ||
      typeof snapshot.inode !== 'string' || typeof snapshot.objectId !== 'string') {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery proof parent is invalid');
    }
    proofParent = assertSameNoFollowDirectoryIdentity(snapshot as PhysicalDirectoryIdentity, 'Workspace lease retirement recovery proof parent').target;
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) throw error;
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease recovery proof parent cannot be observed');
  }
  return Object.freeze({ workspaceRoot: path.resolve(workspaceRoot), intentDigest, proofParent });
}

export function retirementTerminalTokenDigest(token: WorkspaceWriteLeaseToken): string {
  return sha256({ domain: 'workspace-write-lease-retirement-terminal-token-v1', token });
}

const RETIREMENT_RECEIPT_KEYS = [
  'formatVersion', 'workspaceIdentityDigest', 'workspaceDevice', 'workspaceInode',
  'intentDigest', 'tokenGeneration', 'ownerFileIdentityDigest', 'terminalDigest', 'transitionDigest', 'namespaceDevice', 'namespaceInode', 'namespaceTombstoneName', 'fenceName', 'retirementDigest'
] as const;

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

export function validateRetirementReceipt(receipt: unknown): WorkspaceWriteLeaseRetirementReceipt {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || !hasExactKeys(receipt, RETIREMENT_RECEIPT_KEYS)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement receipt has an invalid schema');
  }
  const candidate = receipt as WorkspaceWriteLeaseRetirementReceipt;
  const material = {
    formatVersion: 'workspace-write-lease-retirement-receipt-v1' as const,
    workspaceIdentityDigest: candidate.workspaceIdentityDigest,
    workspaceDevice: candidate.workspaceDevice,
    workspaceInode: candidate.workspaceInode,
    intentDigest: candidate.intentDigest,
    tokenGeneration: candidate.tokenGeneration,
    ownerFileIdentityDigest: candidate.ownerFileIdentityDigest,
    terminalDigest: candidate.terminalDigest,
    transitionDigest: candidate.transitionDigest,
    namespaceDevice: candidate.namespaceDevice,
    namespaceInode: candidate.namespaceInode,
    namespaceTombstoneName: candidate.namespaceTombstoneName,
    fenceName: candidate.fenceName
  };
  if (candidate.formatVersion !== material.formatVersion ||
    typeof candidate.workspaceIdentityDigest !== 'string' ||
    typeof candidate.workspaceDevice !== 'string' || typeof candidate.workspaceInode !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(candidate.intentDigest) || !Number.isSafeInteger(candidate.tokenGeneration) || candidate.tokenGeneration < 1 ||
    typeof candidate.ownerFileIdentityDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(candidate.terminalDigest) || !/^sha256:[0-9a-f]{64}$/u.test(candidate.transitionDigest) ||
    typeof candidate.namespaceDevice !== 'string' || typeof candidate.namespaceInode !== 'string' || candidate.namespaceTombstoneName !== namespaceTombstoneName(candidate.transitionDigest) ||
    typeof candidate.fenceName !== 'string' || typeof candidate.retirementDigest !== 'string' ||
    candidate.retirementDigest !== sha256(material) || candidate.fenceName !== retirementFenceName(candidate.workspaceIdentityDigest)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement receipt is invalid');
  }
  return Object.freeze({ ...candidate });
}

/**
 * Ends the externally-held retirement fence only after the closeout owner has
 * completed its terminal retained cleanup/readback lifecycle.  Acquisition
 * checks this same-parent sibling before it ever creates `.sec`, so a new
 * writer cannot race a retired tree by recreating its local namespace.
 */
export function assertWorkspaceWriteLeaseRetirement(input: {
  readonly workspaceRoot: string;
  readonly receipt: WorkspaceWriteLeaseRetirementReceipt;
}): Readonly<{ parent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity; entry: import('../runtime-state/physical/runtime/physical-no-follow.ts').NoFollowDirectoryTreeEntry }> {
  const receipt = validateRetirementReceipt(input.receipt);
  const parent = inspectNoFollowDirectoryChain(retirementFenceParent(input.workspaceRoot), 'Workspace lease retirement fence parent').target;
  const workspace = inspectNoFollowDirectoryChain(input.workspaceRoot, 'Workspace lease retirement workspace').target;
  if (workspace.device !== receipt.workspaceDevice || workspace.inode !== receipt.workspaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement workspace identity changed');
  }
  if (physicalWorkspaceIdentityDigest(workspace) !== receipt.workspaceIdentityDigest) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement identity digest does not bind the live workspace');
  }
  const entry = inspectNoFollowOrdinaryFileEntry(parent, receipt.fenceName);
  if (entry === null) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement fence is absent');
  if (entry.kind !== 'file' || entry.bytes === null) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement fence changed before completion');
  }
  const bytes = entry.bytes;
  let current: WorkspaceWriteLeaseRetirementReceipt;
  try { current = JSON.parse(Buffer.from(bytes).toString('utf8')) as WorkspaceWriteLeaseRetirementReceipt; } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement fence is malformed');
  }
  const currentReceipt = validateRetirementReceipt(current);
  if (currentReceipt.retirementDigest !== receipt.retirementDigest || !canonicalEquals(currentReceipt, receipt)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement fence differs from its receipt');
  }
  return Object.freeze({ parent, entry });
}

/**
 * A retirement fence is only an index into the retained V3 ledger.  The
 * ledger directory is the authority: it must be the pre-bound inode and must
 * still contain the exact owner/terminal transition before recovery can use
 * it to converge any closeout effect.  This helper deliberately accepts a
 * subset because terminalisation removes the active holder and later retained
 * cleanup may have removed owned children, but it never accepts an added,
 * changed, reparse, or foreign entry.
 */
export function assertRetirementLedgerNamespace(
  namespace: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity,
  receipt: WorkspaceWriteLeaseRetirementReceipt,
  transition: WorkspaceWriteLeaseRetirementTransition
): void {
  if (namespace.device !== receipt.namespaceDevice || namespace.inode !== receipt.namespaceInode ||
    namespace.device !== transition.namespaceDevice || namespace.inode !== transition.namespaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement namespace identity differs from its bound transition');
  }
  const protocolBytes = readNoFollowOrdinaryFile(namespace, PROTOCOL_FILE);
  const ownerBytes = readNoFollowOrdinaryFile(namespace, generationOwnerPath('', receipt.tokenGeneration));
  const terminalBytes = readNoFollowOrdinaryFile(namespace, generationTerminalPath('', receipt.tokenGeneration));
  if (protocolBytes === null || ownerBytes === null || terminalBytes === null) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease terminal ledger pair is incomplete');
  }
  let protocol: unknown; let owner: unknown; let terminal: unknown;
  try {
    protocol = JSON.parse(Buffer.from(protocolBytes).toString('utf8')) as unknown;
    owner = JSON.parse(Buffer.from(ownerBytes).toString('utf8')) as unknown;
    terminal = JSON.parse(Buffer.from(terminalBytes).toString('utf8')) as unknown;
  } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease terminal ledger pair is malformed');
  }
  if (!canonicalEquals(protocol, { formatVersion: WORKSPACE_WRITE_LEASE_PROTOCOL_VERSION }) || !ownerLooksValid(owner) || !terminalLooksValid(terminal) ||
    !sameToken(tokenFromOwner(owner), transition.token) || !sameToken(terminal.token, transition.token) ||
    retirementTerminalTokenDigest(terminal.token) !== receipt.terminalDigest) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease terminal ledger pair differs from transition');
  }
  const expected = new Map(transition.namespaceEntries.map((entry) => [entry.relativePath, entry]));
  const terminalPath = generationTerminalPath('', receipt.tokenGeneration);
  if (scanNoFollowDirectoryTree(namespace).some((entry) => {
    const prior = expected.get(entry.relativePath);
    return (entry.relativePath !== terminalPath && prior === undefined) ||
      (prior !== undefined && (prior.kind !== entry.kind || prior.device !== entry.device || prior.inode !== entry.inode || prior.size !== entry.size || prior.bytes !== (entry.bytes === null ? null : Buffer.from(entry.bytes).toString('hex')))) ||
      entry.relativePath.startsWith(`${HOLDERS_DIRECTORY}/`);
  })) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement namespace is not a terminal expected subset');
  }
}

export function readRetirementTransitionProof(
  proofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity,
  receipt: WorkspaceWriteLeaseRetirementReceipt
): WorkspaceWriteLeaseRetirementTransition {
  const bytes = readNoFollowOrdinaryFile(proofParent, retirementTransitionName(receipt.transitionDigest));
  if (bytes === null) throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition is absent');
  let transition: WorkspaceWriteLeaseRetirementTransition;
  try { transition = validateRetirementTransition(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown); } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition is malformed');
  }
  if (transition.transitionDigest !== receipt.transitionDigest || transition.intentDigest !== receipt.intentDigest ||
    transition.token.generation !== receipt.tokenGeneration || transition.token.ownerFileIdentityDigest !== receipt.ownerFileIdentityDigest ||
    transition.workspaceDevice !== receipt.workspaceDevice || transition.workspaceInode !== receipt.workspaceInode ||
    transition.workspaceIdentityDigest !== receipt.workspaceIdentityDigest ||
    transition.namespaceTombstoneParentDevice !== proofParent.device || transition.namespaceTombstoneParentInode !== proofParent.inode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement transition does not bind its retained proof');
  }
  return transition;
}

/**
 * Verifies the target-external V3 owner/terminal ledger after its fence has
 * been deleted.  A receipt and phase remain mere locators: only the exact
 * pre-bound relocated namespace inode plus its canonical terminal pair
 * permits completed closeout consumption or convergence.
 */
export function assertWorkspaceWriteLeaseRetirementProof(input: {
  readonly workspaceRoot: string;
  readonly receipt: WorkspaceWriteLeaseRetirementReceipt;
  readonly proofParent: import('../runtime-state/physical/runtime/physical-no-follow.ts').PhysicalDirectoryIdentity;
}): WorkspaceWriteLeaseRetirementReceipt {
  const receipt = validateRetirementReceipt(input.receipt);
  const proofParent = assertSameNoFollowDirectoryIdentity(input.proofParent, 'Workspace lease retirement proof parent').target;
  const workspace = inspectExactNoFollowDirectoryPresence(input.workspaceRoot, 'Workspace lease retirement proof workspace');
  if (workspace.state === 'present') {
    const live = workspace.directory.target;
    if (live.device !== receipt.workspaceDevice || live.inode !== receipt.workspaceInode ||
      physicalWorkspaceIdentityDigest(live) !== receipt.workspaceIdentityDigest) {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof workspace identity changed');
    }
    if (inspectExactNoFollowDirectoryPresence(workspaceWriteLeasePathsFor(input.workspaceRoot).root, 'Workspace lease retirement proof internal namespace').state === 'present') {
      throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof has an unexpected internal namespace');
    }
  }
  const transition = readRetirementTransitionProof(proofParent, receipt);
  const external = inspectExactNoFollowDirectoryPresence(path.join(proofParent.path, receipt.namespaceTombstoneName), 'Workspace lease retirement proof namespace');
  if (external.state !== 'present') throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof namespace is absent');
  const topLevel = scanNoFollowDirectoryTree(proofParent)
    .filter((entry) => !entry.relativePath.includes('/'));
  const transitionName = retirementTransitionName(receipt.transitionDigest);
  const transitionEntry = topLevel.find((entry) => entry.relativePath === transitionName);
  const namespaceEntry = topLevel.find((entry) => entry.relativePath === receipt.namespaceTombstoneName);
  if (topLevel.length !== 2 || transitionEntry?.kind !== 'file' || namespaceEntry?.kind !== 'directory' ||
    namespaceEntry.device !== receipt.namespaceDevice || namespaceEntry.inode !== receipt.namespaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Workspace writer lease retirement proof root contains an unknown or replaced entry');
  }
  assertRetirementLedgerNamespace(external.directory.target, receipt, transition);
  return receipt;
}

export function readPreterminalRetirementReceipt(input: {
  readonly workspaceRoot: string;
  readonly intentDigest: string;
  readonly proofParent: PhysicalDirectoryIdentity;
}): WorkspaceWriteLeaseRetirementReceipt | null {
  const workspace = inspectNoFollowDirectoryChain(input.workspaceRoot, 'Preterminal retirement workspace').target;
  const fenceParent = inspectNoFollowDirectoryChain(
    retirementFenceParent(input.workspaceRoot), 'Preterminal retirement fence parent'
  ).target;
  const bytes = readNoFollowOrdinaryFile(fenceParent, retirementFenceName(physicalWorkspaceIdentityDigest(workspace)));
  if (bytes === null) return null;
  let receipt: WorkspaceWriteLeaseRetirementReceipt;
  try { receipt = validateRetirementReceipt(JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown); } catch {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Preterminal retirement fence is malformed');
  }
  if (receipt.intentDigest !== input.intentDigest || receipt.workspaceDevice !== workspace.device ||
    receipt.workspaceInode !== workspace.inode || receipt.workspaceIdentityDigest !== physicalWorkspaceIdentityDigest(workspace)) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Preterminal retirement fence does not bind the live workspace and intent');
  }
  const proofParent = assertSameNoFollowDirectoryIdentity(input.proofParent, 'Preterminal retirement proof parent').target;
  const transition = readRetirementTransitionProof(proofParent, receipt);
  const namespace = inspectNoFollowDirectoryChain(
    workspaceWriteLeasePathsFor(input.workspaceRoot).root, 'Preterminal retirement namespace'
  ).target;
  if (namespace.device !== receipt.namespaceDevice || namespace.inode !== receipt.namespaceInode ||
    namespace.device !== transition.namespaceDevice || namespace.inode !== transition.namespaceInode) {
    throw new WorkspaceWriteLeaseError('WORKSPACE-WRITE-LEASE-003', 'Preterminal retirement namespace identity changed');
  }
  return receipt;
}
