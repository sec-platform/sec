import { compareCodeUnits } from '../../../../contracts/canonical.ts';

export const SEC_DEVELOPMENT_CRITICAL_PATH_REVISION =
  'development-critical-path-v1' as const;

export type CriticalPathDigest = `sha256:${string}`;

export function failCriticalPath(message: string): never {
  throw new Error(`Development Critical Path V1: ${message}`);
}

export function criticalPathRef(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || /[\u0000-\u0020\u007f]/u.test(value)) {
    failCriticalPath(
      `${label} must be one bounded canonical reference without whitespace/control bytes.`
    );
  }
  return value;
}

export function criticalPathDigest(value: string, label: string): CriticalPathDigest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    failCriticalPath(`${label} must be one lowercase SHA-256 digest.`);
  }
  return value as CriticalPathDigest;
}

export function criticalPathTree(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    failCriticalPath(`${label} must be one lowercase full Git tree object id.`);
  }
  return value;
}

export function sortedUniqueCriticalPathDigests(
  values: readonly CriticalPathDigest[],
  label: string
): readonly CriticalPathDigest[] {
  const normalized = values.map(
    (value, index) => criticalPathDigest(value, `${label}[${index}]`)
  );
  if (new Set(normalized).size !== normalized.length) {
    failCriticalPath(`${label} contains duplicates.`);
  }
  return Object.freeze([...normalized].sort(compareCodeUnits));
}

export function uniqueSortedCriticalPathRefs(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareCodeUnits));
}
