import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseWorkspaceViewCommandInput } from '../../../src/entry/cli/workspace-command-input.ts';


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

