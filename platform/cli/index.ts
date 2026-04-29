#!/usr/bin/env node
import { CommandRegistry } from './command-registry.ts';
import { createLogger } from '../shared/logger.ts';
import { buildErrorProtocol } from '../shared/error-protocol.ts';

import { initCommand } from './commands/init-command.ts';
import { addCommand } from './commands/add-command.ts';
import { resolveCommand } from './commands/resolve-command.ts';
import { composeCommand, adaptCommand } from './commands/compose-adapt-command.ts';
import { verifyCommand } from './commands/verify-command.ts';
import { repairCommand } from './commands/repair-command.ts';
import { upgradeCommand } from './commands/upgrade-command.ts';
import { lockCommand } from './commands/lock-command.ts';
import { explainCommand } from './commands/explain-command.ts';
import { artifactsCommand } from './commands/artifacts-command.ts';
import { workbenchCommand } from './commands/workbench-command.ts';
import {
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
} from './commands/inspect-commands.ts';

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
  console.error(JSON.stringify({
    code: protocol.code,
    message: protocol.message,
    recoverable: protocol.recoverable,
    issueType: protocol.issueType,
    suggestedActions: protocol.suggestedActions,
    artifactPaths: protocol.artifactPaths
  }));
  if (protocol.details) {
    console.error(JSON.stringify(protocol.details, null, 2));
  }
  process.exit(1);
});
