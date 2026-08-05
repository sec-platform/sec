import { createHash, randomUUID } from 'node:crypto';
import type { BigIntStats, Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  GENERATED_STATE_CLEANUP_RECEIPT_SCHEMA,
  GENERATED_STATE_DIAGNOSTIC_RETENTION_MS,
  GENERATED_STATE_INVENTORY_SCHEMA,
  GENERATED_STATE_LEGACY_WORKSPACE_GRACE_MS,
  GENERATED_STATE_OWNER_SCHEMA,
  GENERATED_STATE_REGISTRY_REVISION,
  GENERATED_STATE_TRANSACTION_SCHEMA,
  classifyGeneratedStatePath,
  generatedStateCleanupAllowed,
  generatedStateDigest,
  isGeneratedStateOwner,
  type GeneratedStateClassification,
  type GeneratedStateCleanupAttempt,
  type GeneratedStateCleanupProfile,
  type GeneratedStateCleanupReceipt,
  type GeneratedStateCleanupTransaction,
  type GeneratedStateCleanupTransactionItem,
  type GeneratedStateInventory,
  type GeneratedStateInventoryEntry,
  type GeneratedStateOwner,
  type GeneratedStateOwnerResolution,
  type GeneratedStatePathKind,
  type GeneratedStateStatus
} from '../shared/generated-state-contract.ts';
import { compilerRoot } from '../shared/paths.ts';

const OWNER_DIRECTORY = '.sec-generated-state-owners';
const CLEANUP_LOCK_DIRECTORY = '.generated-state-cleanup-lock';
const TRANSACTION_DIRECTORY = '.generated-state-transactions';
const TRANSACTION_MANIFEST = 'transaction.json';
const TRANSIENT_REMOVE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
const REMOVE_RETRY_DELAYS_MS = [50, 100, 200, 400, 800] as const;

export type GeneratedStateRuntimeOptions = Readonly<{
  repositoryRoot?: string;
  host?: string;
  now?: () => Date;
  processIsAlive?: (pid: number) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
  deepInventory?: boolean;
  beforeQuarantineForTest?: (relativePath: string) => void | Promise<void>;
  afterQuarantineForTest?: (relativePath: string) => void | Promise<void>;
}>;

export type GeneratedStateCleanupOptions = GeneratedStateRuntimeOptions & Readonly<{
  profile: GeneratedStateCleanupProfile;
  dryRun?: boolean;
  explicitRelativePaths?: readonly string[];
  onlyExplicit?: boolean;
}>;

function runtimeRepositoryRoot(options: GeneratedStateRuntimeOptions): string {
  return path.resolve(options.repositoryRoot ?? compilerRoot);
}

function runtimeHost(options: GeneratedStateRuntimeOptions): string {
  return options.host ?? os.hostname();
}

function runtimeNow(options: GeneratedStateRuntimeOptions): Date {
  return options.now?.() ?? new Date();
}

function runtimeProcessIsAlive(options: GeneratedStateRuntimeOptions): (pid: number) => boolean {
  return options.processIsAlive ?? ((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  });
}

function runtimeSleep(options: GeneratedStateRuntimeOptions): (delayMs: number) => Promise<void> {
  return options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
}

export function getGeneratedStateRoot(repositoryRoot = compilerRoot): string {
  return path.join(path.resolve(repositoryRoot), '.tmp');
}

function toPosixRelative(root: string, target: string): string {
  return path.relative(root, target).replaceAll('\\', '/');
}

