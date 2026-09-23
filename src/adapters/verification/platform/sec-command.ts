export function platformCommand(...args: string[]): string {
  return ['bun run sec --', ...args].join(' ');
}
