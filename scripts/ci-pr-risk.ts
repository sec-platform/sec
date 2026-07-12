import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CI_VERIFICATION_CONTRACT_REVISION } from '../platform/shared/ci-contract.ts';
import { gitChangedFileDiffArgs, parseGitChangedFileOutput } from '../platform/shared/ci-git-changed-files.ts';
import { selectCiPrRiskSlowSuites } from '../platform/shared/ci-pr-risk-selection.ts';
import { getSlowTestSuitesSync, slowTestSuiteIds } from '../platform/shared/test-budget-contract.ts';

type GateStep = {
  id: string;
  args: string[];
};

type GateStepResult = GateStep & {
  code: number;
  durationMs: number;
  stdout: string;
  stderr: string;
};

const slowSuites = slowTestSuiteIds();
const slowSuiteContracts = getSlowTestSuitesSync();
const runAllSlow = process.argv.includes('--all-slow');
const continueOnFailure = process.argv.includes('--continue-on-failure');

function argumentValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index]!;
    const inlinePrefix = `${name}=`;
    if (argument.startsWith(inlinePrefix)) {
      const value = argument.slice(inlinePrefix.length);
      if (!value) throw new Error(`CI risk ${name} requires a value.`);
      values.push(value);
      continue;
    }
    if (argument !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`CI risk ${name} requires a value.`);
    }
    values.push(value);
    index += 1;
  }
  return [...new Set(values)];
}

const requestedSlowSuites = argumentValues('--suite');
const unknownRequestedSlowSuites = requestedSlowSuites.filter((suite) => !slowSuites.includes(suite));
if (unknownRequestedSlowSuites.length > 0) {
  throw new Error(`Unknown slow suite(s): ${unknownRequestedSlowSuites.join(', ')}`);
}
const runRequestedSlow = requestedSlowSuites.length > 0;
if (runAllSlow && runRequestedSlow) {
  throw new Error('CI risk cannot combine --all-slow with explicit --suite values.');
}
if (continueOnFailure && !runRequestedSlow) {
  throw new Error('CI risk --continue-on-failure requires at least one explicit --suite value.');
}
if (runRequestedSlow && !trackedTreeIsClean()) {
  throw new Error('CI risk requested batch requires a clean tracked HEAD. Commit or discard tracked changes first.');
}
const evidenceHeadSha = gitRevision('HEAD');
const evidenceBaseRef = process.env.SEC_CHANGED_BASE ?? process.env.SEC_AFFECTED_TESTS_BASE ?? 'HEAD^1';
const evidenceBaseSha = gitRevision(evidenceBaseRef);
if (runRequestedSlow && (!evidenceHeadSha || !evidenceBaseSha)) {
  throw new Error(`CI risk requested batch cannot resolve exact head/base (${evidenceBaseRef}).`);
}
const parallelSafeSlowSuites = new Set(
  slowSuiteContracts
    .filter((suite) => suite.parallelSafe && suite.resourceClass === 'standard')
    .map((suite) => suite.id)
);
const runtimeHeavySlowSuites = new Set(
  slowSuiteContracts
    .filter((suite) => suite.resourceClass === 'runtime-heavy')
    .map((suite) => suite.id)
);

function changedFiles(): string[] | null {
  const baseRef = process.env.SEC_CHANGED_BASE ?? process.env.SEC_AFFECTED_TESTS_BASE ?? 'HEAD^1';
  const result = spawnSync('git', gitChangedFileDiffArgs(baseRef), {
    encoding: 'utf8'
  });
  return result.status === 0 ? parseGitChangedFileOutput(result.stdout) : null;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function groupStart(label: string): void {
  console.log(`::group::${label}`);
}

function groupEnd(): void {
  console.log('::endgroup::');
}

function slowTestStepId(file: string): string {
  return file.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/g, '').toLowerCase();
}

function gateStepEnvironment(step: GateStep): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SEC_TEST_WORKSPACE_NAMESPACE: `ci-risk-${slowTestStepId(step.id)}`
  };
}

function slowSuiteIdForStep(step: GateStep): string | undefined {
  return step.id.startsWith('slow-suite-') ? step.id.slice('slow-suite-'.length) : undefined;
}

