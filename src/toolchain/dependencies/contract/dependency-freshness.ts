import { z } from 'zod';

import {
  exactPackageReleaseSchema,
  packageRegistryPackageNameSchema
} from '../../../external-capabilities/package-registry/contract/anonymous-registry.ts';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const dependencyFreshnessManifestEntrySchema = z.object({
  declaredName: packageRegistryPackageNameSchema,
  declaredReference: z.string().min(1),
  section: z.enum(['dependencies', 'devDependencies'])
}).strict();

export const dependencyFreshnessManifestObservationSchema = z.object({
  bunPackageManagerVersion: exactPackageReleaseSchema,
  entries: z.array(dependencyFreshnessManifestEntrySchema),
  manifestDigest: sha256Schema
}).strict();

export const dependencyFreshnessLockEntrySchema = z.object({
  declaredName: packageRegistryPackageNameSchema,
  packageName: packageRegistryPackageNameSchema,
  resolvedVersion: exactPackageReleaseSchema
}).strict();

export const dependencyFreshnessLockObservationSchema = z.object({
  entries: z.array(dependencyFreshnessLockEntrySchema),
  lockDigest: sha256Schema
}).strict();

export const dependencyRegistryObservationSchema = z.discriminatedUnion('status', [
  z.object({
    latestVersion: exactPackageReleaseSchema,
    packageName: packageRegistryPackageNameSchema,
    provider: z.string().min(1),
    status: z.literal('resolved')
  }).strict(),
  z.object({
    packageName: packageRegistryPackageNameSchema,
    provider: z.string().min(1),
    reason: z.enum([
      'machine-interface-unavailable',
      'deadline-exhausted',
      'network-unavailable',
      'package-not-found',
      'provider-failure',
      'response-invalid',
      'response-too-large'
    ]),
    status: z.literal('unavailable')
  }).strict()
]);

export const dependencyFreshnessInputSchema = z.object({
  bunRuntimeVersion: exactPackageReleaseSchema,
  lock: dependencyFreshnessLockObservationSchema,
  manifest: dependencyFreshnessManifestObservationSchema,
  registry: z.array(dependencyRegistryObservationSchema)
}).strict();

export type DependencyFreshnessManifestEntry = z.infer<typeof dependencyFreshnessManifestEntrySchema>;
export type DependencyFreshnessManifestObservation = z.infer<typeof dependencyFreshnessManifestObservationSchema>;
export type DependencyFreshnessLockEntry = Readonly<z.infer<typeof dependencyFreshnessLockEntrySchema>>;
export type DependencyFreshnessLockObservation = Readonly<{
  readonly entries: readonly DependencyFreshnessLockEntry[];
  readonly lockDigest: `sha256:${string}`;
}>;
export type DependencyRegistryObservation = z.infer<typeof dependencyRegistryObservationSchema>;
export type DependencyFreshnessInput = z.infer<typeof dependencyFreshnessInputSchema>;

export type DependencyFreshnessStatus =
  | 'up-to-date'
  | 'intentional-pin'
  | 'upgrade-required'
  | 'unresolved';

export type DependencyFreshnessReason =
  | 'current-release'
  | 'runtime-version-role'
  | 'paired-provider-roles'
  | 'newer-release-observed'
  | 'bun-runtime-mismatch'
  | 'lock-entry-missing'
  | 'lock-package-identity-mismatch'
  | 'lock-entry-unexpected'
  | 'registry-observation-missing'
  | 'registry-observation-unavailable'
  | 'registry-observation-behind-lock';

export interface DependencyFreshnessPackageDecision {
  readonly declaredName: string;
  readonly latestVersion: string | null;
  readonly packageName: string | null;
  readonly reason: DependencyFreshnessReason;
  readonly resolvedVersion: string | null;
  readonly roles: readonly string[];
  readonly status: DependencyFreshnessStatus;
}

export interface DependencyFreshnessDecision {
  readonly inputDigest: `sha256:${string}`;
  readonly lockDigest: `sha256:${string}`;
  readonly manifestDigest: `sha256:${string}`;
  readonly packages: readonly Readonly<DependencyFreshnessPackageDecision>[];
  readonly status: DependencyFreshnessStatus;
}

export function parseDependencyFreshnessInput(value: unknown): DependencyFreshnessInput {
  return dependencyFreshnessInputSchema.parse(value);
}
