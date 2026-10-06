import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readReviewGovernanceReports } from '../../src/adapters/compilation/emit/read-review-governance-reports.ts';
import { readJson, writeJson } from "../../src/adapters/filesystem/files.ts";
import { readOptionalCanonicalVerificationArtifactSet, readOptionalVerificationArtifactSet } from '../../src/adapters/verification/platform/artifact/runtime/authority.ts';
import { writeRepairPlan } from '../../src/adapters/verification/repair/write-repair-plan.ts';
import { publishVerificationArtifactSet } from '../../src/adapters/verification/verification-artifact-publication.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { readLockFile, saveLock } from '../../src/adapters/workspace/lock.ts';
import { buildRepairPlan } from '../../src/application/repair-plan.ts';
import { repairWorkspaceResult } from '../../src/application/repair-workspace.ts';
import type { VerificationArtifactPublicationArtifacts } from '../../src/assurance/verification/artifact/publication.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { repairWorkspace } from '../../src/bootstrap/engineering/repair-orchestrator.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import { digest, sha256 } from '../../src/contracts/canonical.ts';
import { formatJsonFile } from '../../src/contracts/json-text.ts';
import type { ProvenanceFile } from '../../src/semantics/provenance/types.ts';
import {
  parseRepairPlanJson,
  REPAIR_PLAN_FORMAT_VERSION,
  type RepairPlan
} from '../../src/semantics/repair/types.ts';
import { buildRepairVerificationFixture } from '../helpers/repair-fixtures.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const skippedPlan: RepairPlan = {
  formatVersion: REPAIR_PLAN_FORMAT_VERSION,
  status: 'skipped',
  sourceVerificationStatus: 'passed',
  requiresVerification: false,
  tasks: []
};

test('RepairPlan writer validates and reads back the canonical durable artifact', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const repairLock = buildReviewLock({ passStatus: { verify: 'failed' } });
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const repairPlanPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.mkdir(path.dirname(provenancePath), { recursive: true });
    await writeJson(lockPath, repairLock);

    await expect(writeRepairPlan(
      workspaceRoot,
      { ...skippedPlan, formatVersion: 'future' } as unknown as RepairPlan,
      repairLock
    )).rejects.toThrow();
    await expect(fs.access(repairPlanPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await writeRepairPlan(workspaceRoot, skippedPlan, repairLock);

    expect(await readJson<RepairPlan>(repairPlanPath)).toEqual(skippedPlan);
    expect((await readJson<LockFile>(lockPath)).generatedPaths).toEqual([
      CI_ARTIFACT_FILES.provenance,
      CI_ARTIFACT_FILES.repairPlan
    ]);
    expect(readReviewGovernanceReports(workspaceRoot).repairPlan).toEqual(skippedPlan);
  }, 'repair-plan-readback-');
});

test('RepairPlan parser rejects ambiguous or inconsistent durable input', () => {
  const duplicateStatusJson = JSON.stringify(skippedPlan).replace(
    '"status":"skipped"',
    '"status":"skipped","status":"skipped"'
  );
  expect(() => parseRepairPlanJson(duplicateStatusJson)).toThrow(/duplicate key/iu);
  expect(() => parseRepairPlanJson(JSON.stringify({ ...skippedPlan, unknownField: true }))).toThrow();
  expect(() => parseRepairPlanJson(JSON.stringify({
    ...skippedPlan,
    sourceVerificationStatus: 'failed'
  }))).toThrow();
});

