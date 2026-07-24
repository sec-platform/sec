import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

export const CodexDevelopmentCurrentStateSchemaV1 = 'sec-current-state-live-v1' as const;
export const CodexDevelopmentActivePointerSchemaV2 = 'sec-active-work-package-pointer-v2' as const;

export type CodexDevelopmentDefaultRefState = 'fresh' | 'stale' | 'unavailable';
export type CodexDevelopmentActiveWorkPackageResolution =
  | { state: 'active'; manifest: string; manifestDigest: string }
  | { state: 'invalid'; reason: 'candidate-digest-mismatch' }
  | { state: 'none'; reason: 'matching-default-blob' }
  | { state: 'unresolved'; reason: 'default-ref-stale' | 'default-ref-unavailable' };

export interface CodexDevelopmentCurrentStateSpecV1 {
  schema: typeof CodexDevelopmentCurrentStateSchemaV1;
  resolver: {
    command: string;
    repository: string;
    remote: string;
    defaultBranch: string;
    defaultRef: string;
    requireRemoteMatch: boolean;
  };
  stableFacts: Record<string, unknown>;
}

export interface CodexDevelopmentActivePointerV2 {
  schema: typeof CodexDevelopmentActivePointerSchemaV2;
  selectionMode: 'exact-manifest-not-on-default-branch-v1';
  defaultBranchRef: string;
  defaultRefFreshness: 'live-platform-match-required';
  manifest: string;
  manifestDigest: `sha256:${string}`;
  digestBytes: 'git-blob';
  unavailableDefaultRef: 'unresolved';
  matchingDefaultBlob: 'none';
}

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const ExternalCommandTimeoutMs = 30_000;
const ExternalCommandMaxBufferBytes = 8 * 1024 * 1024;

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function repositoryValue(value: unknown, label: string): string {
  const repository = stringValue(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(repository)) {
    throw new Error(`${label} must be one bounded owner/name repository.`);
  }
  return repository;
}

function remoteNameValue(value: unknown, label: string): string {
  const remote = stringValue(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(remote)) {
    throw new Error(`${label} must be one bounded option-safe Git remote name.`);
  }
  return remote;
}

function branchNameValue(value: unknown, label: string): string {
  const branch = stringValue(value, label);
  if (
    branch.length > 255
    || branch === '@'
    || branch.startsWith('-')
    || branch.startsWith('/')
    || branch.endsWith('/')
    || branch.endsWith('.')
    || branch.includes('..')
    || branch.includes('@{')
    || branch.includes('//')
    || /[\u0000-\u0020\u007f~^:?*[\]\\]/u.test(branch)
    || branch.split('/').some((segment) => segment.startsWith('.') || segment.endsWith('.lock'))
  ) {
    throw new Error(`${label} must be one bounded option-safe Git branch name.`);
  }
  return branch;
}

function manifestPathValue(value: unknown, label: string): string {
  const manifest = stringValue(value, label);
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifest)) {
    throw new Error(`${label} must be one canonical Work Package manifest path.`);
  }
  return manifest;
}

function parseMarkdownFrontmatter(source: string): Record<string, unknown> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) throw new Error('Markdown frontmatter is required.');
  const parsed = parseYaml(match[1]);
  assertRecord(parsed, 'Markdown frontmatter');
  return parsed;
}

function parsePointerBlock(source: string): Record<string, unknown> {
  const match = source.match(/```yaml\r?\n([\s\S]*?)\r?\n```/u);
  if (!match) throw new Error('Active pointer YAML block is required.');
  const parsed = parseYaml(match[1]);
  assertRecord(parsed, 'Active pointer YAML block');
  return parsed;
}

