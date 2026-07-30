import path from 'node:path';
import { CompilerError } from '../../shared/errors.ts';
import { copyRecursive, listFilesRecursive, pathExists, type CommitFence } from '../../shared/fs.ts';

/**
 * Check if a layout file exists in the directory or any ancestor directory
 * up to the routes source root.
 */
async function hasLayoutInChain(dir: string, routesSourceDir: string): Promise<boolean> {
  const layoutExtensions = ['.tsx', '.ts', '.jsx', '.js'];
  let current = dir;

  while (true) {
    // 并行检查当前目录下所有 layout 扩展名，避免逐个串行 stat。
    const checks = await Promise.all(
      layoutExtensions.map((ext) => pathExists(path.join(current, `layout${ext}`)))
    );
    if (checks.some((exists) => exists)) {
      return true;
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

export async function mapCustomRoutes(
  workspaceRoot: string,
  projectRoot: string,
  commitFence?: CommitFence
): Promise<string[]> {
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

  const generatedPaths = new Set<string>();

  // 1. Copy all custom routes recursively + scan for route entrypoints in one traversal
  const sourceFiles = await listFilesRecursive(routesSourceDir);
  const pageExtensions = ['page.tsx', 'page.ts', 'page.jsx', 'page.js', 'route.ts', 'route.js'];
  const routeDirs = new Set<string>();

  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative(routesSourceDir, sourceFile);
    const targetFile = path.join(targetAppRoot, relativePath);

    await copyRecursive(sourceFile, targetFile, commitFence);

    const relativeToProject = path.relative(projectRoot, targetFile).split(path.sep).join('/');
    generatedPaths.add(relativeToProject);

    const filename = path.basename(sourceFile);
    if (pageExtensions.includes(filename)) {
      routeDirs.add(path.dirname(sourceFile));
    }
  }

  // 2. For each route directory, check layout and fallback/throw
  for (const routeDir of routeDirs) {
    const relativeDir = path.relative(routesSourceDir, routeDir);
    const targetRouteDir = path.join(targetAppRoot, relativeDir);

    const hasLayout = await hasLayoutInChain(routeDir, routesSourceDir);
    if (!hasLayout) {
      if (await pathExists(fallbackLayoutPath)) {
        const targetLayoutPath = path.join(targetRouteDir, 'layout.tsx');
        await copyRecursive(fallbackLayoutPath, targetLayoutPath, commitFence);

        const relativeLayoutToProject = path.relative(projectRoot, targetLayoutPath).split(path.sep).join('/');
        generatedPaths.add(relativeLayoutToProject);
      } else {
        throw new CompilerError(
          'SPEC-ROUTE-005',
          `Missing layout.tsx for custom route "${relativeDir || '/'}", and fallback dashboard-layout.tsx was not found at "${fallbackLayoutPath}".`
        );
      }
    }
  }

  return [...generatedPaths];
}
