import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'types define input/output|envelope builder wires|contract scripts bypass|demo:closed-loop covers'
];

process.exit(await runFastTests(tests));
