/** Canonical provider-checks to MainHealth-ledger input compiler. */

import { createHash } from 'node:crypto';
import type { GitHubCheckObservation } from '../../../../execution/verification/session.ts';

import {
  parseDockerEndpointIdentity,
  type DockerEndpointIdentity
} from '../../../providers/docker/contract/daemon.ts';

import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../providers/linux-verification/contract.ts';
import {
  linuxVerificationUnitInvocationDigest,
  parseLinuxVerificationUnitReceipt,
  type LinuxVerificationUnitInvocation,
  type LinuxVerificationUnitReceipt
} from '../../../runtime-state/physical/contract/linux-verification-unit.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { createCiVerificationLocalExecutionEnvironment } from '../../../verification/platform/action/contract/ci.ts';
import { CI_MAIN_HEALTH_COMMANDS } from '../../../verification/platform/ci/contract/core.ts';
import {
  createMainHealthRepairWorkPackagePath,
  DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY,
  type MainHealthLedgerInput
} from './contract.ts';
import { CI_MAIN_HEALTH_POLICY, CI_MAIN_HEALTH_POLICY_DIGEST, createCiMainHealthRequestOperationId } from './provider-policy.ts';

type Digest = `sha256:${string}`;


export interface TrustedRuntimeMainHealthObservation {
  readonly schema: 'sec-trusted-runtime-main-health-observation-v1';
  readonly repository: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly trustRevision: string;
  readonly executionId: string;
  readonly verificationReceiptDigest: Digest;
  readonly observedAt: string;
  readonly expiresAt: string;
}

const MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA =
  'sec-main-health-check-provider-policy-v1' as const;

/** One freshness budget for the registered hosted MainHealth producer. */
export const HOSTED_MAIN_HEALTH_FRESHNESS_MS = 10 * 60_000;

export type MainHealthCheckProviderPolicy = Readonly<{
  schema: typeof MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA;
  policyRevision: string;
  policyDigest: Digest;
  context: 'sec/main-health';
  app: Readonly<{ id: number; nodeId: string; slug: string }>;
  branch: 'main';
  producer:
    | Readonly<{
        kind: 'github-actions-workflow';
        workflowPath: string;
        workflowRefFormat: string;
        eventName: 'repository_dispatch';
        runTitleFormat: string;
      }>
    | Readonly<{
        kind: 'github-app-check';
      }>;
  terminal: Readonly<{
    status: 'completed';
    conclusion: 'success';
    recognizedConclusions: readonly string[];
  }>;
  degraded: Readonly<{
    owner: string;
    allowedLanes: readonly ['repair'];
  }>;
  locked: Readonly<{
    allowedLanes: readonly [];
  }>;
}>;

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

const TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA =
  'sec-trusted-runtime-main-health-receipt-v2' as const;
const TRUSTED_RUNTIME_MAIN_HEALTH_IMAGE_ID =
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.imageDigest;
const TRUSTED_RUNTIME_MAIN_HEALTH_EXECUTION_ENVIRONMENT =
  createCiVerificationLocalExecutionEnvironment({
    os: 'linux',
    arch: 'x64',
    bunVersion: SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunVersion
  });
export const TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS = Object.freeze([
  'bun run imports:check --all',
  ...CI_MAIN_HEALTH_COMMANDS.slice(2)
]);

/** Closed command data shared by physical execution and historical decoding. */
export function createTrustedRuntimeNativeMainHealthInvocation(command: string): LinuxVerificationUnitInvocation {
  if (!TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS.includes(command)) {
    throw new Error('MainHealth native command is outside the canonical check closure.');
  }
  return Object.freeze({ kind: 'main-health', cwd: 'candidate',
    argv: Object.freeze(command.split(' ').slice(1)),
    environment: Object.freeze({ CI: '1', HOME: '/tmp/home', LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
      SEC_STATE_HOME: '/sec-runtime/output/state', SEC_CACHE_HOME: '/sec-runtime/output/cache' }),
    outputFiles: Object.freeze([]), maxStdoutBytes: 16 * 1024 * 1024, maxStderrBytes: 16 * 1024 * 1024 });
}
export const TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST = hash(Object.freeze({
  schema: 'sec-trusted-runtime-main-health-plan-v2',
  canonicalHostedCommands: CI_MAIN_HEALTH_COMMANDS,
  dependencyPreparation: 'private-authority-ephemeral-v1',
  checkCommands: TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS,
  executionEnvironmentRevision:
    TRUSTED_RUNTIME_MAIN_HEALTH_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
  imageId: TRUSTED_RUNTIME_MAIN_HEALTH_IMAGE_ID
}));

