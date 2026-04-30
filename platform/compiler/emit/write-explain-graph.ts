import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { ExplainGraph, ExplainGraphEdge, ExplainGraphNode } from '../../shared/explain-types.ts';
import { pathExists, readJson, readOptionalJson, writeJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeGeneratedArtifactWithLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';
import type { RepairPlan } from '../../shared/repair-types.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../../shared/upgrade-types.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import { buildRuntimeAttribution } from './runtime-attribution.ts';
import { buildProvenance, writeProvenance } from './write-provenance.ts';

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
  return readOptionalJson<PolicyReport>(policyReportPath);
}

async function readUpgradePlan(workspaceRoot: string): Promise<UpgradePlan | null> {
  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  return readOptionalJson<UpgradePlan>(upgradePlanPath);
}

async function readUpgradeDiagnostics(workspaceRoot: string): Promise<UpgradeDiagnostics | null> {
  const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  return readOptionalJson<UpgradeDiagnostics>(upgradeDiagnosticsPath);
}

async function readRepairPlan(workspaceRoot: string): Promise<RepairPlan | null> {
  const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
  return readOptionalJson<RepairPlan>(repairPlanPath);
}

function readUpgradeDiagnosticsString(diagnostics: UpgradeDiagnostics, key: string): string | null {
  const details = diagnostics.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return null;
  }
  const value = (details as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
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
    const sourceFilePath = task.sourcePath ?? task.target;
    const sourceFileNodeId = `file:${sourceFilePath}`;
    pushNode(nodes, {
      id: slotNodeId,
      type: 'slot',
      label: task.id
    });
    pushNode(nodes, {
      id: sourceFileNodeId,
      type: 'file',
      label: sourceFilePath
    });
    pushEdge(edges, {
      from: `block:${task.block}`,
      to: slotNodeId,
      type: 'connects_to'
    });
    pushEdge(edges, {
      from: slotNodeId,
      to: sourceFileNodeId,
      type: 'writes_to'
    });
    if (task.sourcePath) {
      const runtimeFileNodeId = `file:${task.target}`;
      pushNode(nodes, {
        id: runtimeFileNodeId,
        type: 'file',
        label: task.target
      });
      pushEdge(edges, {
        from: sourceFileNodeId,
        to: runtimeFileNodeId,
        type: 'connects_to'
      });
    }
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
    const blockIds = new Set(lock.resolvedBlocks.map((block) => block.id));
    for (const policy of policyReport.merged.policies) {
      const policyNodeId = `policy:${policy.id}`;
      pushNode(nodes, {
        id: policyNodeId,
        type: 'policy',
        label: policy.id
      });
      for (const target of policy.targets) {
        const targetIsBlock = blockIds.has(target);
        const targetNodeId = targetIsBlock ? `block:${target}` : `file:${target}`;
        pushNode(nodes, {
          id: targetNodeId,
          type: targetIsBlock ? 'block' : 'file',
          label: target
        });
        pushEdge(edges, {
          from: policyNodeId,
          to: targetNodeId,
          type: 'connects_to'
        });
      }
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

    for (const check of upgradePlan.preflightChecks) {
      const checkNodeId = `upgrade:${upgradePlan.blockId}:${upgradePlan.toVersion}:preflight:${check.id}`;
      pushNode(nodes, {
        id: checkNodeId,
        type: 'upgrade',
        label: check.id
      });
      pushEdge(edges, {
        from: upgradeNodeId,
        to: checkNodeId,
        type: 'depends_on'
      });
    }

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
      const verificationNodeId = migration.requiresVerification
        ? 'upgrade-verification:required'
        : 'upgrade-verification:skipped';
      pushNode(nodes, {
        id: migrationNodeId,
        type: 'upgrade',
        label: migration.id
      });
      pushNode(nodes, {
        id: verificationNodeId,
        type: 'upgrade',
        label: migration.requiresVerification ? 'verification required' : 'verification skipped'
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
        to: verificationNodeId,
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
    const failedCheckNodeId = `${planNodeId}:preflight:${upgradeDiagnostics.failedCheck}`;
    pushNode(nodes, {
      id: failedCheckNodeId,
      type: 'upgrade',
      label: upgradeDiagnostics.failedCheck
    });
    pushEdge(edges, {
      from: diagnosticsNodeId,
      to: failedCheckNodeId,
      type: 'connects_to'
    });

    const migrationId = readUpgradeDiagnosticsString(upgradeDiagnostics, 'migrationId');
    if (upgradePlan && migrationId) {
      pushEdge(edges, {
        from: diagnosticsNodeId,
        to: `${planNodeId}:migration:${migrationId}`,
        type: 'connects_to'
      });
    }

    const entry = readUpgradeDiagnosticsString(upgradeDiagnostics, 'entry');
    if (entry) {
      const entryNodeId = `file:${entry}`;
      pushNode(nodes, {
        id: entryNodeId,
        type: 'file',
        label: entry
      });
      pushEdge(edges, {
        from: diagnosticsNodeId,
        to: entryNodeId,
        type: 'connects_to'
      });
    }

    const rollbackStatus = readUpgradeDiagnosticsString(upgradeDiagnostics, 'rollbackStatus');
    if (rollbackStatus) {
      const rollbackNodeId = `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}:rollback:${rollbackStatus}`;
      pushNode(nodes, {
        id: rollbackNodeId,
        type: 'upgrade',
        label: `rollback ${rollbackStatus}`
      });
      pushEdge(edges, {
        from: diagnosticsNodeId,
        to: rollbackNodeId,
        type: 'connects_to'
      });
    }
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
  const graph = await writeGeneratedArtifactWithLock(
    lockPath,
    lock,
    [CI_ARTIFACT_FILES.explainGraph],
    async () => {
      if (!(await pathExists(acceptanceCoveragePath))) {
        throw new CompilerError('EXPLAIN-BLOCKED-002', 'acceptance-coverage.json is missing');
      }

      const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
      const nextProvenance = provenance.artifacts.some((artifact) => artifact.path === CI_ARTIFACT_FILES.explainGraph)
        ? provenance
        : await buildProvenance(workspaceRoot, lock);
      const nextGraph = await buildExplainGraph(
        workspaceRoot,
        lock,
        nextProvenance,
        coverage,
        await readPolicyReport(workspaceRoot),
        await readUpgradePlan(workspaceRoot),
        await readRepairPlan(workspaceRoot),
        await readUpgradeDiagnostics(workspaceRoot)
      );

      await writeJson(explainGraphPath, nextGraph);
      return nextGraph;
    }
  );
  await writeProvenance(workspaceRoot, lock);
  return graph;
}
