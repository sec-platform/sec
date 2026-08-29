#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { SEC_AGENT_SKILL_IDS } from './skill.ts';
import {
  compileSecTaskCapsule,
  parseSecTaskCapsule,
  SEC_TASK_CAPSULE_AUTHORITY_STATUS,
  SEC_TASK_CAPSULE_COMPILE_REQUEST_SCHEMA,
  SEC_TASK_CAPSULE_INPUT_SCHEMA,
  type SecDigest,
  type SecTaskCapsule
} from './task-capsule.ts';
import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  resolveSecAgentOperationActivation,
  SEC_AGENT_OPERATION_ACTIVATION_REASON_CODES,
  SecAgentOperationActivationUnavailableError,
  type SecAgentOperationActivationReasonCode,
  type SecOperationAuthorityOwnerObservation
} from './agent-operation-activation.ts';

export const SEC_TASK_CAPSULE_PROJECTION_BLOCKED_SCHEMA =
  'sec-task-capsule-projection-blocked-v1' as const;
export const SEC_TASK_CAPSULE_PROJECTION_BLOCKED_REASONS =
  SEC_AGENT_OPERATION_ACTIVATION_REASON_CODES;

export interface SecTaskCapsuleProjectionBlocked {
  readonly schema: typeof SEC_TASK_CAPSULE_PROJECTION_BLOCKED_SCHEMA;
  readonly status: 'blocked';
  readonly reasonCode: SecAgentOperationActivationReasonCode;
  readonly blockerDigest: SecDigest;
  readonly authorityStatus: typeof SEC_TASK_CAPSULE_AUTHORITY_STATUS;
  readonly effectAuthority: 'none';
  readonly retryOwner: 'document-control-a0-activation-authority';
}

export class SecTaskCapsuleProjectionUnavailableError extends Error {
  readonly code: SecAgentOperationActivationReasonCode;
  readonly blockerDigest: SecDigest;

  constructor(code: SecAgentOperationActivationReasonCode, blockerDigest: SecDigest) {
    super(
      `trusted activation authority is unavailable (${code}); candidate state cannot issue a Task Capsule projection.`
    );
    this.name = 'SecTaskCapsuleProjectionUnavailableError';
    this.code = code;
    this.blockerDigest = blockerDigest;
  }
}

export function taskCapsuleProjectionBlocked(
  error: SecTaskCapsuleProjectionUnavailableError
): SecTaskCapsuleProjectionBlocked {
  return Object.freeze({
    schema: SEC_TASK_CAPSULE_PROJECTION_BLOCKED_SCHEMA,
    status: 'blocked',
    reasonCode: error.code,
    blockerDigest: error.blockerDigest,
    authorityStatus: SEC_TASK_CAPSULE_AUTHORITY_STATUS,
    effectAuthority: 'none',
    retryOwner: 'document-control-a0-activation-authority'
  });
}

export interface SecTrustedWorkerTaskCapsuleObservation {
  readonly taskCapsule: SecTaskCapsule;
  readonly runtimeRoot: string;
  readonly candidateRoot: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly changedPaths: readonly string[];
  readonly manifestPath: string;
  readonly manifestRevision: string;
  readonly manifestDigest: SecDigest;
  readonly activationPhase: 'prepare' | 'finalize';
  readonly activationDigest: SecDigest;
  readonly currentSpecRevision: SecDigest;
  readonly authorityOwners: readonly SecOperationAuthorityOwnerObservation[];
}

/**
 * Resolve the separate document-control/A0 activation authority, then compile
 * immutable unbound planning content from its exact manifest/scope facts. PRE
 * drives the proposal head; FINAL rebinds the implementation head. The Capsule
 * never becomes an effect credential: candidate files, journals and caller JSON
 * remain unable to issue or replace either hosted activation artifact.
 */
