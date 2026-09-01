import fs from 'node:fs/promises';
import path from 'node:path';
import {
  generatedStateDigest
} from '../../../../runtime-state/generated-state/contract.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryChild,
  inspectNoFollowLinkEntry,
  inspectNoFollowOrdinaryFileEntry,
  PhysicalNoFollowError,
  publishExclusiveDurableCanonicalFile,
  readNoFollowOrdinaryFile,
  replaceDurableCanonicalFile,
  scanNoFollowDirectoryTree,
  type PhysicalDirectoryIdentity
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  SecError
} from '../../../../system-architecture/foundation/contract/failure.ts';
import {
  canonicalJson,
  compareCodeUnits
} from '../../../../system-architecture/foundation/runtime/canonical.ts';
import {
  formatJsonFile
} from '../../../../workspace/files.ts';
import {
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationRemainingMs,
  type RuntimeDependencyOperationContext,
  type RuntimeDependencyOperationOptions
} from '../operation-context.ts';
import {
  assertDependencyTransitionPointerBytes,
  DEPENDENCY_TRANSITION_POINTER_SCHEMA,
  parseDependencyTransitionRecord
} from './codec.ts';
import {
  generatedStatePhysicalIdentity,
  sameGeneratedStateIdentity,
  transitionAbsentSlot,
  transitionSlotFromPhysical,
  type DependencyTransitionJournal,
  type DependencyTransitionNamespace,
  type DependencyTransitionSlot
} from './contract.ts';

export const DEPENDENCY_TRANSITION_RECORD_CAPACITY = 10_000;

// Transition records are small canonical journal envelopes.  Reading their
// bounded bytes in one retained no-follow census avoids reopening every leaf
// after a metadata scan (O(records x phase writes)) while keeping the ledger
// memory/deadline contract explicit.  Dependency trees use the streaming
// inventory path and never enter this budget.
export const DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY = 64 * 1024 * 1024;

export const DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY = DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY;

