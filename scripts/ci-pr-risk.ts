import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
import { selectCiPrRiskSlowSuites } from '../platform/shared/ci-pr-risk-selection.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../platform/shared/ci-verification-plan.ts';
import { getSlowTestSuitesSync, slowTestSuiteIds } from '../platform/shared/test-budget-contract.ts';
import {
  CodexDevelopmentParseWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest
} from './codex/work-package-contract.ts';

type GateStep = {
  id: string;
  args: string[];
};

type GateProcessResult = {
  code: number;
  rawOutputDigest: string;
  failureTail: string;
};

type ParsedArguments = {
  runAllSlow: boolean;
  continueOnFailure: boolean;
  requestedSlowSuites: string[];
};

export type CodexDevelopmentCiPrRiskMainOptions = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  gitRevision?: (ref: string) => string | null;
  trackedTreeIsClean?: () => boolean;
  changedFiles?: (baseRef: string) => string[] | null;
  runGate?: (step: { id: string; argv: string[]; env: NodeJS.ProcessEnv }) => Promise<GateProcessResult>;
  writeEvidence?: (filePath: string, evidence: CodexDevelopmentVerificationEvidenceV2) => void;
};

const FAILURE_TAIL_CHARACTER_LIMIT = 24_000;
const INVALIDATION_RULES = [
  'head SHA or tree SHA changes',
  'PR base SHA or affected base SHA changes',
  'CI contract revision or selected input digest changes',
  'Work Package manifest path or digest changes',
  'tracked worktree is not clean before and after execution',
  'hosted artifact is missing, expired, or has a mismatched digest'
];

function parseArguments(argv: string[], slowSuites: string[]): ParsedArguments {
  let runAllSlow = false;
  let continueOnFailure = false;
  const requestedSlowSuites: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--all-slow') {
      if (runAllSlow) throw new Error('CI risk --all-slow may only be specified once.');
      runAllSlow = true;
      continue;
    }
    if (argument === '--continue-on-failure') {
      if (continueOnFailure) throw new Error('CI risk --continue-on-failure may only be specified once.');
      continueOnFailure = true;
      continue;
    }
    if (argument === '--suite') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('CI risk --suite requires a value.');
      requestedSlowSuites.push(value);
      index += 1;
      continue;
    }
    if (argument.startsWith('--suite=')) {
      const value = argument.slice('--suite='.length);
      if (!value) throw new Error('CI risk --suite requires a value.');
      requestedSlowSuites.push(value);
      continue;
    }
    throw new Error(`Unknown CI risk argument: ${argument}.`);
  }

  const requested = [...new Set(requestedSlowSuites)];
  const unknown = requested.filter((suite) => !slowSuites.includes(suite));
  if (unknown.length > 0) throw new Error(`Unknown slow suite(s): ${unknown.join(', ')}`);
  if (runAllSlow && requested.length > 0) throw new Error('CI risk cannot combine --all-slow with explicit --suite values.');
  if (continueOnFailure && requested.length === 0) {
    throw new Error('CI risk --continue-on-failure requires at least one explicit --suite value.');
  }
  return { runAllSlow, continueOnFailure, requestedSlowSuites: requested };
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
  const result = spawnSync('git', gitChangedFileDiffArgs(baseRef), { encoding: 'buffer' });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  try {
    return parseGitChangedFileOutput(result.stdout);
  } catch {
    return null;
  }
}

function slowTestStepId(file: string): string {
  return file.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/g, '').toLowerCase();
}

