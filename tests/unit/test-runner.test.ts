import { beforeEach, expect, mock, test } from 'bun:test';

const commandCalls: { command: string; args: string[] }[] = [];
const devCommandCalls: { command: string; args: string[] }[] = [];

mock.module('../../platform/shared/fs.ts', () => ({
  pathExists: async () => true
}));

mock.module('../../platform/shared/process.ts', () => ({
  runCommand: async (command: string, args: string[]) => {
    commandCalls.push({ command, args });

    if (command === 'git' && args[0] === 'diff') {
      return { code: 0, stdout: 'platform/unmapped-source.ts\n', stderr: '' };
    }

    if (command === 'git' && args[0] === 'ls-files') {
      return { code: 0, stdout: '', stderr: '' };
    }

    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  }
}));

mock.module('../../platform/dev-runner/command-runner.ts', () => ({
  runDevCommand: async (command: string, args: string[]) => {
    devCommandCalls.push({ command, args });
    return 0;
  }
}));

const { runChangedTests, runFastTests } = await import('../../platform/dev-runner/test-runner.ts');

beforeEach(() => {
  commandCalls.length = 0;
  devCommandCalls.length = 0;
  delete process.env.PJC_CHANGED_TESTS_FULL_FAST_FALLBACK;
});

test('targeted fast tests run only the requested fast files', async () => {
  const code = await runFastTests(['tests/unit/test-runner.test.ts']);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    { command: 'bun', args: ['test', 'tests/unit/test-runner.test.ts'] }
  ]);
});

test('changed tests skip broad fast-suite fallback for unmapped source changes by default', async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runChangedTests();

    expect(code).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(logs).toContain('No affected fast tests matched source changes; skipping broad fast-suite fallback in PR fast lane. Full/manual/scheduled validation covers unmapped changes.');
  } finally {
    console.log = originalLog;
  }
});

test('changed tests allow broad fast-suite fallback when explicitly enabled', async () => {
  process.env.PJC_CHANGED_TESTS_FULL_FAST_FALLBACK = '1';
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runChangedTests();

    expect(code).toBe(0);
    expect(devCommandCalls).toHaveLength(1);
    expect(devCommandCalls[0]?.command).toBe('bun');
    expect(devCommandCalls[0]?.args[0]).toBe('test');
    expect(logs).toContain('No affected fast tests matched source changes; running the fast test suite because PJC_CHANGED_TESTS_FULL_FAST_FALLBACK=1.');
  } finally {
    console.log = originalLog;
  }
});
