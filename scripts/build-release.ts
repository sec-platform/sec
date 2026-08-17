import path from 'node:path';

import { buildReleaseArtifactV1 } from '../platform/release/release-artifact.ts';
import {
  compilerRuntimeLayout,
  RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH
} from '../platform/shared/runtime-layout.ts';

async function main(): Promise<void> {
  const repositorySourceRoot = compilerRuntimeLayout.repositorySourceRoot;
  if (repositorySourceRoot === null) {
    throw new Error('Release build requires the SEC repository source layout');
  }
  const destinationRoot = path.join(
    compilerRuntimeLayout.packageRoot,
    RELEASE_RUNTIME_ASSET_ROOT_RELATIVE_PATH
  );
  const receipt = await buildReleaseArtifactV1(repositorySourceRoot, destinationRoot);
  console.log([
    'Release artifact accepted',
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
