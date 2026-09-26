import { z } from 'zod';

import { sha256 } from '../../../contracts/canonical.ts';
import source from './environment-spec.json' with { type: 'json' };

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u)
  .transform((value) => value as `sha256:${string}`);
const boundedText = z.string().trim().min(1).max(512).refine((value) => !/[\u0000-\u001f]/u.test(value));
const httpsUrl = z.string().url().startsWith('https://');
const positiveInteger = z.number().int().positive();
const shellToken = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9+._-]*$/u);
const archive = z.object({
  version: boundedText,
  url: httpsUrl,
  digest
}).strict();
const resources = z.object({
  cpus: positiveInteger,
  memoryGiB: positiveInteger,
  pids: positiveInteger
}).strict();
const imageRetirement = z.object({
  imageId: digest,
  imageTag: boundedText,
  replacementImageId: digest,
  decision: boundedText
}).strict();

const authoritySchema = z.object({
  schema: z.literal('sec-linux-verification-environment-authority-v1'),
  environmentId: boundedText,
  platform: z.literal('linux/amd64'),
  image: z.object({
    name: boundedText.regex(/^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/u),
    buildRevision: boundedText,
    lineageSchema: boundedText,
    runtimeContentDigest: digest,
    dockerProjectionDigest: digest,
    retirements: z.array(imageRetirement).min(1)
  }).strict(),
  provider: z.object({
    requirement: boundedText,
    sourcePolicyRevision: boundedText,
    githubHost: z.string().regex(/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))+$/u),
    sourceDateEpoch: positiveInteger,
    dockerfileFrontend: z.object({
      version: boundedText,
      reference: boundedText,
      digest
    }).strict(),
    progressMode: z.literal('rawjson'),
    progressAdmission: z.literal('buildkit-monotonic-v1'),
    timeoutsMs: z.object({
      commandDefault: positiveInteger,
      commandMaximum: positiveInteger,
      materializeAbsolute: positiveInteger,
      materializeStall: positiveInteger,
      projectionAbsolute: positiveInteger,
      projectionStall: positiveInteger
    }).strict()
  }).strict(),
  provenance: z.object({
    materializationMode: z.literal('max'),
    dockerProjectionMode: z.literal('disabled'),
    receiptSchema: boundedText
  }).strict(),
  ubuntu: z.object({
    version: boundedText,
    baseReference: boundedText,
    baseDigest: digest,
    snapshot: z.string().regex(/^\d{8}T\d{6}Z$/u),
    snapshotUrl: httpsUrl,
    suites: z.array(shellToken).min(1),
    components: z.array(shellToken).min(1),
    aptCacheId: shellToken,
    aptRetries: positiveInteger,
    packages: z.array(shellToken).min(1)
  }).strict(),
  archives: z.object({
    bootstrapCa: archive.extend({ mountMode: z.literal('0444') }).strict(),
    node: archive,
    runner: archive,
    githubCli: archive
  }).strict(),
  trustedRuntime: z.object({
    imageName: boundedText,
    imageDigest: digest,
    imageSchema: boundedText,
    bunVersion: boundedText,
    bunArchiveUrl: httpsUrl,
    bunArchiveDigest: digest,
    bunExecutablePath: z.string().regex(/^\/(?:[A-Za-z0-9._+-]+\/)*[A-Za-z0-9._+-]+$/u),
    bunExecutableDigest: digest,
    dockerfilePath: z.string().regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u)
      .refine((value) => value.split('/').every((segment) => segment !== '.' && segment !== '..')),
    retirements: z.array(imageRetirement).min(1)
  }).strict(),
  runtime: z.object({
    pythonVersion: boundedText,
    containerInitCapability: boundedText,
    labels: z.tuple([z.literal('self-hosted'), z.literal('Linux'), z.literal('X64'), boundedText]),
    roleLabels: z.object({
      control: boundedText,
      trusted: boundedText,
      sut: boundedText
    }).strict(),
    resources: z.object({
      control: resources,
      trusted: resources,
      sut: resources
    }).strict()
  }).strict()
}).strict();

