import { spawnSync } from 'node:child_process';

type QuickStep = {
  id: string;
  args: string[];
};

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function groupStart(label: string): void {
  console.log(`::group::${label}`);
}

function groupEnd(): void {
  console.log('::endgroup::');
}

function runBunStep(step: QuickStep): number {
  const startedAt = Date.now();
  groupStart(`CI PR quick: ${step.id}`);
  console.log(`CI PR quick: ${step.id} started`);
  try {
    const result = spawnSync('bun', step.args, {
      env: process.env,
      stdio: 'inherit'
    });
    const code = result.status ?? 1;
    console.log(`CI PR quick: ${step.id} finished with exit code ${code} in ${formatDuration(Date.now() - startedAt)}`);
    return code;
  } finally {
    groupEnd();
  }
}

const steps: QuickStep[] = [
  { id: 'typecheck', args: ['run', 'typecheck'] },
  { id: 'affected-tests', args: ['scripts/ci-pr-affected-probe.ts'] }
];

const startedAt = Date.now();
for (const step of steps) {
  const code = runBunStep(step);
  if (code !== 0) {
    console.error(`CI PR quick failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

console.log(`CI PR quick: total time ${formatDuration(Date.now() - startedAt)}`);
