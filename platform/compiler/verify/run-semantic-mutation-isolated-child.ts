import { createHash } from 'node:crypto';
import { lstat, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { listFilesRecursive, pathExists, type CommitFence } from '../../shared/fs.ts';
import { readLockFile } from '../../shared/lock-utils.ts';
import {
  compilerRoot,
  getWorkspacePaths,
  officialRegistryRelativePath,
  posixPath,
  resolveWorkspaceLockPath,
  resolveWorkspacePlanPath
} from '../../shared/paths.ts';
import {
  PIPELINE_EXECUTION_BOUNDARIES,
  type PipelineExecutionBoundary
} from '../../shared/pipeline-types.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  runCommand,
  type CommandResult
} from '../../shared/process.ts';
import { isCanonicalVerificationArtifactSet } from '../../shared/verification-artifact-contract.ts';
import type {
  SemanticMutationVerificationCapabilityPlanV1,
  VerificationReport
} from '../../shared/verification-types.ts';
import {
  runWindowsAppContainerChild,
  WindowsAppContainerExecutionError,
  type WindowsAppContainerExecutionPhase,
  type WindowsAppContainerHostToolFailure,
  type WindowsAppContainerNativeHelperObservation,
  type WindowsAppContainerPreparationSubstage
} from '../../shared/windows-appcontainer-executor.ts';
import type { WorkspaceWriteLeaseToken } from '../../shared/workspace-write-lease.ts';
import { loadWorkspacePlan } from '../parse/load-plan.ts';
import {
  buildWorkspaceSemanticBundle,
  type WorkspaceSemanticBundle
} from '../semantic-frontend.ts';
import {
  parseSemanticMutationIsolatedChildOutcomeBytes,
  semanticMutationIsolatedChildOutcomePath,
  semanticMutationIsolatedChildOutcomePendingPath,
  type SemanticMutationIsolatedChildFailureStage,
  type SemanticMutationIsolatedChildOutcomeV1
} from '../semantic-mutation/isolated-verification-child-outcome.ts';
import {
  classifySemanticMutationIsolatedTermination,
  readSemanticMutationIsolatedProgressTrace,
  SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS,
  semanticMutationIsolatedProgressOwnedPaths,
  type SemanticMutationIsolatedProgressCheckpoint,
  type SemanticMutationIsolatedProgressTrace,
  type SemanticMutationIsolatedTerminationClass
} from '../semantic-mutation/isolated-verification-child-progress.ts';
import {
  resetSemanticMutationIsolatedExecutionPhaseTelemetry,
  resetSemanticMutationIsolatedPhaseTelemetry,
  withSemanticMutationIsolatedPhaseTelemetry
} from '../semantic-mutation/isolated-verification-phase-telemetry.ts';
import { assertIsolatedStagingTree } from './assert-isolated-staging-tree.ts';
import {
  captureIsolatedRuntimeBuildNodeModulesProof,
  isolatedPlaywrightBrowsersPath,
  resolveIsolatedRuntimeDependencySources,
  revalidateIsolatedRuntimeBuildNodeModulesProof
} from './run-runtime-verification.ts';
import {
  assertSemanticMutationIsolatedRuntimeLaunchManifest,
  issueSemanticMutationIsolatedRuntimeCapability,
  materializeSemanticMutationIsolatedRuntime,
  SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT,
  type SemanticMutationIsolatedCompilerRegistryInput,
  type SemanticMutationIsolatedRuntimeInputSources
} from './semantic-mutation-isolated-runtime-plan.ts';
import { isSemanticMutationStagingWorkspace } from './semantic-mutation-staging-boundary.ts';

export type { SemanticMutationIsolatedRuntimeInputSources } from './semantic-mutation-isolated-runtime-plan.ts';

export type SemanticMutationIsolatedVerificationFailureStage =
  | 'runtime-materialization'
  | 'appcontainer-execution'
  | 'child-failed-before-artifacts'
  | 'child-terminated-without-outcome'
  | 'artifact-missing'
  | 'artifact-parse'
  | 'artifact-read'
  | 'artifact-protocol'
  | 'semantic-rebuild'
  | 'binding-mismatch';

export type SemanticMutationIsolatedVerificationArtifact =
  | 'child-outcome'
  | 'child-progress'
  | 'verification-report'
  | 'runtime-report'
  | 'policy-report'
  | 'acceptance-coverage'
  | 'verification-set';

