import {
  CI_ARTIFACT_FORMAT_VERSION,
  CI_ARTIFACT_KINDS,
  CI_ARTIFACT_MISSING_REASONS,
  type CiArtifactEntry,
  type CiArtifactKind,
  type CiArtifactManifest,
  type CiArtifactMissingEntry,
  type CiArtifactSummary,
  type CiArtifactUploadGroup
} from './types.ts';
import { countPositiveValues, uniqueSorted } from '../../../foundation/collections.ts';
import { posixPath } from '../../../workspace/paths.ts';
import { platformCommand } from '../../../cli/contract.ts';

export const CI_ARTIFACT_FILES = {
  artifactManifest: 'control/ci/artifacts.json',
  graphLock: 'control/state/graph.lock.json',
  provenance: 'control/provenance/provenance.json',
  blockUsageMap: 'control/evidence/block-usage-map.json',
  installManifest: 'control/evidence/install-manifest.json',
  verificationReport: 'control/evidence/verification-report.json',
  runtimeReport: 'control/evidence/runtime-report.json',
  policyReport: 'control/evidence/policy-report.json',
  acceptanceCoverage: 'control/evidence/acceptance-coverage.json',
  explainGraph: 'control/graph/explain-graph.json',
  explainGraphMermaid: 'control/graph/explain-graph.mmd',
  explainGraphDot: 'control/graph/explain-graph.dot',
  reviewSummary: 'control/evidence/review-summary.json',
  repairPlan: 'control/workflow/repair-plan.json',
  upgradePlan: 'control/workflow/upgrade-plan.json',
  upgradeDiagnostics: 'control/workflow/upgrade-diagnostics.json',
  testResults: 'test-results/**'
} as const;

export const CI_ARTIFACT_MANIFEST_PATH = CI_ARTIFACT_FILES.artifactManifest;

export const CI_EXPLAIN_GRAPH_ARTIFACTS = [
  { id: 'explain-graph', path: CI_ARTIFACT_FILES.explainGraph },
  { id: 'explain-graph-mermaid', path: CI_ARTIFACT_FILES.explainGraphMermaid },
  { id: 'explain-graph-dot', path: CI_ARTIFACT_FILES.explainGraphDot }
] as const;

export const CI_EXPLAIN_GRAPH_ARTIFACT_PATHS: readonly string[] =
  CI_EXPLAIN_GRAPH_ARTIFACTS.map((artifact) => artifact.path);

export const CI_ARTIFACT_PATHS = {
  requiredGovernance: [
    CI_ARTIFACT_FILES.graphLock,
    CI_ARTIFACT_FILES.provenance,
    CI_ARTIFACT_FILES.installManifest,
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage,
    ...CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
    CI_ARTIFACT_FILES.reviewSummary
  ],
  optionalGovernance: [
    CI_ARTIFACT_FILES.repairPlan,
    CI_ARTIFACT_FILES.upgradePlan,
    CI_ARTIFACT_FILES.upgradeDiagnostics
  ],
  test: [
    CI_ARTIFACT_FILES.testResults
  ]
} as const;

export const CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS: readonly string[] = [
  CI_ARTIFACT_FILES.provenance,
  ...CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
  CI_ARTIFACT_FILES.reviewSummary
];

export const CI_EMIT_ARTIFACT_PATHS: readonly string[] = [
  ...CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS
];

export function normalizeCiArtifactPath(value: string): string {
  return posixPath(value);
}

export function uniqueSortedCiArtifactPaths(values: readonly string[]): string[] {
  return uniqueSorted(values.map(normalizeCiArtifactPath));
}

export function expandCiGeneratedArtifactPaths(values: readonly string[]): string[] {
  const paths = uniqueSortedCiArtifactPaths(values);
  const startsEmitBundle = paths.some((artifactPath) => CI_EXPLAIN_GRAPH_ARTIFACT_PATHS.includes(artifactPath));
  return startsEmitBundle
    ? uniqueSortedCiArtifactPaths([...paths, ...CI_EMIT_ARTIFACT_PATHS])
    : paths;
}

export function ciArtifactUploadName(artifactPath: string): string {
  return artifactPath.replaceAll('/', '__');
}

export function isCiContractArtifactPath(artifactPath: string): boolean {
  return artifactPath.startsWith('generated/') && artifactPath.endsWith('-contract.json');
}

export function ciArtifactKindForPath(artifactPath: string): CiArtifactKind {
  if (isCiContractArtifactPath(artifactPath)) {
    return 'contract';
  }
  if (artifactPath.startsWith('test-results/')) {
    return 'test';
  }
  return 'governance';
}

export function fixedCiArtifactPaths(): string[] {
  return [
    CI_ARTIFACT_MANIFEST_PATH,
    ...CI_ARTIFACT_PATHS.requiredGovernance,
    ...CI_ARTIFACT_PATHS.optionalGovernance,
    ...CI_ARTIFACT_PATHS.test
  ];
}

export function buildCiArtifactUploadGroups(
  entries: readonly Pick<CiArtifactEntry, 'kind' | 'path'>[]
): CiArtifactUploadGroup[] {
  return CI_ARTIFACT_KINDS
    .map((kind) => {
      const paths = entries
        .filter((entry) => entry.kind === kind)
        .map((entry) => entry.path);
      return {
        kind,
        count: paths.length,
        paths
      };
    })
    .filter((group) => group.count > 0);
}

export function emptyCiArtifactMissingReasonCounts(): CiArtifactSummary['missingReasonCounts'] {
  return Object.fromEntries(
    CI_ARTIFACT_MISSING_REASONS.map((reason) => [reason, 0])
  ) as CiArtifactSummary['missingReasonCounts'];
}

export function countCiArtifactMissingReasons(
  missing: readonly CiArtifactMissingEntry[]
): CiArtifactSummary['missingReasonCounts'] {
  const counts = emptyCiArtifactMissingReasonCounts();
  for (const entry of missing) {
    counts[entry.reason] += 1;
  }
  return counts;
}

export function countCiArtifactMissingReasonTypes(
  missingReasonCounts: CiArtifactSummary['missingReasonCounts']
): number {
  return countPositiveValues(Object.values(missingReasonCounts));
}

export function emptyCiArtifactManifest(): CiArtifactManifest {
  return {
    formatVersion: CI_ARTIFACT_FORMAT_VERSION,
    root: 'workspace',
    summary: {
      artifactStatus: 'passed',
      artifactCount: 0,
      governanceCount: 0,
      testCount: 0,
      contractCount: 0,
      contractPaths: [],
      uploadGroupCount: 0,
      missingCount: 0,
      missingReasonTypeCount: 0,
      missingReasonCounts: emptyCiArtifactMissingReasonCounts()
    },
    artifacts: [],
    uploadGroups: [],
    missing: []
  };
}

export function ciArtifactUploadCommand(kind: CiArtifactKind): string {
  return platformCommand('artifacts', '--paths', '--json', '--compact', '--kind', kind);
}
