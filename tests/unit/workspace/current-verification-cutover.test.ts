import { expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lockProject } from '../../../src/adapters/compilation/emit/lock-project.ts';
import { readOptionalCurrentVerificationPublication } from '../../../src/adapters/verification/platform/artifact/runtime/authority.ts';
import { writeRepairPlan } from '../../../src/adapters/verification/repair/write-repair-plan.ts';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { readLockFile, saveLock } from '../../../src/adapters/workspace/lock.ts';
import { buildRepairPlan } from '../../../src/application/repair-plan.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { assertProductVerificationArtifactSubject } from '../../../src/assurance/verification/project/report.ts';
import { lockWorkspace } from '../../../src/bootstrap/engineering/emit-orchestrator.ts';
import { repairWorkspace } from '../../../src/bootstrap/engineering/repair-orchestrator.ts';
import { digest } from '../../../src/contracts/canonical.ts';
import { buildCurrentVerificationLock, writeCurrentVerificationFixture } from '../../helpers/current-verification-fixture.ts';

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
    expect(published.app.name).toBe('customer-admin');
    expect(readLockFile(root).app.name).toBe('customer-admin');
    expect(published.passStatus.lock).toBe('succeeded');
    expect(lock.passStatus.lock).toBe('pending');
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

const reportFaults = [
  ['passed summary over failed fast evidence', (report) => { report.summary.status = 'passed'; }],
  ['unknown summary status', (report) => { Object.assign(report.summary, { status: 'unknown' }); }],
  ['omitted failed lane', (report) => { report.summary.failedLanes = []; }],
  ['inconsistent fast projection', (report) => { report.unit.status = 'passed'; }],
  ['inconsistent claim result', (report) => { report.summary.claimSummary!.overall.overallStatus = 'passed'; }],
  ['unknown requested lane', (report) => { Object.assign(report.summary, { requestedLane: 'unknown' }); }]
] satisfies Array<[string, (report: Awaited<ReturnType<typeof writeCurrentVerificationFixture>>['verificationReport']) => void]>;
test('Repair rejects every partial-lane forgery before a no-op or publication', async () => {
  await workspace(async root => {
    const lock = buildCurrentVerificationLock({ passStatus: { verify: 'pending' } });
    await saveLock(root, lock);
    const original = await writeCurrentVerificationFixture(root, lock, { failed: true, lane: 'fast' });
    for (const [label, mutate] of reportFaults) {
      const verificationReport = structuredClone(original.verificationReport);
      mutate(verificationReport);
      // Every consumer reopens the retained bytes. Replace the complete report
      // from the valid baseline so no earlier forgery can mask this fault.
      await writeFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.verificationReport), JSON.stringify(verificationReport));
      await expect(repairWorkspace(root, { dryRun: true }), label).rejects.toThrow('profile-aware canonical schema');
      await expect(repairWorkspace(root), label).rejects.toThrow('profile-aware canonical schema');
      await expect(access(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.repairPlan))).rejects.toThrow();
    }
  });
});

for (const mode of ['partial', 'failed-all'] as const) {
  test(`current ${mode} evidence cannot authorize Lock publication through a succeeded display flag`, async () => {
    await workspace(async root => {
      const lock = buildCurrentVerificationLock({ passStatus: { verify: 'succeeded' } });
      await saveLock(root, lock);
      await writeCurrentVerificationFixture(root, lock, mode === 'partial' ? { lane: 'fast' } : { failed: true });
      const lockPath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.graphLock);
      const before = await readFile(lockPath);
      await expect(lockProject(root, lock)).rejects.toThrow();
      expect(await readFile(lockPath)).toEqual(before);
      expect(lock.passStatus.lock).toBe('pending');
      await expect(access(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance))).rejects.toThrow();
    });
  });
}

test('current-subject gate binding rejects missing, duplicate and foreign bindings', async () => {
  await workspace(async root => {
    const lock = buildCurrentVerificationLock();
    const original = await writeCurrentVerificationFixture(root, lock);
    for (const fault of ['missing', 'duplicate', 'foreign-gate', 'foreign-subject', 'foreign-input'] as const) {
      const { verificationReport, acceptanceCoverage } = structuredClone(original);
      const gates = [...verificationReport.summary.claimSummary!.gates];
      Object.assign(verificationReport.summary.claimSummary!, { gates });
      if (fault === 'missing') gates.pop();
      else if (fault === 'duplicate') gates[1] = structuredClone(gates[0]!);
      else if (fault === 'foreign-gate') Object.assign(gates[0]!, { gateId: 'foreign-gate' });
      else if (fault === 'foreign-subject') Object.assign(gates[0]!, { subjectRevision: 'sha256:' + 'e'.repeat(64) });
      else Object.assign(gates[0]!, { inputDigest: 'sha256:' + 'f'.repeat(64) });
      expect(() => assertProductVerificationArtifactSubject(lock, { verificationReport, acceptanceCoverage }), fault)
        .toThrow(expect.objectContaining({ code: 'VERIFY-SUBJECT-002' }));
    }
  });
});

