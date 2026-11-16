import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { readLockFile, saveLock } from "../../../src/adapters/workspace/lock.ts";
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { semanticArtifactLock } from '../../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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

test('Lock reader rejects unsupported persisted versions and unknown authority members before use', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(
      lockPath,
      `${JSON.stringify({ ...lockFixture(), formatVersion: 'future' }, null, 2)}\n`,
      'utf8'
    );
    expect(() => readLockFile(workspaceRoot)).toThrow('does not match 1');

    await fs.writeFile(
      lockPath,
      `${JSON.stringify({ ...lockFixture(), unexpectedAuthority: true }, null, 2)}\n`,
      'utf8'
    );
    expect(() => readLockFile(workspaceRoot)).toThrow('Unrecognized key');
  });
});

test('canonical Lock reader rejects a linked file', async () => {
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
