import type {
  ExplainGraphInspectCountEntry,
  ExplainGraphInspectView
} from '../../application/explain-graph-inspect.ts';
import { formatList } from './format-utils.ts';

function formatCountSummaries(entries: readonly ExplainGraphInspectCountEntry[]): string {
  return formatList(entries.map((entry) => `${entry.id}=${entry.count}`));
}

export function formatExplainGraphInspect(view: ExplainGraphInspectView): string {
  return [
    `Explain graph ${view.nodeCount} nodes ${view.edgeCount} edges`,
    `Node types: ${formatCountSummaries(view.nodeTypeCounts)}`,
    `Edge types: ${formatCountSummaries(view.edgeTypeCounts)}`,
    `Coverage overlay: ${view.coverageBlockCount} blocks`,
    `Provenance overlay: ${view.provenanceArtifactCount} artifacts`
  ].join('\n');
}
