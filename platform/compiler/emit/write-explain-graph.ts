import fs from 'node:fs/promises';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { CompilerError } from '../../shared/errors.ts';
import { buildProvenance, writeProvenance } from './write-provenance.ts';
import { buildRuntimeAttribution } from './runtime-attribution.ts';
import type {
  AcceptanceCoverageReport,
  ExplainGraph,
  ExplainGraphEdge,
  ExplainGraphNode,
  LockFile,
  PolicyReport,
  ProvenanceFile,
  RepairPlan,
  UpgradeDiagnostics,
  UpgradePlan
} from '../../shared/types.ts';

function pushNode(nodes: ExplainGraphNode[], node: ExplainGraphNode): void {
  if (!nodes.some((candidate) => candidate.id === node.id)) {
    nodes.push(node);
  }
}

function pushEdge(edges: ExplainGraphEdge[], edge: ExplainGraphEdge): void {
  if (!edges.some((candidate) => candidate.from === edge.from && candidate.to === edge.to && candidate.type === edge.type)) {
    edges.push(edge);
  }
}

async function readPolicyReport(workspaceRoot: string): Promise<PolicyReport | null> {
  const { policyReportPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(policyReportPath))) {
    return null;
  }
  return readJson<PolicyReport>(policyReportPath);
}

async function readUpgradePlan(workspaceRoot: string): Promise<UpgradePlan | null> {
  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(upgradePlanPath))) {
    return null;
  }
  return readJson<UpgradePlan>(upgradePlanPath);
}

async function readUpgradeDiagnostics(workspaceRoot: string): Promise<UpgradeDiagnostics | null> {
  const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(upgradeDiagnosticsPath))) {
    return null;
  }
  return readJson<UpgradeDiagnostics>(upgradeDiagnosticsPath);
}

async function readRepairPlan(workspaceRoot: string): Promise<RepairPlan | null> {
  const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(repairPlanPath))) {
    return null;
  }
  return readJson<RepairPlan>(repairPlanPath);
}

