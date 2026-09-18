import type { ExplainSummaryView } from '../../application/explain-summary.ts';
import { formatFields, formatList, formatSummaryEntries } from './format-utils.ts';

function formatE2eMatrixRow(row: ExplainSummaryView['e2eMatrix']['rows'][number], prefix = ''): string {
  return formatFields([`${prefix}${row.stage}: ${row.status}`, row.detail, `evidence=${row.evidence.join(', ') || 'none'}`]);
}

export function formatExplainSummary(view: ExplainSummaryView): string {
  const {
    artifactSummary,
    graph,
    blockCount,
    uncoveredBlocks,
    e2eMatrix,
    chainSummary,
    ciSummary,
    coverageSummary,
    installImpactSummary,
    provenanceSummary
  } = view;
  const lines = [
    `Explain graph ${graph.nodeCount} nodes ${graph.edgeCount} edges`,
    `Node types: ${formatSummaryEntries(graph.nodeTypeCounts)}`,
    `Edge types: ${formatSummaryEntries(graph.edgeTypeCounts)}`,
    formatFields([
      `Coverage: ${blockCount} blocks`,
      `uncovered blocks=${uncoveredBlocks}`
    ]),
    `Provenance origins: ${formatSummaryEntries(graph.provenanceOriginCounts)}`,
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
    const uploadGroups = artifactSummary.uploadGroups.map(
      (group) => `${group.kind}=${group.count}`
    );
    lines.push(
      formatFields([
        `Artifacts: ${artifactSummary.artifactStatus}`,
        `total: ${artifactSummary.artifactCount}`,
        `missing: ${artifactSummary.missingCount}`,
        `missing reason types: ${artifactSummary.missingReasonTypeCount}`,
        `contracts: ${artifactSummary.contractCount}`,
        `upload groups: ${artifactSummary.uploadGroupCount}`
      ]),
      `Upload groups: ${formatList(uploadGroups)}`
    );
  }

  if (view.policySummary) {
    const policy = view.policySummary;
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

  if (view.repairSummary) {
    const repair = view.repairSummary;
    lines.push(
      formatFields([
        `Repair: ${repair.status}`,
        `tasks: ${repair.taskCount}`,
        `blockers: ${repair.blockerCount}`,
        `changed previews: ${repair.changedPreviewCount}`,
        `requires verification: ${repair.requiresVerification}`,
        `trace: ${repair.verificationTrace.pendingReason}->${repair.verificationTrace.nextAction}`,
        `categories: ${formatSummaryEntries(repair.taskCategorySummaries)}`,
        `issues: ${formatSummaryEntries(repair.issueTypeSummaries)}`,
        `targets: ${formatSummaryEntries(repair.targetSummaries)}`,
        `repairability: ${formatSummaryEntries(repair.repairabilitySummaries)}`
      ])
    );
  }

  if (view.upgradeSummary) {
    const upgrade = view.upgradeSummary;
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
        `operation roles: ${formatSummaryEntries(upgrade.operationRoleSummaries)}`,
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
          `attribution: ${formatList(upgrade.diagnostics.attribution)}`
        ])
      );
    }
  }

  return lines.join('\n');
}