function runBunStep(step: GateStep): number {
  const startedAt = Date.now();
  groupStart(`CI risk: ${step.id}`);
  console.log(`CI risk: ${step.id} started`);
  try {
    const result = spawnSync('bun', step.args, {
      env: gateStepEnvironment(step),
      stdio: 'inherit'
    });
    const code = result.status ?? 1;
    console.log(`CI risk: ${step.id} finished with exit code ${code} in ${formatDuration(Date.now() - startedAt)}`);
    return code;
  } finally {
    groupEnd();
  }
}

function slowSuiteConcurrency(): number {
  const parsed = Number.parseInt(process.env.SEC_CI_PR_RISK_SLOW_CONCURRENCY ?? '4', 10);
  if (!Number.isFinite(parsed)) return 4;
  return Math.min(8, Math.max(1, parsed));
}

function runBunStepBuffered(step: GateStep): Promise<GateStepResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn('bun', step.args, {
      env: gateStepEnvironment(step),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve({
        ...step,
        code,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      });
    };

    child.on('error', (error) => {
      stderrChunks.push(Buffer.from(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`));
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

function printBufferedResult(result: GateStepResult): void {
  groupStart(`CI risk: ${result.id}`);
  console.log(`CI risk: ${result.id} finished with exit code ${result.code} in ${formatDuration(result.durationMs)}`);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  groupEnd();
}

async function runBunStepsInParallel(
  steps: GateStep[],
  concurrency: number,
  continueAfterFailure = false
): Promise<GateStepResult[]> {
  const results = new Array<GateStepResult | undefined>(steps.length);
  let nextIndex = 0;
  let stopScheduling = false;

  async function worker(): Promise<void> {
    while ((continueAfterFailure || !stopScheduling) && nextIndex < steps.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const step = steps[currentIndex];
      console.log(`CI risk: ${step.id} queued in parallel slow gate`);
      const result = await runBunStepBuffered(step);
      results[currentIndex] = result;
      if (result.code !== 0 && !continueAfterFailure) {
        stopScheduling = true;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, steps.length) }, () => worker()));
  const completedResults = results.filter((result): result is GateStepResult => result !== undefined);
  const unscheduledCount = steps.length - completedResults.length;
  if (unscheduledCount > 0) {
    console.log(`CI risk: stopped scheduling after failure; ${unscheduledCount} parallel slow step(s) were not started.`);
  }
  return completedResults;
}

const files = changedFiles();
if (files) {
  console.log(`CI risk: latest-commit changed file count ${files.length}`);
} else {
  console.log('CI risk: changed file detection failed.');
}

console.log('CI risk: typecheck is owned by the verification coordinator.');
const slowSuiteSelection = selectCiPrRiskSlowSuites(files);
const selectedSlowSuites = runRequestedSlow
  ? requestedSlowSuites
  : runAllSlow ? slowSuites : slowSuiteSelection.suites;
const selectedSlowTests = runAllSlow || runRequestedSlow ? [] : slowSuiteSelection.slowTests;
const executionMode = runRequestedSlow ? 'requested-batch' : runAllSlow ? 'all-slow' : 'impact-selected';
console.log(`CI risk: execution mode ${executionMode}`);
console.log(`CI risk: continue on failure ${continueOnFailure}`);
console.log(`CI risk: slow suite selection reason ${slowSuiteSelection.reason}`);
console.log(`CI risk: affected owners [${slowSuiteSelection.owners.join(', ')}]`);
console.log(`CI risk: affected slow tests [${slowSuiteSelection.affectedSlowTests.join(', ')}]`);
console.log(`CI risk: slow suites run [${selectedSlowSuites.join(', ')}]`);
console.log(`CI risk: slow test files run [${selectedSlowTests.join(', ')}]`);
console.log(`CI risk: slow suites skipped [${slowSuites.filter((suite) => !selectedSlowSuites.includes(suite)).join(', ')}]`);

const preSlowSteps: GateStep[] = runAllSlow || runRequestedSlow ? [] : [
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
const parallelSafeSlowSteps = slowSteps.filter((step) => {
  const suiteId = slowSuiteIdForStep(step);
  return suiteId !== undefined && parallelSafeSlowSuites.has(suiteId);
});
const runtimeHeavySlowSteps = slowSteps.filter((step) => {
  const suiteId = slowSuiteIdForStep(step);
  return suiteId !== undefined && runtimeHeavySlowSuites.has(suiteId);
});
const serialSlowSteps = slowSteps.filter((step) => (
  !parallelSafeSlowSteps.includes(step) && !runtimeHeavySlowSteps.includes(step)
));
const postSlowSteps: GateStep[] = runAllSlow || runRequestedSlow ? [] : [
  { id: 'workspace-fast', args: ['scripts/ci-workspace-fast.ts'] }
];

const startedAt = Date.now();
const completedSlowSteps: Array<{ id: string; code: number; durationMs: number }> = [];
const failedSlowSteps: Array<{ id: string; code: number }> = [];
for (const step of preSlowSteps) {
  const code = runBunStep(step);
  if (code !== 0) {
    console.error(`CI risk failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

if (parallelSafeSlowSteps.length > 0) {
  const concurrency = slowSuiteConcurrency();
  console.log(`CI risk: running ${parallelSafeSlowSteps.length} parallel-safe standard slow steps with concurrency ${concurrency}`);
  const results = await runBunStepsInParallel(parallelSafeSlowSteps, concurrency, continueOnFailure);
  for (const result of results) {
    printBufferedResult(result);
    completedSlowSteps.push({ id: result.id, code: result.code, durationMs: result.durationMs });
    if (result.code !== 0) failedSlowSteps.push({ id: result.id, code: result.code });
  }
  const failed = results.find((result) => result.code !== 0);
  if (failed && !continueOnFailure) {
    console.error(`CI risk failed at ${failed.id} with exit code ${failed.code}`);
    process.exit(failed.code);
  }
}

for (const step of serialSlowSteps) {
  const stepStartedAt = Date.now();
  const code = runBunStep(step);
  completedSlowSteps.push({ id: step.id, code, durationMs: Date.now() - stepStartedAt });
  if (code !== 0) failedSlowSteps.push({ id: step.id, code });
  if (code !== 0) {
    if (continueOnFailure) continue;
    console.error(`CI risk failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

if (runtimeHeavySlowSteps.length > 0) {
  console.log(`CI risk: running runtime-heavy slow steps serially [${runtimeHeavySlowSteps.map((step) => step.id).join(', ')}]`);
  for (const step of runtimeHeavySlowSteps) {
    const stepStartedAt = Date.now();
    const code = runBunStep(step);
    completedSlowSteps.push({ id: step.id, code, durationMs: Date.now() - stepStartedAt });
    if (code !== 0) failedSlowSteps.push({ id: step.id, code });
    if (code !== 0) {
      if (continueOnFailure) continue;
      console.error(`CI risk failed at ${step.id} with exit code ${code}`);
      process.exit(code);
    }
  }
}

for (const step of postSlowSteps) {
  const code = runBunStep(step);
  if (code !== 0) {
    console.error(`CI risk failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

function gitRevision(ref: string): string | null {
  const result = spawnSync('git', ['rev-parse', ref], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function trackedTreeIsClean(): boolean {
  const worktree = spawnSync('git', ['diff', '--quiet']);
  const index = spawnSync('git', ['diff', '--cached', '--quiet']);
  return worktree.status === 0 && index.status === 0;
}

const durationMs = Date.now() - startedAt;
const trackedTreeCleanAfter = trackedTreeIsClean();
if (!trackedTreeCleanAfter) {
  failedSlowSteps.push({ id: 'tracked-worktree-clean', code: 1 });
}
const evidence = {
  contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
  headSha: evidenceHeadSha,
  baseRef: evidenceBaseRef,
  baseSha: evidenceBaseSha,
  mode: executionMode,
  continueOnFailure,
  selectedSlowSuites,
  completedSlowSteps,
  failedSlowSteps,
  trackedTreeCleanAfter,
  status: failedSlowSteps.length === 0 ? 'passed' : 'failed',
  durationMs
};
const evidencePath = path.resolve(process.env.SEC_CI_RISK_EVIDENCE_PATH ?? '.tmp/ci-risk-batch-evidence.json');
mkdirSync(path.dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`CI risk: total time ${formatDuration(durationMs)}`);
console.log(`CI risk evidence: ${evidencePath}`);
console.log(`SEC_CI_RISK_SUMMARY ${JSON.stringify(evidence)}`);
if (failedSlowSteps.length > 0) {
  process.exit(failedSlowSteps[0]!.code);
}
