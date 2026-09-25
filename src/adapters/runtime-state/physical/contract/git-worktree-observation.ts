import path from 'node:path';
import { snapshotByteView } from '../../../../contracts/byte-snapshot.ts';
import { IsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';

export interface WorktreePorcelainRecord {
  readonly path: string;
  readonly headSha: string | null;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly bare: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

export interface WorktreeStatusPorcelainRecord {
  readonly index: string;
  readonly worktree: string;
  readonly path: string;
  readonly originalPath: string | null;
}

function fail(message: string): never {
  throw new Error(`Worktree physical closeout contract: ${message}`);
}

export function assertLowercaseGitSha(value: string, label: string): void {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)) {
    fail(`${label} must be a lowercase Git SHA-1 or SHA-256 object ID.`);
  }
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
    segments.some((segment) => segment.length === 0 || segment.startsWith('.') || segment.endsWith('.') || segment.endsWith('.lock'))
  ) {
    fail('branch field is not a canonical Git branch name.');
  }
}

function fieldPayload(field: string, prefix: string): string {
  const payload = field.slice(prefix.length);
  if (payload.length === 0) fail(`${prefix.trim()} field must not be empty.`);
  return payload;
}

/** Strict parser for `git worktree list --porcelain -z`. */
export function parseWorktreePorcelainZ(source: Buffer | Uint8Array): WorktreePorcelainRecord[] {
  const bytes = snapshotByteView(source, 'Git machine reply');
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) fail('porcelain-z input must end with NUL.');
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail('porcelain-z input contains invalid UTF-8.');
  }
  const fields = decoded.split('\0');
  const records: WorktreePorcelainRecord[] = [];
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
    // Bare repositories do not have a checked-out HEAD. Validate the whole
    // record so contradictory fields fail independently of their order.
    if (current.bare && current.headSha !== null) fail(`bare worktree ${current.path} cannot carry HEAD.`);
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
      assertLowercaseGitSha(headSha, 'HEAD');
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

// Porcelain v1 encodes conflict stages as these pairs, not arbitrary X/Y
// combinations containing U. DD and AA are valid conflicts without a U.
const UNMERGED_STATUS_PAIRS: ReadonlySet<string> = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Strict parser for `git status --porcelain=v1 -z` machine records. */
export function parseWorktreeStatusPorcelainZ(
  source: Buffer | Uint8Array,
  options: Readonly<{ allowDirectoryEntries?: boolean }> = {}
): WorktreeStatusPorcelainRecord[] {
  const allowDirectoryEntries = options.allowDirectoryEntries;
  if (allowDirectoryEntries !== undefined && typeof allowDirectoryEntries !== 'boolean') {
    throw new TypeError('Git status directory-entry policy must be boolean');
  }
  const bytes = snapshotByteView(source, 'Git machine reply');
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) fail('status porcelain-z input must end with NUL.');
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return fail('status porcelain-z input contains invalid UTF-8.');
  }
  const fields = decoded.split('\0');
  fields.pop();
  const records: WorktreeStatusPorcelainRecord[] = [];
  const allowed = new Set([' ', 'M', 'T', 'A', 'D', 'R', 'C', 'U', '?', '!']);
  const canonicalPath = (value: string, label: string, directoryEntry = false): string => {
    // Git's -z paths are already unquoted machine data. Backslashes are
    // filename bytes on POSIX, not separators; do not silently retarget them.
    // Only untracked/ignored directory records have a removable final slash.
    const selected = directoryEntry && allowDirectoryEntries !== false && value.endsWith('/')
      ? value.slice(0, -1) : value;
    if (!IsCanonicalRepositoryPath(selected)) {
      fail(`${label} is not one canonical repository-relative path.`);
    }
    return selected;
  };
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.length < 4 || field[2] !== ' ' || !allowed.has(field[0]!) || !allowed.has(field[1]!)) {
      fail(`unsupported status porcelain field: ${field}`);
    }
    const status = field.slice(0, 2);
    if (status === '  ' || (status.includes('?') && status !== '??') || (status.includes('!') && status !== '!!')
        || (status.includes('U') && !UNMERGED_STATUS_PAIRS.has(status))) {
      fail(`unsupported status pair: ${status}`);
    }
    const renamed = status.includes('R') || status.includes('C');
    const originalPath = renamed
      ? canonicalPath(fields[++index] ?? fail('rename/copy status lacks its original path.'), 'status originalPath')
      : null;
    records.push(Object.freeze({
      index: status[0]!,
      worktree: status[1]!,
      path: canonicalPath(field.slice(3), 'status path', status === '??' || status === '!!'),
      originalPath
    }));
  }
  const identities = new Set<string>();
  for (const record of records) {
    const identity = `${record.index}${record.worktree}\0${record.path}\0${record.originalPath ?? ''}`;
    if (identities.has(identity)) fail(`duplicate status record: ${record.path}`);
    identities.add(identity);
  }
  return records;
}

/** Decode Git's LF-terminated machine lines without generic whitespace
 * trimming or repairing invalid UTF-8. The transport already owns output
 * limits. This checks framing only, not repository or effect authority.
 * A CR before LF remains a path character on POSIX; it is not stripped as an
 * assumed CRLF. Object/path consumers validate their own records below.
 */
export function parseGitLineReply(
  source: Uint8Array, expectedRecords = 1
): readonly string[] | null {
  if (!Number.isSafeInteger(expectedRecords) || expectedRecords < 1) {
    throw new TypeError('Git line reply needs a positive record count');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(snapshotByteView(source, 'Git line reply'));
  } catch { return null; }
  if (!text.endsWith('\n') || text.includes('\0')) return null;
  const records = text.slice(0, -1).split('\n');
  if (records.length !== expectedRecords || records.some(value => value.length === 0)) return null;
  return Object.freeze(records);
}

/** Object IDs are one complete lowercase SHA-1/SHA-256 record. Whitespace,
 * extra records and a BOM are not alternate spellings of the same identity. */
export function parseGitObjectIdReply(
  source: Uint8Array, objectFormat?: 'sha1' | 'sha256'
): string | null {
  if (objectFormat !== undefined && objectFormat !== 'sha1' && objectFormat !== 'sha256') {
    throw new TypeError('Unsupported Git object format');
  }
  const value = parseGitLineReply(source)?.[0];
  if (value === undefined || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)
      || (objectFormat !== undefined && value.length !== (objectFormat === 'sha1' ? 40 : 64))) return null;
  return value;
}

/** Only for commands explicitly asked for --path-format=absolute. Host path
 * separator projection is retained, but data spaces/tabs/CR are not trimmed. */
export function parseGitAbsolutePathReply(source: Uint8Array): string | null {
  const value = parseGitLineReply(source)?.[0];
  return value === undefined || !path.isAbsolute(value) ? null : path.resolve(value);
}
