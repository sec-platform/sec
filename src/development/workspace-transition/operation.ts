import { withAuthorityGitReadSession } from '../../external-capabilities/git-read/authority.ts';
import type { GitReadSession, GitReadSessionCommand } from '../../external-capabilities/git-read/runtime/session.ts';
import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  ensureCompilerDepsReady,
  observeCompilerDependencyExecutionGenerationAuthority,
  observeCompilerDependencyMaterializationInput,
  type CompilerDepsReadyState
} from '../../toolchain/dependencies/runtime.ts';
import {
  WORKSPACE_TRANSITION_DEADLINE_ENV,
  type ParseWorkspaceTransitionTriggerInput
} from './contract.ts';
import { compileWorkspaceTransitionPlan } from './plan.ts';
import { parseWorkspaceTransitionTrigger } from './trigger.ts';

const WORKSPACE_TRANSITION_DURATION_MS = 300_000;
const WORKSPACE_TRANSITION_GIT_BUDGET = Object.freeze({
  maxProcesses: 32,
  maxStdoutBytes: 256 * 1024,
  maxStderrBytes: 256 * 1024,
  maxRecords: 256,
  maxCommandStdoutBytes: 16 * 1024,
  maxCommandStderrBytes: 16 * 1024
});

function operationDeadlineAtUnixMs(): number {
  const inherited = process.env[WORKSPACE_TRANSITION_DEADLINE_ENV];
  if (inherited === undefined) return Date.now() + WORKSPACE_TRANSITION_DURATION_MS;
  const deadline = Number(inherited);
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) {
    throw new Error('Workspace transition inherited deadline is invalid or exhausted.');
  }
  return deadline;
}

function remainingMs(deadlineAtUnixMs: number): number {
  const remaining = deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(remaining) || remaining < 1) {
    throw new Error('Workspace transition deadline is exhausted.');
  }
  return remaining;
}

function completedText(command: GitReadSessionCommand, label: string): string {
  if (command.kind !== 'completed' || command.result.code !== 0) {
    throw new Error(`Workspace transition ${label} observation is unresolved.`);
  }
  const value = new TextDecoder('utf-8', { fatal: true }).decode(command.result.stdout).trim();
  if (value.length === 0) throw new Error(`Workspace transition ${label} observation is empty.`);
  return value;
}

async function withShortGitSession<T>(
  repositoryRoot: string,
  deadlineAtUnixMs: number,
  callback: (session: GitReadSession) => Promise<T>
): Promise<T> {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: {
      ...WORKSPACE_TRANSITION_GIT_BUDGET,
      deadlineMs: remainingMs(deadlineAtUnixMs)
    }
  }, callback);
}

async function observeRepository(session: GitReadSession): Promise<Readonly<{
  currentHead: string;
  objectIdLength: 40 | 64;
  worktreeIdentityDigest: `sha256:${string}`;
}>> {
  const format = completedText(await session.run(['rev-parse', '--show-object-format']), 'object format');
  const currentHead = completedText(
    await session.run(['rev-parse', '--verify', 'HEAD^{commit}']), 'current head'
  );
  const objectIdLength = format === 'sha1' ? 40 : format === 'sha256' ? 64 : null;
  if (objectIdLength === null) throw new Error('Workspace transition Git object format is unsupported.');
  return Object.freeze({
    currentHead,
    objectIdLength,
    worktreeIdentityDigest: sha256({
      cwd: session.cwd,
      providerIdentity: session.providerIdentity,
      workingDirectoryIdentity: session.workingDirectoryIdentity
    }) as `sha256:${string}`
  });
}

export type WorkspaceTransitionHandoff = (
  dependencies: CompilerDepsReadyState,
  standardInput: Uint8Array | undefined,
  deadlineAtUnixMs: number
) => Promise<number | null>;

async function observeHooks(
  repositoryRoot: string,
  deadlineAtUnixMs: number
): Promise<Readonly<{ disposition: 'ready' | 'materialization-required'; observationDigest: `sha256:${string}` }>> {
  const { observeManagedGitHooksWithSession } = await import('../hooks/install.ts');
  return withShortGitSession(repositoryRoot, deadlineAtUnixMs, (session) =>
    observeManagedGitHooksWithSession({ repoRoot: repositoryRoot, session }));
}

