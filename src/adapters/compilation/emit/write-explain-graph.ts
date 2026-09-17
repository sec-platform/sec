import type { UpgradeDiagnostics, UpgradePlan } from '../../../semantics/upgrade/upgrade-artifact.ts';
import type { AcceptanceCoverageReport } from '../../../assurance/acceptance/coverage.ts';
import type { ExplainEdgeType, ExplainGraph, ExplainGraphEdge, ExplainGraphNode, ExplainNodeType } from '../../../semantics/projection/explain.ts';
import type { SemanticViewSet, ViewReference } from '../../../semantics/projection/types.ts';
import type { ProvenanceFile } from '../../../semantics/provenance/types.ts';
import { compareCodeUnits } from '../../../contracts/canonical.ts';
import { readOptionalAcceptanceCoverageReport } from '../../verification/platform/acceptance/runtime/coverage-authority.ts';
import { CI_ARTIFACT_FILES, CI_EXPLAIN_GRAPH_ARTIFACT_PATHS } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatJsonFile } from "../../../contracts/json-text.ts";
import { publishExistingParentCanonicalWorkspaceFile } from "../../filesystem/file-publication.ts";
import { type CommitFence } from "../../../contracts/commit-fence.ts";
import { resolveWorkspaceArtifactPath } from "../../workspace-context.ts";
import type { LockFile } from '../../../compiler/contract.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { writeGeneratedArtifactWithLock } from "../../workspace/lock.ts";
import type { PolicyReport } from '../../../semantics/policies/types.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import { buildRuntimeAttributions } from './runtime-attribution.ts';
import { requireLockSemanticViews } from './semantic-view-artifact-contract.ts';
import { buildProvenance, writeProvenance } from './write-provenance.ts';

function viewReferenceKey(reference: ViewReference): string {
  return `${reference.kind}:${reference.ref}`;
}

function graphEdgeKey(from: string, type: ExplainEdgeType, to: string): string {
  return JSON.stringify([from, type, to]);
}

function mergeViewReferences(
  target: Map<string, ViewReference>,
  references: readonly ViewReference[]
): void {
  for (const reference of references) target.set(viewReferenceKey(reference), reference);
}

function sortedViewReferences(references: ReadonlyMap<string, ViewReference>): ViewReference[] {
  return [...references.values()].sort((left, right) =>
    compareCodeUnits(viewReferenceKey(left), viewReferenceKey(right)));
}

class GraphBuilder {
  private readonly nodes = new Map<string, ExplainGraphNode>();
  private readonly edges = new Map<string, ExplainGraphEdge>();
  private readonly nodeReferences = new Map<string, Map<string, ViewReference>>();
  private readonly edgeReferences = new Map<string, Map<string, ViewReference>>();

  node(id: string, type: ExplainNodeType, label: string, references: readonly ViewReference[] = []): this {
    const existing = this.nodes.get(id);
    if (existing === undefined) {
      this.nodes.set(id, { id, type, label });
    } else if (existing.type !== type || existing.label !== label) {
      throw new CompilerError(
        'EXPLAIN-GRAPH-001',
        `Explain graph node identity "${id}" has conflicting definitions`,
        {
          existing: { type: existing.type, label: existing.label },
          incoming: { type, label }
        }
      );
    }
    if (references.length > 0) {
      const merged = this.nodeReferences.get(id) ?? new Map<string, ViewReference>();
      mergeViewReferences(merged, references);
      this.nodeReferences.set(id, merged);
    }
    return this;
  }

  edge(from: string, to: string, type: ExplainEdgeType, references: readonly ViewReference[] = []): this {
    const key = graphEdgeKey(from, type, to);
    if (!this.edges.has(key)) {
      this.edges.set(key, { from, to, type });
    }
    if (references.length > 0) {
      const merged = this.edgeReferences.get(key) ?? new Map<string, ViewReference>();
      mergeViewReferences(merged, references);
      this.edgeReferences.set(key, merged);
    }
    return this;
  }

