import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1 } from '../../platform/shared/ci-verification-revision.ts';
import {
  createNoFollowDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowOrdinaryFileEntryV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';

export const LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3 =
  'sec-local-github-actions-provider-state-v3' as const;
export const LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_SCHEMA_V3 =
  'sec-local-github-actions-provider-ledger-v3' as const;
export const LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1 = '2.336.0' as const;
export const LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1 =
  '04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d' as const;
export const LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1 =
  'ubuntu@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea' as const;
export const LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1 = '24.19.0' as const;
export const LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1 =
  '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647' as const;
export const LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1 = '3.12.3' as const;
export const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2 =
  'trust-domains-node24-python312-v6' as const;
export const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1 =
  `sec-actions-runner:${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1}-${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2}` as const;
// Frozen after the canonical Dockerfile is built once. Rebuilding mutable apt
// inputs under the same semantic provider revision must fail this identity.
export const LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2 =
  'sha256:6ec6d4c46a92a8b9c64e33c3c864b0f817c296725b4a617f2c0e2aae9b40060e' as const;
export const LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3 = Object.freeze([
  Object.freeze({
    imageId: 'sha256:60d1c338f85133d997cc2fb3b0353d79a52fc297e84188963e3e9c2cf98cf209',
    imageTag: 'sec-actions-runner:2.336.0-trust-domains-node24-python312-v4',
    replacementImageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    decision: 'superseded-by-trust-domains-node24-python312-v6'
  }),
  Object.freeze({
    imageId: 'sha256:2fce0e62d0db84341fb2c76f4038879fbfceaf9babcb167c61b93f6b76ae906a',
    imageTag: 'sec-actions-runner:2.336.0-trust-domains-node24-v3',
    replacementImageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    decision: 'superseded-by-trust-domains-node24-python312-v6'
  })
] as const);
export const LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1 = Object.freeze([
  'self-hosted',
  'Linux',
  'X64',
  'sec-linux-verification-v1'
] as const);
export const LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1 =
  LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1[3];
export const LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2 = Object.freeze({
  control: 'sec-linux-verification-control-v1',
  trusted: 'sec-linux-verification-trusted-v1',
  sut: 'sec-linux-verification-sut-v1'
} as const);
export type LocalGitHubActionsRunnerRoleV2 = keyof typeof LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2;
const LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2 = Object.freeze([
  'control', 'trusted', 'sut'
] as const satisfies readonly LocalGitHubActionsRunnerRoleV2[]);
export const LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3 =
  'refs/tags/sec-provider-lease-sec-linux-verification-v1' as const;
export const LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3 = 'github.com' as const;

const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_CPUS = 8;
const DEFAULT_MEMORY = '12g';
const SUT_CPUS = 2;
const SUT_MEMORY = '4g';
const SUT_PIDS = 256;
const SUT_CAPABILITIES = CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outerSutContainerCapabilities;

export interface LocalGitHubActionsRunnerInstanceV2 {
  readonly role: LocalGitHubActionsRunnerRoleV2;
  readonly roleLabel: string;
  readonly name: string;
  readonly runnerId: number;
  readonly containerId: string;
  readonly containerName: string;
}

export interface DockerEndpointIdentityV3 {
  readonly schema: 'sec-docker-endpoint-identity-v1';
  readonly contextName: string;
  readonly endpointHost: string;
  readonly daemonId: string;
  readonly osType: 'linux';
  readonly architecture: 'x86_64';
}

export interface GitHubEndpointIdentityV3 {
  readonly schema: 'sec-github-api-endpoint-identity-v1';
  readonly host: typeof LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3;
  readonly repository: string;
  readonly principal: string;
}

export type LocalGitHubActionsProviderLifecycleV3 =
  | 'provisioning'
  | 'active'
  | 'teardown'
  | 'terminal';

export type LocalGitHubActionsProviderResourceStateV3 = 'uncreated' | 'present' | 'absent';

export interface LocalGitHubActionsProviderLedgerInstanceV3 {
  readonly role: LocalGitHubActionsRunnerRoleV2;
  readonly roleLabel: string;
  readonly name: string;
  readonly containerId: string | null;
  readonly containerState: LocalGitHubActionsProviderResourceStateV3;
  readonly runnerId: number | null;
  readonly runnerState: LocalGitHubActionsProviderResourceStateV3;
}

export interface LocalGitHubActionsProviderLedgerV3 {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_SCHEMA_V3;
  readonly repository: string;
  readonly providerName: string;
  readonly profileLabel: typeof LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1;
  readonly operationLabel: string;
  readonly expectedMainSha: string;
  readonly createdAt: string;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly githubEndpoint: GitHubEndpointIdentityV3;
  readonly imageId: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2;
  readonly lifecycle: LocalGitHubActionsProviderLifecycleV3;
  readonly generation: number;
  readonly predecessorObjectSha: string | null;
  readonly instances: readonly LocalGitHubActionsProviderLedgerInstanceV3[];
  readonly ledgerDigest: `sha256:${string}`;
}

export interface LocalGitHubActionsRunnerStateV3 {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3;
  readonly repository: string;
  readonly repositoryRoot: string;
  readonly commonDirectory: string;
  readonly providerName: string;
  readonly operationLabel: string;
  readonly providerLedgerRef: typeof LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3;
  readonly providerLedgerObjectSha: string;
  readonly providerLedgerDigest: `sha256:${string}`;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly githubEndpoint: GitHubEndpointIdentityV3;
  readonly image: typeof LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1;
  readonly imageId: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2;
  readonly runnerVersion: typeof LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1;
  readonly runnerArchiveSha256: typeof LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1;
  readonly baseImage: typeof LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1;
  readonly nodeVersion: typeof LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1;
  readonly nodeArchiveSha256: typeof LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1;
  readonly labels: typeof LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1;
  readonly roleLabels: typeof LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2;
  readonly instances: readonly LocalGitHubActionsRunnerInstanceV2[];
  readonly startedAt: string;
  readonly stateDigest: `sha256:${string}`;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

interface GitHubApiSessionV3 {
  readonly token: string;
  readonly principal: string;
}

const githubApiSessionsV3 = new Map<string, GitHubApiSessionV3>();

const COMMAND_ENV_KEYS = Object.freeze({
  docker: Object.freeze([
    'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'HOME', 'PATH',
    'SYSTEMROOT', 'USERPROFILE', 'WINDIR'
  ]),
  gh: Object.freeze([
    'APPDATA', 'GH_CONFIG_DIR', 'GH_TOKEN', 'GITHUB_TOKEN', 'HOME',
    'LOCALAPPDATA', 'PATH', 'SYSTEMROOT', 'USERPROFILE', 'WINDIR', 'XDG_CONFIG_HOME'
  ]),
  git: Object.freeze([
    'HOME', 'PATH', 'SYSTEMROOT', 'USERPROFILE', 'WINDIR', 'XDG_CONFIG_HOME'
  ])
} satisfies Record<'docker' | 'gh' | 'git', readonly string[]>);

function commandEnvironment(command: keyof typeof COMMAND_ENV_KEYS): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of COMMAND_ENV_KEYS[command]) {
    const actualKey = Object.keys(process.env).find((candidate) =>
      candidate.toUpperCase() === key);
    if (actualKey !== undefined && process.env[actualKey] !== undefined) {
      environment[actualKey] = process.env[actualKey];
    }
  }
  return environment;
}

function fail(message: string): never {
  throw new Error(`Local GitHub Actions runner: ${message}`);
}

function boundedText(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || /[\u0000-\u001f]/u.test(value)) {
    fail(`${label} must be bounded non-control text`);
  }
  return value;
}

function repositoryName(value: unknown): string {
  const result = boundedText(value, 'repository', 200);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result)) {
    fail('repository must be owner/name');
  }
  return result;
}

function runnerName(value: unknown): string {
  const result = boundedText(value, 'runner name', 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(result)) {
    fail('runner name is invalid');
  }
  return result;
}

// GitHub limits the final runner name to 100 characters. Provider names are
// persisted before the role suffix is selected, so reserve the longest
// `-control` / `-trusted` suffix here instead of publishing an unrecoverable
// lease and failing later while constructing an instance name.
function providerBaseName(value: unknown): string {
  const result = boundedText(value, 'provider name', 92);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(result)) {
    fail('provider name is invalid');
  }
  return result;
}

