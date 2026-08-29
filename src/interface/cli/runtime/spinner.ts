import ora, { type Ora } from 'ora';

export function createSpinner(text: string): Ora {
  return ora({ text, spinner: 'dots' }).start();
}

export async function withSpinner<T>(text: string, fn: () => Promise<T>): Promise<T> {
  const spinner = createSpinner(text);
  try {
    const result = await fn();
    spinner.succeed(text);
    return result;
  } catch (error) {
    spinner.fail(text);
    throw error;
  }
}
