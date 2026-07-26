import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { ensureProjectBase } from '../../platform/shared/project-base.ts';
import {
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
  withProjectDependencyBridge,
  writeRuntimeDepsStamp
} from '../../platform/shared/project-runtime.ts';
import {
  buildRuntimeDepsPreboundBinding,
  EXACT_PLAYWRIGHT_PACKAGE_NAMES,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE
} from '../../platform/shared/runtime-dependency-spec.ts';
import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { installRuntimeDeps } from './project-runtime-fixtures.ts';

type RuntimePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

async function installRuntimePackageManifestClosure(nodeModulesRoot: string): Promise<void> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const exactVersions = {
    ...runtimeSpec.dependencies,
    ...runtimeSpec.devDependencies
  };
  const packageNames = new Set([
    ...RUNTIME_DEPENDENCY_PACKAGE_NAMES,
    ...EXACT_PLAYWRIGHT_PACKAGE_NAMES
  ]);
  await Promise.all([...packageNames].map(async (packageName) => {
    const packageRoot = path.join(nodeModulesRoot, ...packageName.split('/'));
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      name: packageName,
      version: EXACT_PLAYWRIGHT_PACKAGE_NAMES.includes(
        packageName as (typeof EXACT_PLAYWRIGHT_PACKAGE_NAMES)[number]
      ) ? runtimeSpec.devDependencies['@playwright/test'] : exactVersions[packageName]
    })}\n`, 'utf8');
  }));
}

describe('shared runtime dependency installation', () => {
  test('ensureSharedDepsReady serializes concurrent installs behind one lock', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      let installCalls = 0;

      const commandRunner = async (_command: string, _args: string[], options: { cwd: string }) => {
        installCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        await installRuntimeDeps(options.cwd);
        return { code: 0, stdout: 'ok', stderr: '' };
      };

      await Promise.all([
        ensureSharedDepsReady({ commandRunner, pollIntervalMs: 10, sharedDepsRoot }),
        ensureSharedDepsReady({ commandRunner, pollIntervalMs: 10, sharedDepsRoot }),
        ensureSharedDepsReady({ commandRunner, pollIntervalMs: 10, sharedDepsRoot })
      ]);

      expect(installCalls).toBe(1);
      expect(await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'))).toMatchObject({
        packageManager: 'bun'
      });
    }, 'engineering-compiler-shared-deps-');
  });

  test('does not publish readiness for an incomplete runtime package closure', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      await expect(ensureSharedDepsReady({
        commandRunner: async (_command, _args, options) => {
          await installRuntimeDeps(options.cwd);
          await fs.rm(path.join(options.cwd, 'node_modules', 'react', 'package.json'));
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        sharedDepsRoot
      })).rejects.toThrow('failed complete package validation');
      expect(await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json')))
        .toBeNull();
    }, 'engineering-compiler-shared-deps-incomplete-');
  });
});
describe('project and shared runtime manifests', () => {
  test('derive versions from the root package.json', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');

      await ensureProjectBase(workspaceRoot);
      await ensureSharedDepsReady({
        commandRunner: async (_command, _args, options) => {
          await installRuntimeDeps(options.cwd);
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        sharedDepsRoot
      });

      const rootPackage = await readCompilerPackageJson();
      const { projectPackagePath } = getWorkspacePaths(workspaceRoot);
      const projectPackage = await readJson<RuntimePackageJson>(projectPackagePath);
      const sharedPackage = await readJson<RuntimePackageJson>(path.join(sharedDepsRoot, 'package.json'));

      expect(projectPackage.dependencies.next).toBe(rootPackage.dependencies?.next as string);
      expect(projectPackage.dependencies.react).toBe(rootPackage.dependencies?.react as string);
      expect(projectPackage.devDependencies['@types/node']).toBe(rootPackage.devDependencies?.['@types/node'] as string);
      expect(projectPackage.devDependencies.typescript).toBe(rootPackage.devDependencies?.typescript as string);
      expect(sharedPackage.dependencies).toEqual(projectPackage.dependencies);
      expect(sharedPackage.devDependencies).toEqual(projectPackage.devDependencies);
    }, 'engineering-compiler-runtime-manifest-');
  });
});

describe('dependency bridge', () => {
  test('reuses the shared runtime cache when the project has no node_modules', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const bridgePath = path.join(projectRoot, 'node_modules');

      await ensureProjectBase(workspaceRoot);
      await withProjectDependencyBridge(projectRoot, async () => {
        const bridgeStats = await fs.lstat(bridgePath);
        expect(bridgeStats.isSymbolicLink()).toBe(true);
        await expect(fs.stat(path.join(bridgePath, 'next', 'package.json'))).resolves.toBeDefined();
      });

      await expect(fs.stat(bridgePath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-bridge-');
  });
});

describe('ensureProjectDependencies', () => {
  test.concurrent('prebound dependency readiness is constant-work and preserves the plan-owned tree', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const nodeModulesRoot = path.join(projectRoot, 'node_modules');
      const fillerRoot = path.join(nodeModulesRoot, 'synthetic-package');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      const runtimeSpec = await loadRuntimeDependencySpec();
      await installRuntimePackageManifestClosure(nodeModulesRoot);
      await fs.mkdir(fillerRoot, { recursive: true });
      await Promise.all([
        fs.writeFile(bindingPath, `${JSON.stringify(buildRuntimeDepsPreboundBinding(runtimeSpec))}\n`, 'utf8'),
        ...Array.from({ length: 1024 }, (_, index) =>
          fs.writeFile(path.join(fillerRoot, `${String(index).padStart(4, '0')}.bin`), 'x', 'utf8'))
      ]);
      const beforeRoot = await fs.stat(nodeModulesRoot);
      const beforeSample = await fs.stat(path.join(fillerRoot, '0512.bin'));
      let fenceCalls = 0;
      let installCalls = 0;

      await ensureProjectDependencies(projectRoot, {
        beforeCommit: async () => {
          fenceCalls += 1;
        },
        commandRunner: async () => {
          installCalls += 1;
          return { code: 1, stdout: '', stderr: 'unexpected' };
        },
        installMode: 'prebound-only',
        sharedDepsRoot: path.join(workspaceRoot, 'poison-shared-deps')
      });

      const afterRoot = await fs.stat(nodeModulesRoot);
      const afterSample = await fs.stat(path.join(fillerRoot, '0512.bin'));
      expect(fenceCalls).toBe(2);
      expect(installCalls).toBe(0);
      expect({ dev: afterRoot.dev, ino: afterRoot.ino }).toEqual({ dev: beforeRoot.dev, ino: beforeRoot.ino });
      expect({ dev: afterSample.dev, ino: afterSample.ino })
        .toEqual({ dev: beforeSample.dev, ino: beforeSample.ino });
    }, 'engineering-compiler-runtime-prebound-constant-work-');
  });

  test.concurrent('prebound dependency readiness rejects incomplete or forged package closure', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const nodeModulesRoot = path.join(projectRoot, 'node_modules');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      const reactManifest = path.join(nodeModulesRoot, 'react', 'package.json');
      const runtimeSpec = await loadRuntimeDependencySpec();
      await installRuntimePackageManifestClosure(nodeModulesRoot);
      await fs.writeFile(
        bindingPath,
        `${JSON.stringify(buildRuntimeDepsPreboundBinding(runtimeSpec))}\n`,
        'utf8'
      );

      await fs.rm(reactManifest);
      await expect(ensureProjectDependencies(projectRoot, { installMode: 'prebound-only' }))
        .rejects.toThrow('Plan-bound dependency tree is unavailable');

      await fs.writeFile(reactManifest, '{"name":"forged-react","version":"0.0.0"}\n', 'utf8');
      await expect(ensureProjectDependencies(projectRoot, { installMode: 'prebound-only' }))
        .rejects.toThrow('Plan-bound dependency tree is unavailable');

      await fs.writeFile(reactManifest, '{"name":"react","version":"0.0.0"}\n', 'utf8');
      await expect(ensureProjectDependencies(projectRoot, { installMode: 'prebound-only' }))
        .rejects.toThrow('Plan-bound dependency tree is unavailable');
    }, 'engineering-compiler-runtime-prebound-package-closure-');
  });

  test.concurrent('prebound dependency readiness rejects stale markers without mutation or spawn', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const nodeModulesRoot = path.join(projectRoot, 'node_modules');
      const nextPackageFile = path.join(nodeModulesRoot, 'next', 'package.json');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      await fs.mkdir(path.dirname(nextPackageFile), { recursive: true });
      await fs.writeFile(nextPackageFile, '{"name":"next","version":"0.0.0"}\n', 'utf8');
      await fs.writeFile(bindingPath, JSON.stringify({
        formatVersion: 'runtime-deps-prebound-binding-v1',
        manifestHash: 'stale',
        unexpected: true
      }), 'utf8');
      const before = await fs.stat(nextPackageFile);
      const beforeBytes = await fs.readFile(nextPackageFile);
      let installCalls = 0;

      await expect(ensureProjectDependencies(projectRoot, {
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        installMode: 'prebound-only',
        sharedDepsRoot: path.join(workspaceRoot, 'poison-shared-deps')
      })).rejects.toThrow('Plan-bound dependency tree is unavailable');

      await fs.rm(bindingPath, { force: true });
      await expect(ensureProjectDependencies(projectRoot, {
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        installMode: 'prebound-only',
        sharedDepsRoot: path.join(workspaceRoot, 'poison-shared-deps')
      })).rejects.toThrow('Plan-bound dependency tree is unavailable');

      const after = await fs.stat(nextPackageFile);
      expect(installCalls).toBe(0);
      expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
      expect(await fs.readFile(nextPackageFile)).toEqual(beforeBytes);
    }, 'engineering-compiler-runtime-prebound-stale-');
  });

  test.concurrent('links shared cache without copying when project deps are cold', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      const runtimeSpec = await loadRuntimeDependencySpec();

      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);

      await installRuntimePackageManifestClosure(path.join(sharedDepsRoot, 'node_modules'));
      await writeRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'), {
        manifestHash: runtimeSpec.manifestHash,
        packageManager: 'bun',
        installedAt: '2026-01-01T00:00:00.000Z'
      });

      let installCalls = 0;
      await ensureProjectDependencies(projectRoot, {
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        sharedDepsRoot
      });

      expect(installCalls).toBe(0);
      expect(await fs.realpath(path.join(projectRoot, 'node_modules'))).toBe(
        path.join(sharedDepsRoot, 'node_modules')
      );
    }, 'engineering-compiler-runtime-link-');
  });

  test.concurrent('isolated dependency materialization fences a physical preinstalled tree without spawning', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      const sharedBinaryFile = path.join(sharedDepsRoot, 'node_modules', 'seed', 'cache.bin');
      await ensureProjectBase(workspaceRoot);
      await installRuntimePackageManifestClosure(path.join(sharedDepsRoot, 'node_modules'));
      await fs.mkdir(path.dirname(sharedBinaryFile), { recursive: true });
      await fs.writeFile(sharedBinaryFile, new Uint8Array([0, 1, 127, 128, 255]));
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const sequence: string[] = [];
      const controller = new AbortController();
      const beforeCommit = async (): Promise<void> => {
        sequence.push('fence');
      };

      await ensureProjectDependencies(projectRoot, {
        beforeCommit,
        commandRunner: async () => {
          sequence.push('unexpected-spawn');
          return { code: 1, stdout: '', stderr: 'unexpected' };
        },
        installMode: 'offline-copy-only',
        rematerialize: true,
        sharedDepsRoot,
        signal: controller.signal,
        skipSharedDepsWarmup: true
      });

      expect(sequence).not.toContain('unexpected-spawn');
      expect(sequence.filter((entry) => entry === 'fence').length).toBeGreaterThanOrEqual(6);
      expect(await fs.readFile(
        path.join(projectRoot, 'node_modules', 'seed', 'cache.bin')
      )).toEqual(Buffer.from([0, 1, 127, 128, 255]));
      expect(await readRuntimeDepsStamp(path.join(projectRoot, '.runtime-deps.stamp.json')))
        .toMatchObject({ packageManager: 'bun' });
    }, 'engineering-compiler-runtime-isolated-fence-');
  });

  test.concurrent('isolated dependency materialization stops during physical copy when its fence is lost', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      await ensureProjectBase(workspaceRoot);
      await installRuntimePackageManifestClosure(path.join(sharedDepsRoot, 'node_modules'));
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const targetModulesRoot = path.join(projectRoot, 'node_modules');
      const targetPackageFile = path.join(targetModulesRoot, 'next', 'package.json');
      let installCalls = 0;
      const beforeCommit = async (): Promise<void> => {
        const rootExists = await fs.stat(targetModulesRoot).then(() => true, () => false);
        const fileExists = await fs.stat(targetPackageFile).then(() => true, () => false);
        if (rootExists && !fileExists) throw new Error('injected dependency materialization lease loss');
      };

      await expect(ensureProjectDependencies(projectRoot, {
        beforeCommit,
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        installMode: 'offline-copy-only',
        rematerialize: true,
        sharedDepsRoot,
        skipSharedDepsWarmup: true
      })).rejects.toThrow('injected dependency materialization lease loss');

      expect(installCalls).toBe(0);
      await expect(fs.stat(targetPackageFile)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-isolated-fence-loss-');
  });
});
