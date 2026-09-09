import { test } from 'bun:test';
import assert from 'node:assert/strict';

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

for (const observationClass of ['unknown', 'unrecognized-future-proof']) {
  test(`dependency evidence ${observationClass} cannot establish a version difference`, () => {
    const result = review({ ...facts(), dependencies: [dependency(), dependency({ requirement: '^2', observationClass })] });
    assert.equal(result.counts['dependency-requirement-divergence'], 0);
    assert.equal(result.coverage.unresolvedDependencies, 1);
    assert.equal(result.coverage.scannedDependencies, 2);
  });
}

test('known requirement differences remain visible alongside unrelated unresolved declarations', () => {
  const result = review({ ...facts(), dependencies: [dependency(), dependency({ requirement: '^2', observationClass: 'derived' }), dependency({ requirement: 'unresolved', observationClass: 'unknown' })] });
  assert.equal(result.coverage.unresolvedDependencies, 1);
  assert.deepEqual(result.findings[0]!.related, ['^1', '^2']);
});

test('a resolved module-initialization call needs no enclosing declaration', () => {
  const result = review({ ...facts(), references: [call({ sourceRelation: 'module-initialization', sourceObservationId: null, targetObservationId: 'b' })] });
  assert.equal(result.coverage.unresolvedCallReferences, 0);
  assert.equal(result.counts['direct-recursive-call'], 0);
});

test('a module-initialization call with an unresolved target is still unresolved', () => {
  const result = review({ ...facts(), references: [call({ sourceRelation: 'module-initialization', sourceObservationId: null, targetObservationId: null })] });
  assert.equal(result.coverage.unresolvedCallReferences, 1);
});

for (const sourceRelation of ['unsupported-scope', 'module-initialization']) {
  test(`inconsistent declaration scope ${sourceRelation} is not treated as a resolved self call`, () => {
    const result = review({ ...facts(), references: [call({ sourceRelation })] });
    assert.equal(result.coverage.unresolvedCallReferences, 1);
    assert.equal(result.counts['direct-recursive-call'], 0);
  });
}

test('a target declaration outside the supplied file set does not complete a reference join', () => {
  const base = facts();
  const result = review({ ...base, declarations: [...base.declarations, { observationId: 'foreign', path: 'src/absent.ts', moduleId: 'foreign' }], references: [call({ targetObservationId: 'foreign' })] });
  assert.equal(result.coverage.unresolvedCallReferences, 1);
});

test('mismatched module ownership cannot establish a distributed transport', () => {
  const result = review({ ...facts(), capabilities: [capability(), capability({ observationId: 'different', moduleId: 'other-module' })] });
  assert.equal(result.coverage.unresolvedCapabilities, 1);
  assert.equal(result.counts['distributed-direct-transport'], 0);
});

test('a capability with a missing enclosing declaration is not reused after its failed join', () => {
  const result = review({ ...facts(), capabilities: [capability(), capability({ path: 'src/b.ts', moduleId: 'module-b', owningDeclarationObservationId: 'missing', observationId: 'b-effect' })] });
  assert.equal(result.coverage.unresolvedCapabilities, 1);
  assert.equal(result.counts['distributed-direct-transport'], 0);
});

test('a capability with a wrong enclosing path cannot contribute to distributed transport', () => {
  const result = review({ ...facts(), capabilities: [capability(), capability({ path: 'src/b.ts', moduleId: 'module-b', owningDeclarationObservationId: 'a', observationId: 'b-effect' })] });
  assert.equal(result.coverage.unresolvedCapabilities, 1);
  assert.equal(result.counts['distributed-direct-transport'], 0);
});

test('unknown future evidence classes stay unresolved rather than silently acquiring proof status', () => {
  const result = review({ ...facts(), capabilities: [capability({ observationClass: 'future' })], references: [call({ observationClass: 'future' })] });
  assert.equal(result.coverage.unresolvedCapabilities, 1);
  assert.equal(result.coverage.unresolvedCallReferences, 1);
  assert.equal(result.findings.length, 0);
});

test('lack of module ownership does not prevent a valid declaration-local mixed-effect observation', () => {
  const base = facts();
  const result = review({ ...base, declarations: [{ ...base.declarations[0]!, moduleId: null }], capabilities: [
    capability({ moduleId: null }), capability({ moduleId: null, observationId: 'network-effect', capability: 'network' })
  ] });
  assert.equal(result.coverage.unresolvedCapabilities, 0);
  assert.equal(result.counts['mixed-effect-declaration'], 1);
  assert.equal(result.counts['distributed-direct-transport'], 0);
});

test('repeated startup effects share one review context and retain every distinct callsite', () => {
  const capabilities = Array.from({ length: 2000 }, (_, index) => capability({
    observationId: `effect-${index}`, owningDeclarationObservationId: null,
    span: { start: index * 10, end: index * 10 + 8 }
  }));
  const result = review({ ...facts(), capabilities });
  assert.equal(result.coverage.findingUnit, 'rule-subject-context');
  assert.equal(result.counts['module-initialization-effect'], 1);
  assert.equal(result.findings[0]!.sites.length, capabilities.length);
  assert.deepEqual(new Set(result.findings[0]!.sites.map((site) => site.observationId)), new Set(capabilities.map((item) => item.observationId)));
});

