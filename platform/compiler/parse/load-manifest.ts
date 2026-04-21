import fs from 'node:fs/promises';
import path from 'node:path';
import { officialRegistryRoot } from '../../shared/paths.ts';
import { readYaml } from '../../shared/yaml.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { BlockManifest, ManifestEntry } from '../../shared/types.ts';

export function validateManifest(manifest: BlockManifest): void {
  if (!manifest?.id || !manifest?.version || !manifest?.kind) {
    throw new CompilerError('MANIFEST-SCHEMA-001', 'Manifest missing id/version/kind');
  }

  manifest.stackProfiles ??= [];
  manifest.requires ??= [];
  manifest.provides ??= [];
  manifest.conflicts ??= [];
  manifest.installs ??= [];
  manifest.pins = {
    inputs: manifest.pins?.inputs ?? [],
    outputs: manifest.pins?.outputs ?? []
  };
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

export async function loadManifestById(blockId: string): Promise<ManifestEntry> {
  const manifestPath = path.join(officialRegistryRoot, blockId.replaceAll('/', '.'), 'block.manifest.yaml');
  const manifest = await readYaml<BlockManifest>(manifestPath);
  validateManifest(manifest);
  return { manifest, manifestPath };
}

export async function loadAllManifests(): Promise<ManifestEntry[]> {
  const entries = await fs.readdir(officialRegistryRoot, { withFileTypes: true });
  const manifests: ManifestEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(officialRegistryRoot, entry.name, 'block.manifest.yaml');
    const manifest = await readYaml<BlockManifest>(manifestPath);
    validateManifest(manifest);
    manifests.push({ manifest, manifestPath });
  }
  return manifests;
}
