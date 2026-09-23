import { pathToFileURL } from 'node:url';

import {
  assertCanonicalBunPackageRunner,
  readCanonicalBunRuntimeProjection
} from './bun-version.ts';
import { compilerCliEntrypoint, compilerRuntimeLayout } from './layout.ts';

const runtimeProjection = await readCanonicalBunRuntimeProjection(
  compilerRuntimeLayout.packageRoot
);
assertCanonicalBunPackageRunner(runtimeProjection.version);

await import(pathToFileURL(compilerCliEntrypoint).href);
