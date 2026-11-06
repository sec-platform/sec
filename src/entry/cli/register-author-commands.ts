import { type Command, Option } from 'commander';
import { addJsonFlags, jsonOpts } from './command-options.ts';
import { commandValue } from './command-value.ts';
import { registerWorkspaceAction } from './workspace-action.ts';

/** The source and executable are explicit; transport does not infer another author authority. */
export function registerAuthorCommands(
  program: Command,
  compile: (workspaceRoot: string, input: string, kernel: string, mode: boolean | 'names' | 'analyze') => Promise<unknown>
): void {
  registerWorkspaceAction(addJsonFlags(program.command('author')
    .description('Read Gift source, analyze captured names or a prepared project, or compile a closed /2 module into a TypeScript project bundle')
    .requiredOption('--input <file>', 'Workspace-relative Gift author source')
    .option('--read', 'Read a complete design-converged module or project; return structure and source locations')
    .addOption(new Option('--names', 'Analyze declaration and reference names in a captured design-converged module').conflicts('read'))
    .addOption(new Option('--analyze', 'Prepare captured design-converged sources and analyze their common semantics').conflicts(['read', 'names']))
    .requiredOption('--kernel <file>', 'Workspace-relative built Gift Rust compiler executable')), {
    decode: (options: Record<string, unknown>) => ({
      request: { input: options.input as string, kernel: options.kernel as string,
        mode: options.analyze === true ? 'analyze' as const : options.names === true ? 'names' as const : options.read === true }, output: jsonOpts(options)
    }),
    execute: (root, request) => compile(root, request.input, request.kernel, request.mode),
    view: result => commandValue(result, value => JSON.stringify(value, null, 2))
  });
}
