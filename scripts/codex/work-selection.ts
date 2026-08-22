import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { rawSha256, sha256 } from '../../platform/shared/canonical-primitives.ts';
import { parseVerificationRegistryProjectionV1 } from '../../platform/shared/verification-session-contract.ts';
import type {
  SecCurrentWorkLifecycleV1,
  SecWorkDigestV1
} from '../../platform/shared/work-selection-contract.ts';
import {
  createSecWorkCurrentSpecObservationV1,
  createSecWorkDecisionReceiptV1,
  createSecWorkRegistryObservationV1,
  currentSpecRevisionFromBodyV1,
  parseSecRoadmapWorkCatalogV1,
  renderSecWorkRollingPlanV1,
  resolvedSecWorkSelectionLiveResultV1,
  unresolvedSecWorkSelectionLiveResultV1,
  type SecRoadmapWorkCatalogItemV1,
  type SecWorkCurrentSpecObservationV1,
  type SecWorkDecisionReceiptV1,
  type SecWorkRegistryObservationV1,
  type SecWorkSelectionLiveResultV1
} from '../../platform/shared/work-selection-live-contract.ts';
import { projectBranchLifecycleForWorkSelectionV1 } from './branch-lifecycle-audit.ts';
import {
  createBranchLifecycleGitChildEnvironmentV1,
  createBranchLifecycleGitHubRemoteObservationV1
} from './branch-lifecycle-command.ts';
import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1
} from './document-control-plane-contract.ts';
import { buildGitHubDefaultBranchOpenPullRequestsArgsV1 } from './document-control-plane-github-observation.ts';
import {
  observeCanonicalMainHealthForWorkSelectionV1,
  observeHostedMainHealthChecksV1
} from './main-health-provider-observation.ts';
import { createVerificationSessionGitHubClientV1 } from './verification-session-github.ts';
import {
  parseOpenPullRequestList,
  projectWorkPackageRegistry
} from './verification-session.ts';
import {
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from './work-package-contract.ts';

const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

interface CommandResultV1 {
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

type CommandRunnerV1 = (
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  environment?: Readonly<NodeJS.ProcessEnv>
) => CommandResultV1;

export interface ObserveSecWorkSelectionLiveInputV1 {
  readonly cwd: string;
  /**
   * A trusted caller such as document-control may pass its already observed
   * local default. The caller still owns the sole live-default admission.
   */
  readonly exactMain?: string;
  readonly exactMainTree?: string;
}

class LiveObservationFailure extends Error {
  readonly reasonCode: string;
  readonly blockerRef: SecWorkDigestV1;

  constructor(reasonCode: string, blockerBytes: Uint8Array | string) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.blockerRef = rawSha256(blockerBytes);
  }
}

function runDefault(
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  environment?: Readonly<NodeJS.ProcessEnv>
): CommandResultV1 {
  if (args.some((argument) => argument.includes('\0'))) {
    throw new LiveObservationFailure('command-argument-invalid', command);
  }
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    env: environment ?? (command === 'git'
      ? createBranchLifecycleGitChildEnvironmentV1(process.env)
      : { ...process.env, GH_PROMPT_DISABLED: '1' })
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : Buffer.from(String(result.stderr ?? result.error?.message ?? ''))
  };
}

function combinedFailureBytes(result: CommandResultV1): Buffer {
  return Buffer.concat([result.stdout, Buffer.from('\0'), result.stderr]);
}

