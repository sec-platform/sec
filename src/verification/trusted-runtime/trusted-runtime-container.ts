import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';

import {
  createMainHealthRevision,
  parseMainHealthLedger,
  type MainHealthLedger
} from '../../control/main-health/contract.ts';
import { DEV_RUNNER_ENTRYPOINT_PATH } from '../../development/runner/contract.ts';
import type {
  ContainerEngineOperation,
  ContainerEngineOperationOptions,
  ContainerEngineOperationScope,
  ContainerEngineSession
} from '../../external-capabilities/docker/contract/container-engine-session.ts';
import {
  parseDockerEndpointIdentity,
  type DockerEndpointIdentity
} from '../../external-capabilities/docker/contract/daemon.ts';
import {
  openContainerEngineSession
} from '../../external-capabilities/docker/runtime/container-engine-session.ts';
import { isolatedGitChildEnvironment } from '../../external-capabilities/git-read/runtime/session.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../external-capabilities/linux-verification/contract.ts';
import { acquirePhysicalMutationLease } from '../../runtime-state/physical/runtime/mutation-lease.ts';
import { type NoFollowDirectoryTreeEntry } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { runCommand } from '../../runtime-state/physical/runtime/process.ts';
import { resolveSecRuntimeStateForRepository } from '../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority } from '../../runtime-state/workspace-state/physical-authority.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecProviderSettlementSet,
  compileSecSemanticOperationPlan,
  issueSecNormalDomainReadbackReceipt,
  issueSecNormalOwnerTerminalJoinReceipt,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest,
  type SecOwnerTerminalJoinReceipt,
  type SecProviderSettlementReceipt
} from '../../system-architecture/operation/semantic.ts';
import { TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH } from '../../toolchain/typescript/canary.ts';
import { createVerificationActionKey, createVerificationActionPlan, encodeVerificationActionData, issueVerificationActionTerminalSettlement, type VerificationActionKey, type VerificationActionKeyDigest, type VerificationActionPlan } from '../action/contract/action.ts';
import { createCiVerificationLocalExecutionEnvironment, type CiVerificationExecutionEnvironment } from '../action/contract/ci.ts';
import { VerificationActionRunner } from '../action/runner.ts';
import { type CodexDevelopmentVerificationEvidenceV4 } from '../ci/contract/evidence.ts';
import { CI_VERIFICATION_WORKFLOW_PATH } from '../ci/contract/revision.ts';
import {
  createBuildxRawJsonProgressAdmission,
  ensureLocalGitHubActionsRunnerToolchainMaterialization,
  type LocalGitHubActionsRunnerToolchainMaterialization
} from '../ci/runtime/local-github-actions-runner.ts';
import type { VerificationSessionHostedEnvelope } from '../ci/runtime/verification-session-runtime.ts';

const ENVIRONMENT = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
export const TRUSTED_RUNTIME_CONTAINER_SCHEMA = ENVIRONMENT.trustedRuntime.imageSchema;
export const TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA =
  'sec-trusted-runtime-main-health-receipt-v2' as const;
export const TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_SCHEMA =
  'sec-trusted-runtime-main-health-supersession-v2' as const;
export const TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_INTENT_SCHEMA =
  'sec-trusted-runtime-main-health-supersession-intent-v2' as const;
export const TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_PERMIT_SCHEMA =
  'sec-trusted-runtime-main-health-supersession-permit-v2' as const;
export const TRUSTED_RUNTIME_MAIN_HEALTH_BASELINE_OBSERVATION_SCHEMA =
  'sec-trusted-runtime-main-health-baseline-observation-v2' as const;
export const TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA =
  'sec-trusted-runtime-dependency-cache-v1' as const;
export const TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA =
  'sec-trusted-runtime-dependency-cache-volume-v1' as const;
export const TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE =
  '.sec-derived-cache.json' as const;
export const TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH =
  '/tmp/sec-hosted-dependency-home/.bun/install/cache' as const;
export const TRUSTED_RUNTIME_CONTAINER_IMAGE = ENVIRONMENT.trustedRuntime.imageName;
export const TRUSTED_RUNTIME_CONTAINER_IMAGE_ID = ENVIRONMENT.trustedRuntime.imageDigest;
export const TRUSTED_RUNTIME_CONTAINER_BUN_ARCHIVE_SHA256 =
  ENVIRONMENT.trustedRuntime.bunArchiveDigest;
export const TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID = ENVIRONMENT.image.dockerProjectionDigest;
export const TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT:
CiVerificationExecutionEnvironment = createCiVerificationLocalExecutionEnvironment({
  os: 'linux',
  arch: 'x64',
  bunVersion: ENVIRONMENT.trustedRuntime.bunVersion
});

export interface TrustedRuntimeImageBuildPlan {
  readonly args: readonly string[];
  readonly absoluteTimeoutMs: number;
  readonly stallTimeoutMs: number;
}

export function createTrustedRuntimeImageBuildPlan(
  dockerfile: string,
  toolchain: LocalGitHubActionsRunnerToolchainMaterialization
): TrustedRuntimeImageBuildPlan {
  if (!path.isAbsolute(dockerfile)) fail('trusted runtime Dockerfile path must be absolute');
  if (!path.isAbsolute(toolchain.layoutPath)
      || toolchain.runtimeManifestDigest !== ENVIRONMENT.image.runtimeContentDigest
      || toolchain.dockerProjectionDigest !== ENVIRONMENT.image.dockerProjectionDigest) {
    fail('trusted runtime toolchain materialization is invalid');
  }
  const layoutUriPath = path.resolve(toolchain.layoutPath).split(path.sep).join('/');
  return Object.freeze({
    args: Object.freeze([
      'buildx', 'build', '--pull=false', '--network', 'none', '--provenance=false',
      '--build-context', `runner=oci-layout://${layoutUriPath}@${toolchain.runtimeManifestDigest}`,
      '--build-arg', `SEC_TRUSTED_RUNTIME_SCHEMA=${ENVIRONMENT.trustedRuntime.imageSchema}`,
      '--build-arg', `SEC_RUNNER_IMAGE_ID=${ENVIRONMENT.image.dockerProjectionDigest}`,
      '--build-arg', `SEC_BUN_ARCHIVE_URL=${ENVIRONMENT.trustedRuntime.bunArchiveUrl}`,
      '--build-arg', `SEC_BUN_ARCHIVE_DIGEST=${ENVIRONMENT.trustedRuntime.bunArchiveDigest}`,
      '--build-arg', `SEC_BUN_VERSION=${ENVIRONMENT.trustedRuntime.bunVersion}`,
      '--tag', TRUSTED_RUNTIME_CONTAINER_IMAGE,
      '--file', dockerfile,
      '--load',
      `--progress=${ENVIRONMENT.provider.progressMode}`,
      import.meta.dir
    ]),
    absoluteTimeoutMs: ENVIRONMENT.provider.timeoutsMs.projectionAbsolute,
    stallTimeoutMs: ENVIRONMENT.provider.timeoutsMs.projectionStall
  });
}

type Digest = `sha256:${string}`;

export const TRUSTED_RUNTIME_MAIN_HEALTH_ACTIONS = Object.freeze([
  Object.freeze({ id: 'affected-closure', argv: Object.freeze(['bun', 'run', 'check:affected']) })
] as const);
export type TrustedRuntimeMainHealthActionId =
  typeof TRUSTED_RUNTIME_MAIN_HEALTH_ACTIONS[number]['id'];

export interface TrustedRuntimeMainHealthBaselineObservation {
  readonly schema: typeof TRUSTED_RUNTIME_MAIN_HEALTH_BASELINE_OBSERVATION_SCHEMA;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly baselineSha: string;
  readonly baselineTreeSha: string;
  readonly observationDigest: Digest;
}

const TRUSTED_RUNTIME_MUTABLE_ROOT = '/sec-runtime' as const;
const TRUSTED_RUNTIME_CANDIDATE_BUNDLE = '/candidate.bundle' as const;
export const TRUSTED_RUNTIME_TEST_TMPFS_TARGET = '/tmp' as const;
export const TRUSTED_RUNTIME_TEST_TMPFS_SPEC =
  `${TRUSTED_RUNTIME_TEST_TMPFS_TARGET}:rw,exec,nosuid,nodev,size=2g` as const;
export const TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC =
  `${TRUSTED_RUNTIME_MUTABLE_ROOT}:rw,noexec,nosuid,nodev,size=10g,mode=0711,uid=1000,gid=1000` as const;
const TRUSTED_RUNTIME_TRUSTED_TREE = `${TRUSTED_RUNTIME_MUTABLE_ROOT}/trusted`;
const TRUSTED_RUNTIME_WORKSPACE = `${TRUSTED_RUNTIME_MUTABLE_ROOT}/workspace`;
const TRUSTED_RUNTIME_OUTPUT = `${TRUSTED_RUNTIME_MUTABLE_ROOT}/output`;
export const TRUSTED_RUNTIME_STATE_ENVIRONMENT = Object.freeze({
  SEC_STATE_HOME: `${TRUSTED_RUNTIME_OUTPUT}/state`,
  SEC_CACHE_HOME: `${TRUSTED_RUNTIME_OUTPUT}/cache`
});
export const TRUSTED_RUNTIME_STATE_ENVIRONMENT_DIGEST =
  digestValue(TRUSTED_RUNTIME_STATE_ENVIRONMENT);

export function createTrustedRuntimeCommandEnvironmentArgs(
  environment: Readonly<Record<string, string>>
): readonly string[] {
  for (const key of Object.keys(TRUSTED_RUNTIME_STATE_ENVIRONMENT)) {
    if (key in environment) fail(`trusted runtime command environment cannot replace ${key}`);
  }
  return Object.freeze(Object.entries({
    ...environment,
    ...TRUSTED_RUNTIME_STATE_ENVIRONMENT
  })
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, value]) => ['--env', `${name}=${value}`]));
}

export const TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST = digestValue(Object.freeze({
  schema: 'sec-trusted-runtime-main-health-plan-v2',
  actions: TRUSTED_RUNTIME_MAIN_HEALTH_ACTIONS,
  expansion: 'affected-gate-actionkeys-v1',
  stateEnvironmentDigest: TRUSTED_RUNTIME_STATE_ENVIRONMENT_DIGEST
}));

const TRUSTED_RUNTIME_MAIN_HEALTH_GATE_COMMANDS = Object.freeze({
  'imports:check': Object.freeze(['bun', 'run', 'imports:check']),
  typecheck: Object.freeze(['bun', 'run', 'typecheck']),
  'docs:doctor': Object.freeze(['bun', 'run', 'docs:doctor']),
  'test:affected': Object.freeze(['bun', 'run', 'test:affected'])
} as const);

type TrustedRuntimeMainHealthGateId = keyof typeof TRUSTED_RUNTIME_MAIN_HEALTH_GATE_COMMANDS;

type TrustedRuntimeMainHealthAffectedPlan = Readonly<{
  planDigest: Digest;
  gates: readonly Readonly<{
    id: TrustedRuntimeMainHealthGateId;
    command: string;
  }>[];
}>;

export interface TrustedRuntimeContainerImageObservation {
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  readonly labels: Readonly<Record<string, string>>;
}

export interface TrustedRuntimeContainerReceipt {
  readonly schema: typeof TRUSTED_RUNTIME_CONTAINER_SCHEMA;
  readonly executionId: string;
  readonly sessionRevision: Digest;
  readonly baseSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  readonly dockerEndpoint: DockerEndpointIdentity;
  readonly networkIsolatedBeforeSut: true;
  readonly evidenceByteDigest: Digest;
  readonly evidenceByteLength: number;
  readonly evidenceDigest: Digest;
  readonly producerSourceDigest: Digest;
  readonly receiptDigest: Digest;
}

export interface TrustedRuntimeMainHealthReceipt {
  readonly schema: typeof TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA;
  readonly origin: 'physical-main' | 'verified-candidate-transition';
  readonly repository: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly baselineSha: string;
  readonly baselineTreeSha: string;
  readonly baselineObservationDigest: Digest;
  readonly executionId: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  readonly dockerEndpoint: DockerEndpointIdentity;
  readonly networkIsolatedBeforeExecution: true;
  readonly planDigest: typeof TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST;
  readonly actionResults: readonly Readonly<{
    readonly actionId: TrustedRuntimeMainHealthActionId;
    readonly resultDigest: Digest;
  }>[];
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

export interface TrustedRuntimeMainHealthSupersessionReceipt {
  readonly schema: typeof TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_SCHEMA;
  readonly phase: 'complete';
  readonly effect: 'prefer-exact-registered-hosted-provider';
  readonly reason: 'stronger-hosted-provider-conflict';
  readonly repository: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly operationId: Digest;
  readonly operationLeaseName: string;
  /** Previous terminal in the same exact-main supersession chain, if any. */
  readonly predecessorRecordDigest: Digest | null;
  /** The immutable prepared predecessor from which this terminal was recovered. */
  readonly preparedIntentDigest: Digest;
  /** The exact Runtime State authority bound to the effect. */
  readonly runtimeAuthorityBinding: Digest;
  readonly issuer: Readonly<{
    readonly transport: 'github-rest-token';
    readonly login: string;
    readonly nodeId: string;
    readonly permission: 'admin' | 'maintain';
  }>;
  readonly authorizedAt: string;
  readonly sourceName: string;
  readonly source: Readonly<{
    readonly device: string;
    readonly inode: string;
    readonly size: number;
    readonly byteDigest: Digest;
  }>;
  readonly localReceipt: TrustedRuntimeMainHealthReceipt;
  readonly localHealthRevision: Digest;
  readonly hostedLedger: MainHealthLedger;
  readonly hostedAuthorityDigest: Digest;
  readonly effectAuthorizationDigest: Digest;
  readonly providerAuthorization: Readonly<{
    readonly transport: 'github-commit-status';
    readonly statusId: number;
    readonly statusNodeId: string;
    readonly state: 'success';
    readonly context: string;
    readonly description: string;
    readonly targetUrl: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly creator: Readonly<{
      readonly login: string;
      readonly nodeId: string;
    }>;
  }>;
  /** Stable semantic identity; excludes provider timestamps and other evidence volatility. */
  readonly semanticDigest: Digest;
  readonly recordDigest: Digest;
}

export type TrustedRuntimeMainHealthSupersessionAuthorization = Readonly<
  Omit<
    TrustedRuntimeMainHealthSupersessionReceipt,
    'schema' | 'phase' | 'effect' | 'reason' | 'authorizedAt' |
    'preparedIntentDigest' | 'providerAuthorization' | 'semanticDigest' | 'recordDigest'
  >
>;

export interface TrustedRuntimeMainHealthSupersessionIntent {
  readonly schema: typeof TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_INTENT_SCHEMA;
  readonly phase: 'prepared';
  readonly authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  readonly preparedAt: string;
  /** Idempotency identity of the status request; never includes observed timestamps. */
  readonly requestDigest: Digest;
  readonly intentDigest: Digest;
}

/**
 * Durable at-most-once transition for the external status effect.  The
 * available and consumed phases are separate immutable records; the phase
 * is never edited in place.  A consumed record is therefore the durable
 * evidence that the one POST permit was spent, including across process
 * restarts and lost responses.
 */
export interface TrustedRuntimeMainHealthSupersessionPermit {
  readonly schema: typeof TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_PERMIT_SCHEMA;
  readonly phase: 'available' | 'consumed';
  readonly repository: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly operationId: Digest;
  readonly predecessorRecordDigest: Digest | null;
  readonly intentDigest: Digest;
  readonly requestDigest: Digest;
  readonly effectAuthorizationDigest: Digest;
  readonly runtimeAuthorityBinding: Digest;
  readonly hostedAuthorityDigest: Digest;
  readonly permitDigest: Digest;
}

export interface TrustedRuntimeDependencyCacheMarker {
  readonly schema: typeof TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA;
  readonly classification: 'rebuildable-derived-cache';
  readonly authority: 'none';
  readonly repository: string;
  readonly bunLockBlobSha: string;
  readonly imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  readonly bunVersion: '1.3.14';
  readonly deletionEffect: 'performance-loss-only';
  readonly activeUseFence: 'docker-mounted-volume-plus-operation-lease-v1';
  readonly cacheKey: Digest;
}

export interface TrustedRuntimeDependencyCacheVolumeSpec {
  readonly schema: typeof TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA;
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
  return digestBytes(encodeVerificationActionData(value));
}

export function parseTrustedRuntimeMainHealthAffectedPlan(
  source: string
): TrustedRuntimeMainHealthAffectedPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error('Trusted runtime MainHealth affected plan is invalid JSON.', { cause: error });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('MainHealth affected plan must be one object');
  }
  const record = parsed as Record<string, unknown>;
  const recordKeys = Object.keys(record).sort();
  const expectedRecordKeys = [
    'affectedPlan', 'changedPaths', 'gates', 'resolved', 'schema',
    'subsumedStandaloneCommands', 'umbrellaCommand'
  ];
  if (record.schema !== 'sec-local-affected-check-plan-v1' || record.resolved !== true
      || record.umbrellaCommand !== 'bun run check:affected' || !Array.isArray(record.gates)
      || record.affectedPlan === null || typeof record.affectedPlan !== 'object'
      || Array.isArray(record.affectedPlan) || !Array.isArray(record.changedPaths)
      || !record.changedPaths.every((entry) => typeof entry === 'string')
      || recordKeys.length !== expectedRecordKeys.length
      || recordKeys.some((key, index) => key !== expectedRecordKeys[index])) {
    fail('MainHealth affected plan is unresolved or has a noncanonical identity');
  }
  const canonicalOrder = Object.keys(TRUSTED_RUNTIME_MAIN_HEALTH_GATE_COMMANDS);
  const gates = record.gates.map((candidate, index) => {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      fail(`MainHealth affected gate ${index} must be one object`);
    }
    const gateRecord = candidate as Record<string, unknown>;
    const keys = Object.keys(gateRecord).sort();
    if (keys.length !== 2 || keys[0] !== 'command' || keys[1] !== 'id'
        || typeof gateRecord.id !== 'string'
        || !Object.hasOwn(TRUSTED_RUNTIME_MAIN_HEALTH_GATE_COMMANDS, gateRecord.id)) {
      fail(`MainHealth affected gate ${index} is not canonical`);
    }
    const id = gateRecord.id as TrustedRuntimeMainHealthGateId;
    if (gateRecord.command !== `bun run ${id}`) {
      fail(`MainHealth affected gate ${id} command differs from its owner`);
    }
    return Object.freeze({ id, command: gateRecord.command });
  });
  if (new Set(gates.map(({ id }) => id)).size !== gates.length
      || gates.some(({ id }, index) => canonicalOrder.indexOf(id) <=
        (index === 0 ? -1 : canonicalOrder.indexOf(gates[index - 1]!.id)))) {
    fail('MainHealth affected gates are duplicated or out of canonical order');
  }
  if (!Array.isArray(record.subsumedStandaloneCommands)
      || record.subsumedStandaloneCommands.length !== gates.length
      || record.subsumedStandaloneCommands.some((command, index) =>
        command !== gates[index]!.command)) {
    fail('MainHealth affected plan standalone command projection differs');
  }
  return Object.freeze({
    planDigest: digestValue(parsed),
    gates: Object.freeze(gates)
  });
}

