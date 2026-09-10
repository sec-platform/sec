/** Decode a captured flag value without JavaScript truthiness or coercion. */
export function decodeBooleanFlag(
  value: unknown,
  defaultValue: boolean,
  reject: () => never
): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value !== 'boolean') return reject();
  return value;
}
