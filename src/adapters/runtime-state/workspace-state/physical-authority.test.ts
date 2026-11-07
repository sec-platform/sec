import { settleWorkspaceCleanups } from '../../../../tests/testkit/workspace-cleanup.ts';
import { settleResources, settleResourcesAsync, type ResourceSettlementFailure } from '../../../execution/resource-settlement.ts';
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
import { acquireSecRuntimeCachePhysicalAuthority, acquireSecRuntimeStatePhysicalAuthority } from './physical-authority.ts';

test('runtime cache authority materializes one no-follow tree physically outside the repository', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-cache-authority-'));
  let fixtureFailure2: ResourceSettlementFailure | undefined;
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
  } catch (error) {
    fixtureFailure2 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure2,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(root, { recursive: true, force: true }); } }]
    });
  }
});

test('runtime cache authority rejects a symlink or junction ancestor before creating descendants', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-cache-reparse-'));
  let fixtureFailure1: ResourceSettlementFailure | undefined;
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
  } catch (error) {
    fixtureFailure1 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure1,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(root, { recursive: true, force: true }); } }]
    });
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
  let authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let acquisitionUnsettled = false;
  let primaryFailure: ResourceSettlementFailure | undefined;
  try {
    mkdirSync(repositoryRoot);
    acquisitionUnsettled = true;
    authority = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    acquisitionUnsettled = false;
    await expect(authority.release({ deadlineAtUnixMs: Date.now() - 1 }))
      .rejects.toThrow('deadline');
    await expect(authority.assertCurrent()).resolves.toBeUndefined();
    await authority.release({ deadlineAtUnixMs: Date.now() + 10_000 });
  } catch (error) {
    primaryFailure = { label: 'authority fixture', error };
  } finally {
    await settleResourcesAsync({ primary: primaryFailure, cleanup: [
      { label: 'release authorities before retiring root', settle: async () => {
        await settleResourcesAsync({ cleanup: [
          { label: 'authority', settle: () => authority?.release() },
          { label: 'authority acquisition settlement', settle: () => {
            if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
          } }
        ] });
        rmSync(root, { recursive: true, force: true });
      } }
    ] });
  }
});

