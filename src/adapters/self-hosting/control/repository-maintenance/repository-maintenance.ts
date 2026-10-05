#!/usr/bin/env bun

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import type { BranchRecoveryAuthority } from '../../../../execution/verification/branch-closeout.ts';
import {
  assertGitHubApiMaintenanceRequest,
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiReadSession
} from '../../../providers/github-api/operation-session.ts';
import {
  observeExactRefBatchResumeReceipt,
  parseExactRemoteRefBatchRecoveryPreparation,
  prepareExactRemoteRefBatchRecovery,
  retireExactRemoteRefBatch,
  type ExactRefBatchRecoveryCarrier,
  type ExactRemoteRefBatchRecoveryPreparation
} from '../branch-lifecycle/exact-ref-retirement.ts';
import {
  parseRepositoryMaintenanceResumeReceipt,
  REPOSITORY_MAINTENANCE_RECOVERY_RETENTION_DAYS,
  type MaintenanceRequest
} from './contract.ts';
import {
  assertHostedRepositoryMaintenanceIdentity,
  parseHostedRepositoryMaintenanceRequest
} from './hosted-admission.ts';

export { parseRepositoryMaintenanceRequest } from './contract.ts';

const HOSTED_RECOVERY_PREPARATION_SCHEMA =
  'sec-repository-maintenance-hosted-recovery-preparation-v2' as const;
const HOSTED_RECOVERY_CARRIER_ROOT = '/tmp/sec-repository-maintenance-carrier';
const HOSTED_RECOVERY_PREPARATION_FILE = 'recovery-preparation.json';
const HOSTED_RECOVERY_BUNDLE_FILE = 'recovery.bundle';
const HOSTED_RECOVERY_CHECKSUM_FILE = 'recovery.bundle.sha256';
const HOSTED_RESULT_FILE = 'maintenance-result.json';

type HostedRecoveryPreparation = Readonly<{
  schema: typeof HOSTED_RECOVERY_PREPARATION_SCHEMA;
  requestDigest: `sha256:${string}`;
  required: true;
  refPreparation: ExactRemoteRefBatchRecoveryPreparation;
  reusedCarrier: HostedRecoveryCarrier | null;
}>;

type HostedRecoveryCarrier = ExactRefBatchRecoveryCarrier;

type HostedPreEffectRecovery = Readonly<{
  preparation: ExactRemoteRefBatchRecoveryPreparation;
  recovery: BranchRecoveryAuthority;
  carrier: HostedRecoveryCarrier;
}>;

function retirements(request: MaintenanceRequest) {
  return request.operations.map((operation) => {
    if (operation.kind !== 'exact-ref-retirement') {
      throw new Error('hosted batch only accepts exact ref retirement');
    }
    return operation.retirement;
  });
}

function record(value: unknown, label: string): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, any>;
}

function parseHostedRecoveryPreparation(value: unknown): HostedRecoveryPreparation {
  const input = record(value, 'hosted maintenance recovery preparation');
  const expected = ['schema', 'requestDigest', 'required', 'refPreparation', 'reusedCarrier'].sort();
  const actual = Object.keys(input).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)
      || input.schema !== HOSTED_RECOVERY_PREPARATION_SCHEMA
      || typeof input.requestDigest !== 'string'
      || !/^sha256:[0-9a-f]{64}$/u.test(input.requestDigest)
      || input.required !== true) {
    throw new Error('hosted maintenance recovery preparation identity is invalid');
  }
  return Object.freeze({
    schema: HOSTED_RECOVERY_PREPARATION_SCHEMA,
    requestDigest: input.requestDigest as `sha256:${string}`,
    required: true,
    refPreparation: parseExactRemoteRefBatchRecoveryPreparation(input.refPreparation),
    reusedCarrier: input.reusedCarrier === null ? null : parseCarrier(input.reusedCarrier)
  });
}

function hostedPath(file: string): string {
  if (process.platform !== 'linux') {
    throw new Error('hosted repository maintenance recovery carrier requires Linux');
  }
  return path.join(HOSTED_RECOVERY_CARRIER_ROOT, file);
}

