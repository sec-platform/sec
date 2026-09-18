import type { ExplainGraph } from '../../semantics/projection/explain.ts';
import { uniqueSorted } from '../../contracts/canonical.ts';
import { countMatching } from '../../contracts/collections.ts';
import { buildCiArtifactUploadGroups, CI_ARTIFACT_MANIFEST_PATH } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactKind, CiArtifactManifest, CiArtifactUploadGroup } from '../../assurance/verification/ci-artifacts/contract/types.ts';
import { reviewArtifactMissingReasonTypeCount, reviewArtifactUploadGroupCount } from '../../assurance/verification/review/contract/artifact.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { upgradeDiagnosticsAttributionParts } from '../../assurance/verification/review/contract/upgrade.ts';
import { buildE2eMatrix, type E2eMatrix } from '../../assurance/verification/review/matrix.ts';
import { toWorkspaceArtifactPath } from "../../adapters/workspace-context.ts";
import { formatCounts, formatFields, formatList, formatMergedSummaryEntries, formatSummaryEntries } from '../../entry/cli/format-utils.ts';

type ArtifactPathUploadGroup = CiArtifactUploadGroup;

export type ArtifactPathKind = CiArtifactKind;

export type ArtifactUploadPathContract = {
  formatVersion: CiArtifactManifest['formatVersion'];
  root: CiArtifactManifest['root'];
  kind: ArtifactPathKind | 'all';
  artifactStatus: CiArtifactManifest['summary']['artifactStatus'];
  count: number;
  paths: string[];
  byKind: Partial<Record<ArtifactPathKind, number>>;
  uploadGroupCount: number;
  uploadGroups: ArtifactPathUploadGroup[];
  missingCount: number;
  missingReasonTypeCount: number;
  missingReasonCounts: CiArtifactManifest['summary']['missingReasonCounts'];
  missing: CiArtifactManifest['missing'];
};

