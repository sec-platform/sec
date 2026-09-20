import type { UpgradeDiagnostics, UpgradePlan } from '../../../semantics/upgrade/upgrade-artifact.ts';
import type { AcceptanceCoverageReport } from '../../../assurance/acceptance/coverage.ts';
import type { ExplainGraph } from '../../../semantics/projection/explain.ts';
import type { ProvenanceFile } from '../../../semantics/provenance/types.ts';
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
import { buildExplainGraphFromEvidence } from '../../../assurance/verification/review/explain-graph.ts';
import { buildProvenance, writeProvenance } from '../../artifacts/provenance.ts';

export async function buildExplainGraph(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  coverage: AcceptanceCoverageReport,
  policyReport: PolicyReport | null,
  upgradePlan: UpgradePlan | null = null,
  upgradeDiagnostics: UpgradeDiagnostics | null = null
): Promise<ExplainGraph> {
  const runtimeAttributions = await buildRuntimeAttributions(
    lock,
    provenance.artifacts.map(artifact => artifact.path),
    workspaceRoot
  );
  return buildExplainGraphFromEvidence(
    lock,
    provenance,
    coverage,
    policyReport,
    runtimeAttributions,
    upgradePlan,
    upgradeDiagnostics
  );
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
