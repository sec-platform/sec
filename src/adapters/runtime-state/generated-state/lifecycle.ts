import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { withAcquiredResource } from '../../../execution/resource-settlement.ts';
import { acquireWorkspaceWriteLease } from '../../filesystem/write-lease.ts';
import {
  parseWorktreePorcelainZ,
  parseWorktreeStatusPorcelainZ,
  type WorktreeStatusPorcelainRecord
} from '../physical/contract/git-worktree-observation.ts';
import { PhysicalNoFollowError, createNoFollowOrdinaryDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowLinkEntry, inspectNoFollowOrdinaryFileEntry, relocateRetainedNoFollowDirectoryAcrossParents, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryIdentity } from '../physical/runtime/physical-no-follow.ts';
import { runCommandBytes, type ByteCommandResult } from '../physical/runtime/process.ts';
import {
  GENERATED_STATE_CLEANUP_CONTINUATION_SCHEMA,
  GENERATED_STATE_DISPOSAL_RECEIPT_SCHEMA,
  GENERATED_STATE_REGISTRY,
  assertGeneratedStateWorktreeRetirement,
  createGeneratedStateInventory,
  createGeneratedStateRegistration,
  createGeneratedStateSettlement,
  createGeneratedStateWorktreeRetirement,
  generatedStateCleanupAllowed,
  generatedStateDigest,
  generatedStateDomainProviderMaterialDigest,
  generatedStateLegacyRetirementRuleForPath,
  generatedStateRuleForPath,
  normalizeGeneratedStateRelativePath,
  parseGeneratedStatePhysicalIdentity,
  retireGeneratedStateRegistration,
  type GeneratedStateCleanupContinuationReceipt,
  type GeneratedStateCleanupProfile,
  type GeneratedStateDisposalReceipt,
  type GeneratedStateInventory,
  type GeneratedStateInventoryEntry,
  type GeneratedStatePhysicalForm,
  type GeneratedStatePhysicalIdentity,
  type GeneratedStateRegistration,
  type GeneratedStateRule,
  type GeneratedStateSettlement,
  type GeneratedStateWorktreeRetirement
} from './contract.ts';

import {
  GeneratedStateProducerBindingBlockedError,
  canonicalBytes,
  ensureGeneratedStateRegistrationLedger,
  identityOf,
  inspectRegistrationPointer,
  loadRegistration,
  openRuntimeStore,
  openRuntimeStoreReadOnly,
  persistRegistration,
  readRegistrationLedgerObservation,
  registrationKey,
  registrationPath,
  samePhysicalIdentity,
  withGeneratedStateMutationLease,
  type GeneratedStateRegistrationLedgerObservation,
  type GeneratedStateRuntimeStore,
} from './registration-store.ts';

export { GeneratedStateProducerBindingBlockedError } from './registration-store.ts';

const GENERATED_STATE_CLEANUP_INTENT_SCHEMA = 'sec-generated-state-cleanup-intent-v2' as const;
const GENERATED_STATE_DISPOSAL_KEY_SCHEMA = 'sec-generated-state-disposal-key-v1' as const;
const MAXIMUM_CLEANUP_ENTRIES = 100_000;
const MAXIMUM_CLEANUP_BYTES = 2 * 1024 * 1024 * 1024;
const CLEANUP_DEADLINE_MS = 30_000;

export interface GeneratedStateCleanupOperationSession {
  readonly deadlineAtMonotonicMs: number;
}

type GeneratedStateCleanupOperationState = {
  readonly deadlineAtMonotonicMs: number;
  readonly maximumBytes: number;
  readonly maximumEntries: number;
  readonly monotonicNowMs: () => number;
  readonly signal: AbortSignal | undefined;
  observedBytes: number;
  observedEntries: number;
};

const generatedStateCleanupOperationStates = new WeakMap<object, GeneratedStateCleanupOperationState>();

export function createGeneratedStateCleanupOperationSession(input: Readonly<{
  deadlineAtMonotonicMs: number;
  maximumBytes?: number;
  maximumEntries?: number;
  monotonicNowMs?: () => number;
  signal?: AbortSignal;
}>): GeneratedStateCleanupOperationSession {
  const maximumBytes = input.maximumBytes ?? MAXIMUM_CLEANUP_BYTES;
  const maximumEntries = input.maximumEntries ?? MAXIMUM_CLEANUP_ENTRIES;
  const monotonicNowMs = input.monotonicNowMs ?? (() => performance.now());
  if (!Number.isFinite(input.deadlineAtMonotonicMs) ||
      !Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || maximumBytes > MAXIMUM_CLEANUP_BYTES ||
      !Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > MAXIMUM_CLEANUP_ENTRIES) {
    throw new Error('Generated-state cleanup operation bounds are invalid.');
  }
  const session = Object.freeze({
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs
  });
  generatedStateCleanupOperationStates.set(session, {
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    maximumBytes,
    maximumEntries,
    monotonicNowMs,
    signal: input.signal,
    observedBytes: 0,
    observedEntries: 0
  });
  return session;
}

class GeneratedStateCleanupOperationExhaustedError extends Error {}

function generatedStateCleanupOperationState(
  session: GeneratedStateCleanupOperationSession | undefined
): GeneratedStateCleanupOperationState | null {
  if (session === undefined) return null;
  const state = generatedStateCleanupOperationStates.get(session);
  if (state === undefined) throw new Error('Generated-state cleanup operation session is not owner-issued.');
  return state;
}

function assertGeneratedStateCleanupOperation(
  state: GeneratedStateCleanupOperationState | null,
  label: string
): void {
  if (state === null) return;
  if (state.signal?.aborted === true || state.monotonicNowMs() >= state.deadlineAtMonotonicMs) {
    throw new GeneratedStateCleanupOperationExhaustedError(`${label} exceeded the cleanup operation budget.`);
  }
}

function cleanupInventory(
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
    state.observedEntries += inventory.length;
    state.observedBytes += observedBytes;
  }
  return inventory;
}

export interface GeneratedStateLifecycleOptions {
  readonly afterQuarantineEffect?: (relativePath: string) => void | Promise<void>;
  readonly afterWorktreeRetirementRelocation?: (relativePath: string) => void | Promise<void>;
  readonly afterWorktreeRetirementProviderEffect?: (relativePath: string) => void | Promise<void>;
  readonly beforeCleanupEffect?: (relativePath: string) => void | Promise<void>;
  readonly clock?: () => Date;
  readonly cleanupOperation?: GeneratedStateCleanupOperationSession;
  readonly environment?: NodeJS.ProcessEnv;
  readonly worktreeRetirementProviders?: readonly GeneratedStateWorktreeRetirementProvider[];
  readonly runGit?: (
    command: string,
    args: string[],
    options: Readonly<{ cwd: string }>
  ) => Promise<ByteCommandResult>;
}

export interface GeneratedStateWorktreeRetirementProvider {
  readonly id: string;
  /** Pure admission: accepts the exact active or already-retired registration and makes no Effect. */
  plan(input: Readonly<{
    repositoryRoot: string;
    workspaceRoot: string;
    relativePath: string;
    source: GeneratedStatePhysicalIdentity;
    registration: GeneratedStateRegistration;
  }>): Promise<Readonly<{
    bytes: string;
    digest: `sha256:${string}`;
  }>>;
  /** Effect boundary: lifecycle always supplies the exact retired registration bound to the durable plan. */
  retire(authority: GeneratedStateWorktreeRetirementEffectAuthority): Promise<Readonly<{
    bytes: string;
    digest: `sha256:${string}`;
  }>>;
}

export interface GeneratedStateWorktreeRetirementEffectAuthority {
  readonly schema: 'sec-generated-state-worktree-retirement-effect-authority-v1';
}

type GeneratedStateWorktreeRetirementEffectInput = Readonly<{
  operationId: `sha256:${string}`;
  repositoryRoot: string;
  workspaceRoot: string;
  relativePath: string;
  source: GeneratedStatePhysicalIdentity;
  registration: GeneratedStateRegistration;
  planBytes: string;
  planDigest: `sha256:${string}`;
}>;

type GeneratedStateWorktreeRetirementEffectAuthorityState = {
  readonly providerId: string;
  readonly input: GeneratedStateWorktreeRetirementEffectInput;
  consumed: boolean;
};

const generatedStateWorktreeRetirementEffectAuthorities =
  new WeakMap<object, GeneratedStateWorktreeRetirementEffectAuthorityState>();

function issueGeneratedStateWorktreeRetirementEffectAuthority(
  providerId: string,
  input: GeneratedStateWorktreeRetirementEffectInput
): GeneratedStateWorktreeRetirementEffectAuthority {
  const authority = Object.freeze({
    schema: 'sec-generated-state-worktree-retirement-effect-authority-v1' as const
  });
  generatedStateWorktreeRetirementEffectAuthorities.set(authority, {
    providerId,
    input: Object.freeze({
      ...input,
      source: Object.freeze({ ...input.source }),
      registration: Object.freeze({
        ...input.registration,
        workspace: Object.freeze({ ...input.registration.workspace }),
        root: Object.freeze({ ...input.registration.root })
      })
    }),
    consumed: false
  });
  return authority;
}

export function consumeGeneratedStateWorktreeRetirementEffectAuthority(
  authority: GeneratedStateWorktreeRetirementEffectAuthority,
  providerId: string
): GeneratedStateWorktreeRetirementEffectInput {
  const state = generatedStateWorktreeRetirementEffectAuthorities.get(authority);
  if (state === undefined || state.consumed || state.providerId !== providerId) {
    throw new GeneratedStateWorktreeRetirementBlockedError(
      'Generated-state worktree retirement Effect authority is forged, stale, replayed, or belongs to another provider.'
    );
  }
  state.consumed = true;
  return state.input;
}

function revokeGeneratedStateWorktreeRetirementEffectAuthority(
  authority: GeneratedStateWorktreeRetirementEffectAuthority
): void {
  generatedStateWorktreeRetirementEffectAuthorities.delete(authority);
}

function assertGeneratedStateWorktreeRetirementEffectAuthorityConsumed(
  authority: GeneratedStateWorktreeRetirementEffectAuthority
): void {
  if (generatedStateWorktreeRetirementEffectAuthorities.get(authority)?.consumed !== true) {
    throw new GeneratedStateWorktreeRetirementBlockedError(
      'Generated-state worktree retirement provider did not consume its owner-issued Effect authority.'
    );
  }
}

type ObservedGeneratedStateRoot = Readonly<{
  kind: 'directory' | 'file' | 'link' | 'missing';
  identity: GeneratedStatePhysicalIdentity | null;
  directory: PhysicalDirectoryIdentity | null;
  linkTarget: string | null;
}>;

function physicalFormForObservedKind(
  rule: GeneratedStateRule,
  kind: ObservedGeneratedStateRoot['kind']
): GeneratedStatePhysicalForm | null {
  if (kind === 'missing') return null;
  return rule.physicalForms.find((form) => form.kind === kind) ?? null;
}

function sameIdentity(
  left: GeneratedStatePhysicalIdentity,
  right: GeneratedStatePhysicalIdentity
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function observeRoot(workspaceRoot: string, relativePath: string): ObservedGeneratedStateRoot {
  const absolutePath = path.join(workspaceRoot, ...normalizeGeneratedStateRelativePath(relativePath).split('/'));
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({ kind: 'missing', identity: null, directory: null, linkTarget: null });
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    const parent = inspectNoFollowDirectoryChain(path.dirname(absolutePath), 'Generated-state link parent').target;
    const entry = inspectNoFollowLinkEntry(parent, path.basename(absolutePath));
    if (entry === null || entry.linkTarget === null) {
      return Object.freeze({ kind: 'missing', identity: null, directory: null, linkTarget: null });
    }
    return Object.freeze({
      kind: 'link',
      identity: Object.freeze({
        device: entry.device,
        inode: entry.inode,
        objectId: generatedStateDigest({ kind: 'link', target: entry.linkTarget })
      }),
      directory: null,
      linkTarget: entry.linkTarget
    });
  }
  if (metadata.isDirectory()) {
    const directory = inspectNoFollowDirectoryChain(absolutePath, 'Generated-state root').target;
    return Object.freeze({ kind: 'directory', identity: identityOf(directory), directory, linkTarget: null });
  }
  if (!metadata.isFile()) return Object.freeze({ kind: 'link', identity: null, directory: null, linkTarget: null });
  const parent = inspectNoFollowDirectoryChain(path.dirname(absolutePath), 'Generated-state file parent').target;
  const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(absolutePath));
  if (entry === null) return Object.freeze({ kind: 'missing', identity: null, directory: null, linkTarget: null });
  return Object.freeze({
    kind: 'file',
    identity: Object.freeze({
      device: entry.device,
      inode: entry.inode,
      objectId: `${entry.device}:${entry.inode}`
    }),
    directory: null,
    linkTarget: null
  });
}

function transactionPointerPath(store: GeneratedStateRuntimeStore, relativePath: string): string {
  return path.join(store.transactionsRoot, `current-${registrationKey(relativePath)}.json`);
}

interface GeneratedStateCleanupIntent {
  readonly schema: typeof GENERATED_STATE_CLEANUP_INTENT_SCHEMA;
  readonly beforeInventoryDigest: `sha256:${string}`;
  readonly profile: GeneratedStateCleanupProfile;
  readonly registrationDigest: `sha256:${string}`;
  readonly relativePath: string;
  readonly root: GeneratedStatePhysicalIdentity;
  readonly tombstoneName: string;
  readonly intentDigest: `sha256:${string}`;
}

function loadCleanupIntent(
  store: GeneratedStateRuntimeStore,
  relativePath: string
): GeneratedStateCleanupIntent | null {
  const locator = transactionPointerPath(store, relativePath);
  if (!store.fs.exists(locator)) return null;
  const source = store.fs.readText(locator);
  let value: Partial<GeneratedStateCleanupIntent>;
  try {
    value = JSON.parse(source) as Partial<GeneratedStateCleanupIntent>;
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state cleanup intent is not exact JSON: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  const expectedKeys = [
    'beforeInventoryDigest',
    'intentDigest',
    'profile',
    'registrationDigest',
    'relativePath',
    'root',
    'schema',
    'tombstoneName'
  ];
  if (Object.keys(value).sort().join('\0') !== expectedKeys.join('\0')) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state cleanup intent has noncanonical keys; physical state is preserved.'
    );
  }
  let root: GeneratedStatePhysicalIdentity;
  try {
    root = parseGeneratedStatePhysicalIdentity(value.root, 'cleanupIntent.root');
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state cleanup intent physical identity is malformed: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  if (value.schema !== GENERATED_STATE_CLEANUP_INTENT_SCHEMA
      || value.relativePath !== normalizeGeneratedStateRelativePath(relativePath)
      || typeof value.beforeInventoryDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(value.beforeInventoryDigest)
      || !['automatic', 'safe', 'all-rebuildable'].includes(String(value.profile))
      || typeof value.registrationDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(value.registrationDigest)
      || typeof value.tombstoneName !== 'string' || !/^q-[0-9a-f]{48}$/u.test(value.tombstoneName)
      || typeof value.intentDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.intentDigest)) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state cleanup intent pointer is malformed; physical state is preserved.'
    );
  }
  const material = Object.freeze({
    schema: value.schema,
    beforeInventoryDigest: value.beforeInventoryDigest,
    profile: value.profile,
    registrationDigest: value.registrationDigest,
    relativePath: value.relativePath,
    root,
    tombstoneName: value.tombstoneName
  });
  if (generatedStateDigest(material) !== value.intentDigest) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state cleanup intent digest is invalid; physical state is preserved.'
    );
  }
  const intent = Object.freeze({ ...material, intentDigest: value.intentDigest }) as GeneratedStateCleanupIntent;
  if (canonicalBytes(intent) !== source) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state cleanup intent bytes are noncanonical; physical state is preserved.'
    );
  }
  return intent;
}

