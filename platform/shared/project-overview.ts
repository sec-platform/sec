import path from 'node:path';

import { compareCodeUnits } from './canonical-primitives.ts';
import { readOptionalCiArtifactManifestV1 } from './ci-artifact-authority.ts';
import { CI_ARTIFACT_FILES } from './ci-artifact-contract.ts';
import { CONTRACT_FORMAT_VERSION } from './constants.ts';
import { CompilerError } from './errors.ts';
import { getWorkspacePaths, relativePosixPath } from './paths.ts';
import { platformCommand } from './platform-command.ts';
import { readOptionalProvenanceFileV1 } from './provenance-authority.ts';
import { readOptionalRetainedJsonV1 } from './retained-file-read.ts';
import { TOOL_EVIDENCE_REPORT_KINDS, type ToolEvidenceReport, type ToolEvidenceReportKind } from './tool-evidence-contract.ts';
import type {
  AcceptanceCoverageReport,
  CiArtifactManifest,
  ExplainGraph,
  LockFile,
  PolicyReport,
  ProvenanceFile,
  ReviewRegressionRisk,
  ReviewSummary,
  VerificationReport
} from './types.ts';
import { readOptionalCanonicalVerificationArtifactSetV1 } from './verification-artifact-authority.ts';

export type ProjectOverviewStatusValue = 'passed' | 'attention' | 'failed' | 'not-run' | 'unknown';
export type ProjectOverviewQualityStatus = ProjectOverviewStatusValue | 'unavailable';
export type ProjectOverviewViewId = 'overview' | 'source' | 'slot-rule' | 'graph' | 'review';

export interface ProjectOverviewWorkspace {
  root: string;
  sourceRoot: string;
  projectRoot: string;
  controlRoot: string;
  localStateRoot: string;
}

export interface ProjectOverviewStatus {
  overall: ProjectOverviewStatusValue;
  verification: ProjectOverviewStatusValue;
  policy: ProjectOverviewStatusValue;
  coverage: ProjectOverviewStatusValue;
  artifacts: ProjectOverviewStatusValue;
  reviewChain: ProjectOverviewStatusValue;
}

export interface ProjectOverviewNavigation {
  workbenchViews: Array<{
    id: ProjectOverviewViewId;
    path: string | undefined;
  }>;
}

export interface ProjectOverviewPriorityFile {
  path: string;
  reasons: string[];
}

export interface ProjectOverviewAiContext {
  appName: string;
  blockCount: number;
  slotCount: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  generatedPathCount: number;
  unverifiedArtifactCount: number;
  priorityReviewFileCount: number;
  priorityReviewFiles: ProjectOverviewPriorityFile[];
}

export interface ProjectOverviewQualityReport {
  kind: ToolEvidenceReportKind;
  available: boolean;
  status: ProjectOverviewQualityStatus;
  diagnosticCount: number;
  affectedFileCount: number;
  rawReportPaths: string[];
}

export interface ProjectOverviewQuality {
  reports: ProjectOverviewQualityReport[];
}

export interface ProjectOverviewRisks {
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  missingArtifactCount: number;
  policyErrorCount: number;
}

export interface ProjectOverview {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  generatedAt: string;
  workspace: ProjectOverviewWorkspace;
  status: ProjectOverviewStatus;
  navigation: ProjectOverviewNavigation;
  aiContext: ProjectOverviewAiContext;
  quality: ProjectOverviewQuality;
  risks: ProjectOverviewRisks;
}

export interface BuildProjectOverviewInput {
  workspaceRoot: string;
  lock: LockFile;
  explainGraph: ExplainGraph;
  provenance: ProvenanceFile;
  verification: VerificationReport;
  acceptanceCoverage: AcceptanceCoverageReport;
  policy: PolicyReport;
  reviewSummary: ReviewSummary;
  artifactManifest?: CiArtifactManifest | null;
  toolEvidenceReports?: readonly ToolEvidenceReport[];
  generatedAt?: string;
}

