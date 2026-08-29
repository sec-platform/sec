import { canonicalEquals, sha256 as canonicalSha256 } from '../../../foundation/canonical.ts';
import {
  CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1
} from '../index.ts';
import {
  CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
  ciVerificationNormalizedOperationArgvV2,
  parseCiVerificationNormalizedOperationV2,
  type CiVerificationExecutionEnvironmentV2,
  type CiVerificationNormalizedOperationV2
} from '../../action/index.ts';
import {
  encodeVerificationActionDataV2,
  parseVerificationActionPlanV2,
  type VerificationActionKeyDigest,
  type VerificationActionPlanV2
} from '../../action/index.ts';
import type { VerificationActionProviderOriginV2 } from '../../action/index.ts';
import {
  CodexDevelopmentBuildVerificationGateResultV1,
  type VerificationGateResultV1
} from '../../result/index.ts';

export const CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA_V2 =
  'sec-verification-action-raw-observation-v2' as const;
export const CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1 =
  'sec-verification-action-sandbox-receipt-v1' as const;
export const CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA_V1 =
  'sec-verification-action-sut-authorization-v1' as const;
export const CI_VERIFICATION_ACTION_SUT_PROOF_SCHEMA_V1 =
  'sec-verification-action-sut-execution-proof-v1' as const;
export const CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA_V1 =
  'sec-verification-action-physical-command-v1' as const;
export const CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1 = 8 * 1024 * 1024;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const RECEIPT_REF_PREFIX = 'sandbox-receipt:';

