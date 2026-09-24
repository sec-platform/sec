import path from 'node:path';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../../providers/git-read/runtime/budget.ts';
import { type GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import { parseVerificationRegistryProjection } from '../../../verification/platform/session/contract/session.ts';
import {
  parseOpenPullRequestList,
  projectWorkPackageRegistry,
  type WorkPackageRegistryReadBudget
} from '../../../verification/platform/session/runtime/work-package-registry.ts';
import { projectBranchLifecycleForWorkSelection } from '../branch-lifecycle/branch-lifecycle-audit.ts';
import {
  createBranchLifecycleGitHubRemoteObservation
} from '../branch-lifecycle/branch-lifecycle-command.ts';
import {
  CodexDevelopmentAssertControlPlaneBinding,
  CodexDevelopmentParseActivePointer,
  CodexDevelopmentParseCurrentStateSpec,
  CodexDevelopmentParseRollingMachineProjection,
  CodexDevelopmentParseRollingPlan
} from '../documentation/document-control-plane-contract.ts';
import { buildGitHubDefaultBranchOpenPullRequestsArgs } from '../documentation/document-control-plane-github-observation.ts';
import {
  assertMainHealthPublicationAuthorityStable,
  observeCanonicalMainHealthForPublication,
  observeWorkSelectionGitHubBranchRefs,
  observeWorkSelectionGitHubDefaultRef,
  observeWorkSelectionGitHubIssues,
  observeWorkSelectionGitHubOpenPullRequests,
  resolveWorkSelectionMainHealthSnapshot,
  withMainHealthGitHubReadSession,
  type WorkSelectionMainHealthProjection,
  type WorkSelectionMainHealthSnapshot
} from '../main-health/work-selection-main-health.ts';
import { WorkPackageManifestDigest } from '../task/contract/work-package.ts';
import type {
  CurrentWorkLifecycle,
  WorkDigest
} from './contract.ts';
import {
  compileWorkSelectionTerminalProjection,
  createRoadmapTerminalCompactionCandidate,
  createWorkCurrentSpecObservation,
  createWorkDecisionReceipt,
  createWorkRegistryObservation,
  currentSpecRevisionFromBody,
  parseRoadmapWorkCatalog,
  renderWorkRollingPlan,
  resolvedWorkSelectionLiveResult,
  unresolvedWorkSelectionLiveResult,
  type RoadmapTerminalCompaction,
  type RoadmapTerminalCompactionCandidate,
  type RoadmapWorkCatalogItem,
  type WorkCurrentSpecObservation,
  type WorkDecisionReceipt,
  type WorkRegistryObservation,
  type WorkSelectionLiveResult
} from './live-contract.ts';

// A provider callback is a testing seam, not a production authority. Keep
// that distinction outside the structural live-result contract so JSON or
// object-spread copies cannot be promoted into an effect-capable receipt.
const productionWorkSelectionLiveResults = new WeakSet<object>();
const productionWorkDecisionReceipts = new WeakSet<object>();
const testingWorkSelectionLiveResults = new WeakSet<object>();
const testingWorkDecisionReceipts = new WeakSet<object>();

export interface WorkSelectionProviderCommandResult {
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export type WorkSelectionProvider = (
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  environment?: Readonly<NodeJS.ProcessEnv>,
  input?: Uint8Array
) => WorkSelectionProviderCommandResult;

type WorkSelectionMainHealthTestObserver = (input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  mainSha: string;
  mainTreeSha: string;
}>) => Promise<WorkSelectionMainHealthProjection>;

type CommandRunner = (
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  environment?: Readonly<NodeJS.ProcessEnv>,
  input?: Uint8Array
) => WorkSelectionProviderCommandResult | Promise<WorkSelectionProviderCommandResult>;

type WorkSelectionHostedProvider = Readonly<{
  resolveDefaultSha: (input: Readonly<{
    repository: string;
    defaultBranch: string;
  }>) => Promise<string>;
  observeCurrentSpecs: (input: Readonly<{
    repository: string;
    issueNumbers: readonly number[];
  }>) => Promise<readonly Readonly<{
    number: number;
    nodeId: string;
    state: 'OPEN' | 'CLOSED';
    body: string;
  }>[]>;
  observeOpenPullRequests: (input: Readonly<{
    repository: string;
    defaultBranch: string;
  }>) => Promise<ReturnType<typeof parseOpenPullRequestList>>;
  observeBranchRefs: (input: Readonly<{
    repository: string;
  }>) => Promise<readonly Readonly<{ branch: string; sha: string }>[]>;
}>;

export interface ObserveWorkSelectionLiveInput {
  readonly cwd: string;
  /**
   * A trusted caller such as document-control may pass its already observed
   * local default. The caller still owns the sole live-default admission.
   */
  readonly exactMain?: string;
  readonly exactMainTree?: string;
  /** Owner-issued T2 routing snapshot; callers cannot construct this value. */
  readonly mainHealthSnapshot?: WorkSelectionMainHealthSnapshot;
}

export type ObserveWorkSelectionProductionInput = Readonly<
  Omit<ObserveWorkSelectionLiveInput, 'exactMain' | 'exactMainTree' | 'mainHealthSnapshot'> & {
    exactMain: string;
    exactMainTree: string;
    mainHealthSnapshot: WorkSelectionMainHealthSnapshot;
  }
>;

class LiveObservationFailure extends Error {
  readonly reasonCode: string;
  readonly blockerRef: WorkDigest;

  constructor(reasonCode: string, blockerBytes: Uint8Array | string) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.blockerRef = rawSha256(blockerBytes);
  }
}

function combinedFailureBytes(result: WorkSelectionProviderCommandResult): Buffer {
  return Buffer.concat([result.stdout, Buffer.from('\0'), result.stderr]);
}

async function requireCommand(
  run: CommandRunner,
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  reasonCode: string,
  environment?: Readonly<NodeJS.ProcessEnv>
): Promise<Buffer> {
  const result = await run(command, args, cwd, environment);
  if (result.status !== 0) {
    throw new LiveObservationFailure(reasonCode, combinedFailureBytes(result));
  }
  return result.stdout;
}

function decodeUtf8(bytes: Buffer, reasonCode: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new LiveObservationFailure(reasonCode, bytes);
  }
}

function gitSha(value: string, reasonCode: string): string {
  const parsed = value.trim();
  if (!/^[0-9a-f]{40}$/u.test(parsed)) {
    throw new LiveObservationFailure(reasonCode, value);
  }
  return parsed;
}

