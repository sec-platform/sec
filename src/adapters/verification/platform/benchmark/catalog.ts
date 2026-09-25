import { CI_ARTIFACT_FILES } from '../../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { uniqueSorted } from '../../../../contracts/canonical.ts';
import { platformCommand } from '../command.ts';

const BENCHMARK_CATALOG_STATUS_ACTIVE = 'active' as const;

/**
 * Descriptive benchmark scenarios only. This catalog neither executes tasks
 * nor carries measurements, baselines, regressions, or verification evidence.
 */

type BenchmarkCatalogTask = {
  id: string;
  goal: string;
  gate: string;
  command: string;
  artifactPathCount: number;
  artifactPaths: string[];
  scoreFocusCount: number;
  scoreFocus: string[];
};

export type BenchmarkTaskCatalog = {
  catalogId: string;
  status: typeof BENCHMARK_CATALOG_STATUS_ACTIVE;
  command: string;
  taskCount: number;
  tasks: BenchmarkCatalogTask[];
  artifactPathCount: number;
  artifactPaths: string[];
  scoreDimensionCount: number;
  scoreDimensions: string[];
};

const benchmarkTasks: Array<Omit<BenchmarkCatalogTask, 'artifactPathCount' | 'scoreFocusCount'>> = [
  {
    id: 'add-block',
    goal: 'install one capability block into a clean workspace',
    gate: 'resolve compose verify lock explain',
    command: 'bun run demo:quickstart',
    artifactPaths: [
      CI_ARTIFACT_FILES.graphLock,
      CI_ARTIFACT_FILES.provenance,
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.explainGraph
    ],
    scoreFocus: ['success-rate', 'files-touched', 'verification-status']
  },
  {
    id: 'repair-file',
    goal: 'repair one file issue within the repair task write bounds',
    gate: 'repair verify',
    command: platformCommand('repair', '--dry-run', '--json', '--compact'),
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
    command: platformCommand('policy', 'report', '--json', '--compact'),
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
    command: platformCommand(
      'upgrade',
      '<block-id>',
      '<target-version>',
      '--dry-run',
      '--json',
      '--compact'
    ),
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
    command: platformCommand(
      'upgrade',
      '<block-id>',
      '<target-version>',
      '--dry-run',
      '--json',
      '--compact'
    ),
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

export function buildBenchmarkTaskCatalog(): BenchmarkTaskCatalog {
  const artifactPaths = uniqueSorted(benchmarkTasks.flatMap((task) => task.artifactPaths));
  return {
    catalogId: 'engineering-compiler-core',
    status: BENCHMARK_CATALOG_STATUS_ACTIVE,
    command: platformCommand('benchmark', 'catalog', '--json'),
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