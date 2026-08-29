import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assertSemanticViewArtifactsAreCurrent,
  requireLockSemanticViews,
  semanticViewArtifactsAreCurrent
} from '../../src/compiler/emit/semantic-view-artifact-contract.ts';
import { buildSemanticViewSummary } from '../../src/compiler/emit/write-review-summary.ts';
import { buildCiArtifactManifest } from '../../src/compiler/emit/ci-artifacts.ts';
import { writeWorkspaceArtifacts } from '../../src/compiler/orchestration/cli.ts';
import { CI_ARTIFACT_FILES, CI_EMIT_ARTIFACT_PATHS } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { CI_ARTIFACT_MISSING_REASON } from '../../src/verification/ci-artifacts/contract/types.ts';
import type { ExplainGraph } from '../../src/semantic/projection/contract/explain.ts';
import { writeJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { semanticViewFactIds, type SemanticView } from '../../src/semantic/projection/contract/types.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function graphWithRevision(inputRevision: string, semanticRevision: string): ExplainGraph {
  return {
    semanticViews: buildSemanticViewFixture(inputRevision, semanticRevision),
    nodes: [],
    edges: [],
    overlays: {
      provenance: [],
      coverage: { blocks: [], slots: [] }
    }
  };
}

test('ReviewSummary preserves the complete canonical Fact identity set', () => {
  const view: SemanticView = {
    ...buildSemanticViewFixture().views[0]!,
    nodes: [{
      id: 'app:fixture',
      entityId: 'app:fixture',
      entityKind: 'app',
      label: 'fixture',
      badges: [],
      references: [{ kind: 'fact', ref: 'fact:node' }]
    }],
    inspector: [{
      id: 'EVIDENCE',
      items: [{ key: 'inspector', value: 'fact', references: [{ kind: 'fact', ref: 'fact:inspector' }] }]
    }],
    overlays: [{
      kind: 'provenance-authority',
      entries: [{
        targetId: 'app:fixture',
        factIds: ['fact:overlay'],
        status: 'uniform',
        authorities: ['authoritative'],
        hasInferred: false,
        hasConflict: false,
        confidence: { min: 1, max: 1 },
        provenanceKinds: ['contract'],
        evidenceRefs: []
      }]
    }]
  };
  const semanticViews = { ...buildSemanticViewFixture(), views: [view] };
  const lock = buildReviewLock({ semanticViews });
  const factIds = semanticViewFactIds(view);

  expect(factIds).toEqual(['fact:inspector', 'fact:node', 'fact:overlay']);
  expect(buildSemanticViewSummary(lock)?.views[0]?.factIds).toEqual(factIds);
  expect(buildSemanticViewSummary(lock)?.factIds).toEqual(factIds);
});

test('canonical projection rejects missing and lowering-task-stale Lock revisions', () => {
  expect(() => requireLockSemanticViews(buildReviewLock())).toThrow('missing canonical semanticViews');
  expect(semanticViewArtifactsAreCurrent(
    buildReviewLock({ semanticViews: buildSemanticViewFixture() }),
    { nodes: [], edges: [], overlays: { provenance: [], coverage: { blocks: [], slots: [] } } } as unknown as ExplainGraph
  )).toBe(false);
  expect(() => requireLockSemanticViews(buildReviewLock({
    semanticViews: {
      ...buildSemanticViewFixture(),
      views: [null]
    } as unknown as ReturnType<typeof buildSemanticViewFixture>
  }))).toThrow('malformed semantic view');
  expect(() => requireLockSemanticViews(buildReviewLock({
    semanticViews: {
      ...buildSemanticViewFixture(),
      views: [{ formatVersion: '1', viewKind: 'architecture' }]
    } as unknown as ReturnType<typeof buildSemanticViewFixture>
  }))).toThrow('nodes must be an array');
  expect(() => requireLockSemanticViews(buildReviewLock({
    semanticViews: {
      ...buildSemanticViewFixture(),
      views: [{
        ...buildSemanticViewFixture().views[0]!,
        edges: [{
          id: 'edge:invalid',
          source: 'app:fixture',
          target: 'app:target',
          value: 'also-a-value',
          relation: 'CONTAINS',
          label: 'invalid',
          references: []
        }]
      }]
    }
  }))).toThrow('malformed edge');

  const semanticViews = buildSemanticViewFixture('sha256:input-a', 'sha256:semantic-a');
  const lock = buildReviewLock({
    semanticViews,
    semanticLoweringTasks: [{
      id: 'task:stale',
      blockId: 'fixture/basic',
      generatorId: 'state-map',
      generatorEntityId: 'generator:fixture/basic:state-map',
      artifactEntityId: 'artifact:generated/state-map.ts',
      inputRevision: 'sha256:input-a',
      semanticRevision: 'sha256:semantic-b',
      contractId: 'fixture-contract',
      contractPath: 'contracts/fixture.yaml',
      contractNamespace: 'fixture',
      target: 'generated/state-map.ts',
      consumes: ['state'],
      produces: 'typescript-runtime-contract',
      verification: [],
      verifiedByEntityIds: [],
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'registry',
      kind: 'generate-state-transition-map',
      stateId: 'status',
      stateEntityId: 'state:fixture:status',
      stateValues: ['open'],
      transitions: [],
      typeBinding: { name: 'Status', importFrom: './status.ts' },
      status: 'pending'
    }]
  });

  expect(() => requireLockSemanticViews(lock)).toThrow('does not match SemanticViewSet');
});

