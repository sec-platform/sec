import { spawnSync } from 'node:child_process';
import { runChangedTests, runContractFreeze } from '../platform/dev-runner/test-runner.ts';
import { runTypecheck } from '../platform/dev-runner/typecheck-runner.ts';
import { runCiFastGate } from './ci-fast-gate.ts';

type GateStep = {
  id: string;
  run: () => Promise<number>;
};

type GateResult = {
  id: string;
  code: number;
};

const contractImpactPatterns = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^README\.md$/,
  /^docs\//,
  /^platform\/cli\//,
  /^platform\/dev-runner/,
  /^platform\/shared\/(benchmark-contract|contract-freeze-contract|error-protocol|error-protocol-contract|reference-check|test-budget-contract)\.ts$/,
  /^tests\/contract\//,
  /^tests\/integration\/(project-runtime|review)\.test\.ts$/
];

function changedFiles(): string[] | null {
  const baseRef = process.env.PJC_CHANGED_BASE ?? 'HEAD^1';
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

function contractFreezeNeeded(): boolean {
  const files = changedFiles();
  if (!files) {
    console.log('CI PR gate: changed file detection failed; keeping contract-freeze enabled.');
    return true;
  }

  const matched = files.filter((file) => contractImpactPatterns.some((pattern) => pattern.test(file)));
  if (matched.length === 0) {
    console.log('CI PR gate: contract-freeze skipped; no contract-impact files changed.');
    return false;
  }

  console.log(`CI PR gate: contract-freeze enabled for ${matched.join(', ')}`);
  return true;
}

const readonlySteps: GateStep[] = [
  {
    id: 'typecheck',
    run: () => runTypecheck()
  },
  ...(contractFreezeNeeded()
    ? [
        {
          id: 'contract-freeze',
          run: () => runContractFreeze()
        }
      ]
    : []),
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
