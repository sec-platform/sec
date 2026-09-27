import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import {
  buildRuntimeDepsPreboundBinding,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE
} from '../../src/adapters/toolchain/dependencies/contract/runtime-dependency-spec.ts';
import {
  ensureCompilerDepsReady,
  ensureProjectDependencies,
  readRuntimeDepsStamp,
  withProjectDependencyBridge
} from '../../src/adapters/toolchain/dependencies/test/runtime.ts';
import { compilerRoot } from '../../src/adapters/workspace-context.ts';
import { ensureProjectBase } from '../../src/adapters/workspace/project-base.ts';
import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

type RuntimePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

async function observeCanonicalSharedDependencies(): Promise<unknown> {
  const sharedRoot = path.join(compilerRoot, '.shared-deps');
  let root: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    root = await fs.lstat(sharedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    throw error;
  }
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error('Canonical shared dependency root is not a physical directory');
  }
  const children = await fs.readdir(sharedRoot);
  return {
    state: 'present',
    root: { dev: root.dev, ino: root.ino, mode: root.mode },
    children: await Promise.all(children.sort().map(async (name) => {
      const entry = await fs.lstat(path.join(sharedRoot, name));
      return { name, dev: entry.dev, ino: entry.ino, mode: entry.mode };
    }))
  };
}

async function installRuntimePackageManifestClosure(nodeModulesRoot: string): Promise<void> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const exactVersions = {
    ...runtimeSpec.dependencies,
    ...runtimeSpec.devDependencies
  };
  await Promise.all(
    RUNTIME_DEPENDENCY_PACKAGE_NAMES.map(async (packageName) => {
      const packageRoot = path.join(nodeModulesRoot, ...packageName.split('/'));
      await fs.mkdir(packageRoot, { recursive: true });
      await fs.writeFile(
        path.join(packageRoot, 'package.json'),
        `${JSON.stringify({
          name: packageName,
          version: exactVersions[packageName]
        })}\n`,
        'utf8'
      );
    })
  );
}

describe('project and compiler runtime manifests', () => {
  test('derive versions from the root package.json', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const compiler = await ensureCompilerDepsReady();

      const rootPackage = await readCompilerPackageJson();
      const projectPackage = await readJson<RuntimePackageJson>(path.join(workspaceRoot, 'package.json'));
      const compilerPackage = await readJson<RuntimePackageJson>(path.join(compiler.root, 'package.json'));

      expect(projectPackage.dependencies.yaml).toBe(rootPackage.dependencies?.yaml as string);
      expect(projectPackage.devDependencies['@types/node']).toBe(rootPackage.devDependencies?.['@types/node'] as string);
      expect(projectPackage.devDependencies.typescript).toBe(rootPackage.devDependencies?.typescript as string);
      expect(compilerPackage.dependencies).toEqual(projectPackage.dependencies);
      expect(compilerPackage.devDependencies).toEqual(projectPackage.devDependencies);
      await expect(fs.lstat(path.join(workspaceRoot, '.shared-deps'))).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-manifest-');
  });
});

