import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  assertCiExpectedHead,
  CodexDevelopmentBuildVerificationInputV2,
  CodexDevelopmentBuildVerificationPlanV1,
  CI_VERIFICATION_CONTRACT_REVISION,
  type CiVerificationGateStep,
  type CodexDevelopmentVerificationPlanProfileV1
} from '../platform/shared/ci-verification-plan.ts';
import {
  CodexDevelopmentFinalizeVerificationEvidenceV2,
  CodexDevelopmentPrepareVerificationEvidenceTarget,
  CodexDevelopmentVerificationArtifactRetentionDays,
  CodexDevelopmentVerificationDigest,
  CodexDevelopmentWriteVerificationEvidenceAtomic,
  type CodexDevelopmentVerificationEvidenceV2,
  type CodexDevelopmentVerificationGateEvidenceV2
} from '../platform/shared/ci-evidence-contract.ts';
import { gitChangedFileDiffArgs, parseGitChangedFileOutput } from '../platform/shared/ci-git-changed-files.ts';
import {
  CodexDevelopmentParseWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest
} from './codex/work-package-contract.ts';

const VERIFICATION_EVIDENCE_PATH = '.tmp/ci-verification-evidence.json';
const FAILURE_TAIL_CHARACTER_LIMIT = 24_000;
const INVALIDATION_RULES = [
  'exact head SHA or tree SHA changes',
  'current PR base SHA or exact affected base SHA changes',
  'CI contract revision, profile, gate plan, or changed paths change',
  'Work Package manifest path or digest changes',
  'tracked worktree is not clean before and after verification',
  'hosted artifact is missing, expired, or has a mismatched digest'
];

type GateProcessResult = {
  code: number;
  rawOutputDigest: string;
  failureTail: string;
};

export type CodexDevelopmentCiVerificationMainOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  gitRevision?: (ref: string) => string | null;
  trackedTreeIsClean?: () => boolean;
  changedFiles?: (baseRef: string) => string[] | null;
  runGate?: (step: { id: string; argv: string[]; env: NodeJS.ProcessEnv }) => Promise<GateProcessResult>;
  writeEvidence?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV2) => void;
};

