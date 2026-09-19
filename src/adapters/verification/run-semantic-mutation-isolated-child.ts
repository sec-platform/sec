import { lstat, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { runObservedCommand, type ObservedCommandOutcome } from '../runtime-state/physical/runtime/observed-process.ts';
import { buildIsolatedProcessEnvironment, ensureIsolatedProcessDirectories, ISOLATED_VERIFICATION_ENV_KEY, runCommand, type CommandResult } from '../runtime-state/physical/runtime/process.ts';
import type { AcceptanceCoverageReport } from '../../assurance/acceptance/coverage.ts';
import { isSemanticMutationStagingWorkspace } from '../../workspace/contract/semantic-mutation-staging.ts';
import { cloneAndDeepFreeze, rawSha256 } from '../../contracts/canonical.ts';
import { ensureSharedDepsReady } from '../toolchain/dependencies/runtime.ts';
import {
  compilerRuntimeLayout,
  compilerRuntimeResources, loadCanonicalBunRuntimeVersion
} from '../toolchain/runtime.ts';
import type { CurrentCanonicalVerificationReport } from '../../assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { RuntimeVerificationLaneReport, SemanticMutationVerificationCapabilityPlan } from '../../assurance/verification/contract/types.ts';
import { modelRelativePath } from '../../workspace/contract/types.ts';
import { pathExists } from "../filesystem/files.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { createWorkspaceWriteCommitFence, isCanonicalWorkspaceWriteCommitFence, type WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
import { listFilesRecursive } from '../filesystem/discovery.ts';
import { compilerRoot, officialRegistryRelativePath, resolveWorkspaceArtifactPath, resolveWorkspaceLockPath, resolveWorkspacePlanPath, srcRelativePath } from "../workspace-context.ts";
import { posixPath } from '../../contracts/relative-path.ts';
import { getErrorCode } from '../../compiler/errors.ts';
import { readLockFile } from "../workspace/lock.ts";
import { loadWorkspacePlan } from '../workspace/sources/load-plan.ts';
import {
  PIPELINE_EXECUTION_BOUNDARIES,
  type PipelineExecutionBoundary
} from '../compilation-protocol/types.ts';
import type { PolicyReport } from '../../semantics/policies/types.ts';
import {
  buildWorkspaceSemanticBundle,
} from '../workspace/semantic-bundle.ts';
import {
  parseSemanticMutationIsolatedChildOutcomeBytes,
  semanticMutationIsolatedChildOutcomePath,
  semanticMutationIsolatedChildOutcomePendingPath,
  type SemanticMutationIsolatedChildFailureStage,
  type SemanticMutationIsolatedChildOutcome
} from './isolation/isolated-verification-child-outcome.ts';
import {
  classifySemanticMutationIsolatedTermination,
  readSemanticMutationIsolatedProgressTrace,
  SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS,
  SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH,
  semanticMutationIsolatedProgressOwnedPaths,
  type SemanticMutationIsolatedProgressCheckpoint,
  type SemanticMutationIsolatedProgressTrace,
  type SemanticMutationIsolatedTerminationClass
} from './isolation/isolated-verification-child-progress.ts';
import {
  classifySemanticMutationIsolatedVerificationArtifactSet
} from './isolation/isolated-verification-classifier.ts';
import {
  resetSemanticMutationIsolatedExecutionPhaseTelemetry,
  resetSemanticMutationIsolatedPhaseTelemetry,
  withSemanticMutationIsolatedPhaseTelemetry
} from './isolation/isolated-verification-phase-telemetry.ts';
import { assertIsolatedStagingTree } from './assert-isolated-staging-tree.ts';
import {
  captureIsolatedRuntimeBuildNodeModulesProof,
  resolveIsolatedRuntimeDependencySources,
  revalidateIsolatedRuntimeBuildNodeModulesProof
} from './run-runtime-verification.ts';
import {
  resolveSemanticMutationIsolatedRuntimePlanBinding
} from './semantic-mutation-isolated-runtime-binding.ts';
import {
  assertSemanticMutationIsolatedRuntimeLaunchManifest,
  issueSemanticMutationIsolatedRuntimeCapability,
  materializeSemanticMutationIsolatedRuntime,
  SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_COMPILER_DEPS_RELATIVE_ROOT,
  SEMANTIC_MUTATION_ISOLATED_COMPILER_RESOURCE_DESTINATIONS,
  type SemanticMutationIsolatedCompilerRegistryInput,
  type SemanticMutationIsolatedRuntimeInputSources,
  type SemanticMutationIsolatedRuntimeSourcePaths
} from './semantic-mutation-isolated-runtime-plan.ts';
import { semanticMutationIsolatedVerificationEvidenceDigest } from '../../assurance/verification/semantic-mutation/isolated-evidence.ts';
import {
  SemanticMutationIsolatedVerificationUnavailableError,
  type SemanticMutationIsolatedVerificationArtifact,
  type SemanticMutationIsolatedVerificationFailure,
  type SemanticMutationIsolatedVerificationFailureStage
} from './semantic-mutation-isolated-verification-failure.ts';
import {
  issueStagedVerificationProofSource,
  type StagedVerificationProofSource
} from './staged-verification-proof.ts';

export type { SemanticMutationIsolatedRuntimeInputSources } from './semantic-mutation-isolated-runtime-plan.ts';
export {
  SemanticMutationIsolatedVerificationUnavailableError,
  type SemanticMutationIsolatedVerificationArtifact,
  type SemanticMutationIsolatedVerificationFailure,
  type SemanticMutationIsolatedVerificationFailureStage
} from './semantic-mutation-isolated-verification-failure.ts';

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

const ISOLATED_FAILURE_STAGES = new Set<SemanticMutationIsolatedVerificationFailureStage>([
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
const ISOLATED_CHILD_FAILURE_STAGES = new Set<SemanticMutationIsolatedChildFailureStage>([
  'preflight', 'verify-all', 'postcondition'
]);
const PIPELINE_BOUNDARIES = new Set<PipelineExecutionBoundary>(PIPELINE_EXECUTION_BOUNDARIES);
const ISOLATED_VERIFICATION_ARTIFACTS = new Set<SemanticMutationIsolatedVerificationArtifact>([
  'child-outcome', 'child-progress', 'verification-report', 'runtime-report', 'policy-report',
  'acceptance-coverage', 'verification-set'
]);
const ISOLATED_TERMINATION_CLASSES = new Set<SemanticMutationIsolatedTerminationClass>([
  'zero', 'runner-controlled-failure', 'runner-entry-failure',
  'bootstrap-environment-boundary-failure',
  'runner-environment-boundary-failure', 'runner-staging-layout-boundary-failure',
  'runner-staging-tree-failure',
  'runner-catch-tree-failure',
  'outcome-publication-failure', 'progress-publication-failure', 'loader-import-failure',
  'unclassified-nonzero'
]);
const ISOLATED_PROGRESS_CHECKPOINTS = new Set<SemanticMutationIsolatedProgressCheckpoint>(
  SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS
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
] as const satisfies readonly SemanticMutationIsolatedProgressCheckpoint[]);
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
  outcome: SemanticMutationIsolatedChildOutcome
): NonNullable<SemanticMutationIsolatedVerificationFailure['child']> {
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
): NonNullable<SemanticMutationIsolatedVerificationFailure['lifecycle']> | undefined {
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
): NonNullable<SemanticMutationIsolatedVerificationFailure['lifecycle']> {
  const lifecycle = projectObservedLifecycle(outcome);
  if (lifecycle === undefined) {
    throw new Error('Semantic Mutation isolated child lifecycle evidence is invalid');
  }
  return lifecycle;
}

function redactIsolatedVerificationFailure(
  value: unknown,
  fallbackStage: SemanticMutationIsolatedVerificationFailureStage
): SemanticMutationIsolatedVerificationFailure {
  const record = recordValue(value);
  const stage = typeof record?.stage === 'string' &&
    ISOLATED_FAILURE_STAGES.has(record.stage as SemanticMutationIsolatedVerificationFailureStage)
    ? record.stage as SemanticMutationIsolatedVerificationFailureStage
    : fallbackStage;
  const childRecord = recordValue(record?.child);
  const childStage = typeof childRecord?.stage === 'string' &&
    ISOLATED_CHILD_FAILURE_STAGES.has(childRecord.stage as SemanticMutationIsolatedChildFailureStage)
    ? childRecord.stage as SemanticMutationIsolatedChildFailureStage
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
    ISOLATED_VERIFICATION_ARTIFACTS.has(record.artifact as SemanticMutationIsolatedVerificationArtifact)
    ? record.artifact as SemanticMutationIsolatedVerificationArtifact
    : undefined;
  const terminationRecord = recordValue(record?.termination);
  const terminationClass = typeof terminationRecord?.class === 'string' &&
    ISOLATED_TERMINATION_CLASSES.has(
      terminationRecord.class as SemanticMutationIsolatedTerminationClass
    )
    ? terminationRecord.class as SemanticMutationIsolatedTerminationClass
    : undefined;
  const checkpoint = typeof terminationRecord?.checkpoint === 'string' &&
    ISOLATED_PROGRESS_CHECKPOINTS.has(
      terminationRecord.checkpoint as SemanticMutationIsolatedProgressCheckpoint
    )
    ? terminationRecord.checkpoint as SemanticMutationIsolatedProgressCheckpoint
    : undefined;
  const pendingCheckpoint = typeof terminationRecord?.pendingCheckpoint === 'string' &&
    ISOLATED_PROGRESS_CHECKPOINTS.has(
      terminationRecord.pendingCheckpoint as SemanticMutationIsolatedProgressCheckpoint
    )
    ? terminationRecord.pendingCheckpoint as SemanticMutationIsolatedProgressCheckpoint
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

class SemanticMutationIsolatedChildLifecycleError extends Error {
  public readonly lifecycle: NonNullable<SemanticMutationIsolatedVerificationFailure['lifecycle']>;

  constructor(outcome: ObservedCommandOutcome) {
    super('Semantic Mutation isolated child lifecycle did not settle');
    this.name = 'SemanticMutationIsolatedChildLifecycleError';
    this.lifecycle = boundedObservedLifecycle(outcome);
  }
}

function projectLegacyWindowsAppContainerExecutionError(
  error: unknown
): SemanticMutationIsolatedVerificationFailure | undefined {
  if (!(error instanceof Error) || error.name !== 'WindowsAppContainerExecutionError') {
    return undefined;
  }
  const record = recordValue(error);
  if (record === undefined) return undefined;
  const projected = redactIsolatedVerificationFailure({
    stage: 'appcontainer-execution',
    appContainer: record as unknown as NonNullable<
      SemanticMutationIsolatedVerificationFailure['appContainer']
    >
  }, 'appcontainer-execution');
  return projected.appContainer === undefined ? undefined : projected;
}

function isolatedVerificationFailure(
  stage: SemanticMutationIsolatedVerificationFailureStage,
  error: unknown
): SemanticMutationIsolatedVerificationFailure {
  if (error instanceof SemanticMutationIsolatedVerificationUnavailableError) {
    return redactIsolatedVerificationFailure(error.failure, stage);
  }
  if (error instanceof SemanticMutationIsolatedChildLifecycleError) {
    return redactIsolatedVerificationFailure({
      stage: 'isolated-child-execution',
      lifecycle: error.lifecycle
    }, stage);
  }
  const legacyAppContainerFailure = projectLegacyWindowsAppContainerExecutionError(error);
  if (legacyAppContainerFailure !== undefined) return legacyAppContainerFailure;
  return Object.freeze({ stage });
}

export function resolveCanonicalSemanticMutationIsolatedRuntimeInputSources(
): SemanticMutationIsolatedRuntimeSourcePaths {
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

export async function prepareCanonicalSemanticMutationIsolatedRuntimeInputSources(
): Promise<SemanticMutationIsolatedRuntimeInputSources> {
  await ensureSharedDepsReady();
  return Object.freeze(resolveCanonicalSemanticMutationIsolatedRuntimeInputSources());
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
  sources: SemanticMutationIsolatedRuntimeInputSources
): Promise<SemanticMutationIsolatedCompilerRegistryInput[]> {
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
      SEMANTIC_MUTATION_ISOLATED_COMPILER_RESOURCE_DESTINATIONS.officialRegistry,
    sourceRoot: sources.officialRegistry
  }];
}

export interface SemanticMutationIsolatedVerificationExecutionRequest {
  readonly commitFence: CommitFence;
  readonly env: NodeJS.ProcessEnv;
  readonly runnerRelativePath: string;
  readonly stagingWorkspaceRoot: string;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

export type SemanticMutationIsolatedVerificationSupervisor = (
  request: SemanticMutationIsolatedVerificationExecutionRequest
) => Promise<CommandResult>;

export type SemanticMutationIsolatedRunnerBundleBuilder = () => Promise<Uint8Array>;

interface SemanticMutationIsolatedRunnerBuildOutput {
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}

interface SemanticMutationIsolatedRunnerBuildResult {
  readonly success: boolean;
  readonly outputs: readonly SemanticMutationIsolatedRunnerBuildOutput[];
}

type SemanticMutationIsolatedRunnerBuilder =
  () => Promise<SemanticMutationIsolatedRunnerBuildResult>;

export const SEMANTIC_MUTATION_ISOLATED_CAPABILITY_PREPARATION_SUBSTAGES = Object.freeze([
  'runner-build-root-proof',
  'runner-build-invocation',
  'runner-build-unsuccessful',
  'runner-build-output-count',
  'runner-build-output-read',
  'runner-relocation',
  'capability-issue',
  'unknown'
] as const);

export type SemanticMutationIsolatedCapabilityPreparationSubstage =
  (typeof SEMANTIC_MUTATION_ISOLATED_CAPABILITY_PREPARATION_SUBSTAGES)[number];

export type SemanticMutationIsolatedRuntimeCapabilityDiagnostic =
  | SemanticMutationIsolatedVerificationFailure
  | Readonly<{
      readonly stage: 'runtime-capability';
      readonly runtimeCapability: Readonly<{
        readonly substage: SemanticMutationIsolatedCapabilityPreparationSubstage;
      }>;
    }>;

class SemanticMutationIsolatedCapabilityPreparationError extends Error {
  constructor(
    public readonly substage: Exclude<
      SemanticMutationIsolatedCapabilityPreparationSubstage,
      'unknown'
    >
  ) {
    super('Semantic Mutation isolated capability preparation failed');
    this.name = 'SemanticMutationIsolatedCapabilityPreparationError';
  }
}

async function withCapabilityPreparationBoundary<T>(
  substage: Exclude<SemanticMutationIsolatedCapabilityPreparationSubstage, 'unknown'>,
  execute: () => T | Promise<T>
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof SemanticMutationIsolatedCapabilityPreparationError) throw error;
    throw new SemanticMutationIsolatedCapabilityPreparationError(substage);
  }
}

