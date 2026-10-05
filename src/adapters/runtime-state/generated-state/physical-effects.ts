import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  assertGeneratedStateCleanupOperation, consumeGeneratedStateCleanupObservation,
  GeneratedStateCleanupOperationExhaustedError, type GeneratedStateCleanupOperationState
} from '../../../execution/generated-state/cleanup-budget.ts';
import { normalizeGeneratedStateRelativePath } from '../../../execution/generated-state/contract.ts';
import type { GeneratedStateWorktreeRetirementEffectInput } from '../../../execution/generated-state/lifecycle-port.ts';
import type { GeneratedStateGitObservationBackend, GeneratedStatePhysicalObservationBackend } from '../../../execution/generated-state/physical-port.ts';
import {
  consumeGeneratedStateTreeEffect,
  type GeneratedStateNativeOperationResource,
  type GeneratedStateTreeEffectBackend
} from '../../../execution/generated-state/tree-effect.ts';
import {
  acquireWorkspaceWriteLease, assertWorkspaceWriteLease, withWorkspaceWriteLease,
  type WorkspaceWriteLeaseHandle, type WorkspaceWriteLeaseToken
} from '../../filesystem/write-lease.ts';
import { parseWorktreePorcelainZ, parseWorktreeStatusPorcelainZ } from '../physical/contract/git-worktree-observation.ts';
import {
  createNoFollowOrdinaryDirectoryChain,
  deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  relocateRetainedNoFollowDirectoryAcrossParents,
  scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryIdentity
} from '../physical/runtime/physical-no-follow.ts';
import { runCommandBytes, type ByteCommandResult } from '../physical/runtime/process.ts';
import { parseWorktreeRetirementIntent } from './journal-codec.ts';
import { loadCleanupIntent } from './journal-read.ts';
import { observeGeneratedStatePhysicalRoot, openRuntimeStoreReadOnly, readRegistrationLedgerObservation, samePhysicalIdentity } from './registration-store.ts';
const MAXIMUM_CLEANUP_ENTRIES = 100_000;
const MAXIMUM_CLEANUP_BYTES = 2 * 1024 * 1024 * 1024;
const CLEANUP_DEADLINE_MS = 30_000;

interface NativeGeneratedStateOperation {
  readonly workspaceRoot: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly lease: Pick<WorkspaceWriteLeaseHandle, 'assertOwned' | 'ownedNamespace' | 'release'>;
}
/** Fixed native provider boundary. Caller backends and opaque-shaped JSON
 * cannot manufacture the original retained lease or its durable intent. */
export async function assertGeneratedStateProviderEffectNativeBinding(resource: GeneratedStateNativeOperationResource,
  input: GeneratedStateWorktreeRetirementEffectInput): Promise<void> {
  const operation = nativeOperation(resource);
  await operation.lease.assertOwned();
  if (path.resolve(input.workspaceRoot) !== operation.workspaceRoot) throw new Error('Domain Effect workspace differs from original operation.');
  const store = openRuntimeStoreReadOnly(operation.workspaceRoot, { environment: operation.environment });
  if (store === null) throw new Error('Domain Effect lacks durable original intent.');
  const ledger = readRegistrationLedgerObservation(store, input.relativePath);
  const registration = ledger.registration ?? ledger.retiredPredecessor;
  const observed = observeGeneratedStatePhysicalRoot(operation.workspaceRoot, input.relativePath);
  if (registration?.phase !== 'retired' || registration.registrationDigest !== input.registration.registrationDigest ||
      !samePhysicalIdentity(registration.root, input.source) || (observed.kind !== 'missing' &&
        (observed.identity === null || !samePhysicalIdentity(observed.identity, input.source)))) throw new Error('Domain Effect original retired physical preimage changed.');
  const cleanupIntent = loadCleanupIntent(store, input.relativePath);
  const activePath = path.join(store.transactionsRoot, 'worktree-retirement-active.json');
  const worktreeIntent = store.fs.exists(activePath) ? parseWorktreeRetirementIntent(JSON.parse(store.fs.readText(activePath))) : null;
  const entry = worktreeIntent?.entries.find(candidate => candidate.relativePath === input.relativePath && candidate.action === 'domain-retire');
  if (cleanupIntent?.registrationDigest !== registration.registrationDigest &&
      !(entry?.action === 'domain-retire' && worktreeIntent?.operationId === input.operationId &&
        entry.providerPlanDigest === input.planDigest && entry.providerPlanBytes === input.planBytes && samePhysicalIdentity(entry.source, input.source))) {
    throw new Error('Domain Effect has no exact durable cleanup or worktree intent.');
  }
  await store.assertCurrent();
}
const nativeOperations = new WeakMap<object, NativeGeneratedStateOperation>();
function nativeOperation(resource: GeneratedStateNativeOperationResource): NativeGeneratedStateOperation {
  const original = nativeOperations.get(resource);
  if (original === undefined) throw new Error('Generated-state native operation resource is foreign or settled.');
  return original;
}
export async function assertGeneratedStateNativeOperationBinding(resource: GeneratedStateNativeOperationResource,
  workspaceRoot: string): Promise<void> {
  const original = nativeOperation(resource);
  if (original.workspaceRoot !== path.resolve(workspaceRoot)) throw new Error('Native operation belongs to another workspace.');
  await original.lease.assertOwned();
}

