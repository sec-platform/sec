import path from 'node:path';
import {
  acquireWorkingTreeWorkspaceSourceSnapshot,
  assertWorkspaceTypeScriptProjectInput,
  compileWorkspaceTypeScriptProjectInput,
  type WorkspaceTypeScriptProjectInput
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { compileSecOperationDemandGraph } from '../../control/operation/demand.ts';
import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import type { GitReadSession } from '../../external-capabilities/git-read/runtime/session.ts';
import { currentSecRuntimePlatform, resolveSecRuntimeCacheRoot, secRuntimeStateEnvironment } from '../../runtime-state/workspace-state/layout.ts';
import { acquireSecRuntimeCachePhysicalAuthority } from '../../runtime-state/workspace-state/physical-authority.ts';
import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecDomainOutcomeReceipt,
  issueSecOperationSettlementEnvelope,
  issueSecProviderSettlementReceipt,
  projectSecCapabilityDiagnostic,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecOperationSettlementEnvelope,
  type SecOperationTerminalClass
} from '../../system-architecture/operation/semantic.ts';
import { TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY, assertTypeScriptNativeChecker, canonicalTypeScriptDiagnosticArguments, executeTypeScriptNativeChecker, requireSelectedTypeScriptNativeChecker, selectInstalledTypeScriptNativeChecker, type InstalledTypeScriptNativeChecker, type TypeScriptNativeCheckerProvider } from '../../toolchain/typescript/checker.ts';
import { prepareTypeScriptIncrementalState } from '../../toolchain/typescript/incremental-state.ts';
import { type VerificationActionKeyDigest, type VerificationActionKeyInput } from '../../verification/action/contract/action.ts';
import {
  VerificationActionRunner
} from '../../verification/action/runner.ts';
import { compilerRoot, isPathInside } from '../../workspace/runtime/paths.ts';
import {
  ensureOperationDependencies,
  type OperationDependencyBootstrapResult
} from './dependency-bootstrap.ts';

const TYPECHECK_ACTION_KIND = 'typescript-project-typecheck' as const;
const TYPECHECK_ACTION_PRODUCER = Object.freeze({
  identity: 'src/development/runner/typecheck-runner',
  revision: 'native-checker-action'
});
const TYPECHECK_ACTION_OPERATION = Object.freeze({
  identity: 'project-typecheck',
  revision: 'native-checker-command'
});
const TYPECHECK_ACTION_CONTRACT = 'typescript-native-checker-action' as const;
const TYPECHECK_ACTION_RESULT = 'typescript-project-typecheck-terminal' as const;
const typecheckActionRunner = new VerificationActionRunner();
const TYPECHECK_SOURCE_OBSERVATION_BUDGET = Object.freeze({
  deadlineMs: 30_000,
  // One retained-provider identity probe plus two initial and two final
  // membership reads. The single live session owns all five attempts.
  maxProcesses: 5,
  maxStdoutBytes: 32 * 1024 * 1024,
  maxStderrBytes: 512 * 1024,
  maxRecords: 250_000
});

function actionDigest(value: unknown): VerificationActionKeyDigest {
  return sha256(value) as VerificationActionKeyDigest;
}

