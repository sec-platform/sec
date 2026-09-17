
import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import type { PolicyReport } from '../../semantics/policies/types.ts';
import {
  decodeExactUtf8,
  readOptionalRetainedJson,
  readOptionalRetainedOrdinaryFile
} from '../../adapters/runtime-state/physical/runtime/retained-file-read.ts';
import type { AcceptanceCoverageReport } from '../../assurance/acceptance/coverage.ts';
import type { ExplainGraph } from '../../semantics/projection/explain.ts';
import { readOptionalProvenanceFile } from '../../adapters/workspace/provenance-reader.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../../adapters/verification/platform/artifact/runtime/authority.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactManifest } from '../../assurance/verification/ci-artifacts/contract/types.ts';
import { readOptionalCiArtifactManifest } from '../../adapters/verification/platform/ci-artifacts/runtime/authority.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import { parseReviewSummaryJson } from '../../assurance/verification/review/contract/summary.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../adapters/workspace-context.ts";
import { relativePosixPath } from '../../contracts/relative-path.ts';
import { platformCommand } from '../../adapters/verification/platform/sec-command.ts';

export type {
  ProjectOverview,
  ProjectOverviewAiContext,
  ProjectOverviewArtifactId,
  ProjectOverviewNavigation,
  ProjectOverviewPriorityFile,
  ProjectOverviewRisks,
  ProjectOverviewStatus,
  ProjectOverviewStatusValue,
  ProjectOverviewWorkspace
} from '../../application/project-overview.ts';
import { buildProjectOverview as buildApplicationProjectOverview } from '../../application/project-overview.ts';
import type { ProjectOverview, ProjectOverviewWorkspace } from '../../application/project-overview.ts';
import { formatProjectOverview as formatEntryProjectOverview } from '../../entry/cli/project-overview.ts';

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

function buildWorkspaceSummary(workspaceRoot: string): ProjectOverviewWorkspace {
  const paths = getWorkspacePaths(workspaceRoot);
  return {
    root: '.',
    modelRoot: relativePosixPath(paths.workspaceRoot, paths.modelRoot),
    srcRoot: relativePosixPath(paths.workspaceRoot, paths.srcRoot),
    testsRoot: relativePosixPath(paths.workspaceRoot, paths.testsRoot),
    prismaRoot: relativePosixPath(paths.workspaceRoot, paths.prismaRoot),
    secRoot: relativePosixPath(paths.workspaceRoot, paths.secRoot),
    artifactsRoot: relativePosixPath(paths.workspaceRoot, paths.artifactsRoot)
  };
}

export function buildProjectOverview(input: BuildProjectOverviewInput): ProjectOverview {
  return buildApplicationProjectOverview({
    workspace: buildWorkspaceSummary(input.workspaceRoot),
    lock: input.lock,
    explainGraph: input.explainGraph,
    provenance: input.provenance,
    verification: input.verification,
    acceptanceCoverage: input.acceptanceCoverage,
    policy: input.policy,
    reviewSummary: input.reviewSummary,
    artifactManifest: input.artifactManifest,
    generatedAt: input.generatedAt ?? new Date().toISOString()
  });
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

function readRequiredReviewSummary(filePath: string, label: string): ReviewSummary {
  try {
    const bytes = readOptionalRetainedOrdinaryFile(filePath, label);
    if (bytes === null) throw requiredArtifactError(label, 'is missing');
    return parseReviewSummaryJson(decodeExactUtf8(bytes, label));
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
  const lock = readRequiredArtifact<LockFile>(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.graphLock),
    'Lock file'
  );
  const explainGraph = readRequiredArtifact<ExplainGraph>(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.explainGraph),
    'Explain graph'
  );
  const provenance = readRequiredProvenance(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.provenance),
    'Provenance report'
  );
  const verificationArtifacts = readRequiredVerificationArtifacts(paths.workspaceRoot);
  const reviewSummary = readRequiredReviewSummary(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.reviewSummary),
    'Review summary'
  );
  const artifactManifest = readOptionalCiArtifactManifest(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.artifactManifest),
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
  return formatEntryProjectOverview(overview, {
    explainCommand: platformCommand('explain'),
    verifyCompactCommand: platformCommand('verify', '--json', '--compact'),
    graphArtifactPath: CI_ARTIFACT_FILES.explainGraph,
    reviewArtifactPath: CI_ARTIFACT_FILES.reviewSummary
  });
}
