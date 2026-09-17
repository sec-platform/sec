import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import { buildExplainGraph } from '../../src/adapters/compilation/emit/write-explain-graph.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../src/adapters/workspace/engineering-input.ts';
import { buildValidatedEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import type { PolicyReport } from '../../src/semantics/policies/types.ts';
import { buildSemanticViewSet } from '../../src/compiler/projection/build-semantic-view-set.ts';
import type { AcceptanceCoverageReport } from '../../src/assurance/acceptance/coverage.ts';
import type { ProvenanceFile } from '../../src/semantics/provenance/types.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { readJson, writeJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { expectGraphEdge, expectGraphNode } from '../helpers/graph-assertions.ts';
import { emptyPolicyScopeReport } from '../helpers/policy-fixtures.ts';
import { buildUpgradeDiagnostics, buildUpgradePlanArtifact } from '../helpers/upgrade-fixtures.ts';
import { prepareResolvedWorkspace } from '../testkit/workspace.ts';

function emptyCoverage(): AcceptanceCoverageReport {
  return {
    formatVersion: '1',
    status: 'passed',
    acceptancePassed: [],
    blocks: [],
    uncoveredBlocks: []
  };
}

async function attachSemanticViews(workspaceRoot: string, lock: LockFile): Promise<LockFile> {
  const { engineeringIRInput } = await loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
  lock.semanticViews = structuredClone(buildSemanticViewSet(buildValidatedEngineeringIR(engineeringIRInput)));
  await writeJson(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock), lock);
  return lock;
}

test('explain graph consumes canonical ports, policies, and policy violation governance edges', async () => {
  const workspaceRoot = await prepareResolvedWorkspace({ prefix: 'engineering-compiler-explain-graph-' });
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const lock = await attachSemanticViews(workspaceRoot, await readJson<LockFile>(lockPath));
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

  expectGraphNode(graph, { id: 'port:entity/customer-basic:input:tenant_context', type: 'port' });
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

test('explain graph connects upgrade file operations to their block and durable files', async () => {
  const workspaceRoot = await prepareResolvedWorkspace({ prefix: 'engineering-compiler-explain-upgrade-file-' });
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const lock = await attachSemanticViews(workspaceRoot, await readJson<LockFile>(lockPath));
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

  const graph = await buildExplainGraph(
    workspaceRoot,
    lock,
    { formatVersion: '1', artifacts: [] },
    emptyCoverage(),
    null,
    upgradePlan,
    diagnostics
  );
  const upgradeId = 'upgrade:entity/customer-basic:0.2.0';
  const upgradeEdges = graph.edges.filter(
    (edge) => edge.from === upgradeId || edge.from.startsWith(`${upgradeId}:`)
  );
  const upgradeEndpointIds = new Set(
    upgradeEdges.flatMap((edge) => [edge.from, edge.to])
  );
  const upgradeNodes = graph.nodes.filter((node) =>
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
}, 180000);
