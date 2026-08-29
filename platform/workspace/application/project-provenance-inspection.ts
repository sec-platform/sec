import { resolvePathInside } from '../runtime/paths.ts';
import { calculateCanonicalProjectFileHash } from '../runtime/project-file-hash.ts';
import type { ProvenanceArtifact } from '../../semantic/provenance/index.ts';

export type ProvenanceArtifactInspection = {
  artifact: ProvenanceArtifact;
  artifactPath: string;
  exists: boolean;
  currentHash: string | undefined;
};

/** Caller must pass artifacts from validateProvenanceFileV1; no identity
 * normalization is allowed at this protection decision boundary. */
export function protectedProvenanceArtifact(artifact: ProvenanceArtifact): boolean {
  const artifactPath = artifact.path;
  return (
    !artifactPath.startsWith('source/') &&
    !artifactPath.startsWith('control/') &&
    !artifactPath.startsWith('.sec/') &&
    artifact.originType !== 'slot' &&
    artifactPath !== 'tsconfig.json'
  );
}

/**
 * Retained project hashing is currently synchronous. Keep this inspection
 * synchronous as well instead of routing synchronous reads through p-limit /
 * Promise.all, which cannot create physical I/O concurrency and only adds task
 * allocation and scheduling overhead.
 */
export function inspectProvenanceArtifacts(
  projectRoot: string,
  artifacts: readonly ProvenanceArtifact[]
): ProvenanceArtifactInspection[] {
  return artifacts.map((artifact) => {
    const artifactPath = artifact.path;
    const absolutePath = resolvePathInside(projectRoot, artifactPath);
    if (!absolutePath) {
      return { artifact, artifactPath, exists: false, currentHash: undefined };
    }
    const observedHash = calculateCanonicalProjectFileHash(absolutePath);
    if (observedHash === undefined) {
      return { artifact, artifactPath, exists: false, currentHash: undefined };
    }
    return {
      artifact,
      artifactPath,
      exists: true,
      currentHash: artifact.hash ? observedHash : undefined
    };
  });
}