function requireRule(relativePath: string): GeneratedStateRule {
  const rule = generatedStateRuleForPath(relativePath);
  if (rule === null) {
    throw new Error(`Generated-state path is not registered by active policy: ${relativePath}`);
  }
  return rule;
}

function requireRetirementRule(
  relativePath: string,
  expected?: GeneratedStateProducerBindingExpectation
): GeneratedStateRule {
  const active = generatedStateRuleForPath(relativePath);
  if (active !== null) return active;
  const legacy = generatedStateLegacyRetirementRuleForPath(relativePath);
  if (legacy === null || expected?.ruleId === undefined || expected.ruleId !== legacy.id
      || expected.owner !== legacy.owner || expected.producer !== legacy.producer) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state path is not admitted by active or explicit legacy-retirement policy: ${relativePath}.`
    );
  }
  return legacy;
}

async function registerGeneratedStateBirth(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  operationId: string;
}>, options: GeneratedStateLifecycleOptions = {}): Promise<GeneratedStateRegistration> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = requireRule(relativePath);
  if (rule.registration !== 'required-at-birth') {
    throw new Error(`Generated-state rule ${rule.id} is registered by its domain owner, not this lifecycle.`);
  }
  return withGeneratedStateMutationLease(workspaceRoot, options, async (store) => {
    const workspace = inspectNoFollowDirectoryChain(workspaceRoot, 'Generated-state workspace root').target;
    const observed = observeRoot(workspaceRoot, relativePath);
    if (observed.identity === null || physicalFormForObservedKind(rule, observed.kind) === null) {
      throw new Error('Generated-state birth requires one registered physical form with exact identity.');
    }
    const pointer = inspectRegistrationPointer(store, relativePath);
    const currentObservation = readRegistrationLedgerObservation(store, relativePath);
    if (currentObservation.registration !== null || pointer.snapshot.bytes !== null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state birth cannot adopt or replace an existing physical registration; use bind: ${relativePath}.`
      );
    }
    if (currentObservation.retiredPredecessor !== null &&
        sameIdentity(currentObservation.retiredPredecessor.root, observed.identity)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state birth cannot re-sign the disposed predecessor physical identity: ${relativePath}.`
      );
    }
    const registration = createGeneratedStateRegistration({
      repositoryRoot,
      workspace: identityOf(workspace),
      rule,
      relativePath,
      root: observed.identity,
      operationId: input.operationId
    }, { clock: options.clock });
    persistRegistration(
      store,
      registration,
      pointer.snapshot,
      currentObservation.tip?.recordDigest ?? null
    );
    await store.assertCurrent();
    return registration;
  });
}

function generatedStateOwnerRetirementRef(
  registration: GeneratedStateRegistration,
  outcome: string
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: 'sec-generated-state-owner-retirement-v1',
    registrationId: registration.registrationId,
    registrationDigest: registration.registrationDigest,
    relativePath: registration.relativePath,
    owner: registration.owner,
    producer: registration.producer,
    operationId: registration.operationId,
    outcome
  }));
}

async function retireGeneratedStateInStore(store: GeneratedStateRuntimeStore, input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expectedRegistrationDigest: `sha256:${string}`;
  outcome: string;
}>, options: GeneratedStateLifecycleOptions): Promise<GeneratedStateRegistration> {
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const pointer = inspectRegistrationPointer(store, relativePath);
  const currentObservation = readRegistrationLedgerObservation(store, relativePath);
  const current = currentObservation.registration;
  if (current === null) throw new Error('Generated-state retirement has no birth registration.');
  if (current.registrationDigest !== input.expectedRegistrationDigest) {
    throw new Error('Generated-state retirement is not bound to the producer session registration.');
  }
  const outcome = input.outcome.trim();
  if (outcome.length === 0) throw new Error('Generated-state retirement outcome is empty.');
  const retirementRef = generatedStateOwnerRetirementRef(current, outcome);
  if (current.phase === 'retired') {
    if (current.retirementRef === retirementRef) return current;
    throw new Error('Generated-state registration was retired by a different authority.');
  }
  const retired = retireGeneratedStateRegistration(current, retirementRef, {
    clock: options.clock
  });
  const previousRecordDigest = currentObservation.tip?.recordDigest ?? null;
  if (previousRecordDigest === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state retirement has no immutable predecessor ledger: ${relativePath}.`
    );
  }
  persistRegistration(store, retired, pointer.snapshot, previousRecordDigest);
  await store.assertCurrent();
  return retired;
}

async function retireGeneratedState(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expectedRegistrationDigest: `sha256:${string}`;
  outcome: string;
}>, options: GeneratedStateLifecycleOptions = {}): Promise<GeneratedStateRegistration> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  return withGeneratedStateMutationLease(workspaceRoot, options, (store) =>
    retireGeneratedStateInStore(store, input, options));
}

/**
 * Re-activate one exact retired registration after an operation-owned
 * rollback.  This is deliberately distinct from birth: the predecessor
 * registration digest and physical preimage must both be supplied, and the
 * new active registration carries a deterministic restore operation id.
 */
async function restoreGeneratedStateRegistration(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expectedRegistrationDigest: `sha256:${string}`;
  expectedPhysical: GeneratedStatePhysicalIdentity;
  outcome: string;
}>, options: GeneratedStateLifecycleOptions = {}): Promise<GeneratedStateRegistration> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = requireRule(relativePath);
  return withGeneratedStateMutationLease(workspaceRoot, options, async (store) => {
    const pointer = inspectRegistrationPointer(store, relativePath);
    const currentObservation = readRegistrationLedgerObservation(store, relativePath);
    const current = currentObservation.registration;
    if (current === null || current.phase !== 'retired' ||
        current.registrationDigest !== input.expectedRegistrationDigest) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state restore predecessor is missing, active, foreign, or stale: ${relativePath}.`
      );
    }
    const workspace = inspectNoFollowDirectoryChain(
      workspaceRoot,
      'Generated-state restore workspace root'
    ).target;
    const observed = observeRoot(workspaceRoot, relativePath);
    if (observed.identity === null || !samePhysicalIdentity(observed.identity, input.expectedPhysical) ||
        !samePhysicalIdentity(observed.identity, current.root) ||
        physicalFormForObservedKind(rule, observed.kind) === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state restore physical preimage differs from its retired predecessor: ${relativePath}.`
      );
    }
    const outcome = input.outcome.trim();
    if (outcome.length === 0) throw new GeneratedStateProducerBindingBlockedError('Generated-state restore outcome is empty.');
    const restoreOperationId = generatedStateDigest(Object.freeze({
      schema: 'sec-generated-state-restore-v1',
      predecessorRegistrationDigest: current.registrationDigest,
      predecessorRetirementRef: current.retirementRef,
      relativePath,
      physical: input.expectedPhysical,
      outcome
    }));
    const restored = createGeneratedStateRegistration({
      repositoryRoot,
      workspace: identityOf(workspace),
      rule,
      relativePath,
      root: observed.identity,
      operationId: `restore:${restoreOperationId}`
    }, { clock: options.clock });
    const previousRecordDigest = currentObservation.tip?.recordDigest ?? null;
    if (previousRecordDigest === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state restore has no immutable predecessor ledger: ${relativePath}.`
      );
    }
    persistRegistration(store, restored, pointer.snapshot, previousRecordDigest);
    await store.assertCurrent();
    return restored;
  });
}

type GeneratedStateRetirementObservationStatus =
  | 'active'
  | 'retired-present'
  | 'retired-predecessor'
  | 'retired-domain-settled'
  | 'absent'
  | 'mismatch';

export interface GeneratedStateRetirementObservation {
  readonly schema: 'sec-generated-state-retirement-observation-v1';
  readonly status: GeneratedStateRetirementObservationStatus;
  readonly relativePath: string;
  readonly registrationDigest: `sha256:${string}` | null;
  readonly physical: GeneratedStatePhysicalIdentity | null;
  readonly observationDigest: `sha256:${string}`;
}

const issuedGeneratedStateRetirementObservations = new WeakSet<object>();

export function assertGeneratedStateRetirementObservation(
  observation: GeneratedStateRetirementObservation
): void {
  if (!issuedGeneratedStateRetirementObservations.has(observation)) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state retirement observation was not issued by its owner.'
    );
  }
}

const issuedGeneratedStateDisposalReceipts = new WeakSet<object>();

export function assertGeneratedStateDisposalReceipt(
  receipt: GeneratedStateDisposalReceipt
): void {
  if (!issuedGeneratedStateDisposalReceipts.has(receipt)) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state disposal receipt was not issued by its owner.'
    );
  }
}

function generatedStateDisposalReceiptPath(
  store: GeneratedStateRuntimeStore,
  input: Readonly<{
    relativePath: string;
    profile: GeneratedStateCleanupProfile;
    registrationDigest: `sha256:${string}`;
    retirementRef: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentity;
  }>
): string {
  const key = generatedStateDigest(Object.freeze({
    schema: GENERATED_STATE_DISPOSAL_KEY_SCHEMA,
    relativePath: input.relativePath,
    profile: input.profile,
    registrationDigest: input.registrationDigest,
    retirementRef: input.retirementRef,
    physical: input.physical
  }));
  return path.join(store.settlementsRoot, `disposal-${key.slice('sha256:'.length)}.json`);
}

function parseGeneratedStateDisposalReceiptBytes(
  source: string,
  label: string
): GeneratedStateDisposalReceipt {
  let unknownValue: unknown;
  try {
    unknownValue = JSON.parse(source);
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `${label} is not exact JSON: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  if (unknownValue === null || typeof unknownValue !== 'object' || Array.isArray(unknownValue)) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} is not one canonical object.`);
  }
  const value = unknownValue as Record<string, unknown>;
  const expectedKeys = [
    'afterInventoryDigest',
    'beforeInventoryDigest',
    'physical',
    'profile',
    'receiptDigest',
    'registrationDigest',
    'relativePath',
    'retirementRef',
    'schema',
    'settlementDigest',
    'terminal'
  ];
  if (Object.keys(value).sort().join('\0') !== expectedKeys.join('\0')) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} has noncanonical keys.`);
  }
  let physical: GeneratedStatePhysicalIdentity;
  try {
    physical = parseGeneratedStatePhysicalIdentity(value.physical, `${label}.physical`);
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `${label} has malformed physical identity: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  if (value.schema !== GENERATED_STATE_DISPOSAL_RECEIPT_SCHEMA ||
      typeof value.relativePath !== 'string' ||
      value.relativePath !== normalizeGeneratedStateRelativePath(value.relativePath) ||
      !['automatic', 'safe', 'all-rebuildable'].includes(String(value.profile)) ||
      typeof value.registrationDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.registrationDigest) ||
      typeof value.retirementRef !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.retirementRef) ||
      typeof value.beforeInventoryDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.beforeInventoryDigest) ||
      typeof value.afterInventoryDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.afterInventoryDigest) ||
      typeof value.settlementDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.settlementDigest) ||
      value.terminal !== 'disposed' ||
      typeof value.receiptDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.receiptDigest)) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} is malformed.`);
  }
  const material = Object.freeze({
    schema: value.schema,
    relativePath: value.relativePath,
    profile: value.profile as GeneratedStateCleanupProfile,
    registrationDigest: value.registrationDigest as `sha256:${string}`,
    retirementRef: value.retirementRef as `sha256:${string}`,
    physical,
    beforeInventoryDigest: value.beforeInventoryDigest as `sha256:${string}`,
    afterInventoryDigest: value.afterInventoryDigest as `sha256:${string}`,
    settlementDigest: value.settlementDigest as `sha256:${string}`,
    terminal: value.terminal
  });
  if (generatedStateDigest(material) !== value.receiptDigest) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} digest is invalid.`);
  }
  const receipt = Object.freeze({
    ...material,
    receiptDigest: value.receiptDigest as `sha256:${string}`
  });
  if (canonicalBytes(receipt) !== source) {
    throw new GeneratedStateProducerBindingBlockedError(`${label} bytes are noncanonical.`);
  }
  return receipt;
}

function readGeneratedStateDisposalReceipt(
  store: GeneratedStateRuntimeStore,
  expected: Readonly<{
    relativePath: string;
    profile: GeneratedStateCleanupProfile;
    registrationDigest: `sha256:${string}`;
    retirementRef: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentity;
  }>
): GeneratedStateDisposalReceipt | null {
  const locator = generatedStateDisposalReceiptPath(store, expected);
  if (!store.fs.exists(locator)) return null;
  const receipt = parseGeneratedStateDisposalReceiptBytes(
    store.fs.readText(locator),
    `Generated-state disposal receipt ${expected.relativePath}`
  );
  if (receipt.relativePath !== expected.relativePath || receipt.profile !== expected.profile ||
      receipt.registrationDigest !== expected.registrationDigest ||
      receipt.retirementRef !== expected.retirementRef ||
      !samePhysicalIdentity(receipt.physical, expected.physical)) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal receipt differs from its owner key: ${expected.relativePath}.`
    );
  }
  return receipt;
}

