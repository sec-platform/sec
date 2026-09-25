#!/usr/bin/env bun

import path from 'node:path';
import { readFileSync } from 'node:fs';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  inspectGitHubApiCapability,
  withGitHubApiBranchCloseoutWriteSession,
  withGitHubApiIssueCommentWriteSession
} from '../../../providers/github-api/operation-session.ts';
import { runClosedUnmergedCloseoutCli } from '../branch-lifecycle/closed-unmerged-closeout-cli.ts';
import {
  parseExactRefRetirement,
  retireExactRemoteRefs,
  type ExactRefRetirement
} from '../branch-lifecycle/exact-ref-retirement.ts';
import {
  parseExactCommentRetirement,
  retireExactClosedIssueComments,
  type ExactCommentRetirement
} from './comment-retirement.ts';

const SCHEMA = 'sec-repository-maintenance-request-v1' as const;
const MAINTENANCE_REQUEST_PATH = path.join('.tmp', 'repository-maintenance', 'request.json');

type MaintenanceOperation =
  | Readonly<{
      kind: 'exact-ref-retirement';
      retirement: ExactRefRetirement;
    }>
  | Readonly<{
      kind: 'closed-pr-retirement';
      pullRequestNumber: number;
      reviewCommentId: number | null;
    }>
  | Readonly<{
      kind: 'closed-conversation-comment-retirement';
      issueNumber: number;
      comments: readonly ExactCommentRetirement[];
    }>;

type MaintenanceRequest = Readonly<{
  schema: typeof SCHEMA;
  repository: string;
  expectedMainSha: string;
  operations: readonly MaintenanceOperation[];
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be one positive integer`);
  return Number(value);
}

function repository(value: unknown): string {
  if (typeof value !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[-A-Za-z0-9._]{1,100}$/u.test(value)) {
    throw new Error('repository must be one bounded owner/name identity');
  }
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} must be one Git SHA`);
  return value;
}

function parseOperation(value: unknown): MaintenanceOperation {
  const input = record(value, 'maintenance operation');
  if (input.kind === 'exact-ref-retirement') {
    exactKeys(input, ['kind', 'retirement'], 'exact-ref-retirement');
    return Object.freeze({ kind: 'exact-ref-retirement', retirement: parseExactRefRetirement(input.retirement) });
  }
  if (input.kind === 'closed-pr-retirement') {
    exactKeys(input, ['kind', 'pullRequestNumber', 'reviewCommentId'], 'closed-pr-retirement');
    const reviewCommentId = input.reviewCommentId === null
      ? null : positiveInteger(input.reviewCommentId, 'reviewCommentId');
    return Object.freeze({
      kind: 'closed-pr-retirement',
      pullRequestNumber: positiveInteger(input.pullRequestNumber, 'pullRequestNumber'),
      reviewCommentId
    });
  }
  if (input.kind === 'closed-conversation-comment-retirement') {
    exactKeys(input, ['kind', 'issueNumber', 'comments'], 'closed-conversation-comment-retirement');
    if (!Array.isArray(input.comments) || input.comments.length < 1 || input.comments.length > 100) {
      throw new Error('closed conversation comment retirement requires 1..100 comments');
    }
    return Object.freeze({
      kind: 'closed-conversation-comment-retirement',
      issueNumber: positiveInteger(input.issueNumber, 'issueNumber'),
      comments: Object.freeze(input.comments.map(parseExactCommentRetirement))
    });
  }
  throw new Error('maintenance operation kind is unknown');
}

export function parseRepositoryMaintenanceRequest(source: string): MaintenanceRequest {
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch { throw new Error('repository maintenance request is not JSON'); }
  const input = record(parsed, 'repository maintenance request');
  exactKeys(input, ['schema', 'repository', 'expectedMainSha', 'operations'], 'repository maintenance request');
  if (input.schema !== SCHEMA) throw new Error('repository maintenance request schema is invalid');
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 128) {
    throw new Error('repository maintenance request requires 1..128 operations');
  }
  return Object.freeze({
    schema: SCHEMA,
    repository: repository(input.repository),
    expectedMainSha: sha(input.expectedMainSha, 'expectedMainSha'),
    operations: Object.freeze(input.operations.map(parseOperation))
  });
}

