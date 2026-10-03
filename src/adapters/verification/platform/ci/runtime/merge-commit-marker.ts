export function exactCommitMarker(message: string, name: string): string {
  const prefix = `${name}: `;
  const matches = message.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
  if (matches.length !== 1 || matches[0]!.slice(prefix.length).length === 0) {
    throw new Error(`Merged commit must contain exactly one ${name} marker.`);
  }
  return matches[0]!.slice(prefix.length);
}

/**
 * Reads one exact merge marker without giving callers a second parser or
 * substring-based fallback.  Recovery paths use the committed marker only as
 * a locator and must still revalidate the referenced canonical artifacts.
 */
export function readExactCommitMarker(message: string, name: string): string {
  return exactCommitMarker(message, name);
}
