import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { buildExplainGraph, writeExplainGraph } from '../../platform/compiler/emit/write-explain-graph.ts';
import { initWorkspace, resolveWorkspace } from '../../platform/orchestrator.ts';
import {
  CI_ARTIFACT_FILES,
  CI_EXPLAIN_GRAPH_ARTIFACT_PATHS
} from '../../platform/shared/ci-artifact-contract.ts';
import { readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  PolicyReport,
  ProvenanceFile,
  RepairPlan,
  UpgradeDiagnostics,
  UpgradePlan
} from '../../platform/shared/types.ts';
import { expectGraphEdge, expectGraphNode, expectNoGraphNode } from '../helpers/graph-assertions.ts';
import { buildOfficialResolvedBlock } from '../helpers/lock-fixtures.ts';
import { emptyPolicyScopeReport } from '../helpers/policy-fixtures.ts';
import { createWorkspace } from '../helpers/workspace-fixtures.ts';

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

test('explain graph includes pins, policies, and policy violation edges without runtime verification', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-explain-graph-');

  await initWorkspace(workspaceRoot, { reset: true });
  const { lock } = await resolveWorkspace(workspaceRoot);
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
    ...emptyCoverage(),
    acceptancePassed: ['tenant_only_sees_own_customers']
  };
  const policyReport: PolicyReport = {
    status: 'failed',
    official: {
      policies: ['tenant-scope-required'],
      sources: [
        {
          path: 'platform/policies/official/policy.spec.yaml',
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
          sourcePath: 'platform/policies/official/policy.spec.yaml',
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
        sourcePath: 'platform/policies/official/policy.spec.yaml'
      },
      {
        id: 'tenant-scope-required',
        severity: 'error',
        appliesTo: ['entity/customer-basic'],
        rule: 'tenant_context_must_flow_to_query',
        files: ['src/installed/entity/customer-service.ts'],
        message: 'Entity customer queries must derive tenant context and filter by tenantId.',
        sourceScope: 'official',
        sourcePath: 'platform/policies/official/policy.spec.yaml'
      }
    ]
  };

  const graph = await buildExplainGraph(workspaceRoot, lock, provenance, coverage, policyReport);

  expectGraphNode(graph, { id: 'pin:entity/customer-basic:input:tenant_context' });
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
}, 180000);
test('explain graph connects slot contract upgrade impacts to slots and files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-explain-upgrade-slot-');

  await initWorkspace(workspaceRoot, { reset: true });
  const { lock } = await resolveWorkspace(workspaceRoot);
  const upgradePlan: UpgradePlan = {
    formatVersion: '1',
    blockId: 'entity/customer-basic',
    fromVersion: '0.1.0',
    toVersion: '0.2.0',
    status: 'planned',
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
        message: '1 migration entries loaded and validated',
        evidence: ['mig-customer-normalizer-contract:migrations/customer-normalizer-contract.json']
      },
      {
        id: 'impact-scan',
        status: 'passed',
        message: '2 upgrade impacts calculated',
        evidence: ['custom/customer_normalizer.ts', 'upgrade.metadata.json']
      },
      {
        id: 'override-conflicts',
        status: 'passed',
        message: '0 overrides scanned with no conflicts',
        evidence: []
      }
    ],
    impacts: ['custom/customer_normalizer.ts', 'upgrade.metadata.json'],
    migrations: [
      {
        id: 'mig-customer-normalizer-contract',
        kind: 'slot-contract-update',
        entry: 'migrations/customer-normalizer-contract.json',
        requiresVerification: true
      }
    ],
    migrationKindCounts: {
      'slot-contract-update': 1,
      'text-append': 1
    },
    migrationSummaries: [
      {
        id: 'mig-customer-normalizer-contract',
        kind: 'slot-contract-update',
        target: 'custom/customer_normalizer.ts',
        reason: 'Update customer normalizer input contract to v2.',
        requiresVerification: true,
        slotId: 'customer_normalizer'
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
        id: 'mig-customer-normalizer-contract',
        kind: 'slot-contract-update',
        target: 'custom/customer_normalizer.ts',
        role: 'slot',
        slotId: 'customer_normalizer'
      },
      {
        id: 'mig-upgrade-metadata',
        kind: 'text-append',
        target: 'upgrade.metadata.json',
        role: 'text',
        contentLength: 24
      }
    ]
  };
  const diagnostics: UpgradeDiagnostics = {
    formatVersion: '1',
    status: 'blocked',
    phase: 'planning',
    blockId: 'entity/customer-basic',
    targetVersion: '0.2.0',
    failedCheck: 'override-conflicts',
    errorCode: 'UPGRADE-CONFLICT-001',
    message: 'Override conflicts with upgrade',
    details: {
      migrationId: 'mig-customer-normalizer-contract',
      migrationKind: 'slot-contract-update',
      entry: 'migrations/customer-normalizer-contract.json',
      entryId: 'mig-customer-normalizer-contract-entry',
      entryKind: 'text-replace',
      rollbackStatus: 'restored'
    }
  };

  const graph = await buildExplainGraph(
    workspaceRoot,
    lock,
    { formatVersion: '1', artifacts: [] },
    emptyCoverage(),
    null,
    upgradePlan,
    null,
    diagnostics
  );

  // FIXME: arrayContaining hides unexpected extras; need exact node count assertion
  expect(graph.nodes).toEqual(
    expect.arrayContaining([
      {
        id: 'upgrade:entity/customer-basic:0.2.0',
        type: 'upgrade',
        label: 'entity/customer-basic 0.1.0 -> 0.2.0'
      },
      {
        id: 'upgrade:entity/customer-basic:0.2.0:migration:mig-customer-normalizer-contract',
        type: 'upgrade',
        label: 'mig-customer-normalizer-contract'
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
        id: 'upgrade:entity/customer-basic:0.2.0:preflight:override-conflicts',
        type: 'upgrade',
        label: 'override-conflicts'
      },
      {
        id: 'upgrade:entity/customer-basic:0.2.0:diagnostics',
        type: 'upgrade',
        label: 'UPGRADE-CONFLICT-001'
      },
      {
        id: 'upgrade:entity/customer-basic:0.2.0:rollback:restored',
        type: 'upgrade',
        label: 'rollback restored'
      },
      { id: 'slot:customer_normalizer', type: 'slot', label: 'customer_normalizer' },
      { id: 'file:custom/customer_normalizer.ts', type: 'file', label: 'custom/customer_normalizer.ts' },
      {
        id: 'file:migrations/customer-normalizer-contract.json',
        type: 'file',
        label: 'migrations/customer-normalizer-contract.json'
      },
      { id: 'file:upgrade.metadata.json', type: 'file', label: 'upgrade.metadata.json' }
    ])
  );
  // FIXME: arrayContaining hides unexpected extras; need exact edge count assertion
  expect(graph.edges).toEqual(
    expect.arrayContaining([
      { from: 'upgrade:entity/customer-basic:0.2.0', to: 'block:entity/customer-basic', type: 'connects_to' },
      { from: 'upgrade:entity/customer-basic:0.2.0', to: 'file:upgrade.metadata.json', type: 'writes_to' },
      {
        from: 'upgrade:entity/customer-basic:0.2.0',
        to: 'upgrade:entity/customer-basic:0.2.0:migration:mig-customer-normalizer-contract',
        type: 'depends_on'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0',
        to: 'upgrade:entity/customer-basic:0.2.0:preflight:override-conflicts',
        type: 'depends_on'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:migration:mig-customer-normalizer-contract',
        to: 'upgrade-verification:required',
        type: 'depends_on'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:migration:mig-customer-normalizer-contract',
        to: 'file:custom/customer_normalizer.ts',
        type: 'writes_to'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:migration:mig-upgrade-metadata',
        to: 'upgrade-verification:skipped',
        type: 'depends_on'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:migration:mig-upgrade-metadata',
        to: 'file:upgrade.metadata.json',
        type: 'writes_to'
      },
      { from: 'block:entity/customer-basic', to: 'slot:customer_normalizer', type: 'connects_to' },
      { from: 'slot:customer_normalizer', to: 'file:custom/customer_normalizer.ts', type: 'writes_to' },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:diagnostics',
        to: 'upgrade:entity/customer-basic:0.2.0',
        type: 'connects_to'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:diagnostics',
        to: 'upgrade:entity/customer-basic:0.2.0:migration:mig-customer-normalizer-contract',
        type: 'connects_to'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:diagnostics',
        to: 'upgrade:entity/customer-basic:0.2.0:preflight:override-conflicts',
        type: 'connects_to'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:diagnostics',
        to: 'file:migrations/customer-normalizer-contract.json',
        type: 'connects_to'
      },
      {
        from: 'upgrade:entity/customer-basic:0.2.0:diagnostics',
        to: 'upgrade:entity/customer-basic:0.2.0:rollback:restored',
        type: 'connects_to'
      }
    ])
  );
}, 180000);
test('explain graph connects repair tasks to slots and files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-explain-repair-');

  await initWorkspace(workspaceRoot, { reset: true });
  const { lock } = await resolveWorkspace(workspaceRoot);
  const repairPlan: RepairPlan = {
    formatVersion: '1',
    status: 'pending',
    sourceVerificationStatus: 'failed',
    requiresVerification: false,
    tasks: [
      {
        taskId: 'repair_customer_normalizer',
        taskKind: 'repair-slot',
        category: 'slot-rewrite',
        phase: 'repair',
        sourceSlotId: 'customer_normalizer',
        targetBlock: 'entity/customer-basic',
        targetFile: 'custom/customer_normalizer.ts',
        allowedPaths: ['custom/customer_normalizer.ts'],
        requiredSymbols: [],
        forbiddenOperations: [],
        testsToPass: [],
        failureSummary: 'unit failed',
        failurePoints: []
      }
    ]
  };

  const graph = await buildExplainGraph(workspaceRoot, lock, { formatVersion: '1', artifacts: [] }, emptyCoverage(), null, null, repairPlan);

  const repairNodeIds = new Set([
    'repair:repair_customer_normalizer',
    'repair-category:slot-rewrite',
    'slot:customer_normalizer',
    'file:custom/customer_normalizer.ts'
  ]);

  const repairNodes = graph.nodes.filter((node) => repairNodeIds.has(node.id));
  expect(repairNodes).toHaveLength(4);
  expect(repairNodes).toEqual(
    expect.arrayContaining([
      { id: 'repair:repair_customer_normalizer', type: 'repair', label: 'repair_customer_normalizer' },
      { id: 'repair-category:slot-rewrite', type: 'repair', label: 'slot-rewrite' },
      { id: 'slot:customer_normalizer', type: 'slot', label: 'customer_normalizer' },
      { id: 'file:custom/customer_normalizer.ts', type: 'file', label: 'custom/customer_normalizer.ts' }
    ])
  );

  const repairEdges = graph.edges.filter((edge) => edge.from === 'repair:repair_customer_normalizer');
  expect(repairEdges).toHaveLength(3);
  expect(repairEdges).toEqual(
    expect.arrayContaining([
      { from: 'repair:repair_customer_normalizer', to: 'repair-category:slot-rewrite', type: 'depends_on' },
      { from: 'repair:repair_customer_normalizer', to: 'slot:customer_normalizer', type: 'connects_to' },
      { from: 'repair:repair_customer_normalizer', to: 'file:custom/customer_normalizer.ts', type: 'writes_to' }
    ])
  );
}, 180000);
test('explain graph links generated ticket runtime routes back to related blocks', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-explain-runtime-attribution-');
  const lock: LockFile = {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: 'nextjs',
      mode: 'single-tenant'
    },
    resolvedBlocks: [
      buildOfficialResolvedBlock({ id: 'ticket/basic', installOrder: 1 }),
      buildOfficialResolvedBlock({ id: 'export/csv-basic', installOrder: 2 }),
      buildOfficialResolvedBlock({ id: 'reporting/ticket-summary', installOrder: 3 })
    ],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: ['app/api/tickets/summary/export/route.ts'],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'succeeded',
      emit: 'pending'
    }
  };
  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: [
      {
        path: 'app/api/tickets/summary/export/route.ts',
        originType: 'generated',
        originId: 'app/api/tickets/summary/export/route.ts',
        generatedByPass: 'compose',
        verifiedBy: [],
        overrideStatus: 'none'
      }
    ]
  };

  const graph = await buildExplainGraph(workspaceRoot, lock, provenance, emptyCoverage(), null);

  // FIXME: arrayContaining hides unexpected extras; need exact edge count assertion
  expect(graph.edges).toEqual(
    expect.arrayContaining([
      {
        from: 'block:ticket/basic',
        to: 'file:app/api/tickets/summary/export/route.ts',
        type: 'writes_to'
      },
      {
        from: 'block:reporting/ticket-summary',
        to: 'file:app/api/tickets/summary/export/route.ts',
        type: 'writes_to'
      },
      {
        from: 'block:export/csv-basic',
        to: 'file:app/api/tickets/summary/export/route.ts',
        type: 'writes_to'
      }
    ])
  );
}, 180000);
test('writeExplainGraph does not require a policy report', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-explain-no-policy-');
  const {
    acceptanceCoveragePath,
    explainGraphDotPath,
    explainGraphMermaidPath,
    explainGraphPath,
    lockPath,
    policyReportPath,
    provenancePath
  } = getWorkspacePaths(workspaceRoot);
  await initWorkspace(workspaceRoot, { reset: true });
  const { lock } = await resolveWorkspace(workspaceRoot);
  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: []
  };
  await writeJson(acceptanceCoveragePath, emptyCoverage());
  await fs.rm(policyReportPath, { force: true });

  const graph = await writeExplainGraph(workspaceRoot, lock, provenance);
  const writtenGraph = await readJson<typeof graph>(explainGraphPath);
  const writtenLock = await readJson<typeof lock>(lockPath);
  const writtenProvenance = await readJson<ProvenanceFile>(provenancePath);
  const mermaid = await fs.readFile(explainGraphMermaidPath, 'utf8');
  const dot = await fs.readFile(explainGraphDotPath, 'utf8');

  expectGraphNode(graph, { type: 'pin' });
  expectNoGraphNode(graph, { type: 'policy' });
  expect(writtenGraph.nodes).toEqual(graph.nodes);
  expect(mermaid).toContain('flowchart TD');
  expect(mermaid).toContain('app_customer_admin["customer-admin (app)"]');
  expect(mermaid).toContain('block_entity_customer_basic["entity/customer-basic (block)"]');
  expect(mermaid).toContain('app_customer_admin -- depends_on --> block_entity_customer_basic');
  expect(dot).toContain('digraph ExplainGraph {');
  expect(dot).toContain('"app:customer-admin" [label="customer-admin (app)"];');
  expect(dot).toContain('"app:customer-admin" -> "block:entity/customer-basic" [label="depends_on"];');
  const explainArtifacts = [
    ...CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
    CI_ARTIFACT_FILES.provenance
  ];
  expect(writtenLock.generatedPaths).toEqual(expect.arrayContaining(explainArtifacts));
  expect(writtenProvenance.artifacts.map((artifact) => artifact.path)).toEqual(expect.arrayContaining(explainArtifacts));
}, 180000);
