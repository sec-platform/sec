import { expect, test } from 'bun:test';

import { createContentIdentityRuntime } from '../../../../bootstrap/content-identity-runtime.ts';
import { parseDigest } from '../../../../contracts/digest.ts';
import { createOperationFoundation } from '../../../../execution/operation/identity-foundation.ts';
import {
  DEVELOPMENT_COMMIT_JOURNAL_SCHEMA,
  encodeDevelopmentCommitJournal,
  parseDevelopmentCommitJournal,
  type DevelopmentCommitJournal
} from './journal-contract.ts';

const identities = createContentIdentityRuntime().identity;
const operation = createOperationFoundation(identities);
const operationIdentity = identities.structuredIdentity('operation', 'intent', { operation: 'development.commit' });
const boundAttemptIdentity = identities.structuredIdentity('operation', 'bound-attempt', { attempt: 1 });
const attemptNonce = operation.issueAttemptContext({
  authorityGrant: operation.createReference({
    domain: 'authority', schema: 'grant', digest: parseDigest(`sha256:${'a'.repeat(64)}`, 'sha256')
  })
}).nonce;

function journal(): DevelopmentCommitJournal {
  return Object.freeze({
    schema: DEVELOPMENT_COMMIT_JOURNAL_SCHEMA,
    operationIdentity,
    boundAttemptIdentity,
    attemptNonce,
    ref: 'refs/heads/work',
    preimage: 'a'.repeat(40),
    target: 'b'.repeat(40),
    object: null,
    tree: 'c'.repeat(40),
    terminal: null
  });
}

test('development commit journal round-trips exact BLAKE3 identities and nonce semantics', () => {
  const source = encodeDevelopmentCommitJournal(journal());
  const parsed = parseDevelopmentCommitJournal(source);
  expect(parsed).toEqual(journal());
  expect(parsed.operationIdentity.digest.startsWith('blake3:')).toBe(true);
  expect(parsed.boundAttemptIdentity.digest.startsWith('blake3:')).toBe(true);
  expect(parsed.attemptNonce.startsWith('nonce256:')).toBe(true);
  expect(source).toBe(encodeDevelopmentCommitJournal(parsed));
});

test('development commit journal rejects legacy digest substitution and noncanonical bytes', () => {
  const source = encodeDevelopmentCommitJournal(journal());
  const legacy = JSON.stringify({
    ...journal(),
    operationIdentity: `sha256:${'d'.repeat(64)}`
  }) + '\n';
  expect(() => parseDevelopmentCommitJournal(legacy)).toThrow();
  expect(() => parseDevelopmentCommitJournal(source.slice(0, -1))).toThrow(/bounded canonical JSON/u);
  expect(() => parseDevelopmentCommitJournal(source.replace('refs/heads/work', 'refs/heads/../bad')))
    .toThrow(/exact schema/u);
});
