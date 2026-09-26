import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { compileVirtualSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import {
  assertFastTestProcessPolicyInventory, assertUniqueFastTestProcessIsolationDefinitions,
  DEFAULT_FAST_TEST_EXCLUDED_FILES, FAST_TEST_PROCESS_ISOLATION_REGISTRY,
  isDefaultFastTestFile, partitionFastTestFiles, planFastTestProcesses
} from '../../src/adapters/self-hosting/development/runner/fast-test-policy.ts';
import {
  type IssuedTestInventoryProjection,
  compileTestBudgetProjection,
  issueTestInventoryProjection,
  slowTestSuiteIdsForFile
} from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { rawSha256, sha256 } from '../../src/contracts/canonical.ts';
import { isRepositoryTestModulePath } from '../../src/contracts/repository-test-path.ts';

const spellings = (file: string) => [file, `./${file}`, file.replaceAll('/', '\\'), `.\\${file.replaceAll('/', '\\')}`];
const independent = 'tests/unit/command-runner.test.ts';
const shared = 'tests/unit/windows-appcontainer-executor.test.ts';

// These are data fixtures for the public pure budget projection, not issued
// source receipts used to authorize an effect. No process/provider is mocked.
function snapshot(files: string[], generation = 'a') {
  const digest = `sha256:${generation.repeat(64)}` as `sha256:${string}`;
  const sources = Object.fromEntries(files.map((path) => [path, 'export {};\n']));
  return compileVirtualSnapshot({
    subject: { kind: 'virtual-mutation', provenance: { kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: digest, mutationDigest: sha256(sources) as `sha256:${string}` } },
    files: Object.entries(sources).map(([path, text]) => ({ path, source: text, contentDigest: rawSha256(text) })),
    moduleMembership: { descriptors: [], graphRoots: [], moduleRoots: [], moduleForPath: () => null }
  });
}

function source(files: string[], generation = 'a'): Parameters<typeof compileTestBudgetProjection>[0] {
  return issueTestInventoryProjection({ snapshot: snapshot(files, generation) });
}

test('recognized portable spellings retain the same isolated resource queue', () => {
  for (const [file, resourceClass] of [[independent, 'independent-process'], [shared, 'shared-host-runtime']] as const) {
    for (const spelling of spellings(file)) {
      assert.equal(isRepositoryTestModulePath(spelling), true);
      const partition = partitionFastTestFiles([spelling]);
      assert.deepEqual(partition.concurrent, []);
      assert.deepEqual(partition.resourceQueues[resourceClass], [file]);
    }
  }
});

test('default exclusion cannot be avoided with an already-supported portable spelling', () => {
  for (const spelling of spellings('tests/integration/semantic-mutation/apply.test.ts')) {
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

test('native parallel input preserves canonical ordering without rewriting caller arrays', () => {
  const original = ['tests/unit/z.test.ts', independent, 'src/alpha_spec.ts', shared, 'tests/unit/a.test.ts'];
  const input = original.map((file, index) => spellings(file)[index % 4]!);
  const before = [...input];
  const plan = planFastTestProcesses(input);
  assert.deepEqual(plan.parallelFiles, ['tests/unit/z.test.ts', 'src/alpha_spec.ts', 'tests/unit/a.test.ts']);
  assert.deepEqual(plan.resourceQueues['independent-process'], [independent]);
  assert.deepEqual(plan.resourceQueues['shared-host-runtime'], [shared]);
  assert.deepEqual(input, before);
  assert.deepEqual(plan, planFastTestProcesses(original));
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

test('inventory rejects duplicate identities and stale isolation registrations', () => {
  const files = [...new Set([...DEFAULT_FAST_TEST_EXCLUDED_FILES,
    ...FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(entry => entry.file)])];
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

test('budget projection emits canonical fast and slow suite membership from issued snapshot paths', () => {
  const result = compileTestBudgetProjection(source([
    'tests/unit/plain.test.ts', 'tests/e2e/graph.test.ts', 'tests/testkit/helper.ts'
  ]));
  assert.deepEqual(result.testFiles, ['tests/e2e/graph.test.ts', 'tests/unit/plain.test.ts']);
  assert.deepEqual(result.fastTestFiles, ['tests/unit/plain.test.ts']);
  assert.deepEqual(result.slowTestFiles, ['tests/e2e/graph.test.ts']);
  assert.equal(result.slowSuites[0]!.id, 'e2e-graph');
  assert.deepEqual(result.slowSuites[0]!.files, ['tests/e2e/graph.test.ts']);
});

test('test inventory follows runnable snapshot paths without treating TypeScript project membership as runtime authority', () => {
  const inventory = source([
    'tests/unit/tsconfig-excluded.test.ts',
    'src/colocated.test.ts',
    'tests/fixtures/runtime-fixture.test.ts',
    'tests/testkit/helper.ts',
    'tests/unit/compile-only.typecheck.ts',
    'tsconfig.json'
  ]);
  assert.deepEqual(inventory.testFiles, [
    'src/colocated.test.ts',
    'tests/unit/tsconfig-excluded.test.ts'
  ]);
});

test('test budget rejects caller-authored inventory and an unissued workspace snapshot', () => {
  const issued = source(['tests/unit/plain.test.ts']);
  assert.throws(
    () => compileTestBudgetProjection({ ...issued } as IssuedTestInventoryProjection),
    /owner-issued workspace snapshot projection/
  );
  const issuedSnapshot = snapshot(['tests/unit/plain.test.ts']);
  let snapshotReads = 0;
  const captured = issueTestInventoryProjection({
    get snapshot() {
      snapshotReads += 1;
      if (snapshotReads > 1) throw new Error('snapshot getter was read more than once');
      return issuedSnapshot;
    }
  });
  assert.equal(snapshotReads, 1);
  assert.deepEqual(captured.testFiles, ['tests/unit/plain.test.ts']);
  assert.throws(
    () => issueTestInventoryProjection({ snapshot: { ...issuedSnapshot } }),
    /not issued by the Source Program owner/
  );
});

test('known suite completeness and unowned slow-file rejection remain unchanged', () => {
  assert.throws(() => compileTestBudgetProjection(source(['tests/e2e/not-registered.test.ts'])), /explicit suite owner/);
  assert.throws(() => compileTestBudgetProjection(source(['tests/e2e/import-organizer-staged.test.ts'])), /explicit suite owner/);
  assert.deepEqual(compileTestBudgetProjection(source([])).testFiles, []);
});
