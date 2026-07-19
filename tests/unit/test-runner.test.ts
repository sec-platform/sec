import { beforeEach, expect, mock, test } from 'bun:test';
import fs from 'node:fs/promises';

import {
  DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
  FAST_TEST_PROCESS_ISOLATION_REGISTRY,
  SERIAL_FAST_TEST_FILES,
  planFastTestProcesses
} from '../../platform/dev-runner/fast-test-policy.ts';

const commandCalls: { command: string; args: string[] }[] = [];
const devCommandCalls: { command: string; args: string[] }[] = [];
const devCommandExitCodes: number[] = [];
const serialFastTestFileSet = new Set<string>(SERIAL_FAST_TEST_FILES);
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
      return { code: 0, stdout: changedFiles.map((file) => `M\0${file}\0`).join(''), stderr: '' };
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
    return devCommandExitCodes.shift() ?? 0;
  }
}));

const { runAffectedTests, runFastTests, runSlowTests } = await import('../../platform/dev-runner/test-runner.ts');
const { getFastTestFilesSync, slowTestSuiteFiles } = await import('../../platform/shared/test-budget-contract.ts');

function invocationTestFiles(args: readonly string[]): string[] {
  return args.filter((arg) => /^tests\/.+\.(test|spec)\.tsx?$/u.test(arg));
}

beforeEach(() => {
  commandCalls.length = 0;
  devCommandCalls.length = 0;
  devCommandExitCodes.length = 0;
  changedFiles = ['platform/unmapped-source.ts'];
  delete process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK;
});

test('fast process planning deterministically bounds concurrent shards without duplicate or missing files', () => {
  const concurrentFiles = Array.from(
    { length: DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE * 2 + 1 },
    (_, index) => `tests/unit/concurrent-${String(index).padStart(2, '0')}.test.ts`
  );
  const isolatedFiles = [
    'tests/unit/work-package-gate-execution.test.ts',
    'tests/integration/overview.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts'
  ];
  const files = [
    ...concurrentFiles.slice(0, 3),
    isolatedFiles[0],
    ...concurrentFiles.slice(3),
    ...isolatedFiles.slice(1)
  ];
  const plan = planFastTestProcesses(files);
  const plannedFiles = [...plan.concurrentShards.flat(), ...plan.serial];

  expect(plan.concurrentShards.map((shard) => shard.length)).toEqual([
    DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
    DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
    1
  ]);
  expect(plan.serial).toEqual(isolatedFiles);
  expect([...plannedFiles].sort()).toEqual([...files].sort());
  expect(new Set(plannedFiles).size).toBe(files.length);
  expect(planFastTestProcesses(files)).toEqual(plan);
  expect(planFastTestProcesses(concurrentFiles.slice(0, 2)).concurrentShards).toEqual([
    concurrentFiles.slice(0, 2)
  ]);
});

test('resource-sensitive fast tests are registered for process isolation', () => {
  const registeredFiles = new Set(FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(({ file }) => file));

  expect([...registeredFiles]).toEqual(expect.arrayContaining([
    'tests/unit/work-package-gate-execution.test.ts',
    'tests/unit/work-package-profile-census-repair.test.ts',
    'tests/unit/work-package-profile-probe-diagnostic.test.ts',
    'tests/integration/overview.test.ts',
    'tests/integration/project-runtime.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts',
    'tests/integration/workbench-writer-lease.test.ts',
    'tests/integration/workspace-engineering-ir.test.ts',
    'tests/unit/import-organizer-staged.test.ts'
  ]));
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
  const concurrentCalls = devCommandCalls.filter(({ args }) => args.includes('--concurrent'));
  expect(concurrentCalls.length).toBeGreaterThan(1);
  for (const call of concurrentCalls) {
    expect(call.command).toBe('bun');
    expect(call.args.slice(0, 2)).toEqual(['test', '--concurrent']);
    expect(invocationTestFiles(call.args).length).toBeLessThanOrEqual(DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE);
    expect(call.args.slice(-2)).toEqual(['--timeout', '30000']);
    expect(call.args.some((arg) => serialFastTestFileSet.has(arg))).toBe(false);
    expect(call.args.some((arg) => arg.startsWith('tests/e2e/'))).toBe(false);
  }
  for (const file of SERIAL_FAST_TEST_FILES) {
    expect(devCommandCalls).toContainEqual({
      command: 'bun',
      args: ['test', file, '--timeout', '30000']
    });
  }
  const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
  expect([...invokedFiles].sort()).toEqual(getFastTestFilesSync());
  expect(new Set(invokedFiles).size).toBe(invokedFiles.length);
});

test.serial('fast test process failures stop later sequential shards', async () => {
  const selectedFiles = getFastTestFilesSync()
    .filter((file) => !serialFastTestFileSet.has(file))
    .slice(0, DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE * 2 + 1);
  expect(selectedFiles).toHaveLength(DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE * 2 + 1);
  devCommandExitCodes.push(0, 7, 0);

  const code = await runFastTests(selectedFiles);

  expect(code).toBe(7);
  expect(devCommandCalls).toHaveLength(2);
  expect(devCommandCalls.every(({ args }) => args.includes('--concurrent'))).toBe(true);
  expect(devCommandCalls.flatMap(({ args }) => invocationTestFiles(args))).toEqual(
    selectedFiles.slice(0, DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE * 2)
  );
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
    const concurrentCalls = devCommandCalls.filter(({ args }) => args.includes('--concurrent'));
    expect(concurrentCalls.length).toBeGreaterThan(1);
    expect(concurrentCalls.every(({ args }) => (
      invocationTestFiles(args).length <= DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE
    ))).toBe(true);
    for (const file of SERIAL_FAST_TEST_FILES) {
      expect(devCommandCalls).toContainEqual({ command: 'bun', args: ['test', file] });
    }
    const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
    expect([...invokedFiles].sort()).toEqual(getFastTestFilesSync());
    expect(new Set(invokedFiles).size).toBe(invokedFiles.length);
    expect(logs).toContain('No affected fast tests matched source changes; running the fast test suite because SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1.');
  } finally {
    console.log = originalLog;
  }
});
