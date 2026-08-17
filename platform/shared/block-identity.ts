const BLOCK_ID_SEGMENT = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u;
const WINDOWS_DEVICE_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u;
const SEMVER_IDENTIFIER = /^[0-9a-z-]+$/u;
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

function canonicalNumericIdentifier(value: string): boolean {
  return /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function canonicalPrereleaseIdentifier(value: string): boolean {
  if (!SEMVER_IDENTIFIER.test(value)) return false;
  return !/^[0-9]+$/u.test(value) || canonicalNumericIdentifier(value);
}

function canonicalBuildIdentifier(value: string): boolean {
  return SEMVER_IDENTIFIER.test(value);
}

/**
 * Registry versions are exact canonical SemVer path segments. SEC additionally
 * requires lowercase prerelease/build identifiers so the same logical version
 * cannot acquire a second physical identity on case-insensitive filesystems.
 */
export function isCanonicalRegistryVersion(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_VERSION_LENGTH) return false;
  const plusParts = value.split('+');
  if (plusParts.length > 2) return false;
  const [versionAndPrerelease, build] = plusParts;
  if (versionAndPrerelease === undefined) return false;

  const hyphenIndex = versionAndPrerelease.indexOf('-');
  const core = hyphenIndex < 0
    ? versionAndPrerelease
    : versionAndPrerelease.slice(0, hyphenIndex);
  const prerelease = hyphenIndex < 0
    ? undefined
    : versionAndPrerelease.slice(hyphenIndex + 1);
  const coreParts = core.split('.');
  if (coreParts.length !== 3 || coreParts.some((part) => !canonicalNumericIdentifier(part))) return false;

  if (prerelease !== undefined) {
    const identifiers = prerelease.split('.');
    if (identifiers.some((part) => !canonicalPrereleaseIdentifier(part))) return false;
  }
  if (build !== undefined) {
    const identifiers = build.split('.');
    if (identifiers.some((part) => !canonicalBuildIdentifier(part))) return false;
  }
  return true;
}
