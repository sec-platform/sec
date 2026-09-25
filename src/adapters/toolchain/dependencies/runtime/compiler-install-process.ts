import path from 'node:path';
import { bindCompilerInstallInvocation, type CompilerInstallInvocationInput } from './install-invocation.ts';

import { type CommitFence } from "../../../../contracts/commit-fence.ts";
import { FailureError } from '../../../../contracts/failure.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation
} from '../../../../execution/operation/semantic.ts';
import { writeText } from "../../../filesystem/files.ts";
import { generatedStateDigest } from '../../../runtime-state/generated-state/contract.ts';
import {
  assertRetainedNoFollowCapability,
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
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
import {
  currentRuntimeExecutableIdentity,
  type RuntimeExecutableIdentity
} from './compiler-materialization-input.ts';
import { DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY } from './dependency-transition/store.ts';
import { sameHostPath } from './host-path.ts';
import { withCompilerInstallResources } from './install-resource-scope.ts';
import { consumeRuntimeDependencyTestMaterialization } from './materialization-fixture-capability.ts';
import {
  runtimeDependencyOperationContext,
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationRemainingMs
} from './operation-context.ts';
import { type BoundRuntimeDependencyOperationControls } from './operation-controls.ts';
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

// Stream capacities are the physical limits; the aggregate is their sum, not
// another independently maintained number. Both plan and session use this shape.
const COMPILER_INSTALL_OUTPUT_LIMITS = Object.freeze({
  maxStderrBytes: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY,
  maxStdoutBytes: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY
});

function compilerInstallResourceCeilings(durationMs: number) {
  return Object.freeze([
    Object.freeze({ resource: 'duration-ms' as const, maximum: durationMs }),
    Object.freeze({ resource: 'input-bytes' as const, maximum: 0 }),
    Object.freeze({ resource: 'output-bytes' as const,
      maximum: COMPILER_INSTALL_OUTPUT_LIMITS.maxStderrBytes + COMPILER_INSTALL_OUTPUT_LIMITS.maxStdoutBytes }),
    Object.freeze({ resource: 'processes' as const, maximum: 1 })
  ]);
}

function captureInstallArguments(input: readonly string[]): string[] {
  if (!Array.isArray(input)) throw new FailureError('RUNTIME-DEPS-003', 'Bun arguments must be a dense string array');
  const length = input.length;
  const args: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(input, index);
    if (!slot || !('value' in slot) || typeof slot.value !== 'string' || slot.value.includes('\0')) {
      throw new FailureError('RUNTIME-DEPS-003', 'Bun arguments must be own string data without NUL bytes');
    }
    args.push(slot.value);
  }
  return args;
}

function captureExpectedExecutable(input: RuntimeExecutableIdentity): RuntimeExecutableIdentity {
  const { path: executablePath, sha256, signature } = input;
  return Object.freeze({ path: path.resolve(executablePath), sha256, signature });
}

function requireSuccessfulInstall(result: CommandResult, workingDirectory: string): CommandResult {
  if (result.code !== 0) throw new FailureError('RUNTIME-DEPS-001',
    `Failed to install runtime dependencies in ${workingDirectory}`, { bunResult: result });
  return result;
}

