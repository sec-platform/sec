import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  readSemanticMutationIsolatedPhaseTelemetry,
  resetSemanticMutationIsolatedPhaseTelemetry,
  type SemanticMutationIsolatedPhase
} from '../../platform/compiler/semantic-mutation/isolated-verification-phase-telemetry.ts';
import { assertIsolatedStagingTree } from '../../platform/compiler/verify/assert-isolated-staging-tree.ts';
import {
  assertRuntimeAcceptancePortAvailableForTests,
  assertRuntimeAcceptancePortReleasedForTests,
  buildIsolatedRuntimeAcceptanceEnvironment,
  buildIsolatedRuntimeAcceptanceEnvironmentForTests,
  buildIsolatedRuntimeEnvironment,
  buildIsolatedRuntimeEnvironmentFromSourceForTests,
  captureIsolatedRuntimeBuildNodeModulesProofForTests,
  createSkippedRuntimeLane,
  ensurePlaywrightBrowserForTests,
  isolatedPlaywrightBrowsersPath,
  normalizeRuntimeVerificationLog,
  resolveIsolatedRuntimeDependencySourcesForTests,
  revalidateIsolatedRuntimeBuildNodeModulesProofForTests,
  runRuntimeVerification,
  runtimeAcceptanceDirectChildReportedReadyForTests,
  runtimeTempDirectoryPathForTests,
  runtimeVerificationInvocation,
  withRuntimeAcceptanceCleanupForTests
} from '../../platform/compiler/verify/run-runtime-verification.ts';
import {
  RUNTIME_VERIFICATION_INVOCATION_CONTRACT
} from '../../platform/compiler/verify/runtime-verification-invocation-contract.ts';
import {
  semanticMutationIsolatedBrowserPath,
  semanticMutationIsolatedNodeExecutablePath
} from '../../platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts';
import {
  acquireBrowserLaunchPathForTests
} from '../../platform/compiler/verify/windows-browser-launch-path.ts';
import { listFilesRecursive, writeText } from '../../platform/shared/fs.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import { ensureIsolatedProcessDirectories, runCommand } from '../../platform/shared/process.ts';
import {
  ensureProjectDependencies,
  resolveExternalNodeRuntimeAuthority
} from '../../platform/shared/project-runtime.ts';
import {
  buildRuntimeDepsPreboundBinding,
  EXACT_PLAYWRIGHT_PACKAGE_NAMES,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE
} from '../../platform/shared/runtime-dependency-spec.ts';

const RUNTIME_PRECOMMAND_PHASES = [
  'runtime-test-discovery',
  'runtime-dependency-validation',
  'runtime-process-environment-materialize',
  'runtime-staging-tree-validation'
] as const satisfies readonly SemanticMutationIsolatedPhase[];

function metadata(
  identity: string,
  options: { readonly directory?: boolean; readonly symbolicLink?: boolean } = {}
) {
  return Object.freeze({
    identity,
    isDirectory: options.directory ?? true,
    isSymbolicLink: options.symbolicLink ?? false
  });
}

function pathProbe(input: {
  readonly realpaths: Readonly<Record<string, string>>;
  readonly metadata: Readonly<Record<string, ReturnType<typeof metadata>>>;
}) {
  return {
    lstat(value: string) {
      const result = input.metadata[value];
      if (!result) throw new Error('metadata is unavailable');
      return result;
    },
    realpath(value: string) {
      const result = input.realpaths[value];
      if (!result) throw new Error('physical path is unavailable');
      return result;
    }
  };
}

function shellPathMetadata(
  identity: string,
  kind: 'directory' | 'file',
  symbolicLink = false
) {
  return Object.freeze({
    identity,
    isDirectory: kind === 'directory',
    isFile: kind === 'file',
    isSymbolicLink: symbolicLink
  });
}

function shellPathProbe(input: {
  readonly metadata: Readonly<Record<string, ReturnType<typeof shellPathMetadata>>>;
  readonly realpaths: Readonly<Record<string, string>>;
}) {
  return {
    lstat(value: string) {
      const result = input.metadata[value];
      if (!result) throw new Error('metadata is unavailable');
      return result;
    },
    realpath(value: string) {
      const result = input.realpaths[value];
      if (!result) throw new Error('physical path is unavailable');
      return result;
    }
  };
}

async function runThroughShell(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<{ code: number; stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [], {
      cwd,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? -1, stderr, stdout }));
  });
}

async function captureFailure(execute: () => Promise<unknown>): Promise<NodeJS.ErrnoException> {
  try {
    await execute();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as NodeJS.ErrnoException;
  }
  throw new Error('Expected the real production operation to fail');
}

function failureContract(error: NodeJS.ErrnoException) {
  return {
    code: error.code,
    message: error.message,
    name: error.name
  };
}

async function writeCompleteRuntimeDependencyClosure(projectRoot: string): Promise<void> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const exactVersions = {
    ...runtimeSpec.dependencies,
    ...runtimeSpec.devDependencies
  };
  const nodeModulesRoot = path.join(projectRoot, 'node_modules');
  const packageNames = new Set([
    ...RUNTIME_DEPENDENCY_PACKAGE_NAMES,
    ...EXACT_PLAYWRIGHT_PACKAGE_NAMES
  ]);
  const playwrightRelease = runtimeSpec.devDependencies['@playwright/test'];
  for (const packageName of packageNames) {
    const manifestPath = path.join(nodeModulesRoot, ...packageName.split('/'), 'package.json');
    await mkdir(path.dirname(manifestPath), { recursive: true });
    const version = EXACT_PLAYWRIGHT_PACKAGE_NAMES.includes(
      packageName as (typeof EXACT_PLAYWRIGHT_PACKAGE_NAMES)[number]
    )
      ? playwrightRelease
      : exactVersions[packageName];
    await writeFile(manifestPath, `${JSON.stringify({ name: packageName, version })}\n`, 'utf8');
  }
  await writeFile(
    path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE),
    `${JSON.stringify(buildRuntimeDepsPreboundBinding(runtimeSpec))}\n`,
    'utf8'
  );
  await writeFile(
    path.join(projectRoot, '.runtime-deps.stamp.json'),
    `${JSON.stringify({
      installedAt: '2026-01-01T00:00:00.000Z',
      manifestHash: runtimeSpec.manifestHash,
      packageManager: 'bun'
    })}\n`,
    'utf8'
  );
}

