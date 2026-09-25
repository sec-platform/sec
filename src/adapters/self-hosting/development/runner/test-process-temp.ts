import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { parseExactJson } from '../../../../contracts/exact-json.ts';
import {
  acquirePhysicalMutationLease,
  type PhysicalMutationLeaseHandle,
  type PhysicalMutationLeaseOptions,
  type PhysicalMutationLeaseOwner
} from '../../../runtime-state/physical/runtime/mutation-lease.ts';
import {
  assertPhysicallyDisjointDirectoryChains,
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowDirectory,
  createNoFollowDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryChild,
  inspectNoFollowOrdinaryFileEntry,
  physicallyContainsDirectoryChain,
  publishExclusiveDurableCanonicalFile,
  relocateRetainedNoFollowDirectory,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata,
  scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';
import {
  runtimeStateTestInvocationGenerationMigrations,
  runtimeStateWorkspaceGenerationMigrations
} from '../../../runtime-state/workspace-state/layout-migration.ts';
import {
  acquireRuntimeStatePhysicalAuthority,
  type RuntimeStatePhysicalAuthority
} from '../../../runtime-state/workspace-state/physical-authority.ts';
import {
  assertIssuedFastTestBatchExecutionAdmission,
  type FastTestBatchExecutionAdmission
} from './test-execution-policy.ts';

const TEST_PROCESS_TEMP_ASSIGNMENT_ENV = 'SEC_TEST_PROCESS_TEMP_ASSIGNMENT_V1';
const TEST_PROCESS_TEMP_ASSIGNMENT_SCHEMA = 'sec-test-process-temp-assignment-v1';
const TEST_PROCESS_TEMP_CONTAINER = 't';
const TEST_PROCESS_TEMP_STAGING_PREFIX = 's';
const TEST_PROCESS_TEMP_GENERATION_PREFIX = 'g';
const TEST_INVOCATION_TEMP_BINDING_NAME = 'temp-parent-binding.json';
const TEST_INVOCATION_TEMP_BINDING_SCHEMA = 'sec-test-invocation-temp-parent-binding-v1';
const TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS = 10_000;
const TEST_RUNTIME_CLEANUP_MAXIMUM_ENTRIES = 100_000;
const TEST_PROCESS_TEMP_LOCATOR_HEX_LENGTH = 24;
const WINDOWS_LEGACY_MAXIMUM_PATH_CHARACTERS = 259;
// Canonical Bun tests reserve this bounded suffix for nested fixtures and
// legacy-Windows child tools; lower temp lifecycle APIs do not invent it.
const TEST_PROCESS_TEMP_REQUIRED_DESCENDANT_CHARACTERS = 160;
const TEST_INVOCATION_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type TestProcessTempDigest = `sha256:${string}`;

export interface TestProcessTempRoot {
  readonly processRoot: string;
  readonly tempRoot: string;
  readonly cleanup: () => Promise<void>;
}

export interface TestInvocationRuntimeRoots {
  readonly stateRoot: string;
  readonly cacheRoot: string;
  readonly prepareProcessTemp: (environment: NodeJS.ProcessEnv) => TestProcessTempRoot;
  readonly cleanup: () => Promise<void>;
}

export interface PreparedTestInvocationRuntime {
  readonly ownership: 'direct' | 'parent-assigned';
  readonly stateRoot: string;
  readonly cacheRoot: string;
  readonly processRoot: string;
  readonly tempRoot: string;
  readonly cleanup: () => Promise<void>;
}

export class TestProcessTempLifecycleError extends Error {
  readonly code:
    | 'TEST_PROCESS_TEMP_OWNED'
    | 'TEST_PROCESS_TEMP_PATH_BUDGET_UNAVAILABLE'
    | 'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN'
    | 'TEST_PROCESS_TEMP_CLEANUP_FAILED';
  readonly pendingRecovery?: Readonly<{
    ownerDigest: TestProcessTempDigest;
    state: PhysicalDirectoryIdentity | null;
    cache: PhysicalDirectoryIdentity | null;
  }>;

  constructor(
    code: TestProcessTempLifecycleError['code'],
    message: string,
    options?: ErrorOptions & Readonly<{ pendingRecovery?: TestProcessTempLifecycleError['pendingRecovery'] }>
  ) {
    super(message, options);
    this.name = 'TestProcessTempLifecycleError';
    this.code = code;
    this.pendingRecovery = options?.pendingRecovery;
  }
}

function assertTestProcessTempPathBudget(tempRoot: string): void {
  if (process.platform !== 'win32') return;
  const normalizedRoot = path.win32.resolve(tempRoot);
  const availableDescendantCharacters = WINDOWS_LEGACY_MAXIMUM_PATH_CHARACTERS
    - normalizedRoot.length - 1;
  if (availableDescendantCharacters < TEST_PROCESS_TEMP_REQUIRED_DESCENDANT_CHARACTERS) {
    throw new TestProcessTempLifecycleError(
      'TEST_PROCESS_TEMP_PATH_BUDGET_UNAVAILABLE',
      `SEC test process temp root leaves ${availableDescendantCharacters} descendant characters; `
        + `${TEST_PROCESS_TEMP_REQUIRED_DESCENDANT_CHARACTERS} are required.`
    );
  }
}

function plannedTestProcessTempRoot(hostTempRoot: string): string {
  const locator = '0'.repeat(TEST_PROCESS_TEMP_LOCATOR_HEX_LENGTH);
  return path.join(
    path.resolve(hostTempRoot),
    `${TEST_PROCESS_TEMP_CONTAINER}${locator}`,
    `${TEST_PROCESS_TEMP_GENERATION_PREFIX}${locator}`,
    'tmp'
  );
}

function assertPlannedTestProcessTempPathBudget(hostTempRoot: string): void {
  assertTestProcessTempPathBudget(plannedTestProcessTempRoot(hostTempRoot));
}

export function testInvocationRuntimeIsolationModeForPlatform(
  platform: NodeJS.Platform
): 'retained' | 'unavailable' {
  return platform === 'win32' || platform === 'linux' ? 'retained' : 'unavailable';
}

function sameIdentity(left: PhysicalDirectoryIdentity, right: PhysicalDirectoryIdentity): boolean {
  return left.path === right.path && left.finalPath === right.finalPath
    && left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function assignTempEnvironment(environment: NodeJS.ProcessEnv, tempRoot: string): void {
  environment.TMPDIR = environment.TMP = environment.TEMP = tempRoot;
}

const TEST_INVOCATION_ENVIRONMENT_KEYS = Object.freeze([
  'SEC_STATE_HOME',
  'SEC_CACHE_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  TEST_PROCESS_TEMP_ASSIGNMENT_ENV
] as const);

type TestInvocationEnvironmentKey = typeof TEST_INVOCATION_ENVIRONMENT_KEYS[number];

function captureTestInvocationEnvironment(
  environment: NodeJS.ProcessEnv
): ReadonlyMap<TestInvocationEnvironmentKey, string | undefined> {
  return new Map(TEST_INVOCATION_ENVIRONMENT_KEYS.map((key) => [key, environment[key]]));
}

function restoreTestInvocationEnvironment(
  environment: NodeJS.ProcessEnv,
  snapshot: ReadonlyMap<TestInvocationEnvironmentKey, string | undefined>
): void {
  for (const key of TEST_INVOCATION_ENVIRONMENT_KEYS) {
    const value = snapshot.get(key);
    if (value === undefined) delete environment[key];
    else environment[key] = value;
  }
}

function requireAssignedRuntimeRoot(environment: NodeJS.ProcessEnv, key: 'SEC_STATE_HOME' | 'SEC_CACHE_HOME'): string {
  const value = environment[key];
  if (value === undefined || !path.isAbsolute(value)) {
    throw new Error(`Parent-assigned SEC test runtime requires an absolute ${key}.`);
  }
  return path.resolve(value);
}

function createExclusiveOwnedDirectoryGeneration(
  parent: PhysicalDirectoryChain,
  name: string
): PhysicalDirectoryChain {
  const target = createExclusiveNoFollowDirectory(parent.target, name);
  return Object.freeze({ target, ancestors: Object.freeze([...parent.ancestors, target]) });
}

function cleanupDeadline(deadlineAtUnixMs?: number): number {
  const remaining = deadlineAtUnixMs === undefined
    ? TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS
    : Math.max(0, deadlineAtUnixMs - Date.now());
  return performance.now() + remaining;
}

function retireDirectoryTree(parent: PhysicalDirectoryIdentity, root: PhysicalDirectoryIdentity, deadlineAtUnixMs?: number): void {
  const deadline = cleanupDeadline(deadlineAtUnixMs);
  const inventory = scanNoFollowDirectoryTreeMetadata(root, {
    includePermissionMode: true,
    deadlineAtMs: deadline,
    maximumEntries: TEST_RUNTIME_CLEANUP_MAXIMUM_ENTRIES
  });
  retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs: deadline,
    inventory,
    parent,
    // The exact owned snapshot may inherit read-only package modes.
    // Use retained-fd permission recovery; never chmod a lexical tree or links.
    restoreOwnerPermissions: true,
    root
  });
}

