import { snapshotByteView } from '../../../../contracts/byte-snapshot.ts';
import { compareCodeUnits, rawSha256Hex } from '../../../../contracts/canonical.ts';
import { parseExactJson } from '../../../../contracts/exact-json.ts';
import { FailureError } from '../../../../contracts/failure.ts';

export type CompilerDependencyManifestAuthority = Readonly<{
  declaredBunVersion: string;
  dependencies: Record<string, string>;
  dependencyManifestSha256: string;
  devDependencies: Record<string, string>;
}>;

/** This is byte decoding, not a version/schema migration. Preserve native
 * UTF-8 text exactly; malformed bytes must not acquire replacement identities. */
export function compilerInputText(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(snapshotByteView(bytes, label));
  } catch (cause) {
    throw new FailureError('IMPORT-AUTHORITY-001', `${label} is not an exact UTF-8 byte input`, {}, { cause });
  }
}

function dependencyRecord(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FailureError('IMPORT-AUTHORITY-001', `Root ${field} must be a dependency object`);
  }
  const entries = Object.entries(value).map(([name, version]) => {
    if (typeof version !== 'string') {
      throw new FailureError('IMPORT-AUTHORITY-001', `Root ${field}.${name} must be a version string`);
    }
    return [name, version] as const;
  }).sort(([left], [right]) => compareCodeUnits(left, right));
  return Object.freeze(Object.fromEntries(entries));
}

/** The existing manifest fingerprint grammar is unchanged for valid input.
 * Exact JSON rejects duplicate decisions instead of silently choosing one. */
export function compilerDependencyManifestAuthority(
  packageJsonBytes: Uint8Array
): CompilerDependencyManifestAuthority {
  let value: unknown;
  try {
    value = parseExactJson(compilerInputText(packageJsonBytes, 'Root package manifest'), 'Root package manifest');
  } catch (cause) {
    throw new FailureError('IMPORT-AUTHORITY-001', 'Root package manifest is not exact JSON', {}, { cause });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new FailureError('IMPORT-AUTHORITY-001', 'Root package manifest must be an object');
  }
  const record = value as Record<string, unknown>;
  const packageManager = record.packageManager;
  const match = typeof packageManager === 'string' ? /^bun@([^\s]+)$/u.exec(packageManager) : null;
  if (!match) throw new FailureError('IMPORT-AUTHORITY-001', 'Root packageManager must pin one Bun version exactly');
  const dependencies = dependencyRecord(record.dependencies, 'dependencies');
  const devDependencies = dependencyRecord(record.devDependencies, 'devDependencies');
  return Object.freeze({ declaredBunVersion: match[1]!, dependencies,
    dependencyManifestSha256: rawSha256Hex(JSON.stringify({ dependencies, devDependencies, packageManager })),
    devDependencies });
}
