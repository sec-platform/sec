import { randomBytes } from 'node:crypto';
import { lstatSync, renameSync } from 'node:fs';
import path from 'node:path';

import { rawSha256Hex, sha256 } from '../../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest,
  type OwnerTerminalJoinReceipt
} from '../../../../../execution/operation/semantic.ts';
import {
  ResourceCompositeSettlementError,
  settleResourcesAsync as settlePhysicalResourcesAsync
} from '../../../../../execution/resource-settlement.ts';
import type {
  ContainerEngineOperation,
  ContainerEngineOperationOptions,
  ContainerEngineOperationScope,
  ContainerEngineSession
} from '../../../../providers/docker/contract/container-engine-session.ts';
import {
  parseDockerEndpointIdentity,
  type DockerEndpointIdentity
} from '../../../../providers/docker/contract/daemon.ts';
import {
  openContainerEngineSession
} from '../../../../providers/docker/runtime/container-engine-session.ts';
import {
  openWindowsDockerCommandProvider
} from '../../../../providers/docker/runtime/windows-command-provider.ts';
import {
  withAuthorityGitReadSession
} from '../../../../providers/git-read/authority.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiReadSession,
  withGitHubApiRunnerAdminSession
} from '../../../../providers/github-api/operation-session.ts';
import {
  LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  LINUX_VERIFICATION_RUNNER_INPUT_DIGEST
} from '../../../../providers/linux-verification/contract.ts';
import {
  compileEnvironmentMaterializationPlan,
  createEnvironmentMaterializationSpec
} from '../../../../providers/linux-verification/materialization.ts';
import { acquirePhysicalMutationLease, type PhysicalMutationLeaseHandle, type PhysicalMutationLeaseOwner } from '../../../../runtime-state/physical/runtime/mutation-lease.ts';
import { createNoFollowDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowDirectoryChild, inspectNoFollowOrdinaryFileDigest, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, replaceDurableCanonicalFile, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryIdentity } from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveWorkspaceRuntimeRoots } from '../../../../runtime-state/workspace-state/paths.ts';
import { acquireRuntimeCachePhysicalAuthority } from '../../../../runtime-state/workspace-state/physical-authority.ts';
import {
  GIT_READ_OPERATION_BUDGET,
  gitReadText
} from '../../../../self-hosting/development/tooling/git/git-read.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY } from '../contract/revision.ts';

export const LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA =
  'sec-local-github-actions-provider-state-v4' as const;
// The frozen image is an execution artifact, not a provider-state projection.
// Keep its immutable lineage label independent from later state/ledger schema
// revisions so a control-plane migration cannot invalidate byte-identical
// cached Linux capacity or silently demand a mutable rebuild.
const ENVIRONMENT = LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA = ENVIRONMENT.image.lineageSchema;
const LOCAL_GITHUB_ACTIONS_RUNNER_VERSION = ENVIRONMENT.archives.runner.version;
const LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256 =
  ENVIRONMENT.archives.runner.digest.slice(7);
const LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE =
  ENVIRONMENT.ubuntu.baseReference;
const LOCAL_GITHUB_ACTIONS_NODE_VERSION = ENVIRONMENT.archives.node.version;
const LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256 =
  ENVIRONMENT.archives.node.digest.slice(7);
const LOCAL_GITHUB_ACTIONS_PYTHON_VERSION = ENVIRONMENT.runtime.pythonVersion;
const LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION = ENVIRONMENT.archives.githubCli.version;
const LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256 =
  ENVIRONMENT.archives.githubCli.digest.slice(7);
const LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT = ENVIRONMENT.ubuntu.snapshot;
const LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH = String(ENVIRONMENT.provider.sourceDateEpoch);
const LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND =
  ENVIRONMENT.provider.dockerfileFrontend.reference;
const LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE = ENVIRONMENT.archives.bootstrapCa.version;
const LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256 =
  ENVIRONMENT.archives.bootstrapCa.digest.slice(7);
const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION =
  ENVIRONMENT.image.buildRevision;
const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE =
  `${ENVIRONMENT.image.name}:${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION}-${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION}`;
// Frozen after the canonical Dockerfile is built once. Rebuilding mutable apt
// inputs under the same semantic provider revision must fail this identity.
const LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID =
  ENVIRONMENT.image.dockerProjectionDigest;
const LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST =
  ENVIRONMENT.image.runtimeContentDigest;
const LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_ARCHIVE_IMAGE_ID =
  (() => {
    const retirement = ENVIRONMENT.image.retirements.find(({ imageTag }) =>
      imageTag.endsWith('-archive-v7'));
    if (retirement === undefined) {
      throw new Error('SEC Linux verification environment authority lacks the v7 retirement identity.');
    }
    return retirement.imageId;
  })();
const LOCAL_GITHUB_ACTIONS_RUNNER_CONTAINER_INIT_CAPABILITY =
  ENVIRONMENT.runtime.containerInitCapability;
export const LOCAL_GITHUB_ACTIONS_RUNNER_CONFIGURED_MARKER =
  '/actions-runner/.sec-runner-configured-v1' as const;
export const LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_SCRIPT = Object.freeze([
  'set -euo pipefail',
  'cd /actions-runner',
  `marker=${JSON.stringify(LOCAL_GITHUB_ACTIONS_RUNNER_CONFIGURED_MARKER)}`,
  'while [ ! -f "$marker" ]; do sleep 1; done',
  'exec ./run.sh'
].join('\n'));
const LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RECEIPT_SCHEMA =
  ENVIRONMENT.provenance.receiptSchema;
const LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS =
  ENVIRONMENT.image.retirements;
const LOCAL_GITHUB_ACTIONS_RUNNER_LABELS = ENVIRONMENT.runtime.labels;
const LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL =
  LOCAL_GITHUB_ACTIONS_RUNNER_LABELS[3];
const LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS = ENVIRONMENT.runtime.roleLabels;
export type LocalGitHubActionsRunnerRole = keyof typeof LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS;
const LOCAL_GITHUB_ACTIONS_RUNNER_ROLES = Object.freeze([
  'control', 'trusted', 'sut'
] as const satisfies readonly LocalGitHubActionsRunnerRole[]);
const LOCAL_GITHUB_ACTIONS_GITHUB_HOST = ENVIRONMENT.provider.githubHost;

const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const LOCAL_CONTAINER_ENGINE_OPERATION_BUDGET = Object.freeze({
  durationMs: ENVIRONMENT.provider.timeoutsMs.commandMaximum,
  inputBytes: 128 * 1024 * 1024,
  outputBytes: 512 * 1024 * 1024,
  processes: 512
});

type LocalContainerEngineIntent =
  | 'start-provider'
  | 'stop-provider'
  | 'recover-provider'
  | 'observe-provider'
  | 'retire-image';

type LocalContainerEngineOperationInput = Readonly<{
  cwd: string;
  intent: LocalContainerEngineIntent;
  availability: 'observe' | 'ensure-started';
  subject: Readonly<Record<string, unknown>>;
  expectedEndpoint?: DockerEndpointIdentity;
}>;

function bindLocalContainerEngineOperation(input: LocalContainerEngineOperationInput & Readonly<{
  providerIdentityDigest: OperationDigest;
  deadlineAtUnixMs?: number;
}>): BoundSemanticOperation {
  const cwd = path.resolve(input.cwd);
  const contractDigest = sha256(Object.freeze({
    schema: 'sec-local-github-actions-container-engine-contract-v1',
    environment: ENVIRONMENT.provider.requirement,
    expectedImageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID
  })) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: `verification.local-github-actions-${input.intent}`,
    intentDigest: sha256(Object.freeze({
      cwd,
      intent: input.intent,
      subject: input.subject
    })) as OperationDigest,
    decisionDigest: sha256(Object.freeze({
      contractDigest,
      budget: LOCAL_CONTAINER_ENGINE_OPERATION_BUDGET
    })) as OperationDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs
      ?? Date.now() + LOCAL_CONTAINER_ENGINE_OPERATION_BUDGET.durationMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: LOCAL_CONTAINER_ENGINE_OPERATION_BUDGET.durationMs },
      { resource: 'input-bytes', maximum: LOCAL_CONTAINER_ENGINE_OPERATION_BUDGET.inputBytes },
      { resource: 'output-bytes', maximum: LOCAL_CONTAINER_ENGINE_OPERATION_BUDGET.outputBytes },
      { resource: 'processes', maximum: LOCAL_CONTAINER_ENGINE_OPERATION_BUDGET.processes }
    ],
    requirements: [{
      id: 'external.container-engine-process',
      contractDigest,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'container-engine.admission-failed',
        'container-engine.desktop-launcher-path-unavailable',
        'container-engine.endpoint-unavailable',
        'container-engine.process-settlement-failed',
        'container-engine.runtime-endpoint-residue'
      ]
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    })
  });
  const operation = bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'external.container-engine-process',
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
  return operation;
}

interface LocalContainerEngineOperationSession {
  readonly session: ContainerEngineSession;
  readonly operation: BoundSemanticOperation;
  readonly scope: ContainerEngineOperationScope;
  settle(): Promise<OwnerTerminalJoinReceipt>;
  close(): Promise<void>;
}

async function openLocalContainerEngineSession(
  input: LocalContainerEngineOperationInput
): Promise<LocalContainerEngineOperationSession> {
  const cwd = path.resolve(input.cwd);
  const commandProvider = await openWindowsDockerCommandProvider({ workingDirectory: cwd });
  const resourceEnvelope = bindLocalContainerEngineOperation({
    ...input,
    cwd,
    providerIdentityDigest: commandProvider.providerIdentityDigest
  });
  const session = await openContainerEngineSession({
    operation: resourceEnvelope,
    provider: commandProvider,
    cwd,
    availability: input.availability,
    ...(input.expectedEndpoint === undefined ? {} : {
      expectedEndpoint: dockerEndpointIdentity(input.expectedEndpoint)
    })
  });
  const operation = bindLocalContainerEngineOperation({
    ...input,
    cwd,
    providerIdentityDigest: session.providerIdentityDigest,
    deadlineAtUnixMs: session.deadlineAtUnixMs
  });
  const scope = session.openOperationScope({
    operation,
    requirementId: 'external.container-engine-process'
  });
  let joinReceipt: OwnerTerminalJoinReceipt | null = null;
  let closeFailure: Readonly<{ error: unknown }> | undefined;
  return Object.freeze({
    session,
    operation,
    scope,
    async settle(): Promise<OwnerTerminalJoinReceipt> {
      if (joinReceipt !== null) return joinReceipt;
      const providerSettlement = scope.settle();
      const endpointReadback = await session.observeEndpoint();
      const providerSettlementSet = compileProviderSettlementSet(
        operation,
        [providerSettlement]
      );
      const readback = issueNormalDomainReadbackReceipt(operation, providerSettlementSet, {
        readbackContractDigest: sha256(Object.freeze({
          schema: 'sec-local-github-actions-container-engine-readback-contract-v1',
          intent: input.intent,
          endpointHost: endpointReadback.endpointHost
        })) as OperationDigest,
        readbackReferenceDigest: sha256(Object.freeze({
          schema: 'sec-local-github-actions-container-engine-readback-v1',
          endpoint: endpointReadback
        })) as OperationDigest,
        currentPhysicalEpochDigest: sha256(Object.freeze({
          schema: 'sec-local-github-actions-container-engine-physical-epoch-v1',
          endpointHost: endpointReadback.endpointHost,
          daemonId: endpointReadback.daemonId
        })) as OperationDigest,
        disposition: providerSettlement.physicalDisposition === 'settled'
          ? 'applied'
          : providerSettlement.physicalDisposition === 'not-started'
            ? 'not-applied'
            : 'unknown'
      });
      joinReceipt = issueNormalOwnerTerminalJoinReceipt(
        operation,
        providerSettlementSet,
        readback,
        {
          ownerTerminalContractDigest: sha256(Object.freeze({
            schema: 'sec-local-github-actions-container-engine-owner-terminal-contract-v1',
            intent: input.intent
          })) as OperationDigest,
          ownerTerminalReferenceDigest: sha256(Object.freeze({
            schema: 'sec-local-github-actions-container-engine-owner-terminal-reference-v1',
            intent: input.intent,
            subject: input.subject,
            endpoint: endpointReadback,
            physicalDisposition: providerSettlement.physicalDisposition
          })) as OperationDigest
        }
      );
      return joinReceipt;
    },
    async close(): Promise<void> {
      if (closeFailure !== undefined) throw closeFailure.error;
      const failures: Array<Readonly<{ label: string; error: unknown }>> = [];
      try {
        await this.settle();
      } catch (error) {
        failures.push(Object.freeze({ label: 'container-engine-settlement', error }));
      }
      try {
        session.close();
      } catch (error) {
        failures.push(Object.freeze({ label: 'container-engine-session-close', error }));
      }
      if (failures.length === 0) return;
      const error = failures.length === 1
        ? failures[0]!.error
        : new ResourceCompositeSettlementError(failures);
      closeFailure = Object.freeze({ error });
      throw error;
    }
  });
}
const DEFAULT_CPUS = ENVIRONMENT.runtime.resources.control.cpus;
const DEFAULT_MEMORY = `${ENVIRONMENT.runtime.resources.control.memoryGiB}g`;
const SUT_CPUS = ENVIRONMENT.runtime.resources.sut.cpus;
const SUT_MEMORY = `${ENVIRONMENT.runtime.resources.sut.memoryGiB}g`;
const SUT_PIDS = ENVIRONMENT.runtime.resources.sut.pids;
const SUT_CAPABILITIES = CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outerSutContainerCapabilities;
const RUNNER_OCI_MATERIALIZATION_LEASE_NAME = 'materialization-lease.json';
const RUNNER_OCI_CANDIDATE_PREFIX = 'candidate-';
const RUNNER_OCI_CLEANUP_MAXIMUM_ENTRIES = 1_000_000;
const RUNNER_OCI_CLEANUP_BUDGET_MS = 5 * 60_000;

export interface LocalGitHubActionsRunnerInstance {
  readonly role: LocalGitHubActionsRunnerRole;
  readonly roleLabel: string;
  readonly name: string;
  readonly runnerId: number;
  readonly containerId: string;
  readonly containerName: string;
}

export interface GitHubEndpointIdentity {
  readonly schema: 'sec-github-api-endpoint-identity-v1';
  readonly host: typeof LOCAL_GITHUB_ACTIONS_GITHUB_HOST;
  readonly repository: string;
  readonly principal: string;
}

type LocalGitHubActionsProviderLifecycle =
  | 'provisioning'
  | 'active'
  | 'teardown'
  | 'terminal';