export function createTrustedRuntimeMainHealthGatePlans(input: Readonly<{
  mainTreeSha: string;
  baselineObservationDigest: Digest;
  affectedPlan: TrustedRuntimeMainHealthAffectedPlan;
  imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  dockerEndpoint: DockerEndpointIdentity;
}>): readonly Readonly<{
  id: TrustedRuntimeMainHealthGateId;
  argv: readonly string[];
  action: VerificationActionKey;
  plan: VerificationActionPlan;
}>[] {
  const results: Array<Readonly<{
    id: TrustedRuntimeMainHealthGateId;
    argv: readonly string[];
    action: VerificationActionKey;
    plan: VerificationActionPlan;
  }>> = [];
  for (const gate of input.affectedPlan.gates) {
    const argv = TRUSTED_RUNTIME_MAIN_HEALTH_GATE_COMMANDS[gate.id];
    const dependencies = gate.id === 'test:affected'
      ? results.map(({ action }) => action.actionKey)
      : [];
    const action = createVerificationActionKey({
      actionKind: 'trusted-main-health-gate',
      producer: {
        identity: 'sec-trusted-runtime-main-health',
        revision: 'affected-gate-v1'
      },
      operation: {
        identity: gate.id,
        revision: 'dev-runner-command-v1',
        semanticDigest: digestValue({
          gateId: gate.id,
          argv,
          stateEnvironmentDigest: TRUSTED_RUNTIME_STATE_ENVIRONMENT_DIGEST
        }),
        workingDirectory: '.',
        declaredEnvironment: [
          { name: 'affected-baseline', digest: input.baselineObservationDigest },
          {
            name: 'trusted-runtime-state-environment',
            digest: TRUSTED_RUNTIME_STATE_ENVIRONMENT_DIGEST
          }
        ]
      },
      inputClosure: [
        { path: 'main.tree', digest: digestValue(input.mainTreeSha) },
        { path: 'affected.plan', digest: input.affectedPlan.planDigest }
      ],
      environment: {
        toolchainRevision: 'bun@1.3.14-linux-x64',
        providerRevision: `trusted-container:${digestValue({
          imageId: input.imageId,
          dockerEndpoint: input.dockerEndpoint
        }).slice(7)}`,
        contractRevision: 'sec-trusted-runtime-main-health-action-v2'
      },
      requiredCheapPreflightActionKeys: dependencies,
      upstreamActionKeys: [],
      resultSchemaRevision: 'sec-verification-result-v1'
    });
    const plan = createVerificationActionPlan({
      action,
      executionClass: dependencies.length === 0 ? 'cheap-preflight' : 'expensive',
      dependencies: dependencies.map((actionKey) => ({
        actionKey,
        kind: 'cheap-preflight'
      }))
    });
    results.push(Object.freeze({ id: gate.id, argv, action, plan }));
  }
  return Object.freeze(results);
}

const TRUSTED_RUNTIME_MAIN_HEALTH_ACTION_LEASE_MS = 4 * 60 * 60_000;
const TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET = Object.freeze({
  durationMs: TRUSTED_RUNTIME_MAIN_HEALTH_ACTION_LEASE_MS,
  inputBytes: 64 * 1024 * 1024,
  outputBytes: 512 * 1024 * 1024,
  processes: 512
});

function bindTrustedRuntimeContainerEngineOperation(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  headSha: string;
  operationKey: string;
  setupMode: 'full' | 'lifecycle-canary' | 'dependency-canary';
  providerIdentityDigest: SecOperationDigest;
  deadlineAtUnixMs?: number;
}>): SecBoundSemanticOperation {
  const contractDigest = digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-container-engine-contract-v1',
    environment: ENVIRONMENT.provider.requirement,
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
  })) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'verification.trusted-runtime-container',
    intentDigest: digestValue(Object.freeze({
      repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      baseSha: input.baseSha,
      headSha: input.headSha,
      operationKey: input.operationKey,
      setupMode: input.setupMode
    })) as SecOperationDigest,
    decisionDigest: digestValue(Object.freeze({
      contractDigest,
      budget: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET
    })) as SecOperationDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs
      ?? Date.now() + TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs },
      { resource: 'input-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.inputBytes },
      { resource: 'output-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.outputBytes },
      { resource: 'processes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.processes }
    ],
    requirements: [{
      id: 'external.container-engine-process',
      contractDigest,
      effectKinds: ['process'],
      failureKinds: [
        'container-engine.admission-failed',
        'container-engine.endpoint-unavailable',
        'container-engine.process-settlement-failed'
      ]
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    })
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: 'external.container-engine-process',
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

function bindTrustedRuntimeMainHealthEffect(input: Readonly<{
  gate: ReturnType<typeof createTrustedRuntimeMainHealthGatePlans>[number];
  dockerEndpoint: DockerEndpointIdentity;
  imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  deadlineAtUnixMs: number;
  providerIdentityDigest: SecOperationDigest;
}>): SecBoundSemanticOperation {
  const contractDigest = digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-main-health-effect-contract-v1',
    actionKey: input.gate.action.actionKey,
    argv: input.gate.argv
  })) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'verification.trusted-runtime-main-health',
    intentDigest: input.gate.action.actionKey as SecOperationDigest,
    decisionDigest: input.gate.action.operation.semanticDigest as SecOperationDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: TRUSTED_RUNTIME_MAIN_HEALTH_ACTION_LEASE_MS },
      { resource: 'input-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.inputBytes },
      { resource: 'output-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.outputBytes },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: 'verification.trusted-container-process',
      contractDigest,
      effectKinds: ['process'],
      failureKinds: ['process.failed', 'process.settlement-failed']
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    })
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: 'verification.trusted-container-process',
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

export function issueTrustedRuntimeContainerEngineOwnerTerminalJoin(input: Readonly<{
  operation: SecBoundSemanticOperation;
  providerSettlement: SecProviderSettlementReceipt;
  endpointReadback: DockerEndpointIdentity;
  ownerTerminalContractDigest: SecOperationDigest;
  ownerTerminalReferenceDigest: SecOperationDigest;
}>): SecOwnerTerminalJoinReceipt {
  const providerSettlementSet = compileSecProviderSettlementSet(
    input.operation,
    [input.providerSettlement]
  );
  const readback = issueSecNormalDomainReadbackReceipt(input.operation, providerSettlementSet, {
    readbackContractDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-endpoint-readback-contract-v1',
      contextName: input.endpointReadback.contextName,
      endpointHost: input.endpointReadback.endpointHost
    })) as SecOperationDigest,
    readbackReferenceDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-endpoint-readback-v1',
      endpoint: input.endpointReadback
    })) as SecOperationDigest,
    currentPhysicalEpochDigest: digestValue(Object.freeze({
      schema: 'sec-container-engine-physical-epoch-v1',
      endpointHost: input.endpointReadback.endpointHost,
      daemonId: input.endpointReadback.daemonId
    })) as SecOperationDigest,
    disposition: input.providerSettlement.physicalDisposition === 'settled'
      ? 'applied'
      : 'unknown'
  });
  return issueSecNormalOwnerTerminalJoinReceipt(
    input.operation,
    providerSettlementSet,
    readback,
    {
      ownerTerminalContractDigest: input.ownerTerminalContractDigest,
      ownerTerminalReferenceDigest: input.ownerTerminalReferenceDigest
    }
  );
}

async function settleTrustedRuntimeContainerEngineOperation(input: Readonly<{
  session: ContainerEngineSession;
  operation: SecBoundSemanticOperation;
  scope: ContainerEngineOperationScope;
  ownerTerminalReference: Readonly<Record<string, unknown>>;
}>): Promise<SecOwnerTerminalJoinReceipt> {
  const providerSettlement = input.scope.settle();
  const endpointReadback = await input.session.observeEndpoint();
  return issueTrustedRuntimeContainerEngineOwnerTerminalJoin({
    operation: input.operation,
    providerSettlement,
    endpointReadback,
    ownerTerminalContractDigest: digestValue(Object.freeze({
      schema: 'sec-trusted-runtime-container-engine-owner-terminal-contract-v1',
      operation: input.operation.plan.identity.operation
    })) as SecOperationDigest,
    ownerTerminalReferenceDigest: digestValue(Object.freeze({
      schema: 'sec-trusted-runtime-container-engine-owner-terminal-reference-v1',
      ...input.ownerTerminalReference
    })) as SecOperationDigest
  });
}

async function executeTrustedRuntimeContainerEngineOwnerOperation<T>(input: Readonly<{
  session: ContainerEngineSession;
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  headSha: string;
  operationKey: string;
  setupMode: 'full' | 'lifecycle-canary' | 'dependency-canary';
  execute: () => Promise<T>;
}>): Promise<T> {
  const operation = bindTrustedRuntimeContainerEngineOperation({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    baseSha: input.baseSha,
    headSha: input.headSha,
    operationKey: input.operationKey,
    setupMode: input.setupMode,
    providerIdentityDigest: input.session.providerIdentityDigest,
    deadlineAtUnixMs: input.session.deadlineAtUnixMs
  });
  const scope = input.session.openOperationScope({
    operation,
    requirementId: 'external.container-engine-process'
  });
  try {
    return await input.execute();
  } finally {
    await settleTrustedRuntimeContainerEngineOperation({
      session: input.session,
      operation,
      scope,
      ownerTerminalReference: Object.freeze({
        phase: 'owner-operation',
        operationKey: input.operationKey
      })
    });
  }
}

function issueTrustedRuntimeMainHealthEffectSettlement(input: Readonly<{
  operation: SecBoundSemanticOperation;
  providerSettlement: SecProviderSettlementReceipt;
  actionKey: VerificationActionKeyDigest;
  exitCode: number;
  stdout: string;
  stderr: string;
  endpointReadback: DockerEndpointIdentity;
}>) {
  const passed = input.exitCode === 0
    && input.providerSettlement.physicalDisposition === 'settled';
  const ownerTerminalJoinReceipt = issueTrustedRuntimeContainerEngineOwnerTerminalJoin({
    operation: input.operation,
    providerSettlement: input.providerSettlement,
    endpointReadback: input.endpointReadback,
    ownerTerminalContractDigest: digestValue(Object.freeze({
      schema: 'sec-trusted-runtime-main-health-owner-terminal-contract-v1',
      actionKey: input.actionKey
    })) as SecOperationDigest,
    ownerTerminalReferenceDigest: digestValue(Object.freeze({
      schema: 'sec-trusted-runtime-main-health-owner-terminal-reference-v1',
      actionKey: input.actionKey,
      passed,
      exitCode: input.exitCode,
      stdoutDigest: digestValue(input.stdout),
      stderrDigest: digestValue(input.stderr)
    })) as SecOperationDigest
  });
  return issueVerificationActionTerminalSettlement(ownerTerminalJoinReceipt, {
    status: passed ? 'passed' : 'failed',
    reasonCode: passed ? 'executed-success' : 'executed-failure'
  });
}

export function createTrustedRuntimeDependencyCacheMarker(input: Readonly<{
  repository: string;
  bunLockBlobSha: string;
  imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
}>): TrustedRuntimeDependencyCacheMarker {
  const withoutKey = Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_SCHEMA,
    classification: 'rebuildable-derived-cache' as const,
    authority: 'none' as const,
    repository: repository(input.repository),
    bunLockBlobSha: sha(input.bunLockBlobSha, 'dependency cache bunLockBlobSha'),
    imageId: input.imageId,
    bunVersion: '1.3.14' as const,
    deletionEffect: 'performance-loss-only' as const,
    activeUseFence: 'docker-mounted-volume-plus-operation-lease-v1' as const
  });
  return Object.freeze({ ...withoutKey, cacheKey: digestValue(withoutKey) });
}

function canonicalDependencyCacheMarkerBytes(
  marker: TrustedRuntimeDependencyCacheMarker
): Uint8Array {
  return Buffer.from(`${encodeVerificationActionData(marker)}\n`, 'utf8');
}

