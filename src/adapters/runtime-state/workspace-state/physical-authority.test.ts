import { expect, jest, test } from 'bun:test';
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
import {
  migrateRuntimeStateDirectoryGeneration,
  selectRuntimeStateDirectoryGeneration,
  runtimeStateTestInvocationGenerationMigrations,
  runtimeStateWorkspaceGenerationMigrations
} from './layout-migration.ts';
import { acquireRuntimeCachePhysicalAuthority, acquireRuntimeStatePhysicalAuthority } from './physical-authority.ts';

test('runtime state generation selector keeps one authority namespace without creating a second generation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-layout-selection-'));
  try {
    const parent = path.join(root, 'trusted-runtime');
    const legacy = path.join(parent, 'v1');
    const current = path.join(parent, 'sessions');
    expect(selectRuntimeStateDirectoryGeneration({
      label: 'selection fixture', legacyPath: legacy, currentPath: current
    })).toEqual({ kind: 'current', path: current });
    mkdirSync(legacy, { recursive: true });
    expect(selectRuntimeStateDirectoryGeneration({
      label: 'selection fixture', legacyPath: legacy, currentPath: current
    })).toEqual({ kind: 'legacy', path: legacy });
    mkdirSync(current, { recursive: true });
    expect(() => selectRuntimeStateDirectoryGeneration({
      label: 'selection fixture', legacyPath: legacy, currentPath: current
    })).toThrow('current and legacy directories both exist');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')(
  'runtime state authority atomically migrates numeric root generations before materializing current directories',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-layout-migration-'));
    try {
      const repositoryRoot = path.join(root, 'repository');
      const stateRoot = path.join(root, 'state');
      const cacheRoot = path.join(root, 'cache');
      mkdirSync(repositoryRoot);
      const pairs = [
        [path.join(stateRoot, 'workspaces', 'v1'), path.join(stateRoot, 'workspaces', 'records')],
        [path.join(stateRoot, 'workspace-locators', 'v1'), path.join(stateRoot, 'workspace-locators', 'records')],
        [path.join(stateRoot, 'operation-leases', 'v1'), path.join(stateRoot, 'operation-leases', 'locks')]
      ] as const;
      const legacyIdentities = new Map<string, PhysicalDirectoryIdentity>();
      for (const [legacy] of pairs) {
        mkdirSync(legacy, { recursive: true });
        legacyIdentities.set(legacy, inspectNoFollowDirectoryChain(legacy, 'legacy generation fixture').target);
      }

      const authority = await acquireRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: pairs.map(([, current]) => current)
      });
      try {
        for (const [legacy, current] of pairs) {
          expect(existsSync(legacy)).toBe(false);
          const expected = legacyIdentities.get(legacy)!;
          const observed = inspectNoFollowDirectoryChain(current, 'migrated generation fixture').target;
          expect([observed.device, observed.inode, observed.objectId])
            .toEqual([expected.device, expected.inode, expected.objectId]);
          expect(authority.directory(current).objectId).toBe(observed.objectId);
        }
      } finally {
        await authority.release();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')(
  'runtime state authority rejects dual legacy/current root generations',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-layout-ambiguous-'));
    try {
      const repositoryRoot = path.join(root, 'repository');
      const stateRoot = path.join(root, 'state');
      const cacheRoot = path.join(root, 'cache');
      mkdirSync(repositoryRoot);
      mkdirSync(path.join(stateRoot, 'workspaces', 'v1'), { recursive: true });
      mkdirSync(path.join(stateRoot, 'workspaces', 'records'), { recursive: true });
      await expect(acquireRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: [path.join(stateRoot, 'workspaces', 'records')]
      })).rejects.toThrow('current and legacy directories both exist');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')(
  'runtime state authority migrates workspace and test-invocation generations as one admitted plan',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-nested-layout-migration-'));
    try {
      const repositoryRoot = path.join(root, 'repository');
      const stateRoot = path.join(root, 'state');
      const cacheRoot = path.join(root, 'cache');
      const workspaceRoot = path.join(stateRoot, 'workspaces', 'records', 'workspace');
      mkdirSync(repositoryRoot);
      const pairs = [
        [path.join(workspaceRoot, 'test-process-temp', 'v1'), path.join(workspaceRoot, 'test-process-temp', 'leases')],
        [path.join(workspaceRoot, 'verification-sessions', 'v2'), path.join(workspaceRoot, 'verification-sessions', 'journal')],
        [path.join(stateRoot, 'test-invocation-runs', 'v1'), path.join(stateRoot, 'test-invocation-runs', 'records')],
        [path.join(cacheRoot, 'test-invocation-runs', 'v1'), path.join(cacheRoot, 'test-invocation-runs', 'records')]
      ] as const;
      for (const [legacy] of pairs) mkdirSync(legacy, { recursive: true });

      const authority = await acquireRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: pairs.map(([, current]) => current),
        directoryMigrations: [
          ...runtimeStateWorkspaceGenerationMigrations(workspaceRoot),
          ...runtimeStateTestInvocationGenerationMigrations(stateRoot, cacheRoot)
        ]
      });
      try {
        for (const [legacy, current] of pairs) {
          expect(existsSync(legacy)).toBe(false);
          expect(authority.directory(current).path).toBe(current);
        }
      } finally {
        await authority.release();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')(
  'automatic runtime-state migration rejects non-empty legacy state while explicit quiescent migration preserves it',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-layout-quiescent-'));
    try {
      const repositoryRoot = path.join(root, 'repository');
      const stateRoot = path.join(root, 'state');
      const cacheRoot = path.join(root, 'cache');
      const legacy = path.join(stateRoot, 'workspaces', 'v1');
      const current = path.join(stateRoot, 'workspaces', 'records');
      mkdirSync(repositoryRoot);
      mkdirSync(path.join(legacy, 'retained'), { recursive: true });
      await expect(acquireRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: [current]
      })).rejects.toThrow('requires quiescent migration');
      expect(existsSync(path.join(legacy, 'retained'))).toBe(true);
      expect(migrateRuntimeStateDirectoryGeneration({
        label: 'workspace records',
        legacyPath: legacy,
        currentPath: current,
        mode: 'quiescent'
      })).toBe('migrated');
      expect(existsSync(legacy)).toBe(false);
      expect(existsSync(path.join(current, 'retained'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('runtime cache authority materializes one no-follow tree physically outside the repository', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-cache-authority-'));
  try {
    const repositoryRoot = path.join(root, 'repository');
    const cacheRoot = path.join(root, 'cache');
    const snapshots = path.join(cacheRoot, 'docs-doctor', 'index-snapshots', 'records');
    mkdirSync(repositoryRoot);

    const authority = acquireRuntimeCachePhysicalAuthority({
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
      acquireRuntimeCachePhysicalAuthority({
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

test('bounded Runtime State authority settlement preserves the live capability after deadline rejection', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-bounded-settlement-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  const authority = await acquireRuntimeStatePhysicalAuthority({
    repositoryRoot,
    stateRoot,
    cacheRoot,
    requiredDirectories: []
  });
  try {
    await expect(authority.release({ deadlineAtUnixMs: Date.now() - 1 }))
      .rejects.toThrow('deadline');
    await expect(authority.assertCurrent()).resolves.toBeUndefined();
    await authority.release({ deadlineAtUnixMs: Date.now() + 10_000 });
  } finally {
    await authority.release().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'bounded Runtime State settlement rejects an in-flight generation operation and remains retryable',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-pending-settlement-'));
    const repositoryRoot = path.join(root, 'repository');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot);
    const authority = await acquireRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    try {
      await expect(authority.assertCurrent({ deadlineAtUnixMs: Date.now() - 1 }))
        .rejects.toThrow('deadline');
      await expect(authority.assertCurrent()).resolves.toBeUndefined();
      const current = authority.assertCurrent();
      await expect(authority.release({ deadlineAtUnixMs: Date.now() + 10_000 }))
        .rejects.toThrow('operations pending');
      await current;
      await expect(authority.assertCurrent()).resolves.toBeUndefined();
      await authority.release({ deadlineAtUnixMs: Date.now() + 10_000 });
    } finally {
      await authority.release().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'a bounded queued Runtime State operation expires without poisoning its FIFO successor',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-queued-deadline-'));
    const repositoryRoot = path.join(root, 'repository');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot);
    const authority = await acquireRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    let predecessor: Promise<void> | undefined;
    let cancelled: Promise<void> | undefined;
    try {
      const now = Date.now();
      jest.useFakeTimers({ now });
      predecessor = authority.assertCurrent();
      cancelled = authority.assertCurrent({ deadlineAtUnixMs: now + 1_000 });
      const cancellation = cancelled.then(
        () => Object.freeze({ status: 'fulfilled' as const }),
        (error: unknown) => Object.freeze({ error, status: 'rejected' as const })
      );
      jest.advanceTimersByTime(1_000);
      jest.useRealTimers();

      const cancellationResult = await cancellation;
      expect(cancellationResult.status).toBe('rejected');
      expect((cancellationResult as { error: unknown }).error)
        .toMatchObject({ message: expect.stringContaining('deadline expired while queued') });
      await predecessor;
      await expect(authority.assertCurrent()).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
      await Promise.allSettled([predecessor, cancelled].filter(
        (operation): operation is Promise<void> => operation !== undefined
      ));
      await authority.release().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'bounded shared-reference release preserves its reference while another capability operation is pending',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-shared-pending-'));
    const input = {
      repositoryRoot: path.join(root, 'repository'),
      stateRoot: path.join(root, 'state'),
      cacheRoot: path.join(root, 'cache'),
      requiredDirectories: []
    };
    mkdirSync(input.repositoryRoot);
    const first = await acquireRuntimeStatePhysicalAuthority(input);
    const second = await acquireRuntimeStatePhysicalAuthority(input);
    try {
      const current = first.assertCurrent();
      await expect(second.release({ deadlineAtUnixMs: Date.now() + 10_000 }))
        .rejects.toThrow('operations pending');
      await current;
      await expect(second.assertCurrent()).resolves.toBeUndefined();
      await second.release({ deadlineAtUnixMs: Date.now() + 10_000 });
      await expect(first.assertCurrent()).resolves.toBeUndefined();
    } finally {
      await second.release().catch(() => undefined);
      await first.release().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'last-reference settlement excludes a same-key join until retirement is terminal',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-settling-join-'));
    const input = {
      repositoryRoot: path.join(root, 'repository'),
      stateRoot: path.join(root, 'state'),
      cacheRoot: path.join(root, 'cache'),
      requiredDirectories: []
    };
    mkdirSync(input.repositoryRoot);
    const authority = await acquireRuntimeStatePhysicalAuthority(input);
    let reopened: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    try {
      const retirement = authority.release({ deadlineAtUnixMs: Date.now() + 10_000 });
      await expect(acquireRuntimeStatePhysicalAuthority(input)).rejects.toThrow('generation is retired');
      await retirement;
      reopened = await acquireRuntimeStatePhysicalAuthority(input);
      await expect(reopened.assertCurrent()).resolves.toBeUndefined();
    } finally {
      await reopened?.release().catch(() => undefined);
      await authority.release().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')(
  'default last-reference settlement excludes joins while an admitted operation drains',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-default-settling-'));
    const input = {
      repositoryRoot: path.join(root, 'repository'),
      stateRoot: path.join(root, 'state'),
      cacheRoot: path.join(root, 'cache'),
      requiredDirectories: []
    };
    mkdirSync(input.repositoryRoot);
    const authority = await acquireRuntimeStatePhysicalAuthority(input);
    let reopened: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    try {
      const current = authority.assertCurrent();
      const retirement = authority.release();
      await expect(acquireRuntimeStatePhysicalAuthority(input)).rejects.toThrow('generation is retired');
      await current;
      await retirement;
      reopened = await acquireRuntimeStatePhysicalAuthority(input);
      await expect(reopened.assertCurrent()).resolves.toBeUndefined();
    } finally {
      await reopened?.release().catch(() => undefined);
      await authority.release().catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'win32')('bounded owner child generations queue without retiring concurrent stable root holders', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-generation-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  const first = await acquireRuntimeStatePhysicalAuthority({
    repositoryRoot,
    stateRoot,
    cacheRoot,
    requiredDirectories: []
  });
  let second: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
  let third: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
  try {
    const concurrentDeadlineAtUnixMs = Date.now() + 30_000;
    const concurrent = await Promise.allSettled([
      acquireRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: [path.join(stateRoot, 'operations', 'first')],
        deadlineAtUnixMs: concurrentDeadlineAtUnixMs
      }),
      acquireRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: [path.join(stateRoot, 'operations', 'second')],
        deadlineAtUnixMs: concurrentDeadlineAtUnixMs
      })
    ]);
    if (concurrent[0].status === 'fulfilled') second = concurrent[0].value;
    if (concurrent[1].status === 'fulfilled') third = concurrent[1].value;
    const failures = concurrent.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Bounded concurrent Runtime State authority acquisition failed');
    }
    if (second === undefined || third === undefined) {
      throw new Error('Bounded concurrent Runtime State authority acquisition returned no capability.');
    }
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
    const first = await acquireRuntimeStatePhysicalAuthority({
      repositoryRoot: firstRepositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    let second: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    let firstWarm: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
    try {
      second = await acquireRuntimeStatePhysicalAuthority({
        repositoryRoot: secondRepositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      const afterIndependentRoots = observeWindowsAclSessionLifecycleForTests();
      expect(afterIndependentRoots.opened - before.opened).toBe(2);
      expect(afterIndependentRoots.closed - before.closed).toBe(0);

      firstWarm = await acquireRuntimeStatePhysicalAuthority({
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
  const cold = await acquireRuntimeStatePhysicalAuthority({
    repositoryRoot,
    stateRoot,
    cacheRoot,
    requiredDirectories: []
  });
  let warm: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
  let delta: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
  let deltaWarm: Awaited<ReturnType<typeof acquireRuntimeStatePhysicalAuthority>> | undefined;
  try {
    const afterCold = observeWindowsAclSessionLifecycleForTests();
    expect(afterCold.opened - before.opened).toBe(1);

    warm = await acquireRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    const afterWarm = observeWindowsAclSessionLifecycleForTests();
    expect(afterWarm.opened).toBe(afterCold.opened);

    delta = await acquireRuntimeStatePhysicalAuthority({
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

    deltaWarm = await acquireRuntimeStatePhysicalAuthority({
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
  'same-path root replacement invalidates stable holders',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-hostile-'));
    const repositoryRoot = path.join(root, 'repository');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    mkdirSync(repositoryRoot);
    const authority = await acquireRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    try {
      renameSync(stateRoot, `${stateRoot}-displaced`);
      mkdirSync(stateRoot);
      await expect(authority.assertCurrent()).rejects.toThrow('physical identity changed');
    } finally {
      await authority.release();
      rmSync(root, { recursive: true, force: true });
    }
  }
);
