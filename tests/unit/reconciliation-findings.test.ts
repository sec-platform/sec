import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  compileSourceProgramFindingDelta as compare,
  summarizeSourceProgramFindingDelta as summarize,
  sourceProgramFindingDeltaIsUnresolved as unresolved
} from '../../src/brownfield/source-program-model/reconciliation-findings.ts';
import { sha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';

import { captureRepositoryAnalysisPolicy } from '../../src/brownfield/source-program-model/repository-analysis-policy.ts';

type Snapshot = Parameters<typeof compare>[0];
type Candidate = Snapshot['model']['candidates'][number];
const digest = (value: string) => sha256(value) as `sha256:${string}`;
function finding(subject = 'subject', paths: readonly string[] = ['src/a.ts'], reason = 'original'): Candidate {
  return { code: 'production-declaration-without-consumer', subject, paths, reason, observationClass: 'derived' };
}
function snapshot(candidates: readonly Candidate[] = [], paths = ['src/a.ts']): Snapshot {
  const files = paths.map(path => ({ path, contentDigest: digest(path), semanticObservationClass: 'observed' as const }));
  // Minimal structural observations for a pure comparison. These are not
  // issued repository receipts and never enter an authority-sensitive owner.
  return { analysisPolicy: captureRepositoryAnalysisPolicy([]), sourceRevision: digest('source'), moduleMembershipDigest: digest('membership'),
    model: { sourceRevision: digest('source'), modelDigest: digest('model'), files,
      candidates, unknowns: [], providers: [{ id: 'typescript', revision: 'fixed' }] },
    workspaceSnapshot: { files }, projectGeneration: {
      compilerRevision: digest('compiler'), providerRevision: digest('provider'),
      compilerConfigDigest: digest('compiler-config'), dependencyGenerationDigest: digest('dependencies'),
      environmentDigest: digest('environment'), projectConfigDigest: digest('project-config')
    } } as unknown as Snapshot;
}

test('stable, changed and introduced findings preserve rule and subject identity', () => {
  const before = snapshot([finding('stable'), finding('changed')]);
  const after = snapshot([finding('stable'), finding('changed', ['src/a.ts'], 'new reason'), finding('new')]);
  const delta = compare(before, after);
  assert.deepEqual(Object.fromEntries(delta.entries.map(entry => [entry.subject, entry.status])), {
    changed: 'changed', new: 'introduced', stable: 'persistent'
  });
  assert.equal(delta.counts.absent, 0); assert.equal(unresolved(delta), false);
});

test('a moved observation stays changed rather than being counted as a fixed old finding', () => {
  const delta = compare(snapshot([finding()]), snapshot([finding('subject', ['src/moved.ts'])], ['src/moved.ts']));
  assert.equal(delta.entries.length, 1); assert.equal(delta.entries[0]!.status, 'changed');
  assert.deepEqual(delta.scope.removedPaths, ['src/a.ts']); assert.equal(delta.counts.absent, 0);
});

test('absent means no longer reported only when both sides cover the selected paths', () => {
  const delta = compare(snapshot([finding()]), snapshot());
  assert.equal(delta.entries[0]!.status, 'absent'); assert.equal(delta.contextComparable, true);
  assert.equal(unresolved(delta), false);
});

test('removing a path from the selected snapshot is out-of-scope, not a resolved finding', () => {
  const delta = compare(snapshot([finding()]), snapshot([], []));
  assert.equal(delta.entries[0]!.status, 'out-of-scope'); assert.equal(delta.counts.absent, 0);
  // Actual retirement remains the enclosing owner's separate responsibility.
  assert.equal(unresolved(delta), false);
});

test('a selected file lost by the observer is a coverage regression and cannot clear a finding', () => {
  const before = snapshot([finding()]), after = snapshot();
  const delta = compare(before, { ...after, model: { ...after.model, files: [] } });
  assert.deepEqual(delta.scope.regressedPaths, ['src/a.ts']);
  assert.equal(delta.entries[0]!.status, 'unobserved'); assert.equal(unresolved(delta), true);
});

test('a newly selected but unobserved file also makes coverage unresolved', () => {
  const after = snapshot([], ['src/a.ts', 'src/new.ts']);
  const delta = compare(snapshot(), { ...after, model: { ...after.model, files: after.model.files.slice(0, 1) } });
  assert.deepEqual(delta.scope.regressedPaths, ['src/new.ts']); assert.equal(unresolved(delta), true);
});

test('stale bytes and explicit unknown classifications cannot serve as current observations', () => {
  for (const patch of [{ contentDigest: digest('other') }, { semanticObservationClass: 'unknown' as const }]) {
    const after = snapshot(), delta = compare(snapshot([finding()]), { ...after,
      model: { ...after.model, files: after.model.files.map(file => ({ ...file, ...patch })) } });
    assert.equal(delta.entries[0]!.status, 'unobserved'); assert.equal(unresolved(delta), true);
  }
});

test('unresolved facts invalidate disappearance without hiding them behind an observed file entry', () => {
  const after = snapshot();
  const delta = compare(snapshot([finding()]), { ...after, model: { ...after.model,
    unknowns: [{ code: 'unresolved-reference', path: 'src/a.ts', detail: 'missing target', span: null }] } });
  assert.equal(delta.entries[0]!.status, 'unobserved'); assert.equal(unresolved(delta), true);
});

test('an unresolved baseline does not prove a clean comparison', () => {
  const before = snapshot([finding()]);
  const delta = compare({ ...before, model: { ...before.model, files: [] } }, snapshot());
  assert.equal(delta.entries[0]!.status, 'unobserved');
});

test('every represented compiler, provider, config, dependency and environment dimension invalidates absence', () => {
  const before = snapshot([finding()]), after = snapshot();
  for (const key of ['compilerRevision', 'providerRevision', 'compilerConfigDigest',
    'dependencyGenerationDigest', 'environmentDigest', 'projectConfigDigest'] as const) {
    const delta = compare(before, { ...after, projectGeneration: { ...after.projectGeneration, [key]: digest('changed') } });
    assert.equal(delta.contextComparable, false); assert.deepEqual(delta.changedContextFields, [key]);
    assert.equal(delta.entries[0]!.status, 'unobserved'); assert.equal(unresolved(delta), true);
  }
});

test('module policy and observed provider changes are compared rather than inherited silently', () => {
  const before = snapshot([finding()]), after = snapshot();
  const membership = compare(before, { ...after, moduleMembershipDigest: digest('new-owner') });
  assert.deepEqual(membership.changedContextFields, ['moduleMembershipDigest']);
  const provider = compare(before, { ...after, model: { ...after.model, providers: [{ id: 'typescript', revision: 'new' }] } });
  assert.deepEqual(provider.changedContextFields, ['providersDigest']);
  assert.equal(membership.counts.unobserved, 1); assert.equal(provider.counts.unobserved, 1);
});

test('source edits are not incorrectly treated as tool changes', () => {
  const after = snapshot();
  const edited = { path: 'src/a.ts', contentDigest: digest('edited'), semanticObservationClass: 'observed' as const };
  const delta = compare(snapshot([finding()]), { ...after, sourceRevision: digest('new-source'),
    workspaceSnapshot: { ...after.workspaceSnapshot, files: [{ ...after.workspaceSnapshot.files[0]!, ...edited }] },
    model: { ...after.model, modelDigest: digest('new-model'), files: [{ ...after.model.files[0]!, ...edited }] } });
  assert.equal(delta.contextComparable, true); assert.equal(delta.entries[0]!.status, 'absent');
});

test('configuration change alone is disclosed, not invented into a product defect', () => {
  const after = snapshot();
  const delta = compare(snapshot(), { ...after, projectGeneration: { ...after.projectGeneration, environmentDigest: digest('new') } });
  assert.equal(delta.contextComparable, false); assert.deepEqual(delta.entries, []); assert.equal(unresolved(delta), false);
});

test('findings without a path, or with partially lost scope, cannot be certified absent', () => {
  for (const paths of [[], ['src/a.ts', 'src/other.ts']]) {
    const delta = compare(snapshot([finding('subject', paths)], ['src/a.ts', 'src/other.ts']), snapshot());
    assert.equal(delta.entries[0]!.status, 'unobserved');
  }
});

test('observed files outside the exact selected snapshot are surfaced and block reconciliation', () => {
  const after = snapshot([], ['src/a.ts', 'src/foreign.ts']);
  const delta = compare(snapshot(), { ...after, workspaceSnapshot: snapshot().workspaceSnapshot });
  assert.deepEqual(delta.after.unexpectedObservedPaths, ['src/foreign.ts']); assert.equal(unresolved(delta), true);
});

test('a larger number of clean files cannot dilute or hide a persistent finding', () => {
  const delta = compare(snapshot([finding()]), snapshot([finding()], ['src/a.ts',
    ...Array.from({ length: 300 }, (_, i) => `src/clean-${i}.ts`)]));
  assert.equal(delta.counts.persistent, 1); assert.equal(delta.counts.absent, 0);
});

test('order is irrelevant, but repeated observation multiplicity is not discarded', () => {
  const first = finding('a', ['src/a.ts', 'src/b.ts']), second = finding('b');
  const left = snapshot([first, second], ['src/a.ts', 'src/b.ts']);
  const right = snapshot([second, { ...first, paths: [...first.paths].reverse() }], ['src/b.ts', 'src/a.ts']);
  assert.deepEqual(compare(left, left), compare(right, right));
  const more = compare(left, snapshot([first, first, second], ['src/a.ts', 'src/b.ts']));
  const entry = more.entries.find(value => value.subject === 'a')!;
  assert.equal(entry.status, 'changed'); assert.equal(entry.beforeCount, 1); assert.equal(entry.afterCount, 2);
});

test('canonical provider ordering does not invalidate the same detector context', () => {
  const before = snapshot([finding()]);
  const providers = [{ id: 'a', revision: '1' }, { id: 'b', revision: '2' }];
  const delta = compare({ ...before, model: { ...before.model, providers } },
    { ...before, model: { ...before.model, providers: [...providers].reverse() } });
  assert.equal(delta.contextComparable, true); assert.equal(delta.counts.persistent, 1);
});

test('compact output retains every decision, scope change and current coverage gap', () => {
  const after = snapshot();
  const delta = compare(snapshot([finding()]), { ...after, model: { ...after.model, files: [] } });
  const compact = summarize(delta);
  assert.deepEqual(compact.counts, delta.counts); assert.deepEqual(compact.scope, delta.scope);
  assert.deepEqual(compact.unobservedPaths, delta.after.unobservedPaths);
  assert.equal(compact.deltaDigest, delta.deltaDigest); assert.equal('entries' in compact, false);
});

test('published results are detached and frozen without freezing caller input', () => {
  const paths = ['src/a.ts']; const source = snapshot([finding('subject', paths)]);
  const delta = compare(source, source); paths.push('later');
  assert.deepEqual(delta.entries[0]!.afterPaths, ['src/a.ts']);
  assert.equal(Object.isFrozen(source), false); assert.ok(Object.isFrozen(delta.entries));
  assert.throws(() => (delta.entries[0]!.afterPaths as string[]).push('other'), TypeError);
});

test('duplicate selected or observed identities reject instead of last-write-wins coverage', () => {
  const after = snapshot();
  assert.throws(() => compare(snapshot(), { ...after, model: { ...after.model, files: [...after.model.files, ...after.model.files] } }), /repeats an observed/);
  assert.throws(() => compare(snapshot(), { ...after, workspaceSnapshot: { ...after.workspaceSnapshot,
    files: [...after.workspaceSnapshot.files, ...after.workspaceSnapshot.files] } }), /repeats a selected/);
});