  link(from: string, to: string, type: ExplainEdgeType, nodeType: ExplainNodeType, label: string): this {
    this.node(to, nodeType, label);
    this.edge(from, to, type);
    return this;
  }

  build(semanticViews: SemanticViewSet, overlays: ExplainGraph['overlays']): ExplainGraph {
    for (const edge of this.edges.values()) {
      const missingEndpoints = [
        ...(this.nodes.has(edge.from) ? [] : ['from']),
        ...(this.nodes.has(edge.to) ? [] : ['to'])
      ];
      if (missingEndpoints.length > 0) {
        throw new CompilerError(
          'EXPLAIN-GRAPH-002',
          'Explain graph contains an edge with an unregistered endpoint',
          { edge, missingEndpoints }
        );
      }
    }

    const nodes = [...this.nodes].map(([id, node]) => {
      const references = this.nodeReferences.get(id);
      return references && references.size > 0
        ? { ...node, references: sortedViewReferences(references) }
        : node;
    }).sort((left, right) => compareCodeUnits(left.id, right.id));
    const edges = [...this.edges].map(([key, edge]) => {
      const references = this.edgeReferences.get(key);
      return references && references.size > 0
        ? { ...edge, references: sortedViewReferences(references) }
        : edge;
    }).sort((left, right) =>
      compareCodeUnits(
        graphEdgeKey(left.from, left.type, left.to),
        graphEdgeKey(right.from, right.type, right.to)
      ));

    return {
      semanticViews,
      nodes,
      edges,
      overlays
    };
  }
}

function explainEdgeType(relation: string): ExplainEdgeType {
  return relation.toLowerCase() as ExplainEdgeType;
}

function legacyPinId(entityId: string): string | null {
  const match = /^port:([^:]+):(input|output):(.+)$/u.exec(entityId);
  return match ? `pin:${match[1]}:${match[2]}:${match[3]}` : null;
}

function legacyPinEdgeType(relation: string, targetId: string): ExplainEdgeType {
  if (relation === 'REQUIRES' && legacyPinId(targetId)) return 'depends_on';
  return explainEdgeType(relation);
}

