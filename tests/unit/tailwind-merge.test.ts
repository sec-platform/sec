import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeTailwindTheme } from '../../platform/compiler/compose/merge-tailwind-theme.ts';
import { pathExists, readText, writeJson, writeText } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

describe('mergeTailwindTheme', () => {
  test('returns empty if extend json and custom css do not exist', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      expect(await mergeTailwindTheme(workspaceRoot, projectRoot)).toEqual([]);
    });
  });

  test('merges deterministic config and replaces one managed CSS section idempotently', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot } = getWorkspacePaths(workspaceRoot);
      const themeDir = path.join(sourceCodeRoot, 'assets', 'theme');
      await fs.mkdir(themeDir, { recursive: true });
      await writeJson(path.join(themeDir, 'tailwind.config.extend.json'), {
        colors: { brand: '#1d6f5f', nested: { deep: 'blue' } }
      });
      await writeText(path.join(themeDir, 'globals.css'), '.custom-class { color: red; }');

      const targetCssPath = path.join(projectRoot, 'app', 'globals.css');
      await writeText(targetCssPath, 'body { margin: 0; }');

      const first = await mergeTailwindTheme(workspaceRoot, projectRoot);
      expect(first).toContain('tailwind.config.ts');
      expect(first).toContain('app/globals.css');
      const firstCss = await readText(targetCssPath);
      const firstConfig = await readText(path.join(projectRoot, 'tailwind.config.ts'));
      expect(firstConfig).toContain('"brand": "#1d6f5f"');
      expect(firstConfig).toContain('"deep": "blue"');
      expect(firstCss.match(/SEC BEGIN source\/assets\/theme\/globals\.css/g)).toHaveLength(1);

      await mergeTailwindTheme(workspaceRoot, projectRoot);
      expect(await readText(targetCssPath)).toBe(firstCss);
      expect(await readText(path.join(projectRoot, 'tailwind.config.ts'))).toBe(firstConfig);
      expect(await pathExists(path.join(projectRoot, 'tailwind.config.ts'))).toBe(true);
    });
  });

  test('refuses to replace dynamic theme or extend expressions with structural JSON', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot } = getWorkspacePaths(workspaceRoot);
      const themeDir = path.join(sourceCodeRoot, 'assets', 'theme');
      await fs.mkdir(themeDir, { recursive: true });
      await writeJson(path.join(themeDir, 'tailwind.config.extend.json'), { colors: { brand: 'red' } });
      await writeText(path.join(projectRoot, 'tailwind.config.ts'), `
const sharedTheme = getTheme();
const config = { theme: sharedTheme };
export default config;
`);

      await expect(mergeTailwindTheme(workspaceRoot, projectRoot)).rejects.toThrow(/dynamic\/non-object/);
    });
  });
});