export interface SemanticMutationIsolatedVerificationFailure {
  readonly stage: SemanticMutationIsolatedVerificationFailureStage;
  readonly child?: Readonly<{
    readonly stage: SemanticMutationIsolatedChildFailureStage;
    readonly boundary?: PipelineExecutionBoundary;
  }>;
  readonly artifact?: SemanticMutationIsolatedVerificationArtifact;
  readonly termination?: Readonly<{
    readonly class: SemanticMutationIsolatedTerminationClass;
    readonly checkpoint?: SemanticMutationIsolatedProgressCheckpoint;
    readonly pendingCheckpoint?: SemanticMutationIsolatedProgressCheckpoint;
  }>;
  readonly appContainer?: Readonly<{
    readonly phase: WindowsAppContainerExecutionPhase;
    readonly preparationSubstage?: WindowsAppContainerPreparationSubstage;
    readonly nativeCode?: number;
    readonly hostToolFailure?: WindowsAppContainerHostToolFailure;
    readonly nativeHelperObservation?: WindowsAppContainerNativeHelperObservation;
  }>;
}

const ISOLATED_FAILURE_STAGES = new Set<SemanticMutationIsolatedVerificationFailureStage>([
  'runtime-materialization',
  'appcontainer-execution',
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
  'runner-environment-boundary-failure', 'runner-staging-layout-boundary-failure',
  'runner-staging-tree-failure',
  'runner-catch-tree-failure',
  'outcome-publication-failure', 'progress-publication-failure', 'loader-import-failure',
  'unclassified-nonzero'
]);
const ISOLATED_PROGRESS_CHECKPOINTS = new Set<SemanticMutationIsolatedProgressCheckpoint>(
  SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS
);
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
  'native-helper-build', 'native-helper-materialization', 'native-helper-invocation',
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
  outcome: SemanticMutationIsolatedChildOutcomeV1
): NonNullable<SemanticMutationIsolatedVerificationFailure['child']> {
  return Object.freeze({
    stage: outcome.stage,
    ...(outcome.boundary === undefined ? {} : { boundary: outcome.boundary })
  });
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
  const appContainerRecord = recordValue(record?.appContainer);
  if (typeof appContainerRecord?.phase !== 'string' ||
    !APPCONTAINER_EXECUTION_PHASES.has(
      appContainerRecord.phase as WindowsAppContainerExecutionPhase
    )) {
    return Object.freeze({
      stage,
      ...(child === undefined ? {} : { child }),
      ...(artifact === undefined ? {} : { artifact }),
      ...(termination === undefined ? {} : { termination })
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

export class SemanticMutationIsolatedVerificationUnavailableError extends Error {
  public readonly code = 'SEMANTIC-MUTATION-ISOLATED-VERIFICATION-UNAVAILABLE' as const;
  public readonly failure: SemanticMutationIsolatedVerificationFailure;

  constructor(failure: SemanticMutationIsolatedVerificationFailure) {
    super('Semantic Mutation isolated verification is unavailable');
    this.name = 'SemanticMutationIsolatedVerificationUnavailableError';
    this.failure = redactIsolatedVerificationFailure(failure, 'binding-mismatch');
  }
}

function isolatedVerificationFailure(
  stage: SemanticMutationIsolatedVerificationFailureStage,
  error: unknown
): SemanticMutationIsolatedVerificationFailure {
  if (error instanceof SemanticMutationIsolatedVerificationUnavailableError) {
    return redactIsolatedVerificationFailure(error.failure, stage);
  }
  if (error instanceof WindowsAppContainerExecutionError) {
    return redactIsolatedVerificationFailure({
      stage: 'appcontainer-execution',
      appContainer: {
        phase: error.phase,
        preparationSubstage: error.preparationSubstage,
        nativeCode: error.nativeCode,
        hostToolFailure: error.hostToolFailure,
        nativeHelperObservation: error.nativeHelperObservation
      }
    }, 'appcontainer-execution');
  }
  return Object.freeze({ stage });
}

/** Test-only projection of the production path-free isolated failure boundary. */
export function projectSemanticMutationIsolatedVerificationFailureForTests(
  stage: SemanticMutationIsolatedVerificationFailureStage,
  error: unknown
): SemanticMutationIsolatedVerificationFailure {
  return isolatedVerificationFailure(stage, error);
}

const ISOLATED_RUNNER_PATH = fileURLToPath(
  new URL('../../orchestrator/semantic-mutation-isolated-verification-runner.ts', import.meta.url)
);

const DEFAULT_RUNTIME_DEPENDENCY_SOURCES = resolveIsolatedRuntimeDependencySources();
const DEFAULT_RUNTIME_INPUT_SOURCES = Object.freeze({
  browserCache: DEFAULT_RUNTIME_DEPENDENCY_SOURCES.browserCache,
  compilerModulesRoot: DEFAULT_RUNTIME_DEPENDENCY_SOURCES.nodeModules,
  compilerPackage: path.join(compilerRoot, 'package.json'),
  composeTemplates: path.join(compilerRoot, 'platform', 'compiler', 'compose', 'templates'),
  dependencyModules: DEFAULT_RUNTIME_DEPENDENCY_SOURCES.nodeModules,
  officialPolicies: path.join(compilerRoot, 'platform', 'policies', 'official'),
  officialRegistry: path.join(compilerRoot, 'platform', 'registry', 'official')
} satisfies SemanticMutationIsolatedRuntimeInputSources);

function defaultRuntimeInputSources(): SemanticMutationIsolatedRuntimeInputSources {
  return DEFAULT_RUNTIME_INPUT_SOURCES;
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
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/${officialPath}`,
    sourceRoot: sources.officialRegistry
  }];
}

function rawByteDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return actual.length === canonicalExpected.length &&
    actual.every((key, index) => key === canonicalExpected[index]);
}

function exactSemanticBundle(value: unknown): value is WorkspaceSemanticBundle {
  if (!exactKeys(value, ['snapshot', 'generatorPlan', 'semanticViews', 'semanticContractSources']) ||
    !exactKeys(value.snapshot, ['ir']) || !exactKeys(value.generatorPlan, [
      'inputRevision', 'semanticRevision', 'tasks'
    ]) || !exactKeys(value.semanticViews, [
      'formatVersion', 'inputRevision', 'semanticRevision', 'views'
    ]) || !Array.isArray(value.semanticContractSources)) {
    return false;
  }
  const bundle = value as unknown as WorkspaceSemanticBundle;
  return typeof bundle.snapshot.ir.inputRevision === 'string' &&
    typeof bundle.snapshot.ir.semanticRevision === 'string' &&
    bundle.generatorPlan.inputRevision === bundle.snapshot.ir.inputRevision &&
    bundle.generatorPlan.semanticRevision === bundle.snapshot.ir.semanticRevision &&
    bundle.semanticViews.inputRevision === bundle.snapshot.ir.inputRevision &&
    bundle.semanticViews.semanticRevision === bundle.snapshot.ir.semanticRevision &&
    Array.isArray(bundle.generatorPlan.tasks) && Array.isArray(bundle.semanticViews.views) &&
    bundle.semanticContractSources.every((source) => exactKeys(source, [
      'sourceKind', 'loadedContract', 'sourceRevision'
    ]) && (source.sourceKind === 'workspace-authoring' ||
      source.sourceKind === 'workspace-registry' || source.sourceKind === 'compiler-registry') &&
      typeof source.sourceRevision === 'string' && source.loadedContract !== null &&
      typeof source.loadedContract === 'object' && !Array.isArray(source.loadedContract));
}

export interface SemanticMutationIsolatedVerificationArtifactSet {
  readonly childExitCode: number;
  readonly verificationReport: unknown;
  readonly runtimeReport: unknown;
  readonly policyReport: unknown;
  readonly acceptanceCoverage: unknown;
  readonly semanticBundle: unknown;
}

export function classifySemanticMutationIsolatedVerificationArtifactSet(
  input: SemanticMutationIsolatedVerificationArtifactSet
): 'passed' | 'failed' | 'blocked' {
  if (!Number.isSafeInteger(input.childExitCode) || input.childExitCode < 0 ||
    !isCanonicalVerificationArtifactSet(input) ||
    !exactSemanticBundle(input.semanticBundle)) {
    return 'blocked';
  }
  const report = input.verificationReport;
  if (report.summary.status === 'failed') {
    return input.childExitCode === 0 ? 'blocked' : 'failed';
  }
  return input.childExitCode === 0 && report.fast.status === 'passed' &&
    report.runtime.status === 'passed' ? 'passed' : 'blocked';
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

interface SemanticMutationIsolatedVerificationChildCommonOptions {
  readonly commitFence: CommitFence;
  readonly supervisor?: SemanticMutationIsolatedVerificationSupervisor;
  readonly workspaceRoot: string;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
}

export type SemanticMutationIsolatedVerificationChildOptions =
  SemanticMutationIsolatedVerificationChildCommonOptions & (
    | {
        readonly capabilityPlan: SemanticMutationVerificationCapabilityPlanV1;
        readonly runtimeCapabilityForTest?: never;
      }
    | {
        readonly capabilityPlan?: never;
        /** Internal test seam: an exact result from the real runtime probe. */
        readonly runtimeCapabilityForTest: object;
      }
  );

export function buildSemanticMutationIsolatedVerificationEnvironment(
  stagingWorkspaceRoot: string
): Readonly<Record<string, string>> {
  const writableRoot = path.join(stagingWorkspaceRoot, '.isolated-process', 'child');
  return Object.freeze(Object.fromEntries(Object.entries(buildIsolatedProcessEnvironment(writableRoot, {
    [ISOLATED_VERIFICATION_ENV_KEY]: '1',
    CI: 'true',
    PLAYWRIGHT_BROWSERS_PATH: isolatedPlaywrightBrowsersPath(stagingWorkspaceRoot),
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
  })).filter((entry): entry is [string, string] => typeof entry[1] === 'string')));
}

export function createSemanticMutationIsolatedVerificationSupervisor(options: {
  /** Internal test seam. */
  readonly appContainerRunner?: typeof runWindowsAppContainerChild;
  /** Internal test seam. Production always uses Windows AppContainer. */
  readonly commandRunner?: typeof runCommand;
  readonly pollIntervalMs?: number;
  readonly timeoutMs?: number;
} = {}): SemanticMutationIsolatedVerificationSupervisor {
  if (options.commandRunner === undefined) {
    return async (request) => {
      const execution = await (options.appContainerRunner ?? runWindowsAppContainerChild)({
        stagingRoot: request.stagingWorkspaceRoot,
        runnerRelativePath: request.runnerRelativePath,
        environment: Object.freeze(Object.fromEntries(Object.entries(request.env)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))),
        workspaceRoot: request.workspaceRoot,
        workspaceWriteLease: request.workspaceWriteLease,
        timeoutMs: options.timeoutMs ?? 1_200_000
      });
      return { code: execution.exitCode, stdout: '', stderr: '' };
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
        [
          '--no-env-file',
          `--config=${path.join(
            request.stagingWorkspaceRoot,
            ...SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH.split('/')
          )}`,
          '--no-install',
          request.runnerRelativePath
        ],
        {
          beforeSpawn: request.commitFence,
          cwd: request.stagingWorkspaceRoot,
          env: request.env,
          envMode: 'replace',
          signal: controller.signal
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
  | { readonly status: 'valid'; readonly value: SemanticMutationIsolatedChildOutcomeV1 }
  | { readonly status: 'parse-error' | 'read-error' };

type ChildOutcomePendingReadResult =
  | { readonly status: 'absent' | 'present' }
  | { readonly status: 'read-error' };

const MAX_CHILD_OUTCOME_READ_BYTES = 512;

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined;
}

async function readJsonArtifactResult(
  filePath: string,
  commitFence: CommitFence
): Promise<JsonArtifactReadResult> {
  await commitFence();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(filePath));
  } catch (error) {
    return { status: errorCode(error) === 'ENOENT' ? 'missing' : 'read-error' };
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
    return { status: errorCode(error) === 'ENOENT' ? 'absent' : 'read-error' };
  }
  if (!before.isFile() || before.isSymbolicLink() || Number(before.nlink) !== 1) {
    return { status: 'read-error' };
  }
  if (before.size > MAX_CHILD_OUTCOME_READ_BYTES) return { status: 'parse-error' };
  let handle;
  try {
    handle = await open(outcomePath, 'r');
  } catch (error) {
    return { status: errorCode(error) === 'ENOENT' ? 'absent' : 'read-error' };
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
    return { status: errorCode(error) === 'ENOENT' ? 'absent' : 'read-error' };
  }
}

const BUNDLED_RUNTIME_PATH_HELPER = '__secSemanticMutationRuntimePathV1';
const BUNDLED_RUNTIME_PATH_IMPORT = '__secSemanticMutationFileUrlToPathV1';
const BUNDLED_NODE_MODULES_SOURCE_PREFIX = '/node_modules/';
const BUNDLED_EJS_ESM_CJS_COMPAT_ASSIGNMENT = 'module_utils.exports = utils;';
const BUNDLED_EJS_ESM_CJS_COMPAT_GUARD = [
  'if (typeof exports_utils != "undefined") {',
  `  ${BUNDLED_EJS_ESM_CJS_COMPAT_ASSIGNMENT}`,
  '}'
].join('\n');

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
  const brokenEjsAssignmentCount = source.split(BUNDLED_EJS_ESM_CJS_COMPAT_ASSIGNMENT).length - 1;
  const exactEjsGuardCount = source.split(BUNDLED_EJS_ESM_CJS_COMPAT_GUARD).length - 1;
  if (brokenEjsAssignmentCount !== 1 || exactEjsGuardCount !== 1) {
    throw new Error('Semantic Mutation isolated runner bundle has an invalid EJS ESM compatibility guard');
  }
  // Bun 1.3.6 rewrites EJS's dead ESM `exports/module` compatibility branch
  // into a live `exports_utils` guard while omitting `module_utils`. Removing
  // this exact required block restores the upstream ESM semantics. A missing
  // block is dependency-output drift and must fail closed.
  const normalizedSource = source.replace(BUNDLED_EJS_ESM_CJS_COMPAT_GUARD, '');
  const provenBuildNodeModulesRoot = buildNodeModulesRoot ??
    revalidateIsolatedRuntimeBuildNodeModulesProof(
      captureIsolatedRuntimeBuildNodeModulesProof()
    );
  const expectedRuntimeDirectories = Object.freeze([
    Object.freeze({
      sourceSuffix: '/node_modules/@ts-morph/common/dist',
      runtimeDirectory: '../../node_modules/@ts-morph/common/dist'
    }),
    Object.freeze({
      sourceSuffix: '/node_modules/typescript/lib',
      runtimeDirectory: '../../node_modules/typescript/lib'
    })
  ]);
  const trustedBuildRoots = Object.freeze([
    path.join(compilerRoot, 'node_modules'),
    path.resolve(provenBuildNodeModulesRoot)
  ]);
  const observedRuntimeDirectories = new Set<string>();
  const assignmentPattern =
    /var __dirname = ("(?:[^"\\]|\\.)*"), __filename = ("(?:[^"\\]|\\.)*");/gu;
  const relocated = normalizedSource.replace(
    assignmentPattern,
    (assignment: string, encodedDirectory: string, encodedFile: string): string => {
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
  const buildRootProof = captureIsolatedRuntimeBuildNodeModulesProof();
  const result = await Bun.build({
    entrypoints: [ISOLATED_RUNNER_PATH],
    format: 'esm',
    minify: false,
    sourcemap: 'none',
    splitting: false,
    target: 'bun'
  });
  if (!result.success || result.outputs.length !== 1) {
    throw new Error('Semantic Mutation isolated runner bundle could not be built');
  }
  const buildNodeModulesRoot = revalidateIsolatedRuntimeBuildNodeModulesProof(buildRootProof);
  const bundle = relocateIsolatedRunnerBundle(
    new Uint8Array(await result.outputs[0].arrayBuffer()),
    buildNodeModulesRoot
  );
  const bundleText = new TextDecoder().decode(bundle);
  const hostPaths = [compilerRoot, buildNodeModulesRoot].flatMap(hostPathVariants);
  if (/(?:__dirname|__filename)\s*=\s*["'][A-Za-z]:[\\/]/u.test(bundleText) ||
    hostPaths.some((hostPath) => bundleText.includes(hostPath))) {
    throw new Error('Semantic Mutation isolated runner bundle contains a host path');
  }
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
  readonly browserCacheSource?: string;
  readonly buildRunnerBundle?: SemanticMutationIsolatedRunnerBundleBuilder;
  /** Internal test seam. Product callers cannot supply isolated runtime paths. */
  readonly runtimeInputSources?: SemanticMutationIsolatedRuntimeInputSources;
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
    const defaults = defaultRuntimeInputSources();
    const sources = options.runtimeInputSources ?? defaults;
    const browserCache = options.browserCacheSource ?? sources.browserCache;
    if (!isSemanticMutationStagingWorkspace(stagingWorkspaceRoot)) {
      throw new Error('Isolated verification requires a controlled staging workspace');
    }
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    await resetSemanticMutationIsolatedPhaseTelemetry(stagingWorkspaceRoot);
    if (await pathExists(path.join(stagingWorkspaceRoot, 'source', 'schema', 'db.prisma.template'))) {
      throw new Error('Isolated Prisma execution is unavailable');
    }
    const opaqueModulesRoot = path.join(stagingWorkspaceRoot, 'source', 'code', 'opaque');
    if ((await pathExists(opaqueModulesRoot)) &&
      (await listFilesRecursive(opaqueModulesRoot)).some((file) => path.basename(file) === 'module.yaml')) {
      throw new Error('Isolated opaque module linking is unavailable');
    }
    const bundle = await (options.buildRunnerBundle ?? loadProcessLocalIsolatedRunnerBundle)();
    return await issueSemanticMutationIsolatedRuntimeCapability({
      browserCache,
      compilerRegistries: await compilerRegistryInputs(stagingWorkspaceRoot, sources),
      runnerBundle: bundle,
      sources,
      stagingWorkspaceRoot
    });
  } catch {
    return { status: 'unavailable' };
  }
}

export interface IsolatedVerificationArtifacts {
  readonly status: 'passed' | 'failed';
  readonly acceptanceCoverage: AcceptanceCoverageReport;
  readonly policyReport: PolicyReport;
  readonly rawDigests: {
    readonly acceptanceCoverage: string;
    readonly policyReport: string;
    readonly runtimeReport: string;
    readonly verificationReport: string;
  };
  readonly semanticBundle: Awaited<ReturnType<typeof buildWorkspaceSemanticBundle>>;
  readonly verificationReport: VerificationReport;
}

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
    const commitFence = options.commitFence;
    const supervisor = options.supervisor ?? createSemanticMutationIsolatedVerificationSupervisor();
    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    await resetSemanticMutationIsolatedExecutionPhaseTelemetry(stagingWorkspaceRoot);
    const paths = getWorkspacePaths(stagingWorkspaceRoot);
    const childOutcomePath = semanticMutationIsolatedChildOutcomePath(stagingWorkspaceRoot);
    const childOutcomePendingPath = semanticMutationIsolatedChildOutcomePendingPath(stagingWorkspaceRoot);
    for (const reportPath of [
      paths.verificationReportPath,
      paths.runtimeReportPath,
      paths.policyReportPath,
      paths.acceptanceCoveragePath,
      childOutcomePath,
      childOutcomePendingPath,
      ...semanticMutationIsolatedProgressOwnedPaths(stagingWorkspaceRoot)
    ]) {
      await commitFence();
      await rm(reportPath, { force: true });
    }
    const runtimeBinding = options.capabilityPlan ?? options.runtimeCapabilityForTest;
    const { browsersPath, runnerRelativePath } = await withSemanticMutationIsolatedPhaseTelemetry(
      stagingWorkspaceRoot,
      'runtime-materialize',
      async () => await materializeSemanticMutationIsolatedRuntime({
        binding: runtimeBinding,
        commitFence,
        stagingWorkspaceRoot
      })
    );
    await commitFence();
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
    const writableRoot = path.join(stagingWorkspaceRoot, '.isolated-process', 'child');
    await ensureIsolatedProcessDirectories(writableRoot, commitFence);
    const env = buildSemanticMutationIsolatedVerificationEnvironment(stagingWorkspaceRoot);
    if (env.PLAYWRIGHT_BROWSERS_PATH !== browsersPath) {
      throw new Error('Isolated browser cache environment binding is invalid');
    }
    failureStage = 'binding-mismatch';
    await assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: runtimeBinding,
      commitFence,
      stagingWorkspaceRoot
    });
    failureStage = 'appcontainer-execution';
    const result = await supervisor({
      commitFence,
      env,
      runnerRelativePath,
      stagingWorkspaceRoot,
      workspaceRoot: options.workspaceRoot,
      workspaceWriteLease: options.workspaceWriteLease
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
    const verification = await readJsonArtifactResult(paths.verificationReportPath, commitFence);
    const runtime = await readJsonArtifactResult(paths.runtimeReportPath, commitFence);
    const policy = await readJsonArtifactResult(paths.policyReportPath, commitFence);
    const coverage = await readJsonArtifactResult(paths.acceptanceCoveragePath, commitFence);
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
    await assertIsolatedStagingTree(stagingWorkspaceRoot);
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
    return {
      status,
      verificationReport: verification.value as VerificationReport,
      policyReport: policy.value as PolicyReport,
      acceptanceCoverage: coverage.value as AcceptanceCoverageReport,
      semanticBundle,
      rawDigests: {
        verificationReport: rawByteDigest(verification.bytes),
        runtimeReport: rawByteDigest(runtime.bytes),
        policyReport: rawByteDigest(policy.bytes),
        acceptanceCoverage: rawByteDigest(coverage.bytes)
      }
    };
  } catch (error) {
    throw new SemanticMutationIsolatedVerificationUnavailableError(
      isolatedVerificationFailure(failureStage, error)
    );
  }
}
