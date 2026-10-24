import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureJsonOutputInput } from '../../../src/entry/cli/json-output-options.ts';
import { parseWorkspaceViewCommandInput } from '../../../src/entry/cli/workspace-command-input.ts';

test('mixed command output retains the old own-enumerable boundary without whole-object copying', () => {
  const inherited = Object.create({ json: true });
  Object.defineProperty(inherited, 'compact', { value: true });
  assert.deepEqual(parseWorkspaceViewCommandInput('lock', undefined, inherited).output, { json: false, compact: false });
  assert.equal(captureJsonOutputInput(inherited, 'property').json, true);
});

test('mixed read/write command routes retain selected output after caller mutation', () => {
  for (const [command, mode] of [['lock', 'inspect'], ['explain', 'graph']] as const) {
    const raw = { json: true, compact: true };
    const inspected = parseWorkspaceViewCommandInput(command, mode, raw);
    const executed = parseWorkspaceViewCommandInput(command, undefined, raw);
    raw.json = false; raw.compact = false;
    assert.equal(inspected.kind, 'inspect'); assert.equal(executed.kind, 'execute');
    for (const selection of [inspected, executed]) {
      assert.deepEqual(selection.output, { json: true, compact: true });
    }
  }
});

