import { expect, test } from 'bun:test';

import { buildExplainGraph } from '../../../src/adapters/compilation/emit/write-explain-graph.ts';
import type { LockFile } from '../../../src/compiler/contract.ts';
import type { AcceptanceCoverageReport } from '../../../src/assurance/acceptance/coverage.ts';
import type { ViewEdge, ViewNode } from '../../../src/semantics/projection/types.ts';
import type { ProvenanceFile } from '../../../src/semantics/provenance/types.ts';
import type { PolicyReport } from '../../../src/semantics/policies/types.ts';
import { buildPassingReviewCoverage, buildReviewLock } from '../../helpers/review-fixtures.ts';
import { expectGraphEdge, expectGraphNode } from '../../helpers/graph-assertions.ts';
import { buildUpgradeDiagnostics, buildUpgradePlanArtifact } from '../../helpers/upgrade-fixtures.ts';
import { buildSemanticViewFixture } from '../../helpers/semantic-view-fixtures.ts';

const EMPTY_PROVENANCE: ProvenanceFile = {
  formatVersion: '1',
  artifacts: []
};

const EMPTY_COVERAGE: AcceptanceCoverageReport = {
  formatVersion: '2',
  status: 'passed',
  source: { resolvedBlockIds: [], acceptancePlan: [], declarations: [], tests: [] },
  acceptancePassed: [],
  blocks: [],
  uncoveredBlocks: []
};

function node(id: string, label = id, entityKind: ViewNode['entityKind'] = 'entity'): ViewNode {
  return {
    id,
    entityId: id,
    entityKind,
    label,
    badges: [],
    references: []
  };
}

function lockWithProjection(nodes: ViewNode[], edges: ViewEdge[] = []) {
  const semanticViews = buildSemanticViewFixture();
  return buildReviewLock({
    semanticViews: {
      ...semanticViews,
      views: [{
        ...semanticViews.views[0]!,
        nodes,
        edges
      }]
    }
  });
}

test('explain graph rejects one node identity with conflicting definitions', async () => {
  const lock = lockWithProjection([
    node('app:customer-admin', 'different-label', 'app')
  ]);

  await expect(buildExplainGraph(
    process.cwd(),
    lock,
    EMPTY_PROVENANCE,
    EMPTY_COVERAGE,
    null
  )).rejects.toMatchObject({ code: 'EXPLAIN-GRAPH-001' });
});

test('explain graph rejects every edge whose endpoint was never registered', async () => {
  const source = node('app:customer-admin', 'customer-admin', 'app');
  const lock = lockWithProjection([source], [{
    id: 'edge:dangling',
    source: source.id,
    target: 'entity:missing',
    relation: 'CONTAINS',
    label: 'dangling',
    references: []
  }]);

  await expect(buildExplainGraph(
    process.cwd(),
    lock,
    EMPTY_PROVENANCE,
    EMPTY_COVERAGE,
    null
  )).rejects.toMatchObject({ code: 'EXPLAIN-GRAPH-002' });
});

test('edge tuple identity cannot collide through colon-bearing node ids', async () => {
  const app = node('app:customer-admin', 'customer-admin', 'app');
  const firstSource = node('a');
  const firstTarget = node('b:depends_on:c');
  const secondSource = node('a:contains:b');
  const secondTarget = node('c');
  const lock = lockWithProjection(
    [app, firstSource, firstTarget, secondSource, secondTarget],
    [{
      id: 'edge:first',
      source: firstSource.id,
      target: firstTarget.id,
      relation: 'CONTAINS',
      label: 'first',
      references: []
    }, {
      id: 'edge:second',
      source: secondSource.id,
      target: secondTarget.id,
      relation: 'DEPENDS_ON',
      label: 'second',
      references: []
    }]
  );

  const graph = await buildExplainGraph(
    process.cwd(),
    lock,
    EMPTY_PROVENANCE,
    EMPTY_COVERAGE,
    null
  );

  expect(graph.edges).toEqual([
    { from: firstSource.id, to: firstTarget.id, type: 'contains' },
    { from: secondSource.id, to: secondTarget.id, type: 'depends_on' }
  ]);
});

