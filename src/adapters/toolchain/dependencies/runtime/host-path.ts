import path from 'node:path';

function normalizedHostPath(value: string): string {
  const resolved = path.resolve(value);
  if (process.platform !== 'win32') return resolved;
  const withoutDevicePrefix = resolved.startsWith('\\\\?\\UNC\\')
    ? `\\\\${resolved.slice('\\\\?\\UNC\\'.length)}`
    : resolved.startsWith('\\\\?\\')
      ? resolved.slice('\\\\?\\'.length)
      : resolved;
  return withoutDevicePrefix.toLocaleLowerCase('en-US');
}

export function sameHostPath(left: string, right: string): boolean {
  return normalizedHostPath(left) === normalizedHostPath(right);
}
