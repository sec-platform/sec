import path from 'node:path';

import { OverrideManifestSchema } from '../../semantics/provenance/override-schema.ts';
import { failureMessage } from '../../contracts/failure-inspection.ts';
import { parseYamlValue } from '../../adapters/formats/yaml.ts';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import type { OverrideManifest } from '../../semantics/provenance/types.ts';
import { isCanonicalPortableLogicalPath, portableLogicalPathCollisionKey } from '../../contracts/logical-path.ts';
import { modelRelativePath } from '../../workspace/contract/types.ts';
import { getWorkspacePaths, packageJsonRelativePath, secRelativePath, tsconfigRelativePath, workspaceConfigRelativePath } from '../../workspace/runtime/paths.ts';
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
export const OVERRIDE_YAML_MAX_INPUT_BYTES = 1024 * 1024;
export const OVERRIDE_YAML_MAX_ALIAS_COUNT = 100;

function requireCanonicalOverridePath(kind: string, value: string): void {
  if (!isCanonicalPortableLogicalPath(value)) {
    throw new CompilerError(
      'OVERRIDE-SCHEMA-003',
      `${kind} must be one canonical portable relative path`
    );
  }
}

export function validateOverrideManifest(input: unknown): OverrideManifest {
  const parsed = OverrideManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompilerError('OVERRIDE-SCHEMA-001',
      `Override manifest violates the exact schema: ${parsed.error.issues
        .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')}`,
      {}, { cause: parsed.error });
  }
  // The library already returns an independent decoded value. Do not hand-map
  // every field into a second DTO or re-parse it on the file-loading path.
  const manifest = parsed.data;
  const ids = new Set<string>();
  const targetOwners = new Map<string, string>();

  for (const entry of manifest.overrides) {
    if (ids.has(entry.id)) {
      throw new CompilerError('OVERRIDE-SCHEMA-002', `Duplicate override id "${entry.id}"`);
    }
    requireCanonicalOverridePath('Override entry', entry.entry);
    requireCanonicalOverridePath('Override target', entry.target);
    if (!entry.entry.startsWith('patches/') && !entry.entry.startsWith('rules/') && !entry.entry.startsWith('manifests/')) {
      throw new CompilerError(
        'OVERRIDE-SCHEMA-004',
        `Override "${entry.id}" entry must be under patches/, rules/, or manifests/`
      );
    }
    if (
      BLOCKED_OVERRIDE_TARGETS.has(entry.target)
      || BLOCKED_OVERRIDE_TARGET_PREFIXES.some((prefix) => entry.target.startsWith(prefix))
    ) {
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

export async function resolveOverrideManifestPath(workspaceRoot: string): Promise<string> {
  return path.join(getWorkspacePaths(workspaceRoot).overridesRoot, 'override-manifest.yaml');
}

function parseOverrideManifest(source: string, filePath: string): OverrideManifest {
  let raw: unknown;
  try {
    raw = parseYamlValue(source, { label: `Override manifest ${filePath}`,
      maximumInputBytes: OVERRIDE_YAML_MAX_INPUT_BYTES,
      stringKeys: true, maximumAliasCount: OVERRIDE_YAML_MAX_ALIAS_COUNT });
  } catch (error) {
    throw new CompilerError('OVERRIDE-SCHEMA-001', `Override manifest is not valid YAML: ${filePath}`,
      { cause: failureMessage(error) }, { cause: error });
  }
  // Preserve empty YAML's existing empty-manifest interpretation. Runtime
  // schema validation still precedes cross-record/path/ownership decisions.
  return validateOverrideManifest(raw ?? {});
}

export async function loadOverrideManifest(workspaceRoot: string): Promise<OverrideManifest> {
  const overrideManifestPath = await resolveOverrideManifestPath(workspaceRoot);
  const bytes = readOptionalRetainedOrdinaryFile(
    overrideManifestPath,
    'Override manifest'
  );
  if (bytes === null) return { overrides: [] };
  const source = decodeExactUtf8(bytes, 'Override manifest');
  return parseOverrideManifest(source, overrideManifestPath);
}
