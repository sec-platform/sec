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

export interface WorkspaceTemplateFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  /** Requested ordinary POSIX bits; the kernel owns effective permissions. */
  readonly creationMode?: number;
  readonly onlyIfAbsent?: true;
}
export interface WorkspaceTemplateBlueprint {
  readonly directories: readonly string[];
  readonly files: readonly WorkspaceTemplateFile[];
}

/** The existing scaffold recipe also supplies the trusted create scope. Paths
 * and bytes are declared once; the live materializer retains if-absent rules. */
export async function buildProjectBaseTemplate(workspaceRoot: string): Promise<WorkspaceTemplateBlueprint> {
  const directories = new Set<string>();
  const files: WorkspaceTemplateFile[] = [];
  const rootPath = path.resolve(workspaceRoot);
  const relative = (filePath: string) => path.relative(rootPath, filePath).split(path.sep).join('/');
  const commitFence = undefined;
  const ensureDir = async (directory: string, _fence?: CommitFence) => {
    const name = relative(directory);
    if (name) directories.add(name);
  };
  const writeText = async (filePath: string, text: string, _fence?: CommitFence) => {
    files.push({ relativePath: relative(filePath), bytes: Buffer.from(text),
      ...(optionalFiles.has(filePath) ? { onlyIfAbsent: true as const } : {}) });
  };
  const writeJson = (filePath: string, value: unknown, fence?: CommitFence) => writeText(filePath, formatJsonFile(value), fence);
  const writeYaml = (filePath: string, value: unknown, fence?: CommitFence) => writeText(filePath, YAML.stringify(value, { indent: 2 }), fence);
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
  const prismaSchemaPath = path.join(prismaRoot, 'schema.prisma');
  const optionalFiles = new Set([prismaSchemaPath, policySpecPath, provenancePath, overrideManifestPath]);

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
  for (const directory of artifactParentDirectories(root)) await ensureDir(directory);

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

  {
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

  {
    await writeYaml(policySpecPath, {
      policies: []
    }, commitFence);
  }

  {
    await writeJson(provenancePath, {
      formatVersion: PROVENANCE_FORMAT_VERSION,
      artifacts: []
    }, commitFence);
  }

  {
    await writeYaml(overrideManifestPath, emptyOverrideManifest(), commitFence);
  }

  return { directories: [...directories], files };
}

export async function ensureProjectBase(workspaceRoot: string, commitFence?: CommitFence): Promise<void> {
  const root = path.resolve(workspaceRoot);
  const blueprint = await buildProjectBaseTemplate(root);
  for (const relative of blueprint.directories) await ensureDir(path.join(root, relative), commitFence);
  for (const file of blueprint.files) {
    const destination = path.join(root, file.relativePath);
    if (file.onlyIfAbsent && await pathExists(destination)) continue;
    await writeBuffer(destination, file.bytes, commitFence);
  }
}