test('runtime verification logs normalize elapsed durations', () => {
  expect(
    normalizeRuntimeVerificationLog('Ran 1 test across 1 file. [85.00ms]\n')
  ).toBe('Ran 1 test across 1 file. [duration]\n');
  expect(normalizeRuntimeVerificationLog('completed [1.2s]\n')).toBe('completed [duration]\n');
});

test('runtime invocation preserves non-isolated package-script behavior', () => {
  const projectRoot = path.resolve('runtime-project');
  expect(runtimeVerificationInvocation('build', projectRoot)).toEqual({
    command: 'bun',
    args: ['run', 'build']
  });
  expect(runtimeVerificationInvocation('unit', projectRoot)).toEqual({
    command: 'bun',
    args: ['run', 'test:unit']
  });
  expect(runtimeVerificationInvocation('acceptance', projectRoot)).toEqual({
    command: 'bun',
    args: ['run', 'test:acceptance']
  });
  expect(createSkippedRuntimeLane()).toMatchObject({
    build: { command: 'bun run build' },
    unit: { command: 'bun run test:unit' },
    acceptance: { command: 'bun run test:acceptance' }
  });
});

test('isolated runtime assigns staged Node to build and acceptance while Bun remains the unit leaf', () => {
  const projectRoot = path.resolve('runtime-project');
  const stagingRoot = path.resolve('isolated-staging-contract');
  const fixedConfigPath = path.join(stagingRoot, '.isolated-process', 'runtime', 'bunfig.toml');
  const stagedNode = semanticMutationIsolatedNodeExecutablePath(stagingRoot);
  const fixedArgs = ['--no-env-file', `--config=${fixedConfigPath}`, '--no-install'];
  expect(() => runtimeVerificationInvocation('build', projectRoot, true))
    .toThrow('requires its fixed staged executable');
  expect(() => runtimeVerificationInvocation('unit', projectRoot, true))
    .toThrow('requires a fixed config path');
  expect(runtimeVerificationInvocation('build', projectRoot, true, undefined, stagedNode)).toEqual({
    command: stagedNode,
    args: [
      path.join(
        projectRoot,
        'node_modules',
        ...RUNTIME_VERIFICATION_INVOCATION_CONTRACT.build.moduleRelativePath!.split('/')
      ),
      'build',
      '--webpack'
    ]
  });
  expect(runtimeVerificationInvocation('unit', projectRoot, true, fixedConfigPath, stagedNode)).toEqual({
    command: process.execPath,
    args: [...fixedArgs, 'test', 'tests/runtime/unit']
  });
  expect(runtimeVerificationInvocation(
    'acceptance', projectRoot, true, fixedConfigPath, stagedNode
  )).toEqual({
    command: stagedNode,
    args: [
      path.join(
        projectRoot,
        'node_modules',
        ...RUNTIME_VERIFICATION_INVOCATION_CONTRACT.acceptance.moduleRelativePath!.split('/')
      ),
      'test',
      '--config',
      'playwright.config.ts'
    ]
  });
  expect(path.relative(stagingRoot, fixedConfigPath).startsWith('..')).toBe(false);
});

