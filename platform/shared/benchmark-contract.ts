export type BenchmarkTask = {
  id: string;
  goal: string;
  gate: string;
  command: string;
  artifactPathCount: number;
  artifactPaths: string[];
  scoreFocusCount: number;
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
  scoreDimensionCount: number;
  scoreDimensions: string[];
};

import { CI_ARTIFACT_FILES } from './ci-artifact-contract.ts';
import { uniqueSorted } from './collections.ts';

const benchmarkTasks: Array<Omit<BenchmarkTask, 'artifactPathCount' | 'scoreFocusCount'>> = [
  {
    id: 'add-block',
    goal: 'install one capability block into a clean workspace',
    gate: 'resolve compose adapt verify lock explain',
    command: 'npm run demo:quickstart',
    artifactPaths: [
      CI_ARTIFACT_FILES.graphLock,
      CI_ARTIFACT_FILES.provenance,
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.explainGraph
    ],
    scoreFocus: ['success-rate', 'files-touched', 'verification-status']
  },
  {
    id: 'repair-slot',
    goal: 'repair one slot issue within task-envelope write bounds',
    gate: 'repair verify',
    command: 'npm run platform -- repair --dry-run --json --compact',
    artifactPaths: [
      CI_ARTIFACT_FILES.repairPlan,
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.provenance
    ],
    scoreFocus: ['repairability', 'attempt-count', 'verification-status']
  },
  {
    id: 'policy-violation',
    goal: 'detect and explain one project policy violation',
    gate: 'verify explain',
    command: 'npm run platform -- policy report --json --compact',
    artifactPaths: [
      CI_ARTIFACT_FILES.policyReport,
      CI_ARTIFACT_FILES.acceptanceCoverage,
      CI_ARTIFACT_FILES.explainGraph
    ],
    scoreFocus: ['diagnostic-precision', 'explainability']
  },
  {
    id: 'upgrade-dry-run',
    goal: 'preview one governed block upgrade and impact summary',
    gate: 'upgrade --dry-run explain',
    command: 'npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact',
    artifactPaths: [
      CI_ARTIFACT_FILES.upgradePlan,
      CI_ARTIFACT_FILES.upgradeDiagnostics,
      CI_ARTIFACT_FILES.reviewSummary
    ],
    scoreFocus: ['upgrade-safety', 'impact-coverage']
  },
  {
    id: 'override-conflict',
    goal: 'surface one override conflict during upgrade planning',
    gate: 'upgrade --dry-run',
    command: 'npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact',
    artifactPaths: [
      'source/patches/override-manifest.yaml',
      CI_ARTIFACT_FILES.upgradeDiagnostics,
      CI_ARTIFACT_FILES.reviewSummary
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
      artifactPathCount: task.artifactPaths.length,
      artifactPaths: [...task.artifactPaths],
      scoreFocusCount: task.scoreFocus.length,
      scoreFocus: [...task.scoreFocus]
    })),
    artifactPathCount: artifactPaths.length,
    artifactPaths,
    scoreDimensionCount: scoreDimensions.length,
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
    `Score dimension count: ${contract.scoreDimensionCount}`,
    `Score dimensions: ${contract.scoreDimensions.join(', ')}`
  ];

  for (const task of contract.tasks) {
    lines.push(
      `Task ${task.id}: ${task.goal}; gate=${task.gate}; command=${task.command}; artifactCount=${task.artifactPathCount}; artifacts=${task.artifactPaths.join(', ')}; scoreFocusCount=${task.scoreFocusCount}; score=${task.scoreFocus.join(', ')}`
    );
  }

  return lines.join('\n');
}