function fail(message: string): never {
  throw new Error(`Hosted SUT observation ${message}`);
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one object.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} fields are invalid.`);
  }
  return record;
}

function digest(value: unknown, label: string): VerificationActionKeyDigest {
  if (typeof value !== 'string' || !DIGEST.test(value)) fail(`${label} digest is invalid.`);
  return value as VerificationActionKeyDigest;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} SHA is invalid.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    fail(`${label} text is invalid.`);
  }
  return value;
}

function canonicalDigest(value: unknown): VerificationActionKeyDigest {
  return canonicalSha256(value) as VerificationActionKeyDigest;
}

function canonicalStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.includes('\0'))) {
    fail(`${label} must be a string array.`);
  }
  return Object.freeze([...value] as string[]);
}

export type CodexDevelopmentHostedSutEnvironmentProjectionV1 = readonly Readonly<{
  name: string;
  valueDigest: VerificationActionKeyDigest;
}>[];

export type CodexDevelopmentHostedSutPhysicalCommandAuthorizationV1 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA_V1;
  actionKey: VerificationActionKeyDigest;
  operationSemanticDigest: VerificationActionKeyDigest;
  unitName: string;
  canonicalArgvDigest: VerificationActionKeyDigest;
  semanticEnvironment: CodexDevelopmentHostedSutEnvironmentProjectionV1;
  fixedSandboxEnvironment: CodexDevelopmentHostedSutEnvironmentProjectionV1;
  sandboxPolicyDigest: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1;
  providerRevision: typeof CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2;
  projectionDigest: VerificationActionKeyDigest;
}>;

function environmentProjection(
  entries: readonly Readonly<{ name: string; valueDigest: string }>[]
): CodexDevelopmentHostedSutEnvironmentProjectionV1 {
  const projected = entries.map((entry) => Object.freeze({
    name: text(entry.name, 'environment name'),
    valueDigest: digest(entry.valueDigest, `environment ${entry.name}`)
  })).sort((left, right) => left.name.localeCompare(right.name));
  if (new Set(projected.map((entry) => entry.name)).size !== projected.length ||
      projected.some((entry) => !/^[A-Z][A-Z0-9_]*$/u.test(entry.name))) {
    fail('environment projection contains duplicate or invalid names.');
  }
  return Object.freeze(projected);
}

export function CodexDevelopmentHostedSutCandidateEnvironmentV1(input: Readonly<{
  normalizedOperation: CiVerificationNormalizedOperationV2;
  manifestPath: string;
}>): Readonly<Record<string, string>> {
  const operation = parseCiVerificationNormalizedOperationV2(input.normalizedOperation);
  const environment = Object.freeze({
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HOME: '/home/sut',
    LANG: 'C',
    PATH: '/tool/bin:/usr/bin:/bin',
    SEC_AFFECTED_TESTS_BASE: operation.candidate.baseSha,
    SEC_BASE_TREE_SHA: operation.candidate.baseTreeSha,
    SEC_CHANGED_BASE: operation.candidate.baseSha,
    SEC_EXECUTION_ENVIRONMENT_REVISION: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
    SEC_FORMAL_HOSTED_MODE: '1',
    SEC_WORK_PACKAGE_MANIFEST_PATH: text(input.manifestPath, 'manifest path'),
    TMPDIR: '/tmp'
  });
  for (const binding of operation.environmentBindings) {
    const value = environment[binding.name as keyof typeof environment];
    if (value === undefined || canonicalDigest(value) !== binding.digest) {
      fail(`declared semantic environment ${binding.name} is not reconstructible from the Action.`);
    }
  }
  return environment;
}

function physicalCommandAuthorization(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  ticketDigest: VerificationActionKeyDigest;
  normalizedOperation: CiVerificationNormalizedOperationV2;
  manifestPath: string;
}>): CodexDevelopmentHostedSutPhysicalCommandAuthorizationV1 {
  const operation = parseCiVerificationNormalizedOperationV2(input.normalizedOperation);
  const candidateEnvironment = CodexDevelopmentHostedSutCandidateEnvironmentV1({
    normalizedOperation: operation,
    manifestPath: input.manifestPath
  });
  const semanticEnvironment = environmentProjection(operation.environmentBindings.map((entry) => ({
    name: entry.name,
    valueDigest: entry.digest
  })));
  const fixedSandboxEnvironment = environmentProjection(Object.entries(candidateEnvironment).map(
    ([name, value]) => ({ name, valueDigest: canonicalDigest(value) })
  ));
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA_V1,
    actionKey: input.actionKey,
    operationSemanticDigest: operation.semanticDigest,
    unitName: `sec-sut-${input.actionKey.slice(7, 23)}-${input.ticketDigest.slice(7, 23)}`,
    canonicalArgvDigest: canonicalDigest(ciVerificationNormalizedOperationArgvV2(operation)),
    semanticEnvironment,
    fixedSandboxEnvironment,
    sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
    providerRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2
  });
  return Object.freeze({ ...withoutDigest, projectionDigest: canonicalDigest(withoutDigest) });
}

export type CodexDevelopmentHostedSutSandboxCapabilityObservationV1 = Readonly<{
  commandPlanDigest: VerificationActionKeyDigest | null;
  commandStarted: boolean;
  exitCode: number | null;
  markerObserved: boolean;
  outputDigest: VerificationActionKeyDigest;
  teardownCommandStarted: boolean;
  teardownExitCode: number | null;
  residueMarkerObserved: boolean;
  cgroupEmpty: boolean;
  residueReadbackDigest: VerificationActionKeyDigest;
  diagnostic: string | null;
}>;

export type CodexDevelopmentHostedSutSandboxReceiptV1 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1;
  policyDigest: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1;
  actionKey: VerificationActionKeyDigest;
  capability: CodexDevelopmentHostedSutSandboxCapabilityObservationV1;
  commandPlanDigest: VerificationActionKeyDigest | null;
  resources: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits;
  authenticatedArchive: Readonly<{
    archiveDigest: VerificationActionKeyDigest | null;
    inventoryDigest: VerificationActionKeyDigest | null;
    dependencyClosureDigest: VerificationActionKeyDigest | null;
    gitBundleDigest: VerificationActionKeyDigest | null;
    entryCount: number;
    totalFileBytes: number;
  }>;
  rootIsolation: Readonly<{
    substrate: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.substrate;
    namespaces: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.namespaces;
    uid: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid;
    gid: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid;
    network: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.network;
    inputMount: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.inputMount;
    workspace: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.workspace;
    outputTransport: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outputTransport;
    candidateEnvironmentNames: readonly string[];
  }>;
  execution: Readonly<{
    started: boolean;
    unitName: string | null;
    exitCode: number | null;
    authenticatedInputDigest: VerificationActionKeyDigest | null;
    postExecutionInputDigest: VerificationActionKeyDigest | null;
    postExecutionReadbackErrorDigest: VerificationActionKeyDigest | null;
    stdoutStderrDigest: VerificationActionKeyDigest;
    stdoutDigest: VerificationActionKeyDigest;
    stderrDigest: VerificationActionKeyDigest;
    stdoutBytesObserved: number;
    stderrBytesObserved: number;
    outputTruncated: boolean;
    commandStarted: boolean;
    boundedFailureTailDigest: VerificationActionKeyDigest;
  }>;
  reap: Readonly<{
    namespacePid1Exited: boolean;
    killChildEnabled: boolean;
    unshareProcessClosed: boolean;
  }>;
  residue: Readonly<{
    cgroupEmpty: boolean;
    hostReadbackDigest: VerificationActionKeyDigest;
  }>;
  diagnostic: string | null;
  receiptDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedSutInventoryClosureV1 = Readonly<{
  archiveDigest: VerificationActionKeyDigest;
  inventoryDigest: VerificationActionKeyDigest;
  entryCount: number;
  totalFileBytes: number;
  dependencyClosureDigest: VerificationActionKeyDigest;
  gitBundleDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedSutExecutionAuthorizationV1 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA_V1;
  resolutionDigest: VerificationActionKeyDigest;
  ticketDigest: VerificationActionKeyDigest;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  candidateBytesDigest: VerificationActionKeyDigest;
  operationSemanticDigest: VerificationActionKeyDigest;
  normalizedArgv: readonly string[];
  inventoryClosure: CodexDevelopmentHostedSutInventoryClosureV1;
  physicalCommand: CodexDevelopmentHostedSutPhysicalCommandAuthorizationV1;
  executionEnvironment: CiVerificationExecutionEnvironmentV2;
  sandboxPolicyDigest: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1;
  toolPolicy: Readonly<{
    runtime: 'bun';
    supervisor: '/usr/bin/unshare';
    substrate: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.substrate;
    outputTransport: typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outputTransport;
  }>;
  providerOrigin: VerificationActionProviderOriginV2;
  authorizationDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedSutPhysicalCommandObservationV1 = Readonly<{
  commandPlanDigest: VerificationActionKeyDigest;
  executionAuthorizationDigest: VerificationActionKeyDigest;
  physicalCommandProjectionDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedActionRawResultV2 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA_V2;
  executionAuthorizationDigest: VerificationActionKeyDigest;
  command: CodexDevelopmentHostedSutPhysicalCommandObservationV1 | null;
  sandboxReceipt: CodexDevelopmentHostedSutSandboxReceiptV1;
  startedAt: string;
  finishedAt: string;
  rawResultDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedSutDerivedCleanupV1 = Readonly<{
  status: 'passed' | 'failed' | 'not-required';
  evidenceRefs: readonly string[];
  diagnostic: string | null;
}>;

export type CodexDevelopmentHostedSutExecutionProofV1 = Readonly<{
  schema: typeof CI_VERIFICATION_ACTION_SUT_PROOF_SCHEMA_V1;
  authorization: CodexDevelopmentHostedSutExecutionAuthorizationV1;
  observation: CodexDevelopmentHostedActionRawResultV2;
  externalRawResultDigest: VerificationActionKeyDigest;
  proofDigest: VerificationActionKeyDigest;
}>;

export type CodexDevelopmentHostedSutTerminalProjectionV1 = Readonly<{
  result: VerificationGateResultV1;
  cleanup: CodexDevelopmentHostedSutDerivedCleanupV1;
  proof: CodexDevelopmentHostedSutExecutionProofV1;
}>;

export function CodexDevelopmentParseHostedSutSandboxReceiptV1(
  value: unknown
): CodexDevelopmentHostedSutSandboxReceiptV1 {
  const receipt = exactObject(value, [
    'schema', 'policyDigest', 'actionKey', 'capability', 'commandPlanDigest', 'resources',
    'authenticatedArchive', 'rootIsolation', 'execution', 'reap', 'residue', 'diagnostic', 'receiptDigest'
  ], 'sandbox receipt');
  if (receipt.schema !== CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1 ||
      receipt.policyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1 ||
      (receipt.commandPlanDigest !== null && (typeof receipt.commandPlanDigest !== 'string' ||
        !DIGEST.test(receipt.commandPlanDigest))) ||
      (receipt.diagnostic !== null && typeof receipt.diagnostic !== 'string') ||
      !canonicalEquals(receipt.resources, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits)) {
    fail('sandbox receipt identity is invalid.');
  }
  const capability = exactObject(receipt.capability, [
    'commandPlanDigest', 'commandStarted', 'exitCode', 'markerObserved', 'outputDigest',
    'teardownCommandStarted', 'teardownExitCode', 'residueMarkerObserved', 'cgroupEmpty',
    'residueReadbackDigest', 'diagnostic'
  ], 'sandbox capability observation');
  if ((capability.commandPlanDigest !== null && (typeof capability.commandPlanDigest !== 'string' ||
        !DIGEST.test(capability.commandPlanDigest))) ||
      typeof capability.commandStarted !== 'boolean' ||
      (capability.exitCode !== null && (!Number.isSafeInteger(capability.exitCode) ||
        Number(capability.exitCode) < 0 || Number(capability.exitCode) > 255)) ||
      typeof capability.markerObserved !== 'boolean' ||
      typeof capability.teardownCommandStarted !== 'boolean' ||
      (capability.teardownExitCode !== null && (!Number.isSafeInteger(capability.teardownExitCode) ||
        Number(capability.teardownExitCode) < 0 || Number(capability.teardownExitCode) > 255)) ||
      typeof capability.residueMarkerObserved !== 'boolean' ||
      typeof capability.cgroupEmpty !== 'boolean' ||
      (capability.diagnostic !== null && typeof capability.diagnostic !== 'string')) {
    fail('sandbox capability primitive observation is invalid.');
  }
  digest(capability.outputDigest, 'sandbox capability output');
  digest(capability.residueReadbackDigest, 'sandbox capability residue readback');
  const archive = exactObject(receipt.authenticatedArchive, [
    'archiveDigest', 'inventoryDigest', 'dependencyClosureDigest', 'gitBundleDigest',
    'entryCount', 'totalFileBytes'
  ], 'authenticated archive');
  for (const key of ['archiveDigest', 'inventoryDigest', 'dependencyClosureDigest', 'gitBundleDigest'] as const) {
    if (archive[key] !== null && (typeof archive[key] !== 'string' || !DIGEST.test(archive[key]))) {
      fail(`authenticated archive ${key} is invalid.`);
    }
  }
  if (!Number.isSafeInteger(archive.entryCount) || Number(archive.entryCount) < 0 ||
      !Number.isSafeInteger(archive.totalFileBytes) || Number(archive.totalFileBytes) < 0) {
    fail('authenticated archive size observation is invalid.');
  }
  const root = exactObject(receipt.rootIsolation, [
    'substrate', 'namespaces', 'uid', 'gid', 'network', 'inputMount', 'workspace',
    'outputTransport', 'candidateEnvironmentNames'
  ], 'root isolation');
  const canonicalRoot = Object.freeze({
    substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.substrate,
    namespaces: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.namespaces,
    uid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid,
    gid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid,
    network: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.network,
    inputMount: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.inputMount,
    workspace: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.workspace,
    outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outputTransport
  });
  const { candidateEnvironmentNames, ...rootPolicy } = root;
  const environmentNames = canonicalStrings(candidateEnvironmentNames, 'candidate environment names');
  if (!canonicalEquals(rootPolicy, canonicalRoot) ||
      new Set(environmentNames).size !== environmentNames.length ||
      [...environmentNames].sort().some((name, index) => name !== environmentNames[index]) ||
      environmentNames.some((name) => !/^[A-Z][A-Z0-9_]*$/u.test(name))) {
    fail('root isolation policy or environment names are invalid.');
  }
  const execution = exactObject(receipt.execution, [
    'started', 'unitName', 'exitCode', 'authenticatedInputDigest', 'postExecutionInputDigest',
    'postExecutionReadbackErrorDigest', 'stdoutStderrDigest',
    'stdoutDigest', 'stderrDigest', 'stdoutBytesObserved', 'stderrBytesObserved', 'outputTruncated',
    'commandStarted', 'boundedFailureTailDigest'
  ], 'execution observation');
  if (typeof execution.started !== 'boolean' || typeof execution.commandStarted !== 'boolean' ||
      typeof execution.outputTruncated !== 'boolean' ||
      (execution.unitName !== null && (typeof execution.unitName !== 'string' ||
        !/^sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(execution.unitName))) ||
      (execution.exitCode !== null && (!Number.isSafeInteger(execution.exitCode) ||
        Number(execution.exitCode) < 0 || Number(execution.exitCode) > 255)) ||
      (execution.authenticatedInputDigest !== null && (typeof execution.authenticatedInputDigest !== 'string' ||
        !DIGEST.test(execution.authenticatedInputDigest))) ||
      (execution.postExecutionInputDigest !== null && (typeof execution.postExecutionInputDigest !== 'string' ||
        !DIGEST.test(execution.postExecutionInputDigest))) ||
      (execution.postExecutionReadbackErrorDigest !== null &&
        (typeof execution.postExecutionReadbackErrorDigest !== 'string' ||
          !DIGEST.test(execution.postExecutionReadbackErrorDigest))) ||
      !Number.isSafeInteger(execution.stdoutBytesObserved) || Number(execution.stdoutBytesObserved) < 0 ||
      !Number.isSafeInteger(execution.stderrBytesObserved) || Number(execution.stderrBytesObserved) < 0) {
    fail('execution primitive observation is invalid.');
  }
  for (const key of ['stdoutStderrDigest', 'stdoutDigest', 'stderrDigest', 'boundedFailureTailDigest'] as const) {
    digest(execution[key], `execution ${key}`);
  }
  const reap = exactObject(receipt.reap, [
    'namespacePid1Exited', 'killChildEnabled', 'unshareProcessClosed'
  ], 'reap observation');
  const residue = exactObject(receipt.residue, ['cgroupEmpty', 'hostReadbackDigest'], 'residue observation');
  if (typeof reap.namespacePid1Exited !== 'boolean' || typeof reap.killChildEnabled !== 'boolean' ||
      typeof reap.unshareProcessClosed !== 'boolean' || typeof residue.cgroupEmpty !== 'boolean') {
    fail('reap or residue primitive observation is invalid.');
  }
  digest(residue.hostReadbackDigest, 'residue host readback');
  const receiptDigest = digest(receipt.receiptDigest, 'sandbox receipt');
  const { receiptDigest: ignored, ...withoutDigest } = receipt;
  void ignored;
  if (receiptDigest !== canonicalDigest(withoutDigest)) fail('sandbox receipt digest mismatch.');
  return Object.freeze({
    ...(receipt as unknown as CodexDevelopmentHostedSutSandboxReceiptV1),
    capability: Object.freeze({
      ...(capability as unknown as CodexDevelopmentHostedSutSandboxCapabilityObservationV1)
    }),
    authenticatedArchive: Object.freeze({ ...(archive as unknown as CodexDevelopmentHostedSutSandboxReceiptV1['authenticatedArchive']) }),
    rootIsolation: Object.freeze({
      ...(root as unknown as CodexDevelopmentHostedSutSandboxReceiptV1['rootIsolation']),
      candidateEnvironmentNames: environmentNames
    }),
    execution: Object.freeze({ ...(execution as unknown as CodexDevelopmentHostedSutSandboxReceiptV1['execution']) }),
    reap: Object.freeze({ ...(reap as unknown as CodexDevelopmentHostedSutSandboxReceiptV1['reap']) }),
    residue: Object.freeze({ ...(residue as unknown as CodexDevelopmentHostedSutSandboxReceiptV1['residue']) }),
    receiptDigest
  });
}

function parseInventoryClosure(value: unknown): CodexDevelopmentHostedSutInventoryClosureV1 {
  const closure = exactObject(value, [
    'archiveDigest', 'inventoryDigest', 'entryCount', 'totalFileBytes',
    'dependencyClosureDigest', 'gitBundleDigest'
  ], 'inventory closure');
  if (!Number.isSafeInteger(closure.entryCount) || Number(closure.entryCount) < 1 ||
      !Number.isSafeInteger(closure.totalFileBytes) || Number(closure.totalFileBytes) < 1) {
    fail('inventory closure size is invalid.');
  }
  return Object.freeze({
    archiveDigest: digest(closure.archiveDigest, 'inventory archive'),
    inventoryDigest: digest(closure.inventoryDigest, 'inventory'),
    entryCount: Number(closure.entryCount),
    totalFileBytes: Number(closure.totalFileBytes),
    dependencyClosureDigest: digest(closure.dependencyClosureDigest, 'dependency closure'),
    gitBundleDigest: digest(closure.gitBundleDigest, 'Git closure')
  });
}

function parseProviderOrigin(value: unknown): VerificationActionProviderOriginV2 {
  const origin = exactObject(value, [
    'repositoryId', 'repository', 'workflowPath', 'workflowRef', 'workflowSha', 'runId',
    'runAttempt', 'appId', 'appNodeId', 'sourceEvent'
  ], 'provider origin');
  if (!Number.isSafeInteger(origin.repositoryId) || Number(origin.repositoryId) < 1 ||
      !Number.isSafeInteger(origin.runAttempt) || Number(origin.runAttempt) < 1 ||
      !Number.isSafeInteger(origin.appId) || Number(origin.appId) < 1 ||
      origin.workflowPath !== '.github/workflows/compiler-pr-validation.yml' ||
      origin.sourceEvent !== 'repository_dispatch') {
    fail('provider origin numeric or transport identity is invalid.');
  }
  const workflowSha = sha(origin.workflowSha, 'provider workflow');
  const workflowPath = origin.workflowPath;
  if (origin.workflowRef !== `${workflowPath}@${workflowSha}` || !/^[1-9][0-9]*$/u.test(text(origin.runId, 'provider runId'))) {
    fail('provider workflow reference or runId is invalid.');
  }
  return Object.freeze({
    repositoryId: Number(origin.repositoryId),
    repository: text(origin.repository, 'provider repository'),
    workflowPath,
    workflowRef: origin.workflowRef as string,
    workflowSha,
    runId: origin.runId as string,
    runAttempt: Number(origin.runAttempt),
    appId: Number(origin.appId),
    appNodeId: text(origin.appNodeId, 'provider appNodeId'),
    sourceEvent: 'repository_dispatch'
  });
}

function parseAuthorization(
  value: unknown,
  expected: Readonly<{
    actionPlan: VerificationActionPlanV2;
    normalizedOperation: CiVerificationNormalizedOperationV2;
    candidateSha: string;
    candidateBytesDigest: string;
    manifestPath: string;
    producer: VerificationActionProviderOriginV2;
  }>
): CodexDevelopmentHostedSutExecutionAuthorizationV1 {
  const authorization = exactObject(value, [
    'schema', 'resolutionDigest', 'ticketDigest', 'actionKey', 'candidateSha', 'candidateBytesDigest',
    'operationSemanticDigest', 'normalizedArgv', 'inventoryClosure', 'physicalCommand', 'executionEnvironment',
    'sandboxPolicyDigest', 'toolPolicy', 'providerOrigin', 'authorizationDigest'
  ], 'execution authorization');
  if (authorization.schema !== CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA_V1 ||
      authorization.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1) {
    fail('execution authorization schema or sandbox policy is invalid.');
  }
  const plan = parseVerificationActionPlanV2(encodeVerificationActionDataV2(expected.actionPlan));
  const operation = parseCiVerificationNormalizedOperationV2(expected.normalizedOperation);
  const normalizedArgv = canonicalStrings(authorization.normalizedArgv, 'authorized argv');
  const providerOrigin = parseProviderOrigin(authorization.providerOrigin);
  const actionKey = digest(authorization.actionKey, 'authorization ActionKey');
  const ticketDigest = digest(authorization.ticketDigest, 'authorization ticket');
  const expectedPhysicalCommand = physicalCommandAuthorization({
    actionKey,
    ticketDigest,
    normalizedOperation: operation,
    manifestPath: expected.manifestPath
  });
  if (!canonicalEquals(authorization.physicalCommand, expectedPhysicalCommand)) {
    fail('execution authorization physical command differs from the trusted Action projection.');
  }
  const toolPolicy = exactObject(authorization.toolPolicy, [
    'runtime', 'supervisor', 'substrate', 'outputTransport'
  ], 'tool policy');
  if (toolPolicy.runtime !== 'bun' || toolPolicy.supervisor !== '/usr/bin/unshare' ||
      toolPolicy.substrate !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.substrate ||
      toolPolicy.outputTransport !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outputTransport) {
    fail('execution authorization tool policy is invalid.');
  }
  const executionEnvironment = authorization.executionEnvironment as CiVerificationExecutionEnvironmentV2;
  if (!canonicalEquals(executionEnvironment, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2)) {
    fail('execution authorization hosted environment is invalid.');
  }
  const parsed = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA_V1,
    resolutionDigest: digest(authorization.resolutionDigest, 'authorization resolution'),
    ticketDigest,
    actionKey,
    candidateSha: sha(authorization.candidateSha, 'authorization candidate'),
    candidateBytesDigest: digest(authorization.candidateBytesDigest, 'authorization candidate bytes'),
    operationSemanticDigest: digest(authorization.operationSemanticDigest, 'authorization operation'),
    normalizedArgv,
    inventoryClosure: parseInventoryClosure(authorization.inventoryClosure),
    physicalCommand: expectedPhysicalCommand,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
    sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
    toolPolicy: Object.freeze({
      runtime: 'bun' as const,
      supervisor: '/usr/bin/unshare' as const,
      substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.substrate,
      outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outputTransport
    }),
    providerOrigin,
    authorizationDigest: digest(authorization.authorizationDigest, 'execution authorization')
  });
  const { authorizationDigest, ...withoutDigest } = parsed;
  if (authorizationDigest !== canonicalDigest(withoutDigest) ||
      parsed.actionKey !== plan.action.actionKey ||
      parsed.candidateSha !== expected.candidateSha ||
      parsed.candidateBytesDigest !== expected.candidateBytesDigest ||
      parsed.operationSemanticDigest !== operation.semanticDigest ||
      !canonicalEquals(parsed.normalizedArgv, ciVerificationNormalizedOperationArgvV2(operation)) ||
      !canonicalEquals(parsed.providerOrigin, expected.producer) ||
      operation.semanticDigest !== plan.action.operation.semanticDigest ||
      operation.gateId !== plan.action.operation.identity ||
      parsed.executionEnvironment.executionEnvironmentRevision !== plan.action.environment.providerRevision ||
      parsed.providerOrigin.workflowSha !== operation.candidate.baseSha) {
    fail('execution authorization differs from the trusted Action, operation, candidate, or provider origin.');
  }
  return parsed;
}

export function CodexDevelopmentCreateHostedSutExecutionAuthorizationV1(input: Readonly<{
  resolutionDigest: VerificationActionKeyDigest;
  ticketDigest: VerificationActionKeyDigest;
  actionPlan: VerificationActionPlanV2;
  normalizedOperation: CiVerificationNormalizedOperationV2;
  candidateSha: string;
  candidateBytesDigest: VerificationActionKeyDigest;
  manifestPath: string;
  inventoryClosure: CodexDevelopmentHostedSutInventoryClosureV1;
  producer: VerificationActionProviderOriginV2;
}>): CodexDevelopmentHostedSutExecutionAuthorizationV1 {
  const plan = parseVerificationActionPlanV2(encodeVerificationActionDataV2(input.actionPlan));
  const operation = parseCiVerificationNormalizedOperationV2(input.normalizedOperation);
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA_V1,
    resolutionDigest: digest(input.resolutionDigest, 'authorization resolution'),
    ticketDigest: digest(input.ticketDigest, 'authorization ticket'),
    actionKey: plan.action.actionKey,
    candidateSha: sha(input.candidateSha, 'authorization candidate'),
    candidateBytesDigest: digest(input.candidateBytesDigest, 'authorization candidate bytes'),
    operationSemanticDigest: operation.semanticDigest,
    normalizedArgv: Object.freeze([...ciVerificationNormalizedOperationArgvV2(operation)]),
    inventoryClosure: parseInventoryClosure(input.inventoryClosure),
    physicalCommand: physicalCommandAuthorization({
      actionKey: plan.action.actionKey,
      ticketDigest: input.ticketDigest,
      normalizedOperation: operation,
      manifestPath: input.manifestPath
    }),
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
    sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
    toolPolicy: Object.freeze({
      runtime: 'bun' as const,
      supervisor: '/usr/bin/unshare' as const,
      substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.substrate,
      outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outputTransport
    }),
    providerOrigin: parseProviderOrigin(input.producer)
  });
  return parseAuthorization({
    ...withoutDigest,
    authorizationDigest: canonicalDigest(withoutDigest)
  }, {
    actionPlan: plan,
    normalizedOperation: operation,
    candidateSha: input.candidateSha,
    candidateBytesDigest: input.candidateBytesDigest,
    manifestPath: input.manifestPath,
    producer: input.producer
  });
}

export function CodexDevelopmentFinalizeHostedActionRawResultV2(input: Omit<
  CodexDevelopmentHostedActionRawResultV2,
  'schema' | 'rawResultDigest'
>): CodexDevelopmentHostedActionRawResultV2 {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA_V2,
    executionAuthorizationDigest: input.executionAuthorizationDigest,
    command: input.command,
    sandboxReceipt: input.sandboxReceipt,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt
  });
  return Object.freeze({ ...withoutDigest, rawResultDigest: canonicalDigest(withoutDigest) });
}

export function CodexDevelopmentParseHostedActionRawResultV2(
  source: string
): CodexDevelopmentHostedActionRawResultV2 {
  const raw = exactObject(JSON.parse(source) as unknown, [
    'schema', 'executionAuthorizationDigest', 'command', 'sandboxReceipt',
    'startedAt', 'finishedAt', 'rawResultDigest'
  ], 'raw observation');
  if (raw.schema !== CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA_V2) fail('raw observation schema mismatch.');
  const startedAt = text(raw.startedAt, 'raw startedAt');
  const finishedAt = text(raw.finishedAt, 'raw finishedAt');
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    fail('raw observation timestamps are invalid.');
  }
  const command = raw.command === null ? null : (() => {
    const value = exactObject(raw.command, [
      'commandPlanDigest', 'executionAuthorizationDigest', 'physicalCommandProjectionDigest'
    ], 'physical command');
    return Object.freeze({
      commandPlanDigest: digest(value.commandPlanDigest, 'physical command plan'),
      executionAuthorizationDigest: digest(
        value.executionAuthorizationDigest,
        'physical command execution authorization'
      ),
      physicalCommandProjectionDigest: digest(
        value.physicalCommandProjectionDigest,
        'physical command projection'
      )
    });
  })();
  const sandboxReceipt = CodexDevelopmentParseHostedSutSandboxReceiptV1(raw.sandboxReceipt);
  const parsed = Object.freeze({
    schema: CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA_V2,
    executionAuthorizationDigest: digest(raw.executionAuthorizationDigest, 'raw authorization'),
    command,
    sandboxReceipt,
    startedAt,
    finishedAt,
    rawResultDigest: digest(raw.rawResultDigest, 'raw result')
  });
  const { rawResultDigest, ...withoutDigest } = parsed;
  if (rawResultDigest !== canonicalDigest(withoutDigest)) fail('raw result digest mismatch.');
  return parsed;
}

export function CodexDevelopmentReduceHostedSutObservationV1(input: Readonly<{
  actionPlan: VerificationActionPlanV2;
  normalizedOperation: CiVerificationNormalizedOperationV2;
  candidateSha: string;
  candidateBytesDigest: string;
  producer: VerificationActionProviderOriginV2;
  manifestPath: string;
  authorization: CodexDevelopmentHostedSutExecutionAuthorizationV1;
  observation: CodexDevelopmentHostedActionRawResultV2;
  expectedRawResultDigest: string;
}>): CodexDevelopmentHostedSutTerminalProjectionV1 {
  const operation = parseCiVerificationNormalizedOperationV2(input.normalizedOperation);
  const authorization = parseAuthorization(input.authorization, input);
  const observation = CodexDevelopmentParseHostedActionRawResultV2(
    encodeVerificationActionDataV2(input.observation)
  );
  if (observation.rawResultDigest !== input.expectedRawResultDigest) {
    fail('raw transport digest differs from the trusted external observation.');
  }
  const receipt = observation.sandboxReceipt;
  const command = observation.command;
  if (observation.executionAuthorizationDigest !== authorization.authorizationDigest ||
      receipt.actionKey !== authorization.actionKey ||
      receipt.authenticatedArchive.archiveDigest !== authorization.inventoryClosure.archiveDigest ||
      receipt.authenticatedArchive.inventoryDigest !== authorization.inventoryClosure.inventoryDigest ||
      receipt.authenticatedArchive.entryCount !== authorization.inventoryClosure.entryCount ||
      receipt.authenticatedArchive.totalFileBytes !== authorization.inventoryClosure.totalFileBytes ||
      receipt.authenticatedArchive.dependencyClosureDigest !== authorization.inventoryClosure.dependencyClosureDigest ||
      receipt.authenticatedArchive.gitBundleDigest !== authorization.inventoryClosure.gitBundleDigest) {
    fail('raw observation differs from the execution authorization or exact inventory closure.');
  }
  if (command !== null && (
    command.commandPlanDigest !== receipt.commandPlanDigest ||
    command.commandPlanDigest !== authorization.physicalCommand.projectionDigest ||
    command.executionAuthorizationDigest !== authorization.authorizationDigest ||
    command.physicalCommandProjectionDigest !== authorization.physicalCommand.projectionDigest ||
    receipt.execution.unitName !== authorization.physicalCommand.unitName ||
    !canonicalEquals(
      receipt.rootIsolation.candidateEnvironmentNames,
      authorization.physicalCommand.fixedSandboxEnvironment.map((entry) => entry.name)
    )
  )) fail('physical command observation differs from its authorization or sandbox receipt.');
  const capabilitySupported =
    receipt.capability.commandPlanDigest === authorization.physicalCommand.projectionDigest &&
    receipt.capability.commandStarted && receipt.capability.exitCode === 0 &&
    receipt.capability.markerObserved && receipt.capability.teardownCommandStarted &&
    receipt.capability.teardownExitCode === 0 && receipt.capability.residueMarkerObserved &&
    receipt.capability.cgroupEmpty && receipt.capability.diagnostic === null;
  const capabilityUnsupported = !capabilitySupported && receipt.capability.commandStarted &&
    receipt.capability.teardownCommandStarted && receipt.capability.cgroupEmpty &&
    /not found|no such file|operation not permitted|failed to connect to bus|unshare failed|unknown option/iu
      .test(receipt.capability.diagnostic ?? '');
  if (capabilitySupported && command === null) {
    fail('supported sandbox observation lost its authorized physical command.');
  }
  if (!capabilitySupported && command !== null) {
    fail('non-supported sandbox observation cannot claim a candidate command.');
  }

  const outputBound = !receipt.execution.outputTruncated &&
    receipt.execution.stdoutBytesObserved <= CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1 &&
    receipt.execution.stderrBytesObserved <= CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT_V1;
  const executionClean = capabilitySupported && command !== null && receipt.commandPlanDigest !== null &&
    receipt.execution.started && receipt.execution.commandStarted &&
    receipt.execution.authenticatedInputDigest === authorization.inventoryClosure.archiveDigest &&
    receipt.execution.postExecutionInputDigest === authorization.inventoryClosure.archiveDigest &&
    receipt.execution.postExecutionReadbackErrorDigest === null &&
    Number.isSafeInteger(receipt.execution.exitCode) &&
    outputBound &&
    receipt.reap.namespacePid1Exited && receipt.reap.killChildEnabled &&
    receipt.reap.unshareProcessClosed && receipt.residue.cgroupEmpty;
  const unsupported = capabilityUnsupported && command === null &&
    !receipt.execution.started && !receipt.execution.commandStarted &&
    receipt.execution.exitCode === null && receipt.execution.authenticatedInputDigest === null &&
    receipt.execution.postExecutionInputDigest === null &&
    receipt.execution.postExecutionReadbackErrorDigest === null &&
    receipt.reap.killChildEnabled && receipt.reap.unshareProcessClosed && receipt.residue.cgroupEmpty;
  const cleanPass = executionClean && receipt.execution.exitCode === 0 && receipt.diagnostic === null;
  const status = unsupported ? 'unsupported' as const
    : cleanPass ? 'passed' as const
      : executionClean && receipt.execution.exitCode !== 0 ? 'failed' as const
      : 'invalidated' as const;
  const receiptRef = `${RECEIPT_REF_PREFIX}${receipt.receiptDigest}`;
  const diagnostic = status === 'passed' ? null
    : receipt.diagnostic ?? (status === 'failed'
      ? `${operation.gateId} exited non-zero without a diagnostic.`
      : status === 'unsupported'
        ? 'Hosted SUT sandbox is unsupported.'
        : 'Hosted SUT physical observation or sandbox settlement is invalidated.');
  const executed = status === 'passed' || status === 'failed';
  const result = CodexDevelopmentBuildVerificationGateResultV1({
    gateId: operation.gateId,
    gateRevision: input.actionPlan.action.operation.revision,
    owner: 'ci-verification-maintainer',
    requirementKey: `gate:${operation.gateId}`,
    subjectRevision: authorization.candidateSha,
    inputDigest: authorization.actionKey,
    applicability: status === 'invalidated' ? 'unresolved' : 'required',
    status,
    disposition: executed ? 'executed' : 'not-executed',
    reasonCode: status === 'passed' ? 'executed-success'
      : status === 'failed' ? 'executed-failure'
        : status === 'unsupported' ? 'platform-unsupported' : 'input-invalidated',
    requiredForClaims: [`gate:${operation.gateId}`],
    supportedClaims: executed ? [`gate:${operation.gateId}`] : [],
    environment: executed ? {
      runtime: 'bun',
      os: authorization.executionEnvironment.os,
      arch: authorization.executionEnvironment.arch,
      filesystem: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.rootIsolation,
      capabilities: [authorization.sandboxPolicyDigest],
      toolchainRevision: authorization.executionEnvironment.toolchainRevision,
      providerRevisions: [CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2]
    } : null,
    execution: executed ? {
      argv: [...authorization.normalizedArgv],
      startedAt: observation.startedAt,
      finishedAt: observation.finishedAt,
      durationMs: Math.max(0, Date.parse(observation.finishedAt) - Date.parse(observation.startedAt)),
      exitCode: receipt.execution.exitCode!,
      outputDigest: receipt.execution.stdoutStderrDigest,
      failureFingerprint: status === 'passed' ? null : receipt.execution.stdoutStderrDigest
    } : null,
    evidenceRefs: [receiptRef],
    invalidationRules: [
      'ActionKey, normalized operation, exact inventory closure, provider origin, sandbox policy, or hosted environment changes'
    ],
    diagnostic
  });
  const cleanup: CodexDevelopmentHostedSutDerivedCleanupV1 = status === 'invalidated'
    ? Object.freeze({ status: 'failed', evidenceRefs: Object.freeze([receiptRef]), diagnostic })
    : status === 'unsupported'
      ? Object.freeze({ status: 'not-required', evidenceRefs: Object.freeze([receiptRef]), diagnostic: null })
      : Object.freeze({ status: 'passed', evidenceRefs: Object.freeze([receiptRef]), diagnostic: null });
  const proofWithoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SUT_PROOF_SCHEMA_V1,
    authorization,
    observation,
    externalRawResultDigest: digest(input.expectedRawResultDigest, 'external raw result')
  });
  const proof = Object.freeze({
    ...proofWithoutDigest,
    proofDigest: canonicalDigest(proofWithoutDigest)
  });
  return Object.freeze({ result, cleanup, proof });
}