test('isolated runtime executes direct canonical modules under staged external Node with an empty PATH', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-runtime-direct-modules-'));
  try {
    const projectRoot = path.join(root, 'project');
    const stagingRoot = path.join(root, 'staging');
    const fixedConfigPath = path.join(stagingRoot, '.isolated-process', 'runtime', 'bunfig.toml');
    const stagedNode = semanticMutationIsolatedNodeExecutablePath(stagingRoot);
    const nextCli = path.join(
      projectRoot,
      'node_modules',
      ...RUNTIME_VERIFICATION_INVOCATION_CONTRACT.build.moduleRelativePath!.split('/')
    );
    const acceptanceCli = path.join(
      projectRoot,
      'node_modules',
      ...RUNTIME_VERIFICATION_INVOCATION_CONTRACT.acceptance.moduleRelativePath!.split('/')
    );
    const outputPath = path.join(projectRoot, 'direct-module-argv.json');
    const recorder = [
      "import { writeFile } from 'node:fs/promises';",
      "await writeFile('direct-module-argv.json', JSON.stringify(process.argv.slice(2)));",
      ''
    ].join('\n');
    await Promise.all([
      mkdir(path.dirname(nextCli), { recursive: true }),
      mkdir(path.dirname(acceptanceCli), { recursive: true }),
      mkdir(path.dirname(fixedConfigPath), { recursive: true }),
      mkdir(path.dirname(stagedNode), { recursive: true })
    ]);
    const externalNode = await resolveExternalNodeRuntimeAuthority();
    await Promise.all([
      writeFile(nextCli, recorder, 'utf8'),
      writeFile(acceptanceCli, recorder, 'utf8'),
      writeFile(fixedConfigPath, '# isolated runtime\n', 'utf8'),
      copyFile(externalNode.executablePath, stagedNode)
    ]);
    const env = buildIsolatedRuntimeEnvironment(stagingRoot);
    expect(env.PATH).toBe('');

    for (const [step, expected] of [
      ['build', ['build', '--webpack']],
      ['acceptance', ['test', '--config', 'playwright.config.ts']]
    ] as const) {
      const invocation = runtimeVerificationInvocation(
        step, projectRoot, true, fixedConfigPath, stagedNode
      );
      const result = await runCommand(invocation.command, invocation.args, {
        cwd: projectRoot,
        env,
        envMode: 'replace'
      });
      expect(result.code).toBe(0);
      expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(expected);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('namespaced Windows runtime TEMP preserves one physical directory beyond the legacy limit', async () => {
  const windowsTemp = String.raw`D:\workspace\.isolated-process\runtime\tmp`;
  expect(runtimeTempDirectoryPathForTests(windowsTemp, 'win32'))
    .toBe(path.win32.toNamespacedPath(windowsTemp));
  expect(runtimeTempDirectoryPathForTests('/workspace/runtime/tmp', 'linux'))
    .toBe('/workspace/runtime/tmp');

  if (process.platform !== 'win32') return;
  const root = await mkdtemp(path.join(tmpdir(), 'sec-runtime-namespaced-temp-'));
  try {
    const stagingRoot = path.join(root, 'x'.repeat(64), 'y'.repeat(64));
    const physicalTemp = path.join(stagingRoot, '.isolated-process', 'runtime', 'tmp');
    await mkdir(physicalTemp, { recursive: true });
    const profilePrefix = 'playwright_chromiumdev_profile-';
    const ordinaryProfileResultLength = path.join(physicalTemp, profilePrefix).length + 6;
    expect(ordinaryProfileResultLength).toBeGreaterThan(247);

    const environment = buildIsolatedRuntimeEnvironment(stagingRoot);
    expect(environment.TEMP).toBe(path.win32.toNamespacedPath(physicalTemp));
    expect(environment.TMP).toBe(environment.TEMP);
    expect(environment.TMPDIR).toBe(environment.TEMP);
    const externalNode = await resolveExternalNodeRuntimeAuthority();
    const probe = [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'try {',
      `  const profile = fs.mkdtempSync(path.join(process.env.TEMP, ${JSON.stringify(profilePrefix)}));`,
      '  process.stdout.write(profile);',
      '  fs.rmSync(profile, { recursive: true, force: true });',
      '} catch (error) {',
      "  process.stderr.write(String(error && error.code));",
      '  process.exitCode = 17;',
      '}'
    ].join('\n');
    const ordinaryResult = await runCommand(externalNode.executablePath, ['-e', probe], {
      cwd: root,
      env: {
        ...environment,
        TEMP: physicalTemp,
        TMP: physicalTemp,
        TMPDIR: physicalTemp
      },
      envMode: 'replace'
    });
    expect(ordinaryResult.code).toBe(17);
    expect(ordinaryResult.stderr).toMatch(/ENAMETOOLONG|ENOENT/);

    const namespacedResult = await runCommand(externalNode.executablePath, ['-e', probe], {
      cwd: root,
      env: environment,
      envMode: 'replace'
    });
    const namespacePrefix = path.win32.toNamespacedPath('D:\\').slice(0, 4);
    expect(namespacedResult.code).toBe(0);
    expect(namespacedResult.stdout.startsWith(namespacePrefix)).toBe(true);
    expect(namespacedResult.stdout.slice(namespacePrefix.length).length).toBeGreaterThan(247);
  } finally {
    await rm(path.win32.toNamespacedPath(root), { recursive: true, force: true });
  }
});

test('isolated runtime accepts only a parent-issued launch path for its exact physical browser cache', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-runtime-browser-launch-binding-'));
  const stagingRoot = path.join(root, 'staging');
  const physicalBrowserCache = semanticMutationIsolatedBrowserPath(stagingRoot);
  const launchPath = path.join(root, 'launch-path');
  const outside = path.join(root, 'outside');
  await Promise.all([
    mkdir(physicalBrowserCache, { recursive: true }),
    mkdir(outside, { recursive: true })
  ]);
  try {
    const ordinary = buildIsolatedRuntimeEnvironment(stagingRoot);
    expect(ordinary.PLAYWRIGHT_BROWSERS_PATH).toBe(physicalBrowserCache);
    const reservedOverride = buildIsolatedRuntimeEnvironmentFromSourceForTests(
      stagingRoot,
      {},
      process.platform,
      {
        CI: 'false',
        PLAYWRIGHT_BROWSERS_PATH: outside,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0',
        SEC_ISOLATED_VERIFICATION: '0'
      }
    );
    expect(reservedOverride.CI).toBe('true');
    expect(reservedOverride.PLAYWRIGHT_BROWSERS_PATH).toBe(physicalBrowserCache);
    expect(reservedOverride.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD).toBe('1');
    expect(reservedOverride.SEC_ISOLATED_VERIFICATION).toBe('1');

    await symlink(
      physicalBrowserCache,
      launchPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const projected = buildIsolatedRuntimeEnvironmentFromSourceForTests(
      stagingRoot,
      {
        SEC_ISOLATED_VERIFICATION: '1',
        PLAYWRIGHT_BROWSERS_PATH: launchPath
      },
      process.platform
    );
    expect(projected.PLAYWRIGHT_BROWSERS_PATH).toBe(launchPath);
    await unlink(launchPath);

    await symlink(
      outside,
      launchPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect(() => buildIsolatedRuntimeEnvironmentFromSourceForTests(
      stagingRoot,
      {
        SEC_ISOLATED_VERIFICATION: '1',
        PLAYWRIGHT_BROWSERS_PATH: launchPath
      },
      process.platform
    )).toThrow('does not bind the staged browser cache');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('staged runtime verifier rejects a real Playwright target swap before the browser command spawns', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-runtime-playwright-target-swap-'));
  const stagingRoot = path.join(root, 'staging');
  const projectRoot = path.join(stagingRoot, 'project');
  const browserRoot = semanticMutationIsolatedBrowserPath(stagingRoot);
  const browserExecutableRelativePath = [
    'chromium_headless_shell-1217',
    'chrome-headless-shell-linux64',
    'chrome-headless-shell'
  ].join('/');
  const browserExecutable = path.join(browserRoot, ...browserExecutableRelativePath.split('/'));
  const outsideRoot = path.join(root, 'outside-browser');
  const outsideExecutable = path.join(outsideRoot, ...browserExecutableRelativePath.split('/'));
  const displacedBrowserRoot = `${browserRoot}.original`;
  const temporaryRoot = path.join(root, 'launch-authority');
  const previousIsolated = process.env.SEC_ISOLATED_VERIFICATION;
  const previousBrowsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  await Promise.all([
    mkdir(path.dirname(browserExecutable), { recursive: true }),
    mkdir(path.dirname(outsideExecutable), { recursive: true }),
    mkdir(path.join(projectRoot, 'tests', 'runtime', 'acceptance'), { recursive: true }),
    mkdir(path.dirname(semanticMutationIsolatedNodeExecutablePath(stagingRoot)), { recursive: true }),
    mkdir(temporaryRoot, { recursive: true })
  ]);
  await Promise.all([
    writeFile(browserExecutable, 'staged-browser', 'utf8'),
    writeFile(outsideExecutable, 'outside-browser', 'utf8'),
    writeFile(
      path.join(projectRoot, 'tests', 'runtime', 'acceptance', 'login.spec.ts'),
      'export {};\n',
      'utf8'
    ),
    copyFile(process.execPath, semanticMutationIsolatedNodeExecutablePath(stagingRoot)),
    writeCompleteRuntimeDependencyClosure(projectRoot)
  ]);
  const lease = await acquireBrowserLaunchPathForTests(
    browserRoot,
    browserExecutableRelativePath,
    {
      platform: 'linux',
      temporaryRoot
    }
  );
  process.env.SEC_ISOLATED_VERIFICATION = '1';
  process.env.PLAYWRIGHT_BROWSERS_PATH = lease.browsersPath;
  let playwrightInvocation: { command: string; args: string[] } | undefined;
  let playwrightSpawned = false;
  let targetSwapped = false;
  try {
    await expect(runRuntimeVerification(projectRoot, 'full', {
      acceptanceServerForTests: async (_request, execute) => {
        await rename(browserRoot, displacedBrowserRoot);
        await symlink(outsideRoot, browserRoot, process.platform === 'win32' ? 'junction' : 'dir');
        targetSwapped = true;
        try {
          return await execute();
        } finally {
          await unlink(browserRoot);
          await rename(displacedBrowserRoot, browserRoot);
        }
      },
      browserLaunchProofForTests: lease.proofArgument,
      commandRunnerForTests: async (command, args, options) => {
        const isPlaywright = args.some((argument) =>
          argument.replaceAll('\\', '/').endsWith('@playwright/test/cli.js'));
        if (isPlaywright) {
          playwrightInvocation = { command, args: [...args] };
          await options.beforeSpawn?.();
          playwrightSpawned = true;
        } else {
          await options.beforeSpawn?.();
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      emitTiming: false,
      isolated: true,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('Staged browser cache must be a physical directory');
    expect(targetSwapped).toBe(true);
    expect(playwrightInvocation?.command).toBe(semanticMutationIsolatedNodeExecutablePath(stagingRoot));
    expect(playwrightInvocation?.args.some((argument) =>
      argument.replaceAll('\\', '/').endsWith('@playwright/test/cli.js'))).toBe(true);
    expect(playwrightSpawned).toBe(false);
  } finally {
    if (previousIsolated === undefined) delete process.env.SEC_ISOLATED_VERIFICATION;
    else process.env.SEC_ISOLATED_VERIFICATION = previousIsolated;
    if (previousBrowsersPath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowsersPath;
    await lease.release().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test('isolated dependency sources split compiler generation from an external runtime host', () => {
  const worktreeRoot = path.resolve('external-worktree');
  const dependencyHost = path.resolve('dependency-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  const dependencyModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const result = resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget,
      [dependencyModules]: dependencyModules,
      [browserCache]: browserCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules'),
      [dependencyModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }));

  expect(result).toEqual({
    browserCache,
    compilerModulesRoot: physicalBridgeTarget,
    dependencyModules
  });
  expect(Object.isFrozen(result)).toBe(true);
});

test('isolated dependency sources unwrap a shared-deps node_modules target exactly once', () => {
  const worktreeRoot = path.resolve('shared-deps-worktree');
  const dependencyHost = path.resolve('shared-deps-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const dependencyModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: {
      [bridge]: dependencyModules,
      [dependencyModules]: dependencyModules,
      [browserCache]: browserCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [dependencyModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }))).toEqual({
    browserCache,
    compilerModulesRoot: dependencyModules,
    dependencyModules
  });
});

test('isolated dependency sources reuse the proven compiler generation when shared runtime is cold', () => {
  const worktreeRoot = path.resolve('cold-runtime-worktree');
  const dependencyHost = path.resolve('cold-runtime-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules')
    }
  }))).toEqual({
    browserCache: path.join(worktreeRoot, '.shared-deps', '.playwright-browsers'),
    compilerModulesRoot: physicalBridgeTarget,
    dependencyModules: physicalBridgeTarget
  });
});

test('isolated dependency sources reject aliased runtime modules and reuse the compiler generation', () => {
  const worktreeRoot = path.resolve('fallback-worktree');
  const dependencyHost = path.resolve('aliased-dependency-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  const dependencyModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const aliasedNodeModules = path.join(path.resolve('elsewhere'), 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget,
      [dependencyModules]: aliasedNodeModules,
      [browserCache]: browserCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules'),
      [dependencyModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }))).toEqual({
    browserCache,
    compilerModulesRoot: physicalBridgeTarget,
    dependencyModules: physicalBridgeTarget
  });
});

test('isolated dependency sources reject unstable runtime identity and reuse the compiler generation', () => {
  const worktreeRoot = path.resolve('unstable-modules-worktree');
  const dependencyHost = path.resolve('unstable-modules-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  const dependencyModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const stableProbe = pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget,
      [dependencyModules]: dependencyModules,
      [browserCache]: browserCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules'),
      [dependencyModules]: metadata('modules-before'),
      [browserCache]: metadata('cache')
    }
  });
  let nodeModulesReads = 0;
  const result = resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, {
    ...stableProbe,
    lstat(value: string) {
      if (value !== dependencyModules) return stableProbe.lstat(value);
      nodeModulesReads += 1;
      return metadata(nodeModulesReads === 1 ? 'modules-before' : 'modules-after');
    }
  });

  expect(result).toEqual({
    browserCache,
    compilerModulesRoot: physicalBridgeTarget,
    dependencyModules: physicalBridgeTarget
  });
});

test('isolated dependency sources fall back an aliased cache without discarding valid module roots', () => {
  const worktreeRoot = path.resolve('aliased-cache-worktree');
  const dependencyHost = path.resolve('aliased-cache-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  const dependencyModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const aliasedCache = path.join(path.resolve('elsewhere'), '.playwright-browsers');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget,
      [dependencyModules]: dependencyModules,
      [browserCache]: aliasedCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules'),
      [dependencyModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }))).toEqual({
    browserCache: path.join(worktreeRoot, '.shared-deps', '.playwright-browsers'),
    compilerModulesRoot: physicalBridgeTarget,
    dependencyModules
  });
});