/** Historical Docker interpretation. Its parser never issues live authority. */
export interface TrustedRuntimeMainHealthDockerReceipt {
  readonly schema: typeof TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA;
  readonly repository: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly executionId: string;
  readonly imageId: typeof TRUSTED_RUNTIME_MAIN_HEALTH_IMAGE_ID;
  readonly dockerEndpoint: DockerEndpointIdentity;
  readonly dependencyCacheKey: null;
  readonly dependencyPreparation: 'private-authority-ephemeral-v1';
  readonly networkIsolatedBeforeExecution: true;
  readonly executionEnvironmentRevision:
    typeof TRUSTED_RUNTIME_MAIN_HEALTH_EXECUTION_ENVIRONMENT.executionEnvironmentRevision;
  readonly planDigest: typeof TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST;
  readonly actionResults: readonly Readonly<{
    command: string;
    resultDigest: Digest;
  }>[];
  readonly observedAt: string;
  readonly receiptDigest: Digest;
}

export interface TrustedRuntimeMainHealthNativeReceipt {
  readonly schema: 'sec-trusted-runtime-main-health-receipt-v3';
  readonly repository: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly executionId: string;
  readonly dependencyCacheKey: null;
  readonly dependencyPreparation: 'private-authority-ephemeral-v1';
  readonly networkIsolatedBeforeExecution: true;
  readonly planDigest: Digest;
  readonly actionResults: readonly Readonly<{
    command: string;
    resultDigest: Digest;
    unitReceipt: LinuxVerificationUnitReceipt;
  }>[];
  readonly observedAt: string;
  readonly receiptDigest: Digest;
}

export type TrustedRuntimeMainHealthReceipt =
  | TrustedRuntimeMainHealthDockerReceipt
  | TrustedRuntimeMainHealthNativeReceipt;

/** Data-only canonicalization. The physical producer retains the live results
 * separately and is the sole issuer of MainHealth qualification. */
