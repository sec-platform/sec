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
import { ResourceCompositeSettlementError, settleResources, type ResourceSettlementFailure } from '../../src/execution/resource-settlement.ts';

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

export type RetainedBunTestWorkspaceRun = (
  args: readonly string[],
  options?: BunTestCommandOptions
) => Promise<RetainedCommandResult>;

/** Own a workspace until every managed command has joined and released inputs.
 * The callback must not launch unmanaged work. Once it ends, no new command may
 * borrow the workspace; unknown physical outcomes retain it without afterAll.
 */
export async function withRetainedBunTestWorkspace<T>(
  prefix: string,
  callback: (root: string, run: RetainedBunTestWorkspaceRun) => Promise<T>
): Promise<T> {
  const root = await mkdtemp(workspaceTemporaryPrefix(tmpdir(), prefix));
  return withRetainedBunTestCommands(root, run => callback(root, run),
    () => rm(root, { recursive: true, force: true }));
}

/** Gate an existing fixture's entire cleanup on all managed child outcomes.
 * Root supplies the default command cwd and retention diagnostic, not deletion
 * authority: only the fixture's cleanup decides which resources to release.
 * The callback must not launch unmanaged work.
 */
export async function withRetainedBunTestCommands<T>(
  root: string,
  callback: (run: RetainedBunTestWorkspaceRun) => Promise<T>,
  cleanup: () => Promise<void>
): Promise<T> {
  const calls: Array<{
    effects: CommandEffects;
    outcome: Promise<{ failed: false } | { failed: true; error: unknown }>;
  }> = [];
  let accepting = true;
  const run: RetainedBunTestWorkspaceRun = (args, options) => {
    if (!accepting) throw new Error('Retained Bun test workspace no longer accepts commands.');
    const effects: CommandEffects = { settled: true, inputsReleased: true };
    const command = runOwnedBunTestCommand(args, { cwd: root, ...options }, effects);
    // Attach rejection observation immediately, including for parallel calls
    // whose caller exits before awaiting the other commands.
    calls.push({ effects, outcome: command.then(
      () => ({ failed: false as const }),
      error => ({ failed: true as const, error })
    ) });
    return command;
  };
  return settleWorkspaceCallback(async () => {
    const failures: ResourceSettlementFailure[] = [];
    let result: T | undefined;
    try {
      result = await callback(run);
    } catch (error) {
      failures.push({ label: 'Workspace callback rejection', error });
    } finally {
      accepting = false;
    }
    const outcomes = await Promise.all(calls.map(call => call.outcome));
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome.failed) {
        failures.push({ label: `Workspace command ${index + 1} rejection`, error: outcome.error });
      }
    }
    // These are rejection observations, not a count of physical failures: an
    // awaited command may also reject the callback. Equal values do not prove
    // common provenance, so neither observation is discarded.
    if (failures.length === 1) throw failures[0]!.error;
    if (failures.length > 1) throw new ResourceCompositeSettlementError(failures);
    return result as T;
  }, async () => {
    if (calls.some(({ effects }) => !effects.settled || !effects.inputsReleased)) {
      throw new Error(`Retained Bun test workspace ${root}: command tree or retained input settlement was not confirmed.`);
    }
    await cleanup();
  });
}

/** Preparation must not launch unmanaged work; observation precedes cleanup. */
export async function runRetainedBunTestWorkspace(
  prefix: string,
  prepare: (root: string) => Promise<{
    args: readonly string[];
    options?: BunTestCommandOptions;
    observe?: (result: RetainedCommandResult) => void | Promise<void>;
  }>
): Promise<RetainedCommandResult> {
  return withRetainedBunTestWorkspace(prefix, async (root, run) => {
    const { args, options, observe } = await prepare(root);
    const result = await run(args, options);
    await observe?.(result);
    return result;
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