function deleteOwnedDirectoryGeneration(generation: PhysicalDirectoryChain, label: string, deadlineAtUnixMs?: number): void {
  const parent = generation.ancestors.at(-2);
  if (parent === undefined) throw new Error(`${label} has no retained parent.`);
  retireDirectoryTree(parent, generation.target, deadlineAtUnixMs);
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const normalizedCandidate = process.platform === 'win32'
    ? path.resolve(candidate).toLowerCase()
    : path.resolve(candidate);
  const normalizedParent = process.platform === 'win32'
    ? path.resolve(parent).toLowerCase()
    : path.resolve(parent);
  const relative = path.relative(normalizedParent, normalizedCandidate);
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function assertLexicallyDisjoint(left: string, right: string, label: string): void {
  if (isSameOrInside(left, right) || isSameOrInside(right, left)) {
    throw new Error(`SEC test process temp ${label} must be disjoint.`);
  }
}

async function canonicalPlannedPath(absolutePath: string): Promise<string> {
  let cursor = path.resolve(absolutePath);
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(await fs.realpath(cursor), ...missing.reverse());
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function assertLocationOutsidePhysicalRoot(
  absolutePath: string,
  physicalRoot: PhysicalDirectoryChain,
  label: string
): void {
  let cursor = path.resolve(absolutePath);
  for (;;) {
    const presence = inspectExactNoFollowDirectoryPresence(cursor, label);
    if (presence.state === 'present') {
      if (cursor === path.resolve(absolutePath)) {
        assertPhysicallyDisjointDirectoryChains(physicalRoot, presence.directory, label);
      } else if (physicallyContainsDirectoryChain(physicalRoot, presence.directory)) {
        throw new Error(`SEC test process temp ${label} planned location is inside the OS temp physical root.`);
      }
      return;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`SEC test process temp ${label} has no existing no-follow ancestor.`);
    }
    cursor = parent;
  }
}

function digestLocator(digest: TestProcessTempDigest): string {
  return digest.slice('sha256:'.length, 'sha256:'.length + TEST_PROCESS_TEMP_LOCATOR_HEX_LENGTH);
}

function invocationPhysicalDigest(input: Readonly<{
  invocationKey: string;
  workspaceLocatorKey: string;
  repository: PhysicalDirectoryIdentity;
  hostTemp: PhysicalDirectoryIdentity;
}>): TestProcessTempDigest {
  const physicalIdentity = (value: PhysicalDirectoryIdentity) => Object.freeze({
    device: value.device,
    inode: value.inode,
    objectId: value.objectId
  });
  return sha256(Object.freeze({
    schema: 'sec-test-process-temp-invocation-binding-v1',
    invocationKey: requireInvocationKey(input.invocationKey),
    workspaceLocatorKey: input.workspaceLocatorKey,
    repository: physicalIdentity(input.repository),
    hostTemp: physicalIdentity(input.hostTemp)
  })) as TestProcessTempDigest;
}

function requireInvocationKey(value: string): string {
  if (!TEST_INVOCATION_KEY_PATTERN.test(value)) {
    throw new Error('SEC test invocation key must be a canonical UUID.');
  }
  return value;
}

function generationDigest(
  container: PhysicalDirectoryIdentity,
  invocationDigest: TestProcessTempDigest,
  owner: PhysicalMutationLeaseOwner,
  physical: PhysicalDirectoryIdentity
): TestProcessTempDigest {
  return sha256(Object.freeze({
    schema: 'sec-test-process-temp-physical-binding-v1',
    invocationDigest,
    owner,
    container: Object.freeze({
      device: container.device,
      inode: container.inode,
      objectId: container.objectId
    }),
    physical: Object.freeze({
      device: physical.device,
      inode: physical.inode,
      objectId: physical.objectId
    })
  })) as TestProcessTempDigest;
}

function generationName(
  container: PhysicalDirectoryIdentity,
  invocationDigest: TestProcessTempDigest,
  owner: PhysicalMutationLeaseOwner,
  physical: PhysicalDirectoryIdentity
): string {
  return `${TEST_PROCESS_TEMP_GENERATION_PREFIX}${digestLocator(
    generationDigest(container, invocationDigest, owner, physical)
  )}`;
}

function topLevelInventory(root: PhysicalDirectoryIdentity, deadlineAtUnixMs?: number) {
  return scanNoFollowDirectoryDirectMetadata(root, {
    deadlineAtMs: cleanupDeadline(deadlineAtUnixMs),
    maximumEntries: TEST_RUNTIME_CLEANUP_MAXIMUM_ENTRIES
  });
}

function recoverReclaimedGeneration(input: Readonly<{
  container: PhysicalDirectoryIdentity;
  invocationDigest: TestProcessTempDigest;
  owner: PhysicalMutationLeaseOwner;
  deadlineAtUnixMs?: number;
}>): void {
  const entries = topLevelInventory(input.container, input.deadlineAtUnixMs);
  const prefix = TEST_PROCESS_TEMP_GENERATION_PREFIX;
  const candidates = entries.filter(({ relativePath }) => relativePath.startsWith(prefix));
  const conflicting = entries.filter(({ relativePath }) =>
    !relativePath.startsWith(prefix));
  if (conflicting.length > 0) {
    throw new TestProcessTempLifecycleError(
      'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
      'SEC test process temp container has foreign or ambiguous residue.'
    );
  }
  for (const candidate of candidates) {
    const suffix = candidate.relativePath.slice(prefix.length);
    const hasGenerationDigestShape = /^[0-9a-f]+$/u.test(suffix)
      && (suffix.length === TEST_PROCESS_TEMP_LOCATOR_HEX_LENGTH || suffix.length === 64);
    if (candidate.kind !== 'directory' || !hasGenerationDigestShape) {
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
        'SEC test process temp reclaimed generation is unknown.'
      );
    }
    const retained = inspectNoFollowDirectoryChild(
      input.container,
      candidate.relativePath,
      'SEC test process temp reclaimed generation'
    );
    if (retained === null) {
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
        'SEC test process temp reclaimed generation physical identity is unknown.'
      );
    }
    const physicalDigest = generationDigest(
      input.container,
      input.invocationDigest,
      input.owner,
      retained
    );
    const acceptedNames = new Set([
      `${prefix}${digestLocator(physicalDigest)}`,
      `${prefix}${physicalDigest.slice('sha256:'.length)}`
    ]);
    if (!acceptedNames.has(candidate.relativePath)) {
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
        'SEC test process temp reclaimed generation physical identity is unknown.'
      );
    }
    retireDirectoryTree(input.container, retained, input.deadlineAtUnixMs);
  }
}