export function createTrustedRuntimeNativeMainHealthReceipt(input: Readonly<{
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  executionId: string;
  actionResults: readonly Readonly<{ command: string; unitReceipt: LinuxVerificationUnitReceipt }>[];
  observedAt: string;
}>): TrustedRuntimeMainHealthNativeReceipt {
  const mainSha = mainHealthSha(input.mainSha, 'native receipt mainSha');
  const mainTreeSha = mainHealthSha(input.mainTreeSha, 'native receipt mainTreeSha');
  if (input.actionResults.length !== TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS.length) {
    throw new Error('MainHealth native receipt requires the complete canonical check closure.');
  }
  const units = new Set<string>();
  const invocations = new Set<string>();
  const actionResults = input.actionResults.map((entry, index) => {
    const command = TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS[index]!;
    if (entry.command !== command) {
      throw new Error('MainHealth native command differs from the canonical plan.');
    }
    const unitReceipt = parseLinuxVerificationUnitReceipt(entry.unitReceipt);
    if (unitReceipt.execution.exitCode !== 0 || unitReceipt.inputs.sutArchiveDigest !== null
        || unitReceipt.inputs.dependencyContentDigest === null
        || unitReceipt.unit.workingDirectory !== '/sec-runtime/workspace'
        || unitReceipt.invocationDigest !== linuxVerificationUnitInvocationDigest(createTrustedRuntimeNativeMainHealthInvocation(command))
        || [unitReceipt.gitBefore, unitReceipt.gitAfter].some((identity) =>
          identity.baseSha !== mainSha || identity.headSha !== mainSha
          || identity.baseTreeSha !== mainTreeSha || identity.headTreeSha !== mainTreeSha
          || identity.status !== '')
        || units.has(unitReceipt.unit.name) || invocations.has(unitReceipt.unit.invocationId)) {
      throw new Error('MainHealth native unit is unsuccessful, repeated or belongs to another exact main.');
    }
    units.add(unitReceipt.unit.name);
    invocations.add(unitReceipt.unit.invocationId);
    return Object.freeze({ command, unitReceipt, resultDigest: hash(Object.freeze({
      command, exitCode: unitReceipt.execution.exitCode,
      stdoutDigest: unitReceipt.execution.stdoutDigest,
      stderrDigest: unitReceipt.execution.stderrDigest,
      unitReceiptDigest: unitReceipt.receiptDigest
    })) });
  });
  const first = actionResults[0]!.unitReceipt;
  if (actionResults.some(({ unitReceipt }) =>
    unitReceipt.profileDigest !== first.profileDigest
    || unitReceipt.providerIdentityDigest !== first.providerIdentityDigest
    || unitReceipt.unit.managerBootId !== first.unit.managerBootId
    || unitReceipt.unit.managerStartTime !== first.unit.managerStartTime
    || unitReceipt.boundAttemptDigest !== first.boundAttemptDigest
    || unitReceipt.operationIdentityDigest !== first.operationIdentityDigest
    || unitReceipt.inputDigest !== first.inputDigest
    || unitReceipt.deadlineAtUnixMs !== first.deadlineAtUnixMs
    || encodeVerificationActionData(unitReceipt.inputs) !== encodeVerificationActionData(first.inputs))) {
    throw new Error('MainHealth native units do not share one exact admitted input and operation.');
  }
  const withoutDigest = Object.freeze({
    schema: 'sec-trusted-runtime-main-health-receipt-v3' as const,
    repository: boundedText(input.repository, 'native receipt repository'),
    mainSha, mainTreeSha,
    executionId: boundedText(input.executionId, 'native receipt executionId'),
    dependencyCacheKey: null,
    dependencyPreparation: 'private-authority-ephemeral-v1' as const,
    networkIsolatedBeforeExecution: true as const,
    planDigest: hash(Object.freeze({
      schema: 'sec-trusted-runtime-main-health-plan-v3',
      canonicalHostedCommands: CI_MAIN_HEALTH_COMMANDS,
      checkCommands: TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS,
      dependencyPreparation: 'private-authority-ephemeral-v1',
      profileDigest: first.profileDigest,
      runtimeManifestDigest: first.inputs.runtimeManifestDigest
    })),
    actionResults: Object.freeze(actionResults),
    observedAt: mainHealthInstant(input.observedAt, 'native receipt observedAt')
  });
  return Object.freeze({ ...withoutDigest, receiptDigest: hash(withoutDigest) });
}

function parseTrustedRuntimeNativeMainHealthReceipt(
  record: Record<string, unknown>
): TrustedRuntimeMainHealthNativeReceipt {
  if (Object.keys(record).sort().join(',') !== [
    'schema', 'repository', 'mainSha', 'mainTreeSha', 'executionId', 'dependencyCacheKey',
    'dependencyPreparation', 'networkIsolatedBeforeExecution', 'planDigest', 'actionResults',
    'observedAt', 'receiptDigest'
  ].sort().join(',') || record.dependencyCacheKey !== null
      || record.dependencyPreparation !== 'private-authority-ephemeral-v1'
      || record.networkIsolatedBeforeExecution !== true || !Array.isArray(record.actionResults)) {
    throw new Error('MainHealth native receipt shape or fixed identity is invalid.');
  }
  const rebuilt = createTrustedRuntimeNativeMainHealthReceipt({
    repository: boundedText(record.repository, 'native receipt repository'),
    mainSha: mainHealthSha(record.mainSha, 'native receipt mainSha'),
    mainTreeSha: mainHealthSha(record.mainTreeSha, 'native receipt mainTreeSha'),
    executionId: boundedText(record.executionId, 'native receipt executionId'),
    observedAt: mainHealthInstant(record.observedAt, 'native receipt observedAt'),
    actionResults: record.actionResults.map((entry: unknown) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
          || Object.keys(entry).sort().join(',') !== 'command,resultDigest,unitReceipt') {
        throw new Error('MainHealth native action result shape is invalid.');
      }
      const result = entry as Record<string, unknown>;
      mainHealthDigest(result.resultDigest, 'native action result digest');
      return { command: boundedText(result.command, 'native action command'),
        unitReceipt: parseLinuxVerificationUnitReceipt(result.unitReceipt) };
    })
  });
  if (encodeVerificationActionData(record) !== encodeVerificationActionData(rebuilt)) {
    throw new Error('MainHealth native receipt differs from its canonical subject, plan or result bytes.');
  }
  return rebuilt;
}

function mainHealthSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`MainHealth ${label} must be one lowercase Git SHA.`);
  }
  return value;
}

