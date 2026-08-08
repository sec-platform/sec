import { expect, test } from 'bun:test';

import { DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT } from '../../platform/shared/default-branch-revision-health.ts';
import { TCB_CLOSURE_LOCK_RECEIPT } from '../../platform/shared/tcb-closure-lock.ts';

test('revision-health receipt has the correct schema and default branch', () => {
  expect(DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT.schema).toBe(
    'sec-default-branch-revision-health-receipt-v1'
  );
  expect(DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT.defaultBranch).toBe('main');
  expect(DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT.headRevision).toBe(
    'b2e538aef7cb478cfd8d8b782da8919117831ccf'
  );
});

test('revision-health receipt records the unauthorized direct-to-main commit', () => {
  const { unauthorizedCommit } = DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT;
  expect(unauthorizedCommit.sha).toBe('0c9cf1e4');
  expect(unauthorizedCommit.arrivalMode).toBe('direct-to-main');
  expect(unauthorizedCommit.pullRequest).toBeNull();
  expect(unauthorizedCommit.authorization).toBe('unauthorized');
});

test('revision-health receipt records the authorized TCB closure expansion', () => {
  const { tcbExpansion } = DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT;
  expect(tcbExpansion.beforeModuleCount).toBe(60);
  expect(tcbExpansion.afterModuleCount).toBe(61);
  expect(tcbExpansion.introducedModule).toBe('platform/shared/canonical-primitives.ts');
  expect(tcbExpansion.introducedBy).toBe('0c9cf1e4');
  expect(tcbExpansion.authorization).toBe('authorized-by-introduction');
  expect(tcbExpansion.importers).toContain(
    'platform/shared/documentation-authority-contract.ts'
  );
  expect(tcbExpansion.importers).toContain('platform/shared/collections.ts');
  expect(tcbExpansion.rationale.length).toBeGreaterThan(0);
});

test('revision-health receipt records the test drift repair without reverting the canonical module', () => {
  const { testDriftRepair } = DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT;
  expect(testDriftRepair.driftType).toBe('test-drift');
  expect(testDriftRepair.staleAssertion).toBe('expect(closure.size).toBe(60)');
  expect(testDriftRepair.revertedCanonicalModule).toBe(false);
  expect(testDriftRepair.repairStrategy).toContain('generated exact TCB closure lock');
  expect(testDriftRepair.lockReceipt).not.toBe(TCB_CLOSURE_LOCK_RECEIPT);
  expect(testDriftRepair.lockReceipt.trustRevision).toBe(
    '4b27555bfcaa146e466227beca9f6c7069f68eaf'
  );
});

test('revision-health receipt records the post-merge trust transition', () => {
  expect(DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT.transitionAuthority).toBe('repaired');
  expect(DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT.verificationHealth).toBe('passed');
  expect(DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT.trustEligibility).toBe('trusted');
});

test('revision-health receipt lock receipt matches the TCB closure lock receipt', () => {
  const { lockReceipt } = DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT.testDriftRepair;
  expect(lockReceipt.schema).toBe('sec-tcb-closure-lock-receipt-v1');
  expect(lockReceipt.trustRevision).toBe(
    '4b27555bfcaa146e466227beca9f6c7069f68eaf'
  );
  expect(lockReceipt.moduleCount).toBe(61);
  expect(lockReceipt.closureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test('revision-health receipt records the PR #281 post-merge provenance facts', () => {
  const { postMergeProvenance } = DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT;
  expect(postMergeProvenance.mergeCommit).toBe(
    'b2e538aef7cb478cfd8d8b782da8919117831ccf'
  );
  expect(postMergeProvenance.pullRequest).toBe(281);
  expect(postMergeProvenance.mergeMode).toBe('admin-squash');
  expect(postMergeProvenance.submittedReview).toBe(0);
  expect(postMergeProvenance.mergeGateStatus).toBe('failed');
  expect(postMergeProvenance.mergeGateFailureReason).toBe(
    'No exact-key scope attestation run found'
  );
  expect(postMergeProvenance.scopeAttestation).toBe('missing');
  expect(postMergeProvenance.frozenVerificationArtifact).toBe('missing');
  expect(postMergeProvenance.mergeOccurredRegardless).toBe(true);
  expect(postMergeProvenance.platformPreventionOwner).toBe('Issue #279');
});

test('revision-health receipt records the post-merge physical verification evidence', () => {
  const { postMergeVerification } = DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT;
  expect(postMergeVerification.verifiedIn).toBe('isolated-clean-checkout');
  expect(postMergeVerification.checkoutRevision).toBe(
    'b2e538aef7cb478cfd8d8b782da8919117831ccf'
  );
  expect(postMergeVerification.frozenInstall).toBe('passed');
  expect(postMergeVerification.strictTypecheck).toBe('passed');
  expect(postMergeVerification.focusedTests.passed).toBe(44);
  expect(postMergeVerification.focusedTests.failed).toBe(0);
  expect(postMergeVerification.focusedTests.expectCalls).toBe(519);
  expect(postMergeVerification.tcbClosureLockVerification).toBe('passed');
  expect(postMergeVerification.closureDigestParity).toBe('matched');
  expect(postMergeVerification.gitBlobParity).toBe('matched');
  expect(postMergeVerification.crlfLfCheckoutParity).toBe('canonical-LF');
  expect(postMergeVerification.docsDoctor).toBe('passed');
  expect(postMergeVerification.gitDiffCheck).toBe('clean');
  expect(postMergeVerification.finalCleanStatus).toBe('clean');
});

test('revision-health receipt records pre-existing imports:check failures as non-blocking', () => {
  const { postMergeVerification } = DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT;
  expect(postMergeVerification.preExistingImportsCheckFailures).toHaveLength(3);
  expect(postMergeVerification.preExistingImportsCheckFailures).toContain(
    'platform/shared/ci-evidence-contract.ts'
  );
  expect(postMergeVerification.preExistingImportsCheckFailures).toContain(
    'platform/shared/ci-evidence-reuse-contract.ts'
  );
  expect(postMergeVerification.preExistingImportsCheckFailures).toContain(
    'platform/shared/windows-appcontainer-executor.ts'
  );
});

test('revision-health receipt records the post-merge repository audit finding', () => {
  const { postMergeVerification } = DEFAULT_BRANCH_REVISION_HEALTH_RECEIPT;
  expect(postMergeVerification.repositoryAuditFinding).toBe(
    'control-plane-selected-manifest-already-on-default'
  );
});
