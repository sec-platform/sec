import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { platformCommand } from '../../../src/adapters/verification/platform/platform-command.ts';
import { buildReviewSummary, buildProvenanceSummary } from '../../../src/adapters/compilation/emit/write-review-summary.ts';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { prepareReviewRefreshRead, readRequiredExplanationProvenance } from '../../../src/adapters/workspace/explanation-read.ts';
import { readProjectOverviewArtifacts } from '../../../src/adapters/workspace/project-overview-read.ts';
import { buildAcceptanceCoverageFromSource } from '../../../src/assurance/acceptance/build-coverage.ts';
import { assertCanonicalVerificationArtifactSet } from '../../../src/assurance/verification/artifact/contract/artifact.ts';
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport } from '../../../src/assurance/verification/contract/types.ts';
import { buildProductVerificationReport } from '../../../src/assurance/verification/project/report.ts';
import { CI_ARTIFACT_FILES as files } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildBlockedProductVerificationClaimSummary } from '../../../src/assurance/verification/profile/contract/product.ts';
import { buildProjectOverview, buildProjectOverviewFromWorkspace } from '../../../src/bootstrap/cli/project-overview.ts';
import { formatProjectOverview } from '../../../src/entry/cli/project-overview.ts';
import type { PolicyReport } from '../../../src/semantics/policies/types.ts';
import type { ExplainGraph } from '../../../src/semantics/projection/explain.ts';
import { buildReviewLock, buildReviewProvenance } from '../../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../../helpers/semantic-view-fixtures.ts';
import { productVerificationObservationsFixture } from '../../helpers/verification-fixtures.ts';
import { runCliInProcess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

async function put(root: string, artifact: string, value: unknown): Promise<void> {
  const file = resolveWorkspaceArtifactPath(root, artifact);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
}

async function fixture(root: string) {
  const lock = buildReviewLock({ passStatus: { verify: 'failed' } });
  const graph: ExplainGraph = { semanticViews: buildSemanticViewFixture(), nodes: [], edges: [], overlays: { coverage: { blocks: [] }, provenance: [] } };
  const provenance = buildReviewProvenance();
  const policy = {
    status: 'skipped' as const,
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] }, violations: [], diagnostics: []
  };
  const fast = {
    status: 'failed' as const, build: { status: 'skipped' as const },
    unit: { status: 'skipped' as const, passed: [] },
    acceptance: { status: 'skipped' as const, passed: [], failed: [] },
    policy: { status: 'skipped' as const, violations: [] }, policyReport: policy,
    logs: { stdout: '', stderr: '' }
  };
  const step = () => ({ status: 'skipped' as const, passed: [], failed: [], command: null });
  const runtime = { status: 'skipped' as const, build: step(), unit: step(), acceptance: step(), logs: { stdout: '', stderr: '' } };
  const verification = {
    build: fast.build, unit: fast.unit, acceptance: fast.acceptance, policy: fast.policy,
    fast, runtime, logs: { stdout: '', stderr: '' },
    summary: { status: 'failed' as const, requestedLane: 'all' as const, failedLanes: ['fast' as const],
      claimSummary: buildBlockedProductVerificationClaimSummary('all', productVerificationObservationsFixture()) }
  };
  const coverage = { formatVersion: '2' as const, status: 'skipped' as const, source: { resolvedBlockIds: [], acceptancePlan: [], declarations: [], tests: [] },
    acceptancePassed: [], blocks: [], uncoveredBlocks: [] };
  const review = await buildReviewSummary(root, lock, provenance, verification, coverage);
  // The reader accepts independently persisted source and Review artifacts; it
  // does not re-run Review or join its historical counts to the current Lock.
  lock.app.name = 'Customer Admin';
  lock.resolvedBlocks = [
    { id: 'auth/basic-session', version: '1.0.0', kind: 'capability', installOrder: 1,
      manifestPath: 'model/blocks/auth/basic-session/block.yaml', registrySourceId: 'official',
      registryKind: 'official', registryLocation: 'compiler', registryPath: 'catalog/registry/official/auth.basic-session' },
    { id: 'entity/customer-basic', version: '1.0.0', kind: 'capability', installOrder: 2,
      manifestPath: 'model/blocks/entity/customer-basic/block.yaml', registrySourceId: 'official',
      registryKind: 'official', registryLocation: 'compiler', registryPath: 'catalog/registry/official/entity.customer-basic' }
  ];
  lock.generatedPaths = ['src/installed/auth/session.ts', 'src/installed/entity/customer.ts'];
  graph.nodes = [
    { id: 'app:customer-admin', type: 'app', label: 'Customer Admin' },
    { id: 'block:auth/basic-session', type: 'block', label: 'auth/basic-session' },
    { id: 'block:entity/customer-basic', type: 'block', label: 'entity/customer-basic' }
  ];
  graph.edges = [
    { from: 'app:customer-admin', to: 'block:auth/basic-session', type: 'depends_on' },
    { from: 'app:customer-admin', to: 'block:entity/customer-basic', type: 'depends_on' }
  ];
  provenance.artifacts = [
    { path: 'src/installed/auth/session.ts', originType: 'block', originId: 'auth/basic-session',
      sourceBlock: 'auth/basic-session', registrySourceId: 'official', registryKind: 'official',
      registryLocation: 'compiler', registryPath: 'catalog/registry/official/auth.basic-session',
      generatedByPass: 'compose', verifiedBy: ['user_can_login'], overrideStatus: 'none' },
    { path: 'src/installed/entity/customer.ts', originType: 'block', originId: 'entity/customer-basic',
      sourceBlock: 'entity/customer-basic', generatedByPass: 'compose', verifiedBy: [], overrideStatus: 'none' }
  ];
  review.provenanceSummary = buildProvenanceSummary(provenance);
  review.artifactSummary = {
    artifactStatus: 'attention', artifactCount: 4, governanceCount: 4, missingCount: 1,
    missing: [{ path: files.policyReport, reason: 'fixed-governance-missing', declaredBy: 'artifact-manifest' }]
  };
  review.regressionRisks = [{ kind: 'coverage-gap', blockId: 'entity/customer-basic',
    message: 'Block entity/customer-basic requires more acceptance coverage' }];
  review.ciSummary = { ...review.ciSummary, regressionRiskCount: 1, impactedBlockCount: 1 };
  review.impactedBlocks = ['entity/customer-basic'];
  review.chainSummary = { ...review.chainSummary, status: 'attention' };
  for (const [artifact, value] of [
    [files.graphLock, lock], [files.explainGraph, graph], [files.provenance, provenance],
    [files.verificationReport, verification], [files.runtimeReport, runtime],
    [files.policyReport, policy], [files.acceptanceCoverage, coverage], [files.reviewSummary, review]
  ] as const) await put(root, artifact, value);
  return { workspaceRoot: root, lock, explainGraph: graph, provenance, verification,
    acceptanceCoverage: coverage, policy, reviewSummary: review, artifactManifest: null };
}

