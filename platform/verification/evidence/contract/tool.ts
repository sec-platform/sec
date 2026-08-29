import { uniqueSorted } from '../../../foundation/collections.ts';
import { CONTRACT_FORMAT_VERSION } from '../../../shared/constants.ts';

export const TOOL_EVIDENCE_REPORT_KINDS = [
  'code-quality',
  'architecture-boundary',
  'semantic-pattern'
] as const;

export const TOOL_EVIDENCE_SEVERITIES = ['info', 'warning', 'error'] as const;
export const TOOL_EVIDENCE_STATUSES = ['passed', 'attention', 'failed'] as const;

export type ToolEvidenceReportKind = (typeof TOOL_EVIDENCE_REPORT_KINDS)[number];
export type ToolEvidenceSeverity = (typeof TOOL_EVIDENCE_SEVERITIES)[number];
export type ToolEvidenceStatus = (typeof TOOL_EVIDENCE_STATUSES)[number];

export interface ToolEvidenceDiagnosticInput {
  id: string;
  severity: ToolEvidenceSeverity;
  title: string;
  message: string;
  filePaths: readonly string[];
  evidence: readonly string[];
}

export interface ToolEvidenceDiagnostic extends ToolEvidenceDiagnosticInput {
  filePathCount: number;
  filePaths: string[];
  evidenceCount: number;
  evidence: string[];
}

export interface ToolEvidenceSummary {
  status: ToolEvidenceStatus;
  diagnosticCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  affectedFileCount: number;
  affectedFiles: string[];
}

export interface ToolEvidenceReportInput<Kind extends ToolEvidenceReportKind = ToolEvidenceReportKind> {
  kind: Kind;
  toolId: string;
  rawReportPaths: readonly string[];
  diagnostics: readonly ToolEvidenceDiagnosticInput[];
}

export interface ToolEvidenceReport<Kind extends ToolEvidenceReportKind = ToolEvidenceReportKind> {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  kind: Kind;
  toolId: string;
  stableArtifact: false;
  status: ToolEvidenceStatus;
  summary: ToolEvidenceSummary;
  rawReportPathCount: number;
  rawReportPaths: string[];
  diagnostics: ToolEvidenceDiagnostic[];
}

export type CodeQualityEvidenceReport = ToolEvidenceReport<'code-quality'>;
export type ArchitectureBoundaryEvidenceReport = ToolEvidenceReport<'architecture-boundary'>;
export type SemanticPatternEvidenceReport = ToolEvidenceReport<'semantic-pattern'>;

export interface ToolEvidenceInspection {
  kind: ToolEvidenceReportKind;
  status: ToolEvidenceStatus;
  stableArtifact: false;
  diagnosticCount: number;
  affectedFileCount: number;
  summaryLines: string[];
  diagnosticLines: string[];
}

function toolEvidenceStatus(summary: Pick<ToolEvidenceSummary, 'errorCount' | 'warningCount'>): ToolEvidenceStatus {
  if (summary.errorCount > 0) return 'failed';
  if (summary.warningCount > 0) return 'attention';
  return 'passed';
}

function buildToolEvidenceDiagnostic(diagnostic: ToolEvidenceDiagnosticInput): ToolEvidenceDiagnostic {
  const filePaths = uniqueSorted(diagnostic.filePaths);
  const evidence = uniqueSorted(diagnostic.evidence);

  return {
    ...diagnostic,
    filePathCount: filePaths.length,
    filePaths,
    evidenceCount: evidence.length,
    evidence
  };
}

function buildToolEvidenceSummary(diagnostics: readonly ToolEvidenceDiagnostic[]): ToolEvidenceSummary {
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const infoCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length;
  const affectedFiles = uniqueSorted(diagnostics.flatMap((diagnostic) => diagnostic.filePaths));
  const status = toolEvidenceStatus({ errorCount, warningCount });

  return {
    status,
    diagnosticCount: diagnostics.length,
    errorCount,
    warningCount,
    infoCount,
    affectedFileCount: affectedFiles.length,
    affectedFiles
  };
}

export function buildToolEvidenceReport<Kind extends ToolEvidenceReportKind>(
  input: ToolEvidenceReportInput<Kind>
): ToolEvidenceReport<Kind> {
  const diagnostics = input.diagnostics.map(buildToolEvidenceDiagnostic);
  const summary = buildToolEvidenceSummary(diagnostics);
  const rawReportPaths = uniqueSorted(input.rawReportPaths);

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    kind: input.kind,
    toolId: input.toolId,
    stableArtifact: false,
    status: summary.status,
    summary,
    rawReportPathCount: rawReportPaths.length,
    rawReportPaths,
    diagnostics
  };
}

export function inspectToolEvidenceReport(report: ToolEvidenceReport): ToolEvidenceInspection {
  return {
    kind: report.kind,
    status: report.status,
    stableArtifact: report.stableArtifact,
    diagnosticCount: report.summary.diagnosticCount,
    affectedFileCount: report.summary.affectedFileCount,
    summaryLines: [
      `Tool evidence ${report.kind} ${report.status}`,
      `Tool: ${report.toolId}`,
      `Stable artifact: ${report.stableArtifact}`,
      `Diagnostics: ${report.summary.diagnosticCount}`,
      `Affected files: ${report.summary.affectedFileCount}`,
      `Raw reports: ${report.rawReportPathCount}`
    ],
    diagnosticLines: report.diagnostics.map((diagnostic) => [
      `Diagnostic ${diagnostic.id}`,
      `severity=${diagnostic.severity}`,
      `files=${diagnostic.filePaths.join(', ')}`,
      `evidence=${diagnostic.evidence.join(', ')}`
    ].join('; '))
  };
}

export function formatToolEvidenceReport(report: ToolEvidenceReport): string {
  const inspection = inspectToolEvidenceReport(report);
  return [
    ...inspection.summaryLines,
    ...inspection.diagnosticLines
  ].join('\n');
}
