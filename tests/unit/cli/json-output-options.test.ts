import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { addJsonFlags, jsonOpts } from '../../../src/entry/cli/command-options.ts';
import { JSON_OUTPUT_OPTIONS, parseJsonOutputOptions, type JsonOutputIssue } from '../../../src/entry/cli/json-output-options.ts';

const reject = (issue: JsonOutputIssue): never => { throw issue; };

test('shared output policy admits each boolean configuration', () => {
  for (const json of [undefined, false, true]) for (const compact of [undefined, false, true]) {
    if (compact === true && json !== true) continue;
    const input = { json, compact };
    const expected = { json: json ?? false, compact: compact ?? false };
    const actual = parseJsonOutputOptions(input, reject);
    assert.deepEqual(actual, expected);
    assert.ok(Object.isFrozen(actual));
  }
});

test('compact output requires JSON for both absent and disabled flags', () => {
  for (const json of [undefined, false]) {
    const input = { json, compact: true };
    assert.throws(() => parseJsonOutputOptions(input, reject),
      (issue: unknown) => (issue as JsonOutputIssue).kind === 'missing-dependency'
        && (issue as JsonOutputIssue).option === 'compact');
  }
});

test('captured output is independent of later caller mutation', () => {
  const input = { json: true, compact: false };
  const output = jsonOpts(input);
  input.json = false;
  assert.equal(output.json, true);
  assert.equal(Reflect.set(output, 'compact', true), false);
});

test('defaults and dependency descriptions cannot be changed after registration', () => {
  assert.ok(Object.isFrozen(JSON_OUTPUT_OPTIONS));
  for (const definition of JSON_OUTPUT_OPTIONS) {
    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.requires));
  }
});

test('generic compact dependency retains the real command path in its usage error', async () => {
  const program = new Command().name('renamed').exitOverride();
  addJsonFlags(program.command('parent').command('inspect')).action(() => assert.fail('not admitted'));
  await assert.rejects(program.parseAsync(['parent', 'inspect', '--compact'], { from: 'user' }),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'CLI-USAGE-001');
      const message = (error as Error).message;
      assert.match(message, /renamed\s+parent\s+inspect/);
      assert.ok(message.includes('--json'));
      assert.ok(message.includes('--compact'));
      return true;
    });
});

test('valid flags execute the actual selected action exactly once', async () => {
  for (const args of [[], ['--json'], ['--json', '--compact']]) {
    let effects = 0;
    const command = addJsonFlags(new Command().name('sample').exitOverride());
    command.action((opts) => {
      effects += 1;
      assert.deepEqual(jsonOpts(opts), { json: args.includes('--json'), compact: args.includes('--compact') });
    });
    await command.parseAsync(args, { from: 'user' });
    assert.equal(effects, 1);
  }
});
