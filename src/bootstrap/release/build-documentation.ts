import path from 'node:path';

import { buildDocumentationArtifact } from '../../adapters/release/documentation-artifact.ts';
import { compilerRuntimeLayout } from '../../adapters/toolchain/runtime.ts';
import { executeReleaseBuild } from '../../application/release-build.ts';
import { runReleaseBuildProcess } from '../../entry/release-build.ts';

const repositorySourceRoot = compilerRuntimeLayout.repositorySourceRoot;
if (repositorySourceRoot === null) {
  throw new Error('Documentation release build requires the SEC repository source layout');
}
const destinationRoot = path.resolve(
  repositorySourceRoot,
  process.argv[2] ?? '.tmp/documentation-artifact'
);

await runReleaseBuildProcess({
  execute: () => executeReleaseBuild(
    () => buildDocumentationArtifact(repositorySourceRoot, destinationRoot)
  )
});
