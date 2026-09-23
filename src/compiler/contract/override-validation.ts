import {
  isCanonicalPortableLogicalPath,
  portableLogicalPathCollisionKey
} from '../../contracts/logical-path.ts';
import { OverrideManifestSchema } from '../../semantics/provenance/override-schema.ts';
import type { OverrideManifest } from '../../semantics/provenance/types.ts';
import { modelRelativePath } from '../../workspace/contract/types.ts';
import {
  packageJsonRelativePath,
  secRelativePath,
  tsconfigRelativePath,
  workspaceConfigRelativePath
} from '../../workspace/paths.ts';
import { CompilerError } from '../errors.ts';

const BLOCKED_OVERRIDE_TARGET_PREFIXES = [
  `${modelRelativePath}/`,
  `${secRelativePath}/`
];
const BLOCKED_OVERRIDE_TARGETS = new Set<string>([
  workspaceConfigRelativePath,
  packageJsonRelativePath,
  tsconfigRelativePath
]);

function requireCanonicalOverridePath(kind: string, value: string): void {
  if (!isCanonicalPortableLogicalPath(value)) {
    throw new CompilerError(
      'OVERRIDE-SCHEMA-003',
      `${kind} must be one canonical portable relative path`
    );
  }
}

/** Decode and validate one Override manifest independently of physical storage. */
export function validateOverrideManifest(input: unknown): OverrideManifest {
  const parsed = OverrideManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompilerError(
      'OVERRIDE-SCHEMA-001',
      `Override manifest violates the exact schema: ${parsed.error.issues
        .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')}`,
      {},
      { cause: parsed.error }
    );
  }
  const manifest = parsed.data;
  const ids = new Set<string>();
  const targetOwners = new Map<string, string>();

  for (const entry of manifest.overrides) {
    if (ids.has(entry.id)) {
      throw new CompilerError(
        'OVERRIDE-SCHEMA-002',
        `Duplicate override id "${entry.id}"`
      );
    }
    requireCanonicalOverridePath('Override entry', entry.entry);
    requireCanonicalOverridePath('Override target', entry.target);
    if (!entry.entry.startsWith('patches/') &&
        !entry.entry.startsWith('rules/') &&
        !entry.entry.startsWith('manifests/')) {
      throw new CompilerError(
        'OVERRIDE-SCHEMA-004',
        `Override "${entry.id}" entry must be under patches/, rules/, or manifests/`
      );
    }
    if (BLOCKED_OVERRIDE_TARGETS.has(entry.target) ||
        BLOCKED_OVERRIDE_TARGET_PREFIXES.some(prefix => entry.target.startsWith(prefix))) {
      throw new CompilerError(
        'OVERRIDE-SCHEMA-005',
        `Override "${entry.id}" targets a reserved path "${entry.target}"`
      );
    }

    const targetKey = portableLogicalPathCollisionKey(entry.target, 'Override target');
    const previousOwner = targetOwners.get(targetKey);
    if (previousOwner !== undefined) {
      throw new CompilerError(
        'OVERRIDE-SCHEMA-008',
        `Override target "${entry.target}" has multiple owners: "${previousOwner}", "${entry.id}"`
      );
    }
    targetOwners.set(targetKey, entry.id);

    const conflicts = new Set<string>();
    for (const conflictId of entry.conflictsWith) {
      if (conflictId === entry.id || conflicts.has(conflictId)) {
        throw new CompilerError(
          'OVERRIDE-SCHEMA-007',
          `Override "${entry.id}" has an invalid conflictsWith identity "${conflictId}"`
        );
      }
      conflicts.add(conflictId);
    }
    ids.add(entry.id);
  }

  for (const entry of manifest.overrides) {
    for (const conflictId of entry.conflictsWith) {
      if (!ids.has(conflictId)) {
        throw new CompilerError(
          'OVERRIDE-SCHEMA-007',
          `Override "${entry.id}" references unknown conflict "${conflictId}"`
        );
      }
    }
  }

  return manifest;
}
