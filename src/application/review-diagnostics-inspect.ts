import { uniqueSorted } from '../contracts/canonical.ts';

export type ReviewDiagnosticsProjectionSource = Readonly<{
  ciSummary: Readonly<{ status: string }>;
  failurePoints: readonly Readonly<{
    kind: string;
    lane: string;
    message: string;
    artifactPath: string;
  }>[];
  regressionRisks: readonly Readonly<{
    kind: string;
    message: string;
    blockId?: string;
  }>[];
  conflictHints: readonly Readonly<{
    kind: string;
    message: string;
    relatedId: string;
  }>[];
}>;

export type ReviewDiagnosticEntry =
  | Readonly<{
      id: string;
      category: 'failure';
      kind: string;
      lane: string;
      message: string;
      artifactPath: string;
    }>
  | Readonly<{
      id: string;
      category: 'regression-risk';
      kind: string;
      message: string;
      blockId?: string;
    }>
  | Readonly<{
      id: string;
      category: 'conflict';
      kind: string;
      message: string;
      relatedId: string;
    }>;

export type ReviewDiagnosticsInspectView = Readonly<{
  status: string;
  diagnosticCount: number;
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  artifactPathCount: number;
  artifactPaths: readonly string[];
  blockCount: number;
  blocks: readonly string[];
  diagnostics: readonly ReviewDiagnosticEntry[];
}>;

export function projectReviewDiagnostics(
  summary: ReviewDiagnosticsProjectionSource
): ReviewDiagnosticsInspectView {
  const diagnostics: ReviewDiagnosticEntry[] = [
    ...summary.failurePoints.map((point, index) => ({
      id: `failure:${index}`,
      category: 'failure' as const,
      kind: point.kind,
      lane: point.lane,
      message: point.message,
      artifactPath: point.artifactPath
    })),
    ...summary.regressionRisks.map((risk, index) => ({
      id: `regression-risk:${index}`,
      category: 'regression-risk' as const,
      kind: risk.kind,
      message: risk.message,
      ...(risk.blockId ? { blockId: risk.blockId } : {})
    })),
    ...summary.conflictHints.map((hint, index) => ({
      id: `conflict:${index}`,
      category: 'conflict' as const,
      kind: hint.kind,
      message: hint.message,
      relatedId: hint.relatedId
    }))
  ];
  const artifactPaths = uniqueSorted(summary.failurePoints.map((point) => point.artifactPath));
  const blocks = uniqueSorted(
    diagnostics.flatMap((entry) =>
      entry.category === 'regression-risk' && entry.blockId ? [entry.blockId] : []
    )
  );

  return {
    status: summary.ciSummary.status,
    diagnosticCount: diagnostics.length,
    failureCount: summary.failurePoints.length,
    regressionRiskCount: summary.regressionRisks.length,
    conflictHintCount: summary.conflictHints.length,
    artifactPathCount: artifactPaths.length,
    artifactPaths,
    blockCount: blocks.length,
    blocks,
    diagnostics
  };
}