function operationLabel(value: unknown): string {
  const result = boundedText(value, 'operation label', 100);
  if (!/^sec-operation-[0-9a-f]{64}$/u.test(result)) {
    fail('operation label is invalid');
  }
  return result;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys are invalid`);
  }
}

function stateMaterial(input: Omit<LocalGitHubActionsRunnerStateV3, 'stateDigest'>) {
  return Object.freeze({ ...input });
}

function runnerRole(value: unknown): LocalGitHubActionsRunnerRoleV2 {
  if (value !== 'control' && value !== 'trusted' && value !== 'sut') fail('runner role is invalid');
  return value;
}

function runnerInstance(input: LocalGitHubActionsRunnerInstanceV2): LocalGitHubActionsRunnerInstanceV2 {
  const role = runnerRole(input.role);
  if (input.roleLabel !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2[role]) {
    fail('runner role label is invalid');
  }
  if (!Number.isSafeInteger(input.runnerId) || input.runnerId <= 0) fail('runnerId is invalid');
  if (!/^[0-9a-f]{64}$/u.test(input.containerId)) fail('containerId is invalid');
  return Object.freeze({
    role,
    roleLabel: input.roleLabel,
    name: runnerName(input.name),
    runnerId: input.runnerId,
    containerId: input.containerId,
    containerName: runnerName(input.containerName)
  });
}

function githubPrincipal(value: unknown): string {
  const result = boundedText(value, 'GitHub principal', 100);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(result)) fail('GitHub principal is invalid');
  return result;
}

function dockerContextName(value: unknown): string {
  const result = boundedText(value, 'Docker context name', 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(result)) fail('Docker context name is invalid');
  return result;
}

function dockerEndpointHost(value: unknown): string {
  const result = boundedText(value, 'Docker endpoint host', 1024);
  if (!/^(?:npipe|unix):\/\//u.test(result)) {
    fail('Docker endpoint host must be a local npipe or unix transport');
  }
  return result;
}

function dockerDaemonId(value: unknown): string {
  const result = boundedText(value, 'Docker daemon ID', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(result)) fail('Docker daemon ID is invalid');
  return result;
}

function dockerEndpointIdentity(input: DockerEndpointIdentityV3): DockerEndpointIdentityV3 {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('Docker endpoint identity is invalid');
  }
  exactKeys(input as unknown as Record<string, unknown>, [
    'schema', 'contextName', 'endpointHost', 'daemonId', 'osType', 'architecture'
  ], 'Docker endpoint identity');
  if (input.schema !== 'sec-docker-endpoint-identity-v1'
      || input.osType !== 'linux' || input.architecture !== 'x86_64') {
    fail('Docker endpoint capability identity is invalid');
  }
  return Object.freeze({
    schema: 'sec-docker-endpoint-identity-v1' as const,
    contextName: dockerContextName(input.contextName),
    endpointHost: dockerEndpointHost(input.endpointHost),
    daemonId: dockerDaemonId(input.daemonId),
    osType: 'linux' as const,
    architecture: 'x86_64' as const
  });
}

function githubEndpointIdentity(input: GitHubEndpointIdentityV3): GitHubEndpointIdentityV3 {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('GitHub endpoint identity is invalid');
  }
  exactKeys(input as unknown as Record<string, unknown>, [
    'schema', 'host', 'repository', 'principal'
  ], 'GitHub endpoint identity');
  if (input.schema !== 'sec-github-api-endpoint-identity-v1'
      || input.host !== LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3) {
    fail('GitHub endpoint capability identity is invalid');
  }
  return Object.freeze({
    schema: 'sec-github-api-endpoint-identity-v1' as const,
    host: LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3,
    repository: repositoryName(input.repository),
    principal: githubPrincipal(input.principal)
  });
}

export function createLocalGitHubActionsRunnerStateV3(
  input: Omit<LocalGitHubActionsRunnerStateV3, 'schema' | 'image' | 'imageId' | 'runnerVersion'
    | 'runnerArchiveSha256' | 'baseImage' | 'nodeVersion' | 'nodeArchiveSha256'
    | 'labels' | 'roleLabels' | 'stateDigest'>
): LocalGitHubActionsRunnerStateV3 {
  const startedAt = new Date(input.startedAt).toISOString();
  if (startedAt !== input.startedAt) fail('startedAt must be a canonical ISO instant');
  if (!/^[0-9a-f]{40}$/u.test(input.providerLedgerObjectSha)) fail('provider ledger object SHA is invalid');
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.providerLedgerDigest)) fail('provider ledger digest is invalid');
  const instances = input.instances.map(runnerInstance);
  if (instances.length !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.length
      || LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.some((role, index) => instances[index]?.role !== role)
      || new Set(instances.map(({ name }) => name)).size !== instances.length
      || new Set(instances.map(({ runnerId }) => runnerId)).size !== instances.length
      || new Set(instances.map(({ containerId }) => containerId)).size !== instances.length) {
    fail('runner instances must be one ordered unique instance per trust role');
  }
  const material = stateMaterial({
    schema: LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3,
    repository: repositoryName(input.repository),
    repositoryRoot: path.resolve(boundedText(input.repositoryRoot, 'repositoryRoot', 4096)),
    commonDirectory: path.resolve(boundedText(input.commonDirectory, 'commonDirectory', 4096)),
    providerName: providerBaseName(input.providerName),
    operationLabel: operationLabel(input.operationLabel),
    providerLedgerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
    providerLedgerObjectSha: input.providerLedgerObjectSha,
    providerLedgerDigest: input.providerLedgerDigest,
    dockerEndpoint: dockerEndpointIdentity(input.dockerEndpoint),
    githubEndpoint: githubEndpointIdentity(input.githubEndpoint),
    image: LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1,
    imageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    runnerVersion: LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1,
    runnerArchiveSha256: LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1,
    baseImage: LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1,
    nodeVersion: LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1,
    nodeArchiveSha256: LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1,
    labels: LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1,
    roleLabels: LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2,
    instances: Object.freeze(instances),
    startedAt
  });
  return Object.freeze({
    ...material,
    stateDigest: sha256(material) as `sha256:${string}`
  });
}

export function parseLocalGitHubActionsRunnerStateV3(source: string): LocalGitHubActionsRunnerStateV3 {
  const parsed = JSON.parse(source) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('state must be an object');
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'repository', 'repositoryRoot', 'commonDirectory', 'providerName', 'operationLabel',
    'providerLedgerRef', 'providerLedgerObjectSha', 'providerLedgerDigest',
    'dockerEndpoint', 'githubEndpoint', 'image', 'imageId', 'runnerVersion',
    'runnerArchiveSha256', 'baseImage', 'nodeVersion', 'nodeArchiveSha256',
    'labels', 'roleLabels', 'instances', 'startedAt', 'stateDigest'
  ], 'state');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3
      || value.image !== LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1
      || value.imageId !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2
      || value.runnerVersion !== LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1
      || value.runnerArchiveSha256 !== LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1
      || value.baseImage !== LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1
      || value.nodeVersion !== LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1
      || value.nodeArchiveSha256 !== LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1
      || !Array.isArray(value.labels)
      || value.labels.length !== LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1.length
      || value.labels.some((label, index) => label !== LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1[index])
      || value.providerLedgerRef !== LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3
      || JSON.stringify(value.roleLabels) !== JSON.stringify(LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2)
      || !Array.isArray(value.instances)) {
    fail('state capability identity is invalid');
  }
  const recreated = createLocalGitHubActionsRunnerStateV3({
    repository: value.repository as string,
    repositoryRoot: value.repositoryRoot as string,
    commonDirectory: value.commonDirectory as string,
    providerName: value.providerName as string,
    operationLabel: value.operationLabel as string,
    providerLedgerRef: value.providerLedgerRef as typeof LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
    providerLedgerObjectSha: value.providerLedgerObjectSha as string,
    providerLedgerDigest: value.providerLedgerDigest as `sha256:${string}`,
    dockerEndpoint: value.dockerEndpoint as DockerEndpointIdentityV3,
    githubEndpoint: value.githubEndpoint as GitHubEndpointIdentityV3,
    instances: value.instances as LocalGitHubActionsRunnerInstanceV2[],
    startedAt: value.startedAt as string
  });
  if (recreated.stateDigest !== value.stateDigest) fail('state digest mismatch');
  return recreated;
}

export function createLocalGitHubActionsRunnerDockerfileV1(): string {
  return `FROM ${LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1}\n`
    + 'ARG DEBIAN_FRONTEND=noninteractive\n'
    + 'RUN apt-get -o Acquire::Retries=5 update '
    + '&& apt-get -o Acquire::Retries=5 install -y --no-install-recommends '
    + 'ca-certificates curl git jq python3 xz-utils libicu74 libssl3 libkrb5-3 zlib1g '
    + 'libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 '
    + 'libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 '
    + 'libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 '
    + 'libxkbcommon0 libxrandr2 '
    + `&& test "$(python3 --version)" = "Python ${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1}" `
    + '&& python3 -c "import hashlib,json,tarfile" '
    + '&& rm -rf /var/lib/apt/lists/*\n'
    + `RUN curl --fail --location --proto '=https' --tlsv1.2 --retry 3 `
    + `https://nodejs.org/dist/v${LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1}/`
    + `node-v${LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1}-linux-x64.tar.xz -o node.tar.xz `
    + `&& echo '${LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1}  node.tar.xz' | sha256sum --check --strict `
    + '&& tar --no-same-owner -xJf node.tar.xz -C /usr/local --strip-components=1 '
    + `&& test "$(node --version)" = "v${LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1}" `
    + '&& rm node.tar.xz\n'
    + 'WORKDIR /actions-runner\n'
    + `RUN curl --fail --location --proto '=https' --tlsv1.2 --retry 3 `
    + `https://github.com/actions/runner/releases/download/v${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1}/`
    + `actions-runner-linux-x64-${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1}.tar.gz -o runner.tar.gz `
    + `&& echo '${LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1}  runner.tar.gz' | sha256sum --check --strict\n`
    // GitHub publishes the archive with uid/gid 1001. The runtime deliberately drops
    // CAP_DAC_OVERRIDE, so normalize archive ownership to the fixed container root owner.
    + 'RUN tar --no-same-owner -xzf runner.tar.gz && rm runner.tar.gz\n'
    + `LABEL sec.local-runner.image-schema=${LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3} `
    + `sec.local-runner.image-revision=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2} `
    + `sec.local-runner.runner-version=${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1} `
    + `sec.local-runner.node-version=${LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1} `
    + `sec.local-runner.node-archive-sha256=${LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1} `
    + `sec.local-runner.python-version=${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1}\n`
    + 'ENV RUNNER_ALLOW_RUNASROOT=1\n'
    + 'ENTRYPOINT ["/bin/bash","-lc"]\n';
}

async function runCommand(
  command: 'docker' | 'gh' | 'git',
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    input?: Buffer;
    acceptedCodes?: readonly number[];
    timeoutMs?: number;
    githubToken?: string;
  }>
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1_200_000) {
    fail('command timeout is invalid');
  }
  const childEnvironment = commandEnvironment(command);
  if (options.githubToken !== undefined) {
    if (command !== 'gh' || !/^[^\s\u0000-\u001f]{20,1024}$/u.test(options.githubToken)) {
      fail('command GitHub credential binding is invalid');
    }
    childEnvironment.GH_TOKEN = options.githubToken;
  }
  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: childEnvironment,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Local GitHub Actions runner: ${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const collect = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        rejectOnce(new Error(`Local GitHub Actions runner: ${command} output exceeded bound`));
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.once('error', rejectOnce);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = Object.freeze({
        code: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr)
      });
      if (!(options.acceptedCodes ?? [0]).includes(result.code)) {
        reject(new Error(
          `Local GitHub Actions runner: ${command} failed with ${result.code}: `
          + result.stderr.toString('utf8').slice(0, 4096)
        ));
        return;
      }
      resolve(result);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function captureGitHubApiSessionV3(cwd: string): Promise<GitHubApiSessionV3> {
  const token = (await runCommand('gh', [
    'auth', 'token', '--hostname', LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3
  ], { cwd })).stdout.toString('utf8').trim();
  if (!/^[^\s\u0000-\u001f]{20,1024}$/u.test(token)) {
    fail('GitHub API credential is invalid');
  }
  const principal = githubPrincipal((await runCommand('gh', [
    'api', '--hostname', LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3, 'user', '--jq', '.login'
  ], { cwd, githubToken: token })).stdout.toString('utf8').trim());
  const session = Object.freeze({ token, principal });
  githubApiSessionsV3.set(path.resolve(cwd), session);
  return session;
}

async function runGitHubApi(
  args: readonly string[],
  options: Readonly<{ cwd: string; input?: Buffer; acceptedCodes?: readonly number[]; timeoutMs?: number }>
): Promise<CommandResult> {
  const session = githubApiSessionsV3.get(path.resolve(options.cwd))
    ?? await captureGitHubApiSessionV3(options.cwd);
  return await runCommand('gh', [
    'api', '--hostname', LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3, ...args
  ], { ...options, githubToken: session.token });
}

function dockerCommandArgs(endpoint: DockerEndpointIdentityV3, args: readonly string[]): readonly string[] {
  return Object.freeze(['--host', dockerEndpointIdentity(endpoint).endpointHost, ...args]);
}

async function runDockerCommand(
  endpoint: DockerEndpointIdentityV3,
  args: readonly string[],
  options: Readonly<{ cwd: string; input?: Buffer; acceptedCodes?: readonly number[]; timeoutMs?: number }>
): Promise<CommandResult> {
  return await runCommand('docker', dockerCommandArgs(endpoint, args), options);
}

export async function observeDockerEndpointIdentityV3(cwd: string): Promise<DockerEndpointIdentityV3> {
  const contextName = dockerContextName((await runCommand('docker', ['context', 'show'], { cwd }))
    .stdout.toString('utf8').trim());
  const contextSource = (await runCommand('docker', [
    'context', 'inspect', contextName, '--format', '{{json .}}'
  ], { cwd })).stdout.toString('utf8').trim();
  const context = JSON.parse(contextSource) as unknown;
  if (context === null || typeof context !== 'object' || Array.isArray(context)) {
    fail('Docker context inspection is invalid');
  }
  const contextRecord = context as Record<string, unknown>;
  const endpoints = contextRecord.Endpoints;
  const docker = endpoints !== null && typeof endpoints === 'object' && !Array.isArray(endpoints)
    ? (endpoints as Record<string, unknown>).docker
    : null;
  if (contextRecord.Name !== contextName || docker === null || typeof docker !== 'object' || Array.isArray(docker)) {
    fail('Docker context endpoint is invalid');
  }
  const endpointHost = dockerEndpointHost((docker as Record<string, unknown>).Host);
  const provisional = Object.freeze({
    schema: 'sec-docker-endpoint-identity-v1' as const,
    contextName,
    endpointHost,
    daemonId: 'provisional',
    osType: 'linux' as const,
    architecture: 'x86_64' as const
  });
  const infoSource = (await runDockerCommand(provisional, ['info', '--format', '{{json .}}'], { cwd }))
    .stdout.toString('utf8').trim();
  const info = JSON.parse(infoSource) as unknown;
  if (info === null || typeof info !== 'object' || Array.isArray(info)) fail('Docker daemon inspection is invalid');
  const record = info as Record<string, unknown>;
  return dockerEndpointIdentity({
    schema: 'sec-docker-endpoint-identity-v1',
    contextName,
    endpointHost,
    daemonId: dockerDaemonId(record.ID),
    osType: record.OSType as 'linux',
    architecture: record.Architecture as 'x86_64'
  });
}

async function assertDockerEndpointIdentityV3(
  expected: DockerEndpointIdentityV3,
  cwd: string
): Promise<DockerEndpointIdentityV3> {
  const retained = dockerEndpointIdentity(expected);
  const contextSource = (await runCommand('docker', [
    'context', 'inspect', retained.contextName, '--format', '{{json .}}'
  ], { cwd })).stdout.toString('utf8').trim();
  const context = JSON.parse(contextSource) as Record<string, unknown>;
  const endpoints = context?.Endpoints as Record<string, unknown> | undefined;
  const docker = endpoints?.docker as Record<string, unknown> | undefined;
  if (context?.Name !== retained.contextName || docker?.Host !== retained.endpointHost) {
    fail('Docker context endpoint changed and external mutation is preserved');
  }
  const info = JSON.parse((await runDockerCommand(retained, ['info', '--format', '{{json .}}'], { cwd }))
    .stdout.toString('utf8').trim()) as Record<string, unknown>;
  const observed = dockerEndpointIdentity({
    schema: 'sec-docker-endpoint-identity-v1',
    contextName: retained.contextName,
    endpointHost: retained.endpointHost,
    daemonId: info.ID as string,
    osType: info.OSType as 'linux',
    architecture: info.Architecture as 'x86_64'
  });
  if (JSON.stringify(observed) !== JSON.stringify(retained)) {
    fail('Docker daemon identity changed and external mutation is preserved');
  }
  return observed;
}

export async function observeGitHubEndpointIdentityV3(
  cwd: string,
  repository: string
): Promise<GitHubEndpointIdentityV3> {
  const expectedRepository = repositoryName(repository);
  const session = githubApiSessionsV3.get(path.resolve(cwd))
    ?? await captureGitHubApiSessionV3(cwd);
  const observedRepository = (await runGitHubApi([
    `repos/${expectedRepository}`, '--jq', '.full_name'
  ], { cwd })).stdout.toString('utf8').trim();
  if (observedRepository.toLowerCase() !== expectedRepository.toLowerCase()) {
    fail('GitHub API repository identity differs from origin');
  }
  return githubEndpointIdentity({
    schema: 'sec-github-api-endpoint-identity-v1',
    host: LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3,
    repository: expectedRepository,
    principal: session.principal
  });
}

async function assertGitHubEndpointIdentityV3(
  expected: GitHubEndpointIdentityV3,
  cwd: string
): Promise<GitHubEndpointIdentityV3> {
  const retained = githubEndpointIdentity(expected);
  const observed = await observeGitHubEndpointIdentityV3(cwd, retained.repository);
  if (observed.principal.toLowerCase() !== retained.principal.toLowerCase()) {
    fail('GitHub API principal changed and external mutation is preserved');
  }
  return observed;
}

