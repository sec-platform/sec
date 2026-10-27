import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { runWithOptionalSpinner } from '../../../src/bootstrap/cli/command-progress.ts';
import { addJsonFlags, commandFromRoot, jsonOpts } from '../../../src/entry/cli/command-options.ts';
test('captured output and selected JSON progress survive caller mutation until completion', async () => {
  const input = { json: true, compact: false };
  const output = jsonOpts(input);
  const expected = Object.freeze({ result: 'completed' });
  let finish!: () => void;
  let calls = 0;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const work = runWithOptionalSpinner('unused text', input, async () => {
    calls += 1;
    await held;
    return expected;
  });
  input.json = false;
  finish();
  assert.equal(await work, expected);
  assert.equal(calls, 1);
  assert.equal(output.json, true);
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
