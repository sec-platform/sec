import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'links shared cache without copying when project deps are cold'
];

process.exit(await runFastTests(tests));
