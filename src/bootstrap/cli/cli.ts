#!/usr/bin/env bun
import { Command } from 'commander';
import packageMetadata from '../../../package.json' with { type: 'json' };
import { buildErrorProtocol } from '../engineering/error-protocol.ts';
import { reportCliFailure } from './cli-failure.ts';
import { registerCommands } from './register-commands.ts';
import { registerPipelineCommands } from './register-pipeline-commands.ts';
import { cli } from '../../entry/cli/runtime/output.ts';

const program = new Command();
program
  .name('sec')
  .description('Spec Engineering Compiler CLI')
  .version(packageMetadata.version);

registerCommands(program);
registerPipelineCommands(program);

program.action(() => {
  program.help();
});

program.parseAsync().catch((error: unknown) => {
  try {
    reportCliFailure(error, buildErrorProtocol, {
      write: (line) => console.error(line),
      error: (line) => cli.error(line),
      dim: (line) => cli.dim(line)
    });
  } finally {
    process.exit(1);
  }
});
