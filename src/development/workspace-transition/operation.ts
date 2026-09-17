import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../external-capabilities/git-read/runtime/budget.ts';
import type {
  GitReadSession,
  GitReadSessionCommand
} from '../../external-capabilities/git-read/runtime/session.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import { rawSha256, sha256 } from '../../contracts/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../system-architecture/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import {
  observeCompilerDependencyExecutionGenerationAuthority,
  observeCompilerDependencyMaterializationInput,
  type CompilerDepsReadyState
} from '../../toolchain/dependencies/runtime.ts';
import {
  WORKSPACE_TRANSITION_DEADLINE_ENV,
  WorkspaceTransitionContractError,
  type ParseWorkspaceTransitionTriggerInput
} from './contract.ts';
import { compileWorkspaceTransitionPlan } from './plan.ts';
import { parseWorkspaceTransitionTrigger } from './trigger.ts';

const WORKSPACE_TRANSITION_DURATION_MS = 300_000;
const WORKSPACE_TRANSITION_PROCESS_REQUIREMENT = 'workspace-transition.process';
const WORKSPACE_TRANSITION_PROCESS_CONTRACT = sha256({
  owner: 'development.workspace-transition',
  operation: 'runWorkspaceTransitionOperation',
  processBoundary: 'one-parent-process-resource-session-v1'
}) as SecOperationDigest;
const WORKSPACE_TRANSITION_PROCESS_PROVIDER = sha256({
  owner: 'runtime-state.physical',
  provider: 'process-resource-session'
}) as SecOperationDigest;
const WORKSPACE_TRANSITION_INPUT_BYTES = 1024 * 1024;
const WORKSPACE_TRANSITION_OUTPUT_BYTES = 512 * 1024;
const WORKSPACE_TRANSITION_PROCESSES = 32;
const WORKSPACE_TRANSITION_GIT_BUDGET = Object.freeze({
  maxProcesses: 32,
  maxStdoutBytes: 256 * 1024,
  maxStderrBytes: 256 * 1024,
  maxRecords: 256,
  maxCommandStdoutBytes: 16 * 1024,
  maxCommandStderrBytes: 16 * 1024
});

type RepositoryObservation = Readonly<{
  currentHead: string;
  currentTree: string;
  objectIdLength: 40 | 64;
  repositoryRoot: string;
  gitDirectory: string;
  gitCommonDirectory: string;
  worktreeIdentityDigest: `sha256:${string}`;
}>;

function budgetError(message: string): WorkspaceTransitionContractError {
  return new WorkspaceTransitionContractError(
    'workspace-transition-operation-budget-exhausted',
    message
  );
}

function operationDeadlineAtUnixMs(): number {
  const inherited = process.env[WORKSPACE_TRANSITION_DEADLINE_ENV];
  if (inherited === undefined) return Date.now() + WORKSPACE_TRANSITION_DURATION_MS;
  const deadline = Number(inherited);
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) {
    throw budgetError('Workspace transition inherited deadline is invalid or exhausted.');
  }
  return deadline;
}

function remainingMs(deadlineAtUnixMs: number): number {
  const remaining = deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(remaining) || remaining < 1) {
    throw budgetError('Workspace transition deadline is exhausted.');
  }
  return remaining;
}

function completedText(command: GitReadSessionCommand, label: string): string {
  if (command.kind !== 'completed' || command.result.code !== 0) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-observation-unresolved',
      `Workspace transition ${label} observation is unresolved.`
    );
  }
  const value = new TextDecoder('utf-8', { fatal: true }).decode(command.result.stdout).trim();
  if (value.length === 0) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-observation-unresolved',
      `Workspace transition ${label} observation is empty.`
    );
  }
  return value;
}

