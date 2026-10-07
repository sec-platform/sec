import path from 'node:path';

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

const nativeProfile = z.object({
  schema: z.literal('sec-linux-verification-native-profile-v1'),
  profileId: z.literal('sec-linux-native-verification-unit-v1'),
  platform: z.literal('linux/amd64'),
  providerRequirement: z.literal('linux-systemd-cgroup2-native-unit-v1'),
  resources: z.object({ cpus: z.literal(2), memoryGiB: z.literal(4), pids: z.literal(256) }).strict(),
  acceptedContent: z.discriminatedUnion('status', [
    z.object({ status: z.literal('unresolved'), reason: boundedText }).strict(),
    z.object({ status: z.literal('accepted'), manifestDigest: digest }).strict()
  ])
}).strict();

const runtimePath = z.string().min(1).max(4096)
  .refine((value) => !value.startsWith('/') && !/[\\\u0000-\u0020\u007f]/u.test(value)
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'));
const runtimeMode = z.number().int().min(0).max(0o777)
  .refine((value) => (value & 0o022) === 0);
const nativeManifestSchema = z.object({
  schema: z.literal('sec-linux-verification-native-runtime-manifest-v1'),
  platform: z.literal('linux/amd64'),
  sources: z.array(z.object({
    id: shellToken,
    kind: z.enum(['archive', 'deb']),
    url: httpsUrl,
    digest,
    version: boundedText
  }).strict()).min(1).max(4096),
  files: z.array(z.discriminatedUnion('type', [
    z.object({ path: runtimePath, type: z.literal('directory'), mode: runtimeMode }).strict(),
    z.object({
      path: runtimePath, type: z.literal('file'), mode: runtimeMode,
      size: z.number().int().min(0).max(4 * 1024 * 1024 * 1024), digest, sourceId: shellToken
    }).strict(),
    z.object({
      path: runtimePath, type: z.literal('symlink'), mode: z.literal(0o777),
      target: z.string().min(1).max(4096), sourceId: shellToken
    }).strict()
  ])).min(1).max(100_000)
}).strict();

export type SecLinuxVerificationNativeRuntimeManifest = z.infer<typeof nativeManifestSchema>;

const authoritySchema = z.object({
  schema: z.literal('sec-linux-verification-environment-authority-v1'),
  environmentId: boundedText,
  platform: z.literal('linux/amd64'),
  nativeRuntime: nativeProfile,
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

export type SecLinuxVerificationEnvironmentAuthority = z.infer<typeof authoritySchema>;

export function computeSecLinuxVerificationRunnerInputDigest(
  value: SecLinuxVerificationEnvironmentAuthority
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

export function parseSecLinuxVerificationEnvironmentAuthority(
  input: unknown
): SecLinuxVerificationEnvironmentAuthority {
  const parsed = authoritySchema.safeParse(input);
  if (!parsed.success) fail(z.prettifyError(parsed.error));
  const value = parsed.data;
  if (value.nativeRuntime.acceptedContent.status === 'accepted'
      && [value.image.runtimeContentDigest, value.image.dockerProjectionDigest,
        value.trustedRuntime.imageDigest].includes(value.nativeRuntime.acceptedContent.manifestDigest)) {
    fail('native runtime manifest cannot relabel a historical image identity');
  }
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

export const SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY =
  parseSecLinuxVerificationEnvironmentAuthority(source);
export const SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH =
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunExecutablePath;
export const SEC_LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST =
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunExecutableDigest;
export const SEC_LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH =
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.dockerfilePath;
export const SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST =
  computeSecLinuxVerificationRunnerInputDigest(
    SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY
  );

export const SEC_LINUX_VERIFICATION_NATIVE_PROFILE =
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.nativeRuntime;
export const SEC_LINUX_VERIFICATION_NATIVE_PROFILE_DIGEST =
  sha256(SEC_LINUX_VERIFICATION_NATIVE_PROFILE) as `sha256:${string}`;

/** Parsing establishes a content description, never a live runtime capability. */
export function parseSecLinuxVerificationNativeRuntimeManifest(
  input: unknown
): SecLinuxVerificationNativeRuntimeManifest {
  const parsed = nativeManifestSchema.safeParse(input);
  if (!parsed.success) fail(z.prettifyError(parsed.error));
  const manifest = parsed.data;
  const authority = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
  const sources = new Map(manifest.sources.map((entry) => [entry.id, entry]));
  const files = new Map(manifest.files.map((entry) => [entry.path, entry]));
  if (sources.size !== manifest.sources.length || files.size !== manifest.files.length) {
    fail('native runtime sources and paths must be unique');
  }
  for (const entries of [manifest.sources.map(({ id }) => id), manifest.files.map(({ path }) => path)]) {
    if (entries.some((entry, index) => index > 0 && entries[index - 1]! >= entry)) {
      fail('native runtime sources and paths must be in code-unit order');
    }
  }
  const archives = [
    ...Object.values(authority.archives),
    { url: authority.trustedRuntime.bunArchiveUrl, digest: authority.trustedRuntime.bunArchiveDigest,
      version: authority.trustedRuntime.bunVersion }
  ];
  for (const source of manifest.sources) {
    if (source.kind === 'archive') {
      if (!archives.some((entry) => entry.url === source.url && entry.digest === source.digest
          && entry.version === source.version)) fail('native archive must bind an original accepted source');
    } else {
      const url = new URL(source.url);
      if (url.origin !== 'https://snapshot.ubuntu.com'
          || !url.pathname.startsWith(`/ubuntu/${authority.ubuntu.snapshot}/pool/`)
          || !url.pathname.endsWith('.deb') || url.username || url.password || url.search || url.hash
          || /%/u.test(url.pathname)) fail('native package must bind the original Ubuntu snapshot');
    }
  }
  // Resolve symlinks in the manifest's root, never through the host filesystem.
  const resolveEntry = (requested: string): typeof manifest.files[number] => {
    let pending = requested.split('/');
    const resolved: string[] = [];
    let links = 0;
    while (pending.length > 0) {
      const part = pending.shift()!;
      const entryPath = [...resolved, part].join('/');
      const entry = files.get(entryPath);
      if (entry === undefined) fail(`native runtime target is missing: ${entryPath}`);
      if (entry.type === 'symlink') {
        if (++links > 64) fail('native runtime symlink cycle or depth exceeded');
        const target = path.posix.normalize(path.posix.join(...resolved, entry.target));
        if (target === '..' || target.startsWith('../') || target.startsWith('/')) {
          fail('native runtime symlink escapes its root');
        }
        pending = [...target.split('/'), ...pending];
        resolved.length = 0;
      } else {
        if (pending.length > 0 && entry.type !== 'directory') fail('native runtime parent is not a directory');
        resolved.push(part);
      }
    }
    return files.get(resolved.join('/'))!;
  };
  let totalBytes = 0;
  for (const entry of manifest.files) {
    const parent = path.posix.dirname(entry.path);
    if (parent !== '.' && files.get(parent)?.type !== 'directory') {
      fail('native runtime entries require declared non-symlink parents');
    }
    if (entry.type !== 'directory' && !sources.has(entry.sourceId)) fail('native runtime source is missing');
    if (entry.type === 'symlink') {
      if (entry.target.startsWith('/') || /[\\\u0000-\u0020\u007f]/u.test(entry.target)
          || path.posix.normalize(entry.target) !== entry.target) fail('native runtime symlink target is not canonical');
      resolveEntry(entry.path);
    }
    if (entry.type === 'file') totalBytes += entry.size;
  }
  if (totalBytes > 16 * 1024 * 1024 * 1024) fail('native runtime exceeds the content byte bound');
  const bun = resolveEntry(authority.trustedRuntime.bunExecutablePath.slice(1));
  if (bun.type !== 'file' || bun.digest !== authority.trustedRuntime.bunExecutableDigest
      || (bun.mode & 0o111) === 0
      || sources.get(bun.sourceId)?.digest !== authority.trustedRuntime.bunArchiveDigest) {
    fail('native runtime must contain the original accepted Bun executable');
  }
  for (const executable of ['usr/bin/python3', 'usr/bin/git', 'usr/bin/env', 'bin/sh']) {
    const entry = resolveEntry(executable);
    if (entry.type !== 'file' || (entry.mode & 0o111) === 0) {
      fail(`native runtime executable is missing: ${executable}`);
    }
  }
  return deepFreeze(manifest);
}
