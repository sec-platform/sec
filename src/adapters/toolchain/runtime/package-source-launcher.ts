import {
  assertCanonicalBunPackageRunner,
  readCanonicalBunRuntimeProjection
} from './bun-version.ts';
import { compilerRuntimeLayout } from './layout.ts';

const runtimeProjection = await readCanonicalBunRuntimeProjection(
  compilerRuntimeLayout.packageRoot
);
assertCanonicalBunPackageRunner(runtimeProjection.version);

await import('#gift/cli');
