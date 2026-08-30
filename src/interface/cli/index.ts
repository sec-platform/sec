#!/usr/bin/env bun
import { Command } from 'commander';
import packageMetadata from '../../../package.json' with { type: 'json' };
import { buildErrorProtocol } from '../../compiler/error-protocol.ts';
import type { CompilerErrorDetails } from '../../compiler/errors.ts';
import { formatJson } from './format-utils.ts';
import { registerCommands } from './register-commands.ts';
import { registerPipelineCommands } from './register-pipeline-commands.ts';
import { cli } from './runtime/output.ts';

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
  const failure = error as { code?: string; message?: string; details?: CompilerErrorDetails };
  const protocol = buildErrorProtocol(failure);
  console.error(cli.error(`${protocol.code} ${protocol.message}`));
  console.error(cli.dim(formatJson({
    code: protocol.code,
    message: protocol.message,
    recoverable: protocol.recoverable,
    issueType: protocol.issueType,
    suggestedActions: protocol.suggestedActions,
    artifactPaths: protocol.artifactPaths
  }, { compact: true })));
  if (protocol.details) {
    console.error(cli.dim(formatJson(protocol.details, { compact: false })));
  }
  process.exit(1);
});
