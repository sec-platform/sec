function parsePositiveSafeInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function explicitFastTestMaxConcurrency(args: readonly string[]): number | null {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--max-concurrency') {
      const value = args[index + 1] ?? '';
      values.push(value);
      if (value && !value.startsWith('--')) index += 1;
      continue;
    }
    if (arg.startsWith('--max-concurrency=')) {
      values.push(arg.slice('--max-concurrency='.length));
    }
  }

  if (values.length > 1) {
    throw new Error('Bun --max-concurrency may only be specified once for managed fast tests.');
  }
  if (values.length === 0) return null;

  const parsed = parsePositiveSafeInteger(values[0]);
  if (parsed === null) {
    throw new Error('Bun --max-concurrency must be a positive safe integer.');
  }
  return parsed;
}

export function applyDefaultFastTestConcurrency(
  command: string,
  args: readonly string[],
  defaultMaxConcurrency: number
): string[] {
  if (
    command !== 'bun' ||
    args[0] !== 'test' ||
    !args.includes('--concurrent')
  ) {
    return [...args];
  }

  if (explicitFastTestMaxConcurrency(args) !== null) return [...args];
  if (!Number.isSafeInteger(defaultMaxConcurrency) || defaultMaxConcurrency < 1) {
    throw new Error('Default Bun --max-concurrency must be a positive safe integer.');
  }

  const index = args.indexOf('--concurrent') + 1;
  return [
    ...args.slice(0, index),
    '--max-concurrency',
    String(defaultMaxConcurrency),
    ...args.slice(index)
  ];
}
