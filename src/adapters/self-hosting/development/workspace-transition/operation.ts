import { snapshotByteView } from '../../../../contracts/byte-snapshot.ts';
import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { isNativeAborted, linkNativeAbortSignals } from '../../../../contracts/native-abort.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { withOwnedByteStreamReader } from '../../../../execution/stream-reader.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../../providers/git-read/runtime/budget.ts';
import type {
  GitReadSession,
  GitReadSessionCommand
} from '../../../providers/git-read/runtime/session.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  observeCompilerDependencyExecutionGenerationAuthority,
  observeCompilerDependencyMaterializationInput,
  type CompilerDepsReadyState
} from '../../../toolchain/dependencies/runtime.ts';
import {
  WORKSPACE_TRANSITION_DEADLINE_ENV,
  WorkspaceTransitionContractError,
  type ParseWorkspaceTransitionTriggerInput
} from './contract.ts';
import { compileWorkspaceTransitionPlan } from './plan.ts';
import {
  assertWorkspaceTransitionEvent,
  parseWorkspaceTransitionTrigger,
  WORKSPACE_TRANSITION_REWRITE_MAXIMUM_BYTES
} from './trigger.ts';

const WORKSPACE_TRANSITION_DURATION_MS = 300_000;
const WORKSPACE_TRANSITION_PROCESS_REQUIREMENT = 'workspace-transition.process';
const WORKSPACE_TRANSITION_PROCESS_CONTRACT = sha256({
  owner: 'development.workspace-transition',
  operation: 'runWorkspaceTransitionOperation',
  processBoundary: 'one-parent-process-resource-session-v1'
}) as OperationDigest;
const WORKSPACE_TRANSITION_PROCESS_PROVIDER = sha256({
  owner: 'runtime-state.physical',
  provider: 'process-resource-session'
}) as OperationDigest;
const WORKSPACE_TRANSITION_INPUT_BYTES = WORKSPACE_TRANSITION_REWRITE_MAXIMUM_BYTES;
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
}>): BoundSemanticOperation {
  const plan = compileSemanticOperationPlan({
    operation: 'development.workspace-transition',
    intentDigest: sha256({
      event: input.event,
      arguments: input.arguments,
      standardInputDigest: rawSha256(input.standardInput ?? new Uint8Array()),
      repositoryRoot: input.repositoryRoot
    }) as OperationDigest,
    decisionDigest: WORKSPACE_TRANSITION_PROCESS_CONTRACT,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
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
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: WORKSPACE_TRANSITION_PROCESS_REQUIREMENT,
    contractDigest: WORKSPACE_TRANSITION_PROCESS_CONTRACT,
    providerIdentityDigest: WORKSPACE_TRANSITION_PROCESS_PROVIDER
  })]);
}