function parseCarrier(value: unknown): HostedRecoveryCarrier {
  const carrier = record(value, 'recovery carrier');
  if (carrier.provider !== 'github-actions-artifact' || typeof carrier.repository !== 'string'
      || !Number.isSafeInteger(carrier.artifactId) || carrier.artifactId < 1
      || !Number.isSafeInteger(carrier.runId) || carrier.runId < 1
      || !Number.isSafeInteger(carrier.runAttempt) || carrier.runAttempt < 1
      || carrier.artifactName !== `sec-repository-maintenance-recovery-${carrier.runId}-${carrier.runAttempt}`
      || typeof carrier.artifactDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(carrier.artifactDigest)
      || carrier.requestedRetentionDays !== REPOSITORY_MAINTENANCE_RECOVERY_RETENTION_DAYS
      || typeof carrier.createdAt !== 'string' || !Number.isFinite(Date.parse(carrier.createdAt))
      || typeof carrier.expiresAt !== 'string' || !Number.isFinite(Date.parse(carrier.expiresAt))
      || carrier.url !== `https://github.com/${carrier.repository}/actions/runs/${carrier.runId}/artifacts/${carrier.artifactId}`) {
    throw new Error('recovery carrier locator is invalid');
  }
  return Object.freeze({ provider: carrier.provider, repository: carrier.repository,
    artifactId: carrier.artifactId, artifactName: carrier.artifactName,
    artifactDigest: carrier.artifactDigest as `sha256:${string}`, runId: carrier.runId, runAttempt: carrier.runAttempt,
    requestedRetentionDays: carrier.requestedRetentionDays, createdAt: carrier.createdAt,
    expiresAt: carrier.expiresAt, url: carrier.url });
}

