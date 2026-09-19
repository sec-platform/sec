import type { Command } from 'commander';

import { addJsonFlags, jsonOpts, type JsonOpts } from './command-options.ts';

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
