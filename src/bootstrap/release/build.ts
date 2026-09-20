import { compilerRuntimeLayout } from '../../adapters/toolchain/runtime.ts';
import { buildReleaseArtifact } from '../../adapters/release/release-artifact.ts';
import { executeReleaseBuild } from '../../application/release-build.ts';
import { runReleaseBuildProcess } from '../../entry/release-build.ts';

await runReleaseBuildProcess({
  execute: () => executeReleaseBuild(async () => {
    const repositorySourceRoot = compilerRuntimeLayout.repositorySourceRoot;
    if (repositorySourceRoot === null) {
      throw new Error('Release build requires the SEC repository source layout');
    }
    return buildReleaseArtifact(repositorySourceRoot, compilerRuntimeLayout.artifactRoot);
  })
});
