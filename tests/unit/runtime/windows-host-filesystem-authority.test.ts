import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { settleWorkspaceCallback, settleWorkspaceCleanups } from '../../testkit/workspace-cleanup.ts';

import {
  hardenExistingWindowsHostDirectoryAuthority,
  openWindowsReadOnlyTreeGeneration,
  retireWindowsReadOnlyTreeGeneration,
  sealExistingWindowsReadOnlyTreeAuthority,
  sealWindowsReadOnlyTreeGeneration
} from '../../../src/adapters/runtime-state/physical/runtime/windows-host-filesystem-authority.ts';
import {
  observeWindowsAclSessionLifecycleForTests,
  proveWindowsHostDirectoryAuthorityForTests
} from '../../../src/adapters/runtime-state/physical/test/windows-host-filesystem.ts';
import {
  acquireSecRuntimeStatePhysicalAuthority
} from '../../../src/adapters/runtime-state/workspace-state/physical-authority.ts';


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
    const binding = Object.freeze({
      generationDigest: `sha256:${'1'.repeat(64)}` as const,
      treeDigest: `sha256:${'2'.repeat(64)}` as const,
      treeEntryCount: 1
    });
    let sealedAuthority: Awaited<ReturnType<typeof sealWindowsReadOnlyTreeGeneration>>['authority'] | undefined;
    let reopenedAuthority: Awaited<ReturnType<typeof openWindowsReadOnlyTreeGeneration>> | undefined;
    await settleWorkspaceCallback(async () => {
      await mkdir(generationRoot);
      await writeFile(sourcePath, 'export const value = 1;\n');
      const sealed = await sealWindowsReadOnlyTreeGeneration(
        generationRoot,
        [sourcePath],
        binding
      );
      sealedAuthority = sealed.authority;
      await sealed.authority.assertCurrent();
      sealedAuthority = undefined;
      await sealed.authority.release();
      const reopened = await openWindowsReadOnlyTreeGeneration(
        generationRoot,
        sealed.proofText,
        binding
      );
      reopenedAuthority = reopened;
      await reopened.assertCurrent();
      reopenedAuthority = undefined;
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
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'sealed generation authority', settle: async () => { await sealedAuthority?.release(); } },
        { label: 'reopened generation authority', settle: async () => { await reopenedAuthority?.release(); } },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows host directory authority rejects a changed ACL digest',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-authority-'));
    const authorityRoot = path.join(root, 'local-app-data');
    let aclDigest = `sha256:${'a'.repeat(64)}`;
    await settleWorkspaceCallback(async () => {
      await mkdir(authorityRoot);
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
      await expect(authority.assertCurrent()).rejects.toMatchObject({
        failure: 'physical-identity-changed'
      });
      expect(await readdir(authorityRoot)).toEqual([]);
    }, async () => {
      await rm(root, { recursive: true, force: true });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows read-only tree reuses its physically-bound ACL proof on warm readback',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-proof-reuse-'));
    const repositoryRoot = path.join(root, 'repository');
    const generationRoot = path.join(repositoryRoot, 'generation');
    const executablePath = path.join(generationRoot, 'compiler.exe');
    let authority: Awaited<ReturnType<typeof sealExistingWindowsReadOnlyTreeAuthority>> |
      undefined;
    await settleWorkspaceCallback(async () => {
      await mkdir(generationRoot, { recursive: true });
      await writeFile(executablePath, 'immutable compiler generation');
      const before = observeWindowsAclSessionLifecycleForTests();
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
      expect(cold.descriptorReads).toBeGreaterThan(before.descriptorReads);
      await authority.assertCurrent();
      await authority.assertCurrent();
      expect(observeWindowsAclSessionLifecycleForTests().descriptorReads).toBe(
        cold.descriptorReads
      );
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'tree authority', settle: async () => { await authority?.release(); } },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows read-only tree invalidates a published ACL proof on permission change',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-acl-drift-'));
    const repositoryRoot = path.join(root, 'repository');
    const generationRoot = path.join(repositoryRoot, 'generation');
    const executablePath = path.join(generationRoot, 'compiler.exe');
    let authority: Awaited<ReturnType<typeof sealExistingWindowsReadOnlyTreeAuthority>> |
      undefined;
    await settleWorkspaceCallback(async () => {
      await mkdir(generationRoot, { recursive: true });
      await writeFile(executablePath, 'immutable compiler generation');
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
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'tree authority', settle: async () => { await authority?.release(); } },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows read-only tree rejects physical replacement and will not restore onto it',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-object-drift-'));
    const repositoryRoot = path.join(root, 'repository');
    const generationRoot = path.join(repositoryRoot, 'generation');
    const executablePath = path.join(generationRoot, 'compiler.exe');
    let authority: Awaited<ReturnType<typeof sealExistingWindowsReadOnlyTreeAuthority>> |
      undefined;
    await settleWorkspaceCallback(async () => {
      await mkdir(generationRoot, { recursive: true });
      await writeFile(executablePath, 'immutable compiler generation');
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
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'tree authority', settle: async () => { await authority?.release(); } },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows read-only tree rejects an exhausted admission before opening an ACL session',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-deadline-'));
    const repositoryRoot = path.join(root, 'repository');
    const generationRoot = path.join(repositoryRoot, 'generation');
    const executablePath = path.join(generationRoot, 'compiler.exe');
    await settleWorkspaceCallback(async () => {
      await mkdir(generationRoot, { recursive: true });
      await writeFile(executablePath, 'immutable compiler generation');
      const before = observeWindowsAclSessionLifecycleForTests();
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
    }, async () => {
      await rm(root, { recursive: true, force: true });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows native host authority revalidates through directory writes and rejects use after release',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-native-authority-'));
    const authorityRoot = path.join(root, 'state');
    let authority: Awaited<ReturnType<typeof hardenExistingWindowsHostDirectoryAuthority>> | undefined;
    await settleWorkspaceCallback(async () => {
      await mkdir(authorityRoot);
      authority = await hardenExistingWindowsHostDirectoryAuthority(
        authorityRoot,
        { knownNew: true }
      );
      await authority.assertCurrent({ deadlineAtMs: Date.now() + 10_000 });
      expect(authority.rootPath).toBe(path.resolve(authorityRoot));
      await expect(authority.assertCurrent({ deadlineAtMs: Date.now() - 1 }))
        .rejects.toMatchObject({ failure: 'deadline-exhausted' });
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
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'host authority', settle: async () => { await authority?.release(); } },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows native host authority converges concurrent hardening on one physical root',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-native-concurrent-'));
    const authorityRoot = path.join(root, 'state');
    const authorities: Array<Awaited<ReturnType<
      typeof hardenExistingWindowsHostDirectoryAuthority
    >>> = [];
    let acquisitions: Promise<void>[] = [];
    let observations: Promise<void>[] = [];
    await settleWorkspaceCallback(async () => {
      await mkdir(authorityRoot);
      acquisitions = Array.from({ length: 8 }, async () => {
        const authority = await hardenExistingWindowsHostDirectoryAuthority(authorityRoot, { knownNew: true });
        authorities.push(authority);
      });
      await settleWorkspaceCleanups(acquisitions.map(pending => () => pending));
      observations = authorities.map(authority => authority.assertCurrent());
      await settleWorkspaceCleanups(observations.map(pending => () => pending));
      expect(new Set(authorities.map((authority) => authority.rootPath))).toEqual(
        new Set([path.resolve(authorityRoot)])
      );
    }, async () => {
      await Promise.allSettled(acquisitions);
      await Promise.allSettled(observations);
      await settleResourcesAsync({ cleanup: [
        { label: 'concurrent host authorities', settle: () => settleWorkspaceCleanups(authorities.map(authority => () => authority.release())) },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows native host authority rejects ACL and physical-object replacement',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-native-drift-'));
    const aclRoot = path.join(root, 'acl');
    const physicalRoot = path.join(root, 'physical');
    let aclAuthority: Awaited<ReturnType<typeof hardenExistingWindowsHostDirectoryAuthority>> |
      undefined;
    let physicalAuthority: Awaited<ReturnType<typeof hardenExistingWindowsHostDirectoryAuthority>> |
      undefined;
    await settleWorkspaceCallback(async () => {
      await mkdir(aclRoot);
      await mkdir(physicalRoot);
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
      await expect(physicalAuthority.assertCurrent()).rejects.toMatchObject({
        failure: 'physical-identity-changed'
      });
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'ACL authority', settle: async () => { await aclAuthority?.release(); } },
        { label: 'physical authority', settle: async () => { await physicalAuthority?.release(); } },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows native host authority fails closed before unavailable or expired admission',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-native-admission-'));
    await settleWorkspaceCallback(async () => {
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
      )).rejects.toMatchObject({
        failure: 'native-provider-unavailable', cause: { code: 'ENOENT' }
      });
    }, async () => {
      await rm(root, { recursive: true, force: true });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows host directory authority rejects a physical root whose ACL proof is untrusted',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-host-untrusted-'));
    await settleWorkspaceCallback(async () => {
      await expect(proveWindowsHostDirectoryAuthorityForTests(
        root,
        async () => {
          throw new Error('untrusted-writer:S-1-1-0');
        }
      )).rejects.toThrow('untrusted-writer:S-1-1-0');
      expect(await readdir(root)).toEqual([]);
    }, async () => {
      await rm(root, { recursive: true, force: true });
    });
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows Runtime State authority shares one live generation and releases it after the last capability',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-runtime-generation-'));
    const input = windowsRuntimeAuthorityInput(root);
    let before!: ReturnType<typeof observeWindowsAclSessionLifecycleForTests>;
    let first: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let second: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let reopened: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    await settleWorkspaceCallback(async () => {
      await mkdir(input.repositoryRoot);
      await mkdir(input.stateRoot);
      await mkdir(input.cacheRoot);
      before = observeWindowsAclSessionLifecycleForTests();
      await settleWorkspaceCleanups([
        async () => { first = await acquireSecRuntimeStatePhysicalAuthority(input); },
        async () => { second = await acquireSecRuntimeStatePhysicalAuthority(input); }
      ]);
      if (first === undefined || second === undefined) throw new Error('Runtime authority acquisition did not return both capabilities');
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
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'first runtime capability', settle: async () => { await first?.release(); } },
        { label: 'second runtime capability', settle: async () => { await second?.release(); } },
        { label: 'reopened runtime capability', settle: async () => { await reopened?.release(); } },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
    const settled = observeWindowsAclSessionLifecycleForTests();
    expect(settled.closed - before.closed).toBe(2);
  }
);

test.skipIf(process.platform !== 'win32')(
  'Windows Runtime State authority retires ACL drift and a later operation repairs a new generation',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-windows-runtime-repair-'));
    const input = windowsRuntimeAuthorityInput(root);
    let stale: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let repaired: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    await settleWorkspaceCallback(async () => {
      await mkdir(input.repositoryRoot);
      await mkdir(input.stateRoot);
      await mkdir(input.cacheRoot);
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
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'stale runtime capability', settle: async () => { await stale?.release(); } },
        { label: 'repaired runtime capability', settle: async () => { await repaired?.release(); } },
        { label: 'fixture root', settle: () => rm(root, { recursive: true, force: true }) }
      ] });
    });
  }
);
