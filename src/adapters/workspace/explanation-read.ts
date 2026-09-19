import path from 'node:path';
import { CompilerError } from '../../compiler/errors.ts';
import type { ExplainGraph } from '../../semantics/projection/explain.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { readOptionalRetainedJson } from '../runtime-state/physical/runtime/retained-file-read.ts';
import { readOptionalProvenanceFile } from './provenance-reader.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../verification/platform/artifact/runtime/authority.ts';
import { resolveWorkspaceArtifactPath, resolveWorkspaceProvenancePath } from '../workspace-context.ts';

function readOptionalValidatedProvenance(filePath: string, label: string): ProvenanceFile | null {
  try {
    return readOptionalProvenanceFile(filePath, label);
  } catch (error) {
    throw new CompilerError(
      'EXPLAIN-BLOCKED-003',
      `${label} is malformed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function readRequiredExplanationProvenance(workspaceRoot: string, label: string): Promise<ProvenanceFile> {
  const filePath = await resolveWorkspaceProvenancePath(workspaceRoot);
  const value = readOptionalValidatedProvenance(filePath, label);
  if (value === null) throw new CompilerError('EXPLAIN-BLOCKED-003', `${label} is missing`);
  return value;
}

export function readRequiredExplanationVerification(workspaceRoot: string) {
  try {
    const artifacts = readOptionalCanonicalVerificationArtifactSet(
      workspaceRoot,
      'Explain Verification artifact set'
    );
    if (artifacts === null) {
      throw new CompilerError('EXPLAIN-BLOCKED-003', 'Verification artifact set is missing');
    }
    return artifacts;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw new CompilerError(
      'EXPLAIN-BLOCKED-003',
      `Verification artifact closure is not canonical: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Bind the locators without reading artifact bodies. The use case first
 * checks its Lock statuses, then invokes this read exactly once if eligible. */
export async function prepareReviewRefreshRead(workspaceRoot: string) {
  const root = path.resolve(workspaceRoot);
  const graphPath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.explainGraph);
  const reviewPath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.reviewSummary);
  const provenancePath = await resolveWorkspaceProvenancePath(root);
  return () => {
    const graph = readOptionalRetainedJson<ExplainGraph>(graphPath, 'Explain graph');
    const provenance = readOptionalValidatedProvenance(provenancePath, 'Provenance report');
    const priorReview = readOptionalRetainedJson<unknown>(reviewPath, 'Review summary');
    const verification = readOptionalCanonicalVerificationArtifactSet(root, 'Review refresh Verification artifact set');
    if (graph === null || provenance === null || priorReview === null || verification === null) return null;
    return { graph, provenance, verification };
  };
}