async function resolveRepositoryContext(cwd: string) {
  const root = (await runCommand('git', ['rev-parse', '--show-toplevel'], { cwd })).stdout
    .toString('utf8').trim();
  const common = (await runCommand('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: root
  })).stdout.toString('utf8').trim();
  return Object.freeze({ repositoryRoot: path.resolve(root), commonDirectory: path.resolve(common) });
}

export function assertRepositoryIdentityMatchesOriginV2(
  repository: string,
  originUrl: string
): string {
  const expected = repositoryName(repository);
  const observed = repositoryIdentityFromGitHubUrlV2(originUrl);
  if (observed.toLowerCase() !== expected.toLowerCase()) {
    fail('origin repository identity differs from --repository; external maintainer mutation is preserved');
  }
  return observed;
}

function repositoryIdentityFromGitHubUrlV2(originUrl: string): string {
  const normalized = originUrl.trim().replace(/\.git$/iu, '');
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/iu
    .exec(normalized);
  if (match === null) {
    fail('origin repository identity differs from --repository; external maintainer mutation is preserved');
  }
  return repositoryName(`${match[1]}/${match[2]}`);
}

export function assertRepositoryIdentityMatchesRemoteUrlsV2(
  repository: string,
  fetchUrl: string,
  pushUrls: readonly string[]
): string {
  const observed = assertRepositoryIdentityMatchesOriginV2(repository, fetchUrl);
  if (pushUrls.length === 0) fail('origin has no effective push URL');
  for (const pushUrl of pushUrls) assertRepositoryIdentityMatchesOriginV2(repository, pushUrl);
  return observed;
}

async function assertOriginRepositoryIdentityV2(cwd: string, repository?: string): Promise<string> {
  const fetchUrl = (await runCommand('git', ['remote', 'get-url', 'origin'], { cwd }))
    .stdout.toString('utf8').trim();
  const expected = repository ?? repositoryIdentityFromGitHubUrlV2(fetchUrl);
  const pushUrls = (await runCommand('git', ['remote', 'get-url', '--all', '--push', 'origin'], { cwd }))
    .stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean);
  return assertRepositoryIdentityMatchesRemoteUrlsV2(expected, fetchUrl, pushUrls);
}

function statePath(commonDirectory: string): string {
  return path.join(commonDirectory, 'sec-local-actions-runner', 'state.json');
}

function stateDirectory(commonDirectory: string, create: boolean): PhysicalDirectoryIdentityV1 | null {
  const root = inspectNoFollowDirectoryChainV1(commonDirectory, 'provider common directory').target;
  if (create) return createNoFollowDirectoryChainV1(root, ['sec-local-actions-runner']);
  const observed = inspectExactNoFollowDirectoryPresenceV1(
    path.join(root.path, 'sec-local-actions-runner'), 'provider state directory'
  );
  return observed.state === 'absent' ? null : observed.directory.target;
}

function canonicalStateBytes(state: LocalGitHubActionsRunnerStateV3): Buffer {
  return Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function readStateProjection(commonDirectory: string): Readonly<{
  state: LocalGitHubActionsRunnerStateV3;
  directory: PhysicalDirectoryIdentityV1;
  bytes: Uint8Array;
}> | null {
  const directory = stateDirectory(commonDirectory, false);
  if (directory === null) return null;
  const bytes = readNoFollowOrdinaryFileV1(directory, 'state.json');
  if (bytes === null) return null;
  const state = parseLocalGitHubActionsRunnerStateV3(Buffer.from(bytes).toString('utf8'));
  if (!canonicalStateBytes(state).equals(Buffer.from(bytes))) fail('local state projection bytes are not canonical');
  return Object.freeze({ state, directory, bytes });
}

function publishState(commonDirectory: string, state: LocalGitHubActionsRunnerStateV3): void {
  const directory = stateDirectory(commonDirectory, true)!;
  const bytes = canonicalStateBytes(state);
  publishExclusiveDurableCanonicalFileV1({
    parent: directory,
    name: 'state.json',
    bytes,
    validate: (candidate) => {
      const parsed = parseLocalGitHubActionsRunnerStateV3(Buffer.from(candidate).toString('utf8'));
      if (parsed.stateDigest !== state.stateDigest || !Buffer.from(candidate).equals(bytes)) {
        fail('durable state projection readback mismatch');
      }
    }
  });
}

function deleteStateProjection(commonDirectory: string, expected: LocalGitHubActionsRunnerStateV3): void {
  const observed = readStateProjection(commonDirectory);
  if (observed === null || observed.state.stateDigest !== expected.stateDigest
      || !Buffer.from(observed.bytes).equals(canonicalStateBytes(expected))) {
    fail('local state projection changed and is preserved');
  }
  const entry = inspectNoFollowOrdinaryFileEntryV1(observed.directory, 'state.json');
  if (entry === null) fail('local state projection disappeared before retained deletion');
  deleteRetainedNoFollowEntryV1({
    root: observed.directory,
    relativePath: 'state.json',
    kind: 'file',
    device: entry.device,
    inode: entry.inode,
    ancestorDirectories: []
  });
  if (readNoFollowOrdinaryFileV1(observed.directory, 'state.json') !== null) {
    fail('local state projection deletion readback is not absent');
  }
}

async function listRepositoryRunners(repository: string, cwd: string): Promise<readonly Record<string, unknown>[]> {
  const output = await runGitHubApi([
    `repos/${repository}/actions/runners`, '--paginate', '--jq', '.runners'
  ], { cwd });
  const chunks = output.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean);
  const runners: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    const parsed = JSON.parse(chunk) as unknown;
    if (!Array.isArray(parsed)) fail('GitHub runner inventory is invalid');
    for (const item of parsed) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        fail('GitHub runner inventory entry is invalid');
      }
      runners.push(item as Record<string, unknown>);
    }
  }
  return Object.freeze(runners);
}

async function listContainerIdentityRows(
  cwd: string,
  endpoint: DockerEndpointIdentityV3,
  filters: readonly string[] = []
): Promise<readonly Readonly<{ id: string; name: string }>[]> {
  const inventory = await runDockerCommand(endpoint, [
    'container', 'ls', '--all', '--no-trunc', ...filters, '--format', '{{.ID}}\t{{.Names}}'
  ], { cwd });
  const rows = inventory.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean).map((line) => {
    const [id, name, ...extra] = line.split('\t');
    if (!/^[0-9a-f]{64}$/u.test(id ?? '') || name === undefined || extra.length !== 0) {
      fail('Docker container inventory is invalid');
    }
    return Object.freeze({ id: id!, name });
  });
  return Object.freeze(rows);
}

async function inspectContainerByName(
  containerName: string,
  cwd: string,
  endpoint: DockerEndpointIdentityV3
): Promise<Record<string, unknown> | null> {
  // A successful inventory query is the absence proof. `docker inspect` exit
  // code 1 is deliberately not absence because daemon/context failures share it.
  const matches = (await listContainerIdentityRows(cwd, endpoint, [
    '--filter', `name=^/${runnerName(containerName)}$`
  ])).filter(({ name }) => name === containerName);
  if (matches.length === 0) return null;
  if (matches.length !== 1) fail('Docker container inventory is ambiguous');
  return await inspectContainerById(matches[0]!.id, cwd, endpoint);
}

async function inspectContainerById(
  containerId: string,
  cwd: string,
  endpoint: DockerEndpointIdentityV3
): Promise<Record<string, unknown> | null> {
  if (!/^[0-9a-f]{64}$/u.test(containerId)) fail('container identity is invalid');
  const matches = (await listContainerIdentityRows(cwd, endpoint)).filter(({ id }) => id === containerId);
  if (matches.length === 0) return null;
  if (matches.length !== 1) fail('Docker exact-ID inventory is ambiguous');
  const result = await runDockerCommand(endpoint, ['container', 'inspect', containerId], { cwd });
  const parsed = JSON.parse(result.stdout.toString('utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    fail('Docker inspect response is invalid');
  }
  if ((parsed[0] as Record<string, unknown>).Id !== containerId) {
    fail('Docker inventory and inspect container identities differ');
  }
  return parsed[0] as Record<string, unknown>;
}

async function listProviderProfileContainersV3(
  repository: string,
  cwd: string,
  endpoint: DockerEndpointIdentityV3
): Promise<readonly Record<string, unknown>[]> {
  const retainedRepository = repositoryName(repository);
  const entries = await listContainerIdentityRows(cwd, endpoint, [
    '--filter', `label=sec.local-runner.repository=${retainedRepository}`
  ]);
  const expectedRepository = retainedRepository.toLowerCase();
  const containers: Record<string, unknown>[] = [];
  for (const { id } of entries) {
    const container = await inspectContainerById(id, cwd, endpoint);
    if (container === null) fail('Docker provider profile inventory changed before exact inspect');
    const config = container.Config;
    const labels = config !== null && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>).Labels
      : null;
    if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) {
      fail('Docker provider profile inventory labels are invalid');
    }
    const observedRepository = (labels as Record<string, unknown>)['sec.local-runner.repository'];
    if (typeof observedRepository === 'string' && observedRepository.toLowerCase() === expectedRepository) {
      containers.push(container);
    }
  }
  return Object.freeze(containers);
}

function assertOwnedContainer(
  value: Record<string, unknown>,
  input: Readonly<{
    repository: string;
    providerName: string;
    instanceName: string;
    role: LocalGitHubActionsRunnerRoleV2;
    containerId?: string;
    operationLabel?: string;
  }>
): string {
  const config = value.Config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail('container config is invalid');
  const labels = (config as Record<string, unknown>).Labels;
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) fail('container labels are invalid');
  const record = labels as Record<string, unknown>;
  if (record['sec.local-runner.schema'] !== LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3
      || record['sec.local-runner.repository'] !== input.repository
      || record['sec.local-runner.provider-name'] !== input.providerName
      || record['sec.local-runner.instance-name'] !== input.instanceName
      || record['sec.local-runner.role'] !== input.role
      || record['sec.local-runner.image-id'] !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2) {
    fail('container is foreign and is preserved');
  }
  if (value.Name !== `/${input.instanceName}`) {
    fail('container retained name changed and is preserved');
  }
  if (value.Image !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2) {
    fail('container actual image identity changed and is preserved');
  }
  const hostConfig = value.HostConfig;
  if (hostConfig === null || typeof hostConfig !== 'object' || Array.isArray(hostConfig)) {
    fail('container host configuration is invalid and is preserved');
  }
  const host = hostConfig as Record<string, unknown>;
  const observedCapabilities = Array.isArray(host.CapAdd)
    ? host.CapAdd.map(String).sort()
    : [];
  const expectedCapabilities = input.role === 'sut'
    ? SUT_CAPABILITIES.map((entry) => `CAP_${entry}`).sort()
    : [];
  if (JSON.stringify(observedCapabilities) !== JSON.stringify(expectedCapabilities)
      || !Array.isArray(host.CapDrop) || JSON.stringify(host.CapDrop) !== JSON.stringify(['ALL'])
      || !Array.isArray(host.SecurityOpt) || !host.SecurityOpt.includes('no-new-privileges:true')
      || host.Privileged !== false || host.Binds !== null) {
    fail('container capability boundary changed and is preserved');
  }
  if (input.role === 'sut' &&
      (host.PidsLimit !== SUT_PIDS || host.Memory !== 4 * 1024 * 1024 * 1024 ||
        host.NanoCpus !== SUT_CPUS * 1_000_000_000)) {
    fail('SUT container resource boundary changed and is preserved');
  }
  if (input.containerId !== undefined && value.Id !== input.containerId) {
    fail('container identity changed and is preserved');
  }
  const observedOperationLabel = operationLabel(record['sec.local-runner.operation-label']);
  if (input.operationLabel !== undefined && observedOperationLabel !== input.operationLabel) {
    fail('container operation identity changed and is preserved');
  }
  return observedOperationLabel;
}

export function assertExactLocalGitHubActionsRunnerProfileContainersV3(input: Readonly<{
  containers: readonly Record<string, unknown>[];
  instances: readonly LocalGitHubActionsRunnerInstanceV2[];
  repository: string;
  providerName: string;
  operationLabel: string;
}>): void {
  const retainedProviderName = providerBaseName(input.providerName);
  const retainedOperationLabel = operationLabel(input.operationLabel);
  if (input.instances.length !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.length) {
    fail('provider profile container retained set is not exact');
  }
  const expectedByName = new Map(input.instances.map((instance) => [instance.name, instance] as const));
  const expectedById = new Map(input.instances.map((instance) => [instance.containerId, instance] as const));
  if (expectedByName.size !== 3 || expectedById.size !== 3 || input.containers.length !== 3) {
    fail('provider profile container inventory is missing, duplicated, or extra');
  }
  for (const container of input.containers) {
    const config = container.Config;
    const labels = config !== null && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>).Labels
      : null;
    if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) {
      fail('provider profile container labels are invalid and are preserved');
    }
    const record = labels as Record<string, unknown>;
    const name = String(record['sec.local-runner.instance-name'] ?? '');
    const byName = expectedByName.get(name);
    const byId = typeof container.Id === 'string' ? expectedById.get(container.Id) : undefined;
    if (byName === undefined || byId === undefined || byName !== byId
        || record['sec.local-runner.role'] !== byName.role) {
      fail('provider profile inventory contains a foreign eligible container; external maintainer mutation is preserved');
    }
    assertOwnedContainer(container, {
      repository: input.repository,
      providerName: retainedProviderName,
      instanceName: name,
      role: byName.role,
      containerId: byName.containerId,
      operationLabel: retainedOperationLabel
    });
    const state = container.State;
    if (state === null || typeof state !== 'object' || Array.isArray(state)
        || (state as Record<string, unknown>).Running !== true) {
      fail('Docker container final readiness census is not running');
    }
  }
}

