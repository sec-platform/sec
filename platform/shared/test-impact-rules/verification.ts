import type { TestOwnershipDeclaration } from '../test-ownership-contract.ts';

const DEV_RUNNER_FAST_TESTS = [
  'tests/contract/dev-runner-contract.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/unit/ci-pr-risk-selection.test.ts'
];

export const verificationTestOwnershipDeclarations: TestOwnershipDeclaration[] = [
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
