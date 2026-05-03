import { runCiFastGate } from './ci-fast-gate.ts';
import { runContractFreeze, runChangedTests } from '../platform/dev-runner/test-runner.ts';
import { runTypecheck } from '../platform/dev-runner/typecheck-runner.ts';

type GateStep = {
  id: string;
  run: () => Promise<number>;
};

const steps: GateStep[] = [
  {
    id: 'typecheck',
    run: () => runTypecheck()
  },
  {
    id: 'contract-freeze',
    run: () => runContractFreeze()
  },
  {
    id: 'test:changed',
    run: () => runChangedTests()
  },
  {
    id: 'fast-workspace-gate',
    run: () => runCiFastGate()
  }
];

for (const step of steps) {
  console.log(`CI PR gate: ${step.id}`);
  const code = await step.run();
  if (code !== 0) {
    console.error(`CI PR gate failed at ${step.id} with exit code ${code}`);
    process.exit(code);
  }
}
