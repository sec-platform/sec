import { withProgressLifecycle, type ProgressObserver } from '../../../execution/progress-lifecycle.ts';

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  let create: () => ProgressObserver;
  try {
    const { default: ora } = await import('ora');
    create = () => ora({ text, spinner: 'dots' });
  } catch {
    // Failure to load optional presentation must not prevent the requested
    // action. Keep execution outside this catch: a failed action is not retried.
    return fn();
  }
  return withProgressLifecycle(text, create, fn);
}
