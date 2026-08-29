import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import YAML from 'yaml';
import { z } from 'zod';

import { canonicalEquals, compareCodeUnits } from '../../system-architecture/foundation/runtime/canonical.ts';
import { createConcurrencyLimit } from '../../system-architecture/foundation/runtime/concurrency.ts';
import { ensureDir, isFileNotFoundError, pathEntryExists, pathExists, writeJson, type CommitFence } from '../../workspace/files.ts';
import { getWorkspacePaths } from '../../workspace/paths.ts';
import { copyNoFollowDirectoryTreesBulk, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, relocateRetainedNoFollowDirectory, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8, readOptionalRetainedJson, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';

const OPAQUE_MODULE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const OPAQUE_SOURCE_INVENTORY_MAX_ENTRIES = 8192;
const OPAQUE_SOURCE_INVENTORY_MAX_BYTES = 268_435_456;
const OPAQUE_SOURCE_INVENTORY_TIMEOUT_MS = 5000;

// `entry` used to be required by this schema but had no production consumer.
// Keeping a ghost field would falsely advertise entry-point semantics, so the
// current module descriptor owns only the identity that is actually consumed.
const opaqueModuleSchema = z.object({
  id: z.string().regex(OPAQUE_MODULE_ID)
}).strict();

const projectPackageSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional()
}).passthrough();

interface OpaqueModuleEntry {
  readonly id: string;
  readonly dirPath: string;
  readonly absolutePath: string;
}

type OpaqueModuleTreeEntry = Readonly<{
  relativePath: string;
  kind: 'directory' | 'file';
  size: number | null;
  contentDigest: `sha256:${string}` | null;
}>;

export type InstallOpaqueModulesOptions = {
  buildMode?: boolean;
  commitFence?: CommitFence;
};

function resolveBuildMode(options?: InstallOpaqueModulesOptions): boolean {
  if (options?.buildMode !== undefined) return options.buildMode;
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.SEC_BUILD_MODE === 'true' ||
    process.env.BUILD_MODE === 'true'
  );
}

function inventoryOpaqueModuleYamlPaths(opaqueRoot: string): string[] {
  const presence = inspectExactNoFollowDirectoryPresence(opaqueRoot, 'Opaque module root');
  if (presence.state === 'absent') return [];
  const entries = scanNoFollowDirectoryTreeMetadata(presence.directory.target, {
    deadlineAtMs: performance.now() + OPAQUE_SOURCE_INVENTORY_TIMEOUT_MS,
    maximumEntries: OPAQUE_SOURCE_INVENTORY_MAX_ENTRIES
  });
  const linked = entries.find((entry) => entry.kind === 'link');
  if (linked) {
    throw new Error(`Opaque module source contains an unsupported link/reparse entry: ${linked.relativePath}`);
  }
  return entries
    .filter((entry) => entry.kind === 'file' && path.posix.basename(entry.relativePath) === 'module.yaml')
    .map((entry) => path.join(opaqueRoot, ...entry.relativePath.split('/')))
    .sort(compareCodeUnits);
}

function readOpaqueModuleDescriptor(yamlFile: string): OpaqueModuleEntry {
  const bytes = readOptionalRetainedOrdinaryFile(yamlFile, `Opaque module descriptor ${yamlFile}`);
  if (bytes === null) {
    throw new Error(`Opaque module descriptor disappeared after inventory: ${yamlFile}`);
  }
  const source = decodeExactUtf8(bytes, `Opaque module descriptor ${yamlFile}`);
  let parsed: unknown;
  try {
    parsed = YAML.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Opaque module descriptor is not valid YAML: ${yamlFile}`, { cause: error });
  }
  const result = opaqueModuleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Opaque module descriptor violates the exact schema: ${yamlFile}: ` +
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
    );
  }
  return Object.freeze({
    id: result.data.id,
    dirPath: path.dirname(yamlFile),
    absolutePath: yamlFile
  });
}

function loadOpaqueModuleEntries(opaqueRoot: string): OpaqueModuleEntry[] {
  const entries = inventoryOpaqueModuleYamlPaths(opaqueRoot)
    .map(readOpaqueModuleDescriptor);
  const byId = new Map<string, OpaqueModuleEntry>();
  for (const entry of entries) {
    const previous = byId.get(entry.id);
    if (previous) {
      throw new Error(
        `Opaque module id "${entry.id}" is declared more than once: ` +
        `${previous.absolutePath}, ${entry.absolutePath}`
      );
    }
    byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((left, right) => compareCodeUnits(left.id, right.id));
}

function readProjectPackage(projectPackagePath: string): z.output<typeof projectPackageSchema> {
  const raw = readOptionalRetainedJson<unknown>(projectPackagePath, 'Opaque project package manifest');
  if (raw === null) {
    throw new Error(`Project package manifest is missing: ${projectPackagePath}`);
  }
  const parsed = projectPackageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      'Project package manifest has invalid dependencies: ' +
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
    );
  }
  return parsed.data;
}