type LocalGitHubActionsProviderResourceState = 'uncreated' | 'present' | 'absent';

interface LocalGitHubActionsProviderStateInstance {
  readonly role: LocalGitHubActionsRunnerRole;
  readonly roleLabel: string;
  readonly name: string;
  readonly containerId: string | null;
  readonly containerState: LocalGitHubActionsProviderResourceState;
  readonly runnerId: number | null;
  readonly runnerState: LocalGitHubActionsProviderResourceState;
}

export interface LocalGitHubActionsRunnerState {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA;
  readonly repository: string;
  readonly repositoryRoot: string;
  readonly commonDirectory: string;
  readonly providerName: string;
  readonly operationLabel: string;
  readonly lifecycle: LocalGitHubActionsProviderLifecycle;
  readonly dockerEndpoint: DockerEndpointIdentity;
  readonly githubEndpoint: GitHubEndpointIdentity;
  readonly image: typeof LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE;
  readonly imageId: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID;
  readonly runnerVersion: typeof LOCAL_GITHUB_ACTIONS_RUNNER_VERSION;
  readonly runnerArchiveSha256: typeof LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256;
  readonly baseImage: typeof LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE;
  readonly nodeVersion: typeof LOCAL_GITHUB_ACTIONS_NODE_VERSION;
  readonly nodeArchiveSha256: typeof LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256;
  readonly labels: typeof LOCAL_GITHUB_ACTIONS_RUNNER_LABELS;
  readonly roleLabels: typeof LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS;
  readonly instances: readonly LocalGitHubActionsProviderStateInstance[];
  readonly startedAt: string;
  readonly stateDigest: `sha256:${string}`;
}

interface CommandResult {
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export interface BuildxRawJsonProgressAdmission {
  readonly push: (chunk: Buffer) => boolean;
  readonly finish: () => boolean;
}

export function createBuildxRawJsonProgressAdmission(): BuildxRawJsonProgressAdmission {
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

function stateMaterial(input: Omit<LocalGitHubActionsRunnerState, 'stateDigest'>) {
  return Object.freeze({ ...input });
}

function runnerRole(value: unknown): LocalGitHubActionsRunnerRole {
  if (value !== 'control' && value !== 'trusted' && value !== 'sut') fail('runner role is invalid');
  return value;
}

function runnerInstance(input: LocalGitHubActionsRunnerInstance): LocalGitHubActionsRunnerInstance {
  const role = runnerRole(input.role);
  if (input.roleLabel !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS[role]) {
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
  if (!/^unix:\/\/\/[^\u0000-\u0020]+$/u.test(result)
      && !/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/u.test(result)) {
    fail('Docker endpoint host must be a local npipe or unix transport');
  }
  return result;
}

function dockerDaemonId(value: unknown): string {
  const result = boundedText(value, 'Docker daemon ID', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(result)) fail('Docker daemon ID is invalid');
  return result;
}

function dockerEndpointIdentity(input: DockerEndpointIdentity): DockerEndpointIdentity {
  const parsed = parseDockerEndpointIdentity(input);
  return Object.freeze({
    ...parsed,
    contextName: dockerContextName(parsed.contextName),
    endpointHost: dockerEndpointHost(parsed.endpointHost),
    daemonId: dockerDaemonId(parsed.daemonId)
  });
}

function githubEndpointIdentity(input: GitHubEndpointIdentity): GitHubEndpointIdentity {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('GitHub endpoint identity is invalid');
  }
  exactKeys(input as unknown as Record<string, unknown>, [
    'schema', 'host', 'repository', 'principal'
  ], 'GitHub endpoint identity');
  if (input.schema !== 'sec-github-api-endpoint-identity-v1'
      || input.host !== LOCAL_GITHUB_ACTIONS_GITHUB_HOST) {
    fail('GitHub endpoint capability identity is invalid');
  }
  return Object.freeze({
    schema: 'sec-github-api-endpoint-identity-v1' as const,
    host: LOCAL_GITHUB_ACTIONS_GITHUB_HOST,
    repository: repositoryName(input.repository),
    principal: githubPrincipal(input.principal)
  });
}

function stateInstance(
  input: LocalGitHubActionsProviderStateInstance,
  retainedProviderName: string
): LocalGitHubActionsProviderStateInstance {
  const role = runnerRole(input.role);
  if (input.roleLabel !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS[role]
      || input.name !== instanceName(retainedProviderName, role)) {
    fail('runner state role identity is invalid');
  }
  const containerId = input.containerId === null ? null : boundedText(input.containerId, 'containerId', 64);
  const runnerId = input.runnerId;
  if (containerId !== null && !/^[0-9a-f]{64}$/u.test(containerId)) fail('containerId is invalid');
  if (runnerId !== null && (!Number.isSafeInteger(runnerId) || runnerId < 1)) fail('runnerId is invalid');
  if ((input.containerState === 'uncreated' && containerId !== null)
      || (input.containerState === 'present' && containerId === null)
      || (input.runnerState === 'uncreated' && runnerId !== null)
      || (input.runnerState === 'present' && runnerId === null)
      || (input.runnerState === 'present' && input.containerState !== 'present')) {
    fail('runner state resource identity is inconsistent');
  }
  return Object.freeze({
    role,
    roleLabel: input.roleLabel,
    name: runnerName(input.name),
    containerId,
    containerState: providerResourceState(input.containerState),
    runnerId,
    runnerState: providerResourceState(input.runnerState)
  });
}

export function createLocalGitHubActionsRunnerState(
  input: Omit<LocalGitHubActionsRunnerState, 'schema' | 'image' | 'imageId' | 'runnerVersion'
    | 'runnerArchiveSha256' | 'baseImage' | 'nodeVersion' | 'nodeArchiveSha256'
    | 'labels' | 'roleLabels' | 'stateDigest'>
): LocalGitHubActionsRunnerState {
  const startedAt = new Date(input.startedAt).toISOString();
  if (startedAt !== input.startedAt) fail('startedAt must be a canonical ISO instant');
  const lifecycle = providerLifecycle(input.lifecycle);
  const retainedProviderName = providerBaseName(input.providerName);
  const instances = input.instances.map((instance) => stateInstance(instance, retainedProviderName));
  if (instances.length !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLES.length
      || LOCAL_GITHUB_ACTIONS_RUNNER_ROLES.some((role, index) => instances[index]?.role !== role)
      || new Set(instances.map(({ name }) => name)).size !== instances.length
      || new Set(instances.flatMap(({ runnerId }) => runnerId === null ? [] : [runnerId])).size
        !== instances.filter(({ runnerId }) => runnerId !== null).length
      || new Set(instances.flatMap(({ containerId }) => containerId === null ? [] : [containerId])).size
        !== instances.filter(({ containerId }) => containerId !== null).length) {
    fail('runner state must retain one ordered unique instance per trust role');
  }
  if (lifecycle === 'active' && instances.some(({ containerState, runnerState }) =>
    containerState !== 'present' || runnerState !== 'present')) fail('active runner state is incomplete');
  if (lifecycle === 'terminal' && instances.some(({ containerState, runnerState }) =>
    containerState !== 'absent' || runnerState !== 'absent')) fail('terminal runner state retains resources');
  const material = stateMaterial({
    schema: LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA,
    repository: repositoryName(input.repository),
    repositoryRoot: path.resolve(boundedText(input.repositoryRoot, 'repositoryRoot', 4096)),
    commonDirectory: path.resolve(boundedText(input.commonDirectory, 'commonDirectory', 4096)),
    providerName: retainedProviderName,
    operationLabel: operationLabel(input.operationLabel),
    lifecycle,
    dockerEndpoint: dockerEndpointIdentity(input.dockerEndpoint),
    githubEndpoint: githubEndpointIdentity(input.githubEndpoint),
    image: LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE,
    imageId: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID,
    runnerVersion: LOCAL_GITHUB_ACTIONS_RUNNER_VERSION,
    runnerArchiveSha256: LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256,
    baseImage: LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE,
    nodeVersion: LOCAL_GITHUB_ACTIONS_NODE_VERSION,
    nodeArchiveSha256: LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256,
    labels: LOCAL_GITHUB_ACTIONS_RUNNER_LABELS,
    roleLabels: LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS,
    instances: Object.freeze(instances),
    startedAt
  });
  return Object.freeze({
    ...material,
    stateDigest: sha256(material) as `sha256:${string}`
  });
}

export function parseLocalGitHubActionsRunnerState(source: string): LocalGitHubActionsRunnerState {
  const parsed = JSON.parse(source) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('state must be an object');
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'repository', 'repositoryRoot', 'commonDirectory', 'providerName', 'operationLabel',
    'lifecycle',
    'dockerEndpoint', 'githubEndpoint', 'image', 'imageId', 'runnerVersion',
    'runnerArchiveSha256', 'baseImage', 'nodeVersion', 'nodeArchiveSha256',
    'labels', 'roleLabels', 'instances', 'startedAt', 'stateDigest'
  ], 'state');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA
      || value.image !== LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE
      || value.imageId !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID
      || value.runnerVersion !== LOCAL_GITHUB_ACTIONS_RUNNER_VERSION
      || value.runnerArchiveSha256 !== LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256
      || value.baseImage !== LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE
      || value.nodeVersion !== LOCAL_GITHUB_ACTIONS_NODE_VERSION
      || value.nodeArchiveSha256 !== LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256
      || !Array.isArray(value.labels)
      || value.labels.length !== LOCAL_GITHUB_ACTIONS_RUNNER_LABELS.length
      || value.labels.some((label, index) => label !== LOCAL_GITHUB_ACTIONS_RUNNER_LABELS[index])
      || JSON.stringify(value.roleLabels) !== JSON.stringify(LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS)
      || !Array.isArray(value.instances)) {
    fail('state capability identity is invalid');
  }
  const recreated = createLocalGitHubActionsRunnerState({
    repository: value.repository as string,
    repositoryRoot: value.repositoryRoot as string,
    commonDirectory: value.commonDirectory as string,
    providerName: value.providerName as string,
    operationLabel: value.operationLabel as string,
    lifecycle: value.lifecycle as LocalGitHubActionsProviderLifecycle,
    dockerEndpoint: value.dockerEndpoint as DockerEndpointIdentity,
    githubEndpoint: value.githubEndpoint as GitHubEndpointIdentity,
    instances: value.instances as LocalGitHubActionsProviderStateInstance[],
    startedAt: value.startedAt as string
  });
  if (recreated.stateDigest !== value.stateDigest) fail('state digest mismatch');
  return recreated;
}

export function createLocalGitHubActionsRunnerDockerfile(): string {
  return `# syntax=${LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND}\n`
    + `ARG SOURCE_DATE_EPOCH=${LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH}\n`
    + 'FROM scratch AS ca-bootstrap\n'
    + `ADD --chmod=${ENVIRONMENT.archives.bootstrapCa.mountMode} `
    + `--checksum=${ENVIRONMENT.archives.bootstrapCa.digest} `
    + `${ENVIRONMENT.archives.bootstrapCa.url} `
    + '/ca/\n'
    + `FROM ${LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE} AS runtime\n`
    + 'ARG DEBIAN_FRONTEND=noninteractive\n'
    + `ARG UBUNTU_SNAPSHOT=${LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT}\n`
    + `RUN --mount=from=ca-bootstrap,source=/ca/cacert-${LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE}.pem,`
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
    + `&& test "$(python3 --version)" = "Python ${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION}" `
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
    + `&& test "$(node --version)" = "v${LOCAL_GITHUB_ACTIONS_NODE_VERSION}"\n`
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
    + `&& install -m 0755 /tmp/gh_${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION}_linux_amd64/bin/gh `
    + '/usr/local/bin/gh '
    + `&& gh --version | head -n 1 | grep -E '^gh version ${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION.replaceAll('.', '\\.')}`
    + " ' "
    + `&& rm -rf /tmp/gh_${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION}_linux_amd64\n`
    + `LABEL sec.local-runner.image-schema=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA} `
    + `sec.local-runner.image-revision=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION} `
    + `sec.local-runner.runner-version=${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION} `
    + `sec.local-runner.node-version=${LOCAL_GITHUB_ACTIONS_NODE_VERSION} `
    + `sec.local-runner.node-archive-sha256=${LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256} `
    + `sec.local-runner.github-cli-version=${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION} `
    + `sec.local-runner.github-cli-archive-sha256=${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256} `
    + `sec.local-runner.python-version=${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION} `
    + `sec.local-runner.ubuntu-snapshot=${LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT} `
    + `sec.local-runner.bootstrap-ca-bundle-sha256=${LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256} `
    + `sec.local-runner.dockerfile-frontend=${LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND}\n`
    + 'ENV RUNNER_ALLOW_RUNASROOT=1\n'
    + 'ENTRYPOINT ["/bin/bash","-lc"]\n';
}

