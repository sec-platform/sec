import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--max-concurrency',
  '1'
];

process.exit(await runFastTests(tests));