test('A to B semantic refresh blocks stale machine projection publication', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = getWorkspacePaths(workspaceRoot);
    const lock = buildReviewLock({
      semanticViews: buildSemanticViewFixture('sha256:input-b', 'sha256:semantic-b'),
      passStatus: { lock: 'succeeded', emit: 'succeeded' }
    });
    const staleGraph = graphWithRevision('sha256:input-a', 'sha256:semantic-a');

    await writeJson(paths.lockPath, lock);
    await writeJson(paths.explainGraphPath, staleGraph);

    expect(semanticViewArtifactsAreCurrent(lock, staleGraph)).toBe(false);
    const manifest = await buildCiArtifactManifest(workspaceRoot);
    expect(manifest.artifacts.some((artifact) => CI_EMIT_ARTIFACT_PATHS.includes(artifact.path))).toBe(false);
    expect(manifest.missing).toContainEqual({
      path: CI_ARTIFACT_FILES.explainGraph,
      reason: CI_ARTIFACT_MISSING_REASON.staleSemanticProjection,
      declaredBy: 'artifact-manifest'
    });
    expect(() => assertSemanticViewArtifactsAreCurrent(lock, staleGraph)).toThrow(
      'does not match the current graph lock revision'
    );
  }, 'engineering-compiler-semantic-artifact-revision-');
});

test('artifact refresh does not rewrite review while emit is not succeeded', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = getWorkspacePaths(workspaceRoot);
    const lock = buildReviewLock({
      semanticViews: buildSemanticViewFixture(),
      passStatus: { lock: 'succeeded', emit: 'pending' }
    });
    const reviewMarker = '{"semantic":"before-refresh"}\n';

    await writeJson(paths.lockPath, lock);
    await writeJson(paths.explainGraphPath, graphWithRevision(
      lock.semanticViews!.inputRevision,
      lock.semanticViews!.semanticRevision
    ));
    await fs.mkdir(path.dirname(paths.reviewSummaryPath), { recursive: true });
    await fs.writeFile(paths.reviewSummaryPath, reviewMarker, 'utf8');

    const result = await writeWorkspaceArtifacts(workspaceRoot);

    expect(result.reviewSummary).toBeNull();
    expect(result.manifest.artifacts.some((artifact) => CI_EMIT_ARTIFACT_PATHS.includes(artifact.path))).toBe(false);
    expect(result.manifest.summary).toMatchObject({
      artifactStatus: 'attention',
      missingReasonCounts: {
        [CI_ARTIFACT_MISSING_REASON.staleSemanticProjection]: CI_EMIT_ARTIFACT_PATHS.length
      }
    });
    expect(await fs.readFile(paths.reviewSummaryPath, 'utf8')).toBe(reviewMarker);
  }, 'engineering-compiler-semantic-artifact-status-');
});

test('artifact selection fails closed when a corrupt Lock leaves stale emit files on disk', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = getWorkspacePaths(workspaceRoot);
    await fs.mkdir(path.dirname(paths.lockPath), { recursive: true });
    await fs.mkdir(path.dirname(paths.explainGraphPath), { recursive: true });
    await fs.writeFile(paths.lockPath, '{broken-json', 'utf8');
    await fs.writeFile(paths.explainGraphPath, '{"semantic":"stale"}\n', 'utf8');

    expect(() => buildCiArtifactManifest(workspaceRoot)).toThrow(SyntaxError);
    expect(await fs.readFile(paths.explainGraphPath, 'utf8')).toBe('{"semantic":"stale"}\n');
  }, 'engineering-compiler-semantic-artifact-corrupt-lock-');
});