function normalizePhysicalPath(value: string): string {
  const normalized = path.resolve(value).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function repositoryRoot(
  run: CommandRunner,
  cwd: string
): Promise<string> {
  const bytes = await requireCommand(run, 'git', ['rev-parse', '--show-toplevel'], cwd,
    'repository-root-unresolved');
  return path.resolve(decodeUtf8(bytes, 'repository-root-invalid').trim());
}

async function readGitBlob(
  run: CommandRunner,
  root: string,
  object: string,
  reasonCode: string
): Promise<Buffer> {
  return await requireCommand(run, 'git', ['show', object], root, reasonCode);
}

async function resolveCanonicalDefaultProjection(input: {
  run: CommandRunner;
  root: string;
}): Promise<{
  stateBytes: Buffer;
  state: ReturnType<typeof CodexDevelopmentParseCurrentStateSpec>;
}> {
  const source = decodeUtf8(await requireCommand(input.run, 'git', [
    'for-each-ref', '--format=%(refname)%00%(symref)', 'refs/remotes/*/HEAD'
  ], input.root, 'remote-head-projection-unresolved'), 'remote-head-projection-invalid-utf8');
  const records = source.split(/\r?\n/u).filter(Boolean);
  if (records.length !== 1) {
    throw new LiveObservationFailure('remote-head-projection-ambiguous', source);
  }
  const [headRef, defaultRef, extra] = records[0]!.split('\0');
  const headMatch = /^refs\/remotes\/([^/]+)\/HEAD$/u.exec(headRef ?? '');
  if (headMatch === null || defaultRef === undefined || extra !== undefined
      || !defaultRef.startsWith(`refs/remotes/${headMatch[1]!}/`)
      || defaultRef === headRef) {
    throw new LiveObservationFailure('remote-head-projection-malformed', records[0]!);
  }
  const stateBytes = await readGitBlob(
    input.run,
    input.root,
    `${defaultRef}:config/repository/current-state.yaml`,
    'trusted-current-state-unresolved'
  );
  const state = CodexDevelopmentParseCurrentStateSpec(
    decodeUtf8(stateBytes, 'trusted-current-state-invalid-utf8')
  );
  const projectedBranch = defaultRef.slice(`refs/remotes/${headMatch[1]!}/`.length);
  if (state.resolver.remote !== headMatch[1]
      || state.resolver.defaultBranch !== projectedBranch
      || state.resolver.defaultRef !== defaultRef) {
    throw new LiveObservationFailure(
      'remote-head-authority-conflict',
      `${headRef}:${defaultRef}:${state.resolver.remote}:${state.resolver.defaultBranch}:${state.resolver.defaultRef}`
    );
  }
  return { stateBytes, state };
}

async function resolveExactMain(input: {
  run: CommandRunner;
  hosted: WorkSelectionHostedProvider;
  root: string;
  remote: string;
  repository: string;
  defaultBranch: string;
  supplied?: string;
}): Promise<string> {
  const local = gitSha(decodeUtf8(await requireCommand(
    input.run,
    'git',
    ['rev-parse', '--verify', `refs/remotes/${input.remote}/${input.defaultBranch}`],
    input.root,
    'local-default-unresolved'
  ), 'local-default-invalid'), 'local-default-invalid');
  if (input.supplied !== undefined) {
    const supplied = gitSha(input.supplied, 'supplied-main-invalid');
    if (supplied !== local) {
      throw new LiveObservationFailure('supplied-main-differs-from-local-default', `${supplied}:${local}`);
    }
    return supplied;
  }
  const live = gitSha(await input.hosted.resolveDefaultSha({
    repository: input.repository,
    defaultBranch: input.defaultBranch
  }), 'live-default-invalid');
  if (live !== local) {
    throw new LiveObservationFailure('local-default-stale', `${local}:${live}`);
  }
  return live;
}

function parseIssueNumber(currentSpecRef: string): number {
  const match = /^github:issue\/([1-9][0-9]*)$/u.exec(currentSpecRef);
  if (match === null) throw new LiveObservationFailure('current-spec-ref-unsupported', currentSpecRef);
  const issueNumber = Number(match[1]);
  if (!Number.isSafeInteger(issueNumber) || issueNumber > 2_147_483_647) {
    throw new LiveObservationFailure('current-spec-ref-unsupported', currentSpecRef);
  }
  return issueNumber;
}

const productionWorkSelectionHostedProvider: WorkSelectionHostedProvider = Object.freeze({
  resolveDefaultSha: observeWorkSelectionGitHubDefaultRef,
  observeCurrentSpecs: async ({ repository, issueNumbers }) =>
    await observeWorkSelectionGitHubIssues({ repository, issueNumbers }),
  observeOpenPullRequests: async (input) =>
    [...await observeWorkSelectionGitHubOpenPullRequests(input)],
  observeBranchRefs: async (input) =>
    await observeWorkSelectionGitHubBranchRefs(input)
});

function testWorkSelectionHostedProvider(
  run: CommandRunner,
  root: string
): WorkSelectionHostedProvider {
  return Object.freeze({
    async resolveDefaultSha(input) {
      const remoteObservation = createBranchLifecycleGitHubRemoteObservation(
        input.repository,
        process.env
      );
      const liveLine = decodeUtf8(await requireCommand(
        run,
        'git',
        [
          ...remoteObservation.argumentsPrefix,
          'ls-remote', '--exit-code', remoteObservation.repositoryUrl,
          `refs/heads/${input.defaultBranch}`
        ],
        root,
        'live-default-unresolved',
        remoteObservation.environment
      ), 'live-default-invalid').trim();
      return liveLine.split(/\s+/u)[0] ?? '';
    },
    async observeCurrentSpecs(input) {
      const [owner, name, extra] = input.repository.split('/');
      if (owner === undefined || name === undefined || extra !== undefined) {
        throw new LiveObservationFailure('repository-identity-invalid', input.repository);
      }
      const aliases = input.issueNumbers.map((issueNumber, index) => ({
        alias: `i${index}`,
        issueNumber
      }));
      const selections = aliases.map(({ alias, issueNumber }) => (
        `${alias}: issue(number: ${issueNumber}) { number id state body }`
      )).join('\n');
      const query = `query($owner: String!, $name: String!) {\n`
        + `  repository(owner: $owner, name: $name) {\n${selections}\n  }\n}`;
      const responseBytes = await requireCommand(run, 'gh', [
        'api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`
      ], root, 'current-spec-provider-unavailable');
      let value: unknown;
      try {
        value = JSON.parse(decodeUtf8(responseBytes, 'current-spec-response-invalid-utf8'));
      } catch {
        throw new LiveObservationFailure('current-spec-response-malformed', responseBytes);
      }
      const envelope = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
      const data = envelope?.data;
      const repository = data !== null && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).repository
        : null;
      const records = repository !== null && typeof repository === 'object' && !Array.isArray(repository)
        ? repository as Record<string, unknown>
        : null;
      if (envelope === null || (Array.isArray(envelope.errors) && envelope.errors.length > 0)
          || records === null) {
        throw new LiveObservationFailure('current-spec-response-malformed', responseBytes);
      }
      return aliases.map(({ alias, issueNumber }) => {
        const issue = records[alias];
        if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
          throw new LiveObservationFailure('current-spec-resource-missing', responseBytes);
        }
        const record = issue as Record<string, unknown>;
        if (record.number !== issueNumber || typeof record.id !== 'string'
            || (record.state !== 'OPEN' && record.state !== 'CLOSED')
            || typeof record.body !== 'string') {
          throw new LiveObservationFailure('current-spec-resource-malformed', responseBytes);
        }
        return Object.freeze({
          number: issueNumber,
          nodeId: record.id,
          state: record.state,
          body: record.body
        });
      });
    },
    async observeOpenPullRequests(input) {
      const bytes = await requireCommand(
        run,
        'gh',
        buildGitHubDefaultBranchOpenPullRequestsArgs(input.repository, input.defaultBranch),
        root,
        'open-pr-provider-unavailable'
      );
      try {
        return parseOpenPullRequestList(decodeUtf8(bytes, 'open-pr-response-invalid-utf8'));
      } catch {
        throw new LiveObservationFailure('open-pr-response-malformed', bytes);
      }
    },
    async observeBranchRefs(input) {
      const remoteObservation = createBranchLifecycleGitHubRemoteObservation(
        input.repository,
        process.env
      );
      const result = await run('git', [
        ...remoteObservation.argumentsPrefix,
        'ls-remote', '--heads', remoteObservation.repositoryUrl
      ], root, remoteObservation.environment);
      if (result.status !== 0) {
        throw new LiveObservationFailure('remote-candidate-ref-unresolved', combinedFailureBytes(result));
      }
      return parseRemoteRefLines(decodeUtf8(
        result.stdout,
        'remote-candidate-ref-invalid-utf8'
      ));
    }
  });
}

