import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { jsonOpts } from '../../../src/entry/cli/command-options.ts';
import { commandValue } from '../../../src/entry/cli/command-value.ts';
import { runWithOptionalSpinner } from '../../../src/bootstrap/cli/command-progress.ts';
import { registerWorkspaceAction } from '../../../src/entry/cli/workspace-action.ts';

function program() { return new Command().name('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} }); }
async function capture(run: () => Promise<unknown>) {
  const original = console.log, lines: unknown[][] = [];
  console.log = (...values) => { lines.push(values); };
  try { await run(); return lines; } finally { console.log = original; }
}

test('one registered action admits, executes and projects once in that order', async () => {
  const root = program(), events: string[] = [], result = Object.freeze({ value: 7 });
  const native = root.command('sample <value>').alias('other');
  registerWorkspaceAction(native, {
    decode: (value: string) => { events.push('decode'); return { request: value, output: jsonOpts({}) }; },
    execute: async (cwd, value) => { events.push('execute'); assert.equal(cwd, process.cwd()); assert.equal(value, 'input'); return result; },
    view: (value) => { events.push('view'); return commandValue(value, (v) => { events.push('format'); return String(v.value); }); }
  });
  assert.deepEqual(await capture(() => root.parseAsync(['other', 'input'], { from: 'user' })), [['7']]);
  assert.deepEqual(events, ['decode', 'execute', 'view', 'format']);
});

test('JSON suppresses text formatting while preserving the projected payload through a progress runner', async () => {
  const root = program();
  registerWorkspaceAction(root.command('sample'), {
    decode: () => ({ request: 1, output: jsonOpts({ json: true, compact: true }) }),
    progress: { text: 'Working', run: runWithOptionalSpinner }, execute: async () => ({ domain: 1 }),
    view: (value) => commandValue({ projected: value.domain }, () => assert.fail('JSON formatted text'))
  });
  assert.deepEqual(await capture(() => root.parseAsync(['sample'], { from: 'user' })), [['{"projected":1}']]);
});

for (const phase of ['decode', 'execute-sync', 'execute-async', 'view-sync', 'view-async', 'format', 'sink'] as const) {
  test(`${phase} failure never retries execution or invokes an earlier phase again`, async () => {
    const reason = phase === 'execute-async' ? undefined : Object.freeze({ phase });
    const root = program(), events: string[] = [];
    const jsonProgress = phase === 'execute-sync' || phase === 'execute-async';
    registerWorkspaceAction(root.command('sample'), {
      decode: () => { events.push('decode'); if (phase === 'decode') throw reason; return { request: 1, output: jsonOpts({ json: jsonProgress, compact: jsonProgress }) }; },
      ...(jsonProgress ? { progress: { text: 'Unused JSON progress', run: runWithOptionalSpinner } } : {}),
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

test('workspace capture happens before decoder code can change process cwd', async () => {
  const root = program(), original = process.cwd(); let observed = '';
  const other = mkdtempSync(path.join(tmpdir(), 'sec-action-cwd-'));
  await settleWorkspaceCallback(async () => {
    registerWorkspaceAction(root.command('sample'), {
      decode: () => { process.chdir(other); return { request: undefined, output: jsonOpts({}) }; },
      execute: async (workspaceRoot) => { observed = workspaceRoot; return 1; }, view: (value) => commandValue(value, String)
    });
    await capture(() => root.parseAsync(['sample'], { from: 'user' }));
    assert.equal(observed, original);
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'restore-cwd', settle: () => process.chdir(original) },
      { label: 'action-workspace', settle: () => rmSync(other, { recursive: true, force: true }) }
    ] });
  });
});

test('decoder owns the immutable request snapshot; execution never receives raw Commander input', async () => {
  const root = program(); let finish!: () => void;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  const command = root.command('sample').option('--enabled');
  registerWorkspaceAction(command, {
    decode: (raw: Record<string, unknown>) => ({ request: Object.freeze({ enabled: raw.enabled }), output: jsonOpts({ json: true }) }),
    execute: async (_cwd, request) => { await held; return request; },
    view: (value) => commandValue(value, () => assert.fail('wrong output mode'))
  });
  const lines = await capture(async () => { const pending = root.parseAsync(['sample', '--enabled'], { from: 'user' }); command.setOptionValue('enabled', false); finish(); await pending; });
  assert.deepEqual(JSON.parse(String(lines[0]![0])), { enabled: true });
});


test('help does not decode, execute or project the operation', async () => {
  const root = program();
  registerWorkspaceAction(root.command('sample'), { decode: () => assert.fail('decode'), execute: async () => assert.fail('execute'), view: () => assert.fail('view') });
  await assert.rejects(root.parseAsync(['sample', '--help'], { from: 'user' }), (error: unknown) => (error as { code: string }).code === 'commander.helpDisplayed');
});
