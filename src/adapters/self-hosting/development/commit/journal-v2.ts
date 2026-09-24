import { canonicalJson } from '../../../../contracts/canonical.ts';
import { parseIdentity, type Identity } from '../../../../contracts/identity-profile.ts';
import {
  isOperationAttemptNonceV2,
  type OperationAttemptNonceV2
} from '../../../../execution/operation/foundation-v2.ts';

export const DEVELOPMENT_COMMIT_JOURNAL_V2_SCHEMA = 'sec-development-commit-journal-v2' as const;
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

export type DevelopmentCommitJournalV2 = Readonly<{
  readonly schema: typeof DEVELOPMENT_COMMIT_JOURNAL_V2_SCHEMA;
  readonly operationIdentity: Identity<'operation', 'intent/v2'>;
  readonly boundAttemptIdentity: Identity<'operation', 'bound-attempt/v2'>;
  readonly attemptNonce: OperationAttemptNonceV2;
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

export function encodeDevelopmentCommitJournalV2(journal: DevelopmentCommitJournalV2): string {
  const source = `${JSON.stringify(canonicalJson(journal))}\n`;
  if (Buffer.byteLength(source, 'utf8') > DEVELOPMENT_COMMIT_JOURNAL_MAXIMUM_BYTES) {
    throw new Error('Development commit journal v2 exceeds its byte ceiling.');
  }
  return source;
}

export function parseDevelopmentCommitJournalV2(source: string): DevelopmentCommitJournalV2 {
  if (Buffer.byteLength(source, 'utf8') > DEVELOPMENT_COMMIT_JOURNAL_MAXIMUM_BYTES || !source.endsWith('\n')) {
    throw new Error('Development commit journal v2 is not bounded canonical JSON.');
  }
  const value = JSON.parse(source.slice(0, -1)) as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(KEYS)
      || value.schema !== DEVELOPMENT_COMMIT_JOURNAL_V2_SCHEMA
      || typeof value.attemptNonce !== 'string' || !isOperationAttemptNonceV2(value.attemptNonce)
      || typeof value.ref !== 'string' || !REF.test(value.ref)
      || (value.object !== null && (typeof value.object !== 'string' || !OBJECT_ID.test(value.object)))
      || ![null, 'applied', 'not-applied', 'unknown'].includes(value.terminal as never)) {
    throw new Error('Development commit journal v2 violates its exact schema.');
  }
  const journal = Object.freeze({
    schema: DEVELOPMENT_COMMIT_JOURNAL_V2_SCHEMA,
    operationIdentity: parseIdentity(value.operationIdentity, 'operation', 'intent/v2'),
    boundAttemptIdentity: parseIdentity(value.boundAttemptIdentity, 'operation', 'bound-attempt/v2'),
    attemptNonce: value.attemptNonce,
    ref: value.ref,
    preimage: boundedObjectId(value.preimage, 'Development commit journal v2 preimage'),
    target: boundedObjectId(value.target, 'Development commit journal v2 target'),
    object: value.object === null ? null : boundedObjectId(value.object, 'Development commit journal v2 object'),
    tree: boundedObjectId(value.tree, 'Development commit journal v2 tree'),
    terminal: value.terminal as DevelopmentCommitJournalV2['terminal']
  });
  if (encodeDevelopmentCommitJournalV2(journal) !== source) {
    throw new Error('Development commit journal v2 bytes are noncanonical.');
  }
  return journal;
}
