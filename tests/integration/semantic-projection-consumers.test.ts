import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../src/compiler/ir/load-workspace-engineering-ir-input.ts';
import { buildValidatedEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { explainWorkspace } from '../../src/compiler/orchestration/cli.ts';
import { buildSemanticViewSet } from '../../src/compiler/projection/build-semantic-view-set.ts';
import type { ExplainGraph } from '../../src/semantic/projection/contract/explain.ts';
import type { ReviewSummary } from '../../src/verification/review/contract/types.ts';
import { readJson, writeJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { prepareLockedWorkspace } from '../testkit/workspace.ts';

test('ExplainGraph and ReviewSummary consume one canonical SemanticViewSet identity', async () => {
  const workspaceRoot = await prepareLockedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-semantic-projection-consumers-'
  });
  const paths = getWorkspacePaths(workspaceRoot);
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
