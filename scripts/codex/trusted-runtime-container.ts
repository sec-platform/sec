import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import type {
  CodexDevelopmentVerificationEvidenceV4
} from '../../platform/shared/ci-evidence-contract.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1 } from '../../platform/shared/ci-verification-revision.ts';
import { isolatedGitChildEnvironment } from '../../platform/shared/git-read-environment.ts';
import { acquirePhysicalMutationLeaseV1 } from '../../platform/shared/physical-mutation-lease.ts';
import { runCommand } from '../../platform/shared/process.ts';
import {
  createCiVerificationLocalExecutionEnvironmentV2,
  type CiVerificationExecutionEnvironmentV2
} from '../../platform/shared/verification-action-ci-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import { acquireSecRuntimeStatePhysicalAuthorityV1 } from '../../tooling/sec-dev/runtime-state-authority.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';
import {
  assertDockerEndpointIdentityV3,
  dockerEndpointCommandArgsV3,
  ensureLocalGitHubActionsRunnerToolchainImageV1,
  observeDockerEndpointIdentityV3,
  parseDockerEndpointIdentityV3,
  type DockerEndpointIdentityV3
} from './local-github-actions-runner.ts';
import type { VerificationSessionHostedEnvelopeV1 } from './verification-session-runtime.ts';

export const TRUSTED_RUNTIME_CONTAINER_SCHEMA_V1 =
  'sec-trusted-runtime-container-v1' as const;
export const TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA_V1 =
  'sec-trusted-runtime-main-health-receipt-v1' as const;
export const TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_RECEIPT_SCHEMA_V1 =
  'sec-trusted-runtime-bootstrap-repair-receipt-v1' as const;
export const TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA_V1 =
  'sec-trusted-runtime-dependency-cache-v1' as const;
export const TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE_V1 =
  '.sec-derived-cache.json' as const;
export const TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1 =
  '/tmp/sec-hosted-dependency-home/.bun/install/cache' as const;
export const TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA_V1 =
  'sec-trusted-runtime-dependency-cache-volume-v1' as const;
export const TRUSTED_RUNTIME_CONTAINER_IMAGE_V1 =
  'sec-trusted-runtime:bun-1.3.14-v1' as const;
export const TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1 =
  'sha256:51832545a9d77fe47630f4aeaa185274b5db24a1d1425e50a8898b5ecb675ed2' as const;
export const TRUSTED_RUNTIME_CONTAINER_BUN_IMAGE_MANIFEST_V1 =
  'sha256:50317d83cd5a5ae1d8b35b3379c69f57ce1a0dbf4def91f0965653d767851834' as const;
export const TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID_V1 =
  'sha256:418e9f00110157ff610061685f9175a1af6966baa77e6d153eb43bd49893f63f' as const;
export const TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1:
CiVerificationExecutionEnvironmentV2 = createCiVerificationLocalExecutionEnvironmentV2({
  os: 'linux',
  arch: 'x64',
  bunVersion: '1.3.14'
});

type Digest = `sha256:${string}`;

export const TRUSTED_RUNTIME_CONTAINER_PROFILES_V1 = Object.freeze({
  ordinary: Object.freeze({
    id: 'ordinary-v1',
    capAdd: Object.freeze([] as string[]),
    capDrop: Object.freeze(['ALL']),
    securityOpt: Object.freeze(['no-new-privileges']),
    pidsLimit: 256,
    nanoCpus: 2_000_000_000,
    memoryBytes: 4 * 1024 * 1024 * 1024,
    dependencyMode: 'shared-base-link' as const,
    workspaceOwnerMode: 'delegated-user-1000' as const,
    trustedBaseMode: 'read-only-after-setup' as const,
    networkIsolationBoundary: 'outer-container-before-execution' as const
  }),
  bootstrapRepair: Object.freeze({
    id: 'bootstrap-repair-v1',
    capAdd: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outerSutContainerCapabilities,
    capDrop: Object.freeze(['ALL']),
    securityOpt: Object.freeze(['no-new-privileges']),
    pidsLimit: 1024,
    nanoCpus: 8_000_000_000,
    memoryBytes: 12 * 1024 * 1024 * 1024,
    dependencyMode: 'bootstrap-base-materialized' as const,
    workspaceOwnerMode: 'container-root' as const,
    trustedBaseMode: 'materializer-owned' as const,
    networkIsolationBoundary: 'base-owned-sut-sandbox' as const
  })
} as const);

type TrustedRuntimeContainerProfileV1 =
  typeof TRUSTED_RUNTIME_CONTAINER_PROFILES_V1[keyof typeof TRUSTED_RUNTIME_CONTAINER_PROFILES_V1];

export const TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_PROFILE_DIGEST_V1 = digestValue(
  TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair
);

const TRUSTED_RUNTIME_MAIN_HEALTH_COMMANDS_V1 = Object.freeze([
  Object.freeze(['bun', 'run', 'imports:check']),
  Object.freeze(['bun', 'run', 'typecheck']),
  Object.freeze(['bun', 'run', 'docs:doctor']),
  Object.freeze(['bun', 'run', 'test:fast'])
] as const);

export const TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1 = digestValue(Object.freeze({
  schema: 'sec-trusted-runtime-main-health-plan-v1',
  commands: TRUSTED_RUNTIME_MAIN_HEALTH_COMMANDS_V1
}));

export interface TrustedRuntimeContainerImageObservationV1 {
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1;
  readonly labels: Readonly<Record<string, string>>;
}

export interface TrustedRuntimeContainerReceiptV1 {
  readonly schema: typeof TRUSTED_RUNTIME_CONTAINER_SCHEMA_V1;
  readonly executionId: string;
  readonly sessionRevision: Digest;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly networkIsolatedBeforeSut: true;
  readonly evidenceByteDigest: Digest;
  readonly evidenceByteLength: number;
  readonly evidenceDigest: Digest;
  readonly producerSourceDigest: Digest;
  readonly receiptDigest: Digest;
}

export interface TrustedRuntimeMainHealthReceiptV1 {
  readonly schema: typeof TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA_V1;
  readonly origin: 'physical-main' | 'verified-candidate-transition';
  readonly repository: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly executionId: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly networkIsolatedBeforeExecution: true;
  readonly planDigest: typeof TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1;
  readonly commandResultDigests: readonly Digest[];
  readonly transition: Readonly<{
    readonly candidateHeadSha: string;
    readonly candidateHeadTreeSha: string;
    readonly sessionRevision: Digest;
    readonly verificationEvidenceDigest: Digest;
    readonly containerReceiptDigest: Digest;
    readonly mergeGateResultDigest: Digest;
    readonly statusPublicationDigest: Digest;
  }> | null;
  readonly observedAt: string;
  readonly receiptDigest: Digest;
}

export interface TrustedRuntimeBootstrapRepairReceiptV1 {
  readonly schema: typeof TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_RECEIPT_SCHEMA_V1;
  readonly repository: string;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly executionId: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly candidateNetworkIsolatedDuringExecution: true;
  readonly containerProfileDigest: typeof TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_PROFILE_DIGEST_V1;
  readonly dependencyCacheKey: Digest;
  readonly dependencyCacheMarkerFileDigest: Digest;
  readonly dependencyCacheVolumeObservationDigest: Digest;
  readonly trustedProgramBlobSha: string;
  readonly bootstrapDigest: Digest;
  readonly sandboxPolicyDigest: Digest;
  readonly commandPlanDigest: Digest;
  readonly evidenceSetDigest: Digest;
  readonly sutReceiptDigest: Digest;
  readonly receiptDigest: Digest;
}

export interface TrustedRuntimeDependencyCacheMarkerV1 {
  readonly schema: typeof TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA_V1;
  readonly classification: 'rebuildable-derived-cache';
  readonly authority: 'none';
  readonly repository: string;
  readonly bunLockBlobSha: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1;
  readonly bunVersion: '1.3.14';
  readonly deletionEffect: 'performance-loss-only';
  readonly activeUseFence: 'docker-mounted-volume-plus-operation-lease-v1';
  readonly cacheKey: Digest;
}

