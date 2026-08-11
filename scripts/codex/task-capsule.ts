#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  parseSecTaskCapsuleV1,
  SEC_TASK_CAPSULE_AUTHORITY_STATUS,
  SEC_TASK_CAPSULE_COMPILE_REQUEST_SCHEMA,
  type SecDigestV1,
  type SecTaskCapsuleV1
} from '../../platform/shared/agent-task-capsule-contract.ts';

export const SEC_TASK_CAPSULE_PROJECTION_BLOCKED_SCHEMA =
  'sec-task-capsule-projection-blocked-v1' as const;
export const SEC_TASK_CAPSULE_PROJECTION_BLOCKED_REASON =
  'trusted-activation-authority-unavailable' as const;

export interface SecTaskCapsuleProjectionBlockedV1 {
  readonly schema: typeof SEC_TASK_CAPSULE_PROJECTION_BLOCKED_SCHEMA;
  readonly status: 'blocked';
  readonly reasonCode: typeof SEC_TASK_CAPSULE_PROJECTION_BLOCKED_REASON;
  readonly authorityStatus: typeof SEC_TASK_CAPSULE_AUTHORITY_STATUS;
  readonly effectAuthority: 'none';
  readonly retryOwner: 'document-control-a0-activation-authority';
}

export class SecTaskCapsuleProjectionUnavailableError extends Error {
  readonly code = SEC_TASK_CAPSULE_PROJECTION_BLOCKED_REASON;

  constructor() {
    super(
      'trusted activation authority is unavailable; candidate files and recovery journals cannot issue a Task Capsule projection.'
    );
    this.name = 'SecTaskCapsuleProjectionUnavailableError';
  }
}

export function taskCapsuleProjectionBlockedV1(): SecTaskCapsuleProjectionBlockedV1 {
  return Object.freeze({
    schema: SEC_TASK_CAPSULE_PROJECTION_BLOCKED_SCHEMA,
    status: 'blocked',
    reasonCode: SEC_TASK_CAPSULE_PROJECTION_BLOCKED_REASON,
    authorityStatus: SEC_TASK_CAPSULE_AUTHORITY_STATUS,
    effectAuthority: 'none',
    retryOwner: 'document-control-a0-activation-authority'
  });
}

export interface SecTrustedWorkerTaskCapsuleObservationV1 {
  readonly taskCapsule: SecTaskCapsuleV1;
  readonly runtimeRoot: string;
  readonly candidateRoot: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly changedPaths: readonly string[];
  readonly manifestPath: string;
  readonly manifestDigest: SecDigestV1;
  readonly taskOwner: string;
}

/**
 * Reserved production seam. Phase A intentionally has no positive local
 * adapter: a candidate-controlled journal is recovery state, not an issuer
 * credential. The future document-control/A0 owner must provide a durable,
 * issuer-bound, exact-candidate-bound receipt before this seam can resolve.
 */
export async function resolveTrustedWorkerTaskCapsuleV1(
  runtimeRootInput: string,
  candidateRootInput: string
): Promise<SecTrustedWorkerTaskCapsuleObservationV1> {
  void runtimeRootInput;
  void candidateRootInput;
  throw new SecTaskCapsuleProjectionUnavailableError();
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
    await resolveTrustedWorkerTaskCapsuleV1(runtimeRoot, options.candidateRoot);
  }
  if (command === 'verify') {
    if (options.capsule === undefined || options.input !== undefined || options.candidateRoot !== undefined) {
      fail('verify requires --capsule <inline-json|file> only.');
    }
    const capsule = parseSecTaskCapsuleV1(
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
      console.error(JSON.stringify(taskCapsuleProjectionBlockedV1()));
    }
    else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 2;
  }
}
