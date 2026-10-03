import { expect, test } from 'bun:test';

import { CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA, CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { createVerificationSessionLocalPreparationRequest, createVerificationSessionPerJobHostedRequest, parseVerificationSessionHostedRequest } from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';

const pins = Object.freeze({
  prNumber: 17,
  expectedBaseSha: '1'.repeat(40), expectedBaseTreeSha: '2'.repeat(40),
  expectedHeadSha: '3'.repeat(40), expectedHeadTreeSha: '4'.repeat(40),
  manifestPath: 'work/package.json', manifestDigest: `sha256:${'5'.repeat(64)}` as const,
  profile: 'full', expectedScopeProposalDigest: `sha256:${'6'.repeat(64)}` as const,
  expectedActionPlanDigest: `sha256:${'7'.repeat(64)}` as const,
  expectedSessionRevision: `sha256:${'8'.repeat(64)}` as const,
  reviewPolicyDigest: `sha256:${'9'.repeat(64)}` as const
});

test('per-job request binds an explicit placement and all candidate pins into its operation identity', () => {
  const request = createVerificationSessionPerJobHostedRequest(pins);
  expect(request.schema).toBe(CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA);
  expect(request.placement).toBe('github-hosted-per-job-v1');
  expect(parseVerificationSessionHostedRequest(JSON.stringify(request))).toEqual(request);
  expect(createVerificationSessionPerJobHostedRequest({ ...pins, prNumber: 18 }).requestOperationId)
    .not.toBe(request.requestOperationId);
  expect(() => parseVerificationSessionHostedRequest(JSON.stringify({ ...request, prNumber: 18 })))
    .toThrow('operation identity mismatch');
});

test('legacy wire identity remains legacy and cannot acquire per-job placement by an extra field', () => {
  const legacy = { ...pins, schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
    requestOperationId: `sha256:${'a'.repeat(64)}` as const };
  expect(parseVerificationSessionHostedRequest(JSON.stringify(legacy))).toEqual(legacy);
  expect(() => parseVerificationSessionHostedRequest(JSON.stringify({ ...legacy,
    placement: 'github-hosted-per-job-v1' }))).toThrow('exactly');
});

test('per-job wire rejects missing or unknown placement, copied operation IDs and duplicate keys', () => {
  const request = createVerificationSessionPerJobHostedRequest(pins);
  const { placement: _placement, ...missing } = request;
  expect(() => parseVerificationSessionHostedRequest(JSON.stringify(missing))).toThrow('exactly');
  expect(() => parseVerificationSessionHostedRequest(JSON.stringify({ ...request, placement: 'self-hosted' })))
    .toThrow('placement mismatch');
  expect(() => parseVerificationSessionHostedRequest(JSON.stringify({ ...request,
    requestOperationId: `sha256:${'a'.repeat(64)}` }))).toThrow('operation identity mismatch');
  expect(() => parseVerificationSessionHostedRequest(JSON.stringify(request)
    .replace('"prNumber":17', '"prNumber":17,"prNumber":17'))).toThrow();
  expect(() => createVerificationSessionLocalPreparationRequest(request)).toThrow('cannot wrap');
});

test('the constructor cannot be redirected to the legacy schema by extra runtime fields', () => {
  const request = createVerificationSessionPerJobHostedRequest({ ...pins,
    ...{ schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA, placement: undefined } });
  expect(request.schema).toBe(CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA);
  expect(request.placement).toBe('github-hosted-per-job-v1');
});
