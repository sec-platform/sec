import fs from 'node:fs/promises';
import path from 'node:path';

import { buildReleaseSet } from '../../adapters/release/release-set.ts';
import { compilerRuntimeLayout } from '../../adapters/toolchain/runtime.ts';
import { executeReleaseBuild } from '../../application/release-build.ts';
import { runReleaseBuildProcess } from '../../entry/release-build.ts';

const repositorySourceRoot = compilerRuntimeLayout.repositorySourceRoot;
if (repositorySourceRoot === null) {
  throw new Error('Release set build requires the SEC repository source layout');
}
const requestedDestination = process.argv[2];
const destinationRoot = path.resolve(
  repositorySourceRoot,
  requestedDestination ?? '.tmp/release-set'
);
if (requestedDestination === undefined) {
  const defaultParent = path.dirname(destinationRoot);
  try {
    await fs.mkdir(defaultParent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

await runReleaseBuildProcess({
  execute: () => executeReleaseBuild(
    () => buildReleaseSet(repositorySourceRoot, destinationRoot)
  )
});
