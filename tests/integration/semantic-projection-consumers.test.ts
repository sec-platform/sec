import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import {
  buildSemanticViewSet,
  buildValidatedEngineeringIR,
  loadWorkspaceEngineeringIRBuildInput
} from '../../platform/compiler/index.ts';
import { explainWorkspace } from '../../platform/orchestrator.ts';
import type { ExplainGraph } from '../../platform/shared/explain-types.ts';
import { readJson, writeJson } from '../../platform/shared/fs.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { ReviewSummary } from '../../platform/shared/review-types.ts';
import { prepareLockedWorkspace } from '../testkit/workspace.ts';

test('ExplainGraph, ReviewSummary, and Workbench consume one canonical SemanticViewSet identity', async () => {
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
  const workbench = await fs.readFile(paths.graphViewPath, 'utf8');
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
  expect(workbench).toContain('Semantic Views');
  expect(workbench).toContain('console-content-semantic');
  expect(workbench).toContain('<td>architecture</td>');
  expect(workbench).toContain('<td>scenario</td>');
  expect(workbench).toContain('<td>state</td>');
  expect(workbench).toContain(sharedFactId);
}, 180000);
