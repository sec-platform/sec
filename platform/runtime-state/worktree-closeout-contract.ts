import { canonicalJson, sha256 } from '../shared/canonical-primitives.ts';
import {
  assertGeneratedStateWorktreeRetirementV1,
  type GeneratedStateWorktreeRetirementV1
} from '../shared/generated-state-contract.ts';

export const WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA_V1 = 'sec-worktree-cleanup-authorization-v1' as const;
export const WORKTREE_PHYSICAL_CLOSEOUT_RECEIPT_SCHEMA_V1 = 'sec-worktree-cleanup-receipt-v1' as const;

export type Digest = `sha256:${string}`;

export function assertStableWorktreePhysicalWorkingStateV1(
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

export interface WorktreePorcelainRecordV1 {
  readonly path: string;
  readonly headSha: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly bare: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

export interface WorktreeStatusPorcelainRecordV1 {
  readonly index: string;
  readonly worktree: string;
  readonly path: string;
  readonly originalPath: string | null;
}

export type WorktreePhysicalEntryKind = 'directory' | 'file' | 'symlink';

export interface WorktreePhysicalEntryV1 {
  readonly relativePath: string;
  readonly kind: WorktreePhysicalEntryKind;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly contentDigest: Digest | null;
  readonly linkTarget: string | null;
}

export interface WorktreePhysicalInventoryV1 {
  readonly entries: readonly WorktreePhysicalEntryV1[];
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly symlinkCount: number;
  readonly byteCount: number;
  readonly inventoryDigest: Digest;
}

export interface WorktreePhysicalCloseoutAuthorizationV1 {
  readonly schema: typeof WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA_V1;
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
    readonly inventory: WorktreePhysicalInventoryV1;
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
  readonly generatedStateRetirement: GeneratedStateWorktreeRetirementV1 | null;
  readonly inventory: WorktreePhysicalInventoryV1;
  /** Deterministic same-parent retained relocation name; never caller chosen. */
  readonly tombstoneName: string;
  readonly authorizationPath: string;
  readonly receiptPath: string;
  readonly authorizationDigest: Digest;
}

export interface WorktreePhysicalCloseoutAttemptV1 {
  readonly operation: 'unregister' | 'physical-cleanup' | 'readback';
  readonly status: 'success' | 'failed' | 'skipped';
  readonly detailDigest: Digest;
  readonly relativePath: string | null;
}

export interface WorktreePhysicalCloseoutReceiptV1 {
  readonly schema: typeof WORKTREE_PHYSICAL_CLOSEOUT_RECEIPT_SCHEMA_V1;
  readonly operationId: Digest;
  readonly authorizationDigest: Digest;
  readonly repository: WorktreePhysicalCloseoutAuthorizationV1['repository'];
  readonly target: WorktreePhysicalCloseoutAuthorizationV1['target'];
  readonly registryBeforeDigest: Digest;
  readonly registryAfterDigest: Digest;
  readonly workingStateDigest: Digest;
  readonly inventoryBeforeDigest: Digest;
  readonly inventoryAfterDigest: Digest | null;
  /** Immutable predecessor generation; completed evidence must retain the full effect chain. */
  readonly previousReceiptDigest: Digest | null;
  readonly attempts: readonly WorktreePhysicalCloseoutAttemptV1[];
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

function assertSha(value: string, label: string): void {
  if (!/^[0-9a-f]{40}$/u.test(value)) fail(`${label} must be a lowercase Git SHA-1.`);
}

function assertBranch(value: string): void {
  const segments = value.split('/');
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.startsWith('.') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('@{') ||
    /[\u0000-\u0020~^:?*\[\\\u007f]/u.test(value) ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment.endsWith('.') || segment.endsWith('.lock'))
  ) {
    fail('branch field is not a canonical Git branch name.');
  }
}

function fieldPayload(field: string, prefix: string): string {
  const payload = field.slice(prefix.length);
  if (payload.length === 0) fail(`${prefix.trim()} field must not be empty.`);
  return payload;
}

/**
 * Strict parser for `git worktree list --porcelain -z`.
 *
 * Git terminates every field with NUL and every record with one additional NUL.
 * Unknown, duplicate, out-of-order, or incomplete fields are rejected because a
 * cleanup owner cannot safely normalize a provider format it does not understand.
 */
export function parseWorktreePorcelainZV1(source: Buffer | Uint8Array): WorktreePorcelainRecordV1[] {
  const bytes = Buffer.from(source);
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) fail('porcelain-z input must end with NUL.');
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('porcelain-z input contains invalid UTF-8.');
  }
  const fields = decoded.split('\0');
  const records: WorktreePorcelainRecordV1[] = [];
  let current: {
    path: string;
    headSha: string | null;
    branch: string | null;
    detached: boolean;
    bare: boolean;
    locked: boolean;
    prunable: boolean;
    seen: Set<string>;
  } | null = null;

  const finish = (): void => {
    if (current === null) return;
    if (!current.bare && current.headSha === null) fail(`worktree ${current.path} has no HEAD field.`);
    if (!current.bare && current.branch === null && !current.detached) {
      fail(`worktree ${current.path} has neither branch nor detached field.`);
    }
    records.push({
      path: current.path,
      headSha: current.headSha,
      branch: current.branch,
      detached: current.detached,
      bare: current.bare,
      locked: current.locked,
      prunable: current.prunable
    });
    current = null;
  };

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.length === 0) {
      const finalSentinel = index === fields.length - 1;
      if (current !== null) {
        if (finalSentinel) fail('porcelain-z record lacks its empty record terminator.');
        finish();
      } else if (!finalSentinel) {
        fail('unexpected empty porcelain field.');
      }
      continue;
    }
    if (field.startsWith('worktree ')) {
      if (current !== null) fail('record boundary must be an empty NUL field.');
      current = {
        path: fieldPayload(field, 'worktree '),
        headSha: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        prunable: false,
        seen: new Set(['worktree'])
      };
      continue;
    }
    if (current === null) fail(`field appears before worktree: ${field}`);
    const mark = (name: string): void => {
      if (current!.seen.has(name)) fail(`duplicate ${name} field for ${current!.path}.`);
      current!.seen.add(name);
    };
    if (field.startsWith('HEAD ')) {
      mark('HEAD');
      const headSha = fieldPayload(field, 'HEAD ');
      assertSha(headSha, 'HEAD');
      current.headSha = headSha;
    } else if (field.startsWith('branch refs/heads/')) {
      mark('branch');
      if (current.detached || current.bare) fail(`conflicting branch field for ${current.path}.`);
      current.branch = fieldPayload(field, 'branch refs/heads/');
      assertBranch(current.branch);
    } else if (field === 'detached') {
      mark('detached');
      if (current.branch !== null || current.bare) fail(`conflicting detached field for ${current.path}.`);
      current.detached = true;
    } else if (field === 'bare') {
      mark('bare');
      if (current.branch !== null || current.detached) fail(`conflicting bare field for ${current.path}.`);
      current.bare = true;
    } else if (field === 'locked' || field.startsWith('locked ')) {
      mark('locked');
      current.locked = true;
    } else if (field === 'prunable' || field.startsWith('prunable ')) {
      mark('prunable');
      current.prunable = true;
    } else {
      fail(`unsupported porcelain field: ${field}`);
    }
  }
  if (current !== null) fail('porcelain-z record lacks its empty record terminator.');
  const paths = new Set<string>();
  for (const record of records) {
    if (paths.has(record.path)) fail(`duplicate worktree path: ${record.path}`);
    paths.add(record.path);
  }
  return records;
}