function mainHealthDigest(value: unknown, label: string): Digest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`MainHealth ${label} must be one SHA-256 digest.`);
  }
  return value as Digest;
}

function mainHealthInstant(value: unknown, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))
      || new Date(value).toISOString() !== value) {
    throw new Error(`MainHealth ${label} must be one canonical ISO instant.`);
  }
  return value;
}

/** Content reference for one live production receipt, never a file locator or
 * a means of reconstructing its same-process qualification. */
export function trustedRuntimeMainHealthReceiptReference(input: Readonly<{
  mainSha: string;
  receiptDigest: Digest;
  schema?: TrustedRuntimeMainHealthReceipt['schema'];
}>): string {
  const mainSha = mainHealthSha(input.mainSha, 'receipt reference mainSha');
  const receiptDigest = mainHealthDigest(input.receiptDigest, 'receipt reference digest');
  if (input.schema !== undefined && input.schema !== TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA
      && input.schema !== 'sec-trusted-runtime-main-health-receipt-v3') {
    throw new Error('MainHealth receipt reference schema is invalid.');
  }
  const version = input.schema === 'sec-trusted-runtime-main-health-receipt-v3' ? 'v3' : 'v2';
  return `live-receipt:trusted-main-health/${version}/${mainSha}/${receiptDigest.slice(7)}`;
}

export function createTrustedRuntimeMainHealthReceipt(input: Readonly<{
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  executionId: string;
  dockerEndpoint: DockerEndpointIdentity;
  dependencyCacheKey: null;
  actionResults: readonly Readonly<{ command: string; resultDigest: Digest }>[];
  observedAt: string;
}>): TrustedRuntimeMainHealthDockerReceipt {
  if (input.dependencyCacheKey !== null) {
    throw new Error('MainHealth authority cannot consume a candidate-writable dependency cache.');
  }
  if (TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS.length !== 5
      || CI_MAIN_HEALTH_COMMANDS[0] !== 'bun install --frozen-lockfile'
      || input.actionResults.length !== TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS.length) {
    throw new Error('MainHealth trusted-runtime canonical command closure is invalid.');
  }
  const actionResults = input.actionResults.map((entry, index) => {
    const expectedCommand = TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS[index]!;
    if (entry.command !== expectedCommand) {
      throw new Error(
        `MainHealth trusted-runtime actionResults[${index}] command differs from the canonical plan.`
      );
    }
    return Object.freeze({
      command: expectedCommand,
      resultDigest: mainHealthDigest(
        entry.resultDigest,
        `trusted-runtime actionResults[${index}].resultDigest`
      )
    });
  });
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA,
    repository: boundedText(input.repository, 'trusted-runtime receipt repository'),
    mainSha: mainHealthSha(input.mainSha, 'trusted-runtime receipt mainSha'),
    mainTreeSha: mainHealthSha(input.mainTreeSha, 'trusted-runtime receipt mainTreeSha'),
    executionId: boundedText(input.executionId, 'trusted-runtime receipt executionId'),
    imageId: TRUSTED_RUNTIME_MAIN_HEALTH_IMAGE_ID,
    dockerEndpoint: parseDockerEndpointIdentity(input.dockerEndpoint),
    dependencyCacheKey: null,
    dependencyPreparation: 'private-authority-ephemeral-v1' as const,
    networkIsolatedBeforeExecution: true as const,
    executionEnvironmentRevision:
      TRUSTED_RUNTIME_MAIN_HEALTH_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
    actionResults: Object.freeze(actionResults),
    observedAt: mainHealthInstant(input.observedAt, 'trusted-runtime receipt observedAt')
  });
  return Object.freeze({ ...withoutDigest, receiptDigest: hash(withoutDigest) });
}

