import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'derive versions from the root package.json|keeps Playwright as the runtime full browser smoke'
];

process.exit(await runFastTests(tests));