async function readEntryMetadata(targetPath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

async function assertOpaqueNodeModulesLink(targetPath: string, expectedSource: string): Promise<void> {
  const metadata = await readEntryMetadata(targetPath);
  if (metadata === null) {
    throw new Error(`Opaque node_modules link disappeared before readback: ${targetPath}`);
  }
  if (!metadata.isSymbolicLink()) {
    throw new Error(`Opaque node_modules entry is not the owned link shape: ${targetPath}`);
  }
  const [actual, expected] = await Promise.all([
    fs.realpath(targetPath),
    fs.realpath(expectedSource)
  ]);
  if (path.normalize(actual) !== path.normalize(expected)) {
    throw new Error(
      `Opaque node_modules link points at a different source: ${targetPath} -> ${actual}`
    );
  }
}

async function removeOpaqueNodeModulesLink(
  targetPath: string,
  commitFence?: CommitFence
): Promise<void> {
  const metadata = await readEntryMetadata(targetPath);
  if (metadata === null) return;
  if (!metadata.isSymbolicLink()) {
    throw new Error(
      `Refusing destructive opaque dependency cleanup for non-link node_modules entry: ${targetPath}`
    );
  }
  await commitFence?.();
  await fs.unlink(targetPath);
}

function assertNoUnownedStaleOpaqueDependencies(
  dependencies: Readonly<Record<string, string>>,
  activeOpaqueKeys: ReadonlySet<string>
): void {
  const ambiguous = Object.keys(dependencies)
    .filter((depKey) => depKey.startsWith('opaque-') && !activeOpaqueKeys.has(depKey))
    .sort(compareCodeUnits);
  if (ambiguous.length === 0) return;
  throw new Error(
    'Opaque dependency cleanup requires generated-state ownership proof before deleting stale-looking entries: ' +
    ambiguous.join(', ')
  );
}

function projectOpaqueDependencies(
  moduleEntries: readonly OpaqueModuleEntry[],
  projectRoot: string,
  isBuildMode: boolean,
  dependencies: Record<string, string>
): void {
  for (const entry of moduleEntries) {
    const depKey = `opaque-${entry.id}`;
    const targetPath = isBuildMode
      ? path.join(projectRoot, 'src', 'installed', depKey)
      : entry.dirPath;
    const relativePath = path.relative(projectRoot, targetPath).split(path.sep).join('/');
    dependencies[depKey] = `link:${relativePath}`;
  }
}

function opaqueModuleTree(rootPath: string, label: string): readonly OpaqueModuleTreeEntry[] {
  const root = inspectNoFollowDirectoryChain(rootPath, label).target;
  return Object.freeze(scanNoFollowDirectoryTreeInventory(root, {
    deadlineAtMs: performance.now() + OPAQUE_SOURCE_INVENTORY_TIMEOUT_MS,
    maximumEntries: OPAQUE_SOURCE_INVENTORY_MAX_ENTRIES,
    maximumBytes: OPAQUE_SOURCE_INVENTORY_MAX_BYTES
  }).map((entry) => {
    if (entry.kind === 'link') {
      throw new Error(`${label} contains an unsupported link/reparse entry: ${entry.relativePath}`);
    }
    return Object.freeze({
      relativePath: entry.relativePath,
      kind: entry.kind,
      size: entry.kind === 'file' ? entry.size : null,
      contentDigest: entry.kind === 'file' ? entry.contentDigest : null
    });
  }).sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)));
}

function assertExactOpaqueModuleTree(
  expected: readonly OpaqueModuleTreeEntry[],
  targetPath: string,
  label: string
): readonly OpaqueModuleTreeEntry[] {
  const observed = opaqueModuleTree(targetPath, label);
  if (!canonicalEquals(observed, expected)) {
    throw new Error(`${label} differs from the exact opaque module source snapshot`);
  }
  return observed;
}

function generatedOpaqueModulePaths(
  projectRoot: string,
  targetDir: string,
  tree: readonly OpaqueModuleTreeEntry[]
): string[] {
  return tree
    .filter((entry) => entry.kind === 'file' && !entry.relativePath.split('/').some((segment) => segment.startsWith('.')))
    .map((entry) => path.relative(projectRoot, path.join(targetDir, ...entry.relativePath.split('/'))).split(path.sep).join('/'));
}

