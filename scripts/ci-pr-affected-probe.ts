import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'reuses the shared runtime cache when the project has no node_modules'
];

process.exit(await runFastTests(tests));
