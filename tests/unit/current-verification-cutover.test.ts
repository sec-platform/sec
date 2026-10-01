import { expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lockProject } from '../../src/adapters/compilation/emit/lock-project.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { readLockFile, saveLock } from '../../src/adapters/workspace/lock.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { lockWorkspace } from '../../src/bootstrap/engineering/emit-orchestrator.ts';
import { repairWorkspace } from '../../src/bootstrap/engineering/repair-orchestrator.ts';
import { buildCurrentVerificationLock, writeCurrentVerificationFixture } from '../helpers/current-verification-fixture.ts';

async function workspace(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-current-verification-'));
  try {
    await mkdir(path.dirname(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance)), { recursive: true });
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('current Verification admits Lock publication despite an untrusted pending projection', async () => {
  await workspace(async root => {
    const lock = buildCurrentVerificationLock({ passStatus: { verify: 'pending' } });
    await saveLock(root, lock);
    await writeCurrentVerificationFixture(root, lock);
    const published = await lockWorkspace(root);
    expect(published.passStatus.lock).toBe('succeeded');
    expect(readLockFile(root).passStatus.lock).toBe('succeeded');
    const provenance = JSON.parse(await readFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance), 'utf8'));
    expect(provenance.formatVersion).toBe('1');
  });
});

test('stale Verification A cannot publish Lock B through a forged succeeded projection', async () => {
  await workspace(async root => {
    const lock = buildCurrentVerificationLock();
    await writeCurrentVerificationFixture(root, lock);
    lock.app.name = 'changed semantic subject';
    lock.passStatus.verify = 'succeeded';
    await saveLock(root, lock);
    const lockPath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.graphLock);
    const before = await readFile(lockPath, 'utf8');
    await expect(lockProject(root, lock)).rejects.toThrow('current Lock semantic subject');
    expect(await readFile(lockPath, 'utf8')).toBe(before);
    await expect(access(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance))).rejects.toThrow();
  });
});

test('Lock publication keeps its checked input when the caller mutates an alias across the fence', async () => {
  await workspace(async root => {
    const lock = buildCurrentVerificationLock();
    await saveLock(root, lock);
    await writeCurrentVerificationFixture(root, lock);
    let crossedFence = false;
    const published = await lockProject(root, lock, async () => {
      crossedFence = true;
      lock.app.name = 'caller changed its own input';
    });
    expect(crossedFence).toBe(true);
    expect(published).not.toBe(lock);
    expect(published.app.name).toBe('customer-admin');
    expect(readLockFile(root).app.name).toBe('customer-admin');
    expect(published.passStatus.lock).toBe('succeeded');
    expect(lock.passStatus.lock).toBe('pending');
  });
});

test('current fast and all-lane failed Verification remain usable for Repair with a pending display projection', async () => {
  for (const lane of ['fast', 'all'] as const) await workspace(async root => {
    const lock = buildCurrentVerificationLock({ passStatus: { verify: 'pending' } });
    await saveLock(root, lock);
    await writeCurrentVerificationFixture(root, lock, { failed: true, lane });
    const result = await repairWorkspace(root, { dryRun: true });
    expect(result.repairPlan.status).toBe('blocked');
    expect(result.lock.app.name).toBe('customer-admin');
    await expect(access(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.repairPlan))).rejects.toThrow();
  });
});

test('Repair rejects stale and cross-artifact-inconsistent retained evidence before publication', async () => {
  await workspace(async root => {
    const lock = buildCurrentVerificationLock();
    const artifacts = await writeCurrentVerificationFixture(root, lock, { failed: true, lane: 'fast' });
    lock.app.name = 'changed semantic subject';
    await saveLock(root, lock);
    await expect(repairWorkspace(root)).rejects.toThrow('current Lock semantic subject');
    lock.app.name = 'customer-admin';
    await saveLock(root, lock);
    await writeFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.runtimeReport),
      JSON.stringify({ ...artifacts.runtimeReport, status: 'passed' }));
    await expect(repairWorkspace(root)).rejects.toThrow();
    await expect(access(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.repairPlan))).rejects.toThrow();
  });
});
