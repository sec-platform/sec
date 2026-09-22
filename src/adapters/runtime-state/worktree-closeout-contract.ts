import { canonicalJson, sha256 } from '../../contracts/canonical.ts';
import {
  assertGeneratedStateWorktreeRetirement,
  type GeneratedStateWorktreeRetirement
} from './generated-state/contract.ts';
import { assertLowercaseGitSha } from './physical/contract/git-worktree-observation.ts';
export {
  parseWorktreePorcelainZ,
  parseWorktreeStatusPorcelainZ,
  type WorktreePorcelainRecord,
  type WorktreeStatusPorcelainRecord
} from './physical/contract/git-worktree-observation.ts';

export const WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA = 'sec-worktree-cleanup-authorization-v1' as const;
export const WORKTREE_PHYSICAL_CLOSEOUT_RECEIPT_SCHEMA = 'sec-worktree-cleanup-receipt-v1' as const;

export type Digest = `sha256:${string}`;
const fieldlessLegacyWorktreePhysicalCloseoutAuthorizations = new WeakSet<object>();

export function isFieldlessLegacyWorktreePhysicalCloseoutAuthorization(
  value: WorktreePhysicalCloseoutAuthorization
): boolean {
  return value.schema === WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA
    && fieldlessLegacyWorktreePhysicalCloseoutAuthorizations.has(value);
}

export function assertStableWorktreePhysicalWorkingState(
  initialDigest: Digest,
  readback: Readonly<{ readonly digest: Digest; readonly blocker: string | null }>
): void {
  const blockers = [
    ...(readback.blocker === null ? [] : [readback.blocker]),
    ...(readback.digest === initialDigest ? [] : ['working-state-changed-during-authorization'])
  ];
  if (blockers.length > 0) {
    throw new Error(
      `Worktree closeout preparation blocked: ${[...new Set(blockers)].sort().join(',')}`
    );
  }
}

type WorktreePhysicalEntryKind = 'directory' | 'file' | 'symlink';

export interface WorktreePhysicalEntry {
  readonly relativePath: string;
  readonly kind: WorktreePhysicalEntryKind;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly contentDigest: Digest | null;
  readonly linkTarget: string | null;
}

export interface WorktreePhysicalInventory {
  readonly entries: readonly WorktreePhysicalEntry[];
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly symlinkCount: number;
  readonly byteCount: number;
  readonly inventoryDigest: Digest;
}

export interface WorktreePhysicalCloseoutAuthorization {
  readonly schema: typeof WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA;
  readonly operationId: Digest;
  readonly repository: {
    readonly root: string;
    readonly rootDevice: string;
    readonly rootInode: string;
    readonly commonDir: string;
    readonly commonDirDevice: string;
    readonly commonDirInode: string;
  };
  readonly target: {
    readonly path: string;
    readonly device: string;
    readonly inode: string;
    readonly branch: string;
    readonly headSha: string;
    readonly treeSha: string;
    readonly recoveryAuthorityDigest: Digest;
  };
  /** Exact Git common-dir worktree-admin directory; never a target-path Git effect. */
  readonly registryAdmin: {
    readonly relativePath: string;
    readonly tombstoneName: string;
    readonly device: string;
    readonly inode: string;
    readonly inventory: WorktreePhysicalInventory;
  };
  /** Exact active target writer namespace observed while prepare holds its lease. */
  readonly targetLeaseNamespace: { readonly device: string; readonly inode: string; };
  /**
   * Target-external, same-volume retained proof root.  It is created while
   * prepare holds the target lease and retains the V3 terminal ledger after
   * the target tombstone disappears; the common-dir remains only the durable
   * authorization/receipt locator.
   */
  readonly proofRoot: { readonly path: string; readonly device: string; readonly inode: string; };
  readonly registryBeforeDigest: Digest;
  readonly workingStateDigest: Digest;
  /** #271-owned preservation receipt; null only when no ignored derived state existed. */
  readonly generatedStateRetirement: GeneratedStateWorktreeRetirement | null;
  readonly inventory: WorktreePhysicalInventory;
  /** Deterministic same-parent retained relocation name; never caller chosen. */
  readonly tombstoneName: string;
  readonly authorizationPath: string;
  readonly receiptPath: string;
  readonly authorizationDigest: Digest;
}

export interface WorktreePhysicalCloseoutAttempt {
  readonly operation: 'unregister' | 'physical-cleanup' | 'readback';
  readonly status: 'success' | 'failed' | 'skipped';
  readonly detailDigest: Digest;
  readonly relativePath: string | null;
}

