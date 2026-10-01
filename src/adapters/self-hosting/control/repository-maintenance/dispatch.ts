#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { normalizeGitHubRepositoryPermission } from '../../../providers/github-api/repository-permission.ts';
import {
  parseRepositoryMaintenanceRequest,
  REPOSITORY_MAINTENANCE_ISSUE_NUMBER
} from './contract.ts';

export const REPOSITORY_MAINTENANCE_DISPATCH_EVENT =
  'sec-repository-maintenance-v2' as const;
export const REPOSITORY_MAINTENANCE_DISPATCH_SCHEMA =
  'sec-repository-maintenance-dispatch-v1' as const;

const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

function rawSha256(source: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`;
}

function gh(args: readonly string[], input?: string): string {
  const result = spawnSync('gh', args, {
    input,
    encoding: 'utf8',
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0'
    }
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stderr ?? ''}${result.error?.message ?? ''}`.trim();
    throw new Error(`repository maintenance dispatch provider failed: ${diagnostic || 'unknown gh failure'}`);
  }
  return String(result.stdout ?? '').trim();
}

function positiveInteger(source: string | undefined, label: string): number {
  if (source === undefined || !/^[1-9][0-9]*$/u.test(source)) {
    throw new Error(`${label} must be one positive integer`);
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`);
  return parsed;
}

function repository(value: string | undefined): string {
  if (value === undefined
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error('--repository must be owner/name');
  }
  return value;
}

function record(value: unknown, label: string): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, any>;
}

export function assertRepositoryMaintenanceDispatcherPermission(value: unknown): 'admin' | 'maintain' {
  const permission = normalizeGitHubRepositoryPermission(
    record(value, 'repository maintenance dispatcher permission')
  );
  if (permission !== 'admin' && permission !== 'maintain') {
    throw new Error('repository maintenance dispatcher lacks current maintain/admin permission');
  }
  return permission;
}

export function createRepositoryMaintenanceDispatchPayload(input: Readonly<{
  issueNumber: number;
  commentId: number;
  commentBody: string;
}>): Readonly<{
  event_type: typeof REPOSITORY_MAINTENANCE_DISPATCH_EVENT;
  client_payload: Readonly<{
    schema: typeof REPOSITORY_MAINTENANCE_DISPATCH_SCHEMA;
    issue_number: number;
    comment_id: number;
    comment_body_sha256: `sha256:${string}`;
  }>;
}> {
  if (input.issueNumber !== REPOSITORY_MAINTENANCE_ISSUE_NUMBER
      || !Number.isSafeInteger(input.commentId) || input.commentId < 1
      || typeof input.commentBody !== 'string' || input.commentBody.length === 0) {
    throw new Error('repository maintenance dispatch identity is invalid');
  }
  return Object.freeze({
    event_type: REPOSITORY_MAINTENANCE_DISPATCH_EVENT,
    client_payload: Object.freeze({
      schema: REPOSITORY_MAINTENANCE_DISPATCH_SCHEMA,
      issue_number: input.issueNumber,
      comment_id: input.commentId,
      comment_body_sha256: rawSha256(input.commentBody)
    })
  });
}

export function repositoryMaintenanceDispatchCli(argv: readonly string[]): string {
  if (argv.length !== 4 || argv[0] !== '--repository' || argv[2] !== '--comment') {
    throw new Error('usage: repository-maintenance-dispatch --repository owner/name --comment <id>');
  }
  const repositoryName = repository(argv[1]);
  const commentId = positiveInteger(argv[3], '--comment');
  const comment = record(JSON.parse(gh([
    'api',
    `/repos/${repositoryName}/issues/comments/${commentId}`
  ])), 'repository maintenance trigger comment');
  const author = record(comment.user, 'repository maintenance trigger comment user');
  if (comment.id !== commentId
      || typeof comment.issue_url !== 'string'
      || !comment.issue_url.endsWith(`/repos/${repositoryName}/issues/${REPOSITORY_MAINTENANCE_ISSUE_NUMBER}`)
      || typeof comment.body !== 'string' || comment.body.length === 0
      || typeof author.login !== 'string' || author.login.length === 0
      || author.type !== 'User'
      || (comment.author_association !== 'OWNER' && comment.author_association !== 'MEMBER')
      || comment.performed_via_github_app !== null) {
    throw new Error('repository maintenance trigger comment identity is invalid');
  }
  const viewer = gh(['api', '/user', '--jq', '.login']);
  if (viewer !== author.login) {
    throw new Error('repository maintenance dispatcher must be the exact trigger comment author');
  }
  assertRepositoryMaintenanceDispatcherPermission(JSON.parse(gh([
    'api',
    `/repos/${repositoryName}/collaborators/${encodeURIComponent(viewer)}/permission`
  ])));
  const request = parseRepositoryMaintenanceRequest(comment.body);
  if (request.repository !== repositoryName) {
    throw new Error('repository maintenance request repository differs from dispatch repository');
  }
  const liveMain = gh([
    'api',
    `/repos/${repositoryName}/git/ref/heads/main`,
    '--jq',
    '.object.sha'
  ]);
  if (liveMain !== request.expectedMainSha) {
    throw new Error(`repository maintenance main drifted before dispatch: expected ${request.expectedMainSha}, observed ${liveMain}`);
  }
  const payload = createRepositoryMaintenanceDispatchPayload({
    issueNumber: REPOSITORY_MAINTENANCE_ISSUE_NUMBER,
    commentId,
    commentBody: comment.body
  });
  gh([
    'api',
    '--method',
    'POST',
    `/repos/${repositoryName}/dispatches`,
    '--input',
    '-'
  ], `${JSON.stringify(payload)}\n`);
  return JSON.stringify({
    status: 'dispatched',
    repository: repositoryName,
    issueNumber: REPOSITORY_MAINTENANCE_ISSUE_NUMBER,
    commentId,
    requestDigest: rawSha256(comment.body)
  }, null, 2);
}

if (import.meta.main) {
  process.stdout.write(`${repositoryMaintenanceDispatchCli(process.argv.slice(2))}\n`);
}
