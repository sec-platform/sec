import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';

const DEV_RUNNER_FAST_TESTS = [
  'tests/contract/dev-runner-contract.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts'
];

const DEV_RUNNER_DEPENDENCY_BOOTSTRAP_FAST_TESTS = [
  'tests/contract/dev-runner-contract.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/dev-runner-dependency-bootstrap.test.ts',
  'tests/unit/test-runner.test.ts'
];

const IMPORT_TRANSFORM_TRANSACTION_FAST_TESTS = ['tests/unit/import-transform-transaction.test.ts'];

const MAIN_HEALTH_FAST_TESTS = [
  'tests/contract/ci-contract.test.ts',
  'tests/contract/default-branch-revision-health.test.ts',
  'tests/contract/document-control-plane-lifecycle.test.ts',
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/main-health-contract.test.ts',
  'tests/unit/main-health-repair-contract.test.ts',
  'tests/unit/tcb-trust-root-contract.test.ts',
  'tests/unit/verification-session-runtime.test.ts',
  'tests/unit/work-selection-live.test.ts'
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
  'tests/contract/ci-contract.test.ts',
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/ci-evidence-contract-v4.test.ts',
  'tests/unit/ci-hosted-sut-observation-contract.test.ts',
  'tests/unit/ci-pr-risk-execution.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts',
  'tests/unit/ci-verification-execution.test.ts',
  'tests/unit/ci-verification-composition-execution.test.ts',
  'tests/unit/exact-git-blob.test.ts',
  'tests/unit/tcb-trust-root-contract.test.ts',
  'tests/unit/verification-action-github-provider.test.ts'
];

const CI_PR_RISK_FAST_TESTS = [...VERIFICATION_EVIDENCE_PRODUCER_FAST_TESTS, 'tests/unit/heavy-verification-gate-lease.test.ts'];

const DEV_RUNNER_ENTRYPOINT_FAST_TESTS = [...DEV_RUNNER_FAST_TESTS, 'tests/unit/heavy-verification-gate-lease.test.ts'];

const VERIFICATION_ACTION_TEST_FIXTURE_FAST_TESTS = [
  'tests/contract/test-impact.test.ts',
  'tests/unit/verification-action-github-provider.test.ts'
];

export const TRUSTED_VERIFIER_TCB_FAST_TESTS = [
  'tests/contract/ci-contract.test.ts',
  'tests/contract/ci-lanes.test.ts',
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/agent-operation-activation.test.ts',
  'tests/unit/local-github-actions-runner.test.ts',
  'tests/unit/tcb-trust-root-contract.test.ts'
];

const HEAVY_VERIFICATION_GATE_FAST_TESTS = [...TRUSTED_VERIFIER_TCB_FAST_TESTS, 'tests/unit/heavy-verification-gate-lease.test.ts'];

const GIT_CHANGED_FILE_OBSERVATION_FAST_TESTS = [...TRUSTED_VERIFIER_TCB_FAST_TESTS, 'tests/contract/dev-runner-contract.test.ts'];

const VERIFICATION_SESSION_BRANCH_CLOSEOUT_FAST_TESTS = [
  'tests/contract/ci-contract.test.ts',
  'tests/contract/document-control-plane-lifecycle.test.ts',
  'tests/contract/sec-merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/agent-operation-activation.test.ts',
  'tests/unit/branch-closeout-receipt.test.ts',
  'tests/unit/branch-closeout-rest-comments.test.ts',
  'tests/unit/branch-lifecycle-contract.test.ts',
  'tests/unit/branch-lifecycle-temp-repo.test.ts',
  'tests/unit/integration-authorization-publication.test.ts',
  'tests/unit/local-main-closeout.test.ts',
  'tests/unit/tcb-trust-root-contract.test.ts',
  'tests/unit/verification-action-ci-contract.test.ts',
  'tests/unit/verification-candidate-tree.test.ts',
  'tests/unit/verification-session-contract.test.ts',
  'tests/unit/verification-session-runtime.test.ts',
  'tests/unit/work-selection-live.test.ts'
];

const VERIFICATION_SESSION_SOURCE_LOCK_FAST_TESTS = [
  ...VERIFICATION_SESSION_BRANCH_CLOSEOUT_FAST_TESTS,
  'tests/unit/sec-merge-bootstrap.test.ts'
];

const WORKTREE_PHYSICAL_CLOSEOUT_FAST_TESTS = [
  'tests/contract/test-impact.test.ts',
  'tests/unit/branch-lifecycle-contract.test.ts',
  'tests/unit/physical-no-follow.test.ts',
  'tests/unit/worktree-physical-closeout-contract.test.ts',
  'tests/unit/worktree-physical-closeout-crash-recovery.test.ts',
  'tests/unit/worktree-physical-closeout-temp-repo.test.ts'
];

