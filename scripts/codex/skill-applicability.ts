#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  evaluateSecSkillApplicabilityV1,
  isSecSkillQuarantinePath,
  type SecSkillApplicabilityEnvelopeV1
} from '../../platform/shared/agent-skill-contract.ts';

function fail(message: string): never {
  console.error(`skill-applicability: ${message}`);
  process.exit(2);
}

function gitOutput(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function changedPathsBetween(cwd: string, base: string, head: string): string[] {
  const result = gitOutput(cwd, ['diff', '--name-status', base, head]);
  if (result.status !== 0) {
    fail(`git diff --name-status ${base} ${head} failed: ${result.stderr.trim()}`);
  }
  const paths: string[] = [];
  for (const line of result.stdout.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const fields = line.split('\t').slice(1).filter((field) => field.trim().length > 0);
    if (fields.length === 0) continue;
    paths.push(...fields);
  }
  return [...new Set(paths)].sort();
}

function blobRevision(cwd: string, revision: string, repositoryPath: string): string | null {
  const result = gitOutput(cwd, ['rev-parse', '--verify', `${revision}:${repositoryPath}`]);
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return /^[0-9a-f]{40}$/u.test(sha) ? sha : null;
}

async function resolveEnvelope(
  raw: string,
  cwd: string
): Promise<SecSkillApplicabilityEnvelopeV1> {
  let source = raw;
  try {
    source = await readFile(path.resolve(cwd, raw), 'utf8');
  } catch {
    // Treat the argument as inline JSON when it is not an existing file.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    fail(`--envelope must be inline JSON or a readable JSON file: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('--envelope must be one JSON object.');
  }
  return parsed as SecSkillApplicabilityEnvelopeV1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: { envelope?: string; base?: string; head?: string; cwd?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === '--envelope') {
      options.envelope = args[index + 1];
      index += 1;
    } else if (argument === '--base') {
      options.base = args[index + 1];
      index += 1;
    } else if (argument === '--head') {
      options.head = args[index + 1];
      index += 1;
    } else if (argument === '--cwd') {
      options.cwd = args[index + 1];
      index += 1;
    } else {
      fail(`unknown argument: ${argument}`);
    }
  }
  if (options.envelope === undefined) {
    fail('--envelope <inline-json|file> is required.');
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const envelope = await resolveEnvelope(options.envelope, cwd);

  const base = options.base ?? (typeof envelope.trustedRevision === 'string' ? envelope.trustedRevision : null);
  const head = options.head ?? (typeof envelope.targetCandidate === 'string' ? envelope.targetCandidate : null);

  const enrichment: {
    changedPaths?: string[];
    trustedSkillRevisions?: Record<string, string>;
    candidateSkillRevisions?: Record<string, string>;
  } = {};
  if (envelope.changedPaths === undefined && base !== null && head !== null) {
    try {
      enrichment.changedPaths = changedPathsBetween(cwd, base, head);
    } catch (error) {
      // A label-only target candidate is not a Git revision. Degrade to the
      // pure envelope decision and keep the explicit envelope bindings.
      console.warn(`skill-applicability: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const quarantined = (envelope.changedPaths ?? enrichment.changedPaths ?? []).filter(isSecSkillQuarantinePath);
  if (envelope.trustedSkillRevisions === undefined && base !== null) {
    const revisions: Record<string, string> = {};
    for (const repositoryPath of quarantined) {
      const revision = blobRevision(cwd, base, repositoryPath);
      if (revision !== null) revisions[repositoryPath] = revision;
    }
    if (Object.keys(revisions).length > 0) enrichment.trustedSkillRevisions = revisions;
  }
  if (envelope.candidateSkillRevisions === undefined && head !== null) {
    const revisions: Record<string, string> = {};
    for (const repositoryPath of quarantined) {
      const revision = blobRevision(cwd, head, repositoryPath);
      if (revision !== null) revisions[repositoryPath] = revision;
    }
    if (Object.keys(revisions).length > 0) enrichment.candidateSkillRevisions = revisions;
  }

  const decision = evaluateSecSkillApplicabilityV1({ ...envelope, ...enrichment });
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
}

void main();