export const PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS: Record<ToolEvidenceReportKind, string> = {
  'code-quality': 'control/evidence/code-quality-report.json',
  'architecture-boundary': 'control/evidence/architecture-boundary-report.json',
  'semantic-pattern': 'control/evidence/semantic-pattern-report.json'
};

function normalizeStatus(value: string | undefined): ProjectOverviewStatusValue {
  switch (value) {
    case 'passed':
    case 'attention':
    case 'failed':
    case 'not-run':
      return value;
    case 'skipped':
      return 'not-run';
    default:
      return 'unknown';
  }
}

function normalizePolicyStatus(policy: PolicyReport): ProjectOverviewStatusValue {
  const status = normalizeStatus(policy.status);
  if (status === 'passed' && (
    policy.evaluation?.assurance !== 'semantic' ||
    policy.evaluation.unsupportedSemanticPredicates.length > 0
  )) {
    return 'unknown';
  }
  return status;
}

function combineOverallStatus(values: readonly ProjectOverviewStatusValue[]): ProjectOverviewStatusValue {
  if (values.includes('failed')) return 'failed';
  if (values.includes('attention')) return 'attention';
  if (values.includes('unknown')) return 'unknown';
  if (values.includes('not-run')) return 'not-run';
  return 'passed';
}

function buildWorkspaceSummary(workspaceRoot: string): ProjectOverviewWorkspace {
  const paths = getWorkspacePaths(workspaceRoot);
  return {
    root: '.',
    sourceRoot: relativePosixPath(paths.workspaceRoot, paths.developerSourceRoot),
    projectRoot: relativePosixPath(paths.workspaceRoot, paths.projectRoot),
    controlRoot: relativePosixPath(paths.workspaceRoot, paths.controlRoot),
    localStateRoot: relativePosixPath(paths.workspaceRoot, paths.localStateRoot)
  };
}

function buildNavigation(): ProjectOverviewNavigation {
  return {
    workbenchViews: [
      { id: 'overview', path: CI_ARTIFACT_FILES.overviewView },
      { id: 'source', path: CI_ARTIFACT_FILES.sourceView },
      { id: 'slot-rule', path: CI_ARTIFACT_FILES.slotRuleView },
      { id: 'graph', path: CI_ARTIFACT_FILES.graphView },
      { id: 'review', path: CI_ARTIFACT_FILES.reviewView }
    ]
  };
}

function pushPriorityReason(
  priorityByPath: Map<string, Set<string>>,
  targetPath: string | undefined,
  reason: string
): void {
  if (!targetPath) return;
  const reasons = priorityByPath.get(targetPath) ?? new Set<string>();
  reasons.add(reason);
  priorityByPath.set(targetPath, reasons);
}

function regressionRiskPath(risk: ReviewRegressionRisk): string | null {
  if (risk.slotId) return `slot:${risk.slotId}`;
  if (risk.blockId) return `block:${risk.blockId}`;
  return null;
}

function isPseudoPriorityPath(value: string): boolean {
  return value.startsWith('slot:') || value.startsWith('block:');
}

function buildPriorityReviewFiles(reviewSummary: ReviewSummary): ProjectOverviewPriorityFile[] {
  const priorityByPath = new Map<string, Set<string>>();
  for (const artifactPath of reviewSummary.provenanceSummary?.unverifiedArtifacts ?? []) {
    pushPriorityReason(priorityByPath, artifactPath, 'unverified provenance');
  }
  for (const artifact of reviewSummary.artifactSummary?.missing ?? []) {
    pushPriorityReason(priorityByPath, artifact.path, `missing artifact: ${artifact.reason}`);
  }
  for (const risk of reviewSummary.regressionRisks) {
    pushPriorityReason(priorityByPath, regressionRiskPath(risk) ?? undefined, `regression risk: ${risk.kind}`);
  }
  return Array.from(priorityByPath.entries())
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([priorityPath, reasons]) => ({
      path: priorityPath,
      reasons: Array.from(reasons).sort((left, right) => compareCodeUnits(left, right))
    }));
}

