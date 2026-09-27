#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiReadSession
} from '../../../providers/github-api/operation-session.ts';
import {
  parseExactRemoteRefRecoveryPreparation,
  prepareExactRemoteRefRecovery,
  retireExactRemoteRefs,
  type ExactRemoteRefRecoveryPreparation
} from '../branch-lifecycle/exact-ref-retirement.ts';
import type { BranchRecoveryAuthority } from '../branch-lifecycle/branch-lifecycle-contract.ts';
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

const HOSTED_RECOVERY_PREPARATION_SCHEMA =
  'sec-repository-maintenance-hosted-recovery-preparation-v1' as const;
const HOSTED_RECOVERY_PREPARATION_FILE =
  'sec-repository-maintenance-recovery-preparation.json' as const;

type HostedRecoveryPreparation = Readonly<{
  schema: typeof HOSTED_RECOVERY_PREPARATION_SCHEMA;
  requestDigest: `sha256:${string}`;
  required: boolean;
  refPreparation: ExactRemoteRefRecoveryPreparation | null;
}>;

type HostedRecoveryCarrier = Readonly<{
  artifactId: number;
  artifactName: string;
  artifactDigest: `sha256:${string}`;
  runId: number;
  runAttempt: number;
}>;

type HostedPreEffectRecovery = Readonly<{
  refState: 'present' | 'absent';
  recovery: BranchRecoveryAuthority | null;
  carrier: HostedRecoveryCarrier | null;
}>;

function exactRefOperation(request: MaintenanceRequest) {
  return request.operations.find((operation) => operation.kind === 'exact-ref-retirement');
}

function parseHostedRecoveryPreparation(value: unknown): HostedRecoveryPreparation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('hosted maintenance recovery preparation must be one object');
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  const expected = ['schema', 'requestDigest', 'required', 'refPreparation'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('hosted maintenance recovery preparation fields are invalid');
  }
  if (input.schema !== HOSTED_RECOVERY_PREPARATION_SCHEMA
      || typeof input.requestDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(input.requestDigest)
      || typeof input.required !== 'boolean') {
    throw new Error('hosted maintenance recovery preparation identity is invalid');
  }
  const refPreparation = input.refPreparation === null
    ? null
    : parseExactRemoteRefRecoveryPreparation(input.refPreparation);
  if (input.required !== (refPreparation?.recovery !== null && refPreparation !== null)) {
    throw new Error('hosted maintenance recovery requirement differs from its exact preparation');
  }
  return Object.freeze({
    schema: HOSTED_RECOVERY_PREPARATION_SCHEMA,
    requestDigest: input.requestDigest as `sha256:${string}`,
    required: input.required,
    refPreparation
  });
}

function readHostedRecoveryPreparation(filePath: string): HostedRecoveryPreparation {
  const resolved = path.resolve(filePath);
  return parseHostedRecoveryPreparation(JSON.parse(readFileSync(resolved, 'utf8')));
}

async function prepareHostedRecovery(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment: NodeJS.ProcessEnv;
}>): Promise<HostedRecoveryPreparation> {
  await assertRepositoryMaintenancePreflight({
    repositoryRoot: input.repositoryRoot,
    request: input.request,
    environment: input.environment
  });
  const operation = exactRefOperation(input.request);
  if (operation === undefined) {
    return Object.freeze({
      schema: HOSTED_RECOVERY_PREPARATION_SCHEMA,
      requestDigest: sha256(input.request),
      required: false,
      refPreparation: null
    });
  }
  const refPreparation = await prepareExactRemoteRefRecovery({
    repositoryRoot: input.repositoryRoot,
    repository: input.request.repository,
    expectedMainSha: input.request.expectedMainSha,
    retirement: operation.retirement
  });
  return Object.freeze({
    schema: HOSTED_RECOVERY_PREPARATION_SCHEMA,
    requestDigest: sha256(input.request),
    required: refPreparation.recovery !== null,
    refPreparation
  });
}