export interface WorktreePhysicalCloseoutReceipt {
  readonly schema: typeof WORKTREE_PHYSICAL_CLOSEOUT_RECEIPT_SCHEMA;
  readonly operationId: Digest;
  readonly authorizationDigest: Digest;
  readonly repository: WorktreePhysicalCloseoutAuthorization['repository'];
  readonly target: WorktreePhysicalCloseoutAuthorization['target'];
  readonly registryBeforeDigest: Digest;
  readonly registryAfterDigest: Digest;
  readonly workingStateDigest: Digest;
  readonly inventoryBeforeDigest: Digest;
  readonly inventoryAfterDigest: Digest | null;
  /** Immutable predecessor generation; completed evidence must retain the full effect chain. */
  readonly previousReceiptDigest: Digest | null;
  readonly attempts: readonly WorktreePhysicalCloseoutAttempt[];
  readonly readback: {
    readonly registryPresent: boolean;
    readonly physicalPresent: boolean;
    readonly authorizationValid: boolean;
  };
  readonly terminal: 'completed' | 'blocked' | 'residue';
  readonly blockers: readonly string[];
  readonly receiptDigest: Digest;
}

function fail(message: string): never {
  throw new Error(`Worktree physical closeout contract: ${message}`);
}

function parseGitControlPathLine(
  source: Uint8Array,
  label: string,
  prefix: string
): string {
  if (!(source instanceof Uint8Array) || source.byteLength < prefix.length + 1
      || source.byteLength > 32_768) {
    return fail(`${label} bytes are outside the bounded Git control-file domain.`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return fail(`${label} contains invalid UTF-8.`);
  }
  const match = /^(.*?)(?:\r\n|\n)?$/u.exec(text);
  if (match === null || match[1] === undefined || match[1].includes('\r')
      || match[1].includes('\n') || match[1].includes('\0')
      || !match[1].startsWith(prefix)) {
    return fail(`${label} is not one canonical Git control path line.`);
  }
  const value = match[1].slice(prefix.length);
  if (value.length === 0) return fail(`${label} path is empty.`);
  return value;
}

/** Strict parser for a linked-worktree root's ordinary `.git` locator file. */
export function parseGitWorktreeAdminLocator(source: Uint8Array): string {
  return parseGitControlPathLine(source, 'worktree .git locator', 'gitdir: ');
}

/** Strict parser for `commondir` and `gitdir` admin back-reference files. */
export function parseGitWorktreeAdminPath(source: Uint8Array, label: string): string {
  if (typeof label !== 'string' || label.length === 0 || label.trim() !== label) {
    return fail('Git worktree admin path label is invalid.');
  }
  return parseGitControlPathLine(source, label, '');
}

export function createWorktreePhysicalInventory(entries: readonly WorktreePhysicalEntry[]): WorktreePhysicalInventory {
  const sorted = [...entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const relativePaths = new Set<string>();
  let fileCount = 0;
  let directoryCount = 0;
  let symlinkCount = 0;
  let byteCount = 0;
  for (const entry of sorted) {
    if (
      entry.relativePath.length === 0 ||
      entry.relativePath.startsWith('/') ||
      entry.relativePath.includes('\\') ||
      entry.relativePath.split('/').includes('..')
    ) {
      fail(`unsafe relative inventory path: ${entry.relativePath}`);
    }
    if (relativePaths.has(entry.relativePath)) fail(`duplicate inventory path: ${entry.relativePath}`);
    relativePaths.add(entry.relativePath);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) fail(`invalid size for ${entry.relativePath}`);
    if (entry.kind === 'file') {
      fileCount += 1;
      byteCount += entry.size;
      if (entry.contentDigest === null || entry.linkTarget !== null) fail(`invalid file identity for ${entry.relativePath}`);
    } else if (entry.kind === 'directory') {
      directoryCount += 1;
      if (entry.contentDigest !== null || entry.linkTarget !== null) fail(`invalid directory identity for ${entry.relativePath}`);
    } else if (entry.kind === 'symlink') {
      symlinkCount += 1;
      if (entry.contentDigest !== null || entry.linkTarget === null) fail(`invalid symlink identity for ${entry.relativePath}`);
    } else {
      fail(`unsupported inventory kind for ${entry.relativePath}`);
    }
  }
  const material = { entries: sorted, fileCount, directoryCount, symlinkCount, byteCount };
  return { ...material, inventoryDigest: sha256(material) as Digest };
}

function sameAuthorizedEntry(current: WorktreePhysicalEntry, authorized: WorktreePhysicalEntry): boolean {
  if (
    current.relativePath !== authorized.relativePath ||
    current.kind !== authorized.kind ||
    current.device !== authorized.device ||
    current.inode !== authorized.inode
  )
    return false;
  if (current.kind === 'directory') return true;
  return (
    current.size === authorized.size && current.contentDigest === authorized.contentDigest && current.linkTarget === authorized.linkTarget
  );
}

export function classifyAuthorizedWorktreeResidue(
  current: WorktreePhysicalInventory,
  authorized: WorktreePhysicalInventory
): string[] {
  const expected = new Map(authorized.entries.map((entry) => [entry.relativePath, entry]));
  const blockers: string[] = [];
  for (const entry of current.entries) {
    const match = expected.get(entry.relativePath);
    if (match === undefined) blockers.push(`unknown-residue:${entry.relativePath}`);
    else if (!sameAuthorizedEntry(entry, match)) blockers.push(`changed-residue:${entry.relativePath}`);
  }
  return blockers.sort((left, right) => left.localeCompare(right));
}

function authorizationMaterial(value: Omit<WorktreePhysicalCloseoutAuthorization, 'authorizationDigest'>): unknown {
  return value;
}

function worktreePhysicalCloseoutOperationMaterial(
  input: Omit<WorktreePhysicalCloseoutAuthorization, 'schema' | 'operationId' | 'authorizationDigest'>,
  includeGeneratedStateRetirement: boolean
): unknown {
  return {
    repository: input.repository,
    target: input.target,
    registryBeforeDigest: input.registryBeforeDigest,
    workingStateDigest: input.workingStateDigest,
    ...(includeGeneratedStateRetirement
      ? { generatedStateRetirementDigest: input.generatedStateRetirement?.receiptDigest ?? null }
      : {}),
    inventoryDigest: input.inventory.inventoryDigest,
    registryAdmin: {
      relativePath: input.registryAdmin.relativePath,
      device: input.registryAdmin.device,
      inode: input.registryAdmin.inode,
      inventoryDigest: input.registryAdmin.inventory.inventoryDigest
    },
    targetLeaseNamespace: input.targetLeaseNamespace
  };
}

export function createWorktreePhysicalCloseoutAuthorization(
  input: Omit<WorktreePhysicalCloseoutAuthorization, 'schema' | 'operationId' | 'authorizationDigest'>
): WorktreePhysicalCloseoutAuthorization {
  assertLowercaseGitSha(input.target.headSha, 'target headSha');
  assertLowercaseGitSha(input.target.treeSha, 'target treeSha');
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.target.recoveryAuthorityDigest)) {
    fail('target recoveryAuthorityDigest shape mismatch.');
  }
  const operationId = sha256(worktreePhysicalCloseoutOperationMaterial(input, true)) as Digest;
  if (!/^worktrees\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input.registryAdmin.relativePath) ||
    !/^worktree-admin-closeout-[0-9a-f]{64}$/u.test(input.registryAdmin.tombstoneName) ||
    input.registryAdmin.device.length === 0 || input.registryAdmin.inode.length === 0) {
    fail('registryAdmin is not a canonical Git common-dir worktree directory.');
  }
  if (input.targetLeaseNamespace.device.length === 0 || input.targetLeaseNamespace.inode.length === 0) {
    fail('targetLeaseNamespace is not a physical identity.');
  }
  if (!/^sec-worktree-closeout-proof-[0-9a-f]{64}$/u.test(input.proofRoot.path.split(/[\\/]/u).at(-1) ?? '') ||
    input.proofRoot.device !== input.targetLeaseNamespace.device || input.proofRoot.inode.length === 0 ||
    input.proofRoot.path === input.target.path) {
    fail('proofRoot is not a target-external same-volume physical directory.');
  }
  if (!/^worktree-closeout-tombstone-[0-9a-f]{64}$/u.test(input.tombstoneName)) {
    fail('tombstoneName is not a canonical operation-bound same-parent leaf.');
  }
  if (input.generatedStateRetirement !== null) {
    assertGeneratedStateWorktreeRetirement(input.generatedStateRetirement);
    if (
      input.generatedStateRetirement.terminal !== 'completed' ||
      input.generatedStateRetirement.repositoryRoot !== input.repository.root ||
      input.generatedStateRetirement.workspacePath !== input.target.path ||
      input.generatedStateRetirement.worktree.branch !== input.target.branch ||
      input.generatedStateRetirement.worktree.headSha !== input.target.headSha ||
      input.generatedStateRetirement.worktree.treeSha !== input.target.treeSha
    ) {
      fail('generatedStateRetirement does not bind this target authorization.');
    }
  }
  const withoutDigest = {
    schema: WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA,
    operationId,
    ...input
  };
  return Object.freeze({
    ...withoutDigest,
    authorizationDigest: sha256(authorizationMaterial(withoutDigest)) as Digest
  });
}

