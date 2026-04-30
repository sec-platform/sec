import fs from 'node:fs/promises';
import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { CI_ARTIFACT_PATHS } from '../../shared/ci-artifact-contract.ts';
import { countMatching, countPositiveValues, summarizeCounts, uniqueSorted } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { ExplainGraph } from '../../shared/explain-types.ts';
import { ensureDir, pathExists, readJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeLockWithGeneratedPaths } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';
import type { RepairPlan } from '../../shared/repair-types.ts';
import { buildE2eMatrix } from '../../shared/review-matrix.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';
import { buildReviewUpgradePreflightSummaries } from '../../shared/review-upgrade.ts';
import type {
  UpgradeDiagnostics,
  UpgradeMigrationOperation,
  UpgradeMigrationSummary,
  UpgradePlan
} from '../../shared/upgrade-types.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import { buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath } from './runtime-attribution.ts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatList(values: Iterable<string>, fallback = 'none'): string {
  const items = uniqueSorted([...values]);
  return items.length > 0 ? items.join(', ') : fallback;
}

function renderJsonCard(title: string, value: unknown): string {
  return `<section class="card"><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></section>`;
}

function renderJsonPre(value: unknown): string {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function joinSections(sections: string[]): string {
  return sections.filter((section) => section.length > 0).join('\n');
}

type TableRowFormat = 'compact' | 'multiline';

function renderTableRows<T>(
  values: readonly T[],
  cells: (value: T) => readonly string[],
  format: TableRowFormat = 'compact'
): string {
  return values
    .map((value) => {
      const rowCells = cells(value);
      if (format === 'multiline') {
        return `<tr>\n${rowCells.map((cell) => `          <td>${escapeHtml(cell)}</td>`).join('\n')}\n        </tr>`;
      }
      return `<tr>${rowCells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`;
    })
    .join('');
}

type MetricRow = readonly [label: string, value: string];

function renderMetricRows(rows: readonly MetricRow[]): string {
  return renderTableRows(rows, ([label, value]) => [label, value]);
}

function renderE2eChainSummarySection(review: ReviewSummary): string {
  const chainRows = renderTableRows(buildE2eMatrix(review).rows, (stage) => [
    stage.stage,
    stage.status,
    stage.detail,
    stage.evidence.join(', ') || 'none'
  ]);

  return `<h3>E2E Chain Summary</h3>
        <table>
          <thead><tr><th>Stage</th><th>Status</th><th>Detail</th><th>Evidence</th></tr></thead>
          <tbody>${chainRows}</tbody>
        </table>`;
}

function renderCiSummaryCard(review: ReviewSummary): string {
  const missingReasonTypeCount = review.artifactSummary
    ? review.artifactSummary.missingReasonTypeCount
      ?? countPositiveValues(Object.values(review.artifactSummary.missingReasonCounts ?? {}))
    : 0;
  const artifactRows: MetricRow[] = review.artifactSummary
    ? [
        ['Artifact Status', review.artifactSummary.artifactStatus ?? 'passed'],
        ['Artifacts', String(review.artifactSummary.artifactCount)],
        ['Governance Artifacts', String(review.artifactSummary.governanceCount)],
        ['View Artifacts', String(review.artifactSummary.viewCount)],
        ['Test Artifacts', String(review.artifactSummary.testCount ?? 0)],
        ['Contract Artifacts', String(review.artifactSummary.contractCount ?? 0)],
        ['Contract Paths', review.artifactSummary.contractPaths?.join(', ') || 'none'],
        [
          'Upload Groups',
          String(review.artifactSummary.uploadGroupCount ?? review.artifactSummary.uploadGroups?.length ?? 0)
        ],
        ['Missing Artifacts', String(review.artifactSummary.missingCount)],
        ['Missing Reason Types', String(missingReasonTypeCount)]
      ]
    : [];
  const rows = renderMetricRows([
    ['Status', review.ciSummary.status],
    ['Failures', String(review.ciSummary.failureCount)],
    ['Regression Risks', String(review.ciSummary.regressionRiskCount)],
    ['Conflict Hints', String(review.ciSummary.conflictHintCount)],
    ['Impacted Blocks', String(review.ciSummary.impactedBlockCount)],
    ['Impacted Slots', String(review.ciSummary.impactedSlotCount)],
    ['Runtime Entries', String(review.ciSummary.runtimeEntryCount)],
    ['Chain Status', review.chainSummary.status],
    ['Chain Stages', `${review.chainSummary.passedStageCount}/${review.chainSummary.stageCount}`],
    ['Chain Attention Stages', String(review.chainSummary.attentionStageCount)],
    ['Chain Failed Stages', String(review.chainSummary.failedStageCount)],
    ...artifactRows
  ]);
  const missingReasonRows = review.artifactSummary?.missingReasonCounts
    ? renderTableRows(
        Object.entries(review.artifactSummary.missingReasonCounts).filter(([, count]) => count > 0),
        ([reason, count]) => [reason, String(count)]
      )
    : '';
  const missingReasonTable = missingReasonRows
    ? `<h3>Missing Reason Summary</h3>
        <table>
          <thead><tr><th>Reason</th><th>Count</th></tr></thead>
          <tbody>${missingReasonRows}</tbody>
        </table>`
    : '';
  const uploadGroupRows = review.artifactSummary?.uploadGroups?.length
    ? renderTableRows(review.artifactSummary.uploadGroups, (group) => [
        group.kind,
        String(group.count),
        group.paths.join(', ')
      ])
    : '';
  const uploadGroupTable = uploadGroupRows
    ? `<h3>Artifact Upload Groups</h3>
        <table>
          <thead><tr><th>Kind</th><th>Count</th><th>Paths</th></tr></thead>
          <tbody>${uploadGroupRows}</tbody>
        </table>`
    : '';
  const missingRows = review.artifactSummary?.missing?.length
    ? renderTableRows(review.artifactSummary.missing, (entry) => [entry.path, entry.reason, entry.declaredBy])
    : '';
  const missingTable = missingRows
    ? `<h3>Missing Artifact Diagnostics</h3>
        <table>
          <thead><tr><th>Path</th><th>Reason</th><th>Declared By</th></tr></thead>
          <tbody>${missingRows}</tbody>
        </table>`
    : '';

  return `<section class="card">
        <h2>CI Summary</h2>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${joinSections([renderE2eChainSummarySection(review), missingReasonTable, uploadGroupTable, missingTable])}
      </section>`;
}

function renderRuntimeEntriesTable(lock: LockFile): string {
  const entries: Array<{ path: string; kind: NonNullable<ReturnType<typeof classifyRuntimeEntry>> }> = [];
  for (const generatedPath of lock.generatedPaths) {
    const kind = classifyRuntimeEntry(generatedPath);
    if (!kind) {
      continue;
    }
    entries.push({ path: generatedPath, kind });
  }
  const rows = renderTableRows(entries, (entry) => [entry.kind, entry.path]);

  return `<section class="card">
        <h2>Runtime Entry Points</h2>
        <table>
          <thead><tr><th>Kind</th><th>Path</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="2">No generated runtime entries.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderVerticalSummaryCard(lock: LockFile, review: ReviewSummary): string {
  const riskMap = new Map<string, string[]>();

  for (const risk of review.regressionRisks) {
    const vertical = detectVerticalFromPath(risk.blockId ?? '') ?? detectVerticalFromPath(risk.message);
    if (!vertical) {
      continue;
    }
    riskMap.set(vertical, uniqueSorted([...(riskMap.get(vertical) ?? []), risk.message]));
  }

  const fallbackSlices = new Map<string, { runtimeEntries: Set<string>; relatedBlocks: Set<string> }>();
  for (const entry of buildRuntimeAttributions(lock, lock.generatedPaths)) {
    if (!entry.vertical) {
      continue;
    }
    let slice = fallbackSlices.get(entry.vertical);
    if (!slice) {
      slice = { runtimeEntries: new Set<string>(), relatedBlocks: new Set<string>() };
      fallbackSlices.set(entry.vertical, slice);
    }
    slice.runtimeEntries.add(entry.path);
    for (const blockId of entry.relatedBlocks) {
      slice.relatedBlocks.add(blockId);
    }
  }

  const sliceIds = new Set<string>([
    ...review.verticalSlices.map((slice) => slice.id),
    ...fallbackSlices.keys(),
    ...riskMap.keys()
  ]);

  const rows = renderTableRows(uniqueSorted([...sliceIds]), (vertical) => {
    const summary = review.verticalSlices.find((slice) => slice.id === vertical);
    const fallback = fallbackSlices.get(vertical);
    const blocks = summary?.relatedBlocks ?? uniqueSorted([...(fallback?.relatedBlocks ?? [])]);
    const runtimeEntries = summary?.runtimeEntries ?? uniqueSorted([...(fallback?.runtimeEntries ?? [])]);
    const risks = riskMap.get(vertical) ?? [];
    return [
      vertical,
      blocks.join(', ') || 'none',
      runtimeEntries.join(', ') || 'none',
      risks.join(' | ') || 'none'
    ];
  });

  return `<section class="card">
        <h2>Vertical Summary</h2>
        <table>
          <thead><tr><th>Vertical</th><th>Blocks</th><th>Runtime Entries</th><th>Regression Risks</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No vertical summaries.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderBlockCombinationCard(lock: LockFile, review: ReviewSummary): string {
  const impactByBlock = new Map(review.installImpacts.map((impact) => [impact.blockId, impact]));
  const rows = renderTableRows(
    lock.resolvedBlocks
      .slice()
      .sort((left, right) => left.installOrder - right.installOrder || left.id.localeCompare(right.id)),
    (block) => {
      const installs = countMatching(lock.installPlan, (step) => step.blockId === block.id);
      const impact = impactByBlock.get(block.id);
      return [
        block.id,
        block.kind,
        String(block.installOrder),
        String(installs),
        impact?.verticals.join(', ') || 'none',
        impact?.runtimeEntries.join(', ') || 'none'
      ];
    }
  );

  return `<section class="card">
        <h2>Block Combination Summary</h2>
        <table>
          <thead><tr><th>Block</th><th>Kind</th><th>Install Order</th><th>Install Steps</th><th>Verticals</th><th>Runtime Entries</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No blocks installed.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderFailureFocusCard(review: ReviewSummary): string {
  const failureGroups = new Map<string, { lane: string; kind: string; count: number; artifacts: Set<string> }>();
  for (const failure of review.failurePoints) {
    const key = `${failure.lane}:${failure.kind}`;
    let group = failureGroups.get(key);
    if (!group) {
      group = {
        lane: failure.lane,
        kind: failure.kind,
        count: 0,
        artifacts: new Set<string>()
      };
      failureGroups.set(key, group);
    }
    group.count += 1;
    group.artifacts.add(failure.artifactPath);
  }

  const groupRows = renderTableRows(
    [...failureGroups.values()].sort(
      (left, right) => left.lane.localeCompare(right.lane) || left.kind.localeCompare(right.kind)
    ),
    (group) => [group.lane, group.kind, String(group.count), formatList(group.artifacts, '')],
    'multiline'
  );
  const rows = renderTableRows(review.failurePoints, (failure) => [
    failure.lane,
    failure.kind,
    failure.artifactPath,
    failure.message
  ]);

  return `<section class="card">
        <h2>Failure Focus</h2>
        <h3>Failure Groups</h3>
        <table>
          <thead><tr><th>Lane</th><th>Kind</th><th>Count</th><th>Artifacts</th></tr></thead>
          <tbody>${groupRows || '<tr><td colspan="4">No failure groups.</td></tr>'}</tbody>
        </table>
        <h3>Failure Details</h3>
        <table>
          <thead><tr><th>Lane</th><th>Kind</th><th>Artifact</th><th>Message</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No failure points.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderReviewRuntimeAttributionCard(review: ReviewSummary): string {
  const runtimeGroups = new Map<string, { vertical: string; kind: string; count: number; relatedBlocks: Set<string> }>();
  for (const entry of review.runtimeEntries) {
    const vertical = entry.vertical ?? 'none';
    const key = `${vertical}:${entry.kind}`;
    let group = runtimeGroups.get(key);
    if (!group) {
      group = {
        vertical,
        kind: entry.kind,
        count: 0,
        relatedBlocks: new Set<string>()
      };
      runtimeGroups.set(key, group);
    }
    group.count += 1;
    for (const blockId of entry.relatedBlocks) {
      group.relatedBlocks.add(blockId);
    }
  }

  const groupRows = renderTableRows(
    [...runtimeGroups.values()].sort(
      (left, right) => left.vertical.localeCompare(right.vertical) || left.kind.localeCompare(right.kind)
    ),
    (group) => [group.vertical, group.kind, String(group.count), formatList(group.relatedBlocks)],
    'multiline'
  );
  const rows = renderTableRows(review.runtimeEntries, (entry) => [
    entry.kind,
    entry.vertical ?? 'none',
    entry.path,
    entry.relatedBlocks.join(', ') || 'none'
  ]);

  return `<section class="card">
        <h2>Review Runtime Attribution</h2>
        <h3>Runtime Groups</h3>
        <table>
          <thead><tr><th>Vertical</th><th>Kind</th><th>Count</th><th>Related Blocks</th></tr></thead>
          <tbody>${groupRows || '<tr><td colspan="4">No runtime groups in review summary.</td></tr>'}</tbody>
        </table>
        <h3>Runtime Entries</h3>
        <table>
          <thead><tr><th>Kind</th><th>Vertical</th><th>Path</th><th>Related Blocks</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No runtime entries in review summary.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderInstallImpactCard(review: ReviewSummary): string {
  const summaryRows = renderMetricRows([
    ['Impacts', String(review.installImpactSummary.impactCount)],
    ['Blocks', String(review.installImpactSummary.blockCount)],
    ['Action Kinds', String(review.installImpactSummary.actionKindCount)],
    ['Source Roots', String(review.installImpactSummary.sourceRootCount)],
    ['Target Paths', String(review.installImpactSummary.targetPathCount)],
    ['Verticals', String(review.installImpactSummary.verticalCount)],
    ['Runtime Entries', String(review.installImpactSummary.runtimeEntryCount)],
    ['Groups', String(review.installImpactSummary.groupCount)]
  ]);
  const groupRows = renderTableRows(
    review.installImpactSummary.groupSummaries,
    (group) => [
      group.vertical,
      String(group.blockCount),
      formatList(group.actionKinds),
      formatList(group.runtimeEntries),
      formatList(group.targetPaths)
    ],
    'multiline'
  );
  const rows = renderTableRows(review.installImpacts, (impact) => [
    impact.blockId,
    impact.actionKinds.join(', ') || 'none',
    impact.sourceRoots.join(', ') || 'none',
    impact.verticals.join(', ') || 'none',
    impact.runtimeEntries.join(', ') || 'none',
    impact.targetPaths.join(', ') || 'none'
  ]);

  return `<section class="card">
        <h2>Install Impact Summary</h2>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>${summaryRows}</tbody>
        </table>
        <h3>Impact Groups</h3>
        <table>
          <thead><tr><th>Vertical</th><th>Blocks</th><th>Actions</th><th>Runtime Entries</th><th>Targets</th></tr></thead>
          <tbody>${groupRows || '<tr><td colspan="5">No install impact groups in review summary.</td></tr>'}</tbody>
        </table>
        <h3>Impact Details</h3>
        <table>
          <thead><tr><th>Block</th><th>Actions</th><th>Sources</th><th>Verticals</th><th>Runtime Entries</th><th>Targets</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6">No install impacts in review summary.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderViewNav(current: 'source' | 'slot-rule'): string {
  const links = [
    { id: 'source', href: 'source-view.html', label: 'Source View' },
    { id: 'slot-rule', href: 'slot-rule-view.html', label: 'Slot / Rule View' }
  ];
  return `<nav class="view-nav">${links.map((link) => `<a href="${link.href}"${link.id === current ? ' aria-current="page"' : ''}>${escapeHtml(link.label)}</a>`).join('')}</nav>`;
}

async function readRequiredArtifact<T>(filePath: string, label: string): Promise<T> {
  if (!(await pathExists(filePath))) {
    throw new CompilerError('EXPLAIN-BLOCKED-003', `${label} is missing`);
  }

  return readJson<T>(filePath);
}

function renderPolicySourcesTable(policyReport: PolicyReport): string {
  const rows = renderTableRows(
    [...policyReport.official.sources, ...policyReport.project.sources],
    (source) => [source.path, source.policyIds.join(', ') || 'none']
  );

  return `<section class="card">
        <h2>Policy Sources</h2>
        <table>
          <thead><tr><th>Path</th><th>Policy IDs</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

function renderMergedPoliciesTable(policyReport: PolicyReport): string {
  const rows = renderTableRows(policyReport.merged.policies, (policy) => [
    policy.id,
    policy.sourceScope,
    policy.sourcePath
  ]);

  return `<section class="card">
        <h2>Merged Policies</h2>
        <table>
          <thead><tr><th>Policy</th><th>Scope</th><th>Source</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

function renderPolicyViolationsTable(policyReport: PolicyReport): string {
  const rows = renderTableRows(policyReport.violations, (violation) => [
    violation.id,
    violation.severity,
    violation.sourceScope,
    violation.sourcePath,
    violation.message
  ]);

  return `<section class="card">
        <h2>Policy Violations</h2>
        <table>
          <thead><tr><th>ID</th><th>Severity</th><th>Scope</th><th>Source</th><th>Message</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

function renderProvenanceSummaryCard(review: ReviewSummary): string {
  const provenance = review.provenanceSummary;
  if (!provenance) {
    return '';
  }

  const rows = renderMetricRows([
    ['Artifacts', String(provenance.artifactCount)],
    ['Verified Artifacts', String(provenance.verifiedArtifactCount)],
    ['Unverified Artifacts', String(provenance.unverifiedArtifactCount)],
    ['Override Artifacts', String(provenance.overrideArtifactCount)],
    ['Registry Artifacts', String(provenance.registryArtifactCount)],
    ['Generated Artifacts', String(provenance.generatedArtifactCount)],
    ['Generated Passes', String(provenance.generatedPassCount)]
  ]);
  const originRows = renderTableRows(provenance.originSummaries, (origin) => [
    origin.originType,
    String(origin.count),
    origin.paths.join(', ') || 'none'
  ]);
  const overrideRows = renderTableRows(provenance.overrideSummaries, (override) => [
    override.overrideStatus,
    String(override.count),
    override.paths.join(', ') || 'none'
  ]);
  const registryRows = renderTableRows(provenance.registrySummaries, (registry) => [
    registry.registrySourceId,
    registry.registryKind ?? 'unknown',
    registry.registryLocation ?? 'unknown',
    String(registry.count),
    registry.paths.join(', ') || 'none'
  ]);
  const generatedPassRows = renderTableRows(provenance.generatedPassSummaries, (summary) => [
    summary.pass,
    String(summary.count),
    summary.paths.join(', ') || 'none'
  ]);

  return `<section class="card">
        <h2>Provenance Summary</h2>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <h3>Provenance Origin Summary</h3>
        <table>
          <thead><tr><th>Origin</th><th>Count</th><th>Paths</th></tr></thead>
          <tbody>${originRows || '<tr><td colspan="3">No provenance origins.</td></tr>'}</tbody>
        </table>
        <h3>Provenance Override Summary</h3>
        <table>
          <thead><tr><th>Status</th><th>Count</th><th>Paths</th></tr></thead>
          <tbody>${overrideRows || '<tr><td colspan="3">No overrides.</td></tr>'}</tbody>
        </table>
        <h3>Provenance Registry Summary</h3>
        <table>
          <thead><tr><th>Source</th><th>Kind</th><th>Location</th><th>Count</th><th>Paths</th></tr></thead>
          <tbody>${registryRows || '<tr><td colspan="5">No registry provenance.</td></tr>'}</tbody>
        </table>
        <h3>Provenance Generated Pass Summary</h3>
        <table>
          <thead><tr><th>Pass</th><th>Count</th><th>Paths</th></tr></thead>
          <tbody>${generatedPassRows || '<tr><td colspan="3">No generated pass provenance.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderCoverageSummaryCard(review: ReviewSummary): string {
  const coverage = review.coverageSummary;
  if (!coverage) {
    return '';
  }

  const rows = renderMetricRows([
    ['Status', coverage.status],
    ['Acceptance Passed', String(coverage.acceptancePassedCount)],
    ['Blocks', String(coverage.blockCount)],
    ['Covered Blocks', String(coverage.coveredBlockCount)],
    ['Uncovered Blocks', String(coverage.uncoveredBlockCount)],
    ['Slots', String(coverage.slotCount)],
    ['Covered Slots', String(coverage.coveredSlotCount)],
    ['Uncovered Slots', String(coverage.uncoveredSlotCount)]
  ]);
  const blockRows = renderTableRows(coverage.blockSummaries, (block) => [
    block.id,
    String(block.declaredAcceptanceCount),
    String(block.coveredByCount),
    block.coveredBy.join(', ') || 'none'
  ]);
  const slotRows = renderTableRows(coverage.slotSummaries, (slot) => [
    slot.id,
    String(slot.declaredAcceptanceCount),
    String(slot.coveredByCount),
    slot.coveredBy.join(', ') || 'none'
  ]);

  return `<section class="card">
        <h2>Acceptance Coverage Summary</h2>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <h3>Block Coverage Summary</h3>
        <table>
          <thead><tr><th>Block</th><th>Declared Acceptance</th><th>Covered By</th><th>Acceptance IDs</th></tr></thead>
          <tbody>${blockRows || '<tr><td colspan="4">No block coverage.</td></tr>'}</tbody>
        </table>
        <h3>Slot Coverage Summary</h3>
        <table>
          <thead><tr><th>Slot</th><th>Declared Acceptance</th><th>Covered By</th><th>Acceptance IDs</th></tr></thead>
          <tbody>${slotRows || '<tr><td colspan="4">No slot coverage.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderPolicySummaryCard(review: ReviewSummary): string {
  const policy = review.policySummary;
  if (!policy) {
    return '';
  }

  const rows = renderMetricRows([
    ['Status', policy.status],
    ['Official Policies', String(policy.officialPolicyCount)],
    ['Project Policies', String(policy.projectPolicyCount)],
    ['Merged Policies', String(policy.mergedPolicyCount)],
    ['Policy Sources', String(policy.sourceCount)],
    ['Violations', String(policy.violationCount)]
  ]);
  const severityRows = renderTableRows(
    Object.entries(policy.severityCounts).sort(([left], [right]) => left.localeCompare(right)),
    ([severity, count]) => [severity, String(count)]
  );
  const sourceRows = renderTableRows(policy.sourceSummaries, (source) => [
    source.scope,
    source.path,
    source.policyIds.join(', ') || 'none'
  ]);
  const mergedRows = renderTableRows(policy.mergedSummaries, (merged) => [
    merged.id,
    merged.sourceScope,
    String(merged.targetCount),
    merged.targets.join(', ') || 'none'
  ]);
  const violationRows = renderTableRows(policy.violationSummaries, (violation) => [
    violation.id,
    violation.severity,
    String(violation.fileCount),
    violation.files.join(', ') || 'none',
    violation.message
  ]);

  return `<section class="card">
        <h2>Policy Summary</h2>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <h3>Policy Severity Summary</h3>
        <table>
          <thead><tr><th>Severity</th><th>Count</th></tr></thead>
          <tbody>${severityRows || '<tr><td colspan="2">No policy violations.</td></tr>'}</tbody>
        </table>
        <h3>Policy Source Summary</h3>
        <table>
          <thead><tr><th>Scope</th><th>Path</th><th>Policy IDs</th></tr></thead>
          <tbody>${sourceRows || '<tr><td colspan="3">No policy sources.</td></tr>'}</tbody>
        </table>
        <h3>Policy Merge Summary</h3>
        <table>
          <thead><tr><th>Policy</th><th>Scope</th><th>Targets</th><th>Target Paths</th></tr></thead>
          <tbody>${mergedRows || '<tr><td colspan="4">No merged policies.</td></tr>'}</tbody>
        </table>
        <h3>Policy Violation Summary</h3>
        <table>
          <thead><tr><th>Policy</th><th>Severity</th><th>Files</th><th>File Paths</th><th>Message</th></tr></thead>
          <tbody>${violationRows || '<tr><td colspan="5">No policy violations.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderUpgradeSummaryCard(review: ReviewSummary): string {
  const upgrade = review.upgradeSummary;
  if (!upgrade) {
    return '';
  }

  const rows = renderMetricRows([
    ['Status', upgrade.status],
    ['Block', upgrade.blockId],
    ['From Version', upgrade.fromVersion ?? 'unknown'],
    ['To Version', upgrade.toVersion],
    ['Preflight Checks', String(upgrade.preflightCheckCount)],
    ['Preflight Evidence', String(upgrade.preflightEvidenceCount)],
    ['Migrations', String(upgrade.migrationCount)],
    ['Source Migrations', String(upgrade.sourceMigrationCount)],
    ['Slot Migrations', String(upgrade.slotMigrationCount)],
    ['Operations', String(upgrade.migrationOperationCount)],
    ['Impacts', String(upgrade.impactCount)],
    ['Requires Verification', String(upgrade.requiresVerification)],
    ['Verification Migrations', String(upgrade.requiresVerificationCount)]
  ]);
  const preflightRows = renderUpgradePreflightSummaryRows(upgrade.preflightSummaries);
  const kindRows = renderCountRecordRows(upgrade.migrationKindCounts);
  const operationRoleRows = renderUpgradeOperationRoleRows(upgrade.migrationOperationSummaries);
  const verificationRows = renderTaxonomyRows(upgrade.verificationSummaries);
  const migrationRows = renderUpgradeMigrationRows(upgrade.migrationSummaries);
  const operationRows = renderUpgradeOperationRows(upgrade.migrationOperationSummaries);
  const diagnosticsRows = upgrade.diagnostics
    ? `<tr>
          <td>${escapeHtml(upgrade.diagnostics.phase ?? 'planning')}</td>
          <td>${escapeHtml(upgrade.diagnostics.failedCheck)}</td>
          <td>${escapeHtml(upgrade.diagnostics.errorCode)}</td>
          <td>${escapeHtml(upgrade.diagnostics.message)}</td>
          <td>${upgrade.diagnostics.details === undefined ? 'none' : renderJsonPre(upgrade.diagnostics.details)}</td>
        </tr>`
    : '';

  return `<section class="card">
        <h2>Upgrade Summary</h2>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <h3>Upgrade Preflight Summary</h3>
        <table>
          <thead><tr><th>Group</th><th>Checks</th><th>Evidence Items</th></tr></thead>
          <tbody>${preflightRows || '<tr><td colspan="3">No upgrade preflight checks.</td></tr>'}</tbody>
        </table>
        <h3>Upgrade Migration Kind Summary</h3>
        <table>
          <thead><tr><th>Kind</th><th>Count</th></tr></thead>
          <tbody>${kindRows || '<tr><td colspan="2">No upgrade migration kinds.</td></tr>'}</tbody>
        </table>
        <h3>Upgrade Operation Role Summary</h3>
        <table>
          <thead><tr><th>Role</th><th>Count</th></tr></thead>
          <tbody>${operationRoleRows || '<tr><td colspan="2">No upgrade operation roles.</td></tr>'}</tbody>
        </table>
        <h3>Upgrade Verification Summary</h3>
        <table>
          <thead><tr><th>Verification</th><th>Count</th></tr></thead>
          <tbody>${verificationRows || '<tr><td colspan="2">No upgrade verification categories.</td></tr>'}</tbody>
        </table>
        <h3>Upgrade Migration Summary</h3>
        <table>
          <thead><tr><th>ID</th><th>Kind</th><th>Source</th><th>Target</th><th>Slot</th><th>Requires Verification</th><th>Reason</th></tr></thead>
          <tbody>${migrationRows || '<tr><td colspan="7">No upgrade migrations.</td></tr>'}</tbody>
        </table>
        <h3>Upgrade Migration Operation Summary</h3>
        <table>
          <thead><tr><th>ID</th><th>Kind</th><th>Role</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>${operationRows || '<tr><td colspan="5">No upgrade migration operations.</td></tr>'}</tbody>
        </table>
        ${diagnosticsRows
          ? `<h3>Upgrade Blocker Summary</h3>
            <table>
              <thead><tr><th>Phase</th><th>Failed Check</th><th>Error</th><th>Message</th><th>Details</th></tr></thead>
              <tbody>${diagnosticsRows}</tbody>
            </table>`
          : ''}
      </section>`;
}

function renderTaxonomyRows(entries: Array<{ id: string; count: number }>): string {
  return renderTableRows(entries, (entry) => [entry.id, String(entry.count)]);
}

function renderCountRecordRows(counts: Record<string, number>): string {
  return renderTaxonomyRows(
    Object.entries(counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, count]) => ({ id, count }))
  );
}

function renderUpgradePreflightSummaryRows(summaries: ReturnType<typeof buildReviewUpgradePreflightSummaries>): string {
  return renderTableRows(summaries, (summary) => [
    summary.group,
    String(summary.checkCount),
    String(summary.evidenceCount)
  ]);
}

function renderUpgradeMigrationRows(migrations: readonly UpgradeMigrationSummary[]): string {
  return renderTableRows(migrations, (migration) => [
    migration.id,
    migration.kind,
    migration.source ?? 'none',
    migration.target,
    migration.slotId ?? 'none',
    String(migration.requiresVerification),
    migration.reason
  ]);
}

function renderUpgradeOperationRoleRows(operations: UpgradeMigrationOperation[]): string {
  return renderTaxonomyRows(summarizeCounts(operations.map((operation) => operation.role)));
}

function upgradeOperationDetails(operation: UpgradeMigrationOperation): string {
  return [
    operation.source ? `source=${operation.source}` : '',
    operation.slotId ? `slot=${operation.slotId}` : '',
    operation.inputType ? `input=${operation.inputType}` : '',
    operation.outputType ? `output=${operation.outputType}` : '',
    operation.writableZones ? `writable=${operation.writableZones.join(', ')}` : '',
    operation.path ? `path=${operation.path.join('.')}` : '',
    operation.updateCount === undefined ? '' : `updates=${operation.updateCount}`,
    operation.itemCount === undefined ? '' : `items=${operation.itemCount}`,
    operation.valueKeyCount === undefined ? '' : `valueKeys=${operation.valueKeyCount}`,
    operation.contentLength === undefined ? '' : `contentLength=${operation.contentLength}`,
    operation.searchLength === undefined ? '' : `searchLength=${operation.searchLength}`,
    operation.replacementLength === undefined ? '' : `replacementLength=${operation.replacementLength}`,
    operation.pattern ? `pattern=${operation.pattern}` : '',
    operation.flags ? `flags=${operation.flags}` : ''
  ].filter((detail) => detail.length > 0).join('; ') || 'none';
}

function renderUpgradeOperationRows(operations: UpgradeMigrationOperation[]): string {
  return renderTableRows(operations, (operation) => [
    operation.id,
    operation.kind,
    operation.role,
    operation.target,
    upgradeOperationDetails(operation)
  ]);
}

function renderRepairSummaryCard(review: ReviewSummary): string {
  const repair = review.repairSummary;
  if (!repair) {
    return '';
  }

  const rows = renderMetricRows([
    ['Status', repair.status],
    ['Source Verification', repair.sourceVerificationStatus],
    ['Requires Verification', String(repair.requiresVerification)],
    ['Tasks', String(repair.taskCount)],
    ['Blockers', String(repair.blockerCount)],
    ['Previews', String(repair.previewCount)],
    ['Changed Previews', String(repair.changedPreviewCount)],
    ['Failure Points', String(repair.failurePointCount)],
    ['Trace Pending Reason', repair.verificationTrace.pendingReason],
    ['Trace Next Action', repair.verificationTrace.nextAction],
    ['Target Files', repair.targetFiles.join(', ') || 'none']
  ]);
  const categoryRows = renderTaxonomyRows(repair.taskCategorySummaries);
  const targetRows = renderTableRows(repair.targetSummaries, (target) => [
    target.targetType,
    target.id,
    String(target.count)
  ]);
  const taskRows = renderTableRows(repair.taskSummaries, (task) => [
    task.taskId,
    task.category,
    task.previewStatus,
    `${task.addedLines}/-${task.removedLines}`,
    String(task.failurePointCount),
    task.writeBounds.join(', ') || 'none',
    task.requiredSymbols.join(', ') || 'none',
    task.testsToPass.join(', ') || 'none',
    task.failureTargets.join(', ') || 'none'
  ]);
  const blockerRows = renderTableRows(repair.blockerSummaries, (blocker) => [
    blocker.blockerId,
    blocker.boundary,
    String(blocker.failurePointCount),
    blocker.reason
  ]);
  const laneRows = renderTaxonomyRows(repair.failureTaxonomy.laneSummaries);
  const kindRows = renderTaxonomyRows(repair.failureTaxonomy.kindSummaries);
  const issueRows = renderTaxonomyRows(repair.failureTaxonomy.issueTypeSummaries);
  const repairabilityRows = renderTaxonomyRows(repair.failureTaxonomy.repairabilitySummaries);

  return `<section class="card">
        <h2>Repair Summary</h2>
        <table>
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <h3>Repair Failure Taxonomy</h3>
        <div class="grid">
          <table>
            <thead><tr><th>Lane</th><th>Count</th></tr></thead>
            <tbody>${laneRows || '<tr><td colspan="2">No failure lanes.</td></tr>'}</tbody>
          </table>
          <table>
            <thead><tr><th>Kind</th><th>Count</th></tr></thead>
            <tbody>${kindRows || '<tr><td colspan="2">No failure kinds.</td></tr>'}</tbody>
          </table>
          <table>
            <thead><tr><th>Issue Type</th><th>Count</th></tr></thead>
            <tbody>${issueRows || '<tr><td colspan="2">No issue types.</td></tr>'}</tbody>
          </table>
          <table>
            <thead><tr><th>Repairability</th><th>Count</th></tr></thead>
            <tbody>${repairabilityRows || '<tr><td colspan="2">No repairability states.</td></tr>'}</tbody>
          </table>
        </div>
        <h3>Repair Task Category Summary</h3>
        <table>
          <thead><tr><th>Category</th><th>Count</th></tr></thead>
          <tbody>${categoryRows || '<tr><td colspan="2">No repair task categories.</td></tr>'}</tbody>
        </table>
        <h3>Repair Target Attribution Summary</h3>
        <table>
          <thead><tr><th>Type</th><th>Target</th><th>Count</th></tr></thead>
          <tbody>${targetRows || '<tr><td colspan="3">No repair target attribution.</td></tr>'}</tbody>
        </table>
        <h3>Repair Task Summary</h3>
        <table>
          <thead><tr><th>Task</th><th>Category</th><th>Preview</th><th>Delta</th><th>Failure Points</th><th>Write Bounds</th><th>Symbols</th><th>Tests</th><th>Failure Targets</th></tr></thead>
          <tbody>${taskRows || '<tr><td colspan="9">No repair tasks.</td></tr>'}</tbody>
        </table>
        <h3>Repair Blocker Summary</h3>
        <table>
          <thead><tr><th>Blocker</th><th>Boundary</th><th>Failure Points</th><th>Reason</th></tr></thead>
          <tbody>${blockerRows || '<tr><td colspan="4">No repair blockers.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderRepairPlanTable(repairPlan: RepairPlan | null): string {
  if (!repairPlan) {
    return '';
  }

  const blockerRows = renderTableRows(repairPlan.blockers ?? [], (blocker) => [
    blocker.blockerId,
    blocker.boundary,
    blocker.reason,
    blocker.decisionRequired
  ]);
  const blockerTable = blockerRows
    ? `<h3>Blockers</h3>
        <table>
          <thead><tr><th>Blocker</th><th>Boundary</th><th>Reason</th><th>Decision Required</th></tr></thead>
          <tbody>${blockerRows}</tbody>
        </table>`
    : '';
  const taskRows = renderTableRows(repairPlan.tasks, (task) => {
    const preview = task.preview
      ? `${task.preview.changed ? 'changed' : 'unchanged'}; +${task.preview.addedLines}/-${task.preview.removedLines}; ${task.preview.beforeLines} -> ${task.preview.afterLines} lines`
      : '';
    const targets = task.failurePoints.flatMap((point) => point.targetIds ?? []).join(', ');
    return [
      task.taskId,
      task.category ?? 'slot-rewrite',
      task.sourceSlotId,
      task.targetBlock,
      task.targetFile,
      task.allowedPaths.join(', '),
      task.requiredSymbols.join(', '),
      task.forbiddenOperations.join(', '),
      task.failureSummary,
      targets,
      preview
    ];
  });

  return `<section class="card">
        <h2>Repair Plan</h2>
        <p>${escapeHtml(repairPlan.status)} | source verification: ${escapeHtml(repairPlan.sourceVerificationStatus)} | requires verification: ${escapeHtml(String(repairPlan.requiresVerification))}</p>
        ${blockerTable}
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Category</th>
              <th>Slot</th>
              <th>Block</th>
              <th>Target File</th>
              <th>Allowed Paths</th>
              <th>Required Symbols</th>
              <th>Forbidden Operations</th>
              <th>Failure Summary</th>
              <th>Failure Targets</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>${taskRows}</tbody>
        </table>
      </section>`;
}

function renderUpgradeDiagnosticsTable(diagnostics: UpgradeDiagnostics | null): string {
  if (!diagnostics) {
    return '';
  }

  const detailsCell = diagnostics.details === undefined ? 'none' : renderJsonPre(diagnostics.details);
  const phase = diagnostics.phase ?? 'planning';
  return `<section class="card">
        <h2>Upgrade Diagnostics</h2>
        <table>
          <thead><tr><th>Status</th><th>Phase</th><th>Block</th><th>Target Version</th><th>Failed Check</th><th>Error</th><th>Message</th><th>Details</th></tr></thead>
          <tbody><tr><td>${escapeHtml(diagnostics.status)}</td><td>${escapeHtml(phase)}</td><td>${escapeHtml(diagnostics.blockId)}</td><td>${escapeHtml(diagnostics.targetVersion)}</td><td>${escapeHtml(diagnostics.failedCheck)}</td><td>${escapeHtml(diagnostics.errorCode)}</td><td>${escapeHtml(diagnostics.message)}</td><td>${detailsCell}</td></tr></tbody>
        </table>
      </section>`;
}

function renderUpgradePlanTable(upgradePlan: UpgradePlan | null): string {
  if (!upgradePlan) {
    return '';
  }

  const migrationRows = renderUpgradeMigrationRows(upgradePlan.migrationSummaries);
  const migrationKindRows = renderCountRecordRows(upgradePlan.migrationKindCounts);
  const operationRoleRows = renderUpgradeOperationRoleRows(upgradePlan.migrationOperations);
  const operationRows = renderUpgradeOperationRows(upgradePlan.migrationOperations);
  const impactRows = renderTableRows(upgradePlan.impacts, (impact) => [impact]);
  const preflightSummaryRows = renderUpgradePreflightSummaryRows(
    buildReviewUpgradePreflightSummaries(upgradePlan.preflightChecks)
  );
  const preflightRows = renderTableRows(upgradePlan.preflightChecks, (check) => [
    check.id,
    check.status,
    check.message,
    check.evidence.join(', ') || 'none'
  ]);

  return `<section class="card">
        <h2>Upgrade Plan</h2>
        <p>${escapeHtml(upgradePlan.blockId)} ${escapeHtml(upgradePlan.fromVersion)} -&gt; ${escapeHtml(upgradePlan.toVersion)} (${escapeHtml(upgradePlan.status)})</p>
        <h3>Preflight Summary</h3>
        <table>
          <thead><tr><th>Group</th><th>Checks</th><th>Evidence Items</th></tr></thead>
          <tbody>${preflightSummaryRows}</tbody>
        </table>
        <h3>Preflight Checks</h3>
        <table>
          <thead><tr><th>ID</th><th>Status</th><th>Message</th><th>Evidence</th></tr></thead>
          <tbody>${preflightRows}</tbody>
        </table>
        <h3>Migration Kind Summary</h3>
        <table>
          <thead><tr><th>Kind</th><th>Count</th></tr></thead>
          <tbody>${migrationKindRows}</tbody>
        </table>
        <h3>Operation Role Summary</h3>
        <table>
          <thead><tr><th>Role</th><th>Count</th></tr></thead>
          <tbody>${operationRoleRows || '<tr><td colspan="2">No upgrade plan operation roles.</td></tr>'}</tbody>
        </table>
        <h3>Migrations</h3>
        <table>
          <thead><tr><th>ID</th><th>Kind</th><th>Source</th><th>Target</th><th>Slot</th><th>Requires Verification</th><th>Reason</th></tr></thead>
          <tbody>${migrationRows}</tbody>
        </table>
        <h3>Migration Operations</h3>
        <table>
          <thead><tr><th>ID</th><th>Kind</th><th>Role</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>${operationRows || '<tr><td colspan="5">No upgrade plan migration operations.</td></tr>'}</tbody>
        </table>
        <h3>Impacts</h3>
        <table>
          <thead><tr><th>Path</th></tr></thead>
          <tbody>${impactRows}</tbody>
        </table>
      </section>`;
}

function renderReviewSummaryTables(review: ReviewSummary): string {
  const failureRows = renderTableRows(review.failurePoints, (failure) => [
    failure.lane,
    failure.kind,
    failure.artifactPath,
    failure.message
  ]);
  const regressionRows = renderTableRows(review.regressionRisks, (risk) => [
    risk.kind,
    risk.blockId ?? '',
    risk.slotId ?? '',
    risk.message
  ]);
  const conflictRows = renderTableRows(review.conflictHints, (hint) => [hint.kind, hint.relatedId, hint.message]);

  return `<section class="card">
        <h2>Review Failure Points</h2>
        <table>
          <thead><tr><th>Lane</th><th>Kind</th><th>Artifact</th><th>Message</th></tr></thead>
          <tbody>${failureRows}</tbody>
        </table>
      </section>
      <section class="card">
        <h2>Review Regression Risks</h2>
        <table>
          <thead><tr><th>Kind</th><th>Block</th><th>Slot</th><th>Message</th></tr></thead>
          <tbody>${regressionRows}</tbody>
        </table>
      </section>
      <section class="card">
        <h2>Review Conflict Hints</h2>
        <table>
          <thead><tr><th>Kind</th><th>Related ID</th><th>Message</th></tr></thead>
          <tbody>${conflictRows}</tbody>
        </table>
      </section>`;
}

function renderDeveloperSourceLayerCard(lock: LockFile): string {
  const sourceAreas: Array<readonly [string, string]> = [
    ['App Plan', 'source/app.yaml'],
    ['Model', 'source/model/**'],
    ['Slots', 'source/code/slots/**'],
    ['Application Code', 'source/code/{app,server,ui,shared,integrations}/**'],
    ['Opaque Code', 'source/code/opaque/**'],
    ['Lab Code', 'source/code/lab/**'],
    ['Patches', 'source/patches/**'],
    ['Assets', 'source/assets/**'],
    ['Views', 'source/views/**'],
    ['Workbench Mutations', 'source/views/mutations/*.json -> source/app.yaml'],
    ['Env', 'source/env/**'],
    ['Private Blocks', 'source/blocks/private/**']
  ];
  const areaRows = renderTableRows(sourceAreas, ([label, sourcePath]) => [label, sourcePath]);
  const slotRows = renderTableRows(lock.slotTasks, (task) => [
    task.id,
    task.sourcePath ?? 'compatibility target only',
    task.target
  ]);

  return `<section class="card">
        <h2>Developer Source Layer</h2>
        <p>Default editable workspace inputs live under top-level source; project remains the materialized runtime target and control stores evidence, graph, provenance, workflow, and Workbench projections.</p>
        <p>Workbench edits are accepted as structured mutations under source/views/mutations and applied back to source/app.yaml.</p>
        <h3>Editable Areas</h3>
        <table>
          <thead><tr><th>Area</th><th>Path</th></tr></thead>
          <tbody>${areaRows}</tbody>
        </table>
        <h3>Slot Materialization</h3>
        <table>
          <thead><tr><th>Slot</th><th>Source Path</th><th>Runtime Target</th></tr></thead>
          <tbody>${slotRows || '<tr><td colspan="3">No slot tasks.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderSourceView(
  lock: LockFile,
  provenance: ProvenanceFile,
  review: ReviewSummary,
  graph: ExplainGraph,
  policyReport: PolicyReport,
  repairPlan: RepairPlan | null,
  upgradeDiagnostics: UpgradeDiagnostics | null,
  upgradePlan: UpgradePlan | null
): string {
  const optionalSections = joinSections([
    renderRuntimeEntriesTable(lock),
    renderVerticalSummaryCard(lock, review),
    renderBlockCombinationCard(lock, review),
    renderFailureFocusCard(review),
    renderReviewRuntimeAttributionCard(review),
    renderInstallImpactCard(review),
    renderProvenanceSummaryCard(review),
    renderCoverageSummaryCard(review),
    renderPolicySummaryCard(review),
    renderPolicySourcesTable(policyReport),
    renderMergedPoliciesTable(policyReport),
    renderUpgradeSummaryCard(review),
    renderUpgradePlanTable(upgradePlan),
    renderUpgradeDiagnosticsTable(upgradeDiagnostics),
    renderRepairSummaryCard(review),
    renderRepairPlanTable(repairPlan),
    renderReviewSummaryTables(review),
    renderJsonCard('Explain Graph', { nodes: graph.nodes.length, edges: graph.edges.length })
  ]);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Source View</title>
    <style>
      body { font-family: Segoe UI, sans-serif; margin: 0; background: #f4f4ef; color: #17211f; }
      main { max-width: 1200px; margin: 0 auto; padding: 32px 20px 64px; display: grid; gap: 20px; }
      .card { background: white; border: 1px solid #d7ddd5; border-radius: 16px; padding: 20px; box-shadow: 0 8px 24px rgba(23, 33, 31, 0.06); }
      .view-nav { display: flex; gap: 12px; }
      .view-nav a { color: #184c3d; font-weight: 600; text-decoration: none; }
      .view-nav a[aria-current="page"] { text-decoration: underline; }
      pre { overflow: auto; background: #0f1d19; color: #e6fff8; padding: 16px; border-radius: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e4e8e2; vertical-align: top; }
    </style>
  </head>
  <body>
    <main>
      ${renderViewNav('source')}
      ${renderCiSummaryCard(review)}
      ${renderDeveloperSourceLayerCard(lock)}
      <section class="card">
        <h1>Source View</h1>
        <p>Blocks: ${lock.resolvedBlocks.length} | Slots: ${lock.slotTasks.length} | Files: ${provenance.artifacts.length}</p>
        <table>
          <thead><tr><th>Path</th><th>Origin</th><th>Registry</th><th>Override</th></tr></thead>
          <tbody>
            ${renderTableRows(provenance.artifacts, (artifact) => {
              const registry = artifact.registrySourceId ? `${artifact.registrySourceId} (${artifact.registryKind ?? 'unknown'}, ${artifact.registryLocation ?? 'unknown'})` : '';
              return [artifact.path, `${artifact.originType}:${artifact.originId}`, registry, artifact.overrideStatus];
            })}
          </tbody>
        </table>
      </section>
      ${optionalSections}
    </main>
  </body>
</html>`;
}

function renderSlotRuleView(
  lock: LockFile,
  report: VerificationReport,
  coverage: AcceptanceCoverageReport,
  policyReport: PolicyReport,
  review: ReviewSummary
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Slot / Rule View</title>
    <style>
      body { font-family: Segoe UI, sans-serif; margin: 0; background: #f4f4ef; color: #17211f; }
      main { max-width: 1200px; margin: 0 auto; padding: 32px 20px 64px; display: grid; gap: 20px; }
      .card { background: white; border: 1px solid #d7ddd5; border-radius: 16px; padding: 20px; box-shadow: 0 8px 24px rgba(23, 33, 31, 0.06); }
      .view-nav { display: flex; gap: 12px; }
      .view-nav a { color: #184c3d; font-weight: 600; text-decoration: none; }
      .view-nav a[aria-current="page"] { text-decoration: underline; }
      pre { overflow: auto; background: #0f1d19; color: #e6fff8; padding: 16px; border-radius: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e4e8e2; vertical-align: top; }
    </style>
  </head>
  <body>
    <main>
      ${renderViewNav('slot-rule')}
      <section class="card">
        <h1>Slot / Rule View</h1>
        <p>Fast lane: ${report.fast.status} | Runtime lane: ${report.runtime.status} | Overall: ${report.summary.status}</p>
        <table>
          <thead><tr><th>Slot</th><th>Block</th><th>Source</th><th>Runtime Target</th><th>Status</th><th>Coverage</th></tr></thead>
          <tbody>
            ${renderTableRows(lock.slotTasks, (task) => {
              const slotCoverage = coverage.slots.find((entry) => entry.id === task.id);
              return [
                task.id,
                task.block,
                task.sourcePath ?? 'compatibility target only',
                task.target,
                task.status,
                (slotCoverage?.coveredBy ?? []).join(', ') || 'none'
              ];
            })}
          </tbody>
        </table>
      </section>
      <section class="card">
        ${renderE2eChainSummarySection(review)}
      </section>
      ${renderPolicyViolationsTable(policyReport)}
      ${renderJsonCard('Acceptance Coverage', coverage)}
      ${renderReviewSummaryTables(review)}
    </main>
  </body>
</html>`;
}

export async function writeLocalViews(workspaceRoot: string): Promise<void> {
  const {
    acceptanceCoveragePath,
    explainGraphPath,
    generatedViewsDir,
    lockPath,
    policyReportPath,
    provenancePath,
    reviewSummaryPath,
    sourceViewPath,
    slotRuleViewPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);

  const lock = await readRequiredArtifact<LockFile>(lockPath, 'graph.lock.json');
  await ensureDir(generatedViewsDir);
  await writeLockWithGeneratedPaths(lockPath, lock, CI_ARTIFACT_PATHS.view);

  const [provenance, report, coverage, policyReport, review, graph, governanceReports] = await Promise.all([
    readRequiredArtifact<ProvenanceFile>(provenancePath, 'provenance.json'),
    readRequiredArtifact<VerificationReport>(verificationReportPath, 'verification-report.json'),
    readRequiredArtifact<AcceptanceCoverageReport>(acceptanceCoveragePath, 'acceptance-coverage.json'),
    readRequiredArtifact<PolicyReport>(policyReportPath, 'policy-report.json'),
    readRequiredArtifact<ReviewSummary>(reviewSummaryPath, 'review-summary.json'),
    readRequiredArtifact<ExplainGraph>(explainGraphPath, 'explain-graph.json'),
    readReviewGovernanceReports(workspaceRoot)
  ]);
  const { repairPlan, upgradeDiagnostics, upgradePlan } = governanceReports;

  await fs.writeFile(sourceViewPath, renderSourceView(lock, provenance, review, graph, policyReport, repairPlan, upgradeDiagnostics, upgradePlan), 'utf8');
  await fs.writeFile(slotRuleViewPath, renderSlotRuleView(lock, report, coverage, policyReport, review), 'utf8');
}