export function createTrustedRuntimeDependencyCacheVolumeSpec(
  marker: TrustedRuntimeDependencyCacheMarker
): TrustedRuntimeDependencyCacheVolumeSpec {
  const name = `sec-trusted-runtime-bun-cache-v1-${marker.cacheKey.slice(7, 39)}`;
  return Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA,
    name,
    labels: Object.freeze({
      'sec.trusted-runtime.cache-schema': TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA,
      'sec.trusted-runtime.repository': marker.repository,
      'sec.trusted-runtime.cache-key': marker.cacheKey,
      'sec.trusted-runtime.image-id': marker.imageId
    })
  });
}

export function assertTrustedRuntimeDependencyCacheVolume(input: Readonly<{
  source: string;
  expected: TrustedRuntimeDependencyCacheVolumeSpec;
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
      || encodeVerificationActionData(labels)
        !== encodeVerificationActionData(input.expected.labels)
      || !(options === null || (typeof options === 'object' && !Array.isArray(options)
        && Object.keys(options as Record<string, unknown>).length === 0))) {
    fail('Docker dependency-cache volume differs from the content-addressed specification');
  }
  return digestValue(Object.freeze({
    schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA,
    endpointDigest: digest(input.endpointDigest, 'dependency-cache volume endpointDigest'),
    name: input.expected.name,
    createdAt: record.CreatedAt,
    driver: record.Driver,
    scope: record.Scope,
    labels: input.expected.labels
  }));
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

function canonicalInstant(value: unknown, label: string): string {
  const result = bounded(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO instant`);
  return result;
}

export function createTrustedRuntimeHostCommandEnvironment(
  _executable: 'git',
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const expected of [
    // Docker receives an explicit retained endpoint in every caller.  Its
    // context/config selectors are therefore authority inputs and must not
    // cross this boundary from the ambient host environment.
    'HOME', 'LOCALAPPDATA',
    'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR'
  ]) {
    const actual = Object.keys(source).find((key) => key.toUpperCase() === expected);
    if (actual !== undefined && source[actual] !== undefined) result[actual] = source[actual];
  }
  return isolatedGitChildEnvironment(result);
}

async function observeCommandResult(
  executable: 'git',
  args: readonly string[],
  cwd: string,
  timeoutMs = 120_000
): Promise<Awaited<ReturnType<typeof runCommand>>> {
  return await runCommand(executable, [...args], {
    cwd,
    envMode: 'replace',
    env: createTrustedRuntimeHostCommandEnvironment(executable),
    timeoutMs,
    maxStdoutBytes: 32 * 1024 * 1024,
    maxStderrBytes: 32 * 1024 * 1024
  });
}

async function commandResult(
  executable: 'git',
  args: readonly string[],
  cwd: string,
  timeoutMs = 120_000
): Promise<Awaited<ReturnType<typeof runCommand>>> {
  const result = await observeCommandResult(
    executable,
    args,
    cwd,
    timeoutMs
  );
  if (result.code !== 0) {
    const detail = renderTrustedRuntimeCommandFailureDetail(result);
    fail(`${executable} ${args[0] ?? '<missing>'} failed (${result.code}): ${detail}`);
  }
  return result;
}

export function renderTrustedRuntimeCommandFailureDetail(input: Readonly<{
  stdout: string;
  stderr: string;
}>): string {
  const sections = ([
    ['stdout', input.stdout],
    ['stderr', input.stderr]
  ] as const).flatMap(([label, source]) => {
    const tail = source.trim().slice(-4_096);
    return tail.length === 0 ? [] : [`${label}:\n${tail}`];
  });
  return sections.length === 0 ? '<no captured output>' : sections.join('\n');
}

async function command(
  executable: 'git',
  args: readonly string[],
  cwd: string,
  timeoutMs = 120_000
): Promise<string> {
  return (await commandResult(executable, args, cwd, timeoutMs)).stdout.trim();
}

async function observeContainerEngineOperation(
  session: ContainerEngineSession,
  operation: ContainerEngineOperation,
  options: ContainerEngineOperationOptions = {}
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  const result = await session.execute(operation, options);
  return Object.freeze({
    code: result.code,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8')
  });
}

async function containerEngineOperationResult(
  session: ContainerEngineSession,
  operation: ContainerEngineOperation,
  options: ContainerEngineOperationOptions = {}
): Promise<Readonly<{ code: number; stdout: string; stderr: string }>> {
  const result = await observeContainerEngineOperation(session, operation, options);
  if (result.code !== 0) {
    fail(`Container Engine ${operation.kind} failed (${result.code}): ${
      renderTrustedRuntimeCommandFailureDetail(result)}`);
  }
  return result;
}

async function containerEngineOutput(
  session: ContainerEngineSession,
  operation: ContainerEngineOperation,
  options: ContainerEngineOperationOptions = {}
): Promise<string> {
  return (await containerEngineOperationResult(session, operation, options)).stdout.trim();
}

export interface TrustedRuntimeContainerIdentity {
  readonly id: string;
  readonly imageId: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly readOnlyRootfs: true;
  readonly readOnlyCandidateBundle: true;
  readonly initProcess: true;
  readonly executableTestTmpfs: true;
  readonly nonExecutableMutableTmpfs: true;
  readonly dependencyCacheVolumeName: string | null;
}

export function composeTrustedRuntimeContainerLabels(
  imageLabels: Readonly<Record<string, string>>,
  operationLabels: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  if (Object.keys(imageLabels).some((key) => Object.hasOwn(operationLabels, key))) {
    fail('Docker image labels collide with retained operation identity');
  }
  return Object.freeze({ ...imageLabels, ...operationLabels });
}

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

function assertCanonicalTmpfs(hostConfig: Readonly<Record<string, unknown>>): void {
  const tmpfs = hostConfig.Tmpfs;
  if (tmpfs === null || typeof tmpfs !== 'object' || Array.isArray(tmpfs)) {
    fail('Docker tmpfs policy is invalid');
  }
  const expected: Readonly<Record<string, string>> = Object.freeze({
    [TRUSTED_RUNTIME_TEST_TMPFS_TARGET]:
      TRUSTED_RUNTIME_TEST_TMPFS_SPEC.slice(TRUSTED_RUNTIME_TEST_TMPFS_TARGET.length + 1),
    [TRUSTED_RUNTIME_MUTABLE_ROOT]:
      TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC.slice(TRUSTED_RUNTIME_MUTABLE_ROOT.length + 1)
  });
  const observed = tmpfs as Record<string, unknown>;
  const expectedTargets = Object.keys(expected).sort();
  const observedTargets = Object.keys(observed).sort();
  if (observedTargets.length !== expectedTargets.length
      || observedTargets.some((target, index) => target !== expectedTargets[index])) {
    fail('Docker tmpfs targets differ from the canonical policy');
  }
  for (const target of expectedTargets) {
    if (typeof observed[target] !== 'string') fail(`Docker tmpfs ${target} options are invalid`);
    const observedOptions = observed[target].split(',');
    const expectedOptions = expected[target]!.split(',');
    if (new Set(observedOptions).size !== observedOptions.length
        || observedOptions.length !== expectedOptions.length
        || observedOptions.some((option) => !expectedOptions.includes(option))) {
      fail(`Docker tmpfs ${target} options differ from the canonical policy`);
    }
  }
}

export function parseTrustedRuntimeContainerIdentity(
  source: string
): TrustedRuntimeContainerIdentity {
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
  const hostConfig = record.HostConfig;
  const mounts = record.Mounts;
  if (typeof record.Id !== 'string' || !/^[0-9a-f]{64}$/u.test(record.Id)
      || typeof record.Image !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.Image)
      || typeof record.Name !== 'string' || !record.Name.startsWith('/')
      || config === null || typeof config !== 'object' || Array.isArray(config)
      || hostConfig === null || typeof hostConfig !== 'object' || Array.isArray(hostConfig)
      || (hostConfig as Record<string, unknown>).ReadonlyRootfs !== true
      || (hostConfig as Record<string, unknown>).Init !== true
      || !Array.isArray(mounts)) {
    fail('Docker container identity is invalid');
  }
  assertCanonicalTmpfs(hostConfig as Record<string, unknown>);
  const candidateBundleMounts = mounts.filter((entry) => entry !== null
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && (entry as Record<string, unknown>).Destination === TRUSTED_RUNTIME_CANDIDATE_BUNDLE);
  if (candidateBundleMounts.length !== 1
      || (candidateBundleMounts[0] as Record<string, unknown>).Type !== 'bind'
      || (candidateBundleMounts[0] as Record<string, unknown>).RW !== false) {
    fail('Docker candidate bundle must be one read-only bind mount');
  }
  const dependencyCacheMounts = mounts.filter((entry) => entry !== null
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && (entry as Record<string, unknown>).Destination
      === TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH);
  if (dependencyCacheMounts.length > 1) {
    fail('Docker dependency-cache mount must be zero or one');
  }
  let dependencyCacheVolumeName: string | null = null;
  if (dependencyCacheMounts.length === 1) {
    const cacheMount = dependencyCacheMounts[0] as Record<string, unknown>;
    if (cacheMount.Type !== 'volume' || cacheMount.Driver !== 'local' || cacheMount.RW !== true
        || typeof cacheMount.Name !== 'string'
        || !/^sec-trusted-runtime-bun-cache-v1-[0-9a-f]{32}$/u.test(cacheMount.Name)) {
      fail('Docker dependency-cache mount differs from the content-addressed volume');
    }
    dependencyCacheVolumeName = cacheMount.Name;
  }
  const rawLabels = (config as Record<string, unknown>).Labels;
  if (rawLabels === null || typeof rawLabels !== 'object' || Array.isArray(rawLabels)) {
    fail('Docker container labels are invalid');
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawLabels)) {
    if (typeof value !== 'string') fail('Docker container label is not text');
    labels[key] = value;
  }
  return Object.freeze({
    id: record.Id,
    imageId: record.Image,
    name: record.Name.slice(1),
    labels: Object.freeze(labels),
    readOnlyRootfs: true,
    readOnlyCandidateBundle: true,
    initProcess: true,
    executableTestTmpfs: true,
    nonExecutableMutableTmpfs: true,
    dependencyCacheVolumeName
  });
}

function sameContainerIdentity(
  left: TrustedRuntimeContainerIdentity,
  right: TrustedRuntimeContainerIdentity
): boolean {
  return left.id === right.id && left.imageId === right.imageId && left.name === right.name
    && left.readOnlyRootfs === right.readOnlyRootfs
    && left.readOnlyCandidateBundle === right.readOnlyCandidateBundle
    && left.initProcess === right.initProcess
    && left.executableTestTmpfs === right.executableTestTmpfs
    && left.nonExecutableMutableTmpfs === right.nonExecutableMutableTmpfs
    && left.dependencyCacheVolumeName === right.dependencyCacheVolumeName
    && encodeVerificationActionData(left.labels) === encodeVerificationActionData(right.labels);
}

export function authorizeTrustedRuntimeContainerRecovery(input: Readonly<{
  first: TrustedRuntimeContainerIdentity;
  confirmed: TrustedRuntimeContainerIdentity;
  expected: Readonly<{
    operationKey: string;
    repository: string;
    baseSha: string;
    headSha: string;
    endpointDigest: Digest;
    imageId: string;
    imageLabels: Readonly<Record<string, string>>;
    ownerHost: string;
    dependencyCacheKey?: Digest;
    dependencyCacheVolumeName: string | null;
  }>;
  observeProcessLiveness: (pid: number) => 'alive' | 'dead' | 'unknown';
}>): string {
  const ownerPidText = input.first.labels['sec.trusted-runtime.owner-pid'];
  const ownerPid = ownerPidText !== undefined && /^[1-9][0-9]*$/u.test(ownerPidText)
    ? Number(ownerPidText)
    : Number.NaN;
  const ownerNonce = input.first.labels['sec.trusted-runtime.owner-nonce'];
  const expectedLabels = composeTrustedRuntimeContainerLabels(
    input.expected.imageLabels,
    Object.freeze({
      'sec.trusted-runtime.operation': input.expected.operationKey,
      'sec.trusted-runtime.repository': input.expected.repository,
      'sec.trusted-runtime.base-sha': input.expected.baseSha,
      'sec.trusted-runtime.head-sha': input.expected.headSha,
      'sec.trusted-runtime.endpoint-digest': input.expected.endpointDigest,
      'sec.trusted-runtime.owner-host': input.expected.ownerHost,
      'sec.trusted-runtime.owner-pid': ownerPidText ?? '',
      'sec.trusted-runtime.owner-nonce': ownerNonce ?? '',
      'sec.trusted-runtime.image-id': input.expected.imageId,
      ...(input.expected.dependencyCacheKey === undefined ? {} : {
        'sec.trusted-runtime.dependency-cache-key': input.expected.dependencyCacheKey
      })
    })
  );
  if (encodeVerificationActionData(input.first.labels)
        !== encodeVerificationActionData(expectedLabels)
      || input.first.imageId !== input.expected.imageId
      || input.first.readOnlyRootfs !== true
      || input.first.readOnlyCandidateBundle !== true
      || input.first.initProcess !== true
      || input.first.executableTestTmpfs !== true
      || input.first.nonExecutableMutableTmpfs !== true
      || input.first.dependencyCacheVolumeName !== input.expected.dependencyCacheVolumeName
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
  if (!sameContainerIdentity(input.first, input.confirmed)
      || input.observeProcessLiveness(ownerPid) !== 'dead') {
    fail('Docker abandoned-container identity or owner liveness changed during recovery');
  }
  return input.confirmed.id;
}

async function inspectContainerIdentity(
  session: ContainerEngineSession,
  container: string
): Promise<TrustedRuntimeContainerIdentity> {
  return parseTrustedRuntimeContainerIdentity(await containerEngineOutput(session, {
    kind: 'container-inspect', arguments: [container]
  }));
}

/**
 * Dead local owners are collected only after two identical Docker identity
 * observations. Unknown, foreign-host, live, malformed, or changed resources
 * are retained and block the same operation while its repository-scoped lease
 * is held; a collision-free name cannot bypass an unresolved prior start.
 */
async function reclaimAbandonedTrustedRuntimeContainers(input: Readonly<{
  session: ContainerEngineSession;
  operationKey: string;
  repository: string;
  baseSha: string;
  headSha: string;
  endpointDigest: Digest;
  imageId: string;
  imageLabels: Readonly<Record<string, string>>;
  dependencyCacheKey?: Digest;
  dependencyCacheVolumeName: string | null;
}>): Promise<void> {
  const list = await observeContainerEngineOperation(input.session, {
    kind: 'container-list',
    arguments: [
      '--all', '--quiet', '--no-trunc',
      '--filter', `label=sec.trusted-runtime.operation=${input.operationKey}`
    ]
  }, { acceptAnyExitCode: true });
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
    let first: TrustedRuntimeContainerIdentity;
    try {
      first = await inspectContainerIdentity(input.session, id);
    } catch (error) {
      fail(`Docker abandoned-container identity cannot be observed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let confirmed: TrustedRuntimeContainerIdentity;
    try {
      confirmed = await inspectContainerIdentity(input.session, first.id);
    } catch (error) {
      fail(`Docker abandoned-container confirmation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const recoveryTarget = authorizeTrustedRuntimeContainerRecovery({
      first,
      confirmed,
      expected: {
        operationKey: input.operationKey,
        repository: input.repository,
        baseSha: input.baseSha,
        headSha: input.headSha,
        endpointDigest: input.endpointDigest,
        imageId: input.imageId,
        imageLabels: input.imageLabels,
        ownerHost: TRUSTED_RUNTIME_OWNER_HOST,
        dependencyCacheVolumeName: input.dependencyCacheVolumeName,
        ...(input.dependencyCacheKey === undefined ? {} : {
          dependencyCacheKey: input.dependencyCacheKey
        })
      },
      observeProcessLiveness: localProcessLiveness
    });
    const removed = await observeContainerEngineOperation(input.session, {
      kind: 'container-remove', arguments: ['--force', recoveryTarget]
    }, { acceptAnyExitCode: true });
    if (removed.code !== 0) {
      fail(`Docker abandoned-container removal failed: ${removed.stderr.trim().slice(-4_096)}`);
    }
  }
}

function imageObservation(source: string): TrustedRuntimeContainerImageObservation {
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
  if (image.Id !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID) fail('Docker image ID drifted');
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
    'sec.trusted-runtime.image-schema': TRUSTED_RUNTIME_CONTAINER_SCHEMA,
    'sec.trusted-runtime.base-image-id': TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID,
    'sec.trusted-runtime.bun-archive-sha256': TRUSTED_RUNTIME_CONTAINER_BUN_ARCHIVE_SHA256,
    'sec.trusted-runtime.bun-version': ENVIRONMENT.trustedRuntime.bunVersion
  });
  for (const [key, value] of Object.entries(expected)) {
    if (observed[key] !== value) fail(`Docker image label ${key} drifted`);
  }
  return Object.freeze({
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    labels: Object.freeze(Object.fromEntries(
      Object.entries(observed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    ))
  });
}

export function assertTrustedRuntimeContainerImageV1(
  source: string
): TrustedRuntimeContainerImageObservation {
  return imageObservation(source);
}

async function ensureImage(
  repositoryRoot: string,
  session: ContainerEngineSession
): Promise<TrustedRuntimeContainerImageObservation> {
  const inspected = await observeContainerEngineOperation(session, {
    kind: 'image-inspect', arguments: [TRUSTED_RUNTIME_CONTAINER_IMAGE]
  }, { acceptAnyExitCode: true });
  if (inspected.code === 0) return imageObservation(inspected.stdout);
  const toolchain = await ensureLocalGitHubActionsRunnerToolchainMaterialization({
    repositoryRoot,
    containerEngineSession: session
  });
  if (toolchain.dockerProjectionDigest !== TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID) {
    fail('trusted toolchain base image identity drifted');
  }
  const dockerfile = path.join(import.meta.dir, 'trusted-runtime.Dockerfile');
  const plan = createTrustedRuntimeImageBuildPlan(dockerfile, toolchain);
  const progress = createBuildxRawJsonProgressAdmission();
  const built = await observeContainerEngineOperation(session, {
    kind: 'buildx-build', arguments: plan.args.slice(2)
  }, {
    acceptAnyExitCode: true,
    maxStdoutBytes: 32 * 1024 * 1024,
    maxStderrBytes: 32 * 1024 * 1024,
    stallTimeoutMs: plan.stallTimeoutMs,
    admitProgress: (chunk, stream) => stream === 'stderr' && progress.push(chunk)
  });
  progress.finish();
  if (built.code !== 0) {
    fail(`docker buildx failed (${built.code}): ${renderTrustedRuntimeCommandFailureDetail(built)}`);
  }
  return imageObservation(await containerEngineOutput(session, {
    kind: 'image-inspect', arguments: [TRUSTED_RUNTIME_CONTAINER_IMAGE]
  }));
}

async function ensureTrustedRuntimeDependencyCacheVolume(input: Readonly<{
  session: ContainerEngineSession;
  endpointDigest: Digest;
  marker: TrustedRuntimeDependencyCacheMarker;
}>): Promise<Readonly<{
  spec: TrustedRuntimeDependencyCacheVolumeSpec;
  observationDigest: Digest;
}>> {
  const spec = createTrustedRuntimeDependencyCacheVolumeSpec(input.marker);
  let inspected = await observeContainerEngineOperation(input.session, {
    kind: 'volume-inspect', arguments: [spec.name]
  }, { acceptAnyExitCode: true });
  if (inspected.code !== 0) {
    if (!/no such volume/iu.test(inspected.stderr)) {
      fail(`Docker dependency-cache volume inventory failed: ${inspected.stderr.trim().slice(-4_096)}`);
    }
    const created = await containerEngineOutput(input.session, {
      kind: 'volume-create',
      arguments: [
        '--driver', 'local',
        ...Object.entries(spec.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
        spec.name
      ]
    });
    if (created !== spec.name) fail('Docker dependency-cache volume create returned another name');
    inspected = await containerEngineOperationResult(input.session, {
      kind: 'volume-inspect', arguments: [spec.name]
    });
  }
  return Object.freeze({
    spec,
    observationDigest: assertTrustedRuntimeDependencyCacheVolume({
      source: inspected.stdout,
      expected: spec,
      endpointDigest: input.endpointDigest
    })
  });
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

const PUBLISH_DEPENDENCY_CACHE_MARKER_SCRIPT = [
  'set -euo pipefail',
  'expected="$1"',
  'expected_digest="$2"',
  `root="${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH}"`,
  `marker="$root/${TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE}"`,
  '[ -d "$root" ] && [ ! -L "$root" ]',
  '[ "$(stat -c %a "$root")" = "1777" ] || chmod 1777 "$root"',
  'if [ -e "$marker" ]; then',
  '  [ -f "$marker" ] && [ ! -L "$marker" ]',
  '  [ "$(cat -- "$marker")" = "$expected" ]',
  'else',
  '  temporary="$root/.sec-derived-cache.new-$$"',
  '  (umask 077; set -C; printf \'%s\\n\' "$expected" > "$temporary")',
  '  mv -T -- "$temporary" "$marker"',
  'fi',
  'actual="$(sha256sum "$marker")"',
  'actual="${actual%% *}"',
  '[ "sha256:$actual" = "$expected_digest" ]',
  'printf \'sha256:%s\\n\' "$actual"'
].join('\n');

const READ_DEPENDENCY_CACHE_MARKER_DIGEST_SCRIPT = [
  'set -euo pipefail',
  `marker="${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH}/${TRUSTED_RUNTIME_DEPENDENCY_CACHE_MARKER_FILE}"`,
  '[ -f "$marker" ] && [ ! -L "$marker" ]',
  'actual="$(sha256sum "$marker")"',
  'actual="${actual%% *}"',
  'printf \'sha256:%s\\n\' "$actual"'
].join('\n');

export const TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT = [
  'set -euo pipefail',
  'base="$1"',
  'head="$2"',
  'mode="$3"',
  '[ "$mode" = "full" ] || [ "$mode" = "lifecycle-canary" ] || [ "$mode" = "dependency-canary" ]',
  `mkdir -p ${TRUSTED_RUNTIME_TRUSTED_TREE} ${TRUSTED_RUNTIME_WORKSPACE} ${TRUSTED_RUNTIME_OUTPUT}`,
  `git init --quiet ${TRUSTED_RUNTIME_TRUSTED_TREE}`,
  `git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} fetch --quiet ${TRUSTED_RUNTIME_CANDIDATE_BUNDLE} refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head`,
  `git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} reset --hard --quiet refs/sec/base`,
  `[ "$(git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} rev-parse HEAD)" = "$base" ]`,
  `git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} update-ref refs/remotes/origin/main "$base"`,
  `[ "$(git -C ${TRUSTED_RUNTIME_TRUSTED_TREE} rev-parse refs/remotes/origin/main)" = "$base" ]`,
  `git init --quiet ${TRUSTED_RUNTIME_WORKSPACE}`,
  `git -C ${TRUSTED_RUNTIME_WORKSPACE} fetch --quiet ${TRUSTED_RUNTIME_CANDIDATE_BUNDLE} refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head`,
  `git -C ${TRUSTED_RUNTIME_WORKSPACE} reset --hard --quiet refs/sec/head`,
  `[ "$(git -C ${TRUSTED_RUNTIME_WORKSPACE} rev-parse HEAD)" = "$head" ]`,
  `git -C ${TRUSTED_RUNTIME_WORKSPACE} update-ref refs/remotes/origin/main "$base"`,
  `[ "$(git -C ${TRUSTED_RUNTIME_WORKSPACE} rev-parse refs/remotes/origin/main)" = "$base" ]`,
  'if [ "$mode" != "lifecycle-canary" ]; then',
  `  cd ${TRUSTED_RUNTIME_TRUSTED_TREE}`,
  '  mkdir -p .shared-deps',
  `  ln -s ${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH} .shared-deps/.bun-cache`,
  `  CI=1 bun ${DEV_RUNNER_ENTRYPOINT_PATH} deps:ensure`,
  '  if [ "$mode" = "full" ]; then',
  `    rm -rf ${TRUSTED_RUNTIME_WORKSPACE}/node_modules`,
  `    ln -s ${TRUSTED_RUNTIME_TRUSTED_TREE}/node_modules ${TRUSTED_RUNTIME_WORKSPACE}/node_modules`,
  '  else',
  `    [ ! -e ${TRUSTED_RUNTIME_WORKSPACE}/node_modules ]`,
  '  fi',
  'fi',
  `chmod -R a-w ${TRUSTED_RUNTIME_TRUSTED_TREE}`
].join('\n');

function formalEnvironment(input: Readonly<{
  envelope: VerificationSessionHostedEnvelope;
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
    SEC_REQUIRED_BLOB_CLOSURE_JSON: encodeVerificationActionData(input.requiredBlobs),
    SEC_EXECUTION_ENVIRONMENT_REVISION:
      TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
    SEC_TRUSTED_RUNTIME_EXECUTION_ID: input.executionId,
    SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID: input.actorNodeId,
    SEC_CHANGED_BASE: 'refs/sec/base',
    SEC_AFFECTED_TESTS_BASE: 'refs/sec/base',
    SEC_WORK_PACKAGE_MANIFEST_PATH: envelope.session.manifestPath,
    SEC_CI_VERIFICATION_EVIDENCE_PATH: `${TRUSTED_RUNTIME_OUTPUT}/verification-evidence.json`
  });
  return createTrustedRuntimeCommandEnvironmentArgs(values);
}

function createReceipt(input: Omit<TrustedRuntimeContainerReceipt, 'schema' | 'receiptDigest'>):
TrustedRuntimeContainerReceipt {
  const withoutDigest = Object.freeze({ schema: TRUSTED_RUNTIME_CONTAINER_SCHEMA, ...input });
  return Object.freeze({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
}

export function parseTrustedRuntimeContainerReceipt(
  value: unknown
): TrustedRuntimeContainerReceipt {
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
      || record.schema !== TRUSTED_RUNTIME_CONTAINER_SCHEMA
      || record.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
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
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    dockerEndpoint: parseDockerEndpointIdentity(record.dockerEndpoint),
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

export function createTrustedRuntimeMainHealthBaselineObservation(input: Readonly<{
  mainSha: string;
  mainTreeSha: string;
  parentLine: string;
  parentTreeSha: string;
}>): TrustedRuntimeMainHealthBaselineObservation {
  const mainSha = sha(input.mainSha, 'MainHealth baseline observation mainSha');
  const mainTreeSha = sha(input.mainTreeSha, 'MainHealth baseline observation mainTreeSha');
  const fields = input.parentLine.split(' ');
  if (fields.length !== 2 || fields[0] !== mainSha) {
    fail('MainHealth exact main must have one canonical parent baseline');
  }
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_MAIN_HEALTH_BASELINE_OBSERVATION_SCHEMA,
    mainSha,
    mainTreeSha,
    baselineSha: sha(fields[1], 'MainHealth baseline observation baselineSha'),
    baselineTreeSha: sha(
      input.parentTreeSha,
      'MainHealth baseline observation baselineTreeSha'
    )
  });
  return Object.freeze({
    ...withoutDigest,
    observationDigest: digestValue(withoutDigest)
  });
}

export function assertTrustedRuntimeMainHealthCarryForwardBaselineV2(
  observation: TrustedRuntimeMainHealthBaselineObservation,
  expected: Readonly<{ baselineSha: string; baselineTreeSha: string }>
): void {
  if (!trustedRuntimeMainHealthCarryForwardBaselineMatches(observation, expected)) {
    fail('MainHealth carry-forward baseline differs from the exact merged commit parent');
  }
}

export function trustedRuntimeMainHealthCarryForwardBaselineMatches(
  observation: TrustedRuntimeMainHealthBaselineObservation,
  expected: Readonly<{ baselineSha: string; baselineTreeSha: string }>
): boolean {
  return observation.baselineSha === sha(expected.baselineSha, 'expected MainHealth baselineSha')
    && observation.baselineTreeSha === sha(
        expected.baselineTreeSha,
        'expected MainHealth baselineTreeSha'
      );
}

export function createTrustedRuntimeMainHealthReceipt(input: Omit<
  TrustedRuntimeMainHealthReceipt,
  'schema' | 'receiptDigest'
>): TrustedRuntimeMainHealthReceipt {
  if ((input.origin !== 'physical-main' && input.origin !== 'verified-candidate-transition')
      || input.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
      || input.networkIsolatedBeforeExecution !== true
      || input.planDigest !== TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST
      || input.actionResults.length !== TRUSTED_RUNTIME_MAIN_HEALTH_ACTIONS.length
      || input.actionResults.some((result, index) =>
        result.actionId !== TRUSTED_RUNTIME_MAIN_HEALTH_ACTIONS[index]!.id)) {
    fail('MainHealth receipt fixed execution identity is invalid');
  }
  const mainSha = sha(input.mainSha, 'MainHealth mainSha');
  const mainTreeSha = sha(input.mainTreeSha, 'MainHealth mainTreeSha');
  const baselineSha = sha(input.baselineSha, 'MainHealth baselineSha');
  const baselineTreeSha = sha(input.baselineTreeSha, 'MainHealth baselineTreeSha');
  const expectedBaselineObservationDigest = digestValue(Object.freeze({
    schema: TRUSTED_RUNTIME_MAIN_HEALTH_BASELINE_OBSERVATION_SCHEMA,
    mainSha,
    mainTreeSha,
    baselineSha,
    baselineTreeSha
  }));
  if (input.baselineObservationDigest !== expectedBaselineObservationDigest) {
    fail('MainHealth receipt baseline observation digest is invalid');
  }
  let transition: TrustedRuntimeMainHealthReceipt['transition'];
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
    schema: TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA,
    origin: input.origin,
    repository: repository(input.repository),
    mainSha,
    mainTreeSha,
    baselineSha,
    baselineTreeSha,
    baselineObservationDigest: expectedBaselineObservationDigest,
    executionId: bounded(input.executionId, 'MainHealth executionId'),
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    dockerEndpoint: parseDockerEndpointIdentity(input.dockerEndpoint),
    networkIsolatedBeforeExecution: true as const,
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
    actionResults: Object.freeze(input.actionResults.map((entry, index) => Object.freeze({
      actionId: entry.actionId,
      resultDigest: digest(entry.resultDigest, `MainHealth actionResults[${index}].resultDigest`)
    }))),
    transition,
    observedAt: canonicalInstant(input.observedAt, 'MainHealth observedAt')
  });
  return Object.freeze({ ...withoutDigest, receiptDigest: digestValue(withoutDigest) });
}

export function parseTrustedRuntimeMainHealthReceipt(
  value: unknown
): TrustedRuntimeMainHealthReceipt {
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
    'schema', 'origin', 'repository', 'mainSha', 'mainTreeSha', 'baselineSha',
    'baselineTreeSha', 'baselineObservationDigest', 'executionId', 'imageId',
    'dockerEndpoint', 'networkIsolatedBeforeExecution', 'planDigest',
    'actionResults', 'transition', 'observedAt', 'receiptDigest'
  ].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
      || record.schema !== TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA
      || record.imageId !== TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
      || record.networkIsolatedBeforeExecution !== true
      || record.planDigest !== TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST
      || !Array.isArray(record.actionResults)) {
    fail('MainHealth receipt shape or fixed identity is invalid');
  }
  const rebuilt = createTrustedRuntimeMainHealthReceipt({
    origin: record.origin as TrustedRuntimeMainHealthReceipt['origin'],
    repository: repository(record.repository),
    mainSha: sha(record.mainSha, 'MainHealth mainSha'),
    mainTreeSha: sha(record.mainTreeSha, 'MainHealth mainTreeSha'),
    baselineSha: sha(record.baselineSha, 'MainHealth baselineSha'),
    baselineTreeSha: sha(record.baselineTreeSha, 'MainHealth baselineTreeSha'),
    baselineObservationDigest: digest(
      record.baselineObservationDigest,
      'MainHealth baselineObservationDigest'
    ),
    executionId: bounded(record.executionId, 'MainHealth executionId'),
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    dockerEndpoint: parseDockerEndpointIdentity(record.dockerEndpoint),
    networkIsolatedBeforeExecution: true,
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
    actionResults: record.actionResults as TrustedRuntimeMainHealthReceipt['actionResults'],
    transition: record.transition as TrustedRuntimeMainHealthReceipt['transition'],
    observedAt: canonicalInstant(record.observedAt, 'MainHealth observedAt')
  });
  if (rebuilt.receiptDigest !== digest(record.receiptDigest, 'MainHealth receiptDigest')) {
    fail('MainHealth receipt digest mismatch');
  }
  return rebuilt;
}

export function trustedRuntimeMainHealthSupersessionReceiptBytes(
  record: TrustedRuntimeMainHealthSupersessionReceipt
): Buffer {
  return Buffer.from(`${encodeVerificationActionData(record)}\n`, 'utf8');
}

/**
 * Computes the idempotency identity of the only external write in the
 * MainHealth supersession operation.  Provider observation timestamps are
 * deliberately absent: retry/recovery must address the same request.
 */
export function trustedRuntimeMainHealthSupersessionRequestDigest(
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization
): Digest {
  const request = trustedRuntimeMainHealthSupersessionStatusRequest(authorization);
  return digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-main-health-supersession-request-v2',
    repository: authorization.repository,
    mainSha: authorization.mainSha,
    operationId: authorization.operationId,
    predecessorRecordDigest: authorization.predecessorRecordDigest,
    state: request.state,
    context: request.context,
    description: request.description,
    targetUrl: request.targetUrl
  }));
}

function trustedRuntimeMainHealthSupersessionSemanticDigest(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  preparedIntentDigest: Digest;
  providerAuthorization: TrustedRuntimeMainHealthSupersessionReceipt['providerAuthorization'];
}>): Digest {
  const authorization = input.authorization;
  return digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-main-health-supersession-semantic-v2',
    repository: authorization.repository,
    mainSha: authorization.mainSha,
    mainTreeSha: authorization.mainTreeSha,
    operationId: authorization.operationId,
    operationLeaseName: authorization.operationLeaseName,
    predecessorRecordDigest: authorization.predecessorRecordDigest,
    preparedIntentDigest: input.preparedIntentDigest,
    runtimeAuthorityBinding: authorization.runtimeAuthorityBinding,
    issuer: Object.freeze({
      transport: authorization.issuer.transport,
      login: authorization.issuer.login,
      nodeId: authorization.issuer.nodeId,
      permission: authorization.issuer.permission
    }),
    sourceName: authorization.sourceName,
    source: authorization.source,
    localReceiptDigest: authorization.localReceipt.receiptDigest,
    localHealthRevision: authorization.localHealthRevision,
    hostedAuthorityDigest: authorization.hostedAuthorityDigest,
    effectAuthorizationDigest: authorization.effectAuthorizationDigest,
    providerAuthorization: Object.freeze({
      transport: input.providerAuthorization.transport,
      statusId: input.providerAuthorization.statusId,
      statusNodeId: input.providerAuthorization.statusNodeId,
      state: input.providerAuthorization.state,
      context: input.providerAuthorization.context,
      description: input.providerAuthorization.description,
      targetUrl: input.providerAuthorization.targetUrl,
      creator: input.providerAuthorization.creator
    })
  }));
}

export function createTrustedRuntimeMainHealthSupersessionIntent(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  preparedAt: string;
}>): TrustedRuntimeMainHealthSupersessionIntent {
  const authorization = createTrustedRuntimeMainHealthSupersessionAuthorization({
    defaultBranch: input.authorization.hostedLedger.defaultBranch,
    sourceName: input.authorization.sourceName,
    source: Object.freeze({
      relativePath: input.authorization.sourceName,
      kind: 'file' as const,
      device: input.authorization.source.device,
      inode: input.authorization.source.inode,
      size: input.authorization.source.size,
      bytes: Buffer.from(
        `${encodeVerificationActionData(input.authorization.localReceipt)}\n`,
        'utf8'
      ),
      linkTarget: null
    }),
    localReceipt: input.authorization.localReceipt,
    hostedLedger: input.authorization.hostedLedger,
    hostedAuthorityDigest: input.authorization.hostedAuthorityDigest,
    runtimeAuthorityBinding: input.authorization.runtimeAuthorityBinding,
    predecessorRecordDigest: input.authorization.predecessorRecordDigest,
    issuer: input.authorization.issuer
  });
  if (encodeVerificationActionData(authorization)
      !== encodeVerificationActionData(input.authorization)) {
    fail('MainHealth supersession prepared authorization is not canonical');
  }
  const preparedAt = canonicalInstant(input.preparedAt, 'MainHealth supersession preparedAt');
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_INTENT_SCHEMA,
    phase: 'prepared' as const,
    authorization,
    preparedAt,
    requestDigest: trustedRuntimeMainHealthSupersessionRequestDigest(authorization)
  });
  return Object.freeze({ ...withoutDigest, intentDigest: digestValue(withoutDigest) });
}

export function parseTrustedRuntimeMainHealthSupersessionIntent(
  value: unknown
): TrustedRuntimeMainHealthSupersessionIntent {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      fail('MainHealth supersession intent is not JSON');
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('MainHealth supersession intent must be an object');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = ['authorization', 'intentDigest', 'phase', 'preparedAt', 'requestDigest', 'schema'];
  const actualKeys = Object.keys(record).sort();
  if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== [...expectedKeys].sort()[index])
      || record.schema !== TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_INTENT_SCHEMA
      || record.phase !== 'prepared') {
    fail('MainHealth supersession intent shape is invalid');
  }
  const authorization = parseTrustedRuntimeMainHealthSupersessionAuthorization(record.authorization);
  const rebuilt = createTrustedRuntimeMainHealthSupersessionIntent({
    authorization,
    preparedAt: canonicalInstant(record.preparedAt, 'MainHealth supersession preparedAt')
  });
  if (rebuilt.requestDigest !== digest(record.requestDigest, 'MainHealth supersession requestDigest')
      || rebuilt.intentDigest !== digest(record.intentDigest, 'MainHealth supersession intentDigest')
      || encodeVerificationActionData(rebuilt) !== encodeVerificationActionData(record)) {
    fail('MainHealth supersession intent digest or canonical bytes mismatch');
  }
  return rebuilt;
}

function trustedRuntimeMainHealthSupersessionPermitValue(
  input: Readonly<{
    phase: 'available' | 'consumed';
    repository: string;
    mainSha: string;
    mainTreeSha: string;
    operationId: Digest;
    predecessorRecordDigest: Digest | null;
    intentDigest: Digest;
    requestDigest: Digest;
    effectAuthorizationDigest: Digest;
    runtimeAuthorityBinding: Digest;
    hostedAuthorityDigest: Digest;
  }>
): Omit<TrustedRuntimeMainHealthSupersessionPermit, 'permitDigest'> {
  return Object.freeze({
    schema: TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_PERMIT_SCHEMA,
    phase: input.phase,
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    operationId: input.operationId,
    predecessorRecordDigest: input.predecessorRecordDigest,
    intentDigest: input.intentDigest,
    requestDigest: input.requestDigest,
    effectAuthorizationDigest: input.effectAuthorizationDigest,
    runtimeAuthorityBinding: input.runtimeAuthorityBinding,
    hostedAuthorityDigest: input.hostedAuthorityDigest
  });
}

export function createTrustedRuntimeMainHealthSupersessionPermit(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  intentDigest: Digest;
  phase: 'available' | 'consumed';
}>): TrustedRuntimeMainHealthSupersessionPermit {
  const authorization = input.authorization;
  const value = trustedRuntimeMainHealthSupersessionPermitValue({
    phase: input.phase,
    repository: repository(authorization.repository),
    mainSha: sha(authorization.mainSha, 'MainHealth supersession permit mainSha'),
    mainTreeSha: sha(authorization.mainTreeSha, 'MainHealth supersession permit mainTreeSha'),
    operationId: digest(authorization.operationId, 'MainHealth supersession permit operationId') as Digest,
    predecessorRecordDigest: authorization.predecessorRecordDigest === null
      ? null
      : digest(
        authorization.predecessorRecordDigest,
        'MainHealth supersession permit predecessorRecordDigest'
      ) as Digest,
    intentDigest: digest(input.intentDigest, 'MainHealth supersession permit intentDigest') as Digest,
    requestDigest: digest(
      trustedRuntimeMainHealthSupersessionRequestDigest(authorization),
      'MainHealth supersession permit requestDigest'
    ) as Digest,
    effectAuthorizationDigest: digest(
      authorization.effectAuthorizationDigest,
      'MainHealth supersession permit effectAuthorizationDigest'
    ) as Digest,
    runtimeAuthorityBinding: digest(
      authorization.runtimeAuthorityBinding,
      'MainHealth supersession permit runtimeAuthorityBinding'
    ) as Digest,
    hostedAuthorityDigest: digest(
      authorization.hostedAuthorityDigest,
      'MainHealth supersession permit hostedAuthorityDigest'
    ) as Digest
  });
  return Object.freeze({
    ...value,
    permitDigest: digestValue(value)
  });
}

export function trustedRuntimeMainHealthSupersessionPermitBytes(
  record: TrustedRuntimeMainHealthSupersessionPermit
): Buffer {
  return Buffer.from(`${encodeVerificationActionData(record)}\n`, 'utf8');
}

export function parseTrustedRuntimeMainHealthSupersessionPermit(
  value: unknown
): TrustedRuntimeMainHealthSupersessionPermit {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      fail('MainHealth supersession permit is not JSON');
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('MainHealth supersession permit must be an object');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'effectAuthorizationDigest', 'hostedAuthorityDigest', 'intentDigest',
    'mainSha', 'mainTreeSha', 'operationId', 'permitDigest',
    'phase', 'predecessorRecordDigest', 'repository', 'requestDigest',
    'runtimeAuthorityBinding', 'schema'
  ];
  const actualKeys = Object.keys(record).sort();
  if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== expectedKeys[index])
      || record.schema !== TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_PERMIT_SCHEMA
      || record.phase !== 'available' && record.phase !== 'consumed') {
    fail('MainHealth supersession permit shape is invalid');
  }
  const normalized = trustedRuntimeMainHealthSupersessionPermitValue({
    phase: record.phase,
    repository: repository(record.repository),
    mainSha: sha(record.mainSha, 'MainHealth supersession permit mainSha'),
    mainTreeSha: sha(record.mainTreeSha, 'MainHealth supersession permit mainTreeSha'),
    operationId: digest(record.operationId, 'MainHealth supersession permit operationId') as Digest,
    predecessorRecordDigest: record.predecessorRecordDigest === null
      ? null
      : digest(
        record.predecessorRecordDigest,
        'MainHealth supersession permit predecessorRecordDigest'
      ) as Digest,
    intentDigest: digest(record.intentDigest, 'MainHealth supersession permit intentDigest') as Digest,
    requestDigest: digest(record.requestDigest, 'MainHealth supersession permit requestDigest') as Digest,
    effectAuthorizationDigest: digest(
      record.effectAuthorizationDigest,
      'MainHealth supersession permit effectAuthorizationDigest'
    ) as Digest,
    runtimeAuthorityBinding: digest(
      record.runtimeAuthorityBinding,
      'MainHealth supersession permit runtimeAuthorityBinding'
    ) as Digest,
    hostedAuthorityDigest: digest(
      record.hostedAuthorityDigest,
      'MainHealth supersession permit hostedAuthorityDigest'
    ) as Digest
  });
  const permitDigest = digest(record.permitDigest, 'MainHealth supersession permit permitDigest') as Digest;
  if (digestValue(normalized) !== permitDigest) {
    fail('MainHealth supersession permit digest mismatch');
  }
  return Object.freeze({ ...normalized, permitDigest });
}

export function createTrustedRuntimeMainHealthSupersessionAuthorization(input: Readonly<{
  defaultBranch: string;
  sourceName: string;
  source: NoFollowDirectoryTreeEntry;
  localReceipt: TrustedRuntimeMainHealthReceipt;
  hostedLedger: MainHealthLedger;
  hostedAuthorityDigest: Digest;
  runtimeAuthorityBinding: Digest;
  predecessorRecordDigest: Digest | null;
  issuer: Readonly<{
    transport: 'github-rest-token';
    login: string;
    nodeId: string;
    permission: 'admin' | 'maintain';
  }>;
}>): TrustedRuntimeMainHealthSupersessionAuthorization {
  const localReceipt = parseTrustedRuntimeMainHealthReceipt(
    encodeVerificationActionData(input.localReceipt)
  );
  const defaultBranch = bounded(input.defaultBranch, 'MainHealth supersession defaultBranch');
  const sourceName = bounded(input.sourceName, 'MainHealth supersession sourceName');
  const expectedSourceName = `main-${localReceipt.mainSha}.json`;
  const localReceiptBytes = Buffer.from(
    `${encodeVerificationActionData(localReceipt)}\n`,
    'utf8'
  );
  if (sourceName !== expectedSourceName
      || input.source.relativePath !== sourceName
      || input.source.kind !== 'file'
      || input.source.linkTarget !== null
      || input.source.bytes === null
      || !Number.isSafeInteger(input.source.size)
      || input.source.size !== localReceiptBytes.byteLength
      || !Buffer.from(input.source.bytes).equals(localReceiptBytes)) {
    fail('MainHealth supersession source is not the exact canonical receipt preimage');
  }
  const hostedLedger = parseMainHealthLedger(encodeVerificationActionData(input.hostedLedger));
  if (hostedLedger.repository !== localReceipt.repository
      || hostedLedger.defaultBranch !== defaultBranch
      || hostedLedger.mainSha !== localReceipt.mainSha
      || hostedLedger.mainTreeSha !== localReceipt.mainTreeSha
      || hostedLedger.trustRevision !== localReceipt.mainSha
      || hostedLedger.producer.sourceTransport !== 'github-api') {
    fail('MainHealth supersession hosted provider is not exact or authenticated');
  }
  const localHealthRevision = createMainHealthRevision({
    repository: localReceipt.repository,
    defaultBranch,
    mainSha: localReceipt.mainSha,
    mainTreeSha: localReceipt.mainTreeSha,
    status: 'healthy',
    failureFingerprints: Object.freeze([]),
    owner: null,
    repairWorkPackage: null,
    allowedLanes: Object.freeze(['ordinary'] as const),
    trustRevision: localReceipt.mainSha
  });
  if (hostedLedger.healthRevision === localHealthRevision) {
    fail('MainHealth supersession requires a semantic provider conflict');
  }
  const hostedAuthorityDigest = digest(
    input.hostedAuthorityDigest,
    'MainHealth supersession hostedAuthorityDigest'
  );
  const runtimeAuthorityBinding = digest(
    input.runtimeAuthorityBinding,
    'MainHealth supersession runtimeAuthorityBinding'
  );
  const predecessorRecordDigest = input.predecessorRecordDigest === null
    ? null
    : digest(
      input.predecessorRecordDigest,
      'MainHealth supersession predecessorRecordDigest'
    );
  const login = bounded(input.issuer.login, 'MainHealth supersession issuer login');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login)
      || (input.issuer.permission !== 'admin' && input.issuer.permission !== 'maintain')) {
    fail('MainHealth supersession issuer lacks a canonical maintain/admin identity');
  }
  const issuer = Object.freeze({
    transport: 'github-rest-token' as const,
    login,
    nodeId: bounded(input.issuer.nodeId, 'MainHealth supersession issuer nodeId'),
    permission: input.issuer.permission
  });
  const source = Object.freeze({
    device: bounded(input.source.device, 'MainHealth supersession source device'),
    inode: bounded(input.source.inode, 'MainHealth supersession source inode'),
    size: input.source.size,
    byteDigest: digestBytes(localReceiptBytes)
  });
  const operationId = digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-main-health-supersession-operation-v2',
    effect: 'prefer-exact-registered-hosted-provider',
    repository: localReceipt.repository,
    mainSha: localReceipt.mainSha,
    mainTreeSha: localReceipt.mainTreeSha,
    sourceName,
    source,
    localHealthRevision,
    hostedAuthorityDigest,
    runtimeAuthorityBinding,
    predecessorRecordDigest,
    issuer: Object.freeze({
      transport: issuer.transport,
      login: issuer.login,
      nodeId: issuer.nodeId
    })
  }));
  // The lease is owned by the exact receipt subject, not by one proposed
  // operation.  Two callers observing the same maximal predecessor must
  // serialize before either can publish a prepared intent or issue the
  // external POST; otherwise distinct operationIds would fork the chain.
  const subjectLeaseDigest = digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-main-health-supersession-subject-v2',
    repository: localReceipt.repository,
    mainSha: localReceipt.mainSha,
    mainTreeSha: localReceipt.mainTreeSha,
    sourceName
  }));
  const operationLeaseName = `.main-health-supersession-subject-${subjectLeaseDigest.slice('sha256:'.length)}.lock`;
  const effectAuthorizationDigest = digestValue(Object.freeze({
    schema: 'sec-trusted-runtime-main-health-supersession-authorization-v2',
    operationId,
    operationLeaseName,
    issuer: Object.freeze({
      transport: issuer.transport,
      login: issuer.login,
      nodeId: issuer.nodeId
    }),
    hostedAuthorityDigest,
    runtimeAuthorityBinding,
    sourceByteDigest: source.byteDigest,
    localReceiptDigest: localReceipt.receiptDigest,
    predecessorRecordDigest
  }));
  return Object.freeze({
    repository: localReceipt.repository,
    mainSha: localReceipt.mainSha,
    mainTreeSha: localReceipt.mainTreeSha,
    operationId,
    operationLeaseName,
    issuer,
    sourceName,
    source,
    localReceipt,
    localHealthRevision,
    hostedLedger,
    hostedAuthorityDigest,
    runtimeAuthorityBinding,
    predecessorRecordDigest,
    effectAuthorizationDigest
  });
}

function parseTrustedRuntimeMainHealthSupersessionAuthorization(
  value: unknown
): TrustedRuntimeMainHealthSupersessionAuthorization {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('MainHealth supersession authorization must be an object');
  }
  const record = value as Record<string, unknown>;
  const source = record.source;
  const issuer = record.issuer;
  if (source === null || typeof source !== 'object' || Array.isArray(source)
      || issuer === null || typeof issuer !== 'object' || Array.isArray(issuer)) {
    fail('MainHealth supersession authorization shape is invalid');
  }
  const sourceRecord = source as Record<string, unknown>;
  const issuerRecord = issuer as Record<string, unknown>;
  const localReceipt = parseTrustedRuntimeMainHealthReceipt(record.localReceipt);
  const hostedLedger = parseMainHealthLedger(encodeVerificationActionData(record.hostedLedger));
  const sourceBytes = Buffer.from(`${encodeVerificationActionData(localReceipt)}\n`, 'utf8');
  return createTrustedRuntimeMainHealthSupersessionAuthorization({
    defaultBranch: hostedLedger.defaultBranch,
    sourceName: bounded(record.sourceName, 'MainHealth supersession sourceName'),
    source: Object.freeze({
      relativePath: bounded(record.sourceName, 'MainHealth supersession sourceName'),
      kind: 'file' as const,
      device: bounded(sourceRecord.device, 'MainHealth supersession source device'),
      inode: bounded(sourceRecord.inode, 'MainHealth supersession source inode'),
      size: Number(sourceRecord.size),
      bytes: sourceBytes,
      linkTarget: null
    }),
    localReceipt,
    hostedLedger,
    hostedAuthorityDigest: digest(
      record.hostedAuthorityDigest,
      'MainHealth supersession hostedAuthorityDigest'
    ),
    runtimeAuthorityBinding: digest(
      record.runtimeAuthorityBinding,
      'MainHealth supersession runtimeAuthorityBinding'
    ),
    predecessorRecordDigest: record.predecessorRecordDigest === null
      ? null
      : digest(
        record.predecessorRecordDigest,
        'MainHealth supersession predecessorRecordDigest'
      ),
    issuer: Object.freeze({
      transport: 'github-rest-token' as const,
      login: bounded(issuerRecord.login, 'MainHealth supersession issuer login'),
      nodeId: bounded(issuerRecord.nodeId, 'MainHealth supersession issuer nodeId'),
      permission: issuerRecord.permission as 'admin' | 'maintain'
    })
  });
}

export function trustedRuntimeMainHealthSupersessionStatusRequest(
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization
): Readonly<{
  state: 'success';
  context: string;
  description: string;
  targetUrl: string;
}> {
  return Object.freeze({
    state: 'success',
    context: `SEC MainHealth Supersession / ${authorization.operationId.slice('sha256:'.length)}`,
    description: `SEC MainHealth supersession ${authorization.effectAuthorizationDigest}`,
    targetUrl: `https://github.com/${authorization.repository}/commit/${authorization.mainSha}`
  });
}

