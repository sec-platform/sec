import path from 'node:path';

import type { AcceptanceCoverageReport } from '../../../../assurance/acceptance/coverage.ts';
import type { CurrentCanonicalVerificationReport } from '../../../../assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { RuntimeVerificationLaneReport, SemanticMutationVerificationCapabilityPlan } from '../../../../assurance/verification/contract/types.ts';
import {
  parseIsolatedChildOutcomeBytes,
  type IsolatedChildFailureStage,
  type IsolatedChildOutcome
} from '../../../../assurance/verification/semantic-mutation/isolated/child-outcome.ts';
import {
  classifyIsolatedVerificationArtifactSet,
  projectIsolatedSemanticBundle,
  type IsolatedSemanticBundleEvidence
} from '../../../../assurance/verification/semantic-mutation/isolated/classification.ts';
import { isolatedVerificationEvidenceDigest } from '../../../../assurance/verification/semantic-mutation/isolated/evidence.ts';
import {
  classifyIsolatedTermination,
  parseIsolatedProgressTransportBytes,
  ISOLATED_PROGRESS_CHECKPOINTS,
  type IsolatedProgressCheckpoint,
  type IsolatedProgressReadResult,
  type IsolatedProgressTrace,
  type IsolatedTerminationClass
} from '../../../../assurance/verification/semantic-mutation/isolated/progress.ts';
import type { StagedVerificationProofSource } from '../../../../assurance/verification/staged-proof/contract.ts';
import {
  PIPELINE_EXECUTION_BOUNDARIES,
  type PipelineExecutionBoundary
} from '../../../../compiler/pipeline/execution-boundaries.ts';
import { cloneAndDeepFreeze, rawSha256 } from '../../../../contracts/canonical.ts';
import { type CommitFence } from "../../../../contracts/commit-fence.ts";
import { posixPath } from '../../../../contracts/relative-path.ts';
import { ResourceCompositeSettlementError } from '../../../../execution/resource-settlement.ts';
import type { PolicyReport } from '../../../../semantics/policies/types.ts';
import { isSemanticMutationStagingWorkspace } from '../../../../workspace/contract/semantic-mutation/staging.ts';
import { modelRelativePath } from '../../../../workspace/contract/types.ts';
import { listFilesRecursive } from '../../../filesystem/discovery.ts';
import { pathExists } from "../../../filesystem/files.ts";
import { createWorkspaceWriteCommitFence, isCanonicalWorkspaceWriteCommitFence, type WorkspaceWriteLeaseToken } from '../../../filesystem/write-lease.ts';
import type { ObservedCommandOutcome } from '../../../runtime-state/physical/runtime/observed-process.ts';
import {
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  retainNoFollowFileTransaction,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  type CommandResult,
  type RunCommandOptions
} from '../../../runtime-state/physical/runtime/process.ts';
import { ensureSharedDepsReady } from '../../../toolchain/dependencies/runtime.ts';
import {
  compilerRuntimeLayout,
  compilerRuntimeResources, loadCanonicalBunRuntimeVersion
} from '../../../toolchain/runtime.ts';
import { compilerRoot, officialRegistryRelativePath, resolveWorkspaceArtifactPath, resolveWorkspaceLockPath, resolveWorkspacePlanPath, srcRelativePath } from "../../../workspace-context.ts";
import { readLockFile } from "../../../workspace/lock.ts";
import {
  buildWorkspaceSemanticBundle,
} from '../../../workspace/semantic-bundle.ts';
import { loadWorkspacePlan } from '../../../workspace/sources/load-plan.ts';
import { readOptionalAuthorityBytes } from '../../../workspace/sources/read-authority-source.ts';
import { assertIsolatedStagingTree } from '../../assert-isolated-staging-tree.ts';
import { hasProvenFastSuiteProcessWideWriteSandbox } from '../../fast-suite-sandbox-capability.ts';
import {
  isolatedChildOutcomePath,
  isolatedChildOutcomePendingPath
} from './child-outcome.ts';
import {
  ISOLATED_RUNNER_CORE_RELATIVE_PATH
} from './child-progress.ts';
import {
  resetSemanticMutationIsolatedExecutionPhaseTelemetry,
  resetSemanticMutationIsolatedPhaseTelemetry,
  withSemanticMutationIsolatedPhaseTelemetry
} from './phase-telemetry.ts';
import {
  captureIsolatedRuntimeBuildNodeModulesProof,
  resolveIsolatedRuntimeDependencySources,
  revalidateIsolatedRuntimeBuildNodeModulesProof
} from '../../run-runtime-verification.ts';
import {
  resolveIsolatedRuntimeBinding
} from './runtime-binding.ts';
import {
  assertIsolatedRuntimeLaunchManifest,
  issueIsolatedRuntimeCapability,
  materializeIsolatedRuntime,
  ISOLATED_BUNFIG_RELATIVE_PATH,
  ISOLATED_COMPILER_DEPS_RELATIVE_ROOT,
  ISOLATED_COMPILER_RESOURCE_DESTINATIONS,
  type IsolatedCompilerRegistryInput,
  type IsolatedRuntimeInputSources,
  type IsolatedRuntimeSourcePaths
} from './runtime-plan.ts';
import {
  IsolatedVerificationUnavailableError,
  type IsolatedVerificationArtifact,
  type IsolatedVerificationFailure,
  type IsolatedVerificationFailureStage
} from './verification-failure.ts';
import {
  issueStagedVerificationProofSource
} from '../../staged-verification-proof.ts';
import { runSemanticMutationIsolatedProcess } from './process.ts';

;
;

type WindowsAppContainerExecutionPhase =
  | 'invalid-input' | 'preparation' | 'acl' | 'launch' | 'wait' | 'timeout' | 'cleanup';
type WindowsAppContainerPreparationSubstage =
  | 'native-helper-entry' | 'native-helper-build' | 'native-helper-bundle-contract'
  | 'native-helper-materialization' | 'native-helper-invocation' | 'native-helper-protocol'
  | 'native-helper-diagnostic' | 'native-receipt' | 'sid-derivation' | 'profile-creation'
  | 'owner-publication' | 'runtime-identity' | 'system-directory' | 'unknown';
interface WindowsAppContainerHostToolFailure {
  readonly stage: 'acl-grant' | 'acl-remove' | 'acl-verify-absent' | 'profile-query';
  readonly reason: 'spawn' | 'nonzero-exit' | 'timeout' | 'lease-loss' |
    'lifecycle-failure' | 'output-limit' | 'aborted' | 'termination-unconfirmed';
  readonly termination: 'not-requested' | 'confirmed' | 'unconfirmed';
}
interface WindowsAppContainerNativeHelperObservation {
  readonly mode: 'derive' | 'create-profile' | 'execute';
  readonly exitClass: 'zero' | 'nonzero' | 'invalid';
  readonly diagnosticStream: 'empty' | 'present';
  readonly protocol: 'ok' | 'declared-failure' | 'invalid';
  readonly nativeReceipt: 'not-applicable' | 'absent' | 'exit-code' |
    'declared-failure' | 'invalid' | 'read-error';
}

const ISOLATED_FAILURE_STAGES = new Set<IsolatedVerificationFailureStage>([
  'runtime-materialization',
  'appcontainer-execution',
  'isolated-child-execution',
  'child-failed-before-artifacts',
  'child-terminated-without-outcome',
  'artifact-missing',
  'artifact-parse',
  'artifact-read',
  'artifact-protocol',
  'semantic-rebuild',
  'binding-mismatch'
]);
const ISOLATED_CHILD_FAILURE_STAGES = new Set<IsolatedChildFailureStage>([
  'preflight', 'verify-all', 'postcondition'
]);
const PIPELINE_BOUNDARIES = new Set<PipelineExecutionBoundary>(PIPELINE_EXECUTION_BOUNDARIES);
const ISOLATED_VERIFICATION_ARTIFACTS = new Set<IsolatedVerificationArtifact>([
  'child-outcome', 'child-progress', 'verification-report', 'runtime-report', 'policy-report',
  'acceptance-coverage', 'verification-set'
]);
const ISOLATED_TERMINATION_CLASSES = new Set<IsolatedTerminationClass>([
  'zero', 'runner-controlled-failure', 'runner-entry-failure',
  'bootstrap-environment-boundary-failure',
  'runner-environment-boundary-failure', 'runner-staging-layout-boundary-failure',
  'runner-staging-tree-failure',
  'runner-catch-tree-failure',
  'outcome-publication-failure', 'progress-publication-failure', 'loader-import-failure',
  'unclassified-nonzero'
]);
const ISOLATED_PROGRESS_CHECKPOINTS = new Set<IsolatedProgressCheckpoint>(
  ISOLATED_PROGRESS_CHECKPOINTS
);
const OBSERVED_COMMAND_STATUSES = new Set<ObservedCommandOutcome['status']>([
  'exited', 'spawn-failed', 'aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed',
  'timed-out', 'tree-unproven', 'termination-unproven'
]);
const OBSERVED_COMMAND_TRIGGERS = new Set<NonNullable<ObservedCommandOutcome['trigger']>>([
  'aborted', 'fence-lost', 'lifecycle-failed', 'observer-failed', 'timed-out'
]);
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ISOLATED_RUNNER_ENTERED_TRACE = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started',
  'module-entered'
] as const satisfies readonly IsolatedProgressCheckpoint[]);
const APPCONTAINER_EXECUTION_PHASES = new Set<WindowsAppContainerExecutionPhase>([
  'invalid-input', 'preparation', 'acl', 'launch', 'wait', 'timeout', 'cleanup'
]);
const APPCONTAINER_HOST_TOOL_STAGES = new Set<WindowsAppContainerHostToolFailure['stage']>([
  'acl-grant', 'acl-remove', 'acl-verify-absent', 'profile-query'
]);
const APPCONTAINER_HOST_TOOL_REASONS = new Set<WindowsAppContainerHostToolFailure['reason']>([
  'spawn', 'nonzero-exit', 'timeout', 'lease-loss', 'lifecycle-failure',
  'output-limit', 'aborted', 'termination-unconfirmed'
]);
const APPCONTAINER_TERMINATIONS = new Set<WindowsAppContainerHostToolFailure['termination']>([
  'not-requested', 'confirmed', 'unconfirmed'
]);
const APPCONTAINER_PREPARATION_SUBSTAGES = new Set<WindowsAppContainerPreparationSubstage>([
  'native-helper-entry', 'native-helper-build', 'native-helper-bundle-contract',
  'native-helper-materialization', 'native-helper-invocation',
  'native-helper-protocol', 'native-helper-diagnostic', 'native-receipt', 'sid-derivation',
  'profile-creation', 'owner-publication', 'runtime-identity', 'system-directory', 'unknown'
]);
const APPCONTAINER_NATIVE_HELPER_MODES = new Set<WindowsAppContainerNativeHelperObservation['mode']>([
  'derive', 'create-profile', 'execute'
]);
const APPCONTAINER_NATIVE_HELPER_EXIT_CLASSES =
  new Set<WindowsAppContainerNativeHelperObservation['exitClass']>(['zero', 'nonzero', 'invalid']);
