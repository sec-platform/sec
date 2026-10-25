import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  compileSourceProgramFindingDelta as compare,
  summarizeSourceProgramFindingDelta as summarize,
  sourceProgramFindingDeltaIsUnresolved as unresolved
} from '../../../src/adapters/repository/source-program-model/reconciliation-findings.ts';
import { captureRepositoryAnalysisPolicy as policy } from '../../../src/adapters/repository/source-program-model/repository-analysis-policy.ts';
import { sha256 } from '../../../src/contracts/canonical.ts';

type Snapshot = Parameters<typeof compare>[0];
const digest = (s: string) => sha256(s) as `sha256:${string}`;
const reviewed = 'src/example/a.ts::function-declaration:run::spawn#1';
function snapshot(hasFinding = false, dispatchers: string[] = [], includeFile = true): Snapshot {
  const files = includeFile ? [{ path: 'src/example/a.ts', contentDigest: digest('source bytes'),
    semanticObservationClass: 'observed' as const }] : [];
  const candidates = hasFinding ? [{ code: 'production-mirrors-source-path' as const, subject: 'src/example/a.ts',
    paths: ['src/example/a.ts'], reason: 'repeated literal', observationClass: 'derived' as const }] : [];
  // The comparison consumes facts, not an issued compilation receipt. Actual
  // compiler/policy handoff remains in repository-policy-compilation.test.ts.
  return {
    sourceRevision: digest('source'), moduleMembershipDigest: digest('membership'),
    analysisPolicy: policy(dispatchers),
    workspaceSnapshot: { files },
    projectGeneration: {
      compilerRevision: digest('compiler'), providerRevision: digest('provider'),
      compilerConfigDigest: digest('config'), dependencyGenerationDigest: digest('dependencies'),
      environmentDigest: digest('environment'), projectConfigDigest: null
    },
    model: { sourceRevision: digest('source'), modelDigest: digest('model'), files, candidates,
      unknowns: [], providers: [{ id: 'typescript', revision: 'fixed' }] }
  } as unknown as Snapshot;
}

test('a reviewed-dispatcher change cannot turn a disappearing finding into a proved absence', () => {
  const result = compare(snapshot(true), snapshot(false, [reviewed]));
  assert.equal(result.contextComparable, false);
  assert.deepEqual(result.changedContextFields, ['analysisPolicyDigest']);
  assert.equal(result.entries[0]!.status, 'unobserved');
  assert.equal(result.counts.absent, 0); assert.equal(unresolved(result), true);
});

test('equivalent review inventories do not invent configuration changes', () => {
  const left = snapshot(true, [reviewed, 'src/b.ts::run']);
  const right = snapshot(false, ['src/b.ts::run', reviewed, reviewed]);
  const result = compare(left, right);
  assert.equal(result.contextComparable, true); assert.deepEqual(result.changedContextFields, []);
  assert.equal(result.entries[0]!.status, 'absent');
  assert.equal(unresolved(result), false);
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
  const delta = compare(snapshot(true), removed);
  assert.equal(delta.entries[0]!.status, 'out-of-scope');
  assert.equal(delta.counts.absent, 0);
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
