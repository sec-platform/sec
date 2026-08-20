import { createHash } from 'node:crypto';
import {
  readdirSync,
  statSync
} from 'node:fs';
import path from 'node:path';

import { acquireHeavyVerificationGateLease } from '../../platform/shared/heavy-verification-gate-lease.ts';
import {
  parseLocalContinuationCheckpointV1,
  type LocalContinuationCheckpointV1
} from '../../platform/shared/local-continuation-checkpoint.ts';
import {
  deleteRetainedNoFollowEntryV1,
  inspectNoFollowDirectoryChildV1,
  inspectNoFollowOrdinaryFileEntryV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  replaceDurableCanonicalFileV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import type { SecRuntimeStateLayoutV1 } from '../../platform/shared/sec-runtime-state-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  acquireSecRuntimeStatePhysicalAuthorityV1,
  type SecRuntimeStatePhysicalAuthorityV1
} from './runtime-state-authority.ts';
import {
  resolveSecRuntimeStateForRepositoryV1,
  resolveSecWorkspaceRuntimeRootsV1
} from './runtime-state-paths.ts';

const ACTIVE_CONTINUATION_POINTER_SCHEMA_V1 = 'sec-active-continuation-pointer-v1' as const;
const WORKSPACE_RUNTIME_LOCATOR_SCHEMA_V1 = 'sec-workspace-runtime-locator-v1' as const;
const DEFAULT_CONTINUATION_GC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CONTINUATION_MUTATION_LEASE_WAIT_MS = 30_000;

type Digest = `sha256:${string}`;

interface ActiveContinuationPointerV1 {
  readonly schema: typeof ACTIVE_CONTINUATION_POINTER_SCHEMA_V1;
  readonly repositoryKey: Digest;
  readonly workspaceKey: Digest;
  readonly checkpointDigest: Digest;
  readonly pointerDigest: Digest;
}

interface WorkspaceRuntimeLocatorV1 {
  readonly schema: typeof WORKSPACE_RUNTIME_LOCATOR_SCHEMA_V1;
  readonly workspaceLocatorKey: Digest;
  readonly repository: string;
  readonly repositoryKey: Digest;
  readonly workspaceKey: Digest;
  readonly locatorDigest: Digest;
}

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
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
  parent: PhysicalDirectoryIdentityV1,
  filePath: string,
  source: string
): void {
  const bytes = Buffer.from(source, 'utf8');
  replaceDurableCanonicalFileV1({
    parent,
    name: path.basename(filePath),
    bytes,
    validate: exactBytes(bytes)
  });
}

function continuationObjectPath(layout: SecRuntimeStateLayoutV1, checkpointDigest: Digest): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(checkpointDigest)) {
    throw new Error('SEC runtime continuation digest is invalid.');
  }
  return path.join(layout.continuationObjectRoot, `${checkpointDigest.slice(7)}.json`);
}

function createPointer(layout: SecRuntimeStateLayoutV1, checkpointDigest: Digest): ActiveContinuationPointerV1 {
  const semantic = Object.freeze({
    schema: ACTIVE_CONTINUATION_POINTER_SCHEMA_V1,
    repositoryKey: layout.repositoryKey,
    workspaceKey: layout.workspaceKey,
    checkpointDigest
  });
  return Object.freeze({ ...semantic, pointerDigest: hash(semantic) });
}