const APPCONTAINER_NATIVE_HELPER_DIAGNOSTICS =
  new Set<WindowsAppContainerNativeHelperObservation['diagnosticStream']>(['empty', 'present']);
const APPCONTAINER_NATIVE_HELPER_PROTOCOLS =
  new Set<WindowsAppContainerNativeHelperObservation['protocol']>([
    'ok', 'declared-failure', 'invalid'
  ]);
const APPCONTAINER_NATIVE_RECEIPTS =
  new Set<WindowsAppContainerNativeHelperObservation['nativeReceipt']>([
    'not-applicable', 'absent', 'exit-code', 'declared-failure', 'invalid', 'read-error'
  ]);

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function projectChildOutcome(
  outcome: IsolatedChildOutcome
): NonNullable<IsolatedVerificationFailure['child']> {
  return Object.freeze({
    stage: outcome.stage,
    ...(outcome.boundary === undefined ? {} : { boundary: outcome.boundary })
  });
}

function projectObservedStream(
  value: unknown
): ObservedCommandOutcome['stdout'] | undefined {
  const record = recordValue(value);
  if (!record || !Number.isSafeInteger(record.bytes) || Number(record.bytes) < 0 ||
    typeof record.digest !== 'string' || !SHA256_DIGEST_PATTERN.test(record.digest) ||
    typeof record.observerTruncated !== 'boolean') {
    return undefined;
  }
  return Object.freeze({
    bytes: Number(record.bytes),
    digest: record.digest as `sha256:${string}`,
    observerTruncated: record.observerTruncated
  });
}

function projectObservedTermination(
  value: unknown
): ObservedCommandOutcome['termination'] | undefined {
  const record = recordValue(value);
  if (!record || typeof record.requested !== 'boolean' ||
    typeof record.gracefulAttempted !== 'boolean' ||
    typeof record.forcedAttempted !== 'boolean' ||
    typeof record.childCloseObserved !== 'boolean' ||
    typeof record.streamsDrained !== 'boolean' ||
    typeof record.treeClosed !== 'boolean') {
    return undefined;
  }
  return Object.freeze({
    requested: record.requested,
    gracefulAttempted: record.gracefulAttempted,
    forcedAttempted: record.forcedAttempted,
    childCloseObserved: record.childCloseObserved,
    streamsDrained: record.streamsDrained,
    treeClosed: record.treeClosed
  });
}

function projectObservedLifecycle(
  value: unknown
): NonNullable<IsolatedVerificationFailure['lifecycle']> | undefined {
  const record = recordValue(value);
  const status = typeof record?.status === 'string' &&
    OBSERVED_COMMAND_STATUSES.has(record.status as ObservedCommandOutcome['status'])
    ? record.status as ObservedCommandOutcome['status']
    : undefined;
  const trigger = record?.trigger === undefined
    ? undefined
    : typeof record.trigger === 'string' &&
      OBSERVED_COMMAND_TRIGGERS.has(record.trigger as NonNullable<ObservedCommandOutcome['trigger']>)
      ? record.trigger as NonNullable<ObservedCommandOutcome['trigger']>
      : null;
  const exitCode = record?.exitCode === null
    ? null
    : Number.isSafeInteger(record?.exitCode) && Number(record?.exitCode) >= 0
      ? Number(record?.exitCode)
      : undefined;
  const stdout = projectObservedStream(record?.stdout);
  const stderr = projectObservedStream(record?.stderr);
  const termination = projectObservedTermination(record?.termination);
  if (status === undefined || trigger === null || typeof record?.started !== 'boolean' ||
    exitCode === undefined || typeof record.durationMs !== 'number' ||
    !Number.isFinite(record.durationMs) || record.durationMs < 0 ||
    stdout === undefined || stderr === undefined || termination === undefined) {
    return undefined;
  }
  return Object.freeze({
    status,
    ...(trigger === undefined ? {} : { trigger }),
    started: record.started,
    exitCode,
    durationMs: record.durationMs,
    stdout,
    stderr,
    termination
  });
}

function boundedObservedLifecycle(
  outcome: ObservedCommandOutcome
): NonNullable<IsolatedVerificationFailure['lifecycle']> {
  const lifecycle = projectObservedLifecycle(outcome);
  if (lifecycle === undefined) {
    throw new Error('Semantic Mutation isolated child lifecycle evidence is invalid');
  }
  return lifecycle;
}

function redactIsolatedVerificationFailure(
  value: unknown,
  fallbackStage: IsolatedVerificationFailureStage
): IsolatedVerificationFailure {
  const record = recordValue(value);
  const stage = typeof record?.stage === 'string' &&
    ISOLATED_FAILURE_STAGES.has(record.stage as IsolatedVerificationFailureStage)
    ? record.stage as IsolatedVerificationFailureStage
    : fallbackStage;
  const childRecord = recordValue(record?.child);
  const childStage = typeof childRecord?.stage === 'string' &&
    ISOLATED_CHILD_FAILURE_STAGES.has(childRecord.stage as IsolatedChildFailureStage)
    ? childRecord.stage as IsolatedChildFailureStage
    : undefined;
  const childBoundary = childStage === 'verify-all' && typeof childRecord?.boundary === 'string' &&
    PIPELINE_BOUNDARIES.has(childRecord.boundary as PipelineExecutionBoundary)
    ? childRecord.boundary as PipelineExecutionBoundary
    : undefined;
  const child = childStage === undefined
    ? undefined
    : Object.freeze({
        stage: childStage,
        ...(childBoundary === undefined ? {} : { boundary: childBoundary })
      });
  const artifact = typeof record?.artifact === 'string' &&
    ISOLATED_VERIFICATION_ARTIFACTS.has(record.artifact as IsolatedVerificationArtifact)
    ? record.artifact as IsolatedVerificationArtifact
    : undefined;
  const terminationRecord = recordValue(record?.termination);
  const terminationClass = typeof terminationRecord?.class === 'string' &&
    ISOLATED_TERMINATION_CLASSES.has(
      terminationRecord.class as IsolatedTerminationClass
    )
    ? terminationRecord.class as IsolatedTerminationClass
    : undefined;
  const checkpoint = typeof terminationRecord?.checkpoint === 'string' &&
    ISOLATED_PROGRESS_CHECKPOINTS.has(
      terminationRecord.checkpoint as IsolatedProgressCheckpoint
    )
    ? terminationRecord.checkpoint as IsolatedProgressCheckpoint
    : undefined;
  const pendingCheckpoint = typeof terminationRecord?.pendingCheckpoint === 'string' &&
    ISOLATED_PROGRESS_CHECKPOINTS.has(
      terminationRecord.pendingCheckpoint as IsolatedProgressCheckpoint
    )
    ? terminationRecord.pendingCheckpoint as IsolatedProgressCheckpoint
    : undefined;
  const termination = terminationClass === undefined
    ? undefined
    : Object.freeze({
        class: terminationClass,
        ...(checkpoint === undefined ? {} : { checkpoint }),
        ...(pendingCheckpoint === undefined ? {} : { pendingCheckpoint })
      });
  const lifecycle = stage === 'isolated-child-execution'
    ? projectObservedLifecycle(record?.lifecycle)
    : undefined;
  const appContainerRecord = recordValue(record?.appContainer);
  if (typeof appContainerRecord?.phase !== 'string' ||
    !APPCONTAINER_EXECUTION_PHASES.has(
      appContainerRecord.phase as WindowsAppContainerExecutionPhase
    )) {
    return Object.freeze({
      stage,
      ...(child === undefined ? {} : { child }),
      ...(artifact === undefined ? {} : { artifact }),
      ...(termination === undefined ? {} : { termination }),
      ...(lifecycle === undefined ? {} : { lifecycle })
    });
  }
  const hostToolRecord = recordValue(appContainerRecord.hostToolFailure);
  const hostToolFailure = typeof hostToolRecord?.stage === 'string' &&
    APPCONTAINER_HOST_TOOL_STAGES.has(hostToolRecord.stage as WindowsAppContainerHostToolFailure['stage']) &&
    typeof hostToolRecord.reason === 'string' &&
    APPCONTAINER_HOST_TOOL_REASONS.has(hostToolRecord.reason as WindowsAppContainerHostToolFailure['reason']) &&
    typeof hostToolRecord.termination === 'string' &&
    APPCONTAINER_TERMINATIONS.has(
      hostToolRecord.termination as WindowsAppContainerHostToolFailure['termination']
    )
    ? Object.freeze({
        stage: hostToolRecord.stage as WindowsAppContainerHostToolFailure['stage'],
        reason: hostToolRecord.reason as WindowsAppContainerHostToolFailure['reason'],
        termination: hostToolRecord.termination as WindowsAppContainerHostToolFailure['termination']
      })
    : undefined;
  const phase = appContainerRecord.phase as WindowsAppContainerExecutionPhase;
  const preparationSubstage = phase === 'preparation' &&
    typeof appContainerRecord.preparationSubstage === 'string' &&
    APPCONTAINER_PREPARATION_SUBSTAGES.has(
      appContainerRecord.preparationSubstage as WindowsAppContainerPreparationSubstage
    )
    ? appContainerRecord.preparationSubstage as WindowsAppContainerPreparationSubstage
    : phase === 'preparation' ? 'unknown' : undefined;
  const nativeHelperObservation = projectNativeHelperObservation(
    appContainerRecord.nativeHelperObservation
  );
  const appContainer = Object.freeze({
    phase,
    ...(preparationSubstage === undefined ? {} : { preparationSubstage }),
    ...(Number.isSafeInteger(appContainerRecord.nativeCode)
      ? { nativeCode: appContainerRecord.nativeCode as number }
      : {}),
    ...(hostToolFailure === undefined ? {} : { hostToolFailure }),
    ...(nativeHelperObservation === undefined ? {} : { nativeHelperObservation })
  });
  return Object.freeze({
    stage,
    ...(child === undefined ? {} : { child }),
    ...(artifact === undefined ? {} : { artifact }),
    appContainer
  });
}

