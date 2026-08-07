#!/usr/bin/env bun
/**
 * SEC minimal Verification Session CLI (Issue #311 Phase 0).
 *
 * Commands:
 *   project --default-ref <ref> [--repository <owner/name>] [--json]
 *   freeze --session <id> --pr <n> --base <sha> --head <sha>
 *          --manifest <path> --manifest-digest <sha256> [--repository <owner/name>] [--json]
 *   parity --session <id> --merged-tree <sha> [--repository <owner/name>] [--json]
 *
 * The #313 published receipt mechanism is an input fact; this CLI never
 * publishes or reads back branch/ref receipts.
 */

import path from 'node:path';

import {
  commandErrorText,
  defaultBranchLifecycleCommandRunner,
  requireBranchCommandText,
  runBranchCommand,
  type BranchLifecycleContext
} from './branch-lifecycle-command.ts';
import { resolveTreeSha } from './verification-candidate-tree.ts';
import {
  loadFreezeSession,
  persistFreezeSession,
  readbackFreezeSession
} from './verification-freeze-session.ts';
import {
  VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1,
  createCandidateTreeParityV1,
  createFreezeSessionV1,
  parseVerificationRegistryProjectionV1,
  type VerificationRegistryEntryV1
} from './verification-session-contract.ts';
import {
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentWorkPackageManifestDigest
} from './work-package-contract.ts';

const WORK_PACKAGE_DIRECTORY = 'docs/work-packages';

function blobDigest(
  ctx: BranchLifecycleContext,
  ref: string,
  filePath: string
): `sha256:${string}` {
  const result = runBranchCommand(ctx, 'git', ['cat-file', 'blob', `${ref}:${filePath}`]);
  if (result.status !== 0) {
    throw new Error(`Cannot read manifest blob ${filePath} at ${ref}: ${commandErrorText(result)}`);
  }
  return CodexDevelopmentWorkPackageManifestDigest(result.stdout) as `sha256:${string}`;
}

function collectDefaultManifestEntries(
  ctx: BranchLifecycleContext,
  ref: string
): VerificationRegistryEntryV1[] {
  const listing = requireBranchCommandText(
    ctx,
    'git',
    ['ls-tree', '-r', '--name-only', '--full-tree', ref, '--', WORK_PACKAGE_DIRECTORY],
    'work package directory listing',
    ctx.repositoryRoot
  );
  return listing
    .split(/\r?\n/u)
    .filter((line) => /^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(line.trim()))
    .map((manifestPath) => manifestPath.trim())
    .sort()
    .map((manifestPath) => ({
      manifestPath,
      manifestDigest: blobDigest(ctx, ref, manifestPath),
      source: 'default' as const,
      prNumber: null,
      baseSha: null,
      headSha: null,
      headTreeSha: null
    }));
}

export interface OpenPullRequestFactV1 {
  number: number;
  headBranch: string;
  headSha: string;
  baseSha: string;
  body: string;
}

export function collectOpenPullRequestEntries(
  ctx: BranchLifecycleContext,
  pullRequests: readonly OpenPullRequestFactV1[]
): VerificationRegistryEntryV1[] {
  return pullRequests
    .map((pullRequest) => {
      const manifestPath = CodexDevelopmentParseWorkPackageLocator(pullRequest.body);
      const stagingRef = `refs/sec/verification-session/${pullRequest.number}-${pullRequest.headSha.slice(0, 12)}`;
      const fetch = runBranchCommand(ctx, 'git', [
        'fetch',
        '--no-tags',
        'origin',
        `+refs/pull/${pullRequest.number}/head:${stagingRef}`
      ]);
      if (fetch.status !== 0) {
        throw new Error(
          `Cannot fetch open PR #${pullRequest.number} head: ${commandErrorText(fetch)}`
        );
      }
      const headTreeSha = resolveTreeSha(ctx, stagingRef);
      const manifestDigest = blobDigest(ctx, stagingRef, manifestPath);
      runBranchCommand(ctx, 'git', ['update-ref', '-d', stagingRef]);
      return {
        manifestPath,
        manifestDigest,
        source: 'open-pr' as const,
        prNumber: pullRequest.number,
        baseSha: pullRequest.baseSha,
        headSha: pullRequest.headSha,
        headTreeSha
      };
    })
    .sort((left, right) => left.prNumber - right.prNumber);
}

