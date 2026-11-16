import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { format } from 'node:util';
import { formatJsonFile, stringifyJsonValue } from '../../../src/contracts/json-text.ts';
import { formatJson, printJsonOrText } from '../../../src/entry/cli/format-utils.ts';

test.serial('shared writer, standard JSON values and text selection keep their distinct output contracts', () => {
  const value = { b: 2, a: ['x', undefined, 3], ignored: undefined };
  assert.equal(formatJsonFile(value), JSON.stringify(value, null, 2) + '\n');
  const log = console.log, lines: string[] = [];
  console.log = (...args) => { lines.push(format(...args)); };
  try {
    printJsonOrText(undefined, { json: false, compact: false }, () => 'text');
    assert.deepEqual(lines, ['text']);
    for (const compact of [false, true]) {
      lines.length = 0;
      printJsonOrText(value, { json: true, compact }, () => assert.fail('text renderer invoked'));
      assert.deepEqual(lines, [JSON.stringify(value, null, compact ? 0 : 2)]);
    }
  } finally { console.log = log; }
});

test.serial('root validation and native failures cannot become successful output frames', () => {
  for (const value of [undefined, { toJSON() { return undefined; } }]) {
    assert.throws(() => stringifyJsonValue(value, 2), /JSON output must contain one JSON value/);
  }
  assert.throws(() => formatJsonFile(undefined), /JSON file must contain one JSON value/);
  assert.throws(() => formatJson(undefined, { compact: true }), /CLI JSON output must contain one JSON value/);

  const reason = Object.freeze({ conversion: 'failed' }), value = { toJSON() { throw reason; } };
  assert.throws(() => stringifyJsonValue(value, 2), error => error === reason);

  // CLI emission is a separate effect: invalid JSON must not write even one frame.
  const log = console.log;
  let writes = 0;
  console.log = () => { writes++; };
  try {
    assert.throws(
      () => printJsonOrText({ toJSON() { return undefined; } }, { json: true, compact: true }, () => assert.fail('text renderer invoked')),
      TypeError
    );
    assert.equal(writes, 0);
  } finally { console.log = log; }
});
