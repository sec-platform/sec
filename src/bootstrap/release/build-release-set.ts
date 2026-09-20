import path from 'node:path';

import { buildReleaseSet } from '../../adapters/release/release-set.ts';
import { compilerRuntimeLayout } from '../../adapters/toolchain/runtime.ts';
import { executeReleaseBuild } from '../../application/release-build.ts';
import { runReleaseBuildProcess } from '../../entry/release-build.ts';

await runReleaseBuildProcess({
  execute: () => executeReleaseBuild(async () => {
    const repositorySourceRoot = compilerRuntimeLayout.repositorySourceRoot;
    if (repositorySourceRoot === null) {
      throw new Error('Release-set build requires the SEC repository source layout');
    }
    return buildReleaseSet(
      repositorySourceRoot,
      path.join(repositorySourceRoot, 'build', 'release-set')
    );
  })
});
