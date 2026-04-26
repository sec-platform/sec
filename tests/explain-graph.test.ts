import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildExplainGraph, writeExplainGraph } from '../platform/compiler/emit/write-explain-graph.ts';
import { initWorkspace, resolveWorkspace } from '../platform/orchestrator.ts';
import { readJson, writeJson } from '../platform/shared/fs.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import type { AcceptanceCoverageReport, PolicyReport, ProvenanceFile, RepairPlan, UpgradePlan } from '../platform/shared/types.ts';

const activeWorkspaces = new Set<string>();

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

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
    project: {
      policies: [],
      sources: [],
      violations: []
    },
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

  expect(graph.nodes.some((node) => node.id === 'pin:entity/customer-basic:input:tenant_context')).toBe(true);
  expect(graph.nodes.some((node) => node.id === 'policy:tenant-scope-required')).toBe(true);
  const violationEdges = graph.edges.filter(
    (edge) =>
      edge.from === 'file:src/installed/entity/customer-service.ts' &&
      edge.to === 'policy:tenant-scope-required' &&
      edge.type === 'violates'
  );
  expect(violationEdges).toHaveLength(1);
});

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
        message: '1 upgrade impacts calculated',
        evidence: ['custom/customer_normalizer.ts']
      },
      {
        id: 'override-conflicts',
        status: 'passed',
        message: '0 overrides scanned with no conflicts',
        evidence: []
      }
    ],
    impacts: ['custom/customer_normalizer.ts'],
    migrations: [
      {
        id: 'mig-customer-normalizer-contract',
        kind: 'slot-contract-update',
        entry: 'migrations/customer-normalizer-contract.json',
        requiresVerification: true
      }
    ],
    migrationKindCounts: {
      'slot-contract-update': 1
    },
    migrationSummaries: [
      {
        id: 'mig-customer-normalizer-contract',
        kind: 'slot-contract-update',
        target: 'custom/customer_normalizer.ts',
        reason: 'Update customer normalizer input contract to v2.',
        requiresVerification: true,
        slotId: 'customer_normalizer'
      }
    ]
  };

  const graph = await buildExplainGraph(workspaceRoot, lock, { formatVersion: '1', artifacts: [] }, emptyCoverage(), null, upgradePlan);

  expect(graph.nodes).toEqual(
    expect.arrayContaining([
      { id: 'slot:customer_normalizer', type: 'slot', label: 'customer_normalizer' },
      { id: 'file:custom/customer_normalizer.ts', type: 'file', label: 'custom/customer_normalizer.ts' }
    ])
  );
  expect(graph.edges).toEqual(
    expect.arrayContaining([
      { from: 'block:entity/customer-basic', to: 'slot:customer_normalizer', type: 'connects_to' },
      { from: 'slot:customer_normalizer', to: 'file:custom/customer_normalizer.ts', type: 'writes_to' }
    ])
  );
});

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

  expect(graph.nodes).toEqual(
    expect.arrayContaining([
      { id: 'repair:repair_customer_normalizer', type: 'repair', label: 'repair_customer_normalizer' },
      { id: 'slot:customer_normalizer', type: 'slot', label: 'customer_normalizer' },
      { id: 'file:custom/customer_normalizer.ts', type: 'file', label: 'custom/customer_normalizer.ts' }
    ])
  );
  expect(graph.edges).toEqual(
    expect.arrayContaining([
      { from: 'repair:repair_customer_normalizer', to: 'slot:customer_normalizer', type: 'connects_to' },
      { from: 'repair:repair_customer_normalizer', to: 'file:custom/customer_normalizer.ts', type: 'writes_to' }
    ])
  );
});

test('writeExplainGraph does not require a policy report', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-explain-no-policy-');
  const { acceptanceCoveragePath, explainGraphPath, lockPath, policyReportPath, provenancePath } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  const { lock } = await resolveWorkspace(workspaceRoot);
  const provenance: ProvenanceFile = {
    formatVersion: '1',
    artifacts: []
  };
  await writeJson(acceptanceCoveragePath, emptyCoverage());
  await fs.rm(policyReportPath, { force: true });

  const graph = await writeExplainGraph(workspaceRoot, lock, provenance);
  const writtenGraph = JSON.parse(await fs.readFile(explainGraphPath, 'utf8')) as typeof graph;
  const writtenLock = await readJson<typeof lock>(lockPath);
  const writtenProvenance = await readJson<ProvenanceFile>(provenancePath);

  expect(graph.nodes.some((node) => node.type === 'pin')).toBe(true);
  expect(graph.nodes.some((node) => node.type === 'policy')).toBe(false);
  expect(writtenGraph.nodes).toEqual(graph.nodes);
  expect(writtenLock.generatedPaths).toEqual(
    expect.arrayContaining(['generated/explain-graph.json', 'provenance.json'])
  );
  expect(writtenProvenance.artifacts.map((artifact) => artifact.path)).toEqual(
    expect.arrayContaining(['generated/explain-graph.json', 'provenance.json'])
  );
});
