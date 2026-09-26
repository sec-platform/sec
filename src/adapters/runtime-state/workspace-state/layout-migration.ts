import path from 'node:path';

import {
  inspectExactNoFollowDirectoryPresence,
  relocateRetainedNoFollowDirectory,
  scanNoFollowDirectoryDirectMetadata,
  type PhysicalDirectoryIdentity
} from '../physical/runtime/physical-no-follow.ts';

export type RuntimeStateDirectoryMigrationOutcome =
  | 'absent'
  | 'current'
  | 'migrated'
  | 'migrated-by-peer';

export type RuntimeStateDirectoryGenerationSelection = Readonly<{
  kind: 'current' | 'legacy';
  path: string;
}>;

export interface RuntimeStateDirectoryMigrationSpec {
  readonly label: string;
  readonly legacyPath: string;
  readonly currentPath: string;
  readonly mode?: 'empty-only' | 'quiescent';
}

export function runtimeStateRootGenerationMigrations(
  stateRoot: string
): readonly RuntimeStateDirectoryMigrationSpec[] {
  const root = path.resolve(stateRoot);
  return Object.freeze([
    Object.freeze({
      label: 'workspace records',
      legacyPath: path.join(root, 'workspaces', 'v1'),
      currentPath: path.join(root, 'workspaces', 'records')
    }),
    Object.freeze({
      label: 'workspace locators',
      legacyPath: path.join(root, 'workspace-locators', 'v1'),
      currentPath: path.join(root, 'workspace-locators', 'records')
    }),
    Object.freeze({
      label: 'operation leases',
      legacyPath: path.join(root, 'operation-leases', 'v1'),
      currentPath: path.join(root, 'operation-leases', 'locks')
    })
  ]);
}

export function runtimeStateWorkspaceGenerationMigrations(
  workspaceStateRoot: string
): readonly RuntimeStateDirectoryMigrationSpec[] {
  const root = path.resolve(workspaceStateRoot);
  return Object.freeze([
    Object.freeze({
      label: 'test process temp leases',
      legacyPath: path.join(root, 'test-process-temp', 'v1'),
      currentPath: path.join(root, 'test-process-temp', 'leases')
    }),
    Object.freeze({
      label: 'verification session journal',
      legacyPath: path.join(root, 'verification-sessions', 'v2'),
      currentPath: path.join(root, 'verification-sessions', 'journal')
    })
  ]);
}

export function runtimeStateTestInvocationGenerationMigrations(
  stateRoot: string,
  cacheRoot: string
): readonly RuntimeStateDirectoryMigrationSpec[] {
  return Object.freeze([
    Object.freeze({
      label: 'test invocation state records',
      legacyPath: path.join(path.resolve(stateRoot), 'test-invocation-runs', 'v1'),
      currentPath: path.join(path.resolve(stateRoot), 'test-invocation-runs', 'records')
    }),
    Object.freeze({
      label: 'test invocation cache records',
      legacyPath: path.join(path.resolve(cacheRoot), 'test-invocation-runs', 'v1'),
      currentPath: path.join(path.resolve(cacheRoot), 'test-invocation-runs', 'records')
    })
  ]);
}

