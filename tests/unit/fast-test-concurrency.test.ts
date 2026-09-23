import { expect, test } from 'bun:test';
import { availableParallelism } from 'node:os';

import {
  DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
  DEFAULT_FAST_TEST_MAX_CONCURRENCY,
  FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER,
  MAX_FAST_TEST_GLOBAL_RESOURCE_BUDGET,
  resolveFastTestConcurrencyBudget,
  resolveManagedFastTestConcurrency
} from '../../src/adapters/self-hosting/development/runner/fast-test-policy.ts';
import {
  applyDefaultFastTestConcurrency,
  explicitFastTestMaxConcurrency
} from '../../src/adapters/self-hosting/development/runner/test-concurrency-policy.ts';

test('one pure capped budget resolves CPU counts 1..256 and MAX_SAFE_INTEGER', () => {
  const cpuCounts = [
    ...Array.from({ length: 256 }, (_, index) => index + 1),
    Number.MAX_SAFE_INTEGER
  ];

  for (const availableCpuCount of cpuCounts) {
    const budget = resolveFastTestConcurrencyBudget(availableCpuCount);
    expect(budget.availableCpuCount).toBe(availableCpuCount);
    expect(budget.globalBudget).toBe(Math.min(
      MAX_FAST_TEST_GLOBAL_RESOURCE_BUDGET,
      availableCpuCount
    ));
    expect(budget.bunTestMaxConcurrency).toBeGreaterThan(0);
    expect(budget.concurrentProcessLimit).toBeGreaterThan(0);
    expect(budget.bunTestMaxConcurrency * budget.concurrentProcessLimit)
      .toBeLessThanOrEqual(budget.globalBudget);
    const managed = resolveManagedFastTestConcurrency(budget, null);
    for (const limit of Object.values(managed.resourceClassLimits)) {
      expect(limit).toBeGreaterThan(0);
      expect(limit * managed.innerConcurrency).toBeLessThanOrEqual(budget.globalBudget);
    }

    for (let explicit = 1; explicit <= budget.globalBudget; explicit += 1) {
      const explicitManaged = resolveManagedFastTestConcurrency(budget, explicit);
      expect(explicitManaged.innerConcurrency).toBe(explicit);
      expect(explicitManaged.outerProcessConcurrency).toBeGreaterThan(0);
      expect(explicitManaged.outerProcessConcurrency * explicit)
        .toBeLessThanOrEqual(budget.globalBudget);
      for (const resourceClass of FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER) {
        const limit = explicitManaged.resourceClassLimits[resourceClass];
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThanOrEqual(explicitManaged.outerProcessConcurrency);
        expect(limit).toBeLessThanOrEqual(budget.resourceClassProcessCaps[resourceClass]);
        expect(limit * explicit).toBeLessThanOrEqual(budget.globalBudget);
      }
    }
  }

  for (const invalidCpuCount of [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1
  ]) {
    expect(() => resolveFastTestConcurrencyBudget(invalidCpuCount))
      .toThrow('positive safe integer');
  }
});

test('default concurrent tests receive the canonical inner budget', () => {
  expect(DEFAULT_FAST_TEST_CONCURRENCY_BUDGET).toEqual(
    resolveFastTestConcurrencyBudget(availableParallelism())
  );
  expect(resolveFastTestConcurrencyBudget(4).globalBudget).toBe(4);
  const args = applyDefaultFastTestConcurrency('bun', [
    'test',
    '--concurrent',
    'tests/unit/example.test.ts'
  ], DEFAULT_FAST_TEST_MAX_CONCURRENCY);

  expect(args).toEqual([
    'test',
    '--concurrent',
    '--max-concurrency',
    String(DEFAULT_FAST_TEST_CONCURRENCY_BUDGET.bunTestMaxConcurrency),
    'tests/unit/example.test.ts'
  ]);
});

test('explicit equals and split concurrency bytes are preserved exactly', () => {
  const forms = [
    [
      'test',
      '--concurrent',
      '--max-concurrency=0002',
      'tests/unit/example.test.ts'
    ],
    [
      'test',
      '--concurrent',
      '--max-concurrency',
      '02',
      'tests/unit/example.test.ts'
    ]
  ];

  for (const args of forms) {
    expect(explicitFastTestMaxConcurrency(args)).toBe(2);
    expect(applyDefaultFastTestConcurrency(
      'bun',
      args,
      DEFAULT_FAST_TEST_MAX_CONCURRENCY
    )).toEqual(args);
  }
});

