import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readJson } from '../../platform/shared/fs.ts';
import { compilerRoot, getWorkspacePaths } from '../../platform/shared/paths.ts';
import { ensureProjectBase } from '../../platform/shared/project-base.ts';
import {
  canonicalRuntimeDependencyCachePathV1,
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
  SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES,
  withProjectDependencyBridge,
  writeRuntimeDepsStamp,
  type SharedDepsReadyState
} from '../../platform/shared/project-runtime.ts';
import {
  buildRuntimeDepsPreboundBinding,
  EXACT_PLAYWRIGHT_PACKAGE_NAMES,
  isRuntimeDependencyMaterializationBinding,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE
} from '../../platform/shared/runtime-dependency-spec.ts';
import { readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

type RuntimePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

test('runtime dependency cache identity preserves Linux path case and folds Windows case', () => {
  const upper = path.join(path.parse(process.cwd()).root, 'tmp', 'RuntimeDepsA');
  const lower = path.join(path.parse(process.cwd()).root, 'tmp', 'runtimedepsa');
  expect(canonicalRuntimeDependencyCachePathV1(upper, 'linux'))
    .not.toBe(canonicalRuntimeDependencyCachePathV1(lower, 'linux'));
  expect(canonicalRuntimeDependencyCachePathV1(upper, 'win32'))
    .toBe(canonicalRuntimeDependencyCachePathV1(lower, 'win32'));
});

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

let canonicalFixtureRoot: string | null = null;
let canonicalSharedDepsPromise: Promise<SharedDepsReadyState> | null = null;

function canonicalSharedDepsFixture(): Promise<SharedDepsReadyState> {
  if (canonicalSharedDepsPromise !== null) return canonicalSharedDepsPromise;
  canonicalSharedDepsPromise = (async () => {
    canonicalFixtureRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-runtime-deps-canonical-'));
    const sharedDepsRoot = path.join(canonicalFixtureRoot, '.shared-deps');
    const compilerNodeModulesPath = await fs.realpath(path.join(compilerRoot, 'node_modules'));
    const compilerBinding = JSON.parse(await fs.readFile(
      path.join(compilerNodeModulesPath, '.sec-compiler-deps-binding-v4.json'),
      'utf8'
    )) as Record<string, unknown>;
    const runtimeMaterialization = compilerBinding.runtimeMaterialization;
    if (!isRuntimeDependencyMaterializationBinding(runtimeMaterialization)) {
      throw new Error('canonical compiler generation has no runtime materialization binding');
    }
    await fs.mkdir(sharedDepsRoot, { recursive: true });
    await fs.copyFile(path.join(compilerRoot, 'package.json'), path.join(sharedDepsRoot, 'package.json'));
    await fs.symlink(
      compilerNodeModulesPath,
      path.join(sharedDepsRoot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await writeRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'), {
      binding: runtimeMaterialization,
      formatVersion: 'runtime-deps-stamp-v3',
      installedAt: '2026-08-24T00:00:00.000Z',
      manifestHash: runtimeMaterialization.manifestHash,
      packageManager: 'bun'
    });
    return Object.freeze({
      binding: runtimeMaterialization,
      packageManager: 'bun' as const,
      root: sharedDepsRoot,
      nodeModulesPath: path.join(sharedDepsRoot, 'node_modules'),
      manifestHash: runtimeMaterialization.manifestHash
    });
  })();
  return canonicalSharedDepsPromise;
}

// The integration fixture consumes the already validated compiler generation
// through an exact locator. A separate provider canary owns cold installation;
// ordinary tests never copy or redownload the gigabyte-scale dependency tree.
beforeAll(async () => {
  await canonicalSharedDepsFixture();
}, 120_000);

/**
 * Negative contract tests need the exact package graph and manifest digests,
 * not another gigabyte-scale byte projection. One cold canary above owns that
 * Effect; each isolated fixture below copies only the complete canonical
 * manifest graph and the owner-issued binding/stamp.
 */
async function seedManifestCompleteSharedDepsFixture(sharedDepsRoot: string): Promise<void> {
  const canonical = await canonicalSharedDepsFixture();
  const nodeModulesRoot = path.join(sharedDepsRoot, 'node_modules');
  await fs.mkdir(nodeModulesRoot, { recursive: true });
  await Promise.all(canonical.binding.packages.map(async (packageIdentity) => {
    const relativeManifest = path.join(...packageIdentity.relativePath.split('/'), 'package.json');
    const target = path.join(nodeModulesRoot, relativeManifest);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(canonical.nodeModulesPath, relativeManifest), target);
  }));
  await fs.copyFile(
    path.join(canonical.root, 'package.json'),
    path.join(sharedDepsRoot, 'package.json')
  );
  await writeRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'), {
    binding: canonical.binding,
    formatVersion: 'runtime-deps-stamp-v3',
    installedAt: '2026-08-24T00:00:00.000Z',
    manifestHash: canonical.manifestHash,
    packageManager: 'bun'
  });
}

