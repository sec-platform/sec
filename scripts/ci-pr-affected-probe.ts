import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'roadmap documents|compiler spec documents'
];

process.exit(await runFastTests(tests));
