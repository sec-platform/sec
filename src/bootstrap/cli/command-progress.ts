import type { JsonOpts } from './command-options.ts';

export async function runWithOptionalSpinner<T>(text: string, output: JsonOpts, fn: () => Promise<T>): Promise<T> {
  if (output.json) return fn();
  const { withSpinner } = await import('./runtime/spinner.ts');
  return withSpinner(text, fn);
}
