import { runFastTests } from '../platform/dev-runner/test-runner.ts';

process.exit(await runFastTests([
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'task envelope schema'
]));
