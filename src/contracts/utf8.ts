/** Decode already-observed bytes without importing physical filesystem capabilities.
 * The existing fatal decoder and leading-BOM behavior are preserved. */
export function decodeExactUtf8(bytes: Uint8Array, label = 'retained file'): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not exact UTF-8`, { cause: error });
  }
}
