import { expect, test } from 'bun:test';
import { mergePrismaSchemas, parsePrismaSchema } from '../../src/compiler/templates/prisma-schema.ts';

test('parsePrismaSchema parses supported block kinds', () => {
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

  const parsed = parsePrismaSchema(schema);
  expect(parsed.blocks.map((block) => `${block.type}:${block.name}`)).toEqual([
    'datasource:db',
    'generator:client',
    'model:User',
    'enum:Role'
  ]);
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

test('mergePrismaSchemas merges enum values deterministically', () => {
  const merged = mergePrismaSchemas(`
enum Role {
  USER
}
`, `
enum Role {
  ADMIN
  MODERATOR
}
`);
  expect(merged).toContain('USER');
  expect(merged).toContain('ADMIN');
  expect(merged).toContain('MODERATOR');
});

test('mergePrismaSchemas rejects same-identity semantic conflicts instead of choosing by order', () => {
  expect(() => mergePrismaSchemas(`
datasource db {
  provider = "sqlite"
}
`, `
datasource db {
  provider = "postgresql"
}
`)).toThrow(/conflicts with the existing schema/);

  expect(() => mergePrismaSchemas(`
model User {
  email String @unique
}
`, `
model User {
  email String
}
`)).toThrow(/field "email" conflicts/);

  expect(() => mergePrismaSchemas(`
enum Role {
  USER @map("user")
}
`, `
enum Role {
  USER @map("member")
}
`)).toThrow(/enum value "USER" conflicts/);
});

test('parsePrismaSchema rejects incomplete or duplicate blocks', () => {
  expect(() => parsePrismaSchema('model User {\n  id Int @id\n')).toThrow(/is not closed/);
  expect(() => parsePrismaSchema('model User {\n}\nmodel User {\n}\n')).toThrow(/duplicate Prisma block/);
});
