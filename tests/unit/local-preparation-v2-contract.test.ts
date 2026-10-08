import { expect, test } from 'bun:test';

import {
  assertVerificationSessionLocalPreparationV2Current,
  CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA,
  CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA,
  CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
  createVerificationSessionLocalPreparationRequestV2,
  parseVerificationSessionHostedRequest,
  parseVerificationSessionLocalPreparationRequestV2,
  type VerificationSessionLocalPreparation,
  type VerificationSessionLocalPreparationRequestV2,
  type VerificationSessionLocalPreparationRequestV2Body
} from '../../src/adapters/verification/platform/ci/contract/session-request.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const SHA_A = '1'.repeat(40);
const SHA_B = '5'.repeat(40);

function body(): VerificationSessionLocalPreparationRequestV2Body {
  return {
    repository: 'sec-platform/sec', prNumber: 123,
    expectedBaseSha: SHA_A, expectedBaseTreeSha: '2'.repeat(40),
    expectedHeadSha: '3'.repeat(40), expectedHeadTreeSha: '4'.repeat(40),
    manifestPath: 'config/repository/work-packages/local.md', manifestDigest: DIGEST_A,
    profile: 'quick', authorizedPaths: ['src/a.ts', 'tests/unit/a.test.ts'],
    sourceFactsDigest: DIGEST_A, verificationPlanDigest: DIGEST_A,
    actorNodeId: 'MDQ6VXNlcjE=', sourceProgramBindingDigest: DIGEST_A,
    qualificationRequirements: {
      trustedRevision: SHA_A,
      producerIdentity: 'src/adapters/self-hosting/control/main-health/main-health-observation.ts',
      producerRuntimeIdentity: 'src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts',
      nativeProfileDigest: DIGEST_A, nativeContentManifestDigest: null,
      mainHealthMethodDigest: DIGEST_A, mainHealthPolicyDigest: DIGEST_A,
      verificationContractRevision: 'ci-verification-v19', reviewPolicyDigest: DIGEST_A,
      evidenceRequirementDigest: DIGEST_A, integrationPolicyDigest: DIGEST_A
    },
    purpose: 'verification-only'
  };
}

function envelope() { return createVerificationSessionLocalPreparationRequestV2(body()); }
function parse(value: unknown) { return parseVerificationSessionLocalPreparationRequestV2(JSON.stringify(value)); }

test('V2 source preparation round-trips into an immutable detached input, including unresolved native content', () => {
  const input = body();
  const value: VerificationSessionLocalPreparation = createVerificationSessionLocalPreparationRequestV2(input);
  expect(value.schema).toBe(CI_VERIFICATION_SESSION_LOCAL_PREPARATION_V2_SCHEMA);
  expect(parse(value)).toEqual(value);
  expect(value.request.qualificationRequirements.nativeContentManifestDigest).toBeNull();
  expect(value.request).not.toBe(input);
  expect(value.request.authorizedPaths).not.toBe(input.authorizedPaths);
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.isFrozen(value.request)).toBe(true);
  expect(Object.isFrozen(value.request.authorizedPaths)).toBe(true);
  expect(Object.isFrozen(value.request.qualificationRequirements)).toBe(true);
  expect(Object.isFrozen(input)).toBe(false);
  expect(() => assertVerificationSessionLocalPreparationV2Current(value, parse(value))).not.toThrow();
  const completeInput = body();
  expect(createVerificationSessionLocalPreparationRequestV2({ ...completeInput, profile: 'full',
    qualificationRequirements: { ...completeInput.qualificationRequirements, nativeContentManifestDigest: DIGEST_A } })
    .request.qualificationRequirements.nativeContentManifestDigest).toBe(DIGEST_A);
});

test('V2 digest preimages match independent canonical SHA-256 vectors and key order does not matter', () => {
  const value = envelope();
  // Fixed externally computed vectors bind every declared input and the operation domain.
  expect(value.request.requestDigest).toBe('sha256:5b313b8e73e3dfdcdc3060b335b46baac6e7b85e08ecb5e6a0a4ef8ed9c44aed');
  expect(value.request.requestOperationId).toBe('sha256:0c942f85e094bfa926f444bca504d7f9bc123dc41ac7a9e429d135ae19397fae');
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  reordered.request = Object.fromEntries(Object.entries(value.request).reverse());
  expect(parse(reordered)).toEqual(value);
});