test('isolated build root proof freezes and revalidates one physical bridge target', () => {
  const worktreeRoot = path.resolve('build-proof-worktree');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalRoot = path.join(path.resolve('build-proof-host'), 'node_modules');
  const probe = pathProbe({
    realpaths: { [bridge]: physicalRoot, [physicalRoot]: physicalRoot },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalRoot]: metadata('physical-root')
    }
  });

  const proof = captureIsolatedRuntimeBuildNodeModulesProofForTests(worktreeRoot, probe);
  expect(proof.buildNodeModulesRoot).toBe(physicalRoot);
  expect(Object.isFrozen(proof)).toBe(true);
  expect(Object.isFrozen(proof.bridgeMetadata)).toBe(true);
  expect(Object.isFrozen(proof.targetMetadata)).toBe(true);
  expect(revalidateIsolatedRuntimeBuildNodeModulesProofForTests(worktreeRoot, proof, probe))
    .toBe(physicalRoot);
});

test('isolated build root proof rejects bridge identity drift during revalidation', () => {
  const worktreeRoot = path.resolve('build-proof-drift-worktree');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalRoot = path.join(path.resolve('build-proof-drift-host'), 'node_modules');
  let bridgeReads = 0;
  const stableProbe = pathProbe({
    realpaths: { [bridge]: physicalRoot, [physicalRoot]: physicalRoot },
    metadata: {
      [bridge]: metadata('bridge-before', { directory: false, symbolicLink: true }),
      [physicalRoot]: metadata('physical-root')
    }
  });
  const probe = {
    ...stableProbe,
    lstat(value: string) {
      if (value !== bridge) return stableProbe.lstat(value);
      bridgeReads += 1;
      return metadata(bridgeReads <= 2 ? 'bridge-before' : 'bridge-after', {
        directory: false,
        symbolicLink: true
      });
    }
  };
  const proof = captureIsolatedRuntimeBuildNodeModulesProofForTests(worktreeRoot, probe);

  expect(() => revalidateIsolatedRuntimeBuildNodeModulesProofForTests(worktreeRoot, proof, probe))
    .toThrow('proof changed during bundle build');
});