function compileWorkspaceTransitionOperation(input: Readonly<{
  event: ParseWorkspaceTransitionTriggerInput['event'];
  arguments: readonly string[];
  standardInput?: Uint8Array;
  repositoryRoot: string;
  deadlineAtUnixMs: number;
}>): SecBoundSemanticOperation {
  const plan = compileSecSemanticOperationPlan({
    operation: 'development.workspace-transition',
    intentDigest: sha256({
      event: input.event,
      arguments: input.arguments,
      standardInputDigest: rawSha256(input.standardInput ?? new Uint8Array()),
      repositoryRoot: input.repositoryRoot
    }) as SecOperationDigest,
    decisionDigest: WORKSPACE_TRANSITION_PROCESS_CONTRACT,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: WORKSPACE_TRANSITION_PROCESS_CONTRACT
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: remainingMs(input.deadlineAtUnixMs) },
      { resource: 'input-bytes', maximum: WORKSPACE_TRANSITION_INPUT_BYTES },
      { resource: 'output-bytes', maximum: WORKSPACE_TRANSITION_OUTPUT_BYTES },
      { resource: 'processes', maximum: WORKSPACE_TRANSITION_PROCESSES }
    ],
    requirements: [{
      id: WORKSPACE_TRANSITION_PROCESS_REQUIREMENT,
      contractDigest: WORKSPACE_TRANSITION_PROCESS_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'provider.cancelled',
        'provider.deadline-exhausted',
        'provider.execution-failed',
        'provider.unavailable'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: WORKSPACE_TRANSITION_PROCESS_REQUIREMENT,
    contractDigest: WORKSPACE_TRANSITION_PROCESS_CONTRACT,
    providerIdentityDigest: WORKSPACE_TRANSITION_PROCESS_PROVIDER
  })]);
}

async function withWorkspaceGitSession<T>(
  repositoryRoot: string,
  deadlineAtUnixMs: number,
  operation: SecBoundSemanticOperation,
  processSession: ProcessResourceSession,
  callback: (session: GitReadSession) => Promise<T>
): Promise<T> {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    operation,
    processSession,
    budget: {
      ...WORKSPACE_TRANSITION_GIT_BUDGET,
      deadlineMs: Math.min(
        remainingMs(deadlineAtUnixMs),
        GIT_READ_EXACT_TREE_OPERATION_BUDGET.deadlineMs
      )
    }
  }, callback);
}

async function observeRepository(session: GitReadSession): Promise<RepositoryObservation> {
  const format = completedText(
    await session.run(['rev-parse', '--show-object-format']),
    'object format'
  );
  const currentHead = completedText(
    await session.run(['rev-parse', '--verify', 'HEAD^{commit}']),
    'current head'
  );
  const currentTree = completedText(
    await session.run(['rev-parse', '--verify', 'HEAD^{tree}']),
    'current tree'
  );
  const repositoryRoot = completedText(
    await session.run(['rev-parse', '--show-toplevel']),
    'repository root'
  );
  const gitDirectory = completedText(
    await session.run(['rev-parse', '--absolute-git-dir']),
    'Git directory'
  );
  const gitCommonDirectory = completedText(
    await session.run(['rev-parse', '--git-common-dir']),
    'Git common directory'
  );
  const objectIdLength = format === 'sha1' ? 40 : format === 'sha256' ? 64 : null;
  if (objectIdLength === null) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-observation-unresolved',
      'Workspace transition Git object format is unsupported.'
    );
  }
  return Object.freeze({
    currentHead,
    currentTree,
    objectIdLength,
    repositoryRoot,
    gitDirectory,
    gitCommonDirectory,
    worktreeIdentityDigest: sha256({
      cwd: session.cwd,
      providerIdentity: session.providerIdentity,
      workingDirectoryIdentity: session.workingDirectoryIdentity,
      repositoryRoot,
      gitDirectory,
      gitCommonDirectory
    }) as `sha256:${string}`
  });
}

function assertSameRepository(
  initial: RepositoryObservation,
  final: RepositoryObservation,
  expectedHead: string
): void {
  if (final.currentHead !== expectedHead
      || final.currentTree !== initial.currentTree
      || final.objectIdLength !== initial.objectIdLength
      || final.repositoryRoot !== initial.repositoryRoot
      || final.gitDirectory !== initial.gitDirectory
      || final.gitCommonDirectory !== initial.gitCommonDirectory
      || final.worktreeIdentityDigest !== initial.worktreeIdentityDigest) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-observation-unresolved',
      'Workspace transition repository identity changed before final readback.'
    );
  }
}

export type WorkspaceTransitionHandoff = (
  dependencies: CompilerDepsReadyState,
  standardInput: Uint8Array | undefined,
  deadlineAtUnixMs: number,
  operation: SecBoundSemanticOperation,
  processSession: ProcessResourceSession
) => Promise<number | null>;

async function observeHooks(
  repositoryRoot: string,
  session: GitReadSession
): Promise<Readonly<{
  disposition: 'ready' | 'materialization-required';
  observationDigest: `sha256:${string}`;
}>> {
  const { observeManagedGitHooksWithSession } = await import('../hooks/install.ts');
  return await observeManagedGitHooksWithSession({ repoRoot: repositoryRoot, session });
}

/**
 * Re-observable workspace-transition orchestration.
 *
 * Dependency and hook owners retain their own state and issue the observations
 * consumed here. The ready path completes beneath one parent process ledger;
 * Nested Effects accept this exact operation and borrowed session or remain
 * typed unavailable instead of opening independent windows.
 */