test('canonical overview reads preserve status, source counts, Review priorities and the reachable status lattice', async () => {
  await withTempWorkspace(async root => {
    const expected = await fixture(root);
    expect(readProjectOverviewArtifacts(root, 'custom explain')).toEqual(expected);
    const overview = buildProjectOverviewFromWorkspace(root);
    expect(overview).toMatchObject({
      workspace: { root: '.', modelRoot: 'model', srcRoot: 'src', testsRoot: 'tests',
        prismaRoot: 'prisma', secRoot: '.sec', artifactsRoot: '.sec/artifacts' },
      status: { overall: 'failed', verification: 'failed', policy: 'not-run', coverage: 'not-run',
        artifacts: 'attention', reviewChain: 'attention' },
      aiContext: { appName: 'Customer Admin', blockCount: 2, graphNodeCount: 3, graphEdgeCount: 2,
        generatedPathCount: 2, unverifiedArtifactCount: 1, priorityReviewFileCount: 2 },
      risks: { failureCount: 1, regressionRiskCount: 1, conflictHintCount: 0,
        missingArtifactCount: 1, policyErrorCount: 0 }
    });
    expect(overview.navigation.machineArtifacts).toEqual([
      { id: 'graph', path: files.explainGraph },
      { id: 'graph-mermaid', path: files.explainGraphMermaid },
      { id: 'review', path: files.reviewSummary },
      { id: 'verification', path: files.verificationReport }
    ]);
    expect(overview.aiContext.priorityReviewFiles).toEqual([
      { path: files.policyReport, reasons: ['missing artifact: fixed-governance-missing'] },
      { path: 'block:entity/customer-basic', reasons: ['regression risk: coverage-gap'] },
      { path: 'src/installed/entity/customer.ts', reasons: ['unverified provenance'] }
    ]);
    const text = formatProjectOverview(overview, {
      explainCommand: platformCommand('explain'),
      verifyCompactCommand: platformCommand('verify', '--json', '--compact'),
      graphArtifactPath: files.explainGraph,
      reviewArtifactPath: files.reviewSummary
    });
    expect(text).toContain('Project overview failed');
    expect(text).toContain('Graph: 3 nodes / 2 edges; blocks=2');
    expect(text).toContain('Risks: failures=1; regressions=1; conflicts=0; missingArtifacts=1');

    // Exercise the remaining lattice outcomes with tuples admitted by the same
    // canonical owner as the real reader, not invented Policy/Coverage statuses.
    const semanticPolicy: PolicyReport = {
      status: 'passed',
      official: { policies: ['tenant-scope-required'], sources: [
        { path: 'catalog/policies/official/policy.spec.yaml', policyIds: ['tenant-scope-required'] }
      ], violations: [] },
      project: { policies: [], sources: [], violations: [] },
      merged: { policies: [{ id: 'tenant-scope-required', sourceScope: 'official',
        sourcePath: 'catalog/policies/official/policy.spec.yaml', targets: ['src/installed/auth/session.ts'] }] },
      violations: [], diagnostics: [],
      evaluation: { providerId: 'semantic-policy-test-provider', providerRevision: 'semantic-policy-test-provider-v1',
        assurance: 'semantic', requiredSemanticPredicates: ['FLOWS_TO'], unsupportedSemanticPredicates: [] }
    };
    const runtime: RuntimeVerificationLaneReport = {
      ...expected.verification.runtime, status: 'passed',
      unit: { status: 'passed', passed: ['tests/runtime/unit/auth.test.ts'], failed: [], command: 'bun test tests/runtime/unit' },
      acceptance: { status: 'passed', passed: ['tests/acceptance/auth.test.ts'], failed: [], command: 'bun test tests/acceptance' }
    };
    const canonical = [semanticPolicy, expected.policy].map(policy => {
      const fast: FastVerificationLaneReport = {
        ...expected.verification.fast, status: 'passed', build: { status: 'passed' },
        unit: { status: 'passed', passed: ['tests/unit/auth.test.ts'] },
        acceptance: { status: 'passed', passed: ['tests/acceptance/auth.test.ts'], failed: [] },
        policy: { status: policy.status, violations: policy.violations }, policyReport: policy
      };
      const coverage = buildAcceptanceCoverageFromSource({
        resolvedBlockIds: ['auth/basic-session'], acceptancePlan: ['user_can_login'],
        declarations: [{ declaringBlockId: 'auth/basic-session', acceptance: {
          id: 'user_can_login', source: { tests: ['tests/acceptance/auth.test.ts'] }
        } }],
        tests: [{ testPath: 'tests/acceptance/auth.test.ts', blockId: 'auth/basic-session' }]
      }, fast, runtime);
      const verification = buildProductVerificationReport({
        lane: 'all', fast, runtime, runtimeMode: 'full', policyReport: policy,
        acceptanceCoverage: coverage, observations: productVerificationObservationsFixture()
      });
      assertCanonicalVerificationArtifactSet({
        verificationReport: verification, runtimeReport: runtime, policyReport: policy, acceptanceCoverage: coverage
      });
      return { verification, policy, acceptanceCoverage: coverage };
    });
    const passedArtifacts = { ...expected.reviewSummary.artifactSummary!, artifactStatus: 'passed' as const };
    for (const [artifacts, artifactSummary, reviewStatus, status] of [
      [canonical[0]!, passedArtifacts, 'passed', 'passed'],
      [canonical[1]!, passedArtifacts, 'passed', 'not-run'],
      [canonical[1]!, undefined, 'passed', 'unknown'],
      [canonical[1]!, undefined, 'attention', 'attention']
    ] as const) {
      const projected = buildProjectOverview({
        ...expected, ...artifacts,
        reviewSummary: { ...expected.reviewSummary, artifactSummary,
          chainSummary: { ...expected.reviewSummary.chainSummary, status: reviewStatus } }
      });
      expect(projected.status.overall).toBe(status);
    }
  });
});

