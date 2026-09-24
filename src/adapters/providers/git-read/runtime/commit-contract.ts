import path from 'node:path';
import { sha256 } from '../../../../contracts/canonical.ts';
import { isDigest } from '../../../../contracts/digest.ts';
import { isObjectId, parseObjectId, type ObjectFormat, type ObjectId } from '../../../../contracts/git-object-id.ts';
import type { OperationDigest } from '../../../../execution/operation/semantic.ts';

export type GitCommitIdentity = Readonly<{
  readonly name: string;
  readonly email: string;
  /** Git internal date: `<unix-seconds> <+|->HHMM`. */
  readonly date: string;
}>;

export type GitCommitTreeInput = Readonly<{
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly author: GitCommitIdentity;
  readonly committer: GitCommitIdentity;
}>;

export type GitDevelopmentCommitContract = GitCommitTreeInput & Readonly<{
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly ref: string;
  readonly expectedOld: string;
  readonly target: string;
  readonly signing: 'disabled';
  readonly hooks: 'disabled';
  readonly preflightReceiptDigest: OperationDigest;
}>;

export type GitDevelopmentCommitEffectResult = Readonly<
  | { readonly status: 'completed'; readonly object: string }
  | { readonly status: 'cas-conflict'; readonly object: string }
  | { readonly status: 'unavailable'; readonly reason: 'operation-not-authorized' | 'invalid-contract' | 'provider-failed' | 'index-drift' | 'target-mismatch'; readonly detail?: string }
>;

const GIT_COMMIT_REF_PATTERN = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;
// Git strips this ASCII edge set from identity fields. Refuse such input
// rather than authorize one identity and persist a different one. Interior
// punctuation and non-ASCII whitespace remain data, not generic trim targets.
const GIT_IDENTITY_EDGE = /^[\x00-\x20,:;<>"\\']|[\x00-\x20,:;<>"\\']$/u;
// Supported Git hosts use unsigned 64-bit timestamps; UINT64_MAX is the
// parser's invalid sentinel, not a serializable commit timestamp. Compare
// decimal text without losing precision through JavaScript Number.
const GIT_TIMESTAMP_MAX = '18446744073709551614';
const GIT_INTERNAL_DATE_PATTERN = /^(?:0|[1-9][0-9]*) [+-][0-9]{4}$/u;

/** This owner's existing ASCII branch namespace is narrower than arbitrary Git
 * refs. Keep that policy, but also reject the component forms Git cannot store.
 * Do not normalize a requested CAS target into a different reference.
 */
function canonicalCommitRef(value: unknown): value is string {
  return typeof value === 'string' && GIT_COMMIT_REF_PATTERN.test(value)
    && !value.includes('..') && !value.endsWith('.')
    && value.split('/').every(segment => segment.length > 0
      && !segment.startsWith('.') && !segment.endsWith('.lock'));
}

function canonicalCommitIdentity(input: GitCommitIdentity): GitCommitIdentity | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const { name, email, date } = input;
  if (typeof name !== 'string' || typeof email !== 'string' || typeof date !== 'string'
      || name.length === 0 || name.length > 256 || email.length < 3 || email.length > 320
      || /[\0\r\n<>\p{Surrogate}]/u.test(name) || /[\0\r\n<>\p{Surrogate}]/u.test(email)
      || GIT_IDENTITY_EDGE.test(name) || GIT_IDENTITY_EDGE.test(email)
      || date.length > GIT_TIMESTAMP_MAX.length + 6 || !GIT_INTERNAL_DATE_PATTERN.test(date)) return null;
  const [seconds, zone] = date.split(' ') as [string, string];
  if (seconds.length > GIT_TIMESTAMP_MAX.length
      || (seconds.length === GIT_TIMESTAMP_MAX.length && seconds > GIT_TIMESTAMP_MAX)
      || zone === '-0000') return null;
  const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(3, 5));
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return Object.freeze({ name, email, date });
}

/** Capture data, not a commit capability. Every consumer still needs the
 * original exact contract digest and production session/operation binding. */
export function canonicalCommitTreeInput(input: GitCommitTreeInput): GitCommitTreeInput | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const { tree, parents, message, author: requestedAuthor, committer: requestedCommitter } = input;
  const author = canonicalCommitIdentity(requestedAuthor), committer = canonicalCommitIdentity(requestedCommitter);
  const parent = Array.isArray(parents) && parents.length === 1
    ? Object.getOwnPropertyDescriptor(parents, '0') : undefined;
  if (typeof tree !== 'string' || !isObjectId(tree)
      || parent === undefined || !('value' in parent) || typeof parent.value !== 'string'
      || typeof message !== 'string'
      || message.length === 0 || Buffer.byteLength(message, 'utf8') > 64 * 1024
      || /[\0\p{Surrogate}]/u.test(message) || author === null || committer === null) return null;
  // Agreement inside a proposed contract is not a repository observation.
  // The production Git session still binds the repository's actual format.
  const format: ObjectFormat = tree.length === 40 ? 'sha1' : 'sha256';
  let parentObject: ObjectId;
  try {
    parentObject = parseObjectId(parent.value, format);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
  return Object.freeze({ tree, parents: Object.freeze([parentObject]), message, author, committer });
}

export function captureGitDevelopmentCommitContract(input: GitDevelopmentCommitContract): GitDevelopmentCommitContract | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const { repositoryRoot, worktreeRoot, ref, expectedOld, target, signing, hooks, preflightReceiptDigest } = input;
  const tree = canonicalCommitTreeInput(input);
  if (tree === null || typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)
      || /[\0\p{Surrogate}]/u.test(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot
      || typeof worktreeRoot !== 'string' || /[\0\p{Surrogate}]/u.test(worktreeRoot)
      || !path.isAbsolute(worktreeRoot) || path.resolve(worktreeRoot) !== worktreeRoot
      || !canonicalCommitRef(ref) || expectedOld !== tree.parents[0]
      || typeof target !== 'string' || !isObjectId(target, tree.tree.length === 40 ? 'sha1' : 'sha256')
      || signing !== 'disabled' || hooks !== 'disabled' || typeof preflightReceiptDigest !== 'string'
      || !isDigest(preflightReceiptDigest, 'sha256')) return null;
  return Object.freeze({ repositoryRoot, worktreeRoot, ref, expectedOld, target, ...tree,
    signing, hooks, preflightReceiptDigest });
}

export function compileGitDevelopmentCommitContractDigest(input: GitDevelopmentCommitContract): OperationDigest {
  const captured = captureGitDevelopmentCommitContract(input);
  if (captured === null) throw new Error('Git development commit contract is not canonical.');
  return sha256({ schema: 'sec-development-commit-git-contract-v1', ...captured }) as OperationDigest;
}

/** Encode one already-admitted identity for Git's environment date parser.
 * The leading @ selects raw seconds (including epoch 0); it is a transport
 * marker, not a change to the stored identity or the contract digest domain.
 * The base is already issuer-isolated and may retain exact scratch selectors.
 * Do not rerun ambient filtering and accidentally discard those capabilities.
 */
export function gitCommitEnvironment(
  input: GitCommitTreeInput,
  base: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  return Object.freeze({
    ...base,
    GIT_AUTHOR_NAME: input.author.name,
    GIT_AUTHOR_EMAIL: input.author.email,
    GIT_AUTHOR_DATE: `@${input.author.date}`,
    GIT_COMMITTER_NAME: input.committer.name,
    GIT_COMMITTER_EMAIL: input.committer.email,
    GIT_COMMITTER_DATE: `@${input.committer.date}`
  });
}