async function observeCurrentSpecs(input: {
  hosted: WorkSelectionHostedProvider;
  repository: string;
  items: readonly RoadmapWorkCatalogItem[];
}): Promise<WorkCurrentSpecObservation[]> {
  const aliases = input.items.map((item, index) => ({
    alias: `i${index}`,
    item,
    issueNumber: parseIssueNumber(item.currentSpecRef)
  }));
  const observations = await input.hosted.observeCurrentSpecs({
    repository: input.repository,
    issueNumbers: aliases.map(({ issueNumber }) => issueNumber)
  });
  if (observations.length !== aliases.length) {
    throw new LiveObservationFailure('current-spec-resource-missing', JSON.stringify(observations));
  }
  return aliases.map(({ item, issueNumber }, index) => {
    const record = observations[index]!;
    if (record.number !== issueNumber || record.body.length === 0) {
      throw new LiveObservationFailure('current-spec-resource-malformed', JSON.stringify(record));
    }
    return createWorkCurrentSpecObservation({
      workId: item.workId,
      currentSpecRef: item.currentSpecRef,
      providerResourceRef: `github-node:${record.nodeId}`,
      providerState: record.state === 'OPEN' ? 'open' : 'closed',
      currentSpecRevision: currentSpecRevisionFromBody(record.body)
    });
  });
}

async function observeOpenPullRequests(input: {
  hosted: WorkSelectionHostedProvider;
  repository: string;
  defaultBranch: string;
}): Promise<ReturnType<typeof parseOpenPullRequestList>> {
  return await input.hosted.observeOpenPullRequests({
    repository: input.repository,
    defaultBranch: input.defaultBranch
  });
}

async function observeRegistry(input: {
  run: CommandRunner;
  registryReadBudget: WorkPackageRegistryReadBudget;
  root: string;
  repository: string;
  defaultBranch: string;
  exactMain: string;
  exactMainTree: string;
  openPullRequests: ReturnType<typeof parseOpenPullRequestList>;
}): Promise<WorkRegistryObservation> {
  let projected: string;
  try {
    projected = await projectWorkPackageRegistry({
      observedAt: '1970-01-01T00:00:00.000Z',
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      defaultRef: input.exactMain,
      openPullRequests: input.openPullRequests
    }, (args, bytes) => input.run('git', args, input.root, undefined, bytes), input.registryReadBudget);
  } catch (error) {
    throw new LiveObservationFailure(
      'work-package-registry-unresolved',
      error instanceof Error ? error.message : String(error)
    );
  }
  let registry: ReturnType<typeof parseVerificationRegistryProjection>;
  try {
    registry = parseVerificationRegistryProjection(projected);
  } catch {
    throw new LiveObservationFailure('work-package-registry-malformed', projected);
  }
  if (registry.defaultTreeSha !== input.exactMainTree) {
    throw new LiveObservationFailure(
      'work-package-registry-tree-drift',
      `${registry.defaultTreeSha}:${input.exactMainTree}`
    );
  }
  return createWorkRegistryObservation({
    defaultTreeSha: registry.defaultTreeSha,
    entries: registry.entries.map((entry) => ({ ...entry }))
  });
}

async function exactManifestPaths(
  run: CommandRunner,
  root: string,
  ref: string,
  label: string
): Promise<readonly string[]> {
  const bytes = await requireCommand(run, 'git', [
    'ls-tree', '-r', '--name-only', '-z', '--full-tree', ref, '--', 'config/repository/work-packages'
  ], root, `${label}-unresolved`);
  const source = decodeUtf8(bytes, `${label}-invalid-utf8`);
  if (source.length === 0) return Object.freeze([]);
  if (!source.endsWith('\0')) throw new LiveObservationFailure(`${label}-truncated`, source);
  const paths = source.slice(0, -1).split('\0');
  if (paths.some((candidate) => !/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(candidate))
      || new Set(paths).size !== paths.length) {
    throw new LiveObservationFailure(`${label}-malformed`, source);
  }
  return Object.freeze(paths.sort());
}

export type RoadmapTerminalCompactionCandidateObservation = Readonly<
  | { status: 'not-applicable'; candidate: null }
  | { status: 'resolved'; candidate: RoadmapTerminalCompactionCandidate }
  | { status: 'unresolved'; candidate: null; reasonCode: string; blockerRef: WorkDigest }
>;

/**
 * Provider adapter for one terminal-compaction candidate.  The caller supplies
 * normalized PR facts, while every Git blob, tree and manifest-path fact is
 * re-observed from the exact object database.  This function produces no
 * authorization or effect authority.
 */
export async function observeRoadmapTerminalCompactionCandidate(input: {
  run: CommandRunner;
  root: string;
  repository: string;
  defaultBranch: string;
  exactMain: string;
  roadmapSource: string;
  terminalCompaction: RoadmapTerminalCompaction | null;
  openPullRequests: ReturnType<typeof parseOpenPullRequestList>;
}): Promise<RoadmapTerminalCompactionCandidateObservation> {
  if (input.terminalCompaction === null || input.openPullRequests.length !== 1) {
    return Object.freeze({ status: 'not-applicable', candidate: null });
  }
  const pullRequest = input.openPullRequests[0]!;
  if (pullRequest.baseBranch !== input.defaultBranch || pullRequest.baseSha !== input.exactMain) {
    return Object.freeze({ status: 'not-applicable', candidate: null });
  }
  try {
    const candidateRoadmapSource = decodeUtf8(await readGitBlob(
      input.run,
      input.root,
      `${pullRequest.headSha}:config/repository/work-selection.md`,
      'terminal-candidate-roadmap-unresolved'
    ), 'terminal-candidate-roadmap-invalid-utf8');
    if (candidateRoadmapSource !== input.terminalCompaction.roadmapSource) {
      return Object.freeze({ status: 'not-applicable', candidate: null });
    }
    const headTreeSha = gitSha(decodeUtf8(await requireCommand(input.run, 'git', [
      'rev-parse', `${pullRequest.headSha}^{tree}`
    ], input.root, 'terminal-candidate-tree-unresolved'), 'terminal-candidate-tree-invalid-utf8'),
    'terminal-candidate-tree-invalid');
    const candidate = createRoadmapTerminalCompactionCandidate({
      repository: input.repository,
      exactMain: input.exactMain,
      compaction: input.terminalCompaction,
      priorRoadmapSource: input.roadmapSource,
      roadmapSource: candidateRoadmapSource,
      priorManifestPaths: await exactManifestPaths(
        input.run, input.root, input.exactMain, 'terminal-candidate-base-manifests'
      ),
      manifestPaths: await exactManifestPaths(
        input.run, input.root, pullRequest.headSha, 'terminal-candidate-head-manifests'
      ),
      prNumber: pullRequest.number,
      baseSha: pullRequest.baseSha,
      headSha: pullRequest.headSha,
      headTreeSha
    });
    return Object.freeze({ status: 'resolved', candidate });
  } catch (error) {
    const failure = error instanceof LiveObservationFailure
      ? error
      : new LiveObservationFailure(
          'terminal-compaction-candidate-invalid',
          error instanceof Error ? error.message : String(error)
        );
    return Object.freeze({
      status: 'unresolved',
      candidate: null,
      reasonCode: failure.reasonCode,
      blockerRef: failure.blockerRef
    });
  }
}

