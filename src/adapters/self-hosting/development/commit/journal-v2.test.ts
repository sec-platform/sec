import { expect, test } from 'bun:test';

import { createContentIdentityRuntime } from '../../../../bootstrap/content-identity-runtime.ts';
import { parseDigest } from '../../../../contracts/digest.ts';
import { createOperationFoundationV2 } from '../../../../execution/operation/foundation-v2.ts';
import {
  DEVELOPMENT_COMMIT_JOURNAL_V2_SCHEMA,
  encodeDevelopmentCommitJournalV2,
  parseDevelopmentCommitJournalV2,
  type DevelopmentCommitJournalV2
} from './journal-v2.ts';

const identities = createContentIdentityRuntime().identity;
const operation = createOperationFoundationV2(identities);
const operationIdentity = identities.structuredIdentity('operation', 'intent/v2', { operation: 'development.commit' });
const boundAttemptIdentity = identities.structuredIdentity('operation', 'bound-attempt/v2', { attempt: 1 });
const attemptNonce = operation.issueAttemptContext({
  authorityGrant: operation.createReference({
    domain: 'authority', schema: 'grant/v1', digest: parseDigest(`sha256:${'a'.repeat(64)}`, 'sha256')
  })
}).nonce;

function journal(): DevelopmentCommitJournalV2 {
  return Object.freeze({
    schema: DEVELOPMENT_COMMIT_JOURNAL_V2_SCHEMA,
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

test('development commit journal v2 round-trips exact BLAKE3 identities and nonce semantics', () => {
  const source = encodeDevelopmentCommitJournalV2(journal());
  const parsed = parseDevelopmentCommitJournalV2(source);
  expect(parsed).toEqual(journal());
  expect(parsed.operationIdentity.digest.startsWith('blake3:')).toBe(true);
  expect(parsed.boundAttemptIdentity.digest.startsWith('blake3:')).toBe(true);
  expect(parsed.attemptNonce.startsWith('nonce256:')).toBe(true);
  expect(source).toBe(encodeDevelopmentCommitJournalV2(parsed));
});

test('development commit journal v2 rejects legacy digest substitution and noncanonical bytes', () => {
  const source = encodeDevelopmentCommitJournalV2(journal());
  const legacy = JSON.stringify({
    ...journal(),
    operationIdentity: `sha256:${'d'.repeat(64)}`
  }) + '\n';
  expect(() => parseDevelopmentCommitJournalV2(legacy)).toThrow();
  expect(() => parseDevelopmentCommitJournalV2(source.slice(0, -1))).toThrow(/bounded canonical JSON/u);
  expect(() => parseDevelopmentCommitJournalV2(source.replace('refs/heads/work', 'refs/heads/../bad')))
    .toThrow(/exact schema/u);
});
