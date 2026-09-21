import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  MECHANISM_REVIEW_RULES,
  compileSourceProgramMechanismReview as review,
  type MechanismReviewModel
} from '../../src/adapters/repository/repository-audit/mechanism-review.ts';

function model(): MechanismReviewModel {
  return {
    sourceRevision: 'revision', modelDigest: 'model',
    files: [
      { path: 'src/a.ts', contentDigest: 'a-bytes', surface: 'production' },
      { path: 'src/b.ts', contentDigest: 'b-bytes', surface: 'production' },
      { path: 'tests/a.test.ts', contentDigest: 'test-bytes', surface: 'test' },
      { path: 'package.json', contentDigest: 'package-bytes', surface: 'resource' }
    ],
    declarations: [
      { observationId: 'a', path: 'src/a.ts', moduleId: 'a-module' },
      { observationId: 'b', path: 'src/b.ts', moduleId: 'b-module' }
    ],
    references: [], capabilities: [], dependencies: []
  };
}
function capability(overrides: Partial<MechanismReviewModel['capabilities'][number]> = {}): MechanismReviewModel['capabilities'][number] {
  return {
    observationId: 'call-a', path: 'src/a.ts', moduleId: 'a-module',
    capability: 'filesystem', operation: 'readFile', transport: 'native-runtime',
    moduleSpecifier: 'node:fs/promises', owningDeclarationObservationId: 'a',
    observationClass: 'observed', span: { start: 12, end: 34 }, ...overrides
  };
}
function reference(overrides: Partial<MechanismReviewModel['references'][number]> = {}): MechanismReviewModel['references'][number] {
  return {
    path: 'src/a.ts', kind: 'call', sourceRelation: 'declaration',
    sourceObservationId: 'a', targetObservationId: 'a', observationClass: 'observed',
    span: { start: 20, end: 25 }, ...overrides
  };
}

test('empty facts do not imply a clean whole repository', () => {
  const result = review(model());
  assert.equal(result.authority, 'none-diagnostic-only');
  assert.equal(result.coverage.scope, 'supplied-source-program');
  assert.equal(result.coverage.files, 4);
  assert.equal(result.coverage.productionFiles, 2);
  assert.equal(result.findings.length, 0);
  assert.ok(result.coverage.unassessedMechanisms.includes('parameter-value-flow-and-precedence'));
  assert.ok(result.coverage.unassessedMechanisms.includes('physical-races-and-crash-recovery'));
  assert.deepEqual(Object.keys(result.counts).sort(), Object.keys(MECHANISM_REVIEW_RULES).sort());
});

test('module-initialization effects retain exact locations without claiming a defect', () => {
  const result = review({ ...model(), capabilities: [capability({ owningDeclarationObservationId: null })] });
  assert.equal(result.counts['module-initialization-effect'], 1);
  assert.deepEqual(result.findings[0]!.sites, [{ path: 'src/a.ts', contentDigest: 'a-bytes', start: 12, end: 34, observationId: 'call-a' }]);
  assert.equal(result.findings[0]!.disposition, 'review-required');
});

test('the same direct operation in separate declared modules is a review lead', () => {
  const result = review({ ...model(), capabilities: [capability(), capability({
    observationId: 'call-b', path: 'src/b.ts', moduleId: 'b-module', owningDeclarationObservationId: 'b'
  })] });
  const finding = result.findings.find((item) => item.code === 'distributed-direct-transport')!;
  assert.deepEqual(finding.related, ['a-module', 'b-module']);
  assert.equal(finding.sites.length, 2);
});

test('multiple calls within one module are not distributed owners', () => {
  const result = review({ ...model(), capabilities: [capability(), capability({ observationId: 'other-call' })] });
  assert.equal(result.counts['distributed-direct-transport'], 0);
});

test('different transport operations and different packages are not equated', () => {
  for (const change of [{ operation: 'writeFile' }, { moduleSpecifier: 'fs-extra' }]) {
    const result = review({ ...model(), capabilities: [capability(), capability({
      ...change, observationId: 'b-call', moduleId: 'b-module', path: 'src/b.ts', owningDeclarationObservationId: 'b'
    })] });
    assert.equal(result.counts['distributed-direct-transport'], 0);
  }
});

test('repository providers are not relabelled as duplicate direct transport', () => {
  const result = review({ ...model(), capabilities: [
    capability({ transport: 'repository-provider' }),
    capability({ transport: 'repository-provider', path: 'src/b.ts', moduleId: 'b-module', owningDeclarationObservationId: 'b' })
  ] });
  assert.equal(result.counts['distributed-direct-transport'], 0);
});

test('mixed concrete effects point to the shared declaration, not just a file name', () => {
  const result = review({ ...model(), capabilities: [capability(), capability({
    observationId: 'spawn-call', capability: 'process', operation: 'spawn', moduleSpecifier: 'node:child_process'
  })] });
  const finding = result.findings.find((item) => item.code === 'mixed-effect-declaration')!;
  assert.equal(finding.subject, 'a');
  assert.deepEqual(finding.related, ['filesystem', 'process']);
});

