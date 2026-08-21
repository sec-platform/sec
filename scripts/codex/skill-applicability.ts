#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  compileSecOperationReadPlanV1,
  parseSecOperationReadPlanV1,
  projectSecSkillEnvelopeFromOperationReadPlanV1,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  type SecOperationReadPlanV1
} from '../../platform/shared/agent-operation-read-plan-contract.ts';
import {
  evaluateSecSkillApplicabilityV1,
  isSecSkillQuarantinePath,
  type SecSkillApplicabilityDecisionV1
} from '../../platform/shared/agent-skill-contract.ts';
import {
  createSecSkillGuidanceProjectionV1,
  createSecSkillGuidanceV1,
  secSkillRepositoryPathV1,
  type SecSkillGuidanceV1
} from '../../platform/shared/agent-skill-runtime-contract.ts';
import { canonicalJson } from '../../platform/shared/canonical-primitives.ts';
import { isolatedGitReadEnvironment } from '../../platform/shared/git-read-environment.ts';
import { resolveProspectiveWorkerOperationV1 } from './operation-read-plan.ts';
import {
  SecTaskCapsuleProjectionUnavailableError,
  taskCapsuleProjectionBlockedV1
} from './task-capsule.ts';

function fail(message: string): never {
  console.error(`skill-applicability: ${message}`);
  process.exit(2);
}

interface GitResultV1 {
  readonly status: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

function gitBytes(cwd: string, args: readonly string[]): GitResultV1 {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    env: isolatedGitReadEnvironment()
  });
  return Object.freeze({
    status: result.status ?? -1,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(String(result.stderr ?? result.error?.message ?? ''))
  });
}

function requireGitBytes(cwd: string, args: readonly string[], label: string): Buffer {
  const result = gitBytes(cwd, args);
  if (result.status !== 0) {
    throw new Error(`${label}: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout;
}

function requireGitOutput(cwd: string, args: readonly string[], label: string): string {
  return requireGitBytes(cwd, args, label).toString('utf8').trim();
}

function blobRevision(cwd: string, revision: string, repositoryPath: string): string | null {
  const result = gitBytes(cwd, ['rev-parse', '--verify', `${revision}:${repositoryPath}`]);
  if (result.status !== 0) return null;
  const sha = result.stdout.toString('utf8').trim();
  return /^[0-9a-f]{40,64}$/u.test(sha) ? sha : null;
}

function decodeExactUtf8(bytes: Buffer, label: string): string {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not strict UTF-8.`, { cause: error });
  }
  if (!Buffer.from(source, 'utf8').equals(bytes)) {
    throw new Error(`${label} is not exact UTF-8.`);
  }
  return source;
}

