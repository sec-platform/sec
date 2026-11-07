import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { runWithOptionalProgress } from '../../../src/entry/cli/command-progress.ts';
import { addJsonFlags, commandFromRoot, jsonOpts } from '../../../src/entry/cli/command-options.ts';
test('captured output selects JSON without invoking progress after caller mutation', async () => {
  const input = { json: true, compact: false };
  const output = jsonOpts(input);
  const expected = Object.freeze({ result: 'completed' });
  let finish!: () => void;
  let calls = 0;
  let presentations = 0;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const present = async <T>(text: string, execute: () => Promise<T>): Promise<T> => {
    presentations += 1;
    assert.equal(text, 'visible progress');
    return execute();
  };
  const work = runWithOptionalProgress('unused text', output, async () => {
    calls += 1;
    await held;
    return expected;
  }, present);
  input.json = false;
  finish();
  assert.equal(await work, expected);
  assert.equal(calls, 1);
  assert.equal(presentations, 0, 'JSON output must not invoke the text presenter');
  assert.deepEqual(output, { json: true, compact: false });
  assert.equal(Object.isFrozen(output), true);

  // The other selected branch must actually reach the presenter; otherwise
  // a no-op presenter implementation could make the JSON witness vacuous.
  const text = await runWithOptionalProgress('visible progress', { json: false, compact: false },
    async () => expected, present);
  assert.equal(text, expected);
  assert.equal(presentations, 1);
});


test('generic compact dependency retains the real command path in its usage error', async () => {
  const program = new Command().name('renamed').exitOverride();
  const leaf = addJsonFlags(program.command('parent').command('inspect'));
  leaf.action(() => assert.fail('not admitted'));
  assert.equal(commandFromRoot(leaf, 'verify'), 'renamed verify');
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
      const output = jsonOpts(opts);
      assert.deepEqual(output, { json: args.includes('--json'), compact: args.includes('--compact') });
    });
    await command.parseAsync(args, { from: 'user' });
    assert.equal(effects, 1);
  }
});
