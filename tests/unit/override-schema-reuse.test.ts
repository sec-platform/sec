import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { validateOverrideManifest } from '../../src/compiler/contract/override-validation.ts';
import { OverrideManifestSchema, OverrideSourceSchema } from '../../src/semantics/provenance/override-schema.ts';
import { emptyOverrideManifest, type OverrideManifest, type OverrideSource } from '../../src/semantics/provenance/types.ts';

const row = (id = 'first', target = 'src/value.ts') => ({ id, entry: `patches/${id}.ts`, target, reason: '  reason  ' });
const validate = (input: unknown) => validateOverrideManifest(input as OverrideManifest);

test('original defaults and reason normalization are provided by the single schema', () => {
  const raw = { overrides: [row()] }, parsed = validate(raw);
  assert.deepEqual(parsed.overrides[0], { ...row(), reason: 'reason', source: 'manual', conflictsWith: [] });
  assert.deepEqual(OverrideManifestSchema.parse(raw), parsed);
  assert.equal(raw.overrides[0]?.reason, '  reason  ');
});

test('empty input and empty helper share the established output shape', () => {
  assert.deepEqual(OverrideManifestSchema.parse({}), emptyOverrideManifest());
  assert.deepEqual(validate({}), emptyOverrideManifest());
});

test('the source type and schema expose the same legal values', () => {
  const values: OverrideSource[] = [...OverrideSourceSchema.options];
  assert.deepEqual(values, ['manual', 'rule-backed']);
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
    { overrides: [{ ...row(), entry: '../source.ts' }] }
  ]) assert.throws(() => validate(input));
});

test('one decode returns detached arrays without hand-written field copying', () => {
  const first = { ...row('first', 'src/a.ts'), conflictsWith: ['second'] };
  const raw = { overrides: [first, row('second', 'src/b.ts')] };
  const parsed = validate(raw); parsed.overrides[0]!.conflictsWith.length = 0;
  assert.deepEqual(first.conflictsWith, ['second']);
  assert.notEqual(parsed, raw);
});


test('default arrays are independently owned across parses and between entries', () => {
  const first = validate({}), second = validate({});
  assert.notEqual(first.overrides, second.overrides);
  const pair = validate({ overrides: [row('first', 'src/a.ts'), row('second', 'src/b.ts')] });
  const repeat = validate({ overrides: [row('first', 'src/a.ts')] });
  assert.notEqual(pair.overrides[0]!.conflictsWith, pair.overrides[1]!.conflictsWith);
  assert.notEqual(pair.overrides[0]!.conflictsWith, repeat.overrides[0]!.conflictsWith);
  pair.overrides[0]!.conflictsWith.push('second');
  assert.deepEqual(pair.overrides[1]!.conflictsWith, []);
  assert.deepEqual(repeat.overrides[0]!.conflictsWith, []);
});
