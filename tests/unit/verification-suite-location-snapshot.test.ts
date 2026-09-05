import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import { runSuiteFiles } from '../../src/compiler/verify/run-suite-files.ts';

type FixtureState = { visited: string[]; entered: () => void; pending: Promise<void> };
async function fixture(run: (root: string, alternate: string, state: FixtureState, key: string) => Promise<void>): Promise<void> {
  const cwd = process.cwd();
  const root = await mkdtemp(path.join(tmpdir(), 'sec-suite-location-'));
  const alternate = path.join(root, 'other');
  await mkdir(alternate);
  const key = `secSuiteLocation:${randomUUID()}`;
  const state: FixtureState = { visited: [], entered: () => {}, pending: Promise.resolve() };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = state;
  try { await run(root, alternate, state, key); }
  finally {
    process.chdir(cwd);
    delete globals[key];
    await rm(root, { recursive: true, force: true });
  }
}

async function suites(root: string, alternate: string, key: string, firstBody = ''): Promise<void> {
  const state = `globalThis[${JSON.stringify(key)}]`;
  await writeFile(path.join(root, 'first.mjs'), `export async function runSuite() { ${state}.visited.push('first'); ${firstBody} }`);
  await writeFile(path.join(root, 'next.mjs'), `export function runSuite() { ${state}.visited.push('selected'); }`);
  await writeFile(path.join(alternate, 'next.mjs'), `export function runSuite() { ${state}.visited.push('redirected'); }`);
}

test('a suite changing cwd cannot redirect a later relative suite', async () => {
  await fixture(async (root, alternate, state, key) => {
    await suites(root, alternate, key, `process.chdir(${JSON.stringify(alternate)});`);
    process.chdir(root);
    await runSuiteFiles(['./first.mjs', './next.mjs']);
    assert.deepEqual(state.visited, ['first', 'selected']);
  });
});

test('a reporting callback changing cwd cannot redirect a later relative suite', async () => {
  await fixture(async (root, alternate, state, key) => {
    await suites(root, alternate, key);
    process.chdir(root);
    const labels: string[] = [];
    await runSuiteFiles(['first.mjs', './next.mjs'], (file) => {
      labels.push(file);
      process.chdir(alternate);
    });
    assert.deepEqual(state.visited, ['first', 'selected']);
    assert.deepEqual(labels, ['first.mjs', './next.mjs']);
  });
});

test('caller cwd changes while the first suite is suspended do not change captured locations', async () => {
  await fixture(async (root, alternate, state, key) => {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    state.entered = enter;
    state.pending = new Promise<void>((resolve) => { release = resolve; });
    const fixtureState = `globalThis[${JSON.stringify(key)}]`;
    await suites(root, alternate, key, `${fixtureState}.entered(); await ${fixtureState}.pending;`);
    process.chdir(root);
    const running = runSuiteFiles(['first.mjs', 'next.mjs']);
    try {
      await entered;
      process.chdir(alternate);
    } finally { release(); }
    await running;
    assert.deepEqual(state.visited, ['first', 'selected']);
  });
});

test('an originally missing relative suite does not become a different existing suite after chdir', async () => {
  await fixture(async (root, alternate, state, key) => {
    await suites(root, alternate, key, `process.chdir(${JSON.stringify(alternate)});`);
    await rm(path.join(root, 'next.mjs'));
    process.chdir(root);
    await assert.rejects(runSuiteFiles(['first.mjs', 'next.mjs']));
    assert.deepEqual(state.visited, ['first']);
  });
});

test('absolute paths and serial reporting keep their existing behavior', async () => {
  await fixture(async (root, alternate, state, key) => {
    await suites(root, alternate, key, `process.chdir(${JSON.stringify(alternate)});`);
    const files = [path.join(root, 'first.mjs'), path.join(root, 'next.mjs')];
    const labels: string[] = [];
    await runSuiteFiles(files, (file) => { labels.push(file); });
    assert.deepEqual(state.visited, ['first', 'selected']);
    assert.deepEqual(labels, files);
  });
});

test('URL-special characters in a selected filename remain path characters', async () => {
  await fixture(async (root, _alternate, state, key) => {
    const name = 'hash#space % unicode-中.mjs';
    await writeFile(path.join(root, name), `export function runSuite() { globalThis[${JSON.stringify(key)}].visited.push('exact'); }`);
    process.chdir(root);
    const passed: string[] = [];
    await runSuiteFiles([name], (file) => { passed.push(file); });
    assert.deepEqual(state.visited, ['exact']);
    assert.deepEqual(passed, [name]);
  });
});

test('a failing selected suite stops the suffix and is not reported as passed', async () => {
  await fixture(async (root, alternate, state, key) => {
    await suites(root, alternate, key, 'throw new Error("stop here");');
    process.chdir(root);
    const labels: string[] = [];
    await assert.rejects(runSuiteFiles(['first.mjs', 'next.mjs'], (file) => { labels.push(file); }), /stop here/);
    assert.deepEqual(state.visited, ['first']);
    assert.deepEqual(labels, []);
  });
});

test('capturing locations does not turn an invalid module export into success', async () => {
  await fixture(async (root, _alternate, _state, _key) => {
    await writeFile(path.join(root, 'invalid.mjs'), 'export const runSuite = false;');
    process.chdir(root);
    await assert.rejects(runSuiteFiles(['invalid.mjs']), (error: unknown) => {
      assert.equal((error as { code: string }).code, 'VERIFY-BUILD-002');
      assert.match((error as Error).message, /invalid\.mjs/);
      return true;
    });
  });
});
