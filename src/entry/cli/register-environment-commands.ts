import type { Command } from 'commander';

import { addJsonFlags, jsonOpts, type JsonOpts } from './command-options.ts';

interface EnvironmentCommandContext {
  readonly workspaceRoot: string;
  readonly output: JsonOpts;
}

export interface EnvironmentCommandHandlers {
  containerEngine(
    context: EnvironmentCommandContext & Readonly<{ start: boolean }>
  ): Promise<void>;
  settle(
    context: EnvironmentCommandContext & Readonly<{ fix: boolean }>
  ): Promise<void>;
}

/** Entry owns environment command grammar, cwd capture and option decoding. */
export function registerEnvironmentCommands(
  program: Command,
  handlers: EnvironmentCommandHandlers
): void {
  if (typeof handlers.containerEngine !== 'function' ||
      typeof handlers.settle !== 'function') {
    throw new TypeError('Environment command handlers must be callable');
  }

  const environment = program
    .command('environment')
    .description('Environment settlement inspection');

  addJsonFlags(environment.command('container-engine'))
    .description(
      'Observe the retained local Container Engine, optionally starting Docker Desktop'
    )
    .option(
      '--start',
      'Issue one bounded Docker Desktop start intent when the endpoint is unavailable'
    )
    .action(async (rawOptions: Record<string, unknown>) => {
      await handlers.containerEngine({
        workspaceRoot: process.cwd(),
        output: jsonOpts(rawOptions),
        start: rawOptions.start === true
      });
    });

  addJsonFlags(environment.command('settle'))
    .description('Non-destructive worktree settlement preflight')
    .option(
      '--fix',
      'Re-checkout governed text files to enforce canonical LF materialization'
    )
    .action(async (rawOptions: Record<string, unknown>) => {
      await handlers.settle({
        workspaceRoot: process.cwd(),
        output: jsonOpts(rawOptions),
        fix: rawOptions.fix === true
      });
    });
}
