import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { emptyOverrideManifest, PROVENANCE_FORMAT_VERSION } from '../../semantic/provenance/contract/types.ts';
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from '../../toolchain/dependencies/spec.ts';
import { compilerRuntimeResources } from '../../toolchain/runtime.ts';
import {
  CI_ARTIFACT_FILES,
  fixedCiArtifactPaths,
  uniqueSortedCiArtifactPaths
} from '../../verification/ci-artifacts/contract/manifest.ts';
import { ensureDir, pathExists, writeJson, writeText, type CommitFence } from '../runtime/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../runtime/paths.ts';
import { writeYaml } from '../yaml.ts';

export const RUNTIME_DATABASE_TEMPLATE_PATH = path.join(
  compilerRuntimeResources.composeTemplates,
  'lib',
  'database.ts.template'
);

function childDirectories(root: string, relativePaths: readonly string[]): string[] {
  return relativePaths.map((relativePath) => path.join(root, relativePath));
}

function artifactParentDirectories(root: string): string[] {
  const relativeParents = uniqueSortedCiArtifactPaths(
    fixedCiArtifactPaths().map((artifactPath) => path.posix.dirname(artifactPath))
  );
  return childDirectories(root, relativeParents);
}

export async function ensureProjectBase(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  const {
    workspaceRoot: root,
    modelRoot,
    modelBlocksRoot,
    privateRegistryRoot,
    policiesRoot,
    overridesRoot,
    srcRoot,
    testsRoot,
    packageJsonPath,
    tsconfigPath,
    prismaRoot,
    secRoot,
    artifactsRoot,
    cacheRoot,
    workspaceWriteLeaseRoot
  } = getWorkspacePaths(workspaceRoot);
  const runtimeRoot = path.join(srcRoot, 'runtime');
  const installedRoot = path.join(srcRoot, 'installed');
  const testUnitRoot = path.join(testsRoot, 'unit');
  const runtimeTestUnitRoot = path.join(testsRoot, 'runtime', 'unit');
  const overrideDirs = childDirectories(overridesRoot, ['rules', 'patches', 'manifests']);
  const provenancePath = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.provenance);
  const artifactParents = artifactParentDirectories(root);
  const policySpecPath = path.join(policiesRoot, 'policy.spec.yaml');
  const overrideManifestPath = path.join(overridesRoot, 'override-manifest.yaml');

  for (const directory of [
    root,
    modelRoot,
    modelBlocksRoot,
    privateRegistryRoot,
    policiesRoot,
    overridesRoot,
    ...overrideDirs,
    srcRoot,
    runtimeRoot,
    installedRoot,
    testsRoot,
    testUnitRoot,
    runtimeTestUnitRoot,
    prismaRoot,
    secRoot,
    artifactsRoot,
    ...artifactParents,
    cacheRoot,
    workspaceWriteLeaseRoot
  ]) {
    await ensureDir(directory, commitFence);
  }

  for (const directory of [
    modelBlocksRoot,
    privateRegistryRoot,
    ...overrideDirs,
    installedRoot,
    testUnitRoot,
    runtimeTestUnitRoot
  ]) {
    await writeText(path.join(directory, '.gitkeep'), '\n', commitFence);
  }

  const runtimeDependencySpec = await loadRuntimeDependencySpec();
  await writeJson(packageJsonPath, {
    ...buildRuntimePackageManifest('generated-customer-admin', runtimeDependencySpec),
    scripts: {
      'test:fast': 'node --test --experimental-test-isolation=none',
      'test:unit': 'bun test tests/runtime/unit',
      'verify:runtime:full': 'bun run test:unit',
      'verify:runtime': 'bun run verify:runtime:full',
      test: 'bun run test:fast && bun run test:unit'
    }
  }, commitFence);

  await writeJson(tsconfigPath, {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      resolveJsonModule: true,
      incremental: true,
      types: ['node', 'bun'],
      lib: ['ES2022'],
      skipLibCheck: true,
      plugins: []
    },
    include: [
      'src/**/*.ts',
      'tests/**/*.ts',
      'bunfig.toml'
    ],
    exclude: ['node_modules']
  }, commitFence);

  await writeText(
    path.join(root, 'bunfig.toml'),
    `[test]\n`,
    commitFence
  );
  await writeText(
    path.join(runtimeRoot, 'database.ts'),
    await readFile(RUNTIME_DATABASE_TEMPLATE_PATH, 'utf8'),
    commitFence
  );

  const prismaSchemaPath = path.join(prismaRoot, 'schema.prisma');
  if (!(await pathExists(prismaSchemaPath))) {
    await writeText(
      prismaSchemaPath,
      `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
`,
      commitFence
    );
  }

  if (!(await pathExists(policySpecPath))) {
    await writeYaml(policySpecPath, {
      policies: []
    }, commitFence);
  }

  if (!(await pathExists(provenancePath))) {
    await writeJson(provenancePath, {
      formatVersion: PROVENANCE_FORMAT_VERSION,
      artifacts: []
    }, commitFence);
  }

  if (!(await pathExists(overrideManifestPath))) {
    await writeYaml(overrideManifestPath, emptyOverrideManifest(), commitFence);
  }

}
