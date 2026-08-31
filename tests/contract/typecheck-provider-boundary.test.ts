import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  compileVirtualWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput
} from '../../src/brownfield/source-program-model/workspace-source-snapshot.ts';
import {
  compileTypecheckActionInput,
  compileTypecheckSemanticOperation,
  resolveTypecheckBuildInfoPath,
  runTypecheckWithDependencyRoot,
  runTypecheckWithProvider
} from '../../src/development/runner/typecheck-runner.ts';
import { currentSecRuntimePlatform, resolveSecRuntimeCacheRoot, secRuntimeStateEnvironment } from '../../src/runtime-state/workspace-state/layout.ts';
import { rawSha256, sha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext
} from '../../src/system-architecture/operation/semantic.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../src/system-architecture/repository-modules/contract.ts';
import { TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY, assertTypeScriptNativeChecker, canonicalTypeScriptDiagnosticArguments, executeTypeScriptNativeChecker, requireSelectedTypeScriptNativeChecker, selectInstalledTypeScriptNativeChecker, typeScriptCheckerArguments } from '../../src/toolchain/typescript/checker.ts';
import { createVerificationActionKey } from '../../src/verification/action/contract/action.ts';

const DEPENDENCY_TRANSITION_DIGEST = `sha256:${'a'.repeat(64)}` as const;
const PROJECT_CONFIG_DIGEST = `sha256:${'b'.repeat(64)}` as const;
const FIXTURE_PROVIDER_VERSION = '1.0.0';

function projectInputFixture(
  configSource = '{"compilerOptions":{"strict":false}}',
  programSource = 'export const checked = true;\n'
) {
  const descriptorPath = 'src/example/sec.module.json';
  const files = Object.freeze([
    Object.freeze({ path: 'tsconfig.json', source: configSource, contentDigest: rawSha256(configSource) }),
    Object.freeze({ path: 'src/example/checked.ts', source: programSource, contentDigest: rawSha256(programSource) })
  ]);
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path: repositoryPath }) => repositoryPath), descriptorPath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [],
        preDependencyBootstrap: false
      })
    }]
  });
  const sourceRevision = sha256(files.map(({ path: repositoryPath, contentDigest }) => ({
    repositoryPath,
    contentDigest
  }))) as `sha256:${string}`;
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: Object.freeze({
      kind: 'virtual-mutation',
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: sha256('typecheck-project-input-fixture') as `sha256:${string}`,
        mutationDigest: sourceRevision
      })
    }),
    files,
    moduleMembership
  });
  return compileWorkspaceTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json');
}

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

async function selectNativeChecker(nodeModulesPath: string) {
  return requireSelectedTypeScriptNativeChecker(
    await selectInstalledTypeScriptNativeChecker(nodeModulesPath)
  );
}

