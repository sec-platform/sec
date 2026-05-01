#!/usr/bin/env node
import { Command } from 'commander';
import { cli } from '../shared/cli-output.ts';
import { buildErrorProtocol } from '../shared/error-protocol.ts';
import { formatJson } from './format-utils.ts';
import { registerCommands } from './register-commands.ts';

const program = new Command();
program
  .name('platform')
  .description('Engineering compiler CLI')
  .version('0.1.0');

registerCommands(program);

program.action(() => {
  program.help();
});

program.parseAsync().catch((error: unknown) => {
  const failure = error as { code?: string; message?: string; details?: unknown };
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
