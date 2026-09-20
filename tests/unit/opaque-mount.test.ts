import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installOpaqueModules } from '../../src/adapters/compilation/compose/install-opaque-modules.ts';
import { resolveOpaqueModuleMaterializationMode } from '../../src/compiler/target-materialization.ts';
import { pathExists, readJson, writeJson } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { writeYaml } from '../../src/adapters/workspace/yaml.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

describe('resolveOpaqueModuleMaterializationMode', () => {
  test('defaults to workspace linking when no source makes a build decision', () => {
    expect(resolveOpaqueModuleMaterializationMode(undefined, {})).toBe('workspace-link');
  });

  test('admits each retained legacy build source through one canonical resolver', () => {
    expect(resolveOpaqueModuleMaterializationMode(undefined, { NODE_ENV: 'production' }))
      .toBe('build-copy');
    expect(resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: 'true' }))
      .toBe('build-copy');
    expect(resolveOpaqueModuleMaterializationMode(undefined, { BUILD_MODE: 'true' }))
      .toBe('build-copy');
    expect(resolveOpaqueModuleMaterializationMode(undefined, { SEC_BUILD_MODE: 'false' }))
      .toBe('workspace-link');
  });

  test('explicit typed input owns the decision over legacy environment candidates', () => {
    expect(resolveOpaqueModuleMaterializationMode('workspace-link', {
      NODE_ENV: 'production',
      SEC_BUILD_MODE: 'true',
      BUILD_MODE: 'true'
    })).toBe('workspace-link');
  });

  test('conflicting legacy candidates fail closed instead of being combined with boolean OR', () => {
    expect(() => resolveOpaqueModuleMaterializationMode(undefined, {
      NODE_ENV: 'production',
      SEC_BUILD_MODE: 'false'
    })).toThrow(/materialization inputs conflict/);
  });

  test('invalid legacy boolean syntax is rejected instead of silently becoming false', () => {
    expect(() => resolveOpaqueModuleMaterializationMode(undefined, {
      SEC_BUILD_MODE: '1'
    })).toThrow(/must be exactly "true" or "false"/);
  });
});

describe('installOpaqueModules', () => {
  test('returns empty if opaque directory does not exist', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { packageJsonPath } = getWorkspacePaths(workspaceRoot);
      await writeJson(packageJsonPath, { dependencies: {} });

      expect(await installOpaqueModules(workspaceRoot, {
        materializationMode: 'workspace-link'
      })).toEqual([]);
    });
  });

  test('successfully links opaque modules in development mode', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { packageJsonPath, srcRoot } = getWorkspacePaths(workspaceRoot);
      await writeJson(packageJsonPath, { dependencies: {} });

      const moduleDir = path.join(srcRoot, 'opaque', 'test-mod');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), { id: 'test-mod' });
      await fs.writeFile(path.join(moduleDir, 'index.ts'), 'export const hello = "world";', 'utf8');

      expect(await installOpaqueModules(workspaceRoot, {
        materializationMode: 'workspace-link'
      })).toEqual([]);

      const packageJson = await readJson<any>(packageJsonPath);
      expect(packageJson.dependencies['opaque-test-mod']).toBeDefined();
      expect(packageJson.dependencies['opaque-test-mod']).toContain('link:');
    });
  });

  test('successfully physically copies opaque modules in build mode', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { packageJsonPath, srcRoot } = getWorkspacePaths(workspaceRoot);
      await writeJson(packageJsonPath, { dependencies: {} });

      const moduleDir = path.join(srcRoot, 'opaque', 'test-mod');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), { id: 'test-mod' });
      await fs.writeFile(path.join(moduleDir, 'index.ts'), 'export const hello = "world";', 'utf8');

      const result = await installOpaqueModules(workspaceRoot, {
        materializationMode: 'build-copy'
      });
      const repeated = await installOpaqueModules(workspaceRoot, {
        materializationMode: 'build-copy'
      });

      expect(result).toContain('src/installed/opaque-test-mod/index.ts');
      expect(result).toContain('src/installed/opaque-test-mod/module.yaml');
      expect(repeated).toEqual(result);
      expect(await pathExists(path.join(
        srcRoot,
        'installed',
        'opaque-test-mod',
        'index.ts'
      ))).toBe(true);

      const packageJson = await readJson<any>(packageJsonPath);
      expect(packageJson.dependencies['opaque-test-mod']).toBe('link:src/installed/opaque-test-mod');
    });
  });

  test('build mode refuses to adopt a conflicting pre-existing target without ownership proof', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { packageJsonPath, srcRoot } = getWorkspacePaths(workspaceRoot);
      await writeJson(packageJsonPath, { dependencies: {} });

      const moduleDir = path.join(srcRoot, 'opaque', 'test-mod');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), { id: 'test-mod' });
      await fs.writeFile(path.join(moduleDir, 'index.ts'), 'export const hello = "world";\n', 'utf8');

      const targetDir = path.join(srcRoot, 'installed', 'opaque-test-mod');
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(path.join(targetDir, 'index.ts'), 'external bytes\n', 'utf8');

      await expect(installOpaqueModules(workspaceRoot, {
        materializationMode: 'build-copy'
      })).rejects.toThrow(/differs from the exact opaque module source snapshot/);
      expect(await fs.readFile(path.join(targetDir, 'index.ts'), 'utf8')).toBe('external bytes\n');
    });
  });

  test('writes dependency projection in canonical module order before parallel physical effects', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { packageJsonPath, srcRoot } = getWorkspacePaths(workspaceRoot);
      await writeJson(packageJsonPath, { dependencies: { stable: '1.0.0' } });

      const slowModule = path.join(srcRoot, 'opaque', 'slow-source');
      await fs.mkdir(slowModule, { recursive: true });
      await writeYaml(path.join(slowModule, 'module.yaml'), { id: 'a-slow' });
      for (let index = 0; index < 64; index += 1) {
        await fs.writeFile(
          path.join(slowModule, `file-${String(index).padStart(2, '0')}.ts`),
          `export const value${index} = ${index};\n`,
          'utf8'
        );
      }

      const fastModule = path.join(srcRoot, 'opaque', 'fast-source');
      await fs.mkdir(fastModule, { recursive: true });
      await writeYaml(path.join(fastModule, 'module.yaml'), { id: 'z-fast' });
      await fs.writeFile(path.join(fastModule, 'index.ts'), 'export const fast = true;\n', 'utf8');

      await installOpaqueModules(workspaceRoot, {
        materializationMode: 'build-copy'
      });

      const packageBytes = await fs.readFile(packageJsonPath, 'utf8');
      const slowDependencyOffset = packageBytes.indexOf('"opaque-a-slow"');
      const fastDependencyOffset = packageBytes.indexOf('"opaque-z-fast"');
      expect(slowDependencyOffset).toBeGreaterThan(-1);
      expect(fastDependencyOffset).toBeGreaterThan(-1);
      expect(slowDependencyOffset).toBeLessThan(fastDependencyOffset);
    });
  });

  test('does not treat an opaque-* package name as deletion ownership', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { packageJsonPath } = getWorkspacePaths(workspaceRoot);
      await writeJson(packageJsonPath, {
        dependencies: {
          'opaque-old-mod': 'link:../src/opaque/old-mod'
        }
      });

      await expect(installOpaqueModules(workspaceRoot, {
        materializationMode: 'workspace-link'
      })).rejects.toThrow(/requires generated-state ownership proof/);

      const packageJson = await readJson<any>(packageJsonPath);
      expect(packageJson.dependencies['opaque-old-mod']).toBe(
        'link:../src/opaque/old-mod'
      );
    });
  });

  test('malformed module descriptor blocks before package dependency mutation', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { packageJsonPath, srcRoot } = getWorkspacePaths(workspaceRoot);
      await writeJson(packageJsonPath, { dependencies: { stable: '1.0.0' } });
      const moduleDir = path.join(srcRoot, 'opaque', 'bad');
      await fs.mkdir(moduleDir, { recursive: true });
      await writeYaml(path.join(moduleDir, 'module.yaml'), {
        id: 'bad',
        entry: 'ghost-entry.ts'
      });

      await expect(installOpaqueModules(workspaceRoot, {
        materializationMode: 'workspace-link'
      })).rejects.toThrow(/violates the exact schema/);
      expect(await readJson<any>(packageJsonPath)).toEqual({ dependencies: { stable: '1.0.0' } });
    });
  });

  test('duplicate opaque module identities fail before parallel installation', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { packageJsonPath, srcRoot } = getWorkspacePaths(workspaceRoot);
      await writeJson(packageJsonPath, { dependencies: {} });
      for (const directory of ['first', 'second']) {
        const moduleDir = path.join(srcRoot, 'opaque', directory);
        await fs.mkdir(moduleDir, { recursive: true });
        await writeYaml(path.join(moduleDir, 'module.yaml'), { id: 'same-module' });
      }

      await expect(installOpaqueModules(workspaceRoot, {
        materializationMode: 'workspace-link'
      })).rejects.toThrow(/declared more than once/);
    });
  });
});