function assertInvocationContainerEmpty(container: PhysicalDirectoryIdentity, deadlineAtUnixMs?: number): void {
  if (topLevelInventory(container, deadlineAtUnixMs).length > 0) {
    throw new TestProcessTempLifecycleError(
      'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
      'SEC test process temp container is not empty after owner recovery.'
    );
  }
}

function createStagingGeneration(input: Readonly<{
  container: PhysicalDirectoryChain;
  stagingScope?: string;
}>): PhysicalDirectoryChain {
  const stagingName = `${TEST_PROCESS_TEMP_STAGING_PREFIX}${input.stagingScope === undefined ? '' : `${input.stagingScope}-`}${randomBytes(12).toString('hex')}`;
  return createExclusiveOwnedDirectoryGeneration(input.container, stagingName);
}

function createChildGeneration(input: Readonly<{
  container: PhysicalDirectoryChain;
  invocationDigest: TestProcessTempDigest;
  owner: PhysicalMutationLeaseOwner;
  stagingScope?: string;
  deadlineAtUnixMs?: number;
}>): PhysicalDirectoryChain {
  const staging = createStagingGeneration(input);
  try {
    const name = generationName(
      input.container.target,
      input.invocationDigest,
      input.owner,
      staging.target
    );
    const target = relocateRetainedNoFollowDirectory({ directory: staging.target, tombstoneName: name });
    return Object.freeze({
      target,
      ancestors: Object.freeze([...input.container.ancestors, target])
    });
  } catch (error) {
    try {
      deleteOwnedDirectoryGeneration(staging, 'SEC test process temp staging generation', input.deadlineAtUnixMs);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'SEC test process temp generation admission and cleanup failed.'
      );
    }
    throw error;
  }
}

function createParentOwnedTempSupervisor(input: Readonly<{
  containerParent: PhysicalDirectoryChain;
  containerName: string;
  invocationDigest: TestProcessTempDigest;
  leaseName: string;
  leaseParent: PhysicalDirectoryIdentity;
  leaseOptions?: PhysicalMutationLeaseOptions;
  deadlineAtUnixMs?: number;
}>): Readonly<{
  containerIdentity: PhysicalDirectoryIdentity;
  prepare(environment: NodeJS.ProcessEnv): TestProcessTempRoot;
  cleanup(): void;
}> {
  const lease = acquirePhysicalMutationLease(
    input.leaseParent,
    input.leaseName,
    input.leaseOptions
  );
  if (lease === null) {
    throw new TestProcessTempLifecycleError(
      'TEST_PROCESS_TEMP_OWNED',
      'SEC test process temp is owned by another live or unverified process.'
    );
  }
  let container: PhysicalDirectoryChain;
  try {
    const containerIdentity = createNoFollowDirectoryChain(
      input.containerParent.target,
      [input.containerName]
    );
    container = inspectNoFollowDirectoryChain(
      containerIdentity.path,
      'SEC test process temp invocation container'
    );
    if (lease.reclaimedOwner !== null) {
      recoverReclaimedGeneration({
        container: container.target,
        invocationDigest: input.invocationDigest,
        owner: lease.reclaimedOwner,
        deadlineAtUnixMs: input.deadlineAtUnixMs
      });
    }
    assertInvocationContainerEmpty(container.target, input.deadlineAtUnixMs);
    lease.acknowledgeReclaimedRecovery();
  } catch (error) {
    try {
      if (lease.recoveryPending) lease.restoreReclaimedOwner();
      else lease.release();
    } catch (releaseError) {
      throw new AggregateError(
        [error, releaseError],
        'SEC test process temp preparation and lease settlement failed.'
      );
    }
    throw error;
  }
  const active = new Map<string, PhysicalDirectoryChain>();
  let ownerSettled = false;
  let containerSettled = false;
  let settlementStarted = false;

  const settleGeneration = (generation: PhysicalDirectoryChain): void => {
    deleteOwnedDirectoryGeneration(generation, 'SEC test process temp generation', input.deadlineAtUnixMs);
    active.delete(generation.target.path);
  };

  return Object.freeze({
    containerIdentity: container.target,
    prepare(environment): TestProcessTempRoot {
      if (settlementStarted) throw new Error('SEC test process temp supervisor is settling or settled.');
      const generation = createChildGeneration({
        container,
        invocationDigest: input.invocationDigest,
        owner: lease.owner,
        deadlineAtUnixMs: input.deadlineAtUnixMs
      });
      try {
        const temp = createExclusiveOwnedDirectoryGeneration(generation, 'tmp');
        const assignment = Object.freeze({
          schema: TEST_PROCESS_TEMP_ASSIGNMENT_SCHEMA,
          parent: container.target,
          root: generation.target
        });
        environment[TEST_PROCESS_TEMP_ASSIGNMENT_ENV] = JSON.stringify(assignment);
        assignTempEnvironment(environment, temp.target.path);
        active.set(generation.target.path, generation);
        let settled = false;
        return Object.freeze({
          processRoot: generation.target.path,
          tempRoot: temp.target.path,
          cleanup: async (): Promise<void> => {
            if (settled) return;
            settleGeneration(generation);
            settled = true;
          }
        });
      } catch (error) {
        try {
          settleGeneration(generation);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'SEC test process temp preparation and cleanup failed.'
          );
        }
        throw error;
      }
    },
    cleanup(): void {
      if (ownerSettled) return;
      settlementStarted = true;
      const failures: unknown[] = [];
      for (const generation of [...active.values()]) {
        try { settleGeneration(generation); } catch (error) { failures.push(error); }
      }
      if (failures.length === 0 && !containerSettled) {
        try {
          deleteOwnedDirectoryGeneration(container, 'SEC test process temp invocation container', input.deadlineAtUnixMs);
          containerSettled = true;
        } catch (error) {
          failures.push(error);
        }
      }
      // The lease is the durable recovery identity for these generations.
      // A failed retirement must leave it available for dead-owner reclaim.
      if (failures.length === 0) {
        try {
          lease.release();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 0) {
        ownerSettled = true;
      } else {
        throw new TestProcessTempLifecycleError(
          'TEST_PROCESS_TEMP_CLEANUP_FAILED',
          'SEC test process temp settlement failed.',
          { cause: new AggregateError(failures) }
        );
      }
    }
  });
}