/** Strict parser for `git status --porcelain=v1 -z` machine records. */
export function parseWorktreeStatusPorcelainZV1(source: Buffer | Uint8Array): WorktreeStatusPorcelainRecordV1[] {
  const bytes = Buffer.from(source);
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) fail('status porcelain-z input must end with NUL.');
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('status porcelain-z input contains invalid UTF-8.');
  }
  const fields = decoded.split('\0');
  fields.pop();
  const records: WorktreeStatusPorcelainRecordV1[] = [];
  const allowed = new Set([' ', 'M', 'T', 'A', 'D', 'R', 'C', 'U', '?', '!']);
  const canonicalPath = (value: string, label: string): string => {
    const normalized = value.replaceAll('\\', '/').replace(/\/+$/u, '');
    if (
      normalized.length === 0 ||
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//u.test(normalized) ||
      normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      fail(`${label} is not one repository-relative path.`);
    }
    return normalized;
  };
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.length < 4 || field[2] !== ' ' || !allowed.has(field[0]!) || !allowed.has(field[1]!)) {
      fail(`unsupported status porcelain field: ${field}`);
    }
    const status = field.slice(0, 2);
    if (status === '  ' || (status.includes('?') && status !== '??') || (status.includes('!') && status !== '!!')) {
      fail(`unsupported status pair: ${status}`);
    }
    const renamed = status.includes('R') || status.includes('C');
    const originalPath = renamed
      ? canonicalPath(fields[++index] ?? fail('rename/copy status lacks its original path.'), 'status originalPath')
      : null;
    records.push(
      Object.freeze({
        index: status[0]!,
        worktree: status[1]!,
        path: canonicalPath(field.slice(3), 'status path'),
        originalPath
      })
    );
  }
  const identities = new Set<string>();
  for (const record of records) {
    const identity = `${record.index}${record.worktree}\0${record.path}\0${record.originalPath ?? ''}`;
    if (identities.has(identity)) fail(`duplicate status record: ${record.path}`);
    identities.add(identity);
  }
  return records;
}

