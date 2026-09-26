import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from "../../src/adapters/filesystem/files.ts";
import {
  buildRuntimeDepsPreboundBinding,
  LEGACY_RUNTIME_DEPS_PREBOUND_BINDING_FILE,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE
} from '../../src/adapters/toolchain/dependencies/contract/runtime-dependency-spec.ts';
import {
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
  SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES,
  withProjectDependencyBridge
} from '../../src/adapters/toolchain/dependencies/test/runtime.ts';
import { ensureProjectBase } from '../../src/adapters/workspace/project-base.ts';
import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

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

describe('shared runtime dependency projection', () => {
  test('projects one exact compiler closure and reuses it without a second Bun install', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      let unexpectedSpawnCalls = 0;
      const materialize = async () => {
        unexpectedSpawnCalls += 1;
        return { code: 1, stdout: '', stderr: 'unexpected package-manager spawn' };
      };

      const ready = await Promise.all([
        ensureSharedDepsReady({ materialize, pollIntervalMs: 10, sharedDepsRoot }),
        ensureSharedDepsReady({ materialize, pollIntervalMs: 10, sharedDepsRoot }),
        ensureSharedDepsReady({ materialize, pollIntervalMs: 10, sharedDepsRoot })
      ]);

      expect(unexpectedSpawnCalls).toBe(0);
      expect(new Set(ready.map((entry) => entry.binding.revision)).size).toBe(1);
      expect(ready[0]!.binding.packages.length).toBeGreaterThan(RUNTIME_DEPENDENCY_PACKAGE_NAMES.length);
      const stampPath = path.join(sharedDepsRoot, 'runtime-deps.stamp.json');
      expect(await readRuntimeDepsStamp(stampPath)).toMatchObject({
        formatVersion: 'runtime-deps-stamp-v3',
        packageManager: 'bun'
      });
      const stamp = JSON.parse(await fs.readFile(stampPath, 'utf8')) as Record<string, unknown>;
      await fs.writeFile(stampPath, `${JSON.stringify({ ...stamp, unexpected: true })}\n`, 'utf8');
      expect(await readRuntimeDepsStamp(stampPath)).toBeNull();
    }, 'engineering-compiler-shared-deps-');
  });

  test('does not reuse a missing or version-drifted transitive package', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      const ready = await ensureSharedDepsReady({ sharedDepsRoot });
      const directTargets = new Set(ready.binding.rootPackages.map((entry) => entry.target));
      const transitive = ready.binding.packages.find((entry) => !directTargets.has(entry.relativePath));
      expect(transitive).toBeDefined();
      const manifestPath = path.join(ready.nodeModulesPath, ...transitive!.relativePath.split('/'), 'package.json');
      const originalManifest = await fs.readFile(manifestPath);
      const manifest = JSON.parse(originalManifest.toString('utf8')) as Record<string, unknown>;
      await fs.writeFile(manifestPath, `${JSON.stringify({ ...manifest, version: '0.0.0' })}\n`, 'utf8');

      await expect(
        ensureSharedDepsReady({
          beforeCommit: async () => {
            throw new Error('injected stop before projection repair');
          },
          sharedDepsRoot
        })
      ).rejects.toThrow('injected stop before projection repair');
      await fs.writeFile(manifestPath, originalManifest);
      await fs.rm(manifestPath);
      await expect(
        ensureSharedDepsReady({
          beforeCommit: async () => {
            throw new Error('injected stop before projection repair');
          },
          sharedDepsRoot
        })
      ).rejects.toThrow('injected stop before projection repair');
    }, 'engineering-compiler-shared-deps-incomplete-');
  });

  test('preserves and rejects stale generated control residue without reinstalling', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      await ensureSharedDepsReady({ sharedDepsRoot });
      await fs.writeFile(path.join(sharedDepsRoot, 'bun.lock'), 'stale generated residue\n', 'utf8');
      let unexpectedInstallCalls = 0;

      await expect(
        ensureSharedDepsReady({
          materialize: async () => {
            unexpectedInstallCalls += 1;
            return { code: 1, stdout: '', stderr: 'unexpected reinstall' };
          },
          sharedDepsRoot
        })
      ).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-002',
        message: 'Shared dependency root contains competing authority files: bun.lock'
      });

      expect(unexpectedInstallCalls).toBe(0);
      await expect(fs.readFile(path.join(sharedDepsRoot, 'bun.lock'), 'utf8')).resolves.toBe('stale generated residue\n');
    }, 'engineering-compiler-shared-deps-residue-preserve-');
  });

  test('rejects a reparse shared root before any install or cleanup effect', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const outsideRoot = path.join(tempRoot, 'outside-root');
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      const outsideSentinel = path.join(outsideRoot, 'bun.lock');
      await fs.mkdir(outsideRoot);
      await fs.writeFile(outsideSentinel, 'outside authority\n', 'utf8');
      await fs.symlink(outsideRoot, sharedDepsRoot, process.platform === 'win32' ? 'junction' : 'dir');
      let installCalls = 0;

      await expect(
        ensureSharedDepsReady({
          materialize: async () => {
            installCalls += 1;
            return { code: 0, stdout: 'unexpected', stderr: '' };
          },
          sharedDepsRoot
        })
      ).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-002',
        message: expect.stringContaining('must be a physical directory')
      });

      expect(installCalls).toBe(0);
      await expect(fs.readFile(outsideSentinel, 'utf8')).resolves.toBe('outside authority\n');
      expect((await fs.lstat(sharedDepsRoot)).isSymbolicLink()).toBe(true);
    }, 'engineering-compiler-shared-deps-reparse-root-');
  });

  test('preserves and rejects a forbidden child symlink without touching its target', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      const outsideTarget = path.join(tempRoot, 'outside-lock');
      const outsideSentinel = path.join(outsideTarget, 'sentinel.txt');
      await fs.mkdir(sharedDepsRoot);
      await fs.mkdir(outsideTarget);
      await fs.writeFile(outsideSentinel, 'outside target\n', 'utf8');
      await fs.symlink(outsideTarget, path.join(sharedDepsRoot, 'bun.lock'), process.platform === 'win32' ? 'junction' : 'dir');
      let installCalls = 0;

      await expect(
        ensureSharedDepsReady({
          materialize: async () => {
            installCalls += 1;
            return { code: 0, stdout: 'unexpected', stderr: '' };
          },
          sharedDepsRoot
        })
      ).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-002',
        message: 'Shared dependency root contains competing authority files: bun.lock'
      });

      expect(installCalls).toBe(0);
      expect((await fs.lstat(path.join(sharedDepsRoot, 'bun.lock'))).isSymbolicLink()).toBe(true);
      await expect(fs.readFile(outsideSentinel, 'utf8')).resolves.toBe('outside target\n');
    }, 'engineering-compiler-shared-deps-child-link-');
  });

  test('rejects generated control aliases and hardlinks before writing through them', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      const hardlinkSharedDepsRoot = path.join(tempRoot, '.shared-deps-hardlink');
      const outsideTarget = path.join(tempRoot, 'outside-manifest');
      const outsideSentinel = path.join(outsideTarget, 'sentinel.txt');
      await fs.mkdir(sharedDepsRoot);
      await fs.mkdir(hardlinkSharedDepsRoot);
      await fs.mkdir(outsideTarget);
      await fs.writeFile(outsideSentinel, 'outside target\n', 'utf8');
      await fs.symlink(outsideTarget, path.join(sharedDepsRoot, 'package.json'), process.platform === 'win32' ? 'junction' : 'dir');

      await expect(ensureSharedDepsReady({ sharedDepsRoot })).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-002',
        message: expect.stringContaining('control file is not physical')
      });

      expect((await fs.lstat(path.join(sharedDepsRoot, 'package.json'))).isSymbolicLink()).toBe(true);
      await expect(fs.readFile(outsideSentinel, 'utf8')).resolves.toBe('outside target\n');

      const hardlinkPath = path.join(hardlinkSharedDepsRoot, 'package.json');
      await fs.link(outsideSentinel, hardlinkPath);
      await expect(ensureSharedDepsReady({ sharedDepsRoot: hardlinkSharedDepsRoot })).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-002',
        message: expect.stringContaining('control file is not physical')
      });
      expect((await fs.lstat(hardlinkPath)).nlink).toBe(2);
      await expect(fs.readFile(outsideSentinel, 'utf8')).resolves.toBe('outside target\n');
    }, 'engineering-compiler-shared-deps-control-link-');
  });

  test('publishes no package-manager lock or configuration authority', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      await ensureSharedDepsReady({ sharedDepsRoot });
      await Promise.all(
        SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES.map(async (name) => {
          await expect(fs.lstat(path.join(sharedDepsRoot, name))).rejects.toMatchObject({ code: 'ENOENT' });
        })
      );
    }, 'engineering-compiler-shared-deps-control-authority-');
  });
});
describe('project and shared runtime manifests', () => {
  test('derive versions from the root package.json', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');

      await ensureProjectBase(workspaceRoot);
      await ensureSharedDepsReady({ sharedDepsRoot });

      const rootPackage = await readCompilerPackageJson();
      const projectPackage = await readJson<RuntimePackageJson>(path.join(workspaceRoot, 'package.json'));
      const sharedPackage = await readJson<RuntimePackageJson>(path.join(sharedDepsRoot, 'package.json'));

      expect(projectPackage.dependencies.yaml).toBe(rootPackage.dependencies?.yaml as string);
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

  test.concurrent('prebound dependency readiness accepts the legacy filename but rejects dual generations', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const nodeModulesRoot = path.join(workspaceRoot, 'node_modules');
      const currentBindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      const legacyBindingPath = path.join(nodeModulesRoot, LEGACY_RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      const runtimeSpec = await loadRuntimeDependencySpec();
      const bytes = `${JSON.stringify(buildRuntimeDepsPreboundBinding(runtimeSpec))}\n`;
      await installRuntimePackageManifestClosure(nodeModulesRoot);
      await fs.writeFile(legacyBindingPath, bytes, 'utf8');

      await expect(ensureProjectDependencies(workspaceRoot, { installMode: 'prebound-only' }))
        .resolves.toBeUndefined();

      await fs.writeFile(currentBindingPath, bytes, 'utf8');
      await expect(ensureProjectDependencies(workspaceRoot, { installMode: 'prebound-only' }))
        .rejects.toThrow('conflicting binding generations');
    }, 'engineering-compiler-runtime-prebound-legacy-filename-');
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

  test('bridges and isolated-copies the same exact shared binding without another install', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      await ensureProjectBase(workspaceRoot);
      const shared = await ensureSharedDepsReady({ sharedDepsRoot });
      const sequence: string[] = [];
      await ensureProjectDependencies(workspaceRoot, {
        materialize: async () => {
          sequence.push('unexpected-spawn');
          return { code: 1, stdout: '', stderr: 'unexpected' };
        },
        sharedDepsRoot
      });

      expect(sequence).not.toContain('unexpected-spawn');
      expect(await fs.realpath(path.join(workspaceRoot, 'node_modules'))).toBe(path.join(sharedDepsRoot, 'node_modules'));
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
        rematerialize: true,
        sharedDepsRoot,
        skipSharedDepsWarmup: true
      });

      expect(sequence).not.toContain('unexpected-spawn');
      expect(sequence.filter((entry) => entry === 'fence').length).toBeGreaterThanOrEqual(6);
      expect((await fs.lstat(path.join(workspaceRoot, 'node_modules'))).isSymbolicLink()).toBe(false);
      await expect(fs.stat(path.join(workspaceRoot, 'node_modules', 'yaml', 'package.json'))).resolves.toBeDefined();
      expect(await readRuntimeDepsStamp(path.join(workspaceRoot, '.runtime-deps.stamp.json'))).toMatchObject({
        binding: { revision: shared.binding.revision },
        packageManager: 'bun'
      });
    }, 'engineering-compiler-runtime-projection-');
  });
});
