import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { Command } from 'commander';
import { commandValue } from '../../src/interface/cli/command-value.ts';
import { registerNamedInspectionQuery } from '../../src/interface/cli/named-inspection-query.ts';
const program = () => new Command().name('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
async function capture(action: () => Promise<unknown>) {
  const log = console.log, lines: unknown[] = []; console.log = value => { lines.push(value); };
  try { await action(); return lines; } finally { console.log = log; }
}
for (const kind of ['freeze', 'errors', 'ci']) {
  test(`required selector ${kind} reads only its own source and formats only the selected output`, async () => {
    const root = program(), calls: string[] = [];
    const readers = Object.fromEntries(['freeze', 'errors', 'ci'].map(name => [name, () => { calls.push(name); return commandValue({ name }, () => assert.fail('JSON text')); }]));
    const command = root.command('contract'); assert.equal(registerNamedInspectionQuery(command, readers), command);
    assert.deepEqual(command.registeredArguments[0]!.argChoices, ['freeze', 'errors', 'ci']);
    assert.deepEqual(await capture(() => root.parseAsync(['contract', kind, '--json', '--compact'], { from: 'user' })), [JSON.stringify({ name: kind })]);
    assert.deepEqual(calls, [kind]);
  });
}
for (const args of [[], ['missing'], ['constructor'], ['--help'], ['freeze', '--compact']]) {
  test(`invalid or help invocation ${JSON.stringify(args)} never reads a domain`, async () => {
    const root = program(); let reads = 0;
    registerNamedInspectionQuery(root.command('contract'), { freeze: () => { reads++; return commandValue(1, String); } });
    await assert.rejects(root.parseAsync(['contract', ...args], { from: 'user' })); assert.equal(reads, 0);
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

test('registered routing and captured output cannot be changed across a domain await', async () => {
  const root = program(); let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const readers = { freeze: async () => { await held; return commandValue(7, () => assert.fail('text output changed')); } };
  const command = registerNamedInspectionQuery(root.command('contract'), readers);
  readers.freeze = async () => { throw new Error('routing changed'); };
  const lines = await capture(async () => {
    const run = root.parseAsync(['contract', 'freeze', '--json'], { from: 'user' });
    command.setOptionValue('json', false); finish(); await run;
  });
  assert.deepEqual(lines, ['7']);
});

test('required selector ignores unrelated options and does not replace native command identity', async () => {
  const root = program(), native = root.command('contract').alias('c');
  const command = registerNamedInspectionQuery(native, { freeze: () => commandValue(7, String) });
  command.hook('preAction', () => { Object.defineProperty(command.opts(), 'unrelated', { enumerable: true, get() { assert.fail('unowned'); } }); });
  assert.equal(command, native); assert.equal(root.commands.length, 1);
  assert.deepEqual(await capture(() => root.parseAsync(['c', 'freeze'], { from: 'user' })), ['7']);
});

test('bad definitions do not partially register arguments or options', () => {
  for (const readers of [{}, { '': () => commandValue(1, String) }, { valid: null }]) {
    const command = program(); assert.throws(() => registerNamedInspectionQuery(command, readers as never), TypeError);
    assert.equal(command.options.length, 0); assert.equal(command.registeredArguments.length, 0);
  }
  const command = program().argument('<other>');
  assert.throws(() => registerNamedInspectionQuery(command, { valid: () => commandValue(1, String) }), TypeError);
  assert.equal(command.options.length, 0); assert.equal(command.registeredArguments.length, 1);
});
