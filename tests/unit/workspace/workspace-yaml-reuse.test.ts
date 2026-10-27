import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { withTempWorkspace } from '../../testkit/workspace.ts';
import path from 'node:path';
import { YamlInputLimitError, YamlSyntaxError } from '../../../src/adapters/formats/yaml.ts';
import { PhysicalNoFollowError } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { readYaml, writeYaml } from '../../../src/adapters/workspace/yaml.ts';

// Real YAML and ordinary filesystem semantics are required. No JSON-parser,
// serializer or physical-write substitutes may establish these results.
async function using(run: (root: string, file: string) => Promise<void>) {
  await withTempWorkspace(root => run(root, path.join(root, 'value.yaml')), 'sec-workspace-yaml-');
}

test('ordinary YAML collections, aliases and empty documents retain their decoded meaning', () => using(async (_root, file) => {
  await fs.writeFile(file, 'first: &x [a, b]\nsecond: *x\n');
  assert.deepEqual(await readYaml(file), { first: ['a', 'b'], second: ['a', 'b'] });
  await fs.writeFile(file, ''); assert.equal(await readYaml(file), null);
  await fs.writeFile(file, '[true, 7, null]\n'); assert.deepEqual(await readYaml(file), [true, 7, null]);
}));

test('invalid UTF-8 cannot be repaired into a different parsed value', () => using(async (_root, file) => {
  await fs.writeFile(file, Uint8Array.of(0x61, 0x3a, 0x20, 0xff));
  await assert.rejects(readYaml(file), error => error instanceof Error
    && /\bUTF-8\b/u.test(error.message) && error.cause instanceof TypeError);
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

test('ordinary YAML writes preserve values through the retained file reader', () => using(async (_root, file) => {
  const value = { name: 'example', values: ['one', 'two'], nested: { enabled: true } };
  await writeYaml(file, value);
  assert.deepEqual(await readYaml(file), value);
}));

test('a rejected commit fence never produces a successful YAML write', () => using(async (_root, file) => {
  const fence = new Error('fence');
  await assert.rejects(writeYaml(file, { valid: true }, () => { throw fence; }), e => e === fence);
}));

test('missing input is still an IO error rather than an empty YAML value', () => using(async (_root, file) => {
  await assert.rejects(readYaml(file), e => (e as { code?: string }).code === 'ENOENT');
}));


test.skipIf(process.platform === 'win32')(
  'linked input cannot redirect the retained YAML read',
  () => using(async (root, file) => {
    const outside = path.join(root, 'outside.yaml');
    await fs.writeFile(outside, 'escaped: true\n');
    await fs.symlink(outside, file, 'file');
    await assert.rejects(readYaml(file), error => error instanceof PhysicalNoFollowError
      && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
  })
);
