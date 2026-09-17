import { z } from 'zod';

import { deepFreeze, sha256 } from '../../../contracts/canonical.ts';
import source from './anonymous-registry-profile.json' with { type: 'json' };

export const packageRegistryPackageNameSchema = z.string()
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u);

export const exactPackageReleaseSchema = z.string().regex(
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
);

const registryProfileSchema = z.object({
  maximumConcurrentRequests: z.number().int().min(1).max(16),
  maximumPackageCount: z.number().int().min(1).max(256),
  maximumResponseBytes: z.number().int().min(256).max(1024 * 1024),
  origin: z.literal('https://registry.npmjs.org'),
  providerId: z.literal('npm-public-registry-dist-tags'),
  resourcePrefix: z.literal('/-/package/'),
  resourceSuffix: z.literal('/dist-tags'),
  schema: z.literal('sec-anonymous-package-registry-profile-v1'),
  timeoutMs: z.number().int().min(100).max(30_000)
}).strict();

export type AnonymousPackageRegistryProfile = z.infer<typeof registryProfileSchema>;

export type PackageRegistryObservation = Readonly<
  | {
    readonly latestVersion: string;
    readonly packageName: string;
    readonly provider: string;
    readonly status: 'resolved';
  }
  | {
    readonly packageName: string;
    readonly provider: string;
    readonly reason:
      | 'deadline-exhausted'
      | 'network-unavailable'
      | 'package-not-found'
      | 'provider-failure'
      | 'response-invalid'
      | 'response-too-large';
    readonly status: 'unavailable';
  }
>;

export function parseAnonymousPackageRegistryProfile(
  value: unknown
): AnonymousPackageRegistryProfile {
  return deepFreeze(registryProfileSchema.parse(value));
}

export const ANONYMOUS_PACKAGE_REGISTRY_PROFILE =
  parseAnonymousPackageRegistryProfile(source);

export const ANONYMOUS_PACKAGE_REGISTRY_PROFILE_DIGEST = sha256({
  domain: 'sec.external-capability.package-registry.anonymous-profile',
  profile: ANONYMOUS_PACKAGE_REGISTRY_PROFILE
});