export function createTrustedRuntimeMainHealthSupersessionReceipt(input: Readonly<{
  authorization: TrustedRuntimeMainHealthSupersessionAuthorization;
  preparedIntentDigest: Digest;
  providerAuthorization: TrustedRuntimeMainHealthSupersessionReceipt['providerAuthorization'];
}>): TrustedRuntimeMainHealthSupersessionReceipt {
  const supplied = input.authorization;
  const localReceiptBytes = Buffer.from(
    `${encodeVerificationActionData(supplied.localReceipt)}\n`,
    'utf8'
  );
  const authorization = createTrustedRuntimeMainHealthSupersessionAuthorization({
    defaultBranch: supplied.hostedLedger.defaultBranch,
    sourceName: supplied.sourceName,
    source: Object.freeze({
      relativePath: supplied.sourceName,
      kind: 'file' as const,
      device: supplied.source.device,
      inode: supplied.source.inode,
      size: supplied.source.size,
      bytes: localReceiptBytes,
      linkTarget: null
    }),
    localReceipt: supplied.localReceipt,
    hostedLedger: supplied.hostedLedger,
    hostedAuthorityDigest: supplied.hostedAuthorityDigest,
    runtimeAuthorityBinding: supplied.runtimeAuthorityBinding,
    predecessorRecordDigest: supplied.predecessorRecordDigest,
    issuer: supplied.issuer
  });
  if (encodeVerificationActionData(authorization)
      !== encodeVerificationActionData(supplied)) {
    fail('MainHealth supersession authorization is not canonical');
  }
  const expected = trustedRuntimeMainHealthSupersessionStatusRequest(authorization);
  const rawProvider = input.providerAuthorization;
  if (rawProvider.transport !== 'github-commit-status'
      || !Number.isSafeInteger(rawProvider.statusId) || rawProvider.statusId <= 0
      || rawProvider.state !== expected.state
      || rawProvider.context !== expected.context
      || rawProvider.description !== expected.description
      || rawProvider.targetUrl !== expected.targetUrl
      || rawProvider.creator.login !== authorization.issuer.login
      || rawProvider.creator.nodeId !== authorization.issuer.nodeId) {
    fail('MainHealth supersession provider authorization is not exact');
  }
  const createdAt = canonicalInstant(
    rawProvider.createdAt,
    'MainHealth supersession provider createdAt'
  );
  const updatedAt = canonicalInstant(
    rawProvider.updatedAt,
    'MainHealth supersession provider updatedAt'
  );
  if (createdAt !== updatedAt) {
    fail('MainHealth supersession provider authorization is not append-only');
  }
  const providerAuthorization = Object.freeze({
    transport: 'github-commit-status' as const,
    statusId: rawProvider.statusId,
    statusNodeId: bounded(
      rawProvider.statusNodeId,
      'MainHealth supersession provider statusNodeId'
    ),
    state: 'success' as const,
    context: bounded(rawProvider.context, 'MainHealth supersession provider context'),
    description: bounded(
      rawProvider.description,
      'MainHealth supersession provider description'
    ),
    targetUrl: bounded(rawProvider.targetUrl, 'MainHealth supersession provider targetUrl'),
    createdAt,
    updatedAt,
    creator: Object.freeze({
      login: bounded(
        rawProvider.creator.login,
        'MainHealth supersession provider creator login'
      ),
      nodeId: bounded(
        rawProvider.creator.nodeId,
        'MainHealth supersession provider creator nodeId'
      )
      })
  });
  const preparedIntentDigest = digest(
    input.preparedIntentDigest,
    'MainHealth supersession preparedIntentDigest'
  );
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_SCHEMA,
    phase: 'complete' as const,
    effect: 'prefer-exact-registered-hosted-provider' as const,
    reason: 'stronger-hosted-provider-conflict' as const,
    ...authorization,
    preparedIntentDigest,
    authorizedAt: createdAt,
    providerAuthorization
  });
  const semanticDigest = trustedRuntimeMainHealthSupersessionSemanticDigest({
    authorization,
    preparedIntentDigest,
    providerAuthorization
  });
  const record = Object.freeze({ ...withoutDigest, semanticDigest });
  return Object.freeze({ ...record, recordDigest: digestValue(record) });
}

