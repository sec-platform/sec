import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CompilerError } from '../../src/compiler/errors.ts';
import { runSuiteFiles } from '../../src/compiler/verify/run-suite-files.ts';

type FixtureState = {
  events: string[];
  evaluations: number;
  mutate?: () => void;
  failure: Error;
};

async function fixture(
  run: (input: {
    root: string;
    state: FixtureState;
    module: (name: string, body: string) => Promise<string>;
  }) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-suite-loader-'));
  const key = `sec-suite-loader-${randomUUID()}`;
  const globals = globalThis as unknown as Record<string, unknown>;
  const state: FixtureState = { events: [], evaluations: 0, failure: new Error('suite failure') };
  globals[key] = state;
  try {
    await run({ root, state, module: async (name, body) => {
      const file = path.join(root, name);
      await writeFile(file, `const state = globalThis[${JSON.stringify(key)}];\n${body}\n`);
      return file;
    } });
  } finally {
    delete globals[key];
    await rm(root, { recursive: true, force: true });
  }
}

test('an empty captured inventory succeeds', async () => {
  await runSuiteFiles([]);
});

test('suites run serially in supplied inventory order and await completion', async () => {
  await fixture(async ({ module, state }) => {
    const first = await module('z.mjs', `export async function runSuite() {
      state.events.push('first-start'); await Promise.resolve(); state.events.push('first-end');
    }`);
    const second = await module('a.mjs', `export function runSuite() { state.events.push('second'); }`);
    await runSuiteFiles([first, second]);
    assert.deepEqual(state.events, ['first-start', 'first-end', 'second']);
  });
});

test('each invocation reevaluates the entry module even with a frozen wall clock', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('cached.mjs', `state.evaluations++; export function runSuite() {}`);
    const now = Date.now;
    Date.now = () => 1234;
    try {
      await runSuiteFiles([file]);
      await runSuiteFiles([file]);
      assert.equal(state.evaluations, 2);
    } finally {
      Date.now = now;
    }
  });
});

test('entry module edits are visible in a later invocation at the same wall-clock time', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('edited.mjs', `export function runSuite() { state.events.push('old'); }`);
    const now = Date.now;
    Date.now = () => 1234;
    try {
      await runSuiteFiles([file]);
      await module('edited.mjs', `export function runSuite() { state.events.push('new'); }`);
      await runSuiteFiles([file]);
      assert.deepEqual(state.events, ['old', 'new']);
    } finally {
      Date.now = now;
    }
  });
});

test('concurrent invocations do not share an entry-module cache key', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('concurrent.mjs', `state.evaluations++; export async function runSuite() {
      await Promise.resolve(); state.events.push('done');
    }`);
    await Promise.all([runSuiteFiles([file]), runSuiteFiles([file])]);
    assert.equal(state.evaluations, 2);
    assert.deepEqual(state.events, ['done', 'done']);
  });
});

test('unselected files are not implicitly discovered or executed', async () => {
  await fixture(async ({ module, state }) => {
    const selected = await module('selected.mjs', `export function runSuite() { state.events.push('selected'); }`);
    await module('unselected.mjs', `throw new Error('must not be imported');`);
    await runSuiteFiles(Object.freeze([selected]));
    assert.deepEqual(state.events, ['selected']);
  });
});

test('caller mutation after invocation cannot replace or append selected files', async () => {
  await fixture(async ({ module, state }) => {
    const first = await module('first.mjs', `export function runSuite() { state.mutate(); state.events.push('first'); }`);
    const second = await module('second.mjs', `export function runSuite() { state.events.push('second'); }`);
    const other = await module('other.mjs', `export function runSuite() { state.events.push('other'); }`);
    const inventory = [first, second];
    state.mutate = () => inventory.splice(1, 1, other, other);
    await runSuiteFiles(inventory);
    assert.deepEqual(state.events, ['first', 'second']);
  });
});

test('invalid suite exports preserve the typed failure and stop later entries', async () => {
  await fixture(async ({ module, state }) => {
    const invalid = await module('invalid.mjs', `export const runSuite = true;`);
    const later = await module('later.mjs', `state.evaluations++; export function runSuite() {}`);
    await assert.rejects(runSuiteFiles([invalid, later]), (error: unknown) =>
      error instanceof CompilerError && error.code === 'VERIFY-BUILD-002' && error.message.includes(invalid));
    assert.equal(state.evaluations, 0);
  });
});

test('a missing suite export is rejected', async () => {
  await fixture(async ({ module }) => {
    const file = await module('missing-export.mjs', `export const unrelated = 1;`);
    await assert.rejects(runSuiteFiles([file]), (error: unknown) =>
      error instanceof CompilerError && error.code === 'VERIFY-BUILD-002');
  });
});

