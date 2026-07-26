import { beforeEach, expect, mock, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getTestWorkspaceTempRoot } from '../../platform/dev-runner/env-manager.ts';
import {
  BOUNDED_PARALLEL_ISOLATED_FAST_TEST_FILES,
  DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
  DEFAULT_FAST_TEST_TIMEOUT_MS,
  DEFAULT_ISOLATED_FAST_TEST_CONCURRENCY,
  EXCLUSIVE_FAST_TEST_FILES,
  FAST_TEST_PROCESS_ISOLATION_REGISTRY,
  MAX_DEFAULT_FAST_TEST_PROCESS_WAVES,
  PROCESS_ISOLATED_FAST_TEST_FILES,
  planFastTestProcesses
} from '../../platform/dev-runner/fast-test-policy.ts';

const commandCalls: { command: string; args: string[]; stdoutMode: 'bytes' | 'text' }[] = [];
const devCommandCalls: { command: string; args: string[] }[] = [];
const devCommandEnvironments: NodeJS.ProcessEnv[] = [];
const devCommandExitCodes: number[] = [];
const devCommandFailures: Array<Error | null> = [];
const canonicalBrowserCachePath = path.resolve('.shared-deps', '.playwright-browsers');
let testDependencyBootstrapCalls = 0;
let testDependencyBootstrapError: Error | null = null;
const isolatedFastTestFileSet = new Set<string>(PROCESS_ISOLATED_FAST_TEST_FILES);
let changedFiles = ['platform/unmapped-source.ts'];
let materializeTestWorkspace = false;

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

const processCommand = (
  command: string,
  args: string[],
  stdoutMode: 'bytes' | 'text'
): { code: number; stdout: string | Uint8Array; stderr: string } => {
  commandCalls.push({ command, args, stdoutMode });
  const stdout = (value: string): string | Uint8Array => (
    stdoutMode === 'bytes' ? new TextEncoder().encode(value) : value
  );

  if (command === 'git' && args.includes('diff')) {
    return { code: 0, stdout: stdout(changedFiles.map((file) => `M\0${file}\0`).join('')), stderr: '' };
  }

  if (command === 'git' && args.includes('ls-files')) {
    return { code: 0, stdout: stdout(''), stderr: '' };
  }

  return { code: 1, stdout: stdout(''), stderr: `Unexpected command: ${command} ${args.join(' ')}` };
};

mock.module('../../platform/shared/process.ts', () => ({
  runCommand: async (command: string, args: string[]) => processCommand(command, args, 'text'),
  runCommandBytes: async (command: string, args: string[]) => processCommand(command, args, 'bytes')
}));

mock.module('../../platform/dev-runner/command-runner.ts', () => ({
  runDevCommand: async (command: string, args: string[], env: NodeJS.ProcessEnv) => {
    devCommandCalls.push({ command, args });
    devCommandEnvironments.push(env);
    if (materializeTestWorkspace) {
      await fs.mkdir(getTestWorkspaceTempRoot(env), { recursive: true });
    }
    const failure = devCommandFailures.shift();
    if (failure) throw failure;
    return devCommandExitCodes.shift() ?? 0;
  }
}));

