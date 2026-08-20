import { lstat, mkdir, mkdtemp, readdir, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  acquireWindowsBrowserLaunchHostAuthorityForTests,
  proveWindowsHostDirectoryAuthorityForTests
} from '../../platform/shared/windows-host-filesystem-authority.ts';

test.skipIf(process.platform !== 'win32')(
  'Windows browser launch host acquisition removes its private root when ACL hardening fails',
  async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-acquire-failure-'));
  try {
    await expect(acquireWindowsBrowserLaunchHostAuthorityForTests(
      root,
      async (_directoryPath, mode) => {
        expect(mode).toBe('harden');
        throw new Error('synthetic-acl-hardening-failure');
      }
    )).rejects.toThrow('synthetic-acl-hardening-failure');
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows browser launch host acquisition rejects a no-op cleanup with exact residue evidence',
  async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-noop-cleanup-'));
  try {
    const result = await acquireWindowsBrowserLaunchHostAuthorityForTests(
      root,
      async () => {
        throw new Error('synthetic-acl-hardening-failure');
      },
      async () => undefined
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors.map((error) => (
      error instanceof Error ? error.message : String(error)
    ))).toEqual([
      'synthetic-acl-hardening-failure',
      'Windows host directory authority cleanup did not remove the private root'
    ]);
    expect(await readdir(root)).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows browser launch host acquisition preserves a replacement directory',
  async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-replacement-'));
  let replacementPath = '';
  try {
    const result = await acquireWindowsBrowserLaunchHostAuthorityForTests(
      root,
      async (directoryPath) => {
        replacementPath = directoryPath;
        await rmdir(directoryPath);
        await mkdir(directoryPath);
        throw new Error('synthetic-post-replacement-failure');
      }
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors.map((error) => (
      error instanceof Error ? error.message : String(error)
    ))).toEqual([
      'synthetic-post-replacement-failure',
      'Windows host directory authority changed before cleanup'
    ]);
    expect(await readdir(root)).toEqual([path.basename(replacementPath)]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows browser launch host acquisition never issues authority for a harden-time replacement',
  async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-harden-replacement-'));
  let replacementPath = '';
  try {
    const result = await acquireWindowsBrowserLaunchHostAuthorityForTests(
      root,
      async (directoryPath) => {
        replacementPath = directoryPath;
        await rmdir(directoryPath);
        await mkdir(directoryPath);
        return {
          aclDigest: 'sha256:replacement',
          ownerSid: 'S-1-5-21-replacement'
        };
      }
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors.map((error) => (
      error instanceof Error ? error.message : String(error)
    ))).toEqual([
      'Windows host directory authority changed during ACL hardening',
      'Windows host directory authority changed before cleanup'
    ]);
    expect(await readdir(root)).toEqual([path.basename(replacementPath)]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows browser launch host release proves the exact private root is absent',
  async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-release-'));
  try {
    const authority = await acquireWindowsBrowserLaunchHostAuthorityForTests(
      root,
      async () => ({
        aclDigest: 'sha256:stable',
        ownerSid: 'S-1-5-21-stable'
      })
    );
    const privateRoot = authority.rootPath;
    await authority.release();
    const error = await lstat(privateRoot).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toMatchObject({ code: 'ENOENT' });
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows browser launch host acquisition preserves primary and cleanup failures',
  async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-cleanup-failure-'));
  try {
    const result = await acquireWindowsBrowserLaunchHostAuthorityForTests(
      root,
      async () => {
        throw new Error('synthetic-acl-hardening-failure');
      },
      async () => {
        throw new Error('synthetic-private-root-cleanup-failure');
      }
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors.map((error) => (
      error instanceof Error ? error.message : String(error)
    ))).toEqual([
      'synthetic-acl-hardening-failure',
      'synthetic-private-root-cleanup-failure'
    ]);
    expect(await readdir(root)).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  }
);

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