export function createWorktreePhysicalInventoryV1(entries: readonly WorktreePhysicalEntryV1[]): WorktreePhysicalInventoryV1 {
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

function sameAuthorizedEntry(current: WorktreePhysicalEntryV1, authorized: WorktreePhysicalEntryV1): boolean {
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

export function classifyAuthorizedWorktreeResidueV1(
  current: WorktreePhysicalInventoryV1,
  authorized: WorktreePhysicalInventoryV1
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

function authorizationMaterial(value: Omit<WorktreePhysicalCloseoutAuthorizationV1, 'authorizationDigest'>): unknown {
  return value;
}

export function createWorktreePhysicalCloseoutAuthorizationV1(
  input: Omit<WorktreePhysicalCloseoutAuthorizationV1, 'schema' | 'operationId' | 'authorizationDigest'>
): WorktreePhysicalCloseoutAuthorizationV1 {
  assertSha(input.target.headSha, 'target headSha');
  assertSha(input.target.treeSha, 'target treeSha');
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.target.recoveryAuthorityDigest)) {
    fail('target recoveryAuthorityDigest shape mismatch.');
  }
  const operationId = sha256({
    repository: input.repository,
    target: input.target,
    registryBeforeDigest: input.registryBeforeDigest,
    workingStateDigest: input.workingStateDigest,
    generatedStateRetirementDigest: input.generatedStateRetirement?.receiptDigest ?? null,
    inventoryDigest: input.inventory.inventoryDigest,
    registryAdmin: {
      relativePath: input.registryAdmin.relativePath,
      device: input.registryAdmin.device,
      inode: input.registryAdmin.inode,
      inventoryDigest: input.registryAdmin.inventory.inventoryDigest
    },
    targetLeaseNamespace: input.targetLeaseNamespace
  }) as Digest;
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
    assertGeneratedStateWorktreeRetirementV1(input.generatedStateRetirement);
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
    schema: WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA_V1,
    operationId,
    ...input
  };
  return Object.freeze({
    ...withoutDigest,
    authorizationDigest: sha256(authorizationMaterial(withoutDigest)) as Digest
  });
}

