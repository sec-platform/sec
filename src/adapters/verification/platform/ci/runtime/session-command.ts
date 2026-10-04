/**
 * Fixed VerificationSession command transport. Command scope describes the
 * observed repository; it never issues session, integration, or effect authority.
 * Keep command bounds and child environment handling shared by CLI orchestration
 * and the hosted closeout executor without caller-injected process callbacks.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cloneAndDeepFreeze } from '../../../../../contracts/canonical.ts';

import { settleResources } from '../../../../../execution/resource-settlement.ts';
import type { IntegrationAuthorization } from '../../../../../execution/verification/integration.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, type AuthenticatedGitHubJobOrigin } from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  type RetainedNoFollowChildProcessDirectory
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR } from '../../../../runtime-state/physical/runtime/process.ts';
import { createBranchLifecycleGitChildEnvironment, decodeBranchLifecycleChildError, decodeBranchLifecycleChildStdout } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import type { ActiveWorkPackageOwnerObservation } from '../../../../self-hosting/control/task/contract/active-work-observation.ts';
import { assertHistoricalHostedSessionTerminalSourceCurrent, closeHistoricalHostedSessionTerminalSource } from './verification-action-github-provider.ts';

const SESSION_COMMAND_TIMEOUT_MS = 60_000;

export const SESSION_COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

export interface VerificationSessionScope {
  readonly repositoryRoot: string;
  readonly remote?: string;
  readonly repositoryFullName?: string;
  readonly defaultBranch?: string;
  readonly recoveryRoot?: string;
  readonly activeWorkPackageObservation?: ActiveWorkPackageOwnerObservation;
}

type HistoricalSessionSelector = Parameters<typeof assertHistoricalHostedSessionTerminalSourceCurrent>[0]['artifact'];
type HistoricalSessionFacts = Awaited<ReturnType<typeof assertHistoricalHostedSessionTerminalSourceCurrent>>;
type BorrowedHistoricalSessionSource = {
  readonly origin: AuthenticatedGitHubJobOrigin;
  readonly selector: HistoricalSessionSelector;
  artifactDigest: string;
  state: 'pending' | 'retained';
};
const historicalSourcesByArtifact = new WeakMap<object, BorrowedHistoricalSessionSource>();
const historicalSourcesByContext = new WeakMap<VerificationSessionScope, Set<BorrowedHistoricalSessionSource>>();
const selectedHistoricalSource = new WeakMap<VerificationSessionScope, BorrowedHistoricalSessionSource>();
const delegatedSelectedContexts = new WeakSet<VerificationSessionScope>();
const retiredHistoricalSourceContexts = new WeakSet<VerificationSessionScope>();

function assertHistoricalSourceContext(ctx: VerificationSessionScope, source: BorrowedHistoricalSessionSource, facts: HistoricalSessionFacts): void {
  const job = assertAuthenticatedGitHubJobOriginCurrent(source.origin);
  if (path.resolve(ctx.repositoryRoot) !== job.trustedDriverRoot
      || facts.authenticatedArtifact.session.repository !== job.repository
      || facts.authenticatedArtifact.artifactDigest !== source.artifactDigest
      || (ctx.repositoryFullName !== undefined && ctx.repositoryFullName !== job.repository)) {
    throw new Error('Historical Session borrow differs from its genuine origin, repository or immutable artifact.');
  }
}

/** This association holds a dependency, never an authority: each consumer goes
 * back to the original provider's private selector and current native facts. */
export async function retainHistoricalHostedSessionSource(input: Readonly<{
  ctx: VerificationSessionScope; origin: AuthenticatedGitHubJobOrigin; selector: HistoricalSessionSelector;
}>) {
  const { ctx, origin, selector } = input;
  if (retiredHistoricalSourceContexts.has(ctx)) throw new Error('The invocation historical source lifetime has ended.');
  const source: BorrowedHistoricalSessionSource = { origin, selector, artifactDigest: '', state: 'pending' };
  const sources = historicalSourcesByContext.get(ctx) ?? new Set<BorrowedHistoricalSessionSource>();
  sources.add(source);
  historicalSourcesByContext.set(ctx, sources);
  try {
    const facts = await assertHistoricalHostedSessionTerminalSourceCurrent({ origin, artifact: selector });
    if (retiredHistoricalSourceContexts.has(ctx) || historicalSourcesByContext.get(ctx) !== sources || !sources.has(source)) {
      throw new Error('The invocation historical source lifetime ended during native observation.');
    }
    source.artifactDigest = facts.authenticatedArtifact.artifactDigest;
    assertHistoricalSourceContext(ctx, source, facts);
    source.state = 'retained';
    Object.freeze(source);
    historicalSourcesByArtifact.set(facts.authenticatedArtifact, source);
    return facts;
  } catch (error) {
    if (historicalSourcesByContext.get(ctx) === sources) sources.delete(source);
    closeHistoricalHostedSessionTerminalSource({ origin, artifact: selector });
    throw error;
  }
}

