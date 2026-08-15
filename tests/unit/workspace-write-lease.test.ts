import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sha256 as canonicalSha256 } from '../../platform/shared/canonical-primitives.ts';
import { pathExists } from '../../platform/shared/fs.ts';
import {
  inspectNoFollowDirectoryChainV1,
  scanNoFollowDirectoryTreeV1
} from '../../platform/shared/physical-no-follow.ts';
import {
  WorkspaceWriteLeaseError,
  completeWorkspaceWriteLeaseRetirementV1,
  createWorkspaceWriteLeaseManager,
  inspectWorkspaceWriteLease,
  recoverWorkspaceWriteLeaseRetirementV1,
  resumeWorkspaceWriteLeaseRetirementV1,
  type WorkspaceWriteLeaseToken
} from '../../platform/shared/workspace-write-lease.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('retirement publishes its acquisition fence before terminalization and rejects holder residue', async () => {
  const source = await Bun.file(new URL('../../platform/shared/workspace-write-lease.ts', import.meta.url)).text();
  const start = source.indexOf('const retireOwnedNamespace = async (');
  const end = source.indexOf('\n      const releaseHandle = async', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const retirement = source.slice(start, end);
  expect(retirement.indexOf('parent: fenceParent, name: receipt.fenceName')).toBeLessThan(
    retirement.indexOf("await publishTerminal(paths, token, 'released')")
  );
  expect(retirement).toContain("entries.some((entry) => entry.relativePath.startsWith(`${HOLDERS_DIRECTORY}/`))");
  expect(retirement).toContain('retirement holder namespace remains after terminal publication');
});

