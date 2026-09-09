import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  assertFastTestProcessPolicyInventory, assertUniqueFastTestProcessIsolationDefinitions,
  DEFAULT_FAST_TEST_EXCLUDED_FILES, FAST_TEST_PROCESS_ISOLATION_REGISTRY,
  isDefaultFastTestFile, partitionFastTestFiles, planFastTestProcesses,
  resolveFastTestConcurrencyBudget, resolveManagedFastTestConcurrency
} from '../../src/development/runner/fast-test-policy.ts';
import { isSecRepositoryTestModulePath } from '../../src/system-architecture/repository-modules/test-module-path.ts';
import {
  compileTestBudgetProjection,
  slowTestSuiteIdsForFile,
  TestBudgetProjectionCache
} from '../../src/verification/test-impact/contract/budget.ts';

const spellings = (file: string) => [file, `./${file}`, file.replaceAll('/', '\\'), `.\\${file.replaceAll('/', '\\')}`];
const independent = 'tests/unit/command-runner.test.ts';
const shared = 'tests/unit/windows-appcontainer-executor.test.ts';

// These are data fixtures for the public pure budget projection, not issued
// source receipts used to authorize an effect. No process/provider is mocked.
function source(files: string[], generation = 'a'): Parameters<typeof compileTestBudgetProjection>[0] {
  const digest = `sha256:${generation.repeat(64)}`;
  return { testFiles: files, workspaceSnapshotIdentityDigest: digest,
    testObservationDigest: digest, projectionDigest: digest } as Parameters<typeof compileTestBudgetProjection>[0];
}

test('recognized portable spellings retain the same isolated resource queue', () => {
  for (const [file, resourceClass] of [[independent, 'independent-process'], [shared, 'shared-host-runtime']] as const) {
    for (const spelling of spellings(file)) {
      assert.equal(isSecRepositoryTestModulePath(spelling), true);
      const partition = partitionFastTestFiles([spelling]);
      assert.deepEqual(partition.concurrent, []);
      assert.deepEqual(partition.resourceQueues[resourceClass], [file]);
    }
  }
});

test('default exclusion cannot be avoided with an already-supported portable spelling', () => {
  for (const spelling of spellings('tests/integration/semantic-mutation-apply.test.ts')) {
    assert.equal(isDefaultFastTestFile(spelling), false);
  }
  assert.equal(isDefaultFastTestFile('tests/unit/unregistered.test.ts'), true);
});

test('partition and process planning both reject duplicate lexical identities', () => {
  for (const file of [independent, shared, 'tests/unit/plain.test.ts']) {
    for (const spelling of spellings(file)) {
      assert.throws(() => partitionFastTestFiles([file, spelling]), /unique files/);
      assert.throws(() => planFastTestProcesses([file, spelling]), /unique files/);
    }
  }
});

test('canonical input ordering and shard boundaries are unchanged and caller arrays are not rewritten', () => {
  const original = ['tests/unit/z.test.ts', independent, 'src/alpha_spec.ts', shared, 'tests/unit/a.test.ts'];
  const input = original.map((file, index) => spellings(file)[index % 4]!);
  const before = [...input];
  const plan = planFastTestProcesses(input, 2);
  assert.deepEqual(plan.concurrentShards, [['tests/unit/z.test.ts', 'src/alpha_spec.ts'], ['tests/unit/a.test.ts']]);
  assert.deepEqual(plan.resourceQueues['independent-process'], [independent]);
  assert.deepEqual(plan.resourceQueues['shared-host-runtime'], [shared]);
  assert.deepEqual(input, before);
  assert.deepEqual(plan, planFastTestProcesses(original, 2));
});

test('resource declarations reject aliases of an existing registration without conflating distinct paths', () => {
  const definition = { file: independent, reason: 'fixture isolation', resourceClass: 'independent-process' as const };
  for (const spelling of spellings(independent)) {
    assert.throws(() => assertUniqueFastTestProcessIsolationDefinitions([definition, { ...definition, file: spelling }]), /duplicated/);
  }
  assert.doesNotThrow(() => assertUniqueFastTestProcessIsolationDefinitions([
    definition, { ...definition, file: 'src/command-runner.test.ts' }
  ]));
});