function compilerDependencyInstallProcessOperation(input: Readonly<{
  args: readonly string[];
  environment: NodeJS.ProcessEnv;
  executable: RuntimeExecutableIdentity;
  options: BoundRuntimeDependencyOperationControls;
  workingDirectory: string;
}>): BoundSemanticOperation {
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
  const plan = compileSemanticOperationPlan({
    operation: 'compiler-dependency.install',
    intentDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Math.min(
      context.deadlineAtUnixMs,
      Date.now() + remainingDurationMs
    ),
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest,
      runIdDigest: generatedStateDigest(Object.freeze({ operationId: context.operationId }))
    }),
    aggregateBudgets: compilerInstallResourceCeilings(remainingDurationMs),
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
  return bindSemanticOperation(plan, [compileCapabilityBinding({
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
  options: CompilerInstallInvocationInput,
  bunArgs: readonly string[],
  cacheDir?: string,
  expectedExecutable?: Readonly<RuntimeExecutableIdentity>,
  inputFence?: CommitFence
): Promise<{ packageManager: 'bun'; result: CommandResult }> {
  // Capture paths, arguments and supplied executable identity before any clock,
  // fence or provider callback can mutate the invocation or process cwd.
  workingDirectory = path.resolve(workingDirectory);
  cacheDir = cacheDir === undefined ? undefined : path.resolve(cacheDir);
  const capturedArgs = captureInstallArguments(bunArgs);
  const capturedExecutable = expectedExecutable === undefined ? undefined : captureExpectedExecutable(expectedExecutable);
  if (inputFence !== undefined && typeof inputFence !== 'function') {
    throw new FailureError('RUNTIME-DEPS-003', 'Compiler dependency input fence must be callable');
  }
  const { controls, isolated, materialization, beforeCommit } = bindCompilerInstallInvocation(options);
  const effectOptions = Object.freeze({ ...controls, beforeCommit });
  const effectFence = () => runtimeDependencyOperationEffectFence(effectOptions, 'Compiler dependency install');
  const spawnFence = async () => {
    await effectFence();
    if (inputFence !== undefined) {
      await runtimeDependencyOperationEffectFence({ ...controls, beforeCommit: () => inputFence() },
        'Compiler dependency input');
    }
    runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency command effect admission');
  };
  const isolatedWritableRoot = isolated
    ? path.join(workingDirectory, '.isolated-process', 'dependency-install')
    : path.join(cacheDir ?? path.dirname(workingDirectory), '.process-runtime');
  await ensureIsolatedProcessDirectories(isolatedWritableRoot, effectFence);
  const isolatedConfigPath = path.join(isolatedWritableRoot, 'bunfig.toml');
  if (isolated) await writeText(isolatedConfigPath, '# isolated runtime\n', effectFence);
  await effectFence();
  const commandArgs = isolated
    ? ['--no-env-file', `--config=${isolatedConfigPath}`, ...capturedArgs]
    : capturedArgs;
  Object.freeze(commandArgs);
  const runOptions = {
    beforeSpawn: spawnFence,
    cwd: workingDirectory,
    env: Object.freeze(buildDependencyInstallEnvironment(isolatedWritableRoot, cacheDir, isolated)),
    envMode: 'replace' as const
  };
  const bunResult = await measureRuntimeDependencyOperationPhaseAsync(
    controls,
    'install',
    async () => {
      if (materialization !== undefined) {
        await runOptions.beforeSpawn();
        const timeoutMs = Math.max(1, Math.floor(runtimeDependencyOperationRemainingMs(
          controls, 'Compiler dependency test materialization admission'
        )));
        const result = await consumeRuntimeDependencyTestMaterialization(materialization, {
          args: commandArgs, cwd: workingDirectory, timeoutMs
        });
        return requireSuccessfulInstall(result, workingDirectory);
      }
      const expected = capturedExecutable ?? captureExpectedExecutable(await currentRuntimeExecutableIdentity(true));
      return withCompilerInstallResources(async resources => {
        const executableParent = inspectNoFollowDirectoryChain(
          path.dirname(expected.path),
          'Bun executable retained parent'
        );
        const executable = resources.executable(retainNoFollowOrdinaryFile(
          executableParent,
          path.basename(expected.path),
          undefined,
          'Bun executable retained capability',
          RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
          'executable'
        ));
        const workingDirectoryChain = inspectNoFollowDirectoryChain(
          workingDirectory,
          'Bun retained working directory'
        );
        const retainedWorkingDirectory = resources.workingDirectory(retainNoFollowDirectoryForChildProcess(
          workingDirectoryChain,
          RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
          'Bun retained working directory capability'
        ));
        assertRetainedNoFollowCapability(executable, 'executable', 'Bun executable capability');
        assertRetainedNoFollowCapability(
          retainedWorkingDirectory,
          'working-directory',
          'Bun working directory capability'
        );
        const observed = executable.digest();
        if (!sameHostPath(executable.path, expected.path) ||
            observed.byteDigest !== `sha256:${expected.sha256}`) {
          throw new FailureError(
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
            throw new FailureError(
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
          options: controls,
          workingDirectory
        });
        const processSession = resources.processSession(openProcessResourceSession({
          operation: processOperation,
          requirementBindingContext: issueOperationRequirementBindingContext({
            operation: processOperation,
            requirementId: COMPILER_DEPENDENCY_INSTALL_PROCESS_REQUIREMENT,
            resourceCeilings: compilerInstallResourceCeilings(Math.max(1, Math.floor(
              runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency process session admission', 2)
            )))
          }),
          signal: runtimeDependencyOperationContext(controls).signal
        }), {
          operationIdentityDigest: processOperation.plan.identity.identityDigest,
          boundAttemptDigest: processOperation.boundAttemptDigest,
          requirementId: COMPILER_DEPENDENCY_INSTALL_PROCESS_REQUIREMENT
        });
        const executed = await processSession.run(retainedCommandBoundary, commandArgs, {
          ...retainedRunOptions,
          ...COMPILER_INSTALL_OUTPUT_LIMITS,
          beforeSpawn: async () => {
            await spawnFence();
            assertRetainedExecutableCurrent();
            retainedWorkingDirectory.assertCurrent();
          }
        });
        assertRetainedExecutableCurrent();
        retainedWorkingDirectory.assertCurrent();
        return requireSuccessfulInstall(Object.freeze({
          code: executed.result.code,
          stderr: executed.result.stderr,
          stdout: Buffer.from(executed.result.stdout).toString('utf8')
        }), workingDirectory);
      });
    }
  );
  await effectFence();
  return { packageManager: 'bun', result: bunResult };
}
