import ora, { type Ora } from 'ora';
import { withProgressLifecycle } from './progress-lifecycle.ts';

function unstartedSpinner(text: string): Ora {
  return ora({ text, spinner: 'dots' });
}

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  return withProgressLifecycle(text, () => unstartedSpinner(text), fn);
}