const changedBodyCases: readonly (readonly [string, (value: VerificationSessionLocalPreparationRequestV2Body) => VerificationSessionLocalPreparationRequestV2Body])[] = [
  ['repository', value => ({ ...value, repository: 'sec-platform/other' })],
  ['prNumber', value => ({ ...value, prNumber: 124 })],
  ['expectedBaseSha and exact trustedRevision', value => ({ ...value, expectedBaseSha: SHA_B,
    qualificationRequirements: { ...value.qualificationRequirements, trustedRevision: SHA_B } })],
  ['expectedBaseTreeSha', value => ({ ...value, expectedBaseTreeSha: SHA_B })],
  ['expectedHeadSha', value => ({ ...value, expectedHeadSha: SHA_B })],
  ['expectedHeadTreeSha', value => ({ ...value, expectedHeadTreeSha: SHA_B })],
  ['manifestPath', value => ({ ...value, manifestPath: 'config/repository/work-packages/other.md' })],
  ['manifestDigest', value => ({ ...value, manifestDigest: DIGEST_B })],
  ['profile', value => ({ ...value, profile: 'full' })],
  ['authorizedPaths', value => ({ ...value, authorizedPaths: ['src/a.ts'] })],
  ['sourceFactsDigest', value => ({ ...value, sourceFactsDigest: DIGEST_B })],
  ['verificationPlanDigest', value => ({ ...value, verificationPlanDigest: DIGEST_B })],
  ['actorNodeId', value => ({ ...value, actorNodeId: 'USER_other' })],
  ['sourceProgramBindingDigest', value => ({ ...value, sourceProgramBindingDigest: DIGEST_B })],
  ...(['nativeProfileDigest', 'nativeContentManifestDigest', 'mainHealthMethodDigest', 'mainHealthPolicyDigest',
    'reviewPolicyDigest', 'evidenceRequirementDigest', 'integrationPolicyDigest'] as const).map(field =>
    [field, (value: VerificationSessionLocalPreparationRequestV2Body) => ({ ...value,
      qualificationRequirements: { ...value.qualificationRequirements, [field]: DIGEST_B } })] as const),
  ['verificationContractRevision', value => ({ ...value,
    qualificationRequirements: { ...value.qualificationRequirements, verificationContractRevision: 'ci-verification-v20' } })]
];

for (const [field, change] of changedBodyCases) {
  test(`V2 saved pin comparison rejects current ${field} drift even with recomputed valid digests`, () => {
    const saved = envelope();
    const current = createVerificationSessionLocalPreparationRequestV2(change(body()));
    expect(current.request.requestDigest).not.toBe(saved.request.requestDigest);
    expect(current.request.requestOperationId).not.toBe(saved.request.requestOperationId);
    expect(() => assertVerificationSessionLocalPreparationV2Current(saved, current)).toThrow('differs from current exact source');
    expect(() => assertVerificationSessionLocalPreparationV2Current(current, saved)).toThrow('differs from current exact source');
    const { requestDigest: _digest, requestOperationId: _operation, ...changed } = current.request;
    expect(() => parse({ ...saved, request: { ...changed,
      requestDigest: saved.request.requestDigest, requestOperationId: saved.request.requestOperationId } })).toThrow('requestDigest mismatch');
  });
}

test('V2 fixed producer, trust, purpose, schema, and placement requirements cannot be changed', () => {
  const value = envelope();
  for (const invalid of [
    { ...value, schema: CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA },
    { ...value, executionPlacement: 'hosted' }, { ...value, authorityStage: 'qualified' },
    { ...value, request: { ...value.request, purpose: 'integration' } },
    ...[
      { trustedRevision: SHA_B },
      { trustedRevision: 'main' },
      { producerIdentity: 'caller-selected-health-producer' },
      { producerRuntimeIdentity: 'caller-selected-runtime' }
    ].map(change => ({ ...value, request: { ...value.request,
      qualificationRequirements: { ...value.request.qualificationRequirements, ...change } } }))
  ]) expect(() => parse(invalid)).toThrow();
});

