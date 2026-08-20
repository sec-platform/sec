import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assertSemanticViewArtifactsAreCurrent,
  requireLockSemanticViews,
  semanticViewArtifactsAreCurrent
} from '../../platform/compiler/emit/semantic-view-artifact-contract.ts';
import { buildSemanticViewRows, writeLocalViews } from '../../platform/compiler/emit/write-local-views.ts';
import { buildSemanticViewSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import { buildCiArtifactManifest } from '../../platform/compiler/index.ts';
import { writeWorkspaceArtifacts } from '../../platform/orchestrator.ts';
import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_MISSING_REASON,
  CI_EMIT_ARTIFACT_PATHS
} from '../../platform/shared/ci-artifact-contract.ts';
import type { ExplainGraph } from '../../platform/shared/explain-types.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { semanticViewFactIds, type SemanticView } from '../../platform/shared/semantic-view-types.ts';
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

test('ReviewSummary and Workbench share the complete canonical Fact identity set', () => {
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
  expect(buildSemanticViewRows(semanticViews)[0]).toEqual([
    'architecture',
    'app:fixture',
    '1',
    '0',
    '3',
    'fact:inspector, fact:node, fact:overlay'
  ]);
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

test('A to B semantic refresh is blocked before Workbench can leak the A projection', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = getWorkspacePaths(workspaceRoot);
    const lock = buildReviewLock({
      semanticViews: buildSemanticViewFixture('sha256:input-b', 'sha256:semantic-b'),
      passStatus: { lock: 'succeeded', emit: 'succeeded' }
    });
    const staleGraph = graphWithRevision('sha256:input-a', 'sha256:semantic-a');
    const marker = '<!doctype html><title>semantic-a</title>\n';

    await writeJson(paths.lockPath, lock);
    await writeJson(paths.explainGraphPath, staleGraph);
    await fs.mkdir(path.dirname(paths.graphViewPath), { recursive: true });
    await fs.writeFile(paths.graphViewPath, marker, 'utf8');

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
    await expect(writeLocalViews(workspaceRoot)).rejects.toThrow(
      'does not match the current graph lock revision'
    );
    expect(await fs.readFile(paths.graphViewPath, 'utf8')).toBe(marker);
  }, 'engineering-compiler-semantic-artifact-revision-');
});

test('artifact refresh does not rewrite review or Workbench while emit is not succeeded', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = getWorkspacePaths(workspaceRoot);
    const lock = buildReviewLock({
      semanticViews: buildSemanticViewFixture(),
      passStatus: { lock: 'succeeded', emit: 'pending' }
    });
    const reviewMarker = '{"semantic":"before-refresh"}\n';
    const workbenchMarker = '<!doctype html><title>before-refresh</title>\n';

    await writeJson(paths.lockPath, lock);
    await writeJson(paths.explainGraphPath, graphWithRevision(
      lock.semanticViews!.inputRevision,
      lock.semanticViews!.semanticRevision
    ));
    await fs.mkdir(path.dirname(paths.reviewSummaryPath), { recursive: true });
    await fs.mkdir(path.dirname(paths.graphViewPath), { recursive: true });
    await fs.writeFile(paths.reviewSummaryPath, reviewMarker, 'utf8');
    await fs.writeFile(paths.graphViewPath, workbenchMarker, 'utf8');

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
    expect(await fs.readFile(paths.graphViewPath, 'utf8')).toBe(workbenchMarker);
  }, 'engineering-compiler-semantic-artifact-status-');
});

test('artifact selection fails closed when a corrupt Lock leaves stale emit files on disk', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = getWorkspacePaths(workspaceRoot);
    await fs.mkdir(path.dirname(paths.lockPath), { recursive: true });
    await fs.mkdir(path.dirname(paths.explainGraphPath), { recursive: true });
    await fs.mkdir(path.dirname(paths.graphViewPath), { recursive: true });
    await fs.writeFile(paths.lockPath, '{broken-json', 'utf8');
    await fs.writeFile(paths.explainGraphPath, '{"semantic":"stale"}\n', 'utf8');
    await fs.writeFile(paths.graphViewPath, '<!doctype html><title>stale</title>\n', 'utf8');

    expect(() => buildCiArtifactManifest(workspaceRoot)).toThrow(SyntaxError);
    expect(await fs.readFile(paths.explainGraphPath, 'utf8')).toBe('{"semantic":"stale"}\n');
    expect(await fs.readFile(paths.graphViewPath, 'utf8')).toBe('<!doctype html><title>stale</title>\n');
  }, 'engineering-compiler-semantic-artifact-corrupt-lock-');
});
