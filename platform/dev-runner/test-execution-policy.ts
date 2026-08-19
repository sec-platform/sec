/** One default per-test deadline for every canonical test lane. */
export const DEFAULT_TEST_TIMEOUT_MS = 180_000;

export function withDefaultTestTimeout(options: readonly string[]): string[] {
  return options.some((option) => option === '--timeout' || option.startsWith('--timeout='))
    ? [...options]
    : [...options, '--timeout', String(DEFAULT_TEST_TIMEOUT_MS)];
}