export async function runWorkspaceTransitionOperation(input: Readonly<{
  readonly event: ParseWorkspaceTransitionTriggerInput['event'];
  readonly arguments: readonly string[];
  readonly standardInput?: Uint8Array;
  readonly repositoryRoot: string;
  readonly handoff: WorkspaceTransitionHandoff;
  readonly signal?: AbortSignal;
}>): Promise<number> {
  const deadlineAtUnixMs = operationDeadlineAtUnixMs();
  if (input.signal?.aborted === true) {
    throw budgetError('Workspace transition was cancelled before provider admission.');
  }
  const operation = compileWorkspaceTransitionOperation({ ...input, deadlineAtUnixMs });
  const processSession = openProcessResourceSession({
    operation,
    requirementBindingContext: issueSecOperationRequirementBindingContext({
      operation,
      requirementId: WORKSPACE_TRANSITION_PROCESS_REQUIREMENT,
      resourceCeilings: operation.plan.execution.aggregateBudgets
    }),
    signal: input.signal
  });
  let result: number | undefined;
  let primaryError: unknown;
  try {
    result = await withWorkspaceGitSession(
      input.repositoryRoot,
      deadlineAtUnixMs,
      operation,
      processSession,
      async (session) => {
        const repository = await observeRepository(session);
        const trigger = parseWorkspaceTransitionTrigger({
          event: input.event,
          arguments: input.arguments,
          standardInput: input.standardInput,
          currentHead: repository.currentHead,
          objectIdLength: repository.objectIdLength
        });
        // Git also emits post-checkout for path restores. Like an ordinary
        // file edit, that does not transition the workspace revision or admit
        // dependency/hook installation. Their actual consumers retain admission.
        if (trigger.event === 'post-checkout' && trigger.checkoutKind === 'paths') {
          const finalRepository = await observeRepository(session);
          assertSameRepository(repository, finalRepository, trigger.newHead);
          return 0;
        }
        const dependencyAuthority = await observeCompilerDependencyExecutionGenerationAuthority({
          deadlineAtUnixMs
        });
        if (dependencyAuthority === null) {
          await observeCompilerDependencyMaterializationInput();
          throw new WorkspaceTransitionContractError(
            'workspace-transition-provider-integration-unavailable',
            'Compiler dependency materialization has not adopted the parent process session.'
          );
        }
        const hookObservation = await observeHooks(input.repositoryRoot, session);
        const dependencyObservationDigest = sha256(dependencyAuthority) as `sha256:${string}`;
        const plan = compileWorkspaceTransitionPlan({
          trigger,
          worktreeIdentityDigest: repository.worktreeIdentityDigest,
          dependency: {
            disposition: 'ready',
            observationDigest: dependencyObservationDigest
          },
          hooks: hookObservation
        });
        if (plan.decision === 'blocked') return 1;
        if (plan.requiredEffects.includes('managed-git-hooks.materialize')) {
          const { installGitHooksWithSession } = await import('../hooks/install.ts');
          const materialization = await installGitHooksWithSession({
            repoRoot: input.repositoryRoot,
            session,
            operation,
            processSession
          });
          if (materialization.status === 'conflict') {
            throw new WorkspaceTransitionContractError(
              'workspace-transition-observation-unresolved',
              'Managed Git hook materialization ended in conflict.'
            );
          }
        }
        const finalHooks = await observeHooks(input.repositoryRoot, session);
        const finalDependencyAuthority = await observeCompilerDependencyExecutionGenerationAuthority({
          deadlineAtUnixMs
        });
        if (finalHooks.disposition !== 'ready'
            || finalDependencyAuthority === null
            || sha256(finalDependencyAuthority) !== dependencyObservationDigest) {
          throw new WorkspaceTransitionContractError(
            'workspace-transition-observation-unresolved',
            'Workspace transition owner readback changed before completion.'
          );
        }
        const finalRepository = await observeRepository(session);
        const expectedHead = trigger.event === 'post-checkout' ? trigger.newHead : trigger.currentHead;
        assertSameRepository(repository, finalRepository, expectedHead);
        return 0;
      }
    );
  } catch (error) {
    primaryError = error;
  }
  try {
    const receipt = processSession.close();
    assertProcessResourceSessionReceipt(receipt, {
      operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      requirementId: WORKSPACE_TRANSITION_PROCESS_REQUIREMENT
    });
  } catch (error) {
    primaryError ??= error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-observation-unresolved',
      'Workspace transition completed without a terminal result.'
    );
  }
  return result;
}
