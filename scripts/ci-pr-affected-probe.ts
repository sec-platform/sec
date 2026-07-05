import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  'tests/unit/test-runner.test.ts'
];

process.exit(await runFastTests(tests));