function persistReceipt(value: unknown): void {
  const target = hostedPath(HOSTED_RESULT_FILE);
  const temporary = `${target}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, target);
  const directory = openSync(HOSTED_RECOVERY_CARRIER_ROOT, 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

async function assertRepositoryMaintenancePreflight(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment: NodeJS.ProcessEnv;
}>): Promise<void> {
  assertHostedRepositoryMaintenanceIdentity(input.request, input.environment);
  await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.request.repository,
    operation: async (capability) => {
      const binding = inspectGitHubApiCapability(capability);
      if (binding.origin !== 'production' || binding.principal.transport !== 'github-actions-token') {
        throw new Error('repository maintenance requires the production hosted capability owner');
      }
      assertGitHubApiMaintenanceRequest(capability, sha256(input.request));
      const repository = record(await executeGitHubApiOperation(capability, { kind: 'repository' }), 'repository');
      if (repository.full_name !== input.request.repository || repository.default_branch !== 'main') {
        throw new Error('repository maintenance repository identity is invalid');
      }
      const main = record(await executeGitHubApiOperation(capability, { kind: 'git-ref', branch: 'main' }), 'main');
      if (main.object?.sha !== input.request.expectedMainSha) {
        throw new Error('repository maintenance live main drifted');
      }
    }
  });
}

async function prepareHostedRecovery(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment: NodeJS.ProcessEnv;
}>): Promise<HostedRecoveryPreparation> {
  await assertRepositoryMaintenancePreflight(input);
  const requestDigest = sha256(input.request);
  const resumeReceipt = parseRepositoryMaintenanceResumeReceipt(input.environment.SEC_MAINTENANCE_RESUME_RECEIPT);
  if (resumeReceipt !== undefined) {
    const observation = await observeExactRefBatchResumeReceipt({
      repositoryRoot: input.repositoryRoot, repository: input.request.repository,
      expectedMainSha: input.request.expectedMainSha, requestDigest,
      retirements: retirements(input.request), resumeReceipt
    });
    return Object.freeze({
      schema: HOSTED_RECOVERY_PREPARATION_SCHEMA, requestDigest, required: true,
      refPreparation: observation.recoveryPreparation,
      reusedCarrier: parseCarrier(observation.recoveryCarrier)
    });
  }
  const refPreparation = await prepareExactRemoteRefBatchRecovery({
    repositoryRoot: input.repositoryRoot,
    repository: input.request.repository,
    expectedMainSha: input.request.expectedMainSha,
    retirements: retirements(input.request),
    requestDigest
  });
  return Object.freeze({
    schema: HOSTED_RECOVERY_PREPARATION_SCHEMA,
    requestDigest,
    required: true,
    refPreparation,
    reusedCarrier: null
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

async function loadPreEffectRecovery(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment: NodeJS.ProcessEnv;
}>): Promise<HostedPreEffectRecovery> {
  const local = parseHostedRecoveryPreparation(JSON.parse(
    readFileSync(hostedPath(HOSTED_RECOVERY_PREPARATION_FILE), 'utf8')
  ));
  const downloaded = parseHostedRecoveryPreparation(JSON.parse(
    readFileSync(hostedPath(`readback/${HOSTED_RECOVERY_PREPARATION_FILE}`), 'utf8')
  ));
  const preparation = downloaded.refPreparation;
  if (sha256(local.refPreparation) !== sha256(downloaded.refPreparation)
      || local.requestDigest !== downloaded.requestDigest
      || downloaded.requestDigest !== sha256(input.request)
      || preparation.repository !== input.request.repository
      || preparation.expectedMainSha !== input.request.expectedMainSha
      || preparation.requestDigest !== sha256(input.request)
      || sha256(preparation.retirements) !== sha256(retirements(input.request))) {
    throw new Error('downloaded recovery preparation differs from the exact maintenance batch');
  }
  const bundlePath = hostedPath(`readback/${HOSTED_RECOVERY_BUNDLE_FILE}`);
  const checksumPath = hostedPath(`readback/${HOSTED_RECOVERY_CHECKSUM_FILE}`);
  if (!existsSync(bundlePath) || !existsSync(checksumPath)) {
    throw new Error('published recovery artifact fixed bundle files are absent');
  }
  const recovery = Object.freeze({
    kind: 'bundle' as const,
    path: bundlePath,
    sha256: preparation.recovery.sha256,
    verified: true,
    verifyOutput: preparation.recovery.verifyOutput
  });
  const artifactId = positiveEnvironmentInteger(input.environment.SEC_MAINTENANCE_RECOVERY_ARTIFACT_ID, 'recovery artifact ID');
  const runId = positiveEnvironmentInteger(input.environment.SEC_MAINTENANCE_RECOVERY_RUN_ID, 'recovery run ID');
  const runAttempt = positiveEnvironmentInteger(input.environment.SEC_MAINTENANCE_RECOVERY_RUN_ATTEMPT, 'recovery run attempt');
  const artifactName = `sec-repository-maintenance-recovery-${runId}-${runAttempt}`;
  const digest = input.environment.SEC_MAINTENANCE_RECOVERY_ARTIFACT_DIGEST;
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(digest)
      || artifactName !== input.environment.SEC_MAINTENANCE_RECOVERY_ARTIFACT_NAME
      || (local.reusedCarrier === null && (String(runId) !== input.environment.GITHUB_RUN_ID
        || String(runAttempt) !== input.environment.GITHUB_RUN_ATTEMPT))
      || (local.reusedCarrier !== null && (artifactId !== local.reusedCarrier.artifactId
        || runId !== local.reusedCarrier.runId || runAttempt !== local.reusedCarrier.runAttempt
        || digest !== local.reusedCarrier.artifactDigest))) {
    throw new Error('recovery artifact identity differs from the current hosted run');
  }
  const carrier = await withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.request.repository,
    operation: async (capability): Promise<HostedRecoveryCarrier> => {
      assertGitHubApiMaintenanceRequest(capability, sha256(input.request));
      const artifact = record(await executeGitHubApiOperation(capability, {
        kind: 'maintenance-artifact', artifactId: String(artifactId)
      }), 'recovery artifact');
      const run = record(await executeGitHubApiOperation(capability, {
        kind: 'maintenance-workflow-run-attempt', runId: String(runId), runAttempt
      }), 'recovery run');
      if (artifact.id !== artifactId || artifact.name !== artifactName
          || artifact.digest !== digest || artifact.expired !== false
          || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 1
          || artifact.workflow_run?.id !== runId
          || artifact.workflow_run?.head_sha !== input.request.expectedMainSha
          || run.id !== runId || run.run_attempt !== runAttempt
          || run.head_sha !== input.request.expectedMainSha || run.event !== 'workflow_dispatch'
          || !['.github/workflows/repository-maintenance.yml',
            '.github/workflows/repository-maintenance.yml@main',
            '.github/workflows/repository-maintenance.yml@refs/heads/main'].includes(run.path)
          || run.display_title !== `maintenance/${sha256({ requestDigest: sha256(input.request), resumeReceipt: null })}`
          || typeof artifact.created_at !== 'string' || !Number.isFinite(Date.parse(artifact.created_at))
          || typeof artifact.expires_at !== 'string' || !Number.isFinite(Date.parse(artifact.expires_at))
          || Date.parse(artifact.expires_at) <= Date.now()
          || Date.parse(artifact.expires_at) <= Date.parse(artifact.created_at)) {
        throw new Error('recovery artifact provider provenance or retention readback differs');
      }
      return Object.freeze({
        provider: 'github-actions-artifact', repository: input.request.repository,
        artifactId, artifactName, artifactDigest: digest as `sha256:${string}`, runId, runAttempt,
        requestedRetentionDays: REPOSITORY_MAINTENANCE_RECOVERY_RETENTION_DAYS,
        createdAt: artifact.created_at, expiresAt: artifact.expires_at,
        url: `https://github.com/${input.request.repository}/actions/runs/${runId}/artifacts/${artifactId}`
      });
    }
  });
  return Object.freeze({ preparation, recovery, carrier });
}

