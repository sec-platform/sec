import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildIsolatedRuntimeEnvironment,
  captureIsolatedRuntimeBuildNodeModulesProofForTests,
  createSkippedRuntimeLane,
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

test('isolated dependency sources derive one curated pair from an external physical bridge host', () => {
  const worktreeRoot = path.resolve('external-worktree');
  const dependencyHost = path.resolve('dependency-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  const nodeModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const result = resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget,
      [nodeModules]: nodeModules,
      [browserCache]: browserCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules'),
      [nodeModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }));

  expect(result).toEqual({ nodeModules, browserCache });
  expect(Object.isFrozen(result)).toBe(true);
});

test('isolated dependency sources unwrap a shared-deps node_modules target exactly once', () => {
  const worktreeRoot = path.resolve('shared-deps-worktree');
  const dependencyHost = path.resolve('shared-deps-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const nodeModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: { [bridge]: nodeModules, [nodeModules]: nodeModules, [browserCache]: browserCache },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [nodeModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }))).toEqual({ nodeModules, browserCache });
});

test('isolated dependency sources reject an aliased node_modules and fall back as one local pair', () => {
  const worktreeRoot = path.resolve('fallback-worktree');
  const dependencyHost = path.resolve('aliased-dependency-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  const nodeModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const aliasedNodeModules = path.join(path.resolve('elsewhere'), 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget,
      [nodeModules]: aliasedNodeModules,
      [browserCache]: browserCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules'),
      [nodeModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }))).toEqual({
    nodeModules: path.join(worktreeRoot, '.shared-deps', 'node_modules'),
    browserCache: path.join(worktreeRoot, '.shared-deps', '.playwright-browsers')
  });
});

test('isolated dependency sources reject unstable node_modules identity as one local pair', () => {
  const worktreeRoot = path.resolve('unstable-modules-worktree');
  const dependencyHost = path.resolve('unstable-modules-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  const nodeModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const stableProbe = pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget,
      [nodeModules]: nodeModules,
      [browserCache]: browserCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules'),
      [nodeModules]: metadata('modules-before'),
      [browserCache]: metadata('cache')
    }
  });
  let nodeModulesReads = 0;
  const result = resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, {
    ...stableProbe,
    lstat(value: string) {
      if (value !== nodeModules) return stableProbe.lstat(value);
      nodeModulesReads += 1;
      return metadata(nodeModulesReads === 1 ? 'modules-before' : 'modules-after');
    }
  });

  expect(result).toEqual({
    nodeModules: path.join(worktreeRoot, '.shared-deps', 'node_modules'),
    browserCache: path.join(worktreeRoot, '.shared-deps', '.playwright-browsers')
  });
});

test('isolated dependency sources reject an aliased cache and fall back as one local pair', () => {
  const worktreeRoot = path.resolve('aliased-cache-worktree');
  const dependencyHost = path.resolve('aliased-cache-host');
  const bridge = path.join(worktreeRoot, 'node_modules');
  const physicalBridgeTarget = path.join(dependencyHost, 'node_modules');
  const nodeModules = path.join(dependencyHost, '.shared-deps', 'node_modules');
  const browserCache = path.join(dependencyHost, '.shared-deps', '.playwright-browsers');
  const aliasedCache = path.join(path.resolve('elsewhere'), '.playwright-browsers');
  expect(resolveIsolatedRuntimeDependencySourcesForTests(worktreeRoot, pathProbe({
    realpaths: {
      [bridge]: physicalBridgeTarget,
      [physicalBridgeTarget]: physicalBridgeTarget,
      [nodeModules]: nodeModules,
      [browserCache]: aliasedCache
    },
    metadata: {
      [bridge]: metadata('bridge', { directory: false, symbolicLink: true }),
      [physicalBridgeTarget]: metadata('physical-modules'),
      [nodeModules]: metadata('modules'),
      [browserCache]: metadata('cache')
    }
  }))).toEqual({
    nodeModules: path.join(worktreeRoot, '.shared-deps', 'node_modules'),
    browserCache: path.join(worktreeRoot, '.shared-deps', '.playwright-browsers')
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

test('isolated runtime environment excludes live fallbacks and contains writable homes', () => {
  const stagingRoot = path.resolve('isolated-staging-contract');
  const environment = buildIsolatedRuntimeEnvironment(stagingRoot);
  expect(environment.PATH).toBe('');
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
