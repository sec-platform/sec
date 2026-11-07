import path from 'node:path';
import { sha256 } from '../../../../contracts/canonical.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowRandomDirectory,
  physicallyContainsDirectoryChain,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryDirectMetadata,
  scanNoFollowDirectoryTreeMetadata,
  type NoFollowDirectoryTreeRetirementReceipt,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from './physical-no-follow.ts';

const CLEANUP_DURATION_MS = 10_000;
const CLEANUP_MAXIMUM_ENTRIES = 100_000;
const outputBrand: unique symbol = Symbol('repository-derived-output');

export interface RepositoryDerivedOutput {
  readonly [outputBrand]: never;
  readonly path: string;
  readonly root: PhysicalDirectoryIdentity;
}

type OutputState = {
  readonly parent: PhysicalDirectoryIdentity;
  readonly chain: PhysicalDirectoryChain;
  claimed: boolean;
  active: boolean;
  retired: boolean;
};
const outputs = new WeakMap<object, OutputState>();

function requireOutput(scope: RepositoryDerivedOutput): OutputState {
  const state = outputs.get(scope);
  if (state === undefined || state.retired) throw new Error('Derived output requires a live owner-issued scope.');
  return state;
}

function assertOutputCurrent(state: OutputState): void {
  assertSameNoFollowDirectoryIdentity(state.parent, 'Repository derived output parent');
  assertSameNoFollowDirectoryIdentity(state.chain.target, 'Repository derived output');
}

function assertEmpty(state: OutputState): void {
  const entries = scanNoFollowDirectoryDirectMetadata(state.chain.target, {
    deadlineAtMs: performance.now() + CLEANUP_DURATION_MS,
    maximumEntries: 1
  });
  if (entries.length !== 0) throw new Error('Repository derived output must be empty before observation.');
}

/** Ownership begins at exclusive creation, never by adopting an existing path. */
export function createRepositoryDerivedOutput(parent: PhysicalDirectoryChain): RepositoryDerivedOutput {
  const currentParent = assertSameNoFollowDirectoryIdentity(parent.target, 'Repository derived output parent');
  const root = createExclusiveNoFollowRandomDirectory(currentParent.target, 'derived-');
  const chain: PhysicalDirectoryChain = Object.freeze({ target: root,
    ancestors: Object.freeze([...currentParent.ancestors, root]) });
  const scope: RepositoryDerivedOutput = Object.freeze({ [outputBrand]: undefined as never, path: root.path, root });
  outputs.set(scope, { parent: currentParent.target, chain, claimed: false, active: false, retired: false });
  return scope;
}

/** Internal observer lease. Its fields are derived from physical roots, never caller exclusions. */
export type RepositoryDerivedOutputObservation = Readonly<{
  identityDigest: `sha256:${string}`;
  relativePaths: readonly (string | null)[];
  assertCurrent(): void;
  release(): void;
}>;

export function claimRepositoryDerivedOutput(
  scope: RepositoryDerivedOutput,
  roots: readonly PhysicalDirectoryChain[]
): RepositoryDerivedOutputObservation {
  const state = requireOutput(scope);
  if (state.claimed) throw new Error('Repository derived output scope has already been used.');
  assertOutputCurrent(state);
  assertEmpty(state);
  const relativePaths = roots.map(root => {
    if (physicallyContainsDirectoryChain(state.chain, root)) {
      throw new Error('Repository derived output cannot contain or equal an observed input root.');
    }
    if (!physicallyContainsDirectoryChain(root, state.chain)) return null;
    const relative = path.relative(root.target.path, scope.path).replaceAll('\\', '/');
    if (relative === '' || relative.startsWith('../') || path.isAbsolute(relative)) {
      throw new Error('Repository derived output must be strictly inside an observed root.');
    }
    return relative;
  });
  if (relativePaths.filter(value => value !== null).length !== 1) {
    throw new Error('Repository derived output must belong to exactly one observed root.');
  }
  const identityDigest = sha256({ domain: 'repository-derived-output-observation',
    eventPolicy: 'strict-descendants-and-owned-root-modified',
    parent: state.parent, chain: state.chain, relativePaths }) as `sha256:${string}`;
  state.claimed = true;
  state.active = true;
  let released = false;
  return Object.freeze({
    identityDigest,
    relativePaths: Object.freeze(relativePaths),
    assertCurrent: () => {
      if (released || state.retired) throw new Error('Repository derived output observation has ended.');
      assertOutputCurrent(state);
    },
    release: () => {
      if (released) return;
      released = true;
      state.active = false;
    }
  });
}

export function retireRepositoryDerivedOutput(scope: RepositoryDerivedOutput): NoFollowDirectoryTreeRetirementReceipt {
  const state = requireOutput(scope);
  if (state.active) throw new Error('Repository derived output observation remains pending.');
  assertOutputCurrent(state);
  const deadline = performance.now() + CLEANUP_DURATION_MS;
  const inventory = scanNoFollowDirectoryTreeMetadata(state.chain.target, {
    deadlineAtMs: deadline, maximumEntries: CLEANUP_MAXIMUM_ENTRIES, includePermissionMode: true
  });
  const receipt = retireNoFollowDirectoryTree({ parent: state.parent, root: state.chain.target, inventory,
    deadlineAtMonotonicMs: deadline, restoreOwnerPermissions: true });
  state.retired = true;
  return receipt;
}
