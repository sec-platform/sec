/**
 * Default-branch health is a live consumer of MainHealthLedgerV1.
 *
 * Historical fixed receipts cannot authorize a current candidate. Missing,
 * malformed, expired, or revision-drifted input therefore projects locked.
 */

import {
  resolveMainHealthLaneV1,
  type MainHealthLaneDecisionV1
} from './main-health-contract.ts';

export interface DefaultBranchRevisionHealthInputV1 {
  readonly ledger: unknown;
  readonly now: string;
  readonly repository: string;
  readonly defaultBranch: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly trustRevision: string;
}

export function resolveDefaultBranchRevisionHealthV1(
  input: DefaultBranchRevisionHealthInputV1
): MainHealthLaneDecisionV1 {
  return resolveMainHealthLaneV1({
    ledger: input.ledger,
    // This production projection is intentionally ordinary-only. Repair is a
    // semantic MainHealth state until a later frozen package owns its executor.
    lane: 'ordinary',
    now: input.now,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.mainSha,
    expectedMainTreeSha: input.mainTreeSha,
    expectedTrustRevision: input.trustRevision
  });
}