function parseRefLines(source: string): Array<{ branch: string; sha: string }> {
  return source.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [branch, sha] = line.split('\0');
    if (branch === undefined || sha === undefined || !/^[0-9a-f]{40}$/u.test(sha)) {
      throw new LiveObservationFailure('local-candidate-ref-malformed', source);
    }
    return { branch, sha };
  });
}

function parseRemoteRefLines(source: string): Array<{ branch: string; sha: string }> {
  return source.split(/\r?\n/u).filter(Boolean).map((line) => {
    const [sha, ref, extra] = line.trim().split(/\s+/u);
    if (sha === undefined || ref === undefined || extra !== undefined
        || !/^[0-9a-f]{40}$/u.test(sha) || !ref.startsWith('refs/heads/')) {
      throw new LiveObservationFailure('remote-candidate-ref-malformed', source);
    }
    return { branch: ref.slice('refs/heads/'.length), sha };
  });
}

function parseWorktrees(source: string): Array<{ root: string; branch: string | null; headSha: string }> {
  const records = source.trim().length === 0 ? [] : source.trimEnd().split(/\r?\n\r?\n/u);
  return records.map((record) => {
    const lines = record.split(/\r?\n/u);
    const worktree = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const head = lines.find((line) => line.startsWith('HEAD '))?.slice('HEAD '.length);
    const branchRef = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length);
    if (worktree === undefined || head === undefined || !/^[0-9a-f]{40}$/u.test(head)) {
      throw new LiveObservationFailure('worktree-inventory-malformed', source);
    }
    return {
      root: worktree,
      branch: branchRef?.startsWith('refs/heads/') ? branchRef.slice('refs/heads/'.length) : null,
      headSha: head
    };
  });
}

export function isWorkSelectionProspectiveTransport(input: Readonly<{
  currentBranch: string;
  currentHead: string;
  defaultBranch: string;
  exactMain: string;
}>): boolean {
  return input.currentBranch.length > 0
    && input.currentBranch !== input.defaultBranch
    && input.currentHead === input.exactMain;
}

export function isExactWorkSelectionActiveIdentity(input: Readonly<{
  activeState: 'none' | 'incomplete' | 'complete' | 'unresolved';
  activeBranch: string | null;
  activeHeadSha: string | null;
  activeLegality: 'legal' | 'invalid' | 'unresolved' | 'not-applicable';
  pullRequestHeadBranch: string;
  pullRequestHeadSha: string;
  registryHeadSha: string | null;
  registryBaseSha: string | null;
  pullRequestBaseSha: string;
}>): boolean {
  return input.activeState === 'incomplete'
    && input.activeBranch === input.pullRequestHeadBranch
    && input.activeHeadSha === input.pullRequestHeadSha
    && input.activeLegality === 'legal'
    && input.registryHeadSha === input.pullRequestHeadSha
    && input.registryBaseSha === input.pullRequestBaseSha;
}

async function observeCurrentCheckoutIdentity(
  run: CommandRunner,
  root: string
): Promise<Readonly<{ branch: string; headSha: string }>> {
  const branch = decodeUtf8(await requireCommand(run, 'git', [
    'branch', '--show-current'
  ], root, 'current-candidate-branch-unresolved'), 'current-candidate-branch-invalid-utf8').trim();
  const headSha = gitSha(decodeUtf8(await requireCommand(run, 'git', [
    'rev-parse', 'HEAD'
  ], root, 'current-candidate-head-unresolved'), 'current-candidate-head-invalid-utf8'),
  'current-candidate-head-invalid');
  return Object.freeze({ branch, headSha });
}

async function observeCanonicalBranchLifecycle(input: {
  run: CommandRunner;
  hosted: WorkSelectionHostedProvider;
  root: string;
  repository: string;
  defaultBranch: string;
  exactMain: string;
  openPullRequests: ReturnType<typeof parseOpenPullRequestList>;
}) {
  const local = parseRefLines(decodeUtf8(await requireCommand(input.run, 'git', [
    'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)', 'refs/heads/'
  ], input.root, 'local-candidate-ref-unresolved'), 'local-candidate-ref-invalid-utf8'))
    .filter(({ branch }) => branch !== input.defaultBranch);
  const remote = (await input.hosted.observeBranchRefs({ repository: input.repository }))
    .filter(({ branch }) => branch !== input.defaultBranch);
  const worktrees = parseWorktrees(decodeUtf8(await requireCommand(input.run, 'git', [
    'worktree', 'list', '--porcelain'
  ], input.root, 'worktree-inventory-unresolved'), 'worktree-inventory-invalid-utf8'));
  const currentCheckout = await observeCurrentCheckoutIdentity(input.run, input.root);
  const currentBranch = currentCheckout.branch;
  const currentHead = currentCheckout.headSha;
  const candidateCheckout = currentBranch.length > 0 && currentBranch !== input.defaultBranch;
  const exactCurrentMatches = candidateCheckout
    ? input.openPullRequests.filter((pullRequest) => (
        pullRequest.headBranch === currentBranch
        && pullRequest.headSha === currentHead
        && pullRequest.baseBranch === input.defaultBranch
        && pullRequest.baseSha === input.exactMain
      ))
    : [];
  if (candidateCheckout && input.openPullRequests.length > 0 && exactCurrentMatches.length !== 1) {
    throw new LiveObservationFailure(
      'current-open-pr-match-unresolved',
      JSON.stringify({
        currentBranch,
        currentHead,
        exactMain: input.exactMain,
        matches: exactCurrentMatches.map(({ number }) => number)
      })
    );
  }
  const selectedPullRequest = candidateCheckout
    ? exactCurrentMatches[0] ?? null
    : input.openPullRequests.length === 1
      ? input.openPullRequests[0]!
      : null;
  const currentTransportBranch = isWorkSelectionProspectiveTransport({
    currentBranch,
    currentHead,
    defaultBranch: input.defaultBranch,
    exactMain: input.exactMain
  })
    ? currentBranch
    : null;
  const currentWorktreeRef = rawSha256(normalizePhysicalPath(input.root));
  const projection = projectBranchLifecycleForWorkSelection({
    exactMain: input.exactMain,
    defaultBranch: input.defaultBranch,
    localRefs: local,
    remoteRefs: remote,
    worktrees: worktrees.filter(({ branch }) => branch !== null && branch !== input.defaultBranch)
      .map(({ root, branch, headSha }) => ({
        worktreeRef: rawSha256(normalizePhysicalPath(root)),
        branch,
        headSha
      })),
    openPullRequests: (selectedPullRequest === null ? [] : [selectedPullRequest]).map(({
      number,
      headBranch,
      headSha,
      baseBranch,
      baseSha
    }) => ({
      number,
      headBranch,
      headSha,
      baseBranch,
      baseSha
    })),
    preservedOpenPullRequests: input.openPullRequests
      .filter(({ number }) => number !== selectedPullRequest?.number)
      .map(({ number, headBranch, headSha, baseBranch, baseSha }) => ({
        number,
        headBranch,
        headSha,
        baseBranch,
        baseSha
      })),
    prospectiveTransport: currentTransportBranch === null ? null : {
      branch: currentTransportBranch,
      headSha: currentHead,
      worktreeRef: currentWorktreeRef
    }
  });
  return Object.freeze({ projection, selectedPullRequest, currentCheckout });
}