export function parseTrustedRuntimeMainHealthReceipt(
  value: unknown
): TrustedRuntimeMainHealthReceipt {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new Error('MainHealth trusted-runtime receipt is not JSON.');
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MainHealth trusted-runtime receipt must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schema === 'sec-trusted-runtime-main-health-receipt-v3') {
    return parseTrustedRuntimeNativeMainHealthReceipt(record);
  }
  const expected = [
    'schema', 'repository', 'mainSha', 'mainTreeSha', 'executionId', 'imageId',
    'dockerEndpoint', 'dependencyCacheKey', 'dependencyPreparation', 'networkIsolatedBeforeExecution',
    'executionEnvironmentRevision', 'planDigest', 'actionResults', 'observedAt',
    'receiptDigest'
  ].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])
      || record.schema !== TRUSTED_RUNTIME_MAIN_HEALTH_RECEIPT_SCHEMA
      || record.dependencyCacheKey !== null
      || record.dependencyPreparation !== 'private-authority-ephemeral-v1'
      || record.imageId !== TRUSTED_RUNTIME_MAIN_HEALTH_IMAGE_ID
      || record.networkIsolatedBeforeExecution !== true
      || record.executionEnvironmentRevision
        !== TRUSTED_RUNTIME_MAIN_HEALTH_EXECUTION_ENVIRONMENT.executionEnvironmentRevision
      || record.planDigest !== TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST
      || !Array.isArray(record.actionResults)) {
    throw new Error('MainHealth trusted-runtime receipt shape or fixed identity is invalid.');
  }
  const rebuilt = createTrustedRuntimeMainHealthReceipt({
    repository: boundedText(
      record.repository as string,
      'trusted-runtime receipt repository'
    ),
    mainSha: mainHealthSha(record.mainSha, 'trusted-runtime receipt mainSha'),
    mainTreeSha: mainHealthSha(record.mainTreeSha, 'trusted-runtime receipt mainTreeSha'),
    executionId: boundedText(
      record.executionId as string,
      'trusted-runtime receipt executionId'
    ),
    dockerEndpoint: parseDockerEndpointIdentity(record.dockerEndpoint),
    dependencyCacheKey: null,
    actionResults: record.actionResults as TrustedRuntimeMainHealthReceipt['actionResults'],
    observedAt: mainHealthInstant(
      record.observedAt,
      'trusted-runtime receipt observedAt'
    )
  });
  if (rebuilt.receiptDigest
      !== mainHealthDigest(record.receiptDigest, 'trusted-runtime receipt receiptDigest')) {
    throw new Error('MainHealth trusted-runtime receipt digest mismatch.');
  }
  return rebuilt;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
      || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`MainHealth ${label} must be bounded canonical text.`);
  }
  return value;
}

/** The receipt schema is separate from observation-v1 data. Omitting it keeps
 * the historical V2 interpretation; live callers supply the parsed receipt's schema. */
export function createTrustedRuntimeMainHealthInput(
  input: TrustedRuntimeMainHealthObservation,
  receiptSchema?: TrustedRuntimeMainHealthReceipt['schema']
): MainHealthLedgerInput {
  if (input.schema !== 'sec-trusted-runtime-main-health-observation-v1') {
    throw new Error('MainHealth trusted-runtime observation schema mismatch.');
  }
  const mainSha = boundedText(input.mainSha, 'mainSha');
  const mainTreeSha = boundedText(input.mainTreeSha, 'mainTreeSha');
  const trustRevision = boundedText(input.trustRevision, 'trustRevision');
  if (!/^[0-9a-f]{40}$/u.test(mainSha)
      || !/^[0-9a-f]{40}$/u.test(mainTreeSha)
      || !/^[0-9a-f]{40}$/u.test(trustRevision)) {
    throw new Error('MainHealth trusted-runtime subject identity is invalid.');
  }
  const observedAt = mainHealthInstant(input.observedAt, 'trusted-runtime observedAt');
  const expiresAt = mainHealthInstant(input.expiresAt, 'trusted-runtime expiresAt');
  if (mainSha !== trustRevision || expiresAt <= observedAt) {
    throw new Error('MainHealth trusted-runtime observation is not exact or fresh.');
  }
  const verificationReceiptDigest = input.verificationReceiptDigest;
  if (!/^sha256:[0-9a-f]{64}$/u.test(verificationReceiptDigest)) {
    throw new Error('MainHealth trusted-runtime receipt digest is invalid.');
  }
  return Object.freeze({
    repository: boundedText(input.repository, 'repository'),
    defaultBranch: 'main',
    mainSha,
    mainTreeSha,
    status: 'healthy',
    failureFingerprints: Object.freeze([]),
    owner: null,
    repairWorkPackage: null,
    expiresAt,
    allowedLanes: Object.freeze(['ordinary'] as const),
    trustRevision,
    observedAt,
    producer: Object.freeze({
      identity: DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY,
      trustRevision,
      sourceTransport: 'trusted-runtime-live-readback' as const,
      sourceRunId: boundedText(input.executionId, 'executionId'),
      sourceRef: trustedRuntimeMainHealthReceiptReference({
        mainSha, receiptDigest: verificationReceiptDigest, schema: receiptSchema
      }),
      sourceDigest: verificationReceiptDigest
    })
  });
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`MainHealth ${label} must be a positive safe integer.`);
  }
  return value;
}