export function createLocalGitHubActionsRunnerEnvironmentSpec() {
  const buildInputClosureDigest = sha256(
    createLocalGitHubActionsRunnerBuildInputProjection()
  ) as `sha256:${string}`;
  return createEnvironmentMaterializationSpec({
    imageName: LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE,
    acceptedImageDigest: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID,
    sourcePolicyRevision: ENVIRONMENT.provider.sourcePolicyRevision,
    providerRequirement: ENVIRONMENT.provider.requirement,
    components: [
      {
        id: 'authority-input-closure',
        version: ENVIRONMENT.environmentId,
        sourceDigest: LINUX_VERIFICATION_RUNNER_INPUT_DIGEST
      },
      {
        id: 'base-image',
        version: `ubuntu-${ENVIRONMENT.ubuntu.version}`,
        sourceDigest: ENVIRONMENT.ubuntu.baseDigest
      },
      {
        id: 'bootstrap-ca-bundle',
        version: LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE,
        sourceDigest: ENVIRONMENT.archives.bootstrapCa.digest
      },
      {
        id: 'dockerfile-frontend',
        version: ENVIRONMENT.provider.dockerfileFrontend.version,
        sourceDigest: ENVIRONMENT.provider.dockerfileFrontend.digest
      },
      {
        id: 'github-cli',
        version: LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION,
        sourceDigest: ENVIRONMENT.archives.githubCli.digest
      },
      {
        id: 'node',
        version: LOCAL_GITHUB_ACTIONS_NODE_VERSION,
        sourceDigest: ENVIRONMENT.archives.node.digest
      },
      {
        id: 'runner',
        version: LOCAL_GITHUB_ACTIONS_RUNNER_VERSION,
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

function createLocalGitHubActionsRunnerOciBakeRequest(candidatePath: string): Readonly<Record<string, unknown>> {
  // Bake interpolates `${...}` in string values before forwarding the inline Dockerfile.
  // Escape only that grammar. Shell command substitutions such as `$(stat ...)` must
  // retain one dollar sign or the resulting Dockerfile changes execution semantics.
  const dockerfileInline = createLocalGitHubActionsRunnerDockerfile().replaceAll('${', () => '$${');
  return Object.freeze({
    group: { default: { targets: ['runner-oci'] } },
    target: {
      'runner-oci': {
        context: '.',
        'dockerfile-inline': dockerfileInline,
        args: { SOURCE_DATE_EPOCH: LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH },
        platforms: [ENVIRONMENT.platform],
        output: [
          `type=oci,dest=${candidatePath},tar=false,rewrite-timestamp=true,name=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE}`
        ],
        attest: [`type=provenance,mode=${ENVIRONMENT.provenance.materializationMode}`]
      }
    }
  });
}

function createLocalGitHubActionsRunnerProjectionBuildxArgsForUri(
  retainedLayoutUriPath: string
): readonly string[] {
  return Object.freeze([
    'buildx', 'build',
    '--build-context',
    `runtime=oci-layout://${retainedLayoutUriPath}@${LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST}`,
    '--file', '-',
    '--platform', ENVIRONMENT.platform,
    '--tag', LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE,
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
export function createLocalGitHubActionsRunnerBuildInputProjection() {
  return Object.freeze({
    schema: 'sec-local-runner-build-input-projection-v1' as const,
    authorityInputDigest: LINUX_VERIFICATION_RUNNER_INPUT_DIGEST,
    dockerfileSource: createLocalGitHubActionsRunnerDockerfile(),
    bakeRequest: createLocalGitHubActionsRunnerOciBakeRequest('<candidate-layout>'),
    projectionArgs: createLocalGitHubActionsRunnerProjectionBuildxArgsForUri('<layout>'),
    projectionStdin: 'FROM runtime\n',
    runtimeManifestDigest: LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST,
    dockerProjectionDigest: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID
  });
}

export function createLocalGitHubActionsRunnerOciBakeDefinition(candidatePath: string): string {
  const retainedCandidatePath = path.resolve(boundedText(candidatePath, 'OCI candidate path', 32_768));
  return `${JSON.stringify(createLocalGitHubActionsRunnerOciBakeRequest(retainedCandidatePath))}\n`;
}

export function createLocalGitHubActionsRunnerProjectionBuildxArgs(
  layoutPath: string
): readonly string[] {
  const retainedLayoutPath = path.resolve(boundedText(layoutPath, 'OCI layout path', 32_768));
  const retainedLayoutUriPath = retainedLayoutPath.split(path.sep).join('/');
  return createLocalGitHubActionsRunnerProjectionBuildxArgsForUri(retainedLayoutUriPath);
}

async function runContainerEngineOperation(
  session: ContainerEngineSession,
  operation: ContainerEngineOperation,
  options: Readonly<{
    input?: Buffer;
    acceptedCodes?: readonly number[];
    acceptAnyExitCode?: boolean;
    stallTimeoutMs?: number;
    admitProgress?: (chunk: Buffer, stream: 'stdout' | 'stderr') => boolean;
  }>
): Promise<CommandResult> {
  const operationOptions: ContainerEngineOperationOptions = Object.freeze({
    ...(options.input === undefined ? {} : {
      input: options.input,
      maxStdinBytes: options.input.byteLength
    }),
    ...(options.acceptedCodes === undefined ? {} : { acceptedCodes: options.acceptedCodes }),
    ...(options.acceptAnyExitCode === undefined ? {} : {
      acceptAnyExitCode: options.acceptAnyExitCode
    }),
    ...(options.stallTimeoutMs === undefined ? {} : {
      stallTimeoutMs: options.stallTimeoutMs,
      admitProgress: options.admitProgress
    }),
    ...((operation.kind === 'buildx-bake' || operation.kind === 'buildx-build') ? {
      maxStdoutBytes: MAX_COMMAND_OUTPUT_BYTES,
      maxStderrBytes: MAX_COMMAND_OUTPUT_BYTES
    } : {})
  });
  return await session.execute(operation, operationOptions);
}

async function observeGitHubEndpointIdentity(
  cwd: string,
  repository: string
): Promise<GitHubEndpointIdentity> {
  const expectedRepository = repositoryName(repository);
  return await withGitHubApiReadSession({
    repositoryRoot: cwd,
    repository: expectedRepository,
    operation: async (api) => {
      const repositoryValue = await executeGitHubApiOperation(api, { kind: 'repository' });
      if (repositoryValue === null || typeof repositoryValue !== 'object'
          || Array.isArray(repositoryValue)) {
        fail('GitHub API repository response is invalid');
      }
      const observedRepository = (repositoryValue as Record<string, unknown>).full_name;
      if (typeof observedRepository !== 'string') fail('GitHub API repository identity is invalid');
      if (observedRepository.toLowerCase() !== expectedRepository.toLowerCase()) {
        fail('GitHub API repository identity differs from origin');
      }
      const principal = inspectGitHubApiCapability(api).principal.login;
      return githubEndpointIdentity({
        schema: 'sec-github-api-endpoint-identity-v1',
        host: LOCAL_GITHUB_ACTIONS_GITHUB_HOST,
        repository: expectedRepository,
        principal
      });
    }
  });
}

async function assertGitHubEndpointIdentity(
  expected: GitHubEndpointIdentity,
  cwd: string
): Promise<GitHubEndpointIdentity> {
  const retained = githubEndpointIdentity(expected);
  const observed = await observeGitHubEndpointIdentity(cwd, retained.repository);
  if (observed.principal.toLowerCase() !== retained.principal.toLowerCase()) {
    fail('GitHub API principal changed and external mutation is preserved');
  }
  return observed;
}

async function resolveRepositoryContext(cwd: string) {
  return await withAuthorityGitReadSession({ cwd, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    const root = (await gitReadText(session, ['rev-parse', '--show-toplevel'], {
      maxBuffer: 1024 * 1024,
      label: 'runner repository root'
    })).trim();
    const common = (await gitReadText(session, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ], { maxBuffer: 1024 * 1024, label: 'runner Git common directory' })).trim();
    return Object.freeze({ repositoryRoot: path.resolve(root), commonDirectory: path.resolve(common) });
  });
}

export function assertRepositoryIdentityMatchesOrigin(
  repository: string,
  originUrl: string
): string {
  const expected = repositoryName(repository);
  const observed = repositoryIdentityFromGitHubUrl(originUrl);
  if (observed.toLowerCase() !== expected.toLowerCase()) {
    fail('origin repository identity differs from --repository; external maintainer mutation is preserved');
  }
  return observed;
}

function repositoryIdentityFromGitHubUrl(originUrl: string): string {
  const normalized = originUrl.trim().replace(/\.git$/iu, '');
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/iu
    .exec(normalized);
  if (match === null) {
    fail('origin repository identity differs from --repository; external maintainer mutation is preserved');
  }
  return repositoryName(`${match[1]}/${match[2]}`);
}

export function assertRepositoryIdentityMatchesRemoteUrls(
  repository: string,
  fetchUrl: string,
  pushUrls: readonly string[]
): string {
  const observed = assertRepositoryIdentityMatchesOrigin(repository, fetchUrl);
  if (pushUrls.length === 0) fail('origin has no effective push URL');
  for (const pushUrl of pushUrls) assertRepositoryIdentityMatchesOrigin(repository, pushUrl);
  return observed;
}

async function assertOriginRepositoryIdentity(cwd: string, repository?: string): Promise<string> {
  return await withAuthorityGitReadSession({ cwd, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    const fetchUrl = (await gitReadText(session, ['remote', 'get-url', 'origin'], {
      maxBuffer: 1024 * 1024,
      label: 'runner origin fetch URL'
    })).trim();
    const expected = repository ?? repositoryIdentityFromGitHubUrl(fetchUrl);
    const pushUrls = (await gitReadText(session, ['remote', 'get-url', '--all', '--push', 'origin'], {
      maxBuffer: 1024 * 1024,
      label: 'runner origin push URLs'
    })).trim().split(/\r?\n/u).filter(Boolean);
    return assertRepositoryIdentityMatchesRemoteUrls(expected, fetchUrl, pushUrls);
  });
}

function statePath(commonDirectory: string): string {
  return path.join(commonDirectory, 'sec-local-actions-runner', 'state.json');
}

function stateDirectory(commonDirectory: string, create: boolean): PhysicalDirectoryIdentity | null {
  const root = inspectNoFollowDirectoryChain(commonDirectory, 'provider common directory').target;
  if (create) return createNoFollowDirectoryChain(root, ['sec-local-actions-runner']);
  const observed = inspectExactNoFollowDirectoryPresence(
    path.join(root.path, 'sec-local-actions-runner'), 'provider state directory'
  );
  return observed.state === 'absent' ? null : observed.directory.target;
}

function canonicalStateBytes(state: LocalGitHubActionsRunnerState): Buffer {
  return Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function readStateProjection(commonDirectory: string): Readonly<{
  state: LocalGitHubActionsRunnerState;
  directory: PhysicalDirectoryIdentity;
  bytes: Uint8Array;
}> | null {
  const directory = stateDirectory(commonDirectory, false);
  if (directory === null) return null;
  const bytes = readNoFollowOrdinaryFile(directory, 'state.json');
  if (bytes === null) return null;
  const state = parseLocalGitHubActionsRunnerState(Buffer.from(bytes).toString('utf8'));
  if (!canonicalStateBytes(state).equals(Buffer.from(bytes))) fail('local state projection bytes are not canonical');
  return Object.freeze({ state, directory, bytes });
}

function publishState(commonDirectory: string, state: LocalGitHubActionsRunnerState): void {
  const directory = stateDirectory(commonDirectory, true)!;
  const bytes = canonicalStateBytes(state);
  publishExclusiveDurableCanonicalFile({
    parent: directory,
    name: 'state.json',
    bytes,
    validate: (candidate) => {
      const parsed = parseLocalGitHubActionsRunnerState(Buffer.from(candidate).toString('utf8'));
      if (parsed.stateDigest !== state.stateDigest || !Buffer.from(candidate).equals(bytes)) {
        fail('durable state projection readback mismatch');
      }
    }
  });
}

function replaceState(
  commonDirectory: string,
  expected: LocalGitHubActionsRunnerState,
  next: LocalGitHubActionsRunnerState
): void {
  const observed = readStateProjection(commonDirectory);
  if (observed === null || observed.state.stateDigest !== expected.stateDigest
      || !Buffer.from(observed.bytes).equals(canonicalStateBytes(expected))) {
    fail('local lifecycle state changed and is preserved');
  }
  const entry = inspectNoFollowOrdinaryFileEntry(observed.directory, 'state.json');
  if (entry === null) fail('local lifecycle state disappeared before durable CAS');
  const bytes = canonicalStateBytes(next);
  replaceDurableCanonicalFile({
    parent: observed.directory,
    name: 'state.json',
    bytes,
    expectedExisting: Object.freeze({ device: entry.device, inode: entry.inode }),
    validate: (candidate) => {
      const parsed = parseLocalGitHubActionsRunnerState(Buffer.from(candidate).toString('utf8'));
      if (parsed.stateDigest !== next.stateDigest || !Buffer.from(candidate).equals(bytes)) {
        fail('durable lifecycle state CAS readback mismatch');
      }
    }
  });
}

async function withRunnerLifecycleLease<T>(
  commonDirectory: string,
  operation: () => Promise<T>
): Promise<T> {
  const directory = stateDirectory(commonDirectory, true)!;
  const lease = acquirePhysicalMutationLease(directory, 'lifecycle-lease.json', {
    ttlMs: ENVIRONMENT.provider.timeoutsMs.commandMaximum
  });
  if (lease === null) fail('runner lifecycle is owned by another local operation');
  let result: T | undefined;
  let primary: unknown;
  try {
    lease.acknowledgeReclaimedRecovery();
    result = await operation();
  } catch (error) {
    primary = error;
  }
  try {
    lease.release();
  } catch (error) {
    if (primary !== undefined) {
      throw new AggregateError([primary, error], 'runner lifecycle and lease settlement both failed');
    }
    throw error;
  }
  if (primary !== undefined) throw primary;
  return result as T;
}

function deleteStateProjection(commonDirectory: string, expected: LocalGitHubActionsRunnerState): void {
  const observed = readStateProjection(commonDirectory);
  if (observed === null || observed.state.stateDigest !== expected.stateDigest
      || !Buffer.from(observed.bytes).equals(canonicalStateBytes(expected))) {
    fail('local state projection changed and is preserved');
  }
  const entry = inspectNoFollowOrdinaryFileEntry(observed.directory, 'state.json');
  if (entry === null) fail('local state projection disappeared before retained deletion');
  deleteRetainedNoFollowEntry({
    root: observed.directory,
    relativePath: 'state.json',
    kind: 'file',
    device: entry.device,
    inode: entry.inode,
    ancestorDirectories: []
  });
  if (readNoFollowOrdinaryFile(observed.directory, 'state.json') !== null) {
    fail('local state projection deletion readback is not absent');
  }
}

async function listRepositoryRunners(repository: string, cwd: string): Promise<readonly Record<string, unknown>[]> {
  const retainedRepository = repositoryName(repository);
  return await withGitHubApiReadSession({
    repositoryRoot: cwd,
    repository: retainedRepository,
    operation: async (api) => {
      const runners: Record<string, unknown>[] = [];
      for (let page = 1; page <= 100; page += 1) {
        const value = await executeGitHubApiOperation(api, { kind: 'repository-runners', page });
        if (value === null || typeof value !== 'object' || Array.isArray(value)
            || !Array.isArray((value as Record<string, unknown>).runners)) {
          fail('GitHub runner inventory is invalid');
        }
        const entries = (value as Record<string, unknown>).runners as unknown[];
        for (const item of entries) {
          if (item === null || typeof item !== 'object' || Array.isArray(item)) {
            fail('GitHub runner inventory entry is invalid');
          }
          runners.push(item as Record<string, unknown>);
        }
        if (entries.length < 100) return Object.freeze(runners);
      }
      fail('GitHub runner inventory exceeds its bounded page count');
    }
  });
}

async function createRunnerRegistrationToken(repository: string, cwd: string): Promise<string> {
  const retainedRepository = repositoryName(repository);
  return await withGitHubApiRunnerAdminSession({
    repositoryRoot: cwd,
    repository: retainedRepository,
    operation: async (api) => {
      const value = await executeGitHubApiOperation(api, { kind: 'create-runner-registration-token' });
      const token = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).token
        : null;
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,512}$/u.test(token)) {
        fail('GitHub returned an invalid registration token');
      }
      return token;
    }
  });
}

async function deleteRepositoryRunner(repository: string, cwd: string, runnerId: number): Promise<void> {
  const retainedRepository = repositoryName(repository);
  if (!Number.isSafeInteger(runnerId) || runnerId < 1) fail('runnerId is invalid');
  await withGitHubApiRunnerAdminSession({
    repositoryRoot: cwd,
    repository: retainedRepository,
    operation: async (api) => {
      const result = await executeGitHubApiOperation(api, {
        kind: 'delete-repository-runner',
        runnerId
      });
      if (result !== null) fail('GitHub runner deletion returned an unexpected body');
    }
  });
}

async function listContainerIdentityRows(
  session: ContainerEngineSession,
  filters: readonly string[] = []
): Promise<readonly Readonly<{ id: string; name: string }>[]> {
  const inventory = await runContainerEngineOperation(session, {
    kind: 'container-list',
    arguments: ['--all', '--no-trunc', ...filters, '--format', '{{.ID}}\t{{.Names}}']
  }, {});
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
  session: ContainerEngineSession
): Promise<Record<string, unknown> | null> {
  // A successful inventory query is the absence proof. `docker inspect` exit
  // code 1 is deliberately not absence because daemon/context failures share it.
  const matches = (await listContainerIdentityRows(session, [
    '--filter', `name=^/${runnerName(containerName)}$`
  ])).filter(({ name }) => name === containerName);
  if (matches.length === 0) return null;
  if (matches.length !== 1) fail('Docker container inventory is ambiguous');
  return await inspectContainerById(matches[0]!.id, session);
}

async function inspectContainerById(
  containerId: string,
  session: ContainerEngineSession
): Promise<Record<string, unknown> | null> {
  if (!/^[0-9a-f]{64}$/u.test(containerId)) fail('container identity is invalid');
  const matches = (await listContainerIdentityRows(session)).filter(({ id }) => id === containerId);
  if (matches.length === 0) return null;
  if (matches.length !== 1) fail('Docker exact-ID inventory is ambiguous');
  const result = await runContainerEngineOperation(session, {
    kind: 'container-inspect', arguments: [containerId]
  }, {});
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

async function listProviderProfileContainers(
  repository: string,
  session: ContainerEngineSession
): Promise<readonly Record<string, unknown>[]> {
  const retainedRepository = repositoryName(repository);
  const entries = await listContainerIdentityRows(session, [
    '--filter', `label=sec.local-runner.repository=${retainedRepository}`
  ]);
  const expectedRepository = retainedRepository.toLowerCase();
  const containers: Record<string, unknown>[] = [];
  for (const { id } of entries) {
    const container = await inspectContainerById(id, session);
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
    role: LocalGitHubActionsRunnerRole;
    containerId?: string;
    operationLabel?: string;
    allowLegacyDetachedRunnerDuringTeardown?: true;
  }>
): string {
  const config = value.Config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail('container config is invalid');
  const labels = (config as Record<string, unknown>).Labels;
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) fail('container labels are invalid');
  const record = labels as Record<string, unknown>;
  if (record['sec.local-runner.schema'] !== LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA
      || record['sec.local-runner.repository'] !== input.repository
      || record['sec.local-runner.provider-name'] !== input.providerName
      || record['sec.local-runner.instance-name'] !== input.instanceName
      || record['sec.local-runner.role'] !== input.role
      || record['sec.local-runner.container-init'] !== LOCAL_GITHUB_ACTIONS_RUNNER_CONTAINER_INIT_CAPABILITY
      || record['sec.local-runner.image-id'] !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID) {
    fail('container is foreign and is preserved');
  }
  if (value.Name !== `/${input.instanceName}`) {
    fail('container retained name changed and is preserved');
  }
  if (value.Image !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID) {
    fail('container actual image identity changed and is preserved');
  }
  const hostConfig = value.HostConfig;
  if (hostConfig === null || typeof hostConfig !== 'object' || Array.isArray(hostConfig)) {
    fail('container host configuration is invalid and is preserved');
  }
  const host = hostConfig as Record<string, unknown>;
  const restartPolicy = host.RestartPolicy;
  const retainedRestartPolicy = restartPolicy !== null && typeof restartPolicy === 'object'
    && !Array.isArray(restartPolicy)
    ? restartPolicy as Record<string, unknown>
    : null;
  const permittedRestartPolicy = retainedRestartPolicy !== null
    && retainedRestartPolicy.MaximumRetryCount === 0
    && (retainedRestartPolicy.Name === 'unless-stopped'
      || (input.allowLegacyDetachedRunnerDuringTeardown === true
        && retainedRestartPolicy.Name === 'no'));
  if (!permittedRestartPolicy) {
    fail('container restart policy changed and is preserved');
  }
  const retainedConfig = config as Record<string, unknown>;
  const currentSupervisor = retainedRestartPolicy?.Name === 'unless-stopped'
    && retainedRestartPolicy.MaximumRetryCount === 0
    && JSON.stringify(retainedConfig.Entrypoint) === JSON.stringify(['/bin/bash'])
    && JSON.stringify(retainedConfig.Cmd) === JSON.stringify([
      '-ceu', LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_SCRIPT
    ]);
  const exactLegacyDetachedRunner = input.allowLegacyDetachedRunnerDuringTeardown === true
    && retainedRestartPolicy?.Name === 'no'
    && retainedRestartPolicy.MaximumRetryCount === 0
    && JSON.stringify(retainedConfig.Entrypoint) === JSON.stringify(['/usr/bin/sleep'])
    && JSON.stringify(retainedConfig.Cmd) === JSON.stringify(['infinity']);
  if (!currentSupervisor && !exactLegacyDetachedRunner) {
    fail('container runner supervisor boundary changed and is preserved');
  }
  const observedCapabilities = Array.isArray(host.CapAdd)
    ? host.CapAdd.map(String).sort()
    : [];
  const expectedCapabilities = input.role === 'sut'
    ? SUT_CAPABILITIES.map((entry) => `CAP_${entry}`).sort()
    : [];
  if (JSON.stringify(observedCapabilities) !== JSON.stringify(expectedCapabilities)
      || !Array.isArray(host.CapDrop) || JSON.stringify(host.CapDrop) !== JSON.stringify(['ALL'])
      || !Array.isArray(host.SecurityOpt) || !host.SecurityOpt.includes('no-new-privileges:true')
      || host.Init !== true || host.Privileged !== false || host.Binds !== null) {
    fail('container capability boundary changed and is preserved');
  }
  if (input.role === 'sut' &&
      (host.PidsLimit !== SUT_PIDS
        || host.Memory !== ENVIRONMENT.runtime.resources.sut.memoryGiB * 1024 * 1024 * 1024 ||
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

export function assertExactLocalGitHubActionsRunnerProfileContainers(input: Readonly<{
  containers: readonly Record<string, unknown>[];
  instances: readonly LocalGitHubActionsRunnerInstance[];
  repository: string;
  providerName: string;
  operationLabel: string;
}>): void {
  const retainedProviderName = providerBaseName(input.providerName);
  const retainedOperationLabel = operationLabel(input.operationLabel);
  if (input.instances.length !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLES.length) {
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

function isProviderProfileEligibleRunner(value: Record<string, unknown>): boolean {
  const labels = runnerLabelKeys(value);
  return [
    LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL,
    ...Object.values(LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS)
  ].some((label) => labels.has(label.toLowerCase()));
}

export function assertOwnedLocalGitHubActionsRunner(
  value: Record<string, unknown>,
  input: Readonly<{
    name: string;
    role: LocalGitHubActionsRunnerRole;
    operationLabel: string;
    runnerId?: number;
    requireIdleForRemoval?: true;
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
    ...LOCAL_GITHUB_ACTIONS_RUNNER_LABELS,
    LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS[input.role],
    input.operationLabel
  ].map((label) => label.toLowerCase()));
  if (labels.size !== expectedLabels.size || [...expectedLabels].some((label) => !labels.has(label))) {
    fail('GitHub runner complete effective labels changed and it is preserved');
  }
  if (value.os !== 'Linux') {
    fail('GitHub runner operating system identity changed and it is preserved');
  }
  if (input.requireIdleForRemoval === true && value.busy !== false) {
    fail('GitHub runner busy state must be exact false before cleanup and it is preserved');
  }
  return Number(id);
}

function assertContainedLocalGitHubActionsRunnerProfileInventory(input: Readonly<{
  runners: readonly Record<string, unknown>[];
  instances: readonly LocalGitHubActionsRunnerInstance[];
  operationLabel: string;
}>): void {
  const retainedOperationLabel = operationLabel(input.operationLabel);
  const expectedByName = new Map(input.instances.map((instance) => [instance.name, instance] as const));
  const expectedById = new Map(input.instances.map((instance) => [instance.runnerId, instance] as const));
  const candidates = input.runners.filter((runner) => {
    return isProviderProfileEligibleRunner(runner)
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
    assertOwnedLocalGitHubActionsRunner(runner, {
      name: byName.name,
      role: byName.role,
      operationLabel: retainedOperationLabel,
      runnerId: byName.runnerId
    });
  }
}

export function assertExactLocalGitHubActionsRunnerProfileInventory(input: Readonly<{
  runners: readonly Record<string, unknown>[];
  instances: readonly LocalGitHubActionsRunnerInstance[];
  operationLabel: string;
}>): void {
  if (input.instances.length !== LOCAL_GITHUB_ACTIONS_RUNNER_ROLES.length
      || new Set(input.instances.map(({ name }) => name)).size !== 3
      || new Set(input.instances.map(({ runnerId }) => runnerId)).size !== 3) {
    fail('GitHub runner retained inventory is not one exact instance per role');
  }
  const retainedOperationLabel = operationLabel(input.operationLabel);
  const expectedByName = new Map(input.instances.map((instance) => [instance.name, instance] as const));
  const expectedById = new Map(input.instances.map((instance) => [instance.runnerId, instance] as const));
  const candidates = input.runners.filter((runner) => isProviderProfileEligibleRunner(runner)
    || runnerHasLabel(runner, retainedOperationLabel)
    || expectedByName.has(String(runner.name))
    || (Number.isSafeInteger(runner.id) && expectedById.has(Number(runner.id))));
  if (candidates.length !== 3) {
    fail('GitHub runner profile inventory is missing, duplicated, or extra');
  }
  assertContainedLocalGitHubActionsRunnerProfileInventory(input);
  for (const expected of input.instances) {
    const exact = candidates.filter((runner) => runner.name === expected.name || runner.id === expected.runnerId);
    if (exact.length !== 1 || exact[0]!.name !== expected.name || exact[0]!.id !== expected.runnerId) {
      fail('GitHub runner exact retained name and ID set differs');
    }
    // `busy` is transient provider scheduling state: an exact runner can be
    // claimed immediately after registration, before this census is read.
    // Readiness owns identity plus online eligibility; cleanup separately
    // refuses a busy runner before any destructive effect.
    if (exact[0]!.status !== 'online') {
      fail('GitHub runner final readiness census is not online');
    }
  }
}

function withStateInstance(
  state: LocalGitHubActionsRunnerState,
  role: LocalGitHubActionsRunnerRole,
  update: Partial<LocalGitHubActionsProviderStateInstance>
): readonly LocalGitHubActionsProviderStateInstance[] {
  return Object.freeze(state.instances.map((instance) => instance.role === role
    ? Object.freeze({ ...instance, ...update })
    : instance));
}

interface LocalRunnerStateCursor {
  state: LocalGitHubActionsRunnerState;
  readonly commonDirectory: string;
}

function advanceLocalRunnerState(
  cursor: LocalRunnerStateCursor,
  update: Readonly<{
    lifecycle?: LocalGitHubActionsProviderLifecycle;
    instances?: readonly LocalGitHubActionsProviderStateInstance[];
  }>
): void {
  const nextLifecycle = update.lifecycle ?? cursor.state.lifecycle;
  const lifecycleAllowed = nextLifecycle === cursor.state.lifecycle
    || (cursor.state.lifecycle === 'provisioning'
      && (nextLifecycle === 'active' || nextLifecycle === 'teardown'))
    || (cursor.state.lifecycle === 'active' && nextLifecycle === 'teardown')
    || (cursor.state.lifecycle === 'teardown' && nextLifecycle === 'terminal');
  if (!lifecycleAllowed) fail('local runner lifecycle transition is invalid');
  const next = createLocalGitHubActionsRunnerState({
    ...cursor.state,
    lifecycle: nextLifecycle,
    instances: update.instances ?? cursor.state.instances
  });
  replaceState(cursor.commonDirectory, cursor.state, next);
  cursor.state = next;
}

async function cleanupStateInstance(
  cursor: LocalRunnerStateCursor,
  cwd: string,
  role: LocalGitHubActionsRunnerRole,
  session: ContainerEngineSession
): Promise<void> {
  let retained = cursor.state.instances.find((instance) => instance.role === role)!;
  const runners = await listRepositoryRunners(cursor.state.repository, cwd);
  const runnerCandidates = runners.filter((runner) =>
    runner.name === retained.name || (retained.runnerId !== null && runner.id === retained.runnerId));
  if (retained.runnerState === 'uncreated') {
    if (runnerCandidates.length !== 0) {
      fail('GitHub runner residue exists without a retained exact ID and is preserved');
    }
    advanceLocalRunnerState(cursor, {
      instances: withStateInstance(cursor.state, role, { runnerState: 'absent' })
    });
  } else if (retained.runnerState === 'present') {
    if (retained.runnerId === null || runnerCandidates.length > 1
        || runnerCandidates.some((runner) => runner.id !== retained.runnerId || runner.name !== retained.name)) {
      fail('GitHub runner retained ID/name was replaced and external mutation is preserved');
    }
    if (runnerCandidates.length === 1) {
      assertOwnedLocalGitHubActionsRunner(runnerCandidates[0]!, {
        name: retained.name,
        role,
        operationLabel: cursor.state.operationLabel,
        runnerId: retained.runnerId,
        requireIdleForRemoval: true
      });
      await deleteRepositoryRunner(cursor.state.repository, cwd, retained.runnerId);
    }
    if ((await listRepositoryRunners(cursor.state.repository, cwd)).some((runner) =>
      runner.name === retained.name || runner.id === retained.runnerId)) {
      fail('GitHub runner exact ID/name deletion readback is not absent');
    }
    advanceLocalRunnerState(cursor, {
      instances: withStateInstance(cursor.state, role, { runnerState: 'absent' })
    });
  } else if (runnerCandidates.length !== 0) {
    fail('GitHub runner reappeared after local terminal state and is preserved');
  }

  retained = cursor.state.instances.find((instance) => instance.role === role)!;
  const byName = await inspectContainerByName(retained.name, session);
  const byId = retained.containerId === null ? null
    : await inspectContainerById(retained.containerId, session);
  if (retained.containerState === 'uncreated') {
    if (byName !== null || byId !== null) {
      fail('Docker container residue exists without a retained exact ID and is preserved');
    }
    advanceLocalRunnerState(cursor, {
      instances: withStateInstance(cursor.state, role, { containerState: 'absent' })
    });
  } else if (retained.containerState === 'present') {
    if (retained.containerId === null || (byName === null) !== (byId === null)
        || (byName !== null && (byName.Id !== retained.containerId || byId?.Id !== retained.containerId))) {
      fail('Docker container retained ID/name was replaced and external mutation is preserved');
    }
    if (byId !== null) {
      assertOwnedContainer(byId, {
        repository: cursor.state.repository,
        providerName: cursor.state.providerName,
        instanceName: retained.name,
        role,
        containerId: retained.containerId,
        operationLabel: cursor.state.operationLabel,
        allowLegacyDetachedRunnerDuringTeardown: true
      });
      await runContainerEngineOperation(session, {
        kind: 'container-remove', arguments: ['--force', retained.containerId]
      }, {});
    }
    if (await inspectContainerById(retained.containerId, session) !== null
        || await inspectContainerByName(retained.name, session) !== null) {
      fail('Docker container exact ID/name deletion readback is not absent');
    }
    advanceLocalRunnerState(cursor, {
      instances: withStateInstance(cursor.state, role, { containerState: 'absent' })
    });
  } else if (byName !== null || byId !== null) {
    fail('Docker container reappeared after local terminal state and is preserved');
  }
}

export function assertLocalGitHubActionsRunnerImageIdentity(
  value: Readonly<Record<string, unknown>>
): void {
  if (value.Id !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID) {
    fail('cached runner image ID differs from the frozen provider revision');
  }
  const config = value.Config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) fail('image config is invalid');
  const labels = (config as Record<string, unknown>).Labels;
  if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) fail('image labels are invalid');
  const record = labels as Record<string, unknown>;
  if (record['sec.local-runner.image-schema'] !== LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA
      || record['sec.local-runner.image-revision'] !== LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION
      || record['sec.local-runner.runner-version'] !== LOCAL_GITHUB_ACTIONS_RUNNER_VERSION
      || record['sec.local-runner.node-version'] !== LOCAL_GITHUB_ACTIONS_NODE_VERSION
      || record['sec.local-runner.node-archive-sha256']
        !== LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256
      || record['sec.local-runner.github-cli-version']
        !== LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION
      || record['sec.local-runner.github-cli-archive-sha256']
        !== LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256
      || record['sec.local-runner.python-version'] !== LOCAL_GITHUB_ACTIONS_PYTHON_VERSION
      || record['sec.local-runner.ubuntu-snapshot'] !== LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT
      || record['sec.local-runner.bootstrap-ca-bundle-sha256']
        !== LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256
      || record['sec.local-runner.dockerfile-frontend']
        !== LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND) {
    fail('cached runner image labels differ from the frozen provider revision');
  }
}

export function assertLocalGitHubActionsRunnerReplacementImageIdentity(
  value: Readonly<Record<string, unknown>>,
  expectedImageId: typeof LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS[number]['replacementImageId']
): void {
  if (value.Id !== expectedImageId) fail('superseding frozen image identity differs from its decision');
  if (expectedImageId === LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID) {
    assertLocalGitHubActionsRunnerImageIdentity(value);
  } else if (expectedImageId !== LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_ARCHIVE_IMAGE_ID) {
    fail('superseding frozen image identity has no canonical lineage');
  }
}

async function inspectImage(session: ContainerEngineSession): Promise<Record<string, unknown> | null> {
  const inventory = await runContainerEngineOperation(session, {
    kind: 'image-list',
    arguments: [
      '--no-trunc', '--filter', `reference=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE}`, '--format', '{{.ID}}'
    ]
  }, {});
  const identities = [...new Set(inventory.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean))];
  if (identities.length === 0) return null;
  if (identities.length !== 1 || !/^sha256:[0-9a-f]{64}$/u.test(identities[0]!)) {
    fail('runner image inventory is ambiguous');
  }
  const result = await runContainerEngineOperation(session, {
    kind: 'image-inspect', arguments: [identities[0]!]
  }, {});
  const parsed = JSON.parse(result.stdout.toString('utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) fail('Docker image inspect is invalid');
  return parsed[0] as Record<string, unknown>;
}

async function inspectImageById(
  imageId: string,
  session: ContainerEngineSession
): Promise<Record<string, unknown> | null> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageId)) fail('Docker image identity is invalid');
  const inventory = await runContainerEngineOperation(session, {
    kind: 'image-list', arguments: ['--all', '--no-trunc', '--format', '{{.ID}}']
  }, {});
  const identities = new Set(inventory.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean));
  if (!identities.has(imageId)) return null;
  const result = await runContainerEngineOperation(session, {
    kind: 'image-inspect', arguments: [imageId]
  }, {});
  const parsed = JSON.parse(result.stdout.toString('utf8')) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null
      || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])
      || (parsed[0] as Record<string, unknown>).Id !== imageId) {
    fail('Docker exact image identity readback is invalid');
  }
  return parsed[0] as Record<string, unknown>;
}

interface LocalGitHubActionsRunnerOciReceipt {
  readonly schema: typeof LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RECEIPT_SCHEMA;
  readonly specDigest: `sha256:${string}`;
  readonly runtimeManifestDigest: typeof LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST;
  readonly dockerProjectionDigest: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID;
  readonly provenanceArtifactDigest: `sha256:${string}`;
  readonly layoutName: 'layout';
}

interface LocalGitHubActionsRunnerOciCache {
  readonly directory: PhysicalDirectoryIdentity;
  readonly layoutPath: string;
  readonly receipt: LocalGitHubActionsRunnerOciReceipt | null;
  readonly state: 'absent' | 'matching' | 'mismatched';
}

export interface LocalGitHubActionsRunnerOciCandidateBinding {
  readonly schema: 'sec-local-github-actions-runner-oci-candidate-binding-v1';
  readonly specDigest: `sha256:${string}`;
  readonly leaseName: typeof RUNNER_OCI_MATERIALIZATION_LEASE_NAME;
  readonly candidateName: string;
  readonly owner: PhysicalMutationLeaseOwner;
}

export function createLocalGitHubActionsRunnerOciCandidateBinding(
  specDigest: `sha256:${string}`,
  owner: PhysicalMutationLeaseOwner
): LocalGitHubActionsRunnerOciCandidateBinding {
  if (!/^sha256:[0-9a-f]{64}$/u.test(specDigest)) fail('OCI candidate spec digest is invalid');
  const token = owner.token.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/u.test(token)) fail('OCI candidate lease token is invalid');
  return Object.freeze({
    schema: 'sec-local-github-actions-runner-oci-candidate-binding-v1' as const,
    specDigest,
    leaseName: RUNNER_OCI_MATERIALIZATION_LEASE_NAME,
    candidateName: `${RUNNER_OCI_CANDIDATE_PREFIX}${token}`,
    owner
  });
}

export function retireLocalGitHubActionsRunnerOciCandidate(
  directory: PhysicalDirectoryIdentity,
  binding: LocalGitHubActionsRunnerOciCandidateBinding
): void {
  if (path.basename(directory.path) !== binding.specDigest.slice(7)) {
    fail('OCI candidate cleanup generation differs from its spec');
  }
  const candidate = inspectNoFollowDirectoryChild(
    directory, binding.candidateName, 'Runner OCI materialization candidate'
  );
  if (candidate === null) return;
  const inventory = scanNoFollowDirectoryTreeMetadata(candidate, {
    deadlineAtMs: performance.now() + RUNNER_OCI_CLEANUP_BUDGET_MS,
    maximumEntries: RUNNER_OCI_CLEANUP_MAXIMUM_ENTRIES
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
    deleteRetainedNoFollowEntry({
      root: candidate,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      expectedLinkTarget: entry.linkTarget ?? undefined,
      ancestorDirectories
    });
  }
  deleteRetainedNoFollowEntry({
    root: directory,
    relativePath: binding.candidateName,
    kind: 'directory',
    device: candidate.device,
    inode: candidate.inode,
    ancestorDirectories: []
  });
  if (inspectExactNoFollowDirectoryPresence(
    path.join(directory.path, binding.candidateName), 'Runner OCI candidate cleanup readback'
  ).state !== 'absent') fail('OCI candidate cleanup readback is not absent');
}

function createRunnerOciReceipt(
  specDigest: `sha256:${string}`,
  provenanceArtifactDigest: `sha256:${string}`
): LocalGitHubActionsRunnerOciReceipt {
  return Object.freeze({
    schema: LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RECEIPT_SCHEMA,
    specDigest,
    runtimeManifestDigest: LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST,
    dockerProjectionDigest: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID,
    provenanceArtifactDigest,
    layoutName: 'layout' as const
  });
}

function publishRunnerOciReceipt(
  directory: PhysicalDirectoryIdentity,
  receipt: LocalGitHubActionsRunnerOciReceipt
): void {
  publishExclusiveDurableCanonicalFile({
    parent: directory,
    name: 'receipt.json',
    bytes: Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'),
    validate: (bytes) => { parseOciReceipt(bytes, receipt.specDigest); }
  });
}

function parseOciReceipt(source: Uint8Array, specDigest: `sha256:${string}`): LocalGitHubActionsRunnerOciReceipt {
  const parsed = JSON.parse(Buffer.from(source).toString('utf8')) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('OCI cache receipt is invalid');
  const value = parsed as Record<string, unknown>;
  exactKeys(value, [
    'schema', 'specDigest', 'runtimeManifestDigest', 'dockerProjectionDigest',
    'provenanceArtifactDigest', 'layoutName'
  ], 'OCI cache receipt');
  if (value.schema !== LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RECEIPT_SCHEMA
      || value.specDigest !== specDigest
      || value.runtimeManifestDigest !== LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST
      || value.dockerProjectionDigest !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID
      || !/^sha256:[0-9a-f]{64}$/u.test(String(value.provenanceArtifactDigest))
      || value.layoutName !== 'layout') {
    fail('OCI cache receipt identity is invalid');
  }
  const receipt = Object.freeze(value as unknown as LocalGitHubActionsRunnerOciReceipt);
  if (!Buffer.from(source).equals(Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'))) {
    fail('OCI cache receipt bytes are not canonical');
  }
  return receipt;
}

interface OciDescriptor {
  readonly mediaType: string;
  readonly digest: `sha256:${string}`;
  readonly size: number;
  readonly annotations?: Readonly<Record<string, unknown>>;
  readonly platform?: Readonly<Record<string, unknown>>;
}

function parseOciDescriptor(value: unknown, label: string): OciDescriptor {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} is invalid`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.mediaType !== 'string' || record.mediaType.length === 0
      || typeof record.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.digest)
      || !Number.isSafeInteger(record.size) || (record.size as number) < 0) {
    fail(`${label} identity is invalid`);
  }
  return record as unknown as OciDescriptor;
}

function validateOciBlob(
  blobs: PhysicalDirectoryIdentity,
  descriptor: OciDescriptor,
  label: string
): void {
  const observed = inspectNoFollowOrdinaryFileDigest(blobs, descriptor.digest.slice(7));
  if (observed === null || observed.size !== descriptor.size || observed.byteDigest !== descriptor.digest) {
    fail(`${label} blob identity is invalid`);
  }
}

function readOciJsonBlob(
  blobs: PhysicalDirectoryIdentity,
  descriptor: OciDescriptor,
  expectedMediaType: string,
  label: string
): Record<string, unknown> {
  if (descriptor.mediaType !== expectedMediaType) fail(`${label} media type is invalid`);
  validateOciBlob(blobs, descriptor, label);
  const bytes = readNoFollowOrdinaryFile(blobs, descriptor.digest.slice(7));
  if (bytes === null || bytes.byteLength !== descriptor.size
      || `sha256:${rawSha256Hex(bytes)}` !== descriptor.digest) {
    fail(`${label} JSON blob identity changed during readback`);
  }
  const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} JSON is invalid`);
  }
  return parsed as Record<string, unknown>;
}

