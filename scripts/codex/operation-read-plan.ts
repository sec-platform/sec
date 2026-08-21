#!/usr/bin/env bun

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
 * Hosted phase-bound Read Plan adapter. PRE drives the manifest-only proposal
 * head before implementation; FINAL rebinds the exact implementation head for
 * reconciliation. Both paths fail closed until the independent default-branch
 * producer supplies the matching provider-verified artifact. The pure compiler
 * remains independently usable for content-only construction and verification.
 */
export async function resolveProspectiveWorkerOperationV1(
  runtimeRootInput: string,
  candidateRootInput: string
): Promise<SecProspectiveWorkerOperationObservationV1> {
  const observation = await resolveTrustedWorkerTaskCapsuleV1(
    runtimeRootInput,
    candidateRootInput
  );
  const sources = Object.freeze([
    ...observation.authorityOwners.map((source) => Object.freeze({
      id: source.id,
      ref: source.ref,
      owner: source.owner,
      reasonCode: source.id === 'agents-entry'
        ? 'agent-entry-route'
        : source.id === 'documentation-registry'
          ? 'document-authority-registry'
          : 'canonical-domain-owner',
      revision: source.revision,
      contentDigest: source.contentDigest
    })),
    Object.freeze({
      id: 'work-package-manifest',
      ref: observation.manifestPath,
      owner: 'document-control-a0',
      reasonCode: 'bind-operation-scope',
      revision: observation.manifestRevision,
      contentDigest: observation.manifestDigest
    })
  ]);
  const requiredRefs = Object.freeze(sources.map((source) => Object.freeze({
    id: source.id,
    ref: source.ref,
    owner: source.owner,
    reasonCode: source.reasonCode,
    revision: source.revision
  })));
  const readReceipts = Object.freeze(requiredRefs.map((reference) => Object.freeze({
    refId: reference.id,
    owner: reference.owner,
    revision: reference.revision,
    reasonCode: reference.reasonCode,
    contentDigest: sources.find(({ id }) => id === reference.id)!.contentDigest
  })));
  const skillGuidanceRefs = Object.freeze(
    observation.taskCapsule.planningContext.skillCandidateIds.map((skillId) => Object.freeze({
      id: `skill-guidance-${skillId}`,
      ref: `.agents/skills/${skillId}/SKILL.md`,
      owner: skillId,
      reasonCode: 'post-applicability-guidance',
      revision: observation.trustedRevision,
      frontierId: 'skill-guidance-applicability'
    }))
  );
  const readClosure: SecCompiledReadClosureV1 = Object.freeze({
    requiredRefs,
    conditionalRefs: skillGuidanceRefs,
    forbiddenSources: SEC_OPERATION_MANDATORY_FORBIDDEN_SOURCES,
    maxSkillBodies: skillGuidanceRefs.length === 0 ? 0 : 1,
    unresolvedFrontier: skillGuidanceRefs.length === 0
      ? Object.freeze([])
      : Object.freeze([Object.freeze({
          id: 'skill-guidance-applicability',
          reasonCode: 'post-applicability-guidance',
          allowedRefIds: Object.freeze(skillGuidanceRefs.map(({ id }) => id))
        })]),
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
      console.error(JSON.stringify(taskCapsuleProjectionBlockedV1(error)));
    }
    else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 2;
  }
}
