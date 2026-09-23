import type { AcceptanceCoverageReport } from '../assurance/acceptance/coverage.ts';
import { CI_ARTIFACT_FILES } from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactManifest } from '../assurance/verification/ci-artifacts/contract/types.ts';
import type { VerificationReport } from '../assurance/verification/contract/types.ts';
import type { ReviewRegressionRisk, ReviewSummary } from '../assurance/verification/review/contract/types.ts';
import type { LockFile } from '../compiler/contract.ts';
import { compareCodeUnits } from '../contracts/canonical.ts';
import type { PolicyReport } from '../semantics/policies/types.ts';
import type { ExplainGraph } from '../semantics/projection/explain.ts';
import type { ProvenanceFile } from '../semantics/provenance/types.ts';

export type ProjectOverviewStatusValue = 'passed' | 'attention' | 'failed' | 'not-run' | 'unknown';
export type ProjectOverviewArtifactId = 'graph' | 'graph-mermaid' | 'review' | 'verification';

export interface ProjectOverviewWorkspace {
  root: string;
  modelRoot: string;
  srcRoot: string;
  testsRoot: string;
  prismaRoot: string;
  secRoot: string;
  artifactsRoot: string;
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
  workspace: ProjectOverviewWorkspace;
  lock: LockFile;
  explainGraph: ExplainGraph;
  provenance: ProvenanceFile;
  verification: VerificationReport;
  acceptanceCoverage: AcceptanceCoverageReport;
  policy: PolicyReport;
  reviewSummary: ReviewSummary;
  artifactManifest?: CiArtifactManifest | null;
  generatedAt: string;
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
  if (risk.blockId) return `block:${risk.blockId}`;
  return null;
}

function isPseudoPriorityPath(value: string): boolean {
  return value.startsWith('block:');
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
    generatedAt: input.generatedAt,
    workspace: input.workspace,
    status: { overall, verification, policy, coverage, artifacts, reviewChain },
    navigation: buildNavigation(),
    aiContext: {
      appName: input.lock.app.name,
      blockCount: input.lock.resolvedBlocks.length,
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
