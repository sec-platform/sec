export function platformCommand(...args: string[]): string {
  return ['bun run platform --', ...args].join(' ');
}
