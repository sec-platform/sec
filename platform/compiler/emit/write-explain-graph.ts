import fs from 'node:fs/promises';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { CompilerError } from '../../shared/errors.ts';
import { buildProvenance, writeProvenance } from './write-provenance.ts';
import type {
  AcceptanceCoverageReport,
  ExplainGraph,
  ExplainGraphEdge,
  ExplainGraphNode,
  LockFile,
  ProvenanceFile
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

export async function buildExplainGraph(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  coverage: AcceptanceCoverageReport
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
  const graph = await buildExplainGraph(workspaceRoot, lock, nextProvenance, coverage);

  await fs.writeFile(explainGraphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await writeProvenance(workspaceRoot, lock);
  return graph;
}
