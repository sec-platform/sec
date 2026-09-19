import type { Command } from 'commander';

import type { ErrorProtocolContract } from '../../application/error-protocol-contract.ts';
import type { CiContract } from '../../adapters/verification/platform/ci/contract/core.ts';
import {
  ciContractInspectionView,
  errorProtocolContractInspectionView
} from './inspection-views.ts';
import { registerNamedInspectionQuery } from './named-inspection-query.ts';

export interface ContractInspectionOperations {
  errors(): ErrorProtocolContract | PromiseLike<ErrorProtocolContract>;
  ci(): CiContract | PromiseLike<CiContract>;
}

/** Entry owns contract inspection selector grammar, projection and JSON transport. */
export function registerContractInspectionCommand(
  program: Command,
  operations: ContractInspectionOperations
): void {
  if (typeof operations.errors !== 'function' ||
      typeof operations.ci !== 'function') {
    throw new TypeError('Contract inspection operations must be callable');
  }
  registerNamedInspectionQuery(program.command('contract'), {
    errors: async () =>
      errorProtocolContractInspectionView(
        await operations.errors.call(operations)
      ),
    ci: async () =>
      ciContractInspectionView(
        await operations.ci.call(operations)
      )
  }).description('Contract inspection');
}
