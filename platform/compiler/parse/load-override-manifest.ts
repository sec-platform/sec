import path from 'node:path';
import { CompilerError } from '../../shared/errors.ts';
import { pathExists } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { readYaml } from '../../shared/yaml.ts';
import type { OverrideApplyPhase, OverrideEntry, OverrideManifest } from '../../shared/types.ts';

const ALLOWED_OVERRIDE_PHASES = new Set<OverrideApplyPhase>(['compose', 'adapt']);
const BLOCKED_OVERRIDE_TARGET_PREFIXES = ['generated/', 'overrides/', 'policies/'];
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
  if (!value || path.isAbsolute(value) || value.includes('..\\') || value.includes('../')) {
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
        `Override "${entry.id}" entry must be under overrides/patches, overrides/rules, or overrides/manifests`
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

export async function loadOverrideManifest(workspaceRoot: string): Promise<OverrideManifest> {
  const { overrideManifestPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(overrideManifestPath))) {
    return { overrides: [] };
  }
  const manifest = await readYaml<OverrideManifest>(overrideManifestPath);
  return validateOverrideManifest(manifest ?? { overrides: [] });
}