function parsePointerRecord(source: string): ActiveContinuationPointerV1 {
  let value: unknown;
  try { value = JSON.parse(source) as unknown; } catch (error) {
    throw new Error('SEC runtime continuation pointer is invalid JSON.', { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SEC runtime continuation pointer must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expected = ['schema', 'repositoryKey', 'workspaceKey', 'checkpointDigest', 'pointerDigest'].sort();
  const actual = Object.keys(record).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)
      || record.schema !== ACTIVE_CONTINUATION_POINTER_SCHEMA_V1
      || typeof record.repositoryKey !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(record.repositoryKey)
      || typeof record.workspaceKey !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(record.workspaceKey)
      || typeof record.checkpointDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(record.checkpointDigest)
      || typeof record.pointerDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(record.pointerDigest)) {
    throw new Error('SEC runtime continuation pointer identity is invalid.');
  }
  const semantic = Object.freeze({
    schema: ACTIVE_CONTINUATION_POINTER_SCHEMA_V1,
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

function parsePointer(source: string, layout: SecRuntimeStateLayoutV1): ActiveContinuationPointerV1 {
  const pointer = parsePointerRecord(source);
  if (pointer.repositoryKey !== layout.repositoryKey || pointer.workspaceKey !== layout.workspaceKey) {
    throw new Error('SEC runtime continuation pointer layout identity is invalid.');
  }
  return pointer;
}

function locatorPath(repositoryRoot: string, source: NodeJS.ProcessEnv): string {
  const roots = resolveSecWorkspaceRuntimeRootsV1({ repositoryRoot, environment: source });
  return path.join(roots.workspaceLocatorRoot, `${roots.workspaceLocatorKey.slice(7)}.json`);
}

function createLocator(layout: SecRuntimeStateLayoutV1, repository: string): WorkspaceRuntimeLocatorV1 {
  const semantic = Object.freeze({
    schema: WORKSPACE_RUNTIME_LOCATOR_SCHEMA_V1,
    workspaceLocatorKey: layout.workspaceLocatorKey,
    repository,
    repositoryKey: layout.repositoryKey,
    workspaceKey: layout.workspaceKey
  });
  return Object.freeze({ ...semantic, locatorDigest: hash(semantic) });
}

function continuationMutationLeaseRoot(stateRoot: string): string {
  return path.join(stateRoot, 'operation-leases', 'v1');
}

function continuationRequiredDirectories(
  layout: SecRuntimeStateLayoutV1,
  repositoryRoot: string,
  source: NodeJS.ProcessEnv
): readonly string[] {
  const roots = resolveSecWorkspaceRuntimeRootsV1({ repositoryRoot, environment: source });
  return Object.freeze([
    roots.workspaceLocatorRoot,
    path.join(layout.stateRoot, 'workspaces', 'v1'),
    path.dirname(layout.continuationPointerPath),
    layout.continuationObjectRoot,
    continuationMutationLeaseRoot(layout.stateRoot)
  ]);
}

async function acquireContinuationAuthority(input: Readonly<{
  layout: SecRuntimeStateLayoutV1;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}>): Promise<SecRuntimeStatePhysicalAuthorityV1> {
  return acquireSecRuntimeStatePhysicalAuthorityV1({
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

async function acquireWorkspaceLocatorAuthority(input: Readonly<{
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}>): Promise<SecRuntimeStatePhysicalAuthorityV1> {
  const roots = resolveSecWorkspaceRuntimeRootsV1(input);
  return acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: input.repositoryRoot,
    stateRoot: roots.stateRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [roots.workspaceLocatorRoot]
  });
}

async function acquireContinuationMutationLease(stateRoot: string) {
  const lockPath = path.join(continuationMutationLeaseRoot(stateRoot), 'continuation-v1');
  const deadline = Date.now() + CONTINUATION_MUTATION_LEASE_WAIT_MS;
  for (;;) {
    try {
      return await acquireHeavyVerificationGateLease({
        gateId: 'runtime-state:continuation',
        lockPath
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (Date.now() >= deadline || !/(already active|still initializing)/iu.test(message)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function withContinuationMutationAuthority<T>(input: Readonly<{
  layout: SecRuntimeStateLayoutV1;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}>, operation: (authority: SecRuntimeStatePhysicalAuthorityV1) => T | Promise<T>): Promise<T> {
  const authority = await acquireContinuationAuthority(input);
  const lease = await acquireContinuationMutationLease(input.layout.stateRoot);
  try {
    const result = await operation(authority);
    await authority.assertCurrent();
    return result;
  } finally {
    await lease.release();
  }
}

function readText(parent: PhysicalDirectoryIdentityV1, filePath: string): string | null {
  const bytes = readNoFollowOrdinaryFileV1(parent, path.basename(filePath));
  return bytes === null ? null : Buffer.from(bytes).toString('utf8');
}

function deleteFileIfPresent(parent: PhysicalDirectoryIdentityV1, filePath: string): boolean {
  const entry = inspectNoFollowOrdinaryFileEntryV1(parent, path.basename(filePath));
  if (entry === null) return false;
  deleteRetainedNoFollowEntryV1({
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
  authority: SecRuntimeStatePhysicalAuthorityV1,
  layout: SecRuntimeStateLayoutV1,
  repository: string,
  repositoryRoot: string,
  source: NodeJS.ProcessEnv
): void {
  const locator = createLocator(layout, repository);
  const filePath = locatorPath(repositoryRoot, source);
  writeAtomicDurable(
    authority.directory(path.dirname(filePath)),
    filePath,
    `${encodeVerificationActionDataV2(locator)}\n`
  );
}

function parseLocator(
  sourceText: string,
  repositoryRoot: string,
  source: NodeJS.ProcessEnv
): WorkspaceRuntimeLocatorV1 {
  let value: unknown;
  try { value = JSON.parse(sourceText) as unknown; } catch (error) {
    throw new Error('SEC workspace runtime locator is invalid JSON.', { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SEC workspace runtime locator must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expected = ['schema', 'workspaceLocatorKey', 'repository', 'repositoryKey', 'workspaceKey', 'locatorDigest'].sort();
  const actual = Object.keys(record).sort();
  const roots = resolveSecWorkspaceRuntimeRootsV1({ repositoryRoot, environment: source });
  if (JSON.stringify(actual) !== JSON.stringify(expected)
      || record.schema !== WORKSPACE_RUNTIME_LOCATOR_SCHEMA_V1
      || record.workspaceLocatorKey !== roots.workspaceLocatorKey
      || typeof record.repository !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(record.repository)
      || typeof record.repositoryKey !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.repositoryKey)
      || typeof record.workspaceKey !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.workspaceKey)
      || typeof record.locatorDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.locatorDigest)) {
    throw new Error('SEC workspace runtime locator identity is invalid.');
  }
  const layout = resolveSecRuntimeStateForRepositoryV1({
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

export async function resolveSecRuntimeStateFromWorkspaceLocatorV1(input: Readonly<{
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{ repository: string; layout: SecRuntimeStateLayoutV1 }> | null> {
  const source = input.environment ?? process.env;
  const filePath = locatorPath(input.repositoryRoot, source);
  const authority = await acquireWorkspaceLocatorAuthority({
    repositoryRoot: input.repositoryRoot,
    environment: source
  });
  const locatorSource = readText(authority.directory(path.dirname(filePath)), filePath);
  if (locatorSource === null) return null;
  const locator = parseLocator(locatorSource, input.repositoryRoot, source);
  return Object.freeze({
    repository: locator.repository,
    layout: resolveSecRuntimeStateForRepositoryV1({
      repository: locator.repository,
      repositoryRoot: input.repositoryRoot,
      environment: source
    })
  });
}

export async function persistActiveContinuationCheckpointV1(input: Readonly<{
  layout: SecRuntimeStateLayoutV1;
  repositoryRoot: string;
  checkpoint: LocalContinuationCheckpointV1;
  environment?: NodeJS.ProcessEnv;
}>): Promise<ActiveContinuationPointerV1> {
  const checkpoint = parseLocalContinuationCheckpointV1(encodeVerificationActionDataV2(input.checkpoint));
  const canonical = `${encodeVerificationActionDataV2(checkpoint)}\n`;
  const objectPath = continuationObjectPath(input.layout, checkpoint.checkpointDigest);
  const environment = input.environment ?? process.env;
  return withContinuationMutationAuthority({
    layout: input.layout,
    repositoryRoot: input.repositoryRoot,
    environment
  }, (authority) => {
    const objectParent = authority.directory(input.layout.continuationObjectRoot);
    const objectBytes = Buffer.from(canonical, 'utf8');
    try {
      publishExclusiveDurableCanonicalFileV1({
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
    const pointer = createPointer(input.layout, checkpoint.checkpointDigest);
    writeAtomicDurable(
      authority.directory(path.dirname(input.layout.continuationPointerPath)),
      input.layout.continuationPointerPath,
      `${encodeVerificationActionDataV2(pointer)}\n`
    );
    persistLocator(
      authority,
      input.layout,
      checkpoint.repository,
      input.repositoryRoot,
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

export async function loadActiveContinuationCheckpointV1(input: Readonly<{
  layout: SecRuntimeStateLayoutV1;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<LocalContinuationCheckpointV1 | null> {
  const environment = input.environment ?? process.env;
  const authority = await acquireContinuationAuthority({
    layout: input.layout,
    repositoryRoot: input.repositoryRoot,
    environment
  });
  const pointerSource = readText(
    authority.directory(path.dirname(input.layout.continuationPointerPath)),
    input.layout.continuationPointerPath
  );
  if (pointerSource === null) return null;
  const pointer = parsePointer(pointerSource, input.layout);
  const objectPath = continuationObjectPath(input.layout, pointer.checkpointDigest);
  const objectSource = readText(authority.directory(input.layout.continuationObjectRoot), objectPath);
  if (objectSource === null) {
    throw new Error('SEC runtime continuation pointer references a missing CAS object.');
  }
  const checkpoint = parseLocalContinuationCheckpointV1(objectSource);
  if (checkpoint.checkpointDigest !== pointer.checkpointDigest) {
    throw new Error('SEC runtime continuation pointer/object digest mismatch.');
  }
  return checkpoint;
}

export async function clearActiveContinuationV1(input: Readonly<{
  layout: SecRuntimeStateLayoutV1;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
}>): Promise<void> {
  const environment = input.environment ?? process.env;
  await withContinuationMutationAuthority({
    layout: input.layout,
    repositoryRoot: input.repositoryRoot,
    environment
  }, (authority) => {
    deleteFileIfPresent(
      authority.directory(path.dirname(input.layout.continuationPointerPath)),
      input.layout.continuationPointerPath
    );
    const filePath = locatorPath(input.repositoryRoot, environment);
    deleteFileIfPresent(authority.directory(path.dirname(filePath)), filePath);
  });
}

function activeContinuationDigests(
  authority: SecRuntimeStatePhysicalAuthorityV1,
  stateRoot: string
): Set<string> {
  const result = new Set<string>();
  const workspacesRoot = path.join(stateRoot, 'workspaces', 'v1');
  const workspaces = authority.directory(workspacesRoot);
  for (const workspace of readdirSync(workspaces.path, { withFileTypes: true })) {
    if (!workspace.isDirectory() || !/^[0-9a-f]{64}$/u.test(workspace.name)) {
      return new Set<string>(['*']);
    }
    try {
      const workspaceDirectory = inspectNoFollowDirectoryChildV1(
        workspaces,
        workspace.name,
        'SEC runtime workspace state'
      );
      if (workspaceDirectory === null) return new Set<string>(['*']);
      const pointerSource = readNoFollowOrdinaryFileV1(
        workspaceDirectory,
        'active-continuation-v1.json'
      );
      if (pointerSource === null) continue;
      const pointer = parsePointerRecord(Buffer.from(pointerSource).toString('utf8'));
      result.add(pointer.checkpointDigest.slice(7));
    } catch {
      // Corrupt active pointers retain all objects rather than causing unsafe GC.
      return new Set<string>(['*']);
    }
  }
  return result;
}

export async function gcContinuationObjectsV1(input: Readonly<{
  layout: SecRuntimeStateLayoutV1;
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
  nowMs?: number;
  retentionMs?: number;
}>): Promise<Readonly<{ scanned: number; removed: number; retained: number }>> {
  const nowMs = input.nowMs ?? Date.now();
  const retentionMs = input.retentionMs ?? DEFAULT_CONTINUATION_GC_RETENTION_MS;
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(retentionMs) || retentionMs < 0
      || retentionMs > 365 * 24 * 60 * 60 * 1000) {
    throw new Error('SEC runtime continuation GC timing input is invalid.');
  }
  const environment = input.environment ?? process.env;
  return withContinuationMutationAuthority({
    layout: input.layout,
    repositoryRoot: input.repositoryRoot,
    environment
  }, (authority) => {
    const objectRoot = authority.directory(input.layout.continuationObjectRoot);
    const reachable = activeContinuationDigests(authority, input.layout.stateRoot);
    let scanned = 0;
    let removed = 0;
    let retained = 0;
    for (const directoryEntry of readdirSync(objectRoot.path, { withFileTypes: true })) {
      if (!directoryEntry.isFile() || !/^[0-9a-f]{64}\.json$/u.test(directoryEntry.name)) {
        reachable.add('*');
        continue;
      }
      const entry = inspectNoFollowOrdinaryFileEntryV1(objectRoot, directoryEntry.name);
      if (entry === null) continue;
      scanned += 1;
      const digest = directoryEntry.name.slice(0, 64);
      const filePath = path.join(objectRoot.path, directoryEntry.name);
      const age = Math.max(0, nowMs - statSync(filePath).mtimeMs);
      const retainCurrent = reachable.has('*') || reachable.has(digest) || age < retentionMs;
      if (retainCurrent) {
        retained += 1;
        continue;
      }
      const current = inspectNoFollowOrdinaryFileEntryV1(objectRoot, directoryEntry.name);
      if (current === null || current.device !== entry.device || current.inode !== entry.inode) {
        throw new Error('SEC runtime continuation object changed during GC selection.');
      }
      deleteRetainedNoFollowEntryV1({
        root: objectRoot,
        relativePath: current.relativePath,
        kind: 'file',
        device: current.device,
        inode: current.inode,
        ancestorDirectories: []
      });
      removed += 1;
    }
    return Object.freeze({ scanned, removed, retained });
  });
}