function assertInside(root: string, target: string, label: string): void {
  const relative = path.relative(root, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a strict descendant of the generated-state root.`);
  }
}

function safeNamespace(value: string | undefined): string | undefined {
  const namespace = value?.trim();
  if (!namespace) return undefined;
  if (namespace === '.' || namespace === '..' || !/^[A-Za-z0-9._-]+$/u.test(namespace)) {
    throw new Error('SEC_TEST_WORKSPACE_NAMESPACE must be a safe single path segment');
  }
  return namespace;
}

function errnoCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statKind(stat: BigIntStats): GeneratedStatePathKind {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  return 'other';
}

async function lstatOrNull(target: string): Promise<BigIntStats | null> {
  try {
    return await fs.lstat(target, { bigint: true });
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function statIdentity(stat: BigIntStats): GeneratedStateCleanupTransactionItem['expectedIdentity'] {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    mode: stat.mode.toString(),
    mtimeMs: Number(stat.mtimeMs),
    size: Number(stat.size)
  };
}

function sameIdentity(
  stat: BigIntStats,
  expected: GeneratedStateCleanupTransactionItem['expectedIdentity']
): boolean {
  const actual = statIdentity(stat);
  return actual.dev === expected.dev
    && actual.ino === expected.ino
    && actual.mode === expected.mode
    && actual.mtimeMs === expected.mtimeMs
    && actual.size === expected.size;
}

async function ensureGeneratedRootSafe(root: string): Promise<void> {
  const parent = path.dirname(root);
  await fs.mkdir(parent, { recursive: true });
  const parentStat = await fs.lstat(parent, { bigint: true });
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error('Generated-state parent must be a physical directory.');
  }
  const rootStat = await lstatOrNull(root);
  if (rootStat === null) {
    await fs.mkdir(root);
    return;
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Generated-state root must be a physical directory.');
  }
}

async function measureNoFollow(target: string): Promise<{
  files: number;
  directories: number;
  bytes: number;
  unsafe: string[];
  physicalSnapshotDigest: `sha256:${string}`;
}> {
  const unsafe: string[] = [];
  let files = 0;
  let directories = 0;
  let bytes = 0;
  const snapshot = createHash('sha256');

  async function visit(current: string, root: boolean): Promise<void> {
    const stat = await fs.lstat(current, { bigint: true });
    const relative = toPosixRelative(target, current) || '.';
    const kind = statKind(stat);
    snapshot.update(JSON.stringify({
      relative,
      kind,
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      mode: stat.mode.toString(),
      mtimeMs: Number(stat.mtimeMs),
      size: Number(stat.size)
    }));
    snapshot.update('\0');
    if (stat.isSymbolicLink()) {
      files += 1;
      bytes += Number(stat.size);
      unsafe.push(toPosixRelative(target, current) || '.');
      return;
    }
    if (stat.isDirectory()) {
      directories += 1;
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(path.join(current, entry.name), false);
      }
      return;
    }
    files += 1;
    bytes += Number(stat.size);
    if (root && !stat.isFile()) unsafe.push('.');
  }

  await visit(target, true);
  return {
    files,
    directories,
    bytes,
    unsafe,
    physicalSnapshotDigest: `sha256:${snapshot.digest('hex')}`
  };
}

function ownerFileName(owner: GeneratedStateOwner): string {
  return `${owner.pid}-${owner.token}.json`;
}

function currentOwner(namespace: string, options: GeneratedStateRuntimeOptions): GeneratedStateOwner {
  return Object.freeze({
    schema: GENERATED_STATE_OWNER_SCHEMA,
    repositoryRoot: runtimeRepositoryRoot(options),
    namespace,
    host: runtimeHost(options),
    pid: process.pid,
    token: randomUUID(),
    createdAt: runtimeNow(options).toISOString()
  });
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const candidate = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(candidate, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    await fs.rename(candidate, target);
  } catch (error) {
    await fs.rm(candidate, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function registerCurrentTestProcessGeneratedState(
  env: NodeJS.ProcessEnv = process.env,
  options: GeneratedStateRuntimeOptions = {}
): Promise<GeneratedStateOwner | null> {
  const namespace = safeNamespace(env.SEC_TEST_WORKSPACE_NAMESPACE);
  if (!namespace) return null;
  const repositoryRoot = runtimeRepositoryRoot(options);
  const generatedRoot = getGeneratedStateRoot(repositoryRoot);
  await ensureGeneratedRootSafe(generatedRoot);
  const runRoot = path.join(generatedRoot, 'test-workspaces', namespace);
  assertInside(generatedRoot, runRoot, 'Test workspace run root');
  const ownersRoot = path.join(runRoot, OWNER_DIRECTORY);
  const owner = currentOwner(namespace, options);
  await fs.mkdir(ownersRoot, { recursive: true });
  await fs.writeFile(
    path.join(ownersRoot, ownerFileName(owner)),
    `${JSON.stringify(owner)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  );
  return owner;
}

async function readOwnerResolution(
  runRoot: string,
  options: GeneratedStateRuntimeOptions
): Promise<GeneratedStateOwnerResolution> {
  const ownersRoot = path.join(runRoot, OWNER_DIRECTORY);
  const ownersStat = await lstatOrNull(ownersRoot);
  if (ownersStat === null) return { state: 'absent', owners: [], invalidFiles: [] };
  if (ownersStat.isSymbolicLink() || !ownersStat.isDirectory()) {
    return { state: 'invalid', owners: [], invalidFiles: [OWNER_DIRECTORY] };
  }
  const owners: GeneratedStateOwner[] = [];
  const invalidFiles: string[] = [];
  const ownerIdentities = new Set<string>();
  const expectedNamespace = path.basename(runRoot);
  const entries = await fs.readdir(ownersRoot, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      invalidFiles.push(entry.name);
      continue;
    }
    try {
      const raw: unknown = JSON.parse(await fs.readFile(path.join(ownersRoot, entry.name), 'utf8'));
      if (
        !isGeneratedStateOwner(raw)
        || raw.namespace !== expectedNamespace
        || entry.name !== ownerFileName(raw)
        || Date.parse(raw.createdAt) > runtimeNow(options).getTime() + 5 * 60 * 1000
      ) {
        invalidFiles.push(entry.name);
        continue;
      }
      const identity = `${raw.pid}:${raw.token}`;
      if (ownerIdentities.has(identity)) {
        invalidFiles.push(entry.name);
        continue;
      }
      ownerIdentities.add(identity);
      owners.push(raw);
    } catch {
      invalidFiles.push(entry.name);
    }
  }
  if (invalidFiles.length > 0) return { state: 'invalid', owners, invalidFiles };
  if (owners.length === 0) return { state: 'absent', owners: [], invalidFiles: [] };
  const host = runtimeHost(options);
  const repositoryRoot = runtimeRepositoryRoot(options);
  if (owners.some((owner) => owner.host !== host || path.resolve(owner.repositoryRoot) !== repositoryRoot)) {
    return { state: 'cross-host', owners, invalidFiles: [] };
  }
  const isAlive = runtimeProcessIsAlive(options);
  return {
    state: owners.some((owner) => isAlive(owner.pid)) ? 'active' : 'dead',
    owners,
    invalidFiles: []
  };
}