export interface TrustedRuntimeDependencyCacheVolumeSpecV1 {
  readonly schema: typeof TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA_V1;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

function fail(message: string): never {
  throw new Error(`Trusted runtime container: ${message}`);
}

function digestBytes(value: string | Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function digestValue(value: unknown): Digest {
  return digestBytes(encodeVerificationActionDataV2(value));
}

function bounded(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be bounded canonical text`);
  }
  return value;
}

function sha(value: unknown, label: string): string {
  const result = bounded(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a lowercase Git SHA`);
  return result;
}

function digest(value: unknown, label: string): Digest {
  const result = bounded(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be a SHA-256 digest`);
  return result as Digest;
}

function repository(value: unknown): string {
  const result = bounded(value, 'repository');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(result)) {
    fail('repository must be owner/name');
  }
  return result;
}

export function createTrustedRuntimeDependencyCacheMarkerV1(input: Readonly<{
  repository: string;
  bunLockBlobSha: string;
  imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1;
}>): TrustedRuntimeDependencyCacheMarkerV1 {
  if (input.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1) {
    fail('dependency cache image identity drifted');
  }
  const withoutKey = Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA_V1,
    classification: 'rebuildable-derived-cache' as const,
    authority: 'none' as const,
    repository: repository(input.repository),
    bunLockBlobSha: sha(input.bunLockBlobSha, 'dependency cache bunLockBlobSha'),
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    bunVersion: '1.3.14' as const,
    deletionEffect: 'performance-loss-only' as const,
    activeUseFence: 'docker-mounted-volume-plus-operation-lease-v1' as const
  });
  return Object.freeze({ ...withoutKey, cacheKey: digestValue(withoutKey) });
}

export function parseTrustedRuntimeDependencyCacheMarkerV1(
  value: unknown
): TrustedRuntimeDependencyCacheMarkerV1 {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      fail('dependency cache marker is not JSON');
    }
  }
  const record = exactRecord(value, [
    'schema', 'classification', 'authority', 'repository', 'bunLockBlobSha',
    'imageId', 'bunVersion', 'deletionEffect', 'activeUseFence', 'cacheKey'
  ], 'dependency cache marker');
  if (record.schema !== TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA_V1
      || record.classification !== 'rebuildable-derived-cache'
      || record.authority !== 'none'
      || record.bunVersion !== '1.3.14'
      || record.deletionEffect !== 'performance-loss-only'
      || record.activeUseFence !== 'docker-mounted-volume-plus-operation-lease-v1') {
    fail('dependency cache marker lifecycle contract is invalid');
  }
  const rebuilt = createTrustedRuntimeDependencyCacheMarkerV1({
    repository: record.repository as string,
    bunLockBlobSha: record.bunLockBlobSha as string,
    imageId: record.imageId as typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
  });
  if (rebuilt.cacheKey !== digest(record.cacheKey, 'dependency cache cacheKey')) {
    fail('dependency cache marker digest mismatch');
  }
  return rebuilt;
}

function canonicalDependencyCacheMarkerBytes(
  marker: TrustedRuntimeDependencyCacheMarkerV1
): Uint8Array {
  return Buffer.from(`${encodeVerificationActionDataV2(marker)}\n`, 'utf8');
}

export function createTrustedRuntimeDependencyCacheVolumeSpecV1(
  marker: TrustedRuntimeDependencyCacheMarkerV1
): TrustedRuntimeDependencyCacheVolumeSpecV1 {
  const parsed = parseTrustedRuntimeDependencyCacheMarkerV1(marker);
  const name = `sec-trusted-runtime-bun-cache-v1-${parsed.cacheKey.slice(7, 39)}`;
  return Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA_V1,
    name,
    labels: Object.freeze({
      'sec.trusted-runtime.cache-schema': TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA_V1,
      'sec.trusted-runtime.repository': parsed.repository,
      'sec.trusted-runtime.cache-key': parsed.cacheKey,
      'sec.trusted-runtime.image-id': parsed.imageId
    })
  });
}

export function assertTrustedRuntimeDependencyCacheVolumeV1(input: Readonly<{
  source: string;
  expected: TrustedRuntimeDependencyCacheVolumeSpecV1;
  endpointDigest: Digest;
}>): Digest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.source) as unknown;
  } catch {
    fail('Docker dependency-cache volume inspect is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker dependency-cache volume inspect must contain one volume');
  }
  const record = parsed[0] as Record<string, unknown>;
  const labels = record.Labels;
  const options = record.Options;
  if (record.Name !== input.expected.name || record.Driver !== 'local' || record.Scope !== 'local'
      || typeof record.CreatedAt !== 'string' || Number.isNaN(Date.parse(record.CreatedAt))
      || labels === null || typeof labels !== 'object' || Array.isArray(labels)
      || encodeVerificationActionDataV2(labels)
        !== encodeVerificationActionDataV2(input.expected.labels)
      || !(options === null || (typeof options === 'object' && !Array.isArray(options)
        && Object.keys(options as Record<string, unknown>).length === 0))) {
    fail('Docker dependency-cache volume differs from the content-addressed specification');
  }
  return digestValue(Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA_V1,
    endpointDigest: digest(input.endpointDigest, 'dependency-cache volume endpointDigest'),
    name: input.expected.name,
    createdAt: record.CreatedAt,
    driver: record.Driver,
    scope: record.Scope,
    labels: input.expected.labels
  }));
}

function canonicalInstant(value: unknown, label: string): string {
  const result = bounded(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO instant`);
  return result;
}

export function createTrustedRuntimeHostCommandEnvironmentV1(
  executable: 'docker' | 'git',
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const expected of [
    'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'HOME', 'LOCALAPPDATA',
    'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR'
  ]) {
    const actual = Object.keys(source).find((key) => key.toUpperCase() === expected);
    if (actual !== undefined && source[actual] !== undefined) result[actual] = source[actual];
  }
  return executable === 'git' ? isolatedGitChildEnvironment(result) : result;
}

async function commandResult(
  executable: 'docker' | 'git',
  args: readonly string[],
  cwd: string,
  timeoutMs = 120_000,
  dockerEndpoint?: DockerEndpointIdentityV3
): Promise<Awaited<ReturnType<typeof runCommand>>> {
  const commandArgs = executable === 'docker'
    ? dockerEndpointCommandArgsV3(
      dockerEndpoint ?? fail('Docker endpoint identity is required before command execution'),
      args
    )
    : args;
  const result = await runCommand(executable, [...commandArgs], {
    cwd,
    envMode: 'replace',
    env: createTrustedRuntimeHostCommandEnvironmentV1(executable),
    timeoutMs,
    maxStdoutBytes: 32 * 1024 * 1024,
    maxStderrBytes: 32 * 1024 * 1024
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim().slice(-4_096) || result.stdout.trim().slice(-4_096);
    fail(`${executable} ${args[0] ?? '<missing>'} failed (${result.code}): ${detail}`);
  }
  return result;
}

async function command(
  executable: 'docker' | 'git',
  args: readonly string[],
  cwd: string,
  timeoutMs = 120_000,
  dockerEndpoint?: DockerEndpointIdentityV3
): Promise<string> {
  return (await commandResult(executable, args, cwd, timeoutMs, dockerEndpoint)).stdout.trim();
}

export interface TrustedRuntimeContainerIdentityV1 {
  readonly id: string;
  readonly imageId: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

const TRUSTED_RUNTIME_CONTAINER_OPERATION_LABEL_KEYS_V1 = Object.freeze([
  'sec.trusted-runtime.base-sha',
  'sec.trusted-runtime.endpoint-digest',
  'sec.trusted-runtime.head-sha',
  'sec.trusted-runtime.image-id',
  'sec.trusted-runtime.operation',
  'sec.trusted-runtime.owner-host',
  'sec.trusted-runtime.owner-nonce',
  'sec.trusted-runtime.owner-pid',
  'sec.trusted-runtime.profile',
  'sec.trusted-runtime.repository'
] as const);

const TRUSTED_RUNTIME_IMAGE_LABEL_KEYS_V1 = new Set([
  'sec.trusted-runtime.image-schema',
  'sec.trusted-runtime.base-image-id',
  'sec.trusted-runtime.bun-image-manifest',
  'sec.trusted-runtime.bun-version'
]);

const TRUSTED_RUNTIME_OWNER_HOST = hostname();

function localProcessLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
      return 'dead';
    }
    return 'unknown';
  }
}

export function parseTrustedRuntimeContainerIdentityV1(
  source: string
): TrustedRuntimeContainerIdentityV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    fail('Docker container inspect is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker container inspect must contain one container');
  }
  const record = parsed[0] as Record<string, unknown>;
  const config = record.Config;
  if (typeof record.Id !== 'string' || !/^[0-9a-f]{64}$/u.test(record.Id)
      || typeof record.Image !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.Image)
      || typeof record.Name !== 'string' || !record.Name.startsWith('/')
      || config === null || typeof config !== 'object' || Array.isArray(config)) {
    fail('Docker container identity is invalid');
  }
  const rawLabels = (config as Record<string, unknown>).Labels;
  if (rawLabels === null || typeof rawLabels !== 'object' || Array.isArray(rawLabels)) {
    fail('Docker container labels are invalid');
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawLabels)) {
    if (typeof value !== 'string') fail('Docker container label is not text');
    if ((TRUSTED_RUNTIME_CONTAINER_OPERATION_LABEL_KEYS_V1 as readonly string[]).includes(key)) {
      labels[key] = value;
    } else if (key.startsWith('sec.trusted-runtime.')
        && !TRUSTED_RUNTIME_IMAGE_LABEL_KEYS_V1.has(key)) {
      fail('Docker container contains an unknown trusted-runtime label');
    }
  }
  return Object.freeze({
    id: record.Id,
    imageId: record.Image,
    name: record.Name.slice(1),
    labels: Object.freeze(labels)
  });
}

export function assertTrustedRuntimeContainerProfileV1(
  source: string,
  expected: TrustedRuntimeContainerProfileV1
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    fail('Docker container profile inspect is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker container profile inspect must contain one container');
  }
  const hostConfig = (parsed[0] as Record<string, unknown>).HostConfig;
  if (hostConfig === null || typeof hostConfig !== 'object' || Array.isArray(hostConfig)) {
    fail('Docker container HostConfig is invalid');
  }
  const record = hostConfig as Record<string, unknown>;
  const normalized = (value: unknown): readonly string[] => value === null
    ? Object.freeze([])
    : Array.isArray(value) && value.every((entry) => typeof entry === 'string')
      ? Object.freeze([...value].sort())
      : fail('Docker container capability or security profile is invalid');
  const normalizedSecurity = (value: unknown): readonly string[] => Object.freeze(
    normalized(value).map((entry) => entry === 'no-new-privileges:true'
      ? 'no-new-privileges'
      : entry).sort()
  );
  const normalizedCapabilities = (value: unknown): readonly string[] => Object.freeze(
    normalized(value).map((entry) => entry.startsWith('CAP_') ? entry.slice(4) : entry).sort()
  );
  const observed = Object.freeze({
    pidsLimit: Number(record.PidsLimit),
    nanoCpus: Number(record.NanoCpus),
    memoryBytes: Number(record.Memory),
    capAdd: normalizedCapabilities(record.CapAdd),
    capDrop: normalizedCapabilities(record.CapDrop),
    securityOpt: normalizedSecurity(record.SecurityOpt)
  });
  const wanted = Object.freeze({
    pidsLimit: expected.pidsLimit,
    nanoCpus: expected.nanoCpus,
    memoryBytes: expected.memoryBytes,
    capAdd: normalizedCapabilities(expected.capAdd),
    capDrop: normalizedCapabilities(expected.capDrop),
    securityOpt: normalizedSecurity(expected.securityOpt)
  });
  const mismatches = (Object.keys(wanted) as (keyof typeof wanted)[]).filter((key) =>
    encodeVerificationActionDataV2(observed[key]) !== encodeVerificationActionDataV2(wanted[key]));
  if (mismatches.length > 0) {
    fail(`Docker container profile differs from ${expected.id}: ${mismatches.join(',')}; observed=${
      encodeVerificationActionDataV2(observed)}`);
  }
}

