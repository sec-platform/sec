import { z } from 'zod';
import { isCanonicalBlockId, isCanonicalRegistryVersion } from '../identity/block.ts';

// Persisted/input structure, not permission to write or a provenance issuer.
// Keep the reference grammar, defaults and strict unknown-field policy here so
// TypeScript consumers and runtime decoding cannot independently drift.
// Defaults use factories so each parse owns mutable arrays, including the
// default short-circuit path; consumers need no manual DTO clone afterward.
const OVERRIDE_ID = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/u;

export type OverrideBlockConflict = Readonly<{
  blockId: string;
  range: string;
  rangeVersion: string;
}>;

/** The two reference namespaces are disjoint: local Override IDs have no @ or /.
 * Range admission is deliberately bounded; the runtime SemVer owner evaluates
 * admitted ranges rather than treating a Block-name prefix as a conflict. */
export function parseOverrideBlockConflict(reference: string): OverrideBlockConflict | null {
  const separator = reference.indexOf('@');
  if (separator < 0) return null;
  const blockId = reference.slice(0, separator);
  const range = reference.slice(separator + 1);
  const rangeVersion = range.startsWith('>=') ? range.slice(2)
    : /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.x$/u.test(range)
      ? `${range.slice(0, -1)}0` : range;
  if (!isCanonicalBlockId(blockId) || !isCanonicalRegistryVersion(rangeVersion)) return null;
  return { blockId, range, rangeVersion };
}

export const OverrideSourceSchema = z.enum(['manual', 'rule-backed']);
const OverrideEntrySchema = z.object({
  id: z.string().regex(OVERRIDE_ID),
  entry: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().trim().min(1),
  source: OverrideSourceSchema.default('manual'),
  conflictsWith: z.array(z.string().refine(
    reference => OVERRIDE_ID.test(reference) || parseOverrideBlockConflict(reference) !== null,
    'Expected a local Override ID or canonical Block@version, Block@M.m.x, or Block@>=version'
  )).default(() => [])
}).strict();
export const OverrideManifestSchema = z.object({
  overrides: z.array(OverrideEntrySchema).default(() => [])
}).strict();

export type OverrideSource = z.infer<typeof OverrideSourceSchema>;
export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;
export type OverrideManifest = z.infer<typeof OverrideManifestSchema>;
