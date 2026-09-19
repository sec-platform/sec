import type { Command } from 'commander';

import { addJsonFlags, jsonOpts, type JsonOpts } from './command-options.ts';

export interface TextCommandHandlers {
  census(context: Readonly<{
    output: JsonOpts;
    failOn: string | undefined;
  }>): Promise<void>;
}

/** Entry owns text-inspection command grammar and raw option capture. */
export function registerTextCommands(
  program: Command,
  handlers: TextCommandHandlers
): void {
  if (typeof handlers.census !== 'function') {
    throw new TypeError('Text census command handler must be callable');
  }

  const text = program
    .command('text')
    .description('Text byte policy inspection');

  addJsonFlags(text.command('census'))
    .description('Scan tracked Git blobs and classify by .gitattributes policy')
    .option(
      '--fail-on <threshold>',
      'Exit non-zero for any fail-closed result or one classification'
    )
    .action(async (rawOptions: Record<string, unknown>) => {
      await handlers.census({
        output: jsonOpts(rawOptions),
        failOn: typeof rawOptions.failOn === 'string'
          ? rawOptions.failOn
          : undefined
      });
    });
}
