import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/contract/benchmark-budget.test.ts',
  'tests/contract/ci-command-contract.test.ts',
  'tests/contract/ci-contract.test.ts',
  'tests/contract/error-protocol.test.ts',
  'tests/contract/reference.test.ts',
  'tests/integration/overview.test.ts',
  'tests/integration/project-runtime.test.ts',
  'tests/integration/runtime-contract.test.ts',
  'tests/integration/semantic-contract.test.ts',
  'tests/integration/semantic-projections.test.ts',
  'tests/integration/ticket-pipeline.test.ts'
];

process.exit(await runFastTests(tests));
