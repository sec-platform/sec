import { encodeVerificationActionData } from '../../action/contract/action.ts';
import {
  createReviewReport,
  type ReviewReport
} from '../contract/report.ts';
import { parseReviewStabilityReceipt, type ReviewStabilityReceipt } from '../contract/stability.ts';

export const GITHUB_HUMAN_EXACT_HEAD_REVIEW_METHOD =
  'github-human-approved-exact-head-change-set-v1' as const;
export const GITHUB_TRUSTED_APP_EXACT_HEAD_REVIEW_METHOD =
  'github-trusted-app-clean-exact-head-change-set-v1' as const;

/**
 * Provider bridge for the existing GitHub Review barrier.
 *
 * The stability receipt is minted only after GitHub proves one independent
 * exact-head APPROVED human review or one trusted App clean-review decision,
 * complete pagination, no current REQUEST_CHANGES, and no unresolved thread.
 * Those GitHub review decisions are whole-PR decisions over the exact head, so
 * their coverage is the exact changed-path surface already frozen by the
 * ScopeAuthorization. This bridge is the only place allowed to expand that
 * provider method into concrete reviewed surfaces.
 */
export function createGitHubExactHeadReviewReport(input: Readonly<{
  receipt: ReviewStabilityReceipt;
  requiredSurfaces: readonly string[];
}>): ReviewReport {
  const receipt = parseReviewStabilityReceipt(encodeVerificationActionData(input.receipt));
  const reviewMethodRevision = receipt.principal.kind === 'human'
    ? GITHUB_HUMAN_EXACT_HEAD_REVIEW_METHOD
    : GITHUB_TRUSTED_APP_EXACT_HEAD_REVIEW_METHOD;
  return createReviewReport({
    stage: receipt.stage,
    repository: receipt.repository,
    prNumber: receipt.prNumber,
    sessionRevision: receipt.sessionRevision,
    scopeAuthorizationRevision: receipt.scopeAuthorizationRevision,
    scopeAuthorizationReceiptDigest: receipt.scopeAuthorizationReceiptDigest,
    headSha: receipt.headSha,
    headTreeSha: receipt.headTreeSha,
    policyDigest: receipt.policy.policyDigest,
    principal: receipt.principal,
    reviewMethodRevision,
    coverageMode: 'exact-head-change-set',
    requiredSurfaces: input.requiredSurfaces,
    reviewedSurfaces: input.requiredSurfaces,
    findings: Object.freeze([]),
    sourceReviewRevision: receipt.reviewRevision,
    sourceReceiptDigest: receipt.receiptDigest
  });
}
