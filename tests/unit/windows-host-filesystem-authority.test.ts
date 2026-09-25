import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  hardenExistingWindowsHostDirectoryAuthority,
  openWindowsReadOnlyTreeGeneration,
  retireWindowsReadOnlyTreeGeneration,
  sealExistingWindowsReadOnlyTreeAuthority,
  sealWindowsReadOnlyTreeGeneration,
  WindowsHostDirectoryAuthorityError
} from '../../src/adapters/runtime-state/physical/runtime/windows-host-filesystem-authority.ts';
import {
  observeWindowsAclSessionLifecycleForTests,
  proveWindowsHostDirectoryAuthorityForTests
} from '../../src/adapters/runtime-state/physical/test/windows-host-filesystem.ts';
import {
  acquireRuntimeStatePhysicalAuthority
} from '../../src/adapters/runtime-state/workspace-state/physical-authority.ts';


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
  'Windows persisted generation retirement restores exact move and delete authority',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-generation-retire-'));
    const generationRoot = path.join(root, 'generation');
    const retiredRoot = path.join(root, 'retired');
    const sourcePath = path.join(generationRoot, 'source.ts');
    await mkdir(generationRoot);
    await writeFile(sourcePath, 'export const value = 1;\n');
    const binding = Object.freeze({
      generationDigest: `sha256:${'1'.repeat(64)}` as const,
      treeDigest: `sha256:${'2'.repeat(64)}` as const,
      treeEntryCount: 1
    });
    let primaryFailure: unknown;
    try {
      const sealed = await sealWindowsReadOnlyTreeGeneration(
        generationRoot,
        [sourcePath],
        binding
      );
      await sealed.authority.assertCurrent();
      await sealed.authority.release();
      const reopened = await openWindowsReadOnlyTreeGeneration(
        generationRoot,
        sealed.proofText,
        binding
      );
      await reopened.assertCurrent();
      await reopened.release();
      await retireWindowsReadOnlyTreeGeneration(
        generationRoot,
        sealed.proofText,
        binding
      );
      await retireWindowsReadOnlyTreeGeneration(
        generationRoot,
        sealed.proofText,
        binding
      );
      await rename(generationRoot, retiredRoot);
      await rm(retiredRoot, { recursive: true });
      expect(await readdir(root)).toEqual([]);
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      try {
        await rm(root, { recursive: true, force: true });
      } catch (cleanupError) {
        if (primaryFailure === undefined) throw cleanupError;
      }
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
  'Windows host directory authority passes the parent absolute deadline to its ACL probe',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-authority-deadline-'));
    const authorityRoot = path.join(root, 'local-app-data');
    await mkdir(authorityRoot);
    const observedDeadlines: Array<number | undefined> = [];
    try {
      const authority = await proveWindowsHostDirectoryAuthorityForTests(
        authorityRoot,
        async (_targetPath, input) => {
          observedDeadlines.push(input?.deadlineAtMs);
          return {
            aclDigest: `sha256:${'a'.repeat(64)}`,
            ownerSid: 'S-1-5-21-1000'
          };
        }
      );
      const deadlineAtMs = Date.now() + 10_000;
      await authority.assertCurrent({ deadlineAtMs });
      expect(observedDeadlines).toEqual([undefined, deadlineAtMs]);
      await authority.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows host directory authority preserves its session after one probe deadline failure',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-authority-probe-deadline-'));
    const authorityRoot = path.join(root, 'local-app-data');
    await mkdir(authorityRoot);
    let probeCount = 0;
    try {
      const authority = await proveWindowsHostDirectoryAuthorityForTests(
        authorityRoot,
        async () => {
          probeCount += 1;
          if (probeCount === 2) {
            throw new WindowsHostDirectoryAuthorityError('deadline-exhausted', 'test probe deadline exhausted');
          }
          return {
            aclDigest: `sha256:${'a'.repeat(64)}`,
            ownerSid: 'S-1-5-21-1000'
          };
        }
      );
      await expect(authority.assertCurrent({ deadlineAtMs: Date.now() + 10_000 }))
        .rejects.toMatchObject({ failure: 'deadline-exhausted' });
      await expect(authority.assertCurrent()).resolves.toBeUndefined();
      expect(probeCount).toBe(3);
      await authority.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows read-only tree reuses its physically-bound ACL proof on warm readback',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-proof-reuse-'));
    const repositoryRoot = path.join(root, 'repository');
    const generationRoot = path.join(repositoryRoot, 'generation');
    const executablePath = path.join(generationRoot, 'compiler.exe');
    await mkdir(generationRoot, { recursive: true });
    await writeFile(executablePath, 'immutable compiler generation');
    const before = observeWindowsAclSessionLifecycleForTests();
    let authority: Awaited<ReturnType<typeof sealExistingWindowsReadOnlyTreeAuthority>> |
      undefined;
    try {
      authority = await sealExistingWindowsReadOnlyTreeAuthority(
        generationRoot,
        [executablePath],
        {
          ownerRootPath: generationRoot,
          ownership: 'repository-dependency-generation',
          repositoryRootPath: repositoryRoot
        }
      );
      const cold = observeWindowsAclSessionLifecycleForTests();
      expect(cold.descriptorReads - before.descriptorReads).toBe(4);
      await authority.assertCurrent();
      await authority.assertCurrent();
      expect(observeWindowsAclSessionLifecycleForTests().descriptorReads).toBe(
        cold.descriptorReads
      );
    } finally {
      await authority?.release();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows read-only tree invalidates a published ACL proof on permission change',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-acl-drift-'));
    const repositoryRoot = path.join(root, 'repository');
    const generationRoot = path.join(repositoryRoot, 'generation');
    const executablePath = path.join(generationRoot, 'compiler.exe');
    await mkdir(generationRoot, { recursive: true });
    await writeFile(executablePath, 'immutable compiler generation');
    let authority: Awaited<ReturnType<typeof sealExistingWindowsReadOnlyTreeAuthority>> |
      undefined;
    try {
      authority = await sealExistingWindowsReadOnlyTreeAuthority(
        generationRoot,
        [executablePath],
        {
          ownerRootPath: generationRoot,
          ownership: 'repository-dependency-generation',
          repositoryRootPath: repositoryRoot
        }
      );
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot) throw new Error('Windows SystemRoot is unavailable');
      const changed = Bun.spawnSync([
        path.join(systemRoot, 'System32', 'icacls.exe'),
        executablePath,
        '/grant:r',
        '*S-1-1-0:(R)'
      ], { stderr: 'pipe', stdout: 'pipe' });
      expect(changed.exitCode).toBe(0);
      await expect(authority.assertCurrent()).rejects.toMatchObject({
        failure: 'physical-identity-changed'
      });
    } finally {
      await authority?.release();
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows read-only tree rejects physical replacement and will not restore onto it',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-object-drift-'));
    const repositoryRoot = path.join(root, 'repository');
    const generationRoot = path.join(repositoryRoot, 'generation');
    const executablePath = path.join(generationRoot, 'compiler.exe');
    await mkdir(generationRoot, { recursive: true });
    await writeFile(executablePath, 'immutable compiler generation');
    let authority: Awaited<ReturnType<typeof sealExistingWindowsReadOnlyTreeAuthority>> |
      undefined;
    try {
      authority = await sealExistingWindowsReadOnlyTreeAuthority(
        generationRoot,
        [executablePath],
        {
          ownerRootPath: generationRoot,
          ownership: 'repository-dependency-generation',
          repositoryRootPath: repositoryRoot
        }
      );
      const systemRoot = process.env.SystemRoot;
      if (!systemRoot) throw new Error('Windows SystemRoot is unavailable');
      const reset = Bun.spawnSync([
        path.join(systemRoot, 'System32', 'icacls.exe'),
        generationRoot,
        '/reset',
        '/T',
        '/C'
      ], { stderr: 'pipe', stdout: 'pipe' });
      expect(reset.exitCode).toBe(0);
      await rm(generationRoot, { recursive: true, force: true });
      await mkdir(generationRoot);
      await writeFile(executablePath, 'replacement compiler generation');
      await expect(authority.assertCurrent()).rejects.toMatchObject({
        failure: 'physical-identity-changed'
      });
      await expect(authority.release()).rejects.toMatchObject({ failure: 'acl-untrusted' });
      authority = undefined;
    } finally {
      await authority?.release().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows read-only tree rejects an exhausted admission before opening an ACL session',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-deadline-'));
    const repositoryRoot = path.join(root, 'repository');
    const generationRoot = path.join(repositoryRoot, 'generation');
    const executablePath = path.join(generationRoot, 'compiler.exe');
    await mkdir(generationRoot, { recursive: true });
    await writeFile(executablePath, 'immutable compiler generation');
    const before = observeWindowsAclSessionLifecycleForTests();
    try {
      await expect(sealExistingWindowsReadOnlyTreeAuthority(
        generationRoot,
        [executablePath],
        {
          deadlineAtMs: Date.now() - 1,
          ownerRootPath: generationRoot,
          ownership: 'repository-dependency-generation',
          repositoryRootPath: repositoryRoot
        }
      )).rejects.toMatchObject({ failure: 'deadline-exhausted' });
      expect(observeWindowsAclSessionLifecycleForTests().opened).toBe(before.opened);
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
      const operationRoot = path.join(authorityRoot, 'operation');
      await mkdir(operationRoot);
      await authority.assertCurrent();
      await writeFile(path.join(operationRoot, 'record.json'), '{}');
      await rm(operationRoot, { recursive: true });
      await authority.assertCurrent();
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
  'Windows native host authority converges concurrent hardening on one physical root',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-native-concurrent-'));
    const authorityRoot = path.join(root, 'state');
    await mkdir(authorityRoot);
    const authorities: Array<Awaited<ReturnType<
      typeof hardenExistingWindowsHostDirectoryAuthority
    >>> = [];
    try {
      authorities.push(...await Promise.all(Array.from({ length: 8 }, async () =>
        hardenExistingWindowsHostDirectoryAuthority(authorityRoot, { knownNew: true })
      )));
      await Promise.all(authorities.map(async (authority) => authority.assertCurrent()));
      expect(new Set(authorities.map((authority) => authority.rootPath))).toEqual(
        new Set([path.resolve(authorityRoot)])
      );
    } finally {
      await Promise.allSettled(authorities.map(async (authority) => authority.release()));
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
    let first: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    let second: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    let reopened: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    try {
      [first, second] = await Promise.all([
        acquireRuntimeStatePhysicalAuthority(input),
        acquireRuntimeStatePhysicalAuthority(input)
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
      reopened = await acquireRuntimeStatePhysicalAuthority(input);
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
    let stale: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    let repaired: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    try {
      stale = await acquireRuntimeStatePhysicalAuthority(input);
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

      repaired = await acquireRuntimeStatePhysicalAuthority(input);
      await repaired.assertCurrent();
      await expect(stale.assertCurrent()).rejects.toMatchObject({ failure: 'session-closed' });
    } finally {
      await stale?.release();
      await repaired?.release();
      await rm(root, { recursive: true, force: true });
    }
  }
);
