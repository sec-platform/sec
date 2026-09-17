import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectionValue, registerInspectionQuery, type InspectionContext } from '../../src/bootstrap/cli/inspection-query.ts';

function program() {
  return new Command().name('sec').exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });
}
async function capture(action: () => Promise<unknown>): Promise<unknown[][]> {
  const previous = console.log;
  const output: unknown[][] = [];
  console.log = (...values) => { output.push(values); };
  try { await action(); } finally { console.log = previous; }
  return output;
}

test('registering or requesting help does not read data or execute a view', async () => {
  let calls = 0;
  const root = program();
  registerInspectionQuery(root.command('sample'), { read: () => { calls += 1; return 1; },
    view: (value) => { calls += 1; return inspectionValue(value, String); },
    modes: { detail: (value) => { calls += 1; return inspectionValue(value, String); } } });
  await assert.rejects(root.parseAsync(['sample', '--help'], { from: 'user' }),
    (error: unknown) => (error as { code: string }).code === 'commander.helpDisplayed');
  assert.equal(calls, 0);
});

test('only the selected view runs and each query reads exactly once', async () => {
  for (const mode of [undefined, 'detail']) {
    const events: string[] = [];
    const root = program();
    registerInspectionQuery(root.command('sample'), { read: () => { events.push('read'); return { value: 7 }; },
      view: (value) => { events.push('default'); return inspectionValue(value, (v) => `default:${v.value}`); },
      modes: { detail: (value) => { events.push('detail'); return inspectionValue(value.value, (v) => `detail:${v}`); } } });
    const printed = await capture(() => root.parseAsync(['sample', ...(mode ? [mode] : [])], { from: 'user' }));
    assert.deepEqual(events, ['read', mode ?? 'default']);
    assert.deepEqual(printed, [[mode ? 'detail:7' : 'default:7']]);
  }
});

test('JSON modes do not execute text formatters and preserve projected payloads', async () => {
  for (const compact of [false, true]) {
    const root = program();
    registerInspectionQuery(root.command('sample'), { read: () => ({ value: 3 }),
      view: (value) => inspectionValue(value, () => { throw new Error('text must stay lazy'); }) });
    const lines = await capture(() => root.parseAsync(['sample', '--json', ...(compact ? ['--compact'] : [])], { from: 'user' }));
    assert.deepEqual(lines, [[JSON.stringify({ value: 3 }, null, compact ? 0 : 2)]]);
  }
});

for (const args of [['sample', 'unknown'], ['sample', '__proto__'], ['sample', 'constructor'], ['sample', '--compact']]) {
  test(`invalid invocation ${args.join(' ')} is rejected before the read`, async () => {
    let reads = 0;
    const root = program();
    registerInspectionQuery(root.command('sample'), { read: () => { reads += 1; return 1; },
      view: (value) => inspectionValue(value, String), modes: { detail: (value) => inspectionValue(value, String) } });
    await assert.rejects(root.parseAsync(args, { from: 'user' }));
    assert.equal(reads, 0);
  });
}

test('non-boolean programmatic output cannot reach a reader', async () => {
  const root = program(); let reads = 0;
  const command = registerInspectionQuery(root.command('sample'), { read: () => { reads += 1; return 1; }, view: (v) => inspectionValue(v, String) });
  command.setOptionValue('json', 'false');
  await assert.rejects(root.parseAsync(['sample'], { from: 'user' }),
    (error: unknown) => (error as { code: string }).code === 'CLI-USAGE-001');
  assert.equal(reads, 0);
});

for (const phase of ['read-sync', 'read-async', 'view-sync', 'view-async', 'format'] as const) {
  test(`${phase} failure preserves the original value without emitting a result`, async () => {
    const reason = Object.freeze({ phase });
    const root = program(); let projected = false;
    registerInspectionQuery(root.command('sample'), {
      read: () => { if (phase === 'read-sync') throw reason; if (phase === 'read-async') return Promise.reject(reason); return 1; },
      view: (value) => { projected = true; if (phase === 'view-sync') throw reason;
        if (phase === 'view-async') return Promise.reject(reason);
        return inspectionValue(value, () => { throw reason; }); } });
    const lines = await capture(() => assert.rejects(root.parseAsync(['sample'], { from: 'user' }), (error: unknown) => error === reason));
    assert.deepEqual(lines, []);
    assert.equal(projected, !phase.startsWith('read'));
  });
}

