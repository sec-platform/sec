import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import {
  CI_ARTIFACT_FILES,
  CI_EXPLAIN_GRAPH_ARTIFACT_PATHS
} from '../../shared/ci-artifact-contract.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { ExplainEdgeType, ExplainGraph, ExplainGraphEdge, ExplainGraphNode, ExplainNodeType } from '../../shared/explain-types.ts';
import { pathExists, readJson, writeJson, writeText } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeGeneratedArtifactWithLock } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';
import type { RepairPlan } from '../../shared/repair-types.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../../shared/upgrade-types.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import { buildRuntimeAttribution } from './runtime-attribution.ts';
import { buildProvenance, writeProvenance } from './write-provenance.ts';

class GraphBuilder {
  private readonly nodeSet = new Set<string>();
  private readonly edgeSet = new Set<string>();
  private readonly nodes: ExplainGraphNode[] = [];
  private readonly edges: ExplainGraphEdge[] = [];

  node(id: string, type: ExplainNodeType, label: string): this {
    if (!this.nodeSet.has(id)) {
      this.nodeSet.add(id);
      this.nodes.push({ id, type, label });
    }
    return this;
  }

  edge(from: string, to: string, type: ExplainEdgeType): this {
    const key = `${from}:${type}:${to}`;
    if (!this.edgeSet.has(key)) {
      this.edgeSet.add(key);
      this.edges.push({ from, to, type });
    }
    return this;
  }

  link(from: string, to: string, type: ExplainEdgeType, nodeType: ExplainNodeType, label: string): this {
    this.node(to, nodeType, label);
    this.edge(from, to, type);
    return this;
  }

  build(overlays: ExplainGraph['overlays']): ExplainGraph {
    return {
      nodes: this.nodes.sort((a, b) => a.id.localeCompare(b.id)),
      edges: this.edges.sort((a, b) => `${a.from}:${a.type}:${a.to}`.localeCompare(`${b.from}:${b.type}:${b.to}`)),
      overlays
    };
  }
}

