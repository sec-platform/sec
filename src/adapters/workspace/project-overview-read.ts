import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import type { ExplainGraph } from '../../semantics/projection/explain.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { parseReviewSummaryJson } from '../../assurance/verification/review/contract/summary.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { decodeExactUtf8, readOptionalRetainedJson, readOptionalRetainedOrdinaryFile } from '../runtime-state/physical/runtime/retained-file-read.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../verification/platform/artifact/runtime/authority.ts';
import { readOptionalCiArtifactManifest } from '../verification/platform/ci-artifacts/runtime/authority.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../workspace-context.ts';
import { readOptionalProvenanceFile } from './provenance-reader.ts';

function readRequiredArtifact<T>(
  filePath: string,
  label: string,
  explainCommand: string,
  validate: (value: unknown) => T = (value) => value as T
): T {
  const value = readOptionalRetainedJson<unknown>(filePath, label);
  if (value === null) {
    throw new CompilerError(
      'EXPLAIN-BLOCKED-004',
      `${label} is missing; run the refresh chain, then ${explainCommand}`
    );
  }
  try {
    return validate(value);
  } catch (error) {
    throw requiredArtifactError(label, `is malformed: ${error instanceof Error ? error.message : String(error)}`, explainCommand);
  }
}

function requiredArtifactError(label: string, reason: string, explainCommand: string): CompilerError {
  return new CompilerError(
    'EXPLAIN-BLOCKED-004',
    `${label} ${reason}; run the refresh chain, then ${explainCommand}`
  );
}

function readRequiredProvenance(filePath: string, label: string, explainCommand: string): ProvenanceFile {
  try {
    const value = readOptionalProvenanceFile(filePath, label);
    if (value === null) throw requiredArtifactError(label, 'is missing', explainCommand);
    return value;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw requiredArtifactError(label, `is malformed: ${error instanceof Error ? error.message : String(error)}`, explainCommand);
  }
}

function readRequiredReviewSummary(filePath: string, label: string, explainCommand: string): ReviewSummary {
  try {
    const bytes = readOptionalRetainedOrdinaryFile(filePath, label);
    if (bytes === null) throw requiredArtifactError(label, 'is missing', explainCommand);
    return parseReviewSummaryJson(decodeExactUtf8(bytes, label));
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw requiredArtifactError(label, `is malformed: ${error instanceof Error ? error.message : String(error)}`, explainCommand);
  }
}

function readRequiredVerificationArtifacts(workspaceRoot: string, explainCommand: string) {
  try {
    const artifacts = readOptionalCanonicalVerificationArtifactSet(
      workspaceRoot,
      'Project Overview Verification artifact set'
    );
    if (artifacts === null) throw requiredArtifactError('Verification artifact set', 'is missing', explainCommand);
    return artifacts;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw requiredArtifactError(
      'Verification artifact set',
      `is malformed: ${error instanceof Error ? error.message : String(error)}`,
      explainCommand
    );
  }
}

/** Read current artifacts through their canonical owners without rendering or publishing. */
export function readProjectOverviewArtifacts(workspaceRoot: string, explainCommand: string) {
  const paths = getWorkspacePaths(workspaceRoot);
  const lock = readRequiredArtifact<LockFile>(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.graphLock),
    'Lock file',
    explainCommand
  );
  const explainGraph = readRequiredArtifact<ExplainGraph>(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.explainGraph),
    'Explain graph',
    explainCommand
  );
  const provenance = readRequiredProvenance(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.provenance),
    'Provenance report',
    explainCommand
  );
  const verificationArtifacts = readRequiredVerificationArtifacts(paths.workspaceRoot, explainCommand);
  const reviewSummary = readRequiredReviewSummary(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.reviewSummary),
    'Review summary',
    explainCommand
  );
  const artifactManifest = readOptionalCiArtifactManifest(
    resolveWorkspaceArtifactPath(paths.workspaceRoot, CI_ARTIFACT_FILES.artifactManifest),
    'CI Artifact manifest'
  );
  return {
    workspaceRoot: paths.workspaceRoot,
    lock,
    explainGraph,
    provenance,
    verification: verificationArtifacts.verificationReport,
    acceptanceCoverage: verificationArtifacts.acceptanceCoverage,
    policy: verificationArtifacts.policyReport,
    reviewSummary,
    artifactManifest
  };
}
