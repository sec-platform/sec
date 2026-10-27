import { beforeAll, expect, test } from 'bun:test';
import { expectRecord } from '../../helpers/assertion-helpers.ts';

import { projectExplainSummary } from '../../../src/application/explain-summary.ts';
import { emptyCiArtifactManifest } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildE2eMatrix } from '../../../src/assurance/verification/review/matrix.ts';
import { formatExplainSummary } from '../../../src/entry/cli/explain-summary.ts';
import type { ExplainGraph } from '../../../src/semantics/projection/explain.ts';
import { buildReviewSummaryInTempWorkspace } from '../../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../../helpers/semantic-view-fixtures.ts';

// Perform the real artifact/Review readback once. Cases only project a deep
// clone, so their mutations, registrations and timeout windows stay separate.
let baseline!: Awaited<ReturnType<typeof buildReviewSummaryInTempWorkspace>>;
beforeAll(async () => { baseline = await buildReviewSummaryInTempWorkspace(); });

function graph(): ExplainGraph {
  return {
    semanticViews: buildSemanticViewFixture(),
    nodes: [
      { id: 'b', type: 'block', label: 'B' },
      { id: 'a', type: 'block', label: 'A' },
      { id: 's', type: 'operation', label: 'S' }
    ],
    edges: [{ from: 'a', to: 'b', type: 'depends_on' }],
    overlays: {
      coverage: { blocks: [{ id: 'a', coveredBy: [] }, { id: 'b', coveredBy: ['acceptance:one'] }] },
      provenance: []
    }
  };
}

test('supplied matrices and zero coverage survive before missing summaries fall back to the graph', () => {
  const summary = structuredClone(baseline);
  const matrix = buildE2eMatrix(summary);
  matrix.rows[0]!.detail += '; supplied matrix';
  const supplied = formatExplainSummary(projectExplainSummary(graph(), summary, matrix));
  expect(supplied).toContain('Explain graph 3 nodes 1 edges');
  expect(supplied).toContain('Node types: block=2, operation=1');
  expectRecord(supplied.split('\n').find(line => line.startsWith('Coverage:')),
    ['Coverage: 0 blocks', 'uncovered blocks=0']);
  expect(supplied.split('\n').find(line => line.startsWith('E2E verification:')))
    .toContain('supplied matrix');
  summary.coverageSummary = undefined;
  summary.provenanceSummary = undefined;
  summary.ciSummary.impactedBlockCount = 7;
  summary.ciSummary.runtimeEntryCount = 9;
  const text = formatExplainSummary(projectExplainSummary(graph(), summary, buildE2eMatrix(summary)));
  expect(text).toContain('Coverage: 2 blocks; uncovered blocks=1');
  expect(text).toContain('Impacted: 7 blocks, 9 runtime entries');
  expect(text).not.toContain('Coverage detail:');
  expect(text).not.toContain('Provenance detail:');
  expect(text).not.toContain('Artifacts:');
});

test('artifact defaults and missing-reason fallbacks are projected without losing declared zero counts', () => {
  const summary = structuredClone(baseline);
  summary.artifactSummary = {
    artifactCount: 8, governanceCount: 8, missingCount: 2,
    missingReasonCounts: { ...emptyCiArtifactManifest().summary.missingReasonCounts, 'fixed-governance-missing': 2 },
    uploadGroups: [{ kind: 'governance', count: 8, paths: ['.sec/artifacts/report.json'] }]
  };
  const project = () => projectExplainSummary(graph(), summary, buildE2eMatrix(summary));
  expect(formatExplainSummary(project())).toContain('Artifacts: passed; total: 8; missing: 2; missing reason types: 1; contracts: 0; upload groups: 1\nUpload groups: governance=8');
  summary.artifactSummary.missingReasonTypeCount = 0;
  summary.artifactSummary.uploadGroupCount = 0;
  expect(project().artifactSummary).toMatchObject({ missingReasonTypeCount: 0, uploadGroupCount: 0 });
});

test('repair keeps weighted categories but counts target entries, and upgrade attribution stays domain-owned', () => {
  const summary = structuredClone(baseline);
  summary.repairSummary = {
    status: 'blocked', sourceVerificationStatus: 'failed', requiresVerification: true,
    taskCount: 2, blockerCount: 1, previewCount: 1, changedPreviewCount: 1, failurePointCount: 2,
    verificationTrace: { pendingReason: 'blocked', nextAction: 'resolve-blocker' },
    failureTaxonomy: { laneSummaries: [], kindSummaries: [], issueTypeSummaries: [{ id: 'file', count: 4 }], repairabilitySummaries: [{ id: 'blocked', count: 1 }] },
    targetSummaries: [{ id: 'a', targetType: 'file-target', count: 99 }, { id: 'b', targetType: 'file-target', count: 7 }],
    taskCategorySummaries: [{ id: 'file-repair', count: 2 }], targetFileCount: 2, targetFiles: [], taskSummaries: [], blockerSummaries: []
  };
  summary.upgradeSummary = {
    status: 'blocked', blockId: 'library/example', toVersion: '2.0.0',
    preflightCheckCount: 2, preflightEvidenceCount: 3, migrationCount: 2, migrationKindCounts: {},
    requiresVerification: true, requiresVerificationCount: 1, impactCount: 4, impacts: [],
    sourceMigrationCount: 1, verificationSummaries: [{ id: 'required', count: 5 }], preflightSummaries: [], migrationSummaries: [],
    migrationOperationCount: 2, migrationOperationSummaries: [
      { id: 'a', kind: 'file-replace', target: 'a.ts', role: 'file' },
      { id: 'b', kind: 'file-replace', target: 'b.ts', role: 'file' }
    ],
    diagnostics: { status: 'blocked', phase: 'apply', failedCheck: 'target', errorCode: 'UPGRADE-MIGRATION-016', message: 'missing target', details: { migrationId: 'a', role: 'target', path: 'a.ts', rollbackStatus: 'restored' } }
  };
  const render = () => formatExplainSummary(projectExplainSummary(graph(), summary, buildE2eMatrix(summary)));
  const text = render();
  expect(text).toContain('Repair: blocked; tasks: 2; blockers: 1; changed previews: 1; requires verification: true; trace: blocked->resolve-blocker; categories: file-repair=2; issues: file=4; targets: file-target=2; repairability: blocked=1');
  expect(text).toContain('Upgrade: blocked; library/example target 2.0.0; migrations: 2; preflight checks: 2; preflight evidence: 3; impacts: 4; operations: 2; operation roles: file=2; sources: 1; requires verification: true; verification: required=5');
  expect(text).toContain('Upgrade diagnostics: apply; target; UPGRADE-MIGRATION-016; missing target; attribution: migration=a, target=a.ts, rollback=restored');
  summary.upgradeSummary.fromVersion = '1.0.0';
  summary.upgradeSummary.diagnostics!.details = { migrationId: 4, unrelated: 'not attribution' };
  const changed = render();
  expect(changed).toContain('library/example 1.0.0 -> 2.0.0');
  expect(changed).toContain('attribution: none');
  summary.upgradeSummary.diagnostics = undefined;
  expect(render()).not.toContain('Upgrade diagnostics:');
});
