import { Argument, type Command } from 'commander';
import { CompilerError } from '../../compiler/errors.ts';
import { JSON_OUTPUT_OPTIONS, parseJsonOutputOptions, type JsonOutputOptions, type JsonOutputIssue } from './json-output-options.ts';

export type { JsonOutputOptions as JsonOpts } from './json-output-options.ts';

export function jsonOpts(opts: Readonly<Record<string, unknown>>): JsonOutputOptions {
  return parseJsonOutputOptions(opts, rejectJsonOutputIssue);
}

export function commandPath(cmd: Command): string {
  const names: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    const name = current.name();
    if (name) names.push(name);
    current = current.parent ?? null;
  }
  return names.reverse().join(' ');
}

export function commandFromRoot(cmd: Command, ...segments: readonly string[]): string {
  let root = cmd;
  while (root.parent) root = root.parent;
  return [root.name(), ...segments].filter((segment) => segment.length > 0).join(' ');
}

export function usageError(message: string): CompilerError {
  return new CompilerError('CLI-USAGE-001', message);
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