function parseProfile(argv: string[]): { profile: CodexDevelopmentVerificationPlanProfileV1; expectedHead: string | undefined } {
  let profile: CodexDevelopmentVerificationPlanProfileV1 | null = null;
  let expectedHead: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument !== '--profile' && argument !== '--expected-head') {
      throw new Error(`Unknown CI verification argument: ${argument}.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`CI verification ${argument} requires a value.`);
    if (argument === '--profile') {
      if (profile !== null) throw new Error('CI verification --profile may only be specified once.');
      if (value !== 'quick' && value !== 'full') throw new Error('CI verification requires --profile quick|full.');
      profile = value;
    } else {
      if (expectedHead !== undefined) throw new Error('CI verification --expected-head may only be specified once.');
      expectedHead = value;
    }
    index += 1;
  }
  if (profile === null) throw new Error('CI verification requires --profile quick|full.');
  return { profile, expectedHead };
}

function defaultGitRevision(ref: string): string | null {
  const result = spawnSync('git', ['rev-parse', ref], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function defaultTrackedTreeIsClean(): boolean {
  const result = spawnSync('git', [
    '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=normal', '--ignored=no'
  ], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.length === 0;
}

function defaultChangedFiles(baseRef: string): string[] | null {
  const result = spawnSync('git', gitChangedFileDiffArgs(baseRef), { encoding: 'utf8' });
  if (result.status !== 0) return null;
  try {
    return parseGitChangedFileOutput(result.stdout);
  } catch {
    return null;
  }
}

function defaultRunGate(step: { id: string; argv: string[]; env: NodeJS.ProcessEnv }): Promise<GateProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(step.argv[0]!, step.argv.slice(1), {
      env: step.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const hash = createHash('sha256');
    let boundedTail = '';
    let settled = false;
    const observe = (chunk: Buffer): void => {
      hash.update(chunk);
      boundedTail = `${boundedTail}${chunk.toString('utf8')}`;
      if (boundedTail.length > FAILURE_TAIL_CHARACTER_LIMIT) {
        boundedTail = boundedTail.slice(-FAILURE_TAIL_CHARACTER_LIMIT);
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      observe(chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      observe(chunk);
      process.stderr.write(chunk);
    });
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve({
        code,
        rawOutputDigest: `sha256:${hash.digest('hex')}`,
        failureTail: boundedTail.trim()
      });
    };
    child.on('error', (error) => {
      const message = `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
      observe(Buffer.from(message));
      process.stderr.write(message);
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

function notRunGate(step: CiVerificationGateStep): CodexDevelopmentVerificationGateEvidenceV2 {
  return {
    id: step.id,
    argv: ['bun', ...step.args],
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failureTail: null,
    rawOutputDigest: null,
    notRunReason: 'Gate was not reached because preflight or an earlier fail-fast gate did not complete.'
  };
}

function tail(output: string, fallback: string): string {
  const combined = output.trim() || fallback;
  return combined.length > FAILURE_TAIL_CHARACTER_LIMIT
    ? combined.slice(-FAILURE_TAIL_CHARACTER_LIMIT)
    : combined;
}

function manifestBinding(env: NodeJS.ProcessEnv): { manifestPath: string | null; manifestDigest: string | null } {
  const manifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
  if (!manifestPath) return { manifestPath: null, manifestDigest: null };
  if (!/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
    throw new Error('SEC_WORK_PACKAGE_MANIFEST_PATH must be a canonical repository-relative Work Package path.');
  }
  const source = readFileSync(path.resolve(manifestPath));
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  const manifest = CodexDevelopmentParseWorkPackageManifestV1(text, manifestPath);
  if (manifest.ciRevision !== CI_VERIFICATION_CONTRACT_REVISION) {
    throw new Error('Work Package manifest does not target the current CI verification revision.');
  }
  return {
    manifestPath,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(source)
  };
}

function afterRetention(date: Date): string {
  return new Date(
    date.getTime() + CodexDevelopmentVerificationArtifactRetentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

export async function CodexDevelopmentCiVerificationMain(
  options: CodexDevelopmentCiVerificationMainOptions = {}
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const gitRevision = options.gitRevision ?? defaultGitRevision;
  const trackedTreeIsClean = options.trackedTreeIsClean ?? defaultTrackedTreeIsClean;
  const changedFileResolver = options.changedFiles ?? defaultChangedFiles;
  const runGate = options.runGate ?? defaultRunGate;
  const writeEvidence = options.writeEvidence ?? CodexDevelopmentWriteVerificationEvidenceAtomic;
  const evidencePath = path.resolve(env.SEC_CI_VERIFICATION_EVIDENCE_PATH ?? VERIFICATION_EVIDENCE_PATH);
  let started = new Date();
  let startedAt = started.toISOString();
  let headSha: string | null = null;
  let treeSha: string | null = null;
  const prBaseRef = env.SEC_CHANGED_BASE ?? 'HEAD^1';
  const affectedBaseRef = env.SEC_AFFECTED_TESTS_BASE ?? 'HEAD^1';
  let prBaseSha: string | null = null;
  let affectedBaseSha: string | null = null;
  let directParentSha: string | null = null;
  let cleanBefore: boolean | null = null;
  let cleanAfter: boolean | null = null;
  let profile: CodexDevelopmentVerificationPlanProfileV1 = 'quick';
  let files: string[] | null = null;
  let selectionResolved = false;
  let steps: CiVerificationGateStep[] = [];
  let gates: CodexDevelopmentVerificationGateEvidenceV2[] = [];
  let failure: CodexDevelopmentVerificationEvidenceV2['failure'] = null;
  let exitCode = 0;
  let stage = 'argv';
  let binding = { manifestPath: null, manifestDigest: null } as {
    manifestPath: string | null;
    manifestDigest: string | null;
  };
  let initializationFailure: string | null = null;

  try {
    CodexDevelopmentPrepareVerificationEvidenceTarget(evidencePath);
  } catch (error) {
    initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
  }
  if (initializationFailure === null) {
    try {
      started = now();
      startedAt = started.toISOString();
      headSha = gitRevision('HEAD');
      treeSha = gitRevision('HEAD^{tree}');
      prBaseSha = gitRevision(prBaseRef);
      affectedBaseSha = gitRevision(affectedBaseRef);
      directParentSha = gitRevision('HEAD^1');
      cleanBefore = trackedTreeIsClean();
    } catch (error) {
      initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
    }
  }

  try {
    if (initializationFailure) throw new Error(`CI verification initialization failed: ${initializationFailure}`);
    const parsed = parseProfile(argv);
    profile = parsed.profile;
    stage = 'preflight';
    if (!headSha || !treeSha || !prBaseSha || !affectedBaseSha || !directParentSha) {
      throw new Error('CI verification cannot resolve exact head/tree/two bases.');
    }
    assertCiExpectedHead(headSha, parsed.expectedHead ?? env.SEC_EXPECTED_HEAD_SHA);
    if (!cleanBefore) throw new Error('CI verification requires a clean complete worktree before execution.');
    binding = manifestBinding(env);
    if (binding.manifestPath !== null && (prBaseSha !== affectedBaseSha || directParentSha !== prBaseSha)) {
      throw new Error('CI verification v5 requires affected base = HEAD^1 = current PR base.');
    }
    const plan = CodexDevelopmentBuildVerificationPlanV1(profile, changedFileResolver(prBaseRef));
    files = plan.changedFiles;
    selectionResolved = plan.selectionResolved;
    steps = plan.gates;
    gates = steps.map(notRunGate);
    if (steps.some((step) => step.id === 'impact-risk')) {
      console.log(`CI verification: risk gate required; reasons=[${plan.selectionReasons.join(', ')}]; owners=[${plan.affectedOwners.join(', ')}]`);
    } else {
      console.log('CI verification: no slow/workspace risk impact detected; risk gate skipped.');
    }
    if (!plan.selectionResolved) throw new Error('CI verification changed-file selection is unresolved.');

    console.log(`SEC verification contract revision: ${CI_VERIFICATION_CONTRACT_REVISION}`);
    console.log(`SEC verification profile: ${profile}`);
    console.log(`SEC verification exact head: ${headSha}`);
    console.log(`SEC verification tree: ${treeSha}`);
    console.log(`SEC verification PR base: ${prBaseSha}`);
    console.log(`SEC verification affected base: ${affectedBaseSha}`);

    stage = 'gates';
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index]!;
      const gateStarted = now();
      console.log(`::group::SEC verification: ${step.id}`);
      let result: GateProcessResult;
      try {
        result = await runGate({
          id: step.id,
          argv: ['bun', ...step.args],
          env: {
            ...env,
            SEC_TEST_WORKSPACE_NAMESPACE: `verification-${step.id.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`
          }
        });
      } finally {
        console.log('::endgroup::');
      }
      const gateFinished = now();
      const gateEvidence: CodexDevelopmentVerificationGateEvidenceV2 = {
        id: step.id,
        argv: ['bun', ...step.args],
        status: result.code === 0 ? 'passed' : 'failed',
        exitCode: result.code,
        startedAt: gateStarted.toISOString(),
        finishedAt: gateFinished.toISOString(),
        durationMs: Math.max(0, gateFinished.getTime() - gateStarted.getTime()),
        failureTail: result.code === 0 ? null : tail(result.failureTail, `${step.id} exited ${result.code}`),
        rawOutputDigest: result.rawOutputDigest,
        notRunReason: null
      };
      gates[index] = gateEvidence;
      if (result.code !== 0) {
        exitCode = result.code;
        failure = { stage: `gate:${step.id}`, tail: gateEvidence.failureTail ?? `${step.id} failed.` };
        break;
      }
    }
  } catch (error) {
    exitCode = exitCode || 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    failure ??= { stage, tail: tail(message, 'CI verification failed.') };
    console.error(message);
  } finally {
    try {
      cleanAfter = trackedTreeIsClean();
    } catch (error) {
      cleanAfter = null;
      exitCode = 1;
      failure = {
        stage: 'clean-state',
        tail: tail(error instanceof Error ? error.stack ?? error.message : String(error), 'Clean-state probe failed.')
      };
    }
    if (cleanAfter !== true && exitCode === 0) {
      exitCode = 1;
      failure = { stage: 'clean-state', tail: 'CI verification left the complete worktree dirty or unresolved.' };
    }
    let finished = new Date(Math.max(Date.now(), started.getTime()));
    try {
      finished = now();
    } catch (error) {
      exitCode = 1;
      failure = {
        stage: 'clock',
        tail: tail(error instanceof Error ? error.stack ?? error.message : String(error), 'Clock probe failed.')
      };
    }
    const inputDigest = CodexDevelopmentVerificationDigest(CodexDevelopmentBuildVerificationInputV2({
      profile,
      headSha,
      treeSha,
      prBaseSha,
      affectedBaseSha,
      manifestPath: binding.manifestPath,
      manifestDigest: binding.manifestDigest,
      changedFiles: files,
      selectionResolved,
      gates: steps
    }));
    const evidence = CodexDevelopmentFinalizeVerificationEvidenceV2({
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      kind: 'verification',
      profile,
      headSha,
      treeSha,
      prBaseSha,
      affectedBaseSha,
      ...binding,
      inputDigest,
      argv: ['bun', 'scripts/ci-verification.ts', ...argv],
      status: exitCode === 0 ? 'passed' : 'failed',
      startedAt,
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      changedFiles: files,
      selectionResolved,
      cleanState: { before: cleanBefore, after: cleanAfter },
      failure,
      gates,
      invalidation: {
        expiresAt: afterRetention(finished),
        rules: INVALIDATION_RULES
      }
    });
    try {
      writeEvidence(evidencePath, evidence);
      console.log(`SEC verification evidence: ${evidencePath}`);
      console.log(`SEC_VERIFICATION_SUMMARY ${JSON.stringify(evidence)}`);
    } catch (error) {
      exitCode = 1;
      console.error(`SEC verification evidence write failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
  return exitCode;
}

async function main(): Promise<number> {
  return CodexDevelopmentCiVerificationMain();
}

if (import.meta.main) {
  process.exitCode = await main();
}
