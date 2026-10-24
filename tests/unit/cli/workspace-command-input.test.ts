import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { registerWorkspaceCommands } from '../../../src/bootstrap/cli/register-workspace-commands.ts';
import {
  COMPOSE_LOCK_OPTION, WORKSPACE_DRY_RUN_OPTION,
  parseComposeCommandInput, parseRepairCommandInput, parseUpgradeCommandInput
} from '../../../src/entry/cli/workspace-command-input.ts';

const usage = (error: unknown) => (error as { code: string }).code === 'CLI-USAGE-001';

for (const value of [undefined, false, true]) {
  test(`write commands capture default and explicit boolean ${value}`, () => {
    assert.deepEqual(parseComposeCommandInput({ lock: value }), { lock: value ?? false });
    const repair = parseRepairCommandInput(undefined, { dryRun: value });
    const upgrade = parseUpgradeCommandInput('block', '1', { dryRun: value }, 'sec upgrade');
    assert.equal(repair.kind, 'execute'); assert.equal(upgrade.kind, 'execute');
    if (repair.kind === 'execute' && upgrade.kind === 'execute') {
      assert.deepEqual(repair.request, { dryRun: value ?? false });
      assert.deepEqual(upgrade.request, { dryRun: value ?? false });
      assert.ok(Object.isFrozen(repair.request)); assert.ok(Object.isFrozen(upgrade.request));
    }
  });
}

for (const mode of ['repair-plan', 'upgrade-plan', 'upgrade-diagnostics'] as const) {
  test(`${mode} does not read or retain write-only options`, () => {
    const options = new Proxy({ json: true, compact: false,
      get dryRun() { assert.fail('inspection read a write flag'); throw new Error('unreachable'); },
      get unrelated() { assert.fail('unrelated field inspected'); throw new Error('unreachable'); } }, {
      ownKeys() { assert.fail('options enumerated'); }
    });
    const input = mode === 'repair-plan' ? parseRepairCommandInput('plan', options)
      : parseUpgradeCommandInput(mode === 'upgrade-plan' ? 'plan' : 'diagnostics', undefined, options, 'sec upgrade');
    assert.equal('request' in input, false);
    assert.equal('subject' in input, false); assert.ok(Object.isFrozen(input));
    assert.deepEqual(input.output, { json: true, compact: false });
  });
}

test('command-specific flags preserve the own-enumerable input boundary', () => {
  const options = Object.create({ lock: true, dryRun: true });
  Object.defineProperty(options, 'lock', { value: true, enumerable: false });
  assert.deepEqual(parseComposeCommandInput(options), { lock: false });
  const input = parseRepairCommandInput(undefined, options);
  assert.equal(input.kind, 'execute');
  if (input.kind === 'execute') assert.equal(input.request.dryRun, false);
});

test('later changes to raw flags do not change captured request or presentation', () => {
  const raw = { json: true, compact: true, dryRun: false };
  const input = parseUpgradeCommandInput('block', '1', raw, 'sec upgrade');
  raw.json = false; raw.compact = false; raw.dryRun = true;
  assert.deepEqual(input.output, { json: true, compact: true });
  if (input.kind !== 'execute') assert.fail('wrong selected route');
  assert.equal(input.request.dryRun, false);
  assert.equal(Reflect.set(input.request, 'dryRun', true), false);
  const repairOptions = { json: true, compact: false, dryRun: true };
  const repair = parseRepairCommandInput(undefined, repairOptions);
  repairOptions.json = false; repairOptions.dryRun = false;
  assert.equal(repair.kind, 'execute');
  if (repair.kind === 'execute') {
    assert.deepEqual(repair.output, { json: true, compact: false });
    assert.equal(repair.request.dryRun, true);
  }
});

for (const subject of ['plan', 'diagnostics']) {
  test(`${subject} with an explicit target remains a block upgrade, not inspection`, () => {
    const input = parseUpgradeCommandInput(subject, '1', { dryRun: true }, 'sec upgrade');
    assert.equal(input.kind, 'execute');
    if (input.kind === 'execute') { assert.equal(input.subject, subject); assert.equal(input.targetVersion, '1'); }
  });
}

test('an upgrade without positional arguments is rejected before reading write options', () => {
  const input = { get dryRun() { assert.fail('invalid route read write flag'); throw new Error('unreachable'); } };
  assert.throws(() => parseUpgradeCommandInput(undefined, undefined, input, 'custom upgrade'),
    (error: unknown) => usage(error) && (error as Error).message.startsWith('Usage: custom upgrade '));
});

test('a missing upgrade target is rejected before reading write options', () => {
  const input = { get dryRun() { assert.fail('invalid route read write flag'); throw new Error('unreachable'); } };
  assert.throws(() => parseUpgradeCommandInput('block', undefined, input, 'sec upgrade'), usage);
});

test('field definitions are immutable and drive actual Commander registration', () => {
  const root = new Command().name('sec'); registerWorkspaceCommands(root);
  for (const [name, definition] of [['compose', COMPOSE_LOCK_OPTION], ['repair', WORKSPACE_DRY_RUN_OPTION], ['upgrade', WORKSPACE_DRY_RUN_OPTION]] as const) {
    assert.ok(Object.isFrozen(definition));
    const option = root.commands.find((command) => command.name() === name)?.options.find((option) => option.flags === definition.flags);
    assert.ok(option); assert.equal(option.attributeName(), definition.name);
    assert.equal(option.defaultValue, undefined); // Preserve native metadata, decoder owns the effective default.
  }
});