function observeCanonicalControl(input: {
  spec: ReturnType<typeof CodexDevelopmentParseCurrentStateSpec>;
  pointerSource: string;
  rollingPlanSource: string;
  manifestPath: string;
  manifestBytes: Buffer;
}): Readonly<{
  state: CurrentWorkLifecycle['controlState'];
  ref: WorkDigest;
}> {
  const pointer = CodexDevelopmentParseActivePointer(input.pointerSource);
  CodexDevelopmentAssertControlPlaneBinding({ spec: input.spec, pointer });
  const rolling = CodexDevelopmentParseRollingPlan(input.rollingPlanSource);
  const rollingMachine = CodexDevelopmentParseRollingMachineProjection(input.rollingPlanSource);
  const manifestDigest = WorkPackageManifestDigest(input.manifestBytes);
  const packageId = path.posix.basename(input.manifestPath, '.md');
  const machineBindingMatches = rollingMachine === null
    || (rollingMachine.active.packageId === packageId
      && (rollingMachine.schema !== 'sec-work-rolling-transition-projection-v1'
        || (rollingMachine.active.manifestPath === input.manifestPath
          && rollingMachine.active.manifestDigest === manifestDigest)));
  const ref = sha256({ pointer, rolling, manifest: {
    path: input.manifestPath,
    id: packageId,
    tracking: rollingMachine?.active.tracking ?? null,
    digest: manifestDigest
  } }) as WorkDigest;
  return Object.freeze({
    state: pointer.manifest === input.manifestPath
        && pointer.manifestDigest === manifestDigest
        && rolling.activePackageId === packageId
        && machineBindingMatches
      ? 'consistent'
      : 'conflict',
    ref
  });
}

function currentLifecycle(input: {
  registry: WorkRegistryObservation;
  catalogItems: readonly RoadmapWorkCatalogItem[];
  openPullRequests: ReturnType<typeof parseOpenPullRequestList>;
  branchLifecycle: ReturnType<typeof projectBranchLifecycleForWorkSelection>;
  selectedPullRequest: ReturnType<typeof parseOpenPullRequestList>[number] | null;
  mainHealth: WorkSelectionMainHealthProjection;
  control: ReturnType<typeof observeCanonicalControl>;
  terminalCandidate: RoadmapTerminalCompactionCandidate | null;
}): CurrentWorkLifecycle {
  if (input.terminalCandidate !== null) {
    const pullRequest = input.openPullRequests.find(
      ({ number }) => number === input.terminalCandidate!.prNumber
    );
    if (pullRequest === undefined
        || input.selectedPullRequest?.number !== pullRequest.number) {
      throw new LiveObservationFailure(
        'terminal-current-pr-match-unresolved',
        String(input.terminalCandidate.prNumber)
      );
    }
    const exactActiveIdentity = isExactWorkSelectionActiveIdentity({
      activeState: input.branchLifecycle.activeState,
      activeBranch: input.branchLifecycle.activeBranch,
      activeHeadSha: input.branchLifecycle.activeHeadSha,
      activeLegality: input.branchLifecycle.activeLegality,
      pullRequestHeadBranch: pullRequest.headBranch,
      pullRequestHeadSha: pullRequest.headSha,
      registryHeadSha: input.terminalCandidate.headSha,
      registryBaseSha: input.terminalCandidate.baseSha,
      pullRequestBaseSha: pullRequest.baseSha
    });
    const activeWorkId = input.terminalCandidate.retiredWorkIds.length === 1
      ? input.terminalCandidate.retiredWorkIds[0]!
      : `terminal-compaction-${input.terminalCandidate.compactionDigest.slice('sha256:'.length, 17)}`;
    return {
      activeWorkId,
      activeRef: input.terminalCandidate.bindingDigest,
      activeState: 'incomplete',
      activeLegality: exactActiveIdentity ? 'legal' : 'invalid',
      mainHealthState: input.mainHealth.state,
      mainHealthRef: input.mainHealth.ref,
      closeoutState: input.branchLifecycle.closeoutState,
      closeoutRef: input.branchLifecycle.projectionDigest,
      controlState: input.control.state,
      controlRef: input.control.ref
    };
  }
  const openEntries = input.registry.entries.filter(({ source }) => source === 'open-pr');
  if (input.selectedPullRequest !== null) {
    const selectedEntries = openEntries.filter(
      ({ prNumber }) => prNumber === input.selectedPullRequest!.number
    );
    const entry = selectedEntries.length === 1 ? selectedEntries[0] : undefined;
    const packageId = entry?.manifestPath.slice('config/repository/work-packages/'.length, -'.md'.length);
    const item = packageId === undefined
      ? undefined
      : input.catalogItems.find((candidate) => candidate.packageId === packageId);
    const activeRef = sha256({
      openPullRequests: input.openPullRequests.map((pullRequest) => ({
        number: pullRequest.number,
        headBranch: pullRequest.headBranch,
        headSha: pullRequest.headSha,
        baseBranch: pullRequest.baseBranch,
        baseSha: pullRequest.baseSha
      })),
      openEntries
    }) as WorkDigest;
    if (entry !== undefined && item !== undefined) {
      const pullRequest = input.selectedPullRequest;
      const exactActiveIdentity = isExactWorkSelectionActiveIdentity({
        activeState: input.branchLifecycle.activeState,
        activeBranch: input.branchLifecycle.activeBranch,
        activeHeadSha: input.branchLifecycle.activeHeadSha,
        activeLegality: input.branchLifecycle.activeLegality,
        pullRequestHeadBranch: pullRequest.headBranch,
        pullRequestHeadSha: pullRequest.headSha,
        registryHeadSha: entry.headSha,
        registryBaseSha: entry.baseSha,
        pullRequestBaseSha: pullRequest.baseSha
      });
      return {
        activeWorkId: item.workId,
        activeRef,
        activeState: 'incomplete',
        activeLegality: exactActiveIdentity ? 'legal' : 'invalid',
        mainHealthState: input.mainHealth.state,
        mainHealthRef: input.mainHealth.ref,
        closeoutState: input.branchLifecycle.closeoutState,
        closeoutRef: input.branchLifecycle.projectionDigest,
        controlState: input.control.state,
        controlRef: input.control.ref
      };
    }
    return {
      activeWorkId: 'unmapped-open-pr',
      activeRef,
      activeState: 'unresolved',
      activeLegality: 'unresolved',
      mainHealthState: input.mainHealth.state,
      mainHealthRef: input.mainHealth.ref,
      closeoutState: 'unresolved',
      closeoutRef: input.branchLifecycle.projectionDigest,
      controlState: 'unresolved',
      controlRef: input.control.ref
    };
  }
  if (input.openPullRequests.length > 0) {
    const activeRef = sha256({
      openPullRequests: input.openPullRequests.map(({ number, headBranch, headSha, baseBranch, baseSha }) => ({
        number, headBranch, headSha, baseBranch, baseSha
      })),
      openEntries
    }) as WorkDigest;
    return {
      activeWorkId: 'unmapped-open-pr',
      activeRef,
      activeState: 'unresolved',
      activeLegality: 'unresolved',
      mainHealthState: input.mainHealth.state,
      mainHealthRef: input.mainHealth.ref,
      closeoutState: 'unresolved',
      closeoutRef: input.branchLifecycle.projectionDigest,
      controlState: 'unresolved',
      controlRef: input.control.ref
    };
  }
  return {
    activeWorkId: null,
    activeRef: null,
    activeState: 'none',
    activeLegality: 'not-applicable',
    mainHealthState: input.mainHealth.state,
    mainHealthRef: input.mainHealth.ref,
    closeoutState: input.branchLifecycle.closeoutState,
    closeoutRef: input.branchLifecycle.projectionDigest,
    controlState: input.control.state,
    controlRef: input.control.ref
  };
}