export function parseTrustedRuntimeMainHealthSupersessionReceipt(
  value: unknown
): TrustedRuntimeMainHealthSupersessionReceipt {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      fail('MainHealth supersession receipt is not JSON');
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('MainHealth supersession receipt must be an object');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    'schema', 'phase', 'effect', 'reason', 'repository', 'mainSha', 'mainTreeSha',
    'operationId', 'operationLeaseName', 'predecessorRecordDigest',
    'preparedIntentDigest', 'runtimeAuthorityBinding',
    'issuer', 'authorizedAt', 'sourceName',
    'source', 'localReceipt', 'localHealthRevision', 'hostedLedger',
    'hostedAuthorityDigest', 'effectAuthorizationDigest', 'providerAuthorization',
    'semanticDigest', 'recordDigest'
  ].sort();
  const actualKeys = Object.keys(record).sort();
  const source = record.source;
  const issuer = record.issuer;
  const providerAuthorization = record.providerAuthorization;
  if (actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== expectedKeys[index])
      || record.schema !== TRUSTED_RUNTIME_MAIN_HEALTH_SUPERSESSION_SCHEMA
      || record.phase !== 'complete'
      || record.effect !== 'prefer-exact-registered-hosted-provider'
      || record.reason !== 'stronger-hosted-provider-conflict'
      || source === null || typeof source !== 'object' || Array.isArray(source)
      || issuer === null || typeof issuer !== 'object' || Array.isArray(issuer)
      || providerAuthorization === null || typeof providerAuthorization !== 'object'
      || Array.isArray(providerAuthorization)) {
    fail('MainHealth supersession receipt shape is invalid');
  }
  const sourceRecord = source as Record<string, unknown>;
  const sourceKeys = Object.keys(sourceRecord).sort();
  const issuerRecord = issuer as Record<string, unknown>;
  const issuerKeys = Object.keys(issuerRecord).sort();
  const providerRecord = providerAuthorization as Record<string, unknown>;
  const providerKeys = Object.keys(providerRecord).sort();
  const creator = providerRecord.creator;
  if (sourceKeys.join('\0') !== ['byteDigest', 'device', 'inode', 'size'].join('\0')
      || issuerKeys.join('\0') !== ['login', 'nodeId', 'permission', 'transport'].join('\0')
      || issuerRecord.transport !== 'github-rest-token'
      || providerKeys.join('\0') !== [
        'context', 'createdAt', 'creator', 'description', 'state', 'statusId',
        'statusNodeId', 'targetUrl', 'transport', 'updatedAt'
      ].join('\0')
      || creator === null || typeof creator !== 'object' || Array.isArray(creator)
      || Object.keys(creator as Record<string, unknown>).sort().join('\0')
        !== ['login', 'nodeId'].join('\0')
      || !Number.isSafeInteger(sourceRecord.size) || (sourceRecord.size as number) <= 0) {
    fail('MainHealth supersession source or issuer identity is invalid');
  }
  const localReceipt = parseTrustedRuntimeMainHealthReceipt(record.localReceipt);
  const localReceiptBytes = Buffer.from(`${encodeVerificationActionData(localReceipt)}\n`, 'utf8');
  if (localReceiptBytes.byteLength !== sourceRecord.size
      || digestBytes(localReceiptBytes) !== digest(
        sourceRecord.byteDigest,
        'MainHealth supersession byteDigest'
      )) {
    fail('MainHealth supersession source byte identity is invalid');
  }
  const hostedLedger = parseMainHealthLedger(encodeVerificationActionData(record.hostedLedger));
  const authorization = createTrustedRuntimeMainHealthSupersessionAuthorization({
    defaultBranch: hostedLedger.defaultBranch,
    sourceName: bounded(record.sourceName, 'MainHealth supersession sourceName'),
    source: Object.freeze({
      relativePath: bounded(record.sourceName, 'MainHealth supersession sourceName'),
      kind: 'file' as const,
      device: bounded(sourceRecord.device, 'MainHealth supersession source device'),
      inode: bounded(sourceRecord.inode, 'MainHealth supersession source inode'),
      size: sourceRecord.size as number,
      bytes: localReceiptBytes,
      linkTarget: null
    }),
    localReceipt,
    hostedLedger,
    hostedAuthorityDigest: digest(
      record.hostedAuthorityDigest,
      'MainHealth supersession hostedAuthorityDigest'
    ),
    runtimeAuthorityBinding: digest(
      record.runtimeAuthorityBinding,
      'MainHealth supersession runtimeAuthorityBinding'
    ),
    predecessorRecordDigest: record.predecessorRecordDigest === null
      ? null
      : digest(
        record.predecessorRecordDigest,
        'MainHealth supersession predecessorRecordDigest'
      ),
    issuer: Object.freeze({
      transport: 'github-rest-token' as const,
      login: bounded(issuerRecord.login, 'MainHealth supersession issuer login'),
      nodeId: bounded(issuerRecord.nodeId, 'MainHealth supersession issuer nodeId'),
      permission: issuerRecord.permission as 'admin' | 'maintain'
    })
  });
  const creatorRecord = creator as Record<string, unknown>;
  const rebuilt = createTrustedRuntimeMainHealthSupersessionReceipt({
    authorization,
    preparedIntentDigest: digest(
      record.preparedIntentDigest,
      'MainHealth supersession preparedIntentDigest'
    ),
    providerAuthorization: Object.freeze({
      transport: providerRecord.transport as 'github-commit-status',
      statusId: providerRecord.statusId as number,
      statusNodeId: bounded(
        providerRecord.statusNodeId,
        'MainHealth supersession provider statusNodeId'
      ),
      state: providerRecord.state as 'success',
      context: bounded(providerRecord.context, 'MainHealth supersession provider context'),
      description: bounded(
        providerRecord.description,
        'MainHealth supersession provider description'
      ),
      targetUrl: bounded(
        providerRecord.targetUrl,
        'MainHealth supersession provider targetUrl'
      ),
      createdAt: canonicalInstant(
        providerRecord.createdAt,
        'MainHealth supersession provider createdAt'
      ),
      updatedAt: canonicalInstant(
        providerRecord.updatedAt,
        'MainHealth supersession provider updatedAt'
      ),
      creator: Object.freeze({
        login: bounded(
          creatorRecord.login,
          'MainHealth supersession provider creator login'
        ),
        nodeId: bounded(
          creatorRecord.nodeId,
          'MainHealth supersession provider creator nodeId'
        )
      })
    })
  });
  if (rebuilt.repository !== repository(record.repository)
      || rebuilt.mainSha !== sha(record.mainSha, 'MainHealth supersession mainSha')
      || rebuilt.mainTreeSha !== sha(record.mainTreeSha, 'MainHealth supersession mainTreeSha')
      || rebuilt.authorizedAt !== canonicalInstant(
        record.authorizedAt,
        'MainHealth supersession authorizedAt'
      )
      || rebuilt.operationId !== digest(record.operationId, 'MainHealth supersession operationId')
      || rebuilt.operationLeaseName !== bounded(record.operationLeaseName, 'MainHealth supersession operationLeaseName')
      || rebuilt.localHealthRevision !== digest(record.localHealthRevision, 'MainHealth supersession localHealthRevision')
      || rebuilt.effectAuthorizationDigest !== digest(record.effectAuthorizationDigest, 'MainHealth supersession effectAuthorizationDigest')
      || rebuilt.runtimeAuthorityBinding !== digest(
      record.runtimeAuthorityBinding,
      'MainHealth supersession runtimeAuthorityBinding'
      )
      || rebuilt.predecessorRecordDigest !== (record.predecessorRecordDigest === null
        ? null
        : digest(
          record.predecessorRecordDigest,
          'MainHealth supersession predecessorRecordDigest'
        ))
      || rebuilt.preparedIntentDigest !== digest(
        record.preparedIntentDigest,
        'MainHealth supersession preparedIntentDigest'
      )
      || rebuilt.semanticDigest !== digest(
        record.semanticDigest,
        'MainHealth supersession semanticDigest'
      )
      || rebuilt.recordDigest !== digest(record.recordDigest, 'MainHealth supersession recordDigest')
      || encodeVerificationActionData(rebuilt) !== encodeVerificationActionData(record)) {
    fail('MainHealth supersession receipt digest or subject is invalid');
  }
  return rebuilt;
}