test('isolated build root proof rejects physical target identity drift and aliases', () => {
  const worktreeRoot = path.resolve('build-proof-target-drift-worktree');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalRoot = path.join(path.resolve('build-proof-target-drift-host'), 'node_modules');
  let targetReads = 0;
  const driftProbe = pathProbe({
    realpaths: { [bridge]: physicalRoot, [physicalRoot]: physicalRoot },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalRoot]: metadata('physical-before')
    }
  });
  expect(() => captureIsolatedRuntimeBuildNodeModulesProofForTests(worktreeRoot, {
    ...driftProbe,
    lstat(value: string) {
      if (value !== physicalRoot) return driftProbe.lstat(value);
      targetReads += 1;
      return metadata(targetReads === 1 ? 'physical-before' : 'physical-after');
    }
  })).toThrow('could not be proven');

  const aliasRoot = path.join(path.resolve('build-proof-alias-host'), 'node_modules');
  expect(() => captureIsolatedRuntimeBuildNodeModulesProofForTests(worktreeRoot, pathProbe({
    realpaths: { [bridge]: physicalRoot, [physicalRoot]: aliasRoot },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalRoot]: metadata('physical-root')
    }
  }))).toThrow('could not be proven');
});

test('writable and staged Playwright caches remain rooted in their original owners', () => {
  const stagingRoot = path.resolve('isolated-staging-contract');
  expect(isolatedPlaywrightBrowsersPath()).toBe(
    path.join(compilerRoot, '.shared-deps', '.playwright-browsers')
  );
  expect(semanticMutationIsolatedBrowserPath(stagingRoot)).toBe(
    path.join(stagingRoot, '.isolated-process', 'playwright-browsers')
  );
});

