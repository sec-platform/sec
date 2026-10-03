import { CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from './revision.ts';

export interface VerificationSessionHostedRequest {
  schema: typeof CI_VERIFICATION_SESSION_REQUEST_SCHEMA;
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