function buildQualityReport(kind: ToolEvidenceReportKind, reportsByKind: Map<ToolEvidenceReportKind, ToolEvidenceReport>): ProjectOverviewQualityReport {
  const report = reportsByKind.get(kind);
  if (!report) {
    return {
      kind,
      available: false,
      status: 'unavailable',
      diagnosticCount: 0,
      affectedFileCount: 0,
      rawReportPaths: [PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS[kind]]
    };
  }
  return {
    kind,
    available: true,
    status: normalizeStatus(report.status),
    diagnosticCount: report.summary.diagnosticCount,
    affectedFileCount: report.summary.affectedFileCount,
    rawReportPaths: [...report.rawReportPaths]
  };
}

function buildQuality(toolEvidenceReports: readonly ToolEvidenceReport[] = []): ProjectOverviewQuality {
  const reportsByKind = new Map<ToolEvidenceReportKind, ToolEvidenceReport>(
    toolEvidenceReports.map((report) => [report.kind, report])
  );
  return { reports: TOOL_EVIDENCE_REPORT_KINDS.map((kind) => buildQualityReport(kind, reportsByKind)) };
}

function countPolicyErrors(policy: PolicyReport): number {
  return policy.violations.filter((violation) => violation.severity === 'error' || violation.severity === 'blocker').length;
}

export function buildProjectOverview(input: BuildProjectOverviewInput): ProjectOverview {
  const verification = normalizeStatus(input.verification.summary.status);
  const policy = normalizePolicyStatus(input.policy);
  const coverage = normalizeStatus(input.acceptanceCoverage.status);
  const artifacts = normalizeStatus(
    input.artifactManifest?.summary.artifactStatus
    ?? input.reviewSummary.artifactSummary?.artifactStatus
  );
  const reviewChain = normalizeStatus(input.reviewSummary.chainSummary.status);
  const overall = combineOverallStatus([verification, policy, coverage, artifacts, reviewChain]);
  const priorityReviewFiles = buildPriorityReviewFiles(input.reviewSummary);

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    workspace: buildWorkspaceSummary(input.workspaceRoot),
    status: { overall, verification, policy, coverage, artifacts, reviewChain },
    navigation: buildNavigation(),
    aiContext: {
      appName: input.lock.app.name,
      blockCount: input.lock.resolvedBlocks.length,
      slotCount: input.lock.slotTasks.length,
      graphNodeCount: input.explainGraph.nodes.length,
      graphEdgeCount: input.explainGraph.edges.length,
      generatedPathCount: input.lock.generatedPaths.length,
      unverifiedArtifactCount: input.reviewSummary.provenanceSummary?.unverifiedArtifactCount ?? 0,
      priorityReviewFileCount: priorityReviewFiles.filter((entry) => !isPseudoPriorityPath(entry.path)).length,
      priorityReviewFiles
    },
    quality: buildQuality(input.toolEvidenceReports),
    risks: {
      failureCount: input.reviewSummary.failurePoints.length,
      regressionRiskCount: input.reviewSummary.regressionRisks.length,
      conflictHintCount: input.reviewSummary.conflictHints.length,
      missingArtifactCount: input.artifactManifest?.summary.missingCount ?? input.reviewSummary.artifactSummary?.missingCount ?? 0,
      policyErrorCount: countPolicyErrors(input.policy)
    }
  };
}

function readRequiredArtifact<T>(filePath: string, label: string): T {
  const value = readOptionalRetainedJsonV1<T>(filePath, label);
  if (value === null) {
    throw new CompilerError(
      'EXPLAIN-BLOCKED-004',
      `${label} is missing; run the refresh chain, then ${platformCommand('explain')}`
    );
  }
  return value;
}

