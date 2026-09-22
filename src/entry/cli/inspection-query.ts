import type { Command } from 'commander';
import { addJsonFlags, commandFromRoot, jsonOpts, optionalModeCommand, usageError } from './command-options.ts';
import type { CommandValue } from './command-value.ts';
import { printJsonOrText } from './format-utils.ts';
import type { JsonOutputOptions } from './json-output-options.ts';
export { commandValue as inspectionValue } from './command-value.ts';

export interface InspectionContext {
  readonly workspaceRoot: string;
  readonly rootCommand: string;
  readonly output: JsonOutputOptions;
}

type Awaitable<T> = T | PromiseLike<T>;
export type InspectionView<T> =
  (value: T, context: InspectionContext) => Awaitable<CommandValue>;

export interface InspectionQueryDefinition<T> {
  readonly description?: string;
  readonly defaultMode?: string;
  readonly read: (context: InspectionContext) => Awaitable<T>;
  readonly view: InspectionView<T>;
  readonly modes?: Readonly<Record<string, InspectionView<T>>>;
}

/** One lifecycle for read-only inspection: admit, capture, read, project, print.
 * Domain reads retain their existing parsers and physical policies. This does
 * not grant capabilities, add retries, or wrap write/rollback operations. */
export function registerInspectionQuery<T>(
  command: Command,
  definition: Readonly<InspectionQueryDefinition<T>>
): Command {
  const { description, defaultMode, read, view } = definition;
  const name = command.name();
  const modes = new Map(Object.entries(definition.modes ?? {}));
  if (typeof read !== 'function' || typeof view !== 'function'
      || [...modes.values()].some((project) => typeof project !== 'function')) {
    throw new TypeError('Inspection query readers and views must be callable');
  }
  if (defaultMode !== undefined) {
    if (typeof defaultMode !== 'string' || defaultMode.length === 0 || modes.has(defaultMode)) {
      throw new TypeError('Inspection default mode must be a non-empty, distinct name');
    }
    modes.set(defaultMode, view);
  }
  if (command.registeredArguments.length > 0) {
    throw new TypeError('Inspection query expects a command without predeclared arguments');
  }
  // Keep native .command('literal') at the caller: the existing Source Program
  // observer binds public entrypoints there, not through a second name registry.
  if (modes.size > 0) optionalModeCommand(command, 'mode', [...modes.keys()]);
  addJsonFlags(command);
  if (description !== undefined) command.description(description);

  const execute = async (mode: unknown, options: Record<string, unknown>): Promise<void> => {
    const selected = mode === undefined ? view : typeof mode === 'string' ? modes.get(mode) : undefined;
    if (selected === undefined) throw usageError(`Unsupported ${name} inspection mode`);
    const workspaceRoot = process.cwd();
    const context = Object.freeze({ workspaceRoot, rootCommand: commandFromRoot(command), output: jsonOpts(options) });
    const value = await read(context);
    const projection = await selected(value, context);
    printJsonOrText(projection.value, context.output, projection.formatText);
  };
  // Commander has different action signatures with and without an argument.
  // Keep that transport detail here rather than repeating it in every query.
  return command.action(modes.size > 0
    ? (mode: string | undefined, options: Record<string, unknown>) => execute(mode, options)
    : (options: Record<string, unknown>) => execute(undefined, options));
}
