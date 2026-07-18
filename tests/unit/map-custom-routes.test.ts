import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { mapCustomRoutes } from '../../platform/compiler/compose/map-custom-routes.ts';
import { CompilerError } from '../../platform/shared/errors.ts';
import { ensureDir, pathExists, readText, writeText } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

describe('mapCustomRoutes', () => {
  test('returns empty if source/ui/routes does not exist', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const result = await mapCustomRoutes(workspaceRoot, projectRoot);
      expect(result).toEqual([]);
    });
  });

  test('successfully copies custom routes when layout exists in chain', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);

      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(routesSourceDir);

      // Create a page and a layout
      await ensureDir(path.join(routesSourceDir, 'admin', 'users'));
      await writeText(path.join(routesSourceDir, 'admin', 'layout.tsx'), 'export default function AdminLayout() {}');
      await writeText(path.join(routesSourceDir, 'admin', 'users', 'page.tsx'), 'export default function AdminUsersPage() {}');

      const result = await mapCustomRoutes(workspaceRoot, projectRoot);

      expect(result).toContain('app/admin/layout.tsx');
      expect(result).toContain('app/admin/users/page.tsx');

      // Verify copied files
      const targetPagePath = path.join(projectRoot, 'app', 'admin', 'users', 'page.tsx');
      const targetLayoutPath = path.join(projectRoot, 'app', 'admin', 'layout.tsx');

      expect(await pathExists(targetPagePath)).toBe(true);
      expect(await pathExists(targetLayoutPath)).toBe(true);
      expect(await readText(targetPagePath)).toContain('AdminUsersPage');
    });
  });

  test('falls back to dashboard-layout.tsx if layout is missing in chain and dashboard-layout exists', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);

      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(routesSourceDir);

      const layoutsDir = path.join(workspaceRoot, 'source', 'ui', 'layouts');
      await ensureDir(layoutsDir);

      // Create a page and global layout
      await writeText(path.join(layoutsDir, 'dashboard-layout.tsx'), 'export default function FallbackLayout() {}');
      await ensureDir(path.join(routesSourceDir, 'settings'));
      await writeText(path.join(routesSourceDir, 'settings', 'page.tsx'), 'export default function SettingsPage() {}');

      const result = await mapCustomRoutes(workspaceRoot, projectRoot);

      expect(result).toContain('app/settings/page.tsx');
      expect(result).toContain('app/settings/layout.tsx');

      const targetLayoutPath = path.join(projectRoot, 'app', 'settings', 'layout.tsx');
      expect(await pathExists(targetLayoutPath)).toBe(true);
      expect(await readText(targetLayoutPath)).toContain('FallbackLayout');
    });
  });

  test('throws SPEC-ROUTE-005 if layout is missing in chain and fallback layout does not exist', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);

      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(routesSourceDir);

      // Create a page but no layout and no fallback
      await ensureDir(path.join(routesSourceDir, 'settings'));
      await writeText(path.join(routesSourceDir, 'settings', 'page.tsx'), 'export default function SettingsPage() {}');

      let error: any;
      try {
        await mapCustomRoutes(workspaceRoot, projectRoot);
      } catch (e: any) {
        error = e;
      }

      expect(error).toBeInstanceOf(CompilerError);
      expect(error.code).toBe('SPEC-ROUTE-005');
      expect(error.message).toContain('Missing layout.tsx for custom route');
    });
  });
});