export async function selectHistoricalHostedSessionSource(input: Readonly<{
  ctx: VerificationSessionScope; artifact: HistoricalSessionSelector;
}>) {
  const { ctx, artifact } = input;
  if (retiredHistoricalSourceContexts.has(ctx)) throw new Error('The invocation historical source lifetime has ended.');
  if (artifact.schema !== 'verification-session-delegated-terminal') {
    if (delegatedSelectedContexts.has(ctx)) throw new Error('An invocation cannot replace its selected delegated source with a direct artifact.');
    selectedHistoricalSource.delete(ctx);
    return artifact;
  }
  const source = historicalSourcesByArtifact.get(artifact);
  if (source === undefined || source.state !== 'retained' || historicalSourcesByContext.get(ctx)?.has(source) !== true) {
    throw new Error('Selected delegated Session is not an original qualified capture in this invocation.');
  }
  const selected = selectedHistoricalSource.get(ctx);
  if (selected !== undefined && (selected.origin !== source.origin || selected.artifactDigest !== source.artifactDigest)) {
    throw new Error('An invocation cannot replace its selected original Session with another qualified source.');
  }
  const facts = await assertHistoricalHostedSessionTerminalSourceCurrent({ origin: source.origin, artifact: source.selector });
  const currentSelected = selectedHistoricalSource.get(ctx);
  if (retiredHistoricalSourceContexts.has(ctx) || historicalSourcesByContext.get(ctx)?.has(source) !== true
      || currentSelected !== selected) {
    throw new Error('The selected historical source changed during native observation.');
  }
  assertHistoricalSourceContext(ctx, source, facts);
  selectedHistoricalSource.set(ctx, source);
  delegatedSelectedContexts.add(ctx);
  historicalSourcesByArtifact.set(facts.authenticatedArtifact, source);
  return facts.authenticatedArtifact;
}

export async function assertBorrowedHostedSessionSourceCurrent(ctx: VerificationSessionScope, subject: Readonly<{
  repository: string; pullRequestNumber: number; headSha: string; candidateTreeSha?: string; sessionRevision?: string;
  authorization?: IntegrationAuthorization;
}>) {
  subject = cloneAndDeepFreeze(subject);
  if (retiredHistoricalSourceContexts.has(ctx)) throw new Error('The invocation historical source lifetime has ended.');
  const source = selectedHistoricalSource.get(ctx);
  if (source === undefined) {
    if (delegatedSelectedContexts.has(ctx)) throw new Error('The selected delegated source has been released; native effects remain unavailable.');
    return null;
  }
  const facts = await assertHistoricalHostedSessionTerminalSourceCurrent({ origin: source.origin, artifact: source.selector });
  if (retiredHistoricalSourceContexts.has(ctx) || selectedHistoricalSource.get(ctx) !== source
      || historicalSourcesByContext.get(ctx)?.has(source) !== true) {
    throw new Error('The selected historical source was released during native observation.');
  }
  assertHistoricalSourceContext(ctx, source, facts);
  const artifact = facts.authenticatedArtifact;
  if (artifact.session.repository !== subject.repository || artifact.session.prNumber !== subject.pullRequestNumber
      || artifact.session.headSha !== subject.headSha
      || (subject.candidateTreeSha !== undefined && artifact.session.headTreeSha !== subject.candidateTreeSha)
      || (subject.sessionRevision !== undefined && artifact.session.sessionRevision !== subject.sessionRevision)) {
    throw new Error('Native effect subject differs from its selected historical Session and original Scope.');
  }
  if (subject.authorization !== undefined) {
    const authorization = subject.authorization;
    if (authorization.baseSha !== artifact.session.baseSha || authorization.baseTreeSha !== artifact.session.baseTreeSha
        || authorization.headTreeSha !== artifact.session.headTreeSha || authorization.manifestDigest !== artifact.session.manifestDigest
        || authorization.actionClosureDigest !== artifact.session.actionPlanClosureDigest
        || authorization.evidenceDigest !== artifact.evidence.evidenceDigest
        || authorization.scopeAuthorizationReceiptDigest !== artifact.scopeAuthorization.authorizationDigest
        || authorization.scopeAuthorizationRevision !== artifact.scopeAuthorization.authorizationRevision) {
      throw new Error('Native integration authorization differs from its fresh original Session, Scope and Evidence.');
    }
  }
  historicalSourcesByArtifact.set(artifact, source);
  return facts;
}