export function assertWorktreePhysicalCloseoutAuthorizationV1(
  value: WorktreePhysicalCloseoutAuthorizationV1
): WorktreePhysicalCloseoutAuthorizationV1 {
  if (value.schema !== WORKTREE_PHYSICAL_CLOSEOUT_AUTHORIZATION_SCHEMA_V1) fail('authorization schema mismatch.');
  assertSha(value.target.headSha, 'target headSha');
  assertSha(value.target.treeSha, 'target treeSha');
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.target.recoveryAuthorityDigest)) {
    fail('target recoveryAuthorityDigest shape mismatch.');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.operationId) || !/^sha256:[0-9a-f]{64}$/u.test(value.authorizationDigest)) {
    fail('authorization digest shape mismatch.');
  }
  const rebuilt = createWorktreePhysicalCloseoutAuthorizationV1({
    repository: value.repository,
    target: value.target,
    registryAdmin: {
      ...value.registryAdmin,
      inventory: createWorktreePhysicalInventoryV1(value.registryAdmin.inventory.entries)
    },
    targetLeaseNamespace: value.targetLeaseNamespace,
    proofRoot: value.proofRoot,
    registryBeforeDigest: value.registryBeforeDigest,
    workingStateDigest: value.workingStateDigest,
    generatedStateRetirement: value.generatedStateRetirement,
    inventory: createWorktreePhysicalInventoryV1(value.inventory.entries),
    tombstoneName: value.tombstoneName,
    authorizationPath: value.authorizationPath,
    receiptPath: value.receiptPath
  });
  if (JSON.stringify(canonicalJson(rebuilt)) !== JSON.stringify(canonicalJson(value))) {
    fail('authorization digest or canonical content mismatch.');
  }
  return value;
}

export function createWorktreePhysicalCloseoutReceiptV1(
  input: Omit<WorktreePhysicalCloseoutReceiptV1, 'schema' | 'receiptDigest'>
): WorktreePhysicalCloseoutReceiptV1 {
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
    schema: WORKTREE_PHYSICAL_CLOSEOUT_RECEIPT_SCHEMA_V1,
    ...input,
    blockers: normalizedBlockers
  };
  return Object.freeze({ ...withoutDigest, receiptDigest: sha256(withoutDigest) as Digest });
}

export function assertWorktreePhysicalCloseoutReceiptV1(value: WorktreePhysicalCloseoutReceiptV1): WorktreePhysicalCloseoutReceiptV1 {
  if (value.schema !== WORKTREE_PHYSICAL_CLOSEOUT_RECEIPT_SCHEMA_V1) fail('receipt schema mismatch.');
  const { schema: ignoredSchema, receiptDigest: ignoredDigest, ...input } = value;
  const rebuilt = createWorktreePhysicalCloseoutReceiptV1(input);
  if (JSON.stringify(canonicalJson(rebuilt)) !== JSON.stringify(canonicalJson(value))) {
    fail('receipt digest or canonical content mismatch.');
  }
  return value;
}

export function requireCompletedWorktreePhysicalCloseoutReceiptV1(input: {
  readonly receipt: WorktreePhysicalCloseoutReceiptV1;
  readonly repositoryRoot: string;
  readonly commonDir: string;
  readonly targetPath: string;
  readonly branch: string;
  readonly headSha: string;
  readonly treeSha: string;
  readonly recoveryAuthorityDigest: Digest;
}): WorktreePhysicalCloseoutReceiptV1 {
  const receipt = assertWorktreePhysicalCloseoutReceiptV1(input.receipt);
  const pathKey = (value: string): string => {
    const normalized = value.replaceAll('\\', '/').replace(/\/$/u, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };
  if (
    receipt.terminal !== 'completed' ||
    receipt.readback.registryPresent ||
    receipt.readback.physicalPresent ||
    !receipt.readback.authorizationValid ||
    receipt.inventoryAfterDigest !== null ||
    receipt.blockers.length > 0
  ) {
    fail('consumer requires an exact completed receipt with absent readback.');
  }
  if (
    pathKey(receipt.repository.root) !== pathKey(input.repositoryRoot) ||
    pathKey(receipt.repository.commonDir) !== pathKey(input.commonDir) ||
    pathKey(receipt.target.path) !== pathKey(input.targetPath) ||
    receipt.target.branch !== input.branch ||
    receipt.target.headSha !== input.headSha ||
    receipt.target.treeSha !== input.treeSha ||
    receipt.target.recoveryAuthorityDigest !== input.recoveryAuthorityDigest
  ) {
    fail('completed receipt does not bind the consuming branch closeout identity.');
  }
  return receipt;
}

export function detailDigestV1(value: unknown): Digest {
  return sha256(value) as Digest;
}
