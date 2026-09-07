import { z } from 'zod';

// Persisted/input structure, not permission to write or a provenance issuer.
// Keep the existing token, defaults and strict unknown-field policy here so
// TypeScript consumers and runtime decoding cannot independently drift.
// Defaults use factories so each parse owns mutable arrays, including the
// default short-circuit path; consumers need no manual DTO clone afterward.
const OVERRIDE_ID = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/u;
export const OverrideSourceSchema = z.enum(['manual', 'rule-backed']);
export const OverrideEntrySchema = z.object({
  id: z.string().regex(OVERRIDE_ID),
  entry: z.string().min(1),
  target: z.string().min(1),
  reason: z.string().trim().min(1),
  source: OverrideSourceSchema.default('manual'),
  conflictsWith: z.array(z.string().regex(OVERRIDE_ID)).default(() => [])
}).strict();
export const OverrideManifestSchema = z.object({
  overrides: z.array(OverrideEntrySchema).default(() => [])
}).strict();

export type OverrideSource = z.infer<typeof OverrideSourceSchema>;
export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;
export type OverrideManifest = z.infer<typeof OverrideManifestSchema>;
