import { expect, test, describe } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { mergeTailwindTheme } from '../../platform/compiler/compose/merge-tailwind-theme.ts';
import { readJson, writeJson, pathExists, readText, writeText } from '../../platform/shared/fs.ts';

describe('mergeTailwindTheme', () => {
  test('returns empty if extend json and custom css do not exist', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const result = await mergeTailwindTheme(workspaceRoot, projectRoot);
      expect(result).toEqual([]);
    });
  });

  test('successfully merges tailwind config and appends css', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot } = getWorkspacePaths(workspaceRoot);

      // Create theme files
      const themeDir = path.join(sourceCodeRoot, 'assets', 'theme');
      await fs.mkdir(themeDir, { recursive: true });

      const extendJson = {
        colors: {
          brand: '#1d6f5f',
          nested: {
            deep: 'blue'
          }
        }
      };
      await writeJson(path.join(themeDir, 'tailwind.config.extend.json'), extendJson);
      await writeText(path.join(themeDir, 'globals.css'), '.custom-class { color: red; }');

      // Create base project files
      const targetCssPath = path.join(projectRoot, 'app', 'globals.css');
      await writeText(targetCssPath, 'body { margin: 0; }');

      const result = await mergeTailwindTheme(workspaceRoot, projectRoot);

      expect(result).toContain('tailwind.config.ts');
      expect(result).toContain('app/globals.css');

      // Check tailwind.config.ts merge
      const configPath = path.join(projectRoot, 'tailwind.config.ts');
      expect(await pathExists(configPath)).toBe(true);

      const configText = await readText(configPath);
      expect(configText).toContain('"brand": "#1d6f5f"');
      expect(configText).toContain('"deep": "blue"');

      // Check CSS append
      const cssText = await readText(targetCssPath);
      expect(cssText).toContain('body { margin: 0; }');
      expect(cssText).toContain('.custom-class { color: red; }');
    });
  });
});
