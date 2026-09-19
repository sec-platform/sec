import { compilerRuntimeLayout } from '../../adapters/toolchain/runtime.ts';
import { buildReleaseArtifact } from '../../adapters/release/release-artifact.ts';

async function main(): Promise<void> {
  const repositorySourceRoot = compilerRuntimeLayout.repositorySourceRoot;
  if (repositorySourceRoot === null) {
    throw new Error('Release build requires the SEC repository source layout');
  }
  const destinationRoot = compilerRuntimeLayout.artifactRoot;
  const receipt = await buildReleaseArtifact(repositorySourceRoot, destinationRoot);

  for (const finding of receipt.cleanupFindings) {
    console.error([
      'Release cleanup finding',
      `phase=${finding.phase}`,
      `state=${finding.state}`,
      `path=${finding.path}`,
      `detail=${finding.detail}`
    ].join(' '));
  }
  if (receipt.cleanupFindings.length > 0) {
    throw new Error([
      'Release artifact publication is readable but the build operation did not settle cleanup',
      `sourceCommit=${receipt.sourceCommit}`,
      `sourceTree=${receipt.sourceTree}`,
      `manifestDigest=${receipt.manifestDigest}`,
      `cleanupFindings=${receipt.cleanupFindings.length}`
    ].join(' '));
  }

  console.log([
    'Release artifact accepted and cleanup settled',
    `publicationStatus=${receipt.publicationStatus}`,
    `sourceCommit=${receipt.sourceCommit}`,
    `sourceTree=${receipt.sourceTree}`,
    `manifestDigest=${receipt.manifestDigest}`,
    `fileCount=${receipt.fileCount}`
  ].join(' '));
}

main().catch((error) => {
  console.error('Release artifact build failed:', error);
  process.exitCode = 1;
});
