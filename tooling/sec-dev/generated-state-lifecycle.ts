import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  GENERATED_STATE_REGISTRY_V1,
  createGeneratedStateInventoryV1,
  createGeneratedStateRegistrationV1,
  createGeneratedStateSettlementV1,
  generatedStateCleanupAllowedV1,
  generatedStateDigestV1,
  generatedStateRuleForPathV1,
  normalizeGeneratedStateRelativePathV1,
  parseGeneratedStateRegistrationV1,
  retireGeneratedStateRegistrationV1,
  type GeneratedStateCleanupProfileV1,
  type GeneratedStateInventoryEntryV1,
  type GeneratedStateInventoryV1,
  type GeneratedStatePhysicalIdentityV1,
  type GeneratedStateRegistrationV1,
  type GeneratedStateRuleV1,
  type GeneratedStateSettlementV1
} from '../../platform/shared/generated-state-contract.ts';
import {
  PhysicalNoFollowError,
  createNoFollowOrdinaryDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowOrdinaryFileEntryV1,
  relocateRetainedNoFollowDirectoryAcrossParentsV1,
  scanNoFollowDirectoryTreeMetadataV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import { runCommandBytes, type ByteCommandResult } from '../../platform/shared/process.ts';
import { parseWorktreePorcelainZV1 } from '../../scripts/codex/worktree-physical-closeout-contract.ts';
import { acquireSecRuntimeStatePhysicalAuthorityV1 } from './runtime-state-authority.ts';
import { createRuntimeStateJournalFileSystemV1 } from './runtime-state-journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRootsV1 } from './runtime-state-paths.ts';

const GENERATED_STATE_RUNTIME_VERSION = 'v1' as const;
const MAXIMUM_CLEANUP_ENTRIES = 100_000;
const CLEANUP_DEADLINE_MS = 30_000;

export interface GeneratedStateLifecycleOptionsV1 {
  readonly afterQuarantineEffect?: (relativePath: string) => void | Promise<void>;
  readonly beforeCleanupEffect?: (relativePath: string) => void | Promise<void>;
  readonly clock?: () => Date;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runGit?: (
    command: string,
    args: string[],
    options: Readonly<{ cwd: string }>
  ) => Promise<ByteCommandResult>;
}

interface GeneratedStateRuntimeStoreV1 {
  readonly registrationsRoot: string;
  readonly settlementsRoot: string;
  readonly transactionsRoot: string;
  readonly fs: ReturnType<typeof createRuntimeStateJournalFileSystemV1>;
  readonly assertCurrent: () => Promise<void>;
}

interface GeneratedStateRuntimePathsV1 {
  readonly workspaceStateRoot: string;
  readonly registrationsRoot: string;
  readonly settlementsRoot: string;
  readonly transactionsRoot: string;
}

type ObservedGeneratedStateRootV1 = Readonly<{
  kind: 'directory' | 'file' | 'link' | 'missing';
  identity: GeneratedStatePhysicalIdentityV1 | null;
  directory: PhysicalDirectoryIdentityV1 | null;
}>;

function canonicalBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function identityOf(value: Pick<PhysicalDirectoryIdentityV1, 'device' | 'inode' | 'objectId'>): GeneratedStatePhysicalIdentityV1 {
  return Object.freeze({ device: value.device, inode: value.inode, objectId: value.objectId });
}

function sameIdentity(
  left: GeneratedStatePhysicalIdentityV1,
  right: GeneratedStatePhysicalIdentityV1
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function registrationKey(relativePath: string): string {
  return generatedStateDigestV1(Object.freeze({
    schema: 'sec-generated-state-registration-key-v1',
    relativePath: normalizeGeneratedStateRelativePathV1(relativePath)
  })).slice('sha256:'.length);
}

function runtimePaths(
  workspaceRoot: string,
  options: GeneratedStateLifecycleOptionsV1
): GeneratedStateRuntimePathsV1 {
  const roots = resolveSecWorkspaceRuntimeRootsV1({
    repositoryRoot: workspaceRoot,
    environment: options.environment
  });
  const generatedRoot = path.join(roots.workspaceStateRoot, 'generated-state', GENERATED_STATE_RUNTIME_VERSION);
  return Object.freeze({
    workspaceStateRoot: roots.workspaceStateRoot,
    registrationsRoot: path.join(generatedRoot, 'registrations'),
    settlementsRoot: path.join(generatedRoot, 'settlements'),
    transactionsRoot: path.join(generatedRoot, 'transactions')
  });
}

async function openRuntimeStore(
  workspaceRoot: string,
  options: GeneratedStateLifecycleOptionsV1
): Promise<GeneratedStateRuntimeStoreV1> {
  const roots = resolveSecWorkspaceRuntimeRootsV1({
    repositoryRoot: workspaceRoot,
    environment: options.environment
  });
  const locations = runtimePaths(workspaceRoot, options);
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: workspaceRoot,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [
      roots.workspaceStateRoot,
      path.dirname(locations.registrationsRoot),
      locations.registrationsRoot,
      locations.settlementsRoot,
      locations.transactionsRoot
    ]
  });
  return Object.freeze({
    registrationsRoot: locations.registrationsRoot,
    settlementsRoot: locations.settlementsRoot,
    transactionsRoot: locations.transactionsRoot,
    fs: createRuntimeStateJournalFileSystemV1(authority.directory(roots.workspaceStateRoot)),
    assertCurrent: authority.assertCurrent
  });
}

