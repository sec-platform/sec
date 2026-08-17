import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { listTrackedProjectPaths } from '../../platform/shared/project-tracked-files.ts';
import { runCommand } from '../../platform/shared/process.ts';

async function withIsolatedTempDirectory<T>(callback: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-tracked-project-'));
  try {
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('tracked project observation returns null only for an actual non-repository workspace', async () => {
  await withIsolatedTempDirectory(async (workspaceRoot) => {
    expect(await listTrackedProjectPaths(workspaceRoot)).toBeNull();
  });
});

test('tracked project observation returns the exact Git-indexed project paths', async () => {
  await withIsolatedTempDirectory(async (workspaceRoot) => {
    const init = await runCommand('git', ['init', '--quiet'], { cwd: workspaceRoot });
    expect(init.code).toBe(0);

    const projectFile = path.join(workspaceRoot, 'project', 'tracked.txt');
    await fs.mkdir(path.dirname(projectFile), { recursive: true });
    await fs.writeFile(projectFile, 'tracked\n', 'utf8');
    const add = await runCommand('git', ['add', '--', 'project/tracked.txt'], { cwd: workspaceRoot });
    expect(add.code).toBe(0);

    expect(await listTrackedProjectPaths(workspaceRoot)).toEqual(new Set(['tracked.txt']));
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
