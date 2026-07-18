import { expect, test } from 'bun:test';
import { mergePrismaSchemas, parsePrismaSchema } from '../../platform/compiler/compose/merge-prisma-template.ts';

test('parsePrismaSchema parses models, enums, datasources, and generators', () => {
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
  name  String?
}

enum Role {
  USER
  ADMIN
}
`;

  const parsed = parsePrismaSchema(schema);
  expect(parsed.blocks).toHaveLength(4);
  expect(parsed.blocks[0]).toEqual({
    type: 'datasource',
    name: 'db',
    content: `datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}`
  });
  expect(parsed.blocks[1]).toEqual({
    type: 'generator',
    name: 'client',
    content: `generator client {
  provider = "prisma-client-js"
}`
  });
  expect(parsed.blocks[2].type).toBe('model');
  expect(parsed.blocks[2].name).toBe('User');
  expect(parsed.blocks[3].type).toBe('enum');
  expect(parsed.blocks[3].name).toBe('Role');
});

test('mergePrismaSchemas merges model fields and block attributes', () => {
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
  provider = "postgres"
}

model User {
  email String
  phone String @unique
  role  String @default("USER")
  @@index([phone])
}

model Post {
  id Int @id
}
`;

  const merged = mergePrismaSchemas(existing, template);
  expect(merged).toContain('model User {');
  expect(merged).toContain('id    Int    @id');
  expect(merged).toContain('email String @unique');
  expect(merged).toContain('phone String @unique');
  expect(merged).toContain('role  String @default("USER")');
  expect(merged).toContain('@@index([email])');
  expect(merged).toContain('@@index([phone])');

  // Should contain Post from template
  expect(merged).toContain('model Post {');

  // Generator/datasource should keep the existing one
  expect(merged).toContain('provider = "sqlite"');
  expect(merged).not.toContain('provider = "postgres"');
});

test('mergePrismaSchemas merges enum values', () => {
  const existing = `
enum Role {
  USER
}
`;

  const template = `
enum Role {
  ADMIN
  MODERATOR
}
`;

  const merged = mergePrismaSchemas(existing, template);
  expect(merged).toContain('enum Role {');
  expect(merged).toContain('USER');
  expect(merged).toContain('ADMIN');
  expect(merged).toContain('MODERATOR');
});