async function observeGeneratedStateRetirement(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expected?: GeneratedStateProducerBindingExpectation;
}>, options: GeneratedStateLifecycleOptions = {}): Promise<GeneratedStateRetirementObservation> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = requireRetirementRule(relativePath, input.expected);
  const store = openRuntimeStoreReadOnly(workspaceRoot, options);
  const observed = observeRoot(workspaceRoot, relativePath);
  let status: GeneratedStateRetirementObservationStatus = 'absent';
  let registrationDigest: `sha256:${string}` | null = null;
  let registrationPhysical: GeneratedStatePhysicalIdentity | null = null;
  if (store !== null) {
    const ledger = readRegistrationLedgerObservation(store, relativePath);
    const registration = ledger.registration;
    const expected = input.expected;
    if (registration !== null) {
      registrationDigest = registration.registrationDigest;
      registrationPhysical = registration.root;
      const exactRegistration = path.resolve(registration.repositoryRoot) === repositoryRoot &&
        registration.relativePath === relativePath && registration.ruleId === rule.id &&
        (expected?.owner === undefined || expected.owner === registration.owner) &&
        (expected?.producer === undefined || expected.producer === registration.producer) &&
        (expected?.ruleId === undefined || expected.ruleId === registration.ruleId) &&
        (expected?.physical === undefined || samePhysicalIdentity(expected.physical, registration.root));
      const exactPhysical = observed.identity !== null && samePhysicalIdentity(observed.identity, registration.root);
      // A displaced retirement is a fact about the exact old registration,
      // never authority over the object now occupying its path. Require every
      // owner coordinate and the caller's recorded predecessor identity.
      const exactRetiredPredecessor = exactRegistration && registration.phase === 'retired' &&
        expected?.owner !== undefined && expected.producer !== undefined &&
        expected.ruleId !== undefined && expected.physical !== undefined;
      status = exactRegistration && exactPhysical
        ? registration.phase === 'active' ? 'active' : 'retired-present'
        : exactRetiredPredecessor ? 'retired-predecessor' : 'mismatch';
    } else if (ledger.retiredPredecessor !== null) {
      registrationDigest = ledger.retiredPredecessor.registrationDigest;
      registrationPhysical = ledger.retiredPredecessor.root;
      const exact = path.resolve(ledger.retiredPredecessor.repositoryRoot) === repositoryRoot &&
        ledger.retiredPredecessor.relativePath === relativePath &&
        ledger.retiredPredecessor.ruleId === rule.id &&
        (expected?.owner === undefined || expected.owner === ledger.retiredPredecessor.owner) &&
        (expected?.producer === undefined || expected.producer === ledger.retiredPredecessor.producer) &&
        (expected?.ruleId === undefined || expected.ruleId === ledger.retiredPredecessor.ruleId) &&
        (expected?.physical === undefined || samePhysicalIdentity(expected.physical, ledger.retiredPredecessor.root));
      status = exact && observed.kind === 'missing' ? 'retired-domain-settled' : 'mismatch';
    } else {
      status = observed.kind === 'missing' ? 'absent' : 'mismatch';
    }
  } else {
    status = observed.kind === 'missing' ? 'absent' : 'mismatch';
  }
  const physical = status === 'retired-predecessor'
    ? registrationPhysical : observed.identity ?? registrationPhysical;
  const unsigned = Object.freeze({
    schema: 'sec-generated-state-retirement-observation-v1' as const,
    status,
    relativePath,
    registrationDigest,
    physical
  });
  const observation = Object.freeze({
    ...unsigned,
    observationDigest: generatedStateDigest(unsigned)
  });
  issuedGeneratedStateRetirementObservations.add(observation);
  return observation;
}

export interface GeneratedStateRetiredPredecessorRetraction {
  readonly observation: GeneratedStateRetirementObservation;
  readonly physical: GeneratedStatePhysicalIdentity;
  readonly retract: () => Promise<void>;
}

async function disposeRetiredGeneratedStateDomain(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expected?: GeneratedStateProducerBindingExpectation;
  retraction?: GeneratedStateRetiredPredecessorRetraction;
}>, options: GeneratedStateLifecycleOptions = {}): Promise<boolean> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = requireRule(relativePath);
  const expected = input.expected === undefined ? undefined : Object.freeze({ ...input.expected,
    ...(input.expected.physical === undefined ? {} : { physical: Object.freeze({ ...input.expected.physical }) }) });
  const requestedRetraction = input.retraction;
  const retraction = requestedRetraction === undefined ? undefined : Object.freeze({
    observation: requestedRetraction.observation,
    physical: Object.freeze({ ...requestedRetraction.physical }),
    retract: requestedRetraction.retract.bind(requestedRetraction)
  });
  if (retraction !== undefined) assertGeneratedStateRetirementObservation(retraction.observation);
  return withGeneratedStateMutationLease(workspaceRoot, options, async (store) => {
    const observation = readRegistrationLedgerObservation(store, relativePath);
    const registration = observation.registration;
    if (registration === null) {
      if (retraction !== undefined) throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state retired predecessor is no longer current: ${relativePath}.`
      );
      return observation.retiredPredecessor !== null && observeRoot(workspaceRoot, relativePath).kind === 'missing';
    }
    if (registration.phase !== 'retired') return false;
    if (path.resolve(registration.repositoryRoot) !== repositoryRoot ||
        registration.relativePath !== relativePath || registration.ruleId !== rule.id ||
        (expected?.owner !== undefined && expected.owner !== registration.owner) ||
        (expected?.producer !== undefined && expected.producer !== registration.producer) ||
        (expected?.ruleId !== undefined && expected.ruleId !== registration.ruleId) ||
        (expected?.physical !== undefined && !samePhysicalIdentity(expected.physical, registration.root))) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state retired domain registration is foreign: ${relativePath}.`
      );
    }
    let observed = observeRoot(workspaceRoot, relativePath);
    if (retraction !== undefined) {
      const proof = retraction.observation;
      if (expected?.owner === undefined || expected.producer === undefined || expected.ruleId === undefined ||
          expected.physical === undefined || proof.status !== 'retired-predecessor' ||
          proof.relativePath !== relativePath || proof.registrationDigest !== registration.registrationDigest ||
          proof.physical === null || !samePhysicalIdentity(proof.physical, registration.root) ||
          observed.kind !== 'link' || observed.identity === null ||
          !samePhysicalIdentity(observed.identity, retraction.physical) ||
          samePhysicalIdentity(observed.identity, registration.root) ||
          physicalFormForObservedKind(rule, observed.kind)?.worktreeRetirement?.mode !== 'domain-retire') {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state retired predecessor retraction is foreign or stale: ${relativePath}.`
        );
      }
      // Keep the original ledger mutation lease across the producer's exact
      // CAS effect. An observation alone cannot authorize disposal after a
      // different producer has restored or replaced the registration.
      await store.assertCurrent();
      await retraction.retract();
      await store.assertCurrent();
      observed = observeRoot(workspaceRoot, relativePath);
      if (observed.kind !== 'missing') throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state retired predecessor retraction did not reach absence: ${relativePath}.`
      );
    }
    if (observed.kind !== 'missing') {
      if (observed.identity === null || !samePhysicalIdentity(observed.identity, registration.root)) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state retired domain physical identity changed: ${relativePath}.`
        );
      }
      const physicalForm = physicalFormForObservedKind(rule, observed.kind);
      const retirement = physicalForm?.worktreeRetirement;
      if (retirement?.mode !== 'domain-retire') return false;
      const providers = options.worktreeRetirementProviders?.filter(
        ({ id }) => id === retirement.providerId
      ) ?? [];
      if (providers.length !== 1) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state retired domain provider is unavailable or ambiguous: ${relativePath}.`
        );
      }
      const provider = providers[0]!;
      const plan = await provider.plan({ repositoryRoot, workspaceRoot, relativePath, source: observed.identity, registration });
      if (plan.digest !== generatedStateDomainProviderMaterialDigest(provider.id, 'plan', plan.bytes)) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state retired domain provider plan digest is invalid: ${relativePath}.`
        );
      }
      await store.assertCurrent();
      const effectInput = Object.freeze({
        operationId: generatedStateDigest(Object.freeze({
          schema: 'sec-generated-state-domain-disposal-operation-v1',
          registrationDigest: registration.registrationDigest,
          ledgerRecordDigest: observation.tip?.recordDigest,
          planDigest: plan.digest
        })),
        repositoryRoot,
        workspaceRoot,
        relativePath,
        source: observed.identity,
        registration,
        planBytes: plan.bytes,
        planDigest: plan.digest
      });
      const authority = issueGeneratedStateWorktreeRetirementEffectAuthority(provider.id, effectInput);
      let receipt: Awaited<ReturnType<GeneratedStateWorktreeRetirementProvider['retire']>>;
      try {
        receipt = await provider.retire(authority);
        assertGeneratedStateWorktreeRetirementEffectAuthorityConsumed(authority);
      } finally {
        revokeGeneratedStateWorktreeRetirementEffectAuthority(authority);
      }
      if (receipt.digest !== generatedStateDomainProviderMaterialDigest(provider.id, 'receipt', receipt.bytes) ||
          observeRoot(workspaceRoot, relativePath).kind !== 'missing') {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state retired domain provider did not reach physical absence: ${relativePath}.`
        );
      }
    }
    const locator = registrationPath(store, relativePath);
    if (!store.fs.deleteIfPresent(locator) && store.fs.exists(locator)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state retired domain registration pointer remains: ${relativePath}.`
      );
    }
    const terminal = readRegistrationLedgerObservation(store, relativePath);
    if (terminal.registration !== null ||
        terminal.retiredPredecessor?.registrationDigest !== registration.registrationDigest) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state retired domain terminal readback differs: ${relativePath}.`
      );
    }
    await store.assertCurrent();
    return true;
  });
}

interface GeneratedStateProducerBindingExpectation {
  readonly owner?: string;
  readonly producer?: string;
  readonly ruleId?: string;
  readonly physical?: GeneratedStatePhysicalIdentity;
}

interface GeneratedStateAbsentRegistrationExpectation {
  readonly owner: string;
  readonly producer: string;
  readonly ruleId: string;
  readonly physical: GeneratedStatePhysicalIdentity;
}

type GeneratedStateAbsentRegistrationSettlementReceipt = Readonly<{
  readonly schema: 'sec-generated-state-absent-registration-settlement-v1';
  readonly relativePath: string;
  readonly registrationDigest: `sha256:${string}`;
  readonly retirementRef: `sha256:${string}`;
  readonly physical: GeneratedStatePhysicalIdentity;
  readonly outcome: string;
  readonly terminal: 'disposed';
  readonly receiptDigest: `sha256:${string}`;
}>;

/**
 * Terminalize one exact active registration whose physical generation is
 * already absent.  This is intentionally available only through a producer
 * hook issued for one repository/workspace; generic cleanup never receives
 * authority to retire active state.
 */
async function settleAbsentActiveGeneratedStateRegistration(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expected: GeneratedStateAbsentRegistrationExpectation;
  outcome: string;
}>, options: GeneratedStateLifecycleOptions = {}): Promise<GeneratedStateAbsentRegistrationSettlementReceipt> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = requireRule(relativePath);
  const outcome = input.outcome.trim();
  if (outcome.length === 0) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state absent registration settlement outcome is empty: ${relativePath}.`
    );
  }
  return withGeneratedStateMutationLease(workspaceRoot, options, async (store) => {
    const workspace = inspectNoFollowDirectoryChain(
      workspaceRoot,
      'Generated-state absent registration settlement workspace root'
    ).target;
    const observed = observeRoot(workspaceRoot, relativePath);
    const pointer = inspectRegistrationPointer(store, relativePath);
    const observation = readRegistrationLedgerObservation(store, relativePath);
    const registration = observation.registration;
    const expected = input.expected;
    if (observed.kind !== 'missing' || observed.identity !== null ||
        registration === null || registration.phase !== 'active' ||
        path.resolve(registration.repositoryRoot) !== repositoryRoot ||
        registration.relativePath !== relativePath ||
        registration.ruleId !== rule.id || registration.ruleId !== expected.ruleId ||
        registration.owner !== rule.owner || registration.owner !== expected.owner ||
        registration.producer !== rule.producer || registration.producer !== expected.producer ||
        !sameIdentity(registration.workspace, identityOf(workspace)) ||
        !samePhysicalIdentity(registration.root, expected.physical)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state absent registration settlement preimage is missing, present, foreign, or stale: ${relativePath}.`
      );
    }
    const retirementRef = generatedStateDigest(Object.freeze({
      schema: 'sec-generated-state-owner-retirement-v1',
      registrationId: registration.registrationId,
      registrationDigest: registration.registrationDigest,
      relativePath: registration.relativePath,
      owner: registration.owner,
      producer: registration.producer,
      operationId: registration.operationId,
      outcome
    }));
    const retired = retireGeneratedStateRegistration(registration, retirementRef, {
      clock: options.clock
    });
    const previousRecordDigest = observation.tip?.recordDigest ?? null;
    if (previousRecordDigest === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state absent registration settlement has no immutable predecessor: ${relativePath}.`
      );
    }
    persistRegistration(store, retired, pointer.snapshot, previousRecordDigest);
    await store.assertCurrent();
    if (observeRoot(workspaceRoot, relativePath).kind !== 'missing') {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state absent registration settlement physical state reappeared: ${relativePath}.`
      );
    }
    const locator = registrationPath(store, relativePath);
    if (!store.fs.deleteIfPresent(locator) && store.fs.exists(locator)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state absent registration settlement pointer remains: ${relativePath}.`
      );
    }
    const terminal = readRegistrationLedgerObservation(store, relativePath);
    if (terminal.registration !== null ||
        terminal.retiredPredecessor?.registrationDigest !== retired.registrationDigest ||
        terminal.retiredPredecessor.retirementRef !== retirementRef ||
        observeRoot(workspaceRoot, relativePath).kind !== 'missing') {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state absent registration settlement readback differs: ${relativePath}.`
      );
    }
    await store.assertCurrent();
    const receiptMaterial = Object.freeze({
      schema: 'sec-generated-state-absent-registration-settlement-v1' as const,
      relativePath,
      registrationDigest: registration.registrationDigest,
      retirementRef,
      physical: registration.root,
      outcome,
      terminal: 'disposed' as const
    });
    return Object.freeze({
      ...receiptMaterial,
      receiptDigest: generatedStateDigest(receiptMaterial)
    });
  });
}

/**
 * Adopt an issuer-created active registration without creating or replacing
 * any registration bytes.  This is the only lifecycle entry point a producer
 * may use when it is about to retire an already-published physical root from
 * a fresh process.
 */
