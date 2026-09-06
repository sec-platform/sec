import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import { materializePrismaSource, mergePrismaTemplate } from '../../src/compiler/compose/merge-prisma-template.ts';
import { InstallStrategyRegistry } from '../../src/compiler/compose/install-strategies.ts';
import { getWorkspacePaths } from '../../src/workspace/runtime/paths.ts';
import type { InstallPlanStep } from '../../src/compiler/contract.ts';

const schema = (name: string, fields = '  id Int @id') => `model ${name} {\n${fields}\n}\n`;
async function fixture(run: (f: { root: string; source: string; target: string }) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-prisma-materialization-'));
  const source = path.join(root, 'registry', 'model.prisma'), target = path.join(root, 'prisma', 'schema.prisma');
  mkdirSync(path.dirname(source)); mkdirSync(path.dirname(target));
  try { await run({ root, source, target }); } finally { rmSync(root, { recursive: true, force: true }); }
}
const input = (f: { root: string; source: string; target: string }) => ({
  workspaceRoot: f.root, sourcePath: f.source, targetPath: f.target, sourceRequired: true
});

test('source-bound schema materialization creates, merges and becomes a no-op', async () => fixture(async f => {
  writeFileSync(f.source, schema('Record'));
  await materializePrismaSource(input(f));
  assert.equal(readFileSync(f.target, 'utf8'), schema('Record'));
  writeFileSync(f.source, schema('Record', '  name String'));
  await materializePrismaSource(input(f));
  const merged = readFileSync(f.target, 'utf8');
  assert.ok(merged.includes('id Int')); assert.ok(merged.includes('name String'));
  await materializePrismaSource(input(f));
  assert.equal(readFileSync(f.target, 'utf8'), merged);
}));

test('a changed target is not overwritten after a commit fence', async () => fixture(async f => {
  writeFileSync(f.source, schema('B')); writeFileSync(f.target, schema('A'));
  const user = schema('User');
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: () => { writeFileSync(f.target, user); } }), /preimage/);
  assert.equal(readFileSync(f.target, 'utf8'), user);
}));

test('a missing target that another writer creates is never overwritten', async () => fixture(async f => {
  writeFileSync(f.source, schema('A'));
  const user = schema('User');
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: () => { writeFileSync(f.target, user); } }));
  assert.equal(readFileSync(f.target, 'utf8'), user);
}));

test('equal-byte creation by another writer remains a valid idempotent publication', async () => fixture(async f => {
  writeFileSync(f.source, schema('A'));
  await materializePrismaSource({ ...input(f), commitFence: () => { writeFileSync(f.target, schema('A')); } });
  assert.equal(readFileSync(f.target, 'utf8'), schema('A'));
}));

test('changed source bytes invalidate an otherwise valid target publication', async () => fixture(async f => {
  writeFileSync(f.source, schema('B')); writeFileSync(f.target, schema('A'));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: () => { writeFileSync(f.source, schema('C')); } }), /source changed/);
  assert.equal(readFileSync(f.target, 'utf8'), schema('A'));
}));

test('no-op merge still checks the target after the final fence', async () => fixture(async f => {
  writeFileSync(f.source, schema('A')); writeFileSync(f.target, schema('A'));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: () => { writeFileSync(f.target, schema('User')); } }), /no-op completion/);
  assert.equal(readFileSync(f.target, 'utf8'), schema('User'));
}));

test('missing optional source is rechecked after the fence rather than silently changing the plan', async () => fixture(async f => {
  await assert.rejects(materializePrismaSource({ ...input(f), sourceRequired: false,
    commitFence: () => { writeFileSync(f.source, schema('Appeared')); } }), /source changed/);
  assert.equal(existsSync(f.target), false);
}));

test('required source absence rejects before any fence or target creation', async () => fixture(async f => {
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: () => assert.fail('effect after missing source') }), /missing/);
  assert.equal(existsSync(f.target), false);
}));

test('source disappearance is not interpreted as permission to publish stale bytes', async () => fixture(async f => {
  writeFileSync(f.source, schema('B')); writeFileSync(f.target, schema('A'));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: () => { rmSync(f.source, { force: true }); } }), /source changed/);
  assert.equal(readFileSync(f.target, 'utf8'), schema('A'));
}));

for (const owner of ['source', 'target'] as const) test(`invalid UTF-8 ${owner} is rejected before effects`, async () => fixture(async f => {
  writeFileSync(f.source, schema('A')); writeFileSync(f.target, schema('B'));
  writeFileSync(f[owner], Buffer.from([0xff]));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: () => assert.fail('effect before decoding') }));
}));

test('schema conflict is rejected before any publication fence', async () => fixture(async f => {
  writeFileSync(f.source, schema('A', ' id String')); writeFileSync(f.target, schema('A', ' id Int'));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: () => assert.fail('effect before semantic admission') }), /conflicts/);
  assert.equal(readFileSync(f.target, 'utf8'), schema('A', ' id Int'));
}));

test('relative root and paths remain fixed when a fence changes cwd', async () => fixture(async f => {
  const old = process.cwd(); writeFileSync(f.source, schema('A'));
  try {
    process.chdir(f.root);
    await materializePrismaSource({ workspaceRoot: '.', sourcePath: 'registry/model.prisma', targetPath: 'prisma/schema.prisma', sourceRequired: true,
      commitFence: () => { process.chdir(tmpdir()); } });
    assert.equal(readFileSync(f.target, 'utf8'), schema('A'));
  } finally { process.chdir(old); }
}));

test('the real optional model-template entry uses the same merge and conditional publisher', async () => fixture(async f => {
  const template = path.join(getWorkspacePaths(f.root).modelRoot, 'schema', 'db.prisma.template');
  mkdirSync(path.dirname(template), { recursive: true }); writeFileSync(template, schema('B')); writeFileSync(f.target, schema('A'));
  await mergePrismaTemplate(f.root);
  const merged = readFileSync(f.target, 'utf8'); assert.ok(merged.includes('model A')); assert.ok(merged.includes('model B'));
}));

test('actual merge-prisma strategy shares model identity instead of appending duplicate blocks', async () => fixture(async f => {
  writeFileSync(f.source, schema('Record', ' name String')); writeFileSync(f.target, schema('Record', ' id Int'));
  const step = { stepId: 'merge', blockId: 'test/one', registrySourceId: 'test', registryKind: 'private', registryLocation: 'workspace',
    registryPath: '.', sourceRoot: 'registry', action: 'merge-prisma', from: 'model.prisma', to: 'prisma/schema.prisma' } as InstallPlanStep;
  await new InstallStrategyRegistry().executeAll([step], { workspaceRoot: f.root, lock: {} as never });
  const merged = readFileSync(f.target, 'utf8');
  assert.equal(merged.match(/model Record/g)?.length, 1); assert.ok(merged.includes('id Int')); assert.ok(merged.includes('name String'));
}));