function loadPreEffectRecovery(input: Readonly<{
  request: MaintenanceRequest;
  environment: NodeJS.ProcessEnv;
}>): HostedPreEffectRecovery | undefined {
  const operation = exactRefOperation(input.request);
  if (operation === undefined) return undefined;
  const preparationPath = input.environment.SEC_MAINTENANCE_RECOVERY_PREPARATION_PATH;
  if (typeof preparationPath !== 'string' || preparationPath.length === 0) {
    throw new Error('exact ref maintenance requires a pre-effect recovery preparation');
  }
  const local = readHostedRecoveryPreparation(preparationPath);
  if (local.requestDigest !== sha256(input.request)
      || local.refPreparation === null
      || local.refPreparation.repository !== input.request.repository
      || local.refPreparation.expectedMainSha !== input.request.expectedMainSha
      || sha256(local.refPreparation.retirement) !== sha256(operation.retirement)) {
    throw new Error('pre-effect recovery preparation differs from the exact maintenance request');
  }

  let preparation = local;
  let recovery: BranchRecoveryAuthority | null = null;
  let carrier: HostedRecoveryCarrier | null = null;
  if (local.required) {
    const readbackRoot = input.environment.SEC_MAINTENANCE_RECOVERY_READBACK_ROOT;
    if (typeof readbackRoot !== 'string' || readbackRoot.length === 0) {
      throw new Error('published recovery artifact readback root is absent');
    }
    const root = path.resolve(readbackRoot);
    const downloadedPreparationPath = path.join(root, HOSTED_RECOVERY_PREPARATION_FILE);
    if (!existsSync(downloadedPreparationPath)) {
      throw new Error('published recovery artifact does not contain its exact preparation');
    }
    const downloaded = readHostedRecoveryPreparation(downloadedPreparationPath);
    if (sha256(downloaded) !== sha256(local)) {
      throw new Error('downloaded recovery preparation differs from the pre-upload preparation');
    }
    preparation = downloaded;
    const bundle = downloaded.refPreparation?.recovery;
    if (bundle === null || bundle === undefined) {
      throw new Error('published recovery artifact lacks the required bundle identity');
    }
    const bundlePath = path.resolve(root, bundle.bundleName);
    if (path.dirname(bundlePath) !== root
        || path.basename(bundlePath) !== bundle.bundleName
        || !existsSync(bundlePath)
        || !existsSync(`${bundlePath}.sha256`)) {
      throw new Error('published recovery artifact bundle path is absent or escaped');
    }
    recovery = Object.freeze({
      kind: 'bundle' as const,
      path: bundlePath,
      sha256: bundle.sha256,
      verified: true,
      verifyOutput: bundle.verifyOutput
    });

    const artifactId = positiveEnvironmentInteger(
      input.environment.SEC_MAINTENANCE_RECOVERY_ARTIFACT_ID,
      'SEC_MAINTENANCE_RECOVERY_ARTIFACT_ID'
    );
    const runId = positiveEnvironmentInteger(
      input.environment.SEC_MAINTENANCE_RECOVERY_RUN_ID,
      'SEC_MAINTENANCE_RECOVERY_RUN_ID'
    );
    const runAttempt = positiveEnvironmentInteger(
      input.environment.SEC_MAINTENANCE_RECOVERY_RUN_ATTEMPT,
      'SEC_MAINTENANCE_RECOVERY_RUN_ATTEMPT'
    );
    const artifactName = input.environment.SEC_MAINTENANCE_RECOVERY_ARTIFACT_NAME;
    const artifactDigest = input.environment.SEC_MAINTENANCE_RECOVERY_ARTIFACT_DIGEST;
    if (typeof artifactName !== 'string'
        || !/^sec-repository-maintenance-recovery-[1-9][0-9]*-[1-9][0-9]*$/u.test(artifactName)
        || artifactName !== `sec-repository-maintenance-recovery-${runId}-${runAttempt}`
        || typeof artifactDigest !== 'string'
        || !/^sha256:[0-9a-f]{64}$/u.test(artifactDigest)) {
      throw new Error('published recovery artifact durable locator is invalid');
    }
    carrier = Object.freeze({
      artifactId,
      artifactName,
      artifactDigest: artifactDigest as `sha256:${string}`,
      runId,
      runAttempt
    });
  }
  if (preparation.refPreparation === null) {
    throw new Error('exact ref recovery preparation disappeared during readback');
  }
  return Object.freeze({
    refState: preparation.refPreparation.refState,
    recovery,
    carrier
  });
}