function readUpgradeDiagnosticsString(diagnostics: UpgradeDiagnostics, key: string): string | null {
  const details = diagnostics.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return null;
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
  const g = new GraphBuilder();

  g.node(`app:${lock.app.name}`, 'app', lock.app.name);

  for (const block of lock.resolvedBlocks) {
    const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
    const blockId = `block:${block.id}`;
    g.node(blockId, 'block', block.id);
    g.edge(`app:${lock.app.name}`, blockId, 'depends_on');

    for (const req of manifestEntry.manifest.requires) {
      g.link(blockId, `capability:${req}`, 'depends_on', 'capability', req);
    }
    for (const cap of manifestEntry.manifest.provides) {
      g.link(blockId, `capability:${cap}`, 'provides', 'capability', cap);
    }
    for (const pin of manifestEntry.manifest.pins.inputs) {
      g.link(blockId, `pin:${block.id}:input:${pin.id}`, 'depends_on', 'pin', pin.id);
    }
    for (const pin of manifestEntry.manifest.pins.outputs) {
      g.link(blockId, `pin:${block.id}:output:${pin.id}`, 'provides', 'pin', pin.id);
    }
  }

  for (const task of lock.slotTasks) {
    const slotId = `slot:${task.id}`;
    const sourcePath = task.sourcePath ?? task.target;
    const sourceFileId = `file:${sourcePath}`;
    g.node(slotId, 'slot', task.id);
    g.node(sourceFileId, 'file', sourcePath);
    g.edge(`block:${task.block}`, slotId, 'connects_to');
    g.edge(slotId, sourceFileId, 'writes_to');
    if (task.sourcePath) {
      g.link(sourceFileId, `file:${task.target}`, 'connects_to', 'file', task.target);
    }
  }

  for (const artifact of provenance.artifacts) {
    const fileId = `file:${artifact.path}`;
    g.node(fileId, 'file', artifact.path);

    const originId =
      artifact.originType === 'slot' ? `slot:${artifact.originId}` :
      artifact.originType === 'block' ? `block:${artifact.originId}` :
      artifact.originType === 'override' ? `override:${artifact.originId}` :
      `app:${lock.app.name}`;

    if (artifact.originType === 'override') {
      g.node(originId, 'override', artifact.originId);
    }
    g.edge(fileId, originId, 'originates_from');

    const attribution = buildRuntimeAttribution(lock, artifact.path);
    if (attribution) {
      for (const blockId of attribution.relatedBlocks) {
        g.edge(`block:${blockId}`, fileId, 'writes_to');
      }
    }
  }

  if (policyReport) {
    const blockIds = new Set(lock.resolvedBlocks.map((b) => b.id));
    for (const policy of policyReport.merged.policies) {
      const policyId = `policy:${policy.id}`;
      g.node(policyId, 'policy', policy.id);
      for (const target of policy.targets) {
        const isBlock = blockIds.has(target);
        g.link(policyId, isBlock ? `block:${target}` : `file:${target}`, 'connects_to', isBlock ? 'block' : 'file', target);
      }
    }
    for (const violation of policyReport.violations) {
      const policyId = `policy:${violation.id}`;
      g.node(policyId, 'policy', violation.id);
      for (const file of violation.files) {
        g.node(`file:${file}`, 'file', file);
        g.edge(`file:${file}`, policyId, 'violates');
      }
    }
  }

  if (upgradePlan) {
    const upgradeId = `upgrade:${upgradePlan.blockId}:${upgradePlan.toVersion}`;
    g.node(`block:${upgradePlan.blockId}`, 'block', upgradePlan.blockId);
    g.node(upgradeId, 'upgrade', `${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}`);
    g.edge(upgradeId, `block:${upgradePlan.blockId}`, 'connects_to');

    for (const check of upgradePlan.preflightChecks) {
      g.link(upgradeId, `${upgradeId}:preflight:${check.id}`, 'depends_on', 'upgrade', check.id);
    }
    for (const impact of upgradePlan.impacts) {
      g.link(upgradeId, `file:${impact}`, 'writes_to', 'file', impact);
    }
    for (const migration of upgradePlan.migrationSummaries) {
      const migId = `${upgradeId}:migration:${migration.id}`;
      const verifId = migration.requiresVerification ? 'upgrade-verification:required' : 'upgrade-verification:skipped';
      g.node(migId, 'upgrade', migration.id);
      g.node(verifId, 'upgrade', migration.requiresVerification ? 'verification required' : 'verification skipped');
      g.link(migId, `file:${migration.target}`, 'writes_to', 'file', migration.target);
      g.edge(upgradeId, migId, 'depends_on');
      g.edge(migId, verifId, 'depends_on');

      if (migration.kind === 'slot-contract-update' && migration.slotId) {
        const slotId = `slot:${migration.slotId}`;
        g.node(slotId, 'slot', migration.slotId);
        g.edge(`block:${upgradePlan.blockId}`, slotId, 'connects_to');
        g.edge(slotId, `file:${migration.target}`, 'writes_to');
      }
    }
  }

  if (upgradeDiagnostics) {
    const diagId = `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}:diagnostics`;
    const planId = `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}`;
    g.node(`block:${upgradeDiagnostics.blockId}`, 'block', upgradeDiagnostics.blockId);
    g.node(diagId, 'upgrade', upgradeDiagnostics.errorCode);
    g.edge(diagId, upgradePlan ? planId : `block:${upgradeDiagnostics.blockId}`, 'connects_to');
    g.link(diagId, `${planId}:preflight:${upgradeDiagnostics.failedCheck}`, 'connects_to', 'upgrade', upgradeDiagnostics.failedCheck);

    const migrationId = readUpgradeDiagnosticsString(upgradeDiagnostics, 'migrationId');
    if (upgradePlan && migrationId) {
      g.edge(diagId, `${planId}:migration:${migrationId}`, 'connects_to');
    }

    const entry = readUpgradeDiagnosticsString(upgradeDiagnostics, 'entry');
    if (entry) {
      g.link(diagId, `file:${entry}`, 'connects_to', 'file', entry);
    }

    const rollbackStatus = readUpgradeDiagnosticsString(upgradeDiagnostics, 'rollbackStatus');
    if (rollbackStatus) {
      g.link(diagId, `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}:rollback:${rollbackStatus}`, 'connects_to', 'upgrade', `rollback ${rollbackStatus}`);
    }
  }

  if (repairPlan) {
    for (const task of repairPlan.tasks) {
      const repairId = `repair:${task.taskId}`;
      const category = task.category ?? 'slot-rewrite';
      g.node(repairId, 'repair', task.taskId);
      g.link(repairId, `repair-category:${category}`, 'depends_on', 'repair', category);
      g.link(repairId, `slot:${task.sourceSlotId}`, 'connects_to', 'slot', task.sourceSlotId);
      g.link(repairId, `file:${task.targetFile}`, 'writes_to', 'file', task.targetFile);
    }
  }

  for (const acceptanceId of lock.acceptancePlan) {
    g.node(`acceptance:${acceptanceId}`, 'acceptance', acceptanceId);
  }
  for (const blockCov of coverage.blocks) {
    for (const accId of blockCov.coveredBy) {
      g.edge(`block:${blockCov.id}`, `acceptance:${accId}`, 'verified_by');
    }
  }
  for (const slotCov of coverage.slots) {
    for (const accId of slotCov.coveredBy) {
      g.edge(`slot:${slotCov.id}`, `acceptance:${accId}`, 'verified_by');
    }
  }

  return g.build({
    provenance: provenance.artifacts,
    coverage: {
      blocks: coverage.blocks.map((e) => ({ id: e.id, coveredBy: [...e.coveredBy] })),
      slots: coverage.slots.map((e) => ({ id: e.id, coveredBy: [...e.coveredBy] }))
    }
  });
}

function escapeProjectionLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function buildMermaidNodeIds(graph: ExplainGraph): Map<string, string> {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const node of graph.nodes) {
    const base = node.id.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'node';
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    ids.set(node.id, candidate);
    used.add(candidate);
  }
  return ids;
}

function renderExplainGraphMermaid(graph: ExplainGraph): string {
  const nodeIds = buildMermaidNodeIds(graph);
  const lines = ['flowchart TD'];
  for (const node of graph.nodes) {
    const label = escapeProjectionLabel(`${node.label} (${node.type})`);
    lines.push(`  ${nodeIds.get(node.id)}["${label}"]`);
  }
  for (const edge of graph.edges) {
    lines.push(`  ${nodeIds.get(edge.from)} -- ${edge.type} --> ${nodeIds.get(edge.to)}`);
  }
  return `${lines.join('\n')}\n`;
}

function renderExplainGraphDot(graph: ExplainGraph): string {
  const lines = ['digraph ExplainGraph {'];
  for (const node of graph.nodes) {
    const id = escapeProjectionLabel(node.id);
    const label = escapeProjectionLabel(`${node.label} (${node.type})`);
    lines.push(`  "${id}" [label="${label}"];`);
  }
  for (const edge of graph.edges) {
    const from = escapeProjectionLabel(edge.from);
    const to = escapeProjectionLabel(edge.to);
    lines.push(`  "${from}" -> "${to}" [label="${edge.type}"];`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

export async function writeExplainGraph(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile
): Promise<ExplainGraph> {
  const {
    acceptanceCoveragePath,
    explainGraphDotPath,
    explainGraphMermaidPath,
    explainGraphPath,
    lockPath
  } = getWorkspacePaths(workspaceRoot);
  const graph = await writeGeneratedArtifactWithLock(
    lockPath,
    lock,
    CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
    async () => {
      if (!(await pathExists(acceptanceCoveragePath))) {
        throw new CompilerError('EXPLAIN-BLOCKED-002', 'acceptance-coverage.json is missing');
      }
      const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
      const { policyReport, repairPlan, upgradePlan, upgradeDiagnostics } = await readReviewGovernanceReports(workspaceRoot);
      const nextProvenance = provenance.artifacts.some((a) => a.path === CI_ARTIFACT_FILES.explainGraph)
        ? provenance
        : await buildProvenance(workspaceRoot, lock);
      const nextGraph = await buildExplainGraph(
        workspaceRoot, lock, nextProvenance, coverage, policyReport, upgradePlan, repairPlan, upgradeDiagnostics
      );
      await writeJson(explainGraphPath, nextGraph);
      await writeText(explainGraphMermaidPath, renderExplainGraphMermaid(nextGraph));
      await writeText(explainGraphDotPath, renderExplainGraphDot(nextGraph));
      return nextGraph;
    }
  );
  await writeProvenance(workspaceRoot, lock);
  return graph;
}
