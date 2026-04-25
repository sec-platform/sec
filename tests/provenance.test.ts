import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildProvenance } from '../platform/compiler/emit/write-provenance.ts';
import { writeJson } from '../platform/shared/fs.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import type { LockFile, VerificationReport } from '../platform/shared/types.ts';

test('buildProvenance sorts and deduplicates slot verification hints', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-provenance-'));
  try {
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
        {
          stepId: 'copy_customer_runtime_test',
          blockId: 'entity/customer-basic',
          registrySourceId: 'official',
          registryKind: 'official',
          registryLocation: 'compiler',
          registryPath: 'platform/registry/official',
          sourceRoot: 'platform/registry/official/entity.customer-basic/files',
          action: 'copy',
          from: 'files/tests/unit/customer-runtime.test.ts',
          to: 'tests/unit/customer-runtime.test.ts'
        },
        {
          stepId: 'copy_customer_service',
          blockId: 'entity/customer-basic',
          registrySourceId: 'official',
          registryKind: 'official',
          registryLocation: 'compiler',
          registryPath: 'platform/registry/official',
          sourceRoot: 'platform/registry/official/entity.customer-basic/files',
          action: 'copy',
          from: 'files/src/installed/entity/customer-service.ts',
          to: 'src/installed/entity/customer-service.ts'
        }
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
        'generated/explain-graph.json',
        'generated/repair-plan.json',
        'generated/upgrade-plan.json'
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
    const report: VerificationReport = {
      build: { status: 'passed' },
      unit: { status: 'passed', passed: ['customer-runtime.test.ts'] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      fast: {
        status: 'passed',
        build: { status: 'passed' },
        unit: { status: 'passed', passed: ['customer-runtime.test.ts'] },
        acceptance: { status: 'passed', passed: [], failed: [] },
        policy: { status: 'passed', violations: [] },
        logs: { stdout: '', stderr: '' }
      },
      runtime: {
        status: 'passed',
        build: { status: 'passed', passed: [], failed: [], command: 'npm run build' },
        unit: { status: 'passed', passed: [], failed: [], command: 'npm run test:unit' },
        acceptance: { status: 'passed', passed: [], failed: [], command: 'npm run test:acceptance' },
        logs: { stdout: '', stderr: '' }
      },
      summary: {
        status: 'passed',
        requestedLane: 'all',
        failedLanes: []
      },
      logs: { stdout: '', stderr: '' }
    };
    await writeJson(verificationReportPath, report);

    const provenance = await buildProvenance(workspaceRoot, lock);

    expect(provenance.artifacts.find((artifact) => artifact.path === 'custom/customer_normalizer.ts')).toMatchObject({
      verifiedBy: ['tests/acceptance/customer-flow.test.ts', 'tests/unit/customer-normalizer.test.ts']
    });
    expect(provenance.artifacts.find((artifact) => artifact.path === 'src/installed/entity/customer-service.ts')).toMatchObject({
      verifiedBy: ['tests/unit/customer-runtime.test.ts']
    });
    expect(provenance.artifacts.map((artifact) => [artifact.path, artifact.generatedByPass])).toEqual([
      ['custom/customer_normalizer.ts', 'adapt'],
      ['generated/explain-graph.json', 'explain'],
      ['generated/repair-plan.json', 'repair'],
      ['generated/upgrade-plan.json', 'upgrade'],
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
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
