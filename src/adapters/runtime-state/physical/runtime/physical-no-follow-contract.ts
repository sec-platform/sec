import type { WindowsReadOnlyTreeGenerationBinding } from './windows-host-filesystem-authority.ts';

/** Pure structural contract for no-follow physical capabilities. This module performs no host I/O or FFI loading. */
const RETAINED_NO_FOLLOW_CAPABILITY_BRAND: unique symbol = Symbol('sec-retained-no-follow-capability');

export type PhysicalNoFollowFailureCode =
  | 'PHYSICAL_NO_FOLLOW_ABSENT'
  | 'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT'
  | 'PHYSICAL_NO_FOLLOW_READ_LIMIT_EXCEEDED'
  | 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
  | 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
  | 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
  | 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED';

export interface PhysicalNativeFailure {
  readonly namespace: 'win32';
  readonly code: number;
  readonly failureClass: 'access-denied' | 'access-unavailable' | 'other';
}

export class PhysicalNoFollowError extends Error {
  readonly code: PhysicalNoFollowFailureCode;
  readonly nativeFailure: PhysicalNativeFailure | null;

  constructor(
    code: PhysicalNoFollowFailureCode,
    message: string,
    options?: { cause?: unknown; nativeFailure?: PhysicalNativeFailure }
  ) {
    super(message, options);
    this.name = 'PhysicalNoFollowError';
    this.code = code;
    this.nativeFailure = options?.nativeFailure ?? null;
  }
}

export type RetainedNoFollowCapabilityRole =
  | 'ordinary-file'
  | 'executable'
  | 'working-directory';

export interface PhysicalDirectoryIdentity {
  /** Caller-supplied lexical absolute location, normalized by this module. */
  readonly path: string;
  /** Handle-derived physical final path on Windows; lexical path on Linux. */
  readonly finalPath: string;
  readonly device: string;
  readonly inode: string;
  /** FileIdInfo on Windows; dev/inode material on Linux. */
  readonly objectId: string;
}

export interface PhysicalDirectoryChain {
  readonly target: PhysicalDirectoryIdentity;
  /** Root-to-target identities.  Each component was opened without following links. */
  readonly ancestors: readonly PhysicalDirectoryIdentity[];
}

/**
 * A bounded Linux-only race actor used by the physical primitive's focused
 * tests.  It is deliberately an observation seam, not a filesystem or
 * operation capability: the private issuer below is the only way to obtain a
 * runtime-admissible actor, and the actor can only replace one explicitly
 * named directory once at one explicitly named transaction point.
 */
export type LinuxNoFollowDirectoryCreateRacePoint =
  | 'before-canonical-chain-open'
  | 'after-ancestor-open'
  | 'before-child-witness';

export interface LinuxNoFollowDirectoryCreateRaceActor {
  readonly point: LinuxNoFollowDirectoryCreateRacePoint;
  readonly targetPath: string;
  readonly displacedPath: string;
}

export interface NoFollowDirectoryCreateTestActor {
  readonly beforeCreate?: (event: Readonly<{ parentPath: string; targetPath: string }>) => void;
  readonly beforeParentBarrier?: (event: Readonly<{ parentPath: string; createdPath: string }>) => void;
  readonly durabilityObserver?: (event: Readonly<{ parentPath: string; createdPath: string }>) => void;
}

/**
 * A directory retained for a bounded child-process read lifecycle. On Linux
 * the child receives the already-open directory as one explicit stdio file
 * descriptor and addresses that object through `/proc/self/fd`. On Windows
 * every lexical ancestor is retained and identity-checked; the target and its
 * direct parent are additionally held without delete sharing. Windows blocks
 * ancestor relocation while those descendant boundary handles are live, but
 * ordinary shared ancestor handles remain compatible with the process cwd,
 * Git watchers, and other read-only repository users.
 */
export interface RetainedNoFollowChildProcessDirectory {
  readonly [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]?: 'working-directory';
  readonly childPath: string;
  readonly stdioSourceDescriptor: number | null;
  assertCurrent(): void;
  dispose(): void;
}

/**
 * Complete, writer-excluded directory generation for one bounded child
 * process. The inventory is exact: every directory, ordinary file and link is
 * retained until disposal, and every directory handle withholds write/delete
 * sharing so membership cannot expand or contract during execution.
 */
