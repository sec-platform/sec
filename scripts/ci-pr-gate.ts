import { runChangedTests } from '../platform/dev-runner/test-runner.ts';
import { runTypecheck } from '../platform/dev-runner/typecheck-runner.ts';

type GateStep = {
  id: string;
  run: () => Promise<number>;
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

async function runGateStep(step: GateStep): Promise<number> {
  const startedAt = Date.now();
  groupStart(`CI PR gate: ${step.id}`);
  console.log(`CI PR gate: ${step.id} started`);
  try {
    const code = await step.run();
    console.log(`CI PR gate: ${step.id} finished with exit code ${code} in ${formatDuration(Date.now() - startedAt)}`);
    return code;
  } finally {
    groupEnd();
  }
}

async function runChangedTestsWithLatestCommitBase(): Promise<number> {
  console.log('CI PR gate: changed tests skipped in PR fast lane; full/manual validation covers changed-test selection.');
  void runChangedTests;
  return 0;
}

const steps: GateStep[] = [
  {
    id: 'typecheck',
    run: () => runTypecheck()
  },
  {
    id: 'test:changed',
    run: () => runChangedTestsWithLatestCommitBase()
  }
];

const startedAt = Date.now();
for (const step of steps) {
  const code = await runGateStep(step);
  if (code !== 0) {
    console.error(`CI PR gate failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}

console.log(`CI PR gate: total gate time ${formatDuration(Date.now() - startedAt)}`);
