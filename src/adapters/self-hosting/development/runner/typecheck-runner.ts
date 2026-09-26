import path from 'node:path';
import type {
  VerificationReasonCode,
  VerificationResultStatus
} from '../../../../assurance/verification/result/contract/result.ts';
import { sha256 } from '../../../../contracts/canonical.ts';
import { isPathInside } from "../../../../contracts/relative-path.ts";
import { observeExecutionProgressPhase } from '../../../../execution/execution-progress.ts';
import {
  issueOperationRequirementBindingContext
} from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext,
  projectCapabilityDiagnostic,
  type BoundSemanticOperation,
  type DomainReadbackDisposition,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import {
  acquireWorkingTreeSnapshot,
  assertTypeScriptProjectGenerationEvidence,
  assertTypeScriptProjectInput,
  compileTypeScriptProjectFactIdentity,
  compileTypeScriptProjectInput,
  issueTypeScriptProjectGenerationEvidence,
  projectTypeScriptProjectFactIdentity,
  type TypeScriptProjectGenerationEvidence,
  type TypeScriptProjectInput
} from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { WINDOWS_READ_ONLY_TREE_ADMISSION_POLICY } from '../../../runtime-state/physical/runtime/windows-host-filesystem-authority.ts';
import { currentRuntimePlatform, resolveRuntimeCacheRoot, runtimeStateEnvironment } from '../../../runtime-state/workspace-state/layout.ts';
import { acquireRuntimeCachePhysicalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import { TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY, assertTypeScriptNativeChecker, canonicalTypeScriptDiagnosticArguments, executeTypeScriptNativeChecker, issueTypeScriptCheckerProcessExecutionAdmission, requireSelectedTypeScriptNativeChecker, selectInstalledTypeScriptNativeChecker, type InstalledTypeScriptNativeChecker, type TypeScriptNativeCheckerProvider } from '../../../toolchain/typescript/checker.ts';
import {
  assertTypeScriptExecutionGeneration,
  materializeTypeScriptExecutionGeneration,
  typeScriptExecutionGenerationDigest,
  type RetainedTypeScriptCompilerDependencyGeneration,
  type TypeScriptExecutionGeneration
} from '../../../toolchain/typescript/execution-generation.ts';
import { prepareTypeScriptIncrementalState } from '../../../toolchain/typescript/incremental-state.ts';
import {
  issueNonProcessVerificationActionTerminalSettlement,
  issueProcessVerificationActionTerminalSettlement,
  issueVerificationActionOwnerTerminalReceipt,
  type VerificationActionKey,
  type VerificationActionKeyDigest,
  type VerificationActionKeyInput,
  type VerificationActionTerminal,
  type VerificationActionTerminalSettlement
} from '../../../verification/platform/action/contract/action.ts';
import {
  VerificationActionRunner,
  type VerificationActionRunOutcome
} from '../../../verification/platform/action/runner.ts';
import { compilerRoot } from "../../../workspace-context.ts";
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import {
  assertMaterializedOperationDependencyBootstrapResult,
  type MaterializedOperationDependencyBootstrapResult
} from './dependency-bootstrap.ts';
import { reportDevExecutionProgress } from './execution-progress.ts';

type TypecheckDependencyExecutionGenerationAuthority = Readonly<{
  generationDigest: `sha256:${string}`;
}>;

type TypecheckDependencyAdmission = MaterializedOperationDependencyBootstrapResult;

const TYPECHECK_ACTION_KIND = 'typescript-project-typecheck' as const;
const TYPECHECK_ACTION_CONTRACT = sha256(Object.freeze({
  action: TYPECHECK_ACTION_KIND,
  admission: 'owner-issued-dependency-and-source-program-facts',
  sourceProgramCompilation:
    'compiler-issued-project-generation-with-settled-content-addressed-fact-cache-session',
  execution: 'owner-issued-bounded-process-session-and-private-incremental-state',
  terminal: 'process-session-receipt-provider-settlement-readback-and-physical-cleanup'
})) as VerificationActionKeyDigest;
const TYPECHECK_ACTION_RESULT = sha256(Object.freeze({
  action: TYPECHECK_ACTION_KIND,
  result: 'verification-action-owner-terminal',
  passRequires: Object.freeze([
    'owner-issued-process-resource-session-receipt',
    'compiler-issued-source-program-project-generation',
    'settled-source-program-fact-cache-session',
    'settled-checker-process',
    'current-execution-generation',
    'physically-clean-subordinate-settlement'
  ])
})) as VerificationActionKeyDigest;
const TYPECHECK_REQUIREMENT = Object.freeze({
  projectCheck: 'typescript.project-check'
} as const);
const TYPECHECK_MATERIALIZATION_DURATION_MS = 120_000;
const TYPECHECK_MATERIALIZATION_POLICY = Object.freeze({
  maximumDurationMs: TYPECHECK_MATERIALIZATION_DURATION_MS
});
const TYPECHECK_OPERATION_DURATION_MS = TYPECHECK_MATERIALIZATION_DURATION_MS
  + WINDOWS_READ_ONLY_TREE_ADMISSION_POLICY.maximumDurationMs
  + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs;
const typecheckActionRunner = new VerificationActionRunner();

function assertTypecheckProcessResourceReceipt(
  receipt: ProcessResourceSessionReceipt,
  operation: BoundSemanticOperation,
  execution: Awaited<ReturnType<typeof executeTypeScriptNativeChecker>> | undefined
): void {
  assertProcessResourceSessionReceipt(receipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    requirementId: TYPECHECK_REQUIREMENT.projectCheck
  });
  if (receipt.processCount > 1
      || receipt.inputBytes !== 0
      || receipt.outputBytes
        > TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
          + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes
      || (execution?.status === 'exited' && (
        receipt.processCount !== 1
        || receipt.successfulProcessRecordCount !== 1
        || receipt.failedProcessCount !== 0
      ))) {
    throw new Error('Typecheck process receipt does not settle the exact checker execution.');
  }
}

type TypecheckProcessOutput = Readonly<{ stdout: string; stderr: string }>;

type TypecheckTerminalProcessEvidence =
  | Readonly<{
    processState: 'not-started';
    checkerDisposition: 'not-started';
    processOutput: null;
  }>
  | Readonly<{
    processState: 'settled';
    checkerDisposition: 'settled';
    processOutput: TypecheckProcessOutput;
  }>
  | Readonly<{
    processState: 'unknown';
    checkerDisposition: 'unknown';
    processOutput: TypecheckProcessOutput;
  }>;

type PendingTypecheckTerminalCore = Readonly<{
  readbackDisposition: DomainReadbackDisposition;
  status: VerificationResultStatus;
  reasonCode: VerificationReasonCode;
  executionObservation: unknown;
  readback: unknown;
}>;

type PendingTypecheckTerminal =
  | PendingTypecheckTerminalCore & Extract<
    TypecheckTerminalProcessEvidence,
    Readonly<{ processState: 'not-started' }>
  >
  | PendingTypecheckTerminalCore & Extract<
    TypecheckTerminalProcessEvidence,
    Readonly<{ processState: 'settled' }>
  >;

function notStartedTypecheckProcessEvidence(): TypecheckTerminalProcessEvidence {
  return Object.freeze({
    processState: 'not-started' as const,
    checkerDisposition: 'not-started' as const,
    processOutput: null
  });
}

function settledTypecheckProcessEvidence(
  processOutput: TypecheckProcessOutput
): TypecheckTerminalProcessEvidence {
  return Object.freeze({
    processState: 'settled' as const,
    checkerDisposition: 'settled' as const,
    processOutput
  });
}

function unknownTypecheckProcessEvidence(
  processOutput: TypecheckProcessOutput
): TypecheckTerminalProcessEvidence {
  return Object.freeze({
    processState: 'unknown' as const,
    checkerDisposition: 'unknown' as const,
    processOutput
  });
}

function pendingNotStartedTypecheckTerminal(
  input: PendingTypecheckTerminalCore
): PendingTypecheckTerminal {
  return Object.freeze({
    ...input,
    processState: 'not-started' as const,
    checkerDisposition: 'not-started' as const,
    processOutput: null
  });
}

function pendingSettledTypecheckTerminal(
  input: PendingTypecheckTerminalCore & Readonly<{ processOutput: TypecheckProcessOutput }>
): PendingTypecheckTerminal {
  return Object.freeze({
    ...input,
    processState: 'settled' as const,
    checkerDisposition: 'settled' as const
  });
}

export type TypecheckOperationOptions = Readonly<{
  deadlineAtUnixMs?: number;
  signal?: AbortSignal;
}>;

type TypecheckOperationContext = Readonly<{
  deadlineAtUnixMs: number;
  deadlineAtMonotonicMs: number;
  signal?: AbortSignal;
  assertActive(label: string): void;
  remainingMs(label: string): number;
}>;

