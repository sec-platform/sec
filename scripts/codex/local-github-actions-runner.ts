import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1,
  SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST_V1
} from '../../platform/runtime/environments/sec-linux-verification-v1/authority.ts';
import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1 } from '../../platform/shared/ci-verification-revision.ts';
import {
  compileEnvironmentMaterializationPlanV1,
  createEnvironmentMaterializationGenerationV1,
  createEnvironmentMaterializationSpecV1,
  parseEnvironmentMaterializationGenerationV1,
  transitionEnvironmentMaterializationGenerationV1,
  type EnvironmentMaterializationGenerationV1
} from '../../platform/shared/environment-materialization-contract.ts';
import {
  acquirePhysicalMutationLeaseV1,
  type PhysicalMutationLeaseHandleV1,
  type PhysicalMutationLeaseOwnerV1
} from '../../platform/shared/physical-mutation-lease.ts';
import {
  createNoFollowDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChildV1,
  inspectNoFollowOrdinaryFileDigestV1,
  inspectNoFollowOrdinaryFileEntryV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  replaceDurableCanonicalFileV1,
  scanNoFollowDirectoryTreeMetadataV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import {
  currentSecRuntimePlatformV1,
  resolveSecRuntimeCacheLayoutV1,
  secRuntimeStateEnvironmentV1
} from '../../platform/shared/sec-runtime-state-contract.ts';
import {
  acquireSecRuntimeCachePhysicalAuthorityV1,
  acquireSecRuntimeStatePhysicalAuthorityV1
} from '../../tooling/sec-dev/runtime-state-authority.ts';
import {
  resolveSecRuntimeStateForRepositoryV1,
  resolveSecWorkspaceRuntimeRootsV1
} from '../../tooling/sec-dev/runtime-state-paths.ts';

export const LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3 =
  'sec-local-github-actions-provider-state-v3' as const;
// The frozen image is an execution artifact, not a provider-state projection.
// Keep its immutable lineage label independent from later state/ledger schema
// revisions so a control-plane migration cannot invalidate byte-identical
// cached Linux capacity or silently demand a mutable rebuild.
export const LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_SCHEMA_V3 =
  'sec-local-github-actions-provider-ledger-v3' as const;
export const LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_INTENT_SCHEMA_V1 =
  'sec-local-github-actions-provider-ensure-intent-v1' as const;
export const LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_RECEIPT_SCHEMA_V2 =
  'sec-local-github-actions-provider-ensure-receipt-v2' as const;
export const LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2 = 'provider-ensure/v2' as const;
export const LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_INTENT_SCHEMA_V1 =
  'sec-local-github-actions-provider-settlement-intent-v1' as const;
export const LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_RECEIPT_SCHEMA_V1 =
  'sec-local-github-actions-provider-settlement-receipt-v1' as const;
export const LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_LAYOUT_V1 = 'settlement' as const;
const ENVIRONMENT = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1;
export const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1 = ENVIRONMENT.image.lineageSchema;
export const LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1 = ENVIRONMENT.archives.runner.version;
export const LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1 =
  ENVIRONMENT.archives.runner.digest.slice(7);
export const LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1 =
  ENVIRONMENT.ubuntu.baseReference;
export const LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1 = ENVIRONMENT.archives.node.version;
export const LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1 =
  ENVIRONMENT.archives.node.digest.slice(7);
export const LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1 = ENVIRONMENT.runtime.pythonVersion;
export const LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1 = ENVIRONMENT.archives.githubCli.version;
export const LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1 =
  ENVIRONMENT.archives.githubCli.digest.slice(7);
export const LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT_V1 = ENVIRONMENT.ubuntu.snapshot;
export const LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH_V1 = String(ENVIRONMENT.provider.sourceDateEpoch);
export const LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND_V1 =
  ENVIRONMENT.provider.dockerfileFrontend.reference;
export const LOCAL_GITHUB_ACTIONS_BUILDX_BUILDER_NAME_V1 =
  ENVIRONMENT.provider.buildx.builderName;
export const LOCAL_GITHUB_ACTIONS_BUILDX_NODE_NAME_V1 =
  ENVIRONMENT.provider.buildx.nodeName;
export const LOCAL_GITHUB_ACTIONS_BUILDX_DRIVER_V1 = ENVIRONMENT.provider.buildx.driver;
export const LOCAL_GITHUB_ACTIONS_BUILDKIT_IMAGE_V1 = ENVIRONMENT.provider.buildx.buildkitImage;
export const LOCAL_GITHUB_ACTIONS_BUILDKIT_IMAGE_ID_V1 = ENVIRONMENT.provider.buildx.buildkitImageId;
export const LOCAL_GITHUB_ACTIONS_BUILDX_CACHE_NAMESPACE_V1 =
  ENVIRONMENT.provider.buildx.cacheNamespace;
export const LOCAL_GITHUB_ACTIONS_BUILDX_ALLOW_NETWORK_HOST_V1 =
  ENVIRONMENT.provider.buildx.allowNetworkHost;
export const LOCAL_GITHUB_ACTIONS_BUILDX_GC_POLICY_V1 = ENVIRONMENT.provider.buildx.gcPolicy;
export const LOCAL_GITHUB_ACTIONS_BUILDX_KEEP_STORAGE_MEGABYTES_V1 =
  ENVIRONMENT.provider.buildx.keepStorageMegabytes;
export const LOCAL_GITHUB_ACTIONS_BUILDX_KEEP_STORAGE_BYTES_V1 =
  LOCAL_GITHUB_ACTIONS_BUILDX_KEEP_STORAGE_MEGABYTES_V1 * 1_000_000;
export const LOCAL_GITHUB_ACTIONS_BUILDX_GC_SWEEP_TIMEOUT_MS_V1 =
  ENVIRONMENT.provider.buildx.gcSweepTimeoutMs;

export function createLocalGitHubActionsBuildxBuildkitdFlagsV1(): readonly string[] {
  return Object.freeze([
    '--oci-worker-gc',
    '--oci-worker-gc-keepstorage',
    String(LOCAL_GITHUB_ACTIONS_BUILDX_KEEP_STORAGE_MEGABYTES_V1),
    ...(LOCAL_GITHUB_ACTIONS_BUILDX_ALLOW_NETWORK_HOST_V1
      ? ['--allow-insecure-entitlement=network.host']
      : [])
  ]);
}
export const LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE_V1 = ENVIRONMENT.archives.bootstrapCa.version;
export const LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256_V1 =
  ENVIRONMENT.archives.bootstrapCa.digest.slice(7);
export const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2 =
  ENVIRONMENT.image.buildRevision;
export const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1 =
  `${ENVIRONMENT.image.name}:${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1}-${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2}`;
// Frozen after the canonical Dockerfile is built once. Rebuilding mutable apt
// inputs under the same semantic provider revision must fail this identity.
export const LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2 =
  ENVIRONMENT.image.dockerProjectionDigest;
export const LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1 =
  ENVIRONMENT.image.runtimeContentDigest;
export const LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_V7_IMAGE_ID_V1 =
  (() => {
    const retirement = ENVIRONMENT.image.retirements.find(({ imageTag }) =>
      imageTag.endsWith('-archive-v7'));
    if (retirement === undefined) {
      throw new Error('SEC Linux verification environment authority lacks the v7 retirement identity.');
    }
    return retirement.imageId;
  })();
export const LOCAL_GITHUB_ACTIONS_RUNNER_CONTAINER_INIT_CAPABILITY_V1 =
  ENVIRONMENT.runtime.containerInitCapability;
export const LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RECEIPT_SCHEMA_V1 =
  ENVIRONMENT.provenance.receiptSchema;
export const LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3 =
  ENVIRONMENT.image.retirements;
export const LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1 = ENVIRONMENT.runtime.labels;
export const LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1 =
  LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1[3];
export const LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2 = ENVIRONMENT.runtime.roleLabels;
export type LocalGitHubActionsRunnerRoleV2 = keyof typeof LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2;
const LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2 = Object.freeze([
  'control', 'trusted', 'sut'
] as const satisfies readonly LocalGitHubActionsRunnerRoleV2[]);
export const LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3 =
  `refs/tags/sec-provider-lease-${ENVIRONMENT.environmentId}`;
export const LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3 = ENVIRONMENT.provider.githubHost;

const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const SUT_CAPABILITIES = CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outerSutContainerCapabilities;
const RUNNER_OCI_MATERIALIZATION_LEASE_NAME_V1 = 'materialization-lease.json';
/**
 * One provider-wide mutation fence.  It is deliberately kept beside the
 * replaceable provider receipt rather than beside any individual effect so
 * ensure, consumer transitions, stop and recovery serialize on the same
 * identity.  The OCI lease remains a nested lower-level fence.
 */
export const LOCAL_GITHUB_ACTIONS_PROVIDER_MUTATION_LEASE_NAME_V1 =
  'provider-mutation-lease.json' as const;
const RUNNER_OCI_CANDIDATE_PREFIX_V1 = 'candidate-';
const RUNNER_OCI_GENERATION_FILE_NAME_V1 = 'generation.json';
const RUNNER_OCI_CLEANUP_MAXIMUM_ENTRIES_V1 = 1_000_000;
const RUNNER_OCI_CLEANUP_BUDGET_MS_V1 = 5 * 60_000;

export function createLocalGitHubActionsProviderResourceBindingV1():
LocalGitHubActionsProviderResourceBindingV1 {
  const roles = Object.freeze(LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.map((role) => {
    const resources = ENVIRONMENT.runtime.resources[role];
    return Object.freeze({
      role,
      cpus: resources.cpus,
      memoryBytes: resources.memoryGiB * 1024 * 1024 * 1024,
      pids: resources.pids,
      capAdd: Object.freeze(role === 'sut'
        ? SUT_CAPABILITIES.map((capability) => `CAP_${capability}`).sort()
        : [])
    });
  }));
  const material = Object.freeze({
    schema: 'sec-local-github-actions-provider-resource-binding-v1' as const,
    roles
  });
  return Object.freeze({
    ...material,
    digest: sha256(material) as `sha256:${string}`
  });
}

export interface LocalGitHubActionsProviderResourceRoleV1 {
  readonly role: LocalGitHubActionsRunnerRoleV2;
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly pids: number;
  readonly capAdd: readonly string[];
}

export interface LocalGitHubActionsProviderResourceBindingV1 {
  readonly schema: 'sec-local-github-actions-provider-resource-binding-v1';
  readonly roles: readonly LocalGitHubActionsProviderResourceRoleV1[];
  readonly digest: `sha256:${string}`;
}

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
  readonly resourceBinding: LocalGitHubActionsProviderResourceBindingV1;
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
  readonly resourceBinding: LocalGitHubActionsProviderResourceBindingV1;
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

/** Exact current provider state consumed by an ensure receipt. */
export interface LocalGitHubActionsProviderEnsureDesiredV1 {
  readonly schema: 'sec-local-github-actions-provider-ensure-desired-v1';
  readonly repository: string;
  readonly providerName: string;
  readonly operationLabel: string;
  readonly providerLedgerRef: typeof LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3;
  readonly providerLedgerObjectSha: string;
  readonly providerLedgerDigest: `sha256:${string}`;
  readonly generation: number;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly githubEndpoint: GitHubEndpointIdentityV3;
  readonly imageId: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2;
  readonly resourceBinding: LocalGitHubActionsProviderResourceBindingV1;
  readonly instances: readonly LocalGitHubActionsRunnerInstanceV2[];
  readonly stateDigest: `sha256:${string}`;
  readonly desiredDigest: `sha256:${string}`;
}

/**
 * Durable pre-effect claim.  It is intentionally not an effect authority by
 * itself; the provider still re-observes and validates every endpoint before
 * the first Docker/GitHub mutation.
 */
export interface LocalGitHubActionsProviderEnsureIntentV1 {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_INTENT_SCHEMA_V1;
  readonly repository: string;
  readonly providerName: string;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly githubEndpoint: GitHubEndpointIdentityV3;
  readonly imageId: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2;
  readonly resourceBinding: LocalGitHubActionsProviderResourceBindingV1;
  readonly environmentInputDigest: `sha256:${string}`;
  readonly desiredDigest: `sha256:${string}`;
  readonly issuedAt: string;
  readonly intentDigest: `sha256:${string}`;
}

/** One replaceable current receipt; no immutable receipt history is emitted. */
export interface LocalGitHubActionsProviderConsumerBindingV1 {
  readonly consumerId: string;
  readonly acquiredFromReceiptDigest: `sha256:${string}`;
  readonly acquiredAtEpoch: number;
  readonly leaseId: `sha256:${string}`;
  readonly credential: `sha256:${string}`;
}

export interface LocalGitHubActionsProviderEnsureReceiptV2 {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_RECEIPT_SCHEMA_V2;
  readonly repository: string;
  readonly providerName: string;
  readonly outcome: 'started-fresh' | 'already-healthy' | 'reconciled';
  readonly desired: LocalGitHubActionsProviderEnsureDesiredV1;
  readonly resourceBinding: LocalGitHubActionsProviderResourceBindingV1;
  readonly intentDigest: `sha256:${string}`;
  readonly endpointDigest: `sha256:${string}`;
  readonly builderObservationDigest: `sha256:${string}`;
  readonly ociBinding: LocalGitHubActionsRunnerOciProviderBindingV1;
  readonly reconciledContainers: readonly string[];
  readonly leaseId: `sha256:${string}`;
  readonly transitionEpoch: number;
  readonly consumers: readonly LocalGitHubActionsProviderConsumerBindingV1[];
  readonly consumerCount: number;
  readonly observedAt: string;
  readonly receiptDigest: `sha256:${string}`;
}

export type LocalGitHubActionsProviderSettlementReasonV1 =
  'stop' | 'recover' | 'start-failure';

export interface LocalGitHubActionsProviderSettlementIntentV1 {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_INTENT_SCHEMA_V1;
  readonly repository: string;
  readonly providerName: string;
  readonly operationLabel: string | null;
  readonly desiredDigest: `sha256:${string}` | null;
  readonly providerLedgerObjectSha: string | null;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly githubEndpoint: GitHubEndpointIdentityV3;
  readonly resourceBinding: LocalGitHubActionsProviderResourceBindingV1;
  readonly reason: LocalGitHubActionsProviderSettlementReasonV1;
  readonly issuedAt: string;
  readonly intentDigest: `sha256:${string}`;
}

export interface LocalGitHubActionsProviderSettlementReceiptV1 {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_RECEIPT_SCHEMA_V1;
  readonly repository: string;
  readonly providerName: string;
  readonly operationLabel: string | null;
  readonly desiredDigest: `sha256:${string}` | null;
  readonly providerLedgerObjectSha: string | null;
  readonly dockerEndpoint: DockerEndpointIdentityV3;
  readonly githubEndpoint: GitHubEndpointIdentityV3;
  readonly resourceBinding: LocalGitHubActionsProviderResourceBindingV1;
  readonly reason: LocalGitHubActionsProviderSettlementReasonV1;
  readonly intentIssuedAt: string;
  readonly intentDigest: `sha256:${string}`;
  readonly runnersAbsent: true;
  readonly containersAbsent: true;
  readonly providerLedgerAbsent: true;
  readonly stateProjectionAbsent: true;
  readonly ensureCurrentAbsent: true;
  readonly ensureIntentAbsent: true;
  readonly imageRetained: true;
  readonly ociGenerationDigest: `sha256:${string}` | null;
  readonly ociReceiptDigest: `sha256:${string}` | null;
  readonly observedAt: string;
  readonly receiptDigest: `sha256:${string}`;
}

export interface LocalGitHubActionsBuildxBuilderObservationV1 {
  readonly schema: 'sec-local-github-actions-buildx-builder-observation-v1';
  readonly builderName: typeof LOCAL_GITHUB_ACTIONS_BUILDX_BUILDER_NAME_V1;
  readonly driver: typeof LOCAL_GITHUB_ACTIONS_BUILDX_DRIVER_V1;
  readonly cacheNamespace: typeof LOCAL_GITHUB_ACTIONS_BUILDX_CACHE_NAMESPACE_V1;
  readonly gcPolicy: typeof LOCAL_GITHUB_ACTIONS_BUILDX_GC_POLICY_V1;
  readonly buildkitdFlags: readonly string[];
  readonly dockerEndpointDigest: `sha256:${string}`;
  readonly nodes: readonly Readonly<{
    name: string;
    status: 'running';
    version: string;
    gcPolicyDigest: `sha256:${string}`;
  }>[];
  readonly observationDigest: `sha256:${string}`;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export interface BuildxRawJsonProgressAdmissionV1 {
  readonly push: (chunk: Buffer) => boolean;
  readonly finish: () => boolean;
}

export function createBuildxRawJsonProgressAdmissionV1(): BuildxRawJsonProgressAdmissionV1 {
  let pending = '';
  const vertexPhases = new Set<string>();
  const statusCurrentByVertex = new Map<string, number>();
  const statusCompleted = new Set<string>();

  const admitLine = (line: string): boolean => {
    if (line.length === 0 || line.length > 1024 * 1024) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const event = parsed as Record<string, unknown>;
    let admitted = false;
    if (Array.isArray(event.vertexes)) {
      for (const candidate of event.vertexes) {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const vertex = candidate as Record<string, unknown>;
        if (typeof vertex.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(vertex.digest)) continue;
        for (const phase of ['observed', 'started', 'completed', 'cached', 'error'] as const) {
          const present = phase === 'observed'
            || (phase === 'cached' ? vertex.cached === true : typeof vertex[phase] === 'string');
          if (present && !vertexPhases.has(`${vertex.digest}:${phase}`)) {
            vertexPhases.add(`${vertex.digest}:${phase}`);
            admitted = true;
          }
        }
      }
    }
    if (Array.isArray(event.statuses)) {
      for (const candidate of event.statuses) {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const status = candidate as Record<string, unknown>;
        if (typeof status.vertex !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(status.vertex)
            || typeof status.id !== 'string' || status.id.length === 0 || status.id.length > 4096
            || !Number.isSafeInteger(status.current) || (status.current as number) < 0
            || !vertexPhases.has(`${status.vertex}:observed`)) continue;
        // `status.id` is provider presentation state and is not a semantic
        // frontier. A provider may mint an unbounded series of IDs for the
        // same vertex; only monotonic aggregate work for that vertex may keep
        // the stall deadline alive.
        const previous = statusCurrentByVertex.get(status.vertex);
        if (previous === undefined || (status.current as number) > previous) {
          statusCurrentByVertex.set(status.vertex, status.current as number);
          admitted = true;
        }
        if (typeof status.completed === 'string' && !statusCompleted.has(status.vertex)) {
          statusCompleted.add(status.vertex);
          admitted = true;
        }
      }
    }
    // BuildKit logs are presentation evidence. They never prove monotonic work
    // and therefore cannot refresh the semantic stall deadline.
    return admitted;
  };

  const consume = (final: boolean): boolean => {
    const lines = pending.split(/\r?\n/u);
    if (final) {
      pending = '';
      return lines.reduce((admitted, line) => admitLine(line) || admitted, false);
    }
    pending = lines.pop() ?? '';
    return lines.reduce((admitted, line) => admitLine(line) || admitted, false);
  };

  return Object.freeze({
    push: (chunk: Buffer): boolean => {
      pending += chunk.toString('utf8');
      if (pending.length > 2 * 1024 * 1024 && !/[\r\n]/u.test(pending)) {
        pending = '';
        return false;
      }
      return consume(false);
    },
    finish: (): boolean => consume(true)
  });
}

interface GitHubApiSessionV3 {
  readonly token: string;
  readonly principal: string;
}

const githubApiSessionsV3 = new Map<string, GitHubApiSessionV3>();

export const LOCAL_GITHUB_ACTIONS_DOCKER_COMMAND_ENV_KEYS_V1 = Object.freeze([
  'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_HOST', 'HOME', 'PATH',
  'PROGRAMFILES', 'SYSTEMROOT', 'USERPROFILE', 'WINDIR'
] as const);

const COMMAND_ENV_KEYS = Object.freeze({
  docker: LOCAL_GITHUB_ACTIONS_DOCKER_COMMAND_ENV_KEYS_V1,
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

function providerResourceRoleV1(
  role: LocalGitHubActionsRunnerRoleV2
): LocalGitHubActionsProviderResourceRoleV1 {
  const entry = createLocalGitHubActionsProviderResourceBindingV1().roles.find(
    (candidate) => candidate.role === role
  );
  if (entry === undefined) fail(`resource binding lacks role ${role}`);
  return entry;
}

function assertCanonicalProviderResourceBindingV1(
  value: unknown,
  label = 'provider resource binding'
): LocalGitHubActionsProviderResourceBindingV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} is invalid`);
  }
  const expected = createLocalGitHubActionsProviderResourceBindingV1();
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(`${label} differs from EnvironmentSpec`);
  }
  return expected;
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

export function parseDockerEndpointIdentityV3(value: unknown): DockerEndpointIdentityV3 {
  return dockerEndpointIdentity(value as DockerEndpointIdentityV3);
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

function settlementReasonV1(value: unknown): LocalGitHubActionsProviderSettlementReasonV1 {
  if (value !== 'stop' && value !== 'recover' && value !== 'start-failure') {
    fail('provider settlement reason is invalid');
  }
  return value;
}

function nullableDigestV1(value: unknown, label: string): `sha256:${string}` | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be a SHA-256 digest or null`);
  }
  return value as `sha256:${string}`;
}

function nullableGitObjectShaV1(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    fail(`${label} must be a Git object SHA or null`);
  }
  return value;
}

export function createLocalGitHubActionsProviderSettlementIntentV1(
  input: Omit<LocalGitHubActionsProviderSettlementIntentV1,
    'schema' | 'resourceBinding' | 'intentDigest'>
): LocalGitHubActionsProviderSettlementIntentV1 {
  const operation = input.operationLabel === null ? null : operationLabel(input.operationLabel);
  const material = Object.freeze({
    schema: LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_INTENT_SCHEMA_V1,
    repository: repositoryName(input.repository),
    providerName: providerBaseName(input.providerName),
    operationLabel: operation,
    desiredDigest: nullableDigestV1(input.desiredDigest, 'provider settlement desiredDigest'),
    providerLedgerObjectSha: nullableGitObjectShaV1(
      input.providerLedgerObjectSha, 'provider settlement providerLedgerObjectSha'
    ),
    dockerEndpoint: dockerEndpointIdentity(input.dockerEndpoint),
    githubEndpoint: githubEndpointIdentity(input.githubEndpoint),
    resourceBinding: createLocalGitHubActionsProviderResourceBindingV1(),
    reason: settlementReasonV1(input.reason),
    issuedAt: (() => {
      const issuedAt = new Date(input.issuedAt).toISOString();
      if (issuedAt !== input.issuedAt) fail('provider settlement intent issuedAt is not canonical');
      return issuedAt;
    })()
  });
  return Object.freeze({
    ...material,
    intentDigest: sha256(material) as `sha256:${string}`
  });
}

export function parseLocalGitHubActionsProviderSettlementIntentV1(
  source: string
): LocalGitHubActionsProviderSettlementIntentV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('provider settlement intent is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('provider settlement intent shape is invalid');
  }
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'repository', 'providerName', 'operationLabel', 'desiredDigest',
    'providerLedgerObjectSha', 'dockerEndpoint', 'githubEndpoint', 'resourceBinding',
    'reason', 'issuedAt', 'intentDigest'
  ], 'provider settlement intent');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_INTENT_SCHEMA_V1) {
    fail('provider settlement intent schema is invalid');
  }
  const intent = createLocalGitHubActionsProviderSettlementIntentV1({
    repository: value.repository as string,
    providerName: value.providerName as string,
    operationLabel: value.operationLabel as string | null,
    desiredDigest: value.desiredDigest as `sha256:${string}` | null,
    providerLedgerObjectSha: value.providerLedgerObjectSha as string | null,
    dockerEndpoint: value.dockerEndpoint as DockerEndpointIdentityV3,
    githubEndpoint: value.githubEndpoint as GitHubEndpointIdentityV3,
    reason: value.reason as LocalGitHubActionsProviderSettlementReasonV1,
    issuedAt: value.issuedAt as string
  });
  assertCanonicalProviderResourceBindingV1(value.resourceBinding, 'provider settlement intent resource binding');
  if (intent.intentDigest !== value.intentDigest) fail('provider settlement intent digest mismatch');
  return intent;
}