export function dependencyTransitionNamespacePaths(ownerRoot: string): Readonly<{
  backupRoot: string;
  journalRoot: string;
  recordsRoot: string;
  rolloversRoot: string;
}> {
  const backupRoot = path.join(ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups');
  const journalRoot = path.join(backupRoot, '.dependency-transition-v2');
  return Object.freeze({
    backupRoot,
    journalRoot,
    recordsRoot: path.join(journalRoot, 'records'),
    rolloversRoot: path.join(journalRoot, 'rollovers')
  });
}

export function writeDurableTransitionFile(
  parent: PhysicalDirectoryIdentity,
  name: string,
  bytes: Uint8Array,
  validate: (candidate: Uint8Array) => void,
  immutable = false,
  expectedExisting?: Readonly<{ device: string; inode: string }> | null
): void {
  const existing = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (immutable && existing !== null) {
    const current = readNoFollowOrdinaryFile(parent, name);
    if (current === null) {
      throw new SecError('RUNTIME-DEPS-002', 'Immutable dependency transition record disappeared before reuse');
    }
    validate(current);
    if (!Buffer.from(current).equals(Buffer.from(bytes))) {
      throw new SecError('RUNTIME-DEPS-002', 'Immutable dependency transition record collides with different canonical bytes', {
        path: path.join(parent.path, name)
      });
    }
    return;
  }
  if (expectedExisting !== undefined) {
    replaceDurableCanonicalFile({ parent, name, bytes, validate, expectedExisting });
    return;
  }
  if (existing === null) {
    publishExclusiveDurableCanonicalFile({ parent, name, bytes, validate });
  } else {
    replaceDurableCanonicalFile({ parent, name, bytes, validate });
  }
}

export async function ensureDependencyTransitionNamespace(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionNamespace> {
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition namespace creation');
  const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Dependency transition owner root').target;
  const paths = dependencyTransitionNamespacePaths(owner.path);
  // This is the only namespace creation route. Existing names are reopened
  // without following links, so a foreign/reparse path fails closed.
  const backupRoot = createNoFollowOrdinaryDirectoryChain(owner, [
    '.tmp', 'dependency-installs', 'compiler-backups'
  ]);
  const journalRoot = createNoFollowOrdinaryDirectoryChain(backupRoot, [
    '.dependency-transition-v2'
  ]);
  const recordsRoot = createNoFollowOrdinaryDirectoryChain(journalRoot, ['records']);
  const rolloversRoot = createNoFollowOrdinaryDirectoryChain(journalRoot, ['rollovers']);
  if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
    paths.recordsRoot !== recordsRoot.path || paths.rolloversRoot !== rolloversRoot.path) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition namespace path normalization changed');
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition namespace creation readback');
  return Object.freeze({ ownerRoot: owner, backupRoot, journalRoot, recordsRoot, rolloversRoot });
}

export function inspectDependencyTransitionNamespace(
  ownerRoot: string
): DependencyTransitionNamespace | null {
  try {
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Dependency transition owner root').target;
    const paths = dependencyTransitionNamespacePaths(owner.path);
    const backupRoot = inspectNoFollowDirectoryChain(paths.backupRoot, 'Dependency transition backup root').target;
    const journalRoot = inspectNoFollowDirectoryChain(paths.journalRoot, 'Dependency transition journal root').target;
    const recordsRoot = inspectNoFollowDirectoryChain(paths.recordsRoot, 'Dependency transition records root').target;
    let rolloversRoot: PhysicalDirectoryIdentity | null;
    try {
      rolloversRoot = inspectNoFollowDirectoryChain(paths.rolloversRoot, 'Dependency transition rollovers root').target;
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
        // Older journals predate bounded ledger rollover.  The writer creates
        // this optional owner-local namespace before its first rollover; a
        // read-only inspection must remain effect-free.
        rolloversRoot = null;
      } else {
        throw error;
      }
    }
    if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
        paths.recordsRoot !== recordsRoot.path ||
        (rolloversRoot !== null && paths.rolloversRoot !== rolloversRoot.path)) {
      throw new SecError('RUNTIME-DEPS-002', 'Dependency transition namespace path normalization changed');
    }
    return Object.freeze({ ownerRoot: owner, backupRoot, journalRoot, recordsRoot, rolloversRoot });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}
export async function readNoFollowDirectNames(
  directory: PhysicalDirectoryIdentity,
  label: string,
  maximumEntries: number,
  options: RuntimeDependencyOperationOptions
): Promise<readonly string[]> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  const before = assertSameNoFollowDirectoryIdentity(directory, `${label} before read`).target;
  const names = await fs.readdir(before.path, 'utf8');
  runtimeDependencyOperationRemainingMs(options, `${label} readback`);
  if (names.length > maximumEntries) {
    throw new SecError('RUNTIME-DEPS-004', `${label} entry capacity exceeded`, {
      maximumEntries,
      observedEntries: names.length
    });
  }
  const after = assertSameNoFollowDirectoryIdentity(directory, `${label} after read`).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(before),
    generatedStatePhysicalIdentity(after)
  )) {
    throw new SecError('RUNTIME-DEPS-004', `${label} identity changed during direct read`);
  }
  return Object.freeze(names.sort(compareCodeUnits));
}

export function dependencyTransitionLedgerDigest(
  records: ReadonlyMap<`sha256:${string}`, Readonly<{ recordDigest: `sha256:${string}` }>>
): `sha256:${string}` {
  // Each immutable record digest already binds its canonical bytes.  The
  // ordered digest set therefore forms a compact, content-addressed ledger
  // receipt without rereading every record when a rollover phase advances.
  return generatedStateDigest(Object.freeze({
    schema: 'sec-dependency-transition-ledger-v1',
    recordDigests: Object.freeze([...records.keys()].sort(compareCodeUnits))
  }));
}