// The lease is shared coordination infrastructure, not a semantic-mutation
// implementation detail.  Its physical-retirement protocol has an explicit
// owner so #186 changes select both ordinary lease coverage and the real
// cross-process closeout recovery evidence exactly once.
const WORKSPACE_WRITE_LEASE_FAST_TESTS = [
  'tests/contract/repository-runtime.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/contract/semantic-mutation-apply-contract.test.ts',
  'tests/integration/pipeline-workspace-write-lease.test.ts',
  'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
  'tests/unit/workspace-write-lease.test.ts',
  'tests/unit/worktree-physical-closeout-crash-recovery.test.ts',
  'tests/unit/worktree-physical-closeout-temp-repo.test.ts'
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
    owner: 'workspace-write-lease',
    identity: { kind: 'architecture-owner', id: 'workspace-write-lease' },
    autoReferenceMode: 'declared-only',
    sourceFiles: ['platform/shared/workspace-write-lease.ts'],
    fast: WORKSPACE_WRITE_LEASE_FAST_TESTS,
    slow: []
  },
  {
    owner: 'git-worktree-physical-closeout',
    identity: { kind: 'architecture-owner', id: 'git-worktree-physical-closeout' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/physical-no-follow.ts',
      'scripts/codex/worktree-physical-closeout-contract.ts',
      'scripts/codex/worktree-physical-closeout.ts',
      'tests/unit/worktree-physical-closeout-crash-fixture.ts'
    ],
    fast: WORKTREE_PHYSICAL_CLOSEOUT_FAST_TESTS,
    slow: []
  },
  {
    owner: 'git-changed-file-observation',
    identity: { kind: 'architecture-owner', id: 'git-changed-file-observation' },
    autoReferenceMode: 'include',
    sourceFiles: ['platform/shared/ci-git-changed-files.ts'],
    fast: GIT_CHANGED_FILE_OBSERVATION_FAST_TESTS,
    slow: []
  },
  {
    owner: 'import-transform-transaction',
    identity: { kind: 'architecture-owner', id: 'import-transform-transaction' },
    autoReferenceMode: 'declared-only',
    sourceFiles: ['platform/dev-runner/import-transform-transaction.ts'],
    fast: IMPORT_TRANSFORM_TRANSACTION_FAST_TESTS,
    slow: ['tests/e2e/import-organizer-staged.test.ts', 'tests/e2e/import-organizer-worktree-isolation.test.ts']
  },
  {
    owner: 'main-health',
    identity: { kind: 'architecture-owner', id: 'main-health' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/default-branch-revision-health.ts',
      'platform/shared/main-health-contract.ts',
      'platform/shared/main-health-repair-contract.ts',
      'scripts/codex/main-health-observation.ts',
      'scripts/codex/main-health-repair.ts'
    ],
    fast: MAIN_HEALTH_FAST_TESTS,
    slow: []
  },
  {
    owner: 'verification-session-branch-closeout-authority',
    identity: {
      kind: 'architecture-owner',
      id: 'verification-session-branch-closeout-authority'
    },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/verification-session-contract.ts',
      'scripts/codex/branch-closeout-contract.ts',
      'scripts/codex/branch-closeout-receipt.ts',
      'scripts/codex/branch-closeout.ts',
      'scripts/codex/branch-lifecycle-audit.ts',
      'scripts/codex/branch-lifecycle-config.ts',
      'scripts/codex/branch-lifecycle-command.ts',
      'scripts/codex/branch-lifecycle-inventory.ts',
      'scripts/codex/branch-lifecycle.ts',
      'scripts/codex/branch-recovery.ts',
      'scripts/codex/local-main-closeout.ts',
      'scripts/codex/verification-candidate-tree.ts',
      'scripts/codex/verification-session-runtime.ts'
    ],
    fast: VERIFICATION_SESSION_BRANCH_CLOSEOUT_FAST_TESTS,
    slow: ['tests/e2e/verification-session-closeout-cli.test.ts']
  },
  {
    owner: 'verification-session-branch-closeout-authority',
    identity: {
      kind: 'architecture-owner',
      id: 'verification-session-branch-closeout-authority'
    },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'scripts/codex/sec-merge-bootstrap-contract.ts',
      'scripts/codex/sec-merge-bootstrap-runtime.ts',
      'scripts/codex/sec-merge-bootstrap.ts',
      'scripts/codex/integration-authorization-publication.ts',
      'scripts/codex/verification-session-github.ts',
      'scripts/codex/verification-session.ts'
    ],
    fast: VERIFICATION_SESSION_SOURCE_LOCK_FAST_TESTS,
    slow: ['tests/e2e/verification-session-closeout-cli.test.ts']
  },
  {
    owner: 'trusted-verifier-tcb',
    identity: { kind: 'architecture-owner', id: 'trusted-verifier-tcb' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      '.github/workflows/compiler-pr-validation.yml',
      '.github/workflows/compiler-release-validation.yml',
      '.github/workflows/sec-merge-gate.yml',
      '.github/workflows/sec-trusted-bootstrap.yml',
      'platform/shared/ci-trust-root-registry.json',
      'platform/shared/tcb-closure-lock.ts',
      'platform/shared/tcb-trust-root-contract.ts',
      'scripts/codex/local-github-actions-runner.ts',
      'scripts/codex/merge-gate.ts'
    ],
    fast: TRUSTED_VERIFIER_TCB_FAST_TESTS,
    slow: []
  },
  {
    owner: 'verification-evidence-producers',
    identity: { kind: 'architecture-owner', id: 'verification-evidence-producers' },
    autoReferenceMode: 'declared-only',
    sourceFiles: [
      'platform/shared/ci-evidence-contract.ts',
      'platform/shared/ci-hosted-sut-observation-contract.ts',
      'platform/shared/ci-verification-revision.ts',
      'scripts/codex/ci-orchestration-core.ts',
      'scripts/ci-verification.ts',
      'scripts/codex/exact-git-blob.ts',
      'scripts/codex/verification-action-github-provider.ts'
    ],
    fast: VERIFICATION_EVIDENCE_PRODUCER_FAST_TESTS,
    slow: []
  },
  {
    owner: 'verification-evidence-producers',
    identity: { kind: 'architecture-owner', id: 'verification-evidence-producers' },
    autoReferenceMode: 'declared-only',
    sourceFiles: ['scripts/ci-pr-risk.ts'],
    fast: CI_PR_RISK_FAST_TESTS,
    slow: []
  },
  {
    owner: 'verification-action-test-fixture',
    identity: { kind: 'architecture-owner', id: 'verification-action-test-fixture' },
    autoReferenceMode: 'include',
    sourceFiles: ['tests/helpers/verification-action-fixtures.ts'],
    fast: VERIFICATION_ACTION_TEST_FIXTURE_FAST_TESTS,
    slow: []
  },
  {
    owner: 'verification-truth',
    identity: { kind: 'architecture-owner', id: 'verification-truth' },
    autoReferenceMode: 'include',
    sourceFiles: [
      'platform/compiler/verify/build-acceptance-coverage.ts',
      'platform/shared/acceptance-proof-contract.ts',
      'platform/shared/product-verification-claim-plan.ts',
      'platform/shared/verification-artifact-contract.ts'
    ],
    fast: VERIFICATION_TRUTH_FAST_TESTS,
    slow: []
  },
  {
    owner: 'affected-test-selection',
    identity: { kind: 'architecture-owner', id: 'affected-test-selection' },
    autoReferenceMode: 'declared-only',
    sourceFiles: ['platform/shared/affected-test-inventory.ts', 'platform/shared/verification-scope-inventory.ts'],
    fast: AFFECTED_TEST_SELECTION_FAST_TESTS,
    slow: []
  },
  {
    owner: 'dev-runner',
    identity: { kind: 'architecture-owner', id: 'dev-runner' },
    sourceFiles: ['platform/dev-runner/dependency-bootstrap.ts'],
    fast: DEV_RUNNER_DEPENDENCY_BOOTSTRAP_FAST_TESTS,
    slow: []
  },
  {
    owner: 'dev-runner',
    identity: { kind: 'architecture-owner', id: 'dev-runner' },
    sourceFiles: [
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
  },
  {
    owner: 'dev-runner',
    identity: { kind: 'architecture-owner', id: 'dev-runner' },
    sourceFiles: ['platform/dev-runner.ts'],
    fast: DEV_RUNNER_ENTRYPOINT_FAST_TESTS,
    slow: []
  },
  {
    owner: 'heavy-verification-gate',
    identity: { kind: 'architecture-owner', id: 'heavy-verification-gate' },
    autoReferenceMode: 'include',
    sourceFiles: ['platform/shared/heavy-verification-gate-lease.ts'],
    fast: HEAVY_VERIFICATION_GATE_FAST_TESTS,
    slow: []
  }
];