test('a synchronous suite exception preserves its identity and stops later entries', async () => {
  await fixture(async ({ module, state }) => {
    const failing = await module('failing.mjs', `export function runSuite() { throw state.failure; }`);
    const later = await module('later.mjs', `state.evaluations++; export function runSuite() {}`);
    await assert.rejects(runSuiteFiles([failing, later]), (error: unknown) => error === state.failure);
    assert.equal(state.evaluations, 0);
  });
});

test('an asynchronous suite rejection preserves its identity', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('rejecting.mjs', `export async function runSuite() { await Promise.resolve(); throw state.failure; }`);
    await assert.rejects(runSuiteFiles([file]), (error: unknown) => error === state.failure);
  });
});

test('module evaluation errors are not hidden as missing-export errors', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('evaluation-error.mjs', `throw state.failure; export function runSuite() {}`);
    await assert.rejects(runSuiteFiles([file]), (error: unknown) => error === state.failure);
  });
});

test('a captured file removed before loading is not silently skipped', async () => {
  await fixture(async ({ module }) => {
    const file = await module('removed.mjs', `export function runSuite() {}`);
    await rm(file);
    await assert.rejects(runSuiteFiles([file]));
  });
});

test('file URL escaping preserves spaces, Unicode, hash and percent characters', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('空 格#100%.mjs', `export function runSuite() { state.events.push('escaped'); }`);
    await runSuiteFiles([file]);
    assert.deepEqual(state.events, ['escaped']);
  });
});


test('suite progress retains the passed prefix without claiming an unrun suffix', async () => {
  await fixture(async ({ module, state }) => {
    const first = await module('passed.mjs', `export async function runSuite() { await Promise.resolve(); state.events.push('passed'); }`);
    const failing = await module('failed.mjs', `export function runSuite() { throw state.failure; }`);
    const later = await module('unrun.mjs', `state.evaluations++; export function runSuite() {}`);
    const passed: string[] = [];
    const inventory = [first, failing, later];
    await assert.rejects(runSuiteFiles(inventory, (file) => { passed.push(file); }),
      (error: unknown) => error === state.failure);
    assert.deepEqual(passed, [first]);
    assert.equal(inventory[passed.length], failing);
    assert.equal(state.evaluations, 0);
  });
});

test('suite progress is recorded only after asynchronous work finishes', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('progress.mjs', `export async function runSuite() {
      state.events.push('start'); await Promise.resolve(); state.events.push('end');
    }`);
    await runSuiteFiles([file], () => { state.events.push('reported'); });
    assert.deepEqual(state.events, ['start', 'end', 'reported']);
  });
});

test('module evaluation failure cannot emit a passed-suite observation', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('load-failed.mjs', `throw state.failure; export function runSuite() {}`);
    const passed: string[] = [];
    await assert.rejects(runSuiteFiles([file], (value) => { passed.push(value); }),
      (error: unknown) => error === state.failure);
    assert.deepEqual(passed, []);
  });
});

test('suite observer failures propagate and stop subsequent side effects', async () => {
  await fixture(async ({ module, state }) => {
    const first = await module('first-observed.mjs', `export function runSuite() { state.events.push('first'); }`);
    const second = await module('unobserved.mjs', `state.evaluations++; export function runSuite() {}`);
    await assert.rejects(runSuiteFiles([first, second], () => { throw state.failure; }),
      (error: unknown) => error === state.failure);
    assert.deepEqual(state.events, ['first']);
    assert.equal(state.evaluations, 0);
  });
});


test('independently loaded suite loaders cannot collide on equal local revision counters', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('multi-loader.mjs', `state.evaluations++; export function runSuite() {}`);
    const loaderUrl = new URL('../../src/compiler/verify/run-suite-files.ts', import.meta.url);
    loaderUrl.searchParams.set('instance', randomUUID());
    const first = await import(loaderUrl.href) as { runSuiteFiles: typeof runSuiteFiles };
    loaderUrl.searchParams.set('instance', randomUUID());
    const second = await import(loaderUrl.href) as { runSuiteFiles: typeof runSuiteFiles };
    await first.runSuiteFiles([file]);
    await second.runSuiteFiles([file]);
    assert.equal(state.evaluations, 2);
  });
});

test('concurrent loader module instances observe their own fresh entry evaluations', async () => {
  await fixture(async ({ module, state }) => {
    const file = await module('concurrent-loaders.mjs', `state.evaluations++; export async function runSuite() {
      await Promise.resolve(); state.events.push('done');
    }`);
    const loaderUrl = new URL('../../src/compiler/verify/run-suite-files.ts', import.meta.url);
    loaderUrl.hash = randomUUID();
    const first = await import(loaderUrl.href) as { runSuiteFiles: typeof runSuiteFiles };
    loaderUrl.hash = randomUUID();
    const second = await import(loaderUrl.href) as { runSuiteFiles: typeof runSuiteFiles };
    await Promise.all([first.runSuiteFiles([file]), second.runSuiteFiles([file])]);
    assert.equal(state.evaluations, 2);
    assert.deepEqual(state.events, ['done', 'done']);
  });
});