async function materializeHooks(repositoryRoot: string, deadlineAtUnixMs: number): Promise<void> {
  const { installGitHooksWithSession } = await import('../hooks/install.ts');
  const result = await withShortGitSession(repositoryRoot, deadlineAtUnixMs, (session) =>
    installGitHooksWithSession({ repoRoot: repositoryRoot, lifecycle: true, session }));
  if (result.status === 'conflict') throw new Error(result.message);
}

export async function runWorkspaceTransitionOperation(input: Readonly<{
  readonly event: ParseWorkspaceTransitionTriggerInput['event'];
  readonly arguments: readonly string[];
  readonly standardInput?: Uint8Array;
  readonly repositoryRoot: string;
  readonly handoff: WorkspaceTransitionHandoff;
}>): Promise<number> {
  const deadlineAtUnixMs = operationDeadlineAtUnixMs();
  const repository = await withShortGitSession(
    input.repositoryRoot, deadlineAtUnixMs, observeRepository
  );
  const trigger = parseWorkspaceTransitionTrigger({
    event: input.event,
    arguments: input.arguments,
    standardInput: input.standardInput,
    currentHead: repository.currentHead,
    objectIdLength: repository.objectIdLength
  });
  const dependencyAuthority = await observeCompilerDependencyExecutionGenerationAuthority({
    deadlineAtUnixMs
  });
  const dependencyInput = await observeCompilerDependencyMaterializationInput();
  if (dependencyAuthority === null) {
    const deferredHookObservationDigest = sha256({
      owner: 'development.hooks', state: 'dependency-not-ready'
    }) as `sha256:${string}`;
    const dependencyPlan = compileWorkspaceTransitionPlan({
      trigger,
      worktreeIdentityDigest: repository.worktreeIdentityDigest,
      dependency: {
        disposition: 'materialization-required',
        observationDigest: sha256(dependencyInput) as `sha256:${string}`
      },
      hooks: {
        disposition: 'deferred',
        observationDigest: deferredHookObservationDigest
      }
    });
    if (!dependencyPlan.requiredEffects.includes('compiler-dependency-tree.materialize')) return 1;
    const dependencies = await ensureCompilerDepsReady({ deadlineAtUnixMs });
    const handoffExitCode = await input.handoff(
      dependencies, input.standardInput, deadlineAtUnixMs
    );
    if (handoffExitCode !== null) return handoffExitCode;
  }

  const hookObservation = await observeHooks(input.repositoryRoot, deadlineAtUnixMs);
  const readyDependencyAuthority = dependencyAuthority
    ?? await observeCompilerDependencyExecutionGenerationAuthority({ deadlineAtUnixMs });
  if (readyDependencyAuthority === null) {
    throw new Error('Workspace transition dependency readback is not ready.');
  }
  const plan = compileWorkspaceTransitionPlan({
    trigger,
    worktreeIdentityDigest: repository.worktreeIdentityDigest,
    dependency: {
      disposition: 'ready',
      observationDigest: sha256(readyDependencyAuthority) as `sha256:${string}`
    },
    hooks: hookObservation
  });
  if (plan.decision === 'blocked') return 1;
  if (plan.requiredEffects.includes('managed-git-hooks.materialize')) {
    await materializeHooks(input.repositoryRoot, deadlineAtUnixMs);
  }
  const finalHooks = await observeHooks(input.repositoryRoot, deadlineAtUnixMs);
  if (finalHooks.disposition !== 'ready') {
    throw new Error('Workspace transition managed Git hook readback is not ready.');
  }
  const finalHead = await withShortGitSession(input.repositoryRoot, deadlineAtUnixMs, async (session) =>
    completedText(await session.run(['rev-parse', '--verify', 'HEAD^{commit}']), 'final head'));
  const expectedHead = trigger.event === 'post-checkout' ? trigger.newHead : trigger.currentHead;
  if (finalHead !== expectedHead) throw new Error('Workspace transition head changed before readback.');
  return 0;
}