function runnerLabelNames(value: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(value.labels)) fail('GitHub runner labels are invalid');
  return Object.freeze(value.labels.map((label) => {
    if (label === null || typeof label !== 'object' || Array.isArray(label)
        || typeof (label as Record<string, unknown>).name !== 'string') {
      fail('GitHub runner label is invalid');
    }
    return (label as Record<string, unknown>).name as string;
  }));
}

function runnerLabelKeys(value: Record<string, unknown>): ReadonlySet<string> {
  const labels = runnerLabelNames(value).map((label) => label.toLowerCase());
  if (new Set(labels).size !== labels.length) {
    fail('GitHub runner labels are duplicated case-insensitively and it is preserved');
  }
  return new Set(labels);
}

function runnerHasLabel(value: Record<string, unknown>, label: string): boolean {
  return runnerLabelKeys(value).has(label.toLowerCase());
}

function isProviderProfileEligibleRunnerV2(value: Record<string, unknown>): boolean {
  const labels = runnerLabelKeys(value);
  return [
    LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1,
    ...Object.values(LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2)
  ].some((label) => labels.has(label.toLowerCase()));
}

export function assertOwnedLocalGitHubActionsRunnerV2(
  value: Record<string, unknown>,
  input: Readonly<{
    name: string;
    role: LocalGitHubActionsRunnerRoleV2;
    operationLabel: string;
    runnerId?: number;
  }>
): number {
  const id = value.id;
  if (value.name !== input.name || !Number.isSafeInteger(id) || Number(id) <= 0) {
    fail('GitHub runner identity is invalid and is preserved');
  }
  if (input.runnerId !== undefined && Number(id) !== input.runnerId) {
    fail('GitHub runner id changed and is preserved');
  }
  const labels = runnerLabelKeys(value);
  const expectedLabels = new Set([
    ...LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1,
    LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2[input.role],
    input.operationLabel
  ].map((label) => label.toLowerCase()));
  if (labels.size !== expectedLabels.size || [...expectedLabels].some((label) => !labels.has(label))) {
    fail('GitHub runner complete effective labels changed and it is preserved');
  }
  if (value.os !== 'Linux') {
    fail('GitHub runner operating system identity changed and it is preserved');
  }
  return Number(id);
}

export function assertContainedLocalGitHubActionsRunnerProfileInventoryV2(input: Readonly<{
  runners: readonly Record<string, unknown>[];
  instances: readonly LocalGitHubActionsRunnerInstanceV2[];
  operationLabel: string;
}>): void {
  const retainedOperationLabel = operationLabel(input.operationLabel);
  const expectedByName = new Map(input.instances.map((instance) => [instance.name, instance] as const));
  const expectedById = new Map(input.instances.map((instance) => [instance.runnerId, instance] as const));
  const candidates = input.runners.filter((runner) => {
    return isProviderProfileEligibleRunnerV2(runner)
      || runnerHasLabel(runner, retainedOperationLabel)
      || expectedByName.has(String(runner.name))
      || (Number.isSafeInteger(runner.id) && expectedById.has(Number(runner.id)));
  });
  for (const runner of candidates) {
    const byName = expectedByName.get(String(runner.name));
    const byId = Number.isSafeInteger(runner.id) ? expectedById.get(Number(runner.id)) : undefined;
    if (byName === undefined || byId === undefined || byName !== byId) {
      fail('GitHub runner profile inventory contains a foreign eligible runner; external maintainer mutation is preserved');
    }
    assertOwnedLocalGitHubActionsRunnerV2(runner, {
      name: byName.name,
      role: byName.role,
      operationLabel: retainedOperationLabel,
      runnerId: byName.runnerId
    });
  }
}

export function assertExactLocalGitHubActionsRunnerProfileInventoryV3(input: Readonly<{
  runners: readonly Record<string, unknown>[];
  instances: readonly LocalGitHubActionsRunnerInstanceV2[];
  operationLabel: string;
}>): void {
  if (input.instances.length !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.length
      || new Set(input.instances.map(({ name }) => name)).size !== 3
      || new Set(input.instances.map(({ runnerId }) => runnerId)).size !== 3) {
    fail('GitHub runner retained inventory is not one exact instance per role');
  }
  const retainedOperationLabel = operationLabel(input.operationLabel);
  const expectedByName = new Map(input.instances.map((instance) => [instance.name, instance] as const));
  const expectedById = new Map(input.instances.map((instance) => [instance.runnerId, instance] as const));
  const candidates = input.runners.filter((runner) => isProviderProfileEligibleRunnerV2(runner)
    || runnerHasLabel(runner, retainedOperationLabel)
    || expectedByName.has(String(runner.name))
    || (Number.isSafeInteger(runner.id) && expectedById.has(Number(runner.id))));
  if (candidates.length !== 3) {
    fail('GitHub runner profile inventory is missing, duplicated, or extra');
  }
  assertContainedLocalGitHubActionsRunnerProfileInventoryV2(input);
  for (const expected of input.instances) {
    const exact = candidates.filter((runner) => runner.name === expected.name || runner.id === expected.runnerId);
    if (exact.length !== 1 || exact[0]!.name !== expected.name || exact[0]!.id !== expected.runnerId) {
      fail('GitHub runner exact retained name and ID set differs');
    }
    if (exact[0]!.status !== 'online' || exact[0]!.busy !== false) {
      fail('GitHub runner final readiness census is not online and idle');
    }
  }
}

function withLedgerInstance(
  ledger: LocalGitHubActionsProviderLedgerV3,
  role: LocalGitHubActionsRunnerRoleV2,
  update: Partial<LocalGitHubActionsProviderLedgerInstanceV3>
): readonly LocalGitHubActionsProviderLedgerInstanceV3[] {
  return Object.freeze(ledger.instances.map((instance) => instance.role === role
    ? Object.freeze({ ...instance, ...update })
    : instance));
}

async function cleanupLedgerInstanceV3(
  cursor: ProviderLedgerCursorV3,
  cwd: string,
  role: LocalGitHubActionsRunnerRoleV2
): Promise<void> {
  let retained = cursor.ledger.instances.find((instance) => instance.role === role)!;
  const runners = await listRepositoryRunners(cursor.ledger.repository, cwd);
  const runnerCandidates = runners.filter((runner) =>
    runner.name === retained.name || (retained.runnerId !== null && runner.id === retained.runnerId));
  if (retained.runnerState === 'uncreated') {
    if (runnerCandidates.length !== 0) {
      fail('uncommitted GitHub runner residue exists without remote exact-ID authority and is preserved');
    }
    await advanceProviderLedgerV3(cursor, {
      cwd,
      instances: withLedgerInstance(cursor.ledger, role, { runnerState: 'absent' })
    });
  } else if (retained.runnerState === 'present') {
    if (retained.runnerId === null || runnerCandidates.length > 1
        || runnerCandidates.some((runner) => runner.id !== retained.runnerId || runner.name !== retained.name)) {
      fail('GitHub runner retained ID/name was replaced and external mutation is preserved');
    }
    if (runnerCandidates.length === 1) {
      assertOwnedLocalGitHubActionsRunnerV2(runnerCandidates[0]!, {
        name: retained.name,
        role,
        operationLabel: cursor.ledger.operationLabel,
        runnerId: retained.runnerId
      });
      if (runnerCandidates[0]!.busy === true) fail(`runner ${retained.name} became busy and cleanup is refused`);
      await runGitHubApi([
        '--method', 'DELETE', `repos/${cursor.ledger.repository}/actions/runners/${retained.runnerId}`
      ], { cwd });
    }
    if ((await listRepositoryRunners(cursor.ledger.repository, cwd)).some((runner) =>
      runner.name === retained.name || runner.id === retained.runnerId)) {
      fail('GitHub runner exact ID/name deletion readback is not absent');
    }
    await advanceProviderLedgerV3(cursor, {
      cwd,
      instances: withLedgerInstance(cursor.ledger, role, { runnerState: 'absent' })
    });
  } else if (runnerCandidates.length !== 0) {
    fail('GitHub runner reappeared after remote terminal generation and is preserved');
  }

  retained = cursor.ledger.instances.find((instance) => instance.role === role)!;
  const byName = await inspectContainerByName(retained.name, cwd, cursor.ledger.dockerEndpoint);
  const byId = retained.containerId === null ? null
    : await inspectContainerById(retained.containerId, cwd, cursor.ledger.dockerEndpoint);
  if (retained.containerState === 'uncreated') {
    if (byName !== null || byId !== null) {
      fail('uncommitted Docker container residue exists without remote exact-ID authority and is preserved');
    }
    await advanceProviderLedgerV3(cursor, {
      cwd,
      instances: withLedgerInstance(cursor.ledger, role, { containerState: 'absent' })
    });
  } else if (retained.containerState === 'present') {
    if (retained.containerId === null || (byName === null) !== (byId === null)
        || (byName !== null && (byName.Id !== retained.containerId || byId?.Id !== retained.containerId))) {
      fail('Docker container retained ID/name was replaced and external mutation is preserved');
    }
    if (byId !== null) {
      assertOwnedContainer(byId, {
        repository: cursor.ledger.repository,
        providerName: cursor.ledger.providerName,
        instanceName: retained.name,
        role,
        containerId: retained.containerId,
        operationLabel: cursor.ledger.operationLabel
      });
      await runDockerCommand(cursor.ledger.dockerEndpoint, ['rm', '--force', retained.containerId], { cwd });
    }
    if (await inspectContainerById(retained.containerId, cwd, cursor.ledger.dockerEndpoint) !== null
        || await inspectContainerByName(retained.name, cwd, cursor.ledger.dockerEndpoint) !== null) {
      fail('Docker container exact ID/name deletion readback is not absent');
    }
    await advanceProviderLedgerV3(cursor, {
      cwd,
      instances: withLedgerInstance(cursor.ledger, role, { containerState: 'absent' })
    });
  } else if (byName !== null || byId !== null) {
    fail('Docker container reappeared after remote terminal generation and is preserved');
  }
}

function assertImageIdentity(value: Record<string, unknown>): void {
  if (value.Id !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2) {
    fail('cached runner image ID differs from the frozen provider revision');
  }
  const config = value.Config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail('image config is invalid');
  const labels = (config as Record<string, unknown>).Labels;
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) fail('image labels are invalid');
  const record = labels as Record<string, unknown>;
  if (record['sec.local-runner.image-schema'] !== LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3
      || record['sec.local-runner.image-revision'] !== LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2
      || record['sec.local-runner.runner-version'] !== LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1
      || record['sec.local-runner.node-version'] !== LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1
      || record['sec.local-runner.node-archive-sha256']
        !== LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1
      || record['sec.local-runner.python-version'] !== LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1) {
    fail('cached runner image labels differ from the frozen provider revision');
  }
}

async function inspectImage(cwd: string, endpoint: DockerEndpointIdentityV3): Promise<Record<string, unknown> | null> {
  const inventory = await runDockerCommand(endpoint, [
    'image', 'ls', '--no-trunc', '--filter', `reference=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1}`,
    '--format', '{{.ID}}'
  ], { cwd });
  const identities = [...new Set(inventory.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean))];
  if (identities.length === 0) return null;
  if (identities.length !== 1 || !/^sha256:[0-9a-f]{64}$/u.test(identities[0]!)) {
    fail('runner image inventory is ambiguous');
  }
  const result = await runDockerCommand(endpoint, ['image', 'inspect', identities[0]!], { cwd });
  const parsed = JSON.parse(result.stdout.toString('utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) fail('Docker image inspect is invalid');
  return parsed[0] as Record<string, unknown>;
}

async function inspectImageById(
  imageId: string,
  cwd: string,
  endpoint: DockerEndpointIdentityV3
): Promise<Record<string, unknown> | null> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageId)) fail('Docker image identity is invalid');
  const inventory = await runDockerCommand(endpoint, [
    'image', 'ls', '--all', '--no-trunc', '--format', '{{.ID}}'
  ], { cwd });
  const identities = new Set(inventory.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean));
  if (!identities.has(imageId)) return null;
  const result = await runDockerCommand(endpoint, ['image', 'inspect', imageId], { cwd });
  const parsed = JSON.parse(result.stdout.toString('utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])
      || (parsed[0] as Record<string, unknown>).Id !== imageId) {
    fail('Docker exact image identity readback is invalid');
  }
  return parsed[0] as Record<string, unknown>;
}

async function ensureImage(cwd: string, endpoint: DockerEndpointIdentityV3): Promise<void> {
  let present = await inspectImage(cwd, endpoint);
  if (present === null) {
    await runDockerCommand(endpoint, ['build', '--tag', LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1, '-'], {
      cwd,
      input: Buffer.from(createLocalGitHubActionsRunnerDockerfileV1(), 'utf8'),
      timeoutMs: 1_200_000
    });
    present = await inspectImage(cwd, endpoint);
    if (present === null) fail('runner image build has no exact readback');
  }
  assertImageIdentity(present);
}

