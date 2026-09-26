/**
 * Exact merge-message marker codec. Recovery and integration code may use the
 * committed marker only as a locator; referenced authority must still be
 * revalidated by its owning contract.
 */
export function readExactCommitMarker(message: string, name: string): string {
  const prefix = `${name}: `;
  const matches = message.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
  if (matches.length !== 1 || matches[0]!.slice(prefix.length).length === 0) {
    throw new Error(`Merged commit must contain exactly one ${name} marker.`);
  }
  return matches[0]!.slice(prefix.length);
}
