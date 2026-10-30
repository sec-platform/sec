import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { registerWorkspaceCommands } from '../../../src/bootstrap/cli/register-workspace-commands.ts';
import {
  COMPOSE_LOCK_OPTION, WORKSPACE_DRY_RUN_OPTION,
  parseComposeCommandInput, parseRepairCommandInput, parseUpgradeCommandInput, parseWorkspaceViewCommandInput
} from '../../../src/entry/cli/workspace-command-input.ts';

for (const value of [undefined, true]) {
  test(`write commands capture default and explicit boolean ${value}`, () => {
    assert.deepEqual(parseComposeCommandInput({ lock: value }), { lock: value ?? false });
    const repair = parseRepairCommandInput(undefined, { dryRun: value });
    const upgrade = parseUpgradeCommandInput('block', '1', { dryRun: value }, 'sec upgrade');
    assert.equal(repair.kind, 'execute'); assert.equal(upgrade.kind, 'execute');
    if (repair.kind === 'execute' && upgrade.kind === 'execute') {
      assert.deepEqual(repair.request, { dryRun: value ?? false });
      assert.deepEqual(upgrade.request, { dryRun: value ?? false });
    }
  });
}

for (const mode of ['repair-plan', 'upgrade-plan', 'upgrade-diagnostics'] as const) {
  test(`${mode} selects inspection without retaining a write request`, () => {
    const options = { json: true, compact: false, dryRun: true };
    const input = mode === 'repair-plan' ? parseRepairCommandInput('plan', options)
      : parseUpgradeCommandInput(mode === 'upgrade-plan' ? 'plan' : 'diagnostics', undefined, options, 'sec upgrade');
    assert.equal(input.kind, mode === 'upgrade-diagnostics' ? 'diagnostics' : 'plan');
    assert.equal('request' in input, false);
    assert.equal('subject' in input, false);
    assert.deepEqual(input.output, { json: true, compact: false });
  });
}


test('later changes to raw flags do not change captured request or presentation', () => {
  const raw = { json: true, compact: true, dryRun: false };
  const input = parseUpgradeCommandInput('block', '1', raw, 'sec upgrade');
  raw.json = false; raw.compact = false; raw.dryRun = true;
  assert.deepEqual(input.output, { json: true, compact: true });
  if (input.kind !== 'execute') assert.fail('wrong selected route');
  assert.equal(input.request.dryRun, false);
  const repairOptions = { json: true, compact: false, dryRun: true };
  const repair = parseRepairCommandInput(undefined, repairOptions);
  repairOptions.json = false; repairOptions.dryRun = false;
  assert.equal(repair.kind, 'execute');
  if (repair.kind === 'execute') {
    assert.deepEqual(repair.output, { json: true, compact: false });
    assert.equal(repair.request.dryRun, true);
  }
  // The same captured-output rule applies to both read and write views of
  // Lock and Explain; the original input may change after selection.
  for (const [command, mode] of [['lock', 'inspect'], ['explain', 'graph']] as const) {
    const options = { json: true, compact: true };
    const inspected = parseWorkspaceViewCommandInput(command, mode, options);
    const executed = parseWorkspaceViewCommandInput(command, undefined, options);
    options.json = false; options.compact = false;
    assert.equal(inspected.kind, 'inspect');
    assert.equal(executed.kind, 'execute');
    for (const selection of [inspected, executed]) {
      assert.deepEqual(selection.output, { json: true, compact: true });
    }
  }
});

for (const subject of ['plan', 'diagnostics']) {
  test(`${subject} with an explicit target remains a block upgrade, not inspection`, () => {
    const input = parseUpgradeCommandInput(subject, '1', { dryRun: true }, 'sec upgrade');
    assert.equal(input.kind, 'execute');
    if (input.kind === 'execute') { assert.equal(input.subject, subject); assert.equal(input.targetVersion, '1'); }
  });
}

test('field definitions drive actual Commander registration', () => {
  const root = new Command().name('sec'); registerWorkspaceCommands(root);
  for (const [name, definition] of [['compose', COMPOSE_LOCK_OPTION], ['repair', WORKSPACE_DRY_RUN_OPTION], ['upgrade', WORKSPACE_DRY_RUN_OPTION]] as const) {
    const option = root.commands.find((command) => command.name() === name)?.options.find((option) => option.flags === definition.flags);
    assert.ok(option); assert.equal(option.attributeName(), definition.name);
  }
});