test('repeated self calls are grouped by their exact declaration without dropping locations', () => {
  const references = Array.from({ length: 2000 }, (_, index) => call({ span: { start: index * 5, end: index * 5 + 3 } }));
  const result = review({ ...facts(), references });
  assert.equal(result.counts['direct-recursive-call'], 1);
  assert.equal(result.findings[0]!.sites.length, 2000);
  assert.equal(new Set(result.findings[0]!.sites.map((site) => site.start)).size, 2000);
});

test('different operations remain separate review contexts', () => {
  const result = review({ ...facts(), capabilities: [capability({ owningDeclarationObservationId: null }), capability({ owningDeclarationObservationId: null, operation: 'writeFile', observationId: 'write' })] });
  assert.equal(result.counts['module-initialization-effect'], 2);
});

test('duplicate observations do not inflate distinct evidence sites', () => {
  const record = capability({ owningDeclarationObservationId: null });
  const result = review({ ...facts(), capabilities: [record, record, record] });
  assert.equal(result.coverage.scannedCapabilities, 3);
  assert.equal(result.counts['module-initialization-effect'], 1);
  assert.equal(result.findings[0]!.sites.length, 1);
});

for (const operationCount of [6, 64, 1024, 4096]) {
  test(`arbitrary operation vocabulary of ${operationCount} remains complete`, () => {
    const capabilities = Array.from({ length: operationCount }, (_, index) => capability({
      owningDeclarationObservationId: null, operation: `domain.operation.${index}`, observationId: `call-${index}`,
      span: { start: index * 3, end: index * 3 + 1 }
    }));
    const result = review({ ...facts(), capabilities });
    assert.equal(result.counts['module-initialization-effect'], operationCount);
    assert.equal(result.findings.length, operationCount);
    assert.equal(new Set(result.findings.flatMap((finding) => finding.sites.map((site) => site.observationId))).size, operationCount);
  });
}

test('thousands of dependency names do not require predeclared semantic categories', () => {
  const dependencies = Array.from({ length: 2048 }, (_, index) => [dependency({ name: `package-${index}` }), dependency({ name: `package-${index}`, requirement: '^2' })]).flat();
  const result = review({ ...facts(), dependencies });
  assert.equal(result.counts['dependency-requirement-divergence'], 2048);
  assert.equal(new Set(result.findings.map((finding) => finding.subject)).size, 2048);
});

test('aggregated diagnostic output remains independent of source observation order', () => {
  const base = facts();
  const capabilities = Array.from({ length: 64 }, (_, index) => capability({ owningDeclarationObservationId: null, operation: `op-${index % 4}`, observationId: `call-${index}`, span: { start: index, end: index + 1 } }));
  const references = Array.from({ length: 64 }, (_, index) => call({ span: { start: index, end: index + 1 } }));
  assert.deepEqual(review({ ...base, capabilities, references }), review({ ...base, capabilities: [...capabilities].reverse(), references: [...references].reverse() }));
});

test('aggregated evidence changes its digest when any retained callsite moves', () => {
  const references = [call(), call({ span: { start: 30, end: 35 } })];
  const before = review({ ...facts(), references });
  const after = review({ ...facts(), references: [references[0]!, { ...references[1]!, span: { start: 31, end: 36 } }] });
  assert.equal(before.findings.length, 1);
  assert.notEqual(before.findings[0]!.findingDigest, after.findings[0]!.findingDigest);
  assert.notEqual(before.reviewDigest, after.reviewDigest);
});

test('the scanner does not freeze input observations while freezing shared output sites', () => {
  const records = [capability({ owningDeclarationObservationId: null }), capability({ path: 'src/b.ts', moduleId: 'module-b', owningDeclarationObservationId: null, observationId: 'b-effect' })];
  const result = review({ ...facts(), capabilities: records });
  assert.ok(result.findings.length > 1);
  for (const record of records) { assert.equal(Object.isFrozen(record), false); assert.equal(Object.isFrozen(record.span), false); }
  for (const finding of result.findings) { assert.ok(Object.isFrozen(finding)); for (const site of finding.sites) assert.ok(Object.isFrozen(site)); }
});

// Roles must not collapse merely because their unlabelled text sets agree.
test('effect category and operation remain distinct roles in a review context', () => {
  const result = review({ ...facts(), capabilities: [
    capability({ owningDeclarationObservationId: null, capability: 'filesystem', operation: 'process', observationId: 'first' }),
    capability({ owningDeclarationObservationId: null, capability: 'process', operation: 'filesystem', observationId: 'second' })
  ] });
  assert.equal(result.counts['module-initialization-effect'], 2);
  assert.deepEqual(new Set(result.findings.map((finding) => finding.related.join(','))), new Set([
    'capability:filesystem,operation:process', 'capability:process,operation:filesystem'
  ]));
});