test('runtime acceptance cleanup rejects an occupied loopback port and proves release by rebind', async () => {
  const server = createServer((socket) => {
    socket.end('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await expect(assertRuntimeAcceptancePortAvailableForTests(port)).rejects.toMatchObject({
      code: 'VERIFY-RUNTIME-PORT-OCCUPIED',
      port
    });
    await expect(assertRuntimeAcceptancePortReleasedForTests(port, 0)).rejects.toMatchObject({
      code: 'VERIFY-RUNTIME-PORT-RELEASE',
      port
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  await assertRuntimeAcceptancePortReleasedForTests(port, 1_000);
});

test('runtime acceptance readiness requires the direct Next child marker', () => {
  expect(runtimeAcceptanceDirectChildReportedReadyForTests('', '')).toBe(false);
  expect(runtimeAcceptanceDirectChildReportedReadyForTests(
    'foreign server returned HTTP 200',
    ''
  )).toBe(false);
  expect(runtimeAcceptanceDirectChildReportedReadyForTests(
    '▲ Next.js 16.2.4\n✓ Ready in 843ms\n',
    ''
  )).toBe(true);
});

test('runtime acceptance preserves execution and cleanup failures in one AggregateError', async () => {
  const executionError = new Error('injected acceptance execution failure');
  const cleanupError = new Error('injected port release failure');
  const failure = await withRuntimeAcceptanceCleanupForTests(
    async () => {
      throw executionError;
    },
    async () => {
      throw cleanupError;
    }
  ).then(
    () => undefined,
    (error: unknown) => error
  );
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([executionError, cleanupError]);
  expect((failure as Error).message).toBe(
    'Isolated runtime acceptance execution and server cleanup both failed'
  );
});

test('runtime acceptance shell environment is a minimal staged POSIX Node authority', () => {
  const stagingRoot = '/var/sec/staging';
  const nodeExecutable = semanticMutationIsolatedNodeExecutablePath(stagingRoot, 'linux');
  const nodeDirectory = path.posix.dirname(nodeExecutable);
  const environment = buildIsolatedRuntimeAcceptanceEnvironmentForTests(
    stagingRoot,
    {
      nodeExecutablePath: nodeExecutable,
      platform: 'linux',
      probe: shellPathProbe({
        metadata: {
          [nodeDirectory]: shellPathMetadata('node-directory', 'directory'),
          [nodeExecutable]: shellPathMetadata('node-executable', 'file')
        },
        realpaths: {
          [nodeDirectory]: nodeDirectory,
          [nodeExecutable]: nodeExecutable
        }
      }),
      source: {
        ComSpec: '/poison/cmd',
        NODE_OPTIONS: '--require=/poison.js',
        NODE_PATH: '/poison/modules',
        PATH: '/poison/bin',
        PATHEXT: '.POISON',
        SystemRoot: '/poison/windows',
        WINDIR: '/poison/windows'
      }
    }
  );

  expect(environment.PATH).toBe(nodeDirectory);
  for (const key of [
    'ComSpec', 'NODE_OPTIONS', 'NODE_PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR'
  ]) {
    expect(Object.keys(environment).some((candidate) => candidate.toLowerCase() === key.toLowerCase())).toBe(false);
  }

  const alternateExecutable = '/opt/host-node/bin/node';
  const alternateDirectory = path.posix.dirname(alternateExecutable);
  expect(() => buildIsolatedRuntimeAcceptanceEnvironmentForTests(
    stagingRoot,
    {
      nodeExecutablePath: alternateExecutable,
      platform: 'linux',
      probe: shellPathProbe({
        metadata: {
          [alternateDirectory]: shellPathMetadata('host-node-directory', 'directory'),
          [alternateExecutable]: shellPathMetadata('host-node', 'file')
        },
        realpaths: {
          [alternateDirectory]: alternateDirectory,
          [alternateExecutable]: alternateExecutable
        }
      }),
      source: {}
    }
  )).toThrow('exact staged executable');
});

test('runtime acceptance shell environment fixes one validated staged Windows Node authority', () => {
  const stagingRoot = String.raw`D:\staging`;
  const systemRoot = String.raw`C:\Windows`;
  const systemDirectory = String.raw`C:\Windows\System32`;
  const commandShell = String.raw`C:\Windows\System32\cmd.exe`;
  const taskkill = String.raw`C:\Windows\System32\taskkill.exe`;
  const nodeExecutable = semanticMutationIsolatedNodeExecutablePath(stagingRoot, 'win32');
  const nodeDirectory = path.win32.dirname(nodeExecutable);
  const probe = shellPathProbe({
    metadata: {
      [systemRoot]: shellPathMetadata('windows-root', 'directory'),
      [systemDirectory]: shellPathMetadata('system32', 'directory'),
      [commandShell]: shellPathMetadata('cmd', 'file'),
      [taskkill]: shellPathMetadata('taskkill', 'file'),
      [nodeDirectory]: shellPathMetadata('node-directory', 'directory'),
      [nodeExecutable]: shellPathMetadata('node-executable', 'file')
    },
    realpaths: {
      [systemRoot]: systemRoot,
      [systemDirectory]: systemDirectory,
      [commandShell]: commandShell,
      [taskkill]: taskkill,
      [nodeDirectory]: nodeDirectory,
      [nodeExecutable]: nodeExecutable
    }
  });
  const environment = buildIsolatedRuntimeAcceptanceEnvironmentForTests(
    stagingRoot,
    {
      nodeExecutablePath: nodeExecutable,
      platform: 'win32',
      probe,
      source: {
        ComSpec: String.raw`Z:\poison\cmd.exe`,
        NODE_OPTIONS: '--require=Z:\\poison.js',
        NODE_PATH: String.raw`Z:\poison\modules`,
        path: String.raw`Z:\poison`,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        SystemRoot: systemRoot,
        windir: systemRoot
      }
    }
  );

  expect(environment).toMatchObject({
    ComSpec: commandShell,
    PATH: `${systemDirectory};${nodeDirectory}`,
    PATHEXT: '.EXE',
    SystemRoot: systemRoot,
    WINDIR: systemRoot
  });
  for (const key of ['path', 'systemroot', 'windir', 'comspec', 'pathext']) {
    expect(Object.keys(environment).filter((candidate) => candidate.toLowerCase() === key).length).toBe(1);
  }
  expect(environment.PATH?.startsWith(`${systemDirectory};`)).toBe(true);
  expect(environment.PATH).not.toContain('poison');
  expect(environment.NODE_OPTIONS).toBeUndefined();
  expect(environment.NODE_PATH).toBeUndefined();
  expect(path.win32.join(environment.PATH!.split(';')[0]!, 'cmd.exe')).toBe(commandShell);
  expect(path.win32.join(environment.PATH!.split(';')[0]!, 'taskkill.exe')).toBe(taskkill);
});

test('runtime acceptance shell environment rejects ambiguous or non-physical Windows authority', () => {
  const stagingRoot = String.raw`D:\staging-negative`;
  const systemRoot = String.raw`C:\Windows`;
  const otherRoot = String.raw`D:\Windows`;
  const systemDirectory = String.raw`C:\Windows\System32`;
  const commandShell = String.raw`C:\Windows\System32\cmd.exe`;
  const taskkill = String.raw`C:\Windows\System32\taskkill.exe`;
  const nodeExecutable = semanticMutationIsolatedNodeExecutablePath(stagingRoot, 'win32');
  const nodeDirectory = path.win32.dirname(nodeExecutable);
  const hostNodeDirectory = String.raw`D:\HostNode`;
  const hostNodeExecutable = String.raw`D:\HostNode\node.exe`;
  const baseMetadata = {
    [systemRoot]: shellPathMetadata('windows-root', 'directory'),
    [otherRoot]: shellPathMetadata('other-root', 'directory'),
    [systemDirectory]: shellPathMetadata('system32', 'directory'),
    [commandShell]: shellPathMetadata('cmd', 'file'),
    [taskkill]: shellPathMetadata('taskkill', 'file'),
    [nodeDirectory]: shellPathMetadata('node-directory', 'directory'),
    [nodeExecutable]: shellPathMetadata('node-executable', 'file')
  };
  const baseRealpaths = Object.fromEntries(Object.keys(baseMetadata).map((value) => [value, value]));
  const build = (
    source: NodeJS.ProcessEnv,
    metadata = baseMetadata,
    realpaths: Readonly<Record<string, string>> = baseRealpaths,
    nodeExecutablePath = nodeExecutable
  ) => buildIsolatedRuntimeAcceptanceEnvironmentForTests(stagingRoot, {
    nodeExecutablePath,
    platform: 'win32',
    probe: shellPathProbe({ metadata, realpaths }),
    source
  });

  expect(() => build({ SystemRoot: 'Windows', WINDIR: 'Windows' })).toThrow('SystemRoot');
  expect(() => build({ SystemRoot: systemRoot, SYSTEMROOT: systemRoot, WINDIR: systemRoot }))
    .toThrow('one case-insensitive source');
  expect(() => build({ SystemRoot: systemRoot, WINDIR: otherRoot })).toThrow('one authority');
  expect(() => build(
    { SystemRoot: systemRoot, WINDIR: systemRoot },
    { ...baseMetadata, [commandShell]: shellPathMetadata('cmd-link', 'file', true) }
  )).toThrow('cmd.exe');
  expect(() => build(
    { SystemRoot: systemRoot, WINDIR: systemRoot },
    {
      ...baseMetadata,
      [hostNodeDirectory]: shellPathMetadata('host-node-directory', 'directory'),
      [hostNodeExecutable]: shellPathMetadata('host-node', 'file')
    },
    {
      ...baseRealpaths,
      [hostNodeDirectory]: hostNodeDirectory,
      [hostNodeExecutable]: hostNodeExecutable
    },
    hostNodeExecutable
  )).toThrow('exact staged executable');
  const metadataWithoutTaskkill = { ...baseMetadata } as Record<string, ReturnType<typeof shellPathMetadata>>;
  delete metadataWithoutTaskkill[taskkill];
  expect(() => build(
    { SystemRoot: systemRoot, WINDIR: systemRoot },
    metadataWithoutTaskkill
  )).toThrow('taskkill.exe');
  expect(() => build(
    { SystemRoot: systemRoot, WINDIR: systemRoot },
    baseMetadata,
    { ...baseRealpaths, [systemRoot]: String.raw`C:\RealWindows` }
  )).toThrow('SystemRoot');
});

test('runtime acceptance resolves only the staged external Node through a real shell', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-runtime-shell-authority-'));
  try {
    const stagingRoot = path.join(root, 'staging');
    const stagedNode = semanticMutationIsolatedNodeExecutablePath(stagingRoot);
    const externalNode = await resolveExternalNodeRuntimeAuthority();
    await mkdir(path.dirname(stagedNode), { recursive: true });
    await copyFile(externalNode.executablePath, stagedNode);
    const environment = buildIsolatedRuntimeAcceptanceEnvironment(stagingRoot);
    for (const value of [
      environment.HOME,
      environment.APPDATA,
      environment.LOCALAPPDATA,
      environment.TEMP,
      environment.PLAYWRIGHT_BROWSERS_PATH
    ]) {
      if (value) await mkdir(value, { recursive: true });
    }
    await writeFile(
      path.join(root, 'runtime-shell-probe.mjs'),
      "process.stdout.write(process.execPath);\n",
      'utf8'
    );

    const result = await runThroughShell(
      'node runtime-shell-probe.mjs',
      root,
      environment
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(await realpath(result.stdout.trim())).toBe(await realpath(stagedNode));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('non-isolated runtime verification delegates to the shared browser materializer and preserves failure bytes', async () => {
  const projectRoot = path.resolve('runtime-project');
  const environment = {
    PLAYWRIGHT_BROWSERS_PATH: path.resolve('canonical-browser-cache'),
    TEST_RUNTIME_ENV: 'preserved'
  };
  let calls = 0;
  const result = await ensurePlaywrightBrowserForTests(projectRoot, environment, {
    materialize: async (options) => {
      calls += 1;
      expect(options).toEqual({
        environment,
        playwrightProjectRoot: projectRoot,
        signal: undefined
      });
      return Object.freeze({
        browserCachePath: environment.PLAYWRIGHT_BROWSERS_PATH,
        browserExecutablePath: null,
        commandResult: { code: 17, stdout: 'partial', stderr: 'network unavailable' },
        source: null,
        status: 'failed' as const
      });
    }
  });

  expect(calls).toBe(1);
  expect(result).toEqual({ code: 17, stdout: 'partial', stderr: 'network unavailable' });
});

test('non-isolated runtime verification preserves fatal materializer failures', async () => {
  const failure = Object.assign(new Error('registry poisoned'), { code: 'RUNTIME-DEPS-005' });
  await expect(ensurePlaywrightBrowserForTests(path.resolve('runtime-project'), {}, {
    materialize: async () => {
      throw failure;
    }
  })).rejects.toBe(failure);
});

test('isolated runtime environment excludes live fallbacks and contains writable homes', () => {
  const stagingRoot = path.resolve('isolated-staging-contract');
  const environment = buildIsolatedRuntimeEnvironment(stagingRoot);
  expect(environment.PATH).toBe('');
  expect(environment.ComSpec).toBeUndefined();
  expect(environment.PATHEXT).toBeUndefined();
  expect(environment.NODE_OPTIONS).toBeUndefined();
  expect(environment.BUN_OPTIONS).toBeUndefined();
  expect(environment.HTTP_PROXY).toBeUndefined();
  expect(environment.OPENAI_API_KEY).toBeUndefined();
  expect(Object.values({
    HOME: environment.HOME,
    USERPROFILE: environment.USERPROFILE,
    APPDATA: environment.APPDATA,
    LOCALAPPDATA: environment.LOCALAPPDATA
  }).every((value) => typeof value === 'string' &&
    !path.relative(stagingRoot, value).startsWith('..') && !path.isAbsolute(path.relative(stagingRoot, value)))).toBe(true);
  const physicalBrowserCache = semanticMutationIsolatedBrowserPath(stagingRoot);
  expect(environment.PLAYWRIGHT_BROWSERS_PATH).toBe(physicalBrowserCache);
  const physicalTemp = path.join(stagingRoot, '.isolated-process', 'runtime', 'tmp');
  expect(environment.TEMP).toBe(runtimeTempDirectoryPathForTests(physicalTemp, process.platform));
  expect(environment.TMP).toBe(environment.TEMP);
  expect(environment.TMPDIR).toBe(environment.TEMP);
});

test('isolated runtime pre-command telemetry preserves each real failure boundary', async () => {
  for (const [phaseIndex, phase] of RUNTIME_PRECOMMAND_PHASES.entries()) {
    const root = await mkdtemp(path.join(tmpdir(), `sec-runtime-precommand-${phase}-`));
    try {
      const projectRoot = path.join(root, 'project');
      const stagingRoot = path.join(root, 'staging');
      await Promise.all([
        mkdir(projectRoot, { recursive: true }),
        mkdir(stagingRoot, { recursive: true })
      ]);

      const directFailure = await (async (): Promise<NodeJS.ErrnoException> => {
        switch (phase) {
          case 'runtime-test-discovery': {
            const runtimeTestsRoot = path.join(projectRoot, 'tests', 'runtime');
            const unitRoot = path.join(runtimeTestsRoot, 'unit');
            const acceptanceRoot = path.join(runtimeTestsRoot, 'acceptance');
            await mkdir(unitRoot, { recursive: true });
            await writeFile(path.join(unitRoot, 'ordered.test.ts'), 'export {};\n', 'utf8');
            await writeFile(acceptanceRoot, 'occupied', 'utf8');
            return captureFailure(async () => {
              await listFilesRecursive(unitRoot);
              await listFilesRecursive(acceptanceRoot);
            });
          }
          case 'runtime-dependency-validation':
            return captureFailure(() => ensureProjectDependencies(projectRoot, {
              installMode: 'prebound-only',
              skipSharedDepsWarmup: true
            }));
          case 'runtime-process-environment-materialize': {
            await writeCompleteRuntimeDependencyClosure(projectRoot);
            const isolatedRuntimeRoot = path.join(stagingRoot, '.isolated-process', 'runtime');
            const isolatedConfigPath = path.join(isolatedRuntimeRoot, 'bunfig.toml');
            await mkdir(isolatedConfigPath, { recursive: true });
            return captureFailure(async () => {
              await ensureIsolatedProcessDirectories(isolatedRuntimeRoot);
              await writeText(isolatedConfigPath, '# isolated runtime\n');
            });
          }
          case 'runtime-staging-tree-validation': {
            await writeCompleteRuntimeDependencyClosure(projectRoot);
            const firstPath = path.join(stagingRoot, '00-hardlink-a');
            await writeFile(firstPath, 'shared bytes', 'utf8');
            await link(firstPath, path.join(stagingRoot, '00-hardlink-b'));
            return captureFailure(() => assertIsolatedStagingTree(stagingRoot));
          }
        }
      })();

      await resetSemanticMutationIsolatedPhaseTelemetry(stagingRoot);
      const producerFailure = await captureFailure(() => runRuntimeVerification(
        projectRoot,
        'service',
        {
          emitTiming: false,
          isolated: true,
          stagingWorkspaceRoot: stagingRoot
        }
      ));
      expect(failureContract(producerFailure)).toEqual(failureContract(directFailure));

      const telemetry = await readSemanticMutationIsolatedPhaseTelemetry(stagingRoot);
      expect(telemetry.status).toBe('valid');
      if (telemetry.status !== 'valid') throw new Error('Pre-command telemetry was not readable');
      expect(telemetry.events.map(({ phase: eventPhase, state }) => [eventPhase, state]))
        .toEqual(RUNTIME_PRECOMMAND_PHASES.slice(0, phaseIndex + 1).flatMap((enteredPhase) => [
          [enteredPhase, 'started'],
          [enteredPhase, 'completed']
        ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('non-isolated runtime emits no isolated pre-command telemetry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-runtime-precommand-non-isolated-'));
  try {
    const projectRoot = path.join(root, 'project');
    const telemetryRoot = path.join(root, 'telemetry-root');
    await Promise.all([
      mkdir(projectRoot, { recursive: true }),
      mkdir(telemetryRoot, { recursive: true })
    ]);
    await writeCompleteRuntimeDependencyClosure(projectRoot);
    await resetSemanticMutationIsolatedPhaseTelemetry(telemetryRoot);

    const report = await runRuntimeVerification(projectRoot, 'service', {
      emitTiming: false,
      isolated: false,
      stagingWorkspaceRoot: telemetryRoot
    });
    expect(report.status).toBe('passed');

    const telemetry = await readSemanticMutationIsolatedPhaseTelemetry(telemetryRoot);
    expect(telemetry.status).toBe('valid');
    if (telemetry.status !== 'valid') throw new Error('Non-isolated telemetry was not readable');
    for (const phase of RUNTIME_PRECOMMAND_PHASES) {
      expect(telemetry.events.some((event) => event.phase === phase)).toBe(false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