export function createLocalGitHubActionsProviderSettlementReceiptV1(
  input: Omit<LocalGitHubActionsProviderSettlementReceiptV1,
    'schema' | 'resourceBinding' | 'receiptDigest'>
): LocalGitHubActionsProviderSettlementReceiptV1 {
  const operation = input.operationLabel === null ? null : operationLabel(input.operationLabel);
  if (!input.runnersAbsent || !input.containersAbsent || !input.providerLedgerAbsent
      || !input.stateProjectionAbsent || !input.ensureCurrentAbsent || !input.ensureIntentAbsent
      || !input.imageRetained) {
    fail('provider settlement receipt must prove exact cleanup and image retention');
  }
  const observedAt = new Date(input.observedAt).toISOString();
  if (observedAt !== input.observedAt) fail('provider settlement receipt observedAt is not canonical');
  const material = Object.freeze({
    schema: LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_RECEIPT_SCHEMA_V1,
    repository: repositoryName(input.repository),
    providerName: providerBaseName(input.providerName),
    operationLabel: operation,
    desiredDigest: nullableDigestV1(input.desiredDigest, 'provider settlement receipt desiredDigest'),
    providerLedgerObjectSha: nullableGitObjectShaV1(
      input.providerLedgerObjectSha, 'provider settlement receipt providerLedgerObjectSha'
    ),
    dockerEndpoint: dockerEndpointIdentity(input.dockerEndpoint),
    githubEndpoint: githubEndpointIdentity(input.githubEndpoint),
    resourceBinding: createLocalGitHubActionsProviderResourceBindingV1(),
    reason: settlementReasonV1(input.reason),
    intentIssuedAt: (() => {
      const issuedAt = new Date(input.intentIssuedAt).toISOString();
      if (issuedAt !== input.intentIssuedAt) {
        fail('provider settlement receipt intentIssuedAt is not canonical');
      }
      return issuedAt;
    })(),
    intentDigest: input.intentDigest,
    runnersAbsent: true as const,
    containersAbsent: true as const,
    providerLedgerAbsent: true as const,
    stateProjectionAbsent: true as const,
    ensureCurrentAbsent: true as const,
    ensureIntentAbsent: true as const,
    imageRetained: true as const,
    ociGenerationDigest: nullableDigestV1(
      input.ociGenerationDigest, 'provider settlement receipt ociGenerationDigest'
    ),
    ociReceiptDigest: nullableDigestV1(
      input.ociReceiptDigest, 'provider settlement receipt ociReceiptDigest'
    ),
    observedAt
  });
  if (!/^sha256:[0-9a-f]{64}$/u.test(material.intentDigest)) {
    fail('provider settlement receipt intentDigest is invalid');
  }
  const intent = createLocalGitHubActionsProviderSettlementIntentV1({
    repository: material.repository,
    providerName: material.providerName,
    operationLabel: material.operationLabel,
    desiredDigest: material.desiredDigest,
    providerLedgerObjectSha: material.providerLedgerObjectSha,
    dockerEndpoint: material.dockerEndpoint,
    githubEndpoint: material.githubEndpoint,
    reason: material.reason,
    issuedAt: material.intentIssuedAt
  });
  if (intent.intentDigest !== material.intentDigest) {
    fail('provider settlement receipt intent binding is invalid');
  }
  const { observedAt: _observedAt, ...stableMaterial } = material;
  return Object.freeze({
    ...material,
    receiptDigest: sha256(Object.freeze(stableMaterial)) as `sha256:${string}`
  });
}

export function parseLocalGitHubActionsProviderSettlementReceiptV1(
  source: string
): LocalGitHubActionsProviderSettlementReceiptV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('provider settlement receipt is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('provider settlement receipt shape is invalid');
  }
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'repository', 'providerName', 'operationLabel', 'desiredDigest',
    'providerLedgerObjectSha', 'dockerEndpoint', 'githubEndpoint', 'resourceBinding',
    'reason', 'intentIssuedAt', 'intentDigest', 'runnersAbsent', 'containersAbsent', 'providerLedgerAbsent',
    'stateProjectionAbsent', 'ensureCurrentAbsent', 'ensureIntentAbsent', 'imageRetained',
    'ociGenerationDigest', 'ociReceiptDigest', 'observedAt', 'receiptDigest'
  ], 'provider settlement receipt');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_RECEIPT_SCHEMA_V1) {
    fail('provider settlement receipt schema is invalid');
  }
  const receipt = createLocalGitHubActionsProviderSettlementReceiptV1({
    repository: value.repository as string,
    providerName: value.providerName as string,
    operationLabel: value.operationLabel as string | null,
    desiredDigest: value.desiredDigest as `sha256:${string}` | null,
    providerLedgerObjectSha: value.providerLedgerObjectSha as string | null,
    dockerEndpoint: value.dockerEndpoint as DockerEndpointIdentityV3,
    githubEndpoint: value.githubEndpoint as GitHubEndpointIdentityV3,
    reason: value.reason as LocalGitHubActionsProviderSettlementReasonV1,
    intentIssuedAt: value.intentIssuedAt as string,
    intentDigest: value.intentDigest as `sha256:${string}`,
    runnersAbsent: value.runnersAbsent as true,
    containersAbsent: value.containersAbsent as true,
    providerLedgerAbsent: value.providerLedgerAbsent as true,
    stateProjectionAbsent: value.stateProjectionAbsent as true,
    ensureCurrentAbsent: value.ensureCurrentAbsent as true,
    ensureIntentAbsent: value.ensureIntentAbsent as true,
    imageRetained: value.imageRetained as true,
    ociGenerationDigest: value.ociGenerationDigest as `sha256:${string}` | null,
    ociReceiptDigest: value.ociReceiptDigest as `sha256:${string}` | null,
    observedAt: value.observedAt as string
  });
  assertCanonicalProviderResourceBindingV1(value.resourceBinding, 'provider settlement receipt resource binding');
  if (receipt.receiptDigest !== value.receiptDigest) fail('provider settlement receipt digest mismatch');
  return receipt;
}

export function createLocalGitHubActionsRunnerStateV3(
  input: Omit<LocalGitHubActionsRunnerStateV3, 'schema' | 'image' | 'imageId' | 'runnerVersion'
    | 'runnerArchiveSha256' | 'baseImage' | 'nodeVersion' | 'nodeArchiveSha256'
    | 'labels' | 'roleLabels' | 'resourceBinding' | 'stateDigest'>
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
    resourceBinding: createLocalGitHubActionsProviderResourceBindingV1(),
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
    'labels', 'roleLabels', 'resourceBinding', 'instances', 'startedAt', 'stateDigest'
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
  assertCanonicalProviderResourceBindingV1(value.resourceBinding, 'state resource binding');
  if (recreated.stateDigest !== value.stateDigest) fail('state digest mismatch');
  return recreated;
}

export function providerEnsureEndpointDigestV1(input: Readonly<{
  dockerEndpoint: DockerEndpointIdentityV3;
  githubEndpoint: GitHubEndpointIdentityV3;
}>): `sha256:${string}` {
  return sha256(Object.freeze({
    schema: 'sec-local-github-actions-provider-endpoint-binding-v1',
    dockerEndpoint: dockerEndpointIdentity(input.dockerEndpoint),
    githubEndpoint: githubEndpointIdentity(input.githubEndpoint)
  })) as `sha256:${string}`;
}

function providerEnsureDesiredMaterialV1(
  input: Omit<LocalGitHubActionsProviderEnsureDesiredV1,
    'schema' | 'desiredDigest' | 'resourceBinding'>
): Omit<LocalGitHubActionsProviderEnsureDesiredV1, 'desiredDigest'> {
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.providerName);
  if (!/^[0-9a-f]{40}$/u.test(input.providerLedgerObjectSha)) {
    fail('provider ensure desired ledger object identity is invalid');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.providerLedgerDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.stateDigest)) {
    fail('provider ensure desired digest identity is invalid');
  }
  if (!Number.isSafeInteger(input.generation) || input.generation < 0) {
    fail('provider ensure desired generation is invalid');
  }
  const instances = input.instances.map(runnerInstance);
  if (instances.length !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.length
      || LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.some((role, index) => instances[index]?.role !== role)) {
    fail('provider ensure desired instances are not one ordered role closure');
  }
  return Object.freeze({
    schema: 'sec-local-github-actions-provider-ensure-desired-v1' as const,
    repository,
    providerName,
    operationLabel: operationLabel(input.operationLabel),
    providerLedgerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
    providerLedgerObjectSha: input.providerLedgerObjectSha,
    providerLedgerDigest: input.providerLedgerDigest,
    generation: input.generation,
    dockerEndpoint: dockerEndpointIdentity(input.dockerEndpoint),
    githubEndpoint: githubEndpointIdentity(input.githubEndpoint),
    imageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    resourceBinding: createLocalGitHubActionsProviderResourceBindingV1(),
    instances: Object.freeze(instances),
    stateDigest: input.stateDigest
  });
}

export function createLocalGitHubActionsProviderEnsureDesiredV1(
  input: Omit<LocalGitHubActionsProviderEnsureDesiredV1,
    'schema' | 'desiredDigest' | 'resourceBinding'>
): LocalGitHubActionsProviderEnsureDesiredV1 {
  const material = providerEnsureDesiredMaterialV1(input);
  return Object.freeze({
    ...material,
    desiredDigest: sha256(material) as `sha256:${string}`
  });
}

export function createLocalGitHubActionsProviderEnsureIntentV1(
  input: Omit<LocalGitHubActionsProviderEnsureIntentV1,
    'schema' | 'resourceBinding' | 'desiredDigest' | 'intentDigest'>
): LocalGitHubActionsProviderEnsureIntentV1 {
  const issuedAt = new Date(input.issuedAt).toISOString();
  if (issuedAt !== input.issuedAt) fail('provider ensure intent issuedAt is not canonical');
  const dockerEndpoint = dockerEndpointIdentity(input.dockerEndpoint);
  const githubEndpoint = githubEndpointIdentity(input.githubEndpoint);
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.providerName);
  if (input.imageId !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2) {
    fail('provider ensure intent image identity is invalid');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.environmentInputDigest)) {
    fail('provider ensure intent environment input digest is invalid');
  }
  const material = Object.freeze({
    schema: LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_INTENT_SCHEMA_V1,
    repository,
    providerName,
    dockerEndpoint,
    githubEndpoint,
    imageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    resourceBinding: createLocalGitHubActionsProviderResourceBindingV1(),
    environmentInputDigest: input.environmentInputDigest,
    desiredDigest: sha256(Object.freeze({
      schema: 'sec-local-github-actions-provider-ensure-desired-input-v1',
      repository,
      providerName,
      dockerEndpoint,
      githubEndpoint,
      imageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
      resourceBinding: createLocalGitHubActionsProviderResourceBindingV1(),
      environmentInputDigest: input.environmentInputDigest
    })) as `sha256:${string}`,
    issuedAt
  });
  return Object.freeze({
    ...material,
    intentDigest: sha256(material) as `sha256:${string}`
  });
}

export function parseLocalGitHubActionsProviderEnsureIntentV1(
  source: string
): LocalGitHubActionsProviderEnsureIntentV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('provider ensure intent is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('provider ensure intent shape is invalid');
  }
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'repository', 'providerName', 'dockerEndpoint', 'githubEndpoint', 'imageId',
    'resourceBinding', 'environmentInputDigest', 'desiredDigest', 'issuedAt', 'intentDigest'
  ], 'provider ensure intent');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_INTENT_SCHEMA_V1) {
    fail('provider ensure intent schema is invalid');
  }
  const intent = createLocalGitHubActionsProviderEnsureIntentV1({
    repository: value.repository as string,
    providerName: value.providerName as string,
    dockerEndpoint: value.dockerEndpoint as DockerEndpointIdentityV3,
    githubEndpoint: value.githubEndpoint as GitHubEndpointIdentityV3,
    imageId: value.imageId as typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    environmentInputDigest: value.environmentInputDigest as `sha256:${string}`,
    issuedAt: value.issuedAt as string
  });
  assertCanonicalProviderResourceBindingV1(value.resourceBinding, 'provider ensure intent resource binding');
  if (intent.desiredDigest !== value.desiredDigest || intent.intentDigest !== value.intentDigest) {
    fail('provider ensure intent digest mismatch');
  }
  return intent;
}

function providerEnsureIntentMatchesInputV1(
  intent: LocalGitHubActionsProviderEnsureIntentV1,
  input: Readonly<{
    repository: string;
    providerName: string;
    dockerEndpoint: DockerEndpointIdentityV3;
    githubEndpoint: GitHubEndpointIdentityV3;
  }>
): boolean {
  return intent.repository === repositoryName(input.repository)
    && intent.providerName === providerBaseName(input.providerName)
    && JSON.stringify(intent.dockerEndpoint) === JSON.stringify(dockerEndpointIdentity(input.dockerEndpoint))
    && JSON.stringify(intent.githubEndpoint) === JSON.stringify(githubEndpointIdentity(input.githubEndpoint))
    && intent.imageId === LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2
    && JSON.stringify(intent.resourceBinding) === JSON.stringify(createLocalGitHubActionsProviderResourceBindingV1())
    && intent.environmentInputDigest === SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST_V1;
}

function boundedProviderConsumerIdV1(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 ||
      value.trim() !== value || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    fail('provider consumerId is not canonical');
  }
  return value;
}

function providerConsumerCredentialV1(input: Readonly<{
  repository: string;
  providerName: string;
  resourceBinding: LocalGitHubActionsProviderResourceBindingV1;
  consumerId: string;
  acquiredFromReceiptDigest: `sha256:${string}`;
  acquiredAtEpoch: number;
  leaseId: `sha256:${string}`;
}>): `sha256:${string}` {
  return sha256(Object.freeze({
    schema: 'sec-local-github-actions-provider-consumer-credential-v1',
    repository: input.repository,
    providerName: input.providerName,
    resourceBinding: input.resourceBinding,
    consumerId: boundedProviderConsumerIdV1(input.consumerId),
    acquiredFromReceiptDigest: input.acquiredFromReceiptDigest,
    acquiredAtEpoch: input.acquiredAtEpoch,
    leaseId: input.leaseId
  })) as `sha256:${string}`;
}

function assertCanonicalRunnerOciProviderBindingV1(
  value: LocalGitHubActionsRunnerOciProviderBindingV1,
  desired: LocalGitHubActionsProviderEnsureDesiredV1
): LocalGitHubActionsRunnerOciProviderBindingV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('provider ensure OCI binding is invalid');
  }
  exactKeys(value as unknown as Record<string, unknown>, [
    'schema', 'specDigest', 'generation', 'generationDigest', 'receiptDigest', 'providerRef',
    'providerLedgerObjectSha', 'providerLedgerDigest', 'providerGeneration',
    'provenanceArtifactDigest'
  ], 'provider ensure OCI binding');
  if (value.schema !== 'sec-local-github-actions-runner-oci-provider-binding-v1'
      || !/^sha256:[0-9a-f]{64}$/u.test(value.specDigest)
      || !Number.isSafeInteger(value.generation) || value.generation < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(value.generationDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(value.receiptDigest)
      || value.providerRef !== LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3
      || !/^[0-9a-f]{40}$/u.test(value.providerLedgerObjectSha)
      || !/^sha256:[0-9a-f]{64}$/u.test(value.providerLedgerDigest)
      || !Number.isSafeInteger(value.providerGeneration) || value.providerGeneration < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(value.provenanceArtifactDigest)
      || value.specDigest !== createLocalGitHubActionsRunnerEnvironmentSpecV1().specDigest
      || value.providerLedgerObjectSha !== desired.providerLedgerObjectSha
      || value.providerLedgerDigest !== desired.providerLedgerDigest
      || value.providerGeneration !== desired.generation) {
    fail('provider ensure OCI binding is not bound to the current provider generation');
  }
  return Object.freeze(value);
}

function providerEnsureReceiptMaterialV1(
  input: Omit<LocalGitHubActionsProviderEnsureReceiptV2,
    'schema' | 'resourceBinding' | 'leaseId' | 'consumerCount' | 'receiptDigest'>
): Omit<LocalGitHubActionsProviderEnsureReceiptV2, 'receiptDigest'> {
  const observedAt = new Date(input.observedAt).toISOString();
  if (observedAt !== input.observedAt) fail('provider ensure receipt observedAt is not canonical');
  if (input.outcome !== 'started-fresh' && input.outcome !== 'already-healthy'
      && input.outcome !== 'reconciled') {
    fail('provider ensure receipt outcome is invalid');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.intentDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.endpointDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.builderObservationDigest)) {
    fail('provider ensure receipt binding digest is invalid');
  }
  if (!Number.isSafeInteger(input.transitionEpoch) || input.transitionEpoch < 0) {
    fail('provider ensure receipt transition epoch is invalid');
  }
  const desired = createLocalGitHubActionsProviderEnsureDesiredV1(input.desired);
  if (desired.desiredDigest !== input.desired.desiredDigest) {
    fail('provider ensure receipt desired digest mismatch');
  }
  if (desired.repository !== repositoryName(input.repository)
      || desired.providerName !== providerBaseName(input.providerName)
      || providerEnsureEndpointDigestV1(desired) !== input.endpointDigest) {
    fail('provider ensure receipt desired state is not endpoint-bound');
  }
  const ociBinding = assertCanonicalRunnerOciProviderBindingV1(input.ociBinding, desired);
  const reconciledContainers = input.reconciledContainers.map((entry) => runnerName(entry));
  const canonicalContainers = [...new Set(reconciledContainers)].sort();
  if (canonicalContainers.length !== reconciledContainers.length
      || canonicalContainers.some((entry, index) => entry !== reconciledContainers[index])) {
    fail('provider ensure receipt reconciled containers must be unique and canonical');
  }
  const resourceBinding = createLocalGitHubActionsProviderResourceBindingV1();
  const leaseId = sha256(Object.freeze({
    schema: 'sec-local-github-actions-provider-consumer-lease-v1',
    repository: desired.repository,
    providerName: desired.providerName,
    desiredDigest: desired.desiredDigest,
    intentDigest: input.intentDigest,
    endpointDigest: input.endpointDigest,
    resourceBinding
  })) as `sha256:${string}`;
  const normalizedConsumers = input.consumers.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`provider ensure receipt consumers[${index}] is invalid`);
    }
    const consumerId = boundedProviderConsumerIdV1(entry.consumerId);
    if (!/^sha256:[0-9a-f]{64}$/u.test(entry.acquiredFromReceiptDigest)
        || !Number.isSafeInteger(entry.acquiredAtEpoch) || entry.acquiredAtEpoch < 0
        || entry.leaseId !== leaseId) {
      fail(`provider ensure receipt consumers[${index}] binding is invalid`);
    }
    const credential = providerConsumerCredentialV1({
      repository: desired.repository,
      providerName: desired.providerName,
      resourceBinding,
      consumerId,
      acquiredFromReceiptDigest: entry.acquiredFromReceiptDigest,
      acquiredAtEpoch: entry.acquiredAtEpoch,
      leaseId
    });
    if (entry.credential !== credential) {
      fail(`provider ensure receipt consumers[${index}] credential is invalid`);
    }
    return Object.freeze({
      consumerId,
      acquiredFromReceiptDigest: entry.acquiredFromReceiptDigest,
      acquiredAtEpoch: entry.acquiredAtEpoch,
      leaseId,
      credential
    });
  });
  const consumers = [...normalizedConsumers]
    .sort((left, right) => left.consumerId.localeCompare(right.consumerId, 'en-US'));
  if (new Set(consumers.map(({ consumerId }) => consumerId)).size !== consumers.length ||
      consumers.some((entry, index) => entry.consumerId !== normalizedConsumers[index]?.consumerId)) {
    fail('provider ensure receipt consumers must be unique and canonical');
  }
  return Object.freeze({
    schema: LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_RECEIPT_SCHEMA_V2,
    repository: repositoryName(input.repository),
    providerName: providerBaseName(input.providerName),
    outcome: input.outcome,
    desired,
    resourceBinding,
    intentDigest: input.intentDigest,
    endpointDigest: input.endpointDigest,
    builderObservationDigest: input.builderObservationDigest,
    ociBinding,
    reconciledContainers: Object.freeze(canonicalContainers),
    leaseId,
    transitionEpoch: input.transitionEpoch,
    consumers: Object.freeze(consumers),
    consumerCount: consumers.length,
    observedAt
  });
}

export function acquireLocalGitHubActionsProviderConsumerReceiptV1(input: Readonly<{
  current: LocalGitHubActionsProviderEnsureReceiptV2;
  consumerId: string;
  observedAt: string;
}>): Readonly<{
  receipt: LocalGitHubActionsProviderEnsureReceiptV2;
  binding: LocalGitHubActionsProviderConsumerBindingV1;
}> {
  const current = parseLocalGitHubActionsProviderEnsureReceiptV2(JSON.stringify(input.current));
  const consumerId = boundedProviderConsumerIdV1(input.consumerId);
  const existing = current.consumers.find((entry) => entry.consumerId === consumerId);
  if (existing !== undefined) return Object.freeze({ receipt: current, binding: existing });
  const bindingMaterial = {
    repository: current.repository,
    providerName: current.providerName,
    resourceBinding: current.resourceBinding,
    consumerId,
    acquiredFromReceiptDigest: current.receiptDigest,
    acquiredAtEpoch: current.transitionEpoch,
    leaseId: current.leaseId
  } as const;
  const binding = Object.freeze({
    consumerId,
    acquiredFromReceiptDigest: current.receiptDigest,
    acquiredAtEpoch: current.transitionEpoch,
    leaseId: current.leaseId,
    credential: providerConsumerCredentialV1(bindingMaterial)
  });
  const receipt = createLocalGitHubActionsProviderEnsureReceiptV2({
    repository: current.repository,
    providerName: current.providerName,
    outcome: current.outcome,
    desired: current.desired,
    intentDigest: current.intentDigest,
    endpointDigest: current.endpointDigest,
    builderObservationDigest: current.builderObservationDigest,
    ociBinding: current.ociBinding,
    reconciledContainers: current.reconciledContainers,
    transitionEpoch: current.transitionEpoch + 1,
    consumers: [...current.consumers, binding]
      .sort((left, right) => left.consumerId.localeCompare(right.consumerId, 'en-US')),
    observedAt: input.observedAt
  });
  return Object.freeze({ receipt, binding });
}

export function releaseLocalGitHubActionsProviderConsumerReceiptV1(input: Readonly<{
  current: LocalGitHubActionsProviderEnsureReceiptV2;
  consumerId: string;
  credential: `sha256:${string}`;
  expectedReceiptDigest: `sha256:${string}`;
  expectedLeaseId: `sha256:${string}`;
  expectedEpoch: number;
  observedAt: string;
}>): LocalGitHubActionsProviderEnsureReceiptV2 {
  const current = parseLocalGitHubActionsProviderEnsureReceiptV2(JSON.stringify(input.current));
  if (current.receiptDigest !== input.expectedReceiptDigest ||
      current.leaseId !== input.expectedLeaseId || current.transitionEpoch !== input.expectedEpoch) {
    fail('provider consumer release current CAS binding changed');
  }
  const consumerId = boundedProviderConsumerIdV1(input.consumerId);
  const binding = current.consumers.find((entry) => entry.consumerId === consumerId);
  if (binding === undefined || binding.credential !== input.credential) {
    fail('provider consumer release credential is invalid');
  }
  return createLocalGitHubActionsProviderEnsureReceiptV2({
    repository: current.repository,
    providerName: current.providerName,
    outcome: current.outcome,
    desired: current.desired,
    intentDigest: current.intentDigest,
    endpointDigest: current.endpointDigest,
    builderObservationDigest: current.builderObservationDigest,
    ociBinding: current.ociBinding,
    reconciledContainers: current.reconciledContainers,
    transitionEpoch: current.transitionEpoch + 1,
    consumers: current.consumers.filter((entry) => entry.consumerId !== consumerId),
    observedAt: input.observedAt
  });
}

