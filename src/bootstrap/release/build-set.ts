import path from 'node:path';

import { buildReleaseSet } from '../../adapters/release/release-set.ts';
import { compilerRuntimeLayout } from '../../adapters/toolchain/runtime.ts';
import { executeReleaseBuild } from '../../application/release-build.ts';
import { runReleaseBuildProcess } from '../../entry/release-build.ts';

const repositorySourceRoot = compilerRuntimeLayout.repositorySourceRoot;
if (repositorySourceRoot === null) {
  throw new Error('Release set build requires the SEC repository source layout');
}
const destinationRoot = path.resolve(
  repositorySourceRoot,
  process.argv[2] ?? '.tmp/release-set'
);

await runReleaseBuildProcess({
  execute: () => executeReleaseBuild(
    () => buildReleaseSet(repositorySourceRoot, destinationRoot)
  )
});
