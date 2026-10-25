import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultInstallRegistry } from '../../../src/adapters/compilation/compose/install-strategies.ts';
import { materializePrismaSource, mergePrismaTemplate } from '../../../src/adapters/compilation/compose/merge-prisma-template.ts';
import { getWorkspacePaths } from "../../../src/adapters/workspace-context.ts";
import type { InstallPlanStep } from '../../../src/compiler/contract.ts';

const schema = (name: string, fields = '  id Int @id') => `model ${name} {\n${fields}\n}\n`;
async function fixture(run: (f: { root: string; source: string; target: string }) => Promise<void>, createTargetParent = true) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-prisma-materialization-'));
  const source = path.join(root, 'registry', 'model.prisma'), target = path.join(root, 'prisma', 'schema.prisma');
  mkdirSync(path.dirname(source));
  if (createTargetParent) mkdirSync(path.dirname(target));
  try { await run({ root, source, target }); } finally { rmSync(root, { recursive: true, force: true }); }
}
const input = (f: { root: string; source: string; target: string }) => ({
  workspaceRoot: f.root, sourcePath: f.source, targetPath: f.target, sourceRequired: true
});

test('a changed target is not overwritten after a commit fence', async () => fixture(async f => {
  writeFileSync(f.source, schema('B')); writeFileSync(f.target, schema('A'));
  const user = schema('User');
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: async () => { writeFileSync(f.target, user); } }), /preimage/);
  assert.equal(readFileSync(f.target, 'utf8'), user);
}));

test('a missing target that another writer creates is never overwritten', async () => fixture(async f => {
  writeFileSync(f.source, schema('A'));
  const user = schema('User');
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: async () => { writeFileSync(f.target, user); } }));
  assert.equal(readFileSync(f.target, 'utf8'), user);
}));

test('equal-byte creation by another writer remains a valid idempotent publication', async () => fixture(async f => {
  writeFileSync(f.source, schema('A'));
  await materializePrismaSource({ ...input(f), commitFence: async () => { writeFileSync(f.target, schema('A')); } });
  assert.equal(readFileSync(f.target, 'utf8'), schema('A'));
}));

test('changed source bytes invalidate an otherwise valid target publication', async () => fixture(async f => {
  writeFileSync(f.source, schema('B')); writeFileSync(f.target, schema('A'));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: async () => { writeFileSync(f.source, schema('C')); } }), { code: 'COMPOSE-PRISMA-003' });
  assert.equal(readFileSync(f.target, 'utf8'), schema('A'));
}));

test('no-op merge still checks the target after the final fence', async () => fixture(async f => {
  writeFileSync(f.source, schema('A')); writeFileSync(f.target, schema('A'));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: async () => { writeFileSync(f.target, schema('User')); } }), { code: 'COMPOSE-PRISMA-003' });
  assert.equal(readFileSync(f.target, 'utf8'), schema('User'));
}));

test('missing optional source is rechecked after the fence rather than silently changing the plan', async () => fixture(async f => {
  await assert.rejects(materializePrismaSource({ ...input(f), sourceRequired: false,
    commitFence: async () => { writeFileSync(f.source, schema('Appeared')); } }), { code: 'COMPOSE-PRISMA-003' });
  assert.equal(existsSync(f.target), false);
}));

test('required source absence rejects before any fence or target creation', async () => fixture(async f => {
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: async () => assert.fail('effect after missing source') }), { code: 'COMPOSE-PATH-003' });
  assert.equal(existsSync(f.target), false);
}));

test('source disappearance is not interpreted as permission to publish stale bytes', async () => fixture(async f => {
  writeFileSync(f.source, schema('B')); writeFileSync(f.target, schema('A'));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: async () => { rmSync(f.source, { force: true }); } }), { code: 'COMPOSE-PRISMA-003' });
  assert.equal(readFileSync(f.target, 'utf8'), schema('A'));
}));

for (const owner of ['source', 'target'] as const) test(`invalid UTF-8 ${owner} is rejected before effects`, async () => fixture(async f => {
  writeFileSync(f.source, schema('A')); writeFileSync(f.target, schema('B'));
  writeFileSync(f[owner], Buffer.from([0xff]));
  let fenceEntered = false;
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: async () => {
    fenceEntered = true;
    assert.fail('effect before decoding');
  } }));
  assert.equal(fenceEntered, false);
}));

test('schema conflict is rejected before any publication fence', async () => fixture(async f => {
  writeFileSync(f.source, schema('A', ' id String')); writeFileSync(f.target, schema('A', ' id Int'));
  await assert.rejects(materializePrismaSource({ ...input(f), commitFence: async () => assert.fail('effect before semantic admission') }), /conflicts/);
  assert.equal(readFileSync(f.target, 'utf8'), schema('A', ' id Int'));
}));

test('the real optional model-template entry uses the same merge and conditional publisher', async () => fixture(async f => {
  const template = path.join(getWorkspacePaths(f.root).modelRoot, 'schema', 'db.prisma.template');
  mkdirSync(path.dirname(template), { recursive: true }); writeFileSync(template, schema('B')); writeFileSync(f.target, schema('A'));
  await mergePrismaTemplate(f.root);
  const merged = readFileSync(f.target, 'utf8'); assert.ok(merged.includes('model A')); assert.ok(merged.includes('model B'));
}));

test('actual merge-prisma strategy serializes shared targets, merges model identity and remains idempotent', async () => fixture(async f => {
  writeFileSync(f.source, schema('Record', ' id Int\n name String') + '\n' + schema('Alpha'));
  writeFileSync(path.join(path.dirname(f.source), 'second.prisma'), schema('Record', ' email String') + '\n' + schema('Beta'));
  const step = { stepId: 'first', blockId: 'test/one', registrySourceId: 'test', registryKind: 'private', registryLocation: 'workspace',
    registryPath: '.', sourceRoot: 'registry', action: 'merge-prisma', from: 'model.prisma', to: 'prisma/schema.prisma' } as InstallPlanStep;
  const steps = [step, { ...step, stepId: 'second', blockId: 'test/two', from: 'second.prisma' }];
  const context = { workspaceRoot: f.root, lock: {} as never };
  assert.equal(existsSync(path.dirname(f.target)), false);
  assert.equal(existsSync(f.target), false);
  await defaultInstallRegistry.executeAll(steps, context);
  const expected = schema('Record', ' id Int\n name String\n email String') + '\n' + schema('Alpha') + '\n' + schema('Beta');
  assert.equal(readFileSync(f.target, 'utf8'), expected);
  await defaultInstallRegistry.executeAll(steps, context);
  assert.equal(readFileSync(f.target, 'utf8'), expected);
}, false));
