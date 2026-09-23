import { isCanonicalRegistryVersion } from '../../semantics/identity/block.ts';

/**
 * Physical/toolchain binding for the SemVer implementation used by Upgrade.
 * Planning owns which ranges are admissible; this adapter only evaluates one
 * admitted range with the pinned Bun runtime.
 */
export function matchesUpgradeVersionRange(version: string, range: string): boolean {
  const supportedRange = isCanonicalRegistryVersion(range) || /^\d+\.\d+\.x$/u.test(range);
  return supportedRange && Bun.semver.satisfies(version, range);
}
