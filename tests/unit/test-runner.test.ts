import { beforeEach, expect, mock, test } from 'bun:test';
import fs from 'node:fs/promises';

const commandCalls: { command: string; args: string[] }[] = [];
const devCommandCalls: { command: string; args: string[] }[] = [];
let changedFiles = ['platform/unmapped-source.ts'];

mock.module('../../platform/shared/fs.ts', () => ({
  pathExists: async (targetPath: string) => {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}));

mock.module('../../platform/shared/process.ts', () => ({
  runCommand: async (command: string, args: string[]) => {
    commandCalls.push({ command, args });

    if (command === 'git' && args.includes('diff')) {
      return { code: 0, stdout: `${changedFiles.join('\n')}\n`, stderr: '' };
    }

    if (command === 'git' && args.includes('ls-files')) {
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

const { runAffectedTests, runFastTests, runSlowTests } = await import('../../platform/dev-runner/test-runner.ts');
const { slowTestSuiteFiles } = await import('../../platform/shared/test-budget-contract.ts');

beforeEach(() => {
  commandCalls.length = 0;
  devCommandCalls.length = 0;
  changedFiles = ['platform/unmapped-source.ts'];
  delete process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK;
});

// 这些测试使用全局 mock，必须串行执行以避免并发干扰
test.serial('targeted concurrent-safe fast tests run only the requested files', async () => {
  const code = await runFastTests(['tests/unit/path-containment.test.ts']);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    { command: 'bun', args: ['test', '--concurrent', 'tests/unit/path-containment.test.ts'] }
  ]);
});

test.serial('fast tests preserve options across concurrent and serial invocations', async () => {
  const code = await runFastTests(['--timeout', '30000']);

  expect(code).toBe(0);
  expect(devCommandCalls).toHaveLength(5);
  expect(devCommandCalls[0]?.command).toBe('bun');
  expect(devCommandCalls[0]?.args.slice(0, 2)).toEqual(['test', '--concurrent']);
  expect(devCommandCalls[0]?.args).toContain('tests/unit/path-containment.test.ts');
  expect(devCommandCalls[0]?.args).not.toContain('tests/integration/project-runtime.test.ts');
  expect(devCommandCalls[0]?.args).not.toContain('tests/integration/semantic-core-vertical.test.ts');
  expect(devCommandCalls[0]?.args).not.toContain('tests/integration/ticket-pipeline.test.ts');
  expect(devCommandCalls[0]?.args).not.toContain('tests/unit/test-runner.test.ts');
  expect(devCommandCalls[0]?.args).toContain('--timeout');
  expect(devCommandCalls[0]?.args).toContain('30000');
  expect(devCommandCalls[0]?.args.some((arg) => arg.startsWith('tests/e2e/'))).toBe(false);
  expect(devCommandCalls).toEqual(expect.arrayContaining([
    {
      command: 'bun',
      args: ['test', 'tests/integration/project-runtime.test.ts', '--timeout', '30000']
    },
    {
      command: 'bun',
      args: ['test', 'tests/integration/semantic-core-vertical.test.ts', '--timeout', '30000']
    },
    {
      command: 'bun',
      args: ['test', 'tests/integration/ticket-pipeline.test.ts', '--timeout', '30000']
    },
    {
      command: 'bun',
      args: ['test', 'tests/unit/test-runner.test.ts', '--timeout', '30000']
    }
  ]));
});

test.serial('serial fast test files run outside the concurrent invocation', async () => {
  const code = await runFastTests([
    'tests/integration/project-runtime.test.ts',
    'tests/integration/semantic-core-vertical.test.ts',
    'tests/integration/ticket-pipeline.test.ts',
    'tests/unit/test-runner.test.ts'
  ]);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    { command: 'bun', args: ['test', 'tests/integration/project-runtime.test.ts'] },
    { command: 'bun', args: ['test', 'tests/integration/semantic-core-vertical.test.ts'] },
    { command: 'bun', args: ['test', 'tests/integration/ticket-pipeline.test.ts'] },
    { command: 'bun', args: ['test', 'tests/unit/test-runner.test.ts'] }
  ]);
});

test.serial('fast tests reject explicit slow file selectors', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runFastTests(['tests/e2e/registry.test.ts']);

    expect(code).toBe(1);
    expect(devCommandCalls).toEqual([]);
    expect(errors).toContain('Fast test runner cannot run slow test files: tests/e2e/registry.test.ts');
  } finally {
    console.error = originalError;
  }
});