export interface RetainedNoFollowSealedDirectoryGeneration
  extends RetainedNoFollowChildProcessDirectory {
  readonly inventory: readonly NoFollowDirectoryTreeInventoryEntry[];
  readonly root: PhysicalDirectoryIdentity;
  assertAuthorityCurrent(): Promise<void>;
  retire(): Promise<void>;
}

/**
 * A generation whose full content and ACL closure were proved by its domain
 * publisher before Runtime Physical retained the exact lexical/root object.
 * Unlike an action-private sealed generation, descendants are not reopened or
 * rehashed per consumer; the publisher-owned ACL proof excludes mutation and
 * `assertAuthorityCurrent` revalidates its ChangeTime-bound entry census.
 */
export interface RetainedNoFollowProvenDirectoryGeneration
  extends RetainedNoFollowChildProcessDirectory {
  readonly root: PhysicalDirectoryIdentity;
  assertAuthorityCurrent(): Promise<void>;
  retire(): Promise<PhysicalGenerationRetirementReceipt>;
}

export interface PhysicalGenerationRetirementReceipt {
  readonly schema: 'sec-physical-generation-retirement-v1';
  readonly root: Readonly<{
    path: string;
    finalPath: string;
    device: string;
    inode: string;
    objectId: string;
  }>;
  readonly terminal: 'released';
}

export type NoFollowDirectoryTreeRetirementReceipt = Readonly<{
  entryCount: number;
  root: PhysicalDirectoryIdentity;
  status: 'physically-absent';
}>;

export interface RetainedNoFollowChildProcessFile {
  readonly [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]?: 'ordinary-file' | 'executable';
  readonly childPath: string;
  readonly stdioSourceDescriptor: number | null;
  readonly path: string;
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly physical: Readonly<{ device: string; inode: string }>;
  readonly size: number;
  /** Hard-link count observed through the same retained ordinary-file handle. */
  readonly linkCount: number;
  assertCurrent(): void;
  digest(): Readonly<{
    size: number;
    contentDigest: `sha256:${string}`;
    byteDigest: `sha256:${string}`;
  }>;
  dispose(): void;
}

/**
 * One ordinary file retained below a no-follow parent for a bounded
 * observation.  The digest is computed through the same retained file handle
 * that supplied the physical identity and size; callers never need to reopen
 * a lexical path between the metadata and byte observations.
 */
export interface RetainedNoFollowOrdinaryFile {
  readonly [RETAINED_NO_FOLLOW_CAPABILITY_BRAND]?: 'ordinary-file' | 'executable';
  readonly path: string;
  readonly parent: PhysicalDirectoryIdentity;
  readonly name: string;
  readonly physical: Readonly<{ device: string; inode: string }>;
  readonly size: number;
  /** Hard-link count observed through the same retained ordinary-file handle. */
  readonly linkCount: number;
  /**
   * Child-facing spelling of this same retained object.  On Linux the
   * caller must map `stdioSourceDescriptor` to the advertised descriptor
   * before spawning; the `/proc/self/fd` path then names the open file
   * description that supplied `digest()`, rather than a second lexical
   * open.  A Windows executable capability uses the pinned absolute path
   * while its retained file handle withholds both write and delete sharing,
   * so the kernel excludes every competing writer for the capability
   * lifetime.
   */
  readonly childPath: string;
  readonly stdioSourceDescriptor: number | null;
  assertCurrent(): void;
  /** Reads the complete bounded byte sequence through this same retained handle. */
  readBytes(): Uint8Array;
  digest(): Readonly<{
    size: number;
    contentDigest: `sha256:${string}`;
    byteDigest: `sha256:${string}`;
  }>;
  dispose(): void;
}

export type ExactNoFollowDirectoryPresence =
  | Readonly<{ state: 'present'; directory: PhysicalDirectoryChain }>
  | Readonly<{ state: 'absent' }>;

export type NoFollowDirectoryTreeEntryKind = 'directory' | 'file' | 'link';

export interface NoFollowDirectoryTreeEntry {
  readonly relativePath: string;
  readonly kind: NoFollowDirectoryTreeEntryKind;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly bytes: Uint8Array | null;
  readonly linkTarget: string | null;
  /** Opt-in POSIX permission bits. Omitted by default; null on unsupported platforms. */
  readonly permissionMode?: number | null;
}

