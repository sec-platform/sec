import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compileSecOperationDemandGraph } from '../../control/operation/demand.ts';
import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { canonicalTypeScriptDiagnosticArguments, requireSelectedTypeScriptNativeChecker, resolveInstalledTypeScriptNativeChecker, selectInstalledTypeScriptNativeChecker, typeScriptCheckerArguments, type InstalledTypeScriptNativeChecker, type TypeScriptNativeCheckerProvider } from '../../toolchain/typescript/checker.ts';
import { createVerificationActionTerminal, type VerificationActionKeyDigest, type VerificationActionKeyInput } from '../../verification/action/contract/action.ts';
import {
  VerificationActionRunner
} from '../../verification/action/runner.ts';
import { compilerRoot, isPathInside } from '../../workspace/paths.ts';
import {
  devCommandObservationExitCode,
  runDevCommand
} from './command-runner.ts';
import {
  ensureOperationDependencies,
  type OperationDependencyBootstrapResult
} from './dependency-bootstrap.ts';
import { pathEnvKey } from './env-manager.ts';

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

function createTypecheckActionInput(input: Readonly<{
  dependencies: TypecheckBuildDependencyIdentity;
  provider: TypeScriptNativeCheckerProvider;
  projectConfigDigest: `sha256:${string}`;
  diagnosticArguments: readonly string[];
  pathEnvironment: string;
  binPath: string;
}>): VerificationActionKeyInput {
  const dependencyManifestDigest = requireActionDigest(
    input.dependencies.manifestHash,
    'Typecheck dependency manifest identity'
  );
  const dependencyTransitionDigest = requireActionDigest(
    input.dependencies.transitionDigest,
    'Typecheck dependency transition identity'
  );
  const projectConfigDigest = requireActionDigest(
    input.projectConfigDigest,
    'Typecheck project configuration identity'
  );
  const provider = input.provider;
  const nodeModulesRootDigest = actionDigest({
    path: canonicalPathIdentity(input.dependencies.nodeModulesPath)
  });
  const commandPathDigest = actionDigest({
    binPath: canonicalPathIdentity(input.binPath),
    pathEnvironment: input.pathEnvironment
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
  const semanticDigest = actionDigest({
    checker: provider.capability,
    projectConfig: provider.projectConfig,
    noEmit: provider.noEmit,
    incremental: provider.incremental,
    diagnosticArguments: input.diagnosticArguments
  });
  return Object.freeze({
    actionKind: TYPECHECK_ACTION_KIND,
    producer: TYPECHECK_ACTION_PRODUCER,
    operation: Object.freeze({
      ...TYPECHECK_ACTION_OPERATION,
      semanticDigest,
      workingDirectory: '.',
      declaredEnvironment: Object.freeze([
        { name: 'command-path', digest: commandPathDigest },
        { name: 'dependency-manifest', digest: dependencyManifestDigest },
        { name: 'dependency-execution', digest: dependencyExecutionDigest },
        { name: 'dependency-transition', digest: dependencyTransitionDigest },
        { name: 'diagnostic-arguments', digest: diagnosticDigest },
        { name: 'node-modules-root', digest: nodeModulesRootDigest },
        { name: 'project-config', digest: projectConfigDigest },
        { name: 'provider-binding', digest: provider.toolchainBindingDigest },
        { name: 'provider-native-executable', digest: provider.platformNativeExecutableDigest },
        { name: 'provider-native-manifest', digest: provider.platformNativeManifestDigest },
        { name: 'provider-package-manifest', digest: provider.packageManifestDigest },
        { name: 'provider-wrapper', digest: provider.wrapperDigest },
        { name: 'toolchain-runtime', digest: runtimeDigest }
      ])
    }),
    inputClosure: Object.freeze([
      { path: 'dependency/manifest', digest: dependencyManifestDigest },
      { path: 'dependency/transition', digest: dependencyTransitionDigest },
      { path: 'provider/alias-package.json', digest: provider.packageManifestDigest },
      { path: 'provider/native-executable', digest: provider.platformNativeExecutableDigest },
      { path: 'provider/native-manifest.json', digest: provider.platformNativeManifestDigest },
      { path: 'provider/toolchain-binding', digest: provider.toolchainBindingDigest },
      { path: 'provider/wrapper', digest: provider.wrapperDigest },
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

export function resolveTypecheckBuildInfoPath(input: Readonly<{
  provider: TypeScriptNativeCheckerProvider;
  dependencyManifestHash: string;
  dependencyTransitionDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  compilerRootPath?: string;
  cacheRoot?: string;
}>): string {
  const resolvedCompilerRoot = path.resolve(input.compilerRootPath ?? compilerRoot);
  const normalizedCompilerRoot = process.platform === 'win32'
    ? resolvedCompilerRoot.toLowerCase()
    : resolvedCompilerRoot;
  const derivedCacheRoot = path.resolve(
    input.cacheRoot ?? path.join(tmpdir(), 'sec', 'typecheck')
  );
  const cacheKey = sha256(Object.freeze({
    compilerRoot: normalizedCompilerRoot,
    dependencyManifestHash: input.dependencyManifestHash,
    dependencyTransitionDigest: input.dependencyTransitionDigest,
    projectConfigDigest: input.projectConfigDigest,
    providerNativeExecutableDigest: input.provider.platformNativeExecutableDigest,
    providerManifestDigest: input.provider.packageManifestDigest,
    providerWrapperDigest: input.provider.wrapperDigest,
    providerRevision: input.provider.providerRevision,
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

type TypecheckBuildDependencyIdentity = Readonly<Pick<
  OperationDependencyBootstrapResult,
  'manifestHash' | 'transitionDigest' | 'nodeModulesPath'
  | 'requiresFreshProcess' | 'source'
>>;

async function currentTypecheckBuildDependencyIdentity(
  nodeModulesPath = path.join(compilerRoot, 'node_modules')
): Promise<TypecheckBuildDependencyIdentity> {
  const [manifest, lock, installConfig] = await Promise.all([
    fs.readFile(path.join(compilerRoot, 'package.json')),
    fs.readFile(path.join(compilerRoot, 'bun.lock')),
    fs.readFile(path.join(compilerRoot, 'bunfig.toml')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return Buffer.alloc(0);
      throw error;
    })
  ]);
  const manifestHash = sha256(Object.freeze({
    manifest: rawSha256(manifest),
    lock: rawSha256(lock),
    installConfig: rawSha256(installConfig),
    runtime: `bun@${Bun.version}`
  }));
  return Object.freeze({
    manifestHash,
    requiresFreshProcess: false,
    source: 'existing' as const,
    transitionDigest: sha256(Object.freeze({
      manifestHash,
      nodeModulesPath: path.resolve(nodeModulesPath)
    })) as `sha256:${string}`,
    nodeModulesPath: path.resolve(nodeModulesPath)
  });
}

async function assertTypeScriptProviderCurrent(
  nodeModulesPath: string,
  installed: InstalledTypeScriptNativeChecker
): Promise<void> {
  const current = await resolveInstalledTypeScriptNativeChecker(nodeModulesPath);
  if (current.provider.toolchainBindingDigest !== installed.provider.toolchainBindingDigest
      || current.packageManifestPath !== installed.packageManifestPath
      || current.wrapperPath !== installed.wrapperPath
      || current.platformNativeManifestPath !== installed.platformNativeManifestPath
      || current.nativeExecutablePath !== installed.nativeExecutablePath) {
    throw new Error('Native TypeScript provider changed across command execution');
  }
}

async function executeTypecheckWithProvider(
  dependencies: TypecheckBuildDependencyIdentity,
  installed: InstalledTypeScriptNativeChecker,
  args: string[]
): Promise<number> {
  // Reject caller attempts to change project/build/watch semantics before any
  // config read, cache directory creation, or child-process admission.
  const diagnosticArguments = canonicalTypeScriptDiagnosticArguments(args);
  const provider = installed.provider;
  const projectConfigDigest = rawSha256(
    await fs.readFile(path.join(compilerRoot, provider.projectConfig))
  );
  const buildInfoFile = resolveTypecheckBuildInfoPath({
    provider,
    dependencyManifestHash: dependencies.manifestHash,
    dependencyTransitionDigest: dependencies.transitionDigest,
    projectConfigDigest
  });
  await assertTypeScriptProviderCurrent(dependencies.nodeModulesPath, installed);
  const binPath = path.join(dependencies.nodeModulesPath, '.bin');
  const pathEnvironment = process.env[pathEnvKey()] ?? '';
  const env = {
    [pathEnvKey()]: `${binPath}${path.delimiter}${pathEnvironment}`,
    SEC_TYPECHECK_PROVIDER_REVISION: provider.providerRevision
  };
  const actionInput = createTypecheckActionInput({
    dependencies,
    provider,
    projectConfigDigest,
    diagnosticArguments,
    pathEnvironment,
    binPath
  });
  const outcome = await typecheckActionRunner.executeIdentity({
    repositoryRoot: compilerRoot,
    actionInput,
    executionClass: 'cheap-preflight',
    executionDomain: 'local-typecheck',
    executor: async ({ action }) => {
      try {
        await assertTypeScriptProviderCurrent(dependencies.nodeModulesPath, installed);
      } catch {
        return createVerificationActionTerminal({
          status: 'invalidated',
          reasonCode: 'input-invalidated',
          resultDigest: actionDigest({
            actionKey: action.actionKey,
            status: 'provider-drift'
          })
        });
      }
      await fs.mkdir(path.dirname(buildInfoFile), { recursive: true });
      const observation = await runDevCommand(
        process.execPath,
        [
          installed.wrapperPath,
          ...typeScriptCheckerArguments(provider, buildInfoFile, diagnosticArguments)
        ],
        env,
        { observe: true }
      );
      try {
        await assertTypeScriptProviderCurrent(dependencies.nodeModulesPath, installed);
      } catch {
        return createVerificationActionTerminal({
          status: 'invalidated',
          reasonCode: 'input-invalidated',
          resultDigest: actionDigest({
            actionKey: action.actionKey,
            status: 'provider-drift'
          })
        });
      }
      const exitCode = devCommandObservationExitCode(observation);
      const status = exitCode === 0 ? 'passed' as const : 'failed' as const;
      return createVerificationActionTerminal({
        status,
        reasonCode: status === 'passed' ? 'executed-success' : 'executed-failure',
        resultDigest: actionDigest({
          actionKey: action.actionKey,
          exitCode,
          providerBinding: provider.toolchainBindingDigest,
          dependencyTransition: dependencies.transitionDigest,
          projectConfig: projectConfigDigest,
          diagnosticArguments
        })
      });
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

export async function runTypecheckWithProvider(
  dependencies: OperationDependencyBootstrapResult,
  installed: InstalledTypeScriptNativeChecker,
  args: string[] = []
): Promise<number> {
  return executeTypecheckWithProvider(dependencies, installed, args);
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
  const existingNodeModulesPath = path.join(compilerRoot, 'node_modules');
  const existing = await selectInstalledTypeScriptNativeChecker(existingNodeModulesPath);
  if (existing.status === 'selected') {
    return executeTypecheckWithProvider(
      await currentTypecheckBuildDependencyIdentity(existingNodeModulesPath),
      existing.checker,
      args
    );
  }
  if (existing.status !== 'unavailable') {
    requireSelectedTypeScriptNativeChecker(existing);
    throw new Error('Native TypeScript checker rejection did not terminate selection');
  }
  const dependencies = await typecheckDependencyContext();
  const installed = requireSelectedTypeScriptNativeChecker(
    await selectInstalledTypeScriptNativeChecker(dependencies.nodeModulesPath)
  );
  return runTypecheckWithProvider(dependencies, installed, args);
}