export function CodexDevelopmentGitBlobSha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function CodexDevelopmentParseCurrentStateSpecV1(
  source: string
): CodexDevelopmentCurrentStateSpecV1 {
  const parsed = parseYaml(source);
  assertRecord(parsed, 'Current-state spec');
  if (parsed.schema !== CodexDevelopmentCurrentStateSchemaV1) {
    throw new Error(`Current-state schema must be ${CodexDevelopmentCurrentStateSchemaV1}.`);
  }
  assertExactKeys(parsed, ['schema', 'resolver', 'stableFacts'], 'Current-state spec');
  assertRecord(parsed.resolver, 'Current-state resolver');
  assertExactKeys(parsed.resolver, [
    'command',
    'repository',
    'remote',
    'defaultBranch',
    'defaultRef',
    'requireRemoteMatch'
  ], 'Current-state resolver');
  assertRecord(parsed.stableFacts, 'Current-state stableFacts');
  const command = stringValue(parsed.resolver.command, 'Current-state resolver.command');
  if (command !== 'bun scripts/codex/document-control-plane.ts status --json') {
    throw new Error('Current-state resolver.command must select the canonical live resolver.');
  }
  const repository = repositoryValue(
    parsed.resolver.repository,
    'Current-state resolver.repository'
  );
  const remote = remoteNameValue(parsed.resolver.remote, 'Current-state resolver.remote');
  const defaultBranch = branchNameValue(
    parsed.resolver.defaultBranch,
    'Current-state resolver.defaultBranch'
  );
  const defaultRef = stringValue(parsed.resolver.defaultRef, 'Current-state resolver.defaultRef');
  if (defaultRef !== `refs/remotes/${remote}/${defaultBranch}`) {
    throw new Error('Current-state resolver.defaultRef must match remote and defaultBranch.');
  }
  const requireRemoteMatch = booleanValue(
    parsed.resolver.requireRemoteMatch,
    'Current-state resolver.requireRemoteMatch'
  );
  if (!requireRemoteMatch) {
    throw new Error('Current-state resolver.requireRemoteMatch must be true.');
  }
  return {
    schema: CodexDevelopmentCurrentStateSchemaV1,
    resolver: {
      command,
      repository,
      remote,
      defaultBranch,
      defaultRef,
      requireRemoteMatch
    },
    stableFacts: parsed.stableFacts
  };
}

export function CodexDevelopmentParseActivePointerV2(
  source: string
): CodexDevelopmentActivePointerV2 {
  const frontmatter = parseMarkdownFrontmatter(source);
  if (frontmatter.schema !== CodexDevelopmentActivePointerSchemaV2) {
    throw new Error(`Active pointer schema must be ${CodexDevelopmentActivePointerSchemaV2}.`);
  }
  assertExactKeys(frontmatter, ['schema', 'status', 'last-reviewed'], 'Active pointer frontmatter');
  const pointer = parsePointerBlock(source);
  assertExactKeys(pointer, [
    'selectionMode',
    'defaultBranchRef',
    'defaultRefFreshness',
    'manifest',
    'manifestDigest',
    'digestBytes',
    'unavailableDefaultRef',
    'matchingDefaultBlob'
  ], 'Active pointer');
  if (frontmatter.status !== 'conditional') {
    throw new Error('Active pointer status must be conditional.');
  }
  if (
    typeof frontmatter['last-reviewed'] !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(frontmatter['last-reviewed'])
  ) {
    throw new Error('Active pointer last-reviewed must be an ISO calendar date.');
  }
  if (pointer.selectionMode !== 'exact-manifest-not-on-default-branch-v1') {
    throw new Error('Active pointer selectionMode is unsupported.');
  }
  if (pointer.defaultRefFreshness !== 'live-platform-match-required') {
    throw new Error('Active pointer must require a live platform-matched default ref.');
  }
  if (pointer.digestBytes !== 'git-blob') {
    throw new Error('Active pointer digestBytes must be git-blob.');
  }
  if (pointer.unavailableDefaultRef !== 'unresolved' || pointer.matchingDefaultBlob !== 'none') {
    throw new Error('Active pointer fail-closed outcomes are invalid.');
  }
  const manifestDigest = stringValue(pointer.manifestDigest, 'Active pointer manifestDigest');
  if (!/^sha256:[0-9a-f]{64}$/u.test(manifestDigest)) {
    throw new Error('Active pointer manifestDigest must be a SHA-256 digest.');
  }
  return {
    schema: CodexDevelopmentActivePointerSchemaV2,
    selectionMode: 'exact-manifest-not-on-default-branch-v1',
    defaultBranchRef: stringValue(pointer.defaultBranchRef, 'Active pointer defaultBranchRef'),
    defaultRefFreshness: 'live-platform-match-required',
    manifest: manifestPathValue(pointer.manifest, 'Active pointer manifest'),
    manifestDigest: manifestDigest as `sha256:${string}`,
    digestBytes: 'git-blob',
    unavailableDefaultRef: 'unresolved',
    matchingDefaultBlob: 'none'
  };
}

