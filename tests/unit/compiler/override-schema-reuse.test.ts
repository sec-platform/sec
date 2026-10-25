import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { validateOverrideManifest } from '../../../src/compiler/contract/override-validation.ts';
import { emptyOverrideManifest } from '../../../src/semantics/provenance/types.ts';

const row = (id = 'first', target = 'src/value.ts') => ({ id, entry: `patches/${id}.ts`, target, reason: '  reason  ' });
const validate = validateOverrideManifest;

test('Block conflict selectors retain their own namespace alongside local Override references', () => {
  const conflictsWith = ['second', 'entity/customer@0.2.0', 'entity/customer@0.2.x', 'entity/customer@>=0.2.0'];
  const first = { ...row('first', 'src/a.ts'), source: 'manual', conflictsWith };
  const parsed = validate({ overrides: [
    first,
    { ...row('second', 'src/b.ts'), source: 'rule-backed' }
  ] });
  assert.deepEqual(parsed.overrides[0]!.conflictsWith, conflictsWith);
  assert.deepEqual(parsed.overrides.map(entry => entry.source), ['manual', 'rule-backed']);
  parsed.overrides[0]!.conflictsWith.length = 0;
  assert.deepEqual(first.conflictsWith, ['second', 'entity/customer@0.2.0', 'entity/customer@0.2.x', 'entity/customer@>=0.2.0']);
  assert.equal(first.reason, '  reason  ');
  for (const reference of [
    'entity/customer', 'entity/customer@', 'entity/customer@>=0.2',
    'entity/customer@01.2.x', 'entity/customer@>=01.2.0', 'Entity/customer@0.2.0',
    'entity/customer@0.2.0 || *', 'entity/customer@>=0.2.0 trailing'
  ]) {
    assert.throws(() => validate({ overrides: [{ ...row(), conflictsWith: [reference] }] }),
      error => (error as { code?: string }).code === 'OVERRIDE-SCHEMA-001');
  }
});

for (const field of [{ source: 'custom' }, { conflictsWith: [7] }, { reason: '   ' }, { foreign: true }, { entry: false }]) {
  test(`direct validation refuses malformed structure ${JSON.stringify(field)}`, () => {
    assert.throws(() => validate({ overrides: [{ ...row(), ...field }] }), error => (error as { code?: string }).code === 'OVERRIDE-SCHEMA-001');
  });
}

test('schema acceptance does not authorize a reserved target, duplicate owner or unknown conflict', () => {
  for (const input of [
    { overrides: [row('first', 'package.json')] },
    { overrides: [row('first', 'src/a.ts'), row('second', 'src/a.ts')] },
    { overrides: [{ ...row(), conflictsWith: ['absent'] }] },
    { overrides: [{ ...row(), conflictsWith: ['first'] }] },
    { overrides: [{ ...row(), conflictsWith: ['entity/customer@>=0.2.0', 'entity/customer@>=0.2.0'] }] },
    { overrides: [{ ...row(), entry: '../source.ts' }] }
  ]) assert.throws(() => validate(input));
});

test('default arrays are independently owned across parses and between entries', () => {
  assert.deepEqual(emptyOverrideManifest(), { overrides: [] });
  const first = validate({}), second = validate({});
  assert.deepEqual(first, { overrides: [] });
  first.overrides.push(validate({ overrides: [row()] }).overrides[0]!);
  assert.deepEqual(second.overrides, []);
  const pair = validate({ overrides: [row('first', 'src/a.ts'), row('second', 'src/b.ts')] });
  const repeat = validate({ overrides: [row('first', 'src/a.ts')] });
  pair.overrides[0]!.conflictsWith.push('second');
  assert.deepEqual(pair.overrides[1]!.conflictsWith, []);
  assert.deepEqual(repeat.overrides[0]!.conflictsWith, []);
});
