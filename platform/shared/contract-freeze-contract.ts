import { uniqueSorted } from './collections.ts';
import { CONTRACT_FORMAT_VERSION, CONTRACT_STATUS_ACTIVE } from './constants.ts';

export type ContractFreezeTarget = {
  file: string;
  command: string;
  testNamePattern?: string;
};

export type ContractFreezeContract = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: typeof CONTRACT_STATUS_ACTIVE;
  command: string;
  runnerCommand: string;
  targetFileCount: number;
  targetFiles: string[];
  targetCount: number;
  targets: ContractFreezeTarget[];
};

export type ContractFreezeRunnerInvocation = {
  files: string[];
  args: string[];
  testNamePattern?: string;
};

function buildTargetCommand(file: string, testNamePattern?: string): string {
  return testNamePattern
    ? `bunx vitest run ${file} --testNamePattern "${testNamePattern}"`
    : `bunx vitest run ${file}`;
}

function contractFreezeTarget(file: string, testNamePattern?: string): ContractFreezeTarget {
  return {
    file,
    command: buildTargetCommand(file, testNamePattern),
    ...(testNamePattern ? { testNamePattern } : {})
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

function runnerInvocation(files: string[], testNamePattern?: string): ContractFreezeRunnerInvocation {
  return {
    files,
    args: testNamePattern
      ? ['run', ...files, '--testNamePattern', testNamePattern]
      : ['run', ...files],
    ...(testNamePattern ? { testNamePattern } : {})
  };
}

export function getContractFreezeTargets(): ContractFreezeTarget[] {
  return [
    contractFreezeTarget(
      'tests/cli/usage.test.ts',
      [
        'CLI prints usage for missing or unknown commands',
        'CLI reports argument usage errors'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/cli/demo-doctor.test.ts',
      [
        'CLI exposes demo checklist as text and JSON readiness contracts',
        'CLI exposes doctor as text and JSON readiness contracts'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/cli/environment.test.ts',
      'CLI exposes dependency environment maintenance entrypoints'
    ),
    contractFreezeTarget(
      'tests/cli/reference.test.ts',
      'CLI exposes reference drift check as text and JSON contracts'
    ),
    contractFreezeTarget(
      'tests/cli/benchmark-budget.test.ts',
      [
        'CLI exposes benchmark task-suite as text and JSON contracts',
        'CLI exposes test budget as text and JSON contracts'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/cli/contracts.test.ts',
      [
        'CLI exposes contract freeze target list as text and JSON contracts',
        'CLI exposes CI command contract as text and JSON contracts',
        'CLI exposes error protocol as text and JSON contracts'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/cli/verification.test.ts',
      [
        'CLI exposes policy report as text and JSON contracts',
        'CLI exposes acceptance coverage as text and JSON contracts',
        'CLI exposes runtime report as text and JSON contracts',
        'CLI runs verify with JSON output for CI consumers',
        'CLI exposes verification report as text and JSON contracts'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/cli/provenance.test.ts',
      'CLI exposes provenance registry as text and JSON contracts'
    ),
    contractFreezeTarget(
      'tests/cli/review.test.ts',
      'CLI exposes review summary as text and JSON contracts'
    ),
    contractFreezeTarget(
      'tests/cli/repair.test.ts',
      [
        'CLI emits repair dry-run JSON for CI consumers',
        'CLI emits blocked repair JSON for CI consumers'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/cli/upgrade.test.ts',
      'CLI emits upgrade dry-run JSON for CI consumers'
    ),
    contractFreezeTarget(
      'tests/cli/explain.test.ts',
      'CLI emits explain JSON for CI consumers'
    ),
    contractFreezeTarget(
      'tests/cli/artifacts.test.ts',
      'CLI emits artifact manifest JSON for CI upload consumers'
    ),
    contractFreezeTarget(
      'tests/runtime/project-runtime.test.ts',
      [
        'root package exposes budget and contract scripts',
        'dev-runner does not expose contract subcommands directly',
        'fast test runner excludes slow files and skips runtime deps setup',
        'test budget contract documents lanes and their capabilities',
        'benchmark contract documents suite metadata and task definitions',
        'reference check contract documents drift detection commands',
        'README documents closed-loop and CLI surface',
        'contract freeze contract documents runner wiring',
        'error protocol defines issue types and code prefixes',
        'error protocol contract documents error shape and sample IDs',
        'CLI surfaces protocol fields in error output'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/pipeline/end-to-end.test.ts',
      'v0.1 pipeline runs end to end in a temporary workspace'
    )
  ];
}

export function buildContractFreezeRunnerInvocations(
  targets = getContractFreezeTargets()
): ContractFreezeRunnerInvocation[] {
  const patternedTargets = targets.filter((target) => target.testNamePattern);
  const unpatternedTargets = targets.filter((target) => !target.testNamePattern);
  const invocations: ContractFreezeRunnerInvocation[] = [];

  if (patternedTargets.length > 0) {
    invocations.push(runnerInvocation(
      uniqueFiles(patternedTargets),
      patternedTargets.map((target) => `(?:${target.testNamePattern})`).join('|')
    ));
  }
  if (unpatternedTargets.length > 0) {
    invocations.push(runnerInvocation(uniqueFiles(unpatternedTargets)));
  }

  return invocations;
}

export function buildContractFreezeContract(): ContractFreezeContract {
  const targets = getContractFreezeTargets();
  const targetFiles = uniqueSorted(targets.map((target) => target.file));

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    status: CONTRACT_STATUS_ACTIVE,
    command: 'npm run platform -- contract freeze --json',
    runnerCommand: 'npm run test:contract-freeze',
    targetFileCount: targetFiles.length,
    targetFiles,
    targetCount: targets.length,
    targets: targets.map((target) => ({
      ...target,
      ...(target.testNamePattern ? { testNamePattern: target.testNamePattern } : {})
    }))
  };
}

export function formatContractFreezeContract(contract: ContractFreezeContract): string {
  return [
    `Contract freeze ${contract.status}`,
    `Command: ${contract.command}`,
    `Runner command: ${contract.runnerCommand}`,
    `Target files: ${contract.targetFileCount}`,
    `Target file list: ${contract.targetFiles.join(', ')}`,
    `Targets: ${contract.targetCount}`,
    ...contract.targets.map((target) => [
      `Target ${target.file}`,
      `command=${target.command}`,
      `pattern=${target.testNamePattern ?? 'all'}`
    ].join('; '))
  ].join('\n');
}