export function createTrustedRuntimeDependencyCacheMountV1(volumeName: string): string {
  if (!/^sec-trusted-runtime-bun-cache-v1-[0-9a-f]{32}$/u.test(volumeName)) {
    fail('Docker dependency-cache volume name is invalid');
  }
  return `type=volume,source=${volumeName},target=${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1}`;
}

export function assertTrustedRuntimeDependencyCacheMountV1(
  source: string,
  expectedVolumeName: string
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    fail('Docker dependency-cache mount inspect is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker dependency-cache mount inspect must contain one container');
  }
  const mounts = (parsed[0] as Record<string, unknown>).Mounts;
  if (!Array.isArray(mounts)) fail('Docker dependency-cache mount inventory is invalid');
  const matches = mounts.filter((entry) => entry !== null && typeof entry === 'object'
    && !Array.isArray(entry)
    && (entry as Record<string, unknown>).Destination
      === TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1);
  if (matches.length !== 1) fail('Docker dependency-cache mount must be unique');
  const mount = matches[0] as Record<string, unknown>;
  if (mount.Type !== 'volume' || mount.Driver !== 'local' || mount.RW !== true
      || mount.Name !== expectedVolumeName) {
    fail('Docker dependency-cache mount differs from the content-addressed volume');
  }
}

function sameContainerIdentityV1(
  left: TrustedRuntimeContainerIdentityV1,
  right: TrustedRuntimeContainerIdentityV1
): boolean {
  return left.id === right.id && left.imageId === right.imageId && left.name === right.name
    && encodeVerificationActionDataV2(left.labels) === encodeVerificationActionDataV2(right.labels);
}

export function authorizeTrustedRuntimeContainerRecoveryV1(input: Readonly<{
  first: TrustedRuntimeContainerIdentityV1;
  confirmed: TrustedRuntimeContainerIdentityV1;
  expected: Readonly<{
    operationKey: string;
    repository: string;
    baseSha: string;
    headSha: string;
    endpointDigest: Digest;
    imageId: string;
    ownerHost: string;
    profileId: string;
  }>;
  observeProcessLiveness: (pid: number) => 'alive' | 'dead' | 'unknown';
}>): string {
  const expectedLabelKeys = TRUSTED_RUNTIME_CONTAINER_OPERATION_LABEL_KEYS_V1;
  const ownerPidText = input.first.labels['sec.trusted-runtime.owner-pid'];
  const ownerPid = ownerPidText !== undefined && /^[1-9][0-9]*$/u.test(ownerPidText)
    ? Number(ownerPidText)
    : Number.NaN;
  const ownerNonce = input.first.labels['sec.trusted-runtime.owner-nonce'];
  if (Object.keys(input.first.labels).sort().join('\0') !== expectedLabelKeys.join('\0')
      || input.first.imageId !== input.expected.imageId
      || input.first.labels['sec.trusted-runtime.operation'] !== input.expected.operationKey
      || input.first.labels['sec.trusted-runtime.repository'] !== input.expected.repository
      || input.first.labels['sec.trusted-runtime.base-sha'] !== input.expected.baseSha
      || input.first.labels['sec.trusted-runtime.head-sha'] !== input.expected.headSha
      || input.first.labels['sec.trusted-runtime.endpoint-digest'] !== input.expected.endpointDigest
      || input.first.labels['sec.trusted-runtime.image-id'] !== input.expected.imageId
      || input.first.labels['sec.trusted-runtime.owner-host'] !== input.expected.ownerHost
      || input.first.labels['sec.trusted-runtime.profile'] !== input.expected.profileId
      || ownerNonce === undefined
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(ownerNonce)
      || input.first.name !== `sec-trusted-runtime-${input.expected.operationKey}-${ownerNonce}`
      || !Number.isSafeInteger(ownerPid) || ownerPid > 2_147_483_647) {
    fail('Docker abandoned-container identity differs from the fenced operation');
  }
  const firstLiveness = input.observeProcessLiveness(ownerPid);
  if (firstLiveness !== 'dead') {
    fail(`Docker abandoned-container owner is ${firstLiveness}; recovery is not authorized`);
  }
  if (!sameContainerIdentityV1(input.first, input.confirmed)
      || input.observeProcessLiveness(ownerPid) !== 'dead') {
    fail('Docker abandoned-container identity or owner liveness changed during recovery');
  }
  return input.confirmed.id;
}

async function inspectContainerIdentityV1(
  repositoryRoot: string,
  dockerEndpoint: DockerEndpointIdentityV3,
  container: string
): Promise<TrustedRuntimeContainerIdentityV1> {
  return parseTrustedRuntimeContainerIdentityV1(await command(
    'docker',
    ['container', 'inspect', container],
    repositoryRoot,
    120_000,
    dockerEndpoint
  ));
}

/**
 * Dead local owners are collected only after two identical Docker identity
 * observations. Unknown, foreign-host, live, malformed, or changed resources
 * are retained and block the same operation while its repository-scoped lease
 * is held; a collision-free name cannot bypass an unresolved prior start.
 */
async function reclaimAbandonedTrustedRuntimeContainersV1(input: Readonly<{
  repositoryRoot: string;
  dockerEndpoint: DockerEndpointIdentityV3;
  operationKey: string;
  repository: string;
  baseSha: string;
  headSha: string;
  endpointDigest: Digest;
  imageId: string;
  profileId: string;
}>): Promise<void> {
  const list = await runCommand('docker', [...dockerEndpointCommandArgsV3(
    input.dockerEndpoint,
    [
      'container', 'ls', '--all', '--quiet', '--no-trunc',
      '--filter', `label=sec.trusted-runtime.operation=${input.operationKey}`
    ]
  )], {
    cwd: input.repositoryRoot,
    envMode: 'replace',
    env: createTrustedRuntimeHostCommandEnvironmentV1('docker'),
    timeoutMs: 120_000,
    maxStdoutBytes: 4 * 1024 * 1024,
    maxStderrBytes: 4 * 1024 * 1024
  });
  if (list.code !== 0) {
    fail(`Docker abandoned-container inventory failed: ${list.stderr.trim().slice(-4_096)}`);
  }
  const idLines = list.stdout.split(/\r?\n/u);
  while (idLines.at(-1) === '') idLines.pop();
  if (idLines.some((value) => !/^[0-9a-f]{64}$/u.test(value))
      || new Set(idLines).size !== idLines.length) {
    fail('Docker abandoned-container inventory is malformed or duplicated');
  }
  const ids = Object.freeze([...idLines]);
  for (const id of ids) {
    let first: TrustedRuntimeContainerIdentityV1;
    try {
      first = await inspectContainerIdentityV1(input.repositoryRoot, input.dockerEndpoint, id);
    } catch (error) {
      fail(`Docker abandoned-container identity cannot be observed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let confirmed: TrustedRuntimeContainerIdentityV1;
    try {
      confirmed = await inspectContainerIdentityV1(input.repositoryRoot, input.dockerEndpoint, first.id);
    } catch (error) {
      fail(`Docker abandoned-container confirmation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const recoveryTarget = authorizeTrustedRuntimeContainerRecoveryV1({
      first,
      confirmed,
      expected: {
        operationKey: input.operationKey,
        repository: input.repository,
        baseSha: input.baseSha,
        headSha: input.headSha,
        endpointDigest: input.endpointDigest,
        imageId: input.imageId,
        ownerHost: TRUSTED_RUNTIME_OWNER_HOST,
        profileId: input.profileId
      },
      observeProcessLiveness: localProcessLiveness
    });
    const removed = await runCommand('docker', [...dockerEndpointCommandArgsV3(
      input.dockerEndpoint,
      ['container', 'rm', '--force', recoveryTarget]
    )], {
      cwd: input.repositoryRoot,
      envMode: 'replace',
      env: createTrustedRuntimeHostCommandEnvironmentV1('docker'),
      timeoutMs: 120_000,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 1024 * 1024
    });
    if (removed.code !== 0) {
      fail(`Docker abandoned-container removal failed: ${removed.stderr.trim().slice(-4_096)}`);
    }
  }
}

function imageObservation(source: string): TrustedRuntimeContainerImageObservationV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('Docker image inspect is not JSON');
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker image inspect must contain one image');
  }
  const image = parsed[0] as Record<string, unknown>;
  if (image.Id !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1) fail('Docker image ID drifted');
  const config = image.Config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    fail('Docker image config is invalid');
  }
  const labels = (config as Record<string, unknown>).Labels;
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) {
    fail('Docker image labels are invalid');
  }
  const observed = labels as Record<string, unknown>;
  const expected: Readonly<Record<string, string>> = Object.freeze({
    'sec.trusted-runtime.image-schema': TRUSTED_RUNTIME_CONTAINER_SCHEMA_V1,
    'sec.trusted-runtime.base-image-id': TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID_V1,
    'sec.trusted-runtime.bun-image-manifest': TRUSTED_RUNTIME_CONTAINER_BUN_IMAGE_MANIFEST_V1,
    'sec.trusted-runtime.bun-version': '1.3.14'
  });
  for (const [key, value] of Object.entries(expected)) {
    if (observed[key] !== value) fail(`Docker image label ${key} drifted`);
  }
  return Object.freeze({
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    labels: Object.freeze(Object.fromEntries(
      Object.entries(observed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ))
  });
}

export function assertTrustedRuntimeContainerImageV1(
  source: string
): TrustedRuntimeContainerImageObservationV1 {
  return imageObservation(source);
}

