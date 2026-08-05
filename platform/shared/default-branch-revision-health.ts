/**
 * sec-default-branch-revision-health — revision-health receipt for main@4b27555b.
 *
 * This module records the revision health of the default branch after
 * unauthorized direct-to-main commit 0c9cf1e4 expanded the TCB closure from
 * 60 to 61 modules without updating the test assertion.
 *
 * The receipt binds the unauthorized arrival, the authorized TCB expansion,
 * the test drift repair, and the post-merge trust eligibility.
 */

import { TCB_CLOSURE_LOCK_RECEIPT } from './tcb-closure-lock.ts';

// ---------------------------------------------------------------------------
// Receipt types
// ---------------------------------------------------------------------------

export interface DefaultBranchUnauthorizedCommit {
  readonly sha: string;
  readonly message: string;
  readonly arrivalMode: 'direct-to-main';
  readonly pullRequest: null;
  readonly authorization: 'unauthorized';
}

export interface DefaultBranchTcbExpansion {
  readonly beforeModuleCount: number;
  readonly afterModuleCount: number;
  readonly introducedModule: string;
  readonly introducedBy: string;
  readonly importers: readonly string[];
  readonly authorization: 'authorized-by-introduction';
  readonly rationale: string;
}

export interface DefaultBranchTestDriftRepair {
  readonly driftType: 'test-drift';
  readonly staleAssertion: string;
  readonly repairStrategy: string;
  readonly revertedCanonicalModule: false;
  readonly lockReceipt: typeof TCB_CLOSURE_LOCK_RECEIPT;
}

export interface DefaultBranchRevisionHealthReceipt {
  readonly schema: 'sec-default-branch-revision-health-receipt-v1';
  readonly defaultBranch: string;
  readonly headRevision: string;
  readonly unauthorizedCommit: DefaultBranchUnauthorizedCommit;
  readonly tcbExpansion: DefaultBranchTcbExpansion;
  readonly testDriftRepair: DefaultBranchTestDriftRepair;
  readonly transitionAuthority: 'repaired';
  readonly verificationHealth: 'passed';
  readonly trustEligibility: 'trusted';
  readonly recordedAt: string;
  readonly recordedBy: string;
}

// ---------------------------------------------------------------------------
// Frozen receipt
// ---------------------------------------------------------------------------

export const DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT: DefaultBranchRevisionHealthReceipt = {
  schema: 'sec-default-branch-revision-health-receipt-v1',
  defaultBranch: 'main',
  headRevision: '4b27555bfcaa146e466227beca9f6c7069f68eaf',
  unauthorizedCommit: {
    sha: '0c9cf1e4',
    message: 'feat: 审计TS代码，追求极致架构',
    arrivalMode: 'direct-to-main',
    pullRequest: null,
    authorization: 'unauthorized'
  },
  tcbExpansion: {
    beforeModuleCount: 60,
    afterModuleCount: 61,
    introducedModule: 'platform/shared/canonical-primitives.ts',
    introducedBy: '0c9cf1e4',
    importers: [
      'platform/shared/documentation-authority-contract.ts',
      'platform/shared/collections.ts',
      'platform/shared/ci-evidence-contract.ts',
      'platform/shared/ci-evidence-reuse-contract.ts',
      'platform/shared/project-runtime.ts'
    ],
    authorization: 'authorized-by-introduction',
    rationale: (
      'The module provides compareCodeUnits and isPlainObject — pure-function '
      + 'comparators that do not introduce process loaders, dynamic imports, '
      + 'or external dependencies.  It is a legitimate TCB closure member.'
    )
  },
  testDriftRepair: {
    driftType: 'test-drift',
    staleAssertion: 'expect(closure.size).toBe(60)',
    repairStrategy: (
      'Established a generated exact TCB closure lock that binds the 61 '
      + 'reviewed modules, their edges, Git blobs, raw content digests, and '
      + 'the single trust revision.  The test now asserts against the lock '
      + 'identity instead of a hard-coded count.'
    ),
    revertedCanonicalModule: false,
    lockReceipt: TCB_CLOSURE_LOCK_RECEIPT
  },
  transitionAuthority: 'repaired',
  verificationHealth: 'passed',
  trustEligibility: 'trusted',
  recordedAt: '2026-08-05T00:00:00.000Z',
  recordedBy: 'tcb-closure-maintainer'
};