test('retirement fence assertion and completion observe only the exact retained leaf', async () => {
  const source = await Bun.file(new URL('../../platform/shared/workspace-write-lease.ts', import.meta.url)).text();
  const start = source.indexOf('export function assertWorkspaceWriteLeaseRetirementV1(');
  const end = source.indexOf('\n/**', start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const assertion = source.slice(start, end);
  expect(assertion).toContain('inspectNoFollowOrdinaryFileEntryV1(parent, receipt.fenceName)');
  expect(assertion).not.toContain('scanNoFollowDirectoryTreeV1(parent)');
  const completionStart = source.indexOf('export function completeWorkspaceWriteLeaseRetirementV1(');
  const completionEnd = source.indexOf('\nasync function ensureProtocolRoot(', completionStart);
  expect(completionStart).toBeGreaterThanOrEqual(0);
  expect(completionEnd).toBeGreaterThan(completionStart);
  const completion = source.slice(completionStart, completionEnd);
  expect(completion).toContain('inspectNoFollowOrdinaryFileEntryV1(parent, receipt.fenceName)');
  expect(completion).not.toContain('scanNoFollowDirectoryTreeV1(parent)');
  const recoveryStart = source.indexOf('export function recoverWorkspaceWriteLeaseRetirementV1(');
  const recoveryEnd = source.indexOf('\nfunction readPreterminalRetirementReceiptV1(', recoveryStart);
  expect(recoveryStart).toBeGreaterThanOrEqual(0);
  expect(recoveryEnd).toBeGreaterThan(recoveryStart);
  const recovery = source.slice(recoveryStart, recoveryEnd);
  expect(recovery).toContain('inspectNoFollowOrdinaryFileEntryV1(parent, expectedFenceName)');
  expect(recovery).not.toContain('scanNoFollowDirectoryTreeV1(parent)');
  expect(recovery).toContain('snapshotRetirementRecoveryInputV1(input)');
  expect(recovery.slice(recovery.indexOf('snapshotRetirementRecoveryInputV1(input)') + 'snapshotRetirementRecoveryInputV1(input)'.length)).not.toContain('input.');
  const resumeStart = source.indexOf('export async function resumeWorkspaceWriteLeaseRetirementV1(');
  const resumeEnd = source.indexOf('\nexport function completeWorkspaceWriteLeaseRetirementV1(', resumeStart);
  const resume = source.slice(resumeStart, resumeEnd);
  expect(resume).toContain('snapshotRetirementRecoveryInputV1(input)');
  expect(resume).not.toContain('input.proofParent');
  const preterminalStart = source.indexOf('function readPreterminalRetirementReceiptV1(');
  const preterminalEnd = source.indexOf('\n/**', preterminalStart + 1);
  const preterminal = source.slice(preterminalStart, preterminalEnd);
  expect(preterminal).not.toContain('input.proofParent === undefined');
  expect(preterminal).not.toContain('? fenceParent');
  const discardStart = source.indexOf('function discardExactPreFenceTransitionV1(');
  const discardEnd = source.indexOf('\n/**', discardStart + 1);
  const discard = source.slice(discardStart, discardEnd);
  expect(discard).toContain('readonly proofParent:');
  expect(discard).not.toContain('input.proofParent === undefined');
  expect(discard).not.toContain('retirementFenceParent(input.workspaceRoot)');
});

test('retirement recovery and physically absent completion ignore an oversized unrelated sibling', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const parentPath = path.dirname(workspaceRoot);
    const suffix = path.basename(workspaceRoot);
    const proofRootPath = path.join(parentPath, `${suffix}-retirement-proof`);
    const unrelatedPath = path.join(parentPath, `${suffix}-unrelated-large.bin`);
    await mkdir(proofRootPath);
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000_000,
      staleAfterMs: 2_000_000,
      hostname: os.hostname(),
      pid: process.pid,
      processNonce: `process:${suffix}`,
      now: () => 0,
      createId: ids(`completion-${suffix}`),
      processAlive: () => 'alive'
    });
    const lease = await manager.acquire(workspaceRoot);
    let fencePath: string | null = null;
    try {
      const proofParent = inspectNoFollowDirectoryChainV1(proofRootPath, 'completion proof root').target;
      const intentDigest = sha256({ domain: 'absent-completion-large-sibling' });
      const receipt = await lease.retireOwnedNamespace(intentDigest, proofParent);
      fencePath = path.join(parentPath, receipt.fenceName);
      await writeFile(unrelatedPath, Buffer.alloc(65 * 1024 * 1024));
      expect(() => recoverWorkspaceWriteLeaseRetirementV1({ workspaceRoot, intentDigest } as never)).toThrow(WorkspaceWriteLeaseError);
      let workspaceRootReads = 0;
      let intentDigestReads = 0;
      let proofParentReads = 0;
      const recovered = recoverWorkspaceWriteLeaseRetirementV1({
        get workspaceRoot() {
          workspaceRootReads += 1;
          return workspaceRootReads === 1 ? workspaceRoot : path.join(parentPath, `${suffix}-attacker-workspace`);
        },
        get intentDigest() {
          intentDigestReads += 1;
          return intentDigestReads === 1 ? intentDigest : canonicalSha256({ domain: 'attacker-intent' });
        },
        get proofParent() {
          proofParentReads += 1;
          return proofParentReads === 1 ? proofParent : undefined;
        }
      } as Parameters<typeof recoverWorkspaceWriteLeaseRetirementV1>[0]);
      expect(recovered.retirementDigest).toBe(receipt.retirementDigest);
      expect(workspaceRootReads).toBe(1);
      expect(intentDigestReads).toBe(1);
      expect(proofParentReads).toBe(1);
      await rm(workspaceRoot, { recursive: true, force: true });

      completeWorkspaceWriteLeaseRetirementV1({ workspaceRoot, receipt });

      expect(await pathExists(fencePath)).toBe(false);
    } finally {
      await lease.release().catch(() => undefined);
      await rm(unrelatedPath, { force: true });
      await rm(proofRootPath, { recursive: true, force: true });
      if (fencePath !== null) await rm(fencePath, { force: true });
    }
  }, 'workspace-write-lease-absent-completion-');
}, 20_000);

