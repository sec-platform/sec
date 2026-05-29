import path from 'node:path';
import { CompilerError } from '../../shared/errors.ts';
import { pathExists } from '../../shared/fs.ts';
import { getWorkspacePaths, isSafeRelativePath } from '../../shared/paths.ts';
import { emptyOverrideManifest, type OverrideApplyPhase, type OverrideEntry, type OverrideManifest } from '../../shared/provenance-types.ts';
import { readOptionalYaml } from '../../shared/yaml.ts';

const ALLOWED_OVERRIDE_PHASES = new Set<OverrideApplyPhase>(['compose', 'adapt']);
const BLOCKED_OVERRIDE_TARGET_PREFIXES = ['generated/', 'overrides/', 'policies/', 'control/', 'source/', '.sec/'];
const BLOCKED_OVERRIDE_TARGETS = new Set(['app.plan.yaml', 'graph.lock.json', 'provenance.json', 'package.json', 'tsconfig.json']);

function normalizeOverrideEntry(entry: Partial<OverrideEntry>): OverrideEntry {
  return {
    id: entry.id ?? '',
    entry: entry.entry ?? '',
    target: entry.target ?? '',
    reason: entry.reason ?? '',
    source: entry.source ?? 'manual',
    appliesAfter: entry.appliesAfter ?? ['adapt'],
    conflictsWith: entry.conflictsWith ?? []
  };
}

function ensureRelativeProjectPath(kind: string, value: string): void {
  if (!isSafeRelativePath(value)) {
    throw new CompilerError('OVERRIDE-SCHEMA-003', `${kind} must stay inside the project tree`);
  }
}

export function validateOverrideManifest(manifest: OverrideManifest): OverrideManifest {
  const normalized = {
    overrides: (manifest.overrides ?? []).map((entry) => normalizeOverrideEntry(entry))
  };

  const ids = new Set<string>();
  for (const entry of normalized.overrides) {
    if (!entry.id || !entry.entry || !entry.target || !entry.reason) {
      throw new CompilerError('OVERRIDE-SCHEMA-001', 'Override requires id/entry/target/reason');
    }
    if (ids.has(entry.id)) {
      throw new CompilerError('OVERRIDE-SCHEMA-002', `Duplicate override id "${entry.id}"`);
    }
    ensureRelativeProjectPath('Override entry', entry.entry);
    ensureRelativeProjectPath('Override target', entry.target);
    if (!entry.entry.startsWith('patches/') && !entry.entry.startsWith('rules/') && !entry.entry.startsWith('manifests/')) {
      throw new CompilerError(
        'OVERRIDE-SCHEMA-004',
        `Override "${entry.id}" entry must be under patches/, rules/, or manifests/`
      );
    }
    if (BLOCKED_OVERRIDE_TARGETS.has(entry.target) || BLOCKED_OVERRIDE_TARGET_PREFIXES.some((prefix) => entry.target.startsWith(prefix))) {
      throw new CompilerError('OVERRIDE-SCHEMA-005', `Override "${entry.id}" targets a reserved path "${entry.target}"`);
    }
    for (const phase of entry.appliesAfter) {
      if (!ALLOWED_OVERRIDE_PHASES.has(phase)) {
        throw new CompilerError('OVERRIDE-SCHEMA-006', `Override "${entry.id}" has unsupported phase "${phase}"`);
      }
    }
    ids.add(entry.id);
  }

  return normalized;
}

export async function resolveOverrideManifestPath(workspaceRoot: string): Promise<string> {
  const { overrideManifestPath, legacyOverrideManifestPath, legacySourceOverridesRoot } = getWorkspacePaths(workspaceRoot);
  if (await pathExists(overrideManifestPath)) {
    return overrideManifestPath;
  }
  const legacySourceOverrideManifestPath = path.join(legacySourceOverridesRoot, 'override-manifest.yaml');
  return (await pathExists(legacySourceOverrideManifestPath)) ? legacySourceOverrideManifestPath : legacyOverrideManifestPath;
}

export async function loadOverrideManifest(workspaceRoot: string): Promise<OverrideManifest> {
  const overrideManifestPath = await resolveOverrideManifestPath(workspaceRoot);
  const manifest = await readOptionalYaml<OverrideManifest>(overrideManifestPath);
  return validateOverrideManifest(manifest ?? emptyOverrideManifest());
}
