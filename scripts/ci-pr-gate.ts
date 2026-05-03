import { spawnSync } from 'node:child_process';
import { runChangedTests, runContractFreeze } from '../platform/dev-runner/test-runner.ts';
import {
  getContractFreezeTargets,
  type ContractFreezeTarget
} from '../platform/shared/contract-freeze-contract.ts';
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

type ContractFreezeSelection = {
  files: string[];
  targets: ContractFreezeTarget[];
  full: boolean;
};

const broadContractImpactPatterns = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^README\.md$/,
  /^docs\//,
  /^platform\/cli\//,
  /^platform\/dev-runner\.ts$/,
  /^platform\/dev-runner\/(test-runner|typecheck-runner)\.ts$/,
  /^platform\/shared\/(contract-freeze-contract|test-budget-contract)\.ts$/
];

const targetedContractImpactPatterns: Array<{ pattern: RegExp; file: string }> = [
  { pattern: /^tests\/contract\/usage\.test\.ts$/, file: 'tests/contract/usage.test.ts' },
  { pattern: /^tests\/contract\/environment\.test\.ts$/, file: 'tests/contract/environment.test.ts' },
  { pattern: /^tests\/contract\/reference\.test\.ts$/, file: 'tests/contract/reference.test.ts' },
  { pattern: /^tests\/contract\/benchmark-budget\.test\.ts$/, file: 'tests/contract/benchmark-budget.test.ts' },
  { pattern: /^tests\/contract\/contracts\.test\.ts$/, file: 'tests/contract/contracts.test.ts' },
  { pattern: /^tests\/integration\/review\.test\.ts$/, file: 'tests/integration/review.test.ts' },
  { pattern: /^tests\/integration\/project-runtime\.test\.ts$/, file: 'tests/integration/project-runtime.test.ts' },
  { pattern: /^platform\/dev-runner\/import-organizer\.ts$/, file: 'tests/contract/usage.test.ts' }
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

function selectContractFreezeTargets(files: string[]): ContractFreezeSelection | null {
  if (files.some((file) => broadContractImpactPatterns.some((pattern) => pattern.test(file)))) {
    return { files, targets: getContractFreezeTargets(), full: true };
  }

  const targetFiles = new Set<string>();
  for (const file of files) {
    for (const mapping of targetedContractImpactPatterns) {
      if (mapping.pattern.test(file)) {
        targetFiles.add(mapping.file);
      }
    }
  }

  if (targetFiles.size === 0) {
    return null;
  }

  const targets = getContractFreezeTargets().filter((target) => targetFiles.has(target.file));
  return { files, targets, full: false };
}

function contractFreezeSelection(): ContractFreezeSelection | null | 'unknown' {
  const files = changedFiles();
  if (!files) {
    console.log('CI PR gate: changed file detection failed; keeping contract-freeze enabled.');
    return 'unknown';
  }

  return selectContractFreezeTargets(files);
}

const selection = contractFreezeSelection();
const readonlySteps: GateStep[] = [
  {
    id: 'typecheck',
    run: () => runTypecheck()
  },
  ...(selection === 'unknown'
    ? [
        {
          id: 'contract-freeze',
          run: () => runContractFreeze()
        }
      ]
    : selection
      ? [
          {
            id: 'contract-freeze',
            run: () => {
              const targetFiles = selection.targets.map((target) => target.file).join(', ');
              console.log(
                `CI PR gate: contract-freeze ${selection.full ? 'full' : 'targeted'} for ${targetFiles}`
              );
              return runContractFreeze(selection.targets);
            }
          }
        ]
      : []),
  {
    id: 'test:changed',
    run: () => runChangedTests()
  }
];

if (!selection) {
  console.log('CI PR gate: contract-freeze skipped; no contract-impact files changed.');
}

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