export function createLocalGitHubActionsProviderEnsureReceiptV2(
  input: Omit<LocalGitHubActionsProviderEnsureReceiptV2,
    'schema' | 'resourceBinding' | 'leaseId' | 'consumerCount' | 'receiptDigest'>
): LocalGitHubActionsProviderEnsureReceiptV2 {
  const material = providerEnsureReceiptMaterialV1(input);
  const { observedAt: _observedAt, ...stableMaterial } = material;
  return Object.freeze({
    ...material,
    // observedAt is deliberately excluded from the digest material by the
    // current-pointer protocol: a healthy ensure can return the same receipt
    // without manufacturing a new immutable generation.
    receiptDigest: sha256(Object.freeze(stableMaterial)) as `sha256:${string}`
  });
}

export function parseLocalGitHubActionsProviderEnsureReceiptV2(
  source: string
): LocalGitHubActionsProviderEnsureReceiptV2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail('provider ensure receipt is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('provider ensure receipt shape is invalid');
  }
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'repository', 'providerName', 'outcome', 'desired', 'resourceBinding', 'intentDigest',
    'endpointDigest', 'builderObservationDigest', 'ociBinding', 'reconciledContainers', 'leaseId',
    'transitionEpoch', 'consumers', 'consumerCount', 'observedAt', 'receiptDigest'
  ], 'provider ensure receipt');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_RECEIPT_SCHEMA_V2
      || !Array.isArray(value.reconciledContainers) || !Array.isArray(value.consumers)) {
    fail('provider ensure receipt schema is invalid');
  }
  const receipt = createLocalGitHubActionsProviderEnsureReceiptV2({
    repository: value.repository as string,
    providerName: value.providerName as string,
    outcome: value.outcome as LocalGitHubActionsProviderEnsureReceiptV2['outcome'],
    desired: value.desired as LocalGitHubActionsProviderEnsureDesiredV1,
    intentDigest: value.intentDigest as `sha256:${string}`,
    endpointDigest: value.endpointDigest as `sha256:${string}`,
    builderObservationDigest: value.builderObservationDigest as `sha256:${string}`,
    ociBinding: value.ociBinding as LocalGitHubActionsRunnerOciProviderBindingV1,
    reconciledContainers: value.reconciledContainers as string[],
    transitionEpoch: value.transitionEpoch as number,
    consumers: value.consumers as LocalGitHubActionsProviderConsumerBindingV1[],
    observedAt: value.observedAt as string
  });
  assertCanonicalProviderResourceBindingV1(value.resourceBinding, 'provider ensure receipt resource binding');
  if (receipt.receiptDigest !== value.receiptDigest || receipt.leaseId !== value.leaseId ||
      receipt.consumerCount !== value.consumerCount) {
    fail('provider ensure receipt digest or derived consumer binding mismatch');
  }
  return receipt;
}

export function createLocalGitHubActionsRunnerDockerfileV2(): string {
  return `# syntax=${LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND_V1}\n`
    + `ARG SOURCE_DATE_EPOCH=${LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH_V1}\n`
    + 'FROM scratch AS ca-bootstrap\n'
    + `ADD --chmod=${ENVIRONMENT.archives.bootstrapCa.mountMode} `
    + `--checksum=${ENVIRONMENT.archives.bootstrapCa.digest} `
    + `${ENVIRONMENT.archives.bootstrapCa.url} `
    + '/ca/\n'
    + `FROM ${LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1} AS runtime\n`
    + 'ARG DEBIAN_FRONTEND=noninteractive\n'
    + `ARG UBUNTU_SNAPSHOT=${LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT_V1}\n`
    + `RUN --mount=from=ca-bootstrap,source=/ca/cacert-${LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE_V1}.pem,`
    + 'target=/tmp/bootstrap-cacert.pem,ro '
    + `--mount=type=cache,id=${ENVIRONMENT.ubuntu.aptCacheId},target=/var/cache/apt,sharing=locked `
    + 'test -s /tmp/bootstrap-cacert.pem && test "$(stat -c %a /tmp/bootstrap-cacert.pem)" = 444 '
    + '&& rm -f /etc/apt/apt.conf.d/docker-clean /etc/apt/sources.list '
    + `&& printf '%s\\n' 'Types: deb' `
    + `"URIs: ${ENVIRONMENT.ubuntu.snapshotUrl}\${UBUNTU_SNAPSHOT}" `
    + `'Suites: ${ENVIRONMENT.ubuntu.suites.join(' ')}' `
    + `'Components: ${ENVIRONMENT.ubuntu.components.join(' ')}' `
    + `'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' `
    + '> /etc/apt/sources.list.d/ubuntu.sources '
    + `&& apt-get -o Acquire::https::CAInfo=/tmp/bootstrap-cacert.pem -o Acquire::Retries=${ENVIRONMENT.ubuntu.aptRetries} update `
    + `&& apt-get -o Acquire::https::CAInfo=/tmp/bootstrap-cacert.pem -o Acquire::Retries=${ENVIRONMENT.ubuntu.aptRetries} install `
    + '-y --no-install-recommends '
    + `${ENVIRONMENT.ubuntu.packages.join(' ')} `
    + `&& test "$(python3 --version)" = "Python ${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1}" `
    + '&& command -v unzip >/dev/null '
    + '&& python3 -c "import hashlib,json,tarfile" '
    + '&& dpkg-query -W -f="${Package}=${Version}\\n" | LC_ALL=C sort '
    + '> /usr/local/share/sec-environment-packages.txt '
    + '&& rm -rf /var/lib/apt/lists/*\n'
    + 'FROM scratch AS node-archive\n'
    + `ADD --checksum=${ENVIRONMENT.archives.node.digest} `
    + `${ENVIRONMENT.archives.node.url} /node.tar.xz\n`
    + 'FROM runtime AS node-runtime\n'
    + 'RUN --mount=from=node-archive,source=/node.tar.xz,target=/tmp/node.tar.xz,ro '
    + 'tar --no-same-owner -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 '
    + `&& test "$(node --version)" = "v${LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1}"\n`
    + 'FROM scratch AS runner-archive\n'
    + `ADD --checksum=${ENVIRONMENT.archives.runner.digest} `
    + `${ENVIRONMENT.archives.runner.url} /runner.tar.gz\n`
    + 'FROM node-runtime AS runner-runtime\n'
    + 'WORKDIR /actions-runner\n'
    // GitHub publishes the archive with uid/gid 1001. The runtime deliberately drops
    // CAP_DAC_OVERRIDE, so normalize archive ownership to the fixed container root owner.
    + 'RUN --mount=from=runner-archive,source=/runner.tar.gz,target=/tmp/runner.tar.gz,ro '
    + 'tar --no-same-owner -xzf /tmp/runner.tar.gz\n'
    + 'FROM scratch AS github-cli-archive\n'
    + `ADD --checksum=${ENVIRONMENT.archives.githubCli.digest} `
    + `${ENVIRONMENT.archives.githubCli.url} /gh.tar.gz\n`
    + 'FROM runner-runtime\n'
    + 'RUN --mount=from=github-cli-archive,source=/gh.tar.gz,target=/tmp/gh.tar.gz,ro '
    + 'tar --no-same-owner -xzf /tmp/gh.tar.gz -C /tmp '
    + `&& install -m 0755 /tmp/gh_${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1}_linux_amd64/bin/gh `
    + '/usr/local/bin/gh '
    + `&& gh --version | head -n 1 | grep -E '^gh version ${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1.replaceAll('.', '\\.')}`
    + " ' "
    + `&& rm -rf /tmp/gh_${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1}_linux_amd64\n`
    + `LABEL sec.local-runner.image-schema=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1} `
    + `sec.local-runner.image-revision=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2} `
    + `sec.local-runner.runner-version=${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1} `
    + `sec.local-runner.node-version=${LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1} `
    + `sec.local-runner.node-archive-sha256=${LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1} `
    + `sec.local-runner.github-cli-version=${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1} `
    + `sec.local-runner.github-cli-archive-sha256=${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1} `
    + `sec.local-runner.python-version=${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1} `
    + `sec.local-runner.ubuntu-snapshot=${LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT_V1} `
    + `sec.local-runner.bootstrap-ca-bundle-sha256=${LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256_V1} `
    + `sec.local-runner.dockerfile-frontend=${LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND_V1}\n`
    + 'ENV RUNNER_ALLOW_RUNASROOT=1\n'
    + 'ENTRYPOINT ["/bin/bash","-lc"]\n';
}

export function createLocalGitHubActionsRunnerEnvironmentSpecV1() {
  const buildInputClosureDigest = sha256(
    createLocalGitHubActionsRunnerBuildInputProjectionV1()
  ) as `sha256:${string}`;
  return createEnvironmentMaterializationSpecV1({
    imageName: LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1,
    acceptedImageDigest: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    sourcePolicyRevision: ENVIRONMENT.provider.sourcePolicyRevision,
    providerRequirement: ENVIRONMENT.provider.requirement,
    components: [
      {
        id: 'authority-input-closure',
        version: ENVIRONMENT.environmentId,
        sourceDigest: SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST_V1
      },
      {
        id: 'base-image',
        version: `ubuntu-${ENVIRONMENT.ubuntu.version}`,
        sourceDigest: ENVIRONMENT.ubuntu.baseDigest
      },
      {
        id: 'bootstrap-ca-bundle',
        version: LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE_V1,
        sourceDigest: ENVIRONMENT.archives.bootstrapCa.digest
      },
      {
        id: 'dockerfile-frontend',
        version: ENVIRONMENT.provider.dockerfileFrontend.version,
        sourceDigest: ENVIRONMENT.provider.dockerfileFrontend.digest
      },
      {
        id: 'github-cli',
        version: LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1,
        sourceDigest: ENVIRONMENT.archives.githubCli.digest
      },
      {
        id: 'node',
        version: LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1,
        sourceDigest: ENVIRONMENT.archives.node.digest
      },
      {
        id: 'runner',
        version: LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1,
        sourceDigest: ENVIRONMENT.archives.runner.digest
      },
      {
        id: 'runner-build-input-closure',
        version: ENVIRONMENT.image.buildRevision,
        sourceDigest: buildInputClosureDigest
      }
    ]
  });
}

function createLocalGitHubActionsRunnerOciBakeRequestV1(candidatePath: string): Readonly<Record<string, unknown>> {
  // Bake interpolates `${...}` in string values before forwarding the inline Dockerfile.
  // Escape only that grammar. Shell command substitutions such as `$(stat ...)` must
  // retain one dollar sign or the resulting Dockerfile changes execution semantics.
  const dockerfileInline = createLocalGitHubActionsRunnerDockerfileV2().replaceAll('${', () => '$${');
  return Object.freeze({
    group: { default: { targets: ['runner-oci'] } },
    target: {
      'runner-oci': {
        context: '.',
        'dockerfile-inline': dockerfileInline,
        args: { SOURCE_DATE_EPOCH: LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH_V1 },
        platforms: [ENVIRONMENT.platform],
        output: [
          `type=oci,dest=${candidatePath},tar=false,rewrite-timestamp=true,name=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1}`
        ],
        attest: [`type=provenance,mode=${ENVIRONMENT.provenance.materializationMode}`]
      }
    }
  });
}

function createLocalGitHubActionsRunnerProjectionBuildxArgsForUriV1(
  retainedLayoutUriPath: string
): readonly string[] {
  return Object.freeze([
    'buildx', 'build', '--builder', LOCAL_GITHUB_ACTIONS_BUILDX_BUILDER_NAME_V1,
    '--build-context',
    `runtime=oci-layout://${retainedLayoutUriPath}@${LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1}`,
    '--file', '-',
    '--platform', ENVIRONMENT.platform,
    '--tag', LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1,
    '--output', 'type=docker',
    '--provenance=false',
    `--progress=${ENVIRONMENT.provider.progressMode}`,
    '.'
  ]);
}

/**
 * Exact provider-owned artifact input closure. Runtime paths are replaced by
 * fixed semantic placeholders; every byte sent to Buildx that can change the
 * OCI artifact or its Docker projection is otherwise represented verbatim.
 */
export function createLocalGitHubActionsRunnerBuildInputProjectionV1() {
  return Object.freeze({
    schema: 'sec-local-runner-build-input-projection-v1' as const,
    authorityInputDigest: SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST_V1,
    dockerfileSource: createLocalGitHubActionsRunnerDockerfileV2(),
    bakeRequest: createLocalGitHubActionsRunnerOciBakeRequestV1('<candidate-layout>'),
    projectionArgs: createLocalGitHubActionsRunnerProjectionBuildxArgsForUriV1('<layout>'),
    projectionStdin: 'FROM runtime\n',
    runtimeManifestDigest: LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1,
    dockerProjectionDigest: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2
  });
}

export function createLocalGitHubActionsRunnerOciBakeDefinitionV1(candidatePath: string): string {
  const retainedCandidatePath = path.resolve(boundedText(candidatePath, 'OCI candidate path', 32_768));
  return `${JSON.stringify(createLocalGitHubActionsRunnerOciBakeRequestV1(retainedCandidatePath))}\n`;
}

export function createLocalGitHubActionsRunnerProjectionBuildxArgsV1(
  layoutPath: string
): readonly string[] {
  const retainedLayoutPath = path.resolve(boundedText(layoutPath, 'OCI layout path', 32_768));
  const retainedLayoutUriPath = retainedLayoutPath.split(path.sep).join('/');
  return createLocalGitHubActionsRunnerProjectionBuildxArgsForUriV1(retainedLayoutUriPath);
}

