import type {
  ExplainGraphInspectView
} from '../../application/explain-graph-inspect.ts';
import { formatSummaryEntries } from './format-utils.ts';

export function formatExplainGraphInspect(view: ExplainGraphInspectView): string {
  return [
    `Explain graph ${view.nodeCount} nodes ${view.edgeCount} edges`,
    `Node types: ${formatSummaryEntries(view.nodeTypeCounts)}`,
    `Edge types: ${formatSummaryEntries(view.edgeTypeCounts)}`,
    `Coverage overlay: ${view.coverageBlockCount} blocks`,
    `Provenance overlay: ${view.provenanceArtifactCount} artifacts`
  ].join('\n');
}
