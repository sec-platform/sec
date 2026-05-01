import ejs from 'ejs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { CI_ARTIFACT_PATHS } from '../../shared/ci-artifact-contract.ts';
import { countMatching, countPositiveValues, uniqueSorted } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import { EXPLAIN_NODE_TYPES, type ExplainGraph } from '../../shared/explain-types.ts';
import { ensureDir, pathExists, readJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeLockWithGeneratedPaths } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';
import { buildE2eMatrix } from '../../shared/review-matrix.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';
import { buildReviewUpgradePreflightSummaries } from '../../shared/review-upgrade.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import { buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath } from './runtime-attribution.ts';

const TEMPLATES_DIR = path.join(import.meta.dirname, 'templates');

function formatList(values: Iterable<string>, fallback = 'none'): string {
  const items = uniqueSorted([...values]);
  return items.length > 0 ? items.join(', ') : fallback;
}

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metricTable(rows: readonly (readonly unknown[])[]): string {
  return dataTable(['Metric', 'Value'], rows, 2, 'No metrics.');
}

function dataTable(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  colspan: number,
  emptyMsg: string
): string {
  const body = rows.length === 0
    ? `<tr><td colspan="${colspan}">${esc(emptyMsg)}</td></tr>`
    : rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');

  return [
    '<table>',
    `<thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>`,
    `<tbody>${body}</tbody>`,
    '</table>'
  ].join('');
}

function card(title: string, content: string): string {
  return `<section class="card"><h2>${esc(title)}</h2>${content}</section>`;
}

function subCard(title: string, content: string): string {
  return `<h3>${esc(title)}</h3>${content}`;
}

function jsonPre(value: unknown): string {
  return `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
}

const templateHelpers = { esc, metricTable, dataTable, card, subCard, jsonPre };

async function readRequiredArtifact<T>(filePath: string, label: string): Promise<T> {
  if (!(await pathExists(filePath))) {
    throw new CompilerError('EXPLAIN-BLOCKED-003', `${label} is missing`);
  }
  return readJson<T>(filePath);
}

async function renderTemplate(name: string, data: Record<string, unknown>): Promise<string> {
  const filePath = path.join(TEMPLATES_DIR, name);
  return ejs.renderFile(filePath, { viewHelpers: templateHelpers, ...templateHelpers, ...data }, { async: true });
}

async function renderLayout(title: string, currentNav: 'source' | 'slot-rule' | 'graph' | 'review', body: string): Promise<string> {
  return renderTemplate('layout.ejs', { title, currentNav, body });
}

export async function writeLocalViews(workspaceRoot: string): Promise<void> {
  const {
    acceptanceCoveragePath,
    explainGraphPath,
    generatedViewsDir,
    graphViewPath,
    reviewViewPath,
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

  const sharedData = {
    review, lock, provenance, policyReport, graph, repairPlan, upgradeDiagnostics, upgradePlan,
    explainNodeTypes: EXPLAIN_NODE_TYPES,
    countMatching, countPositiveValues, uniqueSorted, formatList,
    buildE2eMatrix, buildReviewUpgradePreflightSummaries,
    buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath
  };

  const sourceBody = await renderTemplate('source-view.ejs', sharedData);
  const sourceHtml = await renderLayout('Source View', 'source', sourceBody);
  await fs.writeFile(sourceViewPath, sourceHtml, 'utf8');

  const slotRuleBody = await renderTemplate('slot-rule-view.ejs', { ...sharedData, report, coverage });
  const slotRuleHtml = await renderLayout('Slot / Rule View', 'slot-rule', slotRuleBody);
  await fs.writeFile(slotRuleViewPath, slotRuleHtml, 'utf8');

  const graphBody = await renderTemplate('graph-view.ejs', sharedData);
  const graphHtml = await renderLayout('Graph View', 'graph', graphBody);
  await fs.writeFile(graphViewPath, graphHtml, 'utf8');

  const reviewBody = await renderTemplate('review-view.ejs', sharedData);
  const reviewHtml = await renderLayout('Review View', 'review', reviewBody);
  await fs.writeFile(reviewViewPath, reviewHtml, 'utf8');
}
