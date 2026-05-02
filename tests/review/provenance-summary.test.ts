import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildOfficialRegistrySummary,
  buildReviewSummaryInTempWorkspace
} from '../helpers/review-fixtures.ts';

test('review summary surfaces provenance summary', async () => {
  const summary = await buildReviewSummaryInTempWorkspace({
    provenance: [
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
  });

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
  expect(summary.provenanceSummary?.originSummaries).toEqual([] as any);
  expect(summary.provenanceSummary?.overrideSummaries).toEqual([] as any);
  expect(summary.provenanceSummary?.registrySummaries).toEqual([] as any);
  expect(summary.provenanceSummary?.generatedPassSummaries).toEqual([] as any);
});