function issueTypecheckOperationContext(
  options: TypecheckOperationOptions = {}
): TypecheckOperationContext {
  const startedAtUnixMs = Date.now();
  const maximumDeadlineAtUnixMs = startedAtUnixMs + TYPECHECK_OPERATION_DURATION_MS;
  if (options.deadlineAtUnixMs !== undefined
      && (!Number.isSafeInteger(options.deadlineAtUnixMs)
        || options.deadlineAtUnixMs <= startedAtUnixMs)) {
    throw new Error('TypeScript typecheck deadline must be one future absolute safe integer.');
  }
  const deadlineAtUnixMs = Math.min(
    options.deadlineAtUnixMs ?? maximumDeadlineAtUnixMs,
    maximumDeadlineAtUnixMs
  );
  const deadlineAtMonotonicMs = performance.now() + Math.max(
    0,
    deadlineAtUnixMs - startedAtUnixMs
  );
  const remainingMs = (label: string): number => {
    if (options.signal?.aborted === true) {
      throw new Error(`TypeScript typecheck ${label} was cancelled.`);
    }
    const remaining = Math.floor(Math.min(
      deadlineAtUnixMs - Date.now(),
      deadlineAtMonotonicMs - performance.now()
    ));
    if (remaining < 1) {
      throw new Error(`TypeScript typecheck ${label} exhausted its operation deadline.`);
    }
    return remaining;
  };
  const context: TypecheckOperationContext = Object.freeze({
    deadlineAtUnixMs,
    deadlineAtMonotonicMs,
    signal: options.signal,
    assertActive(label: string): void { void remainingMs(label); },
    remainingMs
  });
  context.assertActive('admission');
  return context;
}

function actionDigest(value: unknown): VerificationActionKeyDigest {
  return sha256(value) as VerificationActionKeyDigest;
}

async function retainTypeScriptDependencyGeneration(
  authority: TypecheckDependencyExecutionGenerationAuthority,
  operation: TypecheckOperationContext
): Promise<RetainedTypeScriptCompilerDependencyGeneration> {
  operation.assertActive('dependency generation retention admission');
  const dependencyRuntime = await import('../../../toolchain/dependencies/runtime.ts');
  const generation = await dependencyRuntime.retainCompilerDependencyExecutionGeneration(
    authority as Parameters<
      typeof dependencyRuntime.retainCompilerDependencyExecutionGeneration
    >[0],
    { deadlineAtUnixMs: operation.deadlineAtUnixMs, signal: operation.signal }
  );
  if (generation.generationDigest !== authority.generationDigest) {
    await generation.retire();
    throw new Error('Dependency owner retained a foreign TypeScript execution generation.');
  }
  return generation;
}

type TypecheckSubordinateStage = Readonly<{
  status: string;
  durationMs?: number;
  reason?: string;
  errorName?: string;
  message?: string;
  exitCode?: number;
  stdoutDigest?: VerificationActionKeyDigest;
  stderrDigest?: VerificationActionKeyDigest;
}>;

type TypecheckSubordinateSettlement = Readonly<{
  setup: TypecheckSubordinateStage;
  execution: TypecheckSubordinateStage;
  cleanup: TypecheckSubordinateStage;
  readback: TypecheckSubordinateStage;
}>;

function boundedDiagnosticText(value: unknown, maximum: number): string {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}

function subordinateError(error: unknown): TypecheckSubordinateStage {
  return Object.freeze({
    status: 'failed',
    errorName: boundedDiagnosticText(error instanceof Error ? error.name : typeof error, 64),
    message: boundedDiagnosticText(error instanceof Error ? error.message : String(error), 240)
  });
}

function encodeTypecheckSubordinateSettlement(
  value: TypecheckSubordinateSettlement
): string {
  const encoded = JSON.stringify(value);
  if (encoded.length > 1024 || Buffer.byteLength(encoded, 'utf8') > 1024
      || /[\u0000-\u001f]/u.test(encoded)) {
    throw new Error('TypeScript subordinate settlement exceeds the existing journal note bound.');
  }
  return encoded;
}

function projectTypecheckSubordinateSettlement(value: string): TypecheckSubordinateSettlement {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TypeScript subordinate settlement is not one object.');
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'cleanup,execution,readback,setup') {
    throw new Error('TypeScript subordinate settlement stages are not canonical.');
  }
  const stage = (name: 'setup' | 'execution' | 'cleanup' | 'readback'): Record<string, unknown> => {
    const observation = record[name];
    if (observation === null || typeof observation !== 'object' || Array.isArray(observation)) {
      throw new Error(`TypeScript subordinate settlement ${name} stage is invalid.`);
    }
    return observation as Record<string, unknown>;
  };
  const exact = (observation: Record<string, unknown>, keys: readonly string[], label: string): void => {
    const actualKeys = Object.keys(observation).sort().join(',');
    const canonicalKeys = [...keys, ...(observation.durationMs === undefined ? [] : ['durationMs'])]
      .sort().join(',');
    if (actualKeys !== canonicalKeys) {
      throw new Error(`TypeScript subordinate settlement ${label} fields are not canonical.`);
    }
    if (observation.durationMs !== undefined && (
      !Number.isSafeInteger(observation.durationMs) || (observation.durationMs as number) < 0
    )) {
      throw new Error(`TypeScript subordinate settlement ${label} duration is invalid.`);
    }
  };
  const bounded = (candidate: unknown, maximum: number, label: string): string => {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > maximum
        || /[\u0000-\u001f\u007f]/u.test(candidate)) {
      throw new Error(`TypeScript subordinate settlement ${label} is invalid.`);
    }
    return candidate;
  };
  const reason = (observation: Record<string, unknown>, allowed: readonly string[], label: string): void => {
    if (!allowed.includes(bounded(observation.reason, 128, `${label} reason`))) {
      throw new Error(`TypeScript subordinate settlement ${label} reason is not allowed.`);
    }
  };
  const error = (observation: Record<string, unknown>, label: string): void => {
    bounded(observation.errorName, 64, `${label} errorName`);
    bounded(observation.message, 240, `${label} message`);
  };

  const setup = stage('setup');
  switch (setup.status) {
    case 'complete':
      exact(setup, ['status'], 'setup');
      break;
    case 'failed':
      exact(setup, ['status', 'reason', 'errorName', 'message'], 'setup');
      reason(setup, ['setup-failed'], 'setup');
      error(setup, 'setup');
      break;
    default:
      throw new Error('TypeScript subordinate settlement setup status is not terminal.');
  }

  const execution = stage('execution');
  switch (execution.status) {
    case 'not-started':
      exact(execution, ['status'], 'execution');
      break;
    case 'unverified':
      exact(execution, ['status', 'reason', 'message'], 'execution');
      reason(execution, [
        'cancelled', 'deadline-exhausted', 'process-boundary-unavailable', 'provider-drift'
      ], 'execution');
      bounded(execution.message, 240, 'execution message');
      break;
    case 'failed':
      exact(execution, ['status', 'reason', 'errorName', 'message'], 'execution');
      reason(execution, ['execution-unsettled', 'unexpected-settlement-failure'], 'execution');
      error(execution, 'execution');
      break;
    case 'exited':
      exact(execution, ['status', 'exitCode', 'stdoutDigest', 'stderrDigest'], 'execution');
      if (!Number.isSafeInteger(execution.exitCode)) {
        throw new Error('TypeScript subordinate settlement execution exitCode is invalid.');
      }
      requireActionDigest(String(execution.stdoutDigest), 'TypeScript subordinate stdout');
      requireActionDigest(String(execution.stderrDigest), 'TypeScript subordinate stderr');
      break;
    default:
      throw new Error('TypeScript subordinate settlement execution status is not terminal.');
  }

  const cleanup = stage('cleanup');
  switch (cleanup.status) {
    case 'physically-clean':
      exact(cleanup, ['status'], 'cleanup');
      break;
    case 'physical-residue':
      exact(cleanup, ['status', 'reason', 'errorName', 'message'], 'cleanup');
      reason(cleanup, ['generation-cleanup-failed', 'physical-cleanup-failed'], 'cleanup');
      error(cleanup, 'cleanup');
      break;
    default:
      throw new Error('TypeScript subordinate settlement cleanup status is not terminal.');
  }

  const readback = stage('readback');
  switch (readback.status) {
    case 'not-applied':
      exact(readback, ['status'], 'readback');
      break;
    case 'current':
      exact(readback, ['status', 'reason'], 'readback');
      reason(readback, ['immutable-execution-generation-current'], 'readback');
      break;
    case 'invalidated':
      exact(readback, ['status', 'reason', 'errorName', 'message'], 'readback');
      reason(readback, ['provider-or-cache-authority-drift'], 'readback');
      error(readback, 'readback');
      break;
    default:
      throw new Error('TypeScript subordinate settlement readback status is not terminal.');
  }
  return Object.freeze(record as TypecheckSubordinateSettlement);
}

type TypecheckSubordinateSettlementBlockKind =
  | 'terminal-missing'
  | 'subordinate-missing'
  | 'subordinate-corrupt'
  | 'cleanup-unsettled'
  | 'pass-phase-mismatch';

class TypecheckSubordinateSettlementBlockError extends Error {
  readonly kind: TypecheckSubordinateSettlementBlockKind;
  readonly status = 'blocked' as const;

  constructor(kind: TypecheckSubordinateSettlementBlockKind, message: string, cause?: unknown) {
    super(`TypeScript typecheck terminal blocked: ${message}`, { cause });
    this.name = 'TypecheckSubordinateSettlementBlockError';
    this.kind = kind;
  }
}