function assertOciIndexFraming(value: Record<string, unknown>, label: string): readonly unknown[] {
  if (value.schemaVersion !== 2 || value.mediaType !== 'application/vnd.oci.image.index.v1+json'
      || !Array.isArray(value.manifests)) {
    fail(`${label} framing is invalid`);
  }
  return value.manifests;
}

export function readValidatedRunnerOciLayoutIdentity(
  layoutPath: string,
  expectedRuntimeManifestDigest: `sha256:${string}` = LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST
): `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedRuntimeManifestDigest)) {
    fail('OCI cache expected runtime manifest digest is invalid');
  }
  const layout = inspectNoFollowDirectoryChain(layoutPath, 'OCI cache layout').target;
  const layoutBytes = readNoFollowOrdinaryFile(layout, 'oci-layout');
  const indexBytes = readNoFollowOrdinaryFile(layout, 'index.json');
  if (layoutBytes === null || indexBytes === null
      || Buffer.from(layoutBytes).toString('utf8').trim() !== '{"imageLayoutVersion":"1.0.0"}') {
    fail('OCI cache layout framing is invalid');
  }
  const index = JSON.parse(Buffer.from(indexBytes).toString('utf8')) as unknown;
  if (index === null || typeof index !== 'object' || Array.isArray(index)) fail('OCI cache index is invalid');
  const manifests = assertOciIndexFraming(index as Record<string, unknown>, 'OCI cache index');
  if (manifests.length !== 1) {
    fail('OCI cache index descriptor is invalid');
  }
  const nestedDescriptor = parseOciDescriptor(manifests[0], 'OCI cache nested index descriptor');
  const blobs = inspectNoFollowDirectoryChain(
    path.join(layout.path, 'blobs', 'sha256'), 'OCI cache blob directory'
  ).target;
  const nested = readOciJsonBlob(
    blobs, nestedDescriptor, 'application/vnd.oci.image.index.v1+json', 'OCI cache nested index'
  );
  const nestedManifests = assertOciIndexFraming(nested, 'OCI cache nested index');
  if (nestedManifests.length !== 2) fail('OCI cache must contain one runtime and one attestation manifest');
  const descriptors = nestedManifests.map((value, index) =>
    parseOciDescriptor(value, `OCI cache nested descriptor ${index}`));
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
  const runtime = readOciJsonBlob(blobs, runtimeDescriptor, manifestMediaType, 'OCI cache runtime manifest');
  if (runtime.schemaVersion !== 2 || runtime.mediaType !== manifestMediaType
      || !Array.isArray(runtime.layers)) fail('OCI cache runtime manifest framing is invalid');
  const runtimeConfig = parseOciDescriptor(runtime.config, 'OCI cache runtime config descriptor');
  if (runtimeConfig.mediaType !== 'application/vnd.oci.image.config.v1+json') {
    fail('OCI cache runtime config media type is invalid');
  }
  validateOciBlob(blobs, runtimeConfig, 'OCI cache runtime config');
  for (const [index, value] of runtime.layers.entries()) {
    const layer = parseOciDescriptor(value, `OCI cache runtime layer ${index}`);
    if (!/^application\/vnd\.(?:oci\.image|docker\.image\.rootfs)\.layer\./u.test(layer.mediaType)) {
      fail(`OCI cache runtime layer ${index} media type is invalid`);
    }
    validateOciBlob(blobs, layer, `OCI cache runtime layer ${index}`);
  }
  const attestation = readOciJsonBlob(
    blobs, attestationDescriptor, manifestMediaType, 'OCI cache attestation manifest'
  );
  const subject = parseOciDescriptor(attestation.subject, 'OCI cache attestation subject');
  if (attestation.schemaVersion !== 2 || attestation.mediaType !== manifestMediaType
      || attestation.artifactType !== 'application/vnd.docker.attestation.manifest.v1+json'
      || subject.mediaType !== runtimeDescriptor.mediaType
      || subject.digest !== runtimeDescriptor.digest || subject.size !== runtimeDescriptor.size
      || !Array.isArray(attestation.layers) || attestation.layers.length !== 1) {
    fail('OCI cache attestation subject is invalid');
  }
  const attestationConfig = parseOciDescriptor(attestation.config, 'OCI cache attestation config');
  if (attestationConfig.mediaType !== 'application/vnd.oci.empty.v1+json') {
    fail('OCI cache attestation config media type is invalid');
  }
  validateOciBlob(blobs, attestationConfig, 'OCI cache attestation config');
  const provenanceLayer = parseOciDescriptor(attestation.layers[0], 'OCI cache provenance layer');
  if (provenanceLayer.mediaType !== 'application/vnd.in-toto+json'
      || provenanceLayer.annotations?.['in-toto.io/predicate-type'] !== 'https://slsa.dev/provenance/v1') {
    fail('OCI cache provenance layer identity is invalid');
  }
  validateOciBlob(blobs, provenanceLayer, 'OCI cache provenance layer');
  return nestedDescriptor.digest;
}

function recoverValidatedRunnerOciReceipt(
  directory: PhysicalDirectoryIdentity,
  specDigest: `sha256:${string}`
): LocalGitHubActionsRunnerOciReceipt {
  if (!/^sha256:[0-9a-f]{64}$/u.test(specDigest)) fail('OCI cache recovery spec digest is invalid');
  const layoutPath = path.join(directory.path, 'layout');
  const provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentity(layoutPath);
  const expected = createRunnerOciReceipt(specDigest, provenanceArtifactDigest);
  const existing = readNoFollowOrdinaryFile(directory, 'receipt.json');
  if (existing === null) publishRunnerOciReceipt(directory, expected);
  const readback = readNoFollowOrdinaryFile(directory, 'receipt.json');
  if (readback === null) fail('recovered OCI cache receipt has no durable readback');
  const receipt = parseOciReceipt(readback, specDigest);
  if (!Buffer.from(readback).equals(Buffer.from(`${JSON.stringify(expected)}\n`, 'utf8'))) {
    fail('OCI cache recovery receipt conflicts with the validated layout');
  }
  return receipt;
}

async function resolveRunnerOciCacheDirectory(cwd: string): Promise<Readonly<{
  directory: PhysicalDirectoryIdentity;
  layoutPath: string;
  specDigest: `sha256:${string}`;
}>> {
  const context = await resolveRepositoryContext(cwd);
  const roots = resolveWorkspaceRuntimeRoots({ repositoryRoot: context.repositoryRoot });
  const spec = createLocalGitHubActionsRunnerEnvironmentSpec();
  const directoryPath = path.join(
    roots.cacheRoot, 'environment-materialization', 'oci', 'entries', spec.specDigest.slice(7)
  );
  const authority = acquireRuntimeCachePhysicalAuthority({
    repositoryRoot: context.repositoryRoot,
    cacheRoot: roots.cacheRoot,
    requiredDirectories: [directoryPath]
  });
  const directory = authority.directory(directoryPath);
  return Object.freeze({
    directory,
    layoutPath: path.join(directory.path, 'layout'),
    specDigest: spec.specDigest
  });
}

function inspectRunnerOciCacheDirectory(input: Readonly<{
  directory: PhysicalDirectoryIdentity;
  layoutPath: string;
  specDigest: `sha256:${string}`;
}>): LocalGitHubActionsRunnerOciCache {
  const { directory, layoutPath, specDigest } = input;
  const receiptBytes = readNoFollowOrdinaryFile(directory, 'receipt.json');
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
    return Object.freeze({ directory, layoutPath, receipt: null, state: 'absent' as const });
  }
  if (!layoutPresent) {
    return Object.freeze({ directory, layoutPath, receipt: null, state: 'mismatched' as const });
  }
  if (receiptBytes === null) {
    // Recovery point for a crash after the validated layout rename and before
    // receipt publication. The layout is a content-addressed immutable object;
    // complete recursive revalidation deterministically reconstructs the only
    // admissible receipt instead of leaving a permanent dead cache state.
    const receipt = recoverValidatedRunnerOciReceipt(directory, specDigest);
    return Object.freeze({ directory, layoutPath, receipt, state: 'matching' as const });
  }
  const receipt = parseOciReceipt(receiptBytes, specDigest);
  const provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentity(layoutPath);
  return Object.freeze({
    directory,
    layoutPath,
    receipt,
    state: provenanceArtifactDigest === receipt.provenanceArtifactDigest
      ? 'matching' as const
      : 'mismatched' as const
  });
}

async function inspectRunnerOciCache(cwd: string): Promise<LocalGitHubActionsRunnerOciCache> {
  return inspectRunnerOciCacheDirectory(await resolveRunnerOciCacheDirectory(cwd));
}

async function projectRunnerOciLayout(
  cache: LocalGitHubActionsRunnerOciCache,
  session: ContainerEngineSession
): Promise<void> {
  const progress = createBuildxRawJsonProgressAdmission();
  if (ENVIRONMENT.provenance.dockerProjectionMode !== 'disabled') {
    fail('unsupported Docker projection provenance policy');
  }
  await runContainerEngineOperation(session, {
    kind: 'buildx-build',
    arguments: createLocalGitHubActionsRunnerProjectionBuildxArgs(cache.layoutPath).slice(2)
  }, {
    input: Buffer.from('FROM runtime\n', 'utf8'),
    stallTimeoutMs: ENVIRONMENT.provider.timeoutsMs.projectionStall,
    admitProgress: (chunk, stream) => stream === 'stderr' && progress.push(chunk)
  });
  progress.finish();
  const present = await inspectImage(session);
  if (present?.Id !== LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID) {
    fail('OCI cache projection differs from the accepted Docker manifest');
  }
}

function publishRunnerOciLayout(input: Readonly<{
  cache: LocalGitHubActionsRunnerOciCache;
  binding: LocalGitHubActionsRunnerOciCandidateBinding;
  provenanceArtifactDigest: `sha256:${string}`;
}>): void {
  const candidatePath = path.join(input.cache.directory.path, input.binding.candidateName);
  if (input.binding.specDigest !== createLocalGitHubActionsRunnerEnvironmentSpec().specDigest
      || path.basename(input.cache.directory.path) !== input.binding.specDigest.slice(7)) {
    fail('OCI candidate binding differs from its cache generation');
  }
  try {
    renameSync(candidatePath, input.cache.layoutPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existingDigest = readValidatedRunnerOciLayoutIdentity(input.cache.layoutPath);
    if (existingDigest !== input.provenanceArtifactDigest) {
      fail('OCI cache layout already exists with another identity');
    }
    retireLocalGitHubActionsRunnerOciCandidate(input.cache.directory, input.binding);
  }
  const receipt = createRunnerOciReceipt(
    createLocalGitHubActionsRunnerEnvironmentSpec().specDigest,
    input.provenanceArtifactDigest
  );
  const existing = readNoFollowOrdinaryFile(input.cache.directory, 'receipt.json');
  if (existing === null) publishRunnerOciReceipt(input.cache.directory, receipt);
  else if (!Buffer.from(existing).equals(Buffer.from(`${JSON.stringify(receipt)}\n`, 'utf8'))) {
    fail('OCI cache receipt conflicts with the validated layout');
  }
}

function recoverReclaimedRunnerOciCandidate(
  cache: LocalGitHubActionsRunnerOciCache,
  binding: LocalGitHubActionsRunnerOciCandidateBinding
): 'absent' | 'published' | 'retired-invalid' {
  const candidatePath = path.join(cache.directory.path, binding.candidateName);
  const candidate = inspectNoFollowDirectoryChild(
    cache.directory, binding.candidateName, 'Reclaimed runner OCI materialization candidate'
  );
  if (candidate === null) return 'absent';
  let provenanceArtifactDigest: `sha256:${string}`;
  try {
    provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentity(candidatePath);
  } catch {
    retireLocalGitHubActionsRunnerOciCandidate(cache.directory, binding);
    return 'retired-invalid';
  }
  try {
    publishRunnerOciLayout({ cache, binding, provenanceArtifactDigest });
    return 'published';
  } catch (error) {
    // The candidate belongs to the exact dead owner generation reclaimed by
    // the held lease. Preserve any conflicting published layout, but never
    // retain a second full copy of this operation-owned candidate.
    retireLocalGitHubActionsRunnerOciCandidate(cache.directory, binding);
    throw error;
  }
}

export function reconcileReclaimedLocalGitHubActionsRunnerOciCandidate(input: Readonly<{
  directory: PhysicalDirectoryIdentity;
  specDigest: `sha256:${string}`;
  owner: PhysicalMutationLeaseOwner;
}>): 'absent' | 'published' | 'retired-invalid' {
  if (path.basename(input.directory.path) !== input.specDigest.slice(7)) {
    fail('Reclaimed OCI candidate cache generation differs from its spec');
  }
  return recoverReclaimedRunnerOciCandidate(
    Object.freeze({
      directory: input.directory,
      layoutPath: path.join(input.directory.path, 'layout'),
      receipt: null,
      state: 'absent' as const
    }),
    createLocalGitHubActionsRunnerOciCandidateBinding(input.specDigest, input.owner)
  );
}

function acquireRunnerOciMaterializationLease(
  cache: LocalGitHubActionsRunnerOciCache,
  specDigest: `sha256:${string}`
): Readonly<{
  lease: PhysicalMutationLeaseHandle;
  binding: LocalGitHubActionsRunnerOciCandidateBinding;
}> {
  if (path.basename(cache.directory.path) !== specDigest.slice(7)) {
    fail('OCI cache directory differs from the materialization spec');
  }
  const lease = acquirePhysicalMutationLease(
    cache.directory,
    RUNNER_OCI_MATERIALIZATION_LEASE_NAME,
    { ttlMs: ENVIRONMENT.provider.timeoutsMs.materializeAbsolute
        + ENVIRONMENT.provider.timeoutsMs.projectionAbsolute + 60_000 }
  );
  if (lease === null) fail('OCI materialization is owned by another live or unverified process');
  try {
    if (lease.reclaimedOwner !== null) {
      reconcileReclaimedLocalGitHubActionsRunnerOciCandidate({
        directory: cache.directory,
        specDigest,
        owner: lease.reclaimedOwner
      });
    }
    lease.acknowledgeReclaimedRecovery();
    return Object.freeze({
      lease,
      binding: createLocalGitHubActionsRunnerOciCandidateBinding(specDigest, lease.owner)
    });
  } catch (error) {
    if (lease.recoveryPending) lease.restoreReclaimedOwner();
    else lease.release();
    throw error;
  }
}

async function ensureImage(cwd: string, session: ContainerEngineSession): Promise<void> {
  let present = await inspectImage(session);
  const spec = createLocalGitHubActionsRunnerEnvironmentSpec();
  const cacheDirectory = present === null ? await resolveRunnerOciCacheDirectory(cwd) : null;
  const materialization = cacheDirectory === null
    ? null
    : acquireRunnerOciMaterializationLease(Object.freeze({
      directory: cacheDirectory.directory,
      layoutPath: cacheDirectory.layoutPath,
      receipt: null,
      state: 'absent' as const
    }), spec.specDigest);
  let cache: LocalGitHubActionsRunnerOciCache | null = null;
  try {
    if (materialization !== null) cache = inspectRunnerOciCacheDirectory(cacheDirectory!);
    const observedImageId = present === null ? null : present.Id;
    const plan = compileEnvironmentMaterializationPlan({
      spec,
      observation: {
        localTag: present === null
          ? 'absent'
          : observedImageId === LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID
            ? 'matching'
            : 'mismatched',
        localImageDigest: present === null
          ? null
          : /^sha256:[0-9a-f]{64}$/u.test(String(observedImageId))
            ? observedImageId as `sha256:${string}`
            : fail('runner image readback has an invalid identity'),
        localArtifact: cache?.state ?? 'absent',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    });
    if (plan.disposition === 'blocked') {
      fail(`environment materialization is blocked: ${plan.reason}`);
    }
    if (plan.disposition === 'restore-local') {
      await projectRunnerOciLayout(cache!, session);
      present = await inspectImage(session);
    }
    if (plan.disposition === 'materialize') {
      if (cache === null || materialization === null) fail('OCI materialization has no acquired cache lease');
      const candidatePath = path.join(cache.directory.path, materialization.binding.candidateName);
      const progress = createBuildxRawJsonProgressAdmission();
      await runContainerEngineOperation(session, {
        kind: 'buildx-bake',
        arguments: ['--file', '-', `--progress=${ENVIRONMENT.provider.progressMode}`]
      }, {
        input: Buffer.from(createLocalGitHubActionsRunnerOciBakeDefinition(candidatePath), 'utf8'),
        stallTimeoutMs: ENVIRONMENT.provider.timeoutsMs.materializeStall,
        admitProgress: (chunk, stream) => stream === 'stderr' && progress.push(chunk)
      });
      progress.finish();
      const provenanceArtifactDigest = readValidatedRunnerOciLayoutIdentity(candidatePath);
      publishRunnerOciLayout({
        cache,
        binding: materialization.binding,
        provenanceArtifactDigest
      });
      const publishedCache = await inspectRunnerOciCache(cwd);
      if (publishedCache.state !== 'matching') fail('published OCI cache has no exact readback');
      await projectRunnerOciLayout(publishedCache, session);
      present = await inspectImage(session);
      if (present === null) fail('runner image build has no exact readback');
    }
    if (present === null) fail('runner image materialization has no exact readback');
    assertLocalGitHubActionsRunnerImageIdentity(present);
  } finally {
    if (materialization !== null) {
      try {
        retireLocalGitHubActionsRunnerOciCandidate(cache!.directory, materialization.binding);
      } finally {
        materialization.lease.release();
      }
    }
  }
}

export interface LocalGitHubActionsRunnerToolchainMaterialization {
  readonly specDigest: `sha256:${string}`;
  readonly layoutPath: string;
  readonly runtimeManifestDigest: typeof LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST;
  readonly dockerProjectionDigest: typeof LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID;
  readonly provenanceArtifactDigest: `sha256:${string}`;
}

export async function ensureLocalGitHubActionsRunnerToolchainMaterialization(
  input: Readonly<{
    repositoryRoot: string;
    containerEngineSession: ContainerEngineSession;
  }>
): Promise<LocalGitHubActionsRunnerToolchainMaterialization> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  if (input.containerEngineSession.cwd !== repositoryRoot) {
    fail('toolchain materialization Container Engine session has another cwd');
  }
  await ensureImage(repositoryRoot, input.containerEngineSession);
  const cache = await inspectRunnerOciCache(repositoryRoot);
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

function providerResourceState(value: unknown): LocalGitHubActionsProviderResourceState {
  if (value !== 'uncreated' && value !== 'present' && value !== 'absent') {
    fail('provider resource state is invalid');
  }
  return value;
}

function providerLifecycle(value: unknown): LocalGitHubActionsProviderLifecycle {
  if (value !== 'provisioning' && value !== 'active' && value !== 'teardown' && value !== 'terminal') {
    fail('provider lifecycle is invalid');
  }
  return value;
}

function instanceName(providerName: string, role: LocalGitHubActionsRunnerRole): string {
  return runnerName(`${providerName}-${role}`);
}

async function waitForRunner(
  repository: string,
  name: string,
  cwd: string,
  maximumAttempts = 30
): Promise<Record<string, unknown>> {
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const matches = (await listRepositoryRunners(repository, cwd))
      .filter((runner) => runner.name === name);
    if (matches.length > 1) fail('multiple GitHub runners have the exact operation name');
    if (matches.length === 1 && matches[0]!.status === 'online') return matches[0]!;
    if (attempt < maximumAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  fail('runner did not become online within the bounded join window');
}

async function startRunnerInstance(input: Readonly<{
  cwd: string;
  cursor: LocalRunnerStateCursor;
  containerEngineSession: ContainerEngineSession;
  role: LocalGitHubActionsRunnerRole;
  cpus: number;
  memory: string;
}>): Promise<LocalGitHubActionsRunnerInstance> {
  const retained = input.cursor.state.instances.find((instance) => instance.role === input.role)!;
  const name = retained.name;
  if (retained.containerState !== 'uncreated' || retained.runnerState !== 'uncreated') {
    fail(`runner state role ${input.role} is not at its initial generation`);
  }
  if ((await listRepositoryRunners(input.cursor.state.repository, input.cwd)).some((runner) => runner.name === name)) {
    fail(`GitHub runner ${name} already exists and is preserved`);
  }
  if (await inspectContainerByName(name, input.containerEngineSession) !== null) {
    fail(`Docker container ${name} already exists and is preserved`);
  }
  const args = [
    'run', '--detach', '--init', '--name', name,
    '--restart', 'unless-stopped', '--entrypoint', '/bin/bash', '--user', '0',
    '--cap-drop', 'ALL',
    ...(input.role === 'sut'
      ? SUT_CAPABILITIES.flatMap((capability) => ['--cap-add', capability])
      : []),
    '--security-opt', 'no-new-privileges:true',
    '--pids-limit', String(ENVIRONMENT.runtime.resources[input.role].pids),
    '--memory', input.role === 'sut' ? SUT_MEMORY : input.memory,
    '--cpus', String(input.role === 'sut' ? SUT_CPUS : input.cpus),
    '--label', `sec.local-runner.schema=${LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA}`,
    '--label', `sec.local-runner.repository=${input.cursor.state.repository}`,
    '--label', `sec.local-runner.provider-name=${input.cursor.state.providerName}`,
    '--label', `sec.local-runner.instance-name=${name}`,
    '--label', `sec.local-runner.role=${input.role}`,
    '--label', `sec.local-runner.operation-label=${input.cursor.state.operationLabel}`,
    '--label', `sec.local-runner.container-init=${LOCAL_GITHUB_ACTIONS_RUNNER_CONTAINER_INIT_CAPABILITY}`,
    '--label', `sec.local-runner.image-id=${LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID}`,
    '--env', 'RUNNER_ALLOW_RUNASROOT=1', '--env', `RUNNER_NAME=${name}`,
    LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID,
    '-ceu', LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_SCRIPT
  ];
  const container = await runContainerEngineOperation(input.containerEngineSession, {
    kind: 'container-run', arguments: args.slice(1)
  }, {});
  const containerId = container.stdout.toString('utf8').trim();
  if (!/^[0-9a-f]{64}$/u.test(containerId)) fail('Docker returned an invalid container identity');
  const byId = await inspectContainerById(containerId, input.containerEngineSession);
  const byName = await inspectContainerByName(name, input.containerEngineSession);
  if (byId === null || byName === null || byId.Id !== containerId || byName.Id !== containerId) {
    fail('Docker returned container identity differs from exact ID/name readback');
  }
  assertOwnedContainer(byId, {
    repository: input.cursor.state.repository,
    providerName: input.cursor.state.providerName,
    instanceName: name,
    role: input.role,
    containerId,
    operationLabel: input.cursor.state.operationLabel
  });
  advanceLocalRunnerState(input.cursor, {
    instances: withStateInstance(input.cursor.state, input.role, {
      containerId,
      containerState: 'present'
    })
  });
  const token = await createRunnerRegistrationToken(input.cursor.state.repository, input.cwd);
  const configureScript = [
    'IFS= read -r RUNNER_TOKEN',
    'RUNNER_TOKEN="$(printf \'%s\' "$RUNNER_TOKEN" | tr -d \'\\r\\n\')"',
    `./config.sh --url https://${LOCAL_GITHUB_ACTIONS_GITHUB_HOST}/${input.cursor.state.repository} --token "$RUNNER_TOKEN" `
      + '--unattended --name "$RUNNER_NAME" '
      + `--labels ${LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL},`
      + `${LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS[input.role]},${input.cursor.state.operationLabel} --work _work`,
    'unset RUNNER_TOKEN'
  ].join('\n');
  await runContainerEngineOperation(input.containerEngineSession, {
    kind: 'container-exec',
    arguments: ['--interactive', containerId, 'bash', '-lc', configureScript]
  }, {
    input: Buffer.from(`${token}\n`, 'utf8')
  });
  const configuredMarkerScript = [
    'set -euo pipefail',
    `marker=${JSON.stringify(LOCAL_GITHUB_ACTIONS_RUNNER_CONFIGURED_MARKER)}`,
    'temporary="${marker}.new-$$"',
    'trap \'rm -f -- "$temporary"\' EXIT',
    '(umask 077; set -C; printf \'configured\\n\' > "$temporary")',
    'mv -T -- "$temporary" "$marker"',
    'trap - EXIT',
    '[ -f "$marker" ] && [ ! -L "$marker" ]'
  ].join('\n');
  await runContainerEngineOperation(input.containerEngineSession, {
    kind: 'container-exec', arguments: [containerId, 'bash', '-ceu', configuredMarkerScript]
  }, {});
  const runner = await waitForRunner(input.cursor.state.repository, name, input.cwd, 60);
  const runnerId = assertOwnedLocalGitHubActionsRunner(runner, {
    name,
    role: input.role,
    operationLabel: input.cursor.state.operationLabel
  });
  advanceLocalRunnerState(input.cursor, {
    instances: withStateInstance(input.cursor.state, input.role, {
      runnerId,
      runnerState: 'present'
    })
  });
  return runnerInstance({
    role: input.role,
    roleLabel: LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS[input.role],
    name,
    runnerId,
    containerId,
    containerName: name
  });
}