function canonicalApp(input: Readonly<{ id: number; nodeId: string; slug: string }>) {
  const id = positiveInteger(input.id, 'app.id');
  const nodeId = boundedText(input.nodeId, 'app.nodeId');
  const slug = boundedText(input.slug, 'app.slug');
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(slug)) {
    throw new Error('MainHealth app.slug must be canonical kebab-case text.');
  }
  return Object.freeze({ id, nodeId, slug });
}

const RECOGNIZED_MAIN_HEALTH_CONCLUSIONS = Object.freeze([
  'success', 'failure', 'cancelled', 'skipped', 'timed_out',
  'action_required', 'neutral', 'stale', 'startup_failure'
] as const);

/** GitHub Actions policy projected into the canonical hosted matcher. */
export const GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY: MainHealthCheckProviderPolicy =
  Object.freeze({
    schema: MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA,
    policyRevision: CI_MAIN_HEALTH_POLICY.policyRevision,
    policyDigest: CI_MAIN_HEALTH_POLICY_DIGEST,
    context: CI_MAIN_HEALTH_POLICY.context,
    app: Object.freeze({
      id: CI_MAIN_HEALTH_POLICY.app.id,
      nodeId: CI_MAIN_HEALTH_POLICY.app.nodeId,
      slug: CI_MAIN_HEALTH_POLICY.app.slug
    }),
    branch: CI_MAIN_HEALTH_POLICY.producer.branch,
    producer: Object.freeze({
      kind: 'github-actions-workflow' as const,
      workflowPath: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
      workflowRefFormat: CI_MAIN_HEALTH_POLICY.producer.workflowRefFormat,
      eventName: CI_MAIN_HEALTH_POLICY.producer.eventNames[0],
      runTitleFormat: CI_MAIN_HEALTH_POLICY.producer.runTitleFormats.repositoryDispatch
    }),
    terminal: Object.freeze({
      status: CI_MAIN_HEALTH_POLICY.terminal.status,
      conclusion: CI_MAIN_HEALTH_POLICY.terminal.conclusion,
      recognizedConclusions: CI_MAIN_HEALTH_POLICY.terminal.recognizedConclusions
    }),
    degraded: Object.freeze({
      owner: CI_MAIN_HEALTH_POLICY.degraded.owner,
      allowedLanes: CI_MAIN_HEALTH_POLICY.degraded.allowedLanes
    }),
    locked: Object.freeze({ allowedLanes: CI_MAIN_HEALTH_POLICY.locked.allowedLanes })
  });

/**
 * Static trust registry for hosted MainHealth principals. Observing an App on
 * GitHub never enrolls it. A dedicated App becomes authoritative only after
 * its exact id/nodeId/slug policy is added by this canonical owner.
 */
const HOSTED_MAIN_HEALTH_PROVIDER_POLICIES:
readonly MainHealthCheckProviderPolicy[] = Object.freeze([
  GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY
]);

/**
 * Builds the exact policy for a dedicated SEC Integration/App principal. The
 * App check is the GitHub transport/readback projection; the trusted runtime
 * that owns the App credentials remains responsible for executing the actual
 * MainHealth closure before publishing it.
 */
export function createTrustedRuntimeMainHealthCheckProviderPolicyV1(input: Readonly<{
  policyRevision: string;
  app: Readonly<{ id: number; nodeId: string; slug: string }>;
}>): MainHealthCheckProviderPolicy {
  const semantic = Object.freeze({
    schema: MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA,
    policyRevision: boundedText(input.policyRevision, 'policyRevision'),
    context: 'sec/main-health' as const,
    app: canonicalApp(input.app),
    branch: 'main' as const,
    producer: Object.freeze({ kind: 'github-app-check' as const }),
    terminal: Object.freeze({
      status: 'completed' as const,
      conclusion: 'success' as const,
      recognizedConclusions: RECOGNIZED_MAIN_HEALTH_CONCLUSIONS
    }),
    degraded: Object.freeze({
      owner: 'ci-verification-maintainer' as const,
      allowedLanes: Object.freeze(['repair'] as const)
    }),
    locked: Object.freeze({ allowedLanes: Object.freeze([] as const) })
  });
  return Object.freeze({ ...semantic, policyDigest: hash(semantic) });
}

