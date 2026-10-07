import { rawSha256 } from '../../../../contracts/canonical.ts';
import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import { createAuthorityGitReadSession, type GitReadSession, type GitReadSessionCommand } from '../../../providers/git-read/runtime/session.ts';
import type { ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import type { AffectedGitSelectionObservation } from '../../../verification/platform/test-impact/runtime/affected-git-source.ts';
import { gitWorkingTreeStatusArgs } from '../../../verification/platform/test-impact/runtime/transition.ts';
import { compilerRoot } from '../../../workspace-context.ts';
import { AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING, compileAffectedTestSelectionSemanticOperation } from './affected-plan-contract.ts';

export function exactRevision(stdout: Uint8Array): string | null {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(stdout).trim();
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

type GitSelectionGitObservation = AffectedGitSelectionObservation;

export function completedGitCommand(
  command: GitReadSessionCommand
): Extract<GitReadSessionCommand, { kind: 'completed' }>['result'] | null {
  return command.kind === 'completed' ? command.result : null;
}

export async function observeGitSelectionState(
  session: GitReadSession,
  baseSha: string | null,
  worktreeBytes?: Uint8Array,
  indexBytes?: Uint8Array,
  knownHeadSha?: string
): Promise<GitSelectionGitObservation | null> {
  if (session.providerIdentity === null) return null;
  let headSha = knownHeadSha;
  if (headSha === undefined) {
    const headResult = completedGitCommand(await session.run([
      '--no-pager',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false',
      'rev-parse', '--verify', 'HEAD^{commit}'
    ]));
    if (headResult === null || headResult.code !== 0) return null;
    headSha = exactRevision(headResult.stdout) ?? undefined;
    if (headSha === undefined) return null;
  }

  let observedWorktree = worktreeBytes;
  if (observedWorktree === undefined) {
    const status = completedGitCommand(await session.run(gitWorkingTreeStatusArgs()));
    if (status === null || status.code !== 0) return null;
    observedWorktree = status.stdout;
  }
  let observedIndex = indexBytes;
  if (observedIndex === undefined) {
    const index = completedGitCommand(await session.run([
      '--no-pager',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false',
      'ls-files', '--stage', '-z'
    ]));
    if (index === null || index.code !== 0) return null;
    observedIndex = index.stdout;
  }
  // The executable is part of the same read observation. Re-check it after
  // the Git children complete so a replacement during status/index reads can
  // never become the provider identity of this snapshot.
  if (!(session.verifyWorkingDirectory?.() ?? true)) return null;
  if (!session.verifyExecutable()) return null;
  return Object.freeze({
    baseSha,
    headSha,
    indexDigest: rawSha256(observedIndex),
    worktreeDigest: rawSha256(observedWorktree),
    gitExecutable: session.gitExecutable,
    gitExecutableIdentity: session.gitExecutableIdentity,
    gitProviderRoute: session.providerRoute,
    gitProviderIdentity: session.providerIdentity
  });
}

type AffectedGitRevalidationLedger = {
  readonly operation: BoundSemanticOperation;
  readonly processSession?: ProcessResourceSession;
  /** Absolute parent wall deadline shared by every revalidation session. */
  readonly deadlineAt: number;
  readonly maxProcesses: number;
  readonly maxTotalArgumentBytes: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
  readonly maxRecords: number;
  readonly maxRootObservedBytes: number;
  readonly maxReopenRefreshes: number;
  readonly maxSettlementAttempts: number;
  readonly maxExecutableBytes: number;
  revalidationCount: number;
  processCount: number;
  argumentBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  recordCount: number;
  rootObservedBytes: number;
  reopenRefreshes: number;
  settlementAttempts: number;
  executableBytes: number;
};

export function createAffectedGitRevalidationLedger(deadlineAtUnixMs?: number): AffectedGitRevalidationLedger {
  const operation = compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected', deadlineAtUnixMs });
  return {
    operation,
    deadlineAt: operation.plan.attempt.deadlineAtUnixMs,
    ...AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING,
    revalidationCount: 0,
    processCount: 0,
    argumentBytes: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    recordCount: 0,
    rootObservedBytes: 0,
    reopenRefreshes: 0,
    settlementAttempts: 0,
    executableBytes: 0
  };
}

function accountAffectedGitRevalidationSession(
  ledger: AffectedGitRevalidationLedger,
  session: GitReadSession
): boolean {
  if (ledger.processSession === undefined) ledger.processCount += session.processCount;
  else ledger.processCount = ledger.processSession.processCount;
  ledger.argumentBytes += session.argumentBytes ?? 0;
  ledger.stdoutBytes += session.stdoutBytes;
  ledger.stderrBytes += session.stderrBytes;
  ledger.recordCount += session.recordCount;
  ledger.rootObservedBytes += session.rootObservedBytes ?? 0;
  ledger.reopenRefreshes += session.reopenRefreshes ?? 0;
  ledger.settlementAttempts += session.settlementAttempts ?? 0;
  ledger.executableBytes += session.executableBytes
    ?? (session.gitExecutableIdentity?.size ?? 0) * 2;
  return ledger.processCount <= ledger.maxProcesses
    && ledger.argumentBytes <= ledger.maxTotalArgumentBytes
    && ledger.stdoutBytes <= ledger.maxStdoutBytes
    && ledger.stderrBytes <= ledger.maxStderrBytes
    && ledger.recordCount <= ledger.maxRecords
    && ledger.rootObservedBytes <= ledger.maxRootObservedBytes
    && ledger.reopenRefreshes <= ledger.maxReopenRefreshes
    && ledger.settlementAttempts <= ledger.maxSettlementAttempts
    && ledger.executableBytes <= ledger.maxExecutableBytes;
}

export async function reobserveAffectedGitSelectionState(
  expected: GitSelectionGitObservation,
  ledger: AffectedGitRevalidationLedger
): Promise<GitSelectionGitObservation | null> {
  if (ledger.revalidationCount >= 8) return null;
  const remainingDeadlineMs = ledger.deadlineAt - Date.now();
  if (remainingDeadlineMs < 1) return null;
  const processRemaining = ledger.maxProcesses - ledger.processCount;
  const argumentRemaining = ledger.maxTotalArgumentBytes - ledger.argumentBytes;
  const stdoutRemaining = ledger.maxStdoutBytes - ledger.stdoutBytes;
  const stderrRemaining = ledger.maxStderrBytes - ledger.stderrBytes;
  const recordRemaining = ledger.maxRecords - ledger.recordCount;
  const rootRemaining = ledger.maxRootObservedBytes - ledger.rootObservedBytes;
  const reopenRemaining = ledger.maxReopenRefreshes - ledger.reopenRefreshes;
  const settlementRemaining = ledger.maxSettlementAttempts - ledger.settlementAttempts;
  const executableRemaining = ledger.maxExecutableBytes - ledger.executableBytes;
  if (processRemaining < 1 || argumentRemaining < 1 || stdoutRemaining < 1
      || stderrRemaining < 1 || recordRemaining < 1 || rootRemaining < 1
      || reopenRemaining < 1 || settlementRemaining < 1 || executableRemaining < 1) return null;
  ledger.revalidationCount += 1;
  const resolution = createAuthorityGitReadSession({
    cwd: compilerRoot,
    operation: ledger.operation,
    ...(ledger.processSession === undefined ? {} : { processSession: ledger.processSession }),
    budget: {
      // Each fresh provider session consumes the same parent absolute
      // deadline. The relative value only narrows the transport request; it
      // is never permission to reset the owner-issued operation window.
      deadlineMs: Math.min(5_000, remainingDeadlineMs),
      maxProcesses: Math.min(128, processRemaining),
      maxTotalArgumentBytes: Math.min(16 * 1024 * 1024, argumentRemaining),
      maxStdoutBytes: Math.min(64 * 1024 * 1024, stdoutRemaining),
      maxStderrBytes: Math.min(2 * 1024 * 1024, stderrRemaining),
      maxRecords: Math.min(250_000, recordRemaining),
      maxRootObservedBytes: Math.min(256 * 1024 * 1024, rootRemaining),
      maxReopenRefreshes: Math.min(10_000, reopenRemaining),
      maxSettlementAttempts: Math.min(10_000, settlementRemaining),
      maxCommandStdoutBytes: Math.min(32 * 1024 * 1024, stdoutRemaining),
      maxCommandStderrBytes: Math.min(512 * 1024, stderrRemaining),
      maxExecutableBytes: Math.min(64 * 1024 * 1024, executableRemaining)
    },
    deadlineAtUnixMs: ledger.deadlineAt
  });
  if (resolution.status !== 'ready') return null;
  const session = resolution.session;
  let observedResult: GitSelectionGitObservation | null = null;
  let closed = false;
  try {
    const observed = await observeGitSelectionState(session, expected.baseSha);
    if (observed !== null && session.failure === null
        && observed.gitExecutable === expected.gitExecutable
        && observed.gitProviderRoute === expected.gitProviderRoute
        && JSON.stringify(observed.gitProviderIdentity)
          === JSON.stringify(expected.gitProviderIdentity)
        && JSON.stringify(observed.gitExecutableIdentity)
          === JSON.stringify(expected.gitExecutableIdentity)) {
      observedResult = observed;
    }
  } finally {
    // A revalidation session is an invocation-local capability, not part of
    // the returned plan. Close it on success, typed failure, and exceptions so
    // retained provider resources cannot outlive this observation boundary.
    try {
      await session.close?.();
      closed = true;
    } catch {
      closed = false;
    }
  }
  if (!closed || session.failure !== null) return null;
  return accountAffectedGitRevalidationSession(ledger, session)
    ? observedResult
    : null;
}

export function sameGitSelectionObservation(
  left: GitSelectionGitObservation,
  right: GitSelectionGitObservation
): boolean {
  return left.headSha === right.headSha
    && left.indexDigest === right.indexDigest
    && left.worktreeDigest === right.worktreeDigest
    && left.gitExecutable === right.gitExecutable
    && left.gitProviderRoute === right.gitProviderRoute
    && JSON.stringify(left.gitProviderIdentity) === JSON.stringify(right.gitProviderIdentity)
    && JSON.stringify(left.gitExecutableIdentity) === JSON.stringify(right.gitExecutableIdentity);
}


export function boundedAffectedBaseRef(value: string | undefined): string | null {
  if (value === undefined) return null;
  // This surface accepts a ref spelling, not arbitrary rev-parse language.
  // `--end-of-options` is still supplied below as a second parser boundary.
  if (value.length < 1 || value.length > 256 || value.includes('\0')
      || !/^[A-Za-z0-9][A-Za-z0-9._/@-]*$/u.test(value)
      || value.includes('..') || value.includes('@{') || value.includes('//')
      || value.endsWith('.') || value.endsWith('.lock')) {
    return null;
  }
  return value;
}