function statusForEntry(
  classification: GeneratedStateClassification,
  kind: GeneratedStatePathKind,
  modifiedAtMs: number,
  ownerResolution: GeneratedStateOwnerResolution | null,
  relativePath: string,
  unsafeDescendants: readonly string[],
  nowMs: number
): GeneratedStateStatus {
  if (kind === 'symlink' || kind === 'other' || unsafeDescendants.length > 0) return 'unsafe-entry';
  if (classification.stateClass === 'unknown') return 'unknown';
  if (classification.stateClass === 'recovery-asset') return 'invalid-location';
  if (classification.stateClass === 'identity-bound-control') {
    return relativePath.startsWith(`${TRANSACTION_DIRECTORY}/`) ? 'cleanup-residue' : 'control-state';
  }
  if (classification.stateClass === 'diagnostic') {
    return nowMs - modifiedAtMs >= GENERATED_STATE_DIAGNOSTIC_RETENTION_MS
      ? 'expired-diagnostic'
      : 'retained';
  }
  if (
    classification.stateClass === 'rebuildable-cache'
    || classification.stateClass === 'derived-toolchain'
  ) return 'rebuildable';
  if (ownerResolution?.state === 'active') return 'active';
  if (ownerResolution?.state === 'dead') return 'orphaned';
  if (ownerResolution?.state === 'invalid' || ownerResolution?.state === 'cross-host') return 'unsafe-entry';
  return nowMs - modifiedAtMs >= GENERATED_STATE_LEGACY_WORKSPACE_GRACE_MS
    ? 'legacy-expired'
    : 'legacy-unowned';
}

async function inventoryEntry(
  target: string,
  relativePath: string,
  options: GeneratedStateRuntimeOptions,
  testWorkspaceRun: boolean
): Promise<GeneratedStateInventoryEntry> {
  const stat = await fs.lstat(target, { bigint: true });
  const kind = statKind(stat);
  const classification = classifyGeneratedStatePath(relativePath);
  let measured: Awaited<ReturnType<typeof measureNoFollow>> | null = null;
  if (options.deepInventory !== false) {
    try {
      measured = await measureNoFollow(target);
    } catch {
      measured = null;
    }
  }
  const ownerResolution = testWorkspaceRun && kind === 'directory'
    ? await readOwnerResolution(target, options)
    : null;
  const diagnostics: string[] = [];
  if (measured === null) diagnostics.push('size-inventory-unresolved');
  for (const unsafe of measured?.unsafe ?? []) diagnostics.push(`reparse:${unsafe}`);
  if (ownerResolution?.state === 'invalid') {
    diagnostics.push(...ownerResolution.invalidFiles.map((entry) => `invalid-owner:${entry}`));
  }
  if (ownerResolution?.state === 'cross-host') diagnostics.push('owner-liveness-cross-host');
  const modifiedAtMs = Number(stat.mtimeMs);
  const status = statusForEntry(
    classification,
    kind,
    modifiedAtMs,
    ownerResolution,
    relativePath,
    measured?.unsafe ?? [],
    runtimeNow(options).getTime()
  );
  return Object.freeze({
    relativePath,
    absolutePath: target,
    kind,
    ruleId: classification.ruleId,
    owner: classification.owner,
    stateClass: classification.stateClass,
    reconstruction: classification.reconstruction,
    cleanupProfiles: classification.cleanup,
    status,
    settlement: classification.settlement,
    modifiedAt: new Date(modifiedAtMs).toISOString(),
    size: measured === null
      ? { files: null, directories: null, bytes: null }
      : { files: measured.files, directories: measured.directories, bytes: measured.bytes },
    ownerResolution,
    diagnostics: Object.freeze(diagnostics.sort())
  });
}

function isSpecialTestWorkspaceChild(name: string): boolean {
  return name === '.templates'
    || name === '.last-cleanup'
    || name === '.cleanup-lock'
    || name === '.gate-supervisor-leases'
    || name === 'playwright-transform-cache';
}

async function inventoryTemplateChildren(
  root: string,
  options: GeneratedStateRuntimeOptions
): Promise<GeneratedStateInventoryEntry[]> {
  const rootStat = await fs.lstat(root, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [await inventoryEntry(root, 'test-workspaces/.templates', options, false)];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const inventory: GeneratedStateInventoryEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    inventory.push(await inventoryEntry(
      path.join(root, entry.name),
      `test-workspaces/.templates/${entry.name}`,
      options,
      false
    ));
  }
  return inventory;
}

async function inventoryTestWorkspaceChildren(
  root: string,
  options: GeneratedStateRuntimeOptions
): Promise<GeneratedStateInventoryEntry[]> {
  const rootStat = await fs.lstat(root, { bigint: true });
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [await inventoryEntry(root, 'test-workspaces', options, false)];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const inventory: GeneratedStateInventoryEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(root, entry.name);
    if (entry.name === '.templates') {
      inventory.push(...await inventoryTemplateChildren(target, options));
      continue;
    }
    const relativePath = `test-workspaces/${entry.name}`;
    inventory.push(await inventoryEntry(
      target,
      relativePath,
      options,
      !isSpecialTestWorkspaceChild(entry.name)
    ));
  }
  return inventory;
}

function inventoryDigestInput(inventory: Omit<GeneratedStateInventory, 'digest'>): unknown {
  return {
    ...inventory,
    observedAt: '<observation-time>',
    entries: inventory.entries.map((entry) => ({
      ...entry,
      absolutePath: '<generated-root>/' + entry.relativePath
    }))
  };
}

