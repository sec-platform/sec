import type { Command } from 'commander';

import { addJsonFlags, jsonOpts, type JsonOpts } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';

interface EnvironmentCommandContext {
  readonly workspaceRoot: string;
  readonly output: JsonOpts;
}

export type EnvironmentCommandProjection = Readonly<{
  value: unknown;
  text: string;
  status: string;
  successful: boolean;
}>;

export interface EnvironmentCommandOperations {
  containerEngine(input: Readonly<{
    workspaceRoot: string;
    start: boolean;
  }>): Promise<EnvironmentCommandProjection>;
  settle(input: Readonly<{
    workspaceRoot: string;
    fix: boolean;
  }>): Promise<EnvironmentCommandProjection>;
}

export interface EnvironmentCommandHandlers {
  containerEngine(
    context: EnvironmentCommandContext & Readonly<{ start: boolean }>
  ): Promise<void>;
  settle(
    context: EnvironmentCommandContext & Readonly<{ fix: boolean }>
  ): Promise<void>;
}

export function bindEnvironmentCommandHandlers(
  operations: EnvironmentCommandOperations
): EnvironmentCommandHandlers {
  if (typeof operations.containerEngine !== 'function' ||
      typeof operations.settle !== 'function') {
    throw new TypeError('Environment command operations must be callable');
  }
  return Object.freeze({
    containerEngine: async ({ workspaceRoot, output, start }) => {
      const result = await operations.containerEngine.call(operations, {
        workspaceRoot,
        start
      });
      printJsonOrText(result.value, output, () => result.text);
      if (!result.successful) process.exitCode = 1;
    },
    settle: async ({ workspaceRoot, output, fix }) => {
      const result = await operations.settle.call(operations, {
        workspaceRoot,
        fix
      });
      printJsonOrText(result.value, output, () => result.text);
      if (!result.successful) {
        throw new Error(`Worktree not settled: ${result.status}`);
      }
    }
  });
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