function ids(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${next += 1}`;
}

function immutableCandidateName(kind: string, id: string): string {
  const digest = createHash('sha256').update(JSON.stringify({ kind, id })).digest('hex');
  return `.${kind}-${digest}.candidate`;
}

function sha256(value: unknown): `sha256:${string}` {
  return canonicalSha256(value) as `sha256:${string}`;
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
    formatVersion: 'workspace-write-lease-protocol-v3'
  });
}

test('pre-fence recovery removes one exact no-replace publication candidate before stale takeover', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 1_000_000,
      staleAfterMs: 2_000_000,
      hostname: os.hostname(),
      pid: 2_147_483_000,
      processNonce: 'process:pre-fence-candidate',
      now: () => 0,
      createId: ids('pre-fence-candidate'),
      processAlive: () => 'dead'
    });
    const lease = await manager.acquire(workspaceRoot);
    const proofRootPath = path.join(workspaceRoot, 'retirement-proof');
    await mkdir(proofRootPath);
    const workspace = inspectNoFollowDirectoryChainV1(workspaceRoot, 'test workspace').target;
    const namespace = inspectNoFollowDirectoryChainV1(
      path.join(workspaceRoot, '.sec', 'workspace-write-lease'),
      'test lease namespace'
    ).target;
    const proofParent = inspectNoFollowDirectoryChainV1(proofRootPath, 'test proof root').target;
    const intentDigest = sha256({ domain: 'pre-fence-candidate-test' });
    const namespaceEntries = scanNoFollowDirectoryTreeV1(namespace).map((entry) => ({
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      size: entry.size,
      bytes: entry.bytes === null ? null : Buffer.from(entry.bytes).toString('hex')
    }));
    const material = {
      formatVersion: 'workspace-write-lease-retirement-transition-v1' as const,
      workspaceIdentityDigest: lease.token.workspaceIdentityDigest,
      workspaceDevice: workspace.device,
      workspaceInode: workspace.inode,
      intentDigest,
      token: lease.token,
      namespaceDevice: namespace.device,
      namespaceInode: namespace.inode,
      namespaceTombstoneParentDevice: proofParent.device,
      namespaceTombstoneParentInode: proofParent.inode,
      namespaceEntries
    };
    const transition = { ...material, transitionDigest: sha256(material) };
    const finalName = `.workspace-write-lease-transition-${transition.transitionDigest.slice('sha256:'.length)}.json`;
    const candidateName = `.${finalName}.00000000-0000-4000-8000-000000000000.candidate`;
    await writeFile(path.join(proofRootPath, candidateName), `${JSON.stringify(transition)}\n`, 'utf8');

    try {
      const receipt = await resumeWorkspaceWriteLeaseRetirementV1({
        workspaceRoot,
        intentDigest,
        proofParent
      });
      completeWorkspaceWriteLeaseRetirementV1({ workspaceRoot, receipt });
      expect(receipt.intentDigest).toBe(intentDigest);
      expect(await pathExists(path.join(path.dirname(workspaceRoot), receipt.fenceName))).toBe(false);
      expect(await pathExists(path.join(proofRootPath, candidateName))).toBe(false);
      expect((await readdir(proofRootPath)).some((name) => name.endsWith('.candidate'))).toBe(false);
    } finally {
      await lease.release().catch(() => undefined);
    }
  }, 'workspace-write-lease-pre-fence-candidate-');
}, 20_000);

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

test('retained physical relocation preserves one lease token across a same-parent rename', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000, staleAfterMs: 20_000,
      hostname: 'lease-relocation-host', pid: 333, processNonce: 'relocation', createId: ids('relocation'), processAlive: () => 'alive'
    });
    const original = path.join(workspaceRoot, 'target');
    const tombstone = path.join(workspaceRoot, 'target-tombstone');
    const other = path.join(workspaceRoot, 'other');
    await Promise.all([mkdir(original), mkdir(other)]);
    const lease = await manager.acquire(original);
    await rename(original, tombstone);
    await expect(manager.assertOwned(original, lease.token)).rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-002' });
    await lease.relocate(tombstone);
    await lease.assertOwned();
    await expect(lease.ownedNamespace()).resolves.toEqual({
      workspaceRoot: tombstone,
      relativePath: '.sec/workspace-write-lease'
    });
    await lease.heartbeat();
    await expect(lease.relocate(other)).rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-002' });
    await expect(manager.acquire(tombstone)).rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-001' });
    await lease.release();
    const successor = await manager.acquire(tombstone);
    await successor.release();
  }, 'engineering-compiler-workspace-lease-relocation-');
});

test('incomplete V2 protocol remains a typed migration boundary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const leaseDirectory = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    await mkdir(leaseDirectory, { recursive: true });
    await writeFile(path.join(leaseDirectory, 'protocol.json'), '{"formatVersion":"workspace-write-lease-protocol-v2"}\n');
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000, staleAfterMs: 20_000,
      hostname: 'lease-v3-host', pid: 334, processNonce: 'v3', createId: ids('v3'), processAlive: () => 'alive'
    });
    await expect(manager.acquire(workspaceRoot)).rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-003' });
  }, 'engineering-compiler-workspace-lease-v3-migration-');
});

test('a complete V2 ledger remains an external typed migration boundary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const leaseDirectory = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    await mkdir(path.join(leaseDirectory, 'holders'), { recursive: true });
    await writeFile(path.join(leaseDirectory, 'protocol.json'), '{"formatVersion":"workspace-write-lease-protocol-v2"}\n');
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000, staleAfterMs: 20_000,
      hostname: 'lease-v2-boundary', pid: 335, processNonce: 'v2-boundary', createId: ids('v2-boundary'), processAlive: () => 'dead'
    });
    await expect(manager.acquire(workspaceRoot)).rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-003' });
  }, 'engineering-compiler-workspace-lease-v2-boundary-');
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
    // The simulated crashed process cannot release its authority, but this
    // in-process handle still owns a heartbeat timer. Exercise the rejected
    // release so the test does not leak that timer into later test cases.
    await expect(abandoned.release()).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });
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
      formatVersion: 'workspace-write-lease-token-v3',
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

test('a public same-token terminal cannot retire a live holder and only stale dead recovery admits a successor', async () => {
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
      formatVersion: 'workspace-write-lease-terminal-v3',
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

    const liveContender = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 200,
      processNonce: 'process:terminal-successor',
      createId: ids('terminal-successor'),
      processAlive: () => 'alive'
    });
    await expect(liveContender.acquire(workspaceRoot)).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-001'
    });
    expect((await readdir(holders, { withFileTypes: true })).some((entry) => entry.isDirectory())).toBe(true);

    const successorManager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 200,
      processNonce: 'process:terminal-stale-successor',
      createId: ids('terminal-stale-successor'),
      now: () => Date.now() + 30_000,
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
        throw Object.assign(new Error('synthetic-root-directory-fsync-failure'), { code: 'EIO' });
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
      operation: 'acquire',
      phase: 'owner-publication',
      systemCode: 'EIO',
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
    await expect(abandoned.release()).rejects.toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-002'
    });

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
    expect(failure).toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-004',
      details: {
        operation: 'acquire',
        phase: 'lease-root-initialization',
        systemCode: 'EEXIST'
      }
    });
    expect(String(failure)).not.toContain(workspaceRoot);
    expect(JSON.stringify(failure)).not.toContain(workspaceRoot);
  }, 'engineering-compiler-workspace-lease-native-failure-');
});

test('acquisition diagnostics retain a safe phase and system code without raw error text', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const nativeFailure = Object.assign(
      new Error(`secret native failure at ${workspaceRoot}`),
      { code: 'EMFILE' }
    );
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:phase-diagnostic',
      createId: ids('phase-diagnostic'),
      now: () => { throw nativeFailure; },
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
        phase: 'acquisition-clock',
        systemCode: 'EMFILE'
      }
    });
    expect(JSON.stringify(failure)).not.toContain(workspaceRoot);
    expect(JSON.stringify(failure)).not.toContain('secret native failure');
  }, 'engineering-compiler-workspace-lease-phase-diagnostic-');
});

test('acquisition system-code projection rejects hostile and unbounded values', async () => {
  const hostileCodes: readonly unknown[] = [
    String.raw`D:\secret\workspace\tenant-a`,
    '/secret/workspace/tenant-a',
    'x'.repeat(65),
    'EMFILE\nD:\\secret',
    '路径',
    7
  ];
  for (const [index, hostileCode] of hostileCodes.entries()) {
    await withTempWorkspace(async (workspaceRoot) => {
      const nativeFailure = Object.assign(new Error('fixed safe failure'), { code: hostileCode });
      const manager = createWorkspaceWriteLeaseManager({
        heartbeatIntervalMs: 10_000,
        staleAfterMs: 20_000,
        hostname: 'lease-test-host',
        pid: 100,
        processNonce: `process:hostile-code-${index}`,
        createId: ids(`hostile-code-${index}`),
        now: () => { throw nativeFailure; },
        processAlive: () => 'alive'
      });

      let failure: unknown;
      try {
        await manager.acquire(workspaceRoot);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({
        code: 'WORKSPACE-WRITE-LEASE-004',
        details: {
          operation: 'acquire',
          phase: 'acquisition-clock',
          systemCode: 'UNKNOWN'
        }
      });
      const projections = [String(failure), JSON.stringify(failure)];
      expect(projections.join('\n')).not.toContain(workspaceRoot);
      if (typeof hostileCode === 'string') {
        expect(projections.join('\n')).not.toContain(hostileCode);
      }
    }, `engineering-compiler-workspace-lease-hostile-code-${index}-`);
  }
});

test('acquisition callbacks cannot self-issue trusted error messages or details', async () => {
  for (const scenario of [
    {
      name: 'clock',
      phase: 'acquisition-clock',
      expectedMessage: 'Workspace writer lease acquisition clock failed',
      capability: (failure: WorkspaceWriteLeaseError) => ({
        now: () => { throw failure; },
        createId: ids('typed-clock')
      })
    },
    {
      name: 'identity',
      phase: 'lease-root-initialization',
      expectedMessage: 'Workspace writer lease root could not be initialized',
      capability: (failure: WorkspaceWriteLeaseError) => ({
        now: () => 0,
        createId: () => { throw failure; }
      })
    }
  ] as const) {
    await withTempWorkspace(async (workspaceRoot) => {
      const hostileMessage = `self-issued failure at ${workspaceRoot}`;
      const failure = new WorkspaceWriteLeaseError(
        'WORKSPACE-WRITE-LEASE-004',
        hostileMessage,
        {
          leakedPath: workspaceRoot,
          systemCode: 'EMFILE'
        }
      );
      const manager = createWorkspaceWriteLeaseManager({
        heartbeatIntervalMs: 10_000,
        staleAfterMs: 20_000,
        hostname: 'lease-test-host',
        pid: 100,
        processNonce: `process:self-issued-${scenario.name}`,
        ...scenario.capability(failure),
        processAlive: () => 'alive'
      });

      let observed: unknown;
      try {
        await manager.acquire(workspaceRoot);
      } catch (error) {
        observed = error;
      }
      expect(observed).toBeInstanceOf(WorkspaceWriteLeaseError);
      expect(observed).toMatchObject({
        code: 'WORKSPACE-WRITE-LEASE-004',
        message: scenario.expectedMessage,
        details: {
          operation: 'acquire',
          phase: scenario.phase,
          systemCode: 'EMFILE'
        }
      });
      expect(Object.keys((observed as WorkspaceWriteLeaseError).details).sort()).toEqual([
        'operation',
        'phase',
        'systemCode'
      ]);
      const projections = `${String(observed)}\n${JSON.stringify(observed)}`;
      expect(projections).not.toContain(hostileMessage);
      expect(projections).not.toContain(workspaceRoot);
      expect(projections).not.toContain('leakedPath');
    }, `engineering-compiler-workspace-lease-self-issued-${scenario.name}-`);
  }
});

test('acquisition validates identity callback results before serialization', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let callerSerializationRan = false;
    const hostileResult = {
      toJSON: () => {
        callerSerializationRan = true;
        throw new Error(`serialize ${workspaceRoot}`);
      }
    } as unknown as string;
    const manager = createWorkspaceWriteLeaseManager({
      heartbeatIntervalMs: 10_000,
      staleAfterMs: 20_000,
      hostname: 'lease-test-host',
      pid: 100,
      processNonce: 'process:invalid-identity-result',
      now: () => 0,
      createId: () => hostileResult,
      processAlive: () => 'alive'
    });

    let observed: unknown;
    try {
      await manager.acquire(workspaceRoot);
    } catch (error) {
      observed = error;
    }
    expect(callerSerializationRan).toBe(false);
    expect(observed).toMatchObject({
      code: 'WORKSPACE-WRITE-LEASE-004',
      message: 'Workspace writer lease root could not be initialized',
      details: {
        operation: 'acquire',
        phase: 'lease-root-initialization',
        systemCode: 'UNKNOWN'
      }
    });
    const projections = `${String(observed)}\n${JSON.stringify(observed)}`;
    expect(projections).not.toContain(workspaceRoot);
    expect(projections).not.toContain('serialize');
  }, 'engineering-compiler-workspace-lease-invalid-identity-result-');
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
        reason: 'missing',
        systemCode: 'PHYSICAL_NO_FOLLOW_ABSENT'
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
