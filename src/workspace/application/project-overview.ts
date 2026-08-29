import path from 'node:path';

import { compareCodeUnits } from '../../system-architecture/foundation/runtime/canonical.ts';
import { readOptionalCiArtifactManifest } from '../../verification/ci-artifacts/runtime/authority.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { getWorkspacePaths, relativePosixPath } from '../runtime/paths.ts';
import { platformCommand } from '../../interface/cli/contract.ts';
import { readOptionalProvenanceFile } from '../../semantic/provenance/authority.ts';
import { readOptionalRetainedJson } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import type { AcceptanceCoverageReport } from '../../semantic/acceptance/contract/types.ts';
import type { CiArtifactManifest } from '../../verification/ci-artifacts/contract/types.ts';
import type { ExplainGraph } from '../../semantic/projection/contract/explain.ts';
import type { LockFile } from '../../compiler/contract.ts';
import type { PolicyReport } from '../../compiler/policies/contract/types.ts';
import type { ProvenanceFile } from '../../semantic/provenance/contract/types.ts';
import type { ReviewRegressionRisk, ReviewSummary } from '../../verification/review/contract/types.ts';
import { validateReviewSummary } from '../../verification/review/contract/summary.ts';
import type { VerificationReport } from '../../verification/contract/types.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../../verification/artifact/runtime/authority.ts';

export type ProjectOverviewStatusValue = 'passed' | 'attention' | 'failed' | 'not-run' | 'unknown';
export type ProjectOverviewArtifactId = 'graph' | 'graph-mermaid' | 'review' | 'verification';

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
  machineArtifacts: Array<{
    id: ProjectOverviewArtifactId;
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

export interface ProjectOverviewRisks {
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  missingArtifactCount: number;
  policyErrorCount: number;
}

export interface ProjectOverview {
  generatedAt: string;
  workspace: ProjectOverviewWorkspace;
  status: ProjectOverviewStatus;
  navigation: ProjectOverviewNavigation;
  aiContext: ProjectOverviewAiContext;
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
  generatedAt?: string;
}

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
    machineArtifacts: [
      { id: 'graph', path: CI_ARTIFACT_FILES.explainGraph },
      { id: 'graph-mermaid', path: CI_ARTIFACT_FILES.explainGraphMermaid },
      { id: 'review', path: CI_ARTIFACT_FILES.reviewSummary },
      { id: 'verification', path: CI_ARTIFACT_FILES.verificationReport }
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
    risks: {
      failureCount: input.reviewSummary.failurePoints.length,
      regressionRiskCount: input.reviewSummary.regressionRisks.length,
      conflictHintCount: input.reviewSummary.conflictHints.length,
      missingArtifactCount: input.artifactManifest?.summary.missingCount ?? input.reviewSummary.artifactSummary?.missingCount ?? 0,
      policyErrorCount: countPolicyErrors(input.policy)
    }
  };
}

function readRequiredArtifact<T>(
  filePath: string,
  label: string,
  validate: (value: unknown) => T = (value) => value as T
): T {
  const value = readOptionalRetainedJson<unknown>(filePath, label);
  if (value === null) {
    throw new CompilerError(
      'EXPLAIN-BLOCKED-004',
      `${label} is missing; run the refresh chain, then ${platformCommand('explain')}`
    );
  }
  try {
    return validate(value);
  } catch (error) {
    throw requiredArtifactError(label, `is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requiredArtifactError(label: string, reason: string): CompilerError {
  return new CompilerError(
    'EXPLAIN-BLOCKED-004',
    `${label} ${reason}; run the refresh chain, then ${platformCommand('explain')}`
  );
}

function readRequiredProvenance(filePath: string, label: string): ProvenanceFile {
  try {
    const value = readOptionalProvenanceFile(filePath, label);
    if (value === null) throw requiredArtifactError(label, 'is missing');
    return value;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw requiredArtifactError(label, `is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readRequiredVerificationArtifacts(workspaceRoot: string) {
  try {
    const artifacts = readOptionalCanonicalVerificationArtifactSet(
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
  const reviewSummary = readRequiredArtifact(paths.reviewSummaryPath, 'Review summary', validateReviewSummary);
  const artifactManifest = readOptionalCiArtifactManifest(
    paths.ciArtifactsPath,
    'CI Artifact manifest'
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
    artifactManifest
  });
}

export function formatProjectOverview(overview: ProjectOverview): string {
  return [
    `Project overview ${overview.status.overall}`,
    `Workspace: ${overview.workspace.sourceRoot}/${overview.workspace.projectRoot}/${overview.workspace.controlRoot}/${overview.workspace.localStateRoot} ready`,
    `Verification: ${overview.status.verification}; policy: ${overview.status.policy}; coverage: ${overview.status.coverage}; artifacts: ${overview.status.artifacts}`,
    `Graph: ${overview.aiContext.graphNodeCount} nodes / ${overview.aiContext.graphEdgeCount} edges; blocks=${overview.aiContext.blockCount}; slots=${overview.aiContext.slotCount}`,
    `Risks: failures=${overview.risks.failureCount}; regressions=${overview.risks.regressionRiskCount}; conflicts=${overview.risks.conflictHintCount}; missingArtifacts=${overview.risks.missingArtifactCount}`,
    `Machine artifacts: ${CI_ARTIFACT_FILES.explainGraph} | ${CI_ARTIFACT_FILES.reviewSummary}`,
    `Next: ${platformCommand('explain')} | ${platformCommand('verify', '--json', '--compact')}`
  ].join('\n');
}
