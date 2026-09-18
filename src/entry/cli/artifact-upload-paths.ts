import type { ArtifactUploadPathContract } from '../../application/artifact-upload-paths.ts';

export function formatArtifactUploadPaths(contract: Readonly<Pick<ArtifactUploadPathContract, 'paths'>>): string {
  return contract.paths.join('\n');
}