export function CodexDevelopmentAssertControlPlaneBindingV1(input: {
  spec: CodexDevelopmentCurrentStateSpecV1;
  pointer: CodexDevelopmentActivePointerV2;
}): void {
  if (input.pointer.defaultBranchRef !== input.spec.resolver.defaultRef) {
    throw new Error('Active pointer defaultBranchRef must match the current-state defaultRef.');
  }
}

export function CodexDevelopmentResolveActiveWorkPackageV1(input: {
  pointer: CodexDevelopmentActivePointerV2;
  candidateManifestBlob: Uint8Array;
  defaultManifestBlob: Uint8Array | null;
  defaultRefState: CodexDevelopmentDefaultRefState;
}): CodexDevelopmentActiveWorkPackageResolution {
  if (input.defaultRefState === 'unavailable') {
    return { state: 'unresolved', reason: 'default-ref-unavailable' };
  }
  if (input.defaultRefState === 'stale') {
    return { state: 'unresolved', reason: 'default-ref-stale' };
  }
  if (CodexDevelopmentGitBlobSha256(input.candidateManifestBlob) !== input.pointer.manifestDigest) {
    return { state: 'invalid', reason: 'candidate-digest-mismatch' };
  }
  if (
    input.defaultManifestBlob !== null
    && CodexDevelopmentGitBlobSha256(input.defaultManifestBlob) === input.pointer.manifestDigest
  ) {
    return { state: 'none', reason: 'matching-default-blob' };
  }
  return {
    state: 'active',
    manifest: input.pointer.manifest,
    manifestDigest: input.pointer.manifestDigest
  };
}

function run(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: ExternalCommandTimeoutMs,
    maxBuffer: ExternalCommandMaxBufferBytes,
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? ''
  };
}

function requireCommand(result: CommandResult, label: string): string {
  if (result.code !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  return result.stdout.trim();
}

function readGitBlob(cwd: string, spec: string): Buffer | undefined {
  const result = spawnSync('git', ['show', spec], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: ExternalCommandTimeoutMs,
    maxBuffer: ExternalCommandMaxBufferBytes,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  return result.status === 0 ? result.stdout : undefined;
}

function parseJsonArray(source: string, label: string): unknown[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) throw new Error(`${label} must return a JSON array.`);
  return parsed;
}

function parseReviewThreads(source: string): unknown[] {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'gh review-thread response');
  assertRecord(parsed.data, 'gh review-thread response.data');
  assertRecord(parsed.data.repository, 'gh review-thread response.data.repository');
  assertRecord(
    parsed.data.repository.pullRequests,
    'gh review-thread response.data.repository.pullRequests'
  );
  const connection = parsed.data.repository.pullRequests;
  if (!Array.isArray(connection.nodes)) {
    throw new Error('gh review-thread response nodes must be an array.');
  }
  assertRecord(connection.pageInfo, 'gh review-thread response.pageInfo');
  if (connection.pageInfo.hasNextPage === true) {
    throw new Error('gh review-thread response exceeded the bounded first page.');
  }
  for (const pullRequest of connection.nodes) {
    assertRecord(pullRequest, 'gh review-thread pull request');
    assertRecord(pullRequest.reviewThreads, 'gh review-thread pull request.reviewThreads');
    const reviewThreads = pullRequest.reviewThreads;
    if (!Array.isArray(reviewThreads.nodes)) {
      throw new Error('gh review-thread pull request nodes must be an array.');
    }
    assertRecord(reviewThreads.pageInfo, 'gh review-thread pull request.pageInfo');
    if (
      reviewThreads.pageInfo.hasNextPage === true
      || reviewThreads.totalCount !== reviewThreads.nodes.length
    ) {
      throw new Error('gh review-thread pull request exceeded the bounded first page.');
    }
    for (const thread of reviewThreads.nodes) {
      assertRecord(thread, 'gh review thread');
      if (typeof thread.isResolved !== 'boolean') {
        throw new Error('gh review thread.isResolved must be a boolean.');
      }
    }
  }
  return connection.nodes;
}

