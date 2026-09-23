import { Command } from 'commander';
import { buildErrorProtocol } from '../../application/error-protocol.ts';
import { reportCliFailure } from './cli-failure.ts';
import { cli } from './runtime/output.ts';

export interface CliComposition {
  readonly version: string;
  readonly register: (program: Command) => void;
}

function createCliProgram(composition: CliComposition): Command {
  if (typeof composition.version !== 'string' || typeof composition.register !== 'function') {
    throw new TypeError('CLI version and registration capability are required');
  }
  const program = new Command();
  program
    .name('sec')
    .description('Spec Engineering Compiler CLI')
    .version(composition.version);
  composition.register(program);
  program.action(() => { program.help(); });
  return program;
}

/** Entry owns transport termination and presentation. Bootstrap only supplies capabilities. */
export async function runCli(composition: CliComposition, argv = process.argv): Promise<void> {
  const program = createCliProgram(composition);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    reportCliFailure(error, buildErrorProtocol, {
      write: (line) => console.error(line),
      error: (line) => cli.error(line),
      dim: (line) => cli.dim(line)
    });
    process.exitCode = 1;
  }
}