function requireActionDigest(value: string, label: string): VerificationActionKeyDigest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest before typecheck execution.`);
  }
  return value as VerificationActionKeyDigest;
}

function canonicalPathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function issueTypecheckOperationSettlement(
  operation: SecBoundSemanticOperation,
  input: Readonly<{
    actionKey: VerificationActionKeyDigest;
    providerTerminalClass: SecOperationTerminalClass;
    terminalClass: SecOperationTerminalClass;
    effectOutcome: unknown;
    readback: unknown;
    domainOutcome: unknown;
  }>
): SecOperationSettlementEnvelope {
  const providerSettlement = issueSecProviderSettlementReceipt(operation, {
    terminalClass: input.providerTerminalClass,
    providerSettlement: Object.freeze({
      actionKey: input.actionKey,
      effectOutcome: input.effectOutcome
    })
  });
  const domainOutcome = issueSecDomainOutcomeReceipt(providerSettlement, {
    terminalClass: input.terminalClass,
    effectReadback: Object.freeze({ actionKey: input.actionKey, readback: input.readback }),
    domainOutcome: Object.freeze({ actionKey: input.actionKey, outcome: input.domainOutcome })
  });
  return issueSecOperationSettlementEnvelope(operation, providerSettlement, domainOutcome);
}


export function compileTypecheckActionInput(input: Readonly<{
  dependencies: TypecheckBuildDependencyIdentity;
  provider: TypeScriptNativeCheckerProvider;
  projectInput: WorkspaceTypeScriptProjectInput;
  diagnosticArguments: readonly string[];
  semanticOperation: SecBoundSemanticOperation;
}>): VerificationActionKeyInput {
  assertWorkspaceTypeScriptProjectInput(input.projectInput);
  const dependencyAdmissionDigest = requireActionDigest(
    input.dependencies.identityDigest,
    'Typecheck dependency admission identity'
  );
  const projectConfigDigest = requireActionDigest(
    input.projectInput.projectConfigDigest,
    'Typecheck project configuration identity'
  );
  const projectInputDigest = requireActionDigest(
    input.projectInput.projectInputDigest,
    'Typecheck project input identity'
  );
  const provider = input.provider;
  const nodeModulesRootDigest = actionDigest({
    path: canonicalPathIdentity(input.dependencies.nodeModulesPath)
  });
  const runtimeDigest = actionDigest({
    toolchain: `bun@${Bun.version}`
  });
  const dependencyExecutionDigest = actionDigest({
    source: input.dependencies.source,
    requiresFreshProcess: input.dependencies.requiresFreshProcess
  });
  const diagnosticDigest = actionDigest({
    arguments: input.diagnosticArguments
  });
  const semanticDigest = input.semanticOperation.plan.identity.identityDigest;
  const executionPolicyDigest = actionDigest(TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY);
  return Object.freeze({
    actionKind: TYPECHECK_ACTION_KIND,
    producer: TYPECHECK_ACTION_PRODUCER,
    operation: Object.freeze({
      ...TYPECHECK_ACTION_OPERATION,
      semanticDigest,
      workingDirectory: '.',
      declaredEnvironment: Object.freeze([
        { name: 'dependency-admission', digest: dependencyAdmissionDigest },
        { name: 'dependency-execution', digest: dependencyExecutionDigest },
        { name: 'diagnostic-arguments', digest: diagnosticDigest },
        { name: 'node-modules-root', digest: nodeModulesRootDigest },
        { name: 'project-input', digest: projectInputDigest },
        { name: 'project-config', digest: projectConfigDigest },
        { name: 'semantic-capability-binding', digest: input.semanticOperation.bindingSetIdentityDigest },
        { name: 'semantic-operation-identity', digest: input.semanticOperation.plan.identity.identityDigest },
        { name: 'provider-binding', digest: provider.toolchainBindingDigest },
        { name: 'provider-native-executable', digest: provider.platformNativeExecutableDigest },
        { name: 'provider-native-manifest', digest: provider.platformNativeManifestDigest },
        { name: 'provider-package-manifest', digest: provider.packageManifestDigest },
        { name: 'provider-wrapper', digest: provider.wrapperDigest },
        { name: 'process-policy', digest: executionPolicyDigest },
        { name: 'toolchain-runtime', digest: runtimeDigest }
      ])
    }),
    inputClosure: Object.freeze([
      { path: 'dependency/admission', digest: dependencyAdmissionDigest },
      { path: 'repository/typescript-input', digest: projectInputDigest },
      { path: 'provider/alias-package.json', digest: provider.packageManifestDigest },
      { path: 'provider/native-executable', digest: provider.platformNativeExecutableDigest },
      { path: 'provider/native-manifest.json', digest: provider.platformNativeManifestDigest },
      { path: 'provider/toolchain-binding', digest: provider.toolchainBindingDigest },
      { path: 'provider/wrapper', digest: provider.wrapperDigest },
      { path: 'provider/process-policy', digest: executionPolicyDigest },
      { path: 'semantic/capability-binding', digest: input.semanticOperation.bindingSetIdentityDigest },
      { path: 'semantic/operation-identity', digest: input.semanticOperation.plan.identity.identityDigest },
      { path: 'tsconfig.json', digest: projectConfigDigest }
    ]),
    environment: Object.freeze({
      toolchainRevision: `bun@${Bun.version}`,
      providerRevision: provider.toolchainBindingDigest,
      contractRevision: TYPECHECK_ACTION_CONTRACT
    }),
    requiredCheapPreflightActionKeys: Object.freeze([]),
    upstreamActionKeys: Object.freeze([]),
    resultSchemaRevision: TYPECHECK_ACTION_RESULT
  });
}

export function compileTypecheckSemanticOperation(input: Readonly<{
  projectConfigPath: string;
  diagnosticArguments: readonly string[];
  provider: TypeScriptNativeCheckerProvider;
  deadlineAtUnixMs: number;
}>): SecBoundSemanticOperation {
  if (input.projectConfigPath !== input.provider.projectConfig) {
    throw new Error('Typecheck semantic operation project config must come from the selected provider.');
  }
  const checkerContractDigest = actionDigest({
    operation: 'verification.typecheck',
    projectConfig: 'tsconfig.json',
    noEmit: true,
    incremental: true
  }) as SecOperationDigest;
  const sourceObservationContractDigest = actionDigest({
    operation: 'verification.typecheck.source-observation',
    subject: 'working-tree-source-program'
  }) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'verification.typecheck',
    intentDigest: actionDigest({
      projectConfigPath: input.projectConfigPath,
      diagnosticProjection: input.diagnosticArguments
    }) as SecOperationDigest,
    decisionDigest: actionDigest({
      checkerContractDigest,
      sourceObservationContractDigest
    }) as SecOperationDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    aggregateBudgets: [
      {
        resource: 'duration-ms',
        maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
      },
      {
        resource: 'output-bytes',
        maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
          + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes
          + TYPECHECK_SOURCE_OBSERVATION_BUDGET.maxProcesses * (
            TYPECHECK_SOURCE_OBSERVATION_BUDGET.maxStdoutBytes
            + TYPECHECK_SOURCE_OBSERVATION_BUDGET.maxStderrBytes
          )
      },
      { resource: 'processes', maximum: TYPECHECK_SOURCE_OBSERVATION_BUDGET.maxProcesses + 1 },
      { resource: 'records', maximum: TYPECHECK_SOURCE_OBSERVATION_BUDGET.maxRecords }
    ],
    requirements: [
      {
        id: 'repository.source-observation',
        contractDigest: sourceObservationContractDigest,
        effectKinds: ['process'],
        failureKinds: [
          'provider.cancelled',
          'provider.deadline-exhausted',
          'provider.drift',
          'provider.unavailable',
          'provider.unverified'
        ]
      },
      {
        id: 'typescript.project-check',
        contractDigest: checkerContractDigest,
        effectKinds: ['process'],
        failureKinds: [
          'provider.cancelled',
          'provider.deadline-exhausted',
          'provider.drift',
          'provider.execution-failed',
          'provider.unavailable',
          'provider.unverified'
        ]
      }
    ]
  });
  return bindSecSemanticOperation(plan, [
    compileSecCapabilityBinding({
      requirementId: 'repository.source-observation',
      contractDigest: sourceObservationContractDigest,
      providerIdentityDigest: sourceObservationContractDigest
    }),
    compileSecCapabilityBinding({
      requirementId: 'typescript.project-check',
      contractDigest: checkerContractDigest,
      providerIdentityDigest: input.provider.toolchainBindingDigest as SecOperationDigest
    })
  ]);
}

export function resolveTypecheckBuildInfoPath(input: Readonly<{
  provider: TypeScriptNativeCheckerProvider;
  dependencyIdentityDigest: `sha256:${string}`;
  /** Every production cache identity must bind the exact admitted dependency root. */
  nodeModulesPath: string;
  projectConfigDigest: `sha256:${string}`;
  compilerRootPath?: string;
  cacheRoot?: string;
}>): string {
  const resolvedCompilerRoot = path.resolve(input.compilerRootPath ?? compilerRoot);
  const normalizedCompilerRoot = process.platform === 'win32'
    ? resolvedCompilerRoot.toLowerCase()
    : resolvedCompilerRoot;
  const derivedCacheRoot = path.resolve(input.cacheRoot ?? path.join(
    resolveSecRuntimeCacheRoot({
      platform: currentSecRuntimePlatform(),
      environment: secRuntimeStateEnvironment(),
      repositoryRoot: resolvedCompilerRoot
    }),
    'typecheck'
  ));
  const dependencyIdentityDigest = requireActionDigest(
    input.dependencyIdentityDigest,
    'Typecheck dependency admission identity'
  );
  const projectConfigDigest = requireActionDigest(
    input.projectConfigDigest,
    'Typecheck project configuration identity'
  );
  const cacheKey = sha256(Object.freeze({
    compilerRoot: normalizedCompilerRoot,
    dependencyIdentityDigest,
    dependencyRoot: canonicalPathIdentity(input.nodeModulesPath),
    projectConfigDigest,
    providerNativeExecutableDigest: input.provider.platformNativeExecutableDigest,
    providerManifestDigest: input.provider.packageManifestDigest,
    providerWrapperDigest: input.provider.wrapperDigest,
    providerBindingDigest: input.provider.toolchainBindingDigest,
    providerCapability: input.provider.capability,
    noEmit: input.provider.noEmit,
    incremental: input.provider.incremental,
    projectConfig: input.provider.projectConfig,
    runtimeRevision: `bun@${Bun.version}`
  })).slice(7);
  const buildInfoFile = path.join(derivedCacheRoot, cacheKey, 'tsconfig.tsbuildinfo');
  if (isPathInside(resolvedCompilerRoot, buildInfoFile)) {
    throw new Error('TypeCheck derived build-info cache must remain outside the compiler tree');
  }
  return buildInfoFile;
}

async function typecheckDependencyContext(): Promise<OperationDependencyBootstrapResult> {
  return ensureOperationDependencies(compileSecOperationDemandGraph({
    operation: 'typecheck',
    terminalWorkIds: []
  }));
}

export type TypecheckBuildDependencyIdentity = Readonly<Pick<
  OperationDependencyBootstrapResult,
  'nodeModulesPath' | 'requiresFreshProcess' | 'source'
> & { readonly identityDigest: `sha256:${string}` }>;

function materializedTypecheckDependencyIdentity(
  dependencies: OperationDependencyBootstrapResult
): TypecheckBuildDependencyIdentity {
  return Object.freeze({
    identityDigest: sha256(Object.freeze({
      kind: 'materialized-dependency-generation',
      manifestHash: dependencies.manifestHash,
      nodeModulesPath: canonicalPathIdentity(dependencies.nodeModulesPath),
      transitionDigest: dependencies.transitionDigest
    })) as `sha256:${string}`,
    nodeModulesPath: dependencies.nodeModulesPath,
    requiresFreshProcess: dependencies.requiresFreshProcess,
    source: dependencies.source
  });
}

async function assertTypeScriptProviderCurrent(
  nodeModulesPath: string,
  installed: InstalledTypeScriptNativeChecker
): Promise<void> {
  const current = requireSelectedTypeScriptNativeChecker(
    await selectInstalledTypeScriptNativeChecker(nodeModulesPath)
  );
  if (current.provider.toolchainBindingDigest !== installed.provider.toolchainBindingDigest
      || current.packageManifestPath !== installed.packageManifestPath
      || current.wrapperPath !== installed.wrapperPath
      || current.platformNativeManifestPath !== installed.platformNativeManifestPath
      || current.nativeExecutablePath !== installed.nativeExecutablePath) {
    throw new Error('Native TypeScript provider changed across command execution');
  }
}

async function observeTypecheckProjectInput(
  projectConfigPath: string,
  session: GitReadSession
): Promise<WorkspaceTypeScriptProjectInput> {
  return compileWorkspaceTypeScriptProjectInput(
    await acquireWorkingTreeWorkspaceSourceSnapshot({ session }),
    projectConfigPath
  );
}

async function executeObservedTypecheckWithProvider(
  dependencies: TypecheckBuildDependencyIdentity,
  installed: InstalledTypeScriptNativeChecker,
  diagnosticArguments: readonly string[],
  deadlineAtUnixMs: number,
  semanticOperation: SecBoundSemanticOperation,
  session: GitReadSession
): Promise<number> {
  const provider = installed.provider;
  const projectInput = await observeTypecheckProjectInput(provider.projectConfig, session);
  const buildInfoFile = resolveTypecheckBuildInfoPath({
    provider,
    dependencyIdentityDigest: dependencies.identityDigest,
    nodeModulesPath: dependencies.nodeModulesPath,
    projectConfigDigest: projectInput.projectConfigDigest
  });
  await assertTypeScriptProviderCurrent(dependencies.nodeModulesPath, installed);
  const actionInput = compileTypecheckActionInput({
    dependencies,
    provider,
    projectInput,
    diagnosticArguments,
    semanticOperation
  });
  const outcome = await typecheckActionRunner.executeIdentity({
    repositoryRoot: compilerRoot,
    actionInput,
    executionClass: 'cheap-preflight',
    executionDomain: 'local-typecheck',
    executor: async ({ action }) => {
      const domainBinding = Object.freeze({
        dependencyAdmission: dependencies.identityDigest,
        diagnosticArguments,
        projectConfig: projectInput.projectConfigDigest,
        projectInput: projectInput.projectInputDigest,
        workspaceSnapshotIdentity: projectInput.workspaceSnapshotIdentityDigest,
        providerBinding: provider.toolchainBindingDigest,
        semanticCapabilityBinding: semanticOperation.bindingSetIdentityDigest,
        semanticOperation: semanticOperation.plan.identity.identityDigest,
        semanticOperationAttempt: semanticOperation.boundAttemptDigest
      });
      const errorDigest = (error: unknown) => actionDigest({
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : typeof error
      });
      const settlement = (
        providerTerminalClass: SecOperationTerminalClass,
        terminalClass: SecOperationTerminalClass,
        effectOutcome: unknown,
        readback: unknown,
        domainOutcome: unknown
      ) => issueTypecheckOperationSettlement(semanticOperation, {
        actionKey: action.actionKey,
        providerTerminalClass,
        terminalClass,
        effectOutcome,
        readback,
        domainOutcome: Object.freeze({ ...domainBinding, outcome: domainOutcome })
      });
      const postReadback = async (
        cacheAuthority?: ReturnType<typeof acquireSecRuntimeCachePhysicalAuthority>
      ) => {
        try {
          await assertTypeScriptProviderCurrent(dependencies.nodeModulesPath, installed);
          cacheAuthority?.assertCurrent();
        } catch (error) {
          return Object.freeze({
            status: 'invalidated' as const,
            reason: 'provider-or-cache-authority-drift',
            errorDigest: errorDigest(error)
          });
        }
        try {
          const currentProjectInput = await observeTypecheckProjectInput(provider.projectConfig, session);
          if (currentProjectInput.projectInputDigest === projectInput.projectInputDigest) {
            return Object.freeze({
              status: 'current' as const,
              dependencyGenerationDigest: dependencies.identityDigest,
              observationDigest: projectInput.observationDigest,
              projectInputDigest: projectInput.projectInputDigest,
              providerBindingDigest: provider.toolchainBindingDigest
            });
          }
          return Object.freeze({
            status: 'invalidated' as const,
            reason: 'workspace-source-snapshot-changed',
            observationDigest: projectInput.observationDigest,
            refreshedObservationDigest: currentProjectInput.observationDigest,
            refreshedProjectInputDigest: currentProjectInput.projectInputDigest
          });
        } catch (error) {
          return Object.freeze({
            status: 'invalidated' as const,
            reason: 'project-input-readback-unresolved',
            errorDigest: errorDigest(error),
            observationDigest: projectInput.observationDigest
          });
        }
      };
      try {
        await assertTypeScriptProviderCurrent(dependencies.nodeModulesPath, installed);
      } catch (error) {
        const readback = Object.freeze({
          status: 'invalidated' as const,
          reason: 'provider-drift-before-process',
          errorDigest: errorDigest(error)
        });
        return settlement(
          'invalidated',
          'invalidated',
          Object.freeze({ status: 'not-started', reason: 'provider-drift' }),
          readback,
          Object.freeze({ status: 'provider-drift' })
        );
      }
      let cacheAuthority: ReturnType<typeof acquireSecRuntimeCachePhysicalAuthority>;
      let incrementalState: Awaited<ReturnType<typeof prepareTypeScriptIncrementalState>>;
      try {
        const cacheRoot = path.dirname(path.dirname(buildInfoFile));
        cacheAuthority = acquireSecRuntimeCachePhysicalAuthority({
          repositoryRoot: compilerRoot,
          cacheRoot,
          requiredDirectories: [path.dirname(buildInfoFile)]
        });
        cacheAuthority.assertCurrent();
        incrementalState = await prepareTypeScriptIncrementalState(buildInfoFile);
      } catch (error) {
        const readback = await postReadback();
        return settlement(
          'not-run',
          'process-settlement-failed',
          Object.freeze({
            status: 'setup-failed',
            errorDigest: errorDigest(error)
          }),
          readback,
          Object.freeze({ status: 'incremental-state-setup-failed' })
        );
      }

      const executeAndSettle = async (): Promise<SecOperationSettlementEnvelope> => {
        let execution: Awaited<ReturnType<typeof executeTypeScriptNativeChecker>>;
        try {
          execution = await executeTypeScriptNativeChecker(installed, {
            args: diagnosticArguments,
            buildInfoFile: incrementalState.executionBuildInfoFile,
            deadlineAtUnixMs,
            forwardOutput: true,
            workingDirectory: compilerRoot
          });
        } catch (error) {
          const readback = await postReadback(cacheAuthority);
          return settlement(
            'process-settlement-failed',
            'process-settlement-failed',
            Object.freeze({ status: 'execution-unsettled', errorDigest: errorDigest(error) }),
            readback,
            Object.freeze({ status: 'native-checker-threw' })
          );
        }
        if (execution.status === 'unverified') {
          const checkerBinding = semanticOperation.bindings.find(({ requirementId }) => (
            requirementId === 'typescript.project-check'
          ));
          if (checkerBinding === undefined) {
            throw new Error('Typecheck semantic operation lost its checker capability binding.');
          }
          const diagnostic = projectSecCapabilityDiagnostic({
            bindingDigest: checkerBinding.bindingDigest,
            code: 'typescript.provider-unverified',
            failureKind: `provider.${execution.reason}`,
            rawEvidence: execution.detail
          });
          const readback = await postReadback(cacheAuthority);
          const terminalClass: SecOperationTerminalClass = readback.status === 'invalidated'
            ? 'invalidated'
            : execution.reason === 'deadline-exhausted'
              ? 'timed-out'
              : execution.reason === 'cancelled'
                ? 'cancelled'
                : execution.reason === 'process-boundary-unavailable'
                  ? 'unsupported'
                  : 'invalidated';
          return settlement(
            terminalClass,
            terminalClass,
            Object.freeze({
              status: 'unverified',
              reason: execution.reason,
              detailDigest: actionDigest(execution.detail)
            }),
            readback,
            Object.freeze({ status: 'provider-execution-unverified', diagnostic })
          );
        }
        let incrementalPublished: boolean;
        try {
          incrementalPublished = await incrementalState.publish();
        } catch (error) {
          const readback = await postReadback(cacheAuthority);
          return settlement(
            'completed',
            'cleanup-failed',
            Object.freeze({
              status: 'incremental-publication-failed',
              exitCode: execution.code,
              errorDigest: errorDigest(error)
            }),
            readback,
            Object.freeze({ status: 'incremental-publication-failed' })
          );
        }
        const readback = await postReadback(cacheAuthority);
        if (readback.status === 'invalidated') {
          return settlement(
            'completed',
            'invalidated',
            Object.freeze({
              status: 'exited',
              exitCode: execution.code,
              incrementalPublished,
              stdoutDigest: actionDigest(execution.stdout),
              stderrDigest: actionDigest(execution.stderr)
            }),
            readback,
            Object.freeze({ status: 'post-execution-input-drift' })
          );
        }
        return settlement(
          'completed',
          execution.code === 0 ? 'completed' : 'failed',
          Object.freeze({
            status: 'exited',
            exitCode: execution.code,
            incrementalPublished,
            stdoutDigest: actionDigest(execution.stdout),
            stderrDigest: actionDigest(execution.stderr)
          }),
          readback,
          Object.freeze({ status: execution.code === 0 ? 'passed' : 'failed', exitCode: execution.code })
        );
      };

      let issued: SecOperationSettlementEnvelope;
      try {
        issued = await executeAndSettle();
      } catch (error) {
        const readback = await postReadback(cacheAuthority);
        issued = settlement(
          'process-settlement-failed',
          'process-settlement-failed',
          Object.freeze({ status: 'unexpected-settlement-failure', errorDigest: errorDigest(error) }),
          readback,
          Object.freeze({ status: 'typecheck-settlement-unresolved' })
        );
      }
      try {
        await incrementalState.dispose();
      } catch (error) {
        const readback = await postReadback(cacheAuthority);
        issued = settlement(
          'completed',
          'cleanup-failed',
          Object.freeze({ status: 'incremental-disposal-failed', errorDigest: errorDigest(error) }),
          readback,
          Object.freeze({ status: 'incremental-disposal-failed', priorSettlement: issued.settlementDigest })
        );
      }
      return issued;
    }
  });
  if (outcome.terminal?.status === 'passed') return 0;
  if (outcome.terminal?.status === 'failed') return 1;
  throw new Error(
    `TypeScript typecheck action did not produce a passed terminal: ${
      outcome.reason ?? outcome.terminal?.reasonCode ?? 'unresolved'
    }`
  );
}

async function executeTypecheckWithProvider(
  dependencies: TypecheckBuildDependencyIdentity,
  installed: InstalledTypeScriptNativeChecker,
  args: string[]
): Promise<number> {
  // Reject structural/test/provider substitutions and caller-owned checking
  // semantics before Git discovery, cache, or command Effects.
  assertTypeScriptNativeChecker(installed);
  const diagnosticArguments = canonicalTypeScriptDiagnosticArguments(args);
  const deadlineAtUnixMs = Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs;
  const semanticOperation = compileTypecheckSemanticOperation({
    projectConfigPath: installed.provider.projectConfig,
    diagnosticArguments,
    provider: installed.provider,
    deadlineAtUnixMs
  });
  return withAuthorityGitReadSession({
    cwd: compilerRoot,
    environment: { LANG: 'C', LC_ALL: 'C' },
    operation: semanticOperation,
    budget: TYPECHECK_SOURCE_OBSERVATION_BUDGET,
    deadlineAtUnixMs
  }, (session) => executeObservedTypecheckWithProvider(
    dependencies,
    installed,
    diagnosticArguments,
    deadlineAtUnixMs,
    semanticOperation,
    session
  ));
}

export async function runTypecheckWithProvider(
  dependencies: OperationDependencyBootstrapResult,
  installed: InstalledTypeScriptNativeChecker,
  args: string[] = []
): Promise<number> {
  return executeTypecheckWithProvider(
    materializedTypecheckDependencyIdentity(dependencies),
    installed,
    args
  );
}

export async function runTypecheckWithDependencyRoot(
  dependencies: OperationDependencyBootstrapResult,
  args: string[] = []
): Promise<number> {
  const installed = requireSelectedTypeScriptNativeChecker(
    await selectInstalledTypeScriptNativeChecker(dependencies.nodeModulesPath)
  );
  return runTypecheckWithProvider(dependencies, installed, args);
}

export async function runTypecheck(args: string[] = []): Promise<number> {
  const dependencies = await typecheckDependencyContext();
  return runTypecheckWithDependencyRoot(dependencies, args);
}
