import type { VerificationSessionHostedRequest } from "../../../../../execution/verification/hosted.ts";




/** Local preparation is a persisted plan input, never a hosted dispatch request. */
export const CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA =
  'sec-verification-session-local-preparation-v1' as const;

export interface VerificationSessionLocalPreparationRequest {
  readonly schema: typeof CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA;
  readonly executionPlacement: 'local';
  readonly authorityStage: 'preparation-only';
  readonly request: Readonly<VerificationSessionHostedRequest<typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA>>;
}

export const CI_VERIFICATION_SESSION_REQUEST_SCHEMA = 'sec-verification-session-hosted-request-v1' as const;

export const VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA =
  'sec-verification-session-hosted-envelope-v1' as const;

export function parseVerificationSessionHostedRequest(
  source: string
): VerificationSessionHostedRequest<typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA> {
  const value = JSON.parse(source) as Record<string, unknown>;
  if (value?.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA) {
    throw new Error('Local preparation-only request cannot be consumed by a hosted operation.');
  }
  // The exact legacy schema is hosted-only. It is accepted only at an explicitly
  // selected hosted entry; absence of placement never selects that entry.
  const expected = [
    'schema', 'prNumber', 'expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha',
    'expectedHeadTreeSha', 'manifestPath', 'manifestDigest', 'profile',
    'expectedScopeProposalDigest', 'expectedActionPlanDigest', 'expectedSessionRevision',
    'reviewPolicyDigest', 'requestOperationId'
  ].sort();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hosted request must be an object.');
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Hosted request must contain exactly: ${expected.join(', ')}.`);
  }
  if (value.schema !== CI_VERIFICATION_SESSION_REQUEST_SCHEMA) {
    throw new Error('Hosted request schema mismatch.');
  }
  const shaFields = ['expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha', 'expectedHeadTreeSha'];
  const digestFields = [
    'manifestDigest', 'expectedScopeProposalDigest', 'expectedActionPlanDigest',
    'expectedSessionRevision', 'reviewPolicyDigest', 'requestOperationId'
  ];
  for (const field of shaFields) if (typeof value[field] !== 'string' || !/^[0-9a-f]{40}$/u.test(value[field] as string)) {
    throw new Error(`Hosted request ${field} is invalid.`);
  }
  for (const field of digestFields) if (typeof value[field] !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value[field] as string)) {
    throw new Error(`Hosted request ${field} is invalid.`);
  }
  if (!Number.isSafeInteger(value.prNumber) || (value.prNumber as number) <= 0 ||
      typeof value.manifestPath !== 'string' || typeof value.profile !== 'string') {
    throw new Error('Hosted request scalar identity is invalid.');
  }
  return Object.freeze(value as unknown as VerificationSessionHostedRequest<typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA>);
}
