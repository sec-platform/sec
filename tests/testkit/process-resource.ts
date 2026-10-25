import {
  inspectNoFollowDirectoryChain,
  retainCurrentProcessExecutable,
  retainNoFollowDirectoryForChildProcess,
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import type { ProcessResourceRunResult } from '../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  runRetainedCommand,
  retainedCommandFailureTreeClosed,
  type RetainedCommandResult,
  type RunRetainedCommandOptions
} from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import type { VerificationActionProcessExecutionContext } from '../../src/adapters/verification/platform/action/runner.ts';
import { settleResources, type ResourceSettlementFailure } from '../../src/execution/resource-settlement.ts';

/** Run the current loaded Bun bytes, including when Linux adopted a sealed memfd.
 * The production process owner retains execution, output and termination duties.
 */
export async function runRetainedBunTestCommand(
  args: readonly string[],
  options: Omit<RunRetainedCommandOptions, 'maxStdoutBytes' | 'maxStderrBytes' | 'timeoutMs'> & {
    cwd?: string;
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
  } = {}
): Promise<RetainedCommandResult> {
  const { cwd: workingDirectory = process.cwd(), ...runOptions } = options;
  const executable = retainCurrentProcessExecutable(RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'Test executable');
  let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let primary: ResourceSettlementFailure | undefined;
  let effectsSettled = true;
  try {
    cwd = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(workingDirectory, 'Test working directory'),
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Test working directory'
    );
    const boundary = issueRetainedCommandBoundary({ executable, workingDirectory: cwd });
    const invocationArgs = [...args];
    effectsSettled = false;
    const result = await runRetainedCommand(boundary, invocationArgs, {
      ...runOptions,
      timeoutMs: runOptions.timeoutMs ?? 30_000,
      maxStdoutBytes: runOptions.maxStdoutBytes ?? 1024 * 1024,
      maxStderrBytes: runOptions.maxStderrBytes ?? 1024 * 1024
    });
    effectsSettled = true;
    return result;
  } catch (error) {
    if (!effectsSettled) effectsSettled = retainedCommandFailureTreeClosed(error) === true;
    primary = { label: 'Retained Bun test command', error };
    throw error;
  } finally {
    // An unknown transport failure cannot retire the still-borrowed inputs.
    // Keep the original error for callers; never trust its mutable outcome.
    if (effectsSettled) {
      settleResources({ primary, cleanup: [
        { label: 'Test working directory', settle: () => cwd?.dispose() },
        { label: 'Test executable', settle: () => executable.dispose() }
      ] });
    }
  }
}

/** Test-only physical child used to exercise the real retained process owner. */
export async function runRetainedBunTestProcess(
  context: VerificationActionProcessExecutionContext,
  workingDirectory: string,
  options: Readonly<{
    script?: string;
    maxStderrBytes?: number;
    maxStdoutBytes?: number;
  }> = {}
): Promise<ProcessResourceRunResult> {
  const executable = retainCurrentProcessExecutable(
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'Test executable'
  );
  let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let primary: ResourceSettlementFailure | undefined;
  let effectsSettled = true;
  try {
    cwd = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(workingDirectory, 'Test working directory'),
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Test working directory'
    );
    const boundary = issueRetainedCommandBoundary({ executable, workingDirectory: cwd });
    const invocationArgs = [
      '--no-env-file',
      '--eval',
      options.script ?? "process.stdout.write('verification-action')"
    ];
    const maxStderrBytes = options.maxStderrBytes ?? context.maxStderrBytes;
    const maxStdoutBytes = options.maxStdoutBytes ?? context.maxStdoutBytes;
    effectsSettled = false;
    const result = await context.session.run(boundary, invocationArgs, {
      envMode: 'inherit',
      maxStderrBytes,
      maxStdoutBytes
    });
    effectsSettled = true;
    return result;
  } catch (error) {
    if (!effectsSettled) effectsSettled = retainedCommandFailureTreeClosed(error) === true;
    primary = { label: 'Retained Bun session test process', error };
    throw error;
  } finally {
    // An unknown transport failure cannot retire the still-borrowed inputs.
    // Keep the original error for callers; never trust its mutable outcome.
    if (effectsSettled) {
      settleResources({ primary, cleanup: [
        { label: 'Test working directory', settle: () => cwd?.dispose() },
        { label: 'Test executable', settle: () => executable.dispose() }
      ] });
    }
  }
}