export function requireTypecheckSubordinateTerminal(
  outcome: Pick<
    VerificationActionRunOutcome,
    'disposition' | 'reason' | 'state' | 'subordinateSettlement' | 'terminal'
  >
): TypecheckSubordinateSettlement {
  const terminal: VerificationActionTerminal | null = outcome.terminal;
  if (terminal === null) {
    throw new TypecheckSubordinateSettlementBlockError(
      'terminal-missing',
      `generic Action outcome has no terminal; disposition=${outcome.disposition}; state=${outcome.state ?? 'none'}; reason=${outcome.reason ?? 'none'}.`
    );
  }
  if (outcome.subordinateSettlement === null) {
    throw new TypecheckSubordinateSettlementBlockError(
      'subordinate-missing',
      'persisted terminal has no producer-owned subordinate settlement.'
    );
  }
  let subordinate: TypecheckSubordinateSettlement;
  try {
    subordinate = projectTypecheckSubordinateSettlement(outcome.subordinateSettlement);
  } catch (error) {
    throw new TypecheckSubordinateSettlementBlockError(
      'subordinate-corrupt',
      'persisted subordinate settlement is not canonical.',
      error
    );
  }
  if (subordinate.cleanup.status !== 'physically-clean') {
    throw new TypecheckSubordinateSettlementBlockError(
      'cleanup-unsettled',
      'subordinate cleanup is not physically clean.'
    );
  }
  if (terminal.status === 'passed' && (
    subordinate.setup.status !== 'complete'
    || subordinate.execution.status !== 'exited'
    || subordinate.execution.exitCode !== 0
    || subordinate.readback.status !== 'current'
  )) {
    throw new TypecheckSubordinateSettlementBlockError(
      'pass-phase-mismatch',
      'PASS does not have complete setup, successful execution, physical cleanup and current readback.'
    );
  }
  return subordinate;
}