test('absent artifacts preserve direct recovery authority and public CLI guidance', async () => {
  await withTempWorkspace(async root => {
    let failure: unknown;
    try { readProjectOverviewArtifacts(root, 'custom explain'); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({
      code: 'EXPLAIN-BLOCKED-004',
      message: 'Lock file is missing; run the refresh chain, then custom explain'
    });

    // The independent CLI adapter must preserve the public status, streams,
    // and canonical recovery command for the same missing physical artifact.
    // Run it within this already-owned empty workspace, not a second one.
    const result = await runCliInProcess(root, ['overview']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/\bLock file\b.*\bmissing\b/i);
    expect(result.stderr).toMatch(/\brefresh\b/i);
    expect(result.stderr).toContain('bun run sec -- explain');
  });
}, 10_000);

test('partial verification publication remains malformed, never absence or an empty success', async () => {
  await withTempWorkspace(async root => {
    await fixture(root);
    await fs.unlink(resolveWorkspaceArtifactPath(root, files.runtimeReport));
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('is partially published');
    for (const artifact of [files.verificationReport, files.runtimeReport, files.policyReport, files.acceptanceCoverage]) {
      await put(root, artifact, null);
    }
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('must not be JSON null');
  });
});

test('overview preserves canonical provenance, exact UTF-8, manifest and malformed lock diagnostics', async () => {
  await withTempWorkspace(async root => {
    const original = await fixture(root);
    const refresh = await prepareReviewRefreshRead(root);
    await fs.unlink(resolveWorkspaceArtifactPath(root, files.provenance));
    expect(refresh()).toBeNull();
    await put(root, files.provenance, null);
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('Provenance report is malformed:');
    await expect(readRequiredExplanationProvenance(root, 'Provenance report')).rejects.toMatchObject({
      code: 'EXPLAIN-BLOCKED-003',
      message: expect.stringContaining('Provenance report is malformed:')
    });
    expect(refresh).toThrow('Provenance report is malformed:');
    await put(root, files.provenance, {});
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('Provenance report is malformed:');
    await put(root, files.provenance, original.provenance);
    await fs.writeFile(resolveWorkspaceArtifactPath(root, files.reviewSummary), new Uint8Array([0xc3, 0x28]));
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('Review summary is not exact UTF-8');
    await put(root, files.reviewSummary, original.reviewSummary);
    await put(root, files.artifactManifest, {});
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow();
    await fs.writeFile(resolveWorkspaceArtifactPath(root, files.graphLock), '{');
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('Lock file is not valid JSON');
  });
});
