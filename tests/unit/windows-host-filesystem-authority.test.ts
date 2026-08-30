import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  proveWindowsHostDirectoryAuthorityForTests
} from '../../src/runtime-state/physical/test/windows-host-filesystem.ts';

test.skipIf(process.platform !== 'win32')(
  'Windows host directory authority revalidates exact owner, ACL and directory identity',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-authority-'));
    const authorityRoot = path.join(root, 'local-app-data');
    await mkdir(authorityRoot);
    let aclDigest = `sha256:${'a'.repeat(64)}`;
    try {
      const authority = await proveWindowsHostDirectoryAuthorityForTests(
        authorityRoot,
        async () => ({
          aclDigest,
          ownerSid: 'S-1-5-21-1000'
        })
      );
      expect(authority.rootPath).toBe(path.resolve(authorityRoot));
      await authority.assertCurrent();
      aclDigest = `sha256:${'b'.repeat(64)}`;
      await expect(authority.assertCurrent()).rejects.toThrow(
        'Windows host directory authority changed'
      );
      expect(await readdir(authorityRoot)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows host directory authority rejects a physical root whose ACL proof is untrusted',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-untrusted-'));
    try {
      await expect(proveWindowsHostDirectoryAuthorityForTests(
        root,
        async () => {
          throw new Error('untrusted-writer:S-1-1-0');
        }
      )).rejects.toThrow('untrusted-writer:S-1-1-0');
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