function providerResourceState(value: unknown): LocalGitHubActionsProviderResourceStateV3 {
  if (value !== 'uncreated' && value !== 'present' && value !== 'absent') {
    fail('provider resource state is invalid');
  }
  return value;
}

function providerLifecycle(value: unknown): LocalGitHubActionsProviderLifecycleV3 {
  if (value !== 'provisioning' && value !== 'active' && value !== 'teardown' && value !== 'terminal') {
    fail('provider lifecycle is invalid');
  }
  return value;
}

function ledgerInstance(
  input: LocalGitHubActionsProviderLedgerInstanceV3,
  providerName: string
): LocalGitHubActionsProviderLedgerInstanceV3 {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('provider ledger instance is invalid');
  }
  exactKeys(input as unknown as Record<string, unknown>, [
    'role', 'roleLabel', 'name', 'containerId', 'containerState', 'runnerId', 'runnerState'
  ], 'provider ledger instance');
  const role = runnerRole(input.role);
  const expectedName = instanceName(providerName, role);
  if (input.roleLabel !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2[role] || input.name !== expectedName) {
    fail('provider ledger role identity is invalid');
  }
  const containerState = providerResourceState(input.containerState);
  const runnerState = providerResourceState(input.runnerState);
  if ((containerState === 'present' && input.containerId === null)
      || (containerState === 'uncreated' && input.containerId !== null)
      || (runnerState === 'present' && input.runnerId === null)
      || (runnerState === 'uncreated' && input.runnerId !== null)
      || (input.containerId !== null && !/^[0-9a-f]{64}$/u.test(input.containerId))
      || (input.runnerId !== null && (!Number.isSafeInteger(input.runnerId) || input.runnerId <= 0))) {
    fail('provider ledger retained resource identity is invalid');
  }
  if (runnerState === 'present' && containerState !== 'present') {
    fail('provider ledger present runner requires its present container identity');
  }
  return Object.freeze({
    role,
    roleLabel: input.roleLabel,
    name: expectedName,
    containerId: input.containerId,
    containerState,
    runnerId: input.runnerId,
    runnerState
  });
}

export function createLocalGitHubActionsProviderLedgerV3(
  input: Omit<LocalGitHubActionsProviderLedgerV3, 'schema' | 'profileLabel' | 'imageId' | 'ledgerDigest'>
): LocalGitHubActionsProviderLedgerV3 {
  const expectedMainSha = boundedText(input.expectedMainSha, 'expected main SHA', 40);
  if (!/^[0-9a-f]{40}$/u.test(expectedMainSha)) fail('expected main SHA is invalid');
  const createdAt = new Date(input.createdAt).toISOString();
  if (createdAt !== input.createdAt) fail('provider ledger createdAt is invalid');
  if (!Number.isSafeInteger(input.generation) || input.generation < 0) fail('provider ledger generation is invalid');
  if ((input.generation === 0) !== (input.predecessorObjectSha === null)
      || (input.predecessorObjectSha !== null && !/^[0-9a-f]{40}$/u.test(input.predecessorObjectSha))) {
    fail('provider ledger predecessor identity is invalid');
  }
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.providerName);
  const lifecycle = providerLifecycle(input.lifecycle);
  const instances = input.instances.map((instance) => ledgerInstance(instance, providerName));
  if (instances.length !== 3
      || LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.some((role, index) => instances[index]?.role !== role)
      || new Set(instances.flatMap(({ containerId }) => containerId === null ? [] : [containerId])).size
        !== instances.filter(({ containerId }) => containerId !== null).length
      || new Set(instances.flatMap(({ runnerId }) => runnerId === null ? [] : [runnerId])).size
        !== instances.filter(({ runnerId }) => runnerId !== null).length) {
    fail('provider ledger instances are not one ordered unique identity per role');
  }
  if (lifecycle === 'active' && instances.some((instance) =>
    instance.containerState !== 'present' || instance.runnerState !== 'present')) {
    fail('active provider ledger must retain three present runner/container pairs');
  }
  if (lifecycle === 'terminal' && instances.some((instance) =>
    instance.containerState !== 'absent' || instance.runnerState !== 'absent')) {
    fail('terminal provider ledger must retain three absent runner/container pairs');
  }
  const dockerEndpoint = dockerEndpointIdentity(input.dockerEndpoint);
  const githubEndpoint = githubEndpointIdentity(input.githubEndpoint);
  if (githubEndpoint.repository.toLowerCase() !== repository.toLowerCase()) {
    fail('provider ledger GitHub endpoint repository differs');
  }
  const material = Object.freeze({
    schema: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_SCHEMA_V3,
    repository,
    providerName,
    profileLabel: LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1,
    operationLabel: operationLabel(input.operationLabel),
    expectedMainSha,
    createdAt,
    dockerEndpoint,
    githubEndpoint,
    imageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    lifecycle,
    generation: input.generation,
    predecessorObjectSha: input.predecessorObjectSha,
    instances: Object.freeze(instances)
  });
  return Object.freeze({ ...material, ledgerDigest: sha256(material) as `sha256:${string}` });
}

export function parseLocalGitHubActionsProviderLedgerV3(source: string): LocalGitHubActionsProviderLedgerV3 {
  const parsed = JSON.parse(source) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('provider ledger is invalid');
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'repository', 'providerName', 'profileLabel', 'operationLabel',
    'expectedMainSha', 'createdAt', 'dockerEndpoint', 'githubEndpoint', 'imageId',
    'lifecycle', 'generation', 'predecessorObjectSha', 'instances', 'ledgerDigest'
  ], 'provider ledger');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_SCHEMA_V3
      || value.profileLabel !== LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1) {
    fail('provider ledger capability identity is invalid');
  }
  if (!Array.isArray(value.instances)) fail('provider ledger instances are invalid');
  const recreated = createLocalGitHubActionsProviderLedgerV3({
    repository: value.repository as string,
    providerName: value.providerName as string,
    operationLabel: value.operationLabel as string,
    expectedMainSha: value.expectedMainSha as string,
    createdAt: value.createdAt as string,
    dockerEndpoint: value.dockerEndpoint as DockerEndpointIdentityV3,
    githubEndpoint: value.githubEndpoint as GitHubEndpointIdentityV3,
    lifecycle: value.lifecycle as LocalGitHubActionsProviderLifecycleV3,
    generation: value.generation as number,
    predecessorObjectSha: value.predecessorObjectSha as string | null,
    instances: value.instances as LocalGitHubActionsProviderLedgerInstanceV3[]
  });
  if (recreated.ledgerDigest !== value.ledgerDigest) fail('provider ledger digest mismatch');
  return recreated;
}

function providerLedgerStableIdentityV3(ledger: LocalGitHubActionsProviderLedgerV3): string {
  return JSON.stringify({
    schema: ledger.schema,
    repository: ledger.repository,
    providerName: ledger.providerName,
    profileLabel: ledger.profileLabel,
    operationLabel: ledger.operationLabel,
    expectedMainSha: ledger.expectedMainSha,
    createdAt: ledger.createdAt,
    dockerEndpoint: ledger.dockerEndpoint,
    githubEndpoint: ledger.githubEndpoint,
    imageId: ledger.imageId
  });
}

export function assertInitialLocalGitHubActionsProviderLedgerV3(
  ledger: LocalGitHubActionsProviderLedgerV3
): void {
  if (ledger.generation !== 0 || ledger.predecessorObjectSha !== null
      || ledger.lifecycle !== 'provisioning'
      || ledger.instances.some((instance) => instance.containerId !== null
        || instance.containerState !== 'uncreated'
        || instance.runnerId !== null
        || instance.runnerState !== 'uncreated')) {
    fail('provider ledger initial generation is invalid');
  }
}

export function assertLocalGitHubActionsProviderLedgerTransitionV3(
  previousObjectSha: string,
  previous: LocalGitHubActionsProviderLedgerV3,
  next: LocalGitHubActionsProviderLedgerV3
): void {
  if (!/^[0-9a-f]{40}$/u.test(previousObjectSha)
      || next.generation !== previous.generation + 1
      || next.predecessorObjectSha !== previousObjectSha
      || providerLedgerStableIdentityV3(next) !== providerLedgerStableIdentityV3(previous)) {
    fail('provider ledger generation identity transition is invalid');
  }
  const lifecycleChanged = previous.lifecycle !== next.lifecycle;
  const resourceChanges: Array<Readonly<{
    kind: 'container' | 'runner';
    previousId: string | number | null;
    nextId: string | number | null;
    previousState: LocalGitHubActionsProviderResourceStateV3;
    nextState: LocalGitHubActionsProviderResourceStateV3;
  }>> = [];
  for (const [index, before] of previous.instances.entries()) {
    const after = next.instances[index]!;
    if (before.role !== after.role || before.roleLabel !== after.roleLabel || before.name !== after.name) {
      fail('provider ledger retained role identity changed');
    }
    if (before.containerId !== after.containerId || before.containerState !== after.containerState) {
      resourceChanges.push({
        kind: 'container',
        previousId: before.containerId,
        nextId: after.containerId,
        previousState: before.containerState,
        nextState: after.containerState
      });
    }
    if (before.runnerId !== after.runnerId || before.runnerState !== after.runnerState) {
      resourceChanges.push({
        kind: 'runner',
        previousId: before.runnerId,
        nextId: after.runnerId,
        previousState: before.runnerState,
        nextState: after.runnerState
      });
    }
  }
  if ((lifecycleChanged ? 1 : 0) + resourceChanges.length !== 1) {
    fail('provider ledger generation must commit exactly one lifecycle or resource effect');
  }
  if (lifecycleChanged) {
    const allowed = (previous.lifecycle === 'provisioning'
        && (next.lifecycle === 'active' || next.lifecycle === 'teardown'))
      || (previous.lifecycle === 'active' && next.lifecycle === 'teardown')
      || (previous.lifecycle === 'teardown' && next.lifecycle === 'terminal');
    if (!allowed) fail('provider ledger lifecycle transition is invalid');
    return;
  }
  const change = resourceChanges[0]!;
  if (previous.lifecycle === 'terminal' || previous.lifecycle === 'active') {
    fail('provider ledger resource effect is invalid for the lifecycle');
  }
  const created = previous.lifecycle === 'provisioning'
    && change.previousState === 'uncreated' && change.previousId === null
    && change.nextState === 'present' && change.nextId !== null;
  const skippedDuringTeardown = previous.lifecycle === 'teardown'
    && change.previousState === 'uncreated' && change.previousId === null
    && change.nextState === 'absent' && change.nextId === null;
  const removedDuringTeardown = previous.lifecycle === 'teardown'
    && change.previousState === 'present' && change.previousId !== null
    && change.nextState === 'absent' && change.nextId === change.previousId;
  if (!created && !skippedDuringTeardown && !removedDuringTeardown) {
    fail('provider ledger resource transition is invalid');
  }
}

async function observeRemoteRefSha(cwd: string, ref: string): Promise<string | null> {
  const result = await runCommand('git', [
    'ls-remote', '--exit-code', '--refs', 'origin', ref
  ], { cwd, acceptedCodes: [0, 2] });
  if (result.code === 2) return null;
  const lines = result.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) fail(`remote ref ${ref} is ambiguous`);
  const match = /^([0-9a-f]{40})\s+(.+)$/u.exec(lines[0]!);
  if (match === null || match[2] !== ref) fail(`remote ref ${ref} response is invalid`);
  return match[1]!;
}

interface ProviderLedgerCursorV3 {
  ledger: LocalGitHubActionsProviderLedgerV3;
  objectSha: string;
}

export interface LocalGitHubActionsProviderLedgerCommitV3 {
  readonly treeSha: string;
  readonly parentObjectSha: string | null;
  readonly timestamp: number;
  readonly generation: number;
}

function canonicalLedgerBytes(ledger: LocalGitHubActionsProviderLedgerV3): Buffer {
  return Buffer.from(`${JSON.stringify(ledger)}\n`, 'utf8');
}

export function createLocalGitHubActionsProviderLedgerCommitBytesV3(
  ledger: LocalGitHubActionsProviderLedgerV3,
  treeSha: string
): Buffer {
  if (!/^[0-9a-f]{40}$/u.test(treeSha)) fail('provider ledger tree identity is invalid');
  const timestamp = Math.floor(Date.parse(ledger.createdAt) / 1000);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) fail('provider ledger commit timestamp is invalid');
  const parent = ledger.predecessorObjectSha === null
    ? ''
    : `parent ${ledger.predecessorObjectSha}\n`;
  return Buffer.from(
    `tree ${treeSha}\n${parent}`
    + `author SEC Provider Ledger <provider-ledger@sec.invalid> ${timestamp} +0000\n`
    + `committer SEC Provider Ledger <provider-ledger@sec.invalid> ${timestamp} +0000\n\n`
    + `sec-provider-ledger-v3 generation ${ledger.generation}\n`,
    'utf8'
  );
}

