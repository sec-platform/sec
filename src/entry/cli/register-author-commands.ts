import type { Command } from 'commander';
import { addJsonFlags, jsonOpts } from './command-options.ts';
import { commandValue } from './command-value.ts';
import { registerWorkspaceAction } from './workspace-action.ts';

/** The source and executable are explicit; transport does not infer another author authority. */
export function registerAuthorCommands(
  program: Command,
  compile: (workspaceRoot: string, input: string, kernel: string, readOnly: boolean) => Promise<unknown>
): void {
  registerWorkspaceAction(addJsonFlags(program.command('author')
    .description('Read Gift intent source or compile a closed /2 module into a TypeScript project bundle')
    .requiredOption('--input <file>', 'Workspace-relative Gift author source')
    .option('--read', 'Read a complete design-converged module or project; return structure and source locations')
    .requiredOption('--kernel <file>', 'Workspace-relative built Gift Rust compiler executable')), {
    decode: (options: Record<string, unknown>) => ({
      request: { input: options.input as string, kernel: options.kernel as string, readOnly: options.read === true }, output: jsonOpts(options)
    }),
    execute: (root, request) => compile(root, request.input, request.kernel, request.readOnly),
    view: result => commandValue(result, value => JSON.stringify(value, null, 2))
  });
}
