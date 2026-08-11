#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  compileSecOperationReadPlanV1,
  parseSecOperationReadPlanV1,
  SEC_OPERATION_MANDATORY_FORBIDDEN_SOURCES,
  SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  type SecOperationReadPlanInputV1
} from '../../platform/shared/agent-operation-read-plan-contract.ts';
import type { SecTaskCapsuleV1 } from '../../platform/shared/agent-task-capsule-contract.ts';
import {
  resolveTrustedWorkerTaskCapsuleV1,
  SecTaskCapsuleProjectionUnavailableError,
  taskCapsuleProjectionBlockedV1
} from './task-capsule.ts';

function fail(message: string): never {
  throw new Error(`operation-read-plan: ${message}`);
}

function gitOutput(cwd: string, args: readonly string[]): {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', windowsHide: true });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

function requireGitOutput(cwd: string, args: readonly string[], label: string): string {
  const result = gitOutput(cwd, args);
  if (result.status !== 0) fail(`${label}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function requireBlobRevision(cwd: string, revision: string, repositoryPath: string): string {
  const value = requireGitOutput(
    cwd,
    ['rev-parse', '--verify', `${revision}:${repositoryPath}`],
    `exact blob revision for ${repositoryPath}`
  );
  if (!/^[0-9a-f]{40,64}$/u.test(value)) {
    fail(`exact blob revision is malformed for ${repositoryPath}.`);
  }
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

export type SecCompiledReadClosureV1 = Omit<
  SecOperationReadPlanInputV1,
  'schema' | 'taskCapsule'
>;

export interface SecProspectiveWorkerOperationObservationV1 {
  readonly taskCapsule: SecTaskCapsuleV1;
  readonly readClosure: SecCompiledReadClosureV1;
  readonly runtimeRoot: string;
  readonly candidateRoot: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly changedPaths: readonly string[];
}

/**
 * Reserved Read Plan adapter. Phase A cannot enter this positive path until
 * the upstream document-control/A0 owner supplies an issuer-bound activation
 * receipt. The pure Read Plan compiler remains independently usable for
 * content construction and verification.
 */
export async function resolveProspectiveWorkerOperationV1(
  runtimeRootInput: string,
  candidateRootInput: string
): Promise<SecProspectiveWorkerOperationObservationV1> {
  const observation = await resolveTrustedWorkerTaskCapsuleV1(
    runtimeRootInput,
    candidateRootInput
  );
  const requiredRefs = Object.freeze([
    Object.freeze({
      id: 'agents-entry',
      ref: 'AGENTS.md',
      owner: observation.taskOwner,
      revision: requireBlobRevision(
        observation.candidateRoot,
        observation.trustedRevision,
        'AGENTS.md'
      ),
      reasonCode: 'agent-entry-route'
    }),
    Object.freeze({
      id: 'development-governance',
      ref: 'docs/development-governance.md',
      owner: observation.taskOwner,
      revision: requireBlobRevision(
        observation.candidateRoot,
        observation.trustedRevision,
        'docs/development-governance.md'
      ),
      reasonCode: 'operation-governance-owner'
    }),
    Object.freeze({
      id: 'documentation-authority',
      ref: 'docs/authority.json',
      owner: observation.taskOwner,
      revision: requireBlobRevision(
        observation.candidateRoot,
        observation.trustedRevision,
        'docs/authority.json'
      ),
      reasonCode: 'document-authority-registry'
    }),
    Object.freeze({
      id: 'work-package-manifest',
      ref: observation.manifestPath,
      owner: observation.taskOwner,
      revision: observation.manifestDigest,
      reasonCode: 'bind-operation-scope'
    })
  ]);
  const readClosure: SecCompiledReadClosureV1 = Object.freeze({
    requiredRefs,
    conditionalRefs: Object.freeze([]),
    forbiddenSources: SEC_OPERATION_MANDATORY_FORBIDDEN_SOURCES,
    maxSkillBodies: 1,
    unresolvedFrontier: Object.freeze([]),
    readReceipts: Object.freeze([]),
    invalidationInputs: Object.freeze([])
  });
  return Object.freeze({
    taskCapsule: observation.taskCapsule,
    readClosure,
    runtimeRoot: observation.runtimeRoot,
    candidateRoot: observation.candidateRoot,
    trustedRevision: observation.trustedRevision,
    targetCandidate: observation.targetCandidate,
    changedPaths: observation.changedPaths
  });
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
  const options: { input?: string; plan?: string; candidateRoot?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument !== '--input' && argument !== '--plan' && argument !== '--candidate-root') {
      fail(`unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${argument} requires a value.`);
    const key = argument === '--candidate-root'
      ? 'candidateRoot'
      : argument.slice(2) as 'input' | 'plan';
    if (options[key] !== undefined) fail(`duplicate argument: ${argument}`);
    options[key] = value;
    index += 1;
  }
  const runtimeRoot = path.resolve(import.meta.dir, '../..');
  if (command === 'compile') {
    if (options.input === undefined || options.plan !== undefined || options.candidateRoot === undefined) {
      fail('compile requires --input <inline-json|file> --candidate-root <path> and rejects --plan.');
    }
    const raw = object(await readJsonArgument(options.input, runtimeRoot, '--input'), 'read closure');
    if (Object.hasOwn(raw, 'taskCapsule')) {
      fail('compile input cannot provide taskCapsule authority.');
    }
    if (raw.schema !== SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA || Object.keys(raw).length !== 1) {
      fail('compile input must be an authority-free read closure request; refs, receipts, and policy are trusted-derived.');
    }
    const observation = await resolveProspectiveWorkerOperationV1(
      runtimeRoot,
      options.candidateRoot
    );
    const plan = compileSecOperationReadPlanV1({
      ...observation.readClosure,
      schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
      taskCapsule: observation.taskCapsule
    });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (command === 'verify') {
    if (options.plan === undefined || options.input !== undefined || options.candidateRoot !== undefined) {
      fail('verify requires --plan <inline-json|file> only.');
    }
    const plan = parseSecOperationReadPlanV1(
      await readJsonArgument(options.plan, runtimeRoot, '--plan')
    );
    process.stdout.write(`${JSON.stringify({
      schema: 'sec-operation-read-plan-verification-v1',
      status: 'content-valid',
      authorityStatus: plan.taskCapsule.authorityStatus,
      effectAuthority: plan.taskCapsule.effectAuthority,
      taskCapsuleRef: plan.taskCapsule.ref,
      taskCapsuleDigest: plan.taskCapsule.digest,
      taskCapsuleRevision: plan.taskCapsule.revision,
      readPlanDigest: plan.readPlanDigest
    }, null, 2)}\n`);
    return;
  }
  fail('usage: operation-read-plan <compile --input ... --candidate-root ... | verify --plan ...>');
}

if (import.meta.main) {
  try {
    await main();
  }
  catch (error) {
    if (error instanceof SecTaskCapsuleProjectionUnavailableError) {
      console.error(JSON.stringify(taskCapsuleProjectionBlockedV1()));
    }
    else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 2;
  }
}
