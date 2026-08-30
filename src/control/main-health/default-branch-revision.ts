/**
 * Default-branch health is a live consumer of MainHealthLedgerV1.
 *
 * Historical fixed receipts cannot authorize a current candidate. Missing,
 * malformed, expired, or revision-drifted input therefore projects locked.
 */

import {
  resolveOrdinaryMainHealthLane,
  type MainHealthLaneDecision
} from './contract.ts';

export const DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY =
  'src/control/main-health/default-branch-revision.ts' as const;

export interface DefaultBranchRevisionHealthInput {
  readonly ledger: unknown;
  readonly now: string;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly trustRevision: string;
}

export function resolveDefaultBranchRevisionHealthV1(
  input: DefaultBranchRevisionHealthInput
): MainHealthLaneDecision {
  return resolveOrdinaryMainHealthLane({
    ledger: input.ledger,
    now: input.now,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.mainSha,
    expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.trustRevision
  });
}
