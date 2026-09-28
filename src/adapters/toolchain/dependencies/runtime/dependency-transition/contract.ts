import path from 'node:path';
import { isDigest } from '../../../../../contracts/digest.ts';
import {
  generatedStateDigest,
  type GeneratedStatePhysicalIdentity
} from '../../../../runtime-state/generated-state/contract.ts';
import type {
  PhysicalDirectoryIdentity
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';

/**
 * Sole internal owner for dependency transition journal schemas, immutable
 * ledger state, rollover/migration recovery, slot observation, and transition
 * state-machine topology. Public callers continue through ../runtime.ts.
 */

export interface RuntimeDependencySourceGeneration {
  readonly schema: 'sec-runtime-dependency-source-generation-v1';
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly sourcePath: string;
  readonly physical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly bindingDigest: `sha256:${string}`;
  /** Digest of every no-follow source-tree entry, including content bytes. */
  readonly treeDigest: `sha256:${string}`;
  /** Number of entries covered by treeDigest; part of the bounded contract. */
  readonly treeEntryCount: number;
  readonly epoch: `sha256:${string}`;
}

export function runtimeDependencySourceGenerationEpoch(
  source: Readonly<Omit<RuntimeDependencySourceGeneration, 'schema' | 'sourcePath' | 'epoch'>>
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: 'sec-runtime-dependency-generation-epoch-v1',
    ownerRoot: source.ownerRoot,
    ownerRootPhysical: source.ownerRootPhysical,
    physical: source.physical,
    bindingDigest: source.bindingDigest,
    treeDigest: source.treeDigest,
    treeEntryCount: source.treeEntryCount
  }));
}