function openRuntimeStoreReadOnly(
  workspaceRoot: string,
  options: GeneratedStateLifecycleOptionsV1
): GeneratedStateRuntimeStoreV1 | null {
  const locations = runtimePaths(workspaceRoot, options);
  const presence = inspectExactNoFollowDirectoryPresenceV1(
    locations.workspaceStateRoot,
    'Generated-state read-only Runtime State root'
  );
  if (presence.state === 'absent') return null;
  return Object.freeze({
    registrationsRoot: locations.registrationsRoot,
    settlementsRoot: locations.settlementsRoot,
    transactionsRoot: locations.transactionsRoot,
    fs: createRuntimeStateJournalFileSystemV1(presence.directory.target),
    assertCurrent: async () => {
      inspectNoFollowDirectoryChainV1(
        locations.workspaceStateRoot,
        'Generated-state read-only Runtime State readback'
      );
    }
  });
}

function observeRoot(workspaceRoot: string, relativePath: string): ObservedGeneratedStateRootV1 {
  const absolutePath = path.join(workspaceRoot, ...normalizeGeneratedStateRelativePathV1(relativePath).split('/'));
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return Object.freeze({ kind: 'missing', identity: null, directory: null });
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    return Object.freeze({ kind: 'link', identity: null, directory: null });
  }
  if (metadata.isDirectory()) {
    const directory = inspectNoFollowDirectoryChainV1(absolutePath, 'Generated-state root').target;
    return Object.freeze({ kind: 'directory', identity: identityOf(directory), directory });
  }
  if (!metadata.isFile()) return Object.freeze({ kind: 'link', identity: null, directory: null });
  const parent = inspectNoFollowDirectoryChainV1(path.dirname(absolutePath), 'Generated-state file parent').target;
  const entry = inspectNoFollowOrdinaryFileEntryV1(parent, path.basename(absolutePath));
  if (entry === null) return Object.freeze({ kind: 'missing', identity: null, directory: null });
  return Object.freeze({
    kind: 'file',
    identity: Object.freeze({
      device: entry.device,
      inode: entry.inode,
      objectId: `${entry.device}:${entry.inode}`
    }),
    directory: null
  });
}

function registrationPath(store: GeneratedStateRuntimeStoreV1, relativePath: string): string {
  return path.join(store.registrationsRoot, `${registrationKey(relativePath)}.json`);
}

function transactionPointerPath(store: GeneratedStateRuntimeStoreV1, relativePath: string): string {
  return path.join(store.transactionsRoot, `current-${registrationKey(relativePath)}.json`);
}