interface TrustedRuntimeWorkspace {
  readonly containerName: string;
  readonly temporaryRoot: string;
  readonly image: TrustedRuntimeContainerImageObservation;
  readonly containerEngineSession: ContainerEngineSession;
  readonly dockerEndpoint: DockerEndpointIdentity;
  readonly dependencyCacheKey: Digest | null;
}

async function withTrustedRuntimeWorkspace<T>(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  baseSha: string;
  headSha: string;
  operationKey: string;
  setupMode: 'full' | 'lifecycle-canary' | 'dependency-canary';
  execute: (workspace: TrustedRuntimeWorkspace) => Promise<T>;
}>): Promise<T> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const repositoryIdentity = repository(input.repository);
  const baseSha = sha(input.baseSha, 'workspace baseSha');
  const headSha = sha(input.headSha, 'workspace headSha');
  if (!/^[a-z0-9][a-z0-9-]{7,47}$/u.test(input.operationKey)) {
    fail('workspace operation key is invalid');
  }
  const runtimeLayout = resolveSecRuntimeStateForRepository({
    repository: repositoryIdentity,
    repositoryRoot
  });
  const operationLeaseRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-runtime-container-leases',
    'v1'
  );
  const operationLeaseAuthority = await acquireSecRuntimeStatePhysicalAuthority({
    repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [operationLeaseRoot]
  });
  const operationLease = acquirePhysicalMutationLease(
    operationLeaseAuthority.directory(operationLeaseRoot),
    `container-${input.operationKey}.lock`
  );
  if (operationLease === null) {
    fail('trusted runtime operation is already active or its owner liveness is unknown');
  }
  let containerEngineSession: ContainerEngineSession | null = null;
  try {
    const resourceEnvelopeProviderIdentityDigest = digestValue(Object.freeze({
      schema: 'sec-container-engine-session-resource-envelope-provider-v1',
      repository: repositoryIdentity,
      operationKey: input.operationKey
    })) as SecOperationDigest;
    const operation = bindTrustedRuntimeContainerEngineOperation({
      repositoryRoot,
      repository: repositoryIdentity,
      baseSha,
      headSha,
      operationKey: input.operationKey,
      setupMode: input.setupMode,
      providerIdentityDigest: resourceEnvelopeProviderIdentityDigest
    });
    containerEngineSession = await openContainerEngineSession({
      operation,
      cwd: repositoryRoot,
      availability: 'ensure-started'
    });
    const session = containerEngineSession;
    const dockerEndpoint = session.endpoint;
    const setupOperation = bindTrustedRuntimeContainerEngineOperation({
      repositoryRoot,
      repository: repositoryIdentity,
      baseSha,
      headSha,
      operationKey: `${input.operationKey}-setup`,
      setupMode: input.setupMode,
      providerIdentityDigest: session.providerIdentityDigest,
      deadlineAtUnixMs: session.deadlineAtUnixMs
    });
    const setupScope = session.openOperationScope({
      operation: setupOperation,
      requirementId: 'external.container-engine-process'
    });
    let setupSettled = false;
    const image = await ensureImage(repositoryRoot, session);
    const endpointDigest = digestValue(dockerEndpoint);
    const dependencyCacheMarker = input.setupMode === 'lifecycle-canary'
      ? null
      : createTrustedRuntimeDependencyCacheMarker({
          repository: repositoryIdentity,
          bunLockBlobSha: await command(
            'git', ['rev-parse', `${baseSha}:bun.lock`], repositoryRoot
          ),
          imageId: image.imageId
        });
    const dependencyCacheVolume = dependencyCacheMarker === null
      ? null
      : await ensureTrustedRuntimeDependencyCacheVolume({
          session,
          endpointDigest,
          marker: dependencyCacheMarker
        });
    await reclaimAbandonedTrustedRuntimeContainers({
      session,
      operationKey: input.operationKey,
      repository: repositoryIdentity,
      baseSha,
      headSha,
      endpointDigest,
      imageId: image.imageId,
      imageLabels: image.labels,
      dependencyCacheVolumeName: dependencyCacheVolume?.spec.name ?? null,
      ...(dependencyCacheMarker === null ? {} : {
        dependencyCacheKey: dependencyCacheMarker.cacheKey
      })
    });
    const ownerNonce = randomUUID();
    const containerName = `sec-trusted-runtime-${input.operationKey}-${ownerNonce}`;
    const operationLabels = Object.freeze({
      'sec.trusted-runtime.operation': input.operationKey,
      'sec.trusted-runtime.repository': repositoryIdentity,
      'sec.trusted-runtime.base-sha': baseSha,
      'sec.trusted-runtime.head-sha': headSha,
      'sec.trusted-runtime.endpoint-digest': endpointDigest,
      'sec.trusted-runtime.owner-host': TRUSTED_RUNTIME_OWNER_HOST,
      'sec.trusted-runtime.owner-pid': String(process.pid),
      'sec.trusted-runtime.owner-nonce': ownerNonce,
      'sec.trusted-runtime.image-id': image.imageId,
      ...(dependencyCacheMarker === null ? {} : {
        'sec.trusted-runtime.dependency-cache-key': dependencyCacheMarker.cacheKey
      })
    });
    const containerLabels = composeTrustedRuntimeContainerLabels(image.labels, operationLabels);
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-trusted-runtime-'));
    let containerCreated = false;
    let containerId: string | null = null;
    try {
      const bundle = await createCandidateBundle({ repositoryRoot, temporaryRoot, baseSha, headSha });
      const dependencyCacheMarkerBytes = dependencyCacheMarker === null
        ? null
        : canonicalDependencyCacheMarkerBytes(dependencyCacheMarker);
      const dependencyCacheMarkerFileDigest = dependencyCacheMarkerBytes === null
        ? null
        : digestBytes(dependencyCacheMarkerBytes);
      containerId = await containerEngineOutput(session, {
        kind: 'container-create',
        arguments: ['--name', containerName,
        ...Object.entries(containerLabels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
        '--init',
        '--read-only',
        '--pids-limit', String(ENVIRONMENT.runtime.resources.trusted.pids),
        '--cpus', String(ENVIRONMENT.runtime.resources.trusted.cpus),
        '--memory', `${ENVIRONMENT.runtime.resources.trusted.memoryGiB}g`,
        '--tmpfs', TRUSTED_RUNTIME_TEST_TMPFS_SPEC,
        '--tmpfs', TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC,
        '--mount', `type=bind,source=${path.resolve(bundle)},target=${TRUSTED_RUNTIME_CANDIDATE_BUNDLE},readonly`,
        ...(dependencyCacheVolume === null ? [] : [
          '--mount', `type=volume,source=${dependencyCacheVolume.spec.name},target=${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH}`
        ]),
        image.imageId]
      });
      containerCreated = true;
      if (!/^[0-9a-f]{64}$/u.test(containerId)) {
        fail('Docker container create returned an invalid identity');
      }
      const containerTarget = containerId;
      const createdIdentity = await inspectContainerIdentity(
        session,
        containerTarget
      );
      if (createdIdentity.id !== containerTarget
          || createdIdentity.name !== containerName
          || createdIdentity.imageId !== image.imageId
          || createdIdentity.readOnlyRootfs !== true
          || createdIdentity.readOnlyCandidateBundle !== true
          || createdIdentity.initProcess !== true
          || createdIdentity.executableTestTmpfs !== true
          || createdIdentity.nonExecutableMutableTmpfs !== true
          || createdIdentity.dependencyCacheVolumeName
            !== (dependencyCacheVolume?.spec.name ?? null)
          || encodeVerificationActionData(createdIdentity.labels)
            !== encodeVerificationActionData(containerLabels)) {
        fail('Docker container creation readback differs from the retained attempt identity');
      }
      await containerEngineOutput(session, {
        kind: 'container-start', arguments: [containerTarget]
      });
      if (dependencyCacheMarkerBytes !== null && dependencyCacheMarkerFileDigest !== null) {
        const publishedMarkerDigest = digest(await containerEngineOutput(session, {
          kind: 'container-exec', arguments: [containerTarget, '/bin/bash', '-ceu',
          PUBLISH_DEPENDENCY_CACHE_MARKER_SCRIPT, '--',
          Buffer.from(dependencyCacheMarkerBytes).toString('utf8').trimEnd(),
          dependencyCacheMarkerFileDigest]
        }), 'published dependency-cache marker digest');
        if (publishedMarkerDigest !== dependencyCacheMarkerFileDigest) {
          fail('published dependency-cache marker digest differs');
        }
      }
      await containerEngineOutput(session, {
        kind: 'container-exec',
        arguments: ['--user', '1000:1000', containerTarget, '/bin/mkdir', '-p', TRUSTED_RUNTIME_OUTPUT]
      });
      await containerEngineOutput(session, {
        kind: 'container-exec', arguments: ['--user', '1000:1000',
        ...createTrustedRuntimeCommandEnvironmentArgs({ HOME: '/home/ubuntu' }),
        containerTarget, '/bin/bash', '-lc', TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT, '--',
        baseSha, headSha, input.setupMode]
      });
      if (dependencyCacheMarkerFileDigest !== null) {
        const readbackDigest = digest(await containerEngineOutput(session, {
          kind: 'container-exec',
          arguments: [containerTarget, '/bin/bash', '-ceu', READ_DEPENDENCY_CACHE_MARKER_DIGEST_SCRIPT]
        }), 'dependency-cache marker readback digest');
        if (readbackDigest !== dependencyCacheMarkerFileDigest) {
          fail('dependency-cache marker changed during setup');
        }
      }
      const networksSource = await containerEngineOutput(session, {
        kind: 'container-inspect',
        arguments: ['--format', '{{json .NetworkSettings.Networks}}', containerTarget]
      });
      const networks = JSON.parse(networksSource) as Record<string, unknown>;
      for (const network of Object.keys(networks).sort()) {
        await containerEngineOutput(session, {
          kind: 'network-disconnect', arguments: [network, containerTarget]
        });
      }
      const isolated = JSON.parse(await containerEngineOutput(session, {
        kind: 'container-inspect',
        arguments: ['--format', '{{json .NetworkSettings.Networks}}', containerTarget]
      })) as Record<string, unknown>;
      if (Object.keys(isolated).length !== 0) {
        fail('network isolation readback is not empty before trusted execution');
      }
      await settleTrustedRuntimeContainerEngineOperation({
        session,
        operation: setupOperation,
        scope: setupScope,
        ownerTerminalReference: Object.freeze({
          phase: 'setup',
          operationKey: input.operationKey,
          containerName: containerTarget,
          imageId: image.imageId
        })
      });
      setupSettled = true;
      return await input.execute(Object.freeze({
        containerName: containerTarget,
        temporaryRoot,
        image,
        containerEngineSession: session,
        dockerEndpoint,
        dependencyCacheKey: dependencyCacheMarker?.cacheKey ?? null
      }));
    } finally {
      if (!setupSettled) {
        await settleTrustedRuntimeContainerEngineOperation({
          session,
          operation: setupOperation,
          scope: setupScope,
          ownerTerminalReference: Object.freeze({
            phase: 'setup-failure',
            operationKey: input.operationKey
          })
        });
      }
      if (containerCreated) {
        const cleanupOperation = bindTrustedRuntimeContainerEngineOperation({
          repositoryRoot,
          repository: repositoryIdentity,
          baseSha,
          headSha,
          operationKey: `${input.operationKey}-cleanup`,
          setupMode: input.setupMode,
          providerIdentityDigest: session.providerIdentityDigest,
          deadlineAtUnixMs: session.deadlineAtUnixMs
        });
        const cleanupScope = session.openOperationScope({
          operation: cleanupOperation,
          requirementId: 'external.container-engine-process'
        });
        let removed: Awaited<ReturnType<typeof observeContainerEngineOperation>> | null = null;
        try {
          removed = await observeContainerEngineOperation(session, {
            kind: 'container-remove', arguments: ['--force', containerId ?? containerName]
          }, { acceptAnyExitCode: true });
        } finally {
          await settleTrustedRuntimeContainerEngineOperation({
            session,
            operation: cleanupOperation,
            scope: cleanupScope,
            ownerTerminalReference: Object.freeze({
              phase: 'cleanup',
              operationKey: input.operationKey,
              containerName: containerId ?? containerName
            })
          });
        }
        if (removed === null || removed.code !== 0) {
          fail(`container cleanup failed and ${containerName} was retained`);
        }
      }
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } finally {
    try {
      try {
        containerEngineSession?.close();
      } finally {
        await operationLeaseAuthority.assertCurrent();
      }
    } finally {
      operationLease.release();
    }
  }
}

export async function executeTrustedRuntimeContainerVerification(input: Readonly<{
  repositoryRoot: string;
  envelope: VerificationSessionHostedEnvelope;
  actorNodeId: string;
  requiredBlobs: readonly Readonly<{ path: string; digest: Digest }>[];
}>): Promise<Readonly<{
  evidence: CodexDevelopmentVerificationEvidenceV4;
  canonicalEvidenceBytes: string;
  receipt: TrustedRuntimeContainerReceipt;
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const session = input.envelope.session;
  sha(session.baseSha, 'baseSha');
  sha(session.headSha, 'headSha');
  sha(session.headTreeSha, 'headTreeSha');
  return await withTrustedRuntimeWorkspace({
    repositoryRoot,
    repository: session.repository,
    baseSha: session.baseSha,
    headSha: session.headSha,
    operationKey: `session-${session.sessionRevision.slice(7, 31)}`,
    setupMode: 'full',
    execute: async ({
      containerName,
      temporaryRoot,
      image,
      containerEngineSession,
      dockerEndpoint
    }) => {
      return await executeTrustedRuntimeContainerEngineOwnerOperation({
        session: containerEngineSession,
        repositoryRoot,
        repository: session.repository,
        baseSha: session.baseSha,
        headSha: session.headSha,
        operationKey: `session-${session.sessionRevision.slice(7, 23)}-verification`,
        setupMode: 'full',
        execute: async () => {
      const outputPath = path.join(temporaryRoot, 'verification-evidence.json');
      const executionId = `trusted-runtime-${digestValue(Object.freeze({
        sessionRevision: session.sessionRevision,
        imageId: image.imageId,
        dockerEndpoint
      })).slice(7, 31)}`;
    await containerEngineOutput(containerEngineSession, {
      kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
      ...formalEnvironment({ envelope: input.envelope, executionId,
        actorNodeId: input.actorNodeId, requiredBlobs: input.requiredBlobs }),
      containerName,
      'bun', `${TRUSTED_RUNTIME_TRUSTED_TREE}/${CI_VERIFICATION_WORKFLOW_PATH}`,
      '--profile', session.profile, '--expected-head', session.headSha]
    });
    await containerEngineOutput(containerEngineSession, {
      kind: 'container-copy',
      arguments: [`${containerName}:${TRUSTED_RUNTIME_OUTPUT}/verification-evidence.json`, outputPath]
    });
    const canonicalEvidenceBytes = readFileSync(outputPath, 'utf8');
    const parsed = JSON.parse(canonicalEvidenceBytes) as CodexDevelopmentVerificationEvidenceV4;
    if (canonicalEvidenceBytes !== `${encodeVerificationActionData(parsed)}\n`) {
      fail('verification Evidence durable bytes are not canonical');
    }
    if (parsed.status !== 'passed' || parsed.sessionRevision !== session.sessionRevision
        || parsed.baseSha !== session.baseSha || parsed.headSha !== session.headSha
        || parsed.headTreeSha !== session.headTreeSha
        || parsed.actionPlan.actionPlanDigest !== input.envelope.actionPlanClosure.actionPlanDigest
        || parsed.producer.sourceTransport !== 'local-dev-runner'
        || parsed.producer.workflowPath !== CI_VERIFICATION_WORKFLOW_PATH
        || parsed.producer.workflowSha !== session.baseSha
        || parsed.producer.runId !== executionId
        || parsed.producer.actorNodeId !== input.actorNodeId) {
      fail('verification Evidence does not bind the trusted runtime Session');
    }
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
  });
}

export async function executeTrustedRuntimeMainHealth(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  now?: () => Date;
}>): Promise<TrustedRuntimeMainHealthReceipt> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const mainSha = sha(input.mainSha, 'MainHealth mainSha');
  const mainTreeSha = sha(input.mainTreeSha, 'MainHealth mainTreeSha');
  const repositoryIdentity = repository(input.repository);
  const parentLine = await command('git', ['rev-list', '--parents', '-n', '1', mainSha], repositoryRoot);
  const parentSha = parentLine.split(' ')[1] ?? '';
  const baseline = createTrustedRuntimeMainHealthBaselineObservation({
    mainSha,
    mainTreeSha,
    parentLine,
    parentTreeSha: await command('git', ['rev-parse', `${parentSha}^{tree}`], repositoryRoot)
  });
  return await withTrustedRuntimeWorkspace({
    repositoryRoot,
    repository: repositoryIdentity,
    baseSha: mainSha,
    headSha: mainSha,
    operationKey: `main-${mainSha.slice(0, 24)}`,
    setupMode: 'full',
    execute: async ({ containerName, image, containerEngineSession, dockerEndpoint }) => {
      const observedTree = await executeTrustedRuntimeContainerEngineOwnerOperation({
        session: containerEngineSession,
        repositoryRoot,
        repository: repositoryIdentity,
        baseSha: mainSha,
        headSha: mainSha,
        operationKey: `main-${mainSha.slice(0, 16)}-preflight`,
        setupMode: 'full',
        execute: async () => await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec',
          arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
            containerName, 'git', 'rev-parse', 'HEAD^{tree}']
        })
      });
      if (observedTree !== mainTreeSha) fail('MainHealth exact main tree differs before execution');
      const actionResults: Array<Readonly<{
        actionId: TrustedRuntimeMainHealthActionId;
        resultDigest: Digest;
      }>> = [];
      for (const action of TRUSTED_RUNTIME_MAIN_HEALTH_ACTIONS) {
        const declaredEnvironment = Object.freeze({
          SEC_AFFECTED_TESTS_BASE: baseline.baselineSha,
          SEC_CHANGED_BASE: baseline.baselineSha
        });
        const mainHealthEnvironment = createTrustedRuntimeCommandEnvironmentArgs({
          CI: '1',
          HOME: '/home/ubuntu',
          LANG: 'C',
          LC_ALL: 'C',
          TZ: 'UTC',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          SEC_AFFECTED_TESTS_BASE: baseline.baselineSha,
          SEC_CHANGED_BASE: baseline.baselineSha
        });
        const planResult = await executeTrustedRuntimeContainerEngineOwnerOperation({
          session: containerEngineSession,
          repositoryRoot,
          repository: repositoryIdentity,
          baseSha: mainSha,
          headSha: mainSha,
          operationKey: `main-${mainSha.slice(0, 12)}-${action.id}-plan`,
          setupMode: 'full',
          execute: async () => await containerEngineOperationResult(containerEngineSession, {
            kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
            ...mainHealthEnvironment,
            containerName, 'bun', 'run', 'check:affected', '--', '--plan'
            ]
          })
        });
        const affectedPlan = parseTrustedRuntimeMainHealthAffectedPlan(planResult.stdout);
        const gatePlans = createTrustedRuntimeMainHealthGatePlans({
          mainTreeSha,
          baselineObservationDigest: baseline.observationDigest,
          affectedPlan,
          imageId: image.imageId,
          dockerEndpoint
        });
        const runner = new VerificationActionRunner();
        const gateResults: Array<Readonly<{
          actionKey: VerificationActionKeyDigest;
          resultDigest: VerificationActionKeyDigest;
        }>> = [];
        for (const gate of gatePlans) {
          let executedFailureDetail: string | null = null;
          const boundEffect = bindTrustedRuntimeMainHealthEffect({
            gate,
            dockerEndpoint,
            imageId: image.imageId,
            deadlineAtUnixMs: Math.min(
              Date.now() + TRUSTED_RUNTIME_MAIN_HEALTH_ACTION_LEASE_MS,
              containerEngineSession.deadlineAtUnixMs
            ),
            providerIdentityDigest: containerEngineSession.providerIdentityDigest
          });
          const outcome = await runner.execute({
            repositoryRoot,
            action: gate.action,
            plan: gate.plan,
            executionDomain: 'trusted-runtime-main-health',
            leaseDurationMs: TRUSTED_RUNTIME_MAIN_HEALTH_ACTION_LEASE_MS,
            executor: async () => {
              const scope = containerEngineSession.openOperationScope({
                operation: boundEffect,
                requirementId: 'verification.trusted-container-process'
              });
              let result: Awaited<ReturnType<typeof observeContainerEngineOperation>> | null = null;
              let providerSettlement: SecProviderSettlementReceipt | null = null;
              try {
                result = await observeContainerEngineOperation(containerEngineSession, {
                  kind: 'container-exec', arguments: ['--user', '1000:1000',
                  '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
                  ...mainHealthEnvironment,
                  containerName, ...gate.argv]
                }, {
                  acceptAnyExitCode: true
                });
              } finally {
                providerSettlement = scope.settle();
              }
              if (result === null || providerSettlement === null) {
                fail('MainHealth provider scope did not settle its exact command attempt');
              }
              if (result.code !== 0) executedFailureDetail = renderTrustedRuntimeCommandFailureDetail(result);
              return issueTrustedRuntimeMainHealthEffectSettlement({
                operation: boundEffect,
                providerSettlement,
                actionKey: gate.action.actionKey,
                exitCode: result.code,
                stdout: result.stdout,
                stderr: result.stderr,
                endpointReadback: await containerEngineSession.observeEndpoint()
              });
            }
          });
          if (outcome.terminal?.status !== 'passed' || outcome.terminal.resultDigest === null) {
            fail(
              `MainHealth gate ${gate.id} ${outcome.disposition} without PASS `
              + `for ${gate.action.actionKey}${executedFailureDetail === null
                ? `: ${outcome.reason ?? 'terminal failure'}`
                : `:\n${executedFailureDetail}`}`
            );
          }
          console.log(
            `Trusted MainHealth gate ${gate.id}: ${outcome.disposition} ${gate.action.actionKey}`
          );
          gateResults.push(Object.freeze({
            actionKey: gate.action.actionKey,
            resultDigest: outcome.terminal.resultDigest
          }));
        }
        actionResults.push(Object.freeze({
          actionId: action.id,
          resultDigest: digestValue(Object.freeze({
            actionId: action.id,
            argv: action.argv,
            declaredEnvironment,
            affectedPlanDigest: affectedPlan.planDigest,
            gateResults
          }))
        }));
      }
      const { finalIdentity, finalHead, finalTree } = await executeTrustedRuntimeContainerEngineOwnerOperation({
        session: containerEngineSession,
        repositoryRoot,
        repository: repositoryIdentity,
        baseSha: mainSha,
        headSha: mainSha,
        operationKey: `main-${mainSha.slice(0, 16)}-postflight`,
        setupMode: 'full',
        execute: async () => Object.freeze({
          finalIdentity: await containerEngineOutput(containerEngineSession, {
            kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
              containerName, 'git', 'status', '--porcelain=v1', '--untracked-files=all']
          }),
          finalHead: await containerEngineOutput(containerEngineSession, {
            kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
              containerName, 'git', 'rev-parse', 'HEAD']
          }),
          finalTree: await containerEngineOutput(containerEngineSession, {
            kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
              containerName, 'git', 'rev-parse', 'HEAD^{tree}']
          })
        })
      });
      if (finalIdentity !== '' || finalHead !== mainSha || finalTree !== mainTreeSha) {
        fail('MainHealth exact main identity or clean state changed during execution');
      }
      const executionId = `trusted-main-health-${digestValue(Object.freeze({
        repository: repositoryIdentity,
        mainSha,
        mainTreeSha,
        baselineObservationDigest: baseline.observationDigest,
        imageId: image.imageId,
        dockerEndpoint,
        planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST
      })).slice(7, 31)}`;
      return createTrustedRuntimeMainHealthReceipt({
        origin: 'physical-main',
        repository: repositoryIdentity,
        mainSha,
        mainTreeSha,
        baselineSha: baseline.baselineSha,
        baselineTreeSha: baseline.baselineTreeSha,
        baselineObservationDigest: baseline.observationDigest,
        executionId,
        imageId: image.imageId,
        dockerEndpoint,
        networkIsolatedBeforeExecution: true,
        planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
        actionResults,
        transition: null,
        observedAt: (input.now ?? (() => new Date()))().toISOString()
      });
    }
  });
}

