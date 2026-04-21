import fs from 'node:fs/promises';
import path from 'node:path';
import { officialRegistryRoot } from '../../shared/paths.js';
import { readYaml } from '../../shared/yaml.js';
import { CompilerError } from '../../shared/errors.js';

export function validateManifest(manifest) {
  if (!manifest?.id || !manifest?.version || !manifest?.kind) {
    throw new CompilerError('MANIFEST-SCHEMA-001', 'Manifest missing id/version/kind');
  }

  manifest.stackProfiles ??= [];
  manifest.requires ??= [];
  manifest.provides ??= [];
  manifest.conflicts ??= [];
  manifest.installs ??= [];
  manifest.pins ??= {};
  manifest.pins.inputs ??= [];
  manifest.pins.outputs ??= [];
  manifest.slots ??= [];
  manifest.acceptance ??= [];
  manifest.routes ??= [];

  if (!Array.isArray(manifest.stackProfiles) || manifest.stackProfiles.length === 0) {
    throw new CompilerError('MANIFEST-SCHEMA-002', `Manifest "${manifest.id}" must declare stackProfiles`);
  }
  if (!Array.isArray(manifest.installs) || manifest.installs.length === 0) {
    throw new CompilerError('MANIFEST-SCHEMA-003', `Manifest "${manifest.id}" must declare installs`);
  }
}

export async function loadManifestById(blockId) {
  const manifestPath = path.join(officialRegistryRoot, blockId.replaceAll('/', '.'), 'block.manifest.yaml');
  const manifest = await readYaml(manifestPath);
  validateManifest(manifest);
  return { manifest, manifestPath };
}

export async function loadAllManifests() {
  const entries = await fs.readdir(officialRegistryRoot, { withFileTypes: true });
  const manifests = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(officialRegistryRoot, entry.name, 'block.manifest.yaml');
    const manifest = await readYaml(manifestPath);
    validateManifest(manifest);
    manifests.push({ manifest, manifestPath });
  }
  return manifests;
}