export async function inspectGeneratedState(
  options: GeneratedStateRuntimeOptions = {}
): Promise<GeneratedStateInventory> {
  const repositoryRoot = runtimeRepositoryRoot(options);
  const generatedRoot = getGeneratedStateRoot(repositoryRoot);
  const observedAt = runtimeNow(options).toISOString();
  const rootStat = await lstatOrNull(generatedRoot);
  if (rootStat === null) {
    const empty = {
      schema: GENERATED_STATE_INVENTORY_SCHEMA,
      registryRevision: GENERATED_STATE_REGISTRY_REVISION,
      repositoryRoot,
      generatedRoot,
      observedAt,
      entries: Object.freeze([]) as readonly GeneratedStateInventoryEntry[],
      blockers: Object.freeze([]) as readonly string[]
    } as const;
    return Object.freeze({ ...empty, digest: generatedStateDigest(inventoryDigestInput(empty)) });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    const entry = await inventoryEntry(generatedRoot, '.tmp', options, false);
    const unsafe = {
      schema: GENERATED_STATE_INVENTORY_SCHEMA,
      registryRevision: GENERATED_STATE_REGISTRY_REVISION,
      repositoryRoot,
      generatedRoot,
      observedAt,
      entries: Object.freeze([entry]),
      blockers: Object.freeze(['generated-root:unsafe-entry'])
    } as const;
    return Object.freeze({ ...unsafe, digest: generatedStateDigest(inventoryDigestInput(unsafe)) });
  }

  const directoryEntries = await fs.readdir(generatedRoot, { withFileTypes: true });
  const entries: GeneratedStateInventoryEntry[] = [];
  for (const entry of directoryEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = path.join(generatedRoot, entry.name);
    if (entry.name === 'test-workspaces') {
      entries.push(...await inventoryTestWorkspaceChildren(target, options));
      continue;
    }
    if (entry.name === TRANSACTION_DIRECTORY && entry.isDirectory()) {
      const transactions = await fs.readdir(target, { withFileTypes: true });
      if (transactions.length === 0) continue;
      for (const transaction of transactions.sort((left, right) => left.name.localeCompare(right.name))) {
        entries.push(await inventoryEntry(
          path.join(target, transaction.name),
          `${TRANSACTION_DIRECTORY}/${transaction.name}`,
          options,
          false
        ));
      }
      continue;
    }
    entries.push(await inventoryEntry(target, entry.name, options, false));
  }
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const blockers = entries.flatMap((entry) => {
    if (
      entry.status === 'orphaned'
      || entry.status === 'legacy-expired'
      || entry.status === 'expired-diagnostic'
      || entry.status === 'invalid-location'
      || entry.status === 'cleanup-residue'
      || entry.status === 'unsafe-entry'
      || entry.status === 'unknown'
      || entry.settlement === 'block'
    ) return [`${entry.relativePath}:${entry.status}`];
    return [];
  }).sort();
  const withoutDigest = {
    schema: GENERATED_STATE_INVENTORY_SCHEMA,
    registryRevision: GENERATED_STATE_REGISTRY_REVISION,
    repositoryRoot,
    generatedRoot,
    observedAt,
    entries: Object.freeze(entries),
    blockers: Object.freeze(blockers)
  } as const;
  return Object.freeze({
    ...withoutDigest,
    digest: generatedStateDigest(inventoryDigestInput(withoutDigest))
  });
}

async function safeUnlink(target: string): Promise<void> {
  try {
    await fs.unlink(target);
  } catch (error) {
    if (TRANSIENT_REMOVE_CODES.has(errnoCode(error) ?? '')) {
      await fs.chmod(target, 0o700).catch(() => undefined);
      await fs.unlink(target);
      return;
    }
    throw error;
  }
}

async function removeTreeNoFollowOnce(target: string, root = true): Promise<void> {
  const stat = await lstatOrNull(target);
  if (stat === null) return;
  if (stat.isSymbolicLink()) {
    if (root) throw new Error('Cleanup target root must not be a symlink or reparse point.');
    await safeUnlink(target);
    return;
  }
  if (!stat.isDirectory()) {
    await safeUnlink(target);
    return;
  }
  const entries: Dirent[] = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    await removeTreeNoFollowOnce(path.join(target, entry.name), false);
  }
  try {
    await fs.rmdir(target);
  } catch (error) {
    if (TRANSIENT_REMOVE_CODES.has(errnoCode(error) ?? '')) {
      await fs.chmod(target, 0o700).catch(() => undefined);
      await fs.rmdir(target);
      return;
    }
    throw error;
  }
}

async function removeTreeNoFollow(
  target: string,
  relativePath: string,
  attempts: GeneratedStateCleanupAttempt[],
  options: GeneratedStateRuntimeOptions
): Promise<boolean> {
  const sleep = runtimeSleep(options);
  for (let attempt = 0; attempt <= REMOVE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await removeTreeNoFollowOnce(target);
      if (await lstatOrNull(target) !== null) throw new Error('Cleanup readback found residue.');
      attempts.push({ relativePath, action: 'deleted', attempt: attempt + 1, code: null, message: null });
      return true;
    } catch (error) {
      const code = errnoCode(error);
      attempts.push({
        relativePath,
        action: 'failed',
        attempt: attempt + 1,
        code,
        message: errorMessage(error)
      });
      const delay = REMOVE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !TRANSIENT_REMOVE_CODES.has(code ?? '')) return false;
      await sleep(delay);
    }
  }
  return false;
}

async function readOwnerFile(target: string): Promise<GeneratedStateOwner | null> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(target, 'utf8'));
    return isGeneratedStateOwner(raw) ? raw : null;
  } catch {
    return null;
  }
}

