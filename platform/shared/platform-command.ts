export function platformCommand(...args: string[]): string {
  return ['npm run platform --', ...args].join(' ');
}
