import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';

const DEV_RUNNER_FAST_TESTS = [
  'tests/contract/dev-runner-contract.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts'
];

const AFFECTED_TEST_SELECTION_FAST_TESTS = [
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts',
  'tests/unit/ci-verification-composition-execution.test.ts',
  'tests/unit/test-runner.test.ts'
];

const VERIFICATION_EVIDENCE_PRODUCER_FAST_TESTS = [
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/ci-evidence-composition-policy-registry.test.ts',
  'tests/unit/ci-pr-risk-execution.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts',
  'tests/unit/ci-verification-execution.test.ts',
  'tests/unit/ci-verification-composition-execution.test.ts',
  'tests/unit/exact-git-blob.test.ts'
];

const VERIFICATION_TRUTH_FAST_TESTS = [
  'tests/contract/test-impact.test.ts',
  'tests/unit/acceptance-coverage-closure.test.ts',
  'tests/unit/coverage.test.ts',
  'tests/unit/semantic-mutation-verification-adapter.test.ts',
  'tests/unit/verification-artifact-claim-summary.test.ts',
  'tests/unit/verification-claim-migration.test.ts',
  'tests/unit/verification-result-core.test.ts',
  'tests/unit/verification-result-proof-identity.test.ts'
];

export const verificationTestOwnershipDeclarations: TestOwnershipDeclaration[] = [
  {
    owner: 'verification-evidence-producers',
    identity: { kind: 'architecture-owner', id: 'verification-evidence-producers' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'scripts/codex/ci-orchestration-core.ts',
      'scripts/ci-pr-risk.ts',
      'scripts/ci-verification.ts',
      'scripts/codex/exact-git-blob.ts'
    ],
    fast: VERIFICATION_EVIDENCE_PRODUCER_FAST_TESTS,
    slow: []
  },
  {
    owner: 'verification-truth',
    identity: { kind: 'architecture-owner', id: 'verification-truth' },
    autoReferenceMode: 'include',
    sourceFiles: [
      'platform/compiler/verify/build-acceptance-coverage.ts',
      'platform/shared/acceptance-proof-contract.ts',
      'platform/shared/verification-artifact-contract.ts'
    ],
    fast: VERIFICATION_TRUTH_FAST_TESTS,
    slow: []
  },
  {
    owner: 'affected-test-selection',
    identity: { kind: 'architecture-owner', id: 'affected-test-selection' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/affected-test-inventory.ts',
      'platform/shared/verification-scope-inventory.ts'
    ],
    fast: AFFECTED_TEST_SELECTION_FAST_TESTS,
    slow: []
  },
  {
    owner: 'dev-runner',
    identity: { kind: 'architecture-owner', id: 'dev-runner' },
    sourceFiles: [
      'platform/dev-runner.ts',
      'platform/dev-runner/check-runner.ts',
      'platform/dev-runner/command-runner.ts',
      'platform/dev-runner/env-manager.ts',
      'platform/dev-runner/fast-test-policy.ts',
      'platform/dev-runner/import-organizer.ts',
      'platform/dev-runner/test-concurrency-policy.ts',
      'platform/dev-runner/test-runner.ts',
      'platform/dev-runner/typecheck-runner.ts'
    ],
    fast: DEV_RUNNER_FAST_TESTS,
    slow: []
  }
];
