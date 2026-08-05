/**
 * sec-default-branch-revision-health — revision-health receipt for
 * main@b2e538ae (post-merge of PR #281).
 *
 * This module records the revision health of the default branch after
 * unauthorized direct-to-main commit 0c9cf1e4 expanded the TCB closure from
 * 60 to 61 modules without updating the test assertion, and the subsequent
 * post-merge provenance repair via PR #281.
 *
 * The receipt binds the unauthorized arrival, the authorized TCB expansion,
 * the test drift repair, the PR #281 provenance facts, the post-merge physical
 * verification evidence, and the post-merge trust eligibility.
 *
 * The original transition was unauthorized.  The product result has been
 * verified after merge.  The provenance is repaired after the fact.
 * Platform prevention (hosted Gate, scope attestation, frozen verification
 * artifact) is still owned by #279.
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

export interface DefaultBranchPostMergeProvenance {
  readonly mergeCommit: string;
  readonly pullRequest: number;
  readonly mergeMode: 'admin-squash';
  readonly submittedReview: 0;
  readonly mergeGateStatus: 'failed';
  readonly mergeGateFailureReason: 'No exact-key scope attestation run found';
  readonly scopeAttestation: 'missing';
  readonly frozenVerificationArtifact: 'missing';
  readonly mergeOccurredRegardless: true;
  readonly platformPreventionOwner: 'Issue #279';
}

export interface DefaultBranchPostMergeVerification {
  readonly verifiedAt: string;
  readonly verifiedIn: 'isolated-clean-checkout';
  readonly checkoutRevision: string;
  readonly frozenInstall: 'passed';
  readonly strictTypecheck: 'passed';
  readonly focusedTests: {
    readonly files: readonly string[];
    readonly passed: number;
    readonly failed: number;
    readonly expectCalls: number;
  };
  readonly tcbClosureLockVerification: 'passed';
  readonly closureDigestParity: 'matched';
  readonly gitBlobParity: 'matched';
  readonly crlfLfCheckoutParity: 'canonical-LF';
  readonly docsDoctor: 'passed';
  readonly affectedPlan: 'passed';
  readonly gitDiffCheck: 'clean';
  readonly finalCleanStatus: 'clean';
  readonly preExistingImportsCheckFailures: readonly string[];
  readonly repositoryAuditFinding: 'control-plane-selected-manifest-already-on-default';
}

export interface DefaultBranchRevisionHealthReceipt {
  readonly schema: 'sec-default-branch-revision-health-receipt-v1';
  readonly defaultBranch: string;
  readonly headRevision: string;
  readonly unauthorizedCommit: DefaultBranchUnauthorizedCommit;
  readonly tcbExpansion: DefaultBranchTcbExpansion;
  readonly testDriftRepair: DefaultBranchTestDriftRepair;
  readonly postMergeProvenance: DefaultBranchPostMergeProvenance;
  readonly postMergeVerification: DefaultBranchPostMergeVerification;
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
  headRevision: 'b2e538aef7cb478cfd8d8b782da8919117831ccf',
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
  postMergeProvenance: {
    mergeCommit: 'b2e538aef7cb478cfd8d8b782da8919117831ccf',
    pullRequest: 281,
    mergeMode: 'admin-squash',
    submittedReview: 0,
    mergeGateStatus: 'failed',
    mergeGateFailureReason: 'No exact-key scope attestation run found',
    scopeAttestation: 'missing',
    frozenVerificationArtifact: 'missing',
    mergeOccurredRegardless: true,
    platformPreventionOwner: 'Issue #279'
  },
  postMergeVerification: {
    verifiedAt: '2026-08-05T23:30:00.000Z',
    verifiedIn: 'isolated-clean-checkout',
    checkoutRevision: 'b2e538aef7cb478cfd8d8b782da8919117831ccf',
    frozenInstall: 'passed',
    strictTypecheck: 'passed',
    focusedTests: {
      files: [
        'tests/contract/sec-merge-gate.test.ts',
        'tests/contract/tcb-closure-lock.test.ts',
        'tests/contract/default-branch-revision-health.test.ts'
      ],
      passed: 44,
      failed: 0,
      expectCalls: 519
    },
    tcbClosureLockVerification: 'passed',
    closureDigestParity: 'matched',
    gitBlobParity: 'matched',
    crlfLfCheckoutParity: 'canonical-LF',
    docsDoctor: 'passed',
    affectedPlan: 'passed',
    gitDiffCheck: 'clean',
    finalCleanStatus: 'clean',
    preExistingImportsCheckFailures: [
      'platform/shared/ci-evidence-contract.ts',
      'platform/shared/ci-evidence-reuse-contract.ts',
      'platform/shared/windows-appcontainer-executor.ts'
    ],
    repositoryAuditFinding: 'control-plane-selected-manifest-already-on-default'
  },
  transitionAuthority: 'repaired',
  verificationHealth: 'passed',
  trustEligibility: 'trusted',
  recordedAt: '2026-08-05T23:30:00.000Z',
  recordedBy: 'tcb-closure-maintainer'
};