export function parseLocalGitHubActionsProviderLedgerCommitV3(
  source: string
): LocalGitHubActionsProviderLedgerCommitV3 {
  const match = /^tree ([0-9a-f]{40})\n(?:parent ([0-9a-f]{40})\n)?author SEC Provider Ledger <provider-ledger@sec\.invalid> ([0-9]+) \+0000\ncommitter SEC Provider Ledger <provider-ledger@sec\.invalid> ([0-9]+) \+0000\n\nsec-provider-ledger-v3 generation ([0-9]+)\n$/u
    .exec(source);
  if (match === null || match[3] !== match[4]) fail('provider ledger commit framing is invalid');
  const timestamp = Number(match[3]);
  const generation = Number(match[5]);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0
      || !Number.isSafeInteger(generation) || generation < 0) {
    fail('provider ledger commit numeric identity is invalid');
  }
  return Object.freeze({
    treeSha: match[1]!,
    parentObjectSha: match[2] ?? null,
    timestamp,
    generation
  });
}

async function writeLedgerGenerationObjectV3(
  cwd: string,
  ledger: LocalGitHubActionsProviderLedgerV3
): Promise<string> {
  const blobSha = (await runCommand('git', ['hash-object', '-w', '--stdin'], {
    cwd,
    input: canonicalLedgerBytes(ledger)
  })).stdout.toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/u.test(blobSha)) fail('provider ledger blob identity is invalid');
  const treeSha = (await runCommand('git', ['mktree'], {
    cwd,
    input: Buffer.from(`100644 blob ${blobSha}\tprovider-ledger.json\n`, 'utf8')
  })).stdout.toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/u.test(treeSha)) fail('provider ledger tree identity is invalid');
  const commitBytes = createLocalGitHubActionsProviderLedgerCommitBytesV3(ledger, treeSha);
  const objectSha = (await runCommand('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
    cwd,
    input: commitBytes
  })).stdout.toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/u.test(objectSha)) fail('provider ledger commit identity is invalid');
  return objectSha;
}

async function publishProviderLedgerV3(input: Readonly<{
  cwd: string;
  repository: string;
  providerName: string;
  operationLabel: string;
  createdAt: string;
  dockerEndpoint: DockerEndpointIdentityV3;
  githubEndpoint: GitHubEndpointIdentityV3;
}>): Promise<ProviderLedgerCursorV3> {
  if (await observeRemoteRefSha(input.cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3) !== null) {
    fail('the Linux verification profile already has a remote provider ledger');
  }
  const expectedMainSha = await observeRemoteRefSha(input.cwd, 'refs/heads/main');
  if (expectedMainSha === null) fail('remote main is absent while acquiring provider ledger');
  const ledger = createLocalGitHubActionsProviderLedgerV3({
    ...input,
    expectedMainSha,
    lifecycle: 'provisioning',
    generation: 0,
    predecessorObjectSha: null,
    instances: LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.map((role) => ({
      role,
      roleLabel: LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2[role],
      name: instanceName(input.providerName, role),
      containerId: null,
      containerState: 'uncreated',
      runnerId: null,
      runnerState: 'uncreated'
    }))
  });
  assertInitialLocalGitHubActionsProviderLedgerV3(ledger);
  const objectSha = await writeLedgerGenerationObjectV3(input.cwd, ledger);
  try {
    await runCommand('git', [
      'push', '--no-verify', 'origin', `${objectSha}:${LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3}`
    ], { cwd: input.cwd });
  } catch (error) {
    if (await observeRemoteRefSha(input.cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3) !== objectSha) {
      throw error;
    }
  }
  if (await observeRemoteRefSha(input.cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3) !== objectSha) {
    fail('provider ledger publication readback differs');
  }
  return { ledger, objectSha };
}

async function loadProviderLedgerGenerationObjectV3(input: Readonly<{
  cwd: string;
  objectSha: string;
}>): Promise<Readonly<{
  ledger: LocalGitHubActionsProviderLedgerV3;
  parentObjectSha: string | null;
}>> {
  const commitSource = (await runCommand('git', ['cat-file', 'commit', input.objectSha], {
    cwd: input.cwd
  })).stdout.toString('utf8');
  const commit = parseLocalGitHubActionsProviderLedgerCommitV3(commitSource);
  const treeSource = (await runCommand('git', [
    'ls-tree', '--full-tree', '-z', input.objectSha
  ], { cwd: input.cwd })).stdout;
  const treeMatch = /^100644 blob ([0-9a-f]{40})\tprovider-ledger\.json\u0000$/u
    .exec(treeSource.toString('utf8'));
  if (treeMatch === null) fail('provider ledger commit tree is invalid');
  const source = (await runCommand('git', ['cat-file', 'blob', treeMatch[1]!], {
    cwd: input.cwd
  })).stdout.toString('utf8');
  const ledger = parseLocalGitHubActionsProviderLedgerV3(source);
  if (!canonicalLedgerBytes(ledger).equals(Buffer.from(source, 'utf8'))) {
    fail('provider ledger bytes are not canonical');
  }
  const expectedTimestamp = Math.floor(Date.parse(ledger.createdAt) / 1000);
  if (commit.timestamp !== expectedTimestamp
      || commit.generation !== ledger.generation
      || commit.parentObjectSha !== ledger.predecessorObjectSha) {
    fail('provider ledger commit metadata differs from its canonical payload');
  }
  return Object.freeze({ ledger, parentObjectSha: commit.parentObjectSha });
}

async function loadProviderLedgerV3(input: Readonly<{
  cwd: string;
  repository: string;
  objectSha: string;
}>): Promise<LocalGitHubActionsProviderLedgerV3> {
  const reversed: Array<Readonly<{
    objectSha: string;
    ledger: LocalGitHubActionsProviderLedgerV3;
  }>> = [];
  const seen = new Set<string>();
  let objectSha: string | null = input.objectSha;
  while (objectSha !== null) {
    if (seen.has(objectSha) || reversed.length >= 32) {
      fail('provider ledger predecessor chain is cyclic or exceeds its bound');
    }
    seen.add(objectSha);
    const generation = await loadProviderLedgerGenerationObjectV3({
      cwd: input.cwd,
      objectSha
    });
    const ledger = generation.ledger;
    reversed.push(Object.freeze({ objectSha, ledger }));
    objectSha = generation.parentObjectSha;
  }
  const chain = reversed.reverse();
  if (chain.length === 0) fail('provider ledger predecessor chain is empty');
  assertInitialLocalGitHubActionsProviderLedgerV3(chain[0]!.ledger);
  for (let index = 1; index < chain.length; index += 1) {
    assertLocalGitHubActionsProviderLedgerTransitionV3(
      chain[index - 1]!.objectSha,
      chain[index - 1]!.ledger,
      chain[index]!.ledger
    );
  }
  if (chain.at(-1)!.ledger.generation !== chain.length - 1) {
    fail('provider ledger generation count differs from its predecessor chain');
  }
  const current = chain.at(-1)!.ledger;
  if (current.repository.toLowerCase() !== repositoryName(input.repository).toLowerCase()) {
    fail('provider ledger repository differs from the bound repository');
  }
  return current;
}

async function advanceProviderLedgerV3(
  cursor: ProviderLedgerCursorV3,
  input: Readonly<{
    cwd: string;
    lifecycle?: LocalGitHubActionsProviderLifecycleV3;
    instances?: readonly LocalGitHubActionsProviderLedgerInstanceV3[];
  }>
): Promise<void> {
  const next = createLocalGitHubActionsProviderLedgerV3({
    ...cursor.ledger,
    lifecycle: input.lifecycle ?? cursor.ledger.lifecycle,
    generation: cursor.ledger.generation + 1,
    predecessorObjectSha: cursor.objectSha,
    instances: input.instances ?? cursor.ledger.instances
  });
  assertLocalGitHubActionsProviderLedgerTransitionV3(cursor.objectSha, cursor.ledger, next);
  const objectSha = await writeLedgerGenerationObjectV3(input.cwd, next);
  try {
    await runCommand('git', [
      'push', '--no-verify',
      `--force-with-lease=${LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3}:${cursor.objectSha}`,
      'origin', `${objectSha}:${LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3}`
    ], { cwd: input.cwd });
  } catch (error) {
    if (await observeRemoteRefSha(input.cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3) !== objectSha) {
      throw error;
    }
  }
  if (await observeRemoteRefSha(input.cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3) !== objectSha) {
    fail('provider ledger generation readback differs');
  }
  cursor.ledger = next;
  cursor.objectSha = objectSha;
}

async function deleteProviderLedgerV3(input: Readonly<{ cwd: string; objectSha: string; ledger: LocalGitHubActionsProviderLedgerV3 }>): Promise<void> {
  if (input.ledger.lifecycle !== 'terminal') fail('only a terminal provider ledger can be deleted');
  const current = await observeRemoteRefSha(input.cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3);
  if (current === null) return;
  if (current !== input.objectSha) fail('provider ledger identity changed and is preserved');
  try {
    await runCommand('git', [
      'push', '--no-verify',
      `--force-with-lease=${LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3}:${input.objectSha}`,
      'origin', `:${LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3}`
    ], { cwd: input.cwd });
  } catch (error) {
    if (await observeRemoteRefSha(input.cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3) !== null) throw error;
  }
  if (await observeRemoteRefSha(input.cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3) !== null) {
    fail('provider ledger deletion readback is not absent');
  }
}