export function inspectOptionalNoFollowDirectoryChild(
  parent: PhysicalDirectoryIdentity,
  name: string,
  label: string
): PhysicalDirectoryIdentity | null {
  try {
    return inspectNoFollowDirectoryChild(parent, name, label);
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}

export type DependencyTransitionRecordSet = Readonly<{
  readonly records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournal>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly tip: DependencyTransitionJournal | null;
}>;

/**
 * Read and validate one immutable records root under one fixed deadline.  This
 * helper is also used by rollover recovery while the old root is still the
 * source of truth; recovery must not call the normal reader because that
 * reader intentionally blocks whenever an active rollover exists.
 */
export function readDependencyTransitionRecordSet(
  recordsRoot: PhysicalDirectoryIdentity,
  ownerRoot: string,
  operation: RuntimeDependencyOperationContext,
  label: string
): DependencyTransitionRecordSet {
  const before = assertSameNoFollowDirectoryIdentity(recordsRoot, `${label} before census`).target;
  // Records are bounded canonical control bytes.  Keep one retained
  // no-follow traversal and parse the bytes it already read instead of doing
  // a second path lookup for every record.  The aggregate byte ceiling is
  // part of admission, so a forged large/unknown record cannot turn this
  // optimization into an unbounded read.
  const census = scanNoFollowDirectoryTree(before, {
    deadlineAtMs: operation.deadlineAtMonotonicMs,
    maximumEntries: DEPENDENCY_TRANSITION_RECORD_CAPACITY,
    maximumBytes: DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY
  });
  const records = new Map<`sha256:${string}`, DependencyTransitionJournal>();
  for (const entry of census) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its read deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (entry.kind !== 'file' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} contains an unknown physical entry`);
    }
    if (entry.bytes === null) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record disappeared during census`);
    }
    const record = parseDependencyTransitionRecord(entry.bytes, entry.relativePath);
    if (record.ownerRoot !== ownerRoot) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record belongs to a foreign owner root`);
    }
    if (records.has(record.recordDigest)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record digest is duplicated`);
    }
    records.set(record.recordDigest, record);
  }
  if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
    throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its read deadline after record validation`, {
      deadlineAtMs: operation.deadlineAtMonotonicMs,
      observedEntries: records.size
    });
  }
  const after = assertSameNoFollowDirectoryIdentity(recordsRoot, `${label} after census`).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(before),
    generatedStatePhysicalIdentity(after)
  )) {
    throw new SecError('RUNTIME-DEPS-002', `${label} identity changed during census`);
  }
  if (records.size === 0) {
    return Object.freeze({
      records,
      ledgerDigest: dependencyTransitionLedgerDigest(records),
      tip: null
    });
  }

  // The immutable ledger is a single predecessor chain.  A mutable pointer
  // is never consulted to select either the root or the maximal tip.
  const children = new Map<`sha256:${string}`, `sha256:${string}`>();
  const roots: DependencyTransitionJournal[] = [];
  for (const record of records.values()) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its graph-validation deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (record.previousRecordDigest === null) {
      if (record.sequence !== 1) {
        throw new SecError('RUNTIME-DEPS-002', `${label} root record sequence is not one`);
      }
      roots.push(record);
      continue;
    }
    const predecessor = records.get(record.previousRecordDigest);
    if (predecessor === undefined || predecessor.sequence !== record.sequence - 1) {
      throw new SecError('RUNTIME-DEPS-002', `${label} predecessor is missing or has an invalid sequence`);
    }
    const previousChild = children.get(record.previousRecordDigest);
    if (previousChild !== undefined && previousChild !== record.recordDigest) {
      throw new SecError('RUNTIME-DEPS-002', `${label} predecessor has a forked child chain`);
    }
    children.set(record.previousRecordDigest, record.recordDigest);
  }
  if (roots.length !== 1) {
    throw new SecError('RUNTIME-DEPS-002', `${label} contains multiple immutable epochs`);
  }
  const visited = new Set<`sha256:${string}`>();
  let cursor: DependencyTransitionJournal | undefined = roots[0];
  while (cursor !== undefined) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its chain-validation deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (visited.has(cursor.recordDigest)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} chain contains a cycle`);
    }
    visited.add(cursor.recordDigest);
    const childDigest = children.get(cursor.recordDigest);
    cursor = childDigest === undefined ? undefined : records.get(childDigest);
    if (childDigest !== undefined && cursor === undefined) {
      throw new SecError('RUNTIME-DEPS-002', `${label} child disappeared during immutable census`);
    }
  }
  if (visited.size !== records.size) {
    throw new SecError('RUNTIME-DEPS-002', `${label} contains a disconnected or foreign fork`);
  }
  const tips = [...records.values()].filter(({ recordDigest }) => !children.has(recordDigest));
  if (tips.length !== 1) {
    throw new SecError('RUNTIME-DEPS-002', `${label} does not have one maximal immutable tip`);
  }
  if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
    throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its final read deadline`, {
      deadlineAtMs: operation.deadlineAtMonotonicMs,
      observedEntries: records.size
    });
  }
  return Object.freeze({
    records,
    ledgerDigest: dependencyTransitionLedgerDigest(records),
    tip: tips[0]!
  });
}

export function writeDependencyTransitionPointerCache(
  namespace: DependencyTransitionNamespace,
  recordDigest: `sha256:${string}`
): void {
  // `current.json` is intentionally not replaced.  It is a disposable
  // locator/cache and may have been written by an external process between
  // our immutable-record publication and this best-effort hint.  Replacing it
  // would turn a check-then-replace race into an apparent authority race.  The
  // immutable census remains the only source of the transition tip.
  const pointer = Object.freeze({
    schema: DEPENDENCY_TRANSITION_POINTER_SCHEMA,
    recordDigest
  });
  const pointerBytes = Buffer.from(formatJsonFile(canonicalJson(pointer)), 'utf8');
  let existing: ReturnType<typeof inspectNoFollowOrdinaryFileEntry>;
  try {
    existing = inspectNoFollowOrdinaryFileEntry(namespace.journalRoot, 'current.json');
  } catch {
    // A foreign/reparse cache entry is preserved.  It cannot affect recovery.
    return;
  }
  if (existing === null) {
    try {
      publishExclusiveDurableCanonicalFile({
        parent: namespace.journalRoot,
        name: 'current.json',
        bytes: pointerBytes,
        validate: assertDependencyTransitionPointerBytes
      });
    } catch {
      // Another process may have won the cache publication.  Re-readers use
      // the immutable ledger and therefore do not need a pointer repair.
    }
    return;
  }
  if (existing.bytes !== null && Buffer.from(existing.bytes).equals(pointerBytes)) return;
  // Different, malformed, or stale bytes are unknown cache residue; leave it
  // untouched rather than overwriting an external writer.
}

export async function observeDependencyTransitionSlot(
  targetPath: string,
  expectedBindingDigest?: `sha256:${string}` | null
): Promise<DependencyTransitionSlot> {
  const absolute = path.resolve(targetPath);
  try {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(absolute),
      'Dependency transition slot parent'
    ).target;
    const name = path.basename(absolute);
    let link: ReturnType<typeof inspectNoFollowLinkEntry>;
    try {
      link = inspectNoFollowLinkEntry(parent, name);
    } catch (error) {
      if (error instanceof PhysicalNoFollowError &&
        (error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' ||
          error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH')) {
        link = null;
      } else {
        throw error;
      }
    }
    if (link !== null) {
      if (link.kind !== 'link' || link.linkTarget === null) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition slot is an invalid link');
      }
      return transitionSlotFromPhysical({
        path: absolute,
        kind: 'link',
        physical: Object.freeze({
          device: link.device,
          inode: link.inode,
          objectId: generatedStateDigest({ kind: 'link', target: link.linkTarget })
        }),
        linkTarget: link.linkTarget,
        bindingDigest: expectedBindingDigest ?? null
      });
    }
    const directory = inspectExactNoFollowDirectoryPresence(
      absolute,
      'Dependency transition slot'
    );
    if (directory.state === 'absent') return transitionAbsentSlot(absolute);
    return transitionSlotFromPhysical({
      path: absolute,
      kind: 'directory',
      physical: generatedStatePhysicalIdentity(directory.directory.target),
      bindingDigest: expectedBindingDigest ?? null
    });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return transitionAbsentSlot(absolute);
    }
    throw error;
  }
}
