import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { SourceProgramCandidate } from '../../../src/adapters/repository/source-program-model/contract.ts';
import {
  compileSourceProgramFindingDelta as compare,
  sourceProgramFindingDeltaIsUnresolved as unresolved
} from '../../../src/adapters/repository/source-program-model/reconciliation-findings.ts';
import { sha256 } from '../../../src/contracts/canonical.ts';

import { captureRepositoryAnalysisPolicy } from '../../../src/adapters/repository/source-program-model/repository-analysis-policy.ts';

type Snapshot = Parameters<typeof compare>[0];
type Candidate = SourceProgramCandidate;
const reviewed = 'src/example/a.ts::function-declaration:run::spawn#1';
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

test('stable, changed and introduced findings preserve identity when review policy changes', () => {
  const before = snapshot([finding('stable'), finding('changed')]);
  const after = { ...snapshot([finding('stable'), finding('changed', ['src/a.ts'], 'new reason'), finding('new')],
    ['src/a.ts', 'src/clean-a.ts', 'src/clean-b.ts']), analysisPolicy: captureRepositoryAnalysisPolicy([reviewed]) };
  const delta = compare(before, after);
  assert.deepEqual(Object.fromEntries(delta.entries.map(entry => [entry.subject, entry.status])), {
    changed: 'changed', new: 'introduced', stable: 'persistent'
  });
  assert.equal(delta.counts.persistent, 1);
  assert.equal(delta.counts.absent, 0); assert.equal(unresolved(delta), false);
  assert.equal(delta.contextComparable, false);
  assert.deepEqual(delta.changedContextFields, ['analysisPolicyDigest']);
  const stable = delta.entries.find(entry => entry.subject === 'stable')!;
  assert.throws(() => (delta.entries as unknown[]).pop(), TypeError);
  assert.throws(() => (stable.afterPaths as string[]).push('other'), TypeError);
  assert.deepEqual(stable.afterPaths, ['src/a.ts']);
});

test('a moved observation stays changed rather than being counted as a fixed old finding', () => {
  const delta = compare(snapshot([finding()]), snapshot([finding('subject', ['src/moved.ts'])], ['src/moved.ts']));
  assert.equal(delta.entries.length, 1); assert.equal(delta.entries[0]!.status, 'changed');
  assert.deepEqual(delta.scope.removedPaths, ['src/a.ts']); assert.equal(delta.counts.absent, 0);
});

test('removing a path remains out-of-scope when review policy changes, not a resolved finding', () => {
  const removed = { ...snapshot([], []), analysisPolicy: captureRepositoryAnalysisPolicy([reviewed]) };
  const delta = compare(snapshot([finding()]), removed);
  assert.equal(delta.entries[0]!.status, 'out-of-scope'); assert.equal(delta.counts.absent, 0);
  // Actual retirement remains the enclosing owner's separate responsibility.
  assert.equal(unresolved(delta), false);
});

test('an explicitly unobserved selected file cannot certify that a finding disappeared', () => {
  const after = snapshot(), delta = compare(snapshot([finding()]), { ...after,
    model: { ...after.model, files: after.model.files.map(file => ({ ...file, semanticObservationClass: 'unknown' as const })) } });
  assert.equal(delta.entries[0]!.status, 'unobserved'); assert.equal(unresolved(delta), true);
});

test('unresolved facts on either cut invalidate disappearance despite a present observed file', () => {
  const before = snapshot([finding()]), after = snapshot();
  const unknown = (value: Snapshot): Snapshot => ({ ...value, model: { ...value.model,
    unknowns: [{ code: 'unresolved-reference', path: 'src/a.ts', detail: 'missing target', span: null }] } });
  for (const delta of [compare(unknown(before), after), compare(before, unknown(after))]) {
    assert.equal(delta.entries[0]!.status, 'unobserved'); assert.equal(unresolved(delta), true);
  }
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

test('configuration changes without findings remain distinct from product defects', () => {
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

test('order is irrelevant, but repeated observation multiplicity is not discarded', () => {
  const first = finding('a', ['src/a.ts', 'src/b.ts']), second = finding('b');
  const left = snapshot([first, second], ['src/a.ts', 'src/b.ts']);
  const right = snapshot([second, { ...first, paths: [...first.paths].reverse() }], ['src/b.ts', 'src/a.ts']);
  assert.deepEqual(compare(left, left), compare(right, right));
  const more = compare(left, snapshot([first, first, second], ['src/a.ts', 'src/b.ts']));
  const entry = more.entries.find(value => value.subject === 'a')!;
  assert.equal(entry.status, 'changed'); assert.equal(entry.beforeCount, 1); assert.equal(entry.afterCount, 2);
});
