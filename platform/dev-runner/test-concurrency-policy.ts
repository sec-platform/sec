import { availableParallelism } from 'node:os';

export const DEFAULT_FAST_TEST_MAX_CONCURRENCY = Math.max(4, Math.min(8, availableParallelism()));

function hasOption(args: readonly string[], option: string): boolean {
  return args.some((arg) => arg === option || arg.startsWith(`${option}=`));
}

export function applyDefaultFastTestConcurrency(
  command: string,
  args: readonly string[]
): string[] {
  if (
    command !== 'bun' ||
    args[0] !== 'test' ||
    !args.includes('--concurrent') ||
    hasOption(args, '--max-concurrency')
  ) {
    return [...args];
  }

  const index = args.indexOf('--concurrent') + 1;
  return [
    ...args.slice(0, index),
    '--max-concurrency',
    String(DEFAULT_FAST_TEST_MAX_CONCURRENCY),
    ...args.slice(index)
  ];
}
