import fs from 'node:fs/promises';
import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, pathExists, readJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
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

function renderJsonCard(title: string, value: unknown): string {
  return `<section class="card"><h2>${escapeHtml(title)}</h2><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></section>`;
}

function classifyRuntimeEntry(path: string): string | null {
  if (/^app\/.+\/page\.tsx$/.test(path) || path === 'app/page.tsx') {
    return 'page';
  }
  if (/^app\/api\/.+\/route\.ts$/.test(path)) {
    return 'api';
  }
  return null;
}

function renderRuntimeEntriesTable(lock: LockFile): string {
  const entries = lock.generatedPaths
    .map((generatedPath) => ({ path: generatedPath, kind: classifyRuntimeEntry(generatedPath) }))
    .filter((entry): entry is { path: string; kind: string } => entry.kind !== null);
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

function detectVerticalFromPath(filePath: string): string | null {
  if (filePath.includes('/tickets') || filePath.includes('ticket')) {
    return 'ticket';
  }
  if (filePath.includes('/customers') || filePath.includes('customer')) {
    return 'customer';
  }
  return null;
}

function renderVerticalSummaryCard(lock: LockFile, review: ReviewSummary): string {
  const verticals = new Map<string, { blocks: Set<string>; runtimeEntries: Set<string>; risks: string[] }>();

  const ensureVertical = (vertical: string) => {
    let entry = verticals.get(vertical);
    if (!entry) {
      entry = { blocks: new Set<string>(), runtimeEntries: new Set<string>(), risks: [] };
      verticals.set(vertical, entry);
    }
    return entry;
  };

  for (const block of lock.resolvedBlocks) {
    const vertical = detectVerticalFromPath(block.id);
    if (!vertical) {
      continue;
    }
    ensureVertical(vertical).blocks.add(block.id);
  }

  for (const generatedPath of lock.generatedPaths) {
    const runtimeKind = classifyRuntimeEntry(generatedPath);
    const vertical = detectVerticalFromPath(generatedPath);
    if (!runtimeKind || !vertical) {
      continue;
    }
    ensureVertical(vertical).runtimeEntries.add(generatedPath);
  }

  for (const risk of review.regressionRisks) {
    const vertical = detectVerticalFromPath(risk.blockId ?? '') ?? detectVerticalFromPath(risk.message);
    if (!vertical) {
      continue;
    }
    ensureVertical(vertical).risks.push(risk.message);
  }

  const rows = [...verticals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([vertical, summary]) => {
      const blocks = [...summary.blocks].sort((left, right) => left.localeCompare(right)).join(', ') || 'none';
      const runtimeEntries = [...summary.runtimeEntries].sort((left, right) => left.localeCompare(right)).join(', ') || 'none';
      const risks = summary.risks.sort((left, right) => left.localeCompare(right)).join(' | ') || 'none';
      return `<tr><td>${escapeHtml(vertical)}</td><td>${escapeHtml(blocks)}</td><td>${escapeHtml(runtimeEntries)}</td><td>${escapeHtml(risks)}</td></tr>`;
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

function renderBlockCombinationCard(lock: LockFile): string {
  const rows = lock.resolvedBlocks
    .slice()
    .sort((left, right) => left.installOrder - right.installOrder || left.id.localeCompare(right.id))
    .map((block) => {
      const installs = lock.installPlan.filter((step) => step.blockId === block.id).length;
      const blockVertical = detectVerticalFromPath(block.id);
      const runtimeEntries = blockVertical
        ? lock.generatedPaths.filter(
            (generatedPath) =>
              classifyRuntimeEntry(generatedPath) !== null && detectVerticalFromPath(generatedPath) === blockVertical
          ).length
        : 0;
      return `<tr><td>${escapeHtml(block.id)}</td><td>${escapeHtml(block.kind)}</td><td>${escapeHtml(String(block.installOrder))}</td><td>${escapeHtml(String(installs))}</td><td>${escapeHtml(String(runtimeEntries))}</td></tr>`;
    })
    .join('');

  return `<section class="card">
        <h2>Block Combination Summary</h2>
        <table>
          <thead><tr><th>Block</th><th>Kind</th><th>Install Order</th><th>Install Steps</th><th>Runtime Entries</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">No blocks installed.</td></tr>'}</tbody>
        </table>
      </section>`;
}

function renderFailureFocusCard(review: ReviewSummary): string {
  const rows = review.failurePoints
    .map(
      (failure) =>
        `<tr><td>${escapeHtml(failure.lane)}</td><td>${escapeHtml(failure.kind)}</td><td>${escapeHtml(failure.artifactPath)}</td><td>${escapeHtml(failure.message)}</td></tr>`
    )
    .join('');

  return `<section class="card">
        <h2>Failure Focus</h2>
        <table>
          <thead><tr><th>Lane</th><th>Kind</th><th>Artifact</th><th>Message</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No failure points.</td></tr>'}</tbody>
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
  const preflightRows = upgradePlan.preflightChecks
    .map(
      (check) =>
        `<tr><td>${escapeHtml(check.id)}</td><td>${escapeHtml(check.status)}</td><td>${escapeHtml(check.message)}</td><td>${escapeHtml(check.evidence.join(', ') || 'none')}</td></tr>`
    )
    .join('');

  return `<section class="card">
        <h2>Upgrade Plan</h2>
        <p>${escapeHtml(upgradePlan.blockId)} ${escapeHtml(upgradePlan.fromVersion)} -&gt; ${escapeHtml(upgradePlan.toVersion)} (${escapeHtml(upgradePlan.status)})</p>
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
      ${renderBlockCombinationCard(lock)}
      ${renderFailureFocusCard(review)}
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