function requireActionDigest(value: string, label: string): VerificationActionKeyDigest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest before typecheck execution.`);
  }
  return value as VerificationActionKeyDigest;
}

function canonicalPathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function issueTypecheckOperationSettlement(
  operation: BoundSemanticOperation,
  input: Readonly<{
    action: VerificationActionKey;
    actionKey: VerificationActionKeyDigest;
    executionObservation: unknown;
    readback: unknown;
    readbackDisposition: DomainReadbackDisposition;
    status: VerificationResultStatus;
    reasonCode: VerificationReasonCode;
  }> & TypecheckTerminalProcessEvidence
): Promise<VerificationActionTerminalSettlement> {
  const checker = issueProviderSettlementReceipt(operation, {
    requirementId: TYPECHECK_REQUIREMENT.projectCheck,
    physicalDisposition: input.checkerDisposition,
    providerSettlementReferenceDigest: actionDigest({
      actionKey: input.actionKey,
      requirement: TYPECHECK_REQUIREMENT.projectCheck,
      executionObservation: input.executionObservation
    }) as OperationDigest
  });
  const diagnosticObjects = input.processOutput === null
    ? Object.freeze([])
    : await typecheckActionRunner.publishBoundProcessDiagnostics({
        repositoryRoot: compilerRoot,
        action: input.action,
        operation,
        processSettlement: checker,
        streams: [
          { stream: 'stdout', bytes: new TextEncoder().encode(input.processOutput.stdout) },
          { stream: 'stderr', bytes: new TextEncoder().encode(input.processOutput.stderr) }
        ]
      });
  const providerSettlements = [checker, issueProviderSettlementReceipt(operation, {
    requirementId: 'verification.action-diagnostics',
    physicalDisposition: diagnosticObjects.length === 0 ? 'not-started' : 'settled',
    providerSettlementReferenceDigest: actionDigest(
      diagnosticObjects.length === 0
        ? { status: 'not-started', operationAttempt: operation.boundAttemptDigest }
        : diagnosticObjects.map(({ receipt, readback }) => ({
            objectDigest: receipt.objectDigest,
            readbackDigest: readback.readbackDigest
          }))
    ) as OperationDigest
  })];
  const providerSettlementSet = compileProviderSettlementSet(operation, providerSettlements);
  const readback = issueNormalDomainReadbackReceipt(operation, providerSettlementSet, {
    readbackContractDigest: actionDigest({
      contract: 'typescript-project-check-readback',
      requirements: Object.values(TYPECHECK_REQUIREMENT)
    }) as OperationDigest,
    readbackReferenceDigest: actionDigest({
      actionKey: input.actionKey,
      readback: input.readback
    }) as OperationDigest,
    currentPhysicalEpochDigest: actionDigest({
      actionKey: input.actionKey,
      operationAttempt: operation.boundAttemptDigest,
      readback: input.readback
    }) as OperationDigest,
    disposition: input.readbackDisposition
  });
  const ownerTerminalJoin = issueNormalOwnerTerminalJoinReceipt(
    operation,
    providerSettlementSet,
    readback,
    {
      ownerTerminalContractDigest: actionDigest({
        contract: 'verification-action.typescript-project-check-terminal'
      }) as OperationDigest,
      ownerTerminalReferenceDigest: actionDigest({
        actionKey: input.actionKey,
        executionObservation: input.executionObservation,
        readbackReceiptDigest: readback.readbackReceiptDigest
      }) as OperationDigest
    }
  );
  const actionTerminalReceipt = issueVerificationActionOwnerTerminalReceipt({
    action: input.action,
    operation,
    providerSettlementSet,
    readback,
    ownerTerminalProjection: ownerTerminalJoin
  });
  if (input.processState !== 'not-started') {
    return issueProcessVerificationActionTerminalSettlement(actionTerminalReceipt, {
      status: input.status,
      reasonCode: input.reasonCode,
      diagnosticObjects
    });
  }
  return issueNonProcessVerificationActionTerminalSettlement(actionTerminalReceipt, {
    status: input.status,
    reasonCode: input.reasonCode
  });
}


type TypecheckProjectActionIdentity = Readonly<{
  projectInputDigest: `sha256:${string}`;
  projectConfigDigest: `sha256:${string}`;
  rootSourcePaths: readonly string[];
}>;

type TypecheckMaterializedProjectGeneration = Readonly<{
  evidence: TypeScriptProjectGenerationEvidence;
}>;

type TypecheckProjectGenerationSource = Readonly<{
  identity: TypecheckProjectActionIdentity;
  materialize(
    dependencyGeneration: RetainedTypeScriptCompilerDependencyGeneration
  ): TypecheckMaterializedProjectGeneration;
}>;

type TypecheckActionProviderIdentity = Readonly<{
  bindingDigest: VerificationActionKeyDigest;
  closure: readonly Readonly<{ path: string; digest: VerificationActionKeyDigest }>[];
}>;

function deferredTypecheckActionProviderIdentity(
  generationDigest: `sha256:${string}`
): TypecheckActionProviderIdentity {
  const selectionContractDigest = actionDigest({
    capability: 'typescript-project-typecheck',
    providerId: 'typescript-native-cli',
    packageAlias: '@typescript/native',
    packageName: 'typescript',
    platform: process.platform,
    architecture: process.arch,
    projectConfig: 'tsconfig.json',
    noEmit: true,
    incremental: true
  });
  return Object.freeze({
    bindingDigest: actionDigest({ generationDigest, selectionContractDigest }),
    closure: Object.freeze([
      { path: 'dependency/execution-generation', digest: generationDigest },
      { path: 'provider/selection-contract', digest: selectionContractDigest }
    ])
  });
}

function projectActionIdentityFromInput(
  projectInput: TypeScriptProjectInput
): TypecheckProjectActionIdentity {
  assertTypeScriptProjectInput(projectInput);
  const factIdentity = projectTypeScriptProjectFactIdentity(projectInput);
  return Object.freeze({
    projectInputDigest: requireActionDigest(
      factIdentity.projectFactDigest,
      'Typecheck Project fact identity'
    ),
    projectConfigDigest: requireActionDigest(
      factIdentity.projectConfigDigest,
      'Typecheck project configuration identity'
    ),
    rootSourcePaths: Object.freeze(factIdentity.rootSourceFacts.map(({ path: sourcePath }) => sourcePath))
  });
}

function projectActionIdentityFromFactIdentity(
  factIdentity: Readonly<{
    projectFactDigest: `sha256:${string}`;
    projectConfigDigest: `sha256:${string}`;
    rootSourceFacts: readonly Readonly<{ path: string }>[];
  }>
): TypecheckProjectActionIdentity {
  return Object.freeze({
    projectInputDigest: requireActionDigest(
      factIdentity.projectFactDigest,
      'Typecheck Project fact identity'
    ),
    projectConfigDigest: requireActionDigest(
      factIdentity.projectConfigDigest,
      'Typecheck project configuration identity'
    ),
    rootSourcePaths: Object.freeze(factIdentity.rootSourceFacts.map(({ path: sourcePath }) => sourcePath))
  });
}

function compileTypecheckActionInputFromIdentity(input: Readonly<{
  dependencies: TypecheckBuildDependencyIdentity;
  provider: TypecheckActionProviderIdentity;
  project: TypecheckProjectActionIdentity;
  diagnosticArguments: readonly string[];
  semanticOperation: BoundSemanticOperation;
}>): VerificationActionKeyInput {
  const dependencyAdmissionDigest = requireActionDigest(
    input.dependencies.identityDigest,
    'Typecheck dependency admission identity'
  );
  const projectConfigDigest = requireActionDigest(
    input.project.projectConfigDigest,
    'Typecheck project configuration identity'
  );
  const projectInputDigest = requireActionDigest(
    input.project.projectInputDigest,
    'Typecheck ProjectInput identity'
  );
  const provider = input.provider;
  const nodeModulesRootDigest = actionDigest({
    path: canonicalPathIdentity(input.dependencies.nodeModulesPath)
  });
  const runtimeDigest = actionDigest({
    toolchain: `bun@${Bun.version}`
  });
  const dependencyExecutionDigest = actionDigest({
    source: input.dependencies.source,
    requiresFreshProcess: input.dependencies.requiresFreshProcess
  });
  const diagnosticDigest = actionDigest({
    arguments: input.diagnosticArguments
  });
  const semanticDigest = input.semanticOperation.plan.identity.identityDigest;
  const executionPolicyDigest = actionDigest({
    checker: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY,
    generationSetup: TYPECHECK_MATERIALIZATION_POLICY,
    windowsReadOnlyTreeAdmission: WINDOWS_READ_ONLY_TREE_ADMISSION_POLICY
  });
  return Object.freeze({
    actionKind: TYPECHECK_ACTION_KIND,
    producer: Object.freeze({
      identity: 'development.typecheck',
      revision: projectInputDigest
    }),
    operation: Object.freeze({
      identity: 'development.typecheck.execute',
      revision: TYPECHECK_ACTION_CONTRACT,
      semanticDigest,
      workingDirectory: '.',
      declaredEnvironment: Object.freeze([
        { name: 'dependency-admission', digest: dependencyAdmissionDigest },
        { name: 'dependency-execution', digest: dependencyExecutionDigest },
        { name: 'diagnostic-arguments', digest: diagnosticDigest },
        { name: 'node-modules-root', digest: nodeModulesRootDigest },
        { name: 'repository-project-input', digest: projectInputDigest },
        { name: 'project-config', digest: projectConfigDigest },
        { name: 'semantic-operation-identity', digest: input.semanticOperation.plan.identity.identityDigest },
        { name: 'provider-binding', digest: provider.bindingDigest },
        { name: 'process-policy', digest: executionPolicyDigest },
        { name: 'toolchain-runtime', digest: runtimeDigest }
      ])
    }),
    inputClosure: Object.freeze([
      { path: 'dependency/admission', digest: dependencyAdmissionDigest },
      { path: 'repository/project-input', digest: projectInputDigest },
      ...provider.closure,
      { path: 'provider/process-policy', digest: executionPolicyDigest },
      { path: 'semantic/operation-identity', digest: input.semanticOperation.plan.identity.identityDigest },
      { path: 'tsconfig.json', digest: projectConfigDigest }
    ]),
    environment: Object.freeze({
      toolchainRevision: `bun@${Bun.version}`,
      providerRevision: provider.bindingDigest,
      contractRevision: TYPECHECK_ACTION_CONTRACT
    }),
    requiredCheapPreflightActionKeys: Object.freeze([]),
    upstreamActionKeys: Object.freeze([]),
    resultSchemaRevision: TYPECHECK_ACTION_RESULT
  });
}

export function compileTypecheckActionInput(input: Readonly<{
  dependencies: TypecheckBuildDependencyIdentity;
  dependencyGenerationDigest: `sha256:${string}`;
  projectInput: TypeScriptProjectInput;
  diagnosticArguments: readonly string[];
  semanticOperation: BoundSemanticOperation;
}>): VerificationActionKeyInput {
  return compileTypecheckActionInputFromIdentity({
    dependencies: input.dependencies,
    provider: deferredTypecheckActionProviderIdentity(input.dependencyGenerationDigest),
    project: projectActionIdentityFromInput(input.projectInput),
    diagnosticArguments: input.diagnosticArguments,
    semanticOperation: input.semanticOperation
  });
}

export function compileTypecheckSemanticOperation(input: Readonly<{
  projectConfigPath: string;
  diagnosticArguments: readonly string[];
  checker: InstalledTypeScriptNativeChecker;
  deadlineAtUnixMs: number;
}>): BoundSemanticOperation {
  assertTypeScriptNativeChecker(input.checker);
  const provider = input.checker.provider;
  if (input.projectConfigPath !== provider.projectConfig) {
    throw new Error('Typecheck semantic operation project config must come from the selected provider.');
  }
  return compileTypecheckSemanticOperationWithProviderIdentity({
    projectConfigPath: input.projectConfigPath,
    diagnosticArguments: input.diagnosticArguments,
    providerIdentityDigest: provider.toolchainBindingDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs
  });
}

function compileTypecheckSemanticOperationWithProviderIdentity(input: Readonly<{
  projectConfigPath: string;
  diagnosticArguments: readonly string[];
  providerIdentityDigest: VerificationActionKeyDigest;
  deadlineAtUnixMs: number;
}>): BoundSemanticOperation {
  const checkerContractDigest = actionDigest({
    operation: 'verification.typecheck',
    projectConfig: 'tsconfig.json',
    noEmit: true,
    incremental: true,
    immutableGeneration: true,
    actionPrivateAuxiliary: true,
    ownerIssuedProcessResourceSession: true,
    processResourceSessionReceipt: 'required-before-action-terminal-readback',
    physicalCleanTerminal: true,
    generationSetupPolicy: TYPECHECK_MATERIALIZATION_POLICY,
    checkerExecutionPolicy: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY,
    windowsReadOnlyTreeAdmissionPolicy: WINDOWS_READ_ONLY_TREE_ADMISSION_POLICY
  }) as OperationDigest;
  const diagnosticContractDigest = actionDigest({
    operation: 'verification.typecheck-process-diagnostics',
    streams: ['stderr', 'stdout']
  }) as OperationDigest;
  const decisionDigest = actionDigest({
    checkerContractDigest,
    diagnosticContractDigest
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: 'verification.typecheck',
    intentDigest: actionDigest({
      projectConfigPath: input.projectConfigPath,
      diagnosticProjection: input.diagnosticArguments
    }) as OperationDigest,
    decisionDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: decisionDigest
    }),
    aggregateBudgets: [
      {
        resource: 'duration-ms',
        maximum: TYPECHECK_OPERATION_DURATION_MS
      },
      {
        resource: 'input-bytes',
        maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
          + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes
      },
      {
        resource: 'output-bytes',
        maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
          + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes
      },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [
      {
        id: TYPECHECK_REQUIREMENT.projectCheck,
        contractDigest: checkerContractDigest,
        effectKinds: ['process'],
        failureKinds: [
          'provider.cancelled',
          'provider.deadline-exhausted',
          'provider.drift',
          'provider.execution-failed',
          'provider.unavailable',
          'provider.unverified'
        ]
      },
      {
        id: 'verification.action-diagnostics',
        contractDigest: diagnosticContractDigest,
        effectKinds: ['filesystem'],
        failureKinds: [
          'diagnostic.corrupt-object',
          'diagnostic.deadline-exhausted',
          'diagnostic.foreign-residue',
          'diagnostic.incomplete-object',
          'diagnostic.physical-replacement',
          'diagnostic.resource-exhausted'
        ]
      }
    ]
  });
  return bindSemanticOperation(plan, [
    compileCapabilityBinding({
      requirementId: TYPECHECK_REQUIREMENT.projectCheck,
      contractDigest: checkerContractDigest,
      providerIdentityDigest: input.providerIdentityDigest as OperationDigest
    }),
    compileCapabilityBinding({
      requirementId: 'verification.action-diagnostics',
      contractDigest: diagnosticContractDigest,
      providerIdentityDigest: actionDigest('runtime-state.process-diagnostics') as OperationDigest
    })
  ]);
}

export function resolveTypecheckBuildInfoPath(input: Readonly<{
  provider: TypeScriptNativeCheckerProvider;
  dependencyIdentityDigest: `sha256:${string}`;
  /** Every production cache identity must bind the exact admitted dependency root. */
  nodeModulesPath: string;
  projectConfigDigest: `sha256:${string}`;
  compilerRootPath?: string;
  cacheRoot?: string;
}>): string {
  const resolvedCompilerRoot = path.resolve(input.compilerRootPath ?? compilerRoot);
  const normalizedCompilerRoot = process.platform === 'win32'
    ? resolvedCompilerRoot.toLowerCase()
    : resolvedCompilerRoot;
  const derivedCacheRoot = path.resolve(input.cacheRoot ?? path.join(
    resolveRuntimeCacheRoot({
      platform: currentRuntimePlatform(),
      environment: runtimeStateEnvironment(),
      repositoryRoot: resolvedCompilerRoot
    }),
    'typecheck'
  ));
  const dependencyIdentityDigest = requireActionDigest(
    input.dependencyIdentityDigest,
    'Typecheck dependency admission identity'
  );
  const projectConfigDigest = requireActionDigest(
    input.projectConfigDigest,
    'Typecheck project configuration identity'
  );
  const cacheKey = sha256(Object.freeze({
    compilerRoot: normalizedCompilerRoot,
    dependencyIdentityDigest,
    dependencyRoot: canonicalPathIdentity(input.nodeModulesPath),
    projectConfigDigest,
    providerNativeExecutableDigest: input.provider.platformNativeExecutableDigest,
    providerManifestDigest: input.provider.packageManifestDigest,
    providerWrapperDigest: input.provider.wrapperDigest,
    providerBindingDigest: input.provider.toolchainBindingDigest,
    providerCapability: input.provider.capability,
    noEmit: input.provider.noEmit,
    incremental: input.provider.incremental,
    projectConfig: input.provider.projectConfig,
    runtimeRevision: `bun@${Bun.version}`
  })).slice(7);
  const buildInfoFile = path.join(
    derivedCacheRoot,
    cacheKey,
    'typescript-incremental-seed.json'
  );
  if (isPathInside(resolvedCompilerRoot, buildInfoFile)) {
    throw new Error('TypeCheck incremental seed cache must remain outside the compiler tree');
  }
  return buildInfoFile;
}

export type TypecheckBuildDependencyIdentity = Readonly<Pick<
  TypecheckDependencyAdmission,
  'nodeModulesPath' | 'requiresFreshProcess' | 'source'
> & { readonly identityDigest: `sha256:${string}` }>;

type MaterializedTypecheckBuildDependencyIdentity = TypecheckBuildDependencyIdentity & Readonly<Pick<
  TypecheckDependencyAdmission,
  'executionGenerationAuthority'
>>;

function materializedTypecheckDependencyIdentity(
  dependencies: TypecheckDependencyAdmission
): MaterializedTypecheckBuildDependencyIdentity {
  assertMaterializedOperationDependencyBootstrapResult(dependencies);
  return Object.freeze({
    executionGenerationAuthority: dependencies.executionGenerationAuthority,
    identityDigest: sha256(Object.freeze({
      kind: 'materialized-dependency-generation',
      manifestHash: dependencies.manifestHash,
      nodeModulesPath: canonicalPathIdentity(dependencies.nodeModulesPath),
      transitionDigest: dependencies.transitionDigest
    })) as `sha256:${string}`,
    nodeModulesPath: dependencies.nodeModulesPath,
    requiresFreshProcess: dependencies.requiresFreshProcess,
    source: dependencies.source
  });
}

async function executeObservedTypecheckWithProvider(
  dependencies: MaterializedTypecheckBuildDependencyIdentity,
  initialDependencyGeneration: RetainedTypeScriptCompilerDependencyGeneration | null,
  initialInstalled: InstalledTypeScriptNativeChecker | null,
  diagnosticArguments: readonly string[],
  operation: TypecheckOperationContext,
  projectGeneration: TypecheckProjectGenerationSource
): Promise<number> {
  const actionProviderIdentity = deferredTypecheckActionProviderIdentity(
    dependencies.executionGenerationAuthority.generationDigest
  );
  const semanticOperation = compileTypecheckSemanticOperationWithProviderIdentity({
    projectConfigPath: 'tsconfig.json',
    diagnosticArguments,
    providerIdentityDigest: actionProviderIdentity.bindingDigest,
    deadlineAtUnixMs: operation.deadlineAtUnixMs
  });
  const actionInput = compileTypecheckActionInputFromIdentity({
    dependencies,
    provider: actionProviderIdentity,
    project: projectGeneration.identity,
    diagnosticArguments,
    semanticOperation
  });
  const executionLifecycle: { generation: TypeScriptExecutionGeneration | null } = {
    generation: null
  };
  let dependencyGeneration = initialDependencyGeneration;
  let installed = initialInstalled;
  let dependencyGenerationTransferred = false;
  let outcome: Awaited<ReturnType<VerificationActionRunner['executeIdentity']>>;
  try {
    outcome = await typecheckActionRunner.executeIdentity({
    repositoryRoot: compilerRoot,
    actionInput,
    executionClass: 'cheap-preflight',
    executionDomain: 'local-typecheck',
    deadlineAtUnixMs: operation.deadlineAtUnixMs,
    ...(operation.signal === undefined ? {} : { signal: operation.signal }),
    executor: async ({ action, recordSubordinateSettlement }) => {
      const setupStartedAtMonotonicMs = performance.now();
      if (dependencyGeneration === null) {
        dependencyGeneration = await retainTypeScriptDependencyGeneration(
          dependencies.executionGenerationAuthority,
          operation
        );
      }
      if (dependencyGeneration.generationDigest
          !== dependencies.executionGenerationAuthority.generationDigest) {
        throw new Error('Typecheck executor retained a foreign dependency generation.');
      }
      if (installed === null) {
        installed = requireSelectedTypeScriptNativeChecker(
          await selectInstalledTypeScriptNativeChecker(
            dependencyGeneration.physicalGeneration.root.path,
            operation
          )
        );
      }
      const selectedChecker = installed;
      const provider = selectedChecker.provider;
      const buildInfoFile = resolveTypecheckBuildInfoPath({
        provider,
        dependencyIdentityDigest: dependencies.identityDigest,
        nodeModulesPath: dependencies.nodeModulesPath,
        projectConfigDigest: projectGeneration.identity.projectConfigDigest
      });
      operation.assertActive('Source Program ProjectInput materialization admission');
      reportDevExecutionProgress({
        command: 'typecheck', phase: 'source-project-materialization', state: 'start'
      });
      const materializedProjectGeneration = projectGeneration.materialize(dependencyGeneration);
      reportDevExecutionProgress({
        command: 'typecheck', phase: 'source-project-materialization', state: 'complete'
      });
      const projectGenerationEvidence = materializedProjectGeneration.evidence;
      assertTypeScriptProjectGenerationEvidence(projectGenerationEvidence);
      const projectInput = projectGenerationEvidence.projectInput;
      const materializedProjectIdentity = projectActionIdentityFromInput(projectInput);
      if (materializedProjectIdentity.projectInputDigest !== projectGeneration.identity.projectInputDigest
          || materializedProjectIdentity.projectConfigDigest !== projectGeneration.identity.projectConfigDigest) {
        const admittedPaths = new Set(projectGeneration.identity.rootSourcePaths);
        const materializedPaths = new Set(materializedProjectIdentity.rootSourcePaths);
        const missingPaths = materializedProjectIdentity.rootSourcePaths.filter((sourcePath) => (
          !admittedPaths.has(sourcePath)
        ));
        const extraPaths = projectGeneration.identity.rootSourcePaths.filter((sourcePath) => (
          !materializedPaths.has(sourcePath)
        ));
        throw new Error(
          `Typecheck materialized ProjectInput differs from its admitted fact identity: admitted=${
            projectGeneration.identity.projectInputDigest
          }; materialized=${materializedProjectIdentity.projectInputDigest}; sources=${
            projectInput.sourceFacts.length
          }; missing=${JSON.stringify(missingPaths.slice(0, 12))}; extra=${
            JSON.stringify(extraPaths.slice(0, 12))}.`
        );
      }
      const executionGenerationDigest = typeScriptExecutionGenerationDigest(projectGenerationEvidence);
      operation.assertActive('Source Program ProjectInput materialization settlement');
      const elapsedMs = (startedAtMonotonicMs: number): number => Math.max(
        0,
        Math.round(performance.now() - startedAtMonotonicMs)
      );
      let setupDurationMs: number | undefined;
      let executionDurationMs = 0;
      let cleanupDurationMs = 0;
      const domainBinding = Object.freeze({
        dependencyAdmission: dependencies.identityDigest,
        diagnosticArguments,
        projectConfig: projectInput.projectConfigDigest,
        projectInput: projectInput.projectInputDigest,
        workspaceSnapshotIdentity: projectInput.workspaceSnapshotIdentityDigest,
        providerBinding: provider.toolchainBindingDigest,
        semanticCapabilityBinding: semanticOperation.bindingSetIdentityDigest,
        semanticOperation: semanticOperation.plan.identity.identityDigest,
        semanticOperationAttempt: semanticOperation.boundAttemptDigest
      });
      const errorDigest = (error: unknown) => actionDigest({
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : typeof error
      });
      let processResourceReceipt: ProcessResourceSessionReceipt | null = null;
      const currentProcessResourceReceipt = (): ProcessResourceSessionReceipt | null => (
        processResourceReceipt
      );
      const settlement = async (
        processEvidence: TypecheckTerminalProcessEvidence,
        readbackDisposition: DomainReadbackDisposition,
        status: VerificationResultStatus,
        reasonCode: VerificationReasonCode,
        executionObservation: unknown,
        readback: unknown
      ) => await issueTypecheckOperationSettlement(semanticOperation, {
        action,
        actionKey: action.actionKey,
        ...processEvidence,
        executionObservation: Object.freeze({
          ...domainBinding,
          processResourceReceipt,
          observation: executionObservation
        }),
        readback,
        readbackDisposition,
        status,
        reasonCode
      });
      let setupStage: TypecheckSubordinateStage = Object.freeze({ status: 'pending' });
      let executionStage: TypecheckSubordinateStage = Object.freeze({ status: 'not-started' });
      let cleanupStage: TypecheckSubordinateStage = Object.freeze({ status: 'pending' });
      let readbackStage: TypecheckSubordinateStage = Object.freeze({ status: 'not-applied' });
      const finalSettlement = async (
        processEvidence: TypecheckTerminalProcessEvidence,
        readbackDisposition: DomainReadbackDisposition,
        status: VerificationResultStatus,
        reasonCode: VerificationReasonCode,
        executionObservation: unknown,
        readback: unknown
      ): Promise<VerificationActionTerminalSettlement> => {
        const withDuration = (
          stage: TypecheckSubordinateStage,
          durationMs: number
        ): TypecheckSubordinateStage => Object.freeze({ ...stage, durationMs });
        recordSubordinateSettlement(encodeTypecheckSubordinateSettlement(Object.freeze({
          setup: withDuration(
            setupStage,
            setupDurationMs ?? elapsedMs(setupStartedAtMonotonicMs)
          ),
          execution: withDuration(executionStage, executionDurationMs),
          cleanup: withDuration(cleanupStage, cleanupDurationMs),
          readback: readbackStage
        })));
        return await settlement(
          processEvidence,
          readbackDisposition,
          status,
          reasonCode,
          executionObservation,
          readback
        );
      };
      let cacheAuthority: ReturnType<typeof acquireRuntimeCachePhysicalAuthority> | null = null;
      const postReadback = async () => {
        try {
          operation.assertActive('readback admission');
          cacheAuthority?.assertCurrent();
          if (executionLifecycle.generation === null) {
            throw new Error('TypeScript immutable execution generation was not issued');
          }
          await executionLifecycle.generation.assertCurrent();
          operation.assertActive('readback settlement');
        } catch (error) {
          const readback = Object.freeze({
            status: 'invalidated' as const,
            reason: 'provider-or-cache-authority-drift',
            errorDigest: errorDigest(error)
          });
          readbackStage = Object.freeze({
            ...subordinateError(error),
            status: 'invalidated',
            reason: readback.reason
          });
          return readback;
        }
        const readback = Object.freeze({
          status: 'current' as const,
          reason: 'immutable-execution-generation-current',
          observationDigest: projectInput.observationDigest,
          generationDigest: executionGenerationDigest
        });
        readbackStage = Object.freeze({ status: 'current', reason: readback.reason });
        return readback;
      };
      let incrementalState: Awaited<ReturnType<typeof prepareTypeScriptIncrementalState>>;
      let setupPhase: string | null = null;
      const startSetupPhase = (phase: string): void => {
        setupPhase = phase;
        reportDevExecutionProgress({ command: 'typecheck', phase, state: 'start' });
      };
      const finishSetupPhase = (): void => {
        if (setupPhase === null) return;
        reportDevExecutionProgress({ command: 'typecheck', phase: setupPhase, state: 'complete' });
        setupPhase = null;
      };
      try {
        operation.assertActive('runtime cache admission');
        const cacheRoot = path.join(resolveRuntimeCacheRoot({
          platform: currentRuntimePlatform(),
          environment: runtimeStateEnvironment(),
          repositoryRoot: compilerRoot
        }), 'typecheck');
        const generationParentPath = path.join(cacheRoot, 'execution-generations');
        const auxiliaryParentPath = path.join(cacheRoot, 'action-auxiliaries');
        startSetupPhase('cache-authority');
        cacheAuthority = acquireRuntimeCachePhysicalAuthority({
          repositoryRoot: compilerRoot,
          cacheRoot,
          requiredDirectories: [
            path.dirname(buildInfoFile),
            generationParentPath,
            auxiliaryParentPath
          ]
        });
        cacheAuthority.assertCurrent();
        operation.assertActive('runtime cache readback');
        finishSetupPhase();
        dependencyGenerationTransferred = true;
        startSetupPhase('execution-generation');
        executionLifecycle.generation = await materializeTypeScriptExecutionGeneration(
          projectGenerationEvidence,
          {
            deadlineAtUnixMs: operation.deadlineAtUnixMs,
            dependencyGeneration,
            dependencyLocatorPath: dependencies.nodeModulesPath,
            generationParent: cacheAuthority.directory(generationParentPath),
            signal: operation.signal
          }
        );
        assertTypeScriptExecutionGeneration(executionLifecycle.generation);
        if (executionLifecycle.generation.generationDigest !== executionGenerationDigest) {
          throw new Error('TypeScript execution generation identity differs from its Action input');
        }
        await executionLifecycle.generation.assertCurrent();
        finishSetupPhase();
        startSetupPhase('incremental-seed');
        incrementalState = await prepareTypeScriptIncrementalState({
          actionPrivateParent: cacheAuthority.directory(auxiliaryParentPath),
          deadlineAtUnixMs: operation.deadlineAtUnixMs,
          seedBindingDigest: actionDigest({
            stableSeed: canonicalPathIdentity(buildInfoFile)
          }),
          stableSeedFile: buildInfoFile,
          signal: operation.signal,
          stableSeedParent: cacheAuthority.directory(path.dirname(buildInfoFile))
        });
        finishSetupPhase();
      } catch (error) {
        if (setupPhase !== null) {
          reportDevExecutionProgress({ command: 'typecheck', phase: setupPhase, state: 'failed' });
          setupPhase = null;
        }
        setupDurationMs = elapsedMs(setupStartedAtMonotonicMs);
        const cleanupStartedAtMonotonicMs = performance.now();
        let generationCleanup: unknown = null;
        let cleanupFailure: Readonly<{ error: unknown }> | undefined;
        if (executionLifecycle.generation !== null) {
          try {
            generationCleanup = await executionLifecycle.generation.retire();
          } catch (cleanupError) {
            cleanupFailure = Object.freeze({ error: cleanupError });
          }
        }
        cleanupDurationMs = elapsedMs(cleanupStartedAtMonotonicMs);
        if (cleanupFailure !== undefined) {
          setupStage = Object.freeze({
            ...subordinateError(error),
            reason: 'setup-failed'
          });
          cleanupStage = Object.freeze({
            ...subordinateError(cleanupFailure.error),
            status: 'physical-residue',
            reason: 'generation-cleanup-failed'
          });
          return finalSettlement(
            notStartedTypecheckProcessEvidence(),
            'unknown',
            'failed',
            'cleanup-failed',
            Object.freeze({
              status: 'setup-cleanup-failed',
              setupErrorDigest: errorDigest(error),
              cleanupErrorDigest: errorDigest(cleanupFailure.error)
            }),
            Object.freeze({ status: 'physical-residue', generationCleanup })
          );
        }
        setupStage = Object.freeze({
          ...subordinateError(error),
          reason: 'setup-failed'
        });
        cleanupStage = Object.freeze({ status: 'physically-clean' });
        return finalSettlement(
          notStartedTypecheckProcessEvidence(),
          'not-applied',
          'failed',
          'process-settlement-failed',
          Object.freeze({
            status: 'setup-failed',
            errorDigest: errorDigest(error)
          }),
          Object.freeze({ status: 'physically-clean', generationCleanup })
        );
      }
      const executionGeneration = executionLifecycle.generation;
      if (executionGeneration === null) {
        throw new Error('TypeScript immutable execution generation setup returned without a capability');
      }
      setupDurationMs = elapsedMs(setupStartedAtMonotonicMs);
      setupStage = Object.freeze({ status: 'complete' });
      let settledProcessOutput: Readonly<{ stdout: string; stderr: string }> | null = null;

      const executeAndObserve = async (): Promise<PendingTypecheckTerminal> => {
        const processSession = openProcessResourceSession({
          operation: semanticOperation,
          requirementBindingContext: issueOperationRequirementBindingContext({
            operation: semanticOperation,
            requirementId: TYPECHECK_REQUIREMENT.projectCheck,
            resourceCeilings: [
              {
                resource: 'duration-ms',
                maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
              },
              { resource: 'input-bytes', maximum: 0 },
              {
                resource: 'output-bytes',
                maximum: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
                  + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes
              },
              { resource: 'processes', maximum: 1 }
            ]
          }),
          signal: operation.signal
        });
        let processExecutionAdmission: ReturnType<
          typeof issueTypeScriptCheckerProcessExecutionAdmission
        >;
        try {
          processExecutionAdmission = issueTypeScriptCheckerProcessExecutionAdmission({
            checker: selectedChecker,
            operation: semanticOperation,
            processSession
          });
        } catch (error) {
          processSession.close();
          throw error;
        }
        let execution: Awaited<ReturnType<typeof executeTypeScriptNativeChecker>> | undefined;
        let executionError: unknown;
        let hasExecutionError = false;
        let processSettlementError: unknown;
        const executionStartedAtMonotonicMs = performance.now();
        try {
          execution = await executeTypeScriptNativeChecker(selectedChecker, {
            args: diagnosticArguments,
            auxiliaryDirectory: incrementalState.auxiliaryDirectory,
            buildInfoFileName: incrementalState.buildInfoFileName,
            deadlineAtUnixMs: semanticOperation.plan.attempt.deadlineAtUnixMs,
            dependencyDirectory: executionGeneration.dependencyDirectory,
            forwardOutput: true,
            processExecutionAdmission,
            signal: operation.signal,
            workingDirectory: executionGeneration.workingDirectory
          });
        } catch (error) {
          executionError = error;
          hasExecutionError = true;
        } finally {
          try {
            const receipt = processSession.close();
            assertTypecheckProcessResourceReceipt(receipt, semanticOperation, execution);
            processResourceReceipt = receipt;
          } catch (error) {
            processSettlementError = error;
          }
          executionDurationMs = elapsedMs(executionStartedAtMonotonicMs);
        }
        if (processSettlementError !== undefined) {
          if (hasExecutionError) {
            throw new AggregateError(
              [executionError, processSettlementError],
              'TypeScript checker execution and process-resource settlement both failed.'
            );
          }
          throw processSettlementError;
        }
        if (hasExecutionError) {
          const error = executionError;
          const executionFailure = subordinateError(error);
          executionStage = Object.freeze({
            ...executionFailure,
            reason: 'execution-unsettled'
          });
          settledProcessOutput = Object.freeze({
            stdout: '',
            stderr: `${executionFailure.errorName ?? 'Error'}: ${executionFailure.message ?? 'TypeScript checker execution failed'}\n`
          });
          const readback = await postReadback();
          const terminalCore = Object.freeze({
            readbackDisposition: 'not-applied' as const,
            status: 'failed' as const,
            reasonCode: 'process-settlement-failed' as const,
            executionObservation: Object.freeze({
              status: 'execution-unsettled',
              errorDigest: errorDigest(error)
            }),
            readback
          });
          return processResourceReceipt!.processCount === 0
            ? pendingNotStartedTypecheckTerminal(terminalCore)
            : pendingSettledTypecheckTerminal({
                ...terminalCore,
                processOutput: settledProcessOutput
              });
        }
        if (execution === undefined) {
          throw new Error('TypeScript checker execution returned without a terminal result.');
        }
        if (execution.status === 'unverified') {
          executionStage = Object.freeze({
            status: 'unverified',
            reason: execution.reason,
            message: boundedDiagnosticText(execution.detail, 240)
          });
          const checkerBinding = semanticOperation.bindings.find(({ requirementId }) => (
            requirementId === TYPECHECK_REQUIREMENT.projectCheck
          ));
          if (checkerBinding === undefined) {
            throw new Error('Typecheck semantic operation lost its checker capability binding.');
          }
          const diagnostic = projectCapabilityDiagnostic({
            bindingDigest: checkerBinding.bindingDigest,
            code: 'typescript.provider-unverified',
            failureKind: `provider.${execution.reason}`,
            rawEvidence: execution.detail
          });
          const readback = await postReadback();
          const terminal = readback.status === 'invalidated'
            ? { status: 'invalidated', reasonCode: 'input-invalidated' } as const
            : execution.reason === 'deadline-exhausted'
              ? { status: 'failed', reasonCode: 'timeout' } as const
              : execution.reason === 'cancelled'
                ? { status: 'invalidated', reasonCode: 'cancelled' } as const
                : execution.reason === 'process-boundary-unavailable'
                  ? { status: 'unsupported', reasonCode: 'capability-unsupported' } as const
                  : { status: 'invalidated', reasonCode: 'input-invalidated' } as const;
          const terminalCore = Object.freeze({
            readbackDisposition: 'not-applied' as const,
            status: terminal.status,
            reasonCode: terminal.reasonCode,
            executionObservation: Object.freeze({
              status: 'unverified',
              reason: execution.reason,
              detailDigest: actionDigest(execution.detail),
              diagnostic
            }),
            readback
          });
          if (processResourceReceipt!.processCount === 0) {
            settledProcessOutput = null;
            return pendingNotStartedTypecheckTerminal(terminalCore);
          }
          const processOutput = Object.freeze({
            stdout: '',
            stderr: `${execution.detail}\n`
          });
          settledProcessOutput = processOutput;
          return pendingSettledTypecheckTerminal({
            ...terminalCore,
            processOutput
          });
        }
        settledProcessOutput = Object.freeze({
          stdout: execution.stdout,
          stderr: execution.stderr
        });
        const incrementalPublication = await incrementalState.publish().catch(() => (
          Object.freeze({ status: 'cache-unavailable' as const })
        ));
        executionStage = Object.freeze({
          status: 'exited',
          exitCode: execution.code,
          stdoutDigest: actionDigest(execution.stdout),
          stderrDigest: actionDigest(execution.stderr)
        });
        const readback = await postReadback();
        if (readback.status === 'invalidated') {
          return pendingSettledTypecheckTerminal({
            readbackDisposition: 'applied',
            status: 'invalidated',
            reasonCode: 'input-invalidated',
            executionObservation: Object.freeze({
              status: 'exited',
              exitCode: execution.code,
              incrementalPublication,
              stdoutDigest: actionDigest(execution.stdout),
              stderrDigest: actionDigest(execution.stderr)
            }),
            readback,
            processOutput: settledProcessOutput
          });
        }
        return pendingSettledTypecheckTerminal({
          readbackDisposition: 'applied',
          status: execution.code === 0 ? 'passed' : 'failed',
          reasonCode: execution.code === 0 ? 'executed-success' : 'executed-failure',
          executionObservation: Object.freeze({
            status: 'exited',
            exitCode: execution.code,
            incrementalPublication,
            stdoutDigest: actionDigest(execution.stdout),
            stderrDigest: actionDigest(execution.stderr)
          }),
          readback,
          processOutput: settledProcessOutput
        });
      };

      let pending: PendingTypecheckTerminal | null = null;
      let executionOrSettlementFailure: Readonly<{ error: unknown }> | undefined;
      try {
        pending = await executeAndObserve();
      } catch (error) {
        executionOrSettlementFailure = Object.freeze({ error });
        executionStage = Object.freeze({
          ...subordinateError(error),
          reason: 'unexpected-settlement-failure'
        });
        settledProcessOutput ??= Object.freeze({
          stdout: '',
          stderr: `${error instanceof Error ? error.name : typeof error}: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        });
      }
      let auxiliaryCleanup: unknown = null;
      let generationCleanup: unknown = null;
      const cleanupFailures: unknown[] = [];
      const cleanupStartedAtMonotonicMs = performance.now();
      reportDevExecutionProgress({ command: 'typecheck', phase: 'physical-cleanup', state: 'start' });
      try {
        auxiliaryCleanup = await incrementalState.dispose();
      } catch (error) {
        cleanupFailures.push(error);
      }
      try {
        generationCleanup = await executionGeneration.retire();
      } catch (error) {
        cleanupFailures.push(error);
      }
      const cleanupFailure = cleanupFailures.length === 0
        ? undefined
        : cleanupFailures.length === 1
          ? cleanupFailures[0]
          : new AggregateError(cleanupFailures, 'Typecheck physical cleanup had multiple failures.');
      cleanupDurationMs = elapsedMs(cleanupStartedAtMonotonicMs);
      reportDevExecutionProgress({
        command: 'typecheck', phase: 'physical-cleanup',
        state: cleanupFailure === undefined ? 'complete' : 'failed'
      });
      const terminalProcessResourceReceipt = currentProcessResourceReceipt();
      const terminalProcessEvidence = (failure: unknown): TypecheckTerminalProcessEvidence => {
        const observedOutput = pending === null
          ? settledProcessOutput
          : pending.processOutput;
        if (terminalProcessResourceReceipt?.processCount === 0) {
          return notStartedTypecheckProcessEvidence();
        }
        const processOutput = observedOutput ?? Object.freeze({
          stdout: '',
          stderr: `${failure instanceof Error ? failure.name : typeof failure}: ${
            failure instanceof Error ? failure.message : String(failure)
          }\n`
        });
        return terminalProcessResourceReceipt === null
          ? unknownTypecheckProcessEvidence(processOutput)
          : settledTypecheckProcessEvidence(processOutput);
      };
      if (cleanupFailure !== undefined) {
        cleanupStage = Object.freeze({
          ...subordinateError(cleanupFailure),
          status: 'physical-residue',
          reason: 'physical-cleanup-failed'
        });
        return finalSettlement(
          terminalProcessEvidence(cleanupFailure),
          'unknown',
          'failed',
          'cleanup-failed',
          Object.freeze({
            status: 'physical-cleanup-failed',
            errorDigest: errorDigest(cleanupFailure),
            execution: pending?.executionObservation ?? null,
            executionFailureDigest: executionOrSettlementFailure === undefined
              ? null
              : errorDigest(executionOrSettlementFailure.error)
          }),
          Object.freeze({
            status: 'physical-residue',
            operationReadback: pending?.readback ?? null,
            auxiliaryCleanup,
            generationCleanup
          })
        );
      }
      cleanupStage = Object.freeze({ status: 'physically-clean' });
      if (executionOrSettlementFailure !== undefined || pending === null) {
        const failure = executionOrSettlementFailure?.error ?? new Error(
          'TypeScript execution completed without a pending terminal observation.'
        );
        return finalSettlement(
          terminalProcessEvidence(failure),
          'unknown',
          'failed',
          'process-settlement-failed',
          Object.freeze({
            status: 'execution-or-settlement-failed',
            errorDigest: errorDigest(failure)
          }),
          Object.freeze({
            status: 'physically-clean',
            auxiliaryCleanup,
            generationCleanup
          })
        );
      }
      return finalSettlement(
        pending,
        pending.readbackDisposition,
        pending.status,
        pending.reasonCode,
        Object.freeze({
          status: 'physically-clean-terminal',
          execution: pending.executionObservation
        }),
        Object.freeze({
          status: 'physically-clean',
          operationReadback: pending.readback,
          auxiliaryCleanup,
          generationCleanup
        })
      );
      }
    });
  } finally {
    if (executionLifecycle.generation !== null) {
      await executionLifecycle.generation.retire();
    } else if (!dependencyGenerationTransferred && dependencyGeneration !== null) {
      await dependencyGeneration.retire();
    }
  }
  let subordinate: TypecheckSubordinateSettlement;
  try {
    subordinate = requireTypecheckSubordinateTerminal(outcome);
  } catch (error) {
    if (error instanceof TypecheckSubordinateSettlementBlockError) {
      process.stderr.write(`${error.message} [${error.kind}]\n`);
    }
    throw error;
  }
  if (outcome.terminal!.status !== 'passed') {
    process.stderr.write(
      `TypeScript typecheck subordinate settlement: ${encodeTypecheckSubordinateSettlement(subordinate)}\n`
    );
  }
  if (outcome.terminal!.status === 'passed') return 0;
  if (outcome.terminal!.status === 'failed') return 1;
  throw new Error(
    `TypeScript typecheck action did not produce a passed terminal: ${
      outcome.reason ?? outcome.terminal?.reasonCode ?? 'unresolved'
    }`
  );
}