export function parseOpenPullRequestList(
  source: string
): OpenPullRequestFactV1[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) throw new Error('Open PR list must be an array.');
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Open PR entry ${index} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const number = record.number;
    const headSha = record.headRefOid;
    const baseSha = record.baseRefOid;
    const headBranch = record.headRefName;
    const body = record.body;
    if (
      !Number.isSafeInteger(number)
      || (number as number) <= 0
      || typeof headSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(headSha)
      || typeof baseSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(baseSha)
      || typeof headBranch !== 'string'
      || headBranch.length === 0
      || typeof body !== 'string'
    ) {
      throw new Error(`Open PR entry ${index} identity is invalid.`);
    }
    return {
      number: number as number,
      headBranch,
      headSha,
      baseSha,
      body
    };
  });
}

export function projectWorkPackageRegistry(input: {
  ctx: BranchLifecycleContext;
  observedAt: string;
  repository: string;
  defaultBranch: string;
  defaultRef: string;
  pullRequestEntries?: VerificationRegistryEntryV1[];
  openPullRequests?: readonly OpenPullRequestFactV1[];
}): string {
  const { ctx, observedAt, repository, defaultBranch, defaultRef } = input;
  const defaultTreeSha = resolveTreeSha(ctx, defaultRef);
  const defaultEntries = collectDefaultManifestEntries(ctx, defaultRef);
  const suppliedPrEntries = (input.pullRequestEntries ?? [])
    .filter((entry) => entry.source === 'open-pr')
    .map((entry) => ({ ...entry, manifestPath: entry.manifestPath }));
  const discoveredPrEntries = input.openPullRequests !== undefined
    ? collectOpenPullRequestEntries(ctx, input.openPullRequests)
    : [];
  const prEntries = [...suppliedPrEntries, ...discoveredPrEntries];
  const entries = [...defaultEntries, ...prEntries];
  const paths = entries.map(({ manifestPath }) => manifestPath);
  if (new Set(paths).size !== paths.length) {
    throw new Error('Registry projection contains duplicate manifest paths across sources.');
  }
  return JSON.stringify({
    schema: VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1,
    observedAt,
    repository,
    defaultBranch,
    defaultTreeSha,
    entries
  }, null, 2);
}

export function freezeCandidateSession(input: {
  ctx: BranchLifecycleContext;
  sessionId: string;
  frozenAt: string;
  repository: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
}): string {
  const { ctx, ...facts } = input;
  const candidateTreeSha = resolveTreeSha(ctx, facts.headSha);
  const session = createFreezeSessionV1({
    ...facts,
    candidateTreeSha
  });
  persistFreezeSession(ctx.repositoryRoot, session);
  const readback = readbackFreezeSession(ctx.repositoryRoot, session);
  return JSON.stringify({
    session: readback,
    sessionPath: path.join(
      ctx.repositoryRoot,
      '.tmp/codex/verification-sessions',
      `${session.sessionId}.json`
    )
  }, null, 2);
}

export function checkSessionTreeParity(input: {
  ctx: BranchLifecycleContext;
  checkedAt: string;
  repository: string;
  sessionId: string;
  mergedTreeSha: string;
}): string {
  const { ctx, checkedAt, repository, sessionId, mergedTreeSha } = input;
  const session = loadFreezeSession(ctx.repositoryRoot, sessionId);
  const parity = createCandidateTreeParityV1({
    checkedAt,
    repository,
    sessionId,
    prNumber: session.prNumber,
    candidateTreeSha: session.candidateTreeSha,
    mergedTreeSha
  });
  return JSON.stringify(parity, null, 2);
}