async function bindGeneratedStateRegistration(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expected?: GeneratedStateProducerBindingExpectation;
}>, options: GeneratedStateLifecycleOptions = {}): Promise<GeneratedStateRegistration> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = requireRetirementRule(relativePath, input.expected);
  if (rule.registration !== 'required-at-birth') {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding is only valid for required-at-birth state: ${relativePath}.`
    );
  }

  let workspace: PhysicalDirectoryIdentity;
  let observed: ObservedGeneratedStateRoot;
  try {
    workspace = inspectNoFollowDirectoryChain(
      workspaceRoot,
      'Generated-state producer binding workspace root'
    ).target;
    observed = observeRoot(workspaceRoot, relativePath);
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding could not observe ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
  if (observed.identity === null || physicalFormForObservedKind(rule, observed.kind) === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding found no supported physical root: ${relativePath}.`
    );
  }
  const expected = input.expected;
  if (expected?.owner !== undefined && expected.owner !== rule.owner) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding owner differs from the registry: ${relativePath}.`
    );
  }
  if (expected?.producer !== undefined && expected.producer !== rule.producer) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding producer differs from the registry: ${relativePath}.`
    );
  }
  if (expected?.ruleId !== undefined && expected.ruleId !== rule.id) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding rule differs from the registry: ${relativePath}.`
    );
  }
  if (expected?.physical !== undefined && !samePhysicalIdentity(expected.physical, observed.identity)) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding physical identity differs: ${relativePath}.`
    );
  }


  await ensureGeneratedStateRegistrationLedger({
    repositoryRoot,
    workspaceRoot
  }, options);

  const store = openRuntimeStoreReadOnly(workspaceRoot, options);
  if (store === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding has no durable registration store: ${relativePath}.`
    );
  }
  let registration: GeneratedStateRegistration | null;
  let registrationLedgerObservation: GeneratedStateRegistrationLedgerObservation;
  try {
    registrationLedgerObservation = readRegistrationLedgerObservation(store, relativePath);
    registration = registrationLedgerObservation.registration;
  } catch (error) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding registration is invalid: ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
  }
  if (registration === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding has no registration: ${relativePath}.`
    );
  }
  if (registration.phase !== 'active') {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding requires an active registration: ${relativePath}.`
    );
  }
  if (path.resolve(registration.repositoryRoot) !== repositoryRoot ||
      registration.relativePath !== relativePath ||
      registration.ruleId !== rule.id ||
      registration.owner !== rule.owner ||
      registration.producer !== rule.producer ||
      !sameIdentity(registration.workspace, identityOf(workspace)) ||
      !samePhysicalIdentity(registration.root, observed.identity)) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding registration is foreign or physically stale: ${relativePath}.`
    );
  }
  const readback = readRegistrationLedgerObservation(store, relativePath);
  if (readback.registration?.registrationDigest !== registration.registrationDigest ||
      readback.tip?.registrationDigest !== registrationLedgerObservation.tip?.registrationDigest) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state producer binding ledger tip changed during physical admission: ${relativePath}.`
    );
  }
  await store.assertCurrent();
  return registration;
}

function knownPathOrAncestor(relativePath: string): boolean {
  return GENERATED_STATE_REGISTRY.rules.some(({ selector }) => {
    const target = selector.kind === 'exact' ? selector.path : selector.parent;
    return relativePath === target || target.startsWith(`${relativePath}/`);
  });
}

function candidatePaths(workspaceRoot: string): readonly string[] {
  const candidates = new Set<string>();
  for (const rule of GENERATED_STATE_REGISTRY.rules) {
    if (rule.selector.kind === 'exact') {
      candidates.add(rule.selector.path);
      continue;
    }
    const parentPath = path.join(workspaceRoot, ...rule.selector.parent.split('/'));
    try {
      for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
        if (entry.name.startsWith(rule.selector.prefix)) {
          candidates.add(`${rule.selector.parent}/${entry.name}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  for (const parent of new Set([
    '.tmp',
    ...GENERATED_STATE_REGISTRY.rules.flatMap(({ selector }) =>
      selector.kind === 'direct-child-prefix' ? [selector.parent] : [])
  ])) {
    const parentPath = path.join(workspaceRoot, ...parent.split('/'));
    try {
      for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
        const relativePath = `${parent}/${entry.name}`;
        if (!knownPathOrAncestor(relativePath)) candidates.add(relativePath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return Object.freeze([...candidates].sort());
}

async function workspaceRegistrationState(
  repositoryRoot: string,
  workspaceRoot: string,
  options: GeneratedStateLifecycleOptions
): Promise<GeneratedStateInventory['workspaceRegistration']> {
  const result = await (options.runGit ?? ((command, args, runOptions) =>
    runCommandBytes(command, args, { cwd: runOptions.cwd })))(
      'git', ['worktree', 'list', '--porcelain', '-z'], { cwd: repositoryRoot }
    );
  if (result.code !== 0) return 'unresolved';
  try {
    const key = path.resolve(workspaceRoot).toLocaleLowerCase('en-US');
    return parseWorktreePorcelainZ(result.stdout).some((record) =>
      path.resolve(record.path).toLocaleLowerCase('en-US') === key
    ) ? 'registered' : 'absent';
  } catch {
    return 'unresolved';
  }
}

interface GeneratedStateWorktreeRetirementIntent {
  readonly schema: 'sec-generated-state-worktree-retirement-intent-v1';
  readonly operationId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspacePath: string;
  readonly workspace: GeneratedStatePhysicalIdentity;
  readonly worktree: { readonly branch: string; readonly headSha: string; readonly treeSha: string };
  readonly statusDigest: `sha256:${string}`;
  readonly inventoryDigest: `sha256:${string}`;
  readonly retentionRoot: ({ readonly path: string } & GeneratedStatePhysicalIdentity) | null;
  readonly entries: readonly (
    | Readonly<{
        action: 'preserve';
        relativePath: string;
        destinationName: string;
        source: GeneratedStatePhysicalIdentity;
        inventoryDigest: `sha256:${string}`;
        ruleIds: readonly string[];
      }>
    | Readonly<{
        action: 'domain-retire';
        relativePath: string;
        source: GeneratedStatePhysicalIdentity;
        inventoryDigest: `sha256:${string}`;
        ruleIds: readonly string[];
        registration: GeneratedStateRegistration;
        providerId: string;
        providerPlanBytes: string;
        providerPlanDigest: `sha256:${string}`;
      }>
  )[];
  readonly intentDigest: `sha256:${string}`;
}

const WORKTREE_RETIREMENT_ACTIVE_POINTER = 'worktree-retirement-active.json';
const WORKTREE_RETIREMENT_LATEST_POINTER = 'worktree-retirement-latest.json';

export class GeneratedStateWorktreeRetirementBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeneratedStateWorktreeRetirementBlockedError';
  }
}

export function isGeneratedStateWorktreeRetirementBlocked(error: unknown): error is GeneratedStateWorktreeRetirementBlockedError {
  return error instanceof GeneratedStateWorktreeRetirementBlockedError;
}

function worktreeRetirementIntent(
  input: Omit<GeneratedStateWorktreeRetirementIntent, 'schema' | 'intentDigest'>
): GeneratedStateWorktreeRetirementIntent {
  const material = Object.freeze({
    schema: 'sec-generated-state-worktree-retirement-intent-v1' as const,
    ...input,
    entries: Object.freeze([...input.entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath)))
  });
  return Object.freeze({ ...material, intentDigest: generatedStateDigest(material) });
}

function parseWorktreeRetirementIntent(value: unknown): GeneratedStateWorktreeRetirementIntent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Generated-state worktree retirement intent is not an object.');
  }
  const candidate = value as GeneratedStateWorktreeRetirementIntent;
  if (
    candidate.schema !== 'sec-generated-state-worktree-retirement-intent-v1' ||
    !Array.isArray(candidate.entries) ||
    typeof candidate.intentDigest !== 'string'
  ) {
    throw new Error('Generated-state worktree retirement intent is malformed.');
  }
  const rebuilt = worktreeRetirementIntent({
    operationId: candidate.operationId,
    repositoryRoot: candidate.repositoryRoot,
    workspacePath: candidate.workspacePath,
    workspace: candidate.workspace,
    worktree: candidate.worktree,
    statusDigest: candidate.statusDigest,
    inventoryDigest: candidate.inventoryDigest,
    retentionRoot: candidate.retentionRoot,
    entries: candidate.entries
  });
  if (rebuilt.intentDigest !== candidate.intentDigest || generatedStateDigest(rebuilt) !== generatedStateDigest(candidate)) {
    throw new Error('Generated-state worktree retirement intent digest is invalid.');
  }
  return candidate;
}

function rulesOwningGeneratedPath(relativePath: string): readonly GeneratedStateRule[] {
  return GENERATED_STATE_REGISTRY.rules.filter(({ selector }) => {
    if (selector.kind === 'exact') {
      return relativePath === selector.path || relativePath.startsWith(`${selector.path}/`);
    }
    if (!relativePath.startsWith(`${selector.parent}/`)) return false;
    const child = relativePath.slice(selector.parent.length + 1).split('/')[0]!;
    return child.startsWith(selector.prefix);
  });
}

function rulesBelowGeneratedPath(relativePath: string): readonly GeneratedStateRule[] {
  return GENERATED_STATE_REGISTRY.rules.filter(({ selector }) => {
    const anchor = selector.kind === 'exact' ? selector.path : selector.parent;
    return anchor === relativePath || anchor.startsWith(`${relativePath}/`);
  });
}

async function exactIgnoredRootPlan(
  repositoryRoot: string,
  workspaceRoot: string,
  relativePath: string,
  excludedOwnerAnchor: string | null,
  store: GeneratedStateRuntimeStore,
  options: GeneratedStateLifecycleOptions
): Promise<GeneratedStateWorktreeRetirementIntent['entries'][number]> {
  const observed = observeRoot(workspaceRoot, relativePath);
  const withoutExcludedOwner = (rules: readonly GeneratedStateRule[]) => rules.filter(({ selector }) =>
    (selector.kind === 'exact' ? selector.path : selector.parent) !== excludedOwnerAnchor
  );
  const directOwners = withoutExcludedOwner(rulesOwningGeneratedPath(relativePath));
  if (observed.identity === null || directOwners.length === 0) {
    if (observed.kind !== 'directory' || observed.directory === null) {
      throw new GeneratedStateWorktreeRetirementBlockedError(
        `Generated-state worktree retirement found an unowned physical root: ${relativePath}.`
      );
    }
  }
  const inventory =
    directOwners.length > 0
      ? Object.freeze([])
      : scanNoFollowDirectoryTreeMetadata(observed.directory!, {
          deadlineAtMs: performance.now() + CLEANUP_DEADLINE_MS,
          maximumEntries: MAXIMUM_CLEANUP_ENTRIES
        });
  const descendantRules = withoutExcludedOwner(rulesBelowGeneratedPath(relativePath));
  if (directOwners.length === 0 && descendantRules.length === 0) {
    throw new GeneratedStateWorktreeRetirementBlockedError(
      `Generated-state worktree retirement found an unknown ignored root: ${relativePath}.`
    );
  }
  // An empty ancestor is covered by the registered roots beneath it. Inventory
  // still checks every present child against those rules before relocation.
  const coveredRules = new Set([...directOwners, ...descendantRules].map(({ id }) => id));
  for (const entry of inventory) {
    const childPath = `${relativePath}/${entry.relativePath}`;
    const owners = withoutExcludedOwner(rulesOwningGeneratedPath(childPath));
    const descendants = withoutExcludedOwner(rulesBelowGeneratedPath(childPath));
    if (owners.length === 0 && descendants.length === 0) {
      throw new GeneratedStateWorktreeRetirementBlockedError(`Generated-state worktree retirement found unknown content: ${childPath}.`);
    }
    for (const rule of [...owners, ...descendants]) coveredRules.add(rule.id);
  }
  const source = observed.identity;
  if (source === null) {
    throw new GeneratedStateWorktreeRetirementBlockedError(
      `Generated-state worktree retirement cannot identify root: ${relativePath}.`
    );
  }
  const directForm = directOwners.length === 1
    ? physicalFormForObservedKind(directOwners[0]!, observed.kind)
    : null;
  if (directOwners.length > 0 && directForm === null) {
    throw new GeneratedStateWorktreeRetirementBlockedError(
      `Generated-state worktree retirement physical form is not registered: ${relativePath}.`
    );
  }
  if (directForm?.worktreeRetirement.mode === 'domain-retire') {
    const providerId = directForm.worktreeRetirement.providerId;
    const registration = loadRegistration(store, relativePath);
    if (registration === null ||
        registration.ruleId !== directOwners[0]!.id || !sameIdentity(registration.root, source)) {
      throw new GeneratedStateWorktreeRetirementBlockedError(
        `Generated-state worktree retirement lacks one exact domain registration: ${relativePath}.`
      );
    }
    const providers = options.worktreeRetirementProviders?.filter(({ id }) =>
      id === providerId
    ) ?? [];
    if (providers.length !== 1) {
      throw new GeneratedStateWorktreeRetirementBlockedError(
        `Generated-state worktree retirement provider is unavailable or ambiguous: ${providerId}.`
      );
    }
    const provider = providers[0]!;
    const plan = await provider.plan({ repositoryRoot, workspaceRoot, relativePath, source, registration });
    if (plan.digest !== generatedStateDomainProviderMaterialDigest(provider.id, 'plan', plan.bytes)) {
      throw new Error(`Generated-state worktree retirement provider plan digest is invalid: ${provider.id}.`);
    }
    return Object.freeze({
      action: 'domain-retire' as const,
      relativePath,
      source,
      inventoryDigest: generatedStateDigest({ relativePath, source, providerId: provider.id, providerPlanDigest: plan.digest }),
      ruleIds: Object.freeze([...coveredRules].sort()),
      registration,
      providerId: provider.id,
      providerPlanBytes: plan.bytes,
      providerPlanDigest: plan.digest
    });
  }
  if (observed.kind !== 'directory' || observed.directory === null) {
    throw new GeneratedStateWorktreeRetirementBlockedError(
      `Generated-state worktree retirement only preserves ordinary directory roots: ${relativePath}.`
    );
  }
  return Object.freeze({
    action: 'preserve' as const,
    relativePath,
    destinationName: `g-${generatedStateDigest({ relativePath, source }).slice('sha256:'.length)}`,
    source,
    inventoryDigest: generatedStateDigest({ relativePath, source, inventory }),
    ruleIds: Object.freeze([...coveredRules].sort())
  });
}

