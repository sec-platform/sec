import { CompilerError } from '../../compiler/errors.ts';
import { PhysicalNoFollowError } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { readOptionalProvenanceFile } from '../../semantic/provenance/authority.ts';
import type { ProvenanceFile } from '../../semantic/provenance/contract/types.ts';
import { getWorkspacePaths } from '../runtime/paths.ts';
import { assertProjectBaseline, readProjectBaseline } from '../runtime/project-baseline.ts';
import { listTrackedProjectPaths } from '../runtime/project-tracked-files.ts';
import {
  inspectProvenanceArtifacts,
  protectedProvenanceArtifact
} from './project-provenance-inspection.ts';

function readOptionalProvenanceNoFollow(provenancePath: string): ProvenanceFile | null {
  try {
    return readOptionalProvenanceFile(provenancePath, 'Canonical provenance');
  } catch (error) {
    if (error instanceof PhysicalNoFollowError) throw error;
    throw new CompilerError(
      'ERROR-DRIFT-001',
      `Canonical provenance cannot be decoded or validated: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function verifyPreviousProvenance(
  workspaceRoot: string,
  options: { strictMissing: boolean }
): Promise<boolean> {
  const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);
  const provenance = readOptionalProvenanceNoFollow(provenancePath);
  if (provenance === null) return false;

  const trackedProjectPaths = options.strictMissing ? null : await listTrackedProjectPaths(workspaceRoot);
  const inspected = inspectProvenanceArtifacts(
    projectRoot,
    provenance.artifacts.filter(protectedProvenanceArtifact)
  );

  for (const { artifact, artifactPath, exists, currentHash } of inspected) {
    if (!exists) {
      const missingIsDrift = options.strictMissing || trackedProjectPaths?.has(artifactPath) === true;
      if (missingIsDrift) {
        throw new CompilerError(
          'ERROR-DRIFT-001',
          `Reference drift detected: Read-only project file is missing: ${artifactPath}`
        );
      }
      continue;
    }
    if (artifact.hash && currentHash !== artifact.hash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
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
