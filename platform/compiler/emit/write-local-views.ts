import fs from 'node:fs/promises';
import { ensureDir } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type {
  AcceptanceCoverageReport,
  ExplainGraph,
  LockFile,
  PolicyReport,
  ProvenanceFile,
  ReviewSummary,
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

function renderSourceView(
  lock: LockFile,
  provenance: ProvenanceFile,
  review: ReviewSummary,
  graph: ExplainGraph
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
      pre { overflow: auto; background: #0f1d19; color: #e6fff8; padding: 16px; border-radius: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e4e8e2; vertical-align: top; }
    </style>
  </head>
  <body>
    <main>
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
      ${renderJsonCard('Review Summary', review)}
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
      pre { overflow: auto; background: #0f1d19; color: #e6fff8; padding: 16px; border-radius: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e4e8e2; vertical-align: top; }
    </style>
  </head>
  <body>
    <main>
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
      ${renderJsonCard('Policy Report', policyReport)}
      ${renderJsonCard('Acceptance Coverage', coverage)}
      ${renderJsonCard('Review Risks', {
        failurePoints: review.failurePoints,
        regressionRisks: review.regressionRisks,
        conflictHints: review.conflictHints
      })}
    </main>
  </body>
</html>`;
}

export async function writeLocalViews(
  workspaceRoot: string,
  lock: LockFile,
  provenance: ProvenanceFile,
  report: VerificationReport,
  coverage: AcceptanceCoverageReport,
  policyReport: PolicyReport,
  review: ReviewSummary,
  graph: ExplainGraph
): Promise<void> {
  const { generatedViewsDir, sourceViewPath, slotRuleViewPath, lockPath } = getWorkspacePaths(workspaceRoot);
  await ensureDir(generatedViewsDir);
  for (const generatedPath of ['generated/views/source-view.html', 'generated/views/slot-rule-view.html']) {
    if (!lock.generatedPaths.includes(generatedPath)) {
      lock.generatedPaths.push(generatedPath);
    }
  }
  lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  await fs.writeFile(sourceViewPath, renderSourceView(lock, provenance, review, graph), 'utf8');
  await fs.writeFile(slotRuleViewPath, renderSlotRuleView(lock, report, coverage, policyReport, review), 'utf8');
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}
