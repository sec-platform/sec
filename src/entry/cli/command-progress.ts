import type { JsonOpts } from './command-options.ts';

export type CommandProgressPresenter = <T>(
  text: string,
  execute: () => Promise<T>
) => Promise<T>;

/** Select the presentation protocol before asynchronous provider loading begins. */
export function runWithOptionalProgress<T>(
  text: string,
  output: JsonOpts,
  execute: () => Promise<T>,
  present: CommandProgressPresenter
): Promise<T> {
  return output.json ? execute() : present(text, execute);
}
