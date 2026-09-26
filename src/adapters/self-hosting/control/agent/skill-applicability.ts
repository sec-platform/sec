#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson } from '../../../../contracts/canonical.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import {
  GIT_READ_DEFAULT_OPERATION_BUDGET,
  type GitReadSession
} from '../../../providers/git-read/runtime/session.ts';
import { resolveProspectiveWorkerOperation } from './operation-read-plan.ts';
import {
  compileReadPlan,
  parseReadPlan,
  projectSkillEnvelopeFromReadPlan,
  READ_PLAN_INPUT_SCHEMA,
  type ReadPlan
} from './read-plan.ts';
import {
  evaluateSkillApplicability,
  isSkillQuarantinePath
} from './skill.ts';
import {
  TaskCapsuleProjectionUnavailableError,
  taskCapsuleProjectionBlocked
} from './task-capsule-host.ts';

function fail(message: string): never {
  console.error(`skill-applicability: ${message}`);
  process.exit(2);
}

function decodeGitText(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not strict UTF-8.`, { cause: error });
  }
}

async function runGitText(
  session: GitReadSession,
  args: readonly string[],
  label: string
): Promise<Readonly<{ code: number; stderr: string; stdout: string }>> {
  const command = await session.run(args);
  if (command.kind !== 'completed') {
    throw new GitReadAuthorityError(`${label} could not use the Git read provider.`, command);
  }
  const recordFailure = session.consumeRecords(1);
  if (recordFailure !== null) {
    throw new GitReadAuthorityError(`${label} exceeded the Git read record budget.`, recordFailure);
  }
  return Object.freeze({
    code: command.result.code,
    stderr: command.result.stderr,
    stdout: decodeGitText(command.result.stdout, label)
  });
}

async function requireGitOutput(
  session: GitReadSession,
  args: readonly string[],
  label: string
): Promise<string> {
  const result = await runGitText(session, args, label);
  if (result.code !== 0) fail(`${label}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function blobRevision(
  session: GitReadSession,
  revision: string,
  repositoryPath: string
): Promise<string | null> {
  const result = await runGitText(
    session,
    ['rev-parse', '--verify', `${revision}:${repositoryPath}`],
    `Skill blob identity for ${repositoryPath}`
  );
  if (result.code !== 0) return null;
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
  const invokedRoot = await withAuthorityGitReadSession(
    { cwd: path.resolve(process.cwd()), budget: GIT_READ_DEFAULT_OPERATION_BUDGET },
    (session) => requireGitOutput(session, ['rev-parse', '--show-toplevel'], 'runtime repository discovery')
  );
  if (path.resolve(invokedRoot) !== runtimeRoot) {
    fail('Skill applicability must be invoked from the exact trusted-runtime repository root.');
  }
  let plan: ReadPlan;
  try {
    plan = parseReadPlan(await readJsonArgument(options.readPlan, runtimeRoot));
  } catch (error) {
    fail(`Read Plan verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const observation = await resolveProspectiveWorkerOperation(runtimeRoot, options.candidateRoot);
  const expectedPlan = compileReadPlan({
    ...observation.readClosure,
    schema: READ_PLAN_INPUT_SCHEMA,
    taskCapsule: observation.taskCapsule
  });
  if (JSON.stringify(canonicalJson(expectedPlan)) !== JSON.stringify(canonicalJson(plan))) {
    fail('Read Plan was not fully produced by the exact trusted-resolver worker/implement projection.');
  }
  const envelope = projectSkillEnvelopeFromReadPlan(plan);
  const quarantined = observation.changedPaths.filter(isSkillQuarantinePath);
  const { trustedSkillRevisions, candidateSkillRevisions } = await withAuthorityGitReadSession(
    { cwd: observation.candidateRoot, budget: GIT_READ_DEFAULT_OPERATION_BUDGET },
    async (session) => {
      const trusted: Record<string, string> = {};
      const candidate: Record<string, string> = {};
      for (const repositoryPath of quarantined) {
        const trustedRevision = await blobRevision(
          session,
          observation.trustedRevision,
          repositoryPath
        );
        const candidateRevision = await blobRevision(
          session,
          observation.targetCandidate,
          repositoryPath
        );
        if (trustedRevision !== null) trusted[repositoryPath] = trustedRevision;
        if (candidateRevision !== null) candidate[repositoryPath] = candidateRevision;
      }
      return Object.freeze({
        trustedSkillRevisions: Object.freeze(trusted),
        candidateSkillRevisions: Object.freeze(candidate)
      });
    }
  );
  const decision = evaluateSkillApplicability({
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
    if (error instanceof TaskCapsuleProjectionUnavailableError) {
      console.error(JSON.stringify(taskCapsuleProjectionBlocked(error)));
    }
    else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 2;
  }
}
