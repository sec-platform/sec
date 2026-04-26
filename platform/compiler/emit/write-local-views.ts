import fs from 'node:fs/promises';
import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, pathExists, readJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath } from './runtime-attribution.ts';
import type {
  AcceptanceCoverageReport,
  ExplainGraph,
  LockFile,
  PolicyReport,
  ProvenanceFile,
  RepairPlan,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../../shared/types.ts';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatList(values: Iterable<string>, fallback = 'none'): string {
  const items = [...values].sort((left, right) => left.localeCompare(right));
  return items.length > 0 ? items.join(', ') : fallback;
}

function renderJsonCard(title: string, value: unknown): string {
  return `<section class="card"><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></section>`;
}

function renderCiSummaryCard(review: ReviewSummary): string {
  const nonzeroMissingReasonCount = review.artifactSummary?.missingReasonCounts
    ? Object.values(review.artifactSummary.missingReasonCounts).filter((count) => count > 0).length
    : 0;
  const artifactRows = review.artifactSummary
    ? [
        ['Artifact Status', review.artifactSummary.artifactStatus ?? 'passed'],
        ['Artifacts', String(review.artifactSummary.artifactCount)],
        ['Governance Artifacts', String(review.artifactSummary.governanceCount)],
        ['View Artifacts', String(review.artifactSummary.viewCount)],
        ['Upload Groups', String(review.artifactSummary.uploadGroups?.length ?? 0)],
        ['Missing Artifacts', String(review.artifactSummary.missingCount)],
        ['Missing Reason Types', String(nonzeroMissingReasonCount)]
      ]
    : [];
  const rows = [
    ['Status', review.ciSummary.status],
    ['Failures', String(review.ciSummary.failureCount)],
    ['Regression Risks', String(review.ciSummary.regressionRiskCount)],
    ['Conflict Hints', String(review.ciSummary.conflictHintCount)],
    ['Impacted Blocks', String(review.ciSummary.impactedBlockCount)],
    ['Impacted Slots', String(review.ciSummary.impactedSlotCount)],
    ['Runtime Entries', String(review.ciSummary.runtimeEntryCount)],
    ...artifactRows
  ]
    .map(([label, value]) => `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  const missingReasonRows = review.artifactSummary?.missingReasonCounts
    ? Object.entries(review.artifactSummary.missingReasonCounts)
        .filter(([, count]) => count > 0)
        .map(
          ([reason, count]) => `<tr>
              <td>${escapeHtml(reason)}</td>
              <td>${escapeHtml(String(count))}</td>
            </tr>`
        )
        .join('')
    : '';
  const missingReasonTable = missingReasonRows
    ? `<h3>Missing Reason Summary</h3>
        <table>
          <thead><tr><th>Reason</th><th>Count</th></tr></thead>
          <tbody>${missingReasonRows}</tbody>
        </table>`
    : '';
  const uploadGroupRows = review.artifactSummary?.uploadGroups?.length
    ? review.artifactSummary.uploadGroups
        .map(
          (group) => `<tr>
              <td>${escapeHtml(group.kind)}</td>
              <td>${escapeHtml(String(group.count))}</td>
              <td>${escapeHtml(group.paths.join(', '))}</td>
            </tr>`
        )
        .join('')
    : '';
  const uploadGroupTable = uploadGroupRows
    ? `<h3>Artifact Upload Groups</h3>
        <table>
          <thead><tr><th>Kind</th><th>Count</th><th>Paths</th></tr></thead>
          <tbody>${uploadGroupRows}</tbody>
        </table>`
    : '';
  const missingRows = review.artifactSummary?.missing?.length
    ? review.artifactSummary.missing
        .map(
          (entry) => `<tr>
              <td>${escapeHtml(entry.path)}</td>
              <td>${escapeHtml(entry.reason)}</td>
              <td>${escapeHtml(entry.declaredBy)}</td>
            </tr>`
        )
        .join('')
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
        ${missingReasonTable}
        ${uploadGroupTable}
        ${missingTable}
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
  const rows = entries.length > 0
    ? entries
        .map((entry) => `<tr><td>${escapeHtml(entry.kind)}</td><td>${escapeHtml(entry.path)}</td></tr>`)
        .join('')
    : '<tr><td colspan="2">No generated runtime entries.</td></tr>';

  return `<section class="card">
        <h2>Runtime Entry Points</h2>
        <table>
          <thead><tr><th>Kind</th><th>Path</th></tr></thead>
          <tbody>${rows}</tbody>
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
    riskMap.set(vertical, [...(riskMap.get(vertical) ?? []), risk.message].sort((left, right) => left.localeCompare(right)));
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

  const rows = [...sliceIds]
    .sort((left, right) => left.localeCompare(right))
    .map((vertical) => {
      const summary = review.verticalSlices.find((slice) => slice.id === vertical);
      const fallback = fallbackSlices.get(vertical);
      const blocks = summary?.relatedBlocks ?? [...(fallback?.relatedBlocks ?? [])].sort((left, right) => left.localeCompare(right));
      const runtimeEntries = summary?.runtimeEntries ?? [...(fallback?.runtimeEntries ?? [])].sort((left, right) => left.localeCompare(right));
      const risks = riskMap.get(vertical) ?? [];
      return `<tr><td>${escapeHtml(vertical)}</td><td>${escapeHtml(blocks.join(', ') || 'none')}</td><td>${escapeHtml(runtimeEntries.join(', ') || 'none')}</td><td>${escapeHtml(risks.join(' | ') || 'none')}</td></tr>`;
    })
    .join('');

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
  const rows = lock.resolvedBlocks
    .slice()
    .sort((left, right) => left.installOrder - right.installOrder || left.id.localeCompare(right.id))
    .map((block) => {
      const installs = lock.installPlan.filter((step) => step.blockId === block.id).length;
      const impact = impactByBlock.get(block.id);
      const verticals = impact?.verticals ?? [];
      const runtimeEntries = impact?.runtimeEntries ?? [];
      return `<tr>
          <td>${escapeHtml(block.id)}</td>
          <td>${escapeHtml(block.kind)}</td>
          <td>${escapeHtml(String(block.installOrder))}</td>
          <td>${escapeHtml(String(installs))}</td>
          <td>${escapeHtml(verticals.join(', ') || 'none')}</td>
          <td>${escapeHtml(runtimeEntries.join(', ') || 'none')}</td>
        </tr>`;
    })
    .join('');

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

  const groupRows = [...failureGroups.values()]
    .sort((left, right) => left.lane.localeCompare(right.lane) || left.kind.localeCompare(right.kind))
    .map(
      (group) => `<tr>
          <td>${escapeHtml(group.lane)}</td>
          <td>${escapeHtml(group.kind)}</td>
          <td>${escapeHtml(String(group.count))}</td>
          <td>${escapeHtml(formatList(group.artifacts, ''))}</td>
        </tr>`
    )
    .join('');
  const rows = review.failurePoints
    .map(
      (failure) => `<tr>
          <td>${escapeHtml(failure.lane)}</td>
          <td>${escapeHtml(failure.kind)}</td>
          <td>${escapeHtml(failure.artifactPath)}</td>
          <td>${escapeHtml(failure.message)}</td>
        </tr>`
    )
    .join('');

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

  const groupRows = [...runtimeGroups.values()]
    .sort((left, right) => left.vertical.localeCompare(right.vertical) || left.kind.localeCompare(right.kind))
    .map(
      (group) => `<tr>
          <td>${escapeHtml(group.vertical)}</td>
          <td>${escapeHtml(group.kind)}</td>
          <td>${escapeHtml(String(group.count))}</td>
          <td>${escapeHtml(formatList(group.relatedBlocks))}</td>
        </tr>`
    )
    .join('');
  const rows = review.runtimeEntries
    .map(
      (entry) => `<tr>
          <td>${escapeHtml(entry.kind)}</td>
          <td>${escapeHtml(entry.vertical ?? 'none')}</td>
          <td>${escapeHtml(entry.path)}</td>
          <td>${escapeHtml(entry.relatedBlocks.join(', ') || 'none')}</td>
        </tr>`
    )
    .join('');

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
  const impactGroups = new Map<
    string,
    { vertical: string; blocks: Set<string>; actions: Set<string>; runtimeEntries: Set<string>; targets: Set<string> }
  >();
  for (const impact of review.installImpacts) {
    const verticals = impact.verticals.length > 0 ? impact.verticals : ['none'];
    for (const vertical of verticals) {
      let group = impactGroups.get(vertical);
      if (!group) {
        group = {
          vertical,
          blocks: new Set<string>(),
          actions: new Set<string>(),
          runtimeEntries: new Set<string>(),
          targets: new Set<string>()
        };
        impactGroups.set(vertical, group);
      }
      group.blocks.add(impact.blockId);
      for (const action of impact.actionKinds) {
        group.actions.add(action);
      }
      for (const runtimeEntry of impact.runtimeEntries) {
        group.runtimeEntries.add(runtimeEntry);
      }
      for (const targetPath of impact.targetPaths) {
        group.targets.add(targetPath);
      }
    }
  }

  const groupRows = [...impactGroups.values()]
    .sort((left, right) => left.vertical.localeCompare(right.vertical))
    .map(
      (group) => `<tr>
          <td>${escapeHtml(group.vertical)}</td>
          <td>${escapeHtml(String(group.blocks.size))}</td>
          <td>${escapeHtml(formatList(group.actions))}</td>
          <td>${escapeHtml(formatList(group.runtimeEntries))}</td>
          <td>${escapeHtml(formatList(group.targets))}</td>
        </tr>`
    )
    .join('');
  const rows = review.installImpacts
    .map(
      (impact) => `<tr>
          <td>${escapeHtml(impact.blockId)}</td>
          <td>${escapeHtml(impact.actionKinds.join(', ') || 'none')}</td>
          <td>${escapeHtml(impact.sourceRoots.join(', ') || 'none')}</td>
          <td>${escapeHtml(impact.verticals.join(', ') || 'none')}</td>
          <td>${escapeHtml(impact.runtimeEntries.join(', ') || 'none')}</td>
          <td>${escapeHtml(impact.targetPaths.join(', ') || 'none')}</td>
        </tr>`
    )
    .join('');

  return `<section class="card">
        <h2>Install Impact Summary</h2>
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

async function readOptionalArtifact<T>(filePath: string): Promise<T | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  return readJson<T>(filePath);
}

function renderPolicySourcesTable(policyReport: PolicyReport): string {
  const rows = [...policyReport.official.sources, ...policyReport.project.sources]
    .map((source) => `<tr><td>${escapeHtml(source.path)}</td><td>${escapeHtml(source.policyIds.join(', ') || 'none')}</td></tr>`)
    .join('');

  return `<section class="card">
        <h2>Policy Sources</h2>
        <table>
          <thead><tr><th>Path</th><th>Policy IDs</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

function renderMergedPoliciesTable(policyReport: PolicyReport): string {
  const rows = policyReport.merged.policies
    .map(
      (policy) =>
        `<tr><td>${escapeHtml(policy.id)}</td><td>${escapeHtml(policy.sourceScope)}</td><td>${escapeHtml(policy.sourcePath)}</td></tr>`
    )
    .join('');

  return `<section class="card">
        <h2>Merged Policies</h2>
        <table>
          <thead><tr><th>Policy</th><th>Scope</th><th>Source</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

function renderPolicyViolationsTable(policyReport: PolicyReport): string {
  const rows = policyReport.violations
    .map(
      (violation) =>
        `<tr><td>${escapeHtml(violation.id)}</td><td>${escapeHtml(violation.severity)}</td><td>${escapeHtml(violation.sourceScope)}</td><td>${escapeHtml(violation.sourcePath)}</td><td>${escapeHtml(violation.message)}</td></tr>`
    )
    .join('');

  return `<section class="card">
        <h2>Policy Violations</h2>
        <table>
          <thead><tr><th>ID</th><th>Severity</th><th>Scope</th><th>Source</th><th>Message</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
}

function renderRepairPlanTable(repairPlan: RepairPlan | null): string {
  if (!repairPlan) {
    return '';
  }

  const blockerRows = (repairPlan.blockers ?? [])
    .map(
      (blocker) =>
        `<tr><td>${escapeHtml(blocker.blockerId)}</td><td>${escapeHtml(blocker.boundary)}</td><td>${escapeHtml(blocker.reason)}</td><td>${escapeHtml(blocker.decisionRequired)}</td></tr>`
    )
    .join('');
  const blockerTable = blockerRows
    ? `<h3>Blockers</h3>
        <table>
          <thead><tr><th>Blocker</th><th>Boundary</th><th>Reason</th><th>Decision Required</th></tr></thead>
          <tbody>${blockerRows}</tbody>
        </table>`
    : '';
  const taskRows = repairPlan.tasks
    .map((task) => {
      const preview = task.preview
        ? `${task.preview.changed ? 'changed' : 'unchanged'}; +${task.preview.addedLines}/-${task.preview.removedLines}; ${task.preview.beforeLines} -> ${task.preview.afterLines} lines`
        : '';
      const targets = task.failurePoints.flatMap((point) => point.targetIds ?? []).join(', ');
      return `<tr><td>${escapeHtml(task.taskId)}</td><td>${escapeHtml(task.sourceSlotId)}</td><td>${escapeHtml(task.targetBlock)}</td><td>${escapeHtml(task.targetFile)}</td><td>${escapeHtml(task.allowedPaths.join(', '))}</td><td>${escapeHtml(task.requiredSymbols.join(', '))}</td><td>${escapeHtml(task.forbiddenOperations.join(', '))}</td><td>${escapeHtml(task.failureSummary)}</td><td>${escapeHtml(targets)}</td><td>${escapeHtml(preview)}</td></tr>`;
    })
    .join('');

  return `<section class="card">
        <h2>Repair Plan</h2>
        <p>${escapeHtml(repairPlan.status)} | source verification: ${escapeHtml(repairPlan.sourceVerificationStatus)} | requires verification: ${escapeHtml(String(repairPlan.requiresVerification))}</p>
        ${blockerTable}
        <table>
          <thead><tr><th>Task</th><th>Slot</th><th>Block</th><th>Target File</th><th>Allowed Paths</th><th>Required Symbols</th><th>Forbidden Operations</th><th>Failure Summary</th><th>Failure Targets</th><th>Preview</th></tr></thead>
          <tbody>${taskRows}</tbody>
        </table>
      </section>`;
}

function renderUpgradeDiagnosticsTable(diagnostics: UpgradeDiagnostics | null): string {
  if (!diagnostics) {
    return '';
  }

  return `<section class="card">
        <h2>Upgrade Diagnostics</h2>
        <table>
          <thead><tr><th>Status</th><th>Block</th><th>Target Version</th><th>Failed Check</th><th>Error</th><th>Message</th></tr></thead>
          <tbody><tr><td>${escapeHtml(diagnostics.status)}</td><td>${escapeHtml(diagnostics.blockId)}</td><td>${escapeHtml(diagnostics.targetVersion)}</td><td>${escapeHtml(diagnostics.failedCheck)}</td><td>${escapeHtml(diagnostics.errorCode)}</td><td>${escapeHtml(diagnostics.message)}</td></tr></tbody>
        </table>
      </section>`;
}

function renderUpgradePlanTable(upgradePlan: UpgradePlan | null): string {
  if (!upgradePlan) {
    return '';
  }

  const migrationRows = upgradePlan.migrationSummaries
    .map(
      (migration) =>
        `<tr><td>${escapeHtml(migration.id)}</td><td>${escapeHtml(migration.kind)}</td><td>${escapeHtml(migration.target)}</td><td>${escapeHtml(String(migration.requiresVerification))}</td><td>${escapeHtml(migration.reason)}</td></tr>`
    )
    .join('');
  const migrationKindCounts =
    upgradePlan.migrationKindCounts ??
    upgradePlan.migrationSummaries.reduce<Record<string, number>>((counts, migration) => {
      counts[migration.kind] = (counts[migration.kind] ?? 0) + 1;
      return counts;
    }, {});
  const migrationKindRows = Object.entries(migrationKindCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `<tr><td>${escapeHtml(kind)}</td><td>${escapeHtml(String(count))}</td></tr>`)
    .join('');
  const impactRows = upgradePlan.impacts.map((impact) => `<tr><td>${escapeHtml(impact)}</td></tr>`).join('');
  const preflightGroups = upgradePlan.preflightChecks.reduce<Record<string, { checks: number; evidence: number }>>(
    (groups, check) => {
      const group = check.id.startsWith('migration-') ? 'migration' : check.id.split('-')[0];
      groups[group] ??= { checks: 0, evidence: 0 };
      groups[group].checks += 1;
      groups[group].evidence += check.evidence.length;
      return groups;
    },
    {}
  );
  const preflightSummaryRows = Object.entries(preflightGroups)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([group, summary]) =>
        `<tr><td>${escapeHtml(group)}</td><td>${escapeHtml(String(summary.checks))}</td><td>${escapeHtml(String(summary.evidence))}</td></tr>`
    )
    .join('');
  const preflightRows = upgradePlan.preflightChecks
    .map(
      (check) =>
        `<tr><td>${escapeHtml(check.id)}</td><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.message)}</td><td>${escapeHtml(check.evidence.join(', ') || 'none')}</td></tr>`
    )
    .join('');

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
        <h3>Migrations</h3>
        <table>
          <thead><tr><th>ID</th><th>Kind</th><th>Target</th><th>Requires Verification</th><th>Reason</th></tr></thead>
          <tbody>${migrationRows}</tbody>
        </table>
        <h3>Impacts</h3>
        <table>
          <thead><tr><th>Path</th></tr></thead>
          <tbody>${impactRows}</tbody>
        </table>
      </section>`;
}

function renderReviewSummaryTables(review: ReviewSummary): string {
  const failureRows = review.failurePoints
    .map(
      (failure) =>
        `<tr><td>${escapeHtml(failure.lane)}</td><td>${escapeHtml(failure.kind)}</td><td>${escapeHtml(failure.artifactPath)}</td><td>${escapeHtml(failure.message)}</td></tr>`
    )
    .join('');
  const regressionRows = review.regressionRisks
    .map(
      (risk) =>
        `<tr><td>${escapeHtml(risk.kind)}</td><td>${escapeHtml(risk.blockId ?? '')}</td><td>${escapeHtml(risk.slotId ?? '')}</td><td>${escapeHtml(risk.message)}</td></tr>`
    )
    .join('');
  const conflictRows = review.conflictHints
    .map(
      (hint) =>
        `<tr><td>${escapeHtml(hint.kind)}</td><td>${escapeHtml(hint.relatedId)}</td><td>${escapeHtml(hint.message)}</td></tr>`
    )
    .join('');

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
      <section class="card">
        <h1>Source View</h1>
        <p>Blocks: ${lock.resolvedBlocks.length} | Slots: ${lock.slotTasks.length} | Files: ${provenance.artifacts.length}</p>
        <table>
          <thead><tr><th>Path</th><th>Origin</th><th>Registry</th><th>Override</th></tr></thead>
          <tbody>
            ${provenance.artifacts.map((artifact) => {
              const registry = artifact.registrySourceId ? `${artifact.registrySourceId} (${artifact.registryKind ?? 'unknown'}, ${artifact.registryLocation ?? 'unknown'})` : '';
              return `<tr><td>${escapeHtml(artifact.path)}</td><td>${escapeHtml(`${artifact.originType}:${artifact.originId}`)}</td><td>${escapeHtml(registry)}</td><td>${escapeHtml(artifact.overrideStatus)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </section>
      ${renderRuntimeEntriesTable(lock)}
      ${renderVerticalSummaryCard(lock, review)}
      ${renderBlockCombinationCard(lock, review)}
      ${renderFailureFocusCard(review)}
      ${renderReviewRuntimeAttributionCard(review)}
      ${renderInstallImpactCard(review)}
      ${renderPolicySourcesTable(policyReport)}
      ${renderMergedPoliciesTable(policyReport)}
      ${renderUpgradePlanTable(upgradePlan)}
      ${renderUpgradeDiagnosticsTable(upgradeDiagnostics)}
      ${renderRepairPlanTable(repairPlan)}
      ${renderReviewSummaryTables(review)}
      ${renderJsonCard('Explain Graph', { nodes: graph.nodes.length, edges: graph.edges.length })}
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
          <thead><tr><th>Slot</th><th>Block</th><th>Status</th><th>Coverage</th></tr></thead>
          <tbody>
            ${lock.slotTasks.map((task) => {
              const slotCoverage = coverage.slots.find((entry) => entry.id === task.id);
              return `<tr><td>${escapeHtml(task.id)}</td><td>${escapeHtml(task.block)}</td><td>${escapeHtml(task.status)}</td><td>${escapeHtml((slotCoverage?.coveredBy ?? []).join(', ') || 'none')}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
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
    repairPlanPath,
    reviewSummaryPath,
    sourceViewPath,
    slotRuleViewPath,
    upgradeDiagnosticsPath,
    upgradePlanPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);

  const lock = await readRequiredArtifact<LockFile>(lockPath, 'graph.lock.json');
  await ensureDir(generatedViewsDir);
  for (const generatedPath of ['generated/views/source-view.html', 'generated/views/slot-rule-view.html']) {
    if (!lock.generatedPaths.includes(generatedPath)) {
      lock.generatedPaths.push(generatedPath);
    }
  }
  lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

  const [provenance, report, coverage, policyReport, review, graph, repairPlan, upgradeDiagnostics, upgradePlan] = await Promise.all([
    readRequiredArtifact<ProvenanceFile>(provenancePath, 'provenance.json'),
    readRequiredArtifact<VerificationReport>(verificationReportPath, 'verification-report.json'),
    readRequiredArtifact<AcceptanceCoverageReport>(acceptanceCoveragePath, 'acceptance-coverage.json'),
    readRequiredArtifact<PolicyReport>(policyReportPath, 'policy-report.json'),
    readRequiredArtifact<ReviewSummary>(reviewSummaryPath, 'review-summary.json'),
    readRequiredArtifact<ExplainGraph>(explainGraphPath, 'explain-graph.json'),
    readOptionalArtifact<RepairPlan>(repairPlanPath),
    readOptionalArtifact<UpgradeDiagnostics>(upgradeDiagnosticsPath),
    readOptionalArtifact<UpgradePlan>(upgradePlanPath)
  ]);

  await fs.writeFile(sourceViewPath, renderSourceView(lock, provenance, review, graph, policyReport, repairPlan, upgradeDiagnostics, upgradePlan), 'utf8');
  await fs.writeFile(slotRuleViewPath, renderSlotRuleView(lock, report, coverage, policyReport, review), 'utf8');
}