async function ensureImage(
  repositoryRoot: string,
  dockerEndpoint: DockerEndpointIdentityV3
): Promise<TrustedRuntimeContainerImageObservationV1> {
  const inspected = await runCommand('docker', [...dockerEndpointCommandArgsV3(
    dockerEndpoint,
    ['image', 'inspect', TRUSTED_RUNTIME_CONTAINER_IMAGE_V1]
  )], {
    cwd: repositoryRoot,
    envMode: 'replace',
    env: createTrustedRuntimeHostCommandEnvironmentV1('docker'),
    timeoutMs: 120_000,
    maxStdoutBytes: 4 * 1024 * 1024,
    maxStderrBytes: 4 * 1024 * 1024
  });
  if (inspected.code === 0) return imageObservation(inspected.stdout);
  const baseImageId = await ensureLocalGitHubActionsRunnerToolchainImageV1(repositoryRoot);
  await assertDockerEndpointIdentityV3(dockerEndpoint, repositoryRoot);
  if (baseImageId !== TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID_V1) {
    fail('trusted toolchain base image identity drifted');
  }
  const bunImage = `oven/bun@${TRUSTED_RUNTIME_CONTAINER_BUN_IMAGE_MANIFEST_V1}`;
  const bunPresent = await runCommand('docker', [...dockerEndpointCommandArgsV3(
    dockerEndpoint,
    ['image', 'inspect', bunImage]
  )], {
    cwd: repositoryRoot,
    envMode: 'replace',
    env: createTrustedRuntimeHostCommandEnvironmentV1('docker'),
    timeoutMs: 120_000,
    maxStdoutBytes: 4 * 1024 * 1024,
    maxStderrBytes: 4 * 1024 * 1024
  });
  if (bunPresent.code !== 0) {
    await command('docker', ['pull', bunImage], repositoryRoot, 15 * 60_000, dockerEndpoint);
  }
  const dockerfile = path.join(import.meta.dir, 'trusted-runtime.Dockerfile');
  await command('docker', [
    'build', '--pull=false', '--network', 'none', '--provenance=false',
    '--tag', TRUSTED_RUNTIME_CONTAINER_IMAGE_V1,
    '--file', dockerfile,
    import.meta.dir
  ], repositoryRoot, 15 * 60_000, dockerEndpoint);
  return imageObservation(await command('docker', [
    'image', 'inspect', TRUSTED_RUNTIME_CONTAINER_IMAGE_V1
  ], repositoryRoot, 120_000, dockerEndpoint));
}

async function ensureTrustedRuntimeDependencyCacheVolumeV1(input: Readonly<{
  repositoryRoot: string;
  dockerEndpoint: DockerEndpointIdentityV3;
  endpointDigest: Digest;
  marker: TrustedRuntimeDependencyCacheMarkerV1;
}>): Promise<Readonly<{
  spec: TrustedRuntimeDependencyCacheVolumeSpecV1;
  observationDigest: Digest;
}>> {
  const spec = createTrustedRuntimeDependencyCacheVolumeSpecV1(input.marker);
  let inspected = await runCommand('docker', [...dockerEndpointCommandArgsV3(
    input.dockerEndpoint,
    ['volume', 'inspect', spec.name]
  )], {
    cwd: input.repositoryRoot,
    envMode: 'replace',
    env: createTrustedRuntimeHostCommandEnvironmentV1('docker'),
    timeoutMs: 120_000,
    maxStdoutBytes: 4 * 1024 * 1024,
    maxStderrBytes: 4 * 1024 * 1024
  });
  if (inspected.code !== 0) {
    if (!/no such volume/iu.test(inspected.stderr)) {
      fail(`Docker dependency-cache volume inventory failed: ${inspected.stderr.trim().slice(-4_096)}`);
    }
    const created = await command('docker', [
      'volume', 'create', '--driver', 'local',
      ...Object.entries(spec.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
      spec.name
    ], input.repositoryRoot, 120_000, input.dockerEndpoint);
    if (created !== spec.name) fail('Docker dependency-cache volume create returned another name');
    inspected = await commandResult(
      'docker',
      ['volume', 'inspect', spec.name],
      input.repositoryRoot,
      120_000,
      input.dockerEndpoint
    );
  }
  const observationDigest = assertTrustedRuntimeDependencyCacheVolumeV1({
    source: inspected.stdout,
    expected: spec,
    endpointDigest: input.endpointDigest
  });
  return Object.freeze({ spec, observationDigest });
}

async function createCandidateBundle(input: Readonly<{
  repositoryRoot: string;
  temporaryRoot: string;
  baseSha: string;
  headSha: string;
}>): Promise<string> {
  const bare = path.join(input.temporaryRoot, 'bundle-source.git');
  const bundle = path.join(input.temporaryRoot, 'candidate.bundle');
  await command('git', ['init', '--bare', bare], input.temporaryRoot);
  await command('git', [
    '-c', 'protocol.file.allow=always',
    '-C', bare,
    'fetch', '--no-tags', '--no-write-fetch-head', input.repositoryRoot,
    `${input.baseSha}:refs/sec/base`, `${input.headSha}:refs/sec/head`
  ], input.temporaryRoot);
  await command('git', [
    '-C', bare, 'bundle', 'create', bundle, 'refs/sec/base', 'refs/sec/head'
  ], input.temporaryRoot);
  await command('git', ['-C', bare, 'bundle', 'verify', bundle], input.temporaryRoot);
  return bundle;
}

const PUBLISH_DEPENDENCY_CACHE_MARKER_SCRIPT_V1 = [
  'set -euo pipefail',
  'expected="$1"',
  'expected_digest="$2"',
  `root="${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1}"`,
  `marker="$root/${TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE_V1}"`,
  'mkdir -p -- "$root"',
  '[ -d "$root" ] && [ ! -L "$root" ]',
  'if [ -e "$marker" ]; then',
  '  [ -f "$marker" ] && [ ! -L "$marker" ]',
  '  [ "$(cat -- "$marker")" = "$expected" ]',
  'else',
  '  temporary="$root/.sec-derived-cache.new-$$"',
  '  (umask 077; set -C; printf \u0027%s\\n\u0027 "$expected" > "$temporary")',
  '  mv -T -- "$temporary" "$marker"',
  'fi',
  'actual="$(sha256sum "$marker")"',
  'actual="${actual%% *}"',
  '[ "sha256:$actual" = "$expected_digest" ]',
  'printf \u0027sha256:%s\\n\u0027 "$actual"'
].join('\n');

const READ_DEPENDENCY_CACHE_MARKER_DIGEST_SCRIPT_V1 = [
  'set -euo pipefail',
  `marker="${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1}/${TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE_V1}"`,
  '[ -f "$marker" ] && [ ! -L "$marker" ]',
  'actual="$(sha256sum "$marker")"',
  'actual="${actual%% *}"',
  'printf \u0027sha256:%s\\n\u0027 "$actual"'
].join('\n');

const SETUP_SCRIPT = [
  'set -euo pipefail',
  'base="$1"',
  'head="$2"',
  'dependency_mode="$3"',
  'workspace_owner_mode="$4"',
  'trusted_base_mode="$5"',
  'cache_marker_file_digest="$6"',
  `cache_marker_path="${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1}/${TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE_V1}"`,
  'cache_marker_hash="$(sha256sum "$cache_marker_path")"',
  'cache_marker_hash="${cache_marker_hash%% *}"',
  '[ "sha256:$cache_marker_hash" = "$cache_marker_file_digest" ]',
  'mkdir -p /authenticated-input /trusted /workspace /output',
  'git init --quiet /trusted',
  'git -C /trusted fetch --quiet /authenticated-input/candidate.bundle refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head',
  'git -C /trusted reset --hard --quiet refs/sec/base',
  '[ "$(git -C /trusted rev-parse HEAD)" = "$base" ]',
  'git init --quiet /workspace',
  'git -C /workspace fetch --quiet /authenticated-input/candidate.bundle refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head',
  'git -C /workspace reset --hard --quiet refs/sec/head',
  '[ "$(git -C /workspace rev-parse HEAD)" = "$head" ]',
  'cd /trusted',
  `export BUN_INSTALL_CACHE_DIR=${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1}`,
  'if [ "$dependency_mode" = "shared-base-link" ]; then bun install --frozen-lockfile --ignore-scripts; fi',
  'cache_marker_hash="$(sha256sum "$cache_marker_path")"',
  'cache_marker_hash="${cache_marker_hash%% *}"',
  '[ "sha256:$cache_marker_hash" = "$cache_marker_file_digest" ]',
  'rm -rf /workspace/node_modules',
  'if [ "$dependency_mode" = "shared-base-link" ]; then ln -s /trusted/node_modules /workspace/node_modules; fi',
  'if [ "$dependency_mode" = "bootstrap-base-materialized" ]; then [ ! -e /trusted/node_modules ]; fi',
  '[ "$dependency_mode" = "shared-base-link" ] || [ "$dependency_mode" = "bootstrap-base-materialized" ]',
  'if [ "$workspace_owner_mode" = "delegated-user-1000" ]; then chown -R 1000:1000 /workspace /output; fi',
  '[ "$workspace_owner_mode" = "delegated-user-1000" ] || [ "$workspace_owner_mode" = "container-root" ]',
  'if [ "$trusted_base_mode" = "read-only-after-setup" ]; then chmod -R a-w /trusted; fi',
  'if [ "$trusted_base_mode" = "materializer-owned" ]; then [ -w /trusted ]; fi',
  '[ "$trusted_base_mode" = "read-only-after-setup" ] || [ "$trusted_base_mode" = "materializer-owned" ]',
  'rm -f /authenticated-input/candidate.bundle'
].join('\n');

function formalEnvironment(input: Readonly<{
  envelope: VerificationSessionHostedEnvelopeV1;
  executionId: string;
  actorNodeId: string;
  requiredBlobs: readonly Readonly<{ path: string; digest: Digest }>[];
}>): readonly string[] {
  const { envelope } = input;
  const values: Readonly<Record<string, string>> = Object.freeze({
    CI: '1',
    HOME: '/home/ubuntu',
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    SEC_FORMAL_TRUSTED_RUNTIME_MODE: '1',
    SEC_SESSION_REVISION: envelope.session.sessionRevision,
    SEC_SESSION_PROPOSAL_DIGEST: envelope.session.sessionProposalDigest,
    SEC_SCOPE_AUTHORIZATION_REVISION: envelope.scopeAuthorization.authorizationRevision,
    SEC_SCOPE_AUTHORIZATION_DIGEST: envelope.scopeAuthorization.authorizationDigest,
    SEC_REVIEW_RECEIPT_DIGEST: envelope.preGateReview.receiptDigest,
    SEC_MAIN_HEALTH_REVISION: envelope.mainHealth.healthRevision,
    SEC_MAIN_HEALTH_DIGEST: envelope.mainHealth.ledgerDigest,
    SEC_TRUST_REVISION: envelope.session.trustRevision,
    SEC_BASE_TREE_SHA: envelope.session.baseTreeSha,
    SEC_ACTION_PLAN_DIGEST: envelope.actionPlanClosure.actionPlanDigest,
    SEC_REQUIRED_BLOB_CLOSURE_JSON: encodeVerificationActionDataV2(input.requiredBlobs),
    SEC_EXECUTION_ENVIRONMENT_REVISION:
      TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1.executionEnvironmentRevision,
    SEC_TRUSTED_RUNTIME_EXECUTION_ID: input.executionId,
    SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID: input.actorNodeId,
    SEC_CHANGED_BASE: 'refs/sec/base',
    SEC_AFFECTED_TESTS_BASE: 'refs/sec/base',
    SEC_WORK_PACKAGE_MANIFEST_PATH: envelope.session.manifestPath,
    SEC_CI_VERIFICATION_EVIDENCE_PATH: '/output/verification-evidence.json'
  });
  return Object.freeze(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => ['--env', `${key}=${value}`]));
}

