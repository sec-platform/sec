import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  acquirePhysicalMutationLease,
  type PhysicalMutationLeaseOptions,
  type PhysicalMutationLeaseOwner
} from '../../runtime-state/physical/runtime/mutation-lease.ts';
import {
  assertPhysicallyDisjointDirectoryChains,
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowDirectory,
  createNoFollowDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryChild,
  physicallyContainsDirectoryChain,
  relocateRetainedNoFollowDirectory,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeMetadata,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../runtime-state/workspace-state/paths.ts';
import {
  acquireSecRuntimeStatePhysicalAuthority,
  type SecRuntimeStatePhysicalAuthority
} from '../../runtime-state/workspace-state/physical-authority.ts';
import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { parseExactJson } from '../../system-architecture/foundation/runtime/exact-json.ts';

const TEST_PROCESS_TEMP_ASSIGNMENT_ENV = 'SEC_TEST_PROCESS_TEMP_ASSIGNMENT_V1';
const TEST_PROCESS_TEMP_ASSIGNMENT_SCHEMA = 'sec-test-process-temp-assignment-v1';
const TEST_PROCESS_TEMP_CONTAINER = 't';
const TEST_PROCESS_TEMP_STAGING_PREFIX = 's';
const TEST_PROCESS_TEMP_GENERATION_PREFIX = 'g';
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

  constructor(code: TestProcessTempLifecycleError['code'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TestProcessTempLifecycleError';
    this.code = code;
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

function retireDirectoryTree(parent: PhysicalDirectoryIdentity, root: PhysicalDirectoryIdentity): void {
  const inventory = scanNoFollowDirectoryTreeMetadata(root, {
    deadlineAtMs: performance.now() + TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS,
    maximumEntries: TEST_RUNTIME_CLEANUP_MAXIMUM_ENTRIES
  });
  retireNoFollowDirectoryTree({
    deadlineAtMonotonicMs: performance.now() + TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS,
    inventory,
    parent,
    root
  });
}

function deleteOwnedDirectoryGeneration(generation: PhysicalDirectoryChain, label: string): void {
  const parent = generation.ancestors.at(-2);
  if (parent === undefined) throw new Error(`${label} has no retained parent.`);
  retireDirectoryTree(parent, generation.target);
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

function topLevelInventory(root: PhysicalDirectoryIdentity) {
  return scanNoFollowDirectoryTreeMetadata(root, {
    deadlineAtMs: performance.now() + TEST_RUNTIME_CLEANUP_SCAN_BUDGET_MS,
    maximumEntries: TEST_RUNTIME_CLEANUP_MAXIMUM_ENTRIES
  }).filter(({ relativePath }) => !relativePath.includes('/'));
}

function recoverReclaimedGeneration(input: Readonly<{
  container: PhysicalDirectoryIdentity;
  invocationDigest: TestProcessTempDigest;
  owner: PhysicalMutationLeaseOwner;
}>): void {
  const entries = topLevelInventory(input.container);
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
    retireDirectoryTree(input.container, retained);
  }
}

function assertInvocationContainerEmpty(container: PhysicalDirectoryIdentity): void {
  if (topLevelInventory(container).length > 0) {
    throw new TestProcessTempLifecycleError(
      'TEST_PROCESS_TEMP_RESIDUE_UNKNOWN',
      'SEC test process temp container is not empty after owner recovery.'
    );
  }
}

function createChildGeneration(input: Readonly<{
  container: PhysicalDirectoryChain;
  invocationDigest: TestProcessTempDigest;
  owner: PhysicalMutationLeaseOwner;
}>): PhysicalDirectoryChain {
  const stagingName = `${TEST_PROCESS_TEMP_STAGING_PREFIX}${randomBytes(12).toString('hex')}`;
  const staging = createExclusiveOwnedDirectoryGeneration(input.container, stagingName);
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
      deleteOwnedDirectoryGeneration(staging, 'SEC test process temp staging generation');
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
}>): Readonly<{
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
        owner: lease.reclaimedOwner
      });
    }
    assertInvocationContainerEmpty(container.target);
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
    deleteOwnedDirectoryGeneration(generation, 'SEC test process temp generation');
    active.delete(generation.target.path);
  };

  return Object.freeze({
    prepare(environment): TestProcessTempRoot {
      if (settlementStarted) throw new Error('SEC test process temp supervisor is settling or settled.');
      const generation = createChildGeneration({
        container,
        invocationDigest: input.invocationDigest,
        owner: lease.owner
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
          deleteOwnedDirectoryGeneration(container, 'SEC test process temp invocation container');
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
export function consumeTestProcessTempAssignmentV1(input: Readonly<{
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
  authority: SecRuntimeStatePhysicalAuthority | null,
  primary?: unknown
): Promise<void> {
  if (authority === null) {
    if (primary !== undefined) throw primary;
    return;
  }
  try {
    await authority.release();
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
  authority: SecRuntimeStatePhysicalAuthority;
  invocationKey: string;
  leaseOptions?: PhysicalMutationLeaseOptions;
}>): Promise<ReturnType<typeof createParentOwnedTempSupervisor>> {
  const roots = resolveSecWorkspaceRuntimeRoots({
    repositoryRoot: input.repositoryRoot,
    environment: input.environment
  });
  const hostTemp = inspectNoFollowDirectoryChain(input.hostTempRoot, 'SEC test OS temp root');
  const repository = inspectNoFollowDirectoryChain(input.repositoryRoot, 'SEC test repository root');
  assertPhysicallyDisjointDirectoryChains(hostTemp, repository, 'SEC test OS temp root and repository');
  assertLocationOutsidePhysicalRoot(roots.stateRoot, hostTemp, 'Runtime State root');
  assertLocationOutsidePhysicalRoot(roots.cacheRoot, hostTemp, 'Runtime Cache root');
  const physicalIdentity = (value: PhysicalDirectoryIdentity) => Object.freeze({
    device: value.device,
    inode: value.inode,
    objectId: value.objectId
  });
  const invocationDigest = sha256(Object.freeze({
    schema: 'sec-test-process-temp-invocation-binding-v1',
    invocationKey: requireInvocationKey(input.invocationKey),
    workspaceLocatorKey: roots.workspaceLocatorKey,
    repository: physicalIdentity(repository.target),
    hostTemp: physicalIdentity(hostTemp.target)
  })) as TestProcessTempDigest;
  return createParentOwnedTempSupervisor({
    containerParent: hostTemp,
    containerName: `${TEST_PROCESS_TEMP_CONTAINER}${digestLocator(invocationDigest)}`,
    invocationDigest,
    leaseName: `invocation-${invocationDigest.slice('sha256:'.length)}.lease`,
    leaseParent: input.authority.directory(roots.testProcessTempLeaseRoot),
    leaseOptions: input.leaseOptions
  });
}

/**
 * Creates one parent-owned temporary generation outside repository, Runtime
 * State and Runtime Cache. Runtime State owns only the workspace-scoped lease;
 * the OS temporary root remains disposable data.
 */
export async function createTestProcessTempRootV1(input: Readonly<{
  repositoryRoot: string;
  hostTempRoot: string;
  environment: NodeJS.ProcessEnv;
  invocationKey?: string;
}>): Promise<TestProcessTempRoot> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const hostTempRoot = path.resolve(input.hostTempRoot);
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment: input.environment });
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

  let authority: SecRuntimeStatePhysicalAuthority | null = null;
  try {
    authority = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot: roots.stateRoot,
      cacheRoot: roots.cacheRoot,
      requiredDirectories: [roots.testProcessTempLeaseRoot]
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
}>): Promise<TestInvocationRuntimeRoots> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment: input.environment });
  const generationNameValue = `run-${randomBytes(32).toString('hex')}`;
  const stateParentPath = path.join(roots.stateRoot, 'test-invocation-runs', 'v1');
  const cacheParentPath = path.join(roots.cacheRoot, 'test-invocation-runs', 'v1');
  let authority: SecRuntimeStatePhysicalAuthority | null = null;
  let state: PhysicalDirectoryChain | null = null;
  let cache: PhysicalDirectoryChain | null = null;
  let supervisor: ReturnType<typeof createParentOwnedTempSupervisor> | null = null;
  let settled = false;

  const cleanup = async (): Promise<void> => {
    if (settled) return;
    const failures: unknown[] = [];
    for (const settle of [
      () => { supervisor?.cleanup(); supervisor = null; },
      () => { if (cache !== null) { deleteOwnedDirectoryGeneration(cache, 'SEC test invocation Cache generation'); cache = null; } },
      () => { if (state !== null) { deleteOwnedDirectoryGeneration(state, 'SEC test invocation State generation'); state = null; } }
    ]) {
      try { settle(); } catch (error) { failures.push(error); }
    }
    if (failures.length === 0) {
      try { await authority?.release(); authority = null; } catch (error) { failures.push(error); }
    }
    if (failures.length > 0) {
      throw new TestProcessTempLifecycleError(
        'TEST_PROCESS_TEMP_CLEANUP_FAILED',
        'SEC test invocation runtime cleanup failed.',
        { cause: new AggregateError(failures) }
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
    authority = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot: roots.stateRoot,
      cacheRoot: roots.cacheRoot,
      requiredDirectories: [stateParentPath, cacheParentPath, roots.testProcessTempLeaseRoot]
    });
    supervisor = await createRetainedTempSupervisor({
      repositoryRoot,
      hostTempRoot: input.hostTempRoot,
      environment: input.environment,
      authority,
      invocationKey: input.invocationKey ?? randomUUID(),
      leaseOptions: {
        ...(input.testOnlyOwnerPid === undefined ? {} : { ownerPid: input.testOnlyOwnerPid }),
        ...(input.testOnlyProcessAlive === undefined ? {} : { processAlive: input.testOnlyProcessAlive }),
        ...(input.testOnlyProcessNonce === undefined ? {} : { processNonce: input.testOnlyProcessNonce })
      }
    });
    state = createExclusiveOwnedDirectoryGeneration(authority.directoryChain(stateParentPath), generationNameValue);
    cache = createExclusiveOwnedDirectoryGeneration(authority.directoryChain(cacheParentPath), generationNameValue);
    await authority.assertCurrent();
    assertPhysicallyDisjointDirectoryChains(state, cache, 'SEC test invocation State and Cache generations');
    return Object.freeze({
      stateRoot: state.target.path,
      cacheRoot: cache.target.path,
      prepareProcessTemp: (environment: NodeJS.ProcessEnv) => {
        if (supervisor === null) throw new Error('SEC test process temp supervisor is unavailable.');
        return supervisor.prepare(environment);
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
    const assigned = consumeTestProcessTempAssignmentV1({
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
