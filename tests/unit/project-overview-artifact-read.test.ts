import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readProjectOverviewArtifacts } from '../../src/adapters/workspace/project-overview-read.ts';
import { buildProjectOverviewFromWorkspace } from '../../src/bootstrap/cli/project-overview.ts';
import { buildReviewSummary } from '../../src/adapters/compilation/emit/write-review-summary.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES as files } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildBlockedProductVerificationClaimSummary } from '../../src/assurance/verification/profile/contract/product.ts';
import { buildReviewLock, buildReviewProvenance } from '../helpers/review-fixtures.ts';
import { productVerificationObservationsFixture } from '../helpers/verification-fixtures.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function put(root: string, artifact: string, value: unknown): Promise<void> {
  const file = resolveWorkspaceArtifactPath(root, artifact);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
}

async function fixture(root: string) {
  const lock = buildReviewLock({ passStatus: { verify: 'failed' } });
  const graph = { semanticViews: buildSemanticViewFixture(), nodes: [], edges: [], overlays: { coverage: { blocks: [] }, provenance: [] } };
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
  const coverage = { formatVersion: '1' as const, status: 'skipped' as const, acceptancePassed: [], blocks: [], uncoveredBlocks: [] };
  const review = await buildReviewSummary(root, lock, provenance, verification, coverage);
  for (const [artifact, value] of [
    [files.graphLock, lock], [files.explainGraph, graph], [files.provenance, provenance],
    [files.verificationReport, verification], [files.runtimeReport, runtime],
    [files.policyReport, policy], [files.acceptanceCoverage, coverage], [files.reviewSummary, review]
  ] as const) await put(root, artifact, value);
  return { workspaceRoot: root, lock, explainGraph: graph, provenance, verification,
    acceptanceCoverage: coverage, policy, reviewSummary: review, artifactManifest: null };
}

test('overview reads the complete canonical set and the live CLI keeps failed verification visible', async () => {
  await withTempWorkspace(async root => {
    const expected = await fixture(root);
    expect(readProjectOverviewArtifacts(root, 'custom explain')).toEqual(expected);
    const overview = buildProjectOverviewFromWorkspace(root);
    expect(overview.status.verification).toBe('failed');
    expect(overview.workspace.root).toBe('.');
  });
});

test('absent artifacts retain the error code and caller-supplied recovery command', async () => {
  await withTempWorkspace(async root => {
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('Lock file is missing; run the refresh chain, then custom explain');
    try { readProjectOverviewArtifacts(root, 'custom explain'); }
    catch (error) { expect(error).toMatchObject({ code: 'EXPLAIN-BLOCKED-004' }); }
  });
});

test('partial verification publication remains malformed, never absence or an empty success', async () => {
  await withTempWorkspace(async root => {
    await fixture(root);
    await fs.unlink(resolveWorkspaceArtifactPath(root, files.runtimeReport));
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('is partially published');
  });
});

test('canonical provenance, exact UTF-8 review, and optional manifest validation remain active', async () => {
  await withTempWorkspace(async root => {
    const original = await fixture(root);
    await put(root, files.provenance, {});
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('Provenance report is malformed:');
    await put(root, files.provenance, original.provenance);
    await fs.writeFile(resolveWorkspaceArtifactPath(root, files.reviewSummary), new Uint8Array([0xc3, 0x28]));
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('Review summary is not exact UTF-8');
    await put(root, files.reviewSummary, original.reviewSummary);
    await put(root, files.artifactManifest, {});
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow();
  });
});

test('malformed lock JSON preserves the retained-reader diagnostic without reclassifying it as absence', async () => {
  await withTempWorkspace(async root => {
    await fixture(root);
    await fs.writeFile(resolveWorkspaceArtifactPath(root, files.graphLock), '{');
    expect(() => readProjectOverviewArtifacts(root, 'custom explain')).toThrow('Lock file is not valid JSON');
  });
});
