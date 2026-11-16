import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  assertTrustedBootstrapPreReceipt, assertTrustedBootstrapPreparedReceipt,
  assertTrustedBootstrapStableReceipt, parseTrustedBootstrapReceiptBytes,
  prepareTrustedBootstrapCheckerReceipt
} from '../../../src/execution/verification/trusted-bootstrap.ts';

// These protocol facts and rehashes are independent of the production builder.
const sha = (digit: string) => digit.repeat(40);
const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const hash = (value: object) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const subject = { baseSha: sha('a'), baseTreeSha: sha('b'), headSha: sha('c'), treeSha: sha('d'),
  registryDigest: digest('1'), checkerProgramDigest: digest('5') };
function semantic(): Record<string, unknown> {
  return {
    schema: 'sec-trusted-bootstrap-checker-receipt-v1', phase: 'pre',
    checkerBaseSha: sha('a'), baseTreeSha: sha('b'), candidateHeadSha: sha('c'),
    candidateTreeSha: sha('d'), candidateParentSha: sha('a'), registryDigest: digest('1'),
    checkerActionKey: digest('2'), checkerActionResultDigest: digest('3'), checkerClosureDigest: digest('3'),
    candidateActionKey: digest('4'), candidateActionResultDigest: digest('6'), candidateClosureDigest: digest('6'),
    candidateTrustRevision: 'fixture-trust', candidateModuleCount: 1, checkerProgramDigest: digest('5'),
    checkerToolBlob: sha('e'), checkerWorkflowBlob: sha('f'), candidateToolBlob: sha('e'), candidateWorkflowBlob: sha('f'),
    authorityVerdict: 'manual-bootstrap-required', authorityReason: 'fixture-policy-change',
    baseUndecidablePaths: ['src/policy.ts'], auxiliaryStatus: 'not-observed',
    sutEvidenceDigest: null, sutJobResult: null, sutDiagnosticDigest: null
  };
}
const receipt = (value: Record<string, unknown>) => ({ ...value, receiptDigest: hash(value) });
const withoutCandidate = (): Record<string, unknown> => ({ ...semantic(), candidateActionKey: null,
  candidateActionResultDigest: null, candidateClosureDigest: null,
  candidateTrustRevision: null, candidateModuleCount: null });
const post = () => ({ ...semantic(), phase: 'post', auxiliaryStatus: 'unavailable',
  sutJobResult: 'failure', sutDiagnosticDigest: digest('7') });

const malformed: Array<readonly [string, Record<string, unknown>, 'post'?]> = [
  ['fractional module count', { candidateModuleCount: 1.5 }],
  ['string module count', { candidateModuleCount: '1' }],
  ['zero module count', { candidateModuleCount: 0 }],
  ['unsafe module count', { candidateModuleCount: Number.MAX_SAFE_INTEGER + 1 }],
  ['null module count', { candidateModuleCount: null }],
  ['checker Action/closure mismatch', { checkerActionResultDigest: digest('7') }],
  ['candidate Action/closure mismatch', { candidateActionResultDigest: digest('7') }],
  ['candidate closure absent', { candidateActionResultDigest: null, candidateClosureDigest: null }],
  ['empty trust revision', { candidateTrustRevision: '' }],
  ['numeric trust revision', { candidateTrustRevision: 1 }],
  ['unknown authority verdict', { authorityVerdict: 'anything' }],
  ['empty authority reason', { authorityReason: '' }],
  ['numeric authority reason', { authorityReason: 1 }],
  ['unknown auxiliary status', { auxiliaryStatus: 'anything' }],
  ['nontext job result', { sutJobResult: 0 }],
  ['wrong schema', { schema: 'other' }],
  ['wrong phase', { phase: 'other' }],
  ['parent differs from base', { candidateParentSha: sha('f') }],
  ['PRE has POST status', { auxiliaryStatus: 'passed' }],
  ['PRE has POST evidence', { sutEvidenceDigest: digest('7') }],
  ['PRE has POST job result', { sutJobResult: 'success' }],
  ['PRE has POST diagnostic', { sutDiagnosticDigest: digest('7') }],
  ['duplicate paths', { baseUndecidablePaths: ['src/a.ts', 'src/a.ts'] }],
  ['nonarray paths', { baseUndecidablePaths: 'src/a.ts' }],
  // Full canonical-path grammar is shared with the V2 request contract;
  // retain this receipt-specific collection admission independently.
  ['noncanonical path "src/./a.ts"', { baseUndecidablePaths: ['src/./a.ts'] }]
];
// Equality-bound identities change together, so a relation failure cannot mask
// their lexical admission. Every other identity still has its own witness.
for (const fields of [['checkerBaseSha', 'candidateParentSha'], ['baseTreeSha'],
  ['candidateHeadSha'], ['candidateTreeSha'], ['checkerToolBlob'], ['checkerWorkflowBlob'],
  ['candidateToolBlob'], ['candidateWorkflowBlob']]) {
  malformed.push([`${fields.join('/')} rejects uppercase SHA`,
    Object.fromEntries(fields.map(field => [field, 'A'.repeat(40)]))]);
}
for (const value of ['g'.repeat(40), 'a'.repeat(39), null, 1]) {
  malformed.push([`SHA lexical grammar rejects ${JSON.stringify(value)}`, { checkerToolBlob: value }]);
}
for (const fields of [['registryDigest'], ['checkerActionKey'],
  ['checkerActionResultDigest', 'checkerClosureDigest'], ['checkerProgramDigest'],
  ['candidateActionKey'], ['candidateActionResultDigest', 'candidateClosureDigest'],
  ['sutEvidenceDigest'], ['sutDiagnosticDigest']]) {
  // POST permits SUT diagnostics; PRE's null-only rule must not reject first.
  malformed.push([`${fields.join('/')} rejects uppercase digest`,
    Object.fromEntries(fields.map(field => [field, `sha256:${'A'.repeat(64)}`])), 'post']);
}
for (const value of ['not-a-digest', 1, null]) {
  malformed.push([`mandatory digest grammar rejects ${JSON.stringify(value)}`, { registryDigest: value }]);
}
for (const [name, patch, phase] of malformed) {
  test(`checker grammar rejects ${name} before issuing a receipt`, () => {
    const value = { ...(phase === 'post' ? post() : semantic()), ...patch };
    expect(() => prepareTrustedBootstrapCheckerReceipt(value)).toThrow();
  });
}
for (const field of ['candidateActionResultDigest', 'candidateClosureDigest', 'candidateTrustRevision', 'candidateModuleCount']) {
  test(`absent candidate Action rejects independent ${field} residue`, () => {
    const value = { ...withoutCandidate(), [field]: semantic()[field] };
    expect(() => prepareTrustedBootstrapCheckerReceipt(value)).toThrow();
  });
}