test.serial('slow suite selector expands to the registered suite files', async () => {
  const suiteFiles = slowTestSuiteFiles('e2e-pipeline');
  const code = await runSlowTests(['--suite', 'e2e-pipeline', '--timeout', '180000']);

  expect(code).toBe(0);
  expect(suiteFiles.length).toBeGreaterThan(0);
  expect(devCommandCalls).toEqual([
    { command: 'bun', args: ['test', ...suiteFiles, '--timeout', '180000'] }
  ]);
});

test.serial('slow suite selector rejects unknown suite ids', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runSlowTests(['--suite', 'not-a-suite']);

    expect(code).toBe(1);
    expect(devCommandCalls).toEqual([]);
    expect(errors[0]).toContain('Unknown slow test suite "not-a-suite". Available suites:');
  } finally {
    console.error = originalError;
  }
});

test.serial('affected tests skip broad fast-suite fallback for unmapped source changes by default', async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(logs).toContain('No affected fast tests matched source changes; skipping broad fast-suite fallback in PR quick lane. Full/manual/scheduled validation covers unmapped changes.');
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected tests map semantic Contract files through explicit contract ownership', async () => {
  changedFiles = ['platform/registry/official/ticket.basic/contracts/ticket.yaml'];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  const invokedTests = devCommandCalls.flatMap((call) => call.args);
  expect(invokedTests).toEqual(expect.arrayContaining([
    'tests/unit/validated-engineering-ir.test.ts',
    'tests/integration/semantic-core-vertical.test.ts',
    'tests/integration/ticket-pipeline.test.ts'
  ]));
  expect(invokedTests).not.toContain('tests/unit/path-containment.test.ts');
});

test.serial('affected tests combine changed fast tests with source-owned coverage', async () => {
  changedFiles = [
    'scripts/release-helper.ts',
    'tests/unit/path-containment.test.ts'
  ];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(devCommandCalls).toHaveLength(1);
  expect(devCommandCalls[0]?.command).toBe('bun');
  expect(devCommandCalls[0]?.args.slice(0, 2)).toEqual(['test', '--concurrent']);
  expect(devCommandCalls[0]?.args).toContain('tests/contract/usage.test.ts');
  expect(devCommandCalls[0]?.args).toContain('tests/unit/path-containment.test.ts');
});

test.serial('affected tests run changed concurrent-safe fast files directly', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(0);
    expect(devCommandCalls).toEqual([
      { command: 'bun', args: ['test', '--concurrent', 'tests/unit/path-containment.test.ts'] }
    ]);
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected tests isolate changed serial fast files', async () => {
  changedFiles = ['tests/unit/test-runner.test.ts'];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    { command: 'bun', args: ['test', 'tests/unit/test-runner.test.ts'] }
  ]);
});

test.serial('affected tests treat changed slow files as notice-only quick-lane input', async () => {
  changedFiles = ['tests/e2e/registry.test.ts'];
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(errors).toEqual([]);
    expect(logs).toContain('Changed slow test files require PR risk or release/full verification: tests/e2e/registry.test.ts');
    expect(logs).toContain('No affected fast test files detected.');
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test.serial('affected tests allow broad fast-suite fallback when explicitly enabled', async () => {
  process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK = '1';
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(0);
    expect(devCommandCalls).toHaveLength(5);
    expect(devCommandCalls[0]?.command).toBe('bun');
    expect(devCommandCalls[0]?.args.slice(0, 2)).toEqual(['test', '--concurrent']);
    expect(devCommandCalls).toEqual(expect.arrayContaining([
      { command: 'bun', args: ['test', 'tests/integration/project-runtime.test.ts'] },
      { command: 'bun', args: ['test', 'tests/integration/semantic-core-vertical.test.ts'] },
      { command: 'bun', args: ['test', 'tests/integration/ticket-pipeline.test.ts'] },
      { command: 'bun', args: ['test', 'tests/unit/test-runner.test.ts'] }
    ]));
    expect(logs).toContain('No affected fast tests matched source changes; running the fast test suite because SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1.');
  } finally {
    console.log = originalLog;
  }
});