mock.module('../../platform/dev-runner/dependency-bootstrap.ts', () => ({
  ensureTestDependencies: async () => {
    testDependencyBootstrapCalls += 1;
    if (testDependencyBootstrapError) throw testDependencyBootstrapError;
    return {
      browserCachePath: canonicalBrowserCachePath,
      manifestHash: 'test-manifest',
      nodeModulesPath: path.resolve('node_modules'),
      source: 'existing'
    };
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
  devCommandEnvironments.length = 0;
  devCommandExitCodes.length = 0;
  devCommandFailures.length = 0;
  testDependencyBootstrapCalls = 0;
  testDependencyBootstrapError = null;
  changedFiles = ['platform/unmapped-source.ts'];
  materializeTestWorkspace = false;
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
  const plannedFiles = [
    ...plan.concurrentShards.flat(),
    ...plan.isolatedParallel,
    ...plan.exclusive
  ];

  expect(plan.concurrentShards.map((shard) => shard.length)).toEqual([
    DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
    DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
    1
  ]);
  expect(plan.isolatedParallel).toEqual(isolatedFiles.slice(1));
  expect(plan.exclusive).toEqual(isolatedFiles.slice(0, 1));
  expect([...plannedFiles].sort()).toEqual([...files].sort());
  expect(new Set(plannedFiles).size).toBe(files.length);
  expect(planFastTestProcesses(files)).toEqual(plan);
  expect(planFastTestProcesses(concurrentFiles.slice(0, 2)).concurrentShards).toEqual([
    concurrentFiles.slice(0, 2)
  ]);
});

test('fast process planning removes stale isolation and bounds structural process waves', () => {
  const files = getFastTestFilesSync();
  const plan = planFastTestProcesses(files);
  const registeredFiles = new Set(PROCESS_ISOLATED_FAST_TEST_FILES);
  const plannedFiles = [
    ...plan.concurrentShards.flat(),
    ...plan.isolatedParallel,
    ...plan.exclusive
  ];
  const processWaves = plan.concurrentShards.length
    + Math.ceil(plan.isolatedParallel.length / DEFAULT_ISOLATED_FAST_TEST_CONCURRENCY)
    + plan.exclusive.length;

  expect([...registeredFiles]).toEqual(expect.arrayContaining([
    'tests/unit/work-package-gate-execution.test.ts',
    'tests/unit/work-package-profile-census-repair.test.ts',
    'tests/unit/work-package-profile-probe-diagnostic.test.ts',
    'tests/integration/overview.test.ts',
    'tests/integration/project-runtime.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts',
    'tests/integration/workbench-writer-lease.test.ts',
    'tests/integration/workspace-engineering-ir.test.ts'
  ]));
  expect([...registeredFiles]).not.toContain('tests/unit/import-organizer-staged.test.ts');
  expect(planFastTestProcesses(['tests/unit/import-organizer-staged.test.ts'])).toEqual({
    concurrentShards: [['tests/unit/import-organizer-staged.test.ts']],
    isolatedParallel: [],
    exclusive: []
  });
  expect(plan.isolatedParallel).toEqual(BOUNDED_PARALLEL_ISOLATED_FAST_TEST_FILES);
  expect(plan.exclusive).toEqual(EXCLUSIVE_FAST_TEST_FILES);
  expect([...plannedFiles].sort()).toEqual([...files].sort());
  expect(new Set(plannedFiles).size).toBe(files.length);
  expect(processWaves).toBeLessThanOrEqual(MAX_DEFAULT_FAST_TEST_PROCESS_WAVES);
  expect(FAST_TEST_PROCESS_ISOLATION_REGISTRY.find(
    ({ file }) => file === 'tests/unit/work-package-gate-execution.test.ts'
  )?.scheduling).toBe('exclusive');
  expect(FAST_TEST_PROCESS_ISOLATION_REGISTRY.find(
    ({ file }) => file === 'tests/integration/workspace-engineering-ir.test.ts'
  )?.scheduling).toBe('bounded-parallel');
});

test('fast tests use one bounded default timeout policy', () => {
  expect(DEFAULT_FAST_TEST_TIMEOUT_MS).toBe(180_000);
});

// 这些测试使用全局 mock，必须串行执行以避免并发干扰
test.serial('targeted concurrent-safe fast tests run only the requested files', async () => {
  const code = await runFastTests(['tests/unit/path-containment.test.ts']);

  expect(code).toBe(0);
  expect(testDependencyBootstrapCalls).toBe(1);
  expect(devCommandEnvironments).toHaveLength(1);
  expect(devCommandEnvironments[0]?.PLAYWRIGHT_BROWSERS_PATH).toBe(canonicalBrowserCachePath);
  expect(devCommandEnvironments[0]?.SEC_SKIP_RUNTIME_DEPS_SETUP).toBe('1');
  expect(devCommandEnvironments[0]?.SEC_TEST_WORKSPACE_NAMESPACE).toMatch(/^fast-\d+-[a-z0-9]+-\d+$/u);
  expect(devCommandCalls).toEqual([
    {
      command: 'bun',
      args: [
        'test',
        '--concurrent',
        'tests/unit/path-containment.test.ts',
        '--timeout',
        String(DEFAULT_FAST_TEST_TIMEOUT_MS)
      ]
    }
  ]);
});

test.serial('one pre-fanout bootstrap overwrites poisoned browser state for every managed child', async () => {
  const previousBrowserCachePath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = 'poisoned-browser-cache';
  try {
    const code = await runFastTests([
      'tests/unit/path-containment.test.ts',
      'tests/unit/test-runner.test.ts'
    ]);

    expect(code).toBe(0);
    expect(testDependencyBootstrapCalls).toBe(1);
    expect(devCommandCalls).toHaveLength(2);
    expect(devCommandEnvironments).toHaveLength(2);
    expect(devCommandEnvironments.every((env) =>
      env.PLAYWRIGHT_BROWSERS_PATH === canonicalBrowserCachePath &&
      env.SEC_SKIP_RUNTIME_DEPS_SETUP === '1')).toBe(true);
  } finally {
    if (previousBrowserCachePath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowserCachePath;
  }
});

test.serial('bootstrap failure launches no managed test child', async () => {
  testDependencyBootstrapError = new Error('browser bootstrap failed');

  await expect(runFastTests(['tests/unit/path-containment.test.ts']))
    .rejects.toThrow('browser bootstrap failed');
  expect(testDependencyBootstrapCalls).toBe(1);
  expect(devCommandCalls).toEqual([]);
  expect(devCommandEnvironments).toEqual([]);
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
    expect(call.args.some((arg) => isolatedFastTestFileSet.has(arg))).toBe(false);
    expect(call.args.some((arg) => arg.startsWith('tests/e2e/'))).toBe(false);
  }
  for (const file of PROCESS_ISOLATED_FAST_TEST_FILES) {
    expect(devCommandCalls).toContainEqual({
      command: 'bun',
      args: ['test', file, '--timeout', '30000']
    });
  }
  const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
  expect([...invokedFiles].sort()).toEqual(getFastTestFilesSync());
  expect(new Set(invokedFiles).size).toBe(invokedFiles.length);
  expect(new Set(devCommandEnvironments.map(
    (env) => env.SEC_TEST_WORKSPACE_NAMESPACE
  )).size).toBe(1);
});

test.serial('fast tests preserve equals-form timeout overrides without adding the default', async () => {
  const code = await runFastTests([
    'tests/unit/path-containment.test.ts',
    '--timeout=45000'
  ]);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([{
    command: 'bun',
    args: ['test', '--concurrent', 'tests/unit/path-containment.test.ts', '--timeout=45000']
  }]);
});

test.serial('fast test process failures stop later sequential shards', async () => {
  const selectedFiles = getFastTestFilesSync()
    .filter((file) => !isolatedFastTestFileSet.has(file))
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

test.serial('process-isolated tests run in bounded batches before exclusive owners', async () => {
  const code = await runFastTests([
    'tests/integration/project-runtime.test.ts',
    'tests/integration/semantic-core-vertical.test.ts',
    'tests/integration/ticket-pipeline.test.ts',
    'tests/unit/test-runner.test.ts'
  ]);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    {
      command: 'bun',
      args: ['test', 'tests/integration/semantic-core-vertical.test.ts', '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
    },
    {
      command: 'bun',
      args: ['test', 'tests/integration/ticket-pipeline.test.ts', '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
    },
    {
      command: 'bun',
      args: ['test', 'tests/unit/test-runner.test.ts', '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
    },
    {
      command: 'bun',
      args: ['test', 'tests/integration/project-runtime.test.ts', '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
    }
  ]);
});

test.serial('failed fast children leave no run-owned workspace residue', async () => {
  materializeTestWorkspace = true;
  devCommandExitCodes.push(7);

  const code = await runFastTests(['tests/unit/path-containment.test.ts']);
  const workspaceEnv = devCommandEnvironments[0]!;

  expect(code).toBe(7);
  expect(workspaceEnv.SEC_TEST_WORKSPACE_NAMESPACE).toMatch(/^fast-/u);
  await expect(fs.access(getTestWorkspaceTempRoot(workspaceEnv))).rejects.toThrow();
});

test.serial('thrown isolated child waits for its bounded siblings before parent cleanup', async () => {
  materializeTestWorkspace = true;
  devCommandFailures.push(new Error('spawn sentinel'), null);

  const code = await runFastTests([
    'tests/integration/semantic-core-vertical.test.ts',
    'tests/integration/ticket-pipeline.test.ts'
  ]);
  const workspaceEnv = devCommandEnvironments[0]!;

  expect(code).toBe(1);
  expect(devCommandCalls).toHaveLength(2);
  await expect(fs.access(getTestWorkspaceTempRoot(workspaceEnv))).rejects.toThrow();
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

test.serial('affected tests fail before dependency bootstrap for unresolved source ownership', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(1);
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(devCommandEnvironments).toEqual([]);
    expect(errors).toContain('Affected test ownership is unresolved for changed paths: platform/unmapped-source.ts');
  } finally {
    console.error = originalError;
  }
});

test.serial('affected tests fail closed for mixed mapped and unresolved paths before any child', async () => {
  changedFiles = [
    'scripts/release-helper.ts',
    'assets/new.bin'
  ];

  const code = await runAffectedTests();

  expect(code).toBe(1);
  expect(testDependencyBootstrapCalls).toBe(0);
  expect(devCommandCalls).toEqual([]);
  expect(devCommandEnvironments).toEqual([]);
});

test.serial('affected plan reports resolved selection without dependency or test execution', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    expect(code).toBe(0);
    expect(plan).toMatchObject({
      schema: 'sec-affected-test-plan-v1',
      changedPaths: ['tests/unit/path-containment.test.ts'],
      selectedFastTests: ['tests/unit/path-containment.test.ts'],
      unresolvedPaths: [],
      resolved: true
    });
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(devCommandEnvironments).toEqual([]);
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected plan lists every unresolved path and exits nonzero without side effects', async () => {
  changedFiles = [
    'assets/new.bin',
    'platform/unmapped-source.ts'
  ];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    expect(code).toBe(1);
    expect(plan).toMatchObject({
      changedPaths: [
        'assets/new.bin',
        'platform/unmapped-source.ts'
      ],
      unresolvedPaths: [
        'assets/new.bin',
        'platform/unmapped-source.ts'
      ],
      resolved: false
    });
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(devCommandEnvironments).toEqual([]);
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected-test Git discovery requests byte-preserving stdout through the shared process seam', async () => {
  changedFiles = ['docs/04-AI自主实现执行蓝图.md'];
  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(commandCalls).toHaveLength(2);
  expect(commandCalls.every((call) => call.command === 'git' && call.stdoutMode === 'bytes')).toBe(true);
  expect(commandCalls.some((call) => call.args.includes('diff'))).toBe(true);
  expect(commandCalls.some((call) => call.args.includes('ls-files'))).toBe(true);
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
      {
        command: 'bun',
        args: [
          'test',
          '--concurrent',
          'tests/unit/path-containment.test.ts',
          '--timeout',
          String(DEFAULT_FAST_TEST_TIMEOUT_MS)
        ]
      }
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
    {
      command: 'bun',
      args: ['test', 'tests/unit/test-runner.test.ts', '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
    }
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
  changedFiles = ['tests/setup/unmapped.ts'];
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
    expect(concurrentCalls.every(({ args }) => (
      args.slice(-2).join(' ') === `--timeout ${DEFAULT_FAST_TEST_TIMEOUT_MS}`
    ))).toBe(true);
    for (const file of PROCESS_ISOLATED_FAST_TEST_FILES) {
      expect(devCommandCalls).toContainEqual({
        command: 'bun',
        args: ['test', file, '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
      });
    }
    const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
    expect([...invokedFiles].sort()).toEqual(getFastTestFilesSync());
    expect(new Set(invokedFiles).size).toBe(invokedFiles.length);
    expect(logs).toContain('No affected fast tests matched source changes; running the fast test suite because SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1.');
  } finally {
    console.log = originalLog;
  }
});
