import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  'tests/integration/runtime-contract.test.ts',
  'tests/integration/semantic-contract.test.ts'
];

process.exit(await runFastTests(tests));
