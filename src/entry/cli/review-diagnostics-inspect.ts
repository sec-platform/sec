import type {
  ReviewDiagnosticEntry,
  ReviewDiagnosticsInspectView
} from '../../application/review-diagnostics-inspect.ts';
import { formatFields, formatList } from './format-utils.ts';

function formatReviewDiagnostic(entry: ReviewDiagnosticEntry): string {
  const fields: string[] = [`Diagnostic ${entry.id}`, `kind=${entry.kind}`];
  if (entry.category === 'failure') {
    fields.push(`lane=${entry.lane}`, `artifact=${entry.artifactPath}`);
  } else if (entry.category === 'regression-risk') {
    fields.push(`block=${entry.blockId ?? 'none'}`);
  } else {
    fields.push(`related=${entry.relatedId}`);
  }
  fields.push(entry.message);
  return formatFields(fields);
}

export function formatReviewDiagnostics(view: ReviewDiagnosticsInspectView): string {
  return [
    formatFields([
      `Review diagnostics ${view.status}`,
      `diagnostics=${view.diagnosticCount}`,
      `failures=${view.failureCount}`,
      `risks=${view.regressionRiskCount}`,
      `conflicts=${view.conflictHintCount}`
    ]),
    `Artifacts: ${formatList([...view.artifactPaths])}`,
    `Blocks: ${formatList([...view.blocks])}`,
    ...view.diagnostics.slice(0, 10).map((entry) => formatReviewDiagnostic(entry))
  ].join('\n');
}
