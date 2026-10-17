import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { format } from 'node:util';
import { formatJsonFile, stringifyJsonValue } from '../../src/contracts/json-text.ts';
import { formatJson, printJsonOrText } from '../../src/entry/cli/format-utils.ts';

for (const value of [undefined, () => 1, Symbol('value'), { toJSON() { return undefined; } }]) {
  test('CLI and file output reject missing root values through the same standard-JSON boundary', () => {
    assert.throws(() => stringifyJsonValue(value, 2), /JSON output must contain one JSON value/);
    assert.throws(() => formatJsonFile(value), /JSON file must contain one JSON value/);
    assert.throws(() => formatJson(value, { compact: true }), /CLI JSON output must contain one JSON value/);
  });
}

test.serial('shared writer, standard JSON values and text selection keep their distinct output contracts', () => {
  const value = { b: 2, a: ['x', undefined, 3], ignored: undefined };
  assert.equal(formatJson(value, { compact: false }), JSON.stringify(value, null, 2));
  assert.equal(formatJson(value, { compact: true }), JSON.stringify(value));
  assert.equal(formatJsonFile(value), JSON.stringify(value, null, 2) + '\n');
  for (const input of [null, false, 0, '', { b: 2, a: 1, absent: undefined }, [1, undefined, null], { '__proto__': null }]) {
    assert.equal(formatJsonFile(input), JSON.stringify(input, null, 2) + '\n');
  }
  for (const input of [null, false, 0, 'text', [], { a: 1, b: [2] }]) {
    for (const compact of [false, true]) {
      assert.equal(formatJson(input, { compact }), JSON.stringify(input, null, compact ? 0 : 2));
    }
  }
  const log = console.log, lines: string[] = [];
  console.log = (...args) => { lines.push(format(...args)); };
  try {
    printJsonOrText(undefined, { json: false, compact: false }, () => 'text');
    assert.deepEqual(lines, ['text']);
    for (const compact of [false, true]) {
      lines.length = 0;
      printJsonOrText(value, { json: true, compact }, () => assert.fail('text renderer invoked'));
      assert.deepEqual(JSON.parse(lines.join('\n')), { b: 2, a: ['x', null, 3] });
    }
  } finally { console.log = log; }
});

test.serial('native errors, cycles and invalid JSON roots cannot become successful output frames', () => {
  const reason = Object.freeze({ conversion: 'failed' }), value = { toJSON() { throw reason; } };
  const cycle: unknown[] = []; cycle.push(cycle);
  for (const write of [(input: unknown) => stringifyJsonValue(input, 2), formatJsonFile, (input: unknown) => formatJson(input, { compact: false })]) {
    assert.throws(() => write(value), error => error === reason);
    assert.throws(() => write(1n), TypeError);
    assert.throws(() => write(cycle), TypeError);
  }

  // CLI emission is a separate effect: invalid JSON must not write even one frame.
  const log = console.log;
  let writes = 0;
  console.log = () => { writes++; };
  try {
    for (const invalid of [undefined, () => 7, Symbol('value'), { toJSON() { return undefined; } }]) {
      assert.throws(
        () => printJsonOrText(invalid, { json: true, compact: true }, () => assert.fail('text renderer invoked')),
        TypeError
      );
    }
    assert.equal(writes, 0);
  } finally { console.log = log; }
});