async function executeTypecheckWithProjectGeneration(
  dependencies: MaterializedTypecheckBuildDependencyIdentity,
  dependencyGeneration: RetainedTypeScriptCompilerDependencyGeneration | null,
  installed: InstalledTypeScriptNativeChecker | null,
  projectGenerationEvidence: TypeScriptProjectGenerationEvidence,
  args: string[],
  operation: TypecheckOperationContext
): Promise<number> {
  operation.assertActive('project generation admission');
  if (installed !== null) assertTypeScriptNativeChecker(installed);
  assertTypeScriptProjectGenerationEvidence(projectGenerationEvidence);
  return executeObservedTypecheckWithProvider(
    dependencies,
    dependencyGeneration,
    installed,
    canonicalTypeScriptDiagnosticArguments(args),
    operation,
    Object.freeze({
      identity: projectActionIdentityFromInput(projectGenerationEvidence.projectInput),
      materialize: () => Object.freeze({
        evidence: projectGenerationEvidence
      })
    })
  );
}

async function executeTypecheckWithProvider(
  dependencies: MaterializedTypecheckBuildDependencyIdentity,
  installed: InstalledTypeScriptNativeChecker,
  args: string[],
  operation: TypecheckOperationContext
): Promise<number> {
  // Reject structural/test/provider substitutions and caller-owned checking
  // semantics before Git discovery, cache, or command Effects.
  assertTypeScriptNativeChecker(installed);
  canonicalTypeScriptDiagnosticArguments(args);
  operation.assertActive('Source Program observation admission');
  return executeTypecheckWithRetainedProvider(
    dependencies,
    null,
    installed,
    args,
    operation
  );
}

