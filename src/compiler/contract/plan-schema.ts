import { z } from 'zod';
import { REGISTRY_KINDS, REGISTRY_LOCATIONS } from '../registry/contract/types.ts';

// Structural values only. Uniqueness, supported stacks, canonical paths,
// capability selection and authority remain decisions of their existing owners.
export const PackageManagerSchema = z.enum(['pnpm', 'npm', 'yarn']);
export const AppModeSchema = z.enum(['single-tenant', 'multi-tenant']);
export const PlanAppSchema = z.object({
  id: z.string(), name: z.string(), stack: z.string(),
  packageManager: PackageManagerSchema, mode: AppModeSchema
});
export const PlanRegistrySourceSchema = z.object({
  id: z.string(), kind: z.enum(REGISTRY_KINDS),
  location: z.enum(REGISTRY_LOCATIONS), path: z.string()
});
export const PlanRegistrySchema = z.object({ sources: z.array(PlanRegistrySourceSchema) });
export const PlanBlockSchema = z.object({ id: z.string(), version: z.string().optional() });

export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type AppMode = z.infer<typeof AppModeSchema>;
export type PlanApp = z.infer<typeof PlanAppSchema>;
export type PlanRegistrySource = z.infer<typeof PlanRegistrySourceSchema>;
export type PlanRegistry = z.infer<typeof PlanRegistrySchema>;
export type PlanBlock = z.infer<typeof PlanBlockSchema>;

// Normalization historically accepts omitted/null scalar decisions, but not a
// null app, registry or collection. Preserve that boundary and keep defaults in
// normalizePlan, where their workspace-dependent meaning already belongs.
const appInput = PlanAppSchema.extend({
  id: PlanAppSchema.shape.id.nullish(),
  name: PlanAppSchema.shape.name.nullish(),
  stack: PlanAppSchema.shape.stack.nullish(),
  packageManager: PlanAppSchema.shape.packageManager.nullish(),
  mode: PlanAppSchema.shape.mode.nullish()
});
export const PlanRegistrySourceInputSchema = PlanRegistrySourceSchema.extend({
  id: PlanRegistrySourceSchema.shape.id.nullish(),
  kind: PlanRegistrySourceSchema.shape.kind.nullish(),
  location: PlanRegistrySourceSchema.shape.location.nullish(),
  path: PlanRegistrySourceSchema.shape.path.nullish()
});
export type PlanRegistrySourceInput = z.infer<typeof PlanRegistrySourceInputSchema>;

export const PlanInputSchema = z.object({
  app: appInput.optional(),
  registry: z.object({ sources: z.array(PlanRegistrySourceInputSchema).optional() }).optional(),
  // Unknown block metadata historically survives normalization. This does not
  // add a new metadata authority; identity is checked by validatePlan.
  blocks: z.array(PlanBlockSchema.passthrough()).optional(),
  // Acceptance has its own domain contract/identity validation. Do not replace
  // that owner with a second partial acceptance schema in the plan loader.
  acceptance: z.array(z.unknown()).optional()
}).strict();
