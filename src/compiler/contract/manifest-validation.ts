import { isSafeRelativePath } from '../../contracts/relative-path.ts';
import { isCanonicalBlockId, isCanonicalRegistryVersion } from '../../semantics/identity/block.ts';
import { CompilerError } from '../errors.ts';
import type { BlockManifest, ManifestEntry } from './plan-manifest.ts';
import type { PlanRegistrySource } from './plan-schema.ts';
import { normalizeAndValidateSemanticManifestFields } from './semantic-manifest-validation.ts';

const MANIFEST_ROOT_FIELDS = new Set<keyof BlockManifest>([
  'id',
  'version',
  'kind',
  'stackProfiles',
  'compatibility',
  'requires',
  'provides',
  'conflicts',
  'installs',
  'pins',
  'acceptance',
  'upgrade',
  'contracts',
  'generators'
]);

export function validateRegistrySource(source: PlanRegistrySource): void {
  if (!source || typeof source !== 'object' ||
      typeof source.id !== 'string' || source.id.length === 0) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      'Registry source requires one non-empty id'
    );
  }
  if (source.kind !== 'official' &&
      source.kind !== 'private' &&
      source.kind !== 'community') {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Registry source "${source.id}" has unsupported kind "${String(source.kind)}"`
    );
  }
  if (source.location !== 'compiler' && source.location !== 'workspace') {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Registry source "${source.id}" has unsupported location "${String(source.location)}"`
    );
  }
  if (source.location === 'compiler' && source.kind !== 'official') {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Registry source "${source.id}" cannot use compiler location unless it is official`
    );
  }
  if (typeof source.path !== 'string' || !isSafeRelativePath(source.path)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Registry source "${source.id}" has an unsafe relative path`
    );
  }
}

export function validateManifest(
  manifest: BlockManifest
): asserts manifest is ManifestEntry['manifest'] {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new CompilerError('MANIFEST-SCHEMA-001', 'Manifest must be one object');
  }
  const unknownFields = Object.keys(manifest)
    .filter(field => !MANIFEST_ROOT_FIELDS.has(field as keyof BlockManifest));
  if (unknownFields.length > 0) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-001',
      `Manifest has unsupported fields: ${unknownFields.sort().join(', ')}`
    );
  }
  if (!isCanonicalBlockId(manifest.id) ||
      !isCanonicalRegistryVersion(manifest.version)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-015',
      `Manifest has a non-canonical id/version locator: ${String(manifest.id)}@${String(manifest.version)}`
    );
  }
  if (manifest.kind !== 'capability' &&
      manifest.kind !== 'strategy' &&
      manifest.kind !== 'infra' &&
      manifest.kind !== 'governance') {
    throw new CompilerError(
      'MANIFEST-SCHEMA-001',
      `Manifest "${manifest.id}" has unsupported kind "${String(manifest.kind)}"`
    );
  }
  manifest.stackProfiles ??= [];
  if (!Array.isArray(manifest.stackProfiles)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-002',
      `Manifest "${manifest.id}" stackProfiles must be an array`
    );
  }
  manifest.compatibility ??= {
    blockApi: '1',
    compilerApi: '1',
    stackProfiles: [...manifest.stackProfiles]
  };
  manifest.requires ??= [];
  manifest.provides ??= [];
  manifest.conflicts ??= [];
  if (!Array.isArray(manifest.requires) ||
      !Array.isArray(manifest.provides) ||
      !Array.isArray(manifest.conflicts)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-001',
      `Manifest "${manifest.id}" dependency declarations must be arrays`
    );
  }
  normalizeAndValidateSemanticManifestFields(manifest);
  manifest.installs ??= [];
  manifest.pins = {
    inputs: manifest.pins?.inputs ?? [],
    outputs: manifest.pins?.outputs ?? []
  };
  manifest.acceptance ??= [];
  manifest.upgrade ??= { from: [], migrations: [] };
  manifest.upgrade.from ??= [];
  manifest.upgrade.migrations ??= [];

  if (manifest.stackProfiles.length === 0) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-002',
      `Manifest "${manifest.id}" must declare stackProfiles`
    );
  }
  if (!Array.isArray(manifest.installs) || manifest.installs.length === 0) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-003',
      `Manifest "${manifest.id}" must declare installs`
    );
  }
  if (!Array.isArray(manifest.acceptance)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-001',
      `Manifest "${manifest.id}" collection fields must be arrays`
    );
  }
  if (!Array.isArray(manifest.pins.inputs) || !Array.isArray(manifest.pins.outputs)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-001',
      `Manifest "${manifest.id}" pins must be arrays`
    );
  }
  if (!Array.isArray(manifest.upgrade.from) ||
      !Array.isArray(manifest.upgrade.migrations)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-001',
      `Manifest "${manifest.id}" upgrade fields must be arrays`
    );
  }

  for (const install of manifest.installs) {
    if (!install || typeof install !== 'object' ||
        !install.kind || !install.from || !install.to) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-005',
        `Manifest "${manifest.id}" install entries require kind/from/to`
      );
    }
    if (!isSafeRelativePath(install.from) || !isSafeRelativePath(install.to)) {
      throw new CompilerError(
        'MANIFEST-SCHEMA-006',
        `Manifest "${manifest.id}" install paths must stay inside their allowed roots`
      );
    }
  }
}
