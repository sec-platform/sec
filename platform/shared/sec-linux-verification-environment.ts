import { z } from 'zod';

import source from './environment-specs/sec-linux-verification-v1.json' with { type: 'json' };

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
    bunArchiveBytes: positiveInteger
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

export type SecLinuxVerificationEnvironmentAuthorityV1 = z.infer<typeof authoritySchema>;

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

export function parseSecLinuxVerificationEnvironmentAuthorityV1(
  input: unknown
): SecLinuxVerificationEnvironmentAuthorityV1 {
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
  if (!value.ubuntu.baseReference.endsWith(`@${value.ubuntu.baseDigest}`)) {
    fail('Ubuntu base reference must bind its declared digest');
  }
  if (!value.provider.dockerfileFrontend.reference.endsWith(
    `@${value.provider.dockerfileFrontend.digest}`
  )) fail('Dockerfile frontend reference must bind its declared digest');
  if (!value.trustedRuntime.bunArchiveUrl.includes(`bun-v${value.trustedRuntime.bunVersion}/`)) {
    fail('trusted runtime Bun archive URL must bind its declared version');
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

export const SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1 =
  parseSecLinuxVerificationEnvironmentAuthorityV1(source);