function positiveEnvironmentInteger(value: string | undefined, label: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be one positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`);
  return parsed;
}

async function assertRepositoryMaintenancePreflight(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment: NodeJS.ProcessEnv;
}>): Promise<void> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  assertHostedRepositoryMaintenanceIdentity(input.request, input.environment);
  const actor = input.environment.GITHUB_ACTOR;
  if (typeof actor !== 'string' || actor.length === 0) {
    throw new Error('repository maintenance actor is absent');
  }
  await withGitHubApiReadSession({
    repositoryRoot,
    repository: input.request.repository,
    operation: async (capability) => {
      const binding = inspectGitHubApiCapability(capability);
      if (binding.repository !== input.request.repository
          || binding.effect !== 'read'
          || binding.origin !== 'production'
          || binding.principal.transport !== 'github-actions-token') {
        throw new Error('repository maintenance read preflight capability is invalid');
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
}

export async function executeRepositoryMaintenance(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment?: NodeJS.ProcessEnv;
  preEffectRecovery?: HostedPreEffectRecovery;
}>): Promise<Readonly<{
  schema: 'sec-repository-maintenance-result-v2';
  requestDigest: `sha256:${string}`;
  completed: number;
  results: readonly unknown[];
}>> {
  const environment = input.environment ?? process.env;
  const repositoryRoot = path.resolve(input.repositoryRoot);
  await assertRepositoryMaintenancePreflight({
    repositoryRoot,
    request: input.request,
    environment
  });

  const triggeringCommentId = positiveEnvironmentInteger(
    environment.SEC_MAINTENANCE_COMMENT_ID,
    'SEC_MAINTENANCE_COMMENT_ID'
  );
  const results: unknown[] = [];
  for (const operation of input.request.operations) {
    if (operation.kind === 'exact-ref-retirement') {
      const durable = input.preEffectRecovery;
      if (durable === undefined) {
        throw new Error('exact ref maintenance cannot execute without pre-effect recovery preparation');
      }
      results.push(Object.freeze({
        kind: operation.kind,
        recoveryCarrier: durable.carrier,
        ...(await retireExactRemoteRefs({
          repositoryRoot,
          repository: input.request.repository,
          expectedMainSha: input.request.expectedMainSha,
          retirement: operation.retirement,
          preEffectRecovery: Object.freeze({
            refState: durable.refState,
            recovery: durable.recovery
          })
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
    schema: 'sec-repository-maintenance-result-v2',
    requestDigest: sha256(input.request),
    completed: results.length,
    results: Object.freeze(results)
  });
}

export async function repositoryMaintenanceCli(argv: readonly string[]): Promise<string> {
  if (argv.length > 1
      || (argv.length === 1
        && argv[0] !== '--json'
        && argv[0] !== 'prepare-recovery'
        && argv[0] !== 'retire-trigger')) {
    throw new Error('usage: repository-maintenance [--json] | prepare-recovery | retire-trigger');
  }
  const request = parseHostedRepositoryMaintenanceRequest(process.env);
  if (argv.length === 1 && argv[0] === 'prepare-recovery') {
    return JSON.stringify(await prepareHostedRecovery({
      repositoryRoot: process.cwd(),
      request,
      environment: process.env
    }), null, 2);
  }
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
  const result = await executeRepositoryMaintenance({
    repositoryRoot: process.cwd(),
    request,
    preEffectRecovery: loadPreEffectRecovery({
      request,
      environment: process.env
    })
  });
  return JSON.stringify(result, null, argv.includes('--json') ? 2 : 0);
}

if (import.meta.main) {
  process.stdout.write(`${await repositoryMaintenanceCli(process.argv.slice(2))}\n`);
}
