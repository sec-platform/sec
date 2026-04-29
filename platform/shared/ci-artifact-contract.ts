import type {
  CiArtifactEntry,
  CiArtifactKind,
  CiArtifactManifest,
  CiArtifactMissingEntry,
  CiArtifactMissingReason,
  CiArtifactSummary,
  CiArtifactUploadGroup
} from './ci-artifact-types.ts';

export const CI_ARTIFACT_KINDS = [
  'governance',
  'view',
  'test',
  'contract'
] as const satisfies readonly CiArtifactKind[];

export const CI_ARTIFACT_MANIFEST_PATH = 'control/ci/artifacts.json';

export const CI_ARTIFACT_PATHS = {
  requiredGovernance: [
    'control/state/graph.lock.json',
    'control/provenance/provenance.json',
    'control/evidence/install-manifest.json',
    'control/evidence/verification-report.json',
    'control/evidence/runtime-report.json',
    'control/evidence/policy-report.json',
    'control/evidence/acceptance-coverage.json',
    'control/graph/explain-graph.json',
    'control/evidence/review-summary.json'
  ],
  optionalGovernance: [
    'control/workflow/repair-plan.json',
    'control/workflow/upgrade-plan.json',
    'control/workflow/upgrade-diagnostics.json',
    'control/workflow/view-mutation-report.json'
  ],
  view: [
    'control/workbench/views/source-view.html',
    'control/workbench/views/slot-rule-view.html'
  ],
  test: [
    'test-results/**'
  ]
} as const;

export const CI_ARTIFACT_MISSING_REASONS = [
  'declared-generated-missing',
  'fixed-governance-missing',
  'fixed-view-missing'
] as const satisfies readonly CiArtifactMissingReason[];

export function normalizeCiArtifactPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function uniqueSortedCiArtifactPaths(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeCiArtifactPath))].sort((left, right) => left.localeCompare(right));
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
  if (artifactPath.startsWith('control/workbench/views/') || artifactPath.startsWith('generated/views/')) {
    return 'view';
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
    ...CI_ARTIFACT_PATHS.view,
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
  return Object.values(missingReasonCounts).filter((count) => count > 0).length;
}

export function emptyCiArtifactManifest(): CiArtifactManifest {
  return {
    formatVersion: '1',
    root: 'workspace',
    summary: {
      artifactStatus: 'passed',
      artifactCount: 0,
      governanceCount: 0,
      viewCount: 0,
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
  return `npm run platform -- artifacts --paths --json --compact --kind ${kind}`;
}