async function resolveLiveControlPlane(cwd: string): Promise<Record<string, unknown>> {
  const repositoryRoot = requireCommand(
    run('git', ['rev-parse', '--show-toplevel'], cwd),
    'git repository discovery'
  );
  const statePath = path.join(repositoryRoot, 'docs/work/current-state.yaml');
  const pointerPath = path.join(repositoryRoot, 'docs/work/active-work-package.md');
  const [stateSource, pointerSource] = await Promise.all([
    readFile(statePath, 'utf8'),
    readFile(pointerPath, 'utf8')
  ]);
  const spec = CodexDevelopmentParseCurrentStateSpecV1(stateSource);
  const pointer = CodexDevelopmentParseActivePointerV2(pointerSource);
  CodexDevelopmentAssertControlPlaneBindingV1({ spec, pointer });

  const localDefaultShaResult = run('git', ['rev-parse', '--verify', spec.resolver.defaultRef], repositoryRoot);
  const remoteLineResult = run(
    'git',
    ['ls-remote', '--exit-code', spec.resolver.remote, `refs/heads/${spec.resolver.defaultBranch}`],
    repositoryRoot
  );
  const localDefaultSha = localDefaultShaResult.code === 0
    ? localDefaultShaResult.stdout.trim()
    : undefined;
  const liveDefaultSha = remoteLineResult.code === 0
    ? remoteLineResult.stdout.trim().split(/\s+/u)[0]
    : undefined;
  const defaultRefState: CodexDevelopmentDefaultRefState = (
    localDefaultSha === undefined || liveDefaultSha === undefined
      ? 'unavailable'
      : localDefaultSha === liveDefaultSha
        ? 'fresh'
        : 'stale'
  );

  const candidateManifestBlob = readGitBlob(repositoryRoot, `:${pointer.manifest}`);
  if (!candidateManifestBlob) throw new Error('Candidate manifest is absent from the Git index.');
  const defaultManifestBlob = defaultRefState === 'fresh'
    ? readGitBlob(repositoryRoot, `${spec.resolver.defaultRef}:${pointer.manifest}`) ?? null
    : null;
  const activeWorkPackage = CodexDevelopmentResolveActiveWorkPackageV1({
    pointer,
    candidateManifestBlob,
    defaultManifestBlob,
    defaultRefState
  });

  const mainTree = defaultRefState === 'fresh'
    ? requireCommand(
        run('git', ['rev-parse', `${spec.resolver.defaultRef}^{tree}`], repositoryRoot),
        'default-branch tree resolution'
      )
    : undefined;
  const headSha = requireCommand(
    run('git', ['rev-parse', 'HEAD'], repositoryRoot),
    'candidate head resolution'
  );
  const branch = requireCommand(
    run('git', ['branch', '--show-current'], repositoryRoot),
    'candidate branch resolution'
  ) || '(detached)';
  const mergeBase = defaultRefState === 'fresh'
    ? requireCommand(
        run('git', ['merge-base', spec.resolver.defaultRef, 'HEAD'], repositoryRoot),
        'candidate merge-base resolution'
      )
    : undefined;
  const worktreeStatus = requireCommand(
    run('git', ['status', '--short', '--branch'], repositoryRoot),
    'worktree status'
  );
  const pullRequestsResult = run('gh', [
    'pr',
    'list',
    '--repo',
    spec.resolver.repository,
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,isDraft,headRefOid,baseRefOid,mergeStateStatus,reviewDecision,reviewRequests,latestReviews,reviews,comments,statusCheckRollup'
  ], repositoryRoot);
  const issuesResult = run('gh', [
    'issue',
    'list',
    '--repo',
    spec.resolver.repository,
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title'
  ], repositoryRoot);
  const [repositoryOwner, repositoryName] = spec.resolver.repository.split('/');
  const reviewThreadsResult = repositoryOwner && repositoryName
    ? run('gh', [
        'api',
        'graphql',
        '-f',
        `query=query($owner:String!,$name:String!){repository(owner:$owner,name:$name){pullRequests(first:100,states:OPEN,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number reviewThreads(first:100){totalCount nodes{isResolved}pageInfo{hasNextPage}}}pageInfo{hasNextPage}}}}`,
        '-F',
        `owner=${repositoryOwner}`,
        '-F',
        `name=${repositoryName}`
      ], repositoryRoot)
    : { code: 1, stdout: '', stderr: 'repository must be owner/name' };
  const githubState = (
    pullRequestsResult.code === 0
    && issuesResult.code === 0
    && reviewThreadsResult.code === 0
  )
    ? (() => {
        const openPullRequests = parseJsonArray(pullRequestsResult.stdout, 'gh pr list');
        const openIssues = parseJsonArray(issuesResult.stdout, 'gh issue list');
        if (openPullRequests.length >= 100 || openIssues.length >= 100) {
          throw new Error('GitHub PR/Issue facts reached the bounded query limit.');
        }
        return {
          status: 'resolved',
          openPullRequests,
          openIssues,
          reviewThreads: parseReviewThreads(reviewThreadsResult.stdout)
        };
      })()
    : {
        status: 'unresolved',
        reason: [
          pullRequestsResult.code === 0 ? undefined : pullRequestsResult.stderr.trim(),
          issuesResult.code === 0 ? undefined : issuesResult.stderr.trim(),
          reviewThreadsResult.code === 0 ? undefined : reviewThreadsResult.stderr.trim()
        ].filter(Boolean).join(' | ')
      };

  return {
    schema: 'sec-resolved-current-state-v1',
    observedAt: new Date().toISOString(),
    source: 'docs/work/current-state.yaml',
    repository: {
      fullName: spec.resolver.repository,
      defaultBranch: spec.resolver.defaultBranch,
      localDefaultSha,
      liveDefaultSha,
      defaultRefState,
      tree: mainTree
    },
    workspace: {
      headSha,
      branch,
      mergeBase,
      status: worktreeStatus
    },
    github: githubState,
    activeWorkPackage,
    stableFacts: spec.stableFacts
  };
}

async function main(): Promise<void> {
  const [command, format] = process.argv.slice(2);
  if (command !== 'status' || (format !== undefined && format !== '--json')) {
    throw new Error('Usage: bun scripts/codex/document-control-plane.ts status [--json]');
  }
  const resolved = await resolveLiveControlPlane(process.cwd());
  process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
  const repository = resolved.repository as { defaultRefState: CodexDevelopmentDefaultRefState };
  const github = resolved.github as { status: string };
  const active = resolved.activeWorkPackage as CodexDevelopmentActiveWorkPackageResolution;
  if (
    repository.defaultRefState !== 'fresh'
    || github.status !== 'resolved'
    || active.state === 'invalid'
    || active.state === 'unresolved'
  ) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