async function worktreeRetirementDomainRegistration(
  intent: GeneratedStateWorktreeRetirementIntent,
  entry: Extract<GeneratedStateWorktreeRetirementIntent['entries'][number], { action: 'domain-retire' }>,
  store: GeneratedStateRuntimeStore,
  options: GeneratedStateLifecycleOptions
): Promise<GeneratedStateRegistration> {
  const planned = entry.registration;
  const outcome = `worktree-retirement:${intent.operationId}`;
  let observation = readRegistrationLedgerObservation(store, entry.relativePath);
  let registration = observation.registration;
  if (planned.phase === 'active') {
    if (registration?.phase === 'active' &&
        registration.registrationDigest === planned.registrationDigest) {
      registration = await retireGeneratedStateInStore(store, {
        repositoryRoot: intent.repositoryRoot,
        workspaceRoot: intent.workspacePath,
        relativePath: entry.relativePath,
        expectedRegistrationDigest: planned.registrationDigest,
        outcome
      }, options);
      observation = readRegistrationLedgerObservation(store, entry.relativePath);
    }
    const expectedRetirementRef = generatedStateOwnerRetirementRef(planned, outcome);
    if (registration?.phase !== 'retired' ||
        registration.retirementRef !== expectedRetirementRef ||
        observation.previousRegistration?.registrationDigest !== planned.registrationDigest) {
      throw new Error(
        `Generated-state worktree retirement registration transition changed: ${entry.relativePath}.`
      );
    }
  } else if (registration?.phase !== 'retired' ||
      registration.registrationDigest !== planned.registrationDigest) {
    throw new Error(
      `Generated-state worktree retirement retired registration changed: ${entry.relativePath}.`
    );
  }
  if (!samePhysicalIdentity(registration.root, entry.source) ||
      path.resolve(registration.repositoryRoot) !== path.resolve(planned.repositoryRoot) ||
      (path.resolve(registration.repositoryRoot) !== intent.repositoryRoot &&
        path.resolve(registration.repositoryRoot) !== intent.workspacePath) ||
      !sameIdentity(registration.workspace, intent.workspace) ||
      registration.relativePath !== planned.relativePath ||
      registration.ruleId !== planned.ruleId ||
      registration.owner !== planned.owner ||
      registration.producer !== planned.producer) {
    throw new Error(
      `Generated-state worktree retirement registration authority differs: ${entry.relativePath}.`
    );
  }
  const finalObservation = readRegistrationLedgerObservation(store, entry.relativePath);
  if (finalObservation.registration?.registrationDigest !== registration.registrationDigest ||
      finalObservation.tip?.registrationDigest !== registration.registrationDigest) {
    throw new Error(
      `Generated-state worktree retirement registration tip changed: ${entry.relativePath}.`
    );
  }
  await store.assertCurrent();
  return registration;
}

async function worktreeRetirementGit(options: GeneratedStateLifecycleOptions, cwd: string, args: string[]): Promise<ByteCommandResult> {
  return (options.runGit ?? ((command, commandArgs, runOptions) => runCommandBytes(command, commandArgs, { cwd: runOptions.cwd })))(
    'git',
    args,
    { cwd }
  );
}