class IsolatedChildLifecycleError extends Error {
  public readonly lifecycle: NonNullable<IsolatedVerificationFailure['lifecycle']>;

  constructor(outcome: ObservedCommandOutcome) {
    super('Semantic Mutation isolated child lifecycle did not settle');
    this.name = 'SemanticMutationIsolatedChildLifecycleError';
    this.lifecycle = boundedObservedLifecycle(outcome);
  }
}

function projectLegacyWindowsAppContainerExecutionError(
  error: unknown
): IsolatedVerificationFailure | undefined {
  if (!(error instanceof Error) || error.name !== 'WindowsAppContainerExecutionError') {
    return undefined;
  }
  const record = recordValue(error);
  if (record === undefined) return undefined;
  const projected = redactIsolatedVerificationFailure({
    stage: 'appcontainer-execution',
    appContainer: record as unknown as NonNullable<
      IsolatedVerificationFailure['appContainer']
    >
  }, 'appcontainer-execution');
  return projected.appContainer === undefined ? undefined : projected;
}

function isolatedVerificationFailure(
  stage: IsolatedVerificationFailureStage,
  error: unknown
): IsolatedVerificationFailure {
  if (error instanceof IsolatedVerificationUnavailableError) {
    return redactIsolatedVerificationFailure(error.failure, stage);
  }
  if (error instanceof IsolatedChildLifecycleError) {
    return redactIsolatedVerificationFailure({
      stage: 'isolated-child-execution',
      lifecycle: error.lifecycle
    }, stage);
  }
  const legacyAppContainerFailure = projectLegacyWindowsAppContainerExecutionError(error);
  if (legacyAppContainerFailure !== undefined) return legacyAppContainerFailure;
  return Object.freeze({ stage });
}

function resolveCanonicalIsolatedRuntimeInputSources(
): IsolatedRuntimeSourcePaths {
  const dependencySources = resolveIsolatedRuntimeDependencySources();
  return Object.freeze({
    compilerModulesRoot: dependencySources.compilerModulesRoot,
    compilerPackage: path.join(compilerRuntimeLayout.packageRoot, 'package.json'),
    composeTemplates: compilerRuntimeResources.composeTemplates,
    dependencyModules: dependencySources.dependencyModules,
    officialPolicies: compilerRuntimeResources.officialPolicies,
    officialRegistry: compilerRuntimeResources.officialRegistry
  });
}

async function prepareCanonicalIsolatedRuntimeInputSources(
): Promise<IsolatedRuntimeInputSources> {
  await ensureSharedDepsReady();
  return Object.freeze(resolveCanonicalIsolatedRuntimeInputSources());
}

function canonicalCompilerRegistryPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\')) {
    throw new Error('Compiler registry path is invalid');
  }
  const canonical = path.posix.normalize(value);
  if (canonical !== value || canonical === '.' || canonical === '..' ||
    canonical.startsWith('../') || path.posix.isAbsolute(canonical)) {
    throw new Error('Compiler registry path is not canonical');
  }
  return canonical;
}

async function compilerRegistryInputs(
  stagingWorkspaceRoot: string,
  sources: IsolatedRuntimeInputSources
): Promise<IsolatedCompilerRegistryInput[]> {
  const officialPath = posixPath(officialRegistryRelativePath);
  const registryPaths = new Set<string>([officialPath]);
  const planPath = await resolveWorkspacePlanPath(stagingWorkspaceRoot);
  if (await pathExists(planPath)) {
    const plan = await loadWorkspacePlan(stagingWorkspaceRoot);
    if (!Array.isArray(plan.registry.sources)) throw new Error('Staging plan registry sources are invalid');
    for (const registry of plan.registry.sources) {
      if (registry.location === 'compiler') registryPaths.add(canonicalCompilerRegistryPath(registry.path));
    }
  }
  const lockPath = await resolveWorkspaceLockPath(stagingWorkspaceRoot);
  if (await pathExists(lockPath)) {
    const lock = await readLockFile(stagingWorkspaceRoot);
    if (!Array.isArray(lock.resolvedBlocks) || !Array.isArray(lock.installPlan)) {
      throw new Error('Staging lock registry bindings are invalid');
    }
    for (const registry of [...lock.resolvedBlocks, ...lock.installPlan]) {
      if (registry.registryLocation === 'compiler') {
        registryPaths.add(canonicalCompilerRegistryPath(registry.registryPath));
      }
    }
  }
  const sortedPaths = [...registryPaths].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0);
  if (sortedPaths.length !== 1 || sortedPaths[0] !== officialPath) {
    throw new Error('Custom compiler registry closure is unavailable in isolated verification');
  }
  return [{
    destinationRelativePath:
      ISOLATED_COMPILER_RESOURCE_DESTINATIONS.officialRegistry,
    sourceRoot: sources.officialRegistry
  }];
}

interface IsolatedVerificationExecutionRequest {
  readonly commitFence: CommitFence;
  readonly env: NodeJS.ProcessEnv;
  readonly runnerRelativePath: string;
  readonly stagingWorkspaceRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

interface IsolatedVerificationSupervisorResult extends CommandResult {
  readonly progress: IsolatedProgressReadResult;
}

export type IsolatedVerificationSupervisor = (
  request: IsolatedVerificationExecutionRequest
) => Promise<IsolatedVerificationSupervisorResult>;

export type IsolatedRunnerBundleBuilder = () => Promise<Uint8Array>;

interface IsolatedRunnerBuildOutput {
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

interface IsolatedRunnerBuildResult {
  readonly success: boolean;
  readonly outputs: readonly IsolatedRunnerBuildOutput[];
}

type IsolatedRunnerBuilder =
  () => Promise<IsolatedRunnerBuildResult>;

const ISOLATED_CAPABILITY_PREPARATION_SUBSTAGES = Object.freeze([
  'runner-build-root-proof',
  'runner-build-invocation',
  'runner-build-unsuccessful',
  'runner-build-output-count',
  'runner-build-output-read',
  'runner-relocation',
  'capability-issue',
  'unknown'
] as const);

type IsolatedCapabilityPreparationSubstage =
  (typeof ISOLATED_CAPABILITY_PREPARATION_SUBSTAGES)[number];

type IsolatedRuntimeCapabilityDiagnostic =
  | IsolatedVerificationFailure
  | Readonly<{
      readonly stage: 'runtime-capability';
      readonly runtimeCapability: Readonly<{
        readonly substage: IsolatedCapabilityPreparationSubstage;
      }>;
    }>;

class IsolatedCapabilityPreparationError extends Error {
  constructor(
    public readonly substage: Exclude<
      IsolatedCapabilityPreparationSubstage,
      'unknown'
    >
  ) {
    super('Semantic Mutation isolated capability preparation failed');
    this.name = 'SemanticMutationIsolatedCapabilityPreparationError';
  }
}

async function withCapabilityPreparationBoundary<T>(
  substage: Exclude<IsolatedCapabilityPreparationSubstage, 'unknown'>,
  execute: () => T | Promise<T>
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof IsolatedCapabilityPreparationError) throw error;
    throw new IsolatedCapabilityPreparationError(substage);
  }
}

