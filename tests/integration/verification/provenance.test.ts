import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildProvenance, buildProvenanceFromVerificationPublication } from '../../../src/adapters/artifacts/provenance.ts';
import { lockProject } from '../../../src/adapters/compilation/emit/lock-project.ts';
import { writeJson } from "../../../src/adapters/filesystem/files.ts";
import { readOptionalVerificationArtifactSet } from '../../../src/adapters/verification/platform/artifact/runtime/authority.ts';
import { publishVerificationArtifactSet } from '../../../src/adapters/verification/verification-artifact-publication.ts';
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { readLockFile } from '../../../src/adapters/workspace/lock.ts';
import { buildAcceptanceCoverageReport } from '../../../src/assurance/acceptance/build-coverage.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../../src/assurance/verification/contract/types.ts';
import { productVerificationSubjectRevision } from '../../../src/assurance/verification/project/report.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import type { PolicyReport } from '../../../src/semantics/policies/types.ts';
import { buildOfficialCopyInstallStep, buildOfficialResolvedBlock } from '../../helpers/lock-fixtures.ts';
import { buildRepairVerificationFixture } from '../../helpers/repair-fixtures.ts';
import {
  buildPassingReviewReport,
  buildReviewLock,
  buildRuntimeVerificationReport
} from '../../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../../helpers/semantic-view-fixtures.ts';
import { writeCanonicalVerificationArtifactSetFixture } from '../../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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
  report: VerificationReport,
  lock: LockFile
): Promise<VerificationReport> {
  const policyReport = skippedPolicyReport();
  const fast = {
    ...report.fast,
    status: 'passed' as const,
    policy: { status: 'skipped' as const, violations: [] },
    policyReport
  };
  const acceptanceCoverage = buildAcceptanceCoverageReport({ lock, fast, runtime: report.runtime });
  const verificationReport = await writeCanonicalVerificationArtifactSetFixture(workspaceRoot, {
    ...report,
    policy: { status: 'skipped', violations: [] },
    fast,
  }, { policyReport, acceptanceCoverage, subjectRevision: productVerificationSubjectRevision(lock) });
  return verificationReport;
}

test('buildProvenance consumes only a complete canonical Verification artifact set', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lock = buildReviewLock({
      formatVersion: '1',
      app: {
        id: 'customer-admin',
        name: 'customer-admin',
        stack: 'typescript-library',
        mode: 'single-tenant'
      },
      resolvedBlocks: [buildOfficialResolvedBlock({ id: BLOCK_ID, installOrder: 1,
        manifestPath: 'catalog/registry/official/entity.customer-basic/block.manifest.yaml' })],
      resolvedCapabilities: [],
      semanticLoweringTasks: [],
      semanticViews: buildSemanticViewFixture(),
      installPlan: [
        buildOfficialCopyInstallStep({ stepId: 'copy_customer_acceptance', blockId: BLOCK_ID,
          sourceRoot: 'catalog/registry/official/entity.customer-basic/files',
          from: 'files/tests/acceptance/customer-flow.test.ts', to: ACCEPTANCE_TEST }),
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
      acceptancePlan: [ACCEPTANCE_ID],
      acceptanceSources: [{ declaringBlockId: BLOCK_ID, acceptance: {
        id: ACCEPTANCE_ID, source: { tests: [ACCEPTANCE_TEST] }
      } }],
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
    });

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
    const verificationReport = await writeCanonicalPassingVerificationArtifacts(workspaceRoot, report, lock);

    const captured = readOptionalVerificationArtifactSet(workspaceRoot);
    const provenance = await buildProvenance(workspaceRoot, lock);

    expect(provenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: [ACCEPTANCE_TEST, 'tests/unit/customer-runtime.test.ts']
    });
    expect(provenance.artifacts.map((artifact) => [artifact.path, artifact.generatedByPass])).toEqual([
      [CI_ARTIFACT_FILES.explainGraph, 'explain'],
      [CI_ARTIFACT_FILES.repairPlan, 'repair'],
      [CI_ARTIFACT_FILES.upgradePlan, 'upgrade'],
      ['src/installed/entity/customer-service.ts', 'compose'],
      [ACCEPTANCE_TEST, 'compose'],
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
    expect(await buildProvenanceFromVerificationPublication(workspaceRoot, lock, captured)).toEqual(provenance);
    const unverifiedProvenance = await buildProvenance(workspaceRoot, lock);
    expect(unverifiedProvenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: []
    });
  });
});


test('buildProvenance captures its Lock before override loading suspends', async () => {
  await withTempWorkspace(async workspaceRoot => {
    const lock = buildReviewLock({ generatedPaths: ['src/original.ts'] });
    const pending = buildProvenance(workspaceRoot, lock);
    lock.generatedPaths[0] = 'src/retargeted.ts';
    expect((await pending).artifacts.map(artifact => artifact.path)).toEqual(['src/original.ts']);
  });
});

test('lockProject rejects foreign subjects before effects and captures admitted publication', async () => {
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
    const admittedPending = await lockProject(workspaceRoot, pendingVerify);
    expect(admittedPending.passStatus.verify).toBe('pending');
    expect(admittedPending.passStatus.lock).toBe('succeeded');
    const admittedBytes = await fs.readFile(lockPath, 'utf8');
    expect(admittedBytes).not.toBe(before);
    const foreign = structuredClone(fixture.lock);
    foreign.app.id = 'foreign-lock-subject';
    let effects = 0;
    await expect(lockProject(workspaceRoot, foreign, async () => { effects++; }))
      .rejects.toMatchObject({ code: 'VERIFY-SUBJECT-002' });
    expect(effects).toBe(0);
    expect(await fs.readFile(lockPath, 'utf8')).toBe(admittedBytes);

    const callerBeforePublication = structuredClone(fixture.lock);
    const pending = lockProject(workspaceRoot, fixture.lock);
    fixture.lock.app.id = 'retargeted-after-admission';
    fixture.lock.passStatus.verify = 'failed';
    const published = await pending;
    expect(published.app.id).toBe('customer-admin');
    expect(published.passStatus.verify).toBe('succeeded');
    expect(published.passStatus.lock).toBe('succeeded');
    expect(readLockFile(workspaceRoot)).toEqual(published);
    expect(fixture.lock.passStatus.lock).toBe(callerBeforePublication.passStatus.lock);
    expect(fixture.lock.generatedPaths).toEqual(callerBeforePublication.generatedPaths);
  });
});