interface GeneratedStateCleanupIntentV1 {
  readonly schema: 'sec-generated-state-cleanup-intent-v1';
  readonly beforeInventoryDigest: `sha256:${string}`;
  readonly relativePath: string;
  readonly root: GeneratedStatePhysicalIdentityV1;
  readonly tombstoneName: string;
  readonly intentDigest: `sha256:${string}`;
}

function loadCleanupIntent(
  store: GeneratedStateRuntimeStoreV1,
  relativePath: string
): GeneratedStateCleanupIntentV1 | null {
  const locator = transactionPointerPath(store, relativePath);
  if (!store.fs.exists(locator)) return null;
  const value = JSON.parse(store.fs.readText(locator)) as Partial<GeneratedStateCleanupIntentV1>;
  if (value.schema !== 'sec-generated-state-cleanup-intent-v1'
      || value.relativePath !== normalizeGeneratedStateRelativePathV1(relativePath)
      || typeof value.beforeInventoryDigest !== 'string'
      || typeof value.tombstoneName !== 'string' || !/^q-[0-9a-f]{48}$/u.test(value.tombstoneName)
      || value.root === undefined || typeof value.intentDigest !== 'string') {
    throw new Error('Generated-state cleanup intent pointer is malformed.');
  }
  const material = Object.freeze({
    schema: value.schema,
    beforeInventoryDigest: value.beforeInventoryDigest,
    relativePath: value.relativePath,
    root: value.root,
    tombstoneName: value.tombstoneName
  });
  if (generatedStateDigestV1(material) !== value.intentDigest) {
    throw new Error('Generated-state cleanup intent digest is invalid.');
  }
  return Object.freeze({ ...material, intentDigest: value.intentDigest }) as GeneratedStateCleanupIntentV1;
}

function loadRegistration(
  store: GeneratedStateRuntimeStoreV1 | null,
  relativePath: string
): GeneratedStateRegistrationV1 | null {
  if (store === null) return null;
  const locator = registrationPath(store, relativePath);
  if (!store.fs.exists(locator)) return null;
  return parseGeneratedStateRegistrationV1(JSON.parse(store.fs.readText(locator)) as unknown);
}

function persistRegistration(
  store: GeneratedStateRuntimeStoreV1,
  registration: GeneratedStateRegistrationV1
): void {
  const generation = path.join(
    store.registrationsRoot,
    `registration-${registration.registrationDigest.slice('sha256:'.length)}.json`
  );
  const bytes = canonicalBytes(registration);
  if (!store.fs.createExclusiveFsync(generation, bytes) && store.fs.readText(generation) !== bytes) {
    throw new Error('Generated-state registration generation collides with different bytes.');
  }
  store.fs.replaceFsync(registrationPath(store, registration.relativePath), bytes);
}

function requireRule(relativePath: string): GeneratedStateRuleV1 {
  const rule = generatedStateRuleForPathV1(relativePath);
  if (rule === null) throw new Error(`Generated-state path is not registered by policy: ${relativePath}`);
  return rule;
}

async function registerGeneratedStateBirthV1(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  operationId: string;
}>, options: GeneratedStateLifecycleOptionsV1 = {}): Promise<GeneratedStateRegistrationV1> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePathV1(input.relativePath);
  const rule = requireRule(relativePath);
  if (rule.registration !== 'required-at-birth') {
    throw new Error(`Generated-state rule ${rule.id} is registered by its domain owner, not this lifecycle.`);
  }
  const workspace = inspectNoFollowDirectoryChainV1(workspaceRoot, 'Generated-state workspace root').target;
  const observed = observeRoot(workspaceRoot, relativePath);
  if (observed.identity === null || observed.kind === 'link') {
    throw new Error('Generated-state birth requires one present ordinary physical root.');
  }
  const observedCurrent = loadRegistration(openRuntimeStoreReadOnly(workspaceRoot, options), relativePath);
  if (observedCurrent?.phase === 'active' && sameIdentity(observedCurrent.root, observed.identity)) {
    return observedCurrent;
  }
  const store = await openRuntimeStore(workspaceRoot, options);
  await store.assertCurrent();
  const current = loadRegistration(store, relativePath);
  if (current !== null && current.phase === 'active') {
    if (sameIdentity(current.root, observed.identity)) return current;
    throw new Error('Generated-state path already has a different active registration.');
  }
  const registration = createGeneratedStateRegistrationV1({
    repositoryRoot,
    workspace: identityOf(workspace),
    rule,
    relativePath,
    root: observed.identity,
    operationId: input.operationId
  }, { clock: options.clock });
  persistRegistration(store, registration);
  await store.assertCurrent();
  return parseGeneratedStateRegistrationV1(JSON.parse(store.fs.readText(
    registrationPath(store, relativePath)
  )) as unknown);
}

