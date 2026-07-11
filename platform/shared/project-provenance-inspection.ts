import { createConcurrencyLimit } from './concurrency.ts';
import { pathExists } from './fs.ts';
import { posixPath, resolvePathInside } from './paths.ts';
import { calculateCanonicalProjectFileHash } from './project-file-hash.ts';
import type { ProvenanceArtifact } from './provenance-types.ts';

export type ProvenanceArtifactInspection = {
  artifact: ProvenanceArtifact;
  artifactPath: string;
  exists: boolean;
  currentHash: string | undefined;
};

export function protectedProvenanceArtifact(artifact: ProvenanceArtifact): boolean {
  const artifactPath = posixPath(artifact.path);
  return (
    !artifactPath.startsWith('source/') &&
    !artifactPath.startsWith('control/') &&
    !artifactPath.startsWith('.sec/') &&
    artifact.originType !== 'slot' &&
    artifactPath !== 'next-env.d.ts' &&
    artifactPath !== 'tsconfig.json'
  );
}

export async function inspectProvenanceArtifacts(
  projectRoot: string,
  artifacts: readonly ProvenanceArtifact[]
): Promise<ProvenanceArtifactInspection[]> {
  const limit = createConcurrencyLimit();
  return Promise.all(artifacts.map((artifact) => limit(async () => {
    const artifactPath = posixPath(artifact.path);
    const absolutePath = resolvePathInside(projectRoot, artifactPath);
    if (!absolutePath || !(await pathExists(absolutePath))) {
      return { artifact, artifactPath, exists: false, currentHash: undefined };
    }
    const currentHash = artifact.hash
      ? await calculateCanonicalProjectFileHash(absolutePath)
      : undefined;
    return { artifact, artifactPath, exists: true, currentHash };
  })));
}