function assertSha(value: string | undefined, label: string): string {
  if (value === undefined || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a 40-character SHA.`);
  }
  return value;
}

function assertManifestPath(value: string | undefined): string {
  if (value === undefined || !/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(value)) {
    throw new Error('--manifest must match docs/work-packages/<id>.md.');
  }
  return value;
}

const USAGE = `Usage:
  bun scripts/codex/verification-session.ts project --default-ref <ref> [--open-prs] [--repository <owner/name>] [--json]
  bun scripts/codex/verification-session.ts freeze --session <id> --pr <n> --base <sha> --head <sha> --manifest <path> --manifest-digest <sha256> [--repository <owner/name>] [--json]
  bun scripts/codex/verification-session.ts parity --session <id> --merged-tree <sha> [--repository <owner/name>] [--json]
`;

function main(argv: string[]): void {
  const command = argv[0];
  if (command !== 'project' && command !== 'freeze' && command !== 'parity') {
    throw new Error(USAGE);
  }
  const args = new Map<string, string>();
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--')) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}.`);
      }
      args.set(arg, value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  const ctx: BranchLifecycleContext = {
    repositoryRoot: process.cwd(),
    run: defaultBranchLifecycleCommandRunner
  };
  const repository = args.get('--repository') ?? 'sec-platform/sec';
  const output = (() => {
    if (command === 'project') {
      const defaultRef = args.get('--default-ref');
      if (defaultRef === undefined) throw new Error(`--default-ref is required.\n${USAGE}`);
      const openPullRequests = args.has('--open-prs')
        ? parseOpenPullRequestList(requireBranchCommandText(
            ctx,
            'gh',
            ['pr', 'list', '--state', 'open', '--json', 'number,headRefName,headRefOid,baseRefOid,body'],
            'open pull request inventory',
            ctx.repositoryRoot
          ))
        : undefined;
      return projectWorkPackageRegistry({
        ctx,
        observedAt: new Date().toISOString(),
        repository,
        defaultBranch: 'main',
        defaultRef,
        openPullRequests
      });
    }
    if (command === 'freeze') {
      const sessionId = args.get('--session');
      const prNumber = Number(args.get('--pr'));
      const baseSha = assertSha(args.get('--base'), '--base');
      const headSha = assertSha(args.get('--head'), '--head');
      const manifestPath = assertManifestPath(args.get('--manifest'));
      const manifestDigest = args.get('--manifest-digest');
      if (
        sessionId === undefined
        || !Number.isSafeInteger(prNumber)
        || prNumber <= 0
        || manifestDigest === undefined
        || !/^sha256:[0-9a-f]{64}$/u.test(manifestDigest)
      ) {
        throw new Error(`freeze requires --session --pr --base --head --manifest --manifest-digest.\n${USAGE}`);
      }
      return freezeCandidateSession({
        ctx,
        sessionId,
        frozenAt: new Date().toISOString(),
        repository,
        prNumber,
        baseSha,
        headSha,
        manifestPath,
        manifestDigest: manifestDigest as `sha256:${string}`
      });
    }
    const sessionId = args.get('--session');
    const mergedTreeSha = assertSha(args.get('--merged-tree'), '--merged-tree');
    if (sessionId === undefined) throw new Error(`parity requires --session --merged-tree.\n${USAGE}`);
    return checkSessionTreeParity({
      ctx,
      checkedAt: new Date().toISOString(),
      repository,
      sessionId,
      mergedTreeSha
    });
  })();
  if (!json && command === 'project') {
    const projection = parseVerificationRegistryProjectionV1(output);
    process.stdout.write(
      `Registry projection: ${projection.entries.length} manifest(s) on ${projection.defaultBranch}@${projection.defaultTreeSha}\n`
    );
    for (const entry of projection.entries) {
      process.stdout.write(`  ${entry.source.padEnd(8)} ${entry.manifestPath} ${entry.manifestDigest}\n`);
    }
  } else {
    process.stdout.write(`${output}\n`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
