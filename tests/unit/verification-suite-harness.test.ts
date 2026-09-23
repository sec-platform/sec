import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { captureFastSuiteProcessInput, type FastSuiteProcessInput } from '../../src/adapters/verification/fast-suite-input.ts';
import { runSuiteProcesses } from '../../src/adapters/verification/run-suite-processes.ts';

async function fixture(source: string, consume: (input: FastSuiteProcessInput) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-suite-harness-'));
  const suiteRoot = path.join(root, 'tests', 'unit');
  const file = path.join(suiteRoot, 'candidate.test.ts');
  try {
    await mkdir(suiteRoot, { recursive: true });
    await writeFile(file, source);
    await consume({ workspaceRoot: root, suiteRoot, files: [file] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('candidate top-level Reflect.apply replacement cannot skip its failing runSuite', async () => {
  await fixture(`
    Reflect.apply = () => undefined;
    export function runSuite() { throw new Error('suite must execute'); }
  `, async input => {
    const passed: string[] = [];
    await expect(runSuiteProcesses({ ...input, onSuitePassed: file => passed.push(file) }))
      .rejects.toMatchObject({ code: 'VERIFY-BUILD-007' });
    expect(passed).toEqual([]);
  });
});

test('candidate inherited toJSON cannot intercept the terminal receipt', async () => {
  await fixture(`
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value() { throw new Error('candidate serializer hook must not run'); }
    });
    export function runSuite() {}
  `, async input => {
    const passed: string[] = [];
    await runSuiteProcesses({ ...input, onSuitePassed: file => passed.push(file) });
    expect(passed).toEqual([...input.files]);
  });
});

test('candidate stdout stream wrappers do not own terminal publication', async () => {
  await fixture(`
    export function runSuite() {
      process.stdout.write = () => true;
      process.stdout._write = (_chunk, _encoding, callback) => callback();
    }
  `, async input => {
    await expect(runSuiteProcesses(input)).resolves.toBeUndefined();
  });
});

test('candidate error accessors cannot terminate the harness during failure projection', async () => {
  await fixture(`
    export function runSuite() {
      const failure = new Error('failure');
      Object.defineProperty(failure, 'message', { get() { process.exit(0); } });
      throw failure;
    }
  `, async input => {
    await expect(runSuiteProcesses(input)).rejects.toMatchObject({ code: 'VERIFY-BUILD-007' });
  });
});

test('suite invocation capture snapshots paths and callbacks without freezing caller data', () => {
  const files = ['tests/unit/first.test.ts'];
  const callback = (_file: string) => {};
  const input = { workspaceRoot: '.', suiteRoot: 'tests/unit', files, onSuitePassed: callback };
  const captured = captureFastSuiteProcessInput(input);
  files[0] = 'tests/unit/changed.test.ts';
  input.workspaceRoot = '/changed';
  expect(captured.workspaceRoot).toBe('.');
  expect(captured.files).toEqual(['tests/unit/first.test.ts']);
  expect(captured.onSuitePassed).toBe(callback);
  expect(Object.isFrozen(captured)).toBe(true);
  expect(Object.isFrozen(captured.files)).toBe(true);
  expect(Object.isFrozen(files)).toBe(false);
});

test('suite invocation capture rejects proxies and getters without invoking them', () => {
  let calls = 0;
  const input = { workspaceRoot: '.', suiteRoot: 'tests/unit', files: ['tests/unit/a.test.ts'] };
  const proxy = new Proxy(input, { get() { calls += 1; throw new Error('get trap'); } });
  const filesProxy = new Proxy(input.files, {
    getOwnPropertyDescriptor() { calls += 1; throw new Error('descriptor trap'); }
  });
  const getter = Object.defineProperty({ ...input }, 'files', {
    get() { calls += 1; throw new Error('getter'); }
  });
  expect(() => captureFastSuiteProcessInput(proxy)).toThrow();
  expect(() => captureFastSuiteProcessInput({ ...input, files: filesProxy })).toThrow();
  expect(() => captureFastSuiteProcessInput(getter)).toThrow();
  expect(calls).toBe(0);
});

test('suite invocation capture rejects sparse, accessor and over-budget inventories', () => {
  const input = { workspaceRoot: '.', suiteRoot: 'tests/unit', files: [] as string[] };
  let calls = 0;
  const accessor = Object.defineProperty(['placeholder'], '0', { get() { calls += 1; return 'tests/unit/a.test.ts'; } });
  for (const files of [Array<string>(1), Array<string>(10_001), accessor, ['a'.repeat(16 * 1024 + 1)]]) {
    expect(() => captureFastSuiteProcessInput({ ...input, files })).toThrow();
  }
  expect(calls).toBe(0);
});


test('suite invocation capture preserves only admitted workspace input modes', () => {
  const base = {
    workspaceRoot: '.',
    suiteRoot: 'tests/unit',
    files: ['tests/unit/a.test.ts']
  };
  expect(captureFastSuiteProcessInput({
    ...base,
    workspaceInputMode: 'sealed-generation'
  }).workspaceInputMode).toBe('sealed-generation');
  expect(captureFastSuiteProcessInput({
    ...base,
    workspaceInputMode: 'live-workspace'
  }).workspaceInputMode).toBe('live-workspace');
  expect(() => captureFastSuiteProcessInput({
    ...base,
    workspaceInputMode: 'foreign-generation' as never
  })).toThrow('workspace input mode');
});
