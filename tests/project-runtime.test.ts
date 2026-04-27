import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';

import { ensureProjectBase } from '../platform/shared/project-base.ts';
import {
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
  withProjectDependencyBridge,
  writeRuntimeDepsStamp
} from '../platform/shared/project-runtime.ts';
import { compilerRoot, getWorkspacePaths } from '../platform/shared/paths.ts';
import { buildRuntimePackageManifest, loadRuntimeDependencySpec } from '../platform/shared/runtime-dependency-spec.ts';
import {
  getDependencyEnvironmentStatus,
  relinkProjectDependencies,
  formatDependencyEnvironmentStatus
} from '../platform/shared/dependency-environment.ts';

const activeTempDirs = new Set<string>();

afterAll(async () => {
  for (const directory of activeTempDirs) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

async function createTempRoot(prefix: string): Promise<string> {
  const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
  await fs.mkdir(workspaceParent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspaceParent, prefix));
  activeTempDirs.add(directory);
  return directory;
}

async function installRuntimeDeps(cwd: string): Promise<void> {
  const nextPackagePath = path.join(cwd, 'node_modules', 'next', 'package.json');
  await fs.mkdir(path.dirname(nextPackagePath), { recursive: true });
  await fs.writeFile(nextPackagePath, '{\n  "name": "next"\n}\n', 'utf8');
}

test('ensureSharedDepsReady serializes concurrent installs behind one lock', async () => {
  const tempRoot = await createTempRoot('engineering-compiler-shared-deps-');
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
});

test('root package exposes demo scripts through the existing platform chain', async () => {
  const rootPackage = JSON.parse(await fs.readFile(path.join(compilerRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  expect(rootPackage.scripts['demo:quickstart']).toBe('npm run platform -- init --reset && npm run reference:refresh');
  expect(rootPackage.scripts['demo:governance']).toBe(
    'npm run demo:quickstart && npm run platform -- artifacts --paths --kind governance'
  );
  expect(rootPackage.scripts['dogfood:reference']).toBe('npm run reference:refresh');
  expect(rootPackage.scripts['dogfood:governance']).toBe(
    'npm run dogfood:reference && npm run platform -- artifacts --paths --json'
  );
  expect(rootPackage.scripts['reference:refresh']).toBe(
    [
      'npm run platform -- resolve',
      'npm run platform -- compose',
      'npm run platform -- adapt',
      'npm run platform -- verify --lane all',
      'npm run platform -- lock',
      'npm run platform -- explain'
    ].join(' && ')
  );
});

test('test budget command documents slow lane boundaries', async () => {
  const rootPackage = JSON.parse(await fs.readFile(path.join(compilerRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const runnerSource = await fs.readFile(path.join(compilerRoot, 'platform', 'dev-runner.ts'), 'utf8');

  expect(rootPackage.scripts['test:budget']).toBe('bun ./platform/dev-runner.ts test-budget');
  expect(runnerSource).toContain("id: 'fast'");
  expect(runnerSource).toContain('nextBuild: false');
  expect(runnerSource).toContain('playwright: false');
  expect(runnerSource).toContain("id: 'all'");
  expect(runnerSource).toContain('nextBuild: true');
  expect(runnerSource).toContain('playwright: true');
});

test('project and shared runtime manifests derive versions from the root package.json', async () => {
  const workspaceRoot = await createTempRoot('engineering-compiler-runtime-manifest-');
  const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');

  await ensureProjectBase(workspaceRoot);
  await ensureSharedDepsReady({
    commandRunner: async (_command, _args, options) => {
      await installRuntimeDeps(options.cwd);
      return { code: 0, stdout: 'ok', stderr: '' };
    },
    sharedDepsRoot
  });

  const rootPackage = JSON.parse(await fs.readFile(path.join(compilerRoot, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const { projectPackagePath } = getWorkspacePaths(workspaceRoot);
  const projectPackage = JSON.parse(await fs.readFile(projectPackagePath, 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  const sharedPackage = JSON.parse(await fs.readFile(path.join(sharedDepsRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  expect(projectPackage.dependencies.next).toBe(rootPackage.dependencies?.next);
  expect(projectPackage.dependencies.react).toBe(rootPackage.dependencies?.react);
  expect(projectPackage.devDependencies['@types/node']).toBe(rootPackage.devDependencies?.['@types/node']);
  expect(projectPackage.devDependencies.typescript).toBe(rootPackage.dependencies?.typescript);
  expect(sharedPackage.dependencies).toEqual(projectPackage.dependencies);
  expect(sharedPackage.devDependencies).toEqual(projectPackage.devDependencies);
});

test('project base keeps Playwright traces and serializes runtime acceptance', async () => {
  const workspaceRoot = await createTempRoot('engineering-compiler-runtime-trace-');

  await ensureProjectBase(workspaceRoot);

  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const playwrightConfig = await fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8');
  expect(playwrightConfig).toContain("trace: 'retain-on-failure'");
  expect(playwrightConfig).toContain('workers: 1');
});

test('dependency bridge reuses the shared runtime cache when the project has no node_modules', async () => {
  const workspaceRoot = await createTempRoot('engineering-compiler-runtime-bridge-');
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const bridgePath = path.join(projectRoot, 'node_modules');

  await ensureProjectBase(workspaceRoot);
  await withProjectDependencyBridge(projectRoot, async () => {
    const bridgeStats = await fs.lstat(bridgePath);
    expect(bridgeStats.isSymbolicLink()).toBe(true);
    await expect(fs.stat(path.join(bridgePath, 'next', 'package.json'))).resolves.toBeDefined();
  });

  await expect(fs.stat(bridgePath)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('ensureProjectDependencies links shared cache without copying when project deps are cold', async () => {
  const workspaceRoot = await createTempRoot('engineering-compiler-runtime-link-');
  const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
  const runtimeSpec = await loadRuntimeDependencySpec();

  await ensureProjectBase(workspaceRoot);
  const { projectRoot } = getWorkspacePaths(workspaceRoot);

  await fs.mkdir(path.join(sharedDepsRoot, 'node_modules', 'next'), { recursive: true });
  await fs.writeFile(path.join(sharedDepsRoot, 'node_modules', 'next', 'package.json'), '{\n}\n', 'utf8');
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
    await fs.realpath(path.join(sharedDepsRoot, 'node_modules'))
  );
  expect(await readRuntimeDepsStamp(path.join(projectRoot, '.runtime-deps.stamp.json'))).toMatchObject({
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'bun'
  });
});

test('ensureProjectDependencies skips install when warm cache and matching stamps already exist', async () => {
  const workspaceRoot = await createTempRoot('engineering-compiler-runtime-skip-');
  const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
  const runtimeSpec = await loadRuntimeDependencySpec();

  await ensureProjectBase(workspaceRoot);
  const { projectRoot } = getWorkspacePaths(workspaceRoot);

  await fs.mkdir(path.join(sharedDepsRoot, 'node_modules', 'next'), { recursive: true });
  await fs.writeFile(path.join(sharedDepsRoot, 'node_modules', 'next', 'package.json'), '{\n}\n', 'utf8');
  await fs.writeFile(
    path.join(sharedDepsRoot, 'package.json'),
    `${JSON.stringify(buildRuntimePackageManifest('shared-runtime-deps', runtimeSpec), null, 2)}\n`,
    'utf8'
  );
  await writeRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'), {
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'bun',
    installedAt: '2026-01-01T00:00:00.000Z'
  });

  await fs.mkdir(path.join(projectRoot, 'node_modules', 'next'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'node_modules', 'next', 'package.json'), '{\n}\n', 'utf8');
  await writeRuntimeDepsStamp(path.join(projectRoot, '.runtime-deps.stamp.json'), {
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
});

test('ensureProjectDependencies installs locally when shared linking is disabled', async () => {
  const workspaceRoot = await createTempRoot('engineering-compiler-runtime-local-');
  const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
  const runtimeSpec = await loadRuntimeDependencySpec();

  await ensureProjectBase(workspaceRoot);
  const { projectRoot } = getWorkspacePaths(workspaceRoot);

  await fs.mkdir(path.join(sharedDepsRoot, 'node_modules', 'next'), { recursive: true });
  await fs.writeFile(path.join(sharedDepsRoot, 'node_modules', 'next', 'package.json'), '{\n}\n', 'utf8');
  await writeRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'), {
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'bun',
    installedAt: '2026-01-01T00:00:00.000Z'
  });

  let installCalls = 0;
  await ensureProjectDependencies(projectRoot, {
    commandRunner: async (_command, _args, options) => {
      installCalls += 1;
      await installRuntimeDeps(options.cwd);
      return { code: 0, stdout: 'ok', stderr: '' };
    },
    preferSharedCopy: false,
    sharedDepsRoot,
    skipSharedDepsWarmup: true
  });

  expect(installCalls).toBe(1);
  expect(await fs.realpath(path.join(projectRoot, 'node_modules'))).not.toBe(
    await fs.realpath(path.join(sharedDepsRoot, 'node_modules'))
  );
  expect(await readRuntimeDepsStamp(path.join(projectRoot, '.runtime-deps.stamp.json'))).toMatchObject({
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'bun'
  });
});

test('ensureProjectDependencies falls back to npm and still writes matching stamps', async () => {
  const workspaceRoot = await createTempRoot('engineering-compiler-runtime-fallback-');
  const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
  const runtimeSpec = await loadRuntimeDependencySpec();
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  let bunCalls = 0;
  let npmCalls = 0;

  await ensureProjectBase(workspaceRoot);

  await ensureProjectDependencies(projectRoot, {
    commandRunner: async (command, _args, options) => {
      if (command === 'bun') {
        bunCalls += 1;
        return { code: 1, stdout: '', stderr: 'bun failed' };
      }

      npmCalls += 1;
      await installRuntimeDeps(options.cwd);
      return { code: 0, stdout: 'npm ok', stderr: '' };
    },
    preferSharedCopy: false,
    sharedDepsRoot
  });

  expect(bunCalls).toBe(2);
  expect(npmCalls).toBe(2);
  expect(await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'))).toEqual({
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'npm',
    installedAt: expect.any(String)
  });
  expect(await readRuntimeDepsStamp(path.join(projectRoot, '.runtime-deps.stamp.json'))).toEqual({
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'npm',
    installedAt: expect.any(String)
  });
});

test('dependency environment reports dirty project dependency copies', async () => {
  const workspaceRoot = await createTempRoot('engineering-compiler-runtime-status-');
  const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
  const runtimeSpec = await loadRuntimeDependencySpec();

  await ensureProjectBase(workspaceRoot);
  const { projectRoot } = getWorkspacePaths(workspaceRoot);

  const sharedNextPackage = path.join(sharedDepsRoot, 'node_modules', 'next', 'package.json');
  await fs.mkdir(path.dirname(sharedNextPackage), { recursive: true });
  await fs.writeFile(sharedNextPackage, '{\n}\n', 'utf8');
  await writeRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'), {
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'bun',
    installedAt: '2026-01-01T00:00:00.000Z'
  });
  const projectNextPackage = path.join(projectRoot, 'node_modules', 'next', 'package.json');
  await fs.mkdir(path.dirname(projectNextPackage), { recursive: true });
  await fs.writeFile(projectNextPackage, '{\n}\n', 'utf8');
  await writeRuntimeDepsStamp(path.join(projectRoot, '.runtime-deps.stamp.json'), {
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'bun',
    installedAt: '2026-01-01T00:00:00.000Z'
  });

  const status = await getDependencyEnvironmentStatus(workspaceRoot, { sharedDepsRoot });

  expect(status.mode).toBe('dirty');
  expect(status.recommendedAction).toBe('platform deps relink project');
  expect(status.sharedNodeModules.entryCount).toBe(1);
  expect(formatDependencyEnvironmentStatus(status)).toContain('metadata');
  expect(formatDependencyEnvironmentStatus(status)).toContain('top-level entries');

  const relinkedStatus = await relinkProjectDependencies(workspaceRoot, { sharedDepsRoot });

  expect(relinkedStatus.mode).toBe('warm-project');
  expect(await fs.realpath(path.join(projectRoot, 'node_modules'))).toBe(
    await fs.realpath(path.join(sharedDepsRoot, 'node_modules'))
  );
});

test('reference refresh and shared cache contract stay anchored in repo metadata', async () => {
  const rootPackage = JSON.parse(await fs.readFile(path.join(compilerRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const gitignore = await fs.readFile(path.join(compilerRoot, '.gitignore'), 'utf8');

  expect(rootPackage.scripts['reference:refresh']).toBe(
    'npm run platform -- resolve && npm run platform -- compose && npm run platform -- adapt && npm run platform -- verify --lane all && npm run platform -- lock && npm run platform -- explain'
  );
  expect(gitignore).toContain('.shared-deps/');
});
