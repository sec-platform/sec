import { uniqueSorted } from './collections.ts';
import { CONTRACT_FORMAT_VERSION, CONTRACT_STATUS_ACTIVE } from './constants.ts';
import { platformCommand } from './platform-command.ts';

export type ContractFreezeTarget = {
  contractId: string;
  file: string;
  command: string;
};

export type ContractFreezeContract = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: typeof CONTRACT_STATUS_ACTIVE;
  command: string;
  runnerCommand: string;
  contractIdCount: number;
  contractIds: string[];
  targetFileCount: number;
  targetFiles: string[];
  targetCount: number;
  targets: ContractFreezeTarget[];
};

export type ContractFreezeRunnerInvocation = {
  files: string[];
  args: string[];
};

function buildTargetCommand(file: string): string {
  return `bun test ${file}`;
}

function contractFreezeTarget(contractId: string, file: string): ContractFreezeTarget {
  return {
    contractId,
    file,
    command: buildTargetCommand(file)
  };
}

function uniqueFiles(targets: ContractFreezeTarget[]): string[] {
  const seen = new Set<string>();
  return targets
    .map((target) => target.file)
    .filter((file) => {
      if (seen.has(file)) {
        return false;
      }
      seen.add(file);
      return true;
    });
}

function runnerInvocation(files: string[]): ContractFreezeRunnerInvocation {
  const sortedFiles = uniqueSorted(files);
  return {
    files: sortedFiles,
    args: ['test', ...sortedFiles]
  };
}

export function getContractFreezeTargets(): ContractFreezeTarget[] {
  return [
    contractFreezeTarget('cli.usage', 'tests/contract/usage.test.ts'),
    contractFreezeTarget('dependency.environment', 'tests/contract/environment.test.ts'),
    contractFreezeTarget('reference.drift', 'tests/contract/reference.test.ts'),
    contractFreezeTarget('semantic.fact-delta', 'tests/contract/fact-delta-contract.test.ts'),
    contractFreezeTarget('semantic.impact-propagation', 'tests/contract/impact-propagation-contract.test.ts'),
    contractFreezeTarget('semantic.mutation', 'tests/contract/semantic-mutation-contract.test.ts'),
    contractFreezeTarget(
      'semantic.mutation-source-adapter',
      'tests/contract/semantic-mutation-source-adapter-contract.test.ts'
    ),
    contractFreezeTarget(
      'semantic.mutation-apply',
      'tests/contract/semantic-mutation-apply-contract.test.ts'
    ),
    contractFreezeTarget('verification.budget', 'tests/contract/benchmark-budget.test.ts'),
    contractFreezeTarget('verification.impact', 'tests/contract/test-impact.test.ts'),
    contractFreezeTarget('verification.ci-lanes', 'tests/contract/ci-lanes.test.ts'),
    contractFreezeTarget('verification.test-architecture', 'tests/contract/test-architecture.test.ts'),
    contractFreezeTarget('verification.contract-freeze', 'tests/contract/contract-freeze.test.ts'),
    contractFreezeTarget('verification.ci-workflow', 'tests/contract/ci-contract.test.ts'),
    contractFreezeTarget('cli.error-protocol', 'tests/contract/error-protocol.test.ts'),
    contractFreezeTarget('review.summary', 'tests/integration/review.test.ts'),
    contractFreezeTarget('repository.runtime', 'tests/integration/project-runtime.test.ts')
  ];
}


export function buildContractFreezeRunnerInvocations(
  targets = getContractFreezeTargets()
): ContractFreezeRunnerInvocation[] {
  return targets.length > 0 ? [runnerInvocation(uniqueFiles(targets))] : [];
}

export function buildContractFreezeContract(): ContractFreezeContract {
  const targets = getContractFreezeTargets();
  const contractIds = uniqueSorted(targets.map((target) => target.contractId));
  const targetFiles = uniqueSorted(targets.map((target) => target.file));

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    status: CONTRACT_STATUS_ACTIVE,
    command: platformCommand('contract', 'freeze', '--json'),
    runnerCommand: 'bun run test:contract-freeze',
    contractIdCount: contractIds.length,
    contractIds,
    targetFileCount: targetFiles.length,
    targetFiles,
    targetCount: targets.length,
    targets: targets.map((target) => ({ ...target }))
  };
}

export function formatContractFreezeContract(contract: ContractFreezeContract): string {
  return [
    `Contract freeze ${contract.status}`,
    `Command: ${contract.command}`,
    `Runner command: ${contract.runnerCommand}`,
    `Contract IDs: ${contract.contractIdCount}`,
    `Contract ID list: ${contract.contractIds.join(', ')}`,
    `Target files: ${contract.targetFileCount}`,
    `Target file list: ${contract.targetFiles.join(', ')}`,
    `Targets: ${contract.targetCount}`,
    ...contract.targets.map((target) => [
      `Target ${target.contractId}`,
      `file=${target.file}`,
      `command=${target.command}`
    ].join('; '))
  ].join('\n');
}
