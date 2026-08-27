import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  parseWorktreePorcelainZV1,
  parseWorktreeStatusPorcelainZV1,
  type WorktreeStatusPorcelainRecordV1
} from '../../platform/runtime-state/worktree-closeout-contract.ts';
import {
  GENERATED_STATE_REGISTRY_V1,
  assertGeneratedStateWorktreeRetirementV1,
  createGeneratedStateInventoryV1,
  createGeneratedStateRegistrationV1,
  createGeneratedStateSettlementV1,
  createGeneratedStateWorktreeRetirementV1,
  generatedStateCleanupAllowedV1,
  generatedStateDigestV1,
  generatedStateDomainProviderMaterialDigestV1,
  generatedStateRuleForPathV1,
  normalizeGeneratedStateRelativePathV1,
  parseGeneratedStateRegistrationV1,
  retireGeneratedStateRegistrationV1,
  type GeneratedStateCleanupProfileV1,
  type GeneratedStateInventoryEntryV1,
  type GeneratedStateInventoryV1,
  type GeneratedStatePhysicalFormV1,
  type GeneratedStatePhysicalIdentityV1,
  type GeneratedStateRegistrationV1,
  type GeneratedStateRuleV1,
  type GeneratedStateSettlementV1,
  type GeneratedStateWorktreeRetirementV1
} from '../../platform/shared/generated-state-contract.ts';
import {
  PhysicalNoFollowError,
  createNoFollowOrdinaryDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowLinkEntryV1,
  inspectNoFollowOrdinaryFileEntryV1,
  relocateRetainedNoFollowDirectoryAcrossParentsV1,
  scanNoFollowDirectoryTreeMetadataV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import { runCommandBytes, type ByteCommandResult } from '../../platform/shared/process.ts';
import { acquireWorkspaceWriteLease } from '../../platform/shared/workspace-write-lease.ts';
import { acquireSecRuntimeStatePhysicalAuthorityV1 } from './runtime-state-authority.ts';
import { createRuntimeStateJournalFileSystemV1 } from './runtime-state-journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRootsV1 } from './runtime-state-paths.ts';

const GENERATED_STATE_RUNTIME_VERSION = 'v1' as const;
const MAXIMUM_CLEANUP_ENTRIES = 100_000;
const CLEANUP_DEADLINE_MS = 30_000;

export interface GeneratedStateLifecycleOptionsV1 {
  readonly afterQuarantineEffect?: (relativePath: string) => void | Promise<void>;
  readonly afterWorktreeRetirementRelocation?: (relativePath: string) => void | Promise<void>;
  readonly afterWorktreeRetirementProviderEffect?: (relativePath: string) => void | Promise<void>;
  readonly beforeCleanupEffect?: (relativePath: string) => void | Promise<void>;
  readonly clock?: () => Date;
  readonly environment?: NodeJS.ProcessEnv;
  readonly worktreeRetirementProviders?: readonly GeneratedStateWorktreeRetirementProviderV1[];
  readonly runGit?: (
    command: string,
    args: string[],
    options: Readonly<{ cwd: string }>
  ) => Promise<ByteCommandResult>;
}

export interface GeneratedStateWorktreeRetirementProviderV1 {
  readonly id: string;
  plan(input: Readonly<{
    repositoryRoot: string;
    workspaceRoot: string;
    relativePath: string;
    source: GeneratedStatePhysicalIdentityV1;
    registration: GeneratedStateRegistrationV1;
  }>): Promise<Readonly<{
    bytes: string;
    digest: `sha256:${string}`;
  }>>;
  retire(input: Readonly<{
    operationId: `sha256:${string}`;
    repositoryRoot: string;
    workspaceRoot: string;
    relativePath: string;
    source: GeneratedStatePhysicalIdentityV1;
    registration: GeneratedStateRegistrationV1;
    planBytes: string;
    planDigest: `sha256:${string}`;
  }>): Promise<Readonly<{
    bytes: string;
    digest: `sha256:${string}`;
  }>>;
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
  linkTarget: string | null;
}>;

function canonicalBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function identityOf(value: Pick<PhysicalDirectoryIdentityV1, 'device' | 'inode' | 'objectId'>): GeneratedStatePhysicalIdentityV1 {
  return Object.freeze({ device: value.device, inode: value.inode, objectId: value.objectId });
}

function physicalFormForObservedKindV1(
  rule: GeneratedStateRuleV1,
  kind: ObservedGeneratedStateRootV1['kind']
): GeneratedStatePhysicalFormV1 | null {
  if (kind === 'missing') return null;
  return rule.physicalForms.find((form) => form.kind === kind) ?? null;
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
      return Object.freeze({ kind: 'missing', identity: null, directory: null, linkTarget: null });
    }
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    const parent = inspectNoFollowDirectoryChainV1(path.dirname(absolutePath), 'Generated-state link parent').target;
    const entry = inspectNoFollowLinkEntryV1(parent, path.basename(absolutePath));
    if (entry === null || entry.linkTarget === null) {
      return Object.freeze({ kind: 'missing', identity: null, directory: null, linkTarget: null });
    }
    return Object.freeze({
      kind: 'link',
      identity: Object.freeze({
        device: entry.device,
        inode: entry.inode,
        objectId: generatedStateDigestV1({ kind: 'link', target: entry.linkTarget })
      }),
      directory: null,
      linkTarget: entry.linkTarget
    });
  }
  if (metadata.isDirectory()) {
    const directory = inspectNoFollowDirectoryChainV1(absolutePath, 'Generated-state root').target;
    return Object.freeze({ kind: 'directory', identity: identityOf(directory), directory, linkTarget: null });
  }
  if (!metadata.isFile()) return Object.freeze({ kind: 'link', identity: null, directory: null, linkTarget: null });
  const parent = inspectNoFollowDirectoryChainV1(path.dirname(absolutePath), 'Generated-state file parent').target;
  const entry = inspectNoFollowOrdinaryFileEntryV1(parent, path.basename(absolutePath));
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
  if (observed.identity === null || physicalFormForObservedKindV1(rule, observed.kind) === null) {
    throw new Error('Generated-state birth requires one registered physical form with exact identity.');
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

interface GeneratedStateWorktreeRetirementIntentV1 {
  readonly schema: 'sec-generated-state-worktree-retirement-intent-v1';
  readonly operationId: `sha256:${string}`;
  readonly repositoryRoot: string;
  readonly workspacePath: string;
  readonly workspace: GeneratedStatePhysicalIdentityV1;
  readonly worktree: { readonly branch: string; readonly headSha: string; readonly treeSha: string };
  readonly statusDigest: `sha256:${string}`;
  readonly inventoryDigest: `sha256:${string}`;
  readonly retentionRoot: ({ readonly path: string } & GeneratedStatePhysicalIdentityV1) | null;
  readonly entries: readonly (
    | Readonly<{
        action: 'preserve';
        relativePath: string;
        destinationName: string;
        source: GeneratedStatePhysicalIdentityV1;
        inventoryDigest: `sha256:${string}`;
        ruleIds: readonly string[];
      }>
    | Readonly<{
        action: 'domain-retire';
        relativePath: string;
        source: GeneratedStatePhysicalIdentityV1;
        inventoryDigest: `sha256:${string}`;
        ruleIds: readonly string[];
        registration: GeneratedStateRegistrationV1;
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

export function isGeneratedStateWorktreeRetirementBlockedV1(error: unknown): error is GeneratedStateWorktreeRetirementBlockedError {
  return error instanceof GeneratedStateWorktreeRetirementBlockedError;
}

function worktreeRetirementIntentV1(
  input: Omit<GeneratedStateWorktreeRetirementIntentV1, 'schema' | 'intentDigest'>
): GeneratedStateWorktreeRetirementIntentV1 {
  const material = Object.freeze({
    schema: 'sec-generated-state-worktree-retirement-intent-v1' as const,
    ...input,
    entries: Object.freeze([...input.entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath)))
  });
  return Object.freeze({ ...material, intentDigest: generatedStateDigestV1(material) });
}

function parseWorktreeRetirementIntentV1(value: unknown): GeneratedStateWorktreeRetirementIntentV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Generated-state worktree retirement intent is not an object.');
  }
  const candidate = value as GeneratedStateWorktreeRetirementIntentV1;
  if (
    candidate.schema !== 'sec-generated-state-worktree-retirement-intent-v1' ||
    !Array.isArray(candidate.entries) ||
    typeof candidate.intentDigest !== 'string'
  ) {
    throw new Error('Generated-state worktree retirement intent is malformed.');
  }
  const rebuilt = worktreeRetirementIntentV1({
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
  if (rebuilt.intentDigest !== candidate.intentDigest || generatedStateDigestV1(rebuilt) !== generatedStateDigestV1(candidate)) {
    throw new Error('Generated-state worktree retirement intent digest is invalid.');
  }
  return candidate;
}

function rulesOwningGeneratedPathV1(relativePath: string): readonly GeneratedStateRuleV1[] {
  return GENERATED_STATE_REGISTRY_V1.rules.filter(({ selector }) => {
    if (selector.kind === 'exact') {
      return relativePath === selector.path || relativePath.startsWith(`${selector.path}/`);
    }
    if (!relativePath.startsWith(`${selector.parent}/`)) return false;
    const child = relativePath.slice(selector.parent.length + 1).split('/')[0]!;
    return child.startsWith(selector.prefix);
  });
}

function rulesBelowGeneratedPathV1(relativePath: string): readonly GeneratedStateRuleV1[] {
  return GENERATED_STATE_REGISTRY_V1.rules.filter(({ selector }) => {
    const anchor = selector.kind === 'exact' ? selector.path : selector.parent;
    return anchor === relativePath || anchor.startsWith(`${relativePath}/`);
  });
}

async function exactIgnoredRootPlanV1(
  repositoryRoot: string,
  workspaceRoot: string,
  relativePath: string,
  excludedOwnerAnchor: string | null,
  store: GeneratedStateRuntimeStoreV1,
  options: GeneratedStateLifecycleOptionsV1
): Promise<GeneratedStateWorktreeRetirementIntentV1['entries'][number]> {
  const observed = observeRoot(workspaceRoot, relativePath);
  const withoutExcludedOwner = (rules: readonly GeneratedStateRuleV1[]) => rules.filter(({ selector }) =>
    (selector.kind === 'exact' ? selector.path : selector.parent) !== excludedOwnerAnchor
  );
  const directOwners = withoutExcludedOwner(rulesOwningGeneratedPathV1(relativePath));
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
      : scanNoFollowDirectoryTreeMetadataV1(observed.directory!, {
          deadlineAtMs: performance.now() + CLEANUP_DEADLINE_MS,
          maximumEntries: MAXIMUM_CLEANUP_ENTRIES
        });
  const coveredRules = new Set(directOwners.map(({ id }) => id));
  if (directOwners.length === 0 && withoutExcludedOwner(rulesBelowGeneratedPathV1(relativePath)).length === 0) {
    throw new GeneratedStateWorktreeRetirementBlockedError(
      `Generated-state worktree retirement found an unknown ignored root: ${relativePath}.`
    );
  }
  for (const entry of inventory) {
    const childPath = `${relativePath}/${entry.relativePath}`;
    const owners = withoutExcludedOwner(rulesOwningGeneratedPathV1(childPath));
    const descendants = withoutExcludedOwner(rulesBelowGeneratedPathV1(childPath));
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
    ? physicalFormForObservedKindV1(directOwners[0]!, observed.kind)
    : null;
  if (directOwners.length > 0 && directForm === null) {
    throw new GeneratedStateWorktreeRetirementBlockedError(
      `Generated-state worktree retirement physical form is not registered: ${relativePath}.`
    );
  }
  if (directForm?.worktreeRetirement.mode === 'domain-retire') {
    const providerId = directForm.worktreeRetirement.providerId;
    const registration = loadRegistration(store, relativePath);
    if (registration === null || registration.phase !== 'retired' ||
        registration.ruleId !== directOwners[0]!.id || !sameIdentity(registration.root, source)) {
      throw new GeneratedStateWorktreeRetirementBlockedError(
        `Generated-state worktree retirement lacks one exact retired domain registration: ${relativePath}.`
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
    if (plan.digest !== generatedStateDomainProviderMaterialDigestV1(provider.id, 'plan', plan.bytes)) {
      throw new Error(`Generated-state worktree retirement provider plan digest is invalid: ${provider.id}.`);
    }
    return Object.freeze({
      action: 'domain-retire' as const,
      relativePath,
      source,
      inventoryDigest: generatedStateDigestV1({ relativePath, source, providerId: provider.id, providerPlanDigest: plan.digest }),
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
    destinationName: `g-${generatedStateDigestV1({ relativePath, source }).slice('sha256:'.length)}`,
    source,
    inventoryDigest: generatedStateDigestV1({ relativePath, source, inventory }),
    ruleIds: Object.freeze([...coveredRules].sort())
  });
}

async function worktreeRetirementGitV1(options: GeneratedStateLifecycleOptionsV1, cwd: string, args: string[]): Promise<ByteCommandResult> {
  return (options.runGit ?? ((command, commandArgs, runOptions) => runCommandBytes(command, commandArgs, { cwd: runOptions.cwd })))(
    'git',
    args,
    { cwd }
  );
}

function sameWorktreeRetirementIdentityV1(left: GeneratedStatePhysicalIdentityV1, right: GeneratedStatePhysicalIdentityV1): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

async function worktreeRetirementStatusV1(
  repositoryRoot: string,
  workspaceRoot: string,
  ownedLeaseRelativePath: string,
  options: GeneratedStateLifecycleOptionsV1
): Promise<
  Readonly<{
    statusDigest: `sha256:${string}`;
    ignoredRoots: readonly Readonly<{ relativePath: string; excludedOwnerAnchor: string | null }>[];
    blockedByOrdinaryState: boolean;
  }>
> {
  const status = await worktreeRetirementGitV1(options, repositoryRoot, [
    '-C',
    workspaceRoot,
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignored=matching'
  ]);
  if (status.code !== 0) throw new Error('Generated-state worktree retirement cannot observe Git status.');
  const records = parseWorktreeStatusPorcelainZV1(status.stdout);
  type ProjectedStatusRecord = Readonly<{
    record: WorktreeStatusPorcelainRecordV1;
    excludedOwnerAnchor: string | null;
  }>;
  const retained = records.flatMap<ProjectedStatusRecord>((record): ProjectedStatusRecord[] => {
    const generatedProjection = (record.index === '!' && record.worktree === '!') || (record.index === '?' && record.worktree === '?');
    if (!generatedProjection) return [Object.freeze({ record, excludedOwnerAnchor: null })];
    if (record.path === ownedLeaseRelativePath || record.path.startsWith(`${ownedLeaseRelativePath}/`)) return [];
    if (!ownedLeaseRelativePath.startsWith(`${record.path}/`)) {
      return [Object.freeze({ record, excludedOwnerAnchor: null })];
    }
    const root = inspectNoFollowDirectoryChainV1(
      path.join(workspaceRoot, ...record.path.split('/')),
      'Generated-state worktree retirement lease ancestor'
    ).target;
    const suffix = ownedLeaseRelativePath.slice(record.path.length + 1);
    const leaseChild = suffix.split('/')[0]!;
    const inventory = scanNoFollowDirectoryTreeMetadataV1(root, {
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
    relativePath: normalizeGeneratedStateRelativePathV1(relativePath),
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
    statusDigest: generatedStateDigestV1({ records: retained }),
    ignoredRoots: Object.freeze(ignoredRoots),
    blockedByOrdinaryState:
      nonIgnored.length > 0 || ignoredRoots.some(({ relativePath }) => ownedLeaseRelativePath.startsWith(`${relativePath}/`))
  });
}

function validateWorktreeRetirementReceiptPhysicalV1(receipt: GeneratedStateWorktreeRetirementV1): GeneratedStateWorktreeRetirementV1 {
  assertGeneratedStateWorktreeRetirementV1(receipt);
  const retentionRoot = receipt.retentionRoot === null
    ? null
    : inspectNoFollowDirectoryChainV1(
        receipt.retentionRoot.path,
        'Generated-state worktree retirement retained root'
      ).target;
  if (retentionRoot !== null && !sameWorktreeRetirementIdentityV1(identityOf(retentionRoot), receipt.retentionRoot!)) {
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
    const retained = inspectNoFollowDirectoryChainV1(
      path.join(retentionRoot.path, entry.destinationName),
      `Generated-state worktree retirement retained ${entry.relativePath}`
    ).target;
    if (
      !sameWorktreeRetirementIdentityV1(identityOf(retained), entry.retained) ||
      !sameWorktreeRetirementIdentityV1(entry.source, entry.retained)
    ) {
      throw new Error(`Generated-state worktree retirement retained identity changed: ${entry.relativePath}.`);
    }
  }
  return receipt;
}

export function assertGeneratedStateWorktreeRetirementEffectStartV1(
  input: Readonly<{
    receipt: GeneratedStateWorktreeRetirementV1;
    repositoryRoot: string;
    workspaceRoot: string;
    expectedBranch: string;
    expectedHeadSha: string;
    expectedTreeSha: string;
  }>
): GeneratedStateWorktreeRetirementV1 {
  const receipt = validateWorktreeRetirementReceiptPhysicalV1(input.receipt);
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

export async function settleGeneratedStateForWorktreeRetirementV1(
  input: Readonly<{
    repositoryRoot: string;
    workspaceRoot: string;
    expectedBranch: string;
    expectedHeadSha: string;
    expectedTreeSha: string;
  }>,
  options: GeneratedStateLifecycleOptionsV1 = {}
): Promise<GeneratedStateWorktreeRetirementV1 | null> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const lease = await acquireWorkspaceWriteLease(workspaceRoot);
  try {
    await lease.assertOwned();
    const ownedNamespace = await lease.ownedNamespace();
    const workspace = inspectNoFollowDirectoryChainV1(workspaceRoot, 'Generated-state worktree retirement workspace').target;
    const worktrees = await worktreeRetirementGitV1(options, repositoryRoot, ['worktree', 'list', '--porcelain', '-z']);
    if (worktrees.code !== 0) throw new Error('Generated-state worktree retirement cannot observe worktree registry.');
    const records = parseWorktreePorcelainZV1(worktrees.stdout);
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
    const tree = await worktreeRetirementGitV1(options, repositoryRoot, ['-C', workspaceRoot, 'rev-parse', 'HEAD^{tree}']);
    if (tree.code !== 0 || Buffer.from(tree.stdout).toString('utf8').trim() !== input.expectedTreeSha) {
      throw new Error('Generated-state worktree retirement tree changed before admission.');
    }
    const readOnlyStore = openRuntimeStoreReadOnly(workspaceRoot, options);
    const readOnlyActivePath =
      readOnlyStore === null ? null : path.join(readOnlyStore.transactionsRoot, WORKTREE_RETIREMENT_ACTIVE_POINTER);
    const readOnlyLatestPath = readOnlyStore === null ? null : path.join(readOnlyStore.settlementsRoot, WORKTREE_RETIREMENT_LATEST_POINTER);
    const observedActive =
      readOnlyStore !== null && readOnlyActivePath !== null && readOnlyStore.fs.exists(readOnlyActivePath)
        ? parseWorktreeRetirementIntentV1(JSON.parse(readOnlyStore.fs.readText(readOnlyActivePath)) as unknown)
        : null;
    const status = await worktreeRetirementStatusV1(repositoryRoot, workspaceRoot, ownedNamespace.relativePath, options);
    if (status.blockedByOrdinaryState) return null;
    if (observedActive === null && status.ignoredRoots.length === 0) {
      if (readOnlyStore === null || readOnlyLatestPath === null || !readOnlyStore.fs.exists(readOnlyLatestPath)) {
        return null;
      }
      const receipt = validateWorktreeRetirementReceiptPhysicalV1(
        assertGeneratedStateWorktreeRetirementV1(
          JSON.parse(readOnlyStore.fs.readText(readOnlyLatestPath)) as GeneratedStateWorktreeRetirementV1
        )
      );
      await readOnlyStore.assertCurrent();
      return receipt;
    }
    const store = await openRuntimeStore(workspaceRoot, options);
    await store.assertCurrent();
    const activePath = path.join(store.transactionsRoot, WORKTREE_RETIREMENT_ACTIVE_POINTER);
    const latestPath = path.join(store.settlementsRoot, WORKTREE_RETIREMENT_LATEST_POINTER);
    let intent = store.fs.exists(activePath) ? parseWorktreeRetirementIntentV1(JSON.parse(store.fs.readText(activePath)) as unknown) : null;
    if (
      (observedActive === null) !== (intent === null) ||
      (observedActive !== null && intent !== null && observedActive.intentDigest !== intent.intentDigest)
    ) {
      throw new Error('Generated-state worktree retirement active intent changed during admission.');
    }
    if (intent === null) {
      const entries = Object.freeze(await Promise.all(status.ignoredRoots.map(({ relativePath, excludedOwnerAnchor }) =>
        exactIgnoredRootPlanV1(repositoryRoot, workspaceRoot, relativePath, excludedOwnerAnchor, store, options)
      )));
      const inventoryDigest = generatedStateDigestV1(entries);
      const operationId = generatedStateDigestV1(
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
          registryDigest: GENERATED_STATE_REGISTRY_V1.registryDigest
        })
      );
      const needsRetentionRoot = entries.some(({ action }) => action === 'preserve');
      let retentionRoot: PhysicalDirectoryIdentityV1 | null = null;
      if (needsRetentionRoot) {
        const parent = inspectNoFollowDirectoryChainV1(
          path.dirname(workspaceRoot),
          'Generated-state worktree retirement retention parent'
        ).target;
        const retentionRootPath = path.join(
          path.dirname(workspaceRoot),
          `sec-generated-state-retirement-${operationId.slice('sha256:'.length)}`
        );
        if (inspectExactNoFollowDirectoryPresenceV1(
          retentionRootPath,
          'Generated-state worktree retirement new retention root'
        ).state !== 'absent') {
          throw new Error('Generated-state worktree retirement retention root exists without an active intent.');
        }
        retentionRoot = createNoFollowOrdinaryDirectoryChainV1(parent, [path.basename(retentionRootPath)]);
        if (retentionRoot.device !== workspace.device ||
            scanNoFollowDirectoryTreeMetadataV1(retentionRoot, {
              deadlineAtMs: performance.now() + CLEANUP_DEADLINE_MS,
              maximumEntries: MAXIMUM_CLEANUP_ENTRIES
            }).length !== 0) {
          throw new Error('Generated-state worktree retirement new retention root is not one empty same-volume object.');
        }
      }
      intent = worktreeRetirementIntentV1({
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
    }
    if (
      intent.repositoryRoot !== repositoryRoot ||
      intent.workspacePath !== workspaceRoot ||
      !sameWorktreeRetirementIdentityV1(intent.workspace, identityOf(workspace)) ||
      intent.worktree.branch !== input.expectedBranch ||
      intent.worktree.headSha !== input.expectedHeadSha ||
      intent.worktree.treeSha !== input.expectedTreeSha
    ) {
      throw new Error('Generated-state worktree retirement active intent belongs to another admission.');
    }
    const retentionRoot = intent.retentionRoot === null
      ? null
      : inspectNoFollowDirectoryChainV1(
          intent.retentionRoot.path,
          'Generated-state worktree retirement retention root'
        ).target;
    if (retentionRoot !== null && (retentionRoot.device !== workspace.device ||
        !sameWorktreeRetirementIdentityV1(identityOf(retentionRoot), intent.retentionRoot!))) {
      throw new Error('Generated-state worktree retirement retention root identity changed.');
    }
    if (retentionRoot !== null) {
      const knownDestinations = new Set(intent.entries
        .filter((entry) => entry.action === 'preserve')
        .map(({ destinationName }) => destinationName));
      const unknownRetentionEntries = scanNoFollowDirectoryTreeMetadataV1(retentionRoot, {
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
    const retainedEntries = [] as Array<GeneratedStateWorktreeRetirementV1['entries'][number]>;
    for (const entry of intent.entries) {
      await lease.assertOwned();
      if (entry.action === 'domain-retire') {
        const providers = options.worktreeRetirementProviders?.filter(({ id }) => id === entry.providerId) ?? [];
        if (providers.length !== 1) {
          throw new GeneratedStateWorktreeRetirementBlockedError(
            `Generated-state worktree retirement provider is unavailable or ambiguous: ${entry.providerId}.`
          );
        }
        const provider = providers[0]!;
        const providerReceipt = await provider.retire({
          operationId: intent.operationId,
          repositoryRoot,
          workspaceRoot,
          relativePath: entry.relativePath,
          source: entry.source,
          registration: entry.registration,
          planBytes: entry.providerPlanBytes,
          planDigest: entry.providerPlanDigest
        });
        await options.afterWorktreeRetirementProviderEffect?.(entry.relativePath);
        if (providerReceipt.digest !== generatedStateDomainProviderMaterialDigestV1(
          provider.id,
          'receipt',
          providerReceipt.bytes
        )) {
          throw new Error(`Generated-state worktree retirement provider receipt digest is invalid: ${provider.id}.`);
        }
        if (observeRoot(workspaceRoot, entry.relativePath).kind !== 'missing') {
          throw new Error(`Generated-state worktree retirement provider left source present: ${entry.relativePath}.`);
        }
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
      const destination = inspectExactNoFollowDirectoryPresenceV1(destinationPath, `Generated-state retained ${entry.relativePath}`);
      let retained: PhysicalDirectoryIdentityV1;
      if (
        source.kind === 'directory' &&
        source.directory !== null &&
        source.identity !== null &&
        sameWorktreeRetirementIdentityV1(source.identity, entry.source) &&
        destination.state === 'absent'
      ) {
        retained = relocateRetainedNoFollowDirectoryAcrossParentsV1({
          directory: source.directory,
          destinationParent: retentionRoot,
          tombstoneName: entry.destinationName
        });
        await options.afterWorktreeRetirementRelocation?.(entry.relativePath);
      } else if (
        source.kind === 'missing' &&
        destination.state === 'present' &&
        sameWorktreeRetirementIdentityV1(identityOf(destination.directory.target), entry.source)
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
    const receipt = createGeneratedStateWorktreeRetirementV1({
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
    return validateWorktreeRetirementReceiptPhysicalV1(receipt);
  } finally {
    await lease.release();
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
    const physicalForm = physicalFormForObservedKindV1(rule, observed.kind);
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
