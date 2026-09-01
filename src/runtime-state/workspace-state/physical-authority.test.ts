import { expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertPhysicallyDisjointDirectoryChains,
  inspectNoFollowDirectoryChain,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity
} from '../physical/runtime/physical-no-follow.ts';
import { observeWindowsAclSessionLifecycleForTests } from '../physical/test/windows-host-filesystem.ts';
import { acquireSecRuntimeCachePhysicalAuthority, acquireSecRuntimeStatePhysicalAuthority } from './physical-authority.ts';

test('runtime cache authority materializes one no-follow tree physically outside the repository', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-cache-authority-'));
  try {
    const repositoryRoot = path.join(root, 'repository');
    const cacheRoot = path.join(root, 'cache');
    const snapshots = path.join(cacheRoot, 'docs-doctor', 'index-snapshots', 'v1');
    mkdirSync(repositoryRoot);

    const authority = acquireSecRuntimeCachePhysicalAuthority({
      repositoryRoot,
      cacheRoot,
      requiredDirectories: [snapshots]
    });

    expect(authority.directory(snapshots).objectId).toBe(
      inspectNoFollowDirectoryChain(snapshots, 'cache authority readback').target.objectId
    );
    authority.assertCurrent();
    if (process.platform === 'linux') {
      expect(lstatSync(cacheRoot).mode & 0o077).toBe(0);
      expect(lstatSync(snapshots).mode & 0o077).toBe(0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtime cache authority rejects a symlink or junction ancestor before creating descendants', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-cache-reparse-'));
  try {
    const repositoryRoot = path.join(root, 'repository');
    const cacheRoot = path.join(root, 'cache-link');
    const forbiddenDescendant = path.join(cacheRoot, 'docs-doctor');
    mkdirSync(repositoryRoot);
    symlinkSync(repositoryRoot, cacheRoot, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() =>
      acquireSecRuntimeCachePhysicalAuthority({
        repositoryRoot,
        cacheRoot,
        requiredDirectories: [forbiddenDescendant]
      })
    ).toThrow();
    expect(existsSync(path.join(repositoryRoot, 'docs-doctor'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('physical disjointness rejects different lexical paths for the same physical object', () => {
  const identity = (physical: string, lexical: string): PhysicalDirectoryIdentity =>
    Object.freeze({
      path: lexical,
      finalPath: lexical,
      device: '7',
      inode: '11',
      objectId: physical
    });
  const chain = (target: PhysicalDirectoryIdentity): PhysicalDirectoryChain =>
    Object.freeze({
      target,
      ancestors: Object.freeze([target])
    });
  expect(() =>
    assertPhysicallyDisjointDirectoryChains(
      chain(identity('same-object', '/first/path')),
      chain(identity('same-object', '/bind/alias')),
      'alias roots'
    )
  ).toThrow('physically disjoint');
});

test.skipIf(process.platform !== 'win32')('owner child generations advance without retiring concurrent stable root holders', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-generation-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  const first = await acquireSecRuntimeStatePhysicalAuthority({
    repositoryRoot,
    stateRoot,
    cacheRoot,
    requiredDirectories: []
  });
  let second: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let third: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  try {
    [second, third] = await Promise.all([
      acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: [path.join(stateRoot, 'operations', 'first')]
      }),
      acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: [path.join(stateRoot, 'operations', 'second')]
      })
    ]);
    await Promise.all([first.assertCurrent(), second.assertCurrent(), third.assertCurrent()]);
    expect(second.directory(path.join(stateRoot, 'operations', 'first')).path).toBe(path.join(stateRoot, 'operations', 'first'));
    expect(third.directory(path.join(stateRoot, 'operations', 'second')).path).toBe(path.join(stateRoot, 'operations', 'second'));
  } finally {
    await third?.release();
    await second?.release();
    await first.release();
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'independent repository roots use independent generations under shared Runtime State roots',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-root-identity-'));
    const firstRepositoryRoot = path.join(root, 'repository-first');
    const secondRepositoryRoot = path.join(root, 'repository-second');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(firstRepositoryRoot);
    mkdirSync(secondRepositoryRoot);
    const before = observeWindowsAclSessionLifecycleForTests();
    const first = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot: firstRepositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    let second: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let firstWarm: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    try {
      second = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot: secondRepositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      const afterIndependentRoots = observeWindowsAclSessionLifecycleForTests();
      expect(afterIndependentRoots.opened - before.opened).toBe(2);
      expect(afterIndependentRoots.closed - before.closed).toBe(0);

      firstWarm = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot: firstRepositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      expect(observeWindowsAclSessionLifecycleForTests().opened).toBe(afterIndependentRoots.opened);
      await Promise.all([first.assertCurrent(), second.assertCurrent(), firstWarm.assertCurrent()]);
    } finally {
      await firstWarm?.release();
      await second?.release();
      await first.release();
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')('warm closure reuses one generation and a multi-directory delta swaps it once', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-warm-delta-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  const operationRoot = path.join(stateRoot, 'operations', 'one');
  const terminalRoot = path.join(stateRoot, 'operations', 'two', 'terminal');
  mkdirSync(repositoryRoot);
  const before = observeWindowsAclSessionLifecycleForTests();
  const cold = await acquireSecRuntimeStatePhysicalAuthority({
    repositoryRoot,
    stateRoot,
    cacheRoot,
    requiredDirectories: []
  });
  let warm: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let delta: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let deltaWarm: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  try {
    const afterCold = observeWindowsAclSessionLifecycleForTests();
    expect(afterCold.opened - before.opened).toBe(1);

    warm = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    const afterWarm = observeWindowsAclSessionLifecycleForTests();
    expect(afterWarm.opened).toBe(afterCold.opened);

    delta = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: [operationRoot, terminalRoot]
    });
    const afterDelta = observeWindowsAclSessionLifecycleForTests();
    expect(afterDelta.opened - afterWarm.opened).toBe(1);
    expect(afterDelta.closed - afterWarm.closed).toBe(1);
    expect(delta.directory(operationRoot).path).toBe(operationRoot);
    expect(delta.directory(terminalRoot).path).toBe(terminalRoot);

    deltaWarm = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: [operationRoot, terminalRoot]
    });
    const afterDeltaWarm = observeWindowsAclSessionLifecycleForTests();
    expect(afterDeltaWarm.opened).toBe(afterDelta.opened);
    await Promise.all([cold.assertCurrent(), warm.assertCurrent(), delta.assertCurrent(), deltaWarm.assertCurrent()]);
  } finally {
    await deltaWarm?.release();
    await delta?.release();
    await warm?.release();
    await cold.release();
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'unowned membership mutation and same-path root replacement still invalidate stable holders',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-hostile-'));
    const repositoryRoot = path.join(root, 'repository');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot);
    let authority = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    try {
      mkdirSync(path.join(stateRoot, 'unowned-child'));
      await expect(authority.assertCurrent()).rejects.toThrow('changed');
      await authority.release();

      authority = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      renameSync(stateRoot, `${stateRoot}-displaced`);
      mkdirSync(stateRoot);
      await expect(authority.assertCurrent()).rejects.toThrow('physical identity changed');
    } finally {
      await authority.release();
      rmSync(root, { recursive: true, force: true });
    }
  }
);