async function retireGeneratedStateV1(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePath: string;
  expectedRegistrationDigest: `sha256:${string}`;
  outcome: string;
}>, options: GeneratedStateLifecycleOptionsV1 = {}): Promise<GeneratedStateRegistrationV1> {
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const relativePath = normalizeGeneratedStateRelativePathV1(input.relativePath);
  const store = await openRuntimeStore(workspaceRoot, options);
  await store.assertCurrent();
  const current = loadRegistration(store, relativePath);
  if (current === null) throw new Error('Generated-state retirement has no birth registration.');
  if (current.registrationDigest !== input.expectedRegistrationDigest) {
    throw new Error('Generated-state retirement is not bound to the producer session registration.');
  }
  const outcome = input.outcome.trim();
  if (outcome.length === 0) throw new Error('Generated-state retirement outcome is empty.');
  const retirementRef = generatedStateDigestV1(Object.freeze({
    schema: 'sec-generated-state-owner-retirement-v1',
    registrationId: current.registrationId,
    registrationDigest: current.registrationDigest,
    relativePath: current.relativePath,
    owner: current.owner,
    producer: current.producer,
    operationId: current.operationId,
    outcome
  }));
  if (current.phase === 'retired') {
    if (current.retirementRef === retirementRef) return current;
    throw new Error('Generated-state registration was retired by a different authority.');
  }
  const retired = retireGeneratedStateRegistrationV1(current, retirementRef, {
    clock: options.clock
  });
  persistRegistration(store, retired);
  await store.assertCurrent();
  return parseGeneratedStateRegistrationV1(JSON.parse(store.fs.readText(
    registrationPath(store, relativePath)
  )) as unknown);
}

function knownPathOrAncestor(relativePath: string): boolean {
  return GENERATED_STATE_REGISTRY_V1.rules.some(({ selector }) => {
    const target = selector.kind === 'exact' ? selector.path : selector.parent;
    return relativePath === target || target.startsWith(`${relativePath}/`);
  });
}

