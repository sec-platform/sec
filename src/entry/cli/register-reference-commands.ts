import type { Command } from 'commander';

import { addJsonFlags, jsonOpts, type JsonOpts } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';

export type ReferenceCheckProjection = Readonly<{
  value: unknown;
  text: string;
  assertAccepted(): void;
}>;

export interface ReferenceCommandOperations {
  check(): Promise<ReferenceCheckProjection>;
}

export function bindReferenceCommandHandlers(
  operations: ReferenceCommandOperations
): ReferenceCommandHandlers {
  if (typeof operations.check !== 'function') {
    throw new TypeError('Reference command operation must be callable');
  }
  return Object.freeze({
    check: async ({ output }) => {
      const result = await operations.check.call(operations);
      printJsonOrText(result.value, output, () => result.text);
      result.assertAccepted();
    }
  });
}

export interface ReferenceCommandHandlers {
  check(context: Readonly<{ output: JsonOpts }>): Promise<void>;
}

/** Entry owns Reference command grammar and option capture. */
export function registerReferenceCommands(
  program: Command,
  handlers: ReferenceCommandHandlers
): void {
  if (typeof handlers.check !== 'function') {
    throw new TypeError('Reference command check handler must be callable');
  }
  const reference = program
    .command('reference')
    .description('Reference workspace operations');
  addJsonFlags(reference.command('check')).action(
    async (rawOptions: Record<string, unknown>) => {
      await handlers.check({ output: jsonOpts(rawOptions) });
    }
  );
}