async function executeTypecheckWithRetainedProvider(
  dependencies: MaterializedTypecheckBuildDependencyIdentity,
  initialDependencyGeneration: RetainedTypeScriptCompilerDependencyGeneration | null,
  initialInstalled: InstalledTypeScriptNativeChecker | null,
  args: string[],
  operation: TypecheckOperationContext
): Promise<number> {
  if (initialInstalled !== null) assertTypeScriptNativeChecker(initialInstalled);
  canonicalTypeScriptDiagnosticArguments(args);
  operation.assertActive('retained Source Program observation admission');
  const projectConfigPath = 'tsconfig.json';
  let transferred = false;
  try {
    return await withAuthorityGitReadSession({
      cwd: compilerRoot,
      deadlineAtUnixMs: operation.deadlineAtUnixMs,
      budget: Object.freeze({
        ...GIT_READ_OPERATION_BUDGET,
        deadlineMs: Math.min(
          GIT_READ_OPERATION_BUDGET.deadlineMs,
          operation.remainingMs('Git read admission')
        )
      }),
      signal: operation.signal
    }, async (session) => {
      const snapshot = await observeExecutionProgressPhase(
        'typecheck', 'workspace-source-snapshot',
        () => acquireWorkingTreeSnapshot({ session })
      );
      operation.assertActive('Source Program snapshot readback');
      const projectFactIdentity = await observeExecutionProgressPhase(
        'typecheck', 'project-fact-identity',
        () => compileTypeScriptProjectFactIdentity(
          snapshot,
          projectConfigPath,
          {
            dependencyGenerationDigest:
              dependencies.executionGenerationAuthority.generationDigest
          }
        )
      );
      operation.assertActive('Source Program fact identity settlement');
      const projectGeneration = Object.freeze({
        identity: projectActionIdentityFromFactIdentity(projectFactIdentity),
        materialize: (
          retainedGeneration: RetainedTypeScriptCompilerDependencyGeneration
        ): TypecheckMaterializedProjectGeneration => {
          if (retainedGeneration.generationDigest
              !== dependencies.executionGenerationAuthority.generationDigest) {
            throw new Error('Typecheck ProjectInput retained a foreign dependency generation.');
          }
          operation.assertActive('Source Program ProjectInput admission');
          const projectInput = compileTypeScriptProjectInput(
            snapshot,
            projectConfigPath,
            {
              dependencyGeneration: retainedGeneration.physicalGeneration,
              dependencyGenerationDigest: retainedGeneration.generationDigest
            }
          );
          operation.assertActive('Source Program ProjectInput compilation settlement');
          return Object.freeze({
            evidence: issueTypeScriptProjectGenerationEvidence(snapshot, projectInput)
          });
        }
      });
      transferred = true;
      return executeObservedTypecheckWithProvider(
        dependencies,
        initialDependencyGeneration,
        initialInstalled,
        canonicalTypeScriptDiagnosticArguments(args),
        operation,
        projectGeneration
      );
    });
  } finally {
    if (!transferred && initialDependencyGeneration !== null) {
      await initialDependencyGeneration.retire();
    }
  }
}