function parseIdentity(value: unknown): PhysicalDirectoryIdentity | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 5 || keys.join('\0') !== ['device', 'finalPath', 'inode', 'objectId', 'path'].join('\0')
      || typeof record.path !== 'string' || !path.isAbsolute(record.path)
      || typeof record.finalPath !== 'string' || record.finalPath.length === 0
      || typeof record.device !== 'string' || record.device.length === 0
      || typeof record.inode !== 'string' || record.inode.length === 0
      || typeof record.objectId !== 'string' || record.objectId.length === 0) return null;
  return Object.freeze({
    path: path.resolve(record.path),
    finalPath: record.finalPath,
    device: record.device,
    inode: record.inode,
    objectId: record.objectId
  });
}

/** Child-side adoption performs no delete Effect; cleanup stays with the direct parent supervisor. */
export function consumeTestProcessTempAssignment(input: Readonly<{
  environment: NodeJS.ProcessEnv;
  pathBudget?: 'canonical-test-runtime';
}>): TestProcessTempRoot | null {
  const serialized = input.environment[TEST_PROCESS_TEMP_ASSIGNMENT_ENV];
  if (serialized === undefined) return null;
  const value = parseExactJson(serialized, 'SEC test process temp parent assignment', {
    rootObjectKeys: ['parent', 'root', 'schema']
  }, 3) as Record<string, unknown>;
  const parent = parseIdentity(value.parent);
  const root = parseIdentity(value.root);
  if (value.schema !== TEST_PROCESS_TEMP_ASSIGNMENT_SCHEMA || parent === null || root === null
      || root.path !== path.join(parent.path, path.basename(root.path))
      || !sameIdentity(inspectNoFollowDirectoryChain(root.path, 'Assigned SEC test process temp').target, root)) {
    throw new Error('SEC test process temp parent assignment is invalid or replaced.');
  }
  assertSameNoFollowDirectoryIdentity(parent, 'Assigned SEC test process temp parent');
  const tempRoot = path.join(root.path, 'tmp');
  if (input.pathBudget === 'canonical-test-runtime') assertTestProcessTempPathBudget(tempRoot);
  inspectNoFollowDirectoryChain(tempRoot, 'Assigned SEC test TMP root');
  assignTempEnvironment(input.environment, tempRoot);
  return Object.freeze({
    processRoot: root.path,
    tempRoot,
    cleanup: async (): Promise<void> => undefined
  });
}

async function releaseAuthority(
  authority: RuntimeStatePhysicalAuthority | null,
  primary?: unknown,
  deadlineAtUnixMs?: number
): Promise<void> {
  if (authority === null) {
    if (primary !== undefined) throw primary;
    return;
  }
  try {
    await authority.release(deadlineAtUnixMs === undefined ? undefined : { deadlineAtUnixMs });
  } catch (releaseError) {
    if (primary !== undefined) {
      throw new AggregateError([primary, releaseError], 'SEC test Runtime State authority settlement failed.');
    }
    throw releaseError;
  }
  if (primary !== undefined) throw primary;
}

async function createRetainedTempSupervisor(input: Readonly<{
  repositoryRoot: string;
  hostTempRoot: string;
  environment: NodeJS.ProcessEnv;
  authority: RuntimeStatePhysicalAuthority;
  invocationKey: string;
  leaseOptions?: PhysicalMutationLeaseOptions;
  deadlineAtUnixMs?: number;
}>): Promise<ReturnType<typeof createParentOwnedTempSupervisor>> {
  const roots = resolveWorkspaceRuntimeRoots({
    repositoryRoot: input.repositoryRoot,
    environment: input.environment
  });
  const hostTemp = inspectNoFollowDirectoryChain(input.hostTempRoot, 'SEC test OS temp root');
  const repository = inspectNoFollowDirectoryChain(input.repositoryRoot, 'SEC test repository root');
  assertPhysicallyDisjointDirectoryChains(hostTemp, repository, 'SEC test OS temp root and repository');
  assertLocationOutsidePhysicalRoot(roots.stateRoot, hostTemp, 'Runtime State root');
  assertLocationOutsidePhysicalRoot(roots.cacheRoot, hostTemp, 'Runtime Cache root');
  const invocationDigest = invocationPhysicalDigest({
    invocationKey: input.invocationKey,
    workspaceLocatorKey: roots.workspaceLocatorKey,
    repository: repository.target,
    hostTemp: hostTemp.target
  });
  return createParentOwnedTempSupervisor({
    containerParent: hostTemp,
    containerName: `${TEST_PROCESS_TEMP_CONTAINER}${digestLocator(invocationDigest)}`,
    invocationDigest,
    leaseName: `invocation-${invocationDigest.slice('sha256:'.length)}.lease`,
    leaseParent: input.authority.directory(roots.testProcessTempLeaseRoot),
    leaseOptions: input.leaseOptions,
    deadlineAtUnixMs: input.deadlineAtUnixMs
  });
}

const RUNTIME_RECOVERY_LEASE = /^runtime-([0-9a-f]{64})-([0-9a-f]{64})\.lease$/u;

type RuntimeTempParentBinding = Readonly<{
  schema: typeof TEST_INVOCATION_TEMP_BINDING_SCHEMA;
  invocationDigest: TestProcessTempDigest;
  ownerDigest: TestProcessTempDigest;
  hostTemp: PhysicalDirectoryIdentity;
  container: PhysicalDirectoryIdentity;
  containerName: string;
}>;

function runtimeTempParentBindingBytes(binding: RuntimeTempParentBinding): Buffer {
  return Buffer.from(`${JSON.stringify(binding)}\n`, 'utf8');
}

