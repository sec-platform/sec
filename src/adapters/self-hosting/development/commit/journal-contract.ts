import { canonicalJson } from '../../../../contracts/canonical.ts';
import { parseIdentity, type Identity } from '../../../../contracts/identity-profile.ts';
import {
  isOperationAttemptNonce,
  type OperationAttemptNonce
} from '../../../../execution/operation/identity-foundation.ts';

export const DEVELOPMENT_COMMIT_JOURNAL_SCHEMA = 'sec-development-commit-journal' as const;
export const DEVELOPMENT_COMMIT_JOURNAL_MAXIMUM_BYTES = 4096;

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;
const KEYS = [
  'attemptNonce',
  'boundAttemptIdentity',
  'object',
  'operationIdentity',
  'preimage',
  'ref',
  'schema',
  'target',
  'terminal',
  'tree'
] as const;

export type DevelopmentCommitJournal = Readonly<{
  readonly schema: typeof DEVELOPMENT_COMMIT_JOURNAL_SCHEMA;
  readonly operationIdentity: Identity<'operation', 'intent'>;
  readonly boundAttemptIdentity: Identity<'operation', 'bound-attempt'>;
  readonly attemptNonce: OperationAttemptNonce;
  readonly ref: string;
  readonly preimage: string;
  readonly target: string;
  readonly object: string | null;
  readonly tree: string;
  readonly terminal: 'applied' | 'not-applied' | 'unknown' | null;
}>;

function boundedObjectId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
    throw new Error(`${label} must be one Git object id.`);
  }
  return value;
}

export function encodeDevelopmentCommitJournal(journal: DevelopmentCommitJournal): string {
  const source = `${JSON.stringify(canonicalJson(journal))}\n`;
  if (Buffer.byteLength(source, 'utf8') > DEVELOPMENT_COMMIT_JOURNAL_MAXIMUM_BYTES) {
    throw new Error('Development commit journal exceeds its byte ceiling.');
  }
  return source;
}

export function parseDevelopmentCommitJournal(source: string): DevelopmentCommitJournal {
  if (Buffer.byteLength(source, 'utf8') > DEVELOPMENT_COMMIT_JOURNAL_MAXIMUM_BYTES || !source.endsWith('\n')) {
    throw new Error('Development commit journal is not bounded canonical JSON.');
  }
  const value = JSON.parse(source.slice(0, -1)) as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(KEYS)
      || value.schema !== DEVELOPMENT_COMMIT_JOURNAL_SCHEMA
      || typeof value.attemptNonce !== 'string' || !isOperationAttemptNonce(value.attemptNonce)
      || typeof value.ref !== 'string' || !REF.test(value.ref)
      || (value.object !== null && (typeof value.object !== 'string' || !OBJECT_ID.test(value.object)))
      || ![null, 'applied', 'not-applied', 'unknown'].includes(value.terminal as never)) {
    throw new Error('Development commit journal violates its exact schema.');
  }
  const journal = Object.freeze({
    schema: DEVELOPMENT_COMMIT_JOURNAL_SCHEMA,
    operationIdentity: parseIdentity(value.operationIdentity, 'operation', 'intent'),
    boundAttemptIdentity: parseIdentity(value.boundAttemptIdentity, 'operation', 'bound-attempt'),
    attemptNonce: value.attemptNonce,
    ref: value.ref,
    preimage: boundedObjectId(value.preimage, 'Development commit journal preimage'),
    target: boundedObjectId(value.target, 'Development commit journal target'),
    object: value.object === null ? null : boundedObjectId(value.object, 'Development commit journal object'),
    tree: boundedObjectId(value.tree, 'Development commit journal tree'),
    terminal: value.terminal as DevelopmentCommitJournal['terminal']
  });
  if (encodeDevelopmentCommitJournal(journal) !== source) {
    throw new Error('Development commit journal bytes are noncanonical.');
  }
  return journal;
}