async function observeWorkSelectionWithinHostedSession(
  input: ObserveWorkSelectionLiveInput,
  run: CommandRunner,
  hosted: WorkSelectionHostedProvider,
  root: string,
  defaultProjection: Awaited<ReturnType<typeof resolveCanonicalDefaultProjection>>,
  registryReadBudget: WorkPackageRegistryReadBudget,
  mainHealthTestObserver?: WorkSelectionMainHealthTestObserver
): Promise<WorkSelectionLiveResult> {
    const exactMain = await resolveExactMain({
      run,
      hosted,
      root,
      remote: defaultProjection.state.resolver.remote,
      repository: defaultProjection.state.resolver.repository,
      defaultBranch: defaultProjection.state.resolver.defaultBranch,
      supplied: input.exactMain
    });
    const trustedStateBytes = await readGitBlob(run, root, `${exactMain}:config/repository/current-state.yaml`,
      'trusted-current-state-unresolved');
    if (!trustedStateBytes.equals(defaultProjection.stateBytes)) {
      throw new LiveObservationFailure(
        'default-current-state-raced',
        `${rawSha256(trustedStateBytes)}:${rawSha256(defaultProjection.stateBytes)}`
      );
    }
    const state = CodexDevelopmentParseCurrentStateSpec(
      decodeUtf8(trustedStateBytes, 'trusted-current-state-invalid-utf8')
    );
    const actualTree = gitSha(decodeUtf8(await requireCommand(run, 'git', [
      'rev-parse', `${exactMain}^{tree}`
    ], root, 'exact-main-tree-unresolved'), 'exact-main-tree-invalid'), 'exact-main-tree-invalid');
    const exactMainTree = input.exactMainTree === undefined
      ? actualTree
      : gitSha(input.exactMainTree, 'supplied-main-tree-invalid');
    if (actualTree !== exactMainTree) {
      throw new LiveObservationFailure('supplied-main-tree-drift', `${actualTree}:${exactMainTree}`);
    }
    const mainHealthInput = {
      root,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch,
      exactMain,
      exactMainTree
    };
    const mainHealth = mainHealthTestObserver === undefined
      ? input.mainHealthSnapshot === undefined
        ? (() => {
            throw new LiveObservationFailure(
              'main-health-snapshot-required',
              `${mainHealthInput.repository}:${mainHealthInput.exactMain}:${mainHealthInput.exactMainTree}`
            );
          })()
        : resolveWorkSelectionMainHealthSnapshot({
          snapshot: input.mainHealthSnapshot,
          repositoryRoot: mainHealthInput.root,
          repository: mainHealthInput.repository,
          defaultBranch: mainHealthInput.defaultBranch,
          mainSha: mainHealthInput.exactMain,
          mainTreeSha: mainHealthInput.exactMainTree
        }).projection
      : await mainHealthTestObserver({
          repositoryRoot: mainHealthInput.root,
          repository: mainHealthInput.repository,
          defaultBranch: mainHealthInput.defaultBranch,
          mainSha: mainHealthInput.exactMain,
          mainTreeSha: mainHealthInput.exactMainTree
        });
    if (mainHealth.state !== 'healthy') {
      return unresolvedWorkSelectionLiveResult({
        reasonCodes: [mainHealth.state === 'unhealthy'
          ? 'main-health-repair-only'
          : 'main-health-locked'],
        blockerRefs: [mainHealth.ref]
      });
    }
    const roadmapBytes = await readGitBlob(run, root, `${exactMain}:config/repository/work-selection.md`,
      'roadmap-unresolved');
    const roadmapSource = decodeUtf8(roadmapBytes, 'roadmap-invalid-utf8');
    const observedCatalog = parseRoadmapWorkCatalog(roadmapSource);
    const observedCurrentSpecs = await observeCurrentSpecs({
      hosted,
      repository: state.resolver.repository,
      items: observedCatalog.items
    });
    const terminal = compileWorkSelectionTerminalProjection({
      roadmapSource,
      currentSpecs: observedCurrentSpecs
    });
    const { catalog, currentSpecs, terminalCompaction } = terminal;
    const openPullRequests = await observeOpenPullRequests({
      hosted,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch
    });
    const branchObservation = await observeCanonicalBranchLifecycle({
      run,
      hosted,
      root,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch,
      exactMain,
      openPullRequests
    });
    const terminalObservation = await observeRoadmapTerminalCompactionCandidate({
      run,
      root,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch,
      exactMain,
      roadmapSource,
      terminalCompaction,
      openPullRequests: branchObservation.selectedPullRequest === null
        ? []
        : [branchObservation.selectedPullRequest]
    });
    if (terminalObservation.status === 'unresolved') {
      return unresolvedWorkSelectionLiveResult({
        reasonCodes: [terminalObservation.reasonCode],
        blockerRefs: [terminalObservation.blockerRef]
      });
    }
    const terminalCandidate = terminalObservation.candidate;
    const registry = await observeRegistry({
      run,
      registryReadBudget,
      root,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch,
      exactMain,
      exactMainTree,
      openPullRequests: terminalCandidate === null
        ? openPullRequests
        : openPullRequests.filter(({ number }) => number !== terminalCandidate.prNumber)
    });
    const currentCheckoutReadback = await observeCurrentCheckoutIdentity(run, root);
    if (currentCheckoutReadback.branch !== branchObservation.currentCheckout.branch
        || currentCheckoutReadback.headSha !== branchObservation.currentCheckout.headSha) {
      throw new LiveObservationFailure(
        'current-checkout-drift-unresolved',
        JSON.stringify({
          before: branchObservation.currentCheckout,
          after: currentCheckoutReadback
        })
      );
    }
    const pointerBytes = await readGitBlob(run, root, `${exactMain}:config/repository/active-work-package.md`,
      'active-pointer-unresolved');
    const pointerSource = decodeUtf8(pointerBytes, 'active-pointer-invalid-utf8');
    const pointer = CodexDevelopmentParseActivePointer(pointerSource);
    const rollingPlanSource = decodeUtf8(await readGitBlob(
      run,
      root,
      `${exactMain}:config/repository/rolling-plan.md`,
      'rolling-plan-unresolved'
    ), 'rolling-plan-invalid-utf8');
    const activeManifestBytes = await readGitBlob(
      run,
      root,
      `${exactMain}:${pointer.manifest}`,
      'active-manifest-unresolved'
    );
    const control = observeCanonicalControl({
      spec: state,
      pointerSource,
      rollingPlanSource,
      manifestPath: pointer.manifest,
      manifestBytes: activeManifestBytes
    });
    const current = currentLifecycle({
      registry,
      catalogItems: catalog.items,
      openPullRequests,
      branchLifecycle: branchObservation.projection,
      selectedPullRequest: branchObservation.selectedPullRequest,
      mainHealth,
      control,
      terminalCandidate
    });
    const receipt = createWorkDecisionReceipt({
      repository: state.resolver.repository,
      exactMain,
      exactMainTree,
      roadmapRevision: terminal.roadmapRevision,
      catalog,
      registry,
      current,
      currentSpecs
    });
    return resolvedWorkSelectionLiveResult(receipt, terminal.demandGraph, terminalCompaction);
}

