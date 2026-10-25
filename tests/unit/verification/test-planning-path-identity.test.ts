import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { compileVirtualWorkspaceSourceSnapshot } from '../../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import {
  type IssuedTestInventoryProjection,
  compileTestBudgetProjection,
  issueTestInventoryProjection,
  slowTestSuiteIdsForFile
} from '../../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { rawSha256, sha256 } from '../../../src/contracts/canonical.ts';

const spellings = (file: string) => [file, `./${file}`, file.replaceAll('/', '\\'), `.\\${file.replaceAll('/', '\\')}`];

// These are data fixtures for the public pure budget projection, not issued
// source receipts used to authorize an effect. No process/provider is mocked.
function snapshot(files: string[], generation = 'a') {
  const digest = `sha256:${generation.repeat(64)}` as `sha256:${string}`;
  const sources = Object.fromEntries(files.map((path) => [path, 'export {};\n']));
  return compileVirtualWorkspaceSourceSnapshot({
    subject: { kind: 'virtual-mutation', provenance: { kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: digest, mutationDigest: sha256(sources) as `sha256:${string}` } },
    files: Object.entries(sources).map(([path, text]) => ({ path, source: text, contentDigest: rawSha256(text) })),
    moduleMembership: { descriptors: [], graphRoots: [], moduleRoots: [], moduleForPath: () => null }
  });
}

function source(files: string[], generation = 'a'): Parameters<typeof compileTestBudgetProjection>[0] {
  return issueTestInventoryProjection({ snapshot: snapshot(files, generation) });
}

test('slow-suite lookup uses the same spelling key as test recognition', () => {
  for (const spelling of spellings('tests/e2e/verification/graph.test.ts')) {
    assert.deepEqual(slowTestSuiteIdsForFile(spelling), ['e2e-graph']);
  }
  assert.deepEqual(slowTestSuiteIdsForFile('tests/unit/unregistered.test.ts'), []);
});

test('budget projection emits canonical fast and slow suite membership from issued snapshot paths', () => {
  const result = compileTestBudgetProjection(source([
    'tests/unit/plain.test.ts', 'tests/e2e/verification/graph.test.ts', 'tests/testkit/helper.ts'
  ]));
  assert.deepEqual(result.testFiles, ['tests/e2e/verification/graph.test.ts', 'tests/unit/plain.test.ts']);
  assert.deepEqual(result.fastTestFiles, ['tests/unit/plain.test.ts']);
  assert.deepEqual(result.slowTestFiles, ['tests/e2e/verification/graph.test.ts']);
  assert.equal(result.slowSuites[0]!.id, 'e2e-graph');
  assert.deepEqual(result.slowSuites[0]!.files, ['tests/e2e/verification/graph.test.ts']);
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
  assert.throws(
    () => issueTestInventoryProjection({ snapshot: { ...issuedSnapshot } }),
    /not issued by the Source Program owner/
  );
});

test('known suite completeness and unowned slow-file rejection remain unchanged', () => {
  assert.throws(() => compileTestBudgetProjection(source(['tests/e2e/not-registered.test.ts'])), /explicit suite owner/);
  assert.throws(() => compileTestBudgetProjection(source(['tests/e2e/development/import-organizer-staged.test.ts'])), /explicit suite owner/);
  assert.deepEqual(compileTestBudgetProjection(source([])).testFiles, []);
});