test.skipIf(process.platform !== 'win32')(
  'bounded Runtime State settlement rejects an in-flight generation operation and remains retryable',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-pending-settlement-'));
    const repositoryRoot = path.join(root, 'repository');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    let authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let acquisitionUnsettled = false;
    let primaryFailure: ResourceSettlementFailure | undefined;
    let joinedOperations: Promise<unknown> | undefined;
    let current: Promise<void> | undefined;
    try {
      mkdirSync(repositoryRoot);
      acquisitionUnsettled = true;
      authority = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      acquisitionUnsettled = false;
      await expect(authority.assertCurrent({ deadlineAtUnixMs: Date.now() - 1 }))
        .rejects.toThrow('deadline');
      await expect(authority.assertCurrent()).resolves.toBeUndefined();
      current = authority.assertCurrent();
      joinedOperations = Promise.allSettled([current]);
      await expect(authority.release({ deadlineAtUnixMs: Date.now() + 10_000 }))
        .rejects.toThrow('operations pending');
      await current;
      await expect(authority.assertCurrent()).resolves.toBeUndefined();
      await authority.release({ deadlineAtUnixMs: Date.now() + 10_000 });
    } catch (error) {
      primaryFailure = { label: 'authority fixture', error };
    } finally {
      await settleResourcesAsync({ primary: primaryFailure, cleanup: [
        { label: 'join current operation', settle: async () => { await joinedOperations; await current; } },
        { label: 'release authorities before retiring root', settle: async () => {
          await settleResourcesAsync({ cleanup: [
            { label: 'authority', settle: () => authority?.release() },
            { label: 'authority acquisition settlement', settle: () => {
              if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
            } }
          ] });
          rmSync(root, { recursive: true, force: true });
        } }
      ] });
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
    let authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let acquisitionUnsettled = false;
    let primaryFailure: ResourceSettlementFailure | undefined;
    let joinedOperations: Promise<unknown> | undefined;
    let fakeTimersStarted = false;
    let predecessor: Promise<void> | undefined;
    let cancelled: Promise<void> | undefined;
    try {
      mkdirSync(repositoryRoot);
      acquisitionUnsettled = true;
      authority = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      acquisitionUnsettled = false;
      const now = Date.now();
      fakeTimersStarted = true;
      jest.useFakeTimers({ now });
      predecessor = authority.assertCurrent();
      cancelled = authority.assertCurrent({ deadlineAtUnixMs: now + 1_000 });
      joinedOperations = Promise.allSettled([predecessor, cancelled]);
      const cancellation = cancelled.then(
        () => Object.freeze({ status: 'fulfilled' as const }),
        (error: unknown) => Object.freeze({ error, status: 'rejected' as const })
      );
      jest.advanceTimersByTime(1_000);
      jest.useRealTimers();
      fakeTimersStarted = false;

      const cancellationResult = await cancellation;
      expect(cancellationResult.status).toBe('rejected');
      expect((cancellationResult as { error: unknown }).error)
        .toMatchObject({ message: expect.stringContaining('deadline expired while queued') });
      await predecessor;
      await expect(authority.assertCurrent()).resolves.toBeUndefined();
    } catch (error) {
      primaryFailure = { label: 'authority fixture', error };
    } finally {
      await settleResourcesAsync({ primary: primaryFailure, cleanup: [
        { label: 'restore real timers', settle: () => { if (fakeTimersStarted) jest.useRealTimers(); } },
        { label: 'join queued operations', settle: async () => {
          await joinedOperations;
          await predecessor;
        } },
        { label: 'release authorities before retiring root', settle: async () => {
          await settleResourcesAsync({ cleanup: [
            { label: 'authority', settle: () => authority?.release() },
            { label: 'authority acquisition settlement', settle: () => {
              if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
            } }
          ] });
          rmSync(root, { recursive: true, force: true });
        } }
      ] });
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
    let first: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let second: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let acquisitionUnsettled = false;
    let primaryFailure: ResourceSettlementFailure | undefined;
    let joinedOperations: Promise<unknown> | undefined;
    let current: Promise<void> | undefined;
    try {
      mkdirSync(input.repositoryRoot);
      acquisitionUnsettled = true;
      first = await acquireSecRuntimeStatePhysicalAuthority(input);
      second = await acquireSecRuntimeStatePhysicalAuthority(input);
      acquisitionUnsettled = false;
      current = first.assertCurrent();
      joinedOperations = Promise.allSettled([current]);
      await expect(second.release({ deadlineAtUnixMs: Date.now() + 10_000 }))
        .rejects.toThrow('operations pending');
      await current;
      await expect(second.assertCurrent()).resolves.toBeUndefined();
      await second.release({ deadlineAtUnixMs: Date.now() + 10_000 });
      await expect(first.assertCurrent()).resolves.toBeUndefined();
    } catch (error) {
      primaryFailure = { label: 'authority fixture', error };
    } finally {
      await settleResourcesAsync({ primary: primaryFailure, cleanup: [
        { label: 'join current operation', settle: async () => { await joinedOperations; await current; } },
        { label: 'release authorities before retiring root', settle: async () => {
          await settleResourcesAsync({ cleanup: [
            { label: 'second authority', settle: () => second?.release() },
            { label: 'first authority', settle: () => first?.release() },
            { label: 'authority acquisition settlement', settle: () => {
              if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
            } }
          ] });
          rmSync(root, { recursive: true, force: true });
        } }
      ] });
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
    let authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let acquisitionUnsettled = false;
    let primaryFailure: ResourceSettlementFailure | undefined;
    let joinedOperations: Promise<unknown> | undefined;
    let retirement: Promise<void> | undefined;
    let unexpectedJoin: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let reopened: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    try {
      mkdirSync(input.repositoryRoot);
      acquisitionUnsettled = true;
      authority = await acquireSecRuntimeStatePhysicalAuthority(input);
      acquisitionUnsettled = false;
      retirement = authority.release({ deadlineAtUnixMs: Date.now() + 10_000 });
      joinedOperations = Promise.allSettled([retirement]);
      acquisitionUnsettled = true;
      await expect(acquireSecRuntimeStatePhysicalAuthority(input).then(value => {
        unexpectedJoin = value;
        acquisitionUnsettled = false;
        return value;
      })).rejects.toThrow('generation is retired');
      acquisitionUnsettled = false;
      await retirement;
      acquisitionUnsettled = true;
      reopened = await acquireSecRuntimeStatePhysicalAuthority(input);
      acquisitionUnsettled = false;
      await expect(reopened.assertCurrent()).resolves.toBeUndefined();
    } catch (error) {
      primaryFailure = { label: 'authority fixture', error };
    } finally {
      await settleResourcesAsync({ primary: primaryFailure, cleanup: [
        { label: 'join retirement', settle: async () => { await joinedOperations; await retirement; } },
        { label: 'release authorities before retiring root', settle: async () => {
          await settleResourcesAsync({ cleanup: [
            { label: 'unexpectedJoin authority', settle: () => unexpectedJoin?.release() },
            { label: 'reopened authority', settle: () => reopened?.release() },
            { label: 'authority', settle: () => authority?.release() },
            { label: 'authority acquisition settlement', settle: () => {
              if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
            } }
          ] });
          rmSync(root, { recursive: true, force: true });
        } }
      ] });
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
    let authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let acquisitionUnsettled = false;
    let primaryFailure: ResourceSettlementFailure | undefined;
    let joinedOperations: Promise<unknown> | undefined;
    let current: Promise<void> | undefined;
    let retirement: Promise<void> | undefined;
    let unexpectedJoin: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let reopened: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    try {
      mkdirSync(input.repositoryRoot);
      acquisitionUnsettled = true;
      authority = await acquireSecRuntimeStatePhysicalAuthority(input);
      acquisitionUnsettled = false;
      current = authority.assertCurrent();
      retirement = authority.release();
      joinedOperations = Promise.allSettled([current, retirement]);
      acquisitionUnsettled = true;
      await expect(acquireSecRuntimeStatePhysicalAuthority(input).then(value => {
        unexpectedJoin = value;
        acquisitionUnsettled = false;
        return value;
      })).rejects.toThrow('generation is retired');
      acquisitionUnsettled = false;
      await current;
      await retirement;
      acquisitionUnsettled = true;
      reopened = await acquireSecRuntimeStatePhysicalAuthority(input);
      acquisitionUnsettled = false;
      await expect(reopened.assertCurrent()).resolves.toBeUndefined();
    } catch (error) {
      primaryFailure = { label: 'authority fixture', error };
    } finally {
      await settleResourcesAsync({ primary: primaryFailure, cleanup: [
        { label: 'join admitted operation and retirement', settle: async () => {
          await joinedOperations;
          await settleWorkspaceCleanups([async () => { await current; }, async () => { await retirement; }]);
        } },
        { label: 'release authorities before retiring root', settle: async () => {
          await settleResourcesAsync({ cleanup: [
            { label: 'unexpectedJoin authority', settle: () => unexpectedJoin?.release() },
            { label: 'reopened authority', settle: () => reopened?.release() },
            { label: 'authority', settle: () => authority?.release() },
            { label: 'authority acquisition settlement', settle: () => {
              if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
            } }
          ] });
          rmSync(root, { recursive: true, force: true });
        } }
      ] });
    }
  }
);

test.skipIf(process.platform !== 'win32')('bounded owner child generations queue without retiring concurrent stable root holders', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-generation-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  let first: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let acquisitionUnsettled = false;
  let second: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let third: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let primaryFailure: ResourceSettlementFailure | undefined;
  try {
    mkdirSync(repositoryRoot);
    acquisitionUnsettled = true;
    first = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    acquisitionUnsettled = false;
    const concurrentDeadlineAtUnixMs = Date.now() + 30_000;
    acquisitionUnsettled = true;
    const concurrent = await Promise.allSettled([
      acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: [path.join(stateRoot, 'operations', 'first')],
        deadlineAtUnixMs: concurrentDeadlineAtUnixMs
      }),
      acquireSecRuntimeStatePhysicalAuthority({
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
    acquisitionUnsettled = false;
    await settleWorkspaceCleanups([() => first!.assertCurrent(), () => second!.assertCurrent(), () => third!.assertCurrent()]);
    expect(second.directory(path.join(stateRoot, 'operations', 'first')).path).toBe(path.join(stateRoot, 'operations', 'first'));
    expect(third.directory(path.join(stateRoot, 'operations', 'second')).path).toBe(path.join(stateRoot, 'operations', 'second'));
  } catch (error) {
    primaryFailure = { label: 'authority fixture', error };
  } finally {
    await settleResourcesAsync({ primary: primaryFailure, cleanup: [{ label: 'release authorities before retiring root', settle: async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'third authority', settle: () => third?.release() },
        { label: 'second authority', settle: () => second?.release() },
        { label: 'first authority', settle: () => first?.release() },
        { label: 'authority acquisition settlement', settle: () => {
          if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
        } }
      ] });
      rmSync(root, { recursive: true, force: true });
    } }] });
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
    const before = observeWindowsAclSessionLifecycleForTests();
    let first: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let acquisitionUnsettled = false;
    let second: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let firstWarm: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let primaryFailure: ResourceSettlementFailure | undefined;
    try {
      mkdirSync(firstRepositoryRoot);
      mkdirSync(secondRepositoryRoot);
      acquisitionUnsettled = true;
      first = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot: firstRepositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      second = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot: secondRepositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      acquisitionUnsettled = false;
      const afterIndependentRoots = observeWindowsAclSessionLifecycleForTests();
      expect(afterIndependentRoots.opened - before.opened).toBe(2);
      expect(afterIndependentRoots.closed - before.closed).toBe(0);

      acquisitionUnsettled = true;
      firstWarm = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot: firstRepositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      acquisitionUnsettled = false;
      expect(observeWindowsAclSessionLifecycleForTests().opened).toBe(afterIndependentRoots.opened);
      await settleWorkspaceCleanups([() => first!.assertCurrent(), () => second!.assertCurrent(), () => firstWarm!.assertCurrent()]);
    } catch (error) {
      primaryFailure = { label: 'authority fixture', error };
    } finally {
      await settleResourcesAsync({ primary: primaryFailure, cleanup: [{ label: 'release authorities before retiring root', settle: async () => {
        await settleResourcesAsync({ cleanup: [
          { label: 'firstWarm authority', settle: () => firstWarm?.release() },
          { label: 'second authority', settle: () => second?.release() },
          { label: 'first authority', settle: () => first?.release() },
          { label: 'authority acquisition settlement', settle: () => {
            if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
          } }
        ] });
        rmSync(root, { recursive: true, force: true });
      } }] });
    }
  }
);