async function runCommand(
  command: 'docker' | 'gh' | 'git',
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    input?: Buffer;
    acceptedCodes?: readonly number[];
    timeoutMs?: number;
    stallTimeoutMs?: number;
    admitProgress?: (chunk: Buffer, stream: 'stdout' | 'stderr') => boolean;
    githubToken?: string;
  }>
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? ENVIRONMENT.provider.timeoutsMs.commandDefault;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1
      || timeoutMs > ENVIRONMENT.provider.timeoutsMs.commandMaximum) {
    fail('command timeout is invalid');
  }
  const stallTimeoutMs = options.stallTimeoutMs;
  if (stallTimeoutMs !== undefined && (!Number.isSafeInteger(stallTimeoutMs)
      || stallTimeoutMs < 1 || stallTimeoutMs > timeoutMs || options.admitProgress === undefined)) {
    fail('command stall timeout is invalid');
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
    let terminationError: Error | null = null;
    let settlementTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = (): void => {
      clearTimeout(absoluteTimer);
      if (stallTimer !== null) clearTimeout(stallTimer);
      if (settlementTimer !== null) clearTimeout(settlementTimer);
    };
    const terminate = (error: Error): void => {
      if (settled || terminationError !== null) return;
      terminationError = error;
      if (stallTimer !== null) clearTimeout(stallTimer);
      child.kill();
      settlementTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        clearTimers();
        reject(error);
      }, 30_000);
    };
    const absoluteTimer = setTimeout(() => terminate(new Error(
      `Local GitHub Actions runner: ${command} exceeded absolute timeout ${timeoutMs}ms`
    )), timeoutMs);
    const armStallTimer = (): void => {
      if (stallTimeoutMs === undefined) return;
      if (stallTimer !== null) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => terminate(new Error(
        `Local GitHub Actions runner: ${command} made no admitted progress for ${stallTimeoutMs}ms`
      )), stallTimeoutMs);
    };
    armStallTimer();
    const collect = (target: Buffer[], chunk: Buffer) => {
      if (options.admitProgress?.(chunk, target === stdout ? 'stdout' : 'stderr') === true) {
        armStallTimer();
      }
      outputBytes += chunk.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        terminate(new Error(`Local GitHub Actions runner: ${command} output exceeded bound`));
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.once('error', (error) => terminate(error));
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (terminationError !== null) {
        reject(terminationError);
        return;
      }
      const result = Object.freeze({
        code: code ?? -1,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr)
      });
      if (!(options.acceptedCodes ?? [0]).includes(result.code)) {
        const stderrText = result.stderr.toString('utf8');
        const stderrEvidence = stderrText.length <= 8192
          ? stderrText
          : `${stderrText.slice(0, 2048)}\n...[stderr middle omitted]...\n${stderrText.slice(-6144)}`;
        reject(new Error(
          `Local GitHub Actions runner: ${command} failed with ${result.code}: ${stderrEvidence}`
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

export function dockerEndpointCommandArgsV3(
  endpoint: DockerEndpointIdentityV3,
  args: readonly string[]
): readonly string[] {
  return dockerCommandArgs(endpoint, args);
}

export const LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_LOCK_V1 =
  '/tmp/sec-actions-runner-supervisor-v1' as const;
export const LOCAL_GITHUB_ACTIONS_RUNNER_LOG_PATH_V1 =
  '/tmp/sec-actions-runner.log' as const;

/**
 * The runner process is owned by one in-container supervisor.  The directory
 * lock is deliberately independent of the GitHub online projection: a live
 * process with a temporarily offline API must never be mistaken for an
 * absent process and started a second time.
 */
export function createLocalGitHubActionsRunnerSupervisorScriptV1(): string {
  return [
    'set -eu',
    `lock=${LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_LOCK_V1}`,
    'if ! (umask 077 && mkdir "$lock") 2>/dev/null; then',
    '  pid="$(cat "$lock/pid" 2>/dev/null || true)"',
    '  if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then exit 42; fi',
    '  exit 43',
    'fi',
    'printf "%s\\n" "$$" > "$lock/pid"',
    'cleanup() { rm -rf "$lock"; }',
    'trap cleanup EXIT INT TERM',
    `./run.sh > ${LOCAL_GITHUB_ACTIONS_RUNNER_LOG_PATH_V1} 2>&1`
  ].join('\n');
}

export function createLocalGitHubActionsRunnerProcessWitnessScriptV1(): string {
  return [
    'set -eu',
    `lock=${LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_LOCK_V1}`,
    'if test -d "$lock"; then',
    '  if test -f "$lock/pid"; then',
    '    pid="$(cat "$lock/pid" 2>/dev/null || true)"',
    '    if test -n "$pid" && kill -0 "$pid" 2>/dev/null; then exit 10; fi',
    '  fi',
    '  rm -rf "$lock"',
    'fi',
    'fi',
    'if ! command -v pgrep >/dev/null 2>&1; then exit 90; fi',
    'matches="$(pgrep -f "[R]unner[.]Listener" || true)"',
    'count="$(printf "%s\\n" "$matches" | sed "/^[[:space:]]*$/d" | wc -l | tr -d "[:space:]")"',
    'case "$count" in',
    '  0) exit 0 ;;',
    '  1) exit 10 ;;',
    '  *) exit 11 ;;',
    'esac'
  ].join('\n');
}

export type LocalGitHubActionsRunnerProcessWitnessV1 =
  'absent' | 'alive' | 'ambiguous' | 'unavailable';

export function classifyLocalGitHubActionsRunnerProcessWitnessExitCodeV1(
  code: number
): LocalGitHubActionsRunnerProcessWitnessV1 {
  if (code === 0) return 'absent';
  if (code === 10) return 'alive';
  if (code === 11) return 'ambiguous';
  if (code === 90 || code === 91) return 'unavailable';
  fail(`runner process witness returned unexpected exit code ${code}`);
}

async function observeLocalGitHubActionsRunnerProcessWitnessV1(input: Readonly<{
  cwd: string;
  endpoint: DockerEndpointIdentityV3;
  containerId: string;
}>): Promise<LocalGitHubActionsRunnerProcessWitnessV1> {
  const result = await runDockerCommand(input.endpoint, [
    'exec', input.containerId, 'bash', '-lc',
    createLocalGitHubActionsRunnerProcessWitnessScriptV1()
  ], {
    cwd: input.cwd,
    acceptedCodes: [0, 10, 11, 90, 91]
  });
  return classifyLocalGitHubActionsRunnerProcessWitnessExitCodeV1(result.code);
}

async function runDockerCommand(
  endpoint: DockerEndpointIdentityV3,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    input?: Buffer;
    acceptedCodes?: readonly number[];
    timeoutMs?: number;
    stallTimeoutMs?: number;
    admitProgress?: (chunk: Buffer, stream: 'stdout' | 'stderr') => boolean;
  }>
): Promise<CommandResult> {
  return await runCommand('docker', dockerCommandArgs(endpoint, args), options);
}

export async function observeLocalGitHubActionsBuildxBuilderV1(
  cwd: string,
  endpoint: DockerEndpointIdentityV3
): Promise<LocalGitHubActionsBuildxBuilderObservationV1 | null> {
  await assertDockerEndpointIdentityV3(endpoint, cwd);
  const builder = await runDockerCommand(endpoint, [
    'buildx', 'inspect', LOCAL_GITHUB_ACTIONS_BUILDX_BUILDER_NAME_V1
  ], {
    cwd,
    acceptedCodes: [0, 1],
    timeoutMs: LOCAL_GITHUB_ACTIONS_BUILDX_GC_SWEEP_TIMEOUT_MS_V1
  });
  if (builder.code !== 0) return null;
  const containerName = `buildx_buildkit_${LOCAL_GITHUB_ACTIONS_BUILDX_NODE_NAME_V1}`;
  const container = await runDockerCommand(endpoint, [
    'container', 'inspect', containerName, '--format', '{{json .}}'
  ], { cwd, acceptedCodes: [0, 1] });
  if (container.code !== 0) fail('Buildx builder metadata exists without its exact governed node');
  const value = JSON.parse(container.stdout.toString('utf8').trim()) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('Buildx builder node inspection is invalid');
  }
  const record = value as Record<string, unknown>;
  const config = record.Config;
  const hostConfig = record.HostConfig;
  const state = record.State;
  if (config === null || typeof config !== 'object' || Array.isArray(config)
      || hostConfig === null || typeof hostConfig !== 'object' || Array.isArray(hostConfig)
      || state === null || typeof state !== 'object' || Array.isArray(state)) {
    fail('Buildx builder node configuration is invalid');
  }
  const configRecord = config as Record<string, unknown>;
  const hostRecord = hostConfig as Record<string, unknown>;
  const stateRecord = state as Record<string, unknown>;
  const expectedArgs = createLocalGitHubActionsBuildxBuildkitdFlagsV1();
  if (record.Name !== `/${containerName}`
      || record.Image !== LOCAL_GITHUB_ACTIONS_BUILDKIT_IMAGE_ID_V1
      || configRecord.Image !== LOCAL_GITHUB_ACTIONS_BUILDKIT_IMAGE_V1
      || JSON.stringify(record.Args) !== JSON.stringify(expectedArgs)
      || stateRecord.Running !== true || stateRecord.Status !== 'running'
      || hostRecord.Privileged !== true || hostRecord.Init !== true) {
    fail('Buildx builder node identity, budget, privilege or liveness differs from EnvironmentSpec');
  }
  const node = Object.freeze({
    name: LOCAL_GITHUB_ACTIONS_BUILDX_NODE_NAME_V1,
    status: 'running' as const,
    version: LOCAL_GITHUB_ACTIONS_BUILDKIT_IMAGE_ID_V1,
    gcPolicyDigest: sha256(expectedArgs) as `sha256:${string}`
  });
  const material = Object.freeze({
    schema: 'sec-local-github-actions-buildx-builder-observation-v1' as const,
    builderName: LOCAL_GITHUB_ACTIONS_BUILDX_BUILDER_NAME_V1,
    driver: LOCAL_GITHUB_ACTIONS_BUILDX_DRIVER_V1,
    cacheNamespace: LOCAL_GITHUB_ACTIONS_BUILDX_CACHE_NAMESPACE_V1,
    gcPolicy: LOCAL_GITHUB_ACTIONS_BUILDX_GC_POLICY_V1,
    buildkitdFlags: expectedArgs,
    dockerEndpointDigest: sha256(dockerEndpointIdentity(endpoint)) as `sha256:${string}`,
    nodes: Object.freeze([node])
  });
  return Object.freeze({ ...material, observationDigest: sha256(material) as `sha256:${string}` });
}

async function ensureLocalGitHubActionsBuildxBuilderAfterIntentV1(
  cwd: string,
  endpoint: DockerEndpointIdentityV3
): Promise<LocalGitHubActionsBuildxBuilderObservationV1> {
  await assertDockerEndpointIdentityV3(endpoint, cwd);
  const bootstrap = await runDockerCommand(endpoint, [
    'buildx', 'inspect', LOCAL_GITHUB_ACTIONS_BUILDX_BUILDER_NAME_V1, '--bootstrap'
  ], {
    cwd,
    acceptedCodes: [0, 1],
    timeoutMs: LOCAL_GITHUB_ACTIONS_BUILDX_GC_SWEEP_TIMEOUT_MS_V1
  });
  if (bootstrap.code !== 0) {
    await assertDockerEndpointIdentityV3(endpoint, cwd);
    await runDockerCommand(endpoint, [
      'buildx', 'create',
      '--name', LOCAL_GITHUB_ACTIONS_BUILDX_BUILDER_NAME_V1,
      '--node', LOCAL_GITHUB_ACTIONS_BUILDX_NODE_NAME_V1,
      '--driver', LOCAL_GITHUB_ACTIONS_BUILDX_DRIVER_V1,
      '--driver-opt', `image=${LOCAL_GITHUB_ACTIONS_BUILDKIT_IMAGE_V1}`,
      '--buildkitd-flags',
      createLocalGitHubActionsBuildxBuildkitdFlagsV1().join(' '),
      '--bootstrap'
    ], { cwd, timeoutMs: LOCAL_GITHUB_ACTIONS_BUILDX_GC_SWEEP_TIMEOUT_MS_V1 });
  }
  const observed = await observeLocalGitHubActionsBuildxBuilderV1(cwd, endpoint);
  if (observed === null) fail('Buildx builder create has no exact machine readback');
  return observed;
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

export async function assertDockerEndpointIdentityV3(
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
      || record['sec.local-runner.container-init'] !== LOCAL_GITHUB_ACTIONS_RUNNER_CONTAINER_INIT_CAPABILITY_V1
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
  const resources = providerResourceRoleV1(input.role);
  const observedCapabilities = Array.isArray(host.CapAdd)
    ? host.CapAdd.map(String).sort()
    : [];
  const expectedCapabilities = [...resources.capAdd].sort();
  if (JSON.stringify(observedCapabilities) !== JSON.stringify(expectedCapabilities)
      || !Array.isArray(host.CapDrop) || JSON.stringify(host.CapDrop) !== JSON.stringify(['ALL'])
      || !Array.isArray(host.SecurityOpt) || !host.SecurityOpt.includes('no-new-privileges:true')
      || host.Init !== true || host.Privileged !== false || host.Binds !== null) {
    fail('container capability boundary changed and is preserved');
  }
  if (host.PidsLimit !== resources.pids
      || host.Memory !== resources.memoryBytes
      || host.NanoCpus !== resources.cpus * 1_000_000_000) {
    fail(`${input.role} container resource boundary changed and is preserved`);
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

export function assertLocalGitHubActionsRunnerImageIdentityV1(
  value: Readonly<Record<string, unknown>>
): void {
  if (value.Id !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2) {
    fail('cached runner image ID differs from the frozen provider revision');
  }
  const config = value.Config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail('image config is invalid');
  const labels = (config as Record<string, unknown>).Labels;
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) fail('image labels are invalid');
  const record = labels as Record<string, unknown>;
  if (record['sec.local-runner.image-schema'] !== LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1
      || record['sec.local-runner.image-revision'] !== LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2
      || record['sec.local-runner.runner-version'] !== LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1
      || record['sec.local-runner.node-version'] !== LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1
      || record['sec.local-runner.node-archive-sha256']
        !== LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1
      || record['sec.local-runner.github-cli-version']
        !== LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1
      || record['sec.local-runner.github-cli-archive-sha256']
        !== LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1
      || record['sec.local-runner.python-version'] !== LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1
      || record['sec.local-runner.ubuntu-snapshot'] !== LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT_V1
      || record['sec.local-runner.bootstrap-ca-bundle-sha256']
        !== LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256_V1
      || record['sec.local-runner.dockerfile-frontend']
        !== LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND_V1) {
    fail('cached runner image labels differ from the frozen provider revision');
  }
}

export function assertLocalGitHubActionsRunnerReplacementImageIdentityV3(
  value: Readonly<Record<string, unknown>>,
  expectedImageId: typeof LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3[number]['replacementImageId']
): void {
  if (value.Id !== expectedImageId) fail('superseding frozen image identity differs from its decision');
  if (expectedImageId === LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2) {
    assertLocalGitHubActionsRunnerImageIdentityV1(value);
  } else if (expectedImageId !== LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_V7_IMAGE_ID_V1) {
    fail('superseding frozen image identity has no canonical lineage');
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

export interface LocalGitHubActionsRunnerOciProviderBindingV1 {
  readonly schema: 'sec-local-github-actions-runner-oci-provider-binding-v1';
  readonly specDigest: `sha256:${string}`;
  readonly generation: number;
  readonly generationDigest: `sha256:${string}`;
  readonly receiptDigest: `sha256:${string}`;
  readonly providerRef: string;
  readonly providerLedgerObjectSha: string;
  readonly providerLedgerDigest: `sha256:${string}`;
  readonly providerGeneration: number;
  readonly provenanceArtifactDigest: `sha256:${string}`;
}

export interface LocalGitHubActionsRunnerOciReceiptV1 {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RECEIPT_SCHEMA_V1;
  readonly specDigest: `sha256:${string}`;
  readonly runtimeManifestDigest: typeof LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1;
  readonly dockerProjectionDigest: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2;
  readonly provenanceArtifactDigest: `sha256:${string}`;
  readonly generation: number;
  readonly generationDigest: `sha256:${string}`;
  readonly providerRef: string;
  readonly providerLedgerObjectSha: string;
  readonly providerLedgerDigest: `sha256:${string}`;
  readonly providerGeneration: number;
  readonly layoutName: 'layout';
  readonly receiptDigest: `sha256:${string}`;
}

interface LocalGitHubActionsRunnerOciCacheV1 {
  readonly directory: PhysicalDirectoryIdentityV1;
  readonly layoutPath: string;
  readonly generation: LocalGitHubActionsRunnerOciGenerationV1 | null;
  readonly receipt: LocalGitHubActionsRunnerOciReceiptV1 | null;
  readonly state: 'absent' | 'matching' | 'mismatched';
}

type LocalGitHubActionsRunnerOciGenerationV1 = EnvironmentMaterializationGenerationV1;

export interface LocalGitHubActionsRunnerOciCandidateBindingV1 {
  readonly schema: 'sec-local-github-actions-runner-oci-candidate-binding-v1';
  readonly specDigest: `sha256:${string}`;
  readonly leaseName: typeof RUNNER_OCI_MATERIALIZATION_LEASE_NAME_V1;
  readonly candidateName: string;
  readonly owner: PhysicalMutationLeaseOwnerV1;
}

export function createLocalGitHubActionsRunnerOciCandidateBindingV1(
  specDigest: `sha256:${string}`,
  owner: PhysicalMutationLeaseOwnerV1
): LocalGitHubActionsRunnerOciCandidateBindingV1 {
  if (!/^sha256:[0-9a-f]{64}$/u.test(specDigest)) fail('OCI candidate spec digest is invalid');
  const token = owner.token.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/u.test(token)) fail('OCI candidate lease token is invalid');
  return Object.freeze({
    schema: 'sec-local-github-actions-runner-oci-candidate-binding-v1' as const,
    specDigest,
    leaseName: RUNNER_OCI_MATERIALIZATION_LEASE_NAME_V1,
    candidateName: `${RUNNER_OCI_CANDIDATE_PREFIX_V1}${token}`,
    owner
  });
}

export interface LocalGitHubActionsRunnerOciProviderCurrentV1 {
  readonly providerRef: string;
  readonly providerLedgerObjectSha: string;
  readonly providerLedgerDigest: `sha256:${string}`;
  readonly providerGeneration: number;
  readonly providerName: string;
  readonly operationLabel: string;
}

function assertOciProviderCurrentV1(
  input: LocalGitHubActionsRunnerOciProviderCurrentV1
): void {
  if (!/^[0-9a-f]{40}$/u.test(input.providerLedgerObjectSha)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.providerLedgerDigest)
      || !Number.isSafeInteger(input.providerGeneration) || input.providerGeneration < 0) {
    fail('OCI provider current identity is invalid');
  }
  providerBaseName(input.providerName);
  operationLabel(input.operationLabel);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(input.providerRef)) {
    fail('OCI provider current reference is invalid');
  }
}

function ociLeaseIdV1(
  specDigest: `sha256:${string}`,
  provider: LocalGitHubActionsRunnerOciProviderCurrentV1,
  owner: PhysicalMutationLeaseOwnerV1
): `sha256:${string}` {
  return sha256(Object.freeze({
    schema: 'sec-local-github-actions-runner-oci-materialization-lease-v1',
    specDigest,
    providerRef: provider.providerRef,
    providerLedgerObjectSha: provider.providerLedgerObjectSha,
    providerLedgerDigest: provider.providerLedgerDigest,
    providerGeneration: provider.providerGeneration,
    providerName: provider.providerName,
    operationLabel: provider.operationLabel,
    ownerToken: owner.token
  })) as `sha256:${string}`;
}

export function retireLocalGitHubActionsRunnerOciCandidateV1(
  directory: PhysicalDirectoryIdentityV1,
  binding: LocalGitHubActionsRunnerOciCandidateBindingV1
): void {
  if (path.basename(directory.path) !== binding.specDigest.slice(7)) {
    fail('OCI candidate cleanup generation differs from its spec');
  }
  const candidate = inspectNoFollowDirectoryChildV1(
    directory, binding.candidateName, 'Runner OCI materialization candidate'
  );
  if (candidate === null) return;
  const inventory = scanNoFollowDirectoryTreeMetadataV1(candidate, {
    deadlineAtMs: performance.now() + RUNNER_OCI_CLEANUP_BUDGET_MS_V1,
    maximumEntries: RUNNER_OCI_CLEANUP_MAXIMUM_ENTRIES_V1
  });
  const directories = new Map(inventory
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => [entry.relativePath, entry]));
  const depth = (relativePath: string): number => relativePath.split('/').length;
  for (const entry of [...inventory].sort((left, right) =>
    depth(right.relativePath) - depth(left.relativePath)
      || right.relativePath.localeCompare(left.relativePath))) {
    const parts = entry.relativePath.split('/');
    parts.pop();
    const ancestorDirectories = parts.map((_, index) => {
      const relativePath = parts.slice(0, index + 1).join('/');
      const ancestor = directories.get(relativePath);
      if (ancestor === undefined) fail('OCI candidate cleanup inventory is incomplete');
      return Object.freeze({ relativePath, device: ancestor.device, inode: ancestor.inode });
    });
    deleteRetainedNoFollowEntryV1({
      root: candidate,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      expectedLinkTarget: entry.linkTarget ?? undefined,
      ancestorDirectories
    });
  }
  deleteRetainedNoFollowEntryV1({
    root: directory,
    relativePath: binding.candidateName,
    kind: 'directory',
    device: candidate.device,
    inode: candidate.inode,
    ancestorDirectories: []
  });
  if (inspectExactNoFollowDirectoryPresenceV1(
    path.join(directory.path, binding.candidateName), 'Runner OCI candidate cleanup readback'
  ).state !== 'absent') fail('OCI candidate cleanup readback is not absent');
}

function runnerOciGenerationCanonicalBytesV1(
  generation: LocalGitHubActionsRunnerOciGenerationV1
): Buffer {
  return Buffer.from(`${JSON.stringify(generation)}\n`, 'utf8');
}

function readRunnerOciGenerationV1(
  directory: PhysicalDirectoryIdentityV1
): LocalGitHubActionsRunnerOciGenerationV1 | null {
  const bytes = readNoFollowOrdinaryFileV1(directory, RUNNER_OCI_GENERATION_FILE_NAME_V1);
  if (bytes === null) return null;
  const generation = parseEnvironmentMaterializationGenerationV1(
    Buffer.from(bytes).toString('utf8')
  );
  if (!runnerOciGenerationCanonicalBytesV1(generation).equals(Buffer.from(bytes))) {
    fail('OCI generation bytes are not canonical');
  }
  return generation;
}

function persistRunnerOciGenerationV1(
  directory: PhysicalDirectoryIdentityV1,
  generation: LocalGitHubActionsRunnerOciGenerationV1
): void {
  const bytes = runnerOciGenerationCanonicalBytesV1(generation);
  const existing = readNoFollowOrdinaryFileV1(directory, RUNNER_OCI_GENERATION_FILE_NAME_V1);
  const publish = existing === null ? publishExclusiveDurableCanonicalFileV1 : replaceDurableCanonicalFileV1;
  publish({
    parent: directory,
    name: RUNNER_OCI_GENERATION_FILE_NAME_V1,
    bytes,
    validate: (candidate) => {
      const parsed = parseEnvironmentMaterializationGenerationV1(
        Buffer.from(candidate).toString('utf8')
      );
      if (parsed.lifecycleDigest !== generation.lifecycleDigest
          || !runnerOciGenerationCanonicalBytesV1(parsed).equals(Buffer.from(candidate))) {
        fail('OCI generation readback differs from the staged lifecycle');
      }
    }
  });
}

function runnerOciGenerationMatchesProviderV1(
  generation: LocalGitHubActionsRunnerOciGenerationV1,
  specDigest: `sha256:${string}`,
  provider: LocalGitHubActionsRunnerOciProviderCurrentV1
): boolean {
  return generation.specDigest === specDigest
    && generation.providerRef === provider.providerRef
    && generation.providerObjectSha === provider.providerLedgerObjectSha
    && generation.providerDigest === provider.providerLedgerDigest
    && generation.providerGeneration === provider.providerGeneration;
}

function createRunnerOciGenerationV1(input: Readonly<{
  directory: PhysicalDirectoryIdentityV1;
  specDigest: `sha256:${string}`;
  provider: LocalGitHubActionsRunnerOciProviderCurrentV1;
  owner: PhysicalMutationLeaseOwnerV1;
  previous: LocalGitHubActionsRunnerOciGenerationV1 | null;
}>): LocalGitHubActionsRunnerOciGenerationV1 {
  assertOciProviderCurrentV1(input.provider);
  const generation = input.previous === null ? 0 : input.previous.generation + 1;
  return createEnvironmentMaterializationGenerationV1({
    specDigest: input.specDigest,
    generation,
    providerRef: input.provider.providerRef,
    providerObjectSha: input.provider.providerLedgerObjectSha,
    providerDigest: input.provider.providerLedgerDigest,
    providerGeneration: input.provider.providerGeneration,
    leaseId: ociLeaseIdV1(input.specDigest, input.provider, input.owner),
    phase: 'provisioning',
    retention: 'provider-current',
    terminalObligation: 'provider-absent-and-consumer-zero',
    receiptDigest: null,
    createdAt: new Date().toISOString(),
    terminalAt: null
  });
}

function bindRunnerOciReceiptToGenerationV1(
  receipt: LocalGitHubActionsRunnerOciReceiptV1,
  generation: LocalGitHubActionsRunnerOciGenerationV1
): LocalGitHubActionsRunnerOciProviderBindingV1 {
  if (receipt.specDigest !== generation.specDigest
      || receipt.generation !== generation.generation
      || receipt.generationDigest !== generation.generationDigest
      || receipt.providerRef !== generation.providerRef
      || receipt.providerLedgerObjectSha !== generation.providerObjectSha
      || receipt.providerLedgerDigest !== generation.providerDigest
      || receipt.providerGeneration !== generation.providerGeneration) {
    fail('OCI receipt is not bound to its provider-owned generation');
  }
  return Object.freeze({
    schema: 'sec-local-github-actions-runner-oci-provider-binding-v1' as const,
    specDigest: receipt.specDigest,
    generation: receipt.generation,
    generationDigest: receipt.generationDigest,
    receiptDigest: receipt.receiptDigest,
    providerRef: receipt.providerRef,
    providerLedgerObjectSha: receipt.providerLedgerObjectSha,
    providerLedgerDigest: receipt.providerLedgerDigest,
    providerGeneration: receipt.providerGeneration,
    provenanceArtifactDigest: receipt.provenanceArtifactDigest
  });
}

function assertRunnerOciProviderBindingV1(
  binding: LocalGitHubActionsRunnerOciProviderBindingV1,
  provider: LocalGitHubActionsRunnerOciProviderCurrentV1
): void {
  assertOciProviderCurrentV1(provider);
  if (binding.providerRef !== provider.providerRef
      || binding.providerLedgerObjectSha !== provider.providerLedgerObjectSha
      || binding.providerLedgerDigest !== provider.providerLedgerDigest
      || binding.providerGeneration !== provider.providerGeneration) {
    fail('OCI provider binding differs from the current provider generation');
  }
}

function createRunnerOciReceiptV1(
  input: Readonly<{
    specDigest: `sha256:${string}`;
    provenanceArtifactDigest: `sha256:${string}`;
    generation: LocalGitHubActionsRunnerOciGenerationV1;
  }>
): LocalGitHubActionsRunnerOciReceiptV1 {
  if (input.generation.specDigest !== input.specDigest
      || input.generation.phase === 'gc-pending') {
    fail('OCI receipt generation identity is invalid');
  }
  const body = Object.freeze({
    schema: LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RECEIPT_SCHEMA_V1,
    specDigest: input.specDigest,
    runtimeManifestDigest: LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1,
    dockerProjectionDigest: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    provenanceArtifactDigest: input.provenanceArtifactDigest,
    generation: input.generation.generation,
    generationDigest: input.generation.generationDigest,
    providerRef: input.generation.providerRef,
    providerLedgerObjectSha: input.generation.providerObjectSha,
    providerLedgerDigest: input.generation.providerDigest,
    providerGeneration: input.generation.providerGeneration,
    layoutName: 'layout' as const
  });
  return Object.freeze({
    ...body,
    receiptDigest: sha256(body) as `sha256:${string}`
  });
}

function publishRunnerOciReceiptV1(
  directory: PhysicalDirectoryIdentityV1,
  receipt: LocalGitHubActionsRunnerOciReceiptV1
): void {
  publishExclusiveDurableCanonicalFileV1({
    parent: directory,
    name: 'receipt.json',
    bytes: Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'),
    validate: (bytes) => { parseOciReceiptV1(bytes, receipt.specDigest); }
  });
}

function parseOciReceiptV1(source: Uint8Array, specDigest: `sha256:${string}`): LocalGitHubActionsRunnerOciReceiptV1 {
  const parsed = JSON.parse(Buffer.from(source).toString('utf8')) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('OCI cache receipt is invalid');
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'specDigest', 'runtimeManifestDigest', 'dockerProjectionDigest',
    'provenanceArtifactDigest', 'generation', 'generationDigest', 'providerRef',
    'providerLedgerObjectSha', 'providerLedgerDigest', 'providerGeneration', 'layoutName',
    'receiptDigest'
  ], 'OCI cache receipt');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RECEIPT_SCHEMA_V1
      || value.specDigest !== specDigest
      || value.runtimeManifestDigest !== LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1
      || value.dockerProjectionDigest !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2
      || !/^sha256:[0-9a-f]{64}$/u.test(String(value.provenanceArtifactDigest))
      || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(String(value.generationDigest))
      || typeof value.providerRef !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value.providerRef)
      || !/^[0-9a-f]{40}$/u.test(String(value.providerLedgerObjectSha))
      || !/^sha256:[0-9a-f]{64}$/u.test(String(value.providerLedgerDigest))
      || !Number.isSafeInteger(value.providerGeneration) || (value.providerGeneration as number) < 0
      || !/^sha256:[0-9a-f]{64}$/u.test(String(value.receiptDigest))
      || value.layoutName !== 'layout') {
    fail('OCI cache receipt identity is invalid');
  }
  const receipt = Object.freeze(value as unknown as LocalGitHubActionsRunnerOciReceiptV1);
  const { receiptDigest, ...body } = receipt;
  if (receiptDigest !== sha256(body)
      || !Buffer.from(source).equals(Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'))) {
    fail('OCI cache receipt bytes are not canonical');
  }
  return receipt;
}

interface OciDescriptorV1 {
  readonly mediaType: string;
  readonly digest: `sha256:${string}`;
  readonly size: number;
  readonly annotations?: Readonly<Record<string, unknown>>;
  readonly platform?: Readonly<Record<string, unknown>>;
}

function parseOciDescriptorV1(value: unknown, label: string): OciDescriptorV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} is invalid`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.mediaType !== 'string' || record.mediaType.length === 0
      || typeof record.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.digest)
      || !Number.isSafeInteger(record.size) || (record.size as number) < 0) {
    fail(`${label} identity is invalid`);
  }
  return record as unknown as OciDescriptorV1;
}

function validateOciBlobV1(
  blobs: PhysicalDirectoryIdentityV1,
  descriptor: OciDescriptorV1,
  label: string
): void {
  const observed = inspectNoFollowOrdinaryFileDigestV1(blobs, descriptor.digest.slice(7));
  if (observed === null || observed.size !== descriptor.size || observed.byteDigest !== descriptor.digest) {
    fail(`${label} blob identity is invalid`);
  }
}

function readOciJsonBlobV1(
  blobs: PhysicalDirectoryIdentityV1,
  descriptor: OciDescriptorV1,
  expectedMediaType: string,
  label: string
): Record<string, unknown> {
  if (descriptor.mediaType !== expectedMediaType) fail(`${label} media type is invalid`);
  validateOciBlobV1(blobs, descriptor, label);
  const bytes = readNoFollowOrdinaryFileV1(blobs, descriptor.digest.slice(7));
  if (bytes === null || bytes.byteLength !== descriptor.size
      || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== descriptor.digest) {
    fail(`${label} JSON blob identity changed during readback`);
  }
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} JSON is invalid`);
  }
  return parsed as Record<string, unknown>;
}

function assertOciIndexFramingV1(value: Record<string, unknown>, label: string): readonly unknown[] {
  if (value.schemaVersion !== 2 || value.mediaType !== 'application/vnd.oci.image.index.v1+json'
      || !Array.isArray(value.manifests)) {
    fail(`${label} framing is invalid`);
  }
  return value.manifests;
}