export type LinuxVerificationEnvironmentAuthority = z.infer<typeof authoritySchema>;

export function computeLinuxVerificationRunnerInputDigest(
  value: LinuxVerificationEnvironmentAuthority
): `sha256:${string}` {
  return sha256(Object.freeze({
    schema: 'sec-linux-verification-runner-input-v1',
    environmentId: value.environmentId,
    platform: value.platform,
    image: Object.freeze({
      name: value.image.name,
      buildRevision: value.image.buildRevision,
      lineageSchema: value.image.lineageSchema
    }),
    provider: Object.freeze({
      sourcePolicyRevision: value.provider.sourcePolicyRevision,
      sourceDateEpoch: value.provider.sourceDateEpoch,
      dockerfileFrontend: value.provider.dockerfileFrontend
    }),
    provenance: value.provenance,
    ubuntu: value.ubuntu,
    archives: value.archives,
    runtime: Object.freeze({ pythonVersion: value.runtime.pythonVersion })
  })) as `sha256:${string}`;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function fail(message: string): never {
  throw new Error(`SEC Linux verification environment authority: ${message}`);
}

export function parseLinuxVerificationEnvironmentAuthority(
  input: unknown
): LinuxVerificationEnvironmentAuthority {
  const parsed = authoritySchema.safeParse(input);
  if (!parsed.success) fail(z.prettifyError(parsed.error));
  const value = parsed.data;
  if (value.image.runtimeContentDigest === value.image.dockerProjectionDigest) {
    fail('runtime content and Docker projection identities must remain distinct');
  }
  const retiredImageIds = new Set<string>();
  const retiredImageTags = new Set<string>();
  for (const retirement of value.image.retirements) {
    if (retirement.imageId === value.image.dockerProjectionDigest) {
      fail('current Docker projection cannot be retired');
    }
    if (retirement.imageId === retirement.replacementImageId) {
      fail('image retirement must change immutable identity');
    }
    if (retiredImageIds.has(retirement.imageId) || retiredImageTags.has(retirement.imageTag)) {
      fail('image retirements must have unique immutable identities and tags');
    }
    retiredImageIds.add(retirement.imageId);
    retiredImageTags.add(retirement.imageTag);
  }
  const retiredTrustedRuntimeImageIds = new Set<string>();
  const retiredTrustedRuntimeImageTags = new Set<string>();
  for (const retirement of value.trustedRuntime.retirements) {
    if (retirement.imageId === value.trustedRuntime.imageDigest) {
      fail('current trusted runtime image cannot be retired');
    }
    if (retirement.imageId === retirement.replacementImageId) {
      fail('trusted runtime retirement must change immutable identity');
    }
    if (retiredTrustedRuntimeImageIds.has(retirement.imageId)
        || retiredTrustedRuntimeImageTags.has(retirement.imageTag)) {
      fail('trusted runtime retirements must have unique immutable identities and tags');
    }
    retiredTrustedRuntimeImageIds.add(retirement.imageId);
    retiredTrustedRuntimeImageTags.add(retirement.imageTag);
  }
  const trustedRuntimeRetirementByImageId = new Map(
    value.trustedRuntime.retirements.map((retirement) => [retirement.imageId, retirement])
  );
  for (const retirement of value.trustedRuntime.retirements) {
    const observed = new Set<string>([retirement.imageId]);
    let replacementImageId = retirement.replacementImageId;
    while (replacementImageId !== value.trustedRuntime.imageDigest) {
      if (observed.has(replacementImageId)) {
        fail('trusted runtime retirement chain cannot contain a cycle');
      }
      observed.add(replacementImageId);
      const successor = trustedRuntimeRetirementByImageId.get(replacementImageId);
      if (successor === undefined) {
        fail('trusted runtime retirement chain must terminate at the current immutable image');
      }
      replacementImageId = successor.replacementImageId;
    }
  }
  if (!value.ubuntu.baseReference.endsWith(`@${value.ubuntu.baseDigest}`)) {
    fail('Ubuntu base reference must bind its declared digest');
  }
  if (!value.provider.dockerfileFrontend.reference.endsWith(
    `@${value.provider.dockerfileFrontend.digest}`
  )) fail('Dockerfile frontend reference must bind its declared digest');
  if (!value.trustedRuntime.bunArchiveUrl.includes(`bun-v${value.trustedRuntime.bunVersion}/`)) {
    fail('trusted runtime Bun archive URL must bind its declared version');
  }
  if (!value.trustedRuntime.dockerfilePath.endsWith('/trusted-runtime.Dockerfile')) {
    fail('trusted runtime Dockerfile path must bind the trusted runtime image definition');
  }
  if (value.provider.githubHost !== 'github.com') {
    fail('GitHub provider host must remain github.com');
  }
  const exactSources = [
    [value.ubuntu.snapshotUrl, 'snapshot.ubuntu.com', '/ubuntu/'],
    [value.archives.bootstrapCa.url, 'curl.se', '/ca/'],
    [value.archives.node.url, 'nodejs.org', `/dist/v${value.archives.node.version}/`],
    [value.archives.runner.url, 'github.com', `/actions/runner/releases/download/v${value.archives.runner.version}/`],
    [value.archives.githubCli.url, 'github.com', `/cli/cli/releases/download/v${value.archives.githubCli.version}/`],
    [value.trustedRuntime.bunArchiveUrl, 'github.com', `/oven-sh/bun/releases/download/bun-v${value.trustedRuntime.bunVersion}/`]
  ] as const;
  for (const [sourceUrl, expectedHost, expectedPathPrefix] of exactSources) {
    const parsed = new URL(sourceUrl);
    if (parsed.hostname !== expectedHost || !parsed.pathname.startsWith(expectedPathPrefix)
        || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
      fail(`source URL is outside the governed trust domain: ${sourceUrl}`);
    }
  }
  if (value.provider.timeoutsMs.commandDefault > value.provider.timeoutsMs.commandMaximum
      || value.provider.timeoutsMs.materializeAbsolute > value.provider.timeoutsMs.commandMaximum
      || value.provider.timeoutsMs.projectionAbsolute > value.provider.timeoutsMs.commandMaximum
      || value.provider.timeoutsMs.materializeStall >= value.provider.timeoutsMs.materializeAbsolute
      || value.provider.timeoutsMs.projectionStall >= value.provider.timeoutsMs.projectionAbsolute) {
    fail('provider timeout ordering is invalid');
  }
  for (const [label, entries] of [
    ['Ubuntu suites', value.ubuntu.suites],
    ['Ubuntu components', value.ubuntu.components],
    ['Ubuntu packages', value.ubuntu.packages],
    ['runtime labels', value.runtime.labels]
  ] as const) {
    if (new Set(entries).size !== entries.length) fail(`${label} must be unique`);
  }
  for (const [name, entry] of Object.entries(value.archives)) {
    if (name === 'bootstrapCa') continue;
    if (!entry.url.includes(entry.version)) fail(`${name} URL must bind its declared version`);
  }
  if (!value.archives.bootstrapCa.url.includes(value.archives.bootstrapCa.version)) {
    fail('bootstrap CA URL must bind its declared version');
  }
  return deepFreeze(value);
}

export const LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY =
  parseLinuxVerificationEnvironmentAuthority(source);
export const LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH =
  LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunExecutablePath;
export const LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST =
  LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunExecutableDigest;
export const LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH =
  LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.dockerfilePath;
export const LINUX_VERIFICATION_RUNNER_INPUT_DIGEST =
  computeLinuxVerificationRunnerInputDigest(
    LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY
  );
