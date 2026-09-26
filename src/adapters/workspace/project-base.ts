import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CI_ARTIFACT_FILES,
  fixedCiArtifactPaths,
  uniqueSortedCiArtifactPaths
} from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { emptyOverrideManifest, PROVENANCE_FORMAT_VERSION } from '../../semantics/provenance/types.ts';
import { ensureDir, pathExists, writeJson, writeText } from "../filesystem/files.ts";
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from '../toolchain/dependencies/contract/runtime-dependency-spec.ts';
import { compilerRuntimeResources } from '../toolchain/runtime/layout.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../workspace-context.ts";
import { writeYaml } from './yaml.ts';

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

/**
 * Materialize the fixed CI artifact namespace before any publisher retains an
 * existing parent. The manifest remains the only path registry; workspace
 * templates and fixtures consume this operation instead of reproducing its
 * directory set.
 */
export async function ensureCanonicalWorkspaceArtifactParents(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  const root = getWorkspacePaths(workspaceRoot).workspaceRoot;
  for (const directory of artifactParentDirectories(root)) {
    await ensureDir(directory, commitFence);
  }
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
    cacheRoot,
    workspaceWriteLeaseRoot
  ]) {
    await ensureDir(directory, commitFence);
  }
  await ensureCanonicalWorkspaceArtifactParents(root, commitFence);

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
      'test:host': 'node --test --experimental-test-isolation=none',
      'test:unit': 'bun test tests/runtime/unit',
      'verify:runtime': 'bun run test:unit',
      test: 'bun run test:host && bun run test:unit'
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