export function generatedStatePhysicalIdentity(
  identity: Readonly<Pick<PhysicalDirectoryIdentity, 'device' | 'inode' | 'objectId'>>
): GeneratedStatePhysicalIdentity {
  return Object.freeze({
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

export function isSha256Digest(value: unknown): value is `sha256:${string}` {
  return isDigest(value, 'sha256');
}

export function sameGeneratedStateIdentity(
  left: Readonly<GeneratedStatePhysicalIdentity>,
  right: Readonly<GeneratedStatePhysicalIdentity>
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

export type DependencyTransitionKind =
  | 'compiler-generation'
  | 'compiler-local-locator'
  | 'compiler-locator'
  | 'compiler-bridge'
  | 'project-runtime-bridge'
  | 'runtime-projection'
  | 'project-projection';

export type DependencyTransitionPhase =
  | 'prepared'
  | 'backed-up'
  | 'published'
  | 'binding-validated'
  | 'stamp-readback'
  | 'complete'
  | 'rolled-back'
  | 'recovery-required';

export type DependencyTransitionSlot = Readonly<{
  readonly path: string;
  readonly kind: 'absent' | 'directory' | 'link';
  readonly physical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly linkTarget: string | null;
  readonly bindingDigest: `sha256:${string}` | null;
}>;

export interface DependencyTransitionJournal {
  readonly schema: 'sec-dependency-transition-journal-v2';
  readonly recordDigest: `sha256:${string}`;
  readonly previousRecordDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly operationKey: `sha256:${string}`;
  readonly attemptNonce: string;
  readonly kind: DependencyTransitionKind;
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly destination: DependencyTransitionSlot;
  readonly preimage: DependencyTransitionSlot;
  readonly stage: DependencyTransitionSlot | null;
  /**
   * The operation-created staging container is a separate authority from the
   * staged `node_modules` child.  Recovery must retain both identities before
   * it can dispose anything; a path/name alone is never a cleanup authority.
   */
  readonly stageRoot: DependencyTransitionSlot | null;
  readonly backup: DependencyTransitionSlot | null;
  readonly sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  readonly phase: DependencyTransitionPhase;
  readonly durability: 'known' | 'unknown';
  readonly failure: Readonly<{ code: string; message: string }> | null;
}

export type DependencyTransitionUnsigned = Omit<DependencyTransitionJournal, 'recordDigest'>;

export const DEPENDENCY_TRANSITION_SCHEMA = 'sec-dependency-transition-journal-v2' as const;

export interface DependencyTransitionNamespace {
  readonly ownerRoot: PhysicalDirectoryIdentity;
  readonly backupRoot: PhysicalDirectoryIdentity;
  readonly journalRoot: PhysicalDirectoryIdentity;
  readonly recordsRoot: PhysicalDirectoryIdentity;
  readonly rolloversRoot: PhysicalDirectoryIdentity | null;
}

/**
 * The mutable `current.json` file is only a best-effort locator.  It is not a
 * transition authority: a caller must derive the one maximal tip from the
 * immutable record ledger before it can inspect or perform recovery effects.
 * Keeping this distinction explicit prevents a concurrent/external pointer
 * writer from making an older or foreign record appear authoritative.
 */
export interface DependencyTransitionLedger {
  readonly namespace: DependencyTransitionNamespace;
  readonly records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournal>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly tip: DependencyTransitionJournal | null;
}

const GENERATED_STATE_PHYSICAL_IDENTITY_KEYS = Object.freeze(['device', 'inode', 'objectId']);

export function hasExactObjectKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const expected = new Set(keys);
    const actual = Reflect.ownKeys(value);
    if (expected.size !== keys.length || actual.length !== expected.size) return false;
    // Never concatenate field names: embedded delimiters are ordinary key data.
    // Persisted JSON owns enumerable data properties, not hidden/symbol/accessor state.
    return actual.every(key => {
      if (typeof key !== 'string' || !expected.has(key)) return false;
      const field = Object.getOwnPropertyDescriptor(value, key);
      return field !== undefined && field.enumerable === true && 'value' in field;
    });
  } catch { return false; }
}

export function isCanonicalAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') &&
    path.isAbsolute(value) && path.resolve(value) === value;
}

export function isCanonicalGeneratedStatePhysicalIdentity(value: unknown): value is GeneratedStatePhysicalIdentity {
  return hasExactObjectKeys(value, GENERATED_STATE_PHYSICAL_IDENTITY_KEYS) &&
    typeof value.device === 'string' && value.device.length > 0 &&
    typeof value.inode === 'string' && value.inode.length > 0 &&
    typeof value.objectId === 'string' && value.objectId.length > 0;
}

export function transitionSlotFromPhysical(input: Readonly<{
  path: string;
  kind: 'directory' | 'link';
  physical: Readonly<GeneratedStatePhysicalIdentity>;
  linkTarget?: string | null;
  bindingDigest?: `sha256:${string}` | null;
}>): DependencyTransitionSlot {
  const cwd = process.cwd();
  const { path: selectedPath, kind, physical, linkTarget, bindingDigest } = input;
  return Object.freeze({
    path: path.resolve(cwd, selectedPath),
    kind,
    physical: generatedStatePhysicalIdentity(physical),
    linkTarget: linkTarget ?? null,
    bindingDigest: bindingDigest ?? null
  });
}

export function transitionAbsentSlot(pathValue: string): DependencyTransitionSlot {
  return Object.freeze({
    path: path.resolve(pathValue),
    kind: 'absent' as const,
    physical: null,
    linkTarget: null,
    bindingDigest: null
  });
}

export function transitionSlotMatches(
  actual: DependencyTransitionSlot,
  expected: DependencyTransitionSlot
): boolean {
  if (actual.kind !== expected.kind || path.resolve(actual.path) !== path.resolve(expected.path)) return false;
  if (actual.kind === 'absent') return true;
  return expected.physical !== null && actual.physical !== null &&
    sameGeneratedStateIdentity(actual.physical, expected.physical) &&
    (expected.kind !== 'link' || actual.linkTarget === expected.linkTarget);
}

export function sourceGenerationWithPath(
  source: RuntimeDependencySourceGeneration,
  sourcePath: string
): RuntimeDependencySourceGeneration {
  sourcePath = path.resolve(sourcePath);
  return Object.freeze({ ...source, sourcePath,
    ownerRootPhysical: generatedStatePhysicalIdentity(source.ownerRootPhysical),
    physical: generatedStatePhysicalIdentity(source.physical) });
}