function createReceipt(input: Omit<TrustedRuntimeContainerReceiptV1, 'schema' | 'receiptDigest'>):
TrustedRuntimeContainerReceiptV1 {
  const withoutDigest = Object.freeze({ schema: TRUSTED_RUNTIME_CONTAINER_SCHEMA_V1, ...input });
  return Object.freeze({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
}

export function parseTrustedRuntimeContainerReceiptV1(
  value: unknown
): TrustedRuntimeContainerReceiptV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('receipt must be an object');
  }
  const record = value as Record<string, unknown>;
  const expected = [
    'schema', 'executionId', 'sessionRevision', 'baseSha', 'headSha', 'headTreeSha',
    'imageId', 'dockerEndpoint', 'networkIsolatedBeforeSut', 'evidenceByteDigest',
    'evidenceByteLength', 'evidenceDigest', 'producerSourceDigest', 'receiptDigest'
  ].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
      || record.schema !== TRUSTED_RUNTIME_CONTAINER_SCHEMA_V1
      || record.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
      || record.networkIsolatedBeforeSut !== true
      || !Number.isSafeInteger(record.evidenceByteLength)
      || Number(record.evidenceByteLength) < 1) {
    fail('receipt shape or fixed identity is invalid');
  }
  const rebuilt = createReceipt({
    executionId: bounded(record.executionId, 'receipt.executionId'),
    sessionRevision: digest(record.sessionRevision, 'receipt.sessionRevision'),
    baseSha: sha(record.baseSha, 'receipt.baseSha'),
    headSha: sha(record.headSha, 'receipt.headSha'),
    headTreeSha: sha(record.headTreeSha, 'receipt.headTreeSha'),
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    dockerEndpoint: parseDockerEndpointIdentityV3(record.dockerEndpoint),
    networkIsolatedBeforeSut: true,
    evidenceByteDigest: digest(record.evidenceByteDigest, 'receipt.evidenceByteDigest'),
    evidenceByteLength: Number(record.evidenceByteLength),
    evidenceDigest: digest(record.evidenceDigest, 'receipt.evidenceDigest'),
    producerSourceDigest: digest(record.producerSourceDigest, 'receipt.producerSourceDigest')
  });
  if (rebuilt.receiptDigest !== digest(record.receiptDigest, 'receipt.receiptDigest')) {
    fail('receipt digest mismatch');
  }
  return rebuilt;
}

export function createTrustedRuntimeMainHealthReceiptV1(input: Omit<
  TrustedRuntimeMainHealthReceiptV1,
  'schema' | 'receiptDigest'
>): TrustedRuntimeMainHealthReceiptV1 {
  if ((input.origin !== 'physical-main' && input.origin !== 'verified-candidate-transition')
      || input.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
      || input.networkIsolatedBeforeExecution !== true
      || input.planDigest !== TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1
      || input.commandResultDigests.length !== TRUSTED_RUNTIME_MAIN_HEALTH_COMMANDS_V1.length) {
    fail('MainHealth receipt fixed execution identity is invalid');
  }
  let transition: TrustedRuntimeMainHealthReceiptV1['transition'];
  if (input.origin === 'physical-main') {
    if (input.transition !== null) fail('physical MainHealth receipt cannot carry transition evidence');
    transition = null;
  } else {
    if (input.transition === null
        || input.transition.candidateHeadTreeSha !== input.mainTreeSha) {
      fail('transition MainHealth receipt does not bind the exact new-main tree');
    }
    transition = Object.freeze({
      candidateHeadSha: sha(input.transition.candidateHeadSha, 'transition candidateHeadSha'),
      candidateHeadTreeSha: sha(input.transition.candidateHeadTreeSha, 'transition candidateHeadTreeSha'),
      sessionRevision: digest(input.transition.sessionRevision, 'transition sessionRevision'),
      verificationEvidenceDigest: digest(
        input.transition.verificationEvidenceDigest,
        'transition verificationEvidenceDigest'
      ),
      containerReceiptDigest: digest(
        input.transition.containerReceiptDigest,
        'transition containerReceiptDigest'
      ),
      mergeGateResultDigest: digest(input.transition.mergeGateResultDigest, 'transition mergeGateResultDigest'),
      statusPublicationDigest: digest(
        input.transition.statusPublicationDigest,
        'transition statusPublicationDigest'
      )
    });
  }
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA_V1,
    origin: input.origin,
    repository: repository(input.repository),
    mainSha: sha(input.mainSha, 'MainHealth mainSha'),
    mainTreeSha: sha(input.mainTreeSha, 'MainHealth mainTreeSha'),
    executionId: bounded(input.executionId, 'MainHealth executionId'),
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    dockerEndpoint: parseDockerEndpointIdentityV3(input.dockerEndpoint),
    networkIsolatedBeforeExecution: true as const,
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
    commandResultDigests: Object.freeze(input.commandResultDigests.map((entry, index) =>
      digest(entry, `MainHealth commandResultDigests[${index}]`))),
    transition,
    observedAt: canonicalInstant(input.observedAt, 'MainHealth observedAt')
  });
  return Object.freeze({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
}

export function parseTrustedRuntimeMainHealthReceiptV1(
  value: unknown
): TrustedRuntimeMainHealthReceiptV1 {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      fail('MainHealth receipt is not JSON');
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('MainHealth receipt must be an object');
  }
  const record = value as Record<string, unknown>;
  const expected = [
    'schema', 'origin', 'repository', 'mainSha', 'mainTreeSha', 'executionId', 'imageId',
    'dockerEndpoint', 'networkIsolatedBeforeExecution', 'planDigest',
    'commandResultDigests', 'transition', 'observedAt', 'receiptDigest'
  ].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
      || record.schema !== TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA_V1
      || record.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
      || record.networkIsolatedBeforeExecution !== true
      || record.planDigest !== TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1
      || !Array.isArray(record.commandResultDigests)) {
    fail('MainHealth receipt shape or fixed identity is invalid');
  }
  const rebuilt = createTrustedRuntimeMainHealthReceiptV1({
    origin: record.origin as TrustedRuntimeMainHealthReceiptV1['origin'],
    repository: repository(record.repository),
    mainSha: sha(record.mainSha, 'MainHealth mainSha'),
    mainTreeSha: sha(record.mainTreeSha, 'MainHealth mainTreeSha'),
    executionId: bounded(record.executionId, 'MainHealth executionId'),
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    dockerEndpoint: parseDockerEndpointIdentityV3(record.dockerEndpoint),
    networkIsolatedBeforeExecution: true,
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
    commandResultDigests: record.commandResultDigests.map((entry, index) =>
      digest(entry, `MainHealth commandResultDigests[${index}]`)),
    transition: record.transition as TrustedRuntimeMainHealthReceiptV1['transition'],
    observedAt: canonicalInstant(record.observedAt, 'MainHealth observedAt')
  });
  if (rebuilt.receiptDigest !== digest(record.receiptDigest, 'MainHealth receiptDigest')) {
    fail('MainHealth receipt digest mismatch');
  }
  return rebuilt;
}

interface TrustedRuntimeWorkspaceV1 {
  readonly containerName: string;
  readonly temporaryRoot: string;
  readonly image: TrustedRuntimeContainerImageObservationV1;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly dependencyCacheKey: Digest;
  readonly dependencyCacheMarkerFileDigest: Digest;
  readonly dependencyCacheVolumeObservationDigest: Digest;
}

