import { expect, test } from 'vitest';

import { buildReviewSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { withTempWorkspace } from '../helpers/test-utils.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  VerificationReport
} from '../../platform/shared/types.ts';

const report: VerificationReport = {
  build: { status: 'passed' },
  unit: { status: 'passed', passed: [] },
  acceptance: { status: 'passed', passed: [], failed: [] },
  policy: { status: 'passed', violations: [] },
  fast: {
    status: 'passed',
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    logs: { stdout: '', stderr: '' }
  },
  runtime: {
    status: 'skipped',
    build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
    unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
    acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
    logs: { stdout: '', stderr: '' }
  },
  summary: {
    status: 'passed',
    requestedLane: 'fast',
    failedLanes: []
  },
  logs: { stdout: '', stderr: '' }
};

const coverage: AcceptanceCoverageReport = {
  formatVersion: '1',
  status: 'passed',
  acceptancePassed: [],
  blocks: [],
  slots: [],
  uncoveredBlocks: [],
  uncoveredSlots: []
};

test('review summary surfaces provenance summary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs-ts-prisma-sqlite',
        mode: 'single-tenant'
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [],
      generatedPaths: [],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'succeeded',
        repair: 'skipped',
        lock: 'pending',
        emit: 'pending'
      }
    };
    const provenance: ProvenanceFile = {
      formatVersion: '1',
      artifacts: [
        {
          path: 'src/installed/auth/session.ts',
          originType: 'block',
          originId: 'auth/basic-session',
          sourceBlock: 'auth/basic-session',
          registrySourceId: 'official',
          registryKind: 'official',
          registryLocation: 'compiler',
          registryPath: 'platform/registry/official/auth.basic-session',
          generatedByPass: 'compose',
          verifiedBy: ['user_can_login'],
          overrideStatus: 'none'
        },
        {
          path: 'custom/customer_normalizer.ts',
          originType: 'slot',
          originId: 'customer_normalizer',
          generatedByPass: 'adapt',
          verifiedBy: [],
          overrideStatus: 'none'
        },
        {
          path: 'app/tickets/page.tsx',
          originType: 'override',
          originId: 'ticket-page-runtime-manual',
          generatedByPass: 'compose',
          verifiedBy: [],
          overrideStatus: 'manual'
        },
        {
          path: CI_ARTIFACT_FILES.reviewSummary,
          originType: 'generated',
          originId: 'review-summary',
          generatedByPass: 'review',
          verifiedBy: [],
          overrideStatus: 'none'
        }
      ]
    };

    const summary = await buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);

    expect(summary.provenanceSummary).toMatchObject({
      artifactCount: 4,
      verifiedArtifactCount: 1,
      unverifiedArtifactCount: 3,
      overrideArtifactCount: 1,
      registryArtifactCount: 1,
      generatedArtifactCount: 4,
      generatedPassCount: 3,
      originSummaryCount: 4,
      overrideSummaryCount: 2,
      registrySummaryCount: 1,
      unverifiedArtifacts: [
        'app/tickets/page.tsx',
        CI_ARTIFACT_FILES.reviewSummary,
        'custom/customer_normalizer.ts'
      ]
    });
    expect(summary.provenanceSummary?.originSummaries).toEqual([
      {
        originType: 'block',
        count: 1,
        paths: ['src/installed/auth/session.ts']
      },
      {
        originType: 'generated',
        count: 1,
        paths: [CI_ARTIFACT_FILES.reviewSummary]
      },
      {
        originType: 'override',
        count: 1,
        paths: ['app/tickets/page.tsx']
      },
      {
        originType: 'slot',
        count: 1,
        paths: ['custom/customer_normalizer.ts']
      }
    ]);
    expect(summary.provenanceSummary?.overrideSummaries).toEqual([
      {
        overrideStatus: 'manual',
        count: 1,
        paths: ['app/tickets/page.tsx']
      },
      {
        overrideStatus: 'none',
        count: 3,
        paths: [CI_ARTIFACT_FILES.reviewSummary, 'custom/customer_normalizer.ts', 'src/installed/auth/session.ts']
      }
    ]);
    expect(summary.provenanceSummary?.registrySummaries).toEqual([
      {
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        count: 1,
        paths: ['src/installed/auth/session.ts']
      }
    ]);
    expect(summary.provenanceSummary?.generatedPassSummaries).toEqual([
      {
        pass: 'adapt',
        count: 1,
        paths: ['custom/customer_normalizer.ts']
      },
      {
        pass: 'compose',
        count: 2,
        paths: ['app/tickets/page.tsx', 'src/installed/auth/session.ts']
      },
      {
        pass: 'review',
        count: 1,
        paths: [CI_ARTIFACT_FILES.reviewSummary]
      }
    ]);
  });
});
