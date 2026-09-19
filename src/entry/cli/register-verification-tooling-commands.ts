import type { Command } from 'commander';

import { addJsonFlags, jsonOpts, type JsonOpts } from './command-options.ts';

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
