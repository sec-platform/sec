import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  hardenExistingWindowsHostDirectoryAuthority,
  WindowsHostDirectoryAuthorityError
} from '../../src/runtime-state/physical/runtime/windows-host-filesystem-authority.ts';
import {
  observeWindowsAclSessionLifecycleForTests,
  proveWindowsHostDirectoryAuthorityForTests
} from '../../src/runtime-state/physical/test/windows-host-filesystem.ts';
import {
  acquireSecRuntimeStatePhysicalAuthority
} from '../../src/runtime-state/workspace-state/physical-authority.ts';

function windowsRuntimeAuthorityInput(root: string): Readonly<{
  repositoryRoot: string;
  stateRoot: string;
  cacheRoot: string;
  requiredDirectories: readonly string[];
}> {
  return Object.freeze({
    repositoryRoot: path.join(root, 'repository'),
    stateRoot: path.join(root, 'state'),
    cacheRoot: path.join(root, 'cache'),
    requiredDirectories: Object.freeze([])
  });
}

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
  'Windows native host authority hardens and revalidates ACL without a shell provider',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-native-authority-'));
    const authorityRoot = path.join(root, 'state');
    await mkdir(authorityRoot);
    try {
      const authority = await hardenExistingWindowsHostDirectoryAuthority(
        authorityRoot,
        { knownNew: true }
      );
      await authority.assertCurrent();
      expect(authority.rootPath).toBe(path.resolve(authorityRoot));
      await authority.release();
      await expect(authority.assertCurrent()).rejects.toMatchObject({
        failure: 'session-closed'
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows native host authority rejects ACL and physical-object replacement',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-native-drift-'));
    const aclRoot = path.join(root, 'acl');
    const physicalRoot = path.join(root, 'physical');
    await mkdir(aclRoot);
    await mkdir(physicalRoot);
    let aclAuthority: Awaited<ReturnType<typeof hardenExistingWindowsHostDirectoryAuthority>> |
      undefined;
    let physicalAuthority: Awaited<ReturnType<typeof hardenExistingWindowsHostDirectoryAuthority>> |
      undefined;
    try {
      aclAuthority = await hardenExistingWindowsHostDirectoryAuthority(
        aclRoot,
        { knownNew: true }
      );
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot) throw new Error('Windows SystemRoot is unavailable');
      const icacls = Bun.spawnSync([
        path.join(systemRoot, 'System32', 'icacls.exe'),
        aclRoot,
        '/grant',
        '*S-1-1-0:(OI)(CI)(M)'
      ], {
        stderr: 'pipe',
        stdout: 'pipe'
      });
      expect(icacls.exitCode).toBe(0);
      await expect(aclAuthority.assertCurrent()).rejects.toMatchObject({
        failure: 'acl-untrusted'
      });

      physicalAuthority = await hardenExistingWindowsHostDirectoryAuthority(
        physicalRoot,
        { knownNew: true }
      );
      await rm(physicalRoot, { recursive: true, force: true });
      await mkdir(physicalRoot);
      await expect(physicalAuthority.assertCurrent()).rejects.toBeInstanceOf(
        WindowsHostDirectoryAuthorityError
      );
    } finally {
      await aclAuthority?.release();
      await physicalAuthority?.release();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows native host authority fails closed before unavailable or expired admission',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-native-admission-'));
    try {
      const controller = new AbortController();
      controller.abort();
      await expect(hardenExistingWindowsHostDirectoryAuthority(root, {
        signal: controller.signal
      })).rejects.toMatchObject({ failure: 'aborted' });
      await expect(hardenExistingWindowsHostDirectoryAuthority(root, {
        deadlineAtMs: Date.now() - 1
      })).rejects.toMatchObject({ failure: 'deadline-exhausted' });
      await expect(hardenExistingWindowsHostDirectoryAuthority(
        path.join(root, 'missing')
      )).rejects.toBeInstanceOf(WindowsHostDirectoryAuthorityError);
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

test.skipIf(process.platform !== 'win32')(
  'Windows Runtime State authority shares one live generation and releases it after the last capability',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-runtime-generation-'));
    const input = windowsRuntimeAuthorityInput(root);
    await mkdir(input.repositoryRoot);
    await mkdir(input.stateRoot);
    await mkdir(input.cacheRoot);
    const before = observeWindowsAclSessionLifecycleForTests();
    let first: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let second: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let reopened: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    try {
      [first, second] = await Promise.all([
        acquireSecRuntimeStatePhysicalAuthority(input),
        acquireSecRuntimeStatePhysicalAuthority(input)
      ]);
      const shared = observeWindowsAclSessionLifecycleForTests();
      expect(shared.opened - before.opened).toBe(1);
      await first.assertCurrent();
      await second.assertCurrent();

      await first.release();
      await expect(first.assertCurrent()).rejects.toMatchObject({ failure: 'session-closed' });
      await second.assertCurrent();
      expect(observeWindowsAclSessionLifecycleForTests().closed - before.closed).toBe(0);

      await second.release();
      expect(observeWindowsAclSessionLifecycleForTests().closed - before.closed).toBe(1);
      reopened = await acquireSecRuntimeStatePhysicalAuthority(input);
      expect(observeWindowsAclSessionLifecycleForTests().opened - before.opened).toBe(2);
      await reopened.assertCurrent();
    } finally {
      await first?.release();
      await second?.release();
      await reopened?.release();
      await rm(root, { recursive: true, force: true });
    }
    const settled = observeWindowsAclSessionLifecycleForTests();
    expect(settled.closed - before.closed).toBe(2);
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows Runtime State authority retires ACL drift and a later operation repairs a new generation',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-runtime-repair-'));
    const input = windowsRuntimeAuthorityInput(root);
    await mkdir(input.repositoryRoot);
    await mkdir(input.stateRoot);
    await mkdir(input.cacheRoot);
    let stale: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let repaired: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    try {
      stale = await acquireSecRuntimeStatePhysicalAuthority(input);
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot) throw new Error('Windows SystemRoot is unavailable');
      const icacls = Bun.spawnSync([
        path.join(systemRoot, 'System32', 'icacls.exe'),
        input.stateRoot,
        '/grant',
        '*S-1-1-0:(OI)(CI)(M)'
      ], {
        stderr: 'pipe',
        stdout: 'pipe'
      });
      expect(icacls.exitCode).toBe(0);
      await expect(stale.assertCurrent()).rejects.toMatchObject({ failure: 'acl-untrusted' });
      await expect(stale.assertCurrent()).rejects.toMatchObject({ failure: 'session-closed' });

      repaired = await acquireSecRuntimeStatePhysicalAuthority(input);
      await repaired.assertCurrent();
      await expect(stale.assertCurrent()).rejects.toMatchObject({ failure: 'session-closed' });
    } finally {
      await stale?.release();
      await repaired?.release();
      await rm(root, { recursive: true, force: true });
    }
  }
);
