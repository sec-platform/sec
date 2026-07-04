import { spawn, spawnSync } from 'node:child_process';

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
const parallelSafeSlowSuites = new Set(getSlowTestSuitesSync().filter((suite) => suite.parallelSafe).map((suite) => suite.id));

function changedFiles(): string[] | null {
  const baseRef = process.env.SEC_AFFECTED_TESTS_BASE ?? process.env.SEC_CHANGED_BASE ?? 'HEAD^1';
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', baseRef, 'HEAD'], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
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

function runBunStep(step: GateStep): number {
  const startedAt = Date.now();
  groupStart(`CI PR risk: ${step.id}`);
  console.log(`CI PR risk: ${step.id} started`);
  try {
    const result = spawnSync('bun', step.args, {
      env: process.env,
      stdio: 'inherit'
    });
    const code = result.status ?? 1;
    console.log(`CI PR risk: ${step.id} finished with exit code ${code} in ${formatDuration(Date.now() - startedAt)}`);
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
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on('error', (error) => {
      stderrChunks.push(Buffer.from(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`));
      resolve({
        ...step,
        code: 1,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      });
    });
    child.on('close', (code) => {
      resolve({
        ...step,
        code: code ?? 1,
        durationMs: Date.now() - startedAt,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      });
    });
  });
}

function printBufferedResult(result: GateStepResult): void {
  groupStart(`CI PR risk: ${result.id}`);
  console.log(`CI PR risk: ${result.id} finished with exit code ${result.code} in ${formatDuration(result.durationMs)}`);
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  groupEnd();
}

async function runBunStepsInParallel(steps: GateStep[], concurrency: number): Promise<GateStepResult[]> {
  const results = new Array<GateStepResult>(steps.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < steps.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const step = steps[currentIndex];
      console.log(`CI PR risk: ${step.id} queued in parallel slow gate`);
      results[currentIndex] = await runBunStepBuffered(step);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, steps.length) }, () => worker()));
  return results;
}

const files = changedFiles();
if (files) {
  console.log(`CI PR risk: latest-commit changed file count ${files.length}`);
} else {
  console.log('CI PR risk: changed file detection failed; running all slow suites.');
}

console.log('CI PR risk: typecheck is owned by CI PR quick.');
const slowSuiteSelection = selectCiPrRiskSlowSuites(files);
const selectedSlowSuites = slowSuiteSelection.suites;
const selectedSlowTests = slowSuiteSelection.slowTests;
console.log(`CI PR risk: slow suite selection reason ${slowSuiteSelection.reason}`);
console.log(`CI PR risk: affected owners [${slowSuiteSelection.owners.join(', ')}]`);
console.log(`CI PR risk: affected slow tests [${slowSuiteSelection.affectedSlowTests.join(', ')}]`);
console.log(`CI PR risk: slow suites run [${selectedSlowSuites.join(', ')}]`);
console.log(`CI PR risk: slow test files run [${selectedSlowTests.join(', ')}]`);
console.log(`CI PR risk: slow suites skipped [${slowSuites.filter((suite) => !selectedSlowSuites.includes(suite)).join(', ')}]`);

const preSlowSteps: GateStep[] = [
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
const parallelSafeSlowSteps = slowSteps.filter((step) => (
  step.id.startsWith('slow-suite-') && parallelSafeSlowSuites.has(step.id.slice('slow-suite-'.length))
));
const serialSlowSteps = slowSteps.filter((step) => !parallelSafeSlowSteps.includes(step));
const postSlowSteps: GateStep[] = [
  { id: 'workspace-fast', args: ['scripts/ci-workspace-fast.ts'] }
];

const startedAt = Date.now();
for (const step of preSlowSteps) {
  const code = runBunStep(step);
  if (code !== 0) {
    console.error(`CI PR risk failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

if (parallelSafeSlowSteps.length > 0) {
  const concurrency = slowSuiteConcurrency();
  console.log(`CI PR risk: running ${parallelSafeSlowSteps.length} parallel-safe slow steps with concurrency ${concurrency}`);
  const results = await runBunStepsInParallel(parallelSafeSlowSteps, concurrency);
  for (const result of results) {
    printBufferedResult(result);
  }
  const failed = results.find((result) => result.code !== 0);
  if (failed) {
    console.error(`CI PR risk failed at ${failed.id} with exit code ${failed.code}`);
    process.exit(failed.code);
  }
}

for (const step of serialSlowSteps) {
  const code = runBunStep(step);
  if (code !== 0) {
    console.error(`CI PR risk failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

for (const step of postSlowSteps) {
  const code = runBunStep(step);
  if (code !== 0) {
    console.error(`CI PR risk failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

console.log(`CI PR risk: total time ${formatDuration(Date.now() - startedAt)}`);
