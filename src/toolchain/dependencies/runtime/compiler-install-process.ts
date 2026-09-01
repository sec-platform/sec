import path from 'node:path';

import { generatedStateDigest } from '../../../runtime-state/generated-state/contract.ts';
import {
  assertRetainedNoFollowCapability,
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  type CommandResult
} from '../../../runtime-state/physical/runtime/process.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import { issueSecOperationRequirementBindingContext } from '../../../system-architecture/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation
} from '../../../system-architecture/operation/semantic.ts';
import { writeText, type CommitFence } from '../../../workspace/files.ts';
import {
  currentRuntimeExecutableIdentity,
  type RuntimeExecutableIdentity
} from './compiler-materialization-input.ts';
import { DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY } from './dependency-transition/store.ts';
import { sameHostPath } from './host-path.ts';
import { consumeRuntimeDependencyTestMaterialization } from './materialization-fixture-capability.ts';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationOptions,
  runtimeDependencyOperationRemainingMs,
  type RuntimeDependencyInstallOptions,
  type RuntimeDependencyOperationOptions
} from './operation-context.ts';
import { measureRuntimeDependencyOperationPhaseAsync } from './operation-telemetry.ts';

function buildDependencyInstallEnvironment(
  writableRoot: string,
  cacheDir: string | undefined,
  isolated: boolean
): NodeJS.ProcessEnv {
  return buildIsolatedProcessEnvironment(writableRoot, {
    ...(cacheDir === undefined ? {} : { BUN_INSTALL_CACHE_DIR: cacheDir }),
    ...(isolated ? { [ISOLATED_VERIFICATION_ENV_KEY]: '1' } : {})
  });
}

const COMPILER_DEPENDENCY_INSTALL_PROCESS_REQUIREMENT =
  'compiler-dependency.install-process' as const;

function compilerDependencyInstallProcessOperation(input: Readonly<{
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
  executable: RuntimeExecutableIdentity;
  options: RuntimeDependencyOperationOptions;
  workingDirectory: string;
}>): SecBoundSemanticOperation {
  const context = runtimeDependencyOperationContext(input.options);
  const remainingDurationMs = Math.max(1, Math.floor(runtimeDependencyOperationRemainingMs(
    input.options,
    'Compiler dependency process operation admission',
    2
  )));
  const contractDigest = generatedStateDigest(Object.freeze({
    schema: 'sec-compiler-dependency-install-process-contract-v1',
    executablePath: input.executable.path,
    executableSha256: input.executable.sha256,
    workingDirectory: input.workingDirectory
  }));
  const intentDigest = generatedStateDigest(Object.freeze({
    schema: 'sec-compiler-dependency-install-process-intent-v1',
    args: input.args,
    environment: input.environment,
    executableSha256: input.executable.sha256,
    workingDirectory: input.workingDirectory
  }));
  const plan = compileSecSemanticOperationPlan({
    operation: 'compiler-dependency.install',
    intentDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Math.min(
      context.deadlineAtUnixMs,
      Date.now() + remainingDurationMs
    ),
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest,
      runIdDigest: generatedStateDigest(Object.freeze({ operationId: context.operationId }))
    }),
    aggregateBudgets: Object.freeze([
      Object.freeze({ resource: 'duration-ms' as const, maximum: remainingDurationMs }),
      Object.freeze({ resource: 'input-bytes' as const, maximum: 0 }),
      Object.freeze({
        resource: 'output-bytes' as const,
        maximum: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY * 2
      }),
      Object.freeze({ resource: 'processes' as const, maximum: 1 })
    ]),
    requirements: Object.freeze([Object.freeze({
      id: COMPILER_DEPENDENCY_INSTALL_PROCESS_REQUIREMENT,
      contractDigest,
      effectKinds: Object.freeze(['process'] as const),
      failureKinds: Object.freeze([
        'cancelled',
        'deadline-exhausted',
        'output-limit-exceeded',
        'physical-identity-drift',
        'spawn-failed',
        'termination-unproven'
      ])
    })])
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: COMPILER_DEPENDENCY_INSTALL_PROCESS_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: generatedStateDigest(Object.freeze({
      schema: 'sec-compiler-dependency-install-process-provider-v1',
      executablePath: input.executable.path,
      executableSha256: input.executable.sha256,
      workingDirectory: input.workingDirectory
    }))
  })]);
}

