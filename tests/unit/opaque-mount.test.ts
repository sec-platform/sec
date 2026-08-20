import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installOpaqueModules } from '../../platform/compiler/compose/install-opaque-modules.ts';
import { pathExists, readJson, writeJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

describe('installOpaqueModules', () => {
  test('returns empty if opaque directory does not exist', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      await writeJson(path.join(projectRoot, 'package.json'), { dependencies: {} });

      expect(await installOpaqueModules(workspaceRoot, projectRoot)).toEqual([]);
    });
  });

  test('successfully links opaque modules in development mode', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, { dependencies: {} });

      const moduleDir = path.join(sourceCodeRoot, 'opaque', 'test-mod');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), { id: 'test-mod' });
      await fs.writeFile(path.join(moduleDir, 'index.ts'), 'export const hello = "world";', 'utf8');

      expect(await installOpaqueModules(workspaceRoot, projectRoot, { buildMode: false })).toEqual([]);

      const packageJson = await readJson<any>(projectPackagePath);
      expect(packageJson.dependencies['opaque-test-mod']).toBeDefined();
      expect(packageJson.dependencies['opaque-test-mod']).toContain('link:');
    });
  });

  test('successfully physically copies opaque modules in build mode', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, { dependencies: {} });

      const moduleDir = path.join(sourceCodeRoot, 'opaque', 'test-mod');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), { id: 'test-mod' });
      await fs.writeFile(path.join(moduleDir, 'index.ts'), 'export const hello = "world";', 'utf8');

      const result = await installOpaqueModules(workspaceRoot, projectRoot, { buildMode: true });
      const repeated = await installOpaqueModules(workspaceRoot, projectRoot, { buildMode: true });

      expect(result).toContain('src/installed/opaque-test-mod/index.ts');
      expect(result).toContain('src/installed/opaque-test-mod/module.yaml');
      expect(repeated).toEqual(result);
      expect(await pathExists(path.join(
        projectRoot,
        'src',
        'installed',
        'opaque-test-mod',
        'index.ts'
      ))).toBe(true);

      const packageJson = await readJson<any>(projectPackagePath);
      expect(packageJson.dependencies['opaque-test-mod']).toBe('link:src/installed/opaque-test-mod');
    });
  });

  test('build mode refuses to adopt a conflicting pre-existing target without ownership proof', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, { dependencies: {} });

      const moduleDir = path.join(sourceCodeRoot, 'opaque', 'test-mod');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), { id: 'test-mod' });
      await fs.writeFile(path.join(moduleDir, 'index.ts'), 'export const hello = "world";\n', 'utf8');

      const targetDir = path.join(projectRoot, 'src', 'installed', 'opaque-test-mod');
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, 'index.ts'), 'external bytes\n', 'utf8');

      await expect(installOpaqueModules(workspaceRoot, projectRoot, { buildMode: true }))
        .rejects.toThrow(/differs from the exact opaque module source snapshot/);
      expect(await fs.readFile(path.join(targetDir, 'index.ts'), 'utf8')).toBe('external bytes\n');
    });
  });

  test('writes dependency projection in canonical module order before parallel physical effects', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, { dependencies: { stable: '1.0.0' } });

      const slowModule = path.join(sourceCodeRoot, 'opaque', 'slow-source');
      await fs.mkdir(slowModule, { recursive: true });
      await writeYaml(path.join(slowModule, 'module.yaml'), { id: 'a-slow' });
      for (let index = 0; index < 64; index += 1) {
        await fs.writeFile(
          path.join(slowModule, `file-${String(index).padStart(2, '0')}.ts`),
          `export const value${index} = ${index};\n`,
          'utf8'
        );
      }

      const fastModule = path.join(sourceCodeRoot, 'opaque', 'fast-source');
      await fs.mkdir(fastModule, { recursive: true });
      await writeYaml(path.join(fastModule, 'module.yaml'), { id: 'z-fast' });
      await fs.writeFile(path.join(fastModule, 'index.ts'), 'export const fast = true;\n', 'utf8');

      await installOpaqueModules(workspaceRoot, projectRoot, { buildMode: true });

      const packageBytes = await fs.readFile(projectPackagePath, 'utf8');
      const slowDependencyOffset = packageBytes.indexOf('"opaque-a-slow"');
      const fastDependencyOffset = packageBytes.indexOf('"opaque-z-fast"');
      expect(slowDependencyOffset).toBeGreaterThan(-1);
      expect(fastDependencyOffset).toBeGreaterThan(-1);
      expect(slowDependencyOffset).toBeLessThan(fastDependencyOffset);
    });
  });

  test('does not treat an opaque-* package name as deletion ownership', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, {
        dependencies: {
          'opaque-old-mod': 'link:../source/code/opaque/old-mod'
        }
      });

      await expect(installOpaqueModules(workspaceRoot, projectRoot)).rejects.toThrow(
        /requires generated-state ownership proof/
      );

      const packageJson = await readJson<any>(projectPackagePath);
      expect(packageJson.dependencies['opaque-old-mod']).toBe(
        'link:../source/code/opaque/old-mod'
      );
    });
  });

  test('malformed module descriptor blocks before package dependency mutation', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, { dependencies: { stable: '1.0.0' } });
      const moduleDir = path.join(sourceCodeRoot, 'opaque', 'bad');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), {
        id: 'bad',
        entry: 'ghost-entry.ts'
      });

      await expect(installOpaqueModules(workspaceRoot, projectRoot)).rejects.toThrow(
        /violates the exact schema/
      );
      expect(await readJson<any>(projectPackagePath)).toEqual({ dependencies: { stable: '1.0.0' } });
    });
  });

  test('duplicate opaque module identities fail before parallel installation', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot, sourceCodeRoot, projectPackagePath } = getWorkspacePaths(workspaceRoot);
      await writeJson(projectPackagePath, { dependencies: {} });
      for (const directory of ['first', 'second']) {
        const moduleDir = path.join(sourceCodeRoot, 'opaque', directory);
        await fs.mkdir(moduleDir, { recursive: true });
        await writeYaml(path.join(moduleDir, 'module.yaml'), { id: 'same-module' });
      }

      await expect(installOpaqueModules(workspaceRoot, projectRoot)).rejects.toThrow(
        /declared more than once/
      );
    });
  });
});
