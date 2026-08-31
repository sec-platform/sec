import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import type { LockFile } from '../../src/compiler/contract.ts';
import { buildProvenance } from '../../src/compiler/emit/write-provenance.ts';
import type { PolicyReport } from '../../src/compiler/policies/contract/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { buildExpectedProductVerificationClaimSummary } from '../../src/verification/profile/contract/product.ts';
import { writeJson } from '../../src/workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/workspace/paths.ts';
import { buildOfficialCopyInstallStep } from '../helpers/lock-fixtures.ts';
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
      slotTasks: [
        {
          id: 'customer_normalizer',
          block: BLOCK_ID,
          target: 'custom/customer_normalizer.ts',
          symbol: 'normalizeCustomerInput',
          kind: 'adapter',
          status: 'filled',
          writableZones: ['custom/customer_normalizer.ts'],
          provenanceHints: {
            generator: 'test',
            verifiedBy: [
              ACCEPTANCE_ID,
              ACCEPTANCE_ID
            ]
          }
        }
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
        adapt: 'succeeded',
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

    const provenance = await buildProvenance(workspaceRoot, lock);

    expect(provenance.artifacts.find((artifact) => artifact.path === 'custom/customer_normalizer.ts')).toMatchObject({
      verifiedBy: [ACCEPTANCE_ID]
    });
    expect(provenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: ['tests/unit/customer-runtime.test.ts']
    });
    expect(provenance.artifacts.map((artifact) => [artifact.path, artifact.generatedByPass])).toEqual([
      ['control/graph/explain-graph.json', 'explain'],
      ['control/workflow/repair-plan.json', 'repair'],
      ['control/workflow/upgrade-plan.json', 'upgrade'],
      ['custom/customer_normalizer.ts', 'adapt'],
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
    const unverifiedProvenance = await buildProvenance(workspaceRoot, lock);
    expect(unverifiedProvenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: []
    });
  });
});
