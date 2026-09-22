import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { formatJson } from '../../src/entry/cli/format-utils.ts';
import { stringifyJsonValue } from '../../src/contracts/json-text.ts';
import { formatJsonFile } from "../../src/contracts/json-text.ts";

for (const value of [undefined, () => 1, Symbol('value'), { toJSON() { return undefined; } }]) {
  test('CLI and file output reject missing root values through the same standard-JSON boundary', () => {
    assert.throws(() => stringifyJsonValue(value, 2), /JSON output must contain one JSON value/);
    assert.throws(() => formatJsonFile(value), /JSON file must contain one JSON value/);
    assert.throws(() => formatJson(value, { compact: true }), /CLI JSON output must contain one JSON value/);
  });
}

test('the shared writer retains each consumer representation without becoming a canonicalizer', () => {
  const value = { b: 2, a: ['x', undefined, 3], ignored: undefined };
  assert.equal(formatJson(value, { compact: false }), JSON.stringify(value, null, 2));
  assert.equal(formatJson(value, { compact: true }), JSON.stringify(value));
  assert.equal(formatJsonFile(value), formatJson(value, { compact: false }) + '\n');
});

test('native serialization errors and user-thrown values are not wrapped or hidden', () => {
  const reason = Object.freeze({ conversion: 'failed' }), value = { toJSON() { throw reason; } };
  for (const write of [(input: unknown) => stringifyJsonValue(input, 2), formatJsonFile, (input: unknown) => formatJson(input, { compact: false })]) {
    assert.throws(() => write(value), error => error === reason);
    assert.throws(() => write(1n), TypeError);
  }
});
