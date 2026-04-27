export type CiContractStep = {
  id: string;
  phase: 'verify' | 'quality' | 'diagnostics' | 'artifacts';
  command: string;
  purpose: string;
  produces: string[];
};

export type CiContract = {
  formatVersion: '1';
  status: 'active';
  command: string;
  defaultGate: string;
  fullRuntimeGate: string;
  verifyCommands: string[];
  qualityCommands: string[];
  diagnosticCommands: string[];
  artifactUploadCommands: string[];
  artifactPathCount: number;
  artifactPaths: string[];
  stepCount: number;
  steps: CiContractStep[];
};

const ciSteps: CiContractStep[] = [
  {
    id: 'pr-fast-verify',
    phase: 'verify',
    command: 'npm run platform -- verify --json --compact',
    purpose: 'Run the default fast verification lane for pull requests.',
    produces: ['project/generated/verification-report.json']
  },
  {
    id: 'full-runtime-verify',
    phase: 'verify',
    command: 'npm run platform -- verify --lane all --json --compact',
    purpose: 'Run the full runtime gate for release, demo, or scheduled CI.',
    produces: [
      'project/generated/verification-report.json',
      'project/generated/runtime-report.json',
      'project/generated/acceptance-coverage.json'
    ]
  },
  {
    id: 'slow-test-budget',
    phase: 'quality',
    command: 'npm run platform -- test budget --json --compact',
    purpose: 'Expose the fast/runtime/all slow-test lane budget before selecting CI gates.',
    produces: []
  },
  {
    id: 'benchmark-task-suite',
    phase: 'quality',
    command: 'npm run platform -- benchmark suite --json --compact',
    purpose: 'Expose the benchmark task-suite contract and scoring dimensions for scheduled quality jobs.',
    produces: []
  },
  {
    id: 'diagnostic-review',
    phase: 'diagnostics',
    command: 'npm run platform -- review summary --json --compact',
    purpose: 'Expose policy, provenance, repair, upgrade, and artifact review evidence.',
    produces: ['project/generated/review-summary.json']
  },
  {
    id: 'diagnostic-explain',
    phase: 'diagnostics',
    command: 'npm run platform -- explain --json --compact',
    purpose: 'Expose the explain graph and review summary for failed CI triage.',
    produces: [
      'project/generated/explain-graph.json',
      'project/generated/review-summary.json'
    ]
  },
  {
    id: 'governance-artifacts',
    phase: 'artifacts',
    command: 'npm run platform -- artifacts --paths --json --compact --kind governance',
    purpose: 'Emit upload paths for governance artifacts.',
    produces: ['project/generated/ci-artifacts.json']
  },
  {
    id: 'view-artifacts',
    phase: 'artifacts',
    command: 'npm run platform -- artifacts --paths --json --compact --kind view',
    purpose: 'Emit upload paths for generated view artifacts.',
    produces: ['project/generated/ci-artifacts.json']
  },
  {
    id: 'test-artifacts',
    phase: 'artifacts',
    command: 'npm run platform -- artifacts --paths --json --compact --kind test',
    purpose: 'Emit upload paths for runtime test artifacts.',
    produces: ['project/generated/ci-artifacts.json']
  },
  {
    id: 'contract-artifacts',
    phase: 'artifacts',
    command: 'npm run platform -- artifacts --paths --json --compact --kind contract',
    purpose: 'Emit upload paths for contract artifacts.',
    produces: ['project/generated/ci-artifacts.json']
  }
];

export function buildCiContract(): CiContract {
  const artifactPaths = [...new Set(ciSteps.flatMap((step) => step.produces))].sort((left, right) =>
    left.localeCompare(right)
  );

  return {
    formatVersion: '1',
    status: 'active',
    command: 'npm run platform -- contract ci --json',
    defaultGate: 'pr-fast-verify',
    fullRuntimeGate: 'full-runtime-verify',
    verifyCommands: ciSteps
      .filter((step) => step.phase === 'verify')
      .map((step) => step.command),
    qualityCommands: ciSteps
      .filter((step) => step.phase === 'quality')
      .map((step) => step.command),
    diagnosticCommands: ciSteps
      .filter((step) => step.phase === 'diagnostics')
      .map((step) => step.command),
    artifactUploadCommands: ciSteps
      .filter((step) => step.phase === 'artifacts')
      .map((step) => step.command),
    artifactPathCount: artifactPaths.length,
    artifactPaths,
    stepCount: ciSteps.length,
    steps: ciSteps.map((step) => ({
      ...step,
      produces: [...step.produces]
    }))
  };
}

export function formatCiContract(contract: CiContract): string {
  return [
    `CI contract ${contract.status}`,
    `Command: ${contract.command}`,
    `Default gate: ${contract.defaultGate}`,
    `Full runtime gate: ${contract.fullRuntimeGate}`,
    `Verify commands: ${contract.verifyCommands.join(', ')}`,
    `Quality commands: ${contract.qualityCommands.join(', ')}`,
    `Diagnostic commands: ${contract.diagnosticCommands.join(', ')}`,
    `Artifact uploads: ${contract.artifactUploadCommands.join(', ')}`,
    `Artifact paths: ${contract.artifactPathCount}`,
    `Artifact path list: ${contract.artifactPaths.join(', ')}`,
    `Steps: ${contract.stepCount}`,
    ...contract.steps.map((step) => [
      `Step ${step.id}`,
      `phase=${step.phase}`,
      `command=${step.command}`,
      `produces=${step.produces.join(', ')}`
    ].join('; '))
  ].join('\n');
}