test('explain graph retains provenance, coverage, policy and upgrade projections', async () => {
  const app = node('app:customer-admin', 'customer-admin', 'app');
  const lock = lockWithProjection([app]);
  lock.acceptancePlan = ['acceptance-1'];
  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: [{
      path: 'generated.txt',
      originType: 'block',
      originId: 'fixture/basic',
      sourceBlock: 'fixture/basic',
      generatedByPass: 'compose',
      verifiedBy: [],
      overrideStatus: 'none'
    }]
  };
  const coverage: AcceptanceCoverageReport = {
    ...EMPTY_COVERAGE,
    acceptancePassed: ['acceptance-1'],
    blocks: [{ id: 'fixture/basic', declaredAcceptance: ['acceptance-1'], coveredBy: ['acceptance-1'], uncovered: false }]
  };

  const graph = await buildExplainGraph(
    process.cwd(),
    lock,
    provenance,
    coverage,
    null
  );

  expect(graph.nodes).toContainEqual({
    id: 'block:fixture/basic',
    type: 'block',
    label: 'fixture/basic'
  });
  expect(graph.edges).toContainEqual({
    from: 'file:generated.txt',
    to: 'block:fixture/basic',
    type: 'originates_from'
  });
  expect(graph.edges).toContainEqual({
    from: 'block:fixture/basic',
    to: 'acceptance:acceptance-1',
    type: 'verified_by'
  });

  // Pure evidence projections share this unit graph contract; no E2E workspace is prepared.
  {
    const workspaceRoot = process.cwd();
    const lock = buildReviewLock({ semanticViews: buildSemanticViewFixture() });
    const provenance: ProvenanceFile = {
      formatVersion: '1',
      artifacts: [
        {
          path: 'src/installed/entity/customer-service.ts',
          originType: 'block',
          originId: 'entity/customer-basic',
          sourceBlock: 'entity/customer-basic',
          generatedByPass: 'compose',
          verifiedBy: [],
          overrideStatus: 'none'
        }
      ]
    };
    const coverage: AcceptanceCoverageReport = {
      ...buildPassingReviewCoverage(),
      acceptancePassed: ['tenant_only_sees_own_customers']
    };
    const policyReport: PolicyReport = {
      status: 'failed',
      official: {
        policies: ['tenant-scope-required'],
        sources: [
          {
            path: 'catalog/policies/official/policy.spec.yaml',
            policyIds: ['tenant-scope-required']
          }
        ],
        violations: []
      },
      project: emptyPolicyScopeReport(),
      merged: {
        policies: [
          {
            id: 'tenant-scope-required',
            sourceScope: 'official',
            sourcePath: 'catalog/policies/official/policy.spec.yaml',
            targets: ['src/installed/entity/customer-service.ts']
          }
        ]
      },
      violations: [
        {
          id: 'tenant-scope-required',
          severity: 'error',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query',
          files: ['src/installed/entity/customer-service.ts'],
          message: 'Entity customer queries must derive tenant context and filter by tenantId.',
          sourceScope: 'official',
          sourcePath: 'catalog/policies/official/policy.spec.yaml'
        },
        {
          id: 'tenant-scope-required',
          severity: 'error',
          appliesTo: ['entity/customer-basic'],
          rule: 'tenant_context_must_flow_to_query',
          files: ['src/installed/entity/customer-service.ts'],
          message: 'Entity customer queries must derive tenant context and filter by tenantId.',
          sourceScope: 'official',
          sourcePath: 'catalog/policies/official/policy.spec.yaml'
        }
      ]
    };

    const graph = await buildExplainGraph(workspaceRoot, lock, provenance, coverage, policyReport);

    expectGraphNode(graph, { id: 'policy:tenant-scope-required' });
    expectGraphEdge(graph, {
      from: 'policy:tenant-scope-required',
      to: 'file:src/installed/entity/customer-service.ts',
      type: 'connects_to'
    });
    const violationEdges = graph.edges.filter(
      (edge) =>
        edge.from === 'file:src/installed/entity/customer-service.ts' &&
        edge.to === 'policy:tenant-scope-required' &&
        edge.type === 'violates'
    );
    expect(violationEdges).toHaveLength(1);

    const upgradePlan = buildUpgradePlanArtifact({
      blockId: 'entity/customer-basic',
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      preflightChecks: [
        {
          id: 'version-range',
          status: 'passed',
          message: 'Upgrade path 0.1.0 -> 0.2.0 is allowed',
          evidence: ['0.1.x']
        },
        {
          id: 'migration-entries',
          status: 'passed',
          message: '2 migration entries loaded and validated',
          evidence: [
            'mig-customer-normalizer-file:migrations/customer-normalizer-file.json',
            'mig-upgrade-metadata:migrations/upgrade-metadata.json'
          ]
        },
        {
          id: 'impact-scan',
          status: 'passed',
          message: '2 upgrade impacts calculated',
          evidence: ['src/installed/entity/customer-service.ts', 'upgrade.metadata.json']
        },
        {
          id: 'override-conflicts',
          status: 'passed',
          message: '0 overrides scanned with no conflicts',
          evidence: []
        }
      ],
      impacts: ['src/installed/entity/customer-service.ts', 'upgrade.metadata.json'],
      migrations: [
        {
          id: 'mig-customer-normalizer-file',
          kind: 'file-replace',
          entry: 'migrations/customer-normalizer-file.json',
          requiresVerification: true
        },
        {
          id: 'mig-upgrade-metadata',
          kind: 'text-append',
          entry: 'migrations/upgrade-metadata.json',
          requiresVerification: false
        }
      ],
      migrationKindCounts: {
        'file-replace': 1,
        'text-append': 1
      },
      migrationSummaries: [
        {
          id: 'mig-customer-normalizer-file',
          kind: 'file-replace',
          target: 'src/installed/entity/customer-service.ts',
          reason: 'Replace the customer normalizer implementation.',
          requiresVerification: true,
          source: 'migrations/customer-normalizer-v2.ts'
        },
        {
          id: 'mig-upgrade-metadata',
          kind: 'text-append',
          target: 'upgrade.metadata.json',
          reason: 'Record upgrade metadata.',
          requiresVerification: false
        }
      ],
      migrationOperations: [
        {
          id: 'mig-customer-normalizer-file',
          kind: 'file-replace',
          target: 'src/installed/entity/customer-service.ts',
          role: 'file',
          source: 'migrations/customer-normalizer-v2.ts'
        },
        {
          id: 'mig-upgrade-metadata',
          kind: 'text-append',
          target: 'upgrade.metadata.json',
          role: 'text',
          contentLength: 24
        }
      ]
    });
    const diagnostics = buildUpgradeDiagnostics({
      blockId: 'entity/customer-basic',
      targetVersion: '0.2.0',
      failedCheck: 'override-conflicts',
      errorCode: 'UPGRADE-CONFLICT-001',
      message: 'Override conflicts with upgrade',
      details: {
        migrationId: 'mig-customer-normalizer-file',
        migrationKind: 'file-replace',
        entry: 'migrations/customer-normalizer-file.json',
        entryId: 'mig-customer-normalizer-file-entry',
        entryKind: 'text-replace',
        rollbackStatus: 'restored'
      }
    });

    const upgradeGraph = await buildExplainGraph(
      workspaceRoot,
      lock,
      { formatVersion: '1', artifacts: [] },
      buildPassingReviewCoverage(),
      null,
      upgradePlan,
      diagnostics
    );
    const upgradeId = 'upgrade:entity/customer-basic:0.2.0';
    const upgradeEdges = upgradeGraph.edges.filter(
      (edge) => edge.from === upgradeId || edge.from.startsWith(`${upgradeId}:`)
    );
    const upgradeEndpointIds = new Set(
      upgradeEdges.flatMap((edge) => [edge.from, edge.to])
    );
    const upgradeNodes = upgradeGraph.nodes.filter((node) =>
      upgradeEndpointIds.has(node.id) ||
      node.id.startsWith(`${upgradeId}:`) ||
      node.id.startsWith('upgrade-verification:')
    );

    expect(upgradeNodes).toHaveLength(15);
    expect(upgradeNodes).toEqual(expect.arrayContaining([
      {
        id: upgradeId,
        type: 'upgrade',
        label: 'entity/customer-basic 0.1.0 -> 0.2.0'
      },
      {
        id: `${upgradeId}:preflight:version-range`,
        type: 'upgrade',
        label: 'version-range'
      },
      {
        id: `${upgradeId}:preflight:migration-entries`,
        type: 'upgrade',
        label: 'migration-entries'
      },
      {
        id: `${upgradeId}:preflight:impact-scan`,
        type: 'upgrade',
        label: 'impact-scan'
      },
      {
        id: `${upgradeId}:preflight:override-conflicts`,
        type: 'upgrade',
        label: 'override-conflicts'
      },
      {
        id: `${upgradeId}:migration:mig-customer-normalizer-file`,
        type: 'upgrade',
        label: 'mig-customer-normalizer-file'
      },
      {
        id: `${upgradeId}:migration:mig-upgrade-metadata`,
        type: 'upgrade',
        label: 'mig-upgrade-metadata'
      },
      {
        id: 'upgrade-verification:required',
        type: 'upgrade',
        label: 'verification required'
      },
      {
        id: 'upgrade-verification:skipped',
        type: 'upgrade',
        label: 'verification skipped'
      },
      {
        id: `${upgradeId}:diagnostics`,
        type: 'upgrade',
        label: 'UPGRADE-CONFLICT-001'
      },
      {
        id: `${upgradeId}:rollback:restored`,
        type: 'upgrade',
        label: 'rollback restored'
      },
      {
        id: 'block:entity/customer-basic',
        type: 'block',
        label: 'entity/customer-basic'
      },
      {
        id: 'file:src/installed/entity/customer-service.ts',
        type: 'file',
        label: 'src/installed/entity/customer-service.ts'
      },
      {
        id: 'file:migrations/customer-normalizer-file.json',
        type: 'file',
        label: 'migrations/customer-normalizer-file.json'
      },
      {
        id: 'file:upgrade.metadata.json',
        type: 'file',
        label: 'upgrade.metadata.json'
      }
    ]));

    expect(upgradeEdges).toHaveLength(18);
    expect(upgradeEdges).toEqual(expect.arrayContaining([
      { from: upgradeId, to: 'block:entity/customer-basic', type: 'connects_to' },
      { from: upgradeId, to: 'file:src/installed/entity/customer-service.ts', type: 'writes_to' },
      { from: upgradeId, to: 'file:upgrade.metadata.json', type: 'writes_to' },
      { from: upgradeId, to: `${upgradeId}:preflight:version-range`, type: 'depends_on' },
      { from: upgradeId, to: `${upgradeId}:preflight:migration-entries`, type: 'depends_on' },
      { from: upgradeId, to: `${upgradeId}:preflight:impact-scan`, type: 'depends_on' },
      { from: upgradeId, to: `${upgradeId}:preflight:override-conflicts`, type: 'depends_on' },
      { from: upgradeId, to: `${upgradeId}:migration:mig-customer-normalizer-file`, type: 'depends_on' },
      { from: upgradeId, to: `${upgradeId}:migration:mig-upgrade-metadata`, type: 'depends_on' },
      {
        from: `${upgradeId}:migration:mig-customer-normalizer-file`,
        to: 'upgrade-verification:required',
        type: 'depends_on'
      },
      {
        from: `${upgradeId}:migration:mig-customer-normalizer-file`,
        to: 'file:src/installed/entity/customer-service.ts',
        type: 'writes_to'
      },
      {
        from: `${upgradeId}:migration:mig-upgrade-metadata`,
        to: 'upgrade-verification:skipped',
        type: 'depends_on'
      },
      {
        from: `${upgradeId}:migration:mig-upgrade-metadata`,
        to: 'file:upgrade.metadata.json',
        type: 'writes_to'
      },
      {
        from: `${upgradeId}:diagnostics`,
        to: upgradeId,
        type: 'connects_to'
      },
      {
        from: `${upgradeId}:diagnostics`,
        to: `${upgradeId}:migration:mig-customer-normalizer-file`,
        type: 'connects_to'
      },
      {
        from: `${upgradeId}:diagnostics`,
        to: `${upgradeId}:preflight:override-conflicts`,
        type: 'connects_to'
      },
      {
        from: `${upgradeId}:diagnostics`,
        to: 'file:migrations/customer-normalizer-file.json',
        type: 'connects_to'
      },
      {
        from: `${upgradeId}:diagnostics`,
        to: `${upgradeId}:rollback:restored`,
        type: 'connects_to'
      }
    ]));
  }
}, 180000);

