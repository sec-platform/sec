import { expect, test } from 'bun:test';
import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { snapshotWorkspace } from '../../src/adapters/upgrade/workspace-snapshot.ts';

test('upgrade snapshot rejects hard-linked workspace inputs before reporting a restorable preimage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-upgrade-hardlink-'));
  const source = path.join(root, 'source.txt');
  const alias = path.join(root, 'alias.txt');
  try {
    await mkdir(path.join(root, '.sec'));
    await writeFile(source, 'shared\n');
    await link(source, alias);

    await expect(snapshotWorkspace(
      root,
      path.join(root, '.sec', 'upgrade.lock'),
      async () => undefined
    )).rejects.toThrow('another hard-link name');

    expect(await readFile(source, 'utf8')).toBe('shared\n');
    expect(await readFile(alias, 'utf8')).toBe('shared\n');
    const [sourceStat, aliasStat] = await Promise.all([stat(source), stat(alias)]);
    expect(sourceStat.ino).toBe(aliasStat.ino);
    expect(sourceStat.nlink).toBeGreaterThan(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