async function withTrustedRuntimeWorkspaceV1<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  headSha: string;
  operationKey: string;
  profile?: TrustedRuntimeContainerProfileV1;
  execute: (workspace: TrustedRuntimeWorkspaceV1) => Promise<T>;
}>): Promise<T> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const repositoryIdentity = repository(input.repository);
  const baseSha = sha(input.baseSha, 'workspace baseSha');
  const headSha = sha(input.headSha, 'workspace headSha');
  const profile = input.profile ?? TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary;
  if (!/^[a-z0-9][a-z0-9-]{7,47}$/u.test(input.operationKey)) {
    fail('workspace operation key is invalid');
  }
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository: repositoryIdentity,
    repositoryRoot
  });
  const operationLeaseRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-runtime-container-leases',
    'v1'
  );
  const bunLockBlobSha = sha(await command('git', [
    'rev-parse', `${baseSha}:bun.lock`
  ], repositoryRoot), 'workspace bun.lock blob');
  const dependencyCacheMarker = createTrustedRuntimeDependencyCacheMarkerV1({
    repository: repositoryIdentity,
    bunLockBlobSha,
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
  });
  const operationLeaseAuthority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [operationLeaseRoot]
  });
  const operationLease = acquirePhysicalMutationLeaseV1(
    operationLeaseAuthority.directory(operationLeaseRoot),
    `container-${input.operationKey}.lock`
  );
  if (operationLease === null) {
    fail('trusted runtime operation is already active or its owner liveness is unknown');
  }
  try {
    const dockerEndpoint = await observeDockerEndpointIdentityV3(repositoryRoot);
    const image = await ensureImage(repositoryRoot, dockerEndpoint);
    await assertDockerEndpointIdentityV3(dockerEndpoint, repositoryRoot);
    const endpointDigest = digestValue(dockerEndpoint);
    const dependencyCacheVolume = await ensureTrustedRuntimeDependencyCacheVolumeV1({
      repositoryRoot,
      dockerEndpoint,
      endpointDigest,
      marker: dependencyCacheMarker
    });
    const dependencyCacheMarkerBytes = canonicalDependencyCacheMarkerBytes(
      dependencyCacheMarker
    );
    const dependencyCacheMarkerSource = Buffer.from(dependencyCacheMarkerBytes)
      .toString('utf8').trimEnd();
    const expectedDependencyCacheMarkerFileDigest = digestBytes(dependencyCacheMarkerBytes);
    await reclaimAbandonedTrustedRuntimeContainersV1({
      repositoryRoot,
      dockerEndpoint,
      operationKey: input.operationKey,
      repository: repositoryIdentity,
      baseSha,
      headSha,
      endpointDigest,
      imageId: image.imageId,
      profileId: profile.id
    });
    const ownerNonce = randomUUID();
    const containerName = `sec-trusted-runtime-${input.operationKey}-${ownerNonce}`;
    const containerLabels = Object.freeze({
      'sec.trusted-runtime.operation': input.operationKey,
      'sec.trusted-runtime.repository': repositoryIdentity,
      'sec.trusted-runtime.base-sha': baseSha,
      'sec.trusted-runtime.head-sha': headSha,
      'sec.trusted-runtime.endpoint-digest': endpointDigest,
      'sec.trusted-runtime.owner-host': TRUSTED_RUNTIME_OWNER_HOST,
      'sec.trusted-runtime.owner-pid': String(process.pid),
      'sec.trusted-runtime.owner-nonce': ownerNonce,
      'sec.trusted-runtime.image-id': image.imageId,
      'sec.trusted-runtime.profile': profile.id
    });
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-trusted-runtime-'));
    let containerCreated = false;
    let containerId: string | null = null;
    try {
      const bundle = await createCandidateBundle({ repositoryRoot, temporaryRoot, baseSha, headSha });
      const dependencyCacheMount = createTrustedRuntimeDependencyCacheMountV1(
        dependencyCacheVolume.spec.name
      );
      containerId = await command('docker', [
        'container', 'create', '--name', containerName,
        ...Object.entries(containerLabels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
        ...profile.capDrop.flatMap((value) => ['--cap-drop', value]),
        ...profile.capAdd.flatMap((value) => ['--cap-add', value]),
        ...profile.securityOpt.flatMap((value) => ['--security-opt', `${value}:true`]),
        '--pids-limit', String(profile.pidsLimit),
        '--cpus', String(profile.nanoCpus / 1_000_000_000),
        '--memory', String(profile.memoryBytes),
        '--mount', dependencyCacheMount,
        '--tmpfs', '/tmp:rw,nosuid,nodev,size=2g',
        image.imageId
      ], repositoryRoot, 120_000, dockerEndpoint);
      containerCreated = true;
      if (!/^[0-9a-f]{64}$/u.test(containerId)) {
        fail('Docker container create returned an invalid identity');
      }
      const containerTarget = containerId;
      const containerInspect = await command(
        'docker',
        ['container', 'inspect', containerTarget],
        repositoryRoot,
        120_000,
        dockerEndpoint
      );
      const createdIdentity = parseTrustedRuntimeContainerIdentityV1(containerInspect);
      if (createdIdentity.id !== containerTarget
          || createdIdentity.name !== containerName
          || createdIdentity.imageId !== image.imageId
          || encodeVerificationActionDataV2(createdIdentity.labels)
            !== encodeVerificationActionDataV2(containerLabels)) {
        fail('Docker container creation readback differs from the retained attempt identity');
      }
      assertTrustedRuntimeContainerProfileV1(containerInspect, profile);
      assertTrustedRuntimeDependencyCacheMountV1(
        containerInspect,
        dependencyCacheVolume.spec.name
      );
      await command(
        'docker',
        ['container', 'start', containerTarget],
        repositoryRoot,
        120_000,
        dockerEndpoint
      );
      await command('docker', ['container', 'exec', containerTarget,
        '/bin/mkdir', '-p', '/authenticated-input', '/output'], repositoryRoot, 120_000, dockerEndpoint);
      const publishedMarkerDigest = digest(await command('docker', [
        'container', 'exec', containerTarget, '/bin/bash', '-ceu',
        PUBLISH_DEPENDENCY_CACHE_MARKER_SCRIPT_V1, '--',
        dependencyCacheMarkerSource, expectedDependencyCacheMarkerFileDigest
      ], repositoryRoot, 120_000, dockerEndpoint), 'published dependency-cache marker digest');
      if (publishedMarkerDigest !== expectedDependencyCacheMarkerFileDigest) {
        fail('published dependency-cache marker digest differs');
      }
      await command('docker', ['container', 'cp', bundle,
        `${containerTarget}:/authenticated-input/candidate.bundle`], repositoryRoot, 120_000, dockerEndpoint);
      await command('docker', [
        'container', 'exec', containerTarget, '/bin/bash', '-lc', SETUP_SCRIPT, '--',
        baseSha, headSha, profile.dependencyMode, profile.workspaceOwnerMode,
        profile.trustedBaseMode,
        expectedDependencyCacheMarkerFileDigest
      ], repositoryRoot, 30 * 60_000, dockerEndpoint);
      await operationLeaseAuthority.assertCurrent();
      const dependencyCacheMarkerFileDigest = digest(await command('docker', [
        'container', 'exec', containerTarget, '/bin/bash', '-ceu',
        READ_DEPENDENCY_CACHE_MARKER_DIGEST_SCRIPT_V1
      ], repositoryRoot, 120_000, dockerEndpoint), 'dependency-cache marker readback digest');
      if (dependencyCacheMarkerFileDigest !== expectedDependencyCacheMarkerFileDigest) {
        fail('dependency-cache marker changed during setup');
      }
      if (profile.networkIsolationBoundary === 'outer-container-before-execution') {
        const networksSource = await command('docker', [
          'container', 'inspect', '--format', '{{json .NetworkSettings.Networks}}', containerTarget
        ], repositoryRoot, 120_000, dockerEndpoint);
        const networks = JSON.parse(networksSource) as Record<string, unknown>;
        for (const network of Object.keys(networks).sort()) {
          await command(
            'docker',
            ['network', 'disconnect', network, containerTarget],
            repositoryRoot,
            120_000,
            dockerEndpoint
          );
        }
        const isolated = JSON.parse(await command('docker', [
          'container', 'inspect', '--format', '{{json .NetworkSettings.Networks}}', containerTarget
        ], repositoryRoot, 120_000, dockerEndpoint)) as Record<string, unknown>;
        if (Object.keys(isolated).length !== 0) {
          fail('network isolation readback is not empty before trusted execution');
        }
      } else if (profile.networkIsolationBoundary !== 'base-owned-sut-sandbox') {
        fail('trusted-runtime network isolation boundary is unsupported');
      }
      await assertDockerEndpointIdentityV3(dockerEndpoint, repositoryRoot);
      return await input.execute(Object.freeze({
        containerName: containerTarget,
        temporaryRoot,
        image,
        dockerEndpoint,
        dependencyCacheKey: dependencyCacheMarker.cacheKey,
        dependencyCacheMarkerFileDigest,
        dependencyCacheVolumeObservationDigest: dependencyCacheVolume.observationDigest
      }));
    } finally {
      if (containerCreated) {
        const removed = await runCommand('docker', [...dockerEndpointCommandArgsV3(
          dockerEndpoint,
          ['container', 'rm', '--force', containerId ?? containerName]
        )], {
          cwd: repositoryRoot,
          envMode: 'replace',
          env: createTrustedRuntimeHostCommandEnvironmentV1('docker'),
          timeoutMs: 120_000,
          maxStdoutBytes: 1024 * 1024,
          maxStderrBytes: 1024 * 1024
        });
        if (removed.code !== 0) fail(`container cleanup failed and ${containerName} was retained`);
      }
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } finally {
    try {
      await operationLeaseAuthority.assertCurrent();
    } finally {
      operationLease.release();
    }
  }
}

export async function executeTrustedRuntimeContainerVerificationV1(input: Readonly<{
  repositoryRoot: string;
  envelope: VerificationSessionHostedEnvelopeV1;
  actorNodeId: string;
  requiredBlobs: readonly Readonly<{ path: string; digest: Digest }>[];
}>): Promise<Readonly<{
  evidence: CodexDevelopmentVerificationEvidenceV4;
  canonicalEvidenceBytes: string;
  receipt: TrustedRuntimeContainerReceiptV1;
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const session = input.envelope.session;
  sha(session.baseSha, 'baseSha');
  sha(session.headSha, 'headSha');
  sha(session.headTreeSha, 'headTreeSha');
  return await withTrustedRuntimeWorkspaceV1({
    repositoryRoot,
    repository: session.repository,
    baseSha: session.baseSha,
    headSha: session.headSha,
    operationKey: `session-${session.sessionRevision.slice(7, 31)}`,
    execute: async ({ containerName, temporaryRoot, image, dockerEndpoint }) => {
      const outputPath = path.join(temporaryRoot, 'verification-evidence.json');
      const executionId = `trusted-runtime-${digestValue(Object.freeze({
        sessionRevision: session.sessionRevision,
        imageId: image.imageId,
        dockerEndpoint
      })).slice(7, 31)}`;
    await command('docker', [
      'container', 'exec', '--user', '1000:1000', '--workdir', '/workspace',
      ...formalEnvironment({ envelope: input.envelope, executionId,
        actorNodeId: input.actorNodeId, requiredBlobs: input.requiredBlobs }),
      containerName,
      'bun', '/trusted/scripts/ci-verification.ts',
      '--profile', session.profile, '--expected-head', session.headSha
    ], repositoryRoot, 4 * 60 * 60_000, dockerEndpoint);
    await command('docker', ['container', 'cp',
      `${containerName}:/output/verification-evidence.json`, outputPath], repositoryRoot, 120_000, dockerEndpoint);
    const canonicalEvidenceBytes = readFileSync(outputPath, 'utf8');
    const parsed = JSON.parse(canonicalEvidenceBytes) as CodexDevelopmentVerificationEvidenceV4;
    if (canonicalEvidenceBytes !== `${encodeVerificationActionDataV2(parsed)}\n`) {
      fail('verification Evidence durable bytes are not canonical');
    }
    if (parsed.status !== 'passed' || parsed.sessionRevision !== session.sessionRevision
        || parsed.baseSha !== session.baseSha || parsed.headSha !== session.headSha
        || parsed.headTreeSha !== session.headTreeSha
        || parsed.actionPlan.actionPlanDigest !== input.envelope.actionPlanClosure.actionPlanDigest
        || parsed.producer.sourceTransport !== 'local-dev-runner'
        || parsed.producer.workflowPath !== 'scripts/ci-verification.ts'
        || parsed.producer.workflowSha !== session.baseSha
        || parsed.producer.runId !== executionId
        || parsed.producer.actorNodeId !== input.actorNodeId) {
      fail('verification Evidence does not bind the trusted runtime Session');
    }
    await assertDockerEndpointIdentityV3(dockerEndpoint, repositoryRoot);
    const receipt = createReceipt({
      executionId,
      sessionRevision: digest(session.sessionRevision, 'sessionRevision'),
      baseSha: session.baseSha,
      headSha: session.headSha,
      headTreeSha: session.headTreeSha,
      imageId: image.imageId,
      dockerEndpoint,
      networkIsolatedBeforeSut: true,
      evidenceByteDigest: digestBytes(canonicalEvidenceBytes),
      evidenceByteLength: Buffer.byteLength(canonicalEvidenceBytes, 'utf8'),
      evidenceDigest: digest(parsed.evidenceDigest, 'evidenceDigest'),
      producerSourceDigest: digest(parsed.producer.sourceDigest, 'producer.sourceDigest')
    });
    return Object.freeze({ evidence: parsed, canonicalEvidenceBytes, receipt });
    }
  });
}

export async function executeTrustedRuntimeMainHealthV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now?: () => Date;
}>): Promise<TrustedRuntimeMainHealthReceiptV1> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const mainSha = sha(input.mainSha, 'MainHealth mainSha');
  const mainTreeSha = sha(input.mainTreeSha, 'MainHealth mainTreeSha');
  const repositoryIdentity = repository(input.repository);
  return await withTrustedRuntimeWorkspaceV1({
    repositoryRoot,
    repository: repositoryIdentity,
    baseSha: mainSha,
    headSha: mainSha,
    operationKey: `main-${mainSha.slice(0, 24)}`,
    execute: async ({ containerName, image, dockerEndpoint }) => {
      const observedTree = await command('docker', [
        'container', 'exec', '--user', '1000:1000', '--workdir', '/workspace',
        containerName, 'git', 'rev-parse', 'HEAD^{tree}'
      ], repositoryRoot, 120_000, dockerEndpoint);
      if (observedTree !== mainTreeSha) fail('MainHealth exact main tree differs before execution');
      const commandResultDigests: Digest[] = [];
      for (const argv of TRUSTED_RUNTIME_MAIN_HEALTH_COMMANDS_V1) {
        const result = await commandResult('docker', [
          'container', 'exec', '--user', '1000:1000', '--workdir', '/workspace',
          '--env', 'CI=1', '--env', 'HOME=/home/ubuntu', '--env', 'LANG=C',
          '--env', 'LC_ALL=C', '--env', 'TZ=UTC', '--env', 'GIT_CONFIG_NOSYSTEM=1',
          '--env', 'GIT_CONFIG_GLOBAL=/dev/null', '--env', 'GIT_TERMINAL_PROMPT=0',
          containerName, ...argv
        ], repositoryRoot, 4 * 60 * 60_000, dockerEndpoint);
        commandResultDigests.push(digestValue(Object.freeze({
          argv,
          exitCode: result.code,
          stdout: result.stdout,
          stderr: result.stderr
        })));
      }
      const finalIdentity = await command('docker', [
        'container', 'exec', '--user', '1000:1000', '--workdir', '/workspace',
        containerName, 'git', 'status', '--porcelain=v1', '--untracked-files=all'
      ], repositoryRoot, 120_000, dockerEndpoint);
      const finalHead = await command('docker', [
        'container', 'exec', '--user', '1000:1000', '--workdir', '/workspace',
        containerName, 'git', 'rev-parse', 'HEAD'
      ], repositoryRoot, 120_000, dockerEndpoint);
      const finalTree = await command('docker', [
        'container', 'exec', '--user', '1000:1000', '--workdir', '/workspace',
        containerName, 'git', 'rev-parse', 'HEAD^{tree}'
      ], repositoryRoot, 120_000, dockerEndpoint);
      if (finalIdentity !== '' || finalHead !== mainSha || finalTree !== mainTreeSha) {
        fail('MainHealth exact main identity or clean state changed during execution');
      }
      await assertDockerEndpointIdentityV3(dockerEndpoint, repositoryRoot);
      const executionId = `trusted-main-health-${digestValue(Object.freeze({
        repository: repositoryIdentity,
        mainSha,
        mainTreeSha,
        imageId: image.imageId,
        dockerEndpoint,
        planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1
      })).slice(7, 31)}`;
      return createTrustedRuntimeMainHealthReceiptV1({
        origin: 'physical-main',
        repository: repositoryIdentity,
        mainSha,
        mainTreeSha,
        executionId,
        imageId: image.imageId,
        dockerEndpoint,
        networkIsolatedBeforeExecution: true,
        planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
        commandResultDigests,
        transition: null,
        observedAt: (input.now ?? (() => new Date()))().toISOString()
      });
    }
  });
}

const TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES_V2 = Object.freeze([
  'tcb-lock-pre.json',
  'imports.log',
  'docs-doctor.log',
  'typecheck.log',
  'diff-check.log',
  'focused-tests.log',
  'repository-audit.json',
  'affected-plan.json',
  'affected-tests.log',
  'tcb-lock-post.json'
] as const);

function exactRecord(value: unknown, expected: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail(`${label} fields are unknown or missing`);
  }
  return record;
}

function parseTrustedBootstrapSutReceiptV2(value: unknown): Readonly<{
  baseSha: string;
  headSha: string;
  treeSha: string;
  bootstrapDigest: Digest;
  sandboxPolicyDigest: Digest;
  commandPlanDigest: Digest;
  evidenceSetDigest: Digest;
  receiptDigest: Digest;
}> {
  const record = exactRecord(value, [
    'schema', 'baseSha', 'headSha', 'treeSha', 'parentSha', 'auxiliaryStatus',
    'evidenceSetDigest', 'bootstrapDigest', 'sandboxPolicyDigest', 'commandPlanDigest',
    'archiveDigest', 'archiveInventoryDigest', 'executionOutputDigest',
    'residueReadbackDigest', 'receiptDigest'
  ], 'trusted bootstrap SUT receipt');
  const baseSha = sha(record.baseSha, 'bootstrap SUT baseSha');
  const headSha = sha(record.headSha, 'bootstrap SUT headSha');
  const treeSha = sha(record.treeSha, 'bootstrap SUT treeSha');
  const semantic = Object.freeze({
    schema: record.schema,
    baseSha,
    headSha,
    treeSha,
    parentSha: sha(record.parentSha, 'bootstrap SUT parentSha'),
    auxiliaryStatus: record.auxiliaryStatus,
    evidenceSetDigest: digest(record.evidenceSetDigest, 'bootstrap SUT evidenceSetDigest'),
    bootstrapDigest: digest(record.bootstrapDigest, 'bootstrap SUT bootstrapDigest'),
    sandboxPolicyDigest: digest(record.sandboxPolicyDigest, 'bootstrap SUT sandboxPolicyDigest'),
    commandPlanDigest: digest(record.commandPlanDigest, 'bootstrap SUT commandPlanDigest'),
    archiveDigest: digest(record.archiveDigest, 'bootstrap SUT archiveDigest'),
    archiveInventoryDigest: digest(record.archiveInventoryDigest, 'bootstrap SUT archiveInventoryDigest'),
    executionOutputDigest: digest(record.executionOutputDigest, 'bootstrap SUT executionOutputDigest'),
    residueReadbackDigest: digest(record.residueReadbackDigest, 'bootstrap SUT residueReadbackDigest')
  });
  if (semantic.schema !== 'sec-trusted-bootstrap-sut-receipt-v2'
      || semantic.auxiliaryStatus !== 'passed'
      || semantic.parentSha !== baseSha
      || digest(record.receiptDigest, 'bootstrap SUT receiptDigest')
        !== digestBytes(JSON.stringify(semantic))) {
    fail('trusted bootstrap SUT receipt is not one passing exact-base receipt');
  }
  return Object.freeze({
    baseSha,
    headSha,
    treeSha,
    bootstrapDigest: semantic.bootstrapDigest,
    sandboxPolicyDigest: semantic.sandboxPolicyDigest,
    commandPlanDigest: semantic.commandPlanDigest,
    evidenceSetDigest: semantic.evidenceSetDigest,
    receiptDigest: record.receiptDigest as Digest
  });
}

