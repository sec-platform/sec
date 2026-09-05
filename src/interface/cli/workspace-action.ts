import type { Command } from 'commander';
import type { JsonOutputOptions } from './json-output-options.ts';
import { runWithOptionalSpinner } from './command-progress.ts';
import type { CommandValue } from './command-value.ts';
import { printJsonOrText } from './format-utils.ts';

export interface WorkspaceActionInput<T> {
  readonly request: T;
  readonly output: JsonOutputOptions;
}

/** Single execution with one result presentation. Input decoders own their
 * request snapshots; domain executors own authorization and physical effects.
 * There is no retry, compensation, failure readback or shared mutable context.
 * Repair/upgrade and read-only inspections retain their different lifecycles. */
export function registerWorkspaceAction<Args extends unknown[], Request, Result>(
  command: Command,
  definition: Readonly<{
    decode: (...args: Args) => WorkspaceActionInput<Request>;
    execute: (workspaceRoot: string, request: Request) => Promise<Result>;
    view: (result: Result) => CommandValue | PromiseLike<CommandValue>;
    progress?: string;
  }>
): Command {
  const { decode, execute, view, progress } = definition;
  if (typeof decode !== 'function' || typeof execute !== 'function' || typeof view !== 'function') {
    throw new TypeError('Workspace action decoder, executor and view must be callable');
  }
  // The actual Command was created with a native literal at its source owner.
  // No second command identity, option grammar or registry is created here.
  return command.action(async (...args: Args): Promise<void> => {
    const workspaceRoot = process.cwd();
    const { request, output } = decode(...args);
    const result = progress === undefined
      ? await execute(workspaceRoot, request)
      : await runWithOptionalSpinner(progress, output, () => execute(workspaceRoot, request));
    const projection = await view(result);
    printJsonOrText(projection.value, output, projection.formatText);
  });
}
