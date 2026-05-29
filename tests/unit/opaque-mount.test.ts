import { expect, test, describe, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { installOpaqueModules } from '../../platform/compiler/compose/install-opaque-modules.ts';
import { readJson, writeJson, pathExists } from '../../platform/shared/fs.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';

describe('installOpaqueModules', () => {
  test('returns empty if opaque directory does not exist', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      // Ensure package.json exists
      const projectPackagePath = path.join(projectRoot, 'package.json');
      await writeJson(projectPackagePath, { dependencies: {} });

      const result = await installOpaqueModules(workspaceRoot, projectRoot);
      expect(result).toEqual([]);
    });
  });

  test('successfully links opaque modules in development mode', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, { dependencies: {} });

      // Create a test opaque module
      const moduleDir = path.join(sourceCodeRoot, 'opaque', 'test-mod');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), {
        id: 'test-mod',
        entry: 'index.ts',
      });
      await fs.writeFile(path.join(moduleDir, 'index.ts'), 'export const hello = "world";', 'utf8');

      // Set environment variables to simulate dev mode
      const oldNodeEnv = process.env.NODE_ENV;
      const oldSecBuild = process.env.SEC_BUILD_MODE;
      const oldBuild = process.env.BUILD_MODE;
      delete process.env.NODE_ENV;
      delete process.env.SEC_BUILD_MODE;
      delete process.env.BUILD_MODE;

      try {
        const result = await installOpaqueModules(workspaceRoot, projectRoot);
        expect(result).toEqual([]); // Dev mode returns no generated paths in project

        // Verify package.json updated
        const packageJson = await readJson<any>(projectPackagePath);
        expect(packageJson.dependencies['opaque-test-mod']).toBeDefined();
        expect(packageJson.dependencies['opaque-test-mod']).toContain('link:');
      } finally {
        process.env.NODE_ENV = oldNodeEnv;
        process.env.SEC_BUILD_MODE = oldSecBuild;
        process.env.BUILD_MODE = oldBuild;
      }
    });
  });

  test('successfully physically copies opaque modules in build mode', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, { dependencies: {} });

      // Create a test opaque module
      const moduleDir = path.join(sourceCodeRoot, 'opaque', 'test-mod');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), {
        id: 'test-mod',
        entry: 'index.ts',
      });
      await fs.writeFile(path.join(moduleDir, 'index.ts'), 'export const hello = "world";', 'utf8');

      // Set environment variables to simulate build mode
      const oldSecBuild = process.env.SEC_BUILD_MODE;
      process.env.SEC_BUILD_MODE = 'true';

      try {
        const result = await installOpaqueModules(workspaceRoot, projectRoot);
        
        // Build mode returns generated paths
        expect(result).toContain('src/installed/opaque-test-mod/index.ts');
        expect(result).toContain('src/installed/opaque-test-mod/module.yaml');

        // Verify files copied
        const targetFile = path.join(projectRoot, 'src', 'installed', 'opaque-test-mod', 'index.ts');
        expect(await pathExists(targetFile)).toBe(true);

        // Verify package.json updated to point to the copied directory
        const packageJson = await readJson<any>(projectPackagePath);
        expect(packageJson.dependencies['opaque-test-mod']).toBe('link:src/installed/opaque-test-mod');
      } finally {
        process.env.SEC_BUILD_MODE = oldSecBuild;
      }
    });
  });

  test('cleans up stale opaque dependencies from package.json', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      
      // package.json starts with a stale dependency
      await writeJson(projectPackagePath, {
        dependencies: {
          'opaque-old-mod': 'link:../source/code/opaque/old-mod'
        }
      });

      // Scan empty opaque directory
      const result = await installOpaqueModules(workspaceRoot, projectRoot);
      expect(result).toEqual([]);

      // Verify package.json cleaned up the stale dependency
      const packageJson = await readJson<any>(projectPackagePath);
      expect(packageJson.dependencies['opaque-old-mod']).toBeUndefined();
    });
  });
});
