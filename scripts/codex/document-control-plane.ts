import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentResolveActiveWorkPackageV1,
  type CodexDevelopmentActiveWorkPackageResolution,
  type CodexDevelopmentDefaultRefState
} from './document-control-plane-contract.ts';
import { CodexDevelopmentProjectExternalGitHubFactsV1 } from './external-collaboration-input-contract.ts';

export {
  CodexDevelopmentActivePointerSchemaV2,
  CodexDevelopmentAssertControlPlaneBindingV1,
  CodexDevelopmentCurrentStateSchemaV1,
  CodexDevelopmentGitBlobSha256,
  CodexDevelopmentParseActivePointerV2,
  CodexDevelopmentParseCurrentStateSpecV1,
  CodexDevelopmentParseRollingPlanV1,
  CodexDevelopmentResolveActiveWorkPackageV1
} from './document-control-plane-contract.ts';
export type {
  CodexDevelopmentActivePointerV2,
  CodexDevelopmentActiveWorkPackageResolution,
  CodexDevelopmentCurrentStateSpecV1,
  CodexDevelopmentDefaultRefState,
  CodexDevelopmentRollingPlanV1
} from './document-control-plane-contract.ts';

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

type WorktreeStatusFacts = Readonly<{
  clean: boolean;
  conflictedCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
}>;

const ExternalCommandTimeoutMs = 30_000;
const ExternalCommandMaxBufferBytes = 8 * 1024 * 1024;
const ConflictStatusPairs = new Set(['AA', 'AU', 'DD', 'DU', 'UA', 'UD', 'UU']);

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
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
    throw new Error(`${label} failed without exposing command output.`);
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
  if (connection.pageInfo.hasNextPage !== false) {
    throw new Error('gh review-thread response exceeded the bounded first page.');
  }
  return connection.nodes;
}

function projectWorktreeStatus(source: string): WorktreeStatusFacts {
  let conflictedCount = 0;
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  for (const line of source.split(/\r?\n/gu)) {
    if (line.length === 0 || line.startsWith('## ')) continue;
    const status = line.slice(0, 2);
    if (status === '??') {
      untrackedCount += 1;
      continue;
    }
    if (ConflictStatusPairs.has(status)) conflictedCount += 1;
    if (status[0] !== ' ' && status[0] !== '?') stagedCount += 1;
    if (status[1] !== ' ' && status[1] !== '?') unstagedCount += 1;
  }
  return Object.freeze({
    clean: conflictedCount + stagedCount + unstagedCount + untrackedCount === 0,
    conflictedCount,
    stagedCount,
    unstagedCount,
    untrackedCount
  });
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
  const mergeBase = defaultRefState === 'fresh'
    ? requireCommand(
        run('git', ['merge-base', spec.resolver.defaultRef, 'HEAD'], repositoryRoot),
        'candidate merge-base resolution'
      )
    : undefined;
  const worktreeStatus = projectWorktreeStatus(requireCommand(
    run('git', ['status', '--short', '--branch'], repositoryRoot),
    'worktree status'
  ));

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
    'number,isDraft,headRefOid,baseRefOid,mergeStateStatus,reviewDecision,reviewRequests,statusCheckRollup'
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
    'number'
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
    : { code: 1, stdout: '', stderr: '' };
  const githubState = (
    pullRequestsResult.code === 0
    && issuesResult.code === 0
    && reviewThreadsResult.code === 0
  )
    ? {
        status: 'resolved',
        ...CodexDevelopmentProjectExternalGitHubFactsV1({
          pullRequests: parseJsonArray(pullRequestsResult.stdout, 'gh pr list'),
          issues: parseJsonArray(issuesResult.stdout, 'gh issue list'),
          reviewThreads: parseReviewThreads(reviewThreadsResult.stdout)
        })
      }
    : {
        status: 'unresolved',
        reason: 'github-control-facts-unresolved',
        failedSources: [
          pullRequestsResult.code === 0 ? undefined : 'pull-requests',
          issuesResult.code === 0 ? undefined : 'issues',
          reviewThreadsResult.code === 0 ? undefined : 'review-threads'
        ].filter((value): value is string => value !== undefined)
      };

  return {
    schema: 'sec-resolved-current-state-v2',
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