/**
 * Inventory projection for arbitrarily large ordinary leaves.  File bytes are
 * never retained.  `contentDigest` deliberately preserves the historical
 * canonical `{ bytes: lowerHex }` digest domain used by worktree closeout, so
 * an interrupted authorization does not split when a leaf crosses the former
 * in-memory read limit.
 */
export interface NoFollowDirectoryTreeInventoryEntry {
  readonly relativePath: string;
  readonly kind: NoFollowDirectoryTreeEntryKind;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly contentDigest: `sha256:${string}` | null;
  /** Opt-in raw SHA-256 from the same retained streaming read. Omitted by default. */
  readonly byteDigest?: `sha256:${string}`;
  readonly linkTarget: string | null;
  /** Opt-in POSIX permission bits. Omitted by default; null on platforms without this projection. */
  readonly permissionMode?: number | null;
}

export interface NoFollowDirectoryTreeMetadataOptions {
  /** Monotonic `performance.now()` deadline. */
  readonly deadlineAtMs: number;
  /** Hard entry ceiling, checked while directory entries are enumerated. */
  readonly maximumEntries: number;
  /** Aggregate ordinary-file byte ceiling, checked before every retained read. */
  readonly maximumBytes?: number;
  /**
   * Canonical relative subtrees intentionally outside this observation.
   * Excluded roots are pruned before descendant traversal; they are not read
   * and cannot contribute bytes or semantic evidence.
   */
  readonly excludeRelativePaths?: readonly string[];
  /** Include POSIX permission bits without changing the default inventory schema. */
  readonly includePermissionMode?: boolean;
  /** Operation-scoped cancellation observed throughout retained traversal. */
  readonly signal?: AbortSignal;
}

export interface NoFollowSelectedDirectoryForestOptions extends NoFollowDirectoryTreeMetadataOptions {
  /** Canonical relative roots. `*` matches exactly one path segment. */
  readonly includeRelativePaths: readonly string[];
  /** Navigation-only wildcard parents are not evidence and are omitted. */
  readonly omitNavigationPrefixes?: boolean;
}

export interface NoFollowDirectoryTreeCopyRoot {
  /** Source identity observed through the no-follow directory backend. */
  readonly source: PhysicalDirectoryIdentity;
  /** Destination path, which must be absent before the copy starts. */
  readonly target: string;
}

export interface NoFollowDirectoryTreeCopyOptions {
  /** Optional operation fence invoked only before and after the bulk effect. */
  readonly assertCurrent?: () => void | Promise<void>;
  /** Do not duplicate nested package-manager module roots. */
  readonly skipNestedNodeModules?: boolean;
  readonly maximumEntries?: number;
  /** Aggregate ordinary-file bytes across pre-scan, copy, and readbacks. */
  readonly maximumBytes?: number;
  /** Monotonic operation deadline for the complete inventory/effect/readback. */
  readonly deadlineAtMs?: number;
  /** Operation-scoped cancellation observed throughout inventory and copy. */
  readonly signal?: AbortSignal;
  /** Optional lexical roots to include; ancestors are retained for traversal. */
  readonly includeRelativePaths?: readonly string[];
  /**
   * Source-relative subtrees that are intentionally outside this copy.
   * They are pruned before traversal rather than copied and filtered later.
   * A destination may live inside the source only when its complete relative
   * path is covered by one of these excluded roots.
   */
  readonly excludeRelativePaths?: readonly string[];
  /** Preserve and verify POSIX permission bits for files and directories. */
  readonly preservePermissionMode?: boolean;
  /**
   * Preserve ordinary-file permission bits while leaving copied directories
   * at the copier's safe writable mode. This is narrower than
   * preservePermissionMode and matches staging trees that must remain writable.
   */
  readonly preserveFilePermissionMode?: boolean;
  /** Reject ordinary files with another hard-link name instead of breaking alias topology. */
  readonly rejectHardLinks?: boolean;
}

export interface RetainedWindowsHostNamespaceDirectory {
  readonly path: string;
  readonly identity: PhysicalDirectoryIdentity;
  assertCurrent(): void;
  dispose(): void;
}

export type ProvenDirectoryGenerationBinding = WindowsReadOnlyTreeGenerationBinding;

export interface DurableCanonicalFileIdentityReceipt {
  readonly path: string;
  readonly digest: string;
  readonly physical: Readonly<{ device: string; inode: string }>;
}

/** Same-file-object exclusion for cooperating admitted writers, not process death. */
export interface RetainedExclusiveFileGuard {
  readonly physical: Readonly<{ device: string; inode: string }>;
  assertCurrent(): void;
  dispose(): void;
}

