import { Argument, type Command } from 'commander';
import { FailureError } from '../../contracts/failure.ts';
import { JSON_OUTPUT_OPTIONS, parseJsonOutputOptions, type JsonOutputIssue, type JsonOutputOptions } from './json-output-options.ts';

export type { JsonOutputOptions as JsonOpts } from './json-output-options.ts';

export function jsonOpts(opts: Readonly<Record<string, unknown>>): JsonOutputOptions {
  return parseJsonOutputOptions(opts, rejectJsonOutputIssue);
}

/** One parent traversal; callers only inspect the names they actually need. */
function* commandLineage(cmd: Command): Generator<Command> {
  const visited = new Set<Command>();
  let current: Command | null = cmd;
  while (current) {
    if (visited.has(current)) throw usageError('CLI command parent cycle');
    visited.add(current);
    yield current;
    current = current.parent ?? null;
  }
}

export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (const current of commandLineage(cmd)) {
    const name = current.name();
    if (name) names.push(name);
  }
  return names.reverse().join(' ');
}

export function commandFromRoot(cmd: Command, ...segments: readonly string[]): string {
  let root = cmd;
  for (const current of commandLineage(cmd)) root = current;
  return [root.name(), ...segments].filter((segment) => segment.length > 0).join(' ');
}

export function usageError(message: string): FailureError {
  return new FailureError('CLI-USAGE-001', message);
}

function rejectJsonOutputIssue(issue: JsonOutputIssue, cmd?: Command): never {
  throw usageError(issue.kind === 'missing-dependency' && cmd !== undefined
    ? `Usage: ${commandPath(cmd)} [--json [--compact]]`
    : issue.message);
}

export function addJsonFlags(
  cmd: Command,
  reject: (issue: JsonOutputIssue, cmd: Command) => never = rejectJsonOutputIssue
): Command {
  for (const definition of JSON_OUTPUT_OPTIONS) {
    cmd.option(definition.flags, definition.description);
  }
  return cmd.hook('preAction', (_thisCommand, actionCommand) => {
    parseJsonOutputOptions(actionCommand.opts(), (issue) => reject(issue, actionCommand));
  });
}

export function optionalModeCommand(
  cmd: Command,
  name: string,
  choices: readonly string[]
): Command {
  return cmd.addArgument(new Argument(`[${name}]`).choices([...choices]));
}
