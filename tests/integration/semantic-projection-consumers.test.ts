import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../src/adapters/workspace/engineering-input.ts';
import { buildValidatedEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { explainWorkspace } from '../../src/application/engineering/cli.ts';
import { buildSemanticViewSet } from '../../src/compiler/projection/build-semantic-view-set.ts';
import type { ExplainGraph } from '../../src/semantics/projection/explain.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import type { ReviewSummary } from '../../src/verification/review/contract/types.ts';
import { readJson, writeJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { prepareLockedWorkspace } from '../testkit/workspace.ts';

test('ExplainGraph and ReviewSummary consume one canonical SemanticViewSet identity', async () => {
  const workspaceRoot = await prepareLockedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-semantic-projection-consumers-'
  });
  const paths = {
    lockPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock),
    explainGraphPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph),
    reviewSummaryPath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary)
  };
  const { engineeringIRInput } = await loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
  const snapshot = buildValidatedEngineeringIR(engineeringIRInput);
  const semanticViews = buildSemanticViewSet(snapshot);
  const lock = await readJson<LockFile>(paths.lockPath);
  lock.semanticViews = structuredClone(semanticViews);
  await writeJson(paths.lockPath, lock);

  await explainWorkspace(workspaceRoot);

  const graph = await readJson<ExplainGraph>(paths.explainGraphPath);
  const review = await readJson<ReviewSummary>(paths.reviewSummaryPath);
  const sharedFactId = snapshot.ir.facts.find((fact) =>
    fact.subject === 'operation:ticket:transitionTicketStatus' &&
    fact.predicate === 'MUTATES' &&
    fact.object.kind === 'entity' &&
    fact.object.entityId === 'state:ticket:ticket-status'
  )!.id;

  expect(graph.semanticViews).toEqual(semanticViews);
  expect(new Set(graph.semanticViews?.views.map((view) => view.viewKind))).toEqual(
    new Set(['architecture', 'scenario', 'state'])
  );
  expect(graph.nodes.some((node) =>
    node.references?.some((reference) => reference.kind === 'fact' && reference.ref === sharedFactId)
  )).toBe(true);
  expect(review.semanticViewSummary).toMatchObject({
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    viewKindCounts: { architecture: 1 }
  });
  expect(review.semanticViewSummary?.factIds).toContain(sharedFactId);
}, 180000);