function candidatePaths(workspaceRoot: string): readonly string[] {
  const candidates = new Set<string>();
  for (const rule of GENERATED_STATE_REGISTRY_V1.rules) {
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
    ...GENERATED_STATE_REGISTRY_V1.rules.flatMap(({ selector }) =>
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
  options: GeneratedStateLifecycleOptionsV1
): Promise<GeneratedStateInventoryV1['workspaceRegistration']> {
  const result = await (options.runGit ?? ((command, args, runOptions) =>
    runCommandBytes(command, args, { cwd: runOptions.cwd })))(
      'git', ['worktree', 'list', '--porcelain', '-z'], { cwd: repositoryRoot }
    );
  if (result.code !== 0) return 'unresolved';
  try {
    const key = path.resolve(workspaceRoot).toLocaleLowerCase('en-US');
    return parseWorktreePorcelainZV1(result.stdout).some((record) =>
      path.resolve(record.path).toLocaleLowerCase('en-US') === key
    ) ? 'registered' : 'absent';
  } catch {
    return 'unresolved';
  }
}

export async function inspectGeneratedStateV1(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  relativePaths?: readonly string[];
}>, options: GeneratedStateLifecycleOptionsV1 = {}): Promise<GeneratedStateInventoryV1> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const workspace = inspectNoFollowDirectoryChainV1(workspaceRoot, 'Generated-state workspace root').target;
  const store = openRuntimeStoreReadOnly(workspaceRoot, options);
  const entries: GeneratedStateInventoryEntryV1[] = [];
  const relativePaths = input.relativePaths === undefined
    ? candidatePaths(workspaceRoot)
    : Object.freeze([...new Set(input.relativePaths.map(normalizeGeneratedStateRelativePathV1))].sort());
  for (const relativePath of relativePaths) {
    const observed = observeRoot(workspaceRoot, relativePath);
    const rule = generatedStateRuleForPathV1(relativePath);
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
        blockers: Object.freeze(['unknown-generated-state']),
        physicalIdentity: observed.identity,
        registrationDigest: null
      }));
      continue;
    }
    let registration: GeneratedStateRegistrationV1 | null = null;
    let registrationState: GeneratedStateInventoryEntryV1['registrationState'] = 'not-required';
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
    if (observed.kind === 'link') blockers.push('root-is-link-or-reparse');
    else if (observed.kind !== 'missing' && observed.kind !== rule.rootKind) {
      blockers.push('root-kind-differs-from-policy');
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
  return createGeneratedStateInventoryV1({
    repositoryRoot,
    workspace: identityOf(workspace),
    workspaceRegistration: input.relativePaths === undefined
      ? await workspaceRegistrationState(repositoryRoot, workspaceRoot, options)
      : 'unresolved',
    entries: Object.freeze(entries),
    blockers: Object.freeze(blockers)
  });
}

export function planGeneratedStateCleanupV1(input: Readonly<{
  inventory: GeneratedStateInventoryV1;
  profile: GeneratedStateCleanupProfileV1;
}>): Readonly<{ selected: readonly string[]; protected: readonly string[] }> {
  const selected: string[] = [];
  const protectedPaths: string[] = [];
  for (const entry of input.inventory.entries) {
    if (entry.kind === 'missing') continue;
    if (generatedStateCleanupAllowedV1({ entry, profile: input.profile })) selected.push(entry.relativePath);
    else protectedPaths.push(entry.relativePath);
  }
  return Object.freeze({
    selected: Object.freeze(selected.sort()),
    protected: Object.freeze(protectedPaths.sort())
  });
}

function deleteQuarantinedTree(directory: PhysicalDirectoryIdentityV1): void {
  const inventory = scanNoFollowDirectoryTreeMetadataV1(directory, {
    deadlineAtMs: performance.now() + CLEANUP_DEADLINE_MS,
    maximumEntries: MAXIMUM_CLEANUP_ENTRIES
  });
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
    const parts = entry.relativePath.split('/');
    const ancestors = parts.slice(0, -1).map((_, index) => {
      const relativePath = parts.slice(0, index + 1).join('/');
      const identity = directories.get(relativePath);
      if (identity === undefined) throw new Error('Generated-state cleanup ancestor inventory is incomplete.');
      return Object.freeze({ relativePath, device: identity.device, inode: identity.inode });
    });
    deleteRetainedNoFollowEntryV1({
      root: directory,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      ancestorDirectories: ancestors
    });
  }
  const parent = inspectNoFollowDirectoryChainV1(path.dirname(directory.path), 'Generated-state quarantine parent').target;
  deleteRetainedNoFollowEntryV1({
    root: parent,
    relativePath: path.basename(directory.path),
    kind: 'directory',
    device: directory.device,
    inode: directory.inode,
    ancestorDirectories: Object.freeze([])
  });
}