function sameWorktreeRetirementIdentity(left: GeneratedStatePhysicalIdentity, right: GeneratedStatePhysicalIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

async function worktreeRetirementStatus(
  repositoryRoot: string,
  workspaceRoot: string,
  ownedLeaseRelativePath: string,
  options: GeneratedStateLifecycleOptions
): Promise<
  Readonly<{
    statusDigest: `sha256:${string}`;
    ignoredRoots: readonly Readonly<{ relativePath: string; excludedOwnerAnchor: string | null }>[];
    blockedByOrdinaryState: boolean;
  }>
> {
  const status = await worktreeRetirementGit(options, repositoryRoot, [
    '-C',
    workspaceRoot,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignored=matching'
  ]);
  if (status.code !== 0) throw new Error('Generated-state worktree retirement cannot observe Git status.');
  const records = parseWorktreeStatusPorcelainZ(status.stdout);
  type ProjectedStatusRecord = Readonly<{
    record: WorktreeStatusPorcelainRecord;
    excludedOwnerAnchor: string | null;
  }>;
  const retained = records.flatMap<ProjectedStatusRecord>((record): ProjectedStatusRecord[] => {
    const generatedProjection = (record.index === '!' && record.worktree === '!') || (record.index === '?' && record.worktree === '?');
    if (!generatedProjection) return [Object.freeze({ record, excludedOwnerAnchor: null })];
    if (record.path === ownedLeaseRelativePath || record.path.startsWith(`${ownedLeaseRelativePath}/`)) return [];
    if (!ownedLeaseRelativePath.startsWith(`${record.path}/`)) {
      return [Object.freeze({ record, excludedOwnerAnchor: null })];
    }
    const root = inspectNoFollowDirectoryChain(
      path.join(workspaceRoot, ...record.path.split('/')),
      'Generated-state worktree retirement lease ancestor'
    ).target;
    const suffix = ownedLeaseRelativePath.slice(record.path.length + 1);
    const leaseChild = suffix.split('/')[0]!;
    const inventory = scanNoFollowDirectoryTreeMetadata(root, {
      deadlineAtMs: performance.now() + CLEANUP_DEADLINE_MS,
      maximumEntries: MAXIMUM_CLEANUP_ENTRIES
    });
    return [...new Set(inventory.map(({ relativePath }) => relativePath.split('/')[0]!))]
      .filter((topLevel) => topLevel !== leaseChild)
      .sort()
      .map((topLevel) => Object.freeze({
        record: Object.freeze({ ...record, path: `${record.path}/${topLevel}` }),
        excludedOwnerAnchor: record.path
      }));
  });
  const nonIgnored = retained.filter(({ record: { index, worktree } }) => index !== '!' || worktree !== '!');
  const ignoredRoots = retained.map(({ record: { path: relativePath }, excludedOwnerAnchor }) => Object.freeze({
    relativePath: normalizeGeneratedStateRelativePath(relativePath),
    excludedOwnerAnchor
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  for (let index = 0; index < ignoredRoots.length; index += 1) {
    if (ignoredRoots.some((candidate, candidateIndex) =>
      candidateIndex !== index && ignoredRoots[index]!.relativePath.startsWith(`${candidate.relativePath}/`)
    )) {
      throw new GeneratedStateWorktreeRetirementBlockedError(
        `Generated-state worktree retirement ignored roots overlap: ${ignoredRoots[index]!.relativePath}.`
      );
    }
  }
  return Object.freeze({
    statusDigest: generatedStateDigest({ records: retained }),
    ignoredRoots: Object.freeze(ignoredRoots),
    blockedByOrdinaryState:
      nonIgnored.length > 0 || ignoredRoots.some(({ relativePath }) => ownedLeaseRelativePath.startsWith(`${relativePath}/`))
  });
}

function validateWorktreeRetirementReceiptPhysical(receipt: GeneratedStateWorktreeRetirement): GeneratedStateWorktreeRetirement {
  assertGeneratedStateWorktreeRetirement(receipt);
  const retentionRoot = receipt.retentionRoot === null
    ? null
    : inspectNoFollowDirectoryChain(
        receipt.retentionRoot.path,
        'Generated-state worktree retirement retained root'
      ).target;
  if (retentionRoot !== null && !sameWorktreeRetirementIdentity(identityOf(retentionRoot), receipt.retentionRoot!)) {
    throw new Error('Generated-state worktree retirement retained root identity changed.');
  }
  for (const entry of receipt.entries) {
    if (observeRoot(receipt.workspacePath, entry.relativePath).kind !== 'missing') {
      throw new Error(`Generated-state worktree retirement source reappeared: ${entry.relativePath}.`);
    }
    if (entry.action === 'domain-retired') continue;
    if (retentionRoot === null) {
      throw new Error('Generated-state worktree retirement preserved entry lacks a retention root.');
    }
    const retained = inspectNoFollowDirectoryChain(
      path.join(retentionRoot.path, entry.destinationName),
      `Generated-state worktree retirement retained ${entry.relativePath}`
    ).target;
    if (
      !sameWorktreeRetirementIdentity(identityOf(retained), entry.retained) ||
      !sameWorktreeRetirementIdentity(entry.source, entry.retained)
    ) {
      throw new Error(`Generated-state worktree retirement retained identity changed: ${entry.relativePath}.`);
    }
  }
  return receipt;
}

export function assertGeneratedStateWorktreeRetirementEffectStart(
  input: Readonly<{
    receipt: GeneratedStateWorktreeRetirement;
    repositoryRoot: string;
    workspaceRoot: string;
    expectedBranch: string;
    expectedHeadSha: string;
    expectedTreeSha: string;
  }>
): GeneratedStateWorktreeRetirement {
  const receipt = validateWorktreeRetirementReceiptPhysical(input.receipt);
  if (
    path.resolve(input.repositoryRoot) !== receipt.repositoryRoot ||
    path.resolve(input.workspaceRoot) !== receipt.workspacePath ||
    input.expectedBranch !== receipt.worktree.branch ||
    input.expectedHeadSha !== receipt.worktree.headSha ||
    input.expectedTreeSha !== receipt.worktree.treeSha ||
    receipt.terminal !== 'completed'
  ) {
    throw new Error('Generated-state worktree retirement Effect-start binding changed.');
  }
  return receipt;
}

export async function settleGeneratedStateForWorktreeRetirement(
  input: Readonly<{
    repositoryRoot: string;
    workspaceRoot: string;
    expectedBranch: string;
    expectedHeadSha: string;
    expectedTreeSha: string;
  }>,
  options: GeneratedStateLifecycleOptions = {}
): Promise<GeneratedStateWorktreeRetirement | null> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  return withAcquiredResource({
    operationLabel: 'generated-state-worktree-retirement-operation',
    resourceLabel: 'generated-state-workspace-write-lease',
    acquire: () => acquireWorkspaceWriteLease(workspaceRoot),
    use: async (lease) => {
    await lease.assertOwned();
    const ownedNamespace = await lease.ownedNamespace();
    const workspace = inspectNoFollowDirectoryChain(workspaceRoot, 'Generated-state worktree retirement workspace').target;
    const worktrees = await worktreeRetirementGit(options, repositoryRoot, ['worktree', 'list', '--porcelain', '-z']);
    if (worktrees.code !== 0) throw new Error('Generated-state worktree retirement cannot observe worktree registry.');
    const records = parseWorktreePorcelainZ(worktrees.stdout);
    const workspaceKey = workspaceRoot.toLocaleLowerCase('en-US');
    const record = records.find((candidate) => path.resolve(candidate.path).toLocaleLowerCase('en-US') === workspaceKey);
    if (
      record === undefined ||
      records[0] === record ||
      record.bare ||
      record.detached ||
      record.locked ||
      record.prunable ||
      record.branch !== input.expectedBranch ||
      record.headSha !== input.expectedHeadSha
    ) {
      throw new Error('Generated-state worktree retirement admission does not match one ordinary linked worktree.');
    }
    const tree = await worktreeRetirementGit(options, repositoryRoot, ['-C', workspaceRoot, 'rev-parse', 'HEAD^{tree}']);
    if (tree.code !== 0 || Buffer.from(tree.stdout).toString('utf8').trim() !== input.expectedTreeSha) {
      throw new Error('Generated-state worktree retirement tree changed before admission.');
    }
    const readOnlyStore = openRuntimeStoreReadOnly(workspaceRoot, options);
    const readOnlyActivePath =
      readOnlyStore === null ? null : path.join(readOnlyStore.transactionsRoot, WORKTREE_RETIREMENT_ACTIVE_POINTER);
    const readOnlyLatestPath = readOnlyStore === null ? null : path.join(readOnlyStore.settlementsRoot, WORKTREE_RETIREMENT_LATEST_POINTER);
    const observedActive =
      readOnlyStore !== null && readOnlyActivePath !== null && readOnlyStore.fs.exists(readOnlyActivePath)
        ? parseWorktreeRetirementIntent(JSON.parse(readOnlyStore.fs.readText(readOnlyActivePath)) as unknown)
        : null;
    const status = await worktreeRetirementStatus(repositoryRoot, workspaceRoot, ownedNamespace.relativePath, options);
    if (status.blockedByOrdinaryState) return null;
    if (observedActive === null && status.ignoredRoots.length === 0) {
      if (readOnlyStore === null || readOnlyLatestPath === null || !readOnlyStore.fs.exists(readOnlyLatestPath)) {
        return null;
      }
      const receipt = validateWorktreeRetirementReceiptPhysical(
        assertGeneratedStateWorktreeRetirement(
          JSON.parse(readOnlyStore.fs.readText(readOnlyLatestPath)) as GeneratedStateWorktreeRetirement
        )
      );
      await readOnlyStore.assertCurrent();
      return receipt;
    }
    const store = await openRuntimeStore(workspaceRoot, options);
    await store.assertCurrent();
    const activePath = path.join(store.transactionsRoot, WORKTREE_RETIREMENT_ACTIVE_POINTER);
    const latestPath = path.join(store.settlementsRoot, WORKTREE_RETIREMENT_LATEST_POINTER);
    let intent = store.fs.exists(activePath) ? parseWorktreeRetirementIntent(JSON.parse(store.fs.readText(activePath)) as unknown) : null;
    if (
      (observedActive === null) !== (intent === null) ||
      (observedActive !== null && intent !== null && observedActive.intentDigest !== intent.intentDigest)
    ) {
      throw new Error('Generated-state worktree retirement active intent changed during admission.');
    }
    if (intent === null) {
      const entries = Object.freeze(await Promise.all(status.ignoredRoots.map(({ relativePath, excludedOwnerAnchor }) =>
        exactIgnoredRootPlan(repositoryRoot, workspaceRoot, relativePath, excludedOwnerAnchor, store, options)
      )));
      const inventoryDigest = generatedStateDigest(entries);
      const operationId = generatedStateDigest(
        Object.freeze({
          schema: 'sec-generated-state-worktree-retirement-operation-v1',
          repositoryRoot,
          workspacePath: workspaceRoot,
          workspace: identityOf(workspace),
          worktree: {
            branch: input.expectedBranch,
            headSha: input.expectedHeadSha,
            treeSha: input.expectedTreeSha
          },
          statusDigest: status.statusDigest,
          inventoryDigest,
          registryDigest: GENERATED_STATE_REGISTRY.registryDigest
        })
      );
      const needsRetentionRoot = entries.some(({ action }) => action === 'preserve');
      let retentionRoot: PhysicalDirectoryIdentity | null = null;
      if (needsRetentionRoot) {
        const parent = inspectNoFollowDirectoryChain(
          path.dirname(workspaceRoot),
          'Generated-state worktree retirement retention parent'
        ).target;
        const retentionRootPath = path.join(
          path.dirname(workspaceRoot),
          `sec-generated-state-retirement-${operationId.slice('sha256:'.length)}`
        );
        if (inspectExactNoFollowDirectoryPresence(
          retentionRootPath,
          'Generated-state worktree retirement new retention root'
        ).state !== 'absent') {
          throw new Error('Generated-state worktree retirement retention root exists without an active intent.');
        }
        retentionRoot = createNoFollowOrdinaryDirectoryChain(parent, [path.basename(retentionRootPath)]);
        if (retentionRoot.device !== workspace.device ||
            scanNoFollowDirectoryTreeMetadata(retentionRoot, {
              deadlineAtMs: performance.now() + CLEANUP_DEADLINE_MS,
              maximumEntries: MAXIMUM_CLEANUP_ENTRIES
            }).length !== 0) {
          throw new Error('Generated-state worktree retirement new retention root is not one empty same-volume object.');
        }
      }
      intent = worktreeRetirementIntent({
        operationId,
        repositoryRoot,
        workspacePath: workspaceRoot,
        workspace: identityOf(workspace),
        worktree: {
          branch: input.expectedBranch,
          headSha: input.expectedHeadSha,
          treeSha: input.expectedTreeSha
        },
        statusDigest: status.statusDigest,
        inventoryDigest,
        retentionRoot: retentionRoot === null ? null : { path: retentionRoot.path, ...identityOf(retentionRoot) },
        entries
      });
      store.fs.replaceFsync(activePath, canonicalBytes(intent));
      const publishedIntent = parseWorktreeRetirementIntent(
        JSON.parse(store.fs.readText(activePath)) as unknown
      );
      if (publishedIntent.intentDigest !== intent.intentDigest) {
        throw new Error('Generated-state worktree retirement intent changed after publication.');
      }
      intent = publishedIntent;
      await store.assertCurrent();
    }
    if (
      intent.repositoryRoot !== repositoryRoot ||
      intent.workspacePath !== workspaceRoot ||
      !sameWorktreeRetirementIdentity(intent.workspace, identityOf(workspace)) ||
      intent.worktree.branch !== input.expectedBranch ||
      intent.worktree.headSha !== input.expectedHeadSha ||
      intent.worktree.treeSha !== input.expectedTreeSha
    ) {
      throw new Error('Generated-state worktree retirement active intent belongs to another admission.');
    }
    const retentionRoot = intent.retentionRoot === null
      ? null
      : inspectNoFollowDirectoryChain(
          intent.retentionRoot.path,
          'Generated-state worktree retirement retention root'
        ).target;
    if (retentionRoot !== null && (retentionRoot.device !== workspace.device ||
        !sameWorktreeRetirementIdentity(identityOf(retentionRoot), intent.retentionRoot!))) {
      throw new Error('Generated-state worktree retirement retention root identity changed.');
    }
    if (retentionRoot !== null) {
      const knownDestinations = new Set(intent.entries
        .filter((entry) => entry.action === 'preserve')
        .map(({ destinationName }) => destinationName));
      const unknownRetentionEntries = scanNoFollowDirectoryTreeMetadata(retentionRoot, {
        deadlineAtMs: performance.now() + CLEANUP_DEADLINE_MS,
        maximumEntries: MAXIMUM_CLEANUP_ENTRIES
      }).filter(({ relativePath }) => {
        const top = relativePath.split('/')[0]!;
        return !knownDestinations.has(top);
      });
      if (unknownRetentionEntries.length > 0) {
        throw new Error('Generated-state worktree retirement retention root contains unknown content.');
      }
    }
    const retainedEntries = [] as Array<GeneratedStateWorktreeRetirement['entries'][number]>;
    // Domain providers may bind physical inputs inside another ignored root
    // (for example node_modules -> .tmp/dependency-installs/compiler-backups).
    // Consume those plans before relocating any preserved ancestor.
    for (const entry of [...intent.entries].sort((left, right) =>
      Number(right.action === 'domain-retire') - Number(left.action === 'domain-retire')
    )) {
      await lease.assertOwned();
      if (entry.action === 'domain-retire') {
        const providers = options.worktreeRetirementProviders?.filter(({ id }) => id === entry.providerId) ?? [];
        if (providers.length !== 1) {
          throw new GeneratedStateWorktreeRetirementBlockedError(
            `Generated-state worktree retirement provider is unavailable or ambiguous: ${entry.providerId}.`
          );
        }
        const provider = providers[0]!;
        const providerReceipt = await withGeneratedStateMutationLease(
          workspaceRoot,
          options,
          async (mutationStore) => {
            const registration = await worktreeRetirementDomainRegistration(
              intent,
              entry,
              mutationStore,
              options
            );
            const effectInput = Object.freeze({
              operationId: intent.operationId,
              repositoryRoot,
              workspaceRoot,
              relativePath: entry.relativePath,
              source: entry.source,
              registration,
              planBytes: entry.providerPlanBytes,
              planDigest: entry.providerPlanDigest
            });
            const authority = issueGeneratedStateWorktreeRetirementEffectAuthority(
              provider.id,
              effectInput
            );
            let receipt: Awaited<ReturnType<GeneratedStateWorktreeRetirementProvider['retire']>>;
            try {
              receipt = await provider.retire(authority);
              assertGeneratedStateWorktreeRetirementEffectAuthorityConsumed(authority);
            } finally {
              revokeGeneratedStateWorktreeRetirementEffectAuthority(authority);
            }
            await options.afterWorktreeRetirementProviderEffect?.(entry.relativePath);
            if (receipt.digest !== generatedStateDomainProviderMaterialDigest(
              provider.id,
              'receipt',
              receipt.bytes
            )) {
              throw new Error(`Generated-state worktree retirement provider receipt digest is invalid: ${provider.id}.`);
            }
            if (observeRoot(workspaceRoot, entry.relativePath).kind !== 'missing') {
              throw new Error(`Generated-state worktree retirement provider left source present: ${entry.relativePath}.`);
            }
            await worktreeRetirementDomainRegistration(intent, entry, mutationStore, options);
            return receipt;
          }
        );
        retainedEntries.push(Object.freeze({
          relativePath: entry.relativePath,
          source: entry.source,
          inventoryDigest: entry.inventoryDigest,
          ruleIds: entry.ruleIds,
          action: 'domain-retired' as const,
          providerId: entry.providerId,
          providerPlanDigest: entry.providerPlanDigest,
          providerReceiptBytes: providerReceipt.bytes,
          providerReceiptDigest: providerReceipt.digest
        }));
        continue;
      }
      if (retentionRoot === null) {
        throw new Error('Generated-state worktree retirement preserve intent lacks a retention root.');
      }
      const source = observeRoot(workspaceRoot, entry.relativePath);
      const destinationPath = path.join(retentionRoot.path, entry.destinationName);
      const destination = inspectExactNoFollowDirectoryPresence(destinationPath, `Generated-state retained ${entry.relativePath}`);
      let retained: PhysicalDirectoryIdentity;
      if (
        source.kind === 'directory' &&
        source.directory !== null &&
        source.identity !== null &&
        sameWorktreeRetirementIdentity(source.identity, entry.source) &&
        destination.state === 'absent'
      ) {
        retained = relocateRetainedNoFollowDirectoryAcrossParents({
          directory: source.directory,
          destinationParent: retentionRoot,
          tombstoneName: entry.destinationName
        });
        await options.afterWorktreeRetirementRelocation?.(entry.relativePath);
      } else if (
        source.kind === 'missing' &&
        destination.state === 'present' &&
        sameWorktreeRetirementIdentity(identityOf(destination.directory.target), entry.source)
      ) {
        retained = destination.directory.target;
      } else {
        throw new Error(`Generated-state worktree retirement cannot resume exact root: ${entry.relativePath}.`);
      }
      retainedEntries.push(
        Object.freeze({
          ...entry,
          retained: identityOf(retained),
          action: 'preserved' as const
        })
      );
    }
    await lease.assertOwned();
    const receipt = createGeneratedStateWorktreeRetirement({
      operationId: intent.operationId,
      repositoryRoot,
      workspacePath: workspaceRoot,
      workspace: identityOf(workspace),
      worktree: intent.worktree,
      statusDigest: intent.statusDigest,
      inventoryDigest: intent.inventoryDigest,
      retentionRoot: retentionRoot === null ? null : { path: retentionRoot.path, ...identityOf(retentionRoot) },
      entries: Object.freeze(retainedEntries),
      blockers: Object.freeze([])
    });
    const receiptPath = path.join(store.settlementsRoot, `worktree-retirement-${receipt.receiptDigest.slice('sha256:'.length)}.json`);
    const bytes = canonicalBytes(receipt);
    if (!store.fs.createExclusiveFsync(receiptPath, bytes) && store.fs.readText(receiptPath) !== bytes) {
      throw new Error('Generated-state worktree retirement receipt collides with different bytes.');
    }
    store.fs.replaceFsync(latestPath, bytes);
    if (!store.fs.deleteIfPresent(activePath) && store.fs.exists(activePath)) {
      throw new Error('Generated-state worktree retirement active intent remains after completion.');
    }
    await store.assertCurrent();
      return validateWorktreeRetirementReceiptPhysical(receipt);
    },
    release: (lease) => lease.release()
  });
}

export async function inspectGeneratedState(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePaths?: readonly string[];
}>, options: GeneratedStateLifecycleOptions = {}): Promise<GeneratedStateInventory> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const workspace = inspectNoFollowDirectoryChain(workspaceRoot, 'Generated-state workspace root').target;
  const store = openRuntimeStoreReadOnly(workspaceRoot, options);
  const entries: GeneratedStateInventoryEntry[] = [];
  const relativePaths = input.relativePaths === undefined
    ? candidatePaths(workspaceRoot)
    : Object.freeze([...new Set(input.relativePaths.map(normalizeGeneratedStateRelativePath))].sort());
  for (const relativePath of relativePaths) {
    const observed = observeRoot(workspaceRoot, relativePath);
    const activeRule = generatedStateRuleForPath(relativePath);
    const legacyRule = activeRule === null
      ? generatedStateLegacyRetirementRuleForPath(relativePath)
      : null;
    let legacyRegistration: GeneratedStateRegistration | null = null;
    let legacyRegistrationInvalid = false;
    if (activeRule === null && legacyRule !== null && store !== null) {
      try {
        legacyRegistration = loadRegistration(store, relativePath);
      } catch {
        legacyRegistrationInvalid = true;
      }
    }
    const rule = activeRule ?? (
      legacyRule !== null && legacyRegistration !== null
        && legacyRegistration.ruleId === legacyRule.id
        && legacyRegistration.owner === legacyRule.owner
        && legacyRegistration.producer === legacyRule.producer
        ? legacyRule
        : null
    );
    if (rule === null) {
      entries.push(Object.freeze({
        relativePath,
        kind: observed.kind,
        ruleId: null,
        owner: null,
        stateClass: 'unknown-unclassified',
        registrationState: 'missing',
        cleanupProfiles: Object.freeze([]),
        settlement: 'blocked',
        blockers: Object.freeze([legacyRegistrationInvalid
          ? 'legacy-registration-invalid'
          : 'unknown-generated-state']),
        physicalIdentity: observed.identity,
        registrationDigest: null
      }));
      continue;
    }
    let registration: GeneratedStateRegistration | null = null;
    let registrationState: GeneratedStateInventoryEntry['registrationState'] = 'not-required';
    const blockers: string[] = [];
    if (rule.registration === 'required-at-birth') {
      try {
        registration = loadRegistration(store, relativePath);
        registrationState = registration?.phase ?? 'missing';
      } catch {
        registrationState = 'invalid';
        blockers.push('registration-invalid');
      }
      if (registration === null && registrationState !== 'invalid' && observed.kind !== 'missing') {
        blockers.push('registration-missing');
      }
      if (registration?.phase === 'active' && observed.identity === null) {
        blockers.push('active-registered-root-absent');
      }
      if (registration !== null && observed.identity !== null && !sameIdentity(registration.root, observed.identity)) {
        blockers.push('registered-root-identity-changed');
      }
      if (registration?.phase === 'active') blockers.push('owner-active');
    }
    const physicalForm = physicalFormForObservedKind(rule, observed.kind);
    if (observed.kind !== 'missing' && physicalForm === null) {
      blockers.push('root-kind-differs-from-policy');
    }
    if (physicalForm?.settlementEffect === 'domain-owner-only' && observed.kind !== 'missing') {
      blockers.push('domain-owner-settlement-required');
    }
    const ready = observed.identity !== null && blockers.length === 0 && registration?.phase === 'retired';
    entries.push(Object.freeze({
      relativePath,
      kind: observed.kind,
      ruleId: rule.id,
      owner: rule.owner,
      stateClass: rule.stateClass,
      registrationState,
      cleanupProfiles: rule.cleanupProfiles,
      settlement: ready ? 'ready' : 'protected',
      blockers: Object.freeze(blockers.sort()),
      physicalIdentity: observed.identity,
      registrationDigest: registration?.registrationDigest ?? null
    }));
  }
  const blockers = entries.flatMap((entry) => entry.blockers
    .filter((blocker) => blocker !== 'owner-active')
    .map((blocker) => `${entry.relativePath}:${blocker}`));
  await store?.assertCurrent();
  return createGeneratedStateInventory({
    repositoryRoot,
    workspace: identityOf(workspace),
    workspaceRegistration: input.relativePaths === undefined
      ? await workspaceRegistrationState(repositoryRoot, workspaceRoot, options)
      : 'unresolved',
    entries: Object.freeze(entries),
    blockers: Object.freeze(blockers)
  });
}

export function planGeneratedStateCleanup(input: Readonly<{
  inventory: GeneratedStateInventory;
  profile: GeneratedStateCleanupProfile;
}>): Readonly<{ selected: readonly string[]; protected: readonly string[] }> {
  const selected: string[] = [];
  const protectedPaths: string[] = [];
  for (const entry of input.inventory.entries) {
    if (entry.kind === 'missing') continue;
    if (generatedStateCleanupAllowed({ entry, profile: input.profile })) selected.push(entry.relativePath);
    else protectedPaths.push(entry.relativePath);
  }
  return Object.freeze({
    selected: Object.freeze(selected.sort()),
    protected: Object.freeze(protectedPaths.sort())
  });
}

function deleteQuarantinedTree(
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

export async function settleGeneratedState(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  profile: GeneratedStateCleanupProfile | 'inspect-only';
  relativePaths?: readonly string[];
}>, options: GeneratedStateLifecycleOptions = {}): Promise<GeneratedStateSettlement> {
  const cleanupOperation = generatedStateCleanupOperationState(
    options.cleanupOperation ?? createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: performance.now() + CLEANUP_DEADLINE_MS,
      maximumBytes: MAXIMUM_CLEANUP_BYTES,
      maximumEntries: MAXIMUM_CLEANUP_ENTRIES
    })
  );
  assertGeneratedStateCleanupOperation(cleanupOperation, 'Generated-state cleanup admission');
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const before = await inspectGeneratedState({
    repositoryRoot,
    workspaceRoot,
    relativePaths: input.relativePaths
  }, options);
  const plan = input.profile === 'inspect-only'
    ? Object.freeze({ selected: Object.freeze([]) as readonly string[], protected: Object.freeze(
      before.entries.filter(({ kind }) => kind !== 'missing').map(({ relativePath }) => relativePath).sort()
    ) })
    : planGeneratedStateCleanup({ inventory: before, profile: input.profile });
  const attempts: Array<{
    relativePath: string;
    action: 'quarantined' | 'deleted' | 'protected' | 'residue';
    detailRef: `sha256:${string}`;
  }> = [];
  const blockers: string[] = [];
  if (input.profile === 'inspect-only') {
    return createGeneratedStateSettlement({
      repositoryRoot,
      beforeInventoryDigest: before.inventoryDigest,
      afterInventoryDigest: before.inventoryDigest,
      profile: input.profile,
      selected: plan.selected,
      protected: plan.protected,
      attempts: Object.freeze([]),
      terminal: 'no-op',
      blockers: Object.freeze([])
    }, { clock: options.clock });
  }
  const store = await openRuntimeStore(workspaceRoot, options);
  for (const entry of before.entries.filter((candidate) =>
    candidate.kind === 'missing' && candidate.registrationState === 'retired'
  )) {
    const registration = loadRegistration(store, entry.relativePath);
    const intent = loadCleanupIntent(store, entry.relativePath);
    if (registration === null || intent === null || intent.profile !== input.profile ||
        intent.registrationDigest !== registration.registrationDigest ||
        !sameIdentity(registration.root, intent.root)) {
      blockers.push(`${entry.relativePath}:retired-absent-root-without-valid-intent`);
      attempts.push(Object.freeze({
        relativePath: entry.relativePath,
        action: 'residue',
        detailRef: generatedStateDigest('retired-absent-root-without-valid-intent')
      }));
      continue;
    }
    try {
      const tombstonePath = path.join(
        workspaceRoot, '.tmp', 'generated-state-quarantine', intent.tombstoneName
      );
      const tombstone = inspectExactNoFollowDirectoryPresence(
        tombstonePath,
        'Generated-state interrupted quarantine'
      );
      if (tombstone.state === 'present') {
        if (!sameIdentity(identityOf(tombstone.directory.target), registration.root)) {
          throw new Error('Generated-state interrupted quarantine identity changed.');
        }
        deleteQuarantinedTree(tombstone.directory.target, cleanupOperation);
      }
      const registrationLocator = registrationPath(store, entry.relativePath);
      const transactionLocator = transactionPointerPath(store, entry.relativePath);
      if ((!store.fs.deleteIfPresent(registrationLocator) && store.fs.exists(registrationLocator))
          || (!store.fs.deleteIfPresent(transactionLocator) && store.fs.exists(transactionLocator))) {
        throw new Error('Generated-state interrupted cleanup pointers remain.');
      }
      attempts.push(Object.freeze({
        relativePath: entry.relativePath,
        action: 'deleted',
        detailRef: generatedStateDigest({
          intentDigest: intent.intentDigest,
          effect: 'interrupted-cleanup-physical-absence-readback'
        })
      }));
    } catch (error) {
      blockers.push(`${entry.relativePath}:interrupted-cleanup-residue`);
      attempts.push(Object.freeze({
        relativePath: entry.relativePath,
        action: 'residue',
        detailRef: generatedStateDigest(error instanceof Error ? error.message : String(error))
      }));
    }
  }
  if (plan.selected.length > 0) {
    const workspace = inspectNoFollowDirectoryChain(
      workspaceRoot,
      'Generated-state cleanup workspace'
    ).target;
    createNoFollowOrdinaryDirectoryChain(workspace, ['.tmp', 'generated-state-quarantine']);
    const quarantinePath = path.join(workspaceRoot, '.tmp', 'generated-state-quarantine');
    const quarantine = inspectExactNoFollowDirectoryPresence(quarantinePath, 'Generated-state quarantine');
    if (quarantine.state === 'absent') throw new Error('Generated-state quarantine materialization failed.');
    for (const relativePath of plan.selected) {
      const entry = before.entries.find((candidate) => candidate.relativePath === relativePath)!;
      await options.beforeCleanupEffect?.(relativePath);
      const current = observeRoot(workspaceRoot, relativePath);
      if (current.kind !== 'directory' || current.directory === null || current.identity === null
          || entry.physicalIdentity === null || !sameIdentity(entry.physicalIdentity, current.identity)) {
        blockers.push(`${relativePath}:changed-after-inventory-or-unsupported-kind`);
        attempts.push(Object.freeze({
          relativePath,
          action: 'protected',
          detailRef: generatedStateDigest('changed-after-inventory-or-unsupported-kind')
        }));
        continue;
      }
      const tombstoneName = `q-${entry.registrationDigest!.slice('sha256:'.length, 'sha256:'.length + 48)}`;
      const intent = Object.freeze({
        schema: GENERATED_STATE_CLEANUP_INTENT_SCHEMA,
        beforeInventoryDigest: before.inventoryDigest,
        profile: input.profile,
        registrationDigest: entry.registrationDigest!,
        relativePath,
        root: entry.physicalIdentity,
        tombstoneName
      });
      const intentDigest = generatedStateDigest(intent);
      const intentPath = path.join(store.transactionsRoot, `intent-${intentDigest.slice('sha256:'.length)}.json`);
      const intentBytes = canonicalBytes(Object.freeze({ ...intent, intentDigest }));
      if (!store.fs.createExclusiveFsync(intentPath, intentBytes) && store.fs.readText(intentPath) !== intentBytes) {
        throw new Error('Generated-state cleanup intent collides with different bytes.');
      }
      store.fs.replaceFsync(transactionPointerPath(store, relativePath), intentBytes);
      try {
        await store.assertCurrent();
        const moved = relocateRetainedNoFollowDirectoryAcrossParents({
          directory: current.directory,
          destinationParent: quarantine.directory.target,
          tombstoneName
        });
        attempts.push(Object.freeze({ relativePath, action: 'quarantined', detailRef: intentDigest }));
        await options.afterQuarantineEffect?.(relativePath);
        deleteQuarantinedTree(moved, cleanupOperation);
        const absent = inspectExactNoFollowDirectoryPresence(
          path.join(quarantinePath, tombstoneName), 'Generated-state quarantine readback'
        ).state === 'absent';
        if (!absent) throw new Error('Generated-state quarantine residue remains after deletion.');
        const registrationLocator = registrationPath(store, relativePath);
        if (!store.fs.deleteIfPresent(registrationLocator) || store.fs.exists(registrationLocator)) {
          throw new Error('Generated-state retired registration remains after physical deletion.');
        }
        const transactionLocator = transactionPointerPath(store, relativePath);
        if (!store.fs.deleteIfPresent(transactionLocator) || store.fs.exists(transactionLocator)) {
          throw new Error('Generated-state cleanup intent pointer remains after physical deletion.');
        }
        attempts.push(Object.freeze({
          relativePath,
          action: 'deleted',
          detailRef: generatedStateDigest({ intentDigest, effect: 'physical-absence-readback' })
        }));
      } catch (error) {
        blockers.push(`${relativePath}:cleanup-residue`);
        attempts.push(Object.freeze({
          relativePath,
          action: 'residue',
          detailRef: generatedStateDigest(error instanceof Error ? error.message : String(error))
        }));
      }
    }
  }
  const quarantinePath = path.join(workspaceRoot, '.tmp', 'generated-state-quarantine');
  const quarantine = inspectExactNoFollowDirectoryPresence(quarantinePath, 'Generated-state quarantine finalization');
  if (quarantine.state === 'present') {
    let quarantineInventory: ReturnType<typeof scanNoFollowDirectoryTreeMetadata>;
    try {
      quarantineInventory = cleanupInventory(
        quarantine.directory.target,
        cleanupOperation,
        'Generated-state quarantine finalization inventory'
      );
    } catch (error) {
      if (!(error instanceof GeneratedStateCleanupOperationExhaustedError)) throw error;
      quarantineInventory = Object.freeze([]);
      blockers.push('.tmp/generated-state-quarantine:cleanup-operation-exhausted');
      attempts.push(Object.freeze({
        relativePath: '.tmp/generated-state-quarantine',
        action: 'residue' as const,
        detailRef: generatedStateDigest(error.message)
      }));
    }
    if (quarantineInventory.length === 0 &&
        !blockers.includes('.tmp/generated-state-quarantine:cleanup-operation-exhausted')) {
      const tmp = inspectNoFollowDirectoryChain(path.dirname(quarantinePath), 'Generated-state tmp root').target;
      deleteRetainedNoFollowEntry({
        root: tmp,
        relativePath: path.basename(quarantinePath),
        kind: 'directory',
        device: quarantine.directory.target.device,
        inode: quarantine.directory.target.inode,
        ancestorDirectories: Object.freeze([])
      });
    } else {
      const relativePath = '.tmp/generated-state-quarantine';
      blockers.push(`${relativePath}:physical-residue`);
      attempts.push(Object.freeze({
        relativePath,
        action: 'residue',
        detailRef: generatedStateDigest(Object.freeze({
          effect: 'quarantine-nonempty-readback',
          entryCount: quarantineInventory.length
        }))
      }));
    }
  }
  const after = await inspectGeneratedState({
    repositoryRoot,
    workspaceRoot,
    relativePaths: input.relativePaths
  }, options);
  const terminal = blockers.length > 0
    ? 'partial-residue'
    : plan.selected.length === 0
      ? attempts.length === 0 ? 'no-op' : 'completed'
      : 'completed';
  const settlement = createGeneratedStateSettlement({
    repositoryRoot,
    beforeInventoryDigest: before.inventoryDigest,
    afterInventoryDigest: after.inventoryDigest,
    profile: input.profile,
    selected: plan.selected,
    protected: plan.protected,
    attempts: Object.freeze(attempts),
    terminal,
    blockers: Object.freeze(blockers)
  }, { clock: options.clock });
  const settlementPath = path.join(
    store.settlementsRoot,
    `settlement-${settlement.settlementDigest.slice('sha256:'.length)}.json`
  );
  const bytes = canonicalBytes(settlement);
  if (!store.fs.createExclusiveFsync(settlementPath, bytes) && store.fs.readText(settlementPath) !== bytes) {
    throw new Error('Generated-state settlement generation collides with different bytes.');
  }
  return settlement;
}

