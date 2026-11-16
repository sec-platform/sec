import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildProvenance, buildProvenanceFromVerificationPublication } from '../../../src/adapters/artifacts/provenance.ts';
import { writeText } from '../../../src/adapters/filesystem/files.ts';
import { readOptionalVerificationArtifactSet } from '../../../src/adapters/verification/platform/artifact/runtime/authority.ts';
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { buildAcceptanceCoverageReport } from '../../../src/assurance/acceptance/build-coverage.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../../src/assurance/verification/contract/types.ts';
import { productVerificationSubjectRevision } from '../../../src/assurance/verification/project/report.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import { buildOfficialCopyInstallStep, buildOfficialResolvedBlock } from '../../helpers/lock-fixtures.ts';
import {
  buildPassingReviewReport,
  buildReviewLock,
  buildRuntimeVerificationReport
} from '../../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../../helpers/semantic-view-fixtures.ts';
import { emptyPolicyReport, writeCanonicalVerificationArtifactSetFixture } from '../../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

const ACCEPTANCE_ID = 'user_can_create_customer';
const ACCEPTANCE_TEST = 'tests/acceptance/customer-flow.test.ts';
const BLOCK_ID = 'entity/customer-basic';

// An independent expected inventory: do not derive it from the exclusion list
// that buildProvenance itself consumes.
const PROJECTION_PATHS = [
  CI_ARTIFACT_FILES.provenance,
  CI_ARTIFACT_FILES.explainGraph,
  CI_ARTIFACT_FILES.explainGraphMermaid,
  CI_ARTIFACT_FILES.explainGraphDot,
  CI_ARTIFACT_FILES.reviewSummary
] as const;
const STABLE_OUTPUT_PATH = 'src/generated/stable-output.ts';
const STABLE_INITIAL_CONTENT = 'stable\n';
const STABLE_CHANGED_CONTENT = 'changed stable output\n';

async function writeCanonicalPassingVerificationArtifacts(
  workspaceRoot: string,
  report: VerificationReport,
  lock: LockFile
): Promise<VerificationReport> {
  const policyReport = emptyPolicyReport();
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
        ...PROJECTION_PATHS,
        CI_ARTIFACT_FILES.repairPlan,
        CI_ARTIFACT_FILES.upgradePlan,
        STABLE_OUTPUT_PATH
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
    await writeCanonicalPassingVerificationArtifacts(workspaceRoot, report, lock);
    for (const artifactPath of PROJECTION_PATHS) {
      await writeText(resolveWorkspaceArtifactPath(workspaceRoot, artifactPath), `projection:${artifactPath}\n`);
    }
    await writeText(path.join(workspaceRoot, STABLE_OUTPUT_PATH), STABLE_INITIAL_CONTENT);

    const captured = readOptionalVerificationArtifactSet(workspaceRoot);
    const provenance = await buildProvenance(workspaceRoot, lock);

    expect(provenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: [ACCEPTANCE_TEST, 'tests/unit/customer-runtime.test.ts']
    });
    expect(provenance.artifacts.map((artifact) => [artifact.path, artifact.generatedByPass])).toEqual([
      [CI_ARTIFACT_FILES.provenance, 'lock'],
      [CI_ARTIFACT_FILES.explainGraph, 'explain'],
      [CI_ARTIFACT_FILES.explainGraphMermaid, 'explain'],
      [CI_ARTIFACT_FILES.explainGraphDot, 'explain'],
      [CI_ARTIFACT_FILES.reviewSummary, 'compose'],
      [CI_ARTIFACT_FILES.repairPlan, 'repair'],
      [CI_ARTIFACT_FILES.upgradePlan, 'upgrade'],
      [STABLE_OUTPUT_PATH, 'compose'],
      ['src/installed/entity/customer-service.ts', 'compose'],
      [ACCEPTANCE_TEST, 'compose'],
      ['tests/unit/customer-runtime.test.ts', 'compose']
    ].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));

    for (const artifactPath of PROJECTION_PATHS) {
      expect(provenance.artifacts.find((entry) => entry.path === artifactPath)).toMatchObject({ path: artifactPath });
      expect(provenance.artifacts.find((entry) => entry.path === artifactPath)).not.toHaveProperty('hash');
    }
    expect(provenance.artifacts.find((entry) => entry.path === STABLE_OUTPUT_PATH)?.hash)
      .toBe(createHash('sha256').update(STABLE_INITIAL_CONTENT).digest('hex'));

    // A projection-only edit must not alter the complete provenance publication.
    await writeText(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance),
      'changed recursive projection\n');
    expect(await buildProvenance(workspaceRoot, lock)).toEqual(provenance);

    const paths = {
      runtimeReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
      policyReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
      acceptanceCoveragePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
      verificationReportPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport)
    };
    // Preparation must settle before the workspace callback may clean its root.
    for (const artifactPath of [paths.runtimeReportPath, paths.policyReportPath, paths.acceptanceCoveragePath]) {
      await fs.rm(artifactPath);
    }
    await expect(buildProvenance(workspaceRoot, lock))
      .rejects.toThrow('Provenance Verification artifact set is partially published');

    await fs.rm(paths.verificationReportPath);
    expect(await buildProvenanceFromVerificationPublication(workspaceRoot, lock, captured)).toEqual(provenance);
    // Reuse the existing unverified read to distinguish real-source changes
    // from projection changes, rather than paying for another independent run.
    await writeText(path.join(workspaceRoot, STABLE_OUTPUT_PATH), STABLE_CHANGED_CONTENT);
    const unverifiedProvenance = await buildProvenance(workspaceRoot, lock);
    expect(unverifiedProvenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: []
    });
    expect(unverifiedProvenance.artifacts.find((entry) => entry.path === STABLE_OUTPUT_PATH)?.hash)
      .toBe(createHash('sha256').update(STABLE_CHANGED_CONTENT).digest('hex'));
    for (const artifactPath of PROJECTION_PATHS) {
      expect(unverifiedProvenance.artifacts.find((entry) => entry.path === artifactPath))
        .toEqual(provenance.artifacts.find((entry) => entry.path === artifactPath));
    }
  });
});