test('provider is a transport, not an extra concrete effect family', () => {
  const result = review({ ...model(), capabilities: [capability(), capability({ capability: 'provider' })] });
  assert.equal(result.counts['mixed-effect-declaration'], 0);
});

test('compiler-resolved self calls are distinguished from ordinary references', () => {
  const result = review({ ...model(), references: [reference(), reference({ kind: 'reference' }), reference({ targetObservationId: 'b' })] });
  assert.equal(result.counts['direct-recursive-call'], 1);
  assert.equal(result.findings[0]!.subject, 'a');
});

test('unknown or missing call targets remain visible but never become recursion evidence', () => {
  const result = review({ ...model(), references: [
    reference({ observationClass: 'unknown' }), reference({ targetObservationId: null }),
    reference({ sourceObservationId: 'absent', targetObservationId: 'absent' })
  ] });
  assert.equal(result.counts['direct-recursive-call'], 0);
  assert.equal(result.coverage.unresolvedCallReferences, 3);
});

test('unknown effect transport and a broken declaration join remain unresolved', () => {
  const result = review({ ...model(), capabilities: [
    capability({ transport: 'unknown' }), capability({ owningDeclarationObservationId: 'b' })
  ] });
  assert.equal(result.coverage.unresolvedCapabilities, 2);
  assert.equal(result.findings.length, 0);
});

test('unlocated records are not silently counted as safe production records', () => {
  const result = review({ ...model(), capabilities: [capability({ path: 'missing.ts' })], references: [reference({ path: 'missing.ts' })], dependencies: [
    { name: 'x', requirement: '1', manifestPath: 'missing.json', scope: 'runtime', consumerPaths: [], observationClass: 'observed' }
  ] });
  assert.equal(result.coverage.unlocatedRecords, 3);
});

test('test effects and test calls are outside production opportunities but remain in coverage totals', () => {
  const result = review({ ...model(), capabilities: [capability({ path: 'tests/a.test.ts', owningDeclarationObservationId: null })], references: [reference({ path: 'tests/a.test.ts' })] });
  assert.equal(result.findings.length, 0);
  assert.equal(result.coverage.scannedCapabilities, 1);
  assert.equal(result.coverage.scannedReferences, 1);
});

test('distinct package requirements prompt resolution review, not a conflict verdict', () => {
  const requirements = ['^1.0.0', '^2.0.0'];
  const result = review({ ...model(), dependencies: requirements.map((requirement) => ({
    name: 'example', requirement, manifestPath: 'package.json', scope: 'runtime', consumerPaths: ['src/a.ts'], observationClass: 'observed'
  })) });
  const finding = result.findings.find((item) => item.code === 'dependency-requirement-divergence')!;
  assert.deepEqual(finding.related, requirements);
  assert.equal(finding.disposition, 'review-required');
  assert.equal(finding.sites[0]!.start, null);
});

test('one package requirement repeated does not invent version divergence', () => {
  const dependency = { name: 'example', requirement: '^1.0.0', manifestPath: 'package.json', scope: 'runtime', consumerPaths: [], observationClass: 'observed' };
  assert.equal(review({ ...model(), dependencies: [dependency, dependency] }).findings.length, 0);
});

test('diagnostic output is detached and deeply frozen without freezing its input', () => {
  const input = { ...model(), references: [reference()] };
  const result = review(input);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.references[0]!.span), false);
  assert.ok(Object.isFrozen(result.findings[0]!.sites[0]));
  assert.ok(Object.isFrozen(result.counts));
  assert.equal(Reflect.set(result.findings[0]!.sites[0]!, 'start', 99), false);
});

test('file bytes, model identity and source revision bind the diagnostic digest', () => {
  const base = model(); const a = review(base);
  assert.notEqual(review({ ...base, sourceRevision: 'next' }).reviewDigest, a.reviewDigest);
  assert.notEqual(review({ ...base, modelDigest: 'next-model' }).reviewDigest, a.reviewDigest);
  const withCall = { ...base, references: [reference()] };
  const changed = { ...withCall, files: withCall.files.map((file) => ({ ...file, contentDigest: `${file.contentDigest}-changed` })) };
  assert.notEqual(review(withCall).reviewDigest, review(changed).reviewDigest);
});

test('input order does not change the derived mechanism report', () => {
  const input = { ...model(), capabilities: [capability(), capability({
    path: 'src/b.ts', moduleId: 'b-module', owningDeclarationObservationId: 'b', observationId: 'b-call'
  })], references: [reference(), reference({ path: 'src/b.ts', sourceObservationId: 'b', targetObservationId: 'b' })] };
  assert.deepEqual(review(input), review({ ...input, files: [...input.files].reverse(), declarations: [...input.declarations].reverse(), references: [...input.references].reverse(), capabilities: [...input.capabilities].reverse() }));
});

test('duplicate source or declaration identities are rejected instead of overwritten', () => {
  const input = model();
  assert.throws(() => review({ ...input, files: [...input.files, input.files[0]!] }), /unique source/);
  assert.throws(() => review({ ...input, declarations: [...input.declarations, input.declarations[0]!] }), /unique declaration/);
});