async function observeWorkSelectionBound(
  input: ObserveWorkSelectionLiveInput,
  run: CommandRunner,
  registryReadBudget: WorkPackageRegistryReadBudget,
  mainHealthTestObserver?: WorkSelectionMainHealthTestObserver
): Promise<WorkSelectionLiveResult> {
  try {
    const root = await repositoryRoot(run, input.cwd);
    const defaultProjection = await resolveCanonicalDefaultProjection({ run, root });
    if (mainHealthTestObserver === undefined
        && (input.exactMain === undefined
          || input.exactMainTree === undefined
          || input.mainHealthSnapshot === undefined)) {
      throw new LiveObservationFailure(
        'main-health-snapshot-required',
        `${defaultProjection.state.resolver.repository}:${defaultProjection.state.resolver.defaultRef}`
      );
    }
    const hosted = mainHealthTestObserver === undefined
      ? productionWorkSelectionHostedProvider
      : testWorkSelectionHostedProvider(run, root);
    const operation = async () => await observeWorkSelectionWithinHostedSession(
      input,
      run,
      hosted,
      root,
      defaultProjection,
      registryReadBudget,
      mainHealthTestObserver
    );
    return mainHealthTestObserver === undefined
      ? await withMainHealthGitHubReadSession({
          repositoryRoot: root,
          repository: defaultProjection.state.resolver.repository,
          operation
        })
      : await operation();
  } catch (error) {
    if (error instanceof LiveObservationFailure) {
      return unresolvedWorkSelectionLiveResult({
        reasonCodes: [error.reasonCode],
        blockerRefs: [error.blockerRef]
      });
    }
    return unresolvedWorkSelectionLiveResult({
      reasonCodes: ['live-observation-unsupported'],
      blockerRefs: [rawSha256(error instanceof Error ? error.message : String(error))]
    });
  }
}

/**
 * Test-only provider composition. A caller-supplied runner is deliberately
 * branded as test-origin and cannot satisfy the production receipt gate.
 */
export async function observeWorkSelectionWithProvider(
  input: ObserveWorkSelectionLiveInput,
  run: WorkSelectionProvider,
  mainHealthTestObserver?: WorkSelectionMainHealthTestObserver
): Promise<WorkSelectionLiveResult> {
  const result = await observeWorkSelectionBound(input, run, {
    maxCommandStdoutBytes: GIT_READ_DEFAULT_OPERATION_BUDGET.maxCommandStdoutBytes,
    consumeRecords: () => {}
  }, mainHealthTestObserver);
  testingWorkSelectionLiveResults.add(result);
  if (result.status === 'resolved') {
    testingWorkDecisionReceipts.add(result.receipt);
  }
  return result;
}

async function withProductionGitRead<T>(
  cwd: string,
  operation: (run: CommandRunner, registryReadBudget: WorkPackageRegistryReadBudget) => Promise<T>
): Promise<T> {
  return await withAuthorityGitReadSession({
    cwd,
    budget: {
      deadlineMs: 120_000,
      maxProcesses: 32,
      maxTotalArgumentBytes: 1024 * 1024,
      maxStdoutBytes: 64 * 1024 * 1024,
      maxStderrBytes: 2 * 1024 * 1024,
      maxRecords: 100_000
    }
  }, async (session: GitReadSession) => {
    const run: CommandRunner = async (command, args, commandCwd, environment, bytes) => {
      if (command !== 'git' || path.resolve(commandCwd) !== path.resolve(session.cwd)
          || environment !== undefined) {
        throw new LiveObservationFailure(
          'git-read-session-boundary-invalid',
          JSON.stringify({ command, cwd: commandCwd, hasEnvironment: environment !== undefined })
        );
      }
      const observation = await session.run(args, bytes === undefined ? undefined : { input: bytes });
      if (observation.kind !== 'completed') {
        return {
          status: null,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(JSON.stringify(observation), 'utf8')
        };
      }
      return {
        status: observation.result.code,
        stdout: Buffer.from(observation.result.stdout),
        stderr: Buffer.from(observation.result.stderr, 'utf8')
      };
    };
    return await operation(run, {
      maxCommandStdoutBytes: session.budget.maxCommandStdoutBytes,
      consumeRecords: count => {
        const failure = session.consumeRecords(count);
        if (failure !== null) throw new LiveObservationFailure('git-read-record-budget-exhausted', failure.detail);
      }
    });
  });
}

function retainProductionWorkSelectionResult(
  result: WorkSelectionLiveResult
): WorkSelectionLiveResult {
  productionWorkSelectionLiveResults.add(result);
  if (result.status === 'resolved') productionWorkDecisionReceipts.add(result.receipt);
  return result;
}

function unresolvedProductionWorkSelection(error: unknown): WorkSelectionLiveResult {
  const reasonCode = error instanceof GitReadAuthorityError
    ? 'git-read-provider-unavailable'
    : error instanceof LiveObservationFailure
      ? error.reasonCode
      : 'live-observation-unsupported';
  const blockerRef = error instanceof LiveObservationFailure
    ? error.blockerRef
    : rawSha256(error instanceof Error ? error.message : String(error));
  return retainProductionWorkSelectionResult(unresolvedWorkSelectionLiveResult({
    reasonCodes: [reasonCode],
    blockerRefs: [blockerRef]
  }));
}

/**
 * Trusted semantic consumer. Production callers must pass an exact main and
 * the opaque T2 snapshot issued by the MainHealth owner.
 */
export async function observeWorkSelectionLive(
  input: ObserveWorkSelectionProductionInput
): Promise<WorkSelectionLiveResult> {
  let result: WorkSelectionLiveResult;
  try {
    result = await withProductionGitRead(input.cwd, async (run, registryReadBudget) =>
      await observeWorkSelectionBound(input, run, registryReadBudget));
  } catch (error) {
    return unresolvedProductionWorkSelection(error);
  }
  return retainProductionWorkSelectionResult(result);
}

export function requireResolvedWorkDecisionReceipt(
  result: WorkSelectionLiveResult
): WorkDecisionReceipt {
  if (!productionWorkSelectionLiveResults.has(result)
      || (result.status === 'resolved' && !productionWorkDecisionReceipts.has(result.receipt))) {
    throw new Error(
      'Work selection result is not issued by the trusted production live runner'
    );
  }
  if (result.status !== 'resolved') {
    throw new Error(
      `Work selection is unresolved (${result.reasonCodes.join(',')}): ${result.blockerRefs.join(',')}`
    );
  }
  return result.receipt;
}