export async function executeTrustedRuntimeWorkspaceCanary(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  headSha: string;
  headTreeSha: string;
  dependencies?: boolean;
}>): Promise<Readonly<{
  schema: 'sec-trusted-runtime-workspace-canary-v1';
  repository: string;
  headSha: string;
  headTreeSha: string;
  dependenciesReady: boolean;
  dependencyCacheKey: Digest | null;
  imageId: typeof TRUSTED_RUNTIME_CONTAINER_IMAGE_ID;
  dockerEndpoint: DockerEndpointIdentity;
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const repositoryIdentity = repository(input.repository);
  const headSha = sha(input.headSha, 'workspace canary headSha');
  const headTreeSha = sha(input.headTreeSha, 'workspace canary headTreeSha');
  return await withTrustedRuntimeWorkspace({
    repositoryRoot,
    repository: repositoryIdentity,
    baseSha: headSha,
    headSha,
    operationKey: `${input.dependencies === true ? 'dependency' : 'canary'}-${headSha.slice(0, 24)}`,
    setupMode: input.dependencies === true ? 'dependency-canary' : 'lifecycle-canary',
    execute: async ({
      containerName,
      image,
      containerEngineSession,
      dockerEndpoint,
      dependencyCacheKey
    }) => {
      return await executeTrustedRuntimeContainerEngineOwnerOperation({
        session: containerEngineSession,
        repositoryRoot,
        repository: repositoryIdentity,
        baseSha: headSha,
        headSha,
        operationKey: `${input.dependencies === true ? 'dependency' : 'canary'}-${headSha.slice(0, 16)}-execute`,
        setupMode: input.dependencies === true ? 'dependency-canary' : 'lifecycle-canary',
        execute: async () => {
      if (input.dependencies === true) {
        await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
          ...createTrustedRuntimeCommandEnvironmentArgs({ CI: '1', HOME: '/home/ubuntu' }),
          containerName,
          'bun', DEV_RUNNER_ENTRYPOINT_PATH, 'deps:ensure']
        });
        const providerIdentity = await containerEngineOutput(containerEngineSession, {
            kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_TRUSTED_TREE,
            containerName, 'bun', TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH,
            '--resolve-from', TRUSTED_RUNTIME_TRUSTED_TREE]
          });
        const isolatedProviderIdentity = await containerEngineOutput(containerEngineSession, {
            kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', '/tmp',
            containerName, '/bin/bash', '-ceu',
            `NODE_PATH="$(realpath ${TRUSTED_RUNTIME_TRUSTED_TREE}/node_modules)" ` +
              `exec bun --no-install ${TRUSTED_RUNTIME_TRUSTED_TREE}/${TYPECHECK_PROVIDER_CANARY_ENTRYPOINT_PATH} ` +
              '--resolve-from /tmp']
          });
        if (isolatedProviderIdentity !== providerIdentity) {
          fail('dependency canary isolated TypeCheck Provider identity differs from its canonical owner');
        }
      }
      const observedHead = await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
            containerName, 'git', 'rev-parse', 'HEAD']
        });
      const observedTree = await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
            containerName, 'git', 'rev-parse', 'HEAD^{tree}']
        });
      const observedStatus = await containerEngineOutput(containerEngineSession, {
          kind: 'container-exec', arguments: ['--user', '1000:1000', '--workdir', TRUSTED_RUNTIME_WORKSPACE,
            containerName, 'git', 'status', '--porcelain=v1', '--untracked-files=all']
        });
      await containerEngineOutput(containerEngineSession, {
        kind: 'container-exec', arguments: ['--user', '1000:1000', containerName,
          '/bin/bash', '-lc', `test -r ${TRUSTED_RUNTIME_TRUSTED_TREE}/package.json && test -w ${TRUSTED_RUNTIME_OUTPUT}`]
      });
      if (observedHead !== headSha || observedTree !== headTreeSha || observedStatus !== '') {
        fail('workspace canary exact Git identity or clean state differs');
      }
      return Object.freeze({
        schema: 'sec-trusted-runtime-workspace-canary-v1',
        repository: repositoryIdentity,
        headSha,
        headTreeSha,
        dependenciesReady: input.dependencies === true,
        dependencyCacheKey,
        imageId: image.imageId,
        dockerEndpoint
      });
        }
      });
    }
  });
}
