import type { SourceProgramTestRewriteDecisionBatch } from '../source-program-model/test-disposition-decisions.ts';

/**
 * Exact-baseline repository-owner decisions for removed tests whose useful
 * obligations were rewritten into stronger current tests.  These are neither
 * a runnable-test inventory nor permanent path tombstones: the compiler only
 * activates a batch while its exact baseline digest matches.
 */
export const REPOSITORY_TEST_REWRITE_DECISION_BATCHES = Object.freeze([
  Object.freeze({
    baselineDigest: 'sha256:22b4fbe6a623f2cd5c14e04fe90efd371c4f11e4cad83106adc99c452f4e973e',
    owner: 'repository-test-value',
    decisions: Object.freeze([
      Object.freeze({
        path: 'tests/contract/benchmark-budget.test.ts',
        replacementPaths: Object.freeze(['tests/contract/test-budget.test.ts']),
        reason: 'The task catalog is descriptive; the replacement verifies the real test budget and CLI inventory relationships without claiming benchmark evidence.'
      }),
      Object.freeze({
        path: 'tests/contract/contract-freeze.test.ts',
        replacementPaths: Object.freeze([
          'src/adapters/repository/source-program-model/test-value.test.ts',
          'tests/contract/ci-command-contract.test.ts',
          'tests/contract/ci-lanes.test.ts'
        ]),
        reason: 'The self-listing Contract Freeze mechanism was retired; current tests preserve independent Test Value, public CI gate, and plan-translation obligations.'
      }),
      Object.freeze({
        path: 'tests/contract/repository-runtime.test.ts',
        replacementPaths: Object.freeze([
          'tests/contract/ci-command-contract.test.ts',
          'tests/unit/cli-command-selection.test.ts'
        ]),
        reason: 'Lexical package-script blacklists were replaced by command-selection and public CI routing contracts that exercise semantic boundaries.'
      }),
      Object.freeze({
        path: 'tests/contract/retired-policy-algebra-boundary.test.ts',
        replacementPaths: Object.freeze([
          'src/adapters/repository/architecture/dependency-policy.test.ts'
        ]),
        reason: 'A pathname tombstone was replaced by the repository module dependency-policy owner, which rejects authority and dependency violations independent of filenames.'
      }),
      Object.freeze({
        path: 'tests/integration/ticket-pipeline.test.ts',
        replacementPaths: Object.freeze([
          'tests/e2e/semantic-runtime-contract.test.ts',
          'tests/integration/semantic-projections.test.ts'
        ]),
        reason: 'The duplicate passed-status check was absorbed by semantic runtime and projection tests that retain the persisted report and stronger pipeline invariants.'
      }),
      Object.freeze({
        path: 'tests/unit/affected-test-selection.test.ts',
        replacementPaths: Object.freeze([
          'tests/unit/ci-verification-execution.test.ts',
          'tests/unit/slow-test-selection.test.ts'
        ]),
        reason: 'Duplicate selector cases were consolidated into one pure selector specification plus the real CI verification boundary.'
      })
    ])
  })
] as const satisfies readonly SourceProgramTestRewriteDecisionBatch[]);