function parseRuntimeTempParentBinding(bytes: Uint8Array): RuntimeTempParentBinding | null {
  let value: unknown;
  try {
    value = parseExactJson(Buffer.from(bytes).toString('utf8'), 'SEC test invocation temp parent binding', {
      rootObjectKeys: ['container', 'containerName', 'hostTemp', 'invocationDigest', 'ownerDigest', 'schema']
    }, 3);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const hostTemp = parseIdentity(record.hostTemp);
  const container = parseIdentity(record.container);
  if (record.schema !== TEST_INVOCATION_TEMP_BINDING_SCHEMA
      || typeof record.invocationDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.invocationDigest)
      || typeof record.ownerDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.ownerDigest)
      || typeof record.containerName !== 'string' || !/^t[0-9a-f]{24}$/u.test(record.containerName)
      || hostTemp === null || container === null
      || container.path !== path.join(hostTemp.path, record.containerName)) return null;
  const binding = Object.freeze({
    schema: TEST_INVOCATION_TEMP_BINDING_SCHEMA,
    invocationDigest: record.invocationDigest as TestProcessTempDigest,
    ownerDigest: record.ownerDigest as TestProcessTempDigest,
    hostTemp,
    container,
    containerName: record.containerName
  });
  return Buffer.from(bytes).equals(runtimeTempParentBindingBytes(binding)) ? binding : null;
}

function publishRuntimeTempParentBinding(input: Readonly<{
  state: PhysicalDirectoryChain;
  invocationDigest: TestProcessTempDigest;
  owner: PhysicalMutationLeaseOwner;
  hostTemp: PhysicalDirectoryIdentity;
  container: PhysicalDirectoryIdentity;
}>): Buffer {
  const binding: RuntimeTempParentBinding = Object.freeze({
    schema: TEST_INVOCATION_TEMP_BINDING_SCHEMA,
    invocationDigest: input.invocationDigest,
    ownerDigest: sha256(input.owner) as TestProcessTempDigest,
    hostTemp: input.hostTemp,
    container: input.container,
    containerName: `${TEST_PROCESS_TEMP_CONTAINER}${digestLocator(input.invocationDigest)}`
  });
  const bytes = runtimeTempParentBindingBytes(binding);
  publishExclusiveDurableCanonicalFile({
    parent: input.state.target,
    name: TEST_INVOCATION_TEMP_BINDING_NAME,
    bytes,
    validate: (bytes) => {
      if (parseRuntimeTempParentBinding(bytes) === null) {
        throw new Error('SEC test invocation temp parent binding is noncanonical.');
      }
    }
  });
  return bytes;
}

function runtimeStateGenerationPrefix(scope: string): string {
  return `${TEST_PROCESS_TEMP_GENERATION_PREFIX}${scope.slice(0, TEST_PROCESS_TEMP_LOCATOR_HEX_LENGTH)}-`;
}

function runtimeStateGenerationName(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  invocationDigest: TestProcessTempDigest;
  owner: PhysicalMutationLeaseOwner;
  physical: PhysicalDirectoryIdentity;
  scope: string;
  bindingBytes: Uint8Array;
}>): string {
  const digest = sha256(Object.freeze({
    schema: 'sec-test-invocation-state-binding-v1',
    generation: generationDigest(input.parent, input.invocationDigest, input.owner, input.physical),
    bindingDigest: rawSha256(input.bindingBytes)
  })) as TestProcessTempDigest;
  return `${runtimeStateGenerationPrefix(input.scope)}${digestLocator(digest)}`;
}

function findBoundRuntimeGeneration(input: Readonly<{
  parent: PhysicalDirectoryChain;
  invocationDigest: TestProcessTempDigest;
  owner: PhysicalMutationLeaseOwner;
  stagingScope: string;
  deadlineAtUnixMs?: number;
  sealedState?: boolean;
}>): PhysicalDirectoryChain | null | 'unknown' {
  const entries = topLevelInventory(input.parent.target, input.deadlineAtUnixMs);
  // A staging name is the explicit mkdir-to-identity-publication crash gap.
  // No durable FileId receipt exists yet, so recovery must retain it as unknown.
  if (entries.some(({ relativePath }) =>
    relativePath.startsWith(`${TEST_PROCESS_TEMP_STAGING_PREFIX}${input.stagingScope}-`))) {
    return 'unknown';
  }
  const matches: PhysicalDirectoryChain[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'directory' || !entry.relativePath.startsWith(TEST_PROCESS_TEMP_GENERATION_PREFIX)) continue;
    if (input.sealedState && !entry.relativePath.startsWith(runtimeStateGenerationPrefix(input.stagingScope))) continue;
    const retained = inspectNoFollowDirectoryChild(
      input.parent.target,
      entry.relativePath,
      'SEC test invocation paired recovery generation'
    );
    if (retained === null) return 'unknown';
    let expectedName: string;
    if (input.sealedState) {
      const binding = inspectNoFollowOrdinaryFileEntry(retained, TEST_INVOCATION_TEMP_BINDING_NAME);
      if (binding?.bytes === undefined || binding.bytes === null) return 'unknown';
      expectedName = runtimeStateGenerationName({
        parent: input.parent.target,
        invocationDigest: input.invocationDigest,
        owner: input.owner,
        physical: retained,
        scope: input.stagingScope,
        bindingBytes: binding.bytes
      });
      if (expectedName !== entry.relativePath) return 'unknown';
    } else expectedName = generationName(
      input.parent.target,
      input.invocationDigest,
      input.owner,
      retained
    );
    if (expectedName === entry.relativePath) matches.push(Object.freeze({
      target: retained,
      ancestors: Object.freeze([...input.parent.ancestors, retained])
    }));
  }
  return matches.length === 0 ? null : matches.length === 1 ? matches[0]! : 'unknown';
}

