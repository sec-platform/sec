import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { compileRepositoryModuleMembershipSnapshot } from '../../src/adapters/repository/architecture/contract.ts';
import {
  compileVirtualSnapshot,
  compileTypeScriptProjectFactIdentity,
  compileTypeScriptProjectInput,
  projectTypeScriptProjectFactIdentity
} from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import {
  inspectNoFollowDirectoryChain,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowSealedDirectoryGeneration,
  scanNoFollowDirectoryTreeInventory,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowProvenDirectoryGeneration,
  type RetainedNoFollowSealedDirectoryGeneration
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession
} from '../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import { sealExistingWindowsReadOnlyTreeAuthority } from '../../src/adapters/runtime-state/physical/runtime/windows-host-filesystem-authority.ts';
import { createBoundedProcessDiagnosticObjectReceipt } from '../../src/adapters/runtime-state/workspace-state/bounded-process-diagnostic-contract.ts';
import { currentRuntimePlatform, resolveRuntimeCacheRoot, runtimeStateEnvironment } from '../../src/adapters/runtime-state/workspace-state/layout.ts';
import {
  compileTypecheckActionInput,
  compileTypecheckSemanticOperation,
  requireTypecheckSubordinateTerminal,
  resolveTypecheckBuildInfoPath,
  runTypecheckWithDependencyAuthority,
  runTypecheckWithProjectGenerationEvidence,
  runTypecheckWithProvider
} from '../../src/adapters/self-hosting/development/runner/typecheck-runner.ts';
import { TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY, assertTypeScriptNativeChecker, canonicalTypeScriptDiagnosticArguments, executeTypeScriptNativeChecker, issueTypeScriptCheckerProcessExecutionAdmission, requireSelectedTypeScriptNativeChecker, selectInstalledTypeScriptNativeChecker, typeScriptCheckerArguments, type InstalledTypeScriptNativeChecker, type TypeScriptCheckerProcessExecutionAdmission } from '../../src/adapters/toolchain/typescript/checker.ts';
import {
  createVerificationActionKey,
  issueProcessVerificationActionTerminalSettlement,
  issueVerificationActionOwnerTerminalReceipt,
  projectVerificationActionTerminal
} from '../../src/adapters/verification/platform/action/contract/action.ts';
import { rawSha256, sha256 } from '../../src/contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../src/execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext
} from '../../src/execution/operation/semantic.ts';

const DEPENDENCY_TRANSITION_DIGEST = `sha256:${'a'.repeat(64)}` as const;
const DEPENDENCY_GENERATION_DIGEST = `sha256:${'7'.repeat(64)}` as const;
const PROJECT_CONFIG_DIGEST = `sha256:${'b'.repeat(64)}` as const;
const FIXTURE_PROVIDER_VERSION = '1.0.0';

function testDigest(value: unknown): `sha256:${string}` {
  return sha256(value) as `sha256:${string}`;
}

function testActionForOperation(
  operation: ReturnType<typeof compileTypecheckSemanticOperation>
) {
  return createVerificationActionKey({
    actionKind: 'typescript-project-typecheck-test',
    producer: { identity: 'typecheck-provider-boundary-test', revision: 'semantic-operation' },
    operation: {
      identity: 'typecheck-provider-boundary',
      revision: 'semantic-operation',
      semanticDigest: operation.plan.identity.identityDigest,
      workingDirectory: '.',
      declaredEnvironment: []
    },
    inputClosure: [],
    environment: {
      toolchainRevision: 'fixture',
      providerRevision: 'fixture',
      contractRevision: 'semantic-operation'
    },
    requiredCheapPreflightActionKeys: [],
    upstreamActionKeys: [],
    resultSchemaRevision: 'typecheck-provider-boundary-result'
  });
}

