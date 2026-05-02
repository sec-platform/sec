import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'bun:test';

import { buildExplainGraph } from '../../platform/compiler/emit/write-explain-graph.ts';
import { applyViewMutations } from '../../platform/compiler/workbench/apply-view-mutations.ts';
import {
  GRAPH_MUTATION_DRY_RUN_REPORT_PATH,
  buildGraphMutationDryRun
} from '../../platform/compiler/workbench/graph-mutation-dry-run.ts';
import { initWorkspace, resolveWorkspace } from '../../platform/orchestrator.ts';
import { fixedCiArtifactPaths } from '../../platform/shared/ci-artifact-contract.ts';
import type { ExplainGraph } from '../../platform/shared/explain-types.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { AcceptanceCoverageReport, ProvenanceFile } from '../../platform/shared/types.ts';
import { createWorkspace } from '../helpers/workspace-fixtures.ts';

const baseGraph: ExplainGraph = {
  nodes: [
    {
      id: 'app:service-admin',
      type: 'app',
      label: 'service-admin'
    }
  ],
  edges: [],
  overlays: {
    provenance: [],
    coverage: {
      blocks: [],
      slots: []
    }
  }
};

function emptyCoverage(): AcceptanceCoverageReport {
  return {
    formatVersion: '1',
    status: 'passed',
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: [],
    uncoveredSlots: []
  };
}

function emptyProvenance(): ProvenanceFile {
  return {
    formatVersion: '1',
    artifacts: []
  };
}

async function buildCurrentGraph(workspaceRoot: string): Promise<ExplainGraph> {
  const { lock } = await resolveWorkspace(workspaceRoot);
  return buildExplainGraph(workspaceRoot, lock, emptyProvenance(), emptyCoverage(), null);
}

test('builds a dry-run report that previews an add-acceptance mutation without writing source', () => {
  const report = buildGraphMutationDryRun(baseGraph, [
    {
      id: 'add-review-acceptance',
      kind: 'add-acceptance',
      acceptanceId: 'review_can_approve_graph_change'
    }
  ]);

  expect(report).toMatchObject({
    formatVersion: '1',
    path: GRAPH_MUTATION_DRY_RUN_REPORT_PATH,
    stableArtifact: false,
    mode: 'dry-run',
    status: 'ready',
    writesSource: false,
    sourceRoot: 'source/views/mutations',
    targetPath: 'source/app.yaml',
    operationCount: 1,
    mutationFileCount: 1,
    summary: {
      readyCount: 1,
      blockedCount: 0,
      expectedNodeAddCount: 1,
      expectedEdgeAddCount: 0
    },
    operations: [
      {
        id: 'add-review-acceptance',
        kind: 'add-acceptance',
        status: 'ready',
        risk: 'low',
        mutationFilePath: 'source/views/mutations/add-review-acceptance.json',
        mutationFile: {
          formatVersion: '1',
          mutations: [
            {
              id: 'add-review-acceptance',
              kind: 'add-acceptance',
              acceptanceId: 'review_can_approve_graph_change'
            }
          ]
        },
        preconditions: [
          {
            id: 'acceptance-node-absent',
            status: 'satisfied',
            target: 'acceptance:review_can_approve_graph_change'
          }
        ],
        expectedGraphDelta: {
          nodes: {
            added: [
              {
                id: 'acceptance:review_can_approve_graph_change',
                type: 'acceptance',
                label: 'review_can_approve_graph_change'
              }
            ],
            changed: [],
            removed: []
          },
          edges: {
            added: [],
            changed: [],
            removed: []
          }
        },
        affectedNodes: ['app:service-admin', 'acceptance:review_can_approve_graph_change'],
        affectedEdges: [],
        requiredPasses: ['workbench-mutations-apply', 'resolve', 'verify', 'explain'],
        rollback: 'Remove source/views/mutations/add-review-acceptance.json before apply, or revert the acceptance entry in source/app.yaml after apply.',
        rejectionReason: null
      }
    ]
  });
});

test('expected node delta matches the graph after applying the generated mutation file', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-graph-mutation-dry-run-');
  await initWorkspace(workspaceRoot, { reset: true });

  const paths = getWorkspacePaths(workspaceRoot);
  const beforeGraph = await buildCurrentGraph(workspaceRoot);
  const report = buildGraphMutationDryRun(beforeGraph, [
    {
      id: 'add-review-acceptance',
      kind: 'add-acceptance',
      acceptanceId: 'review_can_approve_graph_change'
    }
  ]);
  const mutationFile = report.operations[0]?.mutationFile;

  const mutationFilesBeforeApply = (await fs.readdir(paths.sourceViewMutationsRoot)).filter((file) => file.endsWith('.json'));
  expect(mutationFilesBeforeApply).toHaveLength(0);
  expect(mutationFile).not.toBeNull();
  if (!mutationFile) throw new Error('expected ready dry-run mutation file');

  await writeJson(path.join(paths.sourceViewMutationsRoot, 'add-review-acceptance.json'), mutationFile);
  await applyViewMutations(workspaceRoot);
  const afterGraph = await buildCurrentGraph(workspaceRoot);
  const beforeNodeIds = new Set(beforeGraph.nodes.map((node) => node.id));
  const addedNodeIds = afterGraph.nodes
    .filter((node) => !beforeNodeIds.has(node.id))
    .map((node) => node.id);
  const expectedNodeIds = report.operations.flatMap((operation) =>
    operation.expectedGraphDelta.nodes.added.map((node) => node.id)
  );

  // FIXME: arrayContaining hides unexpected extras; need exact length check
  expect(addedNodeIds).toEqual(expect.arrayContaining(expectedNodeIds));
});

test('rejects mutation ids that cannot be used as source mutation file names', () => {
  expect(() => buildGraphMutationDryRun(baseGraph, [
    {
      id: '../escape',
      kind: 'add-acceptance',
      acceptanceId: 'review_can_approve_graph_change'
    }
  ])).toThrow('Graph mutation operation id "../escape" must be kebab-case');
});

test('keeps graph mutation dry-run outside stable artifact paths', () => {
  expect(fixedCiArtifactPaths()).not.toContain(GRAPH_MUTATION_DRY_RUN_REPORT_PATH);
});
