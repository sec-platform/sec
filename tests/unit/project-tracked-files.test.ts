import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCommand } from '../../src/runtime-state/physical/runtime/process.ts';
import { listTrackedProjectPaths } from '../../src/workspace/runtime/project-tracked-files.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

async function withIsolatedTempDirectory<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-tracked-project-'));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('tracked project observation returns null only for an actual non-repository workspace', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(path.dirname(REPOSITORY_ROOT), 'sec-tracked-nonrepo-'));
  try {
    expect(await listTrackedProjectPaths(workspaceRoot)).toBeNull();
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('tracked project observation returns exact NUL-delimited Git-indexed project paths', async () => {
  await withIsolatedTempDirectory(async (workspaceRoot) => {
    const init = await runCommand('git', ['init', '--quiet'], { cwd: workspaceRoot });
    expect(init.code).toBe(0);

    const trackedPaths = process.platform === 'win32'
      ? ['tracked.txt', 'space name.txt']
      : ['tracked.txt', 'line\nbreak.txt'];
    for (const relativePath of trackedPaths) {
      const workspaceFile = path.join(workspaceRoot, relativePath);
      await fs.mkdir(path.dirname(workspaceFile), { recursive: true });
      await fs.writeFile(workspaceFile, 'tracked\n', 'utf8');
      const add = await runCommand('git', ['add', '--', relativePath], { cwd: workspaceRoot });
      expect(add.code).toBe(0);
    }

    expect(await listTrackedProjectPaths(workspaceRoot)).toEqual(new Set(trackedPaths));
  });
});

test('tracked project observation propagates a corrupt Git index instead of treating it as untracked', async () => {
  await withIsolatedTempDirectory(async (workspaceRoot) => {
    const init = await runCommand('git', ['init', '--quiet'], { cwd: workspaceRoot });
    expect(init.code).toBe(0);
    await fs.writeFile(path.join(workspaceRoot, '.git', 'index'), 'not-a-git-index', 'utf8');

    await expect(listTrackedProjectPaths(workspaceRoot))
      .rejects.toThrow('Unable to observe tracked project paths');
  });
});

test('tracked project observation canonicalizes its root and fails closed when provider admission is unavailable', async () => {
  await withIsolatedTempDirectory(async (workspaceRoot) => {
    const init = await runCommand('git', ['init', '--quiet'], { cwd: workspaceRoot });
    expect(init.code).toBe(0);
    await fs.writeFile(path.join(workspaceRoot, 'tracked.txt'), 'tracked\n', 'utf8');
    const add = await runCommand('git', ['add', '--', 'tracked.txt'], { cwd: workspaceRoot });
    expect(add.code).toBe(0);

    const relativeRoot = path.relative(process.cwd(), workspaceRoot);
    expect(await listTrackedProjectPaths(relativeRoot)).toEqual(new Set(['tracked.txt']));
  });

  const unavailableRoot = path.join(os.tmpdir(), `sec-tracked-provider-absent-${crypto.randomUUID()}`);
  await expect(listTrackedProjectPaths(unavailableRoot)).rejects.toMatchObject({
    name: 'GitReadAuthorityError',
    message: 'Git read provider is unavailable.',
    failure: {
      kind: 'unresolved-git-read-provider',
      status: 'unavailable'
    }
  });
  await expect(fs.lstat(unavailableRoot)).rejects.toMatchObject({ code: 'ENOENT' });
});