function issuePassedVerificationTerminalFixture() {
  const effectContractDigest = testDigest('typecheck-terminal-fixture-effect');
  const operation = bindSemanticOperation(
    compileSemanticOperationPlan({
      operation: 'verification.typecheck-terminal-fixture',
      intentDigest: testDigest('typecheck-terminal-fixture-intent'),
      decisionDigest: testDigest('typecheck-terminal-fixture-decision'),
      deadlineAtUnixMs: Date.now() + 30_000,
      aggregateBudgets: [{ resource: 'processes', maximum: 1 }],
      requirements: [{
        id: 'typescript.project-check',
        contractDigest: effectContractDigest,
        effectKinds: ['process'],
        failureKinds: ['process.failed']
      }],
      attempt: issueSemanticOperationAttemptContext({
        authorityGrantDigest: testDigest('typecheck-terminal-fixture-grant')
      })
    }),
    [compileCapabilityBinding({
      requirementId: 'typescript.project-check',
      contractDigest: effectContractDigest,
      providerIdentityDigest: testDigest('typecheck-terminal-fixture-provider')
    })]
  );
  const settlement = issueProviderSettlementReceipt(operation, {
    requirementId: 'typescript.project-check',
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: testDigest('typecheck-terminal-fixture-settlement')
  });
  const settlements = compileProviderSettlementSet(operation, [settlement]);
  const readback = issueNormalDomainReadbackReceipt(operation, settlements, {
    readbackContractDigest: testDigest('typecheck-terminal-fixture-readback-contract'),
    readbackReferenceDigest: testDigest('typecheck-terminal-fixture-readback'),
    currentPhysicalEpochDigest: testDigest('typecheck-terminal-fixture-epoch'),
    disposition: 'applied'
  });
  const join = issueNormalOwnerTerminalJoinReceipt(operation, settlements, readback, {
    ownerTerminalContractDigest: testDigest('typecheck-terminal-fixture-owner-contract'),
    ownerTerminalReferenceDigest: testDigest('typecheck-terminal-fixture-owner-reference')
  });
  const receipt = createBoundedProcessDiagnosticObjectReceipt({
    operationIdentityDigest: operation.plan.identity.identityDigest,
    executionPlanDigest: operation.plan.execution.executionPlanDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    subjectDigest: testDigest('typecheck-terminal-fixture-subject'),
    settlementDigest: settlements.providerSettlementSetDigest,
    stream: 'stderr',
    bytes: new TextEncoder().encode('typecheck terminal fixture diagnostic'),
    retainedUntilUnixMs: operation.plan.attempt.deadlineAtUnixMs
  });
  const readbackUnsigned = Object.freeze({
    disposition: 'current' as const,
    objectDigest: receipt.objectDigest,
    physicalIdentityDigest: testDigest('typecheck-terminal-fixture-diagnostic-physical'),
    contentDigest: receipt.contentDigest,
    byteLength: receipt.byteLength
  });
  const actionTerminal = issueVerificationActionOwnerTerminalReceipt({
    action: testActionForOperation(operation),
    operation,
    providerSettlementSet: settlements,
    readback,
    ownerTerminalProjection: join
  });
  return projectVerificationActionTerminal(issueProcessVerificationActionTerminalSettlement(actionTerminal, {
    status: 'passed',
    reasonCode: 'executed-success',
    diagnosticObjects: [Object.freeze({
      receipt,
      readback: Object.freeze({
        ...readbackUnsigned,
        readbackDigest: testDigest(readbackUnsigned)
      })
    })]
  }));
}

type TypecheckTerminalOutcomeFixture = Parameters<
  typeof requireTypecheckSubordinateTerminal
>[0];

/** Project the canonical runner outcome after an owner-issued terminal commit. */
function projectExecutedTypecheckOutcomeFixture(
  terminal: NonNullable<TypecheckTerminalOutcomeFixture['terminal']>,
  subordinateSettlement: string | null,
  disposition: Extract<TypecheckTerminalOutcomeFixture['disposition'], 'executed' | 'reused'> = 'executed'
): TypecheckTerminalOutcomeFixture {
  return Object.freeze({
    disposition,
    state: 'terminal',
    terminal,
    reason: null,
    subordinateSettlement
  });
}

