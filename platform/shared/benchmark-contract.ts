export type BenchmarkTask = {
  id: string;
  goal: string;
  gate: string;
  command: string;
  artifactPaths: string[];
  scoreFocus: string[];
};

export type BenchmarkTaskSuiteContract = {
  formatVersion: '1';
  suiteId: string;
  status: 'active';
  command: string;
  runnerCommand: string;
  taskCount: number;
  tasks: BenchmarkTask[];
  artifactPathCount: number;
  artifactPaths: string[];
  scoreDimensions: string[];
};

const benchmarkTasks: BenchmarkTask[] = [
  {
    id: 'add-block',
    goal: 'install one capability block into a clean workspace',
    gate: 'resolve compose adapt verify lock explain',
    command: 'npm run demo:quickstart',
    artifactPaths: [
      'project/graph.lock.json',
      'project/provenance.json',
      'project/generated/verification-report.json',
      'project/generated/explain-graph.json'
    ],
    scoreFocus: ['success-rate', 'files-touched', 'verification-status']
  },
  {
    id: 'repair-slot',
    goal: 'repair one slot issue within task-envelope write bounds',
    gate: 'repair verify',
    command: 'npm run platform -- repair --dry-run --json --compact',
    artifactPaths: [
      'project/generated/repair-plan.json',
      'project/generated/verification-report.json',
      'project/provenance.json'
    ],
    scoreFocus: ['repairability', 'attempt-count', 'verification-status']
  },
  {
    id: 'policy-violation',
    goal: 'detect and explain one project policy violation',
    gate: 'verify explain',
    command: 'npm run platform -- policy report --json --compact',
    artifactPaths: [
      'project/generated/policy-report.json',
      'project/generated/acceptance-coverage.json',
      'project/generated/explain-graph.json'
    ],
    scoreFocus: ['diagnostic-precision', 'explainability']
  },
  {
    id: 'upgrade-dry-run',
    goal: 'preview one governed block upgrade and impact summary',
    gate: 'upgrade --dry-run explain',
    command: 'npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact',
    artifactPaths: [
      'project/generated/upgrade-plan.json',
      'project/generated/upgrade-diagnostics.json',
      'project/generated/review-summary.json'
    ],
    scoreFocus: ['upgrade-safety', 'impact-coverage']
  },
  {
    id: 'override-conflict',
    goal: 'surface one override conflict during upgrade planning',
    gate: 'upgrade --dry-run',
    command: 'npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact',
    artifactPaths: [
      'project/overrides/override.manifest.yaml',
      'project/generated/upgrade-diagnostics.json',
      'project/generated/review-summary.json'
    ],
    scoreFocus: ['conflict-detection', 'machine-recoverability']
  }
];

const scoreDimensions = [
  'success-rate',
  'attempt-count',
  'wall-time',
  'files-touched',
  'verification-status',
  'explainability',
  'repairability',
  'upgrade-safety',
  'machine-recoverability'
];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function buildBenchmarkTaskSuiteContract(): BenchmarkTaskSuiteContract {
  const artifactPaths = uniqueSorted(benchmarkTasks.flatMap((task) => task.artifactPaths));
  return {
    formatVersion: '1',
    suiteId: 'engineering-compiler-core',
    status: 'active',
    command: 'npm run platform -- benchmark suite --json',
    runnerCommand: 'npm run test:benchmark-contract',
    taskCount: benchmarkTasks.length,
    tasks: benchmarkTasks.map((task) => ({
      ...task,
      artifactPaths: [...task.artifactPaths],
      scoreFocus: [...task.scoreFocus]
    })),
    artifactPathCount: artifactPaths.length,
    artifactPaths,
    scoreDimensions: [...scoreDimensions]
  };
}

export function formatBenchmarkTaskSuiteContract(contract: BenchmarkTaskSuiteContract): string {
  const lines = [
    `Benchmark suite ${contract.suiteId} (${contract.status})`,
    `Command: ${contract.command}`,
    `Runner command: ${contract.runnerCommand}`,
    `Tasks: ${contract.taskCount}`,
    `Artifact paths: ${contract.artifactPathCount}`,
    `Artifact path list: ${contract.artifactPaths.join(', ')}`,
    `Score dimensions: ${contract.scoreDimensions.join(', ')}`
  ];

  for (const task of contract.tasks) {
    lines.push(
      `Task ${task.id}: ${task.goal}; gate=${task.gate}; command=${task.command}; artifacts=${task.artifactPaths.join(', ')}; score=${task.scoreFocus.join(', ')}`
    );
  }

  return lines.join('\n');
}