for (const lane of ['fast', 'all'] as const) {
  for (const failed of [false, true]) {
    test(`real Repair writer publishes ${lane} ${failed ? 'blocked' : 'skipped'} diagnostics and one final Lock`, async () => {
      await workspace(async root => {
        const lock = buildCurrentVerificationLock({ passStatus: { verify: 'pending' } });
        await saveLock(root, lock);
        await writeCurrentVerificationFixture(root, lock, { lane, failed });
        // Preview must remain read-only even when the same current evidence
        // can subsequently authorize this separate publication invocation.
        const preview = await repairWorkspace(root, { dryRun: true });
        expect(preview.repairPlan.status).toBe(failed ? 'blocked' : 'skipped');
        if (failed) expect(preview.lock.app.name).toBe('customer-admin');
        else expect(preview.repairPlan.sourceVerificationStatus).toBe('passed');
        await expect(access(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.repairPlan))).rejects.toThrow();
        if (failed) {
          await expect(repairWorkspace(root)).rejects.toMatchObject({ code: 'REPAIR-BLOCKED-001' });
        } else {
          const result = await repairWorkspace(root);
          expect(result.repairPlan.status).toBe('skipped');
          expect(result.lock.passStatus.repair).toBe('skipped');
        }
        const plan = JSON.parse(await readFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.repairPlan), 'utf8'));
        expect(plan.status).toBe(failed ? 'blocked' : 'skipped');
        expect(plan.sourceVerificationStatus).toBe(failed ? 'failed' : 'passed');
        const durableLock = readLockFile(root);
        expect(durableLock.passStatus.repair).toBe(failed ? 'failed' : 'skipped');
        expect(durableLock.passStatus.verify).toBe('pending');
        expect(durableLock.passStatus.lock).toBe('pending');
        expect(durableLock.generatedPaths).toEqual(expect.arrayContaining([
          CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.provenance
        ]));
        const provenance = JSON.parse(await readFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance), 'utf8'));
        expect(provenance.artifacts).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: CI_ARTIFACT_FILES.repairPlan, generatedByPass: 'repair',
            hash: digest(await readFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.repairPlan))) }),
          expect.objectContaining({ path: CI_ARTIFACT_FILES.provenance, generatedByPass: 'lock' })
        ]));
      });
    });
  }
}

test('real Repair writer captures its tuple, plan and Lock before fences without an intermediate Lock publication', async () => {
  await workspace(async root => {
    const lock = buildCurrentVerificationLock();
    await saveLock(root, lock);
    await writeCurrentVerificationFixture(root, lock, { lane: 'fast' });
    const verification = structuredClone(readOptionalCurrentVerificationPublication(root, lock)!);
    const plan = structuredClone(buildRepairPlan(verification.verificationReport));
    const lockPath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.graphLock);
    const initialLock = await readFile(lockPath);
    let fences = 0;
    await writeRepairPlan(root, plan, lock, async () => {
      fences++;
      expect(await readFile(lockPath)).toEqual(initialLock);
      lock.app.name = 'caller changed its Lock';
      plan.sourceVerificationStatus = 'failed';
      verification.verificationReport.summary.status = 'failed';
      // The exact admitted tuple, rather than a later disk reread, owns the
      // provenance projection. This corrupt successor cannot replace it.
      await writeFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.verificationReport), '{}');
    }, verification);
    expect(fences).toBeGreaterThan(0);
    expect(readLockFile(root).app.name).toBe('customer-admin');
    expect(JSON.parse(await readFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.repairPlan), 'utf8')).sourceVerificationStatus).toBe('passed');
    const provenance = JSON.parse(await readFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance), 'utf8'));
    expect(provenance.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: CI_ARTIFACT_FILES.repairPlan })
    ]));
    await expect(lockProject(root, readLockFile(root))).rejects.toThrow();
  });
});

for (const fault of ['wrong-subject', 'inconsistent-tuple', 'invalid-provenance-path'] as const) {
  test(`real Repair writer rejects ${fault} before any artifact or Lock effect`, async () => {
    await workspace(async root => {
      const lock = buildCurrentVerificationLock();
      if (fault === 'invalid-provenance-path') lock.generatedPaths.push('../foreign');
      await saveLock(root, lock);
      await writeCurrentVerificationFixture(root, lock, { lane: 'fast' });
      const verification = structuredClone(readOptionalCurrentVerificationPublication(root, lock)!);
      const plan = buildRepairPlan(verification.verificationReport);
      if (fault === 'wrong-subject') lock.app.name = 'wrong subject';
      if (fault === 'inconsistent-tuple') verification.verificationReport.summary.status = 'failed';
      const lockPath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.graphLock);
      const before = await readFile(lockPath);
      let fences = 0;
      await expect(writeRepairPlan(root, plan, lock, async () => { fences++; }, verification)).rejects.toThrow();
      expect(fences).toBe(0);
      expect(await readFile(lockPath)).toEqual(before);
      await expect(access(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.repairPlan))).rejects.toThrow();
      await expect(access(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance))).rejects.toThrow();
    });
  });
}