test.skipIf(process.platform !== 'win32')('warm closure reuses authority and a multi-directory delta settles replaced sessions', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-warm-delta-'));
  const repositoryRoot = path.join(root, 'repository');
  const stateRoot = path.join(root, 'state');
  const cacheRoot = path.join(root, 'cache');
  const operationRoot = path.join(stateRoot, 'operations', 'one');
  const terminalRoot = path.join(stateRoot, 'operations', 'two', 'terminal');
  const before = observeWindowsAclSessionLifecycleForTests();
  let cold: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let acquisitionUnsettled = false;
  let warm: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let delta: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let deltaWarm: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
  let primaryFailure: ResourceSettlementFailure | undefined;
  try {
    mkdirSync(repositoryRoot);
    acquisitionUnsettled = true;
    cold = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    acquisitionUnsettled = false;
    const afterCold = observeWindowsAclSessionLifecycleForTests();
    expect(afterCold.opened - before.opened).toBe(1);

    acquisitionUnsettled = true;
    warm = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: []
    });
    acquisitionUnsettled = false;
    const afterWarm = observeWindowsAclSessionLifecycleForTests();
    expect(afterWarm.opened).toBe(afterCold.opened);

    acquisitionUnsettled = true;
    delta = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: [operationRoot, terminalRoot]
    });
    acquisitionUnsettled = false;
    const afterDelta = observeWindowsAclSessionLifecycleForTests();
    expect(delta.directory(operationRoot).path).toBe(operationRoot);
    expect(delta.directory(terminalRoot).path).toBe(terminalRoot);

    acquisitionUnsettled = true;
    deltaWarm = await acquireSecRuntimeStatePhysicalAuthority({
      repositoryRoot,
      stateRoot,
      cacheRoot,
      requiredDirectories: [operationRoot, terminalRoot]
    });
    acquisitionUnsettled = false;
    const afterDeltaWarm = observeWindowsAclSessionLifecycleForTests();
    expect(afterDeltaWarm.opened).toBe(afterDelta.opened);
    await settleWorkspaceCleanups([() => cold!.assertCurrent(), () => warm!.assertCurrent(), () => delta!.assertCurrent(), () => deltaWarm!.assertCurrent()]);
  } catch (error) {
    primaryFailure = { label: 'authority fixture', error };
  } finally {
    await settleResourcesAsync({ primary: primaryFailure, cleanup: [{ label: 'release authorities before retiring root', settle: async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'deltaWarm authority', settle: () => deltaWarm?.release() },
        { label: 'delta authority', settle: () => delta?.release() },
        { label: 'warm authority', settle: () => warm?.release() },
        { label: 'cold authority', settle: () => cold?.release() },
        { label: 'authority acquisition settlement', settle: () => {
          if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
        } }
      ] });
      rmSync(root, { recursive: true, force: true });
    } }] });
  }
  const afterRelease = observeWindowsAclSessionLifecycleForTests();
  expect(afterRelease.opened - before.opened).toBe(afterRelease.closed - before.closed);
});