test('V2 digest and operation tampering fail independently, on both sides of saved/current comparison', () => {
  const value = envelope();
  for (const field of ['requestDigest', 'requestOperationId'] as const) {
    const tampered = { ...value, request: { ...value.request, [field]: DIGEST_B } };
    expect(() => parse(tampered)).toThrow(`${field} mismatch`);
    expect(() => assertVerificationSessionLocalPreparationV2Current(tampered, value)).toThrow(`${field} mismatch`);
    expect(() => assertVerificationSessionLocalPreparationV2Current(value, tampered)).toThrow(`${field} mismatch`);
  }
});

test('V2 rejects every missing or unknown field rather than silently discarding identity inputs', () => {
  const value = envelope();
  for (const [record, wrap] of [
    [value, (record: unknown) => record],
    [value.request, (record: unknown) => ({ ...value, request: record })],
    [value.request.qualificationRequirements, (record: unknown) => ({ ...value,
      request: { ...value.request, qualificationRequirements: record } })]
  ] as const) {
    expect(() => parse(wrap({ ...record, unexpected: true }))).toThrow();
    for (const key of Object.keys(record)) {
      const missing: Record<string, unknown> = { ...record };
      delete missing[key];
      expect(() => parse(wrap(missing)), key).toThrow();
    }
  }
  expect(() => createVerificationSessionLocalPreparationRequestV2({ ...body(), requestDigest: DIGEST_A } as never)).toThrow();
  expect(() => createVerificationSessionLocalPreparationRequestV2({ ...body(), ignored: undefined } as never)).toThrow();
  for (const invalid of [null, [], 1, 'input', { ...value, request: null },
    { ...value, request: { ...value.request, qualificationRequirements: [] } }]) {
    expect(() => parse(invalid)).toThrow();
  }
});

test('V2 exact JSON rejects duplicate keys at every level, including escaped equivalent keys', () => {
  const source = JSON.stringify(envelope());
  for (const invalid of [
    source.replace('"schema":', '"schema":"ignored","schema":'),
    source.replace('"repository":', '"repository":"ignored","repository":'),
    source.replace('"trustedRevision":', '"trustedRevision":"ignored","trustedRevision":'),
    source.replace('"purpose":', '"purpo\\u0073e":"verification-only","purpose":')
  ]) expect(() => parseVerificationSessionLocalPreparationRequestV2(invalid)).toThrow('duplicate key');
});

test('V2 rejects malformed scalar pins, unsupported fast profile, and unbounded identity text', () => {
  const value = envelope();
  for (const change of [
    { repository: '../sec' }, { repository: 'owner/repo/extra' }, { repository: 'owner/repo ' }, { repository: 'owner/repo\n' },
    { repository: 'https://github.com/owner/repo' }, { prNumber: 0 }, { prNumber: -1 },
    { prNumber: 1.5 }, { prNumber: Number.MAX_SAFE_INTEGER + 1 }, { prNumber: '123' },
    { expectedBaseSha: 'A'.repeat(40) }, { expectedBaseTreeSha: 'a'.repeat(39) },
    { expectedHeadSha: 'a'.repeat(64) }, { expectedHeadTreeSha: 'g'.repeat(40) },
    { manifestDigest: 'sha256:bad' }, { sourceFactsDigest: `blake3:${'a'.repeat(64)}` },
    { verificationPlanDigest: `sha256:${'A'.repeat(64)}` }, { sourceProgramBindingDigest: null },
    { profile: 'fast' }, { profile: 'FULL' }, { actorNodeId: '' },
    { actorNodeId: 'x'.repeat(257) }, { actorNodeId: 'USER other' }, { actorNodeId: 'USER\u0000other' }
  ]) expect(() => parse({ ...value, request: { ...value.request, ...change } })).toThrow();
  for (const change of [
    { nativeProfileDigest: null }, { nativeContentManifestDigest: '' }, { mainHealthMethodDigest: 'bad' },
    { mainHealthPolicyDigest: 'bad' }, { reviewPolicyDigest: 'bad' },
    { evidenceRequirementDigest: 'bad' }, { integrationPolicyDigest: 'bad' },
    { verificationContractRevision: '' }, { verificationContractRevision: 'x'.repeat(257) },
    { verificationContractRevision: 'revision\nnext' }, { verificationContractRevision: ' revision' }
  ]) expect(() => parse({ ...value, request: { ...value.request,
    qualificationRequirements: { ...value.request.qualificationRequirements, ...change } } })).toThrow();
});

