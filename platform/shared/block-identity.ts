const BLOCK_ID_SEGMENT = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u;
const SAFE_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/u;
const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u;
const MAX_BLOCK_ID_LENGTH = 256;
const MAX_VERSION_LENGTH = 128;

/**
 * Canonical Block identity is intentionally stricter than a generic string:
 * - lowercase ASCII prevents case-fold ambiguity across filesystems;
 * - slash separates namespace segments and is the only separator;
 * - dot/backslash/colon are excluded so blockDirName(id) remains injective and
 *   cannot become a Windows path/device alias;
 * - every segment is non-empty and bounded.
 */
export function isCanonicalBlockId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BLOCK_ID_LENGTH) return false;
  const segments = value.split('/');
  if (segments.length < 2) return false;
  return segments.every((segment) =>
    BLOCK_ID_SEGMENT.test(segment) && !WINDOWS_DEVICE_SEGMENT.test(segment)
  );
}

/**
 * Registry versions are exact canonical SemVer-shaped path segments. SEC uses
 * lowercase prerelease/build identifiers so the same version cannot acquire a
 * second physical identity on case-insensitive filesystems.
 */
export function isCanonicalRegistryVersion(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_VERSION_LENGTH
    && SAFE_VERSION.test(value);
}