function recoverRuntimeInvocationLease(input: Readonly<{
  lease: PhysicalMutationLeaseHandle;
  stagingScope: string;
  invocationDigest: TestProcessTempDigest;
  stateParent: PhysicalDirectoryChain;
  cacheParent: PhysicalDirectoryChain;
  leaseParent: PhysicalDirectoryIdentity;
  leaseOptions?: PhysicalMutationLeaseOptions;
  deadlineAtUnixMs?: number;
}>): void {
  const owner = input.lease.reclaimedOwner;
  if (owner === null) throw new TestProcessTempLifecycleError(
    'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
    'SEC test invocation recovery lease has no durable predecessor owner.'
  );
  const state = findBoundRuntimeGeneration({
    parent: input.stateParent,
    invocationDigest: input.invocationDigest,
    owner,
    stagingScope: input.stagingScope,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    sealedState: true
  });
  const cache = findBoundRuntimeGeneration({
    parent: input.cacheParent,
    invocationDigest: input.invocationDigest,
    owner,
    stagingScope: input.stagingScope,
    deadlineAtUnixMs: input.deadlineAtUnixMs
  });
  if (state === 'unknown' || cache === 'unknown' || (state === null && cache !== null)) {
    throw new TestProcessTempLifecycleError(
      'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
      'SEC test invocation paired State/Cache recovery identity is unknown.'
    );
  }
  if (state === null) {
    const tempLease = acquirePhysicalMutationLease(
      input.leaseParent,
      `invocation-${input.invocationDigest.slice('sha256:'.length)}.lease`,
      input.leaseOptions
    );
    if (tempLease === null || tempLease.reclaimedOwner !== null) {
      tempLease?.restoreReclaimedOwner();
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
        'SEC test invocation has a TMP recovery owner but no sealed State binding.'
      );
    }
    tempLease.release();
    input.lease.acknowledgeReclaimedRecovery();
    input.lease.release();
    return;
  }
  const bindingEntry = inspectNoFollowOrdinaryFileEntry(state.target, TEST_INVOCATION_TEMP_BINDING_NAME);
  const bindingBytes = bindingEntry?.bytes;
  const binding = bindingBytes === null || bindingBytes === undefined
    ? null
    : parseRuntimeTempParentBinding(bindingBytes);
  if (bindingBytes === null || bindingBytes === undefined || binding === null
      || binding.invocationDigest !== input.invocationDigest
      || binding.ownerDigest !== sha256(owner)
      || binding.containerName !== `${TEST_PROCESS_TEMP_CONTAINER}${digestLocator(input.invocationDigest)}`
      || runtimeStateGenerationName({
        parent: input.stateParent.target,
        invocationDigest: input.invocationDigest,
        owner,
        physical: state.target,
        scope: input.stagingScope,
        bindingBytes
      }) !== path.basename(state.target.path)) {
    throw new TestProcessTempLifecycleError(
      'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
      'SEC test invocation retained TMP parent binding is unavailable or does not match its recovery owner.'
    );
  }
  const retainedTempParent = assertSameNoFollowDirectoryIdentity(
    binding.hostTemp,
    'SEC test invocation recovered TMP parent'
  );
  const containerPath = path.join(retainedTempParent.target.path, binding.containerName);
  const containerPresence = inspectExactNoFollowDirectoryPresence(
    containerPath,
    'SEC test invocation recovered temp container'
  );
  let tempLease: PhysicalMutationLeaseHandle | null = null;
  let tempReleaseAttempted = false;
  try {
    tempLease = acquirePhysicalMutationLease(
      input.leaseParent,
      `invocation-${input.invocationDigest.slice('sha256:'.length)}.lease`,
      input.leaseOptions
    );
    if (tempLease === null || (containerPresence.state === 'present' && tempLease.reclaimedOwner === null)) {
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
        'SEC test invocation temp recovery owner is unavailable.'
      );
    }
    if (containerPresence.state === 'present') {
      assertSameNoFollowDirectoryIdentity(binding.container, 'SEC test invocation recovered TMP container');
      recoverReclaimedGeneration({
        container: containerPresence.directory.target,
        invocationDigest: input.invocationDigest,
        owner: tempLease.reclaimedOwner!,
        deadlineAtUnixMs: input.deadlineAtUnixMs
      });
      deleteOwnedDirectoryGeneration(containerPresence.directory, 'SEC recovered test invocation TMP container', input.deadlineAtUnixMs);
    }
    tempLease.acknowledgeReclaimedRecovery();
    tempReleaseAttempted = true;
    tempLease.release();
    tempLease = null;
    if (cache !== null) deleteOwnedDirectoryGeneration(cache, 'SEC recovered test invocation Cache generation', input.deadlineAtUnixMs);
    deleteOwnedDirectoryGeneration(state, 'SEC recovered test invocation State generation', input.deadlineAtUnixMs);
    input.lease.acknowledgeReclaimedRecovery();
    input.lease.release();
  } catch (error) {
    try {
      if (tempLease?.recoveryPending) tempLease.restoreReclaimedOwner();
      else if (!tempReleaseAttempted) tempLease?.release();
      if (input.lease.recoveryPending) input.lease.restoreReclaimedOwner();
    } catch (settlementError) {
      throw new AggregateError([error, settlementError], 'SEC paired invocation recovery and lease settlement failed.');
    }
    throw error;
  }
}

function recoverRuntimeInvocationLeaseSafely(
  input: Parameters<typeof recoverRuntimeInvocationLease>[0]
): void {
  try {
    recoverRuntimeInvocationLease(input);
  } catch (error) {
    if (input.lease.recoveryPending) {
      try {
        input.lease.restoreReclaimedOwner();
      } catch (settlementError) {
        throw new AggregateError(
          [error, settlementError],
          'SEC paired invocation recovery and predecessor restoration failed.'
        );
      }
    }
    throw error;
  }
}

function recoverDeadRuntimeInvocationLeases(input: Readonly<{
  stateParent: PhysicalDirectoryChain;
  cacheParent: PhysicalDirectoryChain;
  leaseParent: PhysicalDirectoryIdentity;
  leaseOptions?: PhysicalMutationLeaseOptions;
  deadlineAtUnixMs?: number;
}>): void {
  const entries = topLevelInventory(input.leaseParent, input.deadlineAtUnixMs);
  for (const entry of entries) {
    const match = RUNTIME_RECOVERY_LEASE.exec(entry.relativePath);
    if (entry.kind !== 'file' || match === null) continue;
    const lease = acquirePhysicalMutationLease(input.leaseParent, entry.relativePath, input.leaseOptions);
    if (lease === null) continue;
    if (lease.reclaimedOwner === null) {
      lease.release();
      continue;
    }
    recoverRuntimeInvocationLeaseSafely({
      ...input,
      lease,
      stagingScope: match[1]!,
      invocationDigest: `sha256:${match[2]!}`
    });
  }
}

/**
 * Creates one parent-owned temporary generation outside repository, Runtime
 * State and Runtime Cache. Runtime State owns only the workspace-scoped lease;
 * the OS temporary root remains disposable data.
 */
export async function createTestProcessTempRoot(input: Readonly<{
  repositoryRoot: string;
  hostTempRoot: string;
  environment: NodeJS.ProcessEnv;
  invocationKey?: string;
}>): Promise<TestProcessTempRoot> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const hostTempRoot = path.resolve(input.hostTempRoot);
  const roots = resolveWorkspaceRuntimeRoots({ repositoryRoot, environment: input.environment });
  assertLexicallyDisjoint(hostTempRoot, repositoryRoot, 'OS temp root and repository');
  assertLexicallyDisjoint(hostTempRoot, roots.stateRoot, 'OS temp root and Runtime State');
  assertLexicallyDisjoint(hostTempRoot, roots.cacheRoot, 'OS temp root and Runtime Cache');

  if (process.platform === 'darwin') {
    const [physicalHostTempRoot, physicalRepositoryRoot, physicalStateRoot, physicalCacheRoot] =
      await Promise.all([
        canonicalPlannedPath(hostTempRoot),
        canonicalPlannedPath(repositoryRoot),
        canonicalPlannedPath(roots.stateRoot),
        canonicalPlannedPath(roots.cacheRoot)
      ]);
    assertLexicallyDisjoint(physicalHostTempRoot, physicalRepositoryRoot, 'physical OS temp root and repository');
    assertLexicallyDisjoint(physicalHostTempRoot, physicalStateRoot, 'physical OS temp root and Runtime State');
    assertLexicallyDisjoint(physicalHostTempRoot, physicalCacheRoot, 'physical OS temp root and Runtime Cache');
    const processRoot = await fs.mkdtemp(path.join(physicalHostTempRoot, 'sec-test-process-'));
    const tempRoot = path.join(processRoot, 'tmp');
    await fs.mkdir(tempRoot);
    assignTempEnvironment(input.environment, tempRoot);
    return Object.freeze({ processRoot, tempRoot, cleanup: async (): Promise<void> => undefined });
  }

  let authority: RuntimeStatePhysicalAuthority | null = null;
  try {
    authority = await acquireRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot: roots.stateRoot,
      cacheRoot: roots.cacheRoot,
      requiredDirectories: [roots.testProcessTempLeaseRoot],
      directoryMigrations: runtimeStateWorkspaceGenerationMigrations(roots.workspaceStateRoot)
    });
    const supervisor = await createRetainedTempSupervisor({
      repositoryRoot,
      hostTempRoot,
      environment: input.environment,
      authority,
      invocationKey: input.invocationKey ?? randomUUID()
    });
    const generation = supervisor.prepare(input.environment);
    let settled = false;
    return Object.freeze({
      processRoot: generation.processRoot,
      tempRoot: generation.tempRoot,
      cleanup: async (): Promise<void> => {
        if (settled) return;
        let primary: unknown;
        try {
          await generation.cleanup();
          supervisor.cleanup();
        } catch (error) {
          primary = error;
        }
        if (primary === undefined) {
          try {
            await releaseAuthority(authority);
            authority = null;
          } catch (error) {
            primary = error;
          }
        }
        if (primary === undefined) settled = true;
        if (primary !== undefined) throw primary;
      }
    });
  } catch (error) {
    await releaseAuthority(authority, error);
    throw error;
  }
}