const issuedGeneratedStateCleanupContinuationReceipts = new WeakSet<object>();

export function assertGeneratedStateCleanupContinuationReceipt(
  receipt: GeneratedStateCleanupContinuationReceipt
): void {
  if (!issuedGeneratedStateCleanupContinuationReceipts.has(receipt)) {
    throw new Error('Generated-state cleanup continuation receipt was not issued by this owner.');
  }
}

export async function continueGeneratedStateCleanup(input: Readonly<{
  lifecycleOptions?: GeneratedStateLifecycleOptions;
  repositoryRoot: string;
  workspaceRoot?: string;
  profile: GeneratedStateCleanupProfile;
  relativePaths: readonly string[];
  operation: GeneratedStateCleanupOperationSession;
}>): Promise<GeneratedStateCleanupContinuationReceipt> {
  generatedStateCleanupOperationState(input.operation);
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const requested = Object.freeze(
    [...new Set(input.relativePaths.map(normalizeGeneratedStateRelativePath))].sort()
  );
  if (requested.length === 0) throw new Error('Generated-state cleanup continuation requires one selected path.');
  let settlementDigest: `sha256:${string}`;
  try {
    const settlement = await settleGeneratedState({
      repositoryRoot,
      workspaceRoot,
      profile: input.profile,
      relativePaths: requested
    }, { ...input.lifecycleOptions, cleanupOperation: input.operation });
    settlementDigest = settlement.settlementDigest;
  } catch (error) {
    if (!(error instanceof GeneratedStateCleanupOperationExhaustedError)) throw error;
    settlementDigest = generatedStateDigest(Object.freeze({
      domain: 'generated-state-cleanup-operation-exhausted',
      repositoryRoot,
      requested
    }));
  }

  const after = await inspectGeneratedState(
    { repositoryRoot, workspaceRoot, relativePaths: requested },
    { ...input.lifecycleOptions, cleanupOperation: input.operation }
  );
  const store = openRuntimeStoreReadOnly(
    workspaceRoot,
    { ...input.lifecycleOptions, cleanupOperation: input.operation }
  );
  const completed: string[] = [];
  const quarantined: Array<Readonly<{
    relativePath: string;
    registrationDigest: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentity;
  }>> = [];
  const blockers: string[] = [];
  for (const relativePath of requested) {
    const entry = after.entries.find((candidate) => candidate.relativePath === relativePath);
    if (entry?.kind === 'missing' && entry.registrationState === 'missing') {
      completed.push(relativePath);
      continue;
    }
    if (entry?.kind !== 'missing' || entry.registrationState !== 'retired' || store === null) {
      blockers.push(`${relativePath}:cleanup-source-not-terminally-absent`);
      continue;
    }
    const observation = readRegistrationLedgerObservation(store, relativePath);
    const registration = observation.registration;
    const intent = loadCleanupIntent(store, relativePath);
    if (registration === null || registration.phase !== 'retired' || intent === null ||
        intent.registrationDigest !== registration.registrationDigest ||
        !sameIdentity(intent.root, registration.root)) {
      blockers.push(`${relativePath}:cleanup-continuation-intent-invalid`);
      continue;
    }
    const tombstone = inspectExactNoFollowDirectoryPresence(
      path.join(workspaceRoot, '.tmp', 'generated-state-quarantine', intent.tombstoneName),
      'Generated-state cleanup continuation quarantine readback'
    );
    if (tombstone.state !== 'present' ||
        !sameIdentity(identityOf(tombstone.directory.target), registration.root)) {
      blockers.push(`${relativePath}:cleanup-continuation-quarantine-invalid`);
      continue;
    }
    quarantined.push(Object.freeze({
      relativePath,
      registrationDigest: registration.registrationDigest,
      physical: registration.root
    }));
  }
  await store?.assertCurrent();
  const terminal = blockers.length > 0
    ? 'blocked' as const
    : quarantined.length > 0
      ? 'continuation-required' as const
      : 'completed' as const;
  const material = Object.freeze({
    schema: GENERATED_STATE_CLEANUP_CONTINUATION_SCHEMA,
    repositoryRoot,
    requested,
    completed: Object.freeze(completed.sort()),
    quarantined: Object.freeze(quarantined.sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath))),
    blockers: Object.freeze(blockers.sort()),
    settlementDigest,
    terminal
  });
  const receipt = Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
  issuedGeneratedStateCleanupContinuationReceipts.add(receipt);
  return receipt;
}

type PreparedGeneratedStateDisposal = Readonly<{
  expectedRetirementRef: `sha256:${string}`;
  registration: GeneratedStateRegistration;
  relativePath: string;
  repositoryRoot: string;
  rule: GeneratedStateRule;
  workspaceRoot: string;
}>;