export function readValidatedRunnerOciLayoutIdentityV1(
  layoutPath: string,
  expectedRuntimeManifestDigest: `sha256:${string}` = LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1
): `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedRuntimeManifestDigest)) {
    fail('OCI cache expected runtime manifest digest is invalid');
  }
  const layout = inspectNoFollowDirectoryChainV1(layoutPath, 'OCI cache layout').target;
  const layoutBytes = readNoFollowOrdinaryFileV1(layout, 'oci-layout');
  const indexBytes = readNoFollowOrdinaryFileV1(layout, 'index.json');
  if (layoutBytes === null || indexBytes === null
      || Buffer.from(layoutBytes).toString('utf8').trim() !== '{"imageLayoutVersion":"1.0.0"}') {
    fail('OCI cache layout framing is invalid');
  }
  const index = JSON.parse(Buffer.from(indexBytes).toString('utf8')) as unknown;
  if (index === null || typeof index !== 'object' || Array.isArray(index)) fail('OCI cache index is invalid');
  const manifests = assertOciIndexFramingV1(index as Record<string, unknown>, 'OCI cache index');
  if (manifests.length !== 1) {
    fail('OCI cache index descriptor is invalid');
  }
  const nestedDescriptor = parseOciDescriptorV1(manifests[0], 'OCI cache nested index descriptor');
  const blobs = inspectNoFollowDirectoryChainV1(
    path.join(layout.path, 'blobs', 'sha256'), 'OCI cache blob directory'
  ).target;
  const nested = readOciJsonBlobV1(
    blobs, nestedDescriptor, 'application/vnd.oci.image.index.v1+json', 'OCI cache nested index'
  );
  const nestedManifests = assertOciIndexFramingV1(nested, 'OCI cache nested index');
  if (nestedManifests.length !== 2) fail('OCI cache must contain one runtime and one attestation manifest');
  const descriptors = nestedManifests.map((value, index) =>
    parseOciDescriptorV1(value, `OCI cache nested descriptor ${index}`));
  const runtimeDescriptor = descriptors.find((descriptor) =>
    descriptor.platform?.os === 'linux' && descriptor.platform.architecture === 'amd64');
  const attestationDescriptor = descriptors.find((descriptor) =>
    descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest');
  if (runtimeDescriptor === undefined || attestationDescriptor === undefined
      || runtimeDescriptor === attestationDescriptor
      || runtimeDescriptor.digest !== expectedRuntimeManifestDigest
      || attestationDescriptor.annotations?.['vnd.docker.reference.digest'] !== runtimeDescriptor.digest) {
    fail('OCI cache runtime or attestation identity is invalid');
  }
  const manifestMediaType = 'application/vnd.oci.image.manifest.v1+json';
  const runtime = readOciJsonBlobV1(blobs, runtimeDescriptor, manifestMediaType, 'OCI cache runtime manifest');
  if (runtime.schemaVersion !== 2 || runtime.mediaType !== manifestMediaType
      || !Array.isArray(runtime.layers)) fail('OCI cache runtime manifest framing is invalid');
  const runtimeConfig = parseOciDescriptorV1(runtime.config, 'OCI cache runtime config descriptor');
  if (runtimeConfig.mediaType !== 'application/vnd.oci.image.config.v1+json') {
    fail('OCI cache runtime config media type is invalid');
  }
  validateOciBlobV1(blobs, runtimeConfig, 'OCI cache runtime config');
  for (const [index, value] of runtime.layers.entries()) {
    const layer = parseOciDescriptorV1(value, `OCI cache runtime layer ${index}`);
    if (!/^application\/vnd\.(?:oci\.image|docker\.image\.rootfs)\.layer\./u.test(layer.mediaType)) {
      fail(`OCI cache runtime layer ${index} media type is invalid`);
    }
    validateOciBlobV1(blobs, layer, `OCI cache runtime layer ${index}`);
  }
  const attestation = readOciJsonBlobV1(
    blobs, attestationDescriptor, manifestMediaType, 'OCI cache attestation manifest'
  );
  const subject = parseOciDescriptorV1(attestation.subject, 'OCI cache attestation subject');
  if (attestation.schemaVersion !== 2 || attestation.mediaType !== manifestMediaType
      || attestation.artifactType !== 'application/vnd.docker.attestation.manifest.v1+json'
      || subject.mediaType !== runtimeDescriptor.mediaType
      || subject.digest !== runtimeDescriptor.digest || subject.size !== runtimeDescriptor.size
      || !Array.isArray(attestation.layers) || attestation.layers.length !== 1) {
    fail('OCI cache attestation subject is invalid');
  }
  const attestationConfig = parseOciDescriptorV1(attestation.config, 'OCI cache attestation config');
  if (attestationConfig.mediaType !== 'application/vnd.oci.empty.v1+json') {
    fail('OCI cache attestation config media type is invalid');
  }
  validateOciBlobV1(blobs, attestationConfig, 'OCI cache attestation config');
  const provenanceLayer = parseOciDescriptorV1(attestation.layers[0], 'OCI cache provenance layer');
  if (provenanceLayer.mediaType !== 'application/vnd.in-toto+json'
      || provenanceLayer.annotations?.['in-toto.io/predicate-type'] !== 'https://slsa.dev/provenance/v1') {
    fail('OCI cache provenance layer identity is invalid');
  }
  validateOciBlobV1(blobs, provenanceLayer, 'OCI cache provenance layer');
  return nestedDescriptor.digest;
}

export function recoverValidatedRunnerOciReceiptV1(
  directory: PhysicalDirectoryIdentityV1,
  specDigest: `sha256:${string}`,
  generation: LocalGitHubActionsRunnerOciGenerationV1 | null = readRunnerOciGenerationV1(directory)
): LocalGitHubActionsRunnerOciReceiptV1 {
  if (!/^sha256:[0-9a-f]{64}$/u.test(specDigest)) fail('OCI cache recovery spec digest is invalid');
  if (generation === null || generation.specDigest !== specDigest) {
    fail('OCI cache recovery has no exact provider-owned generation');
  }
  const layoutPath = path.join(directory.path, 'layout');
  const provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentityV1(layoutPath);
  const expected = createRunnerOciReceiptV1({ specDigest, provenanceArtifactDigest, generation });
  const existing = readNoFollowOrdinaryFileV1(directory, 'receipt.json');
  if (existing === null) publishRunnerOciReceiptV1(directory, expected);
  const readback = readNoFollowOrdinaryFileV1(directory, 'receipt.json');
  if (readback === null) fail('recovered OCI cache receipt has no durable readback');
  const receipt = parseOciReceiptV1(readback, specDigest);
  if (!Buffer.from(readback).equals(Buffer.from(`${JSON.stringify(expected)}\n`, 'utf8'))) {
    fail('OCI cache recovery receipt conflicts with the validated layout');
  }
  const published = transitionEnvironmentMaterializationGenerationV1({
    current: generation,
    phase: 'published',
    retention: 'provider-current',
    receiptDigest: expected.receiptDigest,
    terminalAt: null
  });
  persistRunnerOciGenerationV1(directory, published);
  return receipt;
}

async function resolveRunnerOciCacheDirectoryV1(cwd: string): Promise<Readonly<{
  directory: PhysicalDirectoryIdentityV1;
  layoutPath: string;
  specDigest: `sha256:${string}`;
}>> {
  const context = await resolveRepositoryContext(cwd);
  const cacheLayout = resolveSecRuntimeCacheLayoutV1({
    platform: currentSecRuntimePlatformV1(),
    environment: secRuntimeStateEnvironmentV1(),
    repositoryRoot: context.repositoryRoot
  });
  const spec = createLocalGitHubActionsRunnerEnvironmentSpecV1();
  const directoryPath = path.join(
    cacheLayout.environmentMaterializationRoot, 'oci', spec.specDigest.slice(7)
  );
  const authority = acquireSecRuntimeCachePhysicalAuthorityV1({
    repositoryRoot: context.repositoryRoot,
    cacheRoot: cacheLayout.cacheRoot,
    requiredDirectories: [directoryPath]
  });
  const directory = authority.directory(directoryPath);
  return Object.freeze({
    directory,
    layoutPath: path.join(directory.path, 'layout'),
    specDigest: spec.specDigest
  });
}

function inspectRunnerOciCacheDirectoryV1(input: Readonly<{
  directory: PhysicalDirectoryIdentityV1;
  layoutPath: string;
  specDigest: `sha256:${string}`;
}>): LocalGitHubActionsRunnerOciCacheV1 {
  const { directory, layoutPath, specDigest } = input;
  const generation = readRunnerOciGenerationV1(directory);
  const receiptBytes = readNoFollowOrdinaryFileV1(directory, 'receipt.json');
  const layoutPresent = (() => {
    try {
      const metadata = lstatSync(layoutPath);
      return metadata.isDirectory() && !metadata.isSymbolicLink();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  })();
  if (receiptBytes === null && !layoutPresent) {
    return Object.freeze({ directory, layoutPath, generation, receipt: null, state: 'absent' as const });
  }
  if (!layoutPresent) {
    return Object.freeze({ directory, layoutPath, generation, receipt: null, state: 'mismatched' as const });
  }
  if (receiptBytes === null) {
    // Recovery point for a crash after the validated layout rename and before
    // receipt publication. The layout is a content-addressed immutable object;
    // complete recursive revalidation deterministically reconstructs the only
    // admissible receipt instead of leaving a permanent dead cache state.
    if (generation === null) {
      return Object.freeze({ directory, layoutPath, generation, receipt: null, state: 'mismatched' as const });
    }
    const receipt = recoverValidatedRunnerOciReceiptV1(directory, specDigest, generation);
    return Object.freeze({ directory, layoutPath, generation: readRunnerOciGenerationV1(directory), receipt, state: 'matching' as const });
  }
  const receipt = parseOciReceiptV1(receiptBytes, specDigest);
  const provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentityV1(layoutPath);
  if (generation === null) {
    return Object.freeze({ directory, layoutPath, generation, receipt, state: 'mismatched' as const });
  }
  if (generation.phase !== 'provisioning'
      && (generation.receiptDigest !== receipt.receiptDigest
        || receipt.generationDigest !== generation.generationDigest)) {
    return Object.freeze({ directory, layoutPath, generation, receipt, state: 'mismatched' as const });
  }
  if (generation.phase !== 'provisioning') bindRunnerOciReceiptToGenerationV1(receipt, generation);
  return Object.freeze({
    directory,
    layoutPath,
    generation,
    receipt,
    state: provenanceArtifactDigest === receipt.provenanceArtifactDigest
      ? 'matching' as const
      : 'mismatched' as const
  });
}

async function inspectRunnerOciCacheV1(cwd: string): Promise<LocalGitHubActionsRunnerOciCacheV1> {
  return inspectRunnerOciCacheDirectoryV1(await resolveRunnerOciCacheDirectoryV1(cwd));
}

async function projectRunnerOciLayoutV1(
  cache: LocalGitHubActionsRunnerOciCacheV1,
  cwd: string,
  endpoint: DockerEndpointIdentityV3
): Promise<void> {
  const progress = createBuildxRawJsonProgressAdmissionV1();
  if (ENVIRONMENT.provenance.dockerProjectionMode !== 'disabled') {
    fail('unsupported Docker projection provenance policy');
  }
  await runDockerCommand(endpoint, createLocalGitHubActionsRunnerProjectionBuildxArgsV1(
    cache.layoutPath
  ), {
    cwd: cache.directory.path,
    input: Buffer.from('FROM runtime\n', 'utf8'),
    timeoutMs: ENVIRONMENT.provider.timeoutsMs.projectionAbsolute,
    stallTimeoutMs: ENVIRONMENT.provider.timeoutsMs.projectionStall,
    admitProgress: (chunk, stream) => stream === 'stderr' && progress.push(chunk)
  });
  progress.finish();
  const present = await inspectImage(cwd, endpoint);
  if (present?.Id !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2) {
    fail('OCI cache projection differs from the accepted Docker manifest');
  }
}

function publishRunnerOciLayoutV1(input: Readonly<{
  cache: LocalGitHubActionsRunnerOciCacheV1;
  binding: LocalGitHubActionsRunnerOciCandidateBindingV1;
  provenanceArtifactDigest: `sha256:${string}`;
  generation: LocalGitHubActionsRunnerOciGenerationV1;
}>): void {
  const candidatePath = path.join(input.cache.directory.path, input.binding.candidateName);
  if (input.binding.specDigest !== createLocalGitHubActionsRunnerEnvironmentSpecV1().specDigest
      || path.basename(input.cache.directory.path) !== input.binding.specDigest.slice(7)) {
    fail('OCI candidate binding differs from its cache generation');
  }
  if (input.generation.phase !== 'provisioning'
      || input.generation.specDigest !== input.binding.specDigest) {
    fail('OCI candidate publish requires a provisioning generation');
  }
  try {
    renameSync(candidatePath, input.cache.layoutPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existingDigest = readValidatedRunnerOciLayoutIdentityV1(input.cache.layoutPath);
    if (existingDigest !== input.provenanceArtifactDigest) {
      fail('OCI cache layout already exists with another identity');
    }
    retireLocalGitHubActionsRunnerOciCandidateV1(input.cache.directory, input.binding);
  }
  const receipt = createRunnerOciReceiptV1({
    specDigest: createLocalGitHubActionsRunnerEnvironmentSpecV1().specDigest,
    provenanceArtifactDigest: input.provenanceArtifactDigest,
    generation: input.generation
  });
  const existing = readNoFollowOrdinaryFileV1(input.cache.directory, 'receipt.json');
  if (existing === null) publishRunnerOciReceiptV1(input.cache.directory, receipt);
  else if (!Buffer.from(existing).equals(Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'))) {
    fail('OCI cache receipt conflicts with the validated layout');
  }
  persistRunnerOciGenerationV1(input.cache.directory, transitionEnvironmentMaterializationGenerationV1({
    current: input.generation,
    phase: 'published',
    retention: 'provider-current',
    receiptDigest: receipt.receiptDigest,
    terminalAt: null
  }));
}

function publishExistingRunnerOciReceiptV1(input: Readonly<{
  cache: LocalGitHubActionsRunnerOciCacheV1;
  generation: LocalGitHubActionsRunnerOciGenerationV1;
}>): LocalGitHubActionsRunnerOciReceiptV1 {
  if (input.generation.phase !== 'provisioning'
      || input.generation.specDigest !== createLocalGitHubActionsRunnerEnvironmentSpecV1().specDigest) {
    fail('OCI existing-layout rebind requires a provisioning generation');
  }
  const provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentityV1(input.cache.layoutPath);
  const receipt = createRunnerOciReceiptV1({
    specDigest: input.generation.specDigest,
    provenanceArtifactDigest,
    generation: input.generation
  });
  const existing = readNoFollowOrdinaryFileV1(input.cache.directory, 'receipt.json');
  if (existing === null) publishRunnerOciReceiptV1(input.cache.directory, receipt);
  else if (!Buffer.from(existing).equals(Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'))) {
    replaceDurableCanonicalFileV1({
      parent: input.cache.directory,
      name: 'receipt.json',
      bytes: Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'),
      validate: (candidate) => { parseOciReceiptV1(candidate, input.generation.specDigest); }
    });
  }
  persistRunnerOciGenerationV1(input.cache.directory, transitionEnvironmentMaterializationGenerationV1({
    current: input.generation,
    phase: 'published',
    retention: 'provider-current',
    receiptDigest: receipt.receiptDigest,
    terminalAt: null
  }));
  return receipt;
}

function recoverReclaimedRunnerOciCandidateV1(
  cache: LocalGitHubActionsRunnerOciCacheV1,
  binding: LocalGitHubActionsRunnerOciCandidateBindingV1,
  generation: LocalGitHubActionsRunnerOciGenerationV1
): 'absent' | 'published' | 'retired-invalid' {
  const candidatePath = path.join(cache.directory.path, binding.candidateName);
  const candidate = inspectNoFollowDirectoryChildV1(
    cache.directory, binding.candidateName, 'Reclaimed runner OCI materialization candidate'
  );
  if (candidate === null) return 'absent';
  let provenanceArtifactDigest: `sha256:${string}`;
  try {
    provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentityV1(candidatePath);
  } catch {
    retireLocalGitHubActionsRunnerOciCandidateV1(cache.directory, binding);
    return 'retired-invalid';
  }
  try {
    publishRunnerOciLayoutV1({ cache, binding, provenanceArtifactDigest, generation });
    return 'published';
  } catch (error) {
    // The candidate belongs to the exact dead owner generation reclaimed by
    // the held lease. Preserve any conflicting published layout, but never
    // retain a second full copy of this operation-owned candidate.
    retireLocalGitHubActionsRunnerOciCandidateV1(cache.directory, binding);
    throw error;
  }
}

export function reconcileReclaimedLocalGitHubActionsRunnerOciCandidateV1(input: Readonly<{
  directory: PhysicalDirectoryIdentityV1;
  specDigest: `sha256:${string}`;
  owner: PhysicalMutationLeaseOwnerV1;
  generation?: LocalGitHubActionsRunnerOciGenerationV1;
}>): 'absent' | 'published' | 'retired-invalid' {
  if (path.basename(input.directory.path) !== input.specDigest.slice(7)) {
    fail('Reclaimed OCI candidate cache generation differs from its spec');
  }
  if (input.generation === undefined) {
    const candidate = inspectNoFollowDirectoryChildV1(
      input.directory,
      createLocalGitHubActionsRunnerOciCandidateBindingV1(input.specDigest, input.owner).candidateName,
      'Reclaimed OCI candidate without provider generation'
    );
    if (candidate !== null) {
      try {
        readValidatedRunnerOciLayoutIdentityV1(candidate.path);
        fail('reclaimed OCI candidate has no provider-owned generation');
      } catch (error) {
        if (error instanceof Error && error.message.includes('no provider-owned generation')) throw error;
      }
    }
    retireLocalGitHubActionsRunnerOciCandidateV1(
      input.directory,
      createLocalGitHubActionsRunnerOciCandidateBindingV1(input.specDigest, input.owner)
    );
    return 'retired-invalid';
  }
  return recoverReclaimedRunnerOciCandidateV1(
    Object.freeze({
      directory: input.directory,
      layoutPath: path.join(input.directory.path, 'layout'),
       generation: input.generation,
       receipt: null,
      state: 'absent' as const
    }),
    createLocalGitHubActionsRunnerOciCandidateBindingV1(input.specDigest, input.owner),
    input.generation
  );
}

function acquireRunnerOciMaterializationLeaseV1(
  cache: LocalGitHubActionsRunnerOciCacheV1,
  specDigest: `sha256:${string}`,
  provider: LocalGitHubActionsRunnerOciProviderCurrentV1
): Readonly<{
  lease: PhysicalMutationLeaseHandleV1;
  binding: LocalGitHubActionsRunnerOciCandidateBindingV1;
  generation: LocalGitHubActionsRunnerOciGenerationV1;
}> {
  if (path.basename(cache.directory.path) !== specDigest.slice(7)) {
    fail('OCI cache directory differs from the materialization spec');
  }
  const lease = acquirePhysicalMutationLeaseV1(
    cache.directory,
    RUNNER_OCI_MATERIALIZATION_LEASE_NAME_V1,
    { ttlMs: ENVIRONMENT.provider.timeoutsMs.materializeAbsolute
        + ENVIRONMENT.provider.timeoutsMs.projectionAbsolute + 60_000 }
  );
  if (lease === null) fail('OCI materialization is owned by another live or unverified process');
  try {
    if (lease.reclaimedOwner !== null) {
      reconcileReclaimedLocalGitHubActionsRunnerOciCandidateV1({
        directory: cache.directory,
        specDigest,
        owner: lease.reclaimedOwner,
        generation: cache.generation ?? undefined
      });
    }
    let previous = readRunnerOciGenerationV1(cache.directory);
    if (previous !== null && !runnerOciGenerationMatchesProviderV1(previous, specDigest, provider)) {
      const terminal = transitionEnvironmentMaterializationGenerationV1({
        current: previous,
        phase: 'terminal',
        retention: 'provider-terminal',
        receiptDigest: previous.receiptDigest,
        terminalAt: new Date().toISOString()
      });
      persistRunnerOciGenerationV1(cache.directory, terminal);
      previous = terminal;
    }
    const generation = previous !== null && runnerOciGenerationMatchesProviderV1(previous, specDigest, provider)
      && previous.phase === 'provisioning'
      ? previous
      : createRunnerOciGenerationV1({
        directory: cache.directory,
        specDigest,
        provider,
        owner: lease.owner,
        previous
      });
    persistRunnerOciGenerationV1(cache.directory, generation);
    return Object.freeze({
      lease,
      binding: createLocalGitHubActionsRunnerOciCandidateBindingV1(specDigest, lease.owner),
      generation
    });
  } catch (error) {
    lease.release();
    throw error;
  }
}

async function ensureImage(
  cwd: string,
  endpoint: DockerEndpointIdentityV3,
  provider: LocalGitHubActionsRunnerOciProviderCurrentV1
): Promise<LocalGitHubActionsRunnerOciProviderBindingV1> {
  assertOciProviderCurrentV1(provider);
  let present = await inspectImage(cwd, endpoint);
  const spec = createLocalGitHubActionsRunnerEnvironmentSpecV1();
  const cacheDirectory = await resolveRunnerOciCacheDirectoryV1(cwd);
  let cache = inspectRunnerOciCacheDirectoryV1(cacheDirectory);
  const compileCurrentPlan = () => compileEnvironmentMaterializationPlanV1({
    spec,
    observation: {
      localTag: present === null
        ? 'absent'
        : present.Id === LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2
          ? 'matching'
          : 'mismatched',
      localImageDigest: present === null
        ? null
        : /^sha256:[0-9a-f]{64}$/u.test(String(present.Id))
          ? present.Id as `sha256:${string}`
          : fail('runner image readback has an invalid identity'),
      offlineArtifact: cache.state,
      immutableBuildInputs: 'available',
      providerCapability: 'available'
    }
  });
  let plan = compileCurrentPlan();
  const needsProviderRebind = cache.state !== 'matching' || cache.generation === null
    || cache.receipt === null || !runnerOciGenerationMatchesProviderV1(
      cache.generation, spec.specDigest, provider
    ) || cache.generation.phase !== 'published';
  const materialization = plan.disposition === 'materialize' || needsProviderRebind
    ? acquireRunnerOciMaterializationLeaseV1(cache, spec.specDigest, provider)
    : null;
  try {
    if (materialization !== null) {
      // The lease is the mutation fence, not an excuse to trust the earlier
      // observation.  Re-read both projections and recompile before Buildx.
      cache = inspectRunnerOciCacheDirectoryV1(cacheDirectory);
      present = await inspectImage(cwd, endpoint);
      plan = compileCurrentPlan();
    }
    if (plan.disposition === 'blocked') {
      fail(`environment materialization is blocked: ${plan.reason}`);
    }
    if (materialization !== null && plan.disposition !== 'materialize') {
      if (cache.layoutPath === undefined || cache.state === 'mismatched') {
        fail('OCI provider rebind has no exact reusable layout');
      }
      const generation = materialization.generation;
      const rebound = publishExistingRunnerOciReceiptV1({ cache, generation });
      cache = Object.freeze({
        ...cache,
        generation: readRunnerOciGenerationV1(cache.directory),
        receipt: rebound,
        state: 'matching' as const
      });
    }
    if (plan.disposition === 'restore-local') {
      await projectRunnerOciLayoutV1(cache!, cwd, endpoint);
      present = await inspectImage(cwd, endpoint);
    }
    if (plan.disposition === 'materialize') {
      if (materialization === null) fail('OCI materialization has no acquired cache lease');
      const candidatePath = path.join(cache.directory.path, materialization.binding.candidateName);
      const progress = createBuildxRawJsonProgressAdmissionV1();
      await runDockerCommand(endpoint, [
        'buildx', 'bake', '--builder', LOCAL_GITHUB_ACTIONS_BUILDX_BUILDER_NAME_V1, '--file', '-',
        `--progress=${ENVIRONMENT.provider.progressMode}`,
      ], {
        cwd,
        input: Buffer.from(createLocalGitHubActionsRunnerOciBakeDefinitionV1(candidatePath), 'utf8'),
        timeoutMs: ENVIRONMENT.provider.timeoutsMs.materializeAbsolute,
        stallTimeoutMs: ENVIRONMENT.provider.timeoutsMs.materializeStall,
        admitProgress: (chunk, stream) => stream === 'stderr' && progress.push(chunk)
      });
      progress.finish();
      const provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentityV1(candidatePath);
      publishRunnerOciLayoutV1({
        cache,
        binding: materialization.binding,
        provenanceArtifactDigest,
        generation: materialization.generation
      });
      const publishedCache = await inspectRunnerOciCacheV1(cwd);
      if (publishedCache.state !== 'matching') fail('published OCI cache has no exact readback');
      await projectRunnerOciLayoutV1(publishedCache, cwd, endpoint);
      present = await inspectImage(cwd, endpoint);
      if (present === null) fail('runner image build has no exact readback');
    }
    if (present === null) fail('runner image materialization has no exact readback');
    assertLocalGitHubActionsRunnerImageIdentityV1(present);
    const finalCache = inspectRunnerOciCacheDirectoryV1(cacheDirectory);
    if (finalCache.state !== 'matching' || finalCache.receipt === null
        || finalCache.generation === null || finalCache.generation.phase !== 'published') {
      fail('runner image materialization has no exact OCI closure readback');
    }
    const providerBinding = bindRunnerOciReceiptToGenerationV1(
      finalCache.receipt,
      finalCache.generation
    );
    assertRunnerOciProviderBindingV1(providerBinding, provider);
    return providerBinding;
  } finally {
    if (materialization !== null) {
      try {
        retireLocalGitHubActionsRunnerOciCandidateV1(cache.directory, materialization.binding);
      } finally {
        const generation = readRunnerOciGenerationV1(cache.directory);
        if (generation !== null && generation.phase === 'provisioning') {
          persistRunnerOciGenerationV1(cache.directory, transitionEnvironmentMaterializationGenerationV1({
            current: generation,
            phase: 'terminal',
            retention: 'provider-terminal',
            receiptDigest: generation.receiptDigest,
            terminalAt: new Date().toISOString()
          }));
        }
        materialization.lease.release();
      }
    }
  }
}

export interface LocalGitHubActionsRunnerOciSettlementV1 {
  readonly schema: 'sec-local-github-actions-runner-oci-settlement-v1';
  readonly specDigest: `sha256:${string}`;
  readonly generation: number;
  readonly generationDigest: `sha256:${string}`;
  readonly receiptDigest: `sha256:${string}` | null;
  readonly providerLedgerObjectSha: string;
  readonly providerGeneration: number;
  readonly providerLedgerAbsent: true;
  readonly consumerCount: 0;
  readonly terminal: true;
  readonly retainedLayout: true;
}

function assertProviderEnsureConsumerZeroV1(
  authority: LocalGitHubActionsRuntimeAuthorityV1,
  repositoryStateRoot: string,
  expectedRepository?: string,
  expectedProviderName?: string
): LocalGitHubActionsProviderEnsureReceiptV2 | null {
  const current = readProviderEnsureReceiptV2(
    providerEnsureReceiptDirectoryV1(authority, repositoryStateRoot)
  );
  if (current !== null && current.consumerCount !== 0) {
    fail('OCI generation settlement requires canonical provider ensure consumer-zero current');
  }
  if (current !== null && expectedRepository !== undefined
      && current.repository.toLowerCase() !== expectedRepository.toLowerCase()) {
    fail('provider ensure current belongs to another repository and is preserved');
  }
  if (current !== null && expectedProviderName !== undefined
      && current.providerName !== expectedProviderName) {
    fail('provider ensure current belongs to another provider and is preserved');
  }
  return current;
}

/**
 * Close one OCI generation only after the provider ledger is absent and the
 * provider ensure current has zero consumers.  The provider mutation lease is
 * held by the caller, and this function acquires the nested OCI lease before
 * touching the generation.  A raw caller-supplied consumer count is
 * intentionally impossible: zero is derived from the canonical current
 * receipt while both leases are held.
 */
async function settleLocalGitHubActionsRunnerOciGenerationV1Unlocked(input: Readonly<{
  cwd: string;
  repository: string;
  provider: LocalGitHubActionsRunnerOciProviderCurrentV1;
  authority: LocalGitHubActionsRuntimeAuthorityV1;
  repositoryStateRoot: string;
}>): Promise<LocalGitHubActionsRunnerOciSettlementV1 | null> {
  assertOciProviderCurrentV1(input.provider);
  if (!input.provider.providerRef.startsWith('refs/')) {
    fail('OCI generation settlement requires a ref-backed provider identity');
  }
  assertProviderEnsureConsumerZeroV1(
    input.authority,
    input.repositoryStateRoot,
    input.repository,
    input.provider.providerName
  );
  const resolved = await resolveRunnerOciCacheDirectoryV1(input.cwd);
  const ociLease = acquirePhysicalMutationLeaseV1(
    resolved.directory,
    RUNNER_OCI_MATERIALIZATION_LEASE_NAME_V1,
    { ttlMs: ENVIRONMENT.provider.timeoutsMs.materializeAbsolute
        + ENVIRONMENT.provider.timeoutsMs.projectionAbsolute + 60_000 }
  );
  if (ociLease === null) fail('OCI generation is owned by another live or unverified process');
  try {
    // Re-read every lower-level projection only after acquiring the nested
    // lease.  This closes the zero-race between an ensure materialization and
    // provider teardown.
    if (await observeRemoteRefSha(input.cwd, input.provider.providerRef) !== null) {
      fail('OCI generation settlement requires an absent provider ledger');
    }
    if (ociLease.reclaimedOwner !== null) {
      // A dead materializer may have left a candidate tree behind.  Provider
      // teardown never publishes that uncommitted candidate; it retires the
      // exact dead-owner bytes while the OCI fence is held.
      retireLocalGitHubActionsRunnerOciCandidateV1(
        resolved.directory,
        createLocalGitHubActionsRunnerOciCandidateBindingV1(
          resolved.specDigest,
          ociLease.reclaimedOwner
        )
      );
    }
    const current = assertProviderEnsureConsumerZeroV1(
      input.authority,
      input.repositoryStateRoot,
      input.repository,
      input.provider.providerName
    );
    const refreshed = readRunnerOciGenerationV1(resolved.directory);
    if (refreshed === null) return null;
    if (!runnerOciGenerationMatchesProviderV1(refreshed, resolved.specDigest, input.provider)) {
      fail('OCI generation provider identity changed and is preserved');
    }
    if (current !== null && current.consumerCount !== 0) {
      fail('OCI generation settlement lost canonical provider ensure consumer-zero proof');
    }
    const terminal = refreshed.phase === 'terminal' || refreshed.phase === 'gc-pending'
      ? refreshed
      : transitionEnvironmentMaterializationGenerationV1({
        current: refreshed,
        phase: 'terminal',
        retention: 'provider-terminal',
        receiptDigest: refreshed.receiptDigest,
        terminalAt: new Date().toISOString()
      });
    if (terminal !== refreshed) persistRunnerOciGenerationV1(resolved.directory, terminal);
    await input.authority.assertCurrent();
    assertProviderEnsureConsumerZeroV1(
      input.authority,
      input.repositoryStateRoot,
      input.repository,
      input.provider.providerName
    );
    return Object.freeze({
      schema: 'sec-local-github-actions-runner-oci-settlement-v1' as const,
      specDigest: terminal.specDigest,
      generation: terminal.generation,
      generationDigest: terminal.generationDigest,
      receiptDigest: terminal.receiptDigest,
      providerLedgerObjectSha: terminal.providerObjectSha,
      providerGeneration: terminal.providerGeneration,
      providerLedgerAbsent: true as const,
      consumerCount: 0 as const,
      terminal: true as const,
      retainedLayout: true as const
    });
  } finally {
    ociLease.release();
  }
}

/**
 * Public settlement entry point.  It establishes the required authority and
 * provider lease itself; lifecycle callers already holding that lease use the
 * unlocked helper above to avoid re-entry.
 */
export async function settleLocalGitHubActionsRunnerOciGenerationV1(input: Readonly<{
  cwd: string;
  repository: string;
  provider: LocalGitHubActionsRunnerOciProviderCurrentV1;
}>): Promise<LocalGitHubActionsRunnerOciSettlementV1 | null> {
  const repository = repositoryName(input.repository);
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentityV2(context.repositoryRoot, repository);
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository,
    repositoryRoot: context.repositoryRoot
  });
  const receiptRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2
  );
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: context.repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [receiptRoot]
  });
  return await withProviderMutationLeaseV1({
    authority,
    repositoryStateRoot: runtimeLayout.repositoryStateRoot,
    operation: async () => await settleLocalGitHubActionsRunnerOciGenerationV1Unlocked({
      cwd: context.repositoryRoot,
      repository,
      provider: input.provider,
      authority,
      repositoryStateRoot: runtimeLayout.repositoryStateRoot
    })
  });
}

export interface LocalGitHubActionsRunnerToolchainMaterializationV1 {
  readonly specDigest: `sha256:${string}`;
  readonly layoutPath: string;
  readonly runtimeManifestDigest: typeof LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1;
  readonly dockerProjectionDigest: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2;
  readonly provenanceArtifactDigest: `sha256:${string}`;
}

export async function ensureLocalGitHubActionsRunnerToolchainMaterializationV1(
  cwd: string
): Promise<LocalGitHubActionsRunnerToolchainMaterializationV1> {
  const endpoint = await observeDockerEndpointIdentityV3(cwd);
  const builder = await ensureLocalGitHubActionsBuildxBuilderAfterIntentV1(cwd, endpoint);
  const provider: LocalGitHubActionsRunnerOciProviderCurrentV1 = Object.freeze({
    providerRef: `buildx://${builder.builderName}`,
    providerLedgerObjectSha: builder.observationDigest.slice(7, 47),
    providerLedgerDigest: builder.observationDigest,
    providerGeneration: 0,
    providerName: 'buildx',
    operationLabel: `sec-operation-${sha256(Object.freeze({
      schema: 'sec-local-github-actions-runner-toolchain-provider-v1',
      builderObservationDigest: builder.observationDigest
    })).slice(7)}`
  });
  await ensureImage(cwd, endpoint, provider);
  const cache = await inspectRunnerOciCacheV1(cwd);
  if (cache.state !== 'matching' || cache.receipt === null) {
    fail('toolchain image has no exact reusable OCI materialization');
  }
  return Object.freeze({
    specDigest: cache.receipt.specDigest,
    layoutPath: cache.layoutPath,
    runtimeManifestDigest: cache.receipt.runtimeManifestDigest,
    dockerProjectionDigest: cache.receipt.dockerProjectionDigest,
    provenanceArtifactDigest: cache.receipt.provenanceArtifactDigest
  });
}