async function acquireCleanupLock(
  generatedRoot: string,
  attempts: GeneratedStateCleanupAttempt[],
  options: GeneratedStateRuntimeOptions
): Promise<{ owner: GeneratedStateOwner; release: () => Promise<boolean> }> {
  const lockRoot = path.join(generatedRoot, CLEANUP_LOCK_DIRECTORY);
  const ownerPath = path.join(lockRoot, 'owner.json');
  const namespace = `cleanup-${process.pid}`;
  const owner = currentOwner(namespace, options);
  try {
    await fs.mkdir(lockRoot);
  } catch (error) {
    if (errnoCode(error) !== 'EEXIST') throw error;
    const existing = await readOwnerFile(ownerPath);
    if (
      existing === null
      || existing.host !== runtimeHost(options)
      || path.resolve(existing.repositoryRoot) !== runtimeRepositoryRoot(options)
      || runtimeProcessIsAlive(options)(existing.pid)
    ) {
      throw new Error('Generated-state cleanup lock is active or has unresolved ownership.');
    }
    const reclaimed = await removeTreeNoFollow(
      lockRoot,
      CLEANUP_LOCK_DIRECTORY,
      attempts,
      options
    );
    if (!reclaimed) throw new Error('Generated-state stale cleanup lock could not be reclaimed.');
    attempts.push({
      relativePath: CLEANUP_LOCK_DIRECTORY,
      action: 'recovered',
      attempt: 1,
      code: null,
      message: null
    });
    await fs.mkdir(lockRoot);
  }
  await atomicWriteJson(ownerPath, owner);
  return {
    owner,
    release: async () => {
      const current = await readOwnerFile(ownerPath);
      if (current === null || current.token !== owner.token || current.pid !== owner.pid) {
        attempts.push({
          relativePath: CLEANUP_LOCK_DIRECTORY,
          action: 'failed',
          attempt: 1,
          code: 'LOCK_OWNERSHIP_LOST',
          message: 'Generated-state cleanup lock ownership changed before release.'
        });
        return false;
      }
      return removeTreeNoFollow(lockRoot, CLEANUP_LOCK_DIRECTORY, attempts, options);
    }
  };
}

function isCleanupIdentity(value: unknown): value is GeneratedStateCleanupTransactionItem['expectedIdentity'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return typeof identity.dev === 'string'
    && typeof identity.ino === 'string'
    && typeof identity.mode === 'string'
    && typeof identity.mtimeMs === 'number' && Number.isFinite(identity.mtimeMs)
    && typeof identity.size === 'number' && Number.isFinite(identity.size);
}

async function readTransactionManifest(
  transactionRoot: string,
  expectedGeneratedRoot: string,
  expectedRepositoryRoot: string
): Promise<GeneratedStateCleanupTransaction | null> {
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(transactionRoot, TRANSACTION_MANIFEST), 'utf8')
    ) as Record<string, unknown>;
    if (
      raw.schema !== GENERATED_STATE_TRANSACTION_SCHEMA
      || typeof raw.transactionId !== 'string'
      || raw.transactionId !== path.basename(transactionRoot)
      || typeof raw.repositoryRoot !== 'string'
      || path.resolve(raw.repositoryRoot) !== expectedRepositoryRoot
      || typeof raw.generatedRoot !== 'string'
      || path.resolve(raw.generatedRoot) !== expectedGeneratedRoot
      || (raw.profile !== 'automatic' && raw.profile !== 'safe' && raw.profile !== 'all-rebuildable')
      || typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))
      || !isGeneratedStateOwner(raw.owner)
      || path.resolve(raw.owner.repositoryRoot) !== expectedRepositoryRoot
      || !raw.owner.namespace.startsWith('cleanup-')
      || !Array.isArray(raw.items)
    ) return null;
    const items = raw.items as unknown[];
    const relativePaths = new Set<string>();
    const quarantinePaths = new Set<string>();
    for (const candidate of items) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
      const item = candidate as Record<string, unknown>;
      if (
        typeof item.relativePath !== 'string'
        || typeof item.sourcePath !== 'string'
        || typeof item.quarantinePath !== 'string'
        || !isCleanupIdentity(item.expectedIdentity)
        || typeof item.physicalSnapshotDigest !== 'string'
        || !/^sha256:[0-9a-f]{64}$/u.test(item.physicalSnapshotDigest)
      ) return null;
      const sourcePath = path.resolve(item.sourcePath);
      const quarantinePath = path.resolve(item.quarantinePath);
      const expectedSourcePath = path.resolve(
        expectedGeneratedRoot,
        ...item.relativePath.replaceAll('\\', '/').split('/')
      );
      try {
        assertInside(expectedGeneratedRoot, sourcePath, 'Transaction source path');
        assertInside(path.join(transactionRoot, 'items'), quarantinePath, 'Transaction quarantine path');
      } catch {
        return null;
      }
      if (
        sourcePath !== expectedSourcePath
        || relativePaths.has(item.relativePath)
        || quarantinePaths.has(quarantinePath)
      ) return null;
      relativePaths.add(item.relativePath);
      quarantinePaths.add(quarantinePath);
    }
    return raw as unknown as GeneratedStateCleanupTransaction;
  } catch {
    return null;
  }
}

