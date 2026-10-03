import { Command, Option } from 'commander';
import { buildErrorProtocol } from '../../application/error-protocol.ts';
import { reportCliFailure } from './cli-failure.ts';
import { usageError } from './command-options.ts';
import { formatJson } from './format-utils.ts';
import { JSON_OUTPUT_OPTIONS } from './json-output-options.ts';
import { cli } from './runtime/output.ts';

export interface CliComposition {
  readonly version: string;
  readonly register: (program: Command) => void;
}

/** Entry owns transport termination and presentation. Bootstrap only supplies capabilities. */
export async function runCli(composition: CliComposition, argv = process.argv): Promise<void> {
  if (typeof composition.version !== 'string' || typeof composition.register !== 'function') {
    throw new TypeError('CLI version and registration capability are required');
  }
  let parserFailure: unknown;
  const successfulExit = {};
  const program = new Command();
  program
    .name('sec')
    .description('Spec Engineering Compiler CLI')
    .version(composition.version)
    .enablePositionalOptions()
    .configureOutput({ writeErr: () => undefined })
    .exitOverride((error) => {
      // Only Commander calls this capability. Never classify arbitrary thrown
      // objects by reading their fields, prototype, getters or Proxy traps.
      if (error.exitCode === 0) throw successfulExit;
      parserFailure = usageError(error.message);
      throw parserFailure;
    });
  composition.register(program);
  program.action(() => { program.help(); });
  let selectedCommand = program;
  const registerFailureFlags = (command: Command): void => {
    command.hook('preSubcommand', (_parent, child) => { selectedCommand = child; });
    if (command !== program) {
      // The root version flag was previously accepted after any subcommand.
      // Keep that native capability when parsing options positionally.
      command.version(composition.version);
      command.options.find(option => option.long === '--version')?.hideHelp();
    }
    const supportsJson = command.options.some(option => option.long === '--json');
    if (!supportsJson) {
      // Let the actual parser distinguish flags from option values and '--'.
      // These flags permit machine rejection, not unimplemented JSON success.
      for (const definition of JSON_OUTPUT_OPTIONS) {
        command.addOption(new Option(definition.flags, definition.description).hideHelp());
      }
      command.hook('preAction', () => {
        const options = command.opts();
        if (options.json || options.compact) {
          parserFailure = usageError('This command does not support JSON result output');
          throw parserFailure;
        }
      });
    }
    for (const child of command.commands) registerFailureFlags(child);
  };
  registerFailureFlags(program);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error === successfulExit) return;
    if (parserFailure !== undefined && error === parserFailure) {
      let json = false;
      let compact = false;
      for (let command: Command | null = selectedCommand; command !== null; command = command.parent) {
        json ||= command.getOptionValueSource('json') === 'cli' && command.opts().json === true;
        compact ||= command.getOptionValueSource('compact') === 'cli' && command.opts().compact === true;
      }
      if (json) {
        // No caller message/details or guessed artifact exists in this response.
        // Reuse the existing error owner rather than creating a CLI taxonomy.
        console.log(formatJson(buildErrorProtocol({
          code: 'CLI-USAGE-001', message: 'Invalid command arguments'
        }), { compact }));
        process.exitCode = 2;
        return;
      }
    }
    reportCliFailure(error, buildErrorProtocol, {
      write: (line) => console.error(line),
      error: (line) => cli.error(line),
      dim: (line) => cli.dim(line)
    });
    // Execution failures retain their legacy output, including repair readback.
    process.exitCode = parserFailure !== undefined && error === parserFailure ? 2 : 1;
  }
}
