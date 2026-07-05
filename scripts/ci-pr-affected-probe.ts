import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'error protocol defines|error protocol contract documents|CLI surfaces protocol fields|process module avoids'
];

process.exit(await runFastTests(tests));