async function readIsolatedRunnerBuildOutput(
  build: IsolatedRunnerBuilder
): Promise<Uint8Array> {
  let result: IsolatedRunnerBuildResult;
  try {
    result = await build();
  } catch {
    throw new IsolatedCapabilityPreparationError('runner-build-invocation');
  }
  if (!result.success) {
    throw new IsolatedCapabilityPreparationError('runner-build-unsuccessful');
  }
  if (result.outputs.length !== 1) {
    throw new IsolatedCapabilityPreparationError('runner-build-output-count');
  }
  try {
    return new Uint8Array(await result.outputs[0].arrayBuffer());
  } catch {
    throw new IsolatedCapabilityPreparationError('runner-build-output-read');
  }
}

interface IsolatedVerificationChildCommonOptions {
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

export type IsolatedVerificationChildOptions =
  IsolatedVerificationChildCommonOptions & (
    | {
        readonly capabilityPlan: SemanticMutationVerificationCapabilityPlan;
        readonly commitFence?: never;
        readonly runtimeCapabilityForTest?: never;
        readonly supervisor?: never;
      }
    | {
        readonly capabilityPlan?: never;
        readonly commitFence: CommitFence;
        /** Internal test seam: an exact result from the real runtime probe. */
        readonly runtimeCapabilityForTest: object;
        readonly supervisor?: IsolatedVerificationSupervisor;
      }
  );

function ownDataOption<Value>(
  descriptors: PropertyDescriptorMap,
  key: string,
  label: string
): Value | undefined {
  const descriptor = descriptors[key];
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new Error(`${label} must use fixed data properties`);
  }
  return descriptor.value as Value;
}

export function buildIsolatedVerificationEnvironment(
  stagingWorkspaceRoot: string
): Readonly<Record<string, string>> {
  const writableRoot = path.join(stagingWorkspaceRoot, '.isolated-process', 'child');
  return Object.freeze(Object.fromEntries(Object.entries(buildIsolatedProcessEnvironment(writableRoot, {
    [ISOLATED_VERIFICATION_ENV_KEY]: '1',
    CI: 'true'
  })).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
}

function semanticMutationIsolatedHostSpawnCwd(stagingWorkspaceRoot: string): string {
  return process.platform === 'win32'
    ? path.parse(path.resolve(stagingWorkspaceRoot)).root
    : stagingWorkspaceRoot;
}

function isolatedOwnedRelativePath(stagingWorkspaceRoot: string, filePath: string): string {
  const root = path.resolve(stagingWorkspaceRoot);
  const target = path.resolve(filePath);
  const relative = path.relative(root, target);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' ||
      relative.startsWith(`..${path.sep}`)) {
    throw new Error('Isolated verification owned artifact path escapes the staging workspace');
  }
  return relative.split(path.sep).join('/');
}

async function removeIsolatedOwnedFileIfPresent(
  transaction: ReturnType<typeof retainNoFollowFileTransaction>,
  stagingWorkspaceRoot: string,
  filePath: string,
  commitFence: CommitFence
): Promise<void> {
  const relativePath = isolatedOwnedRelativePath(stagingWorkspaceRoot, filePath);
  let observed;
  try {
    observed = transaction.observe(
      relativePath,
      `Isolated verification stale artifact ${relativePath}`
    );
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return;
    }
    throw error;
  }
  if (observed === null) return;
  await commitFence();
  await transaction.removeExact(
    relativePath,
    observed,
    `Isolated verification stale artifact cleanup ${relativePath}`
  );
}

const ISOLATED_OUTPUT_LIMIT_BYTES = 64 * 1024;
export const ISOLATED_VERIFICATION_TIMEOUT_MS = 1_200_000;

type IsolatedTestCommandRunner = (
  command: string,
  args: string[],
  options: RunCommandOptions
) => Promise<CommandResult>;

export function createIsolatedVerificationSupervisor(options: {
  /** Internal test seam for deterministic command outcomes. */
  readonly commandRunner?: IsolatedTestCommandRunner;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
} = {}): IsolatedVerificationSupervisor {
  const timeoutMs = options.timeoutMs ?? ISOLATED_VERIFICATION_TIMEOUT_MS;
  const runnerArguments = (request: IsolatedVerificationExecutionRequest) => [
    '--no-env-file',
    `--config=${path.join(
      request.stagingWorkspaceRoot,
      ...ISOLATED_BUNFIG_RELATIVE_PATH.split('/')
    )}`,
    '--no-install',
    path.join(request.stagingWorkspaceRoot, ...request.runnerRelativePath.split('/'))
  ];
  if (options.commandRunner === undefined) {
    return async (request) => {
      const observed = await runSemanticMutationIsolatedProcess({
        command: process.execPath,
        args: runnerArguments(request),
        cwd: semanticMutationIsolatedHostSpawnCwd(request.stagingWorkspaceRoot),
        environment: request.env,
        timeoutMs,
        outputLimitBytes: ISOLATED_OUTPUT_LIMIT_BYTES,
        commitFence: request.commitFence
      });
      await request.commitFence();
      const outcome = observed.outcome;
      const progressBytes = Buffer.from(observed.stdout);
      if (outcome.status !== 'exited' || outcome.exitCode === null ||
        !outcome.termination.childCloseObserved || !outcome.termination.streamsDrained ||
        !outcome.termination.treeClosed || outcome.stdout.observerTruncated ||
        outcome.stderr.observerTruncated ||
        progressBytes.byteLength !== outcome.stdout.bytes ||
        (outcome.exitCode === 0 && outcome.stderr.bytes !== 0)) {
        throw new IsolatedChildLifecycleError(outcome);
      }
      return {
        code: observed.code,
        stdout: '',
        stderr: '',
        progress: parseIsolatedProgressTransportBytes(progressBytes)
      };
    };
  }
  const commandRunner = options.commandRunner;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  return async (request) => {
    const controller = new AbortController();
    let phase: 'active' | 'closing' = 'active';
    let pendingLeaseCheck: Promise<void> | undefined;
    let leaseFailure: Readonly<{ error: unknown }> | undefined;
    const checkLease = (): void => {
      if (phase !== 'active' || pendingLeaseCheck !== undefined || leaseFailure !== undefined) return;
      const pending = Promise.resolve()
        .then(() => request.commitFence())
        .catch((error: unknown) => {
          leaseFailure = Object.freeze({ error });
          controller.abort();
        })
        .finally(() => {
          if (pendingLeaseCheck === pending) pendingLeaseCheck = undefined;
        });
      pendingLeaseCheck = pending;
    };
    const monitor = setInterval(checkLease, pollIntervalMs);
    let outcome:
      | Readonly<{ status: 'succeeded'; value: IsolatedVerificationSupervisorResult }>
      | Readonly<{ status: 'failed'; error: unknown }>;
    try {
      await request.commitFence();
      const result = await commandRunner(
        process.execPath,
        runnerArguments(request),
        {
          beforeSpawn: request.commitFence,
          cwd: semanticMutationIsolatedHostSpawnCwd(request.stagingWorkspaceRoot),
          env: request.env,
          envMode: 'replace',
          signal: controller.signal,
          timeoutMs
        }
      );
      await request.commitFence();
      outcome = Object.freeze({
        status: 'succeeded',
        value: Object.freeze({
          ...result,
          stdout: '',
          progress: parseIsolatedProgressTransportBytes(
            Buffer.from(result.stdout, 'utf8')
          )
        })
      });
    } catch (error) {
      outcome = Object.freeze({ status: 'failed', error });
    } finally {
      phase = 'closing';
      clearInterval(monitor);
      const admitted = pendingLeaseCheck;
      if (admitted !== undefined) await admitted;
    }
    if (outcome.status === 'failed' && leaseFailure !== undefined) {
      throw new ResourceCompositeSettlementError([
        { label: 'semantic-mutation-isolated-child', error: outcome.error },
        { label: 'semantic-mutation-lease-observation', error: leaseFailure.error }
      ]);
    }
    if (leaseFailure !== undefined) throw leaseFailure.error;
    if (outcome.status === 'failed') throw outcome.error;
    return outcome.value;
  };
}

type JsonArtifactReadResult =
  | { readonly status: 'ok'; readonly bytes: Uint8Array; readonly value: unknown }
  | { readonly status: 'missing' | 'parse-error' | 'read-error' };

type ChildOutcomeReadResult =
  | { readonly status: 'absent' }
  | { readonly status: 'valid'; readonly value: IsolatedChildOutcome }
  | { readonly status: 'parse-error' | 'read-error' };

type ChildOutcomePendingReadResult =
  | { readonly status: 'absent' | 'present' }
  | { readonly status: 'read-error' };