function artifactUploadPathSummary(
  manifest: CiArtifactManifest,
  kind?: ArtifactPathKind
): {
  paths: string[];
  byKind: Partial<Record<ArtifactPathKind, number>>;
  uploadGroups: ArtifactPathUploadGroup[];
} {
  const contractPaths = new Set(
    manifest.summary.contractPaths.map((artifactPath) => toWorkspaceArtifactPath(artifactPath))
  );
  const artifacts = kind === 'contract'
    ? manifest.artifacts.filter((artifact) => contractPaths.has(toWorkspaceArtifactPath(artifact.path)))
    : kind
      ? manifest.artifacts.filter((artifact) => artifact.kind === kind)
      : manifest.artifacts;
  const includeManifest = kind === undefined || kind === 'governance';
  const entries = [
    ...(includeManifest
      ? [{ path: CI_ARTIFACT_MANIFEST_PATH, kind: 'governance' as const }]
      : []),
    ...artifacts.map((artifact) => ({
      path: toWorkspaceArtifactPath(artifact.path),
      kind: kind === 'contract' ? 'contract' as const : artifact.kind
    }))
  ];
  const kindByPath = new Map(entries.map((entry) => [entry.path, entry.kind]));
  const paths = uniqueSorted([...kindByPath.keys()]);
  const uploadEntries = paths.flatMap((path) => {
    const pathKind = kindByPath.get(path);
    return pathKind ? [{ path, kind: pathKind }] : [];
  });
  const byKind: Partial<Record<ArtifactPathKind, number>> = {};
  for (const entry of uploadEntries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  const uploadGroups = buildCiArtifactUploadGroups(uploadEntries);

  return { paths, byKind, uploadGroups };
}

export function buildArtifactUploadPathContract(
  manifest: CiArtifactManifest,
  kind?: ArtifactPathKind
): ArtifactUploadPathContract {
  const pathSummary = artifactUploadPathSummary(manifest, kind);
  return {
    formatVersion: manifest.formatVersion,
    root: manifest.root,
    kind: kind ?? 'all',
    artifactStatus: manifest.summary.artifactStatus,
    count: pathSummary.paths.length,
    paths: pathSummary.paths,
    byKind: pathSummary.byKind,
    uploadGroupCount: pathSummary.uploadGroups.length,
    uploadGroups: pathSummary.uploadGroups,
    missingCount: manifest.missing.length,
    missingReasonTypeCount: manifest.summary.missingReasonTypeCount,
    missingReasonCounts: manifest.summary.missingReasonCounts,
    missing: manifest.missing
  };
}

function formatE2eMatrixRow(row: E2eMatrix['rows'][number], prefix = ''): string {
  return formatFields([`${prefix}${row.stage}: ${row.status}`, row.detail, `evidence=${row.evidence.join(', ') || 'none'}`]);
}

function formatUpgradeDiagnosticsDetails(details: unknown): string {
  return formatList(upgradeDiagnosticsAttributionParts(details));
}

export function formatExplainSummary(graph: ExplainGraph, reviewSummary: ReviewSummary): string {
  const {
    artifactSummary,
    chainSummary,
    ciSummary,
    coverageSummary,
    installImpactSummary,
    provenanceSummary
  } = reviewSummary;
  const uncoveredBlocks = coverageSummary?.uncoveredBlockCount ?? countMatching(
    graph.overlays.coverage.blocks,
    (block) => block.coveredBy.length === 0
  );
  const blockCount = coverageSummary?.blockCount ?? graph.overlays.coverage.blocks.length;
  const e2eMatrix = buildE2eMatrix(reviewSummary);
  const lines = [
    `Explain graph ${graph.nodes.length} nodes ${graph.edges.length} edges`,
    `Node types: ${formatCounts(graph.nodes.map((node) => node.type))}`,
    `Edge types: ${formatCounts(graph.edges.map((edge) => edge.type))}`,
    formatFields([
      `Coverage: ${blockCount} blocks`,
      `uncovered blocks=${uncoveredBlocks}`
    ]),
    `Provenance origins: ${formatCounts(
      graph.overlays.provenance.map((artifact) => artifact.originType)
    )}`,
    formatFields([
      `CI status: ${ciSummary.status}`,
      `failures: ${ciSummary.failureCount}`,
      `regression risks: ${ciSummary.regressionRiskCount}`,
      `conflict hints: ${ciSummary.conflictHintCount}`
    ]),
    formatFields([
      `Chain: ${chainSummary.status}`,
      `stages: ${chainSummary.passedStageCount}/${chainSummary.stageCount}`,
      `attention: ${chainSummary.attentionStageCount}`,
      `failed: ${chainSummary.failedStageCount}`
    ]),
    ...e2eMatrix.rows.map((row) => formatE2eMatrixRow(row, 'E2E ')),
    [
      `Impacted: ${ciSummary.impactedBlockCount} blocks`,
      `${ciSummary.runtimeEntryCount} runtime entries`
    ].join(', ')
  ];

  if (coverageSummary) {
    lines.push(
      formatFields([
        `Coverage detail: ${coverageSummary.status}`,
        `acceptance passed: ${coverageSummary.acceptancePassedCount}`,
        `covered blocks: ${coverageSummary.coveredBlockCount}/${coverageSummary.blockCount}`
      ])
    );
  }

  lines.push(
    formatFields([
      `Install impact: ${installImpactSummary.impactCount} impacts`,
      `groups: ${installImpactSummary.groupCount}`,
      `actions: ${installImpactSummary.actionKinds.join(', ') || 'none'}`,
      `runtime entries: ${installImpactSummary.runtimeEntryCount}`,
      `targets: ${installImpactSummary.targetPathCount}`
    ])
  );

  if (provenanceSummary) {
    lines.push(
      formatFields([
        `Provenance detail: artifacts: ${provenanceSummary.artifactCount}`,
        `overrides: ${provenanceSummary.overrideArtifactCount}`,
        `registry: ${provenanceSummary.registryArtifactCount}`,
        `unverified: ${provenanceSummary.unverifiedArtifactCount}`
      ])
    );
  }

  if (artifactSummary) {
    const uploadGroups = artifactSummary.uploadGroups?.map(
      (group) => `${group.kind}=${group.count}`
    ) ?? [];
    lines.push(
      formatFields([
        `Artifacts: ${artifactSummary.artifactStatus ?? 'passed'}`,
        `total: ${artifactSummary.artifactCount}`,
        `missing: ${artifactSummary.missingCount}`,
        `missing reason types: ${reviewArtifactMissingReasonTypeCount(artifactSummary)}`,
        `contracts: ${artifactSummary.contractCount ?? 0}`,
        `upload groups: ${reviewArtifactUploadGroupCount(artifactSummary)}`
      ]),
      `Upload groups: ${formatList(uploadGroups)}`
    );
  }

  if (reviewSummary.policySummary) {
    const policy = reviewSummary.policySummary;
    lines.push(
      formatFields([
        `Policy: ${policy.status}`,
        `official: ${policy.officialPolicyCount}`,
        `project: ${policy.projectPolicyCount}`,
        `merged: ${policy.mergedPolicyCount}`,
        `violations: ${policy.violationCount}`
      ])
    );
  }

  if (reviewSummary.repairSummary) {
    const repair = reviewSummary.repairSummary;
    lines.push(
      formatFields([
        `Repair: ${repair.status}`,
        `tasks: ${repair.taskCount}`,
        `blockers: ${repair.blockerCount}`,
        `changed previews: ${repair.changedPreviewCount}`,
        `requires verification: ${repair.requiresVerification}`,
        `trace: ${repair.verificationTrace.pendingReason}->${repair.verificationTrace.nextAction}`,
        `categories: ${formatSummaryEntries(repair.taskCategorySummaries)}`,
        `issues: ${formatSummaryEntries(repair.failureTaxonomy.issueTypeSummaries)}`,
        `targets: ${formatMergedSummaryEntries(
          repair.targetSummaries.map((target) => ({
            id: target.targetType,
            count: target.count
          }))
        )}`,
        `repairability: ${formatSummaryEntries(repair.failureTaxonomy.repairabilitySummaries)}`
      ])
    );
  }

  if (reviewSummary.upgradeSummary) {
    const upgrade = reviewSummary.upgradeSummary;
    const versionRange = upgrade.fromVersion
      ? `${upgrade.fromVersion} -> ${upgrade.toVersion}`
      : `target ${upgrade.toVersion}`;
    lines.push(
      formatFields([
        `Upgrade: ${upgrade.status}`,
        `${upgrade.blockId} ${versionRange}`,
        `migrations: ${upgrade.migrationCount}`,
        `preflight checks: ${upgrade.preflightCheckCount}`,
        `preflight evidence: ${upgrade.preflightEvidenceCount}`,
        `impacts: ${upgrade.impactCount}`,
        `operations: ${upgrade.migrationOperationCount}`,
        `operation roles: ${formatMergedSummaryEntries(
          upgrade.migrationOperationSummaries.map((operation) => ({ id: operation.role, count: 1 }))
        )}`,
        `sources: ${upgrade.sourceMigrationCount}`,
        `requires verification: ${upgrade.requiresVerification}`,
        `verification: ${formatSummaryEntries(upgrade.verificationSummaries)}`
      ])
    );
    if (upgrade.diagnostics) {
      lines.push(
        formatFields([
          `Upgrade diagnostics: ${upgrade.diagnostics.phase}`,
          upgrade.diagnostics.failedCheck,
          upgrade.diagnostics.errorCode,
          upgrade.diagnostics.message,
          `attribution: ${formatUpgradeDiagnosticsDetails(upgrade.diagnostics.details)}`
        ])
      );
    }
  }

  return lines.join('\n');
}
