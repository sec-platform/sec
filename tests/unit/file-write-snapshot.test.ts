import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureDir, formatJsonFile, prepareOrdinaryFileWrite, removeDir, writeBuffer, writeJson, writeText } from '../../src/workspace/runtime/files.ts';

async function fixture(run: (root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-write-snapshot-'));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('ordinary buffer writes detach bytes before the first filesystem suspension', async () => fixture(async root => {
  const target = path.join(root, 'nested/value.bin'), bytes = Buffer.from('original');
  const pending = writeBuffer(target, bytes, async () => { bytes.fill(0); });
  bytes.fill(1); await pending;
  assert.equal(readFileSync(target, 'utf8'), 'original');
}));

test('the captured view ignores shadowed offsets, buffers, lengths and iterators', async () => fixture(async root => {
  const bytes = new Uint8Array([0, 1, 2, 3]).subarray(1, 3);
  for (const key of ['length', 'buffer', 'byteOffset', 'byteLength', Symbol.iterator]) {
    Object.defineProperty(bytes, key, { get() { assert.fail('shadowed byte property'); } });
  }
  const target = path.join(root, 'value.bin'); await writeBuffer(target, bytes);
  assert.deepEqual([...readFileSync(target)], [1, 2]);
}));

test('transferring the caller buffer after invocation cannot detach the pending write', async () => fixture(async root => {
  const bytes = new Uint8Array([1, 2, 3]); const target = path.join(root, 'value.bin');
  const pending = writeBuffer(target, bytes);
  structuredClone(bytes, { transfer: [bytes.buffer] });
  await pending; assert.deepEqual([...readFileSync(target)], [1, 2, 3]);
}));

test('shared memory is refused before any directory or file effect', async () => fixture(async root => {
  const directory = path.join(root, 'absent'); let calls = 0;
  await assert.rejects(writeBuffer(path.join(directory, 'value'), new Uint8Array(new SharedArrayBuffer(1)), async () => { calls++; }), /shared memory/);
  assert.equal(calls, 0); assert.equal(existsSync(directory), false);
}));

test('non-byte views are rejected before requesting a write grant', async () => fixture(async root => {
  await assert.rejects(writeBuffer(path.join(root, 'value'), new Uint16Array([1]) as never, async () => assert.fail('invalid buffer effect')), TypeError);
  assert.equal(existsSync(path.join(root, 'value')), false);
}));

test('buffer writes keep the original working directory across the fence', async () => fixture(async root => {
  const before = process.cwd(), other = path.join(root, 'other'); mkdirSync(other);
  try {
    process.chdir(root); await writeBuffer('value.bin', Buffer.from('fixed'), async () => { process.chdir(other); });
    assert.equal(readFileSync(path.join(root, 'value.bin'), 'utf8'), 'fixed');
    assert.equal(existsSync(path.join(other, 'value.bin')), false);
  } finally { process.chdir(before); }
}));

test('directory creation captures a relative destination before its fence', async () => fixture(async root => {
  const before = process.cwd(), other = path.join(root, 'other'); mkdirSync(other);
  try {
    process.chdir(root); await ensureDir('created', async () => { process.chdir(other); });
    assert.ok(existsSync(path.join(root, 'created'))); assert.equal(existsSync(path.join(other, 'created')), false);
  } finally { process.chdir(before); }
}));

test('hard-link detachment cannot unlink another directory after a fence changes cwd', async () => fixture(async root => {
  const before = process.cwd(), other = path.join(root, 'other'); mkdirSync(other);
  writeFileSync(path.join(root, 'source'), 'owned'); linkSync(path.join(root, 'source'), path.join(root, 'target'));
  writeFileSync(path.join(other, 'target'), 'unrelated');
  try {
    process.chdir(root); await prepareOrdinaryFileWrite('target', async () => { process.chdir(other); });
    assert.equal(existsSync(path.join(root, 'target')), false);
    assert.equal(readFileSync(path.join(other, 'target'), 'utf8'), 'unrelated');
    assert.equal(readFileSync(path.join(root, 'source'), 'utf8'), 'owned');
  } finally { process.chdir(before); }
}));

test('directory removal keeps its initial target and does not delete a same-named sibling', async () => fixture(async root => {
  const before = process.cwd(), other = path.join(root, 'other'); mkdirSync(other);
  mkdirSync(path.join(root, 'target')); mkdirSync(path.join(other, 'target'));
  try {
    process.chdir(root); await removeDir('target', async () => { process.chdir(other); });
    assert.equal(existsSync(path.join(root, 'target')), false); assert.ok(existsSync(path.join(other, 'target')));
  } finally { process.chdir(before); }
}));

test('JSON conversion cannot redirect its target through a toJSON cwd change', async () => fixture(async root => {
  const before = process.cwd(), other = path.join(root, 'other'); mkdirSync(other);
  try {
    process.chdir(root); await writeJson('value.json', { toJSON() { process.chdir(other); return { value: 7 }; } });
    assert.equal(readFileSync(path.join(root, 'value.json'), 'utf8'), '{\n  "value": 7\n}\n');
    assert.equal(existsSync(path.join(other, 'value.json')), false);
  } finally { process.chdir(before); }
}));

for (const [label, value] of [['undefined', undefined], ['function', () => 7], ['symbol', Symbol('value')], ['empty conversion', { toJSON() { return undefined; } }]] as const) {
  test(`JSON file output refuses ${label} instead of writing a non-JSON document`, async () => fixture(async root => {
    assert.throws(() => formatJsonFile(value), /must contain one JSON value/);
    const target = path.join(root, 'absent/value.json');
    await assert.rejects(writeJson(target, value, async () => assert.fail('invalid JSON effect')), /must contain one JSON value/);
    assert.equal(existsSync(path.dirname(target)), false);
  }));
}

test('native serialization failures stay exact and have no file effects', async () => fixture(async root => {
  const reason = Object.freeze({ conversion: 'failed' });
  await assert.rejects(writeJson(path.join(root, 'value'), { toJSON() { throw reason; } }), error => error === reason);
  await assert.rejects(writeJson(path.join(root, 'value'), 1n), TypeError);
  const circular: { self?: unknown } = {}; circular.self = circular;
  await assert.rejects(writeJson(path.join(root, 'value'), circular), TypeError);
  assert.equal(existsSync(path.join(root, 'value')), false);
}));

test('ordinary JSON bytes retain native field order, spacing and final newline', () => {
  for (const value of [null, false, 0, '', { b: 2, a: 1, absent: undefined }, [1, undefined, null], { '__proto__': null }]) {
    assert.equal(formatJsonFile(value), JSON.stringify(value, null, 2) + '\n');
  }
});

test('a rejected fence cannot write its captured bytes and its original reason survives', async () => fixture(async root => {
  const target = path.join(root, 'value'); writeFileSync(target, 'before');
  for (const reason of [undefined, null, false, 0, new Error('rejected')]) {
    await assert.rejects(writeBuffer(target, Buffer.from('after'), async () => { throw reason; }), error => error === reason);
    assert.equal(readFileSync(target, 'utf8'), 'before');
  }
}));

test('invalid callbacks and non-text writes fail before side effects', async () => fixture(async root => {
  const target = path.join(root, 'absent/value');
  await assert.rejects(writeBuffer(target, Buffer.from('x'), 'bad' as never), TypeError);
  await assert.rejects(writeText(target, { toString() { assert.fail('coercion'); } } as never), TypeError);
  assert.equal(existsSync(path.dirname(target)), false);
}));
