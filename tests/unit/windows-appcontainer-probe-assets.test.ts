import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  loadWindowsAppContainerProbeAssetSet,
  stageWindowsAppContainerProbeAssetSet,
  WindowsAppContainerProbeAssetError,
  windowsAppContainerProbeAssetRelativePath
} from '../../src/adapters/runtime-state/physical/runtime/windows-appcontainer/probe-assets.ts';

test('Windows AppContainer stages one immutable, physically read-back probe asset set', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-appcontainer-probe-assets-'));
  try {
    const loaded = await loadWindowsAppContainerProbeAssetSet();
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.roles)).toBe(true);
    expect(loaded.setDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

    let fences = 0;
    const staged = await stageWindowsAppContainerProbeAssetSet(root, loaded, async () => {
      fences += 1;
    });
    expect(staged).toEqual({ setDigest: loaded.setDigest, roles: loaded.roles });
    expect(Object.isFrozen(staged)).toBe(true);
    expect(fences).toBeGreaterThan(loaded.roles.length);

    for (const role of loaded.roles) {
      const assetPath = path.join(root, windowsAppContainerProbeAssetRelativePath(role));
      const metadata = await lstat(assetPath);
      expect(metadata.isFile()).toBe(true);
      expect(metadata.isSymbolicLink()).toBe(false);
      expect((await readFile(assetPath)).byteLength).toBeGreaterThan(0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows AppContainer asset conflict is typed and removes only files created by that attempt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-appcontainer-probe-conflict-'));
  try {
    const loaded = await loadWindowsAppContainerProbeAssetSet();
    const firstPath = path.join(root, windowsAppContainerProbeAssetRelativePath(loaded.roles[0]!));
    const conflictPath = path.join(root, windowsAppContainerProbeAssetRelativePath(loaded.roles[1]!));
    const foreign = Buffer.from('foreign-owned-probe-asset', 'utf8');
    await mkdir(path.dirname(conflictPath), { recursive: true });
    await writeFile(conflictPath, foreign, { flag: 'wx' });

    const failure = await stageWindowsAppContainerProbeAssetSet(root, loaded, async () => undefined)
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(WindowsAppContainerProbeAssetError);
    expect((failure as WindowsAppContainerProbeAssetError).failure).toBe('stage-conflict');
    await expect(lstat(firstPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(conflictPath)).toEqual(foreign);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