export function createGeneratedStateTreeEffectBackend(options: Readonly<{
  environment?: NodeJS.ProcessEnv; reentrantToken?: WorkspaceWriteLeaseToken;
}> = {}): GeneratedStateTreeEffectBackend {
  const borrowedToken = options.reentrantToken === undefined ? undefined : Object.freeze({ ...options.reentrantToken });
  const journalStore = (operation: NativeGeneratedStateOperation) => {
    const store = openRuntimeStoreReadOnly(operation.workspaceRoot, options);
    if (store === null) throw new Error('Generated-state Effect has no original durable intent namespace.');
    return store;
  };
  const cleanup = (operation: NativeGeneratedStateOperation, relativePath: string, intentDigest: `sha256:${string}`) => {
    const store = journalStore(operation); const intent = loadCleanupIntent(store, relativePath);
    const observation = readRegistrationLedgerObservation(store, relativePath);
    const registration = observation.registration ?? observation.retiredPredecessor;
    if (intent?.intentDigest !== intentDigest || registration?.phase !== 'retired' ||
        registration.registrationDigest !== intent.registrationDigest || !samePhysicalIdentity(registration.root, intent.root)) {
      throw new Error('Generated-state cleanup Effect does not bind the original intent and retired registration.');
    }
    return { store, intent };
  };
  return Object.freeze({
    acquireOperation: async workspaceRootInput => {
      const workspaceRoot = path.resolve(workspaceRootInput);
      let lease: NativeGeneratedStateOperation['lease'];
      if (borrowedToken === undefined) lease = await acquireWorkspaceWriteLease(workspaceRoot);
      else {
        // The original workspace owner authenticates this exact explicit
        // token. Borrowing never creates or releases another generation.
        await withWorkspaceWriteLease(workspaceRoot, borrowedToken, async () => undefined);
        lease = Object.freeze({
          assertOwned: () => assertWorkspaceWriteLease(workspaceRoot, borrowedToken),
          ownedNamespace: async () => {
            await assertWorkspaceWriteLease(workspaceRoot, borrowedToken);
            return Object.freeze({ workspaceRoot, relativePath: '.sec/workspace-write-lease' as const });
          },
          release: () => assertWorkspaceWriteLease(workspaceRoot, borrowedToken)
        });
      }
      const resource = Object.freeze({ kind: 'generated-state-native-operation-resource' as const });
      nativeOperations.set(resource, { workspaceRoot, lease, environment: options.environment }); return resource;
    },
    assertOperationCurrent: resource => nativeOperation(resource).lease.assertOwned(),
    operationNamespace: resource => nativeOperation(resource).lease.ownedNamespace(),
    settleOperation: async resource => {
      const operation = nativeOperation(resource);
      try { await operation.lease.release(); } finally { nativeOperations.delete(resource); }
    },
    relocateQuarantine: async (resource, authority) => {
      const operation = nativeOperation(resource); await operation.lease.assertOwned();
      const request = consumeGeneratedStateTreeEffect(resource, authority);
      if (request.kind !== 'quarantine-relocate') throw new Error('Foreign quarantine relocation Effect authority.');
      const { intent } = cleanup(operation, request.relativePath, request.intentDigest);
      const source = observeGeneratedStatePhysicalRoot(operation.workspaceRoot, intent.relativePath);
      if (source.kind !== 'directory' || source.directory === null || !samePhysicalIdentity(source.directory, intent.root)) {
        throw new Error('Quarantine relocation source is absent, active or foreign.');
      }
      const workspace = inspectNoFollowDirectoryChain(operation.workspaceRoot, 'Quarantine relocation workspace').target;
      const destination = createNoFollowOrdinaryDirectoryChain(workspace, ['.tmp', 'generated-state-quarantine']);
      const result = relocateRetainedNoFollowDirectoryAcrossParents({ directory: source.directory, destinationParent: destination,
        tombstoneName: intent.tombstoneName });
      await operation.lease.assertOwned(); return result;
    },
    deleteQuarantine: async (resource, authority, budget) => {
      const operation = nativeOperation(resource); await operation.lease.assertOwned();
      const request = consumeGeneratedStateTreeEffect(resource, authority);
      if (request.kind !== 'quarantine-delete') throw new Error('Foreign quarantine deletion Effect authority.');
      const { intent } = cleanup(operation, request.relativePath, request.intentDigest);
      if (observeGeneratedStatePhysicalRoot(operation.workspaceRoot, intent.relativePath).kind !== 'missing') {
        throw new Error('Quarantine deletion requires original source absence readback.');
      }
      const targetPath = path.join(operation.workspaceRoot, '.tmp', 'generated-state-quarantine', intent.tombstoneName);
      const target = inspectExactNoFollowDirectoryPresence(targetPath, 'Quarantine deletion exact root');
      if (target.state !== 'absent') {
        if (!samePhysicalIdentity(target.directory.target, intent.root)) throw new Error('Quarantine deletion root is foreign.');
        deleteQuarantinedTree(target.directory.target, budget);
      }
      if (inspectExactNoFollowDirectoryPresence(targetPath, 'Quarantine deletion terminal readback').state !== 'absent') {
        throw new Error('Quarantine deletion root remains after physical retirement.');
      }
      await operation.lease.assertOwned();
    },
    createWorktreeRetention: async (resource, authority) => {
      const operation = nativeOperation(resource); await operation.lease.assertOwned();
      const request = consumeGeneratedStateTreeEffect(resource, authority);
      if (request.kind !== 'worktree-retention-create') throw new Error('Foreign worktree retention creation authority.');
      const workspace = inspectNoFollowDirectoryChain(operation.workspaceRoot, 'Worktree retention workspace').target;
      const parent = inspectNoFollowDirectoryChain(path.dirname(operation.workspaceRoot), 'Worktree retention parent').target;
      const name = `sec-generated-state-retirement-${request.operationId.slice(7)}`;
      if (inspectExactNoFollowDirectoryPresence(path.join(parent.path, name), 'New worktree retention root').state !== 'absent') {
        throw new Error('Generated-state worktree retention root exists without its exact active intent.');
      }
      const target = createNoFollowOrdinaryDirectoryChain(parent, [name]);
      if (target.device !== workspace.device || cleanupInventory(target, null, 'New worktree retention inventory').length !== 0) {
        throw new Error('Generated-state worktree retention root is not an empty same-volume object.');
      }
      await operation.lease.assertOwned(); return target;
    },
    finalizeQuarantine: async (resource, authority, budget) => {
      const operation = nativeOperation(resource); await operation.lease.assertOwned();
      const request = consumeGeneratedStateTreeEffect(resource, authority);
      if (request.kind !== 'quarantine-finalize') throw new Error('Foreign quarantine finalization authority.');
      const targetPath = path.join(operation.workspaceRoot, '.tmp', 'generated-state-quarantine');
      const target = inspectExactNoFollowDirectoryPresence(targetPath, 'Quarantine finalization root');
      if (target.state === 'absent') return 0;
      const inventory = cleanupInventory(target.directory.target, budget, 'Generated-state quarantine finalization inventory');
      if (inventory.length !== 0) return inventory.length;
      const parent = inspectNoFollowDirectoryChain(path.dirname(targetPath), 'Quarantine finalization parent').target;
      deleteRetainedNoFollowEntry({ root: parent, relativePath: path.basename(targetPath), kind: 'directory',
        device: target.directory.target.device, inode: target.directory.target.inode, ancestorDirectories: Object.freeze([]) });
      await operation.lease.assertOwned(); return 0;
    },
    relocateWorktreePreservation: async (resource, authority) => {
      const operation = nativeOperation(resource); await operation.lease.assertOwned();
      const request = consumeGeneratedStateTreeEffect(resource, authority);
      if (request.kind !== 'worktree-relocate') throw new Error('Foreign worktree preservation relocation authority.');
      const store = journalStore(operation); const locator = path.join(store.transactionsRoot, 'worktree-retirement-active.json');
      const intent = store.fs.exists(locator) ? parseWorktreeRetirementIntent(JSON.parse(store.fs.readText(locator))) : null;
      const entry = intent?.entries.find(entry => entry.relativePath === request.relativePath && entry.action === 'preserve');
      if (intent?.intentDigest !== request.intentDigest || entry?.action !== 'preserve' || intent.retentionRoot === null) {
        throw new Error('Worktree preservation Effect does not bind the exact original active intent.');
      }
      const root = inspectNoFollowDirectoryChain(intent.retentionRoot.path, 'Worktree preservation retained root').target;
      if (!samePhysicalIdentity(root, intent.retentionRoot)) throw new Error('Worktree preservation retained root identity changed.');
      const source = observeGeneratedStatePhysicalRoot(operation.workspaceRoot, entry.relativePath);
      if (source.directory === null || !samePhysicalIdentity(source.directory, entry.source)) throw new Error('Worktree preservation source is absent or foreign.');
      const result = relocateRetainedNoFollowDirectoryAcrossParents({ directory: source.directory, destinationParent: root,
        tombstoneName: entry.destinationName });
      await operation.lease.assertOwned(); return result;
    }
  } satisfies GeneratedStateTreeEffectBackend);
}

