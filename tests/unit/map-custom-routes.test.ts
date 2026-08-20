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
      expect(await mapCustomRoutes(workspaceRoot, projectRoot)).toEqual([]);
    });
  });

  test('copies custom routes when a source layout exists in chain', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(path.join(projectRoot, 'app'));
      await ensureDir(path.join(routesSourceDir, 'admin', 'users'));
      await writeText(path.join(routesSourceDir, 'admin', 'layout.tsx'), 'export default function AdminLayout() {}');
      await writeText(path.join(routesSourceDir, 'admin', 'users', 'page.tsx'), 'export default function AdminUsersPage() {}');

      const result = await mapCustomRoutes(workspaceRoot, projectRoot);
      expect(result).toContain('app/admin/layout.tsx');
      expect(result).toContain('app/admin/users/page.tsx');
      expect(await readText(path.join(projectRoot, 'app', 'admin', 'users', 'page.tsx'))).toContain('AdminUsersPage');
    });
  });

  test('plans one fallback layout before route publication when source/target layout is absent', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      const layoutsDir = path.join(workspaceRoot, 'source', 'ui', 'layouts');
      await ensureDir(path.join(projectRoot, 'app'));
      await ensureDir(layoutsDir);
      await writeText(path.join(layoutsDir, 'dashboard-layout.tsx'), 'export default function FallbackLayout() {}');
      await ensureDir(path.join(routesSourceDir, 'settings'));
      await writeText(path.join(routesSourceDir, 'settings', 'page.tsx'), 'export default function SettingsPage() {}');

      const result = await mapCustomRoutes(workspaceRoot, projectRoot);
      expect(result).toContain('app/settings/page.tsx');
      expect(result).toContain('app/settings/layout.tsx');
      expect(await readText(path.join(projectRoot, 'app', 'settings', 'layout.tsx'))).toContain('FallbackLayout');
    });
  });

  test('missing fallback fails before publishing any planned route', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(path.join(projectRoot, 'app'));
      await ensureDir(path.join(routesSourceDir, 'settings'));
      await writeText(path.join(routesSourceDir, 'settings', 'page.tsx'), 'export default function SettingsPage() {}');

      await expect(mapCustomRoutes(workspaceRoot, projectRoot)).rejects.toMatchObject({
        code: 'SPEC-ROUTE-005'
      });
      expect(await pathExists(path.join(projectRoot, 'app', 'settings', 'page.tsx'))).toBe(false);
    });
  });

  test('different existing target bytes fail before any other route is published', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(path.join(routesSourceDir, 'alpha'));
      await ensureDir(path.join(routesSourceDir, 'zeta'));
      await writeText(path.join(routesSourceDir, 'layout.tsx'), 'export default function RootLayout() {}');
      await writeText(path.join(routesSourceDir, 'alpha', 'page.tsx'), 'export default function Alpha() {}');
      await writeText(path.join(routesSourceDir, 'zeta', 'page.tsx'), 'export default function Zeta() {}');

      const collidingTarget = path.join(projectRoot, 'app', 'zeta', 'page.tsx');
      await writeText(collidingTarget, 'export default function UserOwned() {}');

      await expect(mapCustomRoutes(workspaceRoot, projectRoot)).rejects.toMatchObject({
        code: 'SPEC-ROUTE-006'
      });
      expect(await pathExists(path.join(projectRoot, 'app', 'alpha', 'page.tsx'))).toBe(false);
      expect(await readText(collidingTarget)).toContain('UserOwned');
    });
  });

  test('byte-identical existing target is an idempotent no-op', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(path.join(routesSourceDir, 'same'));
      await writeText(path.join(routesSourceDir, 'layout.tsx'), 'export default function RootLayout() {}');
      const source = 'export default function Same() {}';
      await writeText(path.join(routesSourceDir, 'same', 'page.tsx'), source);
      await writeText(path.join(projectRoot, 'app', 'same', 'page.tsx'), source);

      const result = await mapCustomRoutes(workspaceRoot, projectRoot);
      expect(result).toContain('app/same/page.tsx');
      expect(await readText(path.join(projectRoot, 'app', 'same', 'page.tsx'))).toBe(source);
    });
  });

  test('source changes at a final publication fence leave the target set untouched', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(path.join(projectRoot, 'app'));
      await ensureDir(path.join(routesSourceDir, 'settings'));
      await writeText(path.join(routesSourceDir, 'layout.tsx'), 'export default function RootLayout() {}');
      const pagePath = path.join(routesSourceDir, 'settings', 'page.tsx');
      await writeText(pagePath, 'export default function Settings() {}');

      let fenceCalls = 0;
      await expect(mapCustomRoutes(workspaceRoot, projectRoot, async () => {
        fenceCalls += 1;
        if (fenceCalls === 2) await writeText(pagePath, 'external writer');
      })).rejects.toMatchObject({ code: 'SPEC-ROUTE-006' });

      expect(await pathExists(path.join(projectRoot, 'app', 'settings', 'page.tsx'))).toBe(false);
    });
  });

  test('multiple project app roots are ambiguous and fail closed', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
      await ensureDir(path.join(routesSourceDir, 'x'));
      await writeText(path.join(routesSourceDir, 'layout.tsx'), 'export default function RootLayout() {}');
      await writeText(path.join(routesSourceDir, 'x', 'page.tsx'), 'export default function X() {}');
      await ensureDir(path.join(projectRoot, 'src', 'app'));
      await ensureDir(path.join(projectRoot, 'app'));

      await expect(mapCustomRoutes(workspaceRoot, projectRoot)).rejects.toMatchObject({
        code: 'SPEC-ROUTE-006'
      });
    });
  });
});
