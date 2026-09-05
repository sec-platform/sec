import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import { Command } from 'commander';
import { commandValue } from '../../src/interface/cli/command-value.ts';
import { inspectionValue } from '../../src/interface/cli/inspection-query.ts';
import { registerWorkspaceAction } from '../../src/interface/cli/workspace-action.ts';
import { jsonOpts } from '../../src/interface/cli/command-options.ts';

function program() { return new Command().name('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} }); }
async function capture(run: () => Promise<unknown>) {
  const original = console.log, lines: unknown[][] = [];
  console.log = (...values) => { lines.push(values); };
  try { await run(); return lines; } finally { console.log = original; }
}

test('one registered action admits, executes and projects once in that order', async () => {
  const root = program(), events: string[] = [], result = Object.freeze({ value: 7 });
  const native = root.command('sample <value>').alias('other');
  const registered = registerWorkspaceAction(native, {
    decode: (value: string) => { events.push('decode'); return { request: value, output: jsonOpts({}) }; },
    execute: async (cwd, value) => { events.push('execute'); assert.equal(cwd, process.cwd()); assert.equal(value, 'input'); return result; },
    view: (value) => { events.push('view'); assert.equal(value, result); return commandValue(value, (v) => { events.push('format'); return String(v.value); }); }
  });
  assert.equal(registered, native); assert.equal(root.commands.length, 1);
  assert.deepEqual(await capture(() => root.parseAsync(['other', 'input'], { from: 'user' })), [['7']]);
  assert.deepEqual(events, ['decode', 'execute', 'view', 'format']);
});

test('JSON suppresses text formatting and progress setup while preserving the projected payload', async () => {
  const root = program();
  registerWorkspaceAction(root.command('sample'), {
    decode: () => ({ request: 1, output: jsonOpts({ json: true, compact: true }) }),
    progress: 'Working', execute: async () => ({ domain: 1 }),
    view: (value) => commandValue({ projected: value.domain }, () => assert.fail('JSON formatted text'))
  });
  assert.deepEqual(await capture(() => root.parseAsync(['sample'], { from: 'user' })), [['{"projected":1}']]);
});

for (const phase of ['decode', 'execute-sync', 'execute-async', 'view-sync', 'view-async', 'format', 'sink'] as const) {
  test(`${phase} failure never retries execution or invokes an earlier phase again`, async () => {
    const reason = Object.freeze({ phase }), root = program(), events: string[] = [];
    registerWorkspaceAction(root.command('sample'), {
      decode: () => { events.push('decode'); if (phase === 'decode') throw reason; return { request: 1, output: jsonOpts({}) }; },
      execute: () => { events.push('execute'); if (phase === 'execute-sync') throw reason; if (phase === 'execute-async') return Promise.reject(reason); return Promise.resolve(1); },
      view: (value) => { events.push('view'); if (phase === 'view-sync') throw reason; if (phase === 'view-async') return Promise.reject(reason);
        return commandValue(value, () => { events.push('format'); if (phase === 'format') throw reason; return 'ok'; }); }
    });
    const log = console.log;
    if (phase === 'sink') console.log = () => { throw reason; };
    try { await assert.rejects(root.parseAsync(['sample'], { from: 'user' }), (error) => error === reason); }
    finally { console.log = log; }
    assert.equal(new Set(events).size, events.length);
    assert.equal(events[0], 'decode');
    assert.equal(events.includes('execute'), phase !== 'decode');
    assert.equal(events.includes('view'), !['decode', 'execute-sync', 'execute-async'].includes(phase));
  });
}

for (const reason of [undefined, null, false, 0, 'failure']) {
  test(`arbitrary ${String(reason)} rejection is preserved exactly`, async () => {
    const root = program();
    registerWorkspaceAction(root.command('sample'), {
      decode: () => ({ request: undefined, output: jsonOpts({}) }),
      execute: async () => { throw reason; }, view: () => assert.fail('view ran after failure')
    });
    await assert.rejects(root.parseAsync(['sample'], { from: 'user' }), (error) => error === reason);
  });
}

test('registered functions are fixed even when the definition is subsequently replaced', async () => {
  const root = program();
  const definition = { decode: () => ({ request: 7, output: jsonOpts({}) }), execute: async (_cwd: string, value: number) => value,
    view: (value: number) => commandValue(value, String) };
  registerWorkspaceAction(root.command('sample'), definition);
  definition.decode = () => { throw new Error('replaced'); }; definition.execute = async () => 99;
  definition.view = () => { throw new Error('replaced'); };
  assert.deepEqual(await capture(() => root.parseAsync(['sample'], { from: 'user' })), [['7']]);
});

test('workspace capture happens before decoder code can change process cwd', async () => {
  const root = program(), original = process.cwd(); let observed = '';
  const other = mkdtempSync(path.join(tmpdir(), 'sec-action-cwd-'));
  registerWorkspaceAction(root.command('sample'), {
    decode: () => { process.chdir(other); return { request: undefined, output: jsonOpts({}) }; },
    execute: async (workspaceRoot) => { observed = workspaceRoot; return 1; }, view: (value) => commandValue(value, String)
  });
  try { await capture(() => root.parseAsync(['sample'], { from: 'user' })); assert.equal(observed, original); }
  finally { process.chdir(original); rmSync(other, { recursive: true, force: true }); }
});

test('decoder owns the immutable request snapshot; execution never receives raw Commander input', async () => {
  const root = program(); let finish!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const command = root.command('sample').option('--enabled');
  registerWorkspaceAction(command, {
    decode: (raw: Record<string, unknown>) => ({ request: Object.freeze({ enabled: raw.enabled }), output: jsonOpts({ json: true }) }),
    execute: async (_cwd, request) => { await held; assert.ok(Object.isFrozen(request)); return request; },
    view: (value) => commandValue(value, () => assert.fail('wrong output mode'))
  });
  const lines = await capture(async () => { const pending = root.parseAsync(['sample', '--enabled'], { from: 'user' }); command.setOptionValue('enabled', false); finish(); await pending; });
  assert.deepEqual(JSON.parse(String(lines[0]![0])), { enabled: true });
});

for (const key of ['decode', 'execute', 'view'] as const) {
  test(`invalid internal ${key} is rejected before replacing the native action`, async () => {
    const command = program(); let originalCalls = 0;
    command.action(() => { originalCalls += 1; });
    const definition = { decode: () => ({ request: 1, output: jsonOpts({}) }), execute: async () => 1, view: (v: number) => commandValue(v, String), [key]: null };
    assert.throws(() => registerWorkspaceAction(command, definition as never), TypeError);
    await command.parseAsync([], { from: 'user' }); assert.equal(originalCalls, 1);
  });
}

test('the old inspection value export and operation values are the same typed implementation', () => {
  assert.equal(inspectionValue, commandValue);
  const domain = { state: 'live' }; const view = commandValue(domain, (value) => { assert.equal(value, domain); return value.state; });
  assert.ok(Object.isFrozen(view)); assert.ok(!Object.isFrozen(domain));
  domain.state = 'updated'; assert.equal(view.formatText(), 'updated');
});

test('help does not decode, execute or project the operation', async () => {
  const root = program();
  registerWorkspaceAction(root.command('sample'), { decode: () => assert.fail('decode'), execute: async () => assert.fail('execute'), view: () => assert.fail('view') });
  await assert.rejects(root.parseAsync(['sample', '--help'], { from: 'user' }), (error: unknown) => (error as { code: string }).code === 'commander.helpDisplayed');
});