test('semantic ports retain canonical endpoints and references without legacy aliases', async () => {
  const app = node('app:customer-admin', 'customer-admin', 'app');
  const block = node('block:fixture/basic', 'fixture/basic', 'block');
  const port = node('port:fixture/basic:input:context', 'context', 'port');
  port.references = [{ kind: 'entity', ref: port.id }];
  const references = [{ kind: 'entity' as const, ref: block.id }, ...port.references];
  const lock = lockWithProjection([app, block, port], [{
    id: 'edge:context', source: block.id, target: port.id,
    relation: 'REQUIRES', label: 'requires', references
  }]);
  const graph = await buildExplainGraph(process.cwd(), lock, EMPTY_PROVENANCE, EMPTY_COVERAGE, null);

  expect(graph.nodes).toHaveLength(3);
  expect(graph.nodes.find(entry => entry.id === port.id)).toEqual({
    id: port.id, type: 'port', label: 'context', references: port.references
  });
  expect(graph.edges).toEqual([{
    from: block.id, to: port.id, type: 'requires', references
  }]);
  expect(graph.nodes.some(entry => entry.type === 'pin')).toBe(false);
  const endpoints = new Set(graph.nodes.map(entry => entry.id));
  expect(endpoints.size).toBe(graph.nodes.length);
  expect(graph.edges.every(edge => endpoints.has(edge.from) && endpoints.has(edge.to))).toBe(true);
});

function appIdentityLock(name: string): LockFile {
  return {
    formatVersion: "1",
    app: {
      id: "stable-app",
      name,
      stack: "typescript-library",
      mode: "single-tenant",
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    generatedPaths: [],
    acceptancePlan: [],
    semanticViews: buildSemanticViewFixture(),
    passStatus: {
      parse: "succeeded",
      align: "succeeded",
      resolve: "succeeded",
      compose: "succeeded",
      verify: "succeeded",
      repair: "skipped",
      lock: "succeeded",
      emit: "succeeded",
    },
  };
}

test("ExplainGraph uses lock app.id for identity and app.name only for label", async () => {
  const before = await buildExplainGraph(
    process.cwd(),
    appIdentityLock("Before"),
    EMPTY_PROVENANCE,
    EMPTY_COVERAGE,
    null,
  );
  const after = await buildExplainGraph(
    process.cwd(),
    appIdentityLock("After"),
    EMPTY_PROVENANCE,
    EMPTY_COVERAGE,
    null,
  );

  expect(before.nodes).toEqual([
    { id: "app:stable-app", type: "app", label: "Before" },
  ]);
  expect(after.nodes).toEqual([
    { id: "app:stable-app", type: "app", label: "After" },
  ]);
});
