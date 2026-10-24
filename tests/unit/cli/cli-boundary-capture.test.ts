import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureJsonOutputInput } from '../../../src/entry/cli/json-output-options.ts';
import { captureCliOptions } from '../../../src/entry/cli/own-options.ts';
import { parseWorkspaceViewCommandInput } from '../../../src/entry/cli/workspace-command-input.ts';

test('selected accessors retain their receiver and become immutable captured data', () => {
  let reads = 0;
  const input = { actual: 7, get value() { reads++; assert.equal(this, input); return this.actual; } };
  const captured = captureCliOptions(input, [{ name: 'value', scope: 'property' }]);
  assert.equal(captured.value, 7);
  assert.equal(reads, 1);
  Object.defineProperty(input, 'value', { value: 99 });
  assert.equal(captured.value, 7); assert.ok(Object.isFrozen(captured));
  assert.equal(Reflect.set(captured, 'value', 8), false);
});

test('mixed command output retains the old own-enumerable boundary without whole-object copying', () => {
  const inherited = Object.create({ json: true });
  Object.defineProperty(inherited, 'compact', { value: true });
  assert.deepEqual(parseWorkspaceViewCommandInput('lock', undefined, inherited).output, { json: false, compact: false });
  assert.equal(captureJsonOutputInput(inherited, 'property').json, true);
});

test('mixed read/write command routes retain selected output after caller mutation', () => {
  for (const [command, mode] of [['lock', 'inspect'], ['explain', 'graph']] as const) {
    const raw = new Proxy({ json: true, compact: true, get unused() { assert.fail('unowned'); throw new Error('unreachable'); } }, { ownKeys() { assert.fail('enumerated'); } });
    const inspected = parseWorkspaceViewCommandInput(command, mode, raw);
    const executed = parseWorkspaceViewCommandInput(command, undefined, raw);
    raw.json = false; raw.compact = false;
    assert.equal(inspected.kind, 'inspect'); assert.equal(executed.kind, 'execute');
    for (const selection of [inspected, executed]) {
      assert.deepEqual(selection.output, { json: true, compact: true });
    }
  }
});

