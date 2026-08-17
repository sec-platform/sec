import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { readLockFile, saveLock } from '../../platform/shared/lock-utils.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { semanticArtifactLock } from '../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function lockFixture() {
  return semanticArtifactLock('generated/lock-physical-boundary.ts');
}

test('canonical Lock publication creates retained control/state and round-trips exact authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lock = lockFixture();
    await saveLock(workspaceRoot, lock);

    const { lockPath } = getWorkspacePaths(workspaceRoot);
    expect(JSON.parse(await fs.readFile(lockPath, 'utf8'))).toEqual(lock);
    expect(await readLockFile(workspaceRoot)).toEqual(lock);
  });
});

test('legacy Lock is read only while canonical Lock is physically absent', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { legacyLockPath } = getWorkspacePaths(workspaceRoot);
    const lock = lockFixture();
    await fs.mkdir(path.dirname(legacyLockPath), { recursive: true });
    await fs.writeFile(legacyLockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    expect(await readLockFile(workspaceRoot)).toEqual(lock);
  });
});

test('unsafe canonical Lock blocks legacy fallback', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { lockPath, legacyLockPath } = getWorkspacePaths(workspaceRoot);
    const lock = lockFixture();
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.mkdir(path.dirname(legacyLockPath), { recursive: true });
    await fs.writeFile(legacyLockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'external-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    await fs.symlink(path.join(workspaceRoot, 'external-lock.json'), lockPath, 'file');

    await expect(readLockFile(workspaceRoot))
      .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
  });
});

test('canonical Lock publication refuses a linked control ancestor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalControl = path.join(workspaceRoot, 'external-control');
    await fs.mkdir(externalControl, { recursive: true });
    await fs.symlink(
      externalControl,
      path.join(workspaceRoot, 'control'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(saveLock(workspaceRoot, lockFixture()))
      .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
    expect(await fs.readdir(externalControl)).toEqual([]);
  });
});