async function readSemanticMutationIsolatedRunnerBuildOutput(
  build: SemanticMutationIsolatedRunnerBuilder
): Promise<Uint8Array> {
  let result: SemanticMutationIsolatedRunnerBuildResult;
  try {
    result = await build();
  } catch {
    throw new SemanticMutationIsolatedCapabilityPreparationError('runner-build-invocation');
  }
  if (!result.success) {
    throw new SemanticMutationIsolatedCapabilityPreparationError('runner-build-unsuccessful');
  }
  if (result.outputs.length !== 1) {
    throw new SemanticMutationIsolatedCapabilityPreparationError('runner-build-output-count');
  }
  try {
    return new Uint8Array(await result.outputs[0].arrayBuffer());
  } catch {
    throw new SemanticMutationIsolatedCapabilityPreparationError('runner-build-output-read');
  }
}

interface SemanticMutationIsolatedVerificationChildCommonOptions {
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

export type SemanticMutationIsolatedVerificationChildOptions =
  SemanticMutationIsolatedVerificationChildCommonOptions & (
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
        readonly supervisor?: SemanticMutationIsolatedVerificationSupervisor;
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

export function buildSemanticMutationIsolatedVerificationEnvironment(
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

const SEMANTIC_MUTATION_ISOLATED_OUTPUT_LIMIT_BYTES = 64 * 1024;
export const SEMANTIC_MUTATION_ISOLATED_VERIFICATION_TIMEOUT_MS = 1_200_000;

export function createSemanticMutationIsolatedVerificationSupervisor(options: {
  /** Internal test seam for deterministic command outcomes. */
  readonly commandRunner?: typeof runCommand;
  /** Internal test seam for bounded production lifecycle outcomes. */
  readonly observedCommandRunner?: typeof runObservedCommand;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
} = {}): SemanticMutationIsolatedVerificationSupervisor {
  const timeoutMs = options.timeoutMs ?? SEMANTIC_MUTATION_ISOLATED_VERIFICATION_TIMEOUT_MS;
  const runnerArguments = (request: SemanticMutationIsolatedVerificationExecutionRequest) => [
    '--no-env-file',
    `--config=${path.join(
      request.stagingWorkspaceRoot,
      ...SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH.split('/')
    )}`,
    '--no-install',
    path.join(request.stagingWorkspaceRoot, ...request.runnerRelativePath.split('/'))
  ];
  if (options.commandRunner === undefined) {
    const observedCommandRunner = options.observedCommandRunner ?? runObservedCommand;
    return async (request) => {
      let observedOutputBytes = 0;
      let outcome: ObservedCommandOutcome;
      outcome = await observedCommandRunner(process.execPath, runnerArguments(request), {
        beforeSpawn: request.commitFence,
        cwd: semanticMutationIsolatedHostSpawnCwd(request.stagingWorkspaceRoot),
        env: request.env,
        envMode: 'replace',
        fenceIntervalMs: options.pollIntervalMs ?? 50,
        maxObservedOutputBytes: SEMANTIC_MUTATION_ISOLATED_OUTPUT_LIMIT_BYTES,
        onChunk: (_stream, byteLength) => {
          if (byteLength > SEMANTIC_MUTATION_ISOLATED_OUTPUT_LIMIT_BYTES - observedOutputBytes) {
            throw new Error('Semantic Mutation isolated child exceeded its output budget');
          }
          observedOutputBytes += byteLength;
        },
        onOutput: () => undefined,
        timeoutMs,
        whileRunning: request.commitFence
      });
      await request.commitFence();
      if (outcome.status !== 'exited' || outcome.exitCode === null ||
        !outcome.termination.childCloseObserved || !outcome.termination.streamsDrained ||
        !outcome.termination.treeClosed || outcome.stdout.observerTruncated ||
        outcome.stderr.observerTruncated ||
        (outcome.exitCode === 0 && (outcome.stdout.bytes !== 0 || outcome.stderr.bytes !== 0))) {
        throw new SemanticMutationIsolatedChildLifecycleError(outcome);
      }
      return { code: outcome.exitCode, stdout: '', stderr: '' };
    };
  }
  const commandRunner = options.commandRunner;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  return async (request) => {
    const controller = new AbortController();
    let checkingLease = false;
    let leaseFailure: unknown;
    const checkLease = (): void => {
      if (checkingLease || leaseFailure !== undefined) return;
      checkingLease = true;
      void request.commitFence()
        .catch((error: unknown) => {
          leaseFailure = error;
          controller.abort();
        })
        .finally(() => {
          checkingLease = false;
        });
    };
    const monitor = setInterval(checkLease, pollIntervalMs);
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
      if (leaseFailure !== undefined) throw leaseFailure;
      return result;
    } catch (error) {
      if (leaseFailure !== undefined) throw leaseFailure;
      throw error;
    } finally {
      clearInterval(monitor);
    }
  };
}

type JsonArtifactReadResult =
  | { readonly status: 'ok'; readonly bytes: Uint8Array; readonly value: unknown }
  | { readonly status: 'missing' | 'parse-error' | 'read-error' };

type ChildOutcomeReadResult =
  | { readonly status: 'absent' }
  | { readonly status: 'valid'; readonly value: SemanticMutationIsolatedChildOutcome }
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
    bytes = new Uint8Array(await readFile(filePath));
  } catch (error) {
    return { status: getErrorCode(error) === 'ENOENT' ? 'missing' : 'read-error' };
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
  const outcomePath = semanticMutationIsolatedChildOutcomePath(stagingWorkspaceRoot);
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(outcomePath);
  } catch (error) {
    return { status: getErrorCode(error) === 'ENOENT' ? 'absent' : 'read-error' };
  }
  if (!before.isFile() || before.isSymbolicLink() || Number(before.nlink) !== 1) {
    return { status: 'read-error' };
  }
  if (before.size > MAX_CHILD_OUTCOME_READ_BYTES) return { status: 'parse-error' };
  let handle;
  try {
    handle = await open(outcomePath, 'r');
  } catch (error) {
    return { status: getErrorCode(error) === 'ENOENT' ? 'absent' : 'read-error' };
  }
  let bytes: Uint8Array | undefined;
  let readFailure: 'parse-error' | 'read-error' | undefined;
  try {
    const after = await handle.stat();
    if (!after.isFile() || Number(after.nlink) !== 1 ||
      String(after.dev) !== String(before.dev) || String(after.ino) !== String(before.ino)) {
      readFailure = 'read-error';
    } else if (after.size > MAX_CHILD_OUTCOME_READ_BYTES) {
      readFailure = 'parse-error';
    } else {
      const buffer = Buffer.alloc(MAX_CHILD_OUTCOME_READ_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
      if (bytesRead > MAX_CHILD_OUTCOME_READ_BYTES) readFailure = 'parse-error';
      else bytes = new Uint8Array(buffer.subarray(0, bytesRead));
    }
  } catch {
    readFailure = 'read-error';
  }
  try {
    await handle.close();
  } catch {
    return { status: 'read-error' };
  }
  if (readFailure !== undefined) return { status: readFailure };
  if (bytes === undefined) return { status: 'read-error' };
  try {
    return {
      status: 'valid',
      value: parseSemanticMutationIsolatedChildOutcomeBytes(bytes)
    };
  } catch {
    return { status: 'parse-error' };
  }
}

async function readChildOutcomePendingResult(
  stagingWorkspaceRoot: string,
  commitFence: CommitFence
): Promise<ChildOutcomePendingReadResult> {
  await commitFence();
  try {
    const metadata = await lstat(
      semanticMutationIsolatedChildOutcomePendingPath(stagingWorkspaceRoot)
    );
    return metadata.isFile() && !metadata.isSymbolicLink() && Number(metadata.nlink) === 1
      ? { status: 'present' }
      : { status: 'read-error' };
  } catch (error) {
    return { status: getErrorCode(error) === 'ENOENT' ? 'absent' : 'read-error' };
  }
}

const BUNDLED_RUNTIME_PATH_HELPER = '__secSemanticMutationRuntimePathV1';
const BUNDLED_RUNTIME_PATH_IMPORT = '__secSemanticMutationFileUrlToPathV1';
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
    path.posix.dirname(SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH),
    SEMANTIC_MUTATION_ISOLATED_COMPILER_DEPS_RELATIVE_ROOT
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
export function relocateSemanticMutationIsolatedRunnerBundleForTests(
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
  const sourceBundle = await readSemanticMutationIsolatedRunnerBuildOutput(
    () => Bun.build({
      entrypoints: ['src/bootstrap/engineering/semantic-mutation-isolated-verification-bootstrap.ts'],
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
  build: SemanticMutationIsolatedRunnerBundleBuilder
): SemanticMutationIsolatedRunnerBundleBuilder {
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
export function createSemanticMutationIsolatedRunnerBundleLoaderForTests(
  build: SemanticMutationIsolatedRunnerBundleBuilder
): SemanticMutationIsolatedRunnerBundleBuilder {
  return createProcessLocalRunnerBundleLoader(build);
}

export interface SemanticMutationIsolatedRuntimeCapabilityProbeOptions {
  readonly buildRunnerBundle?: SemanticMutationIsolatedRunnerBundleBuilder;
  /** Internal test seam. Product callers cannot supply isolated runtime paths. */
  readonly runtimeInputSources?: SemanticMutationIsolatedRuntimeInputSources;
}

const CAPABILITY_PREPARATION_SUBSTAGES =
  new Set<SemanticMutationIsolatedCapabilityPreparationSubstage>(
    SEMANTIC_MUTATION_ISOLATED_CAPABILITY_PREPARATION_SUBSTAGES
  );
const isolatedRuntimeCapabilityDiagnostics =
  new WeakMap<object, SemanticMutationIsolatedRuntimeCapabilityDiagnostic>();

function projectSemanticMutationIsolatedRuntimeCapabilitySubstage(
  value: unknown
): SemanticMutationIsolatedRuntimeCapabilityDiagnostic {
  const substage = typeof value === 'string' && CAPABILITY_PREPARATION_SUBSTAGES.has(
    value as SemanticMutationIsolatedCapabilityPreparationSubstage
  )
    ? value as SemanticMutationIsolatedCapabilityPreparationSubstage
    : 'unknown';
  return Object.freeze({
    stage: 'runtime-capability' as const,
    runtimeCapability: Object.freeze({ substage })
  });
}

function isolatedRuntimeCapabilityDiagnostic(
  error: unknown
): SemanticMutationIsolatedRuntimeCapabilityDiagnostic | undefined {
  const legacyAppContainerFailure = projectLegacyWindowsAppContainerExecutionError(error);
  if (legacyAppContainerFailure !== undefined) return legacyAppContainerFailure;
  if (error instanceof SemanticMutationIsolatedCapabilityPreparationError) {
    return projectSemanticMutationIsolatedRuntimeCapabilitySubstage(error.substage);
  }
  return undefined;
}

/**
 * Proves that the current staged workspace can execute the bundled compiler
 * without consulting host source, host Git, or a network package registry.
 * The public result is intentionally path-free and is consumed only through
 * process-local opaque capability evidence.
 */
export async function probeSemanticMutationIsolatedRuntimeCapability(
  stagingWorkspaceRoot: string,
  options: SemanticMutationIsolatedRuntimeCapabilityProbeOptions = {}
): Promise<{ readonly status: 'available' | 'unavailable' }> {
  try {
    const optionDescriptors = Object.getOwnPropertyDescriptors(options);
    const buildRunnerBundle = ownDataOption<SemanticMutationIsolatedRunnerBundleBuilder>(
      optionDescriptors,
      'buildRunnerBundle',
      'Isolated runtime capability probe options'
    );
    const runtimeInputSources = ownDataOption<SemanticMutationIsolatedRuntimeInputSources>(
      optionDescriptors,
      'runtimeInputSources',
      'Isolated runtime capability probe options'
    );
    const canonicalProductionProbe =
      buildRunnerBundle === undefined && runtimeInputSources === undefined;
    const sources = runtimeInputSources ??
      await prepareCanonicalSemanticMutationIsolatedRuntimeInputSources();
    if (!isSemanticMutationStagingWorkspace(stagingWorkspaceRoot)) {
      throw new Error('Isolated verification requires a controlled staging workspace');
    }
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
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
      async () => await issueSemanticMutationIsolatedRuntimeCapability({
        compilerRegistries,
        runnerBundle: bundle,
        sources,
        stagingWorkspaceRoot
      })
    );
    const runtimeRoot = resolveSemanticMutationIsolatedRuntimePlanBinding(capability);
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
  readonly semanticBundle: Awaited<ReturnType<typeof buildWorkspaceSemanticBundle>>;
  readonly stagedVerificationProofSource?: StagedVerificationProofSource;
  readonly verificationReport: CurrentCanonicalVerificationReport;
}
const canonicalProductionRuntimeBindingRoots = new WeakSet<object>();

interface NamedArtifactReadResult {
  readonly artifact: Exclude<SemanticMutationIsolatedVerificationArtifact, 'child-outcome' | 'verification-set'>;
  readonly result: JsonArtifactReadResult;
}

function throwIsolatedFailure(failure: SemanticMutationIsolatedVerificationFailure): never {
  throw new SemanticMutationIsolatedVerificationUnavailableError(failure);
}

function artifactFailureStage(
  status: Exclude<JsonArtifactReadResult['status'], 'ok'>
): SemanticMutationIsolatedVerificationFailureStage {
  return status === 'missing'
    ? 'artifact-missing'
    : status === 'parse-error'
      ? 'artifact-parse'
      : 'artifact-read';
}

function terminationDetail(
  terminationClass: SemanticMutationIsolatedTerminationClass,
  trace: SemanticMutationIsolatedProgressTrace
): NonNullable<SemanticMutationIsolatedVerificationFailure['termination']> {
  return Object.freeze({
    class: terminationClass,
    ...(trace.lastCheckpoint === undefined ? {} : { checkpoint: trace.lastCheckpoint }),
    ...(trace.pendingCheckpoint === undefined
      ? {}
      : { pendingCheckpoint: trace.pendingCheckpoint })
  });
}

function exactProgressTrace(
  trace: SemanticMutationIsolatedProgressTrace,
  expected: readonly SemanticMutationIsolatedProgressCheckpoint[]
): boolean {
  return trace.pendingCheckpoint === undefined &&
    trace.checkpoints.length === expected.length &&
    trace.checkpoints.every((checkpoint, index) => checkpoint === expected[index]);
}

function progressFailureStage(
  trace: SemanticMutationIsolatedProgressTrace
): SemanticMutationIsolatedChildFailureStage | undefined {
  if (!trace.checkpoints.includes('failure-caught')) return undefined;
  if (trace.checkpoints.includes('postcondition')) return 'postcondition';
  return trace.checkpoints.includes('verify-all') ? 'verify-all' : 'preflight';
}

function childControlStateIsCoherent(input: {
  readonly childOutcome: ChildOutcomeReadResult;
  readonly childOutcomePending: ChildOutcomePendingReadResult;
  readonly terminationClass: SemanticMutationIsolatedTerminationClass;
  readonly trace: SemanticMutationIsolatedProgressTrace;
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
  terminationClass: SemanticMutationIsolatedTerminationClass,
  trace: SemanticMutationIsolatedProgressTrace
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

export async function runSemanticMutationIsolatedVerificationChild(
  stagingWorkspaceRoot: string,
  options: SemanticMutationIsolatedVerificationChildOptions
): Promise<IsolatedVerificationArtifacts> {
  let failureStage: SemanticMutationIsolatedVerificationFailureStage = 'runtime-materialization';
  try {
    const optionDescriptors = Object.getOwnPropertyDescriptors(options);
    const suppliedCommitFence = ownDataOption<CommitFence>(
      optionDescriptors,
      'commitFence',
      'Isolated verification child options'
    );
    const supervisorOverride = ownDataOption<SemanticMutationIsolatedVerificationSupervisor>(
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
    const supervisor = supervisorOverride ?? createSemanticMutationIsolatedVerificationSupervisor();
    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    await resetSemanticMutationIsolatedExecutionPhaseTelemetry(stagingWorkspaceRoot);
    const childOutcomePath = semanticMutationIsolatedChildOutcomePath(stagingWorkspaceRoot);
    const childOutcomePendingPath = semanticMutationIsolatedChildOutcomePendingPath(stagingWorkspaceRoot);
    for (const reportPath of [
      resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.verificationReport),
      resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
      resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.policyReport),
      resolveWorkspaceArtifactPath(stagingWorkspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
      childOutcomePath,
      childOutcomePendingPath,
      ...semanticMutationIsolatedProgressOwnedPaths(stagingWorkspaceRoot)
    ]) {
      await commitFence();
      await rm(reportPath, { force: true });
    }
    const runtimeBinding = capabilityPlan ?? runtimeCapabilityForTest;
    const runtimeBindingRoot = resolveSemanticMutationIsolatedRuntimePlanBinding(runtimeBinding);
    const canIssueProofSource = productionInvocation && runtimeBindingRoot !== undefined &&
      isCanonicalWorkspaceWriteCommitFence(commitFence, workspaceRoot, workspaceWriteLease) &&
      canonicalProductionRuntimeBindingRoots.has(runtimeBindingRoot);
    const { runnerRelativePath } =
      await withSemanticMutationIsolatedPhaseTelemetry(
      stagingWorkspaceRoot,
      'runtime-materialize',
      async () => await materializeSemanticMutationIsolatedRuntime({
        binding: runtimeBinding,
        commitFence,
        stagingWorkspaceRoot
      })
    );
    await commitFence();
    const writableRoot = path.join(stagingWorkspaceRoot, '.isolated-process', 'child');
    await ensureIsolatedProcessDirectories(writableRoot, commitFence);
    const env = buildSemanticMutationIsolatedVerificationEnvironment(stagingWorkspaceRoot);
    failureStage = 'binding-mismatch';
    await assertSemanticMutationIsolatedRuntimeLaunchManifest({
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
    const terminationClass = classifySemanticMutationIsolatedTermination(result.code);
    const progress = await readSemanticMutationIsolatedProgressTrace(
      stagingWorkspaceRoot,
      commitFence
    );
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
    const semanticBundle = await buildWorkspaceSemanticBundle(stagingWorkspaceRoot);
    await commitFence();
    // Production performs its final whole-tree proof immediately before issuing
    // proof-source authority below. Non-production callers still need a terminal
    // proof here because they cannot enter that authority boundary.
    if (!canIssueProofSource) await assertIsolatedStagingTree(stagingWorkspaceRoot);
    await commitFence();
    failureStage = 'artifact-protocol';
    const status = classifySemanticMutationIsolatedVerificationArtifactSet({
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
      const evidenceDigest = semanticMutationIsolatedVerificationEvidenceDigest({
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
    throw new SemanticMutationIsolatedVerificationUnavailableError(
      isolatedVerificationFailure(failureStage, error)
    );
  }
}