/** Allocates one invocation-owned State/Cache pair and one parent-owned child TMP supervisor. */
export async function createTestInvocationRuntimeRoots(input: Readonly<{
  repositoryRoot: string;
  hostTempRoot: string;
  environment: NodeJS.ProcessEnv;
  invocationKey?: string;
  testOnlyOwnerPid?: number;
  testOnlyProcessAlive?: (pid: number) => 'alive' | 'dead' | 'unknown';
  testOnlyProcessNonce?: string;
  fastTestBatchAdmission?: FastTestBatchExecutionAdmission;
}>): Promise<TestInvocationRuntimeRoots> {
  if (input.fastTestBatchAdmission !== undefined) {
    assertIssuedFastTestBatchExecutionAdmission(input.fastTestBatchAdmission);
  }
  const settlementDeadlineAtUnixMs = input.fastTestBatchAdmission?.logicalDeadlineAtUnixMs;
  const assertSettlementCurrent = (): void => {
    if (settlementDeadlineAtUnixMs !== undefined && Date.now() >= settlementDeadlineAtUnixMs) {
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_CLEANUP_FAILED',
        'SEC test invocation runtime settlement deadline expired.'
      );
    }
  };
  assertSettlementCurrent();
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const roots = resolveWorkspaceRuntimeRoots({ repositoryRoot, environment: input.environment });
  const generationNameValue = `run-${randomBytes(32).toString('hex')}`;
  const stateParentPath = path.join(roots.stateRoot, 'test-invocation-runs', 'records');
  const cacheParentPath = path.join(roots.cacheRoot, 'test-invocation-runs', 'records');
  let authority: RuntimeStatePhysicalAuthority | null = null;
  let runtimeLease: PhysicalMutationLeaseHandle | null = null;
  let state: PhysicalDirectoryChain | null = null;
  let cache: PhysicalDirectoryChain | null = null;
  let supervisor: ReturnType<typeof createParentOwnedTempSupervisor> | null = null;
  let settled = false;

  const cleanup = async (): Promise<void> => {
    if (settled) return;
    assertSettlementCurrent();
    const failures: unknown[] = [];
    for (const settle of [
      () => { supervisor?.cleanup(); supervisor = null; },
      () => { if (cache !== null) { deleteOwnedDirectoryGeneration(cache, 'SEC test invocation Cache generation', settlementDeadlineAtUnixMs); cache = null; } }
    ]) {
      try { settle(); } catch (error) { failures.push(error); }
    }
    // State owns the sealed recovery binding for the other resources.
    if (failures.length === 0 && state !== null) {
      try {
        deleteOwnedDirectoryGeneration(state, 'SEC test invocation State generation', settlementDeadlineAtUnixMs);
        state = null;
      } catch (error) { failures.push(error); }
    }
    if (failures.length === 0) {
      try {
        await authority?.release(
          settlementDeadlineAtUnixMs === undefined ? undefined : { deadlineAtUnixMs: settlementDeadlineAtUnixMs }
        );
        authority = null;
        assertSettlementCurrent();
      } catch (error) { failures.push(error); }
    }
    if (failures.length === 0 && runtimeLease !== null) {
      try {
        runtimeLease.release();
        runtimeLease = null;
        assertSettlementCurrent();
      } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) {
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_CLEANUP_FAILED',
        'SEC test invocation runtime cleanup failed.',
        {
          cause: new AggregateError(failures),
          ...(runtimeLease === null ? {} : {
            pendingRecovery: Object.freeze({
              ownerDigest: sha256(runtimeLease.owner) as TestProcessTempDigest,
              state: state?.target ?? null,
              cache: cache?.target ?? null
            })
          })
        }
      );
    }
    settled = true;
  };

  try {
    const hostTemp = inspectNoFollowDirectoryChain(path.resolve(input.hostTempRoot), 'SEC test OS temp root');
    const repository = inspectNoFollowDirectoryChain(repositoryRoot, 'SEC test repository root');
    assertPhysicallyDisjointDirectoryChains(hostTemp, repository, 'SEC test OS temp root and repository');
    assertLocationOutsidePhysicalRoot(roots.stateRoot, hostTemp, 'Runtime State root');
    assertLocationOutsidePhysicalRoot(roots.cacheRoot, hostTemp, 'Runtime Cache root');
    const invocationKey = input.invocationKey ?? randomUUID();
    const invocationDigest = invocationPhysicalDigest({
      invocationKey,
      workspaceLocatorKey: roots.workspaceLocatorKey,
      repository: repository.target,
      hostTemp: hostTemp.target
    });
    authority = await acquireRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot: roots.stateRoot,
      cacheRoot: roots.cacheRoot,
      requiredDirectories: [stateParentPath, cacheParentPath, roots.testProcessTempLeaseRoot],
      directoryMigrations: [
        ...runtimeStateWorkspaceGenerationMigrations(roots.workspaceStateRoot),
        ...runtimeStateTestInvocationGenerationMigrations(roots.stateRoot, roots.cacheRoot)
      ],
      ...(settlementDeadlineAtUnixMs === undefined ? {} : {
        deadlineAtUnixMs: settlementDeadlineAtUnixMs
      })
    });
    const stateParent = authority.directoryChain(stateParentPath);
    const cacheParent = authority.directoryChain(cacheParentPath);
    const leaseParent = authority.directory(roots.testProcessTempLeaseRoot);
    recoverDeadRuntimeInvocationLeases({
      stateParent,
      cacheParent,
      leaseParent,
      leaseOptions: {
        ...(input.testOnlyOwnerPid === undefined ? {} : { ownerPid: input.testOnlyOwnerPid }),
        ...(input.testOnlyProcessAlive === undefined ? {} : { processAlive: input.testOnlyProcessAlive }),
        ...(input.testOnlyProcessNonce === undefined ? {} : { processNonce: input.testOnlyProcessNonce })
      },
      deadlineAtUnixMs: settlementDeadlineAtUnixMs
    });
    const runtimeScope = generationNameValue.slice('run-'.length);
    const runtimeLeaseName = `runtime-${runtimeScope}-${invocationDigest.slice('sha256:'.length)}.lease`;
    const runtimeLeaseOptions = {
      ...(input.testOnlyOwnerPid === undefined ? {} : { ownerPid: input.testOnlyOwnerPid }),
      ...(input.testOnlyProcessAlive === undefined ? {} : { processAlive: input.testOnlyProcessAlive }),
      ...(input.testOnlyProcessNonce === undefined ? {} : { processNonce: input.testOnlyProcessNonce })
    } satisfies PhysicalMutationLeaseOptions;
    runtimeLease = acquirePhysicalMutationLease(
      leaseParent,
      runtimeLeaseName,
      runtimeLeaseOptions
    );
    if (runtimeLease === null) {
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_OWNED',
        'SEC test invocation paired runtime is owned by another live or unverified process.'
      );
    }
    if (runtimeLease.reclaimedOwner !== null) {
      recoverRuntimeInvocationLeaseSafely({
        lease: runtimeLease,
        stagingScope: runtimeScope,
        invocationDigest,
        stateParent,
        cacheParent,
        leaseParent,
        leaseOptions: runtimeLeaseOptions,
        deadlineAtUnixMs: settlementDeadlineAtUnixMs
      });
      runtimeLease = acquirePhysicalMutationLease(leaseParent, runtimeLeaseName, runtimeLeaseOptions);
      if (runtimeLease === null || runtimeLease.reclaimedOwner !== null) {
        throw new TestProcessTempLifecycleError(
          'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
          'SEC test invocation runtime recovery did not yield a fresh exact owner.'
        );
      }
    }
    state = createStagingGeneration({
      container: stateParent,
      stagingScope: runtimeScope
    });
    supervisor = await createRetainedTempSupervisor({
      repositoryRoot,
      hostTempRoot: input.hostTempRoot,
      environment: input.environment,
      authority,
      invocationKey,
      leaseOptions: runtimeLeaseOptions,
      deadlineAtUnixMs: settlementDeadlineAtUnixMs
    });
    const bindingBytes = publishRuntimeTempParentBinding({
      state,
      invocationDigest,
      owner: runtimeLease.owner,
      hostTemp: hostTemp.target,
      container: supervisor.containerIdentity
    });
    const publishedState = relocateRetainedNoFollowDirectory({
      directory: state.target,
      tombstoneName: runtimeStateGenerationName({
        parent: stateParent.target,
        invocationDigest,
        owner: runtimeLease.owner,
        physical: state.target,
        scope: runtimeScope,
        bindingBytes
      })
    });
    state = Object.freeze({
      target: publishedState,
      ancestors: Object.freeze([...stateParent.ancestors, publishedState])
    });
    cache = createChildGeneration({
      container: cacheParent,
      invocationDigest,
      owner: runtimeLease.owner,
      stagingScope: runtimeScope,
      deadlineAtUnixMs: settlementDeadlineAtUnixMs
    });
    await authority.assertCurrent(
      settlementDeadlineAtUnixMs === undefined ? undefined : { deadlineAtUnixMs: settlementDeadlineAtUnixMs }
    );
    assertPhysicallyDisjointDirectoryChains(state, cache, 'SEC test invocation State and Cache generations');
    return Object.freeze({
      stateRoot: state.target.path,
      cacheRoot: cache.target.path,
      prepareProcessTemp: (environment: NodeJS.ProcessEnv) => {
        assertSettlementCurrent();
        if (supervisor === null) throw new Error('SEC test process temp supervisor is unavailable.');
        const generation = supervisor.prepare(environment);
        return Object.freeze({
          processRoot: generation.processRoot,
          tempRoot: generation.tempRoot,
          cleanup: async (): Promise<void> => {
            assertSettlementCurrent();
            await generation.cleanup();
            assertSettlementCurrent();
          }
        });
      },
      cleanup
    });
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'SEC test invocation runtime preparation and cleanup failed.');
    }
    throw error;
  }
}

