import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildProvenance } from '../../src/adapters/artifacts/provenance.ts';
import { lockProject } from '../../src/adapters/compilation/emit/lock-project.ts';
import { writeJson } from "../../src/adapters/filesystem/files.ts";
import { readOptionalVerificationArtifactSet } from '../../src/adapters/verification/platform/artifact/runtime/authority.ts';
import { publishVerificationArtifactSet } from '../../src/adapters/verification/verification-artifact-publication.ts';
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { readLockFile } from '../../src/adapters/workspace/lock.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/assurance/verification/contract/types.ts';
import type { LockFile } from '../../src/compiler/contract.ts';
import type { PolicyReport } from '../../src/semantics/policies/types.ts';
import { buildOfficialCopyInstallStep } from '../helpers/lock-fixtures.ts';
import { buildRepairVerificationFixture } from '../helpers/repair-fixtures.ts';
import {
  buildPassingReviewCoverage,
  buildPassingReviewReport,
  buildRuntimeVerificationReport
} from '../helpers/review-fixtures.ts';
import { writeCanonicalVerificationArtifactSetFixture } from '../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const ACCEPTANCE_ID = 'user_can_create_customer';
const ACCEPTANCE_TEST = 'tests/acceptance/customer-flow.test.ts';
const BLOCK_ID = 'entity/customer-basic';

function skippedPolicyReport(): PolicyReport {
  return {
    status: 'skipped',
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: [],
    diagnostics: []
  };
}

async function writeCanonicalPassingVerificationArtifacts(
  workspaceRoot: string,
  report: VerificationReport
): Promise<VerificationReport> {
  const policyReport = skippedPolicyReport();
  const acceptanceCoverage = buildPassingReviewCoverage({
    acceptancePassed: [ACCEPTANCE_ID],
    blocks: [{
      id: BLOCK_ID,
      declaredAcceptance: [ACCEPTANCE_ID],
      coveredBy: [ACCEPTANCE_ID],
      uncovered: false
    }]
  });
  const fast = {
    ...report.fast,
    status: 'passed' as const,
    policy: { status: 'skipped' as const, violations: [] },
    policyReport
  };
  const verificationReport = await writeCanonicalVerificationArtifactSetFixture(workspaceRoot, {
    ...report,
    policy: { status: 'skipped', violations: [] },
    fast,
  }, { policyReport, acceptanceCoverage });
  return verificationReport;
}

test('buildProvenance consumes only a complete canonical Verification artifact set', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        id: 'customer-admin',
        name: 'customer-admin',
        stack: 'typescript-library',
        mode: 'single-tenant'
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [
        buildOfficialCopyInstallStep({
          stepId: 'copy_customer_runtime_test',
          blockId: BLOCK_ID,
          sourceRoot: 'catalog/registry/official/entity.customer-basic/files',
          from: 'files/tests/unit/customer-runtime.test.ts',
          to: 'tests/unit/customer-runtime.test.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'copy_customer_service',
          blockId: BLOCK_ID,
          sourceRoot: 'catalog/registry/official/entity.customer-basic/files',
          from: 'files/src/installed/entity/customer-service.ts',
          to: 'src/installed/entity/customer-service.ts'
        })
      ],
      generatedPaths: [
        CI_ARTIFACT_FILES.explainGraph,
        CI_ARTIFACT_FILES.repairPlan,
        CI_ARTIFACT_FILES.upgradePlan
      ],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        verify: 'succeeded',
        repair: 'pending',
        lock: 'pending',
        emit: 'pending'
      }
    };

    const report = buildPassingReviewReport({
      unit: { status: 'passed', passed: ['tests/unit/customer-runtime.test.ts'] },
      acceptance: { status: 'passed', passed: [ACCEPTANCE_TEST], failed: [] },
      fast: {
        status: 'passed',
        unit: { status: 'passed', passed: ['tests/unit/customer-runtime.test.ts'] },
        acceptance: { status: 'passed', passed: [ACCEPTANCE_TEST], failed: [] }
      },
      runtime: buildRuntimeVerificationReport({
        build: { passed: ['bun run build'] },
        unit: { passed: ['tests/runtime/unit/customer-runtime.test.ts'] },
        acceptance: { passed: ['tests/acceptance/customer-attachments-flow.test.ts'] }
      }),
      summary: { requestedLane: 'all' }
    });
    const verificationReport = await writeCanonicalPassingVerificationArtifacts(workspaceRoot, report);

    const captured = readOptionalVerificationArtifactSet(workspaceRoot);
    const provenance = await buildProvenance(workspaceRoot, lock);

    expect(provenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: ['tests/unit/customer-runtime.test.ts']
    });
    expect(provenance.artifacts.map((artifact) => [artifact.path, artifact.generatedByPass])).toEqual([
      [CI_ARTIFACT_FILES.explainGraph, 'explain'],
      [CI_ARTIFACT_FILES.repairPlan, 'repair'],
      [CI_ARTIFACT_FILES.upgradePlan, 'upgrade'],
      ['src/installed/entity/customer-service.ts', 'compose'],
      ['tests/unit/customer-runtime.test.ts', 'compose']
    ]);

    const paths = {
      runtimeReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
      policyReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
      acceptanceCoveragePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
      verificationReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport)
    };
    await Promise.all([
      fs.rm(paths.runtimeReportPath),
      fs.rm(paths.policyReportPath),
      fs.rm(paths.acceptanceCoveragePath)
    ]);
    await writeJson(paths.verificationReportPath, verificationReport);
    await expect(buildProvenance(workspaceRoot, lock))
      .rejects.toThrow('Provenance Verification artifact set is partially published');

    await fs.rm(paths.verificationReportPath);
    expect(await buildProvenance(workspaceRoot, lock, captured)).toEqual(provenance);
    const unverifiedProvenance = await buildProvenance(workspaceRoot, lock);
    expect(unverifiedProvenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: []
    });
  });
});