export function createTrustedRuntimeBootstrapRepairReceiptV1(input: Omit<
  TrustedRuntimeBootstrapRepairReceiptV1,
  'schema' | 'receiptDigest'
>): TrustedRuntimeBootstrapRepairReceiptV1 {
  if (input.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
      || input.candidateNetworkIsolatedDuringExecution !== true
      || input.containerProfileDigest !== TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_PROFILE_DIGEST_V1) {
    fail('bootstrap repair receipt fixed runtime identity is invalid');
  }
  const manifestPath = bounded(input.manifestPath, 'bootstrap repair manifestPath');
  if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]{1,1024}$/u.test(manifestPath)) {
    fail('bootstrap repair manifestPath is invalid');
  }
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_RECEIPT_SCHEMA_V1,
    repository: repository(input.repository),
    baseSha: sha(input.baseSha, 'bootstrap repair baseSha'),
    baseTreeSha: sha(input.baseTreeSha, 'bootstrap repair baseTreeSha'),
    headSha: sha(input.headSha, 'bootstrap repair headSha'),
    headTreeSha: sha(input.headTreeSha, 'bootstrap repair headTreeSha'),
    manifestPath,
    executionId: bounded(input.executionId, 'bootstrap repair executionId'),
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    dockerEndpoint: parseDockerEndpointIdentityV3(input.dockerEndpoint),
    candidateNetworkIsolatedDuringExecution: true as const,
    containerProfileDigest: TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_PROFILE_DIGEST_V1,
    dependencyCacheKey: digest(input.dependencyCacheKey, 'bootstrap repair dependencyCacheKey'),
    dependencyCacheMarkerFileDigest: digest(
      input.dependencyCacheMarkerFileDigest,
      'bootstrap repair dependencyCacheMarkerFileDigest'
    ),
    dependencyCacheVolumeObservationDigest: digest(
      input.dependencyCacheVolumeObservationDigest,
      'bootstrap repair dependencyCacheVolumeObservationDigest'
    ),
    trustedProgramBlobSha: sha(input.trustedProgramBlobSha, 'bootstrap repair trustedProgramBlobSha'),
    bootstrapDigest: digest(input.bootstrapDigest, 'bootstrap repair bootstrapDigest'),
    sandboxPolicyDigest: digest(input.sandboxPolicyDigest, 'bootstrap repair sandboxPolicyDigest'),
    commandPlanDigest: digest(input.commandPlanDigest, 'bootstrap repair commandPlanDigest'),
    evidenceSetDigest: digest(input.evidenceSetDigest, 'bootstrap repair evidenceSetDigest'),
    sutReceiptDigest: digest(input.sutReceiptDigest, 'bootstrap repair sutReceiptDigest')
  });
  return Object.freeze({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
}

export function parseTrustedRuntimeBootstrapRepairReceiptV1(
  value: unknown
): TrustedRuntimeBootstrapRepairReceiptV1 {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      fail('bootstrap repair receipt is not JSON');
    }
  }
  const record = exactRecord(value, [
    'schema', 'repository', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha',
    'manifestPath', 'executionId', 'imageId', 'dockerEndpoint',
    'candidateNetworkIsolatedDuringExecution', 'containerProfileDigest', 'trustedProgramBlobSha',
    'dependencyCacheKey', 'dependencyCacheMarkerFileDigest',
    'dependencyCacheVolumeObservationDigest',
    'bootstrapDigest', 'sandboxPolicyDigest', 'commandPlanDigest', 'evidenceSetDigest',
    'sutReceiptDigest', 'receiptDigest'
  ], 'bootstrap repair receipt');
  if (record.schema !== TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_RECEIPT_SCHEMA_V1) {
    fail('bootstrap repair receipt schema is invalid');
  }
  const rebuilt = createTrustedRuntimeBootstrapRepairReceiptV1({
    repository: record.repository as string,
    baseSha: record.baseSha as string,
    baseTreeSha: record.baseTreeSha as string,
    headSha: record.headSha as string,
    headTreeSha: record.headTreeSha as string,
    manifestPath: record.manifestPath as string,
    executionId: record.executionId as string,
    imageId: record.imageId as typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    dockerEndpoint: record.dockerEndpoint as DockerEndpointIdentityV3,
    candidateNetworkIsolatedDuringExecution: record.candidateNetworkIsolatedDuringExecution as true,
    containerProfileDigest: record.containerProfileDigest as typeof TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_PROFILE_DIGEST_V1,
    dependencyCacheKey: record.dependencyCacheKey as Digest,
    dependencyCacheMarkerFileDigest: record.dependencyCacheMarkerFileDigest as Digest,
    dependencyCacheVolumeObservationDigest:
      record.dependencyCacheVolumeObservationDigest as Digest,
    trustedProgramBlobSha: record.trustedProgramBlobSha as string,
    bootstrapDigest: record.bootstrapDigest as Digest,
    sandboxPolicyDigest: record.sandboxPolicyDigest as Digest,
    commandPlanDigest: record.commandPlanDigest as Digest,
    evidenceSetDigest: record.evidenceSetDigest as Digest,
    sutReceiptDigest: record.sutReceiptDigest as Digest
  });
  if (rebuilt.receiptDigest !== digest(record.receiptDigest, 'bootstrap repair receiptDigest')) {
    fail('bootstrap repair receipt digest mismatch');
  }
  return rebuilt;
}

export async function executeTrustedRuntimeBootstrapRepairV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
}>): Promise<TrustedRuntimeBootstrapRepairReceiptV1> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const baseSha = sha(input.baseSha, 'bootstrap repair baseSha');
  const baseTreeSha = sha(input.baseTreeSha, 'bootstrap repair baseTreeSha');
  const headSha = sha(input.headSha, 'bootstrap repair headSha');
  const headTreeSha = sha(input.headTreeSha, 'bootstrap repair headTreeSha');
  const repositoryIdentity = repository(input.repository);
  return await withTrustedRuntimeWorkspaceV1({
    repositoryRoot,
    repository: repositoryIdentity,
    baseSha,
    headSha,
    operationKey: `bootstrap-${headSha.slice(0, 24)}`,
    profile: TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair,
    execute: async ({
      containerName,
      temporaryRoot,
      image,
      dockerEndpoint,
      dependencyCacheKey,
      dependencyCacheMarkerFileDigest,
      dependencyCacheVolumeObservationDigest
    }) => {
      const observed = await command('docker', [
        'container', 'exec', '--workdir', '/trusted', containerName,
        '/bin/bash', '-ceu',
        '[ "$(git -C /trusted rev-parse HEAD^{tree})" = "$1" ] && [ "$(git -C /workspace rev-parse HEAD^{tree})" = "$2" ]',
        '--', baseTreeSha, headTreeSha
      ], repositoryRoot, 120_000, dockerEndpoint);
      if (observed !== '') fail('bootstrap repair identity preflight produced unexpected output');
      await command('docker', [
        'container', 'exec', '--workdir', '/trusted',
        '--env', 'CI=1', '--env', 'HOME=/home/ubuntu', '--env', 'LANG=C',
        '--env', 'LC_ALL=C', '--env', 'TZ=UTC', '--env', 'GIT_CONFIG_NOSYSTEM=1',
        '--env', 'GIT_CONFIG_GLOBAL=/dev/null', '--env', 'GIT_TERMINAL_PROMPT=0',
        containerName,
        'bun', '/trusted/scripts/ci-verification.ts', 'execute-trusted-bootstrap-sut',
        '--base-root', '/trusted', '--candidate-root', '/workspace',
        '--output-directory', '/output/bootstrap', '--base-sha', baseSha,
        '--head-sha', headSha, '--tree-sha', headTreeSha,
        '--manifest-path', input.manifestPath
      ], repositoryRoot, 4 * 60 * 60_000, dockerEndpoint);
      const evidenceRoot = path.join(temporaryRoot, 'bootstrap-evidence');
      await command('docker', [
        'container', 'cp', `${containerName}:/output/bootstrap`, evidenceRoot
      ], repositoryRoot, 120_000, dockerEndpoint);
      const actualFiles = readdirSync(evidenceRoot).sort();
      const expectedFiles = [...TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES_V2, 'SHA256SUMS', 'sut-receipt.json'].sort();
      if (encodeVerificationActionDataV2(actualFiles) !== encodeVerificationActionDataV2(expectedFiles)) {
        fail('bootstrap repair evidence file closure is invalid');
      }
      const sumsSource = readFileSync(path.join(evidenceRoot, 'SHA256SUMS'), 'utf8');
      const expectedSums = TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES_V2.map((fileName) =>
        `${createHash('sha256').update(readFileSync(path.join(evidenceRoot, fileName))).digest('hex')}  ${fileName}`
      ).join('\n') + '\n';
      if (sumsSource !== expectedSums) fail('bootstrap repair evidence digest inventory is invalid');
      const sutReceipt = parseTrustedBootstrapSutReceiptV2(
        JSON.parse(readFileSync(path.join(evidenceRoot, 'sut-receipt.json'), 'utf8')) as unknown
      );
      if (sutReceipt.baseSha !== baseSha || sutReceipt.headSha !== headSha
          || sutReceipt.treeSha !== headTreeSha
          || sutReceipt.evidenceSetDigest !== digestBytes(sumsSource)) {
        fail('bootstrap repair SUT receipt differs from the exact candidate or evidence set');
      }
      const finalIdentity = await command('docker', [
        'container', 'exec', '--workdir', '/workspace', containerName,
        '/bin/bash', '-ceu',
        '[ -z "$(git status --porcelain=v1 --untracked-files=all)" ] && [ "$(git rev-parse HEAD)" = "$1" ] && [ "$(git rev-parse HEAD^{tree})" = "$2" ]',
        '--', headSha, headTreeSha
      ], repositoryRoot, 120_000, dockerEndpoint);
      if (finalIdentity !== '') fail('bootstrap repair final identity produced unexpected output');
      const trustedProgramBlobSha = await command('git', [
        'rev-parse', `${baseSha}:scripts/ci-verification.ts`
      ], repositoryRoot);
      await assertDockerEndpointIdentityV3(dockerEndpoint, repositoryRoot);
      return createTrustedRuntimeBootstrapRepairReceiptV1({
        repository: repositoryIdentity,
        baseSha,
        baseTreeSha,
        headSha,
        headTreeSha,
        manifestPath: input.manifestPath,
        executionId: `trusted-bootstrap-${sutReceipt.bootstrapDigest.slice(7, 31)}`,
        imageId: image.imageId,
        dockerEndpoint,
        candidateNetworkIsolatedDuringExecution: true,
        containerProfileDigest: TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_PROFILE_DIGEST_V1,
        dependencyCacheKey,
        dependencyCacheMarkerFileDigest,
        dependencyCacheVolumeObservationDigest,
        trustedProgramBlobSha,
        bootstrapDigest: sutReceipt.bootstrapDigest,
        sandboxPolicyDigest: sutReceipt.sandboxPolicyDigest,
        commandPlanDigest: sutReceipt.commandPlanDigest,
        evidenceSetDigest: sutReceipt.evidenceSetDigest,
        sutReceiptDigest: sutReceipt.receiptDigest
      });
    }
  });
}
