import ora, { type Ora } from 'ora';
import { withProgressLifecycle } from './progress-lifecycle.ts';

function unstartedSpinner(text: string): Ora {
  return ora({ text, spinner: 'dots' });
}

/** Manual spinner callers own its lifetime; action callers use withSpinner. */
export function createSpinner(text: string): Ora {
  const spinner = unstartedSpinner(text);
  try { return spinner.start(); }
  catch (error) {
    try { spinner.stop(); } catch { /* Preserve the start failure. */ }
    throw error;
  }
}

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  return withProgressLifecycle(text, () => unstartedSpinner(text), fn);
}
