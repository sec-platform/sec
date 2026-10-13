/** Exact persistent generated-state JSON encoding; callers receive data,
 * never publication authority. */
export function canonicalBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