export function assertWorktreePhysicalCloseoutAuthorization(
  value: WorktreePhysicalCloseoutAuthorization
): WorktreePhysicalCloseoutAuthorization {
  if (value.schema !== WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA) fail('authorization schema mismatch.');
  const hasGeneratedStateRetirement = Object.prototype.hasOwnProperty.call(value, 'generatedStateRetirement');
  assertLowercaseGitSha(value.target.headSha, 'target headSha');
  assertLowercaseGitSha(value.target.treeSha, 'target treeSha');
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.target.recoveryAuthorityDigest)) {
    fail('target recoveryAuthorityDigest shape mismatch.');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.operationId) || !/^sha256:[0-9a-f]{64}$/u.test(value.authorizationDigest)) {
    fail('authorization digest shape mismatch.');
  }
  const normalizedGeneratedStateRetirement = hasGeneratedStateRetirement
    ? value.generatedStateRetirement
    : null;
  const normalizedInput = {
    repository: value.repository,
    target: value.target,
    registryAdmin: {
      ...value.registryAdmin,
      inventory: createWorktreePhysicalInventory(value.registryAdmin.inventory.entries)
    },
    targetLeaseNamespace: value.targetLeaseNamespace,
    proofRoot: value.proofRoot,
    registryBeforeDigest: value.registryBeforeDigest,
    workingStateDigest: value.workingStateDigest,
    generatedStateRetirement: normalizedGeneratedStateRetirement,
    inventory: createWorktreePhysicalInventory(value.inventory.entries),
    tombstoneName: value.tombstoneName,
    authorizationPath: value.authorizationPath,
    receiptPath: value.receiptPath
  } as const;
  const rebuilt = createWorktreePhysicalCloseoutAuthorization(normalizedInput);
  if (hasGeneratedStateRetirement) {
    if (JSON.stringify(canonicalJson(rebuilt)) !== JSON.stringify(canonicalJson(value))) {
      fail('authorization digest or canonical content mismatch.');
    }
    return value;
  }
  const operationId = sha256(worktreePhysicalCloseoutOperationMaterial(
    normalizedInput,
    hasGeneratedStateRetirement
  )) as Digest;
  const { schema: ignoredSchema, operationId: ignoredOperationId, authorizationDigest: ignoredDigest, ...rebuiltBody } = rebuilt;
  const legacyBody = Object.fromEntries(
    Object.entries(rebuiltBody).filter(([key]) => key !== 'generatedStateRetirement')
  );
  const withoutDigest = {
    schema: WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA,
    operationId,
    ...legacyBody
  };
  const expected = {
    ...withoutDigest,
    authorizationDigest: sha256(authorizationMaterial(withoutDigest as Omit<WorktreePhysicalCloseoutAuthorization, 'authorizationDigest'>)) as Digest
  };
  if (JSON.stringify(canonicalJson(expected)) !== JSON.stringify(canonicalJson(value))) {
    fail('authorization digest or canonical content mismatch.');
  }
  const normalized = Object.freeze({ ...value, generatedStateRetirement: normalizedGeneratedStateRetirement });
  if (!hasGeneratedStateRetirement) {
    fieldlessLegacyWorktreePhysicalCloseoutAuthorizations.add(normalized);
  }
  return normalized;
}

