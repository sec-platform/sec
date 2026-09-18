import { isCanonicalPortableLogicalPath } from '../../../../contracts/logical-path.ts';
import { uniqueSorted } from '../../../../contracts/canonical.ts';
import { countPositiveValues } from '../../../../contracts/collections.ts';
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

/**
 * The artifact contract owns every publishable path below this root. A
 * workspace path resolver consumes this root; it does not copy the artifact
 * subpath table into another owner.
 */
export const CI_ARTIFACT_ROOT_RELATIVE_PATH = '.sec/artifacts' as const;

export const CI_ARTIFACT_FILES = {
  artifactManifest: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/ci/artifacts.json`,
  graphLock: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/state/graph.lock.json`,
  provenance: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/provenance/provenance.json`,
  blockUsageMap: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/evidence/block-usage-map.json`,
  installManifest: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/evidence/install-manifest.json`,
  verificationReport: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/evidence/verification-report.json`,
  runtimeReport: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/evidence/runtime-report.json`,
  policyReport: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/evidence/policy-report.json`,
  acceptanceCoverage: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/evidence/acceptance-coverage.json`,
  explainGraph: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/graph/explain-graph.json`,
  explainGraphMermaid: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/graph/explain-graph.mmd`,
  explainGraphDot: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/graph/explain-graph.dot`,
  reviewSummary: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/evidence/review-summary.json`,
  repairPlan: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/workflow/repair-plan.json`,
  upgradePlan: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/workflow/upgrade-plan.json`,
  upgradeExecutionTerminal: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/workflow/upgrade-execution-terminal.json`,
  upgradeDiagnostics: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/workflow/upgrade-diagnostics.json`,
  testResults: `${CI_ARTIFACT_ROOT_RELATIVE_PATH}/test-results/**`
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
    CI_ARTIFACT_FILES.upgradeExecutionTerminal,
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

function slashPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function normalizeCiArtifactPath(value: string): string {
  return slashPath(value);
}

export function isCiArtifactPath(artifactPath: string): boolean {
  return artifactPath === CI_ARTIFACT_ROOT_RELATIVE_PATH
    || artifactPath.startsWith(`${CI_ARTIFACT_ROOT_RELATIVE_PATH}/`);
}

/**
 * Sole lexical grammar for governed CI artifact identities. Workspace source
 * and generated output paths are different domains even when both are stored
 * in a compiler lock.
 */
export function isCanonicalCiArtifactPath(value: string): boolean {
  if (!isCiArtifactPath(value) || normalizeCiArtifactPath(value) !== value) return false;
  if (value.endsWith('/**')) {
    return isCanonicalPortableLogicalPath(value.slice(0, -3));
  }
  return isCanonicalPortableLogicalPath(value);
}

/** Validate the logical artifact identity without resolving or accessing a workspace. */
export function requireCanonicalCiArtifactPath(artifactPath: string): string {
  if (!isCanonicalCiArtifactPath(artifactPath)) {
    throw new Error(`Workspace artifact path "${artifactPath}" is not a canonical .sec/artifacts path`);
  }
  return artifactPath;
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
  return artifactPath.startsWith(`${CI_ARTIFACT_ROOT_RELATIVE_PATH}/generated/`)
    && artifactPath.endsWith('-contract.json');
}

export function ciArtifactKindForPath(artifactPath: string): CiArtifactKind {
  if (isCiContractArtifactPath(artifactPath)) {
    return 'contract';
  }
  if (artifactPath.startsWith(`${CI_ARTIFACT_ROOT_RELATIVE_PATH}/test-results/`)) {
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