export interface DurableCanonicalFilePublicationReceipt extends DurableCanonicalFileIdentityReceipt {
  readonly created: boolean;
}

export interface RetainedNoFollowFileIdentity {
  readonly device: string;
  readonly inode: string;
}

export interface RetainedNoFollowFileObservation {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly identity: RetainedNoFollowFileIdentity;
  /** POSIX permission projection from the retained file; null on Windows. */
  readonly permissionMode: number | null;
}

export interface RetainedNoFollowFileTransactionTestActor {
  readonly beforeCreate?: (event: Readonly<{ label: string; parentPath: string; targetPath: string }>) => void | Promise<void>;
  readonly beforeRename?: (event: Readonly<{ label: string; sourcePath: string; targetPath: string }>) => void | Promise<void>;
  readonly afterNamespaceMutationBeforeFlush?: (event: Readonly<{ label: string; sourcePath: string; targetPath: string }>) => void | Promise<void>;
  readonly beforeCleanup?: (event: Readonly<{ label: string; filePath: string }>) => void | Promise<void>;
  readonly beforeParentBarrier?: (event: Readonly<{ label: string; targetPath: string; parentPath: string }>) => void | Promise<void>;
  readonly durabilityObserver?: (event: Readonly<{ label: string; targetPath: string; stage: 'renamed' | 'file-flushed' | 'parent-barrier' }>) => void | Promise<void>;
  readonly forceExactLinkEmptyPathErrno?: 1 | 13;
}

export interface RetainedNoFollowFileTransaction {
  readonly rootPath: string;
  readonly rootIdentity: PhysicalDirectoryIdentity;
  assertCurrent(): void;
  observe(relativePath: string, label: string): RetainedNoFollowFileObservation | null;
  observeTuple(entries: readonly Readonly<{ key: string; relativePath: string; label: string }>[]): Readonly<Record<string, RetainedNoFollowFileObservation | null>>;
  createExclusive(relativePath: string, bytes: Uint8Array, label: string, creationMode?: number): Promise<RetainedNoFollowFileObservation>;
  /**
   * Replace the exact observed canonical name by physical CAS. The preimage
   * inode is never mutated in place: this prevents a concurrent hard-link
   * alias from observing replacement bytes. The returned observation owns the
   * successor physical identity and the supplied source observation is stale.
   */
  rewriteExact(relativePath: string, source: RetainedNoFollowFileObservation, bytes: Uint8Array, label: string): Promise<RetainedNoFollowFileObservation>;
  renameNoReplace(sourceRelativePath: string, targetRelativePath: string, source: RetainedNoFollowFileObservation, label: string): Promise<RetainedNoFollowFileObservation>;
  linkExactNoReplace(sourceRelativePath: string, targetRelativePath: string, source: RetainedNoFollowFileObservation, label: string): Promise<RetainedNoFollowFileObservation>;
  removeExact(relativePath: string, source: RetainedNoFollowFileObservation, label: string): Promise<void>;
  flushExact(relativePath: string, source: RetainedNoFollowFileObservation, label: string): Promise<void>;
  dispose(): void;
}

export type WindowsDurableCanonicalFileReplacementInterruptionPoint =
  | 'after-transaction-record'
  | 'after-preimage-quarantine'
  | 'after-candidate-publication';

export interface WindowsDurableCanonicalFileReplacementInterruptionActor {
  readonly point: WindowsDurableCanonicalFileReplacementInterruptionPoint;
}

export type DurableCanonicalFileReplacementRecovery = Readonly<{
  status: 'none' | 'rolled-back' | 'completed';
  digest: string | null;
  physical: Readonly<{ device: string; inode: string }> | null;
}>;

export interface WindowsLegacySealedDirectoryRelocationCapability {
  readonly recoveryProofText: string;
}

export interface PhysicalNoFollowEntryAccessFailureObservation {
  readonly path: string;
  readonly kind: 'directory' | 'file' | 'link' | 'other';
  readonly device: string;
  readonly inode: string;
  readonly objectId: string;
  readonly nativeFailure: PhysicalNativeFailure;
}

export interface NoFollowOrdinaryFileDigest {
  readonly size: number;
  /** Raw SHA-256 over the retained ordinary-file bytes. */
  readonly byteDigest: `sha256:${string}`;
}
