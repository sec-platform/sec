import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { commandValue } from '../../../src/entry/cli/command-value.ts';
import { registerNamedInspectionQuery } from '../../../src/entry/cli/named-inspection-query.ts';
const program = () => new Command().name('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
async function capture(action: () => Promise<unknown>) {
  const log = console.log, lines: unknown[] = []; console.log = value => { lines.push(value); };
  try { await action(); return lines; } finally { console.log = log; }
}
for (const kind of ['errors', 'ci']) {
  test(`required selector ${kind} reads only its own source and formats only the selected output`, async () => {
    const root = program(), calls: string[] = [];
    const readers = Object.fromEntries(['errors', 'ci'].map(name => [name, () => { calls.push(name); return commandValue({ name }, () => assert.fail('JSON text')); }]));
    registerNamedInspectionQuery(root.command('contract'), readers);
    assert.deepEqual(await capture(() => root.parseAsync(['contract', kind, '--json', '--compact'], { from: 'user' })), [JSON.stringify({ name: kind })]);
    assert.deepEqual(calls, [kind]);
  });
}
// Native parser outcomes distinguish help and invalid invocation; only the
// output-policy rejection below belongs to the SEC diagnostic namespace.
for (const [args, expectedCode] of [
  [[], 'commander.missingArgument'],
  [['missing'], 'commander.invalidArgument'],
  [['constructor'], 'commander.invalidArgument'],
  [['--help'], 'commander.helpDisplayed'],
  [['freeze', '--compact'], 'CLI-USAGE-001']
] as const) {
  test(`invalid or help invocation ${JSON.stringify(args)} never reads a domain`, async () => {
    const root = program(); let reads = 0;
    registerNamedInspectionQuery(root.command('contract'), { freeze: () => { reads++; return commandValue(1, String); } });
    await assert.rejects(root.parseAsync(['contract', ...args], { from: 'user' }),
      (error: unknown) => (error as { code?: string }).code === expectedCode);
    assert.equal(reads, 0);
  });
}
for (const phase of ['sync-read', 'async-read', 'format']) {
  test(`${phase} failure is preserved with no result emission or retries`, async () => {
    const root = program(), reason = Object.freeze({ phase }); let reads = 0;
    registerNamedInspectionQuery(root.command('contract'), { freeze: () => {
      reads++; if (phase === 'sync-read') throw reason; if (phase === 'async-read') return Promise.reject(reason);
      return commandValue(7, () => { throw reason; });
    } });
    assert.deepEqual(await capture(() => assert.rejects(root.parseAsync(['contract', 'freeze'], { from: 'user' }), e => e === reason)), []);
    assert.equal(reads, 1);
  });
}

test('captured output cannot be changed across a domain await', async () => {
  const root = program(); let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const readers = { freeze: async () => { await held; return commandValue(7, () => assert.fail('text output changed')); } };
  const command = registerNamedInspectionQuery(root.command('contract'), readers);
  const lines = await capture(async () => {
    const run = root.parseAsync(['contract', 'freeze', '--json'], { from: 'user' });
    command.setOptionValue('json', false); finish(); await run;
  });
  assert.deepEqual(lines, ['7']);
});
