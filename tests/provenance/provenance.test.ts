import { expect, test } from 'vitest';

import { buildProvenance } from '../../platform/compiler/emit/write-provenance.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { LockFile } from '../../platform/shared/types.ts';
import { buildOfficialCopyInstallStep } from '../helpers/lock-fixtures.ts';
import { buildPassingReviewReport, buildRuntimeVerificationReport } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../helpers/workspace-fixtures.ts';

test('buildProvenance sorts and deduplicates slot verification hints', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs',
        mode: 'single-tenant'
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [
        buildOfficialCopyInstallStep({
          stepId: 'copy_customer_runtime_test',
          blockId: 'entity/customer-basic',
          sourceRoot: 'platform/registry/official/entity.customer-basic/files',
          from: 'files/tests/unit/customer-runtime.test.ts',
          to: 'tests/unit/customer-runtime.test.ts'
        }),
        buildOfficialCopyInstallStep({
          stepId: 'copy_customer_service',
          blockId: 'entity/customer-basic',
          sourceRoot: 'platform/registry/official/entity.customer-basic/files',
          from: 'files/src/installed/entity/customer-service.ts',
          to: 'src/installed/entity/customer-service.ts'
        })
      ],
      slotTasks: [
        {
          id: 'customer_normalizer',
          block: 'entity/customer-basic',
          target: 'custom/customer_normalizer.ts',
          symbol: 'normalizeCustomerInput',
          kind: 'adapter',
          status: 'filled',
          writableZones: ['custom/customer_normalizer.ts'],
          provenanceHints: {
            generator: 'test',
            verifiedBy: [
              'tests/unit/customer-normalizer.test.ts',
              'tests/acceptance/customer-flow.test.ts',
              'tests/unit/customer-normalizer.test.ts'
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

    const { verificationReportPath } = getWorkspacePaths(workspaceRoot);
    const report = buildPassingReviewReport({
      unit: { status: 'passed', passed: ['customer-runtime.test.ts'] },
      fast: {
        unit: { status: 'passed', passed: ['customer-runtime.test.ts'] }
      },
      runtime: buildRuntimeVerificationReport(),
      summary: {
        requestedLane: 'all'
      }
    });
    await writeJson(verificationReportPath, report);

    const provenance = await buildProvenance(workspaceRoot, lock);

    expect(provenance.artifacts.find((artifact) => artifact.path === 'custom/customer_normalizer.ts')).toMatchObject({
      verifiedBy: ['tests/acceptance/customer-flow.test.ts', 'tests/unit/customer-normalizer.test.ts']
    });
    expect(provenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: ['tests/unit/customer-runtime.test.ts']
    });
    expect(provenance.artifacts.map((artifact) => [artifact.path, artifact.generatedByPass])).toEqual([
      [CI_ARTIFACT_FILES.explainGraph, 'explain'],
      [CI_ARTIFACT_FILES.repairPlan, 'repair'],
      [CI_ARTIFACT_FILES.upgradePlan, 'upgrade'],
      ['custom/customer_normalizer.ts', 'adapt'],
      ['src/installed/entity/customer-service.ts', 'compose'],
      ['tests/unit/customer-runtime.test.ts', 'compose']
    ]);

    await writeJson(verificationReportPath, {
      ...report,
      summary: {
        ...report.summary,
        status: 'failed'
      }
    });
    const failedProvenance = await buildProvenance(workspaceRoot, lock);
    expect(failedProvenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: []
    });
  });
});