const MAX_CHILD_OUTCOME_READ_BYTES = 512;

async function readJsonArtifactResult(
  filePath: string,
  commitFence: CommitFence
): Promise<JsonArtifactReadResult> {
  await commitFence();
  let bytes: Uint8Array;
  try {
    const observed = readOptionalAuthorityBytes(filePath, 'Isolated Verification artifact');
    if (observed === null) return { status: 'missing' };
    bytes = new Uint8Array(observed);
  } catch {
    return { status: 'read-error' };
  }
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { status: 'ok', bytes, value: JSON.parse(source) as unknown };
  } catch {
    return { status: 'parse-error' };
  }
}

async function readChildOutcomeResult(
  stagingWorkspaceRoot: string,
  commitFence: CommitFence
): Promise<ChildOutcomeReadResult> {
  await commitFence();
  const outcomePath = isolatedChildOutcomePath(stagingWorkspaceRoot);
  let retained: ReturnType<typeof retainNoFollowOrdinaryFile>;
  try {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(outcomePath),
      'Semantic Mutation isolated child outcome parent'
    );
    retained = retainNoFollowOrdinaryFile(
      parent,
      path.basename(outcomePath),
      undefined,
      'Semantic Mutation isolated child outcome'
    );
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return { status: 'absent' };
    }
    return { status: 'read-error' };
  }

  let result: ChildOutcomeReadResult;
  try {
    retained.assertCurrent();
    if (retained.linkCount !== 1) {
      result = { status: 'read-error' };
    } else if (retained.size > MAX_CHILD_OUTCOME_READ_BYTES) {
      result = { status: 'parse-error' };
    } else {
      const bytes = retained.readBytes();
      if (bytes.byteLength > MAX_CHILD_OUTCOME_READ_BYTES) {
        result = { status: 'parse-error' };
      } else {
        retained.assertCurrent();
        try {
          result = {
            status: 'valid',
            value: parseIsolatedChildOutcomeBytes(bytes)
          };
        } catch {
          result = { status: 'parse-error' };
        }
      }
    }
  } catch {
    result = { status: 'read-error' };
  }
  try {
    retained.dispose();
  } catch {
    return { status: 'read-error' };
  }
  return result;
}

async function readChildOutcomePendingResult(
  stagingWorkspaceRoot: string,
  commitFence: CommitFence
): Promise<ChildOutcomePendingReadResult> {
  await commitFence();
  const pendingPath = isolatedChildOutcomePendingPath(stagingWorkspaceRoot);
  let retained: ReturnType<typeof retainNoFollowOrdinaryFile>;
  try {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(pendingPath),
      'Semantic Mutation isolated child pending outcome parent'
    );
    retained = retainNoFollowOrdinaryFile(
      parent,
      path.basename(pendingPath),
      undefined,
      'Semantic Mutation isolated child pending outcome'
    );
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return { status: 'absent' };
    }
    return { status: 'read-error' };
  }

  let result: ChildOutcomePendingReadResult;
  try {
    retained.assertCurrent();
    result = retained.linkCount === 1 ? { status: 'present' } : { status: 'read-error' };
  } catch {
    result = { status: 'read-error' };
  }
  try {
    retained.dispose();
  } catch {
    return { status: 'read-error' };
  }
  return result;
}

const BUNDLED_RUNTIME_PATH_HELPER = '__secSemanticMutationRuntimePath';
const BUNDLED_RUNTIME_PATH_IMPORT = '__secSemanticMutationFileUrlToPath';
const BUNDLED_NODE_MODULES_SOURCE_PREFIX = '/node_modules/';

function nativePathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved;
}

function projectNativeHelperObservation(
  value: unknown
): WindowsAppContainerNativeHelperObservation | undefined {
  const record = recordValue(value);
  if (!record || !APPCONTAINER_NATIVE_HELPER_MODES.has(
    record.mode as WindowsAppContainerNativeHelperObservation['mode']
  ) || !APPCONTAINER_NATIVE_HELPER_EXIT_CLASSES.has(
    record.exitClass as WindowsAppContainerNativeHelperObservation['exitClass']
  ) || !APPCONTAINER_NATIVE_HELPER_DIAGNOSTICS.has(
    record.diagnosticStream as WindowsAppContainerNativeHelperObservation['diagnosticStream']
  ) || !APPCONTAINER_NATIVE_HELPER_PROTOCOLS.has(
    record.protocol as WindowsAppContainerNativeHelperObservation['protocol']
  ) || !APPCONTAINER_NATIVE_RECEIPTS.has(
    record.nativeReceipt as WindowsAppContainerNativeHelperObservation['nativeReceipt']
  )) {
    return undefined;
  }
  return Object.freeze({
    mode: record.mode as WindowsAppContainerNativeHelperObservation['mode'],
    exitClass: record.exitClass as WindowsAppContainerNativeHelperObservation['exitClass'],
    diagnosticStream:
      record.diagnosticStream as WindowsAppContainerNativeHelperObservation['diagnosticStream'],
    protocol: record.protocol as WindowsAppContainerNativeHelperObservation['protocol'],
    nativeReceipt: record.nativeReceipt as WindowsAppContainerNativeHelperObservation['nativeReceipt']
  });
}

function sameNativePath(left: string, right: string): boolean {
  return nativePathKey(left) === nativePathKey(right);
}

function hostPathVariants(root: string): readonly string[] {
  const resolvedRoot = path.resolve(root);
  const posixRoot = resolvedRoot.replaceAll('\\', '/');
  return Object.freeze([
    resolvedRoot,
    posixRoot,
    JSON.stringify(resolvedRoot).slice(1, -1),
    `file:///${posixRoot}`
  ]);
}

function relocateIsolatedRunnerBundle(
  bundle: Uint8Array,
  buildNodeModulesRoot?: string
): Uint8Array {
  const source = new TextDecoder().decode(bundle);
  if (source.includes(BUNDLED_RUNTIME_PATH_HELPER) || source.includes(BUNDLED_RUNTIME_PATH_IMPORT)) {
    throw new Error('Semantic Mutation isolated runner bundle relocation binding collides');
  }
  const provenBuildNodeModulesRoot = buildNodeModulesRoot ??
    revalidateIsolatedRuntimeBuildNodeModulesProof(
      captureIsolatedRuntimeBuildNodeModulesProof()
    );
  const runtimeNodeModulesRoot = path.posix.relative(
    path.posix.dirname(ISOLATED_RUNNER_CORE_RELATIVE_PATH),
    ISOLATED_COMPILER_DEPS_RELATIVE_ROOT
  );
  if (!runtimeNodeModulesRoot || runtimeNodeModulesRoot.includes('\\') ||
    path.posix.isAbsolute(runtimeNodeModulesRoot)) {
    throw new Error('Semantic Mutation isolated runner dependency relocation is invalid');
  }
  const expectedRuntimeDirectories = Object.freeze([
    Object.freeze({
      sourceSuffix: '/node_modules/typescript/lib',
      runtimeDirectory: path.posix.join(runtimeNodeModulesRoot, 'typescript/lib')
    })
  ]);
  const trustedBuildRoots = Object.freeze([
    resolveIsolatedRuntimeDependencySources().compilerModulesRoot,
    path.resolve(provenBuildNodeModulesRoot)
  ]);
  const observedRuntimeDirectories = new Set<string>();
  const assignmentPattern =
    /var __dirname = ("(?:[^"\\]|\\.)*"), __filename = ("(?:[^"\\]|\\.)*");|var __dirname=("(?:[^"\\]|\\.)*"),__filename=("(?:[^"\\]|\\.)*");/gu;
  const relocated = source.replace(
    assignmentPattern,
    (
      _assignment: string,
      readableDirectory: string | undefined,
      readableFile: string | undefined,
      minifiedDirectory: string | undefined,
      minifiedFile: string | undefined
    ): string => {
      const encodedDirectory = readableDirectory ?? minifiedDirectory;
      const encodedFile = readableFile ?? minifiedFile;
      if (encodedDirectory === undefined || encodedFile === undefined) {
        throw new Error('Semantic Mutation isolated runner bundle has an invalid relocation source');
      }
      const sourceDirectory = JSON.parse(encodedDirectory) as unknown;
      const sourceFile = JSON.parse(encodedFile) as unknown;
      if (typeof sourceDirectory !== 'string' || typeof sourceFile !== 'string' ||
        !path.isAbsolute(sourceDirectory) || !path.isAbsolute(sourceFile) ||
        path.basename(sourceFile) !== 'typescript.js' ||
        !sameNativePath(sourceFile, path.join(sourceDirectory, 'typescript.js'))) {
        throw new Error('Semantic Mutation isolated runner bundle has an invalid relocation source');
      }
      const expected = expectedRuntimeDirectories.find((runtime) =>
        trustedBuildRoots.some((trustedRoot) => sameNativePath(
          sourceDirectory,
          path.join(
            trustedRoot,
            runtime.sourceSuffix.slice(BUNDLED_NODE_MODULES_SOURCE_PREFIX.length)
          )
        )));
      if (!expected || observedRuntimeDirectories.has(expected.runtimeDirectory)) {
        throw new Error('Semantic Mutation isolated runner bundle has an unexpected relocation source');
      }
      observedRuntimeDirectories.add(expected.runtimeDirectory);
      const runtimeDirectory = expected.runtimeDirectory;
      return `var __dirname = ${BUNDLED_RUNTIME_PATH_HELPER}(${JSON.stringify(runtimeDirectory)}), ` +
        `__filename = ${BUNDLED_RUNTIME_PATH_HELPER}(${JSON.stringify(`${runtimeDirectory}/typescript.js`)});`;
    }
  );
  if (observedRuntimeDirectories.size !== expectedRuntimeDirectories.length ||
    expectedRuntimeDirectories.some((entry) => !observedRuntimeDirectories.has(entry.runtimeDirectory)) ||
    assignmentPattern.test(relocated)) {
    throw new Error('Semantic Mutation isolated runner bundle relocation coverage is incomplete');
  }
  const hostPaths = [compilerRoot, provenBuildNodeModulesRoot].flatMap(hostPathVariants);
  if (hostPaths.some((hostPath) => relocated.includes(hostPath))) {
    throw new Error('Semantic Mutation isolated runner bundle contains a host path after relocation');
  }
  const prelude = [
    `import { fileURLToPath as ${BUNDLED_RUNTIME_PATH_IMPORT} } from 'node:url';`,
    `const ${BUNDLED_RUNTIME_PATH_HELPER} = (relativePath) => ` +
      `${BUNDLED_RUNTIME_PATH_IMPORT}(new URL(relativePath, import.meta.url));`,
    ''
  ].join('\n');
  return new TextEncoder().encode(`${prelude}${relocated}`);
}