test('exact checker receipt supports both candidate variants and immutable canonical roundtrip', () => {
  for (const value of [semantic(), withoutCandidate()]) {
    const prepared = prepareTrustedBootstrapCheckerReceipt(value);
    expect(prepared).toEqual(receipt(value));
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.baseUndecidablePaths)).toBe(true);
    const paths = value.baseUndecidablePaths as string[];
    paths.push('src/later.ts');
    expect(prepared.baseUndecidablePaths).toEqual(['src/policy.ts']);
    const decoded = parseTrustedBootstrapReceiptBytes(Buffer.from(JSON.stringify(prepared)));
    expect(decoded).toEqual(prepared);
    expect(() => assertTrustedBootstrapPreReceipt(decoded, subject)).not.toThrow();
    expect(() => assertTrustedBootstrapPreparedReceipt(decoded, prepared)).not.toThrow();
  }
});

for (const [verdict, auxiliary] of [
  ['passed', 'not-observed'], ['passed', 'unavailable'], ['failed', 'passed']
]) {
  test(`POST preserves ${verdict} authority independently of ${auxiliary} auxiliary data`, () => {
    const before = { ...semantic(), authorityVerdict: verdict };
    const after = { ...post(), authorityVerdict: verdict, auxiliaryStatus: auxiliary };
    expect(prepareTrustedBootstrapCheckerReceipt(after)).toEqual(receipt(after));
    expect(() => assertTrustedBootstrapStableReceipt(receipt(before), receipt(after))).not.toThrow();
  });
}

test('receipt guards reject field drift, stale digests, foreign subjects and copied POST', () => {
  const valid = receipt(semantic());
  expect(() => assertTrustedBootstrapPreReceipt(receipt({ ...semantic(), candidateModuleCount: 0 }), subject))
    .toThrow('Trusted bootstrap candidate Action fields are inconsistent.');
  const missing = { ...valid } as Record<string, unknown>;
  delete missing.authorityReason;
  for (const actual of [{ ...valid, extra: true }, missing, { ...valid, receiptDigest: digest('0') }, receipt(post())]) {
    expect(() => assertTrustedBootstrapPreReceipt(actual, subject)).toThrow();
  }
  for (const field of ['baseSha', 'baseTreeSha', 'headSha', 'treeSha', 'registryDigest', 'checkerProgramDigest']) {
    expect(() => assertTrustedBootstrapPreReceipt(valid, { ...subject, [field]: field.endsWith('Digest') ? digest('0') : sha('0') })).toThrow();
  }
  expect(() => assertTrustedBootstrapStableReceipt(valid, valid)).toThrow();
  expect(() => assertTrustedBootstrapStableReceipt(valid, { ...receipt(post()), receiptDigest: digest('0') })).toThrow();
  expect(() => assertTrustedBootstrapStableReceipt(valid, receipt({ ...post(), authorityReason: 'changed' }))).toThrow();
  expect(() => assertTrustedBootstrapStableReceipt(valid, receipt({ ...post(), authorityVerdict: 'passed' })))
    .toThrow('Trusted bootstrap PRE and POST candidate closure receipts differ.');
  expect(() => assertTrustedBootstrapPreparedReceipt(valid, { ...valid, receiptDigest: digest('0') })).toThrow();
  expect(() => assertTrustedBootstrapPreparedReceipt(receipt({ ...semantic(), authorityReason: 'changed' }), valid)).toThrow();
});

test('receipt byte entry preserves 32-MiB native limit, fatal UTF-8 and 32-container depth', () => {
  expect(() => parseTrustedBootstrapReceiptBytes(Buffer.from('{"nested":{"key":1,"key":2}}')))
    .toThrow('contains duplicate key "key"');
  expect(() => parseTrustedBootstrapReceiptBytes(Uint8Array.from([0xc3, 0x28]))).toThrow('UTF-8');
  const atLimit = Buffer.alloc(32 * 1024 * 1024, ' ');
  atLimit.write('{}');
  expect(parseTrustedBootstrapReceiptBytes(atLimit)).toEqual({});
  expect(() => parseTrustedBootstrapReceiptBytes(Buffer.alloc(atLimit.length + 1))).toThrow('maximum input size');
  expect(() => parseTrustedBootstrapReceiptBytes(Buffer.from('['.repeat(32) + '0' + ']'.repeat(32)))).not.toThrow();
  expect(() => parseTrustedBootstrapReceiptBytes(Buffer.from('['.repeat(33) + '0' + ']'.repeat(33)))).toThrow('depth');
});
