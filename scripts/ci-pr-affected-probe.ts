import { runFastTests } from '../platform/dev-runner/test-runner.ts';

const tests = [
  'tests/integration/project-runtime.test.ts',
  '--test-name-pattern',
  'ensureSharedDepsReady|demo scripts|dogfood scripts|reference:refresh|root package exposes|external graph provider|MCP config|architecture tools workflow|dev-runner does not expose|fast test runner|test budget contract|benchmark contract|reference check contract'
];

process.exit(await runFastTests(tests));