test('non-applicable argv projection is a pure no-op and never mutates input', () => {
  const cases = [
    { command: 'node', args: ['test', '--concurrent', 'tests/unit/example.test.ts'] },
    { command: 'bun', args: ['run', '--concurrent', 'tests/unit/example.test.ts'] },
    { command: 'bun', args: ['test', 'tests/unit/example.test.ts'] }
  ] as const;

  for (const { command, args: values } of cases) {
    const args = Object.freeze([...values]);
    const before = [...args];
    const projected = applyDefaultFastTestConcurrency(
      command,
      args,
      DEFAULT_FAST_TEST_MAX_CONCURRENCY
    );

    expect(projected).toEqual(before);
    expect(projected).not.toBe(args);
    expect(args).toEqual(before);
  }
});

test('managed explicit concurrency adapts the outer allocation and rejects impossible input', () => {
  const budget = resolveFastTestConcurrencyBudget(12);

  expect(resolveManagedFastTestConcurrency(budget, null)).toMatchObject({
    innerConcurrency: 3,
    outerProcessConcurrency: 4
  });
  expect(resolveManagedFastTestConcurrency(budget, 6)).toMatchObject({
    innerConcurrency: 6,
    outerProcessConcurrency: 2
  });
  const singleProcess = resolveManagedFastTestConcurrency(budget, 12);
  expect(singleProcess).toMatchObject({
    innerConcurrency: 12,
    outerProcessConcurrency: 1
  });
  expect(Object.values(singleProcess.resourceClassLimits)).toEqual([1, 1, 1, 1]);
  expect(() => resolveManagedFastTestConcurrency(budget, 13)).toThrow(
    'exceeds the managed fast-test global budget 12'
  );
});

test('resource-class limits derive deterministically across outer limits 1, 2, 3, and above 4', () => {
  const cases = [
    { cpu: 1, independent: 1, shared: 1 },
    { cpu: 2, independent: 2, shared: 2 },
    { cpu: 3, independent: 3, shared: 2 },
    { cpu: 16, independent: 8, shared: 2 }
  ];

  for (const expected of cases) {
    const managed = resolveManagedFastTestConcurrency(
      resolveFastTestConcurrencyBudget(expected.cpu),
      1
    );
    expect(managed.outerProcessConcurrency).toBe(expected.cpu);
    expect(managed.resourceClassLimits).toEqual({
      'independent-process': expected.independent,
      'shared-host-runtime': expected.shared,
      'repository-worktree': 1,
      'host-profile': 1
    });
  }
});

test('managed max-concurrency rejects invalid and duplicate declarations', () => {
  const unsafe = String(Number.MAX_SAFE_INTEGER + 1);
  for (const args of [
    ['test', '--concurrent', '--max-concurrency'],
    ['test', '--concurrent', '--max-concurrency='],
    ['test', '--concurrent', '--max-concurrency', ''],
    ['test', '--concurrent', '--max-concurrency=0'],
    ['test', '--concurrent', '--max-concurrency', '0'],
    ['test', '--concurrent', '--max-concurrency=-1'],
    ['test', '--concurrent', '--max-concurrency', '-1'],
    ['test', '--concurrent', '--max-concurrency=1.5'],
    ['test', '--concurrent', '--max-concurrency', '1.5'],
    ['test', '--concurrent', `--max-concurrency=${unsafe}`],
    ['test', '--concurrent', '--max-concurrency', unsafe],
    ['test', '--concurrent', '--max-concurrency=2', '--max-concurrency=3'],
    ['test', '--concurrent', '--max-concurrency', '2', '--max-concurrency', '3'],
    ['test', '--concurrent', '--max-concurrency=2', '--max-concurrency', '3'],
    ['test', '--concurrent', '--max-concurrency', '2', '--max-concurrency=3']
  ]) {
    expect(() => explicitFastTestMaxConcurrency(args)).toThrow();
  }
});
