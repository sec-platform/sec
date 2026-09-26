#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DOCUMENTATION_IDENTITY_PATH } from '../documentation/active.ts';
import {
  compileReadPlan,
  parseReadPlan,
  MANDATORY_FORBIDDEN_SOURCES,
  READ_CLOSURE_REQUEST_SCHEMA,
  READ_PLAN_INPUT_SCHEMA,
  type ReadPlanInput
} from './read-plan.ts';
import {
  resolveTrustedWorkerTaskCapsule,
  TaskCapsuleProjectionUnavailableError,
  taskCapsuleProjectionBlocked
} from './task-capsule-host.ts';
import type { TaskCapsule } from './task-capsule.ts';

function fail(message: string): never {
  throw new Error(`operation-read-plan: ${message}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

export type CompiledReadClosure = Omit<
  ReadPlanInput,
  'schema' | 'taskCapsule'
>;

export interface ProspectiveWorkerOperationObservation {
  readonly taskCapsule: TaskCapsule;
  readonly readClosure: CompiledReadClosure;
  readonly runtimeRoot: string;
  readonly candidateRoot: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly changedPaths: readonly string[];
}

/**
 * Hosted phase-bound Read Plan adapter. PRE drives the manifest-only proposal
 * head before implementation; FINAL rebinds the exact implementation head for
 * reconciliation. Both paths fail closed until the independent default-branch
 * producer supplies the matching provider-verified artifact. The pure compiler
 * remains independently usable for content-only construction and verification.
 */
export async function resolveProspectiveWorkerOperation(
  runtimeRootInput: string,
  candidateRootInput: string
): Promise<ProspectiveWorkerOperationObservation> {
  const observation = await resolveTrustedWorkerTaskCapsule(
    runtimeRootInput,
    candidateRootInput
  );
  const sources = Object.freeze([
    ...observation.authorityOwners.map((source) => Object.freeze({
      id: source.id,
      ref: source.ref,
      owner: source.owner,
      reasonCode: source.ref === 'AGENTS.md'
        ? 'agent-entry-route'
        : source.ref === DOCUMENTATION_IDENTITY_PATH
          ? 'documentation-identity-registry'
          : 'canonical-domain-owner',
      revision: source.revision,
      contentDigest: source.contentDigest,
      projection: source.projection
    })),
    Object.freeze({
      id: 'work-package-manifest',
      ref: observation.manifestPath,
      owner: 'document-control-a0',
      reasonCode: 'bind-operation-scope',
      revision: observation.manifestRevision,
      contentDigest: observation.manifestDigest,
      projection: null
    })
  ]);
  const requiredRefs = Object.freeze(sources.map((source) => Object.freeze({
    id: source.id,
    ref: source.ref,
    owner: source.owner,
    reasonCode: source.reasonCode,
    revision: source.revision,
    projection: source.projection
  })));
  const readReceipts = Object.freeze(requiredRefs.map((reference) => Object.freeze({
    refId: reference.id,
    owner: reference.owner,
    revision: reference.revision,
    reasonCode: reference.reasonCode,
    contentDigest: sources.find(({ id }) => id === reference.id)!.contentDigest
  })));
  const readClosure: CompiledReadClosure = Object.freeze({
    requiredRefs,
    conditionalRefs: Object.freeze([]),
    forbiddenSources: MANDATORY_FORBIDDEN_SOURCES,
    maxSkillBodies: 1,
    unresolvedFrontier: Object.freeze([]),
    readReceipts,
    invalidationInputs: Object.freeze([
      Object.freeze({
        id: 'activation-artifact',
        revision: observation.activationDigest
      }),
      Object.freeze({
        id: 'current-spec',
        revision: observation.currentSpecRevision
      })
    ])
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
    if (raw.schema !== READ_CLOSURE_REQUEST_SCHEMA || Object.keys(raw).length !== 1) {
      fail('compile input must be an authority-free read closure request; refs, receipts, and policy are trusted-derived.');
    }
    const observation = await resolveProspectiveWorkerOperation(
      runtimeRoot,
      options.candidateRoot
    );
    const plan = compileReadPlan({
      ...observation.readClosure,
      schema: READ_PLAN_INPUT_SCHEMA,
      taskCapsule: observation.taskCapsule
    });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (command === 'verify') {
    if (options.plan === undefined || options.input !== undefined || options.candidateRoot !== undefined) {
      fail('verify requires --plan <inline-json|file> only.');
    }
    const plan = parseReadPlan(
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
    if (error instanceof TaskCapsuleProjectionUnavailableError) {
      console.error(JSON.stringify(taskCapsuleProjectionBlocked(error)));
    }
    else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 2;
  }
}