async function preflightRepositoryMaintenance(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
}>): Promise<void> {
  const needsBranchWrite = input.request.operations.some((operation) => (
    operation.kind === 'exact-ref-retirement' || operation.kind === 'closed-pr-retirement'
  ));
  const needsCommentWrite = input.request.operations.some((operation) => (
    operation.kind === 'closed-conversation-comment-retirement'
  ));
  if (needsBranchWrite) await withGitHubApiBranchCloseoutWriteSession({
    repositoryRoot: input.repositoryRoot, repository: input.request.repository,
    operation: async (capability) => {
      const observed = inspectGitHubApiCapability(capability);
      if (observed.repository !== input.request.repository
          || observed.effect !== 'branch-closeout-write'
          || observed.origin !== 'production') {
        throw new Error('repository maintenance branch capability preflight is invalid');
      }
    }
  });
  if (needsCommentWrite) await withGitHubApiIssueCommentWriteSession({
    repositoryRoot: input.repositoryRoot, repository: input.request.repository,
    operation: async (capability) => {
      const observed = inspectGitHubApiCapability(capability);
      if (observed.repository !== input.request.repository
          || observed.effect !== 'issue-comment-write'
          || observed.origin !== 'production') {
        throw new Error('repository maintenance comment capability preflight is invalid');
      }
    }
  });
}

function assertHostedIdentity(request: MaintenanceRequest, environment: NodeJS.ProcessEnv): void {
  const expectedWorkflow = `${request.repository}/.github/workflows/repository-maintenance.yml@refs/heads/main`;
  if (environment.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || environment.GITHUB_REPOSITORY !== request.repository
      || environment.GITHUB_REF !== 'refs/heads/main'
      || environment.GITHUB_SHA !== request.expectedMainSha
      || environment.GITHUB_WORKFLOW_REF !== expectedWorkflow) {
    throw new Error('repository maintenance must execute from the exact current main workflow_dispatch identity');
  }
}

export async function executeRepositoryMaintenance(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  schema: 'sec-repository-maintenance-result-v1';
  requestDigest: `sha256:${string}`;
  completed: number;
  results: readonly unknown[];
}>> {
  const environment = input.environment ?? process.env;
  assertHostedIdentity(input.request, environment);
  await preflightRepositoryMaintenance({
    repositoryRoot: input.repositoryRoot, request: input.request
  });
  const results: unknown[] = [];
  for (const operation of input.request.operations) {
    if (operation.kind === 'exact-ref-retirement') {
      const retired = await retireExactRemoteRefs({
        repositoryRoot: input.repositoryRoot, repository: input.request.repository,
        retirement: operation.retirement, recoveryRoot: environment.SEC_BRANCH_RECOVERY_ROOT
      });
      results.push(Object.freeze({ kind: operation.kind, ...retired }));
      continue;
    }
    if (operation.kind === 'closed-pr-retirement') {
      const args = [
        '--repository', input.request.repository,
        '--pr', String(operation.pullRequestNumber),
        '--disposition', 'closed-superseded'
      ];
      if (operation.reviewCommentId !== null) args.push('--review-comment', String(operation.reviewCommentId));
      const branchLogs: string[] = [];
      const code = await runClosedUnmergedCloseoutCli(args, (source) => { branchLogs.push(source); });
      if (code !== 0) throw new Error(`closed PR ${operation.pullRequestNumber} retirement did not complete`);
      results.push(Object.freeze({
        kind: operation.kind, pullRequestNumber: operation.pullRequestNumber, status: 'completed',
        receiptDigest: sha256(branchLogs.join(''))
      }));
      continue;
    }
    const retired = await retireExactClosedIssueComments({
      repositoryRoot: input.repositoryRoot,
      repository: input.request.repository,
      issueNumber: operation.issueNumber,
      comments: operation.comments
    });
    results.push(Object.freeze({ kind: operation.kind, issueNumber: operation.issueNumber, ...retired }));
  }
  return Object.freeze({
    schema: 'sec-repository-maintenance-result-v1',
    requestDigest: sha256(input.request),
    completed: results.length,
    results: Object.freeze(results)
  });
}

export async function repositoryMaintenanceCli(argv: readonly string[]): Promise<string> {
  if (argv[0] !== 'execute' || argv.some((value, index) => index > 0 && value !== '--json')) {
    throw new Error('usage: repository-maintenance execute [--json]');
  }
  const repositoryRoot = process.cwd();
  const request = parseRepositoryMaintenanceRequest(
    readFileSync(path.join(repositoryRoot, MAINTENANCE_REQUEST_PATH), 'utf8')
  );
  const result = await executeRepositoryMaintenance({ repositoryRoot, request });
  return JSON.stringify(result, null, argv.includes('--json') ? 2 : 0);
}

if (import.meta.main) {
  process.stdout.write(`${await repositoryMaintenanceCli(process.argv.slice(2))}\n`);
}
