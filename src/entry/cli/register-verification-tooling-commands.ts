import type { Command } from 'commander';

import {
  formatBenchmarkTaskCatalog,
  type BenchmarkTaskCatalogPresentationSource
} from './benchmark-catalog.ts';
import { addJsonFlags, jsonOpts, type JsonOpts } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';
import {
  formatTestBudgetContract,
  type TestBudgetPresentationSource
} from './test-budget.ts';

export interface VerificationToolingCommandOperations {
  benchmarkCatalog():
    | Promise<BenchmarkTaskCatalogPresentationSource>
    | BenchmarkTaskCatalogPresentationSource;
  testBudget(): Promise<TestBudgetPresentationSource>;
}

export function bindVerificationToolingCommandHandlers(
  operations: VerificationToolingCommandOperations
): VerificationToolingCommandHandlers {
  if (typeof operations.benchmarkCatalog !== 'function' ||
      typeof operations.testBudget !== 'function') {
    throw new TypeError('Verification tooling command operations must be callable');
  }
  return Object.freeze<VerificationToolingCommandHandlers>({
    benchmarkCatalog: async ({ output }) => {
      const value = await operations.benchmarkCatalog.call(operations);
      printJsonOrText(value, output, formatBenchmarkTaskCatalog);
    },
    testBudget: async ({ output }) => {
      const value = await operations.testBudget.call(operations);
      printJsonOrText(value, output, formatTestBudgetContract);
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
