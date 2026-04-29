#!/usr/bin/env node
import { buildErrorProtocol } from '../shared/error-protocol.ts';
import { createLogger } from '../shared/logger.ts';
import { CommandRegistry } from './command-registry.ts';
import { formatJson } from './format-utils.ts';

import { addCommand } from './commands/add-command.ts';
import { artifactsCommand } from './commands/artifacts-command.ts';
import { adaptCommand, composeCommand } from './commands/compose-adapt-command.ts';
import { explainCommand } from './commands/explain-command.ts';
import { initCommand } from './commands/init-command.ts';
import {
  acceptanceCommand,
  benchmarkCommand,
  blocksCommand,
  contractCommand,
  demoCommand,
  depsCommand,
  doctorCommand,
  installCommand,
  policyCommand,
  postgresCommand,
  provenanceCommand,
  referenceCommand,
  reviewCommand,
  runtimeCommand,
  testCommand,
  verificationCommand
} from './commands/inspect-commands.ts';
import { lockCommand } from './commands/lock-command.ts';
import { repairCommand } from './commands/repair-command.ts';
import { resolveCommand } from './commands/resolve-command.ts';
import { upgradeCommand } from './commands/upgrade-command.ts';
import { verifyCommand } from './commands/verify-command.ts';
import { workbenchCommand } from './commands/workbench-command.ts';

const ALL_COMMANDS = [
  initCommand,
  addCommand,
  resolveCommand,
  composeCommand,
  adaptCommand,
  verifyCommand,
  repairCommand,
  upgradeCommand,
  lockCommand,
  explainCommand,
  artifactsCommand,
  workbenchCommand,
  doctorCommand,
  depsCommand,
  referenceCommand,
  benchmarkCommand,
  testCommand,
  policyCommand,
  acceptanceCommand,
  runtimeCommand,
  verificationCommand,
  provenanceCommand,
  reviewCommand,
  demoCommand,
  contractCommand,
  installCommand,
  blocksCommand,
  postgresCommand
];

export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry(createLogger({ level: 'info' }));
  registry.registerAll(ALL_COMMANDS);
  return registry;
}

const registry = createDefaultRegistry();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(registry.buildUsage());
    return;
  }

  await registry.dispatch(args, {
    cwd: process.cwd(),
    logger: registry.logger
  });
}

main().catch((error: unknown) => {
  const failure = error as { code?: string; message?: string; details?: unknown };
  const protocol = buildErrorProtocol(failure);
  console.error(protocol.code, protocol.message);
  console.error(formatJson({
    code: protocol.code,
    message: protocol.message,
    recoverable: protocol.recoverable,
    issueType: protocol.issueType,
    suggestedActions: protocol.suggestedActions,
    artifactPaths: protocol.artifactPaths
  }, { compact: true }));
  if (protocol.details) {
    console.error(formatJson(protocol.details, { compact: false }));
  }
  process.exit(1);
});