/**
 * Cold-cache toolchain bootstrap only. This does not register a runner,
 * contact the Actions service, create provider state, or consume Actions
 * minutes; provider-neutral trusted runtimes reuse the already pinned image
 * layers as an immutable Linux toolchain base.
 */
export async function ensureLocalGitHubActionsRunnerToolchainImageV1(
  cwd: string
): Promise<typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2> {
  const materialization = await ensureLocalGitHubActionsRunnerToolchainMaterializationV1(cwd);
  return materialization.dockerProjectionDigest;
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
  input: Omit<LocalGitHubActionsProviderLedgerV3,
    'schema' | 'profileLabel' | 'imageId' | 'resourceBinding' | 'ledgerDigest'>
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
    resourceBinding: createLocalGitHubActionsProviderResourceBindingV1(),
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
    'resourceBinding', 'lifecycle', 'generation', 'predecessorObjectSha', 'instances', 'ledgerDigest'
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
  assertCanonicalProviderResourceBindingV1(value.resourceBinding, 'provider ledger resource binding');
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
    imageId: ledger.imageId,
    resourceBinding: ledger.resourceBinding
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
  let result: CommandResult | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      result = await runCommand('git', [
        'ls-remote', '--exit-code', '--refs', 'origin', ref
      ], { cwd, acceptedCodes: [0, 2] });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = /TLS connect error:.*unexpected eof|connection reset|Failed to connect|Could not resolve host/iu
        .test(message);
      if (!transient || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
  if (result === null) fail(`remote ref ${ref} observation produced no result`);
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
  const resources = providerResourceRoleV1(input.role);
  const args = [
    'run', '--detach', '--init', '--name', name,
    '--entrypoint', '/usr/bin/sleep', '--user', '0',
    '--cap-drop', 'ALL',
    ...resources.capAdd.flatMap((capability) => [
      '--cap-add', capability.replace(/^CAP_/u, '')
    ]),
    '--security-opt', 'no-new-privileges:true',
    '--pids-limit', String(resources.pids),
    '--memory', String(resources.memoryBytes),
    '--cpus', String(resources.cpus),
    '--label', `sec.local-runner.schema=${LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3}`,
    '--label', `sec.local-runner.repository=${input.cursor.ledger.repository}`,
    '--label', `sec.local-runner.provider-name=${input.cursor.ledger.providerName}`,
    '--label', `sec.local-runner.instance-name=${name}`,
    '--label', `sec.local-runner.role=${input.role}`,
    '--label', `sec.local-runner.operation-label=${input.cursor.ledger.operationLabel}`,
    '--label', `sec.local-runner.container-init=${LOCAL_GITHUB_ACTIONS_RUNNER_CONTAINER_INIT_CAPABILITY_V1}`,
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
    createLocalGitHubActionsRunnerSupervisorScriptV1()
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

async function startLocalGitHubActionsProviderAfterIntentV3(input: Readonly<{
  cwd: string;
  repository: string;
  name: string;
  authority: LocalGitHubActionsRuntimeAuthorityV1;
  repositoryStateRoot: string;
  expectedDockerEndpoint?: DockerEndpointIdentityV3;
  expectedGitHubEndpoint?: GitHubEndpointIdentityV3;
}>): Promise<LocalGitHubActionsRunnerStateV3> {
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.name);
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentityV2(context.repositoryRoot, repository);
  if (readStateProjection(context.commonDirectory) !== null) {
    fail(`active state already exists at ${statePath(context.commonDirectory)}`);
  }
  const dockerEndpoint = await observeDockerEndpointIdentityV3(context.repositoryRoot);
  const githubEndpoint = await observeGitHubEndpointIdentityV3(context.repositoryRoot, repository);
  if (input.expectedDockerEndpoint !== undefined
      && JSON.stringify(dockerEndpoint) !== JSON.stringify(input.expectedDockerEndpoint)) {
    fail('Docker endpoint changed after provider ensure intent and before effect');
  }
  if (input.expectedGitHubEndpoint !== undefined
      && JSON.stringify(githubEndpoint) !== JSON.stringify(input.expectedGitHubEndpoint)) {
    fail('GitHub endpoint changed after provider ensure intent and before effect');
  }
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
    await ensureImage(context.repositoryRoot, dockerEndpoint, {
      providerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
      providerLedgerObjectSha: cursor.objectSha,
      providerLedgerDigest: cursor.ledger.ledgerDigest,
      providerGeneration: cursor.ledger.generation,
      providerName,
      operationLabel: retainedOperationLabel
    });
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
        role
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
        await settleLocalGitHubActionsRunnerOciGenerationV1Unlocked({
          cwd: context.repositoryRoot,
          repository,
          provider: {
            providerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
            providerLedgerObjectSha: cursor.objectSha,
            providerLedgerDigest: cursor.ledger.ledgerDigest,
            providerGeneration: cursor.ledger.generation,
            providerName,
            operationLabel: retainedOperationLabel
          },
          authority: input.authority,
          repositoryStateRoot: input.repositoryStateRoot
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
      || JSON.stringify(ledger.resourceBinding) !== JSON.stringify(state.resourceBinding)
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
      || JSON.stringify(state.resourceBinding) !== JSON.stringify(ledger.resourceBinding)
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

function providerEnsureCanonicalBytesV1(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function providerEnsureReceiptDirectoryV1(
  authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthorityV1>>,
  repositoryStateRoot: string
): PhysicalDirectoryIdentityV1 {
  return authority.directory(path.join(repositoryStateRoot, LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2));
}

function providerSettlementDirectoryV1(
  authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthorityV1>>,
  repositoryStateRoot: string
): PhysicalDirectoryIdentityV1 {
  return authority.directory(path.join(
    repositoryStateRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2,
    LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_LAYOUT_V1
  ));
}

type LocalGitHubActionsRuntimeAuthorityV1 =
  Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthorityV1>>;

function acquireProviderMutationLeaseV1(
  authority: LocalGitHubActionsRuntimeAuthorityV1,
  repositoryStateRoot: string,
  allowReclaim = false
): PhysicalMutationLeaseHandleV1 {
  // Authority is always issued before this lease.  All Docker/GitHub and OCI
  // effects happen below this fence; callers must not acquire it after a
  // lower-level effect lease.
  const directory = providerEnsureReceiptDirectoryV1(authority, repositoryStateRoot);
  const ttlMs = ENVIRONMENT.provider.timeoutsMs.materializeAbsolute
    + ENVIRONMENT.provider.timeoutsMs.projectionAbsolute + 60_000;
  const lease = acquirePhysicalMutationLeaseV1(
    directory,
    LOCAL_GITHUB_ACTIONS_PROVIDER_MUTATION_LEASE_NAME_V1,
    allowReclaim
      ? { ttlMs }
      : { ttlMs, processAlive: () => 'alive' as const }
  );
  if (lease === null) fail('provider mutation is owned by another live or unverified process');
  return lease;
}

async function withProviderMutationLeaseV1<T>(input: Readonly<{
  authority: LocalGitHubActionsRuntimeAuthorityV1;
  repositoryStateRoot: string;
  allowReclaim?: boolean;
  operation: () => Promise<T>;
}>): Promise<T> {
  const lease = acquireProviderMutationLeaseV1(
    input.authority,
    input.repositoryStateRoot,
    input.allowReclaim === true
  );
  try {
    await input.authority.assertCurrent();
    return await input.operation();
  } finally {
    lease.release();
  }
}

function readProviderEnsureIntentV1(
  directory: PhysicalDirectoryIdentityV1
): LocalGitHubActionsProviderEnsureIntentV1 | null {
  const bytes = readNoFollowOrdinaryFileV1(directory, 'intent.json');
  return bytes === null ? null : parseLocalGitHubActionsProviderEnsureIntentV1(
    Buffer.from(bytes).toString('utf8')
  );
}

function readProviderEnsureReceiptV2(
  directory: PhysicalDirectoryIdentityV1
): LocalGitHubActionsProviderEnsureReceiptV2 | null {
  const bytes = readNoFollowOrdinaryFileV1(directory, 'current.json');
  return bytes === null ? null : parseLocalGitHubActionsProviderEnsureReceiptV2(
    Buffer.from(bytes).toString('utf8')
  );
}

function readProviderSettlementIntentV1(
  directory: PhysicalDirectoryIdentityV1
): LocalGitHubActionsProviderSettlementIntentV1 | null {
  const bytes = readNoFollowOrdinaryFileV1(directory, 'intent.json');
  return bytes === null ? null : parseLocalGitHubActionsProviderSettlementIntentV1(
    Buffer.from(bytes).toString('utf8')
  );
}

function readProviderSettlementReceiptV1(
  directory: PhysicalDirectoryIdentityV1
): LocalGitHubActionsProviderSettlementReceiptV1 | null {
  const bytes = readNoFollowOrdinaryFileV1(directory, 'current.json');
  return bytes === null ? null : parseLocalGitHubActionsProviderSettlementReceiptV1(
    Buffer.from(bytes).toString('utf8')
  );
}

export type LocalGitHubActionsProviderSettlementObservationV1 =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ receipt: LocalGitHubActionsProviderSettlementReceiptV1; status: 'present' }>;

export type LocalGitHubActionsProviderEnsureObservationV1 =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ receipt: LocalGitHubActionsProviderEnsureReceiptV2; status: 'present' }>;

/** Read the one canonical ensure current pointer without scanning history. */
async function observeLocalGitHubActionsProviderEnsureV2Unlocked(input: Readonly<{
  authority: LocalGitHubActionsRuntimeAuthorityV1;
  repositoryStateRoot: string;
}>): Promise<LocalGitHubActionsProviderEnsureObservationV1> {
  const { authority, repositoryStateRoot } = input;
  const directory = providerEnsureReceiptDirectoryV1(authority, repositoryStateRoot);
  await authority.assertCurrent();
  const bytes = readNoFollowOrdinaryFileV1(directory, 'current.json');
  if (bytes === null) return Object.freeze({ status: 'absent' });
  const receipt = parseLocalGitHubActionsProviderEnsureReceiptV2(Buffer.from(bytes).toString('utf8'));
  if (!Buffer.from(bytes).equals(providerEnsureCanonicalBytesV1(receipt))) {
    fail('provider ensure current receipt is not canonical');
  }
  await authority.assertCurrent();
  return Object.freeze({ status: 'present', receipt });
}

export async function observeLocalGitHubActionsProviderEnsureV2(input: Readonly<{
  repository: string;
  repositoryRoot: string;
}>): Promise<LocalGitHubActionsProviderEnsureObservationV1> {
  const layout = resolveSecRuntimeStateForRepositoryV1(input);
  const receiptRoot = path.join(layout.repositoryStateRoot, LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2);
  if (inspectExactNoFollowDirectoryPresenceV1(
    receiptRoot,
    'Provider ensure observation read root'
  ).state === 'absent') {
    return Object.freeze({ status: 'absent' });
  }
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: input.repositoryRoot,
    stateRoot: layout.stateRoot,
    cacheRoot: layout.cacheRoot,
    requiredDirectories: [receiptRoot]
  });
  return await withProviderMutationLeaseV1({
    authority,
    repositoryStateRoot: layout.repositoryStateRoot,
    operation: async () => await observeLocalGitHubActionsProviderEnsureV2Unlocked({
      authority,
      repositoryStateRoot: layout.repositoryStateRoot
    })
  });
}

async function mutateLocalGitHubActionsProviderConsumerV1<T>(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  mutate: (current: LocalGitHubActionsProviderEnsureReceiptV2) => Readonly<{
    receipt: LocalGitHubActionsProviderEnsureReceiptV2;
    result: T;
  }>;
}>): Promise<T> {
  const layout = resolveSecRuntimeStateForRepositoryV1(input);
  const receiptRoot = path.join(layout.repositoryStateRoot, LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2);
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: input.repositoryRoot,
    stateRoot: layout.stateRoot,
    cacheRoot: layout.cacheRoot,
    requiredDirectories: [receiptRoot]
  });
  return await withProviderMutationLeaseV1({
    authority,
    repositoryStateRoot: layout.repositoryStateRoot,
    operation: async () => {
      const directory = providerEnsureReceiptDirectoryV1(authority, layout.repositoryStateRoot);
      await authority.assertCurrent();
      const current = readProviderEnsureReceiptV2(directory);
      if (current === null) fail('provider consumer mutation requires one current ensure receipt');
      const transition = input.mutate(current);
      if (transition.receipt.receiptDigest !== current.receiptDigest) {
        const reread = readProviderEnsureReceiptV2(directory);
        if (reread?.receiptDigest !== current.receiptDigest ||
            reread.transitionEpoch !== current.transitionEpoch) {
          fail('provider consumer current CAS failed');
        }
        persistProviderEnsureReceiptV2(directory, transition.receipt);
      }
      await authority.assertCurrent();
      return transition.result;
    }
  });
}

export async function acquireLocalGitHubActionsProviderConsumerV1(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  consumerId: string;
}>): Promise<Readonly<{
  receipt: LocalGitHubActionsProviderEnsureReceiptV2;
  binding: LocalGitHubActionsProviderConsumerBindingV1;
}>> {
  return await mutateLocalGitHubActionsProviderConsumerV1({
    ...input,
    mutate: (current) => {
      const acquired = acquireLocalGitHubActionsProviderConsumerReceiptV1({
        current, consumerId: input.consumerId, observedAt: new Date().toISOString()
      });
      return Object.freeze({ receipt: acquired.receipt, result: acquired });
    }
  });
}

export async function releaseLocalGitHubActionsProviderConsumerV1(input: Readonly<{
  repository: string;
  repositoryRoot: string;
  consumerId: string;
  credential: `sha256:${string}`;
  expectedReceiptDigest: `sha256:${string}`;
  expectedLeaseId: `sha256:${string}`;
  expectedEpoch: number;
}>): Promise<LocalGitHubActionsProviderEnsureReceiptV2> {
  return await mutateLocalGitHubActionsProviderConsumerV1({
    ...input,
    mutate: (current) => {
      const receipt = releaseLocalGitHubActionsProviderConsumerReceiptV1({
        current,
        consumerId: input.consumerId,
        credential: input.credential,
        expectedReceiptDigest: input.expectedReceiptDigest,
        expectedLeaseId: input.expectedLeaseId,
        expectedEpoch: input.expectedEpoch,
        observedAt: new Date().toISOString()
      });
      return Object.freeze({ receipt, result: receipt });
    }
  });
}

