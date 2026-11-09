import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { inspectionValue, registerInspectionQuery, type InspectionContext } from '../../../src/entry/cli/inspection-query.ts';
import { commandValue } from '../../../src/entry/cli/command-value.ts';
import { registerNamedInspectionQuery } from '../../../src/entry/cli/named-inspection-query.ts';

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
  // The required-selector wrapper owns native choice/help rejection before domain reads.
  for (const [args, expectedCode] of [
    [[], 'commander.missingArgument'],
    [['constructor'], 'commander.invalidArgument'],
    [['--help'], 'commander.helpDisplayed'],
    [['freeze', '--compact'], 'CLI-USAGE-001']
  ] as const) {
    const namedRoot = program();
    let namedReads = 0;
    registerNamedInspectionQuery(namedRoot.command('contract'), {
      freeze: () => { namedReads += 1; return commandValue(1, String); }
    });
    await assert.rejects(namedRoot.parseAsync(['contract', ...args], { from: 'user' }),
      (error: unknown) => (error as { code?: string }).code === expectedCode);
    assert.equal(namedReads, 0, JSON.stringify(args));
  }
});

test('only the selected view runs and each query reads exactly once', async () => {
  for (const mode of [undefined, 'summary', 'detail'] as const) {
    const events: string[] = [];
    const root = program();
    const command = root.command('sample').alias('other');
    registerInspectionQuery(command, { defaultMode: 'summary', read: () => { events.push('read'); return { value: 7 }; },
      view: (value) => { events.push('default'); return inspectionValue(value, (v) => `default:${v.value}`); },
      modes: { detail: (value) => { events.push('detail'); return inspectionValue(value.value, (v) => `detail:${v}`); } } });
    const printed = await capture(() => root.parseAsync(['other', ...(mode ? [mode] : [])], { from: 'user' }));
    assert.deepEqual(events, ['read', mode === 'detail' ? 'detail' : 'default']);
    assert.deepEqual(printed, [[mode === 'detail' ? 'detail:7' : 'default:7']]);
  }
  // Required selectors read different sources; optional modes project one source.
  for (const kind of ['errors', 'ci'] as const) {
    const namedRoot = program();
    const calls: string[] = [];
    const readers = Object.fromEntries(['errors', 'ci'].map((name) => [
      name, () => { calls.push(name); return commandValue({ name }, () => assert.fail('JSON text')); }
    ]));
    registerNamedInspectionQuery(namedRoot.command('contract'), readers);
    assert.deepEqual(
      await capture(() => namedRoot.parseAsync(['contract', kind, '--json', '--compact'], { from: 'user' })),
      [[JSON.stringify({ name: kind })]]
    );
    assert.deepEqual(calls, [kind]);
  }
});

test('JSON output does not execute text formatters and preserves the projected payload', async () => {
  const root = program();
  registerInspectionQuery(root.command('sample'), { read: () => ({ value: 3 }),
    view: (value) => inspectionValue(value, () => { throw new Error('text must stay lazy'); }) });
  const lines = await capture(() => root.parseAsync(['sample', '--json', '--compact'], { from: 'user' }));
  assert.deepEqual(lines, [[JSON.stringify({ value: 3 })]]);
});

// One inherited-name spelling witnesses rejected membership before reading;
// compact-only is a separate output-admission branch.
for (const args of [['sample', 'constructor'], ['sample', '--compact']]) {
  test(`invalid invocation ${args.join(' ')} is rejected before the read`, async () => {
    let reads = 0;
    const root = program();
    registerInspectionQuery(root.command('sample'), { read: () => { reads += 1; return 1; },
      view: (value) => inspectionValue(value, String), modes: { detail: (value) => inspectionValue(value, String) } });
    await assert.rejects(root.parseAsync(args, { from: 'user' }));
    assert.equal(reads, 0);
  });
}

for (const phase of ['read-async', 'view-async', 'format'] as const) {
  test(`${phase} failure preserves the original value without emitting a result`, async () => {
    const reason = Object.freeze({ phase });
    const root = program(); let projected = false;
    registerInspectionQuery(root.command('sample'), {
      defaultMode: 'summary',
      read: () => { if (phase === 'read-async') return Promise.reject(reason); return 1; },
      view: (value) => { projected = true; if (phase === 'view-async') return Promise.reject(reason);
        return inspectionValue(value, () => { throw reason; }); } });
    const lines = await capture(() => assert.rejects(root.parseAsync(['sample'], { from: 'user' }), (error: unknown) => error === reason));
    assert.deepEqual(lines, []);
    assert.equal(projected, !phase.startsWith('read'));
    if (phase !== 'view-async') {
      const namedRoot = program();
      const namedReason = Object.freeze({ phase: phase === 'read-async' ? 'async-read' : 'format' });
      let reads = 0;
      registerNamedInspectionQuery(namedRoot.command('contract'), { freeze: () => {
        reads += 1;
        if (phase === 'read-async') return Promise.reject(namedReason);
        return commandValue(7, () => { throw namedReason; });
      } });
      const namedLines = await capture(() => assert.rejects(
        namedRoot.parseAsync(['contract', 'freeze'], { from: 'user' }),
        (error: unknown) => error === namedReason
      ));
      assert.deepEqual(namedLines, []);
      assert.equal(reads, 1);
    }
  });
}

test('data selection receives the same captured context as presentation after an await', async () => {
  // The required-selector entry must freeze JSON selection before its domain await.
  const namedRoot = program();
  let finish!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const namedCommand = registerNamedInspectionQuery(namedRoot.command('contract'), {
    freeze: async () => {
      await held;
      return commandValue({ status: 'captured' }, () => assert.fail('text renderer ran after JSON was captured'));
    }
  });
  const namedLines = await capture(async () => {
    const run = namedRoot.parseAsync(['contract', 'freeze', '--json'], { from: 'user' });
    namedCommand.setOptionValue('json', false);
    finish();
    await run;
  });
  assert.deepEqual(namedLines, [[JSON.stringify({ status: 'captured' }, null, 2)]]);
  const initial = process.cwd();
  const other = await mkdtemp(path.join(tmpdir(), 'sec-query-context-'));
  await settleWorkspaceCallback(async () => {
    const root = program();
    let observed: InspectionContext | undefined;
    const command = registerInspectionQuery(root.command('sample'), {
      read: async (context) => {
        observed = context;
        assert.equal(Object.isFrozen(context), true);
        assert.equal(Object.isFrozen(context.output), true);
        await Promise.resolve();
        process.chdir(other); root.name('changed'); command.setOptionValue('json', false);
        return { value: 42 };
      },
      view: (value, context) => {
        assert.deepEqual(context, observed); assert.equal(context.workspaceRoot, initial);
        assert.equal(context.rootCommand, 'sec'); assert.equal(context.output.json, true);
        return inspectionValue(value, () => assert.fail('JSON chosen before read'));
      } });
    assert.deepEqual(await capture(() => root.parseAsync(['sample', '--json'], { from: 'user' })), [[JSON.stringify({ value: 42 }, null, 2)]]);
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'restore-cwd', settle: () => process.chdir(initial) },
      { label: 'query-workspace', settle: () => rm(other, { recursive: true, force: true }) }
    ] });
  });
});