async function recoverInterruptedTransactions(
  generatedRoot: string,
  attempts: GeneratedStateCleanupAttempt[],
  options: GeneratedStateRuntimeOptions
): Promise<boolean> {
  const transactionsRoot = path.join(generatedRoot, TRANSACTION_DIRECTORY);
  const stat = await lstatOrNull(transactionsRoot);
  if (stat === null) return true;
  if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
  const entries = await fs.readdir(transactionsRoot, { withFileTypes: true });
  let complete = true;
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const transactionRoot = path.join(transactionsRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      complete = false;
      continue;
    }
    const manifest = await readTransactionManifest(
      transactionRoot,
      generatedRoot,
      runtimeRepositoryRoot(options)
    );
    if (
      manifest === null
      || manifest.owner.host !== runtimeHost(options)
      || runtimeProcessIsAlive(options)(manifest.owner.pid)
    ) {
      complete = false;
      continue;
    }
    let transactionComplete = true;
    for (const item of manifest.items) {
      const quarantineStat = await lstatOrNull(item.quarantinePath);
      if (quarantineStat === null) continue;
      const quarantineSnapshot = !quarantineStat.isSymbolicLink()
        && sameIdentity(quarantineStat, item.expectedIdentity)
        ? await measureNoFollow(item.quarantinePath).catch(() => null)
        : null;
      if (
        quarantineSnapshot === null
        || quarantineSnapshot.unsafe.length > 0
        || quarantineSnapshot.physicalSnapshotDigest !== item.physicalSnapshotDigest
      ) {
        attempts.push({
          relativePath: item.relativePath,
          action: 'protected',
          attempt: 0,
          code: 'RECOVERY_PRESTATE_CHANGED',
          message: 'Interrupted cleanup quarantine no longer matches its frozen physical snapshot.'
        });
        transactionComplete = false;
        continue;
      }
      const deleted = await removeTreeNoFollow(
        item.quarantinePath,
        item.relativePath,
        attempts,
        options
      );
      transactionComplete = deleted && transactionComplete;
      if (deleted) {
        attempts.push({
          relativePath: item.relativePath,
          action: 'recovered',
          attempt: 1,
          code: null,
          message: null
        });
      }
    }
    if (transactionComplete) {
      const removed = await removeTreeNoFollow(
        transactionRoot,
        `${TRANSACTION_DIRECTORY}/${entry.name}`,
        attempts,
        options
      );
      if (!removed) complete = false;
    } else {
      complete = false;
    }
  }
  const remaining = await fs.readdir(transactionsRoot).catch(() => []);
  if (remaining.length === 0) await fs.rmdir(transactionsRoot).catch(() => undefined);
  return complete;
}

function receiptDigestInput(receipt: Omit<GeneratedStateCleanupReceipt, 'digest'>): unknown {
  return { ...receipt, startedAt: '<started-at>', completedAt: '<completed-at>' };
}

function cleanupSelection(
  inventory: GeneratedStateInventory,
  options: GeneratedStateCleanupOptions
): readonly GeneratedStateInventoryEntry[] {
  const explicitRelativePaths = new Set(options.explicitRelativePaths ?? []);
  return inventory.entries.filter((entry) => {
    const explicit = explicitRelativePaths.has(entry.relativePath)
      && entry.stateClass === 'ephemeral-workspace'
      && entry.status !== 'active'
      && entry.status !== 'invalid-location'
      && entry.status !== 'control-state'
      && entry.status !== 'cleanup-residue'
      && entry.status !== 'unsafe-entry'
      && entry.status !== 'unknown';
    if (options.onlyExplicit === true) return explicit;
    return generatedStateCleanupAllowed(entry, options.profile) || explicit;
  });
}

function cleanupReceipt(
  input: Omit<GeneratedStateCleanupReceipt, 'digest'>
): GeneratedStateCleanupReceipt {
  return Object.freeze({
    ...input,
    digest: generatedStateDigest(receiptDigestInput(input))
  });
}

async function pruneEmptyGeneratedContainers(generatedRoot: string): Promise<void> {
  for (const relativePath of [
    'test-workspaces/.templates',
    'test-workspaces',
    'import-candidate-snapshots',
    'dependency-installs',
    'typecheck'
  ]) {
    const target = path.join(generatedRoot, ...relativePath.split('/'));
    const stat = await lstatOrNull(target);
    if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) continue;
    await fs.rmdir(target).catch(() => undefined);
  }
}

async function transactionContainsQuarantine(transactionRoot: string): Promise<boolean> {
  const itemsRoot = path.join(transactionRoot, 'items');
  const entries = await fs.readdir(itemsRoot).catch(() => []);
  return entries.length > 0;
}

