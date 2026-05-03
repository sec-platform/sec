import { runCiFastGate } from './ci-fast-gate.ts';
import { runContractFreeze, runChangedTests } from '../platform/dev-runner/test-runner.ts';
import { runTypecheck } from '../platform/dev-runner/typecheck-runner.ts';

type GateStep = {
  id: string;
  run: () => Promise<number>;
};

type GateResult = {
  id: string;
  code: number;
};

const readonlySteps: GateStep[] = [
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
  }
];

async function runGateStep(step: GateStep): Promise<GateResult> {
  console.log(`CI PR gate: ${step.id}`);
  const code = await step.run();
  return { id: step.id, code };
}

const readonlyResults = await Promise.all(readonlySteps.map(runGateStep));
const failedReadonlyStep = readonlyResults.find((result) => result.code !== 0);
if (failedReadonlyStep) {
  console.error(`CI PR gate failed at ${failedReadonlyStep.id} with exit code ${failedReadonlyStep.code}`);
  process.exit(failedReadonlyStep.code);
}

const fastWorkspaceResult = await runGateStep({
  id: 'fast-workspace-gate',
  run: () => runCiFastGate()
});
if (fastWorkspaceResult.code !== 0) {
  console.error(`CI PR gate failed at ${fastWorkspaceResult.id} with exit code ${fastWorkspaceResult.code}`);
  process.exit(fastWorkspaceResult.code);
}