async function withWorkspaceGitSession<T>(
  repositoryRoot: string,
  deadlineAtUnixMs: number,
  operation: BoundSemanticOperation,
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
  operation: BoundSemanticOperation,
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

type WorkspaceTransitionInputSource =
  | Readonly<{ standardInput?: Uint8Array; standardInputStream?: never }>
  | Readonly<{ standardInput?: never; standardInputStream?: ReadableStream<Uint8Array> }>;

/** Bound collection before parsing, not after an unbounded stdin.bytes().
 * One private payload buffer avoids unbounded per-chunk metadata. The source
 * owns any native prefetch allocation. Cancellation is cooperative: the reader
 * owner still waits for cancellation/read settlement before releasing its lock.
 */
async function captureWorkspaceTransitionInputStream(
  stream: ReadableStream<Uint8Array>,
  deadlineAtUnixMs: number,
  parentSignal: AbortSignal | undefined
): Promise<Uint8Array> {
  const deadline = new AbortController();
  const signal = linkNativeAbortSignals(parentSignal, deadline.signal);
  return withAcquiredResource({
    operationLabel: 'workspace-transition-input',
    resourceLabel: 'workspace-transition-input-deadline',
    acquire: () => {
      let active = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observeDeadline = (): void => {
        if (!active) return;
        const remaining = deadlineAtUnixMs - Date.now();
        if (remaining <= 0) {
          deadline.abort(budgetError('Workspace transition input deadline is exhausted.'));
        } else {
          // Rearm long inherited windows without narrowing their deadline or
          // asking a native timer to represent an unbounded delay.
          timer = setTimeout(observeDeadline, Math.min(remaining, WORKSPACE_TRANSITION_DURATION_MS));
        }
      };
      observeDeadline();
      return () => {
        active = false;
        if (timer !== undefined) clearTimeout(timer);
      };
    },
    use: () => withOwnedByteStreamReader(stream, async read => {
      const storage = Buffer.alloc(WORKSPACE_TRANSITION_INPUT_BYTES);
      let retained = 0;
      for (;;) {
        remainingMs(deadlineAtUnixMs);
        const next = await read();
        remainingMs(deadlineAtUnixMs);
        if (next.done) return Buffer.from(storage.subarray(0, retained));
        let chunk: Uint8Array;
        try {
          chunk = snapshotByteView(
            next.value, 'Workspace transition input chunk',
            WORKSPACE_TRANSITION_INPUT_BYTES - retained
          );
        } catch (error) {
          throw new WorkspaceTransitionContractError(
            error instanceof RangeError
              ? 'workspace-transition-rewrite-input-limit-exceeded'
              : 'workspace-transition-rewrite-input-invalid',
            'Workspace transition stream cannot form a bounded private byte snapshot.'
          );
        }
        storage.set(chunk, retained);
        retained += chunk.byteLength;
      }
    }, signal),
    release: closeDeadline => { closeDeadline(); }
  });
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
  readonly repositoryRoot: string;
  readonly handoff: WorkspaceTransitionHandoff;
  readonly signal?: AbortSignal;
}> & WorkspaceTransitionInputSource): Promise<number> {
  const signal = input.signal;
  const deadlineAtUnixMs = operationDeadlineAtUnixMs();
  if (isNativeAborted(signal)) {
    throw budgetError('Workspace transition was cancelled before provider admission.');
  }
  const {
    event, arguments: suppliedArguments, standardInput: suppliedStandardInput,
    standardInputStream, repositoryRoot
  } = input;
  assertWorkspaceTransitionEvent(event);
  if (standardInputStream !== undefined &&
      (event !== 'post-rewrite' || suppliedStandardInput !== undefined)) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-argument-invalid',
      'Only post-rewrite accepts one input stream, without a second byte input.'
    );
  }
  // Git's supported object IDs have at most 64 characters; every other
  // supported positional operand (flags and rewrite command) is shorter.
  const count = Array.isArray(suppliedArguments) ? suppliedArguments.length : -1;
  if (!Number.isSafeInteger(count) || count < 0 || count > 3) {
    throw new WorkspaceTransitionContractError(
      'workspace-transition-argument-invalid', 'Workspace transition arguments are not bounded array data.'
    );
  }
  const capturedArguments: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(suppliedArguments, index);
    if (slot === undefined || !('value' in slot) || typeof slot.value !== 'string' || slot.value.length > 64) {
      throw new WorkspaceTransitionContractError(
        'workspace-transition-argument-invalid', 'Workspace transition arguments must be bounded dense own string slots.'
      );
    }
    capturedArguments.push(slot.value);
  }
  Object.freeze(capturedArguments);
  let standardInput: Uint8Array | undefined;
  if (suppliedStandardInput !== undefined) {
    try {
      standardInput = snapshotByteView(
        suppliedStandardInput, 'Workspace transition input', WORKSPACE_TRANSITION_INPUT_BYTES
      );
    } catch (error) {
      throw new WorkspaceTransitionContractError(
        error instanceof RangeError
          ? 'workspace-transition-rewrite-input-limit-exceeded'
          : 'workspace-transition-rewrite-input-invalid',
        'Workspace transition input cannot form a bounded private byte snapshot.'
      );
    }
  }
  if (standardInputStream !== undefined) {
    standardInput = await captureWorkspaceTransitionInputStream(
      standardInputStream, deadlineAtUnixMs, signal
    );
  }
  // Both the operation identity and the later trigger consume these same
  // captured values. Handoff and other unrelated fields are not evaluated.
  const operation = compileWorkspaceTransitionOperation({
    event, arguments: capturedArguments, standardInput, repositoryRoot, deadlineAtUnixMs
  });
  return withAcquiredResource({
    operationLabel: 'workspace-transition',
    resourceLabel: 'workspace-transition-process-session',
    acquire: () => openProcessResourceSession({
      operation,
      requirementBindingContext: issueOperationRequirementBindingContext({
        operation,
        requirementId: WORKSPACE_TRANSITION_PROCESS_REQUIREMENT,
        resourceCeilings: operation.plan.execution.aggregateBudgets
      }),
      signal
    }),
    use: processSession => withWorkspaceGitSession(
      repositoryRoot,
      deadlineAtUnixMs,
      operation,
      processSession,
      async (session) => {
        const repository = await observeRepository(session);
        const trigger = parseWorkspaceTransitionTrigger({
          event,
          arguments: capturedArguments,
          standardInput,
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
        const hookObservation = await observeHooks(repositoryRoot, session);
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
            repoRoot: repositoryRoot,
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
        const finalHooks = await observeHooks(repositoryRoot, session);
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
    ),
    release(processSession) {
      assertProcessResourceSessionReceipt(processSession.close(), {
        operationIdentityDigest: operation.plan.identity.identityDigest,
        boundAttemptDigest: operation.boundAttemptDigest,
        requirementId: WORKSPACE_TRANSITION_PROCESS_REQUIREMENT
      });
    }
  });
}
