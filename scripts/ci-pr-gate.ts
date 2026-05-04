import { spawnSync } from 'node:child_process';

type GateStep = {
  id: string;
  run: () => number;
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

function runCommand(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env
  });
  return result.status ?? 1;
}

function runGateStep(step: GateStep): number {
  const startedAt = Date.now();
  groupStart(`CI PR gate: ${step.id}`);
  console.log(`CI PR gate: ${step.id} started`);
  try {
    const code = step.run();
    console.log(`CI PR gate: ${step.id} finished with exit code ${code} in ${formatDuration(Date.now() - startedAt)}`);
    return code;
  } finally {
    groupEnd();
  }
}

const steps: GateStep[] = [
  {
    id: 'typecheck',
    run: () => runCommand('bun', ['run', 'typecheck'])
  }
];

const startedAt = Date.now();
for (const step of steps) {
  const code = runGateStep(step);
  if (code !== 0) {
    console.error(`CI PR gate failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

console.log(`CI PR gate: total gate time ${formatDuration(Date.now() - startedAt)}`);
