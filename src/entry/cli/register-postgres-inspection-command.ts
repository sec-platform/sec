import type { Command } from 'commander';

import type { PostgresContractProjectionSource } from '../../application/postgres-contract.ts';
import {
  postgresContractInspectionView
} from './inspection-views.ts';
import {
  addJsonFlags,
  commandFromRoot,
  jsonOpts
} from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';
import { captureJsonOutputInput } from './json-output-options.ts';

export interface PostgresInspectionOperations {
  read(input: Readonly<{
    workspaceRoot: string;
    missingMessage: string;
  }>): Promise<PostgresContractProjectionSource>;
}

/** Entry owns Postgres inspection grammar, projection and presentation. */
export function registerPostgresInspectionCommand(
  program: Command,
  operations: PostgresInspectionOperations
): void {
  if (typeof operations.read !== 'function') {
    throw new TypeError('Postgres inspection read operation must be callable');
  }
  addJsonFlags(program.command('postgres')).action(
    async (rawOptions: Record<string, unknown>, command: Command) => {
      const output = jsonOpts(
        captureJsonOutputInput(rawOptions, 'own-enumerable')
      );
      const contract = await operations.read.call(operations, {
        workspaceRoot: process.cwd(),
        missingMessage:
          `Postgres contract not found; run ${commandFromRoot(command, 'compose')} first`
      });
      const projection = await postgresContractInspectionView(contract);
      printJsonOrText(
        projection.value,
        output,
        projection.formatText
      );
    }
  );
}
