import { isCanonicalRegistryVersion } from '../../semantics/identity/block.ts';
import type { OverrideBlockConflict } from '../../semantics/provenance/override-schema.ts';

/**
 * Physical/toolchain binding for the SemVer implementation used by Upgrade.
 * Planning owns which ranges are admissible; this adapter only evaluates one
 * admitted range with the pinned Bun runtime.
 */
export function matchesUpgradeVersionRange(version: string, range: string): boolean {
  const supportedRange = isCanonicalRegistryVersion(range) || /^\d+\.\d+\.x$/u.test(range);
  return supportedRange && Bun.semver.satisfies(version, range);
}

/** Override selectors have their own bounded admission; they must not broaden
 * the accepted upgrade.from grammar. Null means the native parser cannot
 * assess the range, not evidence that the declared conflict does not apply. */
export function matchesOverrideVersionRange(version: string, conflict: OverrideBlockConflict): boolean | null {
  if (!isCanonicalRegistryVersion(version)
      || !Bun.semver.satisfies(version, version)
      || !Bun.semver.satisfies(conflict.rangeVersion, conflict.rangeVersion)) {
    return null;
  }
  return Bun.semver.satisfies(version, conflict.range);
}
