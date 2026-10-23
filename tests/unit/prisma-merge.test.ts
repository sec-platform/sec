import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mergePrismaSchemas } from '../../src/compiler/templates/prisma-schema.ts';

test('mergePrismaSchemas preserves supported block kinds', () => {
  const schema = `
// Global comment
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}

enum Role {
  USER
  ADMIN
}
`;

  expect(mergePrismaSchemas('', schema)).toBe(schema.trimStart());
});

test('mergePrismaSchemas adds non-conflicting model fields and attributes', () => {
  const existing = `
datasource db {
  provider = "sqlite"
}

model User {
  id    Int    @id
  email String @unique
  @@index([email])
}
`;

  const template = `
datasource db {
  provider = "sqlite"
}

model User {
  email String @unique
  phone String @unique
  role  String @default("USER")
  @@index([phone])
}

model Post {
  id Int @id
}
`;

  const merged = mergePrismaSchemas(existing, template);
  expect(merged).toContain('email String @unique');
  expect(merged).toContain('phone String @unique');
  expect(merged).toContain('role  String @default("USER")');
  expect(merged).toContain('@@index([email])');
  expect(merged).toContain('@@index([phone])');
  expect(merged).toContain('model Post {');
});

const schema = (type: string, name: string, body: string) => `${type} ${name} {\n${body}\n}\n`;
const model = (body: string) => schema('model', 'Record', body);
const parseFailure = (error: unknown) => (error as { code?: string }).code === 'COMPOSE-PRISMA-002';

for (const invalid of ['model A {}}', 'model A {} model B {}', 'model A {} nonsense',
  'model A {\n id String @default("unclosed)\n}', 'model A {\n id Int\n}}', 'model A {\n id Int\n} {']) {
  test(`schema refuses structurally lost syntax: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => mergePrismaSchemas(invalid, ''), parseFailure);
  });
}

test('quoted and comment delimiters are not structural braces', () => {
  const input = model('  text String @default("} { // \\\"value\\\"") // }');
  assert.equal(mergePrismaSchemas(input, input), input);
});

test('a trailing comment brace is not accidentally incorporated into a merged body', () => {
  const existing = 'model Record {\n  id Int @id\n} // tail }\n';
  const merged = mergePrismaSchemas(existing, model('  name String'));
  assert.equal(merged, 'model Record {\n  id Int @id\n  name String\n} // tail }\n');
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
  assert.equal(merged, model(' id Int @id\n name String'));
});

for (const type of ['model', 'type', 'enum']) test(`${type} member conflicts are refused, not resolved by source order`, () => {
  const first = schema(type, 'Value', type === 'enum' ? ' ACTIVE @map("active")' : ' id Int');
  const second = schema(type, 'Value', type === 'enum' ? ' ACTIVE @map("other")' : ' id String');
  assert.throws(() => mergePrismaSchemas(first, second), parseFailure);
  if (type === 'model') {
    assert.throws(() => mergePrismaSchemas(model(' email String @unique'), model(' email String')),
      error => parseFailure(error) && /field "email" conflicts/.test((error as Error).message));
  }
});

for (const type of ['datasource', 'generator']) test(`${type} keeps its explicit non-mergeable configuration contract`, () => {
  assert.throws(() => mergePrismaSchemas(schema(type, 'db', ' provider = "one"'), schema(type, 'db', ' provider = "two"')), parseFailure);
});

test('enum comments remain attached to their original values', () => {
  const first = schema('enum', 'Status', ' /// Active\n ACTIVE\n /// Idle\n IDLE');
  const second = schema('enum', 'Status', ' /// Pending\n PENDING\n /// Archived\n ARCHIVED');
  const merged = mergePrismaSchemas(first, second);
  const enumBody = /^\s*enum\s+Status\s*\{([\s\S]*)\}\s*$/u.exec(merged);
  assert.ok(enumBody);
  assert.deepEqual(enumBody[1]!.split(/\r?\n/u).map(line => line.trim().replace(/^\/\/\/[ \t]*/u, '/// ')).filter(Boolean), [
    '/// Active', 'ACTIVE', '/// Idle', 'IDLE',
    '/// Pending', 'PENDING', '/// Archived', 'ARCHIVED'
  ]);
  assert.equal(mergePrismaSchemas(merged, second), merged);
});

test('identical and subset merges preserve the existing normalized bytes', () => {
  const input = '\nmodel Record {\n\n  id Int @id\n\n  name String\n}\n\n';
  assert.equal(mergePrismaSchemas(input, model('  id Int @id')), input);
  assert.equal(mergePrismaSchemas(input.replaceAll('\n', '\r\n'), ''), input);
});

test('incomplete and duplicate block definitions stay invalid even if duplicate bytes are identical', () => {
  assert.throws(() => mergePrismaSchemas('model User {\n  id Int @id\n', ''),
    error => parseFailure(error) && /is not closed/.test((error as Error).message));
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
