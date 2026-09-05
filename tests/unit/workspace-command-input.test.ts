import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Command } from 'commander';

import { decodeBooleanFlag } from '../../src/interface/cli/boolean-option.ts';
import { jsonOpts } from '../../src/interface/cli/command-options.ts';
import { parsePipelineOutputOptions } from '../../src/interface/cli/pipeline-command-input.ts';
import { registerWorkspaceCommands } from '../../src/interface/cli/register-workspace-commands.ts';
import {
  COMPOSE_LOCK_OPTION, WORKSPACE_DRY_RUN_OPTION,
  parseComposeCommandInput, parseRepairCommandInput, parseUpgradeCommandInput
} from '../../src/interface/cli/workspace-command-input.ts';

const usage = (error: unknown) => (error as { code: string }).code === 'CLI-USAGE-001';
const denied = [null, 0, 1, '', 'false', 'true', [], {}, new Boolean(false), Symbol('flag'), 1n, () => false];

for (const value of [undefined, false, true]) {
  test(`one strict primitive supplies default and explicit boolean ${value}`, () => {
    const reject = () => { assert.fail('a boolean was rejected'); };
    assert.equal(decodeBooleanFlag(value, false, reject), value ?? false);
    assert.equal(decodeBooleanFlag(value, true, reject), value ?? true);
    assert.deepEqual(parseComposeCommandInput({ lock: value }), { lock: value ?? false });
    const repair = parseRepairCommandInput(undefined, { dryRun: value });
    const upgrade = parseUpgradeCommandInput('block', '1', { dryRun: value }, 'sec upgrade');
    assert.equal(repair.kind, 'execute'); assert.equal(upgrade.kind, 'execute');
    if (repair.kind === 'execute' && upgrade.kind === 'execute') {
      assert.deepEqual(repair.request, { dryRun: value ?? false });
      assert.deepEqual(upgrade.request, repair.request);
      assert.ok(Object.isFrozen(repair.request)); assert.ok(Object.isFrozen(upgrade.request));
    }
  });
}

for (const [index, value] of denied.entries()) {
  test(`non-boolean input ${index} is rejected in all selected flag decoders`, () => {
    assert.throws(() => parseComposeCommandInput({ lock: value }), usage);
    assert.throws(() => parseRepairCommandInput(undefined, { dryRun: value }), usage);
    assert.throws(() => parseUpgradeCommandInput('block', '1', { dryRun: value }, 'sec upgrade'), usage);
    assert.throws(() => jsonOpts({ json: value }), usage);
    assert.throws(() => parsePipelineOutputOptions({ json: value }),
      (error: unknown) => (error as { code: string }).code === 'PIPELINE-USAGE-003');
  });
}

test('decode rejection preserves the exact original thrown value without coercion', () => {
  const reason = Object.freeze({ owner: 'adapter' });
  const value = { toString() { assert.fail('toString called'); },
    valueOf() { assert.fail('valueOf called'); }, [Symbol.toPrimitive]() { assert.fail('coercion called'); } };
  assert.throws(() => decodeBooleanFlag(value, false, () => { throw reason; }), (error) => error === reason);
  assert.throws(() => parseComposeCommandInput({ lock: value }), usage);
});

for (const mode of ['repair-plan', 'upgrade-plan', 'upgrade-diagnostics'] as const) {
  test(`${mode} does not read or retain write-only options`, () => {
    const options = new Proxy({ json: true, compact: false,
      get dryRun() { assert.fail('inspection read a write flag'); },
      get unrelated() { assert.fail('unrelated field inspected'); } }, {
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

test('selected write flag is captured once and unrelated fields are not enumerated', () => {
  let reads = 0;
  const raw = new Proxy({ json: true, compact: false,
    get dryRun() { reads++; return true; },
    get unrelated() { assert.fail('unrelated field read'); } }, {
    ownKeys() { assert.fail('whole options enumerated'); }
  });
  const input = parseRepairCommandInput(undefined, raw);
  assert.equal(reads, 1); assert.equal(input.kind, 'execute');
  if (input.kind === 'execute') assert.equal(input.request.dryRun, true);
});

test('later changes to raw flags do not change captured request or presentation', () => {
  const raw = { json: true, compact: true, dryRun: false };
  const input = parseUpgradeCommandInput('block', '1', raw, 'sec upgrade');
  raw.json = false; raw.compact = false; raw.dryRun = true;
  assert.deepEqual(input.output, { json: true, compact: true });
  if (input.kind !== 'execute') assert.fail('wrong selected route');
  assert.equal(input.request.dryRun, false);
  assert.equal(Reflect.set(input.request, 'dryRun', true), false);
});

for (const subject of ['plan', 'diagnostics']) {
  test(`${subject} with an explicit target remains a block upgrade, not inspection`, () => {
    const input = parseUpgradeCommandInput(subject, '1', { dryRun: true }, 'sec upgrade');
    assert.equal(input.kind, 'execute');
    if (input.kind === 'execute') { assert.equal(input.subject, subject); assert.equal(input.targetVersion, '1'); }
  });
}

for (const subject of [undefined, null, 1, {}, []]) {
  test(`invalid upgrade subject type ${typeof subject} is rejected without reading write options`, () => {
    const input = { get dryRun() { assert.fail('invalid route read write flag'); } };
    assert.throws(() => parseUpgradeCommandInput(subject, '1', input, 'custom upgrade'),
      (error: unknown) => usage(error) && (error as Error).message.startsWith('Usage: custom upgrade '));
  });
}

for (const target of [undefined, null, 1, {}, []]) {
  test(`invalid upgrade target type ${typeof target} is rejected without reading write options`, () => {
    const input = { get dryRun() { assert.fail('invalid route read write flag'); } };
    assert.throws(() => parseUpgradeCommandInput('block', target, input, 'sec upgrade'), usage);
  });
}

test('unsupported repair modes cannot fall through to repair execution', () => {
  for (const mode of ['unknown', 'toString', null, 1, {}]) {
    assert.throws(() => parseRepairCommandInput(mode, { get dryRun() { assert.fail('unused flag read'); } }), usage);
  }
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

for (const commandName of ['compose', 'repair', 'upgrade']) {
  test(`real ${commandName} action rejects non-boolean flags before dynamic execution imports`, async () => {
    const root = new Command().name('sec').exitOverride().configureOutput({ writeErr() {}, writeOut() {} });
    registerWorkspaceCommands(root);
    const command = root.commands.find((command) => command.name() === commandName)!;
    command.setOptionValue(commandName === 'compose' ? 'lock' : 'dryRun', 'false');
    await assert.rejects(root.parseAsync([commandName, ...(commandName === 'upgrade' ? ['block', '1'] : [])], { from: 'user' }), usage);
  });
}
