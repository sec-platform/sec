import assert from 'node:assert/strict';
import { test } from 'bun:test';

import {
  compileSourceProgramMechanismReview as review,
  type MechanismReviewModel
} from '../../src/brownfield/repository-audit/mechanism-review.ts';

type Capability = MechanismReviewModel['capabilities'][number];
type Reference = MechanismReviewModel['references'][number];
type Dependency = MechanismReviewModel['dependencies'][number];

function facts(): MechanismReviewModel {
  return {
    sourceRevision: 'exact-source', modelDigest: 'exact-model',
    files: [
      { path: 'src/a.ts', contentDigest: 'a-bytes', surface: 'production' },
      { path: 'src/b.ts', contentDigest: 'b-bytes', surface: 'production' },
      { path: 'package.json', contentDigest: 'package-bytes', surface: 'resource' }
    ],
    declarations: [
      { observationId: 'a', path: 'src/a.ts', moduleId: 'module-a' },
      { observationId: 'b', path: 'src/b.ts', moduleId: 'module-b' }
    ],
    capabilities: [], references: [], dependencies: []
  };
}
function capability(fields: Partial<Capability> = {}): Capability {
  return {
    observationId: 'effect-a', path: 'src/a.ts', moduleId: 'module-a',
    capability: 'filesystem', operation: 'readFile', transport: 'native-runtime',
    moduleSpecifier: 'node:fs/promises', owningDeclarationObservationId: 'a',
    observationClass: 'observed', span: { start: 1, end: 8 }, ...fields
  };
}
function call(fields: Partial<Reference> = {}): Reference {
  return {
    path: 'src/a.ts', kind: 'call', sourceRelation: 'declaration',
    sourceObservationId: 'a', targetObservationId: 'a', observationClass: 'observed',
    span: { start: 2, end: 7 }, ...fields
  };
}
function dependency(fields: Partial<Dependency> = {}): Dependency {
  return {
    manifestPath: 'package.json', name: 'library', requirement: '^1', scope: 'runtime',
    consumerPaths: [], observationClass: 'observed', ...fields
  };
}

test('unresolved dependency evidence retains package, requirement, scope and exact manifest identity', () => {
  const result = review({ ...facts(), dependencies: [dependency({ observationClass: 'unknown' })] });
  assert.equal(result.unknowns.length, 1);
  assert.deepEqual(result.unknowns[0], {
    factKind: 'dependency', reason: 'observation-unresolved',
    site: { path: 'package.json', contentDigest: 'package-bytes', start: null, end: null, observationId: null },
    details: { name: 'library', requirement: '^1', scope: 'runtime', observationClass: 'unknown' },
    occurrences: 1
  });
});

test('unlocated source has explicit missing content identity instead of a made-up digest', () => {
  const result = review({ ...facts(), references: [call({ path: 'missing.ts' })] });
  const unknown = result.unknowns[0]!;
  assert.equal(unknown.reason, 'source-file-unavailable');
  assert.equal(unknown.site.contentDigest, null);
  assert.equal(unknown.site.path, 'missing.ts');
  assert.equal(unknown.site.start, 2);
  assert.equal(unknown.site.end, 7);
});

test('a missing enclosing declaration has an actionable callsite and owner identity', () => {
  const result = review({ ...facts(), capabilities: [capability({ owningDeclarationObservationId: 'absent' })] });
  assert.equal(result.unknowns[0]!.reason, 'enclosing-declaration-unresolved');
  assert.equal(result.unknowns[0]!.site.observationId, 'effect-a');
  assert.equal(result.unknowns[0]!.details.ownerId, 'absent');
});

test('invalid ownership and unknown transport remain different unresolved reasons', () => {
  const result = review({ ...facts(), capabilities: [
    capability({ moduleId: 'wrong-module' }), capability({ transport: 'unknown', observationId: 'other' })
  ] });
  assert.deepEqual(new Set(result.unknowns.map((record) => record.reason)), new Set(['ownership-inconsistent', 'transport-unresolved']));
  assert.equal(result.coverage.unresolvedCapabilities, 2);
});

