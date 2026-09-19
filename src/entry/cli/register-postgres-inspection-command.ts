import type { Command } from 'commander';

import { addJsonFlags, commandFromRoot, jsonOpts, type JsonOpts } from './command-options.ts';
import { captureJsonOutputInput } from './json-output-options.ts';

export interface PostgresCommandContext {
  readonly workspaceRoot: string;
  readonly output: JsonOpts;
  readonly missingMessage: string;
}

/** Entry owns Postgres inspection command grammar and invocation context. */
export function registerPostgresInspectionCommand(
  program: Command,
  handler: (context: PostgresCommandContext) => Promise<void>
): void {
  if (typeof handler !== 'function') {
    throw new TypeError('Postgres inspection handler must be callable');
  }
  addJsonFlags(program.command('postgres')).action(
    async (rawOptions: Record<string, unknown>, command: Command) => {
      await handler({
        workspaceRoot: process.cwd(),
        output: jsonOpts(captureJsonOutputInput(rawOptions, 'own-enumerable')),
        missingMessage:
          `Postgres contract not found; run ${commandFromRoot(command, 'compose')} first`
      });
    }
  );
}
