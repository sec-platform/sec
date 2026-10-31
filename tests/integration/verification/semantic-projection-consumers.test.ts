import { expect, test } from 'bun:test';

import { readJson } from "../../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { ReviewSummary } from '../../../src/assurance/verification/review/contract/types.ts';
import { explainWorkspace } from '../../../src/bootstrap/engineering/cli.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import type { ExplainGraph } from '../../../src/semantics/projection/explain.ts';
import { prepareLockedWorkspace } from '../../testkit/workspace.ts';

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
  const lock = await readJson<LockFile>(paths.lockPath);
  const semanticViews = lock.semanticViews!;
  // Consume the real pipeline's persisted projection, rather than replacing
  // the Lock with a separately rebuilt copy before exercising its consumers.
  const sharedFactId = semanticViews.views.find((view) => view.viewKind === 'architecture')!
    .edges.find((edge) =>
      edge.source === 'operation:ticket:transitionTicketStatus' &&
      edge.relation === 'MUTATES' &&
      edge.target === 'state:ticket:ticket-status'
    )!.references.find((reference) => reference.kind === 'fact')!.ref;
  expect(sharedFactId).toBeTruthy();

  await explainWorkspace(workspaceRoot);

  const graph = await readJson<ExplainGraph>(paths.explainGraphPath);
  const review = await readJson<ReviewSummary>(paths.reviewSummaryPath);

  expect(graph.semanticViews).toEqual(semanticViews);
  expect(new Set(graph.semanticViews?.views.map((view) => view.viewKind))).toEqual(
    new Set(['architecture', 'scenario', 'state'])
  );
  expect(graph.nodes.some((node) =>
    node.references?.some((reference) => reference.kind === 'fact' && reference.ref === sharedFactId)
  )).toBe(true);
  expect(review.semanticViewSummary).toMatchObject({
    inputRevision: semanticViews.inputRevision,
    semanticRevision: semanticViews.semanticRevision,
    viewKindCounts: { architecture: 1 }
  });
  expect(review.semanticViewSummary?.factIds).toContain(sharedFactId);
}, 180000);