function gateEnvironment(env: NodeJS.ProcessEnv, step: GateStep): NodeJS.ProcessEnv {
  return {
    ...env,
    SEC_TEST_WORKSPACE_NAMESPACE: `ci-risk-${slowTestStepId(step.id)}`
  };
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

function failureTail(output: string, fallback: string): string {
  const combined = output.trim() || fallback;
  return combined.length > FAILURE_TAIL_CHARACTER_LIMIT
    ? combined.slice(-FAILURE_TAIL_CHARACTER_LIMIT)
    : combined;
}

function notRunGate(step: GateStep): CodexDevelopmentVerificationGateEvidenceV2 {
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

function slowSuiteConcurrency(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(env.SEC_CI_PR_RISK_SLOW_CONCURRENCY ?? '4', 10);
  if (!Number.isFinite(parsed)) return 4;
  return Math.min(8, Math.max(1, parsed));
}

function isoAfterDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
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

export async function CodexDevelopmentCiPrRiskMain(
  options: CodexDevelopmentCiPrRiskMainOptions = {}
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const gitRevision = options.gitRevision ?? defaultGitRevision;
  const trackedTreeIsClean = options.trackedTreeIsClean ?? defaultTrackedTreeIsClean;
  const changedFileResolver = options.changedFiles ?? defaultChangedFiles;
  const runGate = options.runGate ?? defaultRunGate;
  const writeEvidence = options.writeEvidence ?? CodexDevelopmentWriteVerificationEvidenceAtomic;
  const evidencePath = path.resolve(env.SEC_CI_RISK_EVIDENCE_PATH ?? '.tmp/ci-risk-batch-evidence.json');
  let slowSuites: string[] = [];
  let slowSuiteContracts: ReturnType<typeof getSlowTestSuitesSync> = [];
  let started = new Date();
  let startedAt = started.toISOString();
  const prBaseRef = env.SEC_CHANGED_BASE ?? 'HEAD^1';
  const affectedBaseRef = env.SEC_AFFECTED_TESTS_BASE ?? 'HEAD^1';
  let headSha: string | null = null;
  let treeSha: string | null = null;
  let prBaseSha: string | null = null;
  let affectedBaseSha: string | null = null;
  let cleanBefore: boolean | null = null;
  let cleanAfter: boolean | null = null;
  let files: string[] | null = null;
  let selectionResolved = false;
  let exitCode = 0;
  let failure: CodexDevelopmentVerificationEvidenceV2['failure'] = null;
  let stage = 'argv';
  let mode = 'not-run';
  let selectedSlowSuites: string[] = [];
  let selectedSlowTests: string[] = [];
  let parsed: ParsedArguments | null = null;
  let gateEvidence: CodexDevelopmentVerificationGateEvidenceV2[] = [];
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
      slowSuites = slowTestSuiteIds();
      slowSuiteContracts = getSlowTestSuitesSync();
      headSha = gitRevision('HEAD');
      treeSha = gitRevision('HEAD^{tree}');
      prBaseSha = gitRevision(prBaseRef);
      affectedBaseSha = gitRevision(affectedBaseRef);
      cleanBefore = trackedTreeIsClean();
    } catch (error) {
      initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
    }
  }

  const updateGate = (evidence: CodexDevelopmentVerificationGateEvidenceV2): void => {
    const index = gateEvidence.findIndex((entry) => entry.id === evidence.id);
    if (index < 0) gateEvidence.push(evidence);
    else gateEvidence[index] = evidence;
  };

  const executeGate = async (step: GateStep): Promise<CodexDevelopmentVerificationGateEvidenceV2> => {
    const gateStarted = now();
    console.log(`::group::CI risk: ${step.id}`);
    console.log(`CI risk: ${step.id} started`);
    try {
      const result = await runGate({ id: step.id, argv: ['bun', ...step.args], env: gateEnvironment(env, step) });
      const gateFinished = now();
      const durationMs = Math.max(0, gateFinished.getTime() - gateStarted.getTime());
      console.log(`CI risk: ${step.id} finished with exit code ${result.code} in ${(durationMs / 1000).toFixed(2)}s`);
      return {
        id: step.id,
        argv: ['bun', ...step.args],
        status: result.code === 0 ? 'passed' : 'failed',
        exitCode: result.code,
        startedAt: gateStarted.toISOString(),
        finishedAt: gateFinished.toISOString(),
        durationMs,
        failureTail: result.code === 0 ? null : failureTail(result.failureTail, `${step.id} exited ${result.code}`),
        rawOutputDigest: result.rawOutputDigest,
        notRunReason: null
      };
    } finally {
      console.log('::endgroup::');
    }
  };

  try {
    if (initializationFailure) throw new Error(`CI risk initialization failed: ${initializationFailure}`);
    parsed = parseArguments(argv, slowSuites);
    stage = 'preflight';
    if (!headSha || !treeSha || !prBaseSha || !affectedBaseSha) {
      throw new Error(`CI risk cannot resolve exact head/tree/two bases (${prBaseRef}, ${affectedBaseRef}).`);
    }
    if (!cleanBefore) throw new Error('CI risk requires a clean complete worktree before execution.');
    files = changedFileResolver(prBaseRef);
    const selection = selectCiPrRiskSlowSuites(files);
    selectionResolved = selection.resolved;
    selectedSlowSuites = parsed.requestedSlowSuites.length > 0
      ? parsed.requestedSlowSuites
      : parsed.runAllSlow ? slowSuites : selection.suites;
    selectedSlowTests = parsed.runAllSlow || parsed.requestedSlowSuites.length > 0 ? [] : selection.slowTests;
    mode = parsed.requestedSlowSuites.length > 0
      ? 'requested-batch'
      : parsed.runAllSlow ? 'all-slow' : 'impact-selected';

    console.log(`CI risk contract revision: ${CI_VERIFICATION_CONTRACT_REVISION}`);
    console.log(`CI risk execution mode: ${mode}`);
    console.log(`CI risk selection resolved: ${selection.resolved}`);
    console.log(`CI risk selection reasons: [${selection.reasons.join(', ')}]`);
    console.log(`CI risk affected owners: [${selection.owners.join(', ')}]`);
    console.log(`CI risk affected slow tests: [${selection.affectedSlowTests.join(', ')}]`);
    console.log(`CI risk slow suites run: [${selectedSlowSuites.join(', ')}]`);

    const requestedBatch = parsed.requestedSlowSuites.length > 0;
    const preSlowSteps: GateStep[] = parsed.runAllSlow || requestedBatch ? [] : [
      { id: 'contract-freeze', args: ['run', 'test:contract-freeze'] }
    ];
    const slowSteps: GateStep[] = [
      ...selectedSlowSuites.map((suite): GateStep => ({
        id: `slow-suite-${suite}`,
        args: ['run', 'test:slow', '--', '--suite', suite]
      })),
      ...selectedSlowTests.map((file): GateStep => ({
        id: `slow-test-${slowTestStepId(file)}`,
        args: ['run', 'test:slow', '--', file]
      }))
    ];
    const parallelSafe = new Set(slowSuiteContracts
      .filter((suite) => suite.parallelSafe && suite.resourceClass === 'standard')
      .map((suite) => suite.id));
    const runtimeHeavy = new Set(slowSuiteContracts
      .filter((suite) => suite.resourceClass === 'runtime-heavy')
      .map((suite) => suite.id));
    const suiteId = (step: GateStep): string | null => step.id.startsWith('slow-suite-')
      ? step.id.slice('slow-suite-'.length)
      : null;
    const parallelSteps = slowSteps.filter((step) => {
      const id = suiteId(step);
      return id !== null && parallelSafe.has(id);
    });
    const runtimeHeavySteps = slowSteps.filter((step) => {
      const id = suiteId(step);
      return id !== null && runtimeHeavy.has(id);
    });
    const serialSteps = slowSteps.filter((step) => !parallelSteps.includes(step) && !runtimeHeavySteps.includes(step));
    const postSlowSteps: GateStep[] = parsed.runAllSlow || requestedBatch ? [] : [
      { id: 'workspace-fast', args: ['scripts/ci-workspace-fast.ts'] }
    ];
    const allSteps = [...preSlowSteps, ...parallelSteps, ...serialSteps, ...runtimeHeavySteps, ...postSlowSteps];
    gateEvidence = allSteps.map(notRunGate);

    if (!selection.resolved) throw new Error('CI risk changed-file selection is unresolved; bounded baseline selected fail-closed.');

    stage = 'gates';
    for (const step of preSlowSteps) {
      const result = await executeGate(step);
      updateGate(result);
      if (result.status === 'failed') {
        exitCode = result.exitCode ?? 1;
        throw new Error(`CI risk failed at ${step.id} with exit code ${exitCode}.`);
      }
    }

    if (parallelSteps.length > 0) {
      const concurrency = slowSuiteConcurrency(env);
      console.log(`CI risk: running ${parallelSteps.length} parallel-safe standard slow steps with concurrency ${concurrency}`);
      let nextIndex = 0;
      let stopScheduling = false;
      const workers = Array.from({ length: Math.min(concurrency, parallelSteps.length) }, async () => {
        while ((!stopScheduling || parsed!.continueOnFailure) && nextIndex < parallelSteps.length) {
          const index = nextIndex;
          nextIndex += 1;
          const result = await executeGate(parallelSteps[index]!);
          updateGate(result);
          if (result.status === 'failed' && !parsed!.continueOnFailure) stopScheduling = true;
        }
      });
      await Promise.all(workers);
      const firstFailure = gateEvidence.find((entry) => entry.status === 'failed');
      if (firstFailure && !parsed.continueOnFailure) {
        exitCode = firstFailure.exitCode ?? 1;
        throw new Error(`CI risk failed at ${firstFailure.id} with exit code ${exitCode}.`);
      }
    }

    for (const step of [...serialSteps, ...runtimeHeavySteps, ...postSlowSteps]) {
      const result = await executeGate(step);
      updateGate(result);
      if (result.status === 'failed' && !parsed.continueOnFailure) {
        exitCode = result.exitCode ?? 1;
        throw new Error(`CI risk failed at ${step.id} with exit code ${exitCode}.`);
      }
    }
    const failed = gateEvidence.find((entry) => entry.status === 'failed');
    if (failed) {
      exitCode = failed.exitCode ?? 1;
      failure = { stage: 'gates', tail: failed.failureTail ?? `${failed.id} failed.` };
    }
  } catch (error) {
    exitCode = exitCode || 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    failure ??= { stage, tail: failureTail(message, 'CI risk failed.') };
    console.error(message);
  } finally {
    try {
      cleanAfter = trackedTreeIsClean();
    } catch (error) {
      cleanAfter = null;
      exitCode = 1;
      failure = {
        stage: 'clean-state',
        tail: failureTail(error instanceof Error ? error.stack ?? error.message : String(error), 'Clean-state probe failed.')
      };
    }
    if (cleanAfter !== true && exitCode === 0) {
      exitCode = 1;
      failure = { stage: 'clean-state', tail: 'CI risk left the complete worktree dirty or unresolved.' };
    }
    let finished = new Date(Math.max(Date.now(), started.getTime()));
    try {
      finished = now();
    } catch (error) {
      exitCode = 1;
      failure = {
        stage: 'clock',
        tail: failureTail(error instanceof Error ? error.stack ?? error.message : String(error), 'Clock probe failed.')
      };
    }
    let binding: { manifestPath: string | null; manifestDigest: string | null } = {
      manifestPath: null,
      manifestDigest: null
    };
    try {
      binding = manifestBinding(env);
    } catch (error) {
      exitCode = 1;
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      failure = { stage: 'manifest', tail: failureTail(message, 'Manifest binding failed.') };
    }
    const inputDigest = CodexDevelopmentVerificationDigest({
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      argv,
      headSha,
      treeSha,
      prBaseSha,
      affectedBaseSha,
      manifestPath: binding.manifestPath,
      manifestDigest: binding.manifestDigest,
      files,
      selectionResolved,
      mode,
      selectedSlowSuites,
      selectedSlowTests
    });
    const evidence = CodexDevelopmentFinalizeVerificationEvidenceV2({
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      kind: 'risk',
      profile: 'risk',
      headSha,
      treeSha,
      prBaseSha,
      affectedBaseSha,
      ...binding,
      inputDigest,
      argv: ['bun', 'scripts/ci-pr-risk.ts', ...argv],
      status: exitCode === 0 ? 'passed' : 'failed',
      startedAt,
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      changedFiles: files,
      selectionResolved,
      cleanState: { before: cleanBefore, after: cleanAfter },
      failure,
      gates: gateEvidence,
      invalidation: {
        expiresAt: isoAfterDays(finished, CodexDevelopmentVerificationArtifactRetentionDays),
        rules: INVALIDATION_RULES
      }
    });
    try {
      writeEvidence(evidencePath, evidence);
      console.log(`CI risk evidence: ${evidencePath}`);
      console.log(`SEC_CI_RISK_SUMMARY ${JSON.stringify(evidence)}`);
    } catch (error) {
      exitCode = 1;
      console.error(`CI risk evidence write failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
  return exitCode;
}

async function main(): Promise<number> {
  return CodexDevelopmentCiPrRiskMain();
}

if (import.meta.main) {
  process.exitCode = await main();
}
