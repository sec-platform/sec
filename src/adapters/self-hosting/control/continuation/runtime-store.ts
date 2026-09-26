import {
  readdirSync,
  statSync
} from 'node:fs';
import path from 'node:path';
import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { isDigest } from '../../../../contracts/digest.ts';
import { parseExactJson } from '../../../../contracts/exact-json.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { decodeExactUtf8 } from '../../../runtime-state/physical/runtime/retained-file-read.ts';
import { waitForHeavyVerificationGateLease, withAcquiredHeavyVerificationGateLease } from '../../../verification/platform/gate/state/heavy-lease-lifecycle.ts';

import { deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChild, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, replaceDurableCanonicalFile, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { RuntimeStateLayout } from '../../../runtime-state/workspace-state/layout.ts';
import { migrateRuntimeStateDirectoryGeneration } from '../../../runtime-state/workspace-state/layout-migration.ts';
import { resolveRuntimeStateForRepository, resolveWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';
import { acquireRuntimeStatePhysicalAuthority, type RuntimeStatePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { acquireHeavyVerificationGateLease } from '../../../verification/platform/gate/state/heavy-lease.ts';
import {
  parseLocalContinuationCheckpoint,
  type LocalContinuationCheckpoint
} from './checkpoint.ts';

const ACTIVE_CONTINUATION_POINTER_SCHEMA = 'sec-active-continuation-pointer-v1' as const;
const WORKSPACE_RUNTIME_LOCATOR_SCHEMA = 'sec-workspace-runtime-locator-v1' as const;
const DEFAULT_CONTINUATION_GC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CONTINUATION_MUTATION_LEASE_WAIT_MS = 30_000;

type Digest = `sha256:${string}`;

interface ActiveContinuationPointer {
  readonly schema: typeof ACTIVE_CONTINUATION_POINTER_SCHEMA;
  readonly repositoryKey: Digest;
  readonly workspaceKey: Digest;
  readonly checkpointDigest: Digest;
  readonly pointerDigest: Digest;
}

interface WorkspaceRuntimeLocator {
  readonly schema: typeof WORKSPACE_RUNTIME_LOCATOR_SCHEMA;
  readonly workspaceLocatorKey: Digest;
  readonly repository: string;
  readonly repositoryKey: Digest;
  readonly workspaceKey: Digest;
  readonly locatorDigest: Digest;
}

interface ContinuationLocationInput {
  readonly repositoryRoot: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly layout?: RuntimeStateLayout;
}
function captureContinuationLocation(input: ContinuationLocationInput & { readonly layout: RuntimeStateLayout }): Readonly<{
  repositoryRoot: string; environment: NodeJS.ProcessEnv; layout: RuntimeStateLayout;
}>;
function captureContinuationLocation(input: ContinuationLocationInput): Readonly<{
  repositoryRoot: string; environment: NodeJS.ProcessEnv; layout?: RuntimeStateLayout;
}>;
function captureContinuationLocation(input: ContinuationLocationInput) {
  // Only this owner's location fields are captured. Do not enumerate unrelated
  // checkpoint/GC inputs or retain process.env across authority acquisition.
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const environment = input.environment;
  const layout = input.layout;
  return Object.freeze({ repositoryRoot, environment: Object.freeze({ ...(environment ?? process.env) }),
    ...(layout === undefined ? {} : { layout: Object.freeze({ ...layout }) }) });
}

function hash(value: unknown): Digest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

function exactBytes(expected: Uint8Array): (actual: Uint8Array) => void {
  const canonical = Buffer.from(expected);
  return (actual: Uint8Array): void => {
    if (!Buffer.from(actual).equals(canonical)) {
      throw new Error('SEC runtime state durable publication readback mismatch.');
    }
  };
}

function writeAtomicDurable(
  parent: PhysicalDirectoryIdentity,
  filePath: string,
  source: string
): void {
  const bytes = Buffer.from(source, 'utf8');
  replaceDurableCanonicalFile({
    parent,
    name: path.basename(filePath),
    bytes,
    validate: exactBytes(bytes)
  });
}

function continuationObjectPath(layout: RuntimeStateLayout, checkpointDigest: Digest): string {
  if (!isDigest(checkpointDigest, 'sha256')) {
    throw new Error('SEC runtime continuation digest is invalid.');
  }
  return path.join(layout.continuationObjectRoot, `${checkpointDigest.slice(7)}.json`);
}

function createPointer(layout: RuntimeStateLayout, checkpointDigest: Digest): ActiveContinuationPointer {
  const semantic = Object.freeze({
    schema: ACTIVE_CONTINUATION_POINTER_SCHEMA,
    repositoryKey: layout.repositoryKey,
    workspaceKey: layout.workspaceKey,
    checkpointDigest
  });
  return Object.freeze({ ...semantic, pointerDigest: hash(semantic) });
}

function parsePointerRecord(source: string): ActiveContinuationPointer {
  let value: unknown;
  try { value = parseExactJson(source, 'SEC runtime continuation pointer'); } catch (error) {
    throw new Error('SEC runtime continuation pointer is invalid JSON.', { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SEC runtime continuation pointer must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expected = ['schema', 'repositoryKey', 'workspaceKey', 'checkpointDigest', 'pointerDigest'].sort();
  const actual = Object.keys(record).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)
      || record.schema !== ACTIVE_CONTINUATION_POINTER_SCHEMA
      || typeof record.repositoryKey !== 'string'
      || !isDigest(record.repositoryKey, 'sha256')
      || typeof record.workspaceKey !== 'string'
      || !isDigest(record.workspaceKey, 'sha256')
      || typeof record.checkpointDigest !== 'string'
      || !isDigest(record.checkpointDigest, 'sha256')
      || typeof record.pointerDigest !== 'string'
      || !isDigest(record.pointerDigest, 'sha256')) {
    throw new Error('SEC runtime continuation pointer identity is invalid.');
  }
  const semantic = Object.freeze({
    schema: ACTIVE_CONTINUATION_POINTER_SCHEMA,
    repositoryKey: record.repositoryKey as Digest,
    workspaceKey: record.workspaceKey as Digest,
    checkpointDigest: record.checkpointDigest as Digest
  });
  const pointer = Object.freeze({ ...semantic, pointerDigest: hash(semantic) });
  if (pointer.pointerDigest !== record.pointerDigest) {
    throw new Error('SEC runtime continuation pointer digest mismatch.');
  }
  return pointer;
}

function parsePointer(source: string, layout: RuntimeStateLayout): ActiveContinuationPointer {
  const pointer = parsePointerRecord(source);
  if (pointer.repositoryKey !== layout.repositoryKey || pointer.workspaceKey !== layout.workspaceKey) {
    throw new Error('SEC runtime continuation pointer layout identity is invalid.');
  }
  return pointer;
}

function locatorPath(repositoryRoot: string, source: NodeJS.ProcessEnv): string {
  const roots = resolveWorkspaceRuntimeRoots({ repositoryRoot, environment: source });
  return path.join(roots.workspaceLocatorRoot, `${roots.workspaceLocatorKey.slice(7)}.json`);
}

function createLocator(layout: RuntimeStateLayout, repository: string): WorkspaceRuntimeLocator {
  const semantic = Object.freeze({
    schema: WORKSPACE_RUNTIME_LOCATOR_SCHEMA,
    workspaceLocatorKey: layout.workspaceLocatorKey,
    repository,
    repositoryKey: layout.repositoryKey,
    workspaceKey: layout.workspaceKey
  });
  return Object.freeze({ ...semantic, locatorDigest: hash(semantic) });
}

function continuationMutationLeaseRoot(stateRoot: string): string {
  return path.join(stateRoot, 'operation-leases', 'locks');
}

function continuationRequiredDirectories(
  layout: RuntimeStateLayout,
  repositoryRoot: string,
  source: NodeJS.ProcessEnv
): readonly string[] {
  const roots = resolveWorkspaceRuntimeRoots({ repositoryRoot, environment: source });
  return Object.freeze([
    roots.workspaceLocatorRoot,
    roots.workspaceCollectionRoot,
    path.dirname(layout.continuationPointerPath),
    layout.continuationObjectRoot,
    continuationMutationLeaseRoot(layout.stateRoot)
  ]);
}

function continuationMigrationRequiredDirectories(layout: RuntimeStateLayout): readonly string[] {
  return Object.freeze([
    path.dirname(layout.continuationObjectRoot),
    path.dirname(layout.continuationPointerPath),
    continuationMutationLeaseRoot(layout.stateRoot)
  ]);
}

async function acquireContinuationAuthority(input: Readonly<{
  layout: RuntimeStateLayout;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}>): Promise<RuntimeStatePhysicalAuthority> {
  return acquireRuntimeStatePhysicalAuthority({
    repositoryRoot: input.repositoryRoot,
    stateRoot: input.layout.stateRoot,
    cacheRoot: input.layout.cacheRoot,
    requiredDirectories: continuationRequiredDirectories(
      input.layout,
      input.repositoryRoot,
      input.environment
    )
  });
}

async function acquireContinuationMigrationAuthority(input: Readonly<{
  layout: RuntimeStateLayout;
  repositoryRoot: string;
}>): Promise<RuntimeStatePhysicalAuthority> {
  return acquireRuntimeStatePhysicalAuthority({
    repositoryRoot: input.repositoryRoot,
    stateRoot: input.layout.stateRoot,
    cacheRoot: input.layout.cacheRoot,
    requiredDirectories: continuationMigrationRequiredDirectories(input.layout)
  });
}

async function acquireWorkspaceLocatorAuthority(input: Readonly<{
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}>): Promise<RuntimeStatePhysicalAuthority> {
  const roots = resolveWorkspaceRuntimeRoots(input);
  return acquireRuntimeStatePhysicalAuthority({
    repositoryRoot: input.repositoryRoot,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [roots.workspaceLocatorRoot]
  });
}

async function acquireContinuationMutationLeaseAt(lockPath: string) {
  return waitForHeavyVerificationGateLease(() => acquireHeavyVerificationGateLease({
    gateId: 'runtime-state:continuation', lockPath, waitTimeoutMs: 0
  }), CONTINUATION_MUTATION_LEASE_WAIT_MS);
}

async function withContinuationMutationLease<T>(
  stateRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const root = continuationMutationLeaseRoot(stateRoot);
  const legacyPath = path.join(root, 'continuation-v1');
  const currentPath = path.join(root, 'continuation');
  const legacy = inspectExactNoFollowDirectoryPresence(
    legacyPath,
    'SEC continuation legacy mutation lease'
  );
  const withCurrent = async (): Promise<T> => {
    const currentLease = await acquireContinuationMutationLeaseAt(currentPath);
    return withAcquiredHeavyVerificationGateLease(currentLease, operation);
  };
  if (legacy.state === 'absent') return withCurrent();
  const legacyLease = await acquireContinuationMutationLeaseAt(legacyPath);
  return withAcquiredHeavyVerificationGateLease(legacyLease, withCurrent);
}

function legacyContinuationObjectRoot(layout: RuntimeStateLayout): string {
  return path.join(path.dirname(layout.continuationObjectRoot), 'continuation-v1');
}

function legacyContinuationPointerPath(layout: RuntimeStateLayout): string {
  return path.join(path.dirname(layout.continuationPointerPath), 'active-continuation-v1.json');
}

function migrateContinuationPointer(
  authority: RuntimeStatePhysicalAuthority,
  layout: RuntimeStateLayout
): void {
  const parent = authority.directory(path.dirname(layout.continuationPointerPath));
  const legacyPath = legacyContinuationPointerPath(layout);
  const legacyBytes = readNoFollowOrdinaryFile(parent, path.basename(legacyPath));
  if (legacyBytes === null) return;
  let currentBytes = readNoFollowOrdinaryFile(parent, path.basename(layout.continuationPointerPath));
  if (currentBytes === null) {
    publishExclusiveDurableCanonicalFile({
      parent,
      name: path.basename(layout.continuationPointerPath),
      bytes: legacyBytes,
      validate: exactBytes(legacyBytes)
    });
    currentBytes = readNoFollowOrdinaryFile(parent, path.basename(layout.continuationPointerPath));
  }
  if (currentBytes === null || !Buffer.from(currentBytes).equals(Buffer.from(legacyBytes))) {
    throw new Error('SEC continuation current and legacy pointer bytes diverge during migration.');
  }
  deleteFileIfPresent(parent, legacyPath);
}

function migrateContinuationLayout(
  authority: RuntimeStatePhysicalAuthority,
  layout: RuntimeStateLayout
): void {
  migrateRuntimeStateDirectoryGeneration({
    label: 'continuation objects',
    legacyPath: legacyContinuationObjectRoot(layout),
    currentPath: layout.continuationObjectRoot,
    mode: 'quiescent'
  });
  migrateContinuationPointer(authority, layout);
}

async function withContinuationMutationAuthority<T>(input: Readonly<{
  layout: RuntimeStateLayout;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}>, operation: (authority: RuntimeStatePhysicalAuthority) => T | Promise<T>): Promise<T> {
  return withAcquiredResource({
    operationLabel: 'continuation-layout-migration-authority-operation',
    resourceLabel: 'continuation-layout-migration-authority',
    acquire: () => acquireContinuationMigrationAuthority(input),
    use: (migrationAuthority) => withContinuationMutationLease(input.layout.stateRoot, async () => {
      await migrationAuthority.assertCurrent();
      migrateContinuationLayout(migrationAuthority, input.layout);
      await migrationAuthority.assertCurrent();
      return withAcquiredResource({
        operationLabel: 'continuation-mutation-authority-operation',
        resourceLabel: 'continuation-runtime-state-authority',
        acquire: () => acquireContinuationAuthority(input),
        use: async (authority) => {
          await authority.assertCurrent();
          const result = await operation(authority);
          await authority.assertCurrent();
          return result;
        },
        release: (authority) => authority.release()
      });
    }),
    release: (authority) => authority.release()
  });
}

function readText(parent: PhysicalDirectoryIdentity, filePath: string): string | null {
  const bytes = readNoFollowOrdinaryFile(parent, path.basename(filePath));
  return bytes === null ? null : decodeExactUtf8(bytes, 'SEC continuation state');
}

function deleteFileIfPresent(parent: PhysicalDirectoryIdentity, filePath: string): boolean {
  const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(filePath));
  if (entry === null) return false;
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: entry.relativePath,
    kind: 'file',
    device: entry.device,
    inode: entry.inode,
    ancestorDirectories: []
  });
  return true;
}

function persistLocator(
  authority: RuntimeStatePhysicalAuthority,
  layout: RuntimeStateLayout,
  repository: string,
  repositoryRoot: string,
  source: NodeJS.ProcessEnv
): void {
  const locator = createLocator(layout, repository);
  const filePath = locatorPath(repositoryRoot, source);
  writeAtomicDurable(
    authority.directory(path.dirname(filePath)),
    filePath,
    `${encodeVerificationActionData(locator)}\n`
  );
}

function parseLocator(
  sourceText: string,
  repositoryRoot: string,
  source: NodeJS.ProcessEnv
): WorkspaceRuntimeLocator {
  let value: unknown;
  try { value = parseExactJson(sourceText, 'SEC workspace runtime locator'); } catch (error) {
    throw new Error('SEC workspace runtime locator is invalid JSON.', { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SEC workspace runtime locator must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expected = ['schema', 'workspaceLocatorKey', 'repository', 'repositoryKey', 'workspaceKey', 'locatorDigest'].sort();
  const actual = Object.keys(record).sort();
  const roots = resolveWorkspaceRuntimeRoots({ repositoryRoot, environment: source });
  if (JSON.stringify(actual) !== JSON.stringify(expected)
      || record.schema !== WORKSPACE_RUNTIME_LOCATOR_SCHEMA
      || record.workspaceLocatorKey !== roots.workspaceLocatorKey
      || typeof record.repository !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(record.repository)
      || typeof record.repositoryKey !== 'string' || !isDigest(record.repositoryKey, 'sha256')
      || typeof record.workspaceKey !== 'string' || !isDigest(record.workspaceKey, 'sha256')
      || typeof record.locatorDigest !== 'string' || !isDigest(record.locatorDigest, 'sha256')) {
    throw new Error('SEC workspace runtime locator identity is invalid.');
  }
  const layout = resolveRuntimeStateForRepository({
    repository: record.repository,
    repositoryRoot,
    environment: source
  });
  const locator = createLocator(layout, record.repository);
  if (locator.repositoryKey !== record.repositoryKey || locator.workspaceKey !== record.workspaceKey
      || locator.locatorDigest !== record.locatorDigest) {
    throw new Error('SEC workspace runtime locator digest/layout mismatch.');
  }
  return locator;
}

export async function resolveRuntimeStateFromWorkspaceLocator(input: Readonly<{
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{ repository: string; layout: RuntimeStateLayout }> | null> {
  const location = captureContinuationLocation(input);
  const source = location.environment ?? process.env;
  const filePath = locatorPath(location.repositoryRoot, source);
  return withAcquiredResource({
    operationLabel: 'workspace-locator-read-operation',
    resourceLabel: 'workspace-locator-runtime-state-authority',
    acquire: () => acquireWorkspaceLocatorAuthority({
      repositoryRoot: location.repositoryRoot,
      environment: source
    }),
    use: (authority) => {
      const locatorSource = readText(authority.directory(path.dirname(filePath)), filePath);
      if (locatorSource === null) return null;
      const locator = parseLocator(locatorSource, location.repositoryRoot, source);
      return Object.freeze({
        repository: locator.repository,
        layout: resolveRuntimeStateForRepository({
          repository: locator.repository,
          repositoryRoot: location.repositoryRoot,
          environment: source
        })
      });
    },
    release: (authority) => authority.release()
  });
}

export async function persistActiveContinuationCheckpoint(input: Readonly<{
  layout: RuntimeStateLayout;
  repositoryRoot: string;
  checkpoint: LocalContinuationCheckpoint;
  environment?: NodeJS.ProcessEnv;
}>): Promise<ActiveContinuationPointer> {
  const location = captureContinuationLocation(input);
  const checkpoint = parseLocalContinuationCheckpoint(encodeVerificationActionData(input.checkpoint));
  const canonical = `${encodeVerificationActionData(checkpoint)}\n`;
  const objectPath = continuationObjectPath(location.layout, checkpoint.checkpointDigest);
  const environment = location.environment ?? process.env;
  return withContinuationMutationAuthority({
    layout: location.layout,
    repositoryRoot: location.repositoryRoot,
    environment
  }, (authority) => {
    const objectParent = authority.directory(location.layout.continuationObjectRoot);
    const objectBytes = Buffer.from(canonical, 'utf8');
    try {
      publishExclusiveDurableCanonicalFile({
        parent: objectParent,
        name: path.basename(objectPath),
        bytes: objectBytes,
        validate: exactBytes(objectBytes)
      });
    } catch (error) {
      throw new Error('SEC runtime continuation CAS object bytes conflict with its digest path.', {
        cause: error
      });
    }
    const pointer = createPointer(location.layout, checkpoint.checkpointDigest);
    writeAtomicDurable(
      authority.directory(path.dirname(location.layout.continuationPointerPath)),
      location.layout.continuationPointerPath,
      `${encodeVerificationActionData(pointer)}\n`
    );
    persistLocator(
      authority,
      location.layout,
      checkpoint.repository,
      location.repositoryRoot,
      environment
    );
    // The mutation lease makes pointer publication and GC linearizable. This
    // final retained readback also makes a future lock implementation change
    // fail closed instead of permitting a pointer to a missing CAS object.
    if (readText(objectParent, objectPath) !== canonical) {
      throw new Error('SEC runtime continuation pointer publication lost its CAS object.');
    }
    return pointer;
  });
}

export async function loadActiveContinuationCheckpoint(input: Readonly<{
  layout: RuntimeStateLayout;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<LocalContinuationCheckpoint | null> {
  const location = captureContinuationLocation(input);
  const environment = location.environment ?? process.env;
  return withContinuationMutationAuthority({
    layout: location.layout,
    repositoryRoot: location.repositoryRoot,
    environment
  }, (authority) => {
    const pointerSource = readText(
      authority.directory(path.dirname(location.layout.continuationPointerPath)),
      location.layout.continuationPointerPath
    );
    if (pointerSource === null) return null;
    const pointer = parsePointer(pointerSource, location.layout);
    const objectPath = continuationObjectPath(location.layout, pointer.checkpointDigest);
    const objectSource = readText(authority.directory(location.layout.continuationObjectRoot), objectPath);
    if (objectSource === null) {
      throw new Error('SEC runtime continuation pointer references a missing CAS object.');
    }
    const checkpoint = parseLocalContinuationCheckpoint(objectSource);
    if (checkpoint.checkpointDigest !== pointer.checkpointDigest) {
      throw new Error('SEC runtime continuation pointer/object digest mismatch.');
    }
    return checkpoint;
  });
}

export async function clearActiveContinuation(input: Readonly<{
  layout: RuntimeStateLayout;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<void> {
  const location = captureContinuationLocation(input);
  const environment = location.environment ?? process.env;
  await withContinuationMutationAuthority({
    layout: location.layout,
    repositoryRoot: location.repositoryRoot,
    environment
  }, (authority) => {
    deleteFileIfPresent(
      authority.directory(path.dirname(location.layout.continuationPointerPath)),
      location.layout.continuationPointerPath
    );
    const filePath = locatorPath(location.repositoryRoot, environment);
    deleteFileIfPresent(authority.directory(path.dirname(filePath)), filePath);
  });
}

function activeContinuationDigests(
  authority: RuntimeStatePhysicalAuthority,
  workspaceCollectionRoot: string
): Set<string> {
  const result = new Set<string>();
  const workspacesRoot = workspaceCollectionRoot;
  const workspaces = authority.directory(workspacesRoot);
  for (const workspace of readdirSync(workspaces.path, { withFileTypes: true })) {
    if (!workspace.isDirectory() || !/^[0-9a-f]{64}$/u.test(workspace.name)) {
      return new Set<string>(['*']);
    }
    try {
      const workspaceDirectory = inspectNoFollowDirectoryChild(
        workspaces,
        workspace.name,
        'SEC runtime workspace state'
      );
      if (workspaceDirectory === null) return new Set<string>(['*']);
      const currentPointerSource = readNoFollowOrdinaryFile(
        workspaceDirectory,
        'active-continuation.json'
      );
      const legacyPointerSource = readNoFollowOrdinaryFile(
        workspaceDirectory,
        'active-continuation-v1.json'
      );
      if (currentPointerSource !== null && legacyPointerSource !== null
          && !Buffer.from(currentPointerSource).equals(Buffer.from(legacyPointerSource))) {
        return new Set<string>(['*']);
      }
      const pointerSource = currentPointerSource ?? legacyPointerSource;
      if (pointerSource === null) continue;
      const pointer = parsePointerRecord(decodeExactUtf8(pointerSource, 'SEC continuation pointer'));
      result.add(pointer.checkpointDigest.slice(7));
    } catch {
      // Corrupt active pointers retain all objects rather than causing unsafe GC.
      return new Set<string>(['*']);
    }
  }
  return result;
}

export async function gcContinuationObjects(input: Readonly<{
  layout: RuntimeStateLayout;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
  nowMs?: number;
  retentionMs?: number;
}>): Promise<Readonly<{ scanned: number; removed: number; retained: number }>> {
  const location = captureContinuationLocation(input);
  const nowMs = input.nowMs ?? Date.now();
  const retentionMs = input.retentionMs ?? DEFAULT_CONTINUATION_GC_RETENTION_MS;
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(retentionMs) || retentionMs < 0
      || retentionMs > 365 * 24 * 60 * 60 * 1000) {
    throw new Error('SEC runtime continuation GC timing input is invalid.');
  }
  const environment = location.environment ?? process.env;
  return withContinuationMutationAuthority({
    layout: location.layout,
    repositoryRoot: location.repositoryRoot,
    environment
  }, (authority) => {
    const objectRoot = authority.directory(location.layout.continuationObjectRoot);
    const reachable = activeContinuationDigests(authority, location.layout.workspaceCollectionRoot);
    let scanned = 0;
    let removed = 0;
    let retained = 0;
    const candidates: Array<{ name: string; digest: string; age: number; device: string; inode: string }> = [];
    for (const directoryEntry of readdirSync(objectRoot.path, { withFileTypes: true })) {
      if (!directoryEntry.isFile() || !/^[0-9a-f]{64}\.json$/u.test(directoryEntry.name)) {
        reachable.add('*'); continue;
      }
      const entry = inspectNoFollowOrdinaryFileEntry(objectRoot, directoryEntry.name);
      if (entry === null) continue;
      scanned += 1;
      if (entry.kind !== 'file') { reachable.add('*'); retained += 1; continue; }
      const age = Math.max(0, nowMs - statSync(path.join(objectRoot.path, directoryEntry.name)).mtimeMs);
      candidates.push({ name: directoryEntry.name, digest: directoryEntry.name.slice(0, 64), age,
        device: entry.device, inode: entry.inode });
    }
    // An unknown entry or failed observation discovered late must veto every
    // deletion, not only entries visited after it. No effects occur above.
    for (const candidate of candidates) {
      if (reachable.has('*') || reachable.has(candidate.digest) || candidate.age < retentionMs) {
        retained += 1; continue;
      }
      const current = inspectNoFollowOrdinaryFileEntry(objectRoot, candidate.name);
      if (current === null || current.kind !== 'file' || current.device !== candidate.device || current.inode !== candidate.inode) {
        throw new Error('SEC runtime continuation object changed during GC selection.');
      }
      deleteRetainedNoFollowEntry({ root: objectRoot, relativePath: current.relativePath, kind: 'file',
        device: current.device, inode: current.inode, ancestorDirectories: [] });
      removed += 1;
    }
    return Object.freeze({ scanned, removed, retained });
  });
}