afterAll(async () => {
  if (canonicalFixtureRoot !== null) {
    await fs.rm(canonicalFixtureRoot, { recursive: true, force: true });
  }
}, 120_000);

describe('shared runtime dependency projection', () => {
  test('projects one exact compiler closure and reuses it without a second Bun install', async () => {
    const ready = await canonicalSharedDepsFixture();
    expect(ready.binding.packages.length).toBeGreaterThan(RUNTIME_DEPENDENCY_PACKAGE_NAMES.length);
    const stampPath = path.join(ready.root, 'runtime-deps.stamp.json');
    expect(await readRuntimeDepsStamp(stampPath)).toMatchObject({
      formatVersion: 'runtime-deps-stamp-v3',
      packageManager: 'bun'
    });
    const stamp = JSON.parse(await fs.readFile(stampPath, 'utf8')) as Record<string, unknown>;
    await fs.writeFile(stampPath, `${JSON.stringify({ ...stamp, unexpected: true })}\n`, 'utf8');
    expect(await readRuntimeDepsStamp(stampPath)).toBeNull();
    await writeRuntimeDepsStamp(stampPath, {
      binding: ready.binding,
      formatVersion: 'runtime-deps-stamp-v3',
      installedAt: '2026-08-24T00:00:00.000Z',
      manifestHash: ready.manifestHash,
      packageManager: 'bun'
    });
  });

  test('reclaims a crash-left empty install reclaim marker without waiting for the lock timeout', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      await seedManifestCompleteSharedDepsFixture(sharedDepsRoot);
      await fs.rm(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'));
      const reclaimPath = path.join(sharedDepsRoot, 'install.lock.reclaim');
      await fs.writeFile(reclaimPath, '');
      const old = new Date(Date.now() - 60_000);
      await fs.utimes(reclaimPath, old, old);

      const ready = await ensureSharedDepsReady({ sharedDepsRoot, lockTimeoutMs: 10_000 });

      expect(ready.binding.revision).toBe((await canonicalSharedDepsFixture()).binding.revision);
      await expect(fs.lstat(reclaimPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json')))
        .toMatchObject({ binding: { revision: ready.binding.revision } });
    }, 'engineering-compiler-runtime-reclaim-crash-');
  }, 30_000);

  test('does not reuse a substituted or incomplete dependency locator target', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      await seedManifestCompleteSharedDepsFixture(sharedDepsRoot);
      const ready = await ensureSharedDepsReady({ sharedDepsRoot });
      const foreignNodeModules = path.join(tempRoot, 'foreign-node-modules');
      await installRuntimePackageManifestClosure(foreignNodeModules);
      await fs.unlink(ready.nodeModulesPath);
      await fs.symlink(
        foreignNodeModules,
        ready.nodeModulesPath,
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      await expect(ensureSharedDepsReady({
        beforeCommit: async () => {
          throw new Error('injected stop before projection repair');
        },
        sharedDepsRoot
      })).rejects.toThrow('injected stop before projection repair');

      await fs.rm(path.join(foreignNodeModules, 'react', 'package.json'));
      await expect(ensureSharedDepsReady({
        beforeCommit: async () => {
          throw new Error('injected stop before projection repair');
        },
        sharedDepsRoot
      })).rejects.toThrow('injected stop before projection repair');
    }, 'engineering-compiler-shared-deps-incomplete-');
  });

  test('preserves and rejects stale generated control residue without reinstalling', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      await seedManifestCompleteSharedDepsFixture(sharedDepsRoot);
      await ensureSharedDepsReady({ sharedDepsRoot });
      await fs.writeFile(path.join(sharedDepsRoot, 'bun.lock'), 'stale generated residue\n', 'utf8');
      let unexpectedInstallCalls = 0;

      await expect(ensureSharedDepsReady({
        commandRunner: async () => {
          unexpectedInstallCalls += 1;
          return { code: 1, stdout: '', stderr: 'unexpected reinstall' };
        },
        sharedDepsRoot
      })).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-002',
        message: 'Shared dependency root contains competing authority files: bun.lock'
      });

      expect(unexpectedInstallCalls).toBe(0);
      await expect(fs.readFile(path.join(sharedDepsRoot, 'bun.lock'), 'utf8'))
        .resolves.toBe('stale generated residue\n');
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

      await expect(ensureSharedDepsReady({
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        sharedDepsRoot
      })).rejects.toMatchObject({
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
      await fs.symlink(
        outsideTarget,
        path.join(sharedDepsRoot, 'bun.lock'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      let installCalls = 0;

      await expect(ensureSharedDepsReady({
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        sharedDepsRoot
      })).rejects.toMatchObject({
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
      await fs.symlink(
        outsideTarget,
        path.join(sharedDepsRoot, 'package.json'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      await expect(ensureSharedDepsReady({ sharedDepsRoot })).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-002',
        message: expect.stringContaining('control file is not physical')
      });

      expect((await fs.lstat(path.join(sharedDepsRoot, 'package.json'))).isSymbolicLink()).toBe(true);
      await expect(fs.readFile(outsideSentinel, 'utf8')).resolves.toBe('outside target\n');

      const hardlinkPath = path.join(hardlinkSharedDepsRoot, 'package.json');
      await fs.link(outsideSentinel, hardlinkPath);
      await expect(ensureSharedDepsReady({ sharedDepsRoot: hardlinkSharedDepsRoot }))
        .rejects.toMatchObject({
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
      await seedManifestCompleteSharedDepsFixture(sharedDepsRoot);
      await ensureSharedDepsReady({ sharedDepsRoot });
      await Promise.all(SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES.map(async (name) => {
        await expect(fs.lstat(path.join(sharedDepsRoot, name)))
          .rejects.toMatchObject({ code: 'ENOENT' });
      }));
    }, 'engineering-compiler-shared-deps-control-authority-');
  });
});
describe('project and shared runtime manifests', () => {
  test('derive versions from the root package.json', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');

      await ensureProjectBase(workspaceRoot);
      await seedManifestCompleteSharedDepsFixture(sharedDepsRoot);
      await ensureSharedDepsReady({ sharedDepsRoot });

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

  test('rejects an existing foreign physical directory before invoking the bridged callback', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const bridgePath = path.join(projectRoot, 'node_modules');
      const sentinel = path.join(bridgePath, 'foreign-sentinel.txt');
      await fs.mkdir(bridgePath, { recursive: true });
      await fs.writeFile(sentinel, 'foreign physical directory\n', 'utf8');
      let callbackCalls = 0;

      await expect(withProjectDependencyBridge(projectRoot, async () => {
        callbackCalls += 1;
      })).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-004',
        message: 'Project dependency bridge is foreign or changed; refusing callback'
      });

      expect(callbackCalls).toBe(0);
      await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe('foreign physical directory\n');
    }, 'engineering-compiler-runtime-bridge-foreign-directory-');
  });

  test('reuses an exact canonical bridge without taking deletion ownership', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const bridgePath = path.join(projectRoot, 'node_modules');
      const expectedTarget = await fs.realpath(path.join(compilerRoot, 'node_modules'));
      await fs.symlink(
        expectedTarget,
        bridgePath,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      let callbackCalls = 0;

      await withProjectDependencyBridge(projectRoot, async () => {
        callbackCalls += 1;
      });

      expect(callbackCalls).toBe(1);
      expect((await fs.lstat(bridgePath)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(bridgePath)).toBe(expectedTarget);
    }, 'engineering-compiler-runtime-bridge-exact-reuse-');
  });

  test('rejects a substituted or incomplete bridge target before invoking the bridged callback', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const bridgePath = path.join(projectRoot, 'node_modules');
      const foreignTarget = path.join(workspaceRoot, 'foreign-node-modules');
      const sentinel = path.join(foreignTarget, 'sentinel.txt');
      await fs.mkdir(foreignTarget, { recursive: true });
      await fs.writeFile(sentinel, 'foreign bridge target\n', 'utf8');
      await fs.symlink(
        foreignTarget,
        bridgePath,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      let callbackCalls = 0;

      await expect(withProjectDependencyBridge(projectRoot, async () => {
        callbackCalls += 1;
      })).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-004',
        message: 'Project dependency bridge is foreign or incomplete; refusing callback'
      });

      expect(callbackCalls).toBe(0);
      await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe('foreign bridge target\n');
      expect((await fs.lstat(bridgePath)).isSymbolicLink()).toBe(true);
    }, 'engineering-compiler-runtime-bridge-foreign-target-');
  });

  test('preserves a foreign replacement created by the bridged callback', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const bridgePath = path.join(projectRoot, 'node_modules');
      const sentinel = path.join(bridgePath, 'foreign-sentinel.txt');
      await ensureProjectBase(workspaceRoot);

      await expect(withProjectDependencyBridge(projectRoot, async () => {
        await fs.unlink(bridgePath);
        await fs.mkdir(bridgePath);
        await fs.writeFile(sentinel, 'foreign replacement\n', 'utf8');
      })).rejects.toThrow();

      expect((await fs.lstat(bridgePath)).isDirectory()).toBe(true);
      await expect(fs.readFile(sentinel, 'utf8')).resolves.toBe('foreign replacement\n');
    }, 'engineering-compiler-runtime-bridge-replacement-');
  });
});

