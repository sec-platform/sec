#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import { isRepositoryMaintenancePermission } from '../../../providers/github-api/repository-maintenance-permission.ts';
import { normalizeGitHubRepositoryPermission } from '../../../providers/github-api/repository-permission.ts';
import { inspectNoFollowDirectoryChain, readNoFollowOrdinaryFile } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  parseRepositoryMaintenanceRequest,
  parseRepositoryMaintenanceResumeReceipt,
  REPOSITORY_MAINTENANCE_MAX_REQUEST_BYTES,
  REPOSITORY_MAINTENANCE_REQUEST_SCHEMA
} from './contract.ts';

const WORKFLOW = 'repository-maintenance.yml';
const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;

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
    throw new Error(`repository maintenance provider failed: ${diagnostic || 'unknown gh failure'}`);
  }
  return String(result.stdout ?? '').trim();
}

function readBoundedInput(filename: string, limit: number): string {
  if (process.platform !== 'linux' && process.platform !== 'win32') {
    throw new Error(`repository maintenance file input is unsupported on ${process.platform}; the no-follow backend requires Linux or Windows`);
  }
  // The CLI selects a local input, not a repository-relative authority. Prove
  // the entire parent chain, then read only its ordinary no-follow leaf through
  // the physical owner; never reopen the caller's pathname as a file.
  const selected = path.resolve(filename);
  const parent = inspectNoFollowDirectoryChain(path.dirname(selected), 'maintenance input parent');
  const bytes = readNoFollowOrdinaryFile(parent.target, path.basename(selected), { maximumBytes: limit });
  if (bytes === null) throw new Error('repository maintenance input is absent');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function repository(value: string | undefined): string {
  if (value === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
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
  if (!isRepositoryMaintenancePermission(permission)) {
    throw new Error('repository maintenance dispatcher lacks current maintain/admin permission');
  }
  return permission;
}

/** This is transport data. Only the original capability and lifecycle owners admit effects. */
export function createRepositoryMaintenanceDispatchPayload(source: string, resumeSource?: string): Readonly<{
  ref: 'main';
  inputs: Readonly<{ request: string; request_digest: `sha256:${string}`; execution_digest: `sha256:${string}`; resume_receipt: string }>;
}> {
  const request = parseRepositoryMaintenanceRequest(source);
  if (request.schema !== REPOSITORY_MAINTENANCE_REQUEST_SCHEMA) {
    throw new Error('new dispatch requires a v2 exact ref batch; legacy comment carriers are read-only');
  }
  const resume = parseRepositoryMaintenanceResumeReceipt(resumeSource);
  const requestDigest = sha256(request);
  const inputs = Object.freeze({ request: source, request_digest: requestDigest,
    execution_digest: sha256({ requestDigest, resumeReceipt: resume ?? null }), resume_receipt: resume === undefined ? '' : JSON.stringify(resume) });
  if (Buffer.byteLength(JSON.stringify(inputs), 'utf8') > 65_535) {
    throw new Error('workflow dispatch inputs exceed the provider payload budget');
  }
  return Object.freeze({ ref: 'main', inputs });
}

export function repositoryMaintenanceDispatchCli(argv: readonly string[]): string {
  if ((argv.length !== 4 && argv.length !== 6) || argv[0] !== '--repository' || argv[2] !== '--request'
      || (argv.length === 6 && argv[4] !== '--resume-receipt')) {
    throw new Error('usage: repository-maintenance-dispatch --repository owner/name --request <json-file> [--resume-receipt <locator-json-file>]; dispatches one hosted batch, without comments');
  }
  const repositoryName = repository(argv[1]);
  const payload = createRepositoryMaintenanceDispatchPayload(
    readBoundedInput(argv[3]!, REPOSITORY_MAINTENANCE_MAX_REQUEST_BYTES),
    argv[5] === undefined ? undefined : readBoundedInput(argv[5], 1024)
  );
  const request = parseRepositoryMaintenanceRequest(payload.inputs.request);
  if (request.repository !== repositoryName) {
    throw new Error('repository maintenance request repository differs from dispatch repository');
  }
  const viewer = record(JSON.parse(gh(['api', '/user'])), 'repository maintenance dispatcher');
  if (typeof viewer.login !== 'string' || viewer.login.length === 0 || viewer.type !== 'User') {
    throw new Error('repository maintenance dispatcher must be an authenticated User');
  }
  assertRepositoryMaintenanceDispatcherPermission(JSON.parse(gh([
    'api', `/repos/${repositoryName}/collaborators/${encodeURIComponent(viewer.login)}/permission`
  ])));
  const liveMain = gh(['api', `/repos/${repositoryName}/git/ref/heads/main`, '--jq', '.object.sha']);
  if (liveMain !== request.expectedMainSha) {
    throw new Error(`repository maintenance main drifted before dispatch: expected ${request.expectedMainSha}, observed ${liveMain}`);
  }
  let response: string;
  try {
    response = gh([
      'api', '--method', 'POST',
      `/repos/${repositoryName}/actions/workflows/${WORKFLOW}/dispatches`,
      '-H', 'X-GitHub-Api-Version: 2026-03-10', '--input', '-'
    ], `${JSON.stringify(payload)}\n`);
  } catch (error) {
    throw new Error(`repository maintenance dispatch outcome is unknown; do not resend before reading workflow runs with display title maintenance/${payload.inputs.execution_digest}. Existing credentials must permit Actions(write); this command never changes credentials or scopes. ${error instanceof Error ? error.message : String(error)}`);
  }
  let result: Record<string, any>;
  try { result = record(JSON.parse(response), 'repository maintenance dispatch response'); }
  catch { throw new Error('repository maintenance dispatch was accepted but its run identity is unknown; read workflow runs before any resend'); }
  const runId = result.workflow_run_id;
  if (!Number.isSafeInteger(runId) || runId < 1
      || result.run_url !== `https://api.github.com/repos/${repositoryName}/actions/runs/${runId}`
      || result.html_url !== `https://github.com/${repositoryName}/actions/runs/${runId}`) {
    throw new Error('repository maintenance dispatch was accepted but its run identity is unknown; read workflow runs before any resend');
  }
  return JSON.stringify({
    status: 'dispatched', transport: 'workflow_dispatch', repository: repositoryName,
    requestDigest: sha256(request), executionDigest: payload.inputs.execution_digest, operations: request.operations.length,
    runId, runUrl: result.html_url
  }, null, 2);
}

if (import.meta.main) {
  process.stdout.write(`${repositoryMaintenanceDispatchCli(process.argv.slice(2))}\n`);
}
