import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAssertVerificationLegacyProjectionV1,
  CodexDevelopmentBuildVerificationLegacyProjectionV1,
  type VerificationLegacyProjectionV1
} from '../../platform/shared/verification-legacy-projection-contract.ts';

const DIGEST = `sha256:${'1'.repeat(64)}`;
const CLAIM_DIGEST = `sha256:${'2'.repeat(64)}`;

function projection(
  legacyValue = 'succeeded',
  status: VerificationLegacyProjectionV1['canonical']['status'] = 'passed',
  reasonCode: VerificationLegacyProjectionV1['canonical']['reasonCode'] = 'executed-success'
): VerificationLegacyProjectionV1 {
  return CodexDevelopmentBuildVerificationLegacyProjectionV1({
    projectionKind: 'lock-pass-status',
    legacyValue,
    canonical: {
      sourceKind: 'report',
      reference: '.sec/verification-report.json',
      digest: DIGEST,
      revision: 'verification-result-v1',
      status,
      reasonCode,
      claimDigest: CLAIM_DIGEST
    },
    informationLoss: [
      'applicability',
      'claim-results',
      'disposition',
      'environment',
      'reason-code'
    ],
    consumers: ['pipeline-scheduler'],
    retirementTarget: 'remove-lock-pass-status-after-consumer-cutover'
  });
}

test('valid projection is permanently non-authoritative and canonical-bound', () => {
  const value = projection();
  expect(value.authoritative).toBe(false);
  expect(value.canonical.status).toBe('passed');
  CodexDevelopmentAssertVerificationLegacyProjectionV1(value);
});

test('pass-like legacy values cannot conceal non-passed canonical truth', () => {
  for (const [status, reason] of [
    ['failed', 'executed-failure'],
    ['not-run', 'not-dispatched'],
    ['unsupported', 'capability-unsupported'],
    ['invalidated', 'selection-unresolved']
  ] as const) {
    expect(() => projection('succeeded', status, reason))
      .toThrow(/requires canonical passed status/);
  }
});

test('failed or blocked projections retain distinct canonical status and reason', () => {
  const failed = projection('failed', 'failed', 'executed-failure');
  const unsupported = projection('blocked', 'unsupported', 'capability-unsupported');
  const invalidated = projection('blocked', 'invalidated', 'selection-unresolved');

  expect(failed.canonical.status).toBe('failed');
  expect(unsupported.canonical.status).toBe('unsupported');
  expect(invalidated.canonical.status).toBe('invalidated');
});

test('projection cannot declare itself authoritative', () => {
  const value = structuredClone(projection()) as VerificationLegacyProjectionV1 & {
    authoritative: boolean;
  };
  value.authoritative = true;
  expect(() => CodexDevelopmentAssertVerificationLegacyProjectionV1(value))
    .toThrow(/can never be authoritative/);
});

test('canonical reference, digest and explicit information loss are mandatory', () => {
  const missingReference = structuredClone(projection()) as any;
  missingReference.canonical.reference = '';
  expect(() => CodexDevelopmentAssertVerificationLegacyProjectionV1(missingReference))
    .toThrow(/bounded non-empty text/);

  const badDigest = structuredClone(projection()) as any;
  badDigest.canonical.digest = 'not-a-digest';
  expect(() => CodexDevelopmentAssertVerificationLegacyProjectionV1(badDigest))
    .toThrow(/sha256 digest/);

  const noLossDeclaration = structuredClone(projection()) as any;
  noLossDeclaration.informationLoss = [];
  expect(() => CodexDevelopmentAssertVerificationLegacyProjectionV1(noLossDeclaration))
    .toThrow(/non-empty bounded array/);
});

test('canonical status and reason must remain coherent', () => {
  const value = structuredClone(projection()) as any;
  value.canonical.status = 'invalidated';
  value.canonical.reasonCode = 'executed-success';
  value.legacyValue = 'blocked';
  expect(() => CodexDevelopmentAssertVerificationLegacyProjectionV1(value))
    .toThrow(/does not match status/);
});

test('unknown fields, duplicate consumers and unordered loss declarations fail closed', () => {
  const unknown = structuredClone(projection()) as any;
  unknown.mergeAuthority = true;
  expect(() => CodexDevelopmentAssertVerificationLegacyProjectionV1(unknown))
    .toThrow(/unknown or missing fields/);

  const duplicate = structuredClone(projection()) as any;
  duplicate.consumers = ['pipeline-scheduler', 'pipeline-scheduler'];
  expect(() => CodexDevelopmentAssertVerificationLegacyProjectionV1(duplicate))
    .toThrow(/must be unique/);

  const unordered = structuredClone(projection()) as any;
  unordered.informationLoss = ['reason-code', 'applicability'];
  expect(() => CodexDevelopmentAssertVerificationLegacyProjectionV1(unordered))
    .toThrow(/canonical lexical order/);
});
