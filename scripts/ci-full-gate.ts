import { spawnSync } from 'node:child_process';

import { selectCiFullGateSlowSuites } from '../platform/shared/ci-full-gate-selection.ts';
import { slowTestSuiteIds } from '../platform/shared/test-budget-contract.ts';

type GateStep = {
  id: string;
  args: string[];
};

const slowSuites = slowTestSuiteIds();

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

function runBunStep(step: GateStep): number {
  const startedAt = Date.now();
  groupStart(`CI full gate: ${step.id}`);
  console.log(`CI full gate: ${step.id} started`);
  try {
    const result = spawnSync('bun', step.args, {
      env: process.env,
      stdio: 'inherit'
    });
    const code = result.status ?? 1;
    console.log(`CI full gate: ${step.id} finished with exit code ${code} in ${formatDuration(Date.now() - startedAt)}`);
    return code;
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

console.log('CI full gate: typecheck temporarily skipped pending full diagnostic log access.');
const slowSuiteSelection = selectCiFullGateSlowSuites(files);
const selectedSlowSuites = slowSuiteSelection.suites;
console.log(`CI full gate: slow suite selection reason ${slowSuiteSelection.reason}`);
console.log(`CI full gate: affected owners [${slowSuiteSelection.owners.join(', ')}]`);
console.log(`CI full gate: affected slow tests [${slowSuiteSelection.affectedSlowTests.join(', ')}]`);
console.log(`CI full gate: slow suites run [${selectedSlowSuites.join(', ')}]`);
console.log(`CI full gate: slow suites skipped [${slowSuites.filter((suite) => !selectedSlowSuites.includes(suite)).join(', ')}]`);

const steps: GateStep[] = [
  { id: 'contract-freeze', args: ['run', 'test:contract-freeze'] },
  ...selectedSlowSuites.map((suite) => ({
    id: `slow-suite-${suite}`,
    args: ['run', 'test:slow', '--', '--suite', suite]
  })),
  { id: 'fast-workspace-gate', args: ['scripts/ci-fast-gate.ts'] }
];

const startedAt = Date.now();
for (const step of steps) {
  const code = runBunStep(step);
  if (code !== 0) {
    console.error(`CI full gate failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

console.log(`CI full gate: total time ${formatDuration(Date.now() - startedAt)}`);