/** Test-only relocation seam; product callers receive only opaque capability evidence. */
export function relocateIsolatedRunnerBundleForTests(
  bundle: Uint8Array,
  buildNodeModulesRoot?: string
): Uint8Array {
  return relocateIsolatedRunnerBundle(bundle, buildNodeModulesRoot);
}

async function buildIsolatedRunnerBundle(): Promise<Uint8Array> {
  const canonicalBunRuntimeVersion = await loadCanonicalBunRuntimeVersion();
  await withCapabilityPreparationBoundary(
    'runner-build-root-proof',
    () => {
      if (Bun.version !== canonicalBunRuntimeVersion) {
        throw new Error('Semantic Mutation isolated runner runtime version drift');
      }
    }
  );
  const buildRootProof = await withCapabilityPreparationBoundary(
    'runner-build-root-proof',
    captureIsolatedRuntimeBuildNodeModulesProof
  );
  const sourceBundle = await readIsolatedRunnerBuildOutput(
    () => Bun.build({
      entrypoints: ['src/bootstrap/engineering/semantic-mutation/isolated-verification.ts'],
      format: 'esm',
      minify: {
        whitespace: true,
        syntax: true,
        identifiers: false
      },
      sourcemap: 'none',
      splitting: false,
      target: 'bun'
    })
  );
  const buildNodeModulesRoot = await withCapabilityPreparationBoundary(
    'runner-build-root-proof',
    () => revalidateIsolatedRuntimeBuildNodeModulesProof(buildRootProof)
  );
  const bundle = await withCapabilityPreparationBoundary(
    'runner-relocation',
    () => {
      const relocated = relocateIsolatedRunnerBundle(sourceBundle, buildNodeModulesRoot);
      const bundleText = new TextDecoder().decode(relocated);
      const hostPaths = [compilerRoot, buildNodeModulesRoot].flatMap(hostPathVariants);
      if (/(?:__dirname|__filename)\s*=\s*["'][A-Za-z]:[\\/]/u.test(bundleText) ||
        hostPaths.some((hostPath) => bundleText.includes(hostPath))) {
        throw new Error('Semantic Mutation isolated runner bundle contains a host path');
      }
      return relocated;
    }
  );
  return bundle;
}

function createProcessLocalRunnerBundleLoader(
  build: IsolatedRunnerBundleBuilder
): IsolatedRunnerBundleBuilder {
  let cachedAttempt: Promise<Uint8Array> | undefined;
  return async () => {
    const attempt = cachedAttempt ??= Promise.resolve().then(build).then((bundle) => {
      if (!(bundle instanceof Uint8Array) || bundle.byteLength === 0) {
        throw new Error('Semantic Mutation isolated runner bundle is empty');
      }
      return bundle.slice();
    });
    try {
      return (await attempt).slice();
    } catch (error) {
      if (cachedAttempt === attempt) cachedAttempt = undefined;
      throw error;
    }
  };
}

const loadProcessLocalIsolatedRunnerBundle = createProcessLocalRunnerBundleLoader(
  buildIsolatedRunnerBundle
);

/** Test-only factory; production owns a separate module-local default loader. */
export function createIsolatedRunnerBundleLoaderForTests(
  build: IsolatedRunnerBundleBuilder
): IsolatedRunnerBundleBuilder {
  return createProcessLocalRunnerBundleLoader(build);
}

export interface IsolatedRuntimeCapabilityProbeOptions {
  readonly buildRunnerBundle?: IsolatedRunnerBundleBuilder;
  /** Internal test seam. Product callers cannot supply isolated runtime paths. */
  readonly runtimeInputSources?: IsolatedRuntimeInputSources;
}

const CAPABILITY_PREPARATION_SUBSTAGES =
  new Set<IsolatedCapabilityPreparationSubstage>(
    ISOLATED_CAPABILITY_PREPARATION_SUBSTAGES
  );
const isolatedRuntimeCapabilityDiagnostics =
  new WeakMap<object, IsolatedRuntimeCapabilityDiagnostic>();

function projectIsolatedRuntimeCapabilitySubstage(
  value: unknown
): IsolatedRuntimeCapabilityDiagnostic {
  const substage = typeof value === 'string' && CAPABILITY_PREPARATION_SUBSTAGES.has(
    value as IsolatedCapabilityPreparationSubstage
  )
    ? value as IsolatedCapabilityPreparationSubstage
    : 'unknown';
  return Object.freeze({
    stage: 'runtime-capability' as const,
    runtimeCapability: Object.freeze({ substage })
  });
}

function isolatedRuntimeCapabilityDiagnostic(
  error: unknown
): IsolatedRuntimeCapabilityDiagnostic | undefined {
  const legacyAppContainerFailure = projectLegacyWindowsAppContainerExecutionError(error);
  if (legacyAppContainerFailure !== undefined) return legacyAppContainerFailure;
  if (error instanceof IsolatedCapabilityPreparationError) {
    return projectIsolatedRuntimeCapabilitySubstage(error.substage);
  }
  return undefined;
}

/**
 * Proves that the current staged workspace can execute the bundled compiler
 * without consulting host source, host Git, or a network package registry.
 * The public result is intentionally path-free and is consumed only through
 * process-local opaque capability evidence.
 */
export async function probeIsolatedRuntimeCapability(
  stagingWorkspaceRoot: string,
  options: IsolatedRuntimeCapabilityProbeOptions = {}
): Promise<{ readonly status: 'available' | 'unavailable' }> {
  try {
    const optionDescriptors = Object.getOwnPropertyDescriptors(options);
    const buildRunnerBundle = ownDataOption<IsolatedRunnerBundleBuilder>(
      optionDescriptors,
      'buildRunnerBundle',
      'Isolated runtime capability probe options'
    );
    const runtimeInputSources = ownDataOption<IsolatedRuntimeInputSources>(
      optionDescriptors,
      'runtimeInputSources',
      'Isolated runtime capability probe options'
    );
    const canonicalProductionProbe =
      buildRunnerBundle === undefined && runtimeInputSources === undefined;
    const sources = runtimeInputSources ??
      await prepareCanonicalIsolatedRuntimeInputSources();
    if (!isSemanticMutationStagingWorkspace(stagingWorkspaceRoot)) {
      throw new Error('Isolated verification requires a controlled staging workspace');
    }
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    if (!await hasProvenFastSuiteProcessWideWriteSandbox()) {
      throw new Error(
        'Isolated verification requires a proven process-wide fast-suite write sandbox'
      );
    }
    await resetSemanticMutationIsolatedPhaseTelemetry(stagingWorkspaceRoot);
    if (await pathExists(path.join(stagingWorkspaceRoot, modelRelativePath, 'schema', 'db.prisma.template'))) {
      throw new Error('Isolated Prisma execution is unavailable');
    }
    const opaqueModulesRoot = path.join(stagingWorkspaceRoot, srcRelativePath, 'opaque');
    if ((await pathExists(opaqueModulesRoot)) &&
      (await listFilesRecursive(opaqueModulesRoot)).some((file) => path.basename(file) === 'module.yaml')) {
      throw new Error('Isolated opaque module linking is unavailable');
    }
    const bundle = await (buildRunnerBundle ?? loadProcessLocalIsolatedRunnerBundle)();
    const compilerRegistries = await compilerRegistryInputs(stagingWorkspaceRoot, sources);
    const capability = await withCapabilityPreparationBoundary(
      'capability-issue',
      async () => await issueIsolatedRuntimeCapability({
        compilerRegistries,
        runnerBundle: bundle,
        sources,
        stagingWorkspaceRoot
      })
    );
    const runtimeRoot = resolveIsolatedRuntimeBinding(capability);
    if (canonicalProductionProbe && runtimeRoot) {
      canonicalProductionRuntimeBindingRoots.add(runtimeRoot);
    }
    return capability;
  } catch (error) {
    const unavailable = Object.freeze({ status: 'unavailable' as const });
    const diagnostic = isolatedRuntimeCapabilityDiagnostic(error);
    if (diagnostic) isolatedRuntimeCapabilityDiagnostics.set(unavailable, diagnostic);
    return unavailable;
  }
}

export interface IsolatedVerificationArtifacts {
  readonly status: 'passed' | 'failed';
  readonly acceptanceCoverage: AcceptanceCoverageReport;
  readonly policyReport: PolicyReport;
  readonly runtimeReport: RuntimeVerificationLaneReport;
  readonly rawDigests: {
    readonly acceptanceCoverage: string;
    readonly policyReport: string;
    readonly runtimeReport: string;
    readonly verificationReport: string;
  };
  readonly semanticBundle: IsolatedSemanticBundleEvidence;
  readonly stagedVerificationProofSource?: StagedVerificationProofSource;
  readonly verificationReport: CurrentCanonicalVerificationReport;
}
const canonicalProductionRuntimeBindingRoots = new WeakSet<object>();

interface NamedArtifactReadResult {
  readonly artifact: Exclude<IsolatedVerificationArtifact, 'child-outcome' | 'verification-set'>;
  readonly result: JsonArtifactReadResult;
}

function throwIsolatedFailure(failure: IsolatedVerificationFailure): never {
  throw new IsolatedVerificationUnavailableError(failure);
}

function artifactFailureStage(
  status: Exclude<JsonArtifactReadResult['status'], 'ok'>
): IsolatedVerificationFailureStage {
  return status === 'missing'
    ? 'artifact-missing'
    : status === 'parse-error'
      ? 'artifact-parse'
      : 'artifact-read';
}

function terminationDetail(
  terminationClass: IsolatedTerminationClass,
  trace: IsolatedProgressTrace
): NonNullable<IsolatedVerificationFailure['termination']> {
  return Object.freeze({
    class: terminationClass,
    ...(trace.lastCheckpoint === undefined ? {} : { checkpoint: trace.lastCheckpoint }),
    ...(trace.pendingCheckpoint === undefined
      ? {}
      : { pendingCheckpoint: trace.pendingCheckpoint })
  });
}

function exactProgressTrace(
  trace: IsolatedProgressTrace,
  expected: readonly IsolatedProgressCheckpoint[]
): boolean {
  return trace.pendingCheckpoint === undefined &&
    trace.checkpoints.length === expected.length &&
    trace.checkpoints.every((checkpoint, index) => checkpoint === expected[index]);
}

function progressFailureStage(
  trace: IsolatedProgressTrace
): IsolatedChildFailureStage | undefined {
  if (!trace.checkpoints.includes('failure-caught')) return undefined;
  if (trace.checkpoints.includes('postcondition')) return 'postcondition';
  return trace.checkpoints.includes('verify-all') ? 'verify-all' : 'preflight';
}

function childControlStateIsCoherent(input: {
  readonly childOutcome: ChildOutcomeReadResult;
  readonly childOutcomePending: ChildOutcomePendingReadResult;
  readonly terminationClass: IsolatedTerminationClass;
  readonly trace: IsolatedProgressTrace;
}): boolean {
  const { childOutcome, childOutcomePending, terminationClass, trace } = input;
  if ((childOutcome.status === 'valid' && childOutcomePending.status === 'present') ||
    (childOutcome.status === 'valid' &&
      (trace.lastCheckpoint !== 'outcome-publish-started' ||
        progressFailureStage(trace) !== childOutcome.value.stage)) ||
    (childOutcomePending.status === 'present' &&
      trace.lastCheckpoint !== 'outcome-publish-started')) {
    return false;
  }
  if (trace.pendingCheckpoint !== undefined &&
    terminationClass !== 'progress-publication-failure' &&
    terminationClass !== 'unclassified-nonzero') {
    return false;
  }
  switch (terminationClass) {
    case 'zero':
      return childOutcome.status === 'absent' && childOutcomePending.status === 'absent' &&
        exactProgressTrace(trace, [
          ...ISOLATED_RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition'
        ]);
    case 'runner-controlled-failure':
      return childOutcome.status === 'valid' && childOutcomePending.status === 'absent' &&
        trace.pendingCheckpoint === undefined && trace.lastCheckpoint === 'outcome-publish-started';
    case 'bootstrap-environment-boundary-failure':
      return childOutcome.status === 'absent' && childOutcomePending.status === 'absent' &&
        exactProgressTrace(trace, []);
    case 'runner-entry-failure':
    case 'runner-environment-boundary-failure':
    case 'runner-staging-layout-boundary-failure':
    case 'runner-staging-tree-failure':
      return childOutcome.status === 'absent' && childOutcomePending.status === 'absent' &&
        exactProgressTrace(trace, ISOLATED_RUNNER_ENTERED_TRACE);
    case 'runner-catch-tree-failure':
      return childOutcome.status === 'absent' && childOutcomePending.status === 'absent' &&
        trace.pendingCheckpoint === undefined && trace.lastCheckpoint === 'failure-caught';
    case 'outcome-publication-failure':
      return childOutcome.status !== 'parse-error' && childOutcome.status !== 'read-error' &&
        childOutcomePending.status !== 'read-error' &&
        trace.pendingCheckpoint === undefined && trace.lastCheckpoint === 'outcome-publish-started';
    case 'progress-publication-failure':
      return childOutcome.status === 'absent' && childOutcomePending.status === 'absent';
    case 'loader-import-failure':
      return childOutcome.status === 'absent' && childOutcomePending.status === 'absent' &&
        exactProgressTrace(trace, ['bootstrap-entered', 'loader-entered', 'core-import-started']);
    case 'unclassified-nonzero':
      return true;
  }
}

function progressCanHavePublishedReports(
  terminationClass: IsolatedTerminationClass,
  trace: IsolatedProgressTrace
): boolean {
  if (!trace.checkpoints.includes('verify-all') ||
    terminationClass === 'bootstrap-environment-boundary-failure' ||
    terminationClass === 'runner-entry-failure' ||
    terminationClass === 'runner-environment-boundary-failure' ||
    terminationClass === 'runner-staging-layout-boundary-failure' ||
    terminationClass === 'runner-staging-tree-failure') {
    return false;
  }
  return terminationClass !== 'progress-publication-failure' ||
    trace.lastCheckpoint !== 'verify-all' ||
    trace.pendingCheckpoint !== undefined;
}

export async function runIsolatedVerificationChild(
  stagingWorkspaceRoot: string,
  options: IsolatedVerificationChildOptions
): Promise<IsolatedVerificationArtifacts> {
  let failureStage: IsolatedVerificationFailureStage = 'runtime-materialization';
  try {
    const optionDescriptors = Object.getOwnPropertyDescriptors(options);
    const suppliedCommitFence = ownDataOption<CommitFence>(
      optionDescriptors,
      'commitFence',
      'Isolated verification child options'
    );
    const supervisorOverride = ownDataOption<IsolatedVerificationSupervisor>(
      optionDescriptors,
      'supervisor',
      'Isolated verification child options'
    );
    const workspaceRoot = ownDataOption<string>(
      optionDescriptors,
      'workspaceRoot',
      'Isolated verification child options'
    );
    const workspaceWriteLease = ownDataOption<WorkspaceWriteLeaseToken>(
      optionDescriptors,
      'workspaceWriteLease',
      'Isolated verification child options'
    );
    const capabilityPlan = ownDataOption<SemanticMutationVerificationCapabilityPlan>(
      optionDescriptors,
      'capabilityPlan',
      'Isolated verification child options'
    );
    const runtimeCapabilityForTest = ownDataOption<object>(
      optionDescriptors,
      'runtimeCapabilityForTest',
      'Isolated verification child options'
    );
    if (typeof workspaceRoot !== 'string' || workspaceWriteLease === undefined) {
      throw new Error('Isolated verification child options are incomplete');
    }
    const productionInvocation = capabilityPlan !== undefined && suppliedCommitFence === undefined &&
      supervisorOverride === undefined && runtimeCapabilityForTest === undefined;
    const commitFence = productionInvocation
      ? createWorkspaceWriteCommitFence(workspaceRoot, workspaceWriteLease)
      : suppliedCommitFence;
    if (typeof commitFence !== 'function') {
      throw new Error('Isolated verification child commit fence is unavailable');
    }
    const supervisor = supervisorOverride ?? createIsolatedVerificationSupervisor();
    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    await resetSemanticMutationIsolatedExecutionPhaseTelemetry(stagingWorkspaceRoot);
    const childOutcomePath = isolatedChildOutcomePath(stagingWorkspaceRoot);
    const childOutcomePendingPath = isolatedChildOutcomePendingPath(stagingWorkspaceRoot);
    const staleArtifactCleanup = retainNoFollowFileTransaction(
      stagingWorkspaceRoot,
      'Isolated verification stale artifact cleanup'
    );
    try {
      for (const reportPath of [
        resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.verificationReport),
        resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
        resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.policyReport),
        resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
        childOutcomePath,
        childOutcomePendingPath
      ]) {
        await removeIsolatedOwnedFileIfPresent(
          staleArtifactCleanup,
          stagingWorkspaceRoot,
          reportPath,
          commitFence
        );
      }
    } finally {
      staleArtifactCleanup.dispose();
    }
    const runtimeBinding = capabilityPlan ?? runtimeCapabilityForTest;
    const runtimeBindingRoot = resolveIsolatedRuntimeBinding(runtimeBinding);
    const canIssueProofSource = productionInvocation && runtimeBindingRoot !== undefined &&
      isCanonicalWorkspaceWriteCommitFence(commitFence, workspaceRoot, workspaceWriteLease) &&
      canonicalProductionRuntimeBindingRoots.has(runtimeBindingRoot);
    const { runnerRelativePath } =
      await withSemanticMutationIsolatedPhaseTelemetry(
      stagingWorkspaceRoot,
      'runtime-materialize',
      async () => await materializeIsolatedRuntime({
        binding: runtimeBinding,
        commitFence,
        stagingWorkspaceRoot
      })
    );
    await commitFence();
    const writableRoot = path.join(stagingWorkspaceRoot, '.isolated-process', 'child');
    await ensureIsolatedProcessDirectories(writableRoot, commitFence);
    const env = buildIsolatedVerificationEnvironment(stagingWorkspaceRoot);
    failureStage = 'binding-mismatch';
    await assertIsolatedRuntimeLaunchManifest({
      binding: runtimeBinding,
      commitFence,
      stagingWorkspaceRoot
    });
    failureStage = 'isolated-child-execution';
    const result = await supervisor({
      commitFence,
      env,
      runnerRelativePath,
      stagingWorkspaceRoot,
      workspaceRoot,
      workspaceWriteLease
    });

    failureStage = 'artifact-read';
    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    if (!Number.isSafeInteger(result.code) || result.code < 0) {
      throwIsolatedFailure({
        stage: 'artifact-protocol',
        artifact: 'verification-set'
      });
    }
    const terminationClass = classifyIsolatedTermination(result.code);
    const progress = result.progress;
    if (progress.status !== 'valid') {
      throwIsolatedFailure({
        stage: progress.status === 'parse-error'
          ? 'artifact-parse'
          : progress.status === 'read-error'
            ? 'artifact-read'
            : 'artifact-protocol',
        artifact: 'child-progress',
        termination: { class: terminationClass }
      });
    }
    const termination = terminationDetail(terminationClass, progress.trace);
    const childOutcome = await readChildOutcomeResult(stagingWorkspaceRoot, commitFence);
    if (childOutcome.status === 'parse-error') {
      throwIsolatedFailure({
        stage: 'artifact-parse',
        artifact: 'child-outcome',
        termination
      });
    }
    if (childOutcome.status === 'read-error') {
      throwIsolatedFailure({
        stage: 'artifact-read',
        artifact: 'child-outcome',
        termination
      });
    }
    const childOutcomePending = await readChildOutcomePendingResult(
      stagingWorkspaceRoot,
      commitFence
    );
    if (childOutcomePending.status === 'read-error') {
      throwIsolatedFailure({
        stage: 'artifact-read',
        artifact: 'child-outcome',
        termination
      });
    }
    const verification = await readJsonArtifactResult(
      resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.verificationReport),
      commitFence
    );
    const runtime = await readJsonArtifactResult(
      resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
      commitFence
    );
    const policy = await readJsonArtifactResult(
      resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.policyReport),
      commitFence
    );
    const coverage = await readJsonArtifactResult(
      resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
      commitFence
    );
    const artifactReads: readonly NamedArtifactReadResult[] = [
      { artifact: 'verification-report', result: verification },
      { artifact: 'runtime-report', result: runtime },
      { artifact: 'policy-report', result: policy },
      { artifact: 'acceptance-coverage', result: coverage }
    ];
    const firstFailure = artifactReads.find((entry) => entry.result.status !== 'ok');
    if (!childControlStateIsCoherent({
      childOutcome,
      childOutcomePending,
      terminationClass,
      trace: progress.trace
    })) {
      throwIsolatedFailure({
        stage: 'artifact-protocol',
        ...(childOutcome.status === 'valid' ? { child: projectChildOutcome(childOutcome.value) } : {}),
        artifact: childOutcomePending.status === 'present' ? 'child-outcome' : 'verification-set',
        termination
      });
    }
    if (!progressCanHavePublishedReports(terminationClass, progress.trace) &&
      artifactReads.some((entry) => entry.result.status === 'ok')) {
      throwIsolatedFailure({
        stage: 'artifact-protocol',
        ...(childOutcome.status === 'valid' ? { child: projectChildOutcome(childOutcome.value) } : {}),
        artifact: 'verification-set',
        termination
      });
    }
    if (firstFailure !== undefined && firstFailure.result.status !== 'ok') {
      if (childOutcome.status === 'valid' &&
        (childOutcome.value.stage === 'preflight' || childOutcome.value.stage === 'verify-all')) {
        throwIsolatedFailure({
          stage: 'child-failed-before-artifacts',
          child: projectChildOutcome(childOutcome.value),
          artifact: firstFailure.artifact,
          termination
        });
      }
      if (childOutcome.status === 'absent' && terminationClass !== 'zero') {
        throwIsolatedFailure({
          stage: 'child-terminated-without-outcome',
          artifact: firstFailure.artifact,
          termination
        });
      }
      throwIsolatedFailure({
        stage: artifactFailureStage(firstFailure.result.status),
        ...(childOutcome.status === 'valid' ? { child: projectChildOutcome(childOutcome.value) } : {}),
        artifact: firstFailure.artifact,
        termination
      });
    }
    if (verification.status !== 'ok' || runtime.status !== 'ok' ||
      policy.status !== 'ok' || coverage.status !== 'ok') {
      throw new Error('Isolated Verification artifact read classification is inconsistent');
    }
    if (!progressCanHavePublishedReports(terminationClass, progress.trace)) {
      throwIsolatedFailure({
        stage: 'artifact-protocol',
        ...(childOutcome.status === 'valid' ? { child: projectChildOutcome(childOutcome.value) } : {}),
        artifact: 'verification-set',
        termination
      });
    }
    if (childOutcome.status === 'valid' && childOutcome.value.stage === 'preflight') {
      throwIsolatedFailure({
        stage: 'artifact-protocol',
        child: projectChildOutcome(childOutcome.value),
        artifact: 'verification-set',
        termination
      });
    }
    failureStage = 'semantic-rebuild';
    await commitFence();
    const semanticBundle = projectIsolatedSemanticBundle(
      await buildWorkspaceSemanticBundle(stagingWorkspaceRoot)
    );
    await commitFence();
    // Production performs its final whole-tree proof immediately before issuing
    // proof-source authority below. Non-production callers still need a terminal
    // proof here because they cannot enter that authority boundary.
    if (!canIssueProofSource) await assertIsolatedStagingTree(stagingWorkspaceRoot);
    await commitFence();
    failureStage = 'artifact-protocol';
    const status = classifyIsolatedVerificationArtifactSet({
      childExitCode: result.code,
      verificationReport: verification.value,
      runtimeReport: runtime.value,
      policyReport: policy.value,
      acceptanceCoverage: coverage.value,
      semanticBundle
    });
    if (status === 'blocked' || (status === 'passed' && childOutcome.status === 'valid')) {
      throwIsolatedFailure({
        stage: 'artifact-protocol',
        ...(childOutcome.status === 'valid' ? { child: projectChildOutcome(childOutcome.value) } : {}),
        artifact: 'verification-set',
        termination
      });
    }
    const artifacts = cloneAndDeepFreeze<IsolatedVerificationArtifacts>({
      status,
      verificationReport: verification.value as CurrentCanonicalVerificationReport,
      runtimeReport: runtime.value as RuntimeVerificationLaneReport,
      policyReport: policy.value as PolicyReport,
      acceptanceCoverage: coverage.value as AcceptanceCoverageReport,
      semanticBundle,
      rawDigests: {
        verificationReport: rawSha256(verification.bytes),
        runtimeReport: rawSha256(runtime.bytes),
        policyReport: rawSha256(policy.bytes),
        acceptanceCoverage: rawSha256(coverage.bytes)
      }
    });
    if (canIssueProofSource && artifacts.status === 'passed') {
      await commitFence();
      await assertIsolatedStagingTree(stagingWorkspaceRoot);
      await commitFence();
      const evidenceDigest = isolatedVerificationEvidenceDigest({
        status: 'passed',
        artifacts
      });
      const stagedVerificationProofSource = await issueStagedVerificationProofSource({
        stagingProjectRoot: stagingWorkspaceRoot,
        inputRevision: artifacts.semanticBundle.snapshot.ir.inputRevision,
        semanticRevision: artifacts.semanticBundle.snapshot.ir.semanticRevision,
        evidenceDigest,
        rawArtifactDigests: artifacts.rawDigests,
        artifacts
      });
      await commitFence();
      return Object.freeze({ ...artifacts, stagedVerificationProofSource });
    }
    return artifacts;
  } catch (error) {
    throw new IsolatedVerificationUnavailableError(
      isolatedVerificationFailure(failureStage, error)
    );
  }
}
