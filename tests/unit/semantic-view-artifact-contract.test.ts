import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildCiArtifactManifest } from '../../src/adapters/compilation/emit/ci-artifacts.ts';
import {
  assertSemanticViewArtifactsAreCurrent,
  requireLockSemanticViews,
  semanticViewArtifactsAreCurrent
} from '../../src/assurance/verification/review/semantic-view-artifact-contract.ts';
import { buildSemanticViewSummary } from '../../src/adapters/compilation/emit/write-review-summary.ts';
import { writeWorkspaceArtifacts } from '../../src/bootstrap/engineering/cli.ts';
import type { ExplainGraph } from '../../src/semantics/projection/explain.ts';
import { semanticViewFactIds, type SemanticView } from '../../src/semantics/projection/types.ts';
import { CI_ARTIFACT_FILES, CI_EMIT_ARTIFACT_PATHS } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { CI_ARTIFACT_MISSING_REASON } from '../../src/assurance/verification/ci-artifacts/contract/types.ts';
import { writeJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
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
      coverage: { blocks: [] }
    }
  };
}

function expectInvalidSemanticViews(value: unknown): void {
  expect(() => requireLockSemanticViews(buildReviewLock({
    semanticViews: value as ReturnType<typeof buildSemanticViewFixture>
  }))).toThrow('canonical runtime schema');
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
    { nodes: [], edges: [], overlays: { provenance: [], coverage: { blocks: [] } } } as unknown as ExplainGraph
  )).toBe(false);
  expectInvalidSemanticViews({
    ...buildSemanticViewFixture(),
    views: [null]
  });
  expectInvalidSemanticViews({
    ...buildSemanticViewFixture(),
    views: [{ formatVersion: '1', viewKind: 'architecture' }]
  });
  expectInvalidSemanticViews({
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
  });

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

test('all in-memory SemanticViewSet consumers enforce the exact Lock schema', () => {
  const base = buildSemanticViewFixture();
  const architecture = base.views[0]!;
  const canonicalNode = {
    id: 'app:fixture',
    entityId: 'app:fixture',
    entityKind: 'app',
    label: 'fixture',
    badges: [],
    references: []
  };

  expectInvalidSemanticViews({
    ...base,
    views: [{ ...architecture, nodes: [{ ...canonicalNode, entityId: undefined }] }]
  });
  expectInvalidSemanticViews({
    ...base,
    views: [{ ...architecture, nodes: [{ ...canonicalNode, entityKind: 'unknown-kind' }] }]
  });
  expectInvalidSemanticViews({
    ...base,
    views: [{
      ...architecture,
      nodes: [{
        ...canonicalNode,
        references: [{ kind: 'unknown-reference', ref: 'fact:fixture' }]
      }]
    }]
  });
  expectInvalidSemanticViews({
    ...base,
    views: [{
      ...architecture,
      nodes: [canonicalNode],
      edges: [{
        id: 'edge:invalid-relation',
        source: canonicalNode.id,
        target: canonicalNode.id,
        relation: 'UNKNOWN_RELATION',
        label: 'invalid',
        references: []
      }]
    }]
  });
  expectInvalidSemanticViews({
    ...base,
    views: [architecture, structuredClone(architecture)]
  });
  expectInvalidSemanticViews({
    ...base,
    views: [{
      ...architecture,
      overlays: [{
        kind: 'provenance-authority',
        entries: [{
          targetId: canonicalNode.id,
          factIds: [],
          status: 'unknown-status',
          authorities: ['authoritative'],
          hasInferred: false,
          hasConflict: false,
          confidence: { min: 1, max: 1 },
          provenanceKinds: ['contract'],
          evidenceRefs: []
        }]
      }]
    }]
  });

  expect(requireLockSemanticViews(buildReviewLock({ semanticViews: base }))).toEqual(base);
});

test('A to B semantic refresh blocks stale machine projection publication', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const explainGraphPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph);
    const lock = buildReviewLock({
      semanticViews: buildSemanticViewFixture('sha256:input-b', 'sha256:semantic-b'),
      passStatus: { lock: 'succeeded', emit: 'succeeded' }
    });
    const staleGraph = graphWithRevision('sha256:input-a', 'sha256:semantic-a');

    await writeJson(lockPath, lock);
    await writeJson(explainGraphPath, staleGraph);

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
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const explainGraphPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph);
    const reviewSummaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
    const artifactManifestPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.artifactManifest);
    const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
    const lock = buildReviewLock({
      semanticViews: buildSemanticViewFixture(),
      passStatus: { lock: 'succeeded', emit: 'pending' }
    });
    const reviewMarker = '{"semantic":"before-refresh"}\n';

    await writeJson(lockPath, lock);
    await writeJson(explainGraphPath, graphWithRevision(
      lock.semanticViews!.inputRevision,
      lock.semanticViews!.semanticRevision
    ));
    await fs.mkdir(path.dirname(reviewSummaryPath), { recursive: true });
    await fs.mkdir(path.dirname(artifactManifestPath), { recursive: true });
    await fs.mkdir(path.dirname(provenancePath), { recursive: true });
    await fs.writeFile(reviewSummaryPath, reviewMarker, 'utf8');

    const result = await writeWorkspaceArtifacts(workspaceRoot);

    expect(result.reviewSummary).toBeNull();
    expect(result.manifest.artifacts.some((artifact) => CI_EMIT_ARTIFACT_PATHS.includes(artifact.path))).toBe(false);
    expect(result.manifest.summary).toMatchObject({
      artifactStatus: 'attention',
      missingReasonCounts: {
        [CI_ARTIFACT_MISSING_REASON.staleSemanticProjection]: CI_EMIT_ARTIFACT_PATHS.length
      }
    });
    expect(await fs.readFile(reviewSummaryPath, 'utf8')).toBe(reviewMarker);
  }, 'engineering-compiler-semantic-artifact-status-');
});

test('artifact selection fails closed when a corrupt Lock leaves stale emit files on disk', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
    const explainGraphPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph);
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.mkdir(path.dirname(explainGraphPath), { recursive: true });
    await fs.writeFile(lockPath, '{broken-json', 'utf8');
    await fs.writeFile(explainGraphPath, '{"semantic":"stale"}\n', 'utf8');

    expect(() => buildCiArtifactManifest(workspaceRoot)).toThrow(/not valid JSON/iu);
    expect(await fs.readFile(explainGraphPath, 'utf8')).toBe('{"semantic":"stale"}\n');
  }, 'engineering-compiler-semantic-artifact-corrupt-lock-');
});
