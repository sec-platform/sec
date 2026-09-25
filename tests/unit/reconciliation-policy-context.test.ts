import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { compileRepositoryModuleMembershipSnapshot } from '../../src/adapters/repository/architecture/contract.ts';
import {
  compileSourceProgramFindingDelta as compare,
  summarizeSourceProgramFindingDelta as summarize,
  sourceProgramFindingDeltaIsUnresolved as unresolved
} from '../../src/adapters/repository/source-program-model/reconciliation-findings.ts';
import { captureRepositoryAnalysisPolicy as policy } from '../../src/adapters/repository/source-program-model/repository-analysis-policy.ts';
import { compileVirtualRepositorySourceProgramCompilation } from '../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { compileVirtualSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { rawSha256, sha256 } from '../../src/contracts/canonical.ts';

type Snapshot = Parameters<typeof compare>[0];
const digest = (s: string) => sha256(s) as `sha256:${string}`;
const reviewed = 'src/example/a.ts::function-declaration:run::spawn#1';
function snapshot(hasFinding = false, dispatchers: string[] = [], includeFile = true): Snapshot {
  const source = 'export function run() { return 1; }\n';
  const files = includeFile ? [{ path: 'src/example/a.ts', source, contentDigest: rawSha256(source) }] : [];
  const descriptorPath = 'src/example/module.json';
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path }) => path), descriptorPath],
    descriptorSources: [{ descriptorPath, source: JSON.stringify({
      importGraph: 'runtime', externalEntrypoints: [], capabilityProviders: [], preDependencyBootstrap: false
    }) }]
  });
  const workspaceSnapshot = compileVirtualSnapshot({
    files,
    moduleMembership,
    subject: { kind: 'virtual-mutation', provenance: { kind: 'source-program-virtual-mutation',
      baseSnapshotDigest: digest('policy-context-base'), mutationDigest: digest(includeFile ? 'present' : 'removed') } }
  });
  const compilation = compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot });
  const candidates = hasFinding ? [{ code: 'production-mirrors-source-path' as const, subject: 'src/example/a.ts',
    paths: ['src/example/a.ts'], reason: 'repeated literal', observationClass: 'derived' as const }] : [];
  return Object.freeze({
    ...compilation,
    analysisPolicy: policy(dispatchers),
    model: Object.freeze({ ...compilation.model, candidates: Object.freeze(candidates),
      modelDigest: digest(JSON.stringify({ base: compilation.model.modelDigest, candidates })) })
  });
}

test('a reviewed-dispatcher change cannot turn a disappearing finding into a proved absence', () => {
  const result = compare(snapshot(true), snapshot(false, [reviewed]));
  assert.equal(result.contextComparable, false);
  assert.deepEqual(result.changedContextFields, ['analysisPolicyDigest']);
  assert.equal(result.entries[0]!.status, 'unobserved');
  assert.equal(result.counts.absent, 0); assert.equal(unresolved(result), true);
});

test('the same policy with full observed inputs still admits the existing absent state', () => {
  const result = compare(snapshot(true, [reviewed]), snapshot(false, [reviewed]));
  assert.equal(result.entries[0]!.status, 'absent');
  assert.equal(result.contextComparable, true); assert.equal(unresolved(result), false);
});

test('equivalent review inventories do not invent configuration changes', () => {
  const left = snapshot(true, [reviewed, 'src/b.ts::run']);
  const right = snapshot(false, ['src/b.ts::run', reviewed, reviewed]);
  const result = compare(left, right);
  assert.equal(result.contextComparable, true); assert.deepEqual(result.changedContextFields, []);
  assert.equal(result.entries[0]!.status, 'absent');
});

test('legacy context missing on both sides is unknown, not an implicit empty policy', () => {
  const { analysisPolicy: _beforePolicy, ...before } = snapshot(true);
  const { analysisPolicy: _afterPolicy, ...after } = snapshot(false);
  const result = compare(before, after);
  assert.equal(result.contextComparable, false);
  assert.deepEqual(result.before.incompleteContextFields, ['analysisPolicyDigest']);
  assert.deepEqual(result.after.incompleteContextFields, ['analysisPolicyDigest']);
  assert.equal(result.entries[0]!.status, 'unobserved'); assert.equal(unresolved(result), true);
});

test('a legacy or corrupt side is disclosed even when there are no findings to disappear', () => {
  for (const analysisPolicy of [undefined, null, {}, { ...policy([]), policyDigest: digest('wrong') }]) {
    const result = compare(snapshot(), { ...snapshot(), analysisPolicy } as never);
    assert.equal(result.contextComparable, false);
    assert.equal(result.entries.length, 0);
    assert.deepEqual(result.after.incompleteContextFields, ['analysisPolicyDigest']);
    assert.equal(unresolved(result), true);
  }
});

test('a valid policy change alone is observable but does not invent a defect', () => {
  const result = compare(snapshot(false), snapshot(false, [reviewed]));
  assert.equal(result.contextComparable, false); assert.equal(result.entries.length, 0);
  assert.equal(unresolved(result), false);
  assert.deepEqual(result.after.incompleteContextFields, []);
});

test('persistent evidence is not erased or suppressed when the policy changes', () => {
  const result = compare(snapshot(true), snapshot(true, [reviewed]));
  assert.equal(result.entries[0]!.status, 'persistent');
  assert.equal(result.contextComparable, false);
  assert.equal(result.counts.persistent, 1); assert.equal(result.counts.absent, 0);
});

test('scope retirement remains separate from changing or losing policy context', () => {
  const removed = snapshot(false, [reviewed], false);
  assert.equal(compare(snapshot(true), removed).entries[0]!.status, 'out-of-scope');
  assert.equal(compare(snapshot(true), removed).counts.absent, 0);
});

test('compact and full output preserve both sides of incomplete context and one digest', () => {
  const delta = compare({ ...snapshot(true), analysisPolicy: undefined }, snapshot());
  const compact = summarize(delta);
  assert.deepEqual(compact.before.incompleteContextFields, ['analysisPolicyDigest']);
  assert.deepEqual(compact.after.incompleteContextFields, []);
  assert.equal(compact.contextComparable, delta.contextComparable);
  assert.equal(compact.deltaDigest, delta.deltaDigest);
  assert.deepEqual(compact.counts, delta.counts);
});

test('source changes do not invalidate unchanged analysis policy or the comparison by themselves', () => {
  const after = snapshot(false, [reviewed]);
  const files = after.workspaceSnapshot.files.map(f => ({ ...f, contentDigest: digest('new bytes') }));
  const changed = { ...after, sourceRevision: digest('new source'),
    workspaceSnapshot: { ...after.workspaceSnapshot, files },
    model: { ...after.model, files: after.model.files.map(f => ({ ...f, contentDigest: digest('new bytes') })) } } as Snapshot;
  assert.equal(compare(snapshot(true, [reviewed]), changed).entries[0]!.status, 'absent');
});

test('every pair of small review sets compares only equal sets as the same analysis condition', () => {
  const names = [reviewed, 'src/b.ts::run', 'src/c.ts::run'];
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
    const result = compare(snapshot(true, names.filter((_, i) => a & 1 << i)),
      snapshot(false, names.filter((_, i) => b & 1 << i)));
    assert.equal(result.contextComparable, a === b);
    assert.equal(result.entries[0]!.status, a === b ? 'absent' : 'unobserved');
  }
});
