#!/usr/bin/env bun

import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiBranchCloseoutWriteSession
} from '../../../providers/github-api/operation-session.ts';
import { retireExactRemoteRefs } from '../branch-lifecycle/exact-ref-retirement.ts';
import {
  retireExactIssueComment,
  retireMaintenanceTriggerComment
} from './comment-retirement.ts';
import type { MaintenanceRequest } from './contract.ts';
import {
  assertHostedRepositoryMaintenanceIdentity,
  parseHostedRepositoryMaintenanceRequest
} from './hosted-admission.ts';

export { parseRepositoryMaintenanceRequest } from './contract.ts';

function positiveEnvironmentInteger(value: string | undefined, label: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be one positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`);
  return parsed;
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
  const repositoryRoot = path.resolve(input.repositoryRoot);
  assertHostedRepositoryMaintenanceIdentity(input.request, environment);
  const actor = environment.GITHUB_ACTOR;
  if (typeof actor !== 'string' || actor.length === 0) {
    throw new Error('repository maintenance actor is absent');
  }

  await withGitHubApiBranchCloseoutWriteSession({
    repositoryRoot,
    repository: input.request.repository,
    operation: async (capability) => {
      const binding = inspectGitHubApiCapability(capability);
      if (binding.repository !== input.request.repository
          || binding.effect !== 'branch-closeout-write'
          || binding.origin !== 'production'
          || binding.principal.transport !== 'github-actions-token') {
        throw new Error('repository maintenance capability preflight is invalid');
      }
      const repository = await executeGitHubApiOperation(capability, { kind: 'repository' });
      if (repository === null || typeof repository !== 'object' || Array.isArray(repository)
          || (repository as Record<string, unknown>).full_name !== input.request.repository
          || (repository as Record<string, unknown>).default_branch !== 'main') {
        throw new Error('repository maintenance repository identity is invalid');
      }
      const permission = await executeGitHubApiOperation(capability, {
        kind: 'collaborator-permission',
        login: actor
      });
      const role = permission !== null && typeof permission === 'object' && !Array.isArray(permission)
        ? (permission as Record<string, unknown>).permission
        : null;
      if (role !== 'admin' && role !== 'maintain') {
        throw new Error(`repository maintenance actor ${actor} lacks maintain/admin permission`);
      }
      const main = await executeGitHubApiOperation(capability, { kind: 'git-ref', branch: 'main' });
      const object = main !== null && typeof main === 'object' && !Array.isArray(main)
        ? (main as Record<string, unknown>).object
        : null;
      const liveSha = object !== null && typeof object === 'object' && !Array.isArray(object)
        ? (object as Record<string, unknown>).sha
        : null;
      if (liveSha !== input.request.expectedMainSha) {
        throw new Error(
          `repository maintenance live main drifted: expected ${input.request.expectedMainSha}, observed ${String(liveSha)}`
        );
      }
    }
  });

  const triggeringCommentId = positiveEnvironmentInteger(
    environment.SEC_MAINTENANCE_COMMENT_ID,
    'SEC_MAINTENANCE_COMMENT_ID'
  );
  const results: unknown[] = [];
  for (const operation of input.request.operations) {
    if (operation.kind === 'exact-ref-retirement') {
      results.push(Object.freeze({
        kind: operation.kind,
        ...(await retireExactRemoteRefs({
          repositoryRoot,
          repository: input.request.repository,
          expectedMainSha: input.request.expectedMainSha,
          retirement: operation.retirement
        }))
      }));
      continue;
    }
    results.push(Object.freeze({
      kind: operation.kind,
      ...(await retireExactIssueComment({
        repositoryRoot,
        repository: input.request.repository,
        retirement: operation.retirement,
        triggeringCommentId
      }))
    }));
  }
  return Object.freeze({
    schema: 'sec-repository-maintenance-result-v1',
    requestDigest: sha256(input.request),
    completed: results.length,
    results: Object.freeze(results)
  });
}

export async function repositoryMaintenanceCli(argv: readonly string[]): Promise<string> {
  const request = parseHostedRepositoryMaintenanceRequest(process.env);
  if (argv.length === 1 && argv[0] === 'retire-trigger') {
    const issueNumber = positiveEnvironmentInteger(
      process.env.SEC_MAINTENANCE_ISSUE_NUMBER,
      'SEC_MAINTENANCE_ISSUE_NUMBER'
    );
    const commentId = positiveEnvironmentInteger(
      process.env.SEC_MAINTENANCE_COMMENT_ID,
      'SEC_MAINTENANCE_COMMENT_ID'
    );
    const exactBody = process.env.SEC_MAINTENANCE_REQUEST_JSON;
    if (exactBody === undefined) throw new Error('SEC_MAINTENANCE_REQUEST_JSON is absent');
    await retireMaintenanceTriggerComment({
      repositoryRoot: process.cwd(),
      repository: request.repository,
      request,
      commentId,
      issueNumber,
      exactBody
    });
    return JSON.stringify({ status: 'retired-trigger', commentId });
  }
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--json')) {
    throw new Error('usage: repository-maintenance [--json] | retire-trigger');
  }
  const result = await executeRepositoryMaintenance({
    repositoryRoot: process.cwd(),
    request
  });
  return JSON.stringify(result, null, argv.includes('--json') ? 2 : 0);
}

if (import.meta.main) {
  process.stdout.write(`${await repositoryMaintenanceCli(process.argv.slice(2))}\n`);
}