async function withCheckerExecutionBoundary<T>(
  workingRoot: string,
  dependencyRoot: string,
  checker: InstalledTypeScriptNativeChecker,
  expectedProcessCount: 0 | 1,
  callback: (boundary: Readonly<{
    auxiliaryDirectory: RetainedNoFollowChildProcessDirectory;
    buildInfoFileName: 'tsconfig.tsbuildinfo';
    dependencyDirectory: RetainedNoFollowProvenDirectoryGeneration;
    processExecutionAdmission: TypeScriptCheckerProcessExecutionAdmission;
    workingDirectory: RetainedNoFollowSealedDirectoryGeneration;
  }>) => Promise<T>
): Promise<T> {
  const root = inspectNoFollowDirectoryChain(workingRoot, 'test immutable checker root').target;
  const inventory = scanNoFollowDirectoryTreeInventory(root, {
    deadlineAtMs: performance.now() + 30_000,
    maximumBytes: 16 * 1024 * 1024,
    maximumEntries: 256
  });
  const authority = await sealExistingWindowsReadOnlyTreeAuthority(
    root.path,
    inventory.filter(({ kind }) => kind !== 'link').map(({ relativePath }) => (
      path.join(root.path, ...relativePath.split('/'))
    )),
    {
      deadlineAtMs: Date.now() + 30_000,
      ownerRootPath: path.dirname(root.path),
      repositoryRootPath: process.cwd()
    }
  );
  const workingDirectory = await retainNoFollowSealedDirectoryGeneration(root, inventory, authority);
  const dependencyIdentity = inspectNoFollowDirectoryChain(
    dependencyRoot,
    'test checker dependency root'
  ).target;
  const dependencyInventory = scanNoFollowDirectoryTreeInventory(dependencyIdentity, {
    deadlineAtMs: performance.now() + 30_000,
    maximumBytes: 256 * 1024 * 1024,
    maximumEntries: 20_000
  });
  const dependencyTreeDigest = testDigest(dependencyInventory);
  const dependencyDirectory = (await materializeRetainedNoFollowProvenDirectoryGeneration({
    binding: {
      generationDigest: testDigest({ dependencyRoot, dependencyTreeDigest }),
      treeDigest: dependencyTreeDigest,
      treeEntryCount: dependencyInventory.length
    },
    deadlineAtUnixMs: Date.now() + 30_000,
    inventory: dependencyInventory,
    proofText: null,
    releaseMode: 'restore-owner-write',
    root: dependencyIdentity
  })).generation;
  const auxiliaryRoot = path.join(path.dirname(workingRoot), 'action-private-auxiliary');
  await fs.mkdir(auxiliaryRoot);
  const auxiliaryDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(auxiliaryRoot, 'test checker action-private auxiliary root'),
    4,
    'test checker action-private auxiliary root'
  );
  const operation = compileTypecheckSemanticOperation({
    checker,
    deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
    diagnosticArguments: [],
    projectConfigPath: checker.provider.projectConfig
  });
  const processSession = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId: 'typescript.project-check',
      resourceCeilings: [
        {
          resource: 'duration-ms',
          maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
        },
        { resource: 'input-bytes', maximum: 0 },
        {
          resource: 'output-bytes',
          maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
            + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes
        },
        { resource: 'processes', maximum: 1 }
      ]
    })
  });
  const processExecutionAdmission = issueTypeScriptCheckerProcessExecutionAdmission({
    checker,
    operation,
    processSession
  });
  try {
    return await callback(Object.freeze({
      auxiliaryDirectory,
      buildInfoFileName: 'tsconfig.tsbuildinfo',
      dependencyDirectory,
      processExecutionAdmission,
      workingDirectory
    }));
  } finally {
    const receipt = processSession.close();
    assertProcessResourceSessionReceipt(receipt, {
      operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      requirementId: 'typescript.project-check'
    });
    expect(receipt).toMatchObject({
      failedProcessCount: 0,
      processCount: expectedProcessCount,
      settledProcessCount: expectedProcessCount,
      successfulProcessRecordCount: expectedProcessCount
    });
    auxiliaryDirectory.dispose();
    await dependencyDirectory.retire();
    await workingDirectory.retire();
  }
}

