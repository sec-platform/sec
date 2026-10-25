import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { settleWorkspaceCallback, workspaceTemporaryPrefix } from './workspace-cleanup.ts';
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

type BunTestCommandOptions = Omit<RunRetainedCommandOptions, 'maxStdoutBytes' | 'maxStderrBytes' | 'timeoutMs'> & {
  cwd?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
};
type CommandEffects = { settled: boolean; inputsReleased: boolean };

/** Run the current loaded Bun bytes, including when Linux adopted a sealed memfd.
 * The production process owner retains execution, output and termination duties.
 */
export function runRetainedBunTestCommand(
  args: readonly string[],
  options: BunTestCommandOptions = {}
): Promise<RetainedCommandResult> {
  return runOwnedBunTestCommand(args, options, { settled: true, inputsReleased: true });
}

async function runOwnedBunTestCommand(
  args: readonly string[],
  options: BunTestCommandOptions,
  effects: CommandEffects
): Promise<RetainedCommandResult> {
  const { cwd: workingDirectory = process.cwd(), ...runOptions } = options;
  const executable = retainCurrentProcessExecutable(RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'Test executable');
  effects.inputsReleased = false;
  let executableReleased = false;
  let directoryReleased = true;
  let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let primary: ResourceSettlementFailure | undefined;
  try {
    cwd = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(workingDirectory, 'Test working directory'),
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Test working directory'
    );
    directoryReleased = false;
    const boundary = issueRetainedCommandBoundary({ executable, workingDirectory: cwd });
    const invocationArgs = [...args];
    effects.settled = false;
    const result = await runRetainedCommand(boundary, invocationArgs, {
      ...runOptions,
      timeoutMs: runOptions.timeoutMs ?? 30_000,
      maxStdoutBytes: runOptions.maxStdoutBytes ?? 1024 * 1024,
      maxStderrBytes: runOptions.maxStderrBytes ?? 1024 * 1024
    });
    effects.settled = true;
    return result;
  } catch (error) {
    if (!effects.settled) effects.settled = retainedCommandFailureTreeClosed(error) === true;
    primary = { label: 'Retained Bun test command', error };
    throw error;
  } finally {
    // An unknown transport failure cannot retire the still-borrowed inputs.
    // Keep the original error for callers; never trust its mutable outcome.
    if (effects.settled) {
      try {
        settleResources({ primary, cleanup: [
          { label: 'Test working directory', settle: () => { cwd?.dispose(); directoryReleased = true; } },
          { label: 'Test executable', settle: () => { executable.dispose(); executableReleased = true; } }
        ] });
      } finally {
        effects.inputsReleased = directoryReleased && executableReleased;
      }
    }
  }
}

/** Own one prepared child workspace through the command's physical outcome.
 * Preparation must not launch unmanaged work; it returns one command request.
 * Unknown transport outcomes keep the directory without afterAll deletion.
 */
export async function runRetainedBunTestWorkspace(
  prefix: string,
  prepare: (root: string) => Promise<{
    args: readonly string[];
    options?: BunTestCommandOptions;
    observe?: (result: RetainedCommandResult) => void | Promise<void>;
  }>
): Promise<RetainedCommandResult> {
  const root = await mkdtemp(workspaceTemporaryPrefix(tmpdir(), prefix));
  const effects: CommandEffects = { settled: true, inputsReleased: true };
  return settleWorkspaceCallback(async () => {
    const { args, options, observe } = await prepare(root);
    const result = await runOwnedBunTestCommand(args, { cwd: root, ...options }, effects);
    await observe?.(result);
    return result;
  }, async () => {
    if (!effects.settled || !effects.inputsReleased) {
      throw new Error(`Retained Bun test workspace ${root}: command tree or retained input settlement was not confirmed.`);
    }
    await rm(root, { recursive: true, force: true });
  });
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
