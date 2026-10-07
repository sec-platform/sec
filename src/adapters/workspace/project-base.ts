import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  CI_ARTIFACT_FILES,
  fixedCiArtifactPaths,
  uniqueSortedCiArtifactPaths
} from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { formatJsonFile } from '../../contracts/json-text.ts';
import { emptyOverrideManifest, PROVENANCE_FORMAT_VERSION } from '../../semantics/provenance/types.ts';
import { ensureDir, pathExists, writeBuffer } from "../filesystem/files.ts";
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from '../toolchain/dependencies/contract/runtime-dependency-spec.ts';
import { compilerRuntimeResources } from '../toolchain/runtime/layout.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../workspace-context.ts";
import type { WorkspaceCreateFile, WorkspaceCreateMaterial } from './create-publication.ts';

export const RUNTIME_DATABASE_TEMPLATE_PATH = path.join(
  compilerRuntimeResources.composeTemplates,
  'lib',
  'database.ts.template'
);

function childDirectories(root: string, relativePaths: readonly string[]): string[] {
  return relativePaths.map((relativePath) => path.join(root, relativePath));
}

export function artifactParentDirectories(root: string): string[] {
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

export async function buildProjectBaseTemplate(workspaceRoot: string): Promise<WorkspaceCreateMaterial> {
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

  const directories = [
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
  ];
  directories.push(...artifactParentDirectories(root));
  const relative = (name: string) => path.relative(root, name).split(path.sep).join('/');
  const files: WorkspaceCreateFile[] = [];
  const text = (name: string, value: string, onlyIfAbsent?: true) => {
    files.push({ relativePath: relative(name), bytes: Buffer.from(value), ...(onlyIfAbsent ? { onlyIfAbsent } : {}) });
  };
  const json = (name: string, value: unknown, onlyIfAbsent?: true) => text(name, formatJsonFile(value), onlyIfAbsent);
  const yaml = (name: string, value: unknown, onlyIfAbsent?: true) => text(name, YAML.stringify(value, { indent: 2 }), onlyIfAbsent);

  for (const directory of [
    modelBlocksRoot,
    privateRegistryRoot,
    ...overrideDirs,
    installedRoot,
    testUnitRoot,
    runtimeTestUnitRoot
  ]) {
    text(path.join(directory, '.gitkeep'), '\n');
  }

  const runtimeDependencySpec = await loadRuntimeDependencySpec();
  json(packageJsonPath, {
    ...buildRuntimePackageManifest('generated-customer-admin', runtimeDependencySpec),
    scripts: {
      'test:fast': 'bun test tests/fast.test.ts',
      'test:unit': 'bun test tests/runtime/unit',
      'verify:runtime:full': 'bun run test:unit',
      'verify:runtime': 'bun run verify:runtime:full',
      test: 'bun run test:fast && bun run test:unit'
    }
  });

  json(tsconfigPath, {
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
  });

  text(
    path.join(root, 'bunfig.toml'),
    `[test]\n`,
  );
  text(
    path.join(runtimeRoot, 'database.ts'),
    await readFile(RUNTIME_DATABASE_TEMPLATE_PATH, 'utf8'),
  );

  text(path.join(prismaRoot, 'schema.prisma'), `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
`, true);
  yaml(policySpecPath, { policies: [] }, true);
  json(provenancePath, { formatVersion: PROVENANCE_FORMAT_VERSION, artifacts: [] }, true);
  yaml(overrideManifestPath, emptyOverrideManifest(), true);

  return { directories: directories.map(relative), files };
}

export async function ensureProjectBase(workspaceRoot: string, commitFence?: CommitFence): Promise<void> {
  const root = path.resolve(workspaceRoot);
  const material = await buildProjectBaseTemplate(root);
  for (const relative of material.directories) await ensureDir(path.join(root, relative), commitFence);
  for (const file of material.files) {
    const destination = path.join(root, file.relativePath);
    if (file.onlyIfAbsent && await pathExists(destination)) continue;
    await writeBuffer(destination, file.bytes, commitFence);
  }
}
