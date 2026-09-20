import { Argument, type Command } from 'commander';
import { addJsonFlags, commandPath, jsonOpts, usageError } from './command-options.ts';
import type { CommandValue } from './command-value.ts';
import { printJsonOrText } from './format-utils.ts';
import { captureJsonOutputInput } from './json-output-options.ts';

type NamedInspection = () => CommandValue | PromiseLike<CommandValue>;

/** A required selector chooses different read-only sources, not alternative
 * projections of one read. One map owns native choices and dispatch. Domain
 * readers/validators stay with their owners; no mutation or retry is added. */
export function registerNamedInspectionQuery(
  command: Command,
  readers: Readonly<Record<string, NamedInspection>>
): Command {
  const selectedReaders = new Map(Object.entries(readers));
  if (selectedReaders.size === 0 || [...selectedReaders].some(([name, read]) => name.length === 0 || typeof read !== 'function')) {
    throw new TypeError('Named inspection requires non-empty callable readers');
  }
  if (command.registeredArguments.length > 0) throw new TypeError('Named inspection expects no predeclared argument');
  const choices = [...selectedReaders.keys()];
  command.addArgument(new Argument('<kind>').choices(choices));
  addJsonFlags(command);
  return command.action(async (kind: unknown, options: Record<string, unknown>) => {
    const output = jsonOpts(captureJsonOutputInput(options, 'own-enumerable'));
    const read = typeof kind === 'string' ? selectedReaders.get(kind) : undefined;
    if (read === undefined) throw usageError(`Usage: ${commandPath(command)} <${choices.join('|')}> [--json [--compact]]`);
    const result = await read();
    printJsonOrText(result.value, output, result.formatText);
  });
}
