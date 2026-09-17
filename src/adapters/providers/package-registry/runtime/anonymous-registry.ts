import { z } from 'zod';

import { parseExactJsonBytes } from '../../../../contracts/exact-json.ts';
import {
  ANONYMOUS_PACKAGE_REGISTRY_PROFILE,
  exactPackageReleaseSchema,
  packageRegistryPackageNameSchema,
  parseAnonymousPackageRegistryProfile,
  type AnonymousPackageRegistryProfile,
  type PackageRegistryObservation
} from '../contract/anonymous-registry.ts';

const tagNameSchema = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u);
const distTagsSchema = z.record(tagNameSchema, exactPackageReleaseSchema)
  .refine((value) => Object.hasOwn(value, 'latest'), 'Registry dist-tags must contain latest');
const issuedTestProfiles = new WeakSet<object>();

type RegistryQueryProfile = Omit<AnonymousPackageRegistryProfile, 'origin'> & Readonly<{
  readonly origin: string;
}>;

export interface PackageRegistryQueryOptions {
  readonly deadlineAtUnixMs: number;
  readonly signal?: AbortSignal;
}

function unavailable(
  packageName: string,
  profile: RegistryQueryProfile,
  reason: Extract<PackageRegistryObservation, { status: 'unavailable' }>['reason']
): PackageRegistryObservation {
  return Object.freeze({
    packageName,
    provider: profile.providerId,
    reason,
    status: 'unavailable'
  });
}

function requestUrl(profile: RegistryQueryProfile, packageName: string): URL {
  packageRegistryPackageNameSchema.parse(packageName);
  const target = new URL(
    `${profile.resourcePrefix}${encodeURIComponent(packageName)}${profile.resourceSuffix}`,
    profile.origin
  );
  if (target.origin !== profile.origin
      || target.pathname !== `${profile.resourcePrefix}${encodeURIComponent(packageName)}${profile.resourceSuffix}`
      || target.search !== '' || target.hash !== '') {
    throw new Error('Package registry resource escaped the authenticated provider origin');
  }
  return target;
}

async function boundedResponseBytes(
  response: Response,
  maximumBytes: number
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumBytes) {
      throw new RangeError('package-registry-response-too-large');
    }
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let observed = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    observed += next.value.byteLength;
    if (observed > maximumBytes) {
      await reader.cancel('package-registry-response-too-large');
      throw new RangeError('package-registry-response-too-large');
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(observed);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function queryOne(
  profile: RegistryQueryProfile,
  packageName: string,
  options: PackageRegistryQueryOptions
): Promise<PackageRegistryObservation> {
  const remainingMs = Math.min(profile.timeoutMs, options.deadlineAtUnixMs - Date.now());
  if (!Number.isSafeInteger(options.deadlineAtUnixMs) || remainingMs <= 0 || options.signal?.aborted) {
    return unavailable(packageName, profile, 'deadline-exhausted');
  }
  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort('deadline-exhausted'), remainingMs);
  try {
    const response = await fetch(requestUrl(profile, packageName), {
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
    if (response.status === 404) return unavailable(packageName, profile, 'package-not-found');
    if (!response.ok) return unavailable(packageName, profile, 'provider-failure');
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') return unavailable(packageName, profile, 'response-invalid');
    let bytes: Uint8Array;
    try {
      bytes = await boundedResponseBytes(response, profile.maximumResponseBytes);
    } catch (error) {
      if (error instanceof RangeError && error.message === 'package-registry-response-too-large') {
        return unavailable(packageName, profile, 'response-too-large');
      }
      throw error;
    }
    try {
      const tags = distTagsSchema.parse(parseExactJsonBytes(
        bytes,
        'Package registry dist-tags',
        { maximumInputBytes: profile.maximumResponseBytes, maximumDepth: 4 }
      ));
      return Object.freeze({
        latestVersion: tags.latest!,
        packageName,
        provider: profile.providerId,
        status: 'resolved'
      });
    } catch {
      return unavailable(packageName, profile, 'response-invalid');
    }
  } catch (error) {
    if (controller.signal.aborted || Date.now() >= options.deadlineAtUnixMs) {
      return unavailable(packageName, profile, 'deadline-exhausted');
    }
    return unavailable(packageName, profile, 'network-unavailable');
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}

async function queryWithProfile(
  profile: RegistryQueryProfile,
  packageNames: readonly string[],
  options: PackageRegistryQueryOptions
): Promise<readonly PackageRegistryObservation[]> {
  const names = [...new Set(packageNames)].sort();
  if (names.length > profile.maximumPackageCount) {
    throw new Error('Package registry query exceeds the provider package budget');
  }
  names.forEach((name) => packageRegistryPackageNameSchema.parse(name));
  const results = new Array<PackageRegistryObservation>(names.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(names.length, profile.maximumConcurrentRequests) },
    async () => {
      while (nextIndex < names.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await queryOne(profile, names[index]!, options);
      }
    }
  );
  await Promise.all(workers);
  return Object.freeze(results);
}

export function queryAnonymousPackageRegistryLatestVersions(
  packageNames: readonly string[],
  options: PackageRegistryQueryOptions
): Promise<readonly PackageRegistryObservation[]> {
  return queryWithProfile(ANONYMOUS_PACKAGE_REGISTRY_PROFILE, packageNames, options);
}

export type AnonymousPackageRegistryTestCapability = Readonly<{
  readonly profile: RegistryQueryProfile;
}>;

export function issueAnonymousPackageRegistryTestCapability(
  profile: unknown
): AnonymousPackageRegistryTestCapability {
  const candidate = parseAnonymousPackageRegistryProfile({
    ...profile as object,
    origin: ANONYMOUS_PACKAGE_REGISTRY_PROFILE.origin
  });
  const origin = z.string().url().parse((profile as { origin?: unknown }).origin);
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Package registry test capability requires one loopback HTTP origin');
  }
  const capability = Object.freeze({ profile: Object.freeze({ ...candidate, origin }) });
  issuedTestProfiles.add(capability);
  return capability;
}

export function queryAnonymousPackageRegistryLatestVersionsForTests(
  capability: AnonymousPackageRegistryTestCapability,
  packageNames: readonly string[],
  options: PackageRegistryQueryOptions
): Promise<readonly PackageRegistryObservation[]> {
  if (!issuedTestProfiles.has(capability)) {
    throw new Error('Package registry test capability was not issued by the provider owner');
  }
  return queryWithProfile(capability.profile, packageNames, options);
}
