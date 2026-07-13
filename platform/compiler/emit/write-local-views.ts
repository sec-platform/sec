import ejs from 'ejs';
import path from 'node:path';
import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { CI_ARTIFACT_PATHS } from '../../shared/ci-artifact-contract.ts';
import { countMatching, countPositiveValues, uniqueSorted } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import { EXPLAIN_NODE_TYPES, type ExplainGraph } from '../../shared/explain-types.ts';
import {
  ensureDir,
  pathExists,
  readJson,
  readOptionalJson,
  writeText,
  type CommitFence
} from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeLockWithGeneratedPaths } from '../../shared/lock-utils.ts';
import { defaultLogger } from '../../shared/logger.ts';
import {
  compilerRoot,
  getWorkspacePaths,
  graphViewRelativePath,
  overviewViewRelativePath,
  reviewViewRelativePath,
  slotRuleViewRelativePath,
  sourceViewRelativePath
} from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import {
  buildProjectOverview,
  PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS,
  type ProjectOverview
} from '../../shared/project-overview.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';
import { buildE2eMatrix } from '../../shared/review-matrix.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';
import { buildReviewUpgradePreflightSummaries } from '../../shared/review-upgrade.ts';
import { semanticViewFactIds, type SemanticViewSet } from '../../shared/semantic-view-types.ts';
import type { ToolEvidenceReport } from '../../shared/tool-evidence-contract.ts';
import type { CiArtifactManifest, VerificationReport } from '../../shared/types.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import { buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath } from './runtime-attribution.ts';
import { assertSemanticViewArtifactsAreCurrent } from './semantic-view-artifact-contract.ts';

const TEMPLATES_DIR = path.join(compilerRoot, 'platform', 'compiler', 'emit', 'templates');
const CANONICAL_LOCAL_VIEW_GENERATED_AT = '1970-01-01T00:00:00.000Z';

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

export function buildSemanticViewRows(semanticViews: SemanticViewSet): string[][] {
  return semanticViews.views.map((view) => {
    const factIds = semanticViewFactIds(view);
    return [
      view.viewKind,
      view.subject ?? 'workspace',
      String(view.nodes.length),
      String(view.edges.length),
      String(factIds.length),
      formatList(factIds)
    ];
  });
}

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

async function renderLayout(title: string, currentNav: 'overview' | 'source' | 'slot-rule' | 'graph' | 'review', body: string): Promise<string> {
  return renderTemplate('layout.ejs', { title, currentNav, body });
}

function buildOverviewNextAction(overview: ProjectOverview): string {
  switch (overview.status.overall) {
    case 'failed':
      return 'Open Review View first, resolve failure points and blockers, then rerun verification.';
    case 'attention':
      return 'Inspect priority review files and missing artifacts, then rerun verification for handoff readiness.';
    case 'passed':
      return 'Use the linked workbench views for AI handoff or deeper source and graph inspection.';
    case 'skipped':
      return 'Complete skipped governance steps before handing the workspace to review or AI repair.';
    default:
      return 'Refresh governance artifacts, then reopen this overview to rebuild the workbench state.';
  }
}

export interface LocalViewArtifact {
  readonly relativePath:
    | typeof overviewViewRelativePath
    | typeof sourceViewRelativePath
    | typeof slotRuleViewRelativePath
    | typeof graphViewRelativePath
    | typeof reviewViewRelativePath;
  readonly text: string;
}

