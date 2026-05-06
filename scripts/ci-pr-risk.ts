import { spawnSync } from 'node:child_process';

import { selectCiPrRiskSlowSuites } from '../platform/shared/ci-pr-risk-selection.ts';
import { slowTestSuiteIds } from '../platform/shared/test-budget-contract.ts';

type GateStep = {
  id: string;
  args: string[];
};

const slowSuites = slowTestSuiteIds();

function changedFiles(): string[] | null {
  const baseRef = process.env.PJC_AFFECTED_TESTS_BASE ?? process.env.PJC_CHANGED_BASE ?? 'HEAD^1';
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

const steps: GateStep[] = [
  { id: 'contract-freeze', args: ['run', 'test:contract-freeze'] },
  ...selectedSlowSuites.map((suite) => ({
    id: `slow-suite-${suite}`,
    args: ['run', 'test:slow', '--', '--suite', suite]
  })),
  ...selectedSlowTests.map((file) => ({
    id: `slow-test-${slowTestStepId(file)}`,
    args: ['run', 'test:slow', '--', file]
  })),
  { id: 'workspace-fast', args: ['scripts/ci-workspace-fast.ts'] }
];

const startedAt = Date.now();
for (const step of steps) {
  const code = runBunStep(step);
  if (code !== 0) {
    console.error(`CI PR risk failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

console.log(`CI PR risk: total time ${formatDuration(Date.now() - startedAt)}`);
