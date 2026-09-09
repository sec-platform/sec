import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { runWithOptionalSpinner } from '../../src/interface/cli/command-progress.ts';
import { registerWorkspaceCommands } from '../../src/interface/cli/register-workspace-commands.ts';

for (const args of [['upgrade'], ['upgrade', 'a-block']]) {
  test(`${args.join(' ')} rejects missing arguments before loading upgrade readers`, async () => {
    const command = new Command().name('sec').exitOverride();
    registerWorkspaceCommands(command);
    await assert.rejects(command.parseAsync(args, { from: 'user' }),
      (error: unknown) => (error as { code?: string }).code === 'CLI-USAGE-001');
  });
}

test('JSON progress executes once and preserves the actual result without a spinner', async () => {
  const expected = Object.freeze({ result: 'completed' });
  let calls = 0;
  const actual = await runWithOptionalSpinner('unused text', { json: true, compact: false }, async () => {
    calls += 1;
    return expected;
  });
  assert.equal(actual, expected);
  assert.equal(calls, 1);
});

for (const kind of ['synchronous', 'asynchronous'] as const) {
  test(`JSON progress preserves the exact ${kind} rejection`, async () => {
    const reason = Object.freeze({ kind });
    const action = kind === 'synchronous'
      ? () => { throw reason; }
      : async () => { throw reason; };
    await assert.rejects(runWithOptionalSpinner('unused text', { json: true, compact: true }, action),
      (actual: unknown) => actual === reason);
  });
}

test('changing output options after selection does not start another progress path', async () => {
  const output = { json: true, compact: false };
  let finish!: () => void;
  let calls = 0;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const work = runWithOptionalSpinner('unused text', output, async () => {
    calls += 1;
    await held;
    return 'result';
  });
  output.json = false;
  finish();
  assert.equal(await work, 'result');
  assert.equal(calls, 1);
});