test.skipIf(process.platform !== 'win32')(
  'same-path root replacement invalidates stable holders',
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-state-hostile-'));
    const repositoryRoot = path.join(root, 'repository');
    const stateRoot = path.join(root, 'state');
    const cacheRoot = path.join(root, 'cache');
    let authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>> | undefined;
    let acquisitionUnsettled = false;
    let primaryFailure: ResourceSettlementFailure | undefined;
    try {
      mkdirSync(repositoryRoot);
      acquisitionUnsettled = true;
      authority = await acquireSecRuntimeStatePhysicalAuthority({
        repositoryRoot,
        stateRoot,
        cacheRoot,
        requiredDirectories: []
      });
      acquisitionUnsettled = false;
      renameSync(stateRoot, `${stateRoot}-displaced`);
      mkdirSync(stateRoot);
      await expect(authority.assertCurrent()).rejects.toThrow('physical identity changed');
    } catch (error) {
      primaryFailure = { label: 'authority fixture', error };
    } finally {
      await settleResourcesAsync({ primary: primaryFailure, cleanup: [{ label: 'release authority before retiring root', settle: async () => {
        await authority?.release();
        if (acquisitionUnsettled) throw new Error(`Authority acquisition is unresolved; fixture root is preserved: ${root}`);
        rmSync(root, { recursive: true, force: true });
      } }] });
    }
  }
);