export async function buildLocalViewArtifacts(workspaceRoot: string): Promise<LocalViewArtifact[]> {
  const {
    acceptanceCoveragePath,
    ciArtifactsPath,
    explainGraphPath,
    lockPath,
    policyReportPath,
    provenancePath,
    reviewSummaryPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);

  const lock = await readRequiredArtifact<LockFile>(lockPath, 'graph.lock.json');
  const graph = await readRequiredArtifact<ExplainGraph>(explainGraphPath, 'explain-graph.json');
  assertSemanticViewArtifactsAreCurrent(lock, graph);

  const [provenance, report, coverage, policyReport, review, artifactManifest, codeQuality, architectureBoundary, semanticPattern, governanceReports] = await Promise.all([
    readRequiredArtifact<ProvenanceFile>(provenancePath, 'provenance.json'),
    readRequiredArtifact<VerificationReport>(verificationReportPath, 'verification-report.json'),
    readRequiredArtifact<AcceptanceCoverageReport>(acceptanceCoveragePath, 'acceptance-coverage.json'),
    readRequiredArtifact<PolicyReport>(policyReportPath, 'policy-report.json'),
    readRequiredArtifact<ReviewSummary>(reviewSummaryPath, 'review-summary.json'),
    readOptionalJson<CiArtifactManifest>(ciArtifactsPath),
    readOptionalJson<ToolEvidenceReport>(path.join(workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['code-quality'])),
    readOptionalJson<ToolEvidenceReport>(path.join(workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['architecture-boundary'])),
    readOptionalJson<ToolEvidenceReport>(path.join(workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['semantic-pattern'])),
    readReviewGovernanceReports(workspaceRoot)
  ]);
  const { repairPlan, upgradeDiagnostics, upgradePlan } = governanceReports;

  const overview = buildProjectOverview({
    workspaceRoot,
    generatedAt: CANONICAL_LOCAL_VIEW_GENERATED_AT,
    lock,
    explainGraph: graph,
    provenance,
    verification: report,
    acceptanceCoverage: coverage,
    policy: policyReport,
    reviewSummary: review,
    artifactManifest,
    toolEvidenceReports: [codeQuality, architectureBoundary, semanticPattern].filter(
      (toolReport): toolReport is ToolEvidenceReport => toolReport !== null
    )
  });

  const sharedData = {
    review, lock, provenance, policyReport, graph, repairPlan, upgradeDiagnostics, upgradePlan,
    semanticViewRows: buildSemanticViewRows(graph.semanticViews),
    explainNodeTypes: EXPLAIN_NODE_TYPES,
    countMatching, countPositiveValues, uniqueSorted, formatList,
    buildE2eMatrix, buildReviewUpgradePreflightSummaries,
    buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath
  };

  const overviewBody = await renderTemplate('overview-view.ejs', {
    overview,
    nextAction: buildOverviewNextAction(overview)
  });
  const overviewHtml = await renderLayout('Overview', 'overview', overviewBody);

  const sourceBody = await renderTemplate('source-view.ejs', sharedData);
  const sourceHtml = await renderLayout('Source View', 'source', sourceBody);

  const slotRuleBody = await renderTemplate('slot-rule-view.ejs', { ...sharedData, report, coverage });
  const slotRuleHtml = await renderLayout('Slot / Rule View', 'slot-rule', slotRuleBody);

  const graphBody = await renderTemplate('graph-view.ejs', sharedData);
  const graphHtml = await renderLayout('Graph View', 'graph', graphBody);

  const reviewBody = await renderTemplate('review-view.ejs', sharedData);
  const reviewHtml = await renderLayout('Review View', 'review', reviewBody);

  return [
    { relativePath: overviewViewRelativePath, text: overviewHtml },
    { relativePath: sourceViewRelativePath, text: sourceHtml },
    { relativePath: slotRuleViewRelativePath, text: slotRuleHtml },
    { relativePath: graphViewRelativePath, text: graphHtml },
    { relativePath: reviewViewRelativePath, text: reviewHtml }
  ];
}

export async function writeLocalViews(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  const { explainGraphPath, generatedViewsDir, lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readRequiredArtifact<LockFile>(lockPath, 'graph.lock.json');
  const graph = await readRequiredArtifact<ExplainGraph>(explainGraphPath, 'explain-graph.json');
  assertSemanticViewArtifactsAreCurrent(lock, graph);
  await ensureDir(generatedViewsDir, commitFence);

  // Local-First Vis.js offline caching remains a write-side concern. The pure
  // renderer below only consumes canonical workspace artifacts.
  const visLocalPath = path.join(generatedViewsDir, 'vis-network.min.js');
  if (!(await pathExists(visLocalPath))) {
    try {
      defaultLogger.info('Downloading offline vis-network.min.js asset', { visLocalPath });
      const res = await fetch('https://unpkg.com/vis-network/standalone/umd/vis-network.min.js');
      if (res.ok) {
        const text = await res.text();
        await writeText(visLocalPath, text, commitFence);
        defaultLogger.info('Cached vis-network.min.js locally', { visLocalPath, bytes: text.length });
      } else {
        defaultLogger.warn('Download vis-network.min.js failed; falling back to CDN', { status: res.status });
      }
    } catch (e) {
      defaultLogger.warn('Failed to download offline asset; browser will fall back to CDN', { error: e });
    }
  }

  await writeLockWithGeneratedPaths(lockPath, lock, CI_ARTIFACT_PATHS.view, commitFence);
  const artifacts = await buildLocalViewArtifacts(workspaceRoot);
  for (const artifact of artifacts) {
    await writeText(path.join(workspaceRoot, artifact.relativePath), artifact.text, commitFence);
  }
}