async function observeLocalGitHubActionsProviderSettlementV1Unlocked(input: Readonly<{
  authority: LocalGitHubActionsRuntimeAuthorityV1;
  repositoryStateRoot: string;
  settlementRoot: string;
}>): Promise<LocalGitHubActionsProviderSettlementObservationV1> {
  const { authority, repositoryStateRoot, settlementRoot } = input;
  if (inspectExactNoFollowDirectoryPresenceV1(
    settlementRoot,
    'Provider settlement current read root'
  ).state === 'absent') {
    return Object.freeze({ status: 'absent' });
  }
  const directory = providerSettlementDirectoryV1(authority, repositoryStateRoot);
  await authority.assertCurrent();
  const bytes = readNoFollowOrdinaryFileV1(directory, 'current.json');
  if (bytes === null) {
    await authority.assertCurrent();
    return Object.freeze({ status: 'absent' });
  }
  const receipt = parseLocalGitHubActionsProviderSettlementReceiptV1(
    Buffer.from(bytes).toString('utf8')
  );
  if (!Buffer.from(bytes).equals(providerEnsureCanonicalBytesV1(receipt))) {
    fail('provider settlement current receipt is not canonical');
  }
  await authority.assertCurrent();
  return Object.freeze({ status: 'present', receipt });
}

/**
 * Read-only settlement consumer surface.  Callers identify the repository;
 * the Runtime State layout and physical authority derive the sole
 * `settlement/current.json` location.  No writer, path, intent history or
 * alternate provider projection is exposed to consumers.
 */
export async function observeLocalGitHubActionsProviderSettlementV1(input: Readonly<{
  repository: string;
  repositoryRoot: string;
}>): Promise<LocalGitHubActionsProviderSettlementObservationV1> {
  const layout = resolveSecRuntimeStateForRepositoryV1({
    repository: input.repository,
    repositoryRoot: input.repositoryRoot
  });
  const receiptRoot = path.join(layout.repositoryStateRoot, LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2);
  const settlementRoot = path.join(receiptRoot, LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_LAYOUT_V1);
  if (inspectExactNoFollowDirectoryPresenceV1(
    receiptRoot,
    'Provider settlement observation read root'
  ).state === 'absent'
      || inspectExactNoFollowDirectoryPresenceV1(
        settlementRoot,
        'Provider settlement observation current root'
      ).state === 'absent') {
    return Object.freeze({ status: 'absent' });
  }
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: input.repositoryRoot,
    stateRoot: layout.stateRoot,
    cacheRoot: layout.cacheRoot,
    requiredDirectories: [receiptRoot]
  });
  return await withProviderMutationLeaseV1({
    authority,
    repositoryStateRoot: layout.repositoryStateRoot,
    operation: async () => await observeLocalGitHubActionsProviderSettlementV1Unlocked({
      authority,
      repositoryStateRoot: layout.repositoryStateRoot,
      settlementRoot
    })
  });
}

function persistProviderEnsureIntentV1(
  directory: PhysicalDirectoryIdentityV1,
  intent: LocalGitHubActionsProviderEnsureIntentV1
): void {
  const bytes = providerEnsureCanonicalBytesV1(intent);
  replaceDurableCanonicalFileV1({
    parent: directory,
    name: 'intent.json',
    bytes,
    validate: (candidate) => {
      const parsed = parseLocalGitHubActionsProviderEnsureIntentV1(
        Buffer.from(candidate).toString('utf8')
      );
      if (parsed.intentDigest !== intent.intentDigest) {
        fail('provider ensure intent readback differs from the staged intent');
      }
    }
  });
}

function persistProviderEnsureReceiptV2(
  directory: PhysicalDirectoryIdentityV1,
  receipt: LocalGitHubActionsProviderEnsureReceiptV2
): void {
  const bytes = providerEnsureCanonicalBytesV1(receipt);
  replaceDurableCanonicalFileV1({
    parent: directory,
    name: 'current.json',
    bytes,
    validate: (candidate) => {
      const parsed = parseLocalGitHubActionsProviderEnsureReceiptV2(
        Buffer.from(candidate).toString('utf8')
      );
      if (parsed.receiptDigest !== receipt.receiptDigest) {
        fail('provider ensure receipt readback differs from the current receipt');
      }
    }
  });
}

function persistProviderSettlementIntentV1(
  directory: PhysicalDirectoryIdentityV1,
  intent: LocalGitHubActionsProviderSettlementIntentV1
): void {
  const bytes = providerEnsureCanonicalBytesV1(intent);
  replaceDurableCanonicalFileV1({
    parent: directory,
    name: 'intent.json',
    bytes,
    validate: (candidate) => {
      const parsed = parseLocalGitHubActionsProviderSettlementIntentV1(
        Buffer.from(candidate).toString('utf8')
      );
      if (parsed.intentDigest !== intent.intentDigest) {
        fail('provider settlement intent readback differs from the staged intent');
      }
    }
  });
}

function persistProviderSettlementReceiptV1(
  directory: PhysicalDirectoryIdentityV1,
  receipt: LocalGitHubActionsProviderSettlementReceiptV1
): void {
  const bytes = providerEnsureCanonicalBytesV1(receipt);
  replaceDurableCanonicalFileV1({
    parent: directory,
    name: 'current.json',
    bytes,
    validate: (candidate) => {
      const parsed = parseLocalGitHubActionsProviderSettlementReceiptV1(
        Buffer.from(candidate).toString('utf8')
      );
      if (parsed.receiptDigest !== receipt.receiptDigest) {
        fail('provider settlement receipt readback differs from the current receipt');
      }
    }
  });
}

function deleteProviderEnsureFileIfPresentV1(
  directory: PhysicalDirectoryIdentityV1,
  name: 'intent.json' | 'current.json'
): void {
  const entry = inspectNoFollowOrdinaryFileEntryV1(directory, name);
  if (entry === null) return;
  deleteRetainedNoFollowEntryV1({
    root: directory,
    relativePath: name,
    kind: 'file',
    device: entry.device,
    inode: entry.inode,
    ancestorDirectories: []
  });
  if (readNoFollowOrdinaryFileV1(directory, name) !== null) {
    fail(`provider ensure ${name} remains after consumer-zero retirement`);
  }
}

function deleteProviderSettlementIntentIfPresentV1(
  directory: PhysicalDirectoryIdentityV1
): void {
  const entry = inspectNoFollowOrdinaryFileEntryV1(directory, 'intent.json');
  if (entry === null) return;
  deleteRetainedNoFollowEntryV1({
    root: directory,
    relativePath: 'intent.json',
    kind: 'file',
    device: entry.device,
    inode: entry.inode,
    ancestorDirectories: []
  });
  if (readNoFollowOrdinaryFileV1(directory, 'intent.json') !== null) {
    fail('provider settlement intent remains after exact cleanup');
  }
}

function deleteProviderSettlementReceiptIfPresentV1(
  directory: PhysicalDirectoryIdentityV1
): void {
  const entry = inspectNoFollowOrdinaryFileEntryV1(directory, 'current.json');
  if (entry === null) return;
  deleteRetainedNoFollowEntryV1({
    root: directory,
    relativePath: 'current.json',
    kind: 'file',
    device: entry.device,
    inode: entry.inode,
    ancestorDirectories: []
  });
  if (readNoFollowOrdinaryFileV1(directory, 'current.json') !== null) {
    fail('provider settlement current remains after a new active ensure generation');
  }
}

function retireProviderEnsureCurrentV2(
  authority: LocalGitHubActionsRuntimeAuthorityV1,
  repositoryStateRoot: string
): void {
  const directory = providerEnsureReceiptDirectoryV1(authority, repositoryStateRoot);
  const current = readProviderEnsureReceiptV2(directory);
  if (current !== null && current.consumerCount !== 0) {
    fail('provider ensure current has active consumers and cannot retire');
  }
  deleteProviderEnsureFileIfPresentV1(directory, 'current.json');
  deleteProviderEnsureFileIfPresentV1(directory, 'intent.json');
}

function providerSettlementIntentFromStateV1(
  state: LocalGitHubActionsRunnerStateV3,
  reason: LocalGitHubActionsProviderSettlementReasonV1,
  generation?: number
): LocalGitHubActionsProviderSettlementIntentV1 {
  return createLocalGitHubActionsProviderSettlementIntentV1({
    repository: state.repository,
    providerName: state.providerName,
    operationLabel: state.operationLabel,
    desiredDigest: generation === undefined
      ? state.stateDigest
      : providerEnsureDesiredFromStateV1(state, generation).desiredDigest,
    providerLedgerObjectSha: state.providerLedgerObjectSha,
    dockerEndpoint: state.dockerEndpoint,
    githubEndpoint: state.githubEndpoint,
    reason,
    issuedAt: new Date().toISOString()
  });
}

function providerSettlementIntentFromIdentityV1(input: Readonly<{
  repository: string;
  providerName: string;
  dockerEndpoint: DockerEndpointIdentityV3;
  githubEndpoint: GitHubEndpointIdentityV3;
  reason: LocalGitHubActionsProviderSettlementReasonV1;
  operationLabel?: string | null;
  desiredDigest?: `sha256:${string}` | null;
  providerLedgerObjectSha?: string | null;
}>): LocalGitHubActionsProviderSettlementIntentV1 {
  return createLocalGitHubActionsProviderSettlementIntentV1({
    repository: input.repository,
    providerName: input.providerName,
    operationLabel: input.operationLabel ?? null,
    desiredDigest: input.desiredDigest ?? null,
    providerLedgerObjectSha: input.providerLedgerObjectSha ?? null,
    dockerEndpoint: input.dockerEndpoint,
    githubEndpoint: input.githubEndpoint,
    reason: input.reason,
    issuedAt: new Date().toISOString()
  });
}

async function publishProviderSettlementAfterExactCleanupV1(input: Readonly<{
  repositoryRoot: string;
  commonDirectory: string;
  repository: string;
  intent: LocalGitHubActionsProviderSettlementIntentV1;
  authority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthorityV1>>;
  retireActiveEnsure?: boolean;
  ociSettlement?: LocalGitHubActionsRunnerOciSettlementV1 | null;
}>): Promise<LocalGitHubActionsProviderSettlementReceiptV1> {
  const activeDirectory = providerEnsureReceiptDirectoryV1(
    input.authority,
    resolveSecRuntimeStateForRepositoryV1({
      repository: input.repository,
      repositoryRoot: input.repositoryRoot
    }).repositoryStateRoot
  );
  const settlementDirectory = providerSettlementDirectoryV1(
    input.authority,
    resolveSecRuntimeStateForRepositoryV1({
      repository: input.repository,
      repositoryRoot: input.repositoryRoot
    }).repositoryStateRoot
  );
  await input.authority.assertCurrent();
  if (readStateProjection(input.commonDirectory) !== null) {
    fail('provider settlement requires an absent local state projection');
  }
  if (await observeRemoteRefSha(
    input.repositoryRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3
  ) !== null) {
    fail('provider settlement requires an absent remote provider ledger');
  }
  const exactNames = new Set(LOCAL_GITHUB_ACTIONS_RUNNER_ROLES_V2.map((role) =>
    instanceName(input.intent.providerName, role)));
  const runners = await listRepositoryRunners(input.repository, input.repositoryRoot);
  if (runners.some((runner) => exactNames.has(String(runner.name))
      || isProviderProfileEligibleRunnerV2(runner))) {
    fail('provider settlement runner inventory is not absent');
  }
  const containers = await listProviderProfileContainersV3(
    input.repository,
    input.repositoryRoot,
    input.intent.dockerEndpoint
  );
  if (containers.length !== 0) fail('provider settlement container inventory is not absent');
  const namedContainers = await Promise.all([...exactNames].map((name) =>
    inspectContainerByName(name, input.repositoryRoot, input.intent.dockerEndpoint)));
  if (namedContainers.some((container) => container !== null)) {
    fail('provider settlement exact container inventory is not absent');
  }
  assertProviderEnsureConsumerZeroV1(
    input.authority,
    resolveSecRuntimeStateForRepositoryV1({
      repository: input.repository,
      repositoryRoot: input.repositoryRoot
    }).repositoryStateRoot,
    input.repository,
    input.intent.providerName
  );
  const ociResolved = await resolveRunnerOciCacheDirectoryV1(input.repositoryRoot);
  const ociReadbackLease = acquirePhysicalMutationLeaseV1(
    ociResolved.directory,
    RUNNER_OCI_MATERIALIZATION_LEASE_NAME_V1,
    { ttlMs: ENVIRONMENT.provider.timeoutsMs.materializeAbsolute
        + ENVIRONMENT.provider.timeoutsMs.projectionAbsolute + 60_000 }
  );
  if (ociReadbackLease === null) {
    fail('provider settlement OCI readback is owned by another live or unverified process');
  }
  let ociGeneration: LocalGitHubActionsRunnerOciGenerationV1 | null;
  try {
    ociGeneration = readRunnerOciGenerationV1(ociResolved.directory);
    if (ociGeneration !== null
        && ociGeneration.phase !== 'terminal'
        && ociGeneration.phase !== 'gc-pending') {
      fail('provider settlement OCI generation is not terminal after cleanup');
    }
    if (input.ociSettlement !== undefined
        && input.ociSettlement !== null
        && (ociGeneration === null
          || ociGeneration.generationDigest !== input.ociSettlement.generationDigest
          || ociGeneration.receiptDigest !== input.ociSettlement.receiptDigest)) {
      fail('provider settlement OCI generation changed before final readback');
    }
  if (input.retireActiveEnsure === true) {
    deleteProviderEnsureFileIfPresentV1(activeDirectory, 'current.json');
    deleteProviderEnsureFileIfPresentV1(activeDirectory, 'intent.json');
  } else if (readProviderEnsureReceiptV2(activeDirectory) !== null
      || readProviderEnsureIntentV1(activeDirectory) !== null) {
    fail('provider settlement active ensure projection is not absent');
  }
  const receipt = createLocalGitHubActionsProviderSettlementReceiptV1({
    repository: input.intent.repository,
    providerName: input.intent.providerName,
    operationLabel: input.intent.operationLabel,
    desiredDigest: input.intent.desiredDigest,
    providerLedgerObjectSha: input.intent.providerLedgerObjectSha,
    dockerEndpoint: input.intent.dockerEndpoint,
    githubEndpoint: input.intent.githubEndpoint,
    reason: input.intent.reason,
    intentIssuedAt: input.intent.issuedAt,
    intentDigest: input.intent.intentDigest,
    runnersAbsent: true,
    containersAbsent: true,
    providerLedgerAbsent: true,
    stateProjectionAbsent: true,
    ensureCurrentAbsent: true,
    ensureIntentAbsent: true,
    imageRetained: true,
    ociGenerationDigest: ociGeneration?.generationDigest ?? null,
    ociReceiptDigest: ociGeneration?.receiptDigest ?? null,
    observedAt: new Date().toISOString()
  });
  persistProviderSettlementReceiptV1(settlementDirectory, receipt);
  deleteProviderSettlementIntentIfPresentV1(settlementDirectory);
  await input.authority.assertCurrent();
  const readback = readProviderSettlementReceiptV1(settlementDirectory);
  if (readback === null || readback.receiptDigest !== receipt.receiptDigest) {
    fail('provider settlement receipt readback is absent or changed');
  }
  return receipt;
  } finally {
    ociReadbackLease.release();
  }
}

function providerEnsureDesiredFromStateV1(
  state: LocalGitHubActionsRunnerStateV3,
  generation: number
): LocalGitHubActionsProviderEnsureDesiredV1 {
  return createLocalGitHubActionsProviderEnsureDesiredV1({
    repository: state.repository,
    providerName: state.providerName,
    operationLabel: state.operationLabel,
    providerLedgerRef: state.providerLedgerRef,
    providerLedgerObjectSha: state.providerLedgerObjectSha,
    providerLedgerDigest: state.providerLedgerDigest,
    generation,
    dockerEndpoint: state.dockerEndpoint,
    githubEndpoint: state.githubEndpoint,
    imageId: state.imageId,
    instances: state.instances,
    stateDigest: state.stateDigest
  });
}

async function loadProviderEnsureDesiredV1(
  repositoryRoot: string,
  repository: string,
  state: LocalGitHubActionsRunnerStateV3
): Promise<LocalGitHubActionsProviderEnsureDesiredV1> {
  const cursor = await loadCurrentProviderLedgerCursorV3(repositoryRoot, repository);
  if (cursor === null) fail('provider ensure current state has no remote generation authority');
  assertProviderLedgerMatchesState(cursor.ledger, state);
  if (cursor.objectSha !== state.providerLedgerObjectSha
      || cursor.ledger.ledgerDigest !== state.providerLedgerDigest) {
    fail('provider ensure current state is stale against the remote generation');
  }
  return providerEnsureDesiredFromStateV1(state, cursor.ledger.generation);
}

async function reconcileProviderContainersV1(
  repositoryRoot: string,
  repository: string,
  providerName: string,
  state: LocalGitHubActionsRunnerStateV3
): Promise<readonly string[]> {
  await assertDockerEndpointIdentityV3(state.dockerEndpoint, repositoryRoot);
  await assertGitHubEndpointIdentityV3(state.githubEndpoint, repositoryRoot);
  assertExactLocalGitHubActionsRunnerProfileContainersV3({
    containers: await listProviderProfileContainersV3(repository, repositoryRoot, state.dockerEndpoint),
    instances: state.instances,
    repository,
    providerName,
    operationLabel: state.operationLabel
  });
  const reconciled: string[] = [];
  for (const instance of state.instances) {
    const container = await inspectContainerById(instance.containerId, repositoryRoot, state.dockerEndpoint);
    if (container === null || container.Id !== instance.containerId) {
      fail(`provider container ${instance.containerName} identity drifted and is preserved`);
    }
    const containerState = container.State;
    let running = containerState !== null && typeof containerState === 'object'
      && !Array.isArray(containerState)
      && (containerState as Record<string, unknown>).Running === true;
    if (!running) {
      await runDockerCommand(state.dockerEndpoint, ['start', instance.containerId], {
        cwd: repositoryRoot
      });
      const restarted = await inspectContainerById(instance.containerId, repositoryRoot, state.dockerEndpoint);
      if (restarted === null || restarted.Id !== instance.containerId) {
        fail(`provider container ${instance.containerName} identity disappeared after start`);
      }
      const restartedState = restarted.State;
      running = restartedState !== null && typeof restartedState === 'object'
        && !Array.isArray(restartedState)
        && (restartedState as Record<string, unknown>).Running === true;
      if (!running) fail(`provider container ${instance.containerName} did not become running`);
    }
    const processWitness = await observeLocalGitHubActionsRunnerProcessWitnessV1({
      cwd: repositoryRoot,
      endpoint: state.dockerEndpoint,
      containerId: instance.containerId
    });
    const online = (await listRepositoryRunners(repository, repositoryRoot))
      .some((runner) => runner.name === instance.name && runner.status === 'online');
    if (processWitness === 'alive') {
      if (online) continue;
      fail(`provider runner ${instance.name} process is alive while GitHub is offline; restart is refused`);
    }
    if (processWitness !== 'absent') {
      fail(`provider runner ${instance.name} process witness is ${processWitness}; restart is refused`);
    }
    const configured = await runDockerCommand(state.dockerEndpoint, [
      'exec', instance.containerId, 'bash', '-lc', 'test -f .runner'
    ], { cwd: repositoryRoot });
    if (configured.code !== 0) {
      fail(`provider container ${instance.containerName} lost its runner configuration; rebuild via stop/start`);
    }
    await runDockerCommand(state.dockerEndpoint, [
      'exec', '--detach', instance.containerId, 'bash', '-lc',
      createLocalGitHubActionsRunnerSupervisorScriptV1()
    ], { cwd: repositoryRoot });
    const runner = await waitForRunner(repository, instance.name, repositoryRoot, 60);
    assertOwnedLocalGitHubActionsRunnerV2(runner, {
      name: instance.name,
      role: instance.role,
      operationLabel: state.operationLabel,
      runnerId: instance.runnerId
    });
    reconciled.push(instance.containerName);
  }
  assertExactLocalGitHubActionsRunnerProfileInventoryV3({
    runners: await listRepositoryRunners(repository, repositoryRoot),
    instances: state.instances,
    operationLabel: state.operationLabel
  });
  return Object.freeze([...reconciled].sort());
}

/**
 * Ensure the exact provider state and publish one replaceable current receipt.
 * The intent is written before any Docker/GitHub effect; equivalent healthy
 * calls only read and return `current.json`, so observation does not grow a
 * receipt history.  Older receipt generations are deliberately not scanned.
 */