test('data selection receives the same captured context as presentation after an await', async () => {
  const initial = process.cwd();
  const other = await mkdtemp(path.join(tmpdir(), 'sec-query-context-'));
  const root = program();
  let observed: InspectionContext | undefined;
  const command = registerInspectionQuery(root.command('sample'), {
    read: async (context) => {
      observed = context;
      assert.equal(Object.isFrozen(context), true);
      assert.equal(Object.isFrozen(context.output), true);
      await Promise.resolve();
      process.chdir(other); root.name('changed'); command.setOptionValue('json', false);
      return 42;
    },
    view: (value, context) => {
      assert.equal(context, observed); assert.equal(context.workspaceRoot, initial);
      assert.equal(context.rootCommand, 'sec'); assert.equal(context.output.json, true);
      return inspectionValue(value, () => assert.fail('JSON chosen before read'));
    } });
  try {
    assert.deepEqual(await capture(() => root.parseAsync(['sample', '--json'], { from: 'user' })), [['42']]);
  } finally { process.chdir(initial); await rm(other, { recursive: true, force: true }); }
});

test('definition changes after registration cannot change the admitted mode implementation', async () => {
  const root = program();
  const modes = { detail: (value: number) => inspectionValue(value, () => 'original') };
  const definition = { read: () => 1, view: (value: number) => inspectionValue(value, String), modes };
  registerInspectionQuery(root.command('sample'), definition);
  modes.detail = (value) => inspectionValue(value, () => 'replaced');
  definition.read = () => 99;
  assert.deepEqual(await capture(() => root.parseAsync(['sample', 'detail'], { from: 'user' })), [['original']]);
});

test('value/formatter pairing retains object identity without freezing the domain value', () => {
  const value = { status: 'observed' };
  const pair = inspectionValue(value, (received) => { assert.equal(received, value); return received.status; });
  assert.equal(pair.value, value); assert.equal(pair.formatText(), 'observed');
  assert.ok(Object.isFrozen(pair)); assert.equal(Object.isFrozen(value), false);
});

test('malformed internal definitions fail without partially registering a command', () => {
  const command = new Command().name('bad');
  assert.throws(() => registerInspectionQuery(command, { read: null as never, view: (v) => inspectionValue(v, String) }), TypeError);
  assert.equal(command.options.length, 0);
  assert.equal(command.registeredArguments.length, 0);
});

test('explicit mode names that resemble object prototype members remain exact map keys', async () => {
  const root = program();
  const modes = Object.create(null) as Record<string, (value: number) => ReturnType<typeof inspectionValue>>;
  modes.__proto__ = (value) => inspectionValue(value, () => 'explicit');
  registerInspectionQuery(root.command('sample'), { read: () => 1, view: (v) => inspectionValue(v, String), modes });
  assert.deepEqual(await capture(() => root.parseAsync(['sample', '__proto__'], { from: 'user' })), [['explicit']]);
});


test('the existing Commander object remains the unique command identity', () => {
  const root = program();
  const command = root.command('original').alias('other');
  const registered = registerInspectionQuery(command, { read: () => 1, view: (v) => inspectionValue(v, String) });
  assert.equal(registered, command);
  assert.equal(root.commands.length, 1);
  assert.equal(command.name(), 'original');
  assert.equal(command.alias(), 'other');
});

test('commands with a different argument contract are rejected before adding generic options', () => {
  const command = new Command('special').argument('<kind>');
  assert.throws(() => registerInspectionQuery(command, { read: () => 1, view: (v) => inspectionValue(v, String) }),
    /without predeclared arguments/);
  assert.equal(command.options.length, 0);
  assert.equal(command.registeredArguments.length, 1);
});
