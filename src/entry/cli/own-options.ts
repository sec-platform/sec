export type CliFieldRead<Name extends string = string> = Readonly<{
  name: Name;
  /** Explicit transport boundary, not inferred from the field spelling. */
  scope: 'property' | 'own-enumerable';
}>;

/** Capture selected values once before decoding, without whole-options copying.
 * Existing programmatic property readers and Commander own-enumerable readers
 * remain distinct. Proxy/getter behavior is normal JS property access; this is
 * a snapshot of sequential observations, not an atomic or security boundary. */
export function captureCliOptions<const Fields extends readonly CliFieldRead[]>(
  input: Readonly<Record<string, unknown>>,
  fields: Fields
): Readonly<Record<Fields[number]['name'], unknown>> {
  if (input === null || typeof input !== 'object') throw new TypeError('CLI options must be an object');
  const values = Object.create(null) as Record<Fields[number]['name'], unknown>;
  for (const { name, scope } of fields) {
    const admitted = scope === 'property' || Object.getOwnPropertyDescriptor(input, name)?.enumerable === true;
    Object.defineProperty(values, name, { value: admitted ? input[name] : undefined, enumerable: true });
  }
  return Object.freeze(values);
}
