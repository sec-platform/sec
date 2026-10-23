import { expect, test } from 'bun:test';

import { buildAcceptanceCoverage } from '../../../src/adapters/verification/build-acceptance-coverage.ts';
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport } from '../../../src/assurance/verification/contract/types.ts';
import type {
  BlockManifest,
  LockFile
} from '../../../src/compiler/contract.ts';
import { buildPassingReviewReport } from '../../helpers/review-fixtures.ts';
import {
  emptyVerificationLogs,
  writeCanonicalVerificationArtifactSetFixture
} from '../../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

function lock(acceptancePlan: string[], acceptanceSources: NonNullable<LockFile['acceptanceSources']>): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'coverage-closure',
      name: 'coverage-closure',
      stack: 'typescript-library',
      mode: 'single-tenant'
    },
    resolvedBlocks: [{
      id: 'source/block',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'block.manifest.yaml',
      registrySourceId: 'test',
      registryKind: 'private',
      registryLocation: 'workspace',
      registryPath: 'registry'
    }],
    resolvedCapabilities: [],
    installPlan: [...new Set(acceptanceSources.flatMap(entry => entry.acceptance.source?.tests ?? []))].map((to, index) => ({
      stepId: `source:${index}`, blockId: 'source/block', registrySourceId: 'test', registryKind: 'private',
      registryLocation: 'workspace', registryPath: 'registry', sourceRoot: 'files', action: 'copy', from: to, to
    })),
    generatedPaths: [],
    acceptancePlan,
    acceptanceSources,
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'pending',
      emit: 'pending'
    }
  };
}

function fast(passed: string[]): FastVerificationLaneReport {
  return {
    status: 'passed',
    build: { status: 'passed' },
    unit: { status: 'passed', passed: ['example.test.ts'] },
    acceptance: { status: 'passed', passed, failed: [] },
    policy: { status: 'skipped', violations: [] },
    policyReport: {
      status: 'skipped',
      official: { policies: [], sources: [], violations: [] },
      project: { policies: [], sources: [], violations: [] },
      merged: { policies: [] },
      violations: []
    },
    logs: emptyVerificationLogs()
  };
}

function runtime(): RuntimeVerificationLaneReport {
  return {
    status: 'passed',
    build: {
      status: 'passed',
      passed: ['bun run build'],
      failed: [],
      command: 'bun run build'
    },
    unit: {
      status: 'passed',
      passed: ['tests/runtime/unit/example.test.ts'],
      failed: [],
      command: 'bun run test:unit'
    },
    acceptance: {
      status: 'passed',
      passed: [],
      failed: [],
      command: 'bun run test:acceptance'
    },
    logs: emptyVerificationLogs()
  };
}

function captureAcceptanceSources(
  acceptance: BlockManifest['acceptance']
): NonNullable<LockFile['acceptanceSources']> {
  return acceptance.map(acceptance => ({ declaringBlockId: 'source/block', acceptance }));
}

test('a planned acceptance must cover at least one resolved block', async () => {
  const captured = captureAcceptanceSources([{
    id: 'orphan_acceptance',
    covers: { blocks: [] }
  }]);
  await expect(buildAcceptanceCoverage(
    '.',
    lock(['orphan_acceptance'], captured),
    runtime(),
    fast([])
  )).rejects.toThrow('covers no resolved block');
});

test('acceptance targets cannot reference unknown resolved block identities', async () => {
  const captured = captureAcceptanceSources([{
    id: 'unknown_target',
    covers: { blocks: ['missing/block'] }
  }]);
  await expect(buildAcceptanceCoverage(
    '.',
    lock(['unknown_target'], captured),
    runtime(),
    fast([])
  )).rejects.toThrow('unknown resolved block');
});

test('acceptance dependency cycles are invalid proof graphs rather than uncovered results', async () => {
  const captured = captureAcceptanceSources([
    {
      id: 'acceptance_a',
      dependsOn: ['acceptance_b'],
      covers: { blocks: ['source/block'] }
    },
    {
      id: 'acceptance_b',
      dependsOn: ['acceptance_a'],
      covers: { blocks: ['source/block'] }
    }
  ]);
  await expect(buildAcceptanceCoverage(
    '.',
    lock(['acceptance_a', 'acceptance_b'], captured),
    runtime(),
    fast([])
  )).rejects.toThrow('Acceptance dependency cycle detected');
});

test('coverage readback restores fast acceptance from the matching canonical report', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const captured = captureAcceptanceSources([{
      id: 'user_can_create_customer',
      source: { tests: ['tests/acceptance/customer-flow.test.ts'] },
      covers: { blocks: ['source/block'] }
    }]);
    const fastLane = fast(['customer-flow.test.ts']);
    const runtimeLane = runtime();
    const report = buildPassingReviewReport({
      fast: fastLane,
      runtime: runtimeLane
    });
    await writeCanonicalVerificationArtifactSetFixture(workspaceRoot, report, {
      policyReport: fastLane.policyReport,
      acceptanceCoverage: {
        formatVersion: '2',
        status: 'passed',
        source: { resolvedBlockIds: ['source/block'], acceptancePlan: ['user_can_create_customer'], declarations: captured,
          tests: [{ testPath: 'tests/acceptance/customer-flow.test.ts', blockId: 'source/block' }] },
        acceptancePassed: ['user_can_create_customer'],
        blocks: [{
          id: 'source/block',
          declaredAcceptance: ['user_can_create_customer'],
          coveredBy: ['user_can_create_customer'],
          uncovered: false
        }],
        uncoveredBlocks: []
      }
    });

    const coverage = await buildAcceptanceCoverage(
      workspaceRoot,
      lock(['user_can_create_customer'], captured),
      runtimeLane
    );
    expect(coverage.acceptancePassed).toEqual(['user_can_create_customer']);
    expect(coverage.uncoveredBlocks).toEqual([]);
  });
});