export async function ensureLocalGitHubActionsProviderV3(input: Readonly<{
  cwd: string;
  repository: string;
  name: string;
}>): Promise<LocalGitHubActionsProviderEnsureReceiptV2> {
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.name);
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentityV2(context.repositoryRoot, repository);
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository,
    repositoryRoot: context.repositoryRoot
  });
  const receiptRoot = path.join(runtimeLayout.repositoryStateRoot, LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2);
  const settlementRoot = path.join(
    receiptRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_LAYOUT_V1
  );
  const runtimeAuthority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: context.repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [receiptRoot, settlementRoot]
  });
  const receiptDirectory = providerEnsureReceiptDirectoryV1(runtimeAuthority, runtimeLayout.repositoryStateRoot);
  const settlementDirectory = providerSettlementDirectoryV1(
    runtimeAuthority,
    runtimeLayout.repositoryStateRoot
  );
  const providerLease = acquireProviderMutationLeaseV1(
    runtimeAuthority,
    runtimeLayout.repositoryStateRoot
  );
  try {
    await runtimeAuthority.assertCurrent();
  const projection = readStateProjection(context.commonDirectory);
  if (projection === null) {
    const dockerEndpoint = await observeDockerEndpointIdentityV3(context.repositoryRoot);
    const githubEndpoint = await observeGitHubEndpointIdentityV3(context.repositoryRoot, repository);
    const orphans = await listProviderProfileContainersV3(repository, context.repositoryRoot, dockerEndpoint);
    if (orphans.length !== 0) fail('provider containers exist without a state projection and are preserved');
    const settlementIntent = providerSettlementIntentFromIdentityV1({
      repository,
      providerName,
      dockerEndpoint,
      githubEndpoint,
      reason: 'start-failure'
    });
    persistProviderSettlementIntentV1(settlementDirectory, settlementIntent);
    await runtimeAuthority.assertCurrent();
    const intent = createLocalGitHubActionsProviderEnsureIntentV1({
      repository,
      providerName,
      dockerEndpoint,
      githubEndpoint,
      imageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
      environmentInputDigest: SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST_V1,
      issuedAt: new Date().toISOString()
    });
    persistProviderEnsureIntentV1(receiptDirectory, intent);
    await runtimeAuthority.assertCurrent();
    let started: LocalGitHubActionsRunnerStateV3;
    try {
      await ensureLocalGitHubActionsBuildxBuilderAfterIntentV1(context.repositoryRoot, dockerEndpoint);
      await runtimeAuthority.assertCurrent();
      started = await startLocalGitHubActionsProviderAfterIntentV3({
        ...input,
        authority: runtimeAuthority,
        repositoryStateRoot: runtimeLayout.repositoryStateRoot,
        expectedDockerEndpoint: dockerEndpoint,
        expectedGitHubEndpoint: githubEndpoint
      });
    } catch (error) {
      try {
        await publishProviderSettlementAfterExactCleanupV1({
          repositoryRoot: context.repositoryRoot,
          commonDirectory: context.commonDirectory,
          repository,
          intent: settlementIntent,
          authority: runtimeAuthority,
          retireActiveEnsure: true
        });
      } catch (settlementError) {
        throw new AggregateError([error, settlementError],
          'provider start failed and bounded settlement is unresolved');
      }
      throw error;
    }
    await runtimeAuthority.assertCurrent();
    const desired = await loadProviderEnsureDesiredV1(context.repositoryRoot, repository, started);
    const builder = await observeLocalGitHubActionsBuildxBuilderV1(
      context.repositoryRoot, started.dockerEndpoint
    );
    if (builder === null) fail('provider ensure lost its Buildx builder before receipt publication');
    const ociBinding = await ensureImage(context.repositoryRoot, started.dockerEndpoint, {
      providerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
      providerLedgerObjectSha: started.providerLedgerObjectSha,
      providerLedgerDigest: started.providerLedgerDigest,
      providerGeneration: desired.generation,
      providerName: started.providerName,
      operationLabel: started.operationLabel
    });
    await runtimeAuthority.assertCurrent();
    const publishCurrent = readProviderEnsureReceiptV2(receiptDirectory);
    if (publishCurrent !== null) {
      fail('provider ensure current appeared before first receipt publication');
    }
    const receipt = createLocalGitHubActionsProviderEnsureReceiptV2({
      repository,
      providerName: started.providerName,
      outcome: 'started-fresh',
      desired,
      intentDigest: intent.intentDigest,
      endpointDigest: providerEnsureEndpointDigestV1(desired),
      builderObservationDigest: builder.observationDigest,
      ociBinding,
      reconciledContainers: [],
      transitionEpoch: 0,
      consumers: [],
      observedAt: new Date().toISOString()
    });
    persistProviderEnsureReceiptV2(receiptDirectory, receipt);
    deleteProviderSettlementIntentIfPresentV1(settlementDirectory);
    deleteProviderSettlementReceiptIfPresentV1(settlementDirectory);
    return receipt;
  }
  const state = projection.state;
  if (state.repository !== repository || state.providerName !== providerName) {
    fail('provider state projection belongs to another provider and is preserved');
  }
  const pendingSettlement = readProviderSettlementIntentV1(settlementDirectory);
  if (pendingSettlement !== null) {
    if (pendingSettlement.reason !== 'start-failure') {
      fail('provider settlement intent conflicts with an active state projection');
    }
    deleteProviderSettlementIntentIfPresentV1(settlementDirectory);
  }
  const desired = await loadProviderEnsureDesiredV1(context.repositoryRoot, repository, state);
  const current = readProviderEnsureReceiptV2(receiptDirectory);
  const previousIntent = readProviderEnsureIntentV1(receiptDirectory);
  const intent = previousIntent !== null && providerEnsureIntentMatchesInputV1(previousIntent, {
    repository,
    providerName,
    dockerEndpoint: state.dockerEndpoint,
    githubEndpoint: state.githubEndpoint
  }) ? previousIntent : createLocalGitHubActionsProviderEnsureIntentV1({
    repository,
    providerName,
    dockerEndpoint: state.dockerEndpoint,
    githubEndpoint: state.githubEndpoint,
    imageId: state.imageId,
    environmentInputDigest: SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST_V1,
    issuedAt: new Date().toISOString()
  });
  persistProviderEnsureIntentV1(receiptDirectory, intent);
  await runtimeAuthority.assertCurrent();
  const builder = await ensureLocalGitHubActionsBuildxBuilderAfterIntentV1(
    context.repositoryRoot, state.dockerEndpoint
  );
  await runtimeAuthority.assertCurrent();
  const ociBinding = await ensureImage(context.repositoryRoot, state.dockerEndpoint, {
    providerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
    providerLedgerObjectSha: state.providerLedgerObjectSha,
    providerLedgerDigest: state.providerLedgerDigest,
    providerGeneration: desired.generation,
    providerName: state.providerName,
    operationLabel: state.operationLabel
  });
  const observation = await observeLocalGitHubActionsProviderV3Unlocked({
    context,
    repository,
    authority: runtimeAuthority,
    repositoryStateRoot: runtimeLayout.repositoryStateRoot,
    receiptRoot,
    settlementRoot
  });
  if (observation.status === 'online' && current !== null
      && current.intentDigest === intent.intentDigest
       && current.builderObservationDigest === builder.observationDigest
       && JSON.stringify(current.ociBinding) === JSON.stringify(ociBinding)
      && current.receiptDigest === createLocalGitHubActionsProviderEnsureReceiptV2({
        repository,
        providerName,
        outcome: current.outcome,
        desired,
        intentDigest: current.intentDigest,
         endpointDigest: providerEnsureEndpointDigestV1(desired),
         builderObservationDigest: builder.observationDigest,
         ociBinding,
        reconciledContainers: current.reconciledContainers,
        transitionEpoch: current.transitionEpoch,
        consumers: current.consumers,
        observedAt: current.observedAt
      }).receiptDigest
      && current.desired.desiredDigest === desired.desiredDigest) {
    deleteProviderSettlementReceiptIfPresentV1(settlementDirectory);
    return current;
  }
  const reconciled = await reconcileProviderContainersV1(
    context.repositoryRoot, repository, providerName, state
  );
  await runtimeAuthority.assertCurrent();
  const refreshed = readStateProjection(context.commonDirectory)?.state;
  if (refreshed === undefined || refreshed.stateDigest !== state.stateDigest) {
    fail('provider ensure state projection changed during reconciliation');
  }
  const refreshedDesired = await loadProviderEnsureDesiredV1(context.repositoryRoot, repository, refreshed);
  const refreshedBuilder = await observeLocalGitHubActionsBuildxBuilderV1(
    context.repositoryRoot, refreshed.dockerEndpoint
  );
  if (refreshedBuilder === null) fail('provider ensure lost its Buildx builder during reconciliation');
  await runtimeAuthority.assertCurrent();
  const publishCurrent = readProviderEnsureReceiptV2(receiptDirectory);
  if ((current === null) !== (publishCurrent === null)
      || (current !== null && publishCurrent !== null
        && (current.receiptDigest !== publishCurrent.receiptDigest
          || current.transitionEpoch !== publishCurrent.transitionEpoch))) {
    fail('provider ensure current changed before receipt publication');
  }
  const receipt = createLocalGitHubActionsProviderEnsureReceiptV2({
    repository,
    providerName,
    outcome: reconciled.length === 0 ? 'already-healthy' : 'reconciled',
    desired: refreshedDesired,
    intentDigest: intent.intentDigest,
    endpointDigest: providerEnsureEndpointDigestV1(refreshedDesired),
    builderObservationDigest: refreshedBuilder.observationDigest,
    ociBinding,
    reconciledContainers: reconciled,
    transitionEpoch: publishCurrent?.transitionEpoch ?? 0,
    consumers: publishCurrent?.consumers ?? [],
    observedAt: new Date().toISOString()
  });
  persistProviderEnsureReceiptV2(receiptDirectory, receipt);
  deleteProviderSettlementReceiptIfPresentV1(settlementDirectory);
  return receipt;
  } finally {
    providerLease.release();
  }
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
  ociGenerationDigest: `sha256:${string}` | null;
  ociReceiptDigest: `sha256:${string}` | null;
  settlementReceiptDigest: `sha256:${string}`;
}>> {
  const context = await resolveRepositoryContext(input.cwd);
  const projection = readStateProjection(context.commonDirectory);
  if (projection === null) fail('no active state exists at ' + statePath(context.commonDirectory));
  const state = projection.state;
  if (state.repositoryRoot !== context.repositoryRoot || state.commonDirectory !== context.commonDirectory) {
    fail('state repository identity drifted');
  }
  await assertOriginRepositoryIdentityV2(context.repositoryRoot, state.repository);
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository: state.repository,
    repositoryRoot: context.repositoryRoot
  });
  const receiptRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2
  );
  const settlementRoot = path.join(
    receiptRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_LAYOUT_V1
  );
  const runtimeAuthority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: context.repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [receiptRoot, settlementRoot]
  });
  const settlementDirectory = providerSettlementDirectoryV1(
    runtimeAuthority,
    runtimeLayout.repositoryStateRoot
  );
  const receiptDirectory = providerEnsureReceiptDirectoryV1(
    runtimeAuthority,
    runtimeLayout.repositoryStateRoot
  );
  const providerLease = acquireProviderMutationLeaseV1(
    runtimeAuthority,
    runtimeLayout.repositoryStateRoot
  );
  try {
    // The lease starts before the first remote ledger/inventory observation and
    // stays held through effects, OCI settlement and durable readback.
    const lockedProjection = readStateProjection(context.commonDirectory);
    if (lockedProjection === null || lockedProjection.state.stateDigest !== state.stateDigest) {
      fail('provider state projection changed before stop acquired its mutation fence');
    }
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
  const currentEnsure = readProviderEnsureReceiptV2(receiptDirectory);
  if (currentEnsure !== null && currentEnsure.consumerCount !== 0) {
    fail('provider stop is blocked by active ensure consumers');
  }
  const settlementIntent = providerSettlementIntentFromStateV1(
    state,
    'stop',
    cursor.ledger.generation
  );
  persistProviderSettlementIntentV1(settlementDirectory, settlementIntent);
  await runtimeAuthority.assertCurrent();
  await convergeProviderLedgerToTerminalV3(cursor, context.repositoryRoot);
  deleteStateProjection(context.commonDirectory, state);
  await deleteProviderLedgerV3({
    cwd: context.repositoryRoot,
    objectSha: cursor.objectSha,
    ledger: cursor.ledger
  });
  const ociSettlement = await settleLocalGitHubActionsRunnerOciGenerationV1Unlocked({
    cwd: context.repositoryRoot,
    repository: state.repository,
    provider: {
      providerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
      providerLedgerObjectSha: cursor.objectSha,
      providerLedgerDigest: cursor.ledger.ledgerDigest,
      providerGeneration: cursor.ledger.generation,
      providerName: state.providerName,
      operationLabel: state.operationLabel
    },
    authority: runtimeAuthority,
    repositoryStateRoot: runtimeLayout.repositoryStateRoot
  });
  retireProviderEnsureCurrentV2(runtimeAuthority, runtimeLayout.repositoryStateRoot);
  const settlement = await publishProviderSettlementAfterExactCleanupV1({
    repositoryRoot: context.repositoryRoot,
    commonDirectory: context.commonDirectory,
    repository: state.repository,
    intent: settlementIntent,
    authority: runtimeAuthority,
    ociSettlement
  });
  return Object.freeze({
    schema: 'sec-local-github-actions-provider-stop-v3' as const,
    repository: state.repository,
    providerName: state.providerName,
    runnerCount: state.instances.length,
    runnersAbsent: true as const,
    containersAbsent: true as const,
    providerLedgerAbsent: true as const,
    imageRetained: true as const,
    ociGenerationDigest: ociSettlement?.generationDigest ?? null,
    ociReceiptDigest: ociSettlement?.receiptDigest ?? null,
    settlementReceiptDigest: settlement.receiptDigest
  });
  } finally {
    providerLease.release();
  }
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
  ociGenerationDigest: `sha256:${string}` | null;
  ociReceiptDigest: `sha256:${string}` | null;
  settlementReceiptDigest: `sha256:${string}`;
}>> {
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.name);
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentityV2(context.repositoryRoot, repository);
  const projection = readStateProjection(context.commonDirectory);
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository,
    repositoryRoot: context.repositoryRoot
  });
  const receiptRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2
  );
  const settlementRoot = path.join(
    receiptRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_LAYOUT_V1
  );
  const runtimeAuthority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: context.repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [receiptRoot, settlementRoot]
  });
  const settlementDirectory = providerSettlementDirectoryV1(
    runtimeAuthority,
    runtimeLayout.repositoryStateRoot
  );
  const receiptDirectory = providerEnsureReceiptDirectoryV1(
    runtimeAuthority,
    runtimeLayout.repositoryStateRoot
  );
  const providerLease = acquireProviderMutationLeaseV1(
    runtimeAuthority,
    runtimeLayout.repositoryStateRoot,
    true
  );
  try {
    // Hold the provider fence from the first remote observation through
    // physical cleanup, OCI settlement and receipt readback.
    const cursor = await loadCurrentProviderLedgerCursorV3(context.repositoryRoot, repository);
    const lockedProjection = readStateProjection(context.commonDirectory);
    if ((projection === null) !== (lockedProjection === null)
        || (projection !== null && lockedProjection !== null
          && projection.state.stateDigest !== lockedProjection.state.stateDigest)) {
      fail('provider state projection changed before recovery acquired its mutation fence');
    }
  const currentEnsure = readProviderEnsureReceiptV2(receiptDirectory);
  if (currentEnsure !== null && currentEnsure.consumerCount !== 0) {
    fail('provider recovery is blocked by active ensure consumers');
  }
  let settlementIntent = readProviderSettlementIntentV1(settlementDirectory);
  const currentSettlement = readProviderSettlementReceiptV1(settlementDirectory);
  let ociSettlement: LocalGitHubActionsRunnerOciSettlementV1 | null = null;
  if (cursor === null) {
    if (projection !== null) {
      fail('local state projection remains without remote destructive identity authority');
    }
    const githubEndpoint = await observeGitHubEndpointIdentityV3(context.repositoryRoot, repository);
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
    if (settlementIntent === null) {
      if (currentSettlement !== null) {
        if (currentSettlement.repository !== repository
            || currentSettlement.providerName !== providerName
            || JSON.stringify(currentSettlement.dockerEndpoint) !== JSON.stringify(dockerEndpoint)
            || JSON.stringify(currentSettlement.githubEndpoint) !== JSON.stringify(githubEndpoint)) {
          fail('provider settlement current belongs to another operation and is preserved');
        }
        // Reconstruct the exact original intent from the bounded receipt. The
        // subsequent physical absence readback may refresh observedAt, but the
        // stable receipt digest and intent identity remain unchanged.
        settlementIntent = createLocalGitHubActionsProviderSettlementIntentV1({
          repository: currentSettlement.repository,
          providerName: currentSettlement.providerName,
          operationLabel: currentSettlement.operationLabel,
          desiredDigest: currentSettlement.desiredDigest,
          providerLedgerObjectSha: currentSettlement.providerLedgerObjectSha,
          dockerEndpoint: currentSettlement.dockerEndpoint,
          githubEndpoint: currentSettlement.githubEndpoint,
          reason: currentSettlement.reason,
          issuedAt: currentSettlement.intentIssuedAt
        });
      } else {
        settlementIntent = providerSettlementIntentFromIdentityV1({
          repository,
          providerName,
          dockerEndpoint,
          githubEndpoint,
          reason: 'recover'
        });
        persistProviderSettlementIntentV1(settlementDirectory, settlementIntent);
      }
    } else if (settlementIntent.repository !== repository
        || settlementIntent.providerName !== providerName
        || JSON.stringify(settlementIntent.dockerEndpoint) !== JSON.stringify(dockerEndpoint)
        || JSON.stringify(settlementIntent.githubEndpoint) !== JSON.stringify(githubEndpoint)) {
      fail('provider settlement intent belongs to another operation and is preserved');
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
    if (settlementIntent === null) {
      settlementIntent = projection === null
        ? providerSettlementIntentFromIdentityV1({
          repository,
          providerName,
          dockerEndpoint: cursor.ledger.dockerEndpoint,
          githubEndpoint: cursor.ledger.githubEndpoint,
          operationLabel: cursor.ledger.operationLabel,
          providerLedgerObjectSha: cursor.objectSha,
          reason: 'recover'
        })
        : providerSettlementIntentFromStateV1(
          projection.state,
          'recover',
          cursor.ledger.generation
        );
      persistProviderSettlementIntentV1(settlementDirectory, settlementIntent);
    } else if (settlementIntent.repository !== repository
        || settlementIntent.providerName !== providerName
        || JSON.stringify(settlementIntent.dockerEndpoint) !== JSON.stringify(cursor.ledger.dockerEndpoint)
        || JSON.stringify(settlementIntent.githubEndpoint) !== JSON.stringify(cursor.ledger.githubEndpoint)
        || (settlementIntent.operationLabel !== null
          && settlementIntent.operationLabel !== cursor.ledger.operationLabel)
        || (settlementIntent.providerLedgerObjectSha !== null
          && settlementIntent.providerLedgerObjectSha !== cursor.objectSha)) {
      fail('provider settlement intent belongs to another operation and is preserved');
    }
    await convergeProviderLedgerToTerminalV3(cursor, context.repositoryRoot);
    if (projection !== null) deleteStateProjection(context.commonDirectory, projection.state);
    await deleteProviderLedgerV3({
      cwd: context.repositoryRoot,
      objectSha: cursor.objectSha,
      ledger: cursor.ledger
    });
    ociSettlement = await settleLocalGitHubActionsRunnerOciGenerationV1Unlocked({
      cwd: context.repositoryRoot,
      repository,
      provider: {
        providerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
        providerLedgerObjectSha: cursor.objectSha,
        providerLedgerDigest: cursor.ledger.ledgerDigest,
        providerGeneration: cursor.ledger.generation,
        providerName,
        operationLabel: cursor.ledger.operationLabel
      },
      authority: runtimeAuthority,
      repositoryStateRoot: runtimeLayout.repositoryStateRoot
    });
  }
  if (ociSettlement === null) {
    const ociResolved = await resolveRunnerOciCacheDirectoryV1(context.repositoryRoot);
    const ociGeneration = readRunnerOciGenerationV1(ociResolved.directory);
    if (ociGeneration !== null) {
      ociSettlement = await settleLocalGitHubActionsRunnerOciGenerationV1Unlocked({
        cwd: context.repositoryRoot,
        repository,
        provider: {
          providerRef: ociGeneration.providerRef,
          providerLedgerObjectSha: ociGeneration.providerObjectSha,
          providerLedgerDigest: ociGeneration.providerDigest,
          providerGeneration: ociGeneration.providerGeneration,
          providerName,
          operationLabel: settlementIntent?.operationLabel ?? `sec-operation-${'0'.repeat(64)}`
        },
        authority: runtimeAuthority,
        repositoryStateRoot: runtimeLayout.repositoryStateRoot
      });
    }
  }
  retireProviderEnsureCurrentV2(runtimeAuthority, runtimeLayout.repositoryStateRoot);
  if (settlementIntent === null) {
    fail('provider recovery has no settlement intent');
  }
  const settlement = await publishProviderSettlementAfterExactCleanupV1({
    repositoryRoot: context.repositoryRoot,
    commonDirectory: context.commonDirectory,
    repository,
    intent: settlementIntent,
    authority: runtimeAuthority,
    ociSettlement
  });
  return Object.freeze({
    schema: 'sec-local-github-actions-provider-recovery-v3' as const,
    repository,
    providerName,
    runnersAbsent: true as const,
    containersAbsent: true as const,
    providerLedgerAbsent: true as const,
    ociGenerationDigest: ociSettlement?.generationDigest ?? null,
    ociReceiptDigest: ociSettlement?.receiptDigest ?? null,
    settlementReceiptDigest: settlement.receiptDigest
  });
  } finally {
    providerLease.release();
  }
}

async function observeLocalGitHubActionsProviderV3Unlocked(input: Readonly<{
  context: Awaited<ReturnType<typeof resolveRepositoryContext>>;
  repository: string;
  authority: LocalGitHubActionsRuntimeAuthorityV1 | null;
  repositoryStateRoot: string | null;
  receiptRoot: string;
  settlementRoot: string;
}>) {
  const { context, repository, authority, repositoryStateRoot, receiptRoot, settlementRoot } = input;
  if (authority === null
      && inspectExactNoFollowDirectoryPresenceV1(
        receiptRoot,
        'Provider observation read root before census'
      ).state !== 'absent') {
    fail('provider receipt root appeared before zero-write observation census');
  }
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
      const settlement = authority === null || repositoryStateRoot === null
        ? Object.freeze({ status: 'absent' as const })
        : await observeLocalGitHubActionsProviderSettlementV1Unlocked({
          authority,
          repositoryStateRoot,
          settlementRoot
        });
      return Object.freeze({
        status: 'absent' as const,
        statePath: statePath(context.commonDirectory),
        repository,
        settlement
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
  if (image !== null) assertLocalGitHubActionsRunnerImageIdentityV1(image);
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

export async function observeLocalGitHubActionsProviderV3(input: Readonly<{ cwd: string }>) {
  const context = await resolveRepositoryContext(input.cwd);
  const repository = await assertOriginRepositoryIdentityV2(context.repositoryRoot);
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository,
    repositoryRoot: context.repositoryRoot
  });
  const receiptRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2
  );
  const settlementRoot = path.join(
    receiptRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_LAYOUT_V1
  );
  if (inspectExactNoFollowDirectoryPresenceV1(
    receiptRoot,
    'Provider observation read root'
  ).state === 'absent') {
    const result = await observeLocalGitHubActionsProviderV3Unlocked({
      context,
      repository,
      authority: null,
      repositoryStateRoot: null,
      receiptRoot,
      settlementRoot
    });
    if (inspectExactNoFollowDirectoryPresenceV1(
      receiptRoot,
      'Provider observation read root readback'
    ).state !== 'absent') {
      fail('provider receipt root appeared during zero-write observation; rerun under provider lease');
    }
    return result;
  }
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: context.repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [receiptRoot]
  });
  return await withProviderMutationLeaseV1({
    authority,
    repositoryStateRoot: runtimeLayout.repositoryStateRoot,
    operation: async () => await observeLocalGitHubActionsProviderV3Unlocked({
      context,
      repository,
      authority,
      repositoryStateRoot: runtimeLayout.repositoryStateRoot,
      receiptRoot,
      settlementRoot
    })
  });
}

export async function retireSupersededLocalGitHubActionsRunnerImageV3(input: Readonly<{
  cwd: string;
  imageId: string;
}>): Promise<Readonly<{
  schema: 'sec-local-github-actions-image-retirement-v3';
  imageId: string;
  replacementImageId: typeof LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3[number]['replacementImageId'];
  decision: string;
  zeroContainerReferences: true;
  imageAbsent: true;
}>> {
  const decision = LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3.find(
    (candidate) => candidate.imageId === input.imageId
  );
  if (decision === undefined) fail('image is not covered by a canonical superseded decision');
  const context = await resolveRepositoryContext(input.cwd);
  const repository = await assertOriginRepositoryIdentityV2(context.repositoryRoot);
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository,
    repositoryRoot: context.repositoryRoot
  });
  const receiptRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_ENSURE_LAYOUT_V2
  );
  const settlementRoot = path.join(
    receiptRoot,
    LOCAL_GITHUB_ACTIONS_PROVIDER_SETTLEMENT_LAYOUT_V1
  );
  const runtimeAuthority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: context.repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [receiptRoot, settlementRoot]
  });
  return await withProviderMutationLeaseV1({
    authority: runtimeAuthority,
    repositoryStateRoot: runtimeLayout.repositoryStateRoot,
    operation: async () => {
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
      assertLocalGitHubActionsRunnerReplacementImageIdentityV3(replacement, decision.replacementImageId);
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
    if (args.includes('--cpus') || args.includes('--memory')) {
      fail('caller resource overrides are retired; change the EnvironmentSpec resource revision');
    }
    const state = await ensureLocalGitHubActionsProviderV3({
      cwd,
      repository,
      name
    });
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }
  if (command === 'ensure') {
    const repository = option(args, '--repository');
    const name = option(args, '--name');
    if (repository === undefined || name === undefined) fail('ensure requires --repository and --name');
    if (args.includes('--cpus') || args.includes('--memory')) {
      fail('caller resource overrides are retired; change the EnvironmentSpec resource revision');
    }
    process.stdout.write(`${JSON.stringify(await ensureLocalGitHubActionsProviderV3({
      cwd,
      repository,
      name
    }), null, 2)}\n`);
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
  fail('usage: start|ensure --repository owner/name --name provider-name [--workspace path] | status [--workspace path] | stop [--workspace path] | recover --repository owner/name --name provider-name [--workspace path] | retire-superseded-image --image-id sha256:... [--workspace path]');
}

if (import.meta.main) await main();
