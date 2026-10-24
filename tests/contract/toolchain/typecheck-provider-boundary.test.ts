import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyInstalledNativeCheckerFixture, currentNativePackageName, selectNativeChecker, withCheckerExecutionBoundary, writeNativeCheckerFixture } from './typecheck-provider-fixture.ts';

import { compileRepositoryModuleMembershipSnapshot } from '../../../src/adapters/repository/architecture/contract.ts';
import {
  compileVirtualWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectFactIdentity,
  compileWorkspaceTypeScriptProjectInput,
  projectWorkspaceTypeScriptProjectFactIdentity
} from '../../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { createBoundedProcessDiagnosticObjectReceipt } from '../../../src/adapters/runtime-state/workspace-state/bounded-process-diagnostic-contract.ts';
import { currentSecRuntimePlatform, resolveSecRuntimeCacheRoot, secRuntimeStateEnvironment } from '../../../src/adapters/runtime-state/workspace-state/layout.ts';
import {
  compileTypecheckActionInput,
  compileTypecheckSemanticOperation,
  requireTypecheckSubordinateTerminal,
  resolveTypecheckBuildInfoPath,
  runTypecheckWithDependencyAuthority,
  runTypecheckWithProjectGenerationEvidence,
  runTypecheckWithProvider
} from '../../../src/adapters/self-hosting/development/runner/typecheck-runner.ts';
import { TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY, assertTypeScriptNativeChecker, canonicalTypeScriptDiagnosticArguments, executeTypeScriptNativeChecker, selectInstalledTypeScriptNativeChecker, typeScriptCheckerArguments } from '../../../src/adapters/toolchain/typescript/checker.ts';
import {
  createVerificationActionKey,
  issueProcessVerificationActionTerminalSettlement,
  issueVerificationActionOwnerTerminalReceipt,
  projectVerificationActionTerminal
} from '../../../src/adapters/verification/platform/action/contract/action.ts';
import { rawSha256, sha256 } from '../../../src/contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext
} from '../../../src/execution/operation/semantic.ts';

const DEPENDENCY_TRANSITION_DIGEST = `sha256:${'a'.repeat(64)}` as const;
const DEPENDENCY_GENERATION_DIGEST = `sha256:${'7'.repeat(64)}` as const;
const PROJECT_CONFIG_DIGEST = `sha256:${'b'.repeat(64)}` as const;

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
  return compileVirtualWorkspaceSourceSnapshot({
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
  return compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshotFixture(configSource, programSource, unrelatedSource),
    'tsconfig.json'
  );
}

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
    expect(firstProvider.packageAlias).toBe('@typescript/native');
    expect(firstProvider.wrapperDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(firstProvider.platformNativeExecutableDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(firstProvider.toolchainBindingDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
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

test('typecheck cheap fact admission matches the full ProjectInput identity', () => {
  const snapshot = workspaceSnapshotFixture();
  expect(compileWorkspaceTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', {
    dependencyGenerationDigest: null
  })).toEqual(projectWorkspaceTypeScriptProjectFactIdentity(
    compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json')
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
    const actionAt = (deadlineAtUnixMs: number) => createVerificationActionKey(
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
    expect(() => changed({
      projectInput: { ...projectInput } as typeof projectInput
    })).toThrow('was not issued');
    const baseSemanticOperation = semanticAt(1_900_000_000_000);
    expect(baseSemanticOperation.plan.execution.requirements.map(({ id, effectKinds }) => ({
      id, effectKinds
    }))).toEqual([
      { id: 'typescript.project-check', effectKinds: ['process'] },
      { id: 'verification.action-diagnostics', effectKinds: ['filesystem'] }
    ]);
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