function matchesActionsProducer(
  check: GitHubCheckObservation,
  policy: Extract<MainHealthCheckProviderPolicy['producer'], { kind: 'github-actions-workflow' }>,
  mainSha: string
): boolean {
  const expectedRef = policy.workflowRefFormat.replace('<exact-main-sha>', mainSha);
  const titleParts = policy.runTitleFormat.replace('<exact-main-sha>', mainSha).split('<request-operation-id>');
  if (titleParts.length !== 2) {
    throw new Error('MainHealth repository-dispatch title policy must contain one request-operation placeholder.');
  }
  const [titlePrefix, titleSuffix] = titleParts as [string, string];
  if (check.workflowRunId === null || check.workflowRunDisplayTitle === null
      || check.eventName !== policy.eventName
      || check.workflowPath !== policy.workflowPath
      || check.workflowRef !== expectedRef
      || !check.workflowRunDisplayTitle.startsWith(titlePrefix)
      || !check.workflowRunDisplayTitle.endsWith(titleSuffix)) return false;
  const operationId = check.workflowRunDisplayTitle.slice(
    titlePrefix.length,
    check.workflowRunDisplayTitle.length - titleSuffix.length
  );
  return operationId === createCiMainHealthRequestOperationId(mainSha);
}

function matchesDirectAppProducer(check: GitHubCheckObservation): boolean {
  return check.workflowPath === null
    && check.workflowRef === null
    && check.eventName === null
    && check.workflowRunId === null
    && check.workflowRunDisplayTitle === null;
}

/**
 * One exact hosted-provider admission predicate. Registration and ledger
 * compilation must consume this same decision; a check that merely shares a
 * context, App, and subject cannot enroll a provider before its producer
 * provenance has also matched.
 */
function matchesHostedMainHealthProvider(
  check: GitHubCheckObservation,
  policy: MainHealthCheckProviderPolicy,
  mainSha: string
): boolean {
  if (policy.schema !== MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA) {
    throw new Error('MainHealth provider policy schema is invalid.');
  }
  const app = canonicalApp(policy.app);
  return check.headSha === mainSha
    && check.name === policy.context
    && check.appId === app.id
    && check.appNodeId === app.nodeId
    && check.appSlug === app.slug
    && (policy.producer.kind === 'github-actions-workflow'
      ? matchesActionsProducer(check, policy.producer, mainSha)
      : matchesDirectAppProducer(check));
}

/**
 * Single MainHealth ledger compiler. Provider-specific adapters authenticate
 * only the check producer; health/degraded/locked semantics and failure
 * fingerprinting remain one canonical implementation.
 */
