import { Argument, type Command } from 'commander';
import { CompilerError } from '../../compiler/errors.ts';

export type JsonOpts = Readonly<{ json: boolean; compact: boolean }>;

export function jsonOpts(opts: Record<string, unknown>): JsonOpts {
  return { json: !!opts.json, compact: !!opts.compact };
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

function assertJsonFlags(opts: Record<string, unknown>, cmd: Command): void {
  if (opts.compact && !opts.json) {
    throw usageError(`Usage: ${commandPath(cmd)} [--json [--compact]]`);
  }
}

export function addJsonFlags(cmd: Command): Command {
  return cmd
    .option('--json', 'Output as JSON')
    .option('--compact', 'Compact JSON output')
    .hook('preAction', (_thisCommand, actionCommand) => {
      assertJsonFlags(actionCommand.opts(), actionCommand);
    });
}

export function optionalModeCommand(
  cmd: Command,
  name: string,
  choices: readonly string[]
): Command {
  return cmd.addArgument(new Argument(`[${name}]`).choices([...choices]));
}