// Synthetic observations exercise real repair IO; E2E owns actual runner evidence.
test('repair admits subject-bound diagnostics before effects and keeps all-lane completion', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fullPath = (relative: string) => path.join(workspaceRoot, relative);
    const source = fullPath('src/preserved.ts');
    const sourceBytes = 'export const retained = "independent source sentinel";\n';
    for (const relative of [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.graphLock, CI_ARTIFACT_FILES.provenance]) {
      await fs.mkdir(path.dirname(fullPath(relative)), { recursive: true });
    }
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, sourceBytes);
    const repairPlanPath = fullPath(CI_ARTIFACT_FILES.repairPlan);
    const state = () => Promise.all(
      [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.graphLock, CI_ARTIFACT_FILES.provenance]
        .map(relative => fs.readFile(fullPath(relative), 'utf8'))
    );
    async function publish(lane: 'fast' | 'all', failed: boolean, verify: LockFile['passStatus']['verify']) {
      const fixture = buildRepairVerificationFixture(lane, failed, verify);
      for (const relative of [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.provenance]) {
      await fs.mkdir(path.dirname(resolveWorkspaceArtifactPath(workspaceRoot, relative)), { recursive: true });
    }
    await publishVerificationArtifactSet({ workspaceRoot, ...fixture });
      return fixture;
    }
    const failed = await publish('fast', true, 'failed');
    expect<VerificationArtifactPublicationArtifacts | null>(readOptionalVerificationArtifactSet(workspaceRoot)).toEqual(failed.artifacts);
    expect(() => readOptionalCanonicalVerificationArtifactSet(workspaceRoot)).toThrow(
      'Pipeline completion Verification artifacts do not match the exact canonical schema'
    );
    const preview = await repairWorkspace(workspaceRoot, { dryRun: true });
    expect(preview.repairPlan).toMatchObject({
      status: 'blocked', sourceVerificationStatus: 'failed', requiresVerification: false, tasks: [],
      blockers: [{
        blockerId: 'repair_blocker_1_fast_unit', boundary: 'unknown',
        failurePoints: [{ lane: 'fast', kind: 'unit', repairable: false, message: 'independent unit failure' }]
      }]
    });
    await expect(fs.access(repairPlanPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(repairWorkspace(workspaceRoot)).rejects.toMatchObject({ code: 'REPAIR-BLOCKED-001' });
    expect(await readJson<RepairPlan>(repairPlanPath)).toEqual(preview.repairPlan);
    expect(readReviewGovernanceReports(workspaceRoot).repairPlan).toEqual(preview.repairPlan);
    expect(readLockFile(workspaceRoot).passStatus.repair).toBe('failed');
    const provenance = await readJson<ProvenanceFile>(fullPath(CI_ARTIFACT_FILES.provenance));
    expect(provenance.artifacts.some(artifact => artifact.path === CI_ARTIFACT_FILES.repairPlan)).toBe(true);
    expect(provenance.artifacts.every(artifact => artifact.verifiedBy.length === 0)).toBe(true);
    expect(await fs.readFile(source, 'utf8')).toBe(sourceBytes);

    const malformedCases: Array<[string, (artifacts: VerificationArtifactPublicationArtifacts) => void]> = [
      ['missing claim', artifacts => { delete artifacts.verificationReport.summary.claimSummary; }],
      ['false PASS', artifacts => { artifacts.verificationReport.summary.status = 'passed'; }],
      ['lane relabel', artifacts => { artifacts.verificationReport.summary.requestedLane = 'all'; }],
      ['cross-artifact runtime', artifacts => { artifacts.runtimeReport.logs.stderr = 'inconsistent'; }],
      ['wrong input digest', artifacts => {
        artifacts.verificationReport.summary.claimSummary!.gates[0]!.inputDigest = sha256('wrong');
      }]
    ];
    for (const [label, mutate] of malformedCases) {
      const bad = structuredClone(failed.artifacts);
      mutate(bad);
      const before = await state();
      await expect(publishVerificationArtifactSet({ workspaceRoot, lock: failed.lock, artifacts: bad }), label).rejects.toThrow();
      expect(await state(), label).toEqual(before);
      for (const key of ['verificationReport', 'runtimeReport', 'policyReport', 'acceptanceCoverage'] as const) {
        await writeJson(fullPath(CI_ARTIFACT_FILES[key]), bad[key]);
      }
      await expect(repairWorkspace(workspaceRoot), label).rejects.toThrow();
      expect(await state(), label).toEqual(before);
      await expect(writeRepairPlan(workspaceRoot, preview.repairPlan, failed.lock), label).rejects.toThrow();
      expect(await state(), label).toEqual(before);
      await publishVerificationArtifactSet({ workspaceRoot, ...failed });
    }
    const stale = structuredClone(failed.lock);
    stale.app.id = 'different-subject';
    await saveLock(workspaceRoot, stale);
    const beforeStale = await state();
    await expect(repairWorkspace(workspaceRoot)).rejects.toMatchObject({ code: 'REPAIR-BLOCKED-002' });
    expect(await state()).toEqual(beforeStale);
    for (const status of ['pending', 'running', 'blocked', 'skipped', 'succeeded'] as const) {
      await publish('fast', true, status);
      const before = await state();
      await expect(repairWorkspace(workspaceRoot)).rejects.toMatchObject({ code: 'REPAIR-BLOCKED-002' });
      expect(await state()).toEqual(before);
    }
    for (const status of ['pending', 'succeeded'] as const) {
      await publish('fast', false, status);
      const before = await state();
      await expect(repairWorkspace(workspaceRoot)).rejects.toMatchObject({ code: 'REPAIR-BLOCKED-002' });
      expect(await state()).toEqual(before);
    }
    const passed = await publish('all', false, 'succeeded');
    expect<VerificationArtifactPublicationArtifacts | null>(readOptionalCanonicalVerificationArtifactSet(workspaceRoot)).toEqual(passed.artifacts);
    expect((await repairWorkspace(workspaceRoot)).repairPlan).toEqual(skippedPlan);
    expect(await readJson<RepairPlan>(repairPlanPath)).toEqual(skippedPlan);
    expect(readLockFile(workspaceRoot).passStatus.repair).toBe('skipped');
    expect(await fs.readFile(source, 'utf8')).toBe(sourceBytes);
  }, 'repair-plan-admission-');
});


