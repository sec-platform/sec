import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mergePrismaSchemas, parsePrismaSchema } from '../../src/compiler/compose/prisma-schema.ts';

const schema = (type: string, name: string, body: string) => `${type} ${name} {\n${body}\n}\n`;
const model = (body: string) => schema('model', 'Record', body);
const parseFailure = (error: unknown) => (error as { code?: string }).code === 'COMPOSE-PRISMA-002';

for (const invalid of ['model A {}}', 'model A {} model B {}', 'model A {} nonsense',
  'model A {\n id String @default("unclosed)\n}', 'model A {\n id Int\n}}', 'model A {\n id Int\n} {']) {
  test(`schema refuses structurally lost syntax: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => parsePrismaSchema(invalid), parseFailure);
  });
}

test('quoted and comment delimiters are not structural braces', () => {
  const input = model('  text String @default("} { // \\\"value\\\"") // }');
  assert.equal(parsePrismaSchema(input).blocks.length, 1);
  assert.equal(mergePrismaSchemas(input, input), input);
});

test('a trailing comment brace is not accidentally incorporated into a merged body', () => {
  const existing = 'model Record {\n  id Int @id\n} // tail }\n';
  const merged = mergePrismaSchemas(existing, model('  name String'));
  assert.match(merged, /id Int @id\n  name String\n}/);
  assert.equal(parsePrismaSchema(merged).blocks.length, 1);
  assert.ok(merged.endsWith('} // tail }\n'));
});

test('field documentation remains directly attached when another field is added', () => {
  const existing = model('  /// Primary key\n  id Int @id\n  /// Existing label\n  label String');
  const merged = mergePrismaSchemas(existing, model('  /// New name\n  name String'));
  assert.ok(merged.includes('/// Primary key\n  id Int @id\n  /// Existing label\n  label String\n  /// New name\n  name String'));
  assert.equal(mergePrismaSchemas(merged, model('  /// New name\n  name String')), merged);
});

test('existing model documentation is not moved to another model or the file header', () => {
  const input = '// file\n/// A doc\nmodel A {\n id Int\n}\n\n/// B doc\nmodel B {\n id Int\n}\n// tail\n';
  assert.equal(mergePrismaSchemas(input, schema('model', 'A', ' id Int')), input);
  const extended = mergePrismaSchemas(input, schema('model', 'A', ' value String'));
  assert.match(extended, /\/\/\/ A doc\nmodel A/);
  assert.match(extended, /\/\/\/ B doc\nmodel B/);
  assert.ok(extended.endsWith('// tail\n'));
});

test('template documentation for a new block remains adjacent to that block', () => {
  const merged = mergePrismaSchemas(schema('model', 'A', ' id Int'), '/// B meaning\n' + schema('model', 'B', ' id Int'));
  assert.match(merged, /\/\/\/ B meaning\nmodel B/);
});

test('same-name model contributions merge members, not duplicate model definitions', () => {
  const merged = mergePrismaSchemas(model(' id Int @id'), model(' name String'));
  assert.equal(parsePrismaSchema(merged).blocks.length, 1);
  assert.ok(merged.includes('id Int @id')); assert.ok(merged.includes('name String'));
});

for (const type of ['model', 'type', 'enum']) test(`${type} member conflicts are refused, not resolved by source order`, () => {
  const first = schema(type, 'Value', type === 'enum' ? ' ACTIVE @map("active")' : ' id Int');
  const second = schema(type, 'Value', type === 'enum' ? ' ACTIVE @map("other")' : ' id String');
  assert.throws(() => mergePrismaSchemas(first, second), parseFailure);
});

for (const type of ['datasource', 'generator']) test(`${type} keeps its explicit non-mergeable configuration contract`, () => {
  assert.throws(() => mergePrismaSchemas(schema(type, 'db', ' provider = "one"'), schema(type, 'db', ' provider = "two"')), parseFailure);
});

test('enum comments remain attached to their original values', () => {
  const first = schema('enum', 'Status', ' /// Active\n ACTIVE\n /// Idle\n IDLE');
  const second = schema('enum', 'Status', ' /// Pending\n PENDING');
  const merged = mergePrismaSchemas(first, second);
  assert.match(merged, /\/\/\/ Active\n ACTIVE\n \/\/\/ Idle\n IDLE\n \/\/\/ Pending\n PENDING/);
  assert.equal(mergePrismaSchemas(merged, second), merged);
});

test('identical and subset merges preserve the existing normalized bytes', () => {
  const input = '\nmodel Record {\n\n  id Int @id\n\n  name String\n}\n\n';
  assert.equal(mergePrismaSchemas(input, model('  id Int @id')), input);
  assert.equal(mergePrismaSchemas(input.replaceAll('\n', '\r\n'), ''), input);
});

test('duplicate block definitions stay invalid even if their bytes are identical', () => {
  assert.throws(() => mergePrismaSchemas(model(' id Int') + model(' id Int'), ''), parseFailure);
});

test('seeded additions retain unique field identities and are idempotent', () => {
  for (let count = 1; count <= 150; count++) {
    const a = Array.from({ length: count }, (_, i) => ` f${i} Int`);
    const b = Array.from({ length: count }, (_, i) => ` f${i + Math.floor(count / 2)} Int`);
    const merged = mergePrismaSchemas(model(a.join('\n')), model(b.join('\n')));
    const expected = new Set([...a, ...b]);
    const actual = merged.split('\n').filter(line => /^ f\d+ Int$/.test(line));
    assert.equal(actual.length, expected.size);
    assert.deepEqual(new Set(actual), expected);
    assert.equal(mergePrismaSchemas(merged, model(b.join('\n'))), merged);
  }
});
