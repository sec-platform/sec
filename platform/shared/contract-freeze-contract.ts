export type ContractFreezeTarget = {
  file: string;
  testNamePattern?: string;
};

export type ContractFreezeContract = {
  formatVersion: '1';
  status: 'active';
  command: string;
  targetCount: number;
  targets: ContractFreezeTarget[];
};

export function getContractFreezeTargets(): ContractFreezeTarget[] {
  return [
    {
      file: 'tests/cli.test.ts',
      testNamePattern: [
        'CLI prints usage for missing or unknown commands',
        'CLI exposes doctor as text and JSON readiness contracts',
        'CLI exposes dependency environment maintenance entrypoints',
        'CLI exposes reference drift check as text and JSON contracts',
        'CLI exposes benchmark task-suite as text and JSON contracts',
        'CLI exposes test budget as text and JSON contracts',
        'CLI exposes contract freeze target list as text and JSON contracts',
        'CLI exposes error protocol as text and JSON contracts',
        'CLI exposes policy report as text and JSON contracts',
        'CLI emits explain JSON for CI consumers',
        'CLI emits artifact manifest JSON for CI upload consumers',
        'CLI reports argument usage errors'
      ].join('|')
    },
    {
      file: 'tests/project-runtime.test.ts',
      testNamePattern: [
        'root package exposes demo scripts through the existing platform chain',
        'test budget and benchmark contracts document slow lanes and task-suite scope',
        'error protocol, closed loop entry, and test lane map stay frozen in developer contracts',
        'reference refresh and shared cache contract stay anchored in repo metadata'
      ].join('|')
    },
    {
      file: 'tests/pipeline.test.ts',
      testNamePattern: 'v0.1 pipeline runs end to end in a temporary workspace'
    }
  ];
}

export function buildContractFreezeContract(): ContractFreezeContract {
  const targets = getContractFreezeTargets();
  return {
    formatVersion: '1',
    status: 'active',
    command: 'npm run test:contract-freeze',
    targetCount: targets.length,
    targets: targets.map((target) => ({ ...target }))
  };
}

export function formatContractFreezeContract(contract: ContractFreezeContract): string {
  return [
    `Contract freeze ${contract.status}`,
    `Command: ${contract.command}`,
    `Targets: ${contract.targetCount}`,
    ...contract.targets.map((target) => [
      `Target ${target.file}`,
      `pattern=${target.testNamePattern ?? 'all'}`
    ].join('; '))
  ].join('\n');
}
