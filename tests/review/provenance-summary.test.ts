import { expect, test } from 'vitest';

import { buildReviewSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildPassingReviewCoverage,
  buildPassingReviewReport,
  buildReviewLock,
  buildReviewProvenance,
  withTempWorkspace
} from '../helpers/test-utils.ts';

test('review summary surfaces provenance summary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lock = buildReviewLock();
    const provenance = buildReviewProvenance([
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
    ]);

    const summary = await buildReviewSummary(
      workspaceRoot,
      lock,
      provenance,
      buildPassingReviewReport(),
      buildPassingReviewCoverage()
    );

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
