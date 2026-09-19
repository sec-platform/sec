import type { Command } from 'commander';

import { addJsonFlags, jsonOpts, type JsonOpts } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';

export type VerificationToolingProjection = Readonly<{
  value: unknown;
  text: string;
}>;

export interface VerificationToolingCommandOperations {
  benchmarkCatalog(): Promise<VerificationToolingProjection> | VerificationToolingProjection;
  testBudget(): Promise<VerificationToolingProjection>;
}

export function bindVerificationToolingCommandHandlers(
  operations: VerificationToolingCommandOperations
): VerificationToolingCommandHandlers {
  if (typeof operations.benchmarkCatalog !== 'function' ||
      typeof operations.testBudget !== 'function') {
    throw new TypeError('Verification tooling command operations must be callable');
  }
  const present = (
    output: JsonOpts,
    projection: VerificationToolingProjection
  ): void => {
    printJsonOrText(projection.value, output, () => projection.text);
  };
  return Object.freeze({
    benchmarkCatalog: async ({ output }) => {
      present(output, await operations.benchmarkCatalog.call(operations));
    },
    testBudget: async ({ output }) => {
      present(output, await operations.testBudget.call(operations));
    }
  });
}

export interface VerificationToolingCommandHandlers {
  benchmarkCatalog(context: Readonly<{ output: JsonOpts }>): Promise<void> | void;
  testBudget(context: Readonly<{ output: JsonOpts }>): Promise<void>;
}

/** Entry owns development Verification tooling command grammar and option capture. */
export function registerVerificationToolingCommands(
  program: Command,
  handlers: VerificationToolingCommandHandlers
): void {
  if (typeof handlers.benchmarkCatalog !== 'function' ||
      typeof handlers.testBudget !== 'function') {
    throw new TypeError('Verification tooling command handlers must be callable');
  }

  const benchmark = program.command('benchmark');
  addJsonFlags(benchmark.command('catalog')).action(
    async (rawOptions: Record<string, unknown>) => {
      await handlers.benchmarkCatalog({ output: jsonOpts(rawOptions) });
    }
  );

  addJsonFlags(program.command('test').command('budget')).action(
    async (rawOptions: Record<string, unknown>) => {
      await handlers.testBudget({ output: jsonOpts(rawOptions) });
    }
  );
}
