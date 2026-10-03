import { createHash } from 'node:crypto';
import { parseExactJson } from '../../../../../contracts/exact-json.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { createVerificationSessionOperationId } from './session-operation.ts';

import { CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA, CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from './revision.ts';

export interface VerificationSessionHostedRequestFields {
  prNumber: number;
  expectedBaseSha: string;
  expectedBaseTreeSha: string;
  expectedHeadSha: string;
  expectedHeadTreeSha: string;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  profile: string;
  expectedScopeProposalDigest: `sha256:${string}`;
  expectedActionPlanDigest: `sha256:${string}`;
  expectedSessionRevision: `sha256:${string}`;
  reviewPolicyDigest: `sha256:${string}`;
  requestOperationId: `sha256:${string}`;
}

/** Exact legacy identity is retained only for its existing wire and recovery. */
export interface VerificationSessionLegacyHostedRequest extends VerificationSessionHostedRequestFields {
  readonly schema: typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA;
}
export interface VerificationSessionPerJobHostedRequest extends VerificationSessionHostedRequestFields {
  readonly schema: typeof CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA;
  readonly placement: 'github-hosted-per-job-v1';
}
export type VerificationSessionHostedRequest =
  | VerificationSessionLegacyHostedRequest
  | VerificationSessionPerJobHostedRequest;

/** Local preparation is a persisted plan input, never a hosted dispatch request. */
export const CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA =
  'sec-verification-session-local-preparation-v1' as const;

export interface VerificationSessionBoundLocalPreparationRequest {
  readonly schema: typeof CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA;
  readonly executionPlacement: 'local';
  readonly authorityStage: 'preparation-only';
  readonly request: Readonly<VerificationSessionHostedRequest>;
}

/** The successor pins the pure plan while deferring real MainHealth and Session
 * binding to execution. It cannot be converted into a hosted dispatch request. */
export const CI_VERIFICATION_SESSION_LOCAL_PENDING_HEALTH_PREPARATION_SCHEMA =
  'sec-verification-session-local-preparation-v2' as const;

export type VerificationSessionPendingHealthRequestPins = Readonly<Omit<
  VerificationSessionHostedRequest, 'schema' | 'expectedSessionRevision' | 'requestOperationId'
> & { expectedSessionProposalDigest: `sha256:${string}` }>;

export interface VerificationSessionPendingHealthLocalPreparationRequest {
  readonly schema: typeof CI_VERIFICATION_SESSION_LOCAL_PENDING_HEALTH_PREPARATION_SCHEMA;
  readonly executionPlacement: 'local';
  readonly authorityStage: 'preparation-only';
  readonly healthBinding: 'pending-main-health';
  readonly request: VerificationSessionPendingHealthRequestPins;
}

export type VerificationSessionLocalPreparationRequest =
  | VerificationSessionBoundLocalPreparationRequest
  | VerificationSessionPendingHealthLocalPreparationRequest;

type Digest = `sha256:${string}`;
function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

export function createVerificationSessionPerJobHostedRequest(
  fields: Readonly<Omit<VerificationSessionHostedRequestFields, 'requestOperationId'>>
): VerificationSessionPerJobHostedRequest {
  const semanticRequest = Object.freeze({ ...fields, schema: CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA,
    placement: 'github-hosted-per-job-v1' as const });
  const requestOperationId = createVerificationSessionOperationId({
    sessionRevision: fields.expectedSessionRevision, operationKind: 'hosted-dispatch',
    semanticInputDigest: hash(semanticRequest)
  });
  return parseVerificationSessionHostedRequest(JSON.stringify({ ...semanticRequest,
    requestOperationId })) as VerificationSessionPerJobHostedRequest;
}

export function parseVerificationSessionHostedRequest(
  source: string
): VerificationSessionHostedRequest {
  const decoded = JSON.parse(source) as Record<string, unknown>;
  const value = decoded?.schema === CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA
    ? parseExactJson(source, 'hosted per-job request') as Record<string, unknown> : decoded;
  if (value?.schema === CI_VERIFICATION_SESSION_LOCAL_PREPARATION_SCHEMA
      || value?.schema === CI_VERIFICATION_SESSION_LOCAL_PENDING_HEALTH_PREPARATION_SCHEMA) {
    throw new Error('Local preparation-only request cannot be consumed by a hosted operation.');
  }
  // The exact legacy schema is hosted-only. It is accepted only at an explicitly
  // selected hosted entry; absence of placement never selects that entry.
  const expected = [
    ...(value?.schema === CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA ? ['placement'] : []),
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
  if (value.schema !== CI_VERIFICATION_SESSION_REQUEST_SCHEMA
      && value.schema !== CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA) {
    throw new Error('Hosted request schema mismatch.');
  }
  if (value.schema === CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA
      && value.placement !== 'github-hosted-per-job-v1') {
    throw new Error('Hosted request placement mismatch.');
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
  if (value.schema === CI_VERIFICATION_SESSION_PER_JOB_REQUEST_SCHEMA) {
    const { requestOperationId, ...semanticRequest } = value;
    const expectedOperation = createVerificationSessionOperationId({
      sessionRevision: value.expectedSessionRevision as Digest, operationKind: 'hosted-dispatch',
      semanticInputDigest: hash(semanticRequest)
    });
    if (requestOperationId !== expectedOperation) throw new Error('Hosted per-job request operation identity mismatch.');
  }
  return Object.freeze(value as unknown as VerificationSessionHostedRequest);
}
