import type { Command } from 'commander';
import { addJsonFlags, jsonOpts } from './command-options.ts';
import { commandValue } from './command-value.ts';
import { registerWorkspaceAction } from './workspace-action.ts';

/** The source and executable are explicit; transport does not infer another author authority. */
export function registerAuthorCommands(
  program: Command,
  compile: (workspaceRoot: string, input: string, kernel: string) => Promise<unknown>
): void {
  registerWorkspaceAction(addJsonFlags(program.command('author')
    .description('Compile a closed Gift author module into an in-memory TypeScript project bundle')
    .requiredOption('--input <file>', 'Workspace-relative gift.author-module/2 source')
    .requiredOption('--kernel <file>', 'Workspace-relative built Gift Rust compiler executable')), {
    decode: (options: Record<string, unknown>) => ({
      request: { input: options.input as string, kernel: options.kernel as string }, output: jsonOpts(options)
    }),
    execute: (root, request) => compile(root, request.input, request.kernel),
    view: result => commandValue(result, value => JSON.stringify(value, null, 2))
  });
}