test('native TypeScript checker identity comes from the selected installation bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-'));
  try {
    const nodeModulesPath = await writeNativeCheckerFixture(root);
    const checker = await selectNativeChecker(nodeModulesPath);
    expect(checker.provider.packageAlias).toBe('@typescript/native');
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

test('runner dependency-root admission preserves every non-selected provider status without fallback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-runner-selection-'));
  const dependencyInput = (nodeModulesPath: string) => ({
    nodeModulesPath,
    manifestHash: `sha256:${'8'.repeat(64)}`,
    requiresFreshProcess: false,
    source: 'existing' as const,
    transitionDigest: DEPENDENCY_TRANSITION_DIGEST
  });
  try {
    const unavailableRoot = path.join(root, 'unavailable', 'node_modules');
    await expect(runTypecheckWithDependencyRoot(dependencyInput(unavailableRoot)))
      .rejects.toMatchObject({ status: 'unavailable', reason: 'package-not-installed' });

    const mismatchRoot = await writeNativeCheckerFixture(path.join(root, 'mismatch'), {
      nativeVersion: '1.0.1'
    });
    await expect(runTypecheckWithDependencyRoot(dependencyInput(mismatchRoot)))
      .rejects.toMatchObject({ status: 'mismatch', reason: 'provider-version-mismatch' });

    const unverifiedRoot = await writeNativeCheckerFixture(path.join(root, 'unverified'));
    const wrapperPath = path.join(unverifiedRoot, '@typescript', 'native', 'bin', 'tsc');
    await fs.rm(wrapperPath);
    await fs.mkdir(wrapperPath);
    await expect(runTypecheckWithDependencyRoot(dependencyInput(unverifiedRoot)))
      .rejects.toMatchObject({ status: 'unverified', reason: 'artifact-unreadable' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('incremental cache seed is environment-scoped and changes with configuration, dependency generation, or provider bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-cache-'));
  try {
    const compilerRootPath = path.join(root, 'compiler');
    const nodeModulesPath = await writeNativeCheckerFixture(compilerRootPath);
    const firstProvider = (await selectNativeChecker(nodeModulesPath)).provider;
    const cacheRoot = path.join(root, 'cache');
    const identity = {
      provider: firstProvider,
      dependencyIdentityDigest: `sha256:${'e'.repeat(64)}` as const,
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
      dependencyIdentityDigest: `sha256:${'9'.repeat(64)}`
    })).not.toBe(first);
    expect(resolveTypecheckBuildInfoPath({
      ...identity,
      nodeModulesPath: path.join(root, 'other-node_modules')
    })).not.toBe(first);
    await fs.writeFile(path.join(nodeModulesPath, '@typescript', 'native', 'bin', 'tsc'), 'changed-wrapper');
    const changedProvider = (await selectNativeChecker(nodeModulesPath)).provider;
    expect(resolveTypecheckBuildInfoPath({ ...identity, provider: changedProvider })).not.toBe(first);
    expect(() => resolveTypecheckBuildInfoPath({
      ...identity,
      cacheRoot: path.join(compilerRootPath, '.tmp')
    })).toThrow('outside the compiler tree');
    const canonicalCacheRoot = resolveSecRuntimeCacheRoot({
      platform: currentSecRuntimePlatform(),
      environment: secRuntimeStateEnvironment(),
      repositoryRoot: compilerRootPath
    });
    const { cacheRoot: _fixtureCacheRoot, ...canonicalIdentity } = identity;
    const canonicalBuildInfo = resolveTypecheckBuildInfoPath(canonicalIdentity);
    expect(path.relative(canonicalCacheRoot, canonicalBuildInfo)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('typecheck Action identity excludes attempt time and keeps one reusable key for one stable subject', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-action-identity-'));
  try {
    const installed = await selectNativeChecker(await writeNativeCheckerFixture(root));
    const dependencies = {
      identityDigest: DEPENDENCY_TRANSITION_DIGEST,
      nodeModulesPath: path.join(root, 'node_modules'),
      requiresFreshProcess: false,
      source: 'existing' as const
    };
    const projectInput = projectInputFixture();
    const semanticAt = (deadlineAtUnixMs: number) => compileTypecheckSemanticOperation({
      projectConfigPath: installed.provider.projectConfig,
      diagnosticArguments: [],
      provider: installed.provider,
      deadlineAtUnixMs
    });
    const actionAt = (deadlineAtUnixMs: number) => createVerificationActionKey(
      compileTypecheckActionInput({
        dependencies,
        provider: installed.provider,
        projectInput,
        diagnosticArguments: [],
        semanticOperation: semanticAt(deadlineAtUnixMs)
      })
    );
    const first = actionAt(1_900_000_000_000);
    const laterAttempt = actionAt(1_900_000_000_001);
    expect(laterAttempt.actionKey).toBe(first.actionKey);
    expect(semanticAt(1_900_000_000_001).plan.attempt.deadlineAtUnixMs)
      .toBe(1_900_000_000_001);

    const changed = (input: Partial<Parameters<typeof compileTypecheckActionInput>[0]>) =>
      createVerificationActionKey(compileTypecheckActionInput({
        dependencies,
        provider: installed.provider,
        projectInput,
        diagnosticArguments: [],
        semanticOperation: semanticAt(1_900_000_000_000),
        ...input
      })).actionKey;
    expect(changed({ dependencies: { ...dependencies, identityDigest: `sha256:${'d'.repeat(64)}` } }))
      .not.toBe(first.actionKey);
    expect(changed({ projectInput: projectInputFixture('{"compilerOptions":{"strict":true}}') }))
      .not.toBe(first.actionKey);
    expect(changed({ projectInput: projectInputFixture(undefined, 'export const checked = false;\n') }))
      .not.toBe(first.actionKey);
    expect(() => changed({
      projectInput: { ...projectInput } as typeof projectInput
    })).toThrow('was not issued');
    const baseSemanticOperation = semanticAt(1_900_000_000_000);
    const changedBudgetPlan = compileSecSemanticOperationPlan({
      operation: baseSemanticOperation.plan.identity.operation,
      intentDigest: baseSemanticOperation.plan.identity.intentDigest,
      decisionDigest: baseSemanticOperation.plan.identity.decisionDigest,
      deadlineAtUnixMs: 1_900_000_000_000,
      attempt: issueSecSemanticOperationAttemptContext({
        authorityGrantDigest: baseSemanticOperation.plan.attempt.authorityGrantDigest
      }),
      aggregateBudgets: baseSemanticOperation.plan.execution.aggregateBudgets.map((budget) => (
        budget.resource === 'duration-ms'
          ? { ...budget, maximum: budget.maximum + 1 }
          : budget
      )),
      requirements: baseSemanticOperation.plan.execution.requirements
    });
    const changedBudgetOperation = bindSecSemanticOperation(
      changedBudgetPlan,
      baseSemanticOperation.bindings
    );
    expect(changedBudgetOperation.plan.identity.identityDigest)
      .toBe(baseSemanticOperation.plan.identity.identityDigest);
    expect(changedBudgetOperation.plan.execution.executionPlanDigest)
      .not.toBe(baseSemanticOperation.plan.execution.executionPlanDigest);
    expect(changedBudgetOperation.boundAttemptDigest)
      .not.toBe(baseSemanticOperation.boundAttemptDigest);
    expect(changed({ semanticOperation: changedBudgetOperation })).toBe(first.actionKey);
    await fs.writeFile(path.join(root, 'node_modules', '@typescript', 'native', 'bin', 'tsc'), 'changed-wrapper');
    const changedProvider = (await selectNativeChecker(path.join(root, 'node_modules'))).provider;
    expect(changed({
      provider: changedProvider,
      semanticOperation: compileTypecheckSemanticOperation({
        projectConfigPath: changedProvider.projectConfig,
        diagnosticArguments: [],
        provider: changedProvider,
        deadlineAtUnixMs: 1_900_000_000_000
      })
    })).not.toBe(first.actionKey);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('checker diagnostic arguments are canonical and cannot override checking semantics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-args-'));
  try {
    const provider = (await selectNativeChecker(
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
    const installed = await selectNativeChecker(
      await writeNativeCheckerFixture(root)
    );
    const forged = { ...installed };
    expect(() => assertTypeScriptNativeChecker(forged)).toThrow('not issued by the native provider resolver');
    expect(() => assertTypeScriptNativeChecker(installed)).not.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('issued checker rejects package or executable byte drift before incremental state effects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-drift-'));
  try {
    const nodeModulesPath = await writeNativeCheckerFixture(root);
    const packageManifestPath = path.join(nodeModulesPath, '@typescript', 'native', 'package.json');
    const nativeExecutablePath = path.join(
      nodeModulesPath,
      ...currentNativePackageName().split('/'),
      'lib',
      process.platform === 'win32' ? 'tsc.exe' : 'tsc'
    );
    const buildInfoFile = path.join(root, 'cache', 'tsconfig.tsbuildinfo');

    const packageBoundChecker = await selectNativeChecker(nodeModulesPath);
    await fs.appendFile(packageManifestPath, ' ');
    expect(await executeTypeScriptNativeChecker(packageBoundChecker, {
      buildInfoFile,
      deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
      workingDirectory: root
    })).toMatchObject({ status: 'unverified', reason: 'provider-drift' });
    await expect(fs.stat(buildInfoFile)).rejects.toMatchObject({ code: 'ENOENT' });

    const executableBoundChecker = await selectNativeChecker(nodeModulesPath);
    await fs.writeFile(nativeExecutablePath, 'changed-native-executable');
    expect(await executeTypeScriptNativeChecker(executableBoundChecker, {
      buildInfoFile,
      deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
      workingDirectory: root
    })).toMatchObject({ status: 'unverified', reason: 'provider-drift' });
    await expect(fs.stat(buildInfoFile)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('unsupported checker arguments fail before cache or process effects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-pre-effect-'));
  try {
    const nodeModulesPath = await writeNativeCheckerFixture(root);
    const installed = await selectNativeChecker(nodeModulesPath);
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

test('provider-issued native checker executes one bounded project and writes its incremental state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-effect-'));
  try {
    await Promise.all([
      fs.writeFile(path.join(root, 'input.ts'), 'export const answer: number = 42;\n'),
      fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          incremental: true,
          noEmit: true,
          strict: true,
          types: []
        },
        files: ['input.ts']
      }))
    ]);
    const buildInfoFile = path.join(root, '.state', 'typecheck.tsbuildinfo');
    await fs.mkdir(path.dirname(buildInfoFile), { recursive: true });
    const checker = await selectNativeChecker(
      path.join(process.cwd(), 'node_modules')
    );
    const result = await executeTypeScriptNativeChecker(checker, {
      buildInfoFile,
      deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
      workingDirectory: root
    });
    expect(result).toMatchObject({ status: 'exited', code: 0 });
    expect((await fs.stat(buildInfoFile)).isFile()).toBe(true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('expired or cancelled native checker operation creates no incremental state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-deadline-'));
  try {
    await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ files: [] }));
    const buildInfoFile = path.join(root, 'typecheck.tsbuildinfo');
    const checker = await selectNativeChecker(
      path.join(process.cwd(), 'node_modules')
    );
    expect(await executeTypeScriptNativeChecker(checker, {
      buildInfoFile,
      deadlineAtUnixMs: Date.now() - 1,
      workingDirectory: root
    })).toMatchObject({ status: 'unverified', reason: 'deadline-exhausted' });
    expect(await fs.stat(buildInfoFile).then(() => true, () => false)).toBe(false);
    const controller = new AbortController();
    controller.abort();
    expect(await executeTypeScriptNativeChecker(checker, {
      buildInfoFile,
      deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
      signal: controller.signal,
      workingDirectory: root
    })).toMatchObject({ status: 'unverified', reason: 'cancelled' });
    expect(await fs.stat(buildInfoFile).then(() => true, () => false)).toBe(false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
