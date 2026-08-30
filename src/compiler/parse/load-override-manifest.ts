import path from 'node:path';

import YAML from 'yaml';
import { z } from 'zod';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import type { OverrideApplyPhase, OverrideEntry, OverrideManifest } from '../../semantic/provenance/contract/types.ts';
import { isCanonicalPortableLogicalPath, portableLogicalPathCollisionKey } from '../../system-architecture/foundation/contract/logical-path.ts';
import { pathEntryExists } from '../../workspace/files.ts';
import { getWorkspacePaths } from '../../workspace/paths.ts';
import { CompilerError } from '../errors.ts';

const ALLOWED_OVERRIDE_PHASES = new Set<OverrideApplyPhase>(['compose', 'adapt']);
const BLOCKED_OVERRIDE_TARGET_PREFIXES = ['generated/', 'overrides/', 'policies/', 'control/', 'source/', '.sec/'];
const BLOCKED_OVERRIDE_TARGETS = new Set(['app.plan.yaml', 'graph.lock.json', 'provenance.json', 'package.json', 'tsconfig.json']);
const OVERRIDE_ID = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/u;

const overrideEntrySchema = z.object({
  id: z.string().regex(OVERRIDE_ID),
  entry: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().trim().min(1),
  source: z.enum(['manual', 'rule-backed']).default('manual'),
  appliesAfter: z.array(z.enum(['compose', 'adapt'])).min(1).default(['adapt']),
  conflictsWith: z.array(z.string().regex(OVERRIDE_ID)).default([])
}).strict();

const overrideManifestSchema = z.object({
  overrides: z.array(overrideEntrySchema).default([])
}).strict();

function schemaError(message: string): never {
  throw new CompilerError('OVERRIDE-SCHEMA-001', message);
}

function requireCanonicalOverridePath(kind: string, value: string): void {
  if (!isCanonicalPortableLogicalPath(value)) {
    throw new CompilerError(
      'OVERRIDE-SCHEMA-003',
      `${kind} must be one canonical portable relative path`
    );
  }
}

export function validateOverrideManifest(manifest: OverrideManifest): OverrideManifest {
  const ids = new Set<string>();
  const targetPhaseOwners = new Map<string, string>();

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

    const phases = new Set<OverrideApplyPhase>();
    for (const phase of entry.appliesAfter) {
      if (!ALLOWED_OVERRIDE_PHASES.has(phase)) {
        throw new CompilerError(
          'OVERRIDE-SCHEMA-006',
          `Override "${entry.id}" has unsupported phase "${phase}"`
        );
      }
      if (phases.has(phase)) {
        throw new CompilerError(
          'OVERRIDE-SCHEMA-006',
          `Override "${entry.id}" repeats phase "${phase}"`
        );
      }
      phases.add(phase);

      const targetPhaseKey = `${phase}:${portableLogicalPathCollisionKey(
        entry.target,
        'Override target'
      )}`;
      const previousOwner = targetPhaseOwners.get(targetPhaseKey);
      if (previousOwner !== undefined) {
        throw new CompilerError(
          'OVERRIDE-SCHEMA-008',
          `Override target "${entry.target}" has multiple ${phase} owners: "${previousOwner}", "${entry.id}"`
        );
      }
      targetPhaseOwners.set(targetPhaseKey, entry.id);
    }

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
  return getWorkspacePaths(workspaceRoot).overrideManifestPath;
}

function parseOverrideManifest(source: string, filePath: string): OverrideManifest {
  let raw: unknown;
  try {
    raw = YAML.parse(source) as unknown;
  } catch (error) {
    throw new CompilerError(
      'OVERRIDE-SCHEMA-001',
      `Override manifest is not valid YAML: ${filePath}`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
  const parsed = overrideManifestSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    schemaError(
      `Override manifest violates the exact schema: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return {
    overrides: parsed.data.overrides.map((entry): OverrideEntry => ({
      id: entry.id,
      entry: entry.entry,
      target: entry.target,
      reason: entry.reason,
      source: entry.source,
      appliesAfter: [...entry.appliesAfter],
      conflictsWith: [...entry.conflictsWith]
    }))
  };
}

export async function loadOverrideManifest(workspaceRoot: string): Promise<OverrideManifest> {
  const overrideManifestPath = await resolveOverrideManifestPath(workspaceRoot);
  const bytes = readOptionalRetainedOrdinaryFile(
    overrideManifestPath,
    'Override manifest'
  );
  if (bytes === null) return { overrides: [] };
  const source = decodeExactUtf8(bytes, 'Override manifest');
  return validateOverrideManifest(parseOverrideManifest(source, overrideManifestPath));
}
