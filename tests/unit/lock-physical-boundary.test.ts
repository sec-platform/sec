import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { LockFile } from '../../src/compiler/contract.ts';
import {
  readLockFile,
  saveLock,
  writeLockWithGeneratedPaths
} from '../../src/compiler/lock.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
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

test('Lock schema rejects unsupported producers before effects and unknown persisted members before use', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const invalidProducer = {
      ...lockFixture(),
      formatVersion: 'future'
    } as unknown as LockFile;
    await expect(saveLock(workspaceRoot, invalidProducer)).rejects.toThrow('does not match 1');
    await expect(fs.stat(path.join(workspaceRoot, 'control'))).rejects.toMatchObject({ code: 'ENOENT' });

    const { lockPath } = getWorkspacePaths(workspaceRoot);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(
      lockPath,
      `${JSON.stringify({ ...lockFixture(), unexpectedAuthority: true }, null, 2)}\n`,
      'utf8'
    );
    expect(() => readLockFile(workspaceRoot)).toThrow('Unrecognized key');
  });
});

test('unsafe canonical Lock blocks before reading external bytes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { lockPath } = getWorkspacePaths(workspaceRoot);
    const lock = lockFixture();
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'external-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    await fs.symlink(path.join(workspaceRoot, 'external-lock.json'), lockPath, 'file');

    expect(() => readLockFile(workspaceRoot))
      .toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' }));
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

test('Lock publication helpers reject an arbitrary existing path even when its parent is ordinary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const arbitraryRoot = path.join(workspaceRoot, 'ordinary-existing');
    const arbitraryLockPath = path.join(arbitraryRoot, 'graph.lock.json');
    await fs.mkdir(arbitraryRoot, { recursive: true });

    await expect(
      writeLockWithGeneratedPaths(
        arbitraryLockPath,
        lockFixture(),
        ['control/evidence/probe.json']
      )
    ).rejects.toThrow('Refusing non-canonical Lock publication path');
    expect(await fs.readdir(arbitraryRoot)).toEqual([]);
  });
});