export async function executeRepositoryMaintenance(input: Readonly<{
  repositoryRoot: string;
  request: MaintenanceRequest;
  environment?: NodeJS.ProcessEnv;
}>): Promise<Readonly<{
  schema: 'sec-repository-maintenance-result-v3';
  requestDigest: `sha256:${string}`;
  recoveryCarrier: HostedRecoveryCarrier;
  completed: number;
  targetConverged: number;
  results: readonly unknown[];
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  await assertRepositoryMaintenancePreflight({
    repositoryRoot, request: input.request, environment: input.environment ?? process.env
  });
  const durable = await loadPreEffectRecovery({
    repositoryRoot, request: input.request, environment: input.environment ?? process.env
  });
  const resumeReceipt = parseRepositoryMaintenanceResumeReceipt((input.environment ?? process.env).SEC_MAINTENANCE_RESUME_RECEIPT);
  const resume = resumeReceipt === undefined ? undefined : await observeExactRefBatchResumeReceipt({
    repositoryRoot, repository: input.request.repository, expectedMainSha: input.request.expectedMainSha,
    requestDigest: sha256(input.request), retirements: retirements(input.request), resumeReceipt
  });
  const progress = [...(resume?.progress ?? [])];
  const results = [...(resume?.results ?? [])];
  const receipt = () => ({
    schema: 'sec-repository-maintenance-result-v3', requestDigest: sha256(input.request),
    recoveryCarrier: durable.carrier, recoveryPreparation: durable.preparation,
    resumeReceipt: resumeReceipt ?? null, progress, results
  });
  persistReceipt(receipt());
  const result = await retireExactRemoteRefBatch({
    repositoryRoot, repository: input.request.repository,
    expectedMainSha: input.request.expectedMainSha,
    retirements: retirements(input.request), requestDigest: sha256(input.request),
    preEffectRecovery: {
      preparation: durable.preparation,
      recovery: durable.recovery
    },
    recoveryCarrier: durable.carrier,
    resumeObservation: resume,
    onResult: (row) => {
      const previous = results.findIndex((value) => value.branch === row.branch);
      if (previous === -1) results.push(row); else results[previous] = row;
      persistReceipt(receipt());
    },
    onProgress: (row) => { progress.push(row); persistReceipt(receipt()); }
  });
  const terminal = Object.freeze({
    ...receipt(), schema: 'sec-repository-maintenance-result-v3' as const,
    completed: result.completed, targetConverged: result.targetConverged, results: result.results
  });
  persistReceipt(terminal);
  return terminal;
}

export async function repositoryMaintenanceCli(argv: readonly string[]): Promise<string> {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--json' && argv[0] !== 'prepare-recovery')) {
    throw new Error('usage: repository-maintenance [--json] | prepare-recovery; local callers use dispatch.ts --repository owner/name --request <json-file> for one hosted batch');
  }
  if (process.env.GITHUB_ACTIONS !== 'true') {
    throw new Error('local direct retirement has no supported durable recovery provider; use dispatch.ts --repository owner/name --request <json-file> for one hosted batch, without public comments');
  }
  const request = parseHostedRepositoryMaintenanceRequest(process.env);
  const input = { repositoryRoot: process.cwd(), request, environment: process.env };
  if (argv[0] === 'prepare-recovery') {
    return JSON.stringify(await prepareHostedRecovery(input), null, 2);
  }
  const result = await executeRepositoryMaintenance(input);
  if (result.completed !== request.operations.length) process.exitCode = 1;
  return JSON.stringify(result, null, argv.includes('--json') ? 2 : 0);
}

if (import.meta.main) {
  process.stdout.write(`${await repositoryMaintenanceCli(process.argv.slice(2))}\n`);
}