export function createObservedMainHealthInputWithPolicy(input: {
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  trustRevision: string;
  observedAt: string;
  expiresAt: string;
  sourceRunId: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservation[];
  policy: MainHealthCheckProviderPolicy;
}): MainHealthLedgerInput {
  const policy = input.policy;
  if (policy.schema !== MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA) {
    throw new Error('MainHealth provider policy schema is invalid.');
  }
  const matching = input.checks
    .filter((check) => matchesHostedMainHealthProvider(check, policy, input.mainSha))
    .sort((left, right) => left.id - right.id);

  if (matching.length === 1) {
    const expectedSourceRunId = policy.producer.kind === 'github-app-check'
      ? String(matching[0]!.id)
      : matching[0]!.workflowRunId;
    if (expectedSourceRunId === null || input.sourceRunId !== expectedSourceRunId) {
      throw new Error(
        'MainHealth sourceRunId must equal the exact observed check or workflow run id.'
      );
    }
  }

  const successful = (check: GitHubCheckObservation): boolean =>
    check.status === policy.terminal.status && check.conclusion === policy.terminal.conclusion;
  const terminalConclusion = (check: GitHubCheckObservation): string | null =>
    check.status === policy.terminal.status
      && check.conclusion !== null
      && policy.terminal.recognizedConclusions.some((conclusion) => conclusion === check.conclusion)
      ? check.conclusion
      : null;

  // One exact provider check is the only producer. Duplicates, nonterminal
  // observations, and unrecognized outcomes remain ambiguous and fail closed.
  const selected = matching.length === 1 ? matching[0]! : null;
  const selectedConclusion = selected === null ? null : terminalConclusion(selected);
  const healthy = selected !== null && successful(selected);
  const degraded = selectedConclusion !== null && selectedConclusion !== policy.terminal.conclusion;
  const status = healthy ? 'healthy' as const : degraded ? 'degraded' as const : 'locked' as const;
  const degradedOutcome = selected === null ? null : policy.producer.kind === 'github-actions-workflow'
    ? Object.freeze({
        name: selected.name,
        status: selected.status,
        conclusion: selectedConclusion,
        headSha: selected.headSha
      })
    : Object.freeze({
        id: selected.id,
        name: selected.name,
        status: selected.status,
        conclusion: selectedConclusion,
        headSha: selected.headSha,
        appId: selected.appId
      });
  const fingerprints = healthy ? [] : [hash(degraded ? {
    status: 'main-health-check-failed',
    policyDigest: policy.policyDigest,
    outcome: degradedOutcome
  } : {
    status: 'main-health-policy-mismatch',
    policyDigest: policy.policyDigest,
    mainSha: input.mainSha,
    matching
  })];
  const repairWorkPackage = degraded ? createMainHealthRepairWorkPackagePath({
    repository: input.repository,
    defaultBranch: policy.branch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    owner: policy.degraded.owner,
    failureFingerprints: fingerprints
  }) : null;
  return Object.freeze({
    repository: input.repository,
    defaultBranch: policy.branch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    status,
    failureFingerprints: Object.freeze(fingerprints),
    owner: degraded ? policy.degraded.owner : null,
    repairWorkPackage,
    expiresAt: input.expiresAt,
    allowedLanes: healthy
      ? Object.freeze(['ordinary'] as const)
      : degraded
        ? policy.degraded.allowedLanes
        : policy.locked.allowedLanes,
    trustRevision: input.trustRevision,
    observedAt: input.observedAt,
    producer: Object.freeze({
      identity: DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY,
      trustRevision: input.trustRevision,
      sourceTransport: 'github-api' as const,
      sourceRunId: input.sourceRunId,
      sourceRef: input.sourceRef,
      sourceDigest: hash({ policyDigest: policy.policyDigest, matching })
    })
  });
}

/**
 * Selects only source-registered hosted principals and compiles each through
 * the single hosted MainHealth matcher. Unknown same-name checks do
 * not gain authority and cannot invalidate an independent trusted provider.
 */
export function createRegisteredHostedMainHealthInputs(input: {
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  trustRevision: string;
  observedAt: string;
  expiresAt: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservation[];
}): readonly MainHealthLedgerInput[] {
  const presentPolicies = HOSTED_MAIN_HEALTH_PROVIDER_POLICIES.filter((policy) => (
    input.checks.some((check) => matchesHostedMainHealthProvider(check, policy, input.mainSha))
  ));
  return Object.freeze(presentPolicies.map((policy) =>
    createProviderObservedMainHealthInput({ ...input, policy })));
}

function createProviderObservedMainHealthInput(
  input: Omit<Parameters<typeof createObservedMainHealthInputWithPolicy>[0], 'sourceRunId'>
): MainHealthLedgerInput {
  const exactProviderChecks = input.checks
    .filter((check) => matchesHostedMainHealthProvider(check, input.policy, input.mainSha));
  return createObservedMainHealthInputWithPolicy({
    ...input,
    sourceRunId: exactProviderChecks.length === 1
      ? input.policy.producer.kind === 'github-app-check'
        ? String(exactProviderChecks[0]!.id)
        : exactProviderChecks[0]!.workflowRunId!
      : 'ambiguous-hosted-provider'
  });
}

/**
 * Direct Actions adapter used by hosted verification consumers. Producer
 * provenance comes from the matched provider check, never the observing
 * Session, merge workflow, or local preparation operation.
 */
export function createObservedMainHealthInput(input: {
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  trustRevision: string;
  observedAt: string;
  expiresAt: string;
  checks: readonly GitHubCheckObservation[];
}): MainHealthLedgerInput {
  return createProviderObservedMainHealthInput({
    ...input,
    sourceRef: `github-check-runs:${input.repository}@${input.mainSha}`,
    policy: GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY
  });
}
