import { globby } from 'globby';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createConcurrencyLimit } from '../../shared/concurrency.ts';
import { copyRecursive, pathExists, readJson, removeDir, writeJson, type CommitFence } from '../../shared/fs.ts';
import { defaultLogger } from '../../shared/logger.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { readYamlWithSchema } from '../../shared/yaml.ts';

const opaqueModuleSchema = z.object({
  id: z.string(),
  entry: z.string(),
}).passthrough();

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

export async function installOpaqueModules(
  workspaceRoot: string,
  projectRoot: string,
  options?: InstallOpaqueModulesOptions,
): Promise<string[]> {
  const { sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
  const commitFence = options?.commitFence;
  const opaqueRoot = path.join(sourceCodeRoot, 'opaque');

  // Load project package.json
  const packageJson = await readJson<any>(projectPackagePath);
  if (!packageJson.dependencies) {
    packageJson.dependencies = {};
  }

  // Scan all module.yaml
  const yamlFiles = (await pathExists(opaqueRoot))
    ? await globby('**/module.yaml', { cwd: opaqueRoot, absolute: true })
    : [];

  const limit = createConcurrencyLimit(8);
  const moduleEntryResults = await Promise.all(
    yamlFiles.map((yamlFile) =>
      limit(async () => {
        try {
          const parsed = await readYamlWithSchema(yamlFile, opaqueModuleSchema);
          return {
            id: parsed.id,
            dirPath: path.dirname(yamlFile),
            absolutePath: yamlFile,
          };
        } catch (err) {
          defaultLogger.warn('Failed to process opaque module yaml', { yamlFile, error: err });
          return null;
        }
      })
    )
  );
  const moduleEntries = moduleEntryResults.filter(
    (entry): entry is { id: string; dirPath: string; absolutePath: string } => entry !== null
  );

  // Clean up any stale opaque dependencies from package.json
  const activeOpaqueKeys = new Set(moduleEntries.map(e => `opaque-${e.id}`));
  let packageJsonChanged = false;
  const staleDepKeys = Object.keys(packageJson.dependencies).filter(
    (depKey) => depKey.startsWith('opaque-') && !activeOpaqueKeys.has(depKey)
  );
  for (const depKey of staleDepKeys) {
    delete packageJson.dependencies[depKey];
    packageJsonChanged = true;
  }
  // 并行清理 stale node_modules 链接（不同模块互相独立）
  await Promise.all(
    staleDepKeys.map((depKey) =>
      limit(async () => {
        const targetNodeModulesDepPath = path.join(projectRoot, 'node_modules', depKey);
        if (await pathExists(targetNodeModulesDepPath)) {
          await commitFence?.();
          await fs.rm(targetNodeModulesDepPath, { recursive: true, force: true });
        }
      })
    )
  );

  if (moduleEntries.length === 0) {
    if (packageJsonChanged) {
      await writeJson(projectPackagePath, packageJson, commitFence);
    }
    return [];
  }

  // Differentiate development vs build mode
  const isBuildMode = resolveBuildMode(options);

  // 各模块的 copy/symlink 互相独立，可并行执行。
  // packageJson.dependencies[depKey] 写入不同 key，在 JS 单线程模型下无竞争。
  const moduleGeneratedPaths = await Promise.all(
    moduleEntries.map((entry) =>
      limit(() => installOpaqueModule(entry, projectRoot, isBuildMode, packageJson, commitFence))
    )
  );
  const generatedPaths = moduleGeneratedPaths.flat();

  // Save project package.json
  await writeJson(projectPackagePath, packageJson, commitFence);

  return generatedPaths;
}

/**
 * 安装单个 opaque 模块：build 模式做物理拷贝，dev 模式做符号链接。
 * 返回该模块产生的 generatedPaths（相对 projectRoot 的 posix 路径列表）。
 */
async function installOpaqueModule(
  entry: { id: string; dirPath: string; absolutePath: string },
  projectRoot: string,
  isBuildMode: boolean,
  packageJson: { dependencies: Record<string, string> },
  commitFence?: CommitFence
): Promise<string[]> {
  const depKey = `opaque-${entry.id}`;
  const generatedPaths: string[] = [];

  if (isBuildMode) {
    // Build mode: physical copy
    const targetDir = path.join(projectRoot, 'src', 'installed', depKey);

    // Clean target if exists
    if (await pathExists(targetDir)) {
      await removeDir(targetDir, commitFence);
    }

    // Copy source folder to target
    await copyRecursive(entry.dirPath, targetDir, commitFence);

    // Compute relative path for link in package.json
    const relativePath = path.relative(projectRoot, targetDir);
    const posixPath = relativePath.split(path.sep).join('/');
    packageJson.dependencies[depKey] = `link:${posixPath}`;

    // Add to generatedPaths (so they can be added to lock generated paths)
    const files = await globby('**/*', { cwd: targetDir, dot: false, onlyFiles: true });
    for (const file of files) {
      const fileRelative = path.relative(projectRoot, path.join(targetDir, file));
      generatedPaths.push(fileRelative.split(path.sep).join('/'));
    }

    // Remove node_modules link if it existed
    const targetNodeModulesDepPath = path.join(projectRoot, 'node_modules', depKey);
    if (await pathExists(targetNodeModulesDepPath)) {
      await commitFence?.();
      await fs.rm(targetNodeModulesDepPath, { recursive: true, force: true });
    }
  } else {
    // Development mode: symlink in package.json to the source folder
    const relativePath = path.relative(projectRoot, entry.dirPath);
    const posixPath = relativePath.split(path.sep).join('/');
    packageJson.dependencies[depKey] = `link:${posixPath}`;

    // To support junction-based node_modules, we can also link it directly under project/node_modules/opaque-<id> if project/node_modules exists
    const nodeModulesPath = path.join(projectRoot, 'node_modules');
    if (await pathExists(nodeModulesPath)) {
      const targetNodeModulesDepPath = path.join(nodeModulesPath, depKey);
      if (!(await pathExists(targetNodeModulesDepPath))) {
        await commitFence?.();
        await fs.symlink(entry.dirPath, targetNodeModulesDepPath, 'junction');
      }
    }
  }

  return generatedPaths;
}
