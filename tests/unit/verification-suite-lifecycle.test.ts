import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { materializeFastSuiteExecutionGeneration } from '../../src/adapters/verification/fast-suite-generation.ts';
import { runSuiteFiles } from '../helpers/run-suite-files.ts';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-suite-lifecycle-'));
  const one = path.join(root, 'one.mjs'), two = path.join(root, 'two.mjs');
  const state = { events: [] as string[], run: undefined as undefined | ((label: string) => void | Promise<void>) };
  const key = `sec-suite-${root}`;
  Object.defineProperty(globalThis, key, { value: state, configurable: true });
  for (const [file, label] of [[one, 'one'], [two, 'two']]) {
    writeFileSync(file!, `const state=globalThis[${JSON.stringify(key)}];\nstate.events.push(${JSON.stringify('load:' + label)});\nexport async function runSuite(){state.events.push(${JSON.stringify('run:' + label)});await state.run?.(${JSON.stringify(label)});}\n`);
  }
  return { root, one, two, state, cleanup() { Reflect.deleteProperty(globalThis, key); rmSync(root, { recursive: true, force: true }); } };
}
function deferred() { let release!: () => void; const promise = new Promise<void>(yes => { release = yes; }); return { promise, release }; }

test.skipIf(process.platform !== 'linux')('sealed fast-suite generations preserve executable modes and bind them into input identity', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-fast-suite-mode-'));
  const executable = path.join(root, 'tool.sh');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n');
  chmodSync(executable, 0o755);
  let first: Awaited<ReturnType<typeof materializeFastSuiteExecutionGeneration>> | undefined;
  let second: Awaited<ReturnType<typeof materializeFastSuiteExecutionGeneration>> | undefined;
  try {
    first = await materializeFastSuiteExecutionGeneration({ workspaceRoot: root });
    assert.equal(statSync(path.join(first.generation.workingDirectory.root.path, 'tool.sh')).mode & 0o777, 0o755);
    chmodSync(executable, 0o644);
    second = await materializeFastSuiteExecutionGeneration({ workspaceRoot: root });
    assert.equal(statSync(path.join(second.generation.workingDirectory.root.path, 'tool.sh')).mode & 0o777, 0o644);
    assert.notEqual(first.inputDigest, second.inputDigest);
  } finally {
    await second?.retire();
    await first?.retire();
    rmSync(root, { recursive: true, force: true });
  }
});

test('serial execution and recording keep input labels and duplicate-file reruns', async () => {
  const f = fixture(), recorded: string[] = [];
  try {
    await runSuiteFiles([f.one, f.two, f.one], file => { recorded.push(file); });
    assert.deepEqual(recorded, [f.one, f.two, f.one]);
    assert.deepEqual(f.state.events, ['load:one','run:one','load:two','run:two','load:one','run:one']);
  } finally { f.cleanup(); }
});

test('relative file paths are captured before a suite changes cwd', async () => {
  const f = fixture(), cwd = process.cwd();
  f.state.run = () => { process.chdir(tmpdir()); };
  try {
    process.chdir(f.root); const recorded: string[] = [];
    await runSuiteFiles(['one.mjs', 'two.mjs'], label => { recorded.push(label); });
    assert.deepEqual(recorded, ['one.mjs', 'two.mjs']); assert.ok(f.state.events.includes('run:two'));
  } finally { process.chdir(cwd); f.cleanup(); }
});

test('custom task iterator cannot replace the selected module', async () => {
  const f = fixture(), input = [f.one];
  input[Symbol.iterator] = () => [f.two].values();
  try { await runSuiteFiles(input); assert.deepEqual(f.state.events, ['load:one','run:one']); }
  finally { f.cleanup(); }
});

for (const invalid of [new Array(1), [''], [null], [7], ['nul\0file']]) test('invalid inventory rejects before importing any preceding file', async () => {
  const f = fixture();
  try { await assert.rejects(runSuiteFiles([f.one, ...invalid] as never)); assert.deepEqual(f.state.events, []); }
  finally { f.cleanup(); }
});

test('accessor inventory slots are not executed', async () => {
  const input: string[] = []; Object.defineProperty(input, 0, { get() { assert.fail('slot getter'); } });
  await assert.rejects(runSuiteFiles(input), TypeError);
});

test('cancellation before admission does not read the inventory', async () => {
  const controller = new AbortController(), reason = new Error('cancelled'); controller.abort(reason);
  const input = new Proxy([] as string[], { get() { assert.fail('inventory read'); } });
  await assert.rejects(runSuiteFiles(input, undefined, controller.signal), error => error === reason);
});

test('cancellation at module import prevents its runSuite from starting', async () => {
  const f = fixture(), controller = new AbortController(), reason = new Error('cancel');
  const key = `sec-cancel-${f.root}`; Object.defineProperty(globalThis, key, { value: { controller, reason }, configurable: true });
  writeFileSync(f.one, `const {controller,reason}=globalThis[${JSON.stringify(key)}];controller.abort(reason);export function runSuite(){throw new Error('should not run');}`);
  try { await assert.rejects(runSuiteFiles([f.one, f.two], undefined, controller.signal), error => error === reason); assert.deepEqual(f.state.events, []); }
  finally { Reflect.deleteProperty(globalThis, key); f.cleanup(); }
});

test('a cancelled but uncooperative running suite is joined and not counted as passed', async () => {
  const f = fixture(), controller = new AbortController(), started = deferred(), release = deferred();
  const reason = new Error('cancel'); let finished = false, reports = 0;
  f.state.run = async () => { started.release(); await release.promise; };
  const running = runSuiteFiles([f.one, f.two], () => { reports++; }, controller.signal).finally(() => { finished = true; });
  const rejected = assert.rejects(running, error => error === reason);
  try {
    await started.promise; controller.abort(reason); await Promise.resolve(); assert.equal(finished, false);
    release.release(); await rejected; assert.equal(reports, 0); assert.ok(!f.state.events.includes('load:two'));
  } finally { release.release(); await rejected; f.cleanup(); }
});

test('an asynchronous pass recorder is joined before the next suite starts', async () => {
  const f = fixture(), started = deferred(), release = deferred();
  const running = runSuiteFiles([f.one, f.two], async file => { if (file === f.one) { started.release(); await release.promise; } });
  try { await started.promise; assert.ok(!f.state.events.includes('load:two')); release.release(); await running; }
  finally { release.release(); await running; f.cleanup(); }
});

for (const reason of [undefined, null, false, 0]) test(`async recording failure ${String(reason)} is preserved and stops later execution`, async () => {
  const f = fixture();
  try { await assert.rejects(runSuiteFiles([f.one, f.two], async () => { throw reason; }), error => error === reason); assert.ok(!f.state.events.includes('load:two')); }
  finally { f.cleanup(); }
});

test('invalid recorder is rejected before suite side effects', async () => {
  const f = fixture();
  try { await assert.rejects(runSuiteFiles([f.one], 7 as never), TypeError); assert.deepEqual(f.state.events, []); }
  finally { f.cleanup(); }
});

test('missing runSuite export is a typed error, not a passing empty test', async () => {
  const f = fixture(); writeFileSync(f.one, 'export const value = 7;');
  try { await assert.rejects(runSuiteFiles([f.one]), error => (error as {code:string}).code === 'VERIFY-BUILD-002'); }
  finally { f.cleanup(); }
});