function addSemanticProjection(g: GraphBuilder, semanticViews: SemanticViewSet): void {
  for (const view of semanticViews.views) {
    for (const node of view.nodes) {
      g.node(node.id, node.entityKind, node.label, node.references);
      const pinId = legacyPinId(node.id);
      if (node.entityKind === 'port' && pinId) g.node(pinId, 'pin', node.label, node.references);
    }
    for (const edge of view.edges) {
      if (edge.target) {
        g.edge(edge.source, edge.target, explainEdgeType(edge.relation), edge.references);
        const legacySource = legacyPinId(edge.source);
        const legacyTarget = legacyPinId(edge.target);
        if (legacySource || legacyTarget) {
          g.edge(legacySource ?? edge.source, legacyTarget ?? edge.target, legacyPinEdgeType(edge.relation, edge.target), edge.references);
        }
        continue;
      }
      if (edge.value !== undefined) {
        const valueId = `semantic-value:${edge.id}`;
        g.node(valueId, 'semantic-value', JSON.stringify(edge.value), edge.references);
        g.edge(edge.source, valueId, explainEdgeType(edge.relation), edge.references);
      }
    }
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
  upgradeDiagnostics: UpgradeDiagnostics | null = null
): Promise<ExplainGraph> {
  const g = new GraphBuilder();
  const semanticViews = requireLockSemanticViews(lock);
  const appId = `app:${lock.app.id}`;
  addSemanticProjection(g, semanticViews);
  g.node(appId, 'app', lock.app.name);

  const runtimeAttributions = new Map(
    (await buildRuntimeAttributions(lock, provenance.artifacts.map((artifact) => artifact.path), workspaceRoot))
      .map((attribution) => [attribution.path, attribution] as const)
  );

  for (const artifact of provenance.artifacts) {
    const fileId = `file:${artifact.path}`;
    g.node(fileId, 'file', artifact.path);
    const originId = artifact.originType === 'block' ? `block:${artifact.originId}`
      : artifact.originType === 'override' ? `override:${artifact.originId}`
      : appId;
    if (artifact.originType === 'block') g.node(originId, 'block', artifact.originId);
    if (artifact.originType === 'override') g.node(originId, 'override', artifact.originId);
    g.edge(fileId, originId, 'originates_from');

    const attribution = runtimeAttributions.get(artifact.path);
    if (attribution) {
      for (const blockId of attribution.relatedBlocks) {
        g.node(`block:${blockId}`, 'block', blockId);
        g.edge(`block:${blockId}`, fileId, 'writes_to');
      }
    }
  }

  if (policyReport) {
    const blockIds = new Set(lock.resolvedBlocks.map((block) => block.id));
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
    for (const check of upgradePlan.preflightChecks) g.link(upgradeId, `${upgradeId}:preflight:${check.id}`, 'depends_on', 'upgrade', check.id);
    for (const impact of upgradePlan.impacts) g.link(upgradeId, `file:${impact}`, 'writes_to', 'file', impact);
    for (const migration of upgradePlan.migrationSummaries) {
      const migrationId = `${upgradeId}:migration:${migration.id}`;
      const verificationId = migration.requiresVerification
        ? 'upgrade-verification:required'
        : 'upgrade-verification:skipped';
      g.node(migrationId, 'upgrade', migration.id);
      g.node(
        verificationId,
        'upgrade',
        migration.requiresVerification ? 'verification required' : 'verification skipped'
      );
      g.link(migrationId, `file:${migration.target}`, 'writes_to', 'file', migration.target);
      g.edge(upgradeId, migrationId, 'depends_on');
      g.edge(migrationId, verificationId, 'depends_on');
    }
  }

  if (upgradeDiagnostics) {
    const diagnosticsId = `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}:diagnostics`;
    const planId = `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}`;
    g.node(`block:${upgradeDiagnostics.blockId}`, 'block', upgradeDiagnostics.blockId);
    g.node(diagnosticsId, 'upgrade', upgradeDiagnostics.errorCode);
    g.edge(diagnosticsId, upgradePlan ? planId : `block:${upgradeDiagnostics.blockId}`, 'connects_to');
    g.link(diagnosticsId, `${planId}:preflight:${upgradeDiagnostics.failedCheck}`, 'connects_to', 'upgrade', upgradeDiagnostics.failedCheck);
    const migrationId = readUpgradeDiagnosticsString(upgradeDiagnostics, 'migrationId');
    if (upgradePlan && migrationId) g.edge(diagnosticsId, `${planId}:migration:${migrationId}`, 'connects_to');
    const entry = readUpgradeDiagnosticsString(upgradeDiagnostics, 'entry');
    if (entry) g.link(diagnosticsId, `file:${entry}`, 'connects_to', 'file', entry);
    const rollbackStatus = readUpgradeDiagnosticsString(upgradeDiagnostics, 'rollbackStatus');
    if (rollbackStatus) g.link(
      diagnosticsId,
      `upgrade:${upgradeDiagnostics.blockId}:${upgradeDiagnostics.targetVersion}:rollback:${rollbackStatus}`,
      'connects_to',
      'upgrade',
      `rollback ${rollbackStatus}`
    );
  }

  for (const acceptanceId of lock.acceptancePlan) {
    g.node(`acceptance:${acceptanceId}`, 'acceptance', acceptanceId);
  }
  for (const blockCoverage of coverage.blocks) {
    g.node(`block:${blockCoverage.id}`, 'block', blockCoverage.id);
    for (const acceptanceId of blockCoverage.coveredBy) {
      g.edge(`block:${blockCoverage.id}`, `acceptance:${acceptanceId}`, 'verified_by');
    }
  }
  return g.build(semanticViews, {
    provenance: provenance.artifacts,
    coverage: {
      blocks: coverage.blocks.map((entry) => ({ id: entry.id, coveredBy: [...entry.coveredBy] }))
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
    const base = node.id.replace(/[^A-Za-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '') || 'node';
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

export function renderExplainGraphMermaid(graph: ExplainGraph): string {
  const nodeIds = buildMermaidNodeIds(graph);
  const lines = ['flowchart TD'];
  for (const node of graph.nodes) {
    lines.push(`  ${nodeIds.get(node.id)}["${escapeProjectionLabel(`${node.label} (${node.type})`)}"]`);
  }
  for (const edge of graph.edges) {
    lines.push(`  ${nodeIds.get(edge.from)} -- ${edge.type} --> ${nodeIds.get(edge.to)}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderExplainGraphDot(graph: ExplainGraph): string {
  const lines = ['digraph ExplainGraph {'];
  for (const node of graph.nodes) {
    lines.push(`  "${escapeProjectionLabel(node.id)}" [label="${escapeProjectionLabel(`${node.label} (${node.type})`)}"];`);
  }
  for (const edge of graph.edges) {
    lines.push(`  "${escapeProjectionLabel(edge.from)}" -> "${escapeProjectionLabel(edge.to)}" [label="${edge.type}"];`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

async function publishGraphArtifact(
  workspaceRoot: string,
  targetPath: string,
  bytes: Uint8Array,
  label: string,
  commitFence?: CommitFence
): Promise<void> {
  await publishExistingParentCanonicalWorkspaceFile({
    workspaceRoot,
    targetPath,
    bytes,
    label,
    commitFence
  });
}

export async function writeExplainGraph(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  commitFence?: CommitFence
): Promise<ExplainGraph> {
  const acceptanceCoveragePath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.acceptanceCoverage
  );
  const explainGraphDotPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.explainGraphDot
  );
  const explainGraphMermaidPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.explainGraphMermaid
  );
  const explainGraphPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.explainGraph
  );
  const lockPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.graphLock
  );
  const graph = await writeGeneratedArtifactWithLock(
    lockPath,
    lock,
    CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
    async () => {
      const coverage = readOptionalAcceptanceCoverageReport(
        acceptanceCoveragePath,
        'Explain Acceptance coverage'
      );
      if (coverage === null) {
        throw new CompilerError('EXPLAIN-BLOCKED-002', 'acceptance-coverage.json is missing');
      }
      const { policyReport, upgradePlan, upgradeDiagnostics } =
        readReviewGovernanceReports(workspaceRoot);
      const nextProvenance = provenance.artifacts.some((artifact) =>
        artifact.path === CI_ARTIFACT_FILES.explainGraph)
        ? provenance
        : await buildProvenance(workspaceRoot, lock);
      const nextGraph = await buildExplainGraph(
        workspaceRoot,
        lock,
        nextProvenance,
        coverage,
        policyReport,
        upgradePlan,
        upgradeDiagnostics
      );
      await publishGraphArtifact(
        workspaceRoot,
        explainGraphPath,
        Buffer.from(formatJsonFile(nextGraph), 'utf8'),
        'Explain Graph JSON',
        commitFence
      );
      await publishGraphArtifact(
        workspaceRoot,
        explainGraphMermaidPath,
        Buffer.from(renderExplainGraphMermaid(nextGraph), 'utf8'),
        'Explain Graph Mermaid',
        commitFence
      );
      await publishGraphArtifact(
        workspaceRoot,
        explainGraphDotPath,
        Buffer.from(renderExplainGraphDot(nextGraph), 'utf8'),
        'Explain Graph DOT',
        commitFence
      );
      return nextGraph;
    },
    commitFence
  );
  await writeProvenance(workspaceRoot, lock, commitFence);
  return graph;
}
