/** Standard JSON output with one additional boundary invariant: an output
 * document must contain a value. This is not canonicalization, a domain schema
 * or a replacement JSON serializer. Native cycles/BigInt/toJSON errors survive. */
export function stringifyJsonValue(value: unknown, space: number, label = 'JSON output'): string {
  const serialized = JSON.stringify(value, null, space);
  if (typeof serialized !== 'string') throw new TypeError(`${label} must contain one JSON value`);
  return serialized;
}

export function formatJsonFile(value: unknown): string {
  return `${stringifyJsonValue(value, 2, 'JSON file')}\n`;
}
