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
    .map(
      (task) =>
        `<tr><td>${escapeHtml(task.taskId)}</td><td>${escapeHtml(task.sourceSlotId)}</td><td>${escapeHtml(task.targetBlock)}</td><td>${escapeHtml(task.targetFile)}</td><td>${escapeHtml(task.failureSummary)}</td></tr>`
    )
    .join('');

  return `<section class="card">
        <h2>Repair Plan</h2>
        <p>${escapeHtml(repairPlan.status)} | source verification: ${escapeHtml(repairPlan.sourceVerificationStatus)}</p>
        <table>
          <thead><tr><th>Task</th><th>Slot</th><th>Block</th><th>Target File</th><th>Failure Summary</th></tr></thead>
          <tbody>${taskRows}</tbody>
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
  const impactRows = upgradePlan.impacts.map((impact) => `<tr><td>${escapeHtml(impact)}</td></tr>`).join('');

  return `<section class="card">
        <h2>Upgrade Plan</h2>
        <p>${escapeHtml(upgradePlan.blockId)} ${escapeHtml(upgradePlan.fromVersion)} -&gt; ${escapeHtml(upgradePlan.toVersion)} (${escapeHtml(upgradePlan.status)})</p>
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
          <thead><tr><th>Path</th><th>Origin</th><th>Override</th></tr></thead>
          <tbody>
            ${provenance.artifacts.map((artifact) => `<tr><td>${escapeHtml(artifact.path)}</td><td>${escapeHtml(`${artifact.originType}:${artifact.originId}`)}</td><td>${escapeHtml(artifact.overrideStatus)}</td></tr>`).join('')}
          </tbody>
        </table>
      </section>
      ${renderPolicySourcesTable(policyReport)}
      ${renderMergedPoliciesTable(policyReport)}
      ${renderUpgradePlanTable(upgradePlan)}
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

  const [provenance, report, coverage, policyReport, review, graph, repairPlan, upgradePlan] = await Promise.all([
    readRequiredArtifact<ProvenanceFile>(provenancePath, 'provenance.json'),
    readRequiredArtifact<VerificationReport>(verificationReportPath, 'verification-report.json'),
    readRequiredArtifact<AcceptanceCoverageReport>(acceptanceCoveragePath, 'acceptance-coverage.json'),
    readRequiredArtifact<PolicyReport>(policyReportPath, 'policy-report.json'),
    readRequiredArtifact<ReviewSummary>(reviewSummaryPath, 'review-summary.json'),
    readRequiredArtifact<ExplainGraph>(explainGraphPath, 'explain-graph.json'),
    readOptionalArtifact<RepairPlan>(repairPlanPath),
    readOptionalArtifact<UpgradePlan>(upgradePlanPath)
  ]);

  await fs.writeFile(sourceViewPath, renderSourceView(lock, provenance, review, graph, policyReport, repairPlan, upgradePlan), 'utf8');
  await fs.writeFile(slotRuleViewPath, renderSlotRuleView(lock, report, coverage, policyReport, review), 'utf8');
}