export async function runBunInstall(
  workingDirectory: string,
  options: RuntimeDependencyInstallOptions,
  bunArgs: string[],
  cacheDir?: string,
  expectedExecutable?: Readonly<RuntimeExecutableIdentity>,
  inputFence?: CommitFence
): Promise<{ packageManager: 'bun'; result: CommandResult }> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const isolated = options.installMode === 'offline-copy-only';
  const isolatedWritableRoot = isolated
    ? path.join(workingDirectory, '.isolated-process', 'dependency-install')
    : path.join(cacheDir ?? path.dirname(workingDirectory), '.process-runtime');
  await ensureIsolatedProcessDirectories(isolatedWritableRoot, options.beforeCommit);
  const isolatedConfigPath = path.join(isolatedWritableRoot, 'bunfig.toml');
  if (isolated) await writeText(isolatedConfigPath, '# isolated runtime\n', options.beforeCommit);
  await options.beforeCommit?.();
  const commandArgs = isolated
    ? ['--no-env-file', `--config=${isolatedConfigPath}`, ...bunArgs]
    : bunArgs;
  const runOptions = {
    beforeSpawn: async () => {
      runtimeDependencyOperationRemainingMs(options, 'Compiler dependency command pre-spawn');
      await options.beforeCommit?.();
      await inputFence?.();
      runtimeDependencyOperationRemainingMs(options, 'Compiler dependency command effect admission');
    },
    cwd: workingDirectory,
    env: buildDependencyInstallEnvironment(isolatedWritableRoot, cacheDir, isolated),
    envMode: 'replace' as const
  };
  const bunResult = await measureRuntimeDependencyOperationPhaseAsync(
    operationOptions,
    'install',
    async () => {
      if (options.testMaterialization !== undefined) {
        const timeoutMs = Math.max(1, Math.floor(runtimeDependencyOperationRemainingMs(
          operationOptions,
          'Compiler dependency test materialization admission'
        )));
        await runOptions.beforeSpawn();
        return consumeRuntimeDependencyTestMaterialization(options.testMaterialization, {
          args: commandArgs,
          cwd: workingDirectory,
          timeoutMs
        });
      }
      const expected = expectedExecutable ?? await currentRuntimeExecutableIdentity(true);
      const executableParent = inspectNoFollowDirectoryChain(
        path.dirname(expected.path),
        'Bun executable retained parent'
      );
      const executable = retainNoFollowOrdinaryFile(
        executableParent,
        path.basename(expected.path),
        undefined,
        'Bun executable retained capability',
        RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
        'executable'
      );
      const workingDirectoryChain = inspectNoFollowDirectoryChain(
        workingDirectory,
        'Bun retained working directory'
      );
      const retainedWorkingDirectory = retainNoFollowDirectoryForChildProcess(
        workingDirectoryChain,
        RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
        'Bun retained working directory capability'
      );
      try {
        assertRetainedNoFollowCapability(executable, 'executable', 'Bun executable capability');
        assertRetainedNoFollowCapability(
          retainedWorkingDirectory,
          'working-directory',
          'Bun working directory capability'
        );
        const observed = executable.digest();
        if (!sameHostPath(executable.path, expected.path) ||
            observed.byteDigest !== `sha256:${expected.sha256}`) {
          throw new SecError(
            'IMPORT-AUTHORITY-001',
            'Bun runtime executable changed before retained compiler spawn'
          );
        }
        const expectedExecutableSize = observed.size;
        const assertRetainedExecutableCurrent = (): void => {
          executable.assertCurrent();
          const current = executable.digest();
          if (current.size !== expectedExecutableSize ||
              current.byteDigest !== `sha256:${expected.sha256}`) {
            throw new SecError(
              'IMPORT-AUTHORITY-001',
              'Bun runtime executable bytes changed during retained compiler spawn'
            );
          }
        };
        const { cwd: _workingDirectory, ...retainedRunOptions } = runOptions;
        const retainedCommandBoundary = issueRetainedCommandBoundary({
          executable,
          workingDirectory: retainedWorkingDirectory
        });
        const processOperation = compilerDependencyInstallProcessOperation({
          args: commandArgs,
          environment: runOptions.env,
          executable: expected,
          options: operationOptions,
          workingDirectory
        });
        const processSession = openProcessResourceSession({
          operation: processOperation,
          requirementBindingContext: issueSecOperationRequirementBindingContext({
            operation: processOperation,
            requirementId: COMPILER_DEPENDENCY_INSTALL_PROCESS_REQUIREMENT,
            resourceCeilings: [
              {
                resource: 'duration-ms',
                maximum: Math.max(1, Math.floor(runtimeDependencyOperationRemainingMs(
                  operationOptions,
                  'Compiler dependency process session admission',
                  2
                )))
              },
              { resource: 'input-bytes', maximum: 0 },
              {
                resource: 'output-bytes',
                maximum: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY * 2
              },
              { resource: 'processes', maximum: 1 }
            ]
          }),
          signal: runtimeDependencyOperationContext(operationOptions).signal
        });
        try {
          const executed = await processSession.run(retainedCommandBoundary, commandArgs, {
            ...retainedRunOptions,
            maxStderrBytes: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY,
            maxStdoutBytes: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY,
            beforeSpawn: async () => {
              await options.beforeCommit?.();
              await inputFence?.();
              assertRetainedExecutableCurrent();
              retainedWorkingDirectory.assertCurrent();
            }
          });
          assertRetainedExecutableCurrent();
          retainedWorkingDirectory.assertCurrent();
          return Object.freeze({
            code: executed.result.code,
            stderr: executed.result.stderr,
            stdout: Buffer.from(executed.result.stdout).toString('utf8')
          });
        } finally {
          const receipt = processSession.close();
          assertProcessResourceSessionReceipt(receipt, {
            operationIdentityDigest: processOperation.plan.identity.identityDigest,
            boundAttemptDigest: processOperation.boundAttemptDigest,
            requirementId: COMPILER_DEPENDENCY_INSTALL_PROCESS_REQUIREMENT
          });
        }
      } finally {
        retainedWorkingDirectory.dispose();
        executable.dispose();
      }
    }
  );
  runtimeDependencyOperationRemainingMs(options, 'Compiler dependency command settlement');
  await options.beforeCommit?.();
  runtimeDependencyOperationRemainingMs(options, 'Compiler dependency command final fence');

  if (bunResult.code === 0) {
    return { packageManager: 'bun', result: bunResult };
  }

  throw new SecError(
    'RUNTIME-DEPS-001',
    `Failed to install runtime dependencies in ${workingDirectory}`,
    { bunResult }
  );
}
