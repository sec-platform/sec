import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { pathExists } from '../../platform/shared/fs.ts';
import {
  WorkspaceWriteLeaseError,
  createWorkspaceWriteLeaseManager,
  inspectWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../../platform/shared/workspace-write-lease.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function ids(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${next += 1}`;
}

function immutableCandidateName(kind: string, id: string): string {
  const digest = createHash('sha256').update(JSON.stringify({ kind, id })).digest('hex');
  return `.${kind}-${digest}.candidate`;
}

async function writeDurableJsonCandidate(candidate: string, value: unknown): Promise<void> {
  const handle = await open(candidate, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurableProtocolCandidate(candidate: string): Promise<void> {
  await writeDurableJsonCandidate(candidate, {
    formatVersion: 'workspace-write-lease-protocol-v2'
  });
}

test('workspace writer lease is exclusive, exactly reentrant, and rejects mismatched release', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:one',
      createId: ids('one'),
      processAlive: () => 'alive'
    });
    const contender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 200,
      processNonce: 'process:two',
      createId: ids('two'),
      processAlive: () => 'alive'
    });
    const lease = await manager.acquire(workspaceRoot);
    await expect(contender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-001'
    });

    let observed: WorkspaceWriteLeaseToken | undefined;
    await manager.withLease(workspaceRoot, lease.token, async (token) => {
      observed = token;
      await manager.assertOwned(workspaceRoot, token);
    });
    expect(observed).toEqual(lease.token);

    await contender.assertOwned(workspaceRoot, lease.token);
    await expect(contender.withLease(workspaceRoot, lease.token, async () => undefined)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    await expect(contender.release(workspaceRoot, lease.token)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    const sameHolderDifferentManager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:one',
      createId: ids('same-holder'),
      processAlive: () => 'alive'
    });
    await sameHolderDifferentManager.assertOwned(workspaceRoot, lease.token);
    await expect(sameHolderDifferentManager.withControlPlaneQuiesced(
      workspaceRoot,
      lease.token,
      async () => undefined
    )).rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-002' });
    await lease.assertOwned();

    const forged = { ...lease.token, leaseId: 'forged' };
    await expect(manager.release(workspaceRoot, forged)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    await lease.assertOwned();
    await lease.release();
    await expect(lease.assertOwned()).rejects.toBeInstanceOf(WorkspaceWriteLeaseError);
  }, 'engineering-compiler-workspace-lease-exclusive-');
});

test('same-host dead stale lease is terminalized while live, foreign, and unknown owners fail closed', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let clock = 1_000;
    const original = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:original',
      now: () => clock,
      createId: ids('original'),
      processAlive: () => 'alive'
    });
    const abandoned = await original.acquire(workspaceRoot);
    clock = 4_000;

    const liveContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 200,
      processNonce: 'process:live',
      now: () => clock,
      createId: ids('live'),
      processAlive: () => 'alive'
    });
    await expect(liveContender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-001'
    });

    const foreignContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'foreign-host',
      pid: 300,
      processNonce: 'process:foreign',
      now: () => clock,
      createId: ids('foreign'),
      processAlive: () => 'dead'
    });
    await expect(foreignContender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-003'
    });

    const unknownContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 400,
      processNonce: 'process:unknown',
      now: () => clock,
      createId: ids('unknown'),
      processAlive: () => 'unknown'
    });
    await expect(unknownContender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-003'
    });

    const deadContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 500,
      processNonce: 'process:dead',
      now: () => clock,
      createId: ids('dead'),
      processAlive: () => 'dead'
    });
    const replacement = await deadContender.acquire(workspaceRoot);
    await replacement.assertOwned();
    await expect(abandoned.assertOwned()).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    await replacement.release();
  }, 'engineering-compiler-workspace-lease-reclaim-');
});

test('lease errors expose stable safe details without workspace paths', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:safe',
      createId: ids('safe'),
      processAlive: () => 'alive'
    });
    const lease = await manager.acquire(workspaceRoot);
    try {
      await manager.acquire(workspaceRoot);
      throw new Error('Expected lease contention');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceWriteLeaseError);
      expect(JSON.stringify(error)).not.toContain(workspaceRoot);
      expect((error as WorkspaceWriteLeaseError).details).toEqual({ retryable: true });
    }
    await lease.release();
  }, 'engineering-compiler-workspace-lease-safe-diagnostic-');
});

test('an empty protocol root is completed without ever exposing an incomplete owner', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const localState = path.join(workspaceRoot, '.sec');
    const fixedLease = path.join(localState, 'workspace-write-lease');
    await mkdir(fixedLease, { recursive: true });
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:empty-fixed',
      createId: ids('empty-fixed'),
      processAlive: () => 'dead'
    });

    const handle = await manager.acquire(workspaceRoot);
    const activeOwner = (await readdir(fixedLease)).find((entry) => entry.endsWith('.owner.json'));
    expect(activeOwner).toBeDefined();
    const owner = JSON.parse(await readFile(path.join(fixedLease, activeOwner!), 'utf8'));
    expect(owner).toMatchObject({
      formatVersion: 'workspace-write-lease-token-v2',
      generation: 1,
      leaseId: handle.token.leaseId
    });
    expect((await lstat(path.join(fixedLease, activeOwner!))).nlink).toBe(2);
    expect((await readdir(fixedLease)).sort()).toEqual([
      activeOwner!,
      'holders',
      'protocol.json'
    ].sort());
    await handle.release();
    expect((await readdir(fixedLease)).sort()).toEqual([
      activeOwner!,
      activeOwner!.replace('.owner.json', '.terminal.json'),
      'holders',
      'protocol.json'
    ].sort());
    expect(await readdir(localState)).toEqual(['workspace-write-lease']);
  }, 'engineering-compiler-workspace-lease-empty-fixed-');
});

test('restart removes only the exact protocol publication alias before owner publication', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixedLease = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    const holders = path.join(fixedLease, 'holders');
    const marker = path.join(fixedLease, 'protocol.json');
    const alias = path.join(holders, immutableCandidateName('protocol', 'crash-after-link'));
    await mkdir(holders, { recursive: true });
    await writeDurableProtocolCandidate(alias);
    await link(alias, marker);

    const [markerBefore, aliasBefore] = await Promise.all([
      lstat(marker, { bigint: true }),
      lstat(alias, { bigint: true })
    ]);
    expect(markerBefore.dev).toBe(aliasBefore.dev);
    expect(markerBefore.ino).toBe(aliasBefore.ino);
    expect(markerBefore.nlink).toBe(2n);
    expect(aliasBefore.nlink).toBe(2n);

    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:protocol-restart',
      createId: ids('protocol-restart'),
      processAlive: () => 'dead'
    });
    const handle = await manager.acquire(workspaceRoot);
    expect(await pathExists(alias)).toBe(false);
    const markerAfter = await lstat(marker, { bigint: true });
    expect(markerAfter.dev).toBe(markerBefore.dev);
    expect(markerAfter.ino).toBe(markerBefore.ino);
    expect(markerAfter.nlink).toBe(1n);
    expect(handle.token.generation).toBe(1);
    await manager.withControlPlaneQuiesced(workspaceRoot, handle.token, async () => undefined);
    await handle.release();
  }, 'engineering-compiler-workspace-lease-protocol-restart-');
});

test('protocol alias recovery rejects external, noncanonical, multiple, and identity-mismatched names', async () => {
  const scenarios = [
    {
      name: 'external',
      prepare: async (fixedLease: string, holders: string, marker: string): Promise<readonly string[]> => {
        const alias = path.join(path.dirname(fixedLease), immutableCandidateName('protocol', 'external'));
        await writeDurableProtocolCandidate(alias);
        await link(alias, marker);
        return [alias];
      }
    },
    {
      name: 'noncanonical',
      prepare: async (_fixedLease: string, holders: string, marker: string): Promise<readonly string[]> => {
        const alias = path.join(holders, 'protocol-publication-residue');
        await writeDurableProtocolCandidate(alias);
        await link(alias, marker);
        return [alias];
      }
    },
    {
      name: 'multiple',
      prepare: async (_fixedLease: string, holders: string, marker: string): Promise<readonly string[]> => {
        const first = path.join(holders, immutableCandidateName('protocol', 'multiple-one'));
        const second = path.join(holders, immutableCandidateName('protocol', 'multiple-two'));
        await writeDurableProtocolCandidate(first);
        await link(first, marker);
        await link(first, second);
        return [first, second];
      }
    },
    {
      name: 'identity-mismatch',
      prepare: async (fixedLease: string, holders: string, marker: string): Promise<readonly string[]> => {
        const external = path.join(path.dirname(fixedLease), immutableCandidateName('protocol', 'identity-external'));
        const unrelated = path.join(holders, immutableCandidateName('protocol', 'identity-unrelated'));
        await writeDurableProtocolCandidate(external);
        await link(external, marker);
        await writeDurableProtocolCandidate(unrelated);
        return [external, unrelated];
      }
    }
  ] as const;

  for (const scenario of scenarios) {
    await withTempWorkspace(async (workspaceRoot) => {
      const fixedLease = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
      const holders = path.join(fixedLease, 'holders');
      const marker = path.join(fixedLease, 'protocol.json');
      await mkdir(holders, { recursive: true });
      const aliases = await scenario.prepare(fixedLease, holders, marker);
      const manager = createWorkspaceWriteLeaseManager({
        hostname: 'lease-test-host',
        pid: 100,
        processNonce: `process:protocol-${scenario.name}`,
        createId: ids(`protocol-${scenario.name}`),
        processAlive: () => 'dead'
      });

      await expect(manager.acquire(workspaceRoot)).rejects.toMatchObject({
        code: 'WORKSPACE-WRITE-LEASE-003'
      });
      const rootEntries = await readdir(fixedLease);
      expect(rootEntries.some((entry) => entry.endsWith('.owner.json'))).toBe(false);
      for (const alias of aliases) {
        expect(await pathExists(alias)).toBe(true);
      }
    }, `engineering-compiler-workspace-lease-protocol-${scenario.name}-`);
  }
});

test('a terminal publication alias is non-authoritative and cannot block successor quiescence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const original = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:terminal-original',
      createId: ids('terminal-original'),
      processAlive: () => 'alive'
    });
    const abandoned = await original.acquire(workspaceRoot);
    const fixedLease = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    const holders = path.join(fixedLease, 'holders');
    const alias = path.join(holders, immutableCandidateName('terminal', 'crash-after-link'));
    const target = path.join(fixedLease, '0000000000000001.terminal.json');
    await writeDurableJsonCandidate(alias, {
      formatVersion: 'workspace-write-lease-terminal-v2',
      token: abandoned.token,
      outcome: 'released',
      terminalAtMs: Date.now()
    });
    await link(alias, target);
    const [targetMetadata, aliasMetadata] = await Promise.all([
      lstat(target, { bigint: true }),
      lstat(alias, { bigint: true })
    ]);
    expect(targetMetadata.dev).toBe(aliasMetadata.dev);
    expect(targetMetadata.ino).toBe(aliasMetadata.ino);
    expect(targetMetadata.nlink).toBe(2n);

    const successorManager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 200,
      processNonce: 'process:terminal-successor',
      createId: ids('terminal-successor'),
      processAlive: () => 'dead'
    });
    const successor = await successorManager.acquire(workspaceRoot);
    expect(successor.token.generation).toBe(2);
    const terminalResidue = await inspectWorkspaceWriteLease(workspaceRoot);
    expect(terminalResidue).toMatchObject({
      state: 'active',
      activeGeneration: 2,
      ownerGenerations: [1, 2],
      terminalGenerations: [1]
    });
    expect(terminalResidue.authorityPaths).toContain(target);
    expect(terminalResidue.authorityPaths).toContain(alias);
    await successorManager.withControlPlaneQuiesced(
      workspaceRoot,
      successor.token,
      async () => undefined
    );
    await successor.release();
    await expect(abandoned.release()).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
  }, 'engineering-compiler-workspace-lease-terminal-residue-');
});

test('owner publication durability uncertainty preserves the complete holder for restart recovery', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const failedPublisher = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1,
      staleAfterMs: 10,
      hostname: 'durability-host',
      pid: 41_001,
      processNonce: 'process:durability-unknown',
      now: () => 0,
      createId: ids('durability-unknown'),
      ownerPublicationDirectorySync: async () => {
        throw new Error('synthetic-root-directory-fsync-failure');
      }
    });
    let failure: unknown;
    try {
      await failedPublisher.acquire(workspaceRoot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkspaceWriteLeaseError);
    expect((failure as WorkspaceWriteLeaseError).details).toEqual({
      reason: 'publication-durability-unknown',
      retryable: true
    });

    const leaseRoot = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    const holdersRoot = path.join(leaseRoot, 'holders');
    const ownerName = (await readdir(leaseRoot)).find((entry) => entry.endsWith('.owner.json'));
    const holderName = (await readdir(holdersRoot, { withFileTypes: true }))
      .find((entry) => entry.isDirectory())?.name;
    expect(ownerName).toBe('0000000000000001.owner.json');
    expect(holderName).toBeDefined();
    const ledgerOwner = await lstat(path.join(leaseRoot, ownerName!), { bigint: true });
    const holderOwner = await lstat(path.join(holdersRoot, holderName!, 'owner.json'), { bigint: true });
    expect(ledgerOwner.nlink).toBe(2n);
    expect(holderOwner.nlink).toBe(2n);
    expect({ dev: ledgerOwner.dev, ino: ledgerOwner.ino })
      .toEqual({ dev: holderOwner.dev, ino: holderOwner.ino });
    expect(await pathExists(path.join(holdersRoot, holderName!, 'heartbeat.json'))).toBe(true);

    const stranded = await inspectWorkspaceWriteLease(workspaceRoot);
    expect(stranded).toMatchObject({
      state: 'active',
      activeGeneration: 1,
      ownerGenerations: [1],
      terminalGenerations: []
    });
    expect(new Set(stranded.authorityPaths)).toEqual(new Set([
      leaseRoot,
      holdersRoot,
      path.join(leaseRoot, 'protocol.json'),
      path.join(leaseRoot, ownerName!),
      path.join(holdersRoot, holderName!),
      path.join(holdersRoot, holderName!, 'owner.json'),
      path.join(holdersRoot, holderName!, 'heartbeat.json')
    ]));

    const recoveryManager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1,
      staleAfterMs: 10,
      hostname: 'durability-host',
      pid: 41_002,
      processNonce: 'process:durability-recovery',
      now: () => 100,
      createId: ids('durability-recovery'),
      processAlive: () => 'dead'
    });
    const recovered = await recoveryManager.acquire(workspaceRoot);
    expect(recovered.token.generation).toBe(2);
    expect(await inspectWorkspaceWriteLease(workspaceRoot)).toMatchObject({
      state: 'active',
      activeGeneration: 2,
      ownerGenerations: [1, 2],
      terminalGenerations: [1]
    });
    await recovered.release();
    const quiescent = await inspectWorkspaceWriteLease(workspaceRoot);
    expect(quiescent).toMatchObject({
      state: 'quiescent',
      activeGeneration: null,
      terminalGenerations: [1, 2]
    });
    expect(new Set(quiescent.authorityPaths)).toEqual(new Set([
      leaseRoot,
      holdersRoot,
      path.join(leaseRoot, 'protocol.json'),
      path.join(leaseRoot, '0000000000000001.owner.json'),
      path.join(leaseRoot, '0000000000000001.terminal.json'),
      path.join(leaseRoot, '0000000000000002.owner.json'),
      path.join(leaseRoot, '0000000000000002.terminal.json')
    ]));
  }, 'engineering-compiler-workspace-lease-durability-unknown-');
});

test('a legacy v1 owner residue fails closed without guessing migration safety', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixedLease = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    await mkdir(fixedLease, { recursive: true });
    await writeFile(path.join(fixedLease, 'owner.json'), '{}', 'utf8');
    const manager = createWorkspaceWriteLeaseManager({
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:legacy',
      createId: ids('legacy'),
      processAlive: () => 'dead'
    });

    await expect(manager.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-003',
      details: { reason: 'legacy-v1-owner' }
    });
    expect(await readFile(path.join(fixedLease, 'owner.json'), 'utf8')).toBe('{}');
  }, 'engineering-compiler-workspace-lease-legacy-v1-');
});

test('concurrent stale recovery terminalizes one generation without removing its successor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let clock = 1_000;
    const abandonedManager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000,
      staleAfterMs: 2_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:abandoned',
      now: () => clock,
      createId: ids('abandoned'),
      processAlive: () => 'alive'
    });
    const abandoned = await abandonedManager.acquire(workspaceRoot);
    clock = 4_000;
    const contenders = ['left', 'right'].map((identity, index) =>
      createWorkspaceWriteLeaseManager({
        heartbeatIntervalMs: 1_000,
        staleAfterMs: 2_000,
        hostname: 'lease-test-host',
        pid: 200 + index,
        processNonce: `process:${identity}`,
        now: () => clock,
        createId: ids(identity),
        processAlive: () => 'dead'
      })
    );

    const attempts = await Promise.allSettled(contenders.map((manager) => manager.acquire(workspaceRoot)));
    const winners = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const losers = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const winner = winners[0];
    const loser = losers[0];
    if (winner?.status !== 'fulfilled' || loser?.status !== 'rejected') {
      throw new Error('Expected one recovered lease winner and one contender');
    }
    expect(loser.reason).toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-001' });
    expect(winner.value.token.generation).toBe(2);
    await winner.value.assertOwned();
    await expect(abandoned.assertOwned()).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
    await winner.value.release();

    const leaseRoot = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    expect((await readdir(leaseRoot)).filter((entry) => entry.endsWith('.owner.json'))).toHaveLength(2);
    expect((await readdir(leaseRoot)).filter((entry) => entry.endsWith('.terminal.json'))).toHaveLength(2);
  }, 'engineering-compiler-workspace-lease-concurrent-recovery-');
});

test('a malformed highest terminal generation fails closed before any successor publication', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manager = createWorkspaceWriteLeaseManager({
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:terminal-corruption',
      createId: ids('terminal-corruption')
    });
    const handle = await manager.acquire(workspaceRoot);
    await handle.release();
    const leaseRoot = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    const terminal = (await readdir(leaseRoot)).find((entry) => entry.endsWith('.terminal.json'));
    if (!terminal) throw new Error('Expected terminalized generation');
    await writeFile(path.join(leaseRoot, terminal), '{}', 'utf8');

    await expect(manager.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-003'
    });
    expect((await readdir(leaseRoot)).filter((entry) => entry.endsWith('.owner.json'))).toHaveLength(1);
  }, 'engineering-compiler-workspace-lease-terminal-corruption-');
});

test('native local-state filesystem failures become typed diagnostics without absolute paths', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const localState = path.join(workspaceRoot, '.sec');
    await writeFile(localState, 'not-a-directory', 'utf8');
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:native-failure',
      createId: ids('native-failure'),
      processAlive: () => 'alive'
    });

    let failure: unknown;
    try {
      await manager.acquire(workspaceRoot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkspaceWriteLeaseError);
    expect(failure).toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-004' });
    expect(String(failure)).not.toContain(workspaceRoot);
    expect(JSON.stringify(failure)).not.toContain(workspaceRoot);
  }, 'engineering-compiler-workspace-lease-native-failure-');
});

test('generic lease acquisition keeps a missing workspace fail closed with path-free identity details', async () => {
  await withTempWorkspace(async (outerRoot) => {
    const workspaceRoot = path.join(outerRoot, 'missing-workspace');
    const manager = createWorkspaceWriteLeaseManager({
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:missing-workspace',
      createId: ids('missing-workspace'),
      processAlive: () => 'alive'
    });

    let failure: unknown;
    try {
      await manager.acquire(workspaceRoot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(WorkspaceWriteLeaseError);
    expect(failure).toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-004',
      details: {
        operation: 'acquire',
        phase: 'workspace-identity',
        reason: 'missing'
      }
    });
    expect(String(failure)).not.toContain(workspaceRoot);
    expect(JSON.stringify(failure)).not.toContain(workspaceRoot);
    expect(await pathExists(workspaceRoot)).toBe(false);
  }, 'engineering-compiler-workspace-lease-missing-root-');
});

test('lease authority rejects a local-state junction that escapes the canonical workspace', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const outside = path.join(path.dirname(workspaceRoot), `${path.basename(workspaceRoot)}-outside`);
    const localState = path.join(workspaceRoot, '.sec');
    await mkdir(outside, { recursive: true });
    await symlink(outside, localState, process.platform === 'win32' ? 'junction' : 'dir');
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:escaped-parent',
      createId: ids('escaped-parent'),
      processAlive: () => 'alive'
    });
    try {
      await expect(manager.acquire(workspaceRoot)).rejects.toMatchObject({
        code: 'WORKSPACE-WRITE-LEASE-004'
      });
    } finally {
      await unlink(localState).catch(() => undefined);
      await rm(outside, { recursive: true, force: true });
    }
  }, 'engineering-compiler-workspace-lease-escaped-parent-');
});

test('workspace writer lease control-plane quiescence queues heartbeat mutation', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let nowCalls = 0;
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 30_000,
      now: () => {
        nowCalls += 1;
        return nowCalls;
      }
    });
    const handle = await manager.acquire(workspaceRoot);
    let heartbeats: readonly Promise<void>[] = [];
    try {
      const beforeHeartbeat = nowCalls;
      await manager.withControlPlaneQuiesced(workspaceRoot, handle.token, async () => {
        heartbeats = Array.from({ length: 20 }, () => handle.heartbeat());
        await Promise.resolve();
        await Promise.resolve();
        expect(nowCalls).toBe(beforeHeartbeat);
      });
      await Promise.all(heartbeats);
      expect(nowCalls).toBe(beforeHeartbeat + 1);
      await handle.assertOwned();
    } finally {
      await handle.release();
    }
  }, 'workspace-write-lease-quiescence-');
});

test('workspace writer lease quiescence rejects any stable temporary owner artifact', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 30_000
    });
    const handle = await manager.acquire(workspaceRoot);
    const holders = path.join(workspaceRoot, '.sec', 'workspace-write-lease', 'holders');
    const [activeHolder] = await readdir(holders);
    const staleTemporary = path.join(holders, activeHolder!, '.owner-stable.tmp');
    try {
      await writeFile(staleTemporary, '{}', 'utf8');
      await expect(manager.withControlPlaneQuiesced(
        workspaceRoot,
        handle.token,
        async () => undefined
      )).rejects.toMatchObject({
        code: 'WORKSPACE-WRITE-LEASE-002',
        message: 'Workspace writer lease control plane is not canonical'
      });
    } finally {
      await rm(staleTemporary, { force: true });
      await handle.release();
    }
  }, 'workspace-write-lease-noncanonical-control-plane-');
});