test('repair passes its admitted tuple through planning without rereading or caller retargeting', async () => {
  await withTempWorkspace(async workspaceRoot => {
    const fixture = buildRepairVerificationFixture('all', false);
    for (const relative of [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.provenance]) {
      await fs.mkdir(path.dirname(resolveWorkspaceArtifactPath(workspaceRoot, relative)), { recursive: true });
    }
    await publishVerificationArtifactSet({ workspaceRoot, ...fixture });
    const captured = readOptionalVerificationArtifactSet(workspaceRoot)!;
    const result = await repairWorkspaceResult({ mode: 'publish' }, {
      readLock: () => fixture.lock,
      readVerification: () => captured,
      buildPlan: report => {
        fixture.lock.app.id = 'retargeted-by-plan-caller';
        return buildRepairPlan(report);
      },
      publish: async (plan, lock, artifacts) => {
        expect(artifacts).toEqual(captured);
        for (const key of ['verificationReport', 'runtimeReport', 'policyReport', 'acceptanceCoverage'] as const) {
          await fs.rm(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES[key]));
        }
        await writeRepairPlan(workspaceRoot, plan, lock, undefined, artifacts);
      },
      recordFailure: lock => saveLock(workspaceRoot, lock)
    });
    expect(result.lock.app.id).toBe('customer-admin');
    expect(readLockFile(workspaceRoot)).toEqual(result.lock);
  });
});

test('RepairPlan publication captures its Lock and never exposes an intermediate Lock', async () => {
  await withTempWorkspace(async workspaceRoot => {
    const lock = buildReviewLock();
    await fs.mkdir(path.dirname(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance)), { recursive: true });
    await saveLock(workspaceRoot, lock);
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const before = await fs.readFile(lockPath, 'utf8');
    const manifestPath = path.join(getWorkspacePaths(workspaceRoot).overridesRoot, 'override-manifest.yaml');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, 'overrides: invalid-manifest');
    await expect(writeRepairPlan(workspaceRoot, skippedPlan, lock)).rejects.toThrow();
    expect(await fs.readFile(lockPath, 'utf8')).toBe(before);
    await expect(fs.access(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan)))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm(manifestPath);
    let first = true;
    await writeRepairPlan(workspaceRoot, skippedPlan, lock, async () => {
      if (!first) return;
      first = false;
      lock.app.id = 'retargeted-at-commit-fence';
    });
    expect(readLockFile(workspaceRoot).app.id).toBe('customer-admin');
    const provenance = await readJson<ProvenanceFile>(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance));
    expect(provenance.artifacts.find(artifact => artifact.path === CI_ARTIFACT_FILES.repairPlan)?.hash)
      .toBe(digest(formatJsonFile(skippedPlan)));
  });
});


test('RepairPlan interruption keeps the old Lock and reports the written plan without rollback', async () => {
  await withTempWorkspace(async workspaceRoot => {
    const lock = buildReviewLock();
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const planPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.repairPlan);
    const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
    await fs.mkdir(path.dirname(provenancePath), { recursive: true });
    await saveLock(workspaceRoot, lock);
    const before = await fs.readFile(lockPath, 'utf8');
    const interruption = new Error('stop after the plan is visible');
    await expect(writeRepairPlan(workspaceRoot, skippedPlan, lock, async () => {
      const planExists = await fs.access(planPath).then(() => true, () => false);
      if (planExists) throw interruption;
    })).rejects.toBe(interruption);
    expect(await fs.readFile(lockPath, 'utf8')).toBe(before);
    expect(await readJson<RepairPlan>(planPath)).toEqual(skippedPlan);
    await expect(fs.access(provenancePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(lock.generatedPaths).toEqual([]);
  });
});
