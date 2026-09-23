import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
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
        registryPath: 'catalog/registry/official/auth.basic-session',
        generatedByPass: 'compose',
        verifiedBy: ['user_can_login'],
        overrideStatus: 'none'
      },
      {
        path: 'src/installed/entity/customer-service.ts',
        originType: 'block',
        originId: 'entity/customer-basic',
        sourceBlock: 'entity/customer-basic',
        generatedByPass: 'compose',
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
    generatedPassCount: 2,
    originSummaryCount: 3,
    overrideSummaryCount: 2,
    registrySummaryCount: 1,
    unverifiedArtifacts: [
      CI_ARTIFACT_FILES.reviewSummary,
      'app/tickets/page.tsx',
      'src/installed/entity/customer-service.ts'
    ]
  });
  expect(summary.provenanceSummary?.originSummaries).toHaveLength(3);
  expect(summary.provenanceSummary?.overrideSummaries).toHaveLength(2);
  expect(summary.provenanceSummary?.registrySummaries).toHaveLength(1);
  expect(summary.provenanceSummary?.generatedPassSummaries).toHaveLength(2);
});
