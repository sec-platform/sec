import type { JsonOpts } from '../../entry/cli/command-options.ts';
import { runWithOptionalProgress } from '../../entry/cli/command-progress.ts';

export function runWithOptionalSpinner<T>(
  text: string,
  output: JsonOpts,
  fn: () => Promise<T>
): Promise<T> {
  return runWithOptionalProgress(text, output, fn, async (progressText, execute) => {
    const { withSpinner } = await import('./runtime/spinner.ts');
    return withSpinner(progressText, execute);
  });
}