export type WorkSelectionCliProjection = Readonly<
  | {
    schema: 'sec-work-selection-cli-projection-v1';
    status: 'resolved';
    resultDigest: WorkSelectionLiveResult['resultDigest'];
    exactMain: string;
    exactMainTree: string;
    receiptDigest: WorkDecisionReceipt['receiptDigest'];
    demandGraph: Readonly<{
      graphDigest: `sha256:${string}`;
      capabilityDemands: readonly string[];
      transitionDemands: readonly string[];
      verificationObligations: readonly string[];
    }>;
    terminalCompaction: null | Readonly<{
      compactionDigest: WorkDigest;
      delayedManifestRetirementPaths: readonly string[];
      retiredWorkIds: readonly string[];
    }>;
    decision: Readonly<{
      status: WorkDecisionReceipt['decision']['status'];
      selectedWorkId: string | null;
      selectedCandidateRef: string | null;
      decisionDigest: WorkDecisionReceipt['decision']['decisionDigest'];
      reasonCodes: readonly string[];
      blockedCandidateRefs: readonly string[];
      requiredPreconditions: number;
    }>;
  }
  | {
    schema: 'sec-work-selection-cli-projection-v1';
    status: 'unresolved';
    resultDigest: WorkSelectionLiveResult['resultDigest'];
    reasonCodes: readonly string[];
    blockerRefs: readonly string[];
  }
>;

export function projectWorkSelectionCli(
  result: WorkSelectionLiveResult
): WorkSelectionCliProjection {
  if (result.status === 'unresolved') {
    return Object.freeze({
      schema: 'sec-work-selection-cli-projection-v1',
      status: result.status,
      resultDigest: result.resultDigest,
      reasonCodes: result.reasonCodes,
      blockerRefs: result.blockerRefs
    });
  }
  const { receipt } = result;
  return Object.freeze({
    schema: 'sec-work-selection-cli-projection-v1',
    status: result.status,
    resultDigest: result.resultDigest,
    exactMain: receipt.exactMain,
    exactMainTree: receipt.exactMainTree,
    receiptDigest: receipt.receiptDigest,
    demandGraph: Object.freeze({
      graphDigest: result.demandGraph.graphDigest,
      capabilityDemands: result.demandGraph.capabilityDemands,
      transitionDemands: result.demandGraph.transitionDemands,
      verificationObligations: result.demandGraph.verificationObligations
    }),
    terminalCompaction: result.terminalCompaction === null
      ? null
      : Object.freeze({
          compactionDigest: result.terminalCompaction.compactionDigest,
          delayedManifestRetirementPaths:
            result.terminalCompaction.delayedManifestRetirementPaths,
          retiredWorkIds: result.terminalCompaction.retiredWorkIds
        }),
    decision: Object.freeze({
      status: receipt.decision.status,
      selectedWorkId: receipt.decision.selectedWorkId,
      selectedCandidateRef: receipt.decision.selectedCandidateRef,
      decisionDigest: receipt.decision.decisionDigest,
      reasonCodes: receipt.decision.reasonCodes,
      blockedCandidateRefs: receipt.decision.blockedCandidateRefs,
      requiredPreconditions: receipt.decision.requiredPreconditions.length
    })
  });
}

function usage(): string {
  return 'Usage:\n'
    + '  bun src/adapters/self-hosting/control/work-selection/runtime.ts observe [--json] [--full]\n'
    + '  bun src/adapters/self-hosting/control/work-selection/runtime.ts project --reviewed-on <YYYY-MM-DD> [--json]\n';
}

async function observeWorkSelectionCliMainHealthFirst(cwd: string): Promise<WorkSelectionLiveResult> {
  try {
    const result = await withProductionGitRead(cwd, async (run, registryReadBudget) => {
      const root = await repositoryRoot(run, cwd);
      const defaultProjection = await resolveCanonicalDefaultProjection({ run, root });
      const exactMain = gitSha(decodeUtf8(await requireCommand(run, 'git', [
        'rev-parse', '--verify', defaultProjection.state.resolver.defaultRef
      ], root, 'local-default-unresolved'), 'local-default-invalid'), 'local-default-invalid');
      const exactMainTree = gitSha(decodeUtf8(await requireCommand(run, 'git', [
        'rev-parse', `${exactMain}^{tree}`
      ], root, 'exact-main-tree-unresolved'), 'exact-main-tree-invalid'), 'exact-main-tree-invalid');
      return await withMainHealthGitHubReadSession({
        repositoryRoot: root,
        repository: defaultProjection.state.resolver.repository,
        operation: async () => {
          const snapshotInput = Object.freeze({
            repositoryRoot: root,
            repository: defaultProjection.state.resolver.repository,
            defaultBranch: defaultProjection.state.resolver.defaultBranch,
            mainSha: exactMain,
            mainTreeSha: exactMainTree
          });
          const first = await observeCanonicalMainHealthForPublication(snapshotInput);
          const second = await observeCanonicalMainHealthForPublication(snapshotInput);
          assertMainHealthPublicationAuthorityStable(first.authority, second.authority);
          if (first.stableDigest !== second.stableDigest) {
            throw new LiveObservationFailure(
              'main-health-snapshot-drift',
              `${first.stableDigest}:${second.stableDigest}`
            );
          }
          if (second.repairDecision.routingState !== 'ordinary-only') {
            return unresolvedWorkSelectionLiveResult({
              reasonCodes: [second.repairDecision.routingState === 'repair-only'
                ? 'main-health-repair-only'
                : 'main-health-locked'],
              blockerRefs: [second.stableDigest]
            });
          }
          return await observeWorkSelectionBound({
            cwd: root,
            exactMain,
            exactMainTree,
            mainHealthSnapshot: second.workSelectionSnapshot
          }, run, registryReadBudget);
        }
      });
    });
    return retainProductionWorkSelectionResult(result);
  } catch (error) {
    return unresolvedProductionWorkSelection(error);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'observe' && command !== 'project') throw new Error(usage());
  const jsonCount = args.filter((argument) => argument === '--json').length;
  if (jsonCount > 1) throw new Error(usage());
  const json = jsonCount === 1;
  if (command === 'observe'
      && args.some((argument) => argument !== '--json' && argument !== '--full')) {
    throw new Error(usage());
  }
  let reviewedOn: string | undefined;
  if (command === 'project') {
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === '--json') continue;
      if (argument !== '--reviewed-on' || reviewedOn !== undefined
          || args[index + 1] === undefined || args[index + 1]!.startsWith('--')) {
        throw new Error(usage());
      }
      reviewedOn = args[index + 1]!;
      index += 1;
    }
    if (reviewedOn === undefined) throw new Error(usage());
  }
  const result = await observeWorkSelectionCliMainHealthFirst(process.cwd());
  if (command === 'observe') {
    const output = args.includes('--full') ? result : projectWorkSelectionCli(result);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (result.status !== 'resolved') process.exitCode = 2;
    return;
  }
  const receipt = requireResolvedWorkDecisionReceipt(result);
  const source = renderWorkRollingPlan({ receipt, reviewedOn: reviewedOn! });
  if (json) {
    process.stdout.write(`${JSON.stringify({ result, rollingPlanSource: source }, null, 2)}\n`);
  } else {
    process.stdout.write(source);
  }
}

if (import.meta.main) await main();
