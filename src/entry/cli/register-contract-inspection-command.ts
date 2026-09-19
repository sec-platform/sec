import type { Command } from 'commander';

import { registerNamedInspectionQuery } from './named-inspection-query.ts';
import type { CommandValue } from './command-value.ts';

export interface ContractInspectionHandlers {
  errors(): CommandValue | PromiseLike<CommandValue>;
  ci(): CommandValue | PromiseLike<CommandValue>;
}

/** Entry owns contract inspection selector grammar and JSON transport. */
export function registerContractInspectionCommand(
  program: Command,
  handlers: ContractInspectionHandlers
): void {
  if (typeof handlers.errors !== 'function' || typeof handlers.ci !== 'function') {
    throw new TypeError('Contract inspection handlers must be callable');
  }
  registerNamedInspectionQuery(program.command('contract'), {
    errors: handlers.errors,
    ci: handlers.ci
  }).description('Contract inspection');
}
