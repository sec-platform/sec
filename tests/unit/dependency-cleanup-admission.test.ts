import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { cleanDependencyEnvironment } from '../../src/adapters/toolchain/dependencies/application/dependency-environment.ts';

async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-cleanup-admission-'));
  try {
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.writeFile(path.join(root, 'node_modules', 'keep'), 'keep');
    await fs.writeFile(path.join(root, '.runtime-deps.stamp.json'), 'keep');
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('invalid cleanup selection is rejected before any project Effect', async () => fixture(async (root) => {
  await assert.rejects(
    cleanDependencyEnvironment(root, { project: true, materializations: 'false' as never }),
    /boolean/
  );
  assert.equal(await fs.readFile(path.join(root, 'node_modules', 'keep'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(root, '.runtime-deps.stamp.json'), 'utf8'), 'keep');
}));

test('force is only a compatibility flag and does not coerce invalid selection', async () => fixture(async (root) => {
  await assert.rejects(
    cleanDependencyEnvironment(root, { project: 'false' as never, force: true }),
    /boolean/
  );
  assert.equal(await fs.readFile(path.join(root, 'node_modules', 'keep'), 'utf8'), 'keep');
}));

test('an empty cleanup is a zero-Effect operation', async () => fixture(async (root) => {
  assert.deepEqual(await cleanDependencyEnvironment(root, {}), []);
  assert.equal(await fs.readFile(path.join(root, 'node_modules', 'keep'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(root, '.runtime-deps.stamp.json'), 'utf8'), 'keep');
}));
