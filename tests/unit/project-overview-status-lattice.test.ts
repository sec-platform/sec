import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import type { PolicyReport } from '../../src/compiler/policies/contract/types.ts';
import { buildProjectOverview } from '../../src/interface/cli/project-overview.ts';
import type { AcceptanceCoverageReport } from '../../src/semantic/acceptance/contract/types.ts';
import type { ExplainGraph } from '../../src/semantic/projection/contract/explain.ts';
import type { ProvenanceFile } from '../../src/semantic/provenance/contract/types.ts';
import type { VerificationReport } from '../../src/verification/contract/types.ts';
import type { ReviewSummary } from '../../src/verification/review/contract/types.ts';

function buildOverview(statuses: {
  verification: string;
  policy: string;
  coverage: string;
  artifacts: string;
  review: string;
}) {
  return buildProjectOverview({
    workspaceRoot: '/tmp/sec-overview-status-lattice',
    lock: {
      app: { name: 'Status Lattice' },
      resolvedBlocks: [],
      generatedPaths: []
    } as unknown as LockFile,
    explainGraph: { nodes: [], edges: [] } as unknown as ExplainGraph,
    provenance: { artifacts: [] } as unknown as ProvenanceFile,
    verification: {
      summary: { status: statuses.verification }
    } as unknown as VerificationReport,
    acceptanceCoverage: {
      status: statuses.coverage
    } as unknown as AcceptanceCoverageReport,
    policy: {
      status: statuses.policy,
      violations: [],
      evaluation: {
        providerId: 'overview-status-lattice-semantic-fixture',
        providerRevision: '1',
        assurance: 'semantic',
        requiredSemanticPredicates: [],
        unsupportedSemanticPredicates: []
      }
    } as unknown as PolicyReport,
    reviewSummary: {
      chainSummary: { status: statuses.review },
      artifactSummary: {
        artifactStatus: statuses.artifacts,
        missing: [],
        missingCount: 0
      },
      regressionRisks: [],
      failurePoints: [],
      conflictHints: []
    } as unknown as ReviewSummary,
    generatedAt: '2026-08-17T00:00:00.000Z'
  });
}

test('project overview passes only when every component passed', () => {
  expect(buildOverview({
    verification: 'passed',
    policy: 'passed',
    coverage: 'passed',
    artifacts: 'passed',
    review: 'passed'
  }).status.overall).toBe('passed');

  expect(buildOverview({
    verification: 'passed',
    policy: 'passed',
    coverage: 'not-run',
    artifacts: 'passed',
    review: 'passed'
  }).status.overall).toBe('not-run');

  expect(buildOverview({
    verification: 'passed',
    policy: 'passed',
    coverage: 'unknown',
    artifacts: 'passed',
    review: 'passed'
  }).status.overall).toBe('unknown');
});

test('project overview preserves failure and attention precedence', () => {
  expect(buildOverview({
    verification: 'passed',
    policy: 'attention',
    coverage: 'unknown',
    artifacts: 'not-run',
    review: 'passed'
  }).status.overall).toBe('attention');

  expect(buildOverview({
    verification: 'failed',
    policy: 'attention',
    coverage: 'unknown',
    artifacts: 'not-run',
    review: 'passed'
  }).status.overall).toBe('failed');
});
