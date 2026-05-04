import { spawnSync } from 'node:child_process';

import { runContractFreeze, runSlowTests } from '../platform/dev-runner/test-runner.ts';
import { runTypecheck } from '../platform/dev-runner/typecheck-runner.ts';
import {
  getSlowTestSuitesSync
} from '../platform/shared/test-budget-contract.ts';
import { selectTestsForSources } from '../platform/shared/test-impact-contract.ts';
import { runCiFastGate } from './ci-fast-gate.ts';

type FullGateStep = {
  id: string;
  run: () => Promise<number>;
};

type FullGateResult = {
  id: string;
  code: number;
  durationMs: number;
};

type SlowSuiteSelection = {
  suiteIds: string[];
  impactOwners: string[];
  skippedSuiteIds: string[];
};

const broadImpactPatterns = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^platform\/orchestrator\.ts$/,
  /^platform\/compiler\/(parse|resolve|compose|adapt)\//
];

function changedFiles(): string[] | null {
  const baseRef = process.env.PJC_CHANGED_TESTS_BASE ?? process.env.PJC_CHANGED_BASE ?? 'HEAD^1';
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

function selectSlowSuites(files: string[]): SlowSuiteSelection {
  const impact = selectTestsForSources(files);
  const impactedSlowFiles = new Set(impact.slow);

  if (broadImpactPatterns.some((pattern) => files.some((file) => pattern.test(file)))) {
    const allSuiteIds = getSlowTestSuitesSync().map((suite) => suite.id);
    console.log(`CI full gate: broad impact detected; running all ${allSuiteIds.length} slow suites`);
    return { suiteIds: allSuiteIds, impactOwners: ['broad-impact'], skippedSuiteIds: [] };
  }

  const suites = getSlowTestSuitesSync();
  const selectedSuiteIds: string[] = [];
  const skippedSuiteIds: string[] = [];

  for (const suite of suites) {
    const suiteHasImpact = suite.files.some((file) => impactedSlowFiles.has(file));
    if (suiteHasImpact) {
      selectedSuiteIds.push(suite.id);
    } else {
      skippedSuiteIds.push(suite.id);
    }
  }

  return {
    suiteIds: selectedSuiteIds,
    impactOwners: impact.owners,
    skippedSuiteIds
  };
}

async function runGateStep(step: FullGateStep): Promise<FullGateResult> {
  const startedAt = Date.now();
  groupStart(`CI full gate: ${step.id}`);
  console.log(`CI full gate: ${step.id} started`);
  try {
    const code = await step.run();
    const durationMs = Date.now() - startedAt;
    console.log(`CI full gate: ${step.id} finished with exit code ${code} in ${formatDuration(durationMs)}`);
    return { id: step.id, code, durationMs };
  } finally {
    groupEnd();
  }
}

const files = changedFiles();
if (files) {
  console.log(`CI full gate: latest-commit changed file count ${files.length}`);
} else {
  console.log('CI full gate: changed file detection failed; running all slow suites.');
}

const slowSelection = files
  ? selectSlowSuites(files)
  : { suiteIds: getSlowTestSuitesSync().map((s) => s.id), impactOwners: ['unknown'], skippedSuiteIds: [] };

console.log(`CI full gate: selected slow suites [${slowSelection.suiteIds.join(', ')}]`);
if (slowSelection.skippedSuiteIds.length > 0) {
  console.log(`CI full gate: skipped slow suites [${slowSelection.skippedSuiteIds.join(', ')}] (no impact from changes)`);
}
console.log(`CI full gate: impact owners [${slowSelection.impactOwners.join(', ')}]`);

const steps: FullGateStep[] = [
  {
    id: 'typecheck',
    run: () => runTypecheck()
  },
  {
    id: 'contract-freeze',
    run: () => runContractFreeze()
  }
];

for (const suiteId of slowSelection.suiteIds) {
  steps.push({
    id: `slow-suite-${suiteId}`,
    run: () => runSlowTests(['--suite', suiteId])
  });
}

steps.push({
  id: 'fast-workspace-gate',
  run: () => runCiFastGate()
});

const results: FullGateResult[] = [];
let failed = false;

for (const step of steps) {
  const result = await runGateStep(step);
  results.push(result);
  if (result.code !== 0) {
    failed = true;
    break;
  }
}

if (failed) {
  const failedStep = results.find((r) => r.code !== 0)!;
  console.error(
    `CI full gate failed at ${failedStep.id} with exit code ${failedStep.code} after ${formatDuration(failedStep.durationMs)}`
  );
  process.exit(failedStep.code);
}

const totalDuration = results.reduce((total, result) => total + result.durationMs, 0);
console.log(`CI full gate: total time ${formatDuration(totalDuration)}`);
console.log(`CI full gate: slow suites run [${slowSelection.suiteIds.join(', ')}]`);
console.log(`CI full gate: slow suites skipped [${slowSelection.skippedSuiteIds.join(', ')}]`);