function samePhysicalIdentity(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

export function selectRuntimeStateDirectoryGeneration(
  input: RuntimeStateDirectoryMigrationSpec
): RuntimeStateDirectoryGenerationSelection {
  assertSameParent(input);
  const legacyPath = path.resolve(input.legacyPath);
  const currentPath = path.resolve(input.currentPath);
  const legacy = inspectExactNoFollowDirectoryPresence(
    legacyPath,
    `Runtime State ${input.label} legacy directory`
  );
  const current = inspectExactNoFollowDirectoryPresence(
    currentPath,
    `Runtime State ${input.label} current directory`
  );
  if (legacy.state === 'present' && current.state === 'present') {
    throw new Error(`Runtime State ${input.label} current and legacy directories both exist.`);
  }
  return legacy.state === 'present'
    ? Object.freeze({ kind: 'legacy' as const, path: legacyPath })
    : Object.freeze({ kind: 'current' as const, path: currentPath });
}

function assertSameParent(input: RuntimeStateDirectoryMigrationSpec): void {
  const legacyParent = path.resolve(path.dirname(input.legacyPath));
  const currentParent = path.resolve(path.dirname(input.currentPath));
  if (legacyParent !== currentParent) {
    throw new Error(`Runtime State ${input.label} migration must remain within one parent directory.`);
  }
  if (path.basename(input.legacyPath) === path.basename(input.currentPath)) {
    throw new Error(`Runtime State ${input.label} migration must change the directory name.`);
  }
}

/**
 * Atomically replaces one historical numeric generation directory with its
 * semantic successor. The relocation is same-parent and no-replace, so the
 * whole generation moves as one filesystem object instead of being copied or
 * reconstructed. A concurrent peer migration is accepted only when the
 * successor is the exact physical directory observed as legacy by this caller.
 */
export function migrateRuntimeStateDirectoryGeneration(
  input: RuntimeStateDirectoryMigrationSpec
): RuntimeStateDirectoryMigrationOutcome {
  assertSameParent(input);
  const legacyPath = path.resolve(input.legacyPath);
  const currentPath = path.resolve(input.currentPath);
  const initialLegacy = inspectExactNoFollowDirectoryPresence(
    legacyPath,
    `Runtime State ${input.label} legacy directory`
  );
  const initialCurrent = inspectExactNoFollowDirectoryPresence(
    currentPath,
    `Runtime State ${input.label} current directory`
  );

  if (initialLegacy.state === 'present' && initialCurrent.state === 'present') {
    throw new Error(`Runtime State ${input.label} current and legacy directories both exist.`);
  }
  if (initialLegacy.state === 'absent') {
    return initialCurrent.state === 'present' ? 'current' : 'absent';
  }

  if ((input.mode ?? 'empty-only') === 'empty-only') {
    const entries = scanNoFollowDirectoryDirectMetadata(initialLegacy.directory.target, {
      deadlineAtMs: performance.now() + 5_000,
      maximumEntries: 1
    });
    if (entries.length !== 0) {
      throw new Error(`Runtime State ${input.label} legacy directory is non-empty and requires quiescent migration.`);
    }
  }

  try {
    const moved = relocateRetainedNoFollowDirectory({
      directory: initialLegacy.directory.target,
      tombstoneName: path.basename(currentPath)
    });
    const legacyReadback = inspectExactNoFollowDirectoryPresence(
      legacyPath,
      `Runtime State ${input.label} legacy readback`
    );
    const currentReadback = inspectExactNoFollowDirectoryPresence(
      currentPath,
      `Runtime State ${input.label} current readback`
    );
    if (legacyReadback.state !== 'absent'
        || currentReadback.state !== 'present'
        || !samePhysicalIdentity(moved, currentReadback.directory.target)) {
      throw new Error(`Runtime State ${input.label} migration readback failed.`);
    }
    return 'migrated';
  } catch (error) {
    const legacyReadback = inspectExactNoFollowDirectoryPresence(
      legacyPath,
      `Runtime State ${input.label} concurrent legacy readback`
    );
    const currentReadback = inspectExactNoFollowDirectoryPresence(
      currentPath,
      `Runtime State ${input.label} concurrent current readback`
    );
    if (legacyReadback.state === 'absent'
        && currentReadback.state === 'present'
        && samePhysicalIdentity(initialLegacy.directory.target, currentReadback.directory.target)) {
      return 'migrated-by-peer';
    }
    throw error;
  }
}

export function migrateRuntimeStateDirectoryGenerations(
  migrations: readonly RuntimeStateDirectoryMigrationSpec[]
): ReadonlyMap<string, RuntimeStateDirectoryMigrationOutcome> {
  const result = new Map<string, RuntimeStateDirectoryMigrationOutcome>();
  for (const migration of migrations) {
    if (result.has(migration.label)) {
      throw new Error(`Runtime State directory migration label is duplicated: ${migration.label}`);
    }
    result.set(migration.label, migrateRuntimeStateDirectoryGeneration(migration));
  }
  return result;
}