export async function resolveTrustedWorkerTaskCapsule(
  runtimeRootInput: string,
  candidateRootInput: string
): Promise<SecTrustedWorkerTaskCapsuleObservation> {
  let activation: Awaited<ReturnType<typeof resolveSecAgentOperationActivation>>;
  try {
    activation = await resolveSecAgentOperationActivation(runtimeRootInput, candidateRootInput);
  } catch (error) {
    if (error instanceof SecAgentOperationActivationUnavailableError) {
      throw new SecTaskCapsuleProjectionUnavailableError(error.reasonCode, error.blockerDigest);
    }
    throw error;
  }
  const { preparation } = activation;
  const ownerFacts = [
    ...activation.manifest.tasks.map((task) => Object.freeze({
      id: task.id,
      ref: activation.manifestPath,
      owner: task.owner,
      revision: activation.manifestDigest
    })),
    ...activation.authorityOwners.map((owner) => Object.freeze({
      id: `authority-${owner.id}`,
      ref: owner.ref,
      owner: owner.owner,
      revision: owner.revision
    }))
  ];
  const writePaths = activation.manifest.tasks
    .flatMap(({ ownedPaths }) => ownedPaths)
    .sort(compareCodeUnits);
  const readPaths = [...new Set([
    'AGENTS.md',
    'docs/authority.json',
    activation.manifestPath,
    ...activation.authorityOwners.map(({ ref }) => ref),
    ...writePaths
  ])].sort(compareCodeUnits);
  const verificationObligations = activation.manifest.tests.map((testPath, index) => Object.freeze({
    id: `test-${String(index + 1).padStart(3, '0')}`,
    revision: testPath,
    reasonCode: 'work-package-test'
  }));
  const taskCapsule = compileSecTaskCapsule({
    schema: SEC_TASK_CAPSULE_INPUT_SCHEMA,
    ref: `activation:${activation.activationDigest}`,
    planningContext: {
      operationId: preparation.operationId,
      role: preparation.role,
      operationKind: preparation.operationKind,
      goalDigest: preparation.currentSpecRevision,
      trustedRevision: preparation.trustedBaseSha,
      targetCandidate: activation.targetCandidate,
      workPackageProposalRef: preparation.proposal.manifestPath,
      workPackageProposalDigest: preparation.proposal.manifestDigest,
      workPackageProjectionId: sha256(preparation.controlDigests),
      scopeGrantId: null,
      ownerFacts,
      scopeProposal: {
        readPaths,
        writePaths,
        forbiddenPaths: activation.manifest.forbiddenPaths,
        availableCapabilities: preparation.availableCapabilities,
        authorizedResources: [],
        authorizedGates: [],
        changedPaths: activation.changedPaths
      },
      verificationObligations,
      skillCandidateIds: SEC_AGENT_SKILL_IDS
    }
  });
  return Object.freeze({
    taskCapsule,
    runtimeRoot: activation.runtimeRoot,
    candidateRoot: activation.candidateRoot,
    trustedRevision: activation.trustedRevision,
    targetCandidate: activation.targetCandidate,
    changedPaths: activation.changedPaths,
    manifestPath: activation.manifestPath,
    manifestRevision: activation.manifestRevision,
    manifestDigest: activation.manifestDigest,
    activationPhase: activation.phase,
    activationDigest: activation.activationDigest,
    currentSpecRevision: preparation.currentSpecRevision,
    authorityOwners: activation.authorityOwners
  });
}

function fail(message: string): never {
  throw new Error(`task-capsule: ${message}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

async function readJsonArgument(raw: string, cwd: string, label: string): Promise<unknown> {
  let source = raw;
  try {
    source = await readFile(path.resolve(cwd, raw), 'utf8');
  }
  catch {
    // A non-file argument is treated as inline JSON; no fallback discovery.
  }
  try {
    return JSON.parse(source) as unknown;
  }
  catch (error) {
    fail(`${label} must be inline JSON or one readable JSON file: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args.shift();
  const options: { input?: string; capsule?: string; candidateRoot?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument !== '--input' && argument !== '--capsule' && argument !== '--candidate-root') {
      fail(`unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${argument} requires a value.`);
    const key = argument === '--candidate-root'
      ? 'candidateRoot'
      : argument.slice(2) as 'input' | 'capsule';
    if (options[key] !== undefined) fail(`duplicate argument: ${argument}`);
    options[key] = value;
    index += 1;
  }
  const runtimeRoot = path.resolve(import.meta.dir, '../..');
  if (command === 'compile') {
    if (options.input === undefined || options.capsule !== undefined || options.candidateRoot === undefined) {
      fail('compile requires --input <inline-json|file> --candidate-root <path> and rejects --capsule.');
    }
    const request = object(await readJsonArgument(options.input, runtimeRoot, '--input'), 'compile request');
    if (request.schema !== SEC_TASK_CAPSULE_COMPILE_REQUEST_SCHEMA || Object.keys(request).length !== 1) {
      fail('compile input must be one authority-free schema-only request.');
    }
    const observation = await resolveTrustedWorkerTaskCapsule(runtimeRoot, options.candidateRoot);
    process.stdout.write(`${JSON.stringify(observation.taskCapsule, null, 2)}\n`);
    return;
  }
  if (command === 'verify') {
    if (options.capsule === undefined || options.input !== undefined || options.candidateRoot !== undefined) {
      fail('verify requires --capsule <inline-json|file> only.');
    }
    const capsule = parseSecTaskCapsule(
      await readJsonArgument(options.capsule, runtimeRoot, '--capsule')
    );
    process.stdout.write(`${JSON.stringify({
      schema: 'sec-task-capsule-verification-v1',
      status: 'content-valid',
      authorityStatus: capsule.authorityStatus,
      effectAuthority: capsule.effectAuthority,
      taskCapsuleRef: capsule.ref,
      taskCapsuleDigest: capsule.digest,
      taskCapsuleRevision: capsule.revision
    }, null, 2)}\n`);
    return;
  }
  fail('usage: task-capsule <compile --input ... --candidate-root ... | verify --capsule ...>');
}

if (import.meta.main) {
  try {
    await main();
  }
  catch (error) {
    if (error instanceof SecTaskCapsuleProjectionUnavailableError) {
      console.error(JSON.stringify(taskCapsuleProjectionBlocked(error)));
    }
    else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 2;
  }
}