async function waitForRunner(
  repository: string,
  name: string,
  cwd: string,
  maximumAttempts = 30
): Promise<Record<string, unknown>> {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const matches = (await listRepositoryRunners(repository, cwd)).filter((runner) => runner.name === name);
    if (matches.length > 1) fail('multiple GitHub runners have the exact operation name');
    if (matches.length === 1 && matches[0]!.status === 'online') return matches[0]!;
    if (attempt < maximumAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  fail('runner did not become online within the bounded join window');
}

function instanceName(providerName: string, role: LocalGitHubActionsRunnerRoleV2): string {
  return runnerName(`${providerName}-${role}`);
}

async function startRunnerInstanceV3(input: Readonly<{
  cwd: string;
  cursor: ProviderLedgerCursorV3;
  role: LocalGitHubActionsRunnerRoleV2;
  cpus: number;
  memory: string;
}>): Promise<LocalGitHubActionsRunnerInstanceV2> {
  const retained = input.cursor.ledger.instances.find((instance) => instance.role === input.role)!;
  const name = retained.name;
  if (retained.containerState !== 'uncreated' || retained.runnerState !== 'uncreated') {
    fail(`provider ledger role ${input.role} is not at its initial generation`);
  }
  if ((await listRepositoryRunners(input.cursor.ledger.repository, input.cwd)).some((runner) => runner.name === name)) {
    fail(`GitHub runner ${name} already exists and is preserved`);
  }
  if (await inspectContainerByName(name, input.cwd, input.cursor.ledger.dockerEndpoint) !== null) {
    fail(`Docker container ${name} already exists and is preserved`);
  }
  const args = [
    'run', '--detach', '--name', name,
    '--entrypoint', '/usr/bin/sleep', '--user', '0',
    '--cap-drop', 'ALL',
    ...(input.role === 'sut'
      ? SUT_CAPABILITIES.flatMap((capability) => ['--cap-add', capability])
      : []),
    '--security-opt', 'no-new-privileges:true',
    '--pids-limit', String(input.role === 'sut' ? SUT_PIDS : 4096),
    '--memory', input.role === 'sut' ? SUT_MEMORY : input.memory,
    '--cpus', String(input.role === 'sut' ? SUT_CPUS : input.cpus),
    '--label', `sec.local-runner.schema=${LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3}`,
    '--label', `sec.local-runner.repository=${input.cursor.ledger.repository}`,
    '--label', `sec.local-runner.provider-name=${input.cursor.ledger.providerName}`,
    '--label', `sec.local-runner.instance-name=${name}`,
    '--label', `sec.local-runner.role=${input.role}`,
    '--label', `sec.local-runner.operation-label=${input.cursor.ledger.operationLabel}`,
    '--label', `sec.local-runner.image-id=${LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2}`,
    '--env', 'RUNNER_ALLOW_RUNASROOT=1', '--env', `RUNNER_NAME=${name}`,
    LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2, 'infinity'
  ];
  const container = await runDockerCommand(input.cursor.ledger.dockerEndpoint, args, { cwd: input.cwd });
  const containerId = container.stdout.toString('utf8').trim();
  if (!/^[0-9a-f]{64}$/u.test(containerId)) fail('Docker returned an invalid container identity');
  const byId = await inspectContainerById(containerId, input.cwd, input.cursor.ledger.dockerEndpoint);
  const byName = await inspectContainerByName(name, input.cwd, input.cursor.ledger.dockerEndpoint);
  if (byId === null || byName === null || byId.Id !== containerId || byName.Id !== containerId) {
    fail('Docker returned container identity differs from exact ID/name readback');
  }
  assertOwnedContainer(byId, {
    repository: input.cursor.ledger.repository,
    providerName: input.cursor.ledger.providerName,
    instanceName: name,
    role: input.role,
    containerId,
    operationLabel: input.cursor.ledger.operationLabel
  });
  await advanceProviderLedgerV3(input.cursor, {
    cwd: input.cwd,
    instances: withLedgerInstance(input.cursor.ledger, input.role, {
      containerId,
      containerState: 'present'
    })
  });
  const token = (await runGitHubApi([
    '--method', 'POST', `repos/${input.cursor.ledger.repository}/actions/runners/registration-token`, '--jq', '.token'
  ], { cwd: input.cwd })).stdout.toString('utf8').trim();
  if (!/^[A-Za-z0-9_-]{20,512}$/u.test(token)) fail('GitHub returned an invalid registration token');
  const configureScript = [
    'IFS= read -r RUNNER_TOKEN',
    'RUNNER_TOKEN="$(printf \'%s\' "$RUNNER_TOKEN" | tr -d \'\\r\\n\')"',
    `./config.sh --url https://${LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3}/${input.cursor.ledger.repository} --token "$RUNNER_TOKEN" `
      + '--unattended --name "$RUNNER_NAME" '
      + `--labels ${LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1},`
      + `${LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2[input.role]},${input.cursor.ledger.operationLabel} --work _work`,
    'unset RUNNER_TOKEN'
  ].join('\n');
  await runDockerCommand(input.cursor.ledger.dockerEndpoint, [
    'exec', '--interactive', containerId, 'bash', '-lc', configureScript
  ], {
    cwd: input.cwd,
    input: Buffer.from(`${token}\n`, 'utf8')
  });
  await runDockerCommand(input.cursor.ledger.dockerEndpoint, [
    'exec', '--detach', containerId, 'bash', '-lc',
    'exec ./run.sh > /tmp/sec-actions-runner.log 2>&1'
  ], { cwd: input.cwd });
  const runner = await waitForRunner(input.cursor.ledger.repository, name, input.cwd, 60);
  const runnerId = assertOwnedLocalGitHubActionsRunnerV2(runner, {
    name,
    role: input.role,
    operationLabel: input.cursor.ledger.operationLabel
  });
  await advanceProviderLedgerV3(input.cursor, {
    cwd: input.cwd,
    instances: withLedgerInstance(input.cursor.ledger, input.role, {
      runnerId,
      runnerState: 'present'
    })
  });
  return runnerInstance({
    role: input.role,
    roleLabel: LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2[input.role],
    name,
    runnerId,
    containerId,
    containerName: name
  });
}

export async function startLocalGitHubActionsProviderV3(input: Readonly<{
  cwd: string;
  repository: string;
  name: string;
  cpus?: number;
  memory?: string;
}>): Promise<LocalGitHubActionsRunnerStateV3> {
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.name);
  const cpus = input.cpus ?? DEFAULT_CPUS;
  const memory = input.memory ?? DEFAULT_MEMORY;
  if (!Number.isSafeInteger(cpus) || cpus < 1 || cpus > 64) fail('cpus is invalid');
  if (!/^[1-9][0-9]{0,2}[gGmM]$/u.test(memory)) fail('memory is invalid');
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentityV2(context.repositoryRoot, repository);
  if (readStateProjection(context.commonDirectory) !== null) {
    fail(`active state already exists at ${statePath(context.commonDirectory)}`);
  }
  const dockerEndpoint = await observeDockerEndpointIdentityV3(context.repositoryRoot);
  const githubEndpoint = await observeGitHubEndpointIdentityV3(context.repositoryRoot, repository);
  await ensureImage(context.repositoryRoot, dockerEndpoint);
  const startedAt = new Date().toISOString();
  const retainedOperationLabel = `sec-operation-${randomBytes(32).toString('hex')}`;
  const cursor = await publishProviderLedgerV3({
    cwd: context.repositoryRoot,
    repository,
    providerName,
    operationLabel: retainedOperationLabel,
    createdAt: startedAt,
    dockerEndpoint,
    githubEndpoint
  });
  const created: LocalGitHubActionsRunnerInstanceV2[] = [];
  try {
    const existingProfile = (await listRepositoryRunners(repository, context.repositoryRoot))
      .filter(isProviderProfileEligibleRunnerV2);
    const existingProfileContainers = await listProviderProfileContainersV3(
      repository, context.repositoryRoot, dockerEndpoint
    );
    if (existingProfile.length !== 0 || existingProfileContainers.length !== 0) {
      fail('profile runners or containers exist outside the newly acquired provider lease and are preserved');
    }
    for (const role of LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2) {
      created.push(await startRunnerInstanceV3({
        cwd: context.repositoryRoot,
        cursor,
        role,
        cpus,
        memory
      }));
    }
    assertExactLocalGitHubActionsRunnerProfileInventoryV3({
      runners: await listRepositoryRunners(repository, context.repositoryRoot),
      instances: created,
      operationLabel: retainedOperationLabel
    });
    assertExactLocalGitHubActionsRunnerProfileContainersV3({
      containers: await listProviderProfileContainersV3(repository, context.repositoryRoot, dockerEndpoint),
      instances: created,
      repository,
      providerName,
      operationLabel: retainedOperationLabel
    });
    await advanceProviderLedgerV3(cursor, { cwd: context.repositoryRoot, lifecycle: 'active' });
    const state = createLocalGitHubActionsRunnerStateV3({
      repository,
      repositoryRoot: context.repositoryRoot,
      commonDirectory: context.commonDirectory,
      providerName,
      operationLabel: retainedOperationLabel,
      providerLedgerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
      providerLedgerObjectSha: cursor.objectSha,
      providerLedgerDigest: cursor.ledger.ledgerDigest,
      dockerEndpoint,
      githubEndpoint,
      instances: created,
      startedAt
    });
    publishState(context.commonDirectory, state);
    return state;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await assertDockerEndpointIdentityV3(cursor.ledger.dockerEndpoint, context.repositoryRoot);
      await assertGitHubEndpointIdentityV3(cursor.ledger.githubEndpoint, context.repositoryRoot);
      if (cursor.ledger.lifecycle !== 'teardown') {
        await advanceProviderLedgerV3(cursor, { cwd: context.repositoryRoot, lifecycle: 'teardown' });
      }
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    for (const role of [...LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2].reverse()) {
      try {
        if (cleanupErrors.length === 0) await cleanupLedgerInstanceV3(cursor, context.repositoryRoot, role);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length === 0) {
      const exactNames = new Set(LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.map((role) =>
        instanceName(providerName, role)));
      const remainingRunners = await listRepositoryRunners(repository, context.repositoryRoot);
      const remainingContainers = await Promise.all([...exactNames].map((name) =>
        inspectContainerByName(name, context.repositoryRoot, dockerEndpoint)));
      const remainingProfileContainers = await listProviderProfileContainersV3(
        repository, context.repositoryRoot, dockerEndpoint
      );
      if (remainingRunners.some((runner) => exactNames.has(String(runner.name))
          || isProviderProfileEligibleRunnerV2(runner)
          || runnerHasLabel(runner, retainedOperationLabel))
          || remainingContainers.some((container) => container !== null)
          || remainingProfileContainers.length !== 0) {
        cleanupErrors.push(new Error('provider start cleanup terminal readback retained residue'));
      }
    }
    if (cleanupErrors.length === 0) {
      try {
        await advanceProviderLedgerV3(cursor, { cwd: context.repositoryRoot, lifecycle: 'terminal' });
        await deleteProviderLedgerV3({
          cwd: context.repositoryRoot,
          objectSha: cursor.objectSha,
          ledger: cursor.ledger
        });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], 'provider start and exact cleanup both failed');
    }
    throw error;
  }
}

function assertProviderLedgerMatchesState(
  ledger: LocalGitHubActionsProviderLedgerV3,
  state: LocalGitHubActionsRunnerStateV3
): void {
  const instances = ledger.instances.map((instance) => ({
    role: instance.role,
    roleLabel: instance.roleLabel,
    name: instance.name,
    runnerId: instance.runnerId,
    containerId: instance.containerId,
    containerName: instance.name
  }));
  if (ledger.lifecycle !== 'active' || instances.some((instance) =>
    instance.runnerId === null || instance.containerId === null)
      || ledger.repository !== state.repository || ledger.providerName !== state.providerName
      || ledger.operationLabel !== state.operationLabel
      || ledger.ledgerDigest !== state.providerLedgerDigest
      || JSON.stringify(ledger.dockerEndpoint) !== JSON.stringify(state.dockerEndpoint)
      || JSON.stringify(ledger.githubEndpoint) !== JSON.stringify(state.githubEndpoint)
      || JSON.stringify(instances) !== JSON.stringify(state.instances)) {
    fail('remote provider ledger differs from local projection');
  }
}

function activeInstancesFromLedgerV3(
  ledger: LocalGitHubActionsProviderLedgerV3
): readonly LocalGitHubActionsRunnerInstanceV2[] {
  return Object.freeze(ledger.instances.map((instance) => {
    if (instance.containerId === null || instance.runnerId === null) {
      fail('provider ledger does not retain a complete instance identity');
    }
    return runnerInstance({
      role: instance.role,
      roleLabel: instance.roleLabel,
      name: instance.name,
      runnerId: instance.runnerId,
      containerId: instance.containerId,
      containerName: instance.name
    });
  }));
}

function assertStateProjectionBoundToLedgerV3(
  state: LocalGitHubActionsRunnerStateV3,
  ledger: LocalGitHubActionsProviderLedgerV3
): void {
  const retained = activeInstancesFromLedgerV3(ledger);
  if (state.repository !== ledger.repository
      || state.providerName !== ledger.providerName
      || state.operationLabel !== ledger.operationLabel
      || JSON.stringify(state.dockerEndpoint) !== JSON.stringify(ledger.dockerEndpoint)
      || JSON.stringify(state.githubEndpoint) !== JSON.stringify(ledger.githubEndpoint)
      || JSON.stringify(state.instances) !== JSON.stringify(retained)) {
    fail('local state projection is not bound to the remote provider ledger');
  }
}

async function assertNoForeignProviderLedgerInventoryV3(
  cursor: ProviderLedgerCursorV3,
  cwd: string
): Promise<void> {
  const ledger = cursor.ledger;
  const runners = await listRepositoryRunners(ledger.repository, cwd);
  const candidates = runners.filter((runner) => isProviderProfileEligibleRunnerV2(runner)
    || runnerHasLabel(runner, ledger.operationLabel)
    || ledger.instances.some((instance) => runner.name === instance.name
      || (instance.runnerId !== null && runner.id === instance.runnerId)));
  for (const runner of candidates) {
    const retained = ledger.instances.find((instance) =>
      instance.name === runner.name || (instance.runnerId !== null && instance.runnerId === runner.id));
    if (retained === undefined || retained.runnerState !== 'present' || retained.runnerId === null
        || retained.runnerId !== runner.id || retained.name !== runner.name) {
      fail('GitHub runner inventory contains an uncommitted or replaced identity and it is preserved');
    }
    assertOwnedLocalGitHubActionsRunnerV2(runner, {
      name: retained.name,
      role: retained.role,
      operationLabel: ledger.operationLabel,
      runnerId: retained.runnerId
    });
  }

  const containers = await listProviderProfileContainersV3(
    ledger.repository, cwd, ledger.dockerEndpoint
  );
  for (const container of containers) {
    const retained = ledger.instances.find((instance) =>
      instance.containerId === container.Id || container.Name === '/' + instance.name);
    if (retained === undefined || retained.containerState !== 'present' || retained.containerId === null
        || retained.containerId !== container.Id || container.Name !== '/' + retained.name) {
      fail('Docker inventory contains an uncommitted or replaced identity and it is preserved');
    }
    assertOwnedContainer(container, {
      repository: ledger.repository,
      providerName: ledger.providerName,
      instanceName: retained.name,
      role: retained.role,
      containerId: retained.containerId,
      operationLabel: ledger.operationLabel
    });
  }
  for (const retained of ledger.instances) {
    const byName = await inspectContainerByName(retained.name, cwd, ledger.dockerEndpoint);
    if (byName !== null && (retained.containerState !== 'present'
        || retained.containerId !== byName.Id)) {
      fail('Docker retained name points to an uncommitted or replaced identity and it is preserved');
    }
  }
}

async function convergeProviderLedgerToTerminalV3(
  cursor: ProviderLedgerCursorV3,
  cwd: string
): Promise<void> {
  await assertDockerEndpointIdentityV3(cursor.ledger.dockerEndpoint, cwd);
  await assertGitHubEndpointIdentityV3(cursor.ledger.githubEndpoint, cwd);
  await assertNoForeignProviderLedgerInventoryV3(cursor, cwd);
  if (cursor.ledger.lifecycle === 'terminal') return;
  if (cursor.ledger.lifecycle !== 'teardown') {
    await advanceProviderLedgerV3(cursor, { cwd, lifecycle: 'teardown' });
  }
  for (const role of [...LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2].reverse()) {
    await cleanupLedgerInstanceV3(cursor, cwd, role);
  }
  await assertNoForeignProviderLedgerInventoryV3(cursor, cwd);
  await advanceProviderLedgerV3(cursor, { cwd, lifecycle: 'terminal' });
}

async function loadCurrentProviderLedgerCursorV3(
  cwd: string,
  repository: string
): Promise<ProviderLedgerCursorV3 | null> {
  const objectSha = await observeRemoteRefSha(cwd, LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3);
  if (objectSha === null) return null;
  let objectType = await runCommand('git', ['cat-file', '-t', objectSha], {
    cwd,
    acceptedCodes: [0, 1, 128]
  });
  if (objectType.code !== 0) {
    await runCommand('git', [
      'fetch', '--no-tags', '--no-write-fetch-head', 'origin',
      LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3
    ], { cwd });
    objectType = await runCommand('git', ['cat-file', '-t', objectSha], { cwd });
  }
  if (objectType.stdout.toString('utf8').trim() !== 'commit') {
    fail('remote provider ledger ref does not resolve to a canonical generation commit');
  }
  return {
    objectSha,
    ledger: await loadProviderLedgerV3({ cwd, repository, objectSha })
  };
}