describe('dependency bridge', () => {
  test('reuses the shared runtime cache when the project has no node_modules', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const bridgePath = path.join(workspaceRoot, 'node_modules');

      await ensureProjectBase(workspaceRoot);
      await withProjectDependencyBridge(workspaceRoot, async () => {
        const bridgeStats = await fs.lstat(bridgePath);
        expect(bridgeStats.isSymbolicLink()).toBe(true);
        await expect(fs.stat(path.join(bridgePath, 'yaml', 'package.json'))).resolves.toBeDefined();
      });

      await expect(fs.stat(bridgePath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-bridge-');
  });

  test('settles a failed consumer before a later consumer reuses the bridge', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const bridgePath = path.join(workspaceRoot, 'node_modules');
      const failure = new Error('runtime consumer failed');

      await ensureProjectBase(workspaceRoot);
      await expect(withProjectDependencyBridge(workspaceRoot, async () => {
        await expect(fs.stat(path.join(bridgePath, 'yaml', 'package.json'))).resolves.toBeDefined();
        throw failure;
      })).rejects.toBe(failure);
      await expect(fs.lstat(bridgePath)).rejects.toMatchObject({ code: 'ENOENT' });

      await withProjectDependencyBridge(workspaceRoot, async () => {
        await expect(fs.stat(path.join(bridgePath, 'yaml', 'package.json'))).resolves.toBeDefined();
      });
      await expect(fs.lstat(bridgePath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-bridge-failure-');
  });

  test('serializes consumers of the same project locator', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      let releaseFirst!: () => void;
      const firstMayFinish = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let firstEntered!: () => void;
      const firstDidEnter = new Promise<void>((resolve) => {
        firstEntered = resolve;
      });
      let activeConsumers = 0;
      let maximumActiveConsumers = 0;

      const first = withProjectDependencyBridge(workspaceRoot, async () => {
        activeConsumers += 1;
        maximumActiveConsumers = Math.max(maximumActiveConsumers, activeConsumers);
        firstEntered();
        await firstMayFinish;
        activeConsumers -= 1;
      });
      await firstDidEnter;
      const second = withProjectDependencyBridge(workspaceRoot, async () => {
        activeConsumers += 1;
        maximumActiveConsumers = Math.max(maximumActiveConsumers, activeConsumers);
        activeConsumers -= 1;
      });
      await Promise.resolve();
      expect(maximumActiveConsumers).toBe(1);
      releaseFirst();
      await Promise.all([first, second]);
      expect(maximumActiveConsumers).toBe(1);
      await expect(fs.lstat(path.join(workspaceRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-bridge-serialization-');
  });
});

describe('ensureProjectDependencies', () => {
  test.concurrent('prebound dependency readiness is constant-work and preserves the plan-owned tree', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const nodeModulesRoot = path.join(workspaceRoot, 'node_modules');
      const fillerRoot = path.join(nodeModulesRoot, 'synthetic-package');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      const runtimeSpec = await loadRuntimeDependencySpec();
      await installRuntimePackageManifestClosure(nodeModulesRoot);
      await fs.mkdir(fillerRoot, { recursive: true });
      await Promise.all([
        fs.writeFile(bindingPath, `${JSON.stringify(buildRuntimeDepsPreboundBinding(runtimeSpec))}\n`, 'utf8'),
        ...Array.from({ length: 1024 }, (_, index) =>
          fs.writeFile(path.join(fillerRoot, `${String(index).padStart(4, '0')}.bin`), 'x', 'utf8')
        )
      ]);
      const beforeRoot = await fs.stat(nodeModulesRoot);
      const beforeSample = await fs.stat(path.join(fillerRoot, '0512.bin'));
      let fenceCalls = 0;
      let installCalls = 0;

      await ensureProjectDependencies(workspaceRoot, {
        beforeCommit: async () => {
          fenceCalls += 1;
        },
        materialize: async () => {
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
      expect({ dev: afterSample.dev, ino: afterSample.ino }).toEqual({ dev: beforeSample.dev, ino: beforeSample.ino });
    }, 'engineering-compiler-runtime-prebound-constant-work-');
  });

  test.concurrent('prebound dependency readiness rejects incomplete or forged package closure', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const nodeModulesRoot = path.join(workspaceRoot, 'node_modules');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      const yamlManifest = path.join(nodeModulesRoot, 'yaml', 'package.json');
      const runtimeSpec = await loadRuntimeDependencySpec();
      await installRuntimePackageManifestClosure(nodeModulesRoot);
      await fs.writeFile(bindingPath, `${JSON.stringify(buildRuntimeDepsPreboundBinding(runtimeSpec))}\n`, 'utf8');

      await fs.rm(yamlManifest);
      await expect(ensureProjectDependencies(workspaceRoot, { installMode: 'prebound-only' })).rejects.toThrow(
        'Plan-bound dependency tree is unavailable'
      );

      await fs.writeFile(yamlManifest, '{"name":"forged-yaml","version":"0.0.0"}\n', 'utf8');
      await expect(ensureProjectDependencies(workspaceRoot, { installMode: 'prebound-only' })).rejects.toThrow(
        'Plan-bound dependency tree is unavailable'
      );

      await fs.writeFile(yamlManifest, '{"name":"yaml","version":"0.0.0"}\n', 'utf8');
      await expect(ensureProjectDependencies(workspaceRoot, { installMode: 'prebound-only' })).rejects.toThrow(
        'Plan-bound dependency tree is unavailable'
      );
    }, 'engineering-compiler-runtime-prebound-package-closure-');
  });

  test.concurrent('prebound dependency readiness rejects stale markers without mutation or spawn', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const nodeModulesRoot = path.join(workspaceRoot, 'node_modules');
      const yamlPackageFile = path.join(nodeModulesRoot, 'yaml', 'package.json');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      await fs.mkdir(path.dirname(yamlPackageFile), { recursive: true });
      await fs.writeFile(yamlPackageFile, '{"name":"yaml","version":"0.0.0"}\n', 'utf8');
      await fs.writeFile(
        bindingPath,
        JSON.stringify({
          formatVersion: 'runtime-deps-prebound-binding-v1',
          manifestHash: 'stale',
          unexpected: true
        }),
        'utf8'
      );
      const before = await fs.stat(yamlPackageFile);
      const beforeBytes = await fs.readFile(yamlPackageFile);
      let installCalls = 0;

      await expect(
        ensureProjectDependencies(workspaceRoot, {
          materialize: async () => {
            installCalls += 1;
            return { code: 0, stdout: 'unexpected', stderr: '' };
          },
          installMode: 'prebound-only',
          sharedDepsRoot: path.join(workspaceRoot, 'poison-shared-deps')
        })
      ).rejects.toThrow('Plan-bound dependency tree is unavailable');

      await fs.rm(bindingPath, { force: true });
      await expect(
        ensureProjectDependencies(workspaceRoot, {
          materialize: async () => {
            installCalls += 1;
            return { code: 0, stdout: 'unexpected', stderr: '' };
          },
          installMode: 'prebound-only',
          sharedDepsRoot: path.join(workspaceRoot, 'poison-shared-deps')
        })
      ).rejects.toThrow('Plan-bound dependency tree is unavailable');

      const after = await fs.stat(yamlPackageFile);
      expect(installCalls).toBe(0);
      expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
      expect(await fs.readFile(yamlPackageFile)).toEqual(beforeBytes);
    }, 'engineering-compiler-runtime-prebound-stale-');
  });

  test('bridges one authenticated compiler generation without creating shared deps or reinstalling', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      await ensureProjectBase(workspaceRoot);
      const canonicalSharedBefore = await observeCanonicalSharedDependencies();
      const compiler = await ensureCompilerDepsReady();
      expect(await observeCanonicalSharedDependencies()).toEqual(canonicalSharedBefore);
      const sourcePath = compiler.sourceGeneration?.sourcePath ?? await fs.realpath(path.join(compilerRoot, 'node_modules'));
      expect(compiler.runtimeMaterialization).toBeDefined();
      await expect(fs.lstat(sharedDepsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      const sequence: string[] = [];
      await ensureProjectDependencies(workspaceRoot, {
        materialize: async () => {
          sequence.push('unexpected-spawn');
          return { code: 1, stdout: '', stderr: 'unexpected' };
        }
      });

      expect(sequence).not.toContain('unexpected-spawn');
      expect(await fs.realpath(path.join(workspaceRoot, 'node_modules'))).toBe(sourcePath);
      expect(await observeCanonicalSharedDependencies()).toEqual(canonicalSharedBefore);
      await expect(fs.lstat(sharedDepsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readRuntimeDepsStamp(path.join(workspaceRoot, '.runtime-deps.stamp.json'))).toMatchObject({
        binding: { revision: compiler.runtimeMaterialization!.revision },
        sourceGeneration: { sourcePath },
        packageManager: 'bun'
      });
    }, 'engineering-compiler-runtime-link-');
  });

  test('isolated-copies one authenticated compiler generation without creating shared deps or reinstalling', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      await ensureProjectBase(workspaceRoot);
      const canonicalSharedBefore = await observeCanonicalSharedDependencies();
      const compiler = await ensureCompilerDepsReady();
      expect(await observeCanonicalSharedDependencies()).toEqual(canonicalSharedBefore);
      const sourcePath = compiler.sourceGeneration?.sourcePath ?? await fs.realpath(path.join(compilerRoot, 'node_modules'));
      expect(compiler.runtimeMaterialization).toBeDefined();
      await expect(fs.lstat(sharedDepsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      const sequence: string[] = [];
      const beforeCommit = async (): Promise<void> => {
        sequence.push('fence');
      };

      await ensureProjectDependencies(workspaceRoot, {
        beforeCommit,
        materialize: async () => {
          sequence.push('unexpected-spawn');
          return { code: 1, stdout: '', stderr: 'unexpected' };
        },
        installMode: 'offline-copy-only',
        rematerialize: true
      });

      expect(sequence).not.toContain('unexpected-spawn');
      expect(sequence.filter((entry) => entry === 'fence').length).toBeGreaterThanOrEqual(6);
      expect((await fs.lstat(path.join(workspaceRoot, 'node_modules'))).isSymbolicLink()).toBe(false);
      await expect(fs.stat(path.join(workspaceRoot, 'node_modules', 'yaml', 'package.json'))).resolves.toBeDefined();
      expect(await readRuntimeDepsStamp(path.join(workspaceRoot, '.runtime-deps.stamp.json'))).toMatchObject({
        binding: { revision: compiler.runtimeMaterialization!.revision },
        sourceGeneration: { sourcePath },
        packageManager: 'bun'
      });
      expect(await observeCanonicalSharedDependencies()).toEqual(canonicalSharedBefore);
      await expect(fs.lstat(sharedDepsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-isolated-copy-');
  });

});