export async function cleanGeneratedState(
  options: GeneratedStateCleanupOptions
): Promise<GeneratedStateCleanupReceipt> {
  const repositoryRoot = runtimeRepositoryRoot(options);
  const generatedRoot = getGeneratedStateRoot(repositoryRoot);
  const startedAt = runtimeNow(options).toISOString();
  const transactionId = randomUUID();
  const attempts: GeneratedStateCleanupAttempt[] = [];
  const inventoryOptions: GeneratedStateRuntimeOptions = {
    ...options,
    deepInventory: options.deepInventory ?? options.profile !== 'automatic'
  };
  const initial = await inspectGeneratedState(inventoryOptions);
  const initialSelection = cleanupSelection(initial, options);
  const initialSelected = initialSelection.map((entry) => entry.relativePath).sort();
  const hasInterruptedTransaction = initial.entries.some(
    (entry) => entry.ruleId === 'cleanup-transactions'
  );

  if (options.dryRun === true) {
    attempts.push(...initialSelected.map((relativePath) => ({
      relativePath,
      action: 'planned' as const,
      attempt: 0,
      code: null,
      message: null
    })));
    const completedAt = runtimeNow(options).toISOString();
    return cleanupReceipt({
      schema: GENERATED_STATE_CLEANUP_RECEIPT_SCHEMA,
      registryRevision: GENERATED_STATE_REGISTRY_REVISION,
      repositoryRoot,
      generatedRoot,
      transactionId,
      requestedProfile: options.profile,
      dryRun: true,
      startedAt,
      completedAt,
      beforeDigest: initial.digest,
      afterDigest: initial.digest,
      beforeBlockers: initial.blockers,
      afterBlockers: initial.blockers,
      selected: Object.freeze(initialSelected),
      protected: Object.freeze(initial.entries
        .filter((entry) => !initialSelected.includes(entry.relativePath))
        .map((entry) => entry.relativePath)
        .sort()),
      attempts: Object.freeze(attempts),
      status: initialSelected.length === 0 ? 'no-op' : 'completed'
    });
  }

  if (initialSelected.length === 0 && !hasInterruptedTransaction) {
    const completedAt = runtimeNow(options).toISOString();
    return cleanupReceipt({
      schema: GENERATED_STATE_CLEANUP_RECEIPT_SCHEMA,
      registryRevision: GENERATED_STATE_REGISTRY_REVISION,
      repositoryRoot,
      generatedRoot,
      transactionId,
      requestedProfile: options.profile,
      dryRun: false,
      startedAt,
      completedAt,
      beforeDigest: initial.digest,
      afterDigest: initial.digest,
      beforeBlockers: initial.blockers,
      afterBlockers: initial.blockers,
      selected: Object.freeze([]),
      protected: Object.freeze(initial.entries.map((entry) => entry.relativePath).sort()),
      attempts: Object.freeze([]),
      status: 'no-op'
    });
  }

  await ensureGeneratedRootSafe(generatedRoot);
  const lock = await acquireCleanupLock(generatedRoot, attempts, options);
  let transactionRoot: string | null = null;
  let blocked = false;
  let residue = false;
  let selectedEntries: readonly GeneratedStateInventoryEntry[] = initialSelection;
  try {
    if (!await recoverInterruptedTransactions(generatedRoot, attempts, options)) {
      blocked = true;
    }
    const current = await inspectGeneratedState(inventoryOptions);
    const currentSelection = cleanupSelection(current, options);
    const currentSelectedPaths = new Set(currentSelection.map((entry) => entry.relativePath));
    const currentPaths = new Set(current.entries.map((entry) => entry.relativePath));
    for (const entry of initialSelection) {
      if (currentPaths.has(entry.relativePath) && !currentSelectedPaths.has(entry.relativePath)) {
        attempts.push({
          relativePath: entry.relativePath,
          action: 'protected',
          attempt: 0,
          code: 'LIFECYCLE_STATE_CHANGED',
          message: 'Cleanup eligibility changed after the initial inventory.'
        });
        blocked = true;
      }
    }
    selectedEntries = blocked ? [] : currentSelection;

    if (!blocked && selectedEntries.length > 0) {
      const items: GeneratedStateCleanupTransactionItem[] = [];
      for (const [index, entry] of selectedEntries.entries()) {
        assertInside(generatedRoot, entry.absolutePath, 'Cleanup target');
        const beforeScan = await lstatOrNull(entry.absolutePath);
        if (beforeScan === null || beforeScan.isSymbolicLink()) {
          attempts.push({
            relativePath: entry.relativePath,
            action: 'protected',
            attempt: 0,
            code: beforeScan === null ? 'ENOENT' : 'UNSAFE_ROOT',
            message: beforeScan === null
              ? 'Target disappeared before cleanup.'
              : 'Target root became a symlink or reparse point.'
          });
          blocked = true;
          continue;
        }
        let measured: Awaited<ReturnType<typeof measureNoFollow>>;
        try {
          measured = await measureNoFollow(entry.absolutePath);
        } catch (error) {
          attempts.push({
            relativePath: entry.relativePath,
            action: 'protected',
            attempt: 0,
            code: errnoCode(error) ?? 'INVENTORY_FAILED',
            message: errorMessage(error)
          });
          blocked = true;
          continue;
        }
        if (measured.unsafe.length > 0) {
          attempts.push({
            relativePath: entry.relativePath,
            action: 'protected',
            attempt: 0,
            code: 'UNSAFE_DESCENDANT',
            message: `Cleanup target contains reparse entries: ${measured.unsafe.join(', ')}`
          });
          blocked = true;
          continue;
        }
        const afterScan = await lstatOrNull(entry.absolutePath);
        if (
          afterScan === null
          || afterScan.isSymbolicLink()
          || !sameIdentity(afterScan, statIdentity(beforeScan))
        ) {
          attempts.push({
            relativePath: entry.relativePath,
            action: 'protected',
            attempt: 0,
            code: 'PRESTATE_CHANGED',
            message: 'Target identity changed while freezing cleanup pre-state.'
          });
          blocked = true;
          continue;
        }
        items.push({
          relativePath: entry.relativePath,
          sourcePath: entry.absolutePath,
          quarantinePath: path.join(
            generatedRoot,
            TRANSACTION_DIRECTORY,
            transactionId,
            'items',
            String(index).padStart(4, '0')
          ),
          expectedIdentity: statIdentity(afterScan),
          physicalSnapshotDigest: measured.physicalSnapshotDigest
        });
      }

      if (!blocked) {
        transactionRoot = path.join(generatedRoot, TRANSACTION_DIRECTORY, transactionId);
        await fs.mkdir(path.join(transactionRoot, 'items'), { recursive: true });
        const manifest: GeneratedStateCleanupTransaction = {
          schema: GENERATED_STATE_TRANSACTION_SCHEMA,
          transactionId,
          repositoryRoot,
          generatedRoot,
          profile: options.profile,
          createdAt: startedAt,
          owner: lock.owner,
          items
        };
        await atomicWriteJson(path.join(transactionRoot, TRANSACTION_MANIFEST), manifest);

        for (const item of items) {
          await options.beforeQuarantineForTest?.(item.relativePath);
          const current = await lstatOrNull(item.sourcePath);
          let currentSnapshotDigest: string | null = null;
          if (current !== null && !current.isSymbolicLink() && sameIdentity(current, item.expectedIdentity)) {
            currentSnapshotDigest = await measureNoFollow(item.sourcePath)
              .then((snapshot) => snapshot.physicalSnapshotDigest)
              .catch(() => null);
          }
          if (
            current === null
            || current.isSymbolicLink()
            || !sameIdentity(current, item.expectedIdentity)
            || currentSnapshotDigest !== item.physicalSnapshotDigest
          ) {
            attempts.push({
              relativePath: item.relativePath,
              action: 'protected',
              attempt: 0,
              code: 'PRESTATE_CHANGED',
              message: 'Target physical snapshot changed after cleanup planning.'
            });
            blocked = true;
            break;
          }
          try {
            await fs.rename(item.sourcePath, item.quarantinePath);
            const sourceReadback = await lstatOrNull(item.sourcePath);
            const quarantineReadback = await lstatOrNull(item.quarantinePath);
            if (
              sourceReadback !== null
              || quarantineReadback === null
              || !sameIdentity(quarantineReadback, item.expectedIdentity)
            ) {
              throw Object.assign(new Error('Cleanup quarantine readback did not preserve exact identity.'), {
                code: 'QUARANTINE_READBACK_FAILED'
              });
            }
            attempts.push({
              relativePath: item.relativePath,
              action: 'quarantined',
              attempt: 1,
              code: null,
              message: null
            });
          } catch (error) {
            attempts.push({
              relativePath: item.relativePath,
              action: 'failed',
              attempt: 1,
              code: errnoCode(error),
              message: errorMessage(error)
            });
            residue = true;
            break;
          }
          await options.afterQuarantineForTest?.(item.relativePath);
          if (!await removeTreeNoFollow(item.quarantinePath, item.relativePath, attempts, options)) {
            residue = true;
            break;
          }
        }
      }
    }
  } finally {
    if (transactionRoot !== null && !await transactionContainsQuarantine(transactionRoot)) {
      const removed = await removeTreeNoFollow(
        transactionRoot,
        `${TRANSACTION_DIRECTORY}/${transactionId}`,
        attempts,
        options
      );
      if (!removed) residue = true;
      const transactionsRoot = path.dirname(transactionRoot);
      const remaining = await fs.readdir(transactionsRoot).catch(() => []);
      if (remaining.length === 0) await fs.rmdir(transactionsRoot).catch(() => undefined);
    }
    if (!await lock.release()) residue = true;
  }

  await pruneEmptyGeneratedContainers(generatedRoot);
  const after = await inspectGeneratedState(inventoryOptions);
  const selectedSet = new Set([
    ...initialSelected,
    ...selectedEntries.map((entry) => entry.relativePath)
  ]);
  const selected = [...selectedSet]
    .filter((relativePath) => relativePath !== CLEANUP_LOCK_DIRECTORY)
    .sort();
  const remainingPaths = new Set(after.entries.map((entry) => entry.relativePath));
  if (selected.some((entry) => remainingPaths.has(entry))) residue = true;
  if (after.entries.some((entry) => (
    entry.ruleId === 'cleanup-lock' || entry.ruleId === 'cleanup-transactions'
  ))) residue = true;
  const status = blocked ? 'blocked' : residue ? 'residue' : 'completed';
  const completedAt = runtimeNow(options).toISOString();
  return cleanupReceipt({
    schema: GENERATED_STATE_CLEANUP_RECEIPT_SCHEMA,
    registryRevision: GENERATED_STATE_REGISTRY_REVISION,
    repositoryRoot,
    generatedRoot,
    transactionId,
    requestedProfile: options.profile,
    dryRun: false,
    startedAt,
    completedAt,
    beforeDigest: initial.digest,
    afterDigest: after.digest,
    beforeBlockers: initial.blockers,
    afterBlockers: after.blockers,
    selected: Object.freeze(selected),
    protected: Object.freeze(after.entries
      .filter((entry) => !selectedSet.has(entry.relativePath))
      .map((entry) => entry.relativePath)
      .sort()),
    attempts: Object.freeze(attempts),
    status
  });
}