export async function stopLocalGitHubActionsProviderV3(input: Readonly<{
  cwd: string;
}>): Promise<Readonly<{
  schema: 'sec-local-github-actions-provider-stop-v3';
  repository: string;
  providerName: string;
  runnerCount: number;
  runnersAbsent: true;
  containersAbsent: true;
  providerLedgerAbsent: true;
  imageRetained: true;
}>> {
  const context = await resolveRepositoryContext(input.cwd);
  const projection = readStateProjection(context.commonDirectory);
  if (projection === null) fail('no active state exists at ' + statePath(context.commonDirectory));
  const state = projection.state;
  if (state.repositoryRoot !== context.repositoryRoot || state.commonDirectory !== context.commonDirectory) {
    fail('state repository identity drifted');
  }
  await assertOriginRepositoryIdentityV2(context.repositoryRoot, state.repository);
  const cursor = await loadCurrentProviderLedgerCursorV3(context.repositoryRoot, state.repository);
  if (cursor === null) fail('remote provider ledger is absent while local projection remains');
  await assertDockerEndpointIdentityV3(cursor.ledger.dockerEndpoint, context.repositoryRoot);
  await assertGitHubEndpointIdentityV3(cursor.ledger.githubEndpoint, context.repositoryRoot);
  assertStateProjectionBoundToLedgerV3(state, cursor.ledger);
  if (cursor.ledger.lifecycle === 'active') {
    if (cursor.objectSha !== state.providerLedgerObjectSha
        || cursor.ledger.ledgerDigest !== state.providerLedgerDigest) {
      fail('active remote provider ledger differs from local projection generation');
    }
    assertProviderLedgerMatchesState(cursor.ledger, state);
  }
  await convergeProviderLedgerToTerminalV3(cursor, context.repositoryRoot);
  deleteStateProjection(context.commonDirectory, state);
  await deleteProviderLedgerV3({
    cwd: context.repositoryRoot,
    objectSha: cursor.objectSha,
    ledger: cursor.ledger
  });
  return Object.freeze({
    schema: 'sec-local-github-actions-provider-stop-v3' as const,
    repository: state.repository,
    providerName: state.providerName,
    runnerCount: state.instances.length,
    runnersAbsent: true as const,
    containersAbsent: true as const,
    providerLedgerAbsent: true as const,
    imageRetained: true as const
  });
}

export async function recoverLocalGitHubActionsProviderV3(input: Readonly<{
  cwd: string;
  repository: string;
  name: string;
}>): Promise<Readonly<{
  schema: 'sec-local-github-actions-provider-recovery-v3';
  repository: string;
  providerName: string;
  runnersAbsent: true;
  containersAbsent: true;
  providerLedgerAbsent: true;
}>> {
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.name);
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentityV2(context.repositoryRoot, repository);
  const projection = readStateProjection(context.commonDirectory);
  const cursor = await loadCurrentProviderLedgerCursorV3(context.repositoryRoot, repository);
  if (cursor === null) {
    if (projection !== null) {
      fail('local state projection remains without remote destructive identity authority');
    }
    await observeGitHubEndpointIdentityV3(context.repositoryRoot, repository);
    const dockerEndpoint = await observeDockerEndpointIdentityV3(context.repositoryRoot);
    const exactNames = new Set(LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.map((role) =>
      instanceName(providerName, role)));
    const runners = await listRepositoryRunners(repository, context.repositoryRoot);
    const containers = await listProviderProfileContainersV3(
      repository, context.repositoryRoot, dockerEndpoint
    );
    const namedContainers = await Promise.all([...exactNames].map((name) =>
      inspectContainerByName(name, context.repositoryRoot, dockerEndpoint)));
    if (runners.some((runner) => exactNames.has(String(runner.name))
        || isProviderProfileEligibleRunnerV2(runner)) || containers.length !== 0
        || namedContainers.some((container) => container !== null)) {
      fail('provider residue exists without remote exact-ID ledger authority and is preserved');
    }
  } else {
    if (cursor.ledger.repository !== repository || cursor.ledger.providerName !== providerName) {
      fail('remote provider ledger belongs to another operation and is preserved');
    }
    await assertDockerEndpointIdentityV3(cursor.ledger.dockerEndpoint, context.repositoryRoot);
    await assertGitHubEndpointIdentityV3(cursor.ledger.githubEndpoint, context.repositoryRoot);
    if (projection !== null) {
      if (projection.state.repositoryRoot !== context.repositoryRoot
          || projection.state.commonDirectory !== context.commonDirectory) {
        fail('state repository identity drifted');
      }
      assertStateProjectionBoundToLedgerV3(projection.state, cursor.ledger);
    }
    await convergeProviderLedgerToTerminalV3(cursor, context.repositoryRoot);
    if (projection !== null) deleteStateProjection(context.commonDirectory, projection.state);
    await deleteProviderLedgerV3({
      cwd: context.repositoryRoot,
      objectSha: cursor.objectSha,
      ledger: cursor.ledger
    });
  }
  return Object.freeze({
    schema: 'sec-local-github-actions-provider-recovery-v3' as const,
    repository,
    providerName,
    runnersAbsent: true as const,
    containersAbsent: true as const,
    providerLedgerAbsent: true as const
  });
}

export async function observeLocalGitHubActionsProviderV3(input: Readonly<{ cwd: string }>) {
  const context = await resolveRepositoryContext(input.cwd);
  const repository = await assertOriginRepositoryIdentityV2(context.repositoryRoot);
  const projection = readStateProjection(context.commonDirectory);
  const cursor = await loadCurrentProviderLedgerCursorV3(context.repositoryRoot, repository);
  if (cursor === null) {
    if (projection !== null) {
      return Object.freeze({
        status: 'residue' as const,
        statePath: statePath(context.commonDirectory),
        repository,
        reason: 'local-projection-without-remote-ledger'
      });
    }
    await observeGitHubEndpointIdentityV3(context.repositoryRoot, repository);
    const dockerEndpoint = await observeDockerEndpointIdentityV3(context.repositoryRoot);
    const profileRunners = (await listRepositoryRunners(repository, context.repositoryRoot))
      .filter(isProviderProfileEligibleRunnerV2);
    const profileContainers = await listProviderProfileContainersV3(
      repository, context.repositoryRoot, dockerEndpoint
    );
    if (profileRunners.length === 0 && profileContainers.length === 0) {
      return Object.freeze({
        status: 'absent' as const,
        statePath: statePath(context.commonDirectory),
        repository
      });
    }
    return Object.freeze({
      status: 'residue' as const,
      statePath: statePath(context.commonDirectory),
      repository,
      reason: 'objects-without-remote-ledger',
      profileRunnerCount: profileRunners.length,
      profileContainerCount: profileContainers.length
    });
  }

  if (cursor.ledger.repository.toLowerCase() !== repository.toLowerCase()) {
    fail('remote provider ledger repository differs from origin and is preserved');
  }
  await assertDockerEndpointIdentityV3(cursor.ledger.dockerEndpoint, context.repositoryRoot);
  await assertGitHubEndpointIdentityV3(cursor.ledger.githubEndpoint, context.repositoryRoot);
  if (projection !== null) assertStateProjectionBoundToLedgerV3(projection.state, cursor.ledger);
  await assertNoForeignProviderLedgerInventoryV3(cursor, context.repositoryRoot);

  if (cursor.ledger.lifecycle !== 'active' || projection === null) {
    return Object.freeze({
      status: 'residue' as const,
      statePath: statePath(context.commonDirectory),
      repository,
      providerLedgerPresent: true,
      lifecycle: cursor.ledger.lifecycle,
      generation: cursor.ledger.generation
    });
  }
  const state = projection.state;
  if (cursor.objectSha !== state.providerLedgerObjectSha
      || cursor.ledger.ledgerDigest !== state.providerLedgerDigest) {
    fail('active provider ledger generation differs from local projection');
  }
  assertProviderLedgerMatchesState(cursor.ledger, state);
  const instances = activeInstancesFromLedgerV3(cursor.ledger);
  const runners = await listRepositoryRunners(repository, context.repositoryRoot);
  assertExactLocalGitHubActionsRunnerProfileInventoryV3({
    runners,
    instances,
    operationLabel: cursor.ledger.operationLabel
  });
  const containers = await listProviderProfileContainersV3(
    repository, context.repositoryRoot, cursor.ledger.dockerEndpoint
  );
  assertExactLocalGitHubActionsRunnerProfileContainersV3({
    containers,
    instances,
    repository,
    providerName: cursor.ledger.providerName,
    operationLabel: cursor.ledger.operationLabel
  });
  const image = await inspectImage(context.repositoryRoot, cursor.ledger.dockerEndpoint);
  if (image !== null) assertImageIdentity(image);
  const observations = instances.map((instance) => {
    const runner = runners.find((candidate) =>
      candidate.name === instance.name && candidate.id === instance.runnerId) ?? null;
    return Object.freeze({ instance, runner, containerPresent: true });
  });
  const online = image !== null && observations.every(({ runner }) =>
    runner !== null && runner.status === 'online');
  return Object.freeze({
    status: online ? 'online' as const : 'residue' as const,
    state,
    providerLedgerPresent: true,
    imagePresent: image !== null,
    instances: Object.freeze(observations)
  });
}

export async function retireSupersededLocalGitHubActionsRunnerImageV3(input: Readonly<{
  cwd: string;
  imageId: string;
}>): Promise<Readonly<{
  schema: 'sec-local-github-actions-image-retirement-v3';
  imageId: string;
  replacementImageId: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2;
  decision: string;
  zeroContainerReferences: true;
  imageAbsent: true;
}>> {
  const decision = LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3.find(
    (candidate) => candidate.imageId === input.imageId
  );
  if (decision === undefined) fail('image is not covered by a canonical superseded decision');
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentityV2(context.repositoryRoot);
  if (await observeRemoteRefSha(
    context.repositoryRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3
  ) !== null) {
    fail('image retirement is blocked while the provider ledger is active');
  }
  const endpoint = await observeDockerEndpointIdentityV3(context.repositoryRoot);
  const replacement = await inspectImageById(
    decision.replacementImageId,
    context.repositoryRoot,
    endpoint
  );
  if (replacement === null) fail('superseding frozen image is absent');
  assertImageIdentity(replacement);
  const references = await listContainerIdentityRows(context.repositoryRoot, endpoint, [
    '--filter', `ancestor=${decision.imageId}`
  ]);
  if (references.length !== 0) {
    fail('superseded image still has container references and is preserved');
  }
  if (await inspectImageById(decision.imageId, context.repositoryRoot, endpoint) !== null) {
    await assertDockerEndpointIdentityV3(endpoint, context.repositoryRoot);
    await runDockerCommand(endpoint, ['image', 'rm', decision.imageId], {
      cwd: context.repositoryRoot
    });
  }
  if (await inspectImageById(decision.imageId, context.repositoryRoot, endpoint) !== null
      || (await listContainerIdentityRows(context.repositoryRoot, endpoint, [
        '--filter', `ancestor=${decision.imageId}`
      ])).length !== 0) {
    fail('superseded image retirement readback is not absent');
  }
  await assertDockerEndpointIdentityV3(endpoint, context.repositoryRoot);
  return Object.freeze({
    schema: 'sec-local-github-actions-image-retirement-v3' as const,
    imageId: decision.imageId,
    replacementImageId: decision.replacementImageId,
    decision: decision.decision,
    zeroContainerReferences: true as const,
    imageAbsent: true as const
  });
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`);
  if (args.indexOf(name, index + 1) >= 0) fail(`${name} is duplicated`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const cwd = option(args, '--workspace') ?? process.cwd();
  if (command === 'start') {
    const repository = option(args, '--repository');
    const name = option(args, '--name');
    if (repository === undefined || name === undefined) fail('start requires --repository and --name');
    const cpus = option(args, '--cpus');
    const memory = option(args, '--memory');
    const state = await startLocalGitHubActionsProviderV3({
      cwd,
      repository,
      name,
      cpus: cpus === undefined ? undefined : Number(cpus),
      memory
    });
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(await observeLocalGitHubActionsProviderV3({ cwd }), null, 2)}\n`);
    return;
  }
  if (command === 'stop') {
    if (args.includes('--remove-image')) fail('active image retirement is not an ordinary stop authority');
    process.stdout.write(`${JSON.stringify(await stopLocalGitHubActionsProviderV3({ cwd }), null, 2)}\n`);
    return;
  }
  if (command === 'recover') {
    const repository = option(args, '--repository');
    const name = option(args, '--name');
    if (repository === undefined || name === undefined) fail('recover requires --repository and --name');
    process.stdout.write(`${JSON.stringify(await recoverLocalGitHubActionsProviderV3({
      cwd,
      repository,
      name
    }), null, 2)}\n`);
    return;
  }
  if (command === 'retire-superseded-image') {
    const imageId = option(args, '--image-id');
    if (imageId === undefined) fail('retire-superseded-image requires --image-id');
    process.stdout.write(`${JSON.stringify(await retireSupersededLocalGitHubActionsRunnerImageV3({
      cwd,
      imageId
    }), null, 2)}\n`);
    return;
  }
  fail('usage: start --repository owner/name --name provider-name [--workspace path] [--cpus n] [--memory 12g] | status [--workspace path] | stop [--workspace path] | recover --repository owner/name --name provider-name [--workspace path] | retire-superseded-image --image-id sha256:... [--workspace path]');
}

if (import.meta.main) await main();
