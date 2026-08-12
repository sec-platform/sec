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
  isSecSkillQuarantinePath
} from '../../platform/shared/agent-skill-contract.ts';
import { canonicalJson } from '../../platform/shared/canonical-primitives.ts';
import { resolveProspectiveWorkerOperationV1 } from './operation-read-plan.ts';
import {
  SecTaskCapsuleProjectionUnavailableError,
  taskCapsuleProjectionBlockedV1
} from './task-capsule.ts';

function fail(message: string): never {
  console.error(`skill-applicability: ${message}`);
  process.exit(2);
}

function gitOutput(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function requireGitOutput(cwd: string, args: string[], label: string): string {
  const result = gitOutput(cwd, args);
  if (result.status !== 0) fail(`${label}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function blobRevision(cwd: string, revision: string, repositoryPath: string): string | null {
  const result = gitOutput(cwd, ['rev-parse', '--verify', `${revision}:${repositoryPath}`]);
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return /^[0-9a-f]{40,64}$/u.test(sha) ? sha : null;
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: { readPlan?: string; candidateRoot?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
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
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
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