export async function buildExplainGraph(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  coverage: AcceptanceCoverageReport,
  policyReport: PolicyReport | null,
  upgradePlan: UpgradePlan | null = null,
  repairPlan: RepairPlan | null = null,
  upgradeDiagnostics: UpgradeDiagnostics | null = null
): Promise<ExplainGraph> {
  const nodes: ExplainGraphNode[] = [];
  const edges: ExplainGraphEdge[] = [];

  pushNode(nodes, {
    id: `app:${lock.app.name}`,
    type: 'app',
    label: lock.app.name
  });

  for (const block of lock.resolvedBlocks) {
    const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
    const blockNodeId = `block:${block.id}`;
    pushNode(nodes, {
      id: blockNodeId,
      type: 'block',
      label: block.id
    });
    pushEdge(edges, {
      from: `app:${lock.app.name}`,
      to: blockNodeId,
      type: 'depends_on'
    });

    for (const requirement of manifestEntry.manifest.requires) {
      const capabilityNodeId = `capability:${requirement}`;
      pushNode(nodes, {
        id: capabilityNodeId,
        type: 'capability',
        label: requirement
      });
      pushEdge(edges, {
        from: blockNodeId,
        to: capabilityNodeId,
        type: 'depends_on'
      });
    }

    for (const capability of manifestEntry.manifest.provides) {
      const capabilityNodeId = `capability:${capability}`;
      pushNode(nodes, {
        id: capabilityNodeId,
        type: 'capability',
        label: capability
      });
      pushEdge(edges, {
        from: blockNodeId,
        to: capabilityNodeId,
        type: 'provides'
      });
    }

    for (const pin of manifestEntry.manifest.pins.inputs) {
      const pinNodeId = `pin:${block.id}:input:${pin.id}`;
      pushNode(nodes, {
        id: pinNodeId,
        type: 'pin',
        label: pin.id
      });
      pushEdge(edges, {
        from: blockNodeId,
        to: pinNodeId,
        type: 'depends_on'
      });
    }

    for (const pin of manifestEntry.manifest.pins.outputs) {
      const pinNodeId = `pin:${block.id}:output:${pin.id}`;
      pushNode(nodes, {
        id: pinNodeId,
        type: 'pin',
        label: pin.id
      });
      pushEdge(edges, {
        from: blockNodeId,
        to: pinNodeId,
        type: 'provides'
      });
    }
  }

  for (const task of lock.slotTasks) {
    const slotNodeId = `slot:${task.id}`;
    const fileNodeId = `file:${task.target}`;
    pushNode(nodes, {
      id: slotNodeId,
      type: 'slot',
      label: task.id
    });
    pushNode(nodes, {
      id: fileNodeId,
      type: 'file',
      label: task.target
    });
    pushEdge(edges, {
      from: `block:${task.block}`,
      to: slotNodeId,
      type: 'connects_to'
    });
    pushEdge(edges, {
      from: slotNodeId,
      to: fileNodeId,
      type: 'writes_to'
    });
  }

  for (const artifact of provenance.artifacts) {
    const fileNodeId = `file:${artifact.path}`;
    pushNode(nodes, {
      id: fileNodeId,
      type: 'file',
      label: artifact.path
    });

    const originNodeId =
      artifact.originType === 'slot'
        ? `slot:${artifact.originId}`
        : artifact.originType === 'block'
          ? `block:${artifact.originId}`
          : artifact.originType === 'override'
            ? `override:${artifact.originId}`
            : `app:${lock.app.name}`;

    if (artifact.originType === 'override') {
      pushNode(nodes, {
        id: originNodeId,
        type: 'override',
        label: artifact.originId
      });
    }

    pushEdge(edges, {
      from: fileNodeId,
      to: originNodeId,
      type: 'originates_from'
    });

    const runtimeAttribution = buildRuntimeAttribution(lock, artifact.path);
    if (!runtimeAttribution) {
      continue;
    }

    for (const blockId of runtimeAttribution.relatedBlocks) {
      pushEdge(edges, {
        from: `block:${blockId}`,
        to: fileNodeId,
        type: 'writes_to'
      });
    }
  }

  if (policyReport) {
    for (const policy of policyReport.merged.policies) {
      pushNode(nodes, {
        id: `policy:${policy.id}`,
        type: 'policy',
        label: policy.id
      });
    }

    for (const violation of policyReport.violations) {
      const policyNodeId = `policy:${violation.id}`;
      pushNode(nodes, {
        id: policyNodeId,
        type: 'policy',
        label: violation.id
      });
      for (const file of violation.files) {
        const fileNodeId = `file:${file}`;
        pushNode(nodes, {
          id: fileNodeId,
          type: 'file',
          label: file
        });
        pushEdge(edges, {
          from: fileNodeId,
          to: policyNodeId,
          type: 'violates'
        });
      }
    }
  }

  if (upgradePlan) {
    const upgradeNodeId = `upgrade:${upgradePlan.blockId}:${upgradePlan.toVersion}`;
    pushNode(nodes, {
      id: `block:${upgradePlan.blockId}`,
      type: 'block',
      label: upgradePlan.blockId
    });
    pushNode(nodes, {
      id: upgradeNodeId,
      type: 'upgrade',
      label: `${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`
    });
    pushEdge(edges, {
      from: upgradeNodeId,
      to: `block:${upgradePlan.blockId}`,
      type: 'connects_to'
    });

    for (const impact of upgradePlan.impacts) {
      const fileNodeId = `file:${impact}`;
      pushNode(nodes, {
        id: fileNodeId,
        type: 'file',
        label: impact
      });
      pushEdge(edges, {
        from: upgradeNodeId,
        to: fileNodeId,
        type: 'writes_to'
      });
    }

    for (const migration of upgradePlan.migrationSummaries) {
      const migrationNodeId = `upgrade:${upgradePlan.blockId}:${upgradePlan.toVersion}:migration:${migration.id}`;
      const fileNodeId = `file:${migration.target}`;
      pushNode(nodes, {
        id: migrationNodeId,
        type: 'upgrade',
        label: migration.id
      });
      pushNode(nodes, {
        id: fileNodeId,
        type: 'file',
        label: migration.target
      });
      pushEdge(edges, {
        from: upgradeNodeId,
        to: migrationNodeId,
        type: 'depends_on'
      });
      pushEdge(edges, {
        from: migrationNodeId,
        to: fileNodeId,
        type: 'writes_to'
      });

      if (migration.kind !== 'slot-contract-update' || !migration.slotId) {
        continue;
      }
      const slotNodeId = `slot:${migration.slotId}`;
      pushNode(nodes, {
        id: slotNodeId,
        type: 'slot',
        label: migration.slotId
      });
      pushEdge(edges, {
        from: `block:${upgradePlan.blockId}`,
        to: slotNodeId,
        type: 'connects_to'
      });
      pushEdge(edges, {
        from: slotNodeId,
        to: fileNodeId,
        type: 'writes_to'
      });
    }
  }

  if (upgradeDiagnostics) {
    const diagnosticsNodeId = `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}:diagnostics`;
    const planNodeId = `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}`;
    pushNode(nodes, {
      id: `block:${upgradeDiagnostics.blockId}`,
      type: 'block',
      label: upgradeDiagnostics.blockId
    });
    pushNode(nodes, {
      id: diagnosticsNodeId,
      type: 'upgrade',
      label: upgradeDiagnostics.errorCode
    });
    pushEdge(edges, {
      from: diagnosticsNodeId,
      to: upgradePlan ? planNodeId : `block:${upgradeDiagnostics.blockId}`,
      type: 'connects_to'
    });
  }

  if (repairPlan) {
    for (const task of repairPlan.tasks) {
      const repairNodeId = `repair:${task.taskId}`;
      const category = task.category ?? 'slot-rewrite';
      const categoryNodeId = `repair-category:${category}`;
      const slotNodeId = `slot:${task.sourceSlotId}`;
      const fileNodeId = `file:${task.targetFile}`;
      pushNode(nodes, {
        id: repairNodeId,
        type: 'repair',
        label: task.taskId
      });
      pushNode(nodes, {
        id: categoryNodeId,
        type: 'repair',
        label: category
      });
      pushNode(nodes, {
        id: slotNodeId,
        type: 'slot',
        label: task.sourceSlotId
      });
      pushNode(nodes, {
        id: fileNodeId,
        type: 'file',
        label: task.targetFile
      });
      pushEdge(edges, {
        from: repairNodeId,
        to: categoryNodeId,
        type: 'depends_on'
      });
      pushEdge(edges, {
        from: repairNodeId,
        to: slotNodeId,
        type: 'connects_to'
      });
      pushEdge(edges, {
        from: repairNodeId,
        to: fileNodeId,
        type: 'writes_to'
      });
    }
  }

  for (const acceptanceId of lock.acceptancePlan) {
    const acceptanceNodeId = `acceptance:${acceptanceId}`;
    pushNode(nodes, {
      id: acceptanceNodeId,
      type: 'acceptance',
      label: acceptanceId
    });
  }

  for (const blockCoverage of coverage.blocks) {
    for (const acceptanceId of blockCoverage.coveredBy) {
      pushEdge(edges, {
        from: `block:${blockCoverage.id}`,
        to: `acceptance:${acceptanceId}`,
        type: 'verified_by'
      });
    }
  }

  for (const slotCoverage of coverage.slots) {
    for (const acceptanceId of slotCoverage.coveredBy) {
      pushEdge(edges, {
        from: `slot:${slotCoverage.id}`,
        to: `acceptance:${acceptanceId}`,
        type: 'verified_by'
      });
    }
  }

  return {
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) =>
      `${left.from}:${left.type}:${left.to}`.localeCompare(`${right.from}:${right.type}:${right.to}`)
    ),
    overlays: {
      provenance: provenance.artifacts,
      coverage: {
        blocks: coverage.blocks.map((entry) => ({
          id: entry.id,
          coveredBy: [...entry.coveredBy]
        })),
        slots: coverage.slots.map((entry) => ({
          id: entry.id,
          coveredBy: [...entry.coveredBy]
        }))
      }
    }
  };
}

export async function writeExplainGraph(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile
): Promise<ExplainGraph> {
  const { acceptanceCoveragePath, explainGraphPath, lockPath } = getWorkspacePaths(workspaceRoot);
  if (!lock.generatedPaths.includes('generated/explain-graph.json')) {
    lock.generatedPaths.push('generated/explain-graph.json');
    lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  }
  if (!(await pathExists(acceptanceCoveragePath))) {
    throw new CompilerError('EXPLAIN-BLOCKED-002', 'acceptance-coverage.json is missing');
  }

  const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  const nextProvenance = provenance.artifacts.some((artifact) => artifact.path === 'generated/explain-graph.json')
    ? provenance
    : await buildProvenance(workspaceRoot, lock);
  const graph = await buildExplainGraph(
    workspaceRoot,
    lock,
    nextProvenance,
    coverage,
    await readPolicyReport(workspaceRoot),
    await readUpgradePlan(workspaceRoot),
    await readRepairPlan(workspaceRoot),
    await readUpgradeDiagnostics(workspaceRoot)
  );

  await fs.writeFile(explainGraphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await writeProvenance(workspaceRoot, lock);
  return graph;
}