/**
 * Canonical CLI path. The opaque dependency generation identity participates
 * in ProjectInput and Action admission; physical retention and checker
 * selection occur only inside the winning VerificationAction executor.
 */
export async function runTypecheckWithDependencyAuthority(
  dependencies: TypecheckDependencyAdmission,
  args: string[] = [],
  options: TypecheckOperationOptions = {}
): Promise<number> {
  canonicalTypeScriptDiagnosticArguments(args);
  const operation = issueTypecheckOperationContext(options);
  return executeTypecheckWithRetainedProvider(
    materializedTypecheckDependencyIdentity(dependencies),
    null,
    null,
    args,
    operation
  );
}

/**
 * Orchestration seam for Source Program evidence already admitted by its
 * canonical owner. The runner materializes that evidence into one private,
 * writer-excluded execution generation before checker Effects.
 */
export async function runTypecheckWithProjectGenerationEvidence(
  dependencies: TypecheckDependencyAdmission,
  installed: InstalledTypeScriptNativeChecker,
  projectGeneration: TypeScriptProjectGenerationEvidence,
  args: string[] = [],
  options: TypecheckOperationOptions = {}
): Promise<number> {
  assertTypeScriptProjectGenerationEvidence(projectGeneration);
  canonicalTypeScriptDiagnosticArguments(args);
  const operation = issueTypecheckOperationContext(options);
  const dependencyIdentity = materializedTypecheckDependencyIdentity(dependencies);
  return executeTypecheckWithProjectGeneration(
    dependencyIdentity,
    null,
    installed,
    projectGeneration,
    args,
    operation
  );
}

export async function runTypecheckWithProvider(
  dependencies: TypecheckDependencyAdmission,
  installed: InstalledTypeScriptNativeChecker,
  args: string[] = [],
  options: TypecheckOperationOptions = {}
): Promise<number> {
  assertTypeScriptNativeChecker(installed);
  canonicalTypeScriptDiagnosticArguments(args);
  const operation = issueTypecheckOperationContext(options);
  return executeTypecheckWithProvider(
    materializedTypecheckDependencyIdentity(dependencies),
    installed,
    args,
    operation
  );
}

export async function runTypecheckWithDependencyRoot(
  dependencies: TypecheckDependencyAdmission,
  args: string[] = [],
  options: TypecheckOperationOptions = {}
): Promise<number> {
  canonicalTypeScriptDiagnosticArguments(args);
  const operation = issueTypecheckOperationContext(options);
  return executeTypecheckWithRetainedProvider(
    materializedTypecheckDependencyIdentity(dependencies),
    null,
    null,
    args,
    operation
  );
}