async function readJsonArgument(raw: string, cwd: string): Promise<unknown> {
  let source = raw;
  try {
    source = await readFile(path.resolve(cwd, raw), 'utf8');
  } catch {
    // A non-file argument is treated as inline JSON; no fallback discovery is performed.
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    fail(`--read-plan must be inline JSON or one readable JSON file: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
}

function admittedSkillGuidanceRef(
  plan: SecOperationReadPlanV1,
  decision: SecSkillApplicabilityDecisionV1
) {
  if (decision.status !== 'applicable' || decision.selectedSkillId === null) return null;
  const repositoryPath = secSkillRepositoryPathV1(decision.selectedSkillId);
  const matches = plan.conditionalRefs.filter((reference) => (
    reference.ref === repositoryPath
    && reference.owner === decision.selectedSkillId
    && reference.revision === decision.trustedRevision
    && reference.reasonCode === 'post-applicability-guidance'
    && reference.frontierId === 'skill-guidance-applicability'
  ));
  if (matches.length !== 1) {
    throw new Error('selected Skill guidance is not exactly admitted by the Operation Read Plan.');
  }
  const reference = matches[0]!;
  const frontier = plan.unresolvedFrontier.find(({ id }) => id === reference.frontierId);
  if (frontier === undefined || !frontier.allowedRefIds.includes(reference.id)) {
    throw new Error('selected Skill guidance is not bound by the admitted Read Plan frontier.');
  }
  return reference;
}

/**
 * Reads zero or one exact trusted Skill body after the pure applicability
 * decision. Non-applicable/ambiguous/stale/conflict/unresolved decisions return
 * null before any Skill Git object is touched. Applicable guidance must be one
 * exact conditional ref already admitted by the Operation Read Plan.
 */
export function readTrustedSecSkillGuidanceV1(input: Readonly<{
  repositoryRoot: string;
  plan: SecOperationReadPlanV1;
  decision: SecSkillApplicabilityDecisionV1;
}>): SecSkillGuidanceV1 | null {
  if (input.decision.status !== 'applicable' || input.decision.selectedSkillId === null) {
    return null;
  }
  if (input.plan.maxSkillBodies !== 1 || input.plan.preApplicabilitySkillBodiesRead !== 0) {
    throw new Error('trusted Skill guidance requires one post-applicability body budget and zero prior body reads.');
  }
  const admitted = admittedSkillGuidanceRef(input.plan, input.decision);
  if (admitted === null) throw new Error('applicable Skill has no admitted guidance ref.');
  const repositoryPath = secSkillRepositoryPathV1(input.decision.selectedSkillId);
  const blob = requireGitOutput(
    input.repositoryRoot,
    ['rev-parse', '--verify', `${input.decision.trustedRevision}:${repositoryPath}`],
    'trusted Skill blob resolution'
  );
  const source = decodeExactUtf8(requireGitBytes(
    input.repositoryRoot,
    ['show', `${input.decision.trustedRevision}:${repositoryPath}`],
    'trusted Skill body read'
  ), 'trusted Skill body');
  return createSecSkillGuidanceV1({
    decision: input.decision,
    readPlanDigest: input.plan.readPlanDigest,
    readPlanRefId: admitted.id,
    repositoryPath,
    blobRevision: blob,
    source
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: { readPlan?: string; candidateRoot?: string; includeGuidance: boolean } = {
    includeGuidance: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--include-guidance') {
      if (options.includeGuidance) fail('duplicate argument: --include-guidance');
      options.includeGuidance = true;
      continue;
    }
    if (argument !== '--read-plan' && argument !== '--candidate-root') fail(`unknown argument: ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${argument} requires a value.`);
    const key = argument === '--read-plan' ? 'readPlan' : 'candidateRoot';
    if (options[key] !== undefined) fail(`duplicate argument: ${argument}`);
    options[key] = value;
    index += 1;
  }
  if (options.readPlan === undefined) fail('--read-plan <inline-json|file> is required.');
  if (options.candidateRoot === undefined) fail('--candidate-root <path> is required.');
  const runtimeRoot = path.resolve(import.meta.dir, '../..');
  const invokedRoot = requireGitOutput(process.cwd(), ['rev-parse', '--show-toplevel'], 'runtime repository discovery');
  if (path.resolve(invokedRoot) !== runtimeRoot) {
    fail('Skill applicability must be invoked from the exact trusted-runtime repository root.');
  }
  let plan: SecOperationReadPlanV1;
  try {
    plan = parseSecOperationReadPlanV1(await readJsonArgument(options.readPlan, runtimeRoot));
  } catch (error) {
    fail(`Read Plan verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const observation = await resolveProspectiveWorkerOperationV1(runtimeRoot, options.candidateRoot);
  const expectedPlan = compileSecOperationReadPlanV1({
    ...observation.readClosure,
    schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
    taskCapsule: observation.taskCapsule
  });
  if (JSON.stringify(canonicalJson(expectedPlan)) !== JSON.stringify(canonicalJson(plan))) {
    fail('Read Plan was not fully produced by the exact trusted-resolver worker/implement projection.');
  }
  const envelope = projectSecSkillEnvelopeFromOperationReadPlanV1(plan);
  const quarantined = observation.changedPaths.filter(isSecSkillQuarantinePath);
  const trustedSkillRevisions: Record<string, string> = {};
  const candidateSkillRevisions: Record<string, string> = {};
  for (const repositoryPath of quarantined) {
    const trusted = blobRevision(observation.candidateRoot, observation.trustedRevision, repositoryPath);
    const candidate = blobRevision(observation.candidateRoot, observation.targetCandidate, repositoryPath);
    if (trusted !== null) trustedSkillRevisions[repositoryPath] = trusted;
    if (candidate !== null) candidateSkillRevisions[repositoryPath] = candidate;
  }
  const decision = evaluateSecSkillApplicabilityV1({
    ...envelope,
    changedPaths: observation.changedPaths,
    trustedSkillRevisions,
    candidateSkillRevisions
  });
  if (!options.includeGuidance) {
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
    return;
  }
  const guidance = readTrustedSecSkillGuidanceV1({
    repositoryRoot: observation.candidateRoot,
    plan,
    decision
  });
  process.stdout.write(`${JSON.stringify(createSecSkillGuidanceProjectionV1({
    decision,
    guidance
  }), null, 2)}\n`);
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