test('unresolved target and malformed source relation remain different call frontiers', () => {
  const result = review({ ...facts(), references: [call({ targetObservationId: 'absent' }), call({ sourceRelation: 'other' })] });
  assert.deepEqual(new Set(result.unknowns.map((record) => record.reason)), new Set(['target-declaration-unresolved', 'scope-relation-unresolved']));
  assert.equal(result.unknowns.find((record) => record.reason === 'target-declaration-unresolved')!.details.targetObservationId, 'absent');
});

test('identical unknown occurrences are aggregated while their total stays reconcilable', () => {
  const record = dependency({ observationClass: 'unknown' });
  const result = review({ ...facts(), dependencies: [record, record, record] });
  assert.equal(result.unknowns.length, 1);
  assert.equal(result.unknowns[0]!.occurrences, 3);
  assert.equal(result.coverage.unresolvedDependencies, 3);
  assert.equal(result.coverage.unresolvedSiteGroups, 1);
});

test('unknown package names and requirements never alias by exchanging their roles', () => {
  const result = review({ ...facts(), dependencies: [
    dependency({ name: 'left', requirement: 'right', observationClass: 'unknown' }),
    dependency({ name: 'right', requirement: 'left', observationClass: 'unknown' })
  ] });
  assert.equal(result.unknowns.length, 2);
  assert.deepEqual(new Set(result.unknowns.map((record) => `${record.details.name}/${record.details.requirement}`)), new Set(['left/right', 'right/left']));
});

test('distinct dependency scopes are not collapsed into an indistinguishable unknown row', () => {
  const result = review({ ...facts(), dependencies: [dependency({ observationClass: 'unknown' }), dependency({ observationClass: 'unknown', scope: 'development' })] });
  assert.equal(result.unknowns.length, 2);
});

test('all unresolved counters reconcile to retained fact occurrences', () => {
  const result = review({ ...facts(), capabilities: [capability({ transport: 'unknown' }), capability({ path: 'missing.ts' })], references: [call({ targetObservationId: null }), call({ path: 'another-missing.ts', kind: 'import' })], dependencies: [dependency({ observationClass: 'unknown' }), dependency({ manifestPath: 'missing.json' })] });
  const total = result.unknowns.reduce((sum, record) => sum + record.occurrences, 0);
  assert.equal(total, result.coverage.unresolvedCapabilities + result.coverage.unresolvedCallReferences + result.coverage.unresolvedDependencies + result.coverage.unlocatedRecords);
  assert.equal(total, 6);
});

test('unknown frontiers are deterministic under record reordering', () => {
  const base = facts();
  const dependencies = [dependency({ observationClass: 'unknown' }), dependency({ observationClass: 'future', requirement: '^2' }), dependency({ observationClass: 'unknown' })];
  assert.deepEqual(review({ ...base, dependencies }), review({ ...base, dependencies: [...dependencies].reverse() }));
});

test('unknown details are detached, deeply frozen and included in the review digest', () => {
  const record = capability({ transport: 'unknown' });
  const first = review({ ...facts(), capabilities: [record] });
  const changed = review({ ...facts(), capabilities: [{ ...record, operation: 'other' }] });
  assert.ok(Object.isFrozen(first.unknowns));
  assert.ok(Object.isFrozen(first.unknowns[0]!.details));
  assert.ok(Object.isFrozen(first.unknowns[0]!.site));
  assert.equal(Object.isFrozen(record), false);
  assert.notEqual(first.reviewDigest, changed.reviewDigest);
});

test('resolved observations cannot disappear into the unknown frontier', () => {
  const result = review({ ...facts(), capabilities: [capability()], references: [call({ sourceRelation: 'module-initialization', sourceObservationId: null, targetObservationId: 'b' })], dependencies: [dependency()] });
  assert.deepEqual(result.unknowns, []);
  assert.equal(result.coverage.unresolvedSiteGroups, 0);
});
