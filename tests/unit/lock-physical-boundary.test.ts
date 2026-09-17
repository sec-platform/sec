import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { LockFile } from '../../src/compiler/contract.ts';
import { readLockFile, saveLock, writeLockWithGeneratedPaths } from "../../src/adapters/workspace/lock.ts";
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { semanticArtifactLock } from '../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function lockFixture() {
  return semanticArtifactLock('generated/lock-physical-boundary.ts');
}

test('canonical Lock publication creates retained artifact state and round-trips exact authority', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lock = lockFixture();
    await fs.mkdir(path.join(workspaceRoot, '.sec'), { recursive: true });
    await saveLock(workspaceRoot, lock);

    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
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
    await expect(fs.stat(path.join(workspaceRoot, '.sec'))).rejects.toMatchObject({ code: 'ENOENT' });

    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
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
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const lock = lockFixture();
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'external-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    await fs.symlink(path.join(workspaceRoot, 'external-lock.json'), lockPath, 'file');

    expect(() => readLockFile(workspaceRoot))
      .toThrow(expect.objectContaining({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' }));
  });
});

test('canonical Lock publication refuses a linked .sec ancestor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalSec = path.join(workspaceRoot, 'external-sec');
    await fs.mkdir(externalSec, { recursive: true });
    await fs.symlink(
      externalSec,
      path.join(workspaceRoot, '.sec'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(saveLock(workspaceRoot, lockFixture()))
      .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
    expect(await fs.readdir(externalSec)).toEqual([]);
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