export async function runGeneratedStateCommand(args: readonly string[]): Promise<number> {
  const [action, ...rest] = args;
  const json = rest.includes('--json');
  if (action === 'inspect' && rest.every((arg) => arg === '--json')) {
    const inventory = await inspectGeneratedState();
    process.stdout.write(`${JSON.stringify(inventory, null, json ? 2 : 0)}\n`);
    return inventory.blockers.length === 0 ? 0 : 1;
  }
  if (action === 'clean') {
    let profile: GeneratedStateCleanupProfile = 'safe';
    let dryRun = false;
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index]!;
      if (arg === '--json') continue;
      if (arg === '--dry-run') {
        dryRun = true;
        continue;
      }
      if (arg === '--profile') {
        const value = rest[index + 1];
        if (value !== 'automatic' && value !== 'safe' && value !== 'all-rebuildable') {
          throw new Error('generated-state clean --profile must be automatic, safe, or all-rebuildable.');
        }
        profile = value;
        index += 1;
        continue;
      }
      throw new Error(`Unknown generated-state clean argument: ${arg}`);
    }
    const receipt = await cleanGeneratedState({ profile, dryRun });
    process.stdout.write(`${JSON.stringify(receipt, null, json ? 2 : 0)}\n`);
    return receipt.status === 'completed' || receipt.status === 'no-op' ? 0 : 1;
  }
  throw new Error(
    'Usage: bun ./platform/dev-runner.ts generated-state <inspect [--json]|clean [--profile automatic|safe|all-rebuildable] [--dry-run] [--json]>'
  );
}