test('complete inventory accepts supported spellings but rejects a duplicate or a missing registration', () => {
  // Registry enumeration constructs the required inventory; its classification
  // is not used as an oracle. Explicit missing/duplicate mutations test admission.
  const files = [...new Set([...DEFAULT_FAST_TEST_EXCLUDED_FILES,
    ...FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(entry => entry.file)])];
  assert.doesNotThrow(() => assertFastTestProcessPolicyInventory(files));
  assert.doesNotThrow(() => assertFastTestProcessPolicyInventory(files.map(file => `./${file}`)));
  assert.throws(() => assertFastTestProcessPolicyInventory([...files, `./${independent}`]), /duplicated/);
  assert.throws(() => assertFastTestProcessPolicyInventory(files.filter(file => file !== independent)), /stale/);
});

test('case-distinct filenames and identical basenames in different directories stay distinct', () => {
  const files = ['tests/unit/Sample.test.ts', 'tests/unit/sample.test.ts', 'src/sample.test.ts'];
  assert.deepEqual(partitionFastTestFiles(files).concurrent, files);
});

test('slow-suite lookup uses the same spelling key as test recognition', () => {
  for (const spelling of spellings('tests/e2e/graph.test.ts')) {
    assert.deepEqual(slowTestSuiteIdsForFile(spelling), ['e2e-graph']);
  }
  assert.deepEqual(slowTestSuiteIdsForFile('tests/unit/unregistered.test.ts'), []);
});

test('budget projection emits one selected file and canonical slow-suite membership for path aliases', () => {
  const result = compileTestBudgetProjection(source([
    './tests/unit/plain.test.ts', 'tests/unit/plain.test.ts', '.\\tests\\e2e\\graph.test.ts',
    'tests/e2e/graph.test.ts', 'tests/testkit/helper.ts'
  ]));
  assert.deepEqual(result.testFiles, ['tests/e2e/graph.test.ts', 'tests/unit/plain.test.ts']);
  assert.deepEqual(result.fastTestFiles, ['tests/unit/plain.test.ts']);
  assert.deepEqual(result.slowTestFiles, ['tests/e2e/graph.test.ts']);
  assert.equal(result.slowSuites[0]!.id, 'e2e-graph');
  assert.deepEqual(result.slowSuites[0]!.files, ['tests/e2e/graph.test.ts']);
});

test('equivalent spellings share a cached projection while changed membership invalidates it', () => {
  const cache = new TestBudgetProjectionCache();
  const first = cache.project(source(['tests/unit/a.test.ts']));
  assert.equal(cache.project(source(['./tests/unit/a.test.ts', 'tests\\unit\\a.test.ts'])), first);
  const changed = cache.project(source(['tests/unit/b.test.ts']));
  assert.notEqual(changed, first); assert.deepEqual(changed.testFiles, ['tests/unit/b.test.ts']);
  assert.notEqual(cache.project(source(['tests/unit/b.test.ts'], 'b')), changed);
});

test('known suite completeness and unowned slow-file rejection remain unchanged', () => {
  assert.throws(() => compileTestBudgetProjection(source(['tests/e2e/not-registered.test.ts'])), /explicit suite owner/);
  assert.throws(() => compileTestBudgetProjection(source(['tests/e2e/import-organizer-staged.test.ts'])), /explicit suite owner/);
  assert.deepEqual(compileTestBudgetProjection(source([])).testFiles, []);
});

test('shard and concurrency ceilings retain their previous resource semantics', () => {
  for (const size of [0, -1, 17, 1.5, NaN, Infinity]) assert.throws(() => planFastTestProcesses([], size));
  for (const cpus of [1, 2, 8, 16, 32]) {
    const budget = resolveFastTestConcurrencyBudget(cpus);
    const managed = resolveManagedFastTestConcurrency(budget, null);
    assert.ok(managed.innerConcurrency * managed.outerProcessConcurrency <= Math.min(cpus, 16));
    assert.throws(() => resolveManagedFastTestConcurrency(budget, budget.globalBudget + 1));
  }
});
