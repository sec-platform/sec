import path from 'node:path';
import fs from 'node:fs/promises';
import { copyRecursive, pathExists, listFilesRecursive } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';

/**
 * Check if a layout file exists in the directory or any ancestor directory
 * up to the routes source root.
 */
async function hasLayoutInChain(dir: string, routesSourceDir: string): Promise<boolean> {
  const layoutExtensions = ['.tsx', '.ts', '.jsx', '.js'];
  let current = dir;

  while (true) {
    for (const ext of layoutExtensions) {
      const layoutPath = path.join(current, `layout${ext}`);
      if (await pathExists(layoutPath)) {
        return true;
      }
    }

    if (current === routesSourceDir) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break; // reached filesystem root
    }
    current = parent;
  }

  return false;
}

export async function mapCustomRoutes(workspaceRoot: string, projectRoot: string): Promise<string[]> {
  const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
  const fallbackLayoutPath = path.join(workspaceRoot, 'source', 'ui', 'layouts', 'dashboard-layout.tsx');

  if (!(await pathExists(routesSourceDir))) {
    return [];
  }

  // Determine standard app directory in project
  let targetAppRoot = path.join(projectRoot, 'src', 'app');
  if (!(await pathExists(targetAppRoot))) {
    targetAppRoot = path.join(projectRoot, 'app');
  }

  const generatedPaths: string[] = [];

  // 1. Copy all custom routes recursively
  const sourceFiles = await listFilesRecursive(routesSourceDir);
  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(routesSourceDir, sourceFile);
    const targetFile = path.join(targetAppRoot, relativePath);

    await copyRecursive(sourceFile, targetFile);

    const relativeToProject = path.relative(projectRoot, targetFile).split(path.sep).join('/');
    generatedPaths.push(relativeToProject);
  }

  // 2. Scan for directories containing page or route entrypoints
  const pageExtensions = ['page.tsx', 'page.ts', 'page.jsx', 'page.js', 'route.ts', 'route.js'];
  const routeDirs = new Set<string>();

  for (const sourceFile of sourceFiles) {
    const filename = path.basename(sourceFile);
    if (pageExtensions.includes(filename)) {
      routeDirs.add(path.dirname(sourceFile));
    }
  }

  // 3. For each route directory, check layout and fallback/throw
  for (const routeDir of routeDirs) {
    const relativeDir = path.relative(routesSourceDir, routeDir);
    const targetRouteDir = path.join(targetAppRoot, relativeDir);

    const hasLayout = await hasLayoutInChain(routeDir, routesSourceDir);
    if (!hasLayout) {
      if (await pathExists(fallbackLayoutPath)) {
        const targetLayoutPath = path.join(targetRouteDir, 'layout.tsx');
        await copyRecursive(fallbackLayoutPath, targetLayoutPath);

        const relativeLayoutToProject = path.relative(projectRoot, targetLayoutPath).split(path.sep).join('/');
        if (!generatedPaths.includes(relativeLayoutToProject)) {
          generatedPaths.push(relativeLayoutToProject);
        }
      } else {
        throw new CompilerError(
          'SPEC-ROUTE-005',
          `Missing layout.tsx for custom route "${relativeDir || '/'}", and fallback dashboard-layout.tsx was not found at "${fallbackLayoutPath}".`
        );
      }
    }
  }

  return generatedPaths;
}