export function closeHistoricalHostedSessionSources(ctx: VerificationSessionScope): void {
  retiredHistoricalSourceContexts.add(ctx);
  const sources = historicalSourcesByContext.get(ctx);
  historicalSourcesByContext.delete(ctx);
  selectedHistoricalSource.delete(ctx);
  for (const source of sources ?? []) closeHistoricalHostedSessionTerminalSource({ origin: source.origin, artifact: source.selector });
}

/** Consume the original retained inode/pinned chain; a path alone is no authority. */
function retainedVerificationSessionSpawnBoundary(
  directory: RetainedNoFollowChildProcessDirectory
): Readonly<{ cwd: string; stdio: Array<'pipe' | 'ignore' | number> }> {
  directory.assertCurrent();
  const stdio: Array<'pipe' | 'ignore' | number> = ['pipe', 'pipe', 'pipe'];
  if (process.platform === 'linux') {
    const descriptor = directory.stdioSourceDescriptor;
    if (directory.childPath !== `/proc/self/fd/${RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR}`
        || descriptor === null || !Number.isSafeInteger(descriptor) || descriptor < 5) {
      throw new Error('VerificationSession retained Linux cwd capability is malformed.');
    }
    while (stdio.length <= RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR) stdio.push('ignore');
    stdio[RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR] = descriptor;
    // spawnSync resolves cwd in its parent before descriptor remapping.
    return Object.freeze({ cwd: `/proc/self/fd/${descriptor}`, stdio });
  }
  if (process.platform === 'win32') {
    if (directory.stdioSourceDescriptor !== null || !path.isAbsolute(directory.childPath)) {
      throw new Error('VerificationSession retained Windows cwd capability is malformed.');
    }
    return Object.freeze({ cwd: directory.childPath, stdio });
  }
  // Physical acquisition rejects unsupported backends before issuing a handle.
  throw new Error(`VerificationSession retained command cwd is unavailable on ${process.platform}.`);
}

export function runVerificationSessionCommand(
  ctx: VerificationSessionScope,
  command: 'bun' | 'gh' | 'git',
  args: readonly string[],
  cwd = ctx.repositoryRoot,
  stdin?: string | Uint8Array
) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('VerificationSession command argument contains NUL.');
  }
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(path.resolve(cwd), 'VerificationSession command working directory'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'VerificationSession command working directory'
  );
  let primary: { readonly label: string; readonly error: unknown } | undefined;
  try {
    const boundary = retainedVerificationSessionSpawnBoundary(workingDirectory);
    const spawned = spawnSync(command, [...args], {
      cwd: boundary.cwd,
      stdio: boundary.stdio,
      encoding: 'buffer',
      windowsHide: true,
      timeout: SESSION_COMMAND_TIMEOUT_MS,
      maxBuffer: SESSION_COMMAND_MAX_BUFFER,
      input: stdin === undefined ? undefined : typeof stdin === 'string' ? Buffer.from(stdin, 'utf8') : Buffer.from(stdin),
      env: {
        ...(command === 'git'
          ? createBranchLifecycleGitChildEnvironment(process.env)
          : process.env),
        GH_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0'
      }
    });
    workingDirectory.assertCurrent();
    return {
      status: spawned.status,
      stdout: Buffer.isBuffer(spawned.stdout)
        ? spawned.stdout
        : Buffer.from(String(spawned.stdout ?? '')),
      stderr: Buffer.isBuffer(spawned.stderr)
        ? spawned.stderr
        : Buffer.from(String(spawned.stderr ?? spawned.error?.message ?? ''))
    };
  } catch (error) {
    primary = { label: 'VerificationSession command', error };
    throw error;
  } finally {
    settleResources({
      ...(primary === undefined ? {} : { primary }),
      cleanup: [{ label: 'VerificationSession command cwd dispose', settle: () => workingDirectory.dispose() }]
    });
  }
}

export function requireVerificationSessionCommandText(
  ctx: VerificationSessionScope,
  command: 'bun' | 'gh' | 'git',
  args: readonly string[],
  label: string,
  cwd = ctx.repositoryRoot
): string {
  const result = runVerificationSessionCommand(ctx, command, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return decodeBranchLifecycleChildStdout(result);
}

export function requireCommand(
  ctx: VerificationSessionScope,
  command: 'git' | 'gh',
  args: readonly string[],
  label: string
): string {
  const result = runVerificationSessionCommand(ctx, command, args);
  if (result.status !== 0) throw new Error(`Trusted runtime ${label} failed.`);
  return decodeBranchLifecycleChildStdout(result);
}
