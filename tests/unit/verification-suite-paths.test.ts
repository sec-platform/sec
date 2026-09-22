import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSuiteFiles } from '../../src/adapters/verification/run-suite-files.ts';

test('fresh entry identities retain literal filename characters and relative imports', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-suite-paths-'));
  const key = `sec-suite-paths-${randomUUID()}`;
  const state = { evaluations: 0, events: [] as string[] };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals[key] = state;
  try {
    await writeFile(path.join(root, 'sibling.mjs'), 'export const value = 7;');
    for (const name of ['with space.mjs', 'hash#name.mjs', 'percent%name.mjs', '入口.mjs']) {
      const file = path.join(root, name);
      await writeFile(file, `import { value } from './sibling.mjs';
        const state = globalThis[${JSON.stringify(key)}];
        state.evaluations++; export function runSuite() { state.events.push(String(value)); }`);
      const before = state.evaluations;
      await runSuiteFiles([file]);
      await runSuiteFiles([file]);
      assert.equal(state.evaluations - before, 2);
    }
    assert.deepEqual(state.events, Array(8).fill('7'));
  } finally {
    delete globals[key];
    await rm(root, { recursive: true, force: true });
  }
});