/**
 * Prepares the complete Runtime State, Cache and TMP lifecycle for one direct
 * test process. A runner-assigned child adopts its parent's generation and
 * never opens a second physical owner.
 */
export async function prepareTestInvocationRuntime(input: Readonly<{
  repositoryRoot: string;
  hostTempRoot: string;
  environment: NodeJS.ProcessEnv;
  pathBudget?: 'canonical-test-runtime';
}>): Promise<PreparedTestInvocationRuntime> {
  const environmentSnapshot = captureTestInvocationEnvironment(input.environment);
  let invocation: TestInvocationRuntimeRoots | null = null;
  let processTemp: TestProcessTempRoot | null = null;

  const settle = async (): Promise<void> => {
    const failures: unknown[] = [];
    try {
      await processTemp?.cleanup();
    } catch (error) {
      failures.push(error);
    }
    try {
      await invocation?.cleanup();
    } catch (error) {
      failures.push(error);
    } finally {
      restoreTestInvocationEnvironment(input.environment, environmentSnapshot);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'SEC test invocation runtime settlement failed.');
    }
  };

  try {
    const enforceCanonicalPathBudget = input.pathBudget === 'canonical-test-runtime';
    if (enforceCanonicalPathBudget
        && input.environment[TEST_PROCESS_TEMP_ASSIGNMENT_ENV] === undefined) {
      assertPlannedTestProcessTempPathBudget(input.hostTempRoot);
    }
    const assigned = consumeTestProcessTempAssignment({
      environment: input.environment,
      ...(enforceCanonicalPathBudget ? { pathBudget: 'canonical-test-runtime' as const } : {})
    });
    if (assigned !== null) {
      processTemp = assigned;
      const stateRoot = requireAssignedRuntimeRoot(input.environment, 'SEC_STATE_HOME');
      const cacheRoot = requireAssignedRuntimeRoot(input.environment, 'SEC_CACHE_HOME');
      return Object.freeze({
        ownership: 'parent-assigned',
        stateRoot,
        cacheRoot,
        processRoot: assigned.processRoot,
        tempRoot: assigned.tempRoot,
        cleanup: settle
      });
    }

    invocation = await createTestInvocationRuntimeRoots(input);
    input.environment.SEC_STATE_HOME = invocation.stateRoot;
    input.environment.SEC_CACHE_HOME = invocation.cacheRoot;
    processTemp = invocation.prepareProcessTemp(input.environment);
    return Object.freeze({
      ownership: 'direct',
      stateRoot: invocation.stateRoot,
      cacheRoot: invocation.cacheRoot,
      processRoot: processTemp.processRoot,
      tempRoot: processTemp.tempRoot,
      cleanup: settle
    });
  } catch (error) {
    try {
      await settle();
    } catch (settlementError) {
      throw new AggregateError(
        [error, settlementError],
        'SEC test invocation runtime preparation and settlement failed.'
      );
    }
    throw error;
  }
}