test('buildProvenance captures its Lock before override loading suspends', async () => {
  await withTempWorkspace(async workspaceRoot => {
    const lock = buildRepairVerificationFixture('all', false).lock;
    lock.generatedPaths = ['src/original.ts'];
    const pending = buildProvenance(workspaceRoot, lock);
    lock.generatedPaths[0] = 'src/retargeted.ts';
    expect((await pending).artifacts.map(artifact => artifact.path)).toEqual(['src/original.ts']);
  });
});

test('lockProject rejects foreign subjects before effects', async () => {
  await withTempWorkspace(async workspaceRoot => {
    const fixture = buildRepairVerificationFixture('all', false);
    for (const relative of [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.provenance]) {
      await fs.mkdir(path.dirname(resolveWorkspaceArtifactPath(workspaceRoot, relative)), { recursive: true });
    }
    await publishVerificationArtifactSet({ workspaceRoot, ...fixture });
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const before = await fs.readFile(lockPath, 'utf8');
    const pendingVerify = structuredClone(fixture.lock);
    pendingVerify.passStatus.verify = 'pending';
    await expect(lockProject(workspaceRoot, pendingVerify)).rejects.toMatchObject({ code: 'LOCK-BLOCKED-001' });
    expect(await fs.readFile(lockPath, 'utf8')).toBe(before);
    const foreign = structuredClone(fixture.lock);
    foreign.app.id = 'foreign-lock-subject';
    let effects = 0;
    await expect(lockProject(workspaceRoot, foreign, async () => { effects++; }))
      .rejects.toMatchObject({ code: 'LOCK-BLOCKED-002' });
    expect(effects).toBe(0);
    expect(await fs.readFile(lockPath, 'utf8')).toBe(before);

  });
});

test('lockProject captures its Lock before publication suspends', async () => {
  await withTempWorkspace(async workspaceRoot => {
    const fixture = buildRepairVerificationFixture('all', false);
    for (const relative of [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.provenance]) {
      await fs.mkdir(path.dirname(resolveWorkspaceArtifactPath(workspaceRoot, relative)), { recursive: true });
    }
    await publishVerificationArtifactSet({ workspaceRoot, ...fixture });
    const pending = lockProject(workspaceRoot, fixture.lock);
    fixture.lock.app.id = 'retargeted-after-admission';
    fixture.lock.passStatus.verify = 'failed';
    const published = await pending;
    expect(published.app.id).toBe('customer-admin');
    expect(published.passStatus.verify).toBe('succeeded');
    expect(published.passStatus.lock).toBe('succeeded');
    expect(readLockFile(workspaceRoot)).toEqual(published);
    expect(fixture.lock.passStatus.lock).toBe('succeeded');
    expect(fixture.lock.generatedPaths).toEqual(published.generatedPaths);
  });
});
