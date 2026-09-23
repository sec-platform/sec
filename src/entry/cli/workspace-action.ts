import type { Command } from 'commander';
import type { CommandValue } from './command-value.ts';
import { printJsonOrText } from './format-utils.ts';
import type { JsonOutputOptions } from './json-output-options.ts';

export interface WorkspaceActionInput<T> {
  readonly request: T;
  readonly output: JsonOutputOptions;
}

export type WorkspaceProgressRunner = <T>(
  text: string,
  output: JsonOutputOptions,
  execute: () => Promise<T>
) => Promise<T>;

/** Entry owns one transport lifecycle. Domain execution and optional progress
 * capabilities are injected; this layer grants no effects and performs no retry. */
export function registerWorkspaceAction<Args extends unknown[], Request, Result>(
  command: Command,
  definition: Readonly<{
    decode: (...args: Args) => WorkspaceActionInput<Request>;
    execute: (workspaceRoot: string, request: Request) => Promise<Result>;
    view: (result: Result) => CommandValue | PromiseLike<CommandValue>;
    progress?: Readonly<{ text: string; run: WorkspaceProgressRunner }>;
  }>
): Command {
  const { decode, execute, view, progress } = definition;
  if (typeof decode !== 'function' || typeof execute !== 'function' || typeof view !== 'function'
      || (progress !== undefined && (typeof progress.text !== 'string' || typeof progress.run !== 'function'))) {
    throw new TypeError('Workspace action decoder, executor, view and progress capability must be valid');
  }
  return command.action(async (...args: Args): Promise<void> => {
    // Capture before decoder code can mutate process cwd.
    const workspaceRoot = process.cwd();
    const { request, output } = decode(...args);
    const result = progress === undefined
      ? await execute(workspaceRoot, request)
      : await progress.run(progress.text, output, () => execute(workspaceRoot, request));
    const projection = await view(result);
    printJsonOrText(projection.value, output, projection.formatText);
  });
}