async function startLocalGitHubActionsProvider(input: Readonly<{
  cwd: string;
  repository: string;
  name: string;
  cpus?: number;
  memory?: string;
}>): Promise<LocalGitHubActionsRunnerState> {
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.name);
  const cpus = input.cpus ?? DEFAULT_CPUS;
  const memory = input.memory ?? DEFAULT_MEMORY;
  if (!Number.isSafeInteger(cpus) || cpus < 1 || cpus > 64) fail('cpus is invalid');
  if (!/^[1-9][0-9]{0,2}[gGmM]$/u.test(memory)) fail('memory is invalid');
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentity(context.repositoryRoot, repository);
  return await withRunnerLifecycleLease(context.commonDirectory, async () => {
    if (readStateProjection(context.commonDirectory) !== null) {
      fail(`active lifecycle state already exists at ${statePath(context.commonDirectory)}`);
    }
    const containerEngineOperation = await openLocalContainerEngineSession({
      cwd: context.repositoryRoot,
      intent: 'start-provider',
      availability: 'ensure-started',
      subject: Object.freeze({ repository, providerName, cpus, memory })
    });
    const containerEngineSession = containerEngineOperation.session;
    let primaryPresent = false;
    let primary: unknown;
    try {
      const dockerEndpoint = containerEngineSession.endpoint;
      const githubEndpoint = await observeGitHubEndpointIdentity(context.repositoryRoot, repository);
      const exactNames = new Set(LOCAL_GITHUB_ACTIONS_RUNNER_ROLES.map((role) =>
        instanceName(providerName, role)));
      const existingProfile = (await listRepositoryRunners(repository, context.repositoryRoot))
        .filter((runner) => isProviderProfileEligibleRunner(runner)
          || exactNames.has(String(runner.name)));
      const existingProfileContainers = await listProviderProfileContainers(
        repository, containerEngineSession
      );
      const existingNamedContainers: Array<Record<string, unknown> | null> = [];
      for (const name of exactNames) {
        existingNamedContainers.push(await inspectContainerByName(name, containerEngineSession));
      }
      if (existingProfile.length !== 0 || existingProfileContainers.length !== 0
          || existingNamedContainers.some((container) => container !== null)) {
        fail('profile runners or containers exist outside the new local lifecycle and are preserved');
      }
      await ensureImage(context.repositoryRoot, containerEngineSession);
      const startedAt = new Date().toISOString();
      const retainedOperationLabel = `sec-operation-${randomBytes(32).toString('hex')}`;
      const initial = createLocalGitHubActionsRunnerState({
        repository,
        repositoryRoot: context.repositoryRoot,
        commonDirectory: context.commonDirectory,
        providerName,
        operationLabel: retainedOperationLabel,
        lifecycle: 'provisioning',
        dockerEndpoint,
        githubEndpoint,
        instances: LOCAL_GITHUB_ACTIONS_RUNNER_ROLES.map((role) => ({
          role,
          roleLabel: LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS[role],
          name: instanceName(providerName, role),
          containerId: null,
          containerState: 'uncreated',
          runnerId: null,
          runnerState: 'uncreated'
        })),
        startedAt
      });
      publishState(context.commonDirectory, initial);
      const cursor: LocalRunnerStateCursor = {
        state: initial,
        commonDirectory: context.commonDirectory
      };
      try {
        for (const role of LOCAL_GITHUB_ACTIONS_RUNNER_ROLES) {
          await startRunnerInstance({
            cwd: context.repositoryRoot,
            cursor,
            containerEngineSession,
            role,
            cpus,
            memory
          });
        }
        advanceLocalRunnerState(cursor, { lifecycle: 'active' });
        const instances = activeInstancesFromState(cursor.state);
        assertExactLocalGitHubActionsRunnerProfileInventory({
          runners: await listRepositoryRunners(repository, context.repositoryRoot),
          instances,
          operationLabel: retainedOperationLabel
        });
        assertExactLocalGitHubActionsRunnerProfileContainers({
          containers: await listProviderProfileContainers(repository, containerEngineSession),
          instances,
          repository,
          providerName,
          operationLabel: retainedOperationLabel
        });
        return cursor.state;
      } catch (error) {
        const cleanupErrors: unknown[] = [];
        try {
          await assertGitHubEndpointIdentity(cursor.state.githubEndpoint, context.repositoryRoot);
          if (cursor.state.lifecycle !== 'teardown') {
            advanceLocalRunnerState(cursor, { lifecycle: 'teardown' });
          }
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        for (const role of [...LOCAL_GITHUB_ACTIONS_RUNNER_ROLES].reverse()) {
          try {
            if (cleanupErrors.length === 0) {
              await cleanupStateInstance(cursor, context.repositoryRoot, role, containerEngineSession);
            }
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        }
        if (cleanupErrors.length === 0) {
          try {
            await assertNoForeignStateInventory(cursor.state, context.repositoryRoot, containerEngineSession, true);
            advanceLocalRunnerState(cursor, { lifecycle: 'terminal' });
            deleteStateProjection(context.commonDirectory, cursor.state);
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError([error, ...cleanupErrors], 'provider start and exact cleanup both failed');
        }
        throw error;
      }
    } catch (error) {
      primaryPresent = true;
      primary = error;
    } finally {
      await settlePhysicalResourcesAsync({
        ...(primaryPresent ? {
          primary: { label: 'local-runner-start', error: primary }
        } : {}),
        cleanup: [{
          label: 'local-runner-start-container-engine',
          settle: async () => { await containerEngineOperation.close(); }
        }]
      });
    }
    if (primaryPresent) throw primary;
    fail('provider start did not produce a terminal result');
  });
}
function activeInstancesFromState(
  state: LocalGitHubActionsRunnerState
): readonly LocalGitHubActionsRunnerInstance[] {
  if (state.lifecycle !== 'active') fail('runner lifecycle is not active');
  return Object.freeze(state.instances.map((instance) => {
    if (instance.containerState !== 'present' || instance.runnerState !== 'present'
        || instance.containerId === null || instance.runnerId === null) {
      fail('active runner state does not retain a complete instance identity');
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

async function assertNoForeignStateInventory(
  state: LocalGitHubActionsRunnerState,
  cwd: string,
  session: ContainerEngineSession,
  allowLegacyDetachedRunnerDuringTeardown = false
): Promise<void> {
  const runners = await listRepositoryRunners(state.repository, cwd);
  const candidates = runners.filter((runner) => isProviderProfileEligibleRunner(runner)
    || runnerHasLabel(runner, state.operationLabel)
    || state.instances.some((instance) => runner.name === instance.name
      || (instance.runnerId !== null && runner.id === instance.runnerId)));
  for (const runner of candidates) {
    const retained = state.instances.find((instance) =>
      instance.name === runner.name || (instance.runnerId !== null && instance.runnerId === runner.id));
    if (retained === undefined || retained.runnerState !== 'present' || retained.runnerId === null
        || retained.runnerId !== runner.id || retained.name !== runner.name) {
      fail('GitHub runner inventory contains an uncommitted or replaced identity and it is preserved');
    }
    assertOwnedLocalGitHubActionsRunner(runner, {
      name: retained.name,
      role: retained.role,
      operationLabel: state.operationLabel,
      runnerId: retained.runnerId
    });
  }

  const containers = await listProviderProfileContainers(
    state.repository, session
  );
  for (const container of containers) {
    const retained = state.instances.find((instance) =>
      instance.containerId === container.Id || container.Name === '/' + instance.name);
    if (retained === undefined || retained.containerState !== 'present' || retained.containerId === null
        || retained.containerId !== container.Id || container.Name !== '/' + retained.name) {
      fail('Docker inventory contains an uncommitted or replaced identity and it is preserved');
    }
    assertOwnedContainer(container, {
      repository: state.repository,
      providerName: state.providerName,
      instanceName: retained.name,
      role: retained.role,
      containerId: retained.containerId,
      operationLabel: state.operationLabel,
      ...(allowLegacyDetachedRunnerDuringTeardown
        ? { allowLegacyDetachedRunnerDuringTeardown: true as const }
        : {})
    });
  }
  for (const retained of state.instances) {
    const byName = await inspectContainerByName(retained.name, session);
    if (byName !== null && (retained.containerState !== 'present'
        || retained.containerId !== byName.Id)) {
      fail('Docker retained name points to an uncommitted or replaced identity and it is preserved');
    }
  }
}

async function convergeStateToTerminal(
  cursor: LocalRunnerStateCursor,
  cwd: string,
  session: ContainerEngineSession
): Promise<void> {
  await assertGitHubEndpointIdentity(cursor.state.githubEndpoint, cwd);
  await assertNoForeignStateInventory(cursor.state, cwd, session, true);
  if (cursor.state.lifecycle === 'terminal') return;
  if (cursor.state.lifecycle !== 'teardown') {
    advanceLocalRunnerState(cursor, { lifecycle: 'teardown' });
  }
  for (const role of [...LOCAL_GITHUB_ACTIONS_RUNNER_ROLES].reverse()) {
    await cleanupStateInstance(cursor, cwd, role, session);
  }
  await assertNoForeignStateInventory(cursor.state, cwd, session, true);
  advanceLocalRunnerState(cursor, { lifecycle: 'terminal' });
}

async function stopLocalGitHubActionsProvider(input: Readonly<{
  cwd: string;
}>): Promise<Readonly<{
  schema: 'sec-local-github-actions-provider-stop-v4';
  repository: string;
  providerName: string;
  runnerCount: number;
  runnersAbsent: true;
  containersAbsent: true;
  localStateAbsent: true;
  imageRetained: true;
}>> {
  const context = await resolveRepositoryContext(input.cwd);
  return await withRunnerLifecycleLease(context.commonDirectory, async () => {
    const projection = readStateProjection(context.commonDirectory);
    if (projection === null) fail('no local lifecycle state exists at ' + statePath(context.commonDirectory));
    const state = projection.state;
    if (state.repositoryRoot !== context.repositoryRoot
        || state.commonDirectory !== context.commonDirectory) {
      fail('state repository identity drifted');
    }
    await assertOriginRepositoryIdentity(context.repositoryRoot, state.repository);
    const containerEngineOperation = await openLocalContainerEngineSession({
      cwd: context.repositoryRoot,
      intent: 'stop-provider',
      availability: 'observe',
      subject: Object.freeze({
        repository: state.repository,
        providerName: state.providerName,
        stateDigest: state.stateDigest
      }),
      expectedEndpoint: state.dockerEndpoint
    });
    try {
      const cursor: LocalRunnerStateCursor = {
        state,
        commonDirectory: context.commonDirectory
      };
      await convergeStateToTerminal(cursor, context.repositoryRoot, containerEngineOperation.session);
      deleteStateProjection(context.commonDirectory, cursor.state);
      return Object.freeze({
        schema: 'sec-local-github-actions-provider-stop-v4' as const,
        repository: state.repository,
        providerName: state.providerName,
        runnerCount: state.instances.length,
        runnersAbsent: true as const,
        containersAbsent: true as const,
        localStateAbsent: true as const,
        imageRetained: true as const
      });
    } finally {
      await containerEngineOperation.close();
    }
  });
}

async function recoverLocalGitHubActionsProvider(input: Readonly<{
  cwd: string;
  repository: string;
  name: string;
}>): Promise<Readonly<{
  schema: 'sec-local-github-actions-provider-recovery-v4';
  repository: string;
  providerName: string;
  runnersAbsent: true;
  containersAbsent: true;
  localStateAbsent: true;
}>> {
  const repository = repositoryName(input.repository);
  const providerName = providerBaseName(input.name);
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentity(context.repositoryRoot, repository);
  return await withRunnerLifecycleLease(context.commonDirectory, async () => {
    const projection = readStateProjection(context.commonDirectory);
    const containerEngineOperation = await openLocalContainerEngineSession({
      cwd: context.repositoryRoot,
      intent: 'recover-provider',
      availability: 'observe',
      subject: Object.freeze({
        repository,
        providerName,
        stateDigest: projection?.state.stateDigest ?? null
      }),
      ...(projection === null ? {} : { expectedEndpoint: projection.state.dockerEndpoint })
    });
    let primaryPresent = false;
    let primary: unknown;
    try {
      if (projection === null) {
        await observeGitHubEndpointIdentity(context.repositoryRoot, repository);
        const exactNames = new Set(LOCAL_GITHUB_ACTIONS_RUNNER_ROLES.map((role) =>
          instanceName(providerName, role)));
        const runners = await listRepositoryRunners(repository, context.repositoryRoot);
        const containers = await listProviderProfileContainers(repository, containerEngineOperation.session);
        const namedContainers: Array<Record<string, unknown> | null> = [];
        for (const name of exactNames) {
          namedContainers.push(await inspectContainerByName(name, containerEngineOperation.session));
        }
        if (runners.some((runner) => exactNames.has(String(runner.name))
            || isProviderProfileEligibleRunner(runner)) || containers.length !== 0
            || namedContainers.some((container) => container !== null)) {
          fail('provider residue exists without retained exact IDs and is preserved');
        }
      } else {
        const state = projection.state;
        if (state.repositoryRoot !== context.repositoryRoot
            || state.commonDirectory !== context.commonDirectory) {
          fail('state repository identity drifted');
        }
        if (state.repository !== repository || state.providerName !== providerName) {
          fail('local lifecycle belongs to another operation and is preserved');
        }
        const cursor: LocalRunnerStateCursor = {
          state,
          commonDirectory: context.commonDirectory
        };
        await convergeStateToTerminal(cursor, context.repositoryRoot, containerEngineOperation.session);
        deleteStateProjection(context.commonDirectory, cursor.state);
      }
      return Object.freeze({
        schema: 'sec-local-github-actions-provider-recovery-v4' as const,
        repository,
        providerName,
        runnersAbsent: true as const,
        containersAbsent: true as const,
        localStateAbsent: true as const
      });
    } catch (error) {
      primaryPresent = true;
      primary = error;
    } finally {
      await settlePhysicalResourcesAsync({
        ...(primaryPresent ? {
          primary: { label: 'local-runner-recovery', error: primary }
        } : {}),
        cleanup: [{
          label: 'local-runner-recovery-container-engine',
          settle: async () => { await containerEngineOperation.close(); }
        }]
      });
    }
    if (primaryPresent) throw primary;
    fail('provider recovery did not produce a terminal result');
  });
}

async function observeLocalGitHubActionsProvider(input: Readonly<{
  cwd: string;
}>) {
  const context = await resolveRepositoryContext(input.cwd);
  const repository = await assertOriginRepositoryIdentity(context.repositoryRoot);
  const projection = readStateProjection(context.commonDirectory);
  const containerEngineOperation = await openLocalContainerEngineSession({
    cwd: context.repositoryRoot,
    intent: 'observe-provider',
    availability: 'observe',
    subject: Object.freeze({
      repository,
      stateDigest: projection?.state.stateDigest ?? null
    }),
    ...(projection === null ? {} : { expectedEndpoint: projection.state.dockerEndpoint })
  });
  const containerEngineSession = containerEngineOperation.session;
  try {
  if (projection === null) {
    await observeGitHubEndpointIdentity(context.repositoryRoot, repository);
    const profileRunners = (await listRepositoryRunners(repository, context.repositoryRoot))
      .filter(isProviderProfileEligibleRunner);
    const profileContainers = await listProviderProfileContainers(
      repository, containerEngineSession
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
      reason: 'objects-without-local-state',
      profileRunnerCount: profileRunners.length,
      profileContainerCount: profileContainers.length
    });
  }

  const state = projection.state;
  if (state.repositoryRoot !== context.repositoryRoot
      || state.commonDirectory !== context.commonDirectory
      || state.repository.toLowerCase() !== repository.toLowerCase()) {
    fail('local lifecycle repository identity differs from origin and is preserved');
  }
  await assertGitHubEndpointIdentity(state.githubEndpoint, context.repositoryRoot);
  await assertNoForeignStateInventory(state, context.repositoryRoot, containerEngineSession);

  if (state.lifecycle !== 'active') {
    return Object.freeze({
      status: 'residue' as const,
      statePath: statePath(context.commonDirectory),
      repository,
      localStatePresent: true,
      lifecycle: state.lifecycle,
      stateDigest: state.stateDigest
    });
  }
  const instances = activeInstancesFromState(state);
  const runners = await listRepositoryRunners(repository, context.repositoryRoot);
  assertExactLocalGitHubActionsRunnerProfileInventory({
    runners,
    instances,
    operationLabel: state.operationLabel
  });
  const containers = await listProviderProfileContainers(
    repository, containerEngineSession
  );
  assertExactLocalGitHubActionsRunnerProfileContainers({
    containers,
    instances,
    repository,
    providerName: state.providerName,
    operationLabel: state.operationLabel
  });
  const image = await inspectImage(containerEngineSession);
  if (image !== null) assertLocalGitHubActionsRunnerImageIdentity(image);
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
    localStatePresent: true,
    imagePresent: image !== null,
    instances: Object.freeze(observations)
  });
  } finally {
    await containerEngineOperation.close();
  }
}

async function retireSupersededLocalGitHubActionsRunnerImage(input: Readonly<{
  cwd: string;
  imageId: string;
}>): Promise<Readonly<{
  schema: 'sec-local-github-actions-image-retirement-v3';
  imageId: string;
  replacementImageId: typeof LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS[number]['replacementImageId'];
  decision: string;
  zeroContainerReferences: true;
  imageAbsent: true;
}>> {
  const decision = LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS.find(
    (candidate) => candidate.imageId === input.imageId
  );
  if (decision === undefined) fail('image is not covered by a canonical superseded decision');
  const context = await resolveRepositoryContext(input.cwd);
  await assertOriginRepositoryIdentity(context.repositoryRoot);
  if (readStateProjection(context.commonDirectory) !== null) {
    fail('image retirement is blocked while the local runner lifecycle is active');
  }
  const containerEngineOperation = await openLocalContainerEngineSession({
    cwd: context.repositoryRoot,
    intent: 'retire-image',
    availability: 'observe',
    subject: Object.freeze({
      imageId: decision.imageId,
      replacementImageId: decision.replacementImageId,
      decision: decision.decision
    })
  });
  const containerEngineSession = containerEngineOperation.session;
  try {
  const replacement = await inspectImageById(
    decision.replacementImageId,
    containerEngineSession
  );
  if (replacement === null) fail('superseding frozen image is absent');
  assertLocalGitHubActionsRunnerReplacementImageIdentity(replacement, decision.replacementImageId);
  const references = await listContainerIdentityRows(containerEngineSession, [
    '--filter', `ancestor=${decision.imageId}`
  ]);
  if (references.length !== 0) {
    fail('superseded image still has container references and is preserved');
  }
  if (await inspectImageById(decision.imageId, containerEngineSession) !== null) {
    await runContainerEngineOperation(containerEngineSession, {
      kind: 'image-remove', arguments: [decision.imageId]
    }, {});
  }
  if (await inspectImageById(decision.imageId, containerEngineSession) !== null
      || (await listContainerIdentityRows(containerEngineSession, [
        '--filter', `ancestor=${decision.imageId}`
      ])).length !== 0) {
    fail('superseded image retirement readback is not absent');
  }
  return Object.freeze({
    schema: 'sec-local-github-actions-image-retirement-v3' as const,
    imageId: decision.imageId,
    replacementImageId: decision.replacementImageId,
    decision: decision.decision,
    zeroContainerReferences: true as const,
    imageAbsent: true as const
  });
  } finally {
    await containerEngineOperation.close();
  }
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
    const state = await startLocalGitHubActionsProvider({
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
    process.stdout.write(`${JSON.stringify(await observeLocalGitHubActionsProvider({ cwd }), null, 2)}\n`);
    return;
  }
  if (command === 'stop') {
    if (args.includes('--remove-image')) fail('active image retirement is not an ordinary stop authority');
    process.stdout.write(`${JSON.stringify(await stopLocalGitHubActionsProvider({ cwd }), null, 2)}\n`);
    return;
  }
  if (command === 'recover') {
    const repository = option(args, '--repository');
    const name = option(args, '--name');
    if (repository === undefined || name === undefined) fail('recover requires --repository and --name');
    process.stdout.write(`${JSON.stringify(await recoverLocalGitHubActionsProvider({
      cwd,
      repository,
      name
    }), null, 2)}\n`);
    return;
  }
  if (command === 'retire-superseded-image') {
    const imageId = option(args, '--image-id');
    if (imageId === undefined) fail('retire-superseded-image requires --image-id');
    process.stdout.write(`${JSON.stringify(await retireSupersededLocalGitHubActionsRunnerImage({
      cwd,
      imageId
    }), null, 2)}\n`);
    return;
  }
  fail('usage: start --repository owner/name --name provider-name [--workspace path] [--cpus n] [--memory 12g] | status [--workspace path] | stop [--workspace path] | recover --repository owner/name --name provider-name [--workspace path] | retire-superseded-image --image-id sha256:... [--workspace path]');
}

if (import.meta.main) await main();
