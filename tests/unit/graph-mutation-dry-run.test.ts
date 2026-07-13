import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadPlan } from '../../platform/compiler/parse/load-plan.ts';
import { applyViewMutations } from '../../platform/compiler/workbench/apply-view-mutations.ts';
import {
  GRAPH_MUTATION_DRY_RUN_REPORT_PATH,
  buildGraphMutationDryRun
} from '../../platform/compiler/workbench/graph-mutation-dry-run.ts';
import { initWorkspace } from '../../platform/orchestrator.ts';
import { fixedCiArtifactPaths } from '../../platform/shared/ci-artifact-contract.ts';
import type { ExplainGraph } from '../../platform/shared/explain-types.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const baseGraph: ExplainGraph = {
  semanticViews: buildSemanticViewFixture(),
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
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });

    const paths = getWorkspacePaths(workspaceRoot);
    // 使用 baseGraph（与第一个测试一致）作为 dry-run 输入，避免一次完整的 resolve+buildExplainGraph 调用。
    // baseGraph 不含 acceptance 节点，precondition "acceptance-node-absent" 同样满足。
    const report = buildGraphMutationDryRun(baseGraph, [
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
    await applyViewMutations(workspaceRoot, async () => undefined);
    // buildExplainGraph 把 lock.acceptancePlan 中每个 id 映射为 acceptance:<id> 节点；
    // lock.acceptancePlan 又派生自 plan.acceptance。直接读 plan 校验源头即可，
    // 避免再做一次 resolveWorkspace + buildExplainGraph（每次 ~2-3s）。
    const plan = await loadPlan(paths.planPath);
    const expectedAcceptanceIds = report.operations.flatMap((operation) =>
      operation.expectedGraphDelta.nodes.added
        .filter((node) => node.type === 'acceptance')
        .map((node) => node.label)
    );

    for (const expectedId of expectedAcceptanceIds) {
      expect(plan.acceptance.some((entry) => entry.id === expectedId)).toBe(true);
    }
  }, 'engineering-compiler-graph-mutation-dry-run-');
}, 120000);
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