// The lease/temporary workspace cannot be released while an admitted module
// installation is still suspended in its effect fence.
test('opaque failure closes the queue, joins admitted work and fences late writes', async () => {
  await withTempWorkspace(async workspaceRoot => {
    const { srcRoot, packageJsonPath } = getWorkspacePaths(workspaceRoot);
    await writeJson(packageJsonPath, { dependencies: { stable: '1.0.0' } });
    const before = await fs.readFile(packageJsonPath);
    const modules = Array.from({ length: 12 }, (_, index) => `module-${String(index).padStart(2, '0')}`);
    for (const id of modules) {
      const root = path.join(srcRoot, 'opaque', id);
      await fs.mkdir(root, { recursive: true });
      await writeYaml(path.join(root, 'module.yaml'), { id });
    }
    const nodeModules = path.join(workspaceRoot, 'node_modules');
    await fs.mkdir(nodeModules, { recursive: true });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let notifyFailure!: () => void;
    const failureEntered = new Promise<void>(resolve => { notifyFailure = resolve; });
    const primary = Object.freeze({ reason: 'module fence refused' });
    let fences = 0, settled = false;
    const operation = installOpaqueModules(workspaceRoot, {
      materializationMode: 'workspace-link',
      commitFence: async () => {
        const call = ++fences;
        if (call === 1) await held;
        else if (call === 2) { notifyFailure(); throw primary; }
      }
    }).then(
      value => { settled = true; return { status: 'succeeded' as const, value }; },
      error => { settled = true; return { status: 'failed' as const, error }; }
    );
    try {
      await failureEntered;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      expect(settled).toBe(false);
    } finally {
      release();
      await operation;
    }
    const outcome = await operation;
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('Expected installation refusal');
    const reasons = outcome.error instanceof AggregateError ? outcome.error.errors : [outcome.error];
    expect(reasons.every(reason => reason === primary)).toBe(true);
    expect(await fs.readFile(packageJsonPath)).toEqual(before);
    expect((await fs.readdir(nodeModules)).filter(name => name.startsWith('opaque-'))).toEqual([]);
    expect(fences).toBe(2);
  });
});
