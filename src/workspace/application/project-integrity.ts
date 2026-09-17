import { PhysicalNoFollowError } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { readOptionalProvenanceFile } from '../../adapters/workspace/provenance-reader.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import { ProjectIntegrityError } from '../contract/project-integrity.ts';
import { modelRelativePath } from '../contract/types.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath, secRelativePath, tsconfigRelativePath, workspaceConfigRelativePath } from '../runtime/paths.ts';
import { assertProjectBaseline, readProjectBaseline } from '../runtime/project-baseline.ts';
import { listTrackedProjectPaths } from '../runtime/project-tracked-files.ts';
import { inspectProvenanceArtifacts } from './project-provenance-inspection.ts';

function readOptionalProvenanceNoFollow(provenancePath: string): ProvenanceFile | null {
  try {
    return readOptionalProvenanceFile(provenancePath, 'Canonical provenance');
  } catch (error) {
    if (error instanceof PhysicalNoFollowError) throw error;
    throw new ProjectIntegrityError(
      `Canonical provenance cannot be decoded or validated: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function verifyPreviousProvenance(
  workspaceRoot: string,
  options: { strictMissing: boolean }
): Promise<boolean> {
  const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
  const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
  const provenance = readOptionalProvenanceNoFollow(provenancePath);
  if (provenance === null) return false;

  const trackedProjectPaths = options.strictMissing ? null : await listTrackedProjectPaths(workspaceRoot);
  const inspected = inspectProvenanceArtifacts(
    root,
    provenance.artifacts.filter((artifact) => (
      !artifact.path.startsWith(`${modelRelativePath}/`)
      && !artifact.path.startsWith(`${secRelativePath}/`)
      && artifact.path !== workspaceConfigRelativePath
      && artifact.path !== tsconfigRelativePath
    ))
  );

  for (const { artifact, artifactPath, exists, currentHash } of inspected) {
    if (!exists) {
      const missingIsDrift = options.strictMissing || trackedProjectPaths?.has(artifactPath) === true;
      if (missingIsDrift) {
        throw new ProjectIntegrityError(
          `Reference drift detected: Read-only project file is missing: ${artifactPath}`
        );
      }
      continue;
    }
    if (artifact.hash && currentHash !== artifact.hash) {
      throw new ProjectIntegrityError(
        `Reference drift detected: Read-only project file modified: ${artifactPath}`
      );
    }
  }
  return true;
}

export async function checkProjectBeforeCompile(workspaceRoot: string): Promise<void> {
  const baseline = readProjectBaseline(workspaceRoot);
  if (baseline) {
    assertProjectBaseline(workspaceRoot, baseline);
    return;
  }
  await verifyPreviousProvenance(workspaceRoot, { strictMissing: false });
}

export async function checkProjectBeforeVerify(
  workspaceRoot: string,
  expectedArtifactPaths?: readonly string[]
): Promise<void> {
  const baseline = readProjectBaseline(workspaceRoot);
  if (baseline) {
    assertProjectBaseline(workspaceRoot, baseline, { expectedArtifactPaths });
    return;
  }
  await verifyPreviousProvenance(workspaceRoot, { strictMissing: false });
}

export async function checkReferenceDrift(workspaceRoot: string): Promise<void> {
  await verifyPreviousProvenance(workspaceRoot, { strictMissing: true });
}

export async function checkProvenanceFallback(workspaceRoot: string): Promise<void> {
  await verifyPreviousProvenance(workspaceRoot, { strictMissing: false });
}
