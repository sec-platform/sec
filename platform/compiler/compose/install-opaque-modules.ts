import { globby } from 'globby';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
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

  const moduleEntries: { id: string; dirPath: string; absolutePath: string }[] = [];

  for (const yamlFile of yamlFiles) {
    try {
      const parsed = await readYamlWithSchema(yamlFile, opaqueModuleSchema);
      moduleEntries.push({
        id: parsed.id,
        dirPath: path.dirname(yamlFile),
        absolutePath: yamlFile,
      });
    } catch (err) {
      defaultLogger.warn('Failed to process opaque module yaml', { yamlFile, error: err });
    }
  }

  // Clean up any stale opaque dependencies from package.json
  const activeOpaqueKeys = new Set(moduleEntries.map(e => `opaque-${e.id}`));
  let packageJsonChanged = false;
  for (const depKey of Object.keys(packageJson.dependencies)) {
    if (depKey.startsWith('opaque-') && !activeOpaqueKeys.has(depKey)) {
      delete packageJson.dependencies[depKey];
      packageJsonChanged = true;
      // Also clean up any node_modules links if they exist
      const nodeModulesPath = path.join(projectRoot, 'node_modules');
      const targetNodeModulesDepPath = path.join(nodeModulesPath, depKey);
      if (await pathExists(targetNodeModulesDepPath)) {
        await commitFence?.();
        await fs.rm(targetNodeModulesDepPath, { recursive: true, force: true });
      }
    }
  }

  if (moduleEntries.length === 0) {
    if (packageJsonChanged) {
      await writeJson(projectPackagePath, packageJson, commitFence);
    }
    return [];
  }

  // Differentiate development vs build mode
  const isBuildMode = resolveBuildMode(options);
  const generatedPaths: string[] = [];

  for (const entry of moduleEntries) {
    const depKey = `opaque-${entry.id}`;
    
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
  }

  // Save project package.json
  await writeJson(projectPackagePath, packageJson, commitFence);

  return generatedPaths;
}
