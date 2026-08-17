import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  ensureDir,
  pathEntryExists,
  pathExists
} from '../../platform/shared/fs.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('path entry existence is distinct from target reachability for dangling links', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const missingTarget = path.join(workspaceRoot, 'missing-target.txt');
    const linkPath = path.join(workspaceRoot, 'dangling.txt');
    await fs.symlink(missingTarget, linkPath, 'file');

    expect(await pathEntryExists(linkPath)).toBe(true);
    expect(await pathExists(linkPath)).toBe(false);
  });
});

test('ensureDir rejects a symbolic-link final entry instead of treating it as an existing directory', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const external = path.join(workspaceRoot, 'external');
    const linked = path.join(workspaceRoot, 'linked');
    await fs.mkdir(external, { recursive: true });
    await fs.symlink(
      external,
      linked,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(ensureDir(linked)).rejects.toThrow('Refusing to use non-ordinary directory target');
  });
});

test('ensureDir re-observes physical state after external removal instead of trusting a process cache', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const directory = path.join(workspaceRoot, 'ephemeral');
    await ensureDir(directory);
    await fs.rm(directory, { recursive: true, force: true });
    expect(await pathEntryExists(directory)).toBe(false);

    await ensureDir(directory);
    expect((await fs.lstat(directory)).isDirectory()).toBe(true);
  });
});
