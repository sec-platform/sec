import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { YamlInputLimitError, YamlSyntaxError } from '../../src/adapters/formats/yaml.ts';
import { readYaml, WORKSPACE_YAML_MAX_INPUT_BYTES, writeYaml } from '../../src/workspace/yaml.ts';

// Real YAML and ordinary filesystem semantics are required. No JSON-parser,
// serializer or physical-write substitutes may establish these results.
async function using(run: (root: string, file: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-workspace-yaml-'));
  try { await run(root, path.join(root, 'value.yaml')); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('ordinary YAML collections, aliases and empty documents retain their decoded meaning', () => using(async (_root, file) => {
  await fs.writeFile(file, 'first: &x [a, b]\nsecond: *x\n');
  assert.deepEqual(await readYaml(file), { first: ['a', 'b'], second: ['a', 'b'] });
  await fs.writeFile(file, ''); assert.equal(await readYaml(file), null);
  await fs.writeFile(file, '[true, 7, null]\n'); assert.deepEqual(await readYaml(file), [true, 7, null]);
}));

for (const source of ['name: a\nname: b\n', 'name: !unknown value\n', 'name: a\n---\nname: b\n']) {
  test(`generic reads consume strict YAML rather than another permissive entry: ${JSON.stringify(source)}`, () => using(async (_root, file) => {
    await fs.writeFile(file, source);
    await assert.rejects(readYaml(file), YamlSyntaxError);
  }));
}

test('invalid UTF-8 cannot be repaired into a different parsed value', () => using(async (_root, file) => {
  await fs.writeFile(file, Uint8Array.of(0x61, 0x3a, 0x20, 0xff));
  await assert.rejects(readYaml(file));
}));

test('explicit per-consumer byte and alias limits replace neither schemas nor permissions', () => using(async (_root, file) => {
  await fs.writeFile(file, 'x: 好');
  assert.deepEqual(await readYaml(file, { maximumInputBytes: 6 }), { x: '好' });
  await assert.rejects(readYaml(file, { maximumInputBytes: 5 }), YamlInputLimitError);
  await fs.writeFile(file, 'a: &x [one]\nb: *x\n');
  await assert.rejects(readYaml(file, { maximumAliasCount: 0 }), YamlSyntaxError);
  await fs.writeFile(file, '? [a, b]\n: value\n');
  await assert.rejects(readYaml(file, { stringKeys: true }), YamlSyntaxError);
}));

test('later edits to read options cannot widen an already captured admission', () => using(async (_root, file) => {
  await fs.writeFile(file, 'x: 好');
  const options = { maximumInputBytes: 5 };
  const pending = readYaml(file, options); options.maximumInputBytes = 1000;
  await assert.rejects(pending, YamlInputLimitError);
}));

test('generic default capacity is explicit and the caller can select a different domain limit', () => using(async (_root, file) => {
  const text = `x: ${'a'.repeat(WORKSPACE_YAML_MAX_INPUT_BYTES)}`;
  await fs.writeFile(file, text);
  await assert.rejects(readYaml(file), YamlInputLimitError);
  assert.deepEqual(await readYaml(file, { maximumInputBytes: text.length }), { x: 'a'.repeat(WORKSPACE_YAML_MAX_INPUT_BYTES) });
}));

test('write formatting stays with the existing YAML library and ordinary file owner', () => using(async (_root, file) => {
  const value = { name: 'example', values: ['one', 'two'], nested: { enabled: true } };
  await writeYaml(file, value);
  assert.equal(await fs.readFile(file, 'utf8'), YAML.stringify(value, { indent: 2 }));
  assert.deepEqual(await readYaml(file), value);
}));

test('serialization callbacks cannot retarget a relative write by changing cwd', () => using(async (root, file) => {
  const cwd = process.cwd();
  await fs.mkdir(path.join(root, 'other'));
  try {
    process.chdir(root);
    let conversions = 0;
    await writeYaml('value.yaml', { toJSON() { conversions++; process.chdir(path.join(root, 'other')); return { written: true }; } });
    assert.ok(conversions >= 1); assert.deepEqual(await readYaml(file), { written: true });
    await assert.rejects(fs.stat(path.join(root, 'other', 'value.yaml')), e => (e as { code?: string }).code === 'ENOENT');
  } finally { process.chdir(cwd); }
}));

test('serializer and fence failures preserve their causes and never produce a success result', () => using(async (_root, file) => {
  const conversion = Object.freeze({ conversion: 'failed' }), fence = new Error('fence');
  await assert.rejects(writeYaml(file, { toJSON() { throw conversion; } }), e => e === conversion);
  await assert.rejects(writeYaml(file, { valid: true }, () => { throw fence; }), e => e === fence);
  await assert.rejects(writeYaml(file, { toJSON() { assert.fail('conversion after invalid callback'); } }, null as never), TypeError);
}));

test('missing input is still an IO error rather than an empty YAML value', () => using(async (_root, file) => {
  await assert.rejects(readYaml(file), e => (e as { code?: string }).code === 'ENOENT');
}));
