import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  resolveTypecheckBuildInfoPath,
  runTypecheckWithProvider
} from '../../src/development/runner/typecheck-runner.ts';
import { assertTypeScriptNativeChecker, canonicalTypeScriptDiagnosticArguments, resolveInstalledTypeScriptNativeChecker, selectInstalledTypeScriptNativeChecker, typeScriptCheckerArguments } from '../../src/toolchain/typescript/checker.ts';

const DEPENDENCY_TRANSITION_DIGEST = `sha256:${'a'.repeat(64)}` as const;
const PROJECT_CONFIG_DIGEST = `sha256:${'b'.repeat(64)}` as const;
const EXACT_TREE_SHA = '1'.repeat(40);
const FIXTURE_PROVIDER_VERSION = '1.0.0';

function currentNativePackageName(): `@typescript/typescript-${string}` {
  const suffix = `${process.platform}-${process.arch}`;
  if (!['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].includes(suffix)) {
    throw new Error(`Test host has no admitted native TypeScript package: ${suffix}`);
  }
  return `@typescript/typescript-${suffix}`;
}

async function writeNativeCheckerFixture(
  root: string,
  input: Readonly<{
    version?: string;
    nativeVersion?: string;
    wrapperBytes?: string;
    executableBytes?: string;
  }> = {}
): Promise<string> {
  const version = input.version ?? FIXTURE_PROVIDER_VERSION;
  const nativeVersion = input.nativeVersion ?? version;
  const nativePackageName = currentNativePackageName();
  const nodeModulesPath = path.join(root, 'node_modules');
  const aliasRoot = path.join(nodeModulesPath, '@typescript', 'native');
  const nativeRoot = path.join(nodeModulesPath, ...nativePackageName.split('/'));
  const executable = process.platform === 'win32' ? 'tsc.exe' : 'tsc';
  await Promise.all([
    fs.mkdir(path.join(aliasRoot, 'bin'), { recursive: true }),
    fs.mkdir(path.join(nativeRoot, 'lib'), { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(path.join(aliasRoot, 'package.json'), JSON.stringify({
      name: 'typescript',
      version,
      bin: { tsc: './bin/tsc' },
      optionalDependencies: { [nativePackageName]: version }
    })),
    fs.writeFile(path.join(aliasRoot, 'bin', 'tsc'), input.wrapperBytes ?? 'native-wrapper'),
    fs.writeFile(path.join(nativeRoot, 'package.json'), JSON.stringify({
      name: nativePackageName,
      version: nativeVersion
    })),
    fs.writeFile(path.join(nativeRoot, 'lib', executable), input.executableBytes ?? 'native-executable')
  ]);
  return nodeModulesPath;
}

test('native TypeScript checker identity comes from the selected installation bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-'));
  try {
    const nodeModulesPath = await writeNativeCheckerFixture(root);
    const checker = await resolveInstalledTypeScriptNativeChecker(nodeModulesPath);
    expect(checker.provider.packageAlias).toBe('@typescript/native');
    expect(checker.provider.providerRevision).toMatch(/^typescript@[0-9]+\.[0-9]+\.[0-9]+/u);
    expect(checker.provider.wrapperDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(checker.provider.platformNativeExecutableDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(checker.provider.toolchainBindingDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native checker selection fails closed without falling back to the programmatic API', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-unavailable-'));
  try {
    expect(await selectInstalledTypeScriptNativeChecker(path.join(root, 'node_modules')))
      .toMatchObject({ status: 'unavailable', reason: 'package-not-installed' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native checker rejects an alias and platform package from different revisions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-mismatch-'));
  try {
    const nodeModulesPath = await writeNativeCheckerFixture(root, { nativeVersion: '37.11.6' });
    expect(await selectInstalledTypeScriptNativeChecker(nodeModulesPath))
      .toMatchObject({ status: 'mismatch', reason: 'provider-version-mismatch' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native checker preserves unverified artifact failures as a terminal selection result', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-unverified-'));
  try {
    const nodeModulesPath = await writeNativeCheckerFixture(root);
    const wrapperPath = path.join(nodeModulesPath, '@typescript', 'native', 'bin', 'tsc');
    await fs.rm(wrapperPath);
    await fs.mkdir(wrapperPath);
    expect(await selectInstalledTypeScriptNativeChecker(nodeModulesPath))
      .toMatchObject({ status: 'unverified', reason: 'artifact-unreadable' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('incremental cache identity changes with configuration, dependency generation, or provider bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-cache-'));
  try {
    const compilerRootPath = path.join(root, 'compiler');
    const nodeModulesPath = await writeNativeCheckerFixture(compilerRootPath);
    const firstProvider = (await resolveInstalledTypeScriptNativeChecker(nodeModulesPath)).provider;
    const cacheRoot = path.join(root, 'cache');
    const identity = {
      provider: firstProvider,
      dependencyManifestHash: `sha256:${'e'.repeat(64)}`,
      dependencyTransitionDigest: DEPENDENCY_TRANSITION_DIGEST,
      exactTreeSha: EXACT_TREE_SHA,
      workingTreeDigest: `sha256:${'f'.repeat(64)}`,
      nodeModulesPath,
      projectConfigDigest: PROJECT_CONFIG_DIGEST,
      compilerRootPath,
      cacheRoot
    } as const;
    const first = resolveTypecheckBuildInfoPath(identity);
    expect(resolveTypecheckBuildInfoPath(identity)).toBe(first);
    expect(resolveTypecheckBuildInfoPath({
      ...identity,
      projectConfigDigest: `sha256:${'c'.repeat(64)}`
    })).not.toBe(first);
    expect(resolveTypecheckBuildInfoPath({
      ...identity,
      dependencyTransitionDigest: `sha256:${'d'.repeat(64)}`
    })).not.toBe(first);
    expect(resolveTypecheckBuildInfoPath({
      ...identity,
      exactTreeSha: '2'.repeat(40)
    })).not.toBe(first);
    expect(resolveTypecheckBuildInfoPath({
      ...identity,
      nodeModulesPath: path.join(root, 'other-node_modules')
    })).not.toBe(first);
    expect(resolveTypecheckBuildInfoPath({
      ...identity,
      workingTreeDigest: `sha256:${'0'.repeat(64)}`
    })).not.toBe(first);

    await fs.writeFile(path.join(nodeModulesPath, '@typescript', 'native', 'bin', 'tsc'), 'changed-wrapper');
    const changedProvider = (await resolveInstalledTypeScriptNativeChecker(nodeModulesPath)).provider;
    expect(resolveTypecheckBuildInfoPath({ ...identity, provider: changedProvider })).not.toBe(first);
    expect(() => resolveTypecheckBuildInfoPath({
      ...identity,
      cacheRoot: path.join(compilerRootPath, '.tmp')
    })).toThrow('outside the compiler tree');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('checker diagnostic arguments are canonical and cannot override checking semantics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-args-'));
  try {
    const provider = (await resolveInstalledTypeScriptNativeChecker(
      await writeNativeCheckerFixture(root)
    )).provider;
    expect(canonicalTypeScriptDiagnosticArguments([
      '--traceResolution', '--pretty', 'false', '--locale', 'en'
    ])).toEqual(['--locale', 'en', '--pretty', 'false', '--traceResolution']);
    const buildInfoFile = path.join(root, 'cache', 'tsconfig.tsbuildinfo');
    expect(typeScriptCheckerArguments(provider, buildInfoFile)).toEqual([
      '--noEmit', '-p', 'tsconfig.json', '--incremental', '--tsBuildInfoFile', path.resolve(buildInfoFile)
    ]);
    for (const args of [
      ['-p', 'other.json'], ['--project', 'other.json'], ['--noEmit'], ['--build'],
      ['--watch'], ['--incremental'], ['--tsBuildInfoFile', buildInfoFile], ['src/file.ts']
    ]) {
      expect(() => canonicalTypeScriptDiagnosticArguments(args)).toThrow('provider-owned');
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('native checker capability rejects structural substitutions at the effect boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-origin-'));
  try {
    const installed = await resolveInstalledTypeScriptNativeChecker(
      await writeNativeCheckerFixture(root)
    );
    const forged = { ...installed };
    expect(() => assertTypeScriptNativeChecker(forged)).toThrow('not issued by the native provider resolver');
    expect(() => assertTypeScriptNativeChecker(installed)).not.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('unsupported checker arguments fail before cache or process effects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-pre-effect-'));
  try {
    const nodeModulesPath = await writeNativeCheckerFixture(root);
    const installed = await resolveInstalledTypeScriptNativeChecker(nodeModulesPath);
    await expect(runTypecheckWithProvider({
      nodeModulesPath,
      manifestHash: 'fixture-manifest',
      requiresFreshProcess: false,
      source: 'existing',
      transitionDigest: DEPENDENCY_TRANSITION_DIGEST,
    }, installed, ['--project', 'other.json'])).rejects.toThrow('provider-owned');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