function requireCommand(
  run: CommandRunnerV1,
  command: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  reasonCode: string,
  environment?: Readonly<NodeJS.ProcessEnv>
): Buffer {
  const result = run(command, args, cwd, environment);
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

function repositoryRoot(
  run: CommandRunnerV1,
  cwd: string
): string {
  const bytes = requireCommand(run, 'git', ['rev-parse', '--show-toplevel'], cwd,
    'repository-root-unresolved');
  return path.resolve(decodeUtf8(bytes, 'repository-root-invalid').trim());
}

function readGitBlob(
  run: CommandRunnerV1,
  root: string,
  object: string,
  reasonCode: string
): Buffer {
  return requireCommand(run, 'git', ['show', object], root, reasonCode);
}

function resolveCanonicalDefaultProjection(input: {
  run: CommandRunnerV1;
  root: string;
}): {
  stateBytes: Buffer;
  state: ReturnType<typeof CodexDevelopmentParseCurrentStateSpecV1>;
} {
  const source = decodeUtf8(requireCommand(input.run, 'git', [
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
  const stateBytes = readGitBlob(
    input.run,
    input.root,
    `${defaultRef}:docs/work/current-state.yaml`,
    'trusted-current-state-unresolved'
  );
  const state = CodexDevelopmentParseCurrentStateSpecV1(
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

function resolveExactMain(input: {
  run: CommandRunnerV1;
  root: string;
  remote: string;
  repository: string;
  defaultBranch: string;
  supplied?: string;
}): string {
  const local = gitSha(decodeUtf8(requireCommand(
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
  const remoteObservation = createBranchLifecycleGitHubRemoteObservationV1(
    input.repository,
    process.env
  );
  const liveLine = decodeUtf8(requireCommand(
    input.run,
    'git',
    [
      ...remoteObservation.argumentsPrefix,
      'ls-remote', '--exit-code', remoteObservation.repositoryUrl,
      `refs/heads/${input.defaultBranch}`
    ],
    input.root,
    'live-default-unresolved',
    remoteObservation.environment
  ), 'live-default-invalid').trim();
  const live = gitSha(liveLine.split(/\s+/u)[0] ?? '', 'live-default-invalid');
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

function observeCurrentSpecs(input: {
  run: CommandRunnerV1;
  root: string;
  repository: string;
  items: readonly SecRoadmapWorkCatalogItemV1[];
}): SecWorkCurrentSpecObservationV1[] {
  const [owner, name, extra] = input.repository.split('/');
  if (owner === undefined || name === undefined || extra !== undefined) {
    throw new LiveObservationFailure('repository-identity-invalid', input.repository);
  }
  const aliases = input.items.map((item, index) => ({
    alias: `i${index}`,
    item,
    issueNumber: parseIssueNumber(item.currentSpecRef)
  }));
  const selections = aliases.map(({ alias, issueNumber }) => (
    `${alias}: issue(number: ${issueNumber}) { number id state body }`
  )).join('\n');
  const query = `query($owner: String!, $name: String!) {\n`
    + `  repository(owner: $owner, name: $name) {\n${selections}\n  }\n}`;
  const responseBytes = requireCommand(input.run, 'gh', [
    'api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`
  ], input.root, 'current-spec-provider-unavailable');
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(responseBytes, 'current-spec-response-invalid-utf8'));
  } catch {
    throw new LiveObservationFailure('current-spec-response-malformed', responseBytes);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveObservationFailure('current-spec-response-malformed', responseBytes);
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.errors !== undefined
      && (!Array.isArray(envelope.errors) || envelope.errors.length > 0)) {
    throw new LiveObservationFailure('current-spec-provider-errors', responseBytes);
  }
  const data = envelope.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new LiveObservationFailure('current-spec-response-malformed', responseBytes);
  }
  const repository = (data as Record<string, unknown>).repository;
  if (repository === null || typeof repository !== 'object' || Array.isArray(repository)) {
    throw new LiveObservationFailure('current-spec-repository-missing', responseBytes);
  }
  const records = repository as Record<string, unknown>;
  return aliases.map(({ alias, item, issueNumber }) => {
    const issue = records[alias];
    if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
      throw new LiveObservationFailure('current-spec-resource-missing', responseBytes);
    }
    const record = issue as Record<string, unknown>;
    if (record.number !== issueNumber
        || typeof record.id !== 'string' || record.id.length === 0
        || (record.state !== 'OPEN' && record.state !== 'CLOSED')
        || typeof record.body !== 'string' || record.body.length === 0) {
      throw new LiveObservationFailure('current-spec-resource-malformed', responseBytes);
    }
    return createSecWorkCurrentSpecObservationV1({
      workId: item.workId,
      currentSpecRef: item.currentSpecRef,
      providerResourceRef: `github-node:${record.id}`,
      providerState: record.state === 'OPEN' ? 'open' : 'closed',
      currentSpecRevision: currentSpecRevisionFromBodyV1(record.body)
    });
  });
}

function observeOpenPullRequests(input: {
  run: CommandRunnerV1;
  root: string;
  repository: string;
  defaultBranch: string;
}) {
  const bytes = requireCommand(
    input.run,
    'gh',
    buildGitHubDefaultBranchOpenPullRequestsArgsV1(input.repository, input.defaultBranch),
    input.root,
    'open-pr-provider-unavailable'
  );
  try {
    return parseOpenPullRequestList(decodeUtf8(bytes, 'open-pr-response-invalid-utf8'));
  } catch {
    throw new LiveObservationFailure('open-pr-response-malformed', bytes);
  }
}

function observeRegistry(input: {
  root: string;
  repository: string;
  defaultBranch: string;
  exactMain: string;
  exactMainTree: string;
  openPullRequests: ReturnType<typeof parseOpenPullRequestList>;
}): SecWorkRegistryObservationV1 {
  let projected: string;
  try {
    projected = projectWorkPackageRegistry({
      repositoryRoot: input.root,
      observedAt: '1970-01-01T00:00:00.000Z',
      repository: input.repository,
      defaultBranch: input.defaultBranch,
      defaultRef: input.exactMain,
      openPullRequests: input.openPullRequests
    });
  } catch (error) {
    throw new LiveObservationFailure(
      'work-package-registry-unresolved',
      error instanceof Error ? error.message : String(error)
    );
  }
  let registry: ReturnType<typeof parseVerificationRegistryProjectionV1>;
  try {
    registry = parseVerificationRegistryProjectionV1(projected);
  } catch {
    throw new LiveObservationFailure('work-package-registry-malformed', projected);
  }
  if (registry.defaultTreeSha !== input.exactMainTree) {
    throw new LiveObservationFailure(
      'work-package-registry-tree-drift',
      `${registry.defaultTreeSha}:${input.exactMainTree}`
    );
  }
  return createSecWorkRegistryObservationV1({
    defaultTreeSha: registry.defaultTreeSha,
    entries: registry.entries.map((entry) => ({ ...entry }))
  });
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

export function isWorkSelectionProspectiveTransportV1(input: Readonly<{
  currentBranch: string;
  currentHead: string;
  defaultBranch: string;
  exactMain: string;
}>): boolean {
  return input.currentBranch.length > 0
    && input.currentBranch !== input.defaultBranch
    && input.currentHead === input.exactMain;
}

export function isExactWorkSelectionActiveIdentityV1(input: Readonly<{
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

function observeCanonicalBranchLifecycle(input: {
  run: CommandRunnerV1;
  root: string;
  remote: string;
  repository: string;
  defaultBranch: string;
  exactMain: string;
  openPullRequests: ReturnType<typeof parseOpenPullRequestList>;
}) {
  const local = parseRefLines(decodeUtf8(requireCommand(input.run, 'git', [
    'for-each-ref', '--format=%(refname:lstrip=2)%00%(objectname)', 'refs/heads/'
  ], input.root, 'local-candidate-ref-unresolved'), 'local-candidate-ref-invalid-utf8'))
    .filter(({ branch }) => branch !== input.defaultBranch);
  const remoteObservation = createBranchLifecycleGitHubRemoteObservationV1(
    input.repository,
    process.env
  );
  const remoteResult = input.run('git', [
    ...remoteObservation.argumentsPrefix,
    'ls-remote', '--heads', remoteObservation.repositoryUrl
  ], input.root, remoteObservation.environment);
  if (remoteResult.status !== 0) {
    throw new LiveObservationFailure('remote-candidate-ref-unresolved', combinedFailureBytes(remoteResult));
  }
  const remote = parseRemoteRefLines(
    decodeUtf8(remoteResult.stdout, 'remote-candidate-ref-invalid-utf8')
  ).filter(({ branch }) => branch !== input.defaultBranch);
  const worktrees = parseWorktrees(decodeUtf8(requireCommand(input.run, 'git', [
    'worktree', 'list', '--porcelain'
  ], input.root, 'worktree-inventory-unresolved'), 'worktree-inventory-invalid-utf8'));
  const currentBranch = decodeUtf8(requireCommand(input.run, 'git', [
    'branch', '--show-current'
  ], input.root, 'current-candidate-branch-unresolved'), 'current-candidate-branch-invalid-utf8').trim();
  const currentHead = gitSha(decodeUtf8(requireCommand(input.run, 'git', [
    'rev-parse', 'HEAD'
  ], input.root, 'current-candidate-head-unresolved'), 'current-candidate-head-invalid-utf8'),
  'current-candidate-head-invalid');
  const currentTransportBranch = isWorkSelectionProspectiveTransportV1({
    currentBranch,
    currentHead,
    defaultBranch: input.defaultBranch,
    exactMain: input.exactMain
  })
    ? currentBranch
    : null;
  const currentWorktreeRef = rawSha256(normalizePhysicalPath(input.root));
  return projectBranchLifecycleForWorkSelectionV1({
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
    openPullRequests: input.openPullRequests.map(({
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
    prospectiveTransport: currentTransportBranch === null ? null : {
      branch: currentTransportBranch,
      headSha: currentHead,
      worktreeRef: currentWorktreeRef
    }
  });
}

function observeCanonicalMainHealth(input: {
  root: string;
  repository: string;
  defaultBranch: string;
  exactMain: string;
  exactMainTree: string;
}): Readonly<{
  state: SecCurrentWorkLifecycleV1['mainHealthState'];
  ref: SecWorkDigestV1;
}> {
  const observedAt = new Date().toISOString();
  const expiresAt = new Date(new Date(observedAt).getTime() + 300_000).toISOString();
  const github = createVerificationSessionGitHubClientV1(input.root);
  const hosted = observeHostedMainHealthChecksV1({
    repository: input.repository,
    mainSha: input.exactMain,
    observeChecks: () => github.observeChecks(input.repository, input.exactMain)
  });
  return observeCanonicalMainHealthForWorkSelectionV1({
    repositoryRoot: input.root,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.exactMain,
    mainTreeSha: input.exactMainTree,
    now: observedAt,
    hostedExpiresAt: expiresAt,
    hosted
  });
}

function observeCanonicalControl(input: {
  spec: ReturnType<typeof CodexDevelopmentParseCurrentStateSpecV1>;
  pointerSource: string;
  rollingPlanSource: string;
  manifestPath: string;
  manifestBytes: Buffer;
}): Readonly<{
  state: SecCurrentWorkLifecycleV1['controlState'];
  ref: SecWorkDigestV1;
}> {
  const pointer = CodexDevelopmentParseActivePointerV2(input.pointerSource);
  CodexDevelopmentAssertControlPlaneBindingV1({ spec: input.spec, pointer });
  const rolling = CodexDevelopmentParseRollingPlanV1(input.rollingPlanSource);
  const manifest = CodexDevelopmentParseWorkPackageManifest(
    decodeUtf8(input.manifestBytes, 'active-manifest-invalid-utf8'),
    input.manifestPath
  );
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(input.manifestBytes);
  const ref = sha256({ pointer, rolling, manifest: {
    path: input.manifestPath,
    id: manifest.id,
    tracking: manifest.tracking,
    digest: manifestDigest
  } }) as SecWorkDigestV1;
  return Object.freeze({
    state: pointer.manifest === input.manifestPath
        && pointer.manifestDigest === manifestDigest
        && rolling.activePackageId === manifest.id
      ? 'consistent'
      : 'conflict',
    ref
  });
}

function currentLifecycle(input: {
  registry: SecWorkRegistryObservationV1;
  catalogItems: readonly SecRoadmapWorkCatalogItemV1[];
  openPullRequests: ReturnType<typeof parseOpenPullRequestList>;
  branchLifecycle: ReturnType<typeof projectBranchLifecycleForWorkSelectionV1>;
  mainHealth: ReturnType<typeof observeCanonicalMainHealth>;
  control: ReturnType<typeof observeCanonicalControl>;
}): SecCurrentWorkLifecycleV1 {
  const openEntries = input.registry.entries.filter(({ source }) => source === 'open-pr');
  if (input.openPullRequests.length > 0) {
    const entry = openEntries.length === 1 ? openEntries[0] : undefined;
    const packageId = entry?.manifestPath.slice('docs/work-packages/'.length, -'.md'.length);
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
    }) as SecWorkDigestV1;
    if (input.openPullRequests.length === 1 && entry !== undefined && item !== undefined) {
      const pullRequest = input.openPullRequests[0]!;
      const exactActiveIdentity = isExactWorkSelectionActiveIdentityV1({
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

export function observeSecWorkSelectionLiveV1(
  input: ObserveSecWorkSelectionLiveInputV1
): SecWorkSelectionLiveResultV1 {
  const run = runDefault;
  try {
    const root = repositoryRoot(run, input.cwd);
    const defaultProjection = resolveCanonicalDefaultProjection({ run, root });
    const exactMain = resolveExactMain({
      run,
      root,
      remote: defaultProjection.state.resolver.remote,
      repository: defaultProjection.state.resolver.repository,
      defaultBranch: defaultProjection.state.resolver.defaultBranch,
      supplied: input.exactMain
    });
    const trustedStateBytes = readGitBlob(run, root, `${exactMain}:docs/work/current-state.yaml`,
      'trusted-current-state-unresolved');
    if (!trustedStateBytes.equals(defaultProjection.stateBytes)) {
      throw new LiveObservationFailure(
        'default-current-state-raced',
        `${rawSha256(trustedStateBytes)}:${rawSha256(defaultProjection.stateBytes)}`
      );
    }
    const state = CodexDevelopmentParseCurrentStateSpecV1(
      decodeUtf8(trustedStateBytes, 'trusted-current-state-invalid-utf8')
    );
    const actualTree = gitSha(decodeUtf8(requireCommand(run, 'git', [
      'rev-parse', `${exactMain}^{tree}`
    ], root, 'exact-main-tree-unresolved'), 'exact-main-tree-invalid'), 'exact-main-tree-invalid');
    const exactMainTree = input.exactMainTree === undefined
      ? actualTree
      : gitSha(input.exactMainTree, 'supplied-main-tree-invalid');
    if (actualTree !== exactMainTree) {
      throw new LiveObservationFailure('supplied-main-tree-drift', `${actualTree}:${exactMainTree}`);
    }
    const roadmapBytes = readGitBlob(run, root, `${exactMain}:docs/roadmap.md`,
      'roadmap-unresolved');
    const roadmapSource = decodeUtf8(roadmapBytes, 'roadmap-invalid-utf8');
    const catalog = parseSecRoadmapWorkCatalogV1(roadmapSource);
    const currentSpecs = observeCurrentSpecs({
      run,
      root,
      repository: state.resolver.repository,
      items: catalog.items
    });
    const openPullRequests = observeOpenPullRequests({
      run,
      root,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch
    });
    if (openPullRequests.length > 1) {
      throw new LiveObservationFailure(
        'multiple-open-prs-unresolved',
        JSON.stringify(openPullRequests.map((pullRequest) => ({
          number: pullRequest.number,
          headBranch: pullRequest.headBranch,
          headSha: pullRequest.headSha,
          baseBranch: pullRequest.baseBranch,
          baseSha: pullRequest.baseSha
        })))
      );
    }
    const registry = observeRegistry({
      root,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch,
      exactMain,
      exactMainTree,
      openPullRequests
    });
    const branchLifecycle = observeCanonicalBranchLifecycle({
      run,
      root,
      remote: state.resolver.remote,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch,
      exactMain,
      openPullRequests
    });
    const pointerBytes = readGitBlob(run, root, `${exactMain}:docs/work/active-work-package.md`,
      'active-pointer-unresolved');
    const pointerSource = decodeUtf8(pointerBytes, 'active-pointer-invalid-utf8');
    const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
    const rollingPlanSource = decodeUtf8(readGitBlob(
      run,
      root,
      `${exactMain}:docs/work/rolling-plan.md`,
      'rolling-plan-unresolved'
    ), 'rolling-plan-invalid-utf8');
    const activeManifestBytes = readGitBlob(
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
    const mainHealth = observeCanonicalMainHealth({
      root,
      repository: state.resolver.repository,
      defaultBranch: state.resolver.defaultBranch,
      exactMain,
      exactMainTree
    });
    const current = currentLifecycle({
      registry,
      catalogItems: catalog.items,
      openPullRequests,
      branchLifecycle,
      mainHealth,
      control
    });
    const receipt = createSecWorkDecisionReceiptV1({
      repository: state.resolver.repository,
      exactMain,
      exactMainTree,
      roadmapRevision: rawSha256(roadmapBytes),
      catalog,
      registry,
      current,
      currentSpecs
    });
    return resolvedSecWorkSelectionLiveResultV1(receipt);
  } catch (error) {
    if (error instanceof LiveObservationFailure) {
      return unresolvedSecWorkSelectionLiveResultV1({
        reasonCodes: [error.reasonCode],
        blockerRefs: [error.blockerRef]
      });
    }
    return unresolvedSecWorkSelectionLiveResultV1({
      reasonCodes: ['live-observation-unsupported'],
      blockerRefs: [rawSha256(error instanceof Error ? error.message : String(error))]
    });
  }
}

export function requireResolvedSecWorkDecisionReceiptV1(
  result: SecWorkSelectionLiveResultV1
): SecWorkDecisionReceiptV1 {
  if (result.status !== 'resolved') {
    throw new Error(
      `Work selection is unresolved (${result.reasonCodes.join(',')}): ${result.blockerRefs.join(',')}`
    );
  }
  return result.receipt;
}

function usage(): string {
  return 'Usage:\n'
    + '  bun scripts/codex/work-selection.ts observe [--json]\n'
    + '  bun scripts/codex/work-selection.ts project --reviewed-on <YYYY-MM-DD> [--json]\n';
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'observe' && command !== 'project') throw new Error(usage());
  const jsonCount = args.filter((argument) => argument === '--json').length;
  if (jsonCount > 1) throw new Error(usage());
  const json = jsonCount === 1;
  if (command === 'observe'
      && args.some((argument) => argument !== '--json')) throw new Error(usage());
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
  const result = observeSecWorkSelectionLiveV1({ cwd: process.cwd() });
  if (command === 'observe') {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== 'resolved') process.exitCode = 2;
    return;
  }
  const receipt = requireResolvedSecWorkDecisionReceiptV1(result);
  const source = renderSecWorkRollingPlanV1({ receipt, reviewedOn: reviewedOn! });
  if (json) {
    process.stdout.write(`${JSON.stringify({ result, rollingPlanSource: source }, null, 2)}\n`);
  } else {
    process.stdout.write(source);
  }
}

if (import.meta.main) main();