export function createGeneratedStatePhysicalObservationBackend(workspaceRootInput: string): GeneratedStatePhysicalObservationBackend {
  const workspaceRoot = path.resolve(workspaceRootInput);
  return Object.freeze({
    observeWorkspace: () => inspectNoFollowDirectoryChain(workspaceRoot, 'Generated-state workspace observation').target,
    observeRoot: relativePath => observeGeneratedStatePhysicalRoot(workspaceRoot, relativePath),
    observeExactDirectory: targetPath => {
      const observation = inspectExactNoFollowDirectoryPresence(targetPath, 'Generated-state exact directory observation');
      return observation.state === 'absent' ? null : observation.directory.target;
    },
    listDirectoryChildren: relativeParent => {
      const target = path.join(workspaceRoot, ...normalizeGeneratedStateRelativePath(relativeParent).split('/'));
      const presence = inspectExactNoFollowDirectoryPresence(target, 'Generated-state candidate parent');
      return presence.state === 'absent' ? Object.freeze([]) : Object.freeze(readdirSync(presence.directory.target.path));
    },
    observeTree: (target, budget) => {
      const original = inspectNoFollowDirectoryChain(target.path, 'Generated-state exact tree observation').target;
      if (!samePhysicalIdentity(original, target)) throw new Error('Generated-state observed tree identity changed.');
      return cleanupInventory(original, budget, 'Generated-state exact tree inventory');
    }
  } satisfies GeneratedStatePhysicalObservationBackend);
}