export function createWorktreePhysicalCloseoutReceipt(
  input: Omit<WorktreePhysicalCloseoutReceipt, 'schema' | 'receiptDigest'>
): WorktreePhysicalCloseoutReceipt {
  const normalizedBlockers = [...new Set(input.blockers)].sort((left, right) => left.localeCompare(right));
  const expectedTerminal =
    !input.readback.registryPresent &&
    !input.readback.physicalPresent &&
    input.readback.authorizationValid &&
    input.inventoryAfterDigest === null &&
    normalizedBlockers.length === 0
      ? 'completed'
      : !input.readback.registryPresent && input.readback.physicalPresent
        ? 'residue'
        : 'blocked';
  if (input.terminal !== expectedTerminal) {
    fail(`receipt terminal must be derived as ${expectedTerminal}.`);
  }
  const withoutDigest = {
    schema: WORKTREE_PHYSICAL_CLOSEOUT_RECEIPT_SCHEMA,
    ...input,
    blockers: normalizedBlockers
  };
  return Object.freeze({ ...withoutDigest, receiptDigest: sha256(withoutDigest) as Digest });
}

export function assertWorktreePhysicalCloseoutReceipt(value: WorktreePhysicalCloseoutReceipt): WorktreePhysicalCloseoutReceipt {
  if (value.schema !== WORKTREE_PHYSICAL_CLOSEOUT_RECEIPT_SCHEMA) fail('receipt schema mismatch.');
  const { schema: ignoredSchema, receiptDigest: ignoredDigest, ...input } = value;
  const rebuilt = createWorktreePhysicalCloseoutReceipt(input);
  if (JSON.stringify(canonicalJson(rebuilt)) !== JSON.stringify(canonicalJson(value))) {
    fail('receipt digest or canonical content mismatch.');
  }
  return value;
}

export function detailDigest(value: unknown): Digest {
  return sha256(value) as Digest;
}