export async function settleGeneratedStateV1(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
  profile: GeneratedStateCleanupProfileV1 | 'inspect-only';
  relativePaths?: readonly string[];
}>, options: GeneratedStateLifecycleOptionsV1 = {}): Promise<GeneratedStateSettlementV1> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot ?? input.repositoryRoot);
  const before = await inspectGeneratedStateV1({
    repositoryRoot,
    workspaceRoot,
    relativePaths: input.relativePaths
  }, options);
  const plan = input.profile === 'inspect-only'
    ? Object.freeze({ selected: Object.freeze([]) as readonly string[], protected: Object.freeze(
      before.entries.filter(({ kind }) => kind !== 'missing').map(({ relativePath }) => relativePath).sort()
    ) })
    : planGeneratedStateCleanupV1({ inventory: before, profile: input.profile });
  const attempts: Array<{
    relativePath: string;
    action: 'quarantined' | 'deleted' | 'protected' | 'residue';
    detailRef: `sha256:${string}`;
  }> = [];
  const blockers: string[] = [];
  if (input.profile === 'inspect-only') {
    return createGeneratedStateSettlementV1({
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
    if (registration === null || intent === null || !sameIdentity(registration.root, intent.root)) {
      blockers.push(`${entry.relativePath}:retired-absent-root-without-valid-intent`);
      attempts.push(Object.freeze({
        relativePath: entry.relativePath,
        action: 'residue',
        detailRef: generatedStateDigestV1('retired-absent-root-without-valid-intent')
      }));
      continue;
    }
    try {
      const tombstonePath = path.join(
        workspaceRoot, '.tmp', 'generated-state-quarantine', intent.tombstoneName
      );
      const tombstone = inspectExactNoFollowDirectoryPresenceV1(
        tombstonePath,
        'Generated-state interrupted quarantine'
      );
      if (tombstone.state === 'present') {
        if (!sameIdentity(identityOf(tombstone.directory.target), registration.root)) {
          throw new Error('Generated-state interrupted quarantine identity changed.');
        }
        deleteQuarantinedTree(tombstone.directory.target);
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
        detailRef: generatedStateDigestV1({
          intentDigest: intent.intentDigest,
          effect: 'interrupted-cleanup-physical-absence-readback'
        })
      }));
    } catch (error) {
      blockers.push(`${entry.relativePath}:interrupted-cleanup-residue`);
      attempts.push(Object.freeze({
        relativePath: entry.relativePath,
        action: 'residue',
        detailRef: generatedStateDigestV1(error instanceof Error ? error.message : String(error))
      }));
    }
  }
  if (plan.selected.length > 0) {
    const workspace = inspectNoFollowDirectoryChainV1(
      workspaceRoot,
      'Generated-state cleanup workspace'
    ).target;
    createNoFollowOrdinaryDirectoryChainV1(workspace, ['.tmp', 'generated-state-quarantine']);
    const quarantinePath = path.join(workspaceRoot, '.tmp', 'generated-state-quarantine');
    const quarantine = inspectExactNoFollowDirectoryPresenceV1(quarantinePath, 'Generated-state quarantine');
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
          detailRef: generatedStateDigestV1('changed-after-inventory-or-unsupported-kind')
        }));
        continue;
      }
      const tombstoneName = `q-${entry.registrationDigest!.slice('sha256:'.length, 'sha256:'.length + 48)}`;
      const intent = Object.freeze({
        schema: 'sec-generated-state-cleanup-intent-v1',
        beforeInventoryDigest: before.inventoryDigest,
        relativePath,
        root: entry.physicalIdentity,
        tombstoneName
      });
      const intentDigest = generatedStateDigestV1(intent);
      const intentPath = path.join(store.transactionsRoot, `intent-${intentDigest.slice('sha256:'.length)}.json`);
      const intentBytes = canonicalBytes(Object.freeze({ ...intent, intentDigest }));
      if (!store.fs.createExclusiveFsync(intentPath, intentBytes) && store.fs.readText(intentPath) !== intentBytes) {
        throw new Error('Generated-state cleanup intent collides with different bytes.');
      }
      store.fs.replaceFsync(transactionPointerPath(store, relativePath), intentBytes);
      try {
        await store.assertCurrent();
        const moved = relocateRetainedNoFollowDirectoryAcrossParentsV1({
          directory: current.directory,
          destinationParent: quarantine.directory.target,
          tombstoneName
        });
        attempts.push(Object.freeze({ relativePath, action: 'quarantined', detailRef: intentDigest }));
        await options.afterQuarantineEffect?.(relativePath);
        deleteQuarantinedTree(moved);
        const absent = inspectExactNoFollowDirectoryPresenceV1(
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
          detailRef: generatedStateDigestV1({ intentDigest, effect: 'physical-absence-readback' })
        }));
      } catch (error) {
        blockers.push(`${relativePath}:cleanup-residue`);
        attempts.push(Object.freeze({
          relativePath,
          action: 'residue',
          detailRef: generatedStateDigestV1(error instanceof Error ? error.message : String(error))
        }));
      }
    }
  }
  const quarantinePath = path.join(workspaceRoot, '.tmp', 'generated-state-quarantine');
  const quarantine = inspectExactNoFollowDirectoryPresenceV1(quarantinePath, 'Generated-state quarantine finalization');
  if (quarantine.state === 'present') {
    const quarantineInventory = scanNoFollowDirectoryTreeMetadataV1(quarantine.directory.target, {
        deadlineAtMs: performance.now() + CLEANUP_DEADLINE_MS,
        maximumEntries: MAXIMUM_CLEANUP_ENTRIES
      });
    if (quarantineInventory.length === 0) {
      const tmp = inspectNoFollowDirectoryChainV1(path.dirname(quarantinePath), 'Generated-state tmp root').target;
      deleteRetainedNoFollowEntryV1({
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
        detailRef: generatedStateDigestV1(Object.freeze({
          effect: 'quarantine-nonempty-readback',
          entryCount: quarantineInventory.length
        }))
      }));
    }
  }
  const after = await inspectGeneratedStateV1({
    repositoryRoot,
    workspaceRoot,
    relativePaths: input.relativePaths
  }, options);
  const terminal = blockers.length > 0
    ? 'partial-residue'
    : plan.selected.length === 0
      ? attempts.length === 0 ? 'no-op' : 'completed'
      : 'completed';
  const settlement = createGeneratedStateSettlementV1({
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

export function generatedStateProducerHooksV1(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot?: string;
}>, options: GeneratedStateLifecycleOptionsV1 = {}): Readonly<{
  born(relativePath: string, operationId: string): Promise<void>;
  retired(relativePath: string, outcome: string): Promise<void>;
  disposed(relativePath: string, outcome: string): Promise<void>;
}> {
  const producerSession = new Map<string, `sha256:${string}`>();
  const requireProducerBinding = (relativePath: string): `sha256:${string}` => {
    const normalized = normalizeGeneratedStateRelativePathV1(relativePath);
    const registrationDigest = producerSession.get(normalized);
    if (registrationDigest === undefined) {
      throw new Error('Generated-state retirement requires birth in the same producer session.');
    }
    return registrationDigest;
  };
  return Object.freeze({
    born: async (relativePath, operationId) => {
      const registration = await registerGeneratedStateBirthV1(
        { ...input, relativePath, operationId },
        options
      );
      producerSession.set(registration.relativePath, registration.registrationDigest);
    },
    retired: async (relativePath, outcome) => {
      const registration = await retireGeneratedStateV1({
        ...input,
        relativePath,
        expectedRegistrationDigest: requireProducerBinding(relativePath),
        outcome
      }, options);
      producerSession.set(registration.relativePath, registration.registrationDigest);
    },
    disposed: async (relativePath, outcome) => {
      const normalized = normalizeGeneratedStateRelativePathV1(relativePath);
      await retireGeneratedStateV1({
        ...input,
        relativePath: normalized,
        expectedRegistrationDigest: requireProducerBinding(normalized),
        outcome
      }, options);
      const receipt = await settleGeneratedStateV1({
        ...input,
        profile: 'automatic',
        relativePaths: [relativePath]
      }, options);
      if (receipt.terminal !== 'completed' && receipt.terminal !== 'no-op') {
        throw new Error(`Generated-state disposal did not close: ${receipt.settlementDigest}`);
      }
      producerSession.delete(normalized);
    }
  });
}

export function isGeneratedStatePhysicalFailureV1(error: unknown): error is PhysicalNoFollowError {
  return error instanceof PhysicalNoFollowError;
}
