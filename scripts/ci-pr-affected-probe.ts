import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'types define input/output|envelope builder wires|contract scripts bypass|demo:closed-loop covers|roadmap documents|compiler spec documents|README documents|contract freeze contract documents|error protocol defines|error protocol contract documents|CLI surfaces protocol fields|process module avoids'
];

process.exit(await runFastTests(tests));
