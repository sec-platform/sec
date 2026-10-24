import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectionValue, registerInspectionQuery, type InspectionContext } from '../../../src/entry/cli/inspection-query.ts';

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
  for (const mode of [undefined, 'summary', 'detail'] as const) {
    const events: string[] = [];
    const root = program();
    const command = root.command('sample').alias('other');
    const registered = registerInspectionQuery(command, { defaultMode: 'summary', read: () => { events.push('read'); return { value: 7 }; },
      view: (value) => { events.push('default'); return inspectionValue(value, (v) => `default:${v.value}`); },
      modes: { detail: (value) => { events.push('detail'); return inspectionValue(value.value, (v) => `detail:${v}`); } } });
    assert.equal(registered, command);
    assert.equal(root.commands.length, 1);
    assert.equal(command.name(), 'sample');
    assert.equal(command.alias(), 'other');
    const printed = await capture(() => root.parseAsync(['other', ...(mode ? [mode] : [])], { from: 'user' }));
    assert.deepEqual(events, ['read', mode === 'detail' ? 'detail' : 'default']);
    assert.deepEqual(printed, [[mode === 'detail' ? 'detail:7' : 'default:7']]);
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

for (const phase of ['read-sync', 'read-async', 'view-sync', 'view-async', 'format'] as const) {
  test(`${phase} failure preserves the original value without emitting a result`, async () => {
    const reason = Object.freeze({ phase });
    const root = program(); let projected = false;
    registerInspectionQuery(root.command('sample'), {
      defaultMode: 'summary',
      read: () => { if (phase === 'read-sync') throw reason; if (phase === 'read-async') return Promise.reject(reason); return 1; },
      view: (value) => { projected = true; if (phase === 'view-sync') throw reason;
        if (phase === 'view-async') return Promise.reject(reason);
        return inspectionValue(value, () => { throw reason; }); } });
    const lines = await capture(() => assert.rejects(root.parseAsync(['sample', ...(phase === 'view-sync' ? ['summary'] : [])], { from: 'user' }), (error: unknown) => error === reason));
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
      assert.deepEqual(context, observed); assert.equal(context.workspaceRoot, initial);
      assert.equal(context.rootCommand, 'sec'); assert.equal(context.output.json, true);
      return inspectionValue(value, () => assert.fail('JSON chosen before read'));
    } });
  try {
    assert.deepEqual(await capture(() => root.parseAsync(['sample', '--json'], { from: 'user' })), [['42']]);
  } finally { process.chdir(initial); await rm(other, { recursive: true, force: true }); }
});