function requiredArtifactError(label: string, reason: string): CompilerError {
  return new CompilerError(
    'EXPLAIN-BLOCKED-004',
    `${label} ${reason}; run the refresh chain, then ${platformCommand('explain')}`
  );
}

function readRequiredProvenance(filePath: string, label: string): ProvenanceFile {
  try {
    const value = readOptionalProvenanceFileV1(filePath, label);
    if (value === null) throw requiredArtifactError(label, 'is missing');
    return value;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw requiredArtifactError(label, `is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readRequiredVerificationArtifacts(workspaceRoot: string) {
  try {
    const artifacts = readOptionalCanonicalVerificationArtifactSetV1(
      workspaceRoot,
      'Project Overview Verification artifact set'
    );
    if (artifacts === null) throw requiredArtifactError('Verification artifact set', 'is missing');
    return artifacts;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw requiredArtifactError(
      'Verification artifact set',
      `is malformed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function buildProjectOverviewFromWorkspace(workspaceRoot = process.cwd()): ProjectOverview {
  const paths = getWorkspacePaths(workspaceRoot);
  const lock = readRequiredArtifact<LockFile>(paths.lockPath, 'Lock file');
  const explainGraph = readRequiredArtifact<ExplainGraph>(paths.explainGraphPath, 'Explain graph');
  const provenance = readRequiredProvenance(paths.provenancePath, 'Provenance report');
  const verificationArtifacts = readRequiredVerificationArtifacts(paths.workspaceRoot);
  const reviewSummary = readRequiredArtifact<ReviewSummary>(paths.reviewSummaryPath, 'Review summary');
  const artifactManifest = readOptionalCiArtifactManifestV1(
    paths.ciArtifactsPath,
    'CI Artifact manifest'
  );
  const codeQuality = readOptionalRetainedJsonV1<ToolEvidenceReport>(
    path.join(paths.workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['code-quality']),
    'Code quality report'
  );
  const architectureBoundary = readOptionalRetainedJsonV1<ToolEvidenceReport>(
    path.join(paths.workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['architecture-boundary']),
    'Architecture boundary report'
  );
  const semanticPattern = readOptionalRetainedJsonV1<ToolEvidenceReport>(
    path.join(paths.workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['semantic-pattern']),
    'Semantic pattern report'
  );

  return buildProjectOverview({
    workspaceRoot: paths.workspaceRoot,
    lock,
    explainGraph,
    provenance,
    verification: verificationArtifacts.verificationReport,
    acceptanceCoverage: verificationArtifacts.acceptanceCoverage,
    policy: verificationArtifacts.policyReport,
    reviewSummary,
    artifactManifest,
    toolEvidenceReports: [codeQuality, architectureBoundary, semanticPattern].filter(
      (report): report is ToolEvidenceReport => report !== null
    )
  });
}

export function formatProjectOverview(overview: ProjectOverview): string {
  return [
    `Project overview ${overview.status.overall}`,
    `Workspace: ${overview.workspace.sourceRoot}/${overview.workspace.projectRoot}/${overview.workspace.controlRoot}/${overview.workspace.localStateRoot} ready`,
    `Verification: ${overview.status.verification}; policy: ${overview.status.policy}; coverage: ${overview.status.coverage}; artifacts: ${overview.status.artifacts}`,
    `Graph: ${overview.aiContext.graphNodeCount} nodes / ${overview.aiContext.graphEdgeCount} edges; blocks=${overview.aiContext.blockCount}; slots=${overview.aiContext.slotCount}`,
    `Risks: failures=${overview.risks.failureCount}; regressions=${overview.risks.regressionRiskCount}; conflicts=${overview.risks.conflictHintCount}; missingArtifacts=${overview.risks.missingArtifactCount}`,
    `Views: ${CI_ARTIFACT_FILES.overviewView}`,
    `Next: ${platformCommand('explain')} | ${platformCommand('verify', '--json', '--compact')}`
  ].join('\n');
}