async function prepareGeneratedStateDisposal(input: Readonly<{
  acceptExistingRetirement?: boolean;
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expectedRegistrationDigest: `sha256:${string}` | null;
  outcome: string;
  profile: GeneratedStateCleanupProfile;
}>, options: GeneratedStateLifecycleOptions): Promise<PreparedGeneratedStateDisposal> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const rule = generatedStateRuleForPath(relativePath)
    ?? generatedStateLegacyRetirementRuleForPath(relativePath);
  if (rule === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal path has no active or legacy-retirement rule: ${relativePath}.`
    );
  }
  if (!rule.cleanupProfiles.includes(input.profile)) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal profile is not owned by ${relativePath}: ${input.profile}.`
    );
  }
  const outcome = input.outcome.trim();
  if (outcome.length === 0) {
    throw new GeneratedStateProducerBindingBlockedError('Generated-state disposal outcome is empty.');
  }
  const initialStore = openRuntimeStoreReadOnly(workspaceRoot, options);
  if (initialStore === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal has no durable registration store: ${relativePath}.`
    );
  }
  const initial = readRegistrationLedgerObservation(initialStore, relativePath);
  let registration = initial.registration ?? initial.retiredPredecessor;
  if (registration === null || path.resolve(registration.repositoryRoot) !== repositoryRoot ||
      registration.relativePath !== relativePath || registration.ruleId !== rule.id ||
      registration.owner !== rule.owner || registration.producer !== rule.producer) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal registration is missing, foreign, or stale: ${relativePath}.`
    );
  }
  const retirementAuthority = registration.phase === 'active'
    ? registration
    : initial.previousRegistration;
  if (retirementAuthority === null || retirementAuthority.phase !== 'active' ||
      !samePhysicalIdentity(retirementAuthority.root, registration.root)) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal retirement predecessor is missing or foreign: ${relativePath}.`
    );
  }
  let expectedRetirementRef = generatedStateOwnerRetirementRef(retirementAuthority, outcome);
  if (initial.registration?.phase === 'active') {
    if (input.expectedRegistrationDigest !== registration.registrationDigest) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state disposal is not bound to the active producer registration: ${relativePath}.`
      );
    }
    registration = await retireGeneratedState({
      repositoryRoot,
      workspaceRoot,
      relativePath,
      expectedRegistrationDigest: registration.registrationDigest,
      outcome
    }, options);
  } else {
    if (registration.phase !== 'retired' || registration.retirementRef === null ||
        (!input.acceptExistingRetirement && registration.retirementRef !== expectedRetirementRef)) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state disposal recovery differs from the owner retirement: ${relativePath}.`
      );
    }
    expectedRetirementRef = registration.retirementRef;
  }

  const observedBeforeSettlement = observeRoot(workspaceRoot, relativePath);
  if (observedBeforeSettlement.identity !== null &&
      !samePhysicalIdentity(observedBeforeSettlement.identity, registration.root)) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal physical identity changed: ${relativePath}.`
    );
  }
  return Object.freeze({
    expectedRetirementRef,
    registration,
    relativePath,
    repositoryRoot,
    rule,
    workspaceRoot
  });
}

async function disposeGeneratedStateRegistration(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expectedRegistrationDigest: `sha256:${string}` | null;
  outcome: string;
  profile: GeneratedStateCleanupProfile;
}>, options: GeneratedStateLifecycleOptions): Promise<GeneratedStateDisposalReceipt> {
  const {
    expectedRetirementRef,
    registration,
    relativePath,
    repositoryRoot,
    rule,
    workspaceRoot
  } = await prepareGeneratedStateDisposal(input, options);
  if (rule.physicalForms.some(({ worktreeRetirement }) =>
    worktreeRetirement.mode === 'domain-retire'
  )) {
    await disposeRetiredGeneratedStateDomain({
      repositoryRoot,
      workspaceRoot,
      relativePath,
      expected: Object.freeze({ physical: registration.root })
    }, options);
  }
  if (observeRoot(workspaceRoot, relativePath).kind === 'missing') {
    const recoveryStore = openRuntimeStoreReadOnly(workspaceRoot, options);
    if (recoveryStore === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state disposal terminal store disappeared: ${relativePath}.`
      );
    }
    const existingReceipt = readGeneratedStateDisposalReceipt(recoveryStore, Object.freeze({
      relativePath,
      profile: input.profile,
      registrationDigest: registration.registrationDigest,
      retirementRef: expectedRetirementRef,
      physical: registration.root
    }));
    if (existingReceipt !== null) {
      const recoveryLedger = readRegistrationLedgerObservation(recoveryStore, relativePath);
      if (recoveryLedger.registration !== null ||
          recoveryLedger.retiredPredecessor?.registrationDigest !== registration.registrationDigest ||
          recoveryLedger.retiredPredecessor.retirementRef !== expectedRetirementRef) {
        throw new GeneratedStateProducerBindingBlockedError(
          `Generated-state disposal terminal ledger differs: ${relativePath}.`
        );
      }
      await recoveryStore.assertCurrent();
      issuedGeneratedStateDisposalReceipts.add(existingReceipt);
      return existingReceipt;
    }
  }
  const settlement = await settleGeneratedState({
    repositoryRoot,
    workspaceRoot,
    profile: input.profile,
    relativePaths: [relativePath]
  }, options);
  if ((settlement.terminal !== 'completed' && settlement.terminal !== 'no-op') ||
      settlement.blockers.length > 0 || observeRoot(workspaceRoot, relativePath).kind !== 'missing') {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal did not reach one terminal physical absence: ${relativePath}.`
    );
  }
  const terminalStore = openRuntimeStoreReadOnly(workspaceRoot, options);
  if (terminalStore === null) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal terminal store disappeared: ${relativePath}.`
    );
  }
  const terminalLedger = readRegistrationLedgerObservation(terminalStore, relativePath);
  if (terminalLedger.registration !== null ||
      terminalLedger.retiredPredecessor?.registrationDigest !== registration.registrationDigest ||
      terminalLedger.retiredPredecessor.retirementRef !== expectedRetirementRef) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal terminal ledger differs: ${relativePath}.`
    );
  }
  const material = Object.freeze({
    schema: GENERATED_STATE_DISPOSAL_RECEIPT_SCHEMA,
    relativePath,
    profile: input.profile,
    registrationDigest: registration.registrationDigest,
    retirementRef: expectedRetirementRef,
    physical: registration.root,
    beforeInventoryDigest: settlement.beforeInventoryDigest,
    afterInventoryDigest: settlement.afterInventoryDigest,
    settlementDigest: settlement.settlementDigest,
    terminal: 'disposed' as const
  });
  const receipt = Object.freeze({
    ...material,
    receiptDigest: generatedStateDigest(material)
  });
  const receiptStore = await openRuntimeStore(workspaceRoot, options);
  const receiptKey = Object.freeze({
    relativePath,
    profile: input.profile,
    registrationDigest: registration.registrationDigest,
    retirementRef: expectedRetirementRef,
    physical: registration.root
  });
  const receiptPath = generatedStateDisposalReceiptPath(receiptStore, receiptKey);
  const receiptBytes = canonicalBytes(receipt);
  if (!receiptStore.fs.createExclusiveFsync(receiptPath, receiptBytes)) {
    const concurrentReceipt = readGeneratedStateDisposalReceipt(receiptStore, receiptKey);
    if (concurrentReceipt === null) {
      throw new GeneratedStateProducerBindingBlockedError(
        `Generated-state disposal receipt disappeared after concurrent publication: ${relativePath}.`
      );
    }
    await receiptStore.assertCurrent();
    issuedGeneratedStateDisposalReceipts.add(concurrentReceipt);
    return concurrentReceipt;
  }
  if (receiptStore.fs.readText(receiptPath) !== receiptBytes) {
    throw new GeneratedStateProducerBindingBlockedError(
      `Generated-state disposal receipt readback differs: ${relativePath}.`
    );
  }
  await receiptStore.assertCurrent();
  issuedGeneratedStateDisposalReceipts.add(receipt);
  return receipt;
}

async function quarantineGeneratedStateRegistration(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expectedRegistrationDigest: `sha256:${string}` | null;
  outcome: string;
  profile: GeneratedStateCleanupProfile;
}>, options: GeneratedStateLifecycleOptions): Promise<GeneratedStateCleanupContinuationReceipt> {
  if (options.cleanupOperation === undefined) {
    throw new GeneratedStateProducerBindingBlockedError(
      'Generated-state quarantine requires one owner-issued cleanup operation session.'
    );
  }
  assertGeneratedStateCleanupOperation(
    generatedStateCleanupOperationState(options.cleanupOperation),
    'Generated-state quarantine admission'
  );
  await prepareGeneratedStateDisposal({ ...input, acceptExistingRetirement: true }, options);
  return continueGeneratedStateCleanup({
    lifecycleOptions: options,
    repositoryRoot: input.repositoryRoot,
    workspaceRoot: input.workspaceRoot,
    profile: input.profile,
    relativePaths: [input.relativePath],
    operation: options.cleanupOperation
  });
}

export interface GeneratedStateProducerHookSet {
  born(relativePath: string, operationId: string): Promise<void>;
  inspect(relativePaths?: readonly string[]): Promise<GeneratedStateInventory>;
  bind(
    relativePath: string,
    expected?: GeneratedStateProducerBindingExpectation
  ): Promise<GeneratedStateRegistration>;
  restore(
    relativePath: string,
    expectedRegistrationDigest: `sha256:${string}`,
    expectedPhysical: GeneratedStatePhysicalIdentity,
    outcome: string
  ): Promise<GeneratedStateRegistration>;
  retired(relativePath: string, outcome: string): Promise<GeneratedStateRegistration | void>;
  settleRetired(
    relativePath: string,
    expected?: GeneratedStateProducerBindingExpectation,
    retraction?: GeneratedStateRetiredPredecessorRetraction
  ): Promise<boolean>;
  observeRetirement(
    relativePath: string,
    expected?: GeneratedStateProducerBindingExpectation
  ): Promise<GeneratedStateRetirementObservation>;
  settleAbsent(
    relativePath: string,
    expected: GeneratedStateAbsentRegistrationExpectation,
    outcome: string
  ): Promise<GeneratedStateAbsentRegistrationSettlementReceipt>;
  disposed(
    relativePath: string,
    request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
  ): Promise<GeneratedStateDisposalReceipt>;
}

export interface GeneratedStateProducerQuarantineHook {
  quarantine(
    relativePath: string,
    request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
  ): Promise<GeneratedStateCleanupContinuationReceipt>;
}

type GeneratedStateProducerInput = Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
}>;

export function generatedStateProducerHooks(
  input: GeneratedStateProducerInput,
  options: GeneratedStateLifecycleOptions & Readonly<{
    cleanupOperation: GeneratedStateCleanupOperationSession;
  }>
): Readonly<GeneratedStateProducerHookSet & GeneratedStateProducerQuarantineHook>;
export function generatedStateProducerHooks(
  input: GeneratedStateProducerInput,
  options?: GeneratedStateLifecycleOptions & Readonly<{ cleanupOperation?: undefined }>
): Readonly<GeneratedStateProducerHookSet>;
export function generatedStateProducerHooks(
  input: GeneratedStateProducerInput,
  options: GeneratedStateLifecycleOptions
): Readonly<GeneratedStateProducerHookSet & Partial<GeneratedStateProducerQuarantineHook>>;
export function generatedStateProducerHooks(
  input: GeneratedStateProducerInput,
  options: GeneratedStateLifecycleOptions = {}
): Readonly<GeneratedStateProducerHookSet & Partial<GeneratedStateProducerQuarantineHook>> {
  const producerInput = Object.freeze<GeneratedStateProducerInput>({
    repositoryRoot: input.repositoryRoot,
    ...(input.workspaceRoot === undefined ? {} : { workspaceRoot: input.workspaceRoot })
  });
  const producerOptions = Object.freeze<GeneratedStateLifecycleOptions>({
    ...options,
    ...(options.environment === undefined
      ? {}
      : { environment: Object.freeze({ ...options.environment }) }),
    ...(options.worktreeRetirementProviders === undefined
      ? {}
      : { worktreeRetirementProviders: Object.freeze([...options.worktreeRetirementProviders]) })
  });
  const producerSession = new Map<string, `sha256:${string}`>();
  const requireProducerBinding = (relativePath: string): `sha256:${string}` => {
    const normalized = normalizeGeneratedStateRelativePath(relativePath);
    const registrationDigest = producerSession.get(normalized);
    if (registrationDigest === undefined) {
      throw new Error('Generated-state retirement requires birth in the same producer session.');
    }
    return registrationDigest;
  };
  const hooks = Object.freeze<GeneratedStateProducerHookSet>({
    born: async (relativePath, operationId) => {
      const registration = await registerGeneratedStateBirth(
        { ...producerInput, relativePath, operationId },
        producerOptions
      );
      producerSession.set(registration.relativePath, registration.registrationDigest);
    },
    inspect: (relativePaths) => inspectGeneratedState({
      ...producerInput,
      ...(relativePaths === undefined ? {} : { relativePaths })
    }, producerOptions),
    bind: async (relativePath, expected) => {
      const registration = await bindGeneratedStateRegistration(
        { ...producerInput, relativePath, expected },
        producerOptions
      );
      producerSession.set(registration.relativePath, registration.registrationDigest);
      return registration;
    },
    restore: async (relativePath, expectedRegistrationDigest, expectedPhysical, outcome) => {
      const registration = await restoreGeneratedStateRegistration({
        ...producerInput,
        relativePath,
        expectedRegistrationDigest,
        expectedPhysical,
        outcome
      }, producerOptions);
      producerSession.set(registration.relativePath, registration.registrationDigest);
      return registration;
    },
    retired: async (relativePath, outcome) => {
      const registration = await retireGeneratedState({
        ...producerInput,
        relativePath,
        expectedRegistrationDigest: requireProducerBinding(relativePath),
        outcome
      }, producerOptions);
      producerSession.set(registration.relativePath, registration.registrationDigest);
      return registration;
    },
    settleRetired: (relativePath, expected, retraction) => disposeRetiredGeneratedStateDomain({
      ...producerInput,
      relativePath,
      expected,
      retraction
    }, producerOptions),
    observeRetirement: (relativePath, expected) => observeGeneratedStateRetirement({
      ...producerInput,
      relativePath,
      expected
    }, producerOptions),
    settleAbsent: (relativePath, expected, outcome) => settleAbsentActiveGeneratedStateRegistration({
      ...producerInput,
      relativePath,
      expected,
      outcome
    }, producerOptions),
    disposed: async (relativePath, request) => {
      const normalized = normalizeGeneratedStateRelativePath(relativePath);
      const receipt = await disposeGeneratedStateRegistration({
        ...producerInput,
        relativePath: normalized,
        expectedRegistrationDigest: producerSession.get(normalized) ?? null,
        outcome: request.outcome,
        profile: request.profile
      }, producerOptions);
      producerSession.delete(normalized);
      return receipt;
    }
  });
  if (producerOptions.cleanupOperation === undefined) return hooks;
  const quarantineHook: GeneratedStateProducerQuarantineHook = {
    quarantine: async (relativePath, request) => {
      const normalized = normalizeGeneratedStateRelativePath(relativePath);
      const receipt = await quarantineGeneratedStateRegistration({
        ...producerInput,
        relativePath: normalized,
        expectedRegistrationDigest: producerSession.get(normalized) ?? null,
        outcome: request.outcome,
        profile: request.profile
      }, producerOptions);
      if (receipt.terminal === 'completed') producerSession.delete(normalized);
      return receipt;
    }
  };
  return Object.freeze({
    ...hooks,
    ...quarantineHook
  });
}