export interface GeneratedStateNativeGitObservationOptions {
  readonly repositoryRoot: string;
  readonly workspaceRoot: string;
  readonly runGit?: (command: string, args: string[], options: Readonly<{ cwd: string }>) => Promise<ByteCommandResult>;
}
export function createGeneratedStateGitObservationBackend(input: GeneratedStateNativeGitObservationOptions): GeneratedStateGitObservationBackend {
  const repositoryRoot = path.resolve(input.repositoryRoot); const workspaceRoot = path.resolve(input.workspaceRoot);
  const run = input.runGit ?? ((command, args, options) => runCommandBytes(command, args, { cwd: options.cwd }));
  return Object.freeze({
    observeWorktrees: async () => {
      const result = await run('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: repositoryRoot });
      if (result.code !== 0) return Object.freeze({ state: 'unavailable' as const });
      return Object.freeze({ state: 'observed' as const, worktrees: Object.freeze(parseWorktreePorcelainZ(result.stdout)) });
    },
    observeWorktreeTree: async () => {
      const result = await run('git', ['-C', workspaceRoot, 'rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot });
      if (result.code !== 0) return Object.freeze({ state: 'unavailable' as const });
      const treeSha = Buffer.from(result.stdout).toString('utf8').trim();
      if (!/^[0-9a-f]{40}$/u.test(treeSha)) throw new Error('Generated-state worktree tree observation is not a SHA-1 identity.');
      return Object.freeze({ state: 'observed' as const, treeSha });
    },
    observeWorktreeStatus: async () => {
      const result = await run('git', ['-C', workspaceRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'], { cwd: repositoryRoot });
      if (result.code !== 0) return Object.freeze({ state: 'unavailable' as const });
      return Object.freeze({ state: 'observed' as const, records: Object.freeze(parseWorktreeStatusPorcelainZ(result.stdout)) });
    }
  } satisfies GeneratedStateGitObservationBackend);
}

export function cleanupInventory(
  directory: PhysicalDirectoryIdentity,
  state: GeneratedStateCleanupOperationState | null,
  label: string
) {
  assertGeneratedStateCleanupOperation(state, label);
  const remainingEntries = state === null ? MAXIMUM_CLEANUP_ENTRIES : state.maximumEntries - state.observedEntries;
  const remainingBytes = state === null ? MAXIMUM_CLEANUP_BYTES : state.maximumBytes - state.observedBytes;
  if (remainingEntries < 1 || remainingBytes < 0) {
    throw new GeneratedStateCleanupOperationExhaustedError(`${label} exhausted aggregate cleanup capacity.`);
  }
  let inventory: ReturnType<typeof scanNoFollowDirectoryTreeMetadata>;
  try {
    inventory = scanNoFollowDirectoryTreeMetadata(directory, {
      deadlineAtMs: state?.deadlineAtMonotonicMs ?? performance.now() + CLEANUP_DEADLINE_MS,
      maximumEntries: remainingEntries,
      maximumBytes: remainingBytes,
      signal: state?.signal
    });
  } catch (error) {
    if ((error instanceof PhysicalNoFollowError &&
        error.code === 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE') ||
        state?.signal?.aborted === true) {
      throw new GeneratedStateCleanupOperationExhaustedError(`${label} exhausted its bounded inventory.`);
    }
    throw error;
  }
  if (state !== null) {
    const observedBytes = inventory.reduce(
      (total, entry) => total + (entry.kind === 'file' ? entry.size : 0),
      0
    );
    if (inventory.length > state.maximumEntries - state.observedEntries ||
        observedBytes > state.maximumBytes - state.observedBytes) {
      throw new GeneratedStateCleanupOperationExhaustedError(`${label} exceeded aggregate cleanup capacity.`);
    }
    consumeGeneratedStateCleanupObservation(state, inventory.length, observedBytes);
  }
  return inventory;
}

export function deleteQuarantinedTree(
  directory: PhysicalDirectoryIdentity,
  operation: GeneratedStateCleanupOperationState | null
): void {
  const inventory = cleanupInventory(directory, operation, 'Generated-state quarantine inventory');
  const directories = new Map<string, { device: string; inode: string }>();
  for (const entry of inventory) {
    if (entry.kind === 'directory') directories.set(entry.relativePath, entry);
  }
  const ordered = [...inventory].sort((left, right) => {
    const depth = (value: string): number => value.split('/').length;
    return depth(right.relativePath) - depth(left.relativePath)
      || (left.kind === 'directory' ? 1 : -1)
      || right.relativePath.localeCompare(left.relativePath);
  });
  for (const entry of ordered) {
    assertGeneratedStateCleanupOperation(operation, 'Generated-state quarantine entry deletion');
    const parts = entry.relativePath.split('/');
    const ancestors = parts.slice(0, -1).map((_, index) => {
      const relativePath = parts.slice(0, index + 1).join('/');
      const identity = directories.get(relativePath);
      if (identity === undefined) throw new Error('Generated-state cleanup ancestor inventory is incomplete.');
      return Object.freeze({ relativePath, device: identity.device, inode: identity.inode });
    });
    deleteRetainedNoFollowEntry({
      root: directory,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories: ancestors
    });
  }
  assertGeneratedStateCleanupOperation(operation, 'Generated-state quarantine root deletion');
  const parent = inspectNoFollowDirectoryChain(path.dirname(directory.path), 'Generated-state quarantine parent').target;
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(directory.path),
    kind: 'directory',
    device: directory.device,
    inode: directory.inode,
    ancestorDirectories: Object.freeze([])
  });
}