export async function installOpaqueModules(
  workspaceRoot: string,
  projectRoot: string,
  options?: InstallOpaqueModulesOptions,
): Promise<string[]> {
  const { sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
  const commitFence = options?.commitFence;
  const opaqueRoot = path.join(sourceCodeRoot, 'opaque');

  const moduleEntries = loadOpaqueModuleEntries(opaqueRoot);
  const packageJson = readProjectPackage(projectPackagePath);
  packageJson.dependencies ??= {};

  const activeOpaqueKeys = new Set(moduleEntries.map((entry) => `opaque-${entry.id}`));
  assertNoUnownedStaleOpaqueDependencies(packageJson.dependencies, activeOpaqueKeys);

  if (moduleEntries.length === 0) return [];

  const isBuildMode = resolveBuildMode(options);
  // Dependency projection is one deterministic semantic write. Physical module
  // installation remains parallel but workers never share this mutable owner.
  projectOpaqueDependencies(moduleEntries, projectRoot, isBuildMode, packageJson.dependencies);

  const limit = createConcurrencyLimit(8);
  const moduleGeneratedPaths = await Promise.all(
    moduleEntries.map((entry) =>
      limit(() => installOpaqueModule(entry, projectRoot, isBuildMode, commitFence))
    )
  );
  const generatedPaths = moduleGeneratedPaths.flat();

  await writeJson(projectPackagePath, packageJson, commitFence);
  return generatedPaths;
}

async function installOpaqueModule(
  entry: OpaqueModuleEntry,
  projectRoot: string,
  isBuildMode: boolean,
  commitFence?: CommitFence
): Promise<string[]> {
  const depKey = `opaque-${entry.id}`;
  const generatedPaths: string[] = [];

  if (isBuildMode) {
    const targetDir = path.join(projectRoot, 'src', 'installed', depKey);
    const sourceTree = opaqueModuleTree(entry.dirPath, `Opaque module source ${entry.id}`);
    const existing = inspectExactNoFollowDirectoryPresence(targetDir, `Opaque build target ${entry.id}`);
    if (existing.state === 'present') {
      const targetTree = assertExactOpaqueModuleTree(
        sourceTree,
        targetDir,
        `Existing opaque build target ${entry.id}`
      );
      generatedPaths.push(...generatedOpaqueModulePaths(projectRoot, targetDir, targetTree));
      await removeOpaqueNodeModulesLink(path.join(projectRoot, 'node_modules', depKey), commitFence);
      return generatedPaths;
    }

    const installedRoot = path.dirname(targetDir);
    await ensureDir(installedRoot, commitFence);
    await commitFence?.();
    const stageRoot = path.join(installedRoot, `.sec-opaque-${entry.id}-stage-${randomUUID()}`);
    let published = false;
    try {
      await copyNoFollowDirectoryTreesBulk([{
        source: inspectNoFollowDirectoryChain(
          entry.dirPath,
          `Opaque module copy source ${entry.id}`
        ).target,
        target: stageRoot
      }], {
        assertCurrent: commitFence,
        maximumEntries: OPAQUE_SOURCE_INVENTORY_MAX_ENTRIES,
        maximumBytes: OPAQUE_SOURCE_INVENTORY_MAX_BYTES * 3,
        deadlineAtMs: performance.now() + OPAQUE_SOURCE_INVENTORY_TIMEOUT_MS
      });
      assertExactOpaqueModuleTree(sourceTree, stageRoot, `Staged opaque build target ${entry.id}`);
      await commitFence?.();
      if (!canonicalEquals(opaqueModuleTree(entry.dirPath, `Opaque module source revalidation ${entry.id}`), sourceTree)) {
        throw new Error(`Opaque module source ${entry.id} changed before publication`);
      }
      try {
        relocateRetainedNoFollowDirectory({
          directory: inspectNoFollowDirectoryChain(
            stageRoot,
            `Staged opaque build publication ${entry.id}`
          ).target,
          tombstoneName: path.basename(targetDir)
        });
        published = true;
      } catch (publicationError) {
        const concurrent = inspectExactNoFollowDirectoryPresence(
          targetDir,
          `Concurrent opaque build target ${entry.id}`
        );
        if (concurrent.state !== 'present') throw publicationError;
        assertExactOpaqueModuleTree(
          sourceTree,
          targetDir,
          `Concurrent opaque build target ${entry.id}`
        );
      }
      const targetTree = assertExactOpaqueModuleTree(
        sourceTree,
        targetDir,
        `Published opaque build target ${entry.id}`
      );
      generatedPaths.push(...generatedOpaqueModulePaths(projectRoot, targetDir, targetTree));
    } finally {
      if (!published && await pathEntryExists(stageRoot)) {
        await fs.rm(stageRoot, { recursive: true, force: false });
      }
    }

    await removeOpaqueNodeModulesLink(
      path.join(projectRoot, 'node_modules', depKey),
      commitFence
    );
  } else {
    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    if (await pathExists(nodeModulesPath)) {
      const targetNodeModulesDepPath = path.join(nodeModulesPath, depKey);
      if (!(await pathEntryExists(targetNodeModulesDepPath))) {
        await commitFence?.();
        await fs.symlink(entry.dirPath, targetNodeModulesDepPath, 'junction');
      }
      await assertOpaqueNodeModulesLink(targetNodeModulesDepPath, entry.dirPath);
    }
  }

  return generatedPaths;
}
