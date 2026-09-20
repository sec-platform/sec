import { cloneAndDeepFreeze, isPlainObject } from '../contracts/canonical.ts';
import { SecError } from '../contracts/failure.ts';

const candidateBrand: unique symbol = Symbol('author-candidate');

/** Invocation-local identity, not a serialized revision, content digest or write
 * permission. The workspace owns source values; candidates have no mutable head. */
export interface AuthorCandidate<Value> {
  readonly [candidateBrand]: true;
  readonly revision: number;
  readonly parentRevision: number | null;
  readonly content: Value;
}

export interface AuthorSavePlan<Value> {
  readonly expected: AuthorCandidate<Value>;
  readonly candidate: AuthorCandidate<Value>;
  readonly before: Value;
  readonly after: Value;
}

export interface AuthorWorkspace<Value> {
  readonly initial: AuthorCandidate<Value>;
  read(candidate: AuthorCandidate<Value>): Value;
  fork(base: AuthorCandidate<Value>, content: Value): AuthorCandidate<Value>;
  planSave(expected: AuthorCandidate<Value>, candidate: AuthorCandidate<Value>): AuthorSavePlan<Value>;
}

const candidateOwners = new WeakMap<object, object>();

/** Capture plain structured author values, including erroneous domain drafts.
 * Domain validation belongs to semantics, not candidate creation. Mutable
 * collection internal slots cannot be made immutable by Object.freeze. */
function capture<Value>(input: Value): Value {
  const value = cloneAndDeepFreeze(input);
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    if (!Array.isArray(current) && !isPlainObject(current)) {
      throw new SecError('AUTHOR-CANDIDATE-001', 'This author profile accepts only plain structured values');
    }
    visited.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined && 'value' in descriptor) pending.push(descriptor.value);
    }
  }
  return value;
}

export function readAuthorCandidate<Value>(candidate: AuthorCandidate<Value>): Value {
  if (candidate === null || typeof candidate !== 'object' || !candidateOwners.has(candidate)) {
    throw new SecError('AUTHOR-CANDIDATE-002', 'Author candidate was not issued by a workspace');
  }
  return candidate.content;
}

/** A memory workspace needs neither a database nor a filesystem watcher.
 * Strong candidate references pin their source; the weak owner index does not
 * keep abandoned drafts alive. Saving is a separate effect owned by execution. */
export function createAuthorWorkspace<Value>(initial: Value): AuthorWorkspace<Value> {
  const owner = Object.freeze({});
  let revision = 0;
  const own = (candidate: AuthorCandidate<Value>): void => {
    readAuthorCandidate(candidate);
    if (candidateOwners.get(candidate) !== owner) {
      throw new SecError('AUTHOR-CANDIDATE-003', 'Author candidate belongs to a different workspace');
    }
  };
  const issue = (content: Value, parentRevision: number | null): AuthorCandidate<Value> => {
    const captured = capture(content);
    if (!Number.isSafeInteger(revision + 1)) throw new SecError('AUTHOR-CANDIDATE-004', 'Workspace revision space is exhausted');
    const candidate: AuthorCandidate<Value> = Object.freeze({
      [candidateBrand]: true as const, revision: ++revision, parentRevision, content: captured
    });
    candidateOwners.set(candidate, owner);
    return candidate;
  };
  return Object.freeze({
    initial: issue(initial, null),
    read: (candidate: AuthorCandidate<Value>) => { own(candidate); return candidate.content; },
    fork: (base: AuthorCandidate<Value>, content: Value) => {
      own(base);
      return issue(content, base.revision);
    },
    planSave: (expected: AuthorCandidate<Value>, candidate: AuthorCandidate<Value>) => {
      own(expected); own(candidate);
      // This is a pure before/after selection. It neither asserts that expected
      // is the actual saved head nor permits a writer to skip current readback.
      return Object.freeze({ expected, candidate, before: expected.content, after: candidate.content });
    }
  });
}