function workspaceSnapshotFixture(
  configSource = '{"compilerOptions":{"strict":false}}',
  programSource = 'export const checked = true;\n',
  unrelatedSource = 'first projection\n'
) {
  const descriptorPath = 'src/example/module.json';
  const files = Object.freeze([
    Object.freeze({ path: 'tsconfig.json', source: configSource, contentDigest: rawSha256(configSource) }),
    Object.freeze({ path: 'src/example/checked.ts', source: programSource, contentDigest: rawSha256(programSource) }),
    Object.freeze({ path: 'docs/projection.md', source: unrelatedSource, contentDigest: rawSha256(unrelatedSource) })
  ]);
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
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
  return compileVirtualSnapshot({
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
}

function projectInputFixture(
  configSource = '{"compilerOptions":{"strict":false}}',
  programSource = 'export const checked = true;\n',
  unrelatedSource = 'first projection\n'
) {
  return compileTypeScriptProjectInput(
    workspaceSnapshotFixture(configSource, programSource, unrelatedSource),
    'tsconfig.json'
  );
}

function currentNativePackageName(): `@typescript/typescript-${string}` {
  const suffix = `${process.platform}-${process.arch}`;
  if (!/^[a-z0-9]+-[a-z0-9]+$/u.test(suffix)) {
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

async function copyInstalledNativeCheckerFixture(root: string): Promise<string> {
  const sourceNodeModulesPath = path.join(process.cwd(), 'node_modules');
  const targetNodeModulesPath = path.join(root, 'node_modules');
  const nativePackageName = currentNativePackageName();
  const relativeFiles = [
    path.join('@typescript', 'native', 'package.json'),
    path.join('@typescript', 'native', 'bin', 'tsc'),
    path.join(...nativePackageName.split('/'), 'package.json')
  ];
  for (const relativeFile of relativeFiles) {
    const target = path.join(targetNodeModulesPath, relativeFile);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(sourceNodeModulesPath, relativeFile), target);
  }
  const nativeLibraryRelativePath = path.join(...nativePackageName.split('/'), 'lib');
  await fs.cp(
    path.join(sourceNodeModulesPath, nativeLibraryRelativePath),
    path.join(targetNodeModulesPath, nativeLibraryRelativePath),
    { recursive: true }
  );
  return targetNodeModulesPath;
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

test('native checker selection consumes the caller operation deadline and cancellation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-selection-budget-'));
  try {
    const nodeModulesPath = path.join(root, 'node_modules');
    expect(await selectInstalledTypeScriptNativeChecker(nodeModulesPath, {
      deadlineAtUnixMs: Date.now() - 1
    })).toMatchObject({ status: 'unverified', reason: 'deadline-exhausted' });
    const controller = new AbortController();
    controller.abort();
    expect(await selectInstalledTypeScriptNativeChecker(nodeModulesPath, {
      deadlineAtUnixMs: Date.now() + 30_000,
      signal: controller.signal
    })).toMatchObject({ status: 'unverified', reason: 'cancelled' });
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

    const duplicateKeyRoot = path.join(root, 'duplicate-key');
    const duplicateKeyModules = await writeNativeCheckerFixture(duplicateKeyRoot);
    const manifestPath = path.join(duplicateKeyModules, '@typescript', 'native', 'package.json');
    const manifest = await fs.readFile(manifestPath, 'utf8');
    await fs.writeFile(
      manifestPath,
      manifest.replace('{"name":"typescript"', '{"name":"typescript","name":"typescript"')
    );
    expect(await selectInstalledTypeScriptNativeChecker(duplicateKeyModules))
      .toMatchObject({ status: 'unverified', reason: 'manifest-invalid' });
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
    const canonicalCacheRoot = resolveRuntimeCacheRoot({
      platform: currentRuntimePlatform(),
      environment: runtimeStateEnvironment(),
      repositoryRoot: compilerRootPath
    });
    const { cacheRoot: _fixtureCacheRoot, ...canonicalIdentity } = identity;
    const canonicalBuildInfo = resolveTypecheckBuildInfoPath(canonicalIdentity);
    expect(path.relative(canonicalCacheRoot, canonicalBuildInfo)).not.toMatch(/^\.\.(?:[\\/]|$)/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('typecheck cheap fact admission matches the full ProjectInput identity', () => {
  const snapshot = workspaceSnapshotFixture();
  expect(compileTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', {
    dependencyGenerationDigest: null
  })).toEqual(projectTypeScriptProjectFactIdentity(
    compileTypeScriptProjectInput(snapshot, 'tsconfig.json')
  ));
});

test('typecheck Action identity is route-neutral and excludes attempt time for one stable subject', async () => {
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
      checker: installed,
      deadlineAtUnixMs
    });
    const actionAt = (
      deadlineAtUnixMs: number,
      _observedProjectGenerationDigest = testDigest('typecheck-project-generation')
    ) => createVerificationActionKey(
      compileTypecheckActionInput({
        dependencies,
        dependencyGenerationDigest: DEPENDENCY_GENERATION_DIGEST,
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
        dependencyGenerationDigest: DEPENDENCY_GENERATION_DIGEST,
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
    expect(changed({ projectInput: projectInputFixture(undefined, undefined, 'second projection\n') }))
      .toBe(first.actionKey);
    expect(actionAt(1_900_000_000_000, testDigest('changed-typecheck-project-generation')).actionKey)
      .toBe(first.actionKey);
    expect(() => changed({
      projectInput: { ...projectInput } as typeof projectInput
    })).toThrow('was not issued');
    const baseSemanticOperation = semanticAt(1_900_000_000_000);
    const changedBudgetPlan = compileSemanticOperationPlan({
      operation: baseSemanticOperation.plan.identity.operation,
      intentDigest: baseSemanticOperation.plan.identity.intentDigest,
      decisionDigest: baseSemanticOperation.plan.identity.decisionDigest,
      deadlineAtUnixMs: 1_900_000_000_000,
      attempt: issueSemanticOperationAttemptContext({
        authorityGrantDigest: baseSemanticOperation.plan.attempt.authorityGrantDigest
      }),
      aggregateBudgets: baseSemanticOperation.plan.execution.aggregateBudgets.map((budget) => (
        budget.resource === 'duration-ms'
          ? { ...budget, maximum: budget.maximum + 1 }
          : budget
      )),
      requirements: baseSemanticOperation.plan.execution.requirements
    });
    const changedBudgetOperation = bindSemanticOperation(
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
    const changedInstalled = await selectNativeChecker(path.join(root, 'node_modules'));
    const changedProvider = changedInstalled.provider;
    expect(changed({
      semanticOperation: compileTypecheckSemanticOperation({
        projectConfigPath: changedProvider.projectConfig,
        diagnosticArguments: [],
        checker: changedInstalled,
        deadlineAtUnixMs: 1_900_000_000_000
      })
    })).toBe(first.actionKey);
    expect(changed({
      dependencyGenerationDigest: `sha256:${'6'.repeat(64)}`
    })).not.toBe(first.actionKey);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('typecheck terminal consumer requires one strict physically-clean subordinate settlement for PASS', () => {
  const passedTerminal = issuePassedVerificationTerminalFixture();
  const body = (input: Readonly<{
    cleanup?: Record<string, unknown>;
    execution?: Record<string, unknown>;
    readback?: Record<string, unknown>;
    setup?: Record<string, unknown>;
  }> = {}) => JSON.stringify({
    setup: input.setup ?? { status: 'complete', durationMs: 7 },
    execution: input.execution ?? {
      status: 'exited',
      exitCode: 0,
      stdoutDigest: testDigest('stdout'),
      stderrDigest: testDigest('stderr'),
      durationMs: 11
    },
    cleanup: input.cleanup ?? { status: 'physically-clean', durationMs: 3 },
    readback: input.readback ?? {
      status: 'current',
      reason: 'immutable-execution-generation-current'
    }
  });

  const executed = requireTypecheckSubordinateTerminal(
    projectExecutedTypecheckOutcomeFixture(passedTerminal, body())
  );
  expect(executed).toMatchObject({
    setup: { status: 'complete', durationMs: 7 },
    execution: { status: 'exited', exitCode: 0, durationMs: 11 },
    cleanup: { status: 'physically-clean', durationMs: 3 },
    readback: { status: 'current' }
  });
  expect(requireTypecheckSubordinateTerminal(
    projectExecutedTypecheckOutcomeFixture(passedTerminal, body(), 'reused')
  )).toEqual(executed);
  expect(() => requireTypecheckSubordinateTerminal({
    ...projectExecutedTypecheckOutcomeFixture(passedTerminal, null),
    terminal: null
  })).toThrow(expect.objectContaining({ kind: 'terminal-missing', status: 'blocked' }));
  for (const [subordinateSettlement, kind] of [
    [null, 'subordinate-missing'],
    ['not-json', 'subordinate-corrupt'],
    [body({ cleanup: { status: 'pending' } }), 'subordinate-corrupt'],
    [body({ setup: { status: 'complete', durationMs: -1 } }), 'subordinate-corrupt'],
    [body({ cleanup: {
      status: 'physical-residue',
      reason: 'physical-cleanup-failed',
      errorName: 'CleanupError',
      message: 'residue remains'
    } }), 'cleanup-unsettled'],
    [body({ execution: {
      status: 'exited',
      exitCode: 1,
      stdoutDigest: testDigest('stdout'),
      stderrDigest: testDigest('stderr')
    } }), 'pass-phase-mismatch']
  ] as const) {
    expect(() => requireTypecheckSubordinateTerminal(
      projectExecutedTypecheckOutcomeFixture(passedTerminal, subordinateSettlement)
    )).toThrow(expect.objectContaining({ kind, status: 'blocked' }));
  }
});

test('typecheck consumes Source Program input and joins checker plus retained diagnostics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-settlement-'));
  try {
    const installed = await selectNativeChecker(await writeNativeCheckerFixture(root));
    const operation = compileTypecheckSemanticOperation({
      projectConfigPath: installed.provider.projectConfig,
      diagnosticArguments: [],
      checker: installed,
      deadlineAtUnixMs: 1_900_000_000_000
    });
    expect(new Set(operation.plan.execution.requirements.flatMap(({ effectKinds }) => effectKinds)))
      .toEqual(new Set(['filesystem', 'process']));
    const checker = issueProviderSettlementReceipt(operation, {
      requirementId: 'typescript.project-check',
      physicalDisposition: 'unknown',
      providerSettlementReferenceDigest: testDigest('checker-handle-lost')
    });
    expect(() => compileProviderSettlementSet(operation, [])).toThrow(
      'exactly one receipt per requirement'
    );
    expect(() => compileProviderSettlementSet(operation, [checker])).toThrow(
      'exactly one receipt per requirement'
    );
    const diagnostic = issueProviderSettlementReceipt(operation, {
      requirementId: 'verification.action-diagnostics',
      physicalDisposition: 'settled',
      providerSettlementReferenceDigest: testDigest('diagnostic-object-settled')
    });
    const settlementSet = compileProviderSettlementSet(operation, [checker, diagnostic]);
    expect(settlementSet.settlements.map(({ requirementId, physicalDisposition }) => ({
      requirementId,
      physicalDisposition
    }))).toEqual(expect.arrayContaining([
      { requirementId: 'typescript.project-check', physicalDisposition: 'unknown' },
      { requirementId: 'verification.action-diagnostics', physicalDisposition: 'settled' }
    ]));
    const readback = issueNormalDomainReadbackReceipt(operation, settlementSet, {
      readbackContractDigest: testDigest('typecheck-readback-contract'),
      readbackReferenceDigest: testDigest('typecheck-input-invalidated'),
      currentPhysicalEpochDigest: testDigest('typecheck-current-physical-epoch'),
      disposition: 'unknown'
    });
    const terminalJoin = issueNormalOwnerTerminalJoinReceipt(
      operation,
      settlementSet,
      readback,
      {
        ownerTerminalContractDigest: testDigest('typecheck-action-terminal-contract'),
        ownerTerminalReferenceDigest: testDigest('typecheck-action-terminal-reference')
      }
    );
    const diagnosticReceipt = createBoundedProcessDiagnosticObjectReceipt({
      operationIdentityDigest: operation.plan.identity.identityDigest,
      executionPlanDigest: operation.plan.execution.executionPlanDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      subjectDigest: testDigest('typecheck-input-invalidated-diagnostic'),
      settlementDigest: settlementSet.providerSettlementSetDigest,
      stream: 'stderr',
      bytes: new TextEncoder().encode('typecheck input invalidated'),
      retainedUntilUnixMs: operation.plan.attempt.deadlineAtUnixMs
    });
    const diagnosticReadback = Object.freeze({
      disposition: 'current' as const,
      objectDigest: diagnosticReceipt.objectDigest,
      physicalIdentityDigest: testDigest('typecheck-input-invalidated-diagnostic-physical'),
      contentDigest: diagnosticReceipt.contentDigest,
      byteLength: diagnosticReceipt.byteLength
    });
    const actionTerminal = issueVerificationActionOwnerTerminalReceipt({
      action: testActionForOperation(operation),
      operation,
      providerSettlementSet: settlementSet,
      readback,
      ownerTerminalProjection: terminalJoin
    });
    const terminal = projectVerificationActionTerminal(
      issueProcessVerificationActionTerminalSettlement(actionTerminal, {
        status: 'invalidated',
        reasonCode: 'input-invalidated',
        diagnosticObjects: [Object.freeze({
          receipt: diagnosticReceipt,
          readback: Object.freeze({
            ...diagnosticReadback,
            readbackDigest: testDigest(diagnosticReadback)
          })
        })]
      })
    );
    expect(terminal).toMatchObject({
      status: 'invalidated',
      reasonCode: 'input-invalidated',
      boundAttemptDigest: terminalJoin.boundAttemptDigest,
      ownerTerminalReceiptDigest: actionTerminal.terminalReceiptDigest
    });
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
    expect(() => compileTypecheckSemanticOperation({
      checker: forged as never,
      deadlineAtUnixMs: 1_900_000_000_000,
      diagnosticArguments: [],
      projectConfigPath: installed.provider.projectConfig
    })).toThrow('not issued by the native provider resolver');
    expect(() => assertTypeScriptNativeChecker(installed)).not.toThrow();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('native checker admission rejects structural clones and checker transplants before process effects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-session-origin-'));
  try {
    const nodeModulesPath = await copyInstalledNativeCheckerFixture(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ files: [] }));
    const checker = await selectNativeChecker(nodeModulesPath);
    const reselectedChecker = await selectNativeChecker(nodeModulesPath);
    await withCheckerExecutionBoundary(
      projectRoot,
      nodeModulesPath,
      checker,
      0,
      async (boundary) => {
        await expect(executeTypeScriptNativeChecker(reselectedChecker, {
          ...boundary,
          deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
        })).rejects.toThrow('different checker capability');
        const forged = Object.freeze({ ...boundary.processExecutionAdmission });
        await expect(executeTypeScriptNativeChecker(checker, {
          ...boundary,
          deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
          processExecutionAdmission: forged as never
        })).rejects.toThrow('owner-issued process admission');
      }
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('native checker cannot cross into a different retained dependency generation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-root-binding-'));
  try {
    const checkerRoot = path.join(root, 'checker');
    const dependencyRoot = path.join(root, 'dependency');
    const checker = await selectNativeChecker(await writeNativeCheckerFixture(checkerRoot));
    const otherNodeModules = await writeNativeCheckerFixture(dependencyRoot);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    await withCheckerExecutionBoundary(projectRoot, otherNodeModules, checker, 0, async (boundary) => {
      expect(await executeTypeScriptNativeChecker(checker, {
        ...boundary,
        deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
      })).toMatchObject({
        status: 'unverified',
        reason: 'process-boundary-unavailable'
      });
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('issued checker rejects package or executable byte drift before incremental state effects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-drift-'));
  try {
    const packageFixture = path.join(root, 'package-drift');
    const packageModules = await writeNativeCheckerFixture(packageFixture);
    const packageBoundChecker = await selectNativeChecker(packageModules);
    await fs.appendFile(path.join(packageModules, '@typescript', 'native', 'package.json'), ' ');
    const packageProject = path.join(packageFixture, 'project');
    await fs.mkdir(packageProject);
    await withCheckerExecutionBoundary(packageProject, packageModules, packageBoundChecker, 0, async (boundary) => {
      expect(await executeTypeScriptNativeChecker(packageBoundChecker, {
        ...boundary,
        deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
      })).toMatchObject({ status: 'unverified', reason: 'provider-drift' });
      await expect(fs.stat(path.join(
        boundary.auxiliaryDirectory.childPath,
        boundary.buildInfoFileName
      ))).rejects.toMatchObject({ code: 'ENOENT' });

    });

    const executableFixture = path.join(root, 'executable-drift');
    const executableModules = await writeNativeCheckerFixture(executableFixture);
    const executableBoundChecker = await selectNativeChecker(executableModules);
    await fs.writeFile(path.join(
      executableModules,
      ...currentNativePackageName().split('/'),
      'lib',
      process.platform === 'win32' ? 'tsc.exe' : 'tsc'
    ), 'changed-native-executable');
    const executableProject = path.join(executableFixture, 'project');
    await fs.mkdir(executableProject);
    await withCheckerExecutionBoundary(executableProject, executableModules, executableBoundChecker, 0, async (boundary) => {
      expect(await executeTypeScriptNativeChecker(executableBoundChecker, {
        ...boundary,
        deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
      })).toMatchObject({ status: 'unverified', reason: 'provider-drift' });
      await expect(fs.stat(path.join(
        boundary.auxiliaryDirectory.childPath,
        boundary.buildInfoFileName
      ))).rejects.toMatchObject({ code: 'ENOENT' });
    });
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
    } as never, installed, ['--project', 'other.json'])).rejects.toThrow('provider-owned');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('typecheck action admission rejects a structural dependency result before terminal lookup', async () => {
  await expect(runTypecheckWithDependencyAuthority({
    executionGenerationAuthority: { generationDigest: DEPENDENCY_GENERATION_DIGEST },
    nodeModulesPath: path.resolve('node_modules'),
    manifestHash: 'caller-constructed',
    requiresFreshProcess: false,
    source: 'existing',
    transitionDigest: DEPENDENCY_TRANSITION_DIGEST
  } as never)).rejects.toThrow('was not materialized by this process');
});

test('typecheck runner rejects caller-constructed Source Program generation evidence before effects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-generation-origin-'));
  try {
    const nodeModulesPath = await writeNativeCheckerFixture(root);
    const installed = await selectNativeChecker(nodeModulesPath);
    await expect(runTypecheckWithProjectGenerationEvidence({
      nodeModulesPath,
      manifestHash: 'fixture-manifest',
      requiresFreshProcess: false,
      source: 'existing',
      transitionDigest: DEPENDENCY_TRANSITION_DIGEST
    } as never, installed, {
      generationDigest: sha256('forged-generation'),
      projectInput: projectInputFixture()
    } as never)).rejects.toThrow('was not issued by the Source Program owner');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('provider-issued native checker writes incremental state only inside its action-private auxiliary capability', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-effect-'));
  try {
    const nodeModulesPath = await copyInstalledNativeCheckerFixture(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'input.ts'), 'export const answer: number = 42;\n'),
      fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          incremental: true,
          noEmit: true,
          strict: true,
          types: []
        },
        files: ['input.ts']
      }))
    ]);
    const checker = await selectNativeChecker(nodeModulesPath);
    const result = await withCheckerExecutionBoundary(
      projectRoot,
      nodeModulesPath,
      checker,
      1,
      (boundary) => executeTypeScriptNativeChecker(checker, {
        ...boundary,
        deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
      })
    );
    expect(result).toMatchObject({ status: 'exited', code: 0 });
    expect((await fs.stat(path.join(
      root,
      'action-private-auxiliary',
      'tsconfig.tsbuildinfo'
    ))).isFile()).toBe(true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')('expired or cancelled native checker operation creates no incremental state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-native-typecheck-deadline-'));
  try {
    const nodeModulesPath = await copyInstalledNativeCheckerFixture(root);
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'tsconfig.json'), JSON.stringify({ files: [] }));
    const checker = await selectNativeChecker(nodeModulesPath);
    await withCheckerExecutionBoundary(
      projectRoot,
      nodeModulesPath,
      checker,
      0,
      async (boundary) => {
        expect(await executeTypeScriptNativeChecker(checker, {
          ...boundary,
          deadlineAtUnixMs: Date.now() - 1
        })).toMatchObject({ status: 'unverified', reason: 'deadline-exhausted' });
        const buildInfoFile = path.join(
          boundary.auxiliaryDirectory.childPath,
          boundary.buildInfoFileName
        );
        expect(await fs.stat(buildInfoFile).then(() => true, () => false)).toBe(false);
        const controller = new AbortController();
        controller.abort();
        expect(await executeTypeScriptNativeChecker(checker, {
          ...boundary,
          deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
          signal: controller.signal
        })).toMatchObject({ status: 'unverified', reason: 'cancelled' });
        expect(await fs.stat(buildInfoFile).then(() => true, () => false)).toBe(false);
      }
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