describe('ensureProjectDependencies', () => {
  test('prebound dependency readiness is constant-work and preserves the plan-owned tree', async () => {
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

  test('prebound dependency readiness rejects incomplete or forged package closure', async () => {
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

  test('prebound dependency readiness rejects stale markers without mutation or spawn', async () => {
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

  test('bridges the same exact shared binding without another install or copy', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      await seedManifestCompleteSharedDepsFixture(sharedDepsRoot);
      const shared = await ensureSharedDepsReady({ sharedDepsRoot });
      const sequence: string[] = [];
      await ensureProjectDependencies(projectRoot, {
        commandRunner: async () => {
          sequence.push('unexpected-spawn');
          return { code: 1, stdout: '', stderr: 'unexpected' };
        },
        sharedDepsRoot
      });

      expect(sequence).not.toContain('unexpected-spawn');
      const projectNodeModules = path.join(projectRoot, 'node_modules');
      const sharedNodeModules = path.join(sharedDepsRoot, 'node_modules');
      expect((await fs.lstat(projectNodeModules)).isSymbolicLink()).toBe(true);
      expect((await fs.lstat(sharedNodeModules)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(projectNodeModules)).toBe(await fs.realpath(sharedNodeModules));
      expect(await readRuntimeDepsStamp(path.join(projectRoot, '.runtime-deps.stamp.json')))
        .toMatchObject({ binding: { revision: shared.binding.revision }, packageManager: 'bun' });
    }, 'engineering-compiler-runtime-projection-');
  });

  test('preserves and rejects a foreign physical project dependency directory', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      await ensureProjectBase(workspaceRoot);
      await seedManifestCompleteSharedDepsFixture(sharedDepsRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const nodeModulesPath = path.join(projectRoot, 'node_modules');
      const sentinelPath = path.join(nodeModulesPath, 'foreign-sentinel.txt');
      await fs.mkdir(nodeModulesPath);
      await fs.writeFile(sentinelPath, 'foreign directory\n', 'utf8');
      const before = await fs.lstat(nodeModulesPath);
      let installCalls = 0;

      await expect(ensureProjectDependencies(projectRoot, {
        commandRunner: async () => {
          installCalls += 1;
          return { code: 1, stdout: '', stderr: 'unexpected' };
        },
        sharedDepsRoot
      })).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-004',
        message: expect.stringContaining('refusing destructive replacement')
      });

      const after = await fs.lstat(nodeModulesPath);
      expect(installCalls).toBe(0);
      expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
      await expect(fs.readFile(sentinelPath, 'utf8')).resolves.toBe('foreign directory\n');
    }, 'engineering-compiler-runtime-project-foreign-directory-');
  });

  test('preserves and rejects a project dependency link to a foreign target', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      const foreignRoot = path.join(workspaceRoot, 'foreign-dependencies');
      const foreignSentinel = path.join(foreignRoot, 'sentinel.txt');
      await ensureProjectBase(workspaceRoot);
      await seedManifestCompleteSharedDepsFixture(sharedDepsRoot);
      await fs.mkdir(foreignRoot);
      await fs.writeFile(foreignSentinel, 'foreign target\n', 'utf8');
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const nodeModulesPath = path.join(projectRoot, 'node_modules');
      await fs.symlink(foreignRoot, nodeModulesPath, process.platform === 'win32' ? 'junction' : 'dir');

      await expect(ensureProjectDependencies(projectRoot, { sharedDepsRoot }))
        .rejects.toMatchObject({
          code: 'RUNTIME-DEPS-004',
          message: expect.stringContaining('foreign dependency generation')
        });

      expect((await fs.lstat(nodeModulesPath)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(nodeModulesPath)).toBe(await fs.realpath(foreignRoot));
      await expect(fs.readFile(foreignSentinel, 'utf8')).resolves.toBe('foreign target\n');
    }, 'engineering-compiler-runtime-project-foreign-link-');
  });
});
