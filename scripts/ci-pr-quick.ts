import { spawnSync } from 'node:child_process';

type QuickStep = {
  id: string;
  args: string[];
};

type QuickStepResult = {
  id: string;
  code: number;
  durationMs: number;
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

function emitNotice(message: string): void {
  console.log(`::notice title=CI PR quick::${message}`);
}

function emitError(message: string): void {
  console.error(`::error title=CI PR quick::${message}`);
}

function runBunStep(step: QuickStep): QuickStepResult {
  const startedAt = Date.now();
  groupStart(`CI PR quick: ${step.id}`);
  console.log(`CI PR quick: ${step.id} started`);
  try {
    const result = spawnSync('bun', step.args, {
      env: process.env,
      stdio: 'inherit'
    });
    const durationMs = Date.now() - startedAt;
    const code = result.status ?? 1;
    console.log(`CI PR quick: ${step.id} finished with exit code ${code} in ${formatDuration(durationMs)}`);
    return { id: step.id, code, durationMs };
  } finally {
    groupEnd();
  }
}

const steps: QuickStep[] = [
  { id: 'typecheck', args: ['run', 'typecheck'] },
  { id: 'affected-tests', args: ['run', 'test:affected'] }
];

const startedAt = Date.now();
const results: QuickStepResult[] = [];
for (const step of steps) {
  const result = runBunStep(step);
  results.push(result);
  const summary = results.map((entry) => `${entry.id}=${entry.code}`).join(', ');
  emitNotice(`completed ${step.id}; summary: ${summary}`);
  if (result.code !== 0) {
    const message = `failed at ${step.id}; summary: ${summary}`;
    emitError(message);
    console.error(`CI PR quick ${message}`);
    process.exit(result.code);
  }
}

console.log(`CI PR quick: total time ${formatDuration(Date.now() - startedAt)}`);
