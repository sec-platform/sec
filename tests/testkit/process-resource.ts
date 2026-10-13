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
  type CommandResult,
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
): Promise<CommandResult> {
  const { cwd: workingDirectory = process.cwd(), ...runOptions } = options;
  const executable = retainCurrentProcessExecutable(RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'Test executable');
  let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let primary: ResourceSettlementFailure | undefined;
  try {
    cwd = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(workingDirectory, 'Test working directory'),
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Test working directory'
    );
    return await runRetainedCommand(issueRetainedCommandBoundary({ executable, workingDirectory: cwd }), [...args], {
      ...runOptions,
      timeoutMs: runOptions.timeoutMs ?? 30_000,
      maxStdoutBytes: runOptions.maxStdoutBytes ?? 1024 * 1024,
      maxStderrBytes: runOptions.maxStderrBytes ?? 1024 * 1024
    });
  } catch (error) {
    primary = { label: 'Retained Bun test command', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [
      { label: 'Test working directory', settle: () => cwd?.dispose() },
      { label: 'Test executable', settle: () => executable.dispose() }
    ] });
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
  try {
    cwd = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(workingDirectory, 'Test working directory'),
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Test working directory'
    );
    return await context.session.run(issueRetainedCommandBoundary({
      executable,
      workingDirectory: cwd
    }), [
      '--no-env-file',
      '--eval',
      options.script ?? "process.stdout.write('verification-action')"
    ], {
      envMode: 'inherit',
      maxStderrBytes: options.maxStderrBytes ?? context.maxStderrBytes,
      maxStdoutBytes: options.maxStdoutBytes ?? context.maxStdoutBytes
    });
  } catch (error) {
    primary = { label: 'Retained Bun session test process', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [
      { label: 'Test working directory', settle: () => cwd?.dispose() },
      { label: 'Test executable', settle: () => executable.dispose() }
    ] });
  }
}