test('V2 rejects traversal, noncanonical spelling, unsorted paths and duplicate scope entries', () => {
  const value = envelope();
  for (const invalidPath of ['../escape', 'src/../escape', './src/a.ts', '/absolute', 'src//a.ts',
    'src\\a.ts', 'C:/src/a.ts', 'src/', '', 'src/\u0000a.ts', 'src/e\u0301.ts']) {
    expect(() => parse({ ...value, request: { ...value.request, manifestPath: invalidPath } })).toThrow('manifestPath');
    expect(() => parse({ ...value, request: { ...value.request, authorizedPaths: [invalidPath] } })).toThrow('authorizedPaths');
  }
  for (const authorizedPaths of [['b.ts', 'a.ts'], ['a.ts', 'a.ts'], null, ['a.ts', 1]]) {
    expect(() => parse({ ...value, request: { ...value.request, authorizedPaths } })).toThrow('authorizedPaths');
  }
});

test('V2 decoding has byte and container-depth bounds before accepting any request', () => {
  expect(() => parseVerificationSessionLocalPreparationRequestV2(' '.repeat(1024 * 1024 + 1))).toThrow('bounded UTF-8 input size');
  expect(() => parseVerificationSessionLocalPreparationRequestV2('é'.repeat(524289))).toThrow('bounded UTF-8 input size');
  expect(() => parseVerificationSessionLocalPreparationRequestV2('{"request":{"extra":{"nested":{"deeper":{}}}}}'))
    .toThrow('maximum container depth');
  expect(() => parseVerificationSessionLocalPreparationRequestV2(`${JSON.stringify(envelope())} trailing`)).toThrow();
});

test('hosted parser rejects both local versions while preserving exact legacy hosted requests', () => {
  const hosted = {
    schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA, prNumber: 123,
    expectedBaseSha: SHA_A, expectedBaseTreeSha: '2'.repeat(40),
    expectedHeadSha: '3'.repeat(40), expectedHeadTreeSha: '4'.repeat(40),
    manifestPath: 'work-packages/legacy.json', manifestDigest: DIGEST_A, profile: 'fast',
    expectedScopeProposalDigest: DIGEST_A, expectedActionPlanDigest: DIGEST_A,
    expectedSessionRevision: DIGEST_A, reviewPolicyDigest: DIGEST_A, requestOperationId: DIGEST_A
  };
  expect(parseVerificationSessionHostedRequest(JSON.stringify(hosted))).toEqual(hosted);
  const legacy: VerificationSessionLocalPreparation = {
    schema: CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA,
    executionPlacement: 'local', authorityStage: 'preparation-only', request: hosted
  };
  for (const local of [legacy, envelope()]) {
    expect(() => parseVerificationSessionHostedRequest(JSON.stringify(local))).toThrow('cannot be consumed by a hosted operation');
  }
});

test('copied valid V2 JSON remains input-only and cannot carry caller-authored qualification or Session state', () => {
  const copied: VerificationSessionLocalPreparationRequestV2 = JSON.parse(JSON.stringify(envelope()));
  const parsed = parse(copied);
  expect(parsed.authorityStage).toBe('preparation-only');
  expect(parsed.request.qualificationRequirements.nativeContentManifestDigest).toBeNull();
  for (const extra of [
    { qualified: true }, { mainHealth: { status: 'healthy' } },
    { session: { sessionRevision: DIGEST_A } }, { actionPlanClosure: { actionPlanDigest: DIGEST_A } },
    { integrationAuthorization: DIGEST_A }
  ]) expect(() => parse({ ...copied, request: { ...copied.request, ...extra } })).toThrow();
});
