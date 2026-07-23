import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildIsolatedRuntimeAcceptanceEnvironment,
  buildIsolatedRuntimeAcceptanceEnvironmentForTests,
  buildIsolatedRuntimeEnvironment,
  captureIsolatedRuntimeBuildNodeModulesProofForTests,
  createSkippedRuntimeLane,
  ensurePlaywrightBrowserForTests,
  isolatedPlaywrightBrowsersPath,
  normalizeRuntimeVerificationLog,
  resolveIsolatedRuntimeDependencySourcesForTests,
  revalidateIsolatedRuntimeBuildNodeModulesProofForTests,
  runtimeVerificationInvocation
} from '../../platform/compiler/verify/run-runtime-verification.ts';
import {
  RUNTIME_VERIFICATION_INVOCATION_CONTRACT
} from '../../platform/compiler/verify/runtime-verification-invocation-contract.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import { runCommand } from '../../platform/shared/process.ts';

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

test('isolated runtime invokes canonical modules with exact PATH-independent Bun argv', () => {
  const projectRoot = path.resolve('runtime-project');
  const stagingRoot = path.resolve('isolated-staging-contract');
  const fixedConfigPath = path.join(stagingRoot, '.isolated-process', 'runtime', 'bunfig.toml');
  const fixedArgs = ['--no-env-file', `--config=${fixedConfigPath}`, '--no-install'];
  expect(() => runtimeVerificationInvocation('build', projectRoot, true)).toThrow('requires a fixed config path');
  expect(runtimeVerificationInvocation('build', projectRoot, true, fixedConfigPath)).toEqual({
    command: process.execPath,
    args: [
      ...fixedArgs,
      path.join(
        projectRoot,
        'node_modules',
        ...RUNTIME_VERIFICATION_INVOCATION_CONTRACT.build.moduleRelativePath!.split('/')
      ),
      'build',
      '--webpack'
    ]
  });
  expect(runtimeVerificationInvocation('unit', projectRoot, true, fixedConfigPath)).toEqual({
    command: process.execPath,
    args: [...fixedArgs, 'test', 'tests/runtime/unit']
  });
  expect(runtimeVerificationInvocation('acceptance', projectRoot, true, fixedConfigPath)).toEqual({
    command: process.execPath,
    args: [
      ...fixedArgs,
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

test('isolated runtime executes direct canonical modules with an empty PATH', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-runtime-direct-modules-'));
  try {
    const projectRoot = path.join(root, 'project');
    const stagingRoot = path.join(root, 'staging');
    const fixedConfigPath = path.join(stagingRoot, '.isolated-process', 'runtime', 'bunfig.toml');
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
      mkdir(path.dirname(fixedConfigPath), { recursive: true })
    ]);
    await Promise.all([
      writeFile(nextCli, recorder, 'utf8'),
      writeFile(acceptanceCli, recorder, 'utf8'),
      writeFile(fixedConfigPath, '# isolated runtime\n', 'utf8')
    ]);
    const env = buildIsolatedRuntimeEnvironment(stagingRoot);
    expect(env.PATH).toBe('');

    for (const [step, expected] of [
      ['build', ['build', '--webpack']],
      ['acceptance', ['test', '--config', 'playwright.config.ts']]
    ] as const) {
      const invocation = runtimeVerificationInvocation(step, projectRoot, true, fixedConfigPath);
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
  expect(isolatedPlaywrightBrowsersPath(stagingRoot)).toBe(
    path.join(stagingRoot, '.isolated-process', 'playwright-browsers')
  );
});

test('runtime acceptance shell environment is a minimal POSIX Bun authority', () => {
  const bunDirectory = '/opt/sec-bun/bin';
  const bunExecutable = `${bunDirectory}/bun`;
  const environment = buildIsolatedRuntimeAcceptanceEnvironmentForTests(
    path.resolve('isolated-posix-acceptance'),
    {
      execPath: bunExecutable,
      platform: 'linux',
      probe: shellPathProbe({
        metadata: {
          [bunDirectory]: shellPathMetadata('bun-directory', 'directory'),
          [bunExecutable]: shellPathMetadata('bun-executable', 'file')
        },
        realpaths: {
          [bunDirectory]: bunDirectory,
          [bunExecutable]: bunExecutable
        }
      }),
      source: {
        ComSpec: '/poison/cmd',
        PATH: '/poison/bin',
        PATHEXT: '.POISON',
        SystemRoot: '/poison/windows',
        WINDIR: '/poison/windows'
      }
    }
  );

  expect(environment.PATH).toBe(bunDirectory);
  for (const key of ['ComSpec', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR']) {
    expect(Object.keys(environment).some((candidate) => candidate.toLowerCase() === key.toLowerCase())).toBe(false);
  }

  const alternateExecutable = `${bunDirectory}/bun-runtime`;
  expect(() => buildIsolatedRuntimeAcceptanceEnvironmentForTests(
    path.resolve('isolated-posix-acceptance-shadow'),
    {
      execPath: alternateExecutable,
      platform: 'linux',
      probe: shellPathProbe({
        metadata: {
          [bunDirectory]: shellPathMetadata('bun-directory', 'directory'),
          [alternateExecutable]: shellPathMetadata('running-bun', 'file'),
          [bunExecutable]: shellPathMetadata('shadow-bun', 'file')
        },
        realpaths: {
          [bunDirectory]: bunDirectory,
          [alternateExecutable]: alternateExecutable,
          [bunExecutable]: bunExecutable
        }
      }),
      source: {}
    }
  )).toThrow('bare Bun');
});

test('runtime acceptance shell environment fixes one validated Windows authority', () => {
  const systemRoot = String.raw`C:\Windows`;
  const systemDirectory = String.raw`C:\Windows\System32`;
  const commandShell = String.raw`C:\Windows\System32\cmd.exe`;
  const taskkill = String.raw`C:\Windows\System32\taskkill.exe`;
  const bunDirectory = String.raw`D:\Bun`;
  const bunExecutable = String.raw`D:\Bun\bun.exe`;
  const probe = shellPathProbe({
    metadata: {
      [systemRoot]: shellPathMetadata('windows-root', 'directory'),
      [systemDirectory]: shellPathMetadata('system32', 'directory'),
      [commandShell]: shellPathMetadata('cmd', 'file'),
      [taskkill]: shellPathMetadata('taskkill', 'file'),
      [bunDirectory]: shellPathMetadata('bun-directory', 'directory'),
      [bunExecutable]: shellPathMetadata('bun-executable', 'file')
    },
    realpaths: {
      [systemRoot]: systemRoot,
      [systemDirectory]: systemDirectory,
      [commandShell]: commandShell,
      [taskkill]: taskkill,
      [bunDirectory]: bunDirectory,
      [bunExecutable]: bunExecutable
    }
  });
  const environment = buildIsolatedRuntimeAcceptanceEnvironmentForTests(
    path.resolve('isolated-windows-acceptance'),
    {
      execPath: bunExecutable,
      platform: 'win32',
      probe,
      source: {
        ComSpec: String.raw`Z:\poison\cmd.exe`,
        path: String.raw`Z:\poison`,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        SystemRoot: systemRoot,
        windir: systemRoot
      }
    }
  );

  expect(environment).toMatchObject({
    ComSpec: commandShell,
    PATH: `${systemDirectory};${bunDirectory}`,
    PATHEXT: '.EXE',
    SystemRoot: systemRoot,
    WINDIR: systemRoot
  });
  for (const key of ['path', 'systemroot', 'windir', 'comspec', 'pathext']) {
    expect(Object.keys(environment).filter((candidate) => candidate.toLowerCase() === key).length).toBe(1);
  }
  expect(environment.PATH?.startsWith(`${systemDirectory};`)).toBe(true);
  expect(environment.PATH).not.toContain('poison');
  expect(path.win32.join(environment.PATH!.split(';')[0]!, 'cmd.exe')).toBe(commandShell);
  expect(path.win32.join(environment.PATH!.split(';')[0]!, 'taskkill.exe')).toBe(taskkill);
});

test('runtime acceptance shell environment rejects ambiguous or non-physical Windows authority', () => {
  const systemRoot = String.raw`C:\Windows`;
  const otherRoot = String.raw`D:\Windows`;
  const systemDirectory = String.raw`C:\Windows\System32`;
  const commandShell = String.raw`C:\Windows\System32\cmd.exe`;
  const taskkill = String.raw`C:\Windows\System32\taskkill.exe`;
  const bunDirectory = String.raw`D:\Bun`;
  const bunExecutable = String.raw`D:\Bun\bun.exe`;
  const alternateBunDirectory = String.raw`D:\Runtime`;
  const alternateBunExecutable = String.raw`D:\Runtime\bun-runtime.exe`;
  const alternateBareBunExecutable = String.raw`D:\Runtime\bun.exe`;
  const baseMetadata = {
    [systemRoot]: shellPathMetadata('windows-root', 'directory'),
    [otherRoot]: shellPathMetadata('other-root', 'directory'),
    [systemDirectory]: shellPathMetadata('system32', 'directory'),
    [commandShell]: shellPathMetadata('cmd', 'file'),
    [taskkill]: shellPathMetadata('taskkill', 'file'),
    [bunDirectory]: shellPathMetadata('bun-directory', 'directory'),
    [bunExecutable]: shellPathMetadata('bun-executable', 'file')
  };
  const baseRealpaths = Object.fromEntries(Object.keys(baseMetadata).map((value) => [value, value]));
  const build = (
    source: NodeJS.ProcessEnv,
    metadata = baseMetadata,
    realpaths: Readonly<Record<string, string>> = baseRealpaths,
    execPath = bunExecutable
  ) => buildIsolatedRuntimeAcceptanceEnvironmentForTests(path.resolve('isolated-windows-negative'), {
    execPath,
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
      [alternateBunDirectory]: shellPathMetadata('alternate-bun-directory', 'directory'),
      [alternateBunExecutable]: shellPathMetadata('running-bun', 'file'),
      [alternateBareBunExecutable]: shellPathMetadata('shadow-bun', 'file')
    },
    {
      ...baseRealpaths,
      [alternateBunDirectory]: alternateBunDirectory,
      [alternateBunExecutable]: alternateBunExecutable,
      [alternateBareBunExecutable]: alternateBareBunExecutable
    },
    alternateBunExecutable
  )).toThrow('bare Bun');
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

test('runtime acceptance resolves the exact running Bun through a real shell', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-runtime-shell-authority-'));
  try {
    const stagingRoot = path.join(root, 'staging');
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
      'bun --no-env-file --no-install runtime-shell-probe.mjs',
      root,
      environment
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(await realpath(result.stdout.trim())).toBe(await realpath(process.execPath));
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
    LOCALAPPDATA: environment.LOCALAPPDATA,
    TEMP: environment.TEMP,
    TMP: environment.TMP,
    TMPDIR: environment.TMPDIR,
    PLAYWRIGHT_BROWSERS_PATH: environment.PLAYWRIGHT_BROWSERS_PATH
  }).every((value) => typeof value === 'string' &&
    !path.relative(stagingRoot, value).startsWith('..') && !path.isAbsolute(path.relative(stagingRoot, value)))).toBe(true);
});
