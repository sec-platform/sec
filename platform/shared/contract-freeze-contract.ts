export type ContractFreezeTarget = {
  file: string;
  command: string;
  testNamePattern?: string;
};

export type ContractFreezeContract = {
  formatVersion: '1';
  status: 'active';
  command: string;
  targetFileCount: number;
  targetFiles: string[];
  targetCount: number;
  targets: ContractFreezeTarget[];
};

function buildTargetCommand(file: string, testNamePattern?: string): string {
  return testNamePattern
    ? `bun test ${file} --test-name-pattern "${testNamePattern}"`
    : `bun test ${file}`;
}

function contractFreezeTarget(file: string, testNamePattern?: string): ContractFreezeTarget {
  return {
    file,
    command: buildTargetCommand(file, testNamePattern),
    ...(testNamePattern ? { testNamePattern } : {})
  };
}

export function getContractFreezeTargets(): ContractFreezeTarget[] {
  return [
    contractFreezeTarget(
      'tests/cli.test.ts',
      [
        'CLI prints usage for missing or unknown commands',
        'CLI exposes doctor as text and JSON readiness contracts',
        'CLI exposes dependency environment maintenance entrypoints',
        'CLI exposes reference drift check as text and JSON contracts',
        'CLI exposes benchmark task-suite as text and JSON contracts',
        'CLI exposes test budget as text and JSON contracts',
        'CLI exposes contract freeze target list as text and JSON contracts',
        'CLI exposes CI command contract as text and JSON contracts',
        'CLI exposes error protocol as text and JSON contracts',
        'CLI exposes policy report as text and JSON contracts',
        'CLI exposes acceptance coverage as text and JSON contracts',
        'CLI exposes runtime report as text and JSON contracts',
        'CLI exposes verification report as text and JSON contracts',
        'CLI runs verify with JSON output for CI consumers',
        'CLI exposes provenance registry as text and JSON contracts',
        'CLI exposes review summary as text and JSON contracts',
        'CLI emits repair dry-run JSON for CI consumers',
        'CLI emits blocked repair JSON for CI consumers',
        'CLI emits upgrade dry-run JSON for CI consumers',
        'CLI emits explain JSON for CI consumers',
        'CLI emits artifact manifest JSON for CI upload consumers',
        'CLI reports argument usage errors'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/project-runtime.test.ts',
      [
        'root package exposes demo scripts through the existing platform chain',
        'test budget and benchmark contracts document slow lanes and task-suite scope',
        'error protocol, closed loop entry, and test lane map stay frozen in developer contracts',
        'reference refresh and shared cache contract stay anchored in repo metadata'
      ].join('|')
    ),
    contractFreezeTarget(
      'tests/pipeline.test.ts',
      'v0.1 pipeline runs end to end in a temporary workspace'
    )
  ];
}

export function buildContractFreezeContract(): ContractFreezeContract {
  const targets = getContractFreezeTargets();
  const targetFiles = [...new Set(targets.map((target) => target.file))].sort((left, right) =>
    left.localeCompare(right)
  );

  return {
    formatVersion: '1',
    status: 'active',
    command: 'npm run test:contract-freeze',
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